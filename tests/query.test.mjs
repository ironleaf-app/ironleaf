// node --test tests/query.test.mjs — the search words (src/shared/query.ts), shared by notes search and search inside
// project files: a word is found from the start of a word, so "led" doesn't light up "installed" or "scheduled".
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-query-'));
let Q;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/query.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'q.mjs'), format: 'esm' }, logLevel: 'silent' });
  Q = await import(pathToFileURL(path.join(work, 'q.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const doc = (content, title = 'Note') => ({ path: `${title}.md`, title, content, tags: [], props: {} });
const finds = (query, content) => new Q.QueryMatcher(Q.parseQuery(query)).matches(doc(content));

test('words are found from the start of a word, never from inside one', () => {
  assert.equal(finds('LED wall', 'The screen is installed on a wall mount.'), false, '"led" inside "installed"');
  assert.equal(finds('LED wall', 'An LED wall like Melbourne.'), true);
  assert.equal(finds('instal', 'The screen is installed.'), true, 'the start of a word finds the rest of it');
  assert.equal(finds('"wall mount"', 'installed on a wall mount'), true, 'a quoted phrase too');
  assert.equal(finds('#urgent', 'tagged#urgent here'), true, 'a word starting with a mark is found anywhere');
  assert.equal(finds('48', 'A$48,200 inc GST'), true, 'numbers after a mark');
  assert.equal(finds('Ōtautahi', 'Kia ora Ōtautahi team'), true, 'letters beyond English');
});

test('9.2 lower-case and/or join words, marks fold ("credit and card", "cafe" for "café")', () => {
  assert.equal(finds('credit and card', 'The credit card bill is due.'), true);
  assert.equal(finds('credit and card', 'Credit Card'), true);
  assert.equal(finds('credit or card', 'Paid the card bill.'), false, 'lower-case or never splits: every word still needed');
  assert.equal(finds('credit or card', 'The credit card bill is due.'), true);
  assert.equal(finds('credit OR card', 'Paid the card bill.'), true, 'upper-case OR splits');
  assert.equal(finds('credit OR card', 'Paid the power bill.'), false);
  assert.equal(finds('cafe', 'Meet at the café on Harbour.'), true);
  assert.equal(finds('café', 'Meet at the cafe on Harbour.'), true);
  assert.equal(finds('Ōtautahi', 'Kia ora Otautahi team'), true, 'folding both ways');
});

test('the marked words in a line are the ones that start words', () => {
  const m = new Q.QueryMatcher(Q.parseQuery('led'));
  const line = 'Scheduled: LED panel, installed, led strip';
  assert.deepEqual(m.ranges(line).map(([a, b]) => line.slice(a, b)), ['LED', 'led']);
});

test('task-todo keeps an in-progress box; task-done keeps ticked and cancelled (9.5 fourth pass)', () => {
  assert.equal(finds('task-todo:Halfway', '- [/] Halfway there'), true);
  assert.equal(finds('task-todo:Halfway', '- [x] Halfway there'), false);
  assert.equal(finds('task-done:Halfway', '- [x] Halfway there'), true);
  assert.equal(finds('task-done:Halfway', '- [-] Halfway there'), true);
  assert.equal(finds('task-done:Halfway', '- [/] Halfway there'), false);
});
