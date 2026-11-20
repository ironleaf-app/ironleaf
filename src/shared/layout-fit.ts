// How the window's sides fit at its size (17 Oct 2026, with a narrowed window). The person's choice stays theirs: a side
//they opened stays "open" in the saved layout. What changes with the window is how it shows. Each open side is docked
//beside the middle while the middle keeps a readable width; the sides first give up width (down to their least), then
//the left side steps aside (the right side is what the person is working in: the chat, the outline), then the right. A
//side that steps aside comes back by itself when the window widens, and in the meantime its button opens it as a drawer
//over the middle.

export type Side = 'left' | 'right';
export type SideShow = 'docked' | 'drawer' | 'hidden';

/** The ribbon of buttons down the left edge. */
export const RIBBON = 46;
/** The folded left side: the icon rail (8.7 wave 1; the frame-collapsed mock-up), always this wide. */
export const RAIL = 64;
/** The middle (the note, the page) never gets narrower than this while a side is docked beside it. */
export const MIDDLE_MIN = 460;
/** A drawer leaves at least this much of the middle showing, to click back to. */
export const DRAWER_GAP = 56;
export const SIDE_LIMITS: Record<Side, { min: number; max: number; default: number; share: number }> = {
  // share: the most of the window a docked side takes, so a side set wide on a big screen doesn't swallow a small one.
  left: { min: 200, max: 480, default: 292, share: 0.32 },
  right: { min: 300, max: 640, default: 380, share: 0.42 },
};

export interface FitInput {
  width: number;
  /** rail: the left side is folded to its icon rail (RAIL wide, never resized or shrunk). */
  left: { open: boolean; width: number; rail?: boolean };
  right: { open: boolean; width: number };
  /** The side opened over the middle for now (when it can't dock), if any. */
  drawer: Side | null;
}

export interface Fit {
  left: SideShow;
  right: SideShow;
  /** The width each side is drawn at (docked or as a drawer); 0 when hidden. */
  leftWidth: number;
  rightWidth: number;
  /** The width left for the middle. */
  middle: number;
}

/** A side's width kept to its limits and its share of a window this wide. */
export function sideWidth(side: Side, wanted: number, windowWidth: number): number {
  const l = SIDE_LIMITS[side];
  const w = Number.isFinite(wanted) && wanted > 0 ? wanted : l.default;
  const cap = Math.max(l.min, Math.min(l.max, Math.round(windowWidth * l.share)));
  return Math.round(Math.min(cap, Math.max(l.min, w)));
}

/** The width a drawer is drawn at: the side's own width, never covering the whole middle. */
export function drawerWidth(side: Side, wanted: number, windowWidth: number): number {
  const l = SIDE_LIMITS[side];
  const room = Math.max(160, windowWidth - RIBBON - DRAWER_GAP);
  const w = Number.isFinite(wanted) && wanted > 0 ? wanted : l.default;
  return Math.round(Math.min(room, l.max, Math.max(l.min, w)));
}

/** Whether a side could dock if it were open (with the other side as it is). */
export function canDock(side: Side, input: FitInput): boolean {
  return fitSides({ ...input, [side]: { ...input[side], open: true }, drawer: null })[side] === 'docked';
}

export function fitSides(input: FitInput): Fit {
  const W = Math.max(0, input.width);
  const room = W - RIBBON;
  const rail = !!input.left.rail;
  let L = input.left.open ? (rail ? RAIL : sideWidth('left', input.left.width, W)) : 0;
  let R = input.right.open ? sideWidth('right', input.right.width, W) : 0;
  let leftDocked = input.left.open;
  let rightDocked = input.right.open;
  const min = SIDE_LIMITS;

  // Give up width, the wider side first, down to each side's least (a folded rail has none to give).
  const shrink = () => {
    let over = (leftDocked ? L : 0) + (rightDocked ? R : 0) - (room - MIDDLE_MIN);
    if (over <= 0) return true;
    const spareL = leftDocked && !rail ? L - min.left.min : 0;
    const spareR = rightDocked ? R - min.right.min : 0;
    if (spareL + spareR < over) return false;
    // Take from each in proportion to what it can spare.
    const takeL = Math.ceil((over * spareL) / (spareL + spareR || 1));
    L -= Math.min(spareL, takeL);
    over -= Math.min(spareL, takeL);
    R -= Math.min(spareR, Math.max(0, over));
    return true;
  };

  if (!shrink()) {
    if (leftDocked && rightDocked) {
      // The left side steps aside first (a folded rail costs so little it stays, and the right side goes instead);
      // the side that stays gets its own width back.
      if (rail) {
        rightDocked = false;
        L = RAIL;
        if (!shrink()) leftDocked = false;
      } else {
        leftDocked = false;
        R = sideWidth('right', input.right.width, W);
        if (!shrink()) rightDocked = false;
      }
    } else {
      leftDocked = false;
      rightDocked = false;
    }
  }
  if (rail && leftDocked) L = RAIL;
  if (!leftDocked) L = 0;
  if (!rightDocked) R = 0;

  const show = (side: Side, docked: boolean): SideShow => (docked ? 'docked' : input.drawer === side ? 'drawer' : 'hidden');
  const left = show('left', leftDocked);
  const right = show('right', rightDocked);
  return {
    left,
    right,
    leftWidth: left === 'docked' ? L : left === 'drawer' ? (rail ? RAIL : drawerWidth('left', input.left.width, W)) : 0,
    rightWidth: right === 'docked' ? R : right === 'drawer' ? drawerWidth('right', input.right.width, W) : 0,
    middle: Math.max(0, room - (leftDocked ? L : 0) - (rightDocked ? R : 0)),
  };
}

/** The right side's panels that only have something to show on a note (8.6: off a note they only said "Open a note to
 *  see its connections", so the side stays shut there instead). Tags and the chat work anywhere and always show. */
export const NOTE_ONLY_PANELS: readonly string[] = ['backlinks', 'outgoing', 'outline', 'local-graph', 'related', 'autolink'];

export function rightPanelNeedsNote(panel: string): boolean {
  return NOTE_ONLY_PANELS.includes(panel);
}

/** The right side's two tabs (20 Nov 2026): Chat has the whole column to itself; Note holds everything about the note
 *  (outline, connections, links and dates). The saved panel says which: 'chat' is Chat, every note panel is Note;
 *  off a note there is only the chat. */
export type RightTab = 'chat' | 'note';
export function rightTabOf(panel: string, onNote: boolean): RightTab {
  return panel === 'chat' || !onNote ? 'chat' : 'note';
}

/** The saved panel a tab's click lands on: the chat, or the note panel last on show (the outline when none was). */
export function panelForRightTab(tab: RightTab, lastNotePanel: string): string {
  return tab === 'chat' ? 'chat' : rightPanelNeedsNote(lastNotePanel) ? lastNotePanel : 'outline';
}

/** The most a docked side may be dragged to, so the middle keeps its readable width. */
export function maxDockedWidth(side: Side, input: FitInput): number {
  const other: Side = side === 'left' ? 'right' : 'left';
  const fit = fitSides(input);
  const otherDocked = fit[other] === 'docked' ? (other === 'left' ? fit.leftWidth : fit.rightWidth) : 0;
  const l = SIDE_LIMITS[side];
  return Math.max(l.min, Math.min(l.max, Math.round(input.width * l.share), input.width - RIBBON - MIDDLE_MIN - otherDocked));
}
