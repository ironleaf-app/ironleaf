// node --test tests/morning-five.test.mjs — the morning brief's top five (p12-morning-five, 4 Nov 2026):
// src/shared/brief-tasks.ts gives the former host app's morning brief the same five as Today's "Next for you"
// (topFiveFor, called, never copied): project steps and the person's own dated notes through the one rank. Round 2:
// a note's line ranks and ticks too. Made-up projects; every date relative to a fixed today (Wednesday 4 November
// 2026).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-morning-five-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/brief-tasks.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\nexport { groupDue, findTasks, taskDue, taskKey } from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};\nexport { findReminders, reminderKey, repeatText } from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};\nexport { titleFromPath } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 10, 4, 7, 5); // Wednesday 4 November 2026, 7:05 am (the brief's hour)
const file = (head, next, extra = '') => `---\ntype: project\n${head}\n---\n# Shop\n\n## What’s next\n\n${next}\n${extra}`;
const step = (what, tail = '') => `- [ ] ${what}${tail ? ` — ${tail}` : ''}`;
// One item's words as a person reads them: a step's what, a note task's words, a reminder's text.
const wordsOf = (w) => (w.kind === 'step' ? w.step.what : w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text);
const idOf = (w) => (w.kind === 'step' ? w.step.id : `note:${w.entry.key}`);

// A harbour cafe (at risk, owned by Mia Tran) and a bookshop (on track), with dated and undated own steps,
// someone else's step, a done step, key dates and a project due date; plus a finished project.
const CAFE = file(
  'status: active\nhealth: at risk\nowner: Mia Tran\ndue: "2026-11-20"',
  [
    step('Pay the power bill', 'Mia · by 2 Nov 2026'),
    step('Order more flour', 'Mia · by 4 Nov 2026'),
    step('Fix the till roll', 'Mia · by 10 Nov 2026'),
    step('Repaint the sign', 'Claude'),
    step('Count the till', 'Mia'),
    '- [x] Mop the floor — Mia · by 1 Nov 2026',
  ].join('\n'),
  '## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 4 Nov 2026 | Health inspection | planned |\n',
);
const BOOKS = file(
  'status: active\nhealth: on track\nowner: Mia Tran',
  [step('Phone the supplier', 'Mia · by 6 Nov 2026'), step('Shelve the new stock', 'Mia · by 20 Dec 2026')].join('\n'),
);
const OLD = file('status: done\nowner: Mia Tran', step('Never finished', 'Mia · by 1 Oct 2026'));
const files = () => [
  { path: 'Projects/Cafe/Cafe.md', text: CAFE, modified: new Date(2026, 10, 1).getTime() },
  { path: 'Projects/Books/Books.md', text: BOOKS, modified: new Date(2026, 10, 2).getTime() },
  { path: 'Projects/Old/Old.md', text: OLD, modified: new Date(2026, 9, 1).getTime() },
];
// The oracle: Today's own lists over the same projects.
const oracleDue = () => {
  const parsed = files().map((f, i) => ({ path: f.path, version: `v${i}`, modified: f.modified, project: T.parseProject(f.text, f.path) }));
  return T.buildToday({ projects: parsed, notes: [], me: 'Mia Tran' }, TODAY).due;
};

test('the first of the five is Today’s hero, and the order is the ranking’s, never copied', () => {
  const due = oracleDue();
  const five = T.topFiveFromProjectTexts(files(), TODAY, 'Mia Tran');
  assert.equal(five[0].kind, 'step', 'projects alone rank steps');
  assert.equal(five[0].step.id, T.pickNextForYou(due).id, 'first is Next for you');
  const ranked = T.rankNextForYou([...due.overdue, ...due.today, ...due.soon, ...due.later]).map((x) => x.id);
  assert.deepEqual(five.map(idOf), ranked.slice(0, 5), 'the ranking’s order, first five');
});

test('only own dated steps qualify: never someone else’s, undated, done, finished, key dates or project dues', () => {
  const whats = T.topFiveFromProjectTexts(files(), TODAY, 'Mia Tran').map(wordsOf);
  for (const there of ['Pay the power bill', 'Order more flour', 'Fix the till roll', 'Phone the supplier']) assert.ok(whats.includes(there), there);
  for (const gone of ['Repaint the sign', 'Count the till', 'Mop the floor', 'Never finished', 'Health inspection', 'Shop is due']) assert.ok(!whats.includes(gone), `never ${gone}`);
});

test('five at most, however many dated steps there are', () => {
  const many = Array.from({ length: 8 }, (_, i) => step(`Dated job ${i + 1}`, `Mia · by ${5 + i} Nov 2026`)).join('\n');
  const five = T.topFiveFromProjectTexts([{ path: 'Projects/Many/Many.md', text: file('status: active\nowner: Mia Tran', many), modified: 0 }], TODAY, 'Mia Tran');
  assert.equal(five.length, 5);
});

test('no projects, no files, or files that are not projects: nothing, never a crash', () => {
  assert.deepEqual(T.topFiveFromProjectTexts([], TODAY, 'Mia Tran'), []);
  assert.deepEqual(T.topFiveFromProjectTexts([{ path: 'Notes/Random.md', text: '# Shopping\n\n- milk\n', modified: 0 }], TODAY, 'Mia Tran'), []);
  assert.deepEqual(T.topFiveFromProjectTexts(null, TODAY), []);
});

test('without a name the majority owner still owns their steps, as Today falls back', () => {
  const five = T.topFiveFromProjectTexts(files(), TODAY);
  assert.ok(five.some((x) => wordsOf(x) === 'Pay the power bill'), 'Mia’s dated step ranks without her name given');
  assert.ok(!five.some((x) => wordsOf(x) === 'Repaint the sign'), 'Claude’s step still waits on him');
});

test('Done ticks the step shown and says so, keeping the file’s every other line', () => {
  const five = T.topFiveFromProjectTexts(files(), TODAY, 'Mia Tran');
  const first = five[0].step;
  const source = files().find((f) => f.path === first.project).text;
  const { text, said } = T.tickProjectStep(source, first.index, first.what, TODAY);
  const again = T.parseProject(text, first.project);
  assert.equal(again.next[first.index].done, true, 'the step shown is ticked');
  assert.equal(again.next.filter((n) => n.done).length, 2, 'only it and the already-done one');
  assert.ok(said.includes(first.what.slice(0, 24)), `said in words: ${said}`);
  assert.ok(text.includes('## Key dates') && text.includes('Health inspection'), 'the rest of the file stands');
  assert.deepEqual(T.topFiveFromProjectTexts(files().map((f) => (f.path === first.project ? { ...f, text } : f)), TODAY, 'Mia Tran').map(idOf).includes(five.map(idOf)[0]), false, 'ticked, it leaves the five');
});

test('Done is refused when the step is not as shown: already done, moved, reworded, or no such step', () => {
  const five = T.topFiveFromProjectTexts(files(), TODAY, 'Mia Tran');
  const first = five[0].step;
  const source = files().find((f) => f.path === first.project).text;
  assert.throws(() => T.tickProjectStep(source, 99, first.what, TODAY), /no longer open/, 'no such step');
  assert.throws(() => T.tickProjectStep(source, first.index, 'Different words', TODAY), /no longer open/, 'reworded since');
  const moved = source.replace('- [ ] Pay the power bill', '- [ ] Pay the power bill now');
  assert.throws(() => T.tickProjectStep(moved, first.index, first.what, TODAY), /no longer open/, 'moved text refuses at the old index');
  const done = T.tickProjectStep(source, first.index, first.what, TODAY).text;
  assert.throws(() => T.tickProjectStep(done, first.index, first.what, TODAY), /already done/, 'twice is said plainly');
  assert.throws(() => T.tickProjectStep('# Shopping\n\n- milk\n', 0, 'milk', TODAY), /no longer open/, 'not a project file');
});

test('round 2: a note 49 days late and a step 3 days late — Today’s five equal the brief’s five, in order (5 Nov 2026, u3 moving-in: stale last)', () => {
  const projText = file('status: active\nhealth: on track\nowner: Mia Tran', step('Own job 3', 'Mia · by 1 Nov 2026'));
  const noteText = '# Tasks\n\n- [ ] Old council letter due 2026-09-16\n- [ ] Keep this open\n';
  const projPath = 'Projects/One/One.md';
  const notePath = 'Tasks.md';
  // Today as TodayView reads it: own project steps plus own dated note lines through topFiveFor.
  const parsed = [{ path: projPath, version: 'v', modified: 0, project: T.parseProject(projText, projPath) }];
  const day = T.buildToday({ projects: parsed, notes: [], me: 'Mia Tran' }, TODAY);
  const steps = [...day.due.overdue, ...day.due.today, ...day.due.soon, ...day.due.later, ...day.due.stale].filter((x) => x.kind === 'step');
  const found = T.findTasks(noteText, TODAY);
  const title = T.titleFromPath(notePath);
  const tasks = found.map((t, i) => {
    const words = T.taskDue(t.text, TODAY).words || t.text;
    return { key: T.taskKey(notePath, t.text, i > 0 && found[0].text === t.text ? 1 : 0), path: notePath, title, line: t.line, text: t.text, words, due: t.due };
  });
  const groups = T.groupDue(tasks, [], TODAY.getTime());
  const own = [...groups.overdue, ...groups.today, ...groups.week, ...groups.later, ...groups.stale].filter((e) =>
    T.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, 'Mia Tran', TODAY),
  );
  const todayFive = T.topFiveFor(steps, own, TODAY, 5);
  const briefFive = T.topFiveFromProjectTexts(
    [
      { path: projPath, text: projText, modified: 0 },
      { path: notePath, text: noteText, modified: 0 },
    ],
    TODAY,
    'Mia Tran',
  );
  const shape = (w) => (w.kind === 'step' ? ['step', w.step.what, w.step.offset, w.step.project] : ['note', wordsOf(w), w.offset, w.entry.item.path]);
  assert.deepEqual(briefFive.map(shape), todayFive.map(shape), 'the same five in the same order');
  assert.deepEqual(briefFive.map(wordsOf), ['Own job 3', 'Old council letter'], 'fresh work first; the stale note ranks last, never leading');
  assert.equal(briefFive[0].kind, 'step', 'the fresh step leads');
  assert.equal(briefFive[1].offset, -49, '49 days late — still in the list, ranked last');
});

test('round 2: a task’s words read as written, plain', () => {
  const noteText = '# Tasks\n\n- [ ] Old council letter due 2026-09-16\n';
  const five = T.topFiveFromProjectTexts([{ path: 'Tasks.md', text: noteText, modified: 0 }], TODAY, 'Mia Tran');
  assert.equal(five.length, 1, 'the dated line ranks');
  assert.equal(wordsOf(five[0]), 'Old council letter', 'the day taken out, the words as written');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(wordsOf(five[0])), 'never a raw stamp in the words');
});

test('round 2: Done ticks a note’s line in its note, refusing when the words changed', () => {
  const noteText = '# Tasks\n\n- [ ] Old council letter due 2026-09-16\n- [ ] Keep this open\n';
  const { text, said } = T.tickNoteTask(noteText, 2, 'Old council letter due 2026-09-16', TODAY);
  assert.ok(text.split('\n').some((l) => l.startsWith('- [x] Old council letter')), 'the line shown is ticked');
  assert.ok(text.split('\n').some((l) => l.startsWith('- [ ] Keep this open')), 'the other line stays open');
  assert.ok(said.includes('Old council letter'), `said in words: ${said}`);
  assert.throws(() => T.tickNoteTask(noteText, 2, 'Different words', TODAY), /no longer open/, 'reworded since is refused');
  assert.throws(() => T.tickNoteTask(noteText, 9, 'Old council letter due 2026-09-16', TODAY), /no longer open/, 'no such line is refused');
  assert.throws(() => T.tickNoteTask(text, 2, 'Old council letter due 2026-09-16', TODAY), /already done/, 'twice is said plainly');
});

test('round 2: Done ticks a reminder — a one-off is done, a repeating one moves on', () => {
  const once = '# Reminders\n\n- [ ] Call the supplier ⏰ 2026-11-04 09:00\n';
  const ticked = T.tickNoteReminder(once, 2, 'Call the supplier', new Date(2026, 10, 4, 9, 0).getTime(), TODAY);
  assert.ok(ticked.text.split('\n').some((l) => l.startsWith('- [x] Call the supplier')), 'the one-off ticks');
  assert.ok(ticked.said.includes('Call the supplier'), `said in words: ${ticked.said}`);
  const weekly = '# Reminders\n\n- [ ] Bins out ⏰ 2026-11-04 09:00 every week\n';
  const moved = T.tickNoteReminder(weekly, 2, 'Bins out', new Date(2026, 10, 4, 9, 0).getTime(), TODAY);
  assert.ok(moved.text.includes('2026-11-11'), 'the repeating one moves to next week');
  assert.ok(moved.text.split('\n').some((l) => l.startsWith('- [ ] Bins out')), 'and stays open');
  assert.throws(() => T.tickNoteReminder(once, 2, 'Other words', new Date(2026, 10, 4, 9, 0).getTime(), TODAY), /no longer open/, 'reworded since is refused');
});
