// node --test tests/polish.test.mjs — the polish round (29 Oct 2026, the plan items 1-3): a project card
// says its health once (the pill, not again in its one line), the Tasks search placeholder fits its box, and the
// project page header keeps layout and progress in its "…" menu with the lifecycle thin and only off Active.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/projectLook.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'look.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'look.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('a card line keeps only what its health pill does not say', () => {
  assert.deepEqual(L.cardLineWords({ words: '98% · at risk', tone: 'warn' }, 'at risk'), { words: '98%', tone: 'none' });
  assert.deepEqual(L.cardLineWords({ words: 'at risk · Design and pricing', tone: 'warn' }, 'at risk'), { words: 'Design and pricing', tone: 'none' });
  assert.equal(L.cardLineWords({ words: 'at risk', tone: 'warn' }, 'at risk'), null, 'the health alone leaves no line');
  assert.deepEqual(L.cardLineWords({ words: 'Day 4 alcohol-free', tone: 'ok' }, 'at risk'), { words: 'Day 4 alcohol-free', tone: 'ok' });
  assert.deepEqual(L.cardLineWords({ words: '71 days to the pop-up', tone: 'none' }, 'on track'), { words: '71 days to the pop-up', tone: 'none' });
  assert.deepEqual(L.cardLineWords({ words: '62% · at risk', tone: 'warn' }, undefined), { words: '62% · at risk', tone: 'warn' }, 'no pill, no stripping');
});

test('the Tasks search placeholder fits, and the project header puts layout and progress in its menu', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.match(tasks, /<ListFind id="tasks"/, 'Tasks walks through the shared Find (t262)');
  assert.doesNotMatch(tasks, /placeholder="Find/, 'no box of its own');
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.match(bar, /placeholder="Find in this list"/, 'the shared words fit the one box');
  assert.match(read('src/renderer/src/styles/page-tabs.css'), /\.pt-find-box \{[^}]*max-width: 320px/, 'the box holds the shared words');
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.match(page, /layoutMenuItems\(view, edit\)/, 'the layout choices are menu items');
  assert.match(page, /'Set progress'|'Change progress'/, 'setting progress is a menu item');
  assert.doesNotMatch(page, /<LayoutPill/, 'no layout chip in the header');
  assert.doesNotMatch(page, /<ProgressControl/, 'no Set progress control in the header');
  // The w2a head (round 2: the mock-up's title row carries the pill and the one-line summary, not the old meta
  // line; 5 Nov 2026, the vault folio: the main page's hero became the title block, and the phead carries the
  // facts panel's head instead).
  assert.match(page, /w2a-phead/, 'the facts head carries the pill');
  assert.match(page, /<div className="nv-hero"/, 'the hero heads the folio again (v9)');
  assert.match(page, /w2a-readmore/, 'a long summary reads as its lead until asked');
  const life = read('src/renderer/src/views/project/Lifecycle.tsx');
  assert.match(life, /current === 'active'\) return null/, 'an Active project shows no lifecycle bar');
  assert.match(life, /is-thin/, 'the lifecycle bar is a thin line when it shows');
});
