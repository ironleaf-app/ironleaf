// Views over notes in the window (src/shared/views.ts; release 5.0.0): making a view (from the side bar's More, a
// folder's menu, the Views section or the command list), writing a property into a note from a table cell, a board card
// or a calendar day (with Undo), and a new note made inside a view already carrying its values.

import { readProps, type PropValue } from '../../../shared/frontmatter';
import { linkTargetType, typeOfNote } from '../../../shared/note-types';
import { kindSiblingOf, mismatchedLinks, mismatchSentence, relationTargets, resolveRelation } from '../../../shared/relation-links';
import { defaultView, newNoteText, runView, setNoteProp, sourceWords, suggestDisplay, valueOf, valueText, VIEWS_FOLDER, type ViewDef, type ViewLayout, type ViewRow, type ViewSource } from '../../../shared/views';
import { BASE_EXT, writeViewFile } from '../../../shared/base-file';
import { choose, prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import * as A from './actions';
import { docs, syncWords } from './docs';
import { getWorkspace } from './layout';
import { getState, loadFiles, prefs, showError, toast } from './store';
import * as W from './workspace';

/** Notes in these folders never show in a view: the templates folder holds templates, not notes. */
export const viewExclusions = (): string[] => [prefs().templatesFolder].filter(Boolean);

/** "What should it show?": every note, a folder, or a tag, picked from what the library has. */
async function chooseSource(): Promise<ViewSource | null> {
  const { folders, notes } = getState();
  const tagCounts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const hidden = viewExclusions();
  const shown = folders.filter((f) => !hidden.some((h) => f === h || f.startsWith(`${h}/`)));
  const id = await pick({
    placeholder: 'What should the view show? Type a folder or a #tag',
    items: (q) => {
      const query = q.trim();
      const all = !query || 'every note all notes'.includes(query.toLowerCase()) ? [{ id: 'all:', label: 'Every note', detail: 'All the notes in this library', icon: 'notes' as const }] : [];
      const tagQuery = query.replace(/^#/, '');
      return [
        ...all,
        // A query starting with # is a tag: folders step aside.
        ...(query.startsWith('#') ? [] : fuzzyFilter(shown, query, (f) => f, 40)).map((f) => ({ id: `folder:${f}`, label: f, detail: 'Notes in this folder', icon: 'folder' as const })),
        ...fuzzyFilter(tags, tagQuery, (t) => t, 40).map((t) => ({ id: `tag:${t}`, label: `#${t}`, detail: `${tagCounts.get(t)} ${tagCounts.get(t) === 1 ? 'note' : 'notes'}`, icon: 'tag' as const })),
      ];
    },
    footer: '↑↓ to move · Enter to choose · Esc to cancel',
  });
  if (id === null || id === undefined) return null;
  if (id.startsWith('folder:')) return { kind: 'folder', value: id.slice(7) };
  if (id.startsWith('tag:')) return { kind: 'tag', value: id.slice(4) };
  return { kind: 'all' };
}

/**
 * "New view": what it shows (asked when not given), then its name and what kind of file keeps it (Ironleaf's own,
 * or the open .base kind other notes apps read); kept in Views/ and opened, with a few columns, a property to group
 * by and a date property already chosen from the notes it shows.
 */
export async function newView(given?: { source?: ViewSource; layout?: ViewLayout }): Promise<string | null> {
  try {
    const source = given?.source ?? (await chooseSource());
    if (!source) return null;
    const suggested = source.kind === 'folder' ? (source.value ?? '').split('/').pop() : source.kind === 'tag' ? source.value : 'All notes';
    const name = await prompt('New view', {
      value: suggested,
      placeholder: 'For example: Reading list',
      ok: 'Make the view',
      message: `${sourceWords(source)}, as a table, cards, a list, a board, a calendar or a map by their properties. Kept in ${VIEWS_FOLDER} as a small file of your own; your notes stay where they are.`,
    });
    if (!name?.trim()) return null;
    const kind = await choose('What kind of view file?', [
      { id: 'view', label: 'Ironleaf’s own', primary: true },
      { id: 'base', label: 'Open .base' },
    ], 'Both open the same here. The open kind also opens in other notes apps that read .base files.');
    if (!kind) return null;
    const def = defaultView(source, given?.layout ?? 'table');
    const s = suggestDisplay(runView(def, getState().notes, { exclude: viewExclusions() }));
    Object.assign(def, { columns: s.columns, groupBy: s.groupBy, dateProp: s.dateProp, placeProp: s.placeProp, cardProps: s.cardProps, ...(s.cover ? { cover: s.cover } : {}) });
    const ending = kind === 'base' ? BASE_EXT : '.view.json';
    const path = await window.nv.files.create(VIEWS_FOLDER, name.trim(), ending, writeViewFile(`view${ending}`, '', def));
    await loadFiles();
    A.openPath(path, { where: W.activeTab(getWorkspace()).type === 'empty' ? 'current' : 'tab' });
    return path;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** A note's words: from its open tab when open (nothing unsaved missed), else from disk. */
const textOf = (path: string): Promise<string> => docs.readThrough(path);

/** Words written: through the open tab when open (it shows them straight away), else to disk (indexed there). The seam's
 *  back-links are toasted here with the change (this writer's own words and Undo), never twice. */
const writeOf = (path: string, text: string) => docs.writeThrough(path, text, 'view', { quietSync: true });

const shown = (v: unknown) => (valueText(v) ? `“${valueText(v)}”` : 'nothing');

/**
 * One property set in one note (null takes it off), from a cell, a card moved to another column, or a day; the message
 * says what changed, with Undo putting the old value back. When links are gained or lost, the relations seam keeps the
 * other side in sync (each newly linked record gains the way back, each unlinked one loses it) and says what it did —
 * Undo puts those back too, through the same seam.
 */
export async function setProp(path: string, key: string, value: PropValue | null, opts: { quiet?: boolean } = {}): Promise<boolean> {
  try {
    const before = await textOf(path);
    let after = setNoteProp(before, key, value);
    // Taking a relation off takes its kinds with it, so no orphaned sibling is left behind; Undo puts both back.
    const prevProps = value === null ? readProps(before) : null;
    const sib = prevProps ? kindSiblingOf(prevProps, key) : undefined;
    const sibOld = sib ? prevProps![sib] : undefined;
    if (sib) after = setNoteProp(after, sib, null);
    if (after === before) return true;
    const old = valueOf({ path, title: '', folder: '', mtime: 0, tags: [], props: getState().byPath.get(path)?.props ?? {} }, key);
    const r = await writeOf(path, after);
    if (!opts.quiet) {
      const byPath = getState().byPath;
      const name = byPath.get(path)?.label ?? A.titleOf(path);
      const notes = getState().notes.map((n) => ({ path: n.path, title: n.label || n.title }));
      const was = resolveRelation(relationTargets(old), notes);
      const now = resolveRelation(relationTargets(value), notes);
      const direction = now.length > was.length && was.every((p) => now.includes(p)) ? 'linked' : now.length < was.length && now.every((p) => was.includes(p)) ? 'unlinked' : 'updated';
      const sync = syncWords(r?.synced ?? [], r?.missed ?? 0, direction);
      const mismatch = await mismatchNote(path, key, old, value);
      toast(`${value === null ? `Took ${key} off “${name}”.` : `Set ${key} to ${shown(value)} on “${name}”.`}${sync ? ` ${sync}` : ''}${mismatch ? ` ${mismatch}` : ''}`, {
        label: 'Undo',
        run: () =>
          void setProp(path, key, (old ?? null) as PropValue | null, { quiet: true }).then(async (ok) => {
            if (ok && sib && sibOld !== undefined) await setProp(path, sib, sibOld as PropValue, { quiet: true });
            if (ok) toast(`${key} is ${shown(old)} again.`);
          }),
      });
    }
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** A link just written to a note of another type than the field wants, in plain words (none when all agrees or the
 *  field wants no type): named, never blocked or fixed. Only mismatches the change newly made are said. */
async function mismatchNote(path: string, key: string, old: unknown, value: unknown): Promise<string | null> {
  const { getNoteTypes } = await import('./noteTypes');
  const types = getNoteTypes();
  const byPath = getState().byPath;
  const sourceType = typeOfNote({ path, props: byPath.get(path)?.props }, types, prefs().templatesFolder);
  const expected = linkTargetType(types, sourceType, key);
  if (!expected) return null;
  const notes = getState().notes.map((n) => ({ path: n.path, title: n.label || n.title }));
  const typeOf = (p: string): string | null => typeOfNote({ path: p, props: byPath.get(p)?.props }, types, prefs().templatesFolder);
  const before = new Set(mismatchedLinks(relationTargets(old), notes, typeOf, expected).map((m) => m.path));
  const fresh = mismatchedLinks(relationTargets(value), notes, typeOf, expected).filter((m) => !before.has(m.path));
  if (!fresh.length) return null;
  const nameOf = (id: string): string => types.find((t) => t.id === id)?.name ?? id;
  return fresh.slice(0, 3).map((m) => mismatchSentence(m.title, nameOf(m.actual!), nameOf(expected))).join(' ');
}

/** "New note" inside a view: in the folder it shows (else where new notes go), with its tag and the values given. A view
 *  of a type's home folder (People) makes a note of that type, with its fields and first words (state/noteTypes.ts). */
export async function newNoteInView(def: ViewDef, values: Record<string, PropValue> = {}): Promise<void> {
  const folder = def.source.kind === 'folder' ? def.source.value : undefined;
  const { getNoteTypes, newNoteOfType } = await import('./noteTypes');
  const { typeForFolder } = await import('../../../shared/note-types');
  const typed = folder ? typeForFolder(folder, getNoteTypes()) : undefined;
  if (typed) {
    await newNoteOfType(typed.id, { folder, where: 'tab', values });
    return;
  }
  await A.newNote(folder, 'tab', newNoteText(def, values));
}

/** "Export as CSV…" (21 Oct 2026): what the view shows — its notes in its order, its columns, formulas worked out — as a
 *  spreadsheet file the person names; the message offers to show it in its folder. */
export async function exportViewCsv(name: string, def: ViewDef, rows: ViewRow[]): Promise<void> {
  try {
    const { viewCsv } = await import('../../../shared/csv');
    const file = await window.nv.exports.csv(name, viewCsv(def, rows));
    if (file) toast(`Saved ${file.split(/[\\/]/).pop()} (${rows.length} ${rows.length === 1 ? 'note' : 'notes'}).`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
  } catch (err) {
    showError(err);
  }
}
