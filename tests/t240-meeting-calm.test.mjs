// node --test tests/t240-meeting-calm.test.mjs — calm minutes, contained and linked (12 Nov 2026, t240: the
// owner's 26-minute 1-2-1 made a 529-line note with 16 people in also:, an agenda tick box turned task, an empty
// speaker-map key, a PDF every time and edits scattered across notes). On a made-up 26-minute two-person meeting
// of about 29,000 characters, with 16 names mentioned and 3 decisions, 11 actions and 2 questions: the note's
// shape (sections in order, nothing empty, Discussion folded, Transcript folded and whole), people: holding the
// 2 speakers only, actions as the project's Tasks, questions as Questions, nothing written into any other note,
// and no PDF unless asked. Made-up harbour shop talk only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t240-'));
let M, Mt, T, Q, Wm, F, R, Sp, Mn, Mr;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [...['meeting-minutes', 'meetings', 'tasks', 'questions', 'work-meetings', 'frontmatter', 'recorder', 'meeting-speakers', 'meeting-notes'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`), `export * as m9 from ${JSON.stringify(path.join(root, 'src/main/meeting-recorder.ts'))};`].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  [M, Mt, T, Q, Wm, F, R, Sp, Mn, Mr] = [all.m0, all.m1, all.m2, all.m3, all.m4, all.m5, all.m6, all.m7, all.m8, all.m9];
});
after(() => rmSync(work, { recursive: true, force: true }));

const ME = 'Mia Tran';
const OTHER = 'Jordan Lee';
const PEOPLE = [ME, OTHER, 'Liam Walker', 'Ava Nguyen', 'Ruby Wilson'];
const ATTENDEES = [ME, OTHER];
// Sixteen names only mentioned, never present: suppliers, the team and regulars.
const MENTIONED = ['Liam Walker', 'Ava Nguyen', 'Oliver Smith', 'Isla Brown', 'Jack Davis', 'Ruby Wilson', 'Henry Taylor', 'Grace Moore', 'Leo Martin', 'Zoe Clark', 'Max Hall', 'Ella Young', 'Archie King', 'Lily Wright', 'Hugo Baker', 'Sophie Adams'];
const DATE = '2026-11-06'; // a Friday: "by Friday" said today stays words, never a date

// The meeting itself: decisions, jobs, questions, figures and all sixteen mentions in the first stretch.
const BASE = [
  [0, 'Speaker 1', 'Morning, let us start with the agenda. Three things today: the second coffee counter, the shelf labels and the stocktake.'],
  [25, 'Speaker 2', 'Morning. Before we start, Liam Walker rang about the delivery dock, and Ava Nguyen sent the dock roster.'],
  [50, 'Speaker 1', 'Good. First, the second coffee counter. The fit-out quote came in at forty-eight hundred dollars.'],
  [80, 'Speaker 2', 'Forty-eight hundred for the second counter fit-out. Oliver Smith thought it would be dearer, and Isla Brown agrees.'],
  [110, 'Speaker 1', 'We decided to open the second coffee counter before the Saturday rush. I will ring the contractor about the counter proofs by Friday.'],
  [140, 'Speaker 2', 'And I will confirm the electrician for the second counter by Monday the 9th. Jack Davis needs the dock clear that morning.'],
  [170, 'Speaker 1', 'Ruby Wilson asked about the new grinders. Six new grinders arrive with the counter.'],
  [200, 'Speaker 2', 'Six new grinders, good. Henry Taylor can set them up, and Grace Moore will show the team.'],
  [230, 'Speaker 1', 'Second, the shelf labels. We agreed to keep Harbour Print Co for the shelf labels.'],
  [260, 'Speaker 2', 'Harbour Print Co it is. Leo Martin sent their new samples, and Zoe Clark liked the green ones.'],
  [290, 'Speaker 1', 'I will send the October label proofs to Harbour Print Co today. Max Hall wants a copy too.'],
  [320, 'Speaker 2', 'Can you also ask Harbour Print Co whether Tuesday delivery is possible? Ella Young needs labels by Thursday.'],
  [350, 'Speaker 1', 'I will ask them. Does the receipt show the tax line? That is the question Archie King keeps asking.'],
  [380, 'Speaker 2', 'The new paper shows it. Tell Archie the tax line prints on the new paper. Lily Wright checked it yesterday.'],
  [410, 'Speaker 1', 'Third, the stocktake. We settled to move the stocktake to Monday the 9th of November.'],
  [440, 'Speaker 2', 'Monday the 9th of November for the stocktake. Hugo Baker will bring the two count sheets, and Sophie Adams opens up.'],
  [470, 'Speaker 1', 'Who signs off the oven logs? Nobody has said.'],
  [500, 'Speaker 2', 'Nobody has said who signs off the oven logs. Leave that question with me.'],
  [530, 'Speaker 1', 'I will update the lighting plan: the second counter changes the speaker layout. The lighting plan lives in the project folder.'],
  [560, 'Speaker 2', 'Good. I will chase the failed card payments by Friday, and I will book the window cleaner for next week.'],
  [590, 'Speaker 1', 'I will check the cold room seals by Friday as well. That is everything on my list.'],
  [620, 'Speaker 2', 'And I will order more receipt paper today. We are down to the last box.'],
];

// Routine talk padded out to the meeting's full length (no figures, days or new names: support stays honest).
const FILLER = [
  'The Saturday rush was steady and the queue moved well.',
  'The new roster is up in the back room for everyone to see.',
  'The window display held up fine through the windy week.',
  'Regulars keep asking when the second counter opens.',
  'The back room is tidy again after the delivery.',
  'The morning cash count matched to the dollar.',
  'The afternoon shift swapped without any fuss.',
  'The loyalty cards are running low at the front counter.',
  'The front door bell finally got its new battery.',
  'The plant by the door survived another week.',
];

function transcriptLines() {
  const lines = BASE.map(([at, who, text]) => ({ at, who, text }));
  let i = 0;
  // About 29,000 characters of transcript, like a user's 26-minute meeting.
  while (R.transcriptText(lines).length < 29000) {
    const at = Math.min(1560, 640 + Math.round((i * 920) / 400));
    const extra = i % 3 === 2 ? ` ${MENTIONED[i % MENTIONED.length]} waved through the window.` : '';
    lines.push({ at, who: i % 2 ? 'Speaker 2' : 'Speaker 1', text: `${FILLER[i % FILLER.length]}${extra}` });
    i++;
  }
  return lines;
}

// The answer as the model gives it: 3 decisions, 11 actions, 2 questions, figures with context, and the
// discussion by topic — plus one "None" decision, one figure whose value was never said and one number with an
// invented context, all dropped.
const REPLY = {
  present: ['Mia Tran', 'Jordan Lee'],
  absent: [],
  named: MENTIONED,
  summary: 'Mia and Jordan went over the second coffee counter, the shelf labels and the stocktake. The counter opens before Saturday and the stocktake moves to Monday.',
  figures: [
    { value: '6', label: 'New grinders' },
    { value: '9 November', label: 'Stocktake day' },
    { value: '2', label: 'Count sheets' },
    { value: '$4,800', label: 'Second counter fit-out' },
    { value: '6', label: 'Moon budget' },
  ],
  decisions: [
    { text: 'Open the second coffee counter before the Saturday rush', at: '1:50' },
    { text: 'Keep Harbour Print Co for the shelf labels', at: '3:50' },
    { text: 'Move the stocktake to Monday the 9th', at: '6:50' },
    { text: 'None', at: '7:00' },
  ],
  actions: [
    { what: 'Ring the contractor about the counter proofs', who: 'Mia', when: 'Friday' },
    { what: 'Confirm the electrician for the second counter', who: 'Jordan Lee', when: 'Monday the 9th' },
    { what: 'Send the October label proofs to Harbour Print Co', who: 'Mia Tran', when: 'today' },
    { what: 'Ask Harbour Print Co whether Tuesday delivery is possible', who: '' },
    { what: 'Update the lighting plan: the second counter changes the speaker layout', who: 'Mia Tran' },
    { what: 'Chase the failed card payments', who: 'Jordan Lee', when: 'Friday' },
    { what: 'Book the window cleaner', who: 'Jordan Lee', when: 'next week' },
    { what: 'Check the cold room seals', who: 'Mia Tran', when: 'Friday' },
    { what: 'Order more receipt paper', who: 'Jordan Lee', when: 'today' },
    { what: 'Tell Archie the tax line prints on the new paper', who: 'Mia Tran' },
    { what: 'Ask Hugo Baker about the count sheets', who: 'Jordan Lee' },
  ],
  questions: [
    { what: 'Does the receipt show the tax line?', askedBy: 'Mia Tran', owner: 'Jordan Lee', answer: 'The new paper shows it.' },
    { what: 'Who signs off the oven logs?', askedBy: 'Jordan Lee', owner: '' },
  ],
  topics: [
    { heading: 'Coffee counters', words: ['The second counter opens before the Saturday rush.', 'Six new grinders arrive with the counter, and Liam Walker rang about the back door.'] },
    { heading: 'Shelf labels', words: ['Harbour Print Co keeps the shelf labels.', 'The October proofs go out today, and Ava Nguyen sent the dock roster.'] },
    { heading: 'Stocktake', words: ['The stocktake moves to Monday the 9th of November.', 'The count sheets come with Hugo Baker, and Ruby Wilson asked about the new grinders.'] },
  ],
};

const NAMES = { spk1: ME, spk2: OTHER };

function minutes() {
  return M.readMinutesReply(REPLY, { me: ME, attendees: ATTENDEES, transcript: transcriptLines(), date: DATE, speakerNames: NAMES, voices: ['spk1', 'spk2'] });
}

const NOTE = `---
type: meeting
date: ${DATE}
project: "[[Harbour Counter Refit]]"
---

# ${DATE} Harbour counter 1-2-1

## Agenda

- [ ] Pastoral check-in

## Notes

Jordan seemed rushed at the start.

## Actions

- [ ]
`;

// The notes step's own answer at Stop (the first of the two model calls): the minutes merge with it.
const NOTES_REPLY = {
  summary: 'Mia and Jordan met about the counter refit.',
  decisions: [{ text: 'Open the second coffee counter before the Saturday rush', at: '1:50' }],
  actions: [{ what: 'Ring the contractor about the counter proofs', who: 'Mia Tran', when: 'Friday' }],
  people: ['Mia Tran', 'Jordan Lee'],
  named: ['Liam Walker'],
};

/** The full run, as the app does it: notes at Stop, speaker names kept, then the minutes merged over them. */
function run() {
  const lines = transcriptLines();
  const notes = Mn.readMeetingReply(NOTES_REPLY, { me: ME, attendees: ATTENDEES, transcript: lines, date: DATE, speakerNames: NAMES, voices: ['spk1', 'spk2'] });
  const withNotes = Mn.applyMeetingNotes(NOTE, notes, {
    transcript: lines,
    length: '26 minutes',
    people: PEOPLE,
    me: ME,
    date: DATE,
    recording: 'Recording: [[Files/Harbour counter 1-2-1/recording.webm]] · 26 minutes',
  }).text;
  const named = Sp.writeSpeakerNames(withNotes, Sp.speakerPartKey(0), NAMES);
  const held = M.readMinutesExisting(named);
  const out = M.applyMeetingMinutes(named, minutes(), { people: PEOPLE, me: ME, attendees: ATTENDEES, date: DATE, merged: true, docs: ['lighting plan'] });
  return { lines, held, text: out.text, added: out.added, props: F.readProps(out.text) };
}

test('the fixture is a realistic meeting: about 29,000 characters, two speakers, sixteen mentioned', () => {
  const lines = transcriptLines();
  const sent = R.transcriptText(lines);
  assert.ok(sent.length >= 29000 && sent.length < 34000, `about 29,000 characters, saw ${sent.length}`);
  assert.ok(lines[lines.length - 1].at <= 1560, '26 minutes of moments');
  const speakers = [...new Set(lines.map((l) => l.who))].sort();
  assert.deepEqual(speakers, ['Speaker 1', 'Speaker 2']);
  for (const n of MENTIONED) assert.ok(sent.includes(n), `${n} mentioned`);
});

test('sections in order, nothing empty, no second summary-like section', () => {
  const { text } = run();
  const order = ['## Summary', '## Decisions', '## Actions', '## Questions', '## Key figures', '## Discussion', '## Transcript'].map((h) => text.indexOf(h));
  assert.ok(order.every((at) => at >= 0), 'every section there');
  assert.ok(order.every((at, i) => i === 0 || at > order[i - 1]), 'in order');
  // Nothing empty: every section holds something said.
  for (const [i, h] of ['## Summary', '## Decisions', '## Actions', '## Questions', '## Key figures', '## Discussion', '## Transcript'].entries()) {
    const body = text.slice(order[i] + h.length, i + 1 < order.length ? order[i + 1] : undefined);
    assert.ok(body.split('\n').some((l) => l.trim() && !/^\s*[-*+]\s+\[ \]\s*$/.test(l)), `${h} holds something`);
  }
  assert.ok(!/^## Open$/m.test(text), 'no Open section');
  assert.equal((text.match(/^## Notes$/gm) ?? []).length, 1, 'the person’s own Notes untouched, never a second one');
  assert.ok(!/^- (None|No .* (recorded|decided))\.?$/m.test(text), 'no section with one obvious line');
  assert.ok(text.includes('Jordan seemed rushed at the start.'), 'the person’s words kept');
});

test('people: holds the 2 speakers only; the mentioned linked where mentioned', () => {
  const { text, props } = run();
  assert.deepEqual(props.people, ['[[Mia Tran]]', '[[Jordan Lee]]']);
  // Only the mentioned people the vault knows go in also:, linked (12 Nov 2026, the review: 16 names was clutter).
  assert.deepEqual([...props.also].sort(), ['[[Ava Nguyen]]', '[[Liam Walker]]', '[[Ruby Wilson]]'], 'also: holds the 3 known mentioned people, linked, and nobody else');
  for (const n of MENTIONED) assert.ok(!props.people.some((p) => p.includes(n)), `${n} never listed as present`);
  for (const n of ['Liam Walker', 'Ava Nguyen', 'Ruby Wilson']) assert.ok(text.includes(`[[${n}]]`), `${n} linked where mentioned`);
  // The speaker map keeps a real key.
  assert.ok(!/^\s*"":\s*$/m.test(text), 'no empty speaker-map key');
  assert.deepEqual(Sp.readSpeakerNames(text, 'Part 1'), NAMES);
});

test('actions are the project’s Tasks, with who and when', () => {
  const { text, props } = run();
  assert.equal(props.project, '[[Harbour Counter Refit]]', 'the meeting is in its project');
  const found = Mt.findActions(text, { people: PEOPLE });
  assert.equal(found.length, 11, `eleven actions, saw ${found.map((a) => a.what).join(' | ')}`);
  assert.ok(!found.some((a) => /pastoral/i.test(a.what)), 'the agenda tick box is not an action');
  const tasks = T.findAllTasks(text);
  assert.equal(tasks.length, 11, 'eleven tasks, the agenda box not one of them');
  for (const t of tasks) assert.ok(T.parseTaskLine(text.split('\n')[t.line]), 'each a task line the Tasks view reads');
  const meeting = Wm.readMeeting({ path: 'Meetings/2026-11-06 Harbour counter 1-2-1.md', title: 'Harbour counter 1-2-1', props, content: text }, PEOPLE);
  assert.equal(meeting.project, 'Harbour Counter Refit');
  assert.equal(meeting.actions.length, 11, 'the project reads them as its tasks from the note');
  assert.equal(meeting.agenda.length, 1, 'the agenda item still on the meeting, as coverage');
  assert.ok(Wm.lineInAgenda(text, text.split('\n').findIndex((l) => /Pastoral check-in/.test(l))), 'the agenda line reads as agenda, so ticks never cascade');
  const ring = meeting.actions.find((a) => /Ring the contractor/.test(a.what));
  assert.equal(ring.who, 'Mia Tran', 'a first name matched to its person');
  assert.equal(ring.whenWords, 'Friday', 'loose words stay words');
  const electrician = meeting.actions.find((a) => /Confirm the electrician/.test(a.what));
  assert.equal(electrician.due, '2026-11-09', 'an exact day resolves');
  const ask = meeting.actions.find((a) => /Tuesday delivery/.test(a.what));
  assert.equal(ask.who, undefined, 'nobody named stays unassigned');
  assert.ok(text.includes('Update [[lighting plan|the lighting plan]]: the second counter changes the speaker layout'), 'the lighting plan follow-up is a Task linked to the document, not a note');
});

test('questions are Questions: open and answered, with who', () => {
  const { text } = run();
  const questions = Q.findQuestions(text);
  assert.equal(questions.length, 2);
  const [open, answered] = [questions.find((q) => !q.answered), questions.find((q) => q.answered)];
  assert.equal(open.what, 'Who signs off the oven logs?');
  assert.equal(open.askedBy, 'Jordan Lee');
  assert.equal(answered.what, 'Does the receipt show the tax line?');
  assert.equal(answered.askedBy, 'Mia Tran');
  assert.equal(answered.owner, 'Jordan Lee');
  assert.equal(answered.answer, 'The new paper shows it.');
});

test('the detail folded, the transcript whole with its speakers', () => {
  const { lines, text } = run();
  assert.equal((text.match(/\[!quote\]- /g) ?? []).length, 4, 'three topics and the transcript, each folded');
  assert.ok(!text.includes('### Coffee counters'), 'no unfolded topic headings');
  for (const w of ['The second counter opens before the Saturday rush.', 'Harbour Print Co keeps the shelf labels.', 'The stocktake moves to Monday the 9th of November.']) {
    assert.ok(text.includes(w), 'detail kept, not shown by default');
  }
  const stamps = text.match(/\*\*\d{1,2}:\d{2}(?::\d{2})?\*\*/g) ?? [];
  assert.equal(stamps.length, lines.length, 'every transcript line kept whole');
  const shown = Sp.withSpeakerNames(text);
  assert.ok(shown.includes('*Mia Tran:*') && shown.includes('*Jordan Lee:*'), 'the transcript reads with speaker names');
});

test('figures only with their context, placeholders never written', () => {
  const { text } = run();
  const figures = text.split('## Key figures')[1].split('## Discussion')[0];
  assert.ok(figures.includes('- 6: New grinders') && figures.includes('- 9 November: Stocktake day') && figures.includes('- 2: Count sheets'));
  assert.ok(!text.includes('Moon budget'), 'a number with an invented context never lands');
  assert.ok(!text.includes('$4,800'), 'a value never said never lands');
  assert.ok(!text.includes('- None'), 'no placeholder decision');
  assert.equal(text.split('## Decisions')[1].split('## Actions')[0].split('\n').filter((l) => l.startsWith('- ')).length, 3, 'three decisions, one line each');
});

test('nothing about the meeting written anywhere else; no PDF unless asked', () => {
  const { text } = run();
  // The writer takes one note in and returns one note out: the same input twice is the same output.
  const again = M.applyMeetingMinutes(text, minutes(), { people: PEOPLE, me: ME, attendees: ATTENDEES, date: DATE, merged: true, docs: ['lighting plan'] }).text;
  assert.equal(again, text, 'pure: one note in, one note out, steady on re-run');
  assert.ok(text.includes('Files/Harbour counter 1-2-1/recording.webm'), 'the recording beside the note, as now');
  assert.ok(!text.includes('.pdf'), 'no minutes PDF unless the person asks');
  assert.ok(!/→ \[\[/.test(text), 'no filed marks scattering copies');
  assert.ok(!/^## Document Changes/m.test(text), 'no companion note');
});

test('the assistant and the minutes are taught containment: a meeting stays in its meeting', () => {
  assert.match(M.MINUTES_SYSTEM, /never a second note/, 'the minutes ask keeps everything in the meeting');
  assert.match(M.MINUTES_SYSTEM, /Update the lighting plan/, 'a follow-up that would change a document is an action');
  const agent = readFileSync(path.join(root, 'src/main/agent.ts'), 'utf8');
  assert.ok(agent.includes('A meeting stays in its meeting'), 'the assistant keeps meetings contained');
  assert.ok(agent.includes('never a companion note'), 'the assistant never scatters companion notes');
});

test('the minutes door falls back to what is there when the review call fails', async () => {
  const handlers = {};
  Mr.registerRecorder({
    handle: (ch, fn) => (handlers[ch] = fn),
    requireCreate: async () => {},
    askJson: async () => ({ reply: null, error: 'the host app is not answering just now.' }),
    platform: 'linux',
    dataDir: work,
    saveFile: async (name) => `Attachments/${name}`,
  });
  const existing = {
    summary: 'Mia and Jordan met about the counter refit.',
    decisions: ['Open the second coffee counter before the Saturday rush.'],
    actions: [{ what: 'Ring the contractor about the counter proofs', who: 'Mia Tran', when: 'Friday' }],
    questions: [{ what: 'Who signs off the oven logs?', askedBy: 'Jordan Lee' }],
    topics: [{ heading: 'Coffee counters', words: ['The second counter opens before the Saturday rush.'] }],
  };
  const r = await handlers['recorder:minutes']('Meetings/x.md', { title: 'X', date: DATE, transcript: '[0:00] Speaker 1: hello.', people: [], attendees: ['Mia Tran'], existing }, 'req-1');
  assert.equal(r.partial, true, 'flagged partial, never stuck');
  assert.ok(r.minutes, 'minutes from what is there');
  assert.deepEqual(r.minutes.present, ['Mia Tran']);
  assert.equal(r.minutes.decisions.length, 1);
  assert.equal(r.minutes.actions.length, 1);
  assert.equal(r.minutes.questions.length, 1);
  assert.equal(r.minutes.topics.length, 1);
  assert.ok(r.error.includes('not answering'), 'the failure still said');
  const bare = await handlers['recorder:minutes']('Meetings/x.md', { title: 'X', date: DATE, transcript: '[0:00] Speaker 1: hello.', people: [] }, 'req-2');
  assert.equal(bare.minutes, null, 'nothing there, nothing made');
  assert.equal(bare.partial, undefined);
  assert.ok(bare.error.includes('not answering'));
});

test('a failed review still leaves minutes made from what is there', () => {
  const { held, text } = run();
  assert.ok(M.hasMinutesExisting(held), 'the note holds minutes to fall back on');
  const first = M.minutesFromExisting(held, ATTENDEES);
  assert.ok(first, 'minutes rebuilt from the notes-step content without the model');
  assert.deepEqual(first.present, ATTENDEES);
  assert.equal(first.decisions.length, 1, 'what the notes held, no more');
  assert.equal(first.actions.length, 1);
  const again = M.minutesFromExisting(M.readMinutesExisting(text), ATTENDEES);
  assert.ok(again, 'minutes rebuilt from full minutes without the model');
  assert.equal(again.decisions.length, 3);
  assert.equal(again.actions.length, 11);
  assert.equal(again.questions.length, 2);
  assert.equal(again.topics.length, 3);
  assert.equal(M.minutesFromExisting(undefined), null, 'nothing there, nothing made');
  assert.match(M.minutesFallbackWords(), /already in the note/);
});
