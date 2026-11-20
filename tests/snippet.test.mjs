// node --test tests/snippet.test.mjs — a search result's line without its Markdown (src/shared/snippet.ts): list, quote
// and heading leads, bold and italic stars, highlights, strike-through, code ticks and link brackets left out, the words
// found still marked in the same place, and names with underscores or sums with a star kept as written.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-snippet-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/snippet.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** The marked words of a line, as shown. */
const marked = (raw, words) => {
  const ranges = words.map((w) => { const a = raw.indexOf(w); return [a, a + w.length]; });
  const r = S.plainLine(raw, ranges);
  return { text: r.text, marks: r.ranges.map(([a, b]) => r.text.slice(a, b)) };
};

test('bold, italic and a list lead go; the found words stay marked', () => {
  const r = marked('- **High** — 11 old microphone stands can’t be found', ['old', 'stands']);
  assert.equal(r.text, 'High — 11 old microphone stands can’t be found');
  assert.deepEqual(r.marks, ['old', 'stands']);
});

test('an update line with its date in bold and its source in italics', () => {
  const r = marked('- **17 Oct 2026** — 10 of 12 soundproofing panels up. *From:* Studio_Upgrade_Status.csv', ['panels', 'Studio_Upgrade']);
  assert.equal(r.text, '17 Oct 2026 — 10 of 12 soundproofing panels up. From: Studio_Upgrade_Status.csv');
  assert.deepEqual(r.marks, ['panels', 'Studio_Upgrade']);
});

test('a word found inside bold marks loses the stars, not its mark', () => {
  const r = marked('Send the **reconciliation** today', ['**reconciliation**']);
  assert.equal(r.text, 'Send the reconciliation today');
  assert.deepEqual(r.marks, ['reconciliation']);
});

test('highlights, strike-through, code and link brackets go; headings and quotes lose their lead', () => {
  assert.equal(S.plainLine('## A ==bright== idea with ~~old~~ `code` and [[Weekly menu]]', []).text, 'A bright idea with old code and Weekly menu');
  assert.equal(S.plainLine('> quoted words', []).text, 'quoted words');
  assert.equal(S.plainLine('1. [ ] a numbered task', []).text, 'a numbered task');
});

test('underscores in names and a star between spaces stay', () => {
  assert.equal(S.plainLine('Studio_Upgrade_Status.csv is 4 * 3 rows', []).text, 'Studio_Upgrade_Status.csv is 4 * 3 rows');
});

test('a table row reads as its cells with dots between, its words still marked', () => {
  const r = marked('| 2026-10-19 | Northgate Tessaly pricing v2.2 validity ends | planned |', ['Northgate']);
  assert.equal(r.text, '2026-10-19 · Northgate Tessaly pricing v2.2 validity ends · planned');
  assert.deepEqual(r.marks, ['Northgate']);
  assert.equal(S.plainLine('A sum like 3 | 4 stays', []).text, 'A sum like 3 | 4 stays', 'a bar in words is kept');
});

test('a coloured highlight’s tags go, its words stay marked', () => {
  const r = marked('Buy <mark class="nv-green">fresh yeast</mark> today', ['yeast']);
  assert.equal(r.text, 'Buy fresh yeast today');
  assert.deepEqual(r.marks, ['yeast']);
});

test('a long line is cut around its first highlight, the marks moved to match', () => {
  const line = `The payment retry twice then fail loud decision stands, and the Safari repeat failures are being chased on the quayside device lab phones this week, with the night shift rota still to confirm`;
  const a = line.indexOf('quayside');
  assert.ok(a > 100 && line.length > 180, 'the test line puts its match deep');
  const r = S.windowSnippet(line, [[a, a + 'quayside'.length]]);
  assert.ok(r.text.startsWith('…') && r.text.endsWith('…'), 'cut at both ends reads …');
  assert.ok(r.text.length <= 82, 'smaller than the row, so it is never clipped again');
  assert.deepEqual(r.ranges.map(([x, y]) => r.text.slice(x, y)), ['quayside'], 'the mark still marks the word');
  assert.ok(r.ranges[0][0] <= 36, 'the match sits near the start, inside the visible row');
});

test('a match at the very end still starts inside the row', () => {
  const line = `${'x'.repeat(150)} quayside`;
  const a = line.indexOf('quayside');
  const r = S.windowSnippet(line, [[a, a + 'quayside'.length]]);
  assert.ok(r.text.startsWith('…') && !r.text.endsWith('…'), 'cut at the start only');
  assert.deepEqual(r.ranges.map(([x, y]) => r.text.slice(x, y)), ['quayside']);
  assert.ok(r.ranges[0][0] + 'quayside'.length <= 82, 'the whole match inside the visible row');
});

test('short lines come back whole; no highlights shows the start', () => {
  assert.deepEqual(S.windowSnippet('The cart fails at payment', [[13, 17]]), { text: 'The cart fails at payment', ranges: [[13, 17]] });
  const long = 'x'.repeat(200);
  const r = S.windowSnippet(long, []);
  assert.equal(r.text, `${'x'.repeat(80)}…`);
  assert.deepEqual(r.ranges, []);
});

test('the panel’s shorter window keeps a deep match inside its narrow row', () => {
  const line = `The payment retry twice then fail loud decision stands, and the Safari repeat failures are being chased on the quayside device lab phones this week, with the night shift rota still to confirm`;
  const a = line.indexOf('quayside');
  const r = S.windowSnippet(line, [[a, a + 'quayside'.length]], 44, 14);
  assert.ok(r.text.startsWith('…') && r.text.endsWith('…'), 'cut at both ends reads …');
  assert.ok(r.text.length <= 46, 'shorter than the panel row');
  assert.deepEqual(r.ranges.map(([x, y]) => r.text.slice(x, y)), ['quayside']);
  assert.ok(r.ranges[0][0] <= 18, 'the match sits near the start, inside the narrow row');
});
