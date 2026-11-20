// Importing without losing anything (23 Oct 2026; src/main/vault-home.ts importInto): two copies of a note combined the
// way the two vaults were merged by hand on 23 Oct — identical lines once, the note here kept exactly as it is, and every
// line of the other copy that isn't here added under "Merged from <where> (<day>)", grouped under the heading it sat
// under. Nothing is renamed and nothing is dropped; combining the same copy again changes nothing. Pages exported by
// other notes apps become notes: HTML (Evernote, Apple Notes and Google Keep exports, saved web pages), MHTML web
// archives (OneNote page exports, 9.5 F10) and CSV tables. Pure: no Node modules, so the window can use it too.

import { csvHeadings, hasHeadings, parseCsv } from './csv';
import { frontMatterRange } from './frontmatter';

const norm = (t: string) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
/** The same words: line ends, a byte-order mark and spaces at line ends don't count. */
export const sameText = (a: string, b: string) => tidyEnds(norm(a)) === tidyEnds(norm(b));
const tidyEnds = (t: string) => t.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
const lineKey = (l: string) => l.trim().replace(/\s+/g, ' ');
/** A line as compared: spaces aside, and a heading by its words whatever its level (a merged heading is written ###). */
const cmpKey = (l: string) => {
  const k = lineKey(l);
  return /^#{1,6}\s/.test(k) ? `#${k.replace(/^#+\s*/, '')}` : k;
};

interface Fm {
  /** Top-level keys with their lines (the key's line and any indented or list lines under it). */
  keys: { key: string; lines: string[] }[];
}
function readFm(yaml: string): Fm {
  const keys: Fm['keys'] = [];
  for (const line of yaml.split('\n')) {
    const m = /^([^\s#][^:]*):(?:\s|$)/.exec(line);
    if (m) keys.push({ key: m[1].trim(), lines: [line] });
    else if (keys.length && line.trim()) keys[keys.length - 1].lines.push(line);
  }
  return { keys };
}

function split(text: string): { fm: string | null; body: string } {
  const t = norm(text);
  const r = frontMatterRange(t);
  if (!r) return { fm: null, body: t };
  return { fm: r.yaml.replace(/\n$/, ''), body: t.slice(r.to) };
}

/**
 * The note here combined with another copy of it. `text` is the note as it is here, unchanged at the top; what only the
 * other copy has comes after, under "## Merged from <source> (<day>)". `changed` is false when the other copy adds
 * nothing (it is the same, or every line of it is here already).
 */
export function mergeNote(here: string, other: string, source: string, day: string): { text: string; changed: boolean } {
  if (sameText(here, other)) return { text: here, changed: false };
  // Nothing here yet (an empty note): the other copy is the note.
  if (!norm(here).trim()) return { text: other, changed: true };
  const a = split(here);
  const b = split(other);
  const crlf = /\r\n/.test(here);
  // Properties: one the other copy has and this one doesn't is added to this one's; one both have with different values
  // is noted under the merged section, so no value is lost.
  let fm = a.fm;
  const differing: string[] = [];
  if (b.fm !== null) {
    const ak = a.fm !== null ? readFm(a.fm) : { keys: [] };
    const bk = readFm(b.fm);
    const add: string[] = [];
    for (const k of bk.keys) {
      const mine = ak.keys.find((x) => x.key.toLowerCase() === k.key.toLowerCase());
      if (!mine) add.push(...k.lines);
      else if (k.lines.map(lineKey).join('\n') !== mine.lines.map(lineKey).join('\n')) differing.push(...k.lines.map((l, i) => (i === 0 ? `- ${l.trim()}` : `  ${l.trim()}`)));
    }
    if (add.length) fm = [a.fm ?? '', ...add].filter((l, i) => i > 0 || l !== '').join('\n');
  }
  // The body: each line of the other copy not here yet, under the heading it was under there.
  const have = new Set(a.body.split('\n').map(cmpKey).filter(Boolean));
  // A property's other value noted by an earlier merge isn't noted again.
  if (differing.length && differing.every((l) => have.has(cmpKey(l)))) differing.length = 0;
  const groups: { heading: string | null; lines: string[] }[] = [];
  let heading: string | null = null;
  let lastAdded = false;
  for (const raw of b.body.split('\n')) {
    const k = cmpKey(raw);
    const isHeading = /^#{1,6}\s/.test(raw);
    if (isHeading) heading = raw.trim();
    if (!k) {
      if (lastAdded) groups[groups.length - 1].lines.push('');
      continue;
    }
    if (have.has(k)) {
      lastAdded = false;
      continue;
    }
    have.add(k);
    lastAdded = true;
    // A heading only the other copy has starts its own group (said once, as the group's heading).
    if (isHeading) {
      groups.push({ heading: raw.trim(), lines: [] });
      continue;
    }
    let g = groups[groups.length - 1];
    if (!g || g.heading !== heading) {
      g = { heading, lines: [] };
      groups.push(g);
    }
    g.lines.push(raw);
  }
  if (!differing.length && !groups.length && fm === a.fm) return { text: here, changed: false };
  let body = a.body.replace(/\n+$/, '');
  if (differing.length || groups.length) {
    const out: string[] = [`## Merged from ${source} (${day})`, ''];
    if (differing.length) out.push(`Properties with other values there:`, '', ...differing, '');
    for (const g of groups) {
      const lines = g.lines.join('\n').replace(/^\n+|\n+$/g, '');
      if (g.heading) out.push(g.heading.replace(/^#{1,6}/, '###'), '');
      if (lines) out.push(lines, '');
    }
    body = `${body}${body ? '\n\n' : ''}${out.join('\n').replace(/\n+$/, '')}`;
  }
  let text = `${fm !== null ? `---\n${fm}\n---\n` : ''}${body}\n`;
  if (crlf) text = text.replace(/\n/g, '\r\n');
  return { text, changed: true };
}

/** Every line of `other` (spaces aside) is in `merged`: nothing of it was lost. */
export function keepsEveryLine(merged: string, other: string): boolean {
  const have = new Set(norm(merged).split('\n').map(lineKey));
  const fmLine = (l: string) => lineKey(l).replace(/^- /, '');
  const haveFm = new Set([...have].map((l) => l.replace(/^- /, '')));
  return norm(other)
    .split('\n')
    .map(lineKey)
    .filter((l) => l && l !== '---')
    .every((l) => have.has(l) || haveFm.has(fmLine(l)) || have.has(l.replace(/^#{1,6}/, '###')));
}

// ── Other apps' pages ──────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : '';
};

/**
 * An HTML page as a Markdown note: its title, headings, paragraphs, lists (nested), links, pictures, bold and italic, code,
 * quotes, tables and to-do boxes. Scripts, styles and the page's head are left out. Not a browser: what it can't read
 * becomes plain words, never lost. `skipped` names pictures too big to keep inline (F12).
 */
export function htmlToMarkdown(html: string): { title: string; markdown: string; skipped: { what: string; why: string }[] } {
  let s = norm(html);
  const skipped: { what: string; why: string }[] = [];
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? '').replace(/<[^>]+>/g, '').trim());
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1>/gi, '');
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(s);
  if (body) s = body[1];
  // Preformatted code is kept as it is.
  const pres: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    pres.push(decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n+$/, ''));
    return `\n\n\u0000PRE${pres.length - 1}\u0000\n\n`;
  });
  // Tables: each row a line of cells. A header row only when the table has <th> (F12: a headerless table keeps every
  // row as data under an empty header, so its first row is never promoted to headings it never had).
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner: string) => {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => ({ th: c[1].toLowerCase() === 'th', text: inline(c[2], skipped).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() })));
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width) return '';
    const fill = (r: { text: string }[]) => `| ${[...r.map((c) => c.text), ...Array(width - r.length).fill('')].join(' | ')} |`;
    const head = rows[0].some((c) => c.th) ? [fill(rows[0]), `|${Array(width).fill(' --- ').join('|')}|`, ...rows.slice(1).map(fill)] : [fill([]), `|${Array(width).fill(' --- ').join('|')}|`, ...rows.map(fill)];
    return `\n\n${head.join('\n')}\n\n`;
  });
  // Lists, nested: each item a line with its depth.
  let depth = 0;
  const stack: ('ul' | 'ol')[] = [];
  const counters: number[] = [];
  s = s.replace(/<(\/?)(ul|ol|li)\b([^>]*)>/gi, (_, close: string, tag: string, rest: string) => {
    const t = tag.toLowerCase();
    if (t === 'ul' || t === 'ol') {
      // A list inside a list item goes on the next line, with no blank line before or after it.
      if (close) {
        stack.pop();
        counters.pop();
        depth = Math.max(0, depth - 1);
        return depth ? '' : '\n\n';
      }
      stack.push(t as 'ul' | 'ol');
      counters.push(0);
      depth++;
      return depth > 1 ? '' : '\n\n';
    }
    if (close) return '';
    const kind = stack[stack.length - 1] ?? 'ul';
    const n = counters.length ? ++counters[counters.length - 1] : 1;
    const checked = /\bchecked\b/i.test(rest) || /data-checked\s*=\s*"?true/i.test(rest);
    const box = /\bcheck|todo|task/i.test(rest) ? (checked ? '[x] ' : '[ ] ') : '';
    return `\n${'  '.repeat(Math.max(0, depth - 1))}${kind === 'ol' ? `${n}.` : '-'} ${box}\u0001`;
  });
  // To-do boxes written as inputs (Evernote, Keep, Apple Notes' aria-checked, OneNote's checked divs).
  s = s.replace(/<input\b[^>]*type\s*=\s*["']?checkbox[^>]*>/gi, (tag) => (/\bchecked\b/i.test(tag) || /aria-checked\s*=\s*["']?true/i.test(tag) ? '[x] ' : '[ ] '));
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${inline(inner, skipped).replace(/\n+/g, ' ').trim()}\n\n`);
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) => `\n\n${inline(inner, skipped).trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`);
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  s = s.replace(/<\/?(p|div|section|article|header|footer|main|aside|figure|figcaption|dl|dt|dd|en-note|span\s+class="?content)\b[^>]*>/gi, '\n\n');
  s = inline(s, skipped);
  s = s.replace(/\u0000PRE(\d+)\u0000/g, (_, i: string) => `\`\`\`\n${pres[Number(i)]}\n\`\`\``);
  const lines = s.split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+(?![ \t]*(?:[-*]|\d+\.)\s)/, '').replace(/(\[[ x]\]) {2,}/, '$1 '));
  let md = lines.join('\n').replace(/\u0001\s*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  // A tick on a line of its own is a task (F12: div-wrapped checklists from Apple Notes and OneNote).
  md = md.replace(/^(\s*)\[( |x)\] /gm, '$1- [$2] ');
  // The page title heads the note, unless a heading already says it (F12: no doubled titles).
  if (title && !md.split('\n').some((l) => /^#\s+(.*)/.exec(l)?.[1]?.trim().toLowerCase() === title.toLowerCase())) md = `# ${title}\n\n${md}`;
  return { title, markdown: `${md}\n`, skipped };
}

function inline(s: string, skipped: { what: string; why: string }[]): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = attr(tag, 'src');
        const alt = attr(tag, 'alt') || 'a picture';
        if (!src) return alt;
        // Embedded pictures (RFC 2397 data: URLs) stay inline when small; a huge one is said, not silently dropped (F12).
        if (src.startsWith('data:')) {
          if (src.length <= 1024 * 1024) return `![${alt}](${src})`;
          skipped.push({ what: alt, why: 'an embedded picture over 1 MB was left out' });
          return alt;
        }
        return `![${alt}](${src.replace(/ /g, '%20')})`;
      })
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, a: string, inner: string) => {
        const href = attr(`<a${a}>`, 'href');
        const words = inner.replace(/<[^>]+>/g, '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return words;
        return words && words !== href ? `[${words}](${href.replace(/ /g, '%20')})` : `<${href}>`;
      })
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : inner))
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : inner))
      .replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner: string) => (inner.trim() ? `~~${inner.trim()}~~` : inner))
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => `\`${inner}\``)
      .replace(/<[^>]+>/g, ''),
  ).replace(/ /g, ' ');
}

/** A CSV table (a notes app's or a database's export) as a note: its name as the title, the table as Markdown.
 *  A table with no headings keeps every row as data under "Column 1…" (F20), never losing its first row as names. */
export function csvToMarkdown(text: string, name: string): string {
  const rows = parseCsv(text);
  if (!rows.length) return `# ${name}\n`;
  const headed = hasHeadings(rows);
  const head = headed ? rows[0] : csvHeadings(rows);
  const data = headed ? rows.slice(1) : rows;
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (c: string) => c.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
  const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].map(cell).join(' | ')} |`;
  return `# ${name}\n\n${[line(head), `|${Array(width).fill(' --- ').join('|')}|`, ...data.map(line)].join('\n')}\n`;
}

// ── MHTML web archives (OneNote page exports, F10) ───────────────────────────────────────────────────────────────
// A .mht file is MIME (RFC 2045) holding a page: the first text/html part plus its pictures and files, each part
// base64 or quoted-printable. Read with the standard alone — no mail library.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 as bytes, without Node's Buffer (spaces and line breaks aside). */
function b64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 3 < clean.length + 3; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (clean[i + k] === '=' || clean[i + k] === undefined ? -1 : B64.indexOf(clean[i + k])));
    if (c[0] < 0 || c[1] < 0) break;
    out.push((c[0] << 2) | (c[1] >> 4));
    if (c[2] >= 0) out.push(((c[1] & 15) << 4) | (c[2] >> 2));
    if (c[3] >= 0) out.push(((c[2] & 3) << 6) | c[3]);
  }
  return new Uint8Array(out);
}

/** Quoted-printable as bytes (=XX hex, soft breaks). */
function qpBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /[0-9A-Fa-f]{2}/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (s[i] === '=' && (s[i + 1] === '\r' || s[i + 1] === '\n')) {
      if (s[i + 1] === '\r' && s[i + 2] === '\n') i++;
      i++;
    } else out.push(s.charCodeAt(i) & 255);
  }
  return new Uint8Array(out);
}

interface MhtPart { headers: Map<string, string>; body: string }

function mhtParts(text: string): { boundary: string; parts: MhtPart[] } | null {
  const headEnd = /\r?\n\r?\n/.exec(text);
  if (!headEnd) return null;
  const head = text.slice(0, headEnd.index);
  const boundary = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(head)?.[1]?.trim();
  if (!boundary) return null;
  const rest = text.slice(headEnd.index + headEnd[0].length);
  const parts: MhtPart[] = [];
  for (const chunk of rest.split(`--${boundary}`)) {
    if (/^\s*(--)?\s*$/.test(chunk)) continue;
    const split = /\r?\n\r?\n/.exec(chunk);
    if (!split) continue;
    const headers = new Map<string, string>();
    let last = '';
    for (const line of chunk.slice(0, split.index).split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && last) headers.set(last, `${headers.get(last)} ${line.trim()}`);
      else {
        const m = /^([^:]+):\s*(.*)$/.exec(line);
        if (m) {
          last = m[1].trim().toLowerCase();
          headers.set(last, m[2].trim());
        }
      }
    }
    parts.push({ headers, body: chunk.slice(split.index + split[0].length).replace(/\r?\n$/, '') });
  }
  return { boundary, parts };
}

const MHT_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'application/pdf': 'pdf' };

export interface MhtFile { name: string; data: Uint8Array }

/**
 * An MHTML web archive as a note: its HTML page through the shared converter, its pictures unpacked beside the note
 * under `filesDir` (a folder named after the note). What cannot be decoded is left as words and said.
 */
export function mhtToMarkdown(text: string, name: string, filesDir: string): { title: string; markdown: string; files: MhtFile[]; skipped: { what: string; why: string }[] } {
  const skipped: { what: string; why: string }[] = [];
  const parsed = mhtParts(text);
  if (!parsed) {
    // Not MIME at all: read it as plain HTML (some exporters misname .html as .mht).
    const { title, markdown, skipped: hs } = htmlToMarkdown(text);
    return { title: title || name, markdown, files: [], skipped: hs };
  }
  const decode = (p: MhtPart): Uint8Array => {
    const enc = (p.headers.get('content-transfer-encoding') ?? '').toLowerCase();
    if (enc === 'base64') return b64Bytes(p.body);
    if (enc === 'quoted-printable') return qpBytes(p.body);
    const out = new Uint8Array(p.body.length);
    for (let i = 0; i < p.body.length; i++) out[i] = p.body.charCodeAt(i) & 255;
    return out;
  };
  const utf8 = new TextDecoder('utf-8');
  const htmlPart = parsed.parts.find((p) => (p.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) ?? parsed.parts[0];
  if (!htmlPart) return { title: name, markdown: `# ${name}\n`, files: [], skipped: [{ what: name, why: 'the archive held no page' }] };
  // Resources by every name the page may use for them (Content-Location's file, its full address, Content-ID).
  const files: MhtFile[] = [];
  const byRef = new Map<string, string>();
  let n = 0;
  for (const p of parsed.parts) {
    if (p === htmlPart) continue;
    const type = (p.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim();
    if (type.startsWith('text/')) continue;
    n++;
    const loc = p.headers.get('content-location') ?? '';
    const cid = (p.headers.get('content-id') ?? '').replace(/^<|>$/g, '');
    const fromLoc = loc.split(/[\\/]/).pop()?.split(/[?#]/)[0]?.trim() ?? '';
    const ext = MHT_EXT[type] ?? (/^[^/]+\/([a-z0-9]{1,5})$/.exec(type)?.[1] ?? 'bin');
    const fname = (fromLoc && /^\S+$/.test(fromLoc) ? fromLoc : `part-${n}.${ext}`).replace(/["*:<>?|]/g, '_').slice(0, 80);
    let data: Uint8Array;
    try {
      data = decode(p);
    } catch {
      skipped.push({ what: fname, why: 'it couldn’t be decoded' });
      continue;
    }
    if (!data.length) continue;
    files.push({ name: fname, data });
    const ref = `${filesDir}/${fname}`;
    if (fromLoc) byRef.set(fromLoc.toLowerCase(), ref);
    if (loc) byRef.set(loc.toLowerCase(), ref);
    if (cid) {
      byRef.set(`cid:${cid.toLowerCase()}`, ref);
      byRef.set(cid.toLowerCase(), ref);
    }
  }
  let html: string;
  try {
    html = utf8.decode(decode(htmlPart));
  } catch {
    return { title: name, markdown: `# ${name}\n`, files: [], skipped: [{ what: name, why: 'its page couldn’t be decoded' }] };
  }
  // The page's references (cid:, Content-Location, bare file names) rewritten to the unpacked files.
  html = html.replace(/(src|href)\s*=\s*(["'])([^"']+)\2/gi, (all, at: string, q: string, url: string) => {
    const ref = byRef.get(url.toLowerCase()) ?? byRef.get(url.split(/[\\/]/).pop()?.toLowerCase() ?? '');
    return ref ? `${at}=${q}${ref}${q}` : all;
  });
  const { title, markdown, skipped: hs } = htmlToMarkdown(html);
  return { title: title || name, markdown, files, skipped: [...skipped, ...hs] };
}
