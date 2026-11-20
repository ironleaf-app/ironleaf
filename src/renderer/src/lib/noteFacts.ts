// One of a note's own facts changed where it shows (round 2, 4 Nov 2026, the ): a meeting's day,
// time, attendees or project, a person's role, organisation or contact facts, a note's own facts.
// The peek and the People's cards and pages all save through here: the note as it is now, one
// property written (src/shared/views.ts setNoteProp, on the mapping in src/shared/records.ts
// noteFactWrite), saved like any note edit, said once, with Undo. A file moved since refuses
// instead of clobbering (the guarded save keeps both); a fact with no property to write stays
// read-only.
import { noteFactWrite, type VaultRecord } from '../../../shared/records';
import { readProps } from '../../../shared/frontmatter';
import { setNoteProp } from '../../../shared/views';
import { docs } from '../state/docs';
import { showError, toast } from '../state/store';

/** One note fact saved (true when written). `record` needs only its type and page. */
export async function saveNoteFact(path: string, record: Pick<VaultRecord, 'type' | 'page'>, fact: string, value: string, words: string): Promise<boolean> {
  let current: string;
  try {
    current = await docs.readThrough(path);
  } catch (err) {
    showError(err);
    return false;
  }
  const write = noteFactWrite(record, fact, readProps(current), value);
  if (!write) {
    toast('That is not changeable here any more.');
    return false;
  }
  let next: string;
  try {
    next = setNoteProp(current, write.key, write.value);
  } catch (err) {
    showError(err);
    return false;
  }
  if (next === current) return true;
  try {
    await docs.writeThrough(path, next, 'note-fact');
  } catch (err) {
    showError(err);
    return false;
  }
  toast(words, {
    label: 'Undo',
    run: () => {
      void (async () => {
        const now = await docs.readThrough(path).catch(() => null);
        if (now !== next) {
          toast('The note changed since, so nothing was undone.');
          return;
        }
        await docs.writeThrough(path, current, 'note-fact-undo').then(
          () => toast('Undone.'),
          showError,
        );
      })();
    },
  });
  return true;
}
