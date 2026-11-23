// Records as a table, a list, a board and a gallery (24 Oct 2026, Workstream 1 part D). One click on a record opens it
// (the peek, with everything connected to it); its values change where they show by a double-click, the pencil, or E;
// records drag onto each other, onto a board's column or onto a section where that means something. Worked-out columns
// (10.0 Endless Tech, v10records2): a formula's or rollup's value shows in every layout, never typed into, and the
// table sums its columns up underneath.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isFault } from '../../../../shared/formula';
import { plainText } from '../../../../shared/plain-text';
import { recordSummaries, type RecordGroup, type RecordRun, type RecordViewDef } from '../../../../shared/record-views';
import { formulaName, isFormulaKey, isRollupKey, rollupName, SUMMARY_WORDS, summaryText, type SummaryKind } from '../../../../shared/views';
import type { WsRecord } from '../../../../shared/workspace-records';
import { Icon } from '../../components/Icon';
import { fileUrl, isImage } from '../../lib/resolve';
import { openMenu, type MenuItem } from '../../components/Menu';
import { Avatar, Cell, clickOpen, KIND_ICON, StatusPill, Tick, dayWords, endDrag, isDoneRecord, rowKeys, rowContext, ownsNote, startDrag, toneOf, typeOf, useDropTarget, useRecords, Value } from './recordParts';
import * as A from '../../state/actions';
import { openRecordFormulaEditor } from './RecordFormulaEditor';
import { openRecordRollupEditor } from './RecordRollupEditor';
import { computedKind, isComputedKey, recordColumnLabel, recordSummaryChoices, withRecordSummary, withoutRecordFormula, withoutRecordRollup } from './recordColumns';
import { isEnterKey } from '../../lib/enterKey';

interface LayoutProps {
  def: RecordViewDef;
  run: RecordRun;
  change(patch: Partial<RecordViewDef>): void;
}

const FIRST = 120;

/** Groups as the layouts draw them: the view's groups, or one group of every row. */
function groupsOf(run: RecordRun): RecordGroup[] {
  return run.groups.length ? run.groups : [{ key: '', label: '', rows: run.rows }];
}

function GroupHead({ def, g, change, count, children }: { def: RecordViewDef; g: RecordGroup; change(patch: Partial<RecordViewDef>): void; count: number; children?: ReactNode }) {
  const folded = (def.collapsed ?? []).includes(g.key);
  const ctx = useRecords();
  const field = def.groupBy ?? '';
  const target = useDropTarget(null, (r) => {
    if (!field || !def.kinds.includes(r.kind) || !ctx.editable(r).includes(field) || String(r.fields[field] ?? '') === g.key) return null;
    return { words: g.key ? `Set ${recordColumnLabel(field).toLowerCase()} to ${g.label}` : `Clear ${recordColumnLabel(field).toLowerCase()}`, run: () => void ctx.setField(r, field, g.key) };
  });
  return (
    <div className={`ws-group-head${target.over ? ' is-over' : ''}`} {...target.props}>
      <button type="button" className="ws-group-fold" aria-expanded={!folded} onClick={() => change({ collapsed: folded ? (def.collapsed ?? []).filter((k) => k !== g.key) : [...(def.collapsed ?? []), g.key] })}>
        <Icon name={folded ? 'chevron' : 'chevronDown'} size={12} />
        {typeOf(ctx.fields, field) === 'person' && g.key ? <Avatar name={g.key} size={18} /> : typeOf(ctx.fields, field) === 'status' && g.key ? <StatusPill value={g.label} field={field} /> : null}
        {!(typeOf(ctx.fields, field) === 'status' && g.key) && <span className="ws-group-name">{g.label}</span>}
        <span className="ws-group-count">{count}</span>
      </button>
      {children}
    </div>
  );
}

/** A worked-out value for one record: its formula's or rollup's answer, or undefined when there is none. */
function computedOf(run: RecordRun, r: WsRecord, key: string): unknown {
  if (isFormulaKey(key)) return run.computed?.[r.id]?.[formulaName(key)];
  if (isRollupKey(key)) return run.rolled?.[r.id]?.[rollupName(key)];
  return undefined;
}

/** A worked-out value as people read it: a fault as a quiet dash with its reason, a list joined, days as days. */
function ComputedValue({ value }: { value: unknown }): ReactNode {
  if (isFault(value)) return <span className="ws-computed is-fault" title={value.reason} aria-label={`Can’t be worked out: ${value.reason}`}>!</span>;
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    const words = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v).trim())).filter(Boolean).join(', ');
    return words ? <span title={words}>{words}</span> : null;
  }
  if (typeof value === 'boolean') return value ? <Icon name="check" size={13} className="ws-yes" /> : <span className="ws-faint">No</span>;
  if (typeof value === 'number') return <span className="ws-num">{value.toLocaleString('en-AU')}</span>;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return <span className="ws-day">{dayWords(value.trim())}</span>;
  const text = plainText(String(value));
  return <span title={text}>{text}</span>;
}

/** A field in any layout: a worked-out column shown, every other cell edited where it shows. */
function FieldCell({ r, field, run, compact }: { r: WsRecord; field: string; run: RecordRun; compact?: boolean }) {
  if (isComputedKey(field)) return <ComputedValue value={computedOf(run, r, field)} />;
  return <Cell r={r} field={field} compact={compact} />;
}

// ── Table ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function TableLayout({ def, run, change }: LayoutProps) {
  const ctx = useRecords();
  // Grouped by a field, its column would say the group's name on every row: it steps aside.
  const cols = def.fields.filter((f) => f !== def.groupBy);
  const [limit, setLimit] = useState(FIRST);
  const editFormula = (name?: string) => openRecordFormulaEditor({ def, records: run.rows, fields: ctx.fields, change, name });
  const editRollup = (name?: string) => openRecordRollupEditor({ def, records: run.rows, fields: ctx.fields, change, name });
  const kindForSummary = (key: string) => {
    if (key === 'title') return 'text' as const;
    if (isComputedKey(key)) return computedKind(run.rows.slice(0, 40).map((r) => computedOf(run, r, key)));
    return ctx.fields.find((f) => f.key === key)?.type ?? 'text';
  };
  const headMenu = (e: React.MouseEvent<HTMLElement>, key: string) => {
    const how = def.summaries?.[key];
    const choices = recordSummaryChoices(kindForSummary(key));
    const items: MenuItem[] = [
      { heading: recordColumnLabel(key) },
      { label: 'Sort A to Z', icon: 'sort', checked: def.sort?.field === key && def.sort.dir === 'asc', run: () => change({ sort: { field: key, dir: 'asc' } }) },
      { label: 'Sort Z to A', icon: 'sort', checked: def.sort?.field === key && def.sort.dir === 'desc', run: () => change({ sort: { field: key, dir: 'desc' } }) },
    ];
    if (key !== 'title') {
      items.push(
        { label: 'Group by this', icon: 'layers', checked: def.groupBy === key, run: () => change({ groupBy: def.groupBy === key ? undefined : key }) },
        { label: 'Hide this column', icon: 'eye', run: () => change({ fields: def.fields.filter((c) => c !== key) }) },
      );
      if (isFormulaKey(key))
        items.push(
          { separator: true },
          { label: 'Change the formula', icon: 'math', run: () => editFormula(formulaName(key)) },
          { label: 'Remove the formula', icon: 'trash', danger: true, run: () => change(withoutRecordFormula(def, formulaName(key))) },
        );
      if (isRollupKey(key))
        items.push(
          { separator: true },
          { label: 'Change the rollup', icon: 'chart', run: () => editRollup(rollupName(key)) },
          { label: 'Remove the rollup', icon: 'trash', danger: true, run: () => change(withoutRecordRollup(def, rollupName(key))) },
        );
    }
    items.push(
      { separator: true },
      {
        label: how ? `Sum up: ${SUMMARY_WORDS[how]}` : 'Sum up this column',
        icon: 'chart',
        submenu: [
          { label: 'None', checked: !how, run: () => change(withRecordSummary(def, key, null)) },
          ...[...choices, ...(how && !choices.includes(how) ? [how] : [])].map((k) => ({ label: SUMMARY_WORDS[k], checked: how === k, run: () => change(withRecordSummary(def, key, k)) }) as MenuItem),
        ] as MenuItem[],
      },
    );
    openMenu(e.currentTarget, items);
  };
  const addMenu = (anchor: HTMLElement) => {
    const offer = ctx.fields.filter((f) => !def.fields.some((c) => c.toLowerCase() === f.key.toLowerCase()));
    const hiddenFormulas = Object.keys(def.formulas ?? {}).filter((n) => !def.fields.includes(`formula.${n}`));
    const hiddenRollups = Object.keys(def.rollups ?? {}).filter((n) => !def.fields.includes(`rollup.${n}`));
    const items: MenuItem[] = [
      { label: 'New formula column', icon: 'math', run: () => editFormula() },
      ...hiddenFormulas.map((n) => ({ label: n, icon: 'math', hint: 'Formula', run: () => change({ fields: [...def.fields, `formula.${n}`] }) }) as MenuItem),
      { label: 'New rollup column', icon: 'chart', run: () => editRollup() },
      ...hiddenRollups.map((n) => ({ label: n, icon: 'chart', hint: 'Rollup', run: () => change({ fields: [...def.fields, `rollup.${n}`] }) }) as MenuItem),
      { separator: true },
      { heading: offer.length ? 'Add a column' : 'Every field is shown' },
      ...offer.slice(0, 40).map((f) => ({ label: f.label, hint: `${f.values.length}`, run: () => change({ fields: [...def.fields, f.key] }) }) as MenuItem),
    ];
    openMenu(anchor, items);
  };
  // Several at once (26 Oct 2026 uplift: "how do I delete these bills??"): a tick box on each row that is a note of its own,
  // and a bar while any are ticked. The Delete key with rows ticked deletes them all, with one Undo.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickable = run.rows.filter((r) => ownsNote(r));
  const toggle = (r: WsRecord) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(r.path!)) next.delete(r.path!);
      else next.add(r.path!);
      return next;
    });
  const removePicked = () => {
    const paths = [...picked].filter((p) => pickable.some((r) => r.path === p));
    setPicked(new Set());
    if (paths.length) void A.trashPaths(paths);
  };
  let shown = 0;
  return (
    <div
      className="ws-table-wrap"
      onKeyDown={(e) => {
        if (picked.size && ctx.canEdit && (e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)))) {
          e.preventDefault();
          e.stopPropagation();
          removePicked();
        } else if (picked.size && e.key === 'Escape') setPicked(new Set());
      }}
    >
      {picked.size > 0 && (
        <div className="ws-picked" role="toolbar" aria-label="Ticked rows">
          <span>{picked.size} ticked</span>
          <button type="button" className="text-button" onClick={() => setPicked(new Set(pickable.map((r) => r.path!)))}>
            Tick all {pickable.length}
          </button>
          <button type="button" className="button small danger" disabled={!ctx.canEdit} onClick={removePicked}>
            <Icon name="trash" size={13} /> Delete
          </button>
          <button type="button" className="text-button" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      <table className="ws-table">
        <thead>
          <tr>
            <th className="ws-th-pick" aria-label="Tick" />
            <th className="ws-th-title">
              <button type="button" onClick={(e) => headMenu(e, 'title')}>
                Name {def.sort?.field === 'title' && <Icon name={def.sort.dir === 'asc' ? 'chevronDown' : 'chevron'} size={10} />}
              </button>
            </th>
            {cols.map((c) => (
              <th key={c} className={`ws-th-${isComputedKey(c) ? computedKind(run.rows.slice(0, 40).map((r) => computedOf(run, r, c))) : typeOf(ctx.fields, c)}`}>
                <button type="button" onClick={(e) => headMenu(e, c)}>
                  {isFormulaKey(c) && <Icon name="math" size={10} className="ws-th-formula" />}
                  {isRollupKey(c) && <Icon name="chart" size={10} className="ws-th-formula" />}
                  {recordColumnLabel(c)} {def.sort?.field === c && <Icon name={def.sort.dir === 'asc' ? 'chevronDown' : 'chevron'} size={10} />}
                </button>
              </th>
            ))}
            <th className="ws-col-add" scope="col">
              <button type="button" className="ws-th-add" aria-label="Add a column" title="Add a column" onClick={(e) => addMenu(e.currentTarget)}>
                <Icon name="plus" size={13} />
              </button>
            </th>
          </tr>
        </thead>
        {groupsOf(run).map((g) => {
          const folded = (def.collapsed ?? []).includes(g.key);
          const rows = folded ? [] : g.rows.slice(0, Math.max(0, limit - shown));
          shown += rows.length;
          return (
            <tbody key={g.key || 'all'}>
              {run.groups.length > 0 && (
                <tr className="ws-tr-group">
                  <td colSpan={cols.length + 3}>
                    <GroupHead def={def} g={g} change={change} count={g.rows.length} />
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} r={r} cols={cols} run={run} picked={!!r.path && picked.has(r.path)} onPick={ownsNote(r) ? () => toggle(r) : undefined} />
              ))}
            </tbody>
          );
        })}
        <tfoot>
          <tr className="ws-summary-row">
            <td className="ws-td-pick" />
            <SummaryCell def={def} run={run} field="title" change={change} />
            {cols.map((c) => (
              <SummaryCell key={c} def={def} run={run} field={c} change={change} />
            ))}
            <td className="ws-col-add" />
          </tr>
        </tfoot>
      </table>
      {run.rows.length > limit && (
        <button type="button" className="ws-more" onClick={() => setLimit(limit + 200)}>
          Show {Math.min(200, run.rows.length - limit)} more
        </button>
      )}
    </div>
  );
}

/** A column's summary in the row under the table: its answer, or a quiet "Summary" to choose one. */
function SummaryCell({ def, run, field, change }: { def: RecordViewDef; run: RecordRun; field: string; change(patch: Partial<RecordViewDef>): void }) {
  const ctx = useRecords();
  const how = def.summaries?.[field];
  const summaries = useMemo(() => recordSummaries(run.rows, def), [run.rows, def]);
  const s = how ? summaries[field] : null;
  const choose = (anchor: HTMLElement) => {
    const set = (next: SummaryKind | null) => change(withRecordSummary(def, field, next));
    const kind = field === 'title' ? 'text' : isComputedKey(field) ? computedKind(run.rows.slice(0, 40).map((r) => computedOf(run, r, field))) : (ctx.fields.find((f) => f.key === field)?.type ?? 'text');
    const choices = recordSummaryChoices(kind);
    openMenu(anchor, [
      { heading: `Sum up ${field === 'title' ? 'Name' : recordColumnLabel(field)}` },
      { label: 'None', checked: !how, run: () => set(null) },
      ...[...choices, ...(how && !choices.includes(how) ? [how] : [])].map((k) => ({ label: SUMMARY_WORDS[k], checked: how === k, run: () => set(k) }) as MenuItem),
    ]);
  };
  const label = field === 'title' ? 'Name' : recordColumnLabel(field);
  return (
    <td className={field === 'title' ? 'ws-td-title' : undefined}>
      <button type="button" className={`ws-summary${s ? ' on' : ''}`} aria-label={s ? `${label}: ${s.label} ${summaryText(s) || 'nothing to sum up'}. Choose another summary.` : `Choose a summary for ${label}`} onClick={(e) => choose(e.currentTarget)}>
        {s ? (
          <>
            <span className="ws-summary-label">{s.label}</span>
            {s.value === null ? null : <span className="ws-summary-value">{summaryText(s)}</span>}
          </>
        ) : (
          <span className="ws-summary-add">Summary</span>
        )}
      </button>
    </td>
  );
}

function TableRow({ r, cols, run, picked, onPick }: { r: WsRecord; cols: string[]; run: RecordRun; picked: boolean; onPick?: () => void }) {
  const ctx = useRecords();
  const [editTitle, setEditTitle] = useState(0);
  const target = useDropTarget({ record: r });
  return (
    <tr
      className={`ws-tr${isDoneRecord(r) ? ' is-done' : ''}${target.over ? ' is-over' : ''}`}
      tabIndex={0}
      draggable={ctx.canEdit}
      onDragStart={(e) => startDrag(e, r)}
      onDragEnd={endDrag}
      onClick={clickOpen(ctx, r)}
      onContextMenu={rowContext(ctx, r)}
      onKeyDown={rowKeys(ctx, r, () => setEditTitle((n) => n + 1))}
      {...target.props}
      aria-selected={picked || undefined}
    >
      <td className="ws-td-pick" onClick={(e) => e.stopPropagation()}>
        {onPick && <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Tick ${r.title}`} />}
      </td>
      <td className="ws-td-title">
        <span className="ws-title-line">
          <Tick r={r} />
          <TitleCell r={r} editSignal={editTitle} />
        </span>
      </td>
      {cols.map((c) => (
        <td key={c}>
          <FieldCell r={r} field={c} run={run} compact />
        </td>
      ))}
      <td className="ws-col-add" />
    </tr>
  );
}

/** The record's name: a cell like the others (a double-click or E edits it where it can be). */
function TitleCell({ r, editSignal }: { r: WsRecord; editSignal: number }) {
  const ctx = useRecords();
  const [seen, setSeen] = useState(editSignal);
  const [editing, setEditing] = useState(false);
  if (editSignal !== seen) {
    setSeen(editSignal);
    if (ctx.editable(r).includes('title')) setEditing(true);
  }
  if (editing) return <TitleEditor r={r} onDone={() => setEditing(false)} />;
  return (
    <span className="ws-title-cell">
      <Cell r={r} field="title" />
    </span>
  );
}
function TitleEditor({ r, onDone }: { r: WsRecord; onDone(): void }) {
  // The Cell's own editor, opened straight away.
  const ctx = useRecords();
  const [text, setText] = useState(r.title);
  const box = useRef<HTMLInputElement>(null);
  const opened = useRef(Date.now());
  useEffect(() => {
    const t = window.setTimeout(() => box.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <span className="ws-editor" onClick={(e) => e.stopPropagation()}>
      <input
        ref={box}
        autoFocus
        value={text}
        aria-label="Name"
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (isEnterKey(e)) {
            if (text.trim() && text.trim() !== r.title) void ctx.setField(r, 'title', text.trim());
            onDone();
          }
          if (e.key === 'Escape') onDone();
        }}
        onBlur={() => {
          if (Date.now() - opened.current < 250) return void window.setTimeout(() => box.current?.focus(), 0);
          if (text.trim() && text.trim() !== r.title) void ctx.setField(r, 'title', text.trim());
          onDone();
        }}
      />
    </span>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ListLayout({ def, run, change }: LayoutProps) {
  const [limit, setLimit] = useState(FIRST);
  let shown = 0;
  return (
    <div className="ws-list">
      {groupsOf(run).map((g) => {
        const folded = (def.collapsed ?? []).includes(g.key);
        const rows = folded ? [] : g.rows.slice(0, Math.max(0, limit - shown));
        shown += rows.length;
        return (
          <section key={g.key || 'all'} className="ws-list-group">
            {run.groups.length > 0 && <GroupHead def={def} g={g} change={change} count={g.rows.length} />}
            {!folded && (
              <ul>
                {rows.map((r) => (
                  <ListRow key={r.id} r={r} fields={def.fields.filter((f) => f !== def.groupBy)} run={run} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {run.rows.length > limit && (
        <button type="button" className="ws-more" onClick={() => setLimit(limit + 200)}>
          Show {Math.min(200, run.rows.length - limit)} more
        </button>
      )}
    </div>
  );
}

function ListRow({ r, fields, run }: { r: WsRecord; fields: string[]; run: RecordRun }) {
  const ctx = useRecords();
  const [editTitle, setEditTitle] = useState(0);
  const target = useDropTarget({ record: r });
  const long = fields.filter((f) => !isComputedKey(f) && typeOf(ctx.fields, f) === 'long' && r.fields[f]);
  const short = fields.filter((f) => isComputedKey(f) || typeOf(ctx.fields, f) !== 'long');
  return (
    <li
      className={`ws-row${isDoneRecord(r) ? ' is-done' : ''}${target.over ? ' is-over' : ''}`}
      tabIndex={0}
      draggable={ctx.canEdit}
      onDragStart={(e) => startDrag(e, r)}
      onDragEnd={endDrag}
      onClick={clickOpen(ctx, r)}
      onContextMenu={rowContext(ctx, r)}
      onKeyDown={rowKeys(ctx, r, () => setEditTitle((n) => n + 1))}
      {...target.props}
    >
      {r.kind === 'action' ? <Tick r={r} /> : <span className={`ws-row-icon kind-${r.kind}`}><Icon name={KIND_ICON[r.kind]} size={13} /></span>}
      <div className="ws-row-main">
        <TitleCell r={r} editSignal={editTitle} />
        {long.length > 0 && (
          <div className="ws-row-sub">
            {long.slice(0, 1).map((f) => (
              <FieldCell key={f} r={r} field={f} run={run} />
            ))}
          </div>
        )}
      </div>
      <div className="ws-row-meta">
        {short.map((f) => (
          <FieldCell key={f} r={r} field={f} run={run} compact />
        ))}
      </div>
    </li>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function BoardLayout({ def, run, change }: LayoutProps) {
  const ctx = useRecords();
  const field = def.groupBy;
  // The fade follows the columns that hide (the tab bar's own fade, PageTabs.tsx: many columns keep
  // 260px and the board scrolls sideways, never a squeeze).
  const boardRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState('none');
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setFade(max <= 2 ? 'none' : el.scrollLeft <= 4 ? 'right' : el.scrollLeft >= max - 4 ? 'left' : 'both');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [run.groups.length]);
  if (!field)
    return (
      <div className="ws-hint-box">
        <Icon name="board" size={18} />
        <p>A board puts cards in a column for each value of a field. Choose the field from Group.</p>
      </div>
    );
  // Every value the field has (so an emptied column stays a drop target), in the view's order.
  const info = ctx.fields.find((f) => f.key === field);
  const keys = new Set(run.groups.map((g) => g.key));
  const extra = (info?.values ?? []).filter((v) => !keys.has(v) && !/^(overdue|due today)$/i.test(v) && run.groups.length < 8);
  const groups: RecordGroup[] = [...run.groups, ...extra.slice(0, Math.max(0, 7 - run.groups.length)).map((v) => ({ key: v, label: v, rows: [] }))];
  return (
    <div className="ws-board" ref={boardRef} data-fade={fade}>
      {groups.map((g) => (
        <BoardColumn key={g.key || 'none'} def={def} g={g} run={run} change={change} />
      ))}
    </div>
  );
}

function BoardColumn({ def, g, run, change }: { def: RecordViewDef; g: RecordGroup; run: RecordRun; change(patch: Partial<RecordViewDef>): void }) {
  const ctx = useRecords();
  const field = def.groupBy!;
  const folded = (def.collapsed ?? []).includes(g.key);
  const target = useDropTarget(null, (r) => {
    // (a card from another view, an action over the workstreams' board, is for the cards here, not the column)
    if (!def.kinds.includes(r.kind) || !ctx.editable(r).includes(field) || String(r.fields[field] ?? '').toLowerCase() === g.key.toLowerCase()) return null;
    return { words: g.key ? `Move to ${g.label}` : `Clear ${recordColumnLabel(field).toLowerCase()}`, run: () => void ctx.setField(r, field, g.key) };
  });
  const [limit, setLimit] = useState(40);
  const empty = g.rows.length === 0;
  return (
    <section className={`ws-col${folded ? ' is-folded' : ''}${empty && !folded ? ' is-empty' : ''}${target.over ? ' is-over' : ''}`} {...target.props} aria-label={g.label}>
      <header className="ws-col-head">
        <button type="button" className="ws-col-fold" aria-expanded={!folded} title={folded ? 'Unfold' : 'Fold'} onClick={() => change({ collapsed: folded ? (def.collapsed ?? []).filter((k) => k !== g.key) : [...(def.collapsed ?? []), g.key] })}>
          {typeOf(ctx.fields, field) === 'person' && g.key ? <Avatar name={g.key} size={18} /> : <span className={`ws-dot tone-${toneDot(g.label, field)}`} />}
          <span className="ws-col-name" title={g.label}>{g.label}</span>
          <span className="ws-group-count">{g.rows.length}</span>
        </button>
      </header>
      {!folded && (
        <div className="ws-col-cards">
          {g.rows.slice(0, limit).map((r) => (
            <BoardCard key={r.id} r={r} fields={def.fields.filter((f) => f !== field)} run={run} />
          ))}
          {g.rows.length > limit && (
            <button type="button" className="ws-more" onClick={() => setLimit(limit + 40)}>
              {g.rows.length - limit} more
            </button>
          )}
          {!g.rows.length && <p className="ws-col-empty">Drop here</p>}
        </div>
      )}
    </section>
  );
}
const toneDot = (v: string, field: string) => toneOf(v, field);

function BoardCard({ r, fields, run }: { r: WsRecord; fields: string[]; run: RecordRun }) {
  const ctx = useRecords();
  const [editTitle, setEditTitle] = useState(0);
  const target = useDropTarget({ record: r });
  return (
    <article
      className={`ws-card${isDoneRecord(r) ? ' is-done' : ''}${target.over ? ' is-over' : ''}`}
      tabIndex={0}
      draggable={ctx.canEdit}
      onDragStart={(e) => startDrag(e, r)}
      onDragEnd={endDrag}
      onClick={clickOpen(ctx, r)}
      onContextMenu={rowContext(ctx, r)}
      onKeyDown={rowKeys(ctx, r, () => setEditTitle((n) => n + 1))}
      {...target.props}
    >
      <div className="ws-card-title" title={r.title}>
        <Tick r={r} />
        <TitleCell r={r} editSignal={editTitle} />
      </div>
      {fields.length > 0 && (
        <div className="ws-card-fields">
          {fields.map((f) => {
            const v = isComputedKey(f) ? computedOf(run, r, f) : r.fields[f];
            if (v === null || v === undefined || v === '') return null;
            return (
              <div key={f} className={`ws-card-field type-${isComputedKey(f) ? computedKind([v]) : typeOf(ctx.fields, f)}`}>
                <FieldCell r={r} field={f} run={run} compact />
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

// ── Gallery ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const EXT_TONE: Record<string, string> = { PDF: 'red', XLSX: 'green', XLS: 'green', CSV: 'green', DOCX: 'blue', DOC: 'blue', PPTX: 'orange', MD: 'ink', TXT: 'ink', PNG: 'purple', JPG: 'purple', JPEG: 'purple' };

export function GalleryLayout({ def, run, change }: LayoutProps) {
  const [limit, setLimit] = useState(FIRST);
  let shown = 0;
  return (
    <div className="ws-gallery-wrap">
      {groupsOf(run).map((g) => {
        const folded = (def.collapsed ?? []).includes(g.key);
        const rows = folded ? [] : g.rows.slice(0, Math.max(0, limit - shown));
        shown += rows.length;
        return (
          <section key={g.key || 'all'} className="ws-gallery-group">
            {run.groups.length > 0 && <GroupHead def={def} g={g} change={change} count={g.rows.length} />}
            {!folded && (
              <div className="ws-gallery">
                {rows.map((r) => (
                  <GalleryCard key={r.id} r={r} fields={def.fields.filter((f) => f !== def.groupBy)} run={run} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {run.rows.length > limit && (
        <button type="button" className="ws-more" onClick={() => setLimit(limit + 200)}>
          Show {Math.min(200, run.rows.length - limit)} more
        </button>
      )}
    </div>
  );
}

function GalleryCard({ r, fields, run }: { r: WsRecord; fields: string[]; run: RecordRun }) {
  const ctx = useRecords();
  const [editTitle, setEditTitle] = useState(0);
  const target = useDropTarget({ record: r });
  const ext = String(r.fields.type ?? '');
  const art =
    r.kind === 'person' ? (
      <Avatar name={r.title} size={38} />
    ) : r.kind === 'file' ? (
      <span className={`ws-file-art tone-${EXT_TONE[ext] ?? 'ink'}`}>{ext ? ext.slice(0, 4) : <Icon name="file" size={16} />}</span>
    ) : (
      <span className={`ws-kind-art kind-${r.kind}`}>
        <Icon name={KIND_ICON[r.kind]} size={16} />
      </span>
    );
  const showFields = fields.filter((f) => !(r.kind === 'file' && f === 'type'));
  return (
    <article
      className={`ws-tile kind-${r.kind}${isDoneRecord(r) ? ' is-done' : ''}${target.over ? ' is-over' : ''}`}
      tabIndex={0}
      draggable={ctx.canEdit}
      onDragStart={(e) => startDrag(e, r)}
      onDragEnd={endDrag}
      onClick={clickOpen(ctx, r)}
      onContextMenu={rowContext(ctx, r)}
      onKeyDown={rowKeys(ctx, r, () => setEditTitle((n) => n + 1))}
      {...target.props}
    >
      {/* A picture kept in the vault shows itself (Wave 4 part c: All files and a project's Files). */}
      {r.kind === 'file' && r.path && isImage(r.path) && !r.ref && (
        <span className="ws-tile-pic" aria-hidden="true">
          <img src={fileUrl(r.path)} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = 'none')} />
        </span>
      )}
      <div className="ws-tile-top">
        {art}
        <div className="ws-tile-name">
          <TitleCell r={r} editSignal={editTitle} />
          {r.kind === 'person' && r.fields.role ? <span className="ws-tile-sub">{String(r.fields.role)}</span> : null}
          {r.kind === 'file' && (r.fields.belongs || r.fields.where) ? <span className="ws-tile-sub">{r.fields.belongs ? `In ${String(r.fields.belongs)}` : String(r.fields.where)}{r.fields.status === 'On this PC' ? ' · linked where it is on this PC' : r.fields.status === 'Not on this PC' ? ' · not on this PC any more' : ''}</span> : null}
        </div>
      </div>
      {r.kind === 'workstream' && typeof r.fields.progress === 'number' && (
        <div className="ws-tile-progress">
          <Value r={r} field="progress" fields={ctx.fields} />
        </div>
      )}
      <dl className="ws-tile-fields">
        {showFields.map((f) => {
          if (f === 'progress' && r.kind === 'workstream') return null;
          if (r.kind === 'person' && f === 'role') return null;
          const v = isComputedKey(f) ? computedOf(run, r, f) : r.fields[f];
          if (v === null || v === undefined || v === '') return null;
          return (
            <div key={f} className={`ws-tile-field type-${isComputedKey(f) ? computedKind([v]) : typeOf(ctx.fields, f)}`}>
              <dt>{recordColumnLabel(f)}</dt>
              <dd>
                <FieldCell r={r} field={f} run={run} compact />
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
