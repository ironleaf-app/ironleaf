// One note's tags, read once per text (t102, 9 Nov 2026): the side panel and the context strip each scanned
// the whole note for tags on every keystroke. The same pure reading, kept for the text at hand — a new text
// reads again. Callers must not change the array handed back.
import { extractTags } from '../../../shared/markdown';

let text: string | null = null;
let tags: string[] = [];

/** The note's tags, as extractTags reads them. */
export function noteTags(content: string): string[] {
  if (content === text) return tags;
  text = content;
  tags = extractTags(content);
  return tags;
}
