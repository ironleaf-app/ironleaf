// node --test tests/canvas-geometry.test.mjs — the canvas's geometry (src/renderer/src/views/canvas/geometry.ts):
// snapping to other cards and the grid with guide lines, resizing from every handle (Shift keeps proportions, never
// below the minimum), several cards resized as one, lining up and spacing out, and lines drawn three ways.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-canvas-geometry-'));
let G;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/views/canvas/geometry.ts'), platform: 'node', output: { file: path.join(work, 'g.mjs'), format: 'esm' }, logLevel: 'silent' });
  G = await import(pathToFileURL(path.join(work, 'g.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('moving snaps to another card’s edge or centre (with a guide), else to the grid', () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };
  const other = { x: 300, y: 200, width: 120, height: 60 };
  // Dragged so its left edge is 3 px off the other's left edge: lined up exactly, a vertical guide.
  const s = G.snapMove(box, 297, 17, [other], 6, true);
  assert.equal(s.dx, 300);
  assert.equal(s.dy, 20);
  assert.equal(s.guides.length, 1);
  assert.equal(s.guides[0].x1, 300);
  // Centres line up too.
  const c = G.snapMove(box, 308, 500, [other], 6, false);
  assert.equal(c.dx + 50, 360);
  // Nothing near: the grid; grid off: as dragged.
  assert.deepEqual([G.snapMove(box, 33, 47, [other], 6, true).dx, G.snapMove(box, 33, 47, [other], 6, true).dy], [40, 40]);
  assert.deepEqual([G.snapMove(box, 33, 47, [], 6, false).dx, G.snapMove(box, 33, 47, [], 6, false).dy], [33, 47]);
});

test('resizing from every handle; minimum sizes; Shift keeps proportions; edges snap', () => {
  const r = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(G.resizeRect(r, 'se', 40, 20).rect, { x: 100, y: 100, width: 240, height: 120 });
  assert.deepEqual(G.resizeRect(r, 'nw', 40, 20).rect, { x: 140, y: 120, width: 160, height: 80 });
  assert.deepEqual(G.resizeRect(r, 'e', 40, 999).rect, { x: 100, y: 100, width: 240, height: 100 });
  assert.deepEqual(G.resizeRect(r, 'n', 0, -30).rect, { x: 100, y: 70, width: 200, height: 130 });
  // Never smaller than the minimum, the opposite edge staying put.
  const tiny = G.resizeRect(r, 'w', 500, 0).rect;
  assert.equal(tiny.width, G.MIN_W);
  assert.equal(tiny.x + tiny.width, 300);
  // Shift: proportions kept (2:1), from a corner and from an edge.
  const k = G.resizeRect(r, 'se', 100, 0, { keepRatio: true }).rect;
  assert.equal(k.width / k.height, 2);
  const e = G.resizeRect(r, 'e', 100, 0, { keepRatio: true }).rect;
  assert.deepEqual([e.width, e.height], [300, 150]);
  // An edge snaps to another card's edge.
  const s = G.resizeRect(r, 'e', 97, 0, { others: [{ x: 400, y: 0, width: 50, height: 50 }], threshold: 6 });
  assert.equal(s.rect.x + s.rect.width, 400);
  assert.equal(s.guides.length, 1);
  // To the grid.
  assert.equal(G.resizeRect(r, 'e', 33, 0, { grid: true }).rect.width, 240);
});

test('several cards resized as one keep their places in the box', () => {
  const items = [{ id: 'a', x: 0, y: 0, width: 100, height: 100 }, { id: 'b', x: 200, y: 100, width: 100, height: 100 }];
  const from = G.bounds(items);
  assert.deepEqual(from, { x: 0, y: 0, width: 300, height: 200 });
  const out = G.scaleInto(items, from, { x: 0, y: 0, width: 600, height: 400 });
  assert.deepEqual(out.map((n) => [n.x, n.y, n.width, n.height]), [[0, 0, 200, 200], [400, 200, 200, 200]]);
});

test('lining up and spacing out', () => {
  const items = [{ id: 'a', x: 0, y: 0, width: 100, height: 40 }, { id: 'b', x: 150, y: 90, width: 50, height: 40 }, { id: 'c', x: 400, y: 30, width: 100, height: 80 }];
  assert.deepEqual(G.align(items, 'left').map((n) => n.x), [0, 0, 0]);
  assert.deepEqual(G.align(items, 'right').map((n) => n.x + n.width), [500, 500, 500]);
  assert.deepEqual(G.align(items, 'middle').map((n) => n.y + n.height / 2), [65, 65, 65]);
  const d = G.distribute(items, 'x');
  // Equal gaps: (500 - 250) / 2 = 125.
  assert.deepEqual(d.map((n) => n.x), [0, 225, 400]);
});

test('lines curved, straight or elbowed, with a middle for the label', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 100 };
  assert.match(G.edgePath(a, 'right', b, 'left').d, /^M 0 0 C /);
  assert.deepEqual(G.edgePath(a, 'right', b, 'left', 'straight'), { d: 'M 0 0 L 200 100', mid: { x: 100, y: 50 } });
  const el = G.edgePath(a, 'right', b, 'left', 'elbow');
  assert.equal(el.d, 'M 0 0 L 24 0 L 100 0 L 100 100 L 176 100 L 200 100');
  assert.deepEqual(el.mid, { x: 100, y: 50 });
  assert.equal(G.facing({ x: 0, y: 0, width: 100, height: 100 }, { x: 500, y: 60 }), 'right');
  const v = G.viewFor({ x: 0, y: 0, width: 1000, height: 500 }, { width: 1160, height: 660 });
  assert.equal(v.k, 1);
});

test('a board opens readable: all of it when its words can be read, else from its top-left corner at a readable size', () => {
  // Small enough: the same as Show everything.
  const small = { x: 0, y: 0, width: 600, height: 400 };
  assert.deepEqual(G.openingView(small, { width: 1200, height: 800 }), G.viewFor(small, { width: 1200, height: 800 }));
  // A wide portfolio in a narrow pane: fitting it would be ~0.26; it opens at 0.5, its left edge 80 px in, its top under the bar.
  const wide = { x: -100, y: 50, width: 1800, height: 500 };
  const v = G.openingView(wide, { width: 640, height: 700 });
  assert.equal(v.k, 0.5);
  assert.equal(v.x + wide.x * v.k, 80);
  assert.ok(v.y + wide.y * v.k >= 96);
});

test('drifted away: only once no card shows on the surface at all (a sliver at the very edge counts as gone)', () => {
  const cards = [{ x: 0, y: 0, width: 200, height: 100 }, { x: 400, y: 300, width: 200, height: 100 }];
  const surface = { width: 1000, height: 700 };
  assert.equal(G.driftedAway(cards, { x: 0, y: 0, k: 1 }, surface), false);
  // Panned far to the right of everything.
  assert.equal(G.driftedAway(cards, { x: -3000, y: 0, k: 1 }, surface), true);
  // Only 10 px of the last card peeks in at the left edge: inside the margin, so it counts as gone.
  assert.equal(G.driftedAway(cards, { x: -590, y: 0, k: 1 }, surface), true);
  // 60 px of it in view: still there.
  assert.equal(G.driftedAway(cards, { x: -540, y: 0, k: 1 }, surface), false);
  // Zoomed far in on empty space between the cards.
  assert.equal(G.driftedAway(cards, { x: -300 * 8, y: -200 * 8, k: 8 }, surface), true);
  // No cards: nothing to come back to.
  assert.equal(G.driftedAway([], { x: -3000, y: 0, k: 1 }, surface), false);
});
