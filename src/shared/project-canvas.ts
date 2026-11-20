// Project canvases (docs/PROJECTS-DESIGN.md): a project, or every project, laid out on a JSON Canvas board
// (jsoncanvas.org) and kept bound to the project files.
//
//   Projects/<Name>/<Name>.canvas      one project: its card in the middle; around it What's next, Key dates, Risks and
//                                      issues, People, Documents and Notes, each a group of cards drawn from the project
//                                      file; lines from the project to each group and between things that refer to
//                                      each other (a next step's person, a document a risk names, a step due on a key
//                                      date).
//   Projects/Portfolio board.canvas    every project as a card in columns by status (or by health); lines between
//                                      projects that share people or mention each other.
//
// Cards drawn from a project carry a `neuralvault` property saying what they show (JSON Canvas lets nodes, edges and the
// board carry extra properties; other readers ignore it and still see ordinary text, file and group cards). Everything
// here is pure: the window lays boards out and keeps them in step with the project files through these functions, and
// writes edits back through applyItemEdit (in the main process, beside src/main/projects.ts).

import { isFinished, readHealthTone } from './finished';
import { encodeLinkPath, replaceMarkdownLinks, replaceWikilinks } from './markdown';
import { HEADINGS, parseProject, type Project, type ProjectDate, type ProjectDocument, type ProjectNext, type ProjectPerson, type ProjectRisk } from './project-file';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export type BoundSection = 'next' | 'dates' | 'people' | 'risks' | 'documents' | 'notes';
export type ItemSection = Exclude<BoundSection, 'notes'>;
export type ProjectItem = ProjectNext | ProjectDate | ProjectPerson | ProjectRisk | ProjectDocument;

export type NodeBinding =
  | { part: 'project'; project: string }
  | { part: 'group'; section: BoundSection }
  | { part: 'item'; section: ItemSection; key: string; index: number }
  | { part: 'notes' }
  /** A file in the project's folder on the PC (dropped onto the canvas, copied there). */
  | { part: 'file'; rel: string }
  | { part: 'column'; key: string }
  | { part: 'portfolio-project'; project: string }
  /** A doc's canvas (src/shared/doc-canvas.ts): the doc's own card, and a card per section opening the doc there. */
  | { part: 'doc'; doc: string }
  | { part: 'section'; doc: string; heading: string };

export interface EdgeBinding {
  auto: 'group' | 'ref' | 'related' | 'section';
  key: string;
}

export type BoardMeta =
  | { kind: 'project'; project: string; hidden?: string[] }
  | { kind: 'portfolio'; groupBy: PortfolioGroupBy; hidden?: string[] }
  /** A doc's canvas (src/shared/doc-canvas.ts): its card in the middle, a card per section, kept in step on request. */
  | { kind: 'doc'; doc: string; hidden?: string[] };

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  neuralvault?: NodeBinding;
  [extra: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: 'none' | 'arrow';
  toNode: string;
  toSide?: Side;
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
  neuralvault?: EdgeBinding;
  [extra: string]: unknown;
}

export interface CanvasBoard {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  neuralvault?: BoardMeta;
  [extra: string]: unknown;
}

/** Reading a board file's text (5 Nov 2026, u3 moving-in: a corrupt foreign canvas opened as "An empty canvas" with
 *  no warning, and the first save destroyed the bytes). Damaged means not JSON, not a board object, or cards/links
 *  present but not lists — the reason the parser's own, trimmed. An empty file is an empty board, not damage. */
export function readBoardText(text: string): { board: CanvasBoard; damaged: boolean; reason: string } {
  const empty = { nodes: [], edges: [] };
  const raw = String(text ?? '');
  if (!raw.trim()) return { board: { ...empty }, damaged: false, reason: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const words = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim().slice(0, 160);
    return { board: { ...empty }, damaged: true, reason: words || 'it isn’t readable JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { board: { ...empty }, damaged: true, reason: 'it isn’t a board object' };
  }
  const p = parsed as Partial<CanvasBoard>;
  if ((p.nodes !== undefined && !Array.isArray(p.nodes)) || (p.edges !== undefined && !Array.isArray(p.edges))) {
    return { board: { ...empty }, damaged: true, reason: 'its cards or links aren’t lists' };
  }
  const nodes = (Array.isArray(p.nodes) ? p.nodes : []).filter((n): n is CanvasNode => !!n && typeof n.id === 'string' && typeof n.x === 'number' && typeof n.y === 'number');
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(p.edges) ? p.edges : []).filter((e): e is CanvasEdge => !!e && typeof e.id === 'string' && ids.has(e.fromNode) && ids.has(e.toNode));
  return { board: { ...p, nodes: nodes.map((n) => ({ ...n, width: n.width || 250, height: n.height || 60 })), edges }, damaged: false, reason: '' };
}

export const SECTION_TITLES: Record<BoundSection, string> = {
  next: HEADINGS.next,
  dates: HEADINGS.dates,
  people: HEADINGS.people,
  risks: HEADINGS.risks,
  documents: HEADINGS.documents,
  notes: HEADINGS.notes,
};
export const ITEM_SECTIONS: ItemSection[] = ['next', 'dates', 'risks', 'people', 'documents'];
/** Colours (JSON Canvas presets) for each group, so a board reads at a glance. */
export const SECTION_COLOURS: Record<BoundSection, string | undefined> = { next: '5', dates: '6', risks: '2', people: '4', documents: undefined, notes: '3' };
export const RISK_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

// ── Sizes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CARD_W = 300;
export const GAP = 16;
export const PAD = 24;
export const PAD_TOP = 24;
const RING = 120;
/** The space a group's name takes above it. */
const LABEL_ROOM = 44;
export const CENTRE = { w: 440, h: 272 };
export const PICTURE_H = 220;
const HEIGHTS: Record<BoundSection, number> = { next: 96, dates: 72, people: 64, risks: 96, documents: 72, notes: 160 };
const EMPTY_GROUP_H = 120;
export const groupWidth = (section: BoundSection) => (section === 'documents' ? 2 * CARD_W + GAP + 2 * PAD : CARD_W + 2 * PAD);

export const isPicture = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p);

// ── Ids: the same fact always gets the same id, so two windows showing a board never make two cards for it ──────

function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export const boundId = (...parts: string[]) => `nv${hash(parts.join('\u0000'))}`.slice(0, 16);

// ── Items: what each card shows, how it reads in the file, how it's edited ─────────────────────────────────────────

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[*_`~[\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const clean = (s: unknown, max = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function itemsOf(p: Project, section: ItemSection): ProjectItem[] {
  return p[section];
}

/** What identifies a fact in its section (its words, without marks): edits that keep it find it again. */
export function itemKey(section: ItemSection, item: ProjectItem): string {
  switch (section) {
    case 'next':
      return norm((item as ProjectNext).what);
    case 'dates':
      return norm(`${(item as ProjectDate).when} ${(item as ProjectDate).what}`);
    case 'people':
      return norm((item as ProjectPerson).name);
    case 'risks':
      return norm((item as ProjectRisk).what);
    case 'documents':
      return norm((item as ProjectDocument).path);
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The fact as a Markdown line, as the project file writes it: the card's text in the .canvas file. */
export function itemMarkdown(section: ItemSection, item: ProjectItem): string {
  switch (section) {
    case 'next': {
      const n = item as ProjectNext;
      const tail = [n.who ?? '', n.when ? `by ${n.when}` : ''].filter(Boolean).join(' · ');
      return `- [${n.done ? 'x' : ' '}] ${n.what}${tail ? ` — ${tail}` : ''}`;
    }
    case 'dates': {
      const d = item as ProjectDate;
      return `**${d.when}** — ${d.what}${d.status ? ` · ${d.status}` : ''}`;
    }
    case 'people': {
      const x = item as ProjectPerson;
      return `**${x.name}**${x.role ? ` — ${x.role}` : ''}`;
    }
    case 'risks': {
      const r = item as ProjectRisk;
      return `${r.level ? `**${capital(r.level)}** — ` : ''}${r.what}`;
    }
    case 'documents': {
      const d = item as ProjectDocument;
      return `\`${d.path}\`${d.what ? ` — ${d.what}` : ''}`;
    }
  }
}

/** A card's Markdown line read back as the fact (the project file's own reading, so the two never disagree). */
export function parseItem(section: ItemSection, line: string): ProjectItem | null {
  const text = String(line ?? '').trim();
  if (!text) return null;
  if (section === 'dates') {
    const m = /^\*\*(.+?)\*\*\s*[—–-]\s*(.*)$/.exec(text) ?? /^(.+?)\s+[—–]\s+(.*)$/.exec(text);
    if (!m) return { when: '', what: text };
    const rest = m[2].trim();
    const at = rest.lastIndexOf(' · ');
    return at > 0 ? { when: m[1].trim(), what: rest.slice(0, at).trim(), status: rest.slice(at + 3).trim() } : { when: m[1].trim(), what: rest };
  }
  const bullet = /^\s*[-*+]\s/.test(text) ? text : `- ${text}`;
  const p = parseProject(`# x\n\n## ${HEADINGS[section]}\n\n${bullet}\n`);
  return (p[section][0] as ProjectItem | undefined) ?? null;
}

/** The words a person edits on a card (marks like the tick box and the risk level are changed with a click). */
export function itemWords(section: ItemSection, item: ProjectItem): string {
  switch (section) {
    case 'next': {
      const n = item as ProjectNext;
      const tail = [n.who ?? '', n.when ? `by ${n.when}` : ''].filter(Boolean).join(' · ');
      return `${n.what}${tail ? ` — ${tail}` : ''}`;
    }
    case 'dates': {
      const d = item as ProjectDate;
      return `${d.when} — ${d.what}`;
    }
    case 'people': {
      const x = item as ProjectPerson;
      return `${x.name}${x.role ? ` — ${x.role}` : ''}`;
    }
    case 'risks':
      return (item as ProjectRisk).what;
    case 'documents':
      return (item as ProjectDocument).what ?? '';
  }
}

/** The fact with the person's edited words (what isn't in the words, like a tick or a level, is kept). */
export function withWords(section: ItemSection, item: ProjectItem, words: string): ProjectItem | null {
  const w = clean(words);
  switch (section) {
    case 'next': {
      if (!w) return null;
      const n = parseItem('next', `- [ ] ${w}`) as ProjectNext | null;
      return n ? { ...n, done: (item as ProjectNext).done } : null;
    }
    case 'dates': {
      if (!w) return null;
      const m = /^(.+?)\s+[—–-]\s+(.*)$/.exec(w);
      const d = item as ProjectDate;
      return { when: m ? m[1].trim() : d.when, what: m ? m[2].trim() : w, ...(d.status ? { status: d.status } : {}) };
    }
    case 'people': {
      if (!w) return null;
      const m = /^(.+?)\s+[—–-]\s+(.*)$/.exec(w);
      return m ? { name: m[1].trim(), ...(m[2].trim() ? { role: m[2].trim() } : {}) } : { name: w };
    }
    case 'risks':
      return w ? { ...(item as ProjectRisk), what: w } : null;
    case 'documents':
      return { path: (item as ProjectDocument).path, ...(w ? { what: w } : {}) };
  }
}

/** A fact from the window, made safe to write (only the fields its section has, words trimmed). */
export function sanitiseItem(section: ItemSection, raw: unknown): ProjectItem | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const opt = (k: string, max = 120) => (clean(r[k], max) ? { [k]: clean(r[k], max) } : {});
  switch (section) {
    case 'next':
      return clean(r.what) ? { done: r.done === true, what: clean(r.what, 400), ...opt('who', 80), ...opt('when', 40) } : null;
    case 'dates':
      return clean(r.what) || clean(r.when) ? { when: clean(r.when, 40) || '—', what: clean(r.what, 300), ...opt('status', 40) } : null;
    case 'people':
      return clean(r.name) ? { name: clean(r.name, 120), ...opt('role', 200) } : null;
    case 'risks': {
      const level = clean(r.level, 20).toLowerCase();
      return clean(r.what) ? { ...((RISK_LEVELS as readonly string[]).includes(level) ? { level } : {}), what: clean(r.what, 400) } : null;
    }
    case 'documents':
      return clean(r.path) ? { path: clean(r.path, 300), ...opt('what', 300) } : null;
  }
  return null;
}

export type ItemEdit =
  | { op: 'replace'; section: ItemSection; key: string; index: number; item: ProjectItem }
  | { op: 'add'; section: ItemSection; item: ProjectItem }
  | { op: 'remove'; section: ItemSection; key: string; index: number }
  | { op: 'notes'; text: string };

/** Where a card's fact is in the project now: by its words, else where it was (the words changed elsewhere). */
export function findItem(p: Project, section: ItemSection, key: string, index: number): number {
  const items = itemsOf(p, section);
  const byKey = items.findIndex((it) => itemKey(section, it) === key);
  if (byKey >= 0) return byKey;
  return Number.isInteger(index) && index >= 0 && index < items.length ? index : -1;
}

/** An edit made on a canvas, applied to the project (the main process writes the file). Throws if the fact is gone. */
export function applyItemEdit(p: Project, raw: unknown): void {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (e.op === 'notes') {
    p.notes = String(e.text ?? '').replace(/\r\n/g, '\n').slice(0, 20000);
    return;
  }
  const section = e.section as ItemSection;
  if (!ITEM_SECTIONS.includes(section)) throw new Error('That change isn’t one Ironleaf knows.');
  const items = itemsOf(p, section) as ProjectItem[];
  if (e.op === 'add') {
    const item = sanitiseItem(section, e.item);
    if (!item) throw new Error('There are no words to add.');
    items.push(item);
    return;
  }
  const at = findItem(p, section, String(e.key ?? ''), Number(e.index));
  if (at < 0) throw new Error('That isn’t in the project any more.');
  if (e.op === 'remove') {
    items.splice(at, 1);
    return;
  }
  if (e.op === 'replace') {
    const item = sanitiseItem(section, e.item);
    if (!item) throw new Error('A card can’t be left without words.');
    items[at] = item;
    return;
  }
  throw new Error('That change isn’t one Ironleaf knows.');
}

// ── Where cards go ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlaps = (a: Rect, b: Rect, margin = 0) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
export const inside = (n: Rect, g: Rect) => n.x >= g.x - 1 && n.y >= g.y - 1 && n.x + n.width <= g.x + g.width + 1 && n.y + n.height <= g.y + g.height + 1;
const centreIn = (n: Rect, g: Rect) => n.x + n.width / 2 >= g.x && n.x + n.width / 2 <= g.x + g.width && n.y + n.height / 2 >= g.y && n.y + n.height / 2 <= g.y + g.height;

export function itemHeight(section: BoundSection, item?: ProjectItem): number {
  if (section === 'documents' && item && isPicture((item as ProjectDocument).path)) return PICTURE_H;
  return HEIGHTS[section];
}

/**
 * A place for a new card in a group: the first free slot inside it (rows top to bottom, columns left to right), else
 * just below what's in it (the group grows down), else a new column on its right when growing down would run into
 * something. Nothing already on the board moves. Returns the place and the group as it now is.
 */
export function placeInGroup(nodes: CanvasNode[], group: CanvasNode, w: number, h: number): { x: number; y: number; group: CanvasNode } {
  const others = nodes.filter((n) => n.id !== group.id && n.type !== 'group');
  const members = others.filter((n) => inside(n, group));
  const cols = Math.max(1, Math.floor((group.width - 2 * PAD + GAP) / (w + GAP)));
  const ys = [...new Set([group.y + PAD_TOP, ...members.map((m) => m.y + m.height + GAP)])].sort((a, b) => a - b);
  for (const y of ys)
    for (let c = 0; c < cols; c++) {
      const r = { x: group.x + PAD + c * (w + GAP), y, width: w, height: h };
      if (r.y + h <= group.y + group.height - PAD + 1 && !others.some((n) => overlaps(r, n))) return { x: r.x, y: r.y, group };
    }
  const bottom = Math.max(group.y + PAD_TOP - GAP, ...members.map((m) => m.y + m.height));
  const down = { x: group.x + PAD, y: bottom + GAP, width: w, height: h };
  const grown = { ...group, height: Math.max(group.height, down.y + h + PAD - group.y) };
  const strangers = nodes.filter((n) => n.id !== group.id && !inside(n, group));
  // Room is kept for the next group's name, which sits above it.
  const withName = (n: CanvasNode): Rect => (n.type === 'group' ? { x: n.x, y: n.y - LABEL_ROOM, width: n.width, height: n.height + LABEL_ROOM } : n);
  const blocked = (g: Rect) => strangers.some((n) => overlaps(g, withName(n), 8) && !(n.type === 'group' && inside(g, n)));
  if (!blocked(grown) && !others.some((n) => overlaps(down, n))) return { x: down.x, y: down.y, group: grown };
  // A new column beside it: on the right, else on the left.
  const tall = Math.max(group.height, PAD_TOP + h + PAD);
  const right = { x: group.x + group.width - PAD + GAP, y: group.y + PAD_TOP, width: w, height: h };
  const wider = { ...group, width: group.width + w + GAP, height: tall };
  if (!blocked(wider) && !others.some((n) => overlaps(right, n))) return { x: right.x, y: right.y, group: wider };
  const leftward = { ...group, x: group.x - w - GAP, width: group.width + w + GAP, height: tall };
  const left = { x: leftward.x + PAD, y: group.y + PAD_TOP, width: w, height: h };
  if (!blocked(leftward) && !others.some((n) => overlaps(left, n))) return { x: left.x, y: left.y, group: leftward };
  return { x: down.x, y: down.y, group: grown };
}

/** A free place for a new group: where it would go, else to the right of everything. */
export function freeSpot(nodes: CanvasNode[], want: Rect): { x: number; y: number } {
  if (!nodes.some((n) => overlaps(want, n, 40))) return { x: want.x, y: want.y };
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  return { x: Math.round((maxX + RING) / 20) * 20, y: want.y };
}

// ── References inside a project ────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'final', 'draft', 'copy', 'new', 'old']);
const words = (s: string) => norm(s).split(' ').filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
const docWords = (path: string) =>
  words(
    (path.split(/[\\/]/).pop() ?? path)
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/[_.-]+/g, ' '),
  );

/** "17 Oct", "17 October 2026", "2026-10-17" as month-day, to tell a step due on a key date. */
export function dayOf(text?: string): string | null {
  if (!text) return null;
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${Number(iso[2])}-${Number(iso[3])}`;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dm = /(\d{1,2})\s+([A-Za-z]{3})/.exec(t);
  if (dm) {
    const m = MONTHS.indexOf(dm[2].toLowerCase());
    if (m >= 0) return `${m + 1}-${Number(dm[1])}`;
  }
  return null;
}

export interface Reference {
  from: { section: ItemSection; key: string };
  to: { section: ItemSection; key: string };
}

/**
 * Where the project file says one thing refers to another: a next step's person (who) is one of its People; a step,
 * risk or date names one of its Documents (most of the document's distinctive words); a step is due on a key date.
 */
export function references(p: Project): Reference[] {
  const out: Reference[] = [];
  const people = p.people.map((x) => ({ key: itemKey('people', x), full: norm(x.name), first: norm(x.name).split(' ')[0] }));
  for (const n of p.next) {
    if (!n.who) continue;
    for (const who of n.who.split(/,|&|\band\b/i).map(norm).filter(Boolean)) {
      const hit = people.find((x) => x.full === who || x.first === who || (who.includes(' ') && x.full.startsWith(who)));
      if (hit) out.push({ from: { section: 'next', key: itemKey('next', n) }, to: { section: 'people', key: hit.key } });
    }
  }
  const docs = p.documents.map((d) => ({ key: itemKey('documents', d), words: docWords(d.path) })).filter((d) => d.words.length);
  const mentions = (section: ItemSection, item: ProjectItem, text: string) => {
    const have = new Set(words(text));
    for (const d of docs) {
      const found = d.words.filter((w) => have.has(w)).length;
      if (found >= Math.min(2, d.words.length) && found / d.words.length >= 0.6) out.push({ from: { section, key: itemKey(section, item) }, to: { section: 'documents', key: d.key } });
    }
  };
  for (const n of p.next) mentions('next', n, n.what);
  for (const r of p.risks) mentions('risks', r, r.what);
  for (const d of p.dates) mentions('dates', d, d.what);
  for (const n of p.next) {
    const day = dayOf(n.when);
    if (!day) continue;
    const d = p.dates.find((x) => dayOf(x.when) === day);
    if (d) out.push({ from: { section: 'next', key: itemKey('next', n) }, to: { section: 'dates', key: itemKey('dates', d) } });
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.from.section}:${r.from.key}>${r.to.section}:${r.to.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── A project's board ──────────────────────────────────────────────────────────────────────────────────────────────

const groupHeight = (section: BoundSection, p: Project) => {
  if (section === 'notes') return PAD_TOP + HEIGHTS.notes + PAD;
  const items = itemsOf(p, section);
  if (!items.length) return EMPTY_GROUP_H;
  if (section === 'documents') {
    // Two columns: each card goes in the shorter one.
    const cols = [0, 0];
    for (const it of items) {
      const c = cols[0] <= cols[1] ? 0 : 1;
      cols[c] += itemHeight(section, it) + GAP;
    }
    return PAD_TOP + Math.max(...cols) - GAP + PAD;
  }
  return PAD_TOP + items.reduce((t, it) => t + itemHeight(section, it) + GAP, 0) - GAP + PAD;
};

/** Where each group goes first: steps and dates on the left, risks and people on the right, notes above, documents below. */
function groupRects(p: Project): Record<BoundSection, Rect> {
  const h = Object.fromEntries((['next', 'dates', 'risks', 'people', 'documents', 'notes'] as BoundSection[]).map((s) => [s, groupHeight(s, p)])) as Record<BoundSection, number>;
  const column = (top: BoundSection, bottom: BoundSection, x: number): [Rect, Rect] => {
    const total = h[top] + RING + h[bottom];
    const y0 = Math.round(-total / 2 / 20) * 20;
    return [
      { x, y: y0, width: groupWidth(top), height: h[top] },
      { x, y: y0 + h[top] + RING, width: groupWidth(bottom), height: h[bottom] },
    ];
  };
  const leftX = -CENTRE.w / 2 - RING - groupWidth('next');
  const rightX = CENTRE.w / 2 + RING;
  const [next, dates] = column('next', 'dates', leftX);
  const [risks, people] = column('risks', 'people', rightX);
  return {
    next,
    dates,
    risks,
    people,
    notes: { x: -groupWidth('notes') / 2, y: -CENTRE.h / 2 - RING - h.notes, width: groupWidth('notes'), height: h.notes },
    documents: { x: -groupWidth('documents') / 2, y: CENTRE.h / 2 + RING, width: groupWidth('documents'), height: h.documents },
  };
}

const projectCard = (projectPath: string): CanvasNode => ({
  id: boundId('project', projectPath),
  type: 'file',
  file: projectPath,
  x: -CENTRE.w / 2,
  y: -CENTRE.h / 2,
  width: CENTRE.w,
  height: CENTRE.h,
  neuralvault: { part: 'project', project: projectPath },
});

const groupNode = (section: BoundSection, r: Rect): CanvasNode => ({
  id: boundId('group', section),
  type: 'group',
  label: SECTION_TITLES[section],
  ...r,
  ...(SECTION_COLOURS[section] ? { color: SECTION_COLOURS[section] } : {}),
  neuralvault: { part: 'group', section },
});

const itemNode = (section: ItemSection, item: ProjectItem, index: number, at: { x: number; y: number }): CanvasNode => ({
  id: boundId('item', section, itemKey(section, item)),
  type: 'text',
  text: itemMarkdown(section, item),
  x: at.x,
  y: at.y,
  width: CARD_W,
  height: itemHeight(section, item),
  neuralvault: { part: 'item', section, key: itemKey(section, item), index },
});

const notesNode = (p: Project, at: { x: number; y: number }): CanvasNode => ({ id: boundId('notes'), type: 'text', text: p.notes, x: at.x, y: at.y, width: CARD_W, height: HEIGHTS.notes, neuralvault: { part: 'notes' } });

const groupEdge = (projectId: string, groupId: string, section: BoundSection): CanvasEdge => ({ id: boundId('edge', 'group', section), fromNode: projectId, toNode: groupId, toEnd: 'none', neuralvault: { auto: 'group', key: section } });

const refKey = (r: Reference) => `${r.from.section}:${r.from.key}>${r.to.section}:${r.to.key}`;

/** A project's board, laid out for the first time. */
export function layoutProject(p: Project, projectPath: string): CanvasBoard {
  const rects = groupRects(p);
  const centre = projectCard(projectPath);
  const nodes: CanvasNode[] = [];
  const groups: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  for (const section of ['next', 'dates', 'risks', 'people', 'documents', 'notes'] as BoundSection[]) {
    const g = groupNode(section, rects[section]);
    groups.push(g);
    edges.push(groupEdge(centre.id, g.id, section));
    if (section === 'notes') {
      nodes.push(notesNode(p, { x: g.x + PAD, y: g.y + PAD_TOP }));
      continue;
    }
    if (section === 'documents') {
      const cols = [g.y + PAD_TOP, g.y + PAD_TOP];
      p.documents.forEach((d, i) => {
        const c = cols[0] <= cols[1] ? 0 : 1;
        nodes.push(itemNode(section, d, i, { x: g.x + PAD + c * (CARD_W + GAP), y: cols[c] }));
        cols[c] += itemHeight(section, d) + GAP;
      });
      continue;
    }
    let y = g.y + PAD_TOP;
    itemsOf(p, section).forEach((it, i) => {
      nodes.push(itemNode(section, it, i, { x: g.x + PAD, y }));
      y += itemHeight(section, it) + GAP;
    });
  }
  const board: CanvasBoard = { nodes: [...groups, centre, ...nodes], edges, neuralvault: { kind: 'project', project: projectPath } };
  return syncProject(board, p, projectPath).board;
}

const bindingOf = (n: CanvasNode) => n.neuralvault;
const edgeBinding = (e: CanvasEdge) => e.neuralvault;

/** The key a hidden card or line is remembered by (taken off the board, kept in the project). */
export const hiddenKey = (b: NodeBinding | EdgeBinding | undefined): string | null => {
  if (!b) return null;
  if ('auto' in b) return `edge:${b.auto}:${b.key}`;
  if (b.part === 'item') return `item:${b.section}:${b.key}`;
  if (b.part === 'notes') return 'notes';
  if (b.part === 'group') return `group:${b.section}`;
  if (b.part === 'portfolio-project') return `project:${b.project}`;
  if (b.part === 'section') return `section:${b.heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
  return null;
};

/**
 * A project's board brought in step with its file: cards show the facts as they are now; facts that are gone go; new
 * facts appear in their group (in a free place, the group growing if it must) — and nothing the person arranged moves.
 * Their own cards, lines, sizes and colours stay as they are.
 */
export function syncProject(input: CanvasBoard, p: Project, projectPath: string): { board: CanvasBoard; changed: boolean } {
  const meta: BoardMeta = input.neuralvault?.kind === 'project' ? { ...input.neuralvault, project: projectPath } : { kind: 'project', project: projectPath };
  const hidden = new Set(meta.hidden ?? []);
  let nodes = input.nodes.map((n) => ({ ...n }));
  let edges = input.edges.map((e) => ({ ...e }));
  const rects = groupRects(p);
  const replace = (n: CanvasNode) => {
    nodes = nodes.map((x) => (x.id === n.id ? n : x));
  };

  // The project's own card.
  let centre = nodes.find((n) => bindingOf(n)?.part === 'project');
  if (!centre) {
    const fresh = projectCard(projectPath);
    const at = freeSpot(nodes, fresh);
    centre = { ...fresh, ...at };
    nodes.push(centre);
  } else if (centre.file !== projectPath) {
    centre = { ...centre, file: projectPath, neuralvault: { part: 'project', project: projectPath } };
    replace(centre);
  }

  // Its groups.
  const groupFor = (section: BoundSection): CanvasNode | undefined => {
    const found = nodes.find((n) => {
      const b = bindingOf(n);
      return b?.part === 'group' && b.section === section;
    });
    if (found || hidden.has(`group:${section}`)) return found;
    const g = groupNode(section, rects[section]);
    const at = freeSpot(nodes, g);
    const made = { ...g, ...at };
    nodes.unshift(made);
    if (!hidden.has(`edge:group:${section}`)) edges.push(groupEdge(centre!.id, made.id, section));
    return made;
  };

  const place = (section: BoundSection, w: number, h: number): { x: number; y: number } => {
    const g = groupFor(section);
    if (!g) {
      const at = freeSpot(nodes, { x: centre!.x + centre!.width + RING, y: centre!.y, width: w, height: h });
      return at;
    }
    const spot = placeInGroup(nodes, g, w, h);
    if (spot.group !== g) replace(spot.group);
    return { x: spot.x, y: spot.y };
  };

  // Facts, section by section: matched by their words, else by where they were (reworded elsewhere).
  for (const section of ITEM_SECTIONS) {
    const items = itemsOf(p, section);
    const cards = nodes.filter((n) => {
      const b = bindingOf(n);
      return b?.part === 'item' && b.section === section;
    });
    const taken = new Map<number, CanvasNode>();
    const left = new Set(cards.map((c) => c.id));
    items.forEach((it, i) => {
      const key = itemKey(section, it);
      const c = cards.find((x) => left.has(x.id) && (bindingOf(x) as { key: string }).key === key);
      if (c) {
        taken.set(i, c);
        left.delete(c.id);
      }
    });
    items.forEach((_, i) => {
      if (taken.has(i) || hidden.has(`item:${section}:${itemKey(section, items[i])}`)) return;
      const c = cards.find((x) => left.has(x.id) && (bindingOf(x) as { index: number }).index === i);
      if (c) {
        taken.set(i, c);
        left.delete(c.id);
      }
    });
    // Gone from the project: gone from the board, with their lines.
    if (left.size) {
      nodes = nodes.filter((n) => !left.has(n.id));
      edges = edges.filter((e) => !left.has(e.fromNode) && !left.has(e.toNode));
    }
    items.forEach((it, i) => {
      const key = itemKey(section, it);
      const text = itemMarkdown(section, it);
      const c = taken.get(i);
      if (c) {
        const b = bindingOf(c) as { key: string; index: number };
        if (c.text !== text || b.key !== key || b.index !== i) replace({ ...c, text, neuralvault: { part: 'item', section, key, index: i } });
        return;
      }
      if (hidden.has(`item:${section}:${key}`)) return;
      const h = itemHeight(section, it);
      const at = place(section, CARD_W, h);
      const n = itemNode(section, it, i, at);
      // An id already used (a card for this fact taken off and put back): a fresh one.
      if (nodes.some((x) => x.id === n.id)) n.id = boundId('item', section, key, String(Date.now()), String(i));
      nodes.push(n);
    });
  }

  // The person's notes.
  const notes = nodes.find((n) => bindingOf(n)?.part === 'notes');
  if (notes) {
    if ((notes.text ?? '') !== p.notes) replace({ ...notes, text: p.notes });
  } else if (!hidden.has('notes')) {
    const at = place('notes', CARD_W, HEIGHTS.notes);
    nodes.push(notesNode(p, at));
  }

  // Lines: the project to each group; between facts the file says refer to each other.
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  const cardFor = (section: ItemSection, key: string) =>
    nodes.find((n) => {
      const b = bindingOf(n);
      return b?.part === 'item' && b.section === section && b.key === key;
    });
  const wanted = new Map<string, Reference>();
  for (const r of references(p)) wanted.set(refKey(r), r);
  edges = edges.filter((e) => {
    const b = edgeBinding(e);
    if (b?.auto !== 'ref') return true;
    const r = wanted.get(b.key);
    if (!r) return false;
    const from = cardFor(r.from.section, r.from.key);
    const to = cardFor(r.to.section, r.to.key);
    if (!from || !to) return false;
    if (e.fromNode !== from.id || e.toNode !== to.id) Object.assign(e, { fromNode: from.id, toNode: to.id });
    return true;
  });
  const have = new Set(edges.map((e) => edgeBinding(e)).filter((b): b is EdgeBinding => !!b).map((b) => `${b.auto}:${b.key}`));
  for (const [key, r] of wanted) {
    if (have.has(`ref:${key}`) || hidden.has(`edge:ref:${key}`)) continue;
    const from = cardFor(r.from.section, r.from.key);
    const to = cardFor(r.to.section, r.to.key);
    if (from && to) edges.push({ id: boundId('edge', 'ref', key), fromNode: from.id, toNode: to.id, toEnd: 'none', neuralvault: { auto: 'ref', key } });
  }
  for (const section of ['next', 'dates', 'risks', 'people', 'documents', 'notes'] as BoundSection[]) {
    if (have.has(`group:${section}`) || hidden.has(`edge:group:${section}`)) continue;
    const g = nodes.find((n) => {
      const b = bindingOf(n);
      return b?.part === 'group' && b.section === section;
    });
    if (g) edges.push(groupEdge(centre.id, g.id, section));
  }

  const board: CanvasBoard = { ...input, nodes, edges, neuralvault: meta };
  return { board, changed: JSON.stringify(board) !== JSON.stringify(input) };
}

// ── Dropped files ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The name a dropped file is copied to in the project's folder: its own name, else "name (2).ext" and on. */
export function copyTarget(fileName: string, taken: Iterable<string>): string {
  const base = String(fileName ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f<>:"|?*]+/g, ' ').trim() || 'File';
  const names = new Set([...taken].map((t) => t.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 2; i < 10000; i++) {
    const name = `${stem} (${i})${ext}`;
    if (!names.has(name.toLowerCase())) return name;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** A card for a file copied into the project's folder. */
export function fileCard(rel: string, at: { x: number; y: number }, n = 0): CanvasNode {
  const picture = isPicture(rel);
  return { id: boundId('file', rel, String(Date.now()), String(n)), type: 'text', text: `\`${rel}\``, x: at.x, y: at.y, width: CARD_W, height: picture ? PICTURE_H : HEIGHTS.documents, neuralvault: { part: 'file', rel } };
}

// ── The portfolio board ───────────────────────────────────────────────────────────────────────────────────────────

export type PortfolioGroupBy = 'status' | 'health';
export const STATUS_COLUMNS = [
  { key: 'idea', label: 'Idea' },
  { key: 'planning', label: 'Planning' },
  { key: 'active', label: 'Active' },
  { key: 'on hold', label: 'On hold' },
  { key: 'done', label: 'Done' },
];
export const HEALTH_COLUMNS = [
  { key: 'on track', label: 'On track' },
  { key: 'at risk', label: 'At risk' },
  { key: 'off track', label: 'Off track' },
];
const NOT_SET = { key: 'not set', label: 'Not set' };
export const COLUMN_COLOURS: Record<string, string | undefined> = { idea: '6', planning: '5', active: '4', 'on hold': '3', done: undefined, 'on track': '4', 'at risk': '2', 'off track': '1' };
export const PORTFOLIO_CARD = { w: 264, h: 168 };
const COL_W = PORTFOLIO_CARD.w + 2 * PAD;
const COL_GAP = 40;
const MIN_COL_H = 420;

export interface PortfolioEntry {
  path: string;
  project: Project;
  /** The graph's relations to other projects (src/shared/relations.ts), when the app has them: drawn instead of the board's
   * own simpler guess, so the board and the graph always agree. */
  related?: { other: string; reasons: string[] }[];
}

/** The column a project belongs in: its status (or health) as one of the board's columns. Whole words only
 * ("offered" is not off track, "delivered" is done, "inactive" is not active); done is the one finished rule, so a
 * finished project never lands in Active. */
export function columnOf(groupBy: PortfolioGroupBy, p: Project): string {
  if (groupBy === 'health') {
    const tone = readHealthTone(p.health);
    if (tone === 'bad') return 'off track';
    if (tone === 'warn') return 'at risk';
    if (tone === 'ok') return 'on track';
    return NOT_SET.key;
  }
  const s = String(p.status ?? '').toLowerCase();
  if (isFinished(p.status)) return 'done';
  if (/\b(hold|on hold|paused|parked|blocked|blockers)\b/.test(s)) return 'on hold';
  if (/\b(replan(?:ning)?|plan(?:ning|ned)?|scoping|design)\b/.test(s)) return 'planning';
  if (/\b(idea|proposed|backlog)\b/.test(s)) return 'idea';
  if (/\b(active|progress|in progress|doing|running|live)\b/.test(s)) return 'active';
  return NOT_SET.key;
}

export function columnsFor(groupBy: PortfolioGroupBy, entries: PortfolioEntry[]): { key: string; label: string }[] {
  const base = groupBy === 'health' ? HEALTH_COLUMNS : STATUS_COLUMNS;
  return entries.some((e) => columnOf(groupBy, e.project) === NOT_SET.key) ? [...base, NOT_SET] : base;
}

/** The value a project file takes when its card goes into a column. */
export const columnValue = (key: string): string | null => (key === NOT_SET.key ? null : key);

const columnNode = (key: string, label: string, i: number, height: number): CanvasNode => ({
  id: boundId('column', key),
  type: 'group',
  label,
  x: i * (COL_W + COL_GAP),
  y: 0,
  width: COL_W,
  height,
  ...(COLUMN_COLOURS[key] ? { color: COLUMN_COLOURS[key] } : {}),
  neuralvault: { part: 'column', key },
});

const portfolioCard = (path: string, at: { x: number; y: number }): CanvasNode => ({ id: boundId('portfolio', path), type: 'file', file: path, x: at.x, y: at.y, width: PORTFOLIO_CARD.w, height: PORTFOLIO_CARD.h, neuralvault: { part: 'portfolio-project', project: path } });

export interface Relation {
  a: string;
  b: string;
  label: string;
  people: string[];
  mentions: boolean;
}

const GENERIC_PEOPLE = /\b(team|group|managers?|staff|committee|board|department|everyone|all)\b/i;
const projectText = (p: Project) => [p.summary, p.notes, ...p.next.map((n) => n.what), ...p.risks.map((r) => r.what), ...p.updates.map((u) => u.what), ...p.decisions.map((d) => d.what)].join('\n');

/** Projects that are related: they share people (the owner or anyone in People), or one mentions the other by name. */
export function relations(entries: PortfolioEntry[]): Relation[] {
  if (entries.some((e) => e.related)) {
    const paths = new Set(entries.map((e) => e.path)), seen = new Map<string, Relation>();
    for (const e of entries)
      for (const r of e.related ?? []) {
        if (!paths.has(r.other) || r.other === e.path) continue;
        const [a, b] = [e.path, r.other].sort(), key = `${a}|${b}`;
        if (seen.has(key)) continue;
        const people = r.reasons.map((w) => /^Both have (.+)$/.exec(w)?.[1]).filter((x): x is string => !!x);
        const label = r.reasons[0] ? r.reasons[0].replace(/^Both have /, '').slice(0, 40) : 'related';
        seen.set(key, { a, b, people, mentions: r.reasons.some((w) => /mention/i.test(w)), label });
      }
    return [...seen.values()];
  }
  const people = entries.map((e) => {
    const names = new Map<string, string>();
    for (const n of [e.project.owner ?? '', ...e.project.people.map((x) => x.name)]) if (n.trim() && !GENERIC_PEOPLE.test(n)) names.set(norm(n), n.trim());
    return names;
  });
  const texts = entries.map((e) => ` ${norm(projectText(e.project))} `);
  const out: Relation[] = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const shared = [...people[i].entries()].filter(([k]) => people[j].has(k)).map(([, v]) => v);
      const nameI = norm(entries[i].project.name);
      const nameJ = norm(entries[j].project.name);
      const mentions = (nameJ.length >= 4 && texts[i].includes(` ${nameJ} `)) || (nameI.length >= 4 && texts[j].includes(` ${nameI} `));
      if (!shared.length && !mentions) continue;
      const [a, b] = [entries[i].path, entries[j].path].sort();
      out.push({ a, b, people: shared, mentions, label: shared.length ? (shared.length === 1 ? shared[0] : `${shared[0]} +${shared.length - 1}`) : 'mentioned' });
    }
  return out;
}

/** The portfolio board laid out: a column for each status (or health), every project a card in its column. */
export function layoutPortfolio(entries: PortfolioEntry[], groupBy: PortfolioGroupBy, keep: CanvasBoard = { nodes: [], edges: [] }): CanvasBoard {
  const cols = columnsFor(groupBy, entries);
  const sorted = [...entries].sort((a, b) => a.project.name.localeCompare(b.project.name));
  const counts = cols.map((c) => sorted.filter((e) => columnOf(groupBy, e.project) === c.key).length);
  const height = Math.max(MIN_COL_H, PAD_TOP + Math.max(0, ...counts) * (PORTFOLIO_CARD.h + GAP) - GAP + PAD);
  const columns = cols.map((c, i) => columnNode(c.key, c.label, i, height));
  const cards: CanvasNode[] = [];
  for (const [i, c] of cols.entries()) {
    let y = PAD_TOP;
    for (const e of sorted.filter((x) => columnOf(groupBy, x.project) === c.key)) {
      cards.push(portfolioCard(e.path, { x: columns[i].x + PAD, y }));
      y += PORTFOLIO_CARD.h + GAP;
    }
  }
  // The person's own cards and lines stay; the board's own are laid out afresh.
  const own = keep.nodes.filter((n) => !n.neuralvault);
  const ownIds = new Set(own.map((n) => n.id));
  const ownEdges = keep.edges.filter((e) => !e.neuralvault && ownIds.has(e.fromNode) && ownIds.has(e.toNode));
  const board: CanvasBoard = { ...keep, nodes: [...columns, ...cards, ...own], edges: ownEdges, neuralvault: { kind: 'portfolio', groupBy } };
  return syncPortfolio(board, entries).board;
}

/** A column's project cards closed up from the top, in the order they stand (after a card leaves it, no gap is left). */
export function closeUpColumn(nodes: CanvasNode[], key: string): CanvasNode[] {
  const col = nodes.find((n) => n.neuralvault?.part === 'column' && n.neuralvault.key === key);
  if (!col) return nodes;
  const inIt = nodes.filter((n) => n.neuralvault?.part === 'portfolio-project' && centreIn(n, col)).sort((a, b) => a.y - b.y || a.x - b.x);
  const at = new Map<string, number>();
  let y = col.y + PAD_TOP;
  for (const n of inIt) {
    at.set(n.id, y);
    y += n.height + GAP;
  }
  return nodes.map((n) => (at.has(n.id) ? { ...n, x: col.x + PAD, y: at.get(n.id)! } : n));
}

/** The column a card is in (by where its middle is), if any. */
export function columnAt(board: CanvasBoard, node: Rect): string | undefined {
  const col = board.nodes.find((n) => n.neuralvault?.part === 'column' && centreIn(node, n));
  return col && col.neuralvault?.part === 'column' ? col.neuralvault.key : undefined;
}

/**
 * The portfolio board in step with the projects: a card for every project (new ones in their column), cards for
 * projects that are gone taken off, a card in the wrong column (its status changed elsewhere) moved to its column —
 * a card the person put outside the columns stays where they put it — and the lines between related projects.
 */
export function syncPortfolio(input: CanvasBoard, entries: PortfolioEntry[]): { board: CanvasBoard; changed: boolean } {
  const meta: BoardMeta = input.neuralvault?.kind === 'portfolio' ? input.neuralvault : { kind: 'portfolio', groupBy: 'status' };
  const groupBy = meta.kind === 'portfolio' ? meta.groupBy : 'status';
  const hidden = new Set(meta.hidden ?? []);
  let nodes = input.nodes.map((n) => ({ ...n }));
  let edges = input.edges.map((e) => ({ ...e }));
  const replace = (n: CanvasNode) => {
    nodes = nodes.map((x) => (x.id === n.id ? n : x));
  };
  const columnFor = (key: string): CanvasNode => {
    const found = nodes.find((n) => n.neuralvault?.part === 'column' && n.neuralvault.key === key);
    if (found) return found;
    const cols = nodes.filter((n) => n.neuralvault?.part === 'column');
    const label = [...STATUS_COLUMNS, ...HEALTH_COLUMNS, NOT_SET].find((c) => c.key === key)?.label ?? key;
    const made = columnNode(key, label, cols.length, Math.max(MIN_COL_H, ...cols.map((c) => c.height)));
    const at = cols.length ? { x: Math.max(...cols.map((c) => c.x + c.width)) + COL_GAP, y: cols[0].y } : freeSpot(nodes, made);
    const placed = { ...made, ...at };
    nodes.unshift(placed);
    return placed;
  };
  const byPath = new Map(entries.map((e) => [e.path, e]));
  // Gone projects.
  const gone = new Set(nodes.filter((n) => n.neuralvault?.part === 'portfolio-project' && !byPath.has(n.neuralvault.project)).map((n) => n.id));
  if (gone.size) {
    nodes = nodes.filter((n) => !gone.has(n.id));
    edges = edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode));
  }
  for (const e of [...entries].sort((a, b) => a.project.name.localeCompare(b.project.name))) {
    const want = columnOf(groupBy, e.project);
    const card = nodes.find((n) => n.neuralvault?.part === 'portfolio-project' && n.neuralvault.project === e.path);
    if (card) {
      const now = columnAt({ nodes, edges }, card);
      if (now === undefined || now === want) continue;
      const col = columnFor(want);
      const spot = placeInGroup(
        nodes.filter((n) => n.id !== card.id),
        col,
        card.width,
        card.height,
      );
      if (spot.group !== col) replace(spot.group);
      replace({ ...card, x: spot.x, y: spot.y });
      continue;
    }
    if (hidden.has(`project:${e.path}`)) continue;
    const col = columnFor(want);
    const spot = placeInGroup(nodes, col, PORTFOLIO_CARD.w, PORTFOLIO_CARD.h);
    if (spot.group !== col) replace(spot.group);
    nodes.push(portfolioCard(e.path, spot));
  }
  // Related projects.
  const cardOf = (path: string) => nodes.find((n) => n.neuralvault?.part === 'portfolio-project' && n.neuralvault.project === path);
  const wanted = new Map(relations(entries).map((r) => [`${r.a}|${r.b}`, r]));
  edges = edges.filter((x) => {
    const b = x.neuralvault;
    if (b?.auto !== 'related') return true;
    const r = wanted.get(b.key);
    const a = r && cardOf(r.a);
    const c = r && cardOf(r.b);
    if (!r || !a || !c) return false;
    Object.assign(x, { fromNode: a.id, toNode: c.id, label: r.label });
    return true;
  });
  const have = new Set(edges.map((x) => x.neuralvault?.key).filter(Boolean));
  for (const [key, r] of wanted) {
    if (have.has(key) || hidden.has(`edge:related:${key}`)) continue;
    const a = cardOf(r.a);
    const c = cardOf(r.b);
    if (a && c) edges.push({ id: boundId('edge', 'related', key), fromNode: a.id, toNode: c.id, fromEnd: 'none', toEnd: 'none', label: r.label, neuralvault: { auto: 'related', key } });
  }
  const board: CanvasBoard = { ...input, nodes, edges, neuralvault: meta };
  return { board, changed: JSON.stringify(board) !== JSON.stringify(input) };
}

/** Where a project's canvas is kept: beside its file, named after it. */
export const projectCanvasPath = (projectPath: string) => projectPath.replace(/\.md$/i, '.canvas');
/** Where the portfolio board is kept: in the projects folder. */
export function portfolioPath(projectPaths: string[]): string {
  const tops = projectPaths.map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')).filter(Boolean);
  const top = tops.sort((a, b) => tops.filter((x) => x === b).length - tops.filter((x) => x === a).length)[0] ?? 'Projects';
  return `${top}/Portfolio board.canvas`;
}

/**
 * A board's text cards with their links rewritten (a moved note's or file's cards follow it: CardFace renders card
 * words as Markdown, so [[links]] in them work and must keep working). Only link targets change — everything else
 * byte for byte. File cards are the key pass's business (src/main/app.ts followInCanvases rewrites those); a board
 * that cannot be read comes back as it was. `wiki` tells the rewrite which form the target came from.
 */
export function relinkBoardText(boardJson: string, rewrite: (target: string, wiki: boolean) => string | null): string {
  return boardJson.replace(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g, (whole, raw: string) => {
    let text: string;
    try {
      text = JSON.parse(`"${raw}"`);
    } catch {
      return whole;
    }
    let next = replaceWikilinks(text, (link, r, embed) => {
      const to = rewrite(link.target, true);
      return to === null || to === link.target ? r : `${embed ? '!' : ''}[[${to}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
    });
    next = replaceMarkdownLinks(next, (target, fragment, r, embed, label) => {
      const to = rewrite(target, false);
      return to === null || to === target ? r : `${embed ? '!' : ''}[${label}](${encodeLinkPath(to)}${fragment})`;
    });
    if (next === text) return whole;
    return `${whole.slice(0, whole.length - raw.length - 1)}${JSON.stringify(next).slice(1, -1)}"`;
  });
}
