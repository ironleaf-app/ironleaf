// Whether a note is a doc (src/shared/doc-file.ts), as the index has it: its type, or a note directly in the Docs folder
// with no type of its own. Small and standalone, so the editor can ask without pulling in the window's actions.

import { DOCS_FOLDER, isDocNote } from '../../../shared/doc-file';
import { getState } from '../state/store';

export function isDocPath(path: string | undefined): boolean {
  if (!path || !/\.md$/i.test(path)) return false;
  return isDocNote(path, getState().byPath.get(path)?.props, DOCS_FOLDER);
}
