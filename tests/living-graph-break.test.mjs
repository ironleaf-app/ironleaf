// node --test tests/living-graph-break.test.mjs — break the living graph before it ships
// (8 Nov 2026). Tonight's break-it job on the living graph: private never shows however reached,
// kept-out folders hide, shapes, behaviour and clicks. For every fault a failing test first, then
// a fix at the cause. Made-up vaults only, never a real person's notes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-living-break-'));
let L;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const { mkdirSync, symlinkSync } = await import('node:fs');
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const n = (id, extra = {}) => ({ id, title: id.split('/').pop().replace(/\.md$/, ''), kind: 'note', ...extra });
const T0 = new Date(2026, 10, 8, 9, 0).getTime();

// Worst first: kept-out files show by default (8 Nov 2026, break job). A picture in a
// kept-out folder is still a point, and its thread still draws, until Show everything.
test('kept-out files hide by default like kept-out notes', () => {
  const index = new M.VaultIndex();
  index.setFiles(['Archive/pic.png', 'Work/pic2.png']);
  index.set('Work/Notes/Kick-off.md', '# Kick-off\n\nSee [[pic2.png]].\n', T0, 10);
  index.set('Archive/Old.md', '# Old\n\nSee [[pic.png]].\n', T0, 10);
  index.setQuiet(['Archive']);
  const graph = index.graph('');
  assert.equal(graph.nodes.find((x) => x.id === 'Archive/pic.png')?.quiet, true, 'a file in a kept-out folder is marked quiet');
  assert.equal(graph.nodes.find((x) => x.id === 'Work/pic2.png')?.quiet ?? false, false, 'a real file is not');
  const scoped = L.livingScope(graph.nodes, graph.links, { store: {} });
  assert.ok(!scoped.nodes.some((x) => x.id === 'Archive/pic.png'), 'the kept-out file leaves the default view');
  assert.ok(scoped.nodes.some((x) => x.id === 'Work/pic2.png'), 'the real file stays');
  const all = L.livingScope(graph.nodes, graph.links, { store: {}, showRest: true });
  assert.ok(all.nodes.some((x) => x.id === 'Archive/pic.png'), 'Show everything brings it back');
});

// Private never shows through the local graph, even when the caller hands unscoped
// nodes (the note links a private note; the private note must never be a point).
test('the local graph never holds a private note, scoped or not', () => {
  const nodes = [n('Work/A.md'), n('Private notes/Secret.md'), n('Work/B.md')];
  const links = [
    { source: 'Work/A.md', target: 'Private notes/Secret.md' },
    { source: 'Work/A.md', target: 'Work/B.md' },
  ];
  const sub = L.livingLocal(nodes, links, 'Work/A.md', 2, []);
  assert.ok(!sub.nodes.some((x) => x.id === 'Private notes/Secret.md'), 'the private neighbour never draws');
  assert.ok(sub.nodes.some((x) => x.id === 'Work/B.md'), 'the real neighbour stays');
  assert.ok(!sub.links.some((l) => l.source === 'Private notes/Secret.md' || l.target === 'Private notes/Secret.md'), 'no thread to what is not drawn');
  const centred = L.livingLocal(nodes, links, 'Private notes/Secret.md', 2, []);
  assert.deepEqual(centred, { nodes: [], links: [] }, 'centring on a private note draws nothing');
});

// A click selects at once (8 Nov 2026, the no-wait click model: the 500 ms hold made every
// click feel like lag). No held open, no waiting for a second tap: one click selects and fires, the
// double-click itself opens, so a slow double-click can never open a stray note first.
test('a click selects at once, with no waiting for a second tap', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(!engine.includes('pendingOpen'), 'no held open waits for the double-click beat');
  assert.ok(!/setTimeout\(\(\) => \{ this\.pendingOpen/.test(engine), 'no timer holds a click open');
  assert.ok(engine.includes('this.select(id, false);'), 'the tap selects on the way up, leaving the camera where it is');
  assert.ok(engine.includes('this.onOpen(id, false)'), 'the double-click itself opens in this tab');
});

// Typing elsewhere must not shake the settled page: a new note settles in gently,
// it never reheats the whole vault. First sight warms fully, deltas barely breathe.
test('a new note settles in without reheating the settled vault', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('prev.size === 0') || engine.includes('prev.size>0') || engine.includes('prev.size > 0'), 'first sight and deltas heat differently');
  assert.ok(!engine.includes('this.sim.alpha(sameIds ? 0.12 : 0.55)'), 'a delta with a newcomer never takes the full first-sight heat');
});

// A resize to nothing (the panel folded) never frames the vault tiny: the settled
// reframe waits for a real box, and unfolding frames what settled while folded.
test('folding mid-settle never frames the vault tiny', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('this.w < 2') && engine.includes('this.h < 2'), 'the engine knows a folded box');
  assert.ok(/if \(!this\.camTouched && this\.nodes\.length > 0 && this\.w >= 2/.test(engine) || /w >= 2 && .*reframe|reframe.*w >= 2/.test(engine) || (engine.includes('camTouched') && engine.includes('w >= 2')), 'the settle reframe waits for a real box');
});
