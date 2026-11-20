// A PDF in its own tab, read as well as in a PDF app and marked up like a book (19 Oct 2026: 5.0.0, "a PDF reader with
// highlights and notes"): pages one after another, zoom to the width, the page or a percentage, page pictures down the
// left, find with Ctrl+F, a page number to type, and words that select and copy. Selected words can be highlighted in
// four colours with a note; everything is kept in "<name> (highlights).md" beside the PDF
// (src/shared/pdf-highlights.ts), which the person owns and the PDF is never changed. [[name.pdf#page=4]] links open it
// at that page, and "&hl=<id>" flashes one highlight. In dark mode pages stay paper-white by default, with "Dim pages"
// to soften them (inverting a PDF spoils pictures and colours). PDF.js is bundled, so it all works offline. (31 Oct
// 2026, 8.9): a box drawn round a picture or a scanned part clips it as a picture into the highlights note, and a PDF
// without words says so, offering the former host app's make-searchable path when inside it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clipImageName, highlightShareBlock, newHighlightId, parsePdfAnchor, scanReadingNotice, scannedPdfNotice, sidecarPathFor, type PdfColour, type PdfHighlight, type PdfRect } from '../../../../shared/pdf-highlights';
import type { OcrLine } from '../../../../shared/ocr';
import { Icon } from '../../components/Icon';
import { openMenu, type MenuItem } from '../../components/Menu';
import { pickFile } from '../../components/Pickers';
import { headerOverflowHidden, overflowMenuItems } from '../../lib/headerOverflow';
import { linkTarget } from '../../lib/links';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { onReveal, setWorkspace, takeReveal } from '../../state/layout';
import * as W from '../../state/workspace';
import { fileMenu } from '../../state/menus';
import { useOcrStatus } from '../../state/ocr';
import { getState, showError, toast } from '../../state/store';
import type { TabState } from '../../state/workspace';
import { ViewHeader } from '../ViewHeader';
import { boxToPdf, CSS_PER_POINT, findAll, ocrPageText, pageText, pdfToBox, scaleFor, stepZoom, toScreen, viewportMatrix, ZOOM_STEPS, type Box, type Match, type Zoom } from './geometry';
import { FindBar, HighlightCard, HighlightsPanel, SelectionBar, Thumbs } from './PdfParts';
import { PdfPage, type PageHandle, type PageMatch } from './PdfPage';
import { holdPdf, pageTextContent, releasePdf, type PdfDocument } from './pdfDoc';
import { selectedParts, type SelectedPart } from './selection';
import { useHighlights } from './useHighlights';

/** Room around and between pages, in CSS pixels (the layout below uses the same numbers). */
const PAD = 20;
const GAP = 14;
const SIDE = 24;

interface PageInfo {
  /** Size at scale 1, turned as the PDF says. */
  w: number;
  h: number;
  view: [number, number, number, number];
  rotate: number;
  userUnit: number;
}

/** Per-window choices: the rail, the highlights list, dim pages (remembered in this window's own storage). */
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`nv-pdf-${key}`);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function remember(key: string, on: boolean): void {
  try {
    localStorage.setItem(`nv-pdf-${key}`, on ? '1' : '0');
  } catch {}
}

/** Each PDF's zoom while the app is open (a PDF opened again comes back as it was). */
const zooms = new Map<string, Zoom>();
const NO_MATCHES: PageMatch[] = [];
const NO_HIGHLIGHTS: PdfHighlight[] = [];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function PdfView({ tab }: { tab: TabState }) {
  const path = tab.path!;
  const hl = useHighlights(path);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [zoom, setZoomState] = useState<Zoom>(() => zooms.get(path) ?? 'width');
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(0);
  const [live, setLive] = useState<[number, number]>([0, 2]);
  const [rail, setRail] = useState(() => remembered('rail', false));
  const [panel, setPanel] = useState(() => remembered('panel', false));
  const [dim, setDim] = useState(() => remembered('dim', false));
  const [pageBox, setPageBox] = useState<string | null>(null);
  const [find, setFind] = useState<{ query: string; matches: Match[]; at: number; busy: boolean } | null>(null);
  const [bar, setBar] = useState<{ parts: SelectedPart[]; x: number; y: number; above: number } | null>(null);
  const [card, setCard] = useState<{ id: string; x: number; y: number; above: number; focus: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastColour, setLastColour] = useState<PdfColour>('yellow');
  const [clip, setClip] = useState(false);
  // A PDF without words of its own: null (not one), 'pending' (its words are being read), 'ready' (they can be
  // selected and searched), 'unavailable' (they won't come: no recogniser, or they couldn't be read).
  const [scanOcr, setScanOcr] = useState<null | 'pending' | 'ready' | 'unavailable'>(null);
  // Each scanned page's recognised lines, by page (mixed PDFs too: their scanned pages read the same).
  const [ocrLayers, setOcrLayers] = useState<Record<number, OcrLine[]>>({});
  const layerKeys = useRef('');
  const ocrCache = useRef(new Map<number, Promise<{ state: string; lines: OcrLine[] }>>());
  // Each scanned page's lines as fractions of the page (to scroll a find match into view before its page is drawn).
  const ocrFrac = useRef(new Map<number, [number, number][]>());
  const ocrStatus = useOcrStatus();
  const ocrSettled = !ocrStatus || !ocrStatus.busy;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<number, PageHandle>());
  const texts = useRef<Promise<{ text: string; at: [number, number][]; starts: number[] }[]> | null>(null);
  const anchor = useRef<{ page: number; frac: number } | null>(null);
  const wantHl = useRef<string | null>(null);

  /** One page's recognised lines (read once, except while still being read: those are asked again as reading moves). */
  const ocrFor = (index: number): Promise<{ state: string; lines: OcrLine[] }> => {
    const have = ocrCache.current.get(index);
    if (have) return have;
    const p = window.nv.ocr.page(path, index + 1).then(
      (r) => {
        if (r.state === 'pending') ocrCache.current.delete(index);
        return r;
      },
      () => ({ state: 'failed', lines: [] }),
    );
    ocrCache.current.set(index, p);
    return p;
  };

  // The document, and every page's size (so the whole length is laid out before any page is drawn).
  useEffect(() => {
    let ok = true;
    setDoc(null);
    setFailed(null);
    void holdPdf(path).then(
      async (d) => {
        if (!ok) return;
        const first = await d.getPage(1);
        const info = (p: typeof first): PageInfo => {
          const v = p.getViewport({ scale: 1 });
          return { w: v.width, h: v.height, view: p.view, rotate: p.rotate, userUnit: p.userUnit || 1 };
        };
        const one = info(first);
        if (!ok) return;
        setPages(Array.from({ length: d.numPages }, () => one));
        setDoc(d);
        // The rest measured after the first is on screen (most PDFs have one page size anyway).
        const all = await Promise.all(Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1).then(info, () => one)));
        if (ok) setPages(all);
      },
      (err: unknown) => {
        if (!ok) return;
        // Read only to choose our own plain words: the error's own message is never shown (f10 rule 19).
        const why = String((err as { message?: unknown } | null)?.message ?? '');
        if (/too big/i.test(why)) setFailed('This PDF is too large to show here.');
        else if (/ENOENT|no such file/i.test(why)) setFailed('That file isn’t in your notes any more.');
        else if (/empty/i.test(why)) setFailed('This file is empty. There is nothing to show.');
        else if (/Only PDFs/i.test(why)) setFailed('Only PDFs open here.');
        else setFailed('This PDF can’t be shown here. It may be damaged or protected with a password.');
      },
    );
    return () => {
      ok = false;
      releasePdf(path);
      texts.current = null;
      ocrCache.current.clear();
      ocrFrac.current.clear();
      layerKeys.current = '';
    };
  }, [path]);

  // The room the pages have.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    seen.observe(el);
    return () => seen.disconnect();
  }, [doc]);

  // Each page's scale: fitted pages fit one by one (a landscape page in a portrait PDF fits the width too); a percentage
  // is the same for all.
  const scales = useMemo(() => pages.map((p) => (room.w ? scaleFor(zoom, p.w, p.h, room.w - 2 * SIDE, room.h - 2 * PAD) : 1)), [pages, zoom, room.w, room.h]);
  const sizes = useMemo(() => pages.map((p, i) => ({ w: Math.floor(p.w * scales[i]), h: Math.floor(p.h * scales[i]) })), [pages, scales]);
  /** The scale of the page being read (for the zoom shown and the steps in and out). */
  const scale = scales[current] ?? scales[0] ?? 1;
  const matrixOf = useCallback((i: number) => {
    const p = pages[i];
    return viewportMatrix(p.view, scales[i] ?? 1, p.rotate, p.userUnit).matrix;
  }, [pages, scales]);
  const tops = useMemo(() => {
    const out: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      out.push(y);
      y += s.h + GAP;
    }
    return out;
  }, [sizes]);

  /** The page at a height in the scrolled pages. */
  const pageAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return Math.max(0, lo);
    },
    [tops],
  );

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !tops.length) return;
    const top = el.scrollTop;
    const now = pageAt(top + el.clientHeight * 0.3);
    setCurrent((c) => (c === now ? c : now));
    const a = Math.max(0, pageAt(top) - 1);
    const b = Math.min(tops.length - 1, pageAt(top + el.clientHeight) + 1);
    setLive((l) => (l[0] === a && l[1] === b ? l : [a, b]));
    const p = pageAt(top);
    anchor.current = { page: p, frac: sizes[p] ? (top - tops[p]) / Math.max(1, sizes[p].h + GAP) : 0 };
  }, [tops, sizes, pageAt]);

  // A new zoom keeps the same place in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (el && a && tops[a.page] !== undefined) el.scrollTop = tops[a.page] + a.frac * (sizes[a.page].h + GAP);
    onScroll();
  }, [sizes]);

  const setZoom = (z: Zoom) => {
    zooms.set(path, z);
    setZoomState(z);
    // Chosen from the zoom menu: the keys come back to the PDF (Ctrl+0, Ctrl+F).
    if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true });
  };

  /** Shows a page, `y` pixels down it (at the current zoom), a little below the top of the view; with `x`, across to
   *  that place too when the page is wider than the view. */
  const goTo = useCallback(
    (index: number, y = 0, x?: number) => {
      const el = scroller.current;
      if (!el || tops[index] === undefined) return;
      const page = el.querySelector<HTMLElement>(`.pdfv-page[data-page="${index + 1}"]`);
      const left = x !== undefined && page && el.scrollWidth > el.clientWidth ? Math.max(0, page.offsetLeft + x - el.clientWidth * 0.3) : undefined;
      el.scrollTo({ top: Math.max(0, tops[index] + y - (y ? el.clientHeight * 0.3 : PAD / 2)), ...(left !== undefined ? { left } : {}) });
    },
    [tops],
  );

  /** Where a highlight is on screen within its page, at this zoom. */
  const highlightTop = useCallback(
    (h: PdfHighlight) => {
      const p = pages[h.page - 1];
      if (!p || !h.rects.length) return { top: 0, left: 0 };
      const m = matrixOf(h.page - 1);
      const boxes = h.rects.map((r) => pdfToBox(m, r));
      return { top: Math.min(...boxes.map((b) => b.top)), left: Math.min(...boxes.map((b) => b.left)) };
    },
    [pages, matrixOf],
  );

  const showHighlight = useCallback(
    (h: PdfHighlight) => {
      const at = highlightTop(h);
      goTo(h.page - 1, at.top, at.left);
      setFlash(h.id);
      setTimeout(() => setFlash((f) => (f === h.id ? null : f)), 1800);
    },
    [goTo, highlightTop],
  );

  // [[file.pdf#page=4&hl=…]]: opened here, now or when the tab is already showing this PDF.
  const reveal = useCallback(() => {
    const where = takeReveal(path);
    if (!where?.heading) return;
    const { page, hl: id, find: quote } = parsePdfAnchor(where.heading);
    if (id) {
      const h = hl.list.find((x) => x.id === id);
      if (h) return showHighlight(h);
      wantHl.current = id;
    }
    if (page) goTo(Math.min(page, pages.length) - 1);
    // A cited passage (notebook mode): its words found and marked, on its page when they are there.
    if (quote) findQuote.current(quote, page);
  }, [path, hl.list, showHighlight, goTo, pages.length]);
  useEffect(() => {
    if (doc && pages.length && room.w) reveal();
  }, [doc, !!pages.length, !!room.w]);
  useEffect(() => onReveal((p) => p === path && doc && setTimeout(reveal, 0)), [path, doc, reveal]);
  // A highlight asked for before the highlights note was read.
  useEffect(() => {
    const id = wantHl.current;
    if (!id) return;
    const h = hl.list.find((x) => x.id === id);
    if (h && doc && room.w) {
      wantHl.current = null;
      showHighlight(h);
    }
  }, [hl.list, doc, room.w]);

  // Find: every page's words read once, on the first search. A page without words of its own reads its recognised
  // lines instead, so find searches scans too.
  const allTexts = () => {
    if (!texts.current && doc) {
      texts.current = Promise.all(
        Array.from({ length: doc.numPages }, (_, i) =>
          pageTextContent(path, doc, i + 1).then(
            async (c) => {
              const t = pageText(c.items);
              // Where each run starts on the page, to scroll a match into view before its page is drawn.
              const at = c.items.filter((it) => typeof it.str === 'string').map((it): [number, number] => [it.transform?.[4] ?? 0, it.transform?.[5] ?? 0]);
              if (t.text.trim()) return { text: t.text, at, starts: t.starts };
              const ocr = await ocrFor(i);
              if (!ocr.lines.length) return { text: '', at: [], starts: [] as number[] };
              const ot = ocrPageText(ocr.lines);
              ocrFrac.current.set(
                i,
                ocr.lines.map((l): [number, number] => [l.box[0], l.box[1]]),
              );
              return { text: ot.text, at: [], starts: ot.starts };
            },
            () => ({ text: '', at: [], starts: [] as number[] }),
          ),
        ),
      );
    }
    return texts.current;
  };

  // A PDF without words (a scan) says so, and its scanned pages get their recognised lines: selectable, copyable and
  // findable like any other words. Checked again as reading moves, so words read while it is open appear by themselves.
  useEffect(() => {
    let ok = true;
    setScanOcr(null);
    if (!doc) return () => {
      ok = false;
    };
    void (async () => {
      const blank: boolean[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        try {
          const c = await pageTextContent(path, doc, i + 1);
          blank.push(!pageText(c.items).text.trim());
        } catch {
          blank.push(false);
        }
        if (!ok) return;
      }
      const scannedPages = blank.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
      if (!ok || !scannedPages.length) return;
      const layers: Record<number, OcrLine[]> = {};
      let pending = false;
      for (const i of scannedPages) {
        const r = await ocrFor(i);
        if (!ok) return;
        if (r.state === 'words' && r.lines.length) layers[i] = r.lines;
        else if (r.state === 'pending') pending = true;
      }
      if (!ok) return;
      setOcrLayers((prev) => {
        const a = Object.keys(prev);
        const b = Object.keys(layers);
        return a.length === b.length && b.every((k) => prev[Number(k)] === layers[Number(k)]) ? prev : layers;
      });
      // New words since find last read: it reads them too (and a search in progress runs again over them).
      const key = Object.keys(layers).sort().join(',');
      if (layerKeys.current !== key) {
        layerKeys.current = key;
        texts.current = null;
        if (find?.query.trim()) onQuery(find.query);
      }
      // The notice is for a PDF without words; a mixed PDF reads as a normal one, its scanned pages with words too.
      if (scannedPages.length < doc.numPages) {
        setScanOcr(null);
        return;
      }
      setScanOcr(pending ? 'pending' : Object.keys(layers).length ? 'ready' : 'unavailable');
    })();
    return () => {
      ok = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find and onQuery are read, not followed
  }, [doc, path, ocrStatus?.withWords, ocrSettled]);

  const showMatch = useCallback(
    (m: Match | undefined) => {
      if (!m || !texts.current) return;
      void texts.current.then((all) => {
        const t = all[m.page];
        // A scanned page: its recognised lines sit as fractions of the page.
        const frac = ocrFrac.current.get(m.page);
        if (t && frac) {
          let i = 0;
          while (i + 1 < t.starts.length && t.starts[i + 1] <= m.start) i++;
          const [nx, ny] = frac[Math.min(i, frac.length - 1)] ?? [0, 0];
          const w = sizes[m.page]?.w ?? 0;
          const h = sizes[m.page]?.h ?? 0;
          goTo(m.page, Math.max(0, ny * h - 20), Math.max(0, nx * w));
          return;
        }
        const p = pages[m.page];
        let y = 0;
        let x: number | undefined;
        if (t && p && t.at.length) {
          let i = 0;
          while (i + 1 < t.starts.length && t.starts[i + 1] <= m.start) i++;
          const [sx, sy] = toScreen(matrixOf(m.page), ...(t.at[i] ?? [0, 0]));
          y = Math.max(0, sy - 20);
          x = Math.max(0, sx);
        }
        goTo(m.page, y, x);
      });
    },
    [pages, sizes, matrixOf, goTo],
  );

  /** A passage's first words found in the PDF and shown marked in the find bar: all of them if they match as written,
   *  else fewer (a PDF's words can break differently from the text read for the notebook), on `page` when there. */
  const findQuote = useRef<(quote: string, page?: number) => void>(() => undefined);
  findQuote.current = (quote, page) => {
    const all = allTexts();
    if (!all) return;
    void all.then((list) => {
      const words = quote.replace(/…$/, '').split(/\s+/).filter(Boolean);
      for (const n of [words.length, 8, 5, 3]) {
        if (n > words.length) continue;
        const q = words.slice(0, n).join(' ');
        const matches = findAll(
          list.map((x) => x.text),
          q,
        );
        if (!matches.length) continue;
        const at = Math.max(0, page ? matches.findIndex((m) => m.page === page - 1) : 0);
        setFind({ query: q, matches, at, busy: false });
        showMatch(matches[at]);
        return;
      }
    });
  };

  const runFind = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onQuery = (query: string) => {
    setFind((f) => ({ query, matches: f?.matches ?? [], at: 0, busy: !!query.trim() }));
    clearTimeout(runFind.current);
    runFind.current = setTimeout(() => {
      const all = allTexts();
      if (!all) return;
      void all.then((list) => {
        const matches = findAll(
          list.map((x) => x.text),
          query,
        );
        // The first match from the page being read onwards.
        const from = Math.max(0, matches.findIndex((m) => m.page >= current));
        setFind((f) => (f && f.query === query ? { query, matches, at: matches.length ? from : 0, busy: false } : f));
        if (matches.length) showMatch(matches[from]);
      });
    }, 160);
  };
  const stepFind = (dir: 1 | -1) => {
    if (!find?.matches.length) return;
    const at = (find.at + dir + find.matches.length) % find.matches.length;
    setFind({ ...find, at });
    showMatch(find.matches[at]);
  };
  const byPage = useMemo(() => {
    const out = new Map<number, PageMatch[]>();
    if (!find) return out;
    find.matches.forEach((m, i) => {
      const list = out.get(m.page) ?? [];
      list.push({ start: m.start, end: m.end, current: i === find.at });
      out.set(m.page, list);
    });
    return out;
  }, [find?.matches, find?.at]);

  const highlightsByPage = useMemo(() => {
    const out = new Map<number, PdfHighlight[]>();
    for (const h of hl.list) {
      const list = out.get(h.page - 1) ?? [];
      list.push(h);
      out.set(h.page - 1, list);
    }
    return out;
  }, [hl.list]);

  const register = useCallback((index: number, handle: PageHandle | null) => {
    if (handle) handles.current.set(index, handle);
    else handles.current.delete(index);
  }, []);

  // Selected words: the bar; a click on a highlight: its card. In clip mode the pages report boxes instead.
  const afterPointer = (e: React.MouseEvent) => {
    if (clip) return;
    root.current?.querySelectorAll('.pdfv-text.selecting').forEach((el) => el.classList.remove('selecting'));
    const x = e.clientX;
    const y = e.clientY;
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount && scroller.current?.contains(sel.anchorNode)) {
        const parts = selectedParts(sel.getRangeAt(0), handles.current);
        if (parts.length) {
          const r = parts[parts.length - 1].screen;
          setCard(null);
          // Centred over where the selection ends; above its first line, or below its last.
          const firstTop = Math.min(...parts.map((p) => p.top ?? y));
          setBar({ parts, x: r ? r.left + r.width / 2 : x, y: (r?.bottom ?? y) + 10, above: firstTop });
          return;
        }
      }
      setBar(null);
      // A click (not a drag) on a highlight opens its card.
      const pageEl = (document.elementFromPoint(x, y) as Element | null)?.closest('.pdfv-page') as HTMLElement | null;
      if (!pageEl) return;
      const index = Number(pageEl.dataset.page) - 1;
      const p = pages[index];
      if (!p) return;
      const box = pageEl.getBoundingClientRect();
      const m = matrixOf(index);
      const lx = x - box.left;
      const ly = y - box.top;
      const hit = (highlightsByPage.get(index) ?? []).find((h) => h.rects.some((r) => {
        const b = pdfToBox(m, r);
        return lx >= b.left - 1 && lx <= b.right + 1 && ly >= b.top - 1 && ly <= b.bottom + 1;
      }));
      if (hit) setCard({ id: hit.id, x, y: y + 14, above: y - 14, focus: false });
    }, 0);
  };

  const make = (parts: SelectedPart[], colour: PdfColour): PdfHighlight[] => {
    const taken = new Set(hl.list.map((h) => h.id));
    return parts.map((p) => {
      const id = newHighlightId(taken);
      taken.add(id);
      return { id, page: p.index + 1, colour, rects: p.rects, text: p.text, note: '', at: today() };
    });
  };

  const highlightSelection = (colour: PdfColour, withNote = false) => {
    if (!bar) return;
    const made = make(bar.parts, colour);
    hl.save([...hl.list, ...made]);
    setLastColour(colour);
    window.getSelection()?.removeAllRanges();
    if (withNote && made.length) setCard({ id: made[made.length - 1].id, x: bar.x, y: bar.y, above: bar.above, focus: true });
    setBar(null);
  };

  const copy = (words: string) => {
    void navigator.clipboard.writeText(words).then(
      () => toast('Copied.'),
      (err) => showError(err),
    );
  };

  /** A drawn box as a PNG: the page rendered sharp, the box cut out of it (at most 1600 px on its longest side). */
  const renderClip = async (pageIndex: number, rect: PdfRect, cssW: number, cssH: number): Promise<Uint8Array | null> => {
    if (!doc) return null;
    try {
      const page = await doc.getPage(pageIndex + 1);
      let k = Math.min(3, 1600 / Math.max(1, Math.max(cssW, cssH)));
      let viewport = page.getViewport({ scale: (scales[pageIndex] ?? 1) * k });
      while (viewport.width * viewport.height > 16_000_000 && k > 0.5) {
        k *= 0.7;
        viewport = page.getViewport({ scale: (scales[pageIndex] ?? 1) * k });
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
      const cut = pdfToBox(viewport.transform, rect);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cut.right - cut.left));
      out.height = Math.max(1, Math.round(cut.bottom - cut.top));
      out.getContext('2d')?.drawImage(canvas, Math.round(cut.left), Math.round(cut.top), out.width, out.height, 0, 0, out.width, out.height);
      const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return null;
    }
  };

  /** A box drawn on a page: kept as a pictured clip (the picture beside the PDF, the entry in the highlights note). */
  const onClip = (pageIndex: number, box: Box) => {
    if (!doc || !hl.canEdit || !pages[pageIndex]) return;
    const rect = boxToPdf(matrixOf(pageIndex), box).map((n) => Math.round(n * 10) / 10) as PdfRect;
    const id = newHighlightId(hl.list.map((h) => h.id));
    void (async () => {
      const png = await renderClip(pageIndex, rect, box.right - box.left, box.bottom - box.top);
      if (!png) {
        showError(new Error('That part couldn’t be clipped. Try again.'));
        return;
      }
      try {
        const rel = await window.nv.files.saveAttachment(clipImageName(path, id), png, hl.notePath);
        hl.save([...listNow.current, { id, page: pageIndex + 1, colour: lastColour, rects: [rect], text: '', note: '', image: rel, at: today() }]);
        toast('Clipped into the highlights note.', { label: 'Open', run: () => openHighlightsNote() });
      } catch (err) {
        showError(err);
      }
    })();
  };

  /** A highlight as a quote at the end of a note the person picks, with a link back to the page (and the highlight). */
  const quoteInNote = async (h: PdfHighlight) => {
    const notePath = sidecarPathFor(path);
    const choices = getState().notes.map((n) => n.path).filter((p) => p !== notePath);
    const note = await pickFile('Quote in which note?', choices, A.titleOf);
    if (!note) return;
    const block = `${highlightShareBlock(h, linkTarget(path, note), `${A.nameOf(path).replace(/\.pdf$/i, '')}, page ${h.page}`)}\n`;
    try {
      const before = await docs.readThrough(note);
      const next = `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${block}`;
      await docs.writeThrough(note, next, 'pdf-quote');
      toast(`Quoted in ${A.titleOf(note)}.`, { label: 'Open', run: () => A.openPath(note, { where: 'right' }) });
    } catch (err) {
      showError(err);
    }
  };

  const openHighlightsNote = (h?: PdfHighlight) => {
    if (!hl.noteExists) return;
    // Opened beside the PDF; a highlight's own quote is found by its link.
    if (h) {
      const text = docs.text(hl.notePath) ?? '';
      const line = text.split('\n').findIndex((l) => l.includes(`hl=${h.id}`));
      A.openPath(hl.notePath, { where: 'right', reuse: true, ...(line >= 0 ? { line: Math.max(0, line - 2) } : {}) });
    } else A.openPath(hl.notePath, { where: 'right', reuse: true });
  };

  /** A highlight dragged out of the list: its words (or its picture) with a link back, resolving from any note. */
  const dragText = (h: PdfHighlight) => highlightShareBlock(h, linkTarget(path), `${A.nameOf(path).replace(/\.pdf$/i, '')}, page ${h.page}`);

  // Keys while the PDF has them: Ctrl+F find, Ctrl+= / Ctrl+- / Ctrl+0 zoom, Page Up/Down and Home/End, Escape.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = (e.target as Element).closest('input, textarea');
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setFind((f) => f ?? { query: '', matches: [], at: 0, busy: false });
      requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('.pdfv-find-field')?.focus());
      return;
    }
    if (typing) return;
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setZoom(stepZoom(scale, 1));
    } else if (mod && e.key === '-') {
      e.preventDefault();
      setZoom(stepZoom(scale, -1));
    } else if (mod && e.key === '0') {
      e.preventDefault();
      setZoom('width');
    } else if (e.key === 'Escape' && bar) {
      setBar(null);
      window.getSelection()?.removeAllRanges();
    } else if (e.key === 'Escape' && clip) {
      setClip(false);
    } else if (!mod && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      goTo(e.key === 'Home' ? 0 : pages.length - 1);
    }
  };

  // Ctrl + the wheel zooms the pages (not the whole window).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(stepZoom(scale, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, doc]);

  // A selection made with the keys (Shift+arrows) shows the bar too.
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.shiftKey && /^Arrow|^Home$|^End$/.test(e.key)) afterPointer({ clientX: 0, clientY: 0 } as React.MouseEvent);
  };

  const zoomWords = zoom === 'width' ? 'Fit width' : zoom === 'page' ? 'Fit page' : `${Math.round((scale / CSS_PER_POINT) * 100)}%`;
  const zoomMenu = (): MenuItem[] => [
    { label: 'Fit width', checked: zoom === 'width', hotkey: 'Mod+0', run: () => setZoom('width') },
    { label: 'Fit page', checked: zoom === 'page', run: () => setZoom('page') },
    { separator: true },
    ...ZOOM_STEPS.filter((z) => z >= 50 && z <= 400).map((z): MenuItem => ({ label: `${z}%`, checked: zoom === z, run: () => setZoom(z) })),
  ];

  // The list as it is now, for a note saved as its card closes (after a Remove it must not bring the highlight back).
  const listNow = useRef(hl.list);
  listNow.current = hl.list;
  const cardHighlight = card ? hl.list.find((h) => h.id === card.id) : undefined;
  const ratios = useMemo(() => pages.map((p) => p.h / Math.max(1, p.w)), [pages]);
  const name = A.nameOf(path);
  const notice = scannedPdfNotice(false);
  const reading = scanReadingNotice();

  return (
    <div ref={root} className={`pdfv${dim ? ' is-dim' : ''}${clip ? ' is-clip' : ''}`} onKeyDown={onKeyDown} onKeyUp={onKeyUp} data-own-zoom tabIndex={-1}>
      {/* The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred
          search): the button yields when measured within 12px of the bar; the ⋯ menu already reaches it in the
          same words below, so no row is added. */}
      <ViewHeader tab={tab} title={name} menu={() => [...overflowMenuItems(headerOverflowHidden(tab.id), { 'open-default': null }), ...fileMenu(path)]}>
        <button className="icon-button" data-overflow="open-default" data-overflow-order={1} title="Open in its default app" onClick={() => void A.openInDefaultApp(path)}>
          <Icon name="external" size={16} />
        </button>
      </ViewHeader>
      {doc && (
        <div className="pdfv-bar" role="toolbar" aria-label="PDF">
          <button className={`icon-button${rail ? ' is-active' : ''}`} title={rail ? 'Hide page pictures' : 'Show page pictures'} aria-pressed={rail} onClick={() => (remember('rail', !rail), setRail(!rail))}>
            <Icon name="sidebarLeft" size={16} />
          </button>
          <span className="pdfv-pageno">
            <input
              className="pdfv-pageno-field"
              aria-label="Page number"
              value={pageBox ?? String(current + 1)}
              inputMode="numeric"
              onFocus={(e) => (setPageBox(String(current + 1)), requestAnimationFrame(() => e.target.select()))}
              onChange={(e) => setPageBox(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onBlur={() => setPageBox(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Number(pageBox);
                  if (n >= 1) goTo(Math.min(n, pages.length) - 1);
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
              style={{ width: `${Math.max(2, String(pages.length).length) + 1.2}ch` }}
            />
            <span className="pdfv-pageno-of">of {pages.length}</span>
          </span>
          <span className="pdfv-bar-gap" />
          <button className="icon-button" title="Zoom out (Ctrl+-)" aria-label="Zoom out" onClick={() => setZoom(stepZoom(scale, -1))}>
            <Icon name="zoomOut" size={16} />
          </button>
          <button className="pdfv-zoom" title="Zoom" onClick={(e) => openMenu(e.currentTarget, zoomMenu())}>
            {zoomWords}
            <Icon name="chevronDown" size={12} />
          </button>
          <button className="icon-button" title="Zoom in (Ctrl+=)" aria-label="Zoom in" onClick={() => setZoom(stepZoom(scale, 1))}>
            <Icon name="zoomIn" size={16} />
          </button>
          <span className="pdfv-bar-gap" />
          <button className="icon-button pdfv-dim-btn" title={dim ? 'Show pages at full brightness' : 'Dim pages (easier on the eyes in the dark)'} aria-pressed={dim} onClick={() => (remember('dim', !dim), setDim(!dim))}>
            <Icon name="sun" size={16} />
          </button>
          <button className={`icon-button${find ? ' is-active' : ''}`} title="Find in this PDF (Ctrl+F)" aria-label="Find in this PDF" onClick={() => setFind((f) => (f ? null : { query: '', matches: [], at: 0, busy: false }))}>
            <Icon name="search" size={16} />
          </button>
          <button
            className={`icon-button${clip ? ' is-active' : ''}`}
            title={hl.canEdit ? 'Clip a picture (drag a box on a page)' : 'Clipping needs a vault that can be changed.'}
            aria-label="Clip a picture"
            aria-pressed={clip}
            disabled={!hl.canEdit}
            onClick={() => setClip((c) => !c)}
          >
            <Icon name="scissors" size={16} />
          </button>
          <button className={`pdfv-hl-toggle${panel ? ' is-active' : ''}`} title={panel ? 'Hide highlights' : 'Show highlights'} aria-pressed={panel} onClick={() => (remember('panel', !panel), setPanel(!panel))}>
            <Icon name="highlight" size={16} />
            {hl.list.length > 0 && <span className="pdfv-hl-count">{hl.list.length}</span>}
          </button>
        </div>
      )}
      {find && (
        <FindBar
          query={find.query}
          count={find.matches.length}
          at={find.at}
          busy={find.busy}
          onQuery={onQuery}
          onStep={stepFind}
          onClose={() => {
            setFind(null);
            root.current?.focus();
          }}
        />
      )}
      {doc && !failed && (scanOcr === 'pending' || scanOcr === 'unavailable') && (
        <div className="pdfv-scan" role="note">
          <Icon name="info" size={16} />
          <div className="pdfv-scan-words">
            <p className="pdfv-scan-title">{scanOcr === 'pending' ? reading.title : notice.title}</p>
            <p className="pdfv-scan-body">{scanOcr === 'pending' ? reading.body : notice.body}</p>
          </div>
        </div>
      )}
      <div className="pdfv-body">
        {doc && rail && <Thumbs doc={doc} ratios={ratios} current={current} onGo={(i) => goTo(i)} />}
        <div
          ref={scroller}
          className="pdfv-scroll"
          onScroll={onScroll}
          onMouseDown={(e) => {
            if (clip) return;
            // While dragging out a selection, the words' end stretches over the page so the selection doesn't jump.
            (e.target as Element).closest('.pdfv-page')?.querySelector('.pdfv-text')?.classList.add('selecting');
          }}
          onMouseUp={afterPointer}
        >
          {failed ? (
            <div className="pdfv-failed">
              <Icon name="pdf" size={40} />
              <p>{failed}</p>
              <button className="button" onClick={() => void A.openInDefaultApp(path)}>
                <Icon name="external" size={15} /> Open in its default app
              </button>
              <button className="button" disabled={!tab.back.length} onClick={() => tab.back.length && setWorkspace((w) => W.navigate(w, tab.id, -1))}>
                Back
              </button>
            </div>
          ) : !doc ? (
            <div className="pdfv-loading" aria-label="Opening the PDF" />
          ) : (
            <div className="pdfv-pages" style={{ paddingTop: PAD, paddingBottom: PAD, gap: GAP, paddingInline: SIDE }}>
              {sizes.map((s, i) => (
                <PdfPage
                  key={i}
                  path={path}
                  doc={doc}
                  index={i}
                  scale={scales[i]}
                  width={s.w}
                  height={s.h}
                  live={i >= live[0] && i <= live[1]}
                  highlights={highlightsByPage.get(i) ?? NO_HIGHLIGHTS}
                  flash={flash}
                  matches={byPage.get(i) ?? NO_MATCHES}
                  register={register}
                  clip={clip && hl.canEdit}
                  onClip={onClip}
                  ocr={ocrLayers[i] ?? null}
                />
              ))}
            </div>
          )}
        </div>
        {doc && panel && <HighlightsPanel list={hl.list} noteName={A.titleOf(hl.notePath)} noteExists={hl.noteExists} onGo={showHighlight} onOpenNote={() => openHighlightsNote()} onClose={() => (remember('panel', false), setPanel(false))} dragText={dragText} />}
      </div>
      {bar && (
        <SelectionBar
          x={bar.x}
          y={bar.y}
          above={bar.above}
          canEdit={hl.canEdit}
          onColour={(c) => highlightSelection(c)}
          onNote={() => highlightSelection(lastColour, true)}
          onCopy={() => {
            copy(bar.parts.map((p) => p.text).join(' '));
            setBar(null);
          }}
          onQuote={() => {
            const p = bar.parts[0];
            setBar(null);
            // Not a highlight yet (no id): the link names the page alone.
            void quoteInNote({ id: '', page: p.index + 1, colour: lastColour, rects: [], text: bar.parts.map((x) => x.text).join(' '), note: '' });
          }}
        />
      )}
      {card && cardHighlight && (
        <HighlightCard
          key={cardHighlight.id}
          h={cardHighlight}
          x={card.x}
          y={card.y}
          above={card.above}
          canEdit={hl.canEdit}
          focusNote={card.focus}
          onColour={(c) => {
            setLastColour(c);
            hl.save(listNow.current.map((h) => (h.id === cardHighlight.id ? { ...h, colour: c } : h)));
          }}
          onNote={(note) => {
            if (listNow.current.some((h) => h.id === cardHighlight.id && h.note !== note)) hl.save(listNow.current.map((h) => (h.id === cardHighlight.id ? { ...h, note } : h)));
          }}
          onCopy={() => copy(cardHighlight.text)}
          onQuote={() => {
            setCard(null);
            void quoteInNote(cardHighlight);
          }}
          onRemove={() => {
            setCard(null);
            hl.save(hl.list.filter((h) => h.id !== cardHighlight.id));
          }}
          onOpenNote={() => {
            setCard(null);
            openHighlightsNote(cardHighlight);
          }}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}
