// An email saved as a file (.eml from new Outlook, Windows Mail, Gmail, Thunderbird and Apple Mail; .msg
// from classic Outlook, what most businesses on Outlook send around; t243 vault front door, 12 Nov 2026).
// Adapted from the former host app's own readers (native-runtime/email-read.mjs, msg-read.mjs,
// ole-file.mjs and rtf-text.mjs — our code, not a library), as structured parts instead of display text:
// who it is from and to, when, the subject, the words (the plain text, or the HTML or RTF version as
// text), a forwarded email inside it with its own headers, and its attachments with their bytes, for the
// Vault to keep as an email note with files on it. Pure: no files, no DOM, no Node modules — Uint8Array
// in, so the window and the tests read pasted and dropped mail the same way the main side reads files. A
// damaged file reads as null (or skips its broken part), never throws past the door: `readEmailFile` is
// the door.
export interface EmailAttachment {
  name: string;
  kind: string;
  size: number;
  data: Uint8Array;
  inline: boolean;
}
export interface EmailDoc {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  /** The internet message id when the file carries one (t244: the same email dropped twice lands once). */
  messageId: string;
  subject: string;
  /** An Outlook .msg that is not mail (a calendar appointment, a contact, a task): what it is, else ''. */
  kind: string;
  words: string;
  files: EmailAttachment[];
}
/** Who an address names: "June Park <june@example.invalid>" as { name: 'June Park', address: 'june@…' }. */
export interface EmailWho {
  name: string;
  address: string;
}
export const isEmailFileName = (name: string): boolean => /\.(eml|msg)$/i.test(String(name ?? '').trim());
export const isPdfFileName = (name: string): boolean => /\.pdf$/i.test(String(name ?? '').trim());
const MAX_FILES = 50;
const KIND_WORDS: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'picture', 'image/png': 'picture', 'image/gif': 'picture', 'image/webp': 'picture', 'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'CSV', 'text/calendar': 'calendar invite', 'application/zip': 'zip archive' };
/** What an attachment is, in plain words. */
export function attachmentKind(type: string, name: string): string {
  const t = String(type || '').toLowerCase();
  if (KIND_WORDS[t]) return KIND_WORDS[t];
  if (/\.pdf$/i.test(name)) return 'PDF';
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) return 'picture';
  if (/\.docx?$/i.test(name)) return 'Word document';
  if (/\.xlsx?$/i.test(name)) return 'Excel workbook';
  if (/\.pptx?$/i.test(name)) return 'PowerPoint deck';
  if (/\.zip$/i.test(name)) return 'zip archive';
  if (/\.(eml|msg)$/i.test(name)) return 'email';
  if (/\.msg$/i.test(name)) return 'Outlook email';
  return type || 'file';
}
export const sizeWords = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** An attachment's name made safe to keep (the vault picks a free name when it lands). */
export function attachmentName(name: string, i: number): string {
  return String(name || `attachment-${i + 1}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 120) || `attachment-${i + 1}`;
}
// ── Bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};
const decoderFor = (charset: string): TextDecoder => {
  const name = String(charset || 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase();
  try {
    return new TextDecoder(name === 'us-ascii' || name === 'ascii' ? 'utf-8' : name);
  } catch {
    return new TextDecoder('windows-1252');
  }
};
const textOf = (bytes: Uint8Array, charset?: string): string => decoderFor(charset ?? 'utf-8').decode(bytes);
/** Base64 as the mail carries it (line breaks, missing padding): tolerant, never throws. */
function base64Bytes(data: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(data).replace(/[^A-Za-z0-9+/=]/g, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === '=') break;
    buf = (buf << 6) | chars.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
// A UTF-16 string as Outlook writes it (plain pairs; a JS loop, safe at any offset — the native decoder
// the former host app used corrupted the heap at an odd start offset, t224 11 Nov 2026).
function utf16Text(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  const words: number[] = [];
  for (let at = start; at + 1 < end; at += 2) {
    words.push(bytes[at] | (bytes[at + 1] << 8));
    if (words.length >= 4096) {
      out += String.fromCharCode(...words);
      words.length = 0;
    }
  }
  return out + String.fromCharCode(...words);
}
// ── .eml ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Headers: unfolded, with RFC 2047 encoded words (=?utf-8?B?…?=) decoded.
function encodedWords(value: string): string {
  return String(value).replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(?:\s+(?==\?))?/g, (_m, charset: string, kind: string, data: string) => {
    const bytes = kind === 'B' || kind === 'b' ? base64Bytes(data) : Uint8Array.from(data.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0));
    return textOf(bytes, String(charset).split('*')[0]);
  });
}
function splitMessage(bytes: Uint8Array): { headers: Map<string, string>; body: Uint8Array } {
  const raw = latin1(bytes);
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const bodyStart = m ? m.index + m[0].length : raw.length;
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim().toLowerCase();
      if (!headers.has(key)) headers.set(key, line.slice(i + 1).trim());
    }
  }
  return { headers, body: bytes.subarray(bodyStart) };
}
// "text/plain; charset=utf-8; name=…" as its value and parameters (RFC 2231 name*=utf-8''… too).
function contentParams(value: string): Record<string, string> {
  const [first, ...rest] = String(value || '').split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out: Record<string, string> = { value: first.trim().toLowerCase() };
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    let key = part.slice(0, i).trim().toLowerCase();
    let val = part.slice(i + 1).trim().replace(/^"|"$/g, '');
    if (key.endsWith('*')) {
      key = key.replace(/\*\d*\*?$/, '');
      const m = /^([^']*)'[^']*'(.*)$/.exec(val);
      if (m) val = textOf(Uint8Array.from(m[2].replace(/%([0-9a-fA-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0)), m[1]);
      out[key] = (out[key] && /\*\d+\*?$/.test(part.slice(0, i)) ? out[key] : '') + val;
    } else if (!(key in out)) out[key] = encodedWords(val);
  }
  return out;
}
function decodeBody(body: Uint8Array, encoding: string | undefined): Uint8Array {
  const how = String(encoding || '').trim().toLowerCase();
  if (how === 'base64') return base64Bytes(latin1(body));
  if (how === 'quoted-printable') {
    const s = latin1(body).replace(/=\r?\n/g, '').replace(/=([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  }
  return body;
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', deg: '°' };
/** An HTML email as the words a person reads. */
export function htmlText(html: string): string {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m)))
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n[ \t ]+/g, '\n')
    .replace(/[ \t ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const EML_HEADS: [string, string][] = [['from', 'From'], ['to', 'To'], ['cc', 'Cc'], ['date', 'Date'], ['subject', 'Subject']];
const emlHeaderLines = (headers: Map<string, string>): string => EML_HEADS.filter(([key]) => headers.get(key)).map(([key, label]) => `${label}: ${encodedWords(headers.get(key)!)}`).join('\n');
// One part: its words (in `words`), or an attachment (in `files`); nested multiparts and forwarded emails followed.
function walkEml(bytes: Uint8Array, out: { words: string[]; files: EmailAttachment[] }, depth = 0): void {
  const { headers, body } = splitMessage(bytes);
  const type = contentParams(headers.get('content-type') || 'text/plain');
  const disposition = contentParams(headers.get('content-disposition') || '');
  const name = disposition.filename || type.name || '';
  if (type.value.startsWith('multipart/') && type.boundary && depth < 12) {
    const marker = `--${type.boundary}`;
    const raw = latin1(body);
    const parts: Uint8Array[] = [];
    let at = raw.indexOf(marker);
    while (at >= 0) {
      const start = raw.indexOf('\n', at) + 1;
      if (start <= 0 || raw.startsWith(`${marker}--`, at)) break;
      const next = raw.indexOf(`\n${marker}`, start);
      const end = next < 0 ? raw.length : next;
      parts.push(Uint8Array.from(raw.slice(start, end).replace(/\r$/, ''), (c) => c.charCodeAt(0) & 0xff));
      at = next < 0 ? -1 : next + 1;
    }
    if (type.value === 'multipart/alternative') {
      const kinds = parts.map((p) => contentParams(splitMessage(p).headers.get('content-type') || 'text/plain').value);
      const pick = kinds.indexOf('text/plain') >= 0 ? kinds.indexOf('text/plain') : kinds.indexOf('text/html') >= 0 ? kinds.indexOf('text/html') : parts.length - 1;
      parts.forEach((p, i) => {
        if (i === pick || !/^text\/(plain|html)$/.test(kinds[i])) walkEml(p, out, depth + 1);
      });
    } else for (const p of parts) walkEml(p, out, depth + 1);
    return;
  }
  const data = decodeBody(body, headers.get('content-transfer-encoding'));
  if (type.value === 'message/rfc822' && depth < 12) {
    const inner: { words: string[]; files: EmailAttachment[] } = { words: [], files: out.files };
    walkEml(data, inner, depth + 1);
    out.words.push(`---------- Forwarded email ----------\n${emlHeaderLines(splitMessage(data).headers)}\n\n${inner.words.join('\n\n')}`);
    return;
  }
  const attached = disposition.value === 'attachment' || (!!name && !/^text\/(plain|html)$/.test(type.value)) || !/^text\//.test(type.value);
  if (!attached && type.value === 'text/html') {
    out.words.push(htmlText(textOf(data, type.charset)));
    return;
  }
  if (!attached) {
    out.words.push(textOf(data, type.charset).replace(/\r\n/g, '\n').trim());
    return;
  }
  out.files.push({ name: name || (type.value.startsWith('image/') ? 'picture' : 'attachment'), kind: attachmentKind(type.value, name), size: data.length, data, inline: disposition.value === 'inline' || !!headers.get('content-id') });
}
/** A .eml file as its parts, or null when the bytes are not an email. */
export function readEmlFile(raw: Uint8Array): EmailDoc | null {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  const { headers } = splitMessage(bytes);
  if (!headers.has('from') && !headers.has('subject') && !headers.has('content-type') && !headers.has('to')) return null;
  const out: { words: string[]; files: EmailAttachment[] } = { words: [], files: [] };
  try {
    walkEml(bytes, out);
  } catch {
    if (!out.words.length && !out.files.length) return null;
  }
  const head = (key: string): string => (headers.has(key) ? encodedWords(headers.get(key)!) : '');
  return { from: head('from'), to: head('to'), cc: head('cc'), bcc: head('bcc'), date: head('date'), messageId: head('message-id').trim().slice(0, 500), subject: head('subject'), kind: '', words: out.words.filter(Boolean).join('\n\n'), files: out.files.slice(0, MAX_FILES) };
}
// ── .msg ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The container Outlook's saved emails are kept in: a "compound file" (OLE, Microsoft's [MS-CFB]), a small file
// system of storages and streams inside one file. Read-only, and careful with a damaged file: every sector
// number is checked against the file, every chain is cut at the number of sectors the file holds (no loops),
// and a stream is never read past its own size.
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREE = 0xffffffff;
const END = 0xfffffffe;
const NONE = 0xffffffff;
const damaged = (message: string): Error => Object.assign(new Error(message), { code: 'damaged' });
export const isOleFile = (bytes: Uint8Array | undefined): boolean => !!bytes && bytes.length >= 512 && OLE_SIGNATURE.every((b, i) => bytes[i] === b);
interface OleFile {
  entries: { path: string; name: string; type: 'storage' | 'stream'; size: number }[];
  has(name: string): boolean;
  stream(name: string): Uint8Array;
}
function readOle(raw: Uint8Array): OleFile {
  const buffer = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  if (!isOleFile(buffer)) throw damaged('not a compound file');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const shift = u16(0x1e);
  const miniShift = u16(0x20);
  if (!(shift === 9 || shift === 12) || miniShift !== 6) throw damaged('unexpected sector sizes');
  const size = 1 << shift;
  const miniSize = 1 << miniShift;
  const cutoff = u32(0x38) || 4096;
  const sectors = Math.floor((buffer.length - size) / size) + ((buffer.length - size) % size ? 1 : 0);
  if (sectors < 1) throw damaged('no sectors');
  const sectorAt = (n: number): Uint8Array => {
    if (n >= sectors) throw damaged('a sector past the end of the file');
    const at = (n + 1) * size;
    return buffer.subarray(at, Math.min(at + size, buffer.length));
  };
  // The sector table (FAT): its sectors are listed in the header and, past 109 of them, in a chain of list sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const n = u32(0x4c + i * 4);
    if (n !== FREE && n !== END) fatSectors.push(n);
  }
  let difat = u32(0x44);
  let guard = 0;
  while (difat !== END && difat !== FREE && guard++ < sectors) {
    const s = sectorAt(difat);
    const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < size / 4 - 1; i++) {
      const n = sv.getUint32(i * 4, true);
      if (n !== FREE && n !== END) fatSectors.push(n);
    }
    difat = sv.getUint32(size - 4, true);
  }
  const fat = new Uint32Array((fatSectors.length * size) / 4);
  fatSectors.forEach((n, k) => {
    const s = sectorAt(n);
    const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i * 4 + 3 < s.length; i++) fat[(k * size) / 4 + i] = sv.getUint32(i * 4, true);
  });
  const chain = (start: number, table: Uint32Array, limit: number): number[] => {
    const out: number[] = [];
    let n = start;
    while (n !== END && n !== FREE) {
      if (n >= table.length || out.length > limit) throw damaged('a broken sector chain');
      out.push(n);
      n = table[n];
    }
    return out;
  };
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const read = (start: number, length: number): Uint8Array => {
    const parts: Uint8Array[] = [];
    let left = length;
    for (const n of chain(start, fat, sectors)) {
      if (left <= 0) break;
      const s = sectorAt(n);
      parts.push(s.subarray(0, Math.min(left, s.length)));
      left -= s.length;
    }
    return concat(parts);
  };
  // The directory: 128 bytes an entry, in its own chain.
  const dir = concat(chain(u32(0x30), fat, sectors).map(sectorAt));
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const raws: { name: string; type: number; left: number; right: number; child: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameBytes = Math.min(64, dirView.getUint16(at + 64, true));
    const type = dir[at + 66];
    const name = utf16Text(dir, at, at + Math.max(0, nameBytes - 2));
    const big = dirView.getUint32(at + 124, true);
    const low = dirView.getUint32(at + 120, true);
    raws.push({ name, type, left: dirView.getUint32(at + 68, true), right: dirView.getUint32(at + 72, true), child: dirView.getUint32(at + 76, true), start: dirView.getUint32(at + 116, true), size: shift === 9 ? low : big ? Number.MAX_SAFE_INTEGER : low });
  }
  const root = raws[0];
  if (!root || root.type !== 5) throw damaged('no root storage');
  // Small streams (under the cutoff) sit in the root's own stream, in 64-byte pieces with their own table.
  let miniFat: Uint32Array | null = null;
  let miniStream: Uint8Array | null = null;
  const small = (start: number, length: number): Uint8Array => {
    if (!miniFat) {
      const bytes = u32(0x3c) === END ? new Uint8Array(0) : read(u32(0x3c), u32(0x40) * size);
      miniFat = new Uint32Array(bytes.length / 4);
      const bv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = bv.getUint32(i * 4, true);
      miniStream = read(root.start, root.size);
    }
    const parts: Uint8Array[] = [];
    let left = length;
    for (const n of chain(start, miniFat, miniFat.length)) {
      if (left <= 0) break;
      const at = n * miniSize;
      if (at >= miniStream!.length) throw damaged('a small stream past the end');
      parts.push(miniStream!.subarray(at, Math.min(at + Math.min(left, miniSize), miniStream!.length)));
      left -= miniSize;
    }
    return concat(parts);
  };
  // Each storage's children are a tree (left, right); walked without recursion, each entry once.
  const entries: OleFile['entries'] = [];
  const byPath = new Map<string, (typeof raws)[number]>();
  const seen = new Set<number>();
  const walk = (top: number, prefix: string): void => {
    const stack = [top];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === NONE || id >= raws.length || seen.has(id)) continue;
      seen.add(id);
      const e = raws[id];
      stack.push(e.left, e.right);
      if (e.type !== 1 && e.type !== 2) continue;
      const full = prefix + e.name;
      const entry = { path: full, name: e.name, type: (e.type === 1 ? 'storage' : 'stream') as 'storage' | 'stream', size: e.type === 2 ? e.size : 0 };
      entries.push(entry);
      byPath.set(full, e);
      if (e.type === 1) walk(e.child, `${full}/`);
    }
  };
  seen.add(0);
  walk(root.child, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    entries,
    has: (name: string) => byPath.has(name),
    stream(name: string): Uint8Array {
      const e = byPath.get(name);
      if (!e || e.type !== 2) throw damaged(`no stream ${name}`);
      if (e.size > buffer.length * 2) throw damaged('a stream larger than the file');
      return e.size < cutoff ? small(e.start, e.size) : read(e.start, e.size);
    },
  };
}
// Windows code pages Outlook records (PR_MESSAGE_CODEPAGE, PR_INTERNET_CPID) as TextDecoder names.
const CODEPAGE: Record<number, string> = { 65001: 'utf-8', 1200: 'utf-16le', 1201: 'utf-16be', 20127: 'utf-8', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 28605: 'iso-8859-15', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 874: 'windows-874', 50220: 'iso-2022-jp', 51932: 'euc-jp', 20866: 'koi8-r', 21866: 'koi8-u' };
const decoderOf = (cp: number): TextDecoder => {
  const name = CODEPAGE[cp] || (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252');
  try {
    return new TextDecoder(name);
  } catch {
    return new TextDecoder('windows-1252');
  }
};
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const MSG_CLASS: [RegExp, string][] = [[/^IPM\.Schedule\.Meeting\.Request/i, 'meeting request'], [/^IPM\.Schedule\.Meeting\.Resp\.Pos/i, 'meeting accepted'], [/^IPM\.Schedule\.Meeting\.Resp\.Neg/i, 'meeting declined'], [/^IPM\.Schedule\.Meeting\.Resp\.Tent/i, 'meeting tentatively accepted'], [/^IPM\.Schedule\.Meeting\.Canceled/i, 'meeting cancelled'], [/^IPM\.Appointment/i, 'calendar appointment'], [/^IPM\.Contact/i, 'contact'], [/^IPM\.Task/i, 'task'], [/^IPM\.StickyNote/i, 'note'], [/^IPM\.Post/i, 'post'], [/^REPORT\./i, 'delivery report']];
interface MsgMessage {
  prefix: string;
  fixed: Map<number, number | boolean | bigint>;
  cp: number;
  str(id: number): string;
  bin(id: number): Uint8Array | null;
}
// One message inside the file: the whole file (prefix ''), or an email attached in it (its storage path + '/').
function msgMessage(ole: OleFile, prefix: string, headerSize: number, inherited: number): MsgMessage {
  const fixed = new Map<number, number | boolean | bigint>();
  try {
    const props = ole.stream(`${prefix}__properties_version1.0`);
    const pv = new DataView(props.buffer, props.byteOffset, props.byteLength);
    for (let at = headerSize; at + 16 <= props.length; at += 16) {
      const type = pv.getUint16(at, true);
      const id = pv.getUint16(at + 2, true);
      if (type === 0x0003) fixed.set(id, pv.getInt32(at + 8, true));
      else if (type === 0x000b) fixed.set(id, pv.getUint16(at + 8, true) !== 0);
      else if (type === 0x0040) fixed.set(id, pv.getBigUint64(at + 8, true));
    }
  } catch {
    // No properties stream: the strings below still read.
  }
  // 8-bit strings follow the message's code page (PR_MESSAGE_CODEPAGE; the internet one is the HTML's); with none
  // recorded, UTF-8 when the bytes are valid UTF-8, else Windows-1252 (an "öäü" subject from a German Outlook).
  const cp = (fixed.get(0x3ffd) as number) || inherited || 0;
  const hex = (id: number): string => id.toString(16).toUpperCase().padStart(4, '0');
  const stream = (name: string): Uint8Array | null => {
    try {
      return ole.has(prefix + name) ? ole.stream(prefix + name) : null;
    } catch {
      return null;
    }
  };
  const narrowText = (bytes: Uint8Array): string => {
    if (cp) return decoderOf(cp).decode(bytes);
    try {
      return UTF8_STRICT.decode(bytes);
    } catch {
      return decoderOf(1252).decode(bytes);
    }
  };
  const str = (id: number): string => {
    const wide = stream(`__substg1.0_${hex(id)}001F`);
    if (wide) return utf16Text(wide).replace(/\0+$/, '');
    const narrow = stream(`__substg1.0_${hex(id)}001E`);
    return narrow ? narrowText(narrow).replace(/\0+$/, '') : '';
  };
  const bin = (id: number): Uint8Array | null => stream(`__substg1.0_${hex(id)}0102`);
  return { prefix, fixed, cp, str, bin };
}
// A FILETIME (100 ns since 1601) as an email date in this PC's time zone: "Tue, 12 Jan 2010 16:13:31 +1100".
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function filetimeText(value: unknown): string {
  if (typeof value !== 'bigint' || value <= 0n) return '';
  const ms = Number(value / 10000n) - 11644473600000;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
}
const msgAddress = (name: string, email: string): string => {
  const n = String(name || '').trim().replace(/^'(.*)'$/, '$1');
  const e = /@/.test(email || '') ? String(email).trim() : '';
  return n && e && n.toLowerCase() !== e.toLowerCase() ? `${n} <${e}>` : n || e;
};
// The recipients by kind (1 To, 2 Cc, 3 Bcc), from their own storages; Outlook's display lists when there are none.
function msgRecipients(ole: OleFile, m: MsgMessage): { to: string; cc: string; bcc: string } {
  const lists: Record<number, string[]> = { 1: [], 2: [], 3: [] };
  const top = m.prefix;
  const storages = ole.entries.filter((e) => e.type === 'storage' && e.path.startsWith(top) && /^__recip_version1\.0_#[0-9A-F]{8}$/i.test(e.path.slice(top.length)));
  for (const s of storages) {
    const r = msgMessage(ole, `${s.path}/`, 8, m.cp);
    const kind = (r.fixed.get(0x0c15) as number) || 1;
    const who = msgAddress(r.str(0x3001) || r.str(0x3a00), r.str(0x39fe) || r.str(0x3003) || r.str(0x5ff6));
    if (who) (lists[kind] || lists[1]).push(who);
  }
  const shown = (list: string[], fallback: string): string => (list.length ? list.join('; ') : fallback);
  return { to: shown(lists[1], m.str(0x0e04)), cc: shown(lists[2], m.str(0x0e03)), bcc: shown(lists[3], m.str(0x0e02)) };
}
// An RTF body as text (paragraphs, table cells as "cell | cell" rows, accented letters, quotes and dashes, a
// link's text; fonts, colours, pictures, field codes and other bookkeeping left out).
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'pgdsctbl', 'revtbl', 'filetbl', 'fldinst', 'bkmkstart', 'bkmkend', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'nonshppict', 'shppict', 'blipuid', 'mmathPr', 'wgrffmtfilter', 'fchars', 'lchars', 'protusertbl', 'userprops', 'docvar', 'private', 'xe', 'tc', 'txe']);
const RTF_WORD: Record<string, string> = { par: '\n', sect: '\n\n', page: '\n\n', line: '\n', tab: '\t', cell: ' | ', nestcell: ' | ', row: '\n', nestrow: '\n', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };
export function rtfText(raw: Uint8Array | string): string | null {
  const text = typeof raw === 'string' ? raw : latin1(raw);
  if (!/^\s*\{\\rtf/.test(text)) return null;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(`windows-${/\\ansicpg(\d+)/.exec(text)?.[1] || '1252'}`);
  } catch {
    decoder = new TextDecoder('windows-1252');
  }
  const out: string[] = [];
  let bytes: number[] = [];
  const flushBytes = (): void => {
    if (bytes.length) {
      out.push(decoder.decode(Uint8Array.from(bytes)));
      bytes = [];
    }
  };
  const put = (s: string): void => {
    flushBytes();
    out.push(s);
  };
  // Group state: skipped (a destination left out), and \uc (characters to skip after a \u).
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;
  let groupStart = false;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ skip, uc });
      groupStart = true;
      i++;
      continue;
    }
    if (ch === '}') {
      const top = stack.pop();
      if (top) {
        skip = top.skip;
        uc = top.uc;
      }
      groupStart = false;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (skipChars > 0) skipChars--;
        else if (!skip) bytes.push(next.charCodeAt(0));
        i += 2;
        groupStart = false;
        continue;
      }
      if (next === "'") {
        const code = parseInt(text.slice(i + 2, i + 4), 16);
        if (skipChars > 0) skipChars--;
        else if (!skip && !Number.isNaN(code)) bytes.push(code);
        i += 4;
        groupStart = false;
        continue;
      }
      if (next === '*') {
        skip = true;
        i += 2;
        continue;
      }
      if (next === '~') {
        if (!skip) put(' ');
        i += 2;
        continue;
      }
      if (next === '-') {
        i += 2;
        continue;
      }
      if (next === '_') {
        if (!skip) put('-');
        i += 2;
        continue;
      }
      if (next === '\r' || next === '\n') {
        if (!skip) put('\n');
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(text.slice(i + 1, i + 50));
      if (!m) {
        i += 2;
        continue;
      }
      const [, word, param] = m;
      i += 1 + m[0].length;
      if (groupStart && RTF_SKIP.has(word)) skip = true;
      groupStart = false;
      if (skip) continue;
      if (word === 'uc') {
        uc = Number(param || 1);
        continue;
      }
      if (word === 'u') {
        let code = Number(param || 0);
        if (code < 0) code += 65536;
        put(String.fromCharCode(code));
        skipChars = uc;
        continue;
      }
      if (word in RTF_WORD) put(RTF_WORD[word]);
      continue;
    }
    groupStart = false;
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (skipChars > 0) {
      skipChars--;
      i++;
      continue;
    }
    if (!skip) bytes.push(text.charCodeAt(i) & 0xff);
    i++;
  }
  flushBytes();
  return out.join('').replace(/[ \t]*\|[ \t]*\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Outlook's compressed RTF ([MS-OXRTFCP]): LZ77 over a 4 KB window that starts with these 207 characters.
const RTF_START = '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';
export function decompressRtf(buffer: Uint8Array): Uint8Array | null {
  if (!buffer || buffer.length < 16) return null;
  const v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const size = v.getUint32(0, true);
  const rawSize = v.getUint32(4, true);
  const magic = v.getUint32(8, true);
  if (magic === 0x414c454d) return buffer.subarray(16, 16 + rawSize); // "MELA": stored as is
  if (magic !== 0x75465a4c || rawSize > 64 * 1024 * 1024) return null; // "LZFu"
  const window = new Uint8Array(4096);
  for (let i = 0; i < RTF_START.length; i++) window[i] = RTF_START.charCodeAt(i) & 0xff;
  let at = RTF_START.length;
  const out = new Uint8Array(rawSize);
  let n = 0;
  let i = 16;
  const end = Math.min(buffer.length, size + 4);
  while (i < end && n < rawSize) {
    const flags = buffer[i++];
    for (let bit = 0; bit < 8 && i < end && n < rawSize; bit++) {
      if (flags & (1 << bit)) {
        if (i + 1 >= end) return out.subarray(0, n);
        const ref = (buffer[i] << 8) | buffer[i + 1];
        i += 2;
        const from = ref >> 4;
        const length = (ref & 15) + 2;
        if (from === at) return out.subarray(0, n); // the end marker
        for (let k = 0; k < length && n < rawSize; k++) {
          const c = window[(from + k) & 4095];
          out[n++] = c;
          window[at] = c;
          at = (at + 1) & 4095;
        }
      } else {
        const c = buffer[i++];
        out[n++] = c;
        window[at] = c;
        at = (at + 1) & 4095;
      }
    }
  }
  return out.subarray(0, n);
}
// The words: the plain text Outlook keeps; else the HTML version, or the RTF one (decompressed), as text.
function msgWords(m: MsgMessage): string {
  const plain = m.str(0x1000);
  if (plain.trim()) return plain.replace(/\r\n/g, '\n').trim();
  const htmlBytes = m.bin(0x1013);
  const html = htmlBytes ? decoderOf((m.fixed.get(0x3fde) as number) || 65001).decode(htmlBytes) : m.str(0x1013);
  if (html.trim()) return htmlText(html);
  const compressed = m.bin(0x1009);
  const rtf = compressed ? decompressRtf(compressed) : null;
  if (rtf) {
    const text = rtfText(rtf);
    if (text) return text;
  }
  return '';
}
function msgHeaders(m: MsgMessage, ole: OleFile): { from: string; to: string; cc: string; bcc: string; date: string; subject: string } {
  const from = msgAddress(m.str(0x0042) || m.str(0x0c1a), m.str(0x5d02) || m.str(0x0065) || m.str(0x5d01) || m.str(0x0c1f));
  const { to, cc, bcc } = msgRecipients(ole, m);
  const date = filetimeText(m.fixed.get(0x0039)) || filetimeText(m.fixed.get(0x0e06)) || filetimeText(m.fixed.get(0x3007));
  return { from, to, cc, bcc, date, subject: m.str(0x0037) };
}
// Attachments: a file (kept), or an email attached inside (its headers and words kept; its own files kept too).
function walkMsg(ole: OleFile, m: MsgMessage, out: { words: string[]; files: EmailAttachment[] }, depth: number): void {
  const atts = ole.entries.filter((e) => e.type === 'storage' && e.path.startsWith(m.prefix) && /^__attach_version1\.0_#[0-9A-F]{8}$/i.test(e.path.slice(m.prefix.length)));
  for (const s of atts) {
    const a = msgMessage(ole, `${s.path}/`, 8, m.cp);
    const name = a.str(0x3707) || a.str(0x3704) || a.str(0x3001);
    const inner = `${s.path}/__substg1.0_3701000D`;
    if (ole.has(inner) && depth < 8) {
      const e = msgMessage(ole, `${inner}/`, 24, m.cp);
      const nested: { words: string[]; files: EmailAttachment[] } = { words: [], files: out.files };
      walkMsg(ole, e, nested, depth + 1);
      const h = msgHeaders(e, ole);
      out.words.push(`---------- Attached email${name ? ` (${name})` : ''} ----------\n${['From', 'To', 'Cc', 'Date', 'Subject'].map((k) => h[k.toLowerCase() as keyof typeof h] && `${k}: ${h[k.toLowerCase() as keyof typeof h]}`).filter(Boolean).join('\n')}\n\n${[msgWords(e), ...nested.words].filter(Boolean).join('\n\n') || '(no words in this email)'}`);
      continue;
    }
    const data = a.bin(0x3701);
    if (!data) continue;
    const type = a.str(0x370e);
    out.files.push({ name: name || 'attachment', kind: attachmentKind(type, name), size: data.length, data, inline: !!a.str(0x3712) && a.fixed.get(0x7ffe) === true });
  }
}
/** A .msg file as its parts, or null when the file is not an Outlook item after all. */
export function readMsgFile(raw: Uint8Array): EmailDoc | null {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  let ole: OleFile;
  try {
    ole = readOle(bytes);
  } catch {
    return null;
  }
  if (!ole.entries.some((e) => e.name.startsWith('__substg1.0_') || e.name === '__properties_version1.0')) return null;
  const m = msgMessage(ole, '', 32, 0);
  const cls = m.str(0x001a);
  const kind = MSG_CLASS.find(([re]) => re.test(cls))?.[1] ?? '';
  const out: { words: string[]; files: EmailAttachment[] } = { words: [], files: [] };
  try {
    walkMsg(ole, m, out, 0);
  } catch {
    // A broken attachment never loses the email itself.
  }
  const h = msgHeaders(m, ole);
  return { ...h, kind, messageId: m.str(0x1035).trim().slice(0, 500), words: [msgWordsSafe(m), ...out.words].filter(Boolean).join('\n\n'), files: out.files.slice(0, MAX_FILES) };
}
function msgWordsSafe(m: MsgMessage): string {
  try {
    return msgWords(m);
  } catch {
    return '';
  }
}
/** A saved email (.eml or .msg) as its parts, by its file name; null when it is neither or reads as neither. */
export function readEmailFile(name: string, raw: Uint8Array): EmailDoc | null {
  if (/\.eml$/i.test(String(name ?? '').trim())) return readEmlFile(raw);
  if (/\.msg$/i.test(String(name ?? '').trim())) return readMsgFile(raw);
  return readEmlFile(raw) ?? readMsgFile(raw);
}
// ── Who ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "June Park <june@example.invalid>, sam@example.invalid" as who each is (a bare address names only itself). */
export function splitAddresses(value: string): EmailWho[] {
  const out: EmailWho[] = [];
  // Split on commas outside quotes and brackets ("Park, June" <…> stays one).
  const parts: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (const ch of String(value ?? '')) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '<' || ch === '(') {
      depth++;
      cur += ch;
    } else if ((ch === '>' || ch === ')') && depth > 0) {
      depth--;
      cur += ch;
    } else if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (const part of parts) {
    const t = part.trim().replace(/^['"]|['"]$/g, '').trim();
    if (!t) continue;
    const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(t) || /^([^<>\s]+@[^<>\s]+)\s*\((.*)\)\s*$/.exec(t);
    if (m) {
      const firstIsAddress = m[1].includes('@');
      const address = (firstIsAddress ? m[1] : m[2]).trim();
      const name = (firstIsAddress ? m[2] : m[1]).trim().replace(/^['"]|['"]$/g, '').trim();
      out.push({ name: name && name.toLowerCase() !== address.toLowerCase() ? name : '', address });
    } else if (/^[^<>\s]+@[^<>\s]+$/.test(t)) out.push({ name: '', address: t });
    else if (t) out.push({ name: t, address: '' });
  }
  return out;
}
/** The sender as a person is named: their name, else their address, else ''. */
export function senderName(from: string): string {
  const first = splitAddresses(from)[0];
  return first ? first.name || first.address : '';
}
/** The sender's address, lower-cased, for matching to a person card; '' when none. */
export function senderAddress(from: string): string {
  return (splitAddresses(from)[0]?.address ?? '').toLowerCase();
}
