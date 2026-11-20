// Zip files for Export vault and Import vault (23 Oct 2026; src/main/vault-home.ts). Written as Windows' own "Extract all"
// and every other zip program reads them: names in UTF-8, deflated (pictures, videos and documents already packed are
// stored as they are), ZIP64 where a file or the whole zip passes 4 GB. Read back the same way, file by file from the
// disk (never the whole zip in memory), each checked against its CRC; a name that climbs out of the folder, a link or an
// encrypted entry is never written.

import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw, createInflateRaw, crc32 } from 'node:zlib';

const STORED = /\.(jpe?g|png|gif|webp|avif|heic|mp4|mov|mkv|webm|m4v|mp3|m4a|aac|ogg|oga|opus|weba|flac|zip|7z|rar|gz|docx|xlsx|pptx|odt|ods|odp|pdf|nvkey)$/i;
const MAX32 = 0xffffffff;

export interface ZipSource {
  /** The entry's name in the zip (forward slashes). */
  name: string;
  /** A file on disk, or the bytes. */
  abs?: string;
  data?: Buffer;
  mtime?: number;
}

interface Written {
  name: Buffer;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  method: number;
  time: number;
  date: number;
}

function dos(ms: number): { time: number; date: number } {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const year = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** Writes a zip of `sources` to `dest` (through a temporary file beside it: a zip half written is never left as `dest`). */
export async function writeZip(dest: string, sources: Iterable<ZipSource> | AsyncIterable<ZipSource>, onEntry?: (done: number, bytes: number) => void): Promise<{ files: number; bytes: number }> {
  const temp = `${dest}.${process.pid}.part`;
  const out = createWriteStream(temp, { flags: 'w' });
  let offset = 0;
  const write = (b: Buffer) =>
    new Promise<void>((resolve, reject) => {
      offset += b.length;
      out.write(b, (err) => (err ? reject(err) : resolve()));
    });
  const written: Written[] = [];
  let bytes = 0;
  try {
    for await (const s of sources) {
      const name = Buffer.from(s.name.replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
      const { time, date } = dos(s.mtime ?? Date.now());
      const size = s.data ? s.data.length : (await fsp.stat(s.abs!)).size;
      const store = STORED.test(s.name) || size === 0;
      const big = size >= MAX32;
      const start = offset;
      // Local header: sizes follow in a data descriptor (bit 3), names in UTF-8 (bit 11).
      const extra = big ? zip64Extra([0, 0]) : Buffer.alloc(0);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(big ? 45 : 20, 4);
      head.writeUInt16LE(0x0808, 6);
      head.writeUInt16LE(store ? 0 : 8, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(0, 14);
      head.writeUInt32LE(big ? MAX32 : 0, 18);
      head.writeUInt32LE(big ? MAX32 : 0, 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(extra.length, 28);
      await write(Buffer.concat([head, name, extra]));
      let crc = 0;
      let usize = 0;
      let csize = 0;
      const count = new Transform({
        transform(chunk: Buffer, _e, cb) {
          crc = crc32(chunk, crc);
          usize += chunk.length;
          cb(null, chunk);
        },
      });
      const sink = new Transform({
        transform(chunk: Buffer, _e, cb) {
          csize += chunk.length;
          offset += chunk.length;
          cb(null, chunk);
        },
      });
      const input: Readable = s.data ? Readable.from([s.data]) : createReadStream(s.abs!);
      const into = async (src: AsyncIterable<Buffer>) => {
        for await (const chunk of src) if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      };
      if (store) await pipeline(input, count, sink, into);
      else await pipeline(input, count, createDeflateRaw({ level: 6 }), sink, into);
      // Data descriptor: 8-byte sizes for a ZIP64 entry.
      const desc = Buffer.alloc(big ? 24 : 16);
      desc.writeUInt32LE(0x08074b50, 0);
      desc.writeUInt32LE(crc >>> 0, 4);
      if (big) {
        desc.writeBigUInt64LE(BigInt(csize), 8);
        desc.writeBigUInt64LE(BigInt(usize), 16);
      } else {
        desc.writeUInt32LE(csize, 8);
        desc.writeUInt32LE(usize, 12);
      }
      await write(desc);
      written.push({ name, crc: crc >>> 0, csize, usize, offset: start, method: store ? 0 : 8, time, date });
      bytes += usize;
      onEntry?.(written.length, bytes);
    }
    // The central directory.
    const cdStart = offset;
    for (const w of written) {
      const need64 = w.usize >= MAX32 || w.csize >= MAX32 || w.offset >= MAX32;
      const extra = need64 ? zip64Extra([w.usize, w.csize, w.offset]) : Buffer.alloc(0);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE((3 << 8) | (need64 ? 45 : 20), 4);
      h.writeUInt16LE(need64 ? 45 : 20, 6);
      h.writeUInt16LE(0x0808, 8);
      h.writeUInt16LE(w.method, 10);
      h.writeUInt16LE(w.time, 12);
      h.writeUInt16LE(w.date, 14);
      h.writeUInt32LE(w.crc, 16);
      h.writeUInt32LE(need64 ? MAX32 : w.csize, 20);
      h.writeUInt32LE(need64 ? MAX32 : w.usize, 24);
      h.writeUInt16LE(w.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt16LE(0, 32);
      h.writeUInt16LE(0, 34);
      h.writeUInt16LE(0, 36);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      h.writeUInt32LE(need64 ? MAX32 : w.offset, 42);
      await write(Buffer.concat([h, w.name, extra]));
    }
    const cdSize = offset - cdStart;
    const need64 = written.length >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32;
    if (need64) {
      const eocd64At = offset;
      const e = Buffer.alloc(56);
      e.writeUInt32LE(0x06064b50, 0);
      e.writeBigUInt64LE(44n, 4);
      e.writeUInt16LE(45, 12);
      e.writeUInt16LE(45, 14);
      e.writeBigUInt64LE(BigInt(written.length), 24);
      e.writeBigUInt64LE(BigInt(written.length), 32);
      e.writeBigUInt64LE(BigInt(cdSize), 40);
      e.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(eocd64At), 8);
      loc.writeUInt32LE(1, 16);
      await write(Buffer.concat([e, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(written.length, 0xffff), 8);
    end.writeUInt16LE(Math.min(written.length, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
    end.writeUInt32LE(Math.min(cdStart, MAX32), 16);
    await write(end);
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    await fsp.rename(temp, dest);
    return { files: written.length, bytes };
  } catch (err) {
    out.destroy();
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

function zip64Extra(values: number[]): Buffer {
  const b = Buffer.alloc(4 + values.length * 8);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(values.length * 8, 2);
  values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return b;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ZipItem {
  name: string;
  dir: boolean;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  encrypted: boolean;
  link: boolean;
  mtime: number;
}

async function readAt(fh: fsp.FileHandle, at: number, len: number): Promise<Buffer> {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, at);
  return b.subarray(0, bytesRead);
}

/** The entries of a zip file, from its central directory. Throws "Not a zip file…" in words. */
export async function zipItems(file: string): Promise<ZipItem[]> {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 65557);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new Error('That isn’t a zip file Ironleaf can read.');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdStart = tail.readUInt32LE(eocd + 16);
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const at = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const e = await readAt(fh, at, 56);
      if (e.readUInt32LE(0) === 0x06064b50) {
        count = Number(e.readBigUInt64LE(32));
        cdSize = Number(e.readBigUInt64LE(40));
        cdStart = Number(e.readBigUInt64LE(48));
      }
    }
    if (cdStart + cdSize > size) throw new Error('That zip file is damaged or incomplete.');
    const cd = await readAt(fh, cdStart, cdSize);
    const items: ZipItem[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('That zip file is damaged.');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const ext = cd.readUInt32LE(p + 38);
      let offset = cd.readUInt32LE(p + 42);
      const rawName = cd.subarray(p + 46, p + 46 + nameLen);
      const name = flags & 0x0800 ? rawName.toString('utf8') : decodeCp437(rawName);
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      for (let q = 0; q + 4 <= extra.length; ) {
        const id = extra.readUInt16LE(q);
        const len = extra.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (usize === MAX32) (usize = Number(extra.readBigUInt64LE(r))), (r += 8);
          if (csize === MAX32) (csize = Number(extra.readBigUInt64LE(r))), (r += 8);
          if (offset === MAX32) offset = Number(extra.readBigUInt64LE(r));
        }
        q += 4 + len;
      }
      const mode = (ext >>> 16) & 0o170000;
      const mtime = new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime();
      items.push({ name, dir: name.endsWith('/'), method, crc, csize, usize, offset, encrypted: !!(flags & 1), link: mode === 0o120000, mtime });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return items;
  } finally {
    await fh.close();
  }
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeCp437(b: Buffer): string {
  let s = '';
  for (const c of b) s += c < 128 ? String.fromCharCode(c) : CP437[c - 128];
  return s;
}

/** A zip entry's name as a safe path under a folder (forward slashes), or null: it climbs out, is absolute, or is odd. */
export function safeEntryName(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.includes('\0')) return null;
  const parts = n.split('/').filter((x, i, all) => x !== '' || i === all.length - 1);
  if (parts.some((x) => x === '..' || x === '.')) return null;
  return parts.filter(Boolean).join('/') || null;
}

/** Every file of a zip written under `dir` (made), each checked against its CRC. Links and encrypted entries are left out
 *  (listed in `skipped`). `maxBytes`: refused before anything is written when the zip would unpack to more. */
export async function extractZip(file: string, dir: string, o: { maxBytes?: number; onProgress?(done: number, total: number): void } = {}): Promise<{ files: string[]; skipped: { rel: string; why: string }[] }> {
  const items = await zipItems(file);
  const total = items.reduce((s, i) => s + (i.dir ? 0 : i.usize), 0);
  if (o.maxBytes !== undefined && total > o.maxBytes) throw new Error('There isn’t room on this PC to unpack that zip file.');
  const files: string[] = [];
  const skipped: { rel: string; why: string }[] = [];
  const fh = await fsp.open(file, 'r');
  let done = 0;
  try {
    for (const it of items) {
      const rel = safeEntryName(it.name);
      if (!rel) {
        skipped.push({ rel: it.name, why: 'Its name points outside the folder.' });
        continue;
      }
      const abs = nodePath.join(dir, ...rel.split('/'));
      if (it.dir) {
        await fsp.mkdir(abs, { recursive: true });
        continue;
      }
      if (it.link) {
        skipped.push({ rel, why: 'It is a shortcut to somewhere else.' });
        continue;
      }
      if (it.encrypted) {
        skipped.push({ rel, why: 'It is protected with a password.' });
        continue;
      }
      if (it.method !== 0 && it.method !== 8) {
        skipped.push({ rel, why: 'It is packed in a way Ironleaf can’t unpack.' });
        continue;
      }
      const local = await readAt(fh, it.offset, 30);
      if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw new Error('That zip file is damaged.');
      const start = it.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      await fsp.mkdir(nodePath.dirname(abs), { recursive: true });
      let crc = 0;
      const check = new Transform({
        transform(chunk: Buffer, _e, cb) {
          crc = crc32(chunk, crc);
          done += chunk.length;
          cb(null, chunk);
        },
      });
      const src = it.csize ? createReadStream(file, { start, end: start + it.csize - 1 }) : Readable.from([]);
      if (it.method === 8) await pipeline(src, createInflateRaw(), check, createWriteStream(abs));
      else await pipeline(src, check, createWriteStream(abs));
      if (crc >>> 0 !== it.crc >>> 0) {
        await fsp.rm(abs, { force: true });
        throw new Error(`That zip file is damaged: ${rel} didn’t unpack as it was packed.`);
      }
      if (Number.isFinite(it.mtime)) await fsp.utimes(abs, new Date(), new Date(it.mtime)).catch(() => {});
      files.push(rel);
      o.onProgress?.(done, total);
    }
  } finally {
    await fh.close();
  }
  return { files, skipped };
}
