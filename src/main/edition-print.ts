// An edition's pages printed (Publications, Wave 6 part a, 24 Oct 2026): the edition's own document
// (src/shared/edition-doc.ts) opened in a window nobody sees, laid out by its script, then printed by Chromium — to a PDF
// (the app's PDF path, as Export to PDF uses), or to a printer by its name on this PC. The studio shows the very same
// document, so what it says fits is what comes out.
//
// The window runs only that document's own script: no preload, sandboxed, no way out to other pages; it is closed as
// soon as the pages are printed, and the document's file (in Ironleaf's own data folder, never the vault) goes with it.

import { BrowserWindow } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LaidOut } from '../shared/edition-doc';

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: number;
}

export interface EditionPrinter {
  /** The document laid out and printed to a PDF: its bytes and how each section filled. */
  pdf(html: string): Promise<{ pdf: Buffer; laidOut: LaidOut }>;
  /** The document laid out and sent to a printer by its name (silently, as many copies as asked). */
  print(html: string, o: { printer: string; copies?: number }): Promise<LaidOut>;
  /** The printers this PC has (empty when it has none, or can't say). */
  printers(): Promise<PrinterInfo[]>;
  /** The document written where the studio's frame can show it (a file in Ironleaf's data folder): its address. */
  stage(html: string, key: string): Promise<string>;
}

const LAYOUT_MS = 45_000;

export function createEditionPrinter(o: { dir: string; log?: (m: string) => void }): EditionPrinter {
  let n = 0;
  const write = async (html: string, name: string) => {
    await fsp.mkdir(o.dir, { recursive: true });
    const file = path.join(o.dir, name);
    await fsp.writeFile(file, html, 'utf8');
    return file;
  };
  const open = async (html: string): Promise<{ w: BrowserWindow; file: string; laidOut: LaidOut }> => {
    const file = await write(html, `print-${process.pid}-${Date.now()}-${++n}.html`);
    const w = new BrowserWindow({ show: false, width: 1000, height: 1300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, backgroundThrottling: false, spellcheck: false, webviewTag: false } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    try {
      await w.loadFile(file);
      const started = Date.now();
      for (;;) {
        const r = (await w.webContents.executeJavaScript('window.__report || null', true)) as LaidOut | null;
        if (r) return { w, file, laidOut: r };
        if (Date.now() - started > LAYOUT_MS) throw new Error('The edition’s pages took too long to lay out (a picture or font in it may not open).');
        await new Promise((res) => setTimeout(res, 120));
      }
    } catch (e) {
      if (!w.isDestroyed()) w.destroy();
      await fsp.rm(file, { force: true }).catch(() => {});
      throw e;
    }
  };
  const close = async (w: BrowserWindow, file: string) => {
    if (!w.isDestroyed()) w.destroy();
    await fsp.rm(file, { force: true }).catch(() => {});
  };
  return {
    async pdf(html) {
      const { w, file, laidOut } = await open(html);
      try {
        const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, generateDocumentOutline: false });
        return { pdf, laidOut };
      } finally {
        await close(w, file);
      }
    },
    async print(html, p) {
      if (!p.printer) throw new Error('No printer is chosen for this publication (Publications › Settings › Delivery).');
      const list = await this.printers();
      const found = list.find((x) => x.name === p.printer) ?? list.find((x) => x.displayName === p.printer) ?? list.find((x) => x.name.toLowerCase().includes(p.printer.toLowerCase()) || x.displayName.toLowerCase().includes(p.printer.toLowerCase()));
      if (!found) throw new Error(list.length ? `The printer “${p.printer}” isn’t on this PC. It has: ${list.map((x) => x.displayName || x.name).join(', ')}.` : `This PC has no printers set up, so “${p.printer}” can’t be reached.`);
      const { w, file, laidOut } = await open(html);
      try {
        await new Promise<void>((resolve, reject) =>
          w.webContents.print({ silent: true, deviceName: found.name, copies: Math.max(1, Math.min(20, p.copies ?? 1)), printBackground: true, margins: { marginType: 'none' }, pageSize: 'A4' }, (ok, why) => (ok ? resolve() : reject(new Error(why === 'cancelled' ? 'The printing was cancelled.' : `The printer “${found.displayName || found.name}” didn’t take the pages${why ? ` (${why})` : ''}.`)))),
        );
        return laidOut;
      } finally {
        await close(w, file);
      }
    },
    async printers() {
      const w = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
      try {
        await w.loadURL('about:blank');
        const list = await w.webContents.getPrintersAsync();
        return list.map((x) => ({ name: x.name, displayName: x.displayName || x.name, isDefault: !!(x as { isDefault?: boolean }).isDefault, status: (x as { status?: number }).status ?? 0 }));
      } catch (e) {
        o.log?.(`printers: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      } finally {
        if (!w.isDestroyed()) w.destroy();
      }
    },
    async stage(html, key) {
      const safe = key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'edition';
      // A fresh name each time, so the frame never shows an older copy.
      const dir = path.join(o.dir, 'studio');
      await fsp.mkdir(dir, { recursive: true });
      for (const f of await fsp.readdir(dir).catch(() => [] as string[])) if (f.startsWith(`${safe}-`)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {});
      const file = path.join(dir, `${safe}-${Date.now()}.html`);
      await fsp.writeFile(file, html, 'utf8');
      return pathToFileURL(file).href;
    },
  };
}
