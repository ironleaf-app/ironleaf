// Making or changing a rollup column (8.8 database depth; src/shared/views.ts): a name, the relation to follow, the
// field to read on the linked records, and how to add it up — in plain words, with what it works out to for the view's
// first few notes as it is set up. One editor for the whole window, opened from a table's "Add a column" or a column's
// ⋯, next to the formula editor.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { looksLikeRelation } from '../../../../shared/relation-links';
import { computeRollups, FIELD_FOLDER, FIELD_MODIFIED, FIELD_TAGS, FIELD_TITLE, propWords, ROLLUP_OP_WORDS, ROLLUP_OPS, valueOf, valueText, withRollup, withoutRollup, type KnownProp, type RollupDef, type RollupOp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { showError } from '../../state/store';

interface Request {
  def: ViewDef;
  /** The notes the view shows (the first few are worked out as an example). */
  rows: ViewRow[];
  props: KnownProp[];
  change(patch: Partial<ViewDef>): void;
  /** The rollup being changed; none for a new one. */
  name?: string;
}

let open: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openRollupEditor(request: Request): void {
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

const FIELDS: [string, string][] = [
  [FIELD_TITLE, 'Name'],
  [FIELD_FOLDER, 'Folder'],
  [FIELD_MODIFIED, 'Changed'],
  [FIELD_TAGS, 'Tags'],
];

export function RollupEditorHost() {
  const request = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
  if (!request) return null;
  return <RollupEditor key={`${request.name ?? ''}`} request={request} />;
}

function RollupEditor({ request }: { request: Request }) {
  const { def, rows, props, change, name: was } = request;
  const current: RollupDef | undefined = was ? def.rollups?.[was] : undefined;
  const [name, setName] = useState(was ?? '');
  const [relation, setRelation] = useState(current?.relation ?? '');
  const [field, setField] = useState(current?.field ?? '');
  const [op, setOp] = useState<RollupOp>(current?.op ?? 'sum');
  const nameBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameBox.current?.focus();
  }, []);

  // Relations first: the properties holding [[links]] head the list; the rest follow, so a relation not yet
  // filled in can still be picked.
  const relations = useMemo(() => {
    const sample = (key: string) => rows.slice(0, 40).map((r) => valueOf(r, key));
    const linked = props.filter((p) => looksLikeRelation(sample(p.key)));
    const rest = props.filter((p) => !linked.includes(p));
    return [...linked, ...rest];
  }, [props, rows]);
  useEffect(() => {
    if (!relation && relations.length) setRelation(relations[0].key);
  }, [relations, relation]);
  const fields = useMemo(() => [...FIELDS.map(([key, words]) => ({ key, words })), ...props.filter((p) => p.key.toLowerCase() !== relation.toLowerCase()).map((p) => ({ key: p.key, words: propWords(p.key) }))], [props, relation]);

  const examples = useMemo(() => {
    if (!relation || !field) return [];
    const preview: Record<string, RollupDef> = { preview: { relation, field, op } };
    return rows.slice(0, 3).map((r) => ({ title: r.title, value: computeRollups(r, preview, rows).preview }));
  }, [rows, relation, field, op]);

  const save = () => {
    if (!name.trim() || !relation || !field) return;
    try {
      change(withRollup(def, name, { relation, field, op }, was));
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
        aria-labelledby="sv-rollup-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2 id="sv-rollup-title">{was ? 'Change the rollup' : 'New rollup column'}</h2>
        <p className="hint">Adds up one field across the records a relation links to, such as a project’s total of its tasks’ hours. It stays up to date as notes change.</p>
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
                  {propWords(p.key)}
                </option>
              ))}
            </select>
          </label>
          <label className="sv-formula-field">
            <span>Read this field</span>
            <select value={field} onChange={(e) => setField(e.currentTarget.value)}>
              {!field && <option value="">Pick one…</option>}
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.words}
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
        <div id="sv-rollup-result" className="sv-formula-result" role="status">
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
            <p className="sv-hint">{rows.length ? 'What it works out to for the first notes shows here.' : 'This view has no notes yet; the rollup is worked out once it has some.'}</p>
          )}
        </div>
        {relations.length === 0 && (
          <p className="sv-hint">
            <Icon name="info" size={13} /> These notes have no properties yet. Add one holding [[links]] to other notes, and it can be followed here.
          </p>
        )}
        <div className="dialog-actions">
          {was && (
            <button
              type="button"
              className="button danger-text sv-formula-remove"
              onClick={() => {
                change(withoutRollup(def, was));
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
