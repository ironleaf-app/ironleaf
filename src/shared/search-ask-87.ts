// The 8.7 search and Ask rules (30 Oct 2026): one search over notes, tasks, projects, people, meetings and files, with
// counts per kind and filters; the helper's answers with their sources. Pure, so tests/search-ask-87.test.mjs proves
// them without the window or a model.

import type { ChatChanges, SearchHit } from './types';

export type SearchKind = 'projects' | 'people' | 'meetings' | 'tasks' | 'notes';
export const KIND_ORDER: SearchKind[] = ['projects', 'people', 'meetings', 'tasks', 'notes'];
export const KIND_LABEL: Record<SearchKind, string> = { projects: 'Projects', people: 'People', meetings: 'Meetings', tasks: 'Tasks', notes: 'Notes' };

const TASK_LINE = /^\s*(?:[-*+]\s+)?\[[ xX]\]/;

/** What kind a note hit is: its note type first (project, person, meeting), then a tick-box match (a task), else a note. */
export function kindOfHit(hit: SearchHit, typeOf: (path: string) => string | undefined): SearchKind {
  const type = typeOf(hit.path);
  if (type === 'project') return 'projects';
  if (type === 'person') return 'people';
  if (type === 'meeting') return 'meetings';
  if (hit.snippets.some((s) => TASK_LINE.test(s.text))) return 'tasks';
  return 'notes';
}

/** How many hits of each kind (every kind present, even at zero, so the filter reads honestly). */
export function countByKind(hits: SearchHit[], typeOf: (path: string) => string | undefined): Record<SearchKind, number> {
  const counts: Record<SearchKind, number> = { projects: 0, people: 0, meetings: 0, tasks: 0, notes: 0 };
  for (const hit of hits) counts[kindOfHit(hit, typeOf)]++;
  return counts;
}

export type DateRange = 'any' | 'today' | 'week' | 'month';

/** Whether a note changed recently enough: today (its calendar day), this week or this month. */
export function inDateRange(mtime: number, range: DateRange, now = Date.now()): boolean {
  if (range === 'any') return true;
  if (range === 'today') {
    const day = (t: number) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    return day(mtime) === day(now);
  }
  const days = range === 'week' ? 7 : 30;
  return now - mtime <= days * 24 * 3600 * 1000;
}

export interface HitMeta {
  /** People named on the note (its owner, attendees, people, or its own folders and name). */
  people: string[];
  /** The project it belongs to (its project, its folder under Projects, or itself when it is one). */
  project?: string;
}

const asNames = (value: unknown): string[] => {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && !!v);
  return [];
};

/** What the Person and Project filters read on a hit: the note's people and project, plus its own place. */
export function metaForSearch(path: string, title: string, type: string | undefined, props: Record<string, unknown> | undefined): HitMeta {
  const people = [...asNames(props?.owner), ...asNames(props?.attendees), ...asNames(props?.people)];
  for (const part of path.split('/').slice(0, -1)) if (part && part !== 'Projects' && part !== 'People') people.push(part);
  // A project note filed directly under Projects/ (Shop.md) names its project without the ending.
  const under = /^Projects\/([^/]+)/.exec(path)?.[1]?.replace(/\.md$/i, '');
  const project = asNames(props?.project)[0] ?? under ?? (type === 'project' ? title : undefined);
  return { people, project };
}

export interface SearchFilters {
  /** 'files' shows only project files (no note kind ever equals it, so note hits fall away). */
  kind: SearchKind | 'files' | 'all';
  person: string;
  project: string;
  date: DateRange;
  /** Only hits whose title holds the query's words (the mock-up's Title filter, 8.7 w2c round 2). */
  titlesOnly: boolean;
}
export const NO_FILTERS: SearchFilters = { kind: 'all', person: '', project: '', date: 'any', titlesOnly: false };

/** One narrowing in plain words, as the chips row above the results reads it. */
export interface SearchNarrower {
  id: 'titles' | 'person' | 'project' | 'date' | 'kind' | 'capitals';
  words: string;
}

/** The narrowers in force, in plain words (none when the search is wide open). */
export function searchNarrowers(filters: SearchFilters, caseSensitive: boolean): SearchNarrower[] {
  const out: SearchNarrower[] = [];
  if (filters.titlesOnly) out.push({ id: 'titles', words: 'Titles only' });
  if (filters.person) out.push({ id: 'person', words: `About ${filters.person}` });
  if (filters.project) out.push({ id: 'project', words: `In ${filters.project}` });
  if (filters.date === 'today') out.push({ id: 'date', words: 'Changed today' });
  else if (filters.date === 'week') out.push({ id: 'date', words: 'Changed this week' });
  else if (filters.date === 'month') out.push({ id: 'date', words: 'Changed this month' });
  if (filters.kind === 'files') out.push({ id: 'kind', words: 'Files only' });
  else if (filters.kind !== 'all') out.push({ id: 'kind', words: `${KIND_LABEL[filters.kind]} only` });
  if (caseSensitive) out.push({ id: 'capitals', words: 'Match capitals' });
  return out;
}

/** A search with one narrowing cleared. */
export function clearNarrower(filters: SearchFilters, id: SearchNarrower['id']): SearchFilters {
  if (id === 'titles') return { ...filters, titlesOnly: false };
  if (id === 'person') return { ...filters, person: '' };
  if (id === 'project') return { ...filters, project: '' };
  if (id === 'date') return { ...filters, date: 'any' };
  if (id === 'kind') return { ...filters, kind: 'all' };
  return filters;
}

/** The query's plain words (operators, negations and field codes left out), for the Titles-only filter. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !/^[-+]/.test(w) && w !== 'or' && w !== 'and' && !w.startsWith('match-case:') && !/^[a-z-]+:/.test(w) && !/^\/.*\/$/.test(w) && !/^\[.*\]$/.test(w))
    .map((w) => w.replace(/["()]/g, ''))
    .filter((w) => w.length > 0);
}

/** The hits left after the filter strip: kind, person, project, date and titles-only, each exact but case-blind. */
export function filterHits(hits: SearchHit[], metaOf: (hit: SearchHit) => HitMeta, typeOf: (path: string) => string | undefined, filters: SearchFilters, now = Date.now(), query = ''): SearchHit[] {
  const words = filters.titlesOnly ? queryWords(query) : [];
  return hits.filter((hit) => {
    if (filters.kind !== 'all' && kindOfHit(hit, typeOf) !== filters.kind) return false;
    if (words.length && !words.every((w) => hit.title.toLowerCase().includes(w))) return false;
    const meta = metaOf(hit);
    if (filters.person && !meta.people.some((p) => p.toLowerCase() === filters.person.toLowerCase())) return false;
    if (filters.project && meta.project?.toLowerCase() !== filters.project.toLowerCase()) return false;
    if (!inDateRange(hit.mtime, filters.date, now)) return false;
    return true;
  });
}

/** People named across hits, most-named first, for the Person filter (each named once, with its count). */
export function peopleInHits(hits: SearchHit[], metaOf: (hit: SearchHit) => HitMeta): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const hit of hits) {
    for (const name of new Set(metaOf(hit).people)) {
      const key = name.toLowerCase();
      const have = counts.get(key);
      if (have) have.count++;
      else counts.set(key, { name, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Projects across hits, most-hit first, for the Project filter. */
export function projectsInHits(hits: SearchHit[], metaOf: (hit: SearchHit) => HitMeta): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const hit of hits) {
    const project = metaOf(hit).project;
    if (!project) continue;
    const have = counts.get(project.toLowerCase());
    if (have) have.count++;
    else counts.set(project.toLowerCase(), { name: project, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What an answer changed, in the card's words and the toast's ("Made 2 notes, changed 1 note"). Docs read as docs.
 *  A folder says its name and how many notes went with it, never "1 note". */
export function changeWords(c: ChatChanges): string {
  const items = [...new Set(c.paths)];
  const pages = items.filter((p) => /\.md$/i.test(p));
  const [one, many] = pages.length && pages.every((p) => /^Docs\//i.test(p)) ? ['doc', 'docs'] : ['note', 'notes'];
  const foldered = (folders: { title: string; notes: number }[], verb: string, tail: string): string => {
    if (folders.length === 1) {
      const f = folders[0];
      return `${verb} the folder “${f.title}”${f.notes ? ` with ${n(f.notes, 'note', 'notes')}` : ''}${tail}`;
    }
    return `${verb} ${n(folders.length, 'folder', 'folders')}${tail} (${folders.map((f) => `“${f.title}”${f.notes ? ` with ${n(f.notes, 'note', 'notes')}` : ''}`).join(', ')})`;
  };
  const parts = [
    c.projectsMade ? `set up ${n(c.projectsMade, 'project', 'projects')}` : '',
    c.projectsChanged ? `brought ${n(c.projectsChanged, 'project', 'projects')} up to date` : '',
    c.made ? `made ${n(c.made, one, many)}` : '',
    c.changed ? `changed ${n(c.changed, one, many)}` : '',
    c.moved ? `moved ${n(c.moved, one, many)}` : '',
    c.binned ? `moved ${n(c.binned, one, many)} to the Bin` : '',
    c.binnedFolders?.length ? foldered(c.binnedFolders, 'moved', ' to the Bin') : '',
    c.restoredFolders?.length ? foldered(c.restoredFolders, 'restored', '') : '',
    c.filesMade ? `made ${n(c.filesMade, 'file', 'files')}` : '',
    c.filesChanged ? `changed ${n(c.filesChanged, 'file', 'files')}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ').replace(/^./, (x) => x.toUpperCase()) : 'Changed the notes';
}

/**
 * A served call's `changed` list as card words (seams O7: the one change describer's list entry, shared with The
 * former host app through the catalogue module, so its change cards read word for word the same). Notes the call
 * made (`before` null) count as made, ones it changed as changed, through the same core as the count path (docs
 * read as docs). Moves, projects and project-folder files are not in a `changed` list, so they are never named
 * here. An empty list says nothing changed (the one input the count path can never see: no changes, no card).
 */
export function describeChangedList(changed: { path: string; before: string | null }[]): string {
  if (!changed.length) return 'Nothing changed';
  const seen = new Map<string, string | null>();
  for (const c of changed) if (!seen.has(c.path)) seen.set(c.path, c.before);
  const paths = [...seen.keys()];
  const made = [...seen.values()].filter((b) => b === null).length;
  return changeWords({ turnId: '', made, changed: paths.length - made, moved: 0, paths });
}

// The renderer's escaping (lib/markdownRender.ts esc), matched so cited titles are found in its links.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Numbered chips after the answer's links to its sources ([[titles]] the model wrote): the n-th source gets chip n.
 *  Links to anything else are left alone. */
export function citeAnswer(html: string, titles: string[]): string {
  const numbers = new Map(titles.map((t, i) => [t.toLowerCase(), i + 1]));
  return html.replace(/<a\b[^>]*\bdata-href="([^"]*)"[^>]*>.*?<\/a>/g, (link, href: string) => {
    const found = [...numbers].find(([t]) => esc(t) === String(href).toLowerCase() || t === String(href).toLowerCase());
    return found ? `${link}<i class="cite">${found[1]}</i>` : link;
  });
}

/** What the Ask bar suggests depends on where the person is: a project, a note, projects kept, or none yet. Short
 *  enough to read whole in a chip (8.7 w2c round 2: the mock-up's chips are never clipped mid-sentence). */
export const ASK_SETUP = 'Set up my projects from a folder…';
export function suggestQuestions({ title, type, hasProjects }: { title?: string; type?: string; hasProjects: boolean }): string[] {
  if (type === 'project' && title) return [`Where is “${title}” up to?`, 'What’s at risk here?', 'Catch this project up', 'Write a progress report'];
  if (title) return [`Summarise “${title}”`, 'What’s open here?', 'What’s still unanswered?', 'Link this note up'];
  if (hasProjects) return ['What needs my attention?', 'Due in the next two weeks?', 'Catch up all my projects', 'What have I decided lately?'];
  return [ASK_SETUP, 'What have I decided lately?', 'Tidy my notes into folders', 'Summarise my notes about…'];
}

/** A hit's date the short way ("12 Oct"), for palette and source rows. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(mtime: number): string {
  const d = new Date(mtime);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

// ── Walking the results on the keyboard (5 Nov 2026, v5-vault-speed) ────────────────────────────────
// One order for the keys, the order drawn top to bottom: commands, then notes, then project files, then
// pictures and scans. Pure, so the speed test proves the order without the window.

/** One row the arrows can land on: what it is and what opens it (a command's id, a note's path, a file or picture key). */
export interface SearchNavRow {
  kind: 'command' | 'note' | 'file' | 'pic';
  id: string;
}

/** The rows in the order drawn, so the arrows walk what the person sees. */
export function flattenSearchNav(commands: readonly { id: string }[], notes: readonly { path: string }[], files: readonly { key: string }[], pics: readonly { key: string }[]): SearchNavRow[] {
  return [...commands.map((c) => ({ kind: 'command' as const, id: c.id })), ...notes.map((n) => ({ kind: 'note' as const, id: n.path })), ...files.map((f) => ({ kind: 'file' as const, id: f.key })), ...pics.map((p) => ({ kind: 'pic' as const, id: p.key }))];
}

/** The next row after a step: one at a time, wrapping past either end; no rows is nowhere (-1). */
export function moveSearchNav(length: number, active: number, delta: 1 | -1): number {
  if (length <= 0) return -1;
  if (active < 0) return delta > 0 ? 0 : length - 1;
  return (active + delta + length) % length;
}
