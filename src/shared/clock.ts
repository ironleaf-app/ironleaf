// The times people write ("15:00", "3:00 PM", "3pm", "3.00 pm", with or without seconds), read once and the same
// way everywhere (8.7 urgent, 30 Oct 2026, the reviewer: one meeting time blanked the whole Vault). A meeting's time:
// property keeps whatever was written ("3:00 PM" is the app's own meeting files' style as well as many people's), so
// every place that turns one into a moment or into words reads it here: Home's Upcoming card, the Meetings pages, the
// day plan's tags. What cannot be read is null, and shows as written wherever it is shown: never a crash, never
// "Invalid Date", never NaN. Pure: no files, no DOM.

export interface ClockTime {
  /** 0–23. */
  hours: number;
  /** 0–59. */
  minutes: number;
}

/** "15:00", "3:00 PM", "3pm", "3.00 pm", "08:00", with or without seconds → 24-hour hours and minutes. A bare
 *  number ("3") is not a time, and nor is an hour the marker disagrees with ("13:00 PM"): null, to show as written. */
export function readClockTime(raw: unknown): ClockTime | null {
  const s = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
  const m = /^\s*(\d{1,2})(?:[:.](\d{2})(?::(\d{2}))?)?\s*([a-z.]*)\s*$/i.exec(s);
  if (!m) return null;
  const marker = m[4].replace(/[^a-z]/gi, '').toLowerCase();
  if (marker !== '' && marker !== 'a' && marker !== 'am' && marker !== 'p' && marker !== 'pm') return null;
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  if (min > 59 || sec > 59) return null;
  let h = Number(m[1]);
  const ap = marker.charAt(0);
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else {
    if (h > 23 || m[2] === undefined) return null;
  }
  return { hours: h, minutes: min };
}

/** A time in words ("3:00 PM" → "3:00 pm"), as written when it cannot be read, nothing when there is none. */
export function clockWords(raw: unknown): string {
  const s = (typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw)).trim();
  if (!s) return '';
  const t = readClockTime(s);
  if (!t) return s.replace(/\s+/g, ' ');
  return `${t.hours % 12 === 0 ? 12 : t.hours % 12}:${String(t.minutes).padStart(2, '0')} ${t.hours < 12 ? 'am' : 'pm'}`;
}

/** An ISO day with a time as milliseconds (Home's Upcoming: "2026-10-30" with "3:00 PM" is that day at 3 pm).
 *  Null when either half cannot be read: the caller shows the time as written instead of building a Date. */
export function dayTimeMs(dayIso: string, raw: unknown): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dayIso === 'string' ? dayIso.trim() : '');
  if (!d) return null;
  const t = readClockTime(raw);
  if (!t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t.hours, t.minutes);
  return at.getMonth() === Number(d[2]) - 1 && at.getDate() === Number(d[3]) ? at.getTime() : null;
}

/** A time of day in minutes past midnight ("9:30 am" is 570, "14:00" is 840): the one order meetings sort by (Nov 2026
 *  audit: plain string sorts put '9:30 am' after '14:00'). Null when it cannot be read: the caller sorts those last. */
export function timeMinutes(raw: unknown): number | null {
  const t = readClockTime(raw);
  return t ? t.hours * 60 + t.minutes : null;
}
