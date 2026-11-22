// A branded document from any note (5 Nov 2026, after a hand-made PDF of a meeting). One pure function from a note's
// words and front matter, plus the person's brand kit, to one finished HTML document: page one has the accent band
// with the logo, the title, a subtitle from what the note knows, a band of key figures when it has them, who came and
// who didn't for a meeting, then the sections in order; later pages have the slim band; every page has its footer and
// a true page number. Export to PDF, Save as PDF and Email it all print this document (in a hidden, sandboxed window,
// the way src/main/edition-print.ts prints an edition), so everyone gets it without learning anything. Pure: it makes
// words (HTML); nothing here touches files or the network, and it takes no model. The caller says where each vault
// file is (`url`) and what a link target names (`resolve`). Nothing about any business is hard coded: the accent is
// the kit's heading colour (read from the colour's use, else its first colour), words on the band take whichever of
// white or near-black reads, and the logo falls back to the business's name set in type. With no kit at all the band
// is near-black and carries no brand, never Ironleaf's name or logo. Private paths stay out (as brandHead in share.ts
// does with isPrivatePath), and so do secrets, front matter, editor marks, hidden words and the transcript section;
// folded callouts print expanded (print cannot be clicked open). Remote pictures read as words (never a fetch at
// print) and files as words (never a file address in the bytes). The person's own words are never changed: the note on
// disk is untouched.

import { AUDIO_EXT, cleanHex, fromHex, inkOn, type BrandKit } from './assets';
import { readProps } from './frontmatter';
import { displayTitle, linkBaseName, linkWords } from './markdown';
import { isPrivatePath } from './private';
import { ACTION_HEADING, DECISION_HEADING, dedupePeople, FILED_MARK, findActions, isMeetingNote, notePeople, readAction, type MeetingAction } from './meetings';
import { isProjectProps } from './project-file';
import { parseReminderLine } from './reminders';
import { readLevel } from './sensitivity';
import { okVaultRel, shareBody } from './share';
import { looseDayWords, MONTHS, readDay, WEEKDAYS } from './days';

// ── Words made safe for the page ─────────────────────────────────────────────────────────────────────────────────────

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** White and near-black: the two inks words on the band may take. */
export const BAND_LIGHT = '#ffffff';
export const BAND_DARK = '#101820';
/** The ink, greys and tints: neutral, fixed, working with any accent. */
const INK = '#101820';
const GREY = '#5A6067';
const HAIR = '#D6D9DC';
const TINT = '#F4F5F6';

const lum = (hex: string): number => {
  const [r, g, b] = fromHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Two colours' contrast, 1 to 21: white on the accent, a logo's colour against the band. */
export function contrastOf(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The kit's accent: its heading colour (read from the colour's use), otherwise its first colour, else none. */
export function accentOf(kit: BrandKit | null | undefined): string | null {
  const colours = kit?.colours ?? [];
  const head = colours.find((c) => /head/i.test(c.use ?? '')) ?? colours[0];
  return (head && cleanHex(head.hex)) || null;
}

/** Words on this band take whichever of white or near-black reads better. */
export function inkFor(band: string): string {
  return contrastOf(BAND_LIGHT, band) >= contrastOf(BAND_DARK, band) ? BAND_LIGHT : BAND_DARK;
}

export interface LogoPick {
  /** The logo's library path (the caller turns it into an address). */
  rel: string;
  role: 'primary' | 'onDark';
}

export interface LogoChoiceInput {
  kit: BrandKit | null | undefined;
  /** The band it must read on. */
  band: string;
  url(rel: string): string;
  /** Each logo's measured colours, most used first (the asset list's palette): the substitute is only used when its
   *  main colour stays visible on the band. Without a measurement there is no substitute. */
  palette?: Partial<Record<'primary' | 'onDark', string[]>>;
}

/**
 * The logo for the band: onDark on a dark accent, primary on a light one. When the right one is missing the other is
 * used only when it stays visible on the band (its main colour's contrast against the band is at least 2 to 1);
 * otherwise no logo, and the caller sets the business's name in type. Private paths never print.
 */
export function logoFor(o: LogoChoiceInput): LogoPick | null {
  const band = cleanHex(o.band) ?? BAND_DARK;
  const want = inkOn(band) === 'light' ? 'onDark' : 'primary';
  const other = want === 'onDark' ? 'primary' : 'onDark';
  const usable = (role: 'primary' | 'onDark'): string | null => {
    const rel = o.kit?.logos?.[role] ?? '';
    if (!rel || isPrivatePath(rel) || !okVaultRel(rel) || !o.url(rel)) return null;
    return rel;
  };
  const first = usable(want);
  if (first) return { rel: first, role: want };
  const sub = usable(other);
  if (!sub) return null;
  const main = cleanHex(o.palette?.[other]?.[0]);
  if (!main || contrastOf(main, band) < 2) return null;
  return { rel: sub, role: other };
}

// ── What the note knows ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DocFacts {
  props: Record<string, unknown>;
  meeting: boolean;
  project: boolean;
  /** The small label on the band: Meeting minutes, a Project brief, the note's own type, else a Note. */
  label: string;
  /** The person has said this is confidential (its properties say so, or its level isn't Open). */
  confidential: boolean;
  /** The footer's middle and the band's second line (the kit's footer when it has one). */
  foot: string;
  bandLine2: string;
  /** The subtitle's two lines (the project, then the day, time and length). */
  sub: string[];
  /** The slim band's words on later pages (the document's name, with its day when known). */
  slim: string;
  figures: { value: string; label: string }[];
  present: string[];
  absent: string[];
  also: string[];
  actions: { what: string; who: string; due: string }[];
  /** The meeting's day (for reading "by Friday"), and today (for showing the year only past this year). */
  day: Date | null;
  now: Date;
}

const asStrings = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,;]\s*/) : [];
  return list.map((x) => String(x ?? '').trim()).filter((x) => x && x.length < 200);
};

/** A [[link]] or path as plain words: the shared cleaner, then the name without its folders or .md. */
const plainTarget = (s: string): string => linkBaseName(linkWords(s));

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const cleanType = (v: unknown): string => {
  const t = String(v ?? '').trim().replace(/^\[\[|\]\]$/g, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= 24 ? t : '';
};

const truthyProp = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0) || /^(yes|true|y)$/i.test(String(v ?? '').trim());

/** The subtitle's project: the first named project that isn't private (its alias dropped, folders and .md off). */
function firstOpenProject(raw: unknown, resolve?: (target: string) => string): string {
  const list = Array.isArray(raw) ? raw : [raw];
  for (const item of list) {
    const target = String(item ?? '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    if (!target) continue;
    if (isPrivatePath(target)) continue;
    try {
      if (resolve && isPrivatePath(resolve(target))) continue;
    } catch {
      // Unresolvable: the written target already passed.
    }
    const name = plainTarget(target);
    if (name) return name;
  }
  return '';
}

/** The meeting's day from its properties or its file's name (null when the note says no day). */
function noteDay(path: string, props: Record<string, unknown>, now: Date): Date | null {
  for (const key of ['date', 'when', 'day']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim()) {
      const d = readDay(v.slice(0, 40), now);
      if (d) return d;
    }
  }
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(path.split('/').pop() ?? '');
  if (iso) return readDay(iso[1], now);
  return null;
}

/** A leading filing date out of the name ("2026-11-05 Weekly sync" reads "Weekly sync"): the app's filing, never the
 *  title (5 Nov 2026, p4-brand-doc-faults). Validated, so "2026-13-99 X" keeps its words; a bare date keeps them too. */
export function stripDatePrefix(title: string): string {
  const t = String(title ?? '').trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[\s_\-]+(.+)$/.exec(t);
  if (!m) return t;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return t;
  return m[4].trim() || t;
}

const longDay = (d: Date): string => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const shortDay = (d: Date): string => `${d.getDate()} ${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const shortText = (v: unknown, max = 24): string => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : '';
};

/** Key figures from the properties (`figures:`): {value, label} entries or "value — label" words, at most six. */
export function figuresFromProps(props: Record<string, unknown>): { value: string; label: string }[] {
  const raw = props.figures ?? props.key_figures ?? props.keyfigures;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out: { value: string; label: string }[] = [];
  for (const item of list.slice(0, 6)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const value = String(o.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const label = String(o.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (value && label) out.push({ value, label });
      continue;
    }
    const fig = splitFigure(String(item ?? ''));
    if (fig) out.push(fig);
  }
  return out;
}

/** "20 Mar — Fit-out finishes" or "20 Mar: Fit-out finishes" read as a figure. */
function splitFigure(s: string): { value: string; label: string } | null {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s+[—–]\s+|\s+--\s+/);
  const pair = parts.length >= 2 ? [parts[0], parts.slice(1).join(' — ')] : t.includes(':') ? [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)] : null;
  if (!pair) return null;
  const value = pair[0].trim().slice(0, 60);
  const label = pair[1].trim().slice(0, 80);
  return value && label ? { value, label } : null;
}

/** A clock time as the table shows it: "2 pm", or "2:30 pm" when it isn't on the hour. */
function shortTime(due: number): string {
  const d = new Date(due);
  const h = d.getHours();
  return `${h % 12 || 12}${d.getMinutes() ? `:${String(d.getMinutes()).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** A due day one way (5 Nov 2026, p4-brand-doc-faults): "Fri 6 Nov", the time when there is one, the year only past
 *  this year ("Sat 6 Nov 2027"). */
function dueWords(d: Date, time: string | null, now: Date): string {
  const date = `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return time ? `${date}${year}, ${time}` : `${date}${year}`;
}

/** A written time as the table shows it ("1 pm", "1:30 pm"), else null. */
function writtenTime(part: string): string | null {
  const m12 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(part);
  if (m12) {
    const h = Number(m12[1]);
    const min = Number(m12[2] ?? 0);
    if (h >= 1 && h <= 12 && min >= 0 && min < 60) return `${h}${min ? `:${String(min).padStart(2, '0')}` : ''} ${m12[3].toLowerCase()}`;
    return null;
  }
  const m24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(part);
  if (m24) {
    const h = Number(m24[1]);
    return `${h % 12 || 12}${Number(m24[2]) ? `:${m24[2]}` : ''} ${h < 12 ? 'am' : 'pm'}`;
  }
  return null;
}

/** A written due read one way: a day as "Fri 6 Nov" (the year past this year, the time when there is one), read from
 *  the meeting's day; words that are no day ("before opening") read as written. */
function formatWrittenDue(part: string, ref: Date, now: Date): string {
  const words = linkWords(part);
  const time = writtenTime(words);
  const datePart = time ? words.replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i, '').replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/, '').replace(/,\s*$/, '').trim() : words;
  // Loose words stay words against the meeting's day (6 Nov 2026, "by Friday" said on a Friday printed as
  // "Fri 13 Nov"): no invented date in a sent document.
  if (looseDayWords(datePart, ref)) return cap1(words.trim());
  const d = readDay(datePart, ref);
  if (!d) return cap1(words.trim());
  return dueWords(d, time, now);
}

/** A link or mark as plain words ("[[Sam Okafor|Sam]]" reads "Sam"): links through the shared cleaner. */
const ownerWords = (s: string) =>
  linkWords(s)
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/@(?=[\p{L}])/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A "what — who · by when" line's tails after its what ("Jo", "by Friday"). A comma tail (", by
 *  opening morning", as the notes step writes an unowned due since 6 Nov 2026, e2) reads the same. */
function dashTails(line: string): string[] {
  const parts = line.split(/\s+[—–]\s+|\s+--\s+/).map((p) => p.trim());
  if (parts.length < 2) {
    const comma = /,\s+((?:by|due|before|on)\s+.+?)\s*$/i.exec(line);
    return comma ? [comma[1].trim()] : [];
  }
  return parts
    .slice(1)
    .flatMap((p) => p.split(/\s+·\s+/))
    .flatMap((p) => p.split(/,\s*(?=(?:by|due|before|on)\s+)/i))
    .map((p) => p.trim())
    .filter(Boolean);
}

const cap1 = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** , never reworded), else ''. */
function ownerAsWritten(line: string): string {
  for (const t of dashTails(line)) {
    if (/^(who|when|by when|owner)$/i.test(t)) continue;
    if (/^(by|due|before|on)\s+/i.test(t)) continue;
    if (readDay(linkWords(t))) continue;
    const o = ownerWords(t);
    if (o && o.split(/\s+/).length <= 5) return o;
  }
  return '';
}

/** The due tail read one way: "by Wed 4 Mar" reads "Wed 4 Mar" (the year past this year, the time when there is
 *  one), while "before opening" and "after the trial" read whole (their first word is the meaning). The tail itself
 *  comes back too, so it leaves the what. */
function dueAsWritten(line: string, owner: string, ref: Date, now: Date): { due: string; tail: string } {
  for (const t of dashTails(line)) {
    if (t === owner) continue;
    if (/^(who|when|by when|owner)$/i.test(t)) continue;
    const by = /^(by|due|on)\s+(.+)$/i.exec(t);
    if (by) return { due: formatWrittenDue(by[2].trim(), ref, now), tail: t };
    if (/^(before|after)\s+/i.test(t)) return { due: cap1(linkWords(t)), tail: t };
    if (readDay(linkWords(t), ref)) return { due: formatWrittenDue(linkWords(t), ref, now), tail: t };
  }
  return { due: '', tail: '' };
}

/** An action line's owner and due as the table shows them: the reminder form or the written form, both read one way
 *  ("Fri 6 Nov", the time when there is one, the year only past this year). */
function actionCells(a: MeetingAction, ref: Date, now: Date): { what: string; who: string; due: string } {
  const rem = parseReminderLine(a.raw);
  if (rem) {
    const read = readAction(rem.text);
    const d = new Date(rem.due);
    const due = dueWords(d, rem.timeGiven ? shortTime(rem.due) : null, now);
    return { what: read?.what ?? rem.text, who: ownerAsWritten(rem.text) || read?.who || '', due };
  }
  const words = a.raw
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(FILED_MARK, '')
    .trim();
  const writtenOwner = ownerAsWritten(words);
  const who = writtenOwner || a.who || '';
  const tail = dueAsWritten(words, writtenOwner, ref, now);
  // Tails the reader left in the what (an owner it didn't recognise, a due it didn't read) leave it now.
  let what = a.what;
  for (const t of [tail.tail, writtenOwner]) {
    if (!t) continue;
    for (const dash of [' — ', ' – ', ' -- ']) {
      if (what.endsWith(`${dash}${t}`)) {
        what = what.slice(0, -`${dash}${t}`.length);
        break;
      }
    }
  }
  if (tail.due) return { what, who, due: tail.due };
  if (a.due) {
    // A due the reader firmed from loose words prints as the words said (6 Nov 2026, "by Friday" said on a
    // Friday): the meeting's day judges.
    if (looseDayWords(a.whenWords, ref)) return { what, who, due: cap1((a.whenWords ?? '').trim()) };
    const d = readDay(a.due, now);
    if (d) return { what, who, due: dueWords(d, null, now) };
  }
  if (a.whenWords) {
    const d = readDay(a.whenWords, ref);
    if (d) return { what, who, due: formatWrittenDue(a.whenWords, ref, now) };
  }
  return { what, who, due: a.whenWords || '' };
}

// ── The note's words as blocks ───────────────────────────────────────────────────────────────────────────────────────

export interface ParseOpts {
  resolve?(target: string): string;
  url(rel: string): string;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const EXTERNAL = /^(https?:|mailto:)/i;
const LIST_RE = /^(\s*)(?:([-*\u2022])|(\d+)[.)])\s+(.*)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^(\s*)(```|~~~)/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/;
const FIGURE_HEADING = /^key[\s-]*(figures?|dates?|numbers?|facts?)$/i;
const TRANSCRIPT_HEADING = /^transcript$/i;
/** The template's empty tick box and its example action line: our own hint text, never printed. */
const EMPTY_BOX = /^\s*[-*+]\s+\[ \]\s*$/;
const PLACEHOLDER_ACTION = /^what needs doing\s*[—–-]+\s*who\s*[—–-]+\s*by when$/i;
/** Our own reminder mark left in prose (an action's became its Due): never printed raw. */
const MARK_LEFT = /⏰\uFE0F?\s*\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?/g;

/** A [[link]]'s target without its #heading or |alias. */
const wikiTarget = (inner: string): { target: string; alias: string } => {
  const pipe = inner.indexOf('|');
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  const rest = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const hash = rest.indexOf('#');
  return { target: (hash >= 0 ? rest.slice(0, hash) : rest).trim(), alias };
};

const baseName = (target: string): string => safeDecode(target).replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop()!.replace(/\.md$/i, '').replace(/_/g, ' ').trim() || 'Note';

/** One line's own marks: pictures, links (web links kept, files linked, notes as words), bold, italics, code. */
function inline(s: string, o: ParseOpts): string {
  const codes: string[] = [];
  let t = esc(s).replace(/%%[^%\n]*%%/g, '').replace(MARK_LEFT, '');
  t = t.replace(/`([^`\n]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  const img = (alt: string, target: string): string => {
    const clean = safeDecode(target).replace(/^<|>$/g, '').trim();
    if (!clean || /^secret:/i.test(clean)) return '';
    if (/^data:image\//i.test(clean)) return `<img src="${esc(clean)}" alt="${esc(alt)}" loading="eager">`;
    // A remote picture fetches (and tells its host the document was opened) at print: its words, never the fetch.
    if (EXTERNAL.test(clean) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) return esc(alt);
    // A note or a document reads as words, never a broken picture.
    if (!/\.[a-z0-9]{1,8}$/i.test(clean) || !IMG_EXT.test(clean)) return esc(alt || baseName(clean));
    const rel = (o.resolve ?? ((x: string) => x))(clean);
    if (isPrivatePath(rel) || !okVaultRel(rel)) return '';
    const u = o.url(rel);
    return u ? `<img src="${esc(u)}" alt="${esc(alt)}" loading="eager">` : '';
  };
  t = t.replace(/!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, alt: string, href: string) => img(alt, href));
  t = t.replace(/!\[\[([^\[\]\n]+?)\]\]/g, (_all: string, inner: string) => {
    const { target, alias } = wikiTarget(inner);
    // A file's address would name this PC in the bytes: files read as words, never links.
    if (!IMG_EXT.test(target) && /\.[a-z0-9]{1,8}$/i.test(target)) return esc(alias || baseName(target));
    return img(alias || baseName(target), target);
  });
  t = t.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_all: string, inner: string) => {
    const { target, alias } = wikiTarget(inner);
    if (alias) return esc(alias);
    if (target && !okVaultRel(safeDecode(target))) return '';
    return esc(linkWords(`[[${inner}]]`));
  });
  t = t.replace(/\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_all: string, label: string, href: string) => {
    const clean = safeDecode(href.replace(/^<|>$/g, '').trim());
    if (EXTERNAL.test(clean)) return `<a href="${esc(clean)}">${label || esc(clean)}</a>`;
    if (label) return label;
    return okVaultRel(clean) ? esc(baseName(clean)) : '';
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  return t.replace(/\u0000(\d+)\u0000/g, (_all: string, i: string) => codes[Number(i)]);
}

/** A markdown table's rows read (the ruled header when it has one). */
function readTable(lines: string[], i: number, o: ParseOpts): { html: string; next: number } {
  const rows: string[][] = [];
  for (; i < lines.length && TABLE_ROW_RE.test(lines[i]!); i++)
    rows.push(
      lines[i]!.trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim()),
    );
  const ruled = rows.length > 1 && rows[1]!.every((c) => /^:?-{2,}:?$/.test(c));
  const head = ruled ? rows[0]! : null;
  const rest = rows.slice(ruled ? 2 : 0).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  const cols = Math.max(head?.length ?? 0, ...rest.map((r) => r.length));
  const cell = (c: string) => inline(c, o);
  const wide = cols >= 5 ? ` wt-${Math.min(cols, 12)}` : '';
  return {
    html: `<table class="blk${wide}"><colgroup>${Array.from({ length: cols }, () => '<col>').join('')}</colgroup>${head ? `<thead><tr>${head.map((c) => `<th dir="auto">${cell(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rest.map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td dir="auto">${cell(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    next: i - 1,
  };
}

interface ListItem {
  ordered: boolean;
  indent: number;
  html: string;
  kids: ListItem[];
}

/** Bullets as a tree (nested ones stay with their parent when the pages split). */
function readList(lines: string[], i: number, o: ParseOpts, skip: Set<number>): { html: string; next: number } {
  const items: ListItem[] = [];
  const stack: ListItem[] = [];
  for (; i < lines.length; i++) {
    const m = LIST_RE.exec(lines[i]!);
    if (!m) break;
    const indent = Math.min(4, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
    const ordered = !!m[3];
    let body = m[4];
    if (skip.has(i)) continue;
    const task = /^(\[[ xX]\])\s+(.*)$/.exec(body);
    const html = task ? `${task[1].toLowerCase() === '[x]' ? '☑' : '☐'} ${inline(task[2], o)}` : inline(body, o);
    const item: ListItem = { ordered, indent, html, kids: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(item);
    else items.push(item);
    stack.push(item);
  }
  const draw = (list: ListItem[]): string => {
    if (!list.length) return '';
    const tag = list[0].ordered ? 'ol' : 'ul';
    return `<${tag}>${list.map((x) => `<li dir="auto">${x.html}${draw(x.kids)}</li>`).join('')}</${tag}>`;
  };
  // One list per run of the same kind at the top, so splitting never mixes bullets and numbers.
  const out: string[] = [];
  let run: ListItem[] = [];
  const flush = () => {
    if (run.length) out.push(draw(run));
    run = [];
  };
  for (const x of items) {
    if (run.length && run[0].ordered !== x.ordered) flush();
    run.push(x);
  }
  flush();
  return { html: out.map((l) => `<div class="blk">${l}</div>`).join(''), next: i - 1 };
}

/** A quote run as the note box, folded or open (12 Nov 2026, t240: print cannot be clicked open, so a folded
 *  callout prints expanded — the minutes' folded Discussion reads in full. Only the transcript section stays out,
 *  dropped whole before blocks are read. */
function readQuote(lines: string[], i: number, o: ParseOpts): { html: string; next: number } | null {
  const raw: string[] = [];
  for (; i < lines.length && /^>\s?/.test(lines[i]!); i++) raw.push(lines[i]!.replace(/^>\s?/, ''));
  const first = raw[0]?.trim() ?? '';
  const callout = CALLOUT_RE.exec(first.replace(/^\\\s*/, ''));
  const title = callout ? callout[3].trim() || callout[1] : '';
  const words = raw
    .slice(callout ? 1 : 0)
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  if (!words.length && !title) return { html: '', next: i - 1 };
  return { html: `<aside class="blk note" dir="auto">${title ? `<p><b>${inline(title, o)}.</b>${words.length ? ` ${inline(words[0], o)}` : ''}</p>` : ''}${(title ? words.slice(1) : words).map((p) => `<p>${inline(p, o)}</p>`).join('')}</aside>`, next: i - 1 };
}

/** A line that is only a picture (or a file's embed) as a figure block, else null. */
function readFigure(line: string, o: ParseOpts): string | null {
  const t = line.trim();
  const md = /^!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)$/.exec(t);
  const wiki = !md ? /^!\[\[([^\[\]\n]+?)\]\]$/.exec(t) : null;
  if (!md && !wiki) return null;
  const target = md ? md[2] : wikiTarget(wiki![1]).target;
  const alt = md ? md[1] : wikiTarget(wiki![1]).alias || baseName(target);
  const clean = safeDecode(target).replace(/^<|>$/g, '').trim();
  if (!clean || /^secret:/i.test(clean)) return '';
  // A data picture fetches nothing, so it prints.
  if (/^data:image\//i.test(clean)) return `<figure class="blk"><img src="${esc(clean)}" alt="${esc(alt)}" loading="eager"></figure>`;
  // Remote, or another scheme: its words, never a fetch at print.
  if (EXTERNAL.test(clean) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) return alt.trim() ? `<p class="blk" dir="auto">${esc(alt)}</p>` : '';
  // A note or a document reads as words: a file's address would name this PC in the bytes.
  if (!/\.[a-z0-9]{1,8}$/i.test(clean) || !IMG_EXT.test(clean)) return `<p class="blk" dir="auto">${esc(alt || baseName(clean))}</p>`;
  const rel = (o.resolve ?? ((x: string) => x))(clean);
  if (isPrivatePath(rel) || !okVaultRel(rel)) return '';
  const src = o.url(rel);
  if (!src) return '';
  return `<figure class="blk"><img src="${esc(src)}" alt="${esc(alt)}" loading="eager"></figure>`;
}

/** A "Not present: Lee Park" / "Also named: Marco" line's names, else null (consumed into the meeting's rows). Only a
 *  line with a colon or bold words counts, so prose that happens to start with "also" is never eaten. */
function metaLine(line: string, re: RegExp): string[] | null {
  if (!line.includes(':') && !line.includes('**')) return null;
  const m = re.exec(line.trim());
  if (!m) return null;
  return m[1].split(/\s*(?:,|;|\band\b|&)\s*/).map((x) => x.trim()).filter((x) => x && x.length < 80);
}

const ABSENT_LINE = /^(?:\*\*)?(?:not present|absent|apologies|missing)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/i;
const ALSO_LINE = /^(?:\*\*)?(?:also named|also|mentioned|named)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/i;
const PRESENT_LINE = /^\s*(?:\*\*)?(?:who came|attendees|present|attending|with)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/i;

/** A meeting's sections print in the reference's order (5 Nov 2026, p4-brand-doc-faults): Summary, Actions, Decisions,
 *  Still open, then anything else as written. */
const STILL_OPEN_HEADING = /still\s+open|open\s+(items|questions|issues|points)|still\s+to\s+(decide|do)|to\s+be\s+decided/i;
function sectionRank(name: string): number {
  if (/summary/i.test(name)) return 0;
  if (ACTION_HEADING.test(name)) return 1;
  if (DECISION_HEADING.test(name)) return 2;
  if (STILL_OPEN_HEADING.test(name)) return 3;
  return 4;
}

/** Names compared as files name them: underscores read as spaces, the filing date out, case and extra spaces away. */
const normName = (s: string): string => stripDatePrefix(String(s ?? '').replace(/_/g, ' ').trim()).toLowerCase().replace(/\s+/g, ' ').trim();

/** A recording file Ironleaf made, named after its meeting ("Recording – Kick-off 2026-10-22 05.02.m4a"). */
const RECORDING_NAME = /^recording\s*[–-]\s*(.+?)\s+\d{4}-\d{1,2}-\d{1,2}\b/i;
const RECORDING_EXT = new RegExp(`^(${AUDIO_EXT.source.slice(1, -1)}|webm)$`, 'i');

/** A paragraph that is only a link (an optional short label and a colon before it) to this note's own printed PDF or
 *  its recording: left out of the print, so the PDF never links to itself (5 Nov 2026, p4-brand-doc-faults). */
function isSelfLinkPara(raw: string, title: string): boolean {
  const t = String(raw ?? '').trim();
  if (!t || t.includes('\n')) return false;
  const own = normName(title);
  if (!own) return false;
  // One link (or embed) and nothing else, an optional "Minutes:" label before it.
  const link = /^(?:[^:\[\]()!\n]{1,40}:\s*)?(!?\[\[[^\[\]\n]+?\]\]|!?\[([^\]\n]*)\]\(\s*(?:<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\))$/.exec(t);
  if (!link) return false;
  const whole = link[1];
  let target = '';
  if (whole.startsWith('!')) {
    const inner = whole.slice(1);
    if (inner.startsWith('[[')) target = wikiTarget(inner.slice(2, -2)).target;
    else target = /\(\s*(?:<([^>\n]+)>|([^)\s]+))/.exec(inner)?.[1] ?? /\(\s*(?:<([^>\n]+)>|([^)\s]+))/.exec(inner)?.[2] ?? '';
  } else if (whole.startsWith('[[')) {
    target = wikiTarget(whole.slice(2, -2)).target;
  } else {
    target = /\(\s*(?:<([^>\n]+)>|([^)\s]+))/.exec(whole)?.[1] ?? /\(\s*(?:<([^>\n]+)>|([^)\s]+))/.exec(whole)?.[2] ?? '';
  }
  target = safeDecode(target).replace(/^<|>$/g, '').trim();
  if (!target || /^(https?:|mailto:|data:|#|secret:)/i.test(target)) return false;
  const base = target.replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop()!.trim();
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : '';
  const stem = (dot >= 0 ? base.slice(0, dot) : base).replace(/_/g, ' ').trim();
  if (/^pdf$/i.test(ext)) return normName(stem) === own;
  if (RECORDING_EXT.test(ext)) {
    if (normName(stem) === own) return true;
    const rec = RECORDING_NAME.exec(stem);
    return !!rec && normName(rec[1]) === own;
  }
  return false;
}

interface ParsedBody {
  /** The sections' blocks in order (the actions table placed in its section, or appended under Actions). */
  blocks: string[];
  /** Key figures read from a Key figures section (null when the properties had them or there is no such section). */
  figures: { value: string; label: string }[] | null;
}

/** A meeting's blocks in the reference's order: the person's own lines at the top as written, then Summary, Actions,
 *  Decisions, Still open, then anything else as written. */
function orderMeetingBlocks(blocks: string[], h2Name: (string | null)[]): string[] {
  const firstH2 = h2Name.findIndex((n) => n !== null);
  if (firstH2 < 0) return blocks;
  const pre = blocks.slice(0, firstH2);
  const secs: { name: string; rank: number; at: number; parts: string[] }[] = [];
  for (let i = firstH2; i < blocks.length; i++) {
    const name = h2Name[i];
    if (name !== null) secs.push({ name, rank: sectionRank(name), at: secs.length, parts: [blocks[i]] });
    else secs[secs.length - 1].parts.push(blocks[i]);
  }
  secs.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return [...pre, ...secs.flatMap((s) => s.parts)];
}

/** The body as blocks: meetings read for their figures, rows and actions; the transcript section left out. */
function parseBody(body: string, facts: DocFacts, title: string, o: ParseOpts): ParsedBody {
  const lines = body.split('\n');
  // The open tasks, each once (under an Actions heading or boxed anywhere; phrases and mentions stay prose here).
  // Read against the meeting's day, never today: "by Friday" in a Monday meeting is that Friday.
  const ref = facts.day ?? facts.now;
  const found = findActions(body, { date: ref }).filter((a) => a.how === 'actions' || a.how === 'task');
  const actionAt = new Map<number, MeetingAction>();
  for (const a of found) if (!actionAt.has(a.line)) actionAt.set(a.line, a);
  const actionLines = new Set(actionAt.keys());
  facts.actions = found.map((a) => actionCells(a, ref, facts.now));

  // Sections: where each h1/h2 starts and ends (level 1 and 2 alike: a body # is a section, drawn as an h2).
  interface Sec { line: number; level: number; name: string; start: number; end: number }
  const secs: Sec[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (FENCE_RE.test(l)) fence = !fence;
    if (fence) return;
    const h = HEADING_RE.exec(l);
    if (h && h[1].length <= 2) secs.push({ line: i, level: h[1].length, name: h[2].trim(), start: i, end: lines.length });
  });
  secs.forEach((s, k) => {
    s.end = k + 1 < secs.length ? secs[k + 1].start : lines.length;
  });

  // The transcript section and a Key figures section (when the properties didn't already give figures) are consumed.
  let figures: { value: string; label: string }[] | null = null;
  const drop = new Set<number>();
  for (const s of secs) {
    if (TRANSCRIPT_HEADING.test(s.name)) {
      for (let i = s.line; i < s.end; i++) drop.add(i);
    } else if (FIGURE_HEADING.test(s.name) && !facts.figures.length) {
      const figs: { value: string; label: string }[] = [];
      for (let i = s.line + 1; i < s.end; i++) {
        const m = LIST_RE.exec(lines[i]);
        const words = m ? m[4].replace(/^(\[[ xX]\])\s+/, '') : lines[i].trim();
        if (!words || /^(\[[ xX]\])$/.test(words)) continue;
        const fig = splitFigure(words.replace(/\*\*/g, ''));
        if (fig && figs.length < 6) figs.push(fig);
      }
      if (figs.length) {
        figures = figs;
        for (let i = s.line; i < s.end; i++) drop.add(i);
      }
    }
  }
  if (figures) facts.figures = figures;

  // The meeting's "Present/Absent/Also" lines are consumed into its rows (meetings only).
  if (facts.meeting) {
    lines.forEach((l, i) => {
      if (drop.has(i) || FENCE_RE.test(l)) return;
      if (metaLine(l, ABSENT_LINE)) {
        facts.absent.push(...metaLine(l, ABSENT_LINE)!);
        drop.add(i);
      } else if (metaLine(l, ALSO_LINE)) {
        facts.also.push(...metaLine(l, ALSO_LINE)!);
        drop.add(i);
      } else if ((l.includes(':') || l.includes('**')) && PRESENT_LINE.test(l)) {
        drop.add(i);
      }
    });
  }

  const blocks: string[] = [];
  /** Each block's h2 heading as written (for the meeting's order); null when it is no h2. */
  const h2Name: (string | null)[] = [];
  const push = (html: string, h2: string | null = null) => {
    blocks.push(html);
    h2Name.push(h2);
  };
  let para: string[] = [];
  let actionsPlaced = false;
  const flush = () => {
    if (!para.length) return;
    const raw = para.join(' ');
    para = [];
    if (isSelfLinkPara(raw, title)) return;
    const html = inline(raw, o);
    // Nothing left after the marks came out (a line of only %%comment%%): no empty block.
    if (!html.replace(/<[^>]+>/g, '').trim() && !html.includes('<img')) return;
    push(`<p class="blk" dir="auto">${html}</p>`);
  };
  const actionsTable = (): string => {
    if (!facts.actions.length) return '';
    const rows = facts.actions.map((a, k) => `<tr><td class="n" dir="auto">${k + 1}</td><td dir="auto">${esc(a.what)}</td><td class="o" dir="auto">${esc(a.who)}</td><td class="d" dir="auto">${esc(a.due)}</td></tr>`).join('');
    return `<table class="blk actions"><thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  // The page's own first heading (a body that starts with the title doesn't say it twice).
  let seenTitle = false;
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i) || actionLines.has(i)) continue;
    const l = lines[i]!;
    if (!l.trim()) {
      flush();
      continue;
    }
    const fenceM = FENCE_RE.exec(l);
    if (fenceM) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith(fenceM[1] + fenceM[2]); i++) code.push(lines[i]!);
      push(`<pre class="blk"><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = HEADING_RE.exec(l);
    if (h) {
      flush();
      const name = h[2].trim();
      if (!name) continue;
      if (!seenTitle) {
        seenTitle = true;
        if (stripDatePrefix(name).toLowerCase() === title.trim().toLowerCase()) continue;
      }
      const level = h[1].length;
      if (level <= 2) {
        push(`<h2 class="blk" dir="auto">${inline(name, o)}</h2>`, name);
        if (ACTION_HEADING.test(name)) {
          const table = actionsTable();
          if (table) {
            push(table);
            actionsPlaced = true;
          }
        }
      } else if (level === 3) {
        push(`<h3 class="blk" dir="auto">${inline(name, o)}</h3>`);
      } else {
        push(`<h4 class="blk" dir="auto">${inline(name, o)}</h4>`);
      }
      continue;
    }
    if (TABLE_ROW_RE.test(l)) {
      flush();
      const t = readTable(lines, i, o);
      push(t.html);
      i = t.next;
      continue;
    }
    if (LIST_RE.test(l)) {
      flush();
      const r = readList(lines, i, o, actionLines);
      if (r.html) push(r.html);
      i = r.next;
      continue;
    }
    if (/^>\s?/.test(l)) {
      flush();
      const q = readQuote(lines, i, o);
      if (q && q.html) push(q.html);
      if (q) i = q.next;
      continue;
    }
    if (/^\s{0,3}(---|\*\*\*|___)\s*$/.test(l)) {
      flush();
      push('<hr class="blk">');
      continue;
    }
    const fig = readFigure(l, o);
    if (fig !== null) {
      flush();
      if (fig) push(fig);
      continue;
    }
    if (EMPTY_BOX.test(l) || PLACEHOLDER_ACTION.test(l.trim())) continue;
    // A stray task box the reader couldn't make an action of still reads as a tick box, never raw.
    const stray = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(l);
    if (stray) {
      flush();
      push(`<div class="blk"><ul><li dir="auto">${stray[1].toLowerCase() === 'x' ? '☑' : '☐'} ${inline(stray[2], o)}</li></ul></div>`);
      continue;
    }
    para.push(l.trim());
  }
  flush();
  // Open tasks with no Actions section of their own read under one at the end, so none is lost.
  if (facts.actions.length && !actionsPlaced) {
    push('<h2 class="blk">Actions</h2>', 'Actions');
    push(actionsTable());
  }
  if (facts.meeting) return { blocks: orderMeetingBlocks(blocks, h2Name), figures };
  return { blocks, figures };
}

// ── The document ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BrandDocInput {
  title: string;
  /** The whole note, front matter included. */
  text: string;
  /** Its vault path (for meeting and day detection). */
  path?: string;
  kit?: BrandKit | null;
  /** A vault file's address for the page (file://…), or '' when it can't be shown. */
  url(rel: string): string;
  /** A link's target as written → the vault path it names. */
  resolve?(target: string): string;
  /** Each logo's measured colours, most used first: the substitute logo is only used when it stays visible. */
  logoPalette?: Partial<Record<'primary' | 'onDark', string[]>>;
  /** The vault's own level for the note (open, work, personal, family, health): a level past Open marks Confidential. */
  level?: unknown;
  /** Today (for reading days the note names). */
  now?: Date;
  /** 'print': paginated by its own script in the hidden window. 'preview': page one, static, for the brand kit page. */
  mode?: 'print' | 'preview';
  /** The owner's name: a meeting transcript's mic reads as them, as on every other door (18 Nov 2026, t301 round 2). */
  me?: string;
}

const fontOk = (name: string) => /^[\p{L}\p{N} ._-]{1,80}$/u.test(name);

function gatherFacts(input: BrandDocInput, title: string): DocFacts {
  const props = readProps(input.text) as Record<string, unknown>;
  const now = input.now ?? new Date();
  const path = input.path ?? '';
  const meeting = isMeetingNote(path, props);
  const project = isProjectProps(props);
  const type = cleanType(props.type);
  const label = meeting ? 'Meeting minutes' : project ? 'Project brief' : type && !/^(notes?)$/i.test(type) ? type : 'Note';
  const level = readLevel(props.level ?? props.sensitivity);
  // The vault's own level for the note (a Health folder's note is Health though its properties name no level):
  // the doors that know it pass it in, and it marks the document as the properties do.
  const vaultLevel = readLevel(input.level);
  const confidential = truthyProp(props.confidential) || (level !== null && level !== 'open') || (vaultLevel !== null && vaultLevel !== 'open');
  const kitFooter = input.kit?.footer?.trim() ?? '';
  const foot = kitFooter || (confidential ? 'Confidential, internal use' : '');
  const bandLine2 = confidential ? kitFooter || 'Confidential, internal use' : '';
  const day = noteDay(path, props, now);
  const projectProp = props.project ?? props.projects;
  const projectName = firstOpenProject(projectProp, input.resolve);
  const time = shortText(props.time ?? props.start ?? props.at);
  const lengthProp = props.duration ?? props.length ?? props.minutes;
  const length = typeof lengthProp === 'number' && Number.isFinite(lengthProp) && lengthProp > 0 && lengthProp < 10080 ? `${Math.round(lengthProp)} minutes` : shortText(lengthProp, 32);
  const dayLine = [day ? longDay(day) : '', time, length].filter(Boolean).join(', ');
  const sub = [projectName, dayLine].filter(Boolean);
  const slim = day ? `${title}, ${shortDay(day)}` : title;
  const absent = [...asStrings(props.absent), ...asStrings(props.apologies), ...asStrings(props.apology), ...asStrings(props.not_present), ...asStrings(props.absentees)];
  const also = [...asStrings(props.also), ...asStrings(props.mentioned), ...asStrings(props.also_named)];
  return { props, meeting, project, label, confidential, foot, bandLine2, sub, slim, figures: figuresFromProps(props), present: [], absent, also, actions: [], day, now };
}

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#fff;color:${INK};font-family:var(--sans);font-size:10pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility}
#flow{position:absolute;left:-10000px;top:0;width:178mm;visibility:hidden}
@media print{#flow{display:none}}
#pages{margin:0}
.page{width:210mm;height:297mm;background:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.mast{background:var(--accent);height:38mm;min-height:38mm;padding:0 16mm;display:flex;align-items:center;justify-content:space-between;color:var(--bandink);flex:none}
.mast img{height:22mm;width:auto;max-width:88mm;object-fit:contain}
.mast-name{font-size:17pt;font-weight:700;letter-spacing:-.01em;line-height:1.1;max-width:88mm}
.mast .k{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;text-align:right;line-height:1.5;flex:none;padding-left:6mm}
.slim{background:var(--accent);height:18mm;min-height:18mm;padding:0 16mm;display:flex;align-items:center;justify-content:space-between;color:var(--bandink);font-size:8.6pt;letter-spacing:.1em;text-transform:uppercase;flex:none}
.slim img{height:11mm;width:auto;max-width:60mm;object-fit:contain}
.slim-name{font-size:10pt;font-weight:700;letter-spacing:.02em;text-transform:none;max-width:60mm}
.slim .t{text-align:right;padding-left:6mm}
.pcol{flex:1 1 auto;overflow:hidden;padding:6mm 16mm 0;min-height:0}
.pcol>h2:first-child{margin-top:0}
h1{font-size:23pt;line-height:1.08;margin:0 0 1.5mm;letter-spacing:-.01em;overflow-wrap:break-word}
.sub{color:${GREY};font-size:10.2pt;margin:0 0 4mm}
.sub div{overflow-wrap:break-word}
.band{background:${INK};color:#fff;display:grid;grid-template-columns:repeat(var(--n,4),1fr);margin:0 0 4mm}
.band div{padding:2.8mm 4mm;overflow-wrap:break-word}
.band b{display:block;font-size:14.5pt;line-height:1.1}
.band span{font-size:8pt;color:${HAIR};line-height:1.25;display:block;margin-top:1mm}
.meta{margin:0 0 4mm}
.mrow{display:grid;grid-template-columns:24mm 1fr;gap:.8mm 3mm;font-size:9.4pt;margin:0 0 .8mm}
.mrow dt{color:${GREY};margin:0}
.mrow dd{margin:0;overflow-wrap:break-word}
h2{font-size:12.5pt;margin:4.6mm 0 2mm;padding-bottom:1.2mm;border-bottom:1.6pt solid var(--accent);overflow-wrap:break-word}
h3{font-size:10.2pt;margin:3.4mm 0 .7mm;overflow-wrap:break-word}
h4{font-size:10pt;margin:3mm 0 1mm;overflow-wrap:break-word}
p{margin:0 0 2mm;overflow-wrap:break-word}
ul,ol{margin:0 0 2mm;padding-left:4.5mm}
li{margin:0 0 1.2mm;overflow-wrap:break-word}
li ul,li ol{margin:.8mm 0 0}
table{width:100%;border-collapse:collapse;font-size:9.1pt;margin:0 0 2mm}
table.wt-5,table.wt-6{font-size:8.6pt;table-layout:fixed}
table.wt-7,table.wt-8{font-size:8pt;table-layout:fixed}
table.wt-9,table.wt-10,table.wt-11,table.wt-12{font-size:7.6pt;table-layout:fixed}
th{background:${INK};color:#fff;text-align:left;font-weight:700;padding:1.6mm 2.4mm;overflow-wrap:anywhere}
td{padding:1.6mm 2.4mm;vertical-align:top;border-bottom:.6pt solid ${HAIR};overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:${TINT}}
table.actions td.n{width:12mm;color:${GREY};white-space:nowrap;font-variant-numeric:tabular-nums}
table.actions td.o{width:30mm;font-weight:700}
table.actions td.d{width:36mm}
.note{background:${TINT};border-left:2.4pt solid var(--accent);padding:2.4mm 3mm;font-size:9pt;margin:0 0 2mm}
.note p{margin:0 0 1mm}.note p:last-child{margin:0}
figure{margin:0 0 2mm}
figure img,p img{display:block;max-width:100%;height:auto;max-height:170mm}
p img{display:inline-block;vertical-align:middle}
pre{background:${TINT};padding:2.4mm 3mm;font-size:8.4pt;line-height:1.35;margin:0 0 2mm;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
pre code,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
p code{background:${TINT};padding:0 .8mm;font-size:.92em}
mark{background:#e4e7ea;color:inherit;padding:0 .6mm}
a{color:inherit;text-decoration:underline;text-underline-offset:.12em}
hr{border:0;border-top:.6pt solid ${HAIR};margin:3mm 0}
.foot{flex:none;margin:0 16mm 7mm 16mm;display:flex;justify-content:space-between;gap:4mm;color:${GREY};font-size:7.8pt;border-top:.6pt solid ${HAIR};padding-top:1.6mm}
.foot span{overflow-wrap:break-word;min-width:0}
.foot span:first-child{flex:1 1 auto}
.foot span:nth-child(2){flex:1 1 auto;text-align:center}
.foot span:last-child{flex:none;white-space:nowrap}
`;

// The page's own script: lays the blocks onto A4 pages once the type and pictures are in, and says when it is done.
// Plain browser JavaScript (it runs inside the hidden print window, never in the app's code). Each block goes whole
// onto the page while it fits; a table, list, meeting-rows block or long paragraph that runs over starts where it
// falls and splits at a row, bullet or word (a long table's header repeats), never leaving a large gap for a whole
// block on the next page — only a block that fits in the room left stays whole (5 Nov 2026, p4-brand-doc-faults); a
// split whose shell took nothing leaves no empty shell behind (p5: one hid "Decisions" alone at a page foot from the
// guard); a heading is never left alone at a page foot (moved on with what follows, cascading forward); page numbers
// are filled last, so they are true.
const LAYOUT_JS = `
(function(){
var M=JSON.parse(document.getElementById('nv-meta').textContent);
var flow=document.getElementById('flow'),pagesEl=document.getElementById('pages');
var report={pages:0,moved:0,split:0,cut:[]};
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
function ready(){
  var imgs=Array.prototype.slice.call(document.images).map(function(im){return im.complete?null:new Promise(function(r){im.onload=im.onerror=function(){r();};setTimeout(r,8000);});});
  return Promise.all([document.fonts?document.fonts.ready:null].concat(imgs));
}
function over(c){return c.scrollHeight>c.clientHeight+1;}
function newPage(first){
  var pg=el('div','page');
  pg.insertAdjacentHTML('afterbegin',first?M.mast:M.slim);
  var col=el('div','pcol');pg.appendChild(col);
  var ft=el('div','foot','<span>'+M.footL+'</span><span>'+M.footM+'</span><span class="pg"></span>');
  pg.appendChild(ft);pagesEl.appendChild(pg);
  return {pg:pg,col:col};
}
function describe(n){return (n.tagName||'?').toLowerCase()+':'+((n.textContent||'').trim().slice(0,40));}
function splitParts(node){
  if(node.tagName==='TABLE'){
    var tb=node.querySelector('tbody');
    var rows=tb?Array.prototype.slice.call(tb.rows):[];
    if(!rows.length)return null;
    var head=node.querySelector('thead');
    return {items:rows,shell:function(){var t=node.cloneNode(false);if(head)t.appendChild(head.cloneNode(true));var b=document.createElement('tbody');t.appendChild(b);return{el:t,box:b};}};
  }
  if(node.tagName==='DIV'&&node.children.length===1&&node.firstElementChild&&/^(UL|OL)$/.test(node.firstElementChild.tagName)){
    var ul=node.firstElementChild;
    return {items:Array.prototype.slice.call(ul.children),shell:function(){var d=el('div','blk');var u=document.createElement(ul.tagName);d.appendChild(u);return{el:d,box:u};}};
  }
  if(node.tagName==='DIV'&&node.classList.contains('meta')){
    return {items:Array.prototype.slice.call(node.children),shell:function(){var d=el('div','meta');return{el:d,box:d};}};
  }
  return null;
}
function isText(node){return node&&(node.tagName==='P'||node.tagName==='ASIDE');}
function textNodes(root){
  var out=[];
  var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.data.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
  while(w.nextNode())out.push(w.currentNode);
  return out;
}
function countWords(node){
  var n=0;
  textNodes(node).forEach(function(t){n+=t.data.split(/\\s+/).filter(Boolean).length;});
  return n;
}
function cutWords(node,from,to){
  var c=node.cloneNode(true);
  var idx=0;
  textNodes(c).forEach(function(t){
    var parts=t.data.split(/(\\s+)/);
    for(var i=0;i<parts.length;i++){
      if(!parts[i]||/^\\s*$/.test(parts[i]))continue;
      if(idx<from||idx>=to)parts[i]='';
      idx++;
    }
    t.data=parts.join('');
  });
  Array.prototype.slice.call(c.querySelectorAll('b,i,a,code,mark,s,span')).forEach(function(e){if(!e.textContent.trim())e.remove();});
  return c;
}
function P_now(){return pages[pages.length-1];}
function placeSplit(node,parts){
  var P=P_now();
  var s=parts.shell();P.col.appendChild(s.el);
  parts.items.forEach(function(it){
    s.box.appendChild(it);
    if(!over(P.col))return;
    s.box.removeChild(it);
    if(s.box.children.length===0&&P.col.children.length===1){
      s.box.appendChild(it);report.cut.push('tall:'+describe(it));return;
    }
    if(s.box.children.length===0)P.col.removeChild(s.el);
    P=newPage(false);pages.push(P);report.split++;
    s=parts.shell();P.col.appendChild(s.el);s.box.appendChild(it);
    if(over(P.col)&&P.col.children.length===1){report.cut.push('tall:'+describe(it));}
  });
}
function splitWords(node){
  var P=P_now();
  if(P.col.children.length){
    var one=cutWords(node,0,1);P.col.appendChild(one);var fits=!over(P.col);P.col.removeChild(one);
    if(!fits){P=newPage(false);pages.push(P);}
  }
  var total=countWords(node);
  var lo=1,hi=total;
  while(lo<hi){
    var mid=Math.ceil((lo+hi+1)/2);
    var c=cutWords(node,0,mid);P.col.appendChild(c);var ok=!over(P.col);P.col.removeChild(c);
    if(ok)lo=mid;else hi=mid-1;
  }
  P.col.appendChild(cutWords(node,0,lo));
  if(lo>=total)return;
  var rest=cutWords(node,lo,total);
  P=newPage(false);pages.push(P);
  place(rest);
}
function place(node){
  var P=P_now();
  P.col.appendChild(node);
  if(!over(P.col))return;
  P.col.removeChild(node);
  var parts=splitParts(node);
  if(P.col.children.length===0){
    if(parts){placeSplit(node,parts);return;}
    if(node.tagName==='FIGURE'){
      var img=node.querySelector('img');
      if(img){img.style.maxHeight=Math.max(20,P.col.clientHeight-4)+'px';img.style.width='auto';img.style.maxWidth='100%';}
      P.col.appendChild(node);
      if(over(P.col))report.cut.push(describe(node));
      return;
    }
    if(isText(node)){splitWords(node);return;}
    if(node.children&&node.children.length>1){
      var kids=Array.prototype.slice.call(node.children);
      for(var i=kids.length-1;i>=0;i--)queue.unshift(kids[i]);
      return;
    }
    P.col.appendChild(node);report.cut.push(describe(node));return;
  }
  if(parts){placeSplit(node,parts);return;}
  if(isText(node)){splitWords(node);return;}
  if(node.children&&node.children.length>1){
    var kids2=Array.prototype.slice.call(node.children);
    for(var j=kids2.length-1;j>=0;j--)queue.unshift(kids2[j]);
    return;
  }
  var N=newPage(false);pages.push(N);place(node);
}
var queue=[],pages=[];
ready().then(function(){
  var P=newPage(true);pages.push(P);
  queue=Array.prototype.slice.call(flow.children);
  while(queue.length)place(queue.shift());
  var isHead=function(n){return n&&/^(H1|H2|H3|H4)$/.test(n.tagName);};
  var last=function(col){var k=col.children;return k.length?k[k.length-1]:null;};
  var cascade=function(j){
    var g=0;
    while(g++<500){
      while(j<pages.length&&!over(pages[j].col))j++;
      if(j>=pages.length)return;
      var kids=pages[j].col.children;
      if(kids.length<2)return;
      var tail=kids[kids.length-1];
      pages[j].col.removeChild(tail);
      var nx=pages[j+1];
      if(!nx){nx=newPage(false);pages.push(nx);}
      nx.col.insertBefore(tail,nx.col.firstChild);
      report.moved++;
    }
  };
  var guard=0,changed=true;
  while(changed&&guard++<25){
    changed=false;
    for(var i=0;i<pages.length-1;i++){
      var moves=0;
      while(isHead(last(pages[i].col))&&moves++<50){
        var h=pages[i].col.removeChild(pages[i].col.children[pages[i].col.children.length-1]);
        pages[i+1].col.insertBefore(h,pages[i+1].col.firstChild);
        report.moved++;changed=true;
        cascade(i+1);
      }
    }
  }
  for(var k=pages.length-1;k>=0;k--){
    if(!pages[k].col.children.length&&pages.length>1){pages[k].pg.remove();pages.splice(k,1);}
  }
  report.pages=pages.length;
  Array.prototype.forEach.call(pagesEl.querySelectorAll('.page .pg'),function(e,i){e.textContent='Page '+(i+1)+' of '+pages.length;});
  flow.remove();
  window.__report=report;
});
})();
`;

/** How the pages laid out, as the page's script says when it is done (the hidden window waits for it). */
export interface BrandLaidOut {
  pages: number;
  moved: number;
  split: number;
  cut: string[];
}

/** The note read for print: its title, what it knows (facts) and its blocks of finished, cleaned HTML. One reading for
 *  the branded document and the designed one (src/shared/design-doc.ts), so both print the same cleaned words. */
function readNote(d: BrandDocInput): { title: string; facts: DocFacts; parsed: ParsedBody } {
  const props = readProps(d.text) as Record<string, unknown>;
  const kept = typeof props.title === 'string' ? props.title.replace(/\s+/g, ' ').trim() : '';
  const shown = d.path && kept ? displayTitle(d.path, props) : '';
  const rawTitle = (shown === kept && kept ? kept : d.title.trim()) || 'Untitled';
  const title = stripDatePrefix(linkWords(rawTitle)) || 'Untitled';
  const resolve = d.resolve ?? ((t: string) => t);
  const o: ParseOpts = { resolve, url: d.url };
  const facts = gatherFacts(d, title);
  const body = shareBody(d.text, { resolve, ...(d.me ? { me: d.me } : {}) });
  facts.present = notePeople(body, facts.props);
  const parsed = parseBody(body, facts, title, o);
  // Cleaned before dedupe, so "[[David Kim]]" in the properties and "David Kim" in an Also line print once.
  facts.absent = dedupePeople(facts.absent.map(linkWords).map((n) => n.trim()).filter(Boolean));
  facts.also = dedupePeople(facts.also.map(linkWords).map((n) => n.trim()).filter(Boolean));
  facts.present = dedupePeople(facts.present.map(linkWords).map((n) => n.trim()).filter(Boolean));
  return { title, facts, parsed };
}

/** What a designed document is made from (22 Nov 2026, the Design studio): the note's words as the branded document
 *  reads them (secrets, private paths, front matter and the transcript left out; pictures as vault file addresses),
 *  in blocks a layout places by number, with what the note knows for its cover. */
export interface BrandContent {
  title: string;
  /** The small label: Meeting minutes, a Project brief, the note's own type, else a Note. */
  label: string;
  /** Subtitle lines (the project, then the day, time and length). */
  sub: string[];
  figures: { value: string; label: string }[];
  /** A meeting's people rows: Present, Not present, Also named. */
  people: { label: string; names: string[] }[];
  /** The body's blocks of finished HTML, in order. */
  blocks: string[];
  confidential: boolean;
  /** The footer's words (the kit's footer when it has one). */
  foot: string;
}

export function brandContent(d: BrandDocInput): BrandContent {
  const { title, facts, parsed } = readNote(d);
  const people: { label: string; names: string[] }[] = [];
  if (facts.meeting) {
    if (facts.present.length) people.push({ label: 'Present', names: facts.present });
    if (facts.absent.length) people.push({ label: 'Not present', names: facts.absent });
    if (facts.also.length) people.push({ label: 'Also named', names: facts.also });
  }
  return { title, label: facts.label, sub: facts.sub, figures: facts.figures.map((f) => ({ value: linkWords(f.value), label: linkWords(f.label) })), people, blocks: parsed.blocks, confidential: facts.confidential, foot: facts.foot };
}

/** The whole finished document: paginated by its own script (print), or page one static (preview). */
export function brandDocument(d: BrandDocInput): string {
  const { title, facts, parsed } = readNote(d);

  const kit = d.kit ?? null;
  const accent = accentOf(kit) ?? BAND_DARK;
  const ink = inkFor(accent);
  const logo = logoFor({ kit, band: accent, url: d.url, palette: d.logoPalette });
  const brandName = kit?.name?.trim() ?? '';
  const logoImg = (cls: string) => {
    if (!logo) return '';
    const src = d.url(logo.rel);
    if (!src) return '';
    return `<img class="${cls}" src="${esc(src)}" alt="${esc(brandName || 'Logo')}">`;
  };
  const bandLeft = (cls: string) => logoImg(cls) || (brandName ? `<span class="${cls === 'mast-logo' ? 'mast-name' : 'slim-name'}">${esc(brandName)}</span>` : '<span></span>');
  const mast = `<div class="mast">${bandLeft('mast-logo')}<div class="k">${esc(facts.label)}${facts.bandLine2 ? `<br>${esc(facts.bandLine2)}` : ''}</div></div>`;
  const slim = `<div class="slim">${bandLeft('slim-logo')}<span class="t">${esc(facts.slim)}</span></div>`;

  const front: string[] = [`<h1 class="blk" dir="auto">${esc(title)}</h1>`];
  if (facts.sub.length) front.push(`<div class="sub blk">${facts.sub.map((s) => `<div dir="auto">${esc(s)}</div>`).join('')}</div>`);
  if (facts.figures.length) front.push(`<div class="blk"><div class="band" style="--n:${Math.min(4, facts.figures.length)}">${facts.figures.map((f) => `<div><b dir="auto">${esc(linkWords(f.value))}</b><span dir="auto">${esc(linkWords(f.label))}</span></div>`).join('')}</div></div>`);
  const rows: [string, string[]][] = [];
  if (facts.meeting) {
    if (facts.present.length) rows.push(['Present', facts.present]);
    if (facts.absent.length) rows.push(['Not present', facts.absent]);
    if (facts.also.length) rows.push(['Also named', facts.also]);
  }
  // Each name isolated (<bdi>), so a right-to-left name never reorders its row. Link marks never print: every
  // name reads through the shared cleaner (6 Nov 2026, "[[David Kim]]" printed raw in the Also row).
  if (rows.length) front.push(`<div class="blk meta">${rows.map(([k, v]) => `<div class="mrow"><dt>${esc(k)}</dt><dd dir="auto">${v.map((n) => `<bdi>${esc(linkWords(n))}</bdi>`).join(', ')}</dd></div>`).join('')}</div>`);

  const fonts = (kit?.fonts ?? []).map((f) => f.name).filter(fontOk);
  const sans = [...fonts.map((f) => `"${f}"`), 'Helvetica', 'Arial', '"Liberation Sans"', 'sans-serif'].join(',');
  const vars = `--accent:${accent};--bandink:${ink};--sans:${sans}`;
  const mode = d.mode ?? 'print';
  if (mode === 'preview') {
    const foot = `<div class="foot"><span>${esc(title)}</span><span>${esc(facts.foot)}</span><span>Page 1 of 1</span></div>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>:root{${vars}}${CSS}</style></head><body><div id="pages"><div class="page">${mast}<div class="pcol">${front.join('')}${parsed.blocks.join('')}</div>${foot}</div></div></body></html>`;
  }
  const meta = { mast, slim, footL: esc(title), footM: esc(facts.foot) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>:root{${vars}}${CSS}</style></head><body><div id="pages"></div><div id="flow">${front.join('')}${parsed.blocks.join('')}</div><script type="application/json" id="nv-meta">${JSON.stringify(meta).replace(/</g, '\\u003c')}</script><script>${LAYOUT_JS}</script></body></html>`;
}

/** What the brand kit is missing that would make its documents better, in one plain line (null when complete). */
export function brandKitHint(kit: BrandKit | null | undefined): string | null {
  const missing: string[] = [];
  if (!kit?.name?.trim()) missing.push('your business name');
  if (!kit?.logos?.primary) missing.push('a primary logo');
  if (!kit?.logos?.onDark) missing.push('a logo for dark backgrounds');
  if (!kit?.colours?.length) missing.push('a brand colour');
  if (!kit?.fonts?.length) missing.push('a brand font');
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : missing.length === 2 ? `${missing[0]} and ${missing[1]}` : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Add ${list} to make your documents look their best.`;
}

/** Page one of a small invented meeting, for the brand kit page's live preview. */
export function brandPreviewHtml(kit: BrandKit | null | undefined, url: (rel: string) => string): string {
  const sample = `---
date: 3 Mar 2026
project: Riverside cafe
attendees: [Ana Reyes, Sam Okafor]
figures:
  - { value: 20 Mar, label: Fit-out finishes }
  - { value: 2 Apr, label: Doors open }
---

## Summary

The fortnightly now runs from the shared tracker to cut status chasing. Thursday's menu tasting at the Quay decides the opening menu.

## Actions

- [ ] Confirm the tasting with the kitchen team — Ana · by 4 Mar 2026
- [ ] Run one menu tasting at the Quay — Sam · by 5 Mar 2026
`;
  return brandDocument({ title: 'Riverside Cafe Opening', text: sample, path: 'Meetings/Riverside Cafe Opening.md', kit, url, mode: 'preview' });
}


