// Markdown helpers shared by the indexer (main process) and the editor (renderer).
// They work on the vault's on-disk format: plain Markdown, YAML front matter and [[wikilinks]].

import { cleanFileName } from './paths';
import type { LinkRef } from './types';

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MD_LINK_RE = /(!?)\[[^\]\n]*\]\(([^)\s]+\.md)(?:#[^)\s]*)?\)/gi;
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our she so that the their them then there these they this to was we were what when which who will with you your'.split(' '),
);

export interface ParsedWikilink {
  target: string;
  heading?: string;
  alias?: string;
}

/** Splits the inside of a [[...]] link into target, heading and alias. */
export function parseWikilink(inner: string): ParsedWikilink {
  let rest = inner;
  let alias: string | undefined;
  const pipe = rest.indexOf('|');
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim() || undefined;
    rest = rest.slice(0, pipe);
  }
  let heading: string | undefined;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || undefined;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, alias };
}

/** Lower-cases a link target or path and drops a trailing ".md" so they can be compared. */
export function normalizeTarget(target: string): string {
  return target.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();
}

/** A link target as a person reads it: folders, a .md and decoding off, underscores as spaces. */
const linkBase = (t: string): string => {
  let u = String(t ?? '');
  try {
    u = decodeURIComponent(u);
  } catch {
    // Kept as written when it isn't valid percent-encoding.
  }
  return u.replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop()!.replace(/\.md$/i, '').replace(/_/g, ' ').trim();
};

/** A #heading as a person reads it ("key-decisions" reads "key decisions"; a bare block anchor reads as nothing). */
const headingWords = (h: string): string => {
  const t = String(h ?? '').trim();
  if (!t || t.startsWith('^')) return '';
  return t.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
};

/** The inside of one [[...]] as the words a person reads: the alias, else the note's name, else its heading. */
export function wikiWords(inner: string): string {
  const { target, heading, alias } = parseWikilink(inner);
  if (alias) return alias;
  if (target) return linkBase(target);
  if (heading) return headingWords(heading);
  return '';
}

/** A link target as a person reads it (folders, a .md and decoding off, underscores as spaces). */
export const linkBaseName = linkBase;

/**
 * Every link's marks off, as a person reads them: [[David Kim]] reads "David Kim", [[People/Kim|Kim]]
 * reads "Kim", a [label](target) reads as its label, and #heading forms read as their words ([[Note#Next
 * steps]] reads "Note", [[#Next steps]] reads "Next steps"). Bare words pass through untouched. Every
 * printed route reads through here, so wiki link marks never reach a person (6 Nov 2026, the Fitzroy
 * run's branded PDF printed "[[David Kim]]" raw in its Also row).
 */
export function linkWords(s: string): string {
  let out = String(s ?? '');
  out = out.replace(/!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, alt: string, href: string) => (alt || linkBase(href.replace(/^<|>$/g, '').trim())).trim());
  out = out.replace(/!\[\[([^\[\]\n]+?)\]\]/g, (_m, inner: string) => wikiWords(inner));
  out = out.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_m, inner: string) => wikiWords(inner));
  out = out.replace(/\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, href: string) => (label || linkBase(href.replace(/^<|>$/g, '').trim())).trim());
  return out;
}

export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

/** A note's displayed title: its `title:` when that is this file's own display title (its safe file name is this
 *  file's name, as the New meeting form keeps a colon the file name cannot hold), else the file name (a renamed
 *  file's stale `title:` never wins). A copy number the file took to stay unique (" weekly 2") belongs to the file
 *  only (6 Nov 2026, the second Fitzroy meeting showed its " 2" and lost its colon): `title:` wins when its safe
 *  file name is the file's name without that number. */
export function displayTitle(path: string, props: Record<string, unknown> | undefined): string {
  const file = titleFromPath(path);
  const t = typeof props?.title === 'string' ? props.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!t || t === file) return file;
  const bare = file.replace(/ \d+$/, '');
  const safe = (s: string, max: number, project = false) => (project ? cleanFileName(s, '', max, 'project').replace(/^[. ]+/, '') : cleanFileName(s, '', max));
  if (safe(t, 100, true) === file || (bare !== file && safe(t, 100, true) === bare)) return t;
  const short = (t.split(/[\\/]/).pop() ?? '').trim();
  if (safe(short, 180) === file || (bare !== file && safe(short, 180) === bare)) return t;
  return file;
}

/**
 * Replaces fenced code blocks, inline code and front matter with spaces, keeping
 * every newline and the total length, so offsets and line numbers stay valid.
 */
// Kept for the text at hand (t102, 9 Nov 2026): tags, headings and links each masked the note on every
// keystroke. Pure, so one entry is always the same answer; a new text masks again. Callers must not change it.
let maskedText: string | null = null;
let maskedOut = '';
export function maskCode(content: string): string {
  if (content === maskedText) return maskedOut;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = content;
  const fm = frontMatterRange(out);
  if (fm) out = blank(out.slice(0, fm.end)) + out.slice(fm.end);
  out = out.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, blank);
  out = out.replace(/`[^`\n]+`/g, blank);
  maskedText = content;
  maskedOut = out;
  return out;
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** All outgoing links in a note: wikilinks, embeds and Markdown links to local .md files. */
export function extractLinks(content: string): LinkRef[] {
  const masked = maskCode(content);
  const starts = lineStarts(content);
  const links: LinkRef[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const parsed = parseWikilink(m[2]);
    if (!parsed.target) continue;
    links.push({ ...parsed, embed: m[1] === '!', line: lineAt(starts, m.index ?? 0) });
  }
  for (const m of masked.matchAll(MD_LINK_RE)) {
    const href = m[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    let target = href;
    try {
      target = decodeURI(href);
    } catch {
      // Keep the raw href if it isn't valid percent-encoding.
    }
    links.push({ target: target.replace(/^\.\//, ''), embed: m[1] === '!', line: lineAt(starts, m.index ?? 0) });
  }
  return links;
}

export function extractHeadings(content: string): string[] {
  const masked = maskCode(content);
  return [...masked.matchAll(HEADING_RE)].map((m) => m[2]);
}

const unmarkHeading = (s: string) => s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[*_`=]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Every heading with its level and its line (0-based), front matter and fences skipped: the note's own outline,
 * for the strip beside it (8.7 w2b round 4). Marks off, as the page reads them.
 */
export function headingsWithLines(content: string): { level: number; text: string; line: number }[] {
  // No line starting with `#`, no headings (t102, 9 Nov 2026): masking and line starts are skipped. Masking only
  // ever blanks, so a raw note without one has none either way.
  if (!/(^|[\n\r\u2028\u2029])#{1,6}[ \t]/.test(content)) return [];
  const masked = maskCode(content);
  const starts = lineStarts(content);
  const out: { level: number; text: string; line: number }[] = [];
  for (const m of masked.matchAll(HEADING_RE)) out.push({ level: m[1].length, text: unmarkHeading(m[2]), line: lineAt(starts, m.index ?? 0) });
  return out;
}

/**
 * Words after a # that aren't tags (Wave 4, 24 Oct 2026; the plan: "Colour codes (#CF0A2C, #5A6067, #D6D9DC,
 * #F4F5F6) show up as tags"): a number ("#2"), and a colour code (#c0ffee, #CF0A2C, #fff8: three, four, six or eight
 * hex digits with at least one digit in them, so a word such as #facade stays a tag).
 */
export function isNotATag(word: string): boolean {
  const w = word.replace(/^#/, '');
  if (/^\d+$/.test(w)) return true;
  return /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(w) && /\d/.test(w);
}

export function extractTags(content: string, frontMatterTags: string[] = []): string[] {
  // No `#`, no tags in the words (t102, 9 Nov 2026): masking and the match are skipped, the top's tags kept.
  if (!content.includes('#')) return [...new Set(frontMatterTags.map((t) => t.replace(/^#/, '')))].sort();
  const masked = maskCode(content);
  const tags = new Set(frontMatterTags.map((t) => t.replace(/^#/, '')));
  for (const m of masked.matchAll(TAG_RE)) {
    if (!isNotATag(m[2])) tags.add(m[2]);
  }
  return [...tags].sort();
}

function frontMatterRange(content: string): { body: number; end: number } | null {
  if (!content.startsWith('---')) return null;
  const firstBreak = content.indexOf('\n');
  if (firstBreak < 0 || content.slice(0, firstBreak).trim() !== '---') return null;
  const close = /^(---|\.\.\.)[ \t]*$/m;
  const rest = content.slice(firstBreak + 1);
  const m = close.exec(rest);
  if (!m) return null;
  const end = firstBreak + 1 + m.index + m[0].length;
  return { body: firstBreak + 1, end };
}

/**
 * Minimal YAML front matter reader: `key: value`, `key: [a, b]` and `key:` followed by
 * `- item` lines. Enough for tags and aliases; full property editing is a later feature.
 */
export function parseFrontMatter(content: string): Record<string, string | string[]> {
  const range = frontMatterRange(content);
  if (!range) return {};
  const yaml = content.slice(range.body, range.end).replace(/(---|\.\.\.)[ \t]*$/, '');
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (const raw of yaml.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return data;
}

export function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Folded for matching: "café" reads as "cafe", so typing without the mark still finds it (9.2). */
export function foldDiacritics(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Lower-case word tokens for search scoring, without very common words. */
export function tokenize(text: string): string[] {
  const words = foldDiacritics(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Calls `replace` for every wikilink outside code and splices in what it returns.
 * Used to render wikilinks in reading view and to rewrite links when a note is renamed.
 */
export function replaceWikilinks(
  content: string,
  replace: (link: ParsedWikilink, raw: string, embed: boolean) => string,
): string {
  const masked = maskCode(content);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const start = m.index ?? 0;
    const raw = content.slice(start, start + m[0].length);
    out += content.slice(last, start) + replace(parseWikilink(m[2]), raw, m[1] === '!');
    last = start + m[0].length;
  }
  return out + content.slice(last);
}

const LOCAL_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/**
 * Calls `replace` for every Markdown link to a file in the notes ([text](Folder/Note.md), ![](photo.png)) outside
 * code, with its path decoded, and splices in the link it returns. Links to websites are left alone.
 */
export function replaceMarkdownLinks(content: string, replace: (target: string, fragment: string, raw: string, embed: boolean, label: string) => string): string {
  const masked = maskCode(content);
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(LOCAL_LINK_RE)) {
    const start = m.index ?? 0;
    const raw = content.slice(start, start + m[0].length);
    const href = content.slice(start + m[0].length - 1 - m[3].length, start + m[0].length - 1);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    const hash = href.indexOf('#');
    const pathPart = hash >= 0 ? href.slice(0, hash) : href;
    let target = pathPart;
    try {
      target = decodeURI(pathPart);
    } catch {
      // Kept as written when it isn't valid percent-encoding.
    }
    out += content.slice(last, start) + replace(target.replace(/^\.\//, ''), hash >= 0 ? href.slice(hash) : '', raw, m[1] === '!', m[2]);
    last = start + m[0].length;
  }
  return out + content.slice(last);
}

/** A path written into a Markdown link (spaces and the few characters that would end the link encoded). */
export function encodeLinkPath(p: string): string {
  return p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/#/g, '%23');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds `phrase` on its own (not inside a word, a [[link]] or code) in `line`.
 * Returns the column of the first match or -1.
 */
export function findUnlinkedPhrase(line: string, phrase: string): number {
  const masked = maskCode(line).replace(/!?\[\[[^[\]\n]*\]\]/g, (s) => ' '.repeat(s.length));
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_])`, 'iu');
  const m = re.exec(masked);
  return m ? m.index : -1;
}

/** A fenced code block open across lines: its run's character and length. */
export interface Fence {
  ch: string;
  len: number;
}

/** One line through the fence rule: the state after it, and whether the line itself is fenced (the fence lines and
 *  everything between). A fence opens on ``` or ~~~ and closes on the same run at least as long, so ``` never closes
 *  ```` (Nov 2026 audit: four toggles compared the first character only). The one rule every note scan follows. */
export function trackFence(line: string, fence: Fence | null): { fence: Fence | null; skip: boolean } {
  const m = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!m) return { fence, skip: !!fence };
  if (!fence) return { fence: { ch: m[1][0], len: m[1].length }, skip: true };
  return m[1][0] === fence.ch && m[1].length >= fence.len ? { fence: null, skip: true } : { fence, skip: true };
}

/** A tick-box line ("- [ ] …", "* [x] …", "1. [ ] …"): the list mark and box, the box's mark, the gap, the words. The
 *  one pattern (Nov 2026 audit: five copies with drift); whether the mark says done reads through isBoxDone. */
export const TASK_LINE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([^\]])(\]\s+)(.*)$/;
