// In-memory index of every note: links, backlinks, tags, full-text search and
// BM25 retrieval for chat. Rebuilt on vault open, then kept current by the file watcher.

import { folderOfPath, inFolder, isRelativeTarget, joinPath } from '../shared/paths';
import { isProjectProps } from '../shared/project-file';
import { asStrings, isMachineProp, readProps } from '../shared/frontmatter';
import { withFields } from '../shared/inline-fields';
import {
  escapeRegExp,
  extractHeadings,
  extractLinks,
  extractTags,
  displayTitle,
  findUnlinkedPhrase,
  maskCode,
  normalizeTarget,
  titleFromPath,
  tokenize,
} from '../shared/markdown';
import { foldedDocOf, parseQuery, QueryMatcher, type FoldedDoc, type QueryDoc } from '../shared/query';
import { diffGraph } from '../shared/graph-delta';
import { computeRelations, type Relations, type WordCache } from '../shared/relations';
import { buildRecordModel, type RecordModel } from '../shared/records';
import { isPrivatePath } from '../shared/private';
import { INBOX_FOLDER } from '../shared/inbox';
import { isDocNote } from '../shared/doc-file';
import { findReminders, type FoundReminder } from '../shared/reminders';
import { datesIn, findTasks, type FoundTask } from '../shared/hub';
import { linkBoost, Ranker, rankWords, recencyBoost, RECORD_SHARE, type FieldCounts } from '../shared/ranking';
import { isRecordProps } from '../shared/module-records';
import { plainText } from '../shared/plain-text';
import { bestLines, EMBED_CONFIRM_MIN, EMBED_SEARCH_MIN, isMeaningQuery, MEANING_SEARCH_MAX, MEANING_SEARCH_MIN, meaningWords, RERANK_CONFIRM_MIN, RERANK_MAX, RERANK_MAX_TEXT_CHARS, type MeaningBag } from '../shared/meaning';
import { relatedTo, type RelatedItem } from '../shared/related';
import { MeaningIndex } from './meaning-index';
import { applyRerank } from './meaning-rerank';
import { isKindKey, isStructuralProp, readLinkKinds, relationTargets } from '../shared/relation-links';
import { isSystemsTableText, rowsInTableTexts } from '../shared/system-tables';
import { isBillsTableText, rowsInBillsTexts } from '../shared/bills-table';
import type { GraphData, GraphSnapshot, LineContext, Mention, NoteMeta, OutgoingLink, PropLink, RelatedNote, SearchHit, TagCount } from '../shared/types';

interface Chunk {
  path: string;
  section: string;
  text: string;
  tf: Map<string, number>;
  length: number;
}

interface IndexedNote {
  meta: NoteMeta;
  content: string;
  lines: string[];
  chunks: Chunk[];
  /** The note's folded words, built on the first search after it changes and kept until the next (5 Nov 2026,
   *  v5-vault-speed: folding the whole vault per keystroke was the 120-200 ms). */
  folded?: FoldedDoc;
}

export interface RetrievedChunk {
  path: string;
  title: string;
  section: string;
  text: string;
  score: number;
}

const CHUNK_CHARS = 1500;
const SNIPPET_CHARS = 220;

/** A long line cut down around its first highlight, the highlights moved to match. */
export function trimSnippet(line: string, index: number, ranges: [number, number][]): SearchHit['snippets'][number] {
  const leading = line.length - line.trimStart().length;
  let text = line.trim();
  let shift = leading;
  if (text.length > SNIPPET_CHARS) {
    const first = Math.max(0, (ranges[0]?.[0] ?? 0) - leading);
    const start = Math.max(0, Math.min(first - 60, text.length - SNIPPET_CHARS));
    text = (start > 0 ? '…' : '') + text.slice(start, start + SNIPPET_CHARS) + (start + SNIPPET_CHARS < text.length ? '…' : '');
    shift = leading + start - (start > 0 ? 1 : 0);
  }
  const moved = ranges.map(([a, b]) => [a - shift, b - shift] as [number, number]).filter(([a, b]) => a >= 0 && b <= text.length && b > a);
  return { line: index, text, ranges: moved };
}
const MIN_NAME_LENGTH = 3;
const NO_DAYS: readonly string[] = [];

/** A note's opening body lines (front matter off, its own title skipped: the hit already shows it): the preview
 *  for a meaning hit whose query shares no idea with any line (6 Nov 2026, find-by-meaning). */
function openingLines(content: string, max: number): { line: number; text: string }[] {
  let body = content;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end > 0) body = body.slice(end + 4);
  }
  const lines = body.split(/\r?\n/);
  const out: { line: number; text: string }[] = [];
  lines.forEach((text, line) => {
    if (out.length >= Math.max(0, max) || !text.trim()) return;
    if (!out.length && /^#{1,6}\s/.test(text.trim()) && lines.slice(line + 1).some((l) => l.trim())) return;
    out.push({ line, text });
  });
  return out;
}

function splitIntoChunks(path: string, content: string): Chunk[] {
  const title = titleFromPath(path);
  const masked = maskCode(content);
  const lines = content.split(/\r?\n/);
  const maskedLines = masked.split(/\r?\n/);
  const sections: { heading: string; lines: string[] }[] = [{ heading: title, lines: [] }];
  lines.forEach((line, i) => {
    const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(maskedLines[i] ?? '');
    if (h) sections.push({ heading: h[2], lines: [line] });
    else sections[sections.length - 1].lines.push(line);
  });

  const chunks: Chunk[] = [];
  const push = (section: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const tokens = tokenize(`${title} ${section} ${trimmed}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    chunks.push({ path, section, text: trimmed, tf, length: tokens.length });
  };
  for (const s of sections) {
    let buf = '';
    for (const para of s.lines.join('\n').split(/\n\s*\n/)) {
      if (buf && buf.length + para.length > CHUNK_CHARS) {
        push(s.heading, buf);
        buf = '';
      }
      buf += (buf ? '\n\n' : '') + para;
    }
    push(s.heading, buf);
  }
  return chunks;
}

/** A file's name without its folder, lower-cased (how links name pictures and other files). */
const baseName = (p: string) => (p.split('/').pop() ?? p).toLowerCase();

/**
 * The name a person sees for a note. A project's file goes by its folder (the project's name: docs/PROJECTS-DESIGN.md);
 * a note named like a folder's page (README, Index, Notes) goes by its folder too: "Windows 11 Upgrade · README".
 */
const SECTION_NAMES = /^(readme|index|notes)$/i;
export function labelFor(path: string, title: string, props: Record<string, unknown>): string {
  const parts = path.split('/');
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  if (!folder) return title;
  if (isProjectProps(props)) return folder;
  if (SECTION_NAMES.test(title)) return `${folder} · ${title}`;
  return title;
}

/** The links in a note's properties (front matter only), each with its property, kind and line: what the relations seam
 *  (src/main/relation-sync.ts) and the links-to-this-note panel read. Kind siblings are skipped, never links. */
function propLinksOf(content: string, props: Record<string, unknown>): PropLink[] {
  const out: PropLink[] = [];
  const lines = content.split(/\r?\n/);
  const end = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l)) : -1;
  const fm = end > 0 ? lines.slice(0, end + 1) : [];
  for (const [key, value] of Object.entries(props)) {
    if (isKindKey(key) || isStructuralProp(key) || isMachineProp(key)) continue;
    const targets = relationTargets(value);
    if (!targets.length) continue;
    const kinds = readLinkKinds(props, key, targets.length);
    const re = new RegExp(`^${escapeRegExp(key)}\\s*:`, 'i');
    const line = Math.max(0, fm.findIndex((l) => re.test(l)));
    targets.forEach((target, i) => out.push({ key, target, kind: kinds[i] ?? '', line }));
  }
  return out;
}

/** The on-device model's query embeddings, asked live per search (null until the model runs). */
export interface MeaningQueries {
  queries(): { embed(text: string): Promise<number[]> } | null;
}

/** The on-device reranker's scores, asked live per search (null until the model runs, or while it scores another). */
export interface RerankQueries {
  score(query: string, texts: string[]): Promise<(number | null)[] | null>;
}

export class VaultIndex {
  private notes = new Map<string, IndexedNote>();
  private byName = new Map<string, string[]>();
  /** Every note's path by its normalised form, in index order (5 Nov 2026, v5-vault-speed: resolving a path
   *  used to scan every note's key, ~1 ms a call inside every loop that resolves links). */
  private byPathNorm = new Map<string, string[]>();
  /** Pictures, PDFs, canvases and other files, by their name with its extension. */
  private files = new Map<string, string[]>();
  private filePaths = new Set<string>();
  private df = new Map<string, number>();
  private avgLength = 1;
  private chunkCount = 0;
  private statsDirty = true;
  /** How notes and projects are connected (src/shared/relations.ts): worked out when asked for, again after any change. */
  private relationsCache: Relations | null = null;
  private relationWords: WordCache = new Map();
  /** Each note's reminders (src/shared/reminders.ts), read when the note is indexed: the 30-second check reads these,
   *  never the disk (19 Oct 2026, reminders). */
  private reminderLines = new Map<string, FoundReminder[]>();
  /** Each note's open task lines and the days it mentions (src/shared/hub.ts), read when the note is indexed: Today's
   *  hub reads these, never the disk (20 Oct 2026, Today as the hub). */
  private taskLines = new Map<string, FoundTask[]>();
  private dayMentions = new Map<string, string[]>();
  /** The notes' words for relevance ranking (src/shared/ranking.ts; 21 Oct 2026, gap G25): brought up to date when a
   *  search or Related notes asks after a change, never on every save. */
  private ranker = new Ranker();
  private relatedWords = new WeakMap<FieldCounts, Map<string, number>>();
  /** Each note's meaning (2 Nov 2026, 10.0: find by what it means, on this PC only): kept current on every change. */
  private meaning = new MeaningIndex();
  /** The on-device model's query embeddings (Wave 2: asked live per search; null until the model runs). */
  private meaningSource: MeaningQueries | null = null;
  /** The on-device reranker (m10rerank: re-scores the top results live per search; null is today's order). */
  private rerankSource: RerankQueries | null = null;
  /** Goes up whenever a note or the left-out folders change: what is worked out from the notes is kept until then. */
  private changes = 0;
  /** Each note's body links resolved, in meta.links order, kept until the notes change (5 Nov 2026,
   *  v5-vault-speed: relations, the graph, Related notes, backlinks and ranking all read the same links). */
  private outAt = -1;
  private outCache = new Map<string, (string | null)[]>();
  /** The last graphs drawn, newest last (5 Nov 2026, v5-vault-speed: graphSince diffs the new one against the
   *  one the window holds). Keyed by generation and templates folder. */
  private graphSnaps: { key: string; gen: number; data: GraphData }[] = [];
  /** Folded Systems rows (records as data): row paths by record name, each row's own links, kept until the
   *  notes change. A row pointing at a note of its own stays out: the note reads instead. */
  private rowAt = -1;
  private rowByName = new Map<string, string>();
  private rowPaths = new Set<string>();
  private rowTitles = new Map<string, string>();
  private rowTargets = new Map<string, { target: string; words: string }[]>();
  private rowNamesByTable = new Map<string, Set<string>>();
  private rowsFresh(): void {
    if (this.rowAt === this.changes) return;
    this.rowAt = this.changes;
    this.rowByName.clear();
    this.rowPaths.clear();
    this.rowTitles.clear();
    this.rowTargets.clear();
    this.rowNamesByTable.clear();
    const texts: [string, string][] = [];
    for (const note of this.notes.values()) {
      if (this.isExcluded(note.meta.path)) continue;
      texts.push([note.meta.path, note.content]);
    }
    for (const row of [...rowsInTableTexts(texts), ...rowsInBillsTexts(texts)]) {
      const table = row.path.split('#')[0];
      let names = this.rowNamesByTable.get(table);
      if (!names) {
        names = new Set<string>();
        this.rowNamesByTable.set(table, names);
      }
      names.add(row.name.toLowerCase());
      if (row.note) continue;
      this.rowPaths.add(row.path);
      this.rowTitles.set(row.path, row.name);
      if (!this.rowByName.has(row.name.toLowerCase())) this.rowByName.set(row.name.toLowerCase(), row.path);
      this.rowTargets.set(row.path, row.targets);
    }
  }
  /** Whether this line of a list file is one of its rows' own lines: its [[..]] are the row's facts, and the
   *  row speaks for them (the file itself stays out of backlinks and the graph for its own lines). */
  private rowLineOf(note: IndexedNote, line: number): boolean {
    const text = note.lines[line] ?? '';
    if (!/^\s*\|/.test(text)) return false;
    const first = text.split('|')[1]?.trim().toLowerCase();
    if (!first || (!isSystemsTableText(note.content) && !isBillsTableText(note.content))) return false;
    this.rowsFresh();
    return this.rowNamesByTable.get(note.meta.path)?.has(first) ?? false;
  }
  /** A link target naming a folded Systems row: its row path, else null. Notes always win over rows. */
  resolveRow(target: string): string | null {
    this.rowsFresh();
    const name = String(target ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim().toLowerCase();
    return (name && this.rowByName.get(name)) ?? null;
  }

  /** How many times the notes have changed since Ironleaf started (Today's hub keeps its lists until this moves). */
  generation(): number {
    return this.changes;
  }

  /** The on-device model's query embeddings for searchAsync (the builder owns the model; null is the fallback). */
  attachMeaning(source: MeaningQueries | null): void {
    this.meaningSource = source;
  }

  /** The on-device reranker for searchAsync (null is today's order, exactly). */
  attachRerank(source: RerankQueries | null): void {
    this.rerankSource = source;
  }

  /** Each note's meaning vectors, for the background embedding build (src/main/meaning-build.ts). */
  meanings(): MeaningIndex {
    return this.meaning;
  }

  /** Folders and files left out of search, the graph, suggestions and the AI's reading (Settings › Files and links). */
  private excluded: string[] = [];

  setExcluded(list: string[]): void {
    this.excluded = list.map((p) => p.toLowerCase());
    this.meaning.setExcluded(list);
    this.relationsCache = null;
    this.changes++;
  }

  isExcluded(path: string): boolean {
    if (!this.excluded.length) return false;
    const p = path.toLowerCase();
    return this.excluded.some((e) => p === e || p.startsWith(`${e}/`));
  }

  /** Folders the person kept out of view (8 Nov 2026): left out of Related, the chat's reading and the graph's
   *  default view — but search still finds them and links still open, so this never touches search.
   *  The Inbox never reads quiet (item 1): a stored Inbox entry is ignored. */
  private quiet: string[] = [];

  setQuiet(list: string[]): void {
    const inbox = INBOX_FOLDER.toLowerCase();
    this.quiet = (list ?? []).map((p) => String(p ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()).filter((q) => q && q !== inbox);
    this.relationsCache = null;
    this.changes++;
  }

  isQuiet(path: string): boolean {
    if (!this.quiet.length) return false;
    const p = String(path ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!p || p === INBOX_FOLDER.toLowerCase()) return false;
    return this.quiet.some((q) => p === q || p.startsWith(`${q}/`));
  }

  clear(): void {
    this.notes.clear();
    this.byName.clear();
    this.byPathNorm.clear();
    this.files.clear();
    this.filePaths.clear();
    this.meaning.clear();
    this.statsDirty = true;
    this.relationsCache = null;
    this.relationWords.clear();
    this.reminderLines.clear();
    this.taskLines.clear();
    this.dayMentions.clear();
    this.changes++;
  }

  /** Every file that isn't a note (links and embeds can name them: ![[photo.png]], [[Board.canvas]]). */
  setFiles(paths: string[]): void {
    this.files.clear();
    // The locked store's sealed files are never linkable (10.0 v2locked).
    const open = paths.filter((p) => !isPrivatePath(p));
    this.filePaths = new Set(open);
    for (const p of open) {
      const key = baseName(p);
      const list = this.files.get(key) ?? [];
      list.push(p);
      this.files.set(key, list);
    }
  }

  /** A link to a file that isn't a note: by its path, else by its name (the shortest path when several share it). */
  resolveFile(target: string, fromPath?: string): string | null {
    const t = target.replace(/\\/g, '/').trim();
    if (!t || /\.md$/i.test(t)) return null;
    if (!isRelativeTarget(t)) {
      const lower = t.toLowerCase();
      for (const p of this.filePaths) if (p.toLowerCase() === lower) return p;
    }
    const joined = joinPath(folderOfPath(fromPath ?? ''), t);
    if (joined) {
      const rel = joined.toLowerCase();
      for (const p of this.filePaths) if (p.toLowerCase() === rel) return p;
    }
    const candidates = this.files.get(baseName(t));
    if (!candidates?.length) return null;
    return [...candidates].sort((a, b) => a.length - b.length)[0];
  }

  /**
   * Whether a link is written from its note's folder: ./ or ../, or a path that finds nothing from the top but does from
   * the folder (as other apps write links relative to the note).
   */
  writtenFromFolder(target: string, fromPath: string): boolean {
    if (isRelativeTarget(target)) return true;
    const t = target.replace(/\\/g, '/').trim();
    if (!t.includes('/')) return false;
    const top = normalizeTarget(t);
    const lower = t.toLowerCase();
    if ([...this.notes.keys()].some((p) => normalizeTarget(p) === top) || [...this.filePaths].some((p) => p.toLowerCase() === lower)) return false;
    return this.resolveAny(t, fromPath) !== null;
  }

  /** A link to anything: a note, else a file. */
  resolveAny(target: string, fromPath?: string): string | null {
    return this.resolve(target, fromPath) ?? this.resolveFile(target, fromPath);
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  get(path: string): NoteMeta | undefined {
    return this.notes.get(path)?.meta;
  }

  content(path: string): string | undefined {
    return this.notes.get(path)?.content;
  }

  set(path: string, content: string, mtime: number, size: number, born?: number): void {
    // Locked notes are never indexed (10.0 v2locked): the vault listing keeps them out, and this door refuses them
    // too, so no caller can ever put one in search, the graph, tasks, reminders or the assistant's reading.
    if (isPrivatePath(path)) {
      this.delete(path);
      return;
    }
    this.removeNames(path);
    // Inline "Key:: value" fields count as properties too, under the ones at the top (V12, 28 Oct 2026).
    const fmProps = readProps(content);
    const props = withFields(fmProps, content);
    // A known as name reaches the note too (9 Nov 2026, one person one page): aliases plus the known as
    // list, however written.
    const aliases = [...asStrings(props.aliases ?? props.alias)];
    for (const [k, v] of Object.entries(props ?? {})) {
      const key = k.trim().toLowerCase();
      if (['known as', 'known_as', 'known-as', 'knownas', 'also known as', 'aka', 'nickname', 'nicknames'].includes(key)) for (const s of asStrings(v)) if (!aliases.includes(s)) aliases.push(s);
    }
    const title = displayTitle(path, fmProps);
    const meta: NoteMeta = {
      path,
      title,
      label: labelFor(path, title, props),
      mtime,
      size,
      ...(born && Number.isFinite(born) && born > 0 ? { born } : {}),
      links: extractLinks(content),
      propLinks: propLinksOf(content, fmProps),
      tags: extractTags(content, asStrings(props.tags ?? props.tag)),
      headings: extractHeadings(content),
      aliases,
      props,
    };
    this.notes.set(path, { meta, content, lines: content.split(/\r?\n/), chunks: splitIntoChunks(path, content) });
    const reminders = findReminders(content);
    if (reminders.length) this.reminderLines.set(path, reminders);
    else this.reminderLines.delete(path);
    const tasks = findTasks(content);
    if (tasks.length) this.taskLines.set(path, tasks);
    else this.taskLines.delete(path);
    const days = datesIn(content);
    if (days.length) this.dayMentions.set(path, days);
    else this.dayMentions.delete(path);
    for (const name of [meta.title, ...aliases]) {
      const key = normalizeTarget(name);
      const list = this.byName.get(key) ?? [];
      if (!list.includes(path)) list.push(path);
      this.byName.set(key, list);
    }
    const pathKey = normalizeTarget(path);
    const pathList = this.byPathNorm.get(pathKey) ?? [];
    if (!pathList.includes(path)) pathList.push(path);
    this.byPathNorm.set(pathKey, pathList);
    this.meaning.set(path, meta.label, content);
    this.statsDirty = true;
    this.relationsCache = null;
    this.changes++;
  }

  delete(path: string): void {
    this.removeNames(path);
    this.notes.delete(path);
    this.meaning.delete(path);
    this.statsDirty = true;
    this.relationsCache = null;
    this.relationWords.delete(path);
    this.reminderLines.delete(path);
    this.taskLines.delete(path);
    this.dayMentions.delete(path);
    this.changes++;
  }

  /** Every note's open task lines, as they were when each was last indexed. */
  tasks(): { path: string; items: FoundTask[] }[] {
    return [...this.taskLines].map(([path, items]) => ({ path, items }));
  }

  /** The days a note mentions (YYYY-MM-DD), as it was when last indexed. */
  daysIn(path: string): readonly string[] {
    return this.dayMentions.get(path) ?? NO_DAYS;
  }

  /** Every note's reminders, as they were when each was last indexed. */
  reminders(): { path: string; title: string; items: FoundReminder[] }[] {
    return [...this.reminderLines].map(([path, items]) => ({ path, title: this.notes.get(path)?.meta.label ?? titleFromPath(path), items }));
  }

  /** A note's body links resolved, in meta.links order (null where the note isn't written yet). */
  private outLinks(path: string): (string | null)[] {
    if (this.outAt !== this.changes) {
      this.outAt = this.changes;
      this.outCache.clear();
    }
    let kept = this.outCache.get(path);
    if (!kept) {
      const note = this.notes.get(path);
      kept = note ? note.meta.links.map((l) => this.resolve(l.target, path)) : [];
      this.outCache.set(path, kept);
    }
    return kept;
  }

  /** A note's folded words for search, kept until the note changes. */
  private folds(note: IndexedNote): FoldedDoc {
    return (note.folded ??= foldedDocOf(note.meta.title, note.content));
  }

  /** How the notes (outside the left-out folders) and projects are connected: links, a project's own notes, shared
   * people and tags, mentions, and projects that go together. Kept until a note changes. */
  relations(): Relations {
    if (!this.relationsCache) {
      const notes = [...this.notes.values()].filter((n) => !this.isExcluded(n.meta.path) && !isPrivatePath(n.meta.path));
      this.relationsCache = computeRelations(
        notes.map((n) => ({
          path: n.meta.path,
          label: n.meta.label,
          content: n.content,
          props: n.meta.props,
          tags: n.meta.tags,
          aliases: n.meta.aliases,
          // A list file's own row lines belong to their rows (the rows link as rows, never the file twice).
          links: this.outLinks(n.meta.path).filter((t, i): t is string => !!t && !this.isExcluded(t) && !this.rowLineOf(n, n.meta.links[i]?.line ?? -1)),
        })),
        this.relationWords,
      );
    }
    return this.relationsCache;
  }

  /** The connected vault (src/shared/records.ts): every project item as a record, and how they join. Built when asked
   *  for, again after any change; private notes and the left-out folders are never in it. */
  private recordCache: { at: number; key: string; model: RecordModel } | null = null;
  /** The same for each agent's gate (src/main/agent-gate.ts): only what that agent may read, kept apart by `allowKey`. */
  private gatedRecords = new Map<string, { at: number; key: string; model: RecordModel }>();
  records(opts: { templatesFolder?: string; me?: string | null; today?: string; allow?: (path: string) => boolean; allowKey?: string } = {}): RecordModel {
    const today = opts.today ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const key = `${opts.templatesFolder ?? ''}\n${opts.me ?? ''}\n${today}\n${this.filePaths.size}`;
    if (opts.allow) {
      const kept = opts.allowKey ? this.gatedRecords.get(opts.allowKey) : undefined;
      if (kept && kept.at === this.changes && kept.key === key) return kept.model;
      const { allow, allowKey, ...rest } = opts;
      const model = this.buildRecords(rest, today, (p) => allow(p));
      if (allowKey) {
        if (this.gatedRecords.size > 20) this.gatedRecords.clear();
        this.gatedRecords.set(allowKey, { at: this.changes, key, model });
      }
      return model;
    }
    if (this.recordCache && this.recordCache.at === this.changes && this.recordCache.key === key) return this.recordCache.model;
    const model = this.buildRecords(opts, today, () => true);
    this.recordCache = { at: this.changes, key, model };
    return model;
  }

  private buildRecords(opts: { templatesFolder?: string; me?: string | null }, today: string, allow: (path: string) => boolean): RecordModel {
    const open = (p: string) => !this.isExcluded(p) && !isPrivatePath(p) && allow(p);
    return buildRecordModel({
      notes: [...this.notes.values()].filter((n) => open(n.meta.path)).map((n) => ({ path: n.meta.path, title: n.meta.title, label: n.meta.label, content: n.content, props: n.meta.props, mtime: n.meta.mtime })),
      files: [...this.filePaths].filter(open),
      resolve: (target, from) => {
        const p = this.resolveAny(target, from);
        return p && open(p) ? p : null;
      },
      today,
      me: opts.me ?? null,
      templatesFolder: opts.templatesFolder,
    });
  }

  private removeNames(path: string): void {
    const old = this.notes.get(path);
    if (!old) return;
    for (const name of [old.meta.title, ...old.meta.aliases]) {
      const key = normalizeTarget(name);
      const list = (this.byName.get(key) ?? []).filter((p) => p !== path);
      if (list.length) this.byName.set(key, list);
      else this.byName.delete(key);
    }
    const pathKey = normalizeTarget(path);
    const pathList = (this.byPathNorm.get(pathKey) ?? []).filter((p) => p !== path);
    if (pathList.length) this.byPathNorm.set(pathKey, pathList);
    else this.byPathNorm.delete(pathKey);
  }

  allMeta(): NoteMeta[] {
    return [...this.notes.values()].map((n) => n.meta).sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Every note's details without its links and headings (5 Nov 2026, v5-vault-speed): the boot list. Names,
   *  tags, aliases and properties ride whole; links and headings follow on the full list. Same notes, same order. */
  slimMeta(): NoteMeta[] {
    return [...this.notes.values()].map((n) => ({ ...n.meta, links: [], propLinks: [], headings: [] })).sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Resolves a link target the way wiki-style notes expect: an exact path if the
   * target contains a folder, otherwise a note title or alias. With several matches,
   * prefer one in the same folder as the linking note, then the shortest path.
   */
  resolve(target: string, fromPath?: string): string | null {
    const norm = normalizeTarget(target);
    if (!norm) return fromPath ?? null;
    if (norm.includes('/')) {
      // A path from the top, else from the note's folder (./ and ../ as written).
      if (!isRelativeTarget(target)) {
        const hit = this.byPathNorm.get(norm)?.[0];
        if (hit) return hit;
      }
      const joined = joinPath(folderOfPath(fromPath ?? ''), target);
      const relative = joined === null ? null : normalizeTarget(joined);
      if (relative) {
        const hit = this.byPathNorm.get(relative)?.[0];
        if (hit) return hit;
      }
    }
    const candidates = this.byName.get(norm.split('/').pop() ?? norm);
    if (!candidates?.length) return null;
    if (candidates.length === 1) return candidates[0];
    const dir = fromPath?.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
    const sameDir = candidates.find((p) => dir && p.startsWith(dir) && !p.slice(dir.length).includes('/'));
    return sameDir ?? [...candidates].sort((a, b) => a.length - b.length)[0];
  }

  backlinks(path: string): LineContext[] {
    this.rowsFresh();
    const out: LineContext[] = [];
    const isRow = this.rowPaths.has(path);
    for (const note of this.notes.values()) {
      if (note.meta.path === path) continue;
      const targets = this.outLinks(note.meta.path);
      note.meta.links.forEach((link, i) => {
        // A list file's own row lines belong to their rows (the row speaks for its facts, never the file twice).
        if (this.rowLineOf(note, link.line)) return;
        // A note linking a folded record links its row (notes always win: a note of the same name reads first).
        if (targets[i] === path || (isRow && targets[i] === null && this.resolveRow(link.target) === path)) {
          out.push({ source: note.meta.path, sourceTitle: note.meta.title, line: link.line, context: note.lines[link.line] ?? '' });
        }
      });
      // A property linking here is a link to this note too (its property and kind named, for the panel's words).
      for (const pl of note.meta.propLinks ?? []) {
        const resolved = this.resolve(pl.target, note.meta.path);
        if (resolved === path || (isRow && resolved === null && this.resolveRow(pl.target) === path)) {
          out.push({ source: note.meta.path, sourceTitle: note.meta.title, line: pl.line, context: note.lines[pl.line] ?? '', prop: pl.key, kind: pl.kind });
        }
      }
    }
    // Rows naming this note or row in their own facts link here too, exactly as their notes did.
    for (const [rowPath, targets] of this.rowTargets) {
      if (rowPath === path) continue;
      for (const t of targets) {
        if (this.resolve(t.target) === path || this.resolveRow(t.target) === path) {
          out.push({ source: rowPath, sourceTitle: this.rowTitles.get(rowPath) ?? rowPath, line: 0, context: t.words });
        }
      }
    }
    return out;
  }

  private linksTo(note: IndexedNote, path: string): boolean {
    if (this.outLinks(note.meta.path).some((t) => t === path)) return true;
    this.rowsFresh();
    return this.rowPaths.has(path) && note.meta.links.some((l) => this.resolve(l.target, note.meta.path) === null && this.resolveRow(l.target) === path);
  }

  /** The notes a note names in its own words, resolved (5 Nov 2026, v9-vault-truth: the project page's
   *  membership — a note the project file names belongs to it). */
  linksFrom(path: string): string[] {
    const note = this.notes.get(path);
    if (!note) return [];
    const out = new Set<string>();
    for (const l of note.meta.links) {
      const p = this.resolve(l.target, path);
      if (p && p !== path) out.add(p);
    }
    return [...out];
  }

  private namesFor(path: string): string[] {
    const meta = this.get(path);
    if (meta) return [meta.title, ...meta.aliases].filter((n) => n.length >= MIN_NAME_LENGTH);
    this.rowsFresh();
    const title = this.rowTitles.get(path);
    return title && title.length >= MIN_NAME_LENGTH ? [title] : [];
  }

  /** Lines in other notes that mention this note's title or an alias without linking to it. */
  unlinkedMentions(path: string): LineContext[] {
    const names = this.namesFor(path);
    if (!names.length) return [];
    const quick = new RegExp(names.map(escapeRegExp).join('|'), 'i');
    const out: LineContext[] = [];
    for (const note of this.notes.values()) {
      if (note.meta.path === path || this.isExcluded(note.meta.path) || this.linksTo(note, path) || !quick.test(note.content)) continue;
      note.lines.forEach((line, i) => {
        if (names.some((n) => findUnlinkedPhrase(line, n) >= 0)) {
          out.push({ source: note.meta.path, sourceTitle: note.meta.title, line: i, context: line });
        }
      });
    }
    return out.slice(0, 200);
  }

  /**
   * For auto-linking: phrases in `content` (the note being edited) that match another
   * note's title or alias and aren't linked yet. Only the first occurrence per target.
   */
  mentionsIn(path: string, content: string): Mention[] {
    const lines = content.split(/\r?\n/);
    const words = new Set(tokenize(content));
    const seen = new Set<string>();
    const out: Mention[] = [];
    const linked = new Set(extractLinks(content).map((l) => this.resolve(l.target, path)));
    for (const note of this.notes.values()) {
      const target = note.meta.path;
      if (target === path || linked.has(target) || this.isExcluded(target)) continue;
      for (const name of this.namesFor(target)) {
        // Cheap pre-filter: every word of the name must appear somewhere in the note.
        const nameWords = tokenize(name);
        if (!nameWords.length || !nameWords.every((w) => words.has(w))) continue;
        for (let i = 0; i < lines.length && !seen.has(target); i++) {
          const col = findUnlinkedPhrase(lines[i], name);
          if (col >= 0) {
            seen.add(target);
            out.push({ target, targetTitle: note.meta.title, phrase: lines[i].slice(col, col + name.length), line: i });
          }
        }
      }
    }
    return out.sort((a, b) => a.line - b.line).slice(0, 100);
  }

  /**
   * Notes and how they are connected (links, and what Ironleaf works out: a project's own notes, shared people and
   * tags, mentions, projects that go together), with the files they link to, the notes not written yet and every tag.
   * Notes in the templates folder are marked, for the graph to leave out unless asked.
   */
  graph(templatesFolder = ''): GraphData {
    const degree = new Map<string, number>();
    const links: GraphData['links'] = [];
    const unresolved = new Map<string, string>();
    const attachments = new Set<string>();
    const tags = new Set<string>();
    const seen = new Set<string>();
    const bump = (a: string, b: string) => {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    };
    const add = (source: string, target: string, kind: 'link' | 'tag') => {
      const key = `${source}\u0000${target}`;
      if (source === target || seen.has(key)) return;
      seen.add(key);
      links.push({ source, target, kind });
      bump(source, target);
    };
    const notes = [...this.notes.values()].filter((n) => !this.isExcluded(n.meta.path));
    // Links between notes come with the relations (one line per pair, every reason on it); files, notes not written yet
    // and tags are added here.
    const rel = this.relations();
    for (const r of rel.relations) {
      links.push({ source: r.source, target: r.target, kind: r.kinds[0], kinds: r.kinds, reasons: r.reasons, reasonKinds: r.reasonKinds, strength: Math.round(r.strength * 100) / 100 });
      bump(r.source, r.target);
    }
    this.rowsFresh();
    for (const note of notes) {
      const targets = this.outLinks(note.meta.path);
      note.meta.links.forEach((link, i) => {
        let target = targets[i];
        if (target) return;
        // A list file's own row lines belong to their rows (the rows link below, never the file twice).
        if (this.rowLineOf(note, link.line)) return;
        const file = this.resolveFile(link.target, note.meta.path);
        if (file && this.isExcluded(file)) return;
        if (file) {
          attachments.add(file);
          target = file;
        } else {
          // A folded record is a real place, not a missing note.
          const row = this.resolveRow(link.target);
          if (row) {
            add(note.meta.path, row, 'link');
            return;
          }
          target = `unresolved:${normalizeTarget(link.target)}`;
          unresolved.set(target, link.target);
        }
        add(note.meta.path, target, 'link');
      });
      for (const tag of note.meta.tags) {
        tags.add(tag);
        add(note.meta.path, `tag:${tag}`, 'tag');
      }
    }
    // Folded rows stand where their notes stood, their own facts linking on.
    for (const [rowPath, targets] of this.rowTargets) {
      for (const t of targets) {
        const to = this.resolve(t.target) ?? this.resolveRow(t.target);
        if (!to) {
          const missing = `unresolved:${normalizeTarget(t.target)}`;
          unresolved.set(missing, t.target);
          add(rowPath, missing, 'link');
          continue;
        }
        if (to === rowPath || this.isExcluded(to)) continue;
        add(rowPath, to, 'link');
      }
    }
    const templates = templatesFolder.replace(/^\/+|\/+$/g, '').toLowerCase();
    const isTemplate = (n: IndexedNote) => (!!templates && inFolder(n.meta.path, templates)) || /template/i.test(String(n.meta.props?.type ?? ''));
    // Card words for the graph's card map (29 Oct 2026): a due day, a summary line and a person's or meeting's
    // own words, read from the properties and the first words, plain text only.
    const propText = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, 80) : undefined); // a YAML date (unquoted) is its calendar day
    const summaryOf = (content: string): string | undefined => {
      // Plain words only (round 2): the one shared helper, so no HTML comment, mark or raw link reaches a card.
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!--[\s\S]*$/, ' ');
      const lines = body.split(/\r?\n/);
      const at = lines.findIndex((l) => /^##\s+(Summary|About|Overview)\b/i.test(l));
      for (let i = at >= 0 ? at + 1 : 0; i < lines.length; i++) { const t = plainText(lines[i]); if (t && !/^#{1,6}\s/.test(lines[i]) && !/^---/.test(t)) return t.slice(0, 140); if (at >= 0 && /^##\s/.test(lines[i]) && i > at + 1) break; }
      return undefined;
    };
    const cardWords = (n: IndexedNote) => {
      const p = n.meta.props ?? {};
      const summary = summaryOf(n.content);
      return {
        ...(propText(p.due) ? { due: propText(p.due) } : {}), ...(propText(p.status) ? { status: propText(p.status) } : {}),
        ...(summary ? { summary } : {}),
        ...(propText(p.role ?? p.position ?? p.job) ? { role: propText(p.role ?? p.position ?? p.job) } : {}),
        ...(propText(p.org ?? p.organisation ?? p.organization ?? p.company) ? { org: propText(p.org ?? p.organisation ?? p.organization ?? p.company) } : {}),
        ...(propText(p.date ?? p.when ?? p.start) ? { date: propText(p.date ?? p.when ?? p.start) } : {}),
      };
    };
    const nodes: GraphData['nodes'] = [
      ...notes.map((n) => ({
        id: n.meta.path,
        title: n.meta.label,
        exists: true,
        kind: 'note' as const,
        degree: degree.get(n.meta.path) ?? 0,
        ...(isProjectProps(n.meta.props) ? { project: true, health: String(n.meta.props.health ?? ''), notes: rel.noteCount.get(n.meta.path) ?? 0 } : {}),
        ...(isDocNote(n.meta.path, n.meta.props) && !isTemplate(n) ? { doc: true } : {}),
        ...(rel.owner.has(n.meta.path) ? { owner: rel.owner.get(n.meta.path) } : {}),
        ...(isTemplate(n) ? { template: true } : {}),
        ...(this.isQuiet(n.meta.path) ? { quiet: true } : {}),
        ...cardWords(n),
        tags: n.meta.tags,
      })),
      ...[...this.rowPaths].map((id) => ({ id, title: this.rowTitles.get(id) ?? id, exists: true, kind: 'note' as const, degree: degree.get(id) ?? 0, tags: [], ...(this.isQuiet(id.split('#')[0]) ? { quiet: true } : {}) })),
      ...[...attachments].map((id) => ({ id, title: id.split('/').pop() ?? id, exists: true, kind: 'file' as const, degree: degree.get(id) ?? 0, tags: [], ...(this.isQuiet(id) ? { quiet: true } : {}) })),
      ...[...unresolved].map(([id, title]) => ({ id, title, exists: false, kind: 'missing' as const, degree: degree.get(id) ?? 0, tags: [] })),
      ...[...tags].map((tag) => ({ id: `tag:${tag}`, title: `#${tag}`, exists: true, kind: 'tag' as const, degree: degree.get(`tag:${tag}`) ?? 0, tags: [] })),
    ];
    const data: GraphData = { nodes, links, generation: this.changes };
    const key = `${templatesFolder}\n${this.changes}`;
    this.graphSnaps = [...this.graphSnaps.filter((s) => s.key !== key), { key, gen: this.changes, data }].slice(-2);
    return data;
  }

  /**
   * The graph since the generation the window holds (5 Nov 2026, v5-vault-speed): one edit behind is only what
   * moved (src/shared/graph-delta.ts); anything else — the first draw, several edits behind, another templates
   * folder — is the whole graph. The window applies a delta onto what it holds.
   */
  graphSince(since: number, templatesFolder = ''): GraphSnapshot {
    const data = this.graph(templatesFolder);
    const prev = this.graphSnaps.find((s) => s.gen === since && s.key === `${templatesFolder}\n${since}`);
    if (prev && prev.data !== data) return { generation: data.generation ?? this.changes, delta: diffGraph(prev.data, data) };
    return { generation: data.generation ?? this.changes, full: data };
  }

  /** The links in a note (or a folded row's own facts), each with what it reaches (null when unwritten). */
  outgoing(path: string): OutgoingLink[] {
    this.rowsFresh();
    const note = this.notes.get(path);
    if (!note) {
      // A folded row's own links, from the facts that name them.
      const targets = this.rowTargets.get(path);
      if (!targets) return [];
      const seen = new Set<string>();
      const out: OutgoingLink[] = [];
      for (const t of targets) {
        const resolved = this.resolve(t.target) ?? this.resolveRow(t.target);
        const key = `${resolved ?? normalizeTarget(t.target)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ target: t.target, resolved, title: resolved ? (this.notes.get(resolved)?.meta.title ?? this.rowTitles.get(resolved) ?? resolved) : t.target, line: 0, embed: false });
      }
      return out;
    }
    const out: OutgoingLink[] = [];
    const seen = new Set<string>();
    for (const link of note.meta.links) {
      // A folded record is a real place, not a missing note (notes always win over rows of the same name).
      const resolved = this.resolveAny(link.target, path) ?? this.resolveRow(link.target);
      const key = `${resolved ?? normalizeTarget(link.target)}#${link.heading ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target: link.target, heading: link.heading, resolved, title: resolved ? (this.notes.get(resolved)?.meta.title ?? this.rowTitles.get(resolved) ?? resolved.split('/').pop() ?? resolved) : link.target, line: link.line, embed: link.embed });
    }
    return out;
  }

  /** Every tag with how many notes carry it. */
  tags(): TagCount[] {
    const counts = new Map<string, number>();
    for (const note of this.notes.values()) for (const tag of note.meta.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  private queryDoc(note: IndexedNote): QueryDoc {
    return { path: note.meta.path, title: note.meta.title, content: note.content, tags: note.meta.tags, props: note.meta.props };
  }

  /** The notes a search matches (for the graph's groups and filters). */
  query(query: string, limit = 5000): string[] {
    const root = parseQuery(query);
    if (!root) return [];
    const matcher = new QueryMatcher(root);
    const out: string[] = [];
    for (const note of this.notes.values()) {
      if (!this.isExcluded(note.meta.path) && matcher.matches(this.queryDoc(note), this.folds(note))) out.push(note.meta.path);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Search across the notes (src/shared/query.ts): words, "phrases", /patterns/, -excluded, OR, groups, file:, path:,
   * tag:, content:, line:, section:, task:, [property:value]. Each hit has up to `contextLines` matching lines
   * (5 Nov 2026, v5-vault-speed: 2, what the window shows, down from 6). Meaning hits come from the hashed
   * fallback; searchAsync uses the on-device model when it runs.
   */
  search(query: string, limit = 200, contextLines = 2): SearchHit[] {
    const ordered = this.wordSearch(query, limit, contextLines);
    // Similar meaning (2 Nov 2026, 10.0): paraphrase hits after the word matches, labelled, plain words only.
    if (ordered.length < limit && isMeaningQuery(query)) {
      const exclude = new Set(ordered.map((h) => h.path));
      const bag = meaningWords(query);
      for (const found of this.meaning.search(query, { limit: Math.min(MEANING_SEARCH_MAX, limit - ordered.length), exclude, min: MEANING_SEARCH_MIN })) {
        if (this.pushMeaningHit(ordered, found, bag, contextLines)) exclude.add(found.path);
      }
    }
    return ordered;
  }

  /**
   * Search with the on-device models (Wave 2, m10rerank): word matches first, then meaning from embeddings, then
   * hashed meaning for notes still being embedded — so first open never has a gap — each meaning hit confirmed
   * before it shows (v12search: nonsense finds nothing with the real model), then the top results re-scored by real
   * relevance (the reranker reads the question with each result; exact title matches stay first). Without the
   * models, exactly search().
   */
  async searchAsync(query: string, limit = 200, contextLines = 2): Promise<SearchHit[]> {
    const ordered = this.wordSearch(query, limit, contextLines);
    if (ordered.length < limit && isMeaningQuery(query)) {
      const exclude = new Set(ordered.map((h) => h.path));
      const bag = meaningWords(query);
      // Meaning candidates, confirmed before they show: embedding hits join exactly as before, then each is
      // confirmed (a strong cosine, else the reranker); hashed hits keep their cover gate further down.
      const cands: { path: string; score: number; embedded: boolean }[] = [];
      const queries = this.meaningSource?.queries() ?? null;
      if (queries) {
        try {
          const qv = await queries.embed(query);
          for (const found of this.meaning.searchVector(qv, { limit: Math.min(MEANING_SEARCH_MAX, limit - ordered.length), exclude, min: EMBED_SEARCH_MIN })) {
            cands.push({ ...found, embedded: true });
            exclude.add(found.path);
          }
        } catch {
          // The model stumbled on this query: the hashed fallback below still answers.
        }
        // Notes still being embedded answer from hashed meaning (none left once the build lands).
        if (ordered.length + cands.length < limit && this.meaning.hasTermVectors()) {
          for (const found of this.meaning.search(query, { limit: Math.min(MEANING_SEARCH_MAX, limit - ordered.length - cands.length), exclude, min: MEANING_SEARCH_MIN })) {
            cands.push({ ...found, embedded: false });
            exclude.add(found.path);
          }
        }
      } else {
        for (const found of this.meaning.search(query, { limit: Math.min(MEANING_SEARCH_MAX, limit - ordered.length), exclude, min: MEANING_SEARCH_MIN })) {
          cands.push({ ...found, embedded: false });
          exclude.add(found.path);
        }
      }
      const keep = await this.confirmMeaning(query, cands);
      cands.forEach((found, i) => {
        if (keep[i]) this.pushMeaningHit(ordered, found, bag, contextLines);
      });
    }
    return this.rerankTop(query, ordered);
  }

  /**
   * Which meaning candidates show (v12search, 2 Nov 2026: a meaning-only hit is confirmed before it shows, so
   * nonsense finds nothing with the real model). An embedding hit this similar shows unasked; a weaker one shows
   * only when the reranker confirms it (one batched run over the few that need it). Without the reranker (still
   * starting, busy, missing) the cosine bar decides alone. Hashed hits keep their cover gate, word hits never pass
   * through here. Private notes never reach the model: the whole confirmation is skipped if one ever appeared.
   */
  private async confirmMeaning(query: string, cands: readonly { path: string; score: number; embedded: boolean }[]): Promise<boolean[]> {
    const keep = cands.map((c) => !c.embedded || c.score >= EMBED_CONFIRM_MIN);
    const waits: number[] = [];
    for (let i = 0; i < keep.length; i++) if (!keep[i]) waits.push(i);
    const source = this.rerankSource;
    if (!waits.length || !source) return keep;
    if (cands.some((c) => isPrivatePath(c.path))) return keep;
    const texts = waits.map((i) => this.confirmText(cands[i].path));
    let scores: (number | null)[] | null;
    try {
      scores = await source.score(query, texts);
    } catch {
      return keep;
    }
    if (!scores || scores.length !== texts.length) return keep;
    waits.forEach((cand, j) => {
      const s = scores[j];
      if (typeof s === 'number' && s >= RERANK_CONFIRM_MIN) keep[cand] = true;
    });
    return keep;
  }

  /** What the reranker reads to confirm a meaning hit: its name with its opening lines (front matter off), cut like
   *  the re-scored texts. Best-match lines would read empty here: a true paraphrase shares no words to match. */
  private confirmText(path: string): string {
    const title = this.notes.get(path)?.meta.label ?? titleFromPath(path);
    let content = this.notes.get(path)?.content ?? '';
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---', 3);
      if (end > 0) content = content.slice(end + 4);
    }
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
    return `${title}\n${lines.join('\n')}`.slice(0, RERANK_MAX_TEXT_CHARS);
  }

  /**
   * The top results re-scored by real relevance (m10rerank): the cross-encoder reads the question with each
   * result's title and best lines, mixed with today's rank so exact title matches stay first. Without the model
   * (or while it scores another search), the list is exactly as it was.
   */
  private async rerankTop(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
    const source = this.rerankSource;
    if (!source || hits.length < 2) return hits;
    const top = hits.slice(0, RERANK_MAX);
    // Fail closed: a private path never reaches the model (word and meaning hits already exclude them, so this
    // only trips on a slip further up — and then the whole rerank is skipped, not just that hit).
    if (top.some((h) => isPrivatePath(h.path))) return hits;
    const texts = top.map((h) => `${h.title}\n${h.snippets.map((s) => s.text).join('\n')}`.slice(0, RERANK_MAX_TEXT_CHARS));
    let scores: (number | null)[] | null;
    try {
      scores = await source.score(query, texts);
    } catch {
      return hits;
    }
    if (!scores || scores.length !== top.length) return hits;
    return [...applyRerank(query, top, (h) => h.title, scores), ...hits.slice(top.length)];
  }

  /** A meaning hit onto the list (labelled, with its best lines): false when the note is gone or left out. */
  private pushMeaningHit(ordered: SearchHit[], found: { path: string; score: number }, bag: MeaningBag, contextLines: number): boolean {
    const note = this.notes.get(found.path);
    if (!note || this.isExcluded(found.path) || isPrivatePath(found.path)) return false;
    // A true paraphrase shares no idea with the query, so its best lines read empty (6 Nov 2026,
    // find-by-meaning): its opening lines preview instead, and it reads as an ordinary hit.
    const best = bestLines(note.content, bag, Math.min(2, contextLines));
    const lines = best.length ? best : openingLines(note.content, Math.min(2, contextLines));
    const snippets = lines.map(({ line, text }) => trimSnippet(text, line, []));
    ordered.push({ path: found.path, title: note.meta.label, score: found.score, snippets, matches: 0, mtime: note.meta.mtime, meaning: true });
    return true;
  }

  /** The word matches, best first (shared by search and searchAsync: the meaning each adds differs). */
  private wordSearch(query: string, limit: number, contextLines: number): SearchHit[] {
    const root = parseQuery(query);
    if (!root) return [];
    const matcher = new QueryMatcher(root);
    const hits: SearchHit[] = [];
    for (const note of this.notes.values()) {
      if (this.isExcluded(note.meta.path) || isPrivatePath(note.meta.path)) continue;
      const doc = this.queryDoc(note);
      const folded = this.folds(note);
      if (!matcher.matches(doc, folded)) continue;
      const snippets: SearchHit['snippets'] = [];
      let matches = 0;
      if (matcher.positives.length) {
        // The lines that show the match best first: most hits, prose before fenced code, then file order (9.2).
        const found: { line: string; i: number; ranges: [number, number][]; fenced: boolean }[] = [];
        let fence = false;
        note.lines.forEach((line, i) => {
          if (/^(```|~~~)/.test(line.trim())) fence = !fence;
          const ranges = matcher.ranges(line);
          if (!ranges.length) return;
          matches += ranges.length;
          found.push({ line, i, ranges, fenced: fence });
        });
        found.sort((a, b) => Number(a.fenced) - Number(b.fenced) || b.ranges.length - a.ranges.length || a.i - b.i);
        for (const f of found.slice(0, contextLines)) snippets.push(trimSnippet(f.line, f.i, f.ranges));
      }
      hits.push({ path: note.meta.path, title: note.meta.label, score: 0, snippets, matches, mtime: note.meta.mtime });
    }
    // Best match first (21 Oct 2026, gap G25): BM25F over each note's name, headings, properties and words, with a
    // little more for notes changed lately and notes others link to (src/shared/ranking.ts). A search with no words in it
    // (a tag:, a [property], a /pattern/) ranks by its old reading, with the same boosts.
    if (hits.length) {
      const ranker = this.ranked();
      const words = rankWords(matcher.positives.map((p) => p.text ?? '').join(' '));
      const now = Date.now();
      for (const h of hits) {
        const note = this.notes.get(h.path)!;
        // What the person wrote ranks above a pack's records for the same words (5 Nov 2026, "your notes are
        // yours"); records are still found, and an exact name still lands (the title bonus is not shared).
        const share = isRecordProps(note.meta.props) ? RECORD_SHARE : 1;
        const ranked = words.length ? ranker.score(h.path, words, now, share) : 0;
        h.score = ranked > 0 ? ranked : ((matcher.score(this.queryDoc(note), this.folds(note)) / 10) * recencyBoost(note.meta.mtime, now) * linkBoost(ranker.linksTo(h.path)) * share);
      }
    }
    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }

  /** The ranking's words, up to date with the notes (outside the left-out folders, never private notes). */
  private ranked(): Ranker {
    const self = this;
    this.ranker.sync(
      this.changes,
      (function* () {
        for (const n of self.notes.values()) {
          if (self.isExcluded(n.meta.path) || isPrivatePath(n.meta.path)) continue;
          yield { path: n.meta.path, title: n.meta.title, aliases: n.meta.aliases, headings: n.meta.headings, props: n.meta.props, tags: n.meta.tags, content: n.content, mtime: n.meta.mtime };
        }
      })(),
      (p) => this.outLinks(p).filter((t): t is string => !!t),
    );
    return this.ranker;
  }

  /** How many notes link to each, by the ranking's count (for suggestions made on the main side). */
  linkCount(path: string): number {
    return this.ranked().linksTo(path);
  }

  /**
   * The notes most like this one (21 Oct 2026, gap G25; src/shared/related.ts): links between them and to the same notes,
   * shared tags, shared telling words, and similar meaning (2 Nov 2026, 10.0: on this PC only), each with why. Private
   * notes are never in it. Worked out on this PC; `skip` leaves out notes never suggested.
   */
  relatedNotes(path: string, limit = 12, skip?: (path: string) => boolean): RelatedItem[] {
    const note = this.notes.get(path);
    if (!note || isPrivatePath(path)) return [];
    const ranker = this.ranked();
    const docs = [...this.notes.values()]
      .filter((n) => !this.isExcluded(n.meta.path) && !this.isQuiet(n.meta.path) && !isPrivatePath(n.meta.path))
      .map((n) => {
        // Body links and property links alike (a runbook's `for:`, a service's `runs_on:`): backlinks counts
        // both as links to a note, so Related does too.
        const links = new Set(this.outLinks(n.meta.path).filter((t): t is string => !!t));
        for (const pl of n.meta.propLinks ?? []) {
          const t = this.resolve(pl.target, n.meta.path);
          if (t && t !== n.meta.path) links.add(t);
        }
        return { path: n.meta.path, title: n.meta.label || n.meta.title, tags: n.meta.tags, links: [...links] };
      });
    const words = (p: string) => {
      const c = ranker.counts(p);
      if (!c) return undefined;
      let m = this.relatedWords.get(c);
      if (!m) {
        // A note's name counts twice; its headings and words once (properties say what kind, not what about).
        m = new Map<string, number>();
        for (const [w, k] of c.tf.title) m.set(w, (m.get(w) ?? 0) + 2 * k);
        for (const f of ['headings', 'body'] as const) for (const [w, k] of c.tf[f]) m.set(w, (m.get(w) ?? 0) + k);
        this.relatedWords.set(c, m);
      }
      return m;
    };
    const vectors = (p: string): readonly number[] | null => this.meaning.vectors(p);
    // A record is related only when one links to the other (5 Nov 2026, "your notes are yours"): lookalikes
    // sharing template words never list in the foot (one engine, t27-unused-panels: the side panel is gone).
    const isRecord = (p: string): boolean => isRecordProps(this.notes.get(p)?.meta.props);
    return relatedTo(path, docs, { words, rarity: (w) => ranker.rarity(w), vectors, limit, skip, isRecord });
  }

  private refreshStats(): void {
    if (!this.statsDirty) return;
    this.df.clear();
    let total = 0;
    let count = 0;
    for (const note of this.notes.values()) {
      for (const chunk of note.chunks) {
        count++;
        total += chunk.length;
        for (const term of chunk.tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    this.chunkCount = count;
    this.avgLength = count ? total / count : 1;
    this.statsDirty = false;
  }

  private bm25(chunk: Chunk, terms: string[]): number {
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    for (const term of terms) {
      const tf = chunk.tf.get(term);
      if (!tf) continue;
      const df = this.df.get(term) ?? 0;
      const idf = Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * chunk.length) / this.avgLength));
    }
    return score;
  }

  /** Best-matching note sections for a question, for chat-with-your-vault (kept-out folders read past: the
   *  all-notes scope leaves them out, while the open note itself still arrives whole when it is one). */
  retrieve(query: string, limit = 8, maxChars = 24000): RetrievedChunk[] {
    this.refreshStats();
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const scored: RetrievedChunk[] = [];
    for (const note of this.notes.values()) {
      if (this.isExcluded(note.meta.path) || this.isQuiet(note.meta.path)) continue;
      for (const chunk of note.chunks) {
        const score = this.bm25(chunk, terms);
        if (score > 0) scored.push({ path: chunk.path, title: note.meta.title, section: chunk.section, text: chunk.text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const out: RetrievedChunk[] = [];
    let chars = 0;
    for (const c of scored) {
      if (out.length >= limit || chars + c.text.length > maxChars) break;
      out.push(c);
      chars += c.text.length;
    }
    return out;
  }

  /** Notes about the same things as this one, excluding notes it already links to: the same links, tags and words
   *  as the foot's Linked list (9.2: one answer everywhere, not a different "most related" per surface). */
  related(path: string, limit = 10): RelatedNote[] {
    const note = this.notes.get(path);
    if (!note) return [];
    const linked = new Set(this.outLinks(path));
    return this.relatedNotes(path, limit, (p) => linked.has(p)).map((r) => ({ path: r.path, title: r.title, score: r.score }));
  }
}
