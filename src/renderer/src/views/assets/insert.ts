// Assets into notes: the embed written for an asset (with its alt text), the note it goes into from the Assets page
// (the note being worked on beside it, else the last one open), the picker a note's / menu opens, and the brand kit.

import type { EditorView } from '@codemirror/view';
import type { AssetEntry } from '../../../../shared/assets';
import { isPrivatePath } from '../../../../shared/private';
import { shownInPlace, writeLink } from '../../lib/links';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { editorFor, getWorkspace } from '../../state/layout';
import { getState, showError, toast } from '../../state/store';
import * as W from '../../state/workspace';
import { pickAsset } from './AssetPicker';
import { setAssets } from './store';

/** The words to put in a note for an asset: shown in place (a picture, a PDF, a recording), with its alt text. */
export function embedFor(a: Pick<AssetEntry, 'path' | 'alt'>, note?: string): string {
  const embed = shownInPlace(a.path);
  return writeLink(a.path, note, { embed, ...(a.alt && embed ? { alias: a.alt } : {}) });
}

/** The note an asset goes into from the Assets page: one showing beside it (the last worked on), else the last opened. */
export function noteTarget(): { path: string; view: EditorView | null } | null {
  const ws = getWorkspace();
  const shown = W.groups(ws.root)
    .map((g) => g.tabs.find((t) => t.id === g.active))
    .filter((t): t is W.TabState => !!t && t.type === 'note' && !!t.path && !isPrivatePath(t.path) && (t.mode ?? 'live') !== 'reading');
  const order = (p?: string) => {
    const i = p ? ws.recent.indexOf(p) : -1;
    return i < 0 ? 1e6 : i;
  };
  const tab = [...shown].sort((a, b) => order(a.path) - order(b.path))[0];
  if (tab) return { path: tab.path!, view: editorFor(tab.id)?.view() ?? null };
  const recent = ws.recent.find((p) => /\.md$/i.test(p) && !isPrivatePath(p) && getState().byPath.has(p));
  return recent ? { path: recent, view: null } : null;
}

/** Puts an asset into the note being worked on: at its cursor, or at the end of the last note opened. */
export async function insertIntoNote(a: AssetEntry): Promise<void> {
  const target = noteTarget();
  if (!target) {
    toast('Open a note first, then insert the asset into it.');
    return;
  }
  const words = embedFor(a, target.path);
  const title = A.titleOf(target.path);
  try {
    if (target.view) {
      const view = target.view;
      const sel = view.state.selection.main;
      const before = sel.from > 0 ? view.state.sliceDoc(sel.from - 1, sel.from) : '\n';
      const insert = `${before === '\n' ? '' : '\n'}${words}\n`;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, scrollIntoView: true });
      toast(`Inserted into “${title}”.`);
      return;
    }
    const text = await docs.readThrough(target.path);
    await docs.writeThrough(target.path, `${text.replace(/\s*$/, '')}\n\n${words}\n`, 'asset');
    toast(`Added to the end of “${title}”.`, { label: 'Open', run: () => A.openPath(target.path, { where: 'tab', reuse: true }) });
  } catch (err) {
    showError(err);
  }
}

/** Copies the link to an asset (as an embed, ready to paste into a note). */
export async function copyLink(a: AssetEntry): Promise<void> {
  try {
    await navigator.clipboard.writeText(embedFor(a, noteTarget()?.path));
    toast('Link copied: paste it into a note.');
  } catch (err) {
    showError(err);
  }
}

/** A note's "Picture from assets" (the / menu, the command list): chosen in the picker, put in at the cursor. */
export async function insertFromAssets(view: EditorView, note = A.activePath()): Promise<void> {
  const chosen = await pickAsset();
  if (!chosen) {
    view.focus();
    return;
  }
  const words = embedFor(chosen, note);
  view.dispatch(view.state.replaceSelection(words));
  view.focus();
}

/** The brand kit, on the Assets page. */
export function openBrandKit(): void {
  setAssets({ section: { kind: 'brand' }, selected: null });
  A.openAssets();
}
