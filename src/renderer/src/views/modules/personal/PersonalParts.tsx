// The personal modules' shared page parts (Wave 7 part a: Home, Vehicles, Career, Travel). Made on the work modules'
// shell (WorkShell: header, row of pages, a record's own page with the way back, tiles, cards, record views): a value
// changed where it shows, a fact row, a table of a note's rows changed cell by cell, a card of the files kept with a
// record, a small line chart and a progress bar. Everything shown here changes where it is.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moneyWords } from '../../../../../shared/personal-records';
import { Icon, type IconName } from '../../../components/Icon';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { workCall, workDid } from '../../../state/workModules';
import { dayText } from '../work/WorkShell';
import { isEnterKey } from '../../../lib/enterKey';

/** A module's jobs by name. */
export const caller =
  (module: string) =>
  <T,>(name: string, ...args: unknown[]) =>
    workCall<T>(module, name, ...args);

// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7).
export { plural } from '../../../../../shared/words';
export const money = (n: number | null | undefined, cur = 'AUD', cents = true) => moneyWords(n ?? null, cur, cents);
export const fileName = (p: string) => p.split('/').pop() ?? p;

export type InlineKind = 'text' | 'date' | 'choice' | 'number' | 'time' | 'long';

/** A value changed where it shows: a click makes it editable (a choice opens its list), Enter or leaving saves it. */
export function Inline({ value, shown, label, kind = 'text', options, canEdit, placeholder, onSave, className }: { value: string; shown?: ReactNode; label: string; kind?: InlineKind; options?: readonly string[]; canEdit: boolean; placeholder?: string; onSave(v: string): Promise<boolean>; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      if (input.current instanceof HTMLInputElement && kind !== 'date' && kind !== 'time') input.current.select();
    }
  }, [editing, kind]);
  const done = async (v: string) => {
    if (busy) return;
    if (v.trim() === value.trim()) return setEditing(false);
    setBusy(true);
    const ok = await onSave(v.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };
  if (!editing)
    return (
      <button type="button" className={`pm-inline${value ? '' : ' is-empty'}${kind === 'long' ? ' is-long' : ''}${className ? ` ${className}` : ''}`} disabled={!canEdit} title={canEdit ? `Change ${label.toLowerCase()}` : undefined} aria-label={`${label}: ${value || 'not set'}${canEdit ? ', change it' : ''}`} onClick={() => setEditing(true)}>
        {value ? (shown ?? value) : <span className="pm-inline-none">{canEdit ? (placeholder ?? 'Add') : ''}</span>}
      </button>
    );
  if (kind === 'long')
    return (
      <textarea
        className="pm-inline-edit is-long"
        aria-label={label}
        value={text}
        rows={3}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void done(text)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  if (kind === 'choice') {
    const list = options && value && !options.includes(value) ? [value, ...options] : (options ?? []);
    return (
      <select ref={(el) => void (input.current = el)} className="pm-inline-edit" aria-label={label} value={text} disabled={busy} onChange={(e) => void done(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
        {list.map((o) => (
          <option key={o} value={o}>
            {o || ''}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      ref={(el) => void (input.current = el)}
      className="pm-inline-edit"
      aria-label={label}
      type={kind === 'date' ? 'date' : kind === 'time' ? 'time' : 'text'}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      value={text}
      disabled={busy}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void done(text)}
      onKeyDown={(e) => {
        if (isEnterKey(e)) void done(text);
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pm-fact">
      <span className="pm-fact-label">{label}</span>
      <span className="pm-fact-value">{children}</span>
    </div>
  );
}

export interface Col {
  key: string;
  label: string;
  kind?: InlineKind | 'money' | 'readonly';
  options?: readonly string[];
  /** How the value shows (a pill, a day in words). */
  shown?(v: string, row: TableRowView): ReactNode;
  strong?: boolean;
  /** Right-aligned (amounts, numbers). */
  num?: boolean;
  placeholder?: string;
}

export interface TableRowView {
  row: number;
  values: Record<string, string>;
  /** A class for the row (is-late, is-soon). */
  className?: string;
}

/** A note's table, changed cell by cell where it shows; each row can be taken out. */
export function EditTable({ rows, cols, title, canEdit, onSave, onRemove, label }: { rows: TableRowView[]; cols: Col[]; title: string; canEdit: boolean; onSave(row: number, title: string, field: string, value: string): Promise<boolean>; onRemove?(row: number, title: string): void; label: string }) {
  return (
    <div className="pm-table-wrap">
      <table className="pm-table" aria-label={label}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'is-num' : undefined}>
                {c.label}
              </th>
            ))}
            {onRemove && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.values[title] ?? '';
            return (
              <tr key={r.row} className={r.className}>
                {cols.map((c) => {
                  const v = r.values[c.key] ?? '';
                  return (
                    <td key={c.key} className={`${c.strong ? 'pm-td-strong' : ''}${c.num ? ' is-num' : ''}`.trim() || undefined}>
                      {c.kind === 'readonly' ? (
                        <span className="pm-td-plain">{c.shown ? c.shown(v, r) : v || ''}</span>
                      ) : (
                        <Inline value={v} shown={c.shown ? c.shown(v, r) : c.kind === 'date' && v ? dayText(v) : undefined} label={c.label} kind={c.kind === 'money' ? 'number' : (c.kind ?? 'text')} options={c.options} placeholder={c.placeholder ?? ''} canEdit={canEdit} onSave={(x) => onSave(r.row, t, c.key, x)} />
                      )}
                    </td>
                  );
                })}
                {onRemove && (
                  <td className="pm-td-end">
                    <button type="button" className="icon-button small" aria-label={`Take ${t || 'this row'} out`} title="Take it out" disabled={!canEdit} onClick={() => onRemove(r.row, t)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const isImage = (p: string) => /\.(png|jpe?g|gif|webp|avif|heic|bmp)$/i.test(p);
const fileIcon = (p: string): IconName => (/\.pdf$/i.test(p) ? 'pdf' : isImage(p) ? 'image' : /\.(docx?|odt|rtf|txt|md)$/i.test(p) ? 'doc' : 'file');

/** The files kept with a record: pictures as tiles, documents as rows, each opened in a tab; more added from the PC. */
export function FilesList({ files, empty }: { files: string[]; empty: string }) {
  const pics = files.filter(isImage);
  const docs = files.filter((f) => !isImage(f));
  if (!files.length) return <p className="rm-none">{empty}</p>;
  return (
    <>
      {docs.length > 0 && (
        <ul className="pm-files">
          {docs.map((f) => (
            <li key={f}>
              <button type="button" className="pm-file" title={f} onClick={() => A.openPath(f, { where: 'tab' })}>
                <Icon name={fileIcon(f)} size={14} />
                <span className="pm-file-name">{fileName(f)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pics.length > 0 && (
        <ul className="pm-photos">
          {pics.slice(0, 12).map((p) => (
            <li key={p}>
              <button type="button" className="pm-photo" title={fileName(p)} onClick={() => A.openPath(p, { where: 'tab' })}>
                <img src={fileUrl(p)} alt={fileName(p)} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Files from the PC kept with a record (the open-file dialog, then copied beside it). */
export async function keepFiles(module: string, rel: string, name: string, kind?: 'documents' | 'photos'): Promise<void> {
  const files = await workDid(workCall<string[]>(module, 'pick-files', `Files to keep with ${name}`, kind ?? ''), '');
  if (files?.length) await workDid(workCall<string>(module, 'keep-files', rel, files));
}

/** A thin bar of how much of something is used (a budget): its share, and over when past the end. */
export function Meter({ value, of, label }: { value: number; of: number | null; label: string }) {
  const share = of && of > 0 ? value / of : 0;
  const over = !!of && value > of;
  return (
    <div className={`pm-meter${over ? ' is-over' : share > 0.85 ? ' is-near' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of ?? 0} aria-valuenow={value}>
      <span style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
    </div>
  );
}

/** A small line chart (fuel use over fill-ups): points joined, the last one marked, its range at the side. */
export function LineChart({ points, unit, label, height = 120 }: { points: { x: string; y: number }[]; unit: string; label: string; height?: number }) {
  if (points.length < 2) return <p className="rm-none">Two full tanks with odometer readings make the first point; the line starts after that.</p>;
  const W = 600;
  const H = height;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <figure className="pm-chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: from ${points[0].y} to ${last.y} ${unit}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} className="pm-chart-grid" />
        <line x1={pad.l} x2={W - pad.r} y1={y(hi)} y2={y(hi)} className="pm-chart-grid" />
        <path d={`${d} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`} className="pm-chart-area" />
        <path d={d} className="pm-chart-line" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.y)} r={i === points.length - 1 ? 4 : 2.5} className={i === points.length - 1 ? 'pm-chart-dot is-last' : 'pm-chart-dot'} vectorEffect="non-scaling-stroke">
            <title>{`${dayText(p.x)}: ${p.y} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="pm-chart-caption">
        <span>{dayText(points[0].x)}</span>
        <span>
          {lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`}
        </span>
        <span>{dayText(last.x)}</span>
      </figcaption>
    </figure>
  );
}

/** Tiny bars (spend by month) with each month's initial under it. */
export function MonthBars({ months, cur, label }: { months: { month: string; value: number }[]; cur: string; label: string }) {
  const max = Math.max(1, ...months.map((m) => m.value));
  const M = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  return (
    <div className="pm-bars" role="img" aria-label={label}>
      {months.map((m) => (
        <div key={m.month} className="pm-bar" title={`${m.month}: ${money(m.value, cur, false)}`}>
          <span className="pm-bar-fill" style={{ height: `${Math.max(m.value ? 4 : 0, Math.round((m.value / max) * 100))}%` }} />
          <span className="pm-bar-label">{M[Number(m.month.slice(5, 7)) - 1]}</span>
        </div>
      ))}
    </div>
  );
}
