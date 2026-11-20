// A life module's page in the workspace (Wave 5, 24 Oct 2026): one tab, "module:<id>#<part>". Pure: from one layout to
// the next (src/renderer/src/state/workspace.ts), so it is proved without a window (tests/module-tabs.test.mjs).

import * as W from './workspace';
import { resolveModule } from '../../../shared/life-modules';

export const moduleTabPath = (id: string, part?: string) => `module:${id}${part ? `#${part}` : ''}`;
export function moduleOfTab(tab: Pick<W.TabState, 'type' | 'path'>): string | undefined {
  // Meetings tabs are their own type, not module: tabs (3 Nov 2026, audit f F2: switching Meetings
  // off closed nothing because these never matched); they belong to the Meetings pack.
  if (tab.type === 'meetings') return 'meetings';
  if (tab.type !== 'module' || !tab.path?.startsWith('module:')) return undefined;
  // A merged pack's old tabs land on the pack that answers now (packs uplift item 5: module:memories tabs
  // read as Family, with their part riding along).
  const id = tab.path.slice(7).split('#')[0] || undefined;
  return id ? resolveModule(id) : undefined;
}
export const partOfTab = (tab: Pick<W.TabState, 'path'>): string | undefined => tab.path?.split('#')[1] || undefined;

/**
 * The layout with a module's page shown. Its tab already open anywhere (the one in front first) is brought forward at the
 * part asked for; asked for the module itself (no part), a tab left on another page comes back to its first page, in that
 * same tab, pinned or not (a pinned tab is changed in place rather than a second tab of the module opened beside it).
 * Not open, or asked for elsewhere (a new tab, beside): opened where asked.
 */
export function withModuleOpen(ws: W.Workspace, id: string, part?: string, where: W.Where = 'current'): W.Workspace {
  const path = moduleTabPath(id, part);
  const all = W.groups(ws.root).flatMap((g) => g.tabs.map((t) => ({ g, t })));
  const mine = all.filter(({ t }) => moduleOfTab(t) === id);
  const front = (x: { g: W.Group; t: W.TabState }) => (x.g.id === ws.activeGroup ? 2 : 0) + (x.g.active === x.t.id ? 1 : 0);
  const existing = mine.sort((a, b) => front(b) - front(a))[0];
  if (!existing || where !== 'current') return W.open(ws, { type: 'module', path }, where);
  const shown = W.activate(ws, existing.g.id, existing.t.id);
  if (existing.t.path === path) return shown;
  if (!existing.t.pinned) return W.open(shown, { type: 'module', path }, 'current');
  const opened = W.open(W.updateTab(shown, existing.t.id, { pinned: false }), { type: 'module', path }, 'current');
  return W.updateTab(opened, existing.t.id, { pinned: true });
}
