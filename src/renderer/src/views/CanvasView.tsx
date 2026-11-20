// Canvas: an open board of cards (text, stickies, notes, pictures and files, web links, groups) joined by lines, saved as
// a .canvas file in the open JSON Canvas format (jsoncanvas.org) so any app that reads the format can open it. Our own
// extras (a card's lock, a sticky, a line's style, what a card shows of a project) are extra properties the format
// allows; other readers ignore them.
//
// Moving around works every common way: drag empty space (or hold Space, or the middle button, anywhere), scroll or
// two-finger scroll, arrow keys, one finger on a touch screen, or the map; Ctrl+scroll, a pinch (trackpad or touch
// screen), + and − zoom (canvas/navigation.ts). Shift+drag on empty space draws a box to select cards. Far out, each
// card becomes its overview (canvas/Overview.tsx) and group names stay readable without landing on each other.
//
// Double-click to write a card there; type straight into any card (the
// app's own editor); drag a card's edge dot to join it to another card (or let go on empty space for a new one);
// resize from any corner or edge (Shift keeps the proportions); cards snap to the grid and to each other.
//
// A project's canvas and the portfolio board (src/shared/project-canvas.ts) are canvases too: their cards are drawn from
// the project files and kept in step with them (canvas/BoundCards.tsx), and edits on them write the project files.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Project } from '../../../shared/project-file';
import type { ProjectView } from '../../../shared/types';
import {
  applyItemEdit,
  closeUpColumn,
  columnAt,
  columnOf,
  columnsFor,
  columnValue,
  fileCard,
  hiddenKey,
  layoutPortfolio,
  parseItem,
  placeInGroup,
  readBoardText,
  RISK_LEVELS,
  syncPortfolio,
  syncProject,
  withWords,
  type CanvasBoard,
  type CanvasEdge,
  type CanvasNode,
  type ItemEdit,
  type PortfolioEntry,
  type PortfolioGroupBy,
} from '../../../shared/project-canvas';
import { confirm, prompt } from '../components/Dialogs';
import { fileIcon, Icon } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { PageHead } from '../components/PageHead';
import { pickFile } from '../components/Pickers';
import { isDrawingPath } from '../../../shared/drawing';
import { openProjectTasks, wantsDone } from '../../../shared/project-close';
import { useProjectCloser } from './project/useProjectCloser';
import { pastedPictureName } from '../lib/attach';
import { isImage } from '../lib/resolve';
import * as A from '../state/actions';
import { fileMenu } from '../state/menus';
import { docs, useSaveState } from '../state/docs';
import { getState, loadFiles, showError, toast, useApp } from '../state/store';
import { workCall } from '../state/workModules';
import type { TabState } from '../state/workspace';
import { ViewHeader } from './ViewHeader';
import { ADD_HINT, ADDABLE, BoundFace, editableWords, isBoundCard, type BoundHandlers } from './canvas/BoundCards';
import { CardEditor } from './canvas/CardEditor';
import { CardFace, cardWords } from './canvas/CardFace';
import { updateDocCanvas } from '../state/docKind';
import { align, anchor, bounds, distribute, driftedAway, edgePath, facing, freeNear, GRID, HANDLES, intersects, MIN_H, MIN_W, openingView, resizeRect, scaleInto, snapGrid, snapMove, viewFor, type Alignment, type Guide, type Handle, type LineStyle, type Rect, type Side } from './canvas/geometry';
import { Minimap } from './canvas/Minimap';
import { arrowPan, between, clampZoom, easeOut, fitGroupLabels, levels, LABEL_PX, pinchView, styleZoom, wheelIntent, zoomAround, type LabelFit } from './canvas/navigation';
import { Overview } from './canvas/Overview';
import { loadPortfolio } from './canvas/projectBoards';

type CNode = CanvasNode;
type CEdge = CanvasEdge;
type Board = CanvasBoard;
type View = { x: number; y: number; k: number };

const PRESETS: Record<string, { name: string; var: string }> = {
  '1': { name: 'Red', var: '--canvas-1' },
  '2': { name: 'Orange', var: '--canvas-2' },
  '3': { name: 'Yellow', var: '--canvas-3' },
  '4': { name: 'Green', var: '--canvas-4' },
  '5': { name: 'Cyan', var: '--canvas-5' },
  '6': { name: 'Purple', var: '--canvas-6' },
};

const colorOf = (c?: string) => (!c ? undefined : PRESETS[c] ? `var(${PRESETS[c].var})` : /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const isNotePath = (p?: string) => /\.md$/i.test(p ?? '');
const locked = (n?: CNode) => n?.nvLocked === true;
const lineOf = (e: CEdge): LineStyle => (e.nvLine === 'straight' || e.nvLine === 'elbow' ? e.nvLine : 'curved');
const stored = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Kept for this time only.
  }
};

/** A group name's width at full size (px), measured in the app's own type. */
const labelWidths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null = null;
function labelWidth(text: string): number {
  const known = labelWidths.get(text);
  if (known !== undefined) return known;
  if (!measurer) {
    measurer = document.createElement('canvas').getContext('2d');
    const ui = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
    if (measurer) measurer.font = `650 ${LABEL_PX}px ${ui}`;
  }
  const w = Math.ceil(measurer?.measureText(text).width ?? text.length * 8.5);
  labelWidths.set(text, w);
  return w;
}

const NAV_WORDS = 'Drag to move around · Ctrl+scroll or pinch to zoom · Shift+drag to select';



function edgeEnds(e: CEdge, byId: Map<string, CNode>) {
  const from = byId.get(e.fromNode)!;
  const to = byId.get(e.toNode)!;
  const fs = e.fromSide ?? facing(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  const ts = e.toSide ?? facing(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
  return { a: anchor(from, fs), as: fs, b: anchor(to, ts), bs: ts };
}

/** Cards copied (Ctrl+C) for pasting on this canvas or another; `plain` is what other apps get. */
let clip: { nodes: CNode[]; edges: CEdge[]; plain: string } | null = null;

// ── One card ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface CardApi {
  startDrag(e: ReactPointerEvent, node: CNode): void;
  startResize(e: ReactPointerEvent, node: CNode | null, handle: Handle): void;
  startLink(e: ReactPointerEvent, node: CNode, side: Side): void;
  doubleClick(e: React.MouseEvent, node: CNode): void;
  contextMenu(e: React.MouseEvent, node?: CNode, edge?: CEdge): void;
  openLink(target: string, newTab: boolean): void;
  editText(node: CNode, text: string, contentHeight: number): void;
  finishEdit(node: CNode, text: string): void;
  renameGroup(node: CNode, label: string | null): void;
  addToSection(section: 'next' | 'dates' | 'risks' | 'people'): void;
  openCard(node: CNode, newTab: boolean): void;
  startEdit(node: CNode): void;
  toggle(node: CNode): void;
  level(node: CNode, e: React.MouseEvent<HTMLElement>): void;
  choose(path: string, field: 'status' | 'health' | 'progress', e: React.MouseEvent<HTMLElement>): void;
  openDoc(rel: string): void;
  openProject(path: string, newTab: boolean): void;
}

interface BoundData {
  canEdit: boolean;
  project?: Project;
  projectPath?: string;
  entries: Map<string, Project>;
  groupBy: PortfolioGroupBy;
}

const Card = memo(function Card({ node, selected, handles, editing, labelEditing, match, detail, labelFit, board, api, bound }: { node: CNode; selected: boolean; handles: boolean; editing: 'text' | 'note' | 'bound' | null; labelEditing: boolean; match: 0 | 1 | 2; detail: boolean; labelFit?: LabelFit; board: string; api: CardApi; bound: BoundData }) {
  const color = colorOf(node.color);
  const b = node.neuralvault;
  const isBound = isBoundCard(node);
  const isLocked = locked(node);
  const handlers: BoundHandlers = { ...bound, toggle: api.toggle, level: api.level, choose: api.choose, openDoc: api.openDoc, openProject: api.openProject };
  const sticky = node.nvSticky === true;
  const note = node.type === 'file' && isNotePath(node.file);
  const classes = [
    'canvas-card',
    `type-${node.type}`,
    selected ? 'selected' : '',
    editing ? 'editing' : '',
    node.color ? 'has-color' : '',
    sticky ? 'is-sticky' : '',
    b ? `is-bound part-${b.part}${'section' in b ? ` sec-${b.section}` : ''}` : '',
    isLocked ? 'is-locked' : '',
    match === 1 ? 'is-match' : match === 2 ? 'is-match is-current' : '',
    note ? 'is-note' : '',
    b?.part === 'doc' ? 'is-doc-card is-doc-centre' : b?.part === 'section' ? 'is-doc-card' : '',
    !detail && !editing ? 'is-overview' : '',
  ].join(' ');
  // Being written in, a card shows itself whole at any zoom.
  const whole = detail || !!editing;
  const place = labelEditing ? 'above' : labelFit?.place ?? 'above';

  let groupCount: number | null = null;
  if (node.type === 'group' && b?.part === 'group' && b.section !== 'notes' && bound.project) groupCount = bound.project[b.section].length;
  if (node.type === 'group' && b?.part === 'column') groupCount = [...bound.entries.values()].filter((p) => columnOf(bound.groupBy, p) === b.key).length;
  const addable = node.type === 'group' && b?.part === 'group' && ADDABLE[b.section] && bound.canEdit ? (b.section as 'next' | 'dates' | 'risks' | 'people') : null;

  return (
    <div
      className={classes}
      data-id={node.id}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, ['--card-color' as string]: color ?? 'var(--canvas-card-border)', ['--cw' as string]: node.width - 3, ['--ch' as string]: node.height - 3, ...(labelFit ? { ['--ls' as string]: labelFit.scale, ...(place !== 'none' ? { ['--lmax' as string]: labelEditing ? 100000 : labelFit.max } : {}) } : {}) }}
      onPointerDown={(e) => api.startDrag(e, node)}
      onDoubleClick={(e) => api.doubleClick(e, node)}
      onContextMenu={(e) => api.contextMenu(e, node)}
    >
      {node.type === 'group' ? (
        <div className={`canvas-group-label cv-group-label lbl-${place}`} style={{ color: color ?? undefined }} onDoubleClick={(e) => { e.stopPropagation(); if (bound.canEdit && !isLocked) api.renameGroup(node, null); }}>
          {labelEditing ? (
            <input
              className="cv-label-input"
              autoFocus
              defaultValue={node.label ?? ''}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => api.renameGroup(node, e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <span className="cv-group-name">{node.label || 'Group'}</span>
          )}
          {groupCount !== null && <span className="cv-count">{groupCount}</span>}
          {addable && (
            <button className="cv-group-add" title={ADDABLE[addable]} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); api.addToSection(addable); }}>
              <Icon name="plus" size={12} />
            </button>
          )}
        </div>
      ) : (
        <>
          {!whole && <Overview node={node} h={bound} />}
          {whole && (
            <>
              {!isBound && node.type === 'file' && node.file && (
                <div className="canvas-card-title">
                  <Icon name={note && (node.subpath || b?.part === 'doc') ? 'doc' : fileIcon(node.file)} size={13} className={note && (node.subpath || b?.part === 'doc') ? 'cv-title-doc' : undefined} />
                  <span>{note && node.subpath ? node.subpath.replace(/^#/, '') : note ? A.titleOf(node.file) : A.nameOf(node.file)}</span>
                  {note && node.subpath && <span className="cv-title-of">{A.titleOf(node.file)}</span>}
                  {note && !editing && (
                    <span className="cv-title-actions">
                      {bound.canEdit && !node.subpath && (
                        <button title="Write in the note here (Enter)" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); api.startEdit(node); }}>
                          <Icon name="edit" size={12} />
                        </button>
                      )}
                      <button title={node.subpath ? `Open ${A.titleOf(node.file)} at ${node.subpath.replace(/^#/, '')}` : 'Open the note in a tab'} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); api.openCard(node, e.ctrlKey || e.metaKey); }}>
                        <Icon name="external" size={12} />
                      </button>
                    </span>
                  )}
                  {note && editing && <span className="cv-editing-hint">Esc to finish</span>}
                </div>
              )}
              <div className={`canvas-card-body${node.type === 'text' || note || b?.part === 'notes' ? ' is-scrollable' : ''}${isBound ? ' is-bound' : ''}`}>
                {editing === 'text' ? (
                  <CardEditor source={{ kind: 'text', text: node.text ?? '' }} from={board} onChange={(t, h) => api.editText(node, t, h)} onDone={(t) => api.finishEdit(node, t)} />
                ) : editing === 'note' && node.file ? (
                  <CardEditor source={{ kind: 'note', path: node.file }} from={node.file} onDone={(t) => api.finishEdit(node, t)} />
                ) : editing === 'bound' ? (
                  <CardEditor source={{ kind: 'text', text: editableWords(node) ?? '' }} from={bound.projectPath ?? board} singleLine={b?.part === 'item'} onDone={(t) => api.finishEdit(node, t)} />
                ) : isBound ? (
                  <BoundFace node={node} h={handlers} />
                ) : (
                  <CardFace node={node} board={board} onOpen={api.openLink} />
                )}
              </div>
            </>
          )}
        </>
      )}
      {isLocked && (
        <span className="cv-lock" title="Locked: unlock it to move or change it">
          <Icon name="lock" size={11} />
        </span>
      )}
      {handles && bound.canEdit && !isLocked && !editing && (
        <>
          {(['top', 'right', 'bottom', 'left'] as Side[]).map((side) => (
            <div key={side} className={`canvas-port port-${side}`} onPointerDown={(e) => api.startLink(e, node, side)} title="Drag to join to another card, or to empty space for a new one" />
          ))}
          {HANDLES.map((h) => (
            <div key={h} className={`cv-handle h-${h}`} onPointerDown={(e) => api.startResize(e, node, h)} />
          ))}
        </>
      )}
    </div>
  );
});

// ── The canvas ────────────────────────────────────────────────────────────────────────────────────────────────────

export function CanvasView({ tab }: { tab: TabState }) {
  const path = tab.path!;
  const canEdit = useApp((s) => s.canEdit);
  const revision = useApp((s) => s.revision);
  const [board, setBoard] = useState<Board | null>(null);
  // A damaged board file (5 Nov 2026, u3 moving-in): read-only with its bytes shown, never a silent empty canvas.
  // Starting over keeps the bytes in File recovery first, then editing opens.
  const [damaged, setDamaged] = useState<{ text: string; reason: string } | null>(null);
  const [showBytes, setShowBytes] = useState(false);
  const damagedRef = useRef(false);
  damagedRef.current = !!damaged;
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; kind: 'text' | 'note' | 'bound' } | null>(null);
  const [labelEditing, setLabelEditing] = useState<string | null>(null);
  const [edgeEditing, setEdgeEditing] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [linking, setLinking] = useState<{ from: string; side: Side; x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [snapOn, setSnapOn] = useState(() => stored('nv.canvas.snap', true));
  const [minimapOn, setMinimapOn] = useState(() => stored('nv.canvas.minimap', true));
  const [swatches, setSwatches] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [search, setSearch] = useState<{ query: string; at: number } | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  // The map needs room beside the toolbar: a narrow canvas (a small window, a pane beside another) goes without it.
  const roomForMap = size.width > 900 && size.height > 480;
  const surface = useRef<HTMLDivElement>(null);
  const boardRef = useRef<Board | null>(null);
  const viewRef = useRef(view);
  const history = useRef<{ undo: string[]; redo: string[] }>({ undo: [], redo: [] });
  const [, setHistoryTick] = useState(0);
  const lastSaved = useRef('');
  const space = useRef(false);
  const editBase = useRef<Board | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** A move under way (eased): the frame asked for and where it's going. */
  const anim = useRef<{ id: number; to: View } | null>(null);
  /** What the person is doing with the pointer, so two fingers arriving can call it off. */
  const gesture = useRef<{ cancel(): void } | null>(null);
  boardRef.current = board;
  viewRef.current = view;

  // The first time a canvas opens: a quiet line on how to move around. It goes a moment after the person has moved
  // the view, or after a while, or when closed; then it's not shown again (the zoom button's tip keeps the same words).
  const [hint, setHint] = useState(() => !stored('nv.canvas.navHint', false));
  const hintOn = useRef(hint);
  hintOn.current = hint;
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeHint = useCallback(() => {
    setHint(false);
    store('nv.canvas.navHint', true);
  }, []);
  const noteMoved = () => {
    if (hintOn.current && !hintTimer.current) hintTimer.current = setTimeout(closeHint, 2600);
  };
  const noteMovedRef = useRef(noteMoved);
  noteMovedRef.current = noteMoved;
  const hasCards = !!board?.nodes.length;
  useEffect(() => {
    if (!hint || !hasCards) return;
    const t = setTimeout(closeHint, 15000);
    return () => clearTimeout(t);
  }, [hint, hasCards, closeHint]);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // A project's canvas or the portfolio board: the projects as they are now (the cards follow them).
  const meta = board?.neuralvault;
  const boardKind = meta?.kind;
  const boardProject = meta?.kind === 'project' ? meta.project : undefined;
  const groupBy: PortfolioGroupBy = meta?.kind === 'portfolio' ? meta.groupBy : 'status';
  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const bound = useRef<{ project?: Project; entries?: PortfolioEntry[] }>({});
  const entryMap = useMemo(() => new Map((entries ?? []).map((e) => [e.path, e.project])), [entries]);

  // An eased move is drawn frame by frame (not left to a CSS transition), so the cards' level of detail, the group names,
  // the dots and the map all follow it exactly. A new move starts from wherever the last one had got to.
  const setView = useCallback((v: View | ((v: View) => View), eased = false, anchor?: { x: number; y: number }) => {
    const running = anim.current;
    if (running) {
      cancelAnimationFrame(running.id);
      anim.current = null;
    }
    if (!eased) {
      setViewState(v);
      return;
    }
    const from = viewRef.current;
    const to = typeof v === 'function' ? v(running ? running.to : from) : v;
    const el = surface.current;
    const at = anchor ?? { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 };
    const t0 = performance.now();
    const step = (t: number) => {
      const e = easeOut((t - t0) / 260);
      const next = between(from, to, e, at);
      viewRef.current = next;
      setViewState(next);
      anim.current = e < 1 ? { id: requestAnimationFrame(step), to } : null;
    };
    anim.current = { id: requestAnimationFrame(step), to };
  }, []);
  useEffect(
    () => () => {
      if (anim.current) cancelAnimationFrame(anim.current.id);
    },
    [],
  );

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Loads the board, and follows changes made elsewhere (another tab with it, a sync).
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    void docs
      .acquire(path)
      .then((text) => {
        if (!alive) return docs.release(path);
        lastSaved.current = text;
        const r = readBoardText(text);
        const b = r.board;
        setBoard(b);
        setDamaged(r.damaged ? { text, reason: r.reason } : null);
        setShowBytes(false);
        requestAnimationFrame(() => {
          // A doc's canvas opens on the doc and its sections, at a size their words can be read.
          const docCards = b.neuralvault?.kind === 'doc' ? b.nodes.filter((n) => n.neuralvault?.part === 'doc' || n.neuralvault?.part === 'section') : [];
          const docCard = docCards.find((n) => n.neuralvault?.part === 'doc');
          if (docCard && surface.current) setView(docOpeningView(docCards, docCard, { width: surface.current.clientWidth, height: surface.current.clientHeight }));
          else openTo(b.nodes);
          // The keys work straight away (arrows, + and −), unless the person is typing somewhere.
          const a = document.activeElement as HTMLElement | null;
          if (!a?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) surface.current?.focus({ preventScroll: true });
        });
        unsubscribe = docs.subscribe(path, (next, origin) => {
          if (origin === 'canvas:' + tab.id || next === lastSaved.current) return;
          lastSaved.current = next;
          const r = readBoardText(next);
          setBoard(r.board);
          setDamaged(r.damaged ? { text: next, reason: r.reason } : null);
        });
      })
      .catch(showError);
    return () => {
      alive = false;
      unsubscribe();
      docs.release(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /** A bound board kept in step with the projects as last read (so nothing written can undo a change made to them). */
  const inStep = (b: Board): Board => {
    const m = b.neuralvault;
    if (m?.kind === 'project' && bound.current.project) return syncProject(b, bound.current.project, m.project).board;
    if (m?.kind === 'portfolio' && bound.current.entries) return syncPortfolio(b, bound.current.entries).board;
    return b;
  };

  /** Every change goes through here: kept for Undo (unless `record` is false), shown, and saved. */
  const commit = (proposed: Board, record = true, from?: Board | null) => {
    // A damaged board stays read-only until its bytes are kept and the person starts over.
    if (damagedRef.current) return;
    const next = inStep(proposed);
    const before = from ?? boardRef.current;
    if (record && before) {
      history.current.undo.push(JSON.stringify(before));
      if (history.current.undo.length > 200) history.current.undo.shift();
      history.current.redo = [];
      setHistoryTick((t) => t + 1);
    }
    boardRef.current = next;
    setBoard(next);
    const text = JSON.stringify(next, null, '\t');
    lastSaved.current = text;
    if (canEdit) docs.update(path, text, 'canvas:' + tab.id);
  };

  const undo = () => {
    const prev = history.current.undo.pop();
    if (!prev || !boardRef.current) return;
    history.current.redo.push(JSON.stringify(boardRef.current));
    commit(JSON.parse(prev) as Board, false);
    setHistoryTick((t) => t + 1);
  };
  const redo = () => {
    const next = history.current.redo.pop();
    if (!next || !boardRef.current) return;
    history.current.undo.push(JSON.stringify(boardRef.current));
    commit(JSON.parse(next) as Board, false);
    setHistoryTick((t) => t + 1);
  };

  /** Starting over from a damaged file: its bytes kept in File recovery first, then editing opens. */
  const startOver = async () => {
    try {
      await window.nv.canvas.keepDamaged(path);
      setDamaged(null);
      setShowBytes(false);
      toast('A copy of the damaged file is kept in File recovery.');
    } catch (e) {
      showError(e);
    }
  };

  const byId = useMemo(() => new Map((board?.nodes ?? []).map((n) => [n.id, n])), [board]);

  // The projects behind a bound board, read again whenever the notes change (the assistant, the project page, another
  // window); the board follows them without moving what the person arranged.
  useEffect(() => {
    if (!boardKind) return;
    let alive = true;
    const timer = setTimeout(() => {
      const apply = () => {
        const b = boardRef.current;
        if (!alive || !b) return;
        const next = inStep(b);
        if (JSON.stringify(next) !== JSON.stringify(b)) commit(next, false);
      };
      if (boardKind === 'project' && boardProject)
        window.nv.projects.view(boardProject).then(
          (v) => {
            if (!alive) return;
            bound.current.project = v.project;
            setProjectView(v);
            apply();
          },
          () => alive && setProjectView(null),
        );
      else if (boardKind === 'portfolio')
        loadPortfolio().then((list) => {
          if (!alive) return;
          bound.current.entries = list;
          setEntries(list);
          apply();
        }, showError);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKind, boardProject, revision]);

  // ── Where things are ────────────────────────────────────────────────────────────────────────────────────────────

  const toWorld = (clientX: number, clientY: number) => {
    const r = surface.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };
  const centre = () => {
    const r = surface.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  /** Where a new card goes: under the pointer when it's on the canvas, else the middle of the view. */
  const here = () => pointer.current ?? centre();
  /** A free place near the middle of the view (cards added from the bar never land on top of others). */
  const free = (w: number, h: number) => {
    const c = centre();
    const at = freeNear((boardRef.current?.nodes ?? []).filter((n) => n.type !== 'group'), { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h });
    return { x: at.x + w / 2, y: at.y + h / 2 };
  };

  function fitTo(nodes: Rect[], eased = false, maxZoom = 1.2) {
    const el = surface.current;
    if (!el) return;
    const s = { width: el.clientWidth, height: el.clientHeight };
    if (!nodes.length) {
      setView({ x: s.width / 2, y: s.height / 2, k: 1 }, eased);
      return;
    }
    setView(viewFor(bounds(nodes), s, maxZoom), eased);
  }

  /** A doc's canvas, first seen: the doc's card centred near the top and its sections under it, all of it when that can
   *  be read, else at 78% (words still readable) centred on the doc's card. */
  function docOpeningView(cards: Rect[], doc: Rect, s: { width: number; height: number }): View {
    const box = bounds(cards);
    const pad = 56;
    const top = 88;
    const fit = Math.min((s.width - pad * 2) / box.width, (s.height - top - pad) / box.height, 1);
    const k = fit >= 0.78 ? fit : 0.78;
    return { k, x: s.width / 2 - (doc.x + doc.width / 2) * k, y: top - box.y * k };
  }

  // The first look at a board: all of it when its words can still be read, else readable from its top-left corner.
  function openTo(nodes: Rect[], readable?: number) {
    const el = surface.current;
    if (!el || !nodes.length) return fitTo(nodes);
    setView(openingView(bounds(nodes), { width: el.clientWidth, height: el.clientHeight }, readable));
  }

  const zoomAt = (factor: number, cx?: number, cy?: number, eased = false) => {
    const r = surface.current!.getBoundingClientRect();
    const at = { x: (cx ?? r.left + r.width / 2) - r.left, y: (cy ?? r.top + r.height / 2) - r.top };
    setView((v) => zoomAround(v, factor, at), eased, at);
  };
  const zoomTo = (k: number) => zoomAt(clampZoom(k) / (anim.current?.to.k ?? viewRef.current.k), undefined, undefined, true);
  const panBy = (dx: number, dy: number, eased = false) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }), eased);

  // ── Projects behind the board ───────────────────────────────────────────────────────────────────────────────────

  /** An edit to the project behind the canvas: shown at once (the same change made here), then written to its file. */
  const editProject = (edit: ItemEdit) => {
    const p = bound.current.project;
    if (!p || !boardProject || !canEdit) return;
    const copy = structuredClone(p);
    try {
      applyItemEdit(copy, edit);
    } catch (err) {
      showError(err);
      return;
    }
    bound.current.project = copy;
    setProjectView((v) => (v ? { ...v, project: copy } : v));
    if (boardRef.current) commit(boardRef.current, false);
    window.nv.projects.canvasEdit(boardProject, edit).then(
      (v) => {
        bound.current.project = v.project;
        setProjectView(v);
      },
      (err) => {
        showError(err);
        bound.current.project = p;
        setProjectView((v) => (v ? { ...v, project: p } : v));
        if (boardRef.current) commit(boardRef.current, false);
      },
    );
  };

  const itemOf = (node: CNode) => {
    const b = node.neuralvault;
    if (b?.part !== 'item') return null;
    const item = parseItem(b.section, node.text ?? '');
    return item ? { b, item } : null;
  };

  // Marking done asks first (p12-close-and-noise round 2): a card's status and portfolio drags go through the
  // shared closer, never silently.
  const { closer, requestDone } = useProjectCloser();
  /** A field of a project (health, status, progress) set from its card: shown at once, then written. */
  const setField = (projectPath: string, field: 'status' | 'health' | 'progress', value: string | number | null) => {
    if (field === 'status' && wantsDone({ kind: 'set', field: 'status', value: value ?? '' })) {
      requestDone(projectPath);
      return Promise.resolve(false);
    }
    return writeField(projectPath, field, value);
  };
  const writeField = (projectPath: string, field: 'status' | 'health' | 'progress', value: string | number | null) => {
    const patch = (p: Project): Project => ({ ...p, [field]: value === null || value === '' ? undefined : value });
    if (bound.current.project && projectPath === boardProject) {
      bound.current.project = patch(bound.current.project);
      setProjectView((v) => (v ? { ...v, project: patch(v.project) } : v));
    }
    if (bound.current.entries) {
      bound.current.entries = bound.current.entries.map((e) => (e.path === projectPath ? { ...e, project: patch(e.project) } : e));
      setEntries(bound.current.entries);
    }
    // Success is reported (W5-30): a caller that moves a card waits for the write.
    return window.nv.projects.edit(projectPath, { kind: 'set', field, value }).then(() => true, (e) => { showError(e); return false; });
  };

  /** Words edited on a bound card: the fact with them, written to the project. */
  const finishBound = (node: CNode, words: string) => {
    const b = node.neuralvault;
    if (b?.part === 'notes') {
      if (words !== (node.text ?? '')) editProject({ op: 'notes', text: words });
      return;
    }
    const x = itemOf(node);
    if (!x) return;
    const next = withWords(x.b.section, x.item, words);
    if (!next) {
      toast('A card can’t be left without words. To take it off the canvas, press Delete.');
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(x.item)) return;
    editProject({ op: 'replace', section: x.b.section, key: x.b.key, index: x.b.index, item: next });
  };

  const addToSection = async (section: 'next' | 'dates' | 'risks' | 'people') => {
    const words = await prompt(ADDABLE[section] ?? 'Add', { placeholder: ADD_HINT[section], ok: 'Add' });
    if (!words?.trim()) return;
    const blank = section === 'next' ? { done: false, what: '' } : section === 'dates' ? { when: '', what: '' } : section === 'people' ? { name: '' } : { what: '' };
    const item = withWords(section, blank, words);
    if (item) editProject({ op: 'add', section, item });
  };

  /** Lays a bound board out afresh (the person's own cards and lines stay; what they took off stays off). */
  const tidy = () => {
    const b = boardRef.current;
    if (!b || !canEdit) return;
    const own = b.nodes.filter((n) => !n.neuralvault || n.neuralvault.part === 'file');
    const ids = new Set(own.map((n) => n.id));
    const kept: Board = { ...b, nodes: own, edges: b.edges.filter((e) => !e.neuralvault && ids.has(e.fromNode) && ids.has(e.toNode)) };
    if (b.neuralvault?.kind === 'portfolio' && bound.current.entries) commit(layoutPortfolio(bound.current.entries, b.neuralvault.groupBy, kept));
    else commit(kept);
    requestAnimationFrame(() => boardRef.current && fitTo(boardRef.current.nodes, true));
  };

  const regroup = (by: PortfolioGroupBy) => {
    const b = boardRef.current;
    if (!b || !bound.current.entries || by === groupBy) return;
    commit(layoutPortfolio(bound.current.entries, by, b));
    requestAnimationFrame(() => boardRef.current && fitTo(boardRef.current.nodes, true));
  };

  // ── Adding ──────────────────────────────────────────────────────────────────────────────────────────────────────

  const addNode = (node: Omit<CNode, 'id'>, edit: 'text' | 'note' | null = null) => {
    const b = boardRef.current;
    if (!b || !canEdit) return;
    const n = { ...node, id: newId() } as CNode;
    commit({ ...b, nodes: node.type === 'group' ? [n, ...b.nodes] : [...b.nodes, n] });
    setSelected(new Set([n.id]));
    if (edit) {
      editBase.current = boardRef.current;
      setEditing({ id: n.id, kind: edit });
    }
    return n;
  };

  const addText = (at = here(), color?: string) => {
    const w = color ? 220 : 280;
    const h = color ? 170 : 100;
    return addNode({ type: 'text', text: '', x: snapGrid(at.x - w / 2, snapOn), y: snapGrid(at.y - h / 2, snapOn), width: w, height: h, ...(color ? { color, nvSticky: true } : {}) }, 'text');
  };

  const addFileNode = (file: string, at = here()) => {
    const image = isImage(file);
    const note = isNotePath(file);
    return addNode({ type: 'file', file, x: snapGrid(at.x - 200, snapOn), y: snapGrid(at.y - 150, snapOn), width: image ? 360 : note ? 400 : 320, height: image ? 260 : note ? 340 : note ? 340 : 120 });
  };
  const addExisting = async (kind: 'note' | 'media', at = here()) => {
    const paths = getState().files.filter((f) => (kind === 'note' ? f.kind === 'note' : f.kind !== 'note' && f.kind !== 'canvas')).map((f) => f.rel);
    const chosen = await pickFile(kind === 'note' ? 'Add which note?' : 'Add which picture or file?', paths, kind === 'note' ? A.titleOf : A.nameOf);
    if (chosen) addFileNode(chosen, at);
  };
  // A drawing on the canvas (src/shared/drawing.ts; 21 Oct 2026, gap G23): an ordinary file card naming the .nvdraw file,
  // so the .canvas stays valid JSON Canvas for other apps. A new one opens beside the canvas to draw in.
  const addDrawing = async (fresh: boolean, at = here()) => {
    try {
      let rel: string | null;
      if (fresh) {
        rel = await window.nv.files.create(A.folderOf(path), 'Untitled canvas', '.nvdraw');
        void loadFiles();
      } else rel = await pickFile('Add which drawing?', getState().files.filter((f) => isDrawingPath(f.rel)).map((f) => f.rel), A.titleOf);
      if (!rel) return;
      addNode({ type: 'file', file: rel, x: snapGrid(at.x - 210, snapOn), y: snapGrid(at.y - 150, snapOn), width: 420, height: 300 });
      if (fresh) A.openPath(rel, { where: 'right' });
    } catch (err) {
      showError(err);
    }
  };
  const addNewNote = async (at = here()) => {
    try {
      const rel = await window.nv.files.create(A.folderOf(path), 'Untitled', '.md', '');
      void loadFiles();
      const n = addNode({ type: 'file', file: rel, x: snapGrid(at.x - 200, snapOn), y: snapGrid(at.y - 150, snapOn), width: 400, height: 340 });
      if (n) {
        editBase.current = boardRef.current;
        setEditing({ id: n.id, kind: 'note' });
      }
    } catch (err) {
      showError(err);
    }
  };
  const addLink = async (at = here()) => {
    const url = await prompt('Add a web link', { placeholder: 'https://…', ok: 'Add' });
    if (!url?.trim()) return;
    addNode({ type: 'link', url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, x: snapGrid(at.x - 170, snapOn), y: snapGrid(at.y - 45, snapOn), width: 340, height: 92 });
  };
  const addGroup = (at = here()) => {
    const b = boardRef.current;
    if (!b) return;
    const sel = b.nodes.filter((n) => selected.has(n.id));
    if (sel.length) {
      const r = bounds(sel);
      const g = addNode({ type: 'group', label: 'Group', x: r.x - 40, y: r.y - 40, width: r.width + 80, height: r.height + 80 });
      if (g) setLabelEditing(g.id);
    } else {
      const g = addNode({ type: 'group', label: 'Group', x: snapGrid(at.x - 300, snapOn), y: snapGrid(at.y - 200, snapOn), width: 600, height: 400 });
      if (g) setLabelEditing(g.id);
    }
  };

  const addMenu = (at?: { x: number; y: number }): MenuItem[] => [
    { label: 'Text card', icon: 'text', hotkey: 'T', disabled: !canEdit, run: () => addText(at) },
    { label: 'Sticky note', icon: 'notes', disabled: !canEdit, submenu: Object.entries(PRESETS).map(([k, v]) => ({ label: v.name, run: () => addText(at, k) })) },
    { label: 'Note', icon: 'filePlus', disabled: !canEdit, submenu: [{ label: 'A new note', run: () => void addNewNote(at) }, { label: 'A note already here…', run: () => void addExisting('note', at) }] },
    { label: 'Picture or file…', icon: 'image', disabled: !canEdit, run: () => void addExisting('media', at) },
    { label: 'Drawing', icon: 'pencil', disabled: !canEdit, submenu: [{ label: 'A new drawing', run: () => void addDrawing(true, at) }, { label: 'A drawing already here…', run: () => void addDrawing(false, at) }] },
    { label: 'Web link…', icon: 'link', disabled: !canEdit, run: () => void addLink(at) },
    { label: 'Group', icon: 'frame', hotkey: 'G', disabled: !canEdit, run: () => addGroup(at) },
  ];

  // ── Changing ────────────────────────────────────────────────────────────────────────────────────────────────────

  const update = (ids: Set<string>, change: (n: CNode) => CNode) => {
    const b = boardRef.current;
    if (!b) return;
    commit({ ...b, nodes: b.nodes.map((n) => (ids.has(n.id) ? change(n) : n)) });
  };

  const removeSelected = () => {
    const b = boardRef.current;
    if (!b || !selected.size || !canEdit) return;
    const keep = (n: CNode) => n.neuralvault?.part === 'project' || n.neuralvault?.part === 'column' || n.neuralvault?.part === 'doc' || locked(n);
    const going = new Set(b.nodes.filter((n) => selected.has(n.id) && !keep(n)).map((n) => n.id));
    const edgesGoing = new Set(b.edges.filter((e) => selected.has(e.id) || going.has(e.fromNode) || going.has(e.toNode)).map((e) => e.id));
    if (!going.size && !edgesGoing.size) {
      if ([...selected].some((id) => locked(byId.get(id)))) toast('It’s locked: unlock it to take it off.');
      else if ([...selected].some((id) => byId.get(id)?.neuralvault?.part === 'doc')) toast('The doc’s own card stays on its canvas.');
      else if ([...selected].some((id) => byId.get(id)?.neuralvault)) toast('The project’s own card stays on its canvas.');
      return;
    }
    // Cards and lines drawn from the projects are remembered as taken off, so they don't come back.
    const hidden = new Set(b.neuralvault?.hidden ?? []);
    let boundGone = 0;
    for (const n of b.nodes) if (going.has(n.id) && n.neuralvault) {
      const k = hiddenKey(n.neuralvault);
      if (k) {
        hidden.add(k);
        boundGone++;
      }
    }
    for (const e of b.edges) if (selected.has(e.id) && e.neuralvault) {
      const k = hiddenKey(e.neuralvault);
      if (k) hidden.add(k);
    }
    const next: Board = { ...b, nodes: b.nodes.filter((n) => !going.has(n.id)), edges: b.edges.filter((e) => !edgesGoing.has(e.id)) };
    if (b.neuralvault) next.neuralvault = { ...b.neuralvault, hidden: [...hidden] };
    commit(next);
    setSelected(new Set());
    const where = b.neuralvault?.kind === 'doc' ? 'doc' : 'project';
    if (boundGone) toast(boundGone === 1 ? `Taken off the canvas. It’s still in the ${where}.` : `${boundGone} cards taken off the canvas. They’re still in the ${where}.`, { label: 'Undo', run: undo });
  };

  const removeFromProject = async (node: CNode) => {
    const x = itemOf(node);
    if (!x) return;
    if (!(await confirm('Take it out of the project?', { message: 'It goes from the project file and its page, as well as this canvas.', ok: 'Take it out', danger: true }))) return;
    editProject({ op: 'remove', section: x.b.section, key: x.b.key, index: x.b.index });
  };

  const setColor = (color: string | undefined) => {
    const b = boardRef.current;
    if (!b) return;
    commit({ ...b, nodes: b.nodes.map((n) => (selected.has(n.id) ? { ...n, color } : n)), edges: b.edges.map((e) => (selected.has(e.id) ? { ...e, color } : e)) });
  };

  const setEdge = (id: string, change: Partial<CEdge>) => {
    const b = boardRef.current;
    if (b) commit({ ...b, edges: b.edges.map((e) => (e.id === id ? { ...e, ...change } : e)) });
  };

  const duplicate = () => {
    const b = boardRef.current;
    if (!b || !selected.size || !canEdit) return;
    const pasted = cloneCards(b.nodes.filter((n) => selected.has(n.id)), b.edges, 40);
    commit({ ...b, nodes: [...b.nodes, ...pasted.nodes], edges: [...b.edges, ...pasted.edges] });
    setSelected(new Set(pasted.nodes.map((n) => n.id)));
  };

  /** Copies of cards (and the lines between them), free of any project and not locked, moved by `offset`. */
  function cloneCards(nodes: CNode[], edges: CEdge[], offset: number, at?: { x: number; y: number }) {
    const map = new Map<string, string>();
    const box = bounds(nodes);
    const dx = at ? snapGrid(at.x - box.width / 2, snapOn) - box.x : offset;
    const dy = at ? snapGrid(at.y - box.height / 2, snapOn) - box.y : offset;
    const copies = nodes.map((n) => {
      const id = newId();
      map.set(n.id, id);
      const { neuralvault: _b, nvLocked: _l, ...rest } = n;
      void _b;
      void _l;
      return { ...rest, id, x: n.x + dx, y: n.y + dy } as CNode;
    });
    const lines = edges
      .filter((e) => map.has(e.fromNode) && map.has(e.toNode))
      .map((e) => {
        const { neuralvault: _b, ...rest } = e;
        void _b;
        return { ...rest, id: newId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! } as CEdge;
      });
    return { nodes: copies, edges: lines };
  }

  const arrange = (how: Alignment | 'x' | 'y') => {
    const b = boardRef.current;
    if (!b) return;
    const sel = b.nodes.filter((n) => selected.has(n.id) && !locked(n));
    const moved = how === 'x' || how === 'y' ? distribute(sel, how) : align(sel, how);
    const at = new Map(moved.map((n) => [n.id, n]));
    commit({ ...b, nodes: b.nodes.map((n) => at.get(n.id) ?? n) });
  };

  /** A text or note card's height set to what it holds. */
  const fitToContent = (ids: Set<string>) => {
    const b = boardRef.current;
    if (!b) return;
    const heights = new Map<string, number>();
    for (const id of ids) {
      const el = surface.current?.querySelector<HTMLElement>(`.canvas-card[data-id="${CSS.escape(id)}"]`);
      const body = el?.querySelector<HTMLElement>('.canvas-card-body');
      const inner = body?.firstElementChild as HTMLElement | null;
      if (!el || !body || !inner) continue;
      const title = el.querySelector<HTMLElement>('.canvas-card-title')?.offsetHeight ?? 0;
      const pad = body.offsetHeight - body.clientHeight + parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(body).paddingBottom);
      heights.set(id, Math.min(2400, Math.max(MIN_H, Math.ceil(inner.scrollHeight + title + pad + 4))));
    }
    if (heights.size) commit({ ...b, nodes: b.nodes.map((n) => (heights.has(n.id) ? { ...n, height: snapGrid(heights.get(n.id)! + (snapOn ? GRID / 2 - 1 : 0), snapOn) } : n)) });
  };

  const beginEdit = (node: CNode, kind: 'text' | 'note' | 'bound') => {
    editBase.current = boardRef.current;
    setSelected(new Set([node.id]));
    setEditing({ id: node.id, kind });
  };

  const startEdit = (node: CNode) => {
    if (!canEdit || locked(node)) return;
    const kind = node.type === 'text' && !node.neuralvault ? 'text' : node.type === 'file' && isNotePath(node.file) && !node.neuralvault && !node.subpath ? 'note' : editableWords(node) !== null ? 'bound' : null;
    if (!kind) return;
    // A folded Systems note is edited on its record page: editing the ghost would write a stub note that
    // shadows the row's facts behind the same name.
    if (kind === 'note' && node.file && !getState().byPath?.has(node.file)) {
      void workCall<string | null>('systems', 'resolve-row', A.titleOf(node.file)).then(
        (row) => (row ? A.openPath(row, { where: 'tab' }) : beginEdit(node, kind)),
        () => beginEdit(node, kind),
      );
      return;
    }
    beginEdit(node, kind);
  };

  /** A file card opened: a folded Systems note opens its record (its name still opens its row); anything
   *  truly gone opens as the missing file it is, never a new note. */
  const openFileCard = (n: CNode, newTab: boolean): void => {
    const file = n.file!;
    // Opening from the canvas (t239): where the person is, so Back returns; held Ctrl or Cmd opens beside instead.
    const where = newTab ? 'tab' : 'current';
    const heading = n.subpath?.replace(/^#/, '') || undefined;
    if (getState().byPath?.has(file) || (getState().files ?? []).some((f) => f.rel === file)) {
      A.openPath(file, { where, heading });
      return;
    }
    void workCall<string | null>('systems', 'resolve-row', A.titleOf(file)).then(
      (row) => A.openPath(row ?? file, row ? { where } : { where, heading }),
      () => A.openPath(file, { where, heading }),
    );
  };

  const openCard = (n: CNode, newTab: boolean) => {
    const b = n.neuralvault;
    if (b?.part === 'project' || b?.part === 'portfolio-project') A.openPath(b.project, { where: newTab ? 'tab' : 'current', mode: 'page' });
    else if (b?.part === 'file') boardProject && A.openFolderFile(boardProject, b.rel, newTab ? 'tab' : 'current');
    else if (b?.part === 'item' && b.section === 'documents') {
      const x = itemOf(n);
      if (x && boardProject) A.openFolderFile(boardProject, (x.item as { path: string }).path, newTab ? 'tab' : 'current');
    } else if (n.type === 'file' && n.file) openFileCard(n, newTab);
    else if (n.type === 'link' && n.url) window.open(n.url, '_blank');
  };

  // ── Copy and paste ──────────────────────────────────────────────────────────────────────────────────────────────

  const isTyping = (t: EventTarget | null) => !!editing || !!(t as HTMLElement | null)?.closest?.('textarea, input, .cm-editor');

  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (isTyping(e.target)) return;
    const b = boardRef.current;
    if (!b || !selected.size) return;
    const nodes = b.nodes.filter((n) => selected.has(n.id));
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    const plain = nodes.map((n) => (n.type === 'text' ? n.text ?? '' : n.type === 'file' ? `[[${n.file}]]` : n.type === 'link' ? n.url ?? '' : n.label ?? '')).filter(Boolean).join('\n\n') || ' ';
    clip = { nodes: structuredClone(nodes), edges: structuredClone(b.edges.filter((x) => ids.has(x.fromNode) && ids.has(x.toNode))), plain };
    e.clipboardData.setData('text/plain', plain);
    e.preventDefault();
    if (cut && canEdit) removeSelected();
    else toast(nodes.length === 1 ? 'Copied. Paste it here or on another canvas.' : `${nodes.length} cards copied. Paste them here or on another canvas.`);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    if (isTyping(e.target) || !canEdit) return;
    const b = boardRef.current;
    if (!b) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const files = [...e.clipboardData.files];
    const at = here();
    if (clip && text === clip.plain) {
      const pasted = cloneCards(clip.nodes, clip.edges, 0, at);
      commit({ ...b, nodes: [...b.nodes, ...pasted.nodes], edges: [...b.edges, ...pasted.edges] });
      setSelected(new Set(pasted.nodes.map((n) => n.id)));
      return;
    }
    if (files.length) {
      const added: CNode[] = [];
      for (const [i, f] of files.entries()) {
        try {
          const name = f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? f.name : pastedPictureName((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
          const rel = await window.nv.files.saveAttachment(name, new Uint8Array(await f.arrayBuffer()), path);
          const image = isImage(rel);
          added.push({ id: newId(), type: 'file', file: rel, x: snapGrid(at.x - 180 + i * 30, snapOn), y: snapGrid(at.y - 130 + i * 30, snapOn), width: image ? 360 : 320, height: image ? 260 : 120 });
        } catch (err) {
          showError(err);
        }
      }
      await loadFiles();
      const now = boardRef.current!;
      commit({ ...now, nodes: [...now.nodes, ...added] });
      setSelected(new Set(added.map((n) => n.id)));
      return;
    }
    const t = text.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) addNode({ type: 'link', url: t, x: snapGrid(at.x - 170, snapOn), y: snapGrid(at.y - 45, snapOn), width: 340, height: 92 });
    else addNode({ type: 'text', text: t, x: snapGrid(at.x - 150, snapOn), y: snapGrid(at.y - 50, snapOn), width: 300, height: Math.min(600, 60 + Math.ceil(t.length / 36) * 24) });
  };

  // ── Keys ────────────────────────────────────────────────────────────────────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const b = boardRef.current;
    if (e.key === ' ' && e.target === e.currentTarget) {
      // Held: the view moves with the pointer, from anywhere.
      e.preventDefault();
      space.current = true;
      surface.current?.classList.add('is-space');
      return;
    }
    if (e.key === 'Shift') surface.current?.classList.add('is-shift');
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      e.preventDefault();
      removeSelected();
    } else if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && key === 'a' && b) {
      e.preventDefault();
      setSelected(new Set(b.nodes.map((n) => n.id)));
    } else if (mod && key === 'd') {
      e.preventDefault();
      duplicate();
    } else if (mod && key === 'f') {
      e.preventDefault();
      setSearch((s) => s ?? { query: '', at: 0 });
    } else if (e.key === '=' || e.key === '+' || (mod && e.code === 'NumpadAdd')) {
      // + or Ctrl+= (the app's own zoom keys are left to the canvas while it has the keys: data-own-zoom).
      e.preventDefault();
      zoomAt(1.25, undefined, undefined, true);
      noteMoved();
    } else if (e.key === '-' || e.key === '_' || (mod && e.code === 'NumpadSubtract')) {
      e.preventDefault();
      zoomAt(0.8, undefined, undefined, true);
      noteMoved();
    } else if (mod && !e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && b) {
      e.preventDefault();
      fitTo(b.nodes, true);
    } else if (e.shiftKey && (e.key === ')' || e.code === 'Digit0')) {
      e.preventDefault();
      zoomTo(1);
    } else if (e.shiftKey && (e.key === '!' || e.code === 'Digit1') && b) {
      e.preventDefault();
      fitTo(b.nodes, true);
    } else if (e.shiftKey && (e.key === '@' || e.code === 'Digit2') && b && selected.size) {
      e.preventDefault();
      fitTo(b.nodes.filter((n) => selected.has(n.id)), true, 2);
    } else if (e.key === 'Enter' && selected.size === 1) {
      const n = byId.get([...selected][0]);
      if (n) {
        e.preventDefault();
        if (n.type === 'group') setLabelEditing(n.id);
        else startEdit(n);
      }
    } else if (e.key === 'Escape') {
      setSelected(new Set());
      setSwatches(false);
    } else if (e.key.startsWith('Arrow') && selected.size && b) {
      e.preventDefault();
      const step = e.shiftKey ? GRID * 2 : snapOn ? GRID : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      commit({ ...b, nodes: b.nodes.map((n) => (selected.has(n.id) && !locked(n) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
    } else if (e.key.startsWith('Arrow') && !mod) {
      // Nothing picked: the arrows move the view (Shift: most of a screen).
      const p = arrowPan(e.key, e.shiftKey, size);
      if (p) {
        e.preventDefault();
        panBy(p.dx, p.dy, true);
        noteMoved();
      }
    } else if (!mod && !e.altKey && canEdit) {
      if (key === 't') {
        e.preventDefault();
        addText(pointer.current ?? free(280, 100));
      } else if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        addText(pointer.current ?? free(220, 170), '3');
      } else if (key === 'g') {
        e.preventDefault();
        addGroup();
      }
    }
  };

  // ── Pointer: dragging, resizing, joining, panning, selecting ────────────────────────────────────────────────────

  /** Cards to line up with while moving: those on screen that aren't moving. */
  const snapTargets = (moving: Set<string>) => {
    const v = viewRef.current;
    const seen = { x: -v.x / v.k - 200, y: -v.y / v.k - 200, width: size.width / v.k + 400, height: size.height / v.k + 400 };
    return (boardRef.current?.nodes ?? []).filter((n) => !moving.has(n.id) && intersects(n, seen));
  };

  const startDrag = (e: ReactPointerEvent, node: CNode) => {
    const b = boardRef.current;
    if (e.button !== 0 || editing?.id === node.id || !b) return;
    e.stopPropagation();
    surface.current?.focus({ preventScroll: true });
    setSwatches(false);
    // A group's empty inside is canvas: dragging there moves the view (a click picks the group). A group moves by its
    // name, or once it's picked.
    if (node.type === 'group' && !selected.has(node.id) && !(e.target as HTMLElement).closest('.cv-group-label')) {
      if (editing) setEditing(null);
      setEdgeEditing(null);
      startEmpty(e, node);
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const picked = selected.has(node.id) && !additive ? new Set(selected) : additive ? new Set(selected.has(node.id) ? [...selected].filter((id) => id !== node.id) : [...selected, node.id]) : new Set([node.id]);
    const pickedBefore = selected;
    setSelected(picked);
    // A second finger arriving (a pinch) gives back what was picked before.
    gesture.current = { cancel: () => setSelected(pickedBefore) };
    if (editing) setEditing(null);
    if (!canEdit) return;
    // A group carries the cards inside it (they move with it; only the group is selected). Locked cards stay put.
    const ids = new Set([...picked].filter((id) => !locked(byId.get(id))));
    for (const id of [...ids]) {
      const g = byId.get(id);
      if (g?.type === 'group') for (const n of b.nodes) if (n.id !== g.id && !locked(n) && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height) ids.add(n.id);
    }
    if (!ids.size) return;
    const start = toWorld(e.clientX, e.clientY);
    const origin = new Map(b.nodes.filter((n) => ids.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
    const box = bounds(b.nodes.filter((n) => ids.has(n.id)));
    const targets = snapTargets(ids);
    const base = b;
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    // Two fingers arriving (a pinch) call the move off: the card goes back where it was, and what was picked before.
    gesture.current = {
      cancel: () => {
        setSelected(pickedBefore);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        setGuides([]);
        boardRef.current = base;
        setBoard(base);
      },
    };
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const rdx = p.x - start.x;
      const rdy = p.y - start.y;
      if (!moved && Math.hypot(rdx, rdy) * viewRef.current.k < 3) return;
      moved = true;
      const s = ev.altKey ? { dx: Math.round(rdx), dy: Math.round(rdy), guides: [] } : snapMove(box, rdx, rdy, targets, 6 / viewRef.current.k, snapOn);
      setGuides(s.guides);
      const next = { ...base, nodes: base.nodes.map((n) => (origin.has(n.id) ? { ...n, x: origin.get(n.id)!.x + s.dx, y: origin.get(n.id)!.y + s.dy } : n)) };
      boardRef.current = next;
      setBoard(next);
    };
    const up = async () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      gesture.current = null;
      setGuides([]);
      if (!moved || !boardRef.current) return;
      const final = boardRef.current;
      // The portfolio board: a project's card in another column changes its status (or health).
      const pending: Promise<boolean>[] = [];
      const movedCards: { name: string; label: string; project: string; by: 'status' | 'health'; before: string | null; run(): void }[] = [];
      if (final.neuralvault?.kind === 'portfolio') {
        const by = final.neuralvault.groupBy;
        for (const n of final.nodes) {
          const pb = n.neuralvault;
          if (pb?.part !== 'portfolio-project' || !origin.has(n.id)) continue;
          const was = columnAt(base, base.nodes.find((x) => x.id === n.id)!);
          const now = columnAt(final, n);
          if (!now || now === was) continue;
          const p = bound.current.entries?.find((x) => x.path === pb.project)?.project;
          const before = p ? (by === 'health' ? p.health : p.status) ?? null : null;
          const label = columnsFor(by, bound.current.entries ?? []).find((c) => c.key === now)?.label ?? now;
          // A drag onto Done asks first when tasks are still open (several cards queue one dialog after another):
          // the card stays where it was until they are answered.
          const val = columnValue(now);
          if (by === 'status' && val !== null && wantsDone({ kind: 'set', field: 'status', value: val })) {
            const proj = p ?? (await window.nv.projects.view(pb.project).then((v) => v.project).catch(() => null));
            if (proj && openProjectTasks(proj).length) {
              requestDone(pb.project);
              const orig = base.nodes.find((x) => x.id === n.id)!;
              final.nodes = final.nodes.map((x) => (x.id === n.id ? { ...x, x: orig.x, y: orig.y } : x));
              continue;
            }
            pending.push(writeField(pb.project, by, val));
          } else pending.push(setField(pb.project, by, columnValue(now)));
          // It settles into a free place in its new column.
          const col = final.nodes.find((x) => x.neuralvault?.part === 'column' && x.neuralvault.key === now);
          if (col) {
            const spot = placeInGroup(final.nodes.filter((x) => x.id !== n.id), col, n.width, n.height);
            const settled = { ...n, x: spot.x, y: spot.y };
            final.nodes = final.nodes.map((x) => (x.id === n.id ? settled : x.id === col.id ? spot.group : x));
          }
          // The column it left closes up behind it.
          if (was) final.nodes = closeUpColumn(final.nodes, was);
          movedCards.push({ name: p?.name ?? 'The project', label, project: pb.project, by, before: typeof before === 'string' ? before : null, run: () => { void setField(pb.project, by, before).then(() => boardRef.current && commit(boardRef.current, false)); } });
        }
      }
      // The board settles only when the projects did (W5-30): a failed write puts the cards back.
      const results = pending.length ? await Promise.all(pending) : [];
      if (results.some((ok) => !ok)) {
        // The optimistic card words go back too, so board and list agree with the project.
        for (const m of movedCards) if (bound.current.entries) bound.current.entries = bound.current.entries.map((e) => (e.path === m.project ? { ...e, project: { ...e.project, [m.by]: m.before ?? undefined } } : e));
        if (bound.current.entries) setEntries(bound.current.entries);
        commit(base, false);
        return;
      }
      for (const m of movedCards) toast(`${m.name} is now ${m.label.toLowerCase()}.`, { label: 'Undo', run: m.run });
      commit(final, true, base);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const startResize = (e: ReactPointerEvent, node: CNode | null, handle: Handle) => {
    const b = boardRef.current;
    if (!b || !canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    const start = toWorld(e.clientX, e.clientY);
    const base = b;
    const members = node ? [node] : b.nodes.filter((n) => selected.has(n.id) && !locked(n));
    if (!members.length) return;
    const box = node ? { x: node.x, y: node.y, width: node.width, height: node.height } : bounds(members);
    const ids = new Set(members.map((n) => n.id));
    const targets = snapTargets(ids);
    const ratio = node?.type === 'file' && isImage(node.file ?? '');
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const { rect, guides: g } = resizeRect(box, handle, p.x - start.x, p.y - start.y, {
        keepRatio: ev.shiftKey !== !!ratio,
        grid: snapOn && !ev.altKey,
        others: ev.altKey ? [] : targets,
        threshold: 6 / viewRef.current.k,
        minW: node?.type === 'group' ? 160 : MIN_W,
        minH: node?.type === 'group' ? 100 : MIN_H,
      });
      setGuides(g);
      const sized = node ? [{ ...node, ...rect }] : scaleInto(members, box, rect);
      const at = new Map(sized.map((n) => [n.id, n]));
      const next = { ...base, nodes: base.nodes.map((n) => at.get(n.id) ?? n) };
      boardRef.current = next;
      setBoard(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setGuides([]);
      if (boardRef.current && boardRef.current !== base) commit(boardRef.current, true, base);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const connectNew = (fromId: string, side: Side, at: { x: number; y: number }, kind: 'text' | 'note' | 'media' | 'link') => {
    const b = boardRef.current;
    if (!b) return;
    const join = (card: CNode, edit: 'text' | 'note' | null) => {
      const now = boardRef.current!;
      const from = now.nodes.find((n) => n.id === fromId);
      if (!from) return;
      const edge: CEdge = { id: newId(), fromNode: fromId, fromSide: side, toNode: card.id, toSide: facing(card, anchor(from, side)) };
      commit({ ...now, nodes: [...now.nodes, card], edges: [...now.edges, edge] });
      setSelected(new Set([card.id]));
      if (edit) {
        editBase.current = boardRef.current;
        setEditing({ id: card.id, kind: edit });
      }
    };
    if (kind === 'text') join({ id: newId(), type: 'text', text: '', x: snapGrid(at.x - 140, snapOn), y: snapGrid(at.y - 50, snapOn), width: 280, height: 100 }, 'text');
    else if (kind === 'link')
      void prompt('Add a web link', { placeholder: 'https://…', ok: 'Add' }).then((url) => url?.trim() && join({ id: newId(), type: 'link', url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, x: snapGrid(at.x - 170, snapOn), y: snapGrid(at.y - 45, snapOn), width: 340, height: 92 }, null));
    else {
      const paths = getState().files.filter((f) => (kind === 'note' ? f.kind === 'note' : f.kind !== 'note' && f.kind !== 'canvas')).map((f) => f.rel);
      void pickFile(kind === 'note' ? 'Join which note?' : 'Join which picture or file?', paths, kind === 'note' ? A.titleOf : A.nameOf).then((chosen) => {
        if (!chosen) return;
        const image = isImage(chosen);
        const note = isNotePath(chosen);
        join({ id: newId(), type: 'file', file: chosen, x: snapGrid(at.x - 180, snapOn), y: snapGrid(at.y - 120, snapOn), width: image ? 360 : note ? 400 : 320, height: image ? 260 : note ? 340 : 120 }, null);
      });
    }
  };

  const startLink = (e: ReactPointerEvent, node: CNode, side: Side) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const p0 = anchor(node, side);
    setLinking({ from: node.id, side, x: p0.x, y: p0.y });
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      setLinking({ from: node.id, side, x: p.x, y: p.y });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setLinking(null);
      const p = toWorld(ev.clientX, ev.clientY);
      const b = boardRef.current;
      if (!b) return;
      const hit = [...b.nodes].reverse().find((n) => n.id !== node.id && n.type !== 'group' && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) ?? [...b.nodes].reverse().find((n) => n.id !== node.id && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height);
      if (hit) {
        const edge: CEdge = { id: newId(), fromNode: node.id, fromSide: side, toNode: hit.id, toSide: facing(hit, p0) };
        commit({ ...b, edges: [...b.edges, edge] });
        setSelected(new Set([edge.id]));
      } else if (Math.hypot(p.x - p0.x, p.y - p0.y) > 40) {
        // Let go on empty space: what to make there, joined.
        openMenu({ clientX: ev.clientX, clientY: ev.clientY }, [
          { heading: 'A new card, joined' },
          { label: 'Text card', icon: 'text', run: () => connectNew(node.id, side, p, 'text') },
          { label: 'Note…', icon: 'filePlus', run: () => connectNew(node.id, side, p, 'note') },
          { label: 'Picture or file…', icon: 'image', run: () => connectNew(node.id, side, p, 'media') },
          { label: 'Web link…', icon: 'link', run: () => connectNew(node.id, side, p, 'link') },
        ]);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /** Dragging the canvas itself: the view follows the pointer (the hint's job is done). A press that doesn't move is a
   * click: `onClick`. */
  const startPan = (e: ReactPointerEvent, onClick?: () => void) => {
    const el = surface.current;
    if (!el) return;
    if (anim.current) {
      cancelAnimationFrame(anim.current.id);
      anim.current = null;
    }
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = viewRef.current;
    const id = e.pointerId;
    let moved = false;
    try {
      el.setPointerCapture(id);
    } catch {
      // The pointer had already gone.
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) {
        moved = true;
        el.classList.add('is-panning');
      }
      setView({ ...v0, x: v0.x + dx, y: v0.y + dy });
    };
    const end = (ev: PointerEvent | null, cancelled: boolean) => {
      if (ev && ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.classList.remove('is-panning');
      if (gesture.current === handle) gesture.current = null;
      if (moved) noteMoved();
      else if (!cancelled) onClick?.();
    };
    const up = (ev: PointerEvent) => end(ev, false);
    const cancel = (ev: PointerEvent) => end(ev, true);
    const handle = { cancel: () => end(null, true) };
    gesture.current = handle;
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };

  /** Shift (or Ctrl) and drag on empty space: a box that selects the cards it touches. */
  const startMarquee = (e: ReactPointerEvent) => {
    const el = surface.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setSelected(new Set());
    const keep = additive ? new Set(selected) : new Set<string>();
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    const move = (ev: PointerEvent) => {
      const q = toWorld(ev.clientX, ev.clientY);
      setMarquee({ x0: p.x, y0: p.y, x1: q.x, y1: q.y });
      const r = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) };
      // A group is picked only when the region holds all of it (so a region inside a group picks its cards).
      const hits = (boardRef.current?.nodes ?? []).filter((n) => (n.type === 'group' ? n.x >= r.x && n.y >= r.y && n.x + n.width <= r.x + r.width && n.y + n.height <= r.y + r.height : intersects(n, r))).map((n) => n.id);
      setSelected(new Set([...keep, ...hits]));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (gesture.current === handle) gesture.current = null;
      setMarquee(null);
    };
    const handle = { cancel: up };
    gesture.current = handle;
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  /** A press on empty canvas (or a group's empty inside): drag moves the view, Shift+drag selects, a click clears the
   * selection (or picks the group). */
  const startEmpty = (e: ReactPointerEvent, group: CNode | null) => {
    if (e.button !== 0) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      startMarquee(e);
      return;
    }
    startPan(e, () => setSelected(group ? new Set([group.id]) : new Set()));
  };

  const onSurfaceDown = (e: ReactPointerEvent) => {
    surface.current?.focus({ preventScroll: true });
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('canvas-world')) return;
    setEditing(null);
    setEdgeEditing(null);
    setSwatches(false);
    startEmpty(e, null);
  };

  /** Space held, or the middle button: the view moves from anywhere, over cards too (not over the bars). */
  const onSurfaceDownCapture = (e: ReactPointerEvent) => {
    const onBar = (e.target as HTMLElement).closest('.cv-toolbar, .cv-zoom, .cv-bar, .cv-search, .cv-board-bar, .cv-nav-hint');
    if (onBar || !(e.button === 1 || (e.button === 0 && space.current))) return;
    e.preventDefault();
    e.stopPropagation();
    surface.current?.focus({ preventScroll: true });
    startPan(e);
  };

  /** The wheel: a trackpad's two fingers or a mouse wheel move the view (Shift: sideways); Ctrl+wheel or a pinch zooms
   * around the pointer. A card that scrolls (a long note) scrolls first, until it reaches its end. */
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('.cv-search')) return;
    const scroller = t.closest?.('.canvas-card-body.is-scrollable, .cv-editor');
    if (scroller && !(e.ctrlKey || e.metaKey) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      const room = e.deltaY > 0 ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : scroller.scrollTop;
      if (room > 1) return;
    }
    const w = wheelIntent(e);
    if (w.kind === 'zoom') zoomAt(w.factor, e.clientX, e.clientY, w.step);
    else panBy(-w.dx, -w.dy);
    noteMoved();
  };
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    // Passive: nothing behind the canvas scrolls or zooms with the wheel, so input never waits on this.
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Two fingers on a touch screen: zoom and move together. (One finger works as the mouse does: on empty canvas it moves
  // the view, on a card it moves the card.)
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { v0: View; a0: { x: number; y: number }; b0: { x: number; y: number }; ids: [number, number] } | null = null;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, local(e));
      if (fingers.size < 2) return;
      // The second finger (and any more) belongs to the pinch, not to a card under it.
      e.stopPropagation();
      e.preventDefault();
      if (pinch) return;
      gesture.current?.cancel();
      gesture.current = null;
      if (anim.current) {
        cancelAnimationFrame(anim.current.id);
        anim.current = null;
      }
      const [[ia, a0], [ib, b0]] = [...fingers];
      pinch = { v0: viewRef.current, a0, b0, ids: [ia, ib] };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Gone already.
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, local(e));
      if (!pinch) return;
      const a1 = fingers.get(pinch.ids[0]);
      const b1 = fingers.get(pinch.ids[1]);
      if (a1 && b1) setView(pinchView(pinch.v0, pinch.a0, pinch.b0, a1, b1));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      fingers.delete(e.pointerId);
      if (pinch && !pinch.ids.every((id) => fingers.has(id))) {
        pinch = null;
        noteMovedRef.current();
      }
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    };
  }, [setView]);

  // ── Dropping files ──────────────────────────────────────────────────────────────────────────────────────────────

  const projectFolder = projectView?.project.folder;
  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    if (!canEdit) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const internal = e.dataTransfer.getData('application/x-nv-paths');
    let paths = internal ? internal.split('\n').filter(Boolean) : [];
    const external = !paths.length && e.dataTransfer.files.length ? [...e.dataTransfer.files].map((f) => window.nv.files.pathOf(f)).filter(Boolean) : [];
    // On a project's canvas, files from the PC are copied into the project's folder (the originals stay where they are).
    if (external.length && boardProject && projectFolder) {
      try {
        const copied = await window.nv.projects.addFiles(boardProject, external);
        const b = boardRef.current;
        if (!b || !copied.length) return;
        const cards = copied.map((rel, i) => fileCard(rel, { x: snapGrid(at.x - 150 + i * 24, snapOn), y: snapGrid(at.y - 40 + i * 24, snapOn) }, i));
        commit({ ...b, nodes: [...b.nodes, ...cards] });
        setSelected(new Set(cards.map((c) => c.id)));
        const name = projectView?.project.name ?? 'the project';
        toast(`${copied.length === 1 ? `Copied ${copied[0]}` : `Copied ${copied.length} files`} into ${name}’s folder. The ${copied.length === 1 ? 'original is' : 'originals are'} where ${copied.length === 1 ? 'it was' : 'they were'}.`, undefined, 6500);
      } catch (err) {
        showError(err);
      }
      return;
    }
    if (external.length) {
      paths = await window.nv.files.importPaths(external, null, path).catch(() => []);
      await loadFiles();
    }
    const b = boardRef.current;
    if (!paths.length || !b) return;
    // Dropped on an empty card ("Type, or drop a file"): the first file fills it, where it is.
    const blank = [...b.nodes].reverse().find((n) => n.type === 'text' && !n.neuralvault && !locked(n) && !(n.text ?? '').trim() && at.x >= n.x && at.x <= n.x + n.width && at.y >= n.y && at.y <= n.y + n.height);
    const added = paths.map((p, i) => {
      const image = isImage(p);
      const note = isNotePath(p);
      const size = { width: image ? 360 : note ? 400 : 320, height: image ? 260 : note ? 340 : 120 };
      if (i === 0 && blank) return { ...blank, type: 'file' as const, file: p, text: undefined, width: Math.max(blank.width, size.width), height: Math.max(blank.height, size.height) };
      return { id: newId(), type: 'file' as const, file: p, x: snapGrid(at.x + i * 30, snapOn), y: snapGrid(at.y + i * 30, snapOn), ...size };
    });
    const ids = new Set(added.map((n) => n.id));
    commit({ ...b, nodes: [...b.nodes.map((n) => (blank && n.id === blank.id ? added[0] : n)), ...added.filter((n) => !blank || n.id !== blank.id)] });
    setSelected(ids);
  };

  // ── Menus ───────────────────────────────────────────────────────────────────────────────────────────────────────

  const colourItems = (): MenuItem[] => [{ label: 'No colour', run: () => setColor(undefined) }, ...Object.entries(PRESETS).map(([k, v]) => ({ label: v.name, run: () => setColor(k) }))];

  const edgeItems = (edge: CEdge): MenuItem[] => [
    { label: 'Label', icon: 'edit', disabled: !canEdit, run: () => setEdgeEditing(edge.id) },
    { label: 'Line', icon: 'diagram', disabled: !canEdit, submenu: (['curved', 'straight', 'elbow'] as LineStyle[]).map((s) => ({ label: s === 'curved' ? 'Curved' : s === 'straight' ? 'Straight' : 'Elbow', checked: lineOf(edge) === s, run: () => setEdge(edge.id, { nvLine: s === 'curved' ? undefined : s }) })) },
    { label: 'Dashed', checked: edge.nvDash === true, disabled: !canEdit, run: () => setEdge(edge.id, { nvDash: edge.nvDash === true ? undefined : true }) },
    { label: 'Arrow at the end', checked: (edge.toEnd ?? 'arrow') === 'arrow', disabled: !canEdit, run: () => setEdge(edge.id, { toEnd: (edge.toEnd ?? 'arrow') === 'arrow' ? 'none' : 'arrow' }) },
    { label: 'Arrow at the start', checked: edge.fromEnd === 'arrow', disabled: !canEdit, run: () => setEdge(edge.id, { fromEnd: edge.fromEnd === 'arrow' ? 'none' : 'arrow' }) },
    { label: 'Colour', icon: 'palette', disabled: !canEdit, submenu: colourItems() },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: removeSelected },
  ];

  const contextMenu = (e: React.MouseEvent, node?: CNode, edge?: CEdge) => {
    e.preventDefault();
    e.stopPropagation();
    const at = toWorld(e.clientX, e.clientY);
    if (node || edge) {
      const id = (node ?? edge)!.id;
      if (!selected.has(id)) setSelected(new Set([id]));
    }
    if (edge) return openMenu(e, edgeItems(edge));
    if (node) {
      const b = node.neuralvault;
      const many = selected.has(node.id) && selected.size > 1;
      const isLocked = locked(node);
      const items: MenuItem[] = [
        ...(node.type === 'text' && !b ? [{ label: 'Edit', icon: 'edit', hotkey: 'Enter', disabled: !canEdit || isLocked, run: () => startEdit(node) } as MenuItem] : []),
        ...(editableWords(node) !== null && b ? [{ label: 'Edit the words', icon: 'edit', hotkey: 'Enter', disabled: !canEdit, run: () => startEdit(node) } as MenuItem] : []),
        ...(node.type === 'file' && isNotePath(node.file) && !b ? [{ label: 'Write in the note here', icon: 'edit', hotkey: 'Enter', disabled: !canEdit || isLocked, run: () => startEdit(node) } as MenuItem] : []),
        ...(node.type === 'file' && node.file && !b ? [{ label: 'Open', icon: 'external', run: () => openCard(node, false) } as MenuItem, ...fileMenu(node.file).slice(0, 2)] : []),
        ...(node.type === 'link' ? [{ label: 'Open the link', icon: 'external', run: () => openCard(node, false) } as MenuItem] : []),
        ...(b?.part === 'project' || b?.part === 'portfolio-project' ? [{ label: 'Open the project’s page', icon: 'external', run: () => openCard(node, false) } as MenuItem] : []),
        ...(b?.part === 'doc' || b?.part === 'section' ? [{ label: b.part === 'section' ? `Open the doc at ${b.heading}` : 'Open the doc', icon: 'external', run: () => openCard(node, false) } as MenuItem] : []),
        ...(b?.part === 'file' || (b?.part === 'item' && b.section === 'documents') ? [{ label: 'Open the file', icon: 'external', run: () => openCard(node, false) } as MenuItem] : []),
        ...(node.type === 'group' ? [{ label: 'Rename the group', icon: 'edit', disabled: !canEdit || isLocked, run: () => setLabelEditing(node.id) } as MenuItem] : []),
        { separator: true },
        ...(node.type === 'text' || (node.type === 'file' && isNotePath(node.file)) ? [{ label: 'Fit the card to what’s in it', icon: 'expand', disabled: !canEdit || isLocked, run: () => fitToContent(many ? new Set(selected) : new Set([node.id])) } as MenuItem] : []),
        { label: 'Colour', icon: 'palette', disabled: !canEdit, submenu: colourItems() },
        ...(many
          ? [
              {
                label: 'Arrange',
                icon: 'layers',
                disabled: !canEdit,
                submenu: [
                  { label: 'Line up left edges', run: () => arrange('left') },
                  { label: 'Line up centres', run: () => arrange('centre') },
                  { label: 'Line up right edges', run: () => arrange('right') },
                  { separator: true },
                  { label: 'Line up tops', run: () => arrange('top') },
                  { label: 'Line up middles', run: () => arrange('middle') },
                  { label: 'Line up bottoms', run: () => arrange('bottom') },
                  { separator: true },
                  { label: 'Space evenly across', disabled: selected.size < 3, run: () => arrange('x') },
                  { label: 'Space evenly down', disabled: selected.size < 3, run: () => arrange('y') },
                ],
              } as MenuItem,
              { label: 'Put in a group', icon: 'frame', hotkey: 'G', disabled: !canEdit, run: () => addGroup() } as MenuItem,
            ]
          : []),
        { label: isLocked ? 'Unlock' : 'Lock in place', icon: 'lock', disabled: !canEdit, run: () => update(many ? new Set(selected) : new Set([node.id]), (n) => ({ ...n, nvLocked: isLocked ? undefined : true })) },
        { label: 'Duplicate', icon: 'copy', hotkey: 'Mod+D', disabled: !canEdit, run: duplicate },
        { label: 'Bring to the front', disabled: !canEdit, run: () => { const b0 = boardRef.current; if (b0) commit({ ...b0, nodes: [...b0.nodes.filter((n) => !selected.has(n.id) && n.id !== node.id), ...b0.nodes.filter((n) => selected.has(n.id) || n.id === node.id)] }); } },
        { label: 'Send to the back', disabled: !canEdit, run: () => { const b0 = boardRef.current; if (b0) commit({ ...b0, nodes: [...b0.nodes.filter((n) => selected.has(n.id) || n.id === node.id), ...b0.nodes.filter((n) => !selected.has(n.id) && n.id !== node.id)] }); } },
        { label: 'Zoom to it', icon: 'fit', hotkey: 'Shift+2', run: () => fitTo(many ? (boardRef.current?.nodes ?? []).filter((n) => selected.has(n.id)) : [node], true, 2) },
        { separator: true },
        ...(b?.part === 'item' ? [{ label: 'Take it out of the project…', icon: 'trash', danger: true, disabled: !canEdit, run: () => void removeFromProject(node) } as MenuItem] : []),
        { label: b && b.part !== 'file' ? 'Take off the canvas' : 'Delete', icon: 'trash', danger: !b, hotkey: 'Delete', disabled: !canEdit || b?.part === 'project' || b?.part === 'column', run: removeSelected },
      ];
      return openMenu(e, items);
    }
    openMenu(e, [
      { heading: 'Add' },
      ...addMenu(at),
      { separator: true },
      ...(clip ? [{ label: 'Paste', icon: 'copy', hotkey: 'Mod+V', disabled: !canEdit, run: () => { const b = boardRef.current; if (!b || !clip) return; const p = cloneCards(clip.nodes, clip.edges, 0, at); commit({ ...b, nodes: [...b.nodes, ...p.nodes], edges: [...b.edges, ...p.edges] }); setSelected(new Set(p.nodes.map((n) => n.id))); } } as MenuItem] : []),
      { label: 'Select everything', hotkey: 'Mod+A', run: () => board && setSelected(new Set(board.nodes.map((n) => n.id))) },
      { label: 'Find on the canvas', icon: 'search', hotkey: 'Mod+F', run: () => setSearch({ query: '', at: 0 }) },
      { label: 'Show everything', icon: 'fit', hotkey: 'Shift+1', run: () => board && fitTo(board.nodes, true) },
      ...(meta?.kind === 'doc' ? [{ label: 'Update canvas from doc', icon: 'refresh', disabled: !canEdit, run: () => void updateDocCanvas(meta.doc) } as MenuItem] : boardKind ? [{ label: boardKind === 'portfolio' ? 'Lay the board out again' : 'Tidy up the project’s cards', icon: 'refresh', disabled: !canEdit, run: tidy } as MenuItem] : []),
      { separator: true },
      { label: 'Snap to the grid and other cards', checked: snapOn, run: () => setSnapOn((s) => (store('nv.canvas.snap', !s), !s)) },
      ...(roomForMap ? [{ label: 'Show the map', checked: minimapOn, run: () => setMinimapOn((s) => (store('nv.canvas.minimap', !s), !s)) }] : []),
    ]);
  };

  // ── The stable handlers cards call (so a card draws again only when it changes) ─────────────────────────────────

  const apiRef = useRef<CardApi>(null!);
  apiRef.current = {
    startDrag,
    startResize,
    startLink,
    doubleClick: (e, node) => {
      e.stopPropagation();
      const b = node.neuralvault;
      if (node.type === 'group') {
        if (canEdit && !locked(node)) setLabelEditing(node.id);
      } else if (b?.part === 'project' || b?.part === 'portfolio-project' || b?.part === 'file' || (b?.part === 'item' && b.section === 'documents') || (node.type === 'file' && node.subpath) || b?.part === 'doc') openCard(node, e.ctrlKey || e.metaKey);
      else if (node.type === 'text' || editableWords(node) !== null || (node.type === 'file' && isNotePath(node.file))) startEdit(node);
      else openCard(node, e.ctrlKey || e.metaKey);
    },
    contextMenu,
    openLink: (t, n) => void A.openLink(t, path, n ? 'right' : 'tab'),
    editText: (node, text, contentHeight) => {
      const b = boardRef.current;
      if (!b) return;
      const want = Math.ceil(contentHeight + 24);
      const next = { ...b, nodes: b.nodes.map((n) => (n.id === node.id ? { ...n, text, height: Math.max(n.height, Math.min(1600, want)) } : n)) };
      boardRef.current = next;
      setBoard(next);
    },
    finishEdit: (node, text) => {
      setEditing((now) => (now?.id === node.id ? null : now));
      const base = editBase.current;
      editBase.current = null;
      const b = boardRef.current;
      if (!b) return;
      if (node.neuralvault) {
        finishBound(node, text);
        return;
      }
      if (node.type === 'text') {
        const next = { ...b, nodes: b.nodes.map((n) => (n.id === node.id ? { ...n, text } : n)) };
        if (JSON.stringify(next) !== JSON.stringify(base)) commit(next, true, base);
      }
      surface.current?.focus({ preventScroll: true });
    },
    renameGroup: (node, label) => {
      if (label === null) {
        setLabelEditing(node.id);
        return;
      }
      setLabelEditing(null);
      if (label !== (node.label ?? '')) update(new Set([node.id]), (n) => ({ ...n, label }));
      surface.current?.focus({ preventScroll: true });
    },
    addToSection: (s) => void addToSection(s),
    openCard,
    startEdit,
    toggle: (node) => {
      const x = itemOf(node);
      if (x && x.b.section === 'next') editProject({ op: 'replace', section: 'next', key: x.b.key, index: x.b.index, item: { ...(x.item as { done: boolean; what: string }), done: !(x.item as { done: boolean }).done } });
    },
    level: (node, e) => {
      const x = itemOf(node);
      if (!x) return;
      const now = (x.item as { level?: string }).level;
      const set = (level?: string) => editProject({ op: 'replace', section: 'risks', key: x.b.key, index: x.b.index, item: { ...(x.item as { what: string }), level } });
      openMenu(e.currentTarget, [{ heading: 'How much it matters' }, ...RISK_LEVELS.map((l) => ({ label: l.charAt(0).toUpperCase() + l.slice(1), checked: now === l, run: () => set(l) })), { label: 'No level', checked: !now, run: () => set(undefined) }]);
    },
    choose: (projectPath, field, e) => {
      const p = projectPath === boardProject ? bound.current.project : entryMap.get(projectPath);
      const after = () => boardRef.current && commit(boardRef.current, false);
      if (field === 'progress') {
        openMenu(e.currentTarget, [0, 10, 25, 50, 75, 90, 100].map((n) => ({ label: `${n}%`, checked: p?.progress === n, run: () => void setField(projectPath, 'progress', n).then(after) })));
        return;
      }
      const values = field === 'health' ? ['on track', 'at risk', 'off track'] : ['idea', 'planning', 'active', 'on hold', 'done'];
      openMenu(e.currentTarget, values.map((v) => ({ label: v.charAt(0).toUpperCase() + v.slice(1), checked: (p?.[field] ?? '') === v, run: () => { void setField(projectPath, field, v); after(); } })));
    },
    openDoc: (rel) => boardProject && A.openFolderFile(boardProject, rel),
    openProject: (projectPath, newTab) => A.openPath(projectPath, { where: newTab ? 'tab' : 'current', mode: 'page' }),
  };
  const api = useMemo<CardApi>(() => new Proxy({} as CardApi, { get: (_t, key: string) => (...args: unknown[]) => (apiRef.current[key as keyof CardApi] as (...a: unknown[]) => unknown)(...args) }), []);
  const boundData = useMemo<BoundData>(() => ({ canEdit, project: projectView?.project, projectPath: boardProject, entries: entryMap, groupBy }), [canEdit, projectView, boardProject, entryMap, groupBy]);

  // ── What's drawn ────────────────────────────────────────────────────────────────────────────────────────────────

  const lv = levels(view.k);
  // Crossing from the whole cards to their overviews (or back): what comes in fades in briefly, so nothing jumps.
  const [switched, setSwitched] = useState(false);
  const lastDetail = useRef(lv.detail);
  useEffect(() => {
    if (lastDetail.current === lv.detail) return;
    lastDetail.current = lv.detail;
    setSwitched(true);
    const t = setTimeout(() => setSwitched(false), 260);
    return () => clearTimeout(t);
  }, [lv.detail]);
  // The dots stay calm far out: every 2nd, 4th… grid line once they'd crowd.
  let gridPx = GRID * view.k;
  while (gridPx < 14) gridPx *= 2;
  const seen: Rect = { x: -view.x / view.k - 300 / view.k, y: -view.y / view.k - 300 / view.k, width: (size.width + 600) / view.k, height: (size.height + 600) / view.k };
  const query = search?.query.trim().toLowerCase() ?? '';
  const matches = useMemo(() => (query && board ? board.nodes.filter((n) => cardWords(n).includes(query)) : []), [query, board]);
  const current = matches.length ? matches[((search?.at ?? 0) % matches.length + matches.length) % matches.length] : undefined;
  useEffect(() => {
    if (current) fitTo([current], true, Math.max(1, viewRef.current.k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);

  const selectedNodes = board?.nodes.filter((n) => selected.has(n.id)) ?? [];
  const selBox = selectedNodes.length ? bounds(selectedNodes) : null;
  const toolbarAt = selBox ? { x: selBox.x * view.k + view.x, y: selBox.y * view.k + view.y - 52 } : null;
  const oneEdge = selected.size === 1 && !selectedNodes.length ? board?.edges.find((e) => selected.has(e.id)) : undefined;
  const oneEdgeMid = oneEdge && byId.has(oneEdge.fromNode) && byId.has(oneEdge.toNode) ? (() => { const { a, as, b, bs } = edgeEnds(oneEdge, byId); return edgePath(a, as, b, bs, lineOf(oneEdge)).mid; })() : null;
  const ordered = useMemo(() => (board ? [...board.nodes.filter((n) => n.type === 'group'), ...board.nodes.filter((n) => n.type !== 'group')] : []), [board]);
  const single = selectedNodes.length === 1 ? selectedNodes[0] : null;

  // Where each group's name goes at this zoom (above it, inside its corner, or not at all far out), so names stay
  // readable and never sit on each other.
  const labelFits = useMemo(() => {
    const groups = (board?.nodes ?? []).filter((n) => n.type === 'group');
    if (!groups.length) return new Map<string, LabelFit>();
    const withAdd = canEdit && levels(view.k).detail;
    return fitGroupLabels(
      groups.map((g) => {
        const b = g.neuralvault;
        const counted = (b?.part === 'group' && b.section !== 'notes') || b?.part === 'column';
        const adds = withAdd && b?.part === 'group' && !!ADDABLE[b.section];
        const name = labelWidth(g.label || 'Group');
        const extras = 10 + (counted ? 30 : 0) + (adds ? 30 : 0);
        return { id: g.id, x: g.x, y: g.y, width: g.width, height: g.height, natural: name + extras, least: Math.min(name, 72) + extras };
      }),
      board!.nodes,
      view.k,
    );
  }, [board, view.k, canEdit]);

  const saveState = useSaveState(path);
  const saveWords = saveState === 'saved' ? 'saved' : saveState === 'saving' ? 'saving…' : 'couldn’t save';
  return (
    <div className="canvas-view">
      <ViewHeader tab={tab} menu={() => fileMenu(path)} />
      {/* The one page head (8.7 wave 2 round 3): the canvas's own name above its add bar. */}
      <div className="w4b-cv-title">
        <PageHead title={path.split('/').pop()?.replace(/\.canvas$/, '') ?? 'Canvas'} />
      </div>
      {/* The count and saved words under the title (8.7 wave 2, design C). Adds live in the toolbar below
          alone (5 Nov 2026, rest-quieten M5: the top repeated every add the toolbar already had). */}
      <div className="w4b-cv-bar">
        <span className="w4b-cv-status">{damaged ? 'damaged · read-only' : board ? `${board.nodes.length} ${board.nodes.length === 1 ? 'card' : 'cards'} · ${saveWords}` : ''}</span>
      </div>
      {damaged && (
        <div className="cv-damaged" role="alert">
          <Icon name="warning" size={16} />
          <div className="cv-damaged-words">
            <strong>This board file is damaged, so it opened read-only.</strong>
            <span> Nothing is lost yet. The file is exactly as it was ({damaged.reason}).</span>
          </div>
          <button className="btn small" onClick={() => setShowBytes((s) => !s)}>
            {showBytes ? 'Hide' : 'Show'} the file as it is
          </button>
          <button className="btn small pri" disabled={!canEdit} title="Keeps a copy of the damaged file in File recovery, then opens an empty board" onClick={() => void startOver()}>
            Start over from empty
          </button>
        </div>
      )}
      {damaged && showBytes && (
        <pre className="cv-damaged-bytes" aria-label="The file as it is">
          {damaged.text.slice(0, 4000)}
          {damaged.text.length > 4000 ? `\n…${(damaged.text.length - 4000).toLocaleString('en-AU')} more characters` : ''}
        </pre>
      )}
      <div
        ref={surface}
        className={`canvas-surface${dropping ? ' is-dropping' : ''}${lv.detail ? '' : ' is-far'}`}
        tabIndex={0}
        data-own-zoom
        style={{ backgroundSize: `${gridPx}px ${gridPx}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onSurfaceDown}
        onPointerDownCapture={onSurfaceDownCapture}
        onPointerMove={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-world')) pointer.current = toWorld(e.clientX, e.clientY);
        }}
        onPointerLeave={() => (pointer.current = null)}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === ' ') {
            space.current = false;
            surface.current?.classList.remove('is-space');
          }
          if (e.key === 'Shift') surface.current?.classList.remove('is-shift');
        }}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          space.current = false;
          e.currentTarget.classList.remove('is-space', 'is-shift');
        }}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={(e) => void onPaste(e)}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-world')) addText(toWorld(e.clientX, e.clientY));
        }}
        onContextMenu={(e) => contextMenu(e)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-nv-paths') || e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            if (!dropping && e.dataTransfer.types.includes('Files') && boardProject && projectFolder) setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (!(e.relatedTarget as Node | null) || !surface.current?.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => void onDrop(e)}
      >
        {board && (
          <div
            className={`canvas-world${lv.detail ? '' : ' is-overview'}${switched ? ' is-switching' : ''}`}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, ['--k' as string]: styleZoom(view.k) }}
          >
            <svg className="canvas-edges" width="1" height="1" overflow="visible">
              <defs>
                <marker id={`nv-arrow-${tab.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {board.edges.map((edge) => {
                if (!byId.has(edge.fromNode) || !byId.has(edge.toNode)) return null;
                // A doc's canvas draws no lines from the doc to its sections: the cards sit grouped under the doc, which
                // lists them (the lines stay in the file, as the former host app writes them; the person's own lines are
                // drawn).
                if (meta?.kind === 'doc' && edge.neuralvault?.auto === 'section') return null;
                const { a, as, b, bs } = edgeEnds(edge, byId);
                const { d, mid } = edgePath(a, as, b, bs, lineOf(edge));
                const color = colorOf(edge.color);
                const auto = edge.neuralvault?.auto;
                return (
                  <g key={edge.id} className={`canvas-edge${selected.has(edge.id) ? ' selected' : ''}${auto ? ` is-auto auto-${auto}` : ''}`}>
                    <path d={d} className="canvas-edge-hit" onPointerDown={(e) => { e.stopPropagation(); setSelected(new Set([edge.id])); surface.current?.focus({ preventScroll: true }); }} onDoubleClick={(e) => { e.stopPropagation(); if (canEdit) setEdgeEditing(edge.id); }} onContextMenu={(e) => contextMenu(e, undefined, edge)} />
                    <path d={d} className={`canvas-edge-line${edge.nvDash === true ? ' is-dashed' : ''}`} style={color ? { stroke: color } : undefined} markerEnd={(edge.toEnd ?? 'arrow') === 'arrow' ? `url(#nv-arrow-${tab.id})` : undefined} markerStart={edge.fromEnd === 'arrow' ? `url(#nv-arrow-${tab.id})` : undefined} />
                    {edgeEditing === edge.id ? (
                      <foreignObject x={mid.x - 110} y={mid.y - 16} width="220" height="32" className="canvas-edge-label-wrap is-editing">
                        <input
                          className="cv-edge-input"
                          autoFocus
                          defaultValue={edge.label ?? ''}
                          placeholder="Label"
                          onPointerDown={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            setEdgeEditing(null);
                            const label = e.target.value.trim();
                            if (label !== (edge.label ?? '')) setEdge(edge.id, { label: label || undefined });
                            surface.current?.focus({ preventScroll: true });
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </foreignObject>
                    ) : (
                      edge.label && (
                        <foreignObject x={mid.x - 110} y={mid.y - 14} width="220" height="28" className="canvas-edge-label-wrap">
                          <div className="canvas-edge-label">{edge.label}</div>
                        </foreignObject>
                      )
                    )}
                  </g>
                );
              })}
              {linking && byId.has(linking.from) && (
                <path d={edgePath(anchor(byId.get(linking.from)!, linking.side), linking.side, { x: linking.x, y: linking.y }, facing(byId.get(linking.from)!, { x: linking.x, y: linking.y }) === linking.side ? linking.side : 'left').d} className="canvas-edge-line is-drawing" markerEnd={`url(#nv-arrow-${tab.id})`} />
              )}
              {guides.map((g, i) => (
                <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="cv-guide" />
              ))}
            </svg>
            {ordered.map((node) =>
              intersects(node, seen) || selected.has(node.id) || editing?.id === node.id ? (
                <Card
                  key={node.id}
                  node={node}
                  selected={selected.has(node.id)}
                  handles={single?.id === node.id}
                  editing={editing?.id === node.id ? editing.kind : null}
                  labelEditing={labelEditing === node.id}
                  match={current?.id === node.id ? 2 : matchIds.has(node.id) ? 1 : 0}
                  detail={lv.detail}
                  labelFit={labelFits.get(node.id)}
                  board={path}
                  api={api}
                  bound={boundData}
                />
              ) : null,
            )}
            {selBox && selectedNodes.length > 1 && canEdit && (
              <div className="cv-selection-box" style={{ left: selBox.x, top: selBox.y, width: selBox.width, height: selBox.height }}>
                {HANDLES.map((h) => (
                  <div key={h} className={`cv-handle h-${h}`} onPointerDown={(e) => startResize(e, null, h)} />
                ))}
              </div>
            )}
            {marquee && <div className="canvas-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
          </div>
        )}

        {toolbarAt && canEdit && !editing && !labelEditing && (
          <div className="canvas-selection-bar cv-bar" style={{ left: Math.max(8, Math.min(size.width - 340, toolbarAt.x)), top: Math.max(8, toolbarAt.y) }} onPointerDown={(e) => e.stopPropagation()}>
            <button title="Colour" className={swatches ? 'active' : ''} onClick={() => setSwatches((s) => !s)}>
              <span className="cv-swatch-now" style={{ background: colorOf(single?.color) ?? 'var(--bg-raised)' }} />
            </button>
            {single && (single.type === 'text' || editableWords(single) !== null || (single.type === 'file' && isNotePath(single.file) && !single.neuralvault)) && !locked(single) && (
              <button title={single.type === 'file' ? 'Write in the note here (Enter)' : 'Edit (Enter)'} onClick={() => startEdit(single)}>
                <Icon name="edit" size={15} />
              </button>
            )}
            {single && (single.type === 'file' || single.type === 'link' || single.neuralvault?.part === 'project' || single.neuralvault?.part === 'portfolio-project') && (
              <button title="Open" onClick={() => openCard(single, false)}>
                <Icon name="external" size={15} />
              </button>
            )}
            {selectedNodes.some((n) => n.type === 'text' || (n.type === 'file' && isNotePath(n.file))) && (
              <button title="Fit the card to what’s in it" onClick={() => fitToContent(new Set(selectedNodes.filter((n) => n.type === 'text' || (n.type === 'file' && isNotePath(n.file))).map((n) => n.id)))}>
                <Icon name="expand" size={15} />
              </button>
            )}
            {selectedNodes.length > 1 && (
              <>
                <button title="Put in a group (G)" onClick={() => addGroup()}>
                  <Icon name="frame" size={15} />
                </button>
                <button
                  title="Line up and space out"
                  onClick={(e) =>
                    openMenu(e.currentTarget, [
                      { label: 'Line up left edges', run: () => arrange('left') },
                      { label: 'Line up centres', run: () => arrange('centre') },
                      { label: 'Line up right edges', run: () => arrange('right') },
                      { separator: true },
                      { label: 'Line up tops', run: () => arrange('top') },
                      { label: 'Line up middles', run: () => arrange('middle') },
                      { label: 'Line up bottoms', run: () => arrange('bottom') },
                      { separator: true },
                      { label: 'Space evenly across', disabled: selectedNodes.length < 3, run: () => arrange('x') },
                      { label: 'Space evenly down', disabled: selectedNodes.length < 3, run: () => arrange('y') },
                    ])
                  }
                >
                  <Icon name="layers" size={15} />
                </button>
              </>
            )}
            <button title={selectedNodes.every(locked) ? 'Unlock' : 'Lock in place'} className={selectedNodes.every(locked) ? 'active' : ''} onClick={() => update(new Set(selected), (n) => ({ ...n, nvLocked: selectedNodes.every(locked) ? undefined : true }))}>
              <Icon name="lock" size={15} />
            </button>
            <button title="Zoom to it (Shift+2)" onClick={() => fitTo(selectedNodes, true, 2)}>
              <Icon name="fit" size={15} />
            </button>
            <button title={single?.neuralvault && single.neuralvault.part !== 'file' ? 'Take off the canvas (Delete)' : 'Delete (Delete)'} className="danger" onClick={removeSelected}>
              <Icon name="trash" size={15} />
            </button>
            {swatches && (
              <div className="cv-swatches">
                <button title="No colour" className="cv-swatch none" onClick={() => setColor(undefined)} />
                {Object.entries(PRESETS).map(([k, v]) => (
                  <button key={k} title={v.name} className={`cv-swatch${single?.color === k ? ' on' : ''}`} style={{ background: `var(${v.var})` }} onClick={() => setColor(k)} />
                ))}
              </div>
            )}
          </div>
        )}

        {oneEdge && oneEdgeMid && canEdit && !edgeEditing && (
          <div className="canvas-selection-bar cv-bar" style={{ left: Math.max(8, oneEdgeMid.x * view.k + view.x - 120), top: Math.max(8, oneEdgeMid.y * view.k + view.y - 56) }} onPointerDown={(e) => e.stopPropagation()}>
            <button title="Label" onClick={() => setEdgeEditing(oneEdge.id)}>
              <Icon name="text" size={15} />
            </button>
            {(['curved', 'straight', 'elbow'] as LineStyle[]).map((s) => (
              <button key={s} title={s === 'curved' ? 'Curved' : s === 'straight' ? 'Straight' : 'Elbow'} className={lineOf(oneEdge) === s ? 'active' : ''} onClick={() => setEdge(oneEdge.id, { nvLine: s === 'curved' ? undefined : s })}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  {s === 'curved' ? <path d="M2 13 C 8 13, 8 3, 14 3" /> : s === 'straight' ? <path d="M2 13 L 14 3" /> : <path d="M2 13 H 8 V 3 H 14" />}
                </svg>
              </button>
            ))}
            <button title="Dashed" className={oneEdge.nvDash === true ? 'active' : ''} onClick={() => setEdge(oneEdge.id, { nvDash: oneEdge.nvDash === true ? undefined : true })}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="2.5 3">
                <path d="M2 8 H 14" />
              </svg>
            </button>
            <button title="Arrows" onClick={(e) => openMenu(e.currentTarget, edgeItems(oneEdge).filter((i) => 'label' in i && i.label.startsWith('Arrow')))}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8 H 13 M 9.5 4.5 L 13 8 L 9.5 11.5" />
              </svg>
            </button>
            <button title="Colour" onClick={(e) => openMenu(e.currentTarget, colourItems())}>
              <span className="cv-swatch-now" style={{ background: colorOf(oneEdge.color) ?? 'var(--canvas-edge)' }} />
            </button>
            <button title="Delete" className="danger" onClick={removeSelected}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}

        {meta?.kind === 'project' && (
          <div className="cv-board-bar" onPointerDown={(e) => e.stopPropagation()}>
            <span className="cv-live" title="Cards drawn from the project follow its file: change them here or on its page" />
            <button className="cv-board-name" onClick={() => A.openPath(meta.project, { where: 'current', mode: 'page' })} title="Open the project’s page">
              {projectView?.project.name ?? A.titleOf(meta.project)}
            </button>
            <span className="cv-board-hint">{projectFolder ? 'Kept in step with the project · drop files here to copy them into its folder' : 'Kept in step with the project'}</span>
          </div>
        )}
        {meta?.kind === 'doc' && (
          <div className="cv-board-bar" onPointerDown={(e) => e.stopPropagation()}>
            <Icon name="doc" size={14} className="cv-title-doc" />
            <button className="cv-board-name" onClick={() => A.openPath(meta.doc, { where: 'current' })} title="Open the doc">
              {A.titleOf(meta.doc)}
            </button>
            <span className="cv-board-hint">A card for each section · double-click one to open the doc there</span>
            {canEdit && (
              <button className="cv-board-action" title="Update canvas from doc: sections added, renamed or taken out; your own cards stay where they are" onClick={() => void updateDocCanvas(meta.doc)}>
                <Icon name="refresh" size={13} />
                Update from doc
              </button>
            )}
          </div>
        )}
        {meta?.kind === 'portfolio' && (
          <div className="cv-board-bar" onPointerDown={(e) => e.stopPropagation()}>
            <span className="cv-board-title">Portfolio</span>
            <div className="cv-switch" role="tablist">
              {(['status', 'health'] as PortfolioGroupBy[]).map((by) => (
                <button key={by} role="tab" aria-selected={groupBy === by} className={groupBy === by ? 'on' : ''} disabled={!canEdit} onClick={() => regroup(by)}>
                  By {by}
                </button>
              ))}
            </div>
            <span className="cv-board-hint">Drag a project to another column to change its {groupBy}</span>
          </div>
        )}

        {search && (
          <div className="cv-search" onPointerDown={(e) => e.stopPropagation()}>
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={search.query}
              placeholder="Find on this canvas"
              onChange={(e) => setSearch({ query: e.target.value, at: 0 })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') setSearch((s) => s && { ...s, at: s.at + (e.shiftKey ? -1 : 1) });
                else if (e.key === 'Escape') {
                  setSearch(null);
                  surface.current?.focus({ preventScroll: true });
                }
              }}
            />
            <span className="cv-search-count">{query ? (matches.length ? `${matches.indexOf(current!) + 1} of ${matches.length}` : 'None') : ''}</span>
            <button title="Previous (Shift+Enter)" disabled={!matches.length} onClick={() => setSearch((s) => s && { ...s, at: s.at - 1 })}>
              <Icon name="chevronDown" size={14} className="flip" />
            </button>
            <button title="Next (Enter)" disabled={!matches.length} onClick={() => setSearch((s) => s && { ...s, at: s.at + 1 })}>
              <Icon name="chevronDown" size={14} />
            </button>
            <button title="Close (Esc)" onClick={() => setSearch(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {board && !board.nodes.length && !damaged && (
          <div className="canvas-empty">
            <div className="cv-empty-card">
              <Icon name="canvas" size={26} />
              <p className="cv-empty-title">An empty canvas</p>
              <p className="hint">Double-click anywhere to write a card. Drag in notes, pictures and files, or add them from the bar below.</p>
            </div>
          </div>
        )}

        {dropping && (
          <div className="cv-drop">
            <div className="cv-drop-card">
              <Icon name="folderPlus" size={22} />
              <span>Drop to copy into {projectView?.project.name ?? 'the project'}’s folder</span>
              <span className="cv-faint">The originals stay where they are.</span>
            </div>
          </div>
        )}

        {hint && hasCards && (
          <div className="cv-nav-hint" role="note" onPointerDown={(e) => e.stopPropagation()}>
            <span className="cv-nav-words">
              <span>
                <b>Drag</b> to move around
              </span>
              <span className="cv-nav-dot" />
              <span>
                <b>Ctrl+scroll</b> or <b>pinch</b> to zoom
              </span>
              <span className="cv-nav-dot" />
              <span>
                <b>Shift+drag</b> to select
              </span>
            </span>
            <button title="Got it" onClick={closeHint}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}

        {/* A damaged board is read-only (5 Nov 2026, u3 moving-in): its adds stay disabled until the person starts over. */}
        <div className="canvas-toolbar cv-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Text card (T)" disabled={!canEdit || !!damaged} onClick={() => addText(free(280, 100))}>
            <Icon name="text" size={17} />
            <span>Text</span>
          </button>
          <button title="Sticky note (S)" disabled={!canEdit || !!damaged} onClick={(e) => openMenu(e.currentTarget, Object.entries(PRESETS).map(([k, v]) => ({ label: v.name, run: () => addText(free(220, 170), k) })))}>
            <span className="cv-sticky-icon" />
            <span>Sticky</span>
          </button>
          <button title="A note: new, or one already here" disabled={!canEdit || !!damaged} onClick={(e) => openMenu(e.currentTarget, [{ label: 'A new note', icon: 'filePlus', run: () => void addNewNote(free(400, 340)) }, { label: 'A note already here…', icon: 'notes', run: () => void addExisting('note', free(400, 340)) }])}>
            <Icon name="filePlus" size={17} />
            <span>Note</span>
          </button>
          <button title="A picture or file" disabled={!canEdit || !!damaged} onClick={() => void addExisting('media', free(360, 260))}>
            <Icon name="image" size={17} />
            <span>File</span>
          </button>
          <button title="A drawing: new, or one already here" disabled={!canEdit || !!damaged} onClick={(e) => openMenu(e.currentTarget, [{ label: 'A new drawing', icon: 'pencil', run: () => void addDrawing(true, free(420, 300)) }, { label: 'A drawing already here…', icon: 'canvas', run: () => void addDrawing(false, free(420, 300)) }])}>
            <Icon name="pencil" size={17} />
            <span>Drawing</span>
          </button>
          <button title="A web link" disabled={!canEdit || !!damaged} onClick={() => void addLink(free(340, 92))}>
            <Icon name="link" size={17} />
            <span>Link</span>
          </button>
          <button title="A group (G)" disabled={!canEdit || !!damaged} onClick={() => addGroup(centre())}>
            <Icon name="frame" size={17} />
            <span>Group</span>
          </button>
          <span className="canvas-toolbar-sep" />
          <button title="Undo (Ctrl+Z)" disabled={!history.current.undo.length} onClick={undo}>
            <Icon name="undo" size={17} />
          </button>
          <button title="Redo (Ctrl+Shift+Z)" disabled={!history.current.redo.length} onClick={redo}>
            <Icon name="undo" size={17} className="flip-x" />
          </button>
        </div>

        {/* Panned off into empty space: one click brings every card back into view (geometry.ts, driftedAway). */}
        {board && driftedAway(board.nodes, view, size) && (
          <button className="cv-back-to-content" onPointerDown={(e) => e.stopPropagation()} onClick={() => fitTo(board.nodes, true)}>
            <Icon name="fit" size={14} />
            <span>Back to content</span>
          </button>
        )}

        {/* One hint at a time (5 Nov 2026, rest-quieten M5): this line waits until the move/zoom hint above is gone. */}
        {board && board.nodes.length > 0 && !hint && (
          <div className="w4b-cv-hint" aria-hidden="true">
            Double-click anywhere to write a card · drag a card’s edge dot to join it to another
          </div>
        )}

        <div className="cv-zoom" onPointerDown={(e) => e.stopPropagation()}>
          {minimapOn && roomForMap && board && board.nodes.length > 0 && <Minimap nodes={board.nodes} view={view} surface={size} colorOf={colorOf} onMove={(c) => setView((v) => ({ ...v, x: size.width / 2 - c.x * v.k, y: size.height / 2 - c.y * v.k }))} />}
          <div className="cv-zoom-row">
            <button title="Find on the canvas (Ctrl+F)" onClick={() => setSearch((s) => (s ? null : { query: '', at: 0 }))}>
              <Icon name="search" size={15} />
            </button>
            {roomForMap && (
              <button title={minimapOn ? 'Hide the map' : 'Show the map'} className={minimapOn ? 'active' : ''} onClick={() => setMinimapOn((s) => (store('nv.canvas.minimap', !s), !s))}>
                <Icon name="localGraph" size={15} />
              </button>
            )}
            <span className="canvas-toolbar-sep" />
            <button title="Zoom out (−)" onClick={() => zoomAt(1 / 1.25, undefined, undefined, true)}>
              <Icon name="zoomOut" size={15} />
            </button>
            <button
              className="canvas-zoom"
              title={`Zoom · ${NAV_WORDS}`}
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { label: 'Show everything', hotkey: 'Shift+1', run: () => board && fitTo(board.nodes, true) },
                  { label: 'Zoom to the selection', hotkey: 'Shift+2', disabled: !selectedNodes.length, run: () => fitTo(selectedNodes, true, 2) },
                  { separator: true },
                  { label: '50%', run: () => zoomTo(0.5) },
                  { label: '100%', hotkey: 'Shift+0', run: () => zoomTo(1) },
                  { label: '200%', run: () => zoomTo(2) },
                  { separator: true },
                  { label: 'Snap to the grid and other cards', checked: snapOn, run: () => setSnapOn((s) => (store('nv.canvas.snap', !s), !s)) },
                ])
              }
            >
              {Math.round(view.k * 100)}%
            </button>
            <button title="Zoom in (+)" onClick={() => zoomAt(1.25, undefined, undefined, true)}>
              <Icon name="zoomIn" size={15} />
            </button>
            <button title="Show everything (Shift+1)" onClick={() => board && fitTo(board.nodes, true)}>
              <Icon name="fit" size={15} />
            </button>
          </div>
        </div>
      </div>
      {closer}
    </div>
  );
}
