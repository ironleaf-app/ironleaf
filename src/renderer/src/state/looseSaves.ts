// Loose files' pending saves, in one place (Nov 2026, nv-save F2): each open file outside the vault registers its
// save, so closing the window (or the machine going) flushes them with everything else instead of dropping the last
// half-second of typing. Saving one never throws (a failure shows in its own tab, and tries again from there).

type SaveFn = () => Promise<void>;

const pending = new Map<string, SaveFn>();

export const looseSaves = {
  /** A loose file tab's save, kept while the tab is open; the returned function unregisters it. */
  register(id: string, save: SaveFn): () => void {
    pending.set(id, save);
    return () => {
      if (pending.get(id) === save) pending.delete(id);
    };
  },

  /** Every loose file's waiting words, saved. */
  async flushAll(): Promise<void> {
    for (const save of [...pending.values()]) await save().catch(() => {});
  },
};
