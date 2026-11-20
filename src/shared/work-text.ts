// Small text readers the work modules share (9.5: one copy each, not one per module): a value as words, a link's
// name, and words safe for a properties line. Pure.
import { calendarDayOf } from './days';

/** A value as words (an array's first, a day as YYYY-MM-DD, else as written), trimmed. */
export const str = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === null || v === undefined ? '' : v instanceof Date ? (calendarDayOf(v) ?? '') : String(v)).trim();

/** A link's name ("[[Vendors/Northwind Builders|Northwind]]", "Vendors/Northwind Builders.md" → "Northwind Builders"); plain words as written. */
export const linkName = (v: unknown): string =>
  str(v)
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .split('#')[0]
    .split('/')
    .pop()!
    .replace(/\.md$/i, '')
    .trim();

/** Words safe on a properties line (quoted when YAML would read them as anything else). */
export const yamlWords = (s: string): string => (s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s) ? JSON.stringify(s) : s);
