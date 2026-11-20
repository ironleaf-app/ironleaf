// Links to notes that don't exist yet, made as the right type while writing (20 Oct 2026, Ironleaf Calm wave B;
// state/noteTypes.ts). In the [[ suggestions and the @ suggestions, a name that matches no note offers "Make “Sam” a
// person" (and "another type…"): the link goes in at once, and the note is made in the type's folder with its fields,
// without leaving the note being written.
//
// @ works like [[ for people and other notes: "@Sam" suggests notes by name and writes a proper link ([[Sam Rivera]], or a
// Markdown link when Settings say so). It only starts after a space or at the start of a line, so an email address never
// opens it, and it closes when a space follows a name that matches nothing.

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { NOTE_TYPE, type NoteType } from '../../../shared/note-types';
import { linkTarget, writeLink } from '../lib/links';
import { chooseType, getNoteTypes, madeWords, newNoteOfType } from '../state/noteTypes';
import { getState, showError } from '../state/store';
import { errorMessage } from '../lib/errors';
import { rankNotes } from '../lib/rankedNotes';

/** A name a note can be given as it is (no folders, nothing Windows refuses in a file name). */
const NAMEABLE = /^[^\\/:*?"<>|#^[\]\u0000-\u001f]{1,80}$/;

/** The type offered first for a new name: Person when it is shown, else the first type of the person's own kind. */
function firstType(): NoteType | undefined {
  const shown = getNoteTypes().filter((t) => !t.hidden && t.id !== NOTE_TYPE && t.id !== 'project');
  return shown.find((t) => t.id === 'person') ?? shown[0];
}

/**
 * Made first, linked after (9.2 uplift F86, F87): the note is made before its link goes in, and the link is
 * written from the made note's own path — never an assumed folder/name that sanitising could leave unresolving.
 * A failed make names the note in plain words and writes no link; words already written on are left alone
 * (the note waits where the made message says).
 */
function makeThen(
  type: NoteType,
  name: string,
  view: EditorView,
  from: number,
  to: number,
  insert: (view: EditorView, from: number, to: number, name: string, type: NoteType, made: string) => void,
): void {
  const before = view.state.sliceDoc(from, to);
  void newNoteOfType(type.id, { title: name, open: false }).then(
    (path) => {
      if (!path) return;
      madeWords(path, type);
      if (view.state.sliceDoc(from, to) !== before) return;
      insert(view, from, to, name, type, path);
    },
    (err) => showError(`Could not make “${name}” a ${type.name.toLowerCase()}. ${errorMessage(err)}`),
  );
}

/**
 * The "Make … a person" and "Make … another type…" lines for a name that matches no note. `insert` puts the link in
 * (between from and to) once the note is made, from its own path; it runs after the make for the first line, and
 * after a type is picked for the second.
 */
export function typeLinkOptions(typed: string, insert: (view: EditorView, from: number, to: number, name: string, type: NoteType, made: string) => void): Completion[] {
  const name = typed.trim();
  if (!name || !NAMEABLE.test(name) || !getState().canEdit) return [];
  const first = firstType();
  const out: Completion[] = [];
  if (first) {
    out.push({
      label: `Make “${name}” a ${first.name.toLowerCase()}`,
      detail: first.folder ? `in ${first.folder}` : '',
      type: 'nv-new-type',
      boost: -50,
      apply: (view, _c, from, to) => makeThen(first, name, view, from, to, insert),
    });
  }
  out.push({
    label: `Make “${name}” another type…`,
    detail: 'meeting, resource, idea…',
    type: 'nv-new-type',
    boost: -60,
    apply: (view, _c, from, to) => {
      void chooseType({ except: ['project'] }).then((id) => {
        const type = getNoteTypes().find((t) => t.id === id);
        if (!type) return;
        makeThen(type, name, view, from, to, insert);
      });
    },
  });
  return out;
}

/** @ suggests notes by name and writes a link to the one chosen; a new name can be made as a type. */
export function mentionCompletions(from: () => string) {
  return (context: CompletionContext): CompletionResult | null => {
    const m = context.matchBefore(/(?:^|[\s(])@[^\s@[\]|#()][^@[\]|#()\n]{0,60}$/);
    if (!m) return null;
    const at = m.text.indexOf('@');
    const typed = m.text.slice(at + 1);
    // No word-count gate (W5-14): the match above already bounds the typed name to 60 characters.
    const start = m.from + at;
    const query = typed.trim().toLowerCase();
    const host = from();
    const replace = (view: EditorView, f: number, to: number, text: string) => view.dispatch({ changes: { from: f, to, insert: text }, selection: { anchor: f + text.length }, userEvent: 'input.complete' });
    // Ranked as search ranks notes (lib/rankedNotes.ts; 21 Oct 2026, gap G25). Only names that contain what is typed
    // (or start a word with it): @ is for naming, so letters merely in order don't count here.
    const options: Completion[] = rankNotes(typed.trim(), getState().notes, host, 60, (n) => n.path === host)
      .filter((r) => r.match.toLowerCase().includes(query))
      .map(({ note: n, match: hit }) => ({
        label: hit,
        detail: hit !== n.title ? `→ ${n.title}` : n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '',
        type: 'nv-note',
        apply: (view: EditorView, _c: Completion, f: number, to: number) => replace(view, f, to, writeLink(n.path, host, hit !== n.title ? { alias: hit } : {})),
      }));
    // A space after a name that matches nothing: the person is writing on, not naming a note.
    if (!options.length && /\s$/.test(typed)) return null;
    const sorted = options;
    // Made links keep the made name (9.2 uplift F154), as the note options above do.
    if (query && !getState().notes.some((n) => n.title.toLowerCase() === query)) sorted.push(...typeLinkOptions(typed, (view, f, to, name, _type, made) => replace(view, f, to, writeLink(made, host, linkTarget(made, host) !== name ? { alias: name } : {}))));
    return sorted.length ? { from: start, options: sorted, filter: false } : null;
  };
}
