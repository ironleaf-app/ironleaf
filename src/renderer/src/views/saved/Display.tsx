// A view's one Display panel (release 5.0.0): what it shows, the layout, what groups the board, dates the calendar or
// places the map, the order, the filters and which properties show — all in one calm place under the Display button
// instead of a crowded toolbar. Every change is written to the view's file at once.

import { useEffect, useRef } from 'react';
import { CHART_TYPES, CHART_WORDS, columnKind, columnLabel, FIELD_FOLDER, FIELD_MODIFIED, FIELD_TITLE, FILTER_OPS, FILTER_WORDS, formulaKeys, formulaName, LAYOUT_WORDS, LAYOUTS, noValueOp, primarySortPatch, propWords, sortsOf, sortWords, suggestChart, usesColumns, type KnownProp, type ViewDef, type ViewFilter, type ViewRow, type ViewSource, type ChartType } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { LAYOUT_ICON } from './common';
import { openFormulaEditor } from './FormulaEditor';

interface Props {
  def: ViewDef;
  props: KnownProp[];
  folders: string[];
  tags: string[];
  change(patch: Partial<ViewDef>): void;
  close(): void;
  /** What it shows when that is fixed (a note type's page shows that type: "Every person"), in place of the choice. */
  fixedSource?: string;
  /** The notes the view shows (a formula's kind, and its example while it is made). */
  rows?: ViewRow[];
}

export function DisplayPanel({ def, props, folders, tags, change, close, fixedSource, rows = [] }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest close, so the listeners below are set once while the panel is open (and focus isn't moved again on
  // every change made in it).
  const closeNow = useRef(close);
  closeNow.current = close;
  useEffect(() => {
    (panel.current?.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
    const close = () => closeNow.current();
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!panel.current?.contains(el) && !el.closest('.sv-display-button') && !el.closest('.menu')) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      (document.querySelector('.sv-display-button') as HTMLElement | null)?.focus();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, []);

  const groupable = props.filter((p) => !p.list && p.kind !== 'date' && p.kind !== 'datetime');
  const dated = props.filter((p) => p.kind === 'date' || p.kind === 'datetime');
  const other = props.filter((p) => p.kind !== 'date' && p.kind !== 'datetime');
  // Formula columns (21 Oct 2026) can be shown, ordered by, filtered on and grouped by like properties.
  const formulas = formulaKeys(def);
  const label = (key: string) => columnLabel(def, key);
  const formulaOptions = (keys: string[]) =>
    keys.length > 0 && (
      <optgroup label="Formulas">
        {keys.map((k) => (
          <option key={k} value={k}>
            {label(k)}
          </option>
        ))}
      </optgroup>
    );
  const editFormula = (name?: string) => openFormulaEditor({ def, rows, props, change, name });
  const columnsLayout = usesColumns(def.layout);
  const shownList = columnsLayout ? def.columns : def.cardProps;
  const max = columnsLayout ? Infinity : def.layout === 'board' ? 2 : 1;
  const toggleShown = (key: string, on: boolean) => {
    const list = on ? [...shownList, key] : shownList.filter((k) => k !== key);
    if (columnsLayout) change({ columns: list });
    else change({ cardProps: list.slice(-max) });
  };
  const setFilter = (i: number, patch: Partial<ViewFilter>) => change({ filters: def.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const sourceValue = def.source.kind === 'all' ? 'all:' : `${def.source.kind}:${def.source.value ?? ''}`;
  const setSource = (v: string) => {
    const at = v.indexOf(':');
    const kind = v.slice(0, at) as ViewSource['kind'];
    change({ source: kind === 'all' ? { kind: 'all' } : { kind, value: v.slice(at + 1) } });
  };
  const sortKeys = [FIELD_TITLE, ...props.map((p) => p.key), FIELD_MODIFIED, ...formulas];

  return (
    <div className="sv-display" ref={panel} role="dialog" aria-label="Display">
      <div className="sv-layouts" role="radiogroup" aria-label="Layout">
        {LAYOUTS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={def.layout === l} className={def.layout === l ? 'on' : ''} onClick={() => change({ layout: l })}>
            <Icon name={LAYOUT_ICON[l]} size={18} />
            <span>{LAYOUT_WORDS[l]}</span>
          </button>
        ))}
      </div>

      {fixedSource !== undefined ? (
        <div className="sv-row">
          <span className="sv-row-name">Shows</span>
          <span className="sv-fixed-source">{fixedSource}</span>
        </div>
      ) : (
        <label className="sv-row">
          <span className="sv-row-name">Shows</span>
          <select value={sourceValue} onChange={(e) => setSource(e.currentTarget.value)}>
            <option value="all:">Every note</option>
            {(folders.length > 0 || def.source.kind === 'folder') && (
              <optgroup label="Notes in a folder">
                {def.source.kind === 'folder' && !folders.includes(def.source.value ?? '') && <option value={sourceValue}>{def.source.value}</option>}
                {folders.map((f) => (
                  <option key={f} value={`folder:${f}`}>
                    {f}
                  </option>
                ))}
              </optgroup>
            )}
            {(tags.length > 0 || def.source.kind === 'tag') && (
              <optgroup label="Notes with a tag">
                {def.source.kind === 'tag' && !tags.includes(def.source.value ?? '') && <option value={sourceValue}>#{def.source.value}</option>}
                {tags.map((t) => (
                  <option key={t} value={`tag:${t}`}>
                    #{t}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      {def.layout === 'board' && (
        <label className="sv-row">
          <span className="sv-row-name">Columns by</span>
          <select value={def.groupBy ?? ''} onChange={(e) => change({ groupBy: e.currentTarget.value || undefined, groupOrder: [], hiddenGroups: [], collapsedGroups: [] })}>
            {!def.groupBy && <option value="">Choose a property…</option>}
            {def.groupBy && !groupable.some((p) => p.key === def.groupBy) && <option value={def.groupBy}>{propWords(def.groupBy)}</option>}
            {groupable.map((p) => (
              <option key={p.key} value={p.key}>
                {propWords(p.key)}
              </option>
            ))}
            {formulaOptions(formulas)}
          </select>
        </label>
      )}

      {(def.layout === 'cards' || def.layout === 'gallery') && (
        <label className="sv-row">
          <span className="sv-row-name">Cover from</span>
          <select value={def.cover ?? ''} onChange={(e) => change({ cover: e.currentTarget.value || undefined })}>
            <option value="">No cover</option>
            {def.cover && !props.some((p) => p.key === def.cover) && <option value={def.cover}>{propWords(def.cover)}</option>}
            {props
              .filter((p) => p.kind === 'text')
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {propWords(p.key)}
                </option>
              ))}
          </select>
        </label>
      )}

      {columnsLayout && (
        <div className="sv-row">
          <label className="sv-row-name" htmlFor="sv-section-by">
            Group by
          </label>
          <select id="sv-section-by" value={def.sectionBy?.prop ?? ''} onChange={(e) => change({ sectionBy: e.currentTarget.value ? { prop: e.currentTarget.value, dir: def.sectionBy?.dir ?? 'asc' } : undefined })}>
            <option value="">No groups</option>
            {def.sectionBy && !groupable.some((p) => p.key === def.sectionBy!.prop) && def.sectionBy.prop !== FIELD_FOLDER && !formulas.includes(def.sectionBy.prop) && <option value={def.sectionBy.prop}>{label(def.sectionBy.prop)}</option>}
            {groupable.map((p) => (
              <option key={p.key} value={p.key}>
                {propWords(p.key)}
              </option>
            ))}
            <option value={FIELD_FOLDER}>Folder</option>
            {formulaOptions(formulas)}
          </select>
          {def.sectionBy ? (
            <button type="button" className="sv-dir" aria-label={def.sectionBy.dir === 'desc' ? 'Groups Z to A (choose to turn them round)' : 'Groups A to Z (choose to turn them round)'} title="Turn the groups round" onClick={() => change({ sectionBy: { prop: def.sectionBy!.prop, dir: def.sectionBy!.dir === 'desc' ? 'asc' : 'desc' } })}>
              {def.sectionBy.dir === 'desc' ? 'Z–A' : 'A–Z'}
            </button>
          ) : (
            <span />
          )}
        </div>
      )}

      {(def.layout === 'calendar' || def.layout === 'timeline') && (
        <label className="sv-row">
          <span className="sv-row-name">Day from</span>
          <select value={def.dateProp ?? ''} onChange={(e) => change({ dateProp: e.currentTarget.value || undefined })}>
            {!def.dateProp && <option value="">Choose a property…</option>}
            {def.dateProp && !props.some((p) => p.key === def.dateProp) && <option value={def.dateProp}>{propWords(def.dateProp)}</option>}
            {dated.length > 0 && (
              <optgroup label="Dates">
                {dated.map((p) => (
                  <option key={p.key} value={p.key}>
                    {propWords(p.key)}
                  </option>
                ))}
              </optgroup>
            )}
            {other.length > 0 && (
              <optgroup label="Other properties">
                {other.map((p) => (
                  <option key={p.key} value={p.key}>
                    {propWords(p.key)}
                  </option>
                ))}
              </optgroup>
            )}
            {formulaOptions(formulas.filter((k) => ['date', 'datetime'].includes(columnKind(rows, k))))}
          </select>
        </label>
      )}

      {def.layout === 'map' && (
        <label className="sv-row">
          <span className="sv-row-name">Place from</span>
          <select value={def.placeProp ?? ''} onChange={(e) => change({ placeProp: e.currentTarget.value || undefined })}>
            {!def.placeProp && <option value="">Choose a property…</option>}
            {def.placeProp && !props.some((p) => p.key === def.placeProp) && <option value={def.placeProp}>{propWords(def.placeProp)}</option>}
            {props
              .filter((p) => p.kind === 'text')
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {propWords(p.key)}
                </option>
              ))}
          </select>
        </label>
      )}

      {def.layout === 'timeline' && (
        <label className="sv-row">
          <span className="sv-row-name">Ends on</span>
          <select value={def.endProp ?? ''} onChange={(e) => change({ endProp: e.currentTarget.value || undefined })}>
            <option value="">No end day</option>
            {def.endProp && !props.some((p) => p.key === def.endProp) && <option value={def.endProp}>{propWords(def.endProp)}</option>}
            {dated
              .filter((p) => p.key !== def.dateProp)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {propWords(p.key)}
                </option>
              ))}
            {formulaOptions(formulas.filter((k) => ['date', 'datetime'].includes(columnKind(rows, k)) && k !== def.dateProp))}
          </select>
        </label>
      )}

      {def.layout === 'chart' && <ChartRows def={def} props={props} rows={rows} change={change} />}

      <div className="sv-row">
        <label className="sv-row-name" htmlFor="sv-sort">
          Order
        </label>
        <select id="sv-sort" value={def.sort?.prop ?? FIELD_TITLE} onChange={(e) => change(primarySortPatch(def, e.currentTarget.value === FIELD_TITLE && def.sort?.dir !== 'desc' ? undefined : { prop: e.currentTarget.value, dir: def.sort?.dir ?? 'asc' }))}>
          {def.sort && !sortKeys.includes(def.sort.prop) && <option value={def.sort.prop}>{label(def.sort.prop)}</option>}
          {sortKeys.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
        <button type="button" className="sv-dir" aria-label={def.sort?.dir === 'desc' ? 'Z to A (choose to turn it round)' : 'A to Z (choose to turn it round)'} title="Turn the order round" onClick={() => change(primarySortPatch(def, { prop: def.sort?.prop ?? FIELD_TITLE, dir: def.sort?.dir === 'desc' ? 'asc' : 'desc' }))}>
          {def.sort?.dir === 'desc' ? 'Z–A' : 'A–Z'}
        </button>
      </div>
      {sortsOf(def).length > 1 && (
        <p className="sv-hint">Then ordered by {sortsOf(def).slice(1).map((s) => sortWords(s, label)).join('; ')}.</p>
      )}

      <section className="sv-section">
        <h3>Filters</h3>
        {def.filters.length === 0 && <p className="sv-hint">Every note it shows is listed. Add a filter to narrow it down.</p>}
        {def.filters.map((f, i) => (
          <div key={i} className={`sv-filter${f.op === 'matches' ? ' is-formula' : ''}`}>
            {f.op !== 'matches' && (
              <select aria-label="Property" value={f.prop} onChange={(e) => setFilter(i, { prop: e.currentTarget.value })}>
                {!props.some((p) => p.key === f.prop) && f.prop !== FIELD_TITLE && f.prop !== FIELD_FOLDER && !formulas.includes(f.prop) && <option value={f.prop}>{label(f.prop)}</option>}
                <option value={FIELD_TITLE}>Name</option>
                <option value={FIELD_FOLDER}>Folder</option>
                {props.map((p) => (
                  <option key={p.key} value={p.key}>
                    {propWords(p.key)}
                  </option>
                ))}
                {formulaOptions(formulas)}
              </select>
            )}
            <select aria-label="How" value={f.op} onChange={(e) => {
              const op = e.currentTarget.value as ViewFilter['op'];
              // A formula filter looks at no one property; turning it back into another kind picks the first one.
              setFilter(i, op === 'matches' ? { op, prop: '' } : { op, prop: f.prop || props[0]?.key || FIELD_TITLE });
            }}>
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {FILTER_WORDS[op]}
                </option>
              ))}
            </select>
            {!noValueOp(f.op) ? (
              <input
                key={`${i}:${f.value ?? ''}`}
                aria-label={f.op === 'matches' ? 'Formula' : 'Value'}
                placeholder={f.op === 'matches' ? 'For example: price > 10 && !done' : f.op === 'gt' || f.op === 'lt' ? 'A number or a day' : 'Value'}
                spellCheck={f.op !== 'matches'}
                className={f.op === 'matches' ? 'sv-mono' : undefined}
                defaultValue={f.value ?? ''}
                onBlur={(e) => e.currentTarget.value !== (f.value ?? '') && setFilter(i, { value: e.currentTarget.value })}
                onKeyDown={(e) => e.key === 'Enter' && setFilter(i, { value: e.currentTarget.value })}
              />
            ) : (
              <span />
            )}
            <button type="button" className="icon-button" aria-label="Remove this filter" title="Remove this filter" onClick={() => change({ filters: def.filters.filter((_, j) => j !== i) })}>
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="sv-add" onClick={() => change({ filters: [...def.filters, { prop: props[0]?.key ?? FIELD_TITLE, op: 'is', value: '' }] })}>
          <Icon name="plus" size={13} /> Add a filter
        </button>
      </section>

      <section className="sv-section">
        <h3>Formulas</h3>
        {formulas.length === 0 && <p className="sv-hint">A formula works something out from each note, such as price × quantity or the days until it’s due.</p>}
        {formulas.length > 0 && (
          <ul className="sv-formula-list">
            {formulas.map((k) => (
              <li key={k}>
                <button type="button" className="sv-formula-row" onClick={() => editFormula(formulaName(k))} title="Change the formula">
                  <Icon name="math" size={13} />
                  <span className="sv-formula-row-name">{formulaName(k)}</span>
                  <code className="sv-formula-row-expr">{def.formulas[formulaName(k)]}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="sv-add" onClick={() => editFormula()}>
          <Icon name="plus" size={13} /> New formula
        </button>
      </section>

      <section className="sv-section">
        <h3>{def.layout === 'table' ? 'Columns' : def.layout === 'list' ? 'Beside each name' : def.layout === 'chart' || def.layout === 'timeline' ? 'Columns' : 'On each card'}</h3>
        {!columnsLayout && def.layout !== 'chart' && def.layout !== 'timeline' && <p className="sv-hint">{def.layout === 'board' ? 'Up to two properties under each note’s name.' : 'One property under each note’s name.'}</p>}
        {(def.layout === 'chart' || def.layout === 'timeline') && <p className="sv-hint">Kept for the table, cards, list and gallery.</p>}
        {columnsLayout && def.layout !== 'table' && <p className="sv-hint">The same properties the table shows as columns.</p>}
        {props.length === 0 && <p className="sv-hint">These notes have no properties yet. Add some at the top of a note (like status or due) and they show up here.</p>}
        <div className="sv-checks">
          {[...props.map((p) => p.key), ...(columnsLayout ? [FIELD_FOLDER, FIELD_MODIFIED] : []), ...formulas].map((k) => {
            const on = shownList.some((s) => s.toLowerCase() === k.toLowerCase());
            return (
              <label key={k} className="sv-check-row">
                <input type="checkbox" checked={on} onChange={(e) => toggleShown(k, e.currentTarget.checked)} />
                <span>{label(k)}</span>
                {props.find((p) => p.key === k) && <span className="sv-faint">{props.find((p) => p.key === k)!.count}</span>}
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** A chart's spec as rows: what shape, what each bar or slice is, what it measures, and what each bar is measured against. */
function ChartRows({ def, props, rows, change }: { def: ViewDef; props: KnownProp[]; rows: ViewRow[]; change(patch: Partial<ViewDef>): void }) {
  const spec = def.chart ?? suggestChart(rows);
  const set = (patch: Partial<typeof spec>) => change({ chart: { ...spec, ...patch } });
  const groupable = props.filter((p) => !p.list && p.kind !== 'date' && p.kind !== 'datetime');
  const dated = props.filter((p) => p.kind === 'date' || p.kind === 'datetime');
  const numbers = props.filter((p) => p.kind === 'number');
  const byKeys = [...groupable.map((p) => p.key), ...dated.map((p) => p.key)];
  if (!byKeys.includes(spec.by)) byKeys.unshift(spec.by);
  return (
    <>
      <div className="sv-row">
        <span className="sv-row-name">Chart</span>
        <div className="sv-chart-seg" role="radiogroup" aria-label="Chart">
          {CHART_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={spec.type === t} className={spec.type === t ? 'is-on' : ''} onClick={() => set({ type: t as ChartType })}>
              {CHART_WORDS[t]}
            </button>
          ))}
        </div>
      </div>
      <label className="sv-row">
        <span className="sv-row-name">{spec.type === 'line' ? 'Along the bottom' : 'One for each'}</span>
        <select value={spec.by} onChange={(e) => set({ by: e.currentTarget.value })}>
          {byKeys.map((k) => (
            <option key={k} value={k}>
              {k === FIELD_FOLDER ? 'Folder' : propWords(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="sv-row">
        <span className="sv-row-name">What it measures</span>
        <select
          value={spec.measure === 'count' ? 'count' : `${spec.measure}:${spec.agg ?? 'sum'}`}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === 'count') set({ measure: 'count', agg: undefined });
            else {
              const at = v.lastIndexOf(':');
              set({ measure: v.slice(0, at), agg: v.slice(at + 1) === 'avg' ? 'avg' : 'sum' });
            }
          }}
        >
          <option value="count">How many notes</option>
          {numbers.flatMap((p) => [
            <option key={`${p.key}:sum`} value={`${p.key}:sum`}>
              {propWords(p.key)}, added up
            </option>,
            <option key={`${p.key}:avg`} value={`${p.key}:avg`}>
              {propWords(p.key)}, on average
            </option>,
          ])}
        </select>
      </label>
      {spec.type === 'bar' && (
        <label className="sv-row">
          <span className="sv-row-name">Measured against</span>
          <select value={spec.target ?? ''} onChange={(e) => set(e.currentTarget.value ? { target: e.currentTarget.value } : { target: undefined })}>
            <option value="">No target</option>
            {numbers
              .filter((p) => p.key !== spec.measure)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {propWords(p.key)}
                </option>
              ))}
          </select>
        </label>
      )}
    </>
  );
}
