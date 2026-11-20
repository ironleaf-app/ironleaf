// One page of the PDF reader: the page drawn sharp at its zoom, its words laid over it by PDF.js (invisible, so they can
// be selected and copied as in any app), and below the words the person's highlights and the find marks, placed from
// the PDF's own units so they sit over the same words at any zoom (19 Oct 2026, 5.0.0 PDF reader). Pages far from view
// let their drawing go, so a long PDF stays light. In clip mode (31 Oct 2026, 8.9) a box drawn on the page is reported
// back, to be kept as a pictured clip.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PdfHighlight } from '../../../../shared/pdf-highlights';
import type { OcrLine } from '../../../../shared/ocr';
import { locate as locateIn, ocrPageText, pageText, pdfToBox, type Box, type Matrix, type PageText } from './geometry';
import { pageTextContent, pdfjsFull, type PdfDocument, type PdfPage as PdfPageProxy, type PdfViewport } from './pdfDoc';
import { askToDraw } from './drawQueue';

/** What the reader needs from a drawn page to turn a selection into a highlight. */
export interface PageHandle {
  el: HTMLDivElement;
  text: HTMLDivElement;
  matrix: Matrix;
  words: PageText | null;
}

export interface PageMatch {
  start: number;
  end: number;
  current: boolean;
}

interface Props {
  path: string;
  doc: PdfDocument;
  index: number;
  scale: number;
  width: number;
  height: number;
  live: boolean;
  /** On screen now (not just near it): drawn sharp, and first. A live page beside the view gets a quick drawing. */
  visible: boolean;
  highlights: PdfHighlight[];
  flash: string | null;
  matches: PageMatch[];
  register(index: number, handle: PageHandle | null): void;
  /** Clip mode: a box drawn on the page is reported back (in CSS pixels from the page's top left). */
  clip: boolean;
  onClip(index: number, box: Box): void;
  /** The page's recognised lines (a scan's): the words layer when the page has no words of its own. */
  ocr: OcrLine[] | null;
}

/** A page in view is drawn at up to this many pixels (a wide screen's Fit width page is more: it is drawn a little
 *  softer rather than holding the window), a page beside the view at far fewer (a quick drawing, made sharp when it
 *  scrolls into view). */
const SHARP_PIXELS = 8_000_000;
const NEAR_PIXELS = 1_500_000;

/** How long a zoom must hold still before the words are laid again at the new size. */
const SETTLE_MS = 180;

function PdfPageView({ path, doc, index, scale, width, height, live, visible, highlights, flash, matches, register, clip, onClip, ocr }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Two canvases: the one shown, and the one the next drawing goes into, shown when it is done (no copy of millions
  // of pixels from a scratch canvas, and no blank page in between).
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const [front, setFront] = useState<0 | 1>(0);
  /** What the shown canvas holds: its scale and how many pixels it was drawn at. */
  const shown = useRef<{ scale: number; pixels: number } | null>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PdfPageProxy | null>(null);
  /** A box being drawn for a clip: its start (in CSS pixels from the page's top left) and its box now. */
  const [drag, setDrag] = useState<{ ox: number; oy: number } | null>(null);
  const [band, setBand] = useState<Box | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [words, setWords] = useState<{ scale: number; text: PageText; spans: HTMLElement[] } | null>(null);
  const [findBoxes, setFindBoxes] = useState<(Box & { current: boolean })[]>([]);

  useEffect(() => {
    if (!live || page) return;
    let ok = true;
    void doc.getPage(index + 1).then((p) => ok && setPage(p), () => {});
    return () => {
      ok = false;
    };
  }, [live, doc, index, page]);

  const viewport: PdfViewport | null = page ? page.getViewport({ scale }) : null;

  // The drawing, at this zoom (a new zoom draws again, the old drawing showing stretched until then). A page in view is
  // drawn sharp; one beside it quickly, at few pixels; and every page waits its turn (drawQueue.ts), the one in view first.
  useEffect(() => {
    const shownCanvas = (front === 0 ? canvasA : canvasB).current;
    const back = (front === 0 ? canvasB : canvasA).current;
    if (!shownCanvas || !back) return;
    if (!live || !page || !viewport) {
      // Far from view: the drawing goes (it is made again on the way back).
      for (const c of [shownCanvas, back]) {
        c.width = 0;
        c.height = 0;
      }
      shown.current = null;
      setDrawn(false);
      return;
    }
    const budget = visible ? SHARP_PIXELS : NEAR_PIXELS;
    const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(budget / Math.max(1, viewport.width * viewport.height)));
    const pixels = Math.floor(viewport.width * ratio) * Math.floor(viewport.height * ratio);
    const have = shown.current;
    // Already shown at this zoom, at least this sharp: nothing to draw (a page scrolled out of view keeps its sharp drawing).
    if (have && have.scale === scale && have.pixels >= pixels) return;
    let task: { promise: Promise<void>; cancel(): void } | null = null;
    let ticket: { cancel(): void } | null = null;
    const timer = setTimeout(() => {
      ticket = askToDraw(
        visible ? 0 : 1,
        async () => {
          back.width = Math.max(1, Math.floor(viewport.width * ratio));
          back.height = Math.max(1, Math.floor(viewport.height * ratio));
          const ctx = back.getContext('2d', { alpha: false });
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, back.width, back.height);
          task = page.render({ canvasContext: ctx, viewport, background: '#ffffff', transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
          await task.promise;
          shown.current = { scale, pixels: back.width * back.height };
          // The finished drawing comes forward; the old one lets its memory go.
          setFront((f) => (f === 0 ? 1 : 0));
          setDrawn(true);
        },
        () => task?.cancel(),
      );
    }, drawn ? 120 : 0);
    return () => {
      clearTimeout(timer);
      ticket?.cancel();
    };
  }, [live, visible, page, scale]);

  // The canvas that went to the back frees its pixels once the new one shows.
  useEffect(() => {
    const back = (front === 0 ? canvasB : canvasA).current;
    if (back && back.width) {
      back.width = 0;
      back.height = 0;
    }
  }, [front]);

  // The words, laid over the drawing by PDF.js so they can be selected, copied and found. A page without words of
  // its own (a scan) instead lays its recognised lines, one span per line in the same order as ocrPageText, so
  // selecting, copying, finding and highlighting work the same as on any other page.
  useEffect(() => {
    const el = textBox.current;
    if (!el || !live || !page || !viewport) {
      if (el) el.replaceChildren();
      setWords(null);
      return;
    }
    let ok = true;
    let layer: { cancel(): void } | null = null;
    // A zoom changes the scale many times a second (each wheel step, each key): the words are laid again once it has
    // settled, not for every step on the way (PDF.js measures every word, and doing that per step held the window).
    const lay = async () => {
      try {
        const [m, content] = await Promise.all([pdfjsFull(), pageTextContent(path, doc, index + 1)]);
        if (!ok) return;
        const hasWords = content.items.some((it) => typeof it.str === 'string' && it.str.trim());
        if (!hasWords && ocr?.length) {
          el.replaceChildren();
          const spans: HTMLElement[] = [];
          for (const line of ocr) {
            const s = document.createElement('span');
            s.textContent = line.text;
            const left = line.box[0] * width;
            const top = line.box[1] * height;
            const w = line.box[2] * width;
            const h = Math.max(4, line.box[3] * height);
            s.style.left = `${left}px`;
            s.style.top = `${top}px`;
            s.style.width = `${w}px`;
            s.style.height = `${h}px`;
            s.style.fontSize = `${h}px`;
            s.style.lineHeight = `${h}px`;
            el.append(s);
            spans.push(s);
            el.append(document.createElement('br'));
          }
          // Each line's words stretched across its box (as PDF.js stretches its own), so selections sit on the words.
          spans.forEach((s, i) => {
            const want = (ocr[i]?.box[2] ?? 0) * width;
            const have = s.scrollWidth;
            if (have > 1 && want > 1) s.style.transform = `scaleX(${Math.min(5, Math.max(0.2, want / have))})`;
          });
          const end = document.createElement('div');
          end.className = 'endOfContent';
          el.append(end);
          setWords({ scale, text: ocrPageText(ocr), spans });
          return;
        }
        // Laid off the page, then put in at once: PDF.js adds a span per word (thousands on a newspaper page), and each
        // one added to the live page made the window re-check its style rules (the :has() ones especially) for the
        // page around it. Built apart, the words cost one check when they go in (21 Nov 2026: a zoom on a 24-page
        // paper spent 1.9 s in style work, 0.03 s without that).
        const fresh = document.createElement('div');
        fresh.className = el.className;
        fresh.style.setProperty('--scale-factor', String(viewport.scale));
        fresh.style.setProperty('--user-unit', String(viewport.userUnit || 1));
        const tl = new m.TextLayer({ textContentSource: content, container: fresh, viewport });
        layer = tl;
        await tl.render();
        if (!ok) return;
        // The space after the last word: dragging past the words keeps the selection steady (as in PDF.js's viewer).
        const end = document.createElement('div');
        end.className = 'endOfContent';
        fresh.append(end);
        for (const prop of ['--scale-factor', '--user-unit']) el.style.setProperty(prop, fresh.style.getPropertyValue(prop));
        if (fresh.style.width) el.style.width = fresh.style.width;
        if (fresh.style.height) el.style.height = fresh.style.height;
        el.replaceChildren(...fresh.childNodes);
        setWords({ scale, text: pageText(content.items), spans: tl.textDivs });
      } catch {
        // A page without words (a scan) still reads; it just can't be selected.
      }
    };
    const settle = setTimeout(() => void lay(), words ? SETTLE_MS : 0);
    return () => {
      ok = false;
      clearTimeout(settle);
      layer?.cancel();
    };
  }, [live, page, scale, ocr, width, height]);

  // Find marks: each match's letters measured where PDF.js laid them.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !words || !matches.length) return setFindBoxes([]);
    const origin = el.getBoundingClientRect();
    const out: (Box & { current: boolean })[] = [];
    const range = document.createRange();
    for (const m of matches) {
      const a = locateIn(words.text, m.start, 'start');
      const b = locateIn(words.text, m.end, 'end');
      if (!a || !b) continue;
      const startNode = words.spans[a.item]?.firstChild;
      const endNode = words.spans[b.item]?.firstChild;
      if (!startNode || !endNode) continue;
      try {
        range.setStart(startNode, Math.min(a.char, startNode.textContent?.length ?? 0));
        range.setEnd(endNode, Math.min(b.char, endNode.textContent?.length ?? 0));
      } catch {
        continue;
      }
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        out.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top, current: m.current });
      }
    }
    setFindBoxes(out);
  }, [words, matches]);

  // The reader is told where this page's words are while they're on screen.
  useEffect(() => {
    if (!box.current || !textBox.current || !viewport || !words) {
      register(index, null);
      return;
    }
    register(index, { el: box.current, text: textBox.current, matrix: viewport.transform, words: words.text });
    return () => register(index, null);
  }, [words, register, index]);

  // Leaving clip mode puts a half-drawn box away.
  useEffect(() => {
    if (!clip) {
      setDrag(null);
      setBand(null);
    }
  }, [clip]);

  // A box drawn for a clip, followed on the window (the pointer may leave the page mid-draw), kept on the page.
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      setBand({ left: Math.min(drag.ox, x), top: Math.min(drag.oy, y), right: Math.max(drag.ox, x), bottom: Math.max(drag.oy, y) });
    };
    const up = (e: MouseEvent) => {
      const rect = box.current?.getBoundingClientRect();
      setDrag(null);
      setBand(null);
      if (!rect) return;
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const made: Box = { left: Math.min(drag.ox, x), top: Math.min(drag.oy, y), right: Math.max(drag.ox, x), bottom: Math.max(drag.oy, y) };
      // A click, not a box: nothing to clip.
      if (made.right - made.left > 8 && made.bottom - made.top > 8) onClip(index, made);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, index, onClip]);

  const matrix = viewport?.transform;
  return (
    <div
      ref={box}
      className={`pdfv-page${drawn ? ' is-drawn' : ''}`}
      data-page={index + 1}
      style={{ width, height }}
      aria-label={`Page ${index + 1}`}
      onMouseDown={
        clip
          ? (e) => {
              if (e.button !== 0 || !box.current) return;
              // A box, not words: no selection starts, and the reader's own press (selections, cards) stays out.
              e.preventDefault();
              e.stopPropagation();
              const rect = box.current.getBoundingClientRect();
              const ox = e.clientX - rect.left;
              const oy = e.clientY - rect.top;
              setDrag({ ox, oy });
              setBand({ left: ox, top: oy, right: ox, bottom: oy });
            }
          : undefined
      }
    >
      <canvas ref={canvasA} className={`pdfv-canvas${front === 0 ? '' : ' is-back'}`} style={{ width, height }} />
      <canvas ref={canvasB} className={`pdfv-canvas${front === 1 ? '' : ' is-back'}`} style={{ width, height }} />
      {!drawn && <span className="pdfv-page-wait">{index + 1}</span>}
      <div className="pdfv-marks" aria-hidden>
        {matrix &&
          highlights.flatMap((h) =>
            h.rects.map((r, i) => {
              const b = pdfToBox(matrix, r);
              return (
                <div
                  key={`${h.id}:${i}`}
                  className={`pdfv-hl pdfv-hl-${h.colour}${flash === h.id ? ' is-flash' : ''}${h.note ? ' has-note' : ''}${h.image ? ' is-clip' : ''}`}
                  data-hl={h.id}
                  style={{ left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top }}
                />
              );
            }),
          )}
        {findBoxes.map((b, i) => (
          <div key={`f${i}`} className={`pdfv-find-mark${b.current ? ' is-current' : ''}`} style={{ left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top }} />
        ))}
        {matrix &&
          highlights
            .filter((h) => h.note)
            .map((h) => {
              const b = pdfToBox(matrix, h.rects[0]);
              // In the page's own margin, level with the highlight's first line, so it never sits on a word.
              return <span key={`n${h.id}`} className={`pdfv-note-pin pdfv-hl-${h.colour}`} style={{ left: Math.min(10, Math.max(3, b.left / 2 - 4)), top: b.top + (b.bottom - b.top) / 2 - 7 }} />;
            })}
      </div>
      <div ref={textBox} className={`pdfv-text textLayer${words && words.scale !== scale ? ' is-stale' : ''}`} />
      {band && <div className="pdfv-band" aria-hidden style={{ left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top }} />}
    </div>
  );
}

export const PdfPage = memo(PdfPageView);
