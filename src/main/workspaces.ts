// Project workspaces and views of records, kept in the vault (24 Oct 2026, Workstream 1 part D; the format is in
// src/shared/project-workspace.ts and src/shared/record-views.ts). A project's workspace (its sections' order, pins,
// hidden sections, views and sections of the person's own) is .neuralvault/workspaces/<project>.json, and a view over the
// whole vault's records is .neuralvault/views/<name>.json, so both travel with the notes (OneDrive, Ironleaf's own
// sync, a backup) and every PC shows the same. The .neuralvault folder is Ironleaf's own and reserved from the
// window's file reads and writes (src/main/vault.ts), so this is the one way in: read as text, written whole after
// checking it, through a temporary file so it is never half written.

import { shell } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { readWorkspace, VAULT_VIEWS_FOLDER, workspaceFileOf, writeWorkspace } from '../shared/project-workspace';
import { readRecordView, viewFileName, writeRecordView } from '../shared/record-views';
import { writeFileAtomic } from './save-guard';

const MAX_BYTES = 512 * 1024;

const inside = (root: string, rel: string) => {
  const abs = path.resolve(root, ...rel.split('/'));
  const base = path.resolve(root, '.neuralvault');
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('That place isn’t inside the vault’s own folder.');
  return abs;
};

async function writeWhole(abs: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  // Its own temp each time (two saves at once shared one before: a failed rename, or a mixed file).
  await writeFileAtomic(abs, text);
}

async function readSmall(abs: string): Promise<string | null> {
  try {
    const text = await fsp.readFile(abs, 'utf8');
    return text.length > MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

const cleanProject = (rel: unknown) => {
  const p = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/^\/+/, '') : '';
  if (!p || p.split('/').some((s) => s === '..' || s.startsWith('.')) || !/\.md$/i.test(p)) throw new Error('That isn’t a project in this vault.');
  return p;
};

/** A project's workspace file's words, or '' when it has none yet (its sections are then made from what it holds). */
export async function loadWorkspace(root: string, project: unknown): Promise<string> {
  const rel = cleanProject(project);
  return (await readSmall(inside(root, workspaceFileOf(rel)))) ?? '';
}

/** A project's workspace written whole (only what readWorkspace understands is kept). */
export async function saveWorkspace(root: string, project: unknown, text: unknown): Promise<void> {
  const rel = cleanProject(project);
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('That workspace can’t be saved.');
  const w = readWorkspace(text, rel);
  await writeWhole(inside(root, workspaceFileOf(rel)), writeWorkspace({ ...w, project: rel }));
}

/** A project renamed or moved: its workspace goes with it (a page's rename gives the moves, the project file last). */
export async function followMoves(root: string, moves: [string, string][] | undefined): Promise<void> {
  for (const [from, to] of moves ?? []) {
    if (!/\.md$/i.test(from) || !/\.md$/i.test(to)) continue;
    const a = inside(root, workspaceFileOf(from));
    const b = inside(root, workspaceFileOf(to));
    const text = await readSmall(a);
    if (text === null) continue;
    try {
      await writeWhole(b, writeWorkspace({ ...readWorkspace(text, to), project: to }));
      await fsp.rm(a, { force: true });
    } catch {
      // The old one stays where it was: nothing is lost.
    }
  }
}

export interface VaultViewFile {
  /** The file's name in .neuralvault/views. */
  name: string;
  title: string;
  layout: string;
  text: string;
}

/** Every view over the vault's records, by title. */
export async function listViews(root: string): Promise<VaultViewFile[]> {
  const dir = inside(root, VAULT_VIEWS_FOLDER);
  let names: string[] = [];
  try {
    names = (await fsp.readdir(dir)).filter((n) => /\.json$/i.test(n) && !n.startsWith('.'));
  } catch {
    return [];
  }
  const out: VaultViewFile[] = [];
  for (const name of names.slice(0, 200)) {
    const text = await readSmall(path.join(dir, name));
    if (text === null) continue;
    const { def } = readRecordView(text);
    out.push({ name, title: def.title, layout: def.layout, text });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

const cleanName = (name: unknown) => {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!/^[a-z0-9][a-z0-9-]{0,70}\.json$/i.test(n)) throw new Error('That view’s name can’t be used.');
  return n;
};

/** A view over the vault saved (a new one gets a file name from its title, never over another view). */
export async function saveView(root: string, name: unknown, text: unknown): Promise<string> {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('That view can’t be saved.');
  const { def, problem } = readRecordView(text);
  if (problem) throw new Error('That view can’t be saved.');
  let file = typeof name === 'string' && name ? cleanName(name) : viewFileName(def.title);
  if (!(typeof name === 'string' && name)) {
    const dir = inside(root, VAULT_VIEWS_FOLDER);
    const base = file.replace(/\.json$/, '');
    for (let n = 2; await fsp.stat(path.join(dir, file)).then(() => true, () => false); n++) file = `${base}-${n}.json`;
  }
  await writeWhole(inside(root, `${VAULT_VIEWS_FOLDER}/${file}`), writeRecordView({ ...def, scope: 'vault' }));
  return file;
}

/** A view taken away: to the Bin (only the view; the notes it showed are untouched). */
export async function removeView(root: string, name: unknown): Promise<void> {
  const abs = inside(root, `${VAULT_VIEWS_FOLDER}/${cleanName(name)}`);
  try {
    await shell.trashItem(abs);
  } catch {
    await fsp.rm(abs, { force: true });
  }
}
