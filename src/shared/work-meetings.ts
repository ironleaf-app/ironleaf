// Meetings (Wave 6 part b, 24 Oct 2026; the catalogue, row 3: "Agenda, attendees, notes, decisions, actions,
// questions · transcript import · Work"). A meeting is the vault's own Meeting note (any note src/shared/meetings.ts
// isMeetingNote says is one): its date and time, attendees (people records), project and series in its properties;
// its agenda, decisions, actions and questions in its sections, read here into records; its recording and transcript
// written by the meeting recorder (src/shared/meeting-notes.ts). A series is a note of its own type (cadence, day,
// time, attendees, project, standing agenda) that its meetings name with `series:`. A meeting in a project has its
// actions as that project's tasks from the moment they are written (t238: no filing, no copies); ticking one ticks
// the one thing everywhere through the cascade (src/main/one-task.ts).
//
// Also here: a transcript someone pastes or uploads (Teams or Zoom's VTT, SRT, "Name: words" or "[00:01:02] Name: …")
// read into the recorder's own transcript lines; the prep pack's words; the agent tools. Pure: no files, no DOM.

import { ACTION_HEADING, AGENDA_HEADING, DECISION_HEADING, findActions, FILED_MARK, isMeetingNote, meetingDate, notePeople, readAction, sameJob, sameWhat } from './meetings';
import { isoDay, readDay } from './days';
import { clockWords, readClockTime } from './clock';
import { readTranscript, wholeSentences } from './meeting-notes';
import { QUESTION_HEADING, findQuestions } from './questions';
import type { TranscriptLine } from './recorder';
import { readProps } from './frontmatter';
import type { WorkToolDef } from './work-module-tools';
import { addDays, dateOf, isoOf } from './finance';
import { cleanFileName } from './paths';
import { ownerCompatible } from './today-count';
import { linkName, str, yamlWords } from './work-text';

export { isoOf, linkName };

export interface MeetingItem {
  text: string;
  done: boolean;
  /** Its line in the note (0 is the first, the properties counted), and the line as written (so a tick lands on it). */
  line: number;
  raw: string;
}
export interface MeetingActionRec {
  line: number;
  raw: string;
  what: string;
  who?: string;
  due?: string;
  whenWords?: string;
  done: boolean;
  /** The project it was filed into (its " → [[Project]]" mark). */
  filedTo?: string;
}
export interface MeetingQuestionRec {
  line: number;
  raw: string;
  what: string;
  askedBy?: string;
  /** Asked of, or owned by. */
  owner?: string;
  answer?: string;
  answered: boolean;
  /** Their notes (typed links, resolved where the model is made; rename-proof when written as [[paths]]). */
  askedByPath?: string;
  ownerPath?: string;
}
export interface MeetingRec {
  path: string;
  title: string;
  /** Its day (YYYY-MM-DD), and whether that came from the note (a property or its name) rather than when it was made. */
  date: string;
  dated: boolean;
  time: string;
  where: string;
  people: string[];
  project: string;
  series: string;
  agenda: MeetingItem[];
  decisions: MeetingItem[];
  actions: MeetingActionRec[];
  /** Its questions (src/shared/questions.ts): asked, open until answered, never lost. */
  questions: MeetingQuestionRec[];
  summary: string;
  /** Recordings and transcript parts written into it. */
  transcripts: number;
  recordings: number;
  /** When the note last changed (8.9, ms, 0 when unknown): for last change wins with the calendar. */
  mtime: number;
  /** The linked event and calendar (8.9, '' when not on a calendar). */
  calendarEvent: string;
  calendarId: string;
  /** When the note and the event last agreed (8.9, ms, 0 when never). */
  syncedAt: number;
}

export interface SeriesRec {
  path: string;
  name: string;
  cadence: string;
  /** 0 Monday … 6 Sunday, or -1. */
  day: number;
  time: string;
  where: string;
  attendees: string[];
  project: string;
  standing: string[];
  /** Its meetings, newest first. */
  meetings: string[];
  /** The next one's day (worked out from its cadence and day, or its last meeting), when it comes round. */
  next: string | null;
}

const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/\s*[,;]\s*/) : []).map((x) => linkName(String(x))).filter(Boolean);

const AGENDA = AGENDA_HEADING;

/** Whether a line sits under an agenda heading (12 Nov 2026, t240: ticking one marks it covered, never done as
 *  a job, so the one-task cascade stays out of it). Walks up past deeper headings to the line's own section. */
export function lineInAgenda(text: string, line: number): boolean {
  const lines = String(text ?? '').split(/\r?\n/);
  if (line < 0 || line >= lines.length) return false;
  for (let i = line; i >= 0; i--) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!h) continue;
    if (AGENDA.test(h[2].replace(/:$/, '').trim())) return true;
    if (h[1].length <= 2) return false;
  }
  return false;
}
const DECISIONS = DECISION_HEADING;
const ACTIONS = ACTION_HEADING;
const SUMMARY = /^(meeting\s+)?summary$/i;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX\-~>])\]\s+)?(.*)$/;
const EMPTY_LINE = /^(no (decisions|actions) were recorded\.?|what needs doing\s*[—–-]+\s*who\s*[—–-]+\s*by when|-+)$/i;

/** The sections of a note: each heading's words, level and lines [start, end) (lines counted from the top). */
export function sectionsOf(lines: string[], from: number): { words: string; level: number; start: number; end: number }[] {
  const out: { words: string; level: number; start: number; end: number }[] = [];
  let fence = false;
  for (let i = from; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (h) out.push({ words: h[2].replace(/:$/, '').trim(), level: h[1].length, start: i, end: lines.length });
  }
  for (let k = 0; k < out.length; k++) {
    const next = out.slice(k + 1).find((s) => s.level <= out[k].level);
    out[k].end = next ? next.start : lines.length;
  }
  return out;
}
const frontEnd = (lines: string[]) => {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < Math.min(lines.length, 400); i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1;
  return 0;
};
const tidy = (s: string) =>
  s
    .replace(FILED_MARK, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop()!)
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .trim();

/** The list lines of a section: its items with their tick (none written yet: nothing). */
function itemsOf(lines: string[], s: { start: number; end: number }): MeetingItem[] {
  const out: MeetingItem[] = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].replace(/\t/g, '  ').length >= 2) continue;
    const text = tidy(m[3]);
    if (!text || EMPTY_LINE.test(text)) continue;
    out.push({ text, done: !!m[2] && m[2] !== ' ', line: i, raw: lines[i] });
  }
  return out;
}

/**
 * A meeting time as a person reads it, one way everywhere (sweep 3, 015: "10:00" beside "12:00 AM" on one
 * table, and "12:00 AM" for a meeting with no time). "10:00", "10:00 AM" and "22:00" all read "10:00 am";
 * midnight written as a time ("00:00", "12:00 AM") is how a date with no time is stored, so it reads as
 * nothing. Words that are not a time stay as written. Read the one shared way (8.7 urgent, 30 Oct 2026),
 * so "3.00 pm" and seconds read too.
 */
export function meetingTimeWords(raw?: string | null): string {
  const t = readClockTime(typeof raw === 'string' ? raw : '');
  if (!t) return String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (t.hours === 0 && t.minutes === 0) return '';
  const hour12 = t.hours % 12 === 0 ? 12 : t.hours % 12;
  return `${hour12}:${String(t.minutes).padStart(2, '0')} ${t.hours < 12 ? 'am' : 'pm'}`;
}

/** "11:00 AM", "14:30" from a When line or the time property. */
function timeOf(props: Record<string, unknown>, text: string): string {
  const t = str(props.time ?? props.start);
  if (t) return t;
  const when = /^\s*(?:\*\*)?when(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/im.exec(text);
  const m = when ? /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i.exec(when[1]) : null;
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase().replace(/(AM|PM)$/, ' $1').replace(/\s+/g, ' ').trim() : '';
}
/** People named on an "Invited:" line: full names only (first and last), so a phrase is never taken for someone. */
function invited(text: string): string[] {
  const line = /^\s*(?:\*\*)?(?:who (?:is|was|are) invited|invited|invitees|attending|participants)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/im.exec(text);
  if (!line) return [];
  return [...line[1].matchAll(/\b([A-Z][\p{L}'’-]+(?:\s+(?:de|van|von|da|di|le|la)?\s*[A-Z][\p{L}'’-]+)+)\b/gu)].map((m) => m[1].trim()).filter((n) => !/^(Microsoft Teams|Google Meet|At \d|US Eastern)/.test(n));
}

/** A meeting note read into its parts (`known` people make "Sam to…" readable as Sam Okafor's). */
export function readMeeting(n: { path: string; title: string; props: Record<string, unknown>; content: string; mtime?: number }, known: string[] = []): MeetingRec {
  const text = n.content ?? '';
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const props = n.props ?? {};
  const fallback = new Date(n.mtime ?? Date.now());
  const d = meetingDate(n.path, props, fallback);
  const dated = isoOf(d) !== isoOf(fallback) || !!props.date || /\d{4}-\d{2}-\d{2}/.test(n.path.split('/').pop() ?? '');
  const people = [...new Set([...notePeople(text, props), ...invited(text)].map((p) => linkName(p)).filter(Boolean))];
  const secs = sectionsOf(lines, frontEnd(lines));
  const agendaSecs = secs.filter((s) => AGENDA.test(s.words));
  const inAgenda = (line: number) => agendaSecs.some((s) => line > s.start && line < s.end);
  const agenda = agendaSecs.flatMap((s) => itemsOf(lines, s));
  const decisions = secs.filter((s) => DECISIONS.test(s.words)).flatMap((s) => itemsOf(lines, s));
  const opts = { date: d, people: [...new Set([...people, ...known])] };
  const open = findActions(text, opts).filter((a) => !inAgenda(a.line));
  const actions: MeetingActionRec[] = open.map((a) => ({ line: a.line, raw: a.raw, what: a.what, ...(a.who ? { who: a.who } : {}), ...(a.due ? { due: a.due } : {}), ...(a.whenWords ? { whenWords: a.whenWords } : {}), done: false, ...(a.filedTo ? { filedTo: a.filedTo } : {}) }));
  // Ticked actions (findActions leaves them out): under an Actions heading, each once — another owner's same
  // words their own row, as above (t179).
  const seen: { key: string; who?: string }[] = actions.map((a) => ({ key: sameWhat(a.what), ...(a.who ? { who: a.who } : {}) }));
  for (const s of secs.filter((x) => ACTIONS.test(x.words)))
    for (let i = s.start + 1; i < s.end; i++) {
      const m = ITEM.exec(lines[i]);
      if (!m || !m[2] || m[2] === ' ') continue;
      const filed = FILED_MARK.exec(m[3]);
      const r = readAction(filed ? m[3].slice(0, filed.index) : m[3], opts);
      if (!r || seen.some((s) => s.key === sameWhat(r.what) && ownerCompatible(s.who, r.who))) continue;
      seen.push({ key: sameWhat(r.what), ...(r.who ? { who: r.who } : {}) });
      actions.push({ line: i, raw: lines[i], what: r.what, ...(r.who ? { who: r.who } : {}), ...(r.due ? { due: r.due } : {}), ...(r.whenWords ? { whenWords: r.whenWords } : {}), done: true, ...(filed ? { filedTo: filed[1].trim().split('/').pop()!.replace(/\.md$/i, '') } : {}) });
    }
  actions.sort((a, b) => a.line - b.line);
  const questions: MeetingQuestionRec[] = findQuestions(text).map((q) => ({ line: q.line, raw: q.raw, what: q.what, ...(q.askedBy ? { askedBy: q.askedBy } : {}), ...(q.owner ? { owner: q.owner } : {}), ...(q.answer ? { answer: q.answer } : {}), answered: q.answered }));
  const sum = secs.find((s) => SUMMARY.test(s.words));
  const parts = readTranscript(text);
  const whereLine = /^\s*(?:\*\*)?where(?:\*\*)?\s*:?\s*(?:\*\*)?\s*:?\s*(.+)$/im.exec(text);
  const syncedRaw = props['calendar-synced'];
  const syncedAt = typeof syncedRaw === 'number' && Number.isFinite(syncedRaw) ? Math.floor(syncedRaw) : typeof syncedRaw === 'string' && syncedRaw.trim() ? (Number.isNaN(Date.parse(syncedRaw)) ? 0 : Date.parse(syncedRaw)) : 0;
  return {
    path: n.path,
    title: n.title,
    date: isoOf(d),
    dated,
    time: timeOf(props, text),
    where: str(props.where ?? props.location) || (whereLine ? tidy(whereLine[1]).slice(0, 120) : ''),
    people,
    project: linkName(str(props.project)),
    series: linkName(str(props.series)),
    agenda,
    decisions,
    actions,
    questions,
    summary: sum ? lines.slice(sum.start + 1, sum.end).join('\n').trim() : '',
    transcripts: parts.filter((p) => p.lines.length).length,
    recordings: parts.filter((p) => p.recording).length,
    mtime: typeof n.mtime === 'number' && Number.isFinite(n.mtime) ? Math.floor(n.mtime) : 0,
    calendarEvent: str(props['calendar-event']).slice(0, 200),
    calendarId: str(props['calendar-id']).slice(0, 200),
    syncedAt,
  };
}

/** The day a series next meets on or after `today`: its weekday (every week, or every second week from its last
 *  meeting), a month after its last meeting, or none for one that's ad hoc. */
export function nextOfSeries(s: Pick<SeriesRec, 'cadence' | 'day'>, today: string, lastDate: string | null): string | null {
  const cad = s.cadence.toLowerCase();
  if (cad === 'ad hoc') return null;
  if (cad === 'monthly') {
    if (!lastDate) return s.day >= 0 ? nextWeekday(today, s.day) : null;
    let d = dateOf(lastDate);
    while (isoOf(d) < today) d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return isoOf(d);
  }
  const step = cad === 'fortnightly' ? 14 : 7;
  if (s.day < 0) {
    if (!lastDate) return null;
    let d = lastDate;
    while (d < today) d = addDays(d, step);
    return d;
  }
  let d = nextWeekday(today, s.day);
  if (step === 14 && lastDate) {
    const weeks = Math.round((dateOf(d).getTime() - dateOf(lastDate).getTime()) / (7 * 86_400_000));
    if (weeks % 2 === 1) d = addDays(d, 7);
  }
  return d;
}
function nextWeekday(today: string, day: number): string {
  const d = dateOf(today);
  const now = (d.getDay() + 6) % 7;
  return addDays(today, (day - now + 7) % 7);
}

export function readSeries(n: { path: string; title: string; props: Record<string, unknown>; content: string }, meetings: readonly MeetingRec[], today: string): SeriesRec {
  const p = n.props ?? {};
  const lines = (n.content ?? '').split(/\r?\n/);
  const secs = sectionsOf(lines, frontEnd(lines));
  const standing = secs.filter((s) => /standing agenda|agenda/i.test(s.words)).flatMap((s) => itemsOf(lines, s)).map((i) => i.text);
  const name = n.title;
  const mine = meetings.filter((m) => m.series && m.series.toLowerCase() === name.toLowerCase()).sort((a, b) => b.date.localeCompare(a.date));
  const dayWord = str(p.day).toLowerCase();
  const s: SeriesRec = { path: n.path, name, cadence: str(p.cadence) || 'Weekly', day: WEEKDAY_NAMES.findIndex((w) => w.startsWith(dayWord.slice(0, 3)) && dayWord.length >= 3), time: str(p.time), where: str(p.where), attendees: listOf(p.attendees ?? p.people), project: linkName(str(p.project)), standing, meetings: mine.map((m) => m.path), next: null };
  const last = mine.find((m) => m.date < today) ?? null;
  const upcoming = mine.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  s.next = upcoming ? upcoming.date : nextOfSeries(s, today, last?.date ?? null);
  return s;
}

export interface MeetingsModel {
  today: string;
  meetings: MeetingRec[];
  upcoming: MeetingRec[];
  recent: MeetingRec[];
  series: SeriesRec[];
}

/** Every meeting, newest first, and what the module's pages lead with. A meeting in a project has its actions as
 *  that project's tasks from the moment they are written (t238: nothing to carry, so no to-file list). */
export function meetingsModel(notes: readonly { path: string; title: string; props: Record<string, unknown>; content: string; mtime?: number; type?: string }[], today: Date = new Date(), opts: { known?: string[]; seriesType?: string } = {}): MeetingsModel {
  const t = isoOf(today);
  const seriesNotes = notes.filter((n) => n.type === (opts.seriesType ?? 'meeting-series') || String(n.props?.type ?? '').toLowerCase() === 'meeting-series');
  const meetings = notes
    .filter((n) => !seriesNotes.includes(n) && isMeetingNote(n.path, n.props))
    .map((n) => readMeeting(n, opts.known ?? []))
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.title.localeCompare(b.title));
  const series = seriesNotes.map((n) => readSeries(n, meetings, t)).sort((a, b) => (a.next ?? '9').localeCompare(b.next ?? '9') || a.name.localeCompare(b.name));
  const upcoming = meetings.filter((m) => m.dated && m.date >= t).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const recent = meetings.filter((m) => !(m.dated && m.date >= t));
  return { today: t, meetings, upcoming, recent, series };
}

/** Whether an action is done, counting its project's copy: filed into a project and ticked there is done here too —
 *  only its own copy (t179): another owner's ticked same words never finish it. */
export function actionDone(a: MeetingActionRec, projectSteps: { what: string; who?: string; done: boolean }[] = []): boolean {
  if (a.done) return true;
  return projectSteps.some((s) => s.done && sameWhat(s.what) === sameWhat(a.what) && ownerCompatible(s.who, a.who));
}

// ── A meeting's note, made and changed ───────────────────────────────────────────────────────────────────────────────

export interface MeetingInput {
  title: string;
  date: string;
  time?: string;
  where?: string;
  attendees?: string[];
  project?: string;
  series?: string;
  agenda?: string[];
  /** Carried over from the last meeting of its series (its open actions, its items not reached). */
  carried?: string[];
}

/** A new meeting note: the vault's Meeting type, its people as links, its agenda as tick boxes. The file name
 *  cannot hold a colon (6 Nov 2026, "Fitzroy cafe opening: weekly" lost its colon): when the display title holds
 *  what the file system refuses, it is kept in full in `title:` so the note still shows it. The same when the file
 *  took a copy number to stay unique (6 Nov 2026, the second same-day meeting showed its " 2" as its name):
 *  `fileBase` is the file's own name, and `title:` keeps what the person typed whenever the file is not it. */
export function newMeetingText(m: MeetingInput & { fileBase?: string }): string {
  const people = (m.attendees ?? []).map((p) => p.trim()).filter(Boolean);
  const full = `${m.date} ${m.title}`.trim();
  const safe = cleanFileName(full, '', 100, 'project').replace(/^[. ]+/, '');
  const kept = full && (safe !== full || (m.fileBase !== undefined && m.fileBase !== safe)) ? [`title: ${yamlWords(full)}`] : [];
  const front = [
    'type: meeting',
    ...kept,
    `date: ${m.date}`,
    ...(m.time ? [`time: ${yamlWords(m.time)}`] : []),
    ...(people.length ? ['people:', ...people.map((p) => `  - "[[${linkName(p)}]]"`)] : []),
    ...(m.project ? [`project: "[[${linkName(m.project)}]]"`] : []),
    ...(m.series ? [`series: "[[${linkName(m.series)}]]"`] : []),
    ...(m.where ? [`where: ${yamlWords(m.where)}`] : []),
  ];
  const agenda = [...(m.agenda ?? []), ...(m.carried ?? [])].map((a) => a.trim()).filter(Boolean);
  return `---\n${front.join('\n')}\n---\n## Agenda\n\n${agenda.length ? agenda.map((a) => `- [ ] ${a}`).join('\n') : '- [ ] '}\n\n## Notes\n\n\n## Decisions\n\n\n## Questions\n\n\n## Actions\n\n`;
}

/** The note with a line added at the end of a section (made, before Actions or at the end, when it isn't there). */
export function addToSection(text: string, heading: RegExp, title: string, line: string, before: RegExp[] = []): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const secs = sectionsOf(lines, frontEnd(lines));
  const s = secs.find((x) => heading.test(x.words));
  if (s) {
    let end = s.end;
    while (end > s.start + 1 && !lines[end - 1].trim()) end--;
    // The template's empty "- [ ]" is taken away first.
    if (end === s.start + 2 && /^\s*[-*+]\s+(\[ \]\s*)?$/.test(lines[s.start + 1])) {
      lines.splice(s.start + 1, 1, line);
      return lines.join(eol);
    }
    const blankAfterHeading = end === s.start + 1;
    lines.splice(end, 0, ...(blankAfterHeading ? ['', line] : [line]));
    return lines.join(eol);
  }
  const next = before.map((b) => secs.find((x) => b.test(x.words))).find(Boolean);
  if (next) {
    lines.splice(next.start, 0, `## ${title}`, '', line, '');
    return lines.join(eol);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return `${lines.join(eol)}${eol}${eol}## ${title}${eol}${eol}${line}${eol}`;
}
/** The note split at its Transcript section: everything before it (and after it, any section that follows) and the
 *  section itself, word for word ('' when there is none). */
export function splitTranscript(text: string): { rest: string; section: string } {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^##\s+transcript\s*$/i.test(l));
  if (at < 0) return { rest: text, section: '' };
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) if (/^##\s+\S/.test(lines[i]) && !/^###/.test(lines[i])) {
    end = i;
    break;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rest = [...lines.slice(0, at), ...lines.slice(end)].join(eol).replace(/\s*$/, eol);
  return { rest, section: `${lines.slice(at, end).join(eol).replace(/\s*$/, '')}${eol}` };
}
export { AGENDA_HEADING };
export const DECISIONS_HEADING = DECISIONS;
export const ACTIONS_HEADING = ACTIONS;
export const QUESTIONS_HEADING = QUESTION_HEADING;

/** A list line's tick set (the line found by its number, checked against its words so a moved line is never ticked). */
export function setTick(text: string, line: number, raw: string, done: boolean): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let i = line;
  if (lines[i]?.replace(/\r$/, '') !== raw.replace(/\r$/, '')) i = lines.findIndex((l) => l.replace(/\r$/, '') === raw.replace(/\r$/, ''));
  if (i < 0) throw new Error('That line changed in the note just now. Look again and tick it there.');
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[[ xX\-~>]\]\s+)?(.*)$/.exec(lines[i]);
  if (!m) throw new Error('That line isn’t a list line any more.');
  lines[i] = `${m[1]}[${done ? 'x' : ' '}] ${m[2]}`;
  return lines.join(eol);
}

// ── A transcript someone has (pasted or a file) ──────────────────────────────────────────────────────────────────────

const clock = (h: string | undefined, m: string, s: string, ms?: string) => (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + (ms ? Number(`0.${ms}`) : 0));

/**
 * A transcript's words read into timed lines with who said them: WebVTT (Teams, Zoom: "00:01:02.000 --> …" then "<v Sam
 * Lee>words" or "Sam Lee: words"), SRT, Teams' Word export ("Sam Lee   0:03" then the words), "[00:01:02] Sam: words",
 * "00:01:02 Sam: words", "Sam (00:01:02): words", or plain "Sam: words" lines (no times: each a moment after the last).
 * A speaker's lines that follow each other are joined. Empty when nothing reads as words.
 */
export function readTranscriptText(input: string): TranscriptLine[] {
  const text = String(input ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: TranscriptLine[] = [];
  const push = (at: number, who: string | undefined, words: string) => {
    const t = words.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const w = who?.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
    const prev = out[out.length - 1];
    if (prev && prev.who === w && at - prev.at < 60 && prev.text.length < 1200) prev.text = `${prev.text} ${t}`;
    else out.push({ at: Math.max(0, Math.round(at)), text: t, ...(w ? { who: w } : {}) });
  };
  const CUE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*-->\s*/;
  if (/^WEBVTT/.test(text.trim()) || lines.some((l) => CUE.test(l.trim()))) {
    for (let i = 0; i < lines.length; i++) {
      const c = CUE.exec(lines[i].trim());
      if (!c) continue;
      const at = clock(c[1], c[2], c[3], c[4]);
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j].trim(); j++) body.push(lines[j].trim());
      let who: string | undefined;
      let words = body.join(' ');
      const v = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/.exec(words);
      if (v) {
        who = v[1];
        words = v[2];
      } else {
        const named = /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}):\s+(.+)$/u.exec(words);
        if (named) {
          who = named[1];
          words = named[2];
        }
      }
      push(at, who, words);
    }
    return out;
  }
  let lastAt = 0;
  let pending: { who: string; at: number } | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    // Teams' Word export: "Sam Lee   0:03" (or "Sam Lee 1:02:33") on its own line, the words on the next.
    const head = /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})\s{1,}(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/u.exec(l);
    if (head) {
      pending = { who: head[1], at: clock(head[2], head[3], head[4]) };
      continue;
    }
    const a = /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?\]?\s*[-–—]?\s*(?:([^:]{1,60}?):\s+)?(.+)$/.exec(l);
    if (a && (a[1] !== undefined || /^\[|^\d{1,2}:\d{2}\s/.test(l))) {
      lastAt = clock(a[1], a[2], a[3]);
      push(lastAt, a[4], a[5]);
      pending = null;
      continue;
    }
    const b = /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})\s*\((?:(\d{1,2}):)?(\d{1,2}):(\d{2})\)\s*:?\s*(.+)$/u.exec(l);
    if (b) {
      lastAt = clock(b[2], b[3], b[4]);
      push(lastAt, b[1], b[5]);
      pending = null;
      continue;
    }
    if (pending) {
      lastAt = pending.at;
      push(pending.at, pending.who, l);
      continue;
    }
    const c = /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}):\s+(.+)$/u.exec(l);
    if (c) {
      lastAt += 5;
      push(lastAt, c[1], c[2]);
      continue;
    }
    lastAt += 5;
    push(lastAt, out[out.length - 1]?.who, l);
  }
  return out;
}

/** How long a transcript runs, in seconds (its last line's moment, and a little for the words said then). */
export const transcriptSeconds = (lines: readonly TranscriptLine[]) => (lines.length ? lines[lines.length - 1].at + Math.min(60, Math.ceil(lines[lines.length - 1].text.split(/\s+/).length / 2.5)) : 0);

// ── The prep pack ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PrepItem {
  what: string;
  who?: string;
  due?: string;
  /** Where it is written (a meeting's or a project's note) and its name. */
  path: string;
  from: string;
  overdue?: boolean;
}
export interface PrepPack {
  meeting: { path: string; title: string; date: string; time: string };
  /** Each attendee's open items: theirs to do, and what others wait on them for; the last time they met. */
  people: { name: string; theirs: PrepItem[]; lastMet: { path: string; title: string; date: string } | null }[];
  /** The series' last meeting: its open actions and the agenda items it didn't reach. */
  last: { path: string; title: string; date: string; open: PrepItem[]; notReached: string[] } | null;
  /** The project's open items needing attention. */
  project: { name: string; path: string; items: PrepItem[] } | null;
  /** Earlier meetings with most of the same people: their open actions. */
  earlier: PrepItem[];
  /** Notes that link to the meeting or that it links to (round 3: the meeting's real context). */
  linked: PrepItem[];
  /** The project's recent notes (round 3: what the project said lately). */
  recent: PrepItem[];
  /** How many items in all (Today's line: "4 open items with the people coming"). */
  count: number;
}

/** The prep pack's words for an assistant. */
export function prepWords(p: PrepPack): string {
  const lines = [`Prep for ${p.meeting.title} (${p.meeting.date}${p.meeting.time ? ` ${p.meeting.time}` : ''}) [${p.meeting.path}]: ${p.count} open ${p.count === 1 ? 'item' : 'items'}.`];
  const item = (x: PrepItem) => `  - ${x.what}${x.who ? ` — ${x.who}` : ''}${x.due ? ` · due ${x.due}${x.overdue ? ' (overdue)' : ''}` : ''} (from ${x.from})`;
  if (p.last) lines.push(`Last time (${p.last.title}, ${p.last.date}): ${p.last.open.length} open actions${p.last.notReached.length ? `, ${p.last.notReached.length} agenda items not reached` : ''}.`, ...p.last.open.map(item), ...p.last.notReached.map((x) => `  - Not reached: ${x}`));
  for (const person of p.people) if (person.theirs.length) lines.push(`${person.name}: ${person.theirs.length} open${person.lastMet ? ` (last met ${person.lastMet.date}, ${person.lastMet.title})` : ''}`, ...person.theirs.map(item));
  if (p.project?.items.length) lines.push(`${p.project.name} needs attention:`, ...p.project.items.map(item));
  if (p.earlier.length) lines.push('From earlier meetings with the same people:', ...p.earlier.map(item));
  if (p.linked.length) lines.push('Linked notes:', ...p.linked.map(item));
  if (p.recent.length) lines.push('Recent on the project:', ...p.recent.map(item));
  return lines.join('\n');
}

/** Prep items with this meeting's project first (18 Nov 2026, t301: prep for an EW lighting meeting led with Northgate,
 *  Brackwater and Windows items from other projects). Stable: each half keeps its order, so the project's own
 *  telling also wins the pack's dedup. */
export function prepProjectFirst<T>(items: readonly T[], onProject: (x: T) => boolean): T[] {
  return [...items.filter(onProject), ...items.filter((x) => !onProject(x))];
}

/** Prep things with each thing once (6 Nov 2026, o3-meeting-page item 3): the same deed said twice in different
 *  words ("Ring Merricks Creek and confirm the first delivery in writing" beside "Ring Merricks Creek Dairy and
 *  confirm first delivery in writing") keeps its first telling only, by the minutes' own sameness test. */
export function prepDistinct<T extends { what: string; who?: string }>(items: readonly T[]): T[] {
  const kept: T[] = [];
  // Another owner's same words are their item, never a re-telling (t179).
  for (const x of items) if (!kept.some((k) => sameJob(k.what, x.what) && ownerCompatible(k.who, x.who))) kept.push(x);
  return kept;
}

/** The prep answer on the meeting page (8.7 w2b round 2, the mock's Prep card): the pack's open items as short
 *  sentences with citation numbers, and the distinct notes they come from as sources. Every word comes from the
 *  vault; the numbers are the sources' order here, so 1 is the first source below. Each lead's things are its
 *  distinct ones (prepDistinct), at most three, the rest counted in `more` — the page draws a lead as its own
 *  block of separate lines, never one joined-up paragraph (6 Nov 2026, o3-meeting-page item 3). */
export interface PrepAnswer {
  sentences: { lead: string; whats: { what: string; cite: number }[]; more?: number }[];
  sources: { path: string; title: string }[];
}
export function prepAnswer(p: PrepPack): PrepAnswer {
  const sources: { path: string; title: string }[] = [];
  const idx = new Map<string, number>();
  const cite = (path: string, title: string): number => {
    const key = path.toLowerCase();
    let n = idx.get(key);
    if (!n) {
      sources.push({ path, title });
      n = sources.length;
      idx.set(key, n);
    }
    return n;
  };
  const sentences: PrepAnswer['sentences'] = [];
  // One lead's lines: its distinct things, at most three, the rest counted (never a telling counted twice).
  // Note titles keep the exact test only, as in the pack's own building: two notes can share most of a title.
  const lines = (items: readonly PrepItem[], near = true): { whats: { what: string; cite: number }[]; more: number } => {
    const distinct = near ? prepDistinct(items) : items.filter((x, i) => items.findIndex((y) => sameWhat(y.what) === sameWhat(x.what)) === i);
    const whats = distinct.slice(0, 3).map((x) => ({ what: x.what, cite: cite(x.path, x.from) }));
    return { whats, more: distinct.length - whats.length };
  };
  const add = (lead: string, items: readonly PrepItem[], near = true) => {
    const { whats, more } = lines(items, near);
    if (whats.length) sentences.push({ lead, whats, ...(more > 0 ? { more } : {}) });
  };
  if (p.last && (p.last.open.length > 0 || p.last.notReached.length > 0)) {
    const whats: { what: string; cite: number }[] = [];
    const open = prepDistinct(p.last.open);
    for (const x of open.slice(0, 3)) whats.push({ what: x.what, cite: cite(x.path, x.from) });
    const unreached = prepDistinct(p.last.notReached.map((t) => ({ what: t })));
    for (const t of unreached.slice(0, Math.max(0, 3 - whats.length))) whats.push({ what: `Not reached: ${t.what}`, cite: cite(p.last.path, p.last.title) });
    const more = open.length + unreached.length - whats.length;
    if (whats.length) sentences.push({ lead: `Last time (${p.last.title})`, whats, ...(more > 0 ? { more } : {}) });
  }
  for (const person of p.people) {
    if (!person.theirs.length || sentences.length >= 6) continue;
    add(person.name, person.theirs);
  }
  if (p.project && p.project.items.length > 0 && sentences.length < 6) add(`${p.project.name} needs attention`, p.project.items);
  if (p.earlier.length > 0 && sentences.length < 6) add('From earlier meetings', p.earlier);
  if (p.linked.length > 0 && sentences.length < 6) add('Linked notes', p.linked, false);
  if (p.recent.length > 0 && sentences.length < 6) add('Recent on the project', p.recent, false);
  return { sentences, sources };
}

/** A prep sheet for one meeting (8.3 wave 1, 30 Oct 2026): who is coming, what is open with each of them, the last
 *  meeting's open actions, and where its project stands. Written from the prep pack; the person's model may reword
 *  it, but every item here comes from the vault. */
/** "Sat 31 Oct" from an ISO day, and "8:00 am" from "08:00": the sheet and the draft are read by people, not parsed. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayName(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
/** A meeting's title without the day its note name starts with ("2026-10-31 Menu tasting" → "Menu tasting"). */
const bareTitle = (t: string) => t.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') || t;

/** The prep sheet saved into the meeting's note (8.3 wave 1), written for a person to read before walking in: days in
 *  words, one heading per part, and a person's name said once (30 Oct 2026: the first sheets read "2026-10-31" and
 *  "— Alex Rivera" under "Open with Alex Rivera" on every line). */
export function prepSheetWords(p: PrepPack): string {
  const item = (x: PrepItem, owner?: string) => `- ${x.what}${x.who && x.who !== owner ? ` (${x.who})` : ''}${x.due ? ` · ${x.overdue ? 'was due' : 'due'} ${dayName(x.due)}${x.overdue ? ', overdue' : ''}` : ''}`;
  const lines = [`For **${bareTitle(p.meeting.title)}**, ${dayName(p.meeting.date)}${p.meeting.time ? ` at ${clockWords(p.meeting.time)}` : ''}.`, ''];
  lines.push('### Who is coming', ...(p.people.length ? p.people.map((x) => `- ${x.name}${x.lastMet ? ` (last met ${dayName(x.lastMet.date)})` : ''}`) : ['- No one is written down yet.']), '');
  if (p.last) lines.push(`### From the last meeting (${dayName(p.last.date)})`, ...p.last.open.map((x) => item(x)), ...p.last.notReached.map((x) => `- Not reached: ${x}`), '');
  for (const person of p.people) if (person.theirs.length) lines.push(`### Open with ${person.name}`, ...person.theirs.map((x) => item(x, person.name)), '');
  if (p.project?.items.length) lines.push(`### Where ${p.project.name} stands`, ...p.project.items.map((x) => item(x)), '');
  if (p.earlier.length) lines.push('### From earlier meetings with the same people', ...p.earlier.map((x) => item(x)), '');
  if (p.linked.length) lines.push('### Linked notes', ...p.linked.map((x) => item(x)), '');
  if (p.recent.length) lines.push('### Recent on the project', ...p.recent.map((x) => item(x)), '');
  if (!p.count) lines.push('Nothing is open with the people coming. A clear run into this meeting.', '');
  return lines.join('\n').trim();
}

/** A follow-up email draft after a meeting (8.3 wave 1): decisions, then actions with owners and days. A draft only;
 *  it is sent only when the person says so, through their mail. Never invents a decision or an action. The greeting
 *  and sign-off are the person's to give (9.2: no fixed voice on every draft); left out, they are left out. */
export function followUpDraft(m: MeetingRec, done: (a: MeetingActionRec) => boolean = (a) => a.done, voice?: { greeting?: string; signoff?: string }): { subject: string; text: string } {
  const title = bareTitle(m.title);
  const subject = `${title}: follow-up (${dayName(m.date)})`;
  const greeting = voice?.greeting?.trim() ?? '';
  const signoff = voice?.signoff?.trim() ?? '';
  const lines = [...(greeting ? [greeting, ''] : []), `Thanks for ${title} on ${dayName(m.date)}.`, ''];
  lines.push('What we decided:', ...(m.decisions.length ? m.decisions.map((d) => `- ${d.text}`) : ['- Nothing was recorded as decided.']), '');
  const open = m.actions.filter((a) => !done(a));
  lines.push('Actions:', ...(open.length ? open.map((a) => `- ${a.what}${a.who ? ` (${a.who})` : ''}${a.due ? `, by ${dayName(a.due)}` : a.whenWords ? `, ${a.whenWords}` : ''}`) : ['- No actions are still open.']), ...(signoff ? ['', signoff] : []));
  return { subject, text: lines.join('\n') };
}

// ── Agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const MEETING_TOOLS: WorkToolDef[] = [
  {
    name: 'meeting_series_add',
    module: 'meetings',
    write: true,
    title: 'Add a meeting series',
    step: 'Added a meeting series',
    description: 'Add a meeting series (a meeting that comes round): its name, how often (Weekly, Fortnightly, Monthly or Ad hoc), the day and time, who comes, its project and its standing agenda. The window’s New series, for an assistant.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, cadence: { type: 'string' }, day: { type: 'string', description: 'The weekday ("Tuesday").' }, time: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, project: { type: 'string' }, standing: { type: 'array', items: { type: 'string' }, description: 'Standing agenda items.' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'meeting_action_tick',
    module: 'meetings',
    write: true,
    title: 'Tick a meeting action',
    step: 'Ticked a meeting action',
    description: 'Tick (or untick) one action in a meeting, by its words; its matching steps and lines tick with it, the way ticking it in the window does. Done unless the person says it is not done any more.',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'The meeting’s title words, its day, or its path.' }, action: { type: 'string', description: 'The action’s words.' }, done: { type: 'boolean', description: 'Ticked (default true).' } }, required: ['meeting', 'action'], additionalProperties: false },
  },
  {
    name: 'meeting_list',
    module: 'meetings',
    write: false,
    title: 'Meetings',
    step: 'Looked through your meetings',
    description: 'The person’s meetings (Ironleaf’s Meetings module): coming up or recent, each with its day and time, attendees, project, series, decisions, open questions and open actions. Filter by project or person. Use it for "what meetings have I got this week?", "when did I last meet Sam?".',
    parameters: { type: 'object', properties: { when: { type: 'string', enum: ['upcoming', 'recent', 'all'], description: 'Coming up (the default), recent, or all.' }, project: { type: 'string' }, person: { type: 'string' }, days: { type: 'number', description: 'How many days ahead or back (14 unless given).' } }, additionalProperties: false },
  },
  {
    name: 'meeting_get',
    module: 'meetings',
    write: false,
    title: 'A meeting',
    step: 'Read a meeting',
    description: 'One meeting in full: its agenda, attendees, project, summary, decisions, questions (asked by, for, answered or not, the answer) and actions (who, by when, done). A meeting in a project has its actions as that project’s tasks already. Name it by its title words or its day.',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'Its title (or words of it), a day (YYYY-MM-DD), or its note’s path.' } }, required: ['meeting'], additionalProperties: false },
  },
  {
    name: 'meeting_prep',
    module: 'meetings',
    write: false,
    title: 'Prep for a meeting',
    step: 'Put together the prep pack',
    description: 'The prep pack for a meeting: what is open with each person coming (theirs to do, what others wait on them for, when you last met), the series’ last meeting’s open actions and agenda items not reached, and the project’s items needing attention. Use it before a meeting, or for "prep me for the 10 o’clock".',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'Its title words, a day, or its note’s path; the next meeting when left out.' } }, additionalProperties: false },
  },
  {
    name: 'meeting_prep_sheet',
    module: 'meetings',
    write: true,
    title: 'Make a prep sheet',
    step: 'Made a prep sheet for a meeting',
    description: 'Make the prep sheet for a meeting and save it in its note: who is coming, what is open with each person, the last meeting’s actions, and where its project stands. Every item comes from the vault; use it when the person asks to be prepped.',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'Its title words, a day, or its note’s path; the next meeting when left out.' } }, additionalProperties: false },
  },
  {
    name: 'meeting_follow_up',
    module: 'meetings',
    write: false,
    title: 'Draft a follow-up after a meeting',
    step: 'Drafted a follow-up after a meeting',
    description: 'Draft (never send) a follow-up email after a meeting: what was decided, then the open actions with owners and days. Show it to the person; it is sent only when they say so. Give the greeting and sign-off for who it goes to; left out, they are left out.',
    parameters: { type: 'object', properties: { meeting: { type: 'string', description: 'Its title words, a day, or its note’s path.' }, greeting: { type: 'string', description: 'Its greeting ("Hello Sam,").' }, signoff: { type: 'string', description: 'Its sign-off ("Thanks").' } }, required: ['meeting'], additionalProperties: false },
  },
  {
    name: 'meeting_add',
    module: 'meetings',
    write: true,
    title: 'Add a meeting',
    step: 'Added a meeting',
    description: 'Add a meeting: its title, day, time, attendees (people’s names), project, series and agenda items. Use only what the person said; never invent attendees or a time.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, date: { type: 'string', description: 'Its day ("Friday", "24 Oct" or YYYY-MM-DD).' }, time: { type: 'string', description: 'As said ("10:00", "2:30 PM").' }, attendees: { type: 'array', items: { type: 'string' } }, project: { type: 'string' }, series: { type: 'string', description: 'A meeting series’ name, when it is one of them.' }, agenda: { type: 'array', items: { type: 'string' } } },
      required: ['title', 'date'],
      additionalProperties: false,
    },
  },
];

/** A meeting named by words, a day or a path, the likeliest first (null: none matches). The words score against its
 *  title, the people coming and its project, so "meet Sam?" finds the meeting Sam is at. */
export function findMeeting(meetings: readonly MeetingRec[], words: string, today: string): MeetingRec | null {
  const w = String(words ?? '').trim();
  if (!w) return meetings.filter((m) => m.dated && m.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0] ?? null;
  const exact = meetings.find((m) => m.path === w || m.path.replace(/\.md$/i, '') === w.replace(/\.md$/i, ''));
  if (exact) return exact;
  if (/\.md$/i.test(w)) return null;
  const day = /(\d{4}-\d{2}-\d{2})/.exec(w)?.[1];
  const q = w.toLowerCase().replace(/\d{4}-\d{2}-\d{2}/, '').trim();
  const scored = meetings
    .map((m) => {
      let s = 0;
      if (day && m.date === day) s += 3;
      if (q) {
        const t = m.title.toLowerCase();
        if (t === q) s += 6;
        else if (t.includes(q)) s += 4;
        else s += q.split(/\s+/).filter((x) => x.length > 2 && t.includes(x)).length;
        const parts = q.split(/\s+/).map((x) => x.replace(/[^a-z0-9]/g, '')).filter((x) => x.length > 2);
        if (m.people.some((p) => p.toLowerCase() === q)) s += 5;
        else if (m.people.some((p) => p.toLowerCase().includes(q))) s += 3;
        else s += parts.filter((x) => m.people.some((p) => p.toLowerCase().includes(x))).length;
        for (const field of [m.project, m.series]) {
          const f = field.toLowerCase();
          if (!f) continue;
          if (f === q) s += 4;
          else if (f.includes(q)) s += 2;
          else s += parts.filter((x) => f.includes(x)).length;
        }
      }
      return { m, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Math.abs(dateOf(a.m.date).getTime() - dateOf(today).getTime()) - Math.abs(dateOf(b.m.date).getTime() - dateOf(today).getTime()));
  return scored[0]?.m ?? null;
}

/** A meeting's day as given ("Friday", "24 Oct", YYYY-MM-DD), read from `today`; null when it isn't a day. */
export function meetingDay(input: string, today: Date = new Date()): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = readDay(s, today);
    return d && isoDay(d) === s ? s : null;
  }
  const d = readDay(s, today);
  return d ? isoDay(d) : null;
}

export interface MeetingDayGroup {
  date: string;
  /** "Today", "Tomorrow", or the weekday and day ("Friday 30 Oct"). */
  label: string;
  meetings: MeetingRec[];
}

const GROUP_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GROUP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A meeting day as a person says it, against today. */
export function meetingDayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  const d = dateOf(iso);
  return `${GROUP_DAYS[d.getDay()]} ${d.getDate()} ${GROUP_MONTHS[d.getMonth()]}`;
}

/** Meetings by day (29 Oct 2026, SPEC B): coming up soonest first, past most recent first, each day in time order. */
export function groupMeetingsByDay(meetings: readonly MeetingRec[], today: string): { upcoming: MeetingDayGroup[]; upcomingThisWeek: MeetingDayGroup[]; past: MeetingDayGroup[] } {
  const byDay = (list: MeetingRec[], dir: 1 | -1): MeetingDayGroup[] => {
    const days = new Map<string, MeetingRec[]>();
    for (const m of list) days.set(m.date, [...(days.get(m.date) ?? []), m]);
    return [...days.entries()].sort((a, z) => dir * a[0].localeCompare(z[0])).map(([date, ms]) => ({ date, label: meetingDayLabel(date, today), meetings: ms.sort((a, z) => a.time.localeCompare(z.time) || a.title.localeCompare(z.title)) }));
  };
  const upcoming = meetings.filter((m) => m.dated && m.date >= today);
  const weekEnd = addDays(today, 7);
  return { upcoming: byDay(upcoming, 1), upcomingThisWeek: byDay(upcoming.filter((m) => m.date <= weekEnd), 1), past: byDay(meetings.filter((m) => !(m.dated && m.date >= today)), -1) };
}

/** A meeting's actions counted: all of them, and how many are still open (ticked in its project counts as done). */
export function meetingActionCounts<A extends { done: boolean }>(m: { actions: readonly A[] }, done: (a: A) => boolean = (a) => a.done): { total: number; open: number } {
  return { total: m.actions.length, open: m.actions.filter((a) => !done(a)).length };
}

/** Before its day a meeting is for prep; from the day after, its actions lead (29 Oct 2026, SPEC B). */
export const meetingPhase = (m: Pick<MeetingRec, 'date' | 'dated'>, today: string): 'before' | 'after' => (m.dated && m.date >= today ? 'before' : 'after');

/** Monday of the ISO week a day is in (Australian weeks start on Monday). */
export function mondayOfWeek(iso: string): string {
  const d = dateOf(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

/** The week's seven days (Monday to Sunday) for the week a day is in (8.9 round 2: a week view always includes
 *  today; Saturday 31 Oct drew an empty Monday to Friday grid with the day's events only beside it). */
export function weekOf(iso: string): string[] {
  const monday = mondayOfWeek(iso);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
}

const WEEK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A week as a person reads it ("26 Oct to 1 Nov"). */
export function weekRangeWords(week: readonly string[]): string {
  const first = dateOf(week[0]);
  const last = dateOf(week[week.length - 1]);
  const left = `${first.getDate()} ${WEEK_MONTHS[first.getMonth()]}`;
  const right = `${last.getDate()} ${WEEK_MONTHS[last.getMonth()]}`;
  return first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear() ? `${first.getDate()} to ${right}` : `${left} to ${right}`;
}

/** A weekday column's head ("Mon 26"). */
export function weekDayHead(iso: string): string {
  const d = dateOf(iso);
  return `${WEEK_DAYS[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

/** A day column's head ("Friday 30 October"). */
export function dayColumnHead(iso: string): string {
  const d = dateOf(iso);
  return `${GROUP_DAYS[d.getDay()]} ${d.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]}`;
}

/** The meetings on one day, earliest first (undated never land on a day). */
export function meetingsOn<M extends Pick<MeetingRec, 'date' | 'dated' | 'time' | 'title'>>(meetings: readonly M[], iso: string): M[] {
  return meetings.filter((m) => m.dated && m.date === iso).sort((a, z) => a.time.localeCompare(z.time) || a.title.localeCompare(z.title));
}

/** The Meetings home's numbers: coming up, actions still open, decisions this week, series, this month. */
export function meetingStats<A extends { done: boolean }>(meetings: readonly (Pick<MeetingRec, 'date' | 'dated' | 'decisions'> & { actions: readonly A[]; questions?: readonly { answered: boolean }[] })[], series: readonly Pick<SeriesRec, 'cadence'>[], today: string, done: (a: A) => boolean = (a) => a.done): { comingUp: number; openActions: number; decisionsWeek: number; openQuestions: number; series: number; thisMonth: number } {
  const monday = mondayOfWeek(today);
  const sunday = addDays(monday, 6);
  let comingUp = 0;
  let openActions = 0;
  let decisionsWeek = 0;
  let openQuestions = 0;
  let thisMonth = 0;
  for (const m of meetings) {
    if (m.dated && m.date >= today) comingUp++;
    if (m.dated && m.date.slice(0, 7) === today.slice(0, 7)) thisMonth++;
    if (m.dated && m.date >= monday && m.date <= sunday) decisionsWeek += m.decisions.length;
    openActions += m.actions.filter((a) => !done(a)).length;
    openQuestions += (m.questions ?? []).filter((q) => !q.answered).length;
  }
  // Every series, as the Series list shows (p9 fresh-eyes, 4 Nov 2026: a weekly-only count said "1 series" with two shown).
  return { comingUp, openActions, decisionsWeek, openQuestions, series: series.length, thisMonth };
}

/** A meeting in words, for an assistant. */
export function meetingWords(m: MeetingRec, done: (a: MeetingActionRec) => boolean = (a) => a.done): string {
  const lines = [`${m.title} — ${m.date}${m.time ? ` ${m.time}` : ''}${m.where ? `, ${m.where}` : ''} [${m.path}]`];
  if (m.people.length) lines.push(`Attendees: ${m.people.join(', ')}`);
  if (m.project) lines.push(`Project: ${m.project}`);
  if (m.series) lines.push(`Series: ${m.series}`);
  if (m.agenda.length) lines.push('Agenda:', ...m.agenda.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}`));
  if (m.summary) lines.push('Summary:', wholeSentences(m.summary, 2000));
  lines.push(m.decisions.length ? 'Decisions:' : 'No decisions recorded.', ...m.decisions.map((d) => `- ${d.text} [${m.path}, line ${d.line + 1}]`));
  if (m.questions.length) lines.push('Questions:', ...m.questions.map((q) => `- ${q.answered ? 'Answered' : 'Open'}: ${q.what}${q.owner ? ` (for ${q.owner})` : q.askedBy ? ` (asked by ${q.askedBy})` : ''}${q.answer ? `, answer: ${q.answer}` : ''}`));
  lines.push(m.actions.length ? 'Actions:' : 'No actions recorded.', ...m.actions.map((a) => `- [${done(a) ? 'x' : ' '}] ${a.what}${a.who ? ` — ${a.who}` : ''}${a.due ? ` · by ${a.due}` : a.whenWords ? ` · ${a.whenWords}` : ''}`));
  if (m.transcripts) lines.push(`Transcript: ${m.transcripts} ${m.transcripts === 1 ? 'part' : 'parts'} in the note.`);
  return lines.join('\n');
}

/** The props a meeting note has (for tests and callers without an index). */
export const meetingProps = (text: string) => readProps(text) as Record<string, unknown>;
