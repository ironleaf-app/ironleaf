// The charts a project layout draws (21 Oct 2026, docs/LAYOUTS.md): a ring, a trend line with its start, target and plan,
// and a small line — drawn here as SVG (no chart library), in the page's own tokens so they follow light, dark and the
// Bright palettes, and sized to the width they're given (crisp at every width, never stretched text).

import { useEffect, useId, useRef, useState } from 'react';
import type { TrendSeries } from '../../../../shared/layouts';

/** The width an element has, kept up to date. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
export const isoWords = (iso: string, withYear = false) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear || y !== new Date().getFullYear() ? ` ${y}` : ''}`;
};
const fmt = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100)).replace(/^-/, '−');
/** An axis label: as few decimals as the range needs. */
const tick = (n: number, range: number) => (range >= 20 ? String(Math.round(n)) : range >= 2 ? (Math.round(n * 10) / 10).toFixed(1) : (Math.round(n * 100) / 100).toFixed(2)).replace(/^-/, '−');

/** A ring: how far round (0–1), with words in its middle. */
export function Ring({ value, size = 96, stroke = 8, tone = 'accent', children, label }: { value: number; size?: number; stroke?: number; tone?: string; children?: React.ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className={`ly-ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ly-ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ly-ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ly-ring-words">{children}</div>
    </div>
  );
}

/** A trend: the entries as a line, the target as a dashed line, and (with start and end dates) the planned path. */
export function TrendChart({ s, height = 168 }: { s: TrendSeries; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const fade = `ly-fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const pts = s.points.map((p) => ({ x: dayMs(p.date), y: p.n, date: p.date }));
  const D = 86400000;
  const planFull = s.from && s.to && s.start !== undefined && s.target !== undefined ? [{ x: dayMs(s.from), y: s.start }, { x: dayMs(s.to), y: s.target }] : null;
  // The days shown: from the start (or the first entry) to a little past the last entry — the whole plan only once the
  // entries reach it, so a few days of entries never sit squeezed into a corner.
  const first = Math.min(...pts.map((p) => p.x), planFull ? planFull[0].x : Infinity);
  const lastX = pts.length ? pts[pts.length - 1].x : first;
  const end = Math.max(lastX, Math.min(planFull ? planFull[1].x : Infinity, Math.max(lastX + 14 * D, first + 28 * D)));
  const planAt = (x: number) => (planFull ? planFull[0].y + ((planFull[1].y - planFull[0].y) * (x - planFull[0].x)) / Math.max(1, planFull[1].x - planFull[0].x) : 0);
  const plan = planFull ? [planFull[0], { x: Math.min(end, planFull[1].x), y: planAt(Math.min(end, planFull[1].x)) }] : null;
  const xs = Number.isFinite(first) ? [first, end] : [];
  const ys = [...pts.map((p) => p.y), ...(s.target !== undefined ? [s.target] : []), ...(plan ? plan.map((p) => p.y) : [])];
  const unit = s.unit ? ` ${s.unit}` : '';
  const summary = `${s.field}: ${pts.length ? `${fmt(pts[pts.length - 1].y)}${unit} on ${isoWords(pts[pts.length - 1].date)}` : 'nothing logged yet'}${s.target !== undefined ? `, target ${fmt(s.target)}${unit}` : ''}`;
  if (!w || !xs.length) return <div ref={ref} className="ly-trend-chart" style={{ height }} role="img" aria-label={summary} />;
  const pad = { l: 40, r: 14, t: 14, b: 24 };
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x1 - x0 < 6 * 86400000) {
    x1 = x0 + 6 * 86400000;
  }
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const spread = Math.max(y1 - y0, Math.abs(y1) * 0.02, 1);
  y0 -= spread * 0.18;
  y1 += spread * 0.18;
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = pts.length > 1 ? `${line} L${X(pts[pts.length - 1].x).toFixed(1)},${height - pad.b} L${X(pts[0].x).toFixed(1)},${height - pad.b} Z` : '';
  const ticks = [0, 0.5, 1].map((f) => y0 + (y1 - y0) * (0.12 + f * 0.76));
  const last = pts[pts.length - 1];
  const today = Date.now();
  return (
    <div ref={ref} className="ly-trend-chart" style={{ height }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={summary}>
        <defs>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="ly-fade-top" />
            <stop offset="100%" className="ly-fade-bottom" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} className="ly-grid-line" />
            <text x={pad.l - 8} y={Y(t) + 3.5} className="ly-axis" textAnchor="end">
              {tick(t, y1 - y0)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={height - 6} className="ly-axis">
          {isoWords(new Date(x0).toISOString().slice(0, 10))}
        </text>
        <text x={w - pad.r} y={height - 6} className="ly-axis" textAnchor="end">
          {isoWords(new Date(x1 + 43200000).toISOString().slice(0, 10))}
        </text>
        {today > x0 && today < x1 && <line x1={X(today)} x2={X(today)} y1={pad.t} y2={height - pad.b} className="ly-today-line" />}
        {plan && <line x1={X(plan[0].x)} y1={Y(plan[0].y)} x2={X(plan[1].x)} y2={Y(plan[1].y)} className="ly-plan-line" />}
        {s.target !== undefined && (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={Y(s.target)} y2={Y(s.target)} className="ly-target-line" />
            <text x={w - pad.r - 2} y={Y(s.target) - 5} className="ly-target-words" textAnchor="end">
              Target {fmt(s.target)}
              {unit}
            </text>
          </g>
        )}
        {area && <path d={area} className="ly-area" fill={`url(#${fade})`} />}
        {pts.length > 1 && <path d={line} className="ly-line" fill="none" />}
        {pts.map((p) => (
          <circle key={p.date} cx={X(p.x)} cy={Y(p.y)} r={pts.length > 40 ? 0 : 2.5} className="ly-point">
            <title>{`${isoWords(p.date)}: ${fmt(p.y)}${unit}`}</title>
          </circle>
        ))}
        {last && <circle cx={X(last.x)} cy={Y(last.y)} r={4.5} className="ly-point-last" />}
      </svg>
    </div>
  );
}

/** A small line of recent values (no axes), for several measures side by side. */
export function Spark({ points, height = 34, label }: { points: { date: string; n: number }[]; height?: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  if (!w || points.length < 2)
    return (
      <div ref={ref} className="ly-spark" style={{ height }} role="img" aria-label={label}>
        {points.length < 2 && <span className="ly-spark-flat" />}
      </div>
    );
  const xs = points.map((p) => dayMs(p.date));
  const ys = points.map((p) => p.n);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const X = (x: number) => 3 + ((x - x0) / Math.max(1, x1 - x0)) * (w - 6);
  const Y = (y: number) => 4 + (1 - (y - y0) / Math.max(1e-9, y1 - y0 || 1)) * (height - 8);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.n).toFixed(1)}`).join(' ');
  return (
    <div ref={ref} className="ly-spark" style={{ height }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label}>
        <path d={d} className="ly-line" fill="none" />
        <circle cx={X(xs[xs.length - 1])} cy={Y(ys[ys.length - 1])} r={3} className="ly-point-last" />
      </svg>
    </div>
  );
}
