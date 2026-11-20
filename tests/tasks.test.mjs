// node --test tests/tasks.test.mjs — Tasks across the notes (src/shared/tasks.ts, src/main/tasks.ts; 21 Oct 2026, gap
// G24): task lines read open and done, the one plain due syntax ("📅 2026-10-24", with a time) and the community formats
// read too, the project, people and tags of each task, the filters (open/done, today, overdue, this week, no date,
// project, person, tag) and the sort by due day, the due day written back, a task made a reminder, and a tick written into
// the note through its own write. Made-up notes; a fixed today (Wednesday 21 October 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tasks-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};\nexport { readTaskDue, taskDue } from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};\nexport { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'tasks.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  T = await import(pathToFileURL(path.join(work, 'tasks.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-10-21'; // a Wednesday
const NOW = new Date(2026, 9, 21, 10, 0).getTime();
const REF = new Date(NOW);

test('a task line: open or done, its words without the day, its tags and links', () => {
  const t = T.parseTaskLine('- [ ] Send the quote to [[Sam Okafor]] #work 📅 2026-10-24', REF);
  assert.equal(t.done, false);
  assert.equal(t.due, '2026-10-24');
  assert.equal(t.time, null);
  assert.equal(t.words, 'Send the quote to [[Sam Okafor]] #work');
  assert.deepEqual(t.tags, ['work']);
  assert.deepEqual(t.links, ['Sam Okafor']);
  assert.equal(T.parseTaskLine('* [x] Booked the van', REF).done, true);
  assert.equal(T.parseTaskLine('1. [X] Numbered', REF).done, true);
  assert.equal(T.parseTaskLine('- [-] Cancelled one', REF).done, true);
  assert.equal(T.parseTaskLine('- [ ] ', REF), null, 'an empty box is not a task');
  assert.equal(T.parseTaskLine('- not a task', REF), null);
  assert.equal(T.parseTaskLine('- [ ] Issue #42 is fixed', REF).tags.length, 0, 'a number is not a tag');
  // Loose day words are no day in Tasks either (6 Nov 2026, e2): the words stay whole.
  const fri = new Date(2026, 10, 6, 10, 0);
  assert.equal(T.parseTaskLine('- [ ] Chase the stone top for Thursday morning — by Thursday morning', fri).due, null, '"Thursday morning" names no known day');
  assert.equal(T.parseTaskLine('- [ ] Check the totals — Kate · by Friday', fri).due, null, 'a bare weekday names no known day here');
  // HOLD 5 (6 Nov 2026): a weekday with a numbered day is never read as the coming weekday here
  // either. Without its month it is a plain-words day (the note editor firms it as it is written);
  // with its month it is that date, and a weekday that does not fall on it stays words.
  const crane = T.parseTaskLine('- [ ] Book the crane by Thursday the 19th', fri);
  assert.equal(crane.due, null, 'never Thu 12 Nov in Tasks');
  assert.equal(crane.words, 'Book the crane by Thursday the 19th', 'the phrase stays whole in the words');
  assert.deepEqual(T.readTaskDue('Book the crane — by Thursday the 19th of November 2026', fri), { due: '2026-11-19', time: null, words: 'Book the crane' });
  assert.equal(T.readTaskDue('Book the hoist — by Monday the 19th of November 2026', fri).due, null, '19 Nov 2026 is a Thursday, not a Monday');
  assert.equal(T.readTaskDue('Book the hoist — by Monday the 19th of November 2026', fri).words, 'Book the hoist — by Monday the 19th of November 2026', 'doubtful words stay whole');
});

test('the one plain syntax, with a time; and the community formats read on import', () => {
  assert.deepEqual(T.readTaskDue('Ring the mill 📅 2026-10-24 15:00', REF), { due: '2026-10-24', time: '15:00', words: 'Ring the mill' });
  assert.deepEqual(T.readTaskDue('Ring the mill 📅 2026-10-24 3:30pm', REF), { due: '2026-10-24', time: '15:30', words: 'Ring the mill' });
  assert.equal(T.readTaskDue('Order 📅 2026-10-24 9 bags', REF).time, null, 'a number alone is not a time');
  assert.equal(T.readTaskDue('Order 📅 2026-10-24 9 bags', REF).words, 'Order 9 bags');
  assert.equal(T.readTaskDue('Pay the invoice due:: 2026-10-30', REF).due, '2026-10-30');
  assert.equal(T.readTaskDue('Pay the invoice [due:: 2026-10-30]', REF).words, 'Pay the invoice');
  assert.equal(T.readTaskDue('Pay the invoice due:2026-10-30', REF).due, '2026-10-30');
  assert.deepEqual(T.readTaskDue('Draft the plan @due(2026-10-23 09:30)', REF), { due: '2026-10-23', time: '09:30', words: 'Draft the plan' });
  assert.deepEqual(T.readTaskDue('Call Priya — by 23 Oct 2026 at 2pm', REF), { due: '2026-10-23', time: '14:00', words: 'Call Priya' });
  // Other formats' marks are read but not shown: done, scheduled and start days, priorities, repeats.
  const t = T.parseTaskLine('- [x] Water the plants ⏫ 🔁 every week 📅 2026-10-20 ✅ 2026-10-20', REF);
  assert.equal(t.words, 'Water the plants');
  assert.equal(t.priority, 'high');
  assert.equal(t.due, '2026-10-20');
  // The existing Today reading is unchanged.
  assert.deepEqual(T.taskDue('Send the quote 📅 2026-10-22', REF), { due: '2026-10-22', words: 'Send the quote' });
});

test('a reminder line is a task with its moment as its day and time', () => {
  const r = T.parseTaskLine('- [ ] Put the bins out ⏰ 2026-10-26 18:30 every Monday', REF);
  assert.equal(r.reminder, true);
  assert.equal(r.repeats, true);
  assert.equal(r.due, '2026-10-26');
  assert.equal(r.time, '18:30');
  assert.equal(r.words, 'Put the bins out');
});

test('task lines in fenced code and the properties are left out; done lines are found too', () => {
  const note = ['---', 'tags: [x]', 'todo: "- [ ] not this"', '---', '- [ ] One', '```', '- [ ] Code', '```', '- [x] Two', '  - [ ] Nested'].join('\n');
  const found = T.findAllTasks(note, REF);
  assert.deepEqual(found.map((t) => [t.line, t.words, t.done]), [[4, 'One', false], [8, 'Two', true], [9, 'Nested', false]]);
});

const NOTES = [
  { path: 'Projects/Harbour/Harbour.md', title: 'Harbour', mtime: 5, tags: [], props: { type: 'project' }, content: '---\ntype: project\n---\n## What’s next\n\n- [ ] Book the crane — by 20 Oct 2026\n- [x] Sign the lease\n' },
  { path: 'Projects/Harbour/Kick-off.md', title: 'Kick-off', mtime: 9, tags: ['harbour'], props: {}, content: '- [ ] Send the quote to [[Sam Okafor]] 📅 2026-10-21 #work\n- [ ] Order signage 📅 2026-10-25\n' },
  { path: 'People/Sam Okafor.md', title: 'Sam Okafor', mtime: 1, tags: [], props: { type: 'person' }, content: '## About\n' },
  { path: 'Inbox.md', title: 'Inbox', mtime: 3, tags: [], props: {}, content: '- [ ] Ring [[Priya]] #work/clients 📅 2026-11-02\n- [ ] Someday maybe\n- [x] Old thing 📅 2026-10-01\n' },
  { path: 'Priya.md', title: 'Priya', mtime: 1, tags: [], props: {}, content: 'Not a People note.' },
];
const OPTS = {
  resolve: (target) => NOTES.find((n) => n.title.toLowerCase() === target.toLowerCase())?.path ?? null,
  projectOf: (p) => (p.startsWith('Projects/Harbour/') ? 'Projects/Harbour/Harbour.md' : null),
  projectName: (p) => (p === 'Projects/Harbour/Harbour.md' ? 'Harbour' : null),
  isPerson: (p) => T.isPersonNote(p, NOTES.find((n) => n.path === p)?.props),
  ref: REF,
};

test('gathered across the notes: each task with its project, the People it names and its tags', () => {
  const all = T.gatherTasks(NOTES, OPTS);
  assert.equal(all.length, 7);
  const quote = all.find((t) => t.words.startsWith('Send the quote'));
  assert.equal(quote.project, 'Projects/Harbour/Harbour.md');
  assert.equal(quote.projectName, 'Harbour');
  assert.deepEqual(quote.people, ['People/Sam Okafor.md']);
  assert.deepEqual(quote.allTags.sort(), ['harbour', 'work']);
  const crane = all.find((t) => t.words === 'Book the crane');
  assert.equal(crane.project, 'Projects/Harbour/Harbour.md', 'a project’s own next steps belong to it');
  const ring = all.find((t) => t.words.startsWith('Ring'));
  assert.deepEqual(ring.people, [], 'a link to a note that is not a person’s names nobody');
  assert.equal(ring.project, null);
});

test('filters: open or done, today, overdue, this week, no date, project, person, tag; sorted by due day', () => {
  const all = T.gatherTasks(NOTES, OPTS);
  const words = (f) => T.filterTasks(all, { ...T.DEFAULT_FILTER, ...f }, TODAY).map((t) => t.words.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(words({}), ['Book the', 'Send the', 'Order signage', 'Ring [[Priya]]', 'Someday maybe'], 'open, soonest first, no date last');
  assert.deepEqual(words({ status: 'done' }), ['Old thing', 'Sign the']);
  assert.equal(words({ status: 'all' }).length, 7);
  assert.deepEqual(words({ when: 'today' }), ['Send the']);
  assert.deepEqual(words({ when: 'overdue' }), ['Book the']);
  assert.deepEqual(words({ when: 'week' }), ['Book the', 'Send the', 'Order signage'], 'Monday 19 to Sunday 25 October');
  assert.deepEqual(words({ when: 'none' }), ['Someday maybe']);
  assert.deepEqual(words({ status: 'all', when: 'overdue' }), ['Book the'], 'a done task is never overdue');
  assert.deepEqual(words({ project: 'Projects/Harbour/Harbour.md' }), ['Book the', 'Send the', 'Order signage']);
  assert.deepEqual(words({ project: '' }), ['Ring [[Priya]]', 'Someday maybe'], 'in no project');
  assert.deepEqual(words({ person: 'People/Sam Okafor.md' }), ['Send the']);
  assert.deepEqual(words({ tag: 'work' }), ['Send the', 'Ring [[Priya]]'], 'a tag keeps the tags below it');
  assert.deepEqual(words({ tag: '#harbour' }), ['Send the', 'Order signage'], 'a note’s tags count for its tasks');
  assert.deepEqual(words({ text: 'signage' }), ['Order signage']);
  assert.deepEqual(words({ sort: 'changed' }).slice(0, 2), ['Send the', 'Order signage'], 'notes changed lately first');
});

test('facets: what the filters offer, with counts', () => {
  const all = T.gatherTasks(NOTES, OPTS);
  const f = T.taskFacets(all, TODAY, (p) => p.split('/').pop().replace(/\.md$/, ''));
  assert.deepEqual(f.counts, { open: 5, done: 2, overdue: 1, today: 1, week: 3, none: 1, stale: 0 }, 'stale: 0 — the one old group, counted apart (5 Nov 2026, u3 moving-in)');
  assert.deepEqual(f.projects, [{ path: 'Projects/Harbour/Harbour.md', name: 'Harbour', count: 3 }]);
  assert.equal(f.noProject, 2);
  assert.deepEqual(f.people, [{ path: 'People/Sam Okafor.md', name: 'Sam Okafor', count: 1 }]);
  assert.deepEqual(f.tags.map((t) => t.tag), ['harbour', 'work', 'work/clients']);
  assert.equal(T.dueGroup({ done: false, due: '2026-10-20' }, TODAY), 'overdue');
  // 9.5 fourth pass: 27 Oct is next Monday, outside the Monday-to-Sunday week the filter keeps (the old 'week' here
  // encoded the rolling/grouping drift: a task the week filter drops must not sit under a week heading).
  assert.equal(T.dueGroup({ done: false, due: '2026-10-27' }, TODAY), 'later');
  assert.equal(T.dueGroup({ done: false, due: '2026-10-28' }, TODAY), 'later');
});

test('the due day written back the one plain way; other ways taken out; a block id stays last', () => {
  assert.equal(T.setTaskDue('- [ ] Ring the mill', '2026-10-24'), '- [ ] Ring the mill 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Ring the mill', '2026-10-24', '15:00'), '- [ ] Ring the mill 📅 2026-10-24 15:00');
  assert.equal(T.setTaskDue('- [ ] Ring the mill due:: 2026-10-01 #work', '2026-10-24'), '- [ ] Ring the mill #work 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Ring the mill — by 23 Oct 2026', '2026-10-24'), '- [ ] Ring the mill 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Book the crane by Thursday the 19th of November 2026', '2026-11-19'), '- [ ] Book the crane 📅 2026-11-19', 'the whole plain-words tail goes when its day is set (HOLD 5)');
  assert.equal(T.setTaskDue('- [ ] Ring the mill 📅 2026-10-24 15:00', null), '- [ ] Ring the mill');
  assert.equal(T.setTaskDue('  - [x] Nested ^abc123', '2026-10-24'), '  - [x] Nested 📅 2026-10-24 ^abc123');
  assert.equal(T.setTaskDue('- [ ] Bins ⏰ 2026-10-26 18:30', '2026-10-24'), '- [ ] Bins ⏰ 2026-10-26 18:30', 'a reminder keeps its ⏰');
});

test('a task with a day and time becomes a reminder in the reminders’ own format', () => {
  assert.equal(T.taskToReminder('- [ ] Ring the mill 📅 2026-10-24 15:00 #work', REF), '- [ ] Ring the mill #work ⏰ 2026-10-24 15:00');
  assert.equal(T.taskToReminder('- [ ] Ring the mill 📅 2026-10-24', REF), '- [ ] Ring the mill ⏰ 2026-10-24 09:00', 'no time: 9:00 am');
  assert.equal(T.taskToReminder('- [ ] No day', REF), null);
  assert.equal(T.taskToReminder('- [ ] Bins ⏰ 2026-10-26 18:30', REF), null);
});

test('ticked in place: written into the note through its own write; Undo; a repeating reminder moves on', async () => {
  const index = new T.VaultIndex();
  const files = new Map();
  const put = (p, text) => {
    files.set(p, text);
    index.set(p, text, NOW, text.length);
  };
  put('Inbox.md', '# Inbox\r\n\r\n- [ ] Ring Priya 📅 2026-10-22\r\n- [ ] Bins ⏰ 2026-10-21 08:00 every Wednesday\r\n- [-] Dropped\r\n');
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => put(p, t), now: () => NOW });
  const view = service.view();
  assert.equal(view.today, TODAY);
  assert.equal(view.tasks.length, 3);
  const ring = view.tasks.find((t) => t.words === 'Ring Priya');
  // A line added above it since the list was read: the tick still finds it.
  put('Inbox.md', `New line\r\n${files.get('Inbox.md')}`);
  await service.tick(ring.path, ring.line, ring.text, true);
  assert.ok(files.get('Inbox.md').includes('- [x] Ring Priya 📅 2026-10-22\r\n'), 'Windows line ends kept');
  await service.tick(ring.path, ring.line, ring.text, false);
  assert.ok(files.get('Inbox.md').includes('- [ ] Ring Priya'));
  const bins = service.view().tasks.find((t) => t.words === 'Bins');
  const said = await service.tick(bins.path, bins.line, bins.text, true);
  assert.match(said.words, /comes back/);
  assert.ok(files.get('Inbox.md').includes('- [ ] Bins ⏰ 2026-10-28 08:00 every Wednesday'), 'a repeating reminder moves on, unticked');
  const dropped = service.view().tasks.find((t) => t.words === 'Dropped');
  await service.tick(dropped.path, dropped.line, dropped.text, false);
  assert.ok(files.get('Inbox.md').includes('- [ ] Dropped'), 'a cancelled task can be opened again');
  await service.setDue(ring.path, ring.line, ring.text.replace('📅 2026-10-22', '📅 2026-10-22'), '2026-10-30', '11:00');
  assert.ok(files.get('Inbox.md').includes('- [ ] Ring Priya 📅 2026-10-30 11:00'));
  const moved = service.view().tasks.find((t) => t.words === 'Ring Priya');
  assert.equal(moved.time, '11:00');
  assert.match(await service.remind(moved.path, moved.line, moved.text), /11:00/);
  assert.ok(files.get('Inbox.md').includes('- [ ] Ring Priya ⏰ 2026-10-30 11:00'));
  await assert.rejects(service.tick('Inbox.md', 0, 'Not there any more', true), /isn’t in its note/);
  // Templates are never the person's work.
  put('Templates/Meeting.md', '- [ ] Template task');
  assert.ok(!service.view().tasks.some((t) => t.path.startsWith('Templates/')));
});

test('two identical lines get distinct keys, so ticking one never flips the other (9.5 fourth pass)', () => {
  const notes = [{ path: 'Notes/Jobs.md', title: 'Jobs', mtime: 1, tags: [], props: {}, content: '- [ ] Call Sam\n- [ ] Call Sam\n' }];
  const all = T.gatherTasks(notes, { resolve: () => null, projectOf: () => null, projectName: () => null, isPerson: () => false, ref: REF });
  assert.equal(all.length, 2);
  assert.equal(all[0].key, 'Notes/Jobs.md\nCall Sam', 'the first keeps the plain key');
  assert.notEqual(all[0].key, all[1].key);
});

test('the week heading is the same Monday-to-Sunday week the filter keeps (9.5 fourth pass)', () => {
  assert.equal(T.dueGroup({ done: false, due: '2026-10-25' }, TODAY), 'week', 'Sunday still this week');
  assert.equal(T.dueGroup({ done: false, due: '2026-10-26' }, TODAY), 'later', 'next Monday is not this week, as the filter says');
});

test('an in-progress or questioning box stays open; only ticked or cancelled is done (9.5 fourth pass)', () => {
  assert.equal(T.parseTaskLine('- [/] Halfway there', REF).done, false);
  assert.equal(T.parseTaskLine('- [?] Not sure yet', REF).done, false);
  assert.equal(T.parseTaskLine('- [x] Done', REF).done, true);
  assert.equal(T.parseTaskLine('- [-] Cancelled', REF).done, true);
});

test('setting the day takes out every way a day is read, so none comes back (9.5 fourth pass)', () => {
  assert.equal(T.setTaskDue('- [ ] Call Sam — by 2026-10-01', '2026-10-24'), '- [ ] Call Sam 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Call Sam, by 23 Oct 2026', '2026-10-24'), '- [ ] Call Sam 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Call Sam (due 23 Oct 2026)', '2026-10-24'), '- [ ] Call Sam 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Call Sam [[2026-10-01]]', '2026-10-24'), '- [ ] Call Sam 📅 2026-10-24');
  assert.equal(T.setTaskDue('- [ ] Call Sam — by Oct 1', '2026-10-24'), '- [ ] Call Sam 📅 2026-10-24');
});

test('a plain by-day tail goes when a canonical date is set, so the day is said once (p22)', () => {
  assert.equal(T.setTaskDue('- [ ] Call Sam — Priya · by fri', '2026-10-30'), '- [ ] Call Sam — Priya 📅 2026-10-30');
  assert.equal(T.setTaskDue('- [ ] Call Sam — by fri', '2026-10-30'), '- [ ] Call Sam 📅 2026-10-30');
  assert.equal(T.setTaskDue('- [ ] Write the Friday report', '2026-10-30'), '- [ ] Write the Friday report 📅 2026-10-30', 'a day inside the words stays');
  assert.equal(T.setTaskDue('- [ ] Chase carts that failed on Friday — Alex Chen', '2026-11-05'), '- [ ] Chase carts that failed on Friday — Alex Chen 📅 2026-11-05', 'on Friday in the words stays');
});

test('making a reminder of a reminder says it already is one (9.5 fourth pass)', async () => {
  const index = new T.VaultIndex();
  index.set('Inbox.md', '- [ ] Bins ⏰ 2026-10-26 18:30\n', NOW, 30);
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async () => {}, now: () => NOW });
  const bins = service.view().tasks[0];
  await assert.rejects(service.remind(bins.path, bins.line, bins.text), /already a reminder/);
});

test('a bad day is refused and the line is left alone (9.5 fourth pass)', async () => {
  assert.equal(T.setTaskDue('- [ ] Ring 📅 2026-10-01', '2026-13-45'), '- [ ] Ring 📅 2026-10-01', 'shared: strip nothing, add nothing');
  const index = new T.VaultIndex();
  const files = new Map([['Inbox.md', '- [ ] Ring 📅 2026-10-01\n']]);
  index.set('Inbox.md', files.get('Inbox.md'), NOW, 30);
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => { files.set(p, t); index.set(p, t, NOW, t.length); }, now: () => NOW });
  const ring = service.view().tasks[0];
  await assert.rejects(service.setDue(ring.path, ring.line, ring.text, '2026-13-45', null), /real day/);
  assert.equal(files.get('Inbox.md'), '- [ ] Ring 📅 2026-10-01\n');
});

test('ticking with a bad line number asks which task, never the nearest (9.5 fourth pass)', async () => {
  const index = new T.VaultIndex();
  const text = '- [ ] First\n- [ ] Second\n';
  index.set('Inbox.md', text, NOW, text.length);
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async () => {}, now: () => NOW });
  await assert.rejects(service.tick('Inbox.md', 'x', 'Second', true), /Which task/);
});

test('a task edited where shown keeps its day, and an empty change is refused (p10 round 2)', async () => {
  const index = new T.VaultIndex();
  let text = '- [ ] Cost the PA hire 📅 2026-11-10\n- [ ] Ask Priya — Priya Nair\n';
  index.set('Notes/Fete.md', text, NOW, text.length);
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => { text = t; index.set(p, t, NOW, t.length); }, now: () => NOW });
  const [cost, ask] = service.view().tasks;
  const r = await service.edit(cost.path, cost.line, cost.text, 'Price the PA hire');
  assert.equal(text.split('\n')[0], '- [ ] Price the PA hire 📅 2026-11-10');
  assert.ok(r.line.includes('Price the PA hire'), 'the new line comes back for Undo');
  await service.edit(ask.path, ask.line, ask.text, 'Ask Priya about slices — Alex Chen');
  assert.equal(text.split('\n')[1], '- [ ] Ask Priya about slices — Alex Chen');
  const back = service.view().tasks;
  assert.equal(back[0].due, '2026-11-10');
  assert.equal(back[0].words, 'Price the PA hire');
  await assert.rejects(service.edit(cost.path, 0, 'Price the PA hire 📅 2026-11-10', '   '), /some words/);
  await assert.rejects(service.edit(cost.path, 0, 'no such task here', 'Words'), /isn’t in its note/);
});

test('an in-progress task ticks done for real (9.5 fourth pass)', async () => {
  const index = new T.VaultIndex();
  let text = '- [ ] Halfway there\n- [/] Nearly done\n';
  index.set('Inbox.md', text, NOW, text.length);
  const service = new T.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => { text = t; index.set(p, t, NOW, t.length); }, now: () => NOW });
  const tasks = service.view().tasks;
  assert.equal(tasks.length, 2, 'in-progress is gathered as open');
  const half = tasks.find((t) => t.words === 'Nearly done');
  assert.equal(half.done, false, 'in-progress reads as open');
  await service.tick(half.path, half.line, half.text, true);
  assert.ok(text.includes('- [x] Nearly done'), 'ticking writes [x], never a silent no-op');
});

test('the Done toast says the task’s words only (p14-words)', () => {
  assert.equal(T.doneWords('Reply to Lisa Tran on the cool room clause'), 'Reply to Lisa Tran on the cool room clause');
  assert.equal(T.doneWords('Reply to Lisa Tran on the cool room clause – Alex Rivera wants it Friday'), 'Reply to Lisa Tran on the cool room clause');
  assert.equal(T.doneWords('Send the quote — Sam Okafor · by Friday'), 'Send the quote');
  assert.equal(T.doneWords('Water the plants — by Friday'), 'Water the plants — by Friday');
  assert.equal(T.doneWords('Send the quote to [[People/Sam Okafor|Sam]]'), 'Send the quote to Sam');
  assert.equal(T.doneWords('Price the **PA hire** [quote](https://x.test/q)'), 'Price the PA hire quote');
});

test('every Done door toasts the words, never `Done: …` (p14-words)', () => {
  for (const [file, want] of [
    ['src/renderer/src/views/today/DueCard.tsx', 'toast(doneWords(t.words)'],
    ['src/renderer/src/views/TasksView.tsx', 'toast(done ? doneWords(t.words)'],
  ]) {
    const src = readFileSync(path.join(root, file), 'utf8');
    assert.ok(src.includes(want), `${file} says the toast through doneWords`);
    assert.doesNotMatch(src, /toast\(`Done: /, `${file} keeps no Done: toast`);
  }
  const space = readFileSync(path.join(root, 'src/renderer/src/views/SharedSpacePage.tsx'), 'utf8');
  assert.doesNotMatch(space, /toast\(`Done: /, 'SharedSpacePage keeps no Done: toast');
  // The untick (Not done) and repeating-task toasts quote the same words (p16 loose ends): the task only.
  const tasks = readFileSync(path.join(root, 'src/renderer/src/views/TasksView.tsx'), 'utf8');
  assert.ok(tasks.includes('`“${doneWords(t.words)}”`'), 'the quoted task goes through doneWords too');
  assert.doesNotMatch(tasks, /short\(plainWords\(t\.words\)\)/, 'no raw-words quote left beside the Done toast');
});
