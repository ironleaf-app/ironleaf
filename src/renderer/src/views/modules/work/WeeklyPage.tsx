// Weekly Updates (Wave 6 part b; the spec, section 5.1: "A first-class area for weekly status updates, the way Projects
// is for projects"). This week's update is the page: its header (week, who it goes to, Draft or Sent, when and by whom),
// a card per workstream (its linked project with health and due date, its flag, status line, progress, next steps pulled
// from the project, blockers with "None", metrics as numbers with last week's beside them and a trend), the files sent
// with it, and Export (plain text, Word, PDF) and Mark sent. Every value changes where it shows (double-click, its pencil
// or E). History lists every week; Workstreams shows each one week by week with its metrics as trend lines.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { NamedBrandKit } from '../../../../../shared/assets';
import { kitWords } from '../../../../../shared/brand-kits';
import { sameWhat } from '../../../../../shared/meetings';
import { defaultRecordView } from '../../../../../shared/record-views';
import { noteKit } from '../../../state/share';
import { FLAGS, projectLink, groupLine, metricParts, metricWords, readMetricValue, streamKey, suggestProjects, weekShort, weekTitle, weeklyHtml, addDaysIso, mondayOf, type ExportBrand, type Metric, type ProjectInfo, type WeeklyEdit, type WeeklyModel, type WeeklyUpdate, type Workstream, type WorkstreamHistory, type WeeklyList } from '../../../../../shared/weekly-updates';
import { WEEKDAYS, WEEKLY } from '../../../../../shared/work-modules';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { healthTone } from '../../../lib/projectLook';
import { useEscape } from '../../../lib/useEscape';
import * as A from '../../../state/actions';
import { moduleChanged, openModule, partOfTab } from '../../../state/modules';
import { WeeklyDraft, WeeklyOverview, weeklyPlace } from '../w3b/Weekly87';
import { peek } from '../../../state/peek';
import { showError, toast, useApp } from '../../../state/store';
import { plainWords, useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { EditorContext, Inline } from '../../project/Inline';
import { Card, dayText, openDetail, Pill, placeOf, todayIso, useWorkCtx, WithRecords, WorkShell, WorkViews } from './WorkShell';
import { weeklyNeeds, whenWords } from '../../../../../shared/module-purpose';
import { NeedsYou } from '../NeedsYou';
import { isEnterKey } from '../../../lib/enterKey';

export type Proj = ProjectInfo & { updates: string[]; risks: string[] };
export type WeeklyView = WeeklyModel & { projects: Proj[]; settings: { dueDay: number; audience: string; sentBy: string }; folder: string; importable: { path: string; title: string; weeks: number; new: number }[] };

export const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('weekly', name, ...args);
export const edit = (rel: string, edits: WeeklyEdit | WeeklyEdit[], words?: string) => workDid(call<string>('edit', rel, edits), (said) => words ?? said);
export const flagTone = (f: string): 'ok' | 'warn' | 'bad' | 'none' => (f === 'On track' || f === 'Done' ? 'ok' : f === 'At risk' ? 'warn' : f === 'Blocked' ? 'bad' : 'none');
const projectOf = (name: string, projects: Proj[]) => {
  const n = name.trim().toLowerCase();
  // Identity first (9.2 uplift F49): the note's path, then the display name — never a name that two spellings share.
  return n ? (projects.find((p) => p.path.toLowerCase().replace(/\.md$/, '').endsWith(`/${n}`)) ?? projects.find((p) => p.name.toLowerCase() === n)) : undefined;
};
// Health tones read through the one shared healthTone (9.2 uplift F42): whole words, never substrings.
export { healthTone };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The editing context the in-place fields read (they belong to the module, not a project). */
function Editable({ path, children }: { path: string; children: ReactNode }) {
  const canEdit = useApp((s) => s.canEdit);
  const value = useMemo(() => ({ path, canEdit, known: { people: [], tags: [] }, edit: async () => false }), [path, canEdit]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

// ── Exports ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function brandKitFor(u: WeeklyUpdate): Promise<{ brand: ExportBrand; kit: NamedBrandKit | null; multi: boolean }> {
  const none = { brand: {}, kit: null, multi: false };
  try {
    // The week's own kit, through the one function; a slow first read (a big library) never holds the export up.
    const resolved = await Promise.race([noteKit(u.path), new Promise<null>((r) => window.setTimeout(() => r(null), 2500))]);
    if (!resolved?.kit) return none;
    const b = resolved.kit;
    const colour = b.colours.find((c) => /head|primary|brand|main/i.test(`${c.use ?? ''} ${c.name}`)) ?? b.colours[0];
    const font = b.fonts.find((f) => /head|title|display/i.test(`${f.use ?? ''}`)) ?? b.fonts[0];
    return { brand: { ...(b.name ? { name: b.name } : {}), ...(colour ? { colour: colour.hex } : {}), ...(font ? { font: font.name } : {}) }, kit: b, multi: resolved.multi };
  } catch {
    return none;
  }
}

/** A week may gather a first draft (9.2 uplift F50): drafts gather, sent weeks never do — one guarded
 *  transition keyed by the week, used by both weekly pages. (The carry re-reads main-side: create() reads the
 *  weeks fresh.) */
export function canGatherWeek(u: WeeklyUpdate | null | undefined): u is WeeklyUpdate {
  return !!u && u.status !== 'Sent';
}

/** Weeks gathering right now (9.2 uplift F116): one shared in-flight guard, so a double-tap gathers once. */
const gathering = new Set<string>();

/** Gather a week's first draft through the one guard, used by both weekly pages: once at a time per week, with
 *  the undo text read first when the caller keeps one. Read failures speak; the gather says its own words. */
export async function gatherWeek(u: WeeklyUpdate, onGathered?: (undoText: string) => void): Promise<void> {
  if (!canGatherWeek(u) || gathering.has(u.path)) return;
  gathering.add(u.path);
  try {
    let undoText: string | null = null;
    if (onGathered) {
      try {
        undoText = await window.nv.notes.read(u.path);
      } catch {
        toast('This week’s note couldn’t be read just now. Try gathering again.');
        return;
      }
    }
    const said = await workDid(call<string>('gather', u.path));
    if (said !== null && onGathered && undoText !== null) onGathered(undoText);
  } finally {
    gathering.delete(u.path);
  }
}

export async function copyText(u: WeeklyUpdate) {
  try {
    const text = await call<string>('export-text', u.path);
    await navigator.clipboard.writeText(text);
    toast('Copied as text, ready to paste into an email or Teams.');
  } catch (err) {
    showError(new Error(plainWords(err)));
  }
}
export async function saveWord(u: WeeklyUpdate) {
  const { brand, kit, multi } = await brandKitFor(u);
  const file = await workDid(call<string | null>('export-word', u.path, brand), '');
  if (file) toast(multi ? `Saved ${file.split(/[\\/]/).pop()} ${kitWords(kit)}.` : `Saved ${file.split(/[\\/]/).pop()}.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
}
export async function savePdf(u: WeeklyUpdate, projects: Proj[]) {
  const root = document.createElement('div');
  root.className = 'print-root wu-print-root';
  const info = Object.fromEntries(projects.map((p) => [p.name.toLowerCase(), { health: p.health ? cap(p.health) : '', due: p.due }]));
  const { brand, kit, multi } = await brandKitFor(u);
  root.innerHTML = weeklyHtml(u, brand, info);
  document.body.appendChild(root);
  document.body.classList.add('is-printing');
  try {
    const file = await window.nv.exports.pdf(weekTitle(u.week));
    if (file) toast(multi ? `Saved ${file.split(/[\\/]/).pop()} ${kitWords(kit)}.` : `Saved ${file.split(/[\\/]/).pop()}.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
  } catch (err) {
    showError(new Error(plainWords(err)));
  } finally {
    document.body.classList.remove('is-printing');
    root.remove();
  }
}
export function exportMenu(u: WeeklyUpdate, projects: Proj[]): MenuItem[] {
  return [
    { label: 'Copy as text', icon: 'copy', run: () => void copyText(u) },
    { label: 'Preview the text…', icon: 'text', run: () => void showText(u) },
    { separator: true },
    { label: 'Save as Word…', icon: 'doc', run: () => void saveWord(u) },
    { label: 'Save as PDF…', icon: 'pdf', run: () => void savePdf(u, projects) },
  ];
}

// The text as it will be sent, in a dialog with Copy (one host: the page).
let textShown: { title: string; text: string } | null = null;
const textListeners = new Set<() => void>();
async function showText(u: WeeklyUpdate) {
  try {
    textShown = { title: weekTitle(u.week), text: await call<string>('export-text', u.path) };
    textListeners.forEach((fn) => fn());
  } catch (err) {
    showError(new Error(plainWords(err)));
  }
}
export function TextHost() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    textListeners.add(fn);
    return () => void textListeners.delete(fn);
  }, []);
  const close = () => {
    textShown = null;
    setN((n) => n + 1);
  };
  if (!textShown) return null;
  return <TextDialog t={textShown} close={close} />;
}
/** Only an open dialog listens for Escape (a closed one must never take it from another). */
function TextDialog({ t, close }: { t: { title: string; text: string }; close(): void }) {
  useEscape(close);
  return createPortal(
    <div className="overlay rf-overlay" onMouseDown={close}>
      <div className="dialog rf-dialog wu-text-dialog" role="dialog" aria-modal="true" aria-labelledby="wu-text-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="rf-head">
          <span className="rf-mark" aria-hidden="true">
            <Icon name="text" size={18} />
          </span>
          <div>
            <h2 id="wu-text-title">{t.title} as text</h2>
            <p className="rf-line">Exactly what Copy puts on the clipboard, for an email or Teams.</p>
          </div>
        </header>
        <pre className="wu-text">{t.text}</pre>
        <div className="dialog-actions rf-actions">
          <button type="button" className="button" onClick={close}>
            Close
          </button>
          <button type="button" className="button primary" onClick={() => void navigator.clipboard.writeText(t.text).then(() => (toast('Copied as text.'), close()), showError)}>
            <Icon name="copy" size={13} /> Copy
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Bringing in an older long note of weekly updates ────────────────────────────────────────────────────────────────

type ImportPlan = { path: string; title: string; audience: string; weeks: { week: string; heading: string; exists: boolean; status: string; attachments: number; sections: { name: string; project: string; metrics: number; progress: number }[] }[] };
let importShown: ImportPlan | null = null;
const importListeners = new Set<() => void>();
async function lookOver(path: string) {
  try {
    importShown = await call<ImportPlan>('import-plan', path);
    importListeners.forEach((fn) => fn());
  } catch (err) {
    showError(new Error(plainWords(err)));
  }
}
function ImportHost() {
  const [, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fn = () => setN((n) => n + 1);
    importListeners.add(fn);
    return () => void importListeners.delete(fn);
  }, []);
  const close = () => {
    importShown = null;
    setN((n) => n + 1);
  };
  if (!importShown) return null;
  return <ImportDialog plan={importShown} busy={busy} setBusy={setBusy} close={close} />;
}
function ImportDialog({ plan, busy, setBusy, close }: { plan: ImportPlan; busy: boolean; setBusy(b: boolean): void; close(): void }) {
  useEscape(() => !busy && close());
  const [done, setDone] = useState<{ created: string[]; words: string } | null>(null);
  const fresh = plan.weeks.filter((w) => !w.exists);
  const undo = async () => {
    if (!done?.created.length) return;
    setBusy(true);
    await A.trashPaths(done.created);
    setBusy(false);
    moduleChanged();
    close();
  };
  if (done) {
    return createPortal(
      <div className="overlay rf-overlay" onMouseDown={() => !busy && close()}>
        <div className="dialog rf-dialog wu-import" role="dialog" aria-modal="true" aria-labelledby="wu-import-title" onMouseDown={(e) => e.stopPropagation()}>
          <header className="rf-head">
            <span className="rf-mark" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
            <div>
              <h2 id="wu-import-title">Brought in</h2>
              <p className="rf-line">{done.words}</p>
            </div>
          </header>
          <div className="dialog-actions rf-actions">
            {done.created.length > 0 && (
              <button type="button" className="button" disabled={busy} onClick={() => void undo()}>
                Undo
              </button>
            )}
            <button type="button" className="button primary" disabled={busy} onClick={close}>
              Done
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="overlay rf-overlay" onMouseDown={() => !busy && close()}>
      <div className="dialog rf-dialog wu-import" role="dialog" aria-modal="true" aria-labelledby="wu-import-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="rf-head">
          <span className="rf-mark" aria-hidden="true">
            <Icon name="download" size={18} />
          </span>
          <div>
            <h2 id="wu-import-title">Bring in “{plan.title}”</h2>
            <p className="rf-line">Each week becomes its own update, every line kept: statuses, bullets, blockers, the measures as numbers and the files. “{plan.title}” itself stays as it is.</p>
          </div>
        </header>
        <ul className="wu-import-weeks">
          {plan.weeks.map((w) => (
            <li key={w.week} className={w.exists ? 'is-there' : ''}>
              <div className="wu-import-head">
                <strong>{weekTitle(w.week)}</strong>
                {w.exists ? <Pill tone="none">Already here</Pill> : <Pill tone={w.status === 'Sent' ? 'ok' : 'next'}>{w.status}</Pill>}
              </div>
              <ul className="wu-import-streams">
                {w.sections.map((s) => (
                  <li key={s.name}>
                    <span className="wu-import-name">{s.name}</span>
                    <span className="wu-import-sub">{[s.project ? `linked to ${s.project}` : 'no project linked yet', s.progress ? `${s.progress} progress ${s.progress === 1 ? 'line' : 'lines'}` : '', s.metrics ? `${s.metrics} ${s.metrics === 1 ? 'measure' : 'measures'}` : ''].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
              {w.attachments > 0 && <p className="wu-import-files">{w.attachments} {w.attachments === 1 ? 'file' : 'files'} attached</p>}
            </li>
          ))}
        </ul>
        {plan.audience && <p className="rf-hint">Each goes to {plan.audience}, as the note says.</p>}
        <div className="dialog-actions rf-actions">
          <button type="button" className="button" disabled={busy} onClick={close}>
            Not now
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !fresh.length}
            onClick={async () => {
              setBusy(true);
              const r = await workDid(call<{ created: string[]; words: string }>('import', plan.path), (x) => x.words);
              setBusy(false);
              if (r) setDone({ created: r.created, words: r.words });
            }}
          >
            {fresh.length ? `Bring in ${fresh.length} ${fresh.length === 1 ? 'week' : 'weeks'}` : 'Nothing new to bring in'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A change in a measure: a percentage's change in points ("2.9 pts"), anything else as the measure reads. */
const changeWords = (n: number, unit: string) => (unit === '%' ? `${Math.round(n * 10) / 10} pts` : metricWords({ value: Math.round(n * 100) / 100, unit }));

// ── Trends ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Sparkline({ points, unit }: { points: { week: string; value: number }[]; unit: string }) {
  if (points.length < 2) return null;
  const w = 84;
  const h = 24;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => [2 + (i * (w - 4)) / (points.length - 1), h - 3 - ((p.value - lo) / span) * (h - 6)] as const);
  return (
    <svg className="wu-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Trend: ${points.map((p) => `${weekShort(p.week)} ${metricWords({ value: p.value, unit })}`).join(', ')}`}>
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.4" fill="currentColor" />
    </svg>
  );
}

export function TrendChart({ name, unit, points }: { name: string; unit: string; points: { week: string; value: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(220, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = 150;
  const padL = 12;
  const padR = 12;
  const padT = 26;
  const padB = 26;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => (points.length === 1 ? width / 2 : padL + (i * (width - padL - padR)) / (points.length - 1));
  const y = (v: number) => padT + (1 - (v - (hi === lo ? lo - span / 2 : lo)) / (hi === lo ? span : span)) * (h - padT - padB);
  const last = points[points.length - 1];
  const first = points[0];
  const change = points.length > 1 ? last.value - first.value : 0;
  return (
    <figure className="wu-trend" ref={wrap}>
      <figcaption>
        <span className="wu-trend-name">{name}</span>
        <span className="wu-trend-now">{metricWords({ value: last.value, unit })}</span>
        {points.length > 1 && (
          <span className={`wu-trend-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
            {change > 0 ? '▲' : change < 0 ? '▼' : '='} {changeWords(Math.abs(change), unit)} since {weekShort(first.week)}
          </span>
        )}
        {points.length === 1 && <span className="wu-trend-one">One week so far: the line starts with next week’s number.</span>}
      </figcaption>
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`${name}: ${points.map((p) => `${weekShort(p.week)} ${metricWords({ value: p.value, unit })}`).join(', ')}`}>
        <line x1={padL} x2={width - padR} y1={h - padB} y2={h - padB} className="wu-trend-axis" />
        {points.length > 1 && <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} className="wu-trend-line" fill="none" />}
        {points.map((p, i) => (
          <g key={p.week}>
            <circle cx={x(i)} cy={y(p.value)} r="3.5" className="wu-trend-dot" />
            {(points.length <= 8 || i === 0 || i === points.length - 1) && (
              <text x={x(i)} y={y(p.value) - 9} textAnchor={i === 0 && points.length > 1 ? 'start' : i === points.length - 1 && points.length > 1 ? 'end' : 'middle'} className="wu-trend-value">
                {metricWords({ value: p.value, unit })}
              </text>
            )}
            {(points.length <= 6 || i === 0 || i === points.length - 1) && (
              <text x={x(i)} y={h - 8} textAnchor={i === 0 && points.length > 1 ? 'start' : i === points.length - 1 && points.length > 1 ? 'end' : 'middle'} className="wu-trend-week">
                {weekShort(p.week).replace('w/c ', '')}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

// ── A workstream's card ──────────────────────────────────────────────────────────────────────────────────────────────

function ListBlock({ u, index, list, title, items, canEdit, placeholder, extra, rowAction }: { u: WeeklyUpdate; index: number; list: WeeklyList; title: string; items: string[]; canEdit: boolean; placeholder: string; extra?: ReactNode; rowAction?(i: number, text: string): ReactNode }) {
  const [adding, setAdding] = useState('');
  const add = async () => {
    const t = adding.trim();
    if (!t) return;
    setAdding('');
    await edit(u.path, { kind: 'add-item', section: index, list, text: t });
  };
  return (
    <div className={`wu-block wu-${list}`}>
      <div className="wu-block-head">
        <h4>{title}</h4>
        {extra}
      </div>
      {items.length > 0 && (
        <ul className="wu-lines">
          {items.map((t, i) => (
            <li key={`${i}:${t}`} className="wu-line">
              <span className="wu-bullet" aria-hidden="true" />
              <Inline value={t} label={title} multiline className="wu-line-words" onSave={(v) => edit(u.path, { kind: 'set-item', section: index, list, index: i, text: v }).then((r) => r !== null)} />
              <span className="wu-line-tools">
                {rowAction?.(i, t)}
                {canEdit && (
                  <button type="button" className="icon-button small" title="Take this line out" aria-label="Take this line out" onClick={() => void edit(u.path, { kind: 'remove-item', section: index, list, index: i })}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="wu-add-line">
          <Icon name="plus" size={12} />
          <input
            value={adding}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (isEnterKey(e)) {
                e.preventDefault();
                void add();
              }
              if (e.key === 'Escape') setAdding('');
            }}
            onBlur={() => void add()}
          />
        </div>
      )}
    </div>
  );
}

function MetricsBlock({ u, index, w, history, canEdit }: { u: WeeklyUpdate; index: number; w: Workstream; history?: WorkstreamHistory; canEdit: boolean }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const lastOf = (m: Metric) => {
    const s = history?.metrics.find((x) => x.name.toLowerCase() === m.name.toLowerCase() && x.group.toLowerCase() === m.group.toLowerCase());
    const before = s?.points.filter((p) => p.week < u.week) ?? [];
    return { last: before[before.length - 1] ?? null, points: [...before, ...(m.value !== null ? [{ week: u.week, value: m.value }] : [])] };
  };
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const v = readMetricValue(value);
    if (value.trim() && v.value === null) return showError(new Error('A measure is a number, like 1047 or 96.4%.'));
    setName('');
    setValue('');
    await edit(u.path, { kind: 'metric', section: index, name: n, value: v.value, unit: v.unit });
  };
  const { table, groups } = metricParts(w);
  const row = (m: Metric) => {
    const i = w.metrics.indexOf(m);
    const { last, points } = lastOf(m);
    const change = last && m.value !== null ? m.value - last.value : null;
    return (
      <tr key={`${m.group}|${m.name}|${i}`}>
        <td className="wu-m-name">
          <Inline value={m.name} label="Measure" required onSave={(v) => edit(u.path, { kind: 'metric', section: index, index: i, name: m.name, rename: v, value: m.value }).then((r) => r !== null)} />
        </td>
        <td className="wu-m-value">
          <Inline
            value={m.value === null ? '' : metricWords(m)}
            label={`${m.name} this week`}
            placeholder={last ? `last ${metricWords({ value: last.value, unit: m.unit })}` : 'Add a number'}
            compact
            onSave={async (v) => {
              const r = readMetricValue(v);
              if (v.trim() && r.value === null) {
                showError(new Error('A measure is a number, like 1047 or 96.4%.'));
                return false;
              }
              return (await edit(u.path, { kind: 'metric', section: index, index: i, name: m.name, value: r.value, ...(r.unit || !m.unit ? { unit: r.unit || m.unit } : {}) })) !== null;
            }}
          />
        </td>
        <td className="wu-m-last">{last ? <span title={`Last week (${weekShort(last.week)})`}>{metricWords({ value: last.value, unit: m.unit })}</span> : null}</td>
        <td className="wu-m-change">{change !== null && change !== 0 ? <span className={change > 0 ? 'up' : 'down'}>{change > 0 ? '▲' : '▼'} {changeWords(Math.abs(change), m.unit)}</span> : change === 0 ? <span className="wu-faint">no change</span> : null}</td>
        <td className="wu-m-trend">
          <Sparkline points={points} unit={m.unit} />
        </td>
        <td className="wu-m-tools">
          {canEdit && (
            <button type="button" className="icon-button small" title="Take this measure out" aria-label={`Take ${m.name} out`} onClick={() => void edit(u.path, { kind: 'remove-metric', section: index, index: i })}>
              <Icon name="close" size={12} />
            </button>
          )}
        </td>
      </tr>
    );
  };
  return (
    <div className="wu-block wu-metrics">
      <div className="wu-block-head">
        <h4>Metrics</h4>
        {w.metrics.length > 0 && <span className="wu-faint">numbers, so each one shows as a trend</span>}
      </div>
      {w.metrics.length > 0 && (
        <div className="wu-table-wrap">
          <table className="wu-mtable">
            <thead>
              <tr>
                <th>Measure</th>
                <th className="num">This week</th>
                <th className="num">Last week</th>
                <th className="num">Change</th>
                <th>Trend</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {table.map(row)}
              {groups.map((g) => (
                <GroupRows key={g.group} title={g.group} line={groupLine(g)}>
                  {g.metrics.map(row)}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="wu-add-metric">
          <Icon name="plus" size={12} />
          <input value={name} placeholder="Add a measure" aria-label="New measure’s name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} />
          <input className="wu-add-value" value={value} placeholder="Value" aria-label="New measure’s value" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} />
          <button type="button" className="button small" disabled={!name.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function GroupRows({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <>
      <tr className="wu-m-group">
        <td colSpan={6}>
          <span className="wu-m-group-name">{title}</span>
          <span className="wu-faint" title="How it is sent">
            {' '}
            · sent as “{line}”
          </span>
        </td>
      </tr>
      {children}
    </>
  );
}

function StreamCard({ u, index, w, view, history, canEdit, count }: { u: WeeklyUpdate; index: number; w: Workstream; view: WeeklyView; history?: WorkstreamHistory; canEdit: boolean; count: number }) {
  const p = projectOf(w.project, view.projects);
  const [notesOpen, setNotesOpen] = useState(!!w.notes.trim());
  const flagMenu = (el: HTMLElement) => openMenu(el, [...FLAGS.map((f) => ({ label: f, icon: (f === w.flag ? 'check' : 'flag') as IconName, run: () => void edit(u.path, { kind: 'section', section: index, field: 'flag', value: f }) })), ...(w.flag ? [{ separator: true as const }, { label: 'No flag', icon: 'close' as IconName, run: () => void edit(u.path, { kind: 'section', section: index, field: 'flag', value: '' }) }] : [])]);
  const linkMenu = (el: HTMLElement) => {
    const best = suggestProjects(w.name, view.projects).slice(0, 5);
    const rest = view.projects.filter((x) => !best.some((b) => b.path === x.path)).sort((a, b) => a.name.localeCompare(b.name));
    openMenu(el, [
      ...best.map((b) => ({ label: b.name, icon: 'star' as IconName, run: () => void edit(u.path, { kind: 'section', section: index, field: 'project', value: projectLink(b) }, `Linked ${w.name} to ${b.name}.`) })),
      ...(best.length && rest.length ? [{ separator: true as const }] : []),
      ...rest.slice(0, 40).map((b) => ({ label: b.name, icon: 'layers' as IconName, run: () => void edit(u.path, { kind: 'section', section: index, field: 'project', value: projectLink(b) }, `Linked ${w.name} to ${b.name}.`) })),
      ...(w.project ? [{ separator: true as const }, { label: 'Unlink the project', icon: 'close' as IconName, run: () => void edit(u.path, { kind: 'section', section: index, field: 'project', value: '' }) }] : []),
    ]);
  };
  const pull = (el: HTMLElement) => {
    if (!p) return;
    const have = new Set(w.next.map(sameWhat));
    const open = p.next.filter((n) => !have.has(sameWhat(n)));
    if (!open.length) return toast(p.next.length ? `Every open next step of ${p.name} is here already.` : `${p.name} has no open next steps.`);
    openMenu(el, [
      { label: `Add all ${open.length}`, icon: 'plus', run: () => void edit(u.path, open.map((t) => ({ kind: 'add-item' as const, section: index, list: 'next' as const, text: t })), `Added ${open.length} next steps from ${p.name}.`) },
      { separator: true },
      ...open.slice(0, 20).map((t) => ({ label: t, icon: 'task' as IconName, run: () => void edit(u.path, { kind: 'add-item', section: index, list: 'next', text: t }) })),
    ]);
  };
  const toProject = (what: 'progress' | 'risk', i: number, there: boolean) =>
    p ? (
      there ? (
        <span className="wu-in-project" title={`In ${p.name}’s ${what === 'progress' ? 'updates' : 'risks'}`}>
          <Icon name="check" size={11} /> In project
        </span>
      ) : canEdit ? (
        <button type="button" className="wu-to-project" title={what === 'progress' ? `Write this into ${p.name}’s updates` : `Add this to ${p.name}’s risks`} onClick={() => void workDid(call<string>('to-project', u.path, index, what, i))}>
          <Icon name="outgoing" size={11} /> {what === 'progress' ? 'To project' : 'Add as risk'}
        </button>
      ) : null
    ) : null;
  const more = (el: HTMLElement) =>
    openMenu(el, [
      { label: 'Move up', icon: 'back', disabled: !canEdit || index === 0, run: () => void edit(u.path, { kind: 'move-section', section: index, to: index - 1 }) },
      { label: 'Move down', icon: 'forward', disabled: !canEdit || index === count - 1, run: () => void edit(u.path, { kind: 'move-section', section: index, to: index + 1 }) },
      { separator: true },
      { label: 'Its history, week by week', icon: 'history', disabled: !history, run: () => history && openDetail('weekly', 'ws', history.key) },
      { label: w.project ? 'Change the project…' : 'Link a project…', icon: 'layers', disabled: !canEdit, run: () => linkMenu(el) },
      ...(p ? [{ label: `Open ${p.name}`, icon: 'layers' as IconName, run: () => A.openPath(p.path, { where: 'tab' }) }] : []),
      { label: notesOpen ? 'Hide notes' : 'Add notes', icon: 'notes', run: () => setNotesOpen(!notesOpen) },
      { separator: true },
      { label: 'Take it out of this week', icon: 'trash', disabled: !canEdit, run: () => void edit(u.path, { kind: 'remove-section', section: index }) },
    ]);
  return (
    <section className={`wu-stream tone-${flagTone(w.flag)}`} aria-label={w.name}>
      <header className="wu-stream-head">
        <span className="wu-num" aria-hidden="true">
          {index + 1}
        </span>
        <div className="wu-stream-title">
          <Inline value={w.name} label="Workstream" required className="wu-stream-name" onSave={(v) => edit(u.path, { kind: 'section', section: index, field: 'name', value: v }).then((r) => r !== null)} />
          <div className="wu-stream-meta">
            {p ? (
              <button type="button" className="wu-project" onClick={() => peek({ path: p.path }, { title: p.name, type: 'note' })} onContextMenu={(e) => (e.preventDefault(), canEdit && linkMenu(e.currentTarget))} title={`Open ${p.name} · right-click to change`}>
                <Icon name="layers" size={12} />
                <span className="wu-project-name">{p.name}</span>
                {p.health && <Pill tone={healthTone(p.health)}>{cap(p.health)}</Pill>}
                {p.due && <span className="wu-faint">due {dayText(p.due) || p.due}</span>}
              </button>
            ) : w.project ? (
              <button type="button" className="wu-project is-missing" disabled={!canEdit} onClick={(e) => linkMenu(e.currentTarget)} title="That project isn’t in the vault now: choose another">
                <Icon name="warning" size={12} /> {w.project} (not found)
              </button>
            ) : (
              canEdit && (
                <button type="button" className="wu-link" onClick={(e) => linkMenu(e.currentTarget)}>
                  <Icon name="plus" size={12} /> Link a project
                </button>
              )
            )}
            {p && canEdit && (
              <button type="button" className="icon-button small wu-relink" title="Change the project" aria-label="Change the project" onClick={(e) => linkMenu(e.currentTarget)}>
                <Icon name="chevron" size={11} />
              </button>
            )}
          </div>
        </div>
        <button type="button" className={`wu-flag tone-${flagTone(w.flag)}`} disabled={!canEdit} onClick={(e) => flagMenu(e.currentTarget)} title="Its flag: On track, At risk, Blocked or Done">
          <span className="ws-dot" />
          {w.flag || 'Set a flag'}
          <Icon name="chevron" size={10} />
        </button>
        <button type="button" className="icon-button small" aria-label={`More for ${w.name}`} title="More" onClick={(e) => more(e.currentTarget)}>
          <Icon name="more" size={14} />
        </button>
      </header>
      <div className="wu-status">
        <span className="wu-status-label">Status</span>
        <Inline value={w.status} label="Status" placeholder="A short status line" multiline className="wu-status-words" onSave={(v) => edit(u.path, { kind: 'section', section: index, field: 'status', value: v }).then((r) => r !== null)} />
      </div>
      <div className="wu-grid">
        <ListBlock u={u} index={index} list="progress" title="Progress" items={w.progress} canEdit={canEdit} placeholder="What moved this week" rowAction={(i, t) => toProject('progress', i, !!p && p.updates.includes(sameWhat(t)))} />
        <ListBlock
          u={u}
          index={index}
          list="next"
          title="Next steps"
          items={w.next}
          canEdit={canEdit}
          placeholder="What happens next"
          extra={
            p && canEdit ? (
              <button type="button" className="text-button wu-pull" onClick={(e) => pull(e.currentTarget)} title={`Choose from ${p.name}’s open next steps`}>
                <Icon name="download" size={11} /> From {p.name.length > 22 ? 'the project' : p.name}
              </button>
            ) : undefined
          }
        />
        <div className="wu-block wu-blockers">
          <div className="wu-block-head">
            <h4>Blockers / Risks</h4>
            {canEdit && (
              <button type="button" role="switch" aria-checked={w.none} className={`wu-none${w.none ? ' is-on' : ''}`} onClick={() => void edit(u.path, { kind: 'none', section: index, none: !w.none })} title="Say there are none">
                {w.none ? <Icon name="check" size={11} /> : null} None
              </button>
            )}
          </div>
          {w.none ? (
            <p className="wu-none-words">
              <Inline value={w.noneWords || 'None'} label="None" compact onSave={() => undefined} />
            </p>
          ) : (
            <ListBlock u={u} index={index} list="blockers" title="" items={w.blockers} canEdit={canEdit} placeholder="A blocker or risk" rowAction={(i, t) => toProject('risk', i, !!p && p.risks.includes(sameWhat(t)))} />
          )}
        </div>
      </div>
      <MetricsBlock u={u} index={index} w={w} history={history} canEdit={canEdit} />
      {(notesOpen || w.notes.trim()) && (
        <div className="wu-block wu-notes">
          <div className="wu-block-head">
            <h4>Notes</h4>
          </div>
          <Inline value={w.notes} label="Notes" multiline placeholder="Anything else for this workstream" onSave={(v) => edit(u.path, { kind: 'section', section: index, field: 'notes', value: v }).then((r) => r !== null)} />
        </div>
      )}
    </section>
  );
}

// ── A week's update ──────────────────────────────────────────────────────────────────────────────────────────────────

function DueLine({ view, u }: { view: WeeklyView; u: WeeklyUpdate | null }) {
  if (u?.status === 'Sent') return <Pill tone="ok">{`Sent${u.sent ? ` ${dayText(u.sent)}` : ''}${u.sentBy ? ` by ${u.sentBy}` : ''}`}</Pill>;
  const week = u?.week ?? view.thisWeek;
  if (week !== view.thisWeek) return <Pill tone="none">Draft</Pill>;
  const d = view.due;
  return <Pill tone={d.overdue ? 'bad' : d.dueToday ? 'warn' : 'next'}>{d.overdue ? `Overdue (due ${dayText(d.dueDay)})` : d.dueToday ? 'Due today' : `Draft · due ${dayText(d.dueDay)}`}</Pill>;
}

function WeekBar({ view, week, u }: { view: WeeklyView; week: string; u: WeeklyUpdate | null }) {
  const weeks = [...new Set([...view.updates.map((x) => x.week), view.thisWeek])].sort();
  const i = weeks.indexOf(week);
  const prev = i > 0 ? weeks[i - 1] : null;
  const next = i >= 0 && i < weeks.length - 1 ? weeks[i + 1] : null;
  const go = (w: string) => (w === view.thisWeek ? openModule('weekly', 'overview') : openDetail('weekly', 'week', w));
  return (
    <div className="wu-weekbar">
      <button type="button" className="icon-button" disabled={!prev} aria-label="The week before" title={prev ? weekTitle(prev) : 'No earlier week'} onClick={() => prev && go(prev)}>
        <Icon name="back" size={14} />
      </button>
      <div className="wu-weekbar-words">
        <h2>{weekTitle(week)}</h2>
        <span className="wu-faint">
          {dayText(week)} to {dayText(addDaysIso(week, 6))}
          {week === view.thisWeek ? ' · this week' : ''}
        </span>
      </div>
      <button type="button" className="icon-button" disabled={!next} aria-label="The week after" title={next ? weekTitle(next) : 'No later week'} onClick={() => next && go(next)}>
        <Icon name="forward" size={14} />
      </button>
      {week !== view.thisWeek && (
        <button type="button" className="text-button" onClick={() => go(view.thisWeek)}>
          This week
        </button>
      )}
      <span className="wu-weekbar-gap" />
      <DueLine view={view} u={u} />
    </div>
  );
}

function StartWeek({ view, week, canEdit }: { view: WeeklyView; week: string; canEdit: boolean }) {
  const last = [...view.updates].filter((x) => x.week < week).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null;
  const carried = last?.sections.filter((s) => s.flag !== 'Done') ?? [];
  const start = async (fromLast: boolean) => {
    const rel = await workDid(call<string>('create', week, { fromLast }), fromLast && last ? `Started the ${weekTitle(week).replace(/^Week/, 'week')} from the ${weekTitle(last.week).replace(/^Week/, 'week')}.` : `Started the ${weekTitle(week).replace(/^Week/, 'week')}.`);
    if (rel && week !== view.thisWeek) openDetail('weekly', 'week', week);
  };
  return (
    <div className="wu-start">
      <EmptyState
        icon="review"
        title={week === view.thisWeek ? 'This week’s update isn’t started yet' : `No update for the ${weekTitle(week).replace(/^Week/, 'week')}`}
        line={last ? `Start from the ${weekTitle(last.week).replace(/^Week/, 'week')}: its ${carried.length} ${carried.length === 1 ? 'workstream' : 'workstreams'}, projects, flags, status lines, next steps, blockers and measures carry on, so only what changed is typed. Last week’s numbers show beside each measure.` : 'Each workstream gets its own section: a status line and flag, progress, next steps, blockers and metrics kept as numbers.'}
        action={{ label: last ? 'Start from last week' : 'Start this update', icon: 'plus', run: () => void start(true), disabled: !canEdit }}
        also={last ? { label: 'Start blank', icon: 'doc', run: () => void start(false), disabled: !canEdit } : undefined}
      />
      <p className="wu-faint">This is the update you send out each week. It is not the weekly review in Goals (your goals and habits), or the Weekly Review over your projects.</p>
      {carried.length > 0 && (
        <ul className="wu-carry">
          {carried.map((s) => (
            <li key={s.name}>
              <Pill tone={flagTone(s.flag)}>{s.flag || 'No flag'}</Pill>
              <span className="wu-carry-name">{s.name}</span>
              <span className="wu-faint">{s.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddStream({ u, view, canEdit }: { u: WeeklyUpdate; view: WeeklyView; canEdit: boolean }) {
  const [name, setName] = useState('');
  if (!canEdit) return null;
  const here = new Set(u.sections.map((s) => streamKey(s.name)));
  const earlier = view.workstreams.filter((h) => !here.has(h.key)).slice(0, 8);
  const add = async (n: string, project = '') => {
    const t = n.trim();
    if (!t) return;
    setName('');
    await edit(u.path, { kind: 'add-section', name: t, project }, `Added ${t}.`);
  };
  return (
    <div className="wu-add-stream">
      <div className="wu-add-line wu-add-stream-line">
        <Icon name="plus" size={13} />
        <input value={name} placeholder="Add a workstream" aria-label="New workstream’s name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add(name))} />
        <button type="button" className="button small" disabled={!name.trim()} onClick={() => void add(name)}>
          Add
        </button>
      </div>
      {earlier.length > 0 && (
        <div className="wu-again">
          <span className="wu-faint">From earlier weeks:</span>
          {earlier.map((h) => (
            <button key={h.key} type="button" className="wu-chip" onClick={() => void add(h.name, h.project)}>
              <Icon name="plus" size={10} /> {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Attachments({ u, canEdit }: { u: WeeklyUpdate; canEdit: boolean }) {
  return (
    <Card
      id="attach"
      title="Attachments"
      count={u.attachments.length}
      actions={
        canEdit ? (
          <button type="button" className="text-button" onClick={() => void workDid(call<string>('attach', u.path))}>
            <Icon name="paperclip" size={12} /> Attach files
          </button>
        ) : undefined
      }
    >
      {u.attachments.length ? (
        <ul className="wu-files">
          {u.attachments.map((a, i) => (
            <li key={`${a.name}:${i}`} className="wu-file">
              <button type="button" className="wu-file-main" disabled={!a.link} onClick={() => a.link && A.openPath(a.link, { where: 'tab' })} title={a.link ? `Open ${a.name}` : 'Named only: no file is linked'}>
                <span className="wu-file-icon" aria-hidden="true">
                  <Icon name={/\.xlsx?$|\.csv$/i.test(a.name) ? 'table' : /\.pdf$/i.test(a.name) ? 'pdf' : /\.(png|jpe?g|gif|webp)$/i.test(a.name) ? 'image' : 'file'} size={16} />
                </span>
                <span className="wu-file-name">{a.name}</span>
              </button>
              <Inline value={a.what} label="What it is" placeholder="What it is" className="wu-file-what" onSave={(v) => edit(u.path, { kind: 'set-attachment', index: i, what: v }).then((r) => r !== null)} />
              {canEdit && (
                <button type="button" className="icon-button small" aria-label={`Take ${a.name} off`} title="Take it off this update (the file stays)" onClick={() => void edit(u.path, { kind: 'remove-attachment', index: i })}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rm-none">Files sent with this update show here as cards.</p>
      )}
    </Card>
  );
}

function WeekEditor({ view, week, canEdit }: { view: WeeklyView; week: string; canEdit: boolean }) {
  const u = view.updates.find((x) => x.week === week) ?? null;
  const hist = useMemo(() => new Map(view.workstreams.map((h) => [h.key, h])), [view.workstreams]);
  const histOf = (w: Workstream) => hist.get(streamKey(w.name)) ?? view.workstreams.find((h) => w.project && h.project.toLowerCase() === w.project.toLowerCase());
  return (
    <div className="wu-week">
      <WeekBar view={view} week={week} u={u} />
      {!u ? (
        <StartWeek view={view} week={week} canEdit={canEdit} />
      ) : (
        <Editable path={u.path}>
          <div className="wu-header">
            <div className="wu-header-fields">
              <label className="wu-field">
                <span>To</span>
                <Inline value={u.audience} label="Who it goes to" placeholder="Who it goes to" compact onSave={(v) => edit(u.path, { kind: 'header', field: 'audience', value: v }).then((r) => r !== null)} />
              </label>
              <label className="wu-field">
                <span>Status</span>
                <button type="button" className={`wu-status-pill tone-${u.status === 'Sent' ? 'ok' : 'next'}`} disabled={!canEdit} onClick={(e) => openMenu(e.currentTarget, [{ label: 'Draft', icon: u.status === 'Draft' ? 'check' : 'pencil', run: () => void edit(u.path, { kind: 'header', field: 'status', value: 'Draft' }) }, { label: 'Sent', icon: u.status === 'Sent' ? 'check' : 'send', run: () => void workDid(call<string>('mark-sent', u.path, {})) }])}>
                  {u.status}
                  <Icon name="chevron" size={10} />
                </button>
              </label>
              {u.status === 'Sent' && (
                <>
                  <label className="wu-field">
                    <span>Sent</span>
                    <Inline value={u.sent ? dayText(u.sent) : ''} label="Day it was sent" placeholder="Add the day" compact onSave={(v) => edit(u.path, { kind: 'header', field: 'sent', value: v }).then((r) => r !== null)} />
                  </label>
                  <label className="wu-field">
                    <span>By</span>
                    <Inline value={u.sentBy} label="Sent by" placeholder="Who sent it" compact onSave={(v) => edit(u.path, { kind: 'header', field: 'sentBy', value: v }).then((r) => r !== null)} />
                  </label>
                </>
              )}
            </div>
            <div className="wu-header-actions">
              <button type="button" className="sv-tool" onClick={(e) => openMenu(e.currentTarget, exportMenu(u, view.projects))}>
                <Icon name="download" size={14} /> Export
                <Icon name="chevron" size={10} />
              </button>
              {u.status !== 'Sent' && (
                <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => void workDid(call<string>('mark-sent', u.path, {}))} title="It went: today’s date and your name are kept with it">
                  <Icon name="send" size={14} /> Mark sent
                </button>
              )}
            </div>
          </div>
          <div className="wu-intro">
            <Inline value={u.intro} label="Words at the top" multiline placeholder="Add words at the top (where the figures came from…)" onSave={(v) => edit(u.path, { kind: 'header', field: 'intro', value: v }).then((r) => r !== null)} />
          </div>
          {u.sections.length === 0 && <p className="rm-none wu-no-streams">No workstreams yet. Add the first below: each gets a status line, a flag, progress, next steps, blockers and metrics.</p>}
          <div className="wu-streams">
            {u.sections.map((w, i) => (
              <StreamCard key={`${i}:${w.name}`} u={u} index={i} w={w} view={view} history={histOf(w)} canEdit={canEdit} count={u.sections.length} />
            ))}
          </div>
          <AddStream u={u} view={view} canEdit={canEdit} />
          <Attachments u={u} canEdit={canEdit} />
        </Editable>
      )}
    </div>
  );
}

// ── History and workstreams ──────────────────────────────────────────────────────────────────────────────────────────

function weeklyRecords(view: WeeklyView): WsRecord[] {
  const out: WsRecord[] = [];
  for (const u of view.updates) {
    const flags = u.sections.map((s) => s.flag).filter(Boolean);
    out.push({ id: `${u.path}::weekly`, kind: 'weekly', title: weekTitle(u.week), path: u.path, fields: { week: u.week, audience: u.audience || null, status: u.status, sent: u.sent || null, sent_by: u.sentBy || null, workstreams: u.sections.length, flag: flags.includes('Blocked') ? 'Blocked' : flags.includes('At risk') ? 'At risk' : flags.length ? 'On track' : null }, links: [] });
    u.sections.forEach((s, i) => out.push({ id: `${u.path}::wsweek:${i}`, kind: 'wsweek', title: s.name, path: u.path, ...(s.project ? { projectName: s.project } : {}), fields: { week: u.week, flag: s.flag || null, status_line: s.status || null, blockers: s.none ? s.noneWords || 'None' : s.blockers.join(' ') || null }, links: [] }));
  }
  return out;
}

function WorkstreamCards({ view }: { view: WeeklyView }) {
  if (!view.workstreams.length) return <p className="rm-none">Workstreams show here once an update has them.</p>;
  return (
    <ul className="wu-ws-cards">
      {view.workstreams.map((h) => {
        const m = h.metrics.find((x) => x.points.length > 1) ?? h.metrics.find((x) => x.points.length);
        return (
          <li key={h.key}>
            <button type="button" className="wu-ws-card" onClick={() => openDetail('weekly', 'ws', h.key)}>
              <span className="wu-ws-card-head">
                <span className="wu-ws-card-name">{h.name}</span>
                <Pill tone={flagTone(h.last.flag)}>{h.last.flag || 'No flag'}</Pill>
              </span>
              <span className="wu-ws-card-status">{h.last.status || 'No status line'}</span>
              <span className="wu-ws-card-foot">
                <span className="wu-faint">
                  {h.weeks.length} {h.weeks.length === 1 ? 'week' : 'weeks'} · last {weekShort(h.last.week)}
                  {h.project ? ` · ${h.project}` : ''}
                </span>
                {m && m.points.length > 1 && (
                  <span className="wu-ws-card-metric" title={m.name}>
                    <Sparkline points={m.points} unit={m.unit} /> {metricWords({ value: m.points[m.points.length - 1].value, unit: m.unit })}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function WorkstreamPage({ view, h }: { view: WeeklyView; h: WorkstreamHistory }) {
  const p = projectOf(h.project, view.projects);
  const charts = h.metrics.filter((m) => m.points.length > 0);
  return (
    <div className="wu-history">
      {p && (
        <button type="button" className="wu-project wu-history-project" onClick={() => peek({ path: p.path }, { title: p.name, type: 'note' })}>
          <Icon name="layers" size={12} /> <span className="wu-project-name">{p.name}</span>
          {p.health && <Pill tone={healthTone(p.health)}>{cap(p.health)}</Pill>}
          {p.due && <span className="wu-faint">due {dayText(p.due) || p.due}</span>}
        </button>
      )}
      {charts.length > 0 && (
        <Card id="trends" title="Metrics, week by week" count={charts.length}>
          <div className="wu-trends">
            {charts.map((m) => (
              <TrendChart key={`${m.group}|${m.name}`} name={m.group ? `${m.group} · ${m.name}` : m.name} unit={m.unit} points={m.points} />
            ))}
          </div>
        </Card>
      )}
      <Card id="weeks" title="Every week" count={h.weeks.length}>
        <ol className="wu-timeline">
          {[...h.weeks].reverse().map((pt) => (
            <li key={pt.week} className="wu-tl">
              <span className={`wu-tl-dot tone-${flagTone(pt.flag)}`} aria-hidden="true" />
              <div className="wu-tl-body">
                <div className="wu-tl-head">
                  <button type="button" className="wu-tl-week" onClick={() => (pt.week === view.thisWeek ? openModule('weekly', 'overview') : openDetail('weekly', 'week', pt.week))}>
                    {weekTitle(pt.week)}
                  </button>
                  <Pill tone={flagTone(pt.flag)}>{pt.flag || 'No flag'}</Pill>
                </div>
                {pt.status && <p className="wu-tl-status">{pt.status}</p>}
                {pt.progress.length > 0 && (
                  <ul className="wu-tl-progress">
                    {pt.progress.slice(0, 4).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                    {pt.progress.length > 4 && <li className="wu-faint">and {pt.progress.length - 4} more</li>}
                  </ul>
                )}
                <p className="wu-tl-blockers">
                  <span>Blockers / Risks:</span> {pt.none ? pt.noneWords || 'None' : pt.blockers.join(' ') || 'None said'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// ── Options ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function optionsMenu(view: WeeklyView): MenuItem[] {
  return [
    ...WEEKDAYS.map((d, i) => ({ label: `Due on ${d}`, icon: (view.settings.dueDay === i ? 'check' : 'calendar') as IconName, run: () => void workDid(call('options', { dueDay: i }), `Weekly updates are due on ${d} from now on.`) })),
  ];
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function WeeklyClassic({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const { data: view, error } = useWork<WeeklyView>('weekly');
  const { section, detail } = placeOf(tab, WEEKLY);
  const records = useMemo(() => (view ? weeklyRecords(view) : []), [view]);
  const ctx = useWorkCtx('weekly', records, {
    editable: (r) => (r.kind === 'weekly' ? ['audience', 'status', 'sent', 'sent_by'] : []),
    open: (r) => {
      const wk = r.fields.week as string;
      if (r.kind === 'weekly' || r.kind === 'wsweek') return view && wk === view.thisWeek ? openModule('weekly', 'overview') : openDetail('weekly', 'week', wk);
    },
  });
  const week = detail?.kind === 'week' ? mondayOf(detail.key) : view?.thisWeek ?? mondayOf(todayIso());
  const ws = detail?.kind === 'ws' && view ? view.workstreams.find((h) => h.key === detail.key) : undefined;
  const audience = view?.settings.audience ?? '';
  const more = (): MenuItem[] => [
    { label: 'Start this week’s update', icon: 'plus', disabled: !canEdit || !view || !!view.current, run: () => view && void workDid(call<string>('create', view.thisWeek, { fromLast: true }), 'Started this week’s update from last week.') },
    { label: 'Gather a first draft from your projects', icon: 'sparkle', disabled: !canEdit || !canGatherWeek(view?.current), run: () => canGatherWeek(view?.current) && canEdit && void gatherWeek(view.current) },
    ...(view?.importable.length ? view.importable.map((x) => ({ label: `Bring in “${x.title}”…`, icon: 'download' as IconName, disabled: !canEdit, run: () => void lookOver(x.path) })) : []),
    { separator: true },
    { label: 'Due day', icon: 'calendar', disabled: !canEdit || !view, submenu: view ? optionsMenu(view) : [] },
    { label: audience ? `Goes to ${audience} unless changed…` : 'Who updates go to…', icon: 'person', disabled: !canEdit, run: () => void askAudience(audience) },
    { label: 'Show the folder', icon: 'folder', disabled: !view, run: () => view && A.revealInExplorer(view.folder) },
  ];
  const detailInfo = detail?.kind === 'week' ? { title: weekTitle(week), back: { section: 'history', label: 'History' } } : ws ? { title: ws.name, line: `${ws.weeks.length} ${ws.weeks.length === 1 ? 'week' : 'weeks'} of updates${ws.names.length > 1 ? `, also called ${ws.names.filter((n) => n !== ws.name).join(', ')}` : ''}.`, back: { section: 'workstreams', label: 'Workstreams' }, badge: <Pill tone={flagTone(ws.last.flag)}>{ws.last.flag || 'No flag'}</Pill> } : null;
  const shownWeek = detail?.kind === 'week' ? week : view?.thisWeek;
  const u = view?.updates.find((x) => x.week === shownWeek) ?? null;
  const actions =
    view && (section === 'overview' || detail?.kind === 'week') && !u && canEdit ? (
      <button type="button" className="sv-tool nt-new" onClick={() => void workDid(call<string>('create', week, { fromLast: true }), 'Started from last week.')}>
        <Icon name="plus" size={14} /> Start from last week
      </button>
    ) : null;
  return (
    <WithRecords ctx={ctx}>
      <WorkShell tab={tab} module={WEEKLY} sections={WEEKLY.sections} here={section} detail={detailInfo} actions={actions} more={more}>
        {error ? (
          <p className="rm-failed">{error}</p>
        ) : !view ? (
          <div className="view-loading" />
        ) : (
          <>
            {view.importable.length > 0 && section !== 'workstreams' && !detail && (
              <div className="wu-import-offer">
                <Icon name="download" size={16} />
                <p>
                  <strong>“{view.importable[0].title}”</strong> holds {view.importable[0].new} {view.importable[0].new === 1 ? 'week' : 'weeks'} of updates written by hand. Bring {view.importable[0].new === 1 ? 'it' : 'them'} in as weekly records, every line kept; the note stays as it is.
                </p>
                <button type="button" className="button small" disabled={!canEdit} onClick={() => void lookOver(view.importable[0].path)}>
                  Look it over
                </button>
              </div>
            )}
            {detail?.kind === 'ws' ? (
              ws ? <WorkstreamPage view={view} h={ws} /> : <EmptyState icon="chart" title="That workstream isn’t here any more" line="Its weeks may have been renamed or removed." action={{ label: 'Workstreams', icon: 'back', run: () => openModule('weekly', 'workstreams') }} />
            ) : detail?.kind === 'week' || section === 'overview' ? (
              <>
                {section === 'overview' && !detail && <NeedsYou cards={weeklyNeeds(view.current, view.thisWeek, view.due.dueDay, view.today)} today={view.today} canEdit={canEdit} onAction={() => { const u = view.current; if (u) void workDid(call<string>('mark-sent', u.path, {})); else void workDid(call<string>('create', view.thisWeek, { fromLast: true }), 'Started this week’s update from last week.'); }} />}
                {section === 'overview' && !detail && <p className="wu-cross-note">This is the update you send to your team, boss or client. It is not the weekly review in Goals (your own look-back) or a project catch-up. Use Gather a first draft from your projects in the menu above and it fills in what your projects already say; you correct it before it goes.</p>}
                <WeekEditor view={view} week={week} canEdit={canEdit} />
              </>
            ) : section === 'history' ? (
              view.updates.length ? (
                <WorkViews module="weekly" section="history" records={records} made={[{ ...defaultRecordView(['weekly'], 'table', 'Every week'), scope: 'vault', fields: ['audience', 'status', 'sent', 'sent_by', 'workstreams', 'flag'], sort: { field: 'week', dir: 'desc' }, showDone: true }]} />
              ) : (
                <EmptyState icon="history" title="No weeks yet" line="Each week’s update shows here once it is started." action={{ label: 'Start this week’s update', icon: 'plus', run: () => void workDid(call<string>('create', view.thisWeek, { fromLast: true })), disabled: !canEdit }} />
              )
            ) : (
              <div className="wu-ws-page">
                <WorkstreamCards view={view} />
                {records.some((r) => r.kind === 'wsweek') && <WorkViews module="weekly" section="workstreams" records={records} made={[{ ...defaultRecordView(['wsweek'], 'table', 'Every workstream, every week'), scope: 'vault', fields: ['week', 'flag', 'status_line', 'blockers', 'project'], groupBy: 'title', sort: { field: 'week', dir: 'desc' }, showDone: true }]} />}
              </div>
            )}
          </>
        )}
        <TextHost />
        <ImportHost />
      </WorkShell>
    </WithRecords>
  );
}

async function askAudience(now: string) {
  const { openRecordForm, valueWords } = await import('../RecordForm');
  openRecordForm({
    title: 'Who weekly updates go to',
    icon: 'person',
    line: 'A new week’s update starts with this name (each week can still say another).',
    ok: 'Save',
    fields: [
      { key: 'audience', label: 'They go to', kind: 'text', wide: true, value: now, placeholder: 'Sam Lee' },
      { key: 'sentBy', label: 'Sent by', kind: 'text', wide: true, placeholder: 'Your name, kept when an update is marked sent' },
    ],
    submit: async (v) => {
      await call('options', { audience: valueWords(v, 'audience'), sentBy: valueWords(v, 'sentBy') });
      toast('Saved.');
    },
  });
}

// ── On Today ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── The 8.7 page (30 Oct 2026): the new update and draft, the rest as before ───────────────────────────────────

export function WeeklyPage({ tab }: { tab: W.TabState }) {
  const place = weeklyPlace(tab);
  if (place === 'overview') return <WeeklyOverview tab={tab} />;
  if (place === 'draft') return <WeeklyDraft tab={tab} />;
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'overview'; return <WeeklyClassic tab={{ ...tab, path: `module:weekly#${suffix}` }} />; }
  return <WeeklyClassic tab={tab} />;
}

export function WeeklyToday() {
  const canEdit = useApp((s) => s.canEdit);
  const { data: view } = useWork<WeeklyView>('weekly');
  if (!view || view.due.state === 'sent') return null;
  const u = view.current;
  const filled = u ? u.sections.filter((s) => s.progress.length || s.status.trim()).length : 0;
  const d = view.due;
  return (
    <section className="td-section rm-today wu-today" data-section="weekly" aria-labelledby="td-h-weekly">
      <header className="td-section-head">
        <h2 id="td-h-weekly">Weekly update due</h2>
        <button type="button" className="td-section-link" onClick={() => openModule('weekly')}>
          <Icon name="review" size={13} /> Weekly
        </button>
      </header>
      <ul className="rm-today-rows">
        <li className={`rm-today-row${d.overdue ? ' is-late' : ''}`}>
          <button type="button" className="rm-today-main" onClick={() => openModule('weekly')}>
            <span className="rm-today-name">This week’s update</span>
            <span className="rm-today-sub">
              {weekShort(view.thisWeek)} · {u ? `Draft · ${u.sections.length} ${u.sections.length === 1 ? 'workstream' : 'workstreams'}${u.sections.length ? `, ${filled} written this week` : ''}` : 'Not started yet'} · {d.overdue ? whenWords(d.dueDay, view.today) : d.dueToday ? 'due today' : `due ${dayText(d.dueDay)}`}
            </span>
          </button>
          {!u ? (
            <button type="button" className="button small" disabled={!canEdit} onClick={() => void workDid(call<string>('create', view.thisWeek, { fromLast: true }), view.last ? 'Started this week’s update from last week.' : 'Started this week’s update.').then((r) => r && openModule('weekly'))}>
              {view.last ? 'Start from last week' : 'Start it'}
            </button>
          ) : (
            <button type="button" className="button small" disabled={!canEdit} onClick={() => void workDid(call<string>('mark-sent', u.path, {}))} title="It went: today’s date is kept with it">
              Mark sent
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}
