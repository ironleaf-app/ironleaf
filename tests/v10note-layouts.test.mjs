// node --test tests/v10note-layouts.test.mjs — note rooms draw gallery, timeline and chart (10.0 Endless Tech,
// v10records2, plan item 17 screens 1): the saved view tab and the note type page draw all eight layouts the same
// way, Display names the timeline's end and the chart's spec, and the picker offers all eight. Made-up notes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-v10layouts-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/views.ts'), platform: 'node', output: { file: path.join(work, 'views.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'views.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const rows = [
  { path: 'Notes/A.md', title: 'A', props: { due: '2026-11-10', end: '2026-11-12', status: 'Open', cost: 40 }, computed: {}, rolled: {} },
  { path: 'Notes/B.md', title: 'B', props: { due: '2026-11-11', status: 'Done', cost: 60 }, computed: {}, rolled: {} },
  { path: 'Notes/C.md', title: 'C', props: { status: 'Open' }, computed: {}, rolled: {} },
];

test('the picker offers all nine layouts (eight plus the papercuts map)', () => {
  assert.deepEqual(V.LAYOUTS, ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart', 'map']);
  assert.deepEqual(V.ALL_LAYOUTS, V.LAYOUTS);
  for (const layout of V.LAYOUTS) {
    assert.ok(V.LAYOUT_WORDS[layout], `${layout} has a name`);
    assert.ok(V.LAYOUT_PHRASE[layout], `${layout} has a phrase`);
    assert.ok(!/[—–]/.test(`${V.LAYOUT_WORDS[layout]} ${V.LAYOUT_PHRASE[layout]}`), 'no em dashes');
  }
});

test('the one layout body draws all eight', () => {
  const body = src('src/renderer/src/views/saved/Layouts.tsx');
  for (const layout of ['table', 'cards', 'list', 'board', 'calendar', 'gallery', 'timeline', 'chart']) assert.ok(body.includes(`case '${layout}'`), `draws ${layout}`);
  assert.ok(body.includes('GalleryLayout') && body.includes('TimelineLayout') && body.includes('ChartLayout'));
  assert.ok(!/DeepSeek|\bDSH\b|pi-ai/i.test(body), 'no engine names');
});

test('Display names the timeline end and the chart spec, and covers the gallery', () => {
  const display = src('src/renderer/src/views/saved/Display.tsx');
  assert.ok(display.includes('Ends on'), 'timeline end row');
  assert.ok(display.includes('No end day'), 'no end day in plain words');
  assert.ok(display.includes('One for each') || display.includes('Along the bottom'), 'chart by row');
  assert.ok(display.includes('What it measures'), 'chart measure row');
  assert.ok(display.includes('How many notes'), 'count in plain words');
  assert.ok(display.includes('Measured against'), 'chart target row');
  assert.ok(display.includes("def.layout === 'gallery'"), 'gallery has Display rows');
  assert.ok(display.includes('Cover from'), 'cover row');
  for (const words of ['Ends on', 'No end day', 'What it measures', 'How many notes']) assert.ok(!/[—–]/.test(words));
});

test('long lists draw a page at a time in the new layouts', () => {
  const common = src('src/renderer/src/views/saved/common.tsx');
  assert.ok(/gallery:\s*60/.test(common), 'gallery page size');
  assert.ok(/timeline:\s*200/.test(common), 'timeline tray size');
  assert.ok(src('src/renderer/src/views/saved/Gallery.tsx').includes('Show more') || src('src/renderer/src/views/saved/Gallery.tsx').includes('Show '));
  assert.ok(src('src/renderer/src/views/saved/Timeline.tsx').includes('No date'), 'undated tray');
});

test('the saved view tab and the note type page ask for the timeline day together', () => {
  for (const file of ['src/renderer/src/views/SavedView.tsx', 'src/renderer/src/views/TypePage.tsx']) {
    const page = src(file);
    assert.ok(page.includes("def.layout === 'timeline'"), `${file} knows the timeline`);
    assert.ok(page.includes('needsDate'), `${file} asks for the day`);
    assert.ok(page.includes(`'timeline'`) && page.includes('pickFor'), `${file} suggests the day`);
  }
});

test('the timeline places ranges and names the undated', () => {
  const placed = V.placeOnTimeline(rows, 'due', 'end');
  assert.equal(placed.spans.length, 2);
  assert.equal(placed.spans[0].start, '2026-11-10');
  assert.equal(placed.spans[0].end, '2026-11-12', 'start to end, a range');
  assert.equal(placed.spans[1].end, '2026-11-11', 'no end, a mark');
  assert.deepEqual(placed.undated.map((r) => r.title), ['C']);
  const nodated = V.placeOnTimeline([{ path: 'x.md', title: 'X', props: {}, computed: {}, rolled: {} }], 'due', 'end');
  assert.equal(nodated.spans.length, 0);
  assert.equal(nodated.undated.length, 1);
});

test('the chart adds up and suggests itself in plain words', () => {
  const data = V.chartData(rows, { type: 'bar', by: 'status', measure: 'count' });
  assert.ok(data.points.length >= 2);
  assert.equal(data.total, 3);
  assert.ok(data.caption && !/[—–]/.test(data.caption), 'caption in plain words');
  const cost = V.chartData(rows, { type: 'bar', by: 'status', measure: 'cost', agg: 'sum' });
  assert.equal(cost.total, 100);
  const suggested = V.suggestChart(rows);
  assert.ok(['bar', 'line', 'donut'].includes(suggested.type));
  assert.ok(suggested.by, 'suggests what each bar is');
});
