// The Projects home (docs/PROJECTS-DESIGN.md; 8.7 wave 2a, 30 Oct 2026): every project at a glance — health,
// progress, what's next and when it is due — as one view switch over the same projects: rows, cards, a board grouped
// by health or status (a card dropped in a column moves it there, with Undo), and every project's dates on one gantt
// where clashes call out. The filters, the find (and the words inside the projects' files), the weekly review, the
// update across every project, catching them all up and setting more up from a folder are all still here; the old
// Timeline button is the Timeline view now, and the portfolio board canvas moved under ⋯.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderProjectOffer, ProjectCard } from '../../../shared/types';
import type { Project } from '../../../shared/project-file';
import { FileHitRow, FileIndexLine } from '../components/FileHits';
import { Icon } from '../components/Icon';
import { ListDetail, RecordDetail } from '../components/ListDetail';
import { EmptyState, LoadingRows } from '../components/EmptyState';
import { openMenu, type MenuItem } from '../components/Menu';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { cardLineWords, dueWords, effectiveHealth, hashTint, healthPill, healthTone, initials, isDueSoon, readDate } from '../lib/projectLook';
import type * as W from '../state/workspace';
import { EditorContext, Inline, InlineDate } from './project/Inline';
import { ViewHeader } from './ViewHeader';
import * as A from '../state/actions';
import { askInChat, setUpProjectsFromFolder } from '../state/chat';
import { showFileHit, useFileHits, useFileIndexStatus } from '../state/fileSearch';
import { openModal, requestSearch } from '../state/modals';
import { openStarterPicker } from '../state/abilities';
import { isReviewDue, useReviewStanding } from '../state/reviews';
import { showError, toast, useApp, usePrefs } from '../state/store';
import { isFinished } from '../../../shared/finished';
import { isOpenProject, projectStanding } from '../../../shared/project-standing';
import { showCount } from '../../../shared/words';
import { plainText } from '../../../shared/plain-text';
import type { ProjectEdit } from '../../../shared/project-file';
import { runEditBatch } from '../state/projectWorkspace';
import { PROJECT_BOARD_COLUMNS, barPct, ganttLabelSide, ganttSegments, projectBoardColumn, projectBoardDrop, readProjectsView, thinGanttMonths, writeProjectsView, type ProjectsView } from '../../../shared/projects-87';
import { findProblems, projectTimeline, span, todayDay } from '../../../shared/timeline';
import { wantsDone } from '../../../shared/project-close';
import { useProjectCloser } from './project/useProjectCloser';

type Filter = 'all' | 'risk' | 'track' | 'due' | 'done';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Active' },
  { id: 'risk', label: 'Needs attention' },
  { id: 'due', label: 'Due soon' },
  { id: 'track', label: 'On track' },
  { id: 'done', label: 'Finished' },
];
const VIEWS: { id: ProjectsView; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
];
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
// Health tints read the one set (p13-vault-status): on track neutral, at risk and off track attention.
const tintOf = (tone: string) => (tone === 'warn' || tone === 'bad' ? 'red' : 'slate');
/** An avatar's tint, steady per name, from the kit's five. */


/** A project found by the words typed: its name, what's next, its owner, status or health. */
function found(c: ProjectCard, q: string): boolean {
  if (!q) return true;
  const hay = [c.name, c.next, c.owner, c.status, c.health, c.line?.words].filter(Boolean).join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function matches(c: ProjectCard, f: Filter): boolean {
  const done = isFinished(c.status);
  if (f === 'done') return done;
  // Finished projects (done, archived, cancelled…) are kept out of every list but Finished (26 Oct 2026).
  if (done) return false;
  // On hold and ideas are folded below with finished, and out of every filter: the lists hold open projects only.
  if (!isOpenProject(c.status)) return false;
  if (f === 'risk') return ['warn', 'bad'].includes(healthTone(effectiveHealth(c)));
  if (f === 'track') return healthTone(effectiveHealth(c)) === 'ok';
  // Due soon is what is still to come within a week (29 Oct sweep: a project 29 days overdue sat under "Due soon" and in
  // "due within a week"); overdue is late, and late projects are counted as late, not as soon.
  if (f === 'due') return isDueSoon(c.due, c.status);
  return true;
}

/** A project's health or status moved from the board: each write in order, one Undo walking the whole move back
 *  (a card leaving Done writes twice — status and health — so one undo call would leave it half-moved). A move to
 *  Done asks first when tasks are still open (p12-close-and-noise round 2: the shared closer, never silent). */
function moveProject(c: ProjectCard, edits: { field: 'status' | 'health'; value: string | null }[], requestDone: (path: string) => void): void {
  const all: ProjectEdit[] = edits.map((e) => ({ kind: 'set', field: e.field, value: e.value }));
  if (wantsDone(all)) {
    requestDone(c.path);
    return;
  }
  void runEditBatch({
    edits: all,
    words: `Moved ${c.name}.`,
    apply: async (e) => (await window.nv.projects.edit(c.path, e)).words,
    rollbackOne: async () => {
      await window.nv.projects.undo(c.path);
    },
    undoAll: () => {
      void (async () => {
        for (let i = 0; i < all.length; i++) await window.nv.projects.undo(c.path);
      })().catch(showError);
    },
  });
}

/** A project's status changed from its tile's menu, with Undo. Marking done asks first (the shared closer). */
function setStatus(c: ProjectCard, status: string, requestDone: (path: string) => void): void {
  if (wantsDone({ kind: 'set', field: 'status', value: status })) {
    requestDone(c.path);
    return;
  }
  void window.nv.projects
    .edit(c.path, { kind: 'set', field: 'status', value: status })
    .then((r) => toast(r.words, { label: 'Undo', run: () => void window.nv.projects.undo(r.view.path).catch(showError) }), showError);
}
/** One value changed where a row or card shows it (Nov 2026, "everything is editable where shown"): the one
 *  project write, with Undo. */
function saveCard(c: ProjectCard, field: 'name' | 'due' | 'health' | 'owner', value: string): Promise<boolean> {
  return window.nv.projects
    .edit(c.path, { kind: 'set', field, value })
    .then(
      (r) => {
        toast(r.words, { label: 'Undo', run: () => void window.nv.projects.undo(r.view.path).catch(showError) });
        return true;
      },
      (e) => {
        showError(e);
        return false;
      },
    );
}

/** How a project is going, changed from its row (the board moves it by dragging instead). */
function chooseHealth(c: ProjectCard, anchor: HTMLElement): void {
  const now = (c.health ?? '').toLowerCase();
  openMenu(anchor, [
    { heading: `${c.name}: how is it going` },
    ...['On track', 'At risk', 'Off track'].map((h) => ({ label: h, checked: now === h.toLowerCase(), run: () => void saveCard(c, 'health', h) })),
    ...(c.health ? [{ separator: true } as const, { label: 'Clear', run: () => void saveCard(c, 'health', '') }] : []),
  ]);
}

/** A project's own menu (26 Oct 2026 uplift: archive, bring back and delete where the project is seen). */
function projectMenu(c: ProjectCard, requestDone: (path: string) => void): MenuItem[] {
  const over = isFinished(c.status);
  return [
    { label: 'Open', icon: 'external' as const, run: () => A.openPath(c.path) },
    { label: 'Open in a new tab', icon: 'newTab' as const, run: () => A.openPath(c.path, { where: 'tab' }) },
    { separator: true as const },
    over
      ? { label: 'Bring back', icon: 'undo' as const, run: () => setStatus(c, 'active', requestDone) }
      : { label: 'Mark done', icon: 'check' as const, run: () => setStatus(c, 'done', requestDone) },
    ...(over ? [] : [{ label: 'Archive', icon: 'folder' as const, run: () => setStatus(c, 'archived', requestDone) }]),
    { separator: true as const },
    { label: 'Delete the project…', icon: 'trash' as const, danger: true, run: () => void A.trashPath(c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : c.path) },
  ];
}

/** The nearest day that is the person's own here: their next task's day, else the project's due date. */
const ownDay = (c: ProjectCard) => readDate(c.nextMineWhen) ?? readDate(c.due) ?? Infinity;

const ordered = (cards: ProjectCard[]) =>
  [...cards].sort((a, b) => {
    // At risk first, then by the nearest day that is the person's own (29 Oct 2026, redesign).
    const rank = (c: ProjectCard) => ({ bad: 0, warn: 1, none: 2, ok: 3 })[healthTone(effectiveHealth(c))];
    return rank(a) - rank(b) || ownDay(a) - ownDay(b) || a.name.localeCompare(b.name);
  });

const openCard = (c: ProjectCard, e: React.MouseEvent) => {
  // A nested control's click belongs to it (a row's own buttons); the card itself always opens (t18,
  // 8 Nov 2026: the guard matched the gallery card's own <button>, so no gallery card ever opened).
  const hit = (e.target as Element | null)?.closest?.('button, a, input, select');
  if (hit && hit !== e.currentTarget) return;
  A.openPath(c.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
};
const cardMenu = (c: ProjectCard, e: React.MouseEvent, requestDone: (path: string) => void) => {
  e.preventDefault();
  openMenu(e, projectMenu(c, requestDone));
};

/** One project as a row: tile, name, health, steps and due (the mock-up's clean row: no next-step line). The name
 *  and due change here (double-click, E or the pencil), how it is going from its pill; the count is counted, so it
 *  says so (Nov 2026, "everything is editable where shown"). A click still opens. */
function RowView({ c, requestDone }: { c: ProjectCard; requestDone: (path: string) => void }) {
  const canEdit = useApp((s) => s.canEdit);
  const finished = isFinished(c.status);
  // A finished project carries no health pill and no counts (sweep 3, 012): the row says Finished, never stale health.
  const health = finished ? null : healthPill(c);
  const due = dueWords(c.due, c.status);
  const line = cardLineWords(c.line, c.health);
  // Plain words (5 Nov 2026, the plan): at risk and off track attention, off track stronger, on track muted.
  // The standing's tone, so on hold and ideas read muted like finished, never their old health's alarm.
  const tone = projectStanding({ status: c.status, health: effectiveHealth(c) }).tone;
  const cls = tone === 'bad' ? 'is-attention is-strong' : tone === 'warn' ? 'is-attention' : 'is-muted';
  const editor = useMemo(() => ({ path: c.path, canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [c.path, canEdit]);
  return (
    <div className="trow w2a-rowbtn" role="button" tabIndex={0} aria-label={c.name} onClick={(e) => openCard(c, e)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) A.openPath(c.path); }} onContextMenu={(e) => cardMenu(c, e, requestDone)}>
      <span className="gtile xs slate" aria-hidden="true"><Icon name="briefcase" size={14} /></span>
      {/* A value's clicks belong to it (as a task row's title keeps its own): a double-click edits instead of opening. */}
      <span className="t w2a-clip" title={c.name} onClick={canEdit ? (e) => e.stopPropagation() : undefined}>
        {canEdit ? (
          <EditorContext.Provider value={editor}>
            <Inline value={c.name} required label="Project’s name" onSave={(v) => saveCard(c, 'name', v)}>
              {c.name}
            </Inline>
          </EditorContext.Provider>
        ) : (
          c.name
        )}
      </span>
      {health &&
        (canEdit ? (
          <button type="button" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', marginLeft: 12 }} aria-haspopup="menu" title="Change how it is going" onClick={(e) => (e.stopPropagation(), chooseHealth(c, e.currentTarget))}>
            <span className={`pill is-plain ${cls}`}>{health.words}</span>
          </button>
        ) : (
          <span className={`pill is-plain ${cls}`} style={{ marginLeft: 12 }}>{health.words}</span>
        ))}
      <span className="meta w2a-clip" style={{ marginLeft: 'auto' }}>
        {finished ? 'Finished' : <span title="Counted from the project's open tasks.">{`${c.openNext} task${c.openNext === 1 ? '' : 's'}`}</span>}
        {due ? (
          <>
            {' · '}
            {canEdit ? (
              <span onClick={(e) => e.stopPropagation()}>
                <EditorContext.Provider value={editor}>
                  <InlineDate value={c.due ?? ''} iso label="Due date" onSave={(v) => saveCard(c, 'due', v)}>
                    {due.words}
                  </InlineDate>
                </EditorContext.Provider>
              </span>
            ) : (
              due.words
            )}
          </>
        ) : (
          !finished && line?.words ? <span title="From the project's layout.">{` · ${line.words}`}</span> : null
        )}
      </span>
    </div>
  );
}

/** One project as a gallery card: tile, name, sub line, health and steps tags. */
function GalleryCard({ c, requestDone }: { c: ProjectCard; requestDone: (path: string) => void }) {
  const finished = isFinished(c.status);
  // Finished: no health tag and no step count (sweep 3, 012); the card says Finished and asks for nothing.
  const health = finished ? null : healthPill(c);
  const due = dueWords(c.due, c.status);
  const nextForYou = c.nextMine ?? c.next;
  const sub = finished ? (due ? `Finished · ${due.words}` : 'Finished') : due ? due.words : nextForYou ? plainText(nextForYou) : 'Nothing next written down';
  const tone = projectStanding({ status: c.status, health: effectiveHealth(c) }).tone;
  const cls = tone === 'bad' ? 'is-attention is-strong' : tone === 'warn' ? 'is-attention' : 'is-muted';
  return (
    <button className="gcard w2a-cardbtn" onClick={(e) => openCard(c, e)} onContextMenu={(e) => cardMenu(c, e, requestDone)} aria-label={c.name}>
      <span className="gtile slate" aria-hidden="true"><Icon name="briefcase" size={18} /></span>
      <div className="t w2a-clip" title={c.name}>{c.name}</div>
      <div className="s w2a-clip">{sub}</div>
      {health && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <span className={`tag is-plain ${cls}`}>{health.words}</span>
          <span className="tag is-plain is-muted" title="Counted from the project's open tasks.">{c.openNext ? `${c.openNext} task${c.openNext === 1 ? '' : 's'}` : 'no open tasks'}</span>
        </div>
      )}
    </button>
  );
}

const STATUS_COLUMNS = ['idea', 'planning', 'active', 'on hold', 'done'] as const;

/** Which status column a project sits in (finished words fold into Done; anything unrecognised stays Active).
 *  Whole words only (9.2 uplift F109): "Placeholder" and "Threshold work" are not "on hold". */
function statusColumn(c: ProjectCard): string {
  if (isFinished(c.status)) return 'done';
  const s = String(c.status ?? '');
  if (/\bidea\b/i.test(s)) return 'idea';
  if (/\bplan(?:ning)?\b/i.test(s)) return 'planning';
  if (/\bon hold\b|\bhold\b|\bpause[ds]?\b/i.test(s)) return 'on hold';
  return 'active';
}

/** One project as a board card (dragged between columns to move it): title, due and steps tags, owner's avatar.
 *  The title, due and owner change here (double-click, E or the pencil); the count is counted, so it says so
 *  (Nov 2026, "everything is editable where shown"). How it is going still moves by dragging. */
function BoardCard({ c, requestDone }: { c: ProjectCard; requestDone: (path: string) => void }) {
  const canEdit = useApp((s) => s.canEdit);
  // Finished cards sit in Done, which says it: no tags and no counts on them (sweep 3, 012).
  const finished = isFinished(c.status);
  const due = finished ? null : dueWords(c.due, c.status);
  const first = c.owner?.trim().split(/\s+/)[0] ?? '';
  const editor = useMemo(() => ({ path: c.path, canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [c.path, canEdit]);
  return (
    <div
      className="bcard w2a-drag"
      role="button"
      tabIndex={0}
      aria-label={c.name}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', c.path);
      }}
      onClick={(e) => openCard(c, e)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) A.openPath(c.path); }}
      onContextMenu={(e) => cardMenu(c, e, requestDone)}
    >
      {/* A value's clicks belong to it (as a task row's title keeps its own): a double-click edits instead of opening. */}
      <div className="t" onClick={canEdit ? (e) => e.stopPropagation() : undefined}>
        {canEdit ? (
          <EditorContext.Provider value={editor}>
            <Inline value={c.name} required label="Project’s name" onSave={(v) => saveCard(c, 'name', v)}>
              {c.name}
            </Inline>
          </EditorContext.Provider>
        ) : (
          c.name
        )}
      </div>
      {!finished && (due || c.openNext > 0) && (
        <div className="tags">
          <EditorContext.Provider value={editor}>
            {due &&
              (canEdit ? (
                <span onClick={(e) => e.stopPropagation()}>
                  <InlineDate value={c.due ?? ''} iso label="Due date" onSave={(v) => saveCard(c, 'due', v)}>
                    <span className={`tag is-plain ${due.tone === 'bad' ? 'is-attention' : 'is-muted'}`}>{due.words}</span>
                  </InlineDate>
                </span>
              ) : (
                <span className={`tag is-plain ${due.tone === 'bad' ? 'is-attention' : 'is-muted'}`}>{due.words}</span>
              ))}
            {c.openNext > 0 && <span className="tag is-plain is-muted" title="Counted from the project's open tasks.">{c.openNext} task{c.openNext === 1 ? '' : 's'}</span>}
          </EditorContext.Provider>
        </div>
      )}
      {c.owner && (
        <div className="who" onClick={canEdit ? (e) => e.stopPropagation() : undefined}>
          <i className={`miniava ${hashTint(c.owner)}`} aria-hidden="true">{initials(c.owner)}</i>
          {canEdit ? (
            <EditorContext.Provider value={editor}>
              <Inline value={c.owner} label="Owner" compact onSave={(v) => saveCard(c, 'owner', v)}>
                {first}
              </Inline>
            </EditorContext.Provider>
          ) : (
            first
          )}
        </div>
      )}
    </div>
  );
}

/** The board: the same projects in columns by health or status (the By switch sits beside the title). */
function BoardView({ cards, by, requestDone }: { cards: ProjectCard[]; by: 'health' | 'status'; requestDone: (path: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const find = (e: React.DragEvent) => cards.find((c) => c.path === e.dataTransfer.getData('text/plain'));
  const dropHealth = (e: React.DragEvent, col: (typeof PROJECT_BOARD_COLUMNS)[number]) => {
    e.preventDefault();
    setOver(null);
    const c = find(e);
    if (c && projectBoardColumn({ status: c.status, health: effectiveHealth(c) }) !== col.id) moveProject(c, projectBoardDrop(col.id, c), requestDone);
  };
  const dropStatus = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    setOver(null);
    const c = find(e);
    if (c && statusColumn(c) !== col) moveProject(c, [{ field: 'status', value: col === 'done' ? 'done' : col }], requestDone);
  };
  const cols =
    by === 'health'
      ? PROJECT_BOARD_COLUMNS.map((col) => ({ id: col.id, label: col.label, tint: col.tint, items: cards.filter((c) => projectBoardColumn({ status: c.status, health: effectiveHealth(c) }) === col.id) }))
      : STATUS_COLUMNS.map((id) => ({ id, label: id === 'done' ? 'Done' : cap(id), tint: 'slate' as const, items: cards.filter((c) => statusColumn(c) === id) }));
  return (
    <>
      <div className="boardwrap">
        <div className="board">
          {cols.map((col) => (
            <div
              key={col.id}
              className={`bcol${over === col.id ? ' is-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => (by === 'health' ? dropHealth(e, PROJECT_BOARD_COLUMNS.find((x) => x.id === col.id)!) : dropStatus(e, col.id))}
            >
              <div className="bhead">
                <span className={`tag is-plain ${col.id === 'off-track' ? 'is-attention is-strong' : col.id === 'at-risk' ? 'is-attention' : 'is-muted'}`}>{col.label}</span>
                {col.items.length > 0 && <span className="c">{col.items.length}</span>}
              </div>
              <button className="badd" onClick={() => void openModal({ kind: 'new-project' })}>+ Add a card</button>
              <div style={{ height: 10 }} />
              {col.items.length === 0 ? (
                <div className="card" style={{ padding: '14px 16px', background: 'none', borderStyle: 'dashed' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Nothing here. Good.</div>
                </div>
              ) : (
                col.items.map((c) => <BoardCard key={c.path} c={c} requestDone={requestDone} />)
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** The portfolio timeline: every project's dates on one gantt, with the Timeline's own clash reading. Names read whole
 *  (a wider column, wrapping to full names, opening the project); the scale is proportional to days and thins to
 *  what fits; a bar's label reads beside it when it will not fit inside; clash dots sit below the bars at the
 *  clashing day, never on a label (n3, 6 Nov 2026). */
function TimelinePane({ cards, onClash, requestDone }: { cards: ProjectCard[]; onClash(n: number): void; requestDone: (path: string) => void }) {
  const revision = useApp((s) => s.revision);
  const [all, setAll] = useState<{ path: string; project: Project }[] | null>(null);
  // Read again when the notes change, like every list around it: a date moved on a project page shows here.
  useEffect(() => {
    window.nv.projects.all().then(setAll, showError);
  }, [revision]);
  const today = todayDay();
  const rows = useMemo(() => (all ?? []).map((e) => projectTimeline(e.path, e.project, today)), [all, today]);
  const wanted = useMemo(() => {
    const keep = new Set(cards.map((c) => c.path));
    return rows.filter((r) => keep.has(r.path) && (r.start !== undefined || r.due !== undefined || r.marks.length > 0));
  }, [rows, cards]);
  const problems = useMemo(() => findProblems(wanted, today), [wanted, today]);
  useEffect(() => void onClash(problems.counts.clash), [problems.counts.clash, onClash]);
  const { from, to } = useMemo(() => (wanted.length ? span(wanted, today, 'months') : { from: today - 30, to: today + 90 }), [wanted, today]);
  const segs = useMemo(() => ganttSegments(from, to), [from, to]);
  // The track's measured width: the scale thins and the labels place by real room, re-read as it narrows.
  const scaleRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);
  const hasRows = wanted.length > 0;
  useEffect(() => {
    if (!hasRows) return;
    const el = scaleRef.current;
    if (!el) return;
    const read = () => setTrackPx((v) => (el.clientWidth !== v ? el.clientWidth : v));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);
  const px = trackPx || 800;
  const kept = useMemo(() => {
    const k = thinGanttMonths(segs.map((s) => s.width), px);
    // A pinned end label that would touch the previous kept one yields instead (its gridline still shows).
    const idx = k.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) {
      const L = idx[idx.length - 1], P = idx[idx.length - 2];
      const labelPx = segs[L].label.length * 6.2 + 14;
      if ((segs[L].left / 100) * px + labelPx > px && px - labelPx - (segs[P].left / 100) * px < 64) k[L] = false;
    }
    return k;
  }, [segs, px]);
  const clash = problems.list.find((x) => x.problem.kind === 'clash');
  const clashProject = clash ? wanted.find((r) => r.path === clash.mark.path)?.name : '';
  if (!all) return <LoadingRows rows={6} className="is-page" label="Reading every project’s dates" />;
  if (!wanted.length)
    return (
      <EmptyState
        size="panel"
        icon="timeline"
        title="No dates to line up yet"
        line="Give your projects start and due dates or key dates, and they line up here, so clashes and slips show early."
      />
    );
  return (
    <>
      <div className="card n3-gantt" style={{ padding: '16px 22px', marginTop: 12 }}>
        <div className="gmonths" ref={scaleRef}>
          {segs.map((s, i) => {
            // A kept label that would run past the track's end pins to it instead.
            const end = kept[i] && (s.left / 100) * px + s.label.length * 6.2 + 14 > px;
            return (
              <span key={`${s.label}-${i}`} className="gm-seg" style={{ left: `${s.left}%`, width: `${s.width}%` }}>
                {kept[i] ? <span className={end ? 'is-end' : undefined}>{s.label}</span> : null}
              </span>
            );
          })}
        </div>
        <div className="gantt" style={{ marginTop: 6 }}>
          {wanted.map((r, i) => {
            const { left, width } = barPct(r.start ?? null, r.due ?? null, from, to);
            const card = cards.find((c) => c.path === r.path);
            const tone = healthTone(card ? effectiveHealth(card) : r.health);
            const tint = r.done ? 'slate' : tintOf(tone);
            const label = card ? (dueWords(card.due, card.status)?.words ?? (r.done ? 'done' : '')) : '';
            const side = label ? ganttLabelSide(left, width, px, label) : 'in';
            const clashDay = r.marks.find((m) => (problems.marks.get(m.id) ?? []).some((p) => p.kind === 'clash'))?.day;
            const clashLeft = clashDay !== undefined ? ((clashDay - from) / Math.max(1, to - from + 1)) * 100 : Math.min(98, left + width / 2);
            return (
              <div key={r.path} className="grow" style={i === wanted.length - 1 ? { borderBottom: 0 } : undefined}>
                <button className="nm" title={`Open ${r.name}`} onClick={() => card && A.openPath(card.path)}>{r.name}</button>
                <div className="gtrack">
                  <button
                    className={`gbar ${tint} w2a-link`}
                    style={{ left: `${left}%`, width: `${width}%`, ...(tone === 'bad' && !r.done ? { fontWeight: 800 } : undefined) }}
                    title={`Open ${r.name}`}
                    onClick={() => card && A.openPath(card.path)}
                    onContextMenu={(e) => card && cardMenu(card, e, requestDone)}
                  >
                    {!!label && <span className={`gbar-label${side === 'in' ? '' : side === 'left' ? ' is-out is-left' : ' is-out'}`}>{label}</span>}
                  </button>
                  {clashDay !== undefined && <span className="w2a-clash" style={{ left: `${clashLeft}%` }} title="Clash: see below" />}
                  {from <= today && today <= to && <span className="w2a-today" style={{ left: `${((today - from) / Math.max(1, to - from + 1)) * 100}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {clash && (
        <div className="callout red" style={{ marginTop: 14 }}>
          <span aria-hidden="true"><Icon name="warning" size={15} /></span>
          <span><b>Clash{clashProject ? ` on ${clashProject}` : ''}:</b> {clash.problem.words}</span>
        </div>
      )}
    </>
  );
}

export function ProjectsHome({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<ProjectsView>(() => readProjectsView());
  const [by, setBy] = useState<'health' | 'status'>('health');
  const [query, setQuery] = useState('');
  const [clashes, setClashes] = useState(0);
  // The row the pointer or the keys are on: its overview stands beside the list on a wide window.
  const [picked, setPicked] = useState<string | null>(null);
  // Marking done asks first (p12-close-and-noise round 2): Mark done and both boards go through the shared closer.
  const { closer, requestDone } = useProjectCloser();
  useEffect(() => {
    window.nv.projects.list().then(setCards, showError);
  }, [revision]);
  // Offered folders, never silent (5 Nov 2026, u3 moving-in): folders that read like projects, and claimed-but-
  // unworked files, each with its explicit choice. A kept file stays kept on this PC.
  const [offers, setOffers] = useState<FolderProjectOffer[] | null>(null);
  const [keeps, setKeeps] = useState<string[]>([]);
  useEffect(() => {
    window.nv.projects.folderOffers().then(setOffers, showError);
  }, [revision]);
  useEffect(() => {
    window.nv.state.load<string[]>('project-keeps').then(
      (v) => setKeeps(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []),
      () => {},
    );
  }, []);
  const checks = (cards ?? []).filter((c) => c.thin && !keeps.includes(c.path));
  const offerCount = (offers ?? []).length + checks.length;
  const makeOffer = async (o: FolderProjectOffer) => {
    try {
      await window.nv.projects.fromFolder(o.folder);
      toast(`${o.name} is a project now.`);
    } catch (e) {
      showError(e);
    }
  };
  const keepThin = (path: string) => {
    const next = keeps.includes(path) ? keeps : [...keeps, path];
    setKeeps(next);
    window.nv.state.save('project-keeps', next).catch(() => {});
  };
  const unclaimThin = async (c: ProjectCard) => {
    try {
      await window.nv.projects.unclaim(c.path);
      toast(`${c.name} is a note again.`);
    } catch (e) {
      showError(e);
    }
  };
  const counts = useMemo(() => {
    const list = cards ?? [];
    const live = list.filter((c) => isOpenProject(c.status));
    return { all: live.length, ok: live.filter((c) => healthTone(effectiveHealth(c)) === 'ok').length, warn: live.filter((c) => healthTone(effectiveHealth(c)) === 'warn').length, bad: live.filter((c) => healthTone(effectiveHealth(c)) === 'bad').length, done: list.filter((c) => isFinished(c.status)).length, due: live.filter((c) => isDueSoon(c.due, c.status)).length };
  }, [cards]);
  const q = query.trim();
  // The filters shape the rows and the cards; the board and the timeline group the projects themselves, so they
  // take every project and only the find narrows them.
  const filtered = (cards ?? []).filter((c) => matches(c, filter) && found(c, q));
  const searched = (cards ?? []).filter((c) => found(c, q));
  const shown = ordered(filtered);
  const boardCards = ordered(searched);
  // Finished projects folded at the end, under the live ones (not mixed in, not gone).
  const doneFolded = filter === 'all' && !q ? (cards ?? []).filter((c) => isFinished(c.status)) : [];
  // On hold and ideas fold beside them: out of the open lists and counts, still one click away.
  const heldFolded = filter === 'all' && !q ? (cards ?? []).filter((c) => !isFinished(c.status) && !isOpenProject(c.status)) : [];
  const switchView = (v: ProjectsView) => {
    setView(v);
    writeProjectsView(v);
    // The find box lives on the list: leaving it clears the words, so the other views always show everything.
    if (v !== 'list') setQuery('');
  };

  const standing = useReviewStanding(revision);
  const reviewDue = isReviewDue(standing, new Date(), false);
  const indexStatus = useFileIndexStatus();
  const insideOn = !!indexStatus?.on && indexStatus.projects.some((p) => p.on);
  const { hits: fileHits, busy: filesBusy } = useFileHits(query, { min: 3, limit: 40 });
  usePrefs();

  const setUp = () => void setUpProjectsFromFolder();
  const catchUpAll = () => askInChat('Catch up all my projects: what’s new or changed in each project’s folder since it was last updated? Propose the changes for each.');
  // A project by hand: the New project window, where its shape (a project template) is chosen.
  const newProject = async () => openModal({ kind: 'new-project' });
  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search):
  // the buttons below yield one by one from the least used when measured within 12px of the bar (Weekly
  // review first, then New project), and the menu carries exactly the hidden ones — the Due hint rides
  // along, so the signal is not lost. (3 Nov 2026 sweep D hid Weekly review below 1150px of bar; fixed steps
  // could not hold every page, so the real rectangles decide now.)
  const moreItems = (): MenuItem[] => {
    const over = overflowMenuItems(headerOverflowHidden(tab.id), {
      'weekly-review': () => ({ label: 'Weekly review', icon: 'review' as const, hint: reviewDue ? 'Due' : undefined, run: () => A.openWeeklyReview() }),
      'new-project': () => ({ label: 'New project', icon: 'plus' as const, disabled: !canEdit, run: () => void newProject() }),
    });
    return [
    ...over,
    ...(over.length ? [{ separator: true } as const] : []),
    { label: 'Catch up all projects', icon: 'refresh', hint: 'From their folders, in the chat', run: catchUpAll },
    { label: 'Set up more from a folder…', icon: 'folderPlus', disabled: !canEdit, run: () => void setUp() },
    // Start from a template (8.8): a client project, a meeting series and the rest, each in its own folder.
    { label: 'Start from a template…', icon: 'template', disabled: !canEdit, run: () => openStarterPicker() },
    { label: 'Open the portfolio board', icon: 'canvas', hint: 'Every project on a canvas', run: () => void import('./canvas/projectBoards').then((m) => m.openPortfolioBoard()) },
    ];
  };
  const inSearch = () => {
    requestSearch(q);
  };
  const openCount = counts.all;

  return (
    <>
      <ViewHeader tab={tab} menu={moreItems}>
        <button className="btn" data-overflow="weekly-review" data-overflow-order={1} title={reviewDue ? 'This week’s review is waiting: what moved, what slipped, what to chase, and the changes to make' : 'Go over the week across every project: what moved, what slipped, what to chase, and the changes to make'} onClick={() => A.openWeeklyReview()}>
          Weekly review
          {reviewDue && <span className="pill coral" style={{ height: 20 }}>Due</span>}
        </button>
        <button className="btn pri" data-overflow="new-project" data-overflow-order={2} disabled={!canEdit} onClick={() => void newProject()}><Icon name="plus" size={14} /> New project</button>
      </ViewHeader>
      <div className="vscroll">
      {/* The list stands in the frame's column; the board, gallery and timeline run full width (p25 one column). */}
      <div className={`vpage wide${view === 'list' ? ' has-split' : ' full'}`}>
        <div className="w2a-head">
          <h1 className="w2a-title">Projects</h1>
          {(view === 'list' || view === 'gallery') && cards && openCount > 0 && <span className="nv-page-count">{openCount} open</span>}
          {view === 'board' && (
            <span className="seg" role="group" aria-label="Group the board by" style={{ marginLeft: 8 }}>
              <button className={by === 'health' ? 'on' : ''} aria-pressed={by === 'health'} onClick={() => setBy('health')}>By health</button>
              <button className={by === 'status' ? 'on' : ''} aria-pressed={by === 'status'} onClick={() => setBy('status')}>By status</button>
            </span>
          )}
          {view === 'timeline' && clashes > 0 && <span className="pill coral">{clashes} clash{clashes === 1 ? '' : 'es'}</span>}
          <span className="seg" role="tablist" aria-label="How the projects are shown" style={{ marginLeft: 'auto' }}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} title={`Projects as ${v.label.toLowerCase()}`} onClick={() => switchView(v.id)}>
                {v.label}
              </button>
            ))}
          </span>
        </div>

        {offerCount > 0 && (
          <div className="pj-offers" style={{ marginTop: 14 }}>
            {(offers ?? []).length > 0 && (
              <section className="card pj-offer-card" aria-label="Folders that look like projects">
                <div className="pj-offer-title">These folders look like projects</div>
                <p className="meta">Notes and tasks, but no project file. Making one writes a single blank file. Nothing else changes.</p>
                {(offers ?? []).map((o) => (
                  <div className="trow" key={o.folder}>
                    <span className="t">
                      <strong>{o.name}</strong> <span className="meta">{o.notes} notes · {o.tasks} open task{o.tasks === 1 ? '' : 's'}</span>
                    </span>
                    <button className="btn small push" disabled={!canEdit} onClick={() => void makeOffer(o)}>
                      Make it a project
                    </button>
                  </div>
                ))}
              </section>
            )}
            {checks.length > 0 && (
              <section className="card pj-offer-card" aria-label="Project files to check">
                <div className="pj-offer-title">Project files to check</div>
                <p className="meta">Claimed as projects, but with no tasks or dates yet. Yours to keep or take back.</p>
                {checks.map((c) => (
                  <div className="trow" key={c.path}>
                    <span className="t">
                      <strong>{c.name}</strong> <span className="meta">{c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : 'Top level'}</span>
                    </span>
                    <button className="btn small push" disabled={!canEdit} onClick={() => keepThin(c.path)}>
                      Keep as project
                    </button>
                    <button className="btn small" disabled={!canEdit} onClick={() => void unclaimThin(c)}>
                      Not a project
                    </button>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {cards === null ? (
          <LoadingRows rows={6} className="is-page" label="Reading your projects" />
        ) : cards.length === 0 && offerCount === 0 ? (
          <EmptyState
            icon="layers"
            title="Your projects, in one place"
            line="Point Ironleaf at the folder your projects live in, and it sets up a page for each: where it’s up to, what’s next, dates, people, risks and files."
            action={{ label: 'Set up from a folder…', icon: 'folderPlus', run: () => void setUp(), disabled: !canEdit }}
            also={{ label: 'One project by hand', icon: 'plus', run: () => void newProject(), disabled: !canEdit }}
          />
        ) : (
          <>
            {view === 'list' && cards.length > 0 && (
              /* The filter tabs scroll sideways in a narrow pane, never wrap (polish round 3, item 5). */
              <div className="chips pj-filter-tabs" role="tablist" aria-label="Which projects" style={{ marginTop: 14 }}>
                {FILTERS.map((f) => {
                  const n = f.id === 'all' ? counts.all : f.id === 'risk' ? counts.warn + counts.bad : f.id === 'track' ? counts.ok : f.id === 'due' ? counts.due : counts.done;
                  return (
                    <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip pj-filter${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                      {f.label}
                      {/* One zero rule on every filter, shared with People and the note foot (3 Nov 2026, fifth-round H1): a zero stays off, like a badge, so Finished never looks like a different kind of filter. */}
                      {showCount(n) ? <span className="n">{n}</span> : null}
                    </button>
                  );
                })}
                <span className="searchbox" style={{ maxWidth: 220, marginLeft: 'auto' }}>
                  <Icon name="search" size={14} />
                  <input
                    type="search"
                    value={query}
                    placeholder="Find a project"
                    aria-label="Find a project"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) {
                        e.stopPropagation();
                        setQuery('');
                      }
                    }}
                  />
                </span>
              </div>
            )}

            {cards.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {view === 'list' &&
                (shown.length === 0 ? (
                  <EmptyState
                    size="panel"
                    icon={q ? 'search' : 'layers'}
                    title={q ? 'No project matches' : 'No projects here'}
                    line={q ? `No project’s name, task or owner matches “${q}”${filter === 'all' ? '' : ' in this filter'}.` : 'None of your projects is in this filter.'}
                    action={q ? { label: 'Clear the search', run: () => setQuery('') } : filter !== 'all' ? { label: 'Show every project', run: () => setFilter('all') } : undefined}
                  />
                ) : (
                  <ListDetail
                rows={shown.length}

                    label="The project chosen"
                    list={
                      <div
                        className="card"
                        style={{ padding: '6px 20px' }}
                        onMouseOver={(e) => {
                          const at = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
                          if (at && at !== picked) setPicked(at);
                        }}
                        onFocus={(e) => {
                          const at = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
                          if (at) setPicked(at);
                        }}
                      >
                        {shown.map((c) => (
                          <div key={c.path} className="nv-pick" data-pick={c.path}>
                            <RowView c={c} requestDone={requestDone} />
                          </div>
                        ))}
                      </div>
                    }
                    detail={<RecordDetail refTo={{ path: shown.some((c) => c.path === picked) ? picked! : shown[0].path, type: 'project' }} />}
                  />
                ))}
              {view === 'gallery' &&
                (shown.length === 0 ? (
                  <EmptyState
                    size="panel"
                    icon={q ? 'search' : 'layers'}
                    title={q ? 'No project matches' : 'No projects here'}
                    line={q ? `No project’s name, task or owner matches “${q}”${filter === 'all' ? '' : ' in this filter'}.` : 'None of your projects is in this filter.'}
                    action={q ? { label: 'Clear the search', run: () => setQuery('') } : filter !== 'all' ? { label: 'Show every project', run: () => setFilter('all') } : undefined}
                  />
                ) : (
                  <div className="gal">
                    {shown.map((c) => (
                      <GalleryCard key={c.path} c={c} requestDone={requestDone} />
                    ))}
                  </div>
                ))}
              {view === 'board' && <BoardView cards={boardCards} by={by} requestDone={requestDone} />}
              {view === 'timeline' && <TimelinePane cards={cards} onClash={setClashes} requestDone={requestDone} />}
            </div>
            )}

            {(view === 'list' || view === 'gallery') && doneFolded.length > 0 && (
              <details className="pj-done-fold">
                <summary>Finished · {doneFolded.length}</summary>
                {view === 'list' ? (
                  <div className="card" style={{ padding: '6px 20px', marginTop: 8 }}>
                    {doneFolded.map((c) => (
                      <RowView key={c.path} c={c} requestDone={requestDone} />
                    ))}
                  </div>
                ) : (
                  <div className="gal" style={{ marginTop: 8 }}>
                    {doneFolded.map((c) => (
                      <GalleryCard key={c.path} c={c} requestDone={requestDone} />
                    ))}
                  </div>
                )}
              </details>
            )}
            {(view === 'list' || view === 'gallery') && heldFolded.length > 0 && (
              <details className="pj-done-fold">
                <summary>On hold · {heldFolded.length}</summary>
                {view === 'list' ? (
                  <div className="card" style={{ padding: '6px 20px', marginTop: 8 }}>
                    {heldFolded.map((c) => (
                      <RowView key={c.path} c={c} requestDone={requestDone} />
                    ))}
                  </div>
                ) : (
                  <div className="gal" style={{ marginTop: 8 }}>
                    {heldFolded.map((c) => (
                      <GalleryCard key={c.path} c={c} requestDone={requestDone} />
                    ))}
                  </div>
                )}
              </details>
            )}
            {insideOn && q.length >= 3 && view === 'list' && (
              <section className="pj-inside" aria-label="Found inside project files">
                <header className="pj-inside-head">
                  <h2>
                    In project files
                    {fileHits.length > 0 && <span className="pj-count">{fileHits.length >= 40 ? '40+' : fileHits.length}</span>}
                  </h2>
                  {fileHits.length > 0 && (
                    <button className="text-button" onClick={inSearch}>
                      Show in Search
                    </button>
                  )}
                </header>
                <FileIndexLine />
                {fileHits.length === 0 ? (
                  <p className="pj-faint pj-inside-none">{filesBusy ? 'Looking inside the files…' : `No file in your projects’ folders says “${q}”.`}</p>
                ) : (
                  <div className="pj-inside-list">
                    {fileHits.slice(0, 8).map((h) => (
                      <FileHitRow key={`${h.project}:${h.rel}`} hit={h} query={q} compact onOpen={(hit) => showFileHit(hit, fileHits, q)} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
      </div>
      {closer}
    </>
  );
}
