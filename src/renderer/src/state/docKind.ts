// Docs in the window (src/shared/doc-file.ts, src/main/docs.ts): a new doc (from a doc template or blank), a project
// turned into a doc and back (with Undo), and a doc's canvas — shown (made the first time from the doc) and brought in
// step with the doc in place. The side bar, the doc page, the project page and the commands all run these.

import { buildDocCanvas, syncDocCanvas, syncWords } from '../../../shared/doc-canvas';
import { docCanvasPath, parseDoc, setDocProp } from '../../../shared/doc-file';
import type { CanvasBoard } from '../../../shared/project-canvas';
import type { DocConvertResult } from '../../../shared/types';
import type { TemplateInfo } from '../../../shared/templates';
import { confirm, prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import * as A from './actions';
import { bookmarksRenamed } from './bookmarks';
import { docs } from './docs';
import { getWorkspace, setWorkspace } from './layout';
import { getState, loadFiles, loadNotes, showError, toast } from './store';
import { markTemplateUsed } from './templateUsed';
import * as W from './workspace';

export { isDocPath } from '../lib/docPath';

const where = (): W.Where => (W.activeTab(getWorkspace()).type === 'empty' ? 'current' : 'tab');

/** The doc templates (Templates/Docs), Ironleaf's in their order. */
async function docTemplates(): Promise<TemplateInfo[]> {
  return (await window.nv.templates.list()).templates.filter((t) => t.kind === 'doc');
}

/** "New doc": which kind (a doc template, or blank), then its name; made in Docs and opened. */
export async function newDoc(template?: string): Promise<string | null> {
  try {
    let chosen = template;
    if (chosen === undefined) {
      const all = await docTemplates();
      const id = await pick({
        placeholder: 'What kind of doc?',
        items: (q) => [
          ...fuzzyFilter(all, q, (t) => `${t.name} ${t.description}`).map((t) => ({ id: t.path, label: t.name, detail: t.description, icon: 'doc' as const })),
          ...(!q.trim() || 'blank doc'.includes(q.trim().toLowerCase()) ? [{ id: '', label: 'Blank doc', detail: 'Just a title, a summary and Changes', icon: 'filePlus' as const }] : []),
        ],
        footer: '↑↓ to move · Enter to choose · Esc to cancel',
      });
      if (id === null || id === undefined) return null;
      chosen = id;
    }
    const kind = chosen ? (await docTemplates()).find((t) => t.path === chosen)?.name : undefined;
    const name = await prompt(kind ? `New doc: ${kind}` : 'New doc', { placeholder: 'For example: Minecraft server', ok: 'Make the doc', message: 'A doc is how something is set up and run: its sections are kept up to date in place, with a dated line in Changes when something changes.' });
    if (!name?.trim()) return null;
    const path = await window.nv.docs.create(name.trim(), chosen || undefined);
    if (chosen) markTemplateUsed(chosen);
    await Promise.all([loadNotes(), loadFiles()]);
    A.openPath(path, { where: where() });
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** Open tabs, bookmarks and unsaved words follow files a conversion moved; tabs of files it sent away close. */
async function follow(r: DocConvertResult): Promise<void> {
  for (const [from, to] of r.moves) {
    await docs.renamed(from, to);
    setWorkspace((ws) => W.renamed(ws, from, to));
    bookmarksRenamed(from, to);
  }
  for (const p of r.trashed) docs.forget(p);
  const gone = new Set(r.trashed);
  setWorkspace((ws) => W.removed(ws, (p) => !gone.has(p)));
  await Promise.all([loadNotes(), loadFiles()]);
}

function withUndo(r: DocConvertResult): void {
  toast(r.words, {
    label: 'Undo',
    run: () =>
      void window.nv.docs
        .undo(r.path)
        .then(async (u) => {
          await follow(u);
          A.openPath(u.path, { where: 'current' });
          toast(u.words);
        })
        .catch(showError),
  });
}

/** "Turn into a doc": a project that is really documentation, converted in place (after one plain question). */
export async function turnIntoDoc(projectPath: string): Promise<void> {
  const name = getState().byPath.get(projectPath)?.label ?? A.titleOf(projectPath);
  const ok = await confirm(`Turn “${name}” into a doc?`, {
    message: 'A doc is for how something is set up and run, with no status, health or due dates. Every word is kept: the summary stays the summary, its pages become sections, its updates become Changes, and its canvas comes too. Links to it and its pages are sent to the doc. The project file and its pages go to Recently deleted, and Undo puts everything back.',
    ok: 'Turn into a doc',
  });
  if (!ok) return;
  try {
    await docs.settle();
    const r = await window.nv.docs.toDoc(projectPath);
    await follow(r);
    A.openPath(r.path, { where: 'current' });
    withUndo(r);
  } catch (err) {
    showError(err);
  }
}

/** "Turn into a project": a doc that turned out to be work with an end. */
export async function turnIntoProject(docPath: string): Promise<void> {
  const ok = await confirm(`Turn “${A.titleOf(docPath)}” into a project?`, {
    message: 'Projects are for work with an end: it gets a status, health and a page with next steps and dates. Every word is kept: its summary becomes the project’s summary and Changes become its updates. The doc goes to Recently deleted, and Undo puts it back.',
    ok: 'Turn into a project',
  });
  if (!ok) return;
  try {
    await docs.settle();
    const r = await window.nv.docs.toProject(docPath);
    await follow(r);
    A.openPath(r.path, { where: 'current' });
    withUndo(r);
  } catch (err) {
    showError(err);
  }
}

/** A file's words: from an open tab when it is open (so nothing unsaved is missed), else from disk. */
const textOf = (path: string): Promise<string | null> => docs.readThrough(path).catch(() => null);
/** Words written: through the open tab when it is open (it shows them straight away), else to disk. */
const writeOf = async (path: string, text: string, origin: string): Promise<void> => {
  await docs.writeThrough(path, text, origin);
};

/** The doc's canvas as its `canvas:` says (when that file is there), else the usual one beside it when it is there. */
async function canvasOf(docPath: string, text: string): Promise<string | null> {
  const named = parseDoc(text, docPath).canvas;
  for (const c of [named, docCanvasPath(docPath)]) if (c && (await window.nv.files.readText(c).then(() => true, () => false))) return c;
  return null;
}

/** "Show as canvas": the doc's canvas, made the first time from the doc (its card in the middle, a card per section),
 * and `canvas:` written into the doc. */
export async function showDocCanvas(docPath: string): Promise<void> {
  try {
    const text = await textOf(docPath);
    if (text === null) throw new Error('That doc isn’t there any more.');
    let canvas = await canvasOf(docPath, text);
    if (!canvas) {
      const target = docCanvasPath(docPath);
      canvas = await window.nv.files.create(A.folderOf(target), A.titleOf(target), '.canvas', JSON.stringify(buildDocCanvas(docPath, text), null, '\t'));
      await writeOf(docPath, setDocProp(text, 'canvas', canvas), 'doc-canvas');
      void loadFiles();
      toast(`Made a canvas for ${parseDoc(text, docPath).name}: a card for each section, each opening the doc there.`);
    } else if (parseDoc(text, docPath).canvas !== canvas) await writeOf(docPath, setDocProp(text, 'canvas', canvas), 'doc-canvas');
    A.openPath(canvas, { where: where(), reuse: true });
  } catch (err) {
    showError(err);
  }
}

/** "Update canvas from doc": the canvas brought in step in place — sections added, renamed or taken out; the person's
 * own cards and where everything sits kept. Never a second canvas. */
export async function updateDocCanvas(docPath: string, opts: { open?: boolean } = {}): Promise<void> {
  try {
    const text = await textOf(docPath);
    if (text === null) throw new Error('That doc isn’t there any more.');
    const canvas = await canvasOf(docPath, text);
    if (!canvas) return void (await showDocCanvas(docPath));
    const before = await textOf(canvas);
    let board: CanvasBoard;
    try {
      board = JSON.parse(before ?? '') as CanvasBoard;
    } catch {
      board = { nodes: [], edges: [] };
    }
    const r = syncDocCanvas({ ...board, nodes: board.nodes ?? [], edges: board.edges ?? [] }, docPath, text);
    if (r.changed) await writeOf(canvas, JSON.stringify(r.board, null, '\t'), 'doc-sync');
    toast(syncWords(r));
    if (opts.open) A.openPath(canvas, { where: where(), reuse: true });
  } catch (err) {
    showError(err);
  }
}
