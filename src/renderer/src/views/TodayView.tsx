// Today (17 Oct 2026): what needs me now (3 Nov 2026, audit f F4: Home is the areas and overview again, Today keeps
// the day). The morning brief on top (from the brief seam, with money and people lines), one Ask box (Ask / Find /
// Do), then the day (the calendar, the meetings, the day's note, what is due and late), what needs me, and the
// projects needing a look — then the week and the automations.
//
// The day's work comes from what the project files and notes say (src/shared/today.ts): due and overdue, waiting on
// others, at risk, changed since yesterday. Each line does its job in one click: tick a step done, change its words,
// owner or date where shown (written to the project file, with Undo), open the project.
//
// Its own tab (Open Today in Commands) and what an empty tab shows (Settings › Appearance › Interface). Another day
// chosen in the strip shows that day's hub; ← and → move a day, T comes back to today. The brief and the Ask box are
// today's: another day keeps its day-first order.

import { todayFor } from '../../../shared/areas';
import { isFreshVault, isOwnNote } from '../../../shared/vault-place';
import type { Brief, BriefItem } from '../../../shared/brief';
import { todayCardBrief } from '../../../shared/brief';
import { dayFor, dueFor, TodayAreas, useTodayKeep, useTodayKeepArea } from './today/TodayAreas';
import { TodayModules } from './today/TodayModules';
import { useAreas, usePick } from '../state/areas';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProjectEdit } from '../../../shared/project-file';
import { isProjectProps } from '../../../shared/project-file';
import { shows, type Hideable } from '../../../shared/prefs';
import { addDays, daysApart, isoOf, longDay, monthGrid, nearWords, readTaskDue, todayHidden, weekOf, type DayMark, type DueEntry, type HubDay } from '../../../shared/hub';
import type { DueView } from '../../../main/hub';
import { calendarDayDiff, daySentence, dayShapeCounts, dayWords, dormantOpenCountWords, dormantOpenWords, isLive, isOwnText, isStaleOffset, readDay, snoozeDate, withChangedFiles, type AtRiskItem, type ChangeGroup, type ChangeLine, type DormantOpen, type DueItem, type TodayData, type TodayFileInput, type TodayRef, type UnscheduledItem, type WaitingItem } from '../../../shared/today';
import { dayInStyle } from '../../../shared/layouts';
import { splitDayPlan } from '../../../shared/projects-87';
import { docs } from '../state/docs';
import { EditorContext, Inline, InlineDate } from './project/Inline';
import { prompt } from '../components/Dialogs';
import { billsHeadCounts, billsKeepWelcome } from '../../../shared/finance';
import { sparkTodayRows, inboxLine } from '../../../shared/spark-needs';

import { chaseWords, datePill, dueOwnerText, groupWaiting, visibleWho, whenTone } from '../components/plan/plan';
import { WhenInner, WhoInner } from '../components/plan/TaskCells';
import { OwnerChip } from '../components/plan/OwnerChip';
import { StatusPill } from '../components/plan/StatusPill';
import { SetupLine } from './today/SetupLine';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { todayData, todayDataSync } from '../lib/todayData';
import { CardsSkeleton, PageError, PageLoading, RowsSkeleton } from '../components/PageStates';
import { activityWords } from '../lib/assistantWords';
import { formatHotkey } from '../lib/hotkeys';
import { inVaultView } from '../lib/inWindow';

import * as A from '../state/actions';
import { isReviewDue, noteReviewSeen, useReviewStanding } from '../state/reviews';
import { revealItem } from './timeline/reveal';
import { peek } from '../state/peek';
import { draftInChat } from '../state/chat';
import { openStarterPicker } from '../state/abilities';
import { getWorkspace, setWorkspace } from '../state/layout';
import { getState, showError, toast, useApp, usePrefs } from '../state/store';
import { useWork, workCall, workDid } from '../state/workModules';
import type { MeetingsView } from './modules/work/MeetingsPage';
import { CardGuard } from '../components/ErrorBoundary';
import { extrasOf, type HomeCardId } from '../../../shared/home-cards';
import { closeTab, type TabState } from '../state/workspace';
import { usePartOn } from '../state/modules';
import { useFinance } from '../state/recordModules';
import { openInbox } from '../state/life';
import { useNotices, refreshNotices } from '../panels/NoticeBell';
import { useInboxCount } from '../panels/AreasPlaces';
import { ViewHeader } from './ViewHeader';
import { LookRow } from '../components/LookRow';
import { Balance, type BalanceItem } from '../components/Balance';
import { useRoomy } from '../components/ListDetail';
import { BillsCard, BriefCardHome, FamilyCard, HabitsCard, InboxCard, MovingIn, RecentCard, SetupSteps, useHomeLayout, useMovingIn, WeeklyCard } from './HomeView';
import { ChangesWaiting } from '../components/ChangesWaiting';
import { ImportDialog, VaultTodayCards } from '../components/VaultHome';
import { PairDialog } from '../components/PairedSources';
import type { FileKind } from '../../../shared/pairing/types';
import { WeekStrip } from './today/WeekStrip';
import { ProjectChecksToday } from './today/ProjectChecksToday';
import { DayNote } from './today/DayNote';
import { DueOnDay, DueRow, useTicks } from './today/DueCard';
import { rankAllFor, splitTodayTop, type TopWork } from '../../../shared/brief-tasks';
import { splitRiskTail } from '../../../shared/project-file';
import { DayActivity, DayAgenda, DayMeetingActions, DaySaved } from './today/DayParts';
import { MeetingsAfterLine } from './modules/work/MeetingsPage';
import { CardsDue } from './today/CardsDue';
import { Glance, useGlance } from './today/Glance';

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Lines shown in a group before "Show all". */
const SHOWN = 6;
/** Next shows at most five (4 Nov 2026, p12-today-focus; step 2: Late reads above it, never in it). */
const NEXT_SHOWN = 5;
/** Each the former host app row's icon, the bell's own for its kind (9 Nov 2026, t53-today-needs-you). */
const SPARK_ICON = { approvals: 'lock', 'code-done': 'check', 'code-stopped': 'warning', 'bot-ask': 'help' } as const;

/** Whether Today's month calendar was left open (this PC only; a convenience, so nothing is lost if it can't be kept). */
const MONTH_KEY = 'nv.today.month';
function readMonthOpen(): boolean {
  try {
    return localStorage.getItem(MONTH_KEY) === '1';
  } catch {
    return false;
  }
}
function keepMonthOpen(open: boolean): void {
  try {
    localStorage.setItem(MONTH_KEY, open ? '1' : '0');
  } catch {
    // Not kept: it opens as a week next time.
  }
}
/** Whether More for today was left open (5 Nov 2026, one fold line for everything past them, remembered; replaces
 *  the separate rest and waiting folds). Shut unless opened (layout round 2: shut, the work and the day end near
 *  each other inside about one screen; opened, its sections balance into the shorter column). */
const ELSE_KEY = 'nv.today.elseOpen';
function readElseOpen(): boolean {
  try {
    // A person who left the old rest or waiting folds open keeps them open once.
    if (localStorage.getItem(ELSE_KEY) === null && (localStorage.getItem('nv.today.restOpen') === '1' || localStorage.getItem('nv.today.waitOpen') === '1')) return true;
    return localStorage.getItem(ELSE_KEY) === '1';
  } catch {
    return false;
  }
}
function keepElseOpen(open: boolean): void {
  try {
    localStorage.setItem(ELSE_KEY, open ? '1' : '0');
  } catch {
    // Not kept: it folds again next time.
  }
}
/** Typing somewhere (a box, the day's note): the day keys leave it alone. */
const typingIn = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest('.cm-editor, [role="menu"], .modal'));

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "9:41 am" today, "Yesterday", else the day. Nothing for a moment that cannot be read (8.7 urgent, 30 Oct 2026):
 *  the same MONTHS[NaN] crash as Home's had. */
function whenChanged(ms: number, now: Date, dayOnly = false): string {
  if (!Number.isFinite(ms)) return '';
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= start) return dayOnly ? 'Today' : new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m');
  if (calendarDayDiff(ms, now) === -1) return 'Yesterday';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** A small round button on a line (it never opens the line itself). */
function RowButton({ icon, title, onClick, haspopup, disabled }: { icon: IconName; title: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void; haspopup?: boolean; disabled?: boolean }) {
  return (
    <button
      className="td-act"
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-haspopup={haspopup ? 'menu' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** A whole line that opens with a click (or Enter), with its own buttons that don't. */
function Row({ className = '', onOpen, onMenu, children, label }: { className?: string; onOpen(e: React.MouseEvent | React.KeyboardEvent): void; onMenu?(e: React.MouseEvent): void; children: ReactNode; label: string }) {
  return (
    <div
      className={`td-row ${className}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(e);
        }
      }}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          onMenu(e);
        })
      }
    >
      {children}
    </div>
  );
}

function Section({ id, title, count, hint, children, className = '', action }: { id: string; title: string; count?: number; hint?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`td-section ${className}`} data-section={id} aria-labelledby={`td-h-${id}`}>
      <header className="td-section-head">
        <h2 id={`td-h-${id}`}>
          {title}
          {!!count && <span className="td-count">{count}</span>}
        </h2>
        {hint && <span className="td-section-hint">{hint}</span>}
        {action}
      </header>
      {children}
    </section>
  );
}

function More<T>({ items, render, limit = SHOWN }: { items: T[]; render(item: T): ReactNode; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      {shown.map(render)}
      {items.length > limit && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
    </>
  );
}

/** How many kinds Also's look list holds, counted from what rendered (8 Nov 2026, calm list):
 *  one number per kind, never one per item. Each module's section counts once (three bills due are one kind),
 *  and every other row (a nag, a vault or card row, the one folded projects row) carries data-look-row and
 *  counts once. Rows inside an opened row's <details> never count: the row counts once, shut or open. One
 *  mechanism for every pack and whatever they add later. The live hub counts blocks only: each waiting block
 *  marks its section, and the lines inside it (an approval's detail, a deck list) never inflate the count. */
function useLookCount(el: HTMLDivElement | null, blocksOnly = false): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!el) return;
    const count = () => setN(el.querySelectorAll(blocksOnly ? ':scope [data-look-row]' : ':scope section[data-section]:not(details section), :scope [data-look-row]:not(section):not(details [data-look-row])').length);
    count();
    const mo = new MutationObserver(count);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [el, blocksOnly]);
  return n;
}

/** The person's turned-on cards as rows of the list (8 Nov 2026, calm Today): the Inbox, recently viewed, and
 *  the pack cards, in the person's own order from their Home arrangement. Each row opens to its card as the old
 *  fold did. Recently viewed with nothing in it is no row. */
function LookCards({ layoutOn, inboxCount, recent }: { layoutOn: HomeCardId[]; inboxCount: number; recent: string[] }) {
  const extras = extrasOf(layoutOn);
  const cards: Record<HomeCardId, ReactNode> = {
    due: null,
    brief: null,
    waiting: null,
    upcoming: null,
    activity: null,
    'day-note': null,
    inbox: <InboxCard count={inboxCount} />,
    recent: <RecentCard recent={recent} />,
    bills: <BillsCard />,
    habits: <HabitsCard />,
    weekly: <WeeklyCard />,
    family: <FamilyCard />,
  };
  const titles: Record<string, string> = { inbox: 'Inbox', recent: 'Recently viewed', bills: 'Bills due', habits: 'Habits to tick', weekly: 'Weekly update', family: 'Family today' };
  const titleOf = (id: HomeCardId): string => titles[id] ?? id;
  // In the former host app's window the Inbox line carries the Inbox (9 Nov 2026, t53-today-needs-you): the
  // card row steps aside there, so the Inbox never lists twice.
  const rows = extras.filter((id) => (id !== 'recent' || recent.length > 0) && (id !== 'inbox' || !inVaultView()));
  if (!rows.length) return null;
  return (
    <>
      {rows.map((id) => (
        <LookRow key={id} title={titleOf(id)}>
          <CardGuard name={id}>{cards[id]}</CardGuard>
        </LookRow>
      ))}
    </>
  );
}

export function TodayView({ tab, home }: { tab: TabState; home?: { tab: TabState; closable: boolean } }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const prefsNow = usePrefs();
  const [data, setData] = useState<TodayData | null>(() => todayDataSync());
  const [files, setFiles] = useState<TodayFileInput[]>([]);
  const [error, setError] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // The morning brief (10.0: back on top, with money and people lines). The person's own cards live on
  // Home now (3 Nov 2026, audit f F4); Today keeps the day.
  const [brief, setBrief] = useState<Brief | null>(null);
  const vaultName = useApp((s) => s.vault?.name ?? 'Ironleaf');
  const [now, setNow] = useState(() => new Date());
  const standing = useReviewStanding(revision);
  const notes = useApp((s) => s.notes);
  // The person's own notes, and whether the vault is new (t156, 9 Nov 2026): the welcome note and the ready-made
  // templates are the app's, never theirs — the setup steps and the teaching lines read these, never the raw count.
  const ownNotes = useMemo(() => notes.filter((n) => isOwnNote(n.path, prefsNow.templatesFolder)), [notes, prefsNow.templatesFolder]);
  const fresh = useMemo(() => isFreshVault(notes.map((n) => n.path), prefsNow.templatesFolder), [notes, prefsNow.templatesFolder]);
  const movingIn = useMovingIn(ownNotes.length);
  // Bills for the figures (3 Nov 2026, fourth-round G1): the same Money read the Bills card uses, so the head counts
  // every late thing the page shows. Null while first read counts nothing, like Due not loaded yet.
  const billsOn = usePartOn('finance', 'bills');
  const { data: finance } = useFinance(billsOn);
  const page = useRef<HTMLDivElement>(null);
  // The hub: the day chosen in the strip (today unless another was chosen), its note, meetings and activity, the strip's
  // dots, and what is due (src/main/hub.ts, all from the index).
  const todayIso = isoOf(now);
  const [selected, setSelected] = useState(todayIso);
  const [monthOpen, setMonthOpen] = useState(readMonthOpen);
  const [elseOpenAsked, setElseOpen] = useState(readElseOpen);
  // Three columns (round 3): More for today stands open in its own column, never one shut line beside a blank.
  const [columns, setColumns] = useState<1 | 2 | 3>(2);
  const [shutInThree, setShutInThree] = useState(false);
  const elseOpen = columns === 3 ? !shutInThree : elseOpenAsked;
  // A tall window shows more of each group before "Show all" (the columns run to the window's foot).
  const tall = useRoomy('(min-height: 1200px)');
  const [hubDayRaw, setHubDay] = useState<HubDay | null>(null);
  const [marks, setMarks] = useState<Record<string, DayMark>>({});
  const [dueRaw, setDue] = useState<DueView | null>(null);
  // Hub reads that failed (W5-5): said once under the greeting, never an empty day.
  const [hubFailed, setHubFailed] = useState(false);
  const [dueOnDay, setDueOnDay] = useState<DueEntry[] | null>(null);
  // Bring in your notes (the empty state's third way to start): the Import window from Settings › Files and links,
  // and its From another app window, opened here as they are there (no new flow).
  const [bringIn, setBringIn] = useState(false);
  const [pairSource, setPairSource] = useState<FileKind | null>(null);
  // Home folded into Today (5 Nov 2026, one morning place): the person's card arrangement, kept per vault,
  // the Inbox count for its card, recently viewed, and changing the cards (the same dialog Home had).
  const vaultPath = useApp((s) => s.vault?.path);
  // The person's card arrangement, kept per vault (8 Nov 2026, calm Today: read, never changed here — the
  // old cards block and its changer are gone; a card turned on is a row in the list).
  const [homeLayout] = useHomeLayout(vaultPath);
  // How many wait in the Inbox (9 Nov 2026, t119 one-tap filing: the one hook the side bar reads too, so
  // Today's "waiting to be filed", the Inbox page and the side bar count the same rule — never read once).
  const inboxCount = useInboxCount() ?? 0;
  // Also's look rows, counted from what rendered (shut or open, the count is the same), rows and
  // live-hub blocks together, so a waiting approval, change set or deck is never hidden behind Also shut.
  const [lookEl, setLookEl] = useState<HTMLDivElement | null>(null);
  const [liveEl, setLiveEl] = useState<HTMLDivElement | null>(null);
  // Layout round 2: the packs' blocks stand as blocks of their own (balanced between the columns), counted here too.
  const [dueEl, setDueEl] = useState<HTMLDivElement | null>(null);
  const [waitEl, setWaitEl] = useState<HTMLDivElement | null>(null);
  const [cardsEl, setCardsEl] = useState<HTMLDivElement | null>(null);
  const ownLook = useLookCount(lookEl) + useLookCount(liveEl, true);
  const lookCount = ownLook + useLookCount(dueEl) + useLookCount(waitEl) + useLookCount(cardsEl);
  const recent = useMemo(() => getWorkspace().recent.filter((p) => !p.includes(':')), []);
  // The former host app's needs-you rows (9 Nov 2026, t53-today-needs-you: one product, Today holds what needs
  // you from the former host app too): behind the flag, from the bell's own store, so Today and the bell read
  // the same items and agree.
  const inView = useRef(inVaultView()).current;
  const notices = useNotices();
  const sparkRows = useMemo(() => (inView ? sparkTodayRows(notices.items) : []), [inView, notices.items]);
  useEffect(() => {
    if (inView) refreshNotices();
  }, [inView]);
  const isToday = selected === todayIso;
  const wasToday = useRef(todayIso);
  /** Each project file's version after Today's own changes (a change is made on the file as the last one left it). */
  const versions = useRef(new Map<string, string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const since = data?.since;

  const load = useCallback(
    () =>
      todayData().then(
        (d) => {
          versions.current = new Map();
          setData(d);
          setError('');
          setTicked(new Set());
        },
        (e) => setError(errorMessage(e)),
      ),
    [],
  );
  const reloadBrief = useCallback(() => void window.nv.brief.get().then(setBrief, () => undefined), []);
  // The brief, read with the rest (a burst of changes is read once, as above).
  useEffect(() => {
    const t = setTimeout(() => {
      void window.nv.brief.get().then(setBrief, () => undefined);
    }, brief ? 200 : 0);
    return () => clearTimeout(t);
  }, [revision]);
  // The notes: read now and whenever they change (a little after, so a burst of changes is read once).
  useEffect(() => {
    const t = setTimeout(() => void load(), data ? 200 : 0);
    return () => clearTimeout(t);
  }, [revision, load]);
  // The folders on the PC: after the first paint, when the window comes back, and every few minutes while shown.
  const loadFiles = useCallback(() => {
    if (since === undefined) return;
    void window.nv.today.files(since).then(setFiles, () => undefined);
  }, [since]);
  useEffect(() => {
    loadFiles();
    const onFocus = () => document.visibilityState === 'visible' && loadFiles();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(onFocus, 180000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [loadFiles]);
  // A new day (left open overnight): everything read again.
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNow((was) => {
        if (was.getDate() !== d.getDate()) void load();
        return d.getMinutes() !== was.getMinutes() ? d : was;
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);

  // Left open overnight on today: it moves on to the new today.
  useEffect(() => {
    if (wasToday.current !== todayIso) {
      setSelected((s) => (s === wasToday.current ? todayIso : s));
      wasToday.current = todayIso;
    }
  }, [todayIso]);
  const loadDue = useCallback(() => void window.nv.hub.due().then((d) => (setDue(d), setHubFailed(false)), () => setHubFailed(true)), []);
  useEffect(() => {
    const t = setTimeout(loadDue, due ? 150 : 0);
    return () => clearTimeout(t);
    // Read again when the notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, loadDue]);
  // Every half minute too: a reminder's time passing moves it to Overdue.
  useEffect(() => {
    const timer = setInterval(loadDue, 30_000);
    return () => clearInterval(timer);
  }, [loadDue]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      // The recent list rides along (5 Nov 2026, "your notes are yours"): a pack's record the person opened
      // still lists in Made and Changed; machine-only records stay out.
      void window.nv.hub.day(selected, recent).then((d) => live && (setHubDay(d), setHubFailed(false)), () => live && setHubFailed(true));
      if (selected !== todayIso) void window.nv.hub.dueOn(selected).then((d) => live && setDueOnDay(d), () => live && setHubFailed(true));
      else setDueOnDay(null);
      // A day just chosen at once; a change to the notes a moment later (a burst of saves is read once).
    }, hubDay && hubDay.date === selected ? 120 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, selected, todayIso]);
  const range = monthOpen ? monthGrid(selected) : weekOf(selected);
  const rangeFrom = range[0];
  const rangeTo = range[range.length - 1];
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void window.nv.hub.marks(rangeFrom, rangeTo).then((m) => live && setMarks(m), () => live && setHubFailed(true)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [revision, rangeFrom, rangeTo]);
  const openMonth = (open: boolean) => {
    setMonthOpen(open);
    keepMonthOpen(open);
  };
  // ← and → move a day, T comes back to today: while Today is the page in front and nobody is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typingIn(e.target)) return;
      const el = page.current;
      if (!el || !el.offsetParent) return;
      const active = document.activeElement;
      const nowhere = !active || active === document.body;
      // With the focus nowhere, only the first Today on screen answers (two Todays side by side don't both move).
      const first = [...document.querySelectorAll<HTMLElement>('.td-view')].find((v) => v.offsetParent) === el;
      if (!(nowhere ? first : el.contains(active))) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSelected((s) => addDays(s, e.key === 'ArrowLeft' ? -1 : 1));
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setSelected(isoOf(new Date()));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // By area of life (Wave 4; views/today/TodayAreas.tsx): every list follows the areas chosen, and the Library (templates
  // and the like) never shows unless chosen. Today's meetings and due today reach from kept-out folders too
  // (8 Nov 2026, item 2), through the areas-only keep.
  const keep = useTodayKeep();
  const keepArea = useTodayKeepArea();
  const due = useMemo(() => (dueRaw ? dueFor(dueRaw, keep, keepArea) : null), [dueRaw, keep, keepArea]);
  const hubDay = useMemo(() => (hubDayRaw ? dayFor(hubDayRaw, keep, keepArea) : null), [hubDayRaw, keep, keepArea]);
  const view = useMemo(() => {
    if (!data) return null;
    const withFiles = files.length ? withChangedFiles(data, files) : data;
    const shown = todayFor(withFiles, keep, keepArea);
    // "All clear across N projects": the live projects of the areas chosen (the one rule, so Today counts
    // what Projects, the Graph and the area cards count, never its own word list).
    const live = getState().notes.filter((n) => isProjectProps(n.props) && isLive(String(n.props?.status ?? '')) && keep(n.path)).length;
    return { ...shown, projects: Math.min(withFiles.projects, live) };
  }, [data, files, now, keep, keepArea]);

  /** Changes go one at a time, each on the file as the last one left it. */
  const queued = <T,>(job: () => Promise<T>) => {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => undefined);
    return run;
  };
  const step = (path: string, redo: boolean) =>
    queued(async () => {
      try {
        const r = await (redo ? window.nv.projects.redo(path) : window.nv.projects.undo(path));
        versions.current.set(r.view.path, r.view.version);
        toast(r.words, redo ? (r.undo ? { label: 'Undo', run: () => void step(r.view.path, false) } : undefined) : r.redo ? { label: 'Redo', run: () => void step(r.view.path, true) } : undefined);
      } catch (err) {
        showError(err);
      }
      await load();
    });
  const edit = (ref: TodayRef, change: ProjectEdit, words?: string) =>
    queued(async () => {
      if (!canEdit) return;
      try {
        const r = await window.nv.projects.edit(ref.project, change, versions.current.get(ref.project) ?? ref.version);
        versions.current.set(r.view.path, r.view.version);
        const said = words ?? r.words;
        toast(`${ref.projectName}: ${said.charAt(0).toLowerCase()}${said.slice(1)}`, { label: 'Undo', run: () => void step(r.view.path, false) });
      } catch (err) {
        showError(err);
      }
      await load();
    });
  // The kit's fields on the lines (words, owner and date change in place): the lines save through edit, never this.
  const todayEditor = useMemo(() => ({ path: '', canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [canEdit]);
  type LineItem = (DueItem | WaitingItem | UnscheduledItem) & { index?: number };
  const editTitle = (x: LineItem, v: string) => {
    // A project's name stays on its page: renaming it moves its files.
    if ('kind' in x && x.kind === 'project') return;
    if (x.index === undefined) return;
    const kind = 'kind' in x && x.kind === 'date' ? 'dates' : 'next';
    void edit(x, { kind: 'change', list: kind, index: x.index, item: { what: v } });
  };
  const editWho = (x: LineItem, v: string) => {
    if (x.index === undefined || ('kind' in x && x.kind !== 'step')) return;
    void edit(x, { kind: 'change', list: 'next', index: x.index, item: { who: v } });
  };
  const editWhen = (x: LineItem, iso: string) => {
    const kind = 'kind' in x ? x.kind : 'step';
    const styled = iso ? dayInStyle(iso, ['when' in x && x.when ? x.when : '']) : '';
    if (kind === 'project') void edit(x, { kind: 'set', field: 'due', value: styled || null });
    else if (x.index !== undefined) void edit(x, { kind: 'change', list: kind === 'date' ? 'dates' : 'next', index: x.index, item: { when: styled } });
  };
  const askWho = async (x: LineItem) => {
    if (x.index === undefined || ('kind' in x && x.kind !== 'step')) return;
    const who = 'who' in x ? x.who : undefined;
    const name = await prompt('Who does it?', { value: who ?? '', message: 'Their name is written on the step. Empty takes it off.', ok: 'Set who' });
    if (name === null || name === undefined) return;
    editWho(x, name.replace(/\s+/g, ' ').trim());
  };

  const open = (path: string, e?: React.MouseEvent | React.KeyboardEvent) => A.openPath(path, { where: e && (e.ctrlKey || e.metaKey) ? 'tab' : 'current' });
  /** A project opened at the line a Today line is about: the step, the key date, its due date, its risks, the update. */
  const openAt = (path: string, item: string | undefined, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (item) revealItem(path, item);
    open(path, e);
  };
  /** A Today line opens what it is in the peek (WS1 part B): the step, the key date or the project; Ctrl+click its page. */
  const peekLine = (x: DueItem | WaitingItem, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e && (e.ctrlKey || e.metaKey)) return openAt(x.project, itemOfLine(x), e);
    const kind = 'kind' in x ? x.kind : 'step';
    peek(kind === 'project' ? { type: 'project', path: x.project } : { type: kind === 'date' ? 'milestone' : 'action', path: x.project, title: x.what });
  };
  const itemOfLine = (x: DueItem | WaitingItem) => ('kind' in x && x.kind === 'project' ? 'due' : x.index === undefined ? undefined : 'kind' in x && x.kind === 'date' ? `dates:${x.index}` : `next:${x.index}`);
  const tick = (item: { id: string; index?: number } & TodayRef) => {
    // Read-only: never show done for a write that will not happen (fnv3 F4).
    if (item.index === undefined || !canEdit) return;
    setTicked((s) => new Set(s).add(item.id));
    void edit(item, { kind: 'change', list: 'next', index: item.index, item: { done: true } });
  };
  /** Moves a due date on: a step's, a key date's or the project's own, written the way the file writes dates. */
  const snooze = (item: DueItem | WaitingItem, days: number) => {
    const kind = 'kind' in item ? item.kind : 'step';
    const next = snoozeDate(item.when, days, new Date());
    if (!next) return;
    const words = `Moved “${item.what}” to ${next}.`;
    if (kind === 'project') void edit(item, { kind: 'set', field: 'due', value: next }, `Moved the due date to ${next}.`);
    else if (item.index !== undefined) void edit(item, { kind: 'change', list: kind === 'date' ? 'dates' : 'next', index: item.index, item: { when: next } }, words);
  };
  const snoozeItems = (item: DueItem | WaitingItem): MenuItem[] => {
    const day = snoozeDate(item.when, 1, now);
    const week = snoozeDate(item.when, 7, now);
    // Shown as people read dates ("Mon 19 Oct"); written the file's own way.
    const read = (d: string | null) => {
      const r = readDay(d ?? undefined, now);
      return r ? dayWords(r.offset, now) : undefined;
    };
    const was = readDay(item.when, now);
    // The one reader (5 Nov 2026, the plan): lateness needs no "Due" in front of it.
    const heading = !was ? (item.when ? `Due ${item.when}` : 'No date yet') : dayWords(was.offset, now);
    return [
      { heading },
      { label: 'A day later', icon: 'calendar', hint: read(day), disabled: !day || !canEdit, run: () => snooze(item, 1) },
      { label: 'A week later', icon: 'calendar', hint: read(week), disabled: !week || !canEdit, run: () => snooze(item, 7) },
    ];
  };
  const askAbout = (words: string) => draftInChat(words);
  const askStep = (x: DueItem | WaitingItem) => askAbout(`About “${x.what}” in ${x.projectName}${x.who ? `, with ${x.who}` : ''}${x.when ? `, due ${x.when}` : ''}: `);
  const askRisk = (x: AtRiskItem) => askAbout(`About ${x.projectName}${x.health ? `, which is ${x.health}` : ''}${x.risks[0] ? ` (${x.risks[0].level} risk: ${x.risks[0].what})` : ''}: `);
  const lineMenu = (e: React.MouseEvent, x: DueItem | WaitingItem) => {
    const isStep = !('kind' in x) || x.kind === 'step';
    openMenu(e, [
      ...(isStep ? [{ label: 'Mark done', icon: 'check' as IconName, disabled: !canEdit, run: () => tick(x) }] : []),
      ...snoozeItems(x).slice(1),
      ...(isStep ? [{ label: 'Who does it', icon: 'person' as IconName, hint: 'who' in x ? x.who : undefined, disabled: !canEdit || x.index === undefined, run: () => void askWho(x) }] : []),
      { separator: true },
      { label: 'Ask about this', icon: 'sparkle', run: () => askStep(x) },
      { label: `Open ${x.projectName}`, icon: 'forward', run: () => openAt(x.project, itemOfLine(x)) },
    ]);
  };

  // What Today shows (Settings › Appearance › Interface); a person who chose Home before it folded in keeps their choices.
  const hiddenNow = useMemo(() => todayHidden(prefsNow), [prefsNow]);
  const on = (id: Hideable) => shows({ hidden: hiddenNow }, id);
  const glance = useGlance();
  const date = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  const firstName = view?.me?.split(/\s+/)[0];
  const closeButton = home?.closable && (
    <button className="text-button home-close" onClick={() => setWorkspace((ws) => closeTab(ws, home.tab.id))}>
      Close this tab <kbd>{formatHotkey('Mod+W')}</kbd>
    </button>
  );

  // ── Lines ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const dueRow = (x: DueItem) => {
    const done = ticked.has(x.id);
    const editableTitle = x.kind !== 'project' && x.index !== undefined && canEdit;
    const pill = datePill(x.offset, now);
    // Who sits in its column (never trailing the words); when reads coral for late and today, quiet after.
    const whoEditable = x.kind === 'step' && x.index !== undefined && canEdit;
    const whenEditable = canEdit && 'when' in x && x.when && (x.kind === 'project' || x.index !== undefined);
    return (
      <Row key={x.id} className={`td-due tkrow${done ? ' is-done' : ''}`} label={`${x.what}, ${x.projectName}, ${dayWords(x.offset, now)}`} onOpen={(e) => peekLine(x, e)} onMenu={(e) => lineMenu(e, x)}>
        <EditorContext.Provider value={todayEditor}>
          {x.kind === 'step' ? (
            <button
              className={`check${done ? ' done' : ''}`}
              role="checkbox"
              aria-checked={done}
              aria-label={`Mark “${x.what}” done`}
              title="Mark done"
              disabled={!canEdit || done}
              onClick={(e) => {
                e.stopPropagation();
                tick(x);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {done ? <Icon name="check" size={12} /> : null}
            </button>
          ) : (
            <span className={`td-glyph${x.kind === 'project' ? ' flag' : ''}`} title={x.kind === 'project' ? 'The project’s due date' : 'A key date'}>
              <Icon name={x.kind === 'project' ? 'layers' : 'calendar'} size={13} />
            </span>
          )}
          <span className="td-row-main">
            <span className="td-row-what" onClick={editableTitle ? stop : undefined}>
              {editableTitle ? (
                <Inline value={x.what} label="words" required onSave={(v) => editTitle(x, v)}>
                  <span className="td-text" title={x.what}>{x.what}</span>
                </Inline>
              ) : (
                <span className="td-text" title={x.what}>{x.what}</span>
              )}
            </span>
            <span className="td-row-sub">
              {/* The project under a task's words opens the project it names (t239: a click opens the
                  document, never a side panel): the same opening the Tasks page gives its project names,
                  so every task surface opens uniformly. The row itself still opens the task (stopped
                  here); the arrow still opens the project's page at the line. */}
              <button type="button" className={`td-project tone-${x.tone}`} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={(e) => (e.stopPropagation(), peek({ type: 'project', path: x.project }, { title: x.projectName, type: 'project' }))} onKeyDown={(e) => e.stopPropagation()} title={`Open ${x.projectName}`}>
                <span className="td-dot" />
                <span className="td-text">{x.projectName}</span>
              </button>
              {/* One job, one row (t249): a step written in a meeting too names it here, as Tasks does. */}
              {x.kind === 'step' && (x.sources ?? []).some((s) => s.kind !== 'project') && (
                <span className="td-faint" title={x.sources!.filter((s) => s.kind !== 'project').map((s) => s.label).join(' · ')}>{x.sources!.filter((s) => s.kind !== 'project').map((s) => s.label).join(' · ')}</span>
              )}
              {x.kind === 'date' && <span className="td-faint">Key date{x.status ? ` · ${x.status}` : ''}</span>}
            </span>
          </span>
          <span className="tkrow-who">
            {whoEditable ? (
              <span onClick={stop}>
                <Inline value={x.who ?? ''} label="owner" compact onSave={(v) => editWho(x, v)}>
                  <WhoInner name={x.kind === 'step' ? visibleWho(x.who, view?.me) || undefined : undefined} />
                </Inline>
              </span>
            ) : (
              <WhoInner name={x.kind === 'step' ? visibleWho(x.who, view?.me) || undefined : undefined} />
            )}
          </span>
          <span className="tkrow-when">
            {whenEditable ? (
              <span onClick={stop}>
                <InlineDate value={x.when} iso label="date" onSave={(v) => editWhen(x, v)}>
                  <WhenInner words={pill.words} tone={whenTone(x.offset)} />
                </InlineDate>
              </span>
            ) : (
              <WhenInner words={pill.words} tone={whenTone(x.offset)} />
            )}
          </span>
          <span className="td-actions">
            <RowButton icon="calendar" title="Move the date" haspopup onClick={(e) => openMenu(e.currentTarget, snoozeItems(x))} />
            <RowButton icon="sparkle" title="Ask about this" onClick={() => askStep(x)} />
            <RowButton icon="forward" title={`Open ${x.projectName}`} onClick={() => openAt(x.project, itemOfLine(x))} />
          </span>
        </EditorContext.Provider>
      </Row>
    );
  };
  const waitingRow = (x: WaitingItem) => {
    const done = ticked.has(x.id);
    const pill = datePill(x.offset, now);
    return (
      <Row key={x.id} className={`td-wait tkrow${done ? ' is-done' : ''}`} label={`${x.who}: ${x.what}, ${x.projectName}`} onOpen={(e) => peekLine(x, e)} onMenu={(e) => lineMenu(e, x)}>
        <EditorContext.Provider value={todayEditor}>
          {/* No box of its own (Mark done hovers): the empty track keeps who and when on their x. */}
          <span aria-hidden="true" />
          <span className="td-row-main">
            <span className="td-row-what" onClick={canEdit ? stop : undefined}>
              {canEdit ? (
                <Inline value={x.what} label="words" required onSave={(v) => editTitle(x, v)}>
                  <span className="td-text" title={x.what}>{x.what}</span>
                </Inline>
              ) : (
                <span className="td-text" title={x.what}>{x.what}</span>
              )}
            </span>
            <span className="td-row-sub">
              {/* The waiting line's project opens too (p17-connected, 4 Nov 2026): the same
                  peek as a due line's, so waiting and due read and open as one. */}
              <button type="button" className="td-project" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={(e) => (e.stopPropagation(), peek({ type: 'project', path: x.project }, { title: x.projectName, type: 'project' }))} onKeyDown={(e) => e.stopPropagation()} title={`Open ${x.projectName}`}><span className="td-text">{x.projectName}</span></button>
              {/* One job, one row (t249): a step written elsewhere too names it here, as due lines do. */}
              {(x.sources ?? []).some((s) => s.kind !== 'project') && (
                <span className="td-faint" title={x.sources!.filter((s) => s.kind !== 'project').map((s) => s.label).join(' · ')}>{x.sources!.filter((s) => s.kind !== 'project').map((s) => s.label).join(' · ')}</span>
              )}
            </span>
          </span>
          <span className="tkrow-who">
            {canEdit ? (
              <span onClick={stop}>
                <Inline value={x.who} label="owner" compact onSave={(v) => editWho(x, v)}>
                  <WhoInner name={x.who} />
                </Inline>
              </span>
            ) : (
              <WhoInner name={x.who} />
            )}
          </span>
          <span className="tkrow-when">
            {canEdit && x.when ? (
              <span onClick={stop}>
                <InlineDate value={x.when} iso label="date" onSave={(v) => editWhen(x, v)}>
                  <WhenInner words={pill.words} tone={whenTone(x.offset)} />
                </InlineDate>
              </span>
            ) : (
              <WhenInner words={pill.words} tone={whenTone(x.offset)} />
            )}
          </span>
          <span className="td-actions">
            <RowButton icon="check" title="Mark done" disabled={!canEdit || done} onClick={() => tick(x)} />
            {x.when && <RowButton icon="calendar" title="Move the date" haspopup onClick={(e) => openMenu(e.currentTarget, snoozeItems(x))} />}
            <RowButton icon="sparkle" title="Ask about this" onClick={() => askStep(x)} />
            <RowButton icon="forward" title={`Open ${x.projectName}`} onClick={() => openAt(x.project, itemOfLine(x))} />
          </span>
        </EditorContext.Provider>
      </Row>
    );
  };
  const questionRow = (q: { path: string; meeting: string; projectName?: string; what: string; askedBy?: string; owner?: string; line: number; raw: string }) => (
    <Row key={`${q.path}:${q.line}`} className="td-due" label={`${q.what}, waiting on an answer`} onOpen={() => A.openPath(q.path)}>
      <span className="td-glyph" title="Waiting on an answer">
        <Icon name="help" size={13} />
      </span>
      <span className="td-row-main">
        <span className="td-row-what">
          <span className="td-text" title={q.what}>{q.what}</span>
        </span>
        <span className="td-row-sub">
          {q.projectName && (
            <span className="td-project" title={q.projectName}><span className="td-text">{q.projectName}</span></span>
          )}
          <span className="td-faint">{[q.askedBy ? `asked by ${q.askedBy}` : '', q.owner ? `for ${q.owner}` : '', `in ${q.meeting}`].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
      <span className="td-actions">
        {canEdit && <RowButton icon="pencil" title="Answer it" onClick={() => void answerQuestion(q)} />}
        <RowButton icon="forward" title={`Open ${q.meeting}`} onClick={() => A.openPath(q.path)} />
      </span>
    </Row>
  );
  const riskRow = (x: AtRiskItem) => {
    const top = x.risks[0];
    return (
      <Row key={x.id} className="td-risk" label={`${x.projectName}, ${x.health ?? 'at risk'}`} onOpen={(e) => openAt(x.project, x.risks.length ? 'risks' : undefined, e)}>
        <span className="td-row-main">
          <span className="td-row-what strong">
            <span className="td-text">{x.projectName}</span>
            <StatusPill words={x.risks.length && (x.tone === 'ok' || x.tone === 'none') ? `${cap(x.risks[0].level)} risk` : x.tone === 'bad' ? 'Off track' : x.tone === 'warn' ? 'At risk' : x.tone === 'ok' ? 'On track' : 'Active'} size="small" />
          </span>
          <span className="td-row-sub">
            {top ? (
              <span className="td-risk-line">
                <b className={`td-level ${top.level}`}>{cap(top.level)}</b>
                <span>{splitRiskTail(top.what).what}</span>
                {x.risks.length > 1 && <span className="td-faint"> +{x.risks.length - 1} more</span>}
              </span>
            ) : x.next ? (
              <span className="td-risk-line">
                <Icon name="forward" size={11} />
                <span>{x.next}</span>
              </span>
            ) : (
              <span className="td-faint">Nothing next written down</span>
            )}
          </span>
        </span>
        <span className="td-risk-meta">
          {typeof x.progress === 'number' && (
            <span className="td-mini" title={`About ${x.progress}% done`}>
              <span className={`tone-${x.tone}`} style={{ width: `${Math.max(3, x.progress)}%` }} />
            </span>
          )}
          {x.dueOffset !== null && (() => { const pill = datePill(x.dueOffset, now); return <span className={`td-when small tone-${pill.tone === 'bad' ? 'bad' : 'none'}`}>{pill.words}</span>; })()}
        </span>
        <span className="td-actions">
          <RowButton icon="sparkle" title="Ask about this" onClick={() => askRisk(x)} />
          <RowButton icon="forward" title={`Open ${x.projectName}`} onClick={() => openAt(x.project, x.risks.length ? 'risks' : undefined)} />
        </span>
      </Row>
    );
  };
  const changeLine = (g: ChangeGroup, l: ChangeLine) => {
    const icon: IconName = l.kind === 'update' ? 'pencil' : l.kind === 'activity' ? 'spark' : l.kind === 'note' ? 'file' : fileIcon(l.what);
    const go = (e: React.MouseEvent | React.KeyboardEvent) => {
      if (l.kind === 'file' && l.rel) A.openFolderFile(g.project, l.rel, e.ctrlKey || e.metaKey ? 'tab' : 'current');
      else if (l.path) open(l.path, e);
      else openAt(g.project, l.kind === 'update' && l.index !== undefined ? `updates:${l.index}` : undefined, e);
    };
    return (
      <Row key={l.id} className={`td-change-line kind-${l.kind}`} label={l.what} onOpen={go}>
        <span className={`td-change-icon kind-${l.kind}`}>
          {l.kind === 'file' ? <span className="td-ext">{(l.ext || ext(l.what)).slice(0, 4).toUpperCase() || 'FILE'}</span> : <Icon name={icon} size={12} />}
        </span>
        <span className="td-row-main">
          <span className="td-row-what">
            <span className="td-text" title={l.what}>{l.what}</span>
          </span>
          {(l.from || l.status || l.kind === 'activity') && (
            <span className="td-row-sub">
              {l.kind === 'activity' && <span>{activityWords(l.status)}</span>}
              {l.from && <span className="td-faint">From {l.from}</span>}
            </span>
          )}
        </span>
        <span className="td-time">{whenChanged(l.at, now, l.kind === 'update')}</span>
      </Row>
    );
  };

  // ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Open questions, asked of others or of you (step 1's Questions; step 2 waits on an answer here): asked in a
  // meeting, open until answered, longest waiting first.
  const { data: meetingsView } = useWork<MeetingsView>('meetings');
  const openQuestions = useMemo(
    () =>
      (meetingsView?.meetings ?? [])
        .flatMap((m) =>
          m.questions
            .filter((q) => !q.answered)
            .map((q) => ({ path: m.path, meeting: m.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, '') || m.title, ...(m.project ? { projectName: m.project } : {}), date: m.date, line: q.line, raw: q.raw, what: q.what, ...(q.askedBy ? { askedBy: q.askedBy } : {}), ...(q.owner ? { owner: q.owner } : {}) })),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [meetingsView],
  );
  const answerQuestion = async (q: { path: string; line: number; raw: string; what: string }) => {
    const said = await prompt('Answer it', { message: q.what, placeholder: 'The answer, in plain words', ok: 'Answer' });
    if (!said?.trim()) return;
    await workDid(workCall<string>('meetings', 'answer-question', q.path, q.line, q.raw, said.trim()));
  };
  const counts = view?.counts;
  // One sentence that says what the day is (t76, 9 Nov 2026: the sentence re-derived ownership from
  // words while the list read the built lists, so with no single owner it said "Nothing needs you
  // today" above late rows): the project steps and own note lines the list below shows, through the
  // one rule, never bills beside them (a bill is said in its own card, not the day's shape).
  const ownNoteDated = useMemo(() => {
    if (!due || !view) return [] as DueEntry[];
    return [...due.overdue, ...due.today, ...due.week, ...(due.later ?? []), ...(due.stale ?? [])].filter((e) => isOwnText(dueOwnerText(e), view.me, now, due.known));
  }, [due, view, now]);
  const projectSteps = useMemo(() => (!view ? [] as DueItem[] : [...view.due.overdue, ...view.due.today, ...view.due.soon, ...view.due.later, ...view.due.stale].filter((x) => x.kind === 'step')), [view]);
  // Dates for the day's counts and groups (round 3: they show in the date list; t249: they count too — Late
  // draws a late project due, so the greeting and the badge count it, never 8 above a Late 9).
  const allDates = useMemo(() => (!view ? [] as DueItem[] : [...view.due.overdue, ...view.due.today, ...view.due.soon, ...view.due.later, ...view.due.stale].filter((x) => x.kind !== 'step')), [view]);
  const oneCount = useMemo(() => {
    const base = dayShapeCounts(projectSteps, ownNoteDated.map((e) => e.day), now);
    const dates = dayShapeCounts(allDates, [], now);
    return { late: base.late + dates.late, today: base.today + dates.today, week: base.week + dates.week };
  }, [projectSteps, ownNoteDated, allDates, now]);
  const billsHead = billsOn && finance ? billsHeadCounts(finance.bills, finance.remindDays, finance.today) : { late: 0, today: 0, week: 0 };
  // Other people's lines from the notes (4 Nov 2026, p12-today-focus round 3: own lines only in the work; theirs sit
  // under Waiting, counted with the steps there. Round 4: their later lines and their lines with no day too, now the
  // separate Due list is gone and nothing of theirs may mix into the one list).
  const dueOthers = useMemo(() => {
    if (!due || !view) return { overdue: [] as DueEntry[], today: [] as DueEntry[], week: [] as DueEntry[], later: [] as DueEntry[], undated: [] as { key: string; path: string; title: string; line: number; text: string; words: string; due: string | null }[] };
    const theirs = (list: DueEntry[]) => list.filter((e) => !isOwnText(dueOwnerText(e), view.me, now, due.known));
    return { overdue: theirs(due.overdue), today: theirs(due.today), week: theirs(due.week), later: theirs(due.later ?? []), undated: due.undated.filter((t) => !isOwnText(t.words, view.me, now, due.known)) };
  }, [due, view, now]);
  const dueOthersCount = dueOthers.overdue.length + dueOthers.today.length + dueOthers.week.length + dueOthers.later.length + dueOthers.undated.length;
  const waitingCount = (view?.waiting.length ?? 0) + dueOthersCount;
  // Their stale lines sit in the one quiet group with the person's own (5 Nov 2026, u3 moving-in: the stale
  // group is old lines to look at, whoever's — never in Waiting's count, which answers what is fresh). The one
  // count never counts stale, so stale keeps the welcome and All clear away on its own here.
  const dueStaleTheirs = useMemo(() => (!due || !view ? [] as DueEntry[] : (due.stale ?? []).filter((e) => !isOwnText(dueOwnerText(e), view.me, now, due.known))), [due, view, now]);
  const dueStaleOwn = useMemo(() => (!due || !view ? 0 : (due.stale ?? []).filter((e) => isOwnText(dueOwnerText(e), view.me, now, due.known)).length), [due, view, now]);
  // The notes' own later and undated lines keep the welcome away too (round 4: they list in the fold's Later and No
  // date now, so the welcome must not show above them).
  const dueLaterOwn = useMemo(() => (!due || !view ? 0 : (due.later ?? []).filter((e) => isOwnText(dueOwnerText(e), view.me, now, due.known)).length), [due, view, now]);
  const undatedOwn = useMemo(() => (!due || !view ? [] : due.undated.filter((t) => isOwnText(t.words, view.me, now, due.known))), [due, view, now]);
  const welcomeOn = !!view && view.nothingOnYou && oneCount.late === 0 && oneCount.today === 0 && oneCount.week === 0 && dueLaterOwn === 0 && undatedOwn.length === 0 && dueOthersCount === 0 && dueStaleOwn === 0 && dueStaleTheirs.length === 0 && openQuestions.length === 0 && !(billsOn && finance ? billsKeepWelcome(finance.bills, finance.remindDays, finance.today) : false);
  const noProjects = !!view && !!data && data.projects === 0;
  const allClear = !!view && !noProjects && view.clear && oneCount.late === 0 && oneCount.today === 0 && dueOthersCount === 0 && dueStaleOwn === 0 && dueStaleTheirs.length === 0 && openQuestions.length === 0 && billsHead.late === 0 && billsHead.today === 0;
  // The day's shape in one sentence (5 Nov 2026): late, today and meetings; waiting folds below with its chase.
  // With no projects it reads too (t163, 9 Nov 2026: Today never says nothing while late or
  // due-today tasks sit anywhere in the vault) — unless the welcome says the empty vault instead.
  const meetingsCount = hubDay?.meetings.length ?? view?.meetings.length ?? 0;
  const sentence = view && (!noProjects || !welcomeOn) ? daySentence({ late: oneCount.late, today: oneCount.today, meetings: meetingsCount, waiting: waitingCount }) : '';
  // One ranked list (round 4): the person's own project steps and their own dated note lines through the same rank.
  // The five are its top; the fold below unfolds the rest of that same list. Dates (key dates, project dues) never
  // rank — they list in the fold's groups as dates, as round 3 holds. Never gated on projects (t163, t11's rule:
  // only project lines stay gated): a vault of loose notes ranks its dated lines with no projects at all.
  const ranked = useMemo(() => (view ? rankAllFor(projectSteps, ownNoteDated, now) : [] as TopWork[]), [view, projectSteps, ownNoteDated, now]);
  // Late, Next and the rest, split once (step 2): each job shows once, Late first, Next next.
  const split = useMemo(() => splitTodayTop(ranked, allDates, NEXT_SHOWN), [ranked, allDates]);
  const late = split.late;
  const next: TopWork[] = split.next;
  const restRanked: TopWork[] = split.rest;
  const restDates = split.restDates;
  // The fold's groups: the rest of the one list, grouped Today, This week, Later, From a while back, No date —
  // the same heads Tasks uses (5 Nov 2026, rest-quieten: Overdue/Next 7 days renamed the same sets). Late reads
  // as its own section above, never here. Stale never leads: its group renders last among the dated ones
  // (5 Nov 2026, u3 moving-in).
  const restGroups = useMemo(() => {
    const byOffset = (w: TopWork) => (w.kind === 'step' ? w.step.offset : w.offset);
    const fresh = restRanked.filter((w) => !isStaleOffset(byOffset(w)));
    const freshDates = restDates.filter((x) => !isStaleOffset(x.offset));
    const todayG = [...fresh.filter((w) => byOffset(w) === 0), ...freshDates.filter((x) => x.offset === 0)];
    const week = [...fresh.filter((w) => byOffset(w) >= 1 && byOffset(w) <= 7), ...freshDates.filter((x) => x.offset >= 1 && x.offset <= 7)];
    const later = [...fresh.filter((w) => byOffset(w) > 7), ...freshDates.filter((x) => x.offset > 7)];
    const stale = [...restRanked.filter((w) => isStaleOffset(byOffset(w))), ...restDates.filter((x) => isStaleOffset(x.offset))];
    return { today: todayG, week, later, stale };
  }, [restRanked, restDates]);
  const unscheduled: UnscheduledItem[] = view ? view.unscheduled : [];
  /** A rest-fold row's time, where it has one (5 Nov 2026, Tasks' timed split retired here): a note task's
   *  written time, a reminder's moment when one was given; project steps and dates carry days, not times. */
  const rowTime = (w: TopWork | DueItem): string | null => {
    const entry = (w as { entry?: DueEntry }).entry;
    if (!entry) return null;
    if (entry.kind === 'task') return readTaskDue(entry.item.text, now).time;
    if (!entry.item.timeGiven) return null;
    const d = new Date(entry.item.due);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  /** The day's add row (5 Nov 2026, Tasks' day plan retired here): a task for today, written to today's note —
   *  the same words and the same write as the row it replaces. */
  const addForToday = async () => {
    const words = await prompt('Add a task for today', { message: 'It is written in today’s note, due today.', ok: 'Add it' });
    if (!words?.trim()) return;
    const dayNote = hubDay?.daily.path;
    if (!dayNote) return void window.nv.capture.show().catch(showError);
    try {
      // A read failure on a note that is there stops the write (W5-1): never rebuilt from empty.
      const known = getState().byPath.has(dayNote) || getState().files.some((f) => f.rel === dayNote);
      let text = '';
      try {
        await docs.flush(dayNote);
        text = await window.nv.notes.read(dayNote);
      } catch (e) {
        if (known) throw e;
        text = '';
      }
      const line = `- [ ] ${words.trim()} 📅 ${todayIso}`;
      const out = text.length && !text.endsWith('\n') ? `${text}\n${line}\n` : `${text}${text.length ? '' : `# ${todayIso}\n\n`}${line}\n`;
      await window.nv.notes.write(dayNote, out);
      toast('Added to today’s note.');
      loadDue();
    } catch (err) {
      showError(err);
    }
  };
  const dueCount = restRanked.length + restDates.length + unscheduled.length + undatedOwn.length + dueStaleTheirs.length;
  // The morning brief as the Today card shows it (4 Nov 2026, p12-today-focus round 3: no task rows — tasks are Next
  // for you's job — and no meeting rows — the day below shows them). And only what the rest of the page does not
  // already show (4 Nov 2026, p15-today-rest: its project lines repeated Projects at risk row for row — the same
  // projects with the same next steps — and its cards line repeated Cards to review). A risk line drops only for a
  // project the risk section lists (a project left out by the areas chosen, or a hidden section, keeps its line;
  // a quiet project's line is nowhere else, so it always stays), and the cards line only while Cards to review is
  // on (it shows on exactly the decks the line counts). Every dropped row counts in `more`, as the card's own
  // filter counts its own: the lists below hold them.
  const todayBrief = useMemo(() => {
    if (!brief) return null;
    const card = todayCardBrief(brief);
    const riskPaths = on('today:risk') && view ? new Set(view.atRisk.map((x) => x.project)) : new Set<string>();
    const cardsListed = on('today:tasks');
    const openOf = (i: BriefItem) => {
      const a = i.actions.find((x) => x.kind === 'open');
      return a && a.kind === 'open' ? a.path : undefined;
    };
    const items = card.items.filter((i) => {
      if (i.kind === 'project' && riskPaths.has(openOf(i) ?? '')) return false;
      if (i.kind === 'cards' && cardsListed) return false;
      return true;
    });
    return { ...card, items, more: card.more + (card.items.length - items.length) };
    // `on` reads the hidden switches (hiddenNow above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, view, hiddenNow]);
  // What Changed since yesterday already names (its note lines' paths): Today in your notes skips those rows while
  // that card shows them, so no note lists twice on one screen (4 Nov 2026, p15-today-rest). Only the lines' paths —
  // a project file itself is named nowhere else (the changed card skips bare project files), so it stays — and only
  // while the card shows (a hidden card keeps every row where it was).
  const changedPaths = useMemo(() => {
    if (!view || !on('today:changed')) return undefined;
    const s = new Set<string>();
    for (const g of view.changed) for (const l of g.lines) if (l.path) s.add(l.path);
    return s.size ? s : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hiddenNow]);
  // A note's line ticks through the note's own write (round 4: the one list ticks each row where it lives — a step
  // through its project file, a note's line through the hub).
  const noteTicks = useTicks(loadDue);
  const noteGroup = (offset: number): 'overdue' | 'today' | 'week' | 'stale' => (isStaleOffset(offset) ? 'stale' : offset < 0 ? 'overdue' : offset === 0 ? 'today' : 'week');
  // One row of the one list (round 4): a step draws as the project rows do, a note's line as Due drew it — the same
  // row either way (tick, date, buttons), ticking the note it lives in.
  const workRow = (w: TopWork | DueItem): ReactNode => {
    if ((w as { entry?: DueEntry }).entry !== undefined) {
      const n = w as { kind: 'note'; entry: DueEntry; offset: number };
      return <DueRow key={`note:${n.entry.key}`} entry={n.entry} group={noteGroup(n.offset)} now={now.getTime()} ticks={noteTicks} me={view?.me} />;
    }
    if ((w as { step?: DueItem }).step !== undefined) return dueRow((w as { kind: 'step'; step: DueItem }).step);
    return dueRow(w as DueItem);
  };
  /** The Today group's rows (5 Nov 2026, Tasks' timed split retired here): timed rows first under their own
   *  quiet head, then any-time — the shared day-plan split, so the fold and the retired day plan can never
   *  order a timed row two ways. No times: no heads. */
  const todayGroupRows = (items: (TopWork | DueItem)[]): ReactNode => {
    const split = splitDayPlan(items.map((w) => ({ w, time: rowTime(w), done: false })));
    if (!split.timed.length) return <More items={items} render={workRow} />;
    return (
      <>
        <div className="glabel" style={{ margin: '2px 0 6px' }}>Timed</div>
        <More items={split.timed.map((x) => x.w)} render={workRow} />
        <div className="glabel" style={{ margin: '10px 0 6px' }}>Any time</div>
        <More items={split.anytime.map((x) => x.w)} render={workRow} />
      </>
    );
  };
  const areaPick = usePick('today');
  const areasNow = useAreas();
  const pickedNames = areasNow && areaPick !== 'all' ? areaPick.map((id) => areasNow.areas.find((a) => a.id === id)?.name).filter(Boolean).join(' and ') : '';
  // The weekly review: offered up front from the review day (Settings › Today and reviews) until it's done or put off
  // for the week; any other time, a quiet line under today's note.
  const reviewDay = DAYS[prefsNow.weeklyReviewDay];
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const isReviewDay = now.getDay() === prefsNow.weeklyReviewDay;
  const reviewUp = !!view && !noProjects && !!standing && standing.all > 0 && (isReviewDue(standing, now) || (prefsNow.weeklyReview && isReviewDay && Math.max(standing.last ?? 0, standing.putOff ?? 0) < startOfDay));
  // Seen here: the corner reminder (components/ReviewNotice.tsx) doesn't repeat it on the next page today.
  useEffect(() => {
    if (reviewUp) noteReviewSeen();
  }, [reviewUp]);
  const reviewProjects = standing?.projects ?? 0;
  // The weekly review as one row of the list when it is due (5 Nov 2026, no review cards unless due
  // and they matter): it opens the review, put off it says so once. Otherwise nothing.
  const reviewQuiet = !!view && !noProjects && !!standing?.all && (reviewUp || (standing.putOff ?? 0) > (standing.last ?? 0)) && (
    <button type="button" className="td-quiet-line" data-look-row onClick={() => A.openWeeklyReview()} title="Open the weekly review">
      <Icon name="review" size={13} />
      <span>{reviewUp ? (isReviewDay ? `It’s ${reviewDay}: time for the weekly review (${reviewProjects} ${reviewProjects === 1 ? 'project' : 'projects'})` : 'This week’s review is waiting') : 'Weekly review put off this week'}</span>
      <Icon name="forward" size={12} />
    </button>
  );
  // Dormant projects that still hold open work, as one row of the list (Nov 2026, b6 break job: finished and
  // on-hold projects count nowhere, but a task a person needed must still reach them). One opens straight into
  // it; several choose from a menu, naming every project even past the line's "and N more".
  const dormantList: DormantOpen[] = view?.dormantOpen ?? [];
  const dormantQuiet = !!view && !noProjects && dormantList.length > 0 && (
    <button
      type="button"
      className="td-quiet-line"
      data-look-row
      onClick={(e) => {
        if (dormantList.length === 1) return A.openPath(dormantList[0].project);
        openMenu(e.currentTarget, dormantList.map((d) => ({ label: `${d.projectName} · ${dormantOpenCountWords(d)}`, run: () => A.openPath(d.project) })));
      }}
      title={dormantList.length === 1 ? 'Open the project' : 'Choose the project to open'}
    >
      <Icon name="history" size={13} />
      <span>{dormantOpenWords(dormantList)}</span>
      <Icon name="forward" size={12} />
    </button>
  );

  // What's inside the one fold, each known once (5 Nov 2026, the walk: the brief, the risks and the
  // dates gone by stood open below a CLOSED line — a fault, not a remembered fold: they rendered outside it, so
  // no remembered choice could fold them). The sections read these same flags, so a person's own open-or-shut
  // stays remembered (ELSE_KEY below); the line counts the list's kinds instead of naming the sections (8 Nov 2026,
  // calm list: one number per kind). The welcome, the all-clear and Due for you stay out: states and the no-Next
  // fallback, not list content. The vault rows, the packs' due, waiting and upkeep rows, the projects waiting,
  // the nags and the turned-on cards list first, as rows; the work sections, the live hub (changes, agents,
  // decks) and the set-up nudge follow, as they were.
  const restAny = restGroups.today.length + restGroups.week.length + restGroups.later.length + unscheduled.length + undatedOwn.length > 0;
  const foldWaiting = on('today:waiting') && waitingCount > 0;
  const foldBrief = isToday && on('today:brief') && !!todayBrief && todayBrief.items.length > 0;
  const foldRisk = on('today:risk') && (view?.atRisk.length ?? 0) > 0;
  const foldPassed = on('today:due') && !!view && view.due.passed.length > 0;
  const foldActivity = on('today:activity') && !!hubDay && hubDay.date === selected;
  const foldGlance = on('today:glance') && !!glance && glance.length > 0;
  const foldChanged = on('today:changed');
  const foldDocs = on('today:changed') && (view?.docs ?? []).length > 0;
  const foldNote = !!hubDay && hubDay.date === selected && on('today:note');
  const foldWeek = on('today:week');
  const elseParts: string[] = [];
  if (foldWaiting) elseParts.push('waiting on others');
  if (foldBrief) elseParts.push('the morning brief');
  if (foldRisk) elseParts.push('projects at risk');
  if (foldPassed) elseParts.push('dates that went by');
  if (foldActivity) elseParts.push('today in your notes');
  if (foldGlance) elseParts.push('at a glance');
  if (foldChanged) elseParts.push('changed since yesterday');
  if (foldDocs) elseParts.push('docs updated');
  if (foldNote) elseParts.push("the day's note");
  if (foldWeek) elseParts.push('the week');

  // The rest of the one list (layout round 2): Today in full, This week, Later and From a while back capped at
  // five, and the undated never as rows: one count row into Tasks showing just those (the vault held 108).
  const undatedCount = unscheduled.length + undatedOwn.length;
  const restGroupsBlock = (
    <>
      {restGroups.today.length > 0 && (
        <div className="td-group today">
          <h3>
            Today <span>{restGroups.today.length}</span>
          </h3>
          {todayGroupRows(restGroups.today)}
        </div>
      )}
      {restGroups.week.length > 0 && (
        <div className="td-group soon">
          <h3>
            This week <span>{restGroups.week.length}</span>
          </h3>
          <More items={restGroups.week} render={workRow} limit={tall ? 10 : 5} />
        </div>
      )}
      {restGroups.later.length > 0 && (
        <div className="td-group later">
          <h3>
            Later <span>{restGroups.later.length}</span>
          </h3>
          <More items={restGroups.later} render={workRow} limit={tall ? 6 : 3} />
        </div>
      )}
      {(restGroups.stale.length > 0 || dueStaleTheirs.length > 0) && (
        <div className="td-group stale">
          <h3>
            From a while back <span>{restGroups.stale.length + dueStaleTheirs.length}</span>
          </h3>
          <More items={restGroups.stale} render={workRow} limit={tall ? 6 : 3} />
          {dueStaleTheirs.slice(0, Math.max(0, 3 - restGroups.stale.length)).map((e) => (
            <DueRow key={e.key} entry={e} group="stale" now={now.getTime()} ticks={noteTicks} me={view?.me} />
          ))}
        </div>
      )}
      {undatedCount > 0 && (
        <button type="button" className="td-count-row th-undated" data-section="undated" onClick={() => A.openTasks('current', { when: 'none' })} title="Open Tasks showing the tasks with no date">
          <Icon name="task" size={13} />
          <span>
            <b>{undatedCount}</b> {undatedCount === 1 ? 'task' : 'tasks'} with no date
          </span>
          <span className="td-count-row-go">
            Review <Icon name="chevron" size={12} />
          </span>
        </button>
      )}
      {isToday && canEdit && (
        <div className="trow td-add-row" role="button" tabIndex={0} aria-label="Add a task for today" onClick={() => void addForToday()} onKeyDown={(e) => e.key === 'Enter' && void addForToday()}>
          <span className="check w2a-add" aria-hidden="true">+</span>
          <span className="w2a-addrow">Add a task for today…</span>
        </div>
      )}
    </>
  );
  // More for today: the day's other sections, each its own block, balanced across the two columns when open.
  const moreForToday: BalanceItem[] = [];
  if (view && foldWaiting)
    moreForToday.push({
      key: 'waiting',
      node: (
        <Section id="waiting" title="Waiting on others" count={waitingCount} hint="Longest waiting first" className="tklist">
          {groupWaiting(view.waiting).slice(0, 4).map((g) => (
            <div key={g.who} className="td-wait-group">
              <div className="td-wait-head">
                <OwnerChip name={g.who} size="small" />
                <span className="td-faint">{g.items.length} {g.items.length === 1 ? 'item' : 'items'}{g.oldest !== null && g.oldest < 0 ? ` · oldest ${-g.oldest} ${g.oldest === -1 ? 'day' : 'days'} late` : ''}</span>
                <button type="button" className="td-chase" title={`Draft a message to ${g.who} (nothing is sent)`} onClick={() => askAbout(chaseWords(g))}>
                  <Icon name="send" size={11} /> Chase
                </button>
              </div>
              {g.items.slice(0, 2).map((x) => waitingRow(x))}
            </div>
          ))}
          {waitingCount > 8 && (
            <button type="button" className="td-count-row" onClick={() => A.openTasks()} title="Every task, with who it waits on">
              <Icon name="people" size={13} />
              <span>
                <b>{waitingCount}</b> waiting on others in all
              </span>
              <span className="td-count-row-go">
                All tasks <Icon name="chevron" size={12} />
              </span>
            </button>
          )}
          {/* Other people's lines in your notes: counted here, listed in Tasks (layout round 2: never 80 rows on Today). */}
          {dueOthersCount > 0 && (
            <button type="button" className="td-count-row" onClick={() => A.openTasks()} title="Every task, with who it waits on">
              <Icon name="notes" size={13} />
              <span>
                <b>{dueOthersCount}</b> more for others in your notes
              </span>
              <span className="td-count-row-go">
                All tasks <Icon name="chevron" size={12} />
              </span>
            </button>
          )}
        </Section>
      ),
    });
  if (foldBrief && todayBrief) moreForToday.push({ key: 'brief', node: <div data-section="brief" className="td-brief"><BriefCardHome brief={todayBrief} onHide={() => undefined} reload={reloadBrief} glass /></div> });
  if (view && foldRisk) moreForToday.push({ key: 'risk', node: <Section id="risk" title="Projects at risk" count={view.atRisk.length}><More items={view.atRisk} render={riskRow} limit={5} /></Section> });
  if (view && foldPassed)
    moreForToday.push({
      key: 'passed',
      node: (
        <details className="td-group passed td-fold td-passed-end">
          <summary>
            Dates that went by: did they happen? <span>{view.due.passed.length}</span>
          </summary>
          <More items={view.due.passed} render={dueRow} limit={5} />
        </details>
      ),
    });
  if (foldActivity && hubDay) moreForToday.push({ key: 'activity', node: <DayActivity day={hubDay} isToday emptyVault={fresh} except={changedPaths} /> });
  if (foldGlance && glance) moreForToday.push({ key: 'glance', node: <Section id="glance" title="At a glance" count={glance.length}><Glance cards={glance} /></Section> });
  if (view && foldChanged)
    moreForToday.push({
      key: 'changed',
      node: (
        <Section id="changed" title="Changed since yesterday" count={view.changed.length ? view.counts.changed : undefined}>
          {view.changed.length === 0 ? (
            <p className="td-none">Nothing has changed in your projects since yesterday morning.</p>
          ) : (
            <More
              items={view.changed}
              limit={4}
              render={(g) => (
                <div key={g.id} className="td-change">
                  <button className="td-change-head" onClick={(e) => open(g.project, e)}>
                    <span className="td-change-name">{g.projectName}</span>
                    <span className="td-faint">{g.files ? `${g.files} ${g.files === 1 ? 'file' : 'files'} · ` : ''}{whenChanged(g.latest, now)}</span>
                  </button>
                  {g.lines.map((l) => changeLine(g, l))}
                  {g.moreFiles > 0 && (
                    <button className="td-more files" onClick={(e) => open(g.project, e)}>
                      {g.moreFiles} more {g.moreFiles === 1 ? 'file' : 'files'} in its folder
                      <Icon name="chevron" size={12} />
                    </button>
                  )}
                </div>
              )}
            />
          )}
        </Section>
      ),
    });
  if (view && foldDocs)
    moreForToday.push({
      key: 'docs',
      node: (
        <Section id="docs" title="Docs updated" count={view.docs.length}>
          <More
            items={view.docs}
            limit={4}
            render={(d) => (
              <div key={d.path} className="td-change td-doc">
                <button className="td-change-head" onClick={(e) => open(d.path, e)} title={d.about}>
                  <Icon name="doc" size={13} className="td-doc-icon" />
                  <span className="td-change-name">{d.name}</span>
                  <span className="td-faint">{whenChanged(d.mtime, now)}</span>
                </button>
                {d.change && <p className="td-doc-change">{d.change}</p>}
              </div>
            )}
          />
        </Section>
      ),
    });
  if (foldNote && hubDay)
    moreForToday.push({
      key: 'note',
      node: (
        <div className="th-day-note th-day-note-fold">
          <h2 className="th-day-note-title">{isToday ? 'Today’s note' : 'The day’s note'}</h2>
          <DayNote iso={selected} dayWords={longDay(selected, todayIso)} isToday={isToday} daily={hubDay.daily} canEdit={canEdit} />
          <DaySaved day={hubDay} />
        </div>
      ),
    });
  if (foldWeek) moreForToday.push({ key: 'week', node: <WeekStrip selected={selected} today={todayIso} marks={marks} open={monthOpen} onOpen={openMonth} onSelect={setSelected} /> });

  const near = nearWords(selected, todayIso);
  const dayLong = longDay(selected, todayIso);
  const apart = daysApart(todayIso, selected);
  const noteTitle = isToday ? 'Today’s note' : near === 'Yesterday' ? 'Yesterday’s note' : near === 'Tomorrow' ? 'Tomorrow’s note' : 'The day’s note';

  return (
    <>
      {/* One search, at the top (4 Nov 2026): asking lives in the header bar's panel now, so the middle box
          is gone. */}
      {/* The page action (10.0: the reviewer found New floating beside the date in the hero, and the hero carries
          feeling, not controls; the fresh-eyes pass then found a fourth New note here beside the bar's main action
          and the header's plus, so the page keeps only Start from a template). today:actions gates it. */}
      <ViewHeader tab={tab}>
        {on('today:actions') && (
          <>
            <button type="button" className="btn quiet" data-overflow="start-template" data-overflow-order={1} disabled={!canEdit} onClick={() => openStarterPicker()} title="Start from a template">Start from a template</button>
            {/* The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search):
                the action yields into this ⋯ when measured within 12px of the bar; it only shows while carrying it. */}
            <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for today" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
              'start-template': () => ({ label: 'Start from a template…', icon: 'template', disabled: !canEdit, run: () => openStarterPicker() }),
            }))}>
              <Icon name="more" size={16} />
            </button>
          </>
        )}
      </ViewHeader>
      <div className={`td-view th-hub${home ? ' is-home' : ''}`} ref={page}>
        {/* tklist: Today's rows squeeze like every task list (5 Nov 2026 window audit: with the chat
            docked at 1219x800 the fixed who/when tracks crushed titles to "P…"). The shared container
            in plan.css narrows who to its avatar and tightens when; wide middles keep both columns. */}
        <div className="td-inner tklist">
          <header className="td-head nv-today-head">
            <div className="td-head-top">
              <p className="td-date">{isToday ? date : near ?? (apart < 0 ? `${-apart} days ago` : `In ${apart} days`)}</p>
            </div>
          <h1 className="nv-page-title">
            {isToday ? (
              <>
                {greeting(now)}
                {firstName ? `, ${firstName}` : ''}
              </>
            ) : (
              dayLong
            )}
          </h1>
          {isToday && view && sentence && (
            <p className="td-line td-sentence" aria-live="polite">
              {pickedNames && oneCount.late === 0 && oneCount.today === 0 && meetingsCount === 0 ? `Nothing needs you in ${pickedNames}.` : sentence}
            </p>
          )}
          {hubFailed && (
            <p className="td-line" role="alert">
              <span>Parts of today could not be read just now. What is due and your meetings may not all show.</span>{' '}
              <button className="td-line-item" onClick={() => { loadDue(); setHubFailed(false); }}>Try again</button>
            </p>
          )}
          {isToday && <TodayAreas />}
          {/* The page's ways on (20 Nov 2026: they sat in the Also strip, All tasks dead centre and Timeline at the
              far edge of a one-line card): in the head's action slot, as on every page. */}
          {isToday && view && (
            <div className="nv-page-actions td-head-actions">
              <button type="button" className="btn" onClick={() => A.openTasks()}>
                <Icon name="task" size={13} /> All tasks
              </button>
              <button type="button" className="btn" title="Every project’s dates in one view: clashes and slips show" onClick={() => A.openTimeline()}>
                <Icon name="timeline" size={13} /> Timeline
              </button>
            </div>
          )}
        </header>

        {/* Another day chosen: its strip, meetings and note stay up top (29 Oct 2026, ITEMS 1). */}
        {!isToday && on('today:week') && <WeekStrip selected={selected} today={todayIso} marks={marks} open={monthOpen} onOpen={openMonth} onSelect={setSelected} />}

        {/* The day: its meetings at the top, then its note (the inbox), open for writing. */}
        {!isToday && hubDay && hubDay.date === selected && (on('today:day') || on('today:note')) && (
          <section className="th-daybox" aria-label={isToday ? 'Today' : dayLong}>
            {on('today:day') && <DayAgenda day={hubDay} today={todayIso} canEdit={canEdit} />}
            {on('today:note') && (
              <div className="th-day-note">
                <h2 className="th-day-note-title">{noteTitle}</h2>
                <DayNote iso={selected} dayWords={dayLong} isToday={isToday} daily={hubDay.daily} canEdit={canEdit} />
                <DaySaved day={hubDay} />
              </div>
            )}
          </section>
        )}

        {!isToday ? (
          <div className="th-other-day">
            {on('today:tasks') && <DueOnDay entries={dueOnDay} words={near === 'Yesterday' ? 'yesterday' : near === 'Tomorrow' ? 'tomorrow' : 'that day'} onChanged={loadDue} />}
            {on('today:activity') && hubDay && hubDay.date === selected && <DayActivity day={hubDay} isToday={false} emptyVault={fresh} />}
          </div>
        ) : error && !view ? (
          // The vault can't be read (10.0: Home's shared states, kept on the one start to the day).
          <PageError
            title="Your notes couldn’t be reached"
            explainer={<>Your vault folder isn’t plugged in or was moved. Your notes are safe. Check the drive, then try again.</>}
            retry={() => void load()}
            back={{ label: 'Open another vault…', run: () => void window.nv.vault.pick().catch((e: unknown) => setError(errorMessage(e))) }}
          />
        ) : error ? (
          <p className="td-error">{error}</p>
        ) : !view ? (
          <PageLoading label="Opening your vault…">
            <div className="card" style={{ padding: '6px 20px' }}>
              <RowsSkeleton rows={3} />
            </div>
            <CardsSkeleton cards={3} />
          </PageLoading>
        ) : (
          <>
          {fresh && <SetupSteps vaultName={vaultName} />}
          {/* Moved in with notes already (t156, 9 Nov 2026): what was found, with doors into it — the card the
              Home fold orphaned, back where the morning starts. Never beside the setup steps (a new vault holds
              no own notes, so the two can never show together). */}
          {!fresh && movingIn.show && (
            <section className="td-section td-moving" data-section="moving-in" aria-label="Your notes, moved in">
              <MovingIn notes={ownNotes} onHide={movingIn.hide} />
            </section>
          )}
          {/* Composed, not stacked (layout round 2, 20 Nov 2026, on a real vault: every section stood in the left column far below
              the fold, the right column held one Meetings heading for the whole height). The work reads at the left
              (Late, Next, Waiting on an answer, then Today, This week and Later, capped, and the undated as one
              count row into Tasks); the day at the right (its meetings, what needs you, recently viewed, the vault's
              sync line at its foot). The day's other sections stand in whichever column is shorter (components/
              Balance.tsx), behind one quiet "More for today" line, so the page ends near one and a half screens. */}
          <Balance
            className="td-compose"
            // One column below about a 1400 window (round 3: rows at the body step make the work column the longer;
            // two columns at 1366 stood the day's column short beside it).
            min={1120}
            // Three columns from about a 2560 window (round 3, a user's 3440x1400): the work, the day, and what
            // needs you with More for today, open, beside them.
            min3={2200}
            onColumns={setColumns}
            a={
              <div className="td-work" data-column="work">
                {/* Late, Next, then Waiting on an answer (step 2): three questions in order, each job once. */}
                {late.length > 0 && (
                  <section className="td-section td-next" data-section="late" aria-labelledby="td-h-late">
                    <header className="td-section-head">
                      <h2 id="td-h-late">
                        Late
                        <span className="td-count">{late.length}</span>
                      </h2>
                    </header>
                    <More items={late} render={workRow} limit={tall ? 10 : NEXT_SHOWN} />
                  </section>
                )}
                {next.length > 0 && (
                  <section className="td-section td-next" data-section="next" aria-labelledby="td-h-next">
                    <header className="td-section-head">
                      <h2 id="td-h-next">Next</h2>
                    </header>
                    {/* One list (round 4: steps and the notes' lines through the same rank, one-click done and open). */}
                    {next.map((item) => workRow(item))}
                  </section>
                )}
                {openQuestions.length > 0 && (
                  <Section id="questions" title="Waiting on an answer" count={openQuestions.length} className="tklist">
                    {openQuestions.map((q) => questionRow(q))}
                  </Section>
                )}
                {/* The rest of the one list, when Late or Next shows its top: the dated groups capped at five, the
                    undated as one count row (never 108 rows down the page). */}
                {(next.length > 0 || late.length > 0) && on('today:due') && restAny && (
                  <section className="td-section td-rest" data-section="rest" aria-label="The rest of your work">
                    <div className="td-rest-groups">{restGroupsBlock}</div>
                  </section>
                )}
                {/* Nothing on you yet (29 Oct 2026, ITEMS: an empty vault's first look): one calm block where the
                    lists will be, with the ways to start that already exist. Never beside the setup steps (t156). */}
                {welcomeOn && !fresh && (
                  <section className="td-section td-welcome" data-section="empty" aria-labelledby="td-h-empty">
                    <span className="td-welcome-icon">
                      <Icon name="sun" size={20} />
                    </span>
                    <h2 id="td-h-empty">Nothing on you yet</h2>
                    <p>Your tasks, what’s due and who you’re waiting on will show here.</p>
                    <div className="td-welcome-actions">
                      <button type="button" className="button primary" onClick={() => A.openProjects()}>
                        Set up your projects
                      </button>
                      <button type="button" className="button" disabled={!canEdit} onClick={() => void window.nv.capture.show()}>
                        Add a task
                      </button>
                      <button type="button" className="button" disabled={!canEdit} onClick={() => setBringIn(true)}>
                        Bring in your notes
                      </button>
                    </div>
                  </section>
                )}
                {!welcomeOn && allClear && (
                  <section className="td-section td-clear" data-section="clear">
                    <span className="td-clear-icon">
                      <Icon name="sun" size={20} />
                    </span>
                    <div>
                      <h2>All clear</h2>
                      <p>Nothing overdue or due today, nothing at risk, nobody to chase.{counts?.soon || oneCount.week > 0 ? ' Here’s what’s coming this week.' : ''}</p>
                    </div>
                  </section>
                )}
                {!view.nothingOnYou && !noProjects && on('today:due') && (!view.clear || dueCount > 0) && next.length === 0 && late.length === 0 && (
                  <Section
                    id="due"
                    title="Due for you"
                    className="tklist"
                    count={dueCount}
                    hint={dueCount ? undefined : 'Nothing with a date this week'}
                  >
                    {restGroupsBlock}
                    {dueCount === 0 && <p className="td-none">No task or key date falls due in the next seven days.</p>}
                  </Section>
                )}
              </div>
            }
            b={
              <div className="td-day" data-column="day">
                {/* Today's meetings head the day (5 Nov 2026, the day's shape), New and Record small in its head.
                    With none, the head and one quiet line; read-only keeps nothing. */}
                {/* One Meetings card (2.0.1): the day's timeline (or none), the meetings finished with actions still open
                    under it, New and Record small in its head. The Meetings pack's own block, which repeated the
                    timeline's meetings, no longer stands on Today. */}
                {hubDay && hubDay.date === selected && on('today:day') && (hubDay.meetings.length > 0 || canEdit) && (
                  <section className={`td-section th-meetings${hubDay.meetings.length ? '' : ' is-none'}`} data-section="meetings" aria-labelledby="td-h-meetings">
                    <header className="td-section-head">
                      <h2 id="td-h-meetings">
                        Meetings
                        {hubDay.meetings.length > 0 && <span className="td-count">{hubDay.meetings.length}</span>}
                      </h2>
                      <span className="th-meetings-actions">
                        <DayMeetingActions day={hubDay} today={todayIso} canEdit={canEdit} />
                      </span>
                    </header>
                    {hubDay.meetings.length > 0 ? <DayAgenda day={hubDay} today={todayIso} canEdit={canEdit} actions={false} /> : <p className="td-none">No meetings today.</p>}
                    <div className="th-meetings-after" ref={setWaitEl}>
                      <MeetingsAfterLine />
                    </div>
                  </section>
                )}
              </div>
            }
            rest={[
              // What needs you and More for today stand in the day's column unless the work's is the shorter one
              // (a light day's work beside a long list of what needs you): balanced like the rest.
              {
                key: 'needs',
                node: (
                  <section className={`td-section td-needs${ownLook > 0 ? '' : ' is-empty'}`} data-section="needs" aria-labelledby="td-h-needs">
                  {ownLook > 0 && (
                    <header className="td-section-head">
                      <h2 id="td-h-needs">
                        Needs you
                        <span className="td-count">{lookCount}</span>
                      </h2>
                    </header>
                  )}
                  <div className="td-look-items" ref={setLookEl}>
                    {/* The former host app's waits first (9 Nov 2026, t53-today-needs-you): one row per kind, counted with the rest. A
                        lone wait opens straight from its line; several open to their list. */}
                    {inView && sparkRows.map((row) =>
                      row.items.length === 1 ? (
                        <button key={row.key} type="button" className="td-quiet-line" data-look-row data-spark-row={row.key} onClick={() => void window.nv.notices.open(row.items[0].id).finally(() => refreshNotices())} title="Open it">
                          <Icon name={SPARK_ICON[row.key]} size={13} />
                          <span>{row.title}</span>
                          <Icon name="forward" size={12} />
                        </button>
                      ) : (
                        <LookRow key={row.key} icon={SPARK_ICON[row.key]} title={row.title}>
                          {row.items.map((item) => (
                            <Row key={item.id} label={item.title} onOpen={() => void window.nv.notices.open(item.id).finally(() => refreshNotices())}>
                              <span className="td-row-main">
                                <span className="td-row-what"><span className="td-text" title={item.title}>{item.title}</span></span>
                                {item.body && <span className="td-row-sub">{item.body}</span>}
                              </span>
                              <Icon name="forward" size={12} className="td-faint" />
                            </Row>
                          ))}
                        </LookRow>
                      ),
                    )}
                    {/* Captures waiting to be filed (9 Nov 2026, t53-today-needs-you): a line while the Inbox holds
                        something, opening the Inbox. */}
                    {inView && inboxCount > 0 && (
                      <button type="button" className="td-quiet-line" data-look-row data-spark-row="inbox" onClick={() => openInbox()} title="Open the Inbox">
                        <Icon name="inbox" size={13} />
                        <span>{inboxLine(inboxCount)}</span>
                        <Icon name="forward" size={12} />
                      </button>
                    )}
                    <ProjectChecksToday />
                    <TodayModules group="upkeep" />
                    {isToday && dormantQuiet}
                    {isToday && reviewQuiet}
                  </div>
                  {/* The live hub (8 Nov 2026, calm Today): changes waiting, agents, decks due — counted with the rows. */}
                  <div ref={setLiveEl} className="td-live">
                    <ChangesWaiting />
                    {on('today:tasks') && <CardsDue />}
                  </div>
                </section>
                ),
              },
              // The packs' own blocks (bills due, meetings to prep, the turned-on cards) are each a block of their own,
              // so a long one balances into the shorter column instead of making Needs you a page tall. Counted with it.
              {
                key: 'needs-due',
                node: (
                  <section className="td-section td-needs-part" data-needs="due" aria-label="Due">
                    <div className="td-look-items" ref={setDueEl}>
                      <TodayModules group="due" />
                    </div>
                  </section>
                ),
              },
              {
                key: 'needs-cards',
                node: (
                  <section className="td-section td-needs-part" data-needs="cards" aria-label="Cards">
                    <div className="td-look-items" ref={setCardsEl}>
                      <TodayModules group="rest" />
                      {isToday && <LookCards layoutOn={homeLayout.on} inboxCount={inboxCount} recent={recent} />}
                    </div>
                  </section>
                ),
              },
              ...(elseParts.length > 0 ? [{ key: 'more', node: (
                  <section className={`td-section td-rest td-else${elseOpen ? '' : ' is-shut'}`} data-section="also" aria-labelledby="td-h-also">
                    <header className="td-section-head">
                      <h2 id="td-h-also">More for today</h2>
                      {!elseOpen && <span className="td-else-words">{elseParts.join(' · ')}</span>}
                      <button
                        type="button"
                        className="td-more"
                        aria-expanded={elseOpen}
                        onClick={() => {
                          const open = !elseOpen;
                          // Three columns stand it open in its own column; shutting it there holds for this visit.
                          if (columns === 3) setShutInThree(!open);
                          else {
                            setElseOpen(open);
                            keepElseOpen(open);
                          }
                        }}
                      >
                        {elseOpen ? 'Show fewer' : 'Show'}
                        <Icon name={elseOpen ? 'chevronDown' : 'chevron'} size={12} />
                      </button>
                    </header>
                  </section>
                ) }] : []),
              ...(elseOpen ? moreForToday : []),
            ]}
            foot={
              /* The vault's own line (sync, the folder's health) at the foot of the day, one line. */
              <div className="td-foot" data-section="vault">
                {/* Set up the parts of your life (never between the person and their work). */}
                {isToday && !noProjects && <SetupLine />}
                <VaultTodayCards />
              </div>
            }
          />
          {/* Everything else lives in the one fold above (8 Nov 2026, calm Today): the list's rows first, then
              the work sections and the live hub. Nothing stands on the calm screen past the quiet line. */}
          </>
        )}
        {closeButton}
        {bringIn && <ImportDialog onClose={() => setBringIn(false)} onPair={(source) => (setBringIn(false), setPairSource(source))} />}
        {pairSource && <PairDialog source={pairSource} onClose={() => setPairSource(null)} />}
        </div>
      </div>
    </>
  );
}
