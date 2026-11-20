// The note page (wave D of Ironleaf Calm, 20 Oct 2026, approved the plan: "type, icon, title, then its fields as quiet
// rows. Empty fields hide, and 'Add a field' sits at the end"). What the top of a note shows is read here from its front
// matter, with plain names a person can write by hand anywhere:
//
//   cover: sage                     a calm colour band (one of COVER_COLOURS)
//   cover: Pictures/Harbour.jpg     or a picture in the vault, by its path
//   icon: 🌱                        an emoji, or one of Ironleaf's line icons by name (icon: spark)
//   type: person                    the note's type (calm/types owns the list; a small stand-in is kept below)
//
// Plus which fields show as rows (empty ones hide), links written in a field, and the light additions for a person's
// page (their meetings and projects) and a meeting's page (its people). No window code here, so it is tested on its own.

import { isMachineProp } from './frontmatter';
import { isKindKey, kindKeyFor } from './relation-links';

/** The calm colours a cover band can be, by the name written in `cover:`. Drawn from tokens in note-page.css. */
export const COVER_COLOURS = ['sand', 'clay', 'sage', 'sea', 'sky', 'dusk', 'stone'] as const;
export type CoverColour = (typeof COVER_COLOURS)[number];

export type Cover = { kind: 'colour'; colour: CoverColour } | { kind: 'picture'; path: string };

/** Ironleaf's own line icons a note can wear (components/Icon.tsx draws them; the page checks each name exists). */
export const LINE_ICONS = ['notes', 'spark', 'sparkle', 'book', 'bookmark', 'person', 'people', 'calendar', 'clock', 'layers', 'flow', 'bolt', 'chat', 'mail', 'code', 'graph', 'chart', 'canvas', 'image', 'palette', 'sun', 'cloud', 'key', 'lock', 'pin', 'tag', 'mic', 'file'] as const;
export type LineIcon = (typeof LINE_ICONS)[number];

export type PageIcon = { kind: 'emoji'; text: string } | { kind: 'line'; name: LineIcon };

/** The keys the top of the page shows (cover, icon, the type chip), so they are not repeated as field rows. */
export const PAGE_KEYS: readonly string[] = ['cover', 'icon', 'type'];

const PICTURE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** A value as written, without the link marks a person may have put round it ([[x]], ![[x]], [[x|name]]). */
function unlinked(value: string): string {
  const v = value.trim();
  const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(v);
  if (wiki) return wiki[1].trim();
  const md = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(v);
  if (md) {
    try {
      return decodeURIComponent(md[1].trim());
    } catch {
      return md[1].trim();
    }
  }
  return v;
}

/** The note's cover from `cover:`: a colour by name, a picture by its path, or none (an unknown word draws nothing). */
export function readCover(value: unknown): Cover | null {
  if (typeof value !== 'string') return null;
  const v = unlinked(value);
  if (!v) return null;
  const colour = COVER_COLOURS.find((c) => c === v.toLowerCase());
  if (colour) return { kind: 'colour', colour };
  if (PICTURE.test(v)) return { kind: 'picture', path: v.replace(/\\/g, '/').replace(/^\.?\//, '') };
  return null;
}

/** The first thing a person sees as one character (a flag, a family, a skin tone count as one). */
function firstGrapheme(text: string): string {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const part of seg.segment(text)) return part.segment;
  } catch {
    // Older engines: the first code point and any joiners or variation marks after it.
  }
  return /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|.)(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/u.exec(text)?.[0] ?? '';
}

/** The note's icon from `icon:`: one of our line icons by name, else an emoji (its first character), else none. */
export function readIcon(value: unknown): PageIcon | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const line = LINE_ICONS.find((n) => n === v.toLowerCase());
  if (line) return { kind: 'line', name: line };
  // Only emoji: "📚 books" is words, not an icon.
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) || /[\p{L}\p{N}\p{P}]/u.test(v.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\u20E3\s]/gu, ''))) return null;
  const first = firstGrapheme(v);
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? { kind: 'emoji', text: first } : null;
}

/** The note's type id from `type:` (Person, person and [[Person]] are all "person"), or none. */
export function readType(props: Record<string, unknown> | undefined): string | null {
  const raw = props?.type ?? props?.Type;
  if (typeof raw !== 'string') return null;
  const id = unlinked(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  return id || null;
}

// ── Types as the page shows them ─────────────────────────────────────────────────────────────────────────────────
// The page reads the real types through state/noteTypes.ts pageTypeFor() (src/shared/note-types.ts: the built-ins with the
// person's changes, and their own). This small table stays only for the tests and as the last fallback: a `type:` that
// names no type still shows by its own words, with a plain tag icon.

export type FieldKindHint = 'text' | 'list' | 'date' | 'checkbox' | 'number';

export interface PageField {
  key: string;
  kind: FieldKindHint;
}

export interface PageType {
  id: string;
  name: string;
  icon: LineIcon | 'doc';
  /** The type's colour (note-types.ts TYPE_COLORS), when the vault's types give one: its chip is drawn in it. */
  color?: string;
  fields: PageField[];
}

export const PAGE_TYPES: readonly PageType[] = [
  { id: 'note', name: 'Note', icon: 'notes', fields: [] },
  { id: 'project', name: 'Project', icon: 'layers', fields: [{ key: 'status', kind: 'text' }, { key: 'due', kind: 'date' }] },
  { id: 'doc', name: 'Doc', icon: 'doc', fields: [{ key: 'owner', kind: 'text' }] },
  { id: 'person', name: 'Person', icon: 'person', fields: [{ key: 'role', kind: 'text' }, { key: 'organisation', kind: 'text' }, { key: 'email', kind: 'text' }, { key: 'phone', kind: 'text' }] },
  { id: 'meeting', name: 'Meeting', icon: 'people', fields: [{ key: 'date', kind: 'date' }, { key: 'attendees', kind: 'list' }, { key: 'project', kind: 'text' }] },
  { id: 'resource', name: 'Resource', icon: 'bookmark', fields: [{ key: 'url', kind: 'text' }, { key: 'author', kind: 'text' }] },
  { id: 'idea', name: 'Idea', icon: 'sparkle', fields: [] },
];

/** A type by id; one the stand-in doesn't know still shows, by its own name, with a plain tag icon and no fields. */
export function pageType(id: string | null): PageType | null {
  if (!id) return null;
  const known = PAGE_TYPES.find((t) => t.id === id);
  if (known) return known;
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1), icon: 'tag', fields: [] };
}

// ── Fields ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nothing in it: no value, blank words, an empty list (or one of blanks), an empty set of keys. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export interface FieldRow {
  key: string;
  value: unknown;
  /** "value": the field with its editor; "add": a faint "Add <field>" row the note's type offers. */
  show: 'value' | 'add';
  /** The kind the type gives it, for an empty field's editor (a date picker for "date" before there is a date). */
  hint?: FieldKindHint;
}

export interface FieldState {
  /** The fields' own area has the focus, or a field is being added: empty fields show, to be filled in. */
  editing?: boolean;
  /** The pointer rests on (or the focus is in) the fields: the type's empty fields show as "Add <field>". */
  active?: boolean;
  /** A field the person has just added: shown, empty, for them to fill in, wherever the focus goes. */
  keep?: string | null;
}

/**
 * The rows the fields area shows, in the note's own order, then the type's fields it hasn't got. Fields with a value
 * always show; an empty one shows only while editing (or just added), or as "Add <field>" (faint) while the area is in
 * use when the note's type defines it; the rest hide. The keys the top of the page shows (cover, icon, type) are never rows.
 */
export function fieldRows(props: Record<string, unknown>, typeFields: readonly PageField[], state: FieldState = {}): FieldRow[] {
  const active = !!(state.active || state.editing);
  const hintOf = (key: string) => typeFields.find((f) => f.key.toLowerCase() === key.toLowerCase())?.kind;
  const rows: FieldRow[] = [];
  const seen = new Set<string>();
  // A link kind's sibling ("people kind") shows with its links, never as its own row; orphaned (no links beside it),
  // it still shows, so the person's words are never hidden from them.
  const linked = new Set(Object.keys(props).map((k) => kindKeyFor(k).toLowerCase()));
  for (const [key, value] of Object.entries(props)) {
    const lower = key.toLowerCase();
    if (PAGE_KEYS.includes(lower)) continue;
    // The app's own keeping (its speaker-names map; a person's own "speakers" is theirs and shows) is never a
    // field row (6 Nov 2026, o3-meeting-page item 1; o6 moved the map to neuralvault-speaker-names, same hiding).
    if (isMachineProp(key)) continue;
    if (isKindKey(key) && linked.has(lower)) continue;
    seen.add(lower);
    const hint = hintOf(key);
    if (!isEmptyValue(value) || state.editing || lower === state.keep?.toLowerCase()) rows.push({ key, value, show: 'value', ...(hint ? { hint } : {}) });
    else if (active && hint) rows.push({ key, value, show: 'add', hint });
  }
  if (active) for (const f of typeFields) if (!seen.has(f.key.toLowerCase())) rows.push({ key: f.key, value: undefined, show: 'add', hint: f.kind });
  return rows;
}

// ── Facts as designed ────────────────────────────────────────────────────────────────────────────────────────────
// A project opened as a note shows its facts as the app's own pills and chips (p14, Nov 2026): status and health as
// the shared status pill, progress as the shared bar, dates as the shared date pill, an owner as the shared owner
// chip — the same pieces Tasks and the project page use, never a browser date box. The file's words stay the file's
// words: this is how a fact shows, never what it writes. Which fact is which is read here, once, from the key and
// the value's shape (as propKind reads the editor); the page renders it.

/** A fact with a designed reading, or null for a plain row. */
export type FactKind = 'status' | 'progress' | 'date' | 'owner';

/**
 * Which designed fact a field is (null: a plain row). Dates by their shape (an ISO day or moment, as propKind
 * reads them); status, health, progress and owner by their key with a value that fits (a number 0–100 for
 * progress, plain words for an owner — a linked owner already shows as its chip).
 */
export function factKind(key: string, value: unknown, kind: string): FactKind | null {
  if (kind === 'date' || kind === 'datetime') return 'date';
  const k = key.toLowerCase().trim();
  if ((k === 'status' || k === 'health') && typeof value === 'string' && value.trim()) return 'status';
  if (k === 'progress') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 100) return 'progress';
    return null;
  }
  if (k === 'owner' && typeof value === 'string' && value.trim() && !linksOnly(value)) return 'owner';
  return null;
}

// ── Links in a field ───────────────────────────────────────────────────────────────────────────────────────────────

export interface FieldLink {
  target: string;
  alias?: string;
}

/** One [[link]] that is the whole value ([[Sam Lee]], [[People/Sam Lee|Sam]]), or none. */
export function linkOf(value: string): FieldLink | null {
  const m = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/.exec(value);
  if (!m) return null;
  const target = m[1].trim();
  if (!target) return null;
  const alias = m[2]?.trim();
  return alias ? { target, alias } : { target };
}

/** The links a value is made of, when it is only links ("[[Sam]], [[Priya]]"); none when it has other words too. */
export function linksOnly(value: string): FieldLink[] | null {
  if (!value.trim()) return null;
  const parts = value.match(/\[\[[^\]]*\]\]/g);
  if (!parts) return null;
  if (value.replace(/\[\[[^\]]*\]\]/g, '').replace(/[\s,;]+|\band\b|&/g, '').length) return null;
  const links = parts.map(linkOf);
  return links.every(Boolean) ? (links as FieldLink[]) : null;
}

// ── Person and meeting pages ───────────────────────────────────────────────────────────────────────────────────────

export interface PageNote {
  path: string;
  title: string;
  mtime?: number;
  aliases?: string[];
  links: { target: string }[];
  props: Record<string, unknown>;
}

export interface PageRef {
  path: string;
  title: string;
  /** A meeting's day as written in it (YYYY-MM-DD when it is one), for the list. */
  date?: string;
}

export interface MeetingPerson {
  /** As written (the link's name when it was a link). */
  name: string;
  /** What to look the note up by: the link's target, or the name. */
  target: string;
}

/** A meeting's people from its `attendees:` (or `people:`, `participants:`), each a name or a [[link]]. */
export function meetingPeople(props: Record<string, unknown> | undefined): MeetingPerson[] {
  const raw = props?.attendees ?? props?.people ?? props?.participants;
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? (linksOnly(raw)?.map((l) => `[[${l.target}${l.alias ? `|${l.alias}` : ''}]]`) ?? raw.split(',')) : [];
  const out: MeetingPerson[] = [];
  for (const item of items) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const link = linkOf(item);
    const person = link ? { name: link.alias ?? link.target.split('/').pop()!, target: link.target } : { name: item.trim().replace(/^@/, ''), target: item.trim().replace(/^@/, '') };
    if (!out.some((p) => p.target.toLowerCase() === person.target.toLowerCase())) out.push(person);
  }
  return out;
}

/** A meeting's mentioned people from its `also:` (or `mentioned:`, `also_named:`) property: the same list the
 *  note page already shows as a field row. Whoever reads "also mentioned" from the note's words leaves these
 *  out, so a person is never shown twice on one page (6 Nov 2026, o3-meeting-page item 5). */
export function mentionedPeople(props: Record<string, unknown> | undefined): MeetingPerson[] {
  if (!props) return [];
  const key = Object.keys(props).find((k) => /^(also|mentioned|also_named)$/i.test(k.trim()));
  return key ? meetingPeople({ people: props[key] }) : [];
}

/** Heading words with their marks off, for comparing with a title. */
export const headingWords = (s: string) =>
  s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop()!)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The text as reading view shows it (Polish round 4, 29 Oct 2026): when the body's first heading is the
 * note's title, that heading line is left out (the page head already says it). The file keeps its heading;
 * only this copy for reading is changed. A heading inside a code fence, or after other words, stays.
 */
export function stripTitleHeading(text: string, title: string): string {
  const want = headingWords(title);
  if (!want) return text;
  const lines = String(text ?? '').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let fence = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || !line.trim()) continue;
    const h = /^#[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/.exec(line);
    if (!h) return text;
    if (headingWords(h[1]) !== want) return text;
    lines.splice(i, 1);
    if (lines[i] !== undefined && !lines[i].trim()) lines.splice(i, 1);
    return lines.join('\n');
  }
  return text;
}

const MEETINGS_FOLDER = /(^|\/)(\d+[\s._-]*)?meetings?(\/|$)/i;

/** A meeting: its type says so, or it sits in a Meetings folder (as Today reads them, src/shared/today.ts). */
export function isMeetingNote(note: Pick<PageNote, 'path' | 'props'>): boolean {
  const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
  return readType(note.props)?.startsWith('meeting') === true || MEETINGS_FOLDER.test(folder);
}

function meetingDate(props: Record<string, unknown>): string | undefined {
  for (const k of ['date', 'when', 'day', 'held']) {
    const v = props[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 10);
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * A person's page: the meetings they were in and the projects they are part of — the notes that link to them, or
 * name them among a meeting's people. Newest meetings first; projects by name.
 */
export function personPages(personPath: string, notes: readonly PageNote[], resolve: (target: string, from: string) => string | null): { meetings: PageRef[]; projects: PageRef[] } {
  const me = notes.find((n) => n.path === personPath);
  const names = new Set([me?.title ?? personPath.split('/').pop()!.replace(/\.md$/i, ''), ...(me?.aliases ?? [])].map((s) => s.toLowerCase()));
  const meetings: (PageRef & { at: number })[] = [];
  const projects: PageRef[] = [];
  for (const n of notes) {
    if (n.path === personPath) continue;
    const linked = n.links.some((l) => resolve(l.target, n.path) === personPath);
    const named = meetingPeople(n.props).some((p) => resolve(p.target, n.path) === personPath || names.has(p.name.toLowerCase()) || names.has(p.target.toLowerCase()));
    if (!linked && !named) continue;
    if (isMeetingNote(n)) {
      const date = meetingDate(n.props);
      const at = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : (n.mtime ?? 0);
      meetings.push({ path: n.path, title: n.title, ...(date ? { date } : {}), at });
    } else if (readType(n.props) === 'project') projects.push({ path: n.path, title: n.title });
  }
  meetings.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));
  projects.sort((a, b) => a.title.localeCompare(b.title));
  return { meetings: meetings.map(({ at: _at, ...r }) => r), projects };
}
