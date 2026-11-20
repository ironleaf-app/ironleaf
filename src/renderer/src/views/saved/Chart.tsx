// A view as a chart (10.0 Endless Tech, v10records2; src/shared/views.ts chartData):
// bars, a line or a ring, drawn here (SVG, the page's own tokens, light and
// dark), from a count of notes or a number field (added up or averaged), by any
// field or over time. A bar, a point or a slice lists the notes behind it; one
// click opens one.

import { useMemo, useState } from 'react';
import { chartData, sharePercents, suggestChart, type ChartData, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { openNote } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
}

const SERIES = ['var(--accent)', 'var(--doc)', 'var(--canvas-5)', 'var(--canvas-3)', 'var(--canvas-6)', 'var(--canvas-4)', 'var(--canvas-2)', 'var(--text-faint)'];
const NEUTRAL = ['var(--text-faint)', 'var(--doc)', 'var(--canvas-5)', 'var(--canvas-6)'];
const plainFmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : n.toLocaleString('en-AU', { maximumFractionDigits: 2 }));

/** A colour per point: bars read by their length in one calm colour, a ring needs one per slice. */
function colours(data: ChartData, by: string, type: string): string[] {
  let next = 0;
  const toned = /status|stage|state|phase|impact|health/.test(by);
  return data.points.map(() => {
    if (toned && type !== 'bar') return NEUTRAL[next++ % NEUTRAL.length];
    if (type === 'bar') return toned ? 'var(--text-faint)' : 'var(--accent)';
    return SERIES[next++ % SERIES.length];
  });
}

export function ChartLayout({ def, rows }: Props) {
  const spec = def.chart ?? suggestChart(rows);
  const data = useMemo(() => chartData(rows, spec, def), [rows, spec, def]);
  const [picked, setPicked] = useState<number | null>(null);
  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
  if (!data.points.length)
    return (
      <div className="sv-chart-empty">
        <Icon name="chart" size={18} />
        <p>Nothing to chart yet: no notes have a {spec.measure === 'count' ? 'value' : 'number'} for this.</p>
      </div>
    );
  const cols = colours(data, spec.by, spec.type);
  const chosen = picked !== null ? data.points[picked] : null;
  return (
    <div className={`sv-chart type-${spec.type}${spec.target ? ' has-target' : ''}`}>
      <div className="sv-chart-head">
        <span className="sv-chart-caption">{data.caption}</span>
        <span className="sv-chart-total">
          {spec.type === 'line' && spec.agg === 'avg' ? `Latest ${plainFmt(data.points[data.points.length - 1].value)}` : `${plainFmt(data.total)} in all`}
        </span>
      </div>
      {spec.type === 'donut' ? <Donut data={data} cols={cols} picked={picked} pick={setPicked} /> : spec.type === 'line' ? <Line data={data} picked={picked} pick={setPicked} /> : <Bars data={data} cols={cols} picked={picked} pick={setPicked} />}
      {chosen && (
        <div className="sv-chart-pick">
          <div className="sv-chart-pick-head">
            <strong>{chosen.label}</strong>
            <span>
              {plainFmt(chosen.value)} · {chosen.ids.length} {chosen.ids.length === 1 ? 'note' : 'notes'}
            </span>
            <button type="button" className="icon-button" aria-label="Close" onClick={() => setPicked(null)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <ul>
            {chosen.ids.slice(0, 12).map((id) => {
              const r = byPath.get(id);
              return r ? (
                <li key={id}>
                  <button type="button" onClick={(e) => openNote(r.path, e)}>
                    {r.title}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Bars({ data, cols, picked, pick }: { data: ChartData; cols: string[]; picked: number | null; pick(i: number | null): void }) {
  const max = Math.max(...data.points.map((p) => Math.max(p.value, p.target ?? 0)), 0) || 1;
  return (
    <div className="sv-bars" role="list">
      {data.points.map((p, i) => (
        <button key={p.label} type="button" role="listitem" className={`sv-bar${picked === i ? ' is-picked' : ''}${p.target !== undefined && p.target > 0 && p.value > p.target ? ' is-over' : ''}`} onClick={() => pick(picked === i ? null : i)} title={`${p.label}: ${plainFmt(p.value)}${p.target !== undefined ? ` of ${plainFmt(p.target)}` : ''}`}>
          <span className="sv-bar-label">{p.label}</span>
          <span className="sv-bar-track">
            <span className="sv-bar-fill" style={{ width: `${p.value > 0 ? Math.max(1.5, (p.value / max) * 100) : 0}%`, background: p.target !== undefined && p.target > 0 && p.value > p.target ? 'var(--tone-bad)' : cols[i] }} />
            {p.target !== undefined && p.target > 0 && <span className="sv-bar-target" style={{ left: `${(p.target / max) * 100}%` }} aria-hidden="true" />}
          </span>
          <span className="sv-bar-value">{plainFmt(p.value)}{p.target !== undefined && p.target > 0 && <span className="sv-bar-of"> of {plainFmt(p.target)}</span>}</span>
        </button>
      ))}
    </div>
  );
}

function Donut({ data, cols, picked, pick }: { data: ChartData; cols: string[]; picked: number | null; pick(i: number | null): void }) {
  const total = data.points.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const shares = sharePercents(data.points.map((p) => p.value));
  const value = picked !== null ? data.points[picked].value : data.total;
  const full = plainFmt(value);
  const centre = full.length > 8 ? full.replace(/[\d][\d,.]*/, new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(value))) : full;
  const R = 62;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="sv-donut">
      <svg viewBox="0 0 160 160" width="168" height="168" role="img" aria-label={data.caption}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--bg-hover)" strokeWidth="20" />
        {data.points.map((p, i) => {
          const len = (Math.max(0, p.value) / total) * C;
          const gap = data.points.length > 1 ? Math.min(2.5, len / 3) : 0;
          const seg = (
            <circle
              key={p.label}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={cols[i]}
              strokeWidth={picked === i ? 24 : 20}
              strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
              strokeDashoffset={-at}
              transform="rotate(-90 80 80)"
              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
              onClick={() => pick(picked === i ? null : i)}
            >
              <title>{`${p.label}: ${plainFmt(p.value)}`}</title>
            </circle>
          );
          at += len;
          return seg;
        })}
        <text x="80" y="76" textAnchor="middle" className={`sv-donut-n${centre.length > 7 ? ' is-long' : ''}`}>
          {centre}
        </text>
        <text x="80" y="96" textAnchor="middle" className="sv-donut-unit">
          {picked !== null ? data.points[picked].label.slice(0, 16) : data.unit.slice(0, 16)}
        </text>
      </svg>
      <ul className="sv-legend">
        {data.points.map((p, i) => (
          <li key={p.label}>
            <button type="button" className={picked === i ? 'is-picked' : ''} onClick={() => pick(picked === i ? null : i)}>
              <span className="sv-legend-swatch" style={{ background: cols[i] }} />
              <span className="sv-legend-label">{p.label}</span>
              <span className="sv-legend-value">{plainFmt(p.value)}</span>
              <span className="sv-legend-pct">{shares[i]}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Line({ data, picked, pick }: { data: ChartData; picked: number | null; pick(i: number | null): void }) {
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 16, t: 14, b: 30 };
  const vals = data.points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.12;
  hi += span * 0.12;
  const x = (i: number) => pad.l + (data.points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (data.points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = data.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(data.points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const every = Math.max(1, Math.ceil(data.points.length / 8));
  return (
    <svg className="sv-line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data.caption}>
      <defs>
        <linearGradient id="sv-line-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="sv-grid" />
          <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" className="sv-axis">
            {plainFmt(Math.round(g * 10) / 10)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#sv-line-fill)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {data.points.map((p, i) => (
        <g key={p.label} onClick={() => pick(picked === i ? null : i)} style={{ cursor: 'pointer' }}>
          <circle cx={x(i)} cy={y(p.value)} r={picked === i ? 5.5 : 3.6} fill="var(--bg-raised)" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <title>{`${p.label}: ${plainFmt(p.value)}`}</title>
          {(i % every === 0 || i === data.points.length - 1) && (
            <text x={x(i)} y={H - 10} textAnchor="middle" className="sv-axis">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
