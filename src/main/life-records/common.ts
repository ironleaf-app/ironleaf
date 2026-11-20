// What the Wave 7 part b modules share on the main side (src/main/life-records.ts): their notes read from an index (the
// whole one for the window, an agent's gated one for its tools), a property or a table's cell written as the one change
// it is (every other character kept), a row added or taken out, files kept beside a record, and how many of a module's
// notes an agent wasn't allowed (so its answer says so rather than "none"). Each module's own work is its part beside
// this file.

import path from 'node:path';
import { propValue, readDay, tableWithCell, tableWithoutRow, tableWithRow, type PropSpec, type TableSpec } from '../../shared/personal-records';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { ToolCtx, WorkModules } from '../work-modules';

/** A value from the window or an agent, as words of at most `max` characters. */
export const S = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
export const O = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const titleOf = (rel: string) => path.posix.basename(rel, '.md');

/** A note's record kind from its type (one check for business, memories and systems: the type read the same way, the
 *  refusal in the module's own words). `kinds` maps each kind to its note type. */
export const kindOfNote = (w: WorkModules, rel: string, kinds: Record<string, string>, err: string): string => {
  const t = String(w.d.index.get(rel)?.props?.type ?? '').toLowerCase();
  const kind = Object.keys(kinds).find((k) => kinds[k] === t);
  if (!kind) throw new Error(err);
  return kind;
};

/** A day from a value (missing stays missing; a wrong one is refused in plain words). One check for business, goals
 *  and memories — each keeps its own example day. */
export const dayOf = (v: unknown, label: string, example: string): string | null => {
  const s = S(v, 30);
  if (!s) return null;
  const d = readDay(s);
  if (!d) throw new Error(`Give ${label} as a day, like ${example}.`);
  return d;
};

export interface LifeNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  mtime: number;
  files?: string[];
}

/** The notes of these types in an index, with the files kept beside each when asked. */
export async function notesOf(w: WorkModules, index: VaultIndex, types: readonly string[], withFiles = false): Promise<LifeNote[]> {
  const list = await w.notesOf(index, types);
  const out: LifeNote[] = [];
  for (const n of list) out.push({ path: n.path, title: n.title, props: n.props, content: n.content, type: n.type, mtime: n.mtime, ...(withFiles ? { files: await w.filesOf(n.path) } : {}) });
  return out;
}

/** People's names (their People notes), for a page's choices. */
export async function peopleNames(w: WorkModules): Promise<string[]> {
  return (await w.notesOf(w.d.index, ['person'])).map((n) => n.title).sort((a, b) => a.localeCompare(b));
}

/** One property changed, its value checked for its kind (a day, a number, one of its words…); null takes it off. */
export async function setProp(w: WorkModules, rel: string, p: PropSpec, raw: unknown): Promise<void> {
  const value = propValue(p, raw);
  await w.change(rel, (text) => setNoteProp(text, p.key, value));
}

/** Several properties at once (already checked), in one write. */
export async function setProps(w: WorkModules, rel: string, values: Record<string, string | number | string[] | null>): Promise<void> {
  await w.change(rel, (text) => Object.entries(values).reduce((t, [k, v]) => setNoteProp(t, k, v), text));
}

export async function setCell(w: WorkModules, rel: string, spec: TableSpec, row: number, shown: string | null, field: string, words: string): Promise<void> {
  await w.change(rel, (text) => tableWithCell(text, spec, row, shown, field, words));
}
/** Several cells of one row, in one write (each checked by the caller). */
export async function setCells(w: WorkModules, rel: string, spec: TableSpec, row: number, shown: string | null, values: Record<string, string>): Promise<void> {
  await w.change(rel, (text) => Object.entries(values).reduce((t, [k, v], i) => tableWithCell(t, spec, row, i === 0 ? shown : null, k, v), text));
}
export async function addRow(w: WorkModules, rel: string, spec: TableSpec, values: Record<string, string>): Promise<void> {
  await w.change(rel, (text) => tableWithRow(text, spec, values));
}
export async function removeRow(w: WorkModules, rel: string, spec: TableSpec, row: number, shown: string | null): Promise<string> {
  let gone = '';
  await w.change(rel, (text) => {
    const r = tableWithoutRow(text, spec, row, shown);
    gone = r.gone;
    return r.text;
  });
  return gone;
}

/** How many of these types' notes the asker wasn't allowed (0 for the person). */
export async function refusedCount(w: WorkModules, ctx: ToolCtx, types: readonly string[]): Promise<number> {
  if (ctx.gated === w.d.index) return 0;
  const all = (await w.notesOf(w.d.index, types)).length;
  const mine = (await w.notesOf(ctx.gated, types)).length;
  return Math.max(0, all - mine);
}

/** A new note written for an agent, after its gate has said it may change a note there. */
export async function agentNote(w: WorkModules, ctx: ToolCtx, folder: string, name: string, text: string): Promise<string> {
  const rel = await w.freeNote(folder, name);
  ctx.check?.(rel);
  await w.d.requireCreate();
  await w.d.writeNote(rel, text);
  return rel;
}

/** A note changed for an agent, after its gate has said it may change it. */
export async function agentChange(w: WorkModules, ctx: ToolCtx, rel: string, change: (text: string) => string): Promise<void> {
  ctx.check?.(rel);
  await w.change(rel, change);
}

/** Files from the PC kept with a record, said in words. */
export async function keepFiles(w: WorkModules, rel: unknown, files: unknown, what = 'file'): Promise<string> {
  const r = S(rel, 1000);
  const kept = await w.keepFiles(r, Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []);
  return kept.length ? `Kept ${kept.length === 1 ? `a ${what}` : `${kept.length} ${what}s`} with ${titleOf(r)}.` : 'Nothing was kept (the files couldn’t be read).';
}

export const PICTURES = [
  { name: 'Pictures and videos', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'mp4', 'mov', 'm4v', 'webm'] },
  { name: 'Any file', extensions: ['*'] },
];
