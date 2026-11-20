// One chart option builder (5 Nov 2026; Apache ECharts 6.1.0, Apache-2.0): a chart block's
// points as an ECharts option in the page's own tokens (lib/charts.ts draws it). ECharts draws
// what the vault's Mermaid path could not: hover values, a legend that counts, a zoom slider on
// a long series, grouped axis figures. The block syntax, the figures and the captions are the one
// chart kit's (./chart-kit.ts), untouched: only the drawing changes. Pure: no files, no Node, no
// DOM; the theme's colours arrive from the page (charts.ts reads its tokens, light or dark).

import type { ChartBlock, ChartPoint } from './chart-kit';

/** The page's colours for one chart: every colour a theme token the page read. */
export interface ChartTheme {
  text: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  accentSoft: string;
  font: string;
  series: string[];
}

/** One palette for every pie (as lib/hydrate.ts diagramColours): the accent first, then steady companions. */
export function chartPalette(accent: string): string[] {
  return [accent, '#2f6fed', '#0f9e94', '#d9a400', '#8b4ee6', '#e0457f', '#4f5b66', '#22a35a'];
}

/** A figure as the page reads it: grouped thousands, two decimals at most, never currency-guessed. */
export const chartFigure = (n: number): string => Math.abs(n) >= 1000 ? n.toLocaleString('en-AU', { maximumFractionDigits: n % 1 === 0 ? 0 : 2 }) : String(Math.round(n * 100) / 100);

const base = (theme: ChartTheme, motion: boolean): Record<string, unknown> => ({
  animation: motion,
  aria: { enabled: true },
  textStyle: { fontFamily: theme.font, color: theme.text },
  tooltip: {
    trigger: 'axis',
    confine: true,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    textStyle: { color: theme.text, fontFamily: theme.font },
    axisPointer: { lineStyle: { color: theme.muted }, crossStyle: { color: theme.muted } },
  },
});

/** A chart's points as an ECharts option: `motion` false draws still (reduced motion). */
export function chartOption(
  chart: Pick<ChartBlock, 'type' | 'title' | 'y_label' | 'measure'>,
  points: readonly ChartPoint[],
  theme: ChartTheme,
  { motion }: { motion: boolean },
): Record<string, unknown> & { xAxis?: any; yAxis?: any; series: any[]; title?: any; legend?: any; tooltip?: any; dataZoom?: any; aria?: any; animation?: boolean } {
  if (chart.type === 'pie') {
    const data = points.map((p, i) => ({ name: p.label, value: p.value, itemStyle: { color: theme.series[i % theme.series.length] } }));
    const byName = new Map(data.map((d) => [d.name, d.value]));
    return {
      ...base(theme, motion),
      title: { text: chart.title ?? '', left: 'center', textStyle: { color: theme.text, fontFamily: theme.font, fontWeight: 600, fontSize: 15 } },
      tooltip: { ...(base(theme, motion).tooltip as object), trigger: 'item', valueFormatter: (v: number | string) => chartFigure(Number(v)) },
      legend: { bottom: 0, textStyle: { color: theme.muted, fontFamily: theme.font }, formatter: (name: string) => `${name} [${chartFigure(Number(byName.get(name) ?? 0))}]` },
      series: [{ type: 'pie', radius: ['0%', '62%'], center: ['50%', '44%'], data, label: { color: theme.text, fontFamily: theme.font, formatter: '{d}%' }, labelLine: { lineStyle: { color: theme.muted } }, itemStyle: { borderColor: theme.surface, borderWidth: 2 } }],
    };
  }
  const long = points.length > 10;
  return {
    ...base(theme, motion),
    title: { text: chart.title ?? '', left: 'center', textStyle: { color: theme.text, fontFamily: theme.font, fontWeight: 600, fontSize: 15 } },
    grid: { left: 8, right: 12, top: 44, bottom: long ? 64 : 28, containLabel: true },
    xAxis: { type: 'category', data: points.map((p) => p.label), axisTick: { show: false }, axisLine: { lineStyle: { color: theme.border } }, axisLabel: { color: theme.muted, fontFamily: theme.font, interval: points.length > 12 ? 'auto' : 0, hideOverlap: true } },
    yAxis: { type: 'value', name: chart.y_label ?? '', nameTextStyle: { color: theme.muted, fontFamily: theme.font }, splitLine: { lineStyle: { color: theme.border } }, axisLabel: { color: theme.muted, fontFamily: theme.font, formatter: chartFigure } },
    ...(long
      ? {
          dataZoom: [
            {
              type: 'slider',
              bottom: 8,
              height: 22,
              backgroundColor: theme.surface,
              dataBackground: { lineStyle: { color: theme.muted }, areaStyle: { color: theme.border } },
              fillerColor: theme.accentSoft,
              borderColor: theme.border,
              textStyle: { color: theme.muted },
              handleStyle: { color: theme.muted, borderColor: theme.muted },
              moveHandleStyle: { color: theme.muted },
            },
          ],
        }
      : {}),
    series: [{ type: chart.type === 'line' ? 'line' : 'bar', data: points.map((p) => p.value), color: theme.accent, ...(chart.type === 'line' ? { showSymbol: true, symbolSize: 7, lineStyle: { width: 2.5, color: theme.accent }, itemStyle: { color: theme.accent, borderColor: theme.surface, borderWidth: 2 } } : { itemStyle: { color: theme.accent, borderRadius: [3, 3, 0, 0] } }) }],
  };
}
