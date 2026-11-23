// The file list, two ways (a switch at its top, remembered): in sections (panels/Navigator.tsx: projects whole, notes,
// daily, canvases, templates, assets), or as the folders are on disk (below). The folder tree: folders (empty ones too),
// notes, canvases, pictures and other files. Click to open (Ctrl+click in a new tab), drag onto a folder to move (links
// follow), right-click for everything else, F2 to rename in place, Delete to send to Recently deleted, arrows to move
// around. Files dragged in from File Explorer are copied in.

import { shownInPlace, writeLink } from '../lib/links';
import { isProjectProps } from '../../../shared/project-file';
import { hiddenFileCount, isMachineryPath, type MachineryCtx } from '../../../shared/fewer-folders';
import { MODULES, moduleFolder } from '../../../shared/module-records';
import { moduleOn } from '../../../shared/life-modules';
import { getAreas } from '../state/areas';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { hoverLink } from '../components/HoverPreview';
import { fileIcon, Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { healthTone } from '../lib/projectLook';
import { openMenu } from '../components/Menu';
import * as A from '../state/actions';
import { newNoteFromTemplate } from '../state/templates';
import { useWorkspace } from '../state/layout';
import { fileMenu } from '../state/menus';
import { getState, loadFiles, loadNotes, showError, useApp, usePrefs } from '../state/store';
import { activeTab } from '../state/workspace';
import { rememberExplorer, useExplorerMemory } from './explorer-state';
import { Navigator } from './Navigator';
import { newNoteOfType } from '../state/noteTypes';
import { isEnterKey } from '../lib/enterKey';

type Sort = 'name' | 'name-desc' | 'modified' | 'modified-old';

interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  files: { path: string; name: string; ext: string; mtime: number }[];
  mtime: number;
}

const PATHS_MIME = 'application/x-nv-paths';

/** A folder holding a single note of its own name reads as that note (5 Nov 2026, fewer folders). */
function collapseSameName(root: Folder): void {
  const visit = (parent: Folder): void => {
    for (const sub of parent.folders) visit(sub);
    for (let i = parent.folders.length - 1; i >= 0; i--) {
      const f = parent.folders[i];
      if (f.folders.length || f.files.length !== 1 || f.files[0].ext !== '') continue;
      if (f.files[0].name.toLowerCase() !== f.name.toLowerCase()) continue;
      const [file] = f.files;
      parent.folders.splice(i, 1);
      parent.files.push(file);
    }
  };
  visit(root);
}

function build(files: { rel: string; mtime: number; kind: string }[], folders: string[], showAll: boolean, sort: Sort, machinery?: MachineryCtx, showMachinery?: boolean): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [], mtime: 0 };
  const index = new Map<string, Folder>([['', root]]);
  const ensure = (path: string): Folder => {
    const found = index.get(path);
    if (found) return found;
    const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const folder: Folder = { name: path.split('/').pop()!, path, folders: [], files: [], mtime: 0 };
    parent.folders.push(folder);
    index.set(path, folder);
    return folder;
  };
  const hide = !!machinery && showMachinery === false;
  for (const f of folders) {
    if (hide && isMachineryPath(f, machinery!)) continue;
    ensure(f);
  }
  for (const f of files) {
    if (!showAll && f.kind !== 'note' && f.kind !== 'canvas' && f.kind !== 'view') continue;
    if (hide && isMachineryPath(f.rel, machinery!)) continue;
    const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
    const name = f.rel.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    const folder = ensure(dir);
    // A view (Views/<name>.view.json) goes by its name with its own icon, as a canvas does.
    folder.files.push({ path: f.rel, name: f.kind === 'note' ? name.slice(0, dot) : f.kind === 'canvas' ? name.slice(0, dot) : f.kind === 'view' ? name.replace(/\.(?:view\.json|base)$/i, '') : name, ext: f.kind === 'note' ? '' : f.kind === 'canvas' ? 'canvas' : f.kind === 'view' ? 'view' : name.slice(dot + 1).toLowerCase(), mtime: f.mtime });
  }
  collapseSameName(root);
  // A folder counts as changed when anything in it changed.
  const stamp = (f: Folder): number => (f.mtime = Math.max(0, ...f.files.map((x) => x.mtime), ...f.folders.map(stamp)));
  stamp(root);
  const cmp = (a: { name: string; mtime: number }, b: { name: string; mtime: number }) => {
    switch (sort) {
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'modified':
        return b.mtime - a.mtime || a.name.localeCompare(b.name);
      case 'modified-old':
        return a.mtime - b.mtime || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
  };
  const order = (f: Folder) => {
    f.folders.sort(cmp);
    f.files.sort(cmp);
    f.folders.forEach(order);
  };
  order(root);
  return root;
}

/** Sections or folders: the switch at the top of the file list. */
function ModeSwitch({ mode }: { mode: 'sections' | 'folders' }) {
  return (
    <div className="nav-mode" role="radiogroup" aria-label="Show the file list">
      {(['sections', 'folders'] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          className={`nav-mode-option${mode === m ? ' on' : ''}`}
          title={m === 'sections' ? 'Projects, notes, daily notes and the rest, each in its own section' : 'Every folder as it is on disk'}
          onClick={() => rememberExplorer({ mode: m })}
        >
          <Icon name={m === 'sections' ? 'layers' : 'folder'} size={13} />
          <span className="nav-mode-words">{m === 'sections' ? 'Sections' : 'Folders'}</span>
        </button>
      ))}
    </div>
  );
}

export function FileExplorer() {
  const [memory] = useExplorerMemory();
  const mode = memory.mode ?? 'sections';
  return mode === 'folders' ? <FolderTree modeSwitch={<ModeSwitch mode="folders" />} /> : <Navigator modeSwitch={<ModeSwitch mode="sections" />} />;
}

function FolderTree({ modeSwitch }: { modeSwitch: ReactNode }) {
  const files = useApp((s) => s.files);
  const byPath = useApp((s) => s.byPath);
  const folders = useApp((s) => s.folders);
  const canEdit = useApp((s) => s.canEdit);
  const prefs = usePrefs();
  const settings = useApp((s) => s.settings);
  const ws = useWorkspace();
  const active = activeTab(ws).path;
  const [memory, memoryRead] = useExplorerMemory();
  const sort: Sort = memory.sort ?? 'name';
  const setSort = (s: Sort) => rememberExplorer({ sort: s });
  // Fewer folders on show (5 Nov 2026): machinery sits under one quiet Show everything, remembered on this PC.
  // One switch for both panel modes (Nov 2026, b6 break job): the sections mode reads this same key.
  const [showMachinery, setShowMachinery] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nv-folders-show-all') === '1';
    } catch {
      return false;
    }
  });
  const toggleMachinery = () =>
    setShowMachinery((was) => {
      try {
        localStorage.setItem('nv-folders-show-all', was ? '0' : '1');
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
    // getAreas reads outside React; files changing is the signal to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, prefs.templatesFolder, prefs.assetsFolder, prefs.attachmentsFolder, prefs.quietFolders, prefs.modules, settings?.dailyFolder]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(memory.expanded ?? []));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // The drawn window (t163, 9 Nov 2026; t155's report: opening a 2,000-note folder drew 2,000 rows):
  // the first eighty open rows, as the Notes page windows its list, with Show more for the rest.
  const [shownCount, setShownCount] = useState(80);
  const body = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // The open folders as saved (once read), then kept as the person opens and shuts them.
  useEffect(() => {
    if (!memoryRead || loaded.current) return;
    loaded.current = true;
    if (Array.isArray(memory.expanded)) setExpanded((prev) => new Set([...prev, ...memory.expanded!]));
  }, [memoryRead]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => rememberExplorer({ expanded: [...expanded] }), 300);
    return () => clearTimeout(t);
  }, [expanded]);

  const tree = useMemo(() => build(files, folders, prefs.showAllFiles, sort, machinery, showMachinery), [files, folders, prefs.showAllFiles, sort, machinery, showMachinery]);
  const hiddenCount = useMemo(() => (showMachinery ? 0 : hiddenFileCount(files, machinery, prefs.showAllFiles)), [files, machinery, prefs.showAllFiles, showMachinery]);
  const isFolder = useCallback((p: string) => getState().folders.includes(p), []);

  // Visible rows in order, for the arrow keys and Shift+click ranges.
  const visible = useMemo(() => {
    const out: string[] = [];
    const walk = (f: Folder) => {
      for (const sub of f.folders) {
        out.push(sub.path);
        if (expanded.has(sub.path)) walk(sub);
      }
      for (const file of f.files) out.push(file.path);
    };
    walk(tree);
    return out;
  }, [tree, expanded]);

  // Every row the tree draws, in order: the same walk, minus a project folder's own page (it reads as
  // its folder row, never a second row, as the rows below filter it). The window's count reads this, so
  // Show more says exactly how many are left. The keys keep walking `visible` whole, as before.
  const flatRows = useMemo(() => {
    const out: string[] = [];
    const walk = (f: Folder) => {
      for (const sub of f.folders) {
        out.push(sub.path);
        if (expanded.has(sub.path)) walk(sub);
      }
      for (const file of f.files) {
        if (file.path === `${f.path}/${f.name}.md` && isProjectProps(byPath.get(file.path)?.props)) continue;
        out.push(file.path);
      }
    };
    walk(tree);
    return out;
  }, [tree, expanded, byPath]);

  /** Opens the folders above a file and scrolls it into view. */
  const reveal = useCallback((path: string) => {
    const parts = path.split('/');
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      if (getState().folders.includes(path)) next.add(path);
      return next;
    });
    setSelected(new Set([path]));
    setFocus(path);
    // The window follows a reveal (t163), so the row is drawn before the scroll lands.
    const i = visible.indexOf(path);
    if (i >= 0) setShownCount((n) => Math.max(n, i + 1));
    requestAnimationFrame(() => body.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [visible]);

  useEffect(() => {
    A.onRevealInExplorer(reveal);
    return () => A.onRevealInExplorer(null);
  }, [reveal]);

  // The open file shows in the list.
  useEffect(() => {
    if (!active) return;
    const parts = active.split('/');
    if (parts.length > 1) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (let i = 1; i < parts.length; i++) {
          const p = parts.slice(0, i).join('/');
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    // The window follows the open file (t163), so its row is drawn before the scroll lands.
    const i = visible.indexOf(active);
    if (i >= 0) setShownCount((n) => Math.max(n, i + 1));
    requestAnimationFrame(() => body.current?.querySelector(`[data-path="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [active, visible]);

  const toggle = (path: string) => {
    // Opening or folding starts the window over (t163): the newly opened folder reads from its first
    // rows, never 2,000 at once.
    setShownCount(80);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const select = (path: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && focus) {
      const a = visible.indexOf(focus);
      const b = visible.indexOf(path);
      if (a >= 0 && b >= 0) {
        setSelected(new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return true;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setFocus(path);
      return true;
    }
    setSelected(new Set([path]));
    setFocus(path);
    return false;
  };

  const newNoteIn = async (folder: string) => {
    if (folder) setExpanded((prev) => new Set(prev).add(folder));
    await newNoteOfType(undefined, { folder });
  };
  const newFolderIn = async (parent: string) => {
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
    const made = await A.newFolder(parent);
    if (made) {
      setRenaming(made);
      reveal(made);
    }
  };
  const newCanvasIn = async (folder: string) => {
    if (folder) setExpanded((prev) => new Set(prev).add(folder));
    await A.newCanvas(folder);
  };

  const moveInto = async (paths: string[], folder: string) => {
    for (const p of paths) {
      if (p === folder || folder.startsWith(`${p}/`)) continue;
      const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      if (parent === folder) continue;
      await A.movePath(p, folder ? `${folder}/${A.nameOf(p)}` : A.nameOf(p));
    }
    if (folder) setExpanded((prev) => new Set(prev).add(folder));
  };

  const onDrop = async (e: DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (!canEdit) return;
    const internal = e.dataTransfer.getData(PATHS_MIME);
    if (internal) {
      await moveInto(internal.split('\n').filter(Boolean), folder);
      return;
    }
    const outside = [...e.dataTransfer.files].map((f) => window.nv.files.pathOf(f)).filter(Boolean);
    if (outside.length) {
      try {
        const added = await window.nv.files.importPaths(outside, folder);
        await Promise.all([loadFiles(), loadNotes()]);
        if (added[0]) reveal(added[0]);
      } catch (err) {
        showError(err);
      }
    }
  };

  const dragProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(PATHS_MIME) && !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(PATHS_MIME) ? 'move' : 'copy';
      setDropTarget(folder);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget((t) => (t === folder ? null : t));
    },
    onDrop: (e: DragEvent) => void onDrop(e, folder),
  });

  const startDrag = (e: DragEvent, path: string) => {
    const paths = selected.has(path) ? [...selected] : [path];
    if (!selected.has(path)) setSelected(new Set([path]));
    e.dataTransfer.setData(PATHS_MIME, paths.join('\n'));
    e.dataTransfer.setData('text/plain', paths.map((p) => writeLink(p, undefined, { embed: shownInPlace(p) })).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const menuFor = (path: string, folder: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(path)) {
      setSelected(new Set([path]));
      setFocus(path);
    }
    const many = selected.size > 1 && selected.has(path);
    if (many) {
      const list = [...selected];
      openMenu(e, [
        { heading: `${list.length} selected` },
        { label: 'Move to…', icon: 'folder', disabled: !canEdit, run: async () => { const { pickFolder } = await import('../components/Pickers'); const f = await pickFolder(getState().folders); if (f !== null) await moveInto(list, f); } },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: async () => { for (const p of list) if (!(await A.trashPath(p))) break; setSelected(new Set()); } },
      ]);
      return;
    }
    openMenu(e, fileMenu(path, { isFolder: folder, onRename: () => setRenaming(path), onNewNote: () => void newNoteIn(path), onNewFolder: () => void newFolderIn(path), onNewCanvas: () => void newCanvasIn(path) }));
  };

  const commitRename = async (path: string, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (!name || name === (isFolder(path) ? A.nameOf(path) : A.titleOf(path))) return;
    const moved = await A.renamePath(path, name);
    if (moved) reveal(moved);
  };

  const renderName = (path: string, label: string) =>
    renaming === path ? (
      <input
        className="tree-rename"
        autoFocus
        defaultValue={label}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => void commitRename(path, e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setRenaming(null);
        }}
      />
    ) : (
      <span className="tree-name">{label}</span>
    );

  const projectNote = (f: Folder) => {
    const note = `${f.path}/${f.name}.md`;
    return isProjectProps(byPath.get(note)?.props) ? note : null;
  };
  const renderFolder = (folder: Folder, depth: number, win: { left: number }): ReactNode => (
    <>
      {folder.folders.map((f) => {
        // Past the window's budget the row stays undrawn (t163): the maps still walk in order, so an
        // open folder's drawn children keep their place and their guides.
        if (win.left <= 0) return null;
        win.left--;
        const open = expanded.has(f.path);
        const project = projectNote(f);
        const health = project ? healthTone(String(byPath.get(project)?.props?.health ?? '')) : 'none';
        return (
          <div key={f.path} className={`tree-folder-wrap${dropTarget === f.path ? ' is-drop' : ''}`} {...dragProps(f.path)}>
            <div
              className={`tree-row tree-folder${selected.has(f.path) ? ' selected' : ''}${focus === f.path ? ' focused' : ''}`}
              style={{ paddingLeft: 8 + depth * 16 }}
              data-path={f.path}
              title={f.path}
              draggable={renaming !== f.path}
              onDragStart={(e) => startDrag(e, f.path)}
              onClick={(e) => {
                if (select(f.path, e)) return;
                // A project opens as its page (and its folder opens to show what else is in it).
                if (project) {
                  A.openPath(project, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
                  if (!open) toggle(f.path);
                } else toggle(f.path);
              }}
              onContextMenu={(e) => menuFor(f.path, true, e)}
            >
              <span
                className="tree-chevron-hit"
                onClick={(e) => {
                  if (!project) return;
                  e.stopPropagation();
                  toggle(f.path);
                }}
              >
                <Icon name="chevron" size={12} className={`tree-chevron${open ? ' open' : ''}`} />
              </span>
              {project && <span className={`tree-project tone-${health}`} title="A project" />}
              {renderName(f.path, f.name)}
              <button
                type="button"
                className="iconbtn tree-more"
                aria-label={`More for ${f.path}`}
                title="More"
                onClick={(e) => {
                  e.stopPropagation();
                  menuFor(f.path, true, e);
                }}
              >
                <Icon name="more" size={14} />
              </button>
            </div>
            {open && (
              <div className="tree-children">
                <span className="tree-guide" style={{ left: 14 + depth * 16 }} />
                {renderFolder(f, depth + 1, win)}
              </div>
            )}
          </div>
        );
      })}
      {folder.files.filter((file) => !(file.path === `${folder.path}/${folder.name}.md` && isProjectProps(byPath.get(file.path)?.props))).map((file) => {
        if (win.left <= 0) return null;
        win.left--;
        return (
        <div
          key={file.path}
          className={`tree-row tree-file${file.path === active ? ' active' : ''}${selected.has(file.path) ? ' selected' : ''}${focus === file.path ? ' focused' : ''}`}
          style={{ paddingLeft: 24 + depth * 16 }}
          data-path={file.path}
          title={file.path}
          draggable={renaming !== file.path}
          onDragStart={(e) => startDrag(e, file.path)}
          onClick={(e) => {
            if (select(file.path, e) && !(e.ctrlKey || e.metaKey)) return;
            A.openPath(file.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
          }}
          onAuxClick={(e) => e.button === 1 && A.openPath(file.path, { where: 'tab' })}
          onMouseOver={(e) => {
            // Ctrl + hover: a preview of the note (or picture) without opening it.
            if ((e.ctrlKey || e.metaKey) && (file.ext === '' || /^(png|jpe?g|gif|webp|svg)$/.test(file.ext))) hoverLink(file.ext === '' ? file.path.replace(/\.md$/i, '') : file.path, e.currentTarget as HTMLElement, undefined, 150, true);
          }}
          onContextMenu={(e) => menuFor(file.path, false, e)}
        >
          {file.ext && file.ext !== 'canvas' && <Icon name={fileIcon(file.path)} size={14} className="tree-file-icon" />}
          {file.ext === 'canvas' && <Icon name="canvas" size={14} className="tree-file-icon" />}
          {renderName(file.path, file.name)}
          {file.ext && file.ext !== 'canvas' && file.ext !== 'view' && <span className="tree-ext">{file.ext}</span>}
        </div>
        );
      })}
    </>
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const at = focus ? visible.indexOf(focus) : -1;
    const go = (i: number) => {
      const to = Math.max(0, Math.min(visible.length - 1, i));
      const p = visible[to];
      if (!p) return;
      // The window follows the keys (t163): arrowing past the drawn rows draws up to the key row.
      if (to >= shownCount) setShownCount(to + 1);
      setFocus(p);
      setSelected(new Set([p]));
      requestAnimationFrame(() => body.current?.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(at - 1);
    } else if (e.key === 'ArrowRight' && focus && isFolder(focus)) {
      e.preventDefault();
      if (!expanded.has(focus)) toggle(focus);
      else go(at + 1);
    } else if (e.key === 'ArrowLeft' && focus) {
      e.preventDefault();
      if (isFolder(focus) && expanded.has(focus)) toggle(focus);
      else if (focus.includes('/')) {
        const parent = focus.slice(0, focus.lastIndexOf('/'));
        setFocus(parent);
        setSelected(new Set([parent]));
      }
    } else if (e.key === 'Enter' && focus) {
      e.preventDefault();
      if (isFolder(focus)) toggle(focus);
      else A.openPath(focus, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
    } else if (e.key === 'F2' && focus && canEdit) {
      e.preventDefault();
      e.stopPropagation();
      setRenaming(focus);
    } else if (e.key === 'Delete' && selected.size && canEdit) {
      e.preventDefault();
      void (async () => {
        for (const p of [...selected]) if (!(await A.trashPath(p))) break;
        setSelected(new Set());
      })();
    }
  };

  const allOpen = expanded.size > 0;
  return (
    <div className="panel explorer">
      <div className="panel-toolbar nav-toolbar">
        {modeSwitch}
        <span className="panel-toolbar-space" />
        <button className="icon-button" title="New note" disabled={!canEdit} onClick={() => void newNoteIn(focus && isFolder(focus) ? focus : focus?.includes('/') ? focus.slice(0, focus.lastIndexOf('/')) : '')}>
          <Icon name="filePlus" size={16} />
        </button>
        <button className="icon-button" title="New folder" disabled={!canEdit} onClick={() => void newFolderIn(focus && isFolder(focus) ? focus : '')}>
          <Icon name="folderPlus" size={16} />
        </button>
        <button
          className="icon-button"
          title="Sort, and open or close every folder"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Name (A to Z)', checked: sort === 'name', run: () => setSort('name') },
              { label: 'Name (Z to A)', checked: sort === 'name-desc', run: () => setSort('name-desc') },
              { label: 'Changed (newest first)', checked: sort === 'modified', run: () => setSort('modified') },
              { label: 'Changed (oldest first)', checked: sort === 'modified-old', run: () => setSort('modified-old') },
              { separator: true },
              { label: allOpen ? 'Close every folder' : 'Open every folder', icon: allOpen ? 'collapse' : 'expand', run: () => { setShownCount(80); setExpanded(allOpen ? new Set() : new Set(folders)); } },
            ])
          }
        >
          <Icon name="sort" size={16} />
        </button>
        <button className="icon-button" title="Show the open note" disabled={!active} onClick={() => active && reveal(active)}>
          <Icon name="reveal" size={16} />
        </button>
      </div>
      <div
        ref={body}
        className={`panel-body tree${dropTarget === '' ? ' is-drop' : ''}`}
        tabIndex={0}
        data-own-keys
        onKeyDown={onKeyDown}
        {...dragProps('')}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          openMenu(e, [
            { label: 'New note', icon: 'filePlus', disabled: !canEdit, run: () => void newNoteIn('') },
            { label: 'New note from a template…', icon: 'template', disabled: !canEdit, run: () => void newNoteFromTemplate({ folder: '' }) },
            { label: 'New folder', icon: 'folderPlus', disabled: !canEdit, run: () => void newFolderIn('') },
            { label: 'New canvas', icon: 'canvas', disabled: !canEdit, run: () => void newCanvasIn('') },
            { separator: true },
            { label: 'Show your notes folder in File Explorer', icon: 'reveal', run: () => void A.revealInSystem('') },
          ]);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(new Set());
        }}
      >
        {visible.length ? renderFolder(tree, 0, { left: shownCount }) : <EmptyState size="panel" icon="file" title="No notes yet" line="Your notes and folders show here." action={canEdit ? { label: 'New note', icon: 'filePlus', run: () => void newNoteOfType() } : undefined} />}
        {flatRows.length > shownCount && (
          <button type="button" className="tree-row tree-showmore" onClick={() => setShownCount((n) => n + 80)}>
            <span className="tree-name">Show more ({flatRows.length - shownCount} left)</span>
          </button>
        )}
        {(hiddenCount > 0 || showMachinery) && (
          <button type="button" className="tree-row tree-showall" onClick={toggleMachinery} title={showMachinery ? 'Hide the app’s own folders again' : 'Also show the app’s own folders here. Search finds them either way.'} aria-pressed={showMachinery}>
            <span className="tree-name">{showMachinery ? 'Show fewer folders' : `Show everything · ${hiddenCount}`}</span>
          </button>
        )}
      </div>
    </div>
  );
}
