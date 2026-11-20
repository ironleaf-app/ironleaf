// "Capture to…" on the main side (21 Oct 2026, gap G27; src/shared/capture-flows.ts says what a flow is): a line added
// to its place with the time, through the same write every save uses (indexed, shown in open tabs, kept in file
// recovery). A project's log is made the first time, linked to its project.

import { appendCapture, cleanFlows, newLogText, projectLogPath, type CaptureFlow } from '../shared/capture-flows';

export interface CaptureFlowsHost {
  /** The flows in Settings › Capture. */
  flows(): unknown;
  /** A note's words (null: no such note yet). */
  readNote(rel: string): Promise<string | null>;
  writeNote(rel: string, text: string): Promise<void>;
  /** Today's note made from the daily template when it isn't there yet (and its place). */
  dailyNote(): Promise<string>;
  /** A project's name from its file (null: not a project). */
  projectName(path: string): string | null;
  /** Changing notes needs the licence once it is enforced. */
  requireCreate(): Promise<void>;
  now?(): Date;
}

export interface CaptureFlowDone {
  path: string;
  /** What the message says: "Added to Harbour’s log." */
  words: string;
}

export const INBOX = 'Inbox.md';

/** Adds a capture to a flow's place: its id, the words, and for a project's log that asks, the project's file. */
export async function captureToFlow(host: CaptureFlowsHost, id: unknown, text: unknown, project?: unknown): Promise<CaptureFlowDone> {
  const flow = cleanFlows(host.flows()).find((f) => f.id === id);
  if (!flow) throw new Error('That capture flow isn’t in Settings › Capture any more.');
  const words = typeof text === 'string' ? text.slice(0, 20_000) : '';
  if (!words.trim()) throw new Error('Write something to capture first.');
  await host.requireCreate();
  const where = await placeOf(host, flow, typeof project === 'string' ? project : '');
  const now = host.now?.() ?? new Date();
  const before = (await host.readNote(where.path)) ?? where.fresh;
  await host.writeNote(where.path, appendCapture(before, words, flow, now));
  return { path: where.path, words: `Added to ${where.name}.` };
}

async function placeOf(host: CaptureFlowsHost, flow: CaptureFlow, asked: string): Promise<{ path: string; name: string; fresh: string }> {
  if (flow.target === 'inbox') return { path: INBOX, name: 'the Inbox', fresh: '# Inbox\n' };
  if (flow.target === 'daily') return { path: await host.dailyNote(), name: 'today’s note', fresh: '' };
  if (flow.target === 'note') {
    const note = flow.note!;
    return { path: note, name: `“${note.split('/').pop()!.replace(/\.md$/i, '')}”`, fresh: '' };
  }
  const file = flow.project || asked;
  const name = file ? host.projectName(file) : null;
  if (!file || !name) throw new Error(file ? 'That project isn’t in your notes any more.' : 'Which project?');
  return { path: projectLogPath(file, name), name: `${name}’s log`, fresh: newLogText(name) };
}
