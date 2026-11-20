// The Timeline (17 Oct 2026): every project's dates in one view, read live from the project files — when each started
// and is due (its bar, filled as far as it has got), its key dates, the "by" dates of its next steps, and its decisions
// and updates as small marks — so clashes and slips show. A line for today; weeks, months or quarters; rows grouped and
// sorted; "at risk", "mine" and "this quarter". Resting on a mark shows its words and project; a click opens the project
// at it; dragging a key date, a start or a due date moves it (written to the project file through the page's own edit,
// with Undo). The pure parts are src/shared/timeline.ts.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../../shared/project-file';
import { barWords, filterRows, findProblems, groupRows, isoDay, longDay, monthName, moveEdit, moveWords, packMarks, PX_PER_DAY, projectTimeline, quarterOf, shortDay, span, ticks, todayDay, ZOOMS, type GroupBy, type Mark, type SortBy, type TimelineProject, type Zoom } from '../../../shared/timeline';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { PageEmpty, PageLoading, Skel } from '../components/PageStates';
import { openMenu, type MenuItem } from '../components/Menu';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { initials, personHue } from '../lib/projectLook';
import * as A from '../state/actions';
import { showError, toast, useApp } from '../state/store';
import * as W from '../state/workspace';
import { useTimelineMemory } from './timeline/memory';
import { itemOf, revealItem } from './timeline/reveal';
import { BarRow } from './timeline/BarRow';
import { MarkCard, useHoverCard, useMarkDrag } from './timeline/RowMarks';
import { ViewHeader } from './ViewHeader';
import { openPortfolioBoard } from './canvas/projectBoards';

interface Entry {
  path: string;
  version: string;
  project: Project;
}

const GROUP_WORDS: Record<GroupBy, string> = { status: 'Status', due: 'When due', owner: 'Owner', health: 'Health', none: 'No groups' };
const SORT_WORDS: Record<SortBy, string> = { due: 'Due date', start: 'Start date', name: 'Name', health: 'Health' };
const ZOOM_WORDS: Record<Zoom, string> = { weeks: 'Weeks', months: 'Months', quarters: 'Quarters' };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function TimelineView({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [mem, remember] = useTimelineMemory();
  const [data, setData] = useState<Entry[] | null>(null);
  const [today, setToday] = useState(todayDay);
  const [sel, setSel] = useState<{ path: string; mark?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const ppdNow = useRef(PX_PER_DAY.months);
  const placedOnce = useRef(false);
  const anim = useRef(0);

  const load = useCallback(() => {
    setToday(todayDay());
    return window.nv.projects.all().then(setData, showError);
  }, []);
  useEffect(() => void load(), [revision]);

  const zoom: Zoom = mem?.zoom ?? 'months';
  const ppd = PX_PER_DAY[zoom];
  ppdNow.current = anim.current ? ppdNow.current : ppd;
  const rows = useMemo(() => (data ?? []).map((e) => projectTimeline(e.path, e.project, today)), [data, today]);
  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
  const problems = useMemo(() => findProblems(rows, today), [rows, today]);
  // One span at every zoom (so zooming keeps its place), from every project's dates.
  const { from, to } = useMemo(() => span(rows, today, 'months'), [rows, today]);
  const days = to - from + 1;
  const scale = useMemo(() => ticks(from, to, zoom), [from, to, zoom]);
  const me = mem?.me ?? '';
  const filtered = useMemo(() => filterRows(rows, { risk: mem?.risk, mine: mem?.mine, quarter: mem?.quarter }, { problems, today, me }), [rows, mem?.risk, mem?.mine, mem?.quarter, problems, today, me]);
  // The headline's figures count the rows on show (10.0 second round N19: every headline carries its status and
  // key figure), from the same filtered list the board draws, so the two can never disagree.
  const leadProblems = useMemo(() => findProblems(filtered, today), [filtered, today]);
  const leadMarks = filtered.reduce((n, r) => n + r.marks.length, 0);
  const lead = !rows.length
    ? 'No projects with dates yet.'
    : !filtered.length
      ? 'Nothing matches these filters.'
      : `${filtered.length} ${filtered.length === 1 ? 'project' : 'projects'} · ${leadMarks} ${leadMarks === 1 ? 'date' : 'dates'}${leadProblems.counts.overdue ? ` · ${leadProblems.counts.overdue} overdue` : ''}`;
  const groups = useMemo(() => groupRows(filtered, mem?.group ?? 'none', mem?.sort ?? 'due', today), [filtered, mem?.group, mem?.sort, today]);
  // Key dates, next steps, decisions and updates packed onto the line below each bar (crowded days fold into the
  // nearest, never lost); the start and the due date are the bar's own ends. The revealed mark stays pinned open
  // (fixed): reveal() points at it and its card, which a folded mark could never show.
  const packs = useMemo(() => new Map(rows.map((r) => [r.path, packMarks(r.marks.filter((m) => m.kind !== 'start' && m.kind !== 'due').map((m) => ({ id: m.id, x: (m.day - from) * ppd + ppd / 2, ...(sel?.path === r.path && sel?.mark === m.id ? { fixed: true } : {}) })), 16, 1)])), [rows, from, ppd, sel]);
  const dayAt = useCallback((x: number, lane: Element) => from + Math.floor((x - lane.getBoundingClientRect().left) / ppdNow.current), [from]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const atRiskCount = useMemo(() => filterRows(rows, { risk: true }, { problems, today }).length, [rows, problems, today]);
  const unread = rows.reduce((n, r) => n + r.unread, 0);
  const hover = useHoverCard();

  // ── Moving dates ──────────────────────────────────────────────────────────────────────────────────────────────────
  const replace = (path: string, version: string, project: Project, was = path) => setData((all) => (all ?? []).map((e) => (e.path === was ? { path, version, project } : e)));
  const step = async (path: string, redo: boolean) => {
    try {
      const r = await (redo ? window.nv.projects.redo(path) : window.nv.projects.undo(path));
      replace(r.view.path, r.view.version, r.view.project, path);
      toast(r.words, redo ? (r.undo ? { label: 'Undo', run: () => void step(r.view.path, false) } : undefined) : r.redo ? { label: 'Redo', run: () => void step(r.view.path, true) } : undefined);
    } catch (err) {
      showError(err);
      void load();
    }
  };
  const move = async (m: Mark, day: number) => {
    const edit = moveEdit(m, day);
    const entry = data?.find((e) => e.path === m.path);
    if (!edit || !entry || !canEdit) return;
    try {
      const r = await window.nv.projects.edit(m.path, edit, entry.version);
      replace(r.view.path, r.view.version, r.view.project, m.path);
      toast(moveWords(m, day, entry.project.name), { label: 'Undo', run: () => void step(r.view.path, false) });
    } catch (err) {
      showError(err);
      void load();
    }
  };
  // A bar dragged along its row: the project's start and due date shift together (two writes through the page's
  // own edit, undone together). Only whole bars move: an open-ended bar stretches from the end it has.
  const moveBar = useCallback(
    async (path: string, delta: number) => {
      const entry = data?.find((e) => e.path === path);
      const row = byPath.get(path);
      if (!entry || !row || row.start === undefined || row.due === undefined || !canEdit || delta === 0) return;
      try {
        const first = await window.nv.projects.edit(path, { kind: 'set', field: 'started', value: isoDay(row.start + delta) }, entry.version);
        const second = await window.nv.projects.edit(first.view.path, { kind: 'set', field: 'due', value: isoDay(row.due + delta) }, first.view.version);
        replace(second.view.path, second.view.version, second.view.project, path);
        toast(`Moved ${row.name} to ${barWords(row.start + delta, row.due + delta, today)}.`, { label: 'Undo', run: () => void undoBarMove(second.view.path, row.name) });
      } catch (err) {
        showError(err);
        void load();
      }
    },
    [data, byPath, canEdit, today],
  );
  const undoBarMove = async (path: string, name: string) => {
    try {
      const a = await window.nv.projects.undo(path);
      const b = await window.nv.projects.undo(a.view.path);
      replace(b.view.path, b.view.version, b.view.project, path);
      toast(`Moved ${name} back.`);
    } catch (err) {
      showError(err);
      void load();
    }
  };
  const onOpenBar = useCallback((path: string, e?: { ctrlKey: boolean; metaKey: boolean }) => openAt(null, path, e), []);
  const open = openAt;
  const { drag, setDrag, handlers } = useMarkDrag({
    canMove: canEdit,
    dayAt,
    onMove: move,
    onClick: (m, e) => open(m, m.path, e),
  });

  // ── Zoom and scroll ───────────────────────────────────────────────────────────────────────────────────────────────
  const nameWidth = () => (scroller.current?.querySelector('.tl-corner') as HTMLElement | null)?.offsetWidth ?? 0;
  /** Scrolls so a day sits at a share of the visible days (0.3: a little left of the middle). */
  const scrollToDay = (day: number, at = 0.3, smooth = true) => {
    const sc = scroller.current;
    if (!sc) return;
    const visible = sc.clientWidth - nameWidth();
    sc.scrollTo({ left: Math.max(0, (day - from) * ppdNow.current - visible * at), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  };
  /** Zooms keeping the day under the pointer (or the middle) where it is, the marks gliding to their places. */
  const zoomTo = (next: Zoom, clientX?: number) => {
    const sc = scroller.current, cv = canvas.current;
    if (!sc || !cv || next === zoom) return;
    const rect = sc.getBoundingClientRect();
    const name = nameWidth();
    const p0 = ppdNow.current, p1 = PX_PER_DAY[next];
    // Around the pointer; from a button or a key, around today when it's on screen (else the middle).
    const todayAt = (today - from + 0.5) * p0 - sc.scrollLeft;
    const ax = clientX !== undefined ? Math.max(rect.left + name, clientX) - rect.left - name : todayAt > 0 && todayAt < rect.width - name ? todayAt : (rect.width - name) / 2;
    const anchor = (sc.scrollLeft + ax) / p0;
    cancelAnimationFrame(anim.current);
    hover.set(null);
    if (reduced()) {
      ppdNow.current = p1;
      cv.style.setProperty('--ppd', String(p1));
      sc.scrollLeft = anchor * p1 - ax;
      remember({ zoom: next });
      return;
    }
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / 260);
      const ease = 1 - Math.pow(1 - t, 3);
      const p = Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * ease);
      ppdNow.current = p;
      cv.style.setProperty('--ppd', String(p));
      sc.scrollLeft = anchor * p - ax;
      if (t < 1) anim.current = requestAnimationFrame(frame);
      else {
        anim.current = 0;
        remember({ zoom: next });
      }
    };
    anim.current = requestAnimationFrame(frame);
  };
  const zoomBy = (dir: 1 | -1, clientX?: number) => {
    const i = ZOOMS.indexOf(zoom) + dir;
    if (i >= 0 && i < ZOOMS.length) zoomTo(ZOOMS[i], clientX);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  // Ctrl+wheel (a pinch on a touchpad) zooms around the pointer.
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let last = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (Date.now() - last < 280 || Math.abs(e.deltaY) < 2) return;
      last = Date.now();
      zoomRef.current(e.deltaY < 0 ? -1 : 1, e.clientX);
    };
    sc.addEventListener('wheel', wheel, { passive: false });
    return () => sc.removeEventListener('wheel', wheel);
  }, [data !== null && mem !== null, rows.length > 0]);
  // First showing: today a little left of the middle.
  useLayoutEffect(() => {
    if (placedOnce.current || !data || !scroller.current) return;
    placedOnce.current = true;
    scrollToDay(today, 0.3, false);
  }, [data, mem !== null]);

  // ── Choosing a mark from the keys or the list of things to look at ─────────────────────────────────────────────
  const marksOf = (r: TimelineProject) => {
    const shown = new Set(packs.get(r.path)?.shown ?? []);
    return r.marks.filter((m) => m.kind === 'start' || m.kind === 'due' || shown.has(m.id));
  };
  const reveal = (path: string, markId?: string, smooth = true) => {
    setSel({ path, mark: markId });
    requestAnimationFrame(() => {
      const sc = scroller.current;
      const row = sc?.querySelector<HTMLElement>(`.tl-row[data-path="${CSS.escape(path)}"]`);
      if (!sc || !row) return;
      const top = row.offsetTop - (sc.querySelector<HTMLElement>('.tl-scale')?.offsetHeight ?? 0) - 8;
      if (row.offsetTop - sc.scrollTop < 70 || row.offsetTop + row.offsetHeight > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: Math.max(0, top - sc.clientHeight / 3), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
      const m = markId ? byPath.get(path)?.marks.find((x) => x.id === markId) : undefined;
      if (m) {
        const x = (m.day - from) * ppdNow.current;
        const visible = sc.clientWidth - nameWidth();
        if (x < sc.scrollLeft + 24 || x > sc.scrollLeft + visible - 24) scrollToDay(m.day, 0.5, smooth);
        window.setTimeout(() => {
          const el = sc.querySelector(`[data-mark="${CSS.escape(m.id)}"]`);
          if (el) hover.set({ marks: [m], rect: el.getBoundingClientRect() });
        }, smooth && !reduced() ? 320 : 0);
      } else hover.set(null);
    });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('input, textarea')) return;
    const sc = scroller.current;
    if (!sc) return;
    const row = sel ? byPath.get(sel.path) : undefined;
    const list = row ? marksOf(row).sort((a, b) => a.day - b.day) : [];
    const at = sel?.mark ? list.findIndex((m) => m.id === sel.mark) : -1;
    const current = at >= 0 ? list[at] : undefined;
    const k = e.key;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey && current?.movable && canEdit) {
      // Moving a date from the keys: Alt+← → a day (with Shift, a week); let go of Alt to write it, Escape to leave it.
      e.preventDefault();
      const base = drag?.id === current.id ? drag.day : current.day;
      setDrag({ id: current.id, day: base + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1) });
      hover.set(null);
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const i = row ? order.indexOf(row) : -1;
      const next = order[Math.max(0, Math.min(order.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))] ?? order[0];
      if (next) reveal(next.path);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (row && !e.shiftKey && list.length) {
        const visibleFrom = from + sc.scrollLeft / ppdNow.current;
        const i = at >= 0 ? at + (k === 'ArrowRight' ? 1 : -1) : k === 'ArrowRight' ? list.findIndex((m) => m.day >= visibleFrom) : list.length - 1;
        const m = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i))];
        reveal(row.path, m.id);
      } else sc.scrollBy({ left: (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? sc.clientWidth * 0.8 : 7 * ppdNow.current * (zoom === 'weeks' ? 1 : zoom === 'months' ? 2 : 4)), behavior: reduced() ? 'auto' : 'smooth' });
    } else if (k === 'PageDown' || k === 'PageUp') {
      e.preventDefault();
      sc.scrollBy({ left: (k === 'PageDown' ? 1 : -1) * sc.clientWidth * 0.8, behavior: reduced() ? 'auto' : 'smooth' });
    } else if (k === 'Enter' && row) {
      e.preventDefault();
      open(current ?? null, row.path, e);
    } else if (k === 'Escape') {
      if (drag) setDrag(null);
      else {
        setSel(null);
        hover.set(null);
      }
    } else if (k === '+' || k === '=') zoomBy(-1);
    else if (k === '-' || k === '_') zoomBy(1);
    else if (k === '1' || k === '2' || k === '3') zoomTo(ZOOMS[Number(k) - 1]);
    else if (k.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) scrollToDay(today, 0.3);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key !== 'Alt' || !drag || drag.saving) return;
    e.preventDefault();
    const m = sel?.mark ? byPath.get(sel.path)?.marks.find((x) => x.id === sel.mark) : undefined;
    if (!m || drag.id !== m.id || drag.day === m.day) return setDrag(null);
    setDrag({ ...drag, saving: true });
    void move(m, drag.day).finally(() => setDrag(null));
  };

  // ── Menus ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const people = useMemo(() => {
    const count = new Map<string, { name: string; owns: number; on: number }>();
    for (const r of rows)
      for (const [key, name] of Object.entries(r.names)) {
        const e = count.get(key) ?? { name, owns: 0, on: 0 };
        e.on++;
        if (r.owner && r.owner.toLowerCase().includes(key)) e.owns++;
        count.set(key, e);
      }
    return [...count.values()].sort((a, b) => b.owns - a.owns || b.on - a.on || a.name.localeCompare(b.name));
  }, [rows]);
  const chooseMe = (anchor: HTMLElement) =>
    openMenu(anchor, [
      { heading: 'Which of these is you?' },
      ...people.slice(0, 14).map((x) => ({ label: x.name, hint: `${x.on} ${x.on === 1 ? 'project' : 'projects'}`, checked: x.name === me, run: () => remember({ me: x.name, mine: true }) })),
      ...(me ? [{ separator: true } as MenuItem, { label: 'Show everyone’s', run: () => remember({ mine: false }) }] : []),
    ]);
  const groupMenu = (anchor: HTMLElement) =>
    openMenu(anchor, [
      { heading: 'Group by' },
      ...(['status', 'due', 'owner', 'health', 'none'] as GroupBy[]).map((g) => ({ label: GROUP_WORDS[g], checked: (mem?.group ?? 'none') === g, run: () => remember({ group: g }) })),
      { separator: true },
      { heading: 'Sort by' },
      ...(['due', 'start', 'name', 'health'] as SortBy[]).map((s) => ({ label: SORT_WORDS[s], checked: (mem?.sort ?? 'due') === s, run: () => remember({ sort: s }) })),
    ]);

  // The mock-up's top bar (8.7 wave 2 round 2): Rows / Board / Timeline, switching ways of seeing every project.
  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search): the
  // three yield one by one from the left when measured within 12px of the bar, into the ⋯ beside them, which
  // only shows while it carries something (this view rides along marked, so the menu still names all three).
  const switcher = (
    <>
      <button className="btn quiet" data-overflow="rows" data-overflow-order={1} title="Projects as rows" onClick={() => A.openProjects()}>
        Rows
      </button>
      <button className="btn quiet" data-overflow="board" data-overflow-order={2} title="Every project on a board, in columns by status or health" onClick={() => void openPortfolioBoard()}>
        Board
      </button>
      <button className="btn" data-overflow="timeline" data-overflow-order={3} aria-current="page" title="This view: every project’s dates in one view">
        Timeline
      </button>
      <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the timeline" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
        'rows': () => ({ label: 'Rows', icon: 'list', run: () => A.openProjects() }),
        'board': () => ({ label: 'Board', icon: 'board', run: () => void openPortfolioBoard() }),
        'timeline': () => ({ label: 'Timeline', icon: 'timeline', hint: 'This view', disabled: true }),
      }))}>
        <Icon name="more" size={16} />
      </button>
    </>
  );

  if (!mem || data === null)
    return (
      <div className="tl-top">
        <ViewHeader tab={tab} title="Timeline">
          {switcher}
        </ViewHeader>
        <div className="tl-page">
          <PageHead className="tl-head" title="Timeline" lead="Reading every project’s dates." />
          <PageLoading label="Reading every project’s dates…">
            <div className="card" style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['34%', '2%', '44%'], ['30%', '12%', '22%'], ['26%', '20%', '24%'], ['30%', '8%', '14%']].map(([name, at, wide], i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Skel w={name} h={14} />
                  <span style={{ flex: 1, position: 'relative', height: 28 }}>
                    <span style={{ position: 'absolute', top: 0, bottom: 0, left: at, width: wide }}>
                      <Skel w="100%" h={28} r={7} />
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </PageLoading>
        </div>
      </div>
    );
  const quarter = quarterOf(today);
  const issues = problems.list.length;
  const firstIssue = problems.list[0];
  const firstProject = firstIssue ? (byPath.get(firstIssue.mark.path)?.name ?? '') : '';
  const firstWhat = firstIssue ? (firstIssue.mark.kind === 'due' ? `${firstProject} due` : firstIssue.mark.kind === 'start' ? `${firstProject} starts` : firstIssue.mark.words) : '';

  return (
    <div className="tl-top">
      <ViewHeader tab={tab} title="Timeline">
        {switcher}
      </ViewHeader>
      <div className="tl-page">
      {/* The one page head (8.7 wave 2 round 3), then the bar: the zoom words, the group dropdown, the
          filters, Today, and the hint at right. */}
      <PageHead className="tl-head" title="Timeline" lead={lead} />
      {rows.length > 0 && (
        <div className="w4b-tl-bar">
          <div className="seg" role="radiogroup" aria-label="Zoom">
            {ZOOMS.map((z, i) => (
              <button key={z} role="radio" aria-checked={zoom === z} className={zoom === z ? 'on' : ''} title={`${ZOOM_WORDS[z]} (${i + 1})`} onClick={() => zoomTo(z)}>
                {ZOOM_WORDS[z]}
              </button>
            ))}
          </div>
          <button className="btn" style={{ height: 34 }} onClick={(e) => groupMenu(e.currentTarget)} aria-haspopup="menu" title={`Group and sort the projects (now: ${GROUP_WORDS[mem.group]} · ${SORT_WORDS[mem.sort]})`}>
            Group: {GROUP_WORDS[mem.group]} <Icon name="chevronDown" size={12} />
          </button>
          <button className="btn" style={{ height: 34 }} onClick={() => scrollToDay(today, 0.3)} title="Back to today (T)">
            Today
          </button>
          <div className="tl-chips" role="group" aria-label="Show only">
            <button className={`tl-chip${mem.risk ? ' on' : ''}`} aria-pressed={mem.risk} onClick={() => remember({ risk: !mem.risk })} title="Projects whose health is at risk or off track, or with a clash or something overdue">
              At risk <span className="pj-count">{atRiskCount}</span>
            </button>
            <span className={`tl-chip tl-chip-split${mem.mine ? ' on' : ''}`}>
              <button aria-pressed={mem.mine} title={me ? `Projects ${me} owns, is on, or has a next step in` : 'Choose which person is you'} onClick={(e) => (me ? remember({ mine: !mem.mine }) : chooseMe(e.currentTarget.parentElement as HTMLElement))}>
                {mem.mine && me ? (
                  <>
                    <span className="pj-avatar tiny" style={{ ['--hue' as string]: personHue(me) }}>
                      {initials(me)}
                    </span>
                    Mine
                  </>
                ) : (
                  'Mine'
                )}
              </button>
              {me && (
                <button className="tl-chip-more" title={`“Mine” is ${me}: choose someone else`} aria-label="Choose who is you" onClick={(e) => chooseMe(e.currentTarget.parentElement as HTMLElement)}>
                  <Icon name="chevronDown" size={11} />
                </button>
              )}
            </span>
            <button className={`tl-chip${mem.quarter ? ' on' : ''}`} aria-pressed={mem.quarter} onClick={() => remember({ quarter: !mem.quarter })} title={`Projects with dates in ${quarter.words}`}>
              This quarter
            </button>
          </div>
          <span className="w4b-tl-hint">{canEdit ? 'Drag a bar to move it · drag its end to stretch it' : `${rows.length} ${rows.length === 1 ? 'project' : 'projects'}`}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <PageEmpty
            icon="timeline"
            title="Every project’s dates, in one view"
            line="Give your projects start and due dates, key dates or next steps with a “by” date, and they line up here, so clashes and slips show early."
            action={{ label: data.length ? 'Open Projects' : 'Set up your projects', run: () => A.openProjects() }}
          />
        </div>
      ) : (
        <>
          {issues > 0 && (
            <section className={`tl-needs${mem.needs ? ' open' : ''}`}>
              <button className="tl-needs-head" aria-expanded={mem.needs} onClick={() => remember({ needs: !mem.needs })}>
                <Icon name="warning" size={14} />
                <span>
                  {issues} {issues === 1 ? 'date needs' : 'dates need'} a look
                </span>
                {/* One summary line, parts joined by the one joiner " · " (sweep 3, 062: it read "22 projects322 dates…"). */}
                <span className="tl-faint">{[problems.counts.clash ? `${problems.counts.clash} ${problems.counts.clash === 1 ? 'clash' : 'clashes'}` : '', problems.counts.overdue ? `${problems.counts.overdue} overdue` : '', problems.counts.late ? `${problems.counts.late} after their project` : ''].filter(Boolean).flatMap((part, i) => (i === 0 ? [part] : [<span key={`s${i}`} aria-hidden="true"> · </span>, part]))}</span>
                <span className="pj-card-space" />
                <Icon name="chevronDown" size={12} />
              </button>
              {mem.needs && (
                <ul className="tl-needs-list">
                  {problems.list.slice(0, 60).map(({ mark, problem }, i) => {
                    const p = byPath.get(mark.path);
                    return (
                      <li key={`${mark.id}:${i}`}>
                        <button
                          className={`tl-need p-${problem.kind}`}
                          onClick={() => {
                            // Shown on the board even when a filter had hidden its project.
                            if (!filtered.some((r) => r.path === mark.path)) remember({ risk: false, mine: false, quarter: false });
                            reveal(mark.path, mark.id);
                          }}
                        >
                          <span className="tl-need-when">{shortDay(mark.day, today)}</span>
                          <span className="tl-need-what">
                            <strong>{mark.kind === 'due' ? `${p?.name} due` : mark.kind === 'start' ? `${p?.name} starts` : mark.words}</strong>
                            {mark.kind !== 'due' && mark.kind !== 'start' && <span className="tl-faint"> · {p?.name}</span>}
                          </span>
                          <span className="tl-need-why">{problem.words}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <div className="tl-board" ref={scroller} tabIndex={0} role="application" aria-label="Timeline of every project’s dates. Arrow keys move between projects and dates; Enter opens; Alt and an arrow moves a date; 1, 2 and 3 zoom; T goes to today." onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && drag && !drag.saving && setDrag(null)}>
            <div className={`tl-canvas z-${zoom}${drag ? ' is-dragging' : ''}`} ref={canvas} style={{ ['--ppd' as string]: ppd, ['--days' as string]: days, ['--wk' as string]: (7 - ((new Date(from * 86400000).getUTCDay() + 6) % 7)) % 7 }}>
              <div className="tl-scale">
                <div className="tl-corner">
                  <span>{filtered.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'project' : 'projects'}` : `${filtered.length} of ${rows.length}`}</span>
                </div>
                <div className="tl-scale-days">
                  <div className="tl-major">
                    {scale.major.map((t, i) => (
                      <span key={t.day} style={{ ['--w' as string]: (scale.major[i + 1]?.day ?? to + 1) - t.day }}>
                        <b>{t.label}</b>
                      </span>
                    ))}
                  </div>
                  <div className="tl-minor">
                    {scale.minor.map((t, i) => {
                      // p14, 4 Nov 2026 at 3456 wide: Today early in the month (Nov 4) covered "November" to
                      // "No": nothing cut off. The month head steps right past the pill; other zooms keep
                      // t.label.
                      let shift = 0;
                      if (zoom === 'months') {
                        const next = scale.minor[i + 1]?.day ?? to + 1;
                        if (t.day <= today && today < next) {
                          const diff = today - t.day;
                          if (diff < 10) shift = Math.round(diff * ppd + 64);
                        }
                      }
                      return (
                        <span key={t.day} style={{ ['--d' as string]: t.day - from, ...(shift ? { marginLeft: shift } : {}) }}>
                          {zoom === 'months' ? monthName(t.day) : t.label}
                        </span>
                      );
                    })}
                  </div>
                  {(() => {
                    // 8.7: in months zoom the pill shares the header row with the month heads, so a today near a
                    // month boundary parks the pill wholly on the side with room instead of covering a head's first letters.
                    let side = 'translateX(-50%)';
                    if (zoom === 'months') {
                      const prevB = [...scale.minor].reverse().find((t) => t.day <= today)?.day ?? from;
                      const nextB = scale.minor.find((t) => t.day > today)?.day ?? to + 1;
                      if ((nextB - today - 0.5) * ppd < 30) side = 'translateX(calc(-100% - 4px))';
                      else if ((today + 0.5 - prevB) * ppd < 30) side = 'translateX(4px)';
                    }
                    return (
                      <span className="tl-today-pill" style={{ ['--d' as string]: today - from, transform: side }}>
                        Today
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="tl-back" aria-hidden="true">
                {scale.minor.map((t) => (
                  <span key={t.day} className="tl-gridline" style={{ ['--d' as string]: t.day - from }} />
                ))}
                {mem.quarter && <span className="tl-quarter" style={{ ['--d1' as string]: quarter.from - from, ['--d2' as string]: quarter.to - from + 1 }} />}
                <span className="tl-today" style={{ ['--d' as string]: today - from }} />
              </div>
              {filtered.length === 0 ? (
                <div className="tl-none">
                  <p>No projects match {mem.mine && me ? `“mine” (${me})` : 'these'}{mem.risk ? ', at risk' : ''}{mem.quarter ? `, with dates in ${quarter.words}` : ''}.</p>
                  <button className="text-button" onClick={() => remember({ risk: false, mine: false, quarter: false })}>
                    Show every project
                  </button>
                </div>
              ) : (
                groups.map((g) => (
                  <Fragment key={g.key}>
                    {mem.group !== 'none' && (
                      <div className="tl-group">
                        <span className="tl-group-label">
                          {g.label}
                          <span className="pj-count">{g.rows.length}</span>
                        </span>
                      </div>
                    )}
                    {g.rows.map((r) => (
                      <BarRow
                        key={r.path}
                        r={r}
                        pack={packs.get(r.path)}
                        from={from}
                        today={today}
                        problems={problems}
                        drag={drag && drag.id.startsWith(`${r.path}#`) ? drag : null}
                        selected={sel?.path === r.path ? (sel.mark ?? '') : null}
                        canMove={canEdit}
                        handlers={handlers}
                        hover={hover}
                        dayAt={dayAt}
                        onOpen={onOpenBar}
                        onMoveBar={moveBar}
                      />
                    ))}
                  </Fragment>
                ))
              )}
            </div>
          </div>
          {/* The mock-up's line under the board: clashes and slips show here first. */}
          <p className="tl-clash-note">{firstIssue ? <>Clashes and slips show here first. {firstWhat}: {firstIssue.problem.words}</> : 'Clashes and slips show here first.'}</p>
          <footer className="tl-foot">
            <span className="tl-key">
              <span className="tl-key-item"><span className="tl-mark k-date s-open static"><span className="tl-glyph" /></span>Key date</span>
              <span className="tl-key-item"><span className="tl-mark k-next s-open static"><span className="tl-glyph" /></span>Next step</span>
              <span className="tl-key-item"><span className="tl-mark k-decision static"><span className="tl-glyph" /></span>Decision</span>
              <span className="tl-key-item"><span className="tl-mark k-update static"><span className="tl-glyph" /></span>Update</span>
              <span className="tl-key-item"><span className="tl-mark k-date p-clash static"><span className="tl-glyph" /></span>Clash</span>
            </span>
            <span className="pj-card-space" />
            {unread > 0 && <span className="tl-faint" title="Dates written in words (“end of month”, “TBC”) can’t be placed on the timeline">{unread} {unread === 1 ? 'date is' : 'dates are'} written in words, so not shown</span>}
            {/* The drag hint lives once, in the top bar (p14, 4 Nov 2026 at 3456 wide: it was said twice, top and here; the brief: one
way, no obvious help). Reading-only still says so. */}
            {!canEdit && <span className="tl-faint">Reading only</span>}
          </footer>
        </>
      )}
      <MarkCard hover={hover} hidden={!!drag} projects={byPath} problems={problems} today={today} canMove={canEdit} />
      {drag && <span className="tl-sr" aria-live="polite">{`Moving to ${longDay(drag.day)}`}</span>}
      </div>
    </div>
  );
}

/** A project opened from the timeline, at the line a mark is (or at its top). */
function openAt(m: Mark | null, path: string, e?: { ctrlKey: boolean; metaKey: boolean }): void {
  if (m) revealItem(path, itemOf(m));
  A.openPath(path, { where: e && (e.ctrlKey || e.metaKey) ? 'tab' : 'current' });
}
