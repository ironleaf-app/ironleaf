// Making or changing a rollup column over records (10.0 Endless Tech, v10records2;
// src/shared/record-views.ts): a name, the relation to follow, the field to read
// on the linked records, and how to add it up — in plain words, with what it
// works out to for the first few records as it is set up. One editor for the
// whole window, opened from a record table's column menu or the Fields panel.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { looksLikeRelation } from '../../../../shared/relation-links';
import { fieldLabel, runRecordView, type FieldInfo, type RecordViewDef } from '../../../../shared/record-views';
import { ROLLUP_OP_WORDS, ROLLUP_OPS, valueText, type RollupDef, type RollupOp } from '../../../../shared/views';
import type { WsRecord } from '../../../../shared/workspace-records';
import { Icon } from '../../components/Icon';
import { showError } from '../../state/store';
import { withRecordRollup, withoutRecordRollup } from './recordColumns';

interface Request {
  def: RecordViewDef;
  /** The records the view can show (the first few are worked out as an example). */
  records: WsRecord[];
  fields: FieldInfo[];
  change(patch: Partial<RecordViewDef>): void;
  /** The rollup being changed; none for a new one. */
  name?: string;
}

let open: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openRecordRollupEditor(request: Request): void {
  open = request;
  emit();
}

function close(): void {
  open = null;
  emit();
}

const OP_HINTS: Record<RollupOp, string> = {
  sum: 'Adds the numbers up.',
  count: 'How many linked records have it filled in. Pick Name to count them all.',
  average: 'The average of the numbers.',
  min: 'The smallest: numbers, then days, then words.',
  max: 'The largest: numbers, then days, then words.',
  list: 'Each value, as a list.',
};

export function RecordRollupEditorHost() {
  const request = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
  if (!request) return null;
  return <RecordRollupEditor key={`${request.name ?? ''}`} request={request} />;
}

function RecordRollupEditor({ request }: { request: Request }) {
  const { def, records, fields, change, name: was } = request;
  const current: RollupDef | undefined = was ? def.rollups?.[was] : undefined;
  const [name, setName] = useState(was ?? '');
  const [relation, setRelation] = useState(current?.relation ?? '');
  const [field, setField] = useState(current?.field ?? '');
  const [op, setOp] = useState<RollupOp>(current?.op ?? 'sum');
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameBox.current?.focus();
  }, []);

  // Relations first: the joins, then fields holding [[links]]; the rest follow, so a relation not yet
  // filled in can still be picked.
  const relations = useMemo(() => {
    const sample = (key: string) => records.slice(0, 40).map((r) => r.fields[key]);
    const linked = fields.filter((f) => looksLikeRelation(sample(f.key)));
    const rest = fields.filter((f) => !linked.includes(f));
    return [{ key: 'links', label: 'Linked records' }, ...linked, ...rest];
  }, [fields, records]);
  useEffect(() => {
    if (!relation && relations.length) setRelation(relations[0].key);
  }, [relations, relation]);
  const readables = useMemo(() => [{ key: 'title', label: 'Name' }, ...fields.filter((f) => f.key.toLowerCase() !== relation.toLowerCase()).map((f) => ({ key: f.key, label: f.label }))], [fields, relation]);

  const examples = useMemo(() => {
    if (!relation || !field) return [];
    const preview = runRecordView(records, { ...def, rollups: { preview: { relation, field, op } } });
    return preview.rows.slice(0, 3).map((r) => ({ title: r.title, value: preview.rolled?.[r.id]?.preview }));
  }, [records, def, relation, field, op]);

  const save = () => {
    if (!name.trim() || !relation || !field) return;
    try {
      change(withRecordRollup(def, name, { relation, field, op }, was));
      close();
    } catch (err) {
      showError(err);
    }
  };
  const canSave = !!name.trim() && !!relation && !!field;

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="dialog sv-formula-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-record-rollup-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2 id="sv-record-rollup-title">{was ? 'Change the rollup' : 'New rollup column'}</h2>
        <p className="hint">Adds up one field across the records a relation links to, such as a project&apos;s total of its tasks&apos; hours. It stays up to date as records change.</p>
        <label className="sv-formula-field">
          <span>Name</span>
          <input ref={nameBox} value={name} placeholder="For example: Total hours" spellCheck={false} onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())} />
        </label>
        <div className="sv-rollup-grid">
          <label className="sv-formula-field">
            <span>Follow the relation</span>
            <select value={relation} onChange={(e) => setRelation(e.currentTarget.value)}>
              {!relation && <option value="">Pick one…</option>}
              {relations.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key === 'links' ? 'Linked records' : fieldLabel(p.key)}
                </option>
              ))}
            </select>
          </label>
          <label className="sv-formula-field">
            <span>Read this field</span>
            <select value={field} onChange={(e) => setField(e.currentTarget.value)}>
              {!field && <option value="">Pick one…</option>}
              {readables.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sv-formula-field">
            <span>Add it up by</span>
            <select value={op} onChange={(e) => setOp(e.currentTarget.value as RollupOp)}>
              {ROLLUP_OPS.map((o) => (
                <option key={o} value={o}>
                  {ROLLUP_OP_WORDS[o]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="sv-hint">{OP_HINTS[op]}</p>
        <div id="sv-record-rollup-result" className="sv-formula-result" role="status">
          {examples.length ? (
            <ul>
              {examples.map((x, i) => (
                <li key={i}>
                  <span className="sv-formula-note">{x.title}</span>
                  <span className="sv-formula-value">{x.value === undefined || x.value === null || x.value === '' ? 'Nothing linked yet' : Array.isArray(x.value) ? x.value.map(valueText).join(', ') : valueText(x.value)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sv-hint">{records.length ? 'What it works out to for the first records shows here.' : 'This view has no records yet; the rollup is worked out once it has some.'}</p>
          )}
        </div>
        {relations.length <= 1 && (
          <p className="sv-hint">
            <Icon name="info" size={13} /> These records have no fields holding links yet. Linked records can still be followed.
          </p>
        )}
        <div className="dialog-actions">
          {was && (
            <button
              type="button"
              className="button danger-text sv-formula-remove"
              onClick={() => {
                change(withoutRecordRollup(def, was));
                close();
              }}
            >
              Remove the rollup
            </button>
          )}
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!canSave} onClick={save}>
            {was ? 'Keep the change' : 'Add the column'}
          </button>
        </div>
      </div>
    </div>
  );
}
