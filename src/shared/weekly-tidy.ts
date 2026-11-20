// The weekly tidy (2 Nov 2026, 10.0 plan item 21; vault-deep rank 4: "A weekly tidy Vault does and you approve,
// nothing ever deleted"). Once a week Vault looks over every note and prepares one proposal: notes that say the same
// thing (merged), links that point at nothing (pointed at the one note they name, or unlinked with the words kept),
// notes left empty (to Recently deleted), notes holding almost nothing (to the Bin, the vault check's quiet list
// answered here), notes at the top with a home to go to (moved, links kept working), and reminders long overdue
// (ticked done). The person applies each line or skips it; nothing is ever deleted for good and every change undoes.
//
// Pure: the main side plans through here and applies through the same writers every save, move and Bin use
// (src/main/weekly-tidy.ts). Locked notes, templates, left-out folders and project files (which have their own Tidy)
// are never proposed. New words here carry no em dashes, per the Endless Tech language.

import { inFolder } from './paths';
import { frontMatterRange } from './frontmatter';
import { extractLinks, replaceMarkdownLinks, replaceWikilinks, titleFromPath } from './markdown';
import { cosine, EMBED_DIM } from './meaning';
import { sameRecordName } from './record-match';
import { findReminders, locateReminder, setTicked } from './reminders';
import { isPrivatePath } from './private';
import { formatDate } from './dates';
import { scanTaskLines } from './one-task';

export const WEEK_MS = 7 * 86_400_000;
/** A skipped fix is not proposed again for 30 days. */
export const SKIP_MS = 30 * 86_400_000;
/** An untouched note is proposed for the Bin or a move after 7 days. */
export const SETTLED_MS = 7 * 86_400_000;
/** An open reminder with no repeat is stale 30 days past its moment. */
export const STALE_MS = 30 * 86_400_000;
/** At most 20 lines of one kind and 50 lines in a proposal. */
export const PER_KIND = 20;
export const TOTAL = 50;
/** Two notes read as near-duplicates by meaning at this cosine or above (tuned on the on-device model at
 *  note scale: near-identical pairs score 0.85 and up, a paragraph added 0.88, while a genuinely different note
 *  on the same topic scores 0.45 and the unrelated lower). */
export const TIDY_MEANING_MIN = 0.8;
/** A body shorter than this never merges by meaning (two bare "TODO" notes are not duplicates). */
export const TIDY_MEANING_BODY = 200;

export type TidyKind = 'duplicate' | 'broken-link' | 'empty' | 'thin' | 'wrong-place' | 'stale-reminder';

export interface TidyNote {
  path: string;
  title: string;
  content: string;
  /** When it last changed (ms). Unknown: proposed only where age does not matter. */
  mtime?: number;
  props?: Record<string, unknown>;
}

export type TidyAction =
  | { op: 'merge'; keep: string; drop: string }
  | { op: 'relink'; path: string; from: string; to: string }
  | { op: 'unlink'; path: string; target: string }
  | { op: 'bin'; path: string }
  | { op: 'move'; from: string; to: string }
  | { op: 'tick'; path: string; line: number; text: string; due: number };

export interface TidyItem {
  /** Stable inside one proposal (`duplicate-1`, `empty-2`). */
  id: string;
  /** Across proposals: a skipped key is quiet for 30 days. */
  key: string;
  kind: TidyKind;
  /** One short line ("Two notes called Shopping list"). */
  title: string;
  /** What Apply does, in full ("Merge Old list into Shopping list. ..."). */
  detail: string;
  /** The notes it touches, the first the one to open. */
  paths: string[];
  action: TidyAction;
}

export interface TidyHome {
  /** The folder it should be in ("Projects/Hall"). */
  dir: string;
  /** The place's name in words ("the Hall project"). */
  name: string;
  /** Why, in words ("Links to Hall Opening"). */
  why: string;
}

export interface TidyPlanContext {
  notes: TidyNote[];
  /** A link's target to the note it reaches (null: nowhere). */
  resolve(target: string, from: string): string | null;
  /** Where a top-level note belongs (null: no home found). The main side works this out through
   *  suggestInboxHome with the vault's real projects, people and areas. */
  suggestHome?(path: string): TidyHome | null;
  /** A note's meaning vector for the near-duplicate pass (null: none kept). Only embedding-space
   *  vectors count (384-wide, from the on-device model): hashed vectors are too coarse for merge
   *  proposals, so they sit out. Absent: names and bodies decide, as before. */
  vectors?(path: string): readonly number[] | null;
  /** Settings' templates folder: its notes are starting points, never tidied. */
  templatesFolder?: string;
  /** Left out of search (Settings): never tidied. */
  excluded?(path: string): boolean;
  /** Today's daily note: never proposed while it is being written. */
  dailyToday?: string;
  now: number;
  /** Skipped keys with when (a skip is quiet for 30 days). */
  skipped?: Record<string, number>;
}

const shortName = (p: string) => titleFromPath(p);
const typeOf = (n: TidyNote) => (typeof n.props?.type === 'string' ? n.props.type.toLowerCase() : '');
const cleanTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function tidiable(n: TidyNote, ctx: TidyPlanContext): boolean {
  if (isPrivatePath(n.path)) return false;
  if (ctx.dailyToday && n.path === ctx.dailyToday) return false;
  if (ctx.templatesFolder && inFolder(n.path, ctx.templatesFolder)) return false;
  if (ctx.excluded?.(n.path)) return false;
  // Project files have their own Tidy; merging or rewriting them here would be unsafe.
  if (typeOf(n) === 'project') return false;
  return true;
}

const settled = (n: TidyNote, now: number) => typeof n.mtime === 'number' && now - n.mtime >= SETTLED_MS;

/** The proposal's lines, most useful first, capped. A line skipped in the last 30 days is left out. */
export function planWeeklyTidy(ctx: TidyPlanContext): TidyItem[] {
  const notes = ctx.notes.filter((n) => tidiable(n, ctx));
  const skipped = ctx.skipped ?? {};
  const fresh = (key: string) => !(skipped[key] && ctx.now - skipped[key] < SKIP_MS);
  const out: TidyItem[] = [];
  const take = (items: TidyItem[]) => {
    for (const i of items) {
      if (out.length >= TOTAL) return;
      if (fresh(i.key)) out.push(i);
    }
  };
  take(findDuplicates(notes, ctx.vectors).slice(0, PER_KIND));
  take(findBrokenLinks(notes, ctx).slice(0, PER_KIND));
  take(findEmpty(notes, ctx).slice(0, PER_KIND));
  take(findThin(notes, ctx).slice(0, PER_KIND));
  take(findWrongPlace(notes, ctx).slice(0, PER_KIND));
  take(findStaleReminders(notes, ctx).slice(0, PER_KIND));
  // Numbered in output order so ids are stable inside the proposal.
  const seen = new Map<TidyKind, number>();
  for (const i of out) {
    const n = (seen.get(i.kind) ?? 0) + 1;
    seen.set(i.kind, n);
    i.id = `${i.kind}-${n}`;
  }
  return out;
}

// ── Notes that say the same thing ──────────────────────────────────────────────────────────────────────────────────

/** Whether a body is substantial enough to merge on (so two bare "TODO" notes never merge). */
function substantialBody(content: string): boolean {
  return content.replace(/\s+$/gm, '').replace(/\n+$/, '').replace(/\s/g, '').length >= TIDY_MEANING_BODY;
}

function findDuplicates(notes: TidyNote[], vectors?: (path: string) => readonly number[] | null): TidyItem[] {
  const out: TidyItem[] = [];
  const paired = new Set<string>();
  const propose = (keep: TidyNote, drop: TidyNote, why: string): void => {
    const pair = [keep.path, drop.path].sort().join('\n');
    if (paired.has(pair)) return;
    paired.add(pair);
    out.push({
      id: '',
      key: `duplicate\n${pair}`,
      kind: 'duplicate',
      title: `Two notes called ${keep.title || shortName(keep.path)}`,
      detail: `Merge ${shortName(drop.path)} into ${shortName(keep.path)}. ${why ? `${why} ` : ''}${shortName(drop.path)} moves to the Bin, and the kept note holds every line of both.`,
      paths: [keep.path, drop.path],
      action: { op: 'merge', keep: keep.path, drop: drop.path },
    });
  };
  // By name: the same record name in two places ("Shopping list", "shopping  list").
  const byName = new Map<string, TidyNote[]>();
  for (const n of notes) {
    const k = cleanTitle(n.title || shortName(n.path));
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), n]);
  }
  const groups = [...byName.values()].filter((g) => g.length > 1 && g.every((a) => g.every((b) => a === b || sameRecordName(a.title || shortName(a.path), b.title || shortName(b.path)))));
  // By body: the same words under different names (substantial bodies only, so two bare "TODO" notes never merge).
  const byBody = new Map<string, TidyNote[]>();
  for (const n of notes) {
    if (!substantialBody(n.content)) continue;
    const body = n.content.replace(/\s+$/gm, '').replace(/\n+$/, '');
    byBody.set(body, [...(byBody.get(body) ?? []), n]);
  }
  for (const g of [...byBody.values()].filter((g) => g.length > 1)) groups.push(g);
  for (const g of groups) {
    const sorted = [...g].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    const keep = sorted[0];
    for (const drop of sorted.slice(1)) propose(keep, drop, '');
  }
  // By meaning (10.0 reuse, 2 Nov 2026: agreed to the bundled meaning model): near-identical notes under
  // different names, read from the on-device model's vectors. Only pairs already not proposed, with
  // substantial bodies, in one embedding space (a hashed vector never meets an embedding).
  if (vectors) {
    const vecs = new Map<string, readonly number[]>();
    for (const n of notes) {
      if (!substantialBody(n.content)) continue;
      const v = vectors(n.path);
      if (v && v.length === EMBED_DIM) vecs.set(n.path, v);
    }
    const byPath = new Map(notes.map((n) => [n.path, n]));
    const list = [...vecs.keys()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = byPath.get(list[i])!;
        const b = byPath.get(list[j])!;
        const pair = [a.path, b.path].sort().join('\n');
        if (paired.has(pair)) continue;
        if (cosine(vecs.get(a.path)!, vecs.get(b.path)!) < TIDY_MEANING_MIN) continue;
        // The newest changed is kept, as names and bodies keep it.
        const [keep, drop] = (b.mtime ?? 0) > (a.mtime ?? 0) ? [b, a] : [a, b];
        propose(keep, drop, 'They say nearly the same thing.');
      }
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ── Links that point at nothing ────────────────────────────────────────────────────────────────────────────────────

const NOTE_EXT = /\.md$/i;
const FILE_EXT = /\.[A-Za-z0-9]{2,5}$/;
const baseOf = (t: string) => (t.split('/').pop() ?? t).replace(NOTE_EXT, '');

/** Candidates the broken target names: notes whose name says the same (one: relink; none or several: unlink). */
function relinkCandidates(notes: TidyNote[], target: string): TidyNote[] {
  const base = baseOf(target.split('#')[0]);
  if (!cleanTitle(base)) return [];
  return notes.filter((n) => sameRecordName(n.title || shortName(n.path), base) || sameRecordName(shortName(n.path), base));
}

function findBrokenLinks(notes: TidyNote[], ctx: TidyPlanContext): TidyItem[] {
  const out: TidyItem[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    for (const link of extractLinks(n.content)) {
      const target = link.target.trim();
      if (!target || seen.has(`${n.path}\n${target}`)) continue;
      if (ctx.resolve(target, n.path)) continue;
      // A file link (a PDF, a picture) is vault-check's to mend, never this proposal's.
      const noFrag = target.split('#')[0];
      if (!NOTE_EXT.test(noFrag) && FILE_EXT.test(noFrag)) continue;
      seen.add(`${n.path}\n${target}`);
      const found = relinkCandidates(notes, target);
      const key = `broken-link\n${n.path}\n${target}`;
      if (found.length === 1) {
        const to = found[0].path;
        out.push({
          id: '',
          key,
          kind: 'broken-link',
          title: `A link in ${shortName(n.path)} points nowhere`,
          detail: `Point ${baseOf(target) || target} at ${shortName(to)}. Every link in the note that says the same is fixed together.`,
          paths: [n.path, to],
          action: { op: 'relink', path: n.path, from: target, to },
        });
      } else if (!link.embed) {
        // An embed has no words to keep, so without one note to point it at it is left for the person.
        out.push({
          id: '',
          key,
          kind: 'broken-link',
          title: `A link in ${shortName(n.path)} points nowhere`,
          detail: found.length ? `No one note is ${baseOf(target) || target} (several match), so remove the link and keep the words.` : `Nothing is called ${baseOf(target) || target}, so remove the link and keep the words.`,
          paths: [n.path],
          action: { op: 'unlink', path: n.path, target },
        });
      }
    }
  }
  return out.sort((a, b) => a.paths[0].localeCompare(b.paths[0]) || a.title.localeCompare(b.title));
}

// ── Notes left empty ─────────────────────────────────────────────────────────────────────────────────────────────

const SYNTAX_LINE = /^\s*(#{1,6}\s*)?([-*+>|\s]|---|\.\.\.|```.*)?\s*$/;

/** Whether a note holds no words of its own: properties, bare headings and markup aside, nothing alphanumeric.
 *  A note that is only its title heading is empty (a tag line still counts: it has no space after its #). */
export function isEmptyNote(content: string): boolean {
  const range = frontMatterRange(content);
  const body = range ? content.slice(range.to) : content;
  for (const line of body.split('\n')) {
    if (/^\s*#{1,6}\s/.test(line)) continue;
    if (SYNTAX_LINE.test(line)) continue;
    if (/[\p{L}\p{N}]/u.test(line)) return false;
  }
  return true;
}

/** Fewer words than this (and not empty) is almost nothing: the vault check offers it for a look-over. */
export const THIN_WORDS = 20;

/** How many words a note holds of its own: properties and bare markup aside, headings counted. */
export function bodyWords(content: string): number {
  const range = frontMatterRange(content);
  const body = range ? content.slice(range.to) : content;
  let n = 0;
  for (const line of body.split('\n')) {
    if (SYNTAX_LINE.test(line)) continue;
    const words = line.match(/[\p{L}\p{N}]+/gu);
    if (words) n += words.length;
  }
  return n;
}

function findEmpty(notes: TidyNote[], ctx: TidyPlanContext): TidyItem[] {
  const out: TidyItem[] = [];
  for (const n of notes) {
    if (!settled(n, ctx.now) || !isEmptyNote(n.content)) continue;
    out.push({
      id: '',
      key: `empty\n${n.path}`,
      kind: 'empty',
      title: `${shortName(n.path)} is empty`,
      detail: 'Move it to the Bin. It stays there 30 days, and Undo brings it straight back.',
      paths: [n.path],
      action: { op: 'bin', path: n.path },
    });
  }
  return out.sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
}

/** A note holding more than words — an open task, a live reminder, or a file (a picture, a PDF) — is never
 *  "almost nothing" (Nov 2026, b6 break job: a task-only note, a chime-only note and a captioned photo were
 *  offered for the Bin as stubs). Done boxes and done reminders are history, not holdings. */
export function holdsMoreThanWords(content: string): boolean {
  const text = String(content ?? '');
  if (scanTaskLines(text).length > 0) return true;
  if (findReminders(text).some((r) => !r.done)) return true;
  for (const link of extractLinks(text)) {
    const noFrag = link.target.trim().split('#')[0];
    if (noFrag && !NOTE_EXT.test(noFrag) && FILE_EXT.test(noFrag)) return true;
  }
  return false;
}

/** The one thin reading, for the vault check's bell and the tidy's proposal alike: settled, not empty, fewer
 *  than THIN_WORDS words, and holding nothing more than words. */
export function isThinNote(content: string, mtime: number | undefined, now: number): boolean {
  if (typeof mtime !== 'number' || now - mtime < SETTLED_MS) return false;
  if (isEmptyNote(content)) return false;
  if (bodyWords(content) >= THIN_WORDS) return false;
  return !holdsMoreThanWords(content);
}

function findThin(notes: TidyNote[], ctx: TidyPlanContext): TidyItem[] {
  const out: TidyItem[] = [];
  for (const n of notes) {
    if (!isThinNote(n.content, n.mtime, ctx.now)) continue;
    out.push({
      id: '',
      key: `thin\n${n.path}`,
      kind: 'thin',
      title: `${shortName(n.path)} is almost empty`,
      detail: 'Move it to the Bin. It stays there 30 days, and Undo brings it straight back.',
      paths: [n.path],
      action: { op: 'bin', path: n.path },
    });
  }
  return out.sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
}

// ── Notes at the top with a home to go to ──────────────────────────────────────────────────────────────────────────

function findWrongPlace(notes: TidyNote[], ctx: TidyPlanContext): TidyItem[] {
  if (!ctx.suggestHome) return [];
  const out: TidyItem[] = [];
  const have = new Set(notes.map((n) => n.path.toLowerCase()));
  for (const n of notes) {
    if (n.path.includes('/') || !settled(n, ctx.now)) continue;
    const home = ctx.suggestHome(n.path);
    if (!home || !home.dir || have.has(`${home.dir}/${n.path}`.toLowerCase())) continue;
    out.push({
      id: '',
      key: `wrong-place\n${n.path}\n${home.dir}`,
      kind: 'wrong-place',
      title: `${shortName(n.path)} may belong in ${home.name}`,
      detail: `Move it to ${home.dir}. ${home.why}, and links to it keep working.`,
      paths: [n.path],
      action: { op: 'move', from: n.path, to: `${home.dir}/${n.path}` },
    });
  }
  return out.sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
}

// ── Reminders long overdue ─────────────────────────────────────────────────────────────────────────────────────────

function findStaleReminders(notes: TidyNote[], ctx: TidyPlanContext): TidyItem[] {
  const out: TidyItem[] = [];
  for (const n of notes) {
    for (const r of findReminders(n.content)) {
      // Repeating reminders move themselves on; only a one-off left behind is proposed.
      if (r.done || r.repeat || r.due >= ctx.now - STALE_MS) continue;
      const when = formatDate('D MMM YYYY', new Date(r.due));
      out.push({
        id: '',
        key: `stale-reminder\n${n.path}\n${r.text}\n${r.due}`,
        kind: 'stale-reminder',
        title: `A reminder in ${shortName(n.path)} is long overdue`,
        detail: `“${r.text}” was due ${when}. Mark it done.`,
        paths: [n.path],
        action: { op: 'tick', path: n.path, line: r.line, text: r.text, due: r.due },
      });
    }
  }
  return out.sort((a, b) => a.paths[0].localeCompare(b.paths[0]));
}

// ── Applying one line to text ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The wikilink text for a relinked note, the way a move writes it: the short name when it reaches from the note,
 * else the path without .md.
 */
export function relinkTargetText(to: string, fromWritten: string, source: string, resolve: (target: string, from: string) => string | null): string {
  const title = titleFromPath(to);
  if (!fromWritten.includes('/') && resolve(title, source) === to) return title;
  return to.replace(NOTE_EXT, '');
}

/** Every wikilink and Markdown link to `from` in the note pointed at its new text (aliases kept). */
export function relinkNoteText(content: string, from: string, toText: string): { text: string; changed: boolean } {
  let changed = false;
  let out = replaceWikilinks(content, (link, raw, embed) => {
    if (link.target !== from) return raw;
    changed = true;
    return `${embed ? '!' : ''}[[${toText}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
  });
  out = replaceMarkdownLinks(out, (target, fragment, raw, embed, label) => {
    if (target !== from) return raw;
    changed = true;
    const path = toText.includes('/') || toText.endsWith('.md') ? toText : `${toText}.md`;
    return `${embed ? '!' : ''}[${label}](${path.replace(/ /g, '%20')}${fragment})`;
  });
  return { text: out, changed };
}

/** Every link to `target` unwritten to its words (an alias's words, else the shown words, else the name itself). */
export function unlinkNoteText(content: string, target: string): { text: string; changed: boolean } {
  let changed = false;
  let out = replaceWikilinks(content, (link, raw, embed) => {
    if (embed || link.target !== target) return raw;
    changed = true;
    return link.alias || baseOf(target) || target;
  });
  out = replaceMarkdownLinks(out, (t, _fragment, raw, embed, label) => {
    if (embed || t !== target) return raw;
    changed = true;
    return label || baseOf(target) || target;
  });
  return { text: out, changed };
}

/** A stale reminder ticked where it sits now (lines above it may have moved; twins tell apart by their moment). */
export function tickReminderText(content: string, line: number, text: string, due: number): { text: string; changed: boolean } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const n = locateReminder(lines, line, text, due);
  if (n < 0) return { text: content, changed: false };
  const next = setTicked(lines[n], true);
  if (next === lines[n]) return { text: content, changed: false };
  lines[n] = next;
  return { text: lines.join(eol), changed: true };
}

// ── The seam Wave 1 and the former host app read
// ─ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TidyNeed {
  /** `tidy:<item id>`: the line it approves. */
  id: string;
  kind: 'tidy';
  title: string;
  detail: string;
  /** The note to open beside it. */
  note: string;
}

/** The proposal as Needs you entries: one per waiting line, same words in every door. */
export function tidyNeeds(items: readonly Pick<TidyItem, 'id' | 'title' | 'detail' | 'paths'>[]): TidyNeed[] {
  return items.map((i) => ({ id: `tidy:${i.id}`, kind: 'tidy' as const, title: i.title, detail: i.detail, note: i.paths[0] }));
}

// ── The words every door shares ────────────────────────────────────────────────────────────────────────────────────

/** The kinds in the order they are said (duplicates first, the small stuff last). */
export const TIDY_KINDS: TidyKind[] = ['duplicate', 'broken-link', 'empty', 'thin', 'wrong-place', 'stale-reminder'];

/**
 * Each fix kind's one button (10.0 whole, 2 Nov 2026: a person approves each line, so each line's button says what
 * it does). Plain words, no em dashes; the relink names the note it points at.
 */
export function tidyApplyWords(action: TidyAction): string {
  switch (action.op) {
    case 'merge':
      return 'Merge';
    case 'relink':
      return `Point at ${shortName(action.to)}`;
    case 'unlink':
      return 'Remove link';
    case 'bin':
      return 'Move to the Bin';
    case 'move':
      return 'Move';
    case 'tick':
      return 'Mark done';
  }
}

const KIND_ONE: Record<TidyKind, string> = { duplicate: 'duplicate', 'broken-link': 'broken link', empty: 'empty note', thin: 'thin note', 'wrong-place': 'misplaced note', 'stale-reminder': 'stale reminder' };
const KIND_MANY: Record<TidyKind, string> = { duplicate: 'duplicates', 'broken-link': 'broken links', empty: 'empty notes', thin: 'thin notes', 'wrong-place': 'misplaced notes', 'stale-reminder': 'stale reminders' };

/** What waits, by kind ("2 duplicates, 1 broken link"): the Today card and Settings say the same line. */
export function tidyKindCountWords(byKind: Partial<Record<TidyKind, number>>): string {
  const parts: string[] = [];
  for (const kind of TIDY_KINDS) {
    const n = byKind[kind] ?? 0;
    if (n > 0) parts.push(`${n} ${n === 1 ? KIND_ONE[kind] : KIND_MANY[kind]}`);
  }
  return parts.join(', ');
}

/** The week's id ("2026-W45"): one bell notice per proposal, never one per line. */
export function tidyWeekId(now = Date.now()): string {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const first = new Date(monday.getFullYear(), 0, 4);
  const week = 1 + Math.round((monday.getTime() - new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7)).getTime()) / WEEK_MS);
  return `${monday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
