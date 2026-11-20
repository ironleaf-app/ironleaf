// Tasks across the notes, on the main side (21 Oct 2026, gap G24; src/shared/tasks.ts says what a task is). The list is
// gathered from the index — every note's words are already in memory — and kept until a note changes, so the Tasks view
// opens and filters at once however big the notes are. Ticking a task, setting its day or making it a reminder writes the
// note through the same write every save uses (indexed, shown in open tabs, kept in file recovery).

import type { VaultIndex } from './indexer';
import { inFolder } from '../shared/paths';
import { parseReminderLine, rollReminder, setTicked } from '../shared/reminders';
import { gatherTasks, isPersonNote, knownPeople, locateAnyTask, parseTaskLine, setTaskDue, setTaskRest, taskFacets, taskToReminder, type TaskFacets, type VaultTask } from '../shared/tasks';
import { isMeetingNote } from '../shared/meetings';
import { isIsoDay, isoOf } from '../shared/hub';
import { splitLineIdentity } from '../shared/one-task';
import { mergeGroups, sourceKindOf, sourceOf, type MergeRow } from '../shared/unified-tasks';
import { cascadeForLine, isDormantOwned, keptProjectContents, projectLive } from './one-task';

export interface TasksHost {
  index: VaultIndex;
  /** Settings › General › Templates folder: its notes are templates, never the person's work. */
  templatesFolder(): string;
  /** Writes a note as every save does. */
  write(rel: string, text: string): Promise<void>;
  now?(): number;
}

export interface TasksView {
  /** Today, YYYY-MM-DD (the window's "today" is the PC's). */
  today: string;
  tasks: VaultTask[];
  facets: TaskFacets;
  /** People the vault knows (5 Nov 2026, u3 moving-in: the one owner confidence, as DueView.known). */
  known: string[];
}

export class TasksService {
  private cache: { generation: number; templates: string; day: string; view: TasksView } | null = null;

  constructor(private host: TasksHost) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private skip(path: string): boolean {
    return inFolder(path, this.host.templatesFolder() || '') || this.host.index.isExcluded(path);
  }

  /** Every task in the notes (open and done) with what the filters offer. */
  view(): TasksView {
    const index = this.host.index;
    const generation = index.generation();
    const templates = this.host.templatesFolder() || '';
    const today = isoOf(this.now());
    if (this.cache && this.cache.generation === generation && this.cache.templates === templates && this.cache.day === today) return this.cache.view;
    const owner = index.relations().owner;
    const notes = index
      .allMeta()
      .filter((m) => !this.skip(m.path))
      .map((m) => ({ path: m.path, title: m.label || m.title, content: index.content(m.path) ?? '', mtime: m.mtime, tags: m.tags, props: m.props }));
    const gathered = gatherTasks(notes, {
      resolve: (target, from) => index.resolve(target, from),
      projectOf: (path) => owner.get(path) ?? null,
      projectName: (path) => {
        const m = index.get(path);
        return m ? m.label || m.title : null;
      },
      isPerson: (path) => isPersonNote(path, index.get(path)?.props),
      ref: new Date(this.now()),
    });
    // One Task, one row (t238): rows that are the same task merge into one, carrying every source — shown as
    // small words under the row, never hidden, never a second copy. Done lines and reminders row as themselves; a
    // line of no project folds against the live projects' rows (a daily copy never rows beside its task). Dormant
    // (finished or shelved) projects row nowhere in Tasks — their page still shows them. The merged row ticks
    // through its primary home; the cascade (tick below) writes the rest, so one tick closes the one thing.
    const ref = new Date(this.now());
    const live = projectLive(index);
    const listed = gathered.filter((t) => !isDormantOwned(t.project, live));
    const meetingOf = new Map(notes.map((n) => [n.path, isMeetingNote(n.path, n.props ?? {})]));
    const rows: MergeRow[] = listed.map((t, n) => ({
      words: t.words,
      text: t.text,
      owner: splitLineIdentity(t.words, ref).owner,
      due: t.due,
      done: t.done,
      ...(t.reminder ? { reminder: true as const } : {}),
      project: t.project,
      projectName: t.projectName,
      home: { path: t.path, line: t.line },
      source: sourceOf(sourceKindOf(t.path, t.project, meetingOf.get(t.path) ? 'meeting' : t.type), t.path, t.title),
      n,
    }));
    const tasks = mergeGroups(rows, ref).map((g) => {
      const members = g.map((m) => ({ row: listed[m.n ?? 0], source: m.source }));
      // The project's own row leads (it is the row a tick writes first); the rest keep their order.
      members.sort((a, b) => Number(b.row.path === b.row.project) - Number(a.row.path === a.row.project));
      const prim = members[0];
      const seen = new Set<string>();
      const sources = members.map((m) => m.source).filter((s) => (seen.has(`${s.kind}\n${s.path}`) ? false : (seen.add(`${s.kind}\n${s.path}`), true)));
      const dues = members.map((m) => m.row).filter((r) => r.due).sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0));
      const earliest = dues[0];
      return { ...prim.row, ...(earliest && earliest.due !== prim.row.due ? { due: earliest.due, time: earliest.time } : {}), sources };
    });
    const nameOf = (path: string) => {
      const m = index.get(path);
      return m ? m.label || m.title : path.split('/').pop()!.replace(/\.md$/i, '');
    };
    // Project texts from the one kept map (p18-big-vault: read once a generation, shared with Today); meetings
    // and the rest read as before.
    const kept = keptProjectContents(index);
    const view: TasksView = { today, tasks, facets: taskFacets(tasks, today, nameOf), known: knownPeople(index.allMeta(), (p) => kept.get(p) ?? index.content(p)) };
    this.cache = { generation, templates, day: today, view };
    return view;
  }

  /** The line a task is on now (where it was, else the nearest line with the same words), with the note's lines. */
  private locate(path: string, line: number, text: string): { content: string; lines: string[]; n: number; eol: string } {
    if (!Number.isInteger(line)) throw new Error('Which task?');
    const content = this.host.index.content(path);
    if (content === undefined) throw new Error('That note isn’t in your notes any more.');
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const n = locateAnyTask(lines, line, text);
    if (n < 0) throw new Error('That task isn’t in its note any more. It may have been changed or moved.');
    return { content, lines, n, eol };
  }

  private async replace(path: string, at: { lines: string[]; n: number; eol: string }, next: string): Promise<void> {
    if (next === at.lines[at.n]) return;
    at.lines[at.n] = next;
    await this.host.write(path, at.lines.join(at.eol));
  }

  /** A task ticked (or unticked, for Undo) in its note. A repeating reminder ticked moves on to its next time instead.
   *  One task, one row: a plain tick also sets its matching steps and lines in its project (one change: Undo takes
   *  them all back). */
  async tick(path: string, line: number, text: string, done: boolean): Promise<{ words: string; line: string }> {
    const at = this.locate(path, line, text);
    const old = at.lines[at.n];
    let next: string;
    const reminder = parseReminderLine(old);
    if (done && reminder?.repeat) next = rollReminder(old, this.now()) ?? setTicked(old, true);
    else if (!done && !/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/.test(old)) next = old.replace(/\[[^\]]\]/, '[ ]');
    else next = setTicked(old, done);
    // The relations before the write (p18-big-vault, as Today's tick): the write drops them, and the cascade
    // re-deriving them from every note is what a tick cost on a big vault.
    const rels = reminder ? null : this.host.index.relations();
    await this.replace(path, at, next);
    if (!reminder) {
      const parsed = parseTaskLine(next, new Date(this.now()));
      const cascade = cascadeForLine(this.host.index, (p) => this.skip(p), { path, line: at.n }, parsed?.words || text, done, new Date(this.now()), rels);
      if (cascade.project) await this.host.write(cascade.project.path, cascade.project.after);
      for (const f of cascade.notes) await this.host.write(f.path, f.after);
    }
    return { words: done ? (reminder?.repeat ? 'Done. It comes back next time.' : 'Done.') : 'Not done.', line: next };
  }

  /** A task's due day set (or taken off) in the one plain way: "📅 2026-10-24", with a time when given. */
  async setDue(path: string, line: number, text: string, iso: string | null, time: string | null): Promise<string> {
    if (iso && !isIsoDay(iso)) throw new Error('That isn’t a real day.');
    const at = this.locate(path, line, text);
    const old = at.lines[at.n];
    if (parseReminderLine(old)) throw new Error('That task is a reminder: change its time from the reminder.');
    await this.replace(path, at, setTaskDue(old, iso, time));
    return iso ? 'Due day set.' : 'Due day taken off.';
  }

  /** A task's words changed where shown (its title, owner or both): the box, day, marks and tags stay as they were. */
  async edit(path: string, line: number, text: string, rest: string): Promise<{ words: string; line: string }> {
    const at = this.locate(path, line, text);
    const old = at.lines[at.n];
    const next = setTaskRest(old, rest, new Date(this.now()));
    if (next === old) throw new Error('That change keeps nothing to show. Give it some words.');
    await this.replace(path, at, next);
    return { words: 'Changed.', line: next };
  }

  /** A task with a day made a reminder at its time (9:00 am when it has none). */
  async remind(path: string, line: number, text: string): Promise<string> {
    const at = this.locate(path, line, text);
    const old = at.lines[at.n];
    const parsed = parseTaskLine(old, new Date(this.now()));
    if (parsed?.reminder) throw new Error('That task is already a reminder.');
    const next = taskToReminder(old, new Date(this.now()));
    if (!next || !parsed) throw new Error('Give the task a day first, then it can remind you.');
    await this.replace(path, at, next);
    return parsed.time ? `You’ll be reminded at ${parsed.time} on its day.` : 'You’ll be reminded at 9:00 am on its day (no time was written).';
  }
}
