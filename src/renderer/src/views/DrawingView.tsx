// A drawing (21 Oct 2026, gap G23): a calm surface to sketch on beside the notes — freehand with the pen's pressure
// (a mouse draws an even line), rectangles, ellipses, arrows, lines and text labels; select, move and delete; undo and
// redo; zoom and pan; export as SVG or PNG. Kept in a .nvdraw file (src/shared/drawing.ts, docs/DRAWING-FORMAT.md),
// saved a moment after each change. Written from scratch for Ironleaf.
//
// Keys while the drawing has them: V select, P pen, R rectangle, O ellipse, A arrow, L line, T text, H hand; Delete
// removes what is selected; arrows move it (Shift: further); Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo; Ctrl+A selects
// everything; + and − zoom, 0 fits the drawing; Esc lets go. Space held, the middle button or the wheel pan; Ctrl and the
// wheel zoom.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COLOUR_WORDS,
  DRAW_COLOURS,
  DrawHistory,
  addPoint,
  boxFrom,
  drawingBounds,
  drawingToSvg,
  elementAt,
  elementBounds,
  elementSvg,
  elementsInBox,
  moveElement,
  newId,
  parseDrawing,
  serializeDrawing,
  snapAngle,
  type Box,
  type DrawColour,
  type DrawElement,
  type NamedColour,
  type TextElement,
} from '../../../shared/drawing';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import * as A from '../state/actions';
import { docs } from '../state/docs';
import { showError, toast, useApp } from '../state/store';
import type { TabState } from '../state/workspace';
import { getWorkspace } from '../state/layout';
import { isEnterKey } from '../lib/enterKey';

type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text' | 'hand';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select and move', key: 'V' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'rect', label: 'Rectangle', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'hand', label: 'Move around', key: 'H' },
];

const WIDTHS: { id: number; label: string }[] = [
  { id: 2, label: 'Thin' },
  { id: 4, label: 'Medium' },
  { id: 8, label: 'Thick' },
];

/** The tools' pictures, drawn here (simple strokes on the 24-unit grid the app's icons use). */
const TOOL_PATHS: Record<Tool, string> = {
  select: 'M6 3l12 9-5.5 1.2L15 19l-2.4 1.1-2.6-5.7L6 18z',
  pen: 'M4 20c3-1 4-4 7-7l6-6a2 2 0 0 1 3 3l-6 6c-3 3-6 4-10 4z',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  arrow: 'M5 19L19 5M10 5h9v9',
  line: 'M5 19L19 5',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4.5a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7S7 18 5.5 15.5L4 13a1.5 1.5 0 0 1 2.6-1.5L8 13',
};

function ToolIcon({ tool }: { tool: Tool }) {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TOOL_PATHS[tool]} />
    </svg>
  );
}

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'draw'; el: DrawElement; x0: number; y0: number }
  | { kind: 'move'; x0: number; y0: number; ids: Set<string>; moved: boolean }
  | { kind: 'marquee'; x0: number; y0: number; add: boolean }
  | { kind: 'pan'; cx: number; cy: number; view: View };

interface TextEdit {
  id?: string;
  x: number;
  y: number;
  text: string;
  size: number;
  colour: DrawColour;
}

const clampK = (k: number) => Math.min(8, Math.max(0.1, k));
const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');

export function DrawingView({ tab }: { tab: TabState }) {
  const path = tab.path!;
  const canEdit = useApp((s) => s.canEdit);
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tool, setToolState] = useState<Tool>('pen');
  const [colour, setColour] = useState<DrawColour>('ink');
  const [width, setWidth] = useState(4);
  const [fill, setFill] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [draft, setDraft] = useState<DrawElement | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [moveBy, setMoveBy] = useState<{ dx: number; dy: number } | null>(null);
  const [editing, setEditing] = useState<TextEdit | null>(null);
  // The label being written, as of now (its box's blur on the way out must not keep it a second time).
  const editingRef = useRef<TextEdit | null>(null);
  editingRef.current = editing;
  const [, tick] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const els = useRef(elements);
  els.current = elements;
  const viewRef = useRef(view);
  viewRef.current = view;
  const history = useRef(new DrawHistory());
  const extra = useRef<Record<string, unknown> | undefined>(undefined);
  const version = useRef(1);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const writable = canEdit && !problem;

  // ── The file ──

  const fit = useCallback((list: DrawElement[] = els.current) => {
    const rect = surface.current?.getBoundingClientRect();
    const w = rect?.width || 900;
    const h = rect?.height || 600;
    const b = drawingBounds(list);
    if (!b) return setView({ x: Math.round(w / 2 - 200), y: Math.round(h / 2 - 150), k: 1 });
    const k = clampK(Math.min(2, (w - 120) / Math.max(1, b.w), (h - 160) / Math.max(1, b.h)));
    setView({ x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 + 24 - (b.y + b.h / 2) * k, k });
  }, []);

  // Through the open documents like every other editor (Nov 2026, nv-save F6: it saved past them, so another tab
  // with the drawing, a failed save, or closing lost strokes): shared text, guarded saves, flushed on the way out.
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    const show = (words: string, first: boolean) => {
      const d = parseDrawing(words);
      extra.current = d.extra;
      version.current = d.version;
      setElements(d.elements);
      setProblem(null);
      if (first) {
        history.current.clear();
        requestAnimationFrame(() => fit(d.elements));
        if (d.skipped) toast(`${d.skipped === 1 ? 'One thing' : `${d.skipped} things`} in this drawing couldn’t be read and ${d.skipped === 1 ? 'was' : 'were'} left out.`);
      }
    };
    void docs
      .acquire(path)
      .then((text) => {
        if (!alive) return docs.release(path);
        show(text, true);
        unsubscribe = docs.subscribe(path, (next, origin) => {
          if (!alive || origin === 'drawing:' + tab.id) return;
          show(next, false);
        });
      })
      .catch((err: unknown) => {
        if (alive) setProblem(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
      unsubscribe();
      docs.release(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Closed with nothing drawn, a new "Untitled canvas" goes to Recently deleted instead of staying behind as clutter
  // (26 Oct 2026, the vault kept an empty one at its top).
  useEffect(() => {
    const elsNow = els;
    return () => {
      if (!elsNow.current.length && /^Untitled (drawing|canvas)( \d+)?\.nvdraw$/i.test(path.split('/').pop() ?? ''))
        // Only once its tab is really closed (not on a switch to another tab): it is then the newest closed one.
        window.setTimeout(() => {
          if (getWorkspace().closed[0]?.path === path) void window.nv.files.trash(path).catch(() => undefined);
        }, 300);
    };
  }, [path]);

  /** A change: kept for Undo, shown, and saved a moment later. */
  const commit = useCallback(
    (next: DrawElement[]) => {
      if (!writable) return;
      history.current.push(els.current);
      els.current = next;
      setElements(next);
      if (canEdit) docs.update(path, serializeDrawing({ elements: next, extra: extra.current, version: version.current }), 'drawing:' + tab.id);
    },
    [writable, canEdit, path, tab.id],
  );

  const undo = () => {
    const prev = history.current.undo(els.current);
    if (!prev) return;
    setElements(prev);
    els.current = prev;
    setSelected(new Set());
    if (canEdit) docs.update(path, serializeDrawing({ elements: prev, extra: extra.current, version: version.current }), 'drawing:' + tab.id);
  };
  const redo = () => {
    const next = history.current.redo(els.current);
    if (!next) return;
    setElements(next);
    els.current = next;
    setSelected(new Set());
    if (canEdit) docs.update(path, serializeDrawing({ elements: next, extra: extra.current, version: version.current }), 'drawing:' + tab.id);
  };

  const setTool = (t: Tool) => {
    commitText();
    setToolState(t);
    if (t !== 'select') setSelected(new Set());
  };

  // ── Where the pointer is ──

  const toScene = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setView((v) => {
      const k = clampK(v.k * factor);
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loaded]);

  // ── Drawing with the pointer ──

  const pressureOf = (e: React.PointerEvent | PointerEvent) => (e.pointerType === 'mouse' || !e.pressure ? 0.5 : e.pressure);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    svg.current?.focus({ preventScroll: true });
    const panning = e.button === 1 || tool === 'hand' || space.current;
    if (panning) {
      e.preventDefault();
      drag.current = { kind: 'pan', cx: e.clientX, cy: e.clientY, view: viewRef.current };
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (editing) {
      commitText();
      return;
    }
    const p = toScene(e.clientX, e.clientY);
    const tol = 5 / viewRef.current.k;
    if (tool === 'select' || !writable) {
      const hit = elementAt(els.current, p.x, p.y, tol);
      if (hit) {
        const next = new Set(e.shiftKey ? selected : selected.has(hit.id) ? selected : []);
        if (e.shiftKey && next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        setSelected(next);
        if (writable && next.has(hit.id)) drag.current = { kind: 'move', x0: p.x, y0: p.y, ids: next, moved: false };
      } else {
        if (!e.shiftKey) setSelected(new Set());
        drag.current = { kind: 'marquee', x0: p.x, y0: p.y, add: e.shiftKey };
      }
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'text') {
      e.preventDefault();
      setEditing({ x: p.x, y: p.y - 12, text: '', size: width >= 8 ? 32 : width >= 4 ? 22 : 16, colour });
      return;
    }
    const id = newId(new Set(els.current.map((x) => x.id)));
    let el: DrawElement;
    if (tool === 'pen') el = { id, kind: 'stroke', points: [[p.x, p.y, pressureOf(e)]], colour, width };
    else if (tool === 'rect' || tool === 'ellipse') el = { id, kind: tool, x: p.x, y: p.y, w: 0, h: 0, colour, width, ...(fill ? { fill: true } : {}) };
    else el = { id, kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, colour, width };
    drag.current = { kind: 'draw', el, x0: p.x, y0: p.y };
    setDraft(el);
    svg.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ ...d.view, x: d.view.x + e.clientX - d.cx, y: d.view.y + e.clientY - d.cy });
      return;
    }
    const p = toScene(e.clientX, e.clientY);
    if (d.kind === 'move') {
      d.moved = true;
      setMoveBy({ dx: p.x - d.x0, dy: p.y - d.y0 });
      return;
    }
    if (d.kind === 'marquee') {
      setMarquee({ x: d.x0, y: d.y0, w: p.x - d.x0, h: p.y - d.y0 });
      return;
    }
    const el = d.el;
    if (el.kind === 'stroke') {
      // Every point the pen gave since the last frame, so a quick line stays smooth.
      const native = e.nativeEvent as PointerEvent;
      const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
      let points = el.points;
      for (const ev of events.length ? events : [native]) {
        const q = toScene(ev.clientX, ev.clientY);
        points = addPoint(points, q.x, q.y, pressureOf(ev), 0.75 / viewRef.current.k);
      }
      d.el = { ...el, points };
    } else if (el.kind === 'rect' || el.kind === 'ellipse') {
      const b = boxFrom(d.x0, d.y0, p.x, p.y, e.shiftKey);
      d.el = { ...el, ...b };
    } else if (el.kind === 'line' || el.kind === 'arrow') {
      const [x2, y2] = e.shiftKey ? snapAngle(d.x0, d.y0, p.x, p.y) : [p.x, p.y];
      d.el = { ...el, x2, y2 };
    }
    setDraft(d.el);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    try {
      svg.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Not held.
    }
    if (!d) return;
    if (d.kind === 'move') {
      const by = moveBy;
      setMoveBy(null);
      if (d.moved && by && (Math.abs(by.dx) > 0.01 || Math.abs(by.dy) > 0.01)) commit(els.current.map((x) => (d.ids.has(x.id) ? moveElement(x, by.dx, by.dy) : x)));
      return;
    }
    if (d.kind === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (m && (Math.abs(m.w) > 2 || Math.abs(m.h) > 2)) {
        const inside = elementsInBox(els.current, m).map((x) => x.id);
        setSelected((s) => new Set([...(d.add ? s : []), ...inside]));
      }
      return;
    }
    if (d.kind !== 'draw') return;
    setDraft(null);
    const el = d.el;
    const b = elementBounds(el);
    const tiny = el.kind === 'stroke' ? false : el.kind === 'line' || el.kind === 'arrow' ? Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 3 : el.kind === 'rect' || el.kind === 'ellipse' ? el.w < 3 && el.h < 3 : b.w < 1;
    if (tiny) return;
    commit([...els.current, el]);
  };

  // ── Text labels ──

  const commitText = () => {
    const t = editingRef.current;
    if (!t) return;
    editingRef.current = null;
    setEditing(null);
    const words = t.text.replace(/\s+$/, '');
    if (t.id) {
      const was = els.current.find((x) => x.id === t.id);
      if (!was) return;
      if (!words.trim()) return commit(els.current.filter((x) => x.id !== t.id));
      if (was.kind === 'text' && was.text !== words) commit(els.current.map((x) => (x.id === t.id ? { ...(x as TextElement), text: words } : x)));
      return;
    }
    if (!words.trim()) return;
    commit([...els.current, { id: newId(new Set(els.current.map((x) => x.id))), kind: 'text', x: t.x, y: t.y, text: words, size: t.size, colour: t.colour }]);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!writable) return;
    const p = toScene(e.clientX, e.clientY);
    const hit = elementAt(els.current, p.x, p.y, 5 / viewRef.current.k);
    if (hit?.kind === 'text') {
      setSelected(new Set());
      setEditing({ id: hit.id, x: hit.x, y: hit.y, text: hit.text, size: hit.size, colour: hit.colour });
    } else if (!hit && tool === 'select') setEditing({ x: p.x, y: p.y - 12, text: '', size: 22, colour });
  };

  // ── Keys ──

  const remove = () => {
    if (!selected.size) return;
    commit(els.current.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z' && !e.shiftKey) undo();
    else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) redo();
    else if (mod && key === 'a') {
      setToolState('select');
      setSelected(new Set(els.current.map((x) => x.id)));
    } else if (mod && (key === '=' || key === '+')) zoomAt(1.2);
    else if (mod && key === '-') zoomAt(1 / 1.2);
    else if (mod && key === '0') fit();
    else if (mod) handled = false;
    else if (key === 'delete' || key === 'backspace') remove();
    else if (key === 'escape') {
      if (selected.size) setSelected(new Set());
      else setTool('select');
    } else if (key.startsWith('arrow') && selected.size && writable) {
      const step = (e.shiftKey ? 10 : 1) / viewRef.current.k;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      commit(els.current.map((x) => (selected.has(x.id) ? moveElement(x, dx, dy) : x)));
    } else if (key === '+' || key === '=') zoomAt(1.2);
    else if (key === '-') zoomAt(1 / 1.2);
    else if (key === '0') fit();
    else if (key === ' ') space.current = true;
    else {
      const t = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (t && (writable || t.id === 'select' || t.id === 'hand')) setTool(t.id);
      else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') space.current = false;
  };

  // ── Export ──

  const exportAs = async (kind: 'svg' | 'png') => {
    if (!els.current.length) return toast('Draw something first.');
    const name = A.titleOf(path);
    const markup = drawingToSvg(els.current, { look: 'light', background: kind === 'png' ? '#ffffff' : null, title: name });
    try {
      if (kind === 'svg') {
        const file = await window.nv.exports.drawing(name, 'svg', `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`);
        if (file) toast(`Exported ${name} as SVG.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
        return;
      }
      const bytes = await svgToPng(markup, 2);
      const file = await window.nv.exports.drawing(name, 'png', bytes);
      if (file) toast(`Exported ${name} as a picture.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
    } catch (err) {
      showError(err);
    }
  };

  // ── Drawn ──

  const shown = useMemo(() => {
    if (!moveBy || !selected.size) return elements;
    return elements.map((x) => (selected.has(x.id) ? moveElement(x, moveBy.dx, moveBy.dy) : x));
  }, [elements, moveBy, selected]);

  const selectionBox = useMemo(() => {
    const chosen = shown.filter((x) => selected.has(x.id));
    return chosen.length ? drawingBounds(chosen) : null;
  }, [shown, selected]);

  const markup = useMemo(() => shown.filter((x) => !(editing?.id && x.id === editing.id)).map((x) => `<g data-id="${x.id}">${elementSvg(x, 'css')}</g>`).join(''), [shown, editing]);
  const draftMarkup = useMemo(() => (draft ? elementSvg(draft, 'css') : ''), [draft]);
  const count = elements.length;

  if (!loaded) return <div className="nvd-view" />;

  const cursor = tool === 'hand' || drag.current?.kind === 'pan' ? 'grab' : tool === 'select' || !writable ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const swatch = (c: NamedColour) => ({ ['--swatch' as string]: `var(--draw-${c})` });

  return (
    <div className="nvd-view" ref={surface}>
      {problem && (
        <div className="nvd-problem" role="alert">
          <Icon name="warning" size={16} />
          <span>{problem}</span>
        </div>
      )}
      <div className="nvd-toolbar" role="toolbar" aria-label="Drawing tools" onPointerDown={(e) => e.stopPropagation()}>
        <div className="nvd-group" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <ToolButton key={t.id} label={`${t.label} (${t.key})`} pressed={tool === t.id} disabled={!writable && t.id !== 'select' && t.id !== 'hand'} onClick={() => setTool(t.id)} radio>
              <ToolIcon tool={t.id} />
            </ToolButton>
          ))}
        </div>
        <span className="nvd-sep" />
        <div className="nvd-group" role="radiogroup" aria-label="Colour">
          {DRAW_COLOURS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={colour === c} className={`nvd-swatch${colour === c ? ' is-on' : ''}`} style={swatch(c)} title={COLOUR_WORDS[c]} aria-label={COLOUR_WORDS[c]} disabled={!writable} onClick={() => {
              setColour(c);
              if (selected.size) commit(els.current.map((x) => (selected.has(x.id) ? { ...x, colour: c } : x)));
            }} />
          ))}
        </div>
        <span className="nvd-sep" />
        <div className="nvd-group" role="radiogroup" aria-label="Line width">
          {WIDTHS.map((w) => (
            <ToolButton key={w.id} label={w.label} pressed={width === w.id} disabled={!writable} radio onClick={() => {
              setWidth(w.id);
              if (selected.size) commit(els.current.map((x) => (selected.has(x.id) && x.kind !== 'text' ? { ...x, width: w.id } : x)));
            }}>
              <span className="nvd-width" style={{ height: Math.max(1.5, w.id / 2) }} />
            </ToolButton>
          ))}
          <ToolButton label="Fill shapes" pressed={fill} disabled={!writable} onClick={() => {
            const next = !fill;
            setFill(next);
            if (selected.size) commit(els.current.map((x) => (selected.has(x.id) && (x.kind === 'rect' || x.kind === 'ellipse') ? { ...x, fill: next || undefined } : x)));
          }}>
            <span className={`nvd-fill${fill ? ' is-on' : ''}`} />
          </ToolButton>
        </div>
        <span className="nvd-sep" />
        <div className="nvd-group">
          <ToolButton label="Undo (Ctrl+Z)" disabled={!history.current.canUndo} onClick={() => (undo(), tick((n) => n + 1))}>
            <Icon name="undo" size={16} />
          </ToolButton>
          <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={!history.current.canRedo} onClick={() => (redo(), tick((n) => n + 1))}>
            <Icon name="undo" size={16} className="flip-x" />
          </ToolButton>
          <ToolButton label="Delete what is selected (Delete)" disabled={!selected.size || !writable} onClick={remove}>
            <Icon name="trash" size={16} />
          </ToolButton>
          <ToolButton label="Export" onClick={(e) => openMenu(e.currentTarget, [{ label: 'Export as SVG…', icon: 'download', run: () => void exportAs('svg') }, { label: 'Export as a picture (PNG)…', icon: 'image', run: () => void exportAs('png') }])}>
            <Icon name="download" size={16} />
          </ToolButton>
        </div>
      </div>
      <svg
        ref={svg}
        className="nvd-surface"
        tabIndex={0}
        role="application"
        aria-roledescription="drawing"
        aria-label={`${A.titleOf(path)}: ${count === 1 ? 'one thing drawn' : `${count} things drawn`}${selected.size ? `, ${selected.size} selected` : ''}. Choose a tool with its key, then draw with the pointer or pen.`}
        data-own-zoom=""
        data-own-keys=""
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = toScene(e.clientX, e.clientY);
          const hit = elementAt(els.current, p.x, p.y, 5 / viewRef.current.k);
          if (hit && !selected.has(hit.id)) setSelected(new Set([hit.id]));
          const ids = hit ? (selected.has(hit.id) ? selected : new Set([hit.id])) : selected;
          openMenu(e, [
            ...(ids.size && writable
              ? [
                  { label: 'Bring to front', icon: 'layers' as const, run: () => commit([...els.current.filter((x) => !ids.has(x.id)), ...els.current.filter((x) => ids.has(x.id))]) },
                  { label: 'Send to back', icon: 'layers' as const, run: () => commit([...els.current.filter((x) => ids.has(x.id)), ...els.current.filter((x) => !ids.has(x.id))]) },
                  { label: 'Delete', icon: 'trash' as const, hotkey: 'Delete', danger: true, run: () => (commit(els.current.filter((x) => !ids.has(x.id))), setSelected(new Set())) },
                  { separator: true as const },
                ]
              : []),
            { label: 'Select everything', hotkey: 'Mod+A', run: () => (setToolState('select'), setSelected(new Set(els.current.map((x) => x.id)))) },
            { label: 'Fit the drawing', hotkey: '0', icon: 'fit', run: () => fit() },
          ]);
        }}
      >
        <defs>
          <pattern id={`nvd-dots-${tab.id}`} width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} className="nvd-dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#nvd-dots-${tab.id})`} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g dangerouslySetInnerHTML={{ __html: markup }} />
          {draftMarkup && <g dangerouslySetInnerHTML={{ __html: draftMarkup }} />}
          {selectionBox && <rect className="nvd-selection" x={selectionBox.x - 4 / view.k} y={selectionBox.y - 4 / view.k} width={selectionBox.w + 8 / view.k} height={selectionBox.h + 8 / view.k} rx={4 / view.k} strokeWidth={1.5 / view.k} strokeDasharray={`${5 / view.k} ${4 / view.k}`} />}
          {marquee && <rect className="nvd-marquee" x={Math.min(marquee.x, marquee.x + marquee.w)} y={Math.min(marquee.y, marquee.y + marquee.h)} width={Math.abs(marquee.w)} height={Math.abs(marquee.h)} strokeWidth={1 / view.k} />}
        </g>
      </svg>
      {editing && (
        <textarea
          className="nvd-text-edit"
          autoFocus
          aria-label="Text label"
          placeholder="Type a label"
          value={editing.text}
          style={{ left: view.x + editing.x * view.k, top: view.y + editing.y * view.k, fontSize: editing.size * view.k, color: `var(--draw-${(DRAW_COLOURS as readonly string[]).includes(editing.colour) ? editing.colour : 'ink'})` }}
          rows={Math.max(1, editing.text.split('\n').length)}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={commitText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              editingRef.current = null;
              setEditing(null);
              svg.current?.focus();
            } else if (isEnterKey(e) && !e.shiftKey) {
              e.preventDefault();
              commitText();
              svg.current?.focus();
            }
          }}
        />
      )}
      <div className="nvd-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <ToolButton label="Zoom out (−)" onClick={() => zoomAt(1 / 1.2)}>
          <Icon name="zoomOut" size={15} />
        </ToolButton>
        <button type="button" className="nvd-zoom-level" title="Fit the drawing (0)" onClick={() => fit()}>
          {Math.round(view.k * 100)}%
        </button>
        <ToolButton label="Zoom in (+)" onClick={() => zoomAt(1.2)}>
          <Icon name="zoomIn" size={15} />
        </ToolButton>
      </div>
      {!count && !draft && !editing && writable && (
        <div className="nvd-empty" aria-hidden="true">
          Draw with the pen, or pick a shape. Hold Space and drag to move around.
        </div>
      )}
    </div>
  );
}

function ToolButton({ label, pressed, disabled, radio, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; radio?: boolean; onClick(e: React.MouseEvent<HTMLButtonElement>): void; children: ReactNode }) {
  return (
    <button type="button" className={`nvd-tool${pressed ? ' is-on' : ''}`} title={label} aria-label={label} {...(radio ? { role: 'radio', 'aria-checked': !!pressed } : pressed !== undefined ? { 'aria-pressed': pressed } : {})} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** The drawing as a PNG's bytes, drawn by the window at `scale`. */
async function svgToPng(markup: string, scale: number): Promise<Uint8Array> {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const w = Math.min(8000, Math.ceil(img.naturalWidth * scale));
  const h = Math.min(8000, Math.ceil(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The picture couldn’t be drawn.');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture couldn’t be made.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A drawing's picture for its card on a canvas (CardFace): drawn with the look's own colours. */
export function DrawingPreview({ path }: { path: string }) {
  const revision = useApp((s) => s.revision);
  const meta = useApp((s) => s.files.find((f) => f.rel === path));
  const [markup, setMarkup] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    window.nv.files.readText(path).then(
      (words) => {
        if (!alive) return;
        try {
          const d = parseDrawing(words);
          setMarkup(d.elements.length ? drawingToSvg(d.elements, { look: 'css', margin: 12 }) : '');
          setFailed(false);
        } catch {
          setFailed(true);
        }
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [path, revision, meta?.mtime]);
  if (failed) return <div className="cv-placeholder">This drawing can’t be read.</div>;
  if (markup === null) return <div className="cv-loading" />;
  if (!markup) return <div className="cv-placeholder">An empty drawing. Double-click to draw in it.</div>;
  return <div className="nvd-preview" dangerouslySetInnerHTML={{ __html: markup }} />;
}
