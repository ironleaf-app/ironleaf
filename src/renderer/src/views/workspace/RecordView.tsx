// A view anyone can build over records (24 Oct 2026, Workstream 1 part D; src/shared/record-views.ts has the rules): its
// layout (table, board, list, gallery, timeline, calendar, chart), what it groups by, filters, sort and the fields it
// shows, each one click away in its bar; saved as a section of the project's workspace or as a view over the whole vault.
// Records open with one click (the peek); values change where they show with a double-click, the pencil, or E.

import { useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ModuleFills } from '../../state/moduleFills';
import { CHART_TYPES, CHART_WORDS, RECORD_FILTER_OPS, RECORD_FILTER_WORDS, RECORD_LAYOUT_WORDS, RECORD_LAYOUTS, defaultDateField, defaultFields, noValue, runRecordView, suggestChart, type RecordFilter, type RecordLayout, type RecordViewDef } from '../../../../shared/record-views';
import { openRecordFormulaEditor } from './RecordFormulaEditor';
import { openRecordRollupEditor } from './RecordRollupEditor';
import { computedFieldEntries, recordColumnLabel } from './recordColumns';
import { KIND_WORDS, type RecordKind, type WsRecord } from '../../../../shared/workspace-records';
import { Icon, type IconName } from '../../components/Icon';
import { openMenu, type MenuItem } from '../../components/Menu';
import { ChartLayout } from './RecordChart';
import { BoardLayout, GalleryLayout, ListLayout, TableLayout } from './RecordLayouts';
import { CalendarLayout, TimelineLayout } from './RecordTime';
import { useRecords } from './recordParts';

export const LAYOUT_ICON: Record<RecordLayout, IconName> = { table: 'table', board: 'board', list: 'list', gallery: 'grid', timeline: 'timeline', calendar: 'calendar', chart: 'chart' };

export interface RecordViewProps {
  def: RecordViewDef;
  /** The records this view can show (the project's, or the vault's). */
  records: WsRecord[];
  onChange(def: RecordViewDef): void;
  /** "Save as…": a section of the project's own, or a view over the whole vault. */
  onSaveAs?(def: RecordViewDef, where: 'section' | 'vault'): void;
  onReset?(): void;
  onRemove?(): void;
  /** A new record of a kind from its first words (true when written). */
  onAdd?(kind: RecordKind, words: string): Promise<boolean>;
  addKinds?: RecordKind[];
  /** Drawn in place of the records' own timeline (a project's Plan: part C's plan timeline). */
  timeline?: ReactNode;
  /** The view's title shows as a heading (a section with several views). */
  titled?: boolean;
  /** How many things the rows are, when several rows are one thing (a bill on each day it falls: one bill). */
  counted?(rows: WsRecord[]): number;
}

export function RecordView({ def, records, onChange, onSaveAs, onReset, onRemove, onAdd, addKinds = [], timeline, titled, counted }: RecordViewProps) {
  const ctx = useRecords();
  // Inside a module's page, an empty view leads with how the module fills itself (8.0 R6), then its own next step.
  const fills = useContext(ModuleFills)?.fills ?? '';
  const run = useMemo(() => runRecordView(records, def), [records, def]);
  const change = (patch: Partial<RecordViewDef>) => onChange({ ...def, ...patch });
  const [adding, setAdding] = useState<RecordKind | null>(null);
  const [panel, setPanel] = useState<'filter' | 'fields' | null>(null);
  const ofKind = useMemo(() => records.filter((r) => def.kinds.includes(r.kind)), [records, def.kinds]);
  const fields = useMemo(() => ctx.fields.filter((f) => ofKind.some((r) => r.fields[f.key] !== undefined) || f.key === 'due_group' || f.key === 'kind' || f.key === 'project'), [ctx.fields, ofKind]);
  const groupable = fields.filter((f) => f.type === 'status' || f.type === 'person' || f.type === 'bool' || (f.type === 'text' && f.values.length > 1 && f.values.length <= 20));
  const dateFields = fields.filter((f) => f.type === 'date');
  const numberFields = fields.filter((f) => f.type === 'number' || f.type === 'money');

  const setLayout = (layout: RecordLayout) => {
    const patch: Partial<RecordViewDef> = { layout };
    if (layout === 'board' && !def.groupBy) patch.groupBy = groupable.find((f) => f.key === 'status')?.key ?? groupable[0]?.key;
    if ((layout === 'timeline' || layout === 'calendar') && !def.dateField) patch.dateField = defaultDateField(records, def.kinds);
    if (layout === 'chart' && !def.chart) patch.chart = suggestChart(records, def.kinds);
    if (!def.fields.length && layout !== 'chart') patch.fields = defaultFields(def.kinds);
    change(patch);
  };
  const formulas = useMemo(() => computedFieldEntries({ ...def, rollups: undefined }), [def]);
  const groupMenu = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { heading: def.layout === 'board' ? 'Columns by' : 'Group by' },
      ...(def.layout === 'board' ? [] : [{ label: 'No grouping', checked: !def.groupBy, run: () => change({ groupBy: undefined }) }]),
      ...groupable.map((f) => ({ label: f.label, checked: def.groupBy === f.key, run: () => change({ groupBy: f.key, collapsed: [], groupOrder: [] }) })),
      ...(formulas.length ? [{ heading: 'Formulas' }, ...formulas.map((f) => ({ label: f.label, checked: def.groupBy === f.key, run: () => change({ groupBy: f.key, collapsed: [], groupOrder: [] }) }))] : []),
    ]);
  const sortMenu = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { heading: 'Sort by' },
      { label: 'As written', checked: !def.sort, run: () => change({ sort: undefined }) },
      ...[{ key: 'title', label: 'Name' }, ...fields.filter((f) => f.type !== 'long')].map((f) => ({
        label: f.label,
        checked: def.sort?.field === f.key,
        submenu: [
          { label: f.key === 'title' || fields.find((x) => x.key === f.key)?.type === 'text' ? 'A to Z' : 'Lowest or soonest first', checked: def.sort?.field === f.key && def.sort.dir === 'asc', run: () => change({ sort: { field: f.key, dir: 'asc' } }) },
          { label: f.key === 'title' || fields.find((x) => x.key === f.key)?.type === 'text' ? 'Z to A' : 'Highest or latest first', checked: def.sort?.field === f.key && def.sort.dir === 'desc', run: () => change({ sort: { field: f.key, dir: 'desc' } }) },
        ] as MenuItem[],
      })),
      ...(formulas.length ? [{ heading: 'Formulas' }, ...formulas.map((f) => ({ label: f.label, checked: def.sort?.field === f.key, submenu: [{ label: 'Lowest or soonest first', checked: def.sort?.field === f.key && def.sort.dir === 'asc', run: () => change({ sort: { field: f.key, dir: 'asc' } }) }, { label: 'Highest or latest first', checked: def.sort?.field === f.key && def.sort.dir === 'desc', run: () => change({ sort: { field: f.key, dir: 'desc' } }) }] as MenuItem[] }))] : []),
    ]);
  const dateMenu = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [{ heading: 'Each one goes on its' }, ...dateFields.map((f) => ({ label: f.label, checked: def.dateField === f.key, run: () => change({ dateField: f.key }) }))]);
  const chart = def.chart ?? suggestChart(records, def.kinds);
  const chartBy = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [{ heading: chart.type === 'line' ? 'Along the bottom' : 'One for each' }, ...[...groupable, ...dateFields].map((f) => ({ label: f.label, checked: chart.by === f.key, run: () => change({ chart: { ...chart, by: f.key } }) }))]);
  const chartMeasure = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { heading: 'What it measures' },
      { label: `How many ${def.kinds.length === 1 ? KIND_WORDS[def.kinds[0]].many.toLowerCase() : 'records'}`, checked: chart.measure === 'count', run: () => change({ chart: { ...chart, measure: 'count', agg: undefined } }) },
      ...numberFields.flatMap((f) => [
        { label: `${f.label}, added up`, checked: chart.measure === f.key && chart.agg !== 'avg', run: () => change({ chart: { ...chart, measure: f.key, agg: 'sum' } }) },
        { label: `${f.label}, on average`, checked: chart.measure === f.key && chart.agg === 'avg', run: () => change({ chart: { ...chart, measure: f.key, agg: 'avg' } }) },
      ]),
    ]);
  const moreMenu = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      ...(onSaveAs ? [{ label: 'Save as a section of this project…', icon: 'views' as const, run: () => onSaveAs(def, 'section') }, { label: 'Save as a view of the whole vault…', icon: 'vault' as const, run: () => onSaveAs(def, 'vault') }] : []),
      { label: def.showDone ? 'Hide what’s done' : 'Show what’s done too', icon: 'check', checked: !!def.showDone, run: () => change({ showDone: !def.showDone }) },
      ...(onReset ? [{ separator: true as const }, { label: 'Back to how it was made', icon: 'undo' as const, run: onReset }] : []),
      ...(onRemove ? [{ label: 'Remove this view', icon: 'trash' as const, danger: true, run: onRemove }] : []),
    ]);
  const filterCount = def.filters.length;
  const count = counted ? counted(run.rows) : run.rows.length;
  const kindsWord = def.kinds.length === 1 ? KIND_WORDS[def.kinds[0]][count === 1 ? 'one' : 'many'].toLowerCase() : count === 1 ? 'record' : 'records';

  return (
    <section className={`ws-view layout-${def.layout}`} aria-label={def.title}>
      <div className="ws-view-bar">
        {titled && <h3 className="ws-view-title">{def.title}</h3>}
        <span className="ws-view-count" title={run.hidden ? `${run.hidden} not shown (done, or filtered out)` : undefined}>
          {count} {kindsWord}
          {run.hidden > 0 && <span className="ws-faint"> · {run.hidden} hidden</span>}
        </span>
        <span className="ws-bar-space" />
        <div className="ws-seg ws-layouts" role="radiogroup" aria-label="Layout">
          {RECORD_LAYOUTS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={def.layout === l} className={def.layout === l ? 'is-on' : ''} title={RECORD_LAYOUT_WORDS[l]} aria-label={RECORD_LAYOUT_WORDS[l]} onClick={() => setLayout(l)}>
              <Icon name={LAYOUT_ICON[l]} size={14} />
              <span className="ws-seg-word">{RECORD_LAYOUT_WORDS[l]}</span>
            </button>
          ))}
        </div>
        <div className="ws-tools">
          {def.layout === 'chart' ? (
            <>
              <div className="ws-seg" role="radiogroup" aria-label="Chart">
                {CHART_TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={chart.type === t} className={chart.type === t ? 'is-on' : ''} onClick={() => change({ chart: { ...chart, type: t } })}>
                    {CHART_WORDS[t]}
                  </button>
                ))}
              </div>
              <ToolButton icon="layers" words={`By ${recordColumnLabel(chart.by).toLowerCase()}`} onClick={chartBy} />
              <ToolButton icon="chart" words={chart.measure === 'count' ? 'Count' : `${recordColumnLabel(chart.measure)}${chart.agg === 'avg' ? ' (avg)' : ''}`} onClick={chartMeasure} />
            </>
          ) : (
            <>
              {(def.layout === 'timeline' || def.layout === 'calendar') && !timeline && <ToolButton icon="calendar" words={recordColumnLabel(def.dateField ?? 'date')} onClick={dateMenu} />}
              {!(def.layout === 'calendar' || (def.layout === 'timeline' && timeline)) && <ToolButton icon="layers" words={def.groupBy ? recordColumnLabel(def.groupBy) : 'Group'} on={!!def.groupBy} onClick={groupMenu} />}
              {!(def.layout === 'timeline' && timeline) && <ToolButton icon="sort" words={def.sort ? recordColumnLabel(def.sort.field) : 'Sort'} on={!!def.sort} onClick={sortMenu} />}
              {def.layout !== 'calendar' && def.layout !== 'timeline' && <ToolButton icon="eye" words="Fields" on={panel === 'fields'} onClick={() => setPanel(panel === 'fields' ? null : 'fields')} />}
            </>
          )}
          {!(def.layout === 'timeline' && timeline) && <ToolButton icon="filter" words={filterCount ? `Filter · ${filterCount}` : 'Filter'} on={panel === 'filter' || filterCount > 0} onClick={() => setPanel(panel === 'filter' ? null : 'filter')} />}
          {ctx.canEdit && onAdd && addKinds.length > 0 && (
            <button
              type="button"
              className="ws-new"
              onClick={(e) =>
                addKinds.length === 1
                  ? setAdding(addKinds[0])
                  : openMenu(
                      e.currentTarget,
                      addKinds.map((k) => ({ label: `New ${KIND_WORDS[k].one.toLowerCase()}`, run: () => setAdding(k) })),
                    )
              }
            >
              <Icon name="plus" size={13} /> New
            </button>
          )}
          <button type="button" className="icon-button ws-view-more" title="More for this view" aria-label="More for this view" onClick={moreMenu}>
            <Icon name="more" size={15} />
          </button>
        </div>
      </div>
      {panel === 'filter' && <FilterPanel def={def} fields={fields} change={change} close={() => setPanel(null)} />}
      {panel === 'fields' && <FieldsPanel def={def} fields={fields} records={records} change={change} close={() => setPanel(null)} />}
      {adding && onAdd && <AddLine kind={adding} onAdd={(w) => onAdd(adding, w)} close={() => setAdding(null)} />}
      <div className="ws-view-body">
        {count === 0 && def.layout !== 'chart' && !(def.layout === 'timeline' && timeline) ? (
          <div className="ws-empty">
            {fills && !run.hidden && (
              <p>
                <b>Fills itself.</b> {fills}
              </p>
            )}
            <p>{run.hidden ? `Nothing to show: ${run.hidden} ${run.hidden === 1 ? 'is' : 'are'} done or filtered out.` : `No ${def.kinds.map((k) => KIND_WORDS[k].many.toLowerCase()).join(' or ')} yet.`}</p>
            {run.hidden > 0 && !def.showDone && (
              <button type="button" className="ws-quiet" onClick={() => change({ showDone: true })}>
                Show what’s done
              </button>
            )}
            {ctx.canEdit && onAdd && addKinds.length > 0 && !run.hidden && (
              <button type="button" className="button" onClick={() => setAdding(addKinds[0])}>
                <Icon name="plus" size={13} /> Add {KIND_WORDS[addKinds[0]].one.toLowerCase() === 'action' ? 'an' : 'a'} {KIND_WORDS[addKinds[0]].one.toLowerCase()}
              </button>
            )}
          </div>
        ) : def.layout === 'table' ? (
          <TableLayout def={withFields(def)} run={run} change={change} />
        ) : def.layout === 'board' ? (
          <BoardLayout def={withFields(def)} run={run} change={change} />
        ) : def.layout === 'list' ? (
          <ListLayout def={withFields(def)} run={run} change={change} />
        ) : def.layout === 'gallery' ? (
          <GalleryLayout def={withFields(def)} run={run} change={change} />
        ) : def.layout === 'timeline' ? (
          (timeline ?? <TimelineLayout def={def} run={run} change={change} />)
        ) : def.layout === 'calendar' ? (
          <CalendarLayout def={def} run={run} change={change} />
        ) : (
          <ChartLayout def={def} records={records} />
        )}
      </div>
    </section>
  );
}

const withFields = (def: RecordViewDef): RecordViewDef => (def.fields.length ? def : { ...def, fields: defaultFields(def.kinds) });

function ToolButton({ icon, words, onClick, on }: { icon: IconName; words: string; onClick(e: React.MouseEvent<HTMLElement>): void; on?: boolean }) {
  return (
    <button type="button" className={`ws-tool${on ? ' is-on' : ''}`} onClick={onClick}>
      <Icon name={icon} size={13} />
      <span>{words}</span>
    </button>
  );
}

function AddLine({ kind, onAdd, close }: { kind: RecordKind; onAdd(words: string): Promise<boolean>; close(): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = KIND_WORDS[kind].one.toLowerCase();
  return (
    <form
      className="ws-add-line"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        void onAdd(text).then((ok) => {
          setBusy(false);
          if (ok) setText('');
        });
      }}
    >
      <Icon name="plus" size={14} />
      <input autoFocus value={text} disabled={busy} placeholder={`New ${noun}: what is it?`} aria-label={`New ${noun}`} onChange={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && close()} />
      <button type="submit" className="button primary" disabled={!text.trim() || busy}>
        Add
      </button>
      <button type="button" className="button" onClick={close}>
        Done
      </button>
    </form>
  );
}

// ── Filters and fields ───────────────────────────────────────────────────────────────────────────────────────────────

function usePanelFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current?.querySelector<HTMLElement>('select, input, button')?.focus(), []);
  return ref;
}

function FilterPanel({ def, fields, change, close }: { def: RecordViewDef; fields: ReturnType<typeof useRecords>['fields']; change(p: Partial<RecordViewDef>): void; close(): void }) {
  const ref = usePanelFocus();
  const set = (i: number, f: RecordFilter | null) => change({ filters: f ? def.filters.map((x, j) => (j === i ? f : x)) : def.filters.filter((_, j) => j !== i) });
  const first = fields.find((f) => f.type === 'status') ?? fields[0];
  return (
    <div className="ws-panel" ref={ref} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="ws-panel-head">
        <strong>Show only</strong>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={12} />
        </button>
      </div>
      {def.filters.length === 0 && <p className="ws-faint ws-panel-none">Everything shows. Add a filter to narrow it down.</p>}
      {def.filters.map((f, i) => {
        const info = fields.find((x) => x.key === f.field);
        const ops = RECORD_FILTER_OPS.filter((op) => (info?.type === 'date' ? ['is', 'before', 'after', 'empty', 'not-empty'].includes(op) : info?.type === 'number' || info?.type === 'money' ? ['is', 'is-not', 'gt', 'lt', 'empty', 'not-empty'].includes(op) : !['gt', 'lt', 'before', 'after'].includes(op)));
        return (
          <div key={i} className="ws-filter">
            <select value={f.field} aria-label="Field" onChange={(e) => set(i, { ...f, field: e.currentTarget.value })}>
              {fields.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
            <select value={f.op} aria-label="How" onChange={(e) => set(i, { ...f, op: e.currentTarget.value as RecordFilter['op'] })}>
              {ops.map((op) => (
                <option key={op} value={op}>
                  {RECORD_FILTER_WORDS[op]}
                </option>
              ))}
            </select>
            {!noValue(f.op) &&
              (info?.type === 'date' ? (
                <span className="ws-filter-day">
                  <input type="date" value={f.value === 'today' ? '' : (f.value ?? '')} aria-label="Day" onChange={(e) => set(i, { ...f, value: e.currentTarget.value })} />
                  <button type="button" className={`ws-quiet${f.value === 'today' ? ' is-on' : ''}`} onClick={() => set(i, { ...f, value: 'today' })}>
                    Today
                  </button>
                </span>
              ) : (
                <>
                  <input value={f.value ?? ''} aria-label="Value" list={`ws-filter-${i}`} placeholder="Value" onChange={(e) => set(i, { ...f, value: e.currentTarget.value })} />
                  <datalist id={`ws-filter-${i}`}>
                    {(info?.values ?? []).slice(0, 30).map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </>
              ))}
            <button type="button" className="icon-button" aria-label="Remove this filter" onClick={() => set(i, null)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        );
      })}
      <div className="ws-panel-foot">
        <button type="button" className="ws-quiet" onClick={() => change({ filters: [...def.filters, { field: first?.key ?? 'status', op: 'is', value: first?.values[0] ?? '' }] })}>
          <Icon name="plus" size={12} /> Add a filter
        </button>
        <label className="ws-check">
          <input type="checkbox" checked={!!def.showDone} onChange={(e) => change({ showDone: e.currentTarget.checked })} /> Show what’s done too
        </label>
      </div>
    </div>
  );
}

function FieldsPanel({ def, fields, records, change, close }: { def: RecordViewDef; fields: ReturnType<typeof useRecords>['fields']; records: WsRecord[]; change(p: Partial<RecordViewDef>): void; close(): void }) {
  const ref = usePanelFocus();
  const shown = def.fields.length ? def.fields : defaultFields(def.kinds);
  const rest = fields.filter((f) => !shown.includes(f.key));
  const hiddenComputed = computedFieldEntries(def).filter((f) => !shown.includes(f.key));
  const move = (key: string, by: number) => {
    const list = [...shown];
    const i = list.indexOf(key);
    const j = Math.max(0, Math.min(list.length - 1, i + by));
    list.splice(i, 1);
    list.splice(j, 0, key);
    change({ fields: list });
  };
  return (
    <div className="ws-panel ws-fields-panel" ref={ref} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="ws-panel-head">
        <strong>Fields shown</strong>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <ul className="ws-field-list">
        <li className="ws-field is-fixed">
          <input type="checkbox" checked disabled aria-label="Name" /> Name <span className="ws-faint">always first</span>
        </li>
        {shown.map((k, i) => (
          <li key={k} className="ws-field">
            <label>
              <input type="checkbox" checked onChange={() => change({ fields: shown.filter((x) => x !== k) })} /> {recordColumnLabel(k)}
            </label>
            <span className="ws-field-move">
              <button type="button" className="icon-button" disabled={i === 0} aria-label={`Move ${recordColumnLabel(k)} up`} onClick={() => move(k, -1)}>
                <Icon name="chevron" size={11} className="ws-up" />
              </button>
              <button type="button" className="icon-button" disabled={i === shown.length - 1} aria-label={`Move ${recordColumnLabel(k)} down`} onClick={() => move(k, 1)}>
                <Icon name="chevronDown" size={11} />
              </button>
            </span>
          </li>
        ))}
        {rest.map((f) => (
          <li key={f.key} className="ws-field is-off">
            <label>
              <input type="checkbox" checked={false} onChange={() => change({ fields: [...shown, f.key] })} /> {f.label}
            </label>
          </li>
        ))}
        {hiddenComputed.map((f) => (
          <li key={f.key} className="ws-field is-off">
            <label>
              <input type="checkbox" checked={false} onChange={() => change({ fields: [...shown, f.key] })} /> {f.label} <span className="ws-faint">{f.key.startsWith('formula.') ? 'Formula' : 'Rollup'}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="ws-panel-foot">
        <button type="button" className="ws-quiet" onClick={() => openRecordFormulaEditor({ def, records, fields, change })}>
          <Icon name="plus" size={12} /> New formula column
        </button>
        <button type="button" className="ws-quiet" onClick={() => openRecordRollupEditor({ def, records, fields, change })}>
          <Icon name="plus" size={12} /> New rollup column
        </button>
      </div>
    </div>
  );
}
