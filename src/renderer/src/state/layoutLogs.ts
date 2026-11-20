// A log entry added from a project's dashboard (21 Oct 2026, docs/LAYOUTS.md): written into the project's log note in the
// contract's format (src/shared/layouts.ts appendLogEntry), or a new log note made beside the project's file the first
// time, with Undo. The dashboard redraws from the file the moment it is written (the notes' own change events).

import { appendLogEntry, newLogNote, type NewLogEntry } from '../../../shared/layouts';
import * as A from './actions';
import { docs } from './docs';
import { getState, loadNotes, showError, toast } from './store';

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Adds an entry to `log` (a note's path), or to a new log for the project when there is none. True when written. */
export async function addLogEntry(opts: { project: string; projectPath: string; log?: string; entry: NewLogEntry; fields?: string[]; units?: Record<string, string> }): Promise<boolean> {
  try {
    if (opts.log) {
      const before = await docs.readThrough(opts.log);
      const after = appendLogEntry(before, opts.entry);
      await docs.writeThrough(opts.log, after, 'log');
      await loadNotes();
      const name = opts.log.split('/').pop()!.replace(/\.md$/i, '');
      toast(`Added to ${name}.`, {
        label: 'Undo',
        run: () =>
          void (async () => {
            // Only when nothing else has changed it since.
            if ((await docs.readThrough(opts.log!)) !== after) return toast(`${name} has changed since, so it was left as it is.`);
            await docs.writeThrough(opts.log!, before, 'log');
            await loadNotes();
            toast('Took it back out.');
          })().catch(showError),
      });
      return true;
    }
    const dir = dirOf(opts.projectPath);
    const known = getState().byPath;
    // The project's log, found first (9.2 uplift F77): the log already there takes the entry, never a "… 2" beside it.
    const prefix = `${opts.project} log`.toLowerCase();
    const live = getState().notes.find((n) => A.folderOf(n.path) === dir && n.title.toLowerCase() === prefix) ?? getState().notes.find((n) => A.folderOf(n.path) === dir && n.title.toLowerCase().startsWith(`${prefix} `));
    let path = live?.path ?? `${dir ? `${dir}/` : ''}${opts.project} log.md`;
    for (let i = 2; !live && known.has(path) && i < 100; i++) path = `${dir ? `${dir}/` : ''}${opts.project} log ${i}.md`;
    const made = await window.nv.notes.create(path, newLogNote(opts.project, { fields: opts.fields, units: opts.units, entry: opts.entry }));
    await loadNotes();
    toast(`Started ${made.split('/').pop()!.replace(/\.md$/i, '')} with the first entry.`, { label: 'Open', run: () => A.openPath(made, { where: 'tab' }) });
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}
