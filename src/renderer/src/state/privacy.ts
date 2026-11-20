// Sensitivity levels and Secrets in the window (Wave 4, 24 Oct 2026; src/main/sensitive.ts on the main side): the vault's
// sensitivity file kept here so a note's, file's or folder's level shows at once (worked out with the same rules as the
// main side, src/shared/sensitivity.ts), Settings › Privacy and secrets' state, and setting a level from anywhere.

import { useSyncExternalStore } from 'react';
import type { PrivacyState } from '../../../shared/secrets';
import { emptyStore, folderLevel, levelLabel, levelOf, type Level, type LevelOf, type SensitivityStore } from '../../../shared/sensitivity';
import { isPrivatePath } from '../../../shared/private';
import { docs } from './docs';
import { getState, showError, toast } from './store';

interface PrivacyStateHere {
  store: SensitivityStore;
  state: PrivacyState | null;
  /** Bumped when levels, access or Secrets changed (pages read again). */
  revision: number;
  secretsRevision: number;
}

let here: PrivacyStateHere = { store: emptyStore(), state: null, revision: 0, secretsRevision: 0 };
const listeners = new Set<() => void>();
let listening = false;

function set(next: Partial<PrivacyStateHere>): void {
  here = { ...here, ...next };
  for (const fn of listeners) fn();
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.nv.on.privacyChanged((what) => {
    if (what === 'secrets') set({ secretsRevision: here.secretsRevision + 1 });
    else void refreshPrivacy();
  });
  void refreshPrivacy();
}

export async function refreshPrivacy(full = false): Promise<void> {
  try {
    const store = await window.nv.privacy.store();
    set({ store, revision: here.revision + 1, ...(full || here.state ? { state: await window.nv.privacy.state() } : {}) });
  } catch {
    // No vault open yet: levels show as Open until one is.
  }
}

export function usePrivacy(): PrivacyStateHere {
  listen();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => here,
  );
}

export function privacyStore(): SensitivityStore {
  listen();
  return here.store;
}

/** A note's or file's level as the window knows it now (a note's own property from the index). */
export function levelHere(path: string): LevelOf {
  const meta = getState().byPath.get(path);
  return levelOf(privacyStore(), path, meta?.props?.sensitivity, meta?.props?.type, meta?.props?.area);
}

/** A folder's own default, and the level its contents would have without one (from a folder above). */
export function folderHere(folder: string): { own: Level | null; inherited: { level: Level; folder: string } | null } {
  const store = privacyStore();
  const own = store.folders[folder] ?? null;
  return { own, inherited: folderLevel(store, `${folder}/x`) && !own ? folderLevel(store, `${folder}/x`) : null };
}

/** A note's, file's or asset's level set (null: as its folder says). */
export async function setLevel(path: string, level: Level | null): Promise<void> {
  if (isPrivatePath(path)) return;
  try {
    // What was typed into an open note is saved first, so the level is written into the note as it is now.
    if (/\.md$/i.test(path)) await docs.flush(path);
    const v = await window.nv.privacy.setLevel(path, level);
    await refreshPrivacy();
    toast(level ? `Marked ${levelLabel(v.level)}.` : `Now ${levelLabel(v.level)}, as its folder says.`);
  } catch (err) {
    showError(err);
  }
}

/** A folder's default level set (null: none). */
export async function setFolderLevel(folder: string, level: Level | null): Promise<void> {
  try {
    await window.nv.privacy.setFolder(folder, level);
    await refreshPrivacy();
    toast(level ? `Everything in ${folder} without a level of its own is ${levelLabel(level)} now.` : `${folder} no longer has a level of its own.`);
  } catch (err) {
    showError(err);
  }
}

export async function loadPrivacyState(): Promise<PrivacyState | null> {
  listen();
  try {
    const state = await window.nv.privacy.state();
    set({ state });
    return state;
  } catch (err) {
    showError(err);
    return null;
  }
}

export function privacyStateChanged(state: PrivacyState): void {
  set({ state });
  void refreshPrivacy();
}

// ── Which section of the Locked place to show (10.0 v2locked: Private notes joined Secrets, Find in notes, Activity) ──
// Kept here, not in the tab's path (a tab's path names a file, and tabs whose file is gone are emptied).
export type SecretsPart = 'secrets' | 'scan' | 'activity';
export type LockedSection = 'notes' | SecretsPart;
let wantPart: LockedSection | null = null;
const partListeners = new Set<(p: LockedSection) => void>();
export function requestLockedSection(p: LockedSection): void {
  wantPart = p;
  for (const fn of partListeners) fn(p);
}
export function takeLockedSection(): LockedSection | null {
  const p = wantPart;
  wantPart = null;
  return p;
}
export function onLockedSection(fn: (p: LockedSection) => void): () => void {
  partListeners.add(fn);
  return () => partListeners.delete(fn);
}
