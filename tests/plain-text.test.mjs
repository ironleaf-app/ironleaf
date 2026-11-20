// node --test tests/plain-text.test.mjs — plain words outside a note (src/shared/plain-text.ts; 29 Oct 2026,
// SPEC section A: no raw markdown in summaries, cards or rows).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-plain-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/plain-text.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('bold in a summary reads as words', () => {
  assert.equal(M.plainText('Next: **Telstra invoice due Mon 26 Oct**'), 'Next: Telstra invoice due Mon 26 Oct');
});

test('links, images, headings, lists, quotes, code and tables read as words', () => {
  assert.equal(M.plainText('See [the quote](Quotes/q.pdf) and [[Harbour Fit-out]]'), 'See the quote and Harbour Fit-out');
  assert.equal(M.plainText('[[Projects/Store|Studio Upgrade]]'), 'Studio Upgrade');
  assert.equal(M.plainText('![logo](logo.png) Logo'), 'Logo');
  assert.equal(M.plainText('## Heading\n- [ ] Do `the thing` ~~later~~'), 'Heading Do the thing later');
  assert.equal(M.plainText('> quoted *words*'), 'quoted words');
  assert.equal(M.plainText('| 19 Oct | Tessaly pricing ends | planned |'), '19 Oct · Tessaly pricing ends · planned');
  assert.equal(M.plainText('a <mark class="nv-green">marked</mark> line'), 'a marked line');
});

test('round 2: HTML comments and raw links never show', () => {
  assert.equal(M.plainText('<!-- the host app keeps the part below up to date --> The plan'), 'The plan');
  assert.equal(M.plainText('<!-- only a comment -->'), '');
  assert.equal(M.plainText('a <!-- hidden\nstill hidden --> b'), 'a b');
  assert.equal(M.plainText('See https://example.com/x and <https://example.com/y>'), 'See and');
  assert.equal(M.plainText('Open [the plan](https://example.com) now'), 'Open the plan now');
});

// n4-minutes-pdf fault 1 (6 Nov 2026, the branded PDF printed "[[David Kim]]" raw): cards and rows read
// aliases, paths and #heading forms as words, through the same shared cleaner.
test('n4: aliases, paths and headings read as words', () => {
  assert.equal(M.plainText('[[People/David Kim]] is coming'), 'David Kim is coming');
  assert.equal(M.plainText('See [[Icing#Method]] and [[#Method]] below'), 'See Icing and Method below');
  assert.equal(M.plainText('[[Icing|the icing]] is ready'), 'the icing is ready');
});

test('plain words stay as they are; empty stays empty', () => {
  assert.equal(M.plainText('Ring the mill at 9'), 'Ring the mill at 9');
  assert.equal(M.plainText(''), '');
  assert.equal(M.plainText(null), '');
  assert.equal(M.plainText(undefined), '');
  assert.equal(M.hasMarks('**bold**'), true);
  assert.equal(M.hasMarks('plain words'), false);
});
