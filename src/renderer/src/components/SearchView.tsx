// One search for notes, tasks, projects, people, meetings and files (8.7 w2c, 30 Oct 2026): the mock-up's centred
// window (components/SearchModal.tsx) and the left panel (panels/SearchPanel.tsx) are the same search here. A big input
// with the query language that was always there (words, "exact phrases", /patterns/, -leave out, OR, (groups), file:,
// path:, tag:, line:, section:, task:, content:, [property:value], match capitals under Title), a filter strip (sort,
// title, person, project, date; kind and the rest under More), the helper's answer with its sources at the top, then
// best matches as one list: title, path, and a two-line preview with the match marked. Commands match too (Enter opens
// the first result). Nothing the old panel could do is lost: areas, the Library toggle, collapse, bookmarking, project
// files, and the operators list.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSource, SearchHit } from '../../../shared/types';
import { citeAnswer, clearNarrower, countByKind, filterHits, flattenSearchNav, KIND_LABEL, KIND_ORDER, kindOfHit, metaForSearch, moveSearchNav, NO_FILTERS, peopleInHits, projectsInHits, searchNarrowers, shortDate, type DateRange, type SearchFilters, type SearchKind } from '../../../shared/search-ask-87';
import { plainLine, windowSnippet } from '../../../shared/snippet';
import { plural } from '../../../shared/words';
import { FileIndexLine } from '../components/FileHits';
import { Icon, fileIcon, type IconName } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { PageEmpty, PageError, PageLoading, Skel } from './PageStates';
import { renderMarkdown, wikilinkFromClick } from '../lib/markdownRender';
import { errorMessage } from '../lib/errors';
import * as A from '../state/actions';
import { addBookmark } from '../state/bookmarks';
import { askInChat } from '../state/chat';
import { rememberSearch } from '../state/commands';
import { useSearchRequest } from '../state/modals';
import { useApp } from '../state/store';
import { hotkeyOf, listedCommands, runCommand } from '../state/commands';
import { typeOfPath } from '../state/noteTypes';
import { wanted } from '../../../shared/areas';
import { areaPlaces, quietPath, setPick, useAreas, usePick } from '../state/areas';
import { showFileHit, useFileHits, useFileIndexStatus } from '../state/fileSearch';
import { meaningProgressWords, useMeaningStatus } from '../state/meaningSearch';
import { openOcrHit, useOcrHits } from '../state/ocr';
import { mediaFoundWords } from '../../../shared/ocr';
import { isDocPath } from '../lib/docPath';
import { tableKindOfPath } from '../../../shared/system-tables';
import { isBillsTablePath } from '../../../shared/bills-table';
import { workCall } from '../state/workModules';
import { docChain, type DocNode } from '../../../shared/doc-versions';
import { fileChainNodes, noteChainNodes } from '../lib/docNodes';
import '../styles/search-ask-87.css';

/** A chain path compared (doc-versions' own norm, kept beside it: backslashes, ./ and .md aside, no case). */
const chainKey = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();

/** Version chains stay one document in search (t248, 12 Nov 2026, look N5): a "...v2" file never lists beside
 *  its original as a separate document. A hit whose chain head is also among the hits reads once, as its
 *  latest; a hit whose latest is not among them stays, so its words stay findable. */
function foldVersionHits<T>(items: T[], lookupOf: (t: T) => string, pool: Set<string>, nodesFor: (t: T) => DocNode[]): T[] {
  if (pool.size < 2) return items;
  return items.filter((t) => {
    const nodes = nodesFor(t);
    const chain = docChain(nodes, lookupOf(t));
    if (chain.latest) return true;
    let head: DocNode | null | undefined = chain.newer;
    for (let guard = 0; head && guard < 12; guard++) {
      const next = docChain(nodes, head.path);
      if (!next.newer) break;
      head = next.newer;
    }
    if (!head) return true;
    // The head read as a hit of its own kind: a file's head in its project, a note's head anywhere.
    return !pool.has(head.project ? `f:${head.project}::${chainKey(head.path)}` : `n:${chainKey(head.path)}`);
  });
}

/** A Systems list hit opens its matching rows beside it (records as data, 5 Nov 2026): a record keeps its own result. */
function rowRanges(text: string, query: string): [number, number][] {
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const word of query.toLowerCase().split(/\s+/).filter((w) => w.length > 1)) {
    let at = 0;
    for (let guard = 0; guard < 8; guard++) {
      const i = lower.indexOf(word, at);
      if (i < 0) break;
      ranges.push([i, i + word.length]);
      at = i + word.length;
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]).slice(0, 8);
}

type Sort = 'relevance' | 'name' | 'modified';

const OPERATORS: [string, string][] = [
  ['file:', 'in the note’s name'],
  ['path:', 'in its folder and name'],
  ['tag:#idea', 'with the tag (and its sub-tags)'],
  ['line:(a b)', 'both words on one line'],
  ['section:(a b)', 'both words under one heading'],
  ['task:word', 'in a tick-box line'],
  ['task-todo:', 'in a tick-box not ticked'],
  ['task-done:', 'in a ticked tick-box'],
  ['[status:draft]', 'a property and its value'],
  ['"exact words"', 'the words together'],
  ['-word', 'leave out notes with it'],
  ['a OR b', 'either one'],
  ['/\\d{4}/', 'words matching a pattern, like a four-digit year'],
  ['match-case:', 'capitals must match'],
];

const KIND_ICON: Record<SearchKind, IconName> = { projects: 'briefcase', people: 'people', meetings: 'calendar', tasks: 'task', notes: 'notes' };
const SORT_WORDS: Record<Sort, string> = { relevance: 'Best match', name: 'Name', modified: 'Changed lately' };
const DATE_WORDS: Record<DateRange, string> = { any: 'Any time', today: 'Today', week: 'This week', month: 'This month' };
/** How many note rows draw at once (5 Nov 2026, v5-vault-speed): the 200-row list mounts in chunks. */
const SEARCH_SHOW = 60;

/** A result's bare count, said in words on hover and to a reader (t200, 10 Nov 2026, judged on real long
    notes: a bare "15" reads as a log line). Notes say note, files and media say file. */
const matchWords = (n: number, where: 'note' | 'file') => `${plural(n, 'match', 'matches')} in this ${where}`;

/** A matching line: Markdown marks hidden (src/shared/snippet.ts), cut down around the first match so the marked
 *  words stay visible in the narrow row, the matched words bolded navy like the mock-up. The panel's rows show
 *  about half the window's width, so they take a shorter window with the match nearer the start. */
export function Snippet({ text: raw, ranges: rawRanges, host }: { text: string; ranges: [number, number][]; host?: 'modal' | 'panel' }) {
  const plain = plainLine(raw, rawRanges);
  const { text, ranges } = host === 'panel' ? windowSnippet(plain.text, plain.ranges, 44, 14) : windowSnippet(plain.text, plain.ranges);
  const parts: (string | { mark: string })[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) parts.push(text.slice(at, a));
    parts.push({ mark: text.slice(a, b) });
    at = b;
  }
  parts.push(text.slice(at));
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <b key={i}>{p.mark}</b>))}
    </>
  );
}

/** One dropdown in the filter strip. */
function FilterBtn({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void }) {
  return (
    <button type="button" className={`sas-f${on ? ' on' : ''}`} title={on ? `${title}: ${label}` : title} onClick={onClick}>
      <span className="clip">{label}</span> <Icon name="chevronDown" size={12} />
    </button>
  );
}

/** The helper's answer to the words, with numbered chips on its links and its sources under it. */
function Answer({ text, sources, onOpen }: { text: string; sources: ChatSource[]; onOpen(path: string, newTab: boolean): void }) {
  const notes = useApp((s) => s.notes);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the notes decide which links are found
  const html = useMemo(() => citeAnswer(renderMarkdown(text, {}), sources.map((s) => s.title)), [text, sources, notes]);
  return (
    <div className="aians">
      <div className="glabel" style={{ marginBottom: 6 }}>
        Answer{sources.length ? ` · from ${sources.length} ${sources.length === 1 ? 'note' : 'notes'}` : ''}
      </div>
      <div
        className="markdown sas-answer"
        onClick={(e) => {
          const target = wikilinkFromClick(e);
          if (target !== null) {
            e.preventDefault();
            void A.openLink(target, '', e.ctrlKey || e.metaKey ? 'tab' : 'current').then(() => onOpen('', false));
          }
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {sources.length > 0 && (
        <>
          <div className="glabel" style={{ margin: '12px 0 4px' }}>
            Sources · {sources.length}
          </div>
          {sources.map((s) => (
            <button key={s.path} className="srcrow sas-src" onClick={(e) => onOpen(s.path, e.ctrlKey || e.metaKey)} title={s.path}>
              <span className="gtile xs slate">
                <Icon name={fileIcon(s.path)} size={13} />
              </span>
              <span className="clip">{s.title}</span>
              <span className="n clip">
                {s.path.includes('/') ? `· ${s.path.slice(0, s.path.lastIndexOf('/'))}` : ''}
                {s.section ? ` · ${s.section}` : ''}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/** Meaning search's quiet line (the files line's look, its own words): progress while it builds, one plain line when off. */
function MeaningLine() {
  const s = useMeaningStatus();
  const words = meaningProgressWords(s);
  if (!words) return null;
  const share = s && s.todo ? Math.min(100, Math.round((Math.min(s.done, s.todo) / s.todo) * 100)) : 0;
  return (
    <div className="fh-progress in-search" role="status" aria-live="polite">
      <span className="fh-progress-words">{words}</span>
      {s?.mode === 'starting' && s.todo > 0 && (
        <span className="fh-progress-bar" aria-hidden="true">
          <i style={{ width: `${share}%` }} />
        </span>
      )}
    </div>
  );
}

export function SearchView({ host, initialQuery = '', active, autoFocus, onOpenResult }: { host: 'modal' | 'panel'; initialQuery?: string; active: boolean; autoFocus: boolean; onOpenResult(): void }) {
  const revision = useApp((s) => s.revision);
  const aiReady = useApp((s) => !!s.settings?.ai.ready);
  const noteCount = useApp((s) => s.notes.length);
  const [query, setQuery] = useState(initialQuery);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [rawHits, setHits] = useState<SearchHit[]>([]);
  // The shared loading and error states (8.7 wave 2 round 3, the search-loading and search-error mock-ups; w4b round
  // 4 joined them onto the one search window): rows in their shape while the index answers, and another try when not.
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  // By area of life (Wave 4): the areas chosen, and the Library (templates, references) only when asked for.
  const areas = useAreas();
  const pick = usePick('search');
  const byPath = useApp((s) => s.byPath);
  const metaOf = (hit: SearchHit) => metaForSearch(hit.path, hit.title, typeOfPath(hit.path)?.id, byPath.get(hit.path)?.props);
  const [libraryToo, setLibraryToo] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const hits = useMemo(
    () => filterHits(rawHits.filter((h) => wanted({ path: h.path, props: byPath.get(h.path)?.props }, areas ? pick : 'all', areas?.areas ?? [], areaPlaces(), libraryToo)), metaOf, (p) => typeOfPath(p)?.id, filters, Date.now(), query),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metaOf reads the notes beside the hits
    [rawHits, areas, pick, byPath, libraryToo, filters, query],
  );
  const leftOut = libraryToo ? 0 : rawHits.filter((h) => quietPath(h.path)).length;
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort>('relevance');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useSearchRequest();
  // Inside the documents in projects' folders too (Settings › Search).
  const fileQuery = caseSensitive ? `match-case:(${query.trim()})` : query.trim();
  const { hits: fileHits, busy: filesBusy } = useFileHits(fileQuery, { limit: 80 });
  useFileIndexStatus();
  // Meaning search's build (asked again as embeddings land, and when the build finishes).
  const meaning = useMeaningStatus();
  const meaningRound = meaning ? `${meaning.mode}:${meaning.embedded}:${meaning.busy ? Math.floor(meaning.done / 25) : ''}` : '';
  // Words read in pictures and scans among the notes (Settings › General › Read words in pictures and scans).
  const { hits: ocrHits, busy: ocrBusy } = useOcrHits(fileQuery, { limit: 12 });
  const [picsShut, setPicsShut] = useState(false);
  const [filesShut, setFilesShut] = useState(false);
  const [allFiles, setAllFiles] = useState(false);
  useEffect(() => setAllFiles(false), [query]);
  // Version chains stay one document (foldVersionHits): the file entries' nodes, read once per vault change.
  const vaultRevision = useApp((s) => s.revision);
  const [fileNodes, setFileNodes] = useState<DocNode[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fileChainNodes().then((n) => alive && setFileNodes(n));
    return () => {
      alive = false;
    };
  }, [vaultRevision]);
  const versionPool = useMemo(() => {
    const pool = new Set<string>();
    for (const h of hits) pool.add(`n:${chainKey(h.path)}`);
    for (const h of fileHits) pool.add(`f:${h.project}::${chainKey(h.rel)}`);
    return pool;
  }, [hits, fileHits]);
  const versionNodes = (project?: string): DocNode[] => {
    const notes = noteChainNodes();
    const files = fileNodes ?? [];
    return project ? [...notes, ...files.filter((n) => !n.project || n.project === project)] : [...notes, ...files];
  };
  const foldedHits = useMemo(() => foldVersionHits(hits, (h) => h.path, versionPool, () => versionNodes()), [hits, versionPool]); // eslint-disable-line react-hooks/exhaustive-deps -- the cached nodes turn with the revision
  const fileSorted = useMemo(() => {
    const list = filters.kind === 'all' || filters.kind === 'files' ? [...fileHits] : [];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'modified') list.sort((a, b) => b.modified - a.modified);
    return foldVersionHits(list, (h) => h.rel, versionPool, (h) => versionNodes(h.project));
  }, [fileHits, sort, filters.kind, versionPool]); // eslint-disable-line react-hooks/exhaustive-deps -- the cached nodes turn with the revision
  const filesShown = allFiles ? fileSorted : fileSorted.slice(0, 12);

  // The last search back in the box, selected (9.0 w123ocr round 2: it used to land after the opening select, so the
  // next words typed appended to stale ones — "totalrepairs" — and found nothing).
  useEffect(() => {
    void window.nv.state.load<{ query?: string }>('search').then(
      (s) =>
        s?.query &&
        setQuery((q) => {
          if (q) return q;
          requestAnimationFrame(() => input.current?.select());
          return s.query!;
        }),
    );
  }, []);

  useEffect(() => {
    if (!request) return;
    if (request.query) setQuery(request.query);
    requestAnimationFrame(() => {
      input.current?.focus();
      if (!request.query) input.current?.select();
    });
  }, [request]);

  useEffect(() => {
    const q = query.trim();
    rememberSearch(q);
    if (!q) {
      setHits([]);
      setFailed('');
      return;
    }
    let alive = true;
    setBusy(true);
    setFailed('');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await window.nv.index.search(caseSensitive ? `match-case:(${q})` : q);
          if (!alive) return;
          // Plain words that hit a Systems list gain the matching rows as their own results (each opens its record).
          if (!/["[\]():/-]/.test(q)) {
            const tables = r.filter((h) => tableKindOfPath(h.path));
            if (tables.length) {
              const rows = await workCall<{ kind: string; name: string; path: string; words: string }[]>('systems', 'search-rows', q).catch((): { kind: string; name: string; path: string; words: string }[] => []);
              if (rows.length && alive) {
                const out: SearchHit[] = [];
                for (const h of r) {
                  out.push(h);
                  for (const row of rows.filter((x) => x.path.startsWith(`${h.path}#`))) {
                    const text = `${row.name} · ${row.words}`;
                    out.push({ path: row.path, title: row.name, score: h.score - 0.001, snippets: [{ line: 0, text, ranges: rowRanges(text, q) }], matches: 1, mtime: h.mtime });
                  }
                }
                setHits(out);
                return;
              }
            }
            // Plain words that hit the Bills list gain the matching rows as their own results (each opens its bill).
            const bills = r.filter((h) => isBillsTablePath(h.path));
            if (bills.length) {
              const rows = await window.nv.recmod.billsSearch(q).catch((): { name: string; path: string; words: string }[] => []);
              if (rows.length && alive) {
                const out: SearchHit[] = [];
                for (const h of r) {
                  out.push(h);
                  for (const row of rows.filter((x) => x.path.startsWith(`${h.path}#`))) {
                    const text = `${row.name} · ${row.words}`;
                    out.push({ path: row.path, title: row.name, score: h.score - 0.001, snippets: [{ line: 0, text, ranges: rowRanges(text, q) }], matches: 1, mtime: h.mtime });
                  }
                }
                setHits(out);
                return;
              }
            }
          }
          if (alive) setHits(r);
        } catch (e) {
          if (alive) setFailed(errorMessage(e));
        } finally {
          if (alive) setBusy(false);
        }
      })();
      void window.nv.state.save('search', { query: q }).catch(() => {});
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meaningRound re-asks as the embeddings land
  }, [query, caseSensitive, revision, attempt, meaningRound]);

  // The answer at the top (the helper's real model, asked a moment after the words settle): cancelled when the words
  // change, quiet when there is no model or no answer.
  const [answer, setAnswer] = useState<{ text: string; sources: ChatSource[] } | null>(null);
  const [answering, setAnswering] = useState(false);
  const answerFor = useRef('');
  useEffect(() => {
    const q = query.trim();
    if (!active || !aiReady || q.length < 2) {
      answerFor.current = '';
      setAnswer(null);
      setAnswering(false);
      return;
    }
    if (answerFor.current === q) return;
    setAnswering(true);
    setAnswer(null);
    let alive = true;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      void window.nv.ai.chat(id, [{ role: 'user', content: q }], { scope: 'all' })
        .then((r) => {
          if (!alive) return;
          answerFor.current = q;
          setAnswering(false);
          if (r.text && !r.error) setAnswer({ text: r.text, sources: r.sources ?? [] });
        })
        .catch(() => alive && setAnswering(false));
    }, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
      void window.nv.ai.cancel(id).catch(() => {});
    };
  }, [query, active, aiReady]);

  const sorted = useMemo(() => {
    const list = filters.kind === 'files' ? [] : [...foldedHits];
    if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'modified') list.sort((a, b) => b.mtime - a.mtime);
    return list;
  }, [foldedHits, sort, filters.kind]);

  const counts = useMemo(() => countByKind(foldedHits, (p) => typeOfPath(p)?.id), [foldedHits]);
  const people = useMemo(() => peopleInHits(foldedHits, metaOf), [foldedHits]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useMemo(() => projectsInHits(foldedHits, metaOf), [foldedHits]); // eslint-disable-line react-hooks/exhaustive-deps
  // The narrowers in force, in plain words above the results (10.0 papercuts); and whether word and meaning hits mix.
  const narrowers = useMemo(() => searchNarrowers(filters, caseSensitive), [filters, caseSensitive]);
  const anyMeaning = useMemo(() => sorted.some((h) => h.meaning), [sorted]);
  const anyWords = useMemo(() => sorted.some((h) => !h.meaning), [sorted]);
  const isCollapsed = (p: string) => (allCollapsed ? !collapsed.has(p) : collapsed.has(p));

  // One box for everything: commands whose names fit the words (under All kinds), then the note hits as one Best
  // matches list (the mock-up's flat list, not kind groups). Enter opens the first result.
  const commandHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || filters.kind !== 'all') return [];
    const words = q.split(/\s+/);
    // Aliases stay out (8 Nov 2026, the quiet More): the survivor is found once.
    return listedCommands().filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 6);
  }, [query, filters.kind]);
  const openFirst = () => {
    // The one Enter target (9.2 uplift F11): a command named exactly wins over notes; else the first result.
    const exact = commandHits.find((c) => c.name.toLowerCase() === query.trim().toLowerCase());
    if (exact) {
      onOpenResult();
      runCommand(exact.id);
    } else if (sorted[0]) {
      A.openPath(sorted[0].path);
      onOpenResult();
    } else if (fileSorted[0]) {
      showFileHit(fileSorted[0], fileSorted, query);
      onOpenResult();
    } else if (commandHits[0]) {
      onOpenResult();
      runCommand(commandHits[0].id);
    }
  };
  const openHit = (path: string, line?: number, newTab = false) => {
    if (!path) return onOpenResult();
    // Ctrl+click (Cmd on a Mac) opens beside the page, as the old panel did.
    A.openPath(path, line === undefined ? (newTab ? { where: 'tab' } : {}) : { line, where: newTab ? 'tab' : 'current' });
    onOpenResult();
  };

  // Walking the rows on the keyboard (5 Nov 2026, v5-vault-speed): arrows move through commands, notes,
  // files and pictures in the order drawn, wrapping past either end; Enter opens the arrowed row.
  const [arrow, setArrow] = useState(-1);
  const [shown, setShown] = useState(SEARCH_SHOW);
  const resultsRef = useRef<HTMLDivElement>(null);
  // New words, a new order or new notes start nowhere again, with the first chunk. Files and pictures
  // landing late for the same words never reset the keys: they join past the note rows, where the arrows are not.
  useEffect(() => {
    setArrow(-1);
    setShown(SEARCH_SHOW);
  }, [query, caseSensitive, filters, sort, revision, filesShut, picsShut, allFiles]);
  // Shut sections lend no rows to the keys: the arrows walk only what is drawn.
  const navFiles = filesShut ? [] : filesShown;
  const navPics = picsShut ? [] : ocrHits;
  const nav = useMemo(
    () =>
      flattenSearchNav(
        commandHits,
        sorted,
        navFiles.map((f) => ({ key: `${f.project}|${f.rel}` })),
        navPics.map((h) => ({ key: `${h.path}|${h.page ?? 0}` })),
      ),
    [commandHits, sorted, navFiles, navPics],
  );
  // The arrowed row stays drawn and in sight: rows past the chunk grow the list to meet the keys.
  // A list that shrank under the keys lets go of them.
  useEffect(() => {
    if (arrow >= nav.length) {
      if (arrow !== -1) setArrow(-1);
      return;
    }
    if (arrow < 0) return;
    const row = nav[arrow];
    if (row.kind === 'note') {
      const at = sorted.findIndex((h) => h.path === row.id);
      if (at >= shown) setShown(at + 1);
    }
    resultsRef.current?.querySelector(`[data-nav="${arrow}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [arrow, nav, sorted, shown]);
  const openActive = () => {
    const row = arrow >= 0 && arrow < nav.length ? nav[arrow] : null;
    if (!row) return openFirst();
    if (row.kind === 'command') {
      onOpenResult();
      runCommand(row.id);
    } else if (row.kind === 'note') {
      A.openPath(row.id);
      onOpenResult();
    } else if (row.kind === 'file') {
      const hit = filesShown.find((f) => `${f.project}|${f.rel}` === row.id);
      if (hit) showFileHit(hit, fileSorted, query);
      onOpenResult();
    } else {
      const hit = ocrHits.find((h) => `${h.path}|${h.page ?? 0}` === row.id);
      if (hit) openOcrHit(hit, query);
      onOpenResult();
    }
  };

  const kindWords = filters.kind === 'all' ? 'All kinds' : filters.kind === 'files' ? 'Files' : KIND_LABEL[filters.kind];

  return (
    <div className={`sas-host-${host}`}>
      <div className="sin">
        <Icon name="search" size={19} />
        <input
          ref={input}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes, tasks, projects, people, meetings and files…"
          spellCheck={false}
          aria-label="Search notes, tasks, projects, people, meetings and files"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (query) setQuery('');
              else onOpenResult();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setArrow((a) => moveSearchNav(nav.length, a, 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setArrow((a) => moveSearchNav(nav.length, a, -1));
            } else if (e.key === 'Home') {
              e.preventDefault();
              setArrow(nav.length ? 0 : -1);
            } else if (e.key === 'End') {
              e.preventDefault();
              setArrow(nav.length ? nav.length - 1 : -1);
            } else if (e.key === 'Enter') openActive();
          }}
        />
        {query && (
          <button className="iconbtn" title="Clear" aria-label="Clear the search" onClick={() => setQuery('')}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="filters" role="toolbar" aria-label="Search filters">
        <FilterBtn
          on={sort !== 'relevance'}
          label={sort === 'relevance' ? 'Sort' : SORT_WORDS[sort]}
          title="How the results are ordered"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Best match first', checked: sort === 'relevance', run: () => setSort('relevance') },
              { label: 'By name', checked: sort === 'name', run: () => setSort('name') },
              { label: 'Changed lately first', checked: sort === 'modified', run: () => setSort('modified') },
            ])
          }
        />
        <i className="pipe" />
        <FilterBtn
          on={filters.titlesOnly || caseSensitive}
          label={filters.titlesOnly ? 'Titles only' : 'Title'}
          title="Where the words must match"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Everywhere', checked: !filters.titlesOnly, run: () => setFilters((f) => ({ ...f, titlesOnly: false })) },
              { label: 'Titles only', checked: filters.titlesOnly, run: () => setFilters((f) => ({ ...f, titlesOnly: true })) },
              { separator: true },
              { label: 'Match capitals', checked: caseSensitive, run: () => setCaseSensitive((c) => !c) },
            ])
          }
        />
        <FilterBtn
          on={!!filters.person}
          label={filters.person || 'Person'}
          title="Only notes that name someone"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Everyone', checked: !filters.person, run: () => setFilters((f) => ({ ...f, person: '' })) },
              ...(people.length ? [{ separator: true } as const] : []),
              ...people.slice(0, 12).map((p) => ({ label: p.name, hint: String(p.count), checked: filters.person === p.name, run: () => setFilters((f) => ({ ...f, person: p.name })) })),
            ])
          }
        />
        <FilterBtn
          on={!!filters.project}
          label={filters.project || 'Project'}
          title="Only notes in a project"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Everywhere', checked: !filters.project, run: () => setFilters((f) => ({ ...f, project: '' })) },
              ...(projects.length ? [{ separator: true } as const] : []),
              ...projects.slice(0, 12).map((p) => ({ label: p.name, hint: String(p.count), checked: filters.project === p.name, run: () => setFilters((f) => ({ ...f, project: p.name })) })),
            ])
          }
        />
        <FilterBtn
          on={filters.date !== 'any'}
          label={filters.date === 'any' ? 'Date' : DATE_WORDS[filters.date]}
          title="Only notes changed lately"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Any time', checked: filters.date === 'any', run: () => setFilters((f) => ({ ...f, date: 'any' })) },
              { label: 'Today', checked: filters.date === 'today', run: () => setFilters((f) => ({ ...f, date: 'today' })) },
              { label: 'This week', checked: filters.date === 'week', run: () => setFilters((f) => ({ ...f, date: 'week' })) },
              { label: 'This month', checked: filters.date === 'month', run: () => setFilters((f) => ({ ...f, date: 'month' })) },
            ])
          }
        />
        <span className="sas-fsp" />
        <button
          type="button"
          className={`iconbtn sas-tool${filters.kind !== 'all' || help ? ' on' : ''}`}
          title={`More search tools (${kindWords})`}
          aria-label="More search tools"
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { heading: 'Only one kind' },
              { label: 'All kinds', hint: String(rawHits.length + fileHits.length), checked: filters.kind === 'all', run: () => setFilters((f) => ({ ...f, kind: 'all' })) },
              ...KIND_ORDER.map((kind) => ({ label: KIND_LABEL[kind], hint: String(counts[kind]), checked: filters.kind === kind, run: () => setFilters((f) => ({ ...f, kind })) })),
              { label: 'Files', hint: String(fileHits.length), checked: filters.kind === 'files', run: () => setFilters((f) => ({ ...f, kind: 'files' })) },
              { separator: true },
              { label: 'Bookmark this search', icon: 'bookmark' as const, disabled: !query.trim(), run: () => addBookmark({ type: 'search', query: query.trim() }) },
              { label: allCollapsed ? 'Show the matches' : 'Only the note names', run: () => { setAllCollapsed((c) => !c); setCollapsed(new Set()); } },
              { label: 'How to search', checked: help, run: () => setHelp((h) => !h) },
            ])
          }
        >
          <Icon name="more" size={15} />
        </button>
      </div>
      {(areas || leftOut > 0 || libraryToo) && query.trim() && (
        <div className="sas-areas">
          {areas && (
            <button
              type="button"
              className="chip sas-area-pick"
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { label: 'All areas', checked: pick === 'all', run: () => setPick('search', 'all') },
                  { separator: true },
                  ...areas.areas.filter((a) => !a.hidden).map((a) => ({ label: a.name, icon: a.icon as IconName, checked: pick !== 'all' && pick.includes(a.id), run: () => setPick('search', pick === 'all' ? [a.id] : pick.includes(a.id) ? (pick.filter((x) => x !== a.id).length ? pick.filter((x) => x !== a.id) : 'all') : [...pick, a.id]) })),
                  { label: 'Not in an area', checked: pick !== 'all' && pick.includes(''), run: () => setPick('search', pick === 'all' ? [''] : pick.includes('') ? 'all' : [...pick, '']) },
                ])
              }
            >
              {pick === 'all' ? 'All areas' : pick.map((id) => areas.areas.find((a) => a.id === id)?.name ?? 'Not in an area').join(', ')} <Icon name="chevronDown" size={12} />
            </button>
          )}
          {(leftOut > 0 || libraryToo) && (
            <button type="button" className={`chip${libraryToo ? ' on' : ''}`} onClick={() => setLibraryToo((v) => !v)} title="Templates and the Library’s references are kept out of search unless asked for">
              {libraryToo ? 'Leave out the Library' : `${leftOut} in the Library left out · show them`}
            </button>
          )}
        </div>
      )}
      {help && (
        <div className="sas-help">
          {OPERATORS.map(([op, words]) => (
            <button key={op} className="sas-help-row" onClick={() => { setQuery((q) => `${q}${q && !q.endsWith(' ') ? ' ' : ''}${op}`); input.current?.focus(); }}>
              <code>{op}</code>
              <span>{words}</span>
            </button>
          ))}
        </div>
      )}
      {query.trim() && narrowers.length > 0 && (
        <div className="chips sas-narrowers" aria-label="Narrowed to">
          {narrowers.map((n) => (
            <button key={n.id} type="button" className="chip on" title={`Stop narrowing: ${n.words}`} aria-label={`Stop narrowing: ${n.words}`} onClick={() => (n.id === 'capitals' ? setCaseSensitive(false) : setFilters((f) => clearNarrower(f, n.id)))}>
              {n.words} <Icon name="close" size={11} />
            </button>
          ))}
        </div>
      )}
      {answering && (
        <div className="aians sas-answering" aria-busy="true">
          <div className="glabel">Answer</div>
          <div className="skel" style={{ height: 14, marginTop: 10 }} />
          <div className="skel" style={{ height: 14, marginTop: 8, width: '70%' }} />
        </div>
      )}
      {answer && !answering && <Answer text={answer.text} sources={answer.sources} onOpen={(path, newTab) => openHit(path, undefined, newTab)} />}
      <div className="sres sas-results" ref={resultsRef}>
        {query.trim() ? (
          <>
            {/* No heading when there is nothing to list (9.0 w123ocr round 2: BEST MATCHES · 0 sat above the picture results); nothing at all says so once below. */}
            {(sorted.length > 0 || (busy && !hits.length && !fileHits.length)) && (
              <div className="glabel rlabel">
                {busy && !hits.length && !fileHits.length ? 'Searching…' : `Best matches · ${sorted.length}`}
              </div>
            )}
            {anyMeaning && anyWords && sorted.length > 0 && (
              <p className="vsub sas-mix">Matching words holds the words you typed; Similar meaning matches the idea, not the words.</p>
            )}
            {commandHits.length > 0 && (
              <section aria-label="Commands">
                <div className="glabel rlabel">Commands · {commandHits.length}</div>
                {commandHits.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    data-nav={i}
                    className={`prow2 sas-cmd${arrow === i ? ' hot' : ''}`}
                    onClick={() => {
                      onOpenResult();
                      runCommand(c.id);
                    }}
                  >
                    <span className="gtile xs slate">
                      <Icon name={c.icon ?? 'command'} size={13} />
                    </span>
                    <span className="clip">{c.name}</span>
                    {hotkeyOf(c) && <span className="k">{hotkeyOf(c)}</span>}
                  </button>
                ))}
              </section>
            )}
            {sorted.slice(0, shown).map((hit, i) => (
              <div key={hit.path} data-nav={commandHits.length + i} className={`srow2${arrow === commandHits.length + i ? ' hot' : ''}`}>
                <span className="gtile xs slate">
                  <Icon name={KIND_ICON[kindOfHit(hit, (p) => typeOfPath(p)?.id)]} size={13} />
                </span>
                <div className="sas-rowbody">
                  <button className="sas-rowhead" onClick={(e) => openHit(hit.path, undefined, e.ctrlKey || e.metaKey)} title={hit.title === hit.path ? hit.path : `${hit.title} · ${hit.path}`}>
                    <span className="t clip">
                      {hit.title}
                      {hit.meaning ? <span className="tag slate sas-meaning">Similar meaning</span> : anyMeaning ? <span className="tag slate sas-meaning">Matching words</span> : null}
                    </span>
                    <span className="p clip">
                      {isDocPath(hit.path) ? 'Doc · ' : ''}
                      {hit.path.includes('/') ? hit.path.slice(0, hit.path.lastIndexOf('/')) : 'Your notes'} · {shortDate(hit.mtime)}
                    </span>
                  </button>
                  {!isCollapsed(hit.path) &&
                    hit.snippets.slice(0, 2).map((s) => (
                      <button key={s.line} className="s sas-snippet clip" onClick={(e) => openHit(hit.path, s.line, e.ctrlKey || e.metaKey)} title={`${plainLine(s.text, s.ranges).text} (line ${s.line + 1})`}>
                        <Snippet text={s.text} ranges={s.ranges} host={host} />
                      </button>
                    ))}
                </div>
                {hit.matches > 0 && <span className="sas-count" title={matchWords(hit.matches, 'note')} aria-label={matchWords(hit.matches, 'note')}>{hit.matches}</span>}
                {hit.snippets.length > 0 && (
                  <button
                    className="sas-fold"
                    title={isCollapsed(hit.path) ? 'Show the matches' : 'Only the note name'}
                    aria-label={isCollapsed(hit.path) ? `Show matches in ${hit.title}` : `Hide matches in ${hit.title}`}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(hit.path)) next.delete(hit.path);
                        else next.add(hit.path);
                        return next;
                      })
                    }
                  >
                    <Icon name="chevron" size={11} className={`tree-chevron${isCollapsed(hit.path) ? '' : ' open'}`} />
                  </button>
                )}
              </div>
            ))}
            {shown < sorted.length && (
              <button className="btn quiet sas-more" onClick={() => setShown((s) => s + SEARCH_SHOW)}>
                Show more results ({sorted.length - shown} more)
              </button>
            )}
            {fileSorted.length > 0 && (
              <section aria-label="Files">
                <button className="glabel rlabel sas-groupbtn" aria-expanded={!filesShut} onClick={() => setFilesShut((v) => !v)}>
                  Files · {fileSorted.length}
                </button>
                {!filesShut && (
                  <>
                    {filesShown.map((h, j) => (
                      <div key={`${h.project}|${h.rel}`} data-nav={commandHits.length + sorted.length + j} className={`srow2${arrow === commandHits.length + sorted.length + j ? ' hot' : ''}`}>
                        <span className="gtile xs slate">
                          <Icon name={fileIcon(h.rel)} size={13} />
                        </span>
                        <div className="sas-rowbody">
                          <button
                            className="sas-rowhead"
                            onClick={(e) => {
                              showFileHit(h, fileSorted, query, e.ctrlKey || e.metaKey ? 'tab' : 'current');
                              onOpenResult();
                            }}
                            title={`${h.projectName} · ${h.rel}`}
                          >
                            <span className="t clip">{h.name}</span>
                            <span className="p clip">
                              {h.projectName}
                              {h.rel.includes('/') ? ` · ${h.rel.slice(0, h.rel.lastIndexOf('/'))}` : ''} · {shortDate(h.modified)}
                            </span>
                          </button>
                          {!allCollapsed &&
                            h.snippets.slice(0, 2).map((s, n) => (
                              <button
                                key={n}
                                className="s sas-snippet clip"
                                onClick={(e) => {
                                  showFileHit(h, fileSorted, query, e.ctrlKey || e.metaKey ? 'tab' : 'current');
                                  onOpenResult();
                                }}
                                title={s.where ?? h.name}
                              >
                                {s.where ? `${s.where} · ` : ''}
                                <Snippet text={s.text} ranges={s.ranges} host={host} />
                              </button>
                            ))}
                        </div>
                        {h.matches > 0 && <span className="sas-count" title={matchWords(h.matches, 'file')} aria-label={matchWords(h.matches, 'file')}>{h.matches}</span>}
                      </div>
                    ))}
                    {filesShown.length < fileSorted.length && (
                      <button className="btn quiet sas-more" onClick={() => setAllFiles(true)}>
                        Show all {fileSorted.length} files
                      </button>
                    )}
                  </>
                )}
              </section>
            )}
            {ocrHits.length > 0 && (
              <section aria-label="Pictures and scans">
                <button className="glabel rlabel sas-groupbtn" aria-expanded={!picsShut} onClick={() => setPicsShut((v) => !v)}>
                  Pictures and scans · {ocrHits.length}
                </button>
                {!picsShut &&
                  ocrHits.map((h, k) => (
                    <div key={`${h.path}|${h.page ?? 0}`} data-nav={commandHits.length + sorted.length + navFiles.length + k} className={`srow2${arrow === commandHits.length + sorted.length + navFiles.length + k ? ' hot' : ''}`}>
                      <span className="gtile xs slate">
                        <Icon name={fileIcon(h.path)} size={13} />
                      </span>
                      <div className="sas-rowbody">
                        <button
                          className="sas-rowhead"
                          onClick={() => {
                            openOcrHit(h, query);
                            onOpenResult();
                          }}
                          title={`${h.title} · ${mediaFoundWords(h.kind, h.page)} · ${h.path}`}
                        >
                          <span className="t clip">{h.title}</span>
                          <span className="p clip">
                            {mediaFoundWords(h.kind, h.page)}
                            {h.path.includes('/') ? ` · ${h.path.slice(0, h.path.lastIndexOf('/'))}` : ''} · {shortDate(h.mtime)}
                          </span>
                        </button>
                        {!allCollapsed &&
                          h.snippets.slice(0, 2).map((s) => (
                            <button
                              key={`${s.page ?? 0}:${s.line}`}
                              className="s sas-snippet clip"
                              onClick={() => {
                                openOcrHit(h, query);
                                onOpenResult();
                              }}
                              title={h.title}
                            >
                              <Snippet text={s.text} ranges={s.ranges} host={host} />
                            </button>
                          ))}
                      </div>
                      {h.matches > 0 && <span className="sas-count" title={matchWords(h.matches, 'file')} aria-label={matchWords(h.matches, 'file')}>{h.matches}</span>}
                    </div>
                  ))}
              </section>
            )}
            <MeaningLine />
            <FileIndexLine className="in-search" />
            {!failed && busy && !hits.length && !fileHits.length && !ocrHits.length && (
              <PageLoading label={`Searching ${noteCount === 1 ? '1 note' : `${noteCount.toLocaleString('en-AU')} notes`}…`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
                  {[['45%', '80%'], ['55%', '70%'], ['40%', '75%']].map(([w1, w2], i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <Skel w={26} h={26} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Skel w={w1} h={15} />
                        <div style={{ marginTop: 8 }}>
                          <Skel w={w2} h={13} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </PageLoading>
            )}
            {failed && !busy && (
              <PageError
                title="Search isn’t working right now"
                explainer={failed || "Your words are still there. Try again shortly."}
                retry={() => setAttempt((a) => a + 1)}
              />
            )}
            {!busy && !filesBusy && !ocrBusy && !failed && !hits.length && !fileHits.length && !ocrHits.length && !commandHits.length && (
              <PageEmpty
                icon="search"
                title={`Nothing matches “${query.trim()}”`}
                line="Check the spelling, or ask the vault to look wider."
                action={{ label: 'Ask instead', run: () => askInChat(query.trim()) }}
                quiet={{ label: 'Clear the search', run: () => setQuery('') }}
              />
            )}
          </>
        ) : (
          <div className="sas-intro">
            <p>Search notes, projects, people, meetings, tasks, files and commands. Enter opens the first result, arrows walk to another.</p>
            <p className="hint">Words can be in any order. The question mark above lists the ways to narrow it down.</p>
            <MeaningLine />
            <FileIndexLine />
          </div>
        )}
      </div>
    </div>
  );
}
