// AI agents in the window (src/main/agent-access.ts): the agents and what they did, read from the main side and read
// again whenever it says something changed. Settings › Agents and a project's page use this one copy.

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AgentsState } from '../../../shared/agent-access';
import type { DeliveredFile } from '../../../shared/agent-files';
import { showError } from './store';

let state: AgentsState | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export async function refreshAgents(): Promise<void> {
  try {
    state = await window.nv.agents.state();
    emit();
  } catch {
    // The notes aren't open yet: read again on the next change.
  }
}

/** The agents as last read (menus and commands built on a click). */
export function agentsNow(): AgentsState | null {
  start();
  return state;
}

/** A delivered file opened in its program (Word, Acrobat…). */
export async function openDelivered(f: DeliveredFile): Promise<void> {
  try {
    if (f.place === 'folder' && f.project) await window.nv.projects.openFile(f.project.path, f.path);
    else await window.nv.files.openDefault(f.path);
    void window.nv.agents.seenFile(f.id).catch(() => undefined);
  } catch (err) {
    showError(err);
  }
}

/** A delivered file shown in File Explorer. */
export async function showDelivered(f: DeliveredFile): Promise<void> {
  try {
    if (f.place === 'folder' && f.project) await window.nv.projects.showFile(f.project.path, f.path);
    else await window.nv.files.reveal(f.path);
  } catch (err) {
    showError(err);
  }
}

export function setAgentsState(next: AgentsState): void {
  state = next;
  emit();
}

function start(): void {
  if (started) return;
  started = true;
  window.nv.on.agentsChanged(() => void refreshAgents());
  void refreshAgents();
}

export function useAgents(): AgentsState | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** The time now, every `ms` (a request's minutes left, "2 min ago"). */
export function useNow(ms = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "just now", "4 min ago", "2 h ago", "yesterday", else the day. */
export function agoWords(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return `${Math.floor(s / 3600)} h ago`;
  if (ms >= start.getTime() - 86400000) return 'yesterday';
  const d = new Date(ms);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}
