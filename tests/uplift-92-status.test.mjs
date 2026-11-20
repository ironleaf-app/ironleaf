// node --test tests/uplift-92-status.test.mjs — the 9.2 uplift's one reading of a status or health word
// (F4, F17, F25, F30, F42, F57, F58, F73, F109, F136, F149, F160, F161): whole words in lib/projectLook.ts
// statusReading, never each surface's own substring test, so "Coffee catch-up" is not at risk, "Undone" is not
// done, "Not done" is not finished, and an Australian 03/04/2026 is 3 Apr, never the US 4 Mar. Pure logic is
// checked as it is; the screens are guarded by the shared reader they call, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-status-'));
let L;
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/projectLook.ts'), platform: 'node', output: { file: path.join(work, 'look.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'look.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/recordTone.ts'), platform: 'node', output: { file: path.join(work, 'tone.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'tone.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('one status reading: whole words, never substrings (F4, F30, F58, F73)', () => {
  assert.deepEqual(L.statusReading('off track'), { state: 'off-track', tone: 'bad' });
  assert.deepEqual(L.statusReading('at-risk'), { state: 'at-risk', tone: 'warn' });
  assert.deepEqual(L.statusReading('on track'), { state: 'on-track', tone: 'ok' });
  assert.deepEqual(L.statusReading('done'), { state: 'done', tone: 'ok' });
  assert.deepEqual(L.statusReading('Waiting on client'), { state: 'waiting', tone: 'none' });
  assert.deepEqual(L.statusReading('blocked on Sam'), { state: 'waiting', tone: 'none' }, 'waiting ahead of bad');
  assert.deepEqual(L.statusReading('blocked'), { state: 'off-track', tone: 'bad' });
  assert.deepEqual(L.statusReading('Coffee catch-up'), { state: 'none', tone: 'none' }, '"off" in "coffee" is not off track');
  assert.deepEqual(L.statusReading('Broken-Christmas'), { state: 'off-track', tone: 'bad' }, 'whole-word "broken" is bad, never ON TRACK via "ok"');
  assert.deepEqual(L.statusReading('Offers out'), { state: 'none', tone: 'none' }, '"off" in "offers" is not red');
  assert.deepEqual(L.statusReading('Undone'), { state: 'none', tone: 'none' }, '"done" in "undone" is not done');
  assert.deepEqual(L.statusReading('Homework'), { state: 'none', tone: 'none' }, '"work" in "homework" is not running');
  assert.deepEqual(L.statusReading('Not done'), { state: 'none', tone: 'none' }, 'a negated claim reads as nothing');
  assert.deepEqual(L.statusReading('Not at risk'), { state: 'none', tone: 'none' });
  assert.deepEqual(L.statusReading('High'), { state: 'none', tone: 'none' }, 'a status of High is not amber; a level is levelTone');
  assert.deepEqual(L.statusReading('Held over'), { state: 'none', tone: 'none' }, 'held over is open, never done');
  assert.deepEqual(L.statusReading('Passed'), { state: 'done', tone: 'ok' });
  assert.deepEqual(L.statusReading('Pending'), { state: 'waiting', tone: 'none' });
  assert.deepEqual(L.statusReading('In review'), { state: 'none', tone: 'none' });
  assert.deepEqual(L.statusReading(''), { state: 'none', tone: 'none' });
  assert.deepEqual(L.statusReading(undefined), { state: 'none', tone: 'none' });
});

test('healthTone follows the one reading; levelTone keeps levels apart (F58, F73)', () => {
  assert.equal(L.healthTone('off track'), 'bad');
  assert.equal(L.healthTone('Offers out'), 'none');
  assert.equal(L.healthTone('done'), 'ok', 'a done health reads calm, as Projects does');
  assert.equal(L.levelTone('High'), 'warn');
  assert.equal(L.levelTone('Critical'), 'bad');
  assert.equal(L.levelTone('Medium'), 'none');
  assert.equal(L.levelTone('Low'), 'none');
});

test('Australian day-first dates, never the US reading (F25)', () => {
  assert.equal(L.readDate('03/04/2026'), new Date(2026, 3, 3).getTime(), '3 Apr, never 4 Mar');
  assert.equal(L.readDate('27/10/2026'), new Date(2026, 9, 27).getTime());
  assert.equal(L.readDate('2026/10/27'), new Date(2026, 9, 27).getTime(), 'year-first still reads');
  assert.equal(L.readDate('2026-10-27'), new Date(2026, 9, 27).getTime(), 'ISO unchanged');
  assert.equal(L.readDate('27 Oct 2026'), new Date(2026, 9, 27).getTime(), 'day month unchanged');
  assert.equal(L.readDate('31/02/2026'), null, 'not a real day: nothing, never the wrong day');
  assert.equal(L.readDate('13/13/2026'), null);
  assert.equal(L.readDate('10/27/2026'), null, 'month-first input has no day-first reading: nothing');
});

test('the effective health every card weighs (F17)', () => {
  assert.equal(L.effectiveHealth({ health: 'on track', lateMine: 2 }), 'At risk');
  assert.equal(L.effectiveHealth({ health: 'on track', lateMine: 0, due: '2020-01-01', status: 'active' }), 'Overdue');
  assert.equal(L.effectiveHealth({ health: 'at risk', lateMine: 0 }), 'at risk');
  assert.deepEqual(L.healthPill({ health: 'on track', lateMine: 1 }), { words: 'At risk', tint: 'slate', attention: false });
  assert.deepEqual(L.healthPill({ health: undefined, lateMine: 0 }), { words: 'Active', tint: 'slate', attention: false });
});

test('record tones read whole words (F160)', () => {
  assert.equal(R.toneOf('Translate the brief'), 'none', '"late" in "translate" is not late');
  assert.equal(R.toneOf('Highlight for review'), 'none', '"high" in "highlight" is not high');
  assert.equal(R.toneOf('Late'), 'bad');
  assert.equal(R.toneOf('Overdue'), 'bad');
  assert.equal(R.toneOf('At risk'), 'warn');
  assert.equal(R.toneOf('Risky business'), 'warn');
  assert.equal(R.toneOf('Done'), 'ok');
  assert.equal(R.toneOf('On track'), 'ok');
  assert.equal(R.toneOf('High', 'impact'), 'bad');
  assert.equal(R.toneOf('Highlight', 'impact'), 'none');
  assert.equal(R.toneOf('Medium', 'impact'), 'warn');
  assert.equal(R.isDoneRecord({ fields: { status: 'Done for now' } }), true);
  assert.equal(R.isDoneRecord({ fields: { status: 'Doner run' } }), false, 'a status starting "Done…" is not done');
  assert.equal(R.isDoneRecord({ fields: { done: true, status: 'Prep' } }), true);
});

test('every tone surface reads through the shared readers', () => {
  const nav = read('src/renderer/src/panels/Navigator.tsx');
  assert.ok(nav.includes('statusReading(r.hint).state'), 'Navigator hints read the one reading (F30)');
  assert.doesNotMatch(nav, /done\|complete\|finished\/i\.test\(r\.hint\)/);
  const peek = read('src/renderer/src/components/Peek.tsx');
  assert.ok(peek.includes('levelTone(r.level)'), 'Peek levels read levelTone (F58)');
  assert.ok(peek.includes('statusReading(r.status).state'), 'Peek milestones open from the record (F136)');
  assert.doesNotMatch(peek, /passed\|held\/i/);
  assert.doesNotMatch(peek, /risk\|behind\|today\|high/);
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes('\\bidea\\b') && home.includes('\\bplan(?:ning)?\\b'), 'board columns match whole words (F109)');
  assert.doesNotMatch(home, /if \(\/idea\/\.test/);
  const capture = read('src/renderer/src/capture/CaptureBox.tsx');
  assert.ok(capture.includes('isFinished(a.status)'), 'the project picker sorts by the finished rule (F149)');
  assert.doesNotMatch(capture, /\/done\/i\.test\(a\.status/);
  const tiles = read('src/renderer/src/views/modules/work/ProjectWorkTiles.tsx');
  assert.ok(tiles.includes('statusReading(w).tone'), 'tiles fall back to the one reading (F42)');
  const weekly = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  assert.ok(weekly.includes("healthTone } from '../../../lib/projectLook'"), 'Weekly reads the shared healthTone (F42)');
  assert.doesNotMatch(weekly, /\/on track\/i\.test\(h\)/);
  assert.ok(read('src/renderer/src/views/AreaPage.tsx').includes('healthPill(c).words'), 'area cards weigh the effective health (F17)');
  assert.ok(read('src/renderer/src/views/modules/life/GoalsPage.tsx').includes("s === 'Achieved' || s === 'On track'"), 'goal tones match exactly (F161)');
  assert.ok(read('src/renderer/src/views/modules/w3b/Goals87.tsx').includes("s === 'Achieved' || s === 'On track'"), 'goal tones match exactly (F161)');
  assert.ok(read('src/renderer/src/views/workspace/recordParts.tsx').includes("export { isDoneRecord, toneOf } from '../../lib/recordTone'"), 'record tones live in the pure module (F160)');
});
