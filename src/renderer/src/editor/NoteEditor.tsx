// A note's editor in a tab. Its undo history, cursor and scroll survive switching tabs; changes made in another tab with
// the same note (or on disk) arrive without disturbing the cursor; settings apply as they change.

import { writeLink } from '../lib/links';
import { resolveNote } from '../lib/resolve';
import { useEffect, useRef, useState } from 'react';
import { PageError } from '../components/PageStates';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { findUnlinkedPhrase } from '../../../shared/markdown';
import type { Prefs } from '../../../shared/prefs';
import { docs } from '../state/docs';
import { blockOf } from '../../../shared/blocks';
import { onReveal, registerEditor, takeReveal, type NoteEditor as NoteEditorHandle } from '../state/layout';
import { getState, useApp, usePrefs } from '../state/store';
import { refreshPreview } from './live-preview';
import { flash } from './flash';
import { docHeadFor } from './docHead';
import { noteFootFor } from './noteFoot';
import { buildExtensions, editableExtension, foldExtension, gutterExtension, indentExtension, modeExtension, newCompartments, pairsExtension, previewContext, spellExtension, type Compartments, type EditorHost } from './setup';
import { quietScroll } from '../lib/quietScroll';
import { keepFor, readKept } from './tabCache';

interface Cached {
  path: string;
  /** The page's top it was made with (the title, fields, meeting recorder…): drawn inside the editor's first line. */
  header: HTMLElement;
  /** The settings it was built with, and the page mounting that built it (t146: a return reuses the state). */
  prefs: Prefs;
  mount: object;
  state: EditorState;
  scroll: number;
  /** The opening cursor placement has been done for this entry (fnv3 F27): never again on remount. */
  placed?: boolean;
  compartments: Compartments;
  host: EditorHost;
  impl: { current: Omit<EditorHost, 'path' | 'version'> };
}

/** The smallest change that turns `from` into `to` (so cursors elsewhere stay put). */
function diff(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endA = from.length;
  let endB = to.length;
  while (endA > start && endB > start && from.charCodeAt(endA - 1) === to.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: to.slice(start, endB) };
}

export interface NoteEditorProps {
  tabId: string;
  path: string;
  mode: 'live' | 'source';
  header: HTMLElement;
  /** The page's mounting (t146): a kept state from another mounting is a return, and starts fresh. */
  mount: object;
  canEdit: boolean;
  focusOnOpen: boolean;
  callbacks: Omit<EditorHost, 'path' | 'version' | 'onChange'>;
}

/** A reveal's line in the view: its line, or its heading's (or block's) line. */
function revealLine(view: EditorView, reveal: { line?: number; heading?: string }): number | undefined {
  if (reveal.line !== undefined) return reveal.line;
  if (!reveal.heading) return undefined;
  const want = reveal.heading.toLowerCase();
  const text = view.state.doc.toString();
  const found = text.split('\n').findIndex((l) => {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    return !!h && h[1].toLowerCase() === want;
  });
  // A block reference ([[Note#^id]]): the first line of the block its id names (V12, 28 Oct 2026).
  if (found >= 0) return found;
  return blockOf(text, want)?.line;
}

export function NoteEditor({ tabId, path, mode, header, mount, canEdit, focusOnOpen, callbacks }: NoteEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const entryRef = useRef<Cached | null>(null);
  const handleRef = useRef<NoteEditorHandle | null>(null);
  // A note that won't open says so with a retry (9.2 uplift F91), never a blank editor.
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const prefs = usePrefs();
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let unquiet = () => {};
    // A line asked for while this note is already open (the peek's Edit, a search hit or backlink on the open
    // note; 4 Nov 2026): the editor goes to it now. Before, the ask sat untaken (it was only taken when an
    // editor opened), so the click did nothing visible — and a later opening could jump to the stale line.
    // Taking it here keeps one reveal to one jump.
    const offReveal = onReveal((p) => {
      if (cancelled || p !== path) return;
      const view = viewRef.current;
      const handle = handleRef.current;
      if (!view || !handle) return;
      const where = takeReveal(path);
      if (!where) return;
      const line = revealLine(view, where);
      if (line !== undefined) requestAnimationFrame(() => handle.scrollToLine(line, where.span));
    });
    void (async () => {
      const text = await docs.acquire(path).catch(() => null);
      if (cancelled) {
        if (text !== null) docs.release(path);
        return;
      }
      if (text === null) {
        setFailed(true);
        return;
      }
      setFailed(false);
      if (!parent.current) { docs.release(path); return; }
      let entry = readKept<Cached>(tabId);
      // Kept only for the same page showing the same note: a note deleted and made again under the same name in the
      // same tab (22 Oct 2026: a deleted meeting's new note drew no title, fields or recorder) gets a new editor, since
      // the kept one would draw the page's top into the old page's element, which is no longer on screen.
      // The host is kept per tab and note now (t146), so a return reuses the state (extensions, parsed tree);
      // changed settings still build again, as a fresh mount always did.
      const prefsNow = getState().settings?.prefs ?? prefs;
      if (!entry || entry.path !== path || entry.header !== header || entry.prefs !== prefsNow) {
        const impl: Cached['impl'] = { current: { ...callbacksRef.current, onChange: () => {} } };
        const host: EditorHost = {
          path,
          version: () => getState().revision,
          openLink: (t, n) => impl.current.openLink(t, n),
          openUrl: (u) => impl.current.openUrl(u),
          openTag: (t) => impl.current.openTag(t),
          hover: (t, a, h) => impl.current.hover(t, a, h),
          insertTemplate: (v) => impl.current.insertTemplate(v),
          linkToNote: (v) => impl.current.linkToNote(v),
          saveFile: (f) => impl.current.saveFile(f),
          importFiles: (p) => impl.current.importFiles(p),
          onChange: (t) => impl.current.onChange(t),
          dateFormat: () => impl.current.dateFormat(),
          timeFormat: () => impl.current.timeFormat(),
          wikilinks: () => impl.current.wikilinks(),
          docHead: () => docHeadFor(tabId),
          foot: () => noteFootFor(tabId),
        };
        const compartments = newCompartments();
        const state = EditorState.create({ doc: text, extensions: buildExtensions(host, header, compartments, mode, prefsNow, canEdit) });
        entry = { path, header, prefs: prefsNow, mount, state, scroll: 0, compartments, host, impl };
      } else {
        if (entry.mount !== mount) {
          // A return to the note (t146): the state stands, but the visit starts as a fresh mount did — top
          // of the note, cursor where its words start, undo from here. A mode switch keeps its place.
          entry.mount = mount;
          entry.scroll = 0;
          entry.placed = false;
          entry.state = entry.state.update({ effects: entry.compartments.hist.reconfigure(history()) }).state;
        }
        if (entry.state.doc.toString() !== text) {
          const change = diff(entry.state.doc.toString(), text);
          if (change) entry.state = entry.state.update({ changes: change, annotations: Transaction.addToHistory.of(false), effects: entry.compartments.hist.reconfigure(history()) }).state;
        }
      }
      entryRef.current = entry;
      const view = new EditorView({ state: entry.state, parent: parent.current });
      viewRef.current = view;
      // The scrollbar stays quiet until hovered or scrolling (lib/quietScroll.ts).
      unquiet = quietScroll(view.scrollDOM);
      entry.impl.current = {
        ...callbacksRef.current,
        onChange: (t: string) => docs.update(path, t, view),
      };
      view.dispatch({ effects: [entry.compartments.mode.reconfigure(modeExtension(mode, previewContext(entry.host))), entry.compartments.editable.reconfigure(editableExtension(canEdit))] });
      unsubscribe = docs.subscribe(path, (next, origin) => {
        if (origin === view) return;
        const change = diff(view.state.doc.toString(), next);
        if (!change) return;
        // Words taken wholesale from disk (a conflict settled as theirs, a reload) reset undo (fnv3 F26):
        // the old history must never invert old edits against the new text and autosave the result.
        const wholesale = origin === 'disk' || change.to - change.from > view.state.doc.length / 2;
        if (wholesale) view.dispatch({ changes: change, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)], effects: entry.compartments.hist.reconfigure(history()) });
        else view.dispatch({ changes: change, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
      });
      const handle: NoteEditorHandle = {
        path,
        view: () => viewRef.current,
        getText: () => view.state.doc.toString(),
        linkPhrase(phrase, title, line) {
          const doc = view.state.doc;
          const order = line !== undefined && line < doc.lines ? [line, ...Array.from({ length: doc.lines }, (_, i) => i).filter((i) => i !== line)] : Array.from({ length: doc.lines }, (_, i) => i);
          for (const i of order) {
            const l = doc.line(i + 1);
            const col = findUnlinkedPhrase(l.text, phrase);
            if (col < 0) continue;
            const found = l.text.slice(col, col + phrase.length);
            const rel = resolveNote(title, path);
            const insert = rel ? writeLink(rel, path, found === title ? {} : { alias: found }) : found === title ? `[[${title}]]` : `[[${title}|${found}]]`;
            view.dispatch({ changes: { from: l.from + col, to: l.from + col + phrase.length, insert } });
            return true;
          }
          return false;
        },
        insertAtCursor(textToInsert) {
          view.dispatch(view.state.replaceSelection(textToInsert));
          view.focus();
        },
        scrollToLine(line, span) {
          const l = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines));
          view.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
          if (span !== undefined) flash(view, line, line + span);
          view.focus();
        },
        focus: () => view.focus(),
      };
      registerEditor(tabId, handle);
      handleRef.current = handle;
      // Back where it was, or where it was asked to go (a search hit, a backlink, a heading).
      const reveal = takeReveal(path);
      if (reveal) {
        const line = revealLine(view, reveal);
        if (line !== undefined) requestAnimationFrame(() => handle.scrollToLine(line, reveal.span));
      } else if (entry.scroll) {
        requestAnimationFrame(() => view.scrollDOM.scrollTo({ top: entry!.scroll }));
      }
      // A note opened fresh starts with the cursor where its words start (after its properties), once only.
      if (!entry.placed) {
        entry.placed = true;
        const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(view.state.doc.sliceString(0, 50000));
        if (fm && !reveal) view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, fm[0].length) } });
      }
      // Typing goes straight into a note opened from the keyboard (the quick switcher, a new note, a link); a note opened
      // from the file list leaves the focus there (so the arrows keep moving through the list).
      if (focusOnOpen && !reveal)
        requestAnimationFrame(() => {
          const active = document.activeElement as HTMLElement | null;
          if (!active || active === document.body || active.closest('.group')) view.focus();
        });
      // The whole note parsed while idle (t146, 9 Nov 2026): the first keystroke paid for finishing the
      // background parse of a long note. The same tree, ready before the person types — only while truly
      // idle, never on a deadline (a forced warm mid-typing would slow the keys it hurries for), and dropped
      // when the note is gone already.
      const warm = () => {
        if (!cancelled && viewRef.current === view) {
          try {
            ensureSyntaxTree(view.state, view.state.doc.length);
          } catch {
            // Parsing catches up on its own; warming is only a head start.
          }
        }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(warm);
      else setTimeout(warm, 300);
    })();
    return () => {
      cancelled = true;
      offReveal();
      handleRef.current = null;
      unsubscribe();
      unquiet();
      const view = viewRef.current;
      const entry = entryRef.current;
      if (view && entry) {
        entry.state = view.state;
        entry.scroll = view.scrollDOM.scrollTop;
        keepFor(tabId, entry);
        view.destroy();
        docs.release(path);
      } else if (view) {
        view.destroy();
        docs.release(path);
      }
      viewRef.current = null;
      registerEditor(tabId, null);
    };
    // A new editor per note; the mode and settings are applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, path, retry]);

  useEffect(() => {
    const view = viewRef.current;
    const entry = entryRef.current;
    if (!view || !entry) return;
    entry.impl.current = { ...callbacks, onChange: (t: string) => docs.update(path, t, view) };
  }, [callbacks, path]);

  useEffect(() => {
    const view = viewRef.current;
    const entry = entryRef.current;
    if (!view || !entry) return;
    view.dispatch({ effects: entry.compartments.mode.reconfigure(modeExtension(mode, previewContext(entry.host))) });
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;
    const entry = entryRef.current;
    if (!view || !entry) return;
    view.dispatch({
      effects: [
        entry.compartments.gutter.reconfigure(gutterExtension(prefs.lineNumbers)),
        entry.compartments.pairs.reconfigure(pairsExtension(prefs.autoPair)),
        entry.compartments.spell.reconfigure(spellExtension(prefs.spellcheck)),
        entry.compartments.fold.reconfigure(foldExtension(prefs.foldHeadings)),
        entry.compartments.editable.reconfigure(editableExtension(canEdit)),
        entry.compartments.indent.reconfigure(indentExtension(prefs)),
      ],
    });
  }, [prefs.lineNumbers, prefs.autoPair, prefs.spellcheck, prefs.foldHeadings, prefs.indentWithTabs, prefs.tabSize, canEdit]);

  // Properties shown as text (or not): Live Preview draws the note again.
  useEffect(() => {
    const view = viewRef.current;
    const entry = entryRef.current;
    if (!view || !entry) return;
    view.dispatch({ effects: entry.compartments.mode.reconfigure(modeExtension(mode, previewContext(entry.host))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the setting changes
  }, [prefs.propertiesShow]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshPreview.of(null) });
  }, [revision, filesRevision]);

  // The host stays mounted behind the error so a retry has somewhere to draw into.
  if (failed)
    return (
      <>
        <PageError title="Couldn't open this note" explainer="It may have moved, or the vault may be busy." retry={() => setRetry((n) => n + 1)} />
        <div className="note-editor" ref={parent} style={{ display: 'none' }} />
      </>
    );
  return <div className="note-editor" ref={parent} />;
}
