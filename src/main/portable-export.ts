import { filesFolderFor } from '../shared/file-records';
import { createHash } from 'node:crypto';
import { projectOwnsFolder } from '../shared/project-file';
// Export everything (31 Oct 2026): one zip saved where the person chooses. Notes exactly as on disk (folders kept),
// attachments and assets beside them, one CSV per record type, a plain README, and nothing secret unless "Include
// my private notes" is ticked (then decrypted, only after unlocking). A cancelled export leaves no half file: the
// zip is written through a temporary file beside it (src/main/zip.ts) and the temporary file is removed when
// cancelled.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { healthTables, INCLUDE_PRIVATE_LABEL, isNoteRel, isoDayOf, meetingsTable, packTables, peopleTable, portableReadme, projectsTable, secretsTable, tableCsv, tasksTable, exportFileName, PRIVATE_NEEDED, type HealthTableInput, type ModuleTypeInput, type PortableNote, type PortableProgress, type PortableProject, type PortableResult, type PortableSecret, type PortableTable, type PortableTask } from '../shared/portable-export';
import { vaultFiles } from './vault-home';
import { writeZip, type ZipSource } from './zip';

export const PORTABLE_CANCELLED = 'Export cancelled';
export class PortableCancelled extends Error {
  constructor() {
    super(PORTABLE_CANCELLED);
  }
}
export const isPortableCancel = (err: unknown) => err instanceof PortableCancelled || (err instanceof Error && err.message === PORTABLE_CANCELLED);

export interface PortableFile {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
}

export interface PortablePrivateNote {
  path: string;
  text: string;
  modified: number;
}

export interface ExportPortableInput {
  root: string;
  dest: string;
  vaultName: string;
  day?: string;
  includePrivate: boolean;
  project?: { path: string; name: string };
  members?: ReadonlySet<string>;
  expectedPreview?: string;
  files: PortableFile[];
  notes: PortableNote[];
  projects: PortableProject[];
  tasks: PortableTask[];
  moduleTypes: ModuleTypeInput[];
  moduleFolder?: (typeId: string) => string;
  privateNotes?: PortablePrivateNote[];
  secrets?: PortableSecret[];
  health?: HealthTableInput | null;
  onProgress?: (p: PortableProgress) => void;
  shouldCancel?: () => boolean;
}

/** A path that is Ironleaf's own or a backup's (never portable): the hidden folder, Git's history. */
const isOwn = (rel: string) => rel === '.neuralvault' || rel.startsWith('.neuralvault/') || rel === '.git' || rel.startsWith('.git/') || rel.includes('/.git/');
const isPrivateRel = (rel: string) => rel === 'Private notes' || rel.startsWith('Private notes/');

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const inProject = (rel: string, projectPath: string, members?: ReadonlySet<string>) => rel === projectPath || members?.has(rel) || (projectOwnsFolder(projectPath) && dirOf(projectPath) !== '' && rel.startsWith(`${dirOf(projectPath)}/`));

/** The files that go in the zip: everything except Ironleaf's own, Git's history, and (by default) private notes.
 *  A project export holds only that project's note and folder. Encrypted private files never go in as they are. */
export function filterPortableFiles(files: PortableFile[], o: { includePrivate: boolean; project?: string; members?: ReadonlySet<string> }): PortableFile[] {
  const homes = o.project ? new Set([o.project, ...(o.members ?? [])].map(filesFolderFor)) : new Set<string>();
  const inFilesHome = (rel: string) => {
    for (let parent = dirOf(rel); parent; parent = dirOf(parent)) if (homes.has(parent)) return true;
    return false;
  };
  return files.filter((f) => {
    if (isOwn(f.rel)) return false;
    if (isPrivateRel(f.rel)) return false;
    if (f.rel.endsWith('.nvlock') || f.rel.endsWith('.nvsecret') || f.rel.endsWith('.nvkey')) return false;
    if (o.project && !inProject(f.rel, o.project, o.members) && !inFilesHome(f.rel)) return false;
    return true;
  });
}

function throwIfCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) throw new PortableCancelled();
}

/** Every table for the zip. A project export holds only its own tables: private notes, secrets and health stay out. */
export function buildPortableTables(o: { notes: PortableNote[]; projects: PortableProject[]; tasks: PortableTask[]; moduleTypes: ModuleTypeInput[]; moduleFolder?: (typeId: string) => string; includePrivate: boolean; project?: string; permitted?: ReadonlySet<string>; secrets?: PortableSecret[]; health?: HealthTableInput | null }): PortableTable[] {
  const allow = (r: { path: string }) => !o.project || (o.permitted ? o.permitted.has(r.path) : inProject(r.path, o.project));
  const notes = o.notes.filter((n) => isNoteRel(n.path) && allow(n));
  const projects = o.projects.filter(allow);
  const tasks = o.tasks.filter(allow);
  const tables: PortableTable[] = [];
  for (const t of [projectsTable(projects), tasksTable(tasks), meetingsTable(notes), peopleTable(notes)]) if (t) tables.push(t);
  tables.push(...packTables(notes, o.moduleTypes, o.moduleFolder));
  if (o.includePrivate && !o.project) {
    if (o.secrets?.length) {
      const s = secretsTable(o.secrets);
      if (s) tables.push(s);
    }
    if (o.health) tables.push(...healthTables(o.health));
  }
  return tables.sort((a, b) => a.file.localeCompare(b.file));
}

function portablePlan(o: Pick<ExportPortableInput, 'root' | 'files' | 'includePrivate' | 'project' | 'members' | 'notes' | 'projects' | 'tasks' | 'moduleTypes' | 'moduleFolder' | 'health' | 'secrets' | 'privateNotes'>) {
  const kept = filterPortableFiles(o.files, { includePrivate: o.includePrivate, project: o.project?.path, members: o.members });
  const tables = buildPortableTables({ ...o, project: o.project?.path, permitted: new Set(kept.map((f) => f.rel)) });
  const used = new Set([...kept.map((f) => f.rel), ...(o.privateNotes ?? []).map((n) => n.path)].map((p) => p.toLowerCase()));
  function available(name: string) {
    const ext = path.extname(name);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = name.slice(0, -ext.length) + '-' + n + ext;
    used.add(candidate.toLowerCase());
    return candidate;
  }
  for (const t of tables) t.file = available(t.file);
  const guide = available('README.md');
  const entries = [...kept.map((f) => f.rel), ...tables.map((t) => t.file), guide].sort();
  const token = createHash('sha256').update(JSON.stringify([o.root, o.project?.path, entries])).digest('hex');
  return { kept, tables, guide, entries, token };
}

export function portableDay(day?: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : isoDayOf(new Date());
}

/** One zip of the vault (or one project): notes, files, tables and README. Throws PortableCancelled when cancelled,
 *  leaving no half file at `dest`. Yields as it goes so the app never blocks. */
export async function exportPortable(o: ExportPortableInput): Promise<PortableResult> {
  const dest = o.dest;
  if (!path.isAbsolute(dest)) throw new Error('Choose where to save the file.');
  const rel = path.relative(o.root, dest);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Save the export outside your notes, so it does not include itself.');
  throwIfCancelled(o.shouldCancel);
  o.onProgress?.({ phase: 'listing', done: 0, total: o.files.length });

  const { kept, tables, guide, token } = portablePlan(o);
  if (o.expectedPreview !== undefined && token !== o.expectedPreview) throw new Error('The project files have changed. Reopen the export to review the current list.');
  const day = portableDay(o.day);
  const notesCount = kept.filter((f) => isNoteRel(f.rel)).length + (o.includePrivate && !o.project ? (o.privateNotes?.length ?? 0) : 0);
  const readme = portableReadme({ vault: o.vaultName, day, project: o.project?.name, notes: notesCount, files: kept.length + tables.length + 1 + (o.includePrivate && !o.project ? (o.privateNotes?.length ?? 0) : 0), tables, includePrivate: o.includePrivate && !o.project });

  const tableBytes = tables.map((t) => Buffer.from(tableCsv(t), 'utf8'));
  const readmeBytes = Buffer.from(readme, 'utf8');
  const privateBytes = o.includePrivate && !o.project ? ((o.privateNotes ?? []).map((p) => ({ p, b: Buffer.from(p.text, 'utf8') }))) : [];
  const total = kept.reduce((s, f) => s + f.size, 0) + tableBytes.reduce((s, b) => s + b.length, 0) + readmeBytes.length + privateBytes.reduce((s, x) => s + x.b.length, 0);

  async function* sources(): AsyncGenerator<ZipSource> {
    let n = 0;
    for (const f of kept) {
      throwIfCancelled(o.shouldCancel);
      if (++n % 40 === 0) await new Promise((r) => setImmediate(r));
      yield { name: f.rel, abs: f.abs, mtime: f.mtime };
    }
    for (const { p, b } of privateBytes) {
      throwIfCancelled(o.shouldCancel);
      yield { name: p.path, data: b, mtime: p.modified };
    }
    for (let i = 0; i < tables.length; i++) {
      throwIfCancelled(o.shouldCancel);
      yield { name: tables[i].file, data: tableBytes[i], mtime: Date.now() };
    }
    throwIfCancelled(o.shouldCancel);
    yield { name: guide, data: readmeBytes, mtime: Date.now() };
  }

  o.onProgress?.({ phase: 'packing', done: 0, total });
  await writeZip(dest, sources(), (_n, bytes) => o.onProgress?.({ phase: 'packing', done: Math.min(bytes, total), total }));
  const size = (await fsp.stat(dest)).size;
  const count = kept.length + privateBytes.length + tables.length + 1;
  const words = o.project
    ? `“${o.project.name}” is saved in one file, ${path.basename(dest)} (${count.toLocaleString('en-AU')} files). Open it anywhere: notes as Markdown, tables as CSV.`
    : `Your notes are saved in one file, ${path.basename(dest)} (${count.toLocaleString('en-AU')} files). Open it anywhere: notes as Markdown, tables as CSV.`;
  return { file: dest, files: count, bytes: size, words };
}

export { exportFileName, INCLUDE_PRIVATE_LABEL, PRIVATE_NEEDED };

export interface PortableServiceDeps {
  handle(channel: string, fn: (...args: never[]) => unknown): void;
  send(channel: string, payload: unknown): void;
  root(): string | null;
  vaultName(): string;
  saveDialog(defaultName: string): Promise<string | null>;
  /** A development build's checks may pass a file straight in (an installed app always asks). */
  allowFile: boolean;
  notes(): PortableNote[];
  projects(): PortableProject[];
  projectMembers?(path: string): string[];
  tasks(): PortableTask[];
  moduleTypes(): ModuleTypeInput[];
  moduleFolder?(typeId: string): string;
  privateUnlocked(): boolean;
  privateNotes(): PortablePrivateNote[];
  secrets(): Promise<PortableSecret[]>;
  health(): Promise<HealthTableInput | null>;
}

/** Settings › Backups and sync › Export everything, the palette and a project's Export this project. One export at a
 *  time; cancel sets the flag the packing loop reads, so a cancelled export leaves no half file. */
export function registerPortableExport(d: PortableServiceDeps): { cancel(): void } {
  let running = false;
  let cancelled = false;
  const progress = (p: PortableProgress) => d.send('portable:progress', p);

  function projectInfo(projectPath: unknown) {
    const found = d.projects().find((p) => p.path === projectPath);
    if (!found) throw new Error('That project is not there any more.');
    return { path: found.path, name: found.name };
  }
  function records(project?: { path: string; name: string }) {
    return { project, members: project ? new Set(d.projectMembers?.(project.path)) : undefined, notes: d.notes(), projects: d.projects(), tasks: d.tasks(), moduleTypes: d.moduleTypes(), moduleFolder: d.moduleFolder };
  }

  async function run(o: { expectedPreview?: string; file?: unknown; includePrivate?: unknown; project?: { path: string; name: string } }): Promise<PortableResult | null> {
    if (running) throw new Error('An export is already running. Wait for it or cancel it.');
    const root = d.root();
    if (!root) throw new Error('Open your notes first.');
    const includePrivate = o.includePrivate === true;
    if (includePrivate && !o.project && !d.privateUnlocked()) throw new Error(PRIVATE_NEEDED);
    const day = isoDayOf(new Date());
    const name = exportFileName(d.vaultName(), day, o.project?.name);
    running = true;
    cancelled = false;
    try {
      let dest: string | null = null;
      if (typeof o.file === 'string' && path.isAbsolute(o.file) && d.allowFile) dest = o.file.toLowerCase().endsWith('.zip') ? o.file : `${o.file}.zip`;
      else dest = await d.saveDialog(name);
      if (!dest) return null;
      const { files } = await vaultFiles(root);
      const shouldCancel = () => cancelled || d.root() !== root;
      throwIfCancelled(shouldCancel);
      if (o.project) projectInfo(o.project.path);
      return await exportPortable({
        root,
        dest: dest.toLowerCase().endsWith('.zip') ? dest : `${dest}.zip`,
        vaultName: d.vaultName(),
        day,
        includePrivate,
        files,
        expectedPreview: o.expectedPreview,
        ...records(o.project),
        ...(includePrivate && !o.project ? { privateNotes: d.privateNotes(), secrets: await d.secrets(), health: await d.health() } : {}),
        onProgress: progress,
        shouldCancel,
      });
    } finally {
      running = false;
    }
  }

  d.handle('portable:export', (o: { file?: unknown; includePrivate?: unknown } | null) => run({ file: o?.file, includePrivate: o?.includePrivate }));
  d.handle('portable:preview-project', async (projectPath: unknown) => {
    const root = d.root();
    if (!root) throw new Error('Open your notes first.');
    const { files } = await vaultFiles(root);
    if (root !== d.root()) throw new PortableCancelled();
    const { entries, token } = portablePlan({ root, files, includePrivate: false, ...records(projectInfo(projectPath)) });
    return { entries, token };
  });
  d.handle('portable:export-project', (projectPath: unknown, o: { file?: unknown; expectedPreview?: string } | null) => run({ file: o?.file, expectedPreview: o?.expectedPreview, project: projectInfo(projectPath) }));
  d.handle('portable:cancel', () => {
    cancelled = true;
  });
  return { cancel: () => (cancelled = true) };
}
