// node --test tests/t250-merge-pairs.test.mjs — break the one-row merge rule (t250, 12 Nov 2026:
// "a tick may never land on a task the person did not mean"). Every pair below states its expected
// answer first: merge (the one job written twice) or stay two (different jobs, different owners, or
// too short to be sure). Fails where the rule is too eager (joint owners); passes after the tighten.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t250-pairs-'));
let O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const one = path.join(work, 'one.ts');
  writeFileSync(one, `export { findMatchingLines, findMatchingSteps, isNearKey, isSameKey, lineKeyOf, stepKeyOf } from ${src('src/shared/one-task.ts')};\n`);
  await build({ input: one, platform: 'node', output: { file: path.join(work, 'one.mjs'), format: 'esm' }, logLevel: 'silent' });
  O = await import(pathToFileURL(path.join(work, 'one.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 12, 9, 0);
// Whether the pair draws as one row (exact or near), the way every fold and the cascade read it.
const merges = (stepWhat, stepWho, lineWords) => {
  const step = O.stepKeyOf({ what: stepWhat, ...(stepWho ? { who: stepWho } : {}) });
  const line = O.lineKeyOf(lineWords, NOW);
  if (!line) return false;
  return O.isSameKey(step, line) || O.isNearKey(step, line);
};

test('merge: the one job written twice, however shortened', () => {
  assert.equal(merges('Publish the November roster', 'Priya Nair', 'Publish the November roster with cover for all four Friday nights — Priya Nair'), true, 'the meeting carries the detail');
  assert.equal(merges('Retry the failed payment twice before showing an error, then check the Saturday orders line by line', 'Priya Nair', 'Retry the failed payment twice before showing an error — Priya Nair'), true, 'the meeting shortens the step');
  assert.equal(merges('Send the receipt v2 for review with the tax line fixed and the totals double-checked', 'Alex Chen', 'Send the receipt v2 for review with the tax line fixed — Alex Chen'), true, 'the receipt review folds');
  assert.equal(merges('Ring ShadeCo about the awning quote before it lapses', 'Alex Chen', 'Ring ShadeCo about the awning quote — Alex Chen'), true, 'a day left out still folds');
  assert.equal(merges('Ring the bank about the loan approval', 'Mia Tran', 'Ring the bank about the loan — Mia Tran'), true, 'the detail rides along');
  assert.equal(merges('File the BAS for the September quarter', 'Sam Okafor', 'File the BAS for the September quarter before Friday — Sam'), true, 'a first name is its person');
  assert.equal(merges('Draft the December roster for sign-off', 'me', 'Draft the December roster — me'), true, 'me is me on both sides');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam and June', 'Set up the new oven — June and Sam'), true, 'the same pair in either order');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam with June', 'Set up the new oven — Sam and June'), true, 'the same pair however joined');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam; June', 'Set up the new oven — June and Sam'), true, 'a semicolon joins them too');
  assert.equal(merges('Water the plants in the front window', '', 'Water the plants in the front window and the back room'), true, 'no owner either side still folds');
});

test('stay two: different jobs never merge away', () => {
  assert.equal(merges('Send June the October totals', 'Priya Nair', 'Send June the November totals — Priya Nair'), false, 'October is not November');
  assert.equal(merges('Book the room for next Tuesday', 'Alex Chen', 'Book the room for the December roster sign-off — Alex Chen'), false, 'two bookings stay two');
  assert.equal(merges('Book the room for the December roster sign-off', 'Alex Chen', 'Book the room for next Tuesday — Alex Chen'), false, 'both directions stay two');
  assert.equal(merges('Confirm the December dates with the caterer before sign-off', 'Lucy Hammond', 'Confirm the Friday roster with the weekend crew — Lucy Hammond'), false, 'different jobs stay two');
  assert.equal(merges('Pay invoice 1234', '', 'Pay invoice 12345'), false, 'one digit is another invoice');
  assert.equal(merges('Chase the overdue invoice from ShadeCo', 'Sam Okafor', 'Chase the overdue invoice — Sam Reid'), false, 'another family is another job');
});

test('stay two: too short to be sure', () => {
  assert.equal(merges("Call Sam's bank about the card reader", '', 'Call Sam'), false, 'two words could prefix anything');
  assert.equal(merges('Call Sam', '', "Call Sam's bank about the card reader"), false, 'both directions stay two');
  assert.equal(merges('Book the room', '', 'Book the room for the December roster sign-off, and the caterer'), false, 'the room booked is not the roster signed off');
  assert.equal(merges('Book the room for the December roster sign-off, and the caterer', '', 'Book the room'), false, 'both directions stay two');
  assert.equal(merges('Pay the bill online today', '', 'Pay the bill'), false, 'under three words stays two');
  assert.equal(merges('Ring the bank about the loan', '', 'Ring the bank'), false, 'short generics stay two');
});

test('stay two: the owner differing blocks the merge', () => {
  assert.equal(merges('Send June the October totals', 'Priya Nair', 'Send June the October totals — Alex Chen'), false, 'another owner is another job');
  assert.equal(merges('Send June the October totals', 'Priya Nair', 'Send June the October totals'), false, 'one side naming no one is differing, never a guess');
  assert.equal(merges('Send June the October totals', '', 'Send June the October totals — Priya Nair'), false, 'both directions stay two');
  assert.equal(merges('Draft the December roster for sign-off', 'me', 'Draft the December roster — Alex Chen'), false, 'me never resolves to a name here');
  assert.equal(merges('Draft the December roster for sign-off', 'me', 'Draft the December roster'), false, 'me against no one stays two');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam and June', 'Set up the new oven — Sam'), false, 'a pair is not one of them');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam and June', 'Set up the new oven — June'), false, 'a pair is not the other either');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam and June', 'Set up the new oven — Sam and Alex'), false, 'a different pair is another job');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam with June', 'Set up the new oven — Sam'), false, 'with two, one is not the job');
  assert.equal(merges('Set up the new oven and train the Saturday crew', 'Sam; June', 'Set up the new oven — June'), false, 'a semicolon pair is not one either');
});

test('the accepted edge: a prefix reads the words, never the meaning', () => {
  // "Order the new paper bag" prefixes "Order the new paper bag holder and shelf brackets…": the rule
  // reads words, never meaning (one-task.ts: "no meaning matching beyond that, no guessing"), in the
  // same direction the critics require for Publish (short step, long meeting line). Same project and
  // same owner still required everywhere it is read.
  assert.equal(merges('Order the new paper bag', 'Mia Tran', 'Order the new paper bag holder and shelf brackets for the back room — Mia Tran'), true, 'a prefix folds, meaning aside');
});

test('ticking either twin closes the other, reopening reopens, and nothing else moves', () => {
  const project = '---\ntype: project\nstatus: active\nowner: Priya Nair\n---\n# Museum Late Shift\n\n## What’s next\n\n- [ ] Publish the November roster — Priya Nair — due 2026-10-28\n- [ ] Send June the October totals — Priya Nair — due 2026-11-11\n';
  const line = 'Publish the November roster with cover for all four Friday nights — Priya Nair';
  assert.deepEqual(O.findMatchingSteps(project, line, 'Museum Late Shift.md', NOW, true), [0], 'ticking the meeting line closes its step');
  assert.deepEqual(O.findMatchingSteps(project, 'Send June the November totals — Priya Nair', 'Museum Late Shift.md', NOW, true), [], 'November never closes October');
  const note = '# 2026-11-03 Cart standup\n\n## Actions\n\n- [ ] Publish the November roster with cover for all four Friday nights — Priya Nair\n- [ ] Send June the November totals — Priya Nair\n';
  assert.deepEqual(O.findMatchingLines(note, { what: 'Publish the November roster', who: 'Priya Nair' }, NOW, true).map((l) => l.line), [4], 'ticking the step closes its meeting line');
  assert.deepEqual(O.findMatchingLines(note, { what: 'Send June the October totals', who: 'Priya Nair' }, NOW, true), [], 'October never closes November');
  // Undo is a reopen on both sides: the done twins match again for the reopen, then ticking the other
  // twin still finds its pair.
  const projectTicked = project.replace('- [ ] Publish the November roster', '- [x] Publish the November roster');
  const noteTicked = note.replace('- [ ] Publish the November roster', '- [x] Publish the November roster');
  assert.deepEqual(O.findMatchingSteps(projectTicked, line, 'Museum Late Shift.md', NOW, false), [0], 'reopening the line reopens its step');
  assert.deepEqual(O.findMatchingLines(noteTicked, { what: 'Publish the November roster', who: 'Priya Nair' }, NOW, false).map((l) => l.line), [4], 'reopening the step reopens its line');
});
