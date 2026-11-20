// What sits at the foot of a note (src/renderer/src/components/NoteFoot.tsx): the line of another note that links here or
// names this note, cut down to a readable snippet with the link or the name marked; and the notes most like this one by
// what they share (tags, properties, links to the same notes), rarest first, with what they share named. (19 Oct 2026:
// both apps "premium-looking and packed with features" for 5.0.0.)

import { plainLine } from './snippet';
import { parseWikilink } from './markdown';

export interface Snippet {
  text: string;
  /** [start, end) in `text` of each link to this note, or each time its name is written without a link. */
  ranges: [number, number][];
  /** Words left out before and after (the line was longer than the snippet). */
  cutStart: boolean;
  cutEnd: boolean;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const lower = (s: string) => s.trim().toLowerCase();
const baseName = (target: string) => {
  const clean = decode(target).replace(/\\/g, '/').replace(/\.md$/i, '');
  return lower(clean.split('/').pop() ?? clean);
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A line of another note as the foot shows it: links read as their words, Markdown marks left out, and the links to this
 * note (by any of `names`: its title and aliases) marked; where none is a link, the names written as plain words are
 * marked instead. A long line is cut to about `max` characters round the first mark, on word breaks.
 */
export function snippetOf(raw: string, names: string[], max = 180): Snippet {
  const wanted = new Set(names.map(lower).filter(Boolean));
  let text = '';
  const ranges: [number, number][] = [];
  let last = 0;
  const re = /!?\[\[([^[\]\n]+?)\]\]|!?\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  for (const m of raw.matchAll(re)) {
    text += raw.slice(last, m.index);
    let shown: string;
    let target: string;
    if (m[1] !== undefined) {
      const link = parseWikilink(m[1]);
      target = link.target;
      const name = link.target.split('/').pop() ?? link.target;
      shown = link.alias ?? (name || (link.heading ?? ''));
    } else {
      target = m[3].replace(/#.*$/, '');
      shown = m[2] || baseName(target);
    }
    const start = text.length;
    text += shown;
    if (target && (wanted.has(baseName(target)) || wanted.has(lower(decode(target).replace(/\.md$/i, ''))))) ranges.push([start, text.length]);
    last = (m.index ?? 0) + m[0].length;
  }
  text += raw.slice(last);
  // A mention not linked yet: the name itself is what to see.
  if (!ranges.length) {
    for (const name of names) {
      if (!name.trim()) continue;
      const word = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name.trim())}(?![\\p{L}\\p{N}_])`, 'giu');
      for (const m of text.matchAll(word)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
  }
  const plain = plainLine(text, ranges);
  const full = plain.text.trim() ? plain.text : '';
  const lead = full.length - full.trimStart().length;
  let body = full.trim();
  let marks = plain.ranges.map(([a, b]) => [a - lead, b - lead] as [number, number]).filter(([a, b]) => b > 0 && a < body.length);
  if (body.length <= max) return { text: body, ranges: marks, cutStart: false, cutEnd: false };
  // Round the first mark: a little before it, the rest after, cut where words break.
  const focus = marks[0]?.[0] ?? 0;
  let start = Math.max(0, Math.min(focus - Math.floor(max * 0.3), body.length - max));
  if (start > 0) {
    const space = body.indexOf(' ', start);
    if (space >= 0 && space < focus) start = space + 1;
  }
  let end = Math.min(body.length, start + max);
  if (end < body.length) {
    const space = body.lastIndexOf(' ', end);
    if (space > start + max * 0.6) end = space;
  }
  const cutStart = start > 0;
  const cutEnd = end < body.length;
  body = body.slice(start, end);
  marks = marks.map(([a, b]) => [Math.max(0, a - start), Math.min(body.length, b - start)] as [number, number]).filter(([a, b]) => b > a);
  return { text: body, ranges: marks, cutStart, cutEnd };
}

export interface RelatedInput {
  path: string;
  title: string;
  tags: string[];
  props: Record<string, unknown>;
  links: { target: string }[];
}

export interface RelatedPick {
  path: string;
  title: string;
  score: number;
  /** What the two notes share, as the person reads it: tags (no #), properties ("status: Active"), notes both link to. */
  tags: string[];
  props: string[];
  links: string[];
  /** One of the two links to the other. */
  linked: boolean;
}

/** Properties every note has, or that say when rather than what: sharing them says nothing about the notes. */
const PLAIN_KEYS = new Set(['created', 'updated', 'modified', 'date', 'title', 'aliases', 'alias', 'tags', 'tag', 'cssclasses', 'cssclass', 'id', 'publish', 'position']);
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([ T].*)?$/;
const LINK_VALUE = /^\[\[([^[\]\n]+?)\]\]$/;

interface Shape {
  tags: Map<string, string>;
  props: Map<string, string>;
  links: Set<string>;
}

function shapeOf(note: RelatedInput, resolve: (target: string, from: string) => string | null): Shape {
  const tags = new Map<string, string>();
  for (const t of note.tags) tags.set(lower(t.replace(/^#/, '')), t.replace(/^#/, ''));
  const props = new Map<string, string>();
  const links = new Set<string>();
  for (const l of note.links) {
    const p = resolve(l.target, note.path);
    if (p && p !== note.path) links.add(p);
  }
  for (const [key, value] of Object.entries(note.props ?? {})) {
    if (PLAIN_KEYS.has(key.toLowerCase())) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== 'string') continue;
      const s = v.trim();
      if (!s || s.length > 60 || DATE_LIKE.test(s) || /^-?\d+(\.\d+)?$/.test(s)) continue;
      // A property that names a note ("client: [[Acme]]") is a link like any other.
      const link = LINK_VALUE.exec(s);
      if (link) {
        const p = resolve(parseWikilink(link[1]).target, note.path);
        if (p && p !== note.path) links.add(p);
        continue;
      }
      props.set(`${key.toLowerCase()}\u0000${s.toLowerCase()}`, `${key}: ${s}`);
    }
  }
  return { tags, props, links };
}

/**
 * The notes most like the one at `path` by what they share: each tag, property value and note linked to counts more the
 * fewer notes have it (a tag on every note says nothing), and a note one of the two links to counts a little more. Notes
 * that share nothing are left out; `skip` leaves out others (private notes, folders left out of suggestions).
 */
export function relatedNotes(path: string, notes: RelatedInput[], resolve: (target: string, from: string) => string | null, options: { limit?: number; skip?: (path: string) => boolean } = {}): RelatedPick[] {
  const self = notes.find((n) => n.path === path);
  if (!self) return [];
  const pool = notes.filter((n) => n.path === path || !options.skip?.(n.path));
  const shapes = new Map(pool.map((n) => [n.path, shapeOf(n, resolve)] as const));
  const mine = shapes.get(path)!;
  if (!mine.tags.size && !mine.props.size && !mine.links.size) return [];
  // How many notes have each thing this note has (only these matter).
  const count = new Map<string, number>();
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1);
  for (const s of shapes.values()) {
    for (const t of s.tags.keys()) if (mine.tags.has(t)) bump(`t:${t}`);
    for (const p of s.props.keys()) if (mine.props.has(p)) bump(`p:${p}`);
    for (const l of s.links) if (mine.links.has(l)) bump(`l:${l}`);
  }
  const total = pool.length;
  const weight = (k: string) => Math.log(1 + total / Math.max(1, count.get(k) ?? 1));
  const titleOf = new Map(pool.map((n) => [n.path, n.title] as const));
  const out: RelatedPick[] = [];
  for (const other of pool) {
    if (other.path === path) continue;
    const s = shapes.get(other.path)!;
    const tags: string[] = [];
    const props: string[] = [];
    const links: string[] = [];
    let score = 0;
    for (const t of s.tags.keys())
      if (mine.tags.has(t)) {
        tags.push(mine.tags.get(t)!);
        score += 1.2 * weight(`t:${t}`);
      }
    for (const p of s.props.keys())
      if (mine.props.has(p)) {
        props.push(mine.props.get(p)!);
        score += weight(`p:${p}`);
      }
    for (const l of s.links)
      if (mine.links.has(l)) {
        links.push(titleOf.get(l) ?? (l.split('/').pop() ?? l).replace(/\.md$/i, ''));
        score += weight(`l:${l}`);
      }
    const linked = mine.links.has(other.path) || s.links.has(path);
    if (!score) continue;
    if (linked) score += 0.5;
    out.push({ path: other.path, title: other.title, score: Math.round(score * 1000) / 1000, tags, props, links, linked });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, options.limit ?? 20);
}

/** The foot's search: every word typed is in the note's name, its folder or what is shown of it. */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}
