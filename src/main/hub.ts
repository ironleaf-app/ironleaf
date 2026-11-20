// Today as the hub, on the main side (20 Oct 2026, "Ironleaf Calm"; src/shared/hub.ts says what it shows). Everything
// comes from the index — each note's open task lines and the days it mentions are read when the note is indexed — so
// moving through days, the strip's dots and the Due list never read the disk, however big the notes are. A tick is
// written into the note through the same write every save uses (indexed, shown in open tabs, kept in file recovery).

import type { VaultIndex } from './indexer';
import { addDays, buildDay, buildMarks, dateOf, dueOn, groupDue, isIsoDay, isoOf, locateTask, meetingDay, taskDue, taskKey, type DayMark, type DueEntry, type DueGroups, type DueTask, type HubDay } from '../shared/hub';
import { isNearKey, isSameKey, lineKeyOf, splitLineIdentity } from '../shared/one-task';
import { isMeetingNote } from '../shared/meetings';
import { mergeGroups, sourceKindOf, sourceOf, type MergeRow } from '../shared/unified-tasks';
import { inFolder } from '../shared/paths';
import { isProjectProps } from '../shared/project-file';
import { knownPeople } from '../shared/tasks';
import { setTicked, type ReminderItem } from '../shared/reminders';
import { cascadeForLine, isDormantOwned, keptProjectContents, keptStepKeys, projectLive } from './one-task';

export interface HubHost {
  index: VaultIndex;
  /** The day's note's place (Settings › Daily notes). */
  dailyPath(day: Date): string;
  /** Settings › General › Templates folder: its notes are templates, never the person's work. */
  templatesFolder(): string;
  /** Every reminder in the notes (src/main/reminders.ts). */
  reminders(): ReminderItem[];
  /** Writes a note as every save does. */
  write(rel: string, text: string): Promise<void>;
  /** Makes a day's note from the daily template when it isn't there yet (and gives its place). */
  startDay(day: Date): Promise<string>;
  now?(): number;
  log?(message: string): void;
}

export interface DueView extends DueGroups {
  now: number;
  /** People the vault knows (5 Nov 2026, u3 moving-in: the one owner confidence — the window reads bare "— Name"
   *  tails against these; a stranger's mention is never debt). */
  known: string[];
}

/** The most days the strip asks about at once (a month's six weeks). */
const MAX_DAYS = 62;

export class Hub {
  /** The task list and each meeting's day, kept until the notes change (typing in the day's note saves every moment;
   *  the lists aren't worked out again for every save of a big library unless a note changed). */
  private cache: { generation: number; templates: string; day: string; tasks: DueTask[]; meetings: { path: string; day: string }[]; known: string[] } | null = null;

  constructor(private host: HubHost) {}

  private kept() {
    const generation = this.host.index.generation();
    const templates = this.host.templatesFolder() || '';
    const day = isoOf(this.now());
    if (this.cache && this.cache.generation === generation && this.cache.templates === templates && this.cache.day === day) return this.cache;
    const ref = new Date(this.now());
    const meetings: { path: string; day: string }[] = [];
    for (const m of this.host.index.allMeta()) {
      if (this.skipBase(m.path)) continue;
      const d = meetingDay(m, ref);
      if (!d) continue;
      // Today's meetings reach from kept-out folders too (8 Nov 2026, item 2); the rest stays out.
      if (this.host.index.isQuiet(m.path) && d !== day) continue;
      meetings.push({ path: m.path, day: d });
    }
    // Project texts from the one kept map (p18-big-vault: read once a generation, shared with Tasks); meetings
    // and the rest read as before.
    const kept = keptProjectContents(this.host.index);
    const known = knownPeople(this.host.index.allMeta(), (p) => kept.get(p) ?? this.host.index.content(p));
    this.cache = { generation, templates, day, tasks: this.readTasks(), meetings, known };
    return this.cache;
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private skipBase(path: string): boolean {
    return inFolder(path, this.host.templatesFolder() || '') || this.host.index.isExcluded(path);
  }

  private skip(path: string): boolean {
    return this.skipBase(path) || this.host.index.isQuiet(path);
  }

  private reminders(): ReminderItem[] {
    try {
      return this.host.reminders();
    } catch (err) {
      // Due without the reminders is better than no Due at all, but the gap is said (Nov 2026 audit: it went quiet).
      this.host.log?.('Ironleaf could not read its reminders for Due: ' + (err instanceof Error ? err.message : String(err)));
      return [];
    }
  }

  /** Every open task line in the notes, but a project's own steps (Today lists those from the project, with Undo) and
   *  templates' and left-out folders'. */
  tasks(): DueTask[] {
    return this.kept().tasks;
  }

  private readTasks(): DueTask[] {
    const ref = new Date(this.now());
    const today = isoOf(this.now());
    // One Task, one row (t238): lines that are the same task merge into one, carrying every source — shown as
    // small words under the row, never hidden, never a second copy. A line that is the same task as an open
    // step of its project stays out — the step is Today's row, shown from the project with Undo (Today's own
    // layout, and the step's source line, land in step 2). A note of no project folds its copies against the
    // live projects' open steps, so a daily copy never counts beside its task. Dormant (finished or shelved)
    // projects' notes count nowhere (5 Nov 2026 one list). The steps' keys are worked out once for the
    // generation and shared with Tasks (p18-big-vault); each line's identity once per line.
    const owner = this.host.index.relations().owner;
    const steps = keptStepKeys(this.host.index);
    const live = projectLive(this.host.index);
    const liveSteps = [...steps].filter(([p]) => live.get(p) !== false).flatMap(([, s]) => s);
    const cands: { task: DueTask; row: MergeRow }[] = [];
    for (const note of this.host.index.tasks()) {
      if (this.skipBase(note.path)) continue;
      const quiet = this.host.index.isQuiet(note.path);
      const meta = this.host.index.get(note.path);
      if (!meta || isProjectProps(meta.props)) continue;
      const type = typeof meta.props?.type === 'string' ? meta.props.type.toLowerCase().slice(0, 40) : undefined;
      const project = owner.get(note.path) ?? null;
      if (isDormantOwned(project, live)) continue;
      const projectSteps = project ? steps.get(project) ?? [] : liveSteps;
      const seen = new Map<string, number>();
      for (const t of note.items) {
        // Anything due today (overdue too) reaches from a kept-out folder (8 Nov 2026, item 2).
        if (quiet && !(t.due && t.due <= today)) continue;
        const occurrence = seen.get(t.text) ?? 0;
        seen.set(t.text, occurrence + 1);
        const words = taskDue(t.text, ref).words || t.text;
        if (projectSteps.length) {
          const key = lineKeyOf(words, ref);
          if (key && projectSteps.some((s) => isSameKey(s, key) || isNearKey(s, key))) continue;
        }
        const title = meta.label || meta.title;
        const meeting = isMeetingNote(note.path, meta.props ?? {});
        cands.push({
          task: { key: taskKey(note.path, t.text, occurrence), path: note.path, title, line: t.line, text: t.text, words, due: t.due, ...(type ? { type } : {}) },
          row: {
            words,
            text: t.text,
            owner: splitLineIdentity(words, ref).owner,
            due: t.due,
            done: false,
            project,
            projectName: null,
            home: { path: note.path, line: t.line },
            source: sourceOf(sourceKindOf(note.path, project, meeting ? 'meeting' : type), note.path, title),
          },
        });
      }
    }
    // Lines of no project merge against the projects' own rows only (the merge's rule): without step rows in
    // this list they never merge here — the fold above already kept them from doubling a step.
    return mergeGroups(cands.map((c, n) => ({ ...c.row, n })), ref).map((g) => {
      const members = g.map((m) => ({ task: cands[m.n ?? 0].task, source: m.source }));
      const prim = members[0];
      const seen = new Set<string>();
      const sources = members.map((m) => m.source).filter((s) => (seen.has(`${s.kind}\n${s.path}`) ? false : (seen.add(`${s.kind}\n${s.path}`), true)));
      const dues = members.map((m) => m.task.due).filter((d): d is string => !!d).sort();
      return { ...prim.task, ...(dues[0] && dues[0] !== prim.task.due ? { due: dues[0] } : {}), sources };
    });
  }

  /** The Due list: reminders and dated tasks by Overdue / Today / Next 7 days, and the tasks with no day. */
  due(): DueView {
    const now = this.now();
    return { now, known: this.kept().known, ...groupDue(this.tasks(), this.reminders(), now) };
  }

  /** What is due on another day. */
  dueOn(iso: string): DueEntry[] {
    if (!isIsoDay(iso)) return [];
    return dueOn(this.tasks(), this.reminders(), iso);
  }

  /** One day's hub. `opened` is the notes the person opened (their recent list): a pack's record lists in Made
   *  and Changed only when opened (5 Nov 2026, "your notes are yours"). The day's meetings reach from kept-out
   *  folders too (8 Nov 2026, item 2); the rest stays out. */
  day(iso: string, opened?: readonly string[]): HubDay {
    if (!isIsoDay(iso)) iso = isoOf(this.now());
    const index = this.host.index;
    const path = this.host.dailyPath(dateOf(iso));
    const exists = index.has(path);
    const ref = new Date(this.now());
    const meetingPaths = new Set<string>();
    for (const m of index.allMeta()) {
      if (this.skipBase(m.path)) continue;
      if (meetingDay({ path: m.path, props: m.props }, ref) === iso) meetingPaths.add(m.path);
    }
    const notes = index.allMeta().map((m) => ({ path: m.path, title: m.label || m.title, mtime: m.mtime, ...(m.born ? { born: m.born } : {}), props: m.props }));
    return buildDay({
      iso,
      max: 200,
      notes,
      dates: (p) => index.daysIn(p),
      daily: { path, exists },
      linkedToDaily: exists ? index.backlinks(path).map((b) => b.source) : [],
      skip: (p) => this.skipBase(p) || (index.isQuiet(p) && !meetingPaths.has(p)),
      ...(opened ? { opened } : {}),
      now: ref,
    });
  }

  /** The strip's dots for the days from `from` to `to` (a week, or a month's six weeks). */
  marks(from: string, to: string): Record<string, DayMark> {
    if (!isIsoDay(from) || !isIsoDay(to) || to < from) return {};
    const days: string[] = [];
    for (let d = from; d <= to && days.length < MAX_DAYS; d = addDays(d, 1)) days.push(d);
    const index = this.host.index;
    const kept = this.kept();
    const meetingDays = kept.meetings.filter((m) => m.day >= from && m.day <= to).map((m) => m.day);
    const dueDays = this.reminders()
      .filter((r) => !r.done)
      .map((r) => isoOf(r.due));
    for (const t of kept.tasks) if (t.due && t.due >= from && t.due <= to) dueDays.push(t.due);
    return buildMarks(days, { hasNote: (iso) => index.has(this.host.dailyPath(dateOf(iso))), meetingDays, dueDays });
  }

  /** A task ticked (or unticked, for Undo) from Today: the box in its line, written into the note — and, one task
   *  one row, its matching steps and lines in its project set the same (one change: Undo takes them all back). */
  async tick(path: string, line: number, text: string, done: boolean): Promise<string> {
    if (!Number.isInteger(line)) throw new Error('Which task?');
    const content = this.host.index.content(path);
    if (content === undefined) throw new Error('That note isn’t in your notes any more.');
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const n = locateTask(lines, line, text);
    if (n < 0) throw new Error('That task isn’t in its note any more.');
    const next = setTicked(lines[n], done);
    // The relations before the write (p18-big-vault): the write drops them, and the cascade re-deriving them from
    // every note is what a tick cost on a big vault. A ticked box moves no note between projects, so they still hold.
    const rels = this.host.index.relations();
    if (next !== lines[n]) {
      lines[n] = next;
      await this.host.write(path, lines.join(eol));
    }
    const words = taskDue(text, new Date(this.now())).words || text;
    const cascade = cascadeForLine(this.host.index, (p) => this.skip(p), { path, line: n }, words, done, new Date(this.now()), rels);
    if (cascade.project) await this.host.write(cascade.project.path, cascade.project.after);
    for (const f of cascade.notes) await this.host.write(f.path, f.after);
    return done ? 'Done.' : 'Not done.';
  }

  /** The day's note made on its first words (from the daily template), or found when it is there already. */
  start(iso: string): Promise<string> {
    if (!isIsoDay(iso)) throw new Error('Which day?');
    const d = dateOf(iso);
    const now = new Date(this.now());
    // Its template's {{time}} is the time now, on that day.
    return this.host.startDay(new Date(d.getFullYear(), d.getMonth(), d.getDate(), now.getHours(), now.getMinutes()));
  }
}
