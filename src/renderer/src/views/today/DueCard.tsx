// Due on Today (20 Oct 2026, "Ironleaf Calm"; it grew from 5.0.0's Reminders card): every reminder and every open task
// line ("- [ ] …") in the notes, by Overdue, Today and the Next 7 days, and the tasks with no day folded away at the
// bottom. Each line opens its note at its line; the box ticks it in the note itself (a task through the note's own save,
// with Undo; a reminder as the Reminders card did, a repeating one moving on); a reminder snoozes. A project's own next
// steps are listed by the project lists below, with their Undo, so they aren't here twice.
//
// Another day chosen in the strip: what is due that day.

import { useMemo, useState } from 'react';
import { daysApart, dueDayWords, isoOf, readTaskDue, type DueEntry, type DueTask } from '../../../../shared/hub';
import { doneWords } from '../../../../shared/tasks';
import { isOwnText } from '../../../../shared/today-count';
import { dueOwnerText } from '../../components/plan/plan';
import { pillWords, snoozedKey, snoozeTimes, timeWords, type ReminderItem } from '../../../../shared/reminders';
import { splitTitleOwner, visibleWho, whenTone } from '../../components/plan/plan';
import { WhenCell, WhenInner, WhoCell } from '../../components/plan/TaskCells';
import type { DueView } from '../../../../main/hub';
import { Icon, type IconName } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import * as A from '../../state/actions';
import { showError, toast, useApp } from '../../state/store';
import { EditorContext, InlineDate } from '../project/Inline';
import { typeIcon } from './DayParts';

/** Lines shown in a group before "Show all". */
const SHOWN = 6;

/** Two ISO days compared (they read in order as written). */
const cmpDay = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Group = 'overdue' | 'today' | 'week' | 'day' | 'stale';

export function useTicks(onChanged: () => void) {
  const canEdit = useApp((s) => s.canEdit);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const mark = (key: string, on: boolean) =>
    setTicked((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const tickTask = (t: DueTask) => {
    mark(t.key, true);
    void window.nv.hub.tick(t.path, t.line, t.text, true).then(
      () =>
        toast(doneWords(t.words), {
          label: 'Undo',
          run: () =>
            void window.nv.hub.tick(t.path, t.line, t.text, false).then(() => {
              mark(t.key, false);
              onChanged();
            }, showError),
        }),
      (e) => {
        mark(t.key, false);
        showError(e);
      },
    );
  };
  const tickReminder = (r: ReminderItem) => {
    mark(r.key, true);
    void window.nv.reminders.done(r.key).then(
      (words) => {
        // A repeating one moved on to its next time: nothing to undo, as on the Tasks page.
        if (r.repeat) return toast(words);
        toast(words, {
          label: 'Undo',
          run: () =>
            void window.nv.reminders.untick(r.key).then(() => {
              mark(r.key, false);
              onChanged();
            }, showError),
        });
      },
      (e) => {
        mark(r.key, false);
        showError(e);
      },
    );
  };
  const snooze = (e: React.MouseEvent<HTMLElement>, r: ReminderItem) =>
    openMenu(e.currentTarget, [
      { heading: 'Remind me again' },
      // The moment is worked out when picked, not when the menu opened (fnv3 F43), and a snooze can be
      // undone back to the time it had (fnv3 F46).
      ...snoozeTimes(Date.now()).map((t, i) => ({
        label: t.label === '10 minutes' || t.label === '1 hour' ? `In ${t.label}` : t.label,
        icon: 'clock' as const,
        disabled: !canEdit,
        run: () => {
          const until = snoozeTimes(Date.now())[i].at;
          void window.nv.reminders.snooze(r.key, until).then((words) => toast(words, { label: 'Undo', run: () => void window.nv.reminders.snooze(snoozedKey(r.key, until), r.due).then(() => onChanged(), showError) }), showError);
        },
      })),
    ]);
  return { canEdit, ticked, tickTask, tickReminder, snooze };
}

// A field is a field (12 Nov 2026): a click on an editable value waits for its double-click, never opens the row
// (since t239 a row's click leaves the page, so the first click of a double-click took the editor away).
const fromField = (e: React.MouseEvent | React.SyntheticEvent) => !!((e.target as Element).closest?.('input, textarea, select, .pj-ed, .pj-ed-input, .pj-suggest, .pj-date-input'));

export function DueRow({ entry, group, now, ticks, me }: { entry: DueEntry; group: Group; now: number; ticks: ReturnType<typeof useTicks>; me?: string | null }) {
  const today = isoOf(now);
  const isDone = ticks.ticked.has(entry.key) || (entry.kind === 'reminder' && entry.item.done);
  const raw = entry.kind === 'reminder' ? entry.item.text || entry.item.title : entry.item.words;
  // An owner written in the words shows in who (display only); the stored line stays as written.
  const split = entry.kind === 'task' ? splitTitleOwner(raw) : null;
  const words = split ? split.title : raw;
  const title = entry.item.title;
  // A task's day changed here (Nov 2026, "everything is editable where shown"), through the Tasks page's own
  // write; a reminder's day still moves from its Snooze. A written time rides along, never dropped.
  const [day, setDay] = useState<string | null | undefined>(undefined);
  const effDay = entry.kind === 'task' ? (day === undefined ? entry.day : day) : null;
  const editor = useMemo(() => ({ path: entry.item.path, canEdit: ticks.canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [entry.item.path, ticks.canEdit]);
  const saveDay = async (v: string): Promise<boolean> => {
    if (entry.kind !== 'task') return false;
    try {
      const keep = v ? (readTaskDue(entry.item.text, new Date(now)).time ?? null) : null;
      const said = await window.nv.tasks.setDue(entry.item.path, entry.item.line, entry.item.text, v || null, keep);
      setDay(v || null);
      toast(said);
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  };
  // A late task says how late ("49 days late"), as the project rows do — the day alone ("Wed 16 Sep") hides
  // why it answers first (round 4: the one list's top row is a note's line).
  const lateDays = entry.kind === 'task' && group === 'overdue' && effDay ? daysApart(effDay, today) : 0;
  const when =
    entry.kind === 'reminder'
      ? group === 'today' || group === 'day'
        ? timeWords(entry.item.due)
        : pillWords(entry.item.due, now)
      : group === 'today' || group === 'day' || !effDay
        ? ''
        : lateDays > 0
          ? lateDays === 1
            ? '1 day late'
            : `${lateDays} days late`
          : dueDayWords(effDay, today);
  // Late and today read coral, the week ahead quiet; a reminder's own day decides, not its group.
  const offset = entry.kind === 'reminder' ? cmpDay(isoOf(entry.item.due), today) : effDay ? cmpDay(effDay, today) : group === 'overdue' ? -1 : group === 'today' ? 0 : 1;
  const open = () => A.openAtLine(entry.item.path, entry.item.line);
  const icon: IconName = entry.kind === 'task' ? typeIcon(entry.item.type) : 'clock';
  const whenWords = when || null;
  const whenToneValue = isDone ? (when ? 'quiet' : null) : when ? (group === 'stale' ? 'quiet' : whenTone(offset)) : null;
  const whenCell = <WhenCell words={whenWords} tone={whenToneValue} />;
  // One task row, whatever the source (t208, 11 Nov 2026, second look at real content: no rm-row — the record-row
  // past drew dividers, gaps and a wash on note rows beside bare step rows in the one list).
  return (
    <div
      className={`td-row tkrow th-due-row is-${group === 'week' ? 'upcoming' : group}${isDone ? ' is-done' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${words}${when ? `, ${when}` : ''}, in ${title}`}
      onClick={(e) => (fromField(e) ? undefined : open())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open();
      }}
    >
      <button
        className={`check${isDone ? ' done' : ''}`}
        role="checkbox"
        aria-checked={isDone}
        aria-label={`Mark “${words}” done`}
        title={entry.kind === 'reminder' && entry.item.repeat ? `Done (it comes back ${entry.item.repeat})` : 'Done'}
        disabled={!ticks.canEdit || isDone}
        onClick={(e) => {
          e.stopPropagation();
          if (entry.kind === 'reminder') ticks.tickReminder(entry.item);
          else ticks.tickTask(entry.item);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {isDone ? <Icon name="check" size={12} /> : null}
      </button>
      <span className="td-row-main">
        <span className="td-row-what">
          <span className="td-text" title={raw}>{words}</span>
        </span>
        <span className="td-row-sub">
          {/* The note's name clips without dots and reads whole on hover, as a due line's project name does
              (t200, 10 Nov 2026, judged on real long notes: "2026-10-21 Wiring quote walkt" clipped raw, past
              the …; t207 pass 2: no dots). One task, one row (t238): written in two places, both read here. */}
          <span className="th-due-note" title={entry.kind === 'task' && (entry.item.sources ?? []).length > 1 ? entry.item.sources!.map((s) => s.label).join(' · ') : title}>
            <Icon name={icon} size={11} />
            <span className="td-text" title={entry.kind === 'task' && (entry.item.sources ?? []).length > 1 ? entry.item.sources!.map((s) => s.label).join(' · ') : title}>{entry.kind === 'task' && (entry.item.sources ?? []).length > 1 ? entry.item.sources!.map((s) => s.label).join(' · ') : title}</span>
          </span>
          {entry.kind === 'reminder' && entry.item.repeat && (
            <span className="rm-repeat">
              <Icon name="refresh" size={11} /> {entry.item.repeat.replace(/^every/, 'Every')}
            </span>
          )}
        </span>
      </span>
      <WhoCell name={me === undefined ? split?.owner : visibleWho(split?.owner, me) || undefined} />
      {ticks.canEdit && entry.kind === 'task' && effDay ? (
        // The day's clicks belong to it (as a task row's title keeps its own): a double-click edits instead of
        // opening. The cell itself is the grid item (t208: the bare span sat its day top-aligned beside centred
        // ones — the same cell every other task row edits in).
        <span className="tkrow-when" onClick={(e) => e.stopPropagation()}>
          <EditorContext.Provider value={editor}>
            <InlineDate value={effDay} iso label="Day" onSave={saveDay}>
              <WhenInner words={whenWords} tone={whenToneValue} />
            </InlineDate>
          </EditorContext.Provider>
        </span>
      ) : (
        whenCell
      )}
      <span className="td-actions">
        {entry.kind === 'reminder' && (
          <button className="td-act" title="Snooze" aria-label="Snooze" aria-haspopup="menu" disabled={!ticks.canEdit || isDone} onClick={(e) => (e.stopPropagation(), ticks.snooze(e, entry.item))} onKeyDown={(e) => e.stopPropagation()}>
            <Icon name="clock" size={14} />
          </button>
        )}
        <button className="td-act" title={`Open ${title}`} aria-label={`Open ${title}`} onClick={(e) => (e.stopPropagation(), open())} onKeyDown={(e) => e.stopPropagation()}>
          <Icon name="forward" size={14} />
        </button>
      </span>
    </div>
  );
}

export function DueLines({ entries, group, now, ticks, limit = SHOWN, me }: { entries: DueEntry[]; group: Group; now: number; ticks: ReturnType<typeof useTicks>; limit?: number; me?: string | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, limit);
  return (
    <>
      {shown.map((e) => (
        <DueRow key={e.key} entry={e} group={group} now={now} ticks={ticks} me={me} />
      ))}
      {entries.length > limit && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
    </>
  );
}

/** Today's Due: Overdue, Today, Next 7 days, and No date (folded). The dated groups keep the person's own lines
 *  only (4 Nov 2026, p12-today-focus round 3: the card showed other people's lines while its count left them out);
 *  theirs sit under Waiting (DueOthers below). Tasks with no day stay as they were: no count ever covered them. */
export function DueCard({ view, me, onChanged }: { view: DueView | null; me: string | null | undefined; onChanged(): void }) {
  const ticks = useTicks(onChanged);
  const [undatedOpen, setUndatedOpen] = useState(false);
  if (!view) return null;
  const now = new Date(view.now);
  const own = (items: DueEntry[]) => items.filter((e) => isOwnText(dueOwnerText(e), me ?? null, now, view.known));
  const groups: { id: Exclude<Group, 'day'>; title: string; items: DueEntry[] }[] = [
    { id: 'overdue', title: 'Overdue', items: own(view.overdue) },
    { id: 'today', title: 'Today', items: own(view.today) },
    { id: 'week', title: 'Next 7 days', items: own(view.week) },
    { id: 'stale', title: 'From a while back', items: own(view.stale ?? []) },
  ];
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const undated: DueEntry[] = view.undated.map((t) => ({ kind: 'task', key: t.key, day: null, item: t }));
  return (
    <section className={`td-section tklist rm-card th-due${count ? '' : ' is-empty'}`} data-section="tasks" aria-labelledby="td-h-tasks">
      <header className="td-section-head">
        <h2 id="td-h-tasks">
          Due
          {count > 0 && <span className="td-count">{count}</span>}
        </h2>
        <span className="td-section-hint">Tasks and reminders in your notes</span>
        {/* Every task, done ones too, with filters (views/TasksView.tsx; 21 Oct 2026, gap G24). */}
        <button className="text-button th-all-tasks" onClick={() => A.openTasks()}>
          All tasks
        </button>
      </header>
      {count === 0 && (
        <p className="rm-empty">
          Nothing due this week. Tasks with a day gather here.
        </p>
      )}
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.id} className={`td-group rm-group ${g.id === 'week' ? 'upcoming' : g.id}`}>
            <h3>
              {g.title} <span>{g.items.length}</span>
            </h3>
            <DueLines entries={g.items} group={g.id} now={view.now} ticks={ticks} limit={g.id === 'week' ? 5 : SHOWN} me={me} />
          </div>
        ) : null,
      )}
      {view.undatedCount > 0 && (
        <div className={`td-group th-undated${undatedOpen ? ' is-open' : ''}`}>
          <button className="th-fold" aria-expanded={undatedOpen} onClick={() => setUndatedOpen(!undatedOpen)}>
            <Icon name={undatedOpen ? 'chevronDown' : 'chevron'} size={12} />
            No date <span>{view.undatedCount}</span>
          </button>
          {undatedOpen && (
            <>
              <DueLines entries={undated} group="day" now={view.now} ticks={ticks} limit={8} me={me} />
              {view.undatedCount > undated.length && <p className="td-none">And {view.undatedCount - undated.length} more in your notes.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Other people's lines from the notes, for the Waiting fold (round 3: the Due card keeps own lines only;
 *  round 4: their dated lines past the week and their lines with no day sit here too, so nothing of theirs mixes
 *  into the one list). Each row ticks and opens where it stands, as in Due; each group keeps its own day words. */
export function DueOthers({ overdue, today, week, later, undated, now, onChanged, me }: { overdue: DueEntry[]; today: DueEntry[]; week: DueEntry[]; later?: DueEntry[]; undated?: DueTask[]; now: number; onChanged(): void; me?: string | null }) {
  const ticks = useTicks(onChanged);
  const undatedEntries: DueEntry[] = (undated ?? []).map((t) => ({ kind: 'task', key: t.key, day: null, item: t }));
  if (!overdue.length && !today.length && !week.length && !(later ?? []).length && !undatedEntries.length) return null;
  return (
    <>
      {overdue.length > 0 && <DueLines entries={overdue} group="overdue" now={now} ticks={ticks} me={me} />}
      {today.length > 0 && <DueLines entries={today} group="today" now={now} ticks={ticks} me={me} />}
      {week.length > 0 && <DueLines entries={week} group="week" now={now} ticks={ticks} limit={5} me={me} />}
      {(later ?? []).length > 0 && <DueLines entries={later ?? []} group="week" now={now} ticks={ticks} limit={5} me={me} />}
      {undatedEntries.length > 0 && <DueLines entries={undatedEntries} group="day" now={now} ticks={ticks} limit={8} me={me} />}
    </>
  );
}

/** Another day's Due: its reminders and dated tasks. */
export function DueOnDay({ entries, words, onChanged }: { entries: DueEntry[] | null; words: string; onChanged(): void }) {
  const ticks = useTicks(onChanged);
  if (!entries) return null;
  return (
    <section className="td-section tklist rm-card th-due" data-section="tasks" aria-labelledby="td-h-tasks">
      <header className="td-section-head">
        <h2 id="td-h-tasks">
          Due {words}
          {entries.length > 0 && <span className="td-count">{entries.length}</span>}
        </h2>
      </header>
      {entries.length ? <DueLines entries={entries} group="day" now={Date.now()} ticks={ticks} /> : <p className="rm-empty">Nothing due {words}. Tasks and reminders for that day gather here.</p>}
    </section>
  );
}
