// node --test tests/canvas-navigation.test.mjs — moving around a canvas and what it shows far out
// (src/renderer/src/views/canvas/navigation.ts): what a wheel event means (trackpad scroll, pinch, a mouse wheel's notch),
// zooming around a point, eased moves that keep that point still, two-finger pinches, arrow-key steps, the levels of
// detail blending without a jump, and where group names go so they never sit on each other.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-canvas-navigation-'));
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/views/canvas/navigation.ts'), platform: 'node', output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  N = await import(pathToFileURL(path.join(work, 'n.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const wheel = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('a trackpad’s two-finger scroll pans both ways; Shift with a mouse wheel pans sideways', () => {
  assert.deepEqual(N.wheelIntent(wheel({ deltaX: 12.5, deltaY: -7 })), { kind: 'pan', dx: 12.5, dy: -7 });
  assert.deepEqual(N.wheelIntent(wheel({ deltaY: 100, shiftKey: true })), { kind: 'pan', dx: 100, dy: 0 });
  // Lines (some mice) become pixels.
  assert.deepEqual(N.wheelIntent(wheel({ deltaY: 3, deltaMode: 1 })), { kind: 'pan', dx: 0, dy: 48 });
});

test('a pinch (Ctrl+wheel with small steps) follows the fingers; a mouse notch with Ctrl zooms a fifth', () => {
  const pinch = N.wheelIntent(wheel({ deltaY: -4.5, ctrlKey: true }));
  assert.equal(pinch.kind, 'zoom');
  assert.equal(pinch.step, false);
  close(pinch.factor, Math.exp(0.045));
  const out = N.wheelIntent(wheel({ deltaY: 100, ctrlKey: true }));
  assert.equal(out.step, true);
  close(out.factor, 1 / 1.2);
  assert.equal(N.wheelIntent(wheel({ deltaY: -120, ctrlKey: true })).factor, 1.2);
  // At 150% display scaling a notch arrives as about 66.7 px: still one step.
  assert.equal(N.wheelIntent(wheel({ deltaY: 66.66667, ctrlKey: true })).step, true);
  // A pinch step is held to a sane amount.
  assert.ok(N.wheelIntent(wheel({ deltaY: -39.5, ctrlKey: true })).factor < 1.5);
});

test('zooming around a point keeps that point still, within the zoom limits', () => {
  const v = { x: 100, y: 50, k: 0.5 };
  const at = { x: 400, y: 300 };
  const z = N.zoomAround(v, 2, at);
  close(z.k, 1);
  close((at.x - v.x) / v.k, (at.x - z.x) / z.k);
  close((at.y - v.y) / v.k, (at.y - z.y) / z.k);
  assert.equal(N.zoomAround(v, 1000, at).k, N.ZOOM_MAX);
  assert.equal(N.zoomAround(v, 0.0001, at).k, N.ZOOM_MIN);
});

test('an eased move keeps the anchor point still all the way, and the zoom changes evenly', () => {
  const from = { x: 0, y: 0, k: 1 };
  const at = { x: 300, y: 200 };
  const to = N.zoomAround(from, 4, at);
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    const v = N.between(from, to, e, at);
    close((at.x - v.x) / v.k, 300, 1e-9);
    close((at.y - v.y) / v.k, 200, 1e-9);
  }
  close(N.between(from, to, 0.5, at).k, 2);
  assert.deepEqual(N.between(from, to, 1, at), to);
  close(N.easeOut(0), 0);
  close(N.easeOut(1), 1);
  assert.ok(N.easeOut(0.5) > 0.5);
});

test('two fingers: spreading them zooms in around the point between them; moving them together pans', () => {
  const start = { x: 0, y: 0, k: 1 };
  const v = N.pinchView(start, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 80, y: 100 }, { x: 120, y: 100 });
  close(v.k, 2);
  close((100 - v.x) / v.k, 100);
  const p = N.pinchView(start, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 140, y: 130 }, { x: 160, y: 130 });
  close(p.k, 1);
  close(p.x, 50);
  close(p.y, 30);
});

test('arrow keys: a short step, or most of a screen with Shift, the way the arrow points', () => {
  const s = { width: 1000, height: 600 };
  assert.deepEqual(N.arrowPan('ArrowRight', false, s), { dx: -90, dy: 0 });
  assert.deepEqual(N.arrowPan('ArrowLeft', false, s), { dx: 90, dy: 0 });
  assert.deepEqual(N.arrowPan('ArrowDown', true, s), { dx: 0, dy: -360 });
  assert.deepEqual(N.arrowPan('ArrowUp', true, s), { dx: 0, dy: 360 });
  assert.equal(N.arrowPan('a', false, s), null);
});

test('levels of detail: the whole card from the hand-over zoom up, the overview below it; names grow smoothly', () => {
  assert.equal(N.levels(0.5).detail, true);
  assert.equal(N.levels(N.OVERVIEW_BELOW).detail, true);
  assert.equal(N.levels(N.OVERVIEW_BELOW - 0.001).detail, false);
  assert.equal(N.levels(0.2).detail, false);
  // Group names: never under the smallest readable size on screen, natural size near full zoom, and no jumps.
  for (const k of [0.06, 0.1, 0.29, 0.5, 0.79, 1, 2]) assert.ok(N.LABEL_PX * k * N.levels(k).labelScale >= N.LABEL_MIN_PX - 1e-9);
  assert.equal(N.levels(1).labelScale, 1);
  // The styles' zoom: exact far out (the overview is drawn to it), in steps nearer in.
  assert.equal(N.styleZoom(0.2), 0.2);
  assert.equal(N.styleZoom(0.62), 0.6);
  assert.equal(N.styleZoom(2.5), 1);
  let last = N.LABEL_PX * 0.06 * N.levels(0.06).labelScale;
  for (let k = 0.06; k < 2; k += 0.01) {
    const px = N.LABEL_PX * k * N.levels(k).labelScale;
    assert.ok(Math.abs(px - last) < 0.2, `jump at ${k}`);
    last = px;
  }
});

test('group names go above their group when there’s room, run right only until another card, and never overlap', () => {
  // Two groups stacked with a small gap, and a card to the right of the top group's name.
  const top = { id: 'top', x: 0, y: 0, width: 340, height: 300, natural: 120 };
  const below = { id: 'below', x: 0, y: 420, width: 340, height: 400, natural: 120 };
  const card = { id: 'c', x: 200, y: -60, width: 300, height: 40 };
  const member = { id: 'm', x: 24, y: 24, width: 300, height: 90 };
  const nodes = [top, below, card, member];
  // Full size: both above; the top one stops short of the card.
  const full = N.fitGroupLabels([top, below], nodes, 1);
  assert.equal(full.get('top').place, 'above');
  assert.ok(full.get('top').max <= 200 - 8);
  assert.equal(full.get('below').place, 'above');
  // Far out (the names grow relative to the canvas): the lower group's name has no room in the 120-unit gap, so it
  // goes inside its corner; nothing overlaps.
  const far = N.fitGroupLabels([top, below], nodes, 0.18);
  assert.equal(far.get('below').place, 'inside');
  // A tiny group with no room anywhere shows no name rather than a cut-off one.
  const tiny = { id: 't', x: 0, y: 900, width: 40, height: 20, natural: 120 };
  assert.equal(N.fitGroupLabels([tiny], [tiny, below], 0.2).get('t').place, 'none');
  // A group inside a bigger group isn't blocked by it.
  const outer = { id: 'o', x: -100, y: -200, width: 900, height: 900, natural: 80 };
  assert.equal(N.fitGroupLabels([top], [outer, top], 1).get('top').place, 'above');
});
