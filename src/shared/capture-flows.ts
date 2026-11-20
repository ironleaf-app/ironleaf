// "Capture to…" (21 Oct 2026, gap G27): keys inside Ironleaf that take a line down straight into a chosen place —
// a project's log, the Inbox, today's note or any note — with the time it was written, without opening the note. The
// flows are set up in Settings › Capture (up to five, each with its own keys in Settings › Keys); "Capture to…"
// (Ctrl+Shift+J) asks which.
//
//   Inbox            the Inbox note, under "## Captured"
//   Today's note     today's note, under "## Captured"
//   A project's log  "Log.md" in the project's folder (made the first time, linked to the project), under "## Log";
//                    the project asked each time, or always the same one
//   A note           any note chosen, under the heading given
//
// Each line is "- 21 Oct 2026 14:05 — the words" (or with the time only, or as a task "- [ ] the words — 14:05"), added
// at the end of its heading's section, newest last, everything else in the note kept exactly as written.
//
// Pure: Settings keeps the flows (src/shared/prefs.ts), the main side writes the line (src/main/capture-flows.ts), the
// window asks for the words (src/renderer/src/state/captureFlows.ts), the tests check it (tests/capture-flows.test.mjs).

import { appendUnder } from './capture';
import { cleanFileName } from './paths';

export type FlowTarget = 'inbox' | 'daily' | 'project-log' | 'note';
export type FlowStamp = 'date-time' | 'time';
export type FlowKind = 'line' | 'task';

export interface CaptureFlow {
  id: string;
  /** What it is called in the list and the command ("Project log"). */
  name: string;
  target: FlowTarget;
  /** For a project's log: the project's file, or '' to ask each time. */
  project?: string;
  /** For a note: the note's path. */
  note?: string;
  /** The heading the lines go under (without #). */
  heading: string;
  stamp: FlowStamp;
  kind: FlowKind;
}

/** The most flows (each has a command, "Capture to flow 1" … "5", for its own keys). */
export const MAX_FLOWS = 5;

export const DEFAULT_FLOWS: CaptureFlow[] = [
  { id: 'log', name: 'Project log', target: 'project-log', project: '', heading: 'Log', stamp: 'date-time', kind: 'line' },
  { id: 'inbox', name: 'Inbox', target: 'inbox', heading: 'Captured', stamp: 'date-time', kind: 'line' },
];

export const TARGET_WORDS: Record<FlowTarget, string> = { inbox: 'The Inbox note', daily: 'Today’s note', 'project-log': 'A project’s log', note: 'A note' };
export const DEFAULT_HEADING: Record<FlowTarget, string> = { inbox: 'Captured', daily: 'Captured', 'project-log': 'Log', note: 'Captured' };

const cleanHeading = (v: unknown, fallback: string) => {
  // Words, spaces and a little punctuation (the heading is found again by its words).
  const h = typeof v === 'string' ? v.replace(/^#+\s*/, '').replace(/[^\p{L}\p{N} '’&,-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return h || fallback;
};
const cleanNote = (v: unknown) => (typeof v === 'string' && v.length <= 400 && /\.md$/i.test(v) && !v.split('/').includes('..') && !v.startsWith('/') ? v : '');

/** The flows as Settings keeps them, only what makes sense (anything else is left out or set back). */
export function cleanFlows(raw: unknown, fallback: CaptureFlow[] = DEFAULT_FLOWS): CaptureFlow[] {
  if (!Array.isArray(raw)) return fallback;
  const out: CaptureFlow[] = [];
  const ids = new Set<string>();
  for (const f of raw.slice(0, MAX_FLOWS)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const target = (['inbox', 'daily', 'project-log', 'note'] as const).find((t) => t === r.target);
    if (!target) continue;
    const note = target === 'note' ? cleanNote(r.note) : '';
    if (target === 'note' && !note) continue;
    let id = typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : `flow-${out.length + 1}`;
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.replace(/[\r\n]/g, ' ').trim().slice(0, 60) : TARGET_WORDS[target];
    const flow: CaptureFlow = { id, name, target, heading: cleanHeading(r.heading, DEFAULT_HEADING[target]), stamp: r.stamp === 'time' ? 'time' : 'date-time', kind: r.kind === 'task' ? 'task' : 'line' };
    if (target === 'project-log') flow.project = cleanNote(r.project);
    if (target === 'note') flow.note = note;
    out.push(flow);
  }
  return out;
}

/** A project's log: "Log.md" beside the project's file (in its folder), or "<Project> log.md" for a project at the top. */
export function projectLogPath(projectPath: string, projectName: string): string {
  const i = projectPath.lastIndexOf('/');
  if (i < 0) return `${cleanFileName(projectName, 'Project', 80)} log.md`;
  return `${projectPath.slice(0, i)}/Log.md`;
}

/** A new project log's first words: linked to its project, so it shows on the project's page and in its graph. */
export function newLogText(projectName: string): string {
  const name = projectName.replace(/"/g, '');
  return `---\nproject: "[[${name}]]"\n---\n# ${name} log\n`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "21 Oct 2026 14:05", or "14:05". */
export function stampOf(now: Date, stamp: FlowStamp): string {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return stamp === 'time' ? time : `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} ${time}`;
}

/** The lines a capture adds: "- 21 Oct 2026 14:05 — the words" (more lines indented under it), or a task. */
export function flowLines(text: string, flow: Pick<CaptureFlow, 'stamp' | 'kind'>, now: Date): string[] {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n');
  const first = lines[0].trim();
  const rest = lines.slice(1).map((l) => (l.trim() ? `  ${l.replace(/\s+$/, '')}` : '  '));
  const stamp = stampOf(now, flow.stamp);
  // A capture that starts as a task ("[ ] ring Priya") stays one.
  const asTask = flow.kind === 'task' || /^\[ \]\s+/.test(first);
  const words = first.replace(/^\[ \]\s+/, '');
  return [asTask ? `- [ ] ${words} — ${stamp}` : `- ${stamp} — ${words}`, ...rest];
}

/** A note with a capture added at the end of its heading's section (the heading made at the end when it isn't there). */
export function appendCapture(note: string, text: string, flow: Pick<CaptureFlow, 'stamp' | 'kind' | 'heading'>, now: Date): string {
  return appendUnder(note, flowLines(text, flow, now), cleanHeading(flow.heading, 'Captured'));
}
