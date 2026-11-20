// The day's dated tasks in the former host app's bell (8.0 TR8 4a, decided 28 Oct 2026 for everyone: once, on the due
// day, one line a day listing that day's tasks, never a notice each). A reminder (⏰) is said at its own moment by the
// reminders (src/main/reminders.ts); a task with only a day ("📅 2026-10-30", "due:: 2026-10-30") never reached the
// bell at all. Checked when the vault opens and every few minutes after; the day it was said is kept in Ironleaf's own
// data, so a restart says nothing twice. Tasks in Private notes never show.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { isoOf } from '../shared/finance';
import { isPrivatePath } from '../shared/private';
import type { VaultTask } from '../shared/tasks';

const CHECK_MS = 5 * 60_000;
/** Not before this hour of the day (the person's morning), so the line comes with the day, not at midnight. */
const FROM_HOUR = 7;

export interface DueTodayHost {
  tasks(): { today: string; tasks: VaultTask[] };
  /** The former host app's bell (host.notices.add); absent outside the former host app. */
  add?(notice: { kind: 'reminder'; title: string; body: string; note: string; line: number; due: number; missed: boolean }): unknown;
  /** This bell too (3 Nov 2026): the line is kept here the same way, so both bells count it. */
  keep?(notice: { kind: string; title: string; body: string; note: string; line: number }): unknown;
  /** Where the day it was said is kept. */
  file: string;
  now?(): number;
  log?(message: string): void;
}

/** The day's line: how many tasks are due today and what they are (the first few, with their project). */
export function dueTodayWords(tasks: Pick<VaultTask, 'words' | 'projectName' | 'title'>[]): { title: string; body: string } {
  const named = tasks.map((t) => (t.projectName ? `${t.words} (${t.projectName})` : t.words));
  const shown = named.slice(0, 4).join(' · ');
  return { title: tasks.length === 1 ? 'Due today: 1 task' : `Due today: ${tasks.length} tasks`, body: shown + (named.length > 4 ? ` · and ${named.length - 4} more` : '') };
}

/** The open tasks due today with a day only (a reminder says itself), never in Private notes. */
export function dueTodayTasks(view: { today: string; tasks: VaultTask[] }): VaultTask[] {
  return view.tasks.filter((t) => !t.done && !t.reminder && t.due === view.today && !isPrivatePath(t.path));
}

export class DueToday {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private host: DueTodayHost) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer || !this.host.add) return;
    this.timer = setInterval(() => void this.check().catch(() => {}), CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Says today's line once; true when it said it. */
  async check(): Promise<boolean> {
    if (!this.host.add) return false;
    const now = this.now();
    if (new Date(now).getHours() < FROM_HOUR) return false;
    const today = isoOf(new Date(now));
    let said = '';
    try {
      said = String(JSON.parse(await fsp.readFile(this.host.file, 'utf8'))?.day ?? '');
    } catch (err) {
      // Missing is a first run; unreadable is kept beside it as evidence, then a fresh day-file (Nov 2026 audit:
      // a corrupt file said again with nothing kept).
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.host.log?.(`Due today: the day-file could not be read (${err instanceof Error ? err.message : String(err)}). It is kept as evidence.`);
        await fsp.rename(this.host.file, `${this.host.file}.corrupt-${Date.now()}`).catch(() => {});
      }
      said = '';
    }
    if (said === today) return false;
    const view = this.host.tasks();
    if (view.today !== today) return false;
    const due = dueTodayTasks(view);
    await fsp.mkdir(path.dirname(this.host.file), { recursive: true });
    if (!due.length) {
      await fsp.writeFile(this.host.file, JSON.stringify({ day: today }));
      return false;
    }
    const { title, body } = dueTodayWords(due);
    const start = new Date(now);
    start.setHours(FROM_HOUR, 0, 0, 0);
    try {
      this.host.add({ kind: 'reminder', title, body, note: due[0].path, line: due[0].line, due: start.getTime(), missed: false });
      this.host.keep?.({ kind: 'reminder', title, body, note: due[0].path, line: due[0].line });
    } catch (e) {
      // Not taken: nothing marked said, so the next check tries again (Nov 2026 audit: it read as said, lost).
      this.host.log?.(`Due today: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    await fsp.writeFile(this.host.file, JSON.stringify({ day: today }));
    return true;
  }
}
