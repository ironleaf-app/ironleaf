// What the personal modules' main sides share (Wave 7 part a: Home, Vehicles, Career, Travel; src/shared/personal-records.ts).
// A module's notes read from an index (the whole index for the window, an agent's gated one for its tools) with the files
// kept beside each; a value changed where it shows written as one property or one cell of its table (the row checked
// first, every other character kept); a row added or taken out; files kept with a record; the currency its amounts are
// in; how many of its notes an asker wasn't allowed; and filing from the Inbox (a line into a record, a file kept with
// it). Each module's own part (house.ts, vehicles.ts, career.ts, travel.ts) is made with these.

import path from 'node:path';
import { currencyOf } from '../../shared/module-records';
import { cleanCell, cleanRow, propValue, str, tableWithCell, tableWithoutRow, tableWithRow, withNoteWords, type PropSpec, type TableSpec } from '../../shared/personal-records';
import type { InboxItem, InboxSuggestion } from '../../shared/inbox';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { ToolCtx, WorkModules, WorkPart } from '../work-modules';
import { S } from '../life-records/common';

export { S };

export interface PNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  files?: string[];
}

/** What filing an Inbox item into one of a module's records does. */
export interface Filed {
  words: string;
  paths: string[];
  /** The record a file item is kept with (moved into its Files folder by the Inbox). */
  keepWith?: string;
}

/** A personal module's part: the work modules' part, with its own Inbox filing. */
export interface PersonalPart extends WorkPart {
  /** Where an Inbox item would go in this module (one of its records), or null. */
  inbox?(item: InboxItem): Promise<InboxSuggestion | null>;
  /** Files an Inbox item into the record the suggestion named. */
  fileInbox?(item: InboxItem, target: { path?: string; type?: string; name: string }): Promise<Filed>;
}

export interface RecordsSpec {
  module: string;
  /** The note types it reads (its own). */
  types: string[];
  tables: TableSpec[];
  /** A note record's kind → its properties (field → property). */
  props: Record<string, PropSpec[]>;
  /** A table record's kind → its table, and its fields' columns when named otherwise ("title" → "what"). */
  cells: Record<string, { table: TableSpec; map?: Record<string, string> }>;
  /** After a property was written: words to say (or null), and anything else that goes with it (a stage's timeline line). */
  afterProp?(rel: string, key: string, value: unknown): Promise<string | null>;
}

export function personalRecords(w: WorkModules, spec: RecordsSpec) {
  const notes = async (index: VaultIndex = w.d.index, withFiles = true, also?: (path: string, props: Record<string, unknown>) => boolean): Promise<PNote[]> => {
    const list = await w.notesOf(index, spec.types, also);
    const out: PNote[] = [];
    for (const n of list) out.push({ path: n.path, title: n.title, props: n.props, content: n.content, type: n.type || String(n.props.type ?? ''), ...(withFiles ? { files: await w.filesOf(n.path) } : {}) });
    return out;
  };

  const table = (id: unknown) => {
    const t = spec.tables.find((x) => x.id === id);
    if (!t) throw new Error('That can’t be added here.');
    return t;
  };

  /** Properties written together (each checked by its spec when it has one; null takes it off). */
  const setProps = async (rel: string, values: Record<string, unknown>, specs: PropSpec[] = []): Promise<void> => {
    await w.change(rel, (text) => {
      let t = text;
      for (const [key, raw] of Object.entries(values)) {
        const p = specs.find((x) => x.key === key);
        const v = p ? propValue(p, raw) : raw === '' || raw === undefined ? null : (raw as string | number | null);
        t = setNoteProp(t, key, v as never);
      }
      return t;
    });
  };

  /** One value changed where it shows: a property of a note record, or one cell of a table record's row. */
  const setField = async (input: unknown): Promise<string | null> => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const kind = S(o.kind, 30);
    const field = S(o.field, 40);
    const rel = S(o.path, 1000);
    if (!rel) throw new Error('That record isn’t there any more.');
    const cell = spec.cells[kind];
    if (cell) {
      const key = cell.map?.[field] ?? field;
      const f = cell.table.fields.find((x) => x.key === key);
      if (!f) throw new Error('That can’t be changed here.');
      const ref = (o.ref && typeof o.ref === 'object' ? o.ref : {}) as Record<string, unknown>;
      const row = typeof ref.row === 'number' ? ref.row : typeof o.row === 'number' ? o.row : -1;
      const words = cleanCell(f, typeof o.value === 'boolean' ? (o.value ? 'Yes' : 'No') : o.value);
      if (key === cell.table.title && !words) throw new Error(`A ${cell.table.one} needs its ${f.label.toLowerCase()}.`);
      const shown = typeof o.title === 'string' ? o.title : null;
      await w.change(rel, (text) => tableWithCell(text, cell.table, row, shown, key, words));
      return null;
    }
    const p = spec.props[kind]?.find((x) => x.field === field);
    if (!p) throw new Error('That can’t be changed here.');
    const value = propValue(p, typeof o.value === 'boolean' ? '' : o.value);
    await w.change(rel, (text) => setNoteProp(text, p.key, value as never));
    return spec.afterProp ? spec.afterProp(rel, p.key, value) : null;
  };

  const addRow = async (rel: unknown, tableId: unknown, values: unknown): Promise<string> => {
    const t = table(tableId);
    const r = S(rel, 1000);
    const v = cleanRow(t, (values && typeof values === 'object' ? values : {}) as Record<string, unknown>);
    if (!v[t.title]) throw new Error(`A ${t.one} needs its ${t.fields.find((f) => f.key === t.title)?.label.toLowerCase() ?? 'name'}.`);
    await w.change(r, (text) => tableWithRow(text, t, v));
    return `Added the ${t.one} to ${path.posix.basename(r, '.md')}.`;
  };

  const removeRow = async (rel: unknown, tableId: unknown, row: unknown, shown: unknown): Promise<string> => {
    const t = table(tableId);
    if (typeof row !== 'number') throw new Error(`That ${t.one} isn’t there any more.`);
    let gone = '';
    await w.change(S(rel, 1000), (text) => {
      const r = tableWithoutRow(text, t, row, typeof shown === 'string' ? shown : null);
      gone = r.gone;
      return r.text;
    });
    return `Took ${gone ? `“${gone}”` : `the ${t.one}`} out. It is kept in the note’s history (File recovery).`;
  };

  /** Words added under a record's Notes. */
  const addWords = async (rel: string, words: string): Promise<void> => {
    await w.change(rel, (text) => withNoteWords(text, words));
  };

  /** How many of the module's notes an asker wasn't allowed (so an answer can say so rather than "none"). */
  const refused = async (ctx: ToolCtx, mine: number): Promise<number> => (ctx.gated === w.d.index ? 0 : Math.max(0, (await w.notesOf(w.d.index, spec.types)).length - mine));

  /** The currency the module's amounts are in: its own setting, else Finance's, else AUD. */
  const currency = async (): Promise<string> => (await w.setting(spec.module, 'currency', '')) || currencyOf(await w.options());

  /** People cards and project names, for a page's choices. */
  const people = async () => (await w.notesOf(w.d.index, ['person'])).map((n) => ({ name: n.title, path: n.path, role: S(n.props.role, 80), org: S(n.props.org ?? n.props.company, 80), email: S(n.props.email, 120), phone: S(n.props.phone, 40) })).sort((a, b) => a.name.localeCompare(b.name));

  const fileOps: WorkPart['ops'] = {
    'pick-files': (title, kind) => w.pickFiles(S(title, 120) || 'Choose files to keep with it', kind === 'photos' ? [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif', 'bmp'] }, { name: 'Any file', extensions: ['*'] }] : kind === 'documents' ? [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'png', 'jpg', 'jpeg'] }, { name: 'Any file', extensions: ['*'] }] : undefined),
    'keep-files': async (rel, files) => {
      const kept = await w.keepFiles(S(rel, 1000), Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []);
      return kept.length ? `Kept ${kept.length === 1 ? kept[0].split('/').pop() : `${kept.length} files`} with ${path.posix.basename(S(rel, 1000), '.md')}.` : 'Nothing was kept (the files couldn’t be read).';
    },
    'set-field': (input) => setField(input),
    'add-row': (rel, tableId, values) => addRow(rel, tableId, values),
    'remove-row': (rel, tableId, row, shown) => removeRow(rel, tableId, row, shown),
  };

  return { notes, setProps, setField, addRow, removeRow, addWords, refused, currency, people, fileOps };
}

/** The first of some names said as whole words in an item's words (at least three letters), else undefined. */
export function namedIn<T>(words: string, list: readonly T[], names: (x: T) => string[]): T | undefined {
  const hay = ` ${words.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let best: { x: T; n: number } | undefined;
  for (const x of list)
    for (const name of names(x)) {
      const n = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (n.length >= 3 && hay.includes(` ${n} `) && (!best || n.length > best.n)) best = { x, n: n.length };
    }
  return best?.x;
}

/** An Inbox item's words without its file name's extension (a file's words are its name). */
export const itemWords = (item: InboxItem) => (item.kind === 'line' ? item.words : `${item.words} ${path.posix.basename(item.path).replace(/\.[^.]+$/, '')}`);

/** A dated line for a record's notes from an Inbox line ("24 Oct 2026: called about the quote"). */
export const inboxLine = (item: InboxItem, today: string) => `- ${item.stamp ? item.stamp.replace(/\s+\d{1,2}:\d{2}.*$/, '') : today}: ${str(item.words)}`;

/** Properties set on note text ('', missing and null take them off). The one-write half of setProps: a row and its
 *  properties land in one change, never split by a crash between (9.5). */
export const withProps = (text: string, values: Record<string, unknown>): string => {
  let t = text;
  for (const [key, raw] of Object.entries(values)) t = setNoteProp(t, key, raw === '' || raw === undefined ? null : (raw as string | number | string[] | null));
  return t;
};

/** The shared "remind me N days before" setting from an options patch (one stanza for every life part's options). */
export const remindDaysOption = async (w: WorkModules, module: string, patch: unknown): Promise<number> => {
  const o = patch && typeof patch === 'object' && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  if (typeof o.remindDays === 'number') await w.setOptions(module, { remindDays: o.remindDays });
  return w.remindDays(module);
};
