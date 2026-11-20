// Write-first notes (5 Nov 2026, one rule: the New button does not ask a kind or a folder first).
// A write-first note is a plain note made by New, written in, and offered a home after from the same
// filing. Empty ones with no words leave nothing behind when closed. Session-only: nothing on disk.
const writeFirst = new Set<string>();
const proposed = new Set<string>();

export const markWriteFirst = (path: string): void => {
  writeFirst.add(path);
};
export const isWriteFirst = (path: string): boolean => writeFirst.has(path);
export const clearWriteFirst = (path: string): void => {
  writeFirst.delete(path);
  proposed.delete(path);
};
/** Every mark gone (Nov 2026 break: opening another vault with the same Untitled path dropped
 *  that vault's note for this one's empty close). Called whenever notes open. */
export const clearAllWriteFirst = (): void => {
  writeFirst.clear();
  proposed.clear();
};
/** Whether this note was already offered its home (once per note). */
export const takePropose = (path: string): boolean => {
  if (proposed.has(path)) return false;
  proposed.add(path);
  return true;
};

/** An empty write-first note closed: nothing behind, and nothing said (trashed quietly, so the Bin can
 *  still bring it back — Nov 2026 break: closing a blank note cried "Deleted Untitled"). Lives here, not
 *  in noteTypes: docs.ts release() calls it, and noteTypes statically imports the window's actions — importing it
 *  from there would drag the whole window (and its ?url assets) into every standalone bundle of docs.ts (5 Nov
 *  2026, vault suite: the save-docs harness could no longer build). The trash itself stays one dynamic import away
 *  through actions, the seam the harness stands in. */
export async function dropEmptyWriteFirst(path: string, text: string): Promise<boolean> {
  const { isEmptyNote } = await import('../../../shared/note-types');
  if (!isWriteFirst(path) || !isEmptyNote(text)) return false;
  clearWriteFirst(path);
  try {
    const { trashPath } = await import('./actions');
    await trashPath(path, { quiet: true });
    return true;
  } catch {
    return false;
  }
}
