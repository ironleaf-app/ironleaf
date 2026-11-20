// Folding one area into another from the window (9 Nov 2026; the list: "Health and Publications fold into Me
// once the app allows"). From an area's folder menu and Ctrl+K: "Move into another area…", then pick the area.
// One plain preview, one Undo on the message after.

import { confirm } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { currentArea, getAreas, loadAreas } from './areas';
import { docs } from './docs';
import { getState, loadFiles, loadNotes, showError, toast } from './store';

/** Which area a folder is (by its folder, however written). */
const areaOfFolder = (folder: string) => {
  const clean = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return (getAreas()?.areas ?? []).find((a) => a.folder.toLowerCase() === clean.toLowerCase());
};

/** The folder to fold from a Ctrl+K context: the area page open, else the note's area folder, else asked. */
async function folderFromContext(path?: string): Promise<string | null> {
  const areas = getAreas()?.areas ?? [];
  const here = currentArea();
  if (here) return here.folder;
  if (path) {
    const top = path.replace(/\\/g, '/').split('/')[0];
    if (areas.some((a) => a.folder.toLowerCase() === top.toLowerCase())) return top;
  }
  const id = await pick({
    placeholder: 'Move which area?',
    items: (q) => fuzzyFilter(areas, q, (a) => `${a.name} ${a.folder}`).map((a) => ({ id: a.id, label: a.name, detail: a.folder })),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
  if (id === null) return null;
  return areas.find((a) => a.id === id)?.folder ?? null;
}

/** "Move into another area…": pick the area, one plain preview, then move with one Undo after. */
export async function foldArea(from: string): Promise<void> {
  const areas = getAreas()?.areas ?? [];
  if (!areas.length) {
    showError(new Error('Set up areas first, then fold.'));
    return;
  }
  const clean = from.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const name = clean.includes('/') ? clean.slice(clean.lastIndexOf('/') + 1) : clean;
  const fromArea = areaOfFolder(clean);
  const choices = areas.filter((a) => a.id !== fromArea?.id);
  if (!choices.length) {
    showError(new Error('There is no other area to move into.'));
    return;
  }
  const id = await pick({
    placeholder: `Move ${name} into which area?`,
    items: (q) => fuzzyFilter(choices, q, (a) => `${a.name} ${a.folder}`).map((a) => ({ id: a.id, label: a.name, detail: `${a.folder}/${name}` })),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
  if (id === null) return;
  let plan: { fromName: string; toName: string; words: string[] };
  try {
    plan = await window.nv.life.areas.foldPreview(clean, id);
  } catch (err) {
    showError(err);
    return;
  }
  if (!(await confirm(`Move ${plan.fromName} into ${plan.toName}?`, { message: plan.words.join(' '), ok: `Move into ${plan.toName}` }))) return;
  try {
    await docs.settle();
    const words = await window.nv.life.areas.foldRun(clean, id);
    await Promise.all([loadAreas(true), loadNotes(), loadFiles()]);
    toast(words, { label: 'Undo', run: () => void undoFold() }, 9000);
  } catch (err) {
    await Promise.all([loadAreas(true), loadNotes(), loadFiles()]);
    showError(err);
  }
}

/** The fold from Ctrl+K: the area open, else the note's area, else asked. */
export async function foldFromCommand(path?: string): Promise<void> {
  const folder = await folderFromContext(path);
  if (folder) await foldArea(folder);
}

/** One Undo: the last fold back where it was, every file and every link. */
export async function undoFold(): Promise<void> {
  try {
    await docs.settle();
    const words = await window.nv.life.areas.foldUndo();
    await Promise.all([loadAreas(true), loadNotes(), loadFiles()]);
    toast(words);
  } catch (err) {
    showError(err);
  }
}

export const canFold = (): boolean => getState().canEdit && (getAreas()?.areas.length ?? 0) > 1;
