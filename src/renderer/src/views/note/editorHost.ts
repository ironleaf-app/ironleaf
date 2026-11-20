// One editor host for every note (10.0 papercuts: the daily note the same everywhere): the note's tab, the day's
// note on Today and the canvas card editor all open links, tags, pictures and files the same way. A pasted picture is
// named for the moment it landed; the words selected become the link's name; a file dropped in shows in place when it
// can (a picture, a PDF, a recording) and is named otherwise.

import type { EditorView } from '@codemirror/view';
import { formatDate } from '../../../../shared/dates';
import type { EditorHost } from '../../editor/setup';
import { hoverLink } from '../../components/HoverPreview';
import { pickFile } from '../../components/Pickers';
import { shownInPlace, writeLink } from '../../lib/links';
import * as A from '../../state/actions';
import { insertTemplate } from '../../state/commands';
import { requestSearch } from '../../state/modals';
import { getState, loadFiles, prefs, showError } from '../../state/store';

/** The link to write for a file just added: shown in place (a picture, a PDF, a recording) or named (a note). */
function linkFor(rel: string, path: string): string {
  return writeLink(rel, path, { embed: shownInPlace(rel) });
}

/** The editor's host for a note: links, tags, pictures and files as every note's tab does them. */
export function noteEditorHost(path: string): Omit<EditorHost, 'path' | 'version' | 'onChange'> {
  return {
    openLink: (target, newTab) => void A.openLink(target, path, newTab ? 'tab' : 'current'),
    openUrl: (url) => window.open(url, '_blank'),
    openTag: (tag) => {
      requestSearch(`tag:#${tag}`);
    },
    hover: (target, anchor, held) => hoverLink(target, anchor, path, 350, held),
    insertTemplate: (view: EditorView) => void insertTemplate(view, path),
    linkToNote: async (view: EditorView) => {
      const chosen = await pickFile('Link to which note?', getState().notes.map((n) => n.path), A.titleOf);
      if (!chosen) return;
      const sel = view.state.selection.main;
      const words = view.state.sliceDoc(sel.from, sel.to).trim();
      view.dispatch(view.state.replaceSelection(writeLink(chosen, path, words && !words.includes('\n') ? { alias: words } : {})));
      view.focus();
    },
    saveFile: async (file: File) => {
      try {
        const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
        const name = generic ? `Picture ${formatDate('YYYY-MM-DD HH.mm.ss')}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : file.name;
        const rel = await window.nv.files.saveAttachment(name, new Uint8Array(await file.arrayBuffer()), path);
        await loadFiles();
        return linkFor(rel, path);
      } catch (err) {
        showError(err);
        return null;
      }
    },
    importFiles: async (paths: string[]) => {
      try {
        const rels = await window.nv.files.importPaths(paths, null, path);
        await loadFiles();
        return rels.map((rel) => linkFor(rel, path));
      } catch (err) {
        showError(err);
        return [];
      }
    },
    dateFormat: () => prefs().dateFormat,
    timeFormat: () => prefs().timeFormat,
    wikilinks: () => prefs().wikilinks,
  };
}
