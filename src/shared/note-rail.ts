// What sits beside a note (8.0 section E, 29 Oct 2026): the note's context rail, worked out here from the notes as
// the index keeps them, so the window only draws it (views/note/ContextRail.tsx). Which project or area it belongs
// to, the people in it, its open tasks, the notes it links to and that link here, and its related meetings. Pure,
// so the tests check it.

import { calendarDayOf } from './days';
import { isMeetingNote, meetingPeople } from './note-page';
import { findAllTasks } from './tasks';
import { isPersonNote } from './tasks';
import { taskChips } from './note-task';

export interface RailNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  links: { target: string }[];
}

export interface RailRef {
  path: string;
  title: string;
  date?: string;
}

export interface RailTask {
  line: number;
  words: string;
  owner: string | null;
  due: string | null;
  dueWords: string | null;
}

export interface NoteRail {
  /** The project this note belongs to (its `project` property, its folder, or the project file naming it). */
  project: RailRef | null;
  /** Its area: the note's `area`, else its project's, else its top folder's name. */
  area: string | null;
  /** People the note names (linked, or among a meeting's people), by name. */
  people: RailRef[];
  /** Its open tick-box tasks, in the note's order. */
  openTasks: RailTask[];
  /** Notes it links to, each once, by name. */
  outgoing: RailRef[];
  /** Notes that link here (given by the index), by name. */
  backlinks: RailRef[];
  /** Meetings joined to it: they link here, share its project, or include its people. Newest first. */
  meetings: RailRef[];
  /** Every meeting joined to it, not just the six shown. */
  meetingsTotal: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const propLinks = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim()).filter(Boolean);

/** The day a meeting note is for: its date property, else the day in its name (YYYY-MM-DD), else its change time. */
function meetingDay(note: RailNote & { mtime?: number }): string | undefined {
  for (const k of ['date', 'when', 'day', 'held']) {
    const v = note.props?.[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (v instanceof Date) { const day = calendarDayOf(v); if (day) return day; }
  }
  return /(\d{4}-\d{2}-\d{2})/.exec(note.path.split('/').pop() ?? '')?.[1];
}

/**
 * The rail for the note at `path`. `text` is the note's own words (for its tasks); `backlinkPaths` are the notes
 * the index says link here; `resolve` finds the note a link names. Left out: the note itself everywhere.
 */
export function noteRail(input: {
  path: string;
  text: string;
  notes: readonly (RailNote & { mtime?: number })[];
  backlinkPaths: readonly string[];
  resolve(target: string, from: string): string | null;
  ownNames?: readonly string[];
  ref?: Date;
}): NoteRail {
  const { path, notes, resolve } = input;
  const ref = input.ref ?? new Date();
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const self = byPath.get(path);
  const refOf = (p: string): RailRef | null => {
    const n = byPath.get(p);
    return n ? { path: n.path, title: n.title } : null;
  };
  const isProject = (n: RailNote) => str(n.props?.type).toLowerCase() === 'project';

  // Its project: the property, then the folder a project file sits in, then the project file naming it (5 Nov
  // 2026, v9-vault-truth: a note that merely links to one project is see-also there, never a member).
  let project: RailRef | null = null;
  if (self) {
    if (isProject(self)) project = refOf(path);
    if (!project)
      for (const target of [...propLinks(self.props?.project), ...propLinks(self.props?.projects)]) {
        const p = resolve(target, path);
        if (p && p !== path && byPath.get(p) && isProject(byPath.get(p)!)) {
          project = refOf(p);
          break;
        }
      }
    if (!project) {
      const dirs = notes.filter((n) => isProject(n) && n.path.includes('/')).map((n) => ({ p: n.path, dir: n.path.slice(0, n.path.lastIndexOf('/')) })).filter((x) => path.startsWith(`${x.dir}/`)).sort((a, b) => b.dir.length - a.dir.length);
      if (dirs[0]) project = refOf(dirs[0].p);
    }
    if (!project) {
      const claimedBy = notes.filter((n) => n.path !== path && isProject(n) && n.links.some((l) => resolve(l.target, n.path) === path));
      if (claimedBy.length === 1) project = refOf(claimedBy[0].path);
    }
  }

  const projectNote = project ? byPath.get(project.path) : undefined;
  const area = str(self?.props?.area) || str(projectNote?.props?.area) || (path.includes('/') ? path.slice(0, path.indexOf('/')) : '') || null;

  // People in it (Polish round 4, 29 Oct 2026): people the note links to or @mentions, plus people
  // linked from it (their notes link here). Each once.
  const people = new Map<string, RailRef>();
  if (self) {
    for (const l of self.links) {
      const p = resolve(l.target, path);
      const n = p && byPath.get(p);
      if (n && p !== path && isPersonNote(n.path, n.props)) people.set(p, refOf(p)!);
    }
    for (const person of meetingPeople(self.props)) {
      const p = resolve(person.target, path);
      const n = p && byPath.get(p);
      if (n && p !== path && isPersonNote(n.path, n.props)) people.set(p, refOf(p)!);
    }
    // An @mention in the note's own words (@Mia Tran, or @Mia when only one Mia is known).
    const personNotes = notes.filter((n) => n.path !== path && isPersonNote(n.path, n.props));
    const firstNames = new Map<string, number>();
    for (const n of personNotes) firstNames.set(n.title.split(/\s+/)[0].toLowerCase(), (firstNames.get(n.title.split(/\s+/)[0].toLowerCase()) ?? 0) + 1);
    for (const n of personNotes) {
      const escaped = n.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const first = n.title.split(/\s+/)[0];
      const mentioned = new RegExp(`(?<![\\p{L}\\p{N}._-])@${escaped}(?![\\p{L}'’-])`, 'u').test(input.text) || (first !== n.title && firstNames.get(first.toLowerCase()) === 1 && new RegExp(`(?<![\\p{L}\\p{N}._-])@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}'’-])`, 'u').test(input.text));
      if (mentioned) people.set(n.path, refOf(n.path)!);
    }
  }
  for (const p of input.backlinkPaths) {
    const n = p !== path && byPath.get(p);
    if (n && isPersonNote(n.path, n.props)) people.set(p, refOf(p)!);
  }

  const openTasks: RailTask[] = findAllTasks(input.text, ref)
    .filter((t) => !t.done)
    .map((t) => {
      const line = input.text.split(/\r?\n/)[t.line] ?? '';
      const chips = taskChips(line, ref, input.ownNames ?? []);
      return { line: t.line, words: chips?.words ?? t.words, owner: chips?.owner ?? null, due: chips?.due ?? t.due, dueWords: chips?.dueWords ?? null };
    });

  const outgoing = new Map<string, RailRef>();
  if (self)
    for (const l of self.links) {
      const p = resolve(l.target, path);
      if (p && p !== path && byPath.has(p)) outgoing.set(p, refOf(p)!);
    }

  const backlinks = new Map<string, RailRef>();
  for (const p of input.backlinkPaths) if (p !== path && byPath.has(p)) backlinks.set(p, refOf(p)!);

  const myLinks = new Set(self ? self.links.map((l) => resolve(l.target, path)).filter(Boolean) : []);
  const meetings: (RailRef & { at: number })[] = [];
  for (const n of notes) {
    if (n.path === path || !isMeetingNote(n)) continue;
    const linksHere = n.links.some((l) => resolve(l.target, n.path) === path);
    const sameProject = !!project && (n.path === project.path || [...propLinks(n.props?.project)].some((t) => resolve(t, n.path) === project!.path));
    const sharesPerson = meetingPeople(n.props).some((person) => {
      const p = resolve(person.target, n.path);
      return !!p && people.has(p);
    }) || n.links.some((l) => { const p = resolve(l.target, n.path); return !!p && people.has(p); });
    const iLinkThere = myLinks.has(n.path);
    if (!linksHere && !sameProject && !sharesPerson && !iLinkThere) continue;
    const date = meetingDay(n);
    meetings.push({ path: n.path, title: n.title, ...(date ? { date } : {}), at: date ? Date.parse(date) : (n.mtime ?? 0) });
  }
  meetings.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title));

  const byName = (a: RailRef, b: RailRef) => a.title.localeCompare(b.title);
  return {
    project,
    area,
    people: [...people.values()].sort(byName),
    openTasks,
    outgoing: [...outgoing.values()].sort(byName),
    backlinks: [...backlinks.values()].sort(byName),
    meetings: meetings.slice(0, 6).map(({ at: _at, ...r }) => r),
    /** Every meeting tied to the note, not just the six shown (9.2: the rail says when there are more). */
    meetingsTotal: meetings.length,
  };
}
