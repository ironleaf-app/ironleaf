// The assistant's suggested changes to notes, waiting for the person (19 Oct 2026, 5.0.0: "AI edits you approve"). With
// Settings › Models › Ask before the assistant changes a note on, an edit of a note that is there is kept here instead of
// being written: the note's words it was made against and the note with it kept. The window shows each change in the
// note to keep or discard (src/renderer/src/state/suggestions.ts); nothing reaches the disk until it is kept there, so
// discarding everything leaves the file as it was. Kept in memory only: closing Ironleaf drops what still waits.

import { applyHunks, placeHunks } from '../shared/note-diff';
import { isPrivatePath } from '../shared/private';
import type { NoteSuggestionEvent } from '../shared/types';

interface Waiting {
  base: string;
  after: string;
}

export class NoteSuggestions {
  private waiting = new Map<string, Waiting>();

  constructor(private notify: (event: NoteSuggestionEvent) => void) {}

  /**
   * The note as the assistant should see it now: its words as they are (`current`) with every suggestion still waiting
   * put in (those the person has since changed under are left out), so a second edit builds on the first.
   */
  pending(rel: string, current: string): string | undefined {
    const w = this.waiting.get(rel);
    if (!w) return undefined;
    return applyHunks(current, placeHunks(w.base, w.after, current));
  }

  /** A change offered: the note as it is (`current`) and as the assistant would leave it. How many changes wait there. */
  offer(rel: string, current: string, after: string): number {
    // Locked notes never hold a waiting change (10.0 v2locked): the assistant cannot read them, so it cannot offer one.
    if (isPrivatePath(rel)) throw new Error('Private notes are never open to the assistant.');
    const count = placeHunks(current, after, current).length;
    if (!count) {
      this.clear(rel);
      return 0;
    }
    this.waiting.set(rel, { base: current, after });
    this.notify({ path: rel, base: current, after });
    return count;
  }

  /** What still waits after the person kept or discarded some (from the window): the note as it is and with the rest
   *  kept; null when nothing waits. The window already shows it, so it isn't told again. */
  settle(rel: string, base: string, after: string | null): void {
    // Locked notes never hold a waiting change (10.0 v2locked): a stale call from the window is dropped, never kept.
    if (isPrivatePath(rel)) {
      this.waiting.delete(rel);
      return;
    }
    if (after === null || after === base) this.waiting.delete(rel);
    else this.waiting.set(rel, { base, after });
  }

  /** How many changes wait in a note (against its words now). */
  count(rel: string, current: string): number {
    const w = this.waiting.get(rel);
    return w ? placeHunks(w.base, w.after, current).filter((h) => !h.stale).length : 0;
  }

  has(rel: string): boolean {
    return this.waiting.has(rel);
  }

  list(): NoteSuggestionEvent[] {
    return [...this.waiting].map(([path, w]) => ({ path, base: w.base, after: w.after }));
  }

  clear(rel: string): void {
    if (!this.waiting.delete(rel)) return;
    this.notify({ path: rel, base: '', after: null });
  }

  /** A note moved or renamed (or a folder it is in): its suggestions follow it. */
  renamed(from: string, to: string): void {
    for (const [rel, w] of [...this.waiting]) {
      const next = rel === from ? to : rel.startsWith(`${from}/`) ? to + rel.slice(from.length) : null;
      if (!next) continue;
      this.waiting.delete(rel);
      this.waiting.set(next, w);
      this.notify({ path: rel, base: '', after: null });
      this.notify({ path: next, base: w.base, after: w.after });
    }
  }

  /** Another folder of notes opened: nothing from the last one waits. */
  reset(): void {
    for (const rel of [...this.waiting.keys()]) this.clear(rel);
  }
}
