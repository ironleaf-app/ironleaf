// The one Today count's reading (4 Nov 2026, p12-today-focus round 2: the rail and Needs you said two numbers).
// Own items late or due today, on live projects, plus own dated tasks and reminders in other notes — in every
// place (the rail, Today's heading, the former host app's Needs you and Telegram, the brief's vault lines). The
// predicates live here so both apps read them from one source: Ironleaf imports this file, the former host app
// reads it built (tools/build-embedded.mjs writes today-count.mjs into its desktop and work plugins, as
// reminders.mjs). Pure: no app state, only the vault's words. Moved whole from src/shared/today.ts (readDay,
// isShelved, isLive, isPerson, whoIsMe, ownerOf) so nothing has two copies; today.ts re-exports them.

import { isFinished } from './finished';
import type { Project } from './project-file';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY = 86_400_000;
export const pad = (n: number) => String(n).padStart(2, '0');
export const utcDay = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / DAY);
const dayOfDate = (d: Date) => utcDay(d.getFullYear(), d.getMonth(), d.getDate());
/** This PC's own day as a day number (9 Nov 2026: the graph weighed due days against the world-time day, so
 *  before 11 am in Melbourne a day-old due day still read "Due today"). The same local-midnight numbering
 *  readDay returns, so the two can be compared at any hour. */
export const todayDay = (now: Date = new Date()): number => dayOfDate(now);
const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase());
const valid = (y: number, m: number, d: number) => m >= 0 && m < 12 && d >= 1 && d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** How a date was written, so a date moved (snoozed) is written back the same way. */
export type DateStyle = 'iso' | 'dmy' | 'mdy' | 'slash' | 'word';

export interface ReadDay {
  /** Days from today: 0 today, 1 tomorrow, −1 yesterday. */
  offset: number;
  year: number;
  month: number;
  day: number;
  style: DateStyle;
  /** Written with its year (or a style that always has one). */
  withYear: boolean;
  /** The month written in full ("October", not "Oct"). */
  longMonth: boolean;
  /** For "slash": the separator and the year's digits. */
  sep?: string;
  shortYear?: boolean;
}

/**
 * A date as people write it in a project (2026-10-31, 31 Oct 2026, Fri 31 Oct, Oct 31, 31/10/2026 — day first, as in
 * Australia — today, tomorrow), against `today`. A date written without its year is the one nearest today (in December,
 * "10 Jan" is next month). Anything else ("Friday", "end of the month", "TBC") is not a day: null. A weekday said
 * with the date ("Thursday the 19th of November") must fall on it: a date that is not that weekday is not the day
 * said, so null (6 Nov 2026, HOLD 5).
 */
export function readDay(text: string | undefined, today: Date): ReadDay | null {
  if (!text) return null;
  const raw = String(text).trim().replace(/^by\s+/i, '');
  // A bare ISO day answers at once (t102, 9 Nov 2026): most dues are written 2026-11-01, and the weekday,
  // word and month patterns below can never match one. The same day as the long way round.
  const only = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const wdm = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(?:the\s+)?(?=\d|[A-Za-z]{3,9}\.?\s+\d)/i.exec(raw);
  const stated = wdm ? 'sun mon tue wed thu fri sat'.split(' ').indexOf(wdm[1].slice(0, 3).toLowerCase()) : -1;
  const t = wdm ? raw.slice(wdm[0].length) : raw.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  const base = dayOfDate(today);
  const make = (y: number, m: number, d: number, style: DateStyle, withYear: boolean, more: Partial<ReadDay> = {}): ReadDay | null =>
    valid(y, m, d) && (stated < 0 || new Date(Date.UTC(y, m, d)).getUTCDay() === stated) ? { offset: utcDay(y, m, d) - base, year: y, month: m, day: d, style, withYear, longMonth: false, ...more } : null;
  // Pure ISO carries no weekday (stated is -1), so this is the iso branch below, reached at once.
  if (only) return make(Number(only[1]), Number(only[2]) - 1, Number(only[3]), 'iso', true);
  // Without a year: this year's, last year's or next year's, whichever is nearest today.
  const nearest = (m: number, d: number) => {
    const y = today.getFullYear();
    let best = y;
    for (const c of [y - 1, y + 1]) if (valid(c, m, d) && Math.abs(utcDay(c, m, d) - base) < Math.abs(utcDay(best, m, d) - base)) best = c;
    return best;
  };
  const word = /^(today|tomorrow|yesterday)\b/i.exec(t);
  if (word) {
    const n = { today: 0, tomorrow: 1, yesterday: -1 }[word[1].toLowerCase() as 'today'];
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
    return make(d.getFullYear(), d.getMonth(), d.getDate(), 'word', false);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/.exec(t);
  if (iso) return make(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 'iso', true);
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?(?![\d])/.exec(t);
  if (dmy && monthOf(dmy[2]) >= 0 && (dmy[2].length === 3 || MONTH_NAMES.some((n) => n.toLowerCase().startsWith(dmy[2].toLowerCase())))) {
    const m = monthOf(dmy[2]);
    const d = Number(dmy[1]);
    return make(dmy[3] ? Number(dmy[3]) : nearest(m, d), m, d, 'dmy', !!dmy[3], { longMonth: dmy[2].length > 3 });
  }
  const mdy = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d])/.exec(t);
  if (mdy && monthOf(mdy[1]) >= 0 && (mdy[1].length === 3 || MONTH_NAMES.some((n) => n.toLowerCase().startsWith(mdy[1].toLowerCase())))) {
    const m = monthOf(mdy[1]);
    const d = Number(mdy[2]);
    return make(mdy[3] ? Number(mdy[3]) : nearest(m, d), m, d, 'mdy', !!mdy[3], { longMonth: mdy[1].length > 3 });
  }
  const slash = /^(\d{1,2})([/.])(\d{1,2})\2(\d{2}|\d{4})(?![\d])/.exec(t);
  if (slash) {
    const y = slash[4].length === 2 ? 2000 + Number(slash[4]) : Number(slash[4]);
    return make(y, Number(slash[3]) - 1, Number(slash[1]), 'slash', true, { sep: slash[2], shortYear: slash[4].length === 2 });
  }
  return null;
}

// Shelved (4 Nov 2026, p12-today-focus: an "on hold" project still counted in Today): on hold and idea projects count
// nowhere in Today, the rail, Needs you or Home late counts. Their tasks stay on the project page. Whole words only,
// so "Placeholder" is not on hold and "Ideal" is not an idea.
export const isShelved = (status?: string): boolean => /\bidea\b/i.test(status ?? '') || /\bon hold\b|\bhold\b|\bpause[ds]?\b|\bparked\b/i.test(status ?? '');
/** Live for the day: not done and not shelved (on hold or idea). */
export const isLive = (status?: string): boolean => !isFinished(status) && !isShelved(status);

/** Days past due before a task folds into "from a while back" (5 Nov 2026, u3 moving-in: a foreign vault opened to
 *  596 "late", topped by tasks 1,008 days late — old lines fold into a quiet group that never leads). One rule,
 *  every door (Due, Today, Tasks, the brief, the counts, both apps) reads it. No setting: the right default. */
export const STALE_AFTER_DAYS = 30;

/** Whether a day offset is stale: more than STALE_AFTER_DAYS past due. */
export const isStaleOffset = (offset: number): boolean => offset < -STALE_AFTER_DAYS;

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
const SELF = new Set(['me', 'i', 'myself', 'you', 'self', 'mine']);

/** Whether a step's "who" is this person: their name, their first name, or "me". */
export function isPerson(who: string, person: string | undefined): boolean {
  const w = norm(who);
  if (!w || SELF.has(w)) return true;
  if (!person) return false;
  const p = norm(person);
  if (!p) return false;
  // "Alex", "Alex M", "Alex Morgan", or several people one of whom is them ("Alex, Darcy").
  return String(who)
    .split(/\s*(?:,|&|\/|\band\b|\+)\s*/i)
    .map(norm)
    .filter(Boolean)
    // "North team, coordinated by Jesse Arlow": the person named in full at the end of a part is the one it is on.
    .some((part) => {
      if (part === p || p.startsWith(`${part} `) || part.startsWith(`${p} `) || part.endsWith(` ${p}`)) return true;
      // One name alone is their first or their last ("Morgan" is Alex Morgan; Nov 2026 audit); two names that differ
      // ("Alex Lee" against "Alex Morgan") are never the same person.
      if (part.split(' ').length !== 1) return false;
      const words = p.split(' ');
      return part === words[0] || (words.length > 1 && part === words[words.length - 1]);
    });
}

/** Whether two owners do not positively differ: neither names anyone, one side names nobody (an unnamed side never
 *  contradicts a named one), or both name the same person (the people's own reading, isPerson both ways, so "Sam"
 *  and "Sam Okafor" are one — while "Sam Okafor" and "Sam Reid" never are). Only two different named people differ.
 *  For joins that must not duplicate on a missing name yet must never cross people (t179 break-it fourth: filing a
 *  meeting's actions into its project, ticking and done-ness across the two, prep's once-only, the readers' own
 *  dedupe): the one list's isSameTask stays strict (hiding a row needs certainty), these stay lenient (an ownerless
 *  same-words step plausibly is the job). */
export function ownerCompatible(a: string | undefined, b: string | undefined): boolean {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return true;
  return isPerson(x, y) && isPerson(y, x);
}

/**
 * Whose day this is: the name given (Settings), else the owner of most of the live projects (the person whose projects
 * these are). With no clear owner, null: a step then waits on someone else when it names anyone but its project's owner.
 * Takes the status and owner alone, so the former host app's file walk can ask it without parsing whole projects.
 */
export function whoIsMe(projects: Pick<Project, 'status' | 'owner'>[], given?: string): string | null {
  if (given?.trim()) return given.trim();
  const counts = new Map<string, { name: string; n: number }>();
  let owned = 0;
  for (const p of projects) {
    if (!isLive(p.status) || !p.owner?.trim()) continue;
    owned++;
    const key = norm(p.owner);
    const e = counts.get(key) ?? { name: p.owner.trim(), n: 0 };
    e.n++;
    counts.set(key, e);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return top && top.n >= 2 && top.n * 2 > owned ? top.name : null;
}

/**
 * A step's owner and day as the line means them (29 Oct 2026, the vault): "from [[a note]] — Jesse" is Jesse's (the note
 * is where it came from); "— Fri 23 Oct, 11:00 AM" is a day, not a person.
 */
export function ownerOf(who: string | undefined, when: string | undefined, now: Date): { who?: string; when?: string } {
  let w = (who ?? '').trim();
  const cut = w.lastIndexOf(' — ');
  if (/^from\b/i.test(w) && cut > 0) w = w.slice(cut + 3).trim();
  // A day is only read when one could be written (t102, 9 Nov 2026): every day readDay knows carries a digit
  // or today/tomorrow/yesterday, so a bare name never walks its patterns. The same answer either way.
  const cand = w.replace(/\s*\(.*$/, '');
  if (w && !when && /[\d]|today|tomorrow|yesterday/i.test(cand) && readDay(cand, now)) return { when: cand };
  return { ...(w ? { who: w } : {}), ...(when ? { when } : {}) };
}

// ── The file walk's reading (the former host app's side of the one count)
// ─ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A note's front matter as the count needs it: a project or not, its status and owner. */
export function projectHead(text: string): { isProject: boolean; status?: string; owner?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? '').slice(0, 4000));
  if (!m) return { isProject: false };
  // The same rule as isProjectProps (src/shared/project-file.ts), read from raw text: any case, quoted or [[linked]].
  if (!/^type:\s*["']?(?:\[\[)?project(?:\]\])?["']?\s*$/mi.test(m[1])) return { isProject: false };
  const status = /^status:\s*(.+?)\s*$/mi.exec(m[1])?.[1];
  const owner = /^owner:\s*(.+?)\s*$/mi.exec(m[1])?.[1];
  return { isProject: true, ...(status ? { status } : {}), ...(owner ? { owner } : {}) };
}

/** Whether a note's text is a shelved (on hold or idea) project file: it counts nowhere. */
export function shelvedProjectText(text: string): boolean {
  const head = projectHead(text);
  return head.isProject && isShelved(head.status);
}

/** Whether a note's text is a dormant project file — finished or shelved (5 Nov 2026, the plan one list: finished
 *  AND on-hold projects count nowhere: not Today, not Tasks, not the badges, not the brief, not the bots', not the
 *  former host app's). The one dormancy reading: a project whose status is not live. Its boxes stay in its notes
 *  untouched, and its page still shows them; every counter reads this, so the number is one everywhere. */
export function isDormantProjectText(text: string): boolean {
  const head = projectHead(text);
  return head.isProject && !isLive(head.status);
}

/** Whether a tail name is someone the vault knows (one of `known`, by the people's own reading, either way round):
 *  the one owner confidence (5 Nov 2026, u3 moving-in: a foreign vault's random "— Name" tails blamed strangers —
 *  "33 waiting on others", "185 things to chase"). Sure: linked, or matching known. Maybe: a bare stranger. */
export function isKnownOwner(tail: string, known: readonly string[], memo?: Map<string, boolean>): boolean {
  const w = String(tail ?? '').trim();
  if (!w) return false;
  // The same tails ask again and again down a task list (t102, 9 Nov 2026): kept per list, so each tail
  // walks the known people once. Pure for one known list, so the memo must not outlive it.
  const had = memo?.get(w);
  if (had !== undefined) return had;
  const out = known.some((k) => k && (isPerson(w, k) || isPerson(k, w)));
  memo?.set(w, out);
  return out;
}

/**
 * Whether a task or reminder line's words are the person's own (round 2: no owner filter meant Needs you counted
 * other people's tasks). No owner written is theirs; "me" is theirs; a name is theirs when it is them (isPerson).
 * A day written after the dash ("— Fri 23 Oct") is its day, not a person, so it stays theirs. With `known` (the
 * vault's known people), a bare tail naming a stranger is theirs too (5 Nov 2026, u3 moving-in: a mention, never
 * debt); without it, every name reads as before.
 */
export function isOwnText(words: string, me: string | null | undefined, now: Date = new Date(), known?: readonly string[] | null, memo?: Map<string, boolean>): boolean {
  const tail = /\s+[—–]\s+(.+)$/.exec(String(words ?? '').trim())?.[1];
  if (!tail) return true;
  let who: string | undefined;
  // "— Who — due when", "— Who, due when": the date part is when, never a person (p16-owner-tail, 4 Nov 2026); a
  // second dash or a comma only splits before by/due, so a real name with a hyphen or a dash inside stays whole.
  const segments = tail
    .split(/\s+·\s+/)
    .flatMap((seg) => seg.split(/\s+[—–]\s+(?=(?:by|due)\s+)/i))
    .flatMap((seg) => seg.split(/,\s*(?=(?:by|due)\s+)/i));
  for (const part of segments) {
    if (/^(?:by|due)\s+/i.test(part.trim())) continue;
    if (part.trim() && who === undefined) who = part.trim();
  }
  if (!who) return true;
  const split = ownerOf(who, undefined, now);
  if (!split.who) return true;
  if (isPerson(split.who, me ?? undefined)) return true;
  // A stranger's mention is not debt (5 Nov 2026, u3 moving-in): with known people given, a tail naming nobody
  // known stays the person's own — quiet, still listed, never "waiting on others".
  if (known && !isKnownOwner(split.who, known, memo)) return true;
  return false;
}
