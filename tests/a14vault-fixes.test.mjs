// node --test tests/a14vault-fixes.test.mjs — the 10.0 fifth-round vault fixes, one guard per finding
// (inputs/a14vault-findings.md H1-H2): one zero rule for count chips and filters across Projects, People and the
// note foot — a zero stays off, like a badge, through the one shared showCount helper (H1); the Inbox header button
// names which note it opens (H2). Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-a14vault-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as words from ${JSON.stringify(path.join(root, 'src/shared/words.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ words: W } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── H1: one zero rule through the one helper ────────────────────────────────────────────────────────────────

test('H1: showCount stays off at zero, null and missing — on past zero', () => {
  assert.equal(W.showCount(0), false, 'a zero stays off, like a badge');
  assert.equal(W.showCount(null), false, 'a tab with nothing to count stays off');
  assert.equal(W.showCount(undefined), false, 'a missing count stays off');
  assert.equal(W.showCount(1), true);
  assert.equal(W.showCount(8), true);
});

test('H1: Projects home filters gate through the one helper', () => {
  const src = noComments(read('src/renderer/src/views/ProjectsHome.tsx'));
  assert.ok(src.includes('{showCount(n) ? <span className="n">{n}</span> : null}'), 'the one gate on all five');
  assert.ok(!src.includes('{n > 0 ? <span className="n">'), 'no inline zero gate left');
  assert.ok(src.includes("from '../../../shared/words'"), 'the shared helper, not a local copy');
});

test('H1: the folio counts gate through the one helper', () => {
  // Direction C (5 Nov 2026): the tab bar is gone, so its counts are; the chips that still count keep the one gate.
  const src = noComments(read('src/renderer/src/views/project/ProjectTabs87.tsx'));
  assert.ok(!src.includes('w2a-ptabs'), 'no tab bar remains');
  assert.ok(src.includes('{showCount(k.n) ?'), 'chip counts hide their zeros through the one helper');
  assert.ok(src.includes("from '../../../../shared/words'"), 'the shared helper, not a local copy');
});

test('H1: People filters hide their zeros through the one helper', () => {
  const src = noComments(read('src/renderer/src/views/PeoplePage.tsx'));
  assert.ok(src.includes('showCount(n)'), 'the filter count is gated');
  assert.ok(!src.includes('{words} <span className="n">{filterCount(id)}</span>'), 'the always-on span is gone');
  assert.ok(src.includes("from '../../../shared/words'"), 'the shared helper, not a local copy');
});

test('H1: the note foot hides its zeros through the one helper', () => {
  const src = noComments(read('src/renderer/src/components/NoteFoot.tsx'));
  const counted = src.split('\n').filter((l) => l.includes('foot-count'));
  assert.ok(counted.length > 0, 'the foot still counts its tabs');
  for (const line of counted) assert.ok(line.includes('showCount('), `gated, never always-on: ${line.trim().slice(0, 80)}`);
  assert.ok(src.includes("from '../../../shared/words'"), 'the shared helper, not a local copy');
});

// ── H2: the Inbox header button names which note it opens ──────────────────────────────────────────────────

test('H2: the Inbox header button reads Inbox note, never The note', () => {
  const src = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(src.includes('Inbox note'), 'the button names which note it opens');
  assert.ok(src.includes("A.openPath('Inbox.md'"), 'it still opens the Inbox note');
  assert.ok(src.includes('title="The Inbox note, as written"'), 'the tooltip already says it');
  assert.doesNotMatch(src, />\s*The note\s*</, 'no The note button label survives');
  assert.ok(src.includes('+ Capture'), 'Capture stays beside it');
});
