// node --test tests/tasks-bulk.test.mjs — Vault living with 120 tasks (5 Nov 2026, audit items 2 to 4, 7 to 10):
// bulk select in the Tasks list (Tick all plus a day/owner/done toolbar through the same single-task writes),
// Tasks owning the list while Today owns the day (no second Today layout; its timed split and add row live in Today's rest fold), one view per task
// list with no Board switch (t249, the plan decision 2), the Inbox button saying what it does, and
// remembered filters. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tasks-bulk-'));
let P;
let C;
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/projects-87.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  const entryF = path.join(work, 'entry-f.ts');
  writeFileSync(entryF, `export * from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entryF, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  const entryC = path.join(work, 'entry-c.ts');
  writeFileSync(entryC, `export * from ${JSON.stringify(path.join(root, 'src/shared/capture.ts'))};\n`);
  await build({ input: entryC, platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('one view per task list: no board columns, drops, adds or remembered views (t249, plan decision 2)', () => {
  for (const gone of ['taskBoardColumn', 'projectStepColumn', 'TASK_BOARD_COLUMNS', 'boardAddScope', 'readTasksView', 'writeTasksView', 'readProjectTasksView', 'writeProjectTasksView']) {
    assert.equal(P[gone], undefined, `no shared ${gone}`);
  }
  for (const f of ['src/renderer/src/views/TasksView.tsx', 'src/renderer/src/views/project/ProjectTabs87.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('BoardCard') && !src.includes('boardCols') && !src.includes('dropTask') && !src.includes('addCard('), `${f}: no board rows, columns, drops or adds`);
    assert.ok(!src.includes('readTasksView') && !src.includes('writeTasksView') && !src.includes('readProjectTasksView'), `${f}: no view to remember`);
  }
  assert.ok(!read('src/renderer/src/views/TasksView.tsx').includes('const LAYOUTS'), 'Tasks keeps no view switch');
});

test('the Tasks list ticks many at once, through the same writes as one', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('Tick all') && tasks.includes('Untick all'), 'Tick all ticks the shown tasks');
  assert.ok(tasks.includes('ticked'), 'the toolbar counts the ticked tasks');
  assert.ok(tasks.includes('toggleSelected'), 'ticking one reuses the shared tick (as the Inbox does)');
  // The bulk toolbar: a day, an owner and done for the ticked tasks (audit item 2).
  assert.ok(/Day…/.test(tasks) && /Who…/.test(tasks), 'the toolbar sets the day and the owner');
  // The same write path per task: the UI loops, like the Inbox does (TasksService stays single-task).
  assert.ok(tasks.includes('tasks.tick(t.path, t.line, t.text, true)'), 'bulk done ticks each task where it lives');
  assert.ok(tasks.includes('Undo'), 'a bulk change takes back, as a single one does');
  assert.ok(tasks.includes('freshByLine'), 'an Undo re-reads the rows it changed (old words find nothing after a write)');
});

test('Tasks owns the list: one view, its day parts live in Today', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!tasks.includes('const LAYOUTS'), 'no view switch at all (t249, plan decision 2)');
  assert.ok(!tasks.includes('Add a task for today…'), 'no day-plan add row left in Tasks');
  assert.ok(tasks.includes('Plan my day in the chat'), 'planning the day stays in the Tasks menu');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('Add a task for today'), "the day's add row lives in Today's rest fold now");
  assert.ok(today.includes('splitDayPlan'), "the timed split lives in Today's rest fold now, on the shared split");
});

test('the Inbox button says what it does on a card that is already a task', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('Move to a project'), 'a tick-box line moves to a project');
  assert.ok(inbox.includes('Make it a task'), 'a plain capture line still becomes a task first');
});

test('the Tasks project, person, tag and text filters are remembered like the rest', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  const memory = tasks.slice(tasks.indexOf('function useTasksMemory'), tasks.indexOf('function Select'));
  assert.ok(memory.includes('m.project') && memory.includes('m.person') && memory.includes('m.tag') && memory.includes('m.text'), 'all four are read back');
  const kept = memory.slice(memory.indexOf('localStorage.setItem'));
  assert.ok(kept.includes('project: f.project') && kept.includes('person: f.person') && kept.includes('tag: f.tag') && kept.includes('text: f.text'), 'all four are kept with status, when and sort');
});

test('a step keeps its owner and day however the day was written: a by/due tail or the Tasks mark', () => {
  const file = (steps) => `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# P\n\n## What's next\n\n${steps}\n`;
  const byDue = F.parseProject(file('- [ ] Paint the fence — Mia Tran — due 6 Nov 2026\n- [ ] Oil the hinges 📅 2026-11-07\n- [ ] Sweep up — Tom Nguyen 📅 2026-11-08'), 'P.md');
  const [a, b, c] = byDue.next;
  assert.equal(a.who, 'Mia Tran');
  assert.equal(a.when, '6 Nov 2026');
  assert.equal(b.who, undefined);
  assert.equal(b.when, '2026-11-07');
  assert.ok(!b.what.includes('📅'), 'the mark is the day, never the words');
  assert.equal(c.who, 'Tom Nguyen');
  assert.equal(c.when, '2026-11-08');
  assert.equal(c.tail?.text, 'Tom Nguyen 📅 2026-11-08', 'an untouched line keeps its tail as written');
});

test('Quick add still hears days and suggests a project: the fastest add from anywhere', () => {
  const wed = new Date(2026, 10, 4);
  const due = C.parseDue('Buy cable ties by Friday', wed);
  assert.ok(due && due.iso === '2026-11-06', `heard Friday as ${due?.iso}`);
  assert.equal(C.parseDue('Buy cable ties', wed), null);
  const projects = [
    { path: 'Projects/Shop Awning.md', name: 'Shop Awning', folderName: 'Shop Awning', people: [], tags: [], modified: Date.now() },
    { path: 'Projects/Wexley St Refit.md', name: 'Wexley St Refit', folderName: 'Wexley St Refit', people: [], tags: [], modified: Date.now() },
  ];
  const out = C.suggestProjects({ text: 'Buy cable ties for the shop awning', projects });
  assert.ok(out.length > 0 && out[0].path === 'Projects/Shop Awning.md', JSON.stringify(out));
  for (const f of ['src/renderer/src/views/TasksView.tsx', 'src/renderer/src/views/InboxPage.tsx', 'src/renderer/src/views/project/ProjectTabs87.tsx']) {
    assert.ok(read(f).includes('capture.show') || read(f).includes('Add a task') || read(f).includes('AddStep') || read(f).includes('addStep'), `${f} keeps its fastest door`);
  }
});
