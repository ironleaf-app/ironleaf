// A note's branded document printed (5 Nov 2026, brand documents): the finished HTML (src/shared/brand-document.ts)
// opened in a window nobody sees, laid out by its own script, then printed by Chromium to a PDF — the way an edition's
// pages print (src/main/edition-print.ts). Export to PDF, Save as PDF and Email it all print through here, so one
// document, one path.
//
// The window runs only that document's own script: no preload, sandboxed, no way out to other pages; it is closed as
// soon as the pages are printed, and the document's file (in Ironleaf's own data folder, never the vault) goes with it.

import { BrowserWindow, session } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BrandLaidOut } from '../shared/brand-document';
import { SLIDE_READ_JS, type SlidePage } from '../shared/design-slides';
import { fileUrlPath } from './file-url-guard';

export interface BrandPrinter {
  /** The document laid out and printed to a PDF: its bytes and how the pages laid out. */
  pdf(html: string): Promise<{ pdf: Buffer; laidOut: BrandLaidOut }>;
  /** The document laid out and looked at (the Design studio, 22 Nov 2026): what its own script measured, and its pages
   *  as pictures (JPEG), from the boxes the script reported, at most `max` of them. The window is the page's width. */
  look(html: string, o: { width: number; height: number; max: number; png?: boolean }): Promise<{ report: BrandLaidOut & Record<string, unknown>; shots: Buffer[] }>;
  /** A designed deck read back for PowerPoint (phase 2): each page's words and boxes, then its picture without the
   *  words, at twice the resolution (src/shared/design-slides.ts). */
  slides(html: string, o: { width: number; height: number }): Promise<{ page: SlidePage; background: Buffer }[]>;
}

const LAYOUT_MS = 45_000;

/** A print file's name, with the process that made it: `brand-<pid>-<ms>-<n>.html`. */
const PRINT_FILE = /^brand-(\d+)-\d+-\d+\.html$/;

/** Stale print files swept (Nov 2026 review: the app dying mid-print left its html file in the data folder):
 *  a print file whose process is gone is removed, so the folder never fills with them. The next print sweeps;
 *  files of live processes (this run's, a print still going in another) are kept, as is anything else in the
 *  folder. Returns how many went. A missing folder sweeps to nothing, never throwing. */
export async function sweepBrandDir(dir: string, pid = process.pid): Promise<number> {
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  let swept = 0;
  for (const f of files) {
    const m = PRINT_FILE.exec(f);
    if (!m) continue;
    const maker = Number(m[1]);
    if (maker === pid) continue;
    let alive = true;
    try {
      process.kill(maker, 0);
    } catch (e) {
      alive = (e as NodeJS.ErrnoException)?.code !== 'ESRCH';
    }
    if (alive) continue;
    await fsp.rm(path.join(dir, f), { force: true }).catch(() => {});
    swept++;
  }
  return swept;
}

export function createBrandPrinter(o: { dir: string; log?: (m: string) => void }): BrandPrinter {
  let n = 0;
  // The print window's own session, sealed once: the document is laid out from its own bytes and the vault's own
  // files, so nothing remote is ever fetched (a tracking pixel in a note phones nobody home) and no permission is
  // ever granted. Its own partition, so the block touches only printing, never the app's window.
  let sealed = false;
  const seal = () => {
    if (sealed) return;
    sealed = true;
    const ses = session.fromPartition('brand-print');
    ses.webRequest.onBeforeRequest((d, cb) => {
      const u = d.url;
      // A file: address naming another computer (file://host/…, a UNC path) is refused like anything remote: on
      // Windows it would send this PC's sign-in to that host (src/main/file-url-guard.ts).
      if ((u.startsWith('file:') && fileUrlPath(u, process.platform) !== null) || u.startsWith('data:') || u === 'about:blank') cb({});
      else cb({ cancel: true });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  };
  /** The document opened in a sealed window nobody sees, laid out by its own script; `use` runs once its report is in. */
  const open = async <T>(html: string, size: { width: number; height: number }, use: (w: BrowserWindow, r: BrandLaidOut & Record<string, unknown>) => Promise<T>): Promise<T> => {
    await fsp.mkdir(o.dir, { recursive: true });
    await sweepBrandDir(o.dir).catch(() => {});
    seal();
    const file = path.join(o.dir, `brand-${process.pid}-${Date.now()}-${++n}.html`);
    await fsp.writeFile(file, html, 'utf8');
    const w = new BrowserWindow({ show: false, width: size.width, height: size.height, useContentSize: true, webPreferences: { partition: 'brand-print', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false, spellcheck: false, webviewTag: false } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await w.loadFile(file);
      const started = Date.now();
      for (;;) {
        const r = (await w.webContents.executeJavaScript('window.__report || null', true)) as (BrandLaidOut & Record<string, unknown>) | null;
        if (r) {
          if (r.cut?.length) o.log?.(`brand print: ${r.cut.length} block${r.cut.length === 1 ? ' is' : 's are'} taller than a page and kept whole (${r.cut.slice(0, 3).join('; ')})`);
          return await use(w, r);
        }
        if (Date.now() - started > LAYOUT_MS) throw new Error('The document took too long to lay out (a picture or font in it may not open).');
        await new Promise((res) => setTimeout(res, 120));
      }
    } finally {
      if (!w.isDestroyed()) w.destroy();
      await fsp.rm(file, { force: true }).catch(() => {});
    }
  };
  return {
    pdf: (html) =>
      open(html, { width: 1000, height: 1300 }, async (w, r) => {
        const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, generateDocumentOutline: true });
        return { pdf, laidOut: r };
      }),
    look: (html, size) =>
      open(html, { width: Math.max(200, Math.min(2400, Math.ceil(size.width))), height: Math.max(200, Math.min(2400, Math.ceil(size.height))) }, async (w, r) => {
        const boxes = (Array.isArray(r.boxes) ? r.boxes : []) as { x: number; y: number; w: number; h: number }[];
        const shots: Buffer[] = [];
        for (const b of boxes.slice(0, Math.max(0, size.max))) {
          if (![b.x, b.y, b.w, b.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || b.w < 10 || b.h < 10) continue;
          const sy = Number(await w.webContents.executeJavaScript(`(window.scrollTo(0, ${Math.max(0, Math.floor(b.y))}), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))))`, true)) || 0;
          const img = await w.webContents.capturePage({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y - sy)), width: Math.round(b.w), height: Math.round(Math.min(b.h, size.height)) });
          if (!img.isEmpty()) shots.push(size.png ? img.toPNG() : img.toJPEG(78));
        }
        return { report: r, shots };
      }),
    slides: (html, size) =>
      open(html, { width: Math.max(200, Math.min(2400, Math.ceil(size.width))), height: Math.max(200, Math.min(2400, Math.ceil(size.height))) }, async (w) => {
        const pages = (await w.webContents.executeJavaScript(SLIDE_READ_JS, true)) as SlidePage[];
        // Twice the pixels for the pictures, the layout unchanged: the window doubled and the page zoomed to 2, so the
        // page is still as many CSS pixels wide (Electron's device emulation doesn't change what capturePage returns).
        const [cw, ch] = [Math.ceil(size.width), Math.ceil(size.height)];
        w.setContentSize(cw * 2, ch * 2);
        w.webContents.setZoomFactor(2);
        // Until the page is drawn at the new zoom (its pixel ratio 2, its width the same CSS pixels), or about 3 s.
        for (let i = 0; i < 60; i++) {
          const [iw, dpr] = ((await w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => r([window.innerWidth, window.devicePixelRatio])))', true)) as number[]) ?? [0, 0];
          if (dpr >= 1.99 && Math.abs(iw - cw) <= 2) break;
          await new Promise((res) => setTimeout(res, 50));
        }
        const out: { page: SlidePage; background: Buffer }[] = [];
        for (const page of (Array.isArray(pages) ? pages : []).slice(0, MAX_SLIDES)) {
          if (![page.x, page.y, page.w, page.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || page.w < 10 || page.h < 10) continue;
          const sy = Number(await w.webContents.executeJavaScript(`(window.scrollTo(0, ${Math.max(0, Math.floor(page.y))}), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.scrollY)))))`, true)) || 0;
          const img = await w.webContents.capturePage({ x: Math.max(0, Math.round(page.x * 2)), y: Math.max(0, Math.round((page.y - sy) * 2)), width: Math.round(page.w * 2), height: Math.round(Math.min(page.h, ch) * 2) });
          if (!img.isEmpty()) out.push({ page, background: img.toPNG() });
        }
        return out;
      }),
  };
}

/** The most slides a deck is read back for (a deck longer than this is a document). */
const MAX_SLIDES = 40;
