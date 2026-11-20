// A chart block drawn in a note (8.0 Phase 5, 28 Oct 2026; src/shared/chart-kit.ts): its notes picked from the index in
// memory, as a view picks them, the rows of their tables read when the chart counts a table, the figures worked out with
// the one chart kit and drawn with Apache ECharts (5 Nov 2026, was Mermaid: hover values, a legend that counts, a zoom
// slider on a long series, grouped axes) in the person's colours, with a line saying what they came from. Drawn
// each time the note is drawn, so it is always the notes as they are now. Reading (lib/hydrate.ts) and Live Preview
// (editor/widgets.ts ChartWidget) both use this.

import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { chartSelection, readChartBlock, workChart, type ChartBlock, type ChartNote, type ChartPoint } from '../../../shared/chart-kit';
import { chartOption, chartPalette, type ChartTheme } from '../../../shared/chart-option';
import { runView } from '../../../shared/views';
import { docs } from '../state/docs';
import { viewExclusions } from '../state/savedViews';
import { getState } from '../state/store';
import { drawErrorHtml } from './hydrate';

// Per chart type only (5 Nov 2026): notes without charts load none of this (hydrate and the live preview import
// this file only for a chart block), and ECharts' other charts never ship.
echarts.use([BarChart, LineChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page's colours for a chart, read from its tokens (as hydrate.ts diagramColours, same accent first). */
function themeOf(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.dataset.theme === 'dark';
  const accent = v('--accent', '#357553');
  // The accent at 13% (the --accent-soft token's value): mixed here from the hex, because canvas reads no color-mix.
  const soft = /^#([0-9a-f]{6})$/i.exec(accent);
  const accentSoft = soft ? `rgba(${parseInt(soft[1].slice(0, 2), 16)}, ${parseInt(soft[1].slice(2, 4), 16)}, ${parseInt(soft[1].slice(4, 6), 16)}, 0.13)` : 'rgba(53, 117, 83, 0.13)';
  return {
    text: v('--text-strong', dark ? '#ececec' : '#141a2e'),
    muted: v('--text-muted', dark ? '#a3a3a3' : '#565e70'),
    border: v('--border', dark ? '#3a3a3a' : '#e2e7ee'),
    surface: v('--bg-raised', dark ? '#262626' : '#ffffff'),
    accent,
    accentSoft,
    font: v('--font-ui', "'Geist', 'Segoe UI', system-ui, sans-serif"),
    series: chartPalette(accent),
  };
}

export interface WorkedChart {
  chart: ChartBlock;
  points: ChartPoint[];
  caption: string;
}

/** A chart block's figures worked out from the notes as they are now, or the reason they can't be. */
export async function drawChart(source: string): Promise<{ worked?: WorkedChart; error?: string }> {
  const { chart, problem } = readChartBlock(source);
  if (problem) return { error: problem };
  let notes: ChartNote[] = [];
  if (!chart.points) {
    const all = getState().notes;
    const rows = runView(chartSelection(chart.source), all, { exclude: viewExclusions() });
    const byPath = new Map(all.map((n) => [n.path, n]));
    notes = rows.map((r) => byPath.get(r.path)).filter((n): n is NonNullable<typeof n> => !!n);
    // A chart of tables reads each note's words (an open note's as typed).
    if (chart.table) notes = await Promise.all(notes.slice(0, 400).map(async (n) => ({ ...n, text: docs.text(n.path) ?? (await window.nv.notes.read(n.path).catch(() => '')) })));
  }
  const w = workChart(chart, notes);
  return { worked: { chart, points: w.points, caption: w.caption } };
}

// A drawn chart and its resize watch, by its box: filling again (or the editor dropping the box) draws once.
const live = new WeakMap<HTMLElement, { chart: echarts.ECharts; ro: ResizeObserver }>();
/** Draws nothing: releases a box's chart (the live preview calls it when its box goes). */
export function releaseChart(box: HTMLElement): void {
  for (const el of [box, ...box.querySelectorAll<HTMLElement>('.nv-echart')]) {
    const l = live.get(el);
    if (!l) continue;
    live.delete(el);
    try {
      l.ro.disconnect();
    } catch {}
    try {
      l.chart.dispose();
    } catch {}
  }
}

/** Fills a chart's place (a div), saying so plainly when it can't. */
const fillOf = new WeakMap<HTMLElement, number>();
export async function fillChart(el: HTMLElement, source: string): Promise<void> {
  const mine = (fillOf.get(el) ?? 0) + 1;
  fillOf.set(el, mine);
  const { worked, error } = await drawChart(source).catch((e: unknown): { worked?: WorkedChart; error?: string } => ({ error: e instanceof Error ? e.message : String(e) }));
  if (fillOf.get(el) !== mine) return; // A newer fill started while this one worked: it wins.
  releaseChart(el);
  if (error || !worked) {
    el.innerHTML = drawErrorHtml('chart', error);
    return;
  }
  if (!worked.points.length) {
    el.innerHTML = `<div class="nv-chart-empty">${esc(worked.chart.title ? `${worked.chart.title}: nothing to chart yet.` : 'Nothing to chart yet.')} ${esc(worked.caption)}</div>`;
    return;
  }
  el.innerHTML = `<div class="nv-echart" role="img" aria-label="${esc(`${worked.chart.title ?? 'Chart'}. ${worked.caption}`)}"></div><p class="nv-chart-caption">${esc(worked.caption)}</p>`;
  const box = el.querySelector<HTMLElement>('.nv-echart')!;
  try {
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const chart = echarts.init(box, null, { renderer: 'canvas' });
    chart.setOption(chartOption(worked.chart, worked.points, themeOf(), { motion }));
    const ro = new ResizeObserver(() => {
      try {
        chart.resize();
      } catch {}
    });
    ro.observe(box);
    live.set(box, { chart, ro });
  } catch (e: unknown) {
    releaseChart(el);
    el.innerHTML = drawErrorHtml('chart', e);
  }
}
