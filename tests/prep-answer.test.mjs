// node --test tests/prep-answer.test.mjs — the prep answer on the meeting page (6 Nov 2026, o3-meeting-page
// item 3: "Prep, from your notes" was one long paragraph of bold nobody could read). It is plain code, not a
// model: prepAnswer (src/shared/work-meetings.ts) shapes the pack, and the page draws each person as their own
// block of separate lines. Near-duplicates become one line by the minutes' own sameness test (sameJob, moved
// beside sameWhat/sameSubject in src/shared/meetings.ts), no more than three lines a person, the rest as
// "and N more", and only distinct things are counted in that N.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-prep-answer-'));
let W; let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as W from ${JSON.stringify(path.join(root, 'src/shared/work-meetings.ts'))};\nexport * as M from ${JSON.stringify(path.join(root, 'src/shared/meetings.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ W, M } = await import(pathToFileURL(path.join(work, 'w.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const item = (what, p = 'Meetings/Weekly.md', from = 'Weekly') => ({ what, path: p, from });
const pack = (people) => ({ meeting: { path: 'Meetings/2026-11-06 Weekly.md', title: 'Weekly', date: '2026-11-06', time: '' }, people, last: null, project: null, earlier: [], linked: [], recent: [], count: people.reduce((s, x) => s + x.theirs.length, 0) });

test("the minutes' sameness test is shared, not reinvented", () => {
  assert.equal(typeof M.sameJob, 'function', 'sameJob must live in meetings.ts');
  assert.equal(M.sameJob('Ring Merricks Creek and confirm the first delivery in writing', 'Ring Merricks Creek Dairy and confirm first delivery in writing'), true);
  assert.equal(M.sameJob('Ring Merricks Creek and confirm the first delivery in writing', 'Book the tilers for Tuesday'), false);
});

test('a thing said twice in different words is one line of a person’s prep', () => {
  const ans = W.prepAnswer(pack([{ name: 'Mia Chen', theirs: [
    item('Bring the draft opening stock list'),
    item('Ring Merricks Creek and confirm the first delivery in writing', 'Notes/Milk tender.md', 'Milk tender'),
    item('Ring Merricks Creek Dairy and confirm first delivery in writing', 'Notes/Milk tender.md', 'Milk tender'),
    item('Cost the mushroom toast at final prices'),
  ], lastMet: null }]));
  const mia = ans.sentences.find((s) => s.lead === 'Mia Chen');
  assert.ok(mia, 'Mia has her own block');
  assert.equal(mia.whats.length, 3, JSON.stringify(mia.whats));
  assert.equal(mia.whats.filter((w) => /Merricks Creek/.test(w.what)).length, 1, 'the Merricks Creek deed is one line');
  assert.equal(mia.more, undefined, 'three distinct things, nothing hidden behind "and more"');
});

test('no more than three lines a person, and "and N more" counts distinct things only', () => {
  const theirs = [
    item('Send the final works list to Lisa Tran'),
    item('Send final works list to Lisa Tran'),
    item('Get the second dairy delivery times in writing'),
    item('Compare the three quotes on equal litres'),
    item('Agree the price for extra same-week orders'),
    item('Book the cool room service'),
  ];
  const ans = W.prepAnswer(pack([{ name: 'Alex Rivera', theirs, lastMet: null }]));
  const alex = ans.sentences.find((s) => s.lead === 'Alex Rivera');
  assert.equal(alex.whats.length, 3);
  assert.equal(alex.more, 2, '5 distinct things: 3 shown and 2 more');
});

test('different deeds that share a few words stay separate lines', () => {
  const ans = W.prepAnswer(pack([{ name: 'Kate Sullivan', theirs: [
    item('Confirm the revised counter joinery and lock the install day'),
    item('Bring the revised joinery drawing and install dates'),
    item('Confirm the joinery install day with the joiners'),
  ], lastMet: null }]));
  const kate = ans.sentences.find((s) => s.lead === 'Kate Sullivan');
  assert.ok(kate.whats.length >= 2, `kept ${kate.whats.length}`);
});

test('prepDistinct keeps the first telling of each thing, in order', () => {
  assert.equal(typeof W.prepDistinct, 'function');
  const out = W.prepDistinct([item('Book the tilers for Tuesday'), item('Book the tilers for Tuesday'), item('Pay the tilers on Friday')]);
  assert.deepEqual(out.map((x) => x.what), ['Book the tilers for Tuesday', 'Pay the tilers on Friday']);
});
