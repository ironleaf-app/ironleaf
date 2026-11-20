// Starting from a template (8.8, src/shared/starter-templates.ts): the ten starters' files written into a folder the
// person names, then the main one opened. Files go through the same create as every note and view (names stay unique:
// "Weekly shop 2" rather than over anything), the notes list is read again, and the main file opens where it belongs
// (a view as its view, a project file as its page).

import { cleanStarterFolder, splitStarterPath, starterById, starterFiles, starterOpenPath } from '../../../shared/starter-templates';
import * as A from './actions';
import { loadFiles, loadNotes, showError, toast } from './store';

/** Today's date for starter content (shared with the picker's counts, so both read the same day). */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function startStarter(id: string, folderName: string): Promise<void> {
  const template = starterById(id);
  if (!template) return;
  const folder = cleanStarterFolder(folderName, template.folder);
  const today = todayIso();
  try {
    const made: string[] = [];
    for (const file of starterFiles(id, folder, today)) {
      const { folder: dir, base, ext } = splitStarterPath(file.path);
      made.push(await window.nv.files.create(dir, base, ext, file.text));
    }
    await Promise.all([loadNotes(), loadFiles()]);
    const openExpected = starterOpenPath(id, folder);
    const at = starterFiles(id, folder, today).findIndex((f) => f.path === openExpected);
    A.openPath(made[at] ?? made[0], { where: 'tab' });
    toast(`Made ${template.name} in “${folder}”.`);
  } catch (err) {
    await Promise.all([loadNotes().catch(() => undefined), loadFiles().catch(() => undefined)]);
    showError(err);
  }
}
