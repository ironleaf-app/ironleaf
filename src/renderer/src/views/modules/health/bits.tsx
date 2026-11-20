// Health and Fitness's small parts (Wave 5, 24 Oct 2026): a measure's answer (a number with its unit and steppers, a
// score as buttons, yes or no, words), the day stepper, a calm line chart drawn locally (SVG: figures, a target line, the
// latest marked), bars, the 14-day streak grid, and the card every part sits in. Existing tokens only; light and dark.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, dayWords, todayIso, valueWords, type Entry, type Measure, type Streak } from '../../../../../shared/health';
import { plural } from '../../../../../shared/words';
import { Icon, type IconName } from '../../../components/Icon';
import { accessOf, AGENT_GROUPS, levelLabel, type Level } from '../../../../../shared/sensitivity';
import { openModal } from '../../../state/modals';
import { usePrivacy } from '../../../state/privacy';

export function Card({ title, icon, aside, children, className = '', wide = false }: { title?: ReactNode; icon?: IconName; aside?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <section className={`hl-card${wide ? ' is-wide' : ''} ${className}`}>
      {(title || aside) && (
        <header className="hl-card-head">
          {title && (
            <h3>
              {icon && <Icon name={icon} size={14} />}
              {title}
            </h3>
          )}
          {aside && <div className="hl-card-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A day with ‹ › and Today. */
export function DayNav({ day, onDay, today = todayIso() }: { day: string; onDay(d: string): void; today?: string }) {
  return (
    <div className="hl-daynav" role="group" aria-label="Which day">
      <button type="button" className="icon-button" aria-label="The day before" onClick={() => onDay(addDays(day, -1))}>
        <Icon name="back" size={14} />
      </button>
      <strong>{day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : dayWords(day, today)}</strong>
      <button type="button" className="icon-button" aria-label="The day after" disabled={day >= today} onClick={() => onDay(addDays(day, 1))}>
        <Icon name="forward" size={14} />
      </button>
      {day !== today && (
        <button type="button" className="link-button" onClick={() => onDay(today)}>
          Today
        </button>
      )}
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** One measure's answer for a day, in the way that measure is answered. Saves on Enter, on leaving, or on a click. */
export function Answer({ m, entry, onSave, compact = false }: { m: Measure; entry?: Entry; onSave(v: string | number | boolean | null): void; compact?: boolean }) {
  const id = useId();
  if (m.kind === 'yesno')
    return (
      <div className="hl-yesno" role="group" aria-label={m.name}>
        {[true, false].map((v) => (
          <button key={String(v)} type="button" className={`hl-choice${entry?.yes === v ? ' is-on' : ''}${v ? ' is-yes' : ' is-no'}`} aria-pressed={entry?.yes === v} onClick={() => onSave(entry?.yes === v ? null : v)}>
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    );
  if (m.kind === 'scale') {
    const lo = m.min ?? 1;
    const hi = m.max ?? 10;
    return (
      <div className={`hl-scale${hi - lo > 6 ? ' is-long' : ''}`} role="radiogroup" aria-label={m.name}>
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={entry?.n === v} className={`hl-step${entry?.n === v ? ' is-on' : ''}`} onClick={() => onSave(entry?.n === v ? null : v)}>
            {v}
          </button>
        ))}
      </div>
    );
  }
  return <TextAnswer id={id} m={m} entry={entry} onSave={onSave} compact={compact} />;
}

function TextAnswer({ id, m, entry, onSave, compact }: { id: string; m: Measure; entry?: Entry; onSave(v: string | number | boolean | null): void; compact: boolean }) {
  const shown = m.kind === 'text' ? (entry?.text ?? '') : entry?.n !== undefined ? fmt(entry.n) : (entry?.text ?? '');
  const [draft, setDraft] = useState(shown);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(shown);
  }, [shown]);
  const commit = () => {
    editing.current = false;
    const t = draft.trim();
    if (t === shown) return;
    onSave(t === '' ? null : m.kind === 'text' ? t : t);
  };
  const step = (k: number) => {
    const base = entry?.n ?? 0;
    const inc = m.unit === 'kg' || m.unit === 'cm' ? 0.1 : m.unit === 'h' ? 0.5 : 1;
    const next = Math.max(0, Math.round((base + k * inc) * 100) / 100);
    setDraft(fmt(next));
    onSave(next);
  };
  if (m.kind === 'text')
    return <input id={id} className="hl-input is-text" value={draft} placeholder="A few words" aria-label={m.name} onFocus={() => (editing.current = true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
  return (
    <div className={`hl-number${compact ? ' is-compact' : ''}`}>
      {m.daily !== undefined && (
        <button type="button" className="hl-stepper" aria-label={`One less ${m.unit ?? ''}`} onClick={() => step(-1)} disabled={!entry?.n}>
          <Icon name="minus" size={13} />
        </button>
      )}
      <input id={id} className="hl-input" inputMode="decimal" value={draft} aria-label={`${m.name}${m.unit ? ` (${m.unit})` : ''}`} onFocus={() => (editing.current = true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {m.unit && <span className="hl-unit">{m.unit}</span>}
      {m.daily !== undefined && (
        <button type="button" className="hl-stepper" aria-label={`One more ${m.unit ?? ''}`} onClick={() => step(1)}>
          <Icon name="plus" size={13} />
        </button>
      )}
    </div>
  );
}

/** A line chart of figures by day (oldest first), with a target line and the latest point marked. */
export function LineChart({ points, target, unit, height = 180, from, to, label }: { points: { day: string; n: number }[]; target?: number; unit?: string; height?: number; from?: string; to?: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const model = useMemo(() => {
    if (!points.length) return null;
    const first = from ?? points[0].day;
    const last = to ?? points[points.length - 1].day;
    const span = Math.max(1, (Date.parse(last) - Date.parse(first)) / 86400000);
    const ns = points.map((p) => p.n).concat(target !== undefined ? [target] : []);
    let lo = Math.min(...ns);
    let hi = Math.max(...ns);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.15;
    lo -= pad;
    hi += pad;
    const L = 44;
    const R = 14;
    const T = 12;
    const B = 24;
    const x = (d: string) => L + ((Date.parse(d) - Date.parse(first)) / 86400000 / span) * (width - L - R);
    const y = (n: number) => T + (1 - (n - lo) / (hi - lo)) * (height - T - B);
    const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    return { x, y, ticks, first, last, L, R, T, B };
  }, [points, target, width, height, from, to]);
  if (!model) return <div ref={box} className="hl-chart is-empty">Nothing logged in these days yet.</div>;
  const { x, y, ticks, first, last } = model;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const lastP = points[points.length - 1];
  return (
    <div ref={box} className="hl-chart">
      <svg width={width} height={height} role="img" aria-label={`${label}: ${plural(points.length, 'entry', 'entries')}, latest ${fmt(lastP.n)}${unit ? ` ${unit}` : ''}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={model.L} x2={width - model.R} y1={y(t)} y2={y(t)} className="hl-grid" />
            <text x={model.L - 8} y={y(t) + 4} className="hl-axis" textAnchor="end">
              {fmt(Math.round(t * 10) / 10)}
            </text>
          </g>
        ))}
        {target !== undefined && (
          <g>
            <line x1={model.L} x2={width - model.R} y1={y(target)} y2={y(target)} className="hl-target" />
            <text x={width - model.R} y={y(target) - 5} className="hl-target-words" textAnchor="end">
              Goal {fmt(target)}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        )}
        <path d={path} className="hl-line" />
        {points.length <= 60 && points.map((p) => <circle key={p.day} cx={x(p.day)} cy={y(p.n)} r={2.6} className="hl-point" />)}
        <circle cx={x(lastP.day)} cy={y(lastP.n)} r={5} className="hl-point is-last" />
        <text x={model.L} y={height - 6} className="hl-axis">
          {dayWords(first)}
        </text>
        <text x={width - model.R} y={height - 6} className="hl-axis" textAnchor="end">
          {dayWords(last)}
        </text>
      </svg>
    </div>
  );
}

/** Bars by day (sleep hours, water) against a target. */
export function Bars({ days, target, unit, label }: { days: { day: string; n: number | null }[]; target?: number; unit?: string; label: string }) {
  const max = Math.max(target ?? 0, ...days.map((d) => d.n ?? 0), 1);
  return (
    <div className="hl-bars" role="img" aria-label={label}>
      {target !== undefined && <span className="hl-bars-target" style={{ bottom: `${(target / max) * 100}%` }} title={`Target ${target}${unit ? ` ${unit}` : ''}`} />}
      {days.map((d) => (
        <span key={d.day} className={`hl-bar${d.n === null ? ' is-none' : target !== undefined && (d.n ?? 0) >= target ? ' is-met' : ''}`} title={`${dayWords(d.day)}: ${d.n === null ? 'not logged' : `${fmt(d.n)}${unit ? ` ${unit}` : ''}`}`}>
          <i style={{ height: `${d.n === null ? 4 : Math.max(4, (d.n / max) * 100)}%` }} />
        </span>
      ))}
    </div>
  );
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** The last 14 days of a yes/no: each day a square (yes, no, not answered); a click moves it on when `onDay` is given. */
export function StreakGrid({ streak, onDay, label }: { streak: Streak; onDay?: (day: string, next: boolean | null) => void; label: string }) {
  return (
    <div className="hl-grid14" role="group" aria-label={`${label}: the last 14 days`}>
      {streak.days.map((d) => {
        const next = d.yes === null ? true : d.yes ? false : null;
        const words = `${dayWords(d.day)}: ${d.yes === null ? 'not answered' : d.yes ? 'yes' : 'no'}`;
        const w = new Date(`${d.day}T12:00:00`).getDay();
        return (
          <button key={d.day} type="button" disabled={!onDay} className={`hl-sq${d.yes === true ? ' is-yes' : d.yes === false ? ' is-no' : ''}${d.day === todayIso() ? ' is-today' : ''}`} title={onDay ? `${words} (click: ${next === null ? 'clear' : next ? 'yes' : 'no'})` : words} aria-label={words} onClick={() => onDay?.(d.day, next)}>
            <span>{LETTERS[w]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A figure tile: the value large, its words under it. */
export function Tile({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'none'; onClick?: () => void }) {
  const body = (
    <>
      <span className="hl-tile-label">{label}</span>
      <span className="hl-tile-value">{value}</span>
      {sub && <span className={`hl-tile-sub${tone ? ` is-${tone}` : ''}`}>{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="hl-tile is-button" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="hl-tile">{body}</div>
  );
}

export const shownValue = (m: Measure | undefined, e: Entry | undefined) => (e ? valueWords(m, e) : '');

/** Words with a figure's change ("−1.8 kg", "+0.5 h"), its tone the better way or not. */
export function changeWords(change: number | undefined, unit?: string): string {
  if (change === undefined || change === 0) return 'no change';
  return `${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}${unit ? ` ${unit}` : ''}`;
}

export const NOT_ADVICE = 'Nothing in Health is medical advice: it shows what you logged. For anything medical, ask your GP.';

/** Who may read a level now (the side chat, the former host app, a chat bot, outside agents), with the way to change
it. */
export function WhoReads({ level }: { level: Level }) {
  const { store } = usePrivacy();
  const who = AGENT_GROUPS.filter((g) => accessOf(store, g.id).includes(level)).map((g) => g.label);
  return (
    <p className="hl-who">
      <Icon name="agent" size={12} />
      <span>
        {who.length ? `Assistants that may use ${levelLabel(level)} now: ${who.join(', ')}.` : `No assistant may use ${levelLabel(level)} records yet, so none of them can read or log anything here.`}{' '}
        <button type="button" className="link-button" onClick={() => openModal({ kind: 'settings', section: 'privacy' })}>
          Change who
        </button>
      </span>
    </p>
  );
}
