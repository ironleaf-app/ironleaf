// One task, one row (p13-one-task, 4 Nov 2026). A meeting action that became a project step showed twice — the
// project's step and the note's line — in Tasks, Today, the rail, Needs you, the five and the brief. An open tick
// line in a note is THE SAME TASK as an open project step when their words are the same under the existing
// sameWhat/normalizeTaskWhat AND the note belongs to that project AND the owner does not differ. Near words merge too
// since t249 (isNearKey: one's words start with the other's, three words at least): a meeting shortens the step's
// words, or the step carries the meeting's detail. No meaning matching beyond that, no guessing. The project's step
// is the row; every door reads this module, none its own copy. Pure: no app state. Ironleaf imports this file; The
// former host app reads it built (tools/build-embedded.mjs writes one-task.mjs into its desktop and work plugins, as
// today-count.mjs). Nothing here is written from scratch where the vault already reads it: words through the
// meetings' sameWhat (src/shared/meetings.ts), people through isPerson and owner tails through ownerOf
// (src/shared/today-count.ts), days through taskDue (src/shared/hub.ts), steps through parseProject
// (src/shared/project-file.ts), and a note's project through the relations' owner rule (src/shared/relations.ts,
// which calls makeProjectOwner below).

import { isBoxDone } from './finished';
import { taskDue } from './hub';
import { TASK_LINE, trackFence, type Fence } from './markdown';
import { AGENDA_HEADING, FILED_MARK, sameWhat } from './meetings';
import { isProjectText, parseProject, projectOwnsFolder } from './project-file';
import { parseReminderLine } from './reminders';
import { isDormantProjectText, isLive, isPerson, ownerOf, projectHead } from './today-count';

/** A step as the match needs it: its words and who it names. */
export interface MatchStep {
  what: string;
  who?: string;
}

/** A note as the file walk hands it: its path in the library and its text. */
export interface WalkFile {
  path: string;
  text: string;
}

/** An open tick line found in a note: its line from 0, the words after its box, and those words with its day out. */
export interface OpenLine {
  line: number;
  text: string;
  words: string;
}

/** A project as membership needs it: its file, and every name that means it (its title, its file's name, aliases). */
export interface OwnerProject {
  path: string;
  names: string[];
}

/** A note line's words split into its task and its owner ("Reply … — Alex Rivera" is the reply, Alex's): the tail
 *  after its dash reads the way a project step's does (src/shared/project-file.ts: "— Who · by when"), through
 *  ownerOf, so "from [[a note]] — Jesse" is Jesse's and a day written there ("— Fri 23 Oct") is no owner at all. A
 *  filed meeting line's mark ("→ [[Harbour Fit-out]]", src/shared/meetings.ts FILED_MARK: the link the note keeps to
 *  its project, 5 Nov 2026 one list) is not part of the task: without this the filed line never matched its own step,
 *  so it showed twice and a tick on one side never reached the other. */
export function splitLineIdentity(words: string, now: Date = new Date()): { title: string; owner: string } {
  const rest = String(words ?? '').replace(FILED_MARK, '').trim();
  const tail = /\s+[—–]\s+(.+)$/.exec(rest);
  if (!tail) return { title: rest, owner: '' };
  let who: string | undefined;
  let when: string | undefined;
  // "— Who — due when", "— Who, due when": the date part is when, never a person (p16-owner-tail, 4 Nov 2026); a
  // second dash or a comma only splits before by/due, so a real name with a hyphen or a dash inside stays whole.
  const segments = tail[1]
    .split(/\s+·\s+/)
    .flatMap((seg) => seg.split(/\s+[—–]\s+(?=(?:by|due)\s+)/i))
    .flatMap((seg) => seg.split(/,\s*(?=(?:by|due)\s+)/i));
  for (const part of segments) {
    const by = /^(?:by|due)\s+(.+)$/i.exec(part.trim());
    if (by && when === undefined) when = by[1].trim();
    else if (part.trim()) who = who ? `${who} · ${part.trim()}` : part.trim();
  }
  const split = ownerOf(who, when, now);
  return { title: rest.slice(0, tail.index).trim(), owner: split.who ?? '' };
}

/** The people one owner names ("Sam and June" is two; "Alex Morgan" is one): the same split the people's own
 *  reading uses (today-count.ts isPerson: commas, & / and +), with whoPerson's "with" and ";" beside it (t250,
 *  12 Nov 2026: "Sam with June" merged away into "Sam", and never met "Sam and June" as the same pair). */
function ownerParts(who: string): string[] {
  return String(who ?? '')
    .split(/\s*(?:,|&|\/|\band\b|\+|\bwith\b|;)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Whether two owners do not differ: neither names anyone, or both name the same person (the people's own reading,
 *  isPerson both ways, so "Alex" and "Alex Rivera" are one — while "Alex Lee" and "Alex Morgan" never are). One side
 *  naming someone the other doesn't is differing: no guessing. A job for two people is never one person's job (t250,
 *  12 Nov 2026: "Sam and June" merged away into "Sam", and one tick closed the other's task): when either side names
 *  more than one person, both sides name the same people, person for person, in any order. */
export function ownerSame(a: string | undefined, b: string | undefined): boolean {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x && !y) return true;
  if (!x || !y) return false;
  if (sameWhat(x) === sameWhat(y)) return true;
  return ownersMatch(x, y);
}

/** Whether two named owners are the same people: one person each reads the people's own reading both ways; a pair
 *  or group must match person for person (ownerSame's rule, shared with the keyed ownersAgree below: one rule). */
function ownersMatch(x: string, y: string): boolean {
  const a = ownerParts(x);
  const b = ownerParts(y);
  if (a.length > 1 || b.length > 1) {
    if (a.length !== b.length) return false;
    return a.every((p) => b.some((q) => isPerson(p, q) && isPerson(q, p))) && b.every((q) => a.some((p) => isPerson(p, q) && isPerson(q, p)));
  }
  return isPerson(x, y) && isPerson(y, x);
}

/** Whether an open note line's words are the same task as an open project step: the same words under sameWhat (empty
 *  words never match) and the owner not differing. The caller checks the note belongs to the step's project. */
export function isSameTask(step: MatchStep, lineWords: string, now: Date = new Date()): boolean {
  const key = stepKeyOf(step);
  if (!key.want) return false;
  const line = lineKeyOf(lineWords, now);
  if (!line) return false;
  return isSameKey(key, line);
}

/** A step with its match worked out once: its words under sameWhat, and its owner trimmed with its own sameWhat. A
 *  vault has thousands of lines, each read against every step of its project on each read of Tasks and Today; working
 *  the step's side out per pair (p18-big-vault, 4 Nov 2026: sameWhat is five passes over the words) read Today six
 *  times slower on a big vault. */
export interface StepKey {
  want: string;
  who: string;
  ownerKey: string;
}

/** A note line's words with their identity worked out once (the tail's date is read here, never per step). Null when
 *  the line has no title: it is never the same task as a step. `owner` is trimmed, as ownerSame reads it. */
export interface LineKey {
  key: string;
  owner: string;
  ownerKey: string;
}

export function stepKeyOf(step: MatchStep): StepKey {
  const who = String(step?.who ?? '').trim();
  return { want: sameWhat(String(step?.what ?? '')), who, ownerKey: sameWhat(who) };
}

export function lineKeyOf(lineWords: string, now: Date = new Date()): LineKey | null {
  const { title, owner } = splitLineIdentity(lineWords, now);
  if (!title) return null;
  const who = String(owner ?? '').trim();
  return { key: sameWhat(title), owner: who, ownerKey: sameWhat(who) };
}

/** Whether a step's owner and a line's owner do not differ: neither names anyone, or both name the same person
 *  (the people's own reading, isPerson both ways). One side naming someone the other doesn't is differing: no
 *  guessing. Exact and near matches read this one rule. */
function ownersAgree(step: Pick<StepKey, 'who' | 'ownerKey'>, line: Pick<LineKey, 'owner' | 'ownerKey'>): boolean {
  if (!step.who && !line.owner) return true;
  if (!step.who || !line.owner) return false;
  if (step.ownerKey === line.ownerKey) return true;
  return ownersMatch(step.who, line.owner);
}

/** Whether a line is the same task as a step, from their worked-out keys: exactly isSameTask, without re-reading
 *  either side. */
export function isSameKey(step: StepKey, line: LineKey): boolean {
  if (!step.want || !line.key || line.key !== step.want) return false;
  return ownersAgree(step, line);
}

/** Whether a line is NEARLY the same task as a step (t249, 12 Nov 2026, the critics: "Publish the November
 *  roster with cover" twice plus a near copy, the Retry line twice — a meeting shortens the step's words, or the
 *  step carries the detail the meeting left out). One's normalized words start with the other's at a word edge, the
 *  shorter at least three words, the owner not differing (ownersAgree above). Same project still required (the
 *  callers check it): two projects' rows never merge here. Ordered on purpose: the unordered subset readings
 *  (project-hub alike, meetings sameJob) would join "Send June the October totals" to "Send June the November
 *  totals"; a prefix never does. "Book the room for next Tuesday" and "Book the room for the December sign-off"
 *  share a start but neither starts with the other, so they stay two. The tick cascade reads it too, so one tick
 *  still closes the one job everywhere; the tidy-up's step removal stays exact (deleting needs certainty). */
export function isNearKey(step: StepKey, line: LineKey): boolean {
  if (!step.want || !line.key || step.want === line.key) return false;
  const [short, long] = step.want.length <= line.key.length ? [step.want, line.key] : [line.key, step.want];
  if (short.split(' ').length < 3) return false;
  if (!long.startsWith(short) || long[short.length] !== ' ') return false;
  return ownersAgree(step, line);
}

/** A project's open steps as keys: worked out once per read, matched per line. */
export const stepKeysOf = (steps: MatchStep[]): StepKey[] => steps.map(stepKeyOf);

/** Whether a batch of project edits keeps the names the owner rule resolves by (src/shared/relations.ts resolves
 *  through makeProjectOwner below: the body name, the aliases): only a rename (the name as it ends up differing) or a
 *  property setting `aliases`/`alias` moves one. A save whose batch keeps them may run its cascade on the relations
 *  read before its write; anything else reads them after, as before. */
export function ownerNamesKept(oldName: string, newName: string, edits: unknown): boolean {
  if (String(oldName ?? '') !== String(newName ?? '')) return false;
  const list = Array.isArray(edits) ? edits : [edits];
  return !list.some((e) => {
    const ed = (e && typeof e === 'object' ? e : {}) as { kind?: unknown; key?: unknown };
    return ed.kind === 'prop' && /^(aliases?)$/i.test(String(ed.key ?? ''));
  });
}

/** A project step by its What's next index (a Done tick's identity): null when it isn't there or is done already. */
export function projectStepAt(text: string, index: number, fileName = ''): MatchStep | null {
  let p;
  try {
    p = parseProject(String(text ?? ''), fileName);
  } catch {
    return null;
  }
  const n = Number.isInteger(index) ? p.next[index] : undefined;
  return n && !n.done ? { what: n.what, ...(n.who ? { who: n.who } : {}) } : null;
}

/** The open steps' words in a project file, in order (done steps never match: a closed step is not the row). */
export function openStepsOf(text: string, fileName = ''): MatchStep[] {
  try {
    return parseProject(String(text ?? ''), fileName).next.filter((n) => !n.done).map((n) => ({ what: n.what, ...(n.who ? { who: n.who } : {}) }));
  } catch {
    return [];
  }
}

/** Every tick line in a note in the state asked for (none inside fenced code or the properties, no reminders: a ⏰
 *  line is said at its time, never folded into a step), with its day taken out of its words the way Due reads it.
 *  Open means not done; ticked means [x] only — a cancelled ([-]) line is a decision, never flipped by an untick. */
export function scanTaskLines(text: string, ref: Date = new Date(), ticked = false): OpenLine[] {
  const content = String(text ?? '');
  if (!/\[[^\]]\]/.test(content)) return [];
  const out: OpenLine[] = [];
  const lines = content.split(/\r?\n/);
  let fence: Fence | null = null;
  let inAgenda = false;
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    const st = trackFence(l, fence);
    fence = st.fence;
    if (st.skip) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      inAgenda = AGENDA_HEADING.test(h[2]);
      continue;
    }
    // Agenda text is not a task (12 Nov 2026, t240): an agenda item ticked marks it covered, so the cascade
    // never matches or flips one.
    if (inAgenda) continue;
    const m = TASK_LINE.exec(l);
    if (!m || !m[4].trim()) continue;
    if (ticked ? m[2].toLowerCase() !== 'x' : isBoxDone(m[2])) continue;
    if (l.includes('⏰') && parseReminderLine(l)) continue;
    out.push({ line: i, text: m[4], words: taskDue(m[4], ref).words || m[4] });
  }
  return out;
}

/** Every open tick line in a note: the fold's reading. */
export function scanOpenLines(text: string, ref: Date = new Date()): OpenLine[] {
  return scanTaskLines(text, ref, false);
}

/** Which project each note belongs to: its `project` property when it names one (deliberate beats incidental), else
 *  its folder (the deepest OWNED folder holding exactly one project file — projectOwnsFolder, src/shared/project-file.ts;
 *  a folder with two project files in it is nobody's, and a file that doesn't own its folder claims nothing: 5 Nov 2026,
 *  u3 moving-in, a coincidental `type: project` note filed its whole folder). This IS the relations' owner rule
 *  (src/shared/relations.ts computeRelations calls it): one rule, with the file walk's names (projectNamesOf below:
 *  the title, file name, folder name and aliases, the walks' mirror of the index's) or the index's. */
export function makeProjectOwner(projects: OwnerProject[]): (notePath: string, projectProp: unknown) => string | null {
  const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const byName = new Map<string, string>();
  for (const p of projects) for (const name of p.names) if (name) byName.set(name.toLowerCase(), p.path);
  const folderCount = new Map<string, number>();
  for (const p of projects) folderCount.set(folderOf(p.path), (folderCount.get(folderOf(p.path)) ?? 0) + 1);
  const folders = projects
    .map((p) => ({ dir: folderOf(p.path), path: p.path }))
    .filter((f) => f.dir && folderCount.get(f.dir) === 1 && projectOwnsFolder(f.path))
    .sort((a, b) => b.dir.length - a.dir.length);
  const named = (value: unknown): string | undefined => {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const hit = byName.get(v.replace(/^\[\[|\]\]$/g, '').split('|')[0].replace(/\.md$/i, '').split('/').pop()!.trim().toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };
  return (notePath, projectProp) => named(projectProp) ?? folders.find((f) => notePath.startsWith(`${f.dir}/`))?.path ?? null;
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();

/** A note's `project` property from its text (a link, a name or a path; one line, a [flow, list], or a block list):
 *  the file walk's reading where the index's parsed properties aren't to hand. */
export function projectPropOf(text: string): unknown {
  const lines = String(text ?? '').slice(0, 4000).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) break;
    const m = /^project\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].trim();
    if (!rest) {
      const out: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) {
        const item = unquote(lines[j].replace(/^\s+-\s+/, ''));
        if (item) out.push(item);
      }
      return out.length ? out : undefined;
    }
    if (rest.startsWith('[')) {
      const items = rest
        .replace(/^\[/, '')
        .replace(/\]\s*(#.*)?$/, '')
        .split(',')
        .map(unquote)
        .filter(Boolean);
      return items.length ? items : undefined;
    }
    const one = unquote(rest.replace(/\s+#.*$/, ''));
    return one || undefined;
  }
  return undefined;
}

/** A project's `aliases` (or `alias`) property from its text (one line, a [flow, list], or a block list): the file
 *  walk's reading where the index's parsed aliases aren't to hand. */
export function projectAliasesOf(text: string): string[] {
  const lines = String(text ?? '').slice(0, 4000).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  const out: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) break;
    const m = /^aliases?\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const rest = m[1].trim();
    if (!rest) {
      for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) {
        const item = unquote(lines[j].replace(/^\s+-\s+/, ''));
        if (item) out.push(item);
      }
      continue;
    }
    if (rest.startsWith('[')) {
      for (const item of rest
        .replace(/^\[/, '')
        .replace(/\]\s*(#.*)?$/, '')
        .split(',')
        .map(unquote)
        .filter(Boolean)) out.push(item);
      continue;
    }
    const one = unquote(rest.replace(/\s+#.*$/, ''));
    if (one) out.push(one);
  }
  return out;
}

/** Every name a project file goes by in other notes: its title, its file's name, its folder's name and its aliases
 *  (Nov 2026, b6 break job: the file walks resolved owners by title and file name only, while the index reads the
 *  folder's name and aliases too — an alias-linked note outside its project's folder counted in the walks and
 *  nowhere in the vault). The walks' mirror of the index's owner names (src/shared/relations.ts). */
export function projectNamesOf(path: string, text: string): string[] {
  let title = '';
  try {
    title = parseProject(String(text ?? ''), String(path ?? '')).name;
  } catch {
    title = '';
  }
  const parts = String(path ?? '').split('/');
  const folder = parts.length > 1 ? String(parts[parts.length - 2] ?? '') : '';
  return [title, parts[parts.length - 1]!.replace(/\.md$/i, ''), folder, ...projectAliasesOf(text)].filter(Boolean);
}

/** The notes that count nowhere (5 Nov 2026, the plan one list): dormant (finished or shelved) project files, and
 *  the notes that belong to one (its folder's notes, its linked notes). The file walk's skip (the former host app's
 *  Needs you, vault lines and the brief read this beside the fold below): their boxes stay in their notes untouched,
 *  and the project page still shows them. */
export function dormantNotePaths(files: WalkFile[]): Set<string> {
  const list = Array.isArray(files) ? files : [];
  const projects: OwnerProject[] = [];
  const seen = new Set<string>();
  const texts = new Map<string, string>();
  for (const f of list) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string' || seen.has(f.path)) continue;
    seen.add(f.path);
    texts.set(f.path, f.text);
    if (isProjectText(f.text.slice(0, 4000))) {
      projects.push({ path: f.path, names: projectNamesOf(f.path, f.text) });
    }
  }
  const dormant = new Set(projects.filter((p) => isDormantProjectText(texts.get(p.path) ?? '')).map((p) => p.path));
  if (!dormant.size) return dormant;
  const ownerOfNote = makeProjectOwner(projects);
  for (const [p, text] of texts) {
    if (dormant.has(p)) continue;
    if (isProjectText(text.slice(0, 4000))) continue;
    const owner = ownerOfNote(p, projectPropOf(text));
    if (owner && dormant.has(owner)) dormant.add(p);
  }
  return dormant;
}

/** Every open note line that is the same task as an open step of the project its note belongs to, as
 *  `path\nwords` (twins share it: both are the task): the file walk's fold (the former host app's Needs you and
 *  vault lines read
 *  this; the brief's five folds through it too). Project files, reminders and done lines never land in it. A note of
 *  no project (a daily note's old copy, a loose line) folds against the live projects' open steps (5 Nov 2026 one
 *  list: copies that match a task elsewhere never count twice); a note of another project still never folds against
 *  this one — other projects' lines stay two rows. Near words fold since t249 (isNearKey), exact before it. */
export function dupNoteWords(files: WalkFile[], now: Date = new Date()): Set<string> {
  const ref = now instanceof Date ? now : new Date(now);
  const list = Array.isArray(files) ? files : [];
  const projects: { path: string; names: string[]; steps: MatchStep[]; live: boolean }[] = [];
  const notes: WalkFile[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string' || seen.has(f.path)) continue;
    seen.add(f.path);
    if (isProjectText(f.text.slice(0, 4000))) {
      projects.push({ path: f.path, names: projectNamesOf(f.path, f.text), steps: openStepsOf(f.text, f.path), live: isLive(projectHead(f.text.slice(0, 4000)).status) });
    } else {
      notes.push(f);
    }
  }
  const ownerOfNote = makeProjectOwner(projects);
  const byPath = new Map(projects.map((p) => [p.path, stepKeysOf(p.steps)]));
  const liveSteps = stepKeysOf(projects.filter((p) => p.live).flatMap((p) => p.steps));
  const out = new Set<string>();
  for (const n of notes) {
    const owner = ownerOfNote(n.path, projectPropOf(n.text));
    const steps = owner ? byPath.get(owner) ?? [] : liveSteps;
    if (!steps.length) continue;
    for (const l of scanOpenLines(n.text, ref)) {
      const key = lineKeyOf(l.words, ref);
      if (key && steps.some((s) => isSameKey(s, key) || isNearKey(s, key))) out.add(`${n.path}\n${l.words}`);
    }
  }
  return out;
}

/** The steps a note line matches in its project file, by their What's next index: the open ones when the line is
 *  ticked done, the done ones when it is opened again (an untick reopens what the tick closed, never more). Exact
 *  or near (t249 isNearKey): one tick closes the one job however many ways it was written. */
export function findMatchingSteps(projectText: string, lineWords: string, fileName = '', now: Date = new Date(), done = true): number[] {
  const ref = now instanceof Date ? now : new Date(now);
  let p;
  try {
    p = parseProject(String(projectText ?? ''), fileName);
  } catch {
    return [];
  }
  const line = lineKeyOf(lineWords, ref);
  if (!line) return [];
  const out: number[] = [];
  p.next.forEach((n, index) => {
    if (done ? n.done : !n.done) return;
    const key = stepKeyOf({ what: n.what, ...(n.who ? { who: n.who } : {}) });
    if (isSameKey(key, line) || isNearKey(key, line)) out.push(index);
  });
  return out;
}

/** The lines matching a step in a note's text (a ticked step closes them; an unticked one reopens its ticked ones):
 *  line numbers and words after the box. Exact or near (t249 isNearKey), as findMatchingSteps. */
export function findMatchingLines(noteText: string, step: MatchStep, now: Date = new Date(), done = true): { line: number; text: string }[] {
  const ref = now instanceof Date ? now : new Date(now);
  const key = stepKeyOf(step);
  if (!key.want) return [];
  return scanTaskLines(String(noteText ?? ''), ref, !done)
    .filter((l) => {
      const line = lineKeyOf(l.words, ref);
      return line !== null && (isSameKey(key, line) || isNearKey(key, line));
    })
    .map((l) => ({ line: l.line, text: l.text }));
}
