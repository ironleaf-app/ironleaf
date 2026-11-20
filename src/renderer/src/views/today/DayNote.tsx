// The day's note on Today, open for writing (20 Oct 2026, "Ironleaf Calm": the day's note is the inbox). The app's own
// editor (Live Preview: headings, tick boxes, [[links]], / for more), as a canvas card edits its note
// (views/canvas/CardEditor.tsx): saved to the note as in its tab, and what Quick capture adds shows here as it lands.
//
// A day with no note yet shows the same editor, empty, with a line saying what it is. The note is made from the daily
// template on the first keystroke and never before (src/shared/hub.ts firstWords): looking at a day, or at Today, never
// leaves an empty daily note behind. Until the note is there the empty editor keeps taking the typing, so nothing typed
// in the moment it takes to make is lost.

import { useEffect, useRef, useState } from 'react';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { firstWords } from '../../../../shared/hub';
import { Icon } from '../../components/Icon';
import { buildExtensions, newCompartments, type EditorHost } from '../../editor/setup';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { getState, prefs, showError } from '../../state/store';
import { noteEditorHost } from '../note/editorHost';

/** The editor's host for the day's note: the one host every note's tab uses, so the day's note edits the same here. */
function hostFor(path: string, onChange: (text: string) => void): EditorHost {
  return { ...noteEditorHost(path), path, version: () => getState().revision, onChange };
}

/** The line in an empty day's editor: what it is, in plain words. */
function emptyLine(isToday: boolean, words: string, canEdit: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'th-placeholder';
  el.textContent = !canEdit ? `No note for ${isToday ? 'today' : words}.` : isToday ? 'Write anything here: it’s today’s note. Quick capture lands here too.' : `Write anything here: it becomes the note for ${words}.`;
  return el;
}

export interface DayNoteProps {
  iso: string;
  /** "Monday 19 October": the day in words. */
  dayWords: string;
  isToday: boolean;
  daily: { path: string; exists: boolean };
  canEdit: boolean;
}

export function DayNote({ iso, dayWords, isToday, daily, canEdit }: DayNoteProps) {
  // Made on the first keystroke here: the typing so far, handed to the note's editor once it is there.
  const [made, setMade] = useState(false);
  const starterText = useRef<() => string>(() => '');
  const [ready, setReady] = useState(false);
  // Asked for once, however fast the first keys come.
  const starting = useRef(false);
  const exists = daily.exists || made;
  useEffect(() => {
    setMade(false);
    setReady(false);
    starting.current = false;
  }, [daily.path]);

  const start = () => {
    if (starting.current) return;
    starting.current = true;
    setMade(true);
    void window.nv.hub.start(iso).then(
      () => undefined,
      (err) => {
        starting.current = false;
        setMade(false);
        showError(err);
      },
    );
  };

  return (
    <div className={`th-note${exists ? ' is-written' : ' is-empty'}`}>
      {exists && <NoteEditorInline key={daily.path} path={daily.path} canEdit={canEdit} pending={made ? () => starterText.current() : null} onReady={() => setReady(true)} />}
      {(!exists || (made && !ready)) && <StarterEditor key={`start:${daily.path}`} path={daily.path} placeholderWords={emptyLine(isToday, dayWords, canEdit)} canEdit={canEdit} onStart={start} text={starterText} />}
      {exists && (
        <button className="th-note-open" title="Open the day’s note in a tab" onClick={() => A.openPath(daily.path, { where: 'tab' })}>
          <Icon name="newTab" size={13} /> Open
        </button>
      )}
    </div>
  );
}

/** The empty day's editor: the same look as the note's, taking the first words, which make the note. */
function StarterEditor({ path, placeholderWords, canEdit, onStart, text }: { path: string; placeholderWords: HTMLElement; canEdit: boolean; onStart(): void; text: React.MutableRefObject<() => string> }) {
  const parent = useRef<HTMLDivElement>(null);
  const started = useRef(onStart);
  started.current = onStart;
  useEffect(() => {
    if (!parent.current) return;
    let view: EditorView | null = null;
    const host = hostFor(path, (t) => {
      if (t.length) started.current();
    });
    const state = EditorState.create({
      doc: '',
      extensions: [placeholder(placeholderWords), ...buildExtensions(host, document.createElement('div'), newCompartments(), 'live', getState().settings?.prefs ?? prefs(), canEdit)],
    });
    view = new EditorView({ state, parent: parent.current });
    text.current = () => view?.state.doc.toString() ?? '';
    return () => {
      view?.destroy();
      view = null;
    };
    // One editor for each day with no note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, canEdit]);
  return <div className="th-editor" ref={parent} />;
}

/** The day's note itself, edited in place. `pending`: the words typed before it was made, put in on opening. */
function NoteEditorInline({ path, canEdit, pending, onReady }: { path: string; canEdit: boolean; pending: (() => string) | null; onReady(): void }) {
  const parent = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    let view: EditorView | null = null;
    let alive = true;
    let acquired = false;
    let unsubscribe = () => {};
    let tries = 0;
    const open = async (): Promise<void> => {
      // Just made: the main side may still be writing it (a moment), so a first read that misses is tried again.
      const text = await docs.acquire(path).catch(() => null);
      if (!alive) {
        if (text !== null) docs.release(path);
        return;
      }
      if (text === null) {
        if (tries++ < 20) {
          setTimeout(() => void open(), 100);
          return;
        }
        showError('Ironleaf couldn’t open the day’s note.');
        return;
      }
      if (!parent.current) {
        docs.release(path);
        return;
      }
      acquired = true;
      const host = hostFor(path, (t) => {
        if (view) docs.update(path, t, view);
      });
      const typed = pendingRef.current?.() ?? '';
      const merged = typed ? firstWords(text, typed) : null;
      const state = EditorState.create({
        doc: merged ? merged.text : text,
        selection: merged ? EditorSelection.cursor(merged.cursor) : undefined,
        extensions: buildExtensions(host, document.createElement('div'), newCompartments(), 'live', getState().settings?.prefs ?? prefs(), canEdit),
      });
      view = new EditorView({ state, parent: parent.current });
      if (merged) docs.update(path, merged.text, view);
      // Taking over the typing (the note was just made from the starter's words): keys landing between here and
      // the starter going away must land here — even when the snapshot was empty, or they die with the starter.
      if (pendingRef.current) view.focus();
      unsubscribe = docs.subscribe(path, (next, origin) => {
        if (origin === view || !view) return;
        const now = view.state.doc.toString();
        if (now === next) return;
        // Changed elsewhere (its tab, Quick capture, a sync): the smallest change, so the cursor here stays put.
        let a = 0;
        const max = Math.min(now.length, next.length);
        while (a < max && now.charCodeAt(a) === next.charCodeAt(a)) a++;
        let b = now.length;
        let c = next.length;
        while (b > a && c > a && now.charCodeAt(b - 1) === next.charCodeAt(c - 1)) {
          b--;
          c--;
        }
        view.dispatch({ changes: { from: a, to: b, insert: next.slice(a, c) }, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
      });
      ready.current();
    };
    void open();
    return () => {
      alive = false;
      unsubscribe();
      view?.destroy();
      view = null;
      if (acquired) docs.release(path);
    };
    // One editor for each day's note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, canEdit]);
  return <div className="th-editor" ref={parent} />;
}
