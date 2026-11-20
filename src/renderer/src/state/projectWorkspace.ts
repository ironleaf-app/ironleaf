// A project's workspace in the window (24 Oct 2026, Workstream 1 part D; src/shared/project-workspace.ts has the rules):
// the project read as records, the person's workspace file read and written (kept in the vault, so every PC shows the
// same), each change made in a view sent to the main side as one project edit (with Undo), and a click on a record
// opening it in the peek with everything connected to it (part B's state/peek.ts) — editing stays deliberate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectEdit } from '../../../shared/project-file';
import type { ConnectedAction } from '../../../shared/project-hub';
import type { RecordRef, RecordType } from '../../../shared/records';
import { readWorkspace, writeWorkspace, type WorkspaceFile } from '../../../shared/project-workspace';
import { notesOfProject, projectRecords, vaultRecords, type RecordNote, type WsRecord } from '../../../shared/workspace-records';
import type { ProjectEditResult, ProjectFiles, ProjectView } from '../../../shared/types';
import { notebookTabPath } from '../../../shared/notebook';
import { plural } from '../../../shared/words';
import { revealItem } from '../views/timeline/reveal';
import { errorMessage } from '../lib/errors';
import * as A from './actions';
import { docs } from './docs';
import { bookmarksRenamed } from './bookmarks';
import { getWorkspace, setWorkspace } from './layout';
import { peek } from './peek';
import { getState, loadFiles, loadNotes, showError, toast, useApp } from './store';
import * as W from './workspace';
import { useCatalogue } from './vaultFiles';
import { useAreas } from './areas';
import { projectCatalogue, vaultFileRecords, withCatalogue } from '../../../shared/file-views';

/** The notes as records read them. */
export function recordNotes(): RecordNote[] {
  return getState().notes.map((n) => ({ path: n.path, title: n.label || n.title, mtime: n.mtime, props: n.props, links: n.links.map((l) => l.target), tags: n.tags }));
}

/** A project's folder as a workspace: the tab showing it comes forward, else it opens (beside, with Ctrl). */
export function openWorkspace(projectPath: string, where: W.Where = 'current'): void {
  const folder = A.folderOf(projectPath);
  const path = notebookTabPath(folder);
  const ws = getWorkspace();
  const found = W.groups(ws.root)
    .flatMap((g) => g.tabs.map((t) => ({ g, t })))
    .find(({ t }) => t.type === 'notebook' && t.path === path);
  if (found && where !== 'tab') {
    setWorkspace((w) => W.activate(w, found.g.id, found.t.id));
    return;
  }
  setWorkspace((w) => W.open(w, { type: 'notebook', path }, where));
}

/** The project file a folder holds (its namesake, else the only project in it), or null. */
export function projectInFolder(folder: string): string | null {
  const { notes } = getState();
  const name = folder.split('/').pop() ?? '';
  const own = notes.find((n) => n.path === `${folder}/${name}.md` && String(n.props.type ?? '').toLowerCase() === 'project');
  if (own) return own.path;
  const inside = notes.filter((n) => A.folderOf(n.path) === folder && String(n.props.type ?? '').toLowerCase() === 'project');
  return inside.length === 1 ? inside[0].path : null;
}

// ── The workspace file ───────────────────────────────────────────────────────────────────────────────────────────────

const files = new Map<string, WorkspaceFile>();
const saving = new Map<string, number>();

/** A project's workspace file (null until read; read again when the vault changes elsewhere). */
export function useWorkspaceFile(project: string): [WorkspaceFile | null, (next: WorkspaceFile) => void] {
  const [file, setFile] = useState<WorkspaceFile | null>(() => files.get(project) ?? null);
  const revision = useApp((s) => s.revision);
  useEffect(() => {
    let live = true;
    // While a save waits, the copy in hand is the newest.
    if (saving.has(project)) return;
    window.nv.workspace.load(project).then(
      (text) => {
        if (!live) return;
        const w = readWorkspace(text, project);
        files.set(project, w);
        setFile(w);
      },
      // A failed read stays unloaded (W5-2): never an empty workspace a save could write over the real one.
      (e) => {
        if (!live) return;
        setFile(null);
        showError(e);
      },
    );
    return () => {
      live = false;
    };
  }, [project, revision]);
  const save = useCallback(
    (next: WorkspaceFile) => {
      files.set(project, next);
      setFile(next);
      window.clearTimeout(saving.get(project));
      saving.set(
        project,
        window.setTimeout(() => {
          // Held as "saving" until the file is written, so a read in between never brings back the older one.
          window.nv.workspace
            .save(project, writeWorkspace(next))
            .catch(showError)
            .finally(() => window.setTimeout(() => saving.delete(project), 400));
        }, 350),
      );
    },
    [project],
  );
  return [file, save];
}

// ── The project, read as records ─────────────────────────────────────────────────────────────────────────────────────

export interface ProjectData {
  view: ProjectView | null;
  files: ProjectFiles | null | undefined;
  records: WsRecord[];
  error: string;
  /** One change made in a view (or several, from a drop): sent one at a time, each with Undo. */
  edit(edits: ProjectEdit[], words?: string): Promise<boolean>;
  reload(): void;
}

export function useProjectData(path: string): ProjectData {
  const revision = useApp((s) => s.revision);
  const notes = useApp((s) => s.notes);
  const canEdit = useApp((s) => s.canEdit);
  const [view, setView] = useState<ProjectView | null>(null);
  const [folder, setFolder] = useState<ProjectFiles | null | undefined>(undefined);
  const [error, setError] = useState('');
  const pathRef = useRef(path);
  pathRef.current = path;
  const versionRef = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(() => {
    const asked = pathRef.current;
    return window.nv.projects.view(asked).then(
      (v) => {
        if (asked !== pathRef.current) return;
        versionRef.current = v.version;
        setView(v);
        setError('');
      },
      (e) => asked === pathRef.current && setError(errorMessage(e)),
    );
  }, []);
  useEffect(() => void load(), [path, revision]);
  useEffect(() => {
    const asked = path;
    window.nv.projects.files(asked).then(
      (f) => asked === pathRef.current && setFolder(f),
      () => asked === pathRef.current && setFolder(null),
    );
  }, [path, view?.project.folder]);
  // The project's actions written in its meetings and notes (the connected vault), as the Overview counts them.
  const [connected, setConnected] = useState<{ path: string; list: ConnectedAction[] } | null>(null);
  useEffect(() => {
    const asked = path;
    window.nv.records.attention(asked).then(
      (a) => asked === pathRef.current && setConnected({ path: asked, list: a?.elsewhere ?? [] }),
      () => asked === pathRef.current && setConnected({ path: asked, list: [] }),
    );
  }, [path, revision]);

  // The files kept with the project in Ironleaf (its Files folder), with what Ironleaf knows of each: versions,
  // where it came from, a line on what it says (src/shared/file-views.ts).
  const projectDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const catalogue = useCatalogue(projectDir || undefined);
  const records = useMemo(() => {
    if (!view) return [];
    const all = recordNotes();
    const mine = notesOfProject(path, view.project.name, all);
    // Files in the project's folder that Ironleaf keeps itself are counted once (from its own Files below).
    const listed = folder?.exists ? folder.groups.flatMap((g) => g.files).slice(0, 400) : [];
    const own = projectRecords({ path, project: view.project, props: view.props, notes: mine, files: listed, logs: view.logs, connected: connected?.path === path ? connected.list : [], today: new Date() });
    return withCatalogue(own, projectCatalogue(catalogue.items, path), { path, name: view.project.name });
  }, [view, folder, notes, path, connected, catalogue.items]);

  const applyResult = async (r: ProjectEditResult) => {
    versionRef.current = r.view.version;
    if (r.moves.length) {
      for (const [from, to] of r.moves) {
        await docs.renamed(from, to);
        setWorkspace((ws) => W.renamed(ws, from, to));
        bookmarksRenamed(from, to);
      }
      pathRef.current = r.view.path;
      void Promise.all([loadNotes(), loadFiles()]);
    }
    setView(r.view);
  };
  const edit = useCallback(
    (edits: ProjectEdit[], words?: string) => {
      if (!canEdit || !edits.length) return Promise.resolve(false);
      const run = queue.current.then(async () => {
        const redoAll = () => {
          queue.current = queue.current
            .then(async () => {
              for (let i = 0; i < edits.length; i++) {
                try {
                  const r = await window.nv.projects.redo(pathRef.current);
                  await applyResult(r);
                } catch (err) {
                  showError(err);
                  break;
                }
              }
              toast(`Redid ${edits.length === 1 ? 'the change' : `all ${edits.length} changes`}.`);
            })
            .catch(() => undefined);
        };
        // The batch's Undo queues behind later edits — one reverse walk, said once, Redo offered back.
        const undoAll = () => {
          queue.current = queue.current
            .then(async () => {
              for (let i = edits.length - 1; i >= 0; i--) {
                try {
                  const r = await window.nv.projects.undo(pathRef.current);
                  await applyResult(r);
                } catch (err) {
                  showError(err);
                  break;
                }
              }
              toast(`Undid ${edits.length === 1 ? 'the change' : `all ${edits.length} changes`}.`, { label: 'Redo', run: redoAll });
            })
            .catch(() => undefined);
        };
        const ok = await runEditBatch({
          edits,
          words,
          apply: async (e) => {
            const r = await window.nv.projects.edit(pathRef.current, e, versionRef.current);
            await applyResult(r);
            return r.words;
          },
          rollbackOne: async () => {
            const r = await window.nv.projects.undo(pathRef.current);
            await applyResult(r);
          },
          undoAll,
        });
        if (!ok) void load();
        return ok;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [canEdit],
  );
  return { view, files: folder, records, error, edit, reload: () => void load() };
}

/** A record written in a meeting or note (the connected vault's): its tick, on its own line there. False when it can't. */
export async function setElsewhere(r: WsRecord, field: string, value: unknown): Promise<boolean> {
  if (r.ref?.at !== 'elsewhere' || field !== 'done' || r.ref.task === undefined || r.ref.line === undefined) return false;
  try {
    await window.nv.tasks.tick(r.ref.path, r.ref.line, r.ref.task, !!value);
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

/** Several edits as one action (9.2 uplift F76): applied in order, said once, one Undo walking back in
 *  reverse order one at a time; a mid-batch failure rolls back what applied and says so. (True all-or-nothing
 *  would need a main-side batch call; this is the renderer's all-or-nothing: ordered apply, ordered reverse
 *  undo, nothing half applied.) */
export async function runEditBatch(opts: {
  edits: ProjectEdit[];
  words?: string;
  apply: (e: ProjectEdit) => Promise<string>;
  rollbackOne: () => Promise<unknown>;
  undoAll: () => void;
}): Promise<boolean> {
  const applied: ProjectEdit[] = [];
  let said = '';
  try {
    for (const e of opts.edits) {
      said = await opts.apply(e);
      applied.push(e);
    }
  } catch (err) {
    for (let i = applied.length - 1; i >= 0; i--) {
      try {
        await opts.rollbackOne();
      } catch {
        break;
      }
    }
    showError(err);
    if (applied.length) toast(`Undid ${applied.length} of ${plural(opts.edits.length, 'change')}.`);
    return false;
  }
  toast(opts.words ?? (opts.edits.length > 1 ? `${opts.edits.length} changes.` : said), { label: 'Undo', run: opts.undoAll });
  return true;
}

// ── Records across the vault ─────────────────────────────────────────────────────────────────────────────────────────

/** Every project's records and the vault's meetings and people (read again when the notes change). */
export function useVaultRecords(o: { files?: boolean } = {}): { records: WsRecord[]; ready: boolean; failed: boolean; reload(): void } {
  const revision = useApp((s) => s.revision);
  const notes = useApp((s) => s.notes);
  const [tick, setTick] = useState(0);
  const [failedAll, setFailedAll] = useState(false);
  const [all, setAll] = useState<{ path: string; project: import('../../../shared/project-file').Project; connected: ConnectedAction[] }[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(
      () =>
        void window.nv.projects
          .all()
          // Each project's actions written in its meetings and notes too, as its Overview and workspace count them.
          .then((list) => Promise.all(list.map((p) => window.nv.records.attention(p.path).then((a) => ({ ...p, connected: a?.elsewhere ?? [] }), () => ({ ...p, connected: [] })))))
          .then(
            (list) => {
              if (!live) return;
              setAll(list);
              setFailedAll(false);
            },
            // A failed read is failed, never "no records" (9.2 uplift F72).
            () => live && setFailedAll(true),
          ),
      all ? 300 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [revision, tick]);
  // Every file in the vault, for a view of files (read only when one is shown: it lists the whole vault).
  const catalogue = useCatalogue(undefined, !!o.files);
  const areas = useAreas();
  const records = useMemo(() => {
    if (!all) return [];
    const rn = recordNotes();
    const list = vaultRecords(
      all.map((p) => ({ path: p.path, project: p.project, connected: p.connected, notes: notesOfProject(p.path, p.project.name, rn).filter((n) => !/^people\//i.test(n.path)) })),
      rn,
      new Date(),
    );
    if (!o.files) return list;
    // Files are the vault's own (with their versions, source and record); a project's files on the PC stay in its workspace.
    const areaName = (id: string) => areas?.areas.find((a) => a.id === id)?.name;
    return [...list.filter((r) => r.kind !== 'file'), ...vaultFileRecords(catalogue.items, areaName, all.map((p) => ({ path: p.path, name: p.project.name })))];
  }, [all, notes, catalogue.items, o.files, areas]);
  const failed = (failedAll && !all) || (!!o.files && catalogue.failed);
  return { records, ready: !!all && (!o.files || catalogue.ready), failed, reload: () => setTick((n) => n + 1) };
}

// ── Opening a record ─────────────────────────────────────────────────────────────────────────────────────────────────

const PEEK_TYPE: Partial<Record<WsRecord['kind'], RecordType>> = { action: 'action', milestone: 'milestone', workstream: 'workstream', meeting: 'meeting', file: 'file', person: 'person', risk: 'risk', decision: 'decision', note: 'note' };

/** A record in the record model's terms (src/shared/records.ts), for the peek. */
export function recordRef(r: WsRecord): RecordRef | null {
  const type = PEEK_TYPE[r.kind];
  if (!type) return null;
  if (r.kind === 'person') return { type, name: r.title, ...(r.path ? { path: r.path } : {}) };
  if (r.kind === 'meeting' || r.kind === 'note') return { type, path: r.path };
  if (r.kind === 'file') return r.ref?.at === 'file' ? { type, path: r.project, folderFile: r.ref.rel } : r.path ? { type, path: r.path } : { type, path: r.project, title: r.title };
  // Written in a meeting or note: the connected vault knows it by its id.
  if (r.ref?.at === 'elsewhere') return { id: r.ref.id, type, path: r.ref.path, ...(r.ref.line !== undefined ? { line: r.ref.line } : {}) };
  return { type, path: r.project, title: r.title };
}

/**
 * One click on a record: the referenced document itself in the main view (t239, 12 Nov 2026: a click opens the
 * document, never a side panel). What has no document of its own (an update, a log's day, a table row) opens where
 * it is written, at its line.
 */
export function openRecord(r: WsRecord, e?: { ctrlKey?: boolean; metaKey?: boolean }): void {
  const tab = !!(e?.ctrlKey || e?.metaKey);
  const ref = recordRef(r);
  if (ref && !tab) {
    peek(ref, { title: r.title, type: ref.type });
    return;
  }
  openRecordPlace(r, tab ? 'tab' : 'current');
}

/** Where a record is written: its own note, or its project's page at its line. */
export function openRecordPlace(r: WsRecord, where: W.Where = 'current'): void {
  if (r.ref?.at === 'elsewhere') return A.openPath(r.ref.path, { where });
  if (r.path && (r.kind !== 'file' || /\.(md|canvas|pdf|png|jpe?g|gif|webp|svg)$/i.test(r.path) || getState().byPath.has(r.path))) {
    const resolved = resolveNote(r.path);
    if (resolved) A.openPath(resolved, { where });
    return;
  }
  if (r.ref?.at === 'file' && r.project) return A.openFolderFile(r.project, r.ref.rel, where);
  if (!r.project) return;
  const item = r.ref?.at === 'list' ? `${r.ref.list}:${r.ref.index}` : undefined;
  if (item) revealItem(r.project, item);
  A.openPath(r.project, { where, reuse: true });
}

/** A link target ("Bettina Maddox") as a note's path when it is one. Ambiguous names resolve to nothing
 *  (W5-22): guessing the first match opens the wrong person's note. */
function resolveNote(target: string): string {
  const { notes, byPath } = getState();
  if (byPath.has(target)) return target;
  const want = target.toLowerCase().replace(/\.md$/i, '');
  const matches = notes.filter((n) => n.path.toLowerCase().replace(/\.md$/i, '').endsWith(`/${want}`) || n.title.toLowerCase() === want);
  if (matches.length > 1) {
    toast(`More than one note is called ${target}. Open the one you mean from Search.`);
    return '';
  }
  return matches[0]?.path ?? target;
}
