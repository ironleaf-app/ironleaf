// The packs' day words in one guarded place (8.7 wave 3a; 8.7.1, 31 Oct 2026, pages that "couldn't show": every date
// helper guards odd values, so an odd day never throws a page onto the guard card). An ISO day (or the day part of a
// date-time) reads its words; anything else gives nothing, for the page to show as written.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An ISO day as its parts, when it is a real day; null for anything else. */
function parts(iso: unknown): { y: number; m: number; d: number } | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { y, m: mo, d } : null;
}

const weekday = (p: { y: number; m: number; d: number }): number => new Date(p.y, p.m - 1, p.d).getDay();

/** "Sun" for a day. */
export const weekdayOf = (iso: unknown): string => {
  const p = parts(iso);
  return p ? WEEKDAYS[weekday(p)]! : '';
};
/** "3 Nov" for a day. */
export const shortDay = (iso: unknown): string => {
  const p = parts(iso);
  return p ? `${p.d} ${SHORT_MONTHS[p.m - 1]}` : '';
};
/** "Nov 3" for a day. */
export const monthDay = (iso: unknown): string => {
  const p = parts(iso);
  return p ? `${SHORT_MONTHS[p.m - 1]} ${p.d}` : '';
};
/** "Jun 2027" for a contract's end month. */
export const monthYear = (iso: unknown): string => {
  const p = parts(iso);
  return p ? `${SHORT_MONTHS[p.m - 1]} ${p.y}` : '';
};
/** "Tuesday" for a delivery day. */
export const weekdayLong = (iso: unknown): string => {
  const p = parts(iso);
  return p ? FULL_WEEKDAYS[weekday(p)]! : '';
};
/** "Tue 4 Nov" for a coming day; "21 Oct 2036" for an expiry. */
export const fullShort = (iso: unknown): string => {
  const p = parts(iso);
  return p ? `${WEEKDAYS[weekday(p)]} ${p.d} ${SHORT_MONTHS[p.m - 1]}` : '';
};
/** "27 Oct 2026" for a day. */
export const longDay = (iso: unknown): string => {
  const p = parts(iso);
  return p ? `${p.d} ${SHORT_MONTHS[p.m - 1]} ${p.y}` : '';
};
/** An ISO day n days before today. Nothing when today cannot be read. */
export function daysAgo(today: string, n: number): string {
  const p = parts(today);
  if (!p) return '';
  const d = new Date(p.y, p.m - 1, p.d);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** "Today", "Yesterday", or "Tue 3 Nov" for a past day. */
export function checkedWords(iso: unknown, today: string): string {
  if (typeof iso !== 'string' || !iso) return 'Never checked';
  if (iso.slice(0, 10) === today) return 'Today';
  if (iso.slice(0, 10) === daysAgo(today, 1)) return 'Yesterday';
  const words = fullShort(iso);
  return words || 'Never checked';
}
