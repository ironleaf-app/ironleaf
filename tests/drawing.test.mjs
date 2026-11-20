// node --test tests/drawing.test.mjs — drawings (src/shared/drawing.ts; 21 Oct 2026, gap G23): a .nvdraw file read and
// written back unchanged (every kind of element, pen pressure, a key this version doesn't use), what can't be read left
// out and counted, words that aren't a drawing refused, the geometry the drawing surface uses (what the pointer is over,
// a drag-to-select, moving, Shift's square and 15° lines), a pressure-shaped stroke, the SVG an export writes (its text
// made safe), undo and redo, and a drawing on a canvas as a plain JSON Canvas file node, so the .canvas stays valid.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-drawing-'));
let D;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/drawing.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'drawing.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'drawing.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A sketch of a bakery's counter layout, with one of everything. */
const SKETCH = () => [
  { id: 's1', kind: 'stroke', colour: 'ink', width: 4, points: [[10, 10, 0.2], [20, 14, 0.6], [34, 22, 1], [50, 30, 0.4]] },
  { id: 'r1', kind: 'rect', x: 100, y: 40, w: 160, h: 90, colour: 'blue', width: 2, fill: true },
  { id: 'e1', kind: 'ellipse', x: 300, y: 40, w: 80, h: 80, colour: 'green', width: 2 },
  { id: 'a1', kind: 'arrow', x1: 260, y1: 85, x2: 300, y2: 80, colour: 'red', width: 2 },
  { id: 'l1', kind: 'line', x1: 0, y1: 200, x2: 400, y2: 200, colour: '#7a5c3e', width: 1.5 },
  { id: 't1', kind: 'text', x: 110, y: 60, text: 'Till 1\n<b> & “r”', size: 18, colour: 'violet' },
];

test('a drawing is written and read back unchanged, keys it doesn’t use kept', () => {
  const text = D.serializeDrawing({ elements: SKETCH(), extra: { background: 'paper', by: 'another app' }, version: 1 });
  const json = JSON.parse(text);
  assert.equal(json.type, 'neuralvault-drawing');
  assert.equal(json.version, 1);
  assert.equal(json.background, 'paper');
  assert.equal(json.elements.length, 6);
  // One element a line: the file reads and compares well.
  assert.equal(text.split('\n').filter((l) => l.trim().startsWith('{"id"')).length, 6);
  const back = D.parseDrawing(text);
  assert.equal(back.skipped, 0);
  assert.deepEqual(back.elements, SKETCH());
  assert.deepEqual(back.extra, { background: 'paper', by: 'another app' });
  // And again: the same words.
  assert.equal(D.serializeDrawing(back), text);
});

test('numbers are kept to two places, pressure to three, and a box drawn backwards is turned round', () => {
  const d = D.parseDrawing(JSON.stringify({ type: 'neuralvault-drawing', version: 1, elements: [{ id: 'x', kind: 'stroke', colour: 'ink', width: 3, points: [[1.23456, 2.34567, 0.123456]] }, { id: 'b', kind: 'rect', x: 50, y: 50, w: -20, h: -10, colour: 'ink', width: 2 }] }));
  const again = D.parseDrawing(D.serializeDrawing(d));
  assert.deepEqual(again.elements[0].points, [[1.23, 2.35, 0.123]]);
  assert.deepEqual([again.elements[1].x, again.elements[1].y, again.elements[1].w, again.elements[1].h], [30, 40, 20, 10]);
});

test('what can’t be read is left out and counted; words that aren’t a drawing are refused', () => {
  const d = D.parseDrawing(JSON.stringify({ elements: [{ kind: 'stroke', points: [] }, { kind: 'blob' }, null, { kind: 'text', x: 1, y: 2, text: '   ' }, { id: 'ok', kind: 'line', x1: 0, y1: 0, x2: 5, y2: 5, color: '#ABC' }, { id: 'ok', kind: 'line', x1: 1, y1: 1, x2: 2, y2: 2 }] }));
  assert.equal(d.skipped, 4);
  assert.equal(d.elements.length, 2);
  assert.equal(d.elements[0].colour, '#aabbcc');
  assert.equal(d.elements[1].colour, 'ink');
  // Two elements with one id: the second gets its own.
  assert.notEqual(d.elements[0].id, d.elements[1].id);
  assert.deepEqual(D.parseDrawing('').elements, []);
  assert.deepEqual(D.parseDrawing('﻿  \n').elements, []);
  assert.throws(() => D.parseDrawing('{ not json'), D.DrawingProblem);
  assert.throws(() => D.parseDrawing('[1,2]'), /isn’t a drawing/);
  assert.throws(() => D.parseDrawing('{"nodes":[],"edges":[]} '.replace('{', '{"type":"canvas",')), /isn’t an Ironleaf drawing/);
  assert.equal(D.cleanColour('RED'), 'red');
  assert.equal(D.cleanColour('url(javascript:x)'), 'ink');
  assert.ok(D.isDrawingPath('Plans/Shop floor.nvdraw'));
  assert.ok(!D.isDrawingPath('Plans/Shop floor.canvas'));
  assert.equal(JSON.parse(D.newDrawingText()).elements.length, 0);
});

test('what the pointer is over, a drag-to-select, and moving', () => {
  const els = SKETCH();
  const at = (x, y) => D.elementAt(els, x, y, 3)?.id ?? null;
  assert.equal(at(20, 14), 's1');
  assert.equal(at(180, 120), 'r1', 'inside a filled box');
  assert.equal(at(340, 113), null, 'inside an empty ellipse is empty');
  assert.equal(at(380, 80), 'e1', 'on its line');
  assert.equal(at(200, 200), 'l1');
  assert.equal(at(280, 82.5), 'a1');
  assert.equal(at(115, 70), 't1', 'the label is on top of the box');
  assert.equal(at(600, 600), null);
  const inside = D.elementsInBox(els, { x: 90, y: 30, w: 300, h: 110 }).map((e) => e.id).sort();
  assert.deepEqual(inside, ['a1', 'e1', 'r1', 't1']);
  // Dragged up and to the left: the same box.
  assert.deepEqual(D.elementsInBox(els, { x: 390, y: 140, w: -300, h: -110 }).map((e) => e.id).sort(), inside);
  const moved = els.map((e) => D.moveElement(e, 10, -5));
  assert.deepEqual(moved[0].points[0], [20, 5, 0.2]);
  assert.deepEqual([moved[1].x, moved[1].y], [110, 35]);
  assert.deepEqual([moved[3].x1, moved[3].y1, moved[3].x2, moved[3].y2], [270, 80, 310, 75]);
  assert.deepEqual(els[0].points[0], [10, 10, 0.2], 'the original is never changed');
  const b = D.drawingBounds(els);
  assert.ok(b.x <= 0 && b.y <= 10 && b.x + b.w >= 400 && b.y + b.h >= 200);
  assert.equal(D.drawingBounds([]), null);
});

test('Shift draws squares and holds lines to 15°; points too close together aren’t kept', () => {
  assert.deepEqual(D.boxFrom(10, 10, 40, 20, true), { x: 10, y: 10, w: 30, h: 30 });
  assert.deepEqual(D.boxFrom(10, 10, -20, 0, true), { x: -20, y: -20, w: 30, h: 30 });
  const [x, y] = D.snapAngle(0, 0, 100, 4);
  assert.ok(Math.abs(y) < 0.001 && Math.abs(x - 100.08) < 0.01);
  const [x2, y2] = D.snapAngle(0, 0, 50, 52);
  assert.ok(Math.abs(x2 - y2) < 0.01, '45°');
  let pts = D.addPoint([], 0, 0, 0.5);
  pts = D.addPoint(pts, 0.2, 0.1, 0.9);
  assert.equal(pts.length, 1);
  pts = D.addPoint(pts, 5, 5, 2);
  assert.deepEqual(pts[1], [5, 5, 1], 'pressure kept between 0 and 1');
});

test('a stroke is one outline, wider where the pen pressed harder', () => {
  const d = D.strokeOutline([[0, 0, 0.1], [20, 0, 0.1], [40, 0, 0.1], [60, 0, 0.1], [80, 0, 1], [100, 0, 1], [120, 0, 1], [140, 0, 1]], 10);
  assert.match(d, /^M[-\d. ]+(Q[-\d. ]+)*L[-\d. ]+A[-\d. ]+(Q[-\d. ]+)*L[-\d. ]+A[-\d. ]+Z$/);
  // Half-widths read from the left side's points: thin at the start, full at the end.
  const ys = [...d.matchAll(/[MQL]([-\d.]+) ([-\d.]+)/g)].map((m) => Math.abs(Number(m[2])));
  assert.ok(ys[0] < 2.5, `thin start (${ys[0]})`);
  assert.ok(Math.max(...ys) > 4, 'full at the end');
  assert.match(D.strokeOutline([[5, 5, 0.5]], 6), /^M[\d. ]+a/, 'a dot is a circle');
});

test('as SVG: named colours as the look’s shades or tokens, text made safe', () => {
  const light = D.drawingToSvg(SKETCH(), { look: 'light', background: '#ffffff', title: 'Counter <layout>' });
  assert.match(light, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="[-\d. ]+" width="\d+" height="\d+">/);
  assert.ok(light.includes(`fill="${D.DRAW_PALETTE.light.violet}"`));
  assert.ok(light.includes('stroke="#7a5c3e"'));
  assert.ok(light.includes('&lt;b&gt; &amp; “r”'));
  assert.ok(light.includes('<title>Counter &lt;layout&gt;</title>'));
  assert.ok(!light.includes('<b>'));
  assert.ok(light.includes('<rect') && light.includes('<ellipse') && light.includes('<line') && light.includes('<text'));
  const css = D.drawingToSvg(SKETCH(), { look: 'css' });
  assert.ok(css.includes('var(--draw-blue)'));
  assert.ok(!css.includes('<rect x') || !css.includes('fill="#ffffff"'), 'no background unless asked');
  const dark = D.elementSvg(SKETCH()[0], 'dark');
  assert.ok(dark.includes(D.DRAW_PALETTE.dark.ink));
});

test('undo and redo step through the changes', () => {
  const h = new D.DrawHistory(3);
  const a = [];
  const b = [{ id: '1' }];
  const c = [{ id: '1' }, { id: '2' }];
  h.push(a);
  h.push(b);
  assert.equal(h.canUndo, true);
  assert.deepEqual(h.undo(c), b);
  assert.deepEqual(h.undo(b), a);
  assert.equal(h.undo(a), null);
  assert.deepEqual(h.redo(a), b);
  assert.deepEqual(h.redo(b), c);
  assert.equal(h.redo(c), null);
  // A new change after undoing forgets what could be redone.
  h.undo(c);
  h.push(b);
  assert.equal(h.canRedo, false);
  // At most `limit` steps are kept.
  for (let i = 0; i < 10; i++) h.push([{ id: String(i) }]);
  let n = 0;
  while (h.undo([])) n++;
  assert.equal(n, 3);
});

/** JSON Canvas 1.0 (jsoncanvas.org, MIT): what every reader of .canvas files may rely on. */
function validJsonCanvas(c) {
  const problems = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  const ids = new Set();
  for (const n of c.nodes ?? []) {
    if (typeof n.id !== 'string' || !n.id) problems.push('node id');
    if (ids.has(n.id)) problems.push(`duplicate id ${n.id}`);
    ids.add(n.id);
    if (!['text', 'file', 'link', 'group'].includes(n.type)) problems.push(`node type ${n.type}`);
    for (const k of ['x', 'y', 'width', 'height']) if (!Number.isInteger(n[k])) problems.push(`${n.id}.${k} is not a whole number`);
    if (n.type === 'file' && (typeof n.file !== 'string' || !n.file)) problems.push(`${n.id}.file`);
    if (n.type === 'text' && typeof n.text !== 'string') problems.push(`${n.id}.text`);
    if (n.type === 'link' && typeof n.url !== 'string') problems.push(`${n.id}.url`);
  }
  for (const e of c.edges ?? []) {
    if (typeof e.id !== 'string') problems.push('edge id');
    if (!ids.has(e.fromNode) || !ids.has(e.toNode)) problems.push(`edge ${e.id} joins a missing node`);
  }
  return problems;
}

test('on a canvas a drawing is a plain file node, and the .canvas stays valid JSON Canvas', () => {
  const canvas = {
    nodes: [{ id: 'note1', type: 'text', text: 'Shop floor ideas', x: 0, y: 0, width: 260, height: 80 }],
    edges: [],
  };
  const node = D.drawingCanvasNode('Plans/Shop floor.nvdraw', { x: 320.6, y: -10.2 }, 'draw1', { width: 420.4, height: 299.6 });
  assert.deepEqual(node, { id: 'draw1', type: 'file', file: 'Plans/Shop floor.nvdraw', x: 321, y: -10, width: 420, height: 300 });
  canvas.nodes.push(node);
  canvas.edges.push({ id: 'e1', fromNode: 'note1', fromSide: 'right', toNode: 'draw1', toSide: 'left' });
  const written = JSON.stringify(canvas, null, '\t');
  const back = JSON.parse(written);
  assert.deepEqual(validJsonCanvas(back), []);
  // Nothing of Ironleaf's own on the node: another app sees only a file there.
  assert.deepEqual(Object.keys(back.nodes[1]).sort(), ['file', 'height', 'id', 'type', 'width', 'x', 'y']);
  // The drawing it names is its own file, readable on its own.
  const file = D.serializeDrawing({ elements: SKETCH() });
  assert.equal(D.parseDrawing(file).elements.length, 6);
});
