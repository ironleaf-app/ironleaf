// node --test tests/t249-one-row.test.mjs — one row per job on Today and Tasks (t249, 12 Nov 2026,
// the critics: "Publish the November roster with cover" twice in identical words plus a near copy, the
// Retry line twice). Where the same job is written in a meeting and on its project, it draws once with its
// sources under it. Beyond t238's exact-words merge: two rows merge when one's words start with the other's
// at a word edge (three words at least), the owner not differing, the same project — and nothing different
// merges away (each negative below fails if it does). Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t249-row-'));
let O;
let U;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const one = path.join(work, 'one.ts');
  writeFileSync(one, `export { dupNoteWords, findMatchingLines, findMatchingSteps, isNearKey, isSameKey, lineKeyOf, stepKeyOf } from ${src('src/shared/one-task.ts')};\n`);
  await build({ input: one, platform: 'node', output: { file: path.join(work, 'one.mjs'), format: 'esm' }, logLevel: 'silent' });
  O = await import(pathToFileURL(path.join(work, 'one.mjs')).href);
  const two = path.join(work, 'two.ts');
  writeFileSync(two, `export { mergeGroups, sourceOf } from ${src('src/shared/unified-tasks.ts')};\n`);
  await build({ input: two, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'two.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  U = await import(pathToFileURL(path.join(work, 'two.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 12, 9, 0);
const near = (stepWhat, stepWho, lineWords) => O.isNearKey(O.stepKeyOf({ what: stepWhat, ...(stepWho ? { who: stepWho } : {}) }), O.lineKeyOf(lineWords, NOW));
const same = (stepWhat, stepWho, lineWords) => O.isSameKey(O.stepKeyOf({ what: stepWhat, ...(stepWho ? { who: stepWho } : {}) }), O.lineKeyOf(lineWords, NOW));

test('near: a meeting shortening the step’s words, or the step carrying the meeting’s detail', () => {
  // The critic’s pairs, owner on both sides.
  assert.equal(near('Retry the failed payment twice before showing an error, then check the Saturday orders line by line', 'Priya Nair', 'Retry the failed payment twice before showing an error — Priya Nair'), true, 'Retry: the meeting shortens the step');
  assert.equal(near('Publish the November roster', 'Priya Nair', 'Publish the November roster with cover for all four Friday nights — Priya Nair'), true, 'Publish: the meeting carries the detail (three words is enough)');
  assert.equal(near('Send the receipt v2 for review with the tax line fixed and the totals double-checked', 'Alex Chen', 'Send the receipt v2 for review with the tax line fixed — Alex Chen'), true, 'the receipt review folds too');
  // Either direction reads the same.
  assert.equal(near('Retry the failed payment twice before showing an error', 'Priya Nair', 'Retry the failed payment twice before showing an error, then check the Saturday orders line by line — Priya Nair'), true, 'the short side may be the step');
  // Exact words stay exact: near answers false, same answers true.
  assert.equal(near('Write the rollback note for the retry fix', 'Priya Nair', 'Write the rollback note for the retry fix — Priya Nair'), false, 'exact is same’s job, not near’s');
  assert.equal(same('Write the rollback note for the retry fix', 'Priya Nair', 'Write the rollback note for the retry fix — Priya Nair'), true, 'exact still matches');
});

test('near: nothing different merges away', () => {
  // Same start, neither starting with the other.
  assert.equal(near('Book the room for next Tuesday', 'Alex Chen', 'Book the room for the December roster sign-off — Alex Chen'), false, 'two bookings stay two');
  assert.equal(near('Book the room for the December roster sign-off', 'Alex Chen', 'Book the room for next Tuesday — Alex Chen'), false, 'both directions stay two');
  // One word apart at the tail.
  assert.equal(near('Send June the October totals', 'Priya Nair', 'Send June the November totals — Priya Nair'), false, 'October is not November');
  // Same verb, different jobs.
  assert.equal(near('Confirm the December dates with the caterer before sign-off', 'Lucy Hammond', 'Confirm the Friday roster with the weekend crew — Lucy Hammond'), false, 'different jobs stay two');
  // The owner differing blocks the merge, however close the words.
  assert.equal(near('Retry the failed payment twice before showing an error, then check the Saturday orders line by line', 'Priya Nair', 'Retry the failed payment twice before showing an error — Alex Chen'), false, 'another owner is another job');
  assert.equal(near('Retry the failed payment twice before showing an error, then check the Saturday orders line by line', 'Priya Nair', 'Retry the failed payment twice before showing an error'), false, 'one side naming no one is differing, never a guess');
  // Fragments never merge: two words could prefix anything.
  assert.equal(near('Pay the bill online today', '', 'Pay the bill'), false, 'under three words stays two');
  assert.equal(near('Ring the bank', '', 'Ring the bank about the loan'), false, 'short generics stay two');
});

test('mergeGroups: one row with its sources under it; other projects stay separate', () => {
  const P = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
  const M = 'Meetings/2026-11-03 Cart standup.md';
  const D = 'Projects/The December refit/The December refit.md';
  const row = (words, owner, project, home, source) => ({ words, text: words, owner, due: null, done: false, project, projectName: project ? project.split('/').pop().replace(/\.md$/, '') : null, home, source });
  const groups = U.mergeGroups(
    [
      row('Retry the failed payment twice before showing an error, then check the Saturday orders line by line', 'Priya Nair', P, { path: P, index: 1 }, U.sourceOf('project', P, 'Harbourline Cart Fix')),
      row('Retry the failed payment twice before showing an error — Priya Nair', 'Priya Nair', P, { path: M, line: 9 }, U.sourceOf('meeting', M, '2026-11-03 Cart standup')),
      row('Publish the November roster with cover for all four Friday nights', 'Priya Nair', D, { path: D, index: 0 }, U.sourceOf('project', D, 'The December refit')),
    ],
    NOW,
  );
  assert.equal(groups.length, 2, 'the Retry pair merges; the other project’s row stands apart');
  const merged = groups.find((g) => g.length === 2);
  assert.ok(merged, 'one group holds both Retry homes');
  assert.deepEqual(
    merged.map((m) => m.source.label).sort(),
    ['from 2026-11-03 Cart standup', 'in Harbourline Cart Fix'].sort(),
    'both sources ride under the one row',
  );
  const apart = U.mergeGroups(
    [
      row('Book the room for next Tuesday', 'Alex Chen', P, { path: P, index: 0 }, U.sourceOf('project', P, 'Harbourline Cart Fix')),
      row('Book the room for the December roster sign-off — Alex Chen', 'Alex Chen', P, { path: M, line: 4 }, U.sourceOf('meeting', M, '2026-11-03 Cart standup')),
    ],
    NOW,
  );
  assert.equal(apart.length, 2, 'two bookings stay two rows');
});

test('the tick cascade closes near twins too, and nothing else', () => {
  const project = '---\ntype: project\nstatus: active\nowner: Priya Nair\n---\n# Museum Late Shift\n\n## What’s next\n\n- [ ] Publish the November roster — Priya Nair — due 2026-10-28\n- [ ] Send June the October totals — Priya Nair — due 2026-11-11\n';
  assert.deepEqual(O.findMatchingSteps(project, 'Publish the November roster with cover for all four Friday nights — Priya Nair', 'Museum Late Shift.md', NOW, true), [0], 'ticking the meeting line closes its step');
  assert.deepEqual(O.findMatchingSteps(project, 'Send June the November totals — Priya Nair', 'Museum Late Shift.md', NOW, true), [], 'November never closes October');
  const note = '# 2026-11-03 Cart standup\n\n## Actions\n\n- [ ] Retry the failed payment twice before showing an error — Priya Nair\n- [ ] Book the room for next Tuesday — Alex Chen\n';
  assert.deepEqual(
    O.findMatchingLines(note, { what: 'Retry the failed payment twice before showing an error, then check the Saturday orders line by line', who: 'Priya Nair' }, NOW, true).map((l) => l.line),
    [4],
    'ticking the step closes its meeting line',
  );
  assert.deepEqual(O.findMatchingLines(note, { what: 'Book the room for the December roster sign-off', who: 'Alex Chen' }, NOW, true), [], 'the other booking stays open');
});

test('Today draws the step once with its folded sources under it', () => {
  const view = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(view.includes('x.sources') && view.includes("s.kind !== 'project'"), 'due, waiting and unscheduled rows name folded lines under the project');
  const main = read('src/main/today.ts');
  assert.ok(main.includes('keptStepSources('), 'the main side works out which lines fold into which step');
  const fold = read('src/main/hub.ts');
  assert.ok(fold.includes('isSameKey(s, key) || isNearKey(s, key)'), 'the hub folds exact and near lines alike');
});
