// Ideas and Inbox (Wave 4, 24 Oct 2026; module 20 of the catalogue: "Quick capture from Telegram, voice, photos, email.
// Triage into the right module."). Everything captured without a place — the capture box (Ctrl+Alt+N) and its flows, The
// former host app and a chat bot when no project is named, dictation, a photo — lands in the Inbox: the lines under the
// Inbox note's headings (Inbox.md, as the capture flows write them) and whatever sits in the Inbox folder. The Inbox page
// shows each as one item and files it in one click: into a project (a tick-box becomes its next step; a line goes in its
// log), onto a person's card, or as a note of a type in an area. Where it probably goes is suggested from the vault's own
// structure only — the project or person it names, a link it carries, the area of what it names — never from topic words
// written into Ironleaf.
//
// Pure: no files, no Node. The main side (src/main/life.ts) reads and writes; the window draws (views/InboxPage.tsx).

import { STOP_WORDS, matchText, suggestProjects, type CaptureProject } from './capture';

export const INBOX_NOTE = 'Inbox.md';
export const INBOX_FOLDER = 'Inbox';
/** Sections of the Inbox note that hold what was dealt with, never items. */
const DONE_HEADINGS = /^(filed|done|archived?|dealt with)$/i;

export interface InboxItem {
  /** Stable while its words stay the same: "line:<n>:<hash>" for a line of the Inbox note, the path for a note or file. */
  id: string;
  kind: 'line' | 'note' | 'file';
  /** The Inbox note (a line), or the note or file itself. */
  path: string;
  /** Its words as written (a line: every line of it, the first without its dash). */
  text: string;
  /** The words a person reads: without the time it was written, tick box or markup. */
  words: string;
  /** When it was captured, as written ("24 Oct 2026 10:42"). */
  stamp?: string;
  task: boolean;
  /** A line's place in the note (first and last line, 0-based). */
  from?: number;
  to?: number;
  /** Pictures and files it carries (![[…]]), and the notes it links to ([[…]]). */
  embeds: string[];
  links: string[];
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const STAMP = /^(\d{1,2} [A-Z][a-z]{2} \d{4} \d{1,2}:\d{2}|\d{1,2}:\d{2})\s+(?:[—–-]\s+)?/;
const TAIL_STAMP = /\s+[—–-]\s+(\d{1,2} [A-Z][a-z]{2} \d{4} \d{1,2}:\d{2}|\d{1,2}:\d{2})\s*$/;
const BOLD_STAMP = /^\*\*(\d{1,2} [A-Z][a-z]{2} \d{4} \d{1,2}:\d{2}|\d{1,2}:\d{2})\*\*\s+(?:[—–-]\s+)?/;

/** A folder note's title as a person reads it: its own `#` heading when it has one, else the indexed title
 *  (t243, 12 Nov 2026: the index titles by file name, so the Inbox showed the raw slug
 *  "the-long-email-from-the-bank-about-the-card-reader-failure" — the note's own heading is its real title). */
export function folderNoteTitle(indexTitle: string, body: string): string {
  const heading = /^#\s+(.+?)\s*$/m.exec(String(body ?? ''))?.[1]?.trim();
  return heading || indexTitle;
}

/** A note in the Inbox folder as one line: its title, then its first line that adds anything, without markup
 *  (t74 vault-three-sizes, 9 Nov 2026: a note read as its slug plus its raw first line, "awning-quote — # Awning
 *  quote", the # printed). A first line that only repeats the title (dashes read as spaces) is skipped for the next
 *  line that adds anything; body arrives without front matter, as life.ts holds it. */
export function folderNoteWords(title: string, body: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const first = String(body ?? '')
    .split('\n')
    .map((l) => plainWords(l.replace(/^#{1,6}\s+/, '').trim()))
    .find((l) => l && norm(l) !== norm(title));
  return first ? `${title} — ${first.slice(0, 160)}` : title;
}

/** A line's words a person reads: without its stamp, tick box, links' brackets and embeds. */
export function plainWords(text: string): string {
  return text
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(BOLD_STAMP, '')
    .replace(STAMP, '')
    .replace(TAIL_STAMP, '')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The items of the Inbox note: each list item (with the lines indented under it) or paragraph outside a heading for
 *  what was dealt with, in order. */
export function inboxLines(content: string, path = INBOX_NOTE): InboxItem[] {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    i = end > 0 ? end + 1 : 0;
  }
  const out: InboxItem[] = [];
  let skip = false;
  let fence = false;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) {
      skip = h[1].length >= 2 && DONE_HEADINGS.test(h[2].trim());
      i++;
      continue;
    }
    if (skip || fence || !l.trim()) {
      i++;
      continue;
    }
    const item = /^[-*+]\s+(.*)$/.exec(l) ?? /^\d+[.)]\s+(.*)$/.exec(l);
    const start = i;
    const body: string[] = [item ? item[1] : l.trim()];
    i++;
    // The lines under it: indented (a list item's), or the rest of a paragraph.
    while (i < lines.length) {
      const n = lines[i];
      if (item ? /^(\s{2,}|\t)\S/.test(n) || (/^\s+$/.test(n) && /^(\s{2,}|\t)\S/.test(lines[i + 1] ?? '')) : n.trim() && !/^([-*+]|\d+[.)]|#{1,6})\s/.test(n)) {
        body.push(n.replace(/^(\s{2}|\t)/, ''));
        i++;
      } else break;
    }
    const text = body.join('\n').replace(/\s+$/, '');
    const first = body[0];
    const stamp = BOLD_STAMP.exec(first.replace(/^\[[ xX]\]\s+/, ''))?.[1] ?? STAMP.exec(first.replace(/^\[[ xX]\]\s+/, ''))?.[1] ?? TAIL_STAMP.exec(first)?.[1];
    const embeds = [...text.matchAll(/!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim());
    const links = [...text.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim());
    out.push({
      id: `line:${hash(text)}`,
      kind: 'line',
      path,
      text,
      words: plainWords(body.join(' ')) || (embeds.length ? embeds.map((e) => e.split('/').pop()).join(', ') : ''),
      ...(stamp ? { stamp } : {}),
      task: /^\[ \]\s+/.test(first),
      from: start,
      to: i - 1,
      embeds,
      links,
    });
    if (/^\[[xX]\]\s+/.test(first)) out.pop(); // a ticked line is done already
  }
  // The same words twice get their own ids.
  const seen = new Map<string, number>();
  for (const it of out) {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    if (n > 1) it.id = `${it.id}~${n}`;
  }
  return out;
}

/** The note's text without an item's lines (found again by its words when the note changed since it was read). Null
 *  when the item isn't there any more. */
export function withoutItem(content: string, item: Pick<InboxItem, 'id' | 'text' | 'from' | 'to'>): string | null {
  const lines = content.split(/\r?\n/);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const now = inboxLines(content).find((x) => x.id === item.id) ?? inboxLines(content).find((x) => x.text === item.text);
  if (!now || now.from === undefined || now.to === undefined) return null;
  lines.splice(now.from, now.to - now.from + 1);
  // No run of blank lines left where it was.
  if (lines[now.from - 1] !== undefined && !lines[now.from - 1].trim() && lines[now.from] !== undefined && !lines[now.from].trim()) lines.splice(now.from, 1);
  return lines.join(eol);
}

/** An item's lines as they go elsewhere (a log, a person's notes): the same words, as one list item. */
export function itemLines(item: Pick<InboxItem, 'text'>): string[] {
  const [first, ...rest] = item.text.split('\n');
  return [`- ${first}`, ...rest.map((l) => (l.trim() ? `  ${l}` : '  '))];
}

/** A title for a note made from an item: its first words (at most eight), else what it carries. */
export function itemTitle(item: Pick<InboxItem, 'words' | 'embeds'>, fallback = 'Captured'): string {
  // A label written first ("Idea: …", "To do: …") isn't part of the name.
  const words = item.words.replace(/^\s*\p{L}+(?: \p{L}+)?:\s+(?=\S)/u, '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return item.embeds[0]?.split('/').pop()?.replace(/\.[^.]+$/, '') || fallback;
  let cut = words.split(' ').slice(0, 8);
  // Never ending on a little word ("…the long weekend for").
  while (cut.length > 2 && /^(a|an|the|and|or|for|of|to|in|on|at|with|from|by|about|is|are|my|our|your)$/i.test(cut[cut.length - 1])) cut = cut.slice(0, -1);
  const joined = cut.join(' ');
  const name = (joined.length > 60 ? joined.slice(0, 60).replace(/\s+\S*$/, '') : joined).replace(/[.,;:!?—–-]+$/, '');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : fallback;
}

/** A note made from an item: its type (not for a plain note), when it was captured, its words and what it carries.
 * Filed as a task, the tick-box stays, so it is still a task in the index. */
export function itemNoteText(item: Pick<InboxItem, 'text' | 'stamp'>, type?: string, project?: string): string {
  const front = [...(type && type !== 'note' && type !== 'task' ? [`type: ${type}`] : []), ...(item.stamp ? [`captured: ${item.stamp}`] : []), ...(project ? [`project: "[[${project.replace(/"/g, '')}]]"`] : [])];
  const stripped = item.text
    .replace(BOLD_STAMP, '')
    .replace(STAMP, '')
    .replace(TAIL_STAMP, '')
    .trim();
  const body = type === 'task' ? `- [ ] ${stripped.replace(/^\[ \]\s+/, '')}` : stripped.replace(/^\[ \]\s+/, '');
  return `${front.length ? `---\n${front.join('\n')}\n---\n` : ''}${body}\n`;
}

/** A tick-box item as a project's next step: its words without the tick box and the time it was captured. */
export function itemStep(item: Pick<InboxItem, 'text'>): string {
  return item.text
    .split('\n')[0]
    .replace(/^\[ \]\s+/, '')
    .replace(BOLD_STAMP, '')
    .replace(STAMP, '')
    .replace(TAIL_STAMP, '')
    .trim();
}

// ── Where it probably goes ──────────────────────────────────────────────────────────────────────────────────────────

/** Month and day names: never enough on their own to point at a note ("May", "March", "Friday"). */
const MONTHDAY = new Set(
  'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun'.split(' '),
);

/** A generated-looking note title ("Me note 715", "Home note 2542"): never a new arrival's home on similarity
 *  alone (t249 — a person files there through File… when they mean it). Only the meaning backfill reads this;
 *  a capture naming or linking the note still files there. */
export const isFillerNoteTitle = (title: string): boolean => /\bnotes? \d+/i.test(String(title ?? ''));

/** A capture's distinctive words shared with a note's title (t249): four letters or more, everyday words, month
 *  and day names and bare numbers left out. A meeting needs one of these (or a link) before the meaning index
 *  may offer it — similarity alone filed a bank task into an awning meeting. */
export function sharedTitleWords(words: string, title: string): string[] {
  const some = (s: string) => new Set(matchText(s).trim().split(' ').filter((w) => w.length >= 4 && !STOP_WORDS.has(w) && !MONTHDAY.has(w) && !/^\d+$/.test(w)));
  const said = some(words);
  return [...some(title)].filter((w) => said.has(w));
}

/** module: filed into a module as one of its records (Wave 5: an emailed bill becomes a Finance bill). */
export type TargetKind = 'project' | 'person' | 'note' | 'area' | 'module' | 'reminder';

export interface FilingTarget {
  kind: TargetKind;
  /** A project's file, a person's card, or a note (the item is added to it). */
  path?: string;
  /** An area's id (with `type`, the note type it becomes there). */
  area?: string;
  type?: string;
  /** A module's id (kind module: 'finance'). */
  module?: string;
  name: string;
  /** What filing it does, in the module's own words ("Log a fill-up for the wagon"; Wave 7 part a). */
  label?: string;
  /** The moment in the capture's own words (kind reminder: the model's "when", read strictly, never guessed). */
  when?: string;
  /** A new note or doc's title in the model's own words (kind area with a new home: names the file, else the capture's first words). */
  title?: string;
  /** A plain line filed as the project's next step all the same (kind project: the model read work with an end). */
  step?: boolean;
}

export interface InboxSuggestion {
  target: FilingTarget;
  why: string;
}

export interface SuggestContext {
  projects: (CaptureProject & { area?: string })[];
  people: { name: string; path: string; names: string[]; area?: string }[];
  /** Other notes by their names (docs, devices, publications…), for an item that names one. */
  notes?: { title: string; path: string; area?: string }[];
  areas: { id: string; name: string }[];
  /** A link's words to the note it reaches. */
  resolve(target: string): string | null;
  now?: number;
}

/**
 * Where an item probably goes, the likeliest first (at most three): a note or project it links to; a project it names
 * (its name, folder, people or tags: the capture box's own suggestions); a person whose card it names; and the area of
 * what it names. Nothing when nothing in it points anywhere.
 */
export function suggestFiling(item: Pick<InboxItem, 'words' | 'text' | 'links' | 'task'> & { nameWords?: string }, ctx: SuggestContext): InboxSuggestion[] {
  const out: InboxSuggestion[] = [];
  const add = (s: InboxSuggestion) => {
    const key = `${s.target.kind}:${s.target.path ?? s.target.area}`;
    if (!out.some((x) => `${x.target.kind}:${x.target.path ?? x.target.area}` === key)) out.push(s);
  };
  const areaName = (id?: string) => ctx.areas.find((a) => a.id === id)?.name;
  // A link it carries (a project, a person's card, or a note: the note it names stays filed with that note).
  for (const l of item.links) {
    const to = ctx.resolve(l);
    if (!to) continue;
    const p = ctx.projects.find((x) => x.path === to);
    if (p) add({ target: { kind: 'project', path: p.path, name: p.name }, why: `Links to ${p.name}` });
    const person = ctx.people.find((x) => x.path === to);
    if (person) add({ target: { kind: 'person', path: person.path, name: person.name }, why: `Links to ${person.name}` });
    const note = !p && !person ? ctx.notes?.find((x) => x.path === to) : undefined;
    if (note) add({ target: { kind: 'note', path: note.path, name: note.title }, why: `Links to ${note.title}` });
  }
  // A project it names.
  const projects = suggestProjects({ text: item.words, nameWords: item.nameWords, projects: ctx.projects, now: ctx.now, max: 3 }).filter((s) => s.evidence === 'words' && s.score >= 24);
  // A second project only when it is nearly as likely as the first.
  for (const s of projects.slice(0, 2).filter((x, i, all) => i === 0 || x.score >= all[0].score * 0.7)) add({ target: { kind: 'project', path: s.path, name: s.name }, why: s.reason });
  // A person whose card it names (the whole name, or another name they go by; a single name in capitals: a capital
  // "Bill" is Bill, a lowercase "bill" is an invoice).
  const hay = matchText(item.words);
  const said = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}_]|$)`, 'u').test(item.words);
  for (const p of ctx.people) {
    const named = [p.name, ...p.names].find((n) => {
      const m = matchText(n).trim();
      if (!m) return false;
      if (m.includes(' ')) return hay.includes(` ${m} `);
      if (m.length < 2 || STOP_WORDS.has(m)) return false;
      const t = n.trim();
      return said(t) || (t.charAt(0) === t.charAt(0).toLowerCase() && said(t.charAt(0).toUpperCase() + t.slice(1)));
    });
    if (named) add({ target: { kind: 'person', path: p.path, name: p.name }, why: `Names ${named}` });
  }
  // A note it names (its whole name, or the first words of it: "Galaxy Tab" for "Galaxy Tab S12 Ultra", "Car" for a
  // one-word note; everyday words and month and day names never point anywhere on their own).
  for (const n of ctx.notes ?? []) {
    const words = matchText(n.title).trim().split(' ').filter(Boolean);
    let named = '';
    for (let k = words.length; k >= 1; k--) {
      const part = words.slice(0, k).join(' ');
      if (part.length < 3 || !part.split(' ').some((w) => !STOP_WORDS.has(w) && !MONTHDAY.has(w))) continue;
      if (hay.includes(` ${part} `)) {
        named = part;
        break;
      }
    }
    if (named) add({ target: { kind: 'note', path: n.path, name: n.title }, why: `Names ${n.title}` });
  }
  // The area of what it names.
  const first = out[0];
  const area = first?.target.kind === 'project' ? ctx.projects.find((x) => x.path === first.target.path)?.area : first?.target.kind === 'person' ? ctx.people.find((x) => x.path === first.target.path)?.area : first?.target.kind === 'note' ? ctx.notes?.find((x) => x.path === first.target.path)?.area : undefined;
  if (area && areaName(area)) add({ target: { kind: 'area', area, type: item.task ? 'task' : 'note', name: areaName(area)! }, why: `${first!.target.name} is in ${areaName(area)}` });
  return out.slice(0, 3);
}
