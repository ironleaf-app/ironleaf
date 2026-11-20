// Career (Wave 7 part a, 24 Oct 2026; module 15 of the catalogue: "Job applications, cover letters, interviews,
// contacts, outcomes · Application pipeline (applied, interview, offer) · Personal"). Each record is a plain note the
// person owns, in the module's folder inside the Me area:
//
//   Me/Career/Applications/Analyst at Brightwater.md   type: job-application — company "[[Brightwater]]", role, stage,
//                                                      applied, source, url, location, work_type, salary, contacts,
//                                                      cv "[[CV v3]]", letter "[[Cover letter Brightwater]]",
//                                                      next_step, next_date;
//                                                      "## Interviews" | Date | Time | Kind | With | Where | Outcome |
//                                                      Notes |; "## Timeline" - 2026-10-24 — Moved to Interview
//   Me/Career/Cover letters/Cover letter Brightwater.md type: cover-letter — application, company, written, version;
//                                                      the letter itself is the note's words
//   Me/Documents and ID/CV v3.md                       a CV is a Documents and ID record (one home per record): Career
//                                                      reads it and links to it
//
// A move to another stage is written to the application's timeline, so its history is kept with it. Pure: no files, no
// Node, no DOM.

import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { APPLICATION_STAGES, INTERVIEW_KINDS, INTERVIEW_OUTCOMES, OPEN_STAGES, WORK_TYPES } from './personal-modules';
import { dayWords, daysFrom, emptyTable, findByName, join, knownWord, linkName, namesOf, noteText, plural, readDay, readTable, readTime, refusedWords, sectionAt, sectionWords, str, todayOf, whenWords, type PropSpec, type TableSpec } from './personal-records';

export const INTERVIEWS_TABLE: TableSpec = {
  id: 'interviews',
  name: 'Interviews',
  heading: /^interviews?$/i,
  one: 'interview',
  title: 'date',
  fields: [
    { key: 'date', label: 'Date', col: /^(date|day|when)$/i, kind: 'date' },
    { key: 'time', label: 'Time', col: /^(time|at)$/i, kind: 'time' },
    { key: 'kind', label: 'Kind', col: /^(kind|type|round|stage)$/i, kind: 'choice', options: INTERVIEW_KINDS },
    { key: 'with', label: 'With', col: /^(with|who|panel|interviewers?)$/i, kind: 'text' },
    { key: 'where', label: 'Where', col: /^(where|location|link|place)$/i, kind: 'text' },
    { key: 'outcome', label: 'Outcome', col: /^(outcome|result|how it went|status)$/i, kind: 'choice', options: INTERVIEW_OUTCOMES },
    { key: 'notes', label: 'Notes', col: /^notes?$/i, kind: 'text' },
  ],
};
export const CAREER_TABLES = [INTERVIEWS_TABLE];
export const TIMELINE_HEADING = /^(timeline|history|log|activity)$/i;

export const APPLICATION_PROPS: PropSpec[] = [
  { field: 'company', key: 'company', kind: 'link', label: 'Company' },
  { field: 'role', key: 'role', kind: 'text', label: 'Role' },
  { field: 'stage', key: 'stage', kind: 'choice', label: 'Stage', options: APPLICATION_STAGES },
  { field: 'applied', key: 'applied', kind: 'date', label: 'Applied' },
  { field: 'source', key: 'source', kind: 'text', label: 'Found through' },
  { field: 'url', key: 'url', kind: 'url', label: 'Job ad' },
  { field: 'location', key: 'location', kind: 'text', label: 'Location' },
  { field: 'work_type', key: 'work_type', kind: 'choice', label: 'Work type', options: WORK_TYPES },
  { field: 'salary', key: 'salary', kind: 'text', label: 'Salary' },
  { field: 'contacts', key: 'contacts', kind: 'links', label: 'Contacts' },
  { field: 'cv', key: 'cv', kind: 'link', label: 'CV sent' },
  { field: 'letter', key: 'letter', kind: 'link', label: 'Cover letter' },
  { field: 'next_step', key: 'next_step', kind: 'text', label: 'Next step' },
  { field: 'next_date', key: 'next_date', kind: 'date', label: 'Next step by' },
  // The interview prep sheet (8.7 wave 3a): what the role is, likely questions, what to ask them.
  { field: 'prep_role', key: 'prep_role', kind: 'text', label: 'Prep: the role' },
  { field: 'prep_questions', key: 'prep_questions', kind: 'text', label: 'Prep: likely questions' },
  { field: 'prep_ask', key: 'prep_ask', kind: 'text', label: 'Prep: ask them' },
];
export const LETTER_PROPS: PropSpec[] = [
  { field: 'application', key: 'application', kind: 'link', label: 'Application' },
  { field: 'company', key: 'company', kind: 'link', label: 'Company' },
  { field: 'written', key: 'written', kind: 'date', label: 'Written' },
  { field: 'version', key: 'version', kind: 'text', label: 'Version' },
];

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CareerNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  files?: string[];
}

export interface PersonInfo {
  name: string;
  path: string;
  role?: string;
  org?: string;
  email?: string;
  phone?: string;
}

export interface Interview {
  row: number;
  date: string | null;
  dateWords: string;
  time: string;
  kind: string;
  with: string;
  where: string;
  outcome: string;
  notes: string;
  days: number | null;
  application: string;
  applicationName: string;
  company: string;
  role: string;
}

export interface TimelineLine {
  date: string | null;
  words: string;
}

export interface Application {
  path: string;
  name: string;
  company: string;
  role: string;
  stage: string;
  open: boolean;
  applied: string | null;
  source: string;
  url: string;
  location: string;
  workType: string;
  salary: string;
  contacts: string[];
  cv: string;
  cvPath: string | null;
  letter: string;
  letterPath: string | null;
  nextStep: string;
  nextDate: string | null;
  nextDays: number | null;
  prepRole: string;
  prepQuestions: string;
  prepAsk: string;
  interviews: Interview[];
  timeline: TimelineLine[];
  /** Days since it was applied for (while still open). */
  waiting: number | null;
  /** The latest day anything happened (an interview, a timeline line, applied). */
  last: string | null;
  notes: string;
  files: string[];
}

export interface Letter {
  path: string;
  name: string;
  application: string;
  applicationPath: string | null;
  company: string;
  written: string | null;
  version: string;
  words: number;
  files: string[];
}

export interface Cv {
  path: string;
  name: string;
  version: string;
  issued: string | null;
  files: string[];
  /** The applications it was sent with. */
  usedBy: string[];
}

export interface Contact {
  name: string;
  path: string | null;
  role: string;
  org: string;
  email: string;
  phone: string;
  applications: { path: string; name: string; stage: string }[];
  /** The latest interview with them, or the latest day on an application they are part of. */
  last: string | null;
}

export interface CareerModel {
  applications: Application[];
  interviews: Interview[];
  /** Interviews from today on (the next 30 days), soonest first. */
  upcoming: Interview[];
  /** Open applications whose next step is due within the days ahead (or passed), soonest first. */
  followUps: Application[];
  /** Applications at Offer. */
  offers: Application[];
  letters: Letter[];
  cvs: Cv[];
  contacts: Contact[];
  /** How many at each stage. */
  stages: Record<string, number>;
  today: string;
  remindDays: number;
}

const isOpen = (stage: string) => (OPEN_STAGES as readonly string[]).includes(stage);

function readTimeline(text: string): TimelineLine[] {
  const at = sectionAt(text, TIMELINE_HEADING);
  if (!at) return [];
  return text
    .slice(at.start, at.end)
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1]?.trim() ?? '')
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*[—–:·-]+\s*(.+)$/i.exec(l);
      const date = m ? readDay(m[1]) : null;
      return { date, words: m && date ? m[2].trim() : l };
    });
}

export function readApplication(n: CareerNote, today: string, links: { cvs: { name: string; path: string }[]; letters: { name: string; path: string }[] }): Application {
  const p = n.props;
  const stage = knownWord(APPLICATION_STAGES, p.stage) || 'Applied';
  const company = linkName(p.company);
  const role = str(p.role);
  const applied = readDay(p.applied);
  const cv = linkName(p.cv);
  const letter = linkName(p.letter);
  const nextDate = readDay(p.next_date);
  const interviews: Interview[] = readTable(n.content, INTERVIEWS_TABLE).rows.map(({ row, values: v }) => {
    const date = readDay(v.date);
    return { row, date, dateWords: date ? '' : v.date, time: readTime(v.time) || v.time, kind: knownWord(INTERVIEW_KINDS, v.kind), with: v.with, where: v.where, outcome: knownWord(INTERVIEW_OUTCOMES, v.outcome), notes: v.notes, days: date ? daysFrom(today, date) : null, application: n.path, applicationName: n.title, company, role };
  });
  const timeline = readTimeline(n.content);
  const days = [applied, ...interviews.map((i) => i.date), ...timeline.map((t) => t.date)].filter((d): d is string => !!d && d <= today).sort();
  const open = isOpen(stage);
  return {
    path: n.path,
    name: n.title,
    company,
    role,
    stage,
    open,
    applied,
    source: str(p.source),
    url: str(p.url),
    location: str(p.location),
    workType: knownWord(WORK_TYPES, p.work_type),
    salary: str(p.salary),
    contacts: namesOf(p.contacts ?? p.contact),
    cv,
    cvPath: cv ? (links.cvs.find((c) => c.name.toLowerCase() === cv.toLowerCase())?.path ?? null) : null,
    letter,
    letterPath: letter ? (links.letters.find((c) => c.name.toLowerCase() === letter.toLowerCase())?.path ?? null) : null,
    nextStep: str(p.next_step),
    nextDate,
    nextDays: nextDate ? daysFrom(today, nextDate) : null,
    prepRole: str(p.prep_role),
    prepQuestions: str(p.prep_questions),
    prepAsk: str(p.prep_ask),
    interviews,
    timeline,
    waiting: open && applied && stage !== 'Saved' ? daysFrom(applied, today) : null,
    last: days[days.length - 1] ?? null,
    notes: sectionWords(n.content, /^notes$/i),
    files: n.files ?? [],
  };
}

/** The career model from its notes (applications and cover letters), the CVs kept in Documents and ID, and the people
 *  cards the vault has (for each contact's role and details). */
export function careerModel(notes: readonly CareerNote[], today: Date | string = new Date(), remindDays = 2, people: readonly PersonInfo[] = []): CareerModel {
  const t = todayOf(today);
  const cvNotes = notes.filter((n) => n.type === 'id-document' && /^cv$|^resume$|curriculum/i.test(str(n.props.kind)));
  const letterNotes = notes.filter((n) => n.type === 'cover-letter');
  const links = { cvs: cvNotes.map((n) => ({ name: n.title, path: n.path })), letters: letterNotes.map((n) => ({ name: n.title, path: n.path })) };
  const applications = notes
    .filter((n) => n.type === 'job-application')
    .map((n) => readApplication(n, t, links))
    .sort((a, b) => Number(b.open) - Number(a.open) || (b.last ?? b.applied ?? '').localeCompare(a.last ?? a.applied ?? '') || a.name.localeCompare(b.name));
  const interviews = applications.flatMap((a) => a.interviews).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.time.localeCompare(a.time));
  const upcoming = interviews.filter((i) => i.days !== null && i.days >= 0 && i.days <= 30 && i.outcome !== 'Cancelled').sort((a, b) => a.date!.localeCompare(b.date!) || a.time.localeCompare(b.time));
  const followUps = applications.filter((a) => a.open && a.nextDays !== null && a.nextDays <= remindDays).sort((a, b) => a.nextDate!.localeCompare(b.nextDate!));
  const letters: Letter[] = letterNotes
    .map((n) => {
      const app = linkName(n.props.application);
      const body = n.content.replace(/^---[\s\S]*?\n---\s*/, '');
      return { path: n.path, name: n.title, application: app, applicationPath: app ? (applications.find((a) => a.name.toLowerCase() === app.toLowerCase())?.path ?? null) : null, company: linkName(n.props.company), written: readDay(n.props.written), version: str(n.props.version), words: (body.match(/\b[\w’'-]+\b/g) ?? []).length, files: n.files ?? [] };
    })
    .sort((a, b) => (b.written ?? '').localeCompare(a.written ?? '') || a.name.localeCompare(b.name));
  const cvs: Cv[] = cvNotes
    .map((n) => ({ path: n.path, name: n.title, version: str(n.props.version), issued: readDay(n.props.issued), files: n.files ?? [], usedBy: applications.filter((a) => a.cvPath === n.path).map((a) => a.path) }))
    .sort((a, b) => (b.issued ?? '').localeCompare(a.issued ?? '') || b.version.localeCompare(a.version, undefined, { numeric: true }));
  const contacts = new Map<string, Contact>();
  const contact = (name: string): Contact => {
    const key = name.toLowerCase();
    let c = contacts.get(key);
    if (!c) {
      const p = people.find((x) => x.name.toLowerCase() === key);
      c = { name: p?.name ?? name, path: p?.path ?? null, role: p?.role ?? '', org: p?.org ?? '', email: p?.email ?? '', phone: p?.phone ?? '', applications: [], last: null };
      contacts.set(key, c);
    }
    return c;
  };
  for (const a of applications) {
    for (const name of a.contacts) {
      const c = contact(name);
      if (!c.applications.some((x) => x.path === a.path)) c.applications.push({ path: a.path, name: a.name, stage: a.stage });
      if (!c.org && a.company) c.org = a.company;
      const seen = a.interviews.filter((i) => i.date && i.date <= t && i.with.toLowerCase().includes(name.split(' ')[0].toLowerCase())).map((i) => i.date!);
      const last = [...seen, a.last].filter((x): x is string => !!x).sort().pop() ?? null;
      if (last && (!c.last || last > c.last)) c.last = last;
    }
  }
  const stages: Record<string, number> = Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0]));
  for (const a of applications) stages[a.stage] = (stages[a.stage] ?? 0) + 1;
  return { applications, interviews, upcoming, followUps, offers: applications.filter((a) => a.stage === 'Offer'), letters, cvs, contacts: [...contacts.values()].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.name.localeCompare(b.name)), stages, today: t, remindDays };
}

/** "Interview tomorrow at 10:00", "Phone screen today at 14:30", "Interview on Thu 29 Oct". */
export function interviewWords(i: Pick<Interview, 'date' | 'days' | 'time' | 'kind'>, today: string): string {
  const what = i.kind && i.kind !== 'Other' ? i.kind : 'Interview';
  if (!i.date || i.days === null) return what;
  const when = i.days === 0 ? 'today' : i.days === 1 ? 'tomorrow' : i.days < 0 ? whenWords(i.days) : `on ${dayWords(i.date, today)}`;
  return `${what} ${when}${i.time ? ` at ${i.time}` : ''}`;
}

/** An application's name from its role and company ("Analyst at Brightwater"). */
export function applicationName(role: string, company: string): string {
  const r = str(role);
  const c = linkName(company);
  return r && c ? `${r} at ${c}` : r || c || 'Application';
}

// ── New notes and changes ────────────────────────────────────────────────────────────────────────────────────────────

export interface ApplicationInput {
  role?: string;
  company?: string;
  stage?: string;
  applied?: string | null;
  source?: string;
  url?: string;
  location?: string;
  work_type?: string;
  salary?: string;
  contacts?: string[];
  cv?: string;
  letter?: string;
  next_step?: string;
  next_date?: string | null;
  note?: string;
}

export function newApplicationText(a: ApplicationInput, today: string): string {
  const stage = knownWord(APPLICATION_STAGES, a.stage) || 'Applied';
  const applied = readDay(a.applied) ?? (stage === 'Saved' ? null : today);
  const link = (v: unknown) => (linkName(v) ? `[[${linkName(v)}]]` : '');
  const first = stage === 'Saved' ? 'Saved to apply for' : `Applied${a.source ? ` through ${str(a.source)}` : ''}`;
  return noteText(
    'job-application',
    [
      ['company', link(a.company)],
      ['role', str(a.role)],
      ['stage', stage],
      ['applied', applied],
      ['source', str(a.source)],
      ['url', str(a.url)],
      ['location', str(a.location)],
      ['work_type', knownWord(WORK_TYPES, a.work_type)],
      ['salary', str(a.salary)],
      ['contacts', (a.contacts ?? []).map(linkName).filter(Boolean).map((x) => `[[${x}]]`)],
      ['cv', link(a.cv)],
      ['letter', link(a.letter)],
      ['next_step', str(a.next_step)],
      ['next_date', readDay(a.next_date)],
    ],
    `${emptyTable(INTERVIEWS_TABLE)}## Timeline\n\n- ${applied ?? today} — ${first}\n\n## Notes\n\n${a.note ? `${a.note}\n` : ''}`,
  );
}

export function newLetterText(l: { application?: string; company?: string; written?: string | null; version?: string; body?: string }, today: string): string {
  const link = (v: unknown) => (linkName(v) ? `[[${linkName(v)}]]` : '');
  return noteText(
    'cover-letter',
    [
      ['application', link(l.application)],
      ['company', link(l.company)],
      ['written', readDay(l.written) ?? today],
      ['version', str(l.version)],
    ],
    l.body?.trim() ? `${l.body.trim()}\n` : 'Dear hiring manager,\n\n\n\nKind regards,\n',
  );
}

/** A cover letter's words without its properties (to start a new one from it). */
export const letterBody = (text: string) => String(text ?? '').replace(/^---[\s\S]*?\n---\s*/, '');

/** The timeline's line for a move to a stage ("Moved to Interview", "Offer accepted", "Declined: the role moved"). */
export function stageLine(stage: string, note?: string): string {
  const s = knownWord(APPLICATION_STAGES, stage);
  const words = s === 'Accepted' ? 'Offer accepted' : s === 'Declined' ? 'Declined it' : s === 'Rejected' ? 'Not successful' : s === 'Withdrawn' ? 'Withdrew' : s === 'Offer' ? 'Offer received' : `Moved to ${s}`;
  return note ? `${words}: ${str(note).slice(0, 200)}` : words;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function careerRecords(m: CareerModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const a of m.applications) {
    out.push({
      id: `${a.path}::application`,
      kind: 'application',
      title: a.name,
      path: a.path,
      fields: { company: a.company || null, role: a.role || null, stage: a.stage, applied: a.applied, location: a.location || null, work_type: a.workType || null, salary: a.salary || null, source: a.source || null, next_step: a.nextStep || null, next_date: a.nextDate, interviews: a.interviews.length, cv: a.cv || null, letter: a.letter || null, waiting: a.waiting },
      links: [],
      ref: { at: 'note', path: a.path },
    });
    for (const i of a.interviews)
      out.push({
        id: `${a.path}::interview:${i.row}`,
        kind: 'interview',
        title: `${i.kind || 'Interview'} · ${a.company || a.name}`,
        path: a.path,
        fields: { application: a.name, company: a.company || null, date: i.date ?? (i.dateWords || null), time: i.time || null, interview_kind: i.kind || null, with: i.with || null, place: i.where || null, outcome: i.outcome || null },
        links: [`${a.path}::application`],
        ref: { at: 'table', heading: INTERVIEWS_TABLE.name, row: i.row, cols: {} },
      });
  }
  for (const l of m.letters) out.push({ id: `${l.path}::letter`, kind: 'letter', title: l.name, path: l.path, fields: { company: l.company || null, application: l.application || null, written: l.written, version: l.version || null, words_count: l.words }, links: l.applicationPath ? [`${l.applicationPath}::application`] : [], ref: { at: 'note', path: l.path } });
  for (const c of m.cvs) out.push({ id: `${c.path}::cv`, kind: 'cv', title: c.name, path: c.path, fields: { version: c.version || null, issued: c.issued, used: c.usedBy.length, files_count: c.files.length || null }, links: [], ref: { at: 'note', path: c.path } });
  return out;
}

export const CAREER_EDITABLE: Record<string, string[]> = {
  application: ['company', 'role', 'stage', 'applied', 'location', 'work_type', 'salary', 'source', 'next_step', 'next_date'],
  interview: ['date', 'time', 'interview_kind', 'with', 'place', 'outcome'],
  letter: ['company', 'written', 'version'],
};
export const CAREER_CELL: Record<string, Record<string, string>> = { interview: { interview_kind: 'kind', place: 'where' } };

export function careerSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'pipeline':
      return [v(['application'], 'board', 'Pipeline', { groupBy: 'stage', groupOrder: [...APPLICATION_STAGES], collapsed: ['Accepted', 'Declined', 'Rejected', 'Withdrawn'], fields: ['company', 'next_step', 'next_date'] })];
    case 'applications':
      return [v(['application'], 'table', 'Every application', { fields: ['company', 'stage', 'applied', 'location', 'work_type', 'interviews', 'next_step', 'next_date'], sort: { field: 'applied', dir: 'desc' } })];
    case 'interviews':
      return [v(['interview'], 'table', 'Every interview', { fields: ['company', 'date', 'time', 'interview_kind', 'with', 'place', 'outcome'], sort: { field: 'date', dir: 'desc' } }), v(['interview'], 'calendar', 'Interviews on the calendar', { dateField: 'date', fields: ['time'] })];
    case 'letters':
      return [v(['letter'], 'table', 'Cover letters', { fields: ['company', 'application', 'written', 'version', 'words_count'], sort: { field: 'written', dir: 'desc' } }), v(['cv'], 'table', 'CV versions', { fields: ['version', 'issued', 'used'], sort: { field: 'issued', dir: 'desc' } })];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const CAREER_TOOLS: WorkToolDef[] = [
  {
    name: 'career_application_list',
    module: 'career',
    write: false,
    title: 'Job applications',
    step: 'Looked through your job applications',
    description: 'Job applications in the person’s Career module (Ironleaf): each with company, role, stage (Saved, Applied, Interview, Offer, Accepted, Declined, Rejected, Withdrawn), when it was applied for, interviews and the next step. Use it for "where are my applications up to?", "which jobs am I waiting to hear back on?".',
    parameters: { type: 'object', properties: { stage: { type: 'string', enum: [...APPLICATION_STAGES, 'open'], description: '"open" for those still in play.' }, query: { type: 'string', description: 'Words in the role or company.' } }, additionalProperties: false },
  },
  {
    name: 'career_application_get',
    module: 'career',
    write: false,
    title: 'One application',
    step: 'Read a job application',
    description: 'One application in full: its details, every interview (when, who, where, how it went), its timeline, the CV version and cover letter sent, contacts and notes. Use it before drafting a follow-up or preparing for an interview.',
    parameters: { type: 'object', properties: { application: { type: 'string', description: 'The company or role (or the application’s name).' } }, required: ['application'], additionalProperties: false },
  },
  {
    name: 'career_interviews',
    module: 'career',
    write: false,
    title: 'Interviews',
    step: 'Checked your interviews',
    description: 'Interviews coming up (and those just past with no outcome written), with the application, kind, who, where and time. Use it for "when is my next interview?", "what interviews do I have this week?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (14 unless said).' } }, additionalProperties: false },
  },
  {
    name: 'career_prep',
    module: 'career',
    write: false,
    title: 'Interview prep sheet',
    step: 'Put together an interview prep sheet',
    description: 'A short prep sheet for one application from what is written: the role and company, the CV and cover letter sent for it, its contacts, its next interview (when, who, where), its next step and the recent timeline. Only what is written; it never invents questions or facts about the company. Use it before an interview.',
    parameters: { type: 'object', properties: { application: { type: 'string', description: 'The company or role (the next interview’s application when left out).' } }, additionalProperties: false },
  },
  {
    name: 'career_outcomes',
    module: 'career',
    write: false,
    title: 'Past applications and pay',
    step: 'Looked back over past applications',
    description: 'How past job hunts ended, from what is written: how many applications reached each stage, the ones that ended (accepted, declined, rejected, withdrawn) with the salary written for each, and the offers. Salaries are only the ones written down, never guessed. Use it for "what did the last offers land at?", "how do my hunts usually go?".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'career_contact_add',
    module: 'career',
    write: true,
    title: 'Add a contact to an application',
    step: 'Added a contact to a job application',
    description: 'Add a person’s name as a contact on one application (the recruiter, the hiring manager), from what the person gave. The window’s contact add, for an assistant.',
    parameters: { type: 'object', properties: { application: { type: 'string' }, contact: { type: 'string', description: 'The person’s name.' } }, required: ['application', 'contact'], additionalProperties: false },
  },
  {
    name: 'career_application_add',
    module: 'career',
    write: true,
    title: 'Add an application',
    step: 'Added a job application to Career',
    description: 'Add a job application to Career with what the person gave: the role and company, its stage (Applied unless said; Saved for one not yet applied for), the day applied, where it was found, the ad’s link, location, work type, salary and a next step with its day. Never guess a day or a salary.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        company: { type: 'string' },
        stage: { type: 'string', enum: [...APPLICATION_STAGES] },
        applied: { type: 'string', description: 'YYYY-MM-DD (today for Applied when left out).' },
        source: { type: 'string', description: 'Where it was found (a job board, a recruiter, a referral).' },
        url: { type: 'string' },
        location: { type: 'string' },
        work_type: { type: 'string', enum: [...WORK_TYPES] },
        salary: { type: 'string' },
        next_step: { type: 'string' },
        next_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['role', 'company'],
      additionalProperties: false,
    },
  },
  {
    name: 'career_set_stage',
    module: 'career',
    write: true,
    title: 'Move an application on',
    step: 'Moved a job application on',
    description: 'Move an application to another stage (Applied, Interview, Offer, Accepted, Declined, Rejected, Withdrawn) when the person says it happened, with a short note; it is written to the application’s timeline.',
    parameters: { type: 'object', properties: { application: { type: 'string' }, stage: { type: 'string', enum: [...APPLICATION_STAGES] }, note: { type: 'string' } }, required: ['application', 'stage'], additionalProperties: false },
  },
  {
    name: 'career_interview_add',
    module: 'career',
    write: true,
    title: 'Add an interview',
    step: 'Added an interview to Career',
    description: 'Add an interview to an application with the day the person gave (never a guessed one), and its time, kind, who it is with and where (an address or a video link). The application moves to Interview when it was earlier.',
    parameters: { type: 'object', properties: { application: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM' }, kind: { type: 'string', enum: [...INTERVIEW_KINDS] }, with: { type: 'string' }, where: { type: 'string' } }, required: ['application', 'date'], additionalProperties: false },
  },
];

export interface CareerToolInput {
  model: CareerModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

const OFF = 'The Career module is off in Ironleaf (Settings › Packs). Say so; don’t guess at applications or interviews.';

export function findApplication(m: CareerModel, words: unknown): Application | undefined {
  return findByName(m.applications, words, (a) => [a.name, a.company, a.role, `${a.role} ${a.company}`]);
}
const appLine = (a: Application, today: string) =>
  `- ${a.name}: ${a.stage}${a.applied ? `, applied ${dayWords(a.applied, today)}` : ''}${a.waiting !== null && a.stage === 'Applied' ? ` (${plural(a.waiting, 'day')} ago)` : ''}${a.interviews.length ? `; ${plural(a.interviews.length, 'interview')}` : ''}${a.nextStep ? `; next: ${a.nextStep}${a.nextDate ? ` by ${dayWords(a.nextDate, today)}` : ''}` : ''} [${a.path}]`;
const interviewLine = (i: Interview, today: string) => `- ${i.applicationName}: ${interviewWords(i, today)}${i.with ? ` with ${i.with}` : ''}${i.where ? ` (${i.where})` : ''}${i.outcome ? `; ${i.outcome}` : ''}`;

export function answerCareerTool(input: CareerToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = CAREER_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'career note', input.agent);
  if (name === 'career_application_list') {
    const stage = str(args.stage).toLowerCase();
    const q = str(args.query).toLowerCase();
    const list = m.applications.filter((a) => (!stage || (stage === 'open' ? a.open : a.stage.toLowerCase() === stage)) && (!q || `${a.name} ${a.company} ${a.role}`.toLowerCase().includes(q)));
    if (!list.length) return join([m.applications.length ? 'No application matches that.' : 'No job applications in Career yet.', refused]);
    const counts = APPLICATION_STAGES.filter((s) => m.stages[s]).map((s) => `${m.stages[s]} ${s.toLowerCase()}`).join(', ');
    return join([`${plural(list.length, 'application')} (${counts} in all):`, ...list.map((a) => appLine(a, m.today)), refused]);
  }
  if (name === 'career_application_get') {
    const a = findApplication(m, args.application);
    if (!a) return join([`There is no application for “${str(args.application)}” in Career.${m.applications.length ? ` Applications: ${m.applications.map((x) => x.name).join(', ')}.` : ''}`, refused]);
    return join([
      `${a.name}: ${a.stage}${a.applied ? `, applied ${dayWords(a.applied, m.today)}` : ''}${a.source ? ` through ${a.source}` : ''}. [${a.path}]`,
      [a.location && `Location: ${a.location}`, a.workType && `Work type: ${a.workType}`, a.salary && `Salary: ${a.salary}`, a.url && `Ad: ${a.url}`].filter(Boolean).join('; '),
      a.contacts.length ? `Contacts: ${a.contacts.join(', ')}.` : '',
      a.cv || a.letter ? `Sent: ${[a.cv && `CV ${a.cv}`, a.letter && `cover letter ${a.letter}`].filter(Boolean).join(', ')}.` : '',
      a.nextStep ? `Next step: ${a.nextStep}${a.nextDate ? ` by ${dayWords(a.nextDate, m.today)}` : ''}.` : '',
      a.interviews.length ? 'Interviews:' : 'No interviews yet.',
      ...a.interviews.map((i) => `${interviewLine(i, m.today)}${i.notes ? `; notes: ${i.notes}` : ''}`),
      a.timeline.length ? 'Timeline:' : '',
      ...a.timeline.map((t) => `- ${t.date ? `${dayWords(t.date, m.today)}: ` : ''}${t.words}`),
      a.notes ? `Notes: ${a.notes.slice(0, 1500)}` : '',
      refused,
    ]);
  }
  if (name === 'career_prep') {
    const a = str(args.application) ? findApplication(m, args.application) : m.applications.find((x) => x.path === m.upcoming[0]?.application) ?? m.applications.find((x) => x.open);
    if (!a) return join([m.applications.length ? `There is no application for “${str(args.application)}” in Career.` : 'No job applications in Career yet.', refused]);
    const next = a.interviews.filter((i) => i.days !== null && i.days >= 0 && i.outcome !== 'Cancelled').sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))[0];
    return join([
      `Prep sheet: ${a.name} [${a.path}]`,
      `${a.role} at ${a.company}: ${a.stage}${a.applied ? `, applied ${dayWords(a.applied, m.today)}` : ''}${a.location ? `, ${a.location}` : ''}${a.workType ? `, ${a.workType}` : ''}${a.salary ? `, salary written: ${a.salary}` : ''}.`,
      a.cv || a.letter ? `Sent for this one: ${[a.cv && `CV ${a.cv}`, a.letter && `cover letter ${a.letter}`].filter(Boolean).join(', ')}.` : 'No CV or cover letter linked yet.',
      a.contacts.length ? `Contacts: ${a.contacts.join(', ')}.` : 'No contacts written.',
      next ? `Next interview: ${interviewLine(next, m.today)}.` : 'No interview booked yet.',
      a.nextStep ? `Next step: ${a.nextStep}${a.nextDate ? ` by ${dayWords(a.nextDate, m.today)}` : ''}.` : '',
      a.timeline.length ? `Lately: ${a.timeline.slice(-3).map((t) => t.words).join('; ')}.` : '',
      'From what is written here only; add likely questions or company facts yourself.',
      refused,
    ]);
  }
  if (name === 'career_outcomes') {
    if (!m.applications.length) return join(['No job applications in Career yet.', refused]);
    const ended = m.applications.filter((a) => !a.open);
    const counts = APPLICATION_STAGES.filter((s) => m.stages[s]).map((s) => `${m.stages[s]} ${s.toLowerCase()}`).join(', ');
    return join([
      `${plural(m.applications.length, 'application')} in all (${counts}).`,
      m.offers.length ? `At offer: ${m.offers.map((a) => `${a.name}${a.salary ? ` (${a.salary})` : ''}`).join(', ')}.` : 'None at offer just now.',
      ended.length ? 'Ended:' : 'None ended yet.',
      ...ended.map((a) => `- ${a.name}: ${a.stage}${a.salary ? `, salary written: ${a.salary}` : ', no salary written'}${a.applied ? `, applied ${dayWords(a.applied, m.today)}` : ''} [${a.path}]`),
      refused,
    ]);
  }
  if (name === 'career_interviews') {
    const days = typeof args.days === 'number' && args.days > 0 ? Math.min(365, Math.round(args.days)) : 14;
    const next = m.interviews.filter((i) => i.days !== null && i.days >= 0 && i.days <= days && i.outcome !== 'Cancelled').sort((a, b) => a.date!.localeCompare(b.date!) || a.time.localeCompare(b.time));
    const past = m.interviews.filter((i) => i.days !== null && i.days < 0 && i.days >= -7 && (!i.outcome || i.outcome === 'Booked'));
    if (!next.length && !past.length) return join([m.applications.length ? `No interviews in the next ${plural(days, 'day')}.` : 'No job applications in Career yet.', refused]);
    return join([next.length ? `Interviews in the next ${plural(days, 'day')}:` : `No interviews in the next ${plural(days, 'day')}.`, ...next.map((i) => interviewLine(i, m.today)), past.length ? 'Just past, with no outcome written:' : '', ...past.map((i) => interviewLine(i, m.today)), refused]);
  }
  return null;
}

/** career_application_add's note. */
export function planApplicationAdd(args: Record<string, unknown>, m: CareerModel): { name: string; text: string; words: string } {
  const role = str(args.role).slice(0, 100);
  const company = linkName(args.company).slice(0, 100);
  if (!role || !company) throw new Error('An application needs the role and the company.');
  for (const k of ['applied', 'next_date'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error('Give days as YYYY-MM-DD.');
  const name = applicationName(role, company);
  if (m.applications.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.open)) throw new Error(`There’s already an open application for ${name}.`);
  const input: ApplicationInput = { role, company, stage: knownWord(APPLICATION_STAGES, args.stage) || 'Applied', applied: readDay(args.applied), source: str(args.source).slice(0, 100), url: str(args.url).slice(0, 300), location: str(args.location).slice(0, 100), work_type: str(args.work_type), salary: str(args.salary).slice(0, 60), next_step: str(args.next_step).slice(0, 200), next_date: readDay(args.next_date), note: 'Added by an assistant.' };
  return { name, text: newApplicationText(input, m.today), words: `Added ${name} to Career at ${input.stage}.` };
}

/** career_contact_add's change: the application's contacts with the new name joined (never twice). */
export function planContactAdd(args: Record<string, unknown>, m: CareerModel): { app: Application; contacts: string[]; words: string } {
  const a = findApplication(m, args.application);
  if (!a) throw new Error(`There is no application for “${str(args.application)}” in Career.`);
  const contact = linkName(args.contact).slice(0, 100);
  if (!contact) throw new Error('Say who the contact is.');
  if (a.contacts.some((c) => c.toLowerCase() === contact.toLowerCase())) throw new Error(`${contact} is already a contact on ${a.name}.`);
  return { app: a, contacts: [...a.contacts, contact], words: `Added ${contact} as a contact on ${a.name}.` };
}

/** career_set_stage's change (or an interview moving it on). */
export function planStage(a: Application, stage: string, today: string, note?: string): { props: Record<string, string | null>; line: string; words: string } {
  const s = knownWord(APPLICATION_STAGES, stage);
  if (!(APPLICATION_STAGES as readonly string[]).includes(s)) throw new Error(`The stage is one of ${APPLICATION_STAGES.join(', ')}.`);
  const props: Record<string, string | null> = { stage: s };
  if (s !== 'Saved' && !a.applied) props.applied = today;
  return { props, line: `${today} — ${stageLine(s, note)}`, words: s === a.stage ? `${a.name} is already at ${s}.` : `${a.name} is now at ${s}.` };
}

/** career_interview_add's row (and the stage it moves to). */
export function planInterview(args: Record<string, unknown>, m: CareerModel): { app: Application; values: Record<string, string>; stage: string | null; words: string } {
  const a = findApplication(m, args.application);
  if (!a) throw new Error(`There is no application for “${str(args.application)}” in Career.`);
  const date = readDay(args.date);
  if (!date) throw new Error('Give the interview’s day as YYYY-MM-DD.');
  const time = str(args.time) ? readTime(args.time) : '';
  if (str(args.time) && !time) throw new Error('Give the time as HH:MM.');
  const kind = knownWord(INTERVIEW_KINDS, args.kind);
  const values = { date, time, kind: (INTERVIEW_KINDS as readonly string[]).includes(kind) ? kind : '', with: str(args.with).slice(0, 120), where: str(args.where).slice(0, 200), outcome: 'Booked', notes: '' };
  const earlier = ['Saved', 'Applied'].includes(a.stage);
  return { app: a, values, stage: earlier ? 'Interview' : null, words: `Added ${interviewWords({ date, days: daysFrom(m.today, date), time, kind: values.kind }, m.today).replace(/^\w/, (c) => c.toLowerCase())} for ${a.name}${earlier ? '; it is now at Interview' : ''}.` };
}
