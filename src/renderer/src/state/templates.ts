// Templates in the window (src/shared/templates.ts): the Templates page in its own tab, a new note from a template (from
// the command list, the file list, a project's page), a note saved as a template, a new template, a new project from a
// project template. Every button, menu and command runs these.

import { formatDate } from '../../../shared/dates';
import { isProjectProps } from '../../../shared/project-file';
import type { TemplateGroup, TemplateInfo } from '../../../shared/templates';
import { choose, prompt } from '../components/Dialogs';
import type { MenuItem } from '../components/Menu';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { isDailyTemplate } from '../lib/templateIdentity';
import * as A from './actions';
import { docs } from './docs';
import { getWorkspace, setWorkspace } from './layout';
import { openModal } from './modals';
import { getState, loadNotes, showError, toast } from './store';
import * as W from './workspace';
import { askTemplateAnswers, placeCursorLater } from './templateFields';
import { markTemplateUsed } from './templateUsed';

/** The Templates page: its own tab (the one showing, else a new one beside the page someone is on). From a project's page
 * it carries the project, so notes made there go in the project's folder. */
export function openTemplates(project?: string): void {
  const ws = getWorkspace();
  const existing = W.groups(ws.root).flatMap((g) => g.tabs.map((t) => ({ g, t }))).find(({ t }) => t.type === 'templates');
  if (existing) {
    setWorkspace((w) => W.updateTab(W.activate(w, existing.g.id, existing.t.id), existing.t.id, { path: project }));
    return;
  }
  const where: W.Where = W.activeTab(ws).type === 'empty' ? 'current' : 'tab';
  setWorkspace((w) => W.open(w, { type: 'templates', path: project }, where));
}

/** The project the person is in: the project page showing, or the Templates page opened from one. */
export function currentProject(): string | undefined {
  const tab = W.activeTab(getWorkspace());
  if (!tab.path) return undefined;
  if (tab.type === 'templates') return tab.path;
  return tab.type === 'note' && isProjectProps(getState().byPath.get(tab.path)?.props) ? tab.path : undefined;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  return (await window.nv.templates.list()).templates;
}

/** The note templates to pick from: the person's own first (changed lately first), then Ironleaf's in their order. */
export async function noteTemplates(): Promise<TemplateInfo[]> {
  const notes = (await listTemplates()).filter((t) => t.kind === 'note');
  return [...notes.filter((t) => !t.builtIn).sort((a, b) => b.modified - a.modified), ...notes.filter((t) => t.builtIn)];
}

/** What a note made from a template is called at first (the person changes it before it is made). */
const firstName = (t: TemplateInfo) => `${t.name} ${formatDate('D MMM YYYY')}`;

/** A first name still free in the folder (9.2 uplift F70): the plain date name, else with the time, else
 *  counted up — the default offered is always free, so two notes made from one template on one day never
 *  collide into "… 2" duplicates. */
const freeFirstName = (t: TemplateInfo, folder: string): string => {
  const base = firstName(t);
  const taken = new Set(getState().notes.filter((n) => A.folderOf(n.path) === folder).map((n) => n.title.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const timed = `${t.name} ${formatDate('D MMM YYYY h:mm A')}`;
  let name = timed;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${timed} ${i}`;
  return name;
};

/** Where a new note goes: the project's folder (beside its project file, so it shows on the project's page), else where
 * Settings › Files and links put new notes. */
function placeFor(project?: string, folder?: string): string {
  if (folder !== undefined) return folder;
  if (project) return A.folderOf(project);
  return A.newNoteFolder();
}

/** A note made from a template: its name asked (with where it goes), then made and opened. */
export async function startFromTemplate(t: TemplateInfo, opts: { project?: string; folder?: string } = {}): Promise<string | null> {
  if (t.kind === 'project') {
    openModal({ kind: 'new-project', template: t.path });
    return null;
  }
  if (t.kind !== 'note') return null;
  // Today's note's template: today's note (made from it when it isn't there yet). By identity (9.2 uplift
  // F2), never by matching "today" in the template's own words.
  if (isDailyTemplate(t) && !opts.project) {
    await A.openDaily();
    return null;
  }
  const project = opts.project;
  const folder = placeFor(project, opts.folder);
  const projectName = project ? getState().byPath.get(project)?.title : undefined;
  const where = project ? `It goes in ${projectName ? `${projectName}’s folder` : A.folderOf(project)}, linked to the project.` : folder ? `It goes in ${folder}.` : 'It goes at the top of your notes.';
  const name = await prompt(`New note from “${t.name}”`, { value: freeFirstName(t, folder), ok: 'Make the note', message: where });
  if (!name) return null;
  // Its prompts asked for and its AI fields written, when it has them (state/templateFields.ts; 21 Oct 2026, gap G27).
  const answers = await askTemplateAnswers(t.text, { template: t.path, name: t.name, title: name, project });
  if (!answers) return null;
  try {
    const { path, cursor } = await window.nv.templates.make(t.path, name, folder, project, answers);
    markTemplateUsed(t.path);
    await loadNotes();
    const active = W.activeTab(getWorkspace());
    A.openPath(path, { where: active.type === 'empty' || (active.type === 'note' && active.mode !== 'page' && !project) ? 'current' : 'tab' });
    if (cursor) placeCursorLater(path, cursor);
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** "New note from a template": which one (the note templates, newest changed first), then its name. */
export async function newNoteFromTemplate(opts: { project?: string; folder?: string } = {}): Promise<void> {
  try {
    const all = await noteTemplates();
    if (!all.length) {
      toast('No note templates yet.', { label: 'Templates', run: () => openTemplates() });
      return;
    }
    const id = await pick({
      placeholder: 'New note from which template?',
      items: (q) => fuzzyFilter(all, q, (t) => `${t.name} ${t.description}`).map((t) => ({ id: t.path, label: t.name, detail: t.description, icon: 'template' as const })),
      extraRow: () => ({ label: 'See every template…', run: () => openTemplates(opts.project ?? currentProject()) }),
      footer: '↑↓ to move · Enter to choose · Esc to cancel',
    });
    const chosen = all.find((t) => t.path === id);
    if (chosen) await startFromTemplate(chosen, { project: opts.project ?? (opts.folder === undefined ? currentProject() : undefined), folder: opts.folder });
  } catch (err) {
    showError(err);
  }
}

/** The note templates as menu items (a project page's New note, a folder's menu). */
export async function templateMenuItems(opts: { project?: string; folder?: string }): Promise<MenuItem[]> {
  // Today's note isn't one a project makes.
  const notes = (await noteTemplates()).filter((t) => !(opts.project && isDailyTemplate(t)));
  return notes.slice(0, 12).map((t) => ({ label: t.name, icon: 'template', run: () => void startFromTemplate(t, opts) }));
}

/** "Save as template": the note (or a project's shape) into the templates folder, opened to tidy up. */
export async function saveAsTemplate(path: string): Promise<void> {
  const isProject = isProjectProps(getState().byPath.get(path)?.props);
  const name = await prompt(isProject ? 'Save as a project template' : 'Save as a template', {
    value: A.titleOf(path),
    ok: 'Save the template',
    message: isProject ? 'New projects can start from its next steps, key dates and risks (none ticked). Its folder, progress, updates and decisions stay with this project.' : 'Its words start every note made from it. {{title}}, {{date}} and {{project}} are filled in when one is made.',
  });
  if (!name) return;
  try {
    await docs.settle();
    const made = await window.nv.templates.saveAs(path, name);
    await loadNotes();
    toast(`Saved as the template “${A.titleOf(made)}”.`, { label: 'Templates', run: () => openTemplates() });
  } catch (err) {
    showError(err);
  }
}

/** A new template of the person's own: which kind, its name, then open to write. */
export async function newTemplate(group?: TemplateGroup): Promise<void> {
  const kind = group ?? ((await choose('New template', [{ id: 'projects', label: 'For a project' }, { id: 'notes', label: 'For a note', primary: true }], 'A note template starts a note’s words. A project template is the shape of a new project: its first next steps, key dates and risks.')) as TemplateGroup | null);
  if (!kind) return;
  const name = await prompt(kind === 'projects' ? 'New project template' : 'New note template', { ok: 'Make the template', placeholder: kind === 'projects' ? 'For example: Office move' : 'For example: One-on-one' });
  if (!name) return;
  try {
    const path = await window.nv.templates.create(kind, name);
    await loadNotes();
    A.openPath(path, { where: 'tab' });
  } catch (err) {
    showError(err);
  }
}

/** A new project by hand: the New project window, where its shape is chosen. */
export function newProject(template?: string): void {
  openModal({ kind: 'new-project', template });
}
