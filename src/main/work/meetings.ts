// Meetings on the main side (Wave 6 part b; src/shared/work-meetings.ts). Meetings are the vault's own Meeting notes and
// series are notes of their own type, all read from the index; every change is one change of its note (a tick, a line
// added to a section, a property). A meeting in a project has its actions as that project's tasks from the moment
// they are written (t238: no filing, no copies — moving the meeting moves its open tasks with it); ticking one ticks
// the one thing everywhere through the cascade (src/main/one-task.ts). A transcript pasted or chosen from a file is
// read into the recorder's transcript lines and written up by the same assistant notes the meeting recorder makes. The
// prep pack comes from the connected vault (src/shared/records.ts): what is open with each person coming.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { sameJob, sameWhat } from '../../shared/meetings';
import { anyTaskText } from '../../shared/tasks';
import { inFolder } from '../../shared/paths';
import { cascadeForLine } from '../one-task';
import { applyMeetingNotes, MEETING_NOTES_SYSTEM, meetingNotesPrompt, notesWords, readMeetingReply, readTranscript, type MeetingNotes } from '../../shared/meeting-notes';
import { lengthWords, transcriptText } from '../../shared/recorder';
import { isMeetingNote } from '../../shared/meetings';
import { parseProject } from '../../shared/project-file';
import { personOpenItems, projectNeeds } from '../../shared/records';
import { setNoteProp } from '../../shared/views';
import { ACTIONS_HEADING, addToSection, splitTranscript, AGENDA_HEADING, DECISIONS_HEADING, QUESTIONS_HEADING, findMeeting, followUpDraft, isoOf, lineInAgenda, linkName, meetingDay, meetingsModel, meetingWords, newMeetingText, prepProjectFirst, prepSheetWords, prepWords, readMeeting, readTranscriptText, setTick, transcriptSeconds, type MeetingInput, type MeetingRec, type PrepItem, type PrepPack } from '../../shared/work-meetings';
import { answerQuestionLine, questionDecisionLine, questionLine, questionTaskLine, splitQuestionTails } from '../../shared/questions';
import { questionPeople } from '../../shared/task-links';
import { withSectionText } from '../../shared/goals';
import { ownerCompatible } from '../../shared/today-count';
import { SERIES_CADENCES, WEEKDAYS, projectNameKeys } from '../../shared/work-modules';
import { docxText } from '../doc-text';
import type { VaultIndex } from '../indexer';
import type { ToolCtx, WorkModules, WorkNotice, WorkPart } from '../work-modules';
import { devSwitch } from '../dev-switch';

const S = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_TRANSCRIPT = 4 * 1024 * 1024;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 26 Oct" (the year added when it isn't this one). */
const dayShort = (iso: string, today: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
};

export function makeMeetings(w: WorkModules): WorkPart {
  const isMeeting = (p: string, props: Record<string, unknown>) => isMeetingNote(p, props) && String(props.type ?? '').toLowerCase() !== 'meeting-series' && !/^(project|review|template|weekly-update)$/i.test(String(props.type ?? ''));

  /** The people the vault keeps notes on (People notes' titles). */
  function people(index: VaultIndex = w.d.index): string[] {
    const out = new Set<string>();
    for (const m of index.allMeta()) {
      const type = String(m.props?.type ?? '').toLowerCase();
      if (type === 'person' || (!type && /(^|\/)People\//.test(m.path))) out.add(m.title);
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  /** Each project's next steps by its name (and its file's name), lowercased. Steps keep their owners: joins
   *  below never cross people (t179). */
  function projectSteps(index: VaultIndex = w.d.index): { steps: Record<string, { what: string; who?: string; done: boolean }[]>; byName: Map<string, { path: string; name: string }> } {
    const steps: Record<string, { what: string; who?: string; done: boolean }[]> = {};
    const byName = new Map<string, { path: string; name: string }>();
    for (const c of w.d.projects()) {
      const text = index.content(c.path);
      if (text === undefined) continue;
      const list = parseProject(text, c.path).next.map((n) => ({ what: n.what, ...(n.who ? { who: n.who } : {}), done: n.done }));
      const file = c.path.split('/').pop()!.replace(/\.md$/i, '');
      for (const k of [c.name.toLowerCase(), file.toLowerCase()]) {
        steps[k] = list;
        byName.set(k, c);
      }
    }
    return { steps, byName };
  }

  async function read(index: VaultIndex = w.d.index) {
    const notes = await w.notesOf(index, ['meeting', 'meeting-series'], isMeeting);
    const { steps, byName } = projectSteps(index);
    const model = meetingsModel(notes, w.today(), { known: people(index) });
    return { notes, model, steps, byName };
  }

  /** The window's model: every meeting (each action knowing whether it is in its project and done there), the series,
   *  the people and projects to choose from. */
  async function model() {
    const { model: m, steps } = await read();
    const linked = w.d.index.allMeta().map((meta) => ({ path: meta.path, title: meta.title }));
    const meetings = m.meetings.map((x) => ({
      ...x,
      actions: x.actions.map((a) => withProject(x, a, steps)),
      questions: x.questions.map((q) => {
        const people = questionPeople(q, linked);
        return { ...q, ...(people.askedBy ? { askedByPath: people.askedBy } : {}), ...(people.owner ? { ownerPath: people.owner } : {}) };
      }),
    }));
    // The model's own order (soonest first for upcoming, newest first for recent): the view's list keeps it, so
    // "Next:" is the next meeting, not the last one (30 Oct 2026, seen in the real app).
    const byPath = new Map(meetings.map((x) => [x.path, x]));
    const inOrder = (list: readonly { path: string }[]) => list.map((u) => byPath.get(u.path)).filter((x): x is (typeof meetings)[number] => !!x);
    return { ...m, meetings, upcoming: inOrder(m.upcoming), recent: inOrder(m.recent), people: people(), projects: w.d.projects(), folder: await w.moduleFolder('meetings'), seriesFolder: await w.folderOf('meeting-series'), prepOn: w.part('meetings', 'prep'), seriesOn: w.part('meetings', 'series') };
  }
  const withProject = (m: MeetingRec, a: MeetingRec['actions'][number], steps: Record<string, { what: string; who?: string; done: boolean }[]>) => {
    const list = steps[(a.filedTo ?? m.project ?? '').toLowerCase()] ?? [];
    const there = list.find((s) => sameWhat(s.what) === sameWhat(a.what) && ownerCompatible(s.who, a.who));
    // In its project from the moment it is written (t238: the meeting is in the project, so its tasks are too);
    // projectDone still reads a legacy copy ticked there.
    return { ...a, inProject: !!(a.filedTo ?? m.project) || !!there, projectDone: !!there?.done };
  };

  function meetingAt(rel: string): MeetingRec {
    const meta = w.d.index.get(rel);
    return readMeeting({ path: rel, title: meta?.title ?? rel.split('/').pop()!.replace(/\.md$/i, ''), props: meta?.props ?? {}, content: w.noteText(rel), mtime: meta?.mtime }, people());
  }

  // ── Making and changing ──────────────────────────────────────────────────────────────────────────────────────────

  async function addMeeting(input: MeetingInput): Promise<string> {
    // No switch here (Polish round 3, ITEMS 1): a meeting is the vault's own note and the nav's Meetings page
    // adds one for everyone; the module's switch is kept at the window's way in for its extras (work-modules.ts).
    const title = S(input?.title, 120);
    if (!title) throw new Error('A meeting needs a name.');
    const given = S(input.date, 60);
    const date = !given ? w.todayIso() : meetingDay(given, w.today());
    if (!date) throw new Error('Give the day as YYYY-MM-DD, or in words like Friday.');
    // The file's own name is known before the text is written (6 Nov 2026, a second same-day meeting's " 2"
    // belongs to the file only): `title:` keeps what the person typed whenever the file is not it.
    const folder = await w.moduleFolder('meetings');
    const rel = await w.freeNote(folder, `${date} ${title}`);
    const text = newMeetingText({ title, date, fileBase: rel.split('/').pop()!.replace(/\.md$/i, ''), time: S(input.time, 20), where: S(input.where, 120), attendees: (input.attendees ?? []).map((x) => S(x, 80)).filter(Boolean).slice(0, 40), project: S(input.project, 200), series: S(input.series, 200), agenda: (input.agenda ?? []).map((x) => S(x, 400)).filter(Boolean).slice(0, 40), carried: (input.carried ?? []).map((x) => S(x, 400)).filter(Boolean).slice(0, 40) });
    await w.d.requireCreate();
    await w.d.writeNote(rel, text);
    return rel;
  }

  async function addSeries(input: { name: string; cadence?: string; day?: string; time?: string; attendees?: string[]; project?: string; where?: string; standing?: string[] }): Promise<string> {
    w.need('meetings');
    const name = S(input?.name, 120);
    if (!name) throw new Error('A series needs a name.');
    const { model: have } = await read();
    if (have.series.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a series called ${name}.`);
    const cadence = SERIES_CADENCES.find((c) => c.toLowerCase() === S(input.cadence, 20).toLowerCase()) ?? 'Weekly';
    const day = WEEKDAYS.find((d) => d.toLowerCase().startsWith(S(input.day, 12).toLowerCase().slice(0, 3)) && S(input.day, 12).length >= 3) ?? '';
    const people = (input.attendees ?? []).map((x) => S(x, 80)).filter(Boolean);
    const standing = (input.standing ?? []).map((x) => S(x, 300)).filter(Boolean);
    const q = (s: string) => (/^[\w .-]+$/.test(s) && !/^\d/.test(s) ? s : JSON.stringify(s));
    const front = ['type: meeting-series', `cadence: ${cadence}`, ...(day ? [`day: ${day}`] : []), ...(S(input.time, 20) ? [`time: ${q(S(input.time, 20))}`] : []), ...(people.length ? ['attendees:', ...people.map((p) => `  - "[[${linkName(p)}]]"`)] : []), ...(S(input.project, 200) ? [`project: "[[${linkName(S(input.project, 200))}]]"`] : []), ...(S(input.where, 120) ? [`where: ${q(S(input.where, 120))}`] : [])];
    return w.newNote(await w.folderOf('meeting-series'), name, `---\n${front.join('\n')}\n---\n## Purpose\n\n\n## Standing agenda\n\n${standing.length ? standing.map((s) => `- ${s}`).join('\n') : '- '}\n\n## Notes\n\n`);
  }

  /** The next meeting of a series: on its next day, with its people, project and time, its standing agenda, and what
   *  the last one left open (its open actions to follow up, its items not reached). */
  async function nextInSeries(seriesRel: string): Promise<string> {
    const { model: m } = await read();
    const s = m.series.find((x) => x.path === seriesRel);
    if (!s) throw new Error('That series isn’t there any more.');
    const date = s.next ?? w.todayIso();
    const there = m.meetings.find((x) => x.series.toLowerCase() === s.name.toLowerCase() && x.date === date);
    if (there) return there.path;
    const last = m.meetings.filter((x) => x.series.toLowerCase() === s.name.toLowerCase() && x.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const carried = last ? [...last.actions.filter((a) => !a.done).map((a) => `Follow up: ${a.what}${a.who ? ` — ${a.who}` : ''}`), ...last.agenda.filter((a) => !a.done && !s.standing.some((x) => sameWhat(x) === sameWhat(a.text))).map((a) => `Carried over: ${a.text}`)] : [];
    return addMeeting({ title: s.name, date, time: s.time, where: s.where, attendees: s.attendees, project: s.project, series: s.name, agenda: s.standing, carried });
  }

  /** A series made from a meeting (its people, project, time and place), the meeting (and others of the same name) in it. */
  async function makeSeries(rel: string, input: { name?: string; cadence?: string; day?: string; alsoSame?: boolean }): Promise<string> {
    const m = meetingAt(rel);
    const stem = m.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim() || m.title;
    const name = S(input?.name, 120) || stem;
    const weekday = new Date(`${m.date}T12:00:00`).getDay();
    const seriesRel = await addSeries({ name, cadence: input?.cadence || 'Weekly', day: input?.day || WEEKDAYS[(weekday + 6) % 7], time: m.time, attendees: m.people, project: m.project, where: m.where });
    const seriesName = seriesRel.split('/').pop()!.replace(/\.md$/i, '');
    const targets = [rel];
    if (input?.alsoSame !== false) {
      const { model: all } = await read();
      for (const x of all.meetings) if (x.path !== rel && !x.series && x.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim().toLowerCase() === stem.toLowerCase()) targets.push(x.path);
    }
    for (const t of targets) await w.change(t, (text) => setNoteProp(text, 'series', `[[${seriesName}]]`));
    return `Made the series ${seriesName}${targets.length > 1 ? ` with ${targets.length} meetings in it` : ''}.`;
  }

  async function addItem(rel: string, kind: 'agenda' | 'decision' | 'action' | 'question', words: string): Promise<string> {
    // 4000 letters land whole (t250, 12 Nov 2026: 600 cut a 2,000-letter question with no warning, losing its words).
    const t = S(words, 4000).replace(/\n/g, ' ');
    if (!t) throw new Error('Write something first.');
    // A question's tails typed with it ("Who signs off? — for Alex") land as tails, not words.
    const tails = kind === 'question' ? splitQuestionTails(t) : null;
    if (tails && !tails.what) throw new Error('Write the question first.');
    const line = kind === 'decision' ? `- ${t}` : kind === 'question' ? questionLine(tails!.what, tails!) : `- [ ] ${t}`;
    await w.change(rel, (text) => (kind === 'agenda' ? addToSection(text, AGENDA_HEADING, 'Agenda', line, [/^notes?$/i, DECISIONS_HEADING, ACTIONS_HEADING]) : kind === 'decision' ? addToSection(text, DECISIONS_HEADING, 'Decisions', line, [QUESTIONS_HEADING, ACTIONS_HEADING, /^transcript$/i]) : kind === 'question' ? addToSection(text, QUESTIONS_HEADING, 'Questions', line, [ACTIONS_HEADING, /^transcript$/i, /^next meeting$/i]) : addToSection(text, ACTIONS_HEADING, 'Actions', line, [/^transcript$/i, /^next meeting$/i])));
    return '';
  }

  /** A question answered: its answer tail set, the rest of the line as written. */
  async function answerQuestion(rel: string, line: number, raw: string, answer: string): Promise<string> {
    const a = S(answer, 4000).replace(/\n/g, ' ');
    if (!a) throw new Error('Write the answer first.');
    const next = answerQuestionLine(w.noteText(rel), line, raw, a);
    if (next === null) throw new Error('That question moved in the note just now.');
    await w.change(rel, () => next);
    return 'Answered.';
  }

  /** An answered question become a task or a decision in one click (the question keeps its answer). */
  async function questionTo(rel: string, line: number, raw: string, kind: 'task' | 'decision'): Promise<string> {
    const m = meetingAt(rel);
    const q = m.questions.find((x) => x.line === line && x.raw === raw) ?? m.questions.find((x) => x.raw === raw);
    if (!q) throw new Error('That question moved in the note just now.');
    if (!q.answered) throw new Error('Answer it first. The new task starts from the answer.');
    // Its owner written as a typed [[link]] when the vault knows them (never a free-text link); a stranger's
    // name stays as written.
    const known = new Set(people().map((p) => p.toLowerCase()));
    const link = (name?: string) => (name?.trim() && known.has(name.trim().toLowerCase()) ? `[[${name.trim()}]]` : name);
    const out = kind === 'task' ? questionTaskLine({ ...q, owner: link(q.owner) ?? link(q.askedBy), askedBy: undefined }) : questionDecisionLine(q);
    await w.change(rel, (text) => (kind === 'task' ? addToSection(text, ACTIONS_HEADING, 'Actions', out, [/^transcript$/i, /^next meeting$/i]) : addToSection(text, DECISIONS_HEADING, 'Decisions', out, [QUESTIONS_HEADING, ACTIONS_HEADING, /^transcript$/i])));
    return kind === 'task' ? 'Made it a task.' : 'Made it a decision.';
  }

  /** An action ticked: one task, one row — the cascade (src/main/one-task.ts) ticks its matching steps and
   *  lines in its project too, so ticking here ticks the one thing everywhere it shows. An agenda item ticked
   *  marks it covered, never done as a job (12 Nov 2026, t240): the cascade stays out of it. */
  async function tick(rel: string, line: number, raw: string, done: boolean): Promise<string> {
    const index = w.d.index;
    const rels = index.relations();
    await w.change(rel, (text) => setTick(text, line, raw, done));
    const words = anyTaskText(raw);
    if (words === null) return '';
    if (lineInAgenda(w.noteText(rel), line)) return '';
    try {
      const cascade = cascadeForLine(index, (p) => inFolder(p, w.d.prefs().templatesFolder || '') || index.isExcluded(p), { path: rel, line }, words, done, w.today(), rels);
      if (cascade.project) await w.d.writeNote(cascade.project.path, cascade.project.after);
      for (const f of cascade.notes) await w.d.writeNote(f.path, f.after);
      const names: string[] = [];
      if (cascade.project) names.push(w.d.projects().find((x) => x.path === cascade.project!.path)?.name ?? 'its project');
      for (const f of cascade.notes) names.push(f.path.split('/').pop()!.replace(/\.md$/i, ''));
      return names.length ? `${done ? 'Ticked' : 'Unticked'} in ${names.join(', ')} too.` : '';
    } catch (e) {
      // The cascade didn't land: the meeting is flipped back, so the two never disagree.
      let back = false;
      try {
        const m = meetingAt(rel);
        const fresh = m.actions.find((x) => x.line === line) ?? m.actions.find((x) => sameWhat(x.what) === sameWhat(words));
        if (fresh) back = await w.change(rel, (text) => setTick(text, fresh.line, fresh.raw, !done));
      } catch {
        back = false;
      }
      throw new Error(`The rest of the task couldn’t be ticked: ${e instanceof Error ? e.message : String(e)}.${back ? ' The meeting is flipped back.' : ' The meeting still shows it flipped: tick it there to match.'}`);
    }
  }

  async function setProp(rel: string, key: string, value: unknown): Promise<string> {
    const k = S(key, 20);
    if (!['date', 'time', 'where', 'project', 'series', 'people'].includes(k)) throw new Error('That can’t be changed here.');
    let v: unknown = typeof value === 'string' ? value.trim().slice(0, 200) : value;
    if (k === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error('Give the day as it shows in the calendar.');
    if ((k === 'project' || k === 'series') && v) v = `[[${linkName(String(v))}]]`;
    if (k === 'people') {
      const list = (Array.isArray(value) ? value : []).map((x) => S(x, 80)).filter(Boolean).slice(0, 60);
      const meta = w.d.index.get(rel);
      const key2 = Object.keys(meta?.props ?? {}).find((x) => /^(people|attendees)$/i.test(x)) ?? 'people';
      await w.change(rel, (text) => setNoteProp(text, key2, list.length ? list.map((p) => `[[${linkName(p)}]]`) : null));
      return '';
    }
    await w.change(rel, (text) => setNoteProp(text, k, (v as string) || null));
    return '';
  }

  /** Two-way sync's writes (8.9): the link (event, calendar, when they agreed) and, when the calendar moved it, its
   *  day, time and place, all in one change of the note. */
  async function setCalendar(rel: string, patch: unknown): Promise<string> {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const eventId = typeof p.eventId === 'string' ? p.eventId.trim().slice(0, 200) : undefined;
    const calendarId = typeof p.calendarId === 'string' ? p.calendarId.trim().slice(0, 200) : undefined;
    const syncedAt = typeof p.syncedAt === 'number' && Number.isFinite(p.syncedAt) ? new Date(p.syncedAt).toISOString() : typeof p.syncedAt === 'string' && p.syncedAt.trim() ? p.syncedAt.trim().slice(0, 40) : undefined;
    const date = typeof p.date === 'string' ? p.date.trim().slice(0, 10) : undefined;
    const time = typeof p.time === 'string' ? p.time.trim().slice(0, 20) : undefined;
    const where = typeof p.where === 'string' ? p.where.trim().slice(0, 200) : undefined;
    if (date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Give the day as it shows in the calendar.');
    if (eventId === undefined && calendarId === undefined && syncedAt === undefined && date === undefined && time === undefined && where === undefined) throw new Error('Nothing to write.');
    await w.change(rel, (text) => {
      let out = text;
      if (eventId !== undefined) out = setNoteProp(out, 'calendar-event', eventId || null);
      if (calendarId !== undefined) out = setNoteProp(out, 'calendar-id', calendarId || null);
      if (syncedAt !== undefined) out = setNoteProp(out, 'calendar-synced', syncedAt || null);
      if (date !== undefined) out = setNoteProp(out, 'date', date || null);
      if (time !== undefined) out = setNoteProp(out, 'time', time || null);
      if (where !== undefined) out = setNoteProp(out, 'where', where || null);
      return out;
    });
    return '';
  }

  // ── Transcripts ──────────────────────────────────────────────────────────────────────────────────────────────────

  async function pickTranscript(): Promise<{ name: string; text: string } | null> {
    const test = devSwitch('NV_TEST_TRANSCRIPT_FILE');
    const file = test || (await w.d.pickFiles({ title: 'Bring in a meeting’s transcript', button: 'Bring it in', filters: [{ name: 'Transcripts (VTT, SRT, text, Word)', extensions: ['vtt', 'srt', 'txt', 'text', 'md', 'docx'] }] }))[0];
    if (!file) return null;
    const st = await fsp.stat(file);
    if (st.size > 20 * 1024 * 1024) throw new Error('That file is larger than 20 MB, too big for a transcript.');
    const buf = await fsp.readFile(file);
    const text = /\.docx$/i.test(file) ? await docxText(buf) : buf.toString('utf8');
    return { name: path.basename(file), text: text.slice(0, MAX_TRANSCRIPT) };
  }

  /** A transcript (pasted, or from a file) read, written up by the assistant (summary, decisions, actions) and put into
   *  the meeting's note with the transcript folded at the end, the same way a recording is. */
  async function transcript(rel: string, raw: string, from = ''): Promise<{ words: string; lines: number; notes: boolean }> {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Paste the transcript, or choose its file.');
    if (raw.length > MAX_TRANSCRIPT) throw new Error('That transcript is longer than Ironleaf can take in one go (4 MB of text). Bring it in in parts.');
    const lines = readTranscriptText(raw);
    if (!lines.length) throw new Error('Nothing in that reads as a transcript. Paste the words people said (Teams and Zoom transcripts, or “Name: words” lines).');
    const m = meetingAt(rel);
    const known = people();
    let notes: MeetingNotes | null = null;
    let why = '';
    if (!w.d.askJson) why = 'no assistant is set up';
    else {
      try {
        const { reply, error } = await w.d.askJson(MEETING_NOTES_SYSTEM, meetingNotesPrompt({ title: m.title, date: m.date, people: known, ...(m.people.length ? { attendees: m.people } : {}), transcript: transcriptText(lines) }));
        notes = error ? null : readMeetingReply(reply, { transcript: lines, date: m.date, ...(m.people.length ? { attendees: m.people } : {}) });
        if (!notes) why = error ?? 'the assistant’s notes couldn’t be read';
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
    }
    const length = lengthWords(transcriptSeconds(lines) * 1000);
    const had = m.transcripts + m.recordings > 0;
    let added = 0;
    let again = false;
    await w.change(rel, (text) => {
      // The same transcript brought in again (to make the notes once a model is set up): the notes are made, and the
      // transcript already in the note stays as it is, never added twice.
      const same = readTranscript(text).some((p) => p.lines.length === lines.length && p.lines.every((l, i) => l.text === lines[i].text));
      if (same) {
        again = true;
        const cut = splitTranscript(text);
        const r = applyMeetingNotes(cut.rest, notes, { transcript: lines, length, people: known, date: m.date });
        added = r.added;
        return `${splitTranscript(r.text).rest.replace(/\s*$/, '\n\n')}${cut.section}`;
      }
      const r = applyMeetingNotes(text, notes, { transcript: lines, length, people: known, date: m.date, ...(had ? { part: `Part ${m.transcripts + 1} · brought in${from ? ` from ${from}` : ''}` } : {}) });
      added = r.added;
      return r.text;
    });
    return { words: notes ? `${notesWords(notes, added)} ${again ? 'The transcript was in the note already and stays as it was.' : `The transcript (${lines.length} lines) is folded at the end of the note.`}` : `${again ? 'That transcript is in the note already' : `The transcript (${lines.length} lines) is in the note`}, but the notes couldn’t be made: ${why.replace(/\.$/, '')}. Bring it in again once that’s sorted: the notes are made then, and the transcript isn’t added twice.`, lines: lines.length, notes: !!notes };
  }

  // ── The prep pack ────────────────────────────────────────────────────────────────────────────────────────────────

  async function prep(rel: string, index: VaultIndex = w.d.index): Promise<PrepPack> {
    const { model: all, byName } = await read(index);
    const m = all.meetings.find((x) => x.path === rel);
    if (!m) throw new Error('That meeting isn’t there any more.');
    const records = w.d.records(index);
    const today = w.todayIso();
    // Each thing once in the whole pack, however it is worded: exact tellings by sameWhat, near tellings by the
    // minutes' own sameness test (6 Nov 2026, o3-meeting-page item 3), so the count never counts a thing twice.
    // Note titles (linked, recent) keep the exact test only: two notes can share most of a title and both count.
    const seen: { key: string; who?: string }[] = [];
    const kept: { what: string; who?: string }[] = [];
    const freshExact = (x: PrepItem) => {
      const k = sameWhat(x.what);
      if (!k || seen.some((s) => s.key === k && ownerCompatible(s.who, x.who))) return false;
      seen.push({ key: k, ...(x.who ? { who: x.who } : {}) });
      kept.push({ what: x.what, ...(x.who ? { who: x.who } : {}) });
      return true;
    };
    // Another owner's same words are their item, never counted twice away (t179).
    const fresh = (x: PrepItem) => !kept.some((k) => sameJob(k.what, x.what) && ownerCompatible(k.who, x.who)) && freshExact(x);
    const fromOf = (p: string) => all.meetings.find((x) => x.path === p)?.title ?? w.d.projects().find((x) => x.path === p)?.name ?? index.get(p)?.title ?? p.split('/').pop()!.replace(/\.md$/i, '');
    // The series' last meeting first: what it left open is the first thing to pick up.
    let last: PrepPack['last'] = null;
    if (m.series) {
      const prev = all.meetings.filter((x) => x.series.toLowerCase() === m.series.toLowerCase() && x.date < m.date).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev) last = { path: prev.path, title: prev.title, date: prev.date, open: prev.actions.filter((a) => !a.done).map((a) => ({ what: a.what, ...(a.who ? { who: a.who } : {}), ...(a.due ? { due: a.due, overdue: a.due < today } : {}), path: prev.path, from: prev.title })).filter(fresh), notReached: prev.agenda.filter((a) => !a.done).map((a) => a.text) };
    }
    const proj = m.project ? byName.get(m.project.toLowerCase()) : undefined;
    const ppl = m.people.map((name) => {
      const items = personOpenItems(records, name);
      // This meeting's project first, a few only (18 Nov 2026, t301): each person's open items across every
      // project used to lead the pack, whatever the meeting was about.
      const ranked = proj ? prepProjectFirst(items?.theirs ?? [], (r) => r.project === proj.path) : (items?.theirs ?? []);
      const theirs = ranked.slice(0, 6).map((r) => ({ what: r.title, ...(r.owner ? { who: r.owner } : {}), ...(r.due ? { due: r.due, overdue: r.due < today } : {}), path: r.path, from: fromOf(r.path) })).filter(fresh);
      const met = all.meetings.filter((x) => x.path !== m.path && x.date < m.date && x.people.some((p) => p.toLowerCase() === name.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date))[0];
      return { name, theirs, lastMet: met ? { path: met.path, title: met.title, date: met.date } : null };
    });
    let project: PrepPack['project'] = null;
    if (proj) {
      const hub = projectNeeds(records, proj.path);
      project = { name: proj.name, path: proj.path, items: (hub?.attention ?? []).slice(0, 8).map((a) => ({ what: a.title, path: proj.path, from: proj.name, ...(a.tone === 'bad' ? { overdue: true } : {}) })).filter(fresh) };
    }
    const earlier: PrepItem[] = [];
    const mine = new Set(m.people.map((p) => p.toLowerCase()));
    for (const x of all.meetings) {
      if (x.path === m.path || x.date >= m.date || (m.series && x.series.toLowerCase() === m.series.toLowerCase()) || mine.size < 2) continue;
      const shared = x.people.filter((p) => mine.has(p.toLowerCase())).length;
      if (shared < 2 || shared / mine.size < 0.5) continue;
      for (const a of x.actions) if (!a.done) earlier.push({ what: a.what, ...(a.who ? { who: a.who } : {}), ...(a.due ? { due: a.due, overdue: a.due < today } : {}), path: x.path, from: x.title });
    }
    const meetingProject = new Map(all.meetings.map((x) => [x.path, x.project.toLowerCase()]));
    const early = prepProjectFirst(earlier, (x) => !!m.project && (meetingProject.get(x.path) ?? '') === m.project.toLowerCase()).filter(fresh).slice(0, 8);
    // Notes that link to the meeting or that it links to (round 3): the meeting's real context, newest first.
    const meetingPaths = new Set(all.meetings.map((x) => x.path));
    const isPerson = (p: string) => { const meta = index.get(p); return String(meta?.props?.type ?? '').toLowerCase() === 'person' || /(^|\/)people\//i.test(p); };
    const linkedPaths: string[] = [];
    const seenPath = new Set<string>([m.path.toLowerCase(), ...(last ? [last.path.toLowerCase()] : [])]);
    for (const b of index.backlinks(rel)) {
      const p = b.source;
      if (!p || seenPath.has(p.toLowerCase()) || !index.get(p) || isPerson(p)) continue;
      seenPath.add(p.toLowerCase());
      linkedPaths.push(p);
    }
    for (const o of index.outgoing(rel)) {
      const p = o.resolved;
      if (!p || !p.toLowerCase().endsWith('.md') || seenPath.has(p.toLowerCase()) || !index.get(p) || isPerson(p)) continue;
      seenPath.add(p.toLowerCase());
      linkedPaths.push(p);
    }
    const byMtime = (a: string, b: string) => (index.get(b)?.mtime ?? 0) - (index.get(a)?.mtime ?? 0);
    const linked = linkedPaths
      .sort(byMtime)
      .slice(0, 8)
      .map((p) => ({ what: fromOf(p), path: p, from: fromOf(p) }))
      .filter(freshExact);
    // The project's recent notes (round 3): what the project said lately, newest first, the meeting itself left out.
    let recent: PrepItem[] = [];
    if (proj) {
      const want = proj.name.toLowerCase();
      const file = proj.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
      const projFolder = proj.path.includes('/') ? proj.path.slice(0, proj.path.lastIndexOf('/')) : '';
      recent = index
        .allMeta()
        .filter((n) => {
          if (n.path === m.path || n.path === proj.path || meetingPaths.has(n.path) || isPerson(n.path)) return false;
          const prop = n.props?.project;
          const names = (Array.isArray(prop) ? prop : [prop]).map((v) => (typeof v === 'string' ? linkName(v).toLowerCase() : '')).filter(Boolean);
          if (names.some((x) => x === want || x === file)) return true;
          return !!projFolder && n.path.startsWith(`${projFolder}/`);
        })
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .slice(0, 5)
        .map((n) => ({ what: n.title, path: n.path, from: n.title }))
        .filter(freshExact);
    }
    const count = (last?.open.length ?? 0) + (last?.notReached.length ?? 0) + ppl.reduce((s, p) => s + p.theirs.length, 0) + (project?.items.length ?? 0) + early.length + linked.length + recent.length;
    return { meeting: { path: m.path, title: m.title, date: m.date, time: m.time }, people: ppl, last, project, earlier: early, linked, recent, count };
  }

  /** The prep sheet saved into a meeting's note (8.3 wave 1, 30 Oct 2026): the prep pack's items, reworded by the
   *  person's model when one is set up, from those items only. Made on request, or the evening before. */
  async function makePrepSheet(rel: string, index: VaultIndex = w.d.index): Promise<string> {
    const pack = await prep(rel, index);
    let words = prepSheetWords(pack);
    if (w.d.askJson) {
      try {
        const { reply, error } = await w.d.askJson('You write a short meeting prep sheet in plain Australian English. Use only the items given; never add a person, a decision or a date. Reply with JSON {"words": "..."} only.', `Write the prep sheet from these notes:\n\n${words}`);
        const said = !error && reply && typeof reply === 'object' ? (reply as { words?: unknown }).words : undefined;
        if (typeof said === 'string' && said.trim().length > 20 && said.length < 8000) words = said.trim();
      } catch (e) {
        // The pack's own words are the sheet when no model answers; the failure is still logged.
        w.d.log?.(`meetings prep sheet (${rel}): the model couldn't reword it: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await w.change(rel, (text) => withSectionText(text, /^prep sheet$/i, 'Prep sheet', words));
    return words;
  }

  const hasPrepSheet = (rel: string) => {
    try {
      return /^##\s+Prep sheet\b/im.test(w.noteText(rel));
    } catch {
      return true;
    }
  };

  // ── What the project's page shows ────────────────────────────────────────────────────────────────────────────────

  async function forProject(projectPath: string) {
    const { model: m, steps } = await read();
    const p = w.d.projects().find((x) => x.path === projectPath);
    if (!p) return { tile: null, attention: [] };
    const names = projectNameKeys(p);
    const mine = m.meetings.filter((x) => names.includes(x.project.toLowerCase()));
    const upcoming = mine.filter((x) => x.dated && x.date >= m.today).sort((a, b) => a.date.localeCompare(b.date));
    const past = mine.filter((x) => !(x.dated && x.date >= m.today));
    const rows = [...upcoming.slice(0, 3), ...past.slice(0, 5)].map((x) => {
      const open = x.actions.map((a) => withProject(x, a, steps)).filter((a) => !a.done && !a.projectDone).length;
      return { words: x.title.replace(/^\d{4}-\d{2}-\d{2}\s+/, '') || x.title, sub: `${x.date >= m.today && x.dated ? 'Coming up · ' : ''}${dayShort(x.date, m.today)}${x.time ? ` ${x.time}` : ''}${x.decisions.length ? ` · ${x.decisions.length} ${x.decisions.length === 1 ? 'decision' : 'decisions'}` : ''}${open ? ` · ${open} open ${open === 1 ? 'action' : 'actions'}` : ''}`, detail: { kind: 'meeting', key: x.path } };
    });
    return { tile: rows.length ? { title: 'Meetings', rows } : null, attention: [] };
  }

  // ── Notices: prep for today's and tomorrow's meetings ────────────────────────────────────────────────────────────

  async function check(): Promise<WorkNotice[]> {
    if (!w.part('meetings', 'prep')) return [];
    const { model: m } = await read();
    const today = m.today;
    const d = new Date(`${today}T12:00:00`);
    const tomorrow = isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    // The evening before (8.3 wave 1): tomorrow's meetings get their prep sheet made and saved, once.
    if (w.today().getHours() >= 17) {
      for (const x of m.upcoming.filter((u) => u.date === tomorrow).slice(0, 8)) {
        if (hasPrepSheet(x.path)) continue;
        try {
          await makePrepSheet(x.path);
        } catch (e) {
          // One meeting's sheet never stops the notices, but its failure is logged.
          w.d.log?.(`meetings prep sheet (${x.path}): couldn't be made: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    const out: WorkNotice[] = [];
    for (const x of m.upcoming.filter((u) => u.date === today || u.date === tomorrow).slice(0, 8)) {
      const p = await prep(x.path).catch(() => null);
      if (!p || !p.count) continue;
      out.push({ key: `meet:${x.path}:${x.date}`, kind: 'meetings', title: `Prep for ${x.title} (${x.date === today ? 'today' : 'tomorrow'}${x.time ? ` ${x.time}` : ''})`, body: `${p.count} open ${p.count === 1 ? 'item' : 'items'} with the people coming`, path: x.path });
    }
    return out;
  }

  // ── The agents' tools ────────────────────────────────────────────────────────────────────────────────────────────

  async function tool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
    const { model: m, steps } = await read(ctx.gated);
    const refused = ctx.gated === w.d.index ? 0 : (await read()).model.meetings.length - m.meetings.length;
    const refusedWords = refused ? `\n${refused} ${refused === 1 ? 'meeting is' : 'meetings are'} at a level ${ctx.agent} isn’t allowed (Ironleaf › Settings › Privacy and secrets). Don’t guess at ${refused === 1 ? 'it' : 'them'}.` : '';
    const done = (x: MeetingRec) => (a: MeetingRec['actions'][number]) => a.done || withProject(x, a, steps).projectDone;
    if (name === 'meeting_list') {
      const when = S(args.when, 10) || 'upcoming';
      const days = typeof args.days === 'number' && args.days > 0 ? Math.min(366, Math.round(args.days)) : 14;
      const from = isoOf(new Date(w.today().getFullYear(), w.today().getMonth(), w.today().getDate() - days));
      const to = isoOf(new Date(w.today().getFullYear(), w.today().getMonth(), w.today().getDate() + days));
      const project = S(args.project, 200).toLowerCase();
      const person = S(args.person, 80).toLowerCase();
      let list = when === 'recent' ? m.recent.filter((x) => x.date >= from) : when === 'all' ? m.meetings : m.upcoming.filter((x) => x.date <= to);
      if (project) list = list.filter((x) => x.project.toLowerCase().includes(project));
      if (person) list = list.filter((x) => x.people.some((p) => p.toLowerCase().includes(person)));
      if (!list.length) return `No ${when === 'recent' ? 'recent ' : when === 'all' ? '' : 'upcoming '}meetings${project ? ` for ${args.project}` : ''}${person ? ` with ${args.person}` : ''}${when !== 'all' ? ` in the ${days} days ${when === 'recent' ? 'before' : 'ahead'}` : ''}.${refusedWords}`;
      return [`${list.length} ${list.length === 1 ? 'meeting' : 'meetings'}:`, ...list.slice(0, 40).map((x) => `- ${x.date}${x.time ? ` ${x.time}` : ''} ${x.title}${x.people.length ? ` — ${x.people.slice(0, 6).join(', ')}${x.people.length > 6 ? '…' : ''}` : ''}${x.project ? ` · ${x.project}` : ''}${x.decisions.length ? ` · ${x.decisions.length} decisions` : ''}${x.questions.filter((q) => !q.answered).length ? ` · ${x.questions.filter((q) => !q.answered).length} open questions` : ''}${x.actions.filter((a) => !done(x)(a)).length ? ` · ${x.actions.filter((a) => !done(x)(a)).length} open actions` : ''} [${x.path}]`), refusedWords].filter(Boolean).join('\n');
    }
    if (name === 'meeting_get' || name === 'meeting_prep' || name === 'meeting_prep_sheet' || name === 'meeting_follow_up') {
      const x = findMeeting(m.meetings, S(args.meeting, 300), m.today);
      if (!x) return `No meeting matches “${S(args.meeting, 300)}”.${refusedWords}`;
      if (name === 'meeting_get') return meetingWords(x, done(x)) + refusedWords;
      if (name === 'meeting_prep') return prepWords(await prep(x.path, ctx.gated)) + refusedWords;
      if (name === 'meeting_prep_sheet') {
        ctx.check?.(x.path);
        return `${await makePrepSheet(x.path, ctx.gated)}\n\nSaved in its note. [${x.path}]`;
      }
      const draft = followUpDraft(x, done(x), { greeting: S(args.greeting, 60), signoff: S(args.signoff, 60) });
      return `Draft only, not sent. Send it only when the person says so.\n\nSubject: ${draft.subject}\n\n${draft.text}${refusedWords}`;
    }
    if (name === 'meeting_series_add') {
      const nameFor = S(args.name, 120);
      if (!nameFor) return 'A series needs a name.';
      try {
        const rel = await addSeries({ name: nameFor, cadence: S(args.cadence, 20), day: S(args.day, 12), time: S(args.time, 20), attendees: Array.isArray(args.attendees) ? args.attendees.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 80)) : [], project: S(args.project, 200), standing: Array.isArray(args.standing) ? args.standing.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 300)) : [] });
        return `Added the series ${nameFor}. [${rel}]`;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    if (name === 'meeting_action_tick') {
      const x = findMeeting(m.meetings, S(args.meeting, 300), m.today);
      if (!x) return `No meeting matches “${S(args.meeting, 300)}”.${refusedWords}`;
      const want = S(args.action, 400).toLowerCase();
      const a = x.actions.find((y) => y.what.toLowerCase() === want) ?? x.actions.filter((y) => y.what.toLowerCase().includes(want));
      const found = Array.isArray(a) ? (a.length === 1 ? a[0] : undefined) : a;
      if (!found) return Array.isArray(a) && a.length > 1 ? `More than one action in ${x.title} matches that: ${a.map((y) => y.what).join('; ')}. Say which one.` : `There is no action like that in ${x.title}.${x.actions.length ? ` Its actions: ${x.actions.map((y) => y.what).join('; ')}.` : ''}`;
      const doneFlag = args.done !== false;
      if (found.done === doneFlag) return `“${found.what}” in ${x.title} is ${doneFlag ? 'ticked already' : 'not ticked'}. [${x.path}]`;
      ctx.check?.(x.path);
      const said = await tick(x.path, found.line, found.raw, doneFlag);
      return `${doneFlag ? 'Ticked' : 'Unticked'} “${found.what}” in ${x.title}.${said ? ` ${said}` : ''} [${x.path}]`;
    }
    if (name === 'meeting_add') {
      const title = S(args.title, 120);
      const date = meetingDay(S(args.date, 60), w.today());
      if (!title) return 'A meeting needs a title.';
      if (!date) return 'Give the day as YYYY-MM-DD, or in words like Friday.';
      const dup = m.meetings.find((x) => x.date === date && x.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').trim().toLowerCase() === title.toLowerCase());
      if (dup) return `There’s already a meeting called ${title} on ${date} [${dup.path}].`;
      const folder = await w.moduleFolder('meetings');
      const rel = await w.freeNote(folder, `${date} ${title}`);
      ctx.check?.(rel);
      await w.d.requireCreate();
      await w.d.writeNote(rel, newMeetingText({ title, date, fileBase: rel.split('/').pop()!.replace(/\.md$/i, ''), time: S(args.time, 20), attendees: Array.isArray(args.attendees) ? args.attendees.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 80)) : [], project: S(args.project, 200), series: S(args.series, 200), agenda: Array.isArray(args.agenda) ? args.agenda.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 400)) : [] }));
      return `Added the meeting ${title} on ${date} [${rel}].`;
    }
    return `There is no tool called ${name}.`;
  }

  // ── Record views' edits ──────────────────────────────────────────────────────────────────────────────────────────

  async function setField(input: { kind?: string; id?: string; path?: string | null; field?: string; value?: unknown }): Promise<string | null> {
    const rel = S(input?.path, 1000);
    const field = S(input?.field, 40);
    if (!rel) throw new Error('That can’t be changed here.');
    if (input.kind === 'action' && field === 'done') {
      const line = Number(String(input.id ?? '').split('::action:')[1]);
      const a = meetingAt(rel).actions.find((x) => x.line === line);
      if (!a) throw new Error('That action changed in the note just now.');
      return (await tick(rel, a.line, a.raw, input.value === true || input.value === 'true')) || null;
    }
    if (input.kind === 'meeting' && ['date', 'time', 'series'].includes(field)) return (await setProp(rel, field, input.value)) || null;
    if (input.kind === 'series' && ['cadence', 'weekday', 'time'].includes(field)) {
      const key = field === 'weekday' ? 'day' : field;
      await w.change(rel, (text) => setNoteProp(text, key, String(input.value ?? '').trim().slice(0, 40) || null));
      return null;
    }
    throw new Error('That can’t be changed here.');
  }

  const str = (v: unknown, max = 1000) => S(v, max);
  return {
    id: 'meetings',
    ops: {
      model: () => model(),
      'add-meeting': (input: unknown) => addMeeting((input ?? {}) as MeetingInput),
      'add-series': (input: unknown) => addSeries((input ?? {}) as { name: string }),
      'next-in-series': (rel: unknown) => nextInSeries(str(rel)),
      'make-series': (rel: unknown, input: unknown) => makeSeries(str(rel), (input ?? {}) as { name?: string }),
      'add-item': (rel: unknown, kind: unknown, words: unknown) => addItem(str(rel), kind === 'decision' ? 'decision' : kind === 'action' ? 'action' : kind === 'question' ? 'question' : 'agenda', str(words, 4000)),
      tick: (rel: unknown, line: unknown, raw: unknown, done: unknown) => tick(str(rel), Number(line), typeof raw === 'string' ? raw : '', done === true),
      'answer-question': (rel: unknown, line: unknown, raw: unknown, answer: unknown) => answerQuestion(str(rel), Number(line), typeof raw === 'string' ? raw : '', typeof answer === 'string' ? answer : ''),
      'question-task': (rel: unknown, line: unknown, raw: unknown) => questionTo(str(rel), Number(line), typeof raw === 'string' ? raw : '', 'task'),
      'question-decision': (rel: unknown, line: unknown, raw: unknown) => questionTo(str(rel), Number(line), typeof raw === 'string' ? raw : '', 'decision'),
      'set-prop': (rel: unknown, key: unknown, value: unknown) => setProp(str(rel), str(key, 20), value),
      'set-calendar': (rel: unknown, patch: unknown) => setCalendar(str(rel), patch),
      'pick-transcript': () => pickTranscript(),
      transcript: (rel: unknown, text: unknown, from: unknown) => transcript(str(rel), typeof text === 'string' ? text : '', str(from, 120)),
      prep: (rel: unknown) => prep(str(rel)),
      'set-field': (input: unknown) => setField((input ?? {}) as { path?: string }),
      'prep-sheet': (rel: unknown) => {
        w.need('meetings');
        return makePrepSheet(str(rel));
      },
      'follow-up': (rel: unknown) => followUpDraft(meetingAt(str(rel))),
      project: (rel: unknown) => forProject(str(rel)),
    },
    check,
    tool,
    rules: () => 'Meetings: meeting_list and meeting_get for what is coming up and what was said; meeting_prep before a meeting, and meeting_prep_sheet makes its prep sheet and saves it in its note (also made the evening before); meeting_follow_up drafts a follow-up email after a meeting and never sends it (the person says first); add one with meeting_add only with the day the person gave, a series with meeting_series_add, and tick an action with meeting_action_tick (a meeting in a project has its actions as that project’s tasks already).',
  };
}
