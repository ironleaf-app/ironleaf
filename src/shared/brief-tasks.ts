// One ranked list (4 Nov 2026, p12-today-focus round 4: "Next for you shows 'Own job 3, 3 days late' while "Old
// council letter" is 7 weeks late": the five were picked from project steps only). Project steps and the
// person's own dated tasks and reminders from any note rank through the same rank (rankNextForYou in
// src/shared/today.ts, never a second rank): a note's line is read as a step for the ranking, then mapped back
// to its note for the row and the tick. The former host app and Telegram's top five call topFiveFor with the
// same shapes. Pure: no app state. Built into the former host app's plugins by tools/build-embedded.mjs (as
// today-count.mjs). The morning brief's thin reader (p12-morning-five round 2): topFiveFromProjectTexts reads
// the files the caller gives it (projects and notes alike) and calls topFiveFor, never a second rank, so
// Telegram's five, Chat home's and Vault's Today are the same five for the same vault at the same moment.

import { isBoxDone } from './finished';
import { readProps } from './frontmatter';
import { daysApart, findTasks, groupDue, isoOf, locateTask, taskDue, taskKey, type DueEntry, type DueTask } from './hub';
import { isMeetingNote } from './meetings';
import { isNearKey, isSameKey, lineKeyOf, makeProjectOwner, projectNamesOf, projectPropOf, splitLineIdentity, stepKeyOf, type StepKey } from './one-task';
import { mergeGroups, sourceKindOf, sourceOf, type MergeRow } from './unified-tasks';
import { TASK_LINE, titleFromPath } from './markdown';
import { inFolder } from './paths';
import { applyProjectEdit, isProjectText, parseProject, serializeProject, textVersion } from './project-file';
import { findReminders, locateReminder, parseReminderLine, reminderKey, repeatText, rollReminder, setTicked, type ReminderItem } from './reminders';
import { buildToday, rankNextForYou, type DueItem } from './today';
import { isDormantProjectText, isLive, isOwnText, isStaleOffset } from './today-count';

/** How many the brief opens with. */
export const TOP_FIVE = 5;

/** A file as read (its path in the library, its text, when it last changed). Projects and notes alike. */
export interface BriefTaskFile {
  path: string;
  text: string;
  modified: number;
}

/** One item of the person's work, wherever it lives: a project step, or their own dated line in another note. */
export type TopWork = { kind: 'step'; step: DueItem } | { kind: 'note'; entry: DueEntry; offset: number };

/** A note line's days from today (a task's day, a reminder's day; null: no day, so it never ranks). A reminder
 *  whose moment passed today still reads 0: it ranks with today, as Due groups it. */
export function noteOffset(entry: DueEntry, now: Date | number): number | null {
  const n = now instanceof Date ? now : new Date(now);
  const today = isoOf(n);
  if (entry.kind === 'task') {
    if (!entry.day) return null;
    return daysApart(today, entry.day);
  }
  return daysApart(today, entry.day);
}

/** A note's line as a step for the ranking: its words, its day, no project at risk. The id keeps its key, so the
 *  ranked step maps back to its note; the renderer ticks by kind, never by this shape (a note's line is ticked
 *  through the hub, a step through its project file). */
function noteToStep(entry: DueEntry, offset: number): DueItem {
  const what = entry.kind === 'reminder' ? entry.item.text : entry.item.words;
  return {
    id: `note:${entry.key}`,
    kind: 'step',
    what,
    others: false,
    when: entry.day ?? '',
    offset,
    tone: 'none',
    project: entry.item.path,
    projectName: entry.item.title,
    version: '',
    index: entry.item.line,
  };
}

/** Every dated item ranked as one list, best first (steps and notes through rankNextForYou). Undated lines never
 *  rank: they wait in No date. Callers pass own lines only (isOwnText, as the counts do). */
export function rankAllFor(steps: DueItem[], entries: DueEntry[], now: Date | number): TopWork[] {
  const dated = entries
    .map((e) => ({ e, offset: noteOffset(e, now) }))
    .filter((x): x is { e: DueEntry; offset: number } => x.offset !== null);
  const asSteps = dated.map(({ e, offset }) => noteToStep(e, offset));
  const noteById = new Map(asSteps.map((s, i) => [s.id, dated[i]]));
  return rankNextForYou([...steps, ...asSteps]).map((s) => {
    const note = noteById.get(s.id);
    return note ? { kind: 'note', entry: note.e, offset: note.offset } : { kind: 'step', step: s };
  });
}

/**
 * The few next things for Today, the former host app and Telegram (4 Nov 2026, p12-today-focus round 4): the top
 * of the one ranked list. `steps` are the person's own project steps (kind step; dates never rank, as
 * rankNextForYou holds),
 * `entries` their own dated note lines (Due's overdue, today, week and later, own only). At most `n`.
 */
export function topFiveFor(steps: DueItem[], entries: DueEntry[], now: Date | number, n = 5): TopWork[] {
  return rankAllFor(steps, entries, now).slice(0, Math.max(0, n));
}

/** Late, Next and the rest as disjoint lists (vault rebuild step 2, 12 Nov 2026: Today answers Late, Next,
 *  then Waiting on an answer — each job shows once). Late is the ranked list's fresh late rows plus the dates'
 *  fresh late rows; Next is the first `n` of what is left; the rest waits in the fold with the dates that are
 *  not fresh late. From-a-while-back rows stay with the rest (their group renders last, as before). Pure. */
export function splitTodayTop(ranked: TopWork[], restDates: DueItem[], n = TOP_FIVE): { late: (TopWork | DueItem)[]; next: TopWork[]; rest: TopWork[]; restDates: DueItem[] } {
  const off = (w: TopWork) => (w.kind === 'step' ? w.step.offset : w.offset);
  const freshLate = (o: number) => o < 0 && !isStaleOffset(o);
  const upcoming = ranked.filter((w) => !freshLate(off(w)));
  return {
    late: [...ranked.filter((w) => freshLate(off(w))), ...restDates.filter((d) => freshLate(d.offset))],
    next: upcoming.slice(0, Math.max(0, n)),
    rest: upcoming.slice(Math.max(0, n)),
    restDates: restDates.filter((d) => !freshLate(d.offset)),
  };
}

/** One entry's words for the owner reading: a reminder's text, a task's words with its day taken out (as Due's
 *  card reads them, never the raw line). */
const dueOwnerText = (e: DueEntry): string => (e.kind === 'reminder' ? e.item.text : e.item.words);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Today as the project file's own lines write it ("4 Nov 2026", as Ironleaf's main side passes it). */
const dayStamp = (now: Date) => `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

/**
 * The person's top five from the files, through the one rank (p12-morning-five round 2): projects read as Today
 * reads them (buildToday, so someone else's steps, undated steps, done steps and shelved projects never qualify),
 * other notes' dated tasks and every live note's reminders read as Due reads them (findTasks, findReminders,
 * groupDue, own lines only), then topFiveFor. `me` is the person's name when the caller knows it (else the
 * projects' majority owner, as Today falls back). `known` is the vault's known people when the caller knows
 * them (t129, 9 Nov 2026: without it a stranger's tail read as waiting here while Today reads it as a mention,
 * never debt). Files that cannot be read are skipped. Never a second rank.
 */
export function topFiveFromProjectTexts(files: BriefTaskFile[], now: Date = new Date(), me?: string, known?: string[]): TopWork[] {
  const list = Array.isArray(files) ? files : [];
  const seen = new Set<string>();
  const projects: { path: string; version: string; modified: number; project: ReturnType<typeof parseProject> }[] = [];
  const notes: { path: string; text: string }[] = [];
  for (const f of list) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string' || seen.has(f.path)) continue;
    seen.add(f.path);
    if (isProjectText(f.text.slice(0, 4000))) {
      try {
        projects.push({ path: f.path, version: textVersion(f.text), modified: Number.isFinite(f.modified) ? f.modified : 0, project: parseProject(f.text, f.path) });
      } catch {
        continue;
      }
    } else {
      notes.push({ path: f.path, text: f.text });
    }
  }
  const ref = now instanceof Date ? now : new Date(now);
  // Dormant (finished or shelved) projects count nowhere (5 Nov 2026 one list): their notes' lines never rank, and a
  // note of no project folds against the live projects' open steps, so a daily copy never ranks beside its task.
  const liveByPath = new Map(projects.map((p) => [p.path, isLive(p.project.status)] as const));
  // The walks' mirror of the index's owner names (Nov 2026, b6 break job: title and file name only missed
  // alias- and folder-linked notes outside their project's folder). A note's `project` property read as one
  // (its raw text never named a project, so linked notes outside a dormant folder used to rank).
  const textByPath = new Map<string, string>();
  for (const f of list) if (f && typeof f.path === 'string' && typeof f.text === 'string' && !textByPath.has(f.path)) textByPath.set(f.path, f.text);
  const ownerOfNoteEarly = makeProjectOwner(projects.map((p) => ({ path: p.path, names: projectNamesOf(p.path, textByPath.get(p.path) ?? '') })));
  const dormantOwned = (notePath: string, text: string): boolean => {
    const owner = ownerOfNoteEarly(notePath, projectPropOf(text));
    return !!owner && liveByPath.get(owner) === false;
  };
  const today = buildToday({ projects, notes: [], ...(me ? { me } : {}) }, ref);
  const steps = [...today.due.overdue, ...today.due.today, ...today.due.soon, ...today.due.later, ...today.due.stale].filter((x) => x.kind === 'step');
  const meForNotes = today.me ?? (me?.trim() ? me.trim() : null);
  const tasks: DueTask[] = [];
  for (const n of notes) {
    if (inFolder(n.path, 'Templates')) continue;
    if (dormantOwned(n.path, n.text)) continue;
    let found;
    try {
      found = findTasks(n.text, ref);
    } catch {
      continue;
    }
    if (!found.length) continue;
    const title = titleFromPath(n.path);
    const twins = new Map<string, number>();
    for (const t of found) {
      const occurrence = twins.get(t.text) ?? 0;
      twins.set(t.text, occurrence + 1);
      let words = t.text;
      try {
        words = taskDue(t.text, ref).words || t.text;
      } catch {
        words = t.text;
      }
      tasks.push({ key: taskKey(n.path, t.text, occurrence), path: n.path, title, line: t.line, text: t.text, words, due: t.due });
    }
  }
  const reminders: ReminderItem[] = [];
  for (const f of list) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string') continue;
    if (inFolder(f.path, 'Templates')) continue;
    if (!f.text.includes('⏰')) continue;
    try {
      if (isDormantProjectText(f.text)) continue;
    } catch {
      continue;
    }
    if (dormantOwned(f.path, f.text)) continue;
    let found;
    try {
      found = findReminders(f.text);
    } catch {
      continue;
    }
    const title = titleFromPath(f.path);
    for (const r of found) reminders.push({ key: reminderKey(f.path, r), path: f.path, title, line: r.line, text: r.text, due: r.due, timeGiven: r.timeGiven, repeat: r.repeat ? repeatText(r.repeat) : null, done: r.done });
  }
  const groups = groupDue(tasks, reminders, ref.getTime());
  const own = [...groups.overdue, ...groups.today, ...groups.week, ...groups.later, ...groups.stale].filter((e) => isOwnText(dueOwnerText(e), meForNotes, ref, known));
  // One task, one row (p13-one-task): a note's line that is the same task as one of the ranked steps stays out — the
  // step is the row, on Telegram's five, Chat home's and the brief's alike. A note of no project folds against the
  // live steps (5 Nov 2026 one list: a daily copy never ranks beside its task). Reminders rank as themselves.
  const stepsByProject = new Map<string, StepKey[]>();
  for (const s of steps) stepsByProject.set(s.project, [...(stepsByProject.get(s.project) ?? []), stepKeyOf({ what: s.what, ...(s.who ? { who: s.who } : {}) })]);
  const liveSteps = [...stepsByProject.values()].flat();
  const noteFiles = new Map(notes.map((n) => [n.path, n.text]));
  const projectPaths = new Set(projects.map((p) => p.path));
  const rankedEntries = own.filter((e) => {
    if (e.kind !== 'task') return true;
    const owner = ownerOfNoteEarly(e.item.path, projectPropOf(noteFiles.get(e.item.path) ?? ''));
    const projectSteps = owner && projectPaths.has(owner) ? stepsByProject.get(owner) ?? [] : liveSteps;
    if (!projectSteps.length) return true;
    const key = lineKeyOf(dueOwnerText(e), ref);
    return !key || !projectSteps.some((s) => isSameKey(s, key) || isNearKey(s, key));
  });
  // One Task, one row (t238): lines that are the same task merge into one, carrying every source — shown, never
  // hidden, never ranked twice. The earliest day wins, so lateness never hides.
  const rows: MergeRow[] = rankedEntries.map((e, n) => {
    const item = e.item as DueTask;
    const project = e.kind === 'task' ? ownerOfNoteEarly(item.path, projectPropOf(noteFiles.get(item.path) ?? '')) : null;
    const type = e.kind === 'task' && isMeetingNote(item.path, readProps(noteFiles.get(item.path) ?? '')) ? 'meeting' : undefined;
    return {
      words: e.kind === 'task' ? item.words : '',
      text: e.kind === 'task' ? item.text : '',
      owner: e.kind === 'task' ? splitLineIdentity(item.words, ref).owner : '',
      due: e.kind === 'task' ? item.due : null,
      done: false,
      project: project && projectPaths.has(project) ? project : null,
      projectName: null,
      home: e.kind === 'task' ? { path: item.path, line: item.line } : { path: item.path, line: item.line },
      source: e.kind === 'task' ? sourceOf(sourceKindOf(item.path, project, type), item.path, item.title) : sourceOf('note', item.path, item.title),
      n,
    };
  });
  const merged = mergeGroups(rows, ref).map((g) => {
    const members = g.map((m) => ({ entry: rankedEntries[m.n ?? 0], source: m.source }));
    const prim = members[0].entry;
    if (prim.kind !== 'task') return prim;
    const seen = new Set<string>();
    const sources = members.map((m) => m.source).filter((s) => (seen.has(`${s.kind}\n${s.path}`) ? false : (seen.add(`${s.kind}\n${s.path}`), true)));
    const days = members.map((m) => (m.entry.kind === 'task' ? m.entry.day : null)).filter((d): d is string => !!d).sort();
    const item = prim.item as DueTask;
    return { ...prim, ...(days[0] && days[0] !== prim.day ? { day: days[0] } : {}), item: { ...item, ...(days[0] && days[0] !== item.due ? { due: days[0] } : {}), sources } };
  });
  return topFiveFor(steps, merged, ref, TOP_FIVE);
}

/**
 * A top-five step ticked done in its project file (the brief's Done, on every surface): the same one way in as
 * every other project change (parse, applyProjectEdit, serializeProject keeping every line it doesn't understand).
 * Refused when the file no longer has that step as shown (it was done, moved or reworded since the brief was made),
 * so Done never ticks the wrong line.
 */
export function tickProjectStep(text: string, index: number, expectedWhat: string, now: Date = new Date()): { text: string; said: string } {
  const before = String(text ?? '');
  const p = parseProject(before);
  const step = Number.isInteger(index) ? p.next[index] : undefined;
  if (!step) throw new Error('That task is no longer open: it was done or changed on your PC.');
  if (step.done) throw new Error('That task is already done.');
  if (step.what !== String(expectedWhat ?? '')) throw new Error('That task is no longer open: it was done or changed on your PC.');
  const said = applyProjectEdit(p, { kind: 'change', list: 'next', index, item: { done: true } }, dayStamp(now));
  return { text: serializeProject(p, before), said };
}

/**
 * A top-five note task ticked done in its note (the brief's Done for a note's line): the box in its line, as the
 * hub ticks it, refused when the line is no longer as shown, so Done never ticks the wrong line.
 */
export function tickNoteTask(text: string, line: number, expectedText: string, now: Date = new Date()): { text: string; said: string } {
  const before = String(text ?? '');
  if (!Number.isInteger(line)) throw new Error('That task is no longer open: it was done or changed on your PC.');
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const lines = before.split(/\r?\n/);
  const n = locateTask(lines, line, String(expectedText ?? ''));
  if (n < 0) throw new Error('That task is no longer open: it was done or changed on your PC.');
  const box = TASK_LINE.exec(lines[n]);
  if (box && isBoxDone(box[2])) throw new Error('That task is already done.');
  lines[n] = setTicked(lines[n], true);
  const ref = now instanceof Date ? now : new Date(now);
  let words = String(expectedText ?? '');
  try {
    words = taskDue(words, ref).words || words;
  } catch {
    words = String(expectedText ?? '');
  }
  return { text: lines.join(eol), said: `Done: ${words}.` };
}

/**
 * A top-five reminder ticked done in its note (the brief's Done for a reminder line): a one-off is done, a
 * repeating one moves on to its next time, as the reminders tick does. Refused when the line is no longer as
 * shown, so Done never ticks the wrong line.
 */
export function tickNoteReminder(text: string, line: number, expectedText: string, expectedDue?: number, now: Date = new Date()): { text: string; said: string } {
  const before = String(text ?? '');
  if (!Number.isInteger(line)) throw new Error('That task is no longer open: it was done or changed on your PC.');
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const lines = before.split(/\r?\n/);
  const due = Number(expectedDue);
  const n = locateReminder(lines, line, String(expectedText ?? ''), Number.isFinite(due) ? due : undefined);
  if (n < 0) throw new Error('That task is no longer open: it was done or changed on your PC.');
  const r = parseReminderLine(lines[n]);
  if (!r) throw new Error('That task is no longer open: it was done or changed on your PC.');
  if (r.done && !r.repeat) throw new Error('That task is already done.');
  const ref = now instanceof Date ? now : new Date(now);
  if (r.repeat) {
    const next = rollReminder(setTicked(lines[n], true), ref.getTime());
    if (next) {
      lines[n] = next;
      return { text: lines.join(eol), said: `Done: ${r.text}.` };
    }
  }
  lines[n] = setTicked(lines[n], true);
  return { text: lines.join(eol), said: `Done: ${r.text}.` };
}
