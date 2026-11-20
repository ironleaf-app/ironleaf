// A PDF's first page as a small picture, for the project Files grid, the Assets page and canvas cards. PDF.js (bundled
// in assets/pdfjs, Apache-2.0; see ASSETS.md) is loaded only when the first PDF tile comes on screen; each PDF is drawn
// once (the main side keeps the picture by the file's path, time and size), two at a time, and a broken or protected PDF
// keeps its designed tile.

import { useEffect, useRef, useState } from 'react';
import pdfUrl from '../assets/pdfjs/pdf.min.mjs?url';
import workerUrl from '../assets/pdfjs/pdf.worker.min.mjs?url';

/** A PDF in a project's folder (on a remote computer, `version` names the file's time and size), or in the library. */
export type PdfWhere = { project: string; file: string; version?: string } | { rel: string };

/** The longest side of the picture, in pixels (sharp on a high-density screen at tile size). */
const LONGEST = 520;

export interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableAutoFetch?: boolean; disableStream?: boolean; stopAtErrors?: boolean }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPageProxy> }>;
    destroy(): Promise<void>;
  };
}
export interface PdfPageProxy {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; background?: string }): { promise: Promise<void> };
}

let lib: Promise<PdfJs> | null = null;
export function pdfjs(): Promise<PdfJs> {
  lib ??= import(/* @vite-ignore */ pdfUrl).then((m: PdfJs) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return lib;
}

/** Draws page one of a PDF's bytes to a small WebP (null when it can't be drawn). Exported for checks. */
export async function drawFirstPage(bytes: Uint8Array): Promise<Uint8Array | null> {
  const m = await pdfjs();
  const task = m.getDocument({ data: bytes, isEvalSupported: false, disableAutoFetch: true, disableStream: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, LONGEST / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    // The document and its worker's copy let go (the loading task owns them).
    void task.destroy().catch(() => {});
  }
}

const known = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;
const slot = () => (running < 2 ? (running++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => (running++, r()))));
const free = () => {
  running--;
  waiting.shift()?.();
};

/** What one PDF is called here (its place, and when it last changed, so a changed PDF is drawn again). */
const nameOf = (where: PdfWhere, version: number | string) => `${'rel' in where ? where.rel : `${where.project}\u0000${where.file}`}\u0000${version}`;

/** A PDF's first page as a picture URL, or null (it can't be drawn: its designed tile stays). */
export function pdfFirstPage(where: PdfWhere, version: number | string = 0): Promise<string | null> {
  const name = nameOf(where, version);
  let p = known.get(name);
  if (!p) {
    p = (async () => {
      const page = await window.nv.pdf.page(where).catch(() => ({ failed: true }) as const);
      if ('url' in page) return page.url;
      if ('failed' in page) return null;
      await slot();
      try {
        const picture = await drawFirstPage(page.bytes).catch(() => null);
        return await window.nv.pdf.save(page.key, picture).catch(() => null);
      } finally {
        free();
      }
    })();
    if (known.size > 600) known.delete(known.keys().next().value!);
    known.set(name, p);
  }
  return p;
}

/** A PDF's first page for a tile, asked for only once the tile is on screen: undefined while waiting, null if none. */
export function usePdfFirstPage(where: PdfWhere | null, version: number | string = 0): { ref: React.RefObject<HTMLElement | null>; url: string | null | undefined } {
  const ref = useRef<HTMLElement | null>(null);
  const key = where ? nameOf(where, version) : '';
  const [state, setState] = useState<{ key: string; url: string | null | undefined }>({ key: '', url: undefined });
  useEffect(() => {
    if (!where) return;
    let alive = true;
    const el = ref.current;
    const go = () => void pdfFirstPage(where, version).then((url) => alive && setState({ key, url }));
    if (!el) {
      go();
      return () => void (alive = false);
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      go();
    });
    seen.observe(el);
    return () => {
      alive = false;
      seen.disconnect();
    };
  }, [key]);
  return { ref, url: where ? (state.key === key ? state.url : undefined) : null };
}
