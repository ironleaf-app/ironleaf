// The sides at the window's size (src/shared/layout-fit.ts): the window's width, the side shown as a drawer for now, and
// the ways to show, hide or toggle a side that do the right thing whether it docks or not.

import { useSyncExternalStore } from 'react';
import { canDock, fitSides, rightPanelNeedsNote, type Fit, type FitInput, type Side, type SideShow } from '../../../shared/layout-fit';
import { getWorkspace, setWorkspace, subscribeWorkspace, useWorkspace } from './layout';
import { activeTab, type LeftPanel, type RightPanel, type Workspace } from './workspace';

let width = typeof window === 'undefined' ? 1440 : window.innerWidth;
let drawer: Side | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  for (const fn of listeners) fn();
};

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    // A drawer whose side now docks becomes the docked side.
    if (drawer && canDock(drawer, inputOf(getWorkspace()))) drawer = null;
    notify();
  });
}

function inputOf(ws: Workspace): FitInput {
  return { width, left: { open: ws.left.open, width: ws.left.width, rail: ws.left.rail }, right: { open: ws.right.open, width: ws.right.width }, drawer };
}

export function getFit(ws: Workspace = getWorkspace()): Fit {
  return fitSides(inputOf(ws));
}

export function fitInput(ws: Workspace = getWorkspace()): FitInput {
  return inputOf(ws);
}

export function useFit(): Fit {
  const ws = useWorkspace();
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return fitSides(inputOf(ws));
}

export function closeDrawer(): void {
  if (!drawer) return;
  drawer = null;
  notify();
}

function setDrawer(side: Side | null): void {
  if (drawer === side) return;
  drawer = side;
  notify();
}

/** The right side as drawn: shut when its panel has nothing to show (8.6: off a note, a note-only panel would only
 *  say "Open a note to see its connections"). The saved choice (open, panel) is untouched, so the side comes
 *  back by itself on a note. */
export function rightShown(ws: Workspace = getWorkspace()): SideShow {
  if (activeTab(ws).type !== 'note' && rightPanelNeedsNote(ws.right.panel)) return 'hidden';
  return getFit(ws).right;
}

/** Shows a side (on a panel): docked when it fits, else as a drawer over the middle. */
export function showSide(side: 'left', panel?: LeftPanel): void;
export function showSide(side: 'right', panel?: RightPanel): void;
export function showSide(side: Side, panel?: LeftPanel | RightPanel): void {
  if (side === 'right' && panel === undefined) {
    // Opened off a note with no panel asked, it goes to the chat (8.6): the chat works anywhere, while the saved
    // note-only panel would draw shut.
    const ws = getWorkspace();
    if (activeTab(ws).type !== 'note' && rightPanelNeedsNote(ws.right.panel)) panel = 'chat';
  }
  setWorkspace((ws) => (side === 'left' ? { ...ws, left: { ...ws.left, open: true, panel: (panel as LeftPanel) ?? ws.left.panel } } : { ...ws, right: { ...ws.right, open: true, panel: (panel as RightPanel) ?? ws.right.panel } }));
  if (!canDock(side, inputOf(getWorkspace()))) setDrawer(side);
}

/** Hides a side: a drawer just closes (the side stays the person's choice for a wider window); a docked side shuts. */
export function hideSide(side: Side): void {
  if (getFit()[side] === 'drawer') return setDrawer(null);
  setWorkspace((ws) => (side === 'left' ? { ...ws, left: { ...ws.left, open: false } } : { ...ws, right: { ...ws.right, open: false } }));
}

export function toggleSide(side: Side): void {
  // The right side's drawn state (8.6): shut for emptiness reads shut, so toggling opens it.
  const shown = side === 'right' ? rightShown() : getFit()[side];
  if (shown === 'hidden') showSide(side as 'left');
  else hideSide(side);
}

/** Folds the left side to its icon rail, or unfolds it (8.7 wave 1; the width is kept for unfolding). */
export function setRail(on: boolean): void {
  setWorkspace((ws) => (ws.left.rail === on ? ws : { ...ws, left: { ...ws.left, open: true, rail: on } }));
}

/**
 * Ask (a page's header) and Ctrl+J: the side chat, or away again (4 Nov 2026, p9-one-ask: the floating answer
 * card is gone, so Ask opens the panel and lands in its message box).
 */
export function toggleChat(): void {
  const ws = getWorkspace();
  if (rightShown(ws) !== 'hidden' && ws.right.panel === 'chat') {
    hideSide('right');
    return;
  }
  showSide('right', 'chat');
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.chat .chat-input textarea:not(:disabled)')?.focus()));
}

/** Whether the side chat is beside the page now (Ask shows as pressed). */
export function chatShown(fit: Fit, ws: Workspace): boolean {
  return fit.right !== 'hidden' && ws.right.panel === 'chat';
}

/** Whether a side is on screen at all (docked or as a drawer). */
export function sideShown(fit: Fit, side: Side): boolean {
  return fit[side] !== 'hidden';
}

// Anything that opens a side or switches its panel while the side can't dock (a command, a button in a note) opens it as
// a drawer, so what the person asked for appears.
subscribeWorkspace((prev, next) => {
  for (const side of ['left', 'right'] as const) {
    const a = prev[side], b = next[side];
    if (b.open && (!a.open || a.panel !== b.panel) && !canDock(side, inputOf(next))) setDrawer(side);
  }
  // The files drawer has done its job once a file opens from it.
  if (drawer === 'left') {
    const was = activeTab(prev), now = activeTab(next);
    if (was.id !== now.id || was.path !== now.path) setDrawer(null);
  }
});
