// node --test tests/record-match.test.mjs — 9.2 intelligence uplift: finding the record a person means
// (src/shared/record-match.ts). Every tool that takes a name resolves it here: the reference tidied, the one
// record that matches, or an error naming the candidates instead of silently the first. Made-up names only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-match-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as R from ${JSON.stringify(path.join(root, 'src/shared/record-match.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'match.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ R } = await import(pathToFileURL(path.join(work, 'match.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('tidying: links, paths, .md and case fold away', () => {
  assert.equal(R.normalizeRef('[[Me/Finance/Bills/Credit Card.md]]'), 'credit card');
  assert.equal(R.normalizeRef('[Me/Finance/Bills/Credit Card.md]'), 'credit card');
  assert.equal(R.normalizeRef('Me/Finance/Bills/Credit Card.md'), 'credit card');
  assert.equal(R.normalizeRef('  CREDIT   Card '), 'credit card');
  assert.equal(R.normalizeRef('[Credit Card](Me/Finance/Bills/Credit Card.md)'), 'credit card', 'markdown links resolve by their text');
});

test('one record: exact wins, then the only word-start match', () => {
  const bills = [{ name: 'Harbour Internet', path: 'B/Harbour Internet.md' }, { name: 'Harbour Internet Plus', path: 'B/Harbour Internet Plus.md' }];
  assert.equal(R.resolveOne(bills, 'Harbour Internet', { noun: 'bill', where: 'in Money' }).path, 'B/Harbour Internet.md');
  assert.equal(R.resolveOne(bills, 'B/Harbour Internet.md', { noun: 'bill' }).name, 'Harbour Internet');
  assert.equal(R.resolveOne([{ name: 'Credit Card', path: 'B/G.md' }], 'credit', { noun: 'bill' }).name, 'Credit Card');
  assert.equal(R.resolveOne([{ name: 'Run 5 km race', path: 'x' }], '5 km', { noun: 'milestone' }).name, 'Run 5 km race');
});

test('two matches is never silently the first; none says so plainly', () => {
  const bills = [{ name: 'Harbour Internet', path: 'a' }, { name: 'Harbour Internet Plus', path: 'b' }];
  assert.throws(() => R.resolveOne(bills, 'Harbour', { noun: 'bill', where: 'in Money' }), /More than one bill matches “Harbour”: Harbour Internet, Harbour Internet Plus/);
  assert.throws(() => R.resolveOne([{ name: 'Notes', path: 'A/Notes.md' }, { name: 'Notes', path: 'B/Notes.md' }], 'Notes', { noun: 'note' }), /More than one note matches “Notes”: Notes, Notes/, 'two exacts never silently the first');
  assert.throws(() => R.resolveOne(bills, 'Nope', { noun: 'bill', where: 'in Money' }), /There is no bill called “Nope” in Money/);
  assert.throws(() => R.resolveOne([{ name: 'Run 15 km race', path: 'x' }], '5 km', { noun: 'milestone' }), /There is no milestone called/, 'mid-word is no match');
  assert.throws(
    () => R.resolveOne(bills, 'Nope', { noun: 'bill', candidates: ['Harbour Internet', 'Harbour Internet Plus'] }),
    /There is no bill called “Nope”\. Bills: Harbour Internet, Harbour Internet Plus\./,
    'a miss names what there is',
  );
});

test('same record: case, spacing and punctuation never fork one', () => {
  assert.equal(R.sameRecordName('Credit Card', 'credit  card'), true);
  assert.equal(R.sameRecordName('Harbour Internet', 'Harbour-Internet'), true);
  assert.equal(R.sameRecordName('Credit Card', 'Credit Card 2'), false);
  assert.equal(R.sameRecordName('', 'x'), false);
});
