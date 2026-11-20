// Making or changing a formula column over records (10.0 Endless Tech,
// v10records2; src/shared/record-views.ts): a name, the formula, and what it
// works out to for the first few records as it is typed, so a mistake shows
// before it is kept. One editor for the whole window, opened from a record
// table's column menu or the Fields panel, next to the rollup editor.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { formulaProblem, isFault, runFormula } from '../../../../shared/formula';
import { recordsAsRows, type FieldInfo, type RecordViewDef } from '../../../../shared/record-views';
import { computeFormulas, valueOf, type ViewRow } from '../../../../shared/views';
import type { WsRecord } from '../../../../shared/workspace-records';
import { Icon } from '../../components/Icon';
import { showError } from '../../state/store';
import { withRecordFormula, withoutRecordFormula } from './recordColumns';

interface Request {
  def: RecordViewDef;
  /** The records the view can show (the first few are worked out as an example). */
  records: WsRecord[];
  fields: FieldInfo[];
  change(patch: Partial<RecordViewDef>): void;
  /** The formula being changed; none for a new one. */
  name?: string;
}

let open: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openRecordFormulaEditor(request: Request): void {
  open = request;
  emit();
}

function close(): void {
  open = null;
  emit();
}

/** The functions offered to put in, each with a short example of how it is written. */
const FUNCTIONS: [string, string][] = [
  ['if(', 'if(done, "Yes", "No")'],
  ['concat(', 'concat(owner, " · ", status)'],
  ['round(', 'round(cost * 1.1, 2)'],
  ['daysBetween(', 'daysBetween(today(), due)'],
  ['dateAdd(', 'dateAdd(due, 2, "weeks")'],
  ['today()', 'today()'],
  ['now()', 'now()'],
  ['min(', 'min(a, b)'],
  ['max(', 'max(a, b)'],
  ['length(', 'length(tags)'],
  ['contains(', 'contains(status, "open")'],
  ['empty(', 'empty(owner)'],
  ['lower(', 'lower(status)'],
  ['upper(', 'upper(code)'],
];

/** A field's name as a formula writes it: as it is when it reads as one word, else record["its name"]. */
const ONE_WORD = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const nameInFormula = (key: string) => (ONE_WORD.test(key) ? key : `note[${JSON.stringify(key)}]`);
/** Another formula as this one names it: formula.Total, or formula["Days left"]. */
const formulaInFormula = (name: string) => (ONE_WORD.test(name) ? `formula.${name}` : `formula[${JSON.stringify(name)}]`);

export function RecordFormulaEditorHost() {
  const request = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
  if (!request) return null;
  return <RecordFormulaEditor key={`${request.name ?? ''}`} request={request} />;
}

function RecordFormulaEditor({ request }: { request: Request }) {
  const { def, records, fields, change, name: was } = request;
  const [name, setName] = useState(was ?? '');
  const [expr, setExpr] = useState(was ? (def.formulas?.[was] ?? '') : '');
  const nameBox = useRef<HTMLInputElement>(null);
  const exprBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    (was ? exprBox : nameBox).current?.focus();
  }, [was]);

  const problem = expr.trim() ? formulaProblem(expr) : null;
  // The first few records, worked out with the view's other formulas (a formula may use them).
  const examples = useMemo(() => {
    if (!expr.trim() || problem) return [];
    const others = { ...def.formulas };
    if (was) delete others[was];
    const sample = records.slice(0, 3);
    const rows = recordsAsRows(sample, new Date(), others);
    return sample.map((r, i) => {
      const row: ViewRow = { ...rows[i], computed: computeFormulas(rows[i], others) };
      return {
        title: r.title,
        value: runFormula(expr, {
          prop: (n) => valueOf(row, n),
          file: (f) => (f === 'title' ? r.title : f === 'folder' ? '' : f === 'modified' ? 0 : f === 'tags' ? [] : r.id),
          formula: (n) => valueOf(row, `formula.${n}`),
          now: new Date(),
        }),
      };
    });
  }, [expr, problem, records, def.formulas, was]);

  const insert = (words: string) => {
    const box = exprBox.current;
    if (!box) return setExpr((e) => e + words);
    const start = box.selectionStart ?? expr.length;
    const end = box.selectionEnd ?? expr.length;
    const next = expr.slice(0, start) + words + expr.slice(end);
    setExpr(next);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(start + words.length, start + words.length);
    });
  };
  const save = () => {
    if (!expr.trim() || problem) return;
    try {
      change(withRecordFormula(def, name, expr, was));
      close();
    } catch (err) {
      showError(err);
    }
  };
  const canSave = !!name.trim() && !!expr.trim() && !problem;

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="dialog sv-formula-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-record-formula-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2 id="sv-record-formula-title">{was ? 'Change the formula' : 'New formula column'}</h2>
        <p className="hint">Works something out from each record, such as cost × quantity or the days until it is due. It shows as a column you can sort, filter and group by.</p>
        <label className="sv-formula-field">
          <span>Name</span>
          <input ref={nameBox} value={name} placeholder="For example: Days left" spellCheck={false} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), exprBox.current?.focus())} />
        </label>
        <label className="sv-formula-field">
          <span>Formula</span>
          <textarea
            ref={exprBox}
            value={expr}
            rows={3}
            spellCheck={false}
            placeholder="For example: daysBetween(today(), due)"
            aria-invalid={!!problem}
            aria-describedby="sv-record-formula-result"
            onChange={(e) => setExpr(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>
        <div id="sv-record-formula-result" className="sv-formula-result" role="status">
          {problem ? (
            <p className="sv-formula-problem">
              <Icon name="warning" size={13} /> {problem}
            </p>
          ) : examples.length ? (
            <ul>
              {examples.map((x, i) => (
                <li key={i}>
                  <span className="sv-formula-note">{x.title}</span>
                  {isFault(x.value) ? <span className="sv-fault-words">{x.value.reason}</span> : <span className="sv-formula-value">{formatExample(x.value)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sv-hint">{records.length ? 'What it works out to for the first records shows here.' : 'This view has no records yet; the formula is worked out once it has some.'}</p>
          )}
        </div>
        <details className="sv-formula-help">
          <summary>What you can use</summary>
          <div className="sv-formula-group">
            <span className="sv-formula-group-name">Fields</span>
            {fields.length === 0 && <span className="sv-faint">These records have no fields yet.</span>}
            {fields.slice(0, 30).map((f) => (
              <button key={f.key} type="button" className="sv-formula-chip" title={`Put in ${nameInFormula(f.key)}`} onClick={() => insert(nameInFormula(f.key))}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="sv-formula-group">
            <span className="sv-formula-group-name">Formulas</span>
            {Object.keys(def.formulas ?? {})
              .filter((n) => n !== was)
              .map((n) => (
                <button key={n} type="button" className="sv-formula-chip" title={`Put in ${formulaInFormula(n)}`} onClick={() => insert(formulaInFormula(n))}>
                  {n}
                </button>
              ))}
          </div>
          <div className="sv-formula-group">
            <span className="sv-formula-group-name">Functions</span>
            {FUNCTIONS.map(([put, example]) => (
              <button key={put} type="button" className="sv-formula-chip is-code" title={example} onClick={() => insert(put)}>
                {put.replace(/\($/, '')}
              </button>
            ))}
          </div>
          <p className="sv-hint">Also + − × ÷ as + - * /, comparisons such as due {'<'} today(), and &&, || and ! (and, or, not). Words go in quotes: "Done". Days can move on: due + "1 week".</p>
        </details>
        <div className="dialog-actions">
          {was && (
            <button
              type="button"
              className="button danger-text sv-formula-remove"
              onClick={() => {
                change(withoutRecordFormula(def, was));
                close();
              }}
            >
              Remove the formula
            </button>
          )}
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!canSave} onClick={save} title="Ctrl+Enter">
            {was ? 'Keep the change' : 'Add the column'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatExample(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Nothing (empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(v);
  if (Array.isArray(v)) return v.map(formatExample).join(', ');
  return String(v);
}
