// First-page pictures of PDFs, for the project Files grid, the Assets page and canvas cards (17 Oct 2026: Windows' own
// thumbnail call returns nothing for PDFs on some PCs, so the grid showed only the designed tile). The window draws page
// one with PDF.js (bundled, Apache-2.0; see ASSETS.md) and this side keeps the picture in Ironleaf's own data, named
// by the file's path, time and size, so each PDF is drawn once. A PDF that can't be drawn (broken, protected) is
// remembered too, and keeps its designed tile.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Bigger PDFs keep their designed tile (reading them whole to draw one page isn't worth it). */
export const MAX_PDF_BYTES = 80 * 1024 * 1024;
/** A saved picture is a small image; anything bigger is refused. */
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

/** The name a PDF's picture is kept under: its full path (any case on Windows), its time and its size. */
export function pdfThumbKey(abs: string, mtimeMs: number, size: number): string {
  const where = process.platform === 'win32' ? path.resolve(abs).toLowerCase() : path.resolve(abs);
  return createHash('sha1').update(`${where}\u0000${Math.round(mtimeMs)}\u0000${size}`).digest('hex');
}

/** Whether bytes are a picture the window made (PNG or WebP), and small enough to keep. */
export function isPagePicture(data: unknown): data is Uint8Array {
  if (!(data instanceof Uint8Array) || data.byteLength < 16 || data.byteLength > MAX_PICTURE_BYTES) return false;
  const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const webp = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
  return png || webp;
}

export type PdfPage = { url: string } | { failed: true } | { key: string; bytes: Uint8Array };

export class PdfThumbs {
  constructor(private readonly dir: string) {}

  private file(key: string, ext: 'webp' | 'png' | 'none'): string {
    return path.join(this.dir, `${key}.${ext}`);
  }

  /** The kept picture of a PDF, that it can't be drawn, or its bytes (and the name to keep the picture under). */
  async page(abs: string): Promise<PdfPage> {
    if (!/\.pdf$/i.test(abs)) return { failed: true };
    const stat = await fsp.stat(abs);
    if (!stat.isFile() || stat.size > MAX_PDF_BYTES || stat.size === 0) return { failed: true };
    const key = pdfThumbKey(abs, stat.mtimeMs, stat.size);
    for (const ext of ['webp', 'png'] as const) {
      try {
        await fsp.access(this.file(key, ext));
        return { url: pathToFileURL(this.file(key, ext)).href };
      } catch {}
    }
    try {
      await fsp.access(this.file(key, 'none'));
      return { failed: true };
    } catch {}
    const buf = await fsp.readFile(abs);
    return { key, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
  }

  /** A PDF on a remote computer, named by its computer, folder, path and version (time and size): its kept picture, that
   *  it can't be drawn, or its bytes, read through the former host app only when there's no picture yet. */
  async remotePage(name: string, version: string, size: number, read: () => Promise<Buffer>): Promise<PdfPage> {
    if (!/\.pdf$/i.test(name) || size > 16 * 1024 * 1024) return { failed: true };
    const key = createHash('sha1').update(`remote\u0000${name}\u0000${version}`).digest('hex');
    for (const ext of ['webp', 'png'] as const) {
      try {
        await fsp.access(this.file(key, ext));
        return { url: pathToFileURL(this.file(key, ext)).href };
      } catch {}
    }
    try {
      await fsp.access(this.file(key, 'none'));
      return { failed: true };
    } catch {}
    try {
      const buf = await read();
      return { key, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    } catch {
      return { failed: true };
    }
  }

  /** Keeps the window's picture of a PDF (or, with none, that it couldn't be drawn). */
  async save(key: unknown, data: unknown): Promise<string | null> {
    if (typeof key !== 'string' || !/^[0-9a-f]{40}$/.test(key)) throw new Error('Not a picture’s name.');
    await fsp.mkdir(this.dir, { recursive: true });
    if (data === null) {
      await fsp.writeFile(this.file(key, 'none'), '');
      return null;
    }
    if (!isPagePicture(data)) throw new Error('Not a picture.');
    const ext = data[0] === 0x89 ? 'png' : 'webp';
    const target = this.file(key, ext);
    await fsp.writeFile(`${target}.part`, data);
    await fsp.rename(`${target}.part`, target);
    return pathToFileURL(target).href;
  }
}
