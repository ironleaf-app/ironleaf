// "Capture to…" in the window (21 Oct 2026, gap G27; src/shared/capture-flows.ts): Ctrl+Shift+J asks which flow (or a
// flow's own keys, set in Settings › Keys, go straight to it), which project for a project's log that asks, then the
// words; the line is added with the time without opening the note, and the message offers Open.

import { MAX_FLOWS, TARGET_WORDS, type CaptureFlow } from '../../../shared/capture-flows';
import { isProjectProps } from '../../../shared/project-file';
import type { IconName } from '../components/Icon';
import { prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import type { Command } from './commands';
import * as A from './actions';
import { openModal } from './modals';
import { getState, prefs, showError, toast } from './store';
import { getWorkspace } from './layout';
import * as W from './workspace';

const ICON: Record<CaptureFlow['target'], IconName> = { inbox: 'inbox', daily: 'calendar', 'project-log': 'layers', note: 'notes' };

/** The project the person is in: the project page or a note in its folder (offered first for a log that asks). */
function projectHere(): string | undefined {
  const path = W.activeTab(getWorkspace()).path;
  if (!path) return undefined;
  const projects = getState().notes.filter((n) => isProjectProps(n.props));
  if (projects.some((p) => p.path === path)) return path;
  return projects.filter((p) => A.folderOf(p.path) && path.startsWith(`${A.folderOf(p.path)}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.path;
}

async function chooseProject(): Promise<string | null> {
  const here = projectHere();
  const projects = getState()
    .notes.filter((n) => isProjectProps(n.props))
    .sort((a, b) => (a.path === here ? -1 : b.path === here ? 1 : b.mtime - a.mtime));
  if (!projects.length) {
    toast('No projects yet: a project’s log needs a project.');
    return null;
  }
  return pick({
    placeholder: 'Add to which project’s log?',
    items: (q) => fuzzyFilter(projects, q, (p) => p.label || p.title).map((p) => ({ id: p.path, label: p.label || p.title, detail: p.path === here ? 'The project you’re in' : '', icon: 'layers' as const })),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
}

/** Runs a flow: which project (a log that asks), the words, then the line added with the time. */
export async function runFlow(flow: CaptureFlow): Promise<void> {
  if (!getState().canEdit) return;
  let project: string | undefined;
  if (flow.target === 'project-log' && !flow.project) {
    project = (await chooseProject()) ?? undefined;
    if (!project) return;
  }
  const place = flow.target === 'project-log' ? `${getState().byPath.get(project ?? flow.project ?? '')?.label ?? 'the project'}’s log` : flow.target === 'note' ? `“${A.titleOf(flow.note ?? '')}”` : flow.target === 'inbox' ? 'the Inbox' : 'today’s note';
  const words = await prompt(`Capture to ${flow.name}`, {
    message: `Added to ${place} with the ${flow.stamp === 'time' ? 'time' : 'date and time'}${flow.kind === 'task' ? ', as a task' : ''}. Start with [ ] for a task.`,
    placeholder: flow.kind === 'task' ? 'What needs doing?' : 'What happened, or what to remember?',
    ok: 'Add',
  });
  if (!words) return;
  try {
    const done = await window.nv.captureFlows.add(flow.id, words, project);
    toast(done.words, { label: 'Open', run: () => A.openPath(done.path, { where: 'tab' }) });
  } catch (err) {
    showError(err);
  }
}

/** "Capture to…": which flow, then the flow. */
export async function captureTo(): Promise<void> {
  const flows = prefs().captureFlows;
  if (!flows.length) {
    toast('No capture flows yet.', { label: 'Set them up', run: () => openModal({ kind: 'settings', section: 'capture' }) });
    return;
  }
  if (flows.length === 1) return runFlow(flows[0]);
  const id = await pick({
    placeholder: 'Capture to…',
    items: (q) => fuzzyFilter(flows, q, (f) => `${f.name} ${TARGET_WORDS[f.target]}`).map((f) => ({ id: f.id, label: f.name, detail: f.target === 'project-log' && !f.project ? 'Asks which project' : f.target === 'project-log' ? getState().byPath.get(f.project!)?.label ?? '' : f.target === 'note' ? A.titleOf(f.note ?? '') : TARGET_WORDS[f.target], icon: ICON[f.target] })),
    extraRow: () => ({ label: 'Set up capture flows…', run: () => openModal({ kind: 'settings', section: 'capture' }) }),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
  const flow = flows.find((f) => f.id === id);
  if (flow) await runFlow(flow);
}

/** The commands: "Capture to…" and one per flow, for its own keys (Settings › Keys). */
export const CAPTURE_COMMANDS: Command[] = [
  { id: 'capture-to', name: 'Capture to… (a project’s log, the Inbox, a note)', hotkey: 'Mod+Shift+J', icon: 'inbox', when: () => getState().canEdit, run: () => void captureTo() },
  ...Array.from({ length: MAX_FLOWS }, (_, i): Command => ({
    id: `capture-flow-${i + 1}`,
    get name() {
      const f = prefs().captureFlows[i];
      return f ? `Capture to ${f.name}` : `Capture to flow ${i + 1}`;
    },
    icon: 'inbox',
    when: () => getState().canEdit && !!prefs().captureFlows[i],
    run: () => {
      const f = prefs().captureFlows[i];
      if (f) void runFlow(f);
    },
  })),
];
