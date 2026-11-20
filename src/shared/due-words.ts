// One date reader for every task surface (5 Nov 2026, the plan "Vault: status in plain
// words"): late, today, tomorrow, weekday with date. Replaces taskDueTag, datePill/dateWords,
// dueDayWords and dueWords as four separate voices (audit item 6), plus Yesterday
// for late by one everywhere (audit item 14: "1 day late" is arithmetic, "Yesterday" is a day).
// One word for late ("late", never "overdue"); no raw ISO anywhere; no weekday alone ("Fri" with
// no date is ambiguous across weeks). Pure: callers pass the offset and the two days and draw
// what comes back. Today's and future words read muted, late reads the attention colour — the
// tone here, the token at the call site (--ns-attention-words for attention, --text-muted calm).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type DueTone = 'attention' | 'muted';

/** A day as people read it with its weekday: "Fri 7 Nov", "Fri 7 Nov 2027" in another year. */
export function weekdayDate(target: Date, today: Date): string {
  const words = `${WEEKDAYS[target.getDay()]} ${target.getDate()} ${MONTHS[target.getMonth()]}`;
  return target.getFullYear() !== today.getFullYear() ? `${words} ${target.getFullYear()}` : words;
}

/**
 * One countdown rule: a day 8 to 30 days out reads with its countdown
 * ("Fri 13 Nov · in 15 days"); nearer days and far days read as the day alone.
 * The same 8-to-30 window the plan readers already used, now with the weekday.
 */
export function countdownDue(dayWords: string, offset: number): string {
  return offset >= 8 && offset <= 30 ? `${dayWords} · in ${offset} days` : dayWords;
}

/**
 * A due day in words from its offset against today. Null (no day): "No date", muted —
 * task rows hide it (an empty when cell), pills that must say something show it.
 * Messages (toasts, aria) pass countdown false for the short form without "· in N days".
 */
export function formatDue(offset: number | null, target: Date, today: Date, opts: { countdown?: boolean } = {}): { words: string; tone: DueTone } {
  if (offset === null) return { words: 'No date', tone: 'muted' };
  if (offset < -1) return { words: `${-offset} days late`, tone: 'attention' };
  if (offset === -1) return { words: 'Yesterday', tone: 'attention' };
  if (offset === 0) return { words: 'Today', tone: 'muted' };
  if (offset === 1) return { words: 'Tomorrow', tone: 'muted' };
  const day = weekdayDate(target, today);
  const words = opts.countdown === false ? day : countdownDue(day, offset);
  return { words, tone: 'muted' };
}

/** "No date" says nothing on a row: whether the words mean a day is missing. */
export function isNoDate(words: string): boolean {
  return words === 'No date';
}
