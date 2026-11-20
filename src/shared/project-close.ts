// Closing a project with open tasks (p12-close-and-noise A, 4 Nov 2026: two projects were marked done with 12 open
// tasks nobody could answer for). Pure: the open tasks listed for the shared dialog (the project page's status
// control and the side panel), the quiet "N loose ends" line for a project already done, what a dropped task keeps
// (its line under Decisions with the date: nothing lost), and the plain words the assistant's tool answers with
// instead of closing silently. The dialog itself is views/project/CloseDialog.tsx; the tools guard in
// main/agent-access.ts (project_set_field) and main/agent-full.ts (project_archive).

import { isFinished } from './finished';
import type { Project, ProjectEdit } from './project-file';

/** An open task for the closing dialog: its place in What's next, and its words, owner and day. */
export interface LooseTask {
  index: number;
  what: string;
  who?: string;
  when?: string;
}

/** Every unticked step in What's next, in the project's order. */
export function openProjectTasks(p: Project): LooseTask[] {
  return p.next.flatMap((n, index) => (n.done ? [] : [{ index, what: n.what, ...(n.who ? { who: n.who } : {}), ...(n.when ? { when: n.when } : {}) }]));
}

/** Whether this project asks before it is marked done: open tasks and not already finished. */
export function asksBeforeDone(p: Project): boolean {
  return !isFinished(p.status) && p.next.some((n) => !n.done);
}

/** The words that mark a project done (putting it away as archived or cancelled is its own action, and stays silent). */
const DONE_WORDS = /^\s*(done|closed|complete|completed|finished)\b/i;

/** Whether these edits would mark the project done: the status set to a done word, or the lifecycle stepper moved to
 *  done (it writes the status too). The one rule every path that asks first reads. */
export function wantsDone(edits: ProjectEdit | ProjectEdit[]): boolean {
  const list = Array.isArray(edits) ? edits : [edits];
  return list.some((e) => (e.kind === 'set' && e.field === 'status' && DONE_WORDS.test(String(e.value ?? ''))) || (e.kind === 'stage' && String(e.stage ?? '').trim().toLowerCase() === 'done'));
}

/** The dialog's one short line (round 2: the rows below list the tasks, so the lead never does). */
export function closeAskLead(open: LooseTask[]): string {
  return open.length === 1 ? '1 task is still open. What happened to it?' : `${open.length} tasks are still open. What happened to each?`;
}

/** The quiet line on a finished project with open tasks: "1 loose end", "5 loose ends". */
export function looseEndsWords(n: number): string {
  return `${n} loose end${n === 1 ? '' : 's'}`;
}

/** A dropped task kept under Decisions: its line as written, the date, and why it is there. Nothing is lost. */
export function dropDecisionItem(what: string, date: string): { date: string; what: string; why: string } {
  return { date, what: what.trim(), why: 'Dropped when the project was marked done.' };
}

/** The open tasks as one plain list: “Reply to Thaddeus” (Sam, by 12 Oct), “Book the removalists” and “Confirm the code”. */
function taskListWords(open: LooseTask[]): string {
  const lines = open.map((t) => `“${t.what}”${t.who ? ` (${t.who}${t.when ? `, by ${t.when}` : ''})` : t.when ? ` (by ${t.when})` : ''}`);
  const last = lines.length > 1 ? ` and ${lines.pop()}` : '';
  return `${lines.join(', ')}${last}`;
}

/** The open tasks in plain words, for the assistant's answer (never closed silently; the only list it has). */
export function closeBlockedWords(name: string, open: LooseTask[]): string {
  return `“${name}” still has ${open.length === 1 ? 'an open task' : `${open.length} open tasks`}: ${taskListWords(open)}. Say which are done, dropped, or moved to another project, and it can be marked done.`;
}


