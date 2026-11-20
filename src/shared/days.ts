// Days as people write them in notes and project files ("Friday", "by the 24th", "24 Oct", "2026-10-24", "end of the
// week", "next Tuesday"), read against the day they were written (a meeting's date), and days written back the way
// project files keep them ("24 Oct", with the year only when it isn't this one). Shared by the meeting actions
// (src/shared/meetings.ts) and the weekly review (src/shared/weekly-review.ts); no library, no time zones (local days).

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;

/** The start of a day (local midnight). */
export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const addDays = (d: Date, n: number): Date => {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Whole days from a to b (b later: positive). */
export const daysBetween = (a: Date, b: Date): number => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);

/** A span in plain words: "9 days", "6 weeks", "3 months", "2 years" (10.0 v2locked: quiet people, the brief). */
export function spanWords(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) {
    const w = Math.max(2, Math.round(days / 7));
    return `${w} weeks`;
  }
  if (days < 365) {
    const m = Math.max(2, Math.round(days / 30));
    return `${m} months`;
  }
  const y = Math.max(1, Math.round(days / 365));
  return `${y} year${y === 1 ? '' : 's'}`;
}

/** 2026-10-24 */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether a note's filename is day-shaped (a daily note by another app's shape): a calendar day in its name, ISO
 *  (`2024-03-12`) or unpadded (`2024-3-2 thoughts`). The moving-in census and the daily-folder hint count these
 *  (5 Nov 2026, u3 moving-in); validated, so `2024-13-99` never counts. */
export function isDayShaped(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(name);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** Fewer day-shaped notes than this in a folder is no habit — the daily hint stays silent. */
export const DAILY_HINT_MIN = 10;

/** Where the days live when they don't live in the day-notes folder (5 Nov 2026, u3 moving-in): the fullest other
 *  folder, when the day-notes folder holds no habit and the other holds one. One suggestion, never auto-switching. */
export function dailyFolderHint(shaped: readonly { folder: string; count: number }[], current: string): { folder: string; count: number } | null {
  const here = (current || 'Daily').trim().toLowerCase();
  const mine = shaped.find((s) => s.folder.toLowerCase() === here)?.count ?? 0;
  if (mine >= DAILY_HINT_MIN) return null;
  const best = shaped.filter((s) => s.folder.toLowerCase() !== here && s.folder !== '(no folder)').sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder))[0];
  return best && best.count >= DAILY_HINT_MIN ? { folder: best.folder, count: best.count } : null;
}

/** Day-shaped notes by their top folder, most first: where another app's dailies live. */
export function dayShapedByFolder(paths: readonly string[]): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (!isDayShaped(p)) continue;
    const folder = p.includes('/') ? p.slice(0, p.indexOf('/')) : '(no folder)';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
}

/** An ISO day moved by whole days ("2026-11-02" back one is "2026-11-01"): the daily note's Yesterday and
 *  Tomorrow, from any day, never only from today. '' when it reads as no day. */
export function offsetIsoDay(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return '';
  return isoDay(addDays(d, days));
}

/**
 * A front-matter date value as its calendar day (YYYY-MM-DD), never shifted by the PC's time zone
 * (Polish round 4, 29 Oct 2026): a YAML date is midnight UTC, so its UTC day is the day written, on a
 * Melbourne PC and every other. A string keeps its written day; anything else gives nothing.
 */
export function calendarDayOf(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!m) return undefined;
    // A day that is not there ("2026-13-45", "2026-02-30") is no day, never passed on.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? m[0] : undefined;
  }
  return undefined;
}

/** "24 Oct" (this year, as `ref` sees it), else "24 Oct 2027": how a project file's lines keep a day. */
export function dayWords(d: Date, ref: Date = new Date()): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== ref.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** "Fri 24 Oct": a day to show. */
export function dayLabel(d: Date, ref: Date = new Date()): string {
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${dayWords(d, ref)}`;
}

const monthOf = (word: string): number => {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m.toLowerCase() === w.slice(0, 3) && ('january february march april may june july august september october november december'.split(' ')[MONTHS.indexOf(m)].startsWith(w) || w === 'sept'));
};
const weekdayOf = (word: string): number => {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => d.toLowerCase().startsWith(w) || (w === 'tues' && d === 'Tuesday') || (w === 'thur' && d === 'Thursday') || (w === 'thurs' && d === 'Thursday'));
};

/** A day and month with no year: the one nearest `ref` (a meeting in December saying "by 10 Jan" means next year). */
function nearestYear(month: number, date: number, ref: Date): Date {
  const candidates = [ref.getFullYear() - 1, ref.getFullYear(), ref.getFullYear() + 1].map((y) => new Date(y, month, date));
  return candidates.sort((a, b) => Math.abs(a.getTime() - ref.getTime()) - Math.abs(b.getTime() - ref.getTime()))[0];
}
const valid = (d: Date, month: number, date: number) => d.getMonth() === month && d.getDate() === date;

/** The Friday of the week `d` is in (Saturday and Sunday look ahead to the coming Friday). */
export function fridayOf(d: Date): Date {
  const day = startOfDay(d).getDay();
  return addDays(d, day === 6 ? 6 : 5 - day);
}

/**
 * A day as written ("Friday", "next Tuesday", "tomorrow", "end of week", "EOM", "24 Oct", "October 24", "24/10",
 * "2026-10-24", "the 24th", "in 2 weeks"), read from `ref` (the day it was written). Null when it isn't a day.
 * A weekday is the next one after `ref` ("Friday" said on a Friday is a week later); 24/10 is day then month.
 * A weekday said with a numbered day ("Thursday the 19th", "Fri 23 Oct") is that date — the date with that
 * number on or after `ref` — and null when that date is not that weekday: doubtful words stay words, never a
 * guess at the coming weekday (6 Nov 2026, HOLD 5: "Thursday the 19th" firmed to Thu 12 Nov).
 */
export function readDay(text: string | undefined, ref: Date = new Date()): Date | null {
  if (!text) return null;
  const base = startOfDay(ref);
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(?:by|before|due|on|until|no later than|for)\s+/, '')
    .replace(/[.,;!?)]+$/, '')
    .replace(/^\(/, '')
    .trim();
  if (!t) return null;
  // A weekday said with a numbered day is kept aside and checked against the date it names (below),
  // never read as the coming weekday on its own.
  let stated = -1;
  let rest = t;
  const wm = /^([a-z]{3,9})\.?,?\s+(?:the\s+)?(?=\d)/.exec(t) ?? /^([a-z]{3,9})\.?,?\s+(?=[a-z]{3,9}\.?\s+\d)/.exec(t);
  if (wm && weekdayOf(wm[1]) >= 0) {
    const after = t.slice(wm[0].length);
    if (/^\d/.test(after) || monthOf(after.split(/\s+/)[0]) >= 0) {
      stated = weekdayOf(wm[1]);
      rest = after;
    }
  }
  const checked = (d: Date | null): Date | null => (d && (stated < 0 || d.getDay() === stated) ? d : null);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(rest))) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return checked(valid(d, Number(m[2]) - 1, Number(m[3])) ? d : null);
  }
  if (t === 'today' || t === 'tonight' || t === 'eod' || t === 'cob' || /^(the )?end of (the )?day$/.test(t)) return base;
  if (t === 'tomorrow' || t === 'tmrw') return addDays(base, 1);
  if (t === 'eow' || /^(the )?end of (the |this )?week$/.test(t) || t === 'this week') return fridayOf(base);
  if (t === 'next week' || /^(the )?end of next week$/.test(t)) return addDays(fridayOf(base), 7);
  if (t === 'eom' || /^(the )?end of (the |this )?month$/.test(t)) return new Date(base.getFullYear(), base.getMonth() + 1, 0);
  if (t === 'next month' || /^(the )?end of next month$/.test(t)) return new Date(base.getFullYear(), base.getMonth() + 2, 0);
  if ((m = /^in\s+(\d+|a|an|one|two|three|four|five|six)\s+(day|week|fortnight)s?$/.exec(t))) {
    const n = ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 } as Record<string, number>)[m[1]] ?? Number(m[1]);
    return addDays(base, n * (m[2] === 'day' ? 1 : m[2] === 'week' ? 7 : 14));
  }
  if (t === 'a fortnight' || t === 'next fortnight') return addDays(base, 14);
  // "Friday", "this Friday", "Fri": the next one after `ref`. "next Friday": the one in the week after (said on a
  // Monday, the Friday a week and a half away), as people here mostly mean it.
  if ((m = /^(?:(this|next|coming|the coming)\s+)?([a-z]{3,9})$/.exec(t))) {
    const wd = weekdayOf(m[2]);
    if (wd >= 0) {
      const ahead = (wd - base.getDay() + 7) % 7 || 7;
      const sameWeek = base.getDay() !== 0 && (wd === 0 ? 7 : wd) > base.getDay();
      return addDays(base, m[1] === 'next' && sameWeek ? ahead + 7 : ahead);
    }
  }
  // "Fri 24 Oct", "Friday 24 October 2026", "Friday the 13th", "24 Oct", "24th of October", "October 24", "Oct 24th, 2026":
  // the numbered date, with the weekday said beside it (if any) checked against it.
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?$/.exec(rest))) {
    const month = monthOf(m[2]);
    const date = Number(m[1]);
    const d = m[3] ? new Date(Number(m[3]), month, date) : nearestYear(month, date, base);
    if (month >= 0) return checked(valid(d, month, date) ? d : null);
  }
  if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(rest))) {
    const month = monthOf(m[1]);
    const date = Number(m[2]);
    const d = m[3] ? new Date(Number(m[3]), month, date) : nearestYear(month, date, base);
    if (month >= 0) return checked(valid(d, month, date) ? d : null);
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(rest))) {
    const date = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    const d = year ? new Date(year, month, date) : nearestYear(month, date, base);
    return checked(valid(d, month, date) ? d : null);
  }
  // "the 24th", "Friday the 13th": the first date with that number on or after `ref` (a month with
  // no such day is passed over), and that date only when it is the weekday said.
  if ((m = /^(?:the\s+)?(\d{1,2})(st|nd|rd|th)$/.exec(rest))) {
    const date = Number(m[1]);
    for (let k = 0; k < 3; k++) {
      const d = new Date(base.getFullYear(), base.getMonth() + k, date);
      if (d.getDate() === date && d.getTime() >= base.getTime()) return checked(d);
    }
    return null;
  }
  return null;
}

/** A part of a day right after a day phrase ("Thursday morning", "opening morning"): it continues the
 *  when-phrase, so the day before it is never read on its own (6 Nov 2026, e2: "by Thursday morning"
 *  was read as the coming Thursday with "morning" left over). */
export const PART_OF_DAY_RE = /^\s+(morning|afternoon|evening|night|midday|lunchtime)\b/i;

/**
 * Whether day-words stay words, never a date (6 Nov 2026, a minutes run firmed Mia's "by Friday", said on a
 * Friday, to next Friday, and "on opening morning" to the 27th): the words name no day ("opening morning"),
 * name a span rather than a day ("next week", "end of month"), or are a bare weekday on `ref`'s own weekday
 * (said Friday, "Friday" is today or next Friday — nobody knows, so the words stay). Exact days ("Monday the
 * 9th", "today", "this Friday", "in 3 days") are not loose: they resolve through readDay like always. A weekday
 * with a numbered day it does not fall on ("Monday the 19th" for a Thursday 19th) reads as no day in readDay,
 * so it stays words here too.
 */
export function looseDayWords(words: string | undefined, ref: Date = new Date()): boolean {
  if (!words || !words.trim()) return true;
  if (!readDay(words, ref)) return true;
  const t = words.trim().toLowerCase().replace(/^(?:by|before|due|on|until|no later than|for)\s+/, '').replace(/[.,;!?)]+$/, '').replace(/^\(/, '').trim();
  if (/^(eow|eom|this week|next week|this month|next month)$/.test(t)) return true;
  if (/^(the )?end of (the |this |next )?(week|month)$/.test(t)) return true;
  const m = /^(?:(this|next|coming|the coming)\s+)?([a-z]{3,9})$/.exec(t);
  if (m && !m[1] && weekdayOf(m[2]) === startOfDay(ref).getDay()) return true;
  return false;
}

/** The words of a day phrase inside a line ("… by Friday", "… due 24 Oct", "(Fri)", "… next week"), for taking out. */
const WEEKDAY_WORD = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday|sday)?';
const MONTH_WORD = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
// A weekday with its numbered day, whole ("Thursday the 19th", "Thu 19th", "Thursday the 19th of
// November"): before the bare weekday below, so the weekday alone is never taken with the numbered
// day left dangling after it (6 Nov 2026, HOLD 5).
const WEEKDAY_ORDINAL = `${WEEKDAY_WORD},?\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)(?:\\s+(?:of\\s+)?${MONTH_WORD}(?:,?\\s+\\d{4})?)?`;
const DAY_EXPRS = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  `(?:${WEEKDAY_WORD},?\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_WORD}(?:,?\\s+\\d{4})?`,
  `(?:${WEEKDAY_WORD},?\\s+)?${MONTH_WORD}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
  '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?',
  WEEKDAY_ORDINAL,
  `(?:this\\s+|next\\s+|the\\s+coming\\s+|coming\\s+)?${WEEKDAY_WORD}`,
  'today|tonight|tomorrow|tmrw|eod|cob|eow|eom',
  '(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+|next\\s+)?(?:day|week|month)',
  'next\\s+(?:week|month|fortnight)|this\\s+week|a\\s+fortnight',
  'in\\s+(?:\\d+|a|an|one|two|three|four|five|six)\\s+(?:days?|weeks?|fortnights?)',
  `(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)(?:\\s+(?:of\\s+)?${MONTH_WORD}(?:,?\\s+\\d{4})?)?`,
];
const DAY_EXPR = DAY_EXPRS.join('|');
/** Standing alone at the end of a line, a bare "24th" isn't taken as a day (it may be a count). */
const BARE_EXPR = DAY_EXPRS.slice(0, -1).join('|');
/** With its lead word (by, due…), or in brackets, or standing alone at the end of a line. */
export const DAY_PHRASE = new RegExp(`(?:,\\s*|\\s+|^)(?:\\(\\s*(?:(?:by|due|before|on)\\s+)?(${DAY_EXPR})\\s*\\)|(?:by|before|due(?:\\s+on|\\s+by)?|no\\s+later\\s+than|until|on)\\s+(${DAY_EXPR})|(${BARE_EXPR})(?=\\s*[.!]?\\s*$))(?![\\w/'’-])`, 'i');
