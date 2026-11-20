// Views over the whole vault's records in the window (24 Oct 2026, Workstream 1 part D): every project's actions, every
// meeting, every person — or any view the person saves from a project ("Save as a view of the whole vault"). Each is a
// small file in the vault (.neuralvault/views, src/main/workspaces.ts), so it syncs; the three ready-made ones are written
// the first time the person changes them. A tab shows one ("records:<file>").

import { defaultFields, defaultRecordView, readRecordView, writeRecordView, type RecordViewDef } from '../../../shared/record-views';
import { KIND_WORDS, type RecordKind } from '../../../shared/workspace-records';
import { prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { getWorkspace, setWorkspace } from './layout';
import { showError } from './store';
import * as W from './workspace';

export const RECORDS_TAB = 'records:';

/** The ready-made views: every action across the projects, every meeting, everyone. */
export const PRESETS: Record<string, RecordViewDef> = {
  'all-actions.json': { ...defaultRecordView(['action'], 'table', 'All actions'), scope: 'vault', fields: ['project', 'owner', 'due', 'status'], groupBy: 'due_group', sort: { field: 'due', dir: 'asc' } },
  'all-meetings.json': { ...defaultRecordView(['meeting'], 'list', 'All meetings'), scope: 'vault', fields: ['date', 'project', 'people'], sort: { field: 'date', dir: 'desc' } },
  'people.json': { ...defaultRecordView(['person'], 'gallery', 'People'), scope: 'vault', fields: ['role', 'company', 'projects', 'contact'], groupBy: 'company' },
  // Every file in the vault, by what it is for (Wave 4 part c): older versions folded out of the way until asked for.
  'all-files.json': { ...defaultRecordView(['file'], 'gallery', 'All files'), scope: 'vault', fields: ['version', 'from', 'what'], groupBy: 'purpose', sort: { field: 'added', dir: 'desc' }, filters: [{ field: 'status', op: 'is-not', value: 'Superseded' }] },
};

const titles = new Map<string, string>(Object.entries(PRESETS).map(([k, v]) => [k, v.title]));

export function recordsTitle(path: string | undefined): string {
  const name = path?.startsWith(RECORDS_TAB) ? path.slice(RECORDS_TAB.length) : '';
  return titles.get(name) ?? 'View';
}
export function rememberTitle(name: string, title: string): void {
  titles.set(name, title);
}

/** A view's file (a ready-made one as it comes when it hasn't been changed). */
export async function loadRecordsView(name: string): Promise<{ def: RecordViewDef; saved: boolean }> {
  const list = await window.nv.recordViews.list();
  const found = list.find((v) => v.name === name);
  if (found) {
    const def = readRecordView(found.text).def;
    titles.set(name, def.title);
    return { def, saved: true };
  }
  if (PRESETS[name]) return { def: PRESETS[name], saved: false };
  throw new Error('That view isn’t in this vault any more.');
}

export async function saveRecordsView(name: string, def: RecordViewDef): Promise<void> {
  titles.set(name, def.title);
  await window.nv.recordViews.save(name, writeRecordView({ ...def, scope: 'vault' }));
}

export function openRecordsView(name: string, where: W.Where = 'current'): void {
  const path = `${RECORDS_TAB}${name}`;
  const ws = getWorkspace();
  const found = W.groups(ws.root)
    .flatMap((g) => g.tabs.map((t) => ({ g, t })))
    .find(({ t }) => t.type === 'records' && t.path === path);
  if (found && where === 'current') return setWorkspace((w) => W.activate(w, found.g.id, found.t.id));
  const active = W.activeTab(ws);
  setWorkspace((w) => W.open(w, { type: 'records', path }, where === 'current' && active.type !== 'empty' ? 'tab' : where));
}

/** "New view of records…": what it shows, its name; saved in the vault and opened. */
export async function newRecordsView(): Promise<void> {
  const kinds: RecordKind[] = ['action', 'meeting', 'person', 'milestone', 'risk', 'decision', 'file', 'workstream', 'update'];
  const id = await pick({
    placeholder: 'What should the view show, from every project?',
    items: (q) => kinds.filter((k) => KIND_WORDS[k].many.toLowerCase().includes(q.trim().toLowerCase())).map((k) => ({ id: k, label: KIND_WORDS[k].many, detail: 'From every project', icon: 'views' as const })),
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
  if (!id) return;
  const kind = id as RecordKind;
  const title = await prompt('Name the view', { value: `All ${KIND_WORDS[kind].many.toLowerCase()}`, ok: 'Make the view' });
  if (title === null) return;
  try {
    const def: RecordViewDef = { ...defaultRecordView([kind], 'table', title.trim() || `All ${KIND_WORDS[kind].many.toLowerCase()}`), scope: 'vault', fields: ['project', ...defaultFields([kind])] };
    const name = await window.nv.recordViews.save('', writeRecordView(def));
    titles.set(name, def.title);
    openRecordsView(name, 'tab');
  } catch (err) {
    showError(err);
  }
}
