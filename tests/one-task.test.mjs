// node --test tests/one-task.test.mjs — One task is one row, everywhere (p13-one-task, 4 Nov 2026). A meeting action
// that became a project step showed twice: the project's step and the note's line, in Tasks, Today, the rail, Needs you,
// the five and the brief. Now an open tick line in a note is the same task as an open project step when their words
// match under sameWhat and the note belongs to that project and the owner does not differ (src/shared/one-task.ts, the
// one shared reading): the step is the row, every door reads it, and a tick closes both as one change with one Undo.
// Near-repeats stay two rows. Made-up notes; a fixed today (Wednesday 4 Nov 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-one-task-'));
let O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/one-task.ts'))};\n` +
      `export { buildToday, countDueSteps, rankNextForYou, todayDueCount } from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\n` +
      `export { isOwnText } from ${JSON.stringify(path.join(root, 'src/shared/today-count.ts'))};\n` +
      `export { gatherTasks, filterTasks, taskFacets, DEFAULT_FILTER } from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};\n` +
      `export { groupDue, taskDue, taskKey, isoOf } from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};\n` +
      `export { rankAllFor, topFiveFor, topFiveFromProjectTexts } from ${JSON.stringify(path.join(root, 'src/shared/brief-tasks.ts'))};\n` +
      `export { parseProject, isProjectText, textVersion } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n` +
      `export { dueOwnCount, dueOwnSplit, lateForYouCount, subtitleFigures, taskInfos } from ${JSON.stringify(path.join(root, 'src/renderer/src/components/plan/plan.ts'))};\n` +
      `export { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\n` +
      `export { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};\n` +
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n` +
      `export { ProjectHistory } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};\n` +
      `export { cascadeForLine, cascadeForStep, closedStepOf, openStepsByProject, projectOfNote } from ${JSON.stringify(path.join(root, 'src/main/one-task.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'one-task.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  O = await import(pathToFileURL(path.join(work, 'one-task.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Wednesday 4 November 2026: "by 31 Oct 2026" is 4 days late, as a user saw it.
const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const REF = new Date(NOW);
const TODAY = '2026-11-04';
const ME = 'Alex Rivera';
const WHAT = 'Reply to Shana Tran on the cool room clause';
const STEP_LINE = `- [ ] ${WHAT} – Alex Rivera · by 31 Oct 2026`;

const BRUNSWICK = 'Business/Projects/Brunswick site lease renewal/Brunswick site lease renewal.md';
const MEETING = 'Business/Meetings/2026-10-27 Brunswick lease clause call.md';
const WATTLE = 'Business/Projects/Wattle Street Rooms/Wattle Street Rooms.md';
const LOOSE = 'Notes/Loose ends.md';

const projectFile = (name, owner, steps) =>
  ['---', 'type: project', 'status: active', `owner: ${owner}`, '---', `# ${name}`, '', "## What's next", '', ...steps, ''].join('\n');
const meetingFile = (project, lines) => ['---', `project: ${project}`, '---', '# Brunswick lease clause call', '', '## Actions', '', ...lines, ''].join('\n');
// The `project:` property as real vaults write it (a plain name: `[[Name]]` unquoted parses as a nested list,
// which the owner rule has never read — relations.ts namedProject before, makeProjectOwner now).

/** The pair plus six more late tasks of the person's own: 8 tasks, 9 rows before the fix. */
function pairVault() {
  return new Map([
    [BRUNSWICK, projectFile('Brunswick site lease renewal', ME, [STEP_LINE, '- [ ] Confirm the rent review date – Alex Rivera · by 30 Oct 2026', '- [ ] Ask the agent about signage – Alex Rivera · by 29 Oct 2026'])],
    [MEETING, meetingFile('Brunswick site lease renewal', [STEP_LINE, '- [ ] Send Shana the condition report – Alex Rivera · by 28 Oct 2026'])],
    [WATTLE, projectFile('Wattle Street Rooms', ME, ['- [ ] Pay the deposit – Alex Rivera · by 27 Oct 2026', '- [ ] Book the removalist – Alex Rivera · by 26 Oct 2026'])],
    [LOOSE, ['# Loose ends', '', '- [ ] Renew the parking permit – Alex Rivera · by 25 Oct 2026', '- [ ] File the council letter – Alex Rivera · by 24 Oct 2026', ''].join('\n')],
  ]);
}

function harness(files) {
  const index = new O.VaultIndex();
  const store = new Map(files);
  const put = (p, text) => {
    store.set(p, text);
    index.set(p, text, NOW, text.length);
  };
  for (const [p, text] of files) index.set(p, text, NOW, text.length);
  const tasks = new O.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => put(p, t), now: () => NOW });
  const hub = new O.Hub({ index, dailyPath: () => 'Daily/2026-11-04.md', templatesFolder: () => 'Templates', reminders: () => [], write: async (p, t) => put(p, t), now: () => NOW });
  const todayInput = () => ({
    projects: [...store.keys()].filter((p) => O.isProjectText(store.get(p).slice(0, 4000))).map((p) => ({ path: p, version: O.textVersion(store.get(p)), modified: NOW, project: O.parseProject(store.get(p), p) })),
    notes: [...store.keys()].map((p) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: NOW, props: index.get(p)?.props ?? {} })),
  });
  return { index, store, put, tasks, hub, todayInput };
}

const lisaRows = (rows, words) => rows.filter((t) => words(t).includes('Shana Tran'));

test('the shared reading: the same words, the same project, the owner not differing', () => {
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, `${WHAT} – Alex Rivera · by 31 Oct 2026`), true);
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, `${WHAT} – Alex · by 31 Oct 2026`), true, 'a first name is the same person');
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, `${WHAT} – Sam Okafor · by 31 Oct 2026`), false, 'another person’s line is another row');
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, `${WHAT} · by 31 Oct 2026`), false, 'no owner against a named one: no guessing');
  assert.equal(O.isSameTask({ what: WHAT }, WHAT), true, 'neither naming anyone');
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, 'Reply to Shana Tran on the cool room · by 31 Oct 2026'), false, 'near-repeats stay two rows');
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, ''), false);
  assert.equal(O.isSameTask({ what: '', who: 'Alex Rivera' }, WHAT), false);
});

test('Tasks: one row for the pair, in every mode and every group count', () => {
  const h = harness(pairVault());
  const view = h.tasks.view();
  assert.equal(view.today, TODAY);
  const open = O.filterTasks(view.tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  assert.equal(lisaRows(open, (t) => t.words).length, 1, 'the pair is one row');
  assert.equal(open.length, 8, '8 tasks, not 9');
  const kept = lisaRows(open, (t) => t.words)[0];
  assert.equal(kept.path, BRUNSWICK, 'the project’s step is the row');
  assert.deepEqual((kept.sources ?? []).map((s) => s.label), ['in Brunswick site lease renewal', 'from 2026-10-27 Brunswick lease clause call'], 'both sources on the one row, never a second copy');
  // Mine and Everyone, every group: the same list read each way.
  const infos = O.taskInfos(open.map((t) => ({ words: t.words, due: t.due, done: t.done, people: [] })), ME, TODAY);
  const mine = open.filter((_, i) => infos[i].ownership === 'mine');
  assert.equal(mine.length, 8);
  assert.equal(lisaRows(mine, (t) => t.words).length, 1);
  assert.equal(open.filter((_, i) => infos[i].group === 'late').length, 8, 'every group count reads the one row');
  assert.equal(O.lateForYouCount(open.map((t) => ({ words: t.words, due: t.due, done: t.done, people: [] })), ME, TODAY), 8);
  // The facets agree with the list.
  assert.equal(view.facets.counts.open, 8);
  assert.equal(view.facets.counts.overdue, 8);
});

test('Today and the rail: the heading, the figures and the one list count it once', () => {
  const h = harness(pairVault());
  const day = O.buildToday(h.todayInput(), REF);
  assert.equal(day.me, ME);
  const due = h.hub.due();
  assert.equal(lisaRows(due.overdue, (e) => (e.kind === 'task' ? e.item.words : e.item.text)).length, 0, 'the folded line is not in Due');
  assert.equal(lisaRows([...day.due.overdue, ...day.due.today], (x) => x.what).length, 1, 'the step stays');
  const heading = O.todayDueCount(day) + O.dueOwnCount(due, day.me, REF);
  assert.equal(heading, 8, 'the heading and the rail count 8, not 9');
  const split = O.dueOwnSplit(due, day.me, REF);
  const figures = O.subtitleFigures({ late: O.countDueSteps(day.due.overdue) + split.late, today: O.countDueSteps(day.due.today) + split.today, week: O.countDueSteps(day.due.soon) + split.week, waiting: day.waiting.length, risk: day.atRisk.length });
  assert.deepEqual(figures, ['8 late for you'], 'the figures say the same 8');
  // The one list, and the fold's input: one ranked row for the pair.
  const steps = [...day.due.overdue, ...day.due.today, ...day.due.soon, ...day.due.later].filter((x) => x.kind === 'step');
  const own = [...due.overdue, ...due.today, ...due.week, ...due.later].filter((e) => O.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, day.me, REF));
  const ranked = O.rankAllFor(steps, own, REF);
  assert.equal(ranked.filter((w) => (w.kind === 'step' ? w.step.what : w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text).includes('Shana Tran')).length, 1);
  assert.equal(ranked.length, 8);
});

test('the five: the brief, Telegram and Home rank the step once', () => {
  // The pair most overdue, so it ranks first; one smaller job behind it.
  const first = pairVault();
  first.set(BRUNSWICK, first.get(BRUNSWICK).replace('Reply to Shana Tran on the cool room clause – Alex Rivera · by 31 Oct 2026', 'Reply to Shana Tran on the cool room clause – Alex Rivera · by 20 Oct 2026'));
  first.set(MEETING, first.get(MEETING).replace('Reply to Shana Tran on the cool room clause – Alex Rivera · by 31 Oct 2026', 'Reply to Shana Tran on the cool room clause – Alex Rivera · by 20 Oct 2026'));
  first.delete(WATTLE);
  first.delete(LOOSE);
  const input = [...first.keys()].map((p) => ({ path: p, text: first.get(p), modified: NOW }));
  const five = O.topFiveFromProjectTexts(input, REF, ME);
  const lisa = five.filter((w) => (w.kind === 'step' ? w.step.what : w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text).includes('Shana Tran'));
  assert.equal(lisa.length, 1, 'one of the pair in the five');
  assert.equal(lisa[0].kind, 'step', 'the step is the row');
  assert.equal(five.length <= 5, true);
});

test('a tick closes both: the note line and the step, with one Undo', async () => {
  const h = harness(pairVault());
  const view = h.tasks.view();
  // The Tasks view rows the step; the note's line is ticked where it lives too.
  const row = lisaRows(view.tasks, (t) => t.words)[0];
  assert.equal(row.path, BRUNSWICK);
  await h.tasks.tick(row.path, row.line, row.text, true);
  assert.ok(h.store.get(BRUNSWICK).includes('- [x] Reply to Shana Tran'), 'the step ticked');
  assert.ok(h.store.get(MEETING).includes('- [x] Reply to Shana Tran'), 'the matching line ticked too');
  assert.ok(!h.store.get(MEETING).includes('- [ ] Reply to Shana Tran'), 'no half left open');
  // One Undo restores all of them.
  await h.tasks.tick(row.path, row.line, h.store.get(BRUNSWICK).split('\n')[row.line].replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, ''), false);
  assert.ok(h.store.get(BRUNSWICK).includes('- [ ] Reply to Shana Tran'), 'the step back');
  assert.ok(h.store.get(MEETING).includes('- [ ] Reply to Shana Tran'), 'the line back');
});

test('ticking from the note line closes the step too', async () => {
  const h = harness(pairVault());
  const line = h.store.get(MEETING).split('\n').findIndex((l) => l.includes('Reply to Shana Tran'));
  const text = h.store.get(MEETING).split('\n')[line].replace(/^\s*[-*+]\s+\[[^\]]\]\s+/, '');
  await h.tasks.tick(MEETING, line, text, true);
  assert.ok(h.store.get(MEETING).includes('- [x] Reply to Shana Tran'));
  assert.ok(h.store.get(BRUNSWICK).includes('- [x] Reply to Shana Tran'), 'the step closed too');
  await h.hub.tick(MEETING, line, h.store.get(MEETING).split('\n')[line].replace(/^\s*[-*+]\s+\[[^\]]\]\s+/, ''), false);
  assert.ok(h.store.get(MEETING).includes('- [ ] Reply to Shana Tran'), 'Today’s Undo brings the line back');
  assert.ok(h.store.get(BRUNSWICK).includes('- [ ] Reply to Shana Tran'), 'and the step');
});

test('a line ticked by hand in the editor stays a plain edit', async () => {
  const h = harness(pairVault());
  // The editor writes the note itself: no door, no cascade.
  h.put(MEETING, h.store.get(MEETING).replace('- [ ] Reply to Shana Tran', '- [x] Reply to Shana Tran'));
  assert.ok(h.store.get(BRUNSWICK).includes('- [ ] Reply to Shana Tran'), 'the step stays open');
  const day = O.buildToday(h.todayInput(), REF);
  assert.equal(lisaRows([...day.due.overdue, ...day.due.today], (x) => x.what).length, 1, 'the open step still rows as itself');
});

test('a half already done: nothing reappears as open because of the other', () => {
  // The step done long ago, the line still open: the line rows once, as itself.
  const done = pairVault();
  done.set(BRUNSWICK, done.get(BRUNSWICK).replace('- [ ] Reply to Shana Tran', '- [x] Reply to Shana Tran'));
  const h = harness(done);
  const open = O.filterTasks(h.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  const lisa = lisaRows(open, (t) => t.words);
  assert.equal(lisa.length, 1);
  assert.equal(lisa[0].path, MEETING, 'the open line rows from its note');
  const due = h.hub.due();
  assert.equal(lisaRows(due.overdue, (e) => (e.kind === 'task' ? e.item.words : e.item.text)).length, 1);
  // The line done, the step open: the step rows once, as itself.
  const done2 = pairVault();
  done2.set(MEETING, done2.get(MEETING).replace('- [ ] Reply to Shana Tran', '- [x] Reply to Shana Tran'));
  const h2 = harness(done2);
  const open2 = O.filterTasks(h2.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  const lisa2 = lisaRows(open2, (t) => t.words);
  assert.equal(lisa2.length, 1);
  assert.equal(lisa2[0].path, BRUNSWICK, 'the open step rows from its project');
});

test('another person’s line and another project’s line stay two rows; near words merge once (t249)', () => {
  const files = pairVault();
  files.set(MEETING, files.get(MEETING).replace('Reply to Shana Tran on the cool room clause – Alex Rivera', 'Reply to Shana Tran on the cool room clause – Sam Okafor'));
  const h = harness(files);
  const open = O.filterTasks(h.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  assert.equal(lisaRows(open, (t) => t.words).length, 2, 'Alex’s step and Sam’s line are two rows');
  const infos = O.taskInfos(open.map((t) => ({ words: t.words, due: t.due, done: t.done, people: [] })), ME, TODAY);
  assert.equal(open.filter((_, i) => infos[i].ownership === 'mine' && infos[i].group === 'late').length, 8, 'Mine › Late counts Alex’s only');
  // The same words in a note of another project: two rows.
  const files2 = pairVault();
  files2.set(MEETING, files2.get(MEETING).replace('project: Brunswick site lease renewal', 'project: Wattle Street Rooms'));
  const h2 = harness(files2);
  assert.equal(lisaRows(O.filterTasks(h2.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY), (t) => t.words).length, 2);
  // Nearly the same words, one starting with the other: one row with both sources (t249 goes beyond
  // t238’s exact-words merge: a meeting shortens the step’s words).
  const files3 = pairVault();
  files3.set(MEETING, files3.get(MEETING).replace('Reply to Shana Tran on the cool room clause – Alex Rivera', 'Reply to Shana Tran on the cool room – Alex Rivera'));
  const h3 = harness(files3);
  const near = O.filterTasks(h3.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  assert.equal(lisaRows(near, (t) => t.words).length, 1, 'the shortened meeting line folds into its step');
  assert.equal((lisaRows(near, (t) => t.words)[0].sources ?? []).length, 2, 'both sources ride under the one row');
  // Nearly the same words, neither starting with the other: still two rows.
  const files4 = pairVault();
  files4.set(MEETING, files4.get(MEETING).replace('Reply to Shana Tran on the cool room clause – Alex Rivera', 'Ask Shana Tran about the cool room clause – Alex Rivera'));
  const h4 = harness(files4);
  assert.equal(lisaRows(O.filterTasks(h4.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY), (t) => t.words).length, 2, 'different jobs never merge away');
});

test('reading never writes: the note and the project file stay as they are', () => {
  const h = harness(pairVault());
  const before = new Map(h.store);
  h.tasks.view();
  h.hub.due();
  h.hub.dueOn('2026-10-31');
  h.hub.marks('2026-11-02', '2026-11-08');
  O.buildToday(h.todayInput(), REF);
  O.topFiveFromProjectTexts([...h.store.keys()].map((p) => ({ path: p, text: h.store.get(p), modified: NOW })), REF, ME);
  assert.deepEqual([...h.store], [...before]);
  assert.ok(h.store.get(MEETING).includes('- [ ] Reply to Shana Tran'), 'the note still shows its own line');
});

test('a step ticked at Today or its page closes its lines in the one change', () => {
  const h = harness(pairVault());
  assert.equal(O.projectOfNote(h.index, MEETING), BRUNSWICK);
  assert.equal(O.projectOfNote(h.index, BRUNSWICK), BRUNSWICK);
  assert.equal(O.projectOfNote(h.index, LOOSE), null);
  const steps = O.openStepsByProject(h.index);
  assert.equal(steps.get(BRUNSWICK).length, 3);
  const closed = O.cascadeForStep(h.index, () => false, BRUNSWICK, { what: WHAT, who: ME }, true, REF);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].path, MEETING);
  assert.ok(closed[0].after.includes('- [x] Reply to Shana Tran'), 'the line ticked in the computed write');
  assert.ok(closed[0].before.includes('- [ ] Reply to Shana Tran'));
  const atLine = h.store.get(MEETING).split('\n').findIndex((l) => l.includes('Reply to Shana Tran'));
  const reopened = O.cascadeForLine(h.index, () => false, { path: MEETING, line: atLine }, `${WHAT} – Alex Rivera · by 31 Oct 2026`, true, REF);
  assert.equal(reopened.project.path, BRUNSWICK, 'the line closes its step');
  assert.equal(reopened.notes.length, 0, 'no other note holds it');
  // Which project edits close a step (the close dialog's drop and move remove it; ticks and toggles flip it).
  const next = [{ what: WHAT, who: ME, done: false }, { what: 'Old one', done: true }];
  assert.deepEqual(O.closedStepOf(next, { kind: 'change', list: 'next', index: 0, item: { done: true } }), { step: { what: WHAT, who: ME }, done: true });
  assert.deepEqual(O.closedStepOf(next, { kind: 'change', list: 'next', index: 1, item: { done: false } }), { step: { what: 'Old one' }, done: false });
  assert.deepEqual(O.closedStepOf(next, { kind: 'remove', list: 'next', index: 0 }), { step: { what: WHAT, who: ME }, done: true });
  assert.deepEqual(O.closedStepOf(next, { kind: 'next-toggle', index: 0 }), { step: { what: WHAT, who: ME }, done: true });
  assert.equal(O.closedStepOf(next, { kind: 'remove', list: 'next', index: 1 }), null, 'removing a done step closes nothing new');
  assert.equal(O.closedStepOf(next, { kind: 'change', list: 'next', index: 0, item: { done: false } }), null, 'no flip, no cascade');
  assert.equal(O.closedStepOf(next, { kind: 'change', list: 'next', index: 0, item: { what: 'New words' } }), null, 'rewording closes nothing');
  assert.equal(O.closedStepOf(next, { kind: 'add', list: 'next', item: { what: 'New' } }), null);
  assert.equal(O.closedStepOf(next, { kind: 'change', list: 'risks', index: 0, item: { closed: true } }), null);
  // One history step carries the notes, so one Undo restores all of them.
  const history = new O.ProjectHistory();
  history.record(BRUNSWICK, { before: 'p0', after: 'p1', words: 'Ticked off.', by: 'you', notes: [{ path: MEETING, before: 'n0', after: 'n1' }] });
  assert.deepEqual(history.peek(BRUNSWICK).notes, [{ path: MEETING, before: 'n0', after: 'n1' }]);
  assert.equal(history.shift(BRUNSWICK, false).notes.length, 1);
  assert.deepEqual(history.peek(BRUNSWICK, true).notes, [{ path: MEETING, before: 'n0', after: 'n1' }]);
});

test('reminders and templates never fold', async () => {
  const files = pairVault();
  files.set(MEETING, files.get(MEETING) + `- [ ] ${WHAT} – Alex Rivera ⏰ 2026-10-31 09:00\n`);
  files.set('Templates/Lease.md', `${STEP_LINE}\n`);
  const h = harness(files);
  const open = O.filterTasks(h.tasks.view().tasks, { ...O.DEFAULT_FILTER, when: 'any' }, TODAY);
  assert.ok(lisaRows(open, (t) => t.words).some((t) => t.reminder), 'the reminder rows as itself');
  assert.ok(!open.some((t) => t.path === 'Templates/Lease.md'), 'templates are never work');
  assert.equal(h.hub.due().overdue.filter((e) => e.kind === 'task' && e.item.words.includes('Shana Tran')).length, 0);
  // A tick inside a template never cascades out.
  await h.tasks.tick('Templates/Lease.md', 0, STEP_LINE.replace(/^- \[ \] /, ''), true);
  assert.ok(h.store.get(BRUNSWICK).includes('- [ ] Reply to Shana Tran'), 'the step stays open');
  assert.ok(h.store.get(MEETING).includes('- [ ] Reply to Shana Tran'), 'the line stays open');
});

// A date in an owner tail is never a person (p16-owner-tail, 4 Nov 2026): a note line "— Alex Rivera — due
// 2026-11-06" read its owner as the name with the date on it. All three shapes the assistant writes read as that
// person; a real name with a hyphen or a dash inside stays whole.
test('an owner tail with a date reads as that person', () => {
  const line = (tail) => `${WHAT} — ${tail}`;
  for (const tail of ['Alex Rivera — due 2026-11-06', 'Alex Rivera, due 2026-11-06', 'Alex Rivera · by 31 Oct 2026']) {
    const s = O.splitLineIdentity(line(tail), REF);
    assert.equal(s.title, WHAT, tail);
    assert.equal(s.owner, 'Alex Rivera', tail);
  }
  assert.equal(O.splitLineIdentity(line('Anne-Marie Jones — due 2026-11-06'), REF).owner, 'Anne-Marie Jones');
  assert.equal(O.splitLineIdentity(line('Smith – Jones'), REF).owner, 'Smith – Jones', 'a dash in a name without a date word after stays whole');
  assert.equal(O.isSameTask({ what: WHAT, who: 'Alex Rivera' }, line('Alex Rivera — due 2026-11-06'), REF), true, 'the date tail still matches the step');
});
