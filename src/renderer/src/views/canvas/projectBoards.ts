// Opening project canvases (src/shared/project-canvas.ts): a project's own canvas beside its file, and the portfolio
// board in the projects folder — each made, laid out, the first time it's opened.

import type { Project } from '../../../../shared/project-file';
import { layoutPortfolio, layoutProject, portfolioPath, projectCanvasPath, type PortfolioEntry } from '../../../../shared/project-canvas';
import * as A from '../../state/actions';
import { getWorkspace } from '../../state/layout';
import { loadFiles, showError, toast } from '../../state/store';
import * as W from '../../state/workspace';

const exists = (path: string) => window.nv.files.readText(path).then(
  () => true,
  () => false,
);

/** Where it opens: beside the page someone is on (a new tab), or in the empty tab they're looking at. */
const where = (): W.Where => (W.activeTab(getWorkspace()).type === 'empty' ? 'current' : 'tab');

// One make in flight per board (W5-34): a second click joins it instead of making a copy.
const making = new Map<string, Promise<void>>();
async function makeAndOpen(target: string, board: unknown): Promise<void> {
  const running = making.get(target);
  if (running) return running;
  const run = (async () => {
    let path = target;
    if (!(await exists(target))) {
      path = await window.nv.files.create(A.folderOf(target), A.titleOf(target), '.canvas', JSON.stringify(board, null, '\t'));
      void loadFiles();
    }
    A.openPath(path, { where: where(), reuse: true });
  })();
  making.set(target, run);
  try {
    await run;
  } finally {
    making.delete(target);
  }
}

/** A project as a canvas: its card in the middle, its facts around it, bound to its file. */
export async function openProjectCanvas(projectPath: string): Promise<void> {
  try {
    const target = projectCanvasPath(projectPath);
    if (await exists(target)) return A.openPath(target, { where: where(), reuse: true });
    const view = await window.nv.projects.view(projectPath);
    await makeAndOpen(target, layoutProject(view.project, projectPath));
  } catch (err) {
    showError(err);
  }
}

/** Every project with its facts (for the portfolio board). */
export async function loadPortfolio(): Promise<PortfolioEntry[]> {
  const cards = await window.nv.projects.list();
  const [views, links] = await Promise.all([Promise.all(cards.map((c) => window.nv.projects.view(c.path).catch(() => null))), window.nv.projects.relations().catch(() => null)]);
  const related = (path: string) => (links ? links.filter((l) => l.a === path || l.b === path).map((l) => ({ other: l.a === path ? l.b : l.a, reasons: l.reasons })) : undefined);
  return views.filter((v): v is { path: string; project: Project } & NonNullable<typeof v> => !!v).map((v) => ({ path: v.path, project: v.project, related: related(v.path) }));
}

/** Every project as a card in columns by status (or health): drag a card to another column to change it. */
export async function openPortfolioBoard(): Promise<void> {
  try {
    const entries = await loadPortfolio();
    if (!entries.length) {
      toast('There are no projects yet: set them up from the Projects home first.');
      return;
    }
    const target = portfolioPath(entries.map((e) => e.path));
    if (await exists(target)) return A.openPath(target, { where: where(), reuse: true });
    await makeAndOpen(target, layoutPortfolio(entries, 'status'));
  } catch (err) {
    showError(err);
  }
}
