// node --test tests/chart-option.test.mjs — the ECharts option builder (5 Nov 2026;
// src/shared/chart-option.ts, Apache ECharts, Apache-2.0): a chart block's points as an
// ECharts option in the page's own tokens. The block syntax and captions are untouched
// (tests/chart-kit.test.mjs); only the drawing changes. Made-up figures only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-chart-option-'));
let O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'opt.ts');
  writeFileSync(entry, `export * as O from ${JSON.stringify(path.join(root, 'src/shared/chart-option.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'opt.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ O } = await import(pathToFileURL(path.join(work, 'opt.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const theme = { text: '#141a2e', muted: '#565e70', border: '#e2e7ee', surface: '#ffffff', accent: '#f2785a', accentSoft: 'rgba(242,120,90,0.13)', font: 'Geist, sans-serif', series: ['#f2785a', '#2f6fed', '#0f9e94'] };
const points = [
  { key: 'a', label: 'Groceries', value: 412.5 },
  { key: 'b', label: 'Fuel', value: 80 },
  { key: 'c', label: 'Subscriptions', value: 18.99 },
];
const months = ['Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26'].map((label, i) => ({ key: String(i), label, value: 30000 + i * 1000 }));

test('bars read by their length in the one accent colour', () => {
  const o = O.chartOption({ type: 'bar', title: 'By month' }, months.slice(0, 4), theme, { motion: true });
  assert.deepEqual(o.xAxis.data, ['Nov 25', 'Dec 25', 'Jan 26', 'Feb 26']);
  assert.deepEqual(o.series[0].data, [30000, 31000, 32000, 33000]);
  assert.equal(o.series[0].type, 'bar');
  assert.equal(o.series[0].color, '#f2785a');
  assert.equal(o.title.text, 'By month');
  assert.equal(o.title.textStyle.color, '#141a2e');
});

test('a line is a line, with its points shown', () => {
  const o = O.chartOption({ type: 'line', title: 'Costs' }, months.slice(0, 4), theme, { motion: true });
  assert.equal(o.series[0].type, 'line');
  assert.equal(o.series[0].showSymbol, true);
});

test('a pie names every slice and its legend counts them', () => {
  const o = O.chartOption({ type: 'pie', title: 'By status' }, points, theme, { motion: true });
  assert.equal(o.series[0].type, 'pie');
  assert.deepEqual(o.series[0].data.map((d) => [d.name, d.value]), [['Groceries', 412.5], ['Fuel', 80], ['Subscriptions', 18.99]]);
  assert.deepEqual(o.series[0].data.map((d) => d.itemStyle.color), ['#f2785a', '#2f6fed', '#0f9e94']);
  assert.match(o.legend.formatter('Groceries', 412.5), /Groceries.*412/);
});

test('twelve months get a zoom slider, four do not', () => {
  assert.ok(O.chartOption({ type: 'bar' }, months, theme, { motion: true }).dataZoom, 'a long series zooms');
  assert.equal(O.chartOption({ type: 'bar' }, months.slice(0, 4), theme, { motion: true }).dataZoom, undefined, 'a short one draws whole');
  assert.equal(O.chartOption({ type: 'pie' }, points, theme, { motion: true }).dataZoom, undefined, 'a pie never zooms');
});

test('hovering shows the value, axes read grouped figures', () => {
  const o = O.chartOption({ type: 'bar' }, months.slice(0, 2), theme, { motion: true });
  assert.equal(o.tooltip.trigger, 'axis');
  assert.equal(o.yAxis.axisLabel.formatter(30000), '30,000');
  assert.equal(o.yAxis.axisLabel.formatter(412.5), '412.5');
  const p = O.chartOption({ type: 'pie' }, points, theme, { motion: true });
  assert.equal(p.tooltip.trigger, 'item');
});

test('reduced motion draws still, and the chart reads to a screen reader', () => {
  assert.equal(O.chartOption({ type: 'bar' }, months.slice(0, 2), theme, { motion: false }).animation, false);
  assert.equal(O.chartOption({ type: 'bar' }, months.slice(0, 2), theme, { motion: true }).animation, true);
  assert.equal(O.chartOption({ type: 'bar' }, months.slice(0, 2), theme, { motion: true }).aria.enabled, true);
});

test('one palette for every pie: the accent first, then steady companions', () => {
  assert.deepEqual(O.chartPalette('#f2785a').slice(0, 3), ['#f2785a', '#2f6fed', '#0f9e94']);
  assert.ok(O.chartPalette('#f2785a').length >= 8, 'enough slices for a full chart');
});
