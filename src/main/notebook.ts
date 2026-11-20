// Notebook mode's main side (21 Oct 2026, gap G10; the rules are in src/shared/notebook.ts and src/shared/flashcards.ts):
// a folder's sources listed with their ticks, the ticked ones read and cut into passages (kept while a file is
// unchanged), questions answered from the best passages on Ironleaf's own model, the Studio's outputs written into the
// folder's Notebook folder, Find sources handed to the former host app, and the flashcards' spaced review. Nothing here
// reaches the network itself: the model goes through Ironleaf's usual model code (src/main/ai.ts), the search through the
// former host app.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiService } from './ai';
import type { VaultIndex } from './indexer';
import type { Vault } from './vault';
import type { ReadResult } from './doc-text';
import { isPrivatePath } from '../shared/private';
import { titleFromPath } from '../shared/markdown';
import { readProps } from '../shared/frontmatter';
import {
  answerNote,
  audioNote,
  briefingNote,
  chunkDocument,
  chunkNote,
  CiteBook,
  extOf,
  findSourcesBrief,
  foundSourcesNote,
  inFolder,
  isSourcePath,
  mindMapCanvas,
  notebookDir,
  notebookSystem,
  NOTEBOOK_FOLDER,
  NOTEBOOK_REFUSAL,
  rankChunks,
  readAnswer,
  readSources,
  sourcesBlock,
  sourcesList,
  sourcesNotePath,
  spreadChunks,
  studioFileName,
  studioSystem,
  tableNote,
  writeSources,
  scriptLines,
  type Chunk,
  type ReadAnswer,
  type SourceKind,
  type SourcesChoice,
  type StudioKind,
} from '../shared/notebook';
import { dueCards, parseCards, readReview, schedule, writeCards, writeQuiz, writeReview, type Card, type Grade, type QuizQuestion, type ReviewState } from '../shared/flashcards';

export interface NotebookSource {
  path: string;
  title: string;
  kind: SourceKind;
  ticked: boolean;
  /** Added by link from elsewhere (else one of the folder's own). */
  added: boolean;
  /** Added, but no longer in the notes (moved or deleted): shown so it can be taken off. */
  missing?: boolean;
}

export interface NotebookOutput {
  path: string;
  title: string;
  kind: StudioKind | 'answer' | 'found' | 'other';
  made: number;
  /** Flashcards: cards due now. */
  due?: number;
}

export interface NotebookState {
  folder: string;
  name: string;
  sources: NotebookSource[];
  outputs: NotebookOutput[];
  /** Find sources is offered (Ironleaf inside the former host app, which does the searching). */
  canFind: boolean;
  /** More sources than one question reads: the first ones count. */
  capped?: number;
}

export interface NotebookAnswer extends ReadAnswer {
  id: string;
  question: string;
  /** How many passages were read for it. */
  read: number;
}

export interface DueDeck {
  path: string;
  title: string;
  due: number;
  total: number;
}

export interface NotebookDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  requireCreate(): Promise<void>;
  vault(): Vault;
  index: VaultIndex;
  ai: AiService;
  /** A document's words (PDF pages marked "\fpage N"), as the file index reads them. */
  readFile(abs: string, ext: string, size: number): Promise<ReadResult>;
  /** Writes a file in the notes as the person's own change (kept in recovery, the window told). */
  writeNote(rel: string, text: string): Promise<void>;
  /** A free name in a folder ("Briefing 21 Oct 2026 2.md" when the first is taken). */
  freeName(folder: string, base: string, ext: string): Promise<string>;
  /** Files never counted as sources (private notes, templates, excluded folders). */
  skip(rel: string): boolean;
  /** Inside the former host app: a job handed to it, and how it is going. */
  job?(brief: string): Promise<{ conversationId: string }>;
  jobStatus?(id: string): Promise<{ status: string; words?: string; summary?: string; why?: string } | null>;
  today(): string;
}

/** At most this many sources are read for one question (the first, in the list's order). */
const MAX_SOURCES = 400;

const cleanFolder = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new Error('Choose a folder.');
  const f = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
  if (f.split('/').some((p) => p === '..' || p === '.')) throw new Error('Choose a folder.');
  return f;
};

/** A source's kind by its file. */
const kindOf = (rel: string): SourceKind => (extOf(rel) === 'md' ? 'note' : extOf(rel) === 'pdf' ? 'pdf' : 'doc');
/** Whether a file is inside any Notebook folder at or below the notebook (each notebook's outputs are its own). */
const inAnyNotebook = (rel: string, folder: string) => (folder ? rel.slice(folder.length + 1) : rel).split('/').slice(0, -1).includes(NOTEBOOK_FOLDER);

export function registerNotebook(d: NotebookDeps): { dueDecks(): DueDeck[] } {
  const chunkCache = new Map<string, { mtime: number; size: number; chunks: Chunk[] }>();
  const answers = new Map<string, { folder: string; answer: NotebookAnswer }>();
  const finds = new Map<string, { folder: string; topic: string }>();

  const titleOf = (rel: string) => (kindOf(rel) === 'note' ? (d.index.get(rel)?.title ?? titleFromPath(rel)) : path.posix.basename(rel));
  const nameOf = (folder: string) => (folder ? folder.split('/').pop()! : 'Your notes');

  async function readChoice(folder: string): Promise<SourcesChoice> {
    const rel = sourcesNotePath(folder);
    const text = d.index.content(rel) ?? (await d.vault().read(rel).catch(() => ''));
    return readSources(text);
  }

  async function state(folder: string): Promise<NotebookState> {
    const v = d.vault();
    if (folder && !(await v.isFolder(folder).catch(() => false))) throw new Error(`There is no folder ${folder} in your notes.`);
    const all = await v.listAll();
    const choice = await readChoice(folder);
    const off = new Set(choice.off);
    const known = new Map(all.files.map((f) => [f.rel, f]));
    const sources: NotebookSource[] = [];
    for (const f of all.files) {
      if (!inFolder(f.rel, folder) || inAnyNotebook(f.rel, folder) || !isSourcePath(f.rel) || isPrivatePath(f.rel) || d.skip(f.rel)) continue;
      sources.push({ path: f.rel, title: titleOf(f.rel), kind: kindOf(f.rel), ticked: !off.has(f.rel), added: false });
    }
    for (const rel of choice.added) {
      if (sources.some((s) => s.path === rel) || isPrivatePath(rel)) continue;
      sources.push({ path: rel, title: titleOf(rel), kind: kindOf(rel), ticked: !off.has(rel), added: true, ...(known.has(rel) ? {} : { missing: true }) });
    }
    const dir = notebookDir(folder);
    const outputs: NotebookOutput[] = all.files
      .filter((f) => f.rel.startsWith(`${dir}/`) && !f.rel.slice(dir.length + 1).includes('/') && f.rel !== sourcesNotePath(folder) && (f.kind === 'note' || (f.kind === 'canvas' && /\.canvas$/i.test(f.rel))))
      .map((f): NotebookOutput => {
        if (f.kind === 'canvas') return { path: f.rel, title: path.posix.basename(f.rel, '.canvas'), kind: 'mindmap' as const, made: f.mtime };
        const said = String(d.index.get(f.rel)?.props?.['notebook-kind'] ?? '');
        const kind = (['briefing', 'flashcards', 'quiz', 'table', 'audio', 'answer', 'found'] as const).find((k) => k === said) ?? 'other';
        const due = kind === 'flashcards' ? dueCards(d.index.content(f.rel) ?? '', d.today()).length : undefined;
        return { path: f.rel, title: titleOf(f.rel), kind, made: f.mtime, ...(due !== undefined ? { due } : {}) };
      })
      .sort((a, b) => b.made - a.made);
    const ticked = sources.filter((s) => s.ticked && !s.missing).length;
    return { folder, name: nameOf(folder), sources, outputs, canFind: !!d.job && !!d.jobStatus, ...(ticked > MAX_SOURCES ? { capped: MAX_SOURCES } : {}) };
  }

  async function writeChoice(folder: string, choice: SourcesChoice): Promise<void> {
    await d.requireCreate();
    await d.writeNote(sourcesNotePath(folder), writeSources(nameOf(folder), choice));
  }

  /** One source's passages (read again only when the file changed). */
  async function chunksOf(rel: string): Promise<Chunk[]> {
    const v = d.vault();
    // Any file's size and time (the vault's own stat is for notes only).
    const st = await fsp
      .stat(v.absolute(rel))
      .then((x) => ({ mtime: x.mtimeMs, size: x.size }))
      .catch(() => null);
    if (!st) return [];
    const kept = chunkCache.get(rel);
    if (kept && kept.mtime === st.mtime && kept.size === st.size) return kept.chunks;
    const kind = kindOf(rel);
    let chunks: Chunk[] = [];
    if (kind === 'note') chunks = chunkNote(rel, titleOf(rel), d.index.content(rel) ?? (await v.read(rel)));
    else {
      const read = await d.readFile(v.absolute(rel), extOf(rel), st.size);
      if (read.text) chunks = chunkDocument(rel, titleOf(rel), read.text, kind);
    }
    chunkCache.set(rel, { mtime: st.mtime, size: st.size, chunks });
    return chunks;
  }

  async function tickedChunks(folder: string): Promise<{ chunks: Chunk[]; name: string }> {
    const s = await state(folder);
    const ticked = s.sources.filter((x) => x.ticked && !x.missing).slice(0, MAX_SOURCES);
    if (!ticked.length) throw new Error('Tick at least one source first.');
    const chunks: Chunk[] = [];
    for (const x of ticked) chunks.push(...(await chunksOf(x.path)));
    return { chunks, name: s.name };
  }

  /** A question answered from the ticked sources only (the refusal when none of them says). */
  async function ask(folder: string, question: string, previous: string): Promise<NotebookAnswer> {
    const { chunks } = await tickedChunks(folder);
    const ranked = rankChunks(chunks, `${question} ${previous}`, 8, 12000);
    const id = randomUUID();
    let answer: NotebookAnswer;
    if (!ranked.length) answer = { id, question, read: 0, text: NOTEBOOK_REFUSAL, citations: [], refused: true };
    else {
      const given = ranked.map((r) => r.chunk);
      const user = `${sourcesBlock(given)}\n\n${previous ? `(Their question before this one: ${previous})\n\n` : ''}${question}`;
      const r = await d.ai.askText(notebookSystem(d.ai.currentModelName()), user);
      if (r.error && !r.text) throw new Error(r.error);
      answer = { id, question, read: given.length, ...readAnswer(r.text, given) };
    }
    answers.set(id, { folder, answer });
    if (answers.size > 60) answers.delete(answers.keys().next().value!);
    return answer;
  }

  /** A Studio output made from passages spread across the ticked sources, saved in the notebook's folder. */
  async function make(folder: string, kind: StudioKind): Promise<string> {
    await d.requireCreate();
    const { chunks, name } = await tickedChunks(folder);
    const given = spreadChunks(chunks, 24000);
    if (!given.length) throw new Error('The ticked sources have no words to work from yet.');
    const { reply, error } = await d.ai.askJson(studioSystem(kind), `${sourcesBlock(given)}\n\nThe notebook is “${name}”.`, 240_000, 7000);
    if (!reply) throw new Error(error ?? 'The model didn’t answer. Try again.');
    const iso = d.today();
    const o = { folder, name, iso };
    let text: string;
    switch (kind) {
      case 'briefing':
        text = briefingNote(reply, given, o);
        break;
      case 'table':
        text = tableNote(reply, given, o);
        break;
      case 'audio':
        text = audioNote(reply, given, o);
        break;
      case 'mindmap':
        text = JSON.stringify(mindMapCanvas(reply, given), null, '\t');
        break;
      case 'flashcards': {
        const book = new CiteBook(given);
        const cards = (Array.isArray((reply as { cards?: unknown }).cards) ? (reply as { cards: unknown[] }).cards : [])
          .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
          .filter((c) => typeof c.q === 'string' && typeof c.a === 'string' && c.q.trim() && c.a.trim())
          .slice(0, 30)
          .map((c) => ({ q: String(c.q).trim(), a: `${String(c.a).trim()}${book.links(c.cites)}` }));
        if (!cards.length) throw new Error('The model made no flashcards. Try again.');
        text = writeCards({ title: `Flashcards: ${name}`, folder, iso, cards, sources: sourcesList(book.all()) });
        break;
      }
      case 'quiz': {
        const book = new CiteBook(given);
        const questions: QuizQuestion[] = (Array.isArray((reply as { questions?: unknown }).questions) ? (reply as { questions: unknown[] }).questions : [])
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
          .map((x) => ({ q: String(x.q ?? '').trim(), choices: (Array.isArray(x.choices) ? x.choices : []).map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 6), answer: Number(x.answer), why: String(x.why ?? '').trim(), links: book.links(x.cites) }))
          .filter((x) => x.q && x.choices.length >= 2 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.choices.length)
          .slice(0, 15);
        if (!questions.length) throw new Error('The model made no quiz questions. Try again.');
        text = writeQuiz({ title: `Quiz: ${name}`, folder, iso, questions, sources: sourcesList(book.all()) });
        break;
      }
    }
    const file = studioFileName(kind, iso);
    const ext = kind === 'mindmap' ? '.canvas' : '.md';
    const rel = await d.freeName(notebookDir(folder), file.slice(0, -ext.length), ext);
    await d.writeNote(rel, text);
    return rel;
  }

  /** Flashcard decks with cards due today, for Today. */
  function dueDecks(): DueDeck[] {
    const today = d.today();
    const out: DueDeck[] = [];
    for (const m of d.index.allMeta()) {
      if (m.props?.['notebook-kind'] !== 'flashcards' || isPrivatePath(m.path)) continue;
      const text = d.index.content(m.path) ?? '';
      const due = dueCards(text, today).length;
      if (due) out.push({ path: m.path, title: m.title, due, total: parseCards(text).length });
    }
    return out.sort((a, b) => b.due - a.due || a.title.localeCompare(b.title));
  }

  const flashcardsNote = (raw: unknown): string => {
    if (typeof raw !== 'string' || !/\.md$/i.test(raw) || isPrivatePath(raw)) throw new Error('Those flashcards can’t be found.');
    const rel = raw.replace(/\\/g, '/');
    if (d.index.get(rel)?.props?.['notebook-kind'] !== 'flashcards' && !/^Q:/m.test(d.index.content(rel) ?? '')) throw new Error('That note has no flashcards.');
    return rel;
  };

  d.handle('notebook:state', (folder: unknown) => state(cleanFolder(folder)));
  d.handle('notebook:choose', async (folder: unknown, choice: unknown) => {
    const f = cleanFolder(folder);
    const c = (choice && typeof choice === 'object' ? choice : {}) as Partial<SourcesChoice>;
    const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((p): p is string => typeof p === 'string' && isSourcePath(p) && !isPrivatePath(p)).map((p) => p.replace(/\\/g, '/')))].slice(0, 2000);
    await writeChoice(f, { added: list(c.added), off: list(c.off) });
    return state(f);
  });
  d.handle('notebook:ask', async (folder: unknown, question: unknown, previous: unknown) => {
    await d.requireCreate();
    const q = typeof question === 'string' ? question.trim().slice(0, 2000) : '';
    if (!q) throw new Error('Ask a question first.');
    return ask(cleanFolder(folder), q, typeof previous === 'string' ? previous.slice(0, 2000) : '');
  });
  d.handle('notebook:make', async (folder: unknown, kind: unknown) => {
    const k = (['briefing', 'mindmap', 'flashcards', 'quiz', 'table', 'audio'] as const).find((x) => x === kind);
    if (!k) throw new Error('That isn’t something the Studio makes.');
    return make(cleanFolder(folder), k);
  });
  d.handle('notebook:save-answer', async (id: unknown) => {
    await d.requireCreate();
    const kept = typeof id === 'string' ? answers.get(id) : undefined;
    if (!kept) throw new Error('That answer isn’t here any more. Ask again to save it.');
    if (kept.answer.refused) throw new Error('There is nothing to save: the sources didn’t say.');
    const iso = d.today();
    const rel = await d.freeName(notebookDir(kept.folder), studioFileName('answer', iso).slice(0, -3), '.md');
    await d.writeNote(rel, answerNote(kept.answer.question, kept.answer, { folder: kept.folder, iso }));
    return rel;
  });
  // Find sources: The former host app searches the web (its browser) and its reply becomes a note added to the
  // sources.
  d.handle('notebook:find', async (folder: unknown, topic: unknown) => {
    await d.requireCreate();
    if (!d.job) throw new Error('Find sources isn’t available here.');
    const f = cleanFolder(folder);
    const t = typeof topic === 'string' ? topic.trim().slice(0, 500) : '';
    if (!t) throw new Error('Say what to look for.');
    const started = await d.job(findSourcesBrief(t, nameOf(f)));
    finds.set(started.conversationId, { folder: f, topic: t });
    return { id: started.conversationId };
  });
  d.handle('notebook:find-status', async (id: unknown): Promise<{ status: 'working' | 'done' | 'failed'; path?: string; why?: string }> => {
    const job = typeof id === 'string' ? finds.get(id) : undefined;
    if (!job || !d.jobStatus) return { status: 'failed', why: 'Ironleaf can’t follow that search.' };
    const s = await d.jobStatus(id as string).catch(() => null);
    if (!s) return { status: 'working' };
    if (s.status === 'working' || s.status === 'unknown') return { status: 'working' };
    finds.delete(id as string);
    const words = String(s.words ?? s.summary ?? '').trim();
    if (s.status !== 'done' || !words) return { status: 'failed', why: s.why ? String(s.why).slice(0, 300) : 'No sources were found this time.' };
    const iso = d.today();
    const rel = await d.freeName(notebookDir(job.folder), studioFileName('found', iso).slice(0, -3), '.md');
    await d.writeNote(rel, foundSourcesNote(words, { folder: job.folder, topic: job.topic, iso }));
    // The found note counts as a source straight away.
    const choice = await readChoice(job.folder);
    if (!choice.added.includes(rel)) await writeChoice(job.folder, { ...choice, added: [...choice.added, rel] });
    return { status: 'done', path: rel };
  });
  d.handle('notebook:deck', (raw: unknown): { path: string; title: string; cards: Card[]; due: string[]; review: Record<string, ReviewState> } => {
    const rel = flashcardsNote(raw);
    const text = d.index.content(rel) ?? '';
    return { path: rel, title: d.index.get(rel)?.title ?? titleFromPath(rel), cards: parseCards(text), due: dueCards(text, d.today()).map((c) => c.id), review: readReview(text) };
  });
  d.handle('notebook:grade', async (raw: unknown, id: unknown, grade: unknown) => {
    await d.requireCreate();
    const rel = flashcardsNote(raw);
    const g = (['again', 'hard', 'good', 'easy'] as const).find((x) => x === grade);
    if (!g || typeof id !== 'string') throw new Error('That grade can’t be kept.');
    const text = d.index.content(rel) ?? (await d.vault().read(rel));
    if (!parseCards(text).some((c) => c.id === id)) throw new Error('That card isn’t in the note any more.');
    const next = schedule(readReview(text)[id], g as Grade, d.today());
    await d.writeNote(rel, writeReview(text, id, next));
    return next;
  });
  d.handle('notebook:due', () => dueDecks());
  d.handle('notebook:script', (raw: unknown) => {
    if (typeof raw !== 'string' || isPrivatePath(raw)) throw new Error('That script can’t be found.');
    const text = d.index.content(raw.replace(/\\/g, '/'));
    if (text === undefined) throw new Error('That script can’t be found.');
    const voices = readProps(text).voices;
    return { lines: scriptLines(text), voices: Array.isArray(voices) ? voices.map(String).slice(0, 2) : [] };
  });

  return { dueDecks };
}
