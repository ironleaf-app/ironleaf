// One task, one row, on the main side (p13-one-task, 4 Nov 2026): a tick closes the task, not half of it. Ticking a
// step closes the matching open lines in its project's notes; ticking a note line closes its matching steps (and the
// matching lines in its project's other notes: twins are the same task too). Removing a step through the close dialog
// closes its lines the same way. Untick reopens what the tick closed. This only works out the writes — every caller
// writes through its own write (the project's history for project:edit, the note's own write for tasks:tick and
// hub:tick) — so one door's tick stays one change with one Undo. Reminders never cascade (a ⏰ line is said at its
// time), templates' and left-out notes' lines are never touched, and a cancelled ([-]) line is never reopened.

import type { VaultIndex } from './indexer';
import { isoOf, taskDue } from '../shared/hub';
import { isMeetingNote } from '../shared/meetings';
import { findMatchingLines, findMatchingSteps, isNearKey, isSameKey, lineKeyOf, openStepsOf, splitLineIdentity, stepKeyOf, stepKeysOf, type MatchStep, type StepKey } from '../shared/one-task';
import { inFolder } from '../shared/paths';
import { applyProjectEdit, isProjectProps, parseProject, serializeProject } from '../shared/project-file';
import type { Relations } from '../shared/relations';
import { setTicked } from '../shared/reminders';
import { isLive } from '../shared/today-count';
import { sourceKindOf, sourceOf, type TaskSource } from '../shared/unified-tasks';

/** One file the cascade rewrites: its path and its text before and after. */
export interface CascadeFile {
  path: string;
  before: string;
  after: string;
}

/** The project a note belongs to (its own file for a project): the relations' owner reading, as the Tasks view folds.
 *  `rels` is the relations read before the caller's write (a write drops them; re-deriving them mid-write from every
 *  note is what a tick cost on a big vault — p18-big-vault, 4 Nov 2026); without it, the index's as before. */
export function projectOfNote(index: VaultIndex, path: string, rels: Relations | null = null): string | null {
  if (isProjectProps(index.get(path)?.props)) return path;
  return (rels ?? index.relations()).owner.get(path) ?? null;
}

/** Every project's text, kept until the notes change (p18-big-vault's second sharing, 5 Nov 2026: the known
 *  people's People-table read had every project read again on each door, Today and Tasks each reading them twice
 *  over. The fold's steps and the known people both read from this one map now, so the projects are read once a
 *  generation however many doors ask). Callers read from the map, never into it. */
const keptContents = new WeakMap<VaultIndex, { generation: number; contents: Map<string, string> }>();
export function keptProjectContents(index: VaultIndex): Map<string, string> {
  const generation = index.generation();
  const kept = keptContents.get(index);
  if (kept && kept.generation === generation) return kept.contents;
  const contents = new Map<string, string>();
  for (const m of index.allMeta()) {
    if (!isProjectProps(m.props)) continue;
    contents.set(m.path, index.content(m.path) ?? '');
  }
  keptContents.set(index, { generation, contents });
  return contents;
}

/** Every project's open steps, each parsed once (callers hold the map for one fold or tick). */
export function openStepsByProject(index: VaultIndex): Map<string, MatchStep[]> {
  const out = new Map<string, MatchStep[]>();
  for (const [path, text] of keptProjectContents(index)) out.set(path, openStepsOf(text, path));
  return out;
}

/** Every project's open steps as match keys, kept until the notes change (p18-big-vault: Today and Tasks each parsed
 *  every project file on each read, and the rail's one fetch — Tasks, Today, Due — parsed them twice over; the map is
 *  one per index generation now, as the relations are). Callers read from the map, never into it. */
const keptMaps = new WeakMap<VaultIndex, { generation: number; keys: Map<string, StepKey[]> }>();
export function keptStepKeys(index: VaultIndex): Map<string, StepKey[]> {
  const generation = index.generation();
  const kept = keptMaps.get(index);
  if (kept && kept.generation === generation) return kept.keys;
  const keys = new Map<string, StepKey[]>();
  for (const [project, steps] of openStepsByProject(index)) keys.set(project, stepKeysOf(steps));
  keptMaps.set(index, { generation, keys });
  return keys;
}

/** Every project's liveness by its file's path, from the index's own reading (its status property, no text read):
 *  dormant (finished or shelved) projects count nowhere (5 Nov 2026, the plan one list). Only paths the index
 *  reads as projects land in it; anything else reads as live (never skipped on a guess). */
export function projectLive(index: VaultIndex): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const m of index.allMeta()) {
    if (!isProjectProps(m.props)) continue;
    const status = typeof m.props?.status === 'string' ? m.props.status : undefined;
    out.set(m.path, isLive(status));
  }
  return out;
}

/** Whether a note counts nowhere because the project it belongs to is dormant (finished or shelved): the project's
 *  own file too (its path is its project). Unknown projects read as live: nothing is skipped on a guess. */
export function isDormantOwned(owner: string | null | undefined, live: Map<string, boolean>): boolean {
  return !!owner && live.get(owner) === false;
}

/** Where a folded line was written, under the step it folds into: each open note line matched against its
 *  project's open steps (a note of no project against the live projects' open steps), exact or near (t249
 *  isNearKey) — the same rule as hub.readTasks' fold, so a source reads under exactly the row its line folds
 *  into. Keyed `project\nindex` (the step's What's next index). Templates' and left-out notes' lines never land
 *  here (never the person's work), quiet notes' only when due (as the fold reads them), dormant projects'
 *  nowhere. Kept per index generation and day, like the step keys. */
const keptSources = new WeakMap<VaultIndex, { generation: number; day: string; templates: string; sources: Map<string, TaskSource[]> }>();
export function keptStepSources(index: VaultIndex, templatesFolder = '', now: Date = new Date()): Map<string, TaskSource[]> {
  const ref = now instanceof Date ? now : new Date(now);
  const generation = index.generation();
  const day = isoOf(ref);
  const templates = templatesFolder || '';
  const kept = keptSources.get(index);
  if (kept && kept.generation === generation && kept.day === day && kept.templates === templates) return kept.sources;
  const steps = new Map<string, { index: number; key: StepKey }[]>();
  for (const [path, text] of keptProjectContents(index)) {
    let p;
    try {
      p = parseProject(text, path);
    } catch {
      continue;
    }
    const list: { index: number; key: StepKey }[] = [];
    p.next.forEach((n, i) => {
      if (!n.done) list.push({ index: i, key: stepKeyOf({ what: n.what, ...(n.who ? { who: n.who } : {}) }) });
    });
    steps.set(path, list);
  }
  const live = projectLive(index);
  const flat = (project: string | null): { project: string; index: number; key: StepKey }[] =>
    project ? (steps.get(project) ?? []).map((s) => ({ ...s, project })) : [...steps].filter(([p]) => live.get(p) !== false).flatMap(([p, ss]) => ss.map((s) => ({ ...s, project: p })));
  const owner = index.relations().owner;
  const out = new Map<string, TaskSource[]>();
  for (const note of index.tasks()) {
    if ((templates && inFolder(note.path, templates)) || index.isExcluded(note.path)) continue;
    const quiet = index.isQuiet(note.path);
    const meta = index.get(note.path);
    if (!meta || isProjectProps(meta.props)) continue;
    const type = typeof meta.props?.type === 'string' ? meta.props.type.toLowerCase().slice(0, 40) : undefined;
    const project = owner.get(note.path) ?? null;
    if (isDormantOwned(project, live)) continue;
    const cands = flat(project);
    if (!cands.length) continue;
    const title = meta.label || meta.title;
    const meeting = isMeetingNote(note.path, meta.props ?? {});
    for (const t of note.items) {
      if (quiet && !(t.due && t.due <= day)) continue;
      const words = taskDue(t.text, ref).words || t.text;
      const key = lineKeyOf(words, ref);
      if (!key) continue;
      const hits = cands.filter((s) => isSameKey(s.key, key) || isNearKey(s.key, key));
      if (!hits.length) continue;
      const source = sourceOf(sourceKindOf(note.path, project, meeting ? 'meeting' : type), note.path, title);
      for (const s of hits) {
        const k = `${s.project}\n${s.index}`;
        const arr = out.get(k) ?? [];
        if (!arr.some((x) => x.kind === source.kind && x.path === source.path)) arr.push(source);
        out.set(k, arr);
      }
    }
  }
  keptSources.set(index, { generation, day, templates, sources: out });
  return out;
}

/** A project edit's closed step, read before it lands (project:edit calls this per edit, in order, as each applies):
 *  a step removed while open (the close dialog's drop and move, a row delete), ticked done or reopened, or toggled.
 *  Anything else — adds, moves, words changed, a done step removed — closes nothing. Null: no step closes. */
export function closedStepOf(next: readonly { what: string; who?: string; done: boolean }[], edit: unknown): { step: MatchStep; done: boolean } | null {
  const ed = (edit && typeof edit === 'object' ? edit : {}) as Record<string, unknown>;
  const atIndex = typeof ed.index === 'number' ? next[ed.index] : undefined;
  if (!atIndex) return null;
  const step: MatchStep = { what: atIndex.what, ...(atIndex.who ? { who: atIndex.who } : {}) };
  const flip = ed.item && typeof ed.item === 'object' ? (ed.item as { done?: unknown }).done : undefined;
  if (ed.kind === 'remove' && ed.list === 'next' && !atIndex.done) return { step, done: true };
  if (ed.kind === 'change' && ed.list === 'next' && typeof flip === 'boolean' && atIndex.done !== flip) return { step, done: flip };
  if (ed.kind === 'next-toggle') return { step, done: !atIndex.done };
  return null;
}

/** A note's matching lines set to `done` (null: none, or the note is gone). The caller's own line is left to it. */
function linesSet(content: string | undefined, step: MatchStep, done: boolean, now: Date, skipLine?: number): string | null {
  if (content === undefined) return null;
  const hits = findMatchingLines(content, step, now, done).filter((h) => h.line !== skipLine);
  if (!hits.length) return null;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let changed = false;
  for (const h of hits) {
    const next = setTicked(lines[h.line] ?? '', done);
    if (next !== lines[h.line]) {
      lines[h.line] = next;
      changed = true;
    }
  }
  return changed ? lines.join(eol) : null;
}

/** Ticking a step (or removing it through the close dialog): the matching lines in its project's notes, set to `done`.
 *  `rels` is the relations read before the caller's write (projectOfNote above: the write drops them). */
export function cascadeForStep(index: VaultIndex, skip: (path: string) => boolean, project: string, step: MatchStep, done: boolean, now: Date = new Date(), rels: Relations | null = null): CascadeFile[] {
  const out: CascadeFile[] = [];
  for (const [note, own] of (rels ?? index.relations()).owner) {
    if (own !== project || skip(note)) continue;
    const before = index.content(note);
    const after = linesSet(before, step, done, now);
    if (before !== undefined && after !== null) out.push({ path: note, before, after });
  }
  return out;
}

/** Ticking a note line: its matching steps in its project, and the matching lines in its project's notes, set to
 *  `done`. The caller writes its own line first, so it never matches again; every twin of it cascades. No project, or
 *  the project gone: the line is only itself. A tick inside a template or left-out note never cascades out: templates
 *  are never work. `rels` is the relations read before the caller's write (projectOfNote above). */
export function cascadeForLine(
  index: VaultIndex,
  skip: (path: string) => boolean,
  at: { path: string; line: number },
  lineWords: string,
  done: boolean,
  now: Date = new Date(),
  rels: Relations | null = null,
): { project: CascadeFile | null; notes: CascadeFile[] } {
  const none = { project: null as CascadeFile | null, notes: [] as CascadeFile[] };
  if (skip(at.path)) return none;
  const project = projectOfNote(index, at.path, rels);
  if (!project) return none;
  const text = index.content(project);
  if (text === undefined) return none;
  let out = { ...none };
  // Its matching steps (a project file's own line already ticked is done, so it never matches again).
  const indexes = findMatchingSteps(text, lineWords, project, now, done);
  if (indexes.length) {
    const p = parseProject(text, project);
    for (const i of indexes) applyProjectEdit(p, { kind: 'change', list: 'next', index: i, item: { done } }, '');
    const after = serializeProject(p, text);
    if (after !== text) out = { ...out, project: { path: project, before: text, after } };
  }
  // The matching lines in its project's notes (its own note's twins too), under the line's own title and owner.
  const { title, owner: who } = splitLineIdentity(lineWords, now);
  if (!title) return out;
  const step: MatchStep = { what: title, ...(who ? { who } : {}) };
  for (const [note, own] of (rels ?? index.relations()).owner) {
    if (own !== project) continue;
    if (skip(note)) continue;
    const before = index.content(note);
    const after = linesSet(before, step, done, now, note === at.path ? at.line : undefined);
    if (before !== undefined && after !== null) out.notes.push({ path: note, before, after });
  }
  return out;
}
