// The vault tidy (t238 vault rebuild step 1, 12 Nov 2026, decision 5: existing notes are converted on a copy first,
// seen before anything touches the real vault, nothing deleted). One tool that reads a vault in the current format
// (project files with What's next, Next steps, Waiting, Actions, To do and so on; meeting Actions, To-dos,
// Follow-ups and Questions; reminder lines) and writes the new format: one Task list per project with Waiting as a
// state; a meeting's actions its project's tasks (old copies removed, never doubled); questions as `- ?` lines;
// bare reminder lines boxed. Safe by design: dry run first (a plain report, nothing written), then run on a copy
// (`--to`), never in place; every changed note keeps its original beside it in a dated backup folder, and one
// command puts it all back. Pure core: the CLI (tools/vault-tidy.mjs) and the app's own preview run through here,
// so all three can never disagree.

import { isBoxDone } from './finished';
import { readProps } from './frontmatter';
import { readTaskDue } from './hub';
import { ACTION_HEADING, FILED_MARK, findActions, isMeetingNote } from './meetings';
import { isSameKey, lineKeyOf, makeProjectOwner, projectNamesOf, projectPropOf, splitLineIdentity, stepKeyOf } from './one-task';
import { isProjectText } from './project-file';
import { QUESTION_HEADING, isQuestionLine } from './questions';
import { setTaskBox } from './tasks';
import { plural } from './words';
import { readMeeting, sectionsOf } from './work-meetings';

/** A file as read: its path in the vault and its text. */
export interface TidyFile {
  path: string;
  text: string;
}

/** A line the tidy could not place: its 1-based line, the line, and why, in plain words. */
export interface TidyUnplaced {
  path: string;
  line: number;
  text: string;
  why: string;
}

/** What one note becomes: plain lines for the report. */
export interface TidyNoteReport {
  path: string;
  kind: 'project' | 'meeting' | 'note';
  changed: boolean;
  /** Plain lines ("2 filed marks stripped"). */
  became: string[];
  unplaced: { line: number; text: string; why: string }[];
}

/** The dry-run report: counts and every line it could not place. Nothing is written. */
export interface TidyReport {
  files: number;
  changed: number;
  tasksFolded: number;
  copiesRemoved: number;
  marksStripped: number;
  questionsFolded: number;
  remindersBoxed: number;
  unplaced: TidyUnplaced[];
  notes: TidyNoteReport[];
}

export interface TidyChange {
  path: string;
  before: string;
  after: string;
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX\-~>])\]\s+)?(.*)$/;
const frontEnd = (lines: string[]): number => {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < Math.min(lines.length, 400); i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1;
  return 0;
};
/** A top-level list line (indented lines belong to the line above them, and move with it). */
const topItem = (line: string): { box?: string; body: string } | null => {
  const m = ITEM.exec(line);
  if (!m || m[1].replace(/\t/g, '  ').length >= 2) return null;
  return { ...(m[2] !== undefined ? { box: m[2] } : {}), body: m[3] };
};
/** A placeholder line (a bare mark, no words): dropped silently in a fold, never a task. */
const isPlaceholder = (body: string): boolean => !String(body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
/** Whether a line opens or closes a fenced block. */
function fenceOf(line: string, open: string | null): string | null {
  const m = FENCE.exec(line);
  if (!m) return open;
  if (open === null) return m[2][0];
  return line.includes(open === '`' ? '```' : '~~~') ? null : open;
}

/** Project headings that fold into What's next (besides What's next itself and the names the project read already
 *  folds: Next steps, Actions, To do). Waiting and Follow-ups the read never folded — they were invisible tasks. */
const PROJECT_FOLD = /^(?:\d+[.)]?\s*)?(?:next steps?|waiting(?:\s+on\b.*)?|actions?|to[\s-]?dos?|follow[\s-]?ups?|tasks?)\b/i;
const WHATS_NEXT = /^(?:\d+[.)]?\s*)?(?:what['’]s next|next steps?|next|to do|todo|actions?)\b/i;
const WAITING_HEAD = /^(?:\d+[.)]?\s*)?waiting(?:\s+on\b.*)?$/i;

/** A task line normalized the one plain way (`- [ ]` / `- [x]`), or null when it has no words. */
function asTaskLine(line: string): string | null {
  const item = topItem(line);
  if (!item || isPlaceholder(item.body)) return null;
  const body = item.body.trim();
  if (item.box === undefined) return `- [ ] ${body}`;
  return `- [${item.box}] ${body}`;
}

/** A `- ?` line converted from a list line under Questions (ticked boxes are done tasks, left alone): null keeps
 *  the line as it is (already `- ?`, ticked, or a placeholder to drop — the caller drops placeholders). */
function asQuestionLine(line: string): string | null {
  const item = topItem(line);
  if (!item) return null;
  if (/^\?\s+/.test(item.body)) return `- ? ${item.body.replace(/^\?\s+/, '').trim()}`;
  if (item.box !== undefined && item.box !== ' ') return null;
  if (isPlaceholder(item.body)) return null;
  return `- ? ${questionRest(item.body.trim())}`;
}

/** A question's rest with a plain owner tail rewritten as a for-tail ("Who? — Alex" reads "for Alex"; asked-by,
 *  for, answer, day and mark tails stay as written). */
function questionRest(rest: string): string {
  const m = /\s+[—–]\s+/.exec(rest);
  if (!m) return rest;
  const head = rest.slice(0, m.index).trim();
  const tail = rest.slice(m.index + m[0].length).trim();
  if (!tail || /^(asked\s+by|for|owned\s+by|owner|answer\s*:|by\b|due\b|📅|⏰)/i.test(tail)) return rest;
  return `${head} — for ${tail}`;
}

/** The lines of a fold: each top-level list line with its indented followers kept together. Fenced lines are
 *  never movable (examples, never work). Returns the movable groups and the kept lines. */
function splitFold(lines: string[]): { movable: string[][]; kept: { line: number; text: string }[] } {
  const movable: string[][] = [];
  const kept: { line: number; text: string }[] = [];
  let fence: string | null = null;
  let i = 0;
  while (i < lines.length) {
    fence = fenceOf(lines[i], fence);
    if (fence !== null || topItem(lines[i]) === null) {
      kept.push({ line: i, text: lines[i] });
      i++;
      continue;
    }
    const group = [lines[i]];
    let j = i + 1;
    while (j < lines.length) {
      const f = fenceOf(lines[j], fence);
      if (f !== fence) break;
      if (!lines[j].trim() || /^\s+/.test(lines[j])) {
        group.push(lines[j]);
        j++;
        continue;
      }
      break;
    }
    movable.push(group);
    i = j;
  }
  return { movable, kept };
}

/** A movable group trimmed for its new home: blank edges off, the words kept. */
const trimGroup = (group: string[]): string[] => {
  let a = 0;
  let b = group.length;
  while (a < b && !group[a].trim()) a++;
  while (b > a && !group[b - 1].trim()) b--;
  return group.slice(a, b);
};

type FileKind = 'project' | 'meeting' | 'note';

/** What a file is: a project (its format), a meeting (its type or place), or a note. */
function kindOf(path: string, text: string): FileKind {
  if (isProjectText(String(text ?? '').slice(0, 4000))) return 'project';
  let props: Record<string, unknown> = {};
  try {
    props = readProps(String(text ?? '')) as Record<string, unknown>;
  } catch {
    props = {};
  }
  return isMeetingNote(path, props) ? 'meeting' : 'note';
}

/** People the vault knows, by their notes' names (People and Contacts notes): phrase owners read against these. */
function knownOf(files: TidyFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!/(^|\/)(people|contacts)\//i.test(f.path) || !/\.md$/i.test(f.path)) continue;
    const name = f.path.split('/').pop()!.replace(/\.md$/i, '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

interface Pass {
  lines: string[];
  became: string[];
  unplaced: { line: number; text: string; why: string }[];
  tasks: number;
  questions: number;
  reminders: number;
}

const freshPass = (lines: string[]): Pass => ({ lines, became: [], unplaced: [], tasks: 0, questions: 0, reminders: 0 });

/** One edit: replace `del` lines at `at` with `insert`. All edits plan on the original numbering, then apply
 *  bottom-up, so nothing ever shifts under a later edit. */
interface Splice {
  at: number;
  del: number;
  insert: string[];
}

function applySplices(lines: string[], ops: Splice[]): string[] {
  const out = lines.slice();
  for (const op of [...ops].sort((a, b) => b.at - a.at)) out.splice(op.at, op.del, ...op.insert);
  return collapseBlanks(out);
}

/** 3+ blank lines collapsed to 2; trailing blanks off. The file's own spacing otherwise stands. */
function collapseBlanks(lines: string[]): string[] {
  const out: string[] = [];
  let blanks = 0;
  for (const l of lines) {
    if (!l.trim()) {
      blanks++;
      if (blanks <= 2) out.push(l);
    } else {
      blanks = 0;
      out.push(l);
    }
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** A pass joined back to text: the file's own line ends, and its trailing newline as it was. */
function joinPass(text: string, pass: Pass, eol: string): string {
  const after = pass.lines.join(eol);
  if (!after) return after;
  const had = text.endsWith('\n');
  if (had && !after.endsWith(eol)) return after + eol;
  if (!had && after.endsWith(eol)) return after.slice(0, -eol.length);
  return after;
}

/** A movable group with absolute line numbers. */
interface Group {
  at: number;
  lines: string[];
}

/** A section body's movable groups (absolute) and kept lines. */
function groupsOf(lines: string[], start: number, end: number): { movable: Group[]; kept: { line: number; text: string }[] } {
  const body = lines.slice(start + 1, end);
  const { movable, kept } = splitFold(body);
  let cursor = 0;
  const groups: Group[] = [];
  for (const group of movable) {
    let idx = -1;
    for (let i = cursor; i + group.length <= body.length; i++) {
      if (group.every((g, k) => body[i + k] === g)) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      groups.push({ at: start + 1 + idx, lines: group });
      cursor = idx + group.length;
    }
  }
  return { movable: groups, kept: kept.map((k) => ({ line: start + 1 + k.line, text: k.text })) };
}

/** Fold donor task sections into the home section (project What's next, meeting Actions). The first donor
 *  becomes the home when none is there, renamed. Prose that is not a list item stays and is reported unplaced.
 *  `waiting` keeps Waiting lines waiting (a bare ⏳ when no owner); without `boxPlain`, plain lines move as they
 *  stand (the home pass boxes the ones that read as actions). */
function foldTaskSections(pass: Pass, homeWords: RegExp, homeTitle: string, donorWords: RegExp, opts: { waiting?: boolean; boxPlain?: boolean } = {}): void {
  const waiting = opts.waiting === true;
  const boxPlain = opts.boxPlain !== false;
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  let home = secs.find((s) => homeWords.test(s.words));
  const donors = secs.filter((s) => s !== home && donorWords.test(s.words));
  if (!donors.length) return;
  const ops: Splice[] = [];
  if (!home) {
    const first = donors[0];
    const level = /^(#+)/.exec(pass.lines[first.start])?.[1] ?? '##';
    ops.push({ at: first.start, del: 1, insert: [`${level} ${homeTitle}`] });
    pass.became.push(`“${first.words}” is now ${homeTitle}`);
    home = first;
  }
  const homeSec = home;
  const rest = donors.filter((d) => d !== homeSec);
  // The home's append point: before its trailing blanks (original numbering; donors apply around it).
  let appendAt = homeSec.end;
  while (appendAt > homeSec.start + 1 && !pass.lines[appendAt - 1].trim()) appendAt--;
  const homeEmpty = appendAt === homeSec.start + 1;
  const addAll: string[] = [];
  for (const donor of rest) {
    const { movable, kept } = groupsOf(pass.lines, donor.start, donor.end);
    const add: string[] = [];
    let tasks = 0;
    let keepHeading = false;
    for (const group of movable) {
      const item = topItem(group.lines[0]);
      const conv = asTaskLine(group.lines[0]);
      if (conv === null) {
        // A bare mark: dropped with its blanks; notes written under it stay and are reported.
        const followers = trimGroup(group.lines)
          .slice(1)
          .map((text, k) => ({ line: group.at + 1 + k, text }));
        const notes = followers.filter((f) => f.text.trim());
        if (!notes.length) ops.push({ at: group.at, del: group.lines.length, insert: [] });
        else {
          ops.push({ at: group.at, del: 1, insert: [] });
          for (const n of notes) pass.unplaced.push({ line: n.line + 1, text: n.text.trim(), why: `under an empty mark in “${donor.words}” · left for you` });
          keepHeading = true;
        }
        continue;
      }
      // Without boxPlain, plain lines move as they stand (the home pass boxes the ones that are actions).
      let line = !boxPlain && item?.box === undefined ? group.lines[0] : conv;
      // A Waiting line with no owner stays waiting (a bare ⏳: the section's meaning, kept on the line).
      if (waiting && WAITING_HEAD.test(donor.words)) {
        const words = line.replace(/^-\s+\[[^\]]\]\s+/, '');
        if (!isBoxDone(/\[([^\]])\]/.exec(line)?.[1] ?? ' ') && !splitLineIdentity(words).owner && !line.includes('⏳')) line += ' ⏳';
      }
      add.push(line, ...trimGroup(group.lines).slice(1));
      tasks++;
      ops.push({ at: group.at, del: group.lines.length, insert: [] });
    }
    const prose = kept.filter((k) => k.text.trim());
    for (const k of prose) pass.unplaced.push({ line: k.line + 1, text: k.text.trim(), why: `not a list item in “${donor.words}” · left for you` });
    if (!prose.length && !keepHeading) ops.push({ at: donor.start, del: 1, insert: [] });
    if (tasks) {
      pass.tasks += tasks;
      pass.became.push(`“${donor.words}” folded into ${homeTitle} (${plural(tasks, 'task')})`);
      addAll.push(...add);
    } else if (!prose.length && !keepHeading) {
      pass.became.push(`“${donor.words}” was empty, so removed`);
    }
  }
  if (addAll.length) ops.push({ at: appendAt, del: 0, insert: [...(homeEmpty ? [] : ['']), ...addAll] });
  pass.lines = applySplices(pass.lines, ops);
}

/** Plain list lines in the home task section boxed (they were meant as tasks; the reads need boxes). Ticked
 *  boxes, question lines and placeholders stand as they are. */
function boxHomeTasks(pass: Pass, homeWords: RegExp, onlyLines?: Set<number>): void {
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  const home = secs.find((s) => homeWords.test(s.words));
  if (!home) return;
  const ops: Splice[] = [];
  const { movable } = groupsOf(pass.lines, home.start, home.end);
  for (const group of movable) {
    const item = topItem(group.lines[0]);
    if (!item || item.box !== undefined || isQuestionLine(group.lines[0]) || isPlaceholder(item.body)) continue;
    if (onlyLines && !onlyLines.has(group.at)) continue;
    ops.push({ at: group.at, del: 1, insert: [`- [ ] ${item.body.trim()}`] });
  }
  if (ops.length) {
    pass.lines = applySplices(pass.lines, ops);
    pass.tasks += ops.length;
    pass.became.push(`${plural(ops.length, 'task')} made tickable in ${home.words}`);
  }
}

/** Fold donor Questions sections into the home one (any note: meetings, notes, the inbox). Ticked boxes are
 *  done tasks and move as they are; plain and tick-box lines become `- ?` lines. */
function foldQuestionSections(pass: Pass): void {
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  const homes = secs.filter((s) => QUESTION_HEADING.test(s.words));
  if (homes.length <= 1) return;
  const home = homes[0];
  const ops: Splice[] = [];
  let appendAt = home.end;
  while (appendAt > home.start + 1 && !pass.lines[appendAt - 1].trim()) appendAt--;
  const homeEmpty = appendAt === home.start + 1;
  const addAll: string[] = [];
  for (const donor of homes.slice(1)) {
    const { movable, kept } = groupsOf(pass.lines, donor.start, donor.end);
    const add: string[] = [];
    let questions = 0;
    let keepHeading = false;
    for (const group of movable) {
      const first = group.lines[0];
      const item = topItem(first)!;
      if (isPlaceholder(item.body)) {
        const notes = trimGroup(group.lines)
          .slice(1)
          .map((text, k) => ({ line: group.at + 1 + k, text }))
          .filter((f) => f.text.trim());
        if (!notes.length) ops.push({ at: group.at, del: group.lines.length, insert: [] });
        else {
          ops.push({ at: group.at, del: 1, insert: [] });
          for (const n of notes) pass.unplaced.push({ line: n.line + 1, text: n.text.trim(), why: `under an empty mark in “${donor.words}” · left for you` });
          keepHeading = true;
        }
        continue;
      }
      if (item.box !== undefined && item.box !== ' ') {
        add.push(...trimGroup(group.lines));
        ops.push({ at: group.at, del: group.lines.length, insert: [] });
        continue;
      }
      const conv = asQuestionLine(first);
      if (conv === null || conv === first) {
        // Already `- ?`: gathered as it stands. (Ticked boxes went above, as tasks.)
        add.push(...trimGroup(group.lines));
        if (isQuestionLine(first)) questions++;
      } else {
        add.push(conv, ...trimGroup(group.lines).slice(1));
        questions++;
      }
      ops.push({ at: group.at, del: group.lines.length, insert: [] });
    }
    const prose = kept.filter((k) => k.text.trim());
    for (const k of prose) pass.unplaced.push({ line: k.line + 1, text: k.text.trim(), why: `not a list item in “${donor.words}” · left for you` });
    if (prose.length) keepHeading = true;
    if (!keepHeading) ops.push({ at: donor.start, del: 1, insert: [] });
    if (add.length) {
      pass.questions += questions;
      pass.became.push(`“${donor.words}” folded into Questions (${plural(add.length, 'line')})`);
      addAll.push(...add);
    } else if (!keepHeading) {
      pass.became.push(`“${donor.words}” was empty, so removed`);
    }
  }
  if (addAll.length) ops.push({ at: appendAt, del: 0, insert: [...(homeEmpty ? [] : ['']), ...addAll] });
  pass.lines = applySplices(pass.lines, ops);
}

/** The home Questions section's own lines converted (`- ?` for plain and open boxes; ticked boxes stand). */
function convertHomeQuestions(pass: Pass): void {
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  const home = secs.find((s) => QUESTION_HEADING.test(s.words));
  if (!home) return;
  const ops: Splice[] = [];
  const { movable } = groupsOf(pass.lines, home.start, home.end);
  for (const group of movable) {
    const conv = asQuestionLine(group.lines[0]);
    if (conv === null || conv === group.lines[0]) continue;
    ops.push({ at: group.at, del: 1, insert: [conv] });
  }
  if (ops.length) {
    pass.lines = applySplices(pass.lines, ops);
    pass.questions += ops.length;
    pass.became.push(`${plural(ops.length, 'question')} rewritten in Questions`);
  }
}

/** Stray `- ?` lines outside any Questions section moved into it (made when missing, ahead of Actions). Lines
 *  already under a Questions heading at any depth the read sees (level 3 and under) stay where they are. */
function gatherStrayQuestions(pass: Pass): void {
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  const deep = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 3);
  const inQuestions = (line: number): boolean => {
    const s = [...deep].reverse().find((x) => x.start < line);
    return !!s && QUESTION_HEADING.test(s.words);
  };
  const strays: number[] = [];
  let fence: string | null = null;
  const lines = pass.lines;
  for (let i = frontEnd(lines); i < lines.length; i++) {
    fence = fenceOf(lines[i], fence);
    if (fence !== null || !isQuestionLine(lines[i]) || inQuestions(i)) continue;
    strays.push(i);
  }
  if (!strays.length) return;
  const ops: Splice[] = [];
  const moving = strays.map((i) => lines[i]);
  for (const i of strays) ops.push({ at: i, del: 1, insert: [] });
  const home = secs.find((s) => QUESTION_HEADING.test(s.words));
  if (home) {
    let appendAt = home.end;
    while (appendAt > home.start + 1 && !lines[appendAt - 1].trim()) appendAt--;
    ops.push({ at: appendAt, del: 0, insert: [...(appendAt === home.start + 1 ? [] : ['']), ...moving] });
  } else {
    const actions = secs.find((s) => ACTION_HEADING.test(s.words));
    const anchor = actions?.start ?? lines.length;
    ops.push({ at: anchor, del: 0, insert: ['## Questions', '', ...moving, ''] });
  }
  pass.lines = applySplices(pass.lines, ops);
  pass.questions += strays.length;
  pass.became.push(`${plural(strays.length, 'stray question')} gathered into Questions`);
}

/** Bare ⏰ lines (no tick box) boxed into tasks ("⏰ 2026-11-12 09:00 Ring June" reads "Ring June ⏰ …"). Boxed
 *  reminders are tasks already and stand as they are. */
const BARE_REMINDER = /^(\s*(?:[-*+]|\d+[.)])\s+)?(⏰\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?(?:\s+every\s+[a-z]+)?)\s*(.*)$/i;
function boxBareReminders(pass: Pass): void {
  const ops: Splice[] = [];
  let fence: string | null = null;
  for (let i = frontEnd(pass.lines); i < pass.lines.length; i++) {
    const line = pass.lines[i];
    fence = fenceOf(line, fence);
    if (fence !== null || !line.includes('⏰')) continue;
    if (/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]/.test(line)) continue;
    const m = BARE_REMINDER.exec(line);
    if (!m) continue;
    if (m[3].trim().length < 2) {
      pass.unplaced.push({ line: i + 1, text: line.trim(), why: 'a reminder with no words · left for you' });
      continue;
    }
    ops.push({ at: i, del: 1, insert: [`- [ ] ${m[3].trim()} ${m[2].replace(/\s+/g, ' ').trim()}`] });
  }
  if (ops.length) {
    pass.lines = applySplices(pass.lines, ops);
    pass.reminders += ops.length;
    pass.became.push(`${plural(ops.length, 'reminder')} boxed into tasks`);
  }
}

/** A meeting's actions for the copy hunt: what, who, done, and the line as written. */
interface MeetingAction {
  what: string;
  who: string;
  done: boolean;
  line: number;
  raw: string;
}

interface TidyCtx {
  now: Date;
  known: string[];
  ownerOf: (notePath: string, projectProp: unknown) => string | null;
  /** Each meeting's owner project and actions (read once, on the original texts). */
  meetings: Map<string, { project: string | null; actions: MeetingAction[] }>;
  /** Meeting-line edits a project copy leaves behind (due days and done ticks the copy carried). */
  meetingEdits: Map<string, { line: number; raw: string; setDone?: boolean; addDue?: string }[]>;
}

/** Whether a home-section line has notes written under it (indented lines before the next item): never removed. */
function hasNotes(lines: string[], at: number, end: number): boolean {
  for (let i = at + 1; i < end; i++) {
    if (!lines[i].trim()) continue;
    if (/^\s+/.test(lines[i])) return true;
    return false;
  }
  return false;
}

const shortName = (p: string): string => p.split('/').pop()!.replace(/\.md$/i, '');

/** Project steps that duplicate a meeting action of this project removed (the meeting's line is the task now).
 *  Done wins either way, so finished work never comes back; a day the copy carried moves onto the meeting line. */
function removeProjectCopies(pass: Pass, path: string, ctx: TidyCtx): number {
  const secs = sectionsOf(pass.lines, frontEnd(pass.lines)).filter((s) => s.level <= 2);
  const home = secs.find((s) => WHATS_NEXT.test(s.words));
  if (!home) return 0;
  const mine = [...ctx.meetings].filter(([, m]) => m.project === path);
  if (!mine.length) return 0;
  const { movable } = groupsOf(pass.lines, home.start, home.end);
  const ops: Splice[] = [];
  let removed = 0;
  const from = new Set<string>();
  for (const group of movable) {
    const item = topItem(group.lines[0]);
    if (!item || item.box === undefined || isPlaceholder(item.body)) continue;
    const stepWords = item.body.replace(FILED_MARK, '').trim();
    const key = lineKeyOf(stepWords, ctx.now);
    if (!key) continue;
    const stepDone = isBoxDone(item.box);
    const matches: { meeting: string; action: MeetingAction }[] = [];
    for (const [meeting, m] of mine) {
      for (const a of m.actions) {
        if (isSameKey(stepKeyOf({ what: a.what, ...(a.who ? { who: a.who } : {}) }), key)) matches.push({ meeting, action: a });
      }
    }
    const match = matches[0] ?? null;
    if (!match) continue;
    if (hasNotes(pass.lines, group.at, home.end)) {
      pass.unplaced.push({ line: group.at + 1, text: stepWords, why: `matches “${match.action.what}” in ${shortName(match.meeting)} but has notes under it, so kept` });
      continue;
    }
    // Done wins: a ticked copy ticks its open meeting lines too.
    if (stepDone) {
      for (const mt of matches) {
        if (!mt.action.done) editMeeting(ctx, mt.meeting, mt.action, { setDone: true });
      }
    }
    // A day the copy carried moves onto the first meeting line without one, the one plain way.
    const stepDue = readTaskDue(stepWords, ctx.now);
    if (stepDue.due) {
      const bare = matches.find((mt) => !readTaskDue(mt.action.raw.replace(FILED_MARK, ''), ctx.now).due);
      if (bare) editMeeting(ctx, bare.meeting, bare.action, { addDue: stepDue.time ? `📅 ${stepDue.due} ${stepDue.time}` : `📅 ${stepDue.due}` });
    }
    ops.push({ at: group.at, del: 1, insert: [] });
    removed++;
    for (const mt of matches) from.add(shortName(mt.meeting));
  }
  if (removed) {
    pass.lines = applySplices(pass.lines, ops);
    pass.became.push(`${plural(removed, 'copy')} removed (already in ${[...from].join(', ')})`);
  }
  return removed;
}

function editMeeting(ctx: TidyCtx, meeting: string, action: MeetingAction, edit: { setDone?: boolean; addDue?: string }): void {
  const list = ctx.meetingEdits.get(meeting) ?? [];
  const at = list.find((e) => e.line === action.line && e.raw === action.raw) ?? { line: action.line, raw: action.raw };
  if (edit.setDone) at.setDone = true;
  if (edit.addDue && !at.addDue) at.addDue = edit.addDue;
  if (!list.includes(at)) list.push(at);
  ctx.meetingEdits.set(meeting, list);
}

/** A meeting line found for an edit: as written, or with its filed mark off (marks strip first). */
function locateEdit(lines: string[], line: number, raw: string): number {
  if (lines[line] === raw) return line;
  const bare = raw.replace(FILED_MARK, '').replace(/\s+$/, '');
  const at = lines.findIndex((l) => l === raw || l === bare);
  return at;
}

/** One project file tidied: its task sections folded, its meeting copies removed. */
function tidyProject(path: string, text: string, ctx: TidyCtx): { after: string; became: string[]; unplaced: Pass['unplaced']; tasks: number; copies: number; reminders: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const pass = freshPass(text.split(/\r?\n/));
  foldTaskSections(pass, WHATS_NEXT, 'What’s next', PROJECT_FOLD, { waiting: true });
  boxHomeTasks(pass, WHATS_NEXT);
  const copies = removeProjectCopies(pass, path, ctx);
  boxBareReminders(pass);
  return { after: joinPass(text, pass, eol), became: pass.became, unplaced: pass.unplaced, tasks: pass.tasks, copies, reminders: pass.reminders };
}

/** One meeting file tidied: marks stripped, left-behind edits applied, sections folded, questions gathered. */
function tidyMeeting(path: string, text: string, ctx: TidyCtx): { after: string; became: string[]; unplaced: Pass['unplaced']; tasks: number; questions: number; marks: number; reminders: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const pass = freshPass(text.split(/\r?\n/));
  // Filed marks off first (copies are gone; the mark's job is done).
  const marks = pass.lines.filter((l) => FILED_MARK.test(l)).length;
  if (marks) {
    pass.lines = pass.lines.map((l) => (FILED_MARK.test(l) ? l.replace(FILED_MARK, '').replace(/\s+$/, '') : l));
    pass.became.push(`${plural(marks, 'filed mark')} stripped`);
  }
  // Left-behind days and ticks from removed project copies.
  const edits = ctx.meetingEdits.get(path) ?? [];
  if (edits.length) {
    const ops: Splice[] = [];
    for (const e of edits) {
      const at = locateEdit(pass.lines, e.line, e.raw);
      if (at < 0) continue;
      let line = pass.lines[at];
      if (e.setDone) line = setTaskBox(line, true);
      if (e.addDue && !readTaskDue(line, ctx.now).due) line = `${line.replace(/\s+$/, '')} ${e.addDue}`;
      if (line !== pass.lines[at]) ops.push({ at, del: 1, insert: [line] });
    }
    if (ops.length) {
      pass.lines = applySplices(pass.lines, ops);
      pass.became.push(`${plural(ops.length, 'line')} kept what its project copy carried`);
    }
  }
  foldTaskSections(pass, ACTION_HEADING, 'Actions', ACTION_HEADING, { boxPlain: false });
  // Plain lines the meeting read already calls actions become tick boxes (nothing else is invented as a task).
  const actionLines = new Set(findActions(pass.lines.join('\n'), { date: ctx.now, people: ctx.known }).map((a) => a.line));
  boxHomeTasks(pass, ACTION_HEADING, actionLines);
  foldQuestionSections(pass);
  convertHomeQuestions(pass);
  gatherStrayQuestions(pass);
  boxBareReminders(pass);
  return { after: joinPass(text, pass, eol), became: pass.became, unplaced: pass.unplaced, tasks: pass.tasks, questions: pass.questions, marks, reminders: pass.reminders };
}

/** Any other note tidied: its questions gathered, its bare reminders boxed. Its sections otherwise stand. */
function tidyNote(text: string): { after: string; became: string[]; unplaced: Pass['unplaced']; tasks: number; questions: number; reminders: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const pass = freshPass(text.split(/\r?\n/));
  foldQuestionSections(pass);
  convertHomeQuestions(pass);
  gatherStrayQuestions(pass);
  boxBareReminders(pass);
  return { after: joinPass(text, pass, eol), became: pass.became, unplaced: pass.unplaced, tasks: pass.tasks, questions: pass.questions, reminders: pass.reminders };
}

/** The whole vault tidied in memory: changes (before and after per note) and the dry-run report. Nothing is
 *  written here — the CLI and the app write. Deterministic: the same vault tidies the same way, twice over. */
export function tidyVault(files: TidyFile[], now: Date = new Date()): { changes: TidyChange[]; report: TidyReport } {
  const ref = now instanceof Date ? now : new Date(now);
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.text === 'string');
  const kinds = new Map(list.map((f) => [f.path, kindOf(f.path, f.text)]));
  const projects = list.filter((f) => kinds.get(f.path) === 'project');
  const ownerOf = makeProjectOwner(projects.map((p) => ({ path: p.path, names: projectNamesOf(p.path, p.text) })));
  const known = knownOf(list);
  const ctx: TidyCtx = { now: ref, known, ownerOf, meetings: new Map(), meetingEdits: new Map() };
  for (const f of list) {
    if (kinds.get(f.path) !== 'meeting') continue;
    let props: Record<string, unknown> = {};
    try {
      props = readProps(f.text) as Record<string, unknown>;
    } catch {
      props = {};
    }
    const rec = readMeeting({ path: f.path, title: shortName(f.path), props, content: f.text }, known);
    ctx.meetings.set(f.path, { project: ownerOf(f.path, projectPropOf(f.text)), actions: rec.actions.map((a) => ({ what: a.what, who: a.who ?? '', done: a.done, line: a.line, raw: a.raw })) });
  }
  const changes: TidyChange[] = [];
  const notes: TidyNoteReport[] = [];
  let tasksFolded = 0;
  let copiesRemoved = 0;
  let marksStripped = 0;
  let questionsFolded = 0;
  let remindersBoxed = 0;
  const unplaced: TidyUnplaced[] = [];
  for (const f of list) {
    const kind = kinds.get(f.path)!;
    if (kind === 'project') {
      const tidy = tidyProject(f.path, f.text, ctx);
      tasksFolded += tidy.tasks;
      remindersBoxed += tidy.reminders;
      copiesRemoved += tidy.copies;
      for (const u of tidy.unplaced) unplaced.push({ path: f.path, line: u.line, text: u.text, why: u.why });
      if (tidy.after !== f.text) changes.push({ path: f.path, before: f.text, after: tidy.after });
      if (tidy.after !== f.text || tidy.unplaced.length || tidy.became.length) notes.push({ path: f.path, kind, changed: tidy.after !== f.text, became: tidy.became, unplaced: tidy.unplaced });
    } else if (kind === 'meeting') {
      const tidy = tidyMeeting(f.path, f.text, ctx);
      tasksFolded += tidy.tasks;
      remindersBoxed += tidy.reminders;
      marksStripped += tidy.marks;
      questionsFolded += tidy.questions;
      for (const u of tidy.unplaced) unplaced.push({ path: f.path, line: u.line, text: u.text, why: u.why });
      if (tidy.after !== f.text) changes.push({ path: f.path, before: f.text, after: tidy.after });
      if (tidy.after !== f.text || tidy.unplaced.length || tidy.became.length) notes.push({ path: f.path, kind, changed: tidy.after !== f.text, became: tidy.became, unplaced: tidy.unplaced });
    } else {
      const tidy = tidyNote(f.text);
      tasksFolded += tidy.tasks;
      remindersBoxed += tidy.reminders;
      questionsFolded += tidy.questions;
      for (const u of tidy.unplaced) unplaced.push({ path: f.path, line: u.line, text: u.text, why: u.why });
      if (tidy.after !== f.text) changes.push({ path: f.path, before: f.text, after: tidy.after });
      if (tidy.after !== f.text || tidy.unplaced.length || tidy.became.length) notes.push({ path: f.path, kind, changed: tidy.after !== f.text, became: tidy.became, unplaced: tidy.unplaced });
    }
  }
  notes.sort((a, b) => a.path.localeCompare(b.path));
  unplaced.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { changes, report: { files: list.length, changed: changes.length, tasksFolded, copiesRemoved, marksStripped, questionsFolded, remindersBoxed, unplaced, notes } };
}

/** The dry-run report in plain words (the CLI prints it; the app previews it). */
export function tidyReportWords(report: TidyReport, dry: boolean): string {
  const lines = [`Vault tidy: ${dry ? 'dry run (nothing written)' : 'run on a copy'}`, `${plural(report.files, 'note')} read, ${report.changed ? `${report.changed} would change` : 'none would change'}.`, ''];
  for (const n of report.notes) {
    if (!n.became.length && !n.unplaced.length) continue;
    lines.push(`${n.path} (${n.kind})`);
    for (const b of n.became) lines.push(`  ${b[0].toUpperCase()}${b.slice(1)}`);
    for (const u of n.unplaced) lines.push(`  Line ${u.line} could not be placed: ${u.text} · ${u.why}`);
  }
  if (!report.notes.some((n) => n.became.length || n.unplaced.length)) lines.push('Every note is already the new shape.');
  lines.push('');
  const counts = [
    report.tasksFolded ? plural(report.tasksFolded, 'task') + ' folded' : '',
    report.copiesRemoved ? plural(report.copiesRemoved, 'copy') + ' removed' : '',
    report.marksStripped ? plural(report.marksStripped, 'filed mark') + ' stripped' : '',
    report.questionsFolded ? plural(report.questionsFolded, 'question') + ' gathered' : '',
    report.remindersBoxed ? plural(report.remindersBoxed, 'reminder') + ' boxed' : '',
    report.unplaced.length ? plural(report.unplaced.length, 'line') + ' could not be placed' : '',
  ].filter(Boolean);
  lines.push(counts.length ? counts.join(', ') + '.' : 'Nothing to do.');
  if (dry) lines.push('Nothing was written. Run with --to <folder> to tidy a copy.');
  return lines.join('\n');
}
