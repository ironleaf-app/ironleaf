// Typing straight into a card on a canvas, with the app's own editor (Live Preview: headings, bold, lists, tick boxes,
// [[links]] and / for more). A text card edits its own words; a note card edits the note itself (saved to the note, as
// in its tab). Esc, or clicking away, leaves.

import { useEffect, useRef } from 'react';
import { EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { writeLink } from '../../lib/links';
import { pickFile } from '../../components/Pickers';
import { insertTemplate } from '../../state/commands';
import { docs } from '../../state/docs';
import * as A from '../../state/actions';
import { getState, loadFiles, prefs, showError } from '../../state/store';
import { buildExtensions, newCompartments, type EditorHost } from '../../editor/setup';

export interface CardEditorProps {
  /** A text card's words (its own), or the note a note card shows (edited in place). */
  source: { kind: 'text'; text: string } | { kind: 'note'; path: string };
  /** Where links are written from (the canvas for a text card). */
  from: string;
  /** One line (a fact on a project's canvas): Enter finishes. */
  singleLine?: boolean;
  onChange?(text: string, contentHeight: number): void;
  onDone(text: string): void;
}

export function CardEditor({ source, from, singleLine, onChange, onDone }: CardEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  const changed = useRef(onChange);
  done.current = onDone;
  changed.current = onChange;
  const notePath = source.kind === 'note' ? source.path : null;

  useEffect(() => {
    let view: EditorView | null = null;
    let finished = false;
    let unsubscribe = () => {};
    let alive = true;
    const finish = () => {
      if (finished || !view) return true;
      finished = true;
      done.current(view.state.doc.toString());
      return true;
    };
    void (async () => {
      const text = notePath ? await docs.acquire(notePath).catch(() => null) : (source as { text: string }).text;
      if (!alive) {
        if (notePath && text !== null) docs.release(notePath);
        return;
      }
      if (text === null || !parent.current) return;
      const path = notePath ?? from;
      const host: EditorHost = {
        path,
        version: () => getState().revision,
        openLink: (t, n) => void A.openLink(t, path, n ? 'right' : 'tab'),
        openUrl: (u) => window.open(u, '_blank'),
        openTag: () => {},
        hover: () => {},
        insertTemplate: (v) => void insertTemplate(v, path),
        linkToNote: async (v) => {
          const chosen = await pickFile('Link to which note?', getState().notes.map((n) => n.path), A.titleOf);
          if (!chosen) return;
          v.dispatch(v.state.replaceSelection(writeLink(chosen, path)));
          v.focus();
        },
        saveFile: async (file) => {
          try {
            const rel = await window.nv.files.saveAttachment(file.name || 'Picture.png', new Uint8Array(await file.arrayBuffer()), path);
            await loadFiles();
            return `![[${rel}]]`;
          } catch (err) {
            showError(err);
            return null;
          }
        },
        importFiles: async (paths) => {
          try {
            const rels = await window.nv.files.importPaths(paths, null, path);
            await loadFiles();
            return rels.map((r) => `![[${r}]]`);
          } catch (err) {
            showError(err);
            return [];
          }
        },
        onChange: (t) => {
          if (notePath && view) docs.update(notePath, t, view);
          if (view) changed.current?.(t, view.contentHeight);
        },
        dateFormat: () => prefs().dateFormat,
        timeFormat: () => prefs().timeFormat,
        wikilinks: () => prefs().wikilinks,
      };
      const header = document.createElement('div');
      header.className = 'cv-editor-header';
      const state = EditorState.create({
        doc: text,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'Escape', run: finish },
              { key: 'Mod-Enter', run: finish },
              ...(singleLine ? [{ key: 'Enter', run: finish }] : []),
            ]),
          ),
          ...buildExtensions(host, header, newCompartments(), 'live', getState().settings?.prefs ?? prefs(), true),
          EditorView.domEventHandlers({ blur: (e) => {
            // Leaving the card (not a menu of its own: completions, the link picker).
            const to = (e as FocusEvent).relatedTarget as HTMLElement | null;
            if (to && (parent.current?.contains(to) || to.closest('.cm-tooltip'))) return false;
            setTimeout(() => {
              if (view && !view.hasFocus && !document.activeElement?.closest('.cm-tooltip, .modal, .picker')) finish();
            }, 0);
            return false;
          } }),
        ],
      });
      view = new EditorView({ state, parent: parent.current });
      if (notePath)
        unsubscribe = docs.subscribe(notePath, (next, origin) => {
          if (origin === view || !view) return;
          const now = view.state.doc.toString();
          if (now !== next) view.dispatch({ changes: { from: 0, to: now.length, insert: next }, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
        });
      // Typing goes straight in, at the end of what's there.
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      changed.current?.(text, view.contentHeight);
    })();
    return () => {
      alive = false;
      unsubscribe();
      if (view) {
        if (!finished) {
          finished = true;
          done.current(view.state.doc.toString());
        }
        view.destroy();
        if (notePath) docs.release(notePath);
      }
    };
    // One editor per card being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath]);

  return <div className={`cv-editor${singleLine ? ' single' : ''}`} ref={parent} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />;
}
