// Dates written the way people set them in Settings (daily notes, templates): YYYY-MM-DD, HH:mm and so on.
// Text in [brackets] is kept as written.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const TOKENS: Record<string, (d: Date) => string> = {
  YYYY: (d) => String(d.getFullYear()),
  YY: (d) => String(d.getFullYear()).slice(-2),
  MMMM: (d) => MONTHS[d.getMonth()],
  MMM: (d) => MONTHS[d.getMonth()].slice(0, 3),
  MM: (d) => pad(d.getMonth() + 1),
  M: (d) => String(d.getMonth() + 1),
  DDDD: (d) => pad(dayOfYear(d), 3),
  Do: (d) => ordinal(d.getDate()),
  DD: (d) => pad(d.getDate()),
  D: (d) => String(d.getDate()),
  dddd: (d) => DAYS[d.getDay()],
  ddd: (d) => DAYS[d.getDay()].slice(0, 3),
  ww: (d) => pad(isoWeek(d)),
  w: (d) => String(isoWeek(d)),
  HH: (d) => pad(d.getHours()),
  H: (d) => String(d.getHours()),
  hh: (d) => pad(d.getHours() % 12 || 12),
  h: (d) => String(d.getHours() % 12 || 12),
  mm: (d) => pad(d.getMinutes()),
  m: (d) => String(d.getMinutes()),
  ss: (d) => pad(d.getSeconds()),
  s: (d) => String(d.getSeconds()),
  A: (d) => (d.getHours() < 12 ? 'AM' : 'PM'),
  a: (d) => (d.getHours() < 12 ? 'am' : 'pm'),
  X: (d) => String(Math.floor(d.getTime() / 1000)),
};

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|Do|DD|D|dddd|ddd|ww|w|HH|H|hh|h|mm|m|ss|s|A|a|X/g;

export function formatDate(format: string, d: Date = new Date()): string {
  return format.replace(TOKEN_RE, (token, literal: string | undefined) => (literal !== undefined ? literal : TOKENS[token]?.(d) ?? token));
}

/** What a template can say, filled in when a note is made from it (the Templates page lists these for people). */
export const TEMPLATE_VARIABLES: { name: string; words: string }[] = [
  { name: '{{title}}', words: 'the new note’s name' },
  { name: '{{date}}', words: 'today, as Settings › Editor writes dates' },
  { name: '{{time}}', words: 'the time now' },
  { name: '{{project}}', words: 'the project it was made from (left out when there isn’t one)' },
  { name: '{{date+2w}}', words: 'a date from today: +3d, +2w, +1m, +1y (or − for before)' },
  { name: '{{date:dddd D MMMM}}', words: 'a date written your own way' },
  // Template fields (src/shared/template-fields.ts; 21 Oct 2026, gap G27).
  { name: '{{prompt:Client name}}', words: 'asked for when a note is made from it ({{prompt:Client name|Acme}} fills in Acme to start)' },
  { name: '{{ai:one-line summary}}', words: 'written by the assistant when the note is made, if you say so (never anything run)' },
  { name: '{{cursor}}', words: 'where the cursor goes in the new note' },
];

export interface TemplateVars {
  title: string;
  dateFormat: string;
  timeFormat: string;
  now?: Date;
  /** The project a note is made from (its page, or the Templates page opened from it). */
  project?: string;
}

/** A date moved by "+2w", "-3d", "+1m" or "+1y" (a month on from 31 January is the last day of February). */
export function shiftDate(d: Date, offset: string): Date {
  const m = /^\s*([+-])\s*(\d{1,4})\s*([dwmy])\s*$/i.exec(offset);
  if (!m) return d;
  const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const out = new Date(d.getTime());
  const unit = m[3].toLowerCase();
  if (unit === 'd' || unit === 'w') out.setDate(out.getDate() + n * (unit === 'w' ? 7 : 1));
  else {
    const day = out.getDate();
    out.setDate(1);
    out.setMonth(out.getMonth() + n * (unit === 'y' ? 12 : 1));
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, last));
  }
  return out;
}

/** Fills a template's {{title}}, {{project}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}} and dates from today
 * ({{date+2w}}, {{date-1d:D MMM}}). Anything else in double braces is left as written. */
export function fillTemplate(text: string, vars: TemplateVars): string {
  const now = vars.now ?? new Date();
  return text.replace(/\{\{\s*(title|date|time|project)\s*((?:[+-]\s*\d{1,4}\s*[dwmy])?)\s*(?::([^}]*))?\}\}/gi, (_m, name: string, offset: string, format: string | undefined) => {
    const key = name.toLowerCase();
    if (key === 'title') return vars.title;
    if (key === 'project') return vars.project ?? '';
    const f = format?.trim() || (key === 'date' ? vars.dateFormat : vars.timeFormat);
    return formatDate(f, offset ? shiftDate(now, offset) : now);
  });
}
