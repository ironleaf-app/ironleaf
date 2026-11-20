// Tasks (21 Oct 2026, gap G24; 8.7 wave 2a, 30 Oct 2026; 5 Nov 2026: Today owns the day, Tasks owns the list; t249:
// one view, done well — the plan decision 2, no Board switch): every tick-box line in the notes in one calm list of
// grouped rows (src/shared/tasks.ts says what a task is; any of them ticked for a bulk day, owner or done). The
// app's real due logic throughout: whose and when come from Today's own reading (components/plan/plan.ts taskInfo),
// never Tasks' own day or people rules. Filters for open or done, when it is due (today, overdue, this week, no
// date), its project, the person it names and its tag; sorted by due day, by note, or by the notes changed lately.
// The box ticks the task in its note (Undo in the message); its words change where they show (the day, marks and
// tags stay), its day is set from its tag or its menu (written "📅 2026-10-24", with a time when there is one), its
// owner from its menu or its card, and a task with a day can become a reminder at its time. Each line opens its note
// at its line. A new task goes through Quick add (heard days land on it). The day's own add row lives in Today's
// rest fold, where the day lives. Keys: ↑ and ↓ move between tasks, Enter opens one, Space or X ticks it, D sets its
// day.

import { peek } from '../state/peek';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { addDays, dueDayWords, isIsoDay, isoOf, weekOf } from '../../../shared/hub';
import { dailyTitleWords } from '../../../shared/notes-list';
import { dayShapeCounts, readDay } from '../../../shared/today';
import { DEFAULT_FILTER, doneWords, filterTasks, setTaskWho, splitTaskRest, taskEditableRest, type TaskFilter, type TaskSort, type TaskStatus, type VaultTask } from '../../../shared/tasks';
import { EditorContext, Inline, InlineDate, type Suggestion } from './project/Inline';
import { groupNoDate, taskInfos, visibleWho, whenTone, type Ownership, type PlanGroup, type TaskInfo } from '../components/plan/plan';
import { WhenCell, WhenInner, WhoCell, WhoInner } from '../components/plan/TaskCells';
import type { TasksView as TasksData } from '../../../main/tasks';
import { prompt } from '../components/Dialogs';
import { EmptyState } from '../components/EmptyState';
import { ListDetail, RecordDetail } from '../components/ListDetail';
import { Icon } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { ListFind } from '../components/PageTabs';
import type * as W from '../state/workspace';
import { ViewHeader } from './ViewHeader';
import * as A from '../state/actions';
import { askInChat } from '../state/chat';
import { getState, showError, toast, useApp } from '../state/store';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { todayData } from '../lib/todayData';
import { taskDueTag } from '../../../shared/projects-87';
import { toggleSelected } from '../../../shared/notes-list';
import { plural } from '../../../shared/words';

const GROUP_WORDS: Record<PlanGroup, string> = { late: 'Late', today: 'Today', week: 'This week', later: 'Later', stale: 'From a while back', earlier: 'Earlier', none: 'No date' };
const GROUP_ORDER: PlanGroup[] = ['late', 'today', 'week', 'later', 'stale', 'earlier', 'none'];
const OWN_TABS: { id: Ownership; label: string }[] = [
  { id: 'mine', label: 'Mine' },
  { id: 'everyone', label: 'Everyone' },
];
/** The when chips a person uses (t249, the plan decision 2: Late, This week and Done — the day's loop and what
 *  got finished; every group still heads the list below, and an empty view offers its rows). */
const WHEN_CHIPS: { id: PlanGroup; label: string }[] = [{ id: 'late', label: 'Late' }, { id: 'week', label: 'This week' }];

/** Tasks with Today's own reading (components/plan/plan.ts taskInfo, on ownerOf / isPerson / readDay): Mine /
 *  Waiting / Everyone and Late / Today / This week / Later / No date all come from it, never Tasks' own day or
 *  people rules: the when filter in filterTasks is left at any time and its counts are not used. So Mine › Late
 *  is Today's late for you. One reading for the page and the left side's badge (plan.ts taskInfos; sweep 001/008). */
function entriesFor(tasks: VaultTask[], f: TaskFilter, me: string | null, today: string, known: TasksData['known']): { t: VaultTask; info: TaskInfo }[] {
  const kept = filterTasks(tasks, { ...f, when: 'any' }, today);
  const infos = taskInfos(
    kept.map((t) => ({ words: t.words, due: t.due, done: t.done, people: t.people.map((p) => A.titleOf(p)) })),
    me,
    today,
    known,
  );
  return kept.map((t, i) => ({ t, info: infos[i] }));
}

/** An empty Tasks view says why, in plain words (vault rebuild step 2: never the confident wrong "No tasks
 *  match" while dated work sits open). A dated view with undated rows open offers them one click away. */
function TasksEmpty({ ownership, whenGroup, filter, filtered, undated, onShowUndated, onClear }: { ownership: Ownership; whenGroup: PlanGroup | 'any'; filter: TaskFilter; filtered: boolean; undated: number; onShowUndated(): void; onClear(): void }) {
  const whose = ownership === 'mine' ? 'of yours' : 'for everyone';
  const line =
    filter.status === 'done'
      ? `Nothing ${whose} is done yet.`
      : whenGroup === 'week'
        ? `Nothing ${whose} is dated this week.`
        : whenGroup === 'today'
          ? `Nothing ${whose} is due today.`
          : whenGroup === 'late'
            ? `Nothing ${whose} is late.`
            : whenGroup === 'later'
              ? `Nothing ${whose} is dated later.`
              : whenGroup === 'stale'
                ? `Nothing ${whose} is from a while back.`
                : whenGroup === 'none'
                  ? `Everything ${whose} is dated.`
                  : whenGroup === 'earlier'
                    ? `Nothing ${whose} is here.`
                    : filter.text?.trim()
                      ? `Nothing ${whose} matches “${filter.text.trim()}”.`
                      : `Nothing ${whose} matches these filters.`;
  const showUndated = undated > 0 && (whenGroup === 'week' || whenGroup === 'today' || whenGroup === 'late' || whenGroup === 'later');
  return (
    <EmptyState
      size="panel"
      icon="task"
      title="Nothing here"
      line={`${line}${showUndated ? ` ${undated} ${undated === 1 ? 'has' : 'have'} no date: show them` : ''}`}
      action={showUndated ? { label: 'Show them', run: onShowUndated } : filtered ? { label: 'Clear filters', run: onClear } : undefined}
      also={showUndated && filtered ? { label: 'Clear filters', run: onClear } : undefined}
    />
  );
}
const SORT_WORDS: Record<TaskSort, string> = { due: 'Due first', note: 'By note', changed: 'Newest' };
const STATUS_WORDS: Record<TaskStatus, string> = { open: 'Open', done: 'Done', all: 'All' };

/** A note's name as people read it: a daily note's ISO ("2026-11-06") spells its day, never raw (5 Nov 2026,
 *  the plan: no raw ISO anywhere); anything else passes through. */
export function noteTitleWords(title: string): string {
  return dailyTitleWords(title) || title;
}

/** A due day as a row announces it: lateness ("4 days late", "Yesterday") needs no "due" in front of it. */
function saidWhen(when: string): string {
  if (!when) return '';
  return /late/i.test(when) || when === 'Yesterday' || when.startsWith('Yesterday ') ? when : `due ${when}`;
}

/** A task's words as people read them: links as their names, Markdown marks left out. */
export function plainWords(words: string): string {
  return words
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop() ?? t)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~|`)(.+?)\1/g, '$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MEMORY = 'nv-tasks-filter';

/** The filter as it was left on this PC (a convenience: nothing breaks without it). Every choice is kept,
 *  the project, person, tag and words with the rest (5 Nov 2026: "for now" filters punished anyone working one
 *  project all week — the filter is back as left, like status, when and sort always were). */
function useTasksMemory(): [TaskFilter, (f: TaskFilter) => void] {
  const [filter, setFilter] = useState<TaskFilter>(() => {
    try {
      const m = JSON.parse(localStorage.getItem(MEMORY) ?? 'null') as Partial<TaskFilter> | null;
      if (!m || typeof m !== 'object') return DEFAULT_FILTER;
      return {
        ...DEFAULT_FILTER,
        ...(m.status && m.status in STATUS_WORDS ? { status: m.status } : {}),
        ...(m.when && ['any', 'today', 'overdue', 'week', 'none'].includes(m.when) ? { when: m.when } : {}),
        ...(m.sort && m.sort in SORT_WORDS ? { sort: m.sort } : {}),
        ...(typeof m.project === 'string' ? { project: m.project } : {}),
        ...(typeof m.person === 'string' ? { person: m.person || undefined } : {}),
        ...(typeof m.tag === 'string' ? { tag: m.tag || undefined } : {}),
        ...(typeof m.text === 'string' ? { text: m.text.slice(0, 200) } : {}),
      };
    } catch {
      return DEFAULT_FILTER;
    }
  });
  const remember = useCallback((f: TaskFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(MEMORY, JSON.stringify({ status: f.status, when: f.when, sort: f.sort, project: f.project, person: f.person, tag: f.tag, text: f.text }));
    } catch {
      // Remembering is a convenience.
    }
  }, []);
  return [filter, remember];
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange(v: string): void }) {
  return (
    <select className="select" style={{ height: 32, fontSize: 13 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}



// The tasks as last read, kept across opens (t146, 9 Nov 2026): every Tasks open re-read all 6,000
// tasks over the bridge and drew twice (loading, then rows) for identical rows. The main side's answer is
// a reading of its generation, the templates folder and the day; the same revision here stands for the same
// generation there (the notes reload on every change), so the same three is the same tasks and reads again
// on anything changed — including the templates folder and the day, which move no revision.
let keptTasks: { revision: number; templates: string; day: string; data: TasksData } | null = null;
const tasksKeyNow = () => ({ revision: getState().revision, templates: getState().settings?.prefs?.templatesFolder ?? '', day: isoOf(Date.now()) });
const keptTasksNow = (): TasksData | null => {
  const k = keptTasks;
  if (!k) return null;
  const now = tasksKeyNow();
  return k.revision === now.revision && k.templates === now.templates && k.day === now.day ? k.data : null;
};

export function TasksView({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [data, setData] = useState<TasksData | null>(() => keptTasksNow());
  const [filter, setFilter] = useTasksMemory();
  // Whose tasks (29 Oct 2026, REDESIGN Job A): Mine by default, the same reading as Today (components/plan/plan.ts).
  const [ownership, setOwnership] = useState<Ownership>('mine');
  const [whenGroup, setWhenGroup] = useState<PlanGroup | 'any'>(() => (A.takeTasksAsk()?.when === 'none' ? 'none' : 'any'));
  // Today's undated count row asks for just the tasks with no date (layout round 2).
  useEffect(() => {
    const hear = () => {
      if (A.takeTasksAsk()?.when === 'none') {
        setFilter({ ...DEFAULT_FILTER, status: 'open' });
        setWhenGroup('none');
      }
    };
    window.addEventListener('nv-tasks-ask', hear);
    return () => window.removeEventListener('nv-tasks-ask', hear);
  }, [setFilter]);
  const [showFilters, setShowFilters] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  // The rows ticked for a bulk change (5 Nov 2026, the Inbox's bulk, reused: Tick all plus a toolbar).
  const [selected, setSelected] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [dayNote, setDayNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Map<string, boolean>>(new Map());
  // The rows drawn at once (t102, 9 Nov 2026: a big vault drew every task, thousands of rows; the list shows
  // the first hundred, like Notes' eighty, and the rest waits behind the same Show more).
  const [shownCount, setShownCount] = useState(100);
  const list = useRef<HTMLDivElement>(null);
  // The kit's fields on the rows (titles change in place): the rows save through tasks:edit, never this.
  const taskEditor = useMemo(() => ({ path: '', canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [canEdit]);

  const load = useCallback(() => {
    const key = tasksKeyNow();
    void window.nv.tasks.view().then(
      (d) => {
        // Kept only when nothing moved while reading (a change landing mid-read leaves no stale entry;
        // the revision's own effect reads again below).
        const now = tasksKeyNow();
        if (now.revision === key.revision && now.templates === key.templates && now.day === key.day) keptTasks = { ...key, data: d };
        setData(d);
      },
      showError,
    );
  }, []);
  // Who "me" is, from Today's own reading of the projects (src/shared/today.ts whoIsMe, via the Today data).
  useEffect(() => {
    let live = true;
    void todayData().then((d) => live && (setMe(d.me), setDayNote(d.daily?.path ?? null)), () => undefined);
    return () => void (live = false);
  }, []);
  useEffect(() => {
    const kept = keptTasksNow();
    if (kept) {
      if (!data) setData(kept);
      return;
    }
    const t = window.setTimeout(load, data ? 150 : 0);
    return () => window.clearTimeout(t);
  }, [revision, load]);
  // A tick shows at once; once the notes say so, the list does.
  useEffect(() => setTicked(new Map()), [data]);

  const today = data?.today ?? '';
  const entries = useMemo(() => (!data || !today ? [] : entriesFor(data.tasks, filter, me, today, data.known)), [data, filter, today, me]);
  // The Find counts its chip without its words (t262): the same reading with the words off, only while words stand.
  const entriesNoText = useMemo(() => (!data || !today || !filter.text?.trim() ? null : entriesFor(data.tasks, { ...filter, text: '' }, me, today, data.known)), [data, filter, today, me]);
  const ownEntries = useMemo(() => (ownership === 'everyone' ? entries : entries.filter((x) => x.info.ownership === ownership)), [entries, ownership]);
  const shownEntries = useMemo(() => (whenGroup === 'any' ? ownEntries : ownEntries.filter((x) => x.info.group === whenGroup)), [ownEntries, whenGroup]);
  const match = !filter.text?.trim() || !entriesNoText ? null : { n: shownEntries.length, m: (ownership === 'everyone' ? entriesNoText : entriesNoText.filter((x) => x.info.ownership === ownership)).filter((x) => whenGroup === 'any' || x.info.group === whenGroup).length };
  // Ticked rows that filtered or cleared away untick themselves, so the bar never acts on what isn't shown.
  useEffect(() => {
    setSelected((s) => {
      const here = new Set(shownEntries.map((x) => x.t.key));
      const kept = s.filter((key) => here.has(key));
      return kept.length === s.length ? s : kept;
    });
  }, [shownEntries]);
  const shown = shownEntries.map((x) => x.t);
  const [picked, setPicked] = useState<string | null>(null);
  const infoOf = useMemo(() => new Map(shownEntries.map((x) => [x.t.key, x.info])), [shownEntries]);
  useEffect(() => {
    setShownCount(100);
  }, [filter, ownership, whenGroup]);
  // Only the window is drawn; each head still counts its whole group, as before.
  const groups = useMemo(() => {
    const full = filter.sort === 'due' ? GROUP_ORDER.map((g) => ({ id: g as PlanGroup | null, items: shownEntries.filter((x) => x.info.group === g).map((x) => x.t) })).filter((g) => g.items.length) : [{ id: null as PlanGroup | null, items: shownEntries.map((x) => x.t) }];
    let left = shownCount;
    return full.map((g) => {
      const items = g.items.slice(0, Math.max(0, left));
      left -= items.length;
      return { ...g, total: g.items.length, items };
    });
  }, [shownEntries, filter.sort, shownCount]);
  const drawnCount = Math.min(shownEntries.length, shownCount);
  // Counted once, not once per chip per render (t102, 9 Nov 2026: every keystroke scanned the tasks ten times over).
  const groupCounts = useMemo(() => {
    const m = new Map<PlanGroup, number>();
    for (const x of ownEntries) m.set(x.info.group, (m.get(x.info.group) ?? 0) + 1);
    return m;
  }, [ownEntries]);
  const leadOpen = useMemo(() => ownEntries.filter((x) => !x.t.done).length, [ownEntries]);
  const doneCount = useMemo(() => ownEntries.filter((x) => x.t.done).length, [ownEntries]);
  const set = (patch: Partial<TaskFilter>) => setFilter({ ...filter, ...patch });

  const tick = (t: VaultTask, done: boolean) => {
    setTicked((m) => new Map(m).set(t.key, done));
    void window.nv.tasks.tick(t.path, t.line, t.text, done).then(
      (r) => {
        const what = `“${doneWords(t.words)}”`;
        // A repeating reminder moved on to its next time: there is nothing to undo, it is simply next time's now.
        if (done && t.repeats) return toast(`${r.words} ${what}`);
        toast(done ? doneWords(t.words) : `Not done: ${what}`, {
          label: 'Undo',
          run: () => void window.nv.tasks.tick(t.path, t.line, r.line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, ''), !done).then(load, showError),
        });
      },
      (e) => {
        setTicked((m) => {
          const next = new Map(m);
          next.delete(t.key);
          return next;
        });
        showError(e);
      },
    );
  };

  /** Rows fresh from the vault, matched by note and line (5 Nov 2026: a day or owner write changes the line's
   *  words, so an Undo holding the old words finds nothing — locateAnyTask matches exact text. In-place writes
   *  keep path and line; keys move with the words, so the match is by line, falling back to the held row). */
  const freshByLine = async (targets: VaultTask[]): Promise<Map<string, VaultTask>> => {
    try {
      const v = await window.nv.tasks.view();
      const byLine = new Map(v.tasks.map((x) => [`${x.path}:${x.line}`, x]));
      return new Map(targets.map((t) => [t.key, byLine.get(`${t.path}:${t.line}`) ?? t]));
    } catch {
      return new Map(targets.map((t) => [t.key, t]));
    }
  };

  const setDue = (t: VaultTask, iso: string | null, time: string | null = iso === t.due ? t.time : null) => {
    const back = { due: t.due ?? null, time: t.time ?? null };
    const changed = iso !== back.due || (time ?? null) !== back.time;
    return void window.nv.tasks.setDue(t.path, t.line, t.text, iso, time).then((w) => {
      toast(iso ? `Due ${dueDayWords(iso, today).toLowerCase().replace(/^(mon|tue|wed|thu|fri|sat|sun)/, (d) => d[0].toUpperCase() + d.slice(1))}${time ? ` at ${time}` : ''}.` : w, changed ? {
        label: 'Undo',
        run: () => {
          void (async () => {
            const f = (await freshByLine([t])).get(t.key) ?? t;
            try {
              await window.nv.tasks.setDue(f.path, f.line, f.text, back.due, back.time);
              toast('Undone.');
            } catch (e) {
              showError(e);
            }
            load();
          })();
        },
      } : undefined);
      load();
    }, showError);
  };

  const chooseDay = async (t: VaultTask) => {
    const typed = await prompt('Due on which day?', { value: t.due ?? today, message: 'A day like 2026-10-24, 24 Oct, tomorrow or Friday 24 Oct.', ok: 'Set the day' });
    if (!typed) return;
    const iso = isIsoDay(typed.trim()) ? typed.trim() : dayOf(typed, today);
    if (!iso) return toast('That isn’t a day Ironleaf can read. Try 2026-10-24 or 24 Oct.');
    setDue(t, iso);
  };

  const chooseTime = async (t: VaultTask) => {
    const typed = await prompt('Due at what time?', { value: t.time ?? '09:00', message: 'Like 15:00 or 3pm. With a time, the task can remind you.', ok: 'Set the time' });
    if (!typed) return;
    const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(typed.trim());
    let h = m ? Number(m[1]) : NaN;
    const min = m?.[2] ? Number(m[2]) : 0;
    if (m?.[3]) h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
    if (!m || (!m[2] && !m[3]) || h > 23 || min > 59) return toast('That isn’t a time Ironleaf can read. Try 15:00 or 3pm.');
    setDue(t, t.due ?? today, `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  };

  const remind = (t: VaultTask) => void window.nv.tasks.remind(t.path, t.line, t.text).then((w) => (toast(w), load()), showError);

  // ── Bulk: the ticked rows, one change ──────────────────────────────────────────────────────────────
  // The same single-task writes as one row (tasks:tick, tasks:setDue, tasks:edit), looped like the Inbox loops
  // its filing — TasksService stays single-task. One toast and one Undo for the whole change, never one per row.
  const tickedTasks = useMemo(() => shown.filter((t) => selected.includes(t.key)), [shown, selected]);

  const bulkDone = async () => {
    const targets = tickedTasks.filter((t) => !(ticked.get(t.key) ?? t.done));
    if (!targets.length) return;
    setTicked((m) => {
      const next = new Map(m);
      for (const t of targets) next.set(t.key, true);
      return next;
    });
    let n = 0;
    try {
      for (const t of targets) {
        await window.nv.tasks.tick(t.path, t.line, t.text, true);
        n++;
      }
      toast(`${plural(n, 'task')} done.`, {
        label: 'Undo',
        run: () => {
          void (async () => {
            for (const t of targets) {
              try {
                await window.nv.tasks.tick(t.path, t.line, t.text, false);
              } catch {
                // One that will not come back stays done; the rest still do.
              }
            }
            load();
          })();
        },
      });
    } catch (err) {
      showError(err);
    } finally {
      setSelected([]);
      load();
    }
  };

  const bulkDayItems = (): MenuItem[] => {
    const monday = addDays(weekOf(today)[0], 7);
    const apply = async (iso: string | null) => {
      const backs = new Map(targets.map((t) => [t.key, { due: t.due ?? null, time: t.time ?? null }]));
      let n = 0;
      let skipped = 0;
      for (const t of targets) {
        // A reminder keeps its moment: tasks:setDue refuses it, so it is counted, not attempted.
        if (t.reminder) {
          skipped++;
          continue;
        }
        try {
          await window.nv.tasks.setDue(t.path, t.line, t.text, iso, iso === t.due ? t.time : null);
          n++;
        } catch {
          skipped++;
        }
      }
      const day = iso ? dueDayWords(iso, today).toLowerCase() : 'no day';
      toast(`${n ? `Day set on ${plural(n, 'task')} (${day}).` : 'No day set.'}${skipped ? ` ${plural(skipped, 'reminder')} kept ${skipped === 1 ? 'its' : 'their'} time.` : ''}`, n ? {
        label: 'Undo',
        run: () => {
          void (async () => {
            const fresh = await freshByLine(targets);
            for (const t of targets) {
              const back = backs.get(t.key);
              if (!back) continue;
              const f = fresh.get(t.key) ?? t;
              try {
                await window.nv.tasks.setDue(f.path, f.line, f.text, back.due, back.time);
              } catch {
                // One that will not move back stays; the rest still do.
              }
            }
            load();
          })();
        },
      } : undefined);
      setSelected([]);
      load();
    };
    const targets = tickedTasks;
    const pickDay = async () => {
      const typed = await prompt('Due on which day?', { value: today, message: 'A day like 2026-10-24, 24 Oct, tomorrow or Friday 24 Oct.', ok: 'Set the day' });
      if (!typed) return;
      const iso = isIsoDay(typed.trim()) ? typed.trim() : dayOf(typed, today);
      if (!iso) return toast('That isn’t a day Ironleaf can read. Try 2026-10-24 or 24 Oct.');
      void apply(iso);
    };
    return [
      { heading: `Due for ${plural(targets.length, 'task')}` },
      { label: 'Today', icon: 'sun', run: () => void apply(today) },
      { label: 'Tomorrow', icon: 'calendar', run: () => void apply(addDays(today, 1)) },
      { label: `Next Monday (${dueDayWords(monday, today)})`, icon: 'calendar', run: () => void apply(monday) },
      { label: 'In a week', icon: 'calendar', run: () => void apply(addDays(today, 7)) },
      { label: 'Choose a day…', icon: 'calendar', run: () => void pickDay() },
      { label: 'Take the day off', icon: 'close', run: () => void apply(null) },
    ];
  };

  const bulkWho = async () => {
    const targets = tickedTasks;
    if (!targets.length) return;
    const who = await prompt('Who does it?', { value: '', message: 'Their name is written on each ticked task’s line. Empty takes it off.', ok: 'Set who' });
    if (who === null || who === undefined) return;
    const name = who.replace(/\s+/g, ' ').trim();
    const backs = new Map<string, string>();
    for (const t of targets) {
      const rest = taskEditableRest(`- [ ] ${t.text}`);
      if (rest !== null) backs.set(t.key, rest);
    }
    let n = 0;
    let skipped = 0;
    for (const t of targets) {
      const rest = backs.get(t.key);
      if (rest === undefined) {
        skipped++;
        continue;
      }
      const next = taskEditableRest(setTaskWho(`- [ ] ${t.text}`, name));
      if (next === null || next === rest) {
        skipped++;
        continue;
      }
      try {
        await window.nv.tasks.edit(t.path, t.line, t.text, next);
        n++;
      } catch {
        skipped++;
      }
    }
    toast(`${n ? (name ? `Gave ${plural(n, 'task')} to ${name}.` : `Took the owner off ${plural(n, 'task')}.`) : 'Nobody moved.'}${skipped && n ? ` ${plural(skipped, 'task')} already ${skipped === 1 ? 'reads' : 'read'} that way.` : ''}`, n ? {
      label: 'Undo',
      run: () => {
        void (async () => {
          const fresh = await freshByLine(targets);
          for (const t of targets) {
            const back = backs.get(t.key);
            if (back === undefined) continue;
            const f = fresh.get(t.key) ?? t;
            try {
              await window.nv.tasks.edit(f.path, f.line, f.text, back);
            } catch {
              // One that will not move back stays; the rest still do.
            }
          }
          load();
        })();
      },
    } : undefined);
    setSelected([]);
    load();
  };

  /** A task's words changed where shown (its title, owner or both): the box, day, marks and tags stay where they are. */
  const editRest = async (t: VaultTask, rest: string, oldRest: string, words: string): Promise<boolean> => {
    if (rest === oldRest) return true;
    try {
      const r = await window.nv.tasks.edit(t.path, t.line, t.text, rest);
      toast(words, { label: 'Undo', run: () => void window.nv.tasks.edit(t.path, t.line, r.line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, ''), oldRest).then(load, showError) });
      load();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };

  /** Who does it, written on its line ("— Name", the tail the rows read as its owner). Empty takes it off. */
  const changeWho = async (t: VaultTask) => {
    const owner = infoOf.get(t.key)?.owner;
    const who = await prompt('Who does it?', { value: owner ?? '', message: 'Their name is written on the task’s line. Empty takes it off.', ok: 'Set who' });
    if (who === null || who === undefined) return;
    void saveWho(t, who);
  };

  /** Who does it, changed on the row (p17-editable, Nov 2026): the same write as the menu, from the cell itself. */
  const saveWho = async (t: VaultTask, who: string): Promise<boolean> => {
    const rest = taskEditableRest(`- [ ] ${t.text}`);
    if (rest === null) return false;
    const name = who.replace(/\s+/g, ' ').trim();
    const next = taskEditableRest(setTaskWho(`- [ ] ${t.text}`, name));
    if (next === null || next === rest) return true;
    return editRest(t, next, rest, name ? `Gave it to ${name}.` : 'Took the owner off.');
  };

  /** Everyone the tasks name, so a row's who suggests them. */
  const people: Suggestion[] = useMemo(() => {
    const names = new Set<string>();
    for (const t of data?.tasks ?? []) {
      for (const p of t.people ?? []) names.add(A.titleOf(p));
      const o = infoOf.get(t.key)?.owner;
      if (o) names.add(o);
    }
    return [...names].filter(Boolean).sort().map((value) => ({ value }));
  }, [data, infoOf]);

  const dayMenu = (t: VaultTask): MenuItem[] => {
    const monday = addDays(weekOf(today)[0], 7);
    return [
      { heading: 'Due' },
      { label: 'Today', icon: 'sun', disabled: !canEdit || t.reminder, run: () => setDue(t, today) },
      { label: 'Tomorrow', icon: 'calendar', disabled: !canEdit || t.reminder, run: () => setDue(t, addDays(today, 1)) },
      { label: `Next Monday (${dueDayWords(monday, today)})`, icon: 'calendar', disabled: !canEdit || t.reminder, run: () => setDue(t, monday) },
      { label: 'In a week', icon: 'calendar', disabled: !canEdit || t.reminder, run: () => setDue(t, addDays(today, 7)) },
      { label: 'Choose a day…', icon: 'calendar', disabled: !canEdit || t.reminder, run: () => void chooseDay(t) },
      { label: t.time ? `Change the time (${t.time})…` : 'Add a time…', icon: 'clock', disabled: !canEdit || t.reminder, run: () => void chooseTime(t) },
      ...(t.due && !t.reminder ? [{ label: 'Take the day off', icon: 'close' as const, disabled: !canEdit, run: () => setDue(t, null, null) }] : []),
      { separator: true },
      t.reminder
        ? { label: 'It’s a reminder already', icon: 'clock', disabled: true, run: () => undefined }
        : { label: t.time ? `Remind me at ${t.time} on its day` : 'Remind me on its day (9:00 am)', icon: 'clock', disabled: !canEdit || !t.due || t.done, run: () => remind(t) },
      { separator: true },
      { label: 'Who does it', icon: 'person', hint: infoOf.get(t.key)?.owner, disabled: !canEdit, run: () => void changeWho(t) },
      { separator: true },
      { label: `Open “${t.title}”`, icon: 'forward', run: () => A.openAtLine(t.path, t.line) },
    ];
  };
  const openRowMenu = (t: VaultTask, anchor: HTMLElement) => openMenu(anchor, dayMenu(t));

  const planDay = () => {
    const need = ownEntries.filter((x) => !x.t.done && (x.info.group === 'late' || x.info.group === 'today'));
    askInChat(
      `Plan my day from today's tasks: what's first, what can slip, and what to chase. ${need.length ? `They are:\n${need.map((x) => `- ${plainWords(x.t.words)}${x.t.due ? ` (due ${dueDayWords(x.t.due, today)}${x.t.time ? ` ${x.t.time}` : ''})` : ''}`).join('\n')}` : 'Nothing is due today. Say so and suggest what to pull forward.'}`,
    );
  };

  // ↑ ↓ move between tasks; Space or X ticks; D opens the day's menu; Enter opens the note (the row's own handler).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('.tk-row') ?? [])];
    const at = rows.findIndex((r) => r === document.activeElement || r.contains(document.activeElement));
    // Not while a title is being changed: the arrows move in the field.
    if ((e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      return;
    }
    if (at < 0 || e.target !== rows[at]) return;
    const t = shown.find((x) => x.key === rows[at].dataset.key);
    if (!t) return;
    if ((e.key === ' ' || e.key.toLowerCase() === 'x') && canEdit) {
      e.preventDefault();
      tick(t, !(ticked.get(t.key) ?? t.done));
    } else if (e.key.toLowerCase() === 'd') {
      e.preventDefault();
      openMenu(rows[at].querySelector<HTMLElement>('.tk-day') ?? rows[at], dayMenu(t));
    }
  };

  const filtered = filter.project !== undefined || !!filter.person || !!filter.tag || !!filter.text?.trim() || whenGroup !== 'any';
  const newTask = () => void window.nv.capture.show().catch(showError);
  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search): New
  // task yields into the ⋯ menu when measured within 12px of the bar, and comes back when there is room.
  const tasksMenu = (): MenuItem[] => {
    const over = overflowMenuItems(headerOverflowHidden(tab.id), {
      'new-task': () => ({ label: 'New task', icon: 'plus' as const, disabled: !canEdit, run: newTask }),
    });
    return [
    ...(over.length ? [...over, { separator: true } as const] : []),
    { label: 'Open today’s note', icon: 'notes' as const, disabled: !dayNote, run: () => dayNote && A.openPath(dayNote) },
    { label: 'Plan my day in the chat', icon: 'chat' as const, run: planDay },
    { separator: true } as const,
    { label: 'Clear filters', icon: 'close' as const, disabled: !filtered, run: () => (setFilter({ ...DEFAULT_FILTER }), setWhenGroup('any')) },
    ];
  };
  const tasksHead = (
    <ViewHeader tab={tab} menu={tasksMenu}>
      <button className="btn pri" data-overflow="new-task" data-overflow-order={1} disabled={!canEdit} title="Capture files it as a task (heard days land on it)" onClick={newTask}>
        + New task
      </button>
    </ViewHeader>
  );

  // The head pills read the filtered list itself through the one rule (t76, 9 Nov 2026: ownership
  // was decided when the list was, so re-deriving it from words here dropped strangers' mentions and,
  // with no single me, every named task — the pills and the groups disagreed). Open dated rows by the
  // one day reading, stale apart like everywhere, so the pills and the chips can never differ.
  // Above the loading return: a hook below it renders more hooks once the data lands (React #310).
  const oneCount = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(y || 2026, (m || 1) - 1, d || 1);
    const open = ownEntries.filter((x) => !x.t.done && x.info.offset !== null);
    return dayShapeCounts(
      open.map((x) => ({ offset: x.info.offset as number })),
      [],
      now,
    );
  }, [ownEntries, today]);

  if (!data)
    return (
      <>
        {tasksHead}
        <div className="vscroll">
          {/* The frame sets the column (p25 one column): no width or pads of its own, as every room. */}
          <div className="vpage wide">
            <div className="view-loading" />
          </div>
        </div>
      </>
    );
  const f = data.facets;
  const projectValue = filter.project === undefined ? '*' : filter.project === '' ? '-' : filter.project;
  const extraFiltered = filter.project !== undefined || !!filter.person || !!filter.tag || filter.status !== 'open' || filter.sort !== 'due';
  const groupCount = (g: PlanGroup) => groupCounts.get(g) ?? 0;
  const leadLate = oneCount.late;
  const leadToday = oneCount.today;

  const whoseSwitch = () => (
    <span className="seg" role="radiogroup" aria-label="Whose tasks">
      {OWN_TABS.map((o) => (
        <button key={o.id} role="radio" aria-checked={ownership === o.id} className={ownership === o.id ? 'on' : ''} onClick={() => setOwnership(o.id)}>
          {o.label}
        </button>
      ))}
    </span>
  );

  return (
    <>
      {tasksHead}
      <div
        className="vscroll"
        onKeyDown={(e) => {
          // The room's / key jumps to the Find (fnv3 F29: a key is the list's only outside a field).
          if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
          if (e.key === '/' && document.activeElement !== findRef.current) {
            e.preventDefault();
            findRef.current?.focus();
          }
        }}
      >
      {/* The frame sets the column (p25 one column, 5 Nov 2026: Tasks' own 980 px sat its box narrower than
          every room and its title 12 px high): the list stands in it. */}
      <div className="vpage wide has-split">
        <div className="w2a-head">
          <h1 className="w2a-title">Tasks</h1>
          {leadOpen > 0 && <span className="pill is-plain is-muted">{leadOpen} open</span>}
          {leadLate > 0 && <span className="pill is-plain is-attention">{leadLate} late</span>}
          {leadToday > 0 && <span className="pill is-plain is-muted">{leadToday} today</span>}
        </div>

        {/* One row (29 Oct 2026, ITEMS 3; t249: whose, the day's two whens and done, and one Filters
            button for the rest (every other group still heads the list below); t262: the Find stands on its
            own row below, through the one list Find). */}
        <div className="chips" style={{ marginTop: 14 }} role="group" aria-label="Filter tasks">
          {whoseSwitch()}
          {WHEN_CHIPS.map((w) => {
            const n = groupCount(w.id);
            const on = whenGroup === w.id;
            return (
              <button key={w.id} aria-pressed={on} className={`chip${on ? ' on' : ''}`} title={on ? `Showing ${w.label.toLowerCase()}. Press again for every task.` : `Only ${w.label.toLowerCase()}`} onClick={() => (on ? setWhenGroup('any') : (set({ status: 'open' }), setWhenGroup(w.id)))}>
                {w.label}
                {n > 0 && <span className="n">{n}</span>}
              </button>
            );
          })}
          <button aria-pressed={filter.status === 'done'} className={`chip${filter.status === 'done' ? ' on' : ''}`} title={filter.status === 'done' ? 'Showing done. Press again for open tasks.' : 'Only done'} onClick={() => (filter.status === 'done' ? set({ status: 'open' }) : (setWhenGroup('any'), set({ status: 'done' })))}>
            Done
            {doneCount > 0 && <span className="n">{doneCount}</span>}
          </button>
          <button type="button" className={`chip${extraFiltered ? ' on' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
            Filters{extraFiltered ? ' · on' : ''} <Icon name="chevronDown" size={12} />
          </button>
        </div>
        <ListFind id="tasks" open always value={filter.text ?? ''} onChange={(text) => set({ text })} match={match} inputRef={findRef} hint="Press / to jump to the find" />
        {showFilters && (
          <div className="chips" style={{ marginTop: 10 }}>
            <span className="seg" role="radiogroup" aria-label="Open or done">
              {(Object.keys(STATUS_WORDS) as TaskStatus[]).map((s) => (
                <button key={s} role="radio" aria-checked={filter.status === s} className={filter.status === s ? 'on' : ''} onClick={() => set({ status: s })}>
                  {STATUS_WORDS[s]}
                  {s !== 'all' && <span className="n"> {s === 'open' ? f.counts.open : f.counts.done}</span>}
                </button>
              ))}
            </span>
            <Select label="Project" value={projectValue} options={[{ id: '*', label: 'Any project' }, ...f.projects.map((p) => ({ id: p.path, label: `${p.name} (${p.count})` })), ...(f.noProject ? [{ id: '-', label: `No project (${f.noProject})` }] : [])]} onChange={(v) => set({ project: v === '*' ? undefined : v === '-' ? '' : v })} />
            <Select label="Person" value={filter.person ?? ''} options={[{ id: '', label: 'Anyone' }, ...f.people.map((p) => ({ id: p.path, label: `${p.name} (${p.count})` }))]} onChange={(v) => set({ person: v || undefined })} />
            <Select label="Tag" value={filter.tag ?? ''} options={[{ id: '', label: 'Any tag' }, ...f.tags.map((t) => ({ id: t.tag, label: `#${t.tag} (${t.count})` }))]} onChange={(v) => set({ tag: v || undefined })} />
            <Select label="Order" value={filter.sort} options={(Object.keys(SORT_WORDS) as TaskSort[]).map((s) => ({ id: s, label: SORT_WORDS[s] }))} onChange={(v) => set({ sort: v as TaskSort })} />
            {extraFiltered && (
              <button className="btn quiet" style={{ height: 32 }} onClick={() => setFilter({ ...DEFAULT_FILTER })}>
                Clear
              </button>
            )}
          </div>
        )}
        {/* Tick all, and the ticked rows' bar (5 Nov 2026, the Inbox's bulk, reused: the same words, the
            same bar, a day and an owner beside done). */}
        {shown.length > 0 && (
          <div className="w2a-ib-select">
            <button type="button" className="btn quiet" title="Tick every task shown, to change them together" onClick={() => setSelected((s) => (s.length === shown.length ? [] : shown.map((t) => t.key)))}>{selected.length === shown.length ? 'Untick all' : 'Tick all'}</button>
          </div>
        )}
        {selected.length > 0 && (
          <div className="w2a-ib-bulk" role="toolbar" aria-label={`${plural(selected.length, 'task')} ticked`}>
            <span className="w2a-ib-bulk-count">{plural(selected.length, 'task')} ticked</span>
            <button type="button" className="btn pri" disabled={!canEdit} title="Set the day on every ticked task" onClick={(e) => openMenu(e.currentTarget, bulkDayItems())}>Day…</button>
            <button type="button" className="btn" disabled={!canEdit} title="Set who does every ticked task" onClick={() => void bulkWho()}>Who…</button>
            <button type="button" className="btn" disabled={!canEdit} title="Tick every ticked task done" onClick={() => void bulkDone()}>Done</button>
            <button type="button" className="btn quiet" onClick={() => setSelected([])}>Clear</button>
          </div>
        )}

        {/* The task the pointer or the keys are on: its detail (its note, its project, its people) stands beside
            the list on a wide window (components/ListDetail.tsx), so three short groups never leave a cavern. */}
        <ListDetail
                rows={shown.length}

          label="The task chosen"
          detail={(() => {
            const t = shown.find((x) => x.key === picked) ?? shown[0];
            return t ? <RecordDetail refTo={{ type: 'action', path: t.path, line: t.line }} /> : null;
          })()}
          list={
        <div
          ref={list}
          onKeyDown={onKeyDown}
          aria-label="Tasks"
          style={{ marginTop: 14 }}
          onMouseOver={(e) => {
            const at = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
            if (at && at !== picked) setPicked(at);
          }}
          onFocus={(e) => {
            const at = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
            if (at) setPicked(at);
          }}
        >
          <EditorContext.Provider value={taskEditor}>
            {!shown.length &&
              (data.tasks.length ? (
                <TasksEmpty ownership={ownership} whenGroup={whenGroup} filter={filter} filtered={filtered} undated={ownEntries.filter((x) => !x.t.done && x.info.group === 'none').length} onShowUndated={() => setWhenGroup('none')} onClear={() => { setFilter({ ...DEFAULT_FILTER }); setWhenGroup('any'); }} />
              ) : (
                <EmptyState size="panel" icon="task" title="No tasks yet" line="Type - [ ] at the start of a line in any note for a task, then set its day here." action={canEdit ? { label: 'New task', icon: 'plus', run: newTask } : undefined} />
              ))}
            {groups.map((g) => (
              <div key={g.id ?? 'all'} className="card tklist tk-bulk" style={{ padding: '8px 20px', marginBottom: 12 }} aria-label={g.id ? GROUP_WORDS[g.id] : 'Tasks'}>
                {g.id && <div className="glabel" style={{ paddingTop: 8 }}>{GROUP_WORDS[g.id]} · {g.total}</div>}
                {(g.id === 'none' ? g.items.slice(0, 10) : g.items).map((t) => (
                  <TaskRow key={t.key} task={t} info={infoOf.get(t.key)} today={today} canEdit={canEdit} done={ticked.get(t.key) ?? t.done} selected={selected.includes(t.key)} onSelect={() => setSelected((s) => toggleSelected(s, t.key))} onTick={tick} onEdit={editRest} onMenu={openRowMenu} people={people} onWhoEdit={saveWho} onWhenEdit={(t, iso) => setDue(t, iso)} me={me} />
                ))}
                {/* No date folds by project after the first 10 (29 Oct 2026, REDESIGN Job A). */}
                {g.id === 'none' && g.items.length > 10 &&
                  groupNoDate(g.items.slice(10)).map((pg) => (
                    <details key={pg.name} className="tk-nodate-fold">
                      <summary>
                        {pg.name} · {pg.items.length} with no date
                      </summary>
                      {pg.items.map((t) => (
                        <TaskRow key={t.key} task={t} info={infoOf.get(t.key)} today={today} canEdit={canEdit} done={ticked.get(t.key) ?? t.done} selected={selected.includes(t.key)} onSelect={() => setSelected((s) => toggleSelected(s, t.key))} onTick={tick} onEdit={editRest} onMenu={openRowMenu} people={people} onWhoEdit={saveWho} onWhenEdit={(t, iso) => setDue(t, iso)} me={me} />
                      ))}
                    </details>
                  ))}
              </div>
            ))}
            {shownEntries.length > drawnCount && (
              <div className="w2b-more">
                <button type="button" className="btn quiet" onClick={() => setShownCount((n) => n + 100)}>
                  Show more ({shownEntries.length - drawnCount} left)
                </button>
              </div>
            )}
          </EditorContext.Provider>
        </div>
          }
        />
      </div>
      </div>
    </>
  );
}

/** A day typed as people write it (24 Oct, tomorrow, Fri 24 Oct), as YYYY-MM-DD. */
function dayOf(typed: string, today: string): string | null {
  const [y, m, d] = today.split('-').map(Number);
  const r = readDay(typed, new Date(y, m - 1, d));
  return r ? `${r.year}-${String(r.month + 1).padStart(2, '0')}-${String(r.day).padStart(2, '0')}` : null;
}

interface RowProps {
  task: VaultTask;
  info?: TaskInfo;
  /** Who "me" is: your own name never shows on your own rows (visibleWho). */
  me?: string | null;
  today: string;
  canEdit: boolean;
  done: boolean;
  /** Ticked for a bulk change (the list only): the row renders its select box when onSelect is set. */
  selected?: boolean;
  onSelect?(t: VaultTask): void;
  people: Suggestion[];
  onTick(t: VaultTask, done: boolean): void;
  onEdit(t: VaultTask, rest: string, oldRest: string, words: string): Promise<boolean>;
  onMenu(t: VaultTask, anchor: HTMLElement): void;
  onWhoEdit(t: VaultTask, name: string): Promise<boolean>;
  onWhenEdit(t: VaultTask, iso: string | null): void;
}

/** Whether an event came from inside an open field (its row must not open or menu from it). */
// A field is a field (12 Nov 2026): a click on an editable value waits for its double-click, never opens the row
// (since t239 a row's click leaves the page, so the first click of a double-click took the editor away).
const fromField = (e: React.MouseEvent | React.SyntheticEvent) => !!((e.target as Element).closest?.('input, textarea, select, .pj-ed, .pj-ed-input, .pj-suggest, .pj-date-input'));

/** A row's title changed where shown (double-click, pencil or E): the owner tail, day, marks and tags stay. */
function RowTitle({ t, children, canEdit, onEdit }: { t: VaultTask; children: ReactNode; canEdit: boolean; onEdit: RowProps['onEdit'] }) {
  const rest = taskEditableRest(`- [ ] ${t.text}`) ?? t.words;
  const { title, tail } = splitTaskRest(rest);
  if (!canEdit) return <>{children}</>;
  return (
    <Inline value={title} label="words" required onSave={(v) => onEdit(t, `${v}${tail}`, rest, 'Changed the words.')}>
      {children}
    </Inline>
  );
}

/** A click opens the task in the peek with what it's joined to; its arrow (or Ctrl+click) opens its note. */
function useLook(task: VaultTask, words: string) {
  const open = () => A.openAtLine(task.path, task.line);
  const look = (e?: React.MouseEvent | React.KeyboardEvent) => (e && (e.ctrlKey || e.metaKey) ? open() : peek({ type: 'action', path: task.path, line: task.line }, { title: words, type: 'action' }));
  return { open, look };
}

/** One row of the list: box, words, who, when — the one task grid (D still sets the day). Its title never
 *  carries its owner (29 Oct 2026, ITEMS 3): taskInfo split it with ownerOf, and who shows it. Who and when change
 *  on the row, by the same gesture as the words (p17-editable, Nov 2026); the menu keeps the rest (a time, a reminder). */
function TaskRow({ task: t, info, today, canEdit, done, selected, onSelect, people, onTick, onEdit, onMenu, onWhoEdit, onWhenEdit, me }: RowProps) {
  const words = info?.title ?? plainWords(t.words);
  const group = info?.group ?? 'none';
  const when = t.due ? `${dueDayWords(t.due, today)}${t.time ? ` ${t.time}` : ''}` : '';
  const { look } = useLook(t, words);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const tag = taskDueTag(t.due, t.time, today, t.reminder);
  const tone = !tag ? null : done ? 'quiet' : whenTone(info?.offset ?? null);
  const where = noteTitleWords(t.title);
  const said = saidWhen(when);
  return (
    <div
      className={`trow tkrow tk-row${done ? ' is-done' : ''} is-${group}`}
      role="button"
      tabIndex={0}
      data-key={t.key}
      aria-label={`${words}${said ? `, ${said}` : ''}${done ? ', done' : ''}, in ${where}`}
      onClick={(e) => (fromField(e) ? undefined : look(e))}
      onContextMenu={(e) => (fromField(e) ? undefined : (e.preventDefault(), onMenu(t, e.currentTarget)))}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          look(e);
        }
      }}
    >
      {/* The bulk tick (5 Nov 2026, the Inbox's words): beside the done box, never instead of it. A field, so
          the row neither opens nor menus from it. */}
      {onSelect && <input type="checkbox" className="tk-select" checked={!!selected} onChange={() => onSelect(t)} aria-label={`Tick “${words}” to act on it with others`} title="Tick to act on it with others" />}
      <button className={`check${done ? ' done' : ''}`} role="checkbox" aria-checked={done} aria-label={done ? `Mark “${words}” not done` : `Mark “${words}” done`} title={done ? 'Not done' : t.repeats ? 'Done (it comes back next time)' : 'Done'} disabled={!canEdit} onClick={(e) => (stop(e), onTick(t, !done))} onKeyDown={stop}>
        {done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className={`tkrow-title${done ? ' is-done' : ''}`}>
        <span className="clip-2" title={words} onClick={stop}>
          <RowTitle t={t} canEdit={canEdit} onEdit={onEdit}>
            {t.priority && (t.priority === 'high' || t.priority === 'highest') && <span className="tag red" style={{ marginRight: 8 }} title="High priority">! high</span>}
            {words}
          </RowTitle>
        </span>
        {/* The source reads faint through its class (t208, 11 Nov 2026: an inline inherit read the title's ink instead).
            One task, one row (t238): written in two places, both read here, never a second row. */}
        {(t.sources ?? []).length > 1 ? (
          <span className="tkrow-sub" title={t.sources!.map((s) => s.label).join(' · ')}>{t.sources!.map((s) => s.label).join(' · ')}</span>
        ) : t.project && t.projectName ? (
          <button type="button" className="tkrow-sub" style={{ border: 0, background: 'none', padding: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={(e) => (stop(e), peek({ type: 'project', path: t.project! }, { title: t.projectName!, type: 'project' }))} title={`Open ${t.projectName}`}>
            {t.projectName}
          </button>
        ) : (
          <span className="tkrow-sub" title={t.projectName || where}>{t.projectName || where}</span>
        )}
      </span>
      <span className="tkrow-who">
        {canEdit ? (
          <Inline value={info?.owner ?? ''} quiet placeholder="+ Who" label="Who does it" suggest={people} compact onSave={(v) => onWhoEdit(t, v)}>
            {/* Your own name never heads your own rows: the same visibleWho rule as Today and Your next (critic look N9). */}
            <WhoInner name={visibleWho(info?.owner, me) || undefined} />
          </Inline>
        ) : (
          <WhoCell name={visibleWho(info?.owner, me) || undefined} />
        )}
      </span>
      <span className="tkrow-when">
        {canEdit && !t.reminder ? (
          <InlineDate value={t.due ?? ''} iso quiet placeholder="+ Day" label="Day" onSave={(v) => onWhenEdit(t, v || null)}>
            <WhenInner words={tag?.words ?? null} tone={tone} title={when || undefined} />
          </InlineDate>
        ) : (
          <WhenCell words={tag?.words ?? null} tone={tone} title={when || undefined} onSelect={tag && !done ? (e) => (stop(e), onMenu(t, e.currentTarget as HTMLElement)) : undefined} />
        )}
      </span>
    </div>
  );
}
