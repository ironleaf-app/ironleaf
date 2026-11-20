// A PDF's pages drawn here with PDF.js (bundled, Apache-2.0; see ASSETS.md), for a PDF on a remote computer: its bytes
// come through the former host app, so there is no file on this PC for Chromium's own viewer to open. Each page is
// drawn as it comes into view, at the width it is shown, sharp on a high-density screen.

import { useEffect, useRef, useState } from 'react';
import { pdfjs, type PdfPageProxy } from './pdfThumb';

const MAX_PAGES = 200;

function Page({ doc, n, width }: { doc: { getPage(n: number): Promise<PdfPageProxy> }; n: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    let live = true;
    void doc.getPage(n).then((page) => {
      const v = page.getViewport({ scale: 1 });
      if (live) setRatio(v.height / Math.max(1, v.width));
    });
    return () => {
      live = false;
    };
  }, [doc, n]);
  useEffect(() => {
    const el = holder.current;
    if (!el || !width) return;
    let live = true;
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen.disconnect();
        void doc.getPage(n).then(async (page) => {
          const c = canvas.current;
          if (!live || !c) return;
          const base = page.getViewport({ scale: 1 });
          const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / Math.max(1, base.width);
          const viewport = page.getViewport({ scale });
          c.width = Math.round(viewport.width);
          c.height = Math.round(viewport.height);
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise.catch(() => undefined);
          if (live) setDrawn(true);
        });
      },
      { rootMargin: '400px 0px' },
    );
    seen.observe(el);
    return () => {
      live = false;
      seen.disconnect();
    };
  }, [doc, n, width]);
  return (
    <div className={`pdfp-page${drawn ? ' is-drawn' : ''}`} ref={holder} style={{ width, height: Math.round(width * ratio) }} aria-label={`Page ${n}`}>
      <canvas ref={canvas} style={{ width, height: Math.round(width * ratio) }} />
    </div>
  );
}

/** The pages of a PDF whose bytes `load` gives; `words` says what to show when it can't be drawn. */
export function PdfPages({ load, name, big, onFail }: { load: () => Promise<Uint8Array>; name: string; big?: boolean; onFail?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<{ numPages: number; getPage(n: number): Promise<PdfPageProxy> } | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let live = true;
    let destroy: (() => void) | null = null;
    void (async () => {
      try {
        const [m, bytes] = await Promise.all([pdfjs(), load()]);
        const task = m.getDocument({ data: bytes, isEvalSupported: false });
        destroy = () => void task.destroy().catch(() => {});
        const d = await task.promise;
        if (live) setDoc(d);
      } catch {
        if (live) onFail?.();
      }
    })();
    return () => {
      live = false;
      destroy?.();
    };
  }, [name]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setWidth(Math.max(120, Math.min(big ? 980 : 760, el.clientWidth - (big ? 64 : 28)))));
    seen.observe(el);
    return () => seen.disconnect();
  }, [big]);
  const pages = doc ? Math.min(doc.numPages, MAX_PAGES) : 0;
  return (
    <div className={`pf-view pdfp${big ? ' is-big' : ''}${doc ? '' : ' pf-loading'}`} ref={box} aria-label={`${name}, ${doc ? `${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}` : 'loading'}`}>
      {doc && width > 0 && Array.from({ length: pages }, (_, i) => <Page key={i} doc={doc} n={i + 1} width={width} />)}
      {doc && doc.numPages > MAX_PAGES && <p className="pf-more">The first {MAX_PAGES} pages of {doc.numPages}.</p>}
    </div>
  );
}
