// node --test tests/hub.test.mjs — Today as the hub (src/shared/hub.ts, src/main/hub.ts; 20 Oct 2026, "Ironleaf Calm"):
// Monday-first weeks and month calendars, days said as people say them, open task lines and the day each says (and only
// a plain one), Due grouped Overdue / Today / Next 7 days / No date with reminders, the days a note mentions, a day's
// meetings, made / changed / linked notes, the strip's dots, the day's note made on its first words, Home's choices kept
// on Today, and a task ticked through the note's own write. Made-up notes; a fixed today (Tuesday 20 October 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-hub-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};\nexport { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'hub.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  H = await import(pathToFileURL(path.join(work, 'hub.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-10-20'; // a Tuesday
const NOW = new Date(2026, 9, 20, 10, 0).getTime();
const at = (days, hours = 10, minutes = 0) => new Date(2026, 9, 20 + days, hours, minutes).getTime();

test('weeks start on Monday; a month is six weeks from the Monday on or before the 1st', () => {
  assert.deepEqual(H.weekOf(TODAY), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(H.weekOf('2026-10-25')[0], '2026-10-19', 'a Sunday is the end of its week');
  const grid = H.monthGrid(TODAY);
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-09-28');
  assert.ok(grid.includes('2026-10-01') && grid.includes('2026-10-31'));
  assert.equal(H.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(H.addDays('2026-04-05', -1), '2026-04-04', 'daylight saving never skips a day');
  assert.equal(H.daysApart(TODAY, '2026-11-01'), 12);
});

test('days are said as people say them, Australian style', () => {
  assert.equal(H.longDay(TODAY, TODAY), 'Tuesday 20 October');
  assert.equal(H.longDay('2027-01-04', TODAY), 'Monday 4 January 2027');
  assert.equal(H.nearWords(TODAY, TODAY), 'Today');
  assert.equal(H.nearWords('2026-10-19', TODAY), 'Yesterday');
  assert.equal(H.nearWords('2026-10-21', TODAY), 'Tomorrow');
  assert.equal(H.nearWords('2026-10-13', TODAY), null);
  assert.equal(H.nearWords('2026-10-14', TODAY), 'Last Wednesday');
  assert.equal(H.nearWords('2026-10-23', TODAY), 'Friday');
  // 5 Nov 2026, the plan: the one reader — late reads as lateness, not the date.
  assert.equal(H.dueDayWords('2026-10-16', TODAY), '4 days late');
  assert.equal(H.monthWords('2026-12-01', TODAY), 'December');
  assert.equal(H.isIsoDay('2026-02-30'), false);
});

test('a task line says its day only when it says it plainly; the words shown leave the day out', () => {
  const ref = new Date(NOW);
  assert.deepEqual(H.taskDue('Call Priya — by 23 Oct 2026', ref), { due: '2026-10-23', words: 'Call Priya' });
  assert.deepEqual(H.taskDue('Send the quote 📅 2026-10-22', ref), { due: '2026-10-22', words: 'Send the quote' });
  assert.deepEqual(H.taskDue('Order flour [due:: 2026-10-19]', ref), { due: '2026-10-19', words: 'Order flour' });
  assert.equal(H.taskDue('Book the van (due Fri 23 Oct)', ref).due, '2026-10-23');
  assert.deepEqual(H.taskDue('Prep for [[2026-10-21]] board meeting', ref), { due: '2026-10-21', words: 'Prep for [[2026-10-21]] board meeting' });
  assert.equal(H.taskDue('Ring the bank by Friday', ref).due, null, '"by Friday" said some other day no longer says which Friday');
  assert.equal(H.taskDue('Fix the 2 by 4 timber', ref).due, null);
});

test('open task lines are found outside code and properties; reminders and empty boxes are left out', () => {
  const note = ['---', 'tags: [daily]', 'todo: "- [ ] not a task"', '---', '## Focus', '- [ ]', '- [ ] Call Priya — by 23 Oct 2026', '- [x] Done already', '* [ ] Order flour ⏰ 2026-10-23 09:00', '```', '- [ ] in code', '```', '  1. [ ] Numbered and indented'].join('\n');
  const tasks = H.findTasks(note, new Date(NOW));
  assert.deepEqual(
    tasks.map((t) => [t.line, t.text, t.due]),
    [
      [6, 'Call Priya — by 23 Oct 2026', '2026-10-23'],
      [12, 'Numbered and indented', null],
    ],
  );
  const lines = ['intro', '- [ ] Call Priya'];
  assert.equal(H.locateTask(lines, 1, 'Call Priya'), 1);
  assert.equal(H.locateTask(['new line', ...lines], 1, 'Call Priya'), 2, 'found again when lines above it changed');
  assert.equal(H.locateTask(lines, 1, 'Gone'), -1);
});

test('an in-progress box is an open task line, like an empty one (9.5 fourth pass)', () => {
  const tasks = H.findTasks('- [/] Halfway there\n- [?] Not sure\n- [x] Done\n- [-] Dropped', new Date(NOW));
  assert.deepEqual(tasks.map((t) => t.text), ['Halfway there', 'Not sure']);
});

test('two identical lines get distinct keys from the one shared helper (9.5 fourth pass)', () => {
  assert.equal(H.taskKey('N.md', 'Call Sam'), 'N.md\nCall Sam', 'the first keeps the plain key');
  assert.notEqual(H.taskKey('N.md', 'Call Sam'), H.taskKey('N.md', 'Call Sam', 1));
});

const reminder = (text, due, extra = {}) => ({ key: `R.md\n${text}\n${due}`, path: 'R.md', title: 'R', line: 0, text, due, timeGiven: true, repeat: null, done: false, ...extra });
const task = (words, due, extra = {}) => ({ key: `T.md\n${words}`, path: 'T.md', title: 'T', line: 0, text: words, words, due, ...extra });

test('Due: Overdue, Today and the Next 7 days with reminders and tasks together; no date apart, counted', () => {
  const g = H.groupDue(
    [task('Last week', '2026-10-13'), task('Today’s task', TODAY), task('Friday', '2026-10-23'), task('Eight days', '2026-10-28'), task('Later', '2026-11-30'), task('Whenever', null), task('Someday', null)],
    [reminder('Passed this morning', at(0, 9)), reminder('This afternoon', at(0, 15)), reminder('Thursday', at(2, 9)), reminder('Ticked', at(-1), { done: true })],
    NOW,
    1,
  );
  assert.deepEqual(g.overdue.map((e) => e.kind === 'task' ? e.item.words : e.item.text), ['Last week', 'Passed this morning']);
  assert.deepEqual(g.today.map((e) => e.kind === 'task' ? e.item.words : e.item.text), ['This afternoon', 'Today’s task'], 'a timed reminder before the day’s tasks');
  assert.deepEqual(g.week.map((e) => e.kind === 'task' ? e.item.words : e.item.text), ['Thursday', 'Friday']);
  assert.equal(g.undatedCount, 2);
  assert.equal(g.undated.length, 1, 'only the first few undated are sent');
  const on = H.dueOn([task('Friday', '2026-10-23')], [reminder('Friday 9', at(3, 9))], '2026-10-23');
  assert.deepEqual(on.map((e) => e.kind), ['reminder', 'task']);
});

test('the days a note mentions: properties and words, but not its own made or changed dates', () => {
  const note = ['---', 'created: 2026-10-01', 'updated: 2026-10-02', 'due: 2026-10-20', '---', 'See [[2026-10-21]] and 2026-10-22.', 'Not 2026-13-01 or 12026-10-20x.'].join('\n');
  assert.deepEqual(H.datesIn(note).sort(), ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.deepEqual(H.datesIn('No dates here.'), []);
});

test('made, meeting days and times', () => {
  assert.equal(H.madeDay({ props: { created: '2026-10-20 09:14' }, mtime: at(1) }), TODAY);
  assert.equal(H.madeDay({ props: {}, born: at(0), mtime: at(1) }), TODAY);
  assert.equal(H.madeDay({ props: {}, born: at(1), mtime: at(-3) }), '2026-10-17', 'a copied or synced file keeps its older changed time');
  assert.equal(H.madeDay({ props: {}, mtime: at(0) }), null);
  const ref = new Date(NOW);
  assert.equal(H.meetingDay({ path: 'Meetings/Supplier call.md', props: { type: 'meeting', date: '2026-10-20 14:00' } }, ref), TODAY);
  assert.equal(H.meetingDay({ path: 'Notes/Catch-up.md', props: { type: 'meeting', date: '21 Oct 2026' } }, ref), '2026-10-21');
  assert.equal(H.meetingDay({ path: 'Meetings/2026-10-22 Board.md', props: {} }, ref), '2026-10-22');
  assert.equal(H.meetingDay({ path: 'Notes/Shopping.md', props: { date: TODAY } }, ref), null, 'not a meeting');
  assert.equal(H.meetingDay({ path: 'Meetings/Undated.md', props: { type: 'meeting' } }, ref), null);
  assert.equal(H.meetingTime({ date: '2026-10-20 14:00' }), '14:00');
  assert.equal(H.meetingTime({ time: '9:30 am' }), '9:30 am');
});

test('a day: its meetings, then made, linked and changed notes, each once; saved pages apart; the day’s note itself left out', () => {
  const notes = [
    { path: 'Daily/2026-10-20.md', title: '2026-10-20', mtime: at(0), born: at(0), props: {} },
    { path: 'Meetings/Supplier call.md', title: 'Supplier call', mtime: at(-2), props: { type: 'meeting', date: TODAY, time: '14:00', attendees: ['[[Mia Tran]]', 'Sam'] } },
    { path: 'Meetings/Standup.md', title: 'Standup', mtime: at(-2), props: { type: 'meeting', date: TODAY, time: '09:00' } },
    { path: 'Ideas.md', title: 'Ideas', mtime: at(0, 11), born: at(0, 8), props: { type: 'idea' } },
    { path: 'Plan.md', title: 'Plan', mtime: at(0, 12), born: at(-30), props: { due: TODAY } },
    { path: 'Links back.md', title: 'Links back', mtime: at(-5), born: at(-30), props: {} },
    { path: 'Old.md', title: 'Old', mtime: at(0, 9), born: at(-30), props: {} },
    { path: 'Saved from NeuralSpark/Bread.md', title: 'Bread', mtime: at(0, 10), born: at(0, 10), props: { source: 'https://example.com' } },
    { path: 'Templates/Daily note.md', title: 'Daily note', mtime: at(0), born: at(0), props: {} },
    { path: 'Untouched.md', title: 'Untouched', mtime: at(-9), born: at(-30), props: {} },
  ];
  const dates = { 'Plan.md': [TODAY] };
  const day = H.buildDay({ iso: TODAY, notes, dates: (p) => dates[p] ?? [], daily: { path: 'Daily/2026-10-20.md', exists: true }, linkedToDaily: ['Links back.md'], skip: (p) => p.startsWith('Templates/'), now: new Date(NOW) });
  assert.deepEqual(day.meetings.map((m) => [m.time, m.title]), [['09:00', 'Standup'], ['14:00', 'Supplier call']]);
  assert.deepEqual(day.meetings[1].attendees, ['Mia Tran', 'Sam']);
  assert.deepEqual(day.made.map((n) => [n.title, n.type]), [['Ideas', 'idea']]);
  assert.deepEqual(day.linked.map((n) => n.title), ['Plan', 'Links back'], 'linked comes before changed');
  assert.deepEqual(day.changed.map((n) => n.title), ['Old']);
  assert.deepEqual(day.saved.map((n) => n.title), ['Bread']);
  assert.equal(day.counts.made, 1);
});

test('saved pages: the new neutral folder for new saves, the old host-app folder still read (20 Nov 2026)', () => {
  assert.equal(H.SAVED_FOLDER, 'Saved pages');
  assert.doesNotMatch(H.SAVED_FOLDER, /NeuralSpark/);
  assert.deepEqual([...H.SAVED_FOLDERS], ['Saved pages', 'Saved from NeuralSpark']);
  const notes = [
    { path: 'Saved pages/Soup.md', title: 'Soup', mtime: at(0, 10), born: at(0, 10), props: {} },
    { path: 'Saved from NeuralSpark/Bread.md', title: 'Bread', mtime: at(0, 11), born: at(0, 11), props: {} },
    { path: 'saved PAGES/Tea.md', title: 'Tea', mtime: at(0, 12), born: at(0, 12), props: {} },
    { path: 'Saved pages elsewhere/Not.md', title: 'Not', mtime: at(0, 9), born: at(0, 9), props: {} },
  ];
  const day = H.buildDay({ iso: TODAY, notes, dates: () => [], daily: { path: 'Daily/2026-10-20.md', exists: false }, linkedToDaily: [], skip: () => false, now: new Date(NOW) });
  assert.deepEqual(day.saved.map((n) => n.title).sort(), ['Bread', 'Soup', 'Tea']);
});

test('the strip’s dots: the day’s note, meetings and what is due, only for the days shown', () => {
  const days = H.weekOf(TODAY);
  const marks = H.buildMarks(days, { hasNote: (d) => d === '2026-10-19', meetingDays: [TODAY, TODAY, '2026-11-02'], dueDays: ['2026-10-23'] });
  assert.deepEqual(marks, { '2026-10-19': { note: true }, [TODAY]: { meetings: 2 }, '2026-10-23': { due: 1 } });
});

test('the day’s note on its first words: the template with the words under Notes, the cursor after them', () => {
  const template = '---\ntags: [daily]\n---\n## Focus\n- [ ]\n\n## Notes\n\n\n## Done today\n-\n';
  const r = H.firstWords(template, 'Rang the bank');
  assert.equal(r.text, '---\ntags: [daily]\n---\n## Focus\n- [ ]\n\n## Notes\nRang the bank\n\n## Done today\n-\n');
  assert.equal(r.text.slice(0, r.cursor).endsWith('Rang the bank'), true);
  const plain = H.firstWords('# A day\n', 'Hello');
  assert.equal(plain.text, '# A day\n\nHello\n');
  assert.deepEqual(H.firstWords('', 'Just words'), { text: 'Just words', cursor: 10 });
});

test('a new meeting is typed a meeting and dated, with the headings meeting actions read', () => {
  const text = H.meetingNoteText('2026-10-21', TODAY);
  assert.match(text, /^---\ntype: meeting\ndate: 2026-10-21\n/);
  assert.match(text, /\*\*When:\*\* Wednesday 21 October/);
  assert.match(text, /## Actions\n- \[ \] /);
  assert.equal(H.meetingName('2026-10-21'), 'Meeting 21 Oct 2026');
});

test('Home folded into Today: a person who chose Home keeps their choices; one who chose Today keeps theirs', () => {
  assert.deepEqual(H.todayHidden({ today: true, hidden: ['today:risk', 'ribbon:graph'] }), ['today:risk', 'ribbon:graph']);
  const fromHome = H.todayHidden({ today: false, hidden: ['home:projects', 'home:ask', 'today:week', 'ribbon:graph'] });
  // (4 Nov 2026: the ask-box pair went with the middle box; a saved home:ask simply washes out.)
  assert.deepEqual(fromHome.sort(), ['ribbon:graph', 'today:changed', 'today:due', 'today:risk', 'today:waiting'].sort());
  assert.ok(!fromHome.includes('today:week'), 'Today’s own choices from before Home was chosen are not carried over');
});

test('the index keeps open tasks and mentioned days; the hub ticks a task through the note’s own write', async () => {
  const index = new H.VaultIndex();
  const notes = {
    'Daily/2026-10-20.md': '## Notes\n- [ ] Call Priya — by 23 Oct 2026\n- [ ] Tidy the shed\n',
    'Projects/Bakery/Bakery.md': '---\ntype: project\n---\n## What’s next\n- [ ] A project step — by 21 Oct 2026\n',
    'Templates/Daily note.md': '- [ ] Template task\n',
    'Plan.md': '---\ndue: 2026-10-20\n---\nLinks [[2026-10-20]]\n',
  };
  for (const [p, text] of Object.entries(notes)) index.set(p, text, at(0), text.length, p === 'Plan.md' ? at(-30) : at(0));
  assert.deepEqual(index.daysIn('Plan.md'), ['2026-10-20']);
  assert.equal(index.get('Plan.md').born, at(-30));
  const writes = [];
  const hub = new H.Hub({
    index,
    dailyPath: (d) => `Daily/${H.isoOf(d)}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => [reminder('Order flour', at(3, 9))],
    write: async (rel, text) => {
      writes.push([rel, text]);
      index.set(rel, text, at(0), text.length);
    },
    startDay: async (d) => `Daily/${H.isoOf(d)}.md`,
    now: () => NOW,
  });
  const due = hub.due();
  assert.deepEqual(due.week.map((e) => e.kind === 'task' ? e.item.words : e.item.text), ['Order flour', 'Call Priya']);
  assert.deepEqual(due.undated.map((t) => t.words), ['Tidy the shed'], 'project steps and templates are left out');
  const marks = hub.marks('2026-10-19', '2026-10-25');
  assert.deepEqual(marks[TODAY], { note: true });
  assert.equal(marks['2026-10-23'].due, 2);
  const day = hub.day(TODAY);
  assert.equal(day.daily.exists, true);
  assert.deepEqual(day.linked.map((n) => n.path), ['Plan.md']);
  assert.equal(await hub.tick('Daily/2026-10-20.md', 2, 'Tidy the shed', true), 'Done.');
  assert.equal(writes[0][1], '## Notes\n- [ ] Call Priya — by 23 Oct 2026\n- [x] Tidy the shed\n');
  assert.equal(hub.due().undatedCount, 0, 'the index forgets a ticked task');
  await assert.rejects(hub.tick('Daily/2026-10-20.md', 2, 'Gone', true), /isn’t in its note/);
});

test('Due still shows when the reminders cannot be read, and says so in the log (9.5 fourth pass)', () => {
  const index = new H.VaultIndex();
  index.set('Daily/2026-10-20.md', '## Notes\n- [ ] Tidy the shed\n', at(0), 30);
  const logged = [];
  const hub = new H.Hub({
    index,
    dailyPath: (d) => `Daily/${H.isoOf(d)}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => { throw new Error('index locked'); },
    write: async () => {},
    startDay: async (d) => `Daily/${H.isoOf(d)}.md`,
    now: () => NOW,
    log: (m) => logged.push(m),
  });
  assert.deepEqual(hub.due().undated.map((t) => t.words), ['Tidy the shed']);
  assert.equal(logged.length, 1);
});

test('ticking with a bad line number asks which task, never the nearest (9.5 fourth pass)', async () => {
  const index = new H.VaultIndex();
  index.set('N.md', '- [ ] First\n- [ ] Second\n', at(0), 30);
  const hub = new H.Hub({
    index,
    dailyPath: (d) => `Daily/${H.isoOf(d)}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => [],
    write: async () => {},
    startDay: async (d) => `Daily/${H.isoOf(d)}.md`,
    now: () => NOW,
  });
  await assert.rejects(hub.tick('N.md', 'x', 'Second', true), /Which task/);
  await assert.rejects(hub.tick('N.md', 1.5, 'Second', true), /Which task/);
});

test('a task under ```` stays hidden even past a ``` line (9.5 fourth pass)', () => {
  const tasks = H.findTasks('````\n- [ ] hidden\n```\n- [ ] still hidden\n````\n- [ ] shown', new Date(NOW));
  assert.deepEqual(tasks.map((t) => t.text), ['shown']);
});

test('meetings sort by time of day, however the time is written (9.5 fourth pass)', () => {
  const notes = [
    { path: 'Meetings/A.md', title: 'Late', mtime: at(0), props: { type: 'meeting', date: TODAY, time: '14:00' } },
    { path: 'Meetings/B.md', title: 'Early', mtime: at(0), props: { type: 'meeting', date: TODAY, time: '9:30 am' } },
    { path: 'Meetings/C.md', title: 'No time', mtime: at(0), props: { type: 'meeting', date: TODAY } },
  ];
  const day = H.buildDay({ iso: TODAY, notes, dates: () => [], daily: { path: 'Daily/2026-10-20.md', exists: false }, linkedToDaily: [], skip: () => false, now: new Date(NOW) });
  assert.deepEqual(day.meetings.map((m) => m.title), ['Early', 'Late', 'No time']);
});

test('the day’s note keeps its line ends and finds Notes however the heading reads (9.5 fourth pass)', () => {
  const crlf = H.firstWords('## Notes\r\n\r\n', 'Rang the bank');
  assert.ok(crlf.text.includes('\r\n'), 'Windows line ends stay');
  assert.ok(!crlf.text.replace(/\r\n/g, '').includes('\n'), 'no stray LF');
  assert.equal(crlf.text.slice(0, crlf.cursor), '## Notes\r\nRang the bank');
  assert.equal(H.firstWords('## Notes for Tuesday\n', 'Hi').text, '## Notes for Tuesday\nHi\n');
  assert.equal(H.firstWords('## Notes:\n', 'Hi').text, '## Notes:\nHi\n');
  assert.equal(H.firstWords('## Noteworthy\n', 'Hi').text, '## Noteworthy\n\nHi\n', 'a longer word is not the Notes head');
});

test('a meeting under its own day drops the date the day already shows', () => {
  assert.equal(H.meetingTitle('2026-10-20 Site walk with Dave', TODAY), 'Site walk with Dave');
  assert.equal(H.meetingTitle('Supplier call – 20 Oct 2026', TODAY), 'Supplier call');
  assert.equal(H.meetingTitle('Meeting 20 Oct 2026', TODAY), 'Meeting');
  assert.equal(H.meetingTitle('2026-10-20', TODAY), '2026-10-20');
  assert.equal(H.meetingTitle('2026-10-21 Prep for Wednesday', TODAY), '2026-10-21 Prep for Wednesday');
  assert.equal(H.meetingTitle('Standup', TODAY), 'Standup');
});
