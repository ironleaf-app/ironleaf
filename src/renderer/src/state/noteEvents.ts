// A note (or a folder of notes) renamed, moved or deleted from Ironleaf's own screens, for the parts of the window
// that hold on to a note by its path and must follow it or let it go (22 Oct 2026: the meeting recorder kept a deleted
// meeting's recording going, and a new meeting made under the same name took it over). Kept apart from actions.ts so
// those parts needn't import it (and it needn't import them).

type Moved = (from: string, to: string) => void;
type Removed = (path: string) => void;

const moved = new Set<Moved>();
const removed = new Set<Removed>();

export function onNoteMoved(fn: Moved): () => void {
  moved.add(fn);
  return () => moved.delete(fn);
}
export function onNoteRemoved(fn: Removed): () => void {
  removed.add(fn);
  return () => removed.delete(fn);
}

export function noteMoved(from: string, to: string): void {
  if (from === to) return;
  for (const fn of moved) {
    try {
      fn(from, to);
    } catch {
      // One listener's trouble never stops the move.
    }
  }
}
export function noteRemoved(path: string): void {
  for (const fn of removed) {
    try {
      fn(path);
    } catch {
      // As above.
    }
  }
}
