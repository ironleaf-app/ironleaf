// Quick capture (the box a Windows-wide key opens over whatever the person is doing): what it understands and where it
// files things, as plain functions both sides use and the tests check (tests/capture.test.mjs).
//
//   parseDue        "Send the quote to Priya by Friday" → by Fri 23 Oct, and the words without "by Friday"
//   suggestProjects the projects a capture most likely belongs to, each with why (its words, the window, recent work)
//   planCapture     where it goes: a project's next steps, a note in the project's folder, today's note or the Inbox,
//                   and where its pictures and files go (the project's folder › Captures, beside the note, or the assets)
//   acceleratorOf   the keys chosen in Settings, as Electron's global shortcut writes them ("Control+Alt+N")

import { cleanFileName } from './paths';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORDS: [RegExp, number][] = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

/** A due date found in a task's words. */
export interface DueDate {
  /** 2026-10-23 */
  iso: string;
  /** As a project's lines write dates: "23 Oct 2026". */
  line: string;
  /** As people read it: "Fri 23 Oct" (with the year when it isn't this one). */
  words: string;
  /** The words that said it, as typed ("by Friday"). */
  phrase: string;
  /** The task without them ("Send the quote to Priya"). */
  rest: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const lineOf = (d: Date) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
/** "Fri 23 Oct", "Mon 4 Jan 2027" (another year). */
export function dayWords(d: Date, today: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

const dayIndex = (word: string): number => DAY_WORDS.find(([re]) => re.test(word.toLowerCase()))?.[1] ?? -1;
const monthIndex = (word: string): number => MONTHS.indexOf(word.toLowerCase().slice(0, 3));
/** Monday of the week a day is in (weeks start on Monday, as Australian calendars do). */
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** A day and month with no year: this year's, or next year's when it has passed. */
function nextDate(today: Date, month: number, day: number, year?: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let y = year ?? today.getFullYear();
  if (year !== undefined && year < 100) y = 2000 + year;
  let d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  if (year === undefined && d < startOfDay(today)) d = new Date(y + 1, month, day);
  return d;
}

interface Found {
  at: number;
  length: number;
  date: Date;
  /** Said with "by", "due", "before"… (preferred over a date that's only mentioned). */
  firm: boolean;
}

const LEAD = String.raw`(?:(by|due(?:\s+(?:on|by))?|before|until|till|on|for)\s+)?`;
/** A time of day at the start of what follows a weekday ("3pm", "3:30 pm", "at 3pm", "at 3", "15:00"). */
const TIME_AFTER = /^[\s.,;:!?)]*(?:at\s+\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})/i;
const DAY = String.raw`(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

/**
 * The due date in a task's words, relative to `today`: "by Friday", "tomorrow", "next Tuesday", "end of the week", "in 2
 * weeks", "24 Oct", "Oct 24", "24/10", "2026-10-24". A weekday is the next one after today ("Friday" said on a Friday is
 * next week's); "next Friday" is the Friday of next week; "next week" is the Friday of next week and "next month" the
 * end of next month; a date with no year is the next one from today. Null when the
 * words say no date. When there are several, one said with "by"/"due" wins, else the last.
 */
export function parseDue(text: string, today: Date = new Date()): DueDate | null {
  const words = String(text ?? '');
  const base = startOfDay(today);
  const found: Found[] = [];
  const scan = (pattern: string, make: (m: RegExpExecArray) => Date | null, opts: { needLead?: boolean } = {}) => {
    const re = new RegExp(String.raw`(?<![\p{L}\p{N}])` + LEAD + pattern + String.raw`(?![\p{L}\p{N}])`, 'giu');
    for (let m = re.exec(words); m; m = re.exec(words)) {
      const lead = m[1];
      if (opts.needLead && !lead) continue;
      const date = make(m);
      if (date) found.push({ at: m.index, length: m[0].length, date, firm: !!lead && !/^(on|for)$/i.test(lead) });
    }
  };
  scan(String.raw`(today|tonight|eod|end\s+of\s+(?:the\s+)?day)`, () => base);
  scan(String.raw`(tomorrow|tmrw|tmr)`, () => addDays(base, 1));
  scan(String.raw`(day\s+after\s+tomorrow)`, () => addDays(base, 2));
  // "next week" is the Friday of next week and "next month" the end of next month, as meeting actions read them
  // (src/shared/days.ts): a due date says when it is due by, not the first day after. "this week" and "this month"
  // already say the Friday and the end of this one.
  // "this Friday", "next Friday", "Friday" (a short name, or a bare one in the middle of words, only after "by", "on"…).
  scan(String.raw`(this|next|coming|the\s+coming)?\s*` + DAY, (m) => {
    const which = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ');
    const day = dayIndex(m[3]);
    if (day < 0) return null;
    // "Sat" or "Wed" alone are words too ("I sat with Priya"): a weekday without "by", "on", "this" or "next" counts
    // only written in full and last ("Call Sam Friday"). A time after it ("Call Sam Friday 3pm") doesn't stop it
    // being last: the day counts and the time stays in the words. A bare number ("Friday 3 stooges") is not a time.
    if (!m[1] && !which && (m[3].length < 6 || words.slice(m.index + m[0].length).replace(TIME_AFTER, '').replace(/[\s.!?,;:)]+/g, '') !== '')) return null;
    if (which === 'next') return addDays(mondayOf(addDays(base, 7)), (day + 6) % 7);
    const ahead = (day - base.getDay() + 7) % 7;
    if (which === 'this') return addDays(base, ahead);
    return addDays(base, ahead === 0 ? 7 : ahead);
  });
  // The end of the week is its Friday (today on a Friday; next week's on a weekend).
  scan(String.raw`(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?week|eow|this\s+week)`, () => addDays(base, (5 - base.getDay() + 7) % 7));
  scan(String.raw`(?:next\s+week)`, () => addDays(base, ((5 - base.getDay() + 7) % 7) + 7));
  scan(String.raw`(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?month|eom|this\s+month)`, () => new Date(base.getFullYear(), base.getMonth() + 1, 0));
  scan(String.raw`(?:next\s+month)`, () => new Date(base.getFullYear(), base.getMonth() + 2, 0));
  scan(String.raw`in\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a\s+couple\s+of|a\s+few)\s+(days?|weeks?|months?)`, (m) => {
    const raw = m[2].toLowerCase().replace(/^a\s+(couple|few)\s*(of)?$/, '$1');
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = m[3].toLowerCase();
    if (unit.startsWith('day')) return addDays(base, n);
    if (unit.startsWith('week')) return addDays(base, n * 7);
    const d = new Date(base.getFullYear(), base.getMonth() + n, 1);
    return new Date(d.getFullYear(), d.getMonth(), Math.min(base.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  });
  // "24 Oct", "24th of October 2026"; "Oct 24", "October 24th, 2026".
  scan(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?` + MONTH + String.raw`(?:\s+(\d{4}))?`, (m) => nextDate(base, monthIndex(m[3]), Number(m[2]), m[4] ? Number(m[4]) : undefined));
  scan(MONTH + String.raw`\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, (m) => nextDate(base, monthIndex(m[2]), Number(m[3]), m[4] ? Number(m[4]) : undefined));
  // "24/10", "24/10/2026", "24/10/26": the day first, as Australians write it.
  // Without a year, only after "by", "due"… (a bare 1/2 is more often a half than 1 February).
  scan(String.raw`(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?`, (m) => (m[1] || m[4] ? nextDate(base, Number(m[3]) - 1, Number(m[2]), m[4] ? Number(m[4]) : undefined) : null));
  scan(String.raw`(\d{4})-(\d{2})-(\d{2})`, (m) => nextDate(base, Number(m[3]) - 1, Number(m[4]), Number(m[2])));
  if (!found.length) return null;
  // Overlapping finds ("next Friday" and "Friday"): the longest.
  const kept = found
    .sort((a, b) => a.at - b.at || b.length - a.length)
    .filter((f, i, all) => !all.some((g, j) => j !== i && g.at <= f.at && g.at + g.length >= f.at + f.length && g.length > f.length));
  const pick = [...kept].sort((a, b) => Number(b.firm) - Number(a.firm) || b.at - a.at)[0];
  const phrase = words.slice(pick.at, pick.at + pick.length);
  const rest = (words.slice(0, pick.at) + ' ' + words.slice(pick.at + pick.length))
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:–—-]+$/u, '')
    .replace(/^[\s,;:–—-]+/u, '')
    .trim();
  return { iso: isoOf(pick.date), line: lineOf(pick.date), words: dayWords(pick.date, base), phrase: phrase.trim(), rest: rest || words.trim() };
}

// ——— Which project ————————————————————————————————————————————————————————————————————————————————————————————————

/** What the box knows about a project to suggest it. */
export interface CaptureProject {
  /** The project's file in the library ("Projects/Studio Upgrade/Studio Upgrade.md"). */
  path: string;
  name: string;
  /** The last part of its folder on the PC ("01 Studio upgrade"), when it has one. */
  folderName?: string;
  /** Its owner and people. */
  people: string[];
  tags: string[];
  status?: string;
  /** When it (or a note of it) last changed, in ms. */
  modified: number;
}

export interface ProjectSuggestion {
  path: string;
  name: string;
  score: number;
  /** Why, in a few words: "Mentions Priya Shah", "From the window you were in", "Worked on today". */
  reason: string;
  /** What the guess rests on: the capture's words, the window the person was in, or only recent work. */
  evidence: 'words' | 'window' | 'recent';
}

/** Words too everyday to file by ("it", "new", "review"): shared with the Inbox's own matching. */
export const STOP_WORDS = new Set(
  'a an and the of to for in on at by with from into over under is are be it its this that these those my our your their we you i me us new project projects plan team work stuff notes note task tasks update review'.split(' '),
);

/** Words for matching: lower case, accents off, _ . - as spaces. */
export function matchText(text: string): string {
  return ` ${String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}
/** A name's words that say something (four letters or more: "fit" and "out" in "Harbour Fit-out" are everyday words). */
const tokens = (text: string) => matchText(text).trim().split(' ').filter((t) => t.length >= 4 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
const hasPhrase = (hay: string, phrase: string) => {
  const p = matchText(phrase).trim();
  return p.length >= 3 && hay.includes(` ${p} `);
};
/** A short name said in capitals ("IT", "3M", "Al"): whole words on the raw text, so lowercase "it" never counts. */
const saysShort = (raw: string, ...names: string[]) =>
  names.some((name) => {
    const t = name.trim();
    if (!t || /\s/.test(t) || matchText(t).trim().length >= 3) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}_]|$)`, 'u').test(raw);
  });
/** A word as the project writes it ("Harbour", not "harbour"). */
/** Words always written with a capital, so a capital says nothing about a name: months and days. */
const ALWAYS_CAPITAL = new Set(['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
/**
 * A word said as a name: written with its capital at least twice, at least once mid-sentence (after a word or a
 * comma, not at the start of a line or after a full stop). "Your Harbourline shop" is a name; "Refit your kitchen"
 * at the start of a subject is not. Months and days always carry a capital, so they never count.
 */
export function saidAsName(text: string, word: string): boolean {
  if (!word || ALWAYS_CAPITAL.has(word.toLowerCase())) return false;
  const cap = word.charAt(0).toUpperCase() + word.slice(1);
  if (cap.charAt(0) === cap.charAt(0).toLowerCase()) return false;
  const esc = cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'gu');
  let count = 0;
  let mid = false;
  for (const m of String(text ?? '').matchAll(re)) {
    count++;
    const before = String(text).slice(0, (m.index ?? 0) + m[1].length).replace(/[ \t]+$/, '');
    if (before && /[\p{L}\p{N},]$/u.test(before)) mid = true;
  }
  return count >= 2 && mid;
}
const originalWord = (source: string, token: string) => source.split(/[^\p{L}\p{N}]+/u).find((w) => matchText(w).trim() === token) ?? token;
/** A folder's name without its number in front ("01 Studio upgrade" → "Studio upgrade"). */
const bareFolder = (name: string) => name.replace(/^\s*[\d.]+[\s._-]+/, '').trim();

/**
 * The projects a capture most likely belongs to, best first, each with why. Its words count most (the project's name,
 * its folder's name, its people, a distinctive word of its name, its tags), then the window the person was in (its title:
 * "Store_Upgrade_Status.xlsx - Excel"), then recent work. Projects that are done count less. Without anything in the
 * words or the window, the most recent projects come back (evidence 'recent'), to choose from in one click.
 */
export function suggestProjects(input: { text: string; nameWords?: string; windowTitle?: string | null; projects: CaptureProject[]; recent?: string[]; now?: number; max?: number }): ProjectSuggestion[] {
  const now = input.now ?? Date.now();
  const hay = matchText(input.text);
  const title = input.windowTitle ? matchText(input.windowTitle) : '';
  const projects = input.projects.filter((p) => p && p.path && p.name);
  // How many projects share each name word: a word in only one project's name says more.
  const shared = new Map<string, number>();
  for (const p of projects) for (const t of new Set([...tokens(p.name), ...tokens(bareFolder(p.folderName ?? ''))])) shared.set(t, (shared.get(t) ?? 0) + 1);
  const firstNames = new Map<string, number>();
  for (const p of projects) for (const who of new Set(p.people.map((x) => matchText(x).trim().split(' ')[0]).filter((x) => x && x.length >= 3))) firstNames.set(who, (firstNames.get(who) ?? 0) + 1);
  const recentRank = new Map((input.recent ?? []).map((p, i) => [p, i]));
  const out: ProjectSuggestion[] = [];
  for (const p of projects) {
    let words = 0;
    let window = 0;
    const why: [number, string][] = [];
    const say = (points: number, reason: string) => why.push([points, reason]);
    // Its words.
    if (saysShort(input.text, p.name, p.name.charAt(0).toUpperCase() + p.name.slice(1))) {
      words += 100;
      say(100, `Says “${p.name}”`);
    } else if (hasPhrase(hay, p.name)) {
      words += 100;
      say(100, `Says “${p.name}”`);
    } else if (p.folderName && hasPhrase(hay, bareFolder(p.folderName))) {
      words += 70;
      say(70, `Says “${bareFolder(p.folderName)}”`);
    } else {
      const own = [...new Set([...tokens(p.name), ...tokens(bareFolder(p.folderName ?? ''))])];
      const hits = own.filter((t) => hay.includes(` ${t} `));
      if (hits.length) {
        // One word alone never files (t243 capped short words; t244 break-it, 12 Nov 2026: a long word still
        // filed on its own — "Refit your kitchen" to the back-room refit on "refit", "The cart is fixed" to
        // the cart fix on "cart" with recency pushing it over). One hit orders first with its reason, but
        // stays under the bar however long the word and however recent the work; two words, a person, a tag
        // or the window with it still file.
        const full = Math.round(hits.reduce((sum, t) => sum + (t.length >= 6 ? 36 : 12) / (shared.get(t) ?? 1), 0));
        // Except a name said as a name (12 Nov 2026: the supplier email "Harbourline awning quote …
        // Your Harbourline shop …" stopped finding its project): a word in only this project's name, 6 letters
        // or more, written with its capital at least twice in the words and at least once mid-sentence. A
        // bank's "Refit your kitchen" says it once, at the start of a line, so it still never files.
        const asName = hits.length === 1 && hits[0].length >= 6 && (shared.get(hits[0]) ?? 1) === 1 && saidAsName(`${input.text}\n${input.nameWords ?? ''}`, originalWord(`${p.name} ${p.folderName ?? ''}`, hits[0]));
        const points = hits.length > 1 || asName ? full : Math.min(full, 9);
        words += points;
        // Each word that counted is named (t243: "the back room" says "back" and "room", never "back" alone).
        const said = hits.slice(0, 2).map((t) => `“${originalWord(`${p.name} ${p.folderName ?? ''}`, t)}”`).join(' and ');
        say(points, `Says ${said}`);
      }
    }
    for (const person of p.people) {
      const full = matchText(person).trim();
      if (full.includes(' ') && hay.includes(` ${full} `)) {
        words += 45;
        say(45, `Mentions ${person.trim()}`);
        continue;
      }
      const first = full.split(' ')[0];
      const stored = person.trim().split(/\s+/)[0] ?? '';
      if (first && first.length >= 3 && !STOP_WORDS.has(first) && hay.includes(` ${first} `)) {
        const points = Math.round(26 / (firstNames.get(first) ?? 1));
        words += points;
        say(points, `Mentions ${stored}`);
      } else if (first && first.length === 2 && saysShort(input.text, stored, stored.charAt(0).toUpperCase() + stored.slice(1))) {
        const points = Math.round(26 / (firstNames.get(first) ?? 1));
        words += points;
        say(points, `Mentions ${stored}`);
      }
    }
    for (const tag of p.tags) {
      if (hasPhrase(hay, tag.replace(/[-_/]/g, ' '))) {
        words += 14;
        say(14, `About ${tag}`);
      }
    }
    // The window the person was in.
    if (title) {
      if (hasPhrase(title, p.name)) window += 70;
      else if (p.folderName && hasPhrase(title, bareFolder(p.folderName))) window += 60;
      else {
        const hits = [...new Set([...tokens(p.name), ...tokens(bareFolder(p.folderName ?? ''))])].filter((t) => title.includes(` ${t} `));
        if (hits.length) window += Math.round(hits.reduce((sum, t) => sum + 24 / (shared.get(t) ?? 1), 0));
      }
      if (window) say(window, 'From the window you were in');
    }
    // Recent work: a little, to break ties and to offer something when nothing else is known.
    const age = now - p.modified;
    let recent = age < 86400000 ? 8 : age < 3 * 86400000 ? 5 : age < 7 * 86400000 ? 3 : 0;
    const rank = recentRank.get(p.path);
    if (rank !== undefined) recent += Math.max(0, 6 - rank * 2);
    const done = /^(done|closed|complete(d)?|cancelled)$/i.test(p.status ?? '') ? -15 : 0;
    const score = words + window + recent + done;
    const best = why.sort((a, b) => b[0] - a[0])[0]?.[1];
    const evidence: ProjectSuggestion['evidence'] = words > 0 ? 'words' : window > 0 ? 'window' : 'recent';
    out.push({ path: p.path, name: p.name, score, evidence, reason: best ?? (rank === 0 ? 'Your last capture' : age < 86400000 ? 'Worked on today' : age < 7 * 86400000 ? 'Worked on this week' : 'A recent project') });
  }
  const max = input.max ?? 4;
  // What the words say comes before what the window suggests; then by how sure.
  const tier = (s: ProjectSuggestion) => (s.evidence === 'words' ? 1 : 0);
  const sure = out.filter((s) => s.evidence !== 'recent').sort((a, b) => tier(b) - tier(a) || b.score - a.score);
  const rest = out.filter((s) => s.evidence === 'recent' && !/^(done)$/i.test(projects.find((p) => p.path === s.path)?.status ?? '')).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return [...sure, ...rest].slice(0, max);
}

/** The project chosen for the person before they choose: the best suggestion when its words or the window point to it. */
export function chosenSuggestion(list: ProjectSuggestion[]): ProjectSuggestion | null {
  const top = list[0];
  if (!top || top.evidence === 'recent' || top.score < 24) return null;
  // Two projects equally likely: let the person choose.
  if (list[1] && list[1].evidence !== 'recent' && list[1].score === top.score) return null;
  return top;
}

// ——— Where it goes ————————————————————————————————————————————————————————————————————————————————————————————————

export type CaptureKind = 'note' | 'task';
export type NoProjectPlace = 'daily' | 'inbox';

export interface CapturePlanInput {
  kind: CaptureKind;
  text: string;
  /** The project chosen, or null ("No project"). `pcFolder`: its folder on this PC when it has one that is there. */
  project: { path: string; name: string; pcFolder?: string | null } | null;
  /** Pictures (screenshots) and files (dragged in) with it. */
  pictures: number;
  files: number;
  /** "Save to assets" ticked: pictures and files go to the asset store. */
  toAssets: boolean;
  noProject: NoProjectPlace;
  /** Today's note and the Inbox note, in the library. */
  dailyPath: string;
  inboxPath: string;
  /** Where pasted and dropped files go for a note (Settings › Files and links), worked out for the note they're in. */
  attachmentsFor(notePath: string): string;
  now: Date;
  /** The person said the date in the words isn't a due date (the × on it). */
  ignoreDue?: boolean;
}

export interface CapturePlan {
  /** A task for a project: a next step through the project's own edit (with by-when, when the words said one). */
  nextStep?: { project: string; what: string; when?: string; more?: string };
  /** A note made in the project's folder in the library. */
  newNote?: { folder: string; title: string };
  /** Lines added to today's note or the Inbox, under "## Captured". */
  append?: { path: string; place: NoProjectPlace };
  /** Where the pictures and files go: a library folder, the project's folder on the PC, or the asset store. */
  attach: { place: 'library' | 'pc' | 'assets'; folder: string } | null;
  /** The due date, when a task's words gave one. */
  due: DueDate | null;
  /** The task's first line, tidied (without its "by Friday"); a note's whole words. */
  what: string;
  /** A task's lines after its first, kept word for word (a next step's detail, or under its tick-box). */
  rest?: string;
}

/** A note's name from its first line: short, nothing Windows refuses in a file name; else "Capture 17 Oct 2026 1405". */
export function noteTitle(text: string, now: Date): string {
  const first = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(#+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '').trim())
    .find(Boolean);
  const cleaned = (first ?? '')
    .replace(/\[\[([^\]|]*)(\|([^\]]*))?\]\]/g, (_m, a: string, _b, c: string) => c || a)
    .replace(/[<>:"/\\|?*\u0000-\u001f#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A long first line: cut at the last whole word within 60 letters.
  const cut = cleaned.length > 60 ? cleaned.slice(0, 61).replace(/\s+\S*$/, '') || cleaned.slice(0, 60) : cleaned;
  const title = cut.replace(/[. ]+$/, '').trim();
  return title || `Capture ${lineOf(now)} ${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** The folder a project's notes are in (its file's folder in the library). */
export const projectNotesFolder = (projectPath: string) => (projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : '');

/** Where a capture note of this title would be filed: found first, so capturing twice grows one note, never a " 2". */
export const captureNotePath = (folder: string, title: string) => `${folder ? `${folder}/` : ''}${cleanFileName(title, 'Capture')}.md`;

export function planCapture(input: CapturePlanInput): CapturePlan {
  const text = String(input.text ?? '').replace(/\r\n/g, '\n').trim();
  const due = input.kind === 'task' && !input.ignoreDue ? parseDue(text.split('\n')[0], input.now) : null;
  // A task's first line with words is the task; its later lines ride along (never dropped, never mushed into it).
  const body = input.kind === 'task' ? (due ? due.rest : text) : text;
  const lines = body.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  const what = input.kind === 'task' ? (firstIdx >= 0 ? lines[firstIdx].trim() : '') : text;
  const rest = input.kind === 'task' && firstIdx >= 0 ? lines.slice(firstIdx + 1).join('\n').trim() : '';
  const hasAttachments = input.pictures + input.files > 0;
  const plan: CapturePlan = { attach: null, due, what, ...(rest ? { rest } : {}) };
  const p = input.project;
  if (input.kind === 'task' && what) {
    if (p) plan.nextStep = { project: p.path, what, ...(due ? { when: due.line } : {}), ...(rest ? { more: rest } : {}) };
    else plan.append = { path: input.noProject === 'inbox' ? input.inboxPath : input.dailyPath, place: input.noProject };
  } else if (input.kind === 'note' && text) {
    if (p) plan.newNote = { folder: projectNotesFolder(p.path), title: noteTitle(text, input.now) };
    else plan.append = { path: input.noProject === 'inbox' ? input.inboxPath : input.dailyPath, place: input.noProject };
  } else if (hasAttachments && !p) {
    // Only a picture or a file, and no project: it goes in today's note (or the Inbox), so it is found again.
    plan.append = { path: input.noProject === 'inbox' ? input.inboxPath : input.dailyPath, place: input.noProject };
  }
  if (hasAttachments) {
    if (input.toAssets) plan.attach = { place: 'assets', folder: '' };
    // With a note: beside the note (Captures in the project's folder of notes), so the note shows them.
    else if (plan.newNote) plan.attach = { place: 'library', folder: [plan.newNote.folder, 'Captures'].filter(Boolean).join('/') };
    // On their own (or with a next step): the project's folder on the PC, its file store, where its page shows them.
    else if (p && p.pcFolder) plan.attach = { place: 'pc', folder: p.pcFolder.replace(/[\\/]+$/, '') + (p.pcFolder.includes('\\') ? '\\Captures' : '/Captures') };
    else if (p) plan.attach = { place: 'library', folder: [projectNotesFolder(p.path), 'Captures'].filter(Boolean).join('/') };
    else plan.attach = { place: 'library', folder: input.attachmentsFor(plan.append!.path) };
  }
  return plan;
}

/** A screenshot's file name: "Screenshot 17 Oct 2026 1405.png". */
export const screenshotName = (now: Date) => `Screenshot ${lineOf(now)} ${pad(now.getHours())}${pad(now.getMinutes())}.png`;

/** A next step's line as today's note or the Inbox writes it ("- [ ] Call Priya — by 23 Oct 2026"), its later lines under it. */
export function taskLine(what: string, due: DueDate | null, rest = ''): string {
  const head = `- [ ] ${what.replace(/\s*\n\s*/g, ' ').trim()}${due ? ` — by ${due.line}` : ''}`;
  const tail = String(rest ?? '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  while (tail.length && !tail[0]) tail.shift();
  while (tail.length && !tail[tail.length - 1]) tail.pop();
  return tail.length ? [head, ...tail.map((l) => (l ? `  ${l}` : '  '))].join('\n') : head;
}

/** A note's lines as today's note writes a capture: "- 14:05 The words", more lines under it, then its embeds. */
export function captureLines(text: string, time: string, embeds: string[]): string[] {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').trim().split('\n');
  const out: string[] = [];
  if (lines[0]) out.push(`- ${time} ${lines[0]}`);
  else out.push(`- ${time}`);
  for (const l of lines.slice(1)) out.push(l.trim() ? `  ${l}` : '');
  for (const e of embeds) out.push(`  ${e}`);
  // Blank lines inside a list item would end it: kept as an indented blank.
  return out.map((l) => (l === '' ? '  ' : l)).map((l) => l.replace(/\s+$/, (s) => (l.trim() ? '' : s)));
}

/**
 * Lines added to a note under its "## Captured" heading (made at the end when it isn't there), after what's already
 * under it, keeping everything else exactly as written.
 */
export function appendUnder(note: string, lines: string[], heading = 'Captured'): string {
  const eol = note.includes('\r\n') ? '\r\n' : '\n';
  const all = note.length ? note.split(/\r?\n/) : [];
  const exact = all.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(l));
  // A capture pile by another of its names ("Inbox", "Notes", "Today" when "Captured" was renamed): the pile the
  // note keeps, not a second one. A named heading stays exact.
  const at = exact >= 0 || heading.toLowerCase() !== 'captured' ? exact : all.findIndex((l) => /^##\s+(inbox|notes|today)\s*$/i.test(l));
  if (at < 0) {
    while (all.length && !all[all.length - 1].trim()) all.pop();
    return [...all, ...(all.length ? [''] : []), `## ${heading}`, '', ...lines, ''].join(eol);
  }
  // The section ends at the next heading of the same or a higher level.
  let end = all.length;
  for (let i = at + 1; i < all.length; i++) {
    if (/^#{1,2}\s/.test(all[i])) {
      end = i;
      break;
    }
  }
  let last = end;
  while (last > at + 1 && !all[last - 1].trim()) last--;
  const head = all.slice(0, last);
  const tail = all.slice(end);
  return [...head, ...(last === at + 1 ? [''] : []), ...lines, '', ...tail].join(eol).replace(new RegExp(`(${eol})+$`), eol);
}

/** A new note's text: its words, then its pictures and files, then the project it belongs to (linked). */
export function noteText(text: string, embeds: string[], projectName: string | null, captured: string): string {
  const props = ['---', `captured: ${captured}`, ...(projectName ? [`project: "[[${projectName.replace(/"/g, '')}]]"`] : []), '---'];
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  return [...props, '', ...(body ? [body, ''] : []), ...(embeds.length ? [...embeds, ''] : [])].join('\n');
}

// ——— The key ——————————————————————————————————————————————————————————————————————————————————————————————————————

export const DEFAULT_CAPTURE_KEY = 'Control+Alt+N';

/**
 * The keys chosen in Settings (as the window writes them: "Mod+Alt+Space", "Ctrl+Shift+K") as Electron's global shortcut
 * writes them ("Control+Alt+N"). Null for keys a Windows-wide shortcut can't be: none, or without Ctrl, Alt or the
 * Windows key (a plain letter everywhere would stop people typing it).
 */
export function acceleratorOf(combo: string): string | null {
  const parts = String(combo ?? '').split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts.pop()!;
  const mods = new Set<string>();
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'mod' || m === 'ctrl' || m === 'control' || m === 'cmdorctrl' || m === 'commandorcontrol') mods.add('Control');
    else if (m === 'alt' || m === 'option') mods.add('Alt');
    else if (m === 'shift') mods.add('Shift');
    else if (m === 'meta' || m === 'super' || m === 'win' || m === 'cmd' || m === 'command') mods.add('Super');
    else return null;
  }
  if (!mods.has('Control') && !mods.has('Alt') && !mods.has('Super')) return null;
  const named: Record<string, string> = { esc: 'Escape', escape: 'Escape', space: 'Space', ' ': 'Space', left: 'Left', right: 'Right', up: 'Up', down: 'Down', enter: 'Enter', return: 'Enter', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', '+': 'Plus' };
  let k = named[key.toLowerCase()] ?? key;
  if (/^f([1-9]|1\d|2[0-4])$/i.test(k)) k = k.toUpperCase();
  else if (k.length === 1) k = k.toUpperCase();
  else if (!Object.values(named).includes(k)) return null;
  if (['Escape', 'Tab', 'Enter', 'Backspace'].includes(k) && mods.size === 1 && mods.has('Alt')) return null;
  return [...['Control', 'Alt', 'Shift', 'Super'].filter((m) => mods.has(m)), k].join('+');
}

/** Keys as people read them: "Ctrl + Alt + N", "Win + Shift + K". */
export function keyWords(accelerator: string): string {
  return String(accelerator ?? '')
    .split('+')
    .filter(Boolean)
    .map((p) => ({ Control: 'Ctrl', Super: 'Win', Plus: '+' })[p] ?? p)
    .join(' + ');
}

// ——— Between the box and the main side ————————————————————————————————————————————————————————————————————————

/** What the box is shown with. */
export interface CaptureContext {
  projects: (CaptureProject & { hasFolder: boolean })[];
  recent: string[];
  windowTitle: string | null;
  noProject: NoProjectPlace;
  toAssets: boolean;
  /** The keys that open it, as people read them ('' when the key isn't held). */
  key: string;
  theme: 'light' | 'dark' | 'system';
  accent: string;
  /** The person's palette, so the box wears the same look as the app (8.7 wave 1). */
  palette: string;
  /** "Saturday 17 October", for "Today’s note". */
  dailyName: string;
  now: number;
  platform: string;
  /** Dictation in the box: the microphone chosen ('' the PC's default) and whether fillers are taken out. */
  dictateMic: string;
  dictateClean: boolean;
}

/** A capture saved: what the confirmation says, what Open opens, and the id Undo takes back. */
export interface CaptureSaved {
  words: string;
  detail: string;
  open: string | null;
  undo: string;
}

/** A screenshot taken (kept by the main side until saved), or why it couldn't be. */
export type SnipResult = { id: string; name: string; thumb: string; width: number; height: number } | { words: string } | null;

/** How Quick capture's key stands (Settings › Capture). */
export interface CaptureStatus {
  on: boolean;
  key: string;
  words: string;
  state: 'ready' | 'off' | 'taken' | 'taken-here' | 'invalid';
}
