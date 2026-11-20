// Running an ability's "Show me" (8.8, src/shared/abilities.ts): the real place opens, or the first step runs. A
// target that needs a note asks before opening today's note, then waits for its editor; one that needs something
// else (a project open, a pack switched on, an agent available) says so in plain words and opens the closest place
// instead. Never silent.

import type { AbilityTarget } from '../../../shared/abilities';
import { moduleInfo, moduleOn } from '../../../shared/life-modules';
import * as A from './actions';
import { available, COMMANDS, commandContext, runCommand } from './commands';
import { editorFor, getWorkspace } from './layout';
import { confirm } from '../components/Dialogs';
import { openModal } from './modals';
import { modulesNow, openModule } from './modules';
import { getState, toast } from './store';
import * as W from './workspace';

/** A note open for editing, for targets that write into one (today's note opens when none is). */
async function ensureNote(): Promise<boolean> {
  const ws = getWorkspace();
  const tab = W.activeTab(ws);
  if (tab.type === 'note' && tab.path) return true;
  await A.openDaily();
  return true;
}

/** The open note's editor, awaited (9.2 uplift F69): ready when registered, never after a fixed sleep. */
async function awaitEditor(): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const tab = W.activeTab(getWorkspace());
    if (tab.type === 'note' && tab.path && editorFor(tab.id)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Plain words for targets that cannot run where the person is, each with the closest place to go. */
function explain(id: string): void {
  if (id === 'dictate') {
    toast('Dictation is not available on this PC.');
    return;
  }
  if (id === 'send-to-agent') {
    toast('No agent is available. Agents live in Settings.');
    A.openSettings('agents');
    return;
  }
  if (id === 'project-workspace' || id === 'project-canvas') {
    toast('Open a project first, then its workspace is one click away.', { label: 'Projects', run: () => A.openProjects() });
    return;
  }
  if (id === 'record-meeting') {
    toast(getState().canEdit ? 'A recording is already running.' : 'Recording needs a vault that can be changed.');
    return;
  }
  const cmd = COMMANDS.find((c) => c.id === id);
  toast(cmd ? `“${cmd.name}” is not available here.` : 'That is not available here.');
}

function runCommandTarget(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) return;
  const ctx = commandContext();
  // A command that needs a note or a file: asked first, never minted silently (9.2 uplift F69) — today's
  // note opens only with a yes, then its editor is awaited instead of a fixed 700ms sleep.
  if ((cmd.editor && !ctx.view) || (cmd.note && ctx.tab.type !== 'note') || (cmd.file && !ctx.path)) {
    if (!getState().canEdit) {
      explain(id);
      return;
    }
    void (async () => {
      const ok = await confirm(`Show “${cmd.name}”?`, { message: 'It needs a note open. Open today’s note?', ok: 'Open today’s note' });
      if (!ok) {
        toast('Open a note first, then Show me again.');
        return;
      }
      await ensureNote();
      if (await awaitEditor()) runCommandTarget(id);
      else explain(id);
    })();
    return;
  }
  if (!available(cmd, ctx)) {
    explain(id);
    return;
  }
  runCommand(id);
}

export function runAbility(target: AbilityTarget): void {
  if (target.kind === 'command') {
    runCommandTarget(target.command);
    return;
  }
  if (target.kind === 'page') {
    if (target.page === 'settings') {
      A.openSettings(target.path);
      return;
    }
    // Unknown pages speak and land somewhere useful (9.2 uplift F68): Home, never silence.
    toast('That place is not here any more. Home opens instead.');
    A.openHome();
    return;
  }
  // A pack: opened, or Settings › Packs when it is switched off (the first step is switching it on).
  // Meetings too, now a real pack (3 Nov 2026, audit f F2: off hides all of it, like every other pack).
  const info = moduleInfo(target.pack);
  if (!moduleOn(modulesNow(), target.pack)) {
    toast(info ? `Switch on the ${info.name} pack to see it.` : 'That pack is switched off.');
    A.openSettings('packs');
    return;
  }
  openModule(target.pack, target.part);
}

/** Opening the starter picker (Home, Projects, Notes and the palette all ask here). */
export function openStarterPicker(template?: string): void {
  openModal({ kind: 'starter-picker', ...(template ? { template } : {}) });
}
