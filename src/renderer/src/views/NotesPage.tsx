// The Notes page (8.0 Job C, 29 Oct 2026; SPEC section C; 8.7 w2b, 30 Oct 2026): recent notes a person can scan and act
// on, in the mock-up's shape. A folder rail on the left (All notes, Daily, Docs, then the vault's own folders with
// their counts), kind chips with counts, one project filter, one search, then the notes newest first in Today / This
// week / Earlier rows with a glyph tile, one plain line from the note, its project or area and a short when. Grouping,
// snippets, folders and kinds are src/shared/notes-list.ts; this file only resolves each note's type, project and area
// from the index already in memory and reads the first notes' words for their snippets. Sorted by change or by name
// (10.0 papercuts), pinned notes leading in their own group (kept on this PC), and ticked rows acting together: open,
// tag, move, pin or send to Recently deleted from the one bar.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { changedWords, filterNoteRows, folderChoices, groupNoteRows, isPinned, NOTE_KIND_FILTERS, NOTE_SORTS, noteRow, notesPageKeepsPath, notesPageKeepsType, projectChoices, recordKindWords, rowPositions, shortWhen, snippetFor, snippetForDisplay, togglePinned, toggleSelected, type NoteKindFilter, type NoteListRow, type NoteSort } from '../../../shared/notes-list';
import { addTag, cleanTag } from '../../../shared/tags';
import { isProjectProps } from '../../../shared/project-file';
import { typeOfNote } from '../../../shared/note-types';
import { plural, showCount } from '../../../shared/words';
import { PageHead } from '../components/PageHead';
import { ListDetail, RecordDetail } from '../components/ListDetail';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { ListFind, useFindMemory } from '../components/PageTabs';
import { prompt } from '../components/Dialogs';
import { pickFile } from '../components/Pickers';
import { fileMenu } from '../state/menus';
import * as A from '../state/actions';
import { openStarterPicker } from '../state/abilities';
import { areaOfPath, getAreas } from '../state/areas';
import { isQuietPath, type MachineryCtx } from '../../../shared/fewer-folders';
import { MODULES, moduleFolder } from '../../../shared/module-records';
import { moduleOn } from '../../../shared/life-modules';
import { docs } from '../state/docs';
import { resolveNote } from '../lib/resolve';
import { folderOfTab, getNoteTypes, newNoteOfType, openTypePage, typeOfTab } from '../state/noteTypes';
import { getState, showError, toast, useApp, usePrefs } from '../state/store';
import type * as W from '../state/workspace';
import { setTabSection } from '../state/workspace';
import { setWorkspace } from '../state/layout';
import type { ListedFile, NoteMeta } from '../../../shared/types';
import type { NoteType } from '../../../shared/note-types';
import type { AreasConfig } from '../../../shared/areas';
import type { Prefs } from '../../../shared/prefs';
import '../styles/w2b.css';

const SORT_MEMORY = 'nv-notes-sort';
// Whether Show everything is on (5 Nov 2026, "your notes are yours"): remembered on this PC, off for a new vault.
const SHOW_ALL_MEMORY = 'nv-notes-show-all';
// Snippet texts read for the rows, kept across opens (t102, 9 Nov 2026): every Notes open re-read the same
// eighty notes. Keyed by path with the change time read, so a changed note reads again.
const snippetCache = new Map<string, { mtime: number; text: string }>();

// The rows for the notes at hand, kept across opens (t146, 9 Nov 2026): every Notes open re-typed,
// re-chipped, re-homed and re-snippetted all 3,000 notes for identical rows, most of the switch.
// The rows are a pure reading of these six; the same six is the same rows, anything changed reads again.
let keptRows: { notes: NoteMeta[]; files: ListedFile[]; prefs: Prefs; types: NoteType[]; areas: AreasConfig | null; rows: NoteListRow[] } | null = null;

// A row's date title, kept (one formatter: eighty rows built one each, every render).
const whenFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const whenTitles = new Map<number, string>();
function whenTitle(mtime: number): string {
  const had = whenTitles.get(mtime);
  if (had !== undefined) return had;
  const out = whenFmt.format(new Date(mtime));
  if (whenTitles.size > 2000) whenTitles.clear();
  whenTitles.set(mtime, out);
  return out;
}

// One scan of the folder into its chip counter (t102's memoised counts, t142 keeping the shape the
// one-window test pins: the chips count within the folder on show, counted once when it changes).
// Notes counts notes only; records count under All and their own Records chip (t277).
function kindCounterFor(rows: NoteListRow[]): (id: NoteKindFilter) => number {
  const counts: Record<NoteKindFilter, number> = { all: rows.length, notes: 0, docs: 0, daily: 0, records: 0 };
  for (const r of rows) {
    if (r.record) counts.records++;
    else counts[r.kind === 'note' ? 'notes' : r.kind === 'doc' ? 'docs' : 'daily']++;
  }
  return (id) => counts[id];
}

function readSort(): NoteSort {
  try {
    const v = localStorage.getItem(SORT_MEMORY);
    return NOTE_SORTS.some((s) => s.id === v) ? (v as NoteSort) : 'changed';
  } catch {
    return 'changed';
  }
}

function readShowAll(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_MEMORY) === '1';
  } catch {
    return false;
  }
}

// The folder a Notes tab shows (t277): a deep link carries it in the path (?folder=), a pick writes it to
// the tab's section in place (`folder:<path>`, even empty for All notes), and Back restores it. The section
// wins over a stale path, so picking All after a deep link stays All on Back.
function folderInTab(t: W.TabState): string {
  const s = t.section;
  if (s && s.startsWith('folder:')) return s.slice(7).slice(0, 200);
  return folderOfTab(t);
}

export function NotesPage({ tab }: { tab: W.TabState }) {
  const notes = useApp((s) => s.notes);
  const canEdit = useApp((s) => s.canEdit);
  const prefs = usePrefs();
  const templatesFolder = prefs.templatesFolder;
  const settings = useApp((s) => s.settings);
  const fromTab = typeOfTab(tab);
  // Polish round 2 (ITEMS 1): opened as Docs or Daily from Your notes, the page starts on that filter.
  const [kind, setKind] = useState<NoteKindFilter>(fromTab === 'doc' ? 'docs' : fromTab === 'daily' ? 'daily' : 'all');
  // A deep link opens Notes already filtered (one product step 2): the tab carries the folder, Back returns.
  // A pick writes it to the tab's section in place (t277), so opening a record and pressing Back returns to it.
  const [folder, setFolder] = useState<string>(() => folderInTab(tab));
  useEffect(() => { setFolder(folderInTab(tab)); }, [tab.path, tab.section]);
  const [project, setProject] = useState<string>('');
  // The words stand as left (t266: leaving the room forgot them; Tasks remembers its filter).
  const [query, setQuery] = useFindMemory('notes');
  const [sort, setSort] = useState<NoteSort>(() => readSort());
  const [showAll, setShowAll] = useState<boolean>(() => readShowAll());
  const [pinned, setPinned] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  // The rows drawn at once (5 Nov 2026 speed audit item 6: all 506 rows sat in the DOM, 7,913 nodes).
  // Eighty at a time, the same rows, as the Library does; Show more adds the next eighty.
  const [shownCount, setShownCount] = useState(80);
  const searchRef = useRef<HTMLInputElement>(null);

  // Pinned notes, kept on this PC beside the vault (never in the notes).
  useEffect(() => {
    void window.nv.state.load<{ pinned?: string[] }>('notes-pinned').then(
      (s) => Array.isArray(s?.pinned) && setPinned(s.pinned.filter((p): p is string => typeof p === 'string')),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    void window.nv.state.save('notes-pinned', { pinned }).catch(() => undefined);
  }, [pinned]);

  const baseRows = useMemo<NoteListRow[]>(() => {
    const types = getNoteTypes();
    const areas = getAreas();
    const files = getState().files;
    const k = keptRows;
    if (k && k.notes === notes && k.files === files && k.prefs === prefs && k.types === types && k.areas === areas) return k.rows;
    const projects = notes.filter((n) => isProjectProps(n.props));
    const folderProjects = projects.map((p) => ({ path: p.path, name: p.label || p.title, folder: p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '' })).sort((a, b) => b.folder.length - a.folder.length);
    const out: NoteListRow[] = [];
    for (const n of notes) {
      const typeId = typeOfNote(n, types, templatesFolder);
      const base = noteRow({ path: n.path, title: n.title, label: n.label, mtime: n.mtime, typeId, props: n.props, headings: n.headings, tags: n.tags });
      // This page is notes, docs and daily notes (a pack's records read here too, as the mock-up's House and Money
      // rows do); projects, people, meetings and series have their own pages. The same rule the one side bar
      // counts by (notes-list.ts), so the bar and the page never disagree.
      if (!notesPageKeepsType(typeId, base.kind)) continue;
      // A pack's record (5 Nov 2026, "your notes are yours"): marked from its type, so the page shows what the
      // person wrote unless they ask for everything. The type says so, never a word list.
      const type = types.find((t) => t.id === typeId);
      const record = !!type?.module;
      // A record reads its pack's own kind in its pack's words and colour (t277): Bill, Machine, Service,
      // Runbook and the rest from the pack registries, never "Note" and never a hand list.
      const kindLabel = record && type ? recordKindWords(type, n.props) : base.kindLabel;
      const kindColor = record && type ? type.color : undefined;
      const inProject = folderProjects.find((p) => p.folder && n.path !== p.path && n.path.startsWith(`${p.folder}/`));
      const ref = typeof n.props?.project === 'string' ? String(n.props.project).replace(/^\[\[|\]\]$/g, '') : '';
      // The chip's project (9.2 uplift F40): one resolution only, path first then an unambiguous name, never a
      // silent first-title pick among same-named projects, so renames follow links and stale refs chip nothing.
      const viaPath = ref ? resolveNote(ref, n.path) : null;
      const named = viaPath ? projects.find((p) => p.path === viaPath) : undefined;
      const proj = inProject ?? (named ? { path: named.path, name: named.label || named.title } : undefined);
      out.push({ ...base, kindLabel, ...(kindColor ? { kindColor } : {}), ...(record ? { record } : {}), ...(proj ? { project: { path: proj.path, name: proj.name } } : {}), ...(!proj ? { area: areaOfPath(n.path)?.name } : {}) });
    }
    const rows = out.sort((a, b) => b.mtime - a.mtime);
    keptRows = { notes, files, prefs, types, areas, rows };
    return rows;
    // getNoteTypes, getAreas and the files read the store outside React; a changed reading is the signal
    // to resolve again, which the kept rows check above (the memo's own signal stays notes and the folder).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, templatesFolder]);
  // The read texts laid over the rows (t102, 9 Nov 2026): the rows above used to be rebuilt whole, every
  // note re-typed, re-chipped and re-homed, each time a snippet round landed. The rows stand; only the
  // eighty read snippets change, through the same snippetFor noteRow uses, so the filter reads the same rows.
  // Laid only while words are typed (the filter above stands without them).
  const allRows = useMemo<NoteListRow[]>(() => {
    if (!query.trim() || !Object.keys(texts).length) return baseRows;
    return baseRows.map((r) => {
      const t = texts[r.path];
      return t === undefined ? r : { ...r, snippet: snippetFor(r, t) };
    });
  }, [baseRows, texts, query]);

  // Fewer folders on show (5 Nov 2026): what counts as machinery in this vault (the app's own folders and
  // the packs' own subfolders, never a folder the person made), plus the folders the person kept out of view
  // (8 Nov 2026). Notes shows what the person wrote in their own areas and folders; Show everything adds the
  // packs' records and the hidden folders back. Every count on the page (the rail, the chips, the head) reads
  // these rows, so the numbers always agree.
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
  }, [prefs.templatesFolder, prefs.assetsFolder, prefs.attachmentsFolder, prefs.quietFolders, prefs.modules, settings?.dailyFolder, notes]);
  // Filtered with snippets only while words are typed (t102, 9 Nov 2026): the filter reads snippets,
  // so every snippet round regrouped the whole list for rows nobody asked about. Without words the rows
  // stand and only the drawn window takes the snippets; with words the search reads them as before.
  const filterSource = query.trim() ? allRows : baseRows;
  const rows = useMemo(() => {
    const kept = filterNoteRows(filterSource, { includeRecords: showAll });
    // Docs and daily notes are the person's own (a1, 6 Nov 2026: the Docs tab stood empty with docs on disk,
    // their store folders hiding them as machinery): the rows keep those kinds out of the hiding, so the Docs
    // and Daily tabs count and list them without Show everything. Anything else machinery stays behind it.
    // A folder the person kept out hides everything in it, docs and daily notes too: their choice wins.
    // The same rule the one side bar counts by (notes-list.ts).
    return showAll ? kept : kept.filter((r) => notesPageKeepsPath(r.path, r.kind, !!r.record, machinery));
  }, [filterSource, showAll, machinery]);
  const hiddenCount = useMemo(() => {
    const kept = filterNoteRows(filterSource, { includeRecords: true });
    return kept.filter((r) => !notesPageKeepsPath(r.path, r.kind, !!r.record, machinery)).length;
  }, [filterSource, machinery]);
  const recordCount = hiddenCount;

  const folders = useMemo(() => folderChoices(rows), [rows]);
  // The folders that fit without the rail scrolling (t190, 10 Nov 2026: with 24 folders the sticky rail ran
  // 546px past the window at 1219x709 and its last rows answered no click, reaching no scroller). The rail
  // measures what fits and folds whole folders behind one quiet "N more folders" row, as the former host
  // app's rail folds workspaces behind All workspaces and the side bar tree windows its rows. Opening it
  // shows the rest in place and the rail stops sticking, so the page's own scroll reaches every row; the
  // rail is sticky only while it fits, so sticking never strands a row again. Nothing moved, renamed or
  // hidden for good: All notes, Daily and Docs lead as before, and sub rows ride with their folder either
  // side of the fold.
  const railRef = useRef<HTMLElement>(null);
  const [folderFit, setFolderFit] = useState<number | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const nav = railRef.current;
      if (!nav) return;
      // A rail that scrolls with the page needs no fold (the narrow rail under 900px, already static): the
      // page scroll reaches every row. Only a sticking rail can strand its last rows past the window. Our own
      // opened rail is static too, but it keeps its count: dropping it would stick the tall rail again and
      // strand the rows the person just opened.
      if (!nav.classList.contains('is-tall') && getComputedStyle(nav).position !== 'sticky') {
        setFolderFit((n) => (n === null ? n : null));
        return;
      }
      // Every folder row stands one line (.clip never wraps), so one row's height prices every group: a group
      // is its rows times that height, and the more row is one row. The fixed head (the label, All notes, Daily,
      // Docs, Show everything) is measured as drawn, so a later row there never breaks the count.
      const row = nav.querySelector(':scope > button.frow');
      const rowH = row instanceof HTMLElement ? row.offsetHeight : 0;
      if (!rowH) return;
      let fixed = 0;
      for (const el of [...nav.children]) {
        if (el instanceof HTMLElement && el.hasAttribute('data-fgroup')) break;
        if (el instanceof HTMLElement) {
          const st = getComputedStyle(el);
          fixed += el.offsetHeight + (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0);
        }
      }
      // The room is what fits below the page head with the page unscrolled: the scroller's height less the
      // rail's own top in content coordinates. Read off the notes column beside it, which stands in normal flow
      // at the same top: the rail's own rect moves when it sticks, but the column's never lies however far the
      // page has scrolled, so the count never pops rows in and out mid-scroll. Stuck, the rail starts higher and
      // the same rows fit with room to spare.
      const scroller = nav.closest('.nv-page-scroll');
      const main = nav.parentElement?.querySelector(':scope > .w2b-main');
      const railTop = scroller instanceof HTMLElement && main instanceof HTMLElement
        ? main.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : 0;
      const room = (scroller instanceof HTMLElement ? scroller.clientHeight : window.innerHeight) - railTop - 12;
      const groupRows = folders.map((f) => 1 + f.subs.length);
      const all = fixed + rowH * groupRows.reduce((a, b) => a + b, 0);
      if (all <= room) {
        setFolderFit((n) => (n === null ? n : null));
        return;
      }
      let used = fixed + rowH;
      let fit = 0;
      for (const n of groupRows) {
        if (used + rowH * n > room) break;
        used += rowH * n;
        fit++;
      }
      setFolderFit((n) => (n === fit ? n : fit));
    };
    measure();
    window.addEventListener('resize', measure);
    // The rail's own size changing (a font landing late, the folders changing) re-measures too; measuring
    // the same sizes sets the same count, so the observer never loops.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (ro && railRef.current) ro.observe(railRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [folders]);
  // The folder on show is always a drawn row: a link into a folded folder opens the rail in place.
  useEffect(() => {
    if (!folder || foldersOpen || folderFit === null) return;
    const top = folder.split('/')[0];
    if (folders.findIndex((f) => f.prefix === top) >= folderFit) setFoldersOpen(true);
  }, [folder, folders, foldersOpen, folderFit]);
  // The drawn folders: the shut rail shows what fits, the opened rail every folder. The fold-back row only
  // shows while shutting keeps the folder on show drawn, so it never hides what the person is looking at.
  const shutRail = !foldersOpen && folderFit !== null && folders.length > folderFit;
  const drawnFolders = shutRail ? folders.slice(0, folderFit ?? 0) : folders;
  const tallRail = foldersOpen && folderFit !== null && folders.length > folderFit;
  const folderTop = folder ? folder.split('/')[0] : '';
  const folderStaysDrawn = !folderTop || folders.findIndex((f) => f.prefix === folderTop) < (folderFit ?? folders.length);
  // The head, the chips and the project filter follow the folder on show (one window, 9 Nov 2026: with Work
  // on show the head still said Notes 34 and All 34, the counts of everything, not of Work). A folder's
  // count is what clicking it shows, as the one side bar counts it. One shared reading (t271, 13 Nov 2026):
  // the rail counts these rows, so the folder, the list and the Find's count filter them with the same Show
  // everything, never the default that hides the packs' records while the rail counts them.
  const inFolder = useMemo(() => (folder ? filterNoteRows(rows, { folder, includeRecords: showAll }) : rows), [rows, folder, showAll]);
  // The folder on show always has rows to show (t278, 13 Nov 2026 break-it: with a packs folder
  // open, switching Show everything off stranded the page: the rail lost the folder while the
  // filter stayed, so the chips and rows read 0 with "Nothing matches" and no drawn filter to
  // clear; keeping a folder out of view, or its last note moving away, strands the same way).
  // A folder with no rows in this reading is never a drawn row (the rail counts these rows), so
  // the page falls back to All notes, keeping the kind. A deeper link with rows (Deep/L2/L3) and
  // a Find narrowing to nothing keep the folder: the reading, not the rail, is the judge, and an
  // empty vault never resets a link being opened.
  useEffect(() => {
    if (folder && rows.length > 0 && inFolder.length === 0) setFolder('');
  }, [folder, rows.length, inFolder.length]);
  const choices = useMemo(() => projectChoices(inFolder), [inFolder]);
  const shown = useMemo(() => filterNoteRows(rows, { kind, folder: folder || null, project: project || null, includeRecords: showAll, query }), [rows, kind, folder, project, query, showAll]);
  // The Find counts its chip without its words (t262): the same rows with the words off.
  const match = useMemo(() => (!query.trim() ? null : { n: shown.length, m: filterNoteRows(rows, { kind, folder: folder || null, project: project || null, includeRecords: showAll, query: '' }).length }), [rows, kind, folder, project, query, shown.length, showAll]);
  const groupsAll = useMemo(() => groupNoteRows(shown, new Date(), { sort, pinned }), [shown, sort, pinned]);
  const flatAll = useMemo(() => groupsAll.flatMap((g) => g.rows), [groupsAll]);
  // Only the window is drawn (pinned still lead: they head the flat order, so the slice keeps them).
  const flat = useMemo(() => flatAll.slice(0, shownCount), [flatAll, shownCount]);
  // The window takes the read snippets (the filter above stands without them): eighty rows, never the list.
  const flatShown = useMemo(
    () => flat.map((r) => {
      const t = texts[r.path];
      return t === undefined ? r : { ...r, snippet: snippetFor(r, t) };
    }),
    [flat, texts],
  );
  const groups = useMemo(() => groupNoteRows(flatShown, new Date(), { sort, pinned }), [flatShown, sort, pinned]);
  // Each row's place found once (10.0 papercuts): the old per-row scan read the whole list for every row.
  const positions = useMemo(() => rowPositions(flatShown), [flatShown]);
  useEffect(() => { setActive(0); setShownCount(80); }, [kind, folder, project, query, sort]);
  // Ticked rows that filtered away untick themselves, so the bar never acts on what isn't shown.
  useEffect(() => {
    setSelected((s) => {
      const here = new Set(shown.map((r) => r.path));
      const kept = s.filter((p) => here.has(p));
      return kept.length === s.length ? s : kept;
    });
  }, [shown]);

  // The drawn notes' own words, for their one-line snippets (5 Nov 2026 speed audit item 6: 20 at a time
  // meant ~25 read-then-render rounds for 500 notes). One round for the window; rows past it read when shown.
  // Rows read on an earlier open come from the kept texts, never the vault again.
  useEffect(() => {
    const missing = flat.filter((r) => texts[r.path] === undefined);
    if (!missing.length) return;
    const kept: Record<string, string> = {};
    const fetch: typeof missing = [];
    for (const r of missing) {
      const c = snippetCache.get(r.path);
      if (c && c.mtime === r.mtime) kept[r.path] = c.text;
      else fetch.push(r);
    }
    // The kept texts land a frame later (t146, 9 Nov 2026): laying eighty snippets in the mount's own
    // commit made one background long task of the switch; a frame later they are their own small task, and the
    // rows show their heading line meanwhile, as rows still being read always did.
    let frame = 0;
    if (Object.keys(kept).length) frame = requestAnimationFrame(() => { frame = 0; setTexts((t) => ({ ...t, ...kept })); });
    if (!fetch.length) return () => { if (frame) cancelAnimationFrame(frame); };
    let alive = true;
    void Promise.all(fetch.map(async (r) => [r.path, await window.nv.notes.read(r.path).catch(() => '')] as const)).then((got) => {
      if (snippetCache.size > 500) snippetCache.clear();
      for (const [p, text] of got) {
        const row = fetch.find((r) => r.path === p);
        snippetCache.set(p, { mtime: row?.mtime ?? 0, text });
      }
      if (alive) setTexts((t) => ({ ...t, ...Object.fromEntries(got) }));
    });
    return () => { alive = false; if (frame) cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, texts]);

  const open = (r: NoteListRow, newTab = false) => A.openPath(r.path, { where: newTab ? 'tab' : 'current' });
  const onKey = (e: React.KeyboardEvent) => {
    // Keys are the list's only outside a field (fnv3 F29): Enter and / inside a select or input are theirs.
    if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
    if (e.key === '/' && document.activeElement !== searchRef.current) { e.preventDefault(); searchRef.current?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(flat.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && flat[active]) open(flat[active]);
  };

  // Counted once per folder, not once per render (t102, 9 Nov 2026: every keystroke in the search
  // scanned the whole list eight times over, dating every row).
  const todayCount = useMemo(() => inFolder.filter((r) => changedWords(r.mtime).startsWith('Today')).length, [inFolder]);
  const kindCount = useMemo(() => kindCounterFor(inFolder), [inFolder]);
  const dailyCount = useMemo(() => rows.filter((r) => r.kind === 'daily' && !r.record).length, [rows]);
  const docsCount = useMemo(() => rows.filter((r) => r.kind === 'doc' && !r.record).length, [rows]);
  // The rail's Daily and Docs rows are the kind filters, as drawn; a folder keeps the kind it is on.
  // The folder is written to the tab's section in place (t277: Back from a record returns to it, and folder
  // picks push no history, so Back never steps through folders).
  const pickRail = (next: { kind?: NoteKindFilter; folder?: string }) => {
    if (next.kind !== undefined) setKind(next.kind);
    const f = next.folder ?? '';
    setFolder(f);
    setActive(0);
    setWorkspace((ws) => setTabSection(ws, tab.id, `folder:${f}`, false));
  };
  const clearFilters = () => { setKind('all'); setFolder(''); setProject(''); setQuery(''); setWorkspace((ws) => setTabSection(ws, tab.id, 'folder:', false)); };
  // A rail folder's menus (8 Nov 2026): the same folder menu as the file tree, with Keep out of view.
  const folderMenuFor = (prefix: string) =>
    fileMenu(prefix, {
      isFolder: true,
      onNewNote: () => void newNoteOfType('note', { folder: prefix }),
      onNewFolder: () => void A.newFolder(prefix),
      onNewCanvas: () => void A.newCanvas(prefix),
    });
  const folderMore = (prefix: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openMenu(e.currentTarget, folderMenuFor(prefix));
  };
  const folderContext = (prefix: string) => (e: React.MouseEvent) => openMenu(e, folderMenuFor(prefix));
  const toggleShowAll = () => {
    // Hiding everything hides the Records chip too (t277): a Records view returns to All with it.
    if (showAll && kind === 'records') setKind('all');
    setShowAll((was) => {
      try {
        localStorage.setItem(SHOW_ALL_MEMORY, was ? '0' : '1');
      } catch {
        // Remembering is a convenience.
      }
      return !was;
    });
  };
  const changeSort = (s: NoteSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_MEMORY, s);
    } catch {
      // Remembering is a convenience.
    }
  };
  const orderWords = sort === 'name' ? 'by name' : 'newest first';

  // The ticked rows, acting together: each says what happened, and nothing is ever deleted for good.
  const tickAll = () => setSelected((s) => (s.length === shown.length ? [] : shown.map((r) => r.path)));
  const openTicked = () => {
    for (const p of selected) A.openPath(p, { where: 'tab' });
  };
  const pinTicked = () => {
    setPinned((pins) => {
      const out = [...pins];
      for (const p of selected) if (!out.includes(p)) out.push(p);
      return out;
    });
    toast(selected.length === 1 ? 'Pinned to the top of Notes.' : `${selected.length} notes pinned to the top of Notes.`);
  };
  const tagTicked = async () => {
    const tag = await prompt('Add a tag', { message: `To ${selected.length === 1 ? 'this note' : `these ${selected.length} notes`}, kept with their other tags.`, placeholder: 'a tag, without the hash', ok: 'Add the tag' });
    const name = tag === null ? null : cleanTag(tag);
    if (!name) return;
    let done = 0;
    for (const p of selected) {
      try {
        const text = await docs.readThrough(p);
        await docs.writeThrough(p, addTag(text, name), 'notes-bulk-tag');
        done++;
      } catch (err) {
        showError(err);
        break;
      }
    }
    if (done) toast(done === 1 ? `Tagged “${name}”.` : `${done} notes tagged “${name}”.`);
    setSelected([]);
  };
  const moveTicked = async () => {
    const foldersHere = [...new Set(getState().notes.map((n) => (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '')).filter(Boolean))].sort();
    const to = await pickFile(`Move ${selected.length === 1 ? 'this note' : `these ${selected.length} notes`} to which folder?`, foldersHere, (f) => f);
    if (!to) return;
    let done = 0;
    for (const p of selected) {
      const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
      if (p === `${to}/${name}`) { done++; continue; }
      if (await A.movePath(p, `${to}/${name}`)) done++;
    }
    if (done) toast(done === 1 ? `Moved to ${to}.` : `${done} notes moved to ${to}.`);
    setSelected([]);
  };
  const binTicked = async () => {
    const n = await A.trashPaths(selected);
    if (n) toast(n === 1 ? 'Moved to Recently deleted.' : `${n} notes moved to Recently deleted.`, { label: 'Open Recently deleted', run: () => A.openBin() });
    setSelected([]);
  };

  return (
    // The page scrolls in the frame's scroller, as BinView's does (p25 one column: the column's gutters match the
    // vscroll rooms' at every window, and a long list scrolls instead of running past the window's edge).
    <div className="nv-page-scroll">
    <div className="nv-page full w2b-list w2b-notes has-split" onKeyDown={onKey}>
      <PageHead
        icon="notes"
        title="Notes"
        // The head counts the rows on show (t271, 13 Nov 2026: the number tracks the chip the person
        // picks (All, Notes, Docs or Daily), as People's head counts its rows).
        count={shown.length}
        // One count (5 Nov 2026): the title count and the All chip already say how many; the lead says only
        // what changed today, and only when it is news (nothing on a fresh or unchanged vault).
        lead={todayCount ? `${plural(todayCount, 'note changed today', 'notes changed today')}.` : undefined}
        actions={
          <>
            {canEdit && <button type="button" className="button primary" onClick={() => void newNoteOfType(kind === 'docs' ? 'doc' : 'note')}><Icon name="plus" size={14} /> New {kind === 'docs' ? 'doc' : 'note'}</button>}
            <button
              type="button"
              className="iconbtn"
              aria-label="More for notes"
              title="More"
              onClick={(e) => openMenu(e.currentTarget, [
                { label: 'New note', icon: 'notes', disabled: !canEdit, run: () => void newNoteOfType('note') },
                { label: 'New doc', icon: 'doc', disabled: !canEdit, run: () => void newNoteOfType('doc') },
                { label: 'Open today’s note', icon: 'calendar', run: () => void A.openDaily() },
                // Start from a template (8.8): a reading list, a recipe book and the rest, each in its own folder.
                { label: 'Start from a template…', icon: 'template', disabled: !canEdit, run: () => openStarterPicker() },
                { separator: true },
                { label: 'Show as a table', icon: 'table', run: () => openTypePage('note', 'tab', { asTable: true }) },
              ])}
            >
              <Icon name="more" size={15} />
            </button>
          </>
        }
      />
      <div className="w2b-split">
        <nav ref={railRef} className={`w2b-folders${tallRail ? ' is-tall' : ''}`} aria-label="Folders">
          <div className="glabel">Folders</div>
          <button type="button" className={`frow${!folder && kind === 'all' ? ' on' : ''}`} aria-current={!folder && kind === 'all' ? 'true' : undefined} onClick={() => pickRail({ kind: 'all', folder: '' })}>
            <Icon name="notes" size={14} /> All notes{showCount(rows.length) ? <span className="n">{rows.length}</span> : null}
          </button>
          <button type="button" className={`frow${!folder && kind === 'daily' ? ' on' : ''}`} aria-current={!folder && kind === 'daily' ? 'true' : undefined} onClick={() => pickRail({ kind: 'daily', folder: '' })}>
            <Icon name="calendar" size={14} /> Daily{showCount(dailyCount) ? <span className="n">{dailyCount}</span> : null}
          </button>
          <button type="button" className={`frow${!folder && kind === 'docs' ? ' on' : ''}`} aria-current={!folder && kind === 'docs' ? 'true' : undefined} onClick={() => pickRail({ kind: 'docs', folder: '' })}>
            <Icon name="doc" size={14} /> Docs{showCount(docsCount) ? <span className="n">{docsCount}</span> : null}
          </button>
          {/* One quiet Show everything (5 Nov 2026, "your notes are yours", fewer folders): the packs' records
              and the app's own folders, hidden unless asked for. A vault with nothing hidden shows no row at all. */}
          {recordCount > 0 && (
            <button
              type="button"
              className={`frow w2b-showall${showAll ? ' on' : ''}`}
              aria-pressed={showAll}
              onClick={toggleShowAll}
              title={showAll ? 'Hide the packs’ records and the app’s own folders again' : 'Also show your packs’ records and the app’s own folders here. They live in their pack or folder, and search finds them.'}
            >
              <Icon name="eye" size={14} /> Show everything{showCount(recordCount) ? <span className="n">{recordCount}</span> : null}
            </button>
          )}
          {drawnFolders.map((f) => (
            <div key={f.prefix} data-fgroup={f.prefix}>
              <div className="frow-wrap">
                <button type="button" className={`frow${folder === f.prefix ? ' on' : ''}${isQuietPath(f.prefix, machinery) ? ' is-quiet' : ''}`} aria-current={folder === f.prefix ? 'true' : undefined} onClick={() => pickRail({ folder: f.prefix })} onContextMenu={folderContext(f.prefix)} title={isQuietPath(f.prefix, machinery) ? `${f.prefix} (kept out of view)` : f.prefix}>
                  <Icon name="folder" size={14} /> <span className="clip">{f.name}</span>{showCount(f.count) ? <span className="n">{f.count}</span> : null}
                </button>
                <button type="button" className="iconbtn frow-more" aria-label={`More for ${f.prefix}`} title="More" onClick={folderMore(f.prefix)}>
                  <Icon name="more" size={14} />
                </button>
              </div>
              {f.subs.map((s) => (
                <div key={s.prefix} className="frow-wrap">
                  <button type="button" className={`frow sub${folder === s.prefix ? ' on' : ''}${isQuietPath(s.prefix, machinery) ? ' is-quiet' : ''}`} aria-current={folder === s.prefix ? 'true' : undefined} onClick={() => pickRail({ folder: s.prefix })} onContextMenu={folderContext(s.prefix)} title={isQuietPath(s.prefix, machinery) ? `${s.prefix} (kept out of view)` : s.prefix}>
                    <span className="clip">{s.name}</span>{showCount(s.count) ? <span className="n">{s.count}</span> : null}
                  </button>
                  <button type="button" className="iconbtn frow-more" aria-label={`More for ${s.prefix}`} title="More" onClick={folderMore(s.prefix)}>
                    <Icon name="more" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {/* The rest, one row away (t190): shut, "N more folders" opens every folder in place; opened past
              what fits, "Fewer folders" folds back, offered only while the folder on show stays drawn. */}
          {shutRail && (
            <button type="button" className="frow w2b-morefolders" aria-expanded="false" onClick={() => setFoldersOpen(true)}>
              <Icon name="chevronDown" size={14} /> <span className="clip">{plural(folders.length - drawnFolders.length, 'more folder', 'more folders')}</span>
            </button>
          )}
          {tallRail && folderStaysDrawn && (
            <button type="button" className="frow w2b-morefolders" aria-expanded="true" onClick={() => setFoldersOpen(false)}>
              <Icon name="chevronUp" size={14} /> <span className="clip">Fewer folders</span>
            </button>
          )}
        </nav>
        <div className="w2b-main">
          <div className="chips" role="tablist" aria-label="Kind of note">
            {/* The chips stay All, Notes, Docs, Daily; records count under All and Notes counts notes only.
                While records are on show one quiet Records chip joins through the same mechanism (t277), so
                every row on show belongs to a chip. It stays drawn while picked, so Back never strands it. */}
            {NOTE_KIND_FILTERS.filter((f) => f.id !== 'records' || kind === 'records' || inFolder.some((r) => r.record)).map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={kind === f.id} className={`chip${kind === f.id ? ' on' : ''}`} onClick={() => { setKind(f.id); setActive(0); }}>
                {f.label}{showCount(kindCount(f.id)) ? <span className="n">{kindCount(f.id)}</span> : null}
              </button>
            ))}
            <span className="chip-group w2b-selects">
              {choices.length > 0 && (
                <select className="select w2b-project" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
                  <option value="">All projects</option>
                  {choices.map((c) => <option key={c.path} value={c.path}>{c.name} ({c.count})</option>)}
                </select>
              )}
              <select className="select w2b-sort" value={sort} onChange={(e) => changeSort(e.target.value as NoteSort)} aria-label="Order the notes" title="Order the notes">
                {NOTE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </span>
          </div>
          <ListFind id="notes" open always value={query} onChange={setQuery} match={match} inputRef={searchRef} hint="Press / to jump to the find" />
          {selected.length > 0 && (
            <div className="w2b-bulk" role="toolbar" aria-label={`${plural(selected.length, 'note', 'notes')} ticked`}>
              <span className="w2b-bulk-count">{selected.length} ticked</span>
              <button type="button" className="btn" onClick={openTicked}>Open</button>
              <button type="button" className="btn" disabled={!canEdit} onClick={() => void tagTicked()}>Tag</button>
              <button type="button" className="btn" disabled={!canEdit} onClick={() => void moveTicked()}>Move</button>
              <button type="button" className="btn" disabled={!canEdit} onClick={pinTicked}>Pin</button>
              <button type="button" className="btn danger-text" disabled={!canEdit} onClick={() => void binTicked()}>Bin</button>
              <button type="button" className="btn quiet" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}
          {/* A page's own list is a list, never a listbox (8.6: as a listbox this list read as a menu left open on every Notes page). */}
          <div className="w2b-list nj-list" role="list" aria-label={`Notes, ${orderWords}`}>
            {!rows.length ? (
              recordCount > 0 && !showAll ? (
                <EmptyState icon="notes" title="No notes yet" line={`Nothing you wrote yet. ${plural(recordCount, 'hidden note lives', 'hidden notes live')} under Show everything, and search finds them.`} action={{ label: 'Show everything', run: toggleShowAll }} />
              ) : (
                <EmptyState icon="notes" title="No notes yet" line="Write something down and it shows here, newest first." action={canEdit ? { label: 'New note', icon: 'plus', run: () => void newNoteOfType('note') } : undefined} />
              )
            ) : !shown.length ? (
              <EmptyState icon="search" title="Nothing matches" line="No note here matches that folder, kind, project and words together." action={{ label: 'Clear the filters', run: clearFilters }} />
            ) : (
              // The note the pointer or the keys are on, beside the list on a wide window (components/ListDetail.tsx).
              <ListDetail
                rows={flat.length}

                label="The note chosen"
                detail={flat[active] ? <RecordDetail refTo={{ path: flat[active].path }} onOpen={(tab) => open(flat[active], tab)} /> : null}
                list={
              <div className="card w2b-card">
                <div className="w2b-tickall">
                  <button type="button" className="btn quiet" onClick={tickAll}>{selected.length === shown.length ? 'Untick all' : 'Tick all'}</button>
                </div>
                {groups.map((g) => (
                  <section key={g.id} aria-label={g.label}>
                    <div className="glabel w2b-group">{g.label}</div>
                    {g.rows.map((r) => {
                      const at = positions.get(r.path) ?? 0;
                      const pin = isPinned(pinned, r.path);
                      // The snippet and the date title once per row (t102, 9 Nov 2026): eighty rows read them
                      // three and one times over, the date building its formatter on every call.
                      const snip = snippetForDisplay(r.snippet, r.project?.name);
                      return (
                        <div key={r.path} className={`w2b-rowwrap${at === active ? ' is-active' : ''}`}>
                          <input
                            type="checkbox"
                            className="w2b-tick"
                            checked={selected.includes(r.path)}
                            onChange={() => setSelected((s) => toggleSelected(s, r.path))}
                            aria-label={`Tick ${r.displayTitle ?? r.label ?? r.title}`}
                            title="Tick to act on it with others"
                          />
                          <button type="button" role="listitem" aria-current={at === active ? true : undefined} className={`trow w2b-row${at === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(at)} onClick={(e) => open(r, e.ctrlKey || e.metaKey)} onDoubleClick={() => open(r, true)}>
                            <span className={`gtile xs ${r.kind === 'doc' ? 'blue' : 'slate'}`} aria-hidden="true"><Icon name={r.kind === 'doc' ? 'doc' : r.kind === 'daily' ? 'calendar' : 'notes'} size={13} /></span>
                            <span className="w2b-row-main">
                              <span className="t clip" title={r.displayTitle ?? r.label ?? r.title}>{r.displayTitle ?? r.label ?? r.title}</span>
                              <span className="meta w2b-row-line2 nj-row-line2">
                                {(r.project || r.area) && <span className="minichip slate nj-chip" title={r.project?.name ?? r.area}>{r.project?.name ?? r.area}</span>}
                                {/* A record's kind wears its pack's colour (t277); notes, docs and dailies read plain as ever. */}
                                {r.kindColor ? <span className={`minichip nj-chip nt-${r.kindColor} w2b-kind`} title={r.kindLabel}>{r.kindLabel}</span> : <span>{r.kindLabel}</span>}
                                {showAll && isQuietPath(r.path, machinery) && <span className="minichip slate nj-chip" title="Kept out of view. Bring it back from its folder menu.">Out of view</span>}
                                {snip && <span className="clip" title={snip}>{snip}</span>}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`iconbtn w2b-pin${pin ? ' on' : ''}`}
                            aria-pressed={pin}
                            aria-label={pin ? `Unpin ${r.displayTitle ?? r.label ?? r.title}` : `Pin ${r.displayTitle ?? r.label ?? r.title} to the top`}
                            title={pin ? 'Unpin from the top' : 'Pin to the top'}
                            onClick={() => setPinned((p) => togglePinned(p, r.path))}
                          >
                            <Icon name="pin" size={13} />
                          </button>
                          {/* The date ends the row, past the pin, at the divider (p25 one column). It opens the
                              note, as the row does; the row button stays the keyboard control. */}
                          <span className="meta w2b-when" onClick={(e) => open(r, e.ctrlKey || e.metaKey)} onMouseEnter={() => setActive(at)} title={whenTitle(r.mtime)}>{shortWhen(r.mtime)}</span>
                        </div>
                      );
                    })}
                  </section>
                ))}
                {flatAll.length > flat.length && (
                  <div className="w2b-more">
                    <button type="button" className="btn quiet" onClick={() => setShownCount((n) => n + 80)}>
                      Show more ({flatAll.length - flat.length} left)
                    </button>
                  </div>
                )}
              </div>
                }
              />
            )}
          </div>
          <p className="vsub w2b-keys" aria-hidden="true">Up and down to move. Enter to open. / to search.</p>
        </div>
      </div>
    </div>
    </div>
  );
}
