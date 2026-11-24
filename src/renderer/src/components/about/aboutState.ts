// The About and updates page's shared state (20 Nov 2026): the update check's state from the main side (one
// subscription for the page, the sidebar's version line and the banner), the request to open the page (from the
// palette, the Help menu, the tray, the banner and the sidebar), and the version history: CHANGELOG.md bundled into
// the app, merged with versions.json from the website when it can be reached (src/shared/version-history.ts).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UpdateState } from '../../../../main/update-check';
import type { AboutRequest } from '../../../../main/update-about';
import { mergeVersions, parseChangelog, type ReleaseEntry } from '../../../../shared/version-history';
import changelog from '../../../../../CHANGELOG.md?raw';
import * as A from '../../state/actions';
import { pendingNav } from '../../state/pending-nav';

export type { AboutRequest };

/** The history the app was built with (CHANGELOG.md). */
export const BUNDLED_VERSIONS: ReleaseEntry[] = parseChangelog(changelog);

// ── The update check's state: one subscription, many readers ──
let state: UpdateState | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function start(): void {
  if (started || !window.nvUpdate) return;
  started = true;
  void window.nvUpdate.state().then((s) => ((state = s), emit()), () => {});
  window.nvUpdate.onChange((s) => ((state = s), emit()));
}
/** Sets the state by hand (the page's own calls answer with the new state before the change notice comes). */
export function takeState(s: UpdateState): void {
  state = s;
  emit();
}
export function useUpdateState(): UpdateState | null {
  start();
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
  );
}

// ── Opening the page ──
let request: (AboutRequest & { at: number }) | null = null;
const reqListeners = new Set<() => void>();
/** Opens Settings › About and updates; with check: a check starts; focus 'whats-new' brings this version's notes into view. */
export function openAboutPage(req: Partial<AboutRequest> = {}): void {
  request = { check: !!req.check, focus: req.focus ?? 'status', at: Date.now() };
  reqListeners.forEach((l) => l());
  A.openSettings('about');
}
/** The page takes the request once (null when there is none). */
export function takeAboutRequest(): AboutRequest | null {
  const r = request;
  request = null;
  return r;
}
export function useAboutRequestTick(): number {
  return useSyncExternalStore(
    (l) => (reqListeners.add(l), () => void reqListeners.delete(l)),
    () => request?.at ?? 0,
  );
}

/** Mounted once for the window (in the update banner): the tray's and the Help menu's requests open the page. */
export function useAboutDoor(): void {
  useEffect(() => {
    const api = window.nvUpdate;
    if (!api?.onOpen) return;
    // While Ironleaf starts, the page waits for the saved layout: opened before it, the layout would replace it.
    const off = api.onOpen((req) => {
      pendingNav.defer(() => openAboutPage(req));
      void api.takeOpen().catch(() => null);
    });
    void api.takeOpen().then((req) => req && pendingNav.defer(() => openAboutPage(req)), () => {});
    return off;
  }, []);
}

// ── The history: bundled, then the website's when it answers ──
let online: ReleaseEntry[] | null = null;
let onlineAsked = false;
export function useVersionHistory(): { list: ReleaseEntry[]; online: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (onlineAsked || !window.nvUpdate?.versions) return;
    onlineAsked = true;
    void window.nvUpdate.versions().then(
      (l) => {
        online = l && l.length ? l : null;
        setTick((n) => n + 1);
      },
      () => {},
    );
  }, []);
  return { list: mergeVersions(online, BUNDLED_VERSIONS), online: !!online };
}
