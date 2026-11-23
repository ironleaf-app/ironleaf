// The file list in sections (src/shared/navigator.ts): Projects (each one whole: its page, notes, activity, reports, canvas,
// its PC folder's files read live, its automations), Docs (how things are set up and run: each with its canvas), Notes, Daily, Canvases & boards, Templates, Assets, and Attachments
// when asked for. Each section has a quiet header with its count, opens and shuts (remembered), and a + on hover for a new
// one. Right-click for what each thing can do; drag a note onto a project to file it there (links follow); arrows, Enter,
// F2 and Delete work as in any list; the box at the top finds across every section.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from '../../../shared/dates';
import { dropDecisionItem, openProjectTasks, type LooseTask } from '../../../shared/project-close';
import { buildSections, findEntries, inOrder, moveKey, navEntries, SECTION_ORDER, SECTION_WORDS, SHUT_AT_FIRST, type NavDoc, type NavEntry, type NavFolder, type NavItem, type NavProject, type NavSections, type PartId, type SectionId } from '../../../shared/navigator';
import type { ProjectEditResult, ProjectFile, ProjectFiles } from '../../../shared/types';
import { hoverLink } from '../components/HoverPreview';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { openMenu, type MenuItem } from '../components/Menu';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { shownInPlace, writeLink } from '../lib/links';
import { healthTone, statusReading } from '../lib/projectLook';
import * as A from '../state/actions';
import { bookmarksRenamed } from '../state/bookmarks';
import { docs } from '../state/docs';
import { setWorkspace, useWorkspace } from '../state/layout';
import { fileMenu } from '../state/menus';
import { getState, loadFiles, loadNotes, showError, toast, useApp, usePrefs } from '../state/store';
import { newNoteFromTemplate, newProject, newTemplate, templateMenuItems } from '../state/templates';
import { newDoc, showDocCanvas, turnIntoDoc, turnIntoProject, updateDocCanvas } from '../state/docKind';
import { newView } from '../state/savedViews';
import * as W from '../state/workspace';
import { openProjectCanvas } from '../views/canvas/projectBoards';
import { CloseDialog, type CloseTarget } from '../views/project/CloseDialog';
import { onAskedSection, rememberExplorer, takeAskedSection, useExplorerMemory } from './explorer-state';
import type { FileHit } from '../../../shared/file-index';
import { Marked, plainSnippet } from '../components/FileHits';
import { openHitInProgram, showFileHit, showHitInFolder, useFileHits } from '../state/fileSearch';
import { newNoteOfType } from '../state/noteTypes';
import { getAreas } from '../state/areas';
import { MODULES, moduleFolder } from '../../../shared/module-records';
import { moduleOn } from '../../../shared/life-modules';
import type { MachineryCtx } from '../../../shared/fewer-folders';
import { isEnterKey } from '../lib/enterKey';

const PATHS_MIME = 'application/x-nv-paths';
const KIND_ICONS: Record<string, IconName> = { logo: 'sparkle', image: 'image', icon: 'diagram', document: 'file', media: 'video', other: 'file' };
/** Rows a long list shows before "Show all". */
const CAP = 80;
const INDENT = 14;

// ── The rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row =
  | { t: 'section'; id: string; section: SectionId; count: number; open: boolean; depth: 0 }
  | { t: 'project'; id: string; project: NavProject; open: boolean; depth: number; parent?: string }
  /** A doc: opens its page; open (when it has a canvas or things of its own) shows them under it. */
  | { t: 'doc'; id: string; doc: NavDoc; open?: boolean; depth: 0 }
  | { t: 'part'; id: string; project: NavProject; part: PartId; label: string; icon: IconName; count?: number; open?: boolean; hint?: string; depth: number; parent: string }
  | { t: 'folder'; id: string; path: string; name: string; count: number; open: boolean; depth: number; parent?: string; section: SectionId }
  | { t: 'item'; id: string; item: NavItem; depth: number; parent?: string; section: SectionId; label?: string; hint?: string; project?: NavProject }
  | { t: 'group'; id: string; label: string; count: number; open: boolean; depth: number; parent?: string }
  | { t: 'today'; id: string; item: NavItem | null; depth: number }
  | { t: 'pcdir'; id: string; project: NavProject; rel: string; name: string; count: number; open: boolean; depth: number; parent: string }
  | { t: 'pcfile'; id: string; project: NavProject; file: ProjectFile; depth: number; parent: string }
  | { t: 'kind'; id: string; kind: string; label: string; count: number; depth: number }
  | { t: 'note'; id: string; words: string; depth: number; action?: { label: string; run(): void }; hint?: string }
  | { t: 'more'; id: string; words: string; depth: number; run(): void }
  | { t: 'hit'; id: string; entry: NavEntry; depth: 0; pc?: { project: NavProject; file: ProjectFile } }
  /** While finding: the files whose words match (the files index), under their own heading. */
  | { t: 'heading'; id: string; label: string; count: number; depth: 0 }
  | { t: 'inside'; id: string; hit: FileHit; depth: 0 };

const vaultPath = (r: Row): string | null => (r.t === 'item' ? r.item.path : r.t === 'doc' ? r.doc.path : r.t === 'folder' ? r.path : r.t === 'hit' && !r.pc && r.entry.kind !== 'project' ? r.entry.path : null);
const expandable = (r: Row) => 'open' in r && r.open !== undefined;

// ── A project's folder on the PC, read live (as its page does) and kept a little while ─────────────────────────────────

const pcCache = new Map<string, { at: number; files: ProjectFiles | null; loading?: boolean; failed?: boolean }>();
const pcListeners = new Set<() => void>();
function readPc(project: string, force = false): void {
  const had = pcCache.get(project);
  if (had?.loading || (!force && had && Date.now() - had.at < 30000)) return;
  pcCache.set(project, { at: had?.at ?? 0, files: had?.files ?? null, loading: true });
  pcListeners.forEach((fn) => fn());
  window.nv.projects.files(project).then(
    (files) => pcCache.set(project, { at: Date.now(), files }),
    // Unreadable keeps last-known files and says failed (9.2 uplift F102), never "isn't on this PC".
    () => pcCache.set(project, { at: Date.now(), files: had?.files ?? null, failed: true }),
  ).finally(() => pcListeners.forEach((fn) => fn()));
}
function usePcTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    pcListeners.add(fn);
    return () => void pcListeners.delete(fn);
  }, []);
  return tick;
}

interface PcDir {
  rel: string;
  name: string;
  dirs: PcDir[];
  files: ProjectFile[];
  count: number;
}
/** The folder's files as a tree of their folders (as on disk), each folder's files newest first. */
function pcTree(files: ProjectFiles): PcDir {
  const root: PcDir = { rel: '', name: '', dirs: [], files: [], count: 0 };
  const index = new Map<string, PcDir>([['', root]]);
  const ensure = (rel: string): PcDir => {
    const found = index.get(rel);
    if (found) return found;
    const parent = ensure(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const d: PcDir = { rel, name: rel.split('/').pop()!, dirs: [], files: [], count: 0 };
    parent.dirs.push(d);
    index.set(rel, d);
    return d;
  };
  for (const g of files.groups) for (const f of g.files) ensure(f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '').files.push(f);
  const count = (d: PcDir): number => (d.count = d.files.length + d.dirs.reduce((n, x) => n + count(x), 0));
  count(root);
  const order = (d: PcDir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    d.files.sort((a, b) => b.modified - a.modified);
    d.dirs.forEach(order);
  };
  order(root);
  return root;
}

/** A daily note's name as a day ("Fri 16 Oct") when it is just a date. */
function dayWords(name: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
}

/** Words typed, marked in a name. */
function marked(text: string, query: string): ReactNode {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const lowerText = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words) {
    let at = lowerText.indexOf(w);
    while (at >= 0) {
      spans.push([at, at + w.length]);
      at = lowerText.indexOf(w, at + w.length);
    }
  }
  if (!spans.length) return text;
  spans.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of spans) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    if (from > pos) out.push(text.slice(pos, from));
    out.push(<mark key={from} className="nav-hit">{text.slice(from, e)}</mark>);
    pos = e;
  }
  out.push(text.slice(pos));
  return out;
}

/** A change to a project's file (rename, done) followed through: open tabs, bookmarks and unsaved notes go with a move. */
async function followMoves(r: ProjectEditResult): Promise<void> {
  for (const [from, to] of r.moves) {
    await docs.renamed(from, to);
    setWorkspace((ws) => W.renamed(ws, from, to));
    bookmarksRenamed(from, to);
  }
  await Promise.all([loadNotes(), loadFiles()]);
}
async function editProject(path: string, change: Parameters<typeof window.nv.projects.edit>[1]): Promise<string | null> {
  try {
    if (change.kind === 'set' && change.field === 'name') await docs.settle();
    const r = await window.nv.projects.edit(path, change);
    await followMoves(r);
    toast(r.words, {
      label: 'Undo',
      run: () =>
        void window.nv.projects
          .undo(r.view.path)
          .then(async (u) => {
            await followMoves(u);
            toast(u.words);
          })
          .catch(showError),
    });
    return r.view.path;
  } catch (err) {
    showError(err);
    return null;
  }
}

// ── The navigator ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function Navigator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const notes = useApp((s) => s.notes);
  const files = useApp((s) => s.files);
  const folders = useApp((s) => s.folders);
  const filesRevision = useApp((s) => s.filesRevision);
  const canEdit = useApp((s) => s.canEdit);
  const settings = useApp((s) => s.settings);
  const prefs = usePrefs();
  const ws = useWorkspace();
  const active = W.activeTab(ws).path;
  const [memory, loaded] = useExplorerMemory();
  const pcTick = usePcTick();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Dragging into an order of the person's own (shared/navigator.ts inOrder): where the row being dragged would land.
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  /** Each list that can be put in order (its keys as shown), and which list and key each of its rows is. */
  const orderInfo = useRef({ groups: new Map<string, string[]>(), rows: new Map<string, { group: string; key: string }>() });
  const [everything, setEverything] = useState<Set<string>>(new Set());
  const [keys, setKeys] = useState(false);
  const [assetKinds, setAssetKinds] = useState<Map<string, number> | null>(null);
  // Closing with open tasks (p12-close-and-noise A): Move to Done opens the shared dialog instead of closing silently.
  const [closeAsk, setCloseAsk] = useState<null | { path: string; name: string; tasks: LooseTask[]; targets: CloseTarget[] }>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const filterBox = useRef<HTMLInputElement>(null);

  const sort = memory.sort ?? 'name';
  const showAttachments = !!memory.showAttachments;
  /** Notes or folders dragged into an order of the person's own (the sort menu says so). */
  const ownNotes = Object.keys(memory.order ?? {}).some((k) => k.startsWith('items:') || k.startsWith('dirs:'));
  const todayName = formatDate(settings?.dailyFormat || 'YYYY-MM-DD');
  // Fewer folders on show (5 Nov 2026): machinery sits under one quiet Show everything in Notes, remembered
  // on this PC. Search still finds hidden notes (shared keeps them in hiddenNotes for the filter box). One switch
  // for both panel modes (Nov 2026, b6 break job): the folders mode's key, with this mode's old key carried over.
  const [showMachinery, setShowMachinery] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nv-folders-show-all') === '1' || localStorage.getItem('nv-nav-show-all') === '1';
    } catch {
      return false;
    }
  });
  const toggleMachinery = () =>
    setShowMachinery((was) => {
      try {
        localStorage.setItem('nv-folders-show-all', was ? '0' : '1');
        localStorage.removeItem('nv-nav-show-all');
      } catch {
        // Remembering is a convenience.
      }
      return !was;
    });
  const machinery = useMemo<MachineryCtx>(() => {
    const areas = getAreas()?.areas ?? [];
    return {
      templatesFolder: prefs.templatesFolder,
      assetsFolder: prefs.assetsFolder,
      attachmentsFolder: prefs.attachmentsFolder,
      dailyFolder: settings?.dailyFolder ?? 'Daily',
      areas,
      // Only a pack switched on hides its folder (t155, 9 Nov 2026): an off pack adds nothing
      // (shared/life-modules.ts), so the person's own folder under its name shows with their folders.
      moduleFolders: MODULES.filter((m) => moduleOn(prefs.modules, m.id)).map((m) => moduleFolder(m.id, areas.length ? areas : null)).filter(Boolean),
      quietFolders: prefs.quietFolders ?? [],
    };
    // getAreas reads outside React; notes changing is the signal to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, prefs.templatesFolder, prefs.assetsFolder, prefs.attachmentsFolder, prefs.quietFolders, prefs.modules, settings?.dailyFolder]);
  const sections: NavSections = useMemo(
    () =>
      buildSections(notes, files, folders, {
        templatesFolder: prefs.templatesFolder,
        assetsFolder: prefs.assetsFolder,
        attachmentsFolder: prefs.attachmentsFolder,
        dailyFolder: settings?.dailyFolder ?? 'Daily',
        todayName,
        showAllFiles: prefs.showAllFiles,
        sort,
        machinery,
        showMachinery,
      }),
    [notes, files, folders, prefs.templatesFolder, prefs.assetsFolder, prefs.attachmentsFolder, prefs.showAllFiles, settings?.dailyFolder, todayName, sort, machinery, showMachinery],
  );
  const projectByPath = useMemo(() => new Map(sections.projects.map((p) => [p.path, p])), [sections]);


  const open = useMemo(() => new Set(memory.open ?? []), [memory.open]);
  const shut = useMemo(() => new Set(memory.shut ?? []), [memory.shut]);
  const sectionOpen = (s: SectionId) => memory.sections?.[s] ?? !SHUT_AT_FIRST.includes(s);
  const isOpen = (id: string, atFirst = false) => (atFirst ? !shut.has(id) : open.has(id));
  const setRow = (id: string, value: boolean, atFirst = false) =>
    rememberExplorer((m) => {
      const o = new Set(m.open ?? []);
      const s = new Set(m.shut ?? []);
      if (atFirst) {
        if (value) s.delete(id);
        else s.add(id);
      } else {
        o.delete(id);
        if (value) o.add(id);
      }
      return { open: [...o], shut: [...s] };
    });
  const setSection = (s: SectionId, value: boolean) => rememberExplorer((m) => ({ sections: { ...m.sections, [s]: value } }));

  // The asset store's own counts (kinds the person chose are kept in its index), read while the section shows.
  const assetsShown = sectionOpen('assets') && !query;
  useEffect(() => {
    if (!assetsShown) return;
    const t = setTimeout(() => {
      window.nv.assets.list().then(
        (l) => {
          const m = new Map<string, number>();
          for (const a of l.assets) if (!a.attachment) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
          setAssetKinds(m);
        },
        () => setAssetKinds(null),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [assetsShown, filesRevision]);

  // ── The rows shown, in order ────────────────────────────────────────────────────────────────────────────────────────
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const order = memory.order ?? {};
    const info = { groups: new Map<string, string[]>(), rows: new Map<string, { group: string; key: string }>() };
    orderInfo.current = info;
    /** A list in the person's own order, noted so its rows can be dragged within it. */
    const arrange = <T,>(group: string, list: T[], key: (x: T) => string, rowId: (x: T) => string): T[] => {
      const sorted = inOrder(list, order[group], key);
      info.groups.set(group, sorted.map(key));
      for (const x of sorted) info.rows.set(rowId(x), { group, key: key(x) });
      return sorted;
    };
    const capped = <T,>(id: string, list: T[], depth: number, each: (x: T) => void) => {
      const all = everything.has(id);
      for (const x of all ? list : list.slice(0, CAP)) each(x);
      if (!all && list.length > CAP) out.push({ t: 'more', id: `${id}:more`, words: `Show all ${list.length}`, depth, run: () => setEverything((e) => new Set(e).add(id)) });
    };
    const folderRows = (f: NavFolder, depth: number, section: SectionId, parent?: string) => {
      for (const sub of arrange(`dirs:${section}:${f.path}`, f.folders, (x) => x.path, (x) => `d:${x.path}`)) {
        const id = `d:${sub.path}`;
        const o = isOpen(id);
        out.push({ t: 'folder', id, path: sub.path, name: sub.name, count: sub.count, open: o, depth, parent, section });
        if (o) folderRows(sub, depth + 1, section, id);
      }
      capped(`d:${f.path}:items`, arrange(`items:${section}:${f.path}`, f.items, (x) => x.path, (x) => x.path), depth, (it) => out.push({ t: 'item', id: it.path, item: it, depth, parent, section }));
    };
    const itemRows = (items: NavItem[], depth: number, parent: string, project: NavProject) =>
      capped(parent, items, depth, (it) => out.push({ t: 'item', id: it.path, item: it, depth, parent, section: 'projects', project, hint: it.status }));
    const pcRows = (p: NavProject, d: PcDir, depth: number, parent: string) => {
      for (const sub of d.dirs) {
        const id = `pc:${p.path}:${sub.rel}`;
        const o = isOpen(id);
        out.push({ t: 'pcdir', id, project: p, rel: sub.rel, name: sub.name, count: sub.count, open: o, depth, parent });
        if (o) pcRows(p, sub, depth + 1, id);
      }
      capped(`pcf:${p.path}:${d.rel}`, d.files, depth, (f) => out.push({ t: 'pcfile', id: `pcf:${p.path}:${f.rel}`, project: p, file: f, depth, parent }));
    };
    const projectRows = (p: NavProject, depth: number, parent?: string) => {
      const id = `p:${p.path}`;
      const o = isOpen(id);
      out.push({ t: 'project', id, project: p, open: o, depth, parent });
      if (!o) return;
      const d = depth + 1;
      out.push({ t: 'part', id: `${id}:overview`, project: p, part: 'overview', label: 'Overview', icon: 'book', depth: d, parent: id });
      const list = (part: PartId, label: string, icon: IconName, items: NavItem[]) => {
        if (!items.length) return;
        const pid = `${id}:${part}`;
        const po = isOpen(pid);
        out.push({ t: 'part', id: pid, project: p, part, label, icon, count: items.length, open: po, depth: d, parent: id });
        if (po) itemRows(items, d + 1, pid, p);
      };
      list('notes', 'Notes', 'notes', p.notes);
      list('activity', 'Activity', 'spark', p.activity);
      list('reports', 'Reports', 'chart', p.reports);
      if (p.canvases.length > 1) list('canvas', 'Canvases', 'canvas', p.canvases);
      else out.push({ t: 'part', id: `${id}:canvas`, project: p, part: 'canvas', label: 'Canvas', icon: 'canvas', depth: d, parent: id, hint: p.canvases.length ? undefined : 'Make' });
      if (p.pcFolder || p.files.length) {
        const pid = `${id}:files`;
        const po = isOpen(pid);
        const pc = p.pcFolder ? pcCache.get(p.path) : undefined;
        const total = p.files.length + (pc?.files?.exists ? pc.files.total : 0);
        out.push({ t: 'part', id: pid, project: p, part: 'files', label: 'Files', icon: 'folder', count: pc?.files || !p.pcFolder ? total : undefined, open: po, depth: d, parent: id });
        if (po) {
          itemRows(p.files, d + 1, pid, p);
          if (p.pcFolder) {
            if (!pc || (pc.loading && !pc.files)) out.push({ t: 'note', id: `${pid}:reading`, words: 'Reading the folder…', depth: d + 1 });
            else if (pc.failed && !pc.files) out.push({ t: 'note', id: `${pid}:unread`, words: 'Its folder couldn’t be read.', depth: d + 1, action: { label: 'Read it again', run: () => readPc(p.path, true) } });
            else if (!pc.files || !pc.files.exists) out.push({ t: 'note', id: `${pid}:missing`, words: 'Its folder isn’t on this PC.', depth: d + 1 });
            else if (!pc.files.total) out.push({ t: 'note', id: `${pid}:empty`, words: 'Its folder is empty.', depth: d + 1 });
            else pcRows(p, pcTree(pc.files), d + 1, pid);
          }
        }
      }
    };

    // A section with nothing in it isn't shown (19 Oct 2026; the former host app and Vault design, release 2): its place
    // (Projects, Templates, Assets…) is at the top of the left side or in More. Notes always shows, with its one empty
    // line only when the whole vault is empty.
    const has: Record<string, boolean> = {
      projects: sections.projects.length > 0,
      docs: sections.docs.length > 0,
      notes: true,
      daily: !!sections.daily.today || sections.daily.months.length > 0,
      canvases: sections.canvases.length > 0,
      views: sections.views.length > 0,
      templates: sections.templates.count > 0,
      assets: sections.assets.total > 0 || (assetKinds?.size ?? 0) > 0,
      attachments: sections.attachments.count > 0,
    };
    const empty = !Object.entries(has).some(([k, v]) => k !== 'notes' && v) && !sections.notes.count && !sections.notes.folders.length;
    for (const s of arrange('sections', SECTION_ORDER, (x) => x, (x) => `s:${x}`)) {
      if (s === 'attachments' && !showAttachments) continue;
      if (has[s] === false) continue;
      const o = sectionOpen(s);
      out.push({ t: 'section', id: `s:${s}`, section: s, count: sections.counts[s], open: o, depth: 0 });
      if (!o) continue;
      if (s === 'projects') {
        const live = arrange('projects', sections.projects.filter((p) => !p.done), (p) => p.path, (p) => `p:${p.path}`);
        const done = arrange('projects-done', sections.projects.filter((p) => p.done), (p) => p.path, (p) => `p:${p.path}`);
        for (const p of live) projectRows(p, 0);
        if (done.length) {
          // One quiet Finished line (5 Nov 2026, fewer folders; the Projects page says the same): finished
          // projects stay reachable here, never among active ones. The id stays 'done' so a remembered open carries over.
          const go = isOpen('done');
          out.push({ t: 'group', id: 'done', label: 'Finished', count: done.length, open: go, depth: 0 });
          if (go) for (const p of done) projectRows(p, 1, 'done');
        }
        if (!sections.projects.length) out.push({ t: 'note', id: 'projects:none', words: 'No projects yet.', depth: 0, action: canEdit ? { label: 'New project', run: () => newProject() } : undefined });
      } else if (s === 'docs') {
        for (const d of arrange('docs', sections.docs, (x) => x.path, (x) => `doc:${x.path}`)) {
          const id = `doc:${d.path}`;
          const kids = (d.canvas ? 1 : 0) + d.items.length;
          const o = kids ? isOpen(id) : undefined;
          out.push({ t: 'doc', id, doc: d, open: o, depth: 0 });
          if (!o) continue;
          if (d.canvas) out.push({ t: 'item', id: d.canvas.path, item: d.canvas, depth: 1, parent: id, section: 'docs', label: 'Canvas' });
          capped(id, d.items, 1, (it) => out.push({ t: 'item', id: it.path, item: it, depth: 1, parent: id, section: 'docs', hint: it.status }));
        }
        if (!sections.docs.length) out.push({ t: 'note', id: 'docs:none', words: 'No docs yet.', hint: 'A doc is how something is set up and run: a server, a routine, a process. Kept up to date in place.', depth: 0, action: canEdit ? { label: 'New doc', run: () => void newDoc() } : undefined });
      } else if (s === 'notes') {
        folderRows(sections.notes, 0, 'notes');
        // One quiet Show everything (fewer folders): machinery folders, hidden unless asked for. A vault with
        // nothing hidden shows no row at all. Search still finds hidden notes, and every page keeps working.
        const hidden = sections.hiddenNotes?.length ?? 0;
        if (hidden > 0 || showMachinery) out.push({ t: 'more', id: 'notes:show-all', words: showMachinery ? 'Show fewer folders' : `Show everything · ${hidden}`, depth: 0, run: toggleMachinery });
        if (empty) out.push({ t: 'note', id: 'notes:none', words: 'No notes yet.', depth: 0, action: canEdit ? { label: 'New note', run: () => void newNoteOfType() } : undefined });
      } else if (s === 'daily') {
        out.push({ t: 'today', id: sections.daily.today?.path ?? 'today', item: sections.daily.today, depth: 0 });
        sections.daily.months.forEach((m, i) => {
          const id = `m:${m.key}`;
          const mo = isOpen(id, i === 0);
          out.push({ t: 'group', id, label: m.label, count: m.items.length, open: mo, depth: 0 });
          if (mo) capped(id, m.items, 1, (it) => out.push({ t: 'item', id: it.path, item: it, depth: 1, parent: id, section: 'daily', label: dayWords(it.name) ?? undefined }));
        });
      } else if (s === 'canvases') {
        capped('canvases', arrange('canvases', sections.canvases, (x) => x.path, (x) => x.path), 0, (it) => out.push({ t: 'item', id: it.path, item: it, depth: 0, section: 'canvases', hint: A.folderOf(it.path) || undefined }));
        if (!sections.canvases.length) out.push({ t: 'note', id: 'canvases:none', words: 'No canvases yet.', depth: 0, action: canEdit ? { label: 'New canvas', run: () => void A.newCanvas() } : undefined });
      } else if (s === 'views') {
        capped('views', arrange('views', sections.views, (x) => x.path, (x) => x.path), 0, (it) => out.push({ t: 'item', id: it.path, item: it, depth: 0, section: 'views', hint: A.folderOf(it.path) && A.folderOf(it.path) !== 'Views' ? A.folderOf(it.path) : undefined }));
      } else if (s === 'templates') {
        folderRows(sections.templates, 0, 'templates');
        if (!sections.templates.count) out.push({ t: 'note', id: 'templates:none', words: 'No templates yet.', depth: 0 });
      } else if (s === 'assets') {
        const kinds = sections.assets.kinds.map((k) => ({ ...k, count: assetKinds ? (assetKinds.get(k.kind) ?? 0) : k.count }));
        if (assetKinds) for (const [kind, count] of assetKinds) if (!kinds.some((k) => k.kind === kind)) kinds.push({ kind: kind as never, label: kind, count });
        for (const k of kinds.filter((x) => x.count)) out.push({ t: 'kind', id: `k:${k.kind}`, kind: k.kind, label: k.label, count: k.count, depth: 0 });
        if (!sections.assets.total) out.push({ t: 'note', id: 'assets:none', words: 'No assets yet.', depth: 0, action: { label: 'Open Assets', run: () => A.openAssets() } });
      } else if (s === 'attachments') {
        folderRows(sections.attachments, 0, 'attachments');
        if (!sections.attachments.count) out.push({ t: 'note', id: 'attachments:none', words: 'Nothing pasted or dropped in yet.', depth: 0 });
      }
    }
    return out;
    // showMachinery changes sections (hiddenNotes); toggleMachinery is stable enough to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, open, shut, memory.sections, memory.order, showAttachments, everything, pcTick, assetKinds, canEdit, showMachinery]);

  // A project's Files opened before (remembered) are read when they show.
  useEffect(() => {
    for (const r of rows) if (r.t === 'part' && r.part === 'files' && r.open && r.project.pcFolder) readPc(r.project.path);
  }, [rows]);

  // ── Finding across every section ──────────────────────────────────────────────────────────────────────────────────
  const entries = useMemo(() => navEntries(sections, showAttachments), [sections, showAttachments]);
  // Inside the documents in projects' folders too (the files index), once three letters are typed.
  const { hits: insideHits } = useFileHits(query, { min: 3, limit: 60 });
  const hits: Row[] | null = useMemo(() => {
    if (!query.trim()) return null;
    const pcEntries: (NavEntry & { pc: { project: NavProject; file: ProjectFile } })[] = [];
    for (const p of sections.projects) {
      const pc = pcCache.get(p.path)?.files;
      if (pc?.exists) for (const g of pc.groups) for (const f of g.files) pcEntries.push({ path: `pcf:${p.path}:${f.rel}`, name: f.name, kind: 'other', section: 'projects', where: `${p.name} · Files`, mtime: f.modified, project: p.path, pc: { project: p, file: f } });
    }
    const found = findEntries([...entries, ...pcEntries], query, 2000);
    const out: Row[] = [];
    for (const s of SECTION_ORDER) {
      const mine = found.filter((e) => e.section === s);
      if (!mine.length) continue;
      out.push({ t: 'section', id: `s:${s}`, section: s, count: mine.length, open: true, depth: 0 });
      const id = `hits:${s}`;
      const all = everything.has(id);
      for (const e of all ? mine : mine.slice(0, 30)) out.push({ t: 'hit', id: e.kind === 'project' ? `p:${e.path}` : e.path, entry: e, depth: 0, pc: (e as { pc?: { project: NavProject; file: ProjectFile } }).pc });
      if (!all && mine.length > 30) out.push({ t: 'more', id: `${id}:more`, words: `Show all ${mine.length}`, depth: 0, run: () => setEverything((x) => new Set(x).add(id)) });
    }
    // Files whose words match (those found by name are listed above already).
    const named = new Set(found.flatMap((e) => ((e as { pc?: { project: NavProject; file: ProjectFile } }).pc ? [e.path] : [])));
    const inside = insideHits.filter((h) => h.snippets.length && !named.has(`pcf:${h.project}:${h.rel}`));
    if (inside.length) {
      out.push({ t: 'heading', id: 'inside:heading', label: 'In project files', count: inside.length, depth: 0 });
      const all = everything.has('inside');
      for (const h of all ? inside : inside.slice(0, 20)) out.push({ t: 'inside', id: `inside:${h.project}:${h.rel}`, hit: h, depth: 0 });
      if (!all && inside.length > 20) out.push({ t: 'more', id: 'inside:more', words: `Show all ${inside.length}`, depth: 0, run: () => setEverything((x) => new Set(x).add('inside')) });
    }
    return out;
  }, [query, entries, sections, everything, pcTick, insideHits]);

  const list = hits ?? rows;
  const navigable = useMemo(() => list.filter((r) => r.t !== 'note' && r.t !== 'heading'), [list]);
  const rowById = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);

  // ── Showing a note in the list ──────────────────────────────────────────────────────────────────────────────────────
  const scrollTo = (id: string) => requestAnimationFrame(() => requestAnimationFrame(() => body.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })));
  /** The rows above a note opened (its project and part, its folders, its month); with `all`, its section too. */
  const openAbove = useCallback(
    (path: string, all: boolean): string | null => {
      const place = sections.place.get(path);
      if (!place) {
        if (getState().folders.includes(path)) {
          const ids = [] as string[];
          for (let d = path; d; d = A.folderOf(d)) ids.push(`d:${d}`);
          rememberExplorer((m) => ({ open: [...new Set([...(m.open ?? []), ...ids])], sections: all ? { ...m.sections, notes: true } : m.sections }));
          return `d:${path}`;
        }
        if (all && sections.attachments.count && !showAttachments && path.startsWith(sections.attachments.path)) rememberExplorer({ showAttachments: true });
        return null;
      }
      const ids: string[] = [];
      let id = path;
      let unshut: string | null = null;
      if (place.project) {
        const p = projectByPath.get(place.project);
        if (p?.done) ids.push('done');
        if (place.part === 'overview') id = `p:${place.project}`;
        else {
          ids.push(`p:${place.project}`);
          if (place.part !== 'canvas' || (p && p.canvases.length > 1)) ids.push(`p:${place.project}:${place.part}`);
          if (place.part === 'canvas' && p && p.canvases.length <= 1) id = `p:${place.project}:canvas`;
        }
      }
      if (place.doc) {
        if (place.doc === path) id = `doc:${path}`;
        else ids.push(`doc:${place.doc}`);
      }
      for (const f of place.folders ?? []) ids.push(`d:${f}`);
      if (place.month) unshut = `m:${place.month}`;
      if (!all && !sectionOpen(place.section)) return null;
      rememberExplorer((m) => ({
        open: [...new Set([...(m.open ?? []), ...ids])],
        shut: unshut ? (m.shut ?? []).filter((x) => x !== unshut) : m.shut,
        sections: all ? { ...m.sections, [place.section]: true } : m.sections,
        ...(all && place.section === 'attachments' ? { showAttachments: true } : {}),
      }));
      if (place.month && sections.daily.months[0]?.key !== place.month) rememberExplorer((m) => ({ open: [...new Set([...(m.open ?? []), unshut!])] }));
      return id;
    },
    [sections, projectByPath, memory.sections, showAttachments],
  );

  const reveal = useCallback(
    (path: string) => {
      setQuery('');
      const id = openAbove(path, true) ?? path;
      setSelected(new Set([id]));
      setFocus(id);
      scrollTo(id);
    },
    [openAbove],
  );
  useEffect(() => {
    A.onRevealInExplorer(reveal);
    return () => A.onRevealInExplorer(null);
  }, [reveal]);
  // A kind chosen on the calm left side (explorer-state.ts askForSection): its section at the top of the list.
  useEffect(() => {
    const go = () => {
      const s = takeAskedSection();
      if (!s) return;
      setQuery('');
      setFocus(`s:${s}`);
      setSelected(new Set());
      requestAnimationFrame(() => requestAnimationFrame(() => body.current?.querySelector(`[data-id="${CSS.escape(`s:${s}`)}"]`)?.scrollIntoView({ block: 'start' })));
    };
    go();
    return onAskedSection(go);
  }, []);
  // The open note shows in the list (its rows opened, within the sections the person keeps open).
  const lastActive = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!loaded || !active || active === lastActive.current) return;
    lastActive.current = active;
    const id = openAbove(active, false);
    if (id) scrollTo(id);
  }, [active, openAbove, loaded]);

  // ── Choosing, opening, toggling ─────────────────────────────────────────────────────────────────────────────────────
  const select = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const row = rowById.get(id);
    const multi = row && vaultPath(row);
    if (multi && e.shiftKey && focus) {
      const a = navigable.findIndex((r) => r.id === focus);
      const b = navigable.findIndex((r) => r.id === id);
      if (a >= 0 && b >= 0) {
        setSelected(new Set(navigable.slice(Math.min(a, b), Math.max(a, b) + 1).filter((r) => vaultPath(r)).map((r) => r.id)));
        return true;
      }
    }
    if (multi && (e.ctrlKey || e.metaKey)) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setFocus(id);
      return true;
    }
    setSelected(new Set([id]));
    setFocus(id);
    return false;
  };
  const where = (e?: { ctrlKey: boolean; metaKey: boolean }): W.Where => (e && (e.ctrlKey || e.metaKey) ? 'tab' : 'current');
  // A file in a project's folder opens in the full viewer as a tab (t239), whatever kind it is.
  const showPcFile = (p: NavProject, f: ProjectFile) => {
    A.openFolderFile(p.path, f.rel);
  };

  /** Opens or shuts a row that has rows under it. */
  const toggle = (r: Row) => {
    if (r.t === 'section') return hits ? undefined : setSection(r.section, !r.open);
    if (!expandable(r)) return;
    const o = (r as { open: boolean }).open;
    if (r.t === 'part' && r.part === 'files' && !o && r.project.pcFolder) readPc(r.project.path, true);
    setRow(r.id, !o, r.t === 'group' && r.id.startsWith('m:') && sections.daily.months[0]?.key === r.id.slice(2));
  };

  /** What a row does when clicked or Enter is pressed on it. */
  const activate = (r: Row, e?: { ctrlKey: boolean; metaKey: boolean }) => {
    switch (r.t) {
      case 'section':
        return toggle(r);
      case 'project':
        A.openPath(r.project.path, { where: where(e) });
        if (!r.open) setRow(r.id, true);
        return;
      case 'doc':
        // As a project does: the doc opens, and what is kept with it (its canvas) shows under it.
        A.openPath(r.doc.path, { where: where(e) });
        if (r.open === false) setRow(r.id, true);
        return;
      case 'part':
        if (r.part === 'overview') return A.openPath(r.project.path, { where: where(e) });
        if (r.part === 'canvas' && r.open === undefined) return void openProjectCanvas(r.project.path);
        return toggle(r);
      case 'folder':
      case 'pcdir':
      case 'group':
        return toggle(r);
      case 'item':
        return A.openPath(r.item.path, { where: where(e) });
      case 'today':
        return r.item ? A.openPath(r.item.path, { where: where(e) }) : void A.openDaily();
      case 'pcfile':
        return showPcFile(r.project, r.file);
      case 'kind':
        return A.openAssets();
      case 'more':
        return r.run();
      case 'hit':
        if (r.pc) return showPcFile(r.pc.project, r.pc.file);
        return A.openPath(r.entry.path, { where: where(e) });
      case 'inside':
        if (e?.ctrlKey || e?.metaKey) return openHitInProgram(r.hit);
        return showFileHit(r.hit, insideHits.filter((h) => h.snippets.length), query);
      default:
        return undefined;
    }
  };

  // ── New things, moving, renaming ────────────────────────────────────────────────────────────────────────────────────
  const newIn = (s: SectionId) => {
    if (s === 'projects') return newProject();
    if (s === 'docs') return void newDoc();
    if (s === 'notes') return void newNoteOfType();
    if (s === 'daily') return void A.openDaily();
    if (s === 'canvases') return void A.newCanvas();
    if (s === 'views') return void newView();
    if (s === 'templates') return void newTemplate();
    if (s === 'assets') return A.openAssets();
  };
  const NEW_WORDS: Partial<Record<SectionId, string>> = { projects: 'New project', docs: 'New doc', notes: 'New note', daily: 'Today’s note', canvases: 'New canvas', views: 'New view', templates: 'New template', assets: 'Open Assets' };

  const moveInto = async (paths: string[], folder: string) => {
    let last: string | null = null;
    for (const p of paths) {
      if (p === folder || folder.startsWith(`${p}/`) || A.folderOf(p) === folder) continue;
      last = await A.movePath(p, folder ? `${folder}/${A.nameOf(p)}` : A.nameOf(p));
      if (!last) break;
    }
    return last;
  };
  /** Files a note (or several) in a project: into its folder, links kept working. */
  const fileInProject = async (paths: string[], p: NavProject) => {
    if (!p.dir) {
      toast(`${p.name} has no folder of its own in your notes, so notes can’t be filed in it.`);
      return;
    }
    const last = await moveInto(paths, p.dir);
    if (last) {
      setRow(`p:${p.path}`, true);
      setRow(`p:${p.path}:notes`, true);
      toast(paths.length === 1 ? `Filed in ${p.name}.` : `${paths.length} filed in ${p.name}.`);
    }
  };
  const askProject = async (paths: string[]) => {
    const choices = sections.projects.filter((p) => p.dir);
    if (!choices.length) return toast('There are no projects with a folder to file it in yet.');
    const id = await pick({
      placeholder: paths.length === 1 ? `File “${A.titleOf(paths[0])}” in which project?` : `File ${paths.length} in which project?`,
      items: (q) => fuzzyFilter(choices, q, (p) => p.name).map((p) => ({ id: p.path, label: p.name, detail: p.done ? 'Finished' : p.status })),
      footer: <span>↑↓ to move · Enter to file it there · Esc to cancel</span>,
    });
    const p = id ? projectByPath.get(id) : undefined;
    if (p) await fileInProject(paths, p);
  };

  const commitRename = async (r: Row, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (r.t === 'project') {
      if (!name || name === r.project.name) return;
      const moved = await editProject(r.project.path, { kind: 'set', field: 'name', value: name });
      if (moved) setTimeout(() => reveal(moved), 50);
      return;
    }
    const path = vaultPath(r);
    if (!path || !name) return;
    const isFolder = getState().folders.includes(path);
    if (name === (isFolder ? A.nameOf(path) : r.t === 'item' && r.item.kind !== 'note' && r.item.kind !== 'canvas' && r.item.kind !== 'view' ? A.nameOf(path) : A.titleOf(path))) return;
    const moved = await A.renamePath(path, name);
    if (moved) setTimeout(() => reveal(moved), 50);
  };
  const canRename = (r: Row) => canEdit && (r.t === 'project' || !!vaultPath(r));

  // ── Drag and drop ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** Where a row takes dropped notes: a project (its folder), a folder, the top of Notes, the templates folder. */
  const dropFor = (r: Row): { folder?: string; project?: NavProject } | null => {
    if (r.t === 'project' || (r.t === 'part' && (r.part === 'notes' || r.part === 'overview'))) return r.project.dir || r.project.pcFolder ? { project: r.project } : null;
    if (r.t === 'folder') return { folder: r.path };
    if (r.t === 'section' && r.section === 'notes') return { folder: '' };
    if (r.t === 'section' && r.section === 'templates') return { folder: prefs.templatesFolder };
    return null;
  };
  const onDrop = async (e: DragEvent, r: Row) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const target = dropFor(r);
    if (!canEdit || !target) return;
    const internal = e.dataTransfer.getData(PATHS_MIME);
    if (internal) {
      const paths = internal.split('\n').filter(Boolean);
      if (target.project) await fileInProject(paths, target.project);
      else if ((await moveInto(paths, target.folder ?? '')) && target.folder) setRow(`d:${target.folder}`, true);
      return;
    }
    const outside = [...e.dataTransfer.files].map((f) => window.nv.files.pathOf(f)).filter(Boolean);
    if (!outside.length) return;
    try {
      if (target.project?.pcFolder) {
        // A project's files are kept in its folder on the PC: they're copied there, never into the notes.
        const added = await window.nv.projects.addFiles(target.project.path, outside);
        readPc(target.project.path, true);
        setRow(`p:${target.project.path}`, true);
        setRow(`p:${target.project.path}:files`, true);
        toast(`${added.length === 1 ? `“${added[0]}” is` : `${added.length} files are`} in ${target.project.name}’s folder now.`);
        return;
      }
      const folder = target.project ? target.project.dir! : (target.folder ?? '');
      const added = await window.nv.files.importPaths(outside, folder);
      await Promise.all([loadFiles(), loadNotes()]);
      if (added[0]) reveal(added[0]);
    } catch (err) {
      showError(err);
    }
  };
  /** The row dragged, while it's dragged within its own list (to put it in order). */
  const dragging = useRef<{ group: string; key: string } | null>(null);
  const ordering = (r: Row) => {
    const mine = hits ? undefined : orderInfo.current.rows.get(r.id);
    return mine && dragging.current && dragging.current.group === mine.group ? mine : undefined;
  };
  const reorder = (group: string, moving: string, target: string, after: boolean) => {
    setDropAt(null);
    const next = moveKey(orderInfo.current.groups.get(group) ?? [], moving, target, after);
    rememberExplorer((m) => ({ order: { ...m.order, [group]: next } }));
  };
  /** A row starts being dragged into an order (sections, projects and docs are dragged only for that). */
  const beginOrder = (e: DragEvent, r: Row, text?: string) => {
    dragging.current = hits ? null : (orderInfo.current.rows.get(r.id) ?? null);
    if (text !== undefined) {
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.effectAllowed = 'move';
    }
  };
  const endDrag = () => {
    dragging.current = null;
    setDropAt(null);
    setDropTarget(null);
  };
  const dragProps = (r: Row) =>
    dropFor(r) || (!hits && orderInfo.current.rows.has(r.id))
      ? {
          onDragOver: (e: DragEvent) => {
            const mine = ordering(r);
            if (mine) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setDropTarget(null);
              if (mine.key === dragging.current?.key) return setDropAt(null);
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const after = e.clientY > box.top + box.height / 2;
              setDropAt((d) => (d?.id === r.id && d.after === after ? d : { id: r.id, after }));
              return;
            }
            if (!dropFor(r)) return;
            if (!e.dataTransfer.types.includes(PATHS_MIME) && !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes(PATHS_MIME) ? 'move' : 'copy';
            setDropAt(null);
            setDropTarget(r.id);
          },
          onDragLeave: (e: DragEvent) => {
            if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
            setDropTarget((t) => (t === r.id ? null : t));
            setDropAt((d) => (d?.id === r.id ? null : d));
          },
          onDrop: (e: DragEvent) => {
            const mine = ordering(r);
            if (mine) {
              e.preventDefault();
              e.stopPropagation();
              const moving = dragging.current!.key;
              const after = dropAt?.id === r.id ? dropAt.after : false;
              dragging.current = null;
              reorder(mine.group, moving, mine.key, after);
              return;
            }
            void onDrop(e, r);
          },
        }
      : {};
  const startDrag = (e: DragEvent, r: Row) => {
    const path = vaultPath(r);
    if (!path) return;
    beginOrder(e, r);
    const paths = selected.has(r.id) ? [...selected].map((id) => rowById.get(id)).map((x) => (x ? vaultPath(x) : null)).filter((x): x is string => !!x) : [path];
    if (!selected.has(r.id)) setSelected(new Set([r.id]));
    e.dataTransfer.setData(PATHS_MIME, paths.join('\n'));
    e.dataTransfer.setData('text/plain', paths.map((p) => writeLink(p, undefined, { embed: shownInPlace(p) })).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  // ── Closing with open tasks (p12-close-and-noise A): the shared dialog, through the panel's own edits ──────────
  /** Move to Done: nothing open marks done as before, else the dialog asks what each task becomes. */
  const askClose = (p: NavProject) => {
    void (async () => {
      try {
        const [v, cards] = await Promise.all([window.nv.projects.view(p.path), window.nv.projects.list()]);
        const tasks = openProjectTasks(v.project);
        if (!tasks.length) {
          await editProject(p.path, { kind: 'set', field: 'status', value: 'done' });
          return;
        }
        setCloseAsk({ path: v.path, name: v.project.name, tasks, targets: cards.filter((c) => c.path !== v.path).map((c) => ({ path: c.path, name: c.name })) });
      } catch (err) {
        showError(err);
      }
    })();
  };
  /** The dialog's tasks again from the file: empty marks done and shuts, else the dialog shows what is left. */
  const closeRefresh = async (path: string) => {
    try {
      const v = await window.nv.projects.view(path);
      const tasks = openProjectTasks(v.project);
      if (!tasks.length) {
        setCloseAsk(null);
        await editProject(path, { kind: 'set', field: 'status', value: 'done' });
        return;
      }
      setCloseAsk((s) => (s && s.path === path ? { ...s, name: v.project.name, tasks } : s));
    } catch (err) {
      showError(err);
      setCloseAsk(null);
    }
  };
  const undoAll = async (path: string, n: number) => {
    for (let i = 0; i < n; i++) await window.nv.projects.undo(path);
    await Promise.all([loadNotes(), loadFiles()]);
  };
  const closeDone = (index: number) => {
    const ask = closeAsk;
    if (!ask) return;
    setCloseBusy(true);
    void (async () => {
      try {
        const r = await window.nv.projects.edit(ask.path, { kind: 'change', list: 'next', index, item: { done: true } });
        await followMoves(r);
        toast(r.words, { label: 'Undo', run: () => void undoAll(r.view.path, 1).then(() => closeRefresh(r.view.path)).catch(showError) });
        await closeRefresh(ask.path);
      } catch (err) {
        showError(err);
      } finally {
        setCloseBusy(false);
      }
    })();
  };
  const closeDrop = (index: number) => {
    const ask = closeAsk;
    const t = ask?.tasks.find((x) => x.index === index);
    if (!ask || !t) return;
    setCloseBusy(true);
    void (async () => {
      try {
        await window.nv.projects.edit(ask.path, { kind: 'remove', list: 'next', index });
        const r = await window.nv.projects.edit(ask.path, { kind: 'add', list: 'decisions', item: dropDecisionItem(t.what, formatDate('D MMM YYYY')) });
        await followMoves(r);
        toast(`Dropped “${t.what}”. Kept under Decisions.`, { label: 'Undo', run: () => void undoAll(r.view.path, 2).then(() => closeRefresh(r.view.path)).catch(showError) });
        await closeRefresh(ask.path);
      } catch (err) {
        showError(err);
      } finally {
        setCloseBusy(false);
      }
    })();
  };
  const closeMove = (index: number, target: string) => {
    const ask = closeAsk;
    const t = ask?.tasks.find((x) => x.index === index);
    if (!ask || !t) return;
    const targetName = ask.targets.find((x) => x.path === target)?.name ?? 'the other project';
    setCloseBusy(true);
    void (async () => {
      try {
        await window.nv.projects.edit(target, { kind: 'add', list: 'next', item: { what: t.what, ...(t.who ? { who: t.who } : {}), ...(t.when ? { when: t.when } : {}) } });
        const r = await window.nv.projects.edit(ask.path, { kind: 'remove', list: 'next', index });
        await followMoves(r);
        toast(`Moved “${t.what}” to ${targetName}.`, {
          label: 'Undo',
          run: () =>
            void (async () => {
              try {
                await window.nv.projects.undo(target);
                await window.nv.projects.undo(r.view.path);
                await Promise.all([loadNotes(), loadFiles()]);
                toast(`Moved “${t.what}” back.`);
              } catch (err) {
                showError(err);
              }
            })(),
        });
        await closeRefresh(ask.path);
      } catch (err) {
        showError(err);
      } finally {
        setCloseBusy(false);
      }
    })();
  };
  const closeAllDone = () => {
    const ask = closeAsk;
    if (!ask || !ask.tasks.length) return;
    setCloseBusy(true);
    void (async () => {
      try {
        for (const t of ask.tasks) await window.nv.projects.edit(ask.path, { kind: 'change', list: 'next', index: t.index, item: { done: true } });
        setCloseAsk(null);
        await editProject(ask.path, { kind: 'set', field: 'status', value: 'done' });
      } catch (err) {
        showError(err);
        await closeRefresh(ask.path);
      } finally {
        setCloseBusy(false);
      }
    })();
  };

  // ── Right-click menus ───────────────────────────────────────────────────────────────────────────────────────────────
  const projectMenu = (p: NavProject): MenuItem[] => [
    { label: 'Open the page', icon: 'book', run: () => A.openPath(p.path) },
    { label: 'Open the canvas', icon: 'canvas', run: () => void openProjectCanvas(p.path) },
    { label: 'Open in a new tab', icon: 'newTab', run: () => A.openPath(p.path, { where: 'tab' }) },
    { separator: true },
    { label: 'New note in the project', icon: 'filePlus', disabled: !canEdit || !p.dir, run: () => void newNoteOfType(undefined, { folder: p.dir! }) },
    // Wired like the folder menu (3 Nov 2026, audit f F16: an empty submenu opened an empty box).
    { label: 'New note from a template…', icon: 'template', disabled: !canEdit, run: () => void newNoteFromTemplate({ project: p.path }) },
    { label: p.pcFolder ? 'Open its folder' : 'No folder on this PC yet', icon: 'reveal', disabled: !p.pcFolder, run: () => void window.nv.projects.openFolder(p.path).catch(showError) },
    { separator: true },
    { label: 'Rename', icon: 'edit', disabled: !canEdit, hint: 'F2', run: () => setRenaming(`p:${p.path}`) },
    p.done
      ? { label: 'Make it active again', icon: 'undo', disabled: !canEdit, run: () => void editProject(p.path, { kind: 'set', field: 'status', value: 'active' }) }
      : { label: 'Move to Done', icon: 'check', disabled: !canEdit, run: () => askClose(p) },
    ...(p.done ? [] : [{ label: 'Archive', icon: 'folder', disabled: !canEdit, run: () => void editProject(p.path, { kind: 'set', field: 'status', value: 'archived' }) } as MenuItem]),
    { label: 'Turn into a doc…', icon: 'doc', disabled: !canEdit, run: () => void turnIntoDoc(p.path) },
    { separator: true },
    { label: 'Show in File Explorer', icon: 'reveal', run: () => void A.revealInSystem(p.dir ?? p.path) },
    { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(p.path) },
    { separator: true },
    { label: 'Delete the project…', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(p.dir ?? p.path) },
  ];
  const docMenu = (d: NavDoc, id: string): MenuItem[] => [
    { label: 'Open', icon: 'doc', run: () => A.openPath(d.path) },
    { label: 'Open in a new tab', icon: 'newTab', run: () => A.openPath(d.path, { where: 'tab' }) },
    { separator: true },
    { label: d.canvas ? 'Open the canvas' : 'Show as canvas', icon: 'canvas', run: () => void showDocCanvas(d.path) },
    ...(d.canvas ? [{ label: 'Update canvas from doc', icon: 'refresh', disabled: !canEdit, run: () => void updateDocCanvas(d.path) } as MenuItem] : []),
    { separator: true },
    { label: 'Rename', icon: 'edit', disabled: !canEdit, hint: 'F2', run: () => setRenaming(id) },
    { label: 'Turn into a project…', icon: 'layers', disabled: !canEdit, run: () => void turnIntoProject(d.path) },
    { separator: true },
    { label: 'Show in File Explorer', icon: 'reveal', run: () => void A.revealInSystem(d.path) },
    { label: 'Copy its path', icon: 'copy', run: () => void A.copyPath(d.path) },
    { separator: true },
    { label: 'Delete the doc…', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(d.path) },
  ];
  // Retired 3 Nov 2026 (audit f F16): the project menu's template row opens the picker directly now,
  // like the folder menu, instead of an async submenu that opened empty.
  const withTemplates = async (items: MenuItem[], _p: NavProject): Promise<MenuItem[]> => items;
  const sectionMenu = (s: SectionId): MenuItem[] => {
    const items: MenuItem[] = [];
    if (s === 'projects') items.push({ label: 'New project', icon: 'plus', disabled: !canEdit, run: () => newProject() }, { label: 'Open Projects', icon: 'layers', run: () => A.openProjects() });
    if (s === 'docs') items.push({ label: 'New doc', icon: 'doc', disabled: !canEdit, run: () => void newDoc() }, { label: 'Doc templates', icon: 'template', run: () => void import('../state/templates').then((m) => m.openTemplates()) });
    if (s === 'notes') items.push({ label: 'New note', icon: 'filePlus', disabled: !canEdit, run: () => void newNoteOfType() }, { label: 'New note from a template…', icon: 'template', disabled: !canEdit, run: () => void newNoteFromTemplate({ folder: '' }) }, { label: 'New folder', icon: 'folderPlus', disabled: !canEdit, run: () => void A.newFolder('').then((made) => made && (setRenaming(`d:${made}`), reveal(made))) });
    if (s === 'daily') items.push({ label: 'Today’s note', icon: 'calendar', run: () => void A.openDaily() });
    if (s === 'canvases') items.push({ label: 'New canvas', icon: 'canvas', disabled: !canEdit, run: () => void A.newCanvas() });
    if (s === 'views') items.push({ label: 'New view', icon: 'views', disabled: !canEdit, run: () => void newView() }, { label: 'New board', icon: 'board', disabled: !canEdit, run: () => void newView({ layout: 'board' }) }, { label: 'New calendar', icon: 'calendar', disabled: !canEdit, run: () => void newView({ layout: 'calendar' }) }, { separator: true }, { label: 'Import CSV…', icon: 'table', disabled: !canEdit, run: () => void import('../state/importCsv').then((m) => m.importCsv()) });
    if (s === 'templates') items.push({ label: 'New template', icon: 'template', disabled: !canEdit, run: () => void newTemplate() }, { label: 'Open Templates', icon: 'layers', run: () => void import('../state/templates').then((m) => m.openTemplates()) });
    if (s === 'assets') items.push({ label: 'Open Assets', icon: 'assets', run: () => A.openAssets() });
    if (s === 'attachments') items.push({ label: 'Hide attachments', icon: 'eye', run: () => rememberExplorer({ showAttachments: false }) });
    items.push({ separator: true }, { label: 'Shut every section', icon: 'collapse', run: () => rememberExplorer({ sections: Object.fromEntries(SECTION_ORDER.map((x) => [x, false])) }) }, { label: 'Open every section', icon: 'expand', run: () => rememberExplorer({ sections: Object.fromEntries(SECTION_ORDER.map((x) => [x, true])) }) });
    return items;
  };
  const pcMenu = (p: NavProject, f: ProjectFile): MenuItem[] => [
    { label: 'Open', icon: 'eye', run: () => showPcFile(p, f) },
    { label: 'Open in its program', icon: 'external', run: () => void window.nv.projects.openFile(p.path, f.rel).catch(showError) },
    { label: 'Show in folder', icon: 'reveal', run: () => void window.nv.projects.showFile(p.path, f.rel).catch(showError) },
    { label: 'Open the project page', icon: 'book', run: () => A.openPath(p.path) },
    { separator: true },
    { label: 'Copy its path', icon: 'copy', run: () => void navigator.clipboard.writeText(f.rel).then(() => toast('Copied.')) },
  ];
  const menuFor = async (r: Row, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(r.id)) {
      setSelected(new Set([r.id]));
      setFocus(r.id);
    }
    const at = { clientX: e.clientX, clientY: e.clientY };
    const many = selected.size > 1 && selected.has(r.id);
    if (many) {
      const paths = [...selected].map((id) => rowById.get(id)).map((x) => (x ? vaultPath(x) : null)).filter((x): x is string => !!x);
      return openMenu(at, [
        { heading: `${paths.length} selected` },
        { label: 'File in a project…', icon: 'layers', disabled: !canEdit, run: () => void askProject(paths) },
        { label: 'Move to…', icon: 'folder', disabled: !canEdit, run: async () => { const { pickFolder } = await import('../components/Pickers'); const f = await pickFolder(getState().folders); if (f !== null) await moveInto(paths, f); } },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: async () => { for (const p of paths) if (!(await A.trashPath(p))) break; setSelected(new Set()); } },
      ]);
    }
    const p = r.t === 'project' || r.t === 'part' ? r.project : r.t === 'hit' && r.entry.kind === 'project' ? projectByPath.get(r.entry.path) : undefined;
    if (p && (r.t !== 'part' || r.part === 'overview')) return openMenu(at, await withTemplates(projectMenu(p), p));
    if (r.t === 'part' && r.part === 'canvas') return openMenu(at, [{ label: 'Open the canvas', icon: 'canvas', run: () => void openProjectCanvas(r.project.path) }]);
    if (r.t === 'part' && r.part === 'files') return openMenu(at, [{ label: 'Open its folder', icon: 'reveal', disabled: !r.project.pcFolder, run: () => void window.nv.projects.openFolder(r.project.path).catch(showError) }, { label: 'Read it again', icon: 'refresh', disabled: !r.project.pcFolder, run: () => readPc(r.project.path, true) }]);
    if (r.t === 'part' && p) return openMenu(at, await withTemplates(projectMenu(p), p));
    if (r.t === 'section') return openMenu(at, sectionMenu(r.section));
    if (r.t === 'doc') return openMenu(at, docMenu(r.doc, r.id));
    if (r.t === 'pcfile') return openMenu(at, pcMenu(r.project, r.file));
    if (r.t === 'hit' && r.pc) return openMenu(at, pcMenu(r.pc.project, r.pc.file));
    if (r.t === 'inside')
      return openMenu(at, [
        { label: 'Show it here', icon: 'eye', run: () => showFileHit(r.hit, insideHits.filter((h) => h.snippets.length), query) },
        { label: 'Open in its program', icon: 'external', run: () => openHitInProgram(r.hit) },
        { label: 'Show in folder', icon: 'reveal', run: () => showHitInFolder(r.hit) },
      ]);
    if (r.t === 'pcdir') return openMenu(at, [{ label: 'Show in folder', icon: 'reveal', run: () => void window.nv.projects.showFile(r.project.path, r.rel).catch(showError) }]);
    const path = vaultPath(r);
    if (!path) return;
    if (r.t === 'folder') {
      return openMenu(at, fileMenu(path, { isFolder: true, onRename: () => setRenaming(r.id), onNewNote: () => (setRow(r.id, true), void newNoteOfType(undefined, { folder: path })), onNewFolder: () => void A.newFolder(path).then((made) => made && (setRow(r.id, true), setRenaming(`d:${made}`))), onNewCanvas: () => void A.newCanvas(path) }));
    }
    const inProject = sections.place.get(path)?.project;
    const extra: MenuItem[] = [];
    if (/\.md$/i.test(path) && canEdit) extra.push({ label: inProject ? 'File in another project…' : 'File in a project…', icon: 'layers', run: () => void askProject([path]) });
    if (inProject && projectByPath.get(inProject)) extra.push({ label: `Open ${projectByPath.get(inProject)!.name}`, icon: 'book', run: () => A.openPath(inProject) });
    const base = fileMenu(path, { onRename: () => setRenaming(r.id) });
    const cut = base.findIndex((x) => 'separator' in x);
    openMenu(at, extra.length ? [...base.slice(0, cut + 1), ...extra, { separator: true }, ...base.slice(cut + 1)] : base);
  };

  // ── Keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const go = (i: number) => {
    const r = navigable[Math.max(0, Math.min(navigable.length - 1, i))];
    if (!r) return;
    setFocus(r.id);
    setSelected(new Set([r.id]));
    body.current?.querySelector(`[data-id="${CSS.escape(r.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).tagName === 'INPUT') return;
    const at = focus ? navigable.findIndex((r) => r.id === focus) : -1;
    const r = at >= 0 ? navigable[at] : undefined;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      go(at < 0 ? 0 : at + (k === 'ArrowDown' ? 1 : -1));
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      go(k === 'Home' ? 0 : navigable.length - 1);
    } else if (k === 'ArrowRight' && r) {
      e.preventDefault();
      if (expandable(r) && !(r as { open: boolean }).open) toggle(r);
      else if (expandable(r)) go(at + 1);
    } else if (k === 'ArrowLeft' && r) {
      e.preventDefault();
      if (expandable(r) && (r as { open: boolean }).open) toggle(r);
      else {
        const parent = 'parent' in r && r.parent ? r.parent : r.t !== 'section' && !hits ? [...navigable.slice(0, at)].reverse().find((x) => x.t === 'section')?.id : undefined;
        if (parent) {
          const i = navigable.findIndex((x) => x.id === parent);
          if (i >= 0) go(i);
        }
      }
    } else if (k === 'Enter' && r) {
      e.preventDefault();
      activate(r, e);
    } else if (k === 'F2' && r && canRename(r)) {
      e.preventDefault();
      e.stopPropagation();
      setRenaming(r.id);
    } else if (k === 'Delete' && selected.size && canEdit) {
      const paths = [...selected].map((id) => rowById.get(id)).map((x) => (x ? vaultPath(x) : null)).filter((x): x is string => !!x);
      if (!paths.length) return;
      e.preventDefault();
      void (async () => {
        for (const p of paths) if (!(await A.trashPath(p))) break;
        setSelected(new Set());
      })();
    } else if (k === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(k)) {
      // Typing in the list starts finding.
      filterBox.current?.focus();
    }
  };

  // Keep the focused row in the list after it changes (a row gone: nothing focused).
  useLayoutEffect(() => {
    if (focus && !rowById.has(focus)) setFocus(null);
  }, [rowById]);

  // ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const nameOrInput = (r: Row, label: ReactNode, raw: string) =>
    renaming === r.id ? (
      <input
        className="tree-rename nav-rename"
        autoFocus
        defaultValue={raw}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => void commitRename(r, e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setRenaming(null);
        }}
      />
    ) : (
      <span className="nav-name">{label}</span>
    );
  const chevron = (o: boolean) => (
    <span className="nav-lead">
      <Icon name="chevron" size={11} className={`nav-chevron${o ? ' open' : ''}`} />
    </span>
  );
  const lead = (icon?: IconName, cls = '') => <span className={`nav-lead${cls}`}>{icon && <Icon name={icon} size={14} />}</span>;
  const guides = (depth: number) => Array.from({ length: depth }, (_, i) => <span key={i} className="nav-guide" style={{ left: 8 + i * INDENT + 6 }} />);
  const count = (n?: number) => (n === undefined ? null : <span className="nav-count">{n}</span>);

  const draw = (r: Row): ReactNode => {
    const common = {
      'data-id': r.id,
      onClick: (e: React.MouseEvent) => {
        if (renaming === r.id) return;
        // Shift+click chooses a run of rows; Ctrl+click adds one (and opens it in a new tab, as in the folder list).
        if (select(r.id, e) && !(e.ctrlKey || e.metaKey)) return;
        activate(r, e);
      },
      onContextMenu: (e: React.MouseEvent) => void menuFor(r, e),
      onDragEnd: endDrag,
      ...dragProps(r),
    };
    const cls = (extra: string) => `nav-row ${extra}${selected.has(r.id) ? ' selected' : ''}${focus === r.id ? ' focused' : ''}${dropTarget === r.id ? ' is-drop' : ''}${dropAt?.id === r.id ? (dropAt.after ? ' is-drop-after' : ' is-drop-before') : ''}`;
    const pad = { paddingLeft: 8 + r.depth * INDENT };
    switch (r.t) {
      case 'section':
        return (
          <div {...common} className={cls(`nav-section${r.open ? ' open' : ''}${hits ? ' is-finding' : ''}`)} role="button" aria-expanded={hits ? undefined : r.open} title={hits ? undefined : `${r.open ? `Shut ${SECTION_WORDS[r.section]}` : `Open ${SECTION_WORDS[r.section]}`} · drag to move it`} draggable={!hits} onDragStart={(e) => beginOrder(e, r, SECTION_WORDS[r.section])}>
            {!hits && <Icon name="chevron" size={10} className={`nav-chevron${r.open ? ' open' : ''}`} />}
            <span className="nav-section-label">{SECTION_WORDS[r.section]}</span>
            <span className="nav-section-count">{r.count}</span>
            <span className="nav-section-space" />
            {!hits && NEW_WORDS[r.section] && (r.section === 'assets' || r.section === 'daily' || canEdit) && (
              <button
                className="nav-section-add"
                title={NEW_WORDS[r.section]}
                aria-label={NEW_WORDS[r.section]}
                onClick={(e) => {
                  e.stopPropagation();
                  newIn(r.section);
                }}
              >
                <Icon name={r.section === 'assets' ? 'forward' : r.section === 'daily' ? 'calendar' : 'plus'} size={13} />
              </button>
            )}
          </div>
        );
      case 'project': {
        const tone = healthTone(r.project.health);
        const here = active === r.project.path || (!!active && sections.place.get(active)?.project === r.project.path);
        return (
          <div {...common} className={cls(`nav-project${r.project.done ? ' is-done' : ''}${active === r.project.path ? ' active' : here ? ' holds-active' : ''}`)} style={pad} draggable={!hits && renaming !== r.id} onDragStart={(e) => beginOrder(e, r, writeLink(r.project.path, undefined))} title={[r.project.name, r.project.health, r.project.status, r.project.progress !== undefined ? `${r.project.progress}% done` : ''].filter(Boolean).join(' · ')}>
            {guides(r.depth)}
            <span
              className="nav-lead nav-lead-hit"
              onClick={(e) => {
                e.stopPropagation();
                toggle(r);
              }}
            >
              <Icon name="chevron" size={11} className={`nav-chevron${r.open ? ' open' : ''}`} />
            </span>
            <span className={`nav-dot tone-${tone}`} aria-hidden />
            {nameOrInput(r, r.project.name, r.project.name)}
            {canEdit && renaming !== r.id && (
              <button
                className="nav-row-add"
                title={`New in ${r.project.name}`}
                aria-label={`New in ${r.project.name}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  const anchor = e.currentTarget;
                  const t = await templateMenuItems({ project: r.project.path }).catch(() => [] as MenuItem[]);
                  openMenu(anchor, [
                    { heading: `New in ${r.project.name}` },
                    { label: 'Blank note', icon: 'filePlus', disabled: !r.project.dir, run: () => void newNoteOfType('note', { folder: r.project.dir! }) },
                    ...t,
                    { separator: true },
                    { label: 'Open the canvas', icon: 'canvas', run: () => void openProjectCanvas(r.project.path) },
                  ]);
                }}
              >
                <Icon name="plus" size={13} />
              </button>
            )}
          </div>
        );
      }
      case 'doc': {
        const d = r.doc;
        const here = active === d.path || (!!active && sections.place.get(active)?.doc === d.path);
        return (
          <div {...common} className={cls(`nav-doc${active === d.path ? ' active' : here ? ' holds-active' : ''}`)} style={pad} title={d.about ? `${d.name} · ${d.about}` : d.name} draggable={!hits && renaming !== r.id} onDragStart={(e) => beginOrder(e, r, writeLink(d.path, undefined))} onAuxClick={(e) => e.button === 1 && A.openPath(d.path, { where: 'tab' })}>
            {r.open === undefined ? (
              <span className="nav-lead" />
            ) : (
              <span
                className="nav-lead nav-lead-hit"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r);
                }}
              >
                <Icon name="chevron" size={11} className={`nav-chevron${r.open ? ' open' : ''}`} />
              </span>
            )}
            <Icon name="doc" size={14} className="nav-doc-icon" />
            {nameOrInput(r, d.name, d.name)}
          </div>
        );
      }
      case 'part':
        return (
          <div {...common} className={cls(`nav-part${r.part === 'overview' && active === r.project.path ? ' active' : ''}${r.hint ? ' is-quiet' : ''}`)} style={pad} role={r.open === undefined ? undefined : 'button'} aria-expanded={r.open}>
            {guides(r.depth)}
            {r.open === undefined ? lead() : chevron(r.open)}
            <Icon name={r.icon} size={14} className="nav-part-icon" />
            <span className="nav-name">{r.label}</span>
            {r.hint && <span className="nav-hint">{r.hint}</span>}
            {count(r.count)}
          </div>
        );
      case 'folder':
        return (
          <div {...common} className={cls('nav-folder tree-folder')} data-path={r.path} style={pad} draggable={renaming !== r.id && canEdit} onDragStart={(e) => startDrag(e, r)} title={r.name}>
            {guides(r.depth)}
            {chevron(r.open)}
            {nameOrInput(r, r.name, r.name)}
            {count(r.count || undefined)}
            <button
              type="button"
              className="nav-row-more"
              aria-label={`More for ${r.path}`}
              title="More"
              onClick={(e) => {
                e.stopPropagation();
                void menuFor(r, e);
              }}
            >
              <Icon name="more" size={14} />
            </button>
          </div>
        );
      case 'item': {
        const it = r.item;
        const icon: IconName | undefined = it.kind === 'note' ? undefined : it.kind === 'canvas' ? 'canvas' : fileIcon(it.path);
        const raw = it.kind === 'note' || it.kind === 'canvas' ? A.titleOf(it.path) : it.name;
        // A hint's dot from the one status reading (9.2 uplift F30): whole words, so "Undone" is not done
        // and "Homework" is not running. Waiting and on-track hints show their words, as before.
        const tone = r.hint ? ((s) => (s === 'done' ? 'ok' : s === 'off-track' ? 'bad' : s === 'at-risk' ? 'warn' : ''))(statusReading(r.hint).state) : '';
        return (
          <div
            {...common}
            className={cls(`nav-item tree-file${it.path === active ? ' active' : ''}`)}
            data-path={it.path}
            style={pad}
            title={raw}
            draggable={renaming !== r.id && canEdit}
            onDragStart={(e) => startDrag(e, r)}
            onAuxClick={(e) => e.button === 1 && A.openPath(it.path, { where: 'tab' })}
            onMouseOver={(e) => {
              if ((e.ctrlKey || e.metaKey) && (it.kind === 'note' || it.kind === 'image')) hoverLink(it.kind === 'note' ? it.path.replace(/\.md$/i, '') : it.path, e.currentTarget as HTMLElement, undefined, 150, true);
            }}
          >
            {guides(r.depth)}
            {lead(icon)}
            {nameOrInput(r, r.label ?? it.name, raw)}
            {tone && <span className={`nav-status tone-${tone}`} title={r.hint} />}
            {!tone && r.hint && <span className="nav-hint">{r.hint}</span>}
            {it.ext && it.kind !== 'canvas' && <span className="tree-ext">{it.ext}</span>}
          </div>
        );
      }
      case 'group':
        return (
          <div {...common} className={cls('nav-group')} style={pad} role="button" aria-expanded={r.open}>
            {guides(r.depth)}
            {chevron(r.open)}
            <span className="nav-name">{r.label}</span>
            {count(r.count)}
          </div>
        );
      case 'today':
        return (
          <div {...common} className={cls(`nav-today${r.item && r.item.path === active ? ' active' : ''}${r.item ? '' : ' is-quiet'}`)} style={pad} title={r.item ? r.item.path : 'Start today’s note'}>
            {lead('calendar', ' nav-lead-accent')}
            <span className="nav-name">Today</span>
            <span className="nav-hint">{r.item ? dayWords(todayName) ?? todayName : 'Start'}</span>
          </div>
        );
      case 'pcdir':
        return (
          <div {...common} className={cls('nav-folder nav-pc')} style={pad} title={r.rel}>
            {guides(r.depth)}
            {chevron(r.open)}
            <span className="nav-name">{r.name}</span>
            {count(r.count)}
          </div>
        );
      case 'pcfile':
        return (
          <div
            {...common}
            className={cls('nav-item nav-pc')}
            style={pad}
            title={`${r.file.rel} (in ${r.project.name}’s folder)`}
          >
            {guides(r.depth)}
            {lead(fileIcon(r.file.name))}
            <span className="nav-name">{r.file.name.replace(/\.[^.]+$/, '') || r.file.name}</span>
            {r.file.ext && <span className="tree-ext">{r.file.ext}</span>}
          </div>
        );
      case 'kind':
        return (
          <div {...common} className={cls('nav-kind')} style={pad} title="Open Assets">
            {lead(KIND_ICONS[r.kind] ?? 'file')}
            <span className="nav-name">{r.label}</span>
            {count(r.count)}
          </div>
        );
      case 'note':
        return (
          <div className={`nav-note${r.hint ? ' has-hint' : ''}`} style={{ paddingLeft: 8 + r.depth * INDENT + 22 }}>
            <span className="nav-name">{r.words}</span>
            {r.action && (
              <button className="nav-note-action" onClick={r.action.run}>
                {r.action.label}
              </button>
            )}
            {r.hint && <span className="nav-note-hint">{r.hint}</span>}
          </div>
        );
      case 'more':
        return (
          <div {...common} className={cls('nav-more')} style={{ paddingLeft: 8 + r.depth * INDENT + 22 }}>
            {r.words}
          </div>
        );
      case 'hit': {
        const e = r.entry;
        const p = e.kind === 'project' ? projectByPath.get(e.path) : undefined;
        const icon: IconName | undefined = p ? undefined : r.pc ? fileIcon(r.pc.file.name) : e.kind === 'doc' ? 'doc' : e.kind === 'note' ? 'notes' : e.kind === 'canvas' ? 'canvas' : fileIcon(e.path);
        return (
          <div {...common} className={cls(`nav-item nav-hit-row${e.path === active ? ' active' : ''}`)} style={pad} title={e.where ? `${e.name} · ${e.where}` : e.name} draggable={!!vaultPath(r) && canEdit} onDragStart={(ev) => startDrag(ev, r)}>
            {p ? <span className="nav-lead"><span className={`nav-dot tone-${healthTone(p.health)}`} /></span> : lead(icon)}
            <span className="nav-name">{marked(e.name, query)}</span>
            {e.where && <span className="nav-where">{e.where}</span>}
          </div>
        );
      }
      case 'heading':
        return (
          <div className="nav-row nav-section is-finding nav-inside-heading" data-id={r.id}>
            <span className="nav-section-label">{r.label}</span>
            <span className="nav-section-count">{r.count}</span>
            <span className="nav-section-space" />
          </div>
        );
      case 'inside': {
        const h = r.hit;
        const s = h.snippets[0] ? { ...h.snippets[0], ...plainSnippet(h.snippets[0].text, h.snippets[0].ranges) } : undefined;
        return (
          <div {...common} className={cls('nav-item nav-inside-row')} style={pad} title={`${h.name} · ${h.projectName} · ${h.rel}`}>
            {lead(fileIcon(h.name))}
            <span className="nav-inside-words">
              <span className="nav-inside-top">
                <span className="nav-name">{h.name}</span>
                <span className="nav-where">{h.projectName}</span>
              </span>
              {s && (
                <span className="nav-inside-snippet">
                  {s.where && <span className="fh-place">{s.where.charAt(0).toUpperCase() + s.where.slice(1)}</span>}
                  <Marked text={s.text} ranges={s.ranges} />
                </span>
              )}
            </span>
          </div>
        );
      }
    }
  };

  return (
    <div className="panel explorer nav">
      <div className="panel-toolbar nav-toolbar">
        {modeSwitch}
        <span className="panel-toolbar-space" />
        <button className="icon-button" title="New note" disabled={!canEdit} onClick={() => void newNoteOfType()}>
          <Icon name="filePlus" size={16} />
        </button>
        <button
          className="icon-button"
          title="Sort and show"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { heading: 'Notes in order of' },
              // A sort picked here puts the notes back in that order (folders dragged into an order of their own too).
              ...([['name', 'Name (A to Z)'], ['name-desc', 'Name (Z to A)'], ['modified', 'Changed (newest first)'], ['modified-old', 'Changed (oldest first)']] as const).map(([id, label]) => ({
                label,
                checked: sort === id && !ownNotes,
                run: () => rememberExplorer((m) => ({ sort: id, order: Object.fromEntries(Object.entries(m.order ?? {}).filter(([k]) => !k.startsWith('items:') && !k.startsWith('dirs:'))) })),
              })),
              { label: 'Your own order (drag to arrange)', checked: ownNotes, disabled: !ownNotes, run: () => undefined },
              { separator: true },
              { label: 'Put everything back in the usual order', icon: 'undo', disabled: !Object.keys(memory.order ?? {}).length, run: () => rememberExplorer({ order: {} }) },
              { separator: true },
              { label: 'Show attachments', checked: showAttachments, run: () => rememberExplorer((m) => ({ showAttachments: !showAttachments, sections: showAttachments ? m.sections : { ...m.sections, attachments: true } })) },
              { separator: true },
              { label: 'Shut every section', icon: 'collapse', run: () => rememberExplorer({ sections: Object.fromEntries(SECTION_ORDER.map((x) => [x, false])), open: [] }) },
              { label: 'Open every section', icon: 'expand', run: () => rememberExplorer({ sections: Object.fromEntries(SECTION_ORDER.map((x) => [x, true])) }) },
            ])
          }
        >
          <Icon name="sort" size={16} />
        </button>
        <button className="icon-button" title="Show the open note" disabled={!active} onClick={() => active && reveal(active)}>
          <Icon name="reveal" size={16} />
        </button>
      </div>
      <div className="nav-find">
        <Icon name="search" size={13} className="nav-find-icon" />
        <input
          ref={filterBox}
          value={query}
          placeholder="Find anything"
          aria-label="Find in the file list"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setEverything(new Set());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
              } else filterBox.current?.blur();
            } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault();
              const first = navigable.find((r) => r.t !== 'section');
              if (!first) return;
              if (e.key === 'Enter') return activate(first);
              setFocus(first.id);
              setSelected(new Set([first.id]));
              setKeys(true);
              body.current?.focus();
            }
          }}
        />
        {query && (
          <button className="nav-find-clear" title="Clear (Esc)" aria-label="Clear" onClick={() => (setQuery(''), filterBox.current?.focus())}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      <div
        ref={body}
        className={`panel-body nav-body${keys ? ' by-keys' : ''}`}
        tabIndex={0}
        onMouseDown={() => setKeys(false)}
        onKeyDownCapture={(e) => e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ? setKeys(true) : undefined}
        role="tree"
        aria-label="Your notes, in sections"
        data-own-keys
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(new Set());
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          openMenu(e, sectionMenu('notes'));
        }}
      >
        {hits && !hits.length ? <EmptyState size="panel" icon="search" title="Nothing called that" line={`No note, project or file is called “${query.trim()}”.`} action={{ label: 'Clear', run: () => setQuery('') }} /> : list.map((r) => <Fragment key={r.id}>{draw(r)}</Fragment>)}
      </div>
      {closeAsk &&
        createPortal(
          <CloseDialog name={closeAsk.name} tasks={closeAsk.tasks} targets={closeAsk.targets} mode="closing" busy={closeBusy} onDone={closeDone} onDrop={closeDrop} onMove={closeMove} onAllDone={closeAllDone} onClose={() => setCloseAsk(null)} />,
          document.body,
        )}
    </div>
  );
}
