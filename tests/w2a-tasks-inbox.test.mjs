// node --test tests/w2a-tasks-inbox.test.mjs — the Vault redesign's tasks and inbox (8.7 wave 2a): tasks as one
// list view on the app's real due logic (t249, the plan decision 2: one view, done well, no Board switch), and
// the inbox where each capture is filed, kept or deleted in one step. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-w2a-ti-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/projects-87.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w2a.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'w2a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the tasks board is gone from the shared rules; the projects board stays (t249, plan decision 2)', () => {
  for (const gone of ['taskBoardColumn', 'projectStepColumn', 'TASK_BOARD_COLUMNS', 'boardAddScope', 'TaskBoardColumn', 'BoardAddScope', 'readTasksView', 'writeTasksView', 'readProjectTasksView', 'writeProjectTasksView', 'TasksView', 'ProjectTasksView']) {
    assert.equal(P[gone], undefined, `no shared ${gone}`);
  }
  assert.equal(P.projectBoardColumn({ status: 'active', health: 'at risk' }), 'at-risk', 'Projects home keeps its board rule');
  assert.deepEqual(P.projectBoardDrop('done', { status: 'active' }), [{ field: 'status', value: 'done' }]);
});

test('the due tag reads late, today and the week', () => {
  // 5 Nov 2026, the plan: the one reader — Yesterday for late by one, plain tones
  // (attention/muted, never filled tints), weekday with date from two days out, countdown 8–30.
  assert.deepEqual(P.taskDueTag('2026-10-27', null, '2026-10-30'), { words: '3 days late', tone: 'attention' });
  assert.deepEqual(P.taskDueTag('2026-10-29', null, '2026-10-30'), { words: 'Yesterday', tone: 'attention' });
  assert.deepEqual(P.taskDueTag('2026-10-30', null, '2026-10-30'), { words: 'Today', tone: 'muted' });
  assert.deepEqual(P.taskDueTag('2026-10-30', '15:00', '2026-10-30'), { words: '3:00 pm', tone: 'muted' });
  assert.deepEqual(P.taskDueTag('2026-11-02', null, '2026-10-30'), { words: 'Mon 2 Nov', tone: 'muted' });
  assert.deepEqual(P.taskDueTag('2026-11-12', null, '2026-10-30'), { words: 'Thu 12 Nov · in 13 days', tone: 'muted' });
  assert.equal(P.taskDueTag(null, null, '2026-10-30'), null);
  assert.deepEqual(P.taskDueTag('2026-11-03', null, '2026-10-30', true), { words: 'Tue 3 Nov ⏰', tone: 'muted' });
});

test('the day plan splits timed from any-time, open before done', () => {
  const { timed, anytime } = P.splitDayPlan([
    { done: true, time: '09:00' },
    { done: false, time: '15:00' },
    { done: false, time: null },
    { done: false, time: '09:00' },
  ]);
  assert.deepEqual(
    timed.map((t) => [t.time, t.done]),
    [['09:00', false], ['15:00', false], ['09:00', true]],
  );
  assert.equal(anytime.length, 1);
});

test('the inbox sort keeps capture order inside each half', () => {
  const items = [
    { id: 'a', kind: 'line', path: 'Inbox.md', embeds: [] },
    { id: 'b', kind: 'line', path: 'Inbox.md', embeds: ['x.png'] },
    { id: 'c', kind: 'file', path: 'Inbox/a.pdf', embeds: [] },
  ];
  assert.deepEqual(P.sortInbox(items, 'oldest', () => false).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(P.sortInbox(items, 'newest', () => false).map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(P.sortInbox(items, 'suggested', (id) => id === 'c').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(P.sortInbox(items, 'photos', () => false).map((x) => x.id), ['b', 'c', 'a']);
  assert.ok(P.inboxHasPhoto(items[1]) && P.inboxHasPhoto(items[2]) && !P.inboxHasPhoto(items[0]));
});

test('files and notes answer to their kind filters', () => {
  assert.equal(P.fileKindOf('Bench heights — joiner markup.pdf'), 'plans');
  assert.equal(P.fileKindOf('Stain sample B — photo.jpg'), 'photos');
  assert.equal(P.fileKindOf('Head contract — signed.pdf'), 'contracts');
  assert.equal(P.fileKindOf('Tiler quote — final.pdf'), 'quotes');
  assert.equal(P.fileKindOf('Budget.xlsx'), 'quotes', 'a budget is pricing, here as in the hub');
  assert.equal(P.fileKindOf('Site lease.pdf'), 'contracts');
  assert.equal(P.fileKindOf('notes.txt'), 'other');
  assert.ok(P.fileKindMatches('a.pdf', 'all') && !P.fileKindMatches('a.pdf', 'photos'));
  assert.equal(P.noteKindOf('Notes/x.md', 'daily', ''), 'daily');
  assert.equal(P.noteKindOf('Daily/2026-10-30.md', undefined, 'Daily'), 'daily');
  assert.equal(P.noteKindOf('Docs/x.md', 'doc', ''), 'docs');
  assert.equal(P.noteKindOf('Projects/x.md', 'note', ''), 'site');
});

test('tasks are one list, done well: no Board switch (t249, plan decision 2; 5 Nov 2026: Today owns the day, so the second Today layout retired to Today’s rest fold)', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!tasks.includes('const LAYOUTS'), 'no view switch');
  assert.ok(!tasks.includes('BoardCard') && !tasks.includes('boardCols') && !tasks.includes('dropTask') && !tasks.includes('addCard'), 'no board rows, columns, drops or adds');
  assert.ok(!tasks.includes('readTasksView') && !tasks.includes('writeTasksView'), 'no view to remember');
  assert.ok(tasks.includes('taskInfos'), 'whose and when stay Today’s own reading');
  assert.ok(tasks.includes('tasks.tick'), 'ticking writes the note');
  assert.ok(tasks.includes('tasks.setDue'), 'setting the day writes the note');
  assert.ok(tasks.includes('tasks.remind'), 'reminders stay');
  assert.ok(tasks.includes('capture.show'), 'a new task goes through Quick add');
  assert.ok(tasks.includes('saveWho') && tasks.includes('Who does it'), 'who changes on the row and in its menu, never a board drop');
  assert.ok(tasks.includes('Plan my day in the chat'), 'planning the day stays in the Tasks menu');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('splitDayPlan'), 'the retired timed split lives in Today’s rest fold, on the shared split');
  assert.ok(today.includes('Add a task for today'), 'the retired add row lives in Today’s rest fold');
});

test('the inbox files, keeps and deletes each capture in one step', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('sortInbox'), 'the sort is the shared rule');
  assert.ok(inbox.includes('inbox.remove'), 'a line deletes under Deleted');
  assert.ok(inbox.includes('trashPath'), 'a note or file deletes to Recently deleted');
  assert.ok(inbox.includes('inbox.file'), 'filing stays');
  assert.ok(inbox.includes('inbox.done'), 'keeping as done stays');
  assert.ok(inbox.includes('Make it a task') && inbox.includes('Move to a project'), 'a plain line becomes a task, a tick-box line moves to a project (5 Nov 2026: one bad label fixed)');
  assert.ok(inbox.includes('captureNoProject'), 'where captures with no project go stays');
  const life = read('src/main/life.ts');
  assert.ok(life.includes("'inbox:delete'"), 'the main side deletes a line');
  assert.ok(life.includes("heading: 'Deleted'"), 'deleted lines are kept, recoverable');
});

test('round 2: tasks draws its own top bar, one head, clean rows, calm chips (t249)', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('<ViewHeader tab={tab}'), 'tasks draws the top bar itself');
  assert.ok(tasks.includes('OWN_TABS'), 'Mine/Everyone only');
  assert.ok(tasks.includes('WHEN_CHIPS'), 'Late, This week and Done — the day’s loop and what got finished');
  assert.ok(!tasks.includes('WHEN_GROUPS'), 'no eight-chip row');
  assert.ok(tasks.includes("setWhenGroup('any')"), 'the when chips toggle back to every task');
  assert.ok(tasks.includes("set({ status: 'done' })") && tasks.includes('Only done'), 'Done shows what got finished');
  assert.ok(!tasks.includes('td-row-sub'), 'no second line under a task row');
  assert.ok(!tasks.includes('OwnerChip'), 'no owner chips on a task row');
  assert.equal((tasks.match(/role="checkbox"/g) || []).length, 1, 'the box stays on the list rows (5 Nov 2026: the day rows retired to Today)');
});

test('round 2: the inbox carries Inbox note and Capture in the top bar', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('<ViewHeader tab={tab}>'), 'the inbox draws the top bar itself');
  assert.ok(inbox.includes('Inbox note') && inbox.includes('+ Capture'), 'Inbox note and Capture stay');
  assert.doesNotMatch(inbox, />\s*The note\s*</, 'never The note (H2)');
});
