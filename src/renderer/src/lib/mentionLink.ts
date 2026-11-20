// One mention-to-link write (9.2 uplift F127): the side panel and the note foot share it, so a stale line or a
// failed write says the same words in both places, never silence in one of them.

import { docs } from '../state/docs';
import { showError, toast } from '../state/store';

/** Make the mention on the line a link to the note: true when linked. Stale lines and failures speak. */
export async function linkMentionLine(source: string, line: number, path: string): Promise<boolean> {
  try {
    // The other note's words not saved yet go first, so the link is written into what the person last typed.
    await docs.flush(source);
    const done = await window.nv.index.linkMention(source, line, path);
    if (!done) toast('That line has changed since, so nothing was linked. Have another look.');
    return done;
  } catch (err) {
    showError(err);
    return false;
  }
}
