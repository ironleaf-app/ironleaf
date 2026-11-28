// Publications on the main side (Wave 6 part a, 24 Oct 2026; src/shared/publications.ts, edition-doc.ts, puzzles.ts).
// Everything goes through the app's own ways in: notes written as every save is (indexed, kept in file recovery, open
// tabs told), an edition's PDF kept beside it with its versions (src/main/vault-files.ts place), pictures copied in under
// free names, the bell's notices through the reminders' own list. Nothing runs while Publications is off: no timer, no
// file, no notice; switched off it hides and keeps every note.
//
//   pub:state            the publications, the one shown: its editions (the archive), pieces, solve times, what is due
//   pub:edition          one edition: its sections with their pieces resolved, the answers it prints, the fit estimate
//   pub:preview          the edition's pages staged for the studio's frame (the same document the PDF is printed from)
//   pub:build            the PDF laid out, printed and kept with the edition (a new version when there was one)
//   pub:deliver sent by Telegram (a chat bot), email (the bot's address) and/or printed on the named printer
//   pub:* (the rest)     publications, sections, editions, pieces, pictures, puzzles and solve times made and changed;
//                        the archive searched; an older publication note imported; the printers on this PC
// The agents' tools (src/shared/publication-tools.ts) are answered here, from the notes each one's gate lets through.

import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AREAS_FILE, readAreas } from '../shared/areas';
import { editionDocument, LAYOUT_FILE, layoutDocument, laidOutWords, type DocInput, type DocSection, type LaidOut } from '../shared/edition-doc';
import { changeProps } from '../shared/frontmatter';
import { moduleOn, partOn, type ModuleSwitches } from '../shared/life-modules';
import {
  answersFrom,
  bodyOf,
  closeTitles,
  editionBlocks,
  editionFileName,
  isPieceId,
  pieceBlock,
  pieceId,
  readEditionPieces,
  filedEditionPdf,
  editionLabel,
  editionsFolder,
  estimateFit,
  findItem,
  fitItemOf,
  fitWords,
  importProps,
  isoOf,
  ITEM_KINDS,
  kindInfo,
  longDate,
  newEditionText,
  newPublicationText,
  lastScheduledDay,
  nextNumber,
  nextRun,
  parseEditionNumber,
  planImport,
  previousEdition,
  PUBLICATION_RULES,
  readEdition,
  readItem,
  readKind,
  readPublication,
  readSchedule,
  scheduleText,
  scheduleWords,
  searchArchive,
  sniffImage,
  shortDate,
  solveBoard,
  sortEditions,
  sourceProblem,
  TABLE_ROW_RE,
  deliveryWays,
  puzzleSectionName,
  templateOf,
  timeWords,
  withDeliveryRow,
  withEditionNotes,
  withEditionSections,
  withSections,
  withSolve,
  fileName,
  type DeliveryRow,
  type Edition,
  type EditionStatus,
  type ImportPlan,
  type Item,
  type ItemInput,
  type Publication,
  type PublicationInput,
  type SearchHit,
  type Section,
  type SectionFit,
  type SolveBoard,
} from '../shared/publications';
import { isPublicationTool, PUBLICATION_TOOLS } from '../shared/publication-tools';
import { checkPuzzle, makeCrossword, makeDailyWord, makeSudoku, makeWordSearch, readClueLines, readSolveTime, seedOf, solveTimeWords, type Puzzle } from '../shared/puzzles';
import { refusal } from '../shared/sensitivity';
import { setNoteProp } from '../shared/views';
import { gateIndex, type Gate } from './agent-gate';
import type { EditionPrinter, PrinterInfo } from './edition-print';
import type { VaultIndex } from './indexer';

export interface DeliverRequest {
  channel: 'telegram' | 'email';
  /** The PDF on this PC (its whole path). */
  file: string;
  caption: string;
  subject?: string;
  to?: string[];
}

export interface PublicationsDeps {
  root(): string | null;
  index: VaultIndex;
  prefs(): { templatesFolder: string; modules: ModuleSwitches };
  writeNote(rel: string, text: string, by?: string): Promise<void>;
  requireCreate(): Promise<void>;
  exists(rel: string): Promise<boolean>;
  /** Every file in the vault (path and size), for the import and house style. */
  files(): Promise<{ path: string; size: number }[]>;
  /** A file put beside its record with its versions kept (src/main/vault-files.ts place, moved in). */
  placeFile(o: { record: string; src: string; name: string; by: string; what: string }): Promise<{ rel: string; version: number }>;
  fileVersion(rel: string): Promise<number>;
  copyIn(abs: string[], folder: string): Promise<string[]>;
  pickFiles(o: { title: string; filters: { name: string; extensions: string[] }[]; multi: boolean }): Promise<string[]>;
  pickSave(o: { title: string; name: string }): Promise<string | null>;
  printer: EditionPrinter;
  /** The app's own type for the pages (its serif and sans), when found. */
  appFonts(): Promise<DocInput['appFonts']>;
  readPdfText(abs: string): Promise<string | null>;
  /** A note to the vault's bin (the person can bring it back): an item note folded into its edition. */
  trash?(rel: string): Promise<void>;
  /** Inside the former host app: a PDF sent by a chat bot (Telegram) or from the bot's email address. */
  deliver?(r: DeliverRequest): Promise<{ ok: boolean; words: string }>;
  post(items: { key: string; kind: string; title: string; body: string; path: string }[]): number;
  changed(): void;
  log?(m: string): void;
  now?(): Date;
}

// ── What the window gets ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ItemView {
  path: string;
  kind: string;
  kindName: string;
  headline: string;
  section: string;
  source: string;
  credit: string;
  date: string | null;
  image: string;
  lead: boolean;
  words: number;
  editions: string[];
  puzzle: string | null;
  problems: string[];
  solves: number;
}

export interface EditionView {
  path: string;
  label: string;
  number: number | null;
  date: string | null;
  status: EditionStatus;
  preview: boolean;
  pdf: string;
  pages: number | null;
  lead: string;
  pieces: number;
  delivered: string;
  template: string;
  imported: boolean;
}

export interface PublicationSummary {
  path: string;
  title: string;
  masthead: string;
  ready: boolean;
  editions: number;
}

export interface PubState {
  on: boolean;
  puzzlesOn: boolean;
  deliveryOn: boolean;
  canSend: boolean;
  publications: PublicationSummary[];
  /** Publication notes written before the module (to import). */
  waiting: { path: string; title: string }[];
  current: null | {
    pub: Publication;
    scheduleWords: string;
    next: { at: string; words: string; edition: EditionView | null } | null;
    editions: EditionView[];
    items: ItemView[];
    board: SolveBoard;
  };
}

export interface EditionDetail {
  edition: EditionView & { notes: string; delivery: DeliveryRow[] };
  pub: Publication;
  sections: { name: string; pages: number; sources: string; rules: string; items: ItemView[]; missing: string[] }[];
  answers: { from: string; count: number } | null;
  estimate: SectionFit[];
  estimateWords: string;
}

const S = (v: unknown, max = 400): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const baseOf = (p: string) => p.split('/').pop() ?? p;
/** An item as the input that writes it again (a piece copied into an edition). */
const itemInputOf = (it: Item): ItemInput => ({ kind: it.kind, headline: it.headline, section: it.section, body: it.body, deck: it.deck, source: it.source, sourceUrl: it.sourceUrl, credit: it.credit, who: it.who, image: it.image, lead: it.lead, date: it.date ?? undefined, puzzle: it.puzzle });
const isoDay = (v: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(S(v, 20)) ? S(v, 20) : null);

/** Weather and sports tables are drawn from a Markdown table (26 Oct 2026: weather written as a sentence printed as one
 *  run-on line under the masthead). Null when the piece is fine. */
export function tableProblem(it: { kind: string; headline: string; body?: string }): string | null {
  if (it.kind !== 'weather' && it.kind !== 'sports') return null;
  const rows = String(it.body ?? '').split(/\r?\n/).filter((l) => TABLE_ROW_RE.test(l));
  if (rows.length >= 3) return null;
  return it.kind === 'weather'
    ? `“${it.headline}”: weather is a table, a row per place and a column per day, as Markdown: | Place | Mon 26 | Tue 27 | … |, then | --- | --- | … |, then | Melbourne | 18°/9° Showers | … |.`
    : `“${it.headline}”: a sports table is a Markdown table: a header row, | --- | row, then a row per team or result.`;
}

/** A section's rules with the negated parts dropped ("one cartoon strip + crossword; no sudoku" asks for no sudoku,
 *  9.2): each part split on ";" and "+", and a part that starts with no/not/without/skip/except/never is not asked. */
export function wantedRules(rules: string): string {
  return String(rules ?? '')
    .split(/[;+]/)
    .filter((part) => !/^\s*(no|not|without|skip(?:ping)?|except|never)\b/i.test(part))
    .join(';');
}

/** Kinds a section's rules ask for ("one cartoon strip + crossword; sudoku + Wordle + word search"). */
const RULE_KINDS: [RegExp, string, string][] = [
  [/\b(cartoon|comic|strip)s?\b/i, 'cartoon', 'a cartoon (make the strip with the picture tool, then add it as a cartoon piece with its image)'],
  [/\bcrosswords?\b/i, 'crossword', 'a crossword (puzzle_generate)'],
  [/\bsudokus?\b/i, 'sudoku', 'a sudoku (puzzle_generate)'],
  [/\bword ?searche?s?\b/i, 'wordsearch', 'a word search (puzzle_generate)'],
  [/\b(wordle|daily word)\b/i, 'dailyword', 'a daily word (puzzle_generate)'],
  [/\bweather\b/i, 'weather', 'the weather table'],
];

export class Publications {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pdfWords = new Map<string, { key: string; text: string }>();
  /** Days with no edition yet, said in the bell (a day's edition made later still goes out: only the notice is deduped,
   *  never the send — 9.5: the send's own key was set before the edition was looked for, blocking it all day). */
  private saidNone = new Set<string>();
  private running = false;

  constructor(private d: PublicationsDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }
  on(): boolean {
    return moduleOn(this.d.prefs().modules, 'publications');
  }
  private part(p: string): boolean {
    return partOn(this.d.prefs().modules, 'publications', p);
  }
  private need(): void {
    if (!this.on()) throw new Error('Publications is switched off (Settings › Packs).');
  }
  private root(): string {
    const r = this.d.root();
    if (!r) throw new Error('Open your vault first.');
    return r;
  }
  private abs(rel: string): string {
    return path.join(this.root(), ...rel.split('/'));
  }

  // ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Every publication, edition and piece an index holds (the whole index, or an agent's gated one). */
  read(index: VaultIndex = this.d.index): { pubs: Publication[]; editions: Edition[]; items: Item[] } {
    const tf = (this.d.prefs().templatesFolder || 'Templates').toLowerCase();
    const pubs: Publication[] = [];
    const editions: Edition[] = [];
    const items: Item[] = [];
    for (const m of index.allMeta()) {
      if (!/\.md$/i.test(m.path) || m.path.toLowerCase().startsWith(`${tf}/`) || /^private notes\//i.test(m.path)) continue;
      const type = String(m.props?.type ?? '').trim().toLowerCase();
      if (type !== 'publication' && type !== 'edition' && type !== 'publication-item') continue;
      const content = index.content(m.path);
      if (content === undefined) continue;
      const n = { path: m.path, title: m.title, props: (m.props ?? {}) as Record<string, unknown>, content };
      if (type === 'publication') pubs.push(readPublication(n));
      else if (type === 'edition') {
        const e = readEdition(n);
        editions.push(e);
        items.push(...readEditionPieces(n, e.sections));
      }
      else items.push(readItem(n));
    }
    pubs.sort((a, b) => a.title.localeCompare(b.title));
    return { pubs, editions, items };
  }

  /** Whose a record is: its `publication:` link, else the publication whose folder it is in. */
  private belongs(pub: Publication, rec: { path: string; publication: string }): boolean {
    const want = rec.publication.replace(/\.md$/i, '').toLowerCase();
    if (want) return want === pub.title.toLowerCase() || want === pub.path.replace(/\.md$/i, '').toLowerCase() || baseOf(want) === pub.title.toLowerCase();
    return rec.path.toLowerCase().startsWith(`${pub.folder.toLowerCase()}/`);
  }

  private ofPub(pub: Publication, all: { editions: Edition[]; items: Item[] }) {
    return { editions: sortEditions(all.editions.filter((e) => this.belongs(pub, e))), items: all.items.filter((i) => this.belongs(pub, i)) };
  }

  /** The publication asked for by name (or path), or the only one. */
  private pick(pubs: Publication[], name: unknown): Publication {
    const want = S(name, 200).toLowerCase();
    const ready = pubs.filter((p) => p.ready);
    if (!want) {
      if (ready.length === 1) return ready[0]!;
      if (pubs.length === 1) return pubs[0]!;
      if (!pubs.length) throw new Error('There are no publications yet. Start one on the Publications page.');
      throw new Error(`Say which publication: ${pubs.map((p) => p.title).join(', ')}.`);
    }
    const p = pubs.find((x) => x.path.toLowerCase() === want || x.title.toLowerCase() === want || x.masthead.toLowerCase() === want) ?? pubs.find((x) => x.title.toLowerCase().includes(want) || x.masthead.toLowerCase().includes(want) || want.includes(x.title.toLowerCase()));
    if (!p) throw new Error(`There’s no publication called “${S(name, 200)}”.${pubs.length ? ` There are: ${pubs.map((x) => x.title).join(', ')}.` : ''}`);
    return p;
  }

  /** Find-first before making one (9.5: "Weeknd Post" set up a second paper beside "Weekend Post"): the one close
   *  name is reused, two close names are asked about, otherwise it is made. */
  private async reuseOrMake(pubs: Publication[], asked: string, by: string): Promise<string> {
    const names = pubs.flatMap((x) => [x.title, x.masthead].map((n) => ({ n, path: x.path })));
    const paths = [...new Set(closeTitles(names.map((x) => x.n), asked).map((n) => names.find((x) => x.n === n)!.path))];
    if (paths.length > 1) throw new Error(`Did you mean ${paths.map((p) => `“${pubs.find((x) => x.path === p)!.title}”`).join(' or ')}?`);
    if (paths.length === 1) return paths[0]!;
    return this.createPublication({ title: asked }, by);
  }

  private itemView(it: Item, editions: Edition[], items: Item[]): ItemView {
    const ran = editions.filter((e) => e.sections.some((s) => s.items.some((t) => findItem(items, t, e.path)?.path === it.path)));
    const p = it.puzzle;
    const pz = p ? (p.kind === 'crossword' ? `${p.width}×${p.height}, ${p.across.length + p.down.length} clues` : p.kind === 'sudoku' ? `${p.difficulty}, ${p.clues} given` : p.kind === 'wordsearch' ? `${p.size}×${p.size}, ${p.words.length} words` : `${p.length} letters, ${p.guesses.length} guesses`) : null;
    return { path: it.path, kind: it.kind, kindName: kindInfo(it.kind)?.name ?? 'Piece', headline: it.headline, section: it.section, source: it.source, credit: it.credit, date: it.date, image: it.image, lead: it.lead, words: it.body.split(/\s+/).filter(Boolean).length, editions: sortEditions(ran).map(editionLabel), puzzle: pz, problems: p ? checkPuzzle(p) : [], solves: it.solves.length };
  }

  private editionView(e: Edition, items: Item[], filed = ''): EditionView {
    const pieces = e.sections.reduce((a, s) => a + s.items.filter((t) => findItem(items, t, e.path)).length, 0);
    const last = e.delivery.at(-1);
    return { path: e.path, label: editionLabel(e), number: e.number, date: e.date, status: e.status, preview: e.preview, pdf: e.pdf ? this.fileRel(e.pdf, e.path) : filed, pages: e.pages, lead: e.lead || this.leadOf(e, items), pieces, delivered: last ? `${last.how}: ${last.result}` : '', template: e.template, imported: e.imported };
  }

  private leadOf(e: Edition, items: Item[]): string {
    for (const s of e.sections)
      for (const t of s.items) {
        const it = findItem(items, t, e.path);
        if (it?.lead) return it.headline;
      }
    const first = e.sections[0]?.items.map((t) => findItem(items, t, e.path)).find((i) => i?.kind === 'story');
    return first?.headline ?? '';
  }

  /** A file a note links to, as a path from the top of the vault. */
  private fileRel(target: string, from: string): string {
    const t = target.replace(/^\[\[|\]\]$/g, '');
    return this.d.index.resolveFile(t, from) ?? this.d.index.resolveAny(t, from) ?? t;
  }

  async areaFolder(): Promise<string> {
    let text: string | null = null;
    try {
      text = await fsp.readFile(path.join(this.root(), ...AREAS_FILE.split('/')), 'utf8');
    } catch {
      text = null;
    }
    return readAreas(text).config?.areas.find((a) => a.id === 'publications')?.folder ?? 'Publications';
  }

  async state(pubPath?: string): Promise<PubState> {
    const on = this.on();
    const base = { on, puzzlesOn: this.part('puzzles'), deliveryOn: this.part('delivery'), canSend: !!this.d.deliver };
    if (!on) return { ...base, publications: [], waiting: [], current: null };
    const all = this.read();
    const summaries = all.pubs.map((p) => ({ path: p.path, title: p.title, masthead: p.masthead, ready: p.ready, editions: this.ofPub(p, all).editions.length }));
    const waiting = all.pubs.filter((p) => !p.ready).map((p) => ({ path: p.path, title: p.title }));
    const pub = all.pubs.find((p) => p.path === pubPath) ?? all.pubs.find((p) => p.ready) ?? all.pubs[0];
    if (!pub) return { ...base, publications: summaries, waiting, current: null };
    const mine = this.ofPub(pub, all);
    // An edition without a PDF of its own shows the one filed for it elsewhere in the vault (the asset store, a download).
    const files = mine.editions.some((e) => !e.pdf) ? await this.d.files().catch(() => []) : [];
    const filed = (e: Edition) => (e.pdf ? '' : filedEditionPdf(pub, e, files)?.path ?? '');
    const editions = mine.editions.map((e) => this.editionView(e, mine.items, filed(e)));
    const nextAt = nextRun(pub.schedule, this.now());
    let next: NonNullable<PubState['current']>['next'] = null;
    if (nextAt) {
      const day = isoOf(nextAt);
      const ed = mine.editions.find((e) => e.date === day && !e.preview);
      next = { at: nextAt.toISOString(), words: `${shortDate(day)}, ${timeWords(pub.schedule!.time)}`, edition: ed ? this.editionView(ed, mine.items) : null };
    }
    return {
      ...base,
      publications: summaries,
      waiting,
      current: { pub, scheduleWords: scheduleWords(pub.schedule), next, editions, items: mine.items.map((i) => this.itemView(i, mine.editions, mine.items)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.headline.localeCompare(b.headline)), board: solveBoard(mine.items) },
    };
  }

  private find(rel: string): { pub: Publication; edition: Edition; editions: Edition[]; items: Item[] } {
    const all = this.read();
    const edition = all.editions.find((e) => e.path === rel);
    if (!edition) throw new Error('That edition isn’t there any more.');
    const pub = all.pubs.find((p) => this.belongs(p, edition));
    if (!pub) throw new Error(`The publication “${edition.publication || '?'}” this edition belongs to isn’t in the vault.`);
    const mine = this.ofPub(pub, all);
    return { pub, edition, editions: mine.editions, items: mine.items };
  }

  /** An edition's sections in the publication's order, each with its budget and its pieces (sections the edition adds of
   *  its own go after; an empty section is left out of the pages, except the front). */
  private docSections(pub: Publication, e: Edition, items: Item[]): { name: string; pages: number; sources: string; rules: string; items: Item[]; missing: string[] }[] {
    const out: { name: string; pages: number; sources: string; rules: string; items: Item[]; missing: string[] }[] = [];
    const used = new Set<string>();
    const resolve = (list: string[]) => {
      const found: Item[] = [];
      const missing: string[] = [];
      for (const t of list) {
        const it = findItem(items, t, e.path);
        if (it) found.push(it);
        else missing.push(t);
      }
      return { found, missing };
    };
    for (const s of pub.sections) {
      const es = e.sections.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
      if (es) used.add(es.name.toLowerCase());
      const r = resolve(es?.items ?? []);
      out.push({ name: s.name, pages: s.pages, sources: s.sources, rules: s.rules, items: r.found, missing: r.missing });
    }
    for (const es of e.sections) {
      if (used.has(es.name.toLowerCase())) continue;
      const r = resolve(es.items);
      out.push({ name: es.name, pages: 1, sources: '', rules: '', items: r.found, missing: r.missing });
    }
    // The lead goes on page 1 whatever section it was put in (26 Oct 2026: a lead filed under News left the front page a
    // masthead and a weather line). With no lead marked and no story on the front, the first story of the paper leads.
    const front = out[0];
    if (front && !front.items.some((it) => it.kind === 'story' && it.lead)) {
      const pick = (want: (it: Item) => boolean) => { for (const sec of out.slice(1)) { const i = sec.items.findIndex(want); if (i >= 0) return sec.items.splice(i, 1)[0]!; } return null; };
      const lead = pick((it) => it.kind === 'story' && it.lead) ?? (front.items.some((it) => it.kind === 'story') ? null : pick((it) => it.kind === 'story'));
      if (lead) front.items.unshift({ ...lead, lead: true });
    }
    return out;
  }

  async edition(rel: string): Promise<EditionDetail> {
    this.need();
    const { pub, edition, editions, items } = this.find(rel);
    const secs = this.docSections(pub, edition, items);
    const prev = previousEdition(editions, edition);
    const answers = prev ? answersFrom(prev, items) : [];
    const shown = secs.filter((s, i) => i === 0 || s.items.length);
    const t = templateOf(edition.template || pub.template.id);
    const estimate = estimateFit(shown.map((s) => ({ name: s.name, pages: s.pages, items: s.items.map(fitItemOf) })), t);
    return {
      edition: { ...this.editionView(edition, items), notes: edition.notes, delivery: edition.delivery },
      pub,
      sections: secs.map((s) => ({ ...s, items: s.items.map((i) => this.itemView(i, editions, items)) })),
      answers: prev && answers.length ? { from: editionLabel(prev), count: answers.length } : null,
      estimate,
      estimateWords: fitWords(estimate),
    };
  }

  // ── The pages ────────────────────────────────────────────────────────────────────────────────────────────────────

  private url = (rel: string): string => {
    const file = this.abs(rel);
    return existsSync(file) ? pathToFileURL(file).href : '';
  };

  private async doc(rel: string, mode: 'studio' | 'print', picked?: string): Promise<{ html: string; pub: Publication; edition: Edition; items: Item[] }> {
    const { pub, edition, editions, items } = this.find(rel);
    const secs = this.docSections(pub, edition, items).filter((s, i) => i === 0 || s.items.length);
    const prev = previousEdition(editions, edition);
    const blocks = prev ? answersFrom(prev, items) : [];
    // Pictures and fonts named in the notes, found where the links say.
    const fix = (it: Item): Item => (it.image ? { ...it, image: this.fileRel(it.image, it.path) } : it);
    const style = { ...pub.style, mastheadFont: pub.style.mastheadFont && this.fileRel(pub.style.mastheadFont, pub.path), headFont: pub.style.headFont && this.fileRel(pub.style.headFont, pub.path), bodyFont: pub.style.bodyFont && this.fileRel(pub.style.bodyFont, pub.path), bodyFaces: pub.style.bodyFaces.map((f) => this.fileRel(f, pub.path)), crest: pub.style.crest && this.fileRel(pub.style.crest, pub.path) };
    // A body font's other faces beside it, when none are named (Bold and Italic files of the same family).
    if (style.bodyFont && !style.bodyFaces.length) {
      const fam = baseOf(style.bodyFont).replace(/\.[^.]+$/, '').split(/[-_ ]/)[0]!.toLowerCase();
      const dir = style.bodyFont.includes('/') ? style.bodyFont.slice(0, style.bodyFont.lastIndexOf('/')) : '';
      style.bodyFaces = (await this.d.files()).filter((f) => f.path !== style.bodyFont && /\.(ttf|otf|woff2?)$/i.test(f.path) && (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '') === dir && baseOf(f.path).toLowerCase().startsWith(fam)).map((f) => f.path);
    }
    const sections: DocSection[] = secs.map((s) => ({ name: s.name, pages: s.pages, items: s.items.map(fix) }));
    const input = { pub: { title: pub.title, masthead: pub.masthead, motto: pub.motto, style }, number: edition.number, date: edition.date, preview: edition.preview, template: templateOf(edition.template || pub.template.id), sections, answers: blocks.length && prev ? { from: editionLabel(prev), blocks } : null, url: this.url, appFonts: await this.d.appFonts(), mode, ...(picked ? { picked } : {}) };
    // The publication's own layout, when it has one (made from the person's example): the edition is poured into it.
    const own = `${pub.folder}/${LAYOUT_FILE}`;
    const layout = existsSync(this.abs(own)) ? await fsp.readFile(this.abs(own), 'utf8').catch(() => '') : '';
    const html = layout ? layoutDocument(layout, input, `${this.url(`${pub.folder}/Layout`)}/`) : editionDocument(input);
    return { html, pub, edition, items };
  }

  /** The edition's pages staged for the studio's frame. */
  async preview(rel: string, picked?: string): Promise<{ url: string }> {
    this.need();
    const { html } = await this.doc(rel, 'studio', picked);
    return { url: await this.d.printer.stage(html, `${baseOf(rel)}`) };
  }

  /** The edition laid out and printed to a PDF, kept with it (a new version when there was one), its note brought up to
   *  date (pdf, pages, Built). */
  async build(rel: string, by = 'you'): Promise<{ pdf: string; laidOut: LaidOut; words: string }> {
    this.need();
    await this.d.requireCreate();
    const { html, pub, edition, items } = await this.doc(rel, 'print');
    // Never a bare masthead: an edition with nothing in its sections isn't printed (26 Oct 2026, the No. 3).
    if (!edition.sections.some((sec) => sec.items.some((t) => findItem(items, t, rel)))) throw new Error(`${pub.title} ${editionLabel(edition)} has no stories or pieces in its sections yet, so there is nothing to print. Add its pieces, then build it.`);
    const { pdf, laidOut } = await this.d.printer.pdf(html);
    const tmp = path.join(os.tmpdir(), `nv-edition-${process.pid}-${Date.now()}.pdf`);
    await fsp.writeFile(tmp, pdf);
    const name = `${fileName(`${pub.masthead} ${editionLabel(edition)} ${edition.date ?? ''}`)}.pdf`;
    let placed: { rel: string; version: number };
    try {
      placed = await this.d.placeFile({ record: rel, src: tmp, name, by, what: `${pub.masthead}, ${editionLabel(edition)}, ${longDate(edition.date)}: ${plural(laidOut.pages, 'page')}.` });
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
    let text = this.d.index.content(rel) ?? (await fsp.readFile(this.abs(rel), 'utf8'));
    text = setNoteProp(text, 'pdf', `[[${placed.rel}]]`);
    text = setNoteProp(text, 'pages', laidOut.pages);
    // A rebuild starts it over at Built (9.5: a rebuild after delivery kept Delivered, so it could go out twice).
    text = setNoteProp(text, 'status', 'Built');
    await this.d.writeNote(rel, text, by);
    this.d.changed();
    const titleOf = (id: string) => findItem(items, id)?.headline ?? (id === 'answers' ? 'Answers' : baseOf(id).replace(/\.md$/, ''));
    return { pdf: placed.rel, laidOut, words: `Built ${editionLabel(edition)}${placed.version > 1 ? ` (version ${placed.version}; the one before is kept)` : ''}: ${laidOutWords(laidOut, titleOf)}` };
  }

  /** A copy of the edition's PDF saved where the person picks. */
  async exportPdf(rel: string): Promise<string | null> {
    this.need();
    const { edition, pub } = this.find(rel);
    let pdf = edition.pdf ? this.fileRel(edition.pdf, rel) : '';
    if (!pdf || !existsSync(this.abs(pdf))) pdf = (await this.build(rel)).pdf;
    const to = await this.d.pickSave({ title: 'Save a copy of the edition', name: `${fileName(`${pub.masthead} ${editionLabel(edition)} ${edition.date ?? ''}`)}.pdf` });
    if (!to) return null;
    await fsp.copyFile(this.abs(pdf), to);
    return to;
  }

  async printers(): Promise<PrinterInfo[]> {
    return this.d.printer.printers();
  }

  /** Sent and printed now: the ways the publication is set to (or those asked for). Each line goes in its delivery log. */
  async deliver(rel: string, how?: string[], by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    let { pub, edition } = this.find(rel);
    const ways = how?.length ? how.map((w) => S(w, 60)) : deliveryWays(pub).map((w) => w.id);
    if (!ways.length) throw new Error(`${pub.title} isn’t set to be sent or printed. Choose email or a printer in Publications › Settings › Delivery.`);
    let pdf = edition.pdf ? this.fileRel(edition.pdf, rel) : '';
    if (!pdf || !existsSync(this.abs(pdf))) {
      // Made elsewhere and filed in the vault (an agent, a download): that is this edition, linked to its note, never a
      // second one built beside it.
      const filed = filedEditionPdf(pub, edition, await this.d.files().catch(() => []));
      if (filed) {
        let text = this.text(rel);
        text = setNoteProp(text, 'pdf', `[[${filed.path}]]`);
        if (edition.status === 'Draft') text = setNoteProp(text, 'status', 'Built');
        await this.d.writeNote(rel, text, by);
        this.d.changed();
        pdf = filed.path;
      } else pdf = (await this.build(rel, by)).pdf;
      ({ pub, edition } = this.find(rel));
    }
    const when = `${isoOf(this.now())} ${this.now().toTimeString().slice(0, 5)}`;
    const caption = `${pub.masthead} · ${editionLabel(edition)} · ${longDate(edition.date)}`;
    const version = ways.some(w => ['telegram', 'email'].includes(w.toLowerCase())) && this.d.deliver ? await this.d.fileVersion(pdf) : null;
    const rows: DeliveryRow[] = [];
    let sent = false;
    let printed = false;
    for (const w of ways) {
      const id = w.toLowerCase();
      if (id !== 'telegram' && id !== 'email' && id !== 'print') {
        // A way named that sends nothing is said, never silently skipped (9.5).
        rows.push({ when, how: w || '—', to: '—', result: 'Not sent: Ironleaf sends by email and print' });
        continue;
      }
      if (id === 'telegram') {
        if (!this.d.deliver) rows.push({ when, how: 'Telegram', to: 'the chat', result: 'Not sent: nothing is connected to send it by Telegram.' });
        else {
          const r = await this.d.deliver({ channel: 'telegram', file: this.abs(pdf), caption }).catch((e) => ({ ok: false, words: e instanceof Error ? e.message : String(e) }));
          rows.push({ when, how: 'Telegram', to: 'the chat', result: r.ok ? 'Sent' : `Not sent: ${r.words}` });
          sent ||= r.ok;
        }
      } else if (id === 'email') {
        if (!pub.delivery.email.length) rows.push({ when, how: 'Email', to: '—', result: 'Not sent: no email address is set (Publications › Settings › Delivery).' });
        else if (!this.d.deliver) rows.push({ when, how: 'Email', to: pub.delivery.email.join(', '), result: 'Not sent: no mail is connected to send it.' });
        else {
          const r = await this.d.deliver({ channel: 'email', file: this.abs(pdf), caption, subject: caption, to: pub.delivery.email }).catch((e) => ({ ok: false, words: e instanceof Error ? e.message : String(e) }));
          rows.push({ when, how: 'Email', to: pub.delivery.email.join(', '), result: r.ok ? 'Sent' : `Not sent: ${r.words}` });
          sent ||= r.ok;
        }
      } else if (id === 'print') {
        try {
          const { html } = await this.doc(rel, 'print');
          await this.d.printer.print(html, { printer: pub.delivery.printer, copies: pub.delivery.copies });
          rows.push({ when, how: 'Printed', to: pub.delivery.printer, result: `${plural(pub.delivery.copies, 'copy', 'copies')} sent to the printer` });
          printed = true;
        } catch (e) {
          rows.push({ when, how: 'Printed', to: pub.delivery.printer || '—', result: `Not printed: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    }
    let text = this.d.index.content(rel) ?? (await fsp.readFile(this.abs(rel), 'utf8'));
    for (const r of rows) {
      const receipt = r.result === 'Sent' ? { ...r, result: r.result + ' · ' + pdf + ' · version ' + version } : r;
      text = withDeliveryRow(text, receipt);
    }
    if (printed) text = setNoteProp(text, 'status', 'Printed');
    else if (sent && edition.status !== 'Printed') text = setNoteProp(text, 'status', 'Delivered');
    await this.d.writeNote(rel, text, by);
    this.d.changed();
    return rows.map((r) => `${r.how}${r.to && r.to !== '—' ? ` (${r.to})` : ''}: ${r.result}.`).join(' ');
  }

  // ── Writing: publications, sections, editions ───────────────────────────────────────────────────────────────────

  private async freeNote(folder: string, name: string): Promise<string> {
    const base = fileName(name);
    for (let i = 1; i < 1000; i++) {
      const rel = `${folder ? `${folder}/` : ''}${i === 1 ? base : `${base} ${i}`}.md`;
      if (!(await this.d.exists(rel))) return rel;
    }
    throw new Error('No free name was found for that note.');
  }
  private text(rel: string): string {
    const t = this.d.index.content(rel.replace(/(\.md)#[^#]*$/i, '$1'));
    if (t === undefined) throw new Error('That note isn’t there any more.');
    return t;
  }

  async createPublication(input: PublicationInput, by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    const title = fileName(S(input.title, 80));
    if (!S(input.title, 80)) throw new Error('Give the publication a name.');
    const folder = `${await this.areaFolder()}/${title}`;
    const rel = `${folder}/${title}.md`;
    if (await this.d.exists(rel)) throw new Error(`There’s already a publication called ${title}.`);
    await this.d.writeNote(rel, newPublicationText({ ...input, title }), by);
    this.d.changed();
    return rel;
  }

  /** A publication's settings changed where they are shown (anything not given stays as written). */
  /** A page made to look like the person's own example kept as the publication's layout (Layout/edition.html), with the
   *  fonts and pictures it uses beside it: every edition after is poured into it (layoutDocument). The page marks where
   *  this edition's words go (<!--nv:section:News-->, <!--nv:lead-->, <!--nv:masthead-->…); a page without them would print the same words
   *  every time, so it is refused. */
  async keepLayout(o: { publication?: string; page: string }, by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    // The paper named, made a publication when it isn't one yet (its sections and schedule are set after, by asking).
    const asked = S(o.publication, 200).trim();
    let pub: Publication;
    try {
      pub = this.pick(this.read().pubs, o.publication);
    } catch (e) {
      if (!asked) throw e;
      const made = await this.reuseOrMake(this.read().pubs, asked, by);
      pub = this.pick(this.read().pubs, made);
    }
    const page = path.resolve(String(o.page || ''));
    if (!/\.x?html?$/i.test(page) || !existsSync(page)) throw new Error('Give the finished .html page to keep as the layout.');
    const html = await fsp.readFile(page, 'utf8');
    if (!/<!--\s*nv:(section:[^>]+|lead|kind:[^>]+)\s*-->/i.test(html)) throw new Error('Mark where each edition’s words go before keeping it: <!--nv:section:Name--> for each section’s stories, <!--nv:lead--> for the lead, <!--nv:masthead-->, <!--nv:number--> and <!--nv:date--> in the masthead.');
    const dir = path.join(this.abs(pub.folder), 'Layout');
    await fsp.mkdir(dir, { recursive: true });
    // The files it names beside it (fonts, crest, pictures), copied with their places kept; addresses elsewhere stay.
    const from = path.dirname(page);
    const named = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']|url\(\s*["']?([^"')#?]+)["']?\s*\)/gi)) {
      const ref = decodeURIComponent((m[1] ?? m[2] ?? '').trim());
      if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('<!--')) continue;
      const abs = path.resolve(from, ref);
      if (abs.startsWith(from + path.sep) && existsSync(abs)) named.add(path.relative(from, abs));
    }
    for (const rel of named) {
      await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fsp.copyFile(path.join(from, rel), path.join(dir, rel));
    }
    await fsp.writeFile(path.join(dir, 'edition.html'), html, 'utf8');
    this.d.changed();
    this.d.log?.(`layout kept for ${pub.title} by ${by}: ${named.size} files`);
    return `${pub.title} now has its own layout (${pub.folder}/Layout/edition.html${named.size ? `, with ${named.size} file${named.size === 1 ? '' : 's'} it uses` : ''}). Every edition is built into it: add the edition’s pieces, then build.`;
  }

  /** A house file (crest, font) checked before it is kept: a real file, and for the crest a real picture by its
   *  bytes, never its name (9.5: a link was stored and silently broke; anything was stored). */
  private async houseFile(v: unknown, label: string, image: boolean): Promise<string | null> {
    const ref = S(v, 600).trim().replace(/^\[\[|\]\]$/g, '');
    if (!ref) return null;
    if (/^https?:\/\//i.test(ref)) throw new Error(`${label} needs to be a file in the vault or on this PC, not a link.`);
    const abs = path.isAbsolute(ref) ? ref : this.abs(ref);
    if (!existsSync(abs)) throw new Error(`${label} “${ref}” can’t be found.`);
    if (image) {
      const head = await fsp.readFile(abs).then((b) => b.subarray(0, 2048)).catch(() => null);
      const fmt = head ? sniffImage(head) : null;
      if (fmt === 'tiff') throw new Error(`“${ref}” is a TIF, which doesn’t print. Export it as a PNG first.`);
      if (fmt === 'heic') throw new Error(`“${ref}” is an iPhone photo (HEIC), which doesn’t print. Export it as a JPEG first.`);
      if (!fmt) throw new Error(`“${ref}” isn’t a picture Ironleaf can print (PNG, JPEG, GIF, WebP, AVIF, BMP or SVG).`);
    }
    return `[[${ref}]]`;
  }

  async setPublication(rel: string, patch: Record<string, unknown>, by = 'you'): Promise<void> {
    this.need();
    await this.d.requireCreate();
    let text = this.text(rel);
    const put = (k: string, v: string | number | null) => (text = setNoteProp(text, k, v === '' ? null : v));
    for (const [k, v] of Object.entries(patch ?? {})) {
      switch (k) {
        case 'masthead':
        case 'motto':
        case 'printer':
          put(k, S(v, 200));
          break;
        case 'schedule': {
          const s = readSchedule(v);
          if (S(v, 200) && !s) throw new Error('Write the schedule as days and a time, like “Mon, Fri 07:00” or “Weekdays 6:30”.');
          put('schedule', s ? scheduleText(s) : null);
          break;
        }
        case 'template':
          put('template', templateOf(v).name);
          break;
        case 'print':
        case 'telegram':
        case 'greyscale':
        case 'justify':
          put(k, v === true || /^(yes|true|on)$/i.test(String(v)) ? 'Yes' : 'No');
          break;
        case 'email': {
          const list = (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((x) => S(x, 200)).filter(Boolean);
          const bad = list.filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
          if (bad.length) throw new Error(`${bad.join(', ')} ${bad.length === 1 ? 'isn’t an email address' : 'aren’t email addresses'}.`);
          put('email', list.join(', '));
          break;
        }
        case 'copies':
          put('copies', Math.max(1, Math.min(20, Math.round(Number(v) || 1))));
          break;
        case 'ink':
          if (S(v) && !/^#[0-9a-f]{6}$/i.test(S(v))) throw new Error('Give the ink as a colour like #1a1a1a.');
          put('ink', S(v));
          break;
        case 'masthead_font':
        case 'head_font':
        case 'body_font':
          put(k, await this.houseFile(v, 'The font', false));
          break;
        case 'crest':
          put(k, await this.houseFile(v, 'The crest', true));
          break;
      }
    }
    await this.d.writeNote(rel, text, by);
    this.d.changed();
  }

  async setSections(rel: string, sections: Section[], by = 'you'): Promise<void> {
    this.need();
    await this.d.requireCreate();
    const clean = (Array.isArray(sections) ? sections : [])
      .map((s) => ({ name: S(s?.name, 60), pages: Math.max(0.5, Math.min(40, Math.round((Number(s?.pages) || 1) * 2) / 2)), sources: S(s?.sources, 400), rules: S(s?.rules, 600) }))
      .filter((s) => s.name);
    if (!clean.length) throw new Error('A publication needs at least one section.');
    const names = new Set<string>();
    for (const s of clean) {
      if (names.has(s.name.toLowerCase())) throw new Error(`There are two sections called ${s.name}.`);
      names.add(s.name.toLowerCase());
    }
    await this.d.writeNote(rel, withSections(this.text(rel), clean), by);
    this.d.changed();
  }

  /** A picture (a crest, a font file) from this PC copied into the publication's folder. */
  async pickFile(pubRel: string, kind: 'picture' | 'font'): Promise<string | null> {
    this.need();
    await this.d.requireCreate();
    const pub = this.pick(this.read().pubs, pubRel);
    const [file] = await this.d.pickFiles(kind === 'font' ? { title: 'Choose a font file', filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }], multi: false } : { title: 'Choose a picture', filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }], multi: false });
    if (!file) return null;
    const [rel] = await this.d.copyIn([file], `${pub.folder}/${kind === 'font' ? 'Fonts' : 'Pictures'}`);
    return rel ?? null;
  }

  async newEdition(pubRel: string, o: { date?: string; number?: number; copyFrom?: string } = {}, by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    const all = this.read();
    const pub = this.pick(all.pubs, pubRel);
    const mine = this.ofPub(pub, all);
    const next = nextRun(pub.schedule, this.now());
    const date = isoDay(o.date) ?? (next ? isoOf(next) : isoOf(this.now()));
    const sameDay = mine.editions.find((e) => e.date === date && !e.preview);
    if (sameDay) throw new Error(`${pub.title} already has an edition for ${date} (No. ${sameDay.number ?? '?'}, ${sameDay.path}). Open that one instead of making another.`);
    const number = Number.isFinite(Number(o.number)) && Number(o.number) > 0 ? Math.round(Number(o.number)) : nextNumber(mine.editions);
    if (mine.editions.some((e) => e.number === number && !e.preview)) throw new Error(`${pub.title} already has a No. ${number}.`);
    // The puzzles section keeps nothing from before; a copy keeps the last edition's regular pieces (weather, quote…)
    // only when asked.
    const from = o.copyFrom ? mine.editions.find((e) => e.path === o.copyFrom) : null;
    const rel = await this.freeNote(editionsFolder(pub), editionFileName(number, date));
    // Copied pieces are copied into the new note (an edition is one note, 27 Oct 2026).
    const blocks = new Map<string, string[]>();
    const sections = pub.sections.map((s) => ({
      name: s.name,
      items: (from?.sections.find((x) => x.name.toLowerCase() === s.name.toLowerCase())?.items ?? [])
        .map((t) => findItem(mine.items, t, from!.path))
        .filter((it): it is Item => !!it && !it.puzzle)
        .map((it) => {
          const id = pieceId(rel, it.headline);
          blocks.set(id, pieceBlock(itemInputOf(it)));
          return id;
        }),
    }));
    await this.d.writeNote(rel, newEditionText(pub, { number, date, template: pub.template.name, sections, blocks }), by);
    this.d.changed();
    return rel;
  }

  async setEdition(rel: string, patch: { sections?: { name: string; items: string[] }[]; template?: string; date?: string; number?: number; status?: string; notes?: string }, by = 'you'): Promise<void> {
    this.need();
    await this.d.requireCreate();
    let text = this.text(rel);
    if (patch.sections) {
      const clean = patch.sections
        .slice(0, 40)
        .map((s) => ({ name: S(s?.name, 60), items: (Array.isArray(s?.items) ? s.items : []).map((x) => S(x, 600)).filter(Boolean).slice(0, 200) }))
        .filter((s) => s.name);
      // A piece of another edition put in this one is copied in (an edition is one note, 27 Oct 2026).
      const items = this.read().items;
      const copies = new Map<string, string[]>();
      for (const sec of clean)
        sec.items = sec.items.map((t) => {
          if (!isPieceId(t) || t.startsWith(`${rel}#`)) return t;
          const it = findItem(items, t);
          if (!it) return t;
          const id = pieceId(rel, it.headline);
          copies.set(id, pieceBlock(itemInputOf(it)));
          return id;
        });
      text = withEditionSections(text, clean, rel, copies);
    }
    if (patch.template !== undefined) text = setNoteProp(text, 'template', templateOf(patch.template).name);
    if (patch.date !== undefined) {
      const d = isoDay(patch.date);
      if (!d) throw new Error('Give the day as YYYY-MM-DD.');
      text = setNoteProp(text, 'date', d);
    }
    if (patch.number !== undefined) {
      const n = Math.round(Number(patch.number));
      if (!(n > 0)) throw new Error('Give the edition a number.');
      text = setNoteProp(text, 'number', n);
    }
    if (patch.status !== undefined) text = setNoteProp(text, 'status', ['Draft', 'Built', 'Delivered', 'Printed'].find((s) => s.toLowerCase() === S(patch.status).toLowerCase()) ?? 'Draft');
    if (patch.notes !== undefined) text = withEditionNotes(text, S(patch.notes, 4000));
    await this.d.writeNote(rel, text, by);
    this.d.changed();
  }

  // ── Pieces and puzzles ──────────────────────────────────────────────────────────────────────────────────────────

  private cleanItem(i: Partial<ItemInput> & Record<string, unknown>): ItemInput {
    return {
      kind: readKind(i.kind) ?? 'story',
      headline: S(i.headline, 300),
      section: S(i.section, 60),
      body: typeof i.body === 'string' ? i.body.slice(0, 40000) : '',
      deck: S(i.deck, 400),
      source: S(i.source, 200),
      sourceUrl: S(i.sourceUrl ?? i.source_url, 600),
      credit: S(i.credit, 200),
      who: S(i.who, 200),
      image: S(i.image, 600),
      lead: i.lead === true || /^(yes|true)$/i.test(String(i.lead ?? '')),
      date: isoDay(i.date) ?? isoOf(this.now()),
      puzzle: (i.puzzle as Puzzle | undefined) ?? null,
    };
  }

  /** A piece kept in a publication's store (a section that names its sources takes only those). */
  /** A piece put in its day's edition (27 Oct 2026: kept inside the edition's note, never a note of its own; the day's
   *  edition is made when there is none yet). A piece with the same headline in that edition is replaced. */
  async addItem(pubRel: string, raw: Partial<ItemInput> & Record<string, unknown>, by = 'you', pub0?: Publication, into?: string): Promise<string> {
    this.need();
    await this.d.requireCreate();
    const pub = pub0 ?? this.pick(this.read().pubs, pubRel);
    const i = this.cleanItem(raw);
    if (!i.headline) throw new Error(`A piece needs a headline (or title).`);
    const section = pub.sections.find((s) => s.name.toLowerCase() === (i.section ?? '').toLowerCase());
    if (i.section && !section) throw new Error(`${pub.title} has no section called ${i.section}. Its sections: ${pub.sections.map((s) => s.name).join(', ')}.`);
    if (!kindInfo(i.kind)?.puzzle && ['story', 'brief'].includes(i.kind)) {
      const why = sourceProblem(section, i.source ?? '');
      if (why) throw new Error(why);
    }
    const table = tableProblem({ kind: i.kind, headline: i.headline, body: i.body });
    if (table) throw new Error(table);
    // A picture made on this PC (the cartoon strip from the picture tool) is copied into the publication's Pictures.
    if (i.image && path.isAbsolute(i.image) && existsSync(i.image)) i.image = (await this.d.copyIn([i.image], `${pub.folder}/Pictures`))[0] ?? i.image;
    if (i.image && !(await this.d.exists(this.fileRel(i.image, pub.path)))) throw new Error(`The picture ${i.image} isn’t in the vault or on this PC.`);
    const date = i.date ?? isoOf(this.now());
    const rel = into ?? this.dayEdition(pub, date) ?? (await this.newEdition(pub.path, { date }, by));
    const ed = readEdition({ path: rel, title: baseOf(rel), props: {}, content: this.text(rel) });
    const id = pieceId(rel, i.headline);
    const sections = pub.sections.map((s) => ({ name: s.name, items: (ed.sections.find((x) => x.name.toLowerCase() === s.name.toLowerCase())?.items ?? []).filter((t) => t !== id) }));
    for (const x of ed.sections) if (!sections.some((s) => s.name.toLowerCase() === x.name.toLowerCase())) sections.push({ name: x.name, items: x.items.filter((t) => t !== id) });
    const target = sections.find((s) => s.name.toLowerCase() === (i.section || (i.lead ? sections[0]?.name : sections.at(-1)?.name) || '').toLowerCase()) ?? sections.at(-1)!;
    const was = ed.sections.find((s) => s.items.includes(id));
    const at = was && was.name.toLowerCase() === target.name.toLowerCase() ? was.items.indexOf(id) : -1;
    if (at >= 0) target.items.splice(at, 0, id);
    else target.items.push(id);
    await this.d.writeNote(rel, withEditionSections(this.text(rel), sections, rel, new Map([[id, pieceBlock({ ...i, section: target.name, date })]])), by);
    this.d.changed();
    return id;
  }

  /** Older editions' links to item notes, folded into the editions as pieces (27 Oct 2026: an edition is one note). An
   *  item note every edition that named it now holds goes to the vault's bin, where it can be brought back; one no
   *  edition names stays a note. */
  async foldItems(by = 'Ironleaf'): Promise<number> {
    if (!this.on()) return 0;
    const all = this.read();
    const legacy = all.items.filter((i) => !isPieceId(i.path));
    if (!legacy.length) return 0;
    const used = new Set<string>();
    let folded = 0;
    for (const e of all.editions) {
      const blocks = new Map<string, string[]>();
      const sections = e.sections.map((s) => ({
        name: s.name,
        items: s.items.map((t) => {
          if (isPieceId(t)) return t;
          const it = findItem(legacy, t, e.path);
          if (!it) return t;
          used.add(it.path);
          const id = pieceId(e.path, it.headline);
          blocks.set(id, pieceBlock(itemInputOf(it)));
          return id;
        }),
      }));
      if (!blocks.size) continue;
      await this.d.writeNote(e.path, withEditionSections(this.text(e.path), sections, e.path, blocks), by);
      folded++;
    }
    if (this.d.trash) for (const rel of used) await this.d.trash(rel).catch(() => {});
    if (folded) this.d.changed();
    return folded;
  }

  /** The day's edition (the numbered one, the latest when there are several), or null. */
  private dayEdition(pub: Publication, date: string): string | null {
    const day = this.ofPub(pub, this.read()).editions.filter((e) => e.date === date && !e.preview).sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
    return day[0]?.path ?? null;
  }

  /** A picture from this PC for a piece, copied into the publication's Pictures folder. */
  async pickPicture(pubRel: string): Promise<string | null> {
    return this.pickFile(pubRel, 'picture');
  }

  /** A puzzle made (not kept yet): the person sees it, then keeps it. */
  makePuzzle(input: Record<string, unknown>): { puzzle: Puzzle; problems: string[]; words: string } {
    if (!this.part('puzzles')) throw new Error('The puzzle engine is switched off (Settings › Packs › Publications).');
    const kind = S(input.kind, 20).toLowerCase().replace(/[^a-z]/g, '');
    const words = Array.isArray(input.words) ? input.words.map((w) => S(w, 60)).filter(Boolean) : S(input.words, 4000).split(/[\n,;]+/).map((w) => w.trim()).filter(Boolean);
    const seed = typeof input.seed === 'number' ? input.seed : seedOf(`${kind} ${Date.now()} ${Math.random()}`);
    let puzzle: Puzzle;
    if (kind === 'crossword') {
      const clues = readClueLines(S(input.clues, 20000));
      if (clues.length < 3) throw new Error('A crossword needs at least three answers with clues, one per line: “ANSWER: clue”.');
      const missing = clues.filter((c) => !c.clue);
      if (missing.length) throw new Error(`Every answer needs a clue: ${missing.map((c) => c.answer).join(', ')} ${missing.length === 1 ? 'has' : 'have'} none.`);
      puzzle = makeCrossword(clues, { size: Number(input.size) || 15, seed });
    } else if (kind === 'sudoku') puzzle = makeSudoku({ difficulty: S(input.difficulty, 10) || 'medium', seed });
    else if (kind === 'wordsearch') {
      if (words.length < 3) throw new Error('A word search needs at least three words to hide.');
      puzzle = makeWordSearch(words, { ways: S(input.ways, 10) || 'easy', seed, ...(Number(input.size) ? { size: Number(input.size) } : {}) });
    } else if (kind === 'dailyword') puzzle = makeDailyWord({ answer: S(input.answer, 20) || undefined, words, seed });
    else throw new Error('Choose a crossword, sudoku, word search or daily word.');
    const problems = checkPuzzle(puzzle);
    const left = 'left' in puzzle && puzzle.left.length ? ` Left out: ${puzzle.left.join(', ')}.` : '';
    const said =
      puzzle.kind === 'crossword'
        ? `A ${puzzle.width}×${puzzle.height} crossword with ${plural(puzzle.across.length + puzzle.down.length, 'clue')}.${left}`
        : puzzle.kind === 'sudoku'
          ? `A ${puzzle.difficulty} sudoku with ${puzzle.clues} numbers given and exactly one answer.`
          : puzzle.kind === 'wordsearch'
            ? `A ${puzzle.size}×${puzzle.size} word search with ${plural(puzzle.words.length, 'word')}.${left}`
            : `A ${puzzle.length}-letter daily word with ${plural(puzzle.guesses.length, 'guess', 'guesses')}; ${puzzle.fits === 1 ? 'only the answer fits them' : `${puzzle.fits} words fit them`}.`;
    return { puzzle, problems, words: said };
  }

  /** A puzzle kept as a piece (its answers with it). */
  async savePuzzle(pubRel: string, o: { puzzle: Puzzle; title?: string; section?: string }, by = 'you', pub0?: Publication): Promise<string> {
    const pub = pub0 ?? this.pick(this.read().pubs, pubRel);
    const p = o.puzzle;
    if (!p || !['crossword', 'sudoku', 'wordsearch', 'dailyword'].includes(p.kind)) throw new Error('That isn’t a puzzle.');
    const problems = checkPuzzle(p);
    if (problems.length) throw new Error(`That puzzle isn’t sound: ${problems.slice(0, 3).join(' ')}`);
    const section = S(o.section, 60) || puzzleSectionName(pub.sections) || pub.sections.at(-1)?.name || '';
    const title = S(o.title, 120) || (kindInfo(p.kind)?.name ?? 'Puzzle');
    return this.addItem(pub.path, { kind: p.kind, headline: title, section, puzzle: p }, by, pub);
  }

  /** How long someone took (kept in the puzzle's note). */
  async solve(rel: string, o: { who?: unknown; time?: unknown; day?: unknown; note?: unknown }, by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    const it = this.read().items.find((i) => i.path === rel);
    if (!it?.puzzle) throw new Error('That isn’t a puzzle.');
    const who = S(o.who, 80);
    const seconds = readSolveTime(o.time);
    if (!who) throw new Error('Say who solved it.');
    if (!seconds) throw new Error('Give the time it took, like 12:30 or 4 min.');
    const day = isoDay(o.day) ?? isoOf(this.now());
    const solve = { who, seconds, day, note: S(o.note, 200) };
    if (isPieceId(rel)) {
      // A puzzle kept in its edition: the solve table in its block (its headings one level down there).
      const edRel = rel.replace(/(\.md)#[^#]*$/i, '$1');
      const text = this.text(edRel);
      const block = editionBlocks(text, edRel).get(rel);
      if (!block) throw new Error('That puzzle isn’t in its edition any more.');
      const solved = withSolve(block.join('\n').replace(/^#### /gm, '## '), solve).split(/\r?\n/).map((l) => l.replace(/^## /, '#### '));
      const ed = readEdition({ path: edRel, title: baseOf(edRel), props: {}, content: text });
      await this.d.writeNote(edRel, withEditionSections(text, ed.sections, edRel, new Map([[rel, solved]])), by);
    } else await this.d.writeNote(rel, withSolve(this.text(rel), solve), by);
    this.d.changed();
    const best = Math.min(...it.solves.filter((s) => s.who.toLowerCase() === who.toLowerCase()).map((s) => s.seconds), Infinity);
    return `${who}: ${kindInfo(it.kind)?.name ?? 'puzzle'} in ${solveTimeWords(seconds)}${seconds < best && best !== Infinity ? `, a new best (was ${solveTimeWords(best)})` : ''}.`;
  }

  // ── The archive ─────────────────────────────────────────────────────────────────────────────────────────────────

  private async pdfTexts(editions: Edition[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const e of editions) {
      if (!e.pdf) continue;
      const rel = this.fileRel(e.pdf, e.path);
      const file = this.abs(rel);
      const st = await fsp.stat(file).catch(() => null);
      if (!st) continue;
      const key = `${rel}:${st.size}:${st.mtimeMs}`;
      const had = this.pdfWords.get(e.path);
      if (had?.key === key) {
        out[e.path] = had.text;
        continue;
      }
      const text = (await this.d.readPdfText(file).catch(() => null)) ?? '';
      this.pdfWords.set(e.path, { key, text });
      out[e.path] = text;
    }
    return out;
  }

  async search(query: string, pubRel?: string, index: VaultIndex = this.d.index): Promise<SearchHit[]> {
    this.need();
    const all = this.read(index);
    const pubs = pubRel ? [this.pick(all.pubs, pubRel)] : all.pubs;
    const editions = all.editions.filter((e) => pubs.some((p) => this.belongs(p, e)));
    const items = all.items.filter((i) => pubs.some((p) => this.belongs(p, i)));
    return searchArchive(query, { editions, items, pdfText: await this.pdfTexts(editions) });
  }

  // ── Import: a publication note written before the module ───────────────────────────────────────────────────────

  async importPlan(rel: string): Promise<ImportPlan> {
    this.need();
    const meta = this.d.index.get(rel);
    if (!meta) throw new Error('That note isn’t there any more.');
    return planImport({ path: rel, title: meta.title, props: (meta.props ?? {}) as Record<string, unknown>, content: this.text(rel) }, await this.d.files(), isoOf(this.now()));
  }

  /**
   * The import as the person chose: the publication note gets the module's properties (any it has already stay as they
   * are) and its Sections table, every other word of it kept where it was; an edition note for each edition chosen (its
   * PDF linked where it is, never moved or copied; its line kept word for word); a Cartoon strip piece for each picture on
   * an edition's line. An edition already made from the same PDF is never made twice.
   */
  async importApply(rel: string, choice: { editions?: number[]; sections?: Section[] }, by = 'you'): Promise<string> {
    this.need();
    await this.d.requireCreate();
    const plan = await this.importPlan(rel);
    const meta = this.d.index.get(rel)!;
    let text = this.text(rel);
    const props = importProps(plan, (meta.props ?? {}) as Record<string, unknown>);
    text = changeProps(text, (doc) => {
      for (const [k, v] of Object.entries(props)) doc.set(k, v);
    });
    const sections = (choice.sections?.length ? choice.sections : plan.sections.length ? plan.sections : null) ?? null;
    if (sections) text = withSections(text, sections);
    else text = withSections(text, readPublication({ path: rel, title: meta.title, props: {}, content: text }).sections);
    await this.d.writeNote(rel, text, by);
    const pub = readPublication({ path: rel, title: meta.title, props: { ...(meta.props ?? {}), ...props }, content: text });
    const picked = new Set((choice.editions ?? plan.editions.map((e, i) => (e.unlinked ? -1 : i))).filter((i) => i >= 0));
    const have = this.ofPub(pub, this.read());
    const already = new Set(have.editions.map((e) => this.fileRel(e.pdf, e.path).toLowerCase()).filter(Boolean));
    let made = 0;
    let pieces = 0;
    const today = isoOf(this.now());
    for (const [i, e] of plan.editions.entries()) {
      if (!picked.has(i) || already.has(e.pdf.toLowerCase())) continue;
      const number = e.number ?? nextNumber(have.editions);
      const date = e.date ?? today;
      const er = await this.freeNote(editionsFolder(pub), editionFileName(number, date, e.preview));
      // Its pictures are pieces inside the edition's note (27 Oct 2026: an edition is one note).
      const itemsMade: string[] = [];
      const blocks = new Map<string, string[]>();
      const secFor = pub.sections.find((s) => /fun|cartoon|comic|puzzle/i.test(s.name))?.name ?? pub.sections.at(-1)?.name ?? 'Pieces';
      for (const p of e.pictures) {
        const headline = p.label.replace(/^.*?:\s*/, '') || p.label;
        const id = pieceId(er, headline);
        blocks.set(id, pieceBlock({ kind: 'cartoon', headline, image: p.path, date, credit: p.label.includes(':') ? p.label.split(':')[0]!.trim() : '', section: secFor }));
        itemsMade.push(id);
        pieces++;
      }
      const sectionsOut = pub.sections.map((s) => ({ name: s.name, items: s.name === secFor ? itemsMade : [] }));
      await this.d.writeNote(er, newEditionText(pub, { number, date, status: e.status, sections: sectionsOut, preview: e.preview, pdf: e.pdf, lead: e.lead, notes: e.words, imported: today, blocks }), by);
      already.add(e.pdf.toLowerCase());
      made++;
    }
    this.d.changed();
    return `${pub.title} is set up as a publication: ${plural(pub.sections.length, 'section')}${made ? `, ${plural(made, 'edition')}` : ''}${pieces ? `, ${plural(pieces, 'cartoon')} kept as pieces` : ''}. Every word of the note is kept, and the PDFs stay where they are.`;
  }

  // ── On a schedule (only while Publications and its delivery are on) ─────────────────────────────────────────────

  /** Switched on or off (Settings › Packs): the schedule's check runs only while it is on. */
  switched(): void {
    if (this.on()) this.start();
    else this.stop();
  }
  start(): void {
    if (this.timer || !this.on()) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.d.log?.(`publications: ${e instanceof Error ? e.message : String(e)}`)), 60_000);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Each publication whose time has come: today's edition built if it isn't yet, then sent and printed the ways the
   *  publication is set to, once a day. An edition missed while the former host app was closed is caught up once on
   *  return (8.2 honesty, 29 Oct 2026): the latest missed day only, never one per missed day, and a day already
   *  delivered (its delivery log says so) is never sent again. No edition for the day is said in the bell, once. */
  async tick(now = this.now()): Promise<number> {
    if (!this.on() || !this.part('delivery') || !this.d.root() || this.running) return 0;
    this.running = true;
    try {
      const all = this.read();
      let done = 0;
      for (const pub of all.pubs) {
        if (!pub.ready || !pub.schedule) continue;
        if (!deliveryWays(pub).length) continue;
        const day = lastScheduledDay(pub.schedule, now);
        if (!day) continue;
        const key = `${pub.path}:${day}:${pub.schedule.time}`;
        const mine = this.ofPub(pub, all);
        let ed = mine.editions.find((e) => e.date === day && !e.preview);
        if (!ed) {
          // Today's edition made elsewhere and filed in the vault becomes the edition, with its own note.
          const filed = filedEditionPdf(pub, { number: null, date: day }, await this.d.files().catch(() => []));
          if (filed) {
            const number = filed.number ?? nextNumber(mine.editions);
            const er = await this.freeNote(editionsFolder(pub), editionFileName(number, day));
            await this.d.writeNote(er, newEditionText(pub, { number, date: day, status: 'Built', sections: pub.sections.map((x) => ({ name: x.name, items: [] })), pdf: filed.path, imported: day }), 'automation');
            this.d.changed();
            ed = this.ofPub(pub, this.read()).editions.find((e) => e.path === er);
          }
        }
        if (!ed) {
          if (this.saidNone.has(key)) continue;
          this.saidNone.add(key);
          this.d.post([{ key: `pub:none:${key}`, kind: 'publications', title: day === isoOf(now) ? `No edition of ${pub.title} for today` : `No edition of ${pub.title} for ${shortDate(day)}`, body: `${pub.title} is due ${scheduleWords(pub.schedule).toLowerCase()}, and no edition is dated ${shortDate(day)}.${day === isoOf(now) ? '' : ' It was missed while Ironleaf was closed; later missed days are not made one by one.'}`, path: pub.path }]);
          continue;
        }
        // Done already (by hand, or before a restart): its delivery log or its Delivered status says so.
        if (/^(delivered|printed)$/i.test(ed.status)) continue;
        if (ed.delivery.some((r) => r.when.startsWith(day) && /scheduled/i.test(r.how + r.result))) continue;
        try {
          // What actually went out decides what is marked and said (9.5: every send was marked Done and said to have
          // "went out" even when its ways came back "Not sent").
          const before = ed.delivery.length;
          const words = await this.deliver(ed.path, undefined, 'automation');
          const fresh = readEdition({ path: ed.path, title: ed.path, props: {}, content: this.text(ed.path) }).delivery.slice(before);
          const failed = fresh.filter((r) => /not (sent|printed)/i.test(r.result));
          const result = !fresh.length || failed.length === fresh.length ? 'Not sent' : failed.length ? 'Partially sent' : 'Done';
          await this.d.writeNote(ed.path, withDeliveryRow(this.text(ed.path), { when: `${day} ${now.toTimeString().slice(0, 5)}`, how: 'Scheduled', to: scheduleText(pub.schedule), result }), 'automation');
          if (result === 'Not sent') this.d.post([{ key: `pub:failed:${key}`, kind: 'publications', title: `${pub.title} ${editionLabel(ed)} didn’t go out`, body: words, path: ed.path }]);
          else {
            this.d.post([{ key: `pub:done:${key}`, kind: 'publications', title: result === 'Done' ? `${pub.title} ${editionLabel(ed)} went out` : `${pub.title} ${editionLabel(ed)} partly went out`, body: words, path: ed.path }]);
            done++;
          }
        } catch (e) {
          this.d.post([{ key: `pub:failed:${key}`, kind: 'publications', title: `${pub.title} ${editionLabel(ed)} didn’t go out`, body: e instanceof Error ? e.message : String(e), path: ed.path }]);
        }
      }
      return done;
    } finally {
      this.running = false;
    }
  }

  // ── The agents' tools ──────────────────────────────────────────────────────────────────────────────────────────

  rules(): string {
    return this.on() ? PUBLICATION_RULES : '';
  }

  toolsOn() {
    return this.on() ? PUBLICATION_TOOLS.filter((t) => this.part('puzzles') || !t.name.startsWith('puzzle_')) : [];
  }

  /** One of the tools for an agent with its gate (none: the person): null when it isn't one of Publications'. Reads come
   *  from what the gate lets through; a write is refused unless the agent is allowed the level of what it writes. */
  async callTool(name: string, args: Record<string, unknown>, gate?: Gate | null): Promise<{ text: string; done?: { words: string } } | null> {
    if (!isPublicationTool(name)) return null;
    const tool = PUBLICATION_TOOLS.find((t) => t.name === name)!;
    if (!this.on()) return { text: 'Publications is switched off in Ironleaf (Settings › Packs).' };
    if (name.startsWith('puzzle_') && !this.part('puzzles')) return { text: 'The puzzle engine is switched off in Ironleaf (Settings › Packs › Publications).' };
    const index = gate ? gateIndex(this.d.index, gate) : this.d.index;
    const by = gate ? `agent:${gate.name}` : 'you';
    try {
      const all = this.read(index);
      if (gate && !all.pubs.length && this.read().pubs.length) return { text: refusal('family', gate.name) };
      if (tool.write && gate && !gate.allowsLevel('family')) return { text: refusal('family', gate.name) };
      const pub = () => this.pick(all.pubs, args.publication);
      switch (name) {
        case 'publication_list': {
          const list = args.publication ? [pub()] : all.pubs;
          if (!list.length) return { text: 'There are no publications yet.' };
          return { text: list.map((p) => this.pubWords(p, this.ofPub(p, all))).join('\n\n') };
        }
        case 'publication_search': {
          const hits = await this.search(S(args.query, 300), args.publication ? pub().path : undefined, index);
          if (!hits.length) return { text: `Nothing in the archive matches “${S(args.query, 300)}”.` };
          return { text: hits.slice(0, 20).map((h) => `- ${h.editionLabel}${h.date ? ` (${shortDate(h.date)})` : ''}: ${kindInfo(h.kind)?.name ?? (h.kind === 'edition' ? 'Edition' : 'Piece')} “${h.headline}” — ${h.snippet}${h.item ? ` [${h.item}]` : h.edition ? ` [${h.edition}]` : ''}`).join('\n') };
        }
        case 'publication_edition': {
          const p = pub();
          const mine = this.ofPub(p, all);
          const e = this.editionByNumber(mine.editions, args.number);
          const d = await this.edition(e.path);
          const lines = [`${p.masthead} ${d.edition.label}, ${longDate(d.edition.date)} — ${d.edition.status}${d.edition.pdf ? `, PDF ${d.edition.pdf}${d.edition.pages ? ` (${plural(d.edition.pages, 'page')})` : ''}` : ', no PDF yet'}.`];
          for (const s of d.sections) if (s.items.length) lines.push(`${s.name} (${plural(s.pages, 'page')}): ${s.items.map((i) => `${i.kindName} “${i.headline}”${i.source ? ` (${i.source})` : ''}`).join('; ')}`);
          if (d.answers) lines.push(`Prints the answers to ${d.answers.from} (${plural(d.answers.count, 'puzzle')}).`);
          lines.push(`Fit (estimated): ${d.estimateWords}.`);
          if (d.edition.delivery.length) lines.push(`Delivery: ${d.edition.delivery.map((r) => `${r.when} ${r.how} ${r.result}`).join('; ')}.`);
          return { text: lines.join('\n') };
        }
        case 'publication_setup': {
          const asked = S(args.publication, 200).trim();
          let rel = all.pubs.find((x) => [x.title, x.masthead, x.path].some((n) => n.toLowerCase() === asked.toLowerCase()))?.path ?? '';
          if (!rel) {
            try {
              rel = pub().path;
            } catch {
              rel = await this.reuseOrMake(all.pubs, asked, by);
            }
          }
          const p = this.pick(this.read().pubs, rel);
          // Font and crest files from this PC go into the publication's folder; vault paths stay as they are.
          const fileIn = async (v: unknown, kind: 'font' | 'picture') => {
            const f = S(v, 600);
            if (!f) return '';
            if (!path.isAbsolute(f)) return f;
            if (!existsSync(f)) throw new Error(`${path.basename(f)} isn’t on this PC.`);
            return (await this.d.copyIn([f], `${p.folder}/${kind === 'font' ? 'Fonts' : 'Pictures'}`))[0] ?? '';
          };
          const patch: Record<string, unknown> = {};
          for (const k of ['masthead', 'motto', 'schedule', 'template', 'telegram', 'email', 'printer', 'print', 'ink', 'greyscale', 'justify']) if (args[k] !== undefined) patch[k] = args[k];
          for (const k of ['masthead_font', 'head_font', 'body_font']) if (args[k] !== undefined) patch[k] = await fileIn(args[k], 'font');
          if (args.crest !== undefined) patch.crest = await fileIn(args.crest, 'picture');
          await this.setPublication(p.path, patch, by);
          if (Array.isArray(args.body_faces) && args.body_faces.length) {
            const faces = [] as string[];
            for (const f of args.body_faces.slice(0, 6)) faces.push(await fileIn(f, 'font'));
            this.d.changed();
            const checked: string[] = [];
            for (const f of faces.filter(Boolean)) checked.push((await this.houseFile(f, 'The font', false)) ?? '');
            await this.d.writeNote(p.path, setNoteProp(this.text(p.path), 'body_faces', checked.filter(Boolean).join(', ')), by);
          }
          if (Array.isArray(args.sections) && args.sections.length) await this.setSections(p.path, args.sections as Section[], by);
          gate?.note(p.path, 'changed');
          const now = this.pick(this.read().pubs, p.path);
          return { text: `${now.title} is set up: ${now.sections.map((x) => `${x.name} (${plural(x.pages, 'page')})`).join(', ')}; ${scheduleWords(now.schedule)}; template ${now.template.name}. Each edition: research its sections, then one publication_edition_build with every piece (puzzles from puzzle_generate first).`, done: { words: `Set up ${now.title}.` } };
        }
        case 'publication_item_add': {
          const p = pub();
          const rel = await this.addItem(p.path, args, by, p);
          gate?.note(rel, 'changed');
          return { text: `Kept “${S(args.headline, 200)}” in ${p.title}’s pieces [${rel}].`, done: { words: `Added the piece “${S(args.headline, 120)}” to ${p.title}.` } };
        }
        case 'puzzle_generate': {
          const p = pub();
          const made = this.makePuzzle(args);
          if (made.problems.length) return { text: `The puzzle couldn’t be made sound: ${made.problems.join(' ')}` };
          const rel = await this.savePuzzle(p.path, { puzzle: made.puzzle, title: S(args.title, 120), section: S(args.section, 60) }, by, p);
          gate?.note(rel, 'changed');
          return { text: `${made.words} Kept with its answers in ${p.title} [${rel}]; put it in an edition with publication_edition_build (pieces).`, done: { words: `Made a ${kindInfo(made.puzzle.kind)?.name.toLowerCase()} for ${p.title}.` } };
        }
        case 'puzzle_solve_time': {
          const p = pub();
          const mine = this.ofPub(p, all);
          let rel = S(args.puzzle, 600);
          if (!rel) {
            const kind = S(args.kind, 20).toLowerCase();
            const e = this.editionByNumber(mine.editions, args.number);
            const it = e.sections.flatMap((s) => s.items.map((t) => findItem(mine.items, t, e.path))).find((i) => i?.puzzle && (!kind || i.kind === kind));
            if (!it) throw new Error(`${editionLabel(e)} has no ${kind ? kindInfo(kind)?.name.toLowerCase() : 'puzzle'}.`);
            rel = it.path;
          }
          if (gate) gate.check(rel, 'changed');
          const words = await this.solve(rel, { who: args.who, time: args.time, day: args.day }, by);
          return { text: words, done: { words } };
        }
        case 'publication_next': {
          const p = pub();
          const mine = this.ofPub(p, all);
          const next = nextRun(p.schedule, this.now());
          const used = new Set(mine.editions.flatMap((e) => e.sections.flatMap((s) => s.items.map((t) => findItem(mine.items, t, e.path)?.path).filter(Boolean))));
          const waiting = mine.items.filter((i) => !used.has(i.path));
          const ways = deliveryWays(p).map((w) => w.label);
          const lines = [`${p.masthead}: next edition ${next ? `due ${longDate(isoOf(next))} at ${p.schedule!.time}` : 'has no schedule set'}.`, ways.length ? `It goes out by ${ways.join(', ')}.` : 'No sending or printing is set up yet.'];
          for (const s of p.sections) {
            const here = waiting.filter((i) => i.section.toLowerCase() === s.name.toLowerCase());
            lines.push(`- ${s.name} (${plural(s.pages, 'page')}): ${here.length ? `${plural(here.length, 'piece')} waiting (${here.slice(0, 4).map((i) => `“${i.headline}”`).join(', ')})` : 'nothing waiting yet'}.`);
          }
          const stray = waiting.filter((i) => !p.sections.some((s) => s.name.toLowerCase() === i.section.toLowerCase()));
          if (stray.length) lines.push(`Also waiting, with no section matched: ${stray.slice(0, 6).map((i) => `“${i.headline}”`).join(', ')}.`);
          const short = p.sections.filter((s) => !waiting.some((i) => i.section.toLowerCase() === s.name.toLowerCase()));
          lines.push(short.length ? `Sections with nothing waiting: ${short.map((s) => s.name).join(', ')}.` : 'Every section has a piece waiting.');
          return { text: lines.join('\n') };
        }
        case 'publication_edition_build':
          return await this.buildTool(pub(), all, args, by, gate ?? null);
        case 'publication_edition_deliver': {
          const p = pub();
          const e = this.editionByNumber(this.ofPub(p, all).editions, args.number);
          if (gate) gate.check(e.path, 'changed');
          const how = Array.isArray(args.how) ? args.how.map((x) => S(x, 20).toLowerCase()).filter((x) => ['telegram', 'email', 'print'].includes(x)) : undefined;
          const words = await this.deliver(e.path, how, by);
          return { text: words, done: { words: `Sent ${p.title} ${editionLabel(e)}.` } };
        }
      }
      return { text: `There is no tool called ${name}.` };
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e) };
    }
  }

  private editionByNumber(editions: Edition[], number: unknown): Edition {
    const n = parseEditionNumber(number);
    const list = sortEditions(editions);
    const e = n !== null ? list.find((x) => x.number === n && !x.preview) : (list.find((x) => !x.preview) ?? list[0]);
    if (!e) throw new Error(n !== null ? `There’s no No. ${n}.` : 'There are no editions yet.');
    return e;
  }

  private pubWords(p: Publication, mine: { editions: Edition[]; items: Item[] }): string {
    const next = nextRun(p.schedule, this.now());
    const ways = deliveryWays(p).map((w) => w.label);
    const lines = [`**${p.masthead}** [${p.path}]${p.ready ? '' : ' (not set up yet: it can be imported on the Publications page)'}`, `Schedule: ${scheduleWords(p.schedule)}; ${ways.length ? ways.join(', ') : 'not sent or printed on its own'}. Layout: ${p.template.name}.`, 'Sections:'];
    for (const s of p.sections) lines.push(`- ${s.name} (${plural(s.pages, 'page')})${s.sources ? ` — sources: ${s.sources}` : ''}${s.rules ? ` — rules: ${s.rules}` : ''}`);
    const eds = mine.editions.slice(0, 5);
    lines.push(eds.length ? `Latest editions: ${eds.map((e) => `${editionLabel(e)} ${shortDate(e.date)} (${e.status}${e.pages ? `, ${plural(e.pages, 'page')}` : ''})`).join('; ')}.` : 'No editions yet.');
    if (next) {
      const day = isoOf(next);
      const ed = mine.editions.find((e) => e.date === day && !e.preview);
      lines.push(`Next due: ${longDate(day)} at ${p.schedule!.time}${ed ? ` — ${editionLabel(ed)} is ${ed.status.toLowerCase()}` : ' — no edition for it yet'}.`);
    }
    lines.push(`Pieces in the store: ${mine.items.length} (${ITEM_KINDS.map((k) => [k.name, mine.items.filter((i) => i.kind === k.id).length] as const).filter(([, n]) => n).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ') || 'none'}).`);
    return lines.join('\n');
  }

  private async buildTool(p: Publication, all: { editions: Edition[]; items: Item[] }, args: Record<string, unknown>, by: string, gate: Gate | null): Promise<{ text: string; done?: { words: string } }> {
    const mine = this.ofPub(p, all);
    const date = isoDay(args.date) ?? isoOf(this.now());
    // Building again for the same day replaces that day's edition (27 Oct 2026: one evening made No. 4 and No. 5).
    const askedNumber = parseEditionNumber(args.number);
    const sameDay = askedNumber !== null ? null : mine.editions.filter((e) => e.date === date && !e.preview).sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0];
    const number = askedNumber ?? sameDay?.number ?? nextNumber(mine.editions);
    const existing = sameDay ?? mine.editions.find((e) => e.number === number && !e.preview);
    if (existing && gate) gate.check(existing.path, 'changed');
    // Every new piece checked against its section's rules before anything is written.
    const news = (Array.isArray(args.items) ? args.items : []).slice(0, 80).map((x) => this.cleanItem((x ?? {}) as Record<string, unknown>));
    const problems: string[] = [];
    for (const it of news) {
      if (!it.headline) problems.push('A piece has no headline.');
      const sec = p.sections.find((s) => s.name.toLowerCase() === (it.section ?? '').toLowerCase());
      if (it.section && !sec) problems.push(`“${it.headline}”: there is no section called ${it.section} (sections: ${p.sections.map((s) => s.name).join(', ')}).`);
      if (['story', 'brief'].includes(it.kind)) {
        const why = sourceProblem(sec, it.source ?? '');
        if (why) problems.push(`“${it.headline}”: ${why}`);
      }
      const table = tableProblem({ kind: it.kind, headline: it.headline, body: it.body });
      if (table) problems.push(table);
    }
    const olds = (Array.isArray(args.pieces) ? args.pieces : []).slice(0, 80).map((x) => ({ path: S((x as Record<string, unknown>)?.path, 600), section: S((x as Record<string, unknown>)?.section, 60) }));
    for (const o of olds) if (!findItem(mine.items, o.path)) problems.push(`There is no piece at ${o.path}.`);
    if (problems.length) return { text: `Nothing was written. ${problems.join(' ')}` };
    if (!news.length && !olds.length && !existing) return { text: 'Give the pieces for the edition (items, or pieces already in the store).' };
    const rel = existing?.path ?? (await this.newEdition(p.path, { date, number }, by));
    // The edition is the pieces given now: the new ones, and those kept (`pieces`), copied in when they were another
    // edition's or an older item note, so the edition stays one note.
    const all2 = this.read();
    const kept = new Map<string, string[]>();
    const sections = p.sections.map((s) => ({ name: s.name, items: [] as string[] }));
    const into = (name: string, target: string) => {
      const s = sections.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? sections.at(-1)!;
      if (!s.items.includes(target)) s.items.push(target);
    };
    const here = editionBlocks(this.text(rel), rel);
    for (const o of olds) {
      const it = findItem(all2.items, o.path)!;
      const id = here.has(it.path) ? it.path : pieceId(rel, it.headline);
      if (!here.has(it.path)) kept.set(id, pieceBlock(itemInputOf(it)));
      into(o.section || it.section || sections.at(-1)!.name, id);
    }
    await this.d.writeNote(rel, withEditionSections(this.text(rel), sections, rel, kept), by);
    for (const it of news) await this.addItem(p.path, it as unknown as Record<string, unknown>, by, p, rel);
    if (S(args.template)) await this.setEdition(rel, { template: S(args.template) }, by);
    gate?.note(rel, 'changed');
    const detail = await this.edition(rel);
    if (args.pdf === false) return { text: `${existing?.pdf ? 'Updated' : 'Started'} ${p.title} ${detail.edition.label} for ${longDate(date)} [${rel}]. Fit (estimated): ${detail.estimateWords}.`, done: { words: `Put together ${p.title} ${detail.edition.label}.` } };
    const built = await this.build(rel, by);
    const todo = this.unfinished(rel, built.laidOut);
    // "Made" the first time it is built (a puzzle kept for the day may have started its note), "Updated" after.
    const made = `${existing?.pdf ? 'Updated' : 'Made'} ${p.title} ${detail.edition.label} for ${longDate(date)} [${rel}]. ${built.words} PDF: ${built.pdf}.${detail.answers ? ` It prints the answers to ${detail.answers.from}.` : ''}`;
    return { text: todo.length ? `NOT FINISHED, so don't hand it over yet: ${todo.join(' ')} Then build again with the new pieces added (items) and the ones already in it kept (pieces). ${made}` : made, done: { words: `Built ${p.title} ${detail.edition.label}.` } };
  }

  /** What an edition still lacks (26 Oct 2026: handed over at 7 of 9 pages, its front page empty, no cartoon): a section
   *  short of its pages or running over, no lead on the front, and the pieces its section's rules ask for. */
  unfinished(rel: string, laidOut: LaidOut): string[] {
    const { pub, edition, items } = this.find(rel);
    const secs = this.docSections(pub, edition, items);
    const out: string[] = [];
    if (secs[0] && !secs[0].items.some((it) => it.kind === 'story' && it.lead)) out.push(`The front page has no lead story: add the biggest story with lead true.`);
    for (const r of laidOut.sections) {
      if (r.over) out.push(`${r.name} runs ${Math.round((r.used - r.budget) * 10) / 10} of a page over its ${plural(r.budget, 'page')}: cut a brief or shorten a story.`);
      else if (r.budget >= 1 && r.used < r.budget * 0.85) out.push(`${r.name} fills ${Math.round(r.used * 10) / 10} of its ${plural(r.budget, 'page')}: add about ${Math.max(1, Math.round((r.budget - r.used) * 4))} more briefs or stories, researched and sourced, never filler.`);
    }
    for (const sec of secs)
      for (const [re, kind, words] of RULE_KINDS)
        if (re.test(wantedRules(sec.rules)) && !sec.items.some((it) => it.kind === kind)) out.push(`${sec.name} has no ${words.split(' (')[0]!.replace(/^(an?|the) /, '')}, which its rules ask for: add ${words}.`);
    return out;
  }
}

/** The window's calls (pub:*). */
export function registerPublications(p: Publications, handle: (channel: string, fn: (...args: any[]) => unknown) => void): void {
  const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  handle('pub:state', (pubRel: unknown) => p.state(str(pubRel) || undefined));
  handle('pub:edition', (rel: unknown) => p.edition(str(rel)));
  handle('pub:preview', (rel: unknown, picked: unknown) => p.preview(str(rel), str(picked) || undefined));
  handle('pub:build', (rel: unknown) => p.build(str(rel)));
  handle('pub:export', (rel: unknown) => p.exportPdf(str(rel)));
  handle('pub:deliver', (rel: unknown, how: unknown) => p.deliver(str(rel), Array.isArray(how) ? how.map((x) => str(x, 20)).filter(Boolean) : undefined));
  handle('pub:printers', () => p.printers());
  handle('pub:create', (input: unknown) => p.createPublication(obj(input) as unknown as PublicationInput));
  handle('pub:set', (rel: unknown, patch: unknown) => p.setPublication(str(rel), obj(patch)));
  handle('pub:sections', (rel: unknown, sections: unknown) => p.setSections(str(rel), Array.isArray(sections) ? (sections as Section[]) : []));
  handle('pub:pick-file', (rel: unknown, kind: unknown) => p.pickFile(str(rel), kind === 'font' ? 'font' : 'picture'));
  handle('pub:edition-new', (rel: unknown, o: unknown) => p.newEdition(str(rel), obj(o) as { date?: string; number?: number; copyFrom?: string }));
  handle('pub:edition-set', (rel: unknown, patch: unknown) => p.setEdition(str(rel), obj(patch) as Parameters<Publications['setEdition']>[1]));
  handle('pub:item-add', (rel: unknown, input: unknown) => p.addItem(str(rel), obj(input)));
  handle('pub:pick-picture', (rel: unknown) => p.pickPicture(str(rel)));
  handle('pub:puzzle-make', (input: unknown) => p.makePuzzle(obj(input)));
  handle('pub:puzzle-save', (rel: unknown, o: unknown) => p.savePuzzle(str(rel), obj(o) as { puzzle: Puzzle; title?: string; section?: string }));
  handle('pub:solve', (rel: unknown, o: unknown) => p.solve(str(rel), obj(o)));
  handle('pub:search', (q: unknown, rel: unknown) => p.search(str(q, 300), str(rel) || undefined));
  handle('pub:import-plan', (rel: unknown) => p.importPlan(str(rel)));
  handle('pub:import-apply', (rel: unknown, choice: unknown) => p.importApply(str(rel), obj(choice) as { editions?: number[]; sections?: Section[] }));
}

export { bodyOf };
