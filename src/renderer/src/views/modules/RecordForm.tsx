// A record's form (Wave 5 part a): every field a module's record has, each with its own kind of input — words, money, a
// number, a day, one of a few choices, a yes or no, a number kept in Secrets, files to keep with it — in one calm dialog
// that says what is wrong in plain words beside the field. One form for every module's records (a bill, an account, a
// budget, a payment, a document), so they all look and behave the same.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../../components/Icon';
import { errorMessage } from '../../lib/errors';
import { useEscape } from '../../lib/useEscape';
import { closeTours } from '../../state/moduleFills';

export type FormKind = 'text' | 'money' | 'number' | 'date' | 'choice' | 'toggle' | 'segment' | 'secret' | 'files' | 'vendor';

export interface RecordFormField {
  key: string;
  label: string;
  kind: FormKind;
  options?: string[];
  hint?: string;
  placeholder?: string;
  required?: boolean;
  value?: string | boolean | string[];
  /** Takes the whole row (words, a note). */
  wide?: boolean;
  /** Shown only when this says so (a CV's version only for a CV). */
  show?(values: FormValues): boolean;
  /** Words that let the person type a choice of their own ("Something else…"). */
  own?: boolean;
}
export type FormValues = Record<string, string | boolean | string[]>;

/** A vendor name, typed (9.2 uplift F48): a real picker, not a native select whose type-ahead silently lands on
 *  the first prefix match. An exact name uses that vendor; near matches are one-tap picks; anything else is an
 *  explicit new vendor, said as such before anything is made. */
function VendorPick({ id, options, value, onPick, bad, hintId, inputRef }: { id: string; options: string[]; value: string; onPick(name: string): void; bad: boolean; hintId?: string; inputRef(el: HTMLInputElement | null): void }) {
  const names = options.filter(Boolean);
  const [text, setText] = useState(value);
  const trimmed = text.trim();
  const exact = names.find((o) => o.toLowerCase() === trimmed.toLowerCase());
  const near = !exact && trimmed ? names.filter((o) => o.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 5) : [];
  const type = (next: string) => {
    setText(next);
    const t = next.trim();
    onPick(names.find((o) => o.toLowerCase() === t.toLowerCase()) ?? next);
  };
  const take = (name: string) => {
    setText(name);
    onPick(name);
  };
  return (
    <>
      <div className="rf-input-wrap">
        <input ref={inputRef} id={id} type="text" autoComplete="off" value={text} placeholder="Their name" onChange={(e) => type(e.target.value)} aria-invalid={bad || undefined} aria-describedby={hintId} />
      </div>
      {trimmed &&
        (exact ? (
          <p className="rf-hint">Uses {exact}.</p>
        ) : near.length ? (
          <p className="rf-hint">
            <span>Did you mean…</span>{' '}
            {near.map((o) => (
              <button key={o} type="button" className="text-button" onClick={() => take(o)}>
                {o}
              </button>
            ))}{' '}
            <span>…or a new vendor “{trimmed}”.</span>
          </p>
        ) : (
          <p className="rf-hint">A new vendor “{trimmed}”.</p>
        ))}
    </>
  );
}

export interface RecordFormSpec {
  title: string;
  icon: IconName;
  line?: string;
  fields: RecordFormField[];
  ok: string;
  /** Does it; a thrown error's words show in the form, which stays open. */
  submit(values: FormValues): Promise<void>;
}

let current: RecordFormSpec | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export function openRecordForm(spec: RecordFormSpec): void {
  // A tour left open would sit dimmed behind the form with its Close unreachable: it goes first (p14, 4 Nov 2026).
  closeTours();
  current = spec;
  emit();
}
const closeForm = () => {
  current = null;
  emit();
};

// One host draws the form, whichever page mounted first (the module's page, or Today's part).
let owner = 0;
let next = 1;

export function RecordFormHost() {
  const [me] = useState(() => next++);
  useEffect(() => {
    if (!owner) owner = me;
    return () => {
      if (owner === me) owner = 0;
    };
  }, [me]);
  const spec = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  if (!spec || (owner && owner !== me)) return null;
  return createPortal(<FormDialog key={spec.title} spec={spec} />, document.body);
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function FormDialog({ spec }: { spec: RecordFormSpec }) {
  const [values, setValues] = useState<FormValues>(() => Object.fromEntries(spec.fields.map((f) => [f.key, f.value ?? (f.kind === 'toggle' ? false : f.kind === 'files' ? [] : f.kind === 'choice' || f.kind === 'segment' ? (f.options?.[0] ?? '') : '')])));
  const [problem, setProblem] = useState<{ key?: string; words: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [ownChoice, setOwnChoice] = useState<Record<string, boolean>>({});
  const first = useRef<HTMLInputElement | null>(null);
  useEscape(() => !busy && closeForm());
  useEffect(() => first.current?.focus(), []);
  const set = (key: string, v: string | boolean | string[]) => {
    setValues((x) => ({ ...x, [key]: v }));
    if (problem?.key === key) setProblem(null);
  };
  const visible = spec.fields.filter((f) => !f.show || f.show(values));
  const go = async () => {
    for (const f of visible) {
      const v = values[f.key];
      if (f.required && (typeof v === 'string' ? !v.trim() : Array.isArray(v) ? !v.length : false)) return setProblem({ key: f.key, words: `${f.label} is needed.` });
      if ((f.kind === 'money' || f.kind === 'number') && typeof v === 'string' && v.trim() && !Number.isFinite(Number(v.replace(/[$,\s]/g, '')))) return setProblem({ key: f.key, words: `${f.label} should be a number, like 89.95.` });
    }
    setBusy(true);
    try {
      await spec.submit(values);
      closeForm();
    } catch (err) {
      setProblem({ words: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  let firstSet = false;
  const ref = (el: HTMLInputElement | null) => {
    if (!firstSet && el) {
      first.current = el;
      firstSet = true;
    }
  };
  return (
    <div className="overlay rf-overlay" onMouseDown={() => !busy && closeForm()}>
      <div
        className="dialog rf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rf-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') {
            e.preventDefault();
            void go();
          }
        }}
      >
        <header className="rf-head">
          <span className="rf-mark" aria-hidden="true">
            <Icon name={spec.icon} size={18} />
          </span>
          <div>
            <h2 id="rf-dialog-title">{spec.title}</h2>
            {spec.line && <p className="rf-line">{spec.line}</p>}
          </div>
        </header>
        <div className="rf-grid">
          {visible.map((f) => {
            const v = values[f.key];
            const bad = problem?.key === f.key;
            const id = `rf-${f.key}`;
            return (
              <div key={f.key} className={`rf-field kind-${f.kind}${f.wide ? ' is-wide' : ''}${bad ? ' is-bad' : ''}`}>
                <label htmlFor={id} className="rf-label">
                  {f.label}
                  {f.required && <span className="rf-req" aria-hidden="true"> *</span>}
                </label>
                {f.kind === 'toggle' ? (
                  <button type="button" id={id} role="switch" aria-checked={v === true} className={`rf-switch${v === true ? ' is-on' : ''}`} onClick={() => set(f.key, v !== true)}>
                    <span className="rf-knob" />
                    <span className="rf-switch-words">{v === true ? 'Yes' : 'No'}</span>
                  </button>
                ) : f.kind === 'segment' ? (
                  <div className="seg rf-seg" role="radiogroup" aria-label={f.label}>
                    {(f.options ?? []).map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={v === o} className={v === o ? 'on' : ''} onClick={() => set(f.key, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                ) : f.kind === 'choice' && !ownChoice[f.key] ? (
                  <div className="rf-select-wrap">
                    <select
                      id={id}
                      value={String(v ?? '')}
                      onChange={(e) => {
                        if (e.target.value === '\u0000own') {
                          setOwnChoice((o) => ({ ...o, [f.key]: true }));
                          set(f.key, '');
                        } else set(f.key, e.target.value);
                      }}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o || ''}
                        </option>
                      ))}
                      {f.own && <option value={'\u0000own'}>Something else…</option>}
                    </select>
                    <Icon name="chevronDown" size={12} className="rf-select-icon" />
                  </div>
                ) : f.kind === 'vendor' ? (
                  <VendorPick id={id} options={f.options ?? []} value={String(v ?? '')} onPick={(name) => set(f.key, name)} bad={bad} hintId={f.hint ? `${id}-hint` : undefined} inputRef={ref} />
                ) : f.kind === 'files' ? (
                  <div className="rf-files">
                    <button
                      type="button"
                      className="button small"
                      onClick={async () => {
                        const picked = await window.nv.recmod.pickFiles(`Choose files for ${spec.title.toLowerCase()}`).catch(() => []);
                        if (picked.length) set(f.key, [...(Array.isArray(v) ? v : []), ...picked].slice(0, 10));
                      }}
                    >
                      <Icon name="paperclip" size={13} /> Choose files…
                    </button>
                    {Array.isArray(v) && v.length > 0 && (
                      <ul className="rf-file-list">
                        {v.map((p) => (
                          <li key={p}>
                            <Icon name="file" size={12} />
                            <span>{p.split(/[\\/]/).pop()}</span>
                            <button type="button" className="icon-button small" aria-label={`Leave out ${p.split(/[\\/]/).pop()}`} onClick={() => set(f.key, (v as string[]).filter((x) => x !== p))}>
                              <Icon name="close" size={11} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className={`rf-input-wrap${f.kind === 'money' ? ' is-money' : ''}`}>
                    {f.kind === 'money' && <span className="rf-prefix">$</span>}
                    <input
                      ref={ref}
                      id={id}
                      type={f.kind === 'date' ? 'date' : f.kind === 'secret' && !shown[f.key] ? 'password' : 'text'}
                      inputMode={f.kind === 'money' ? 'decimal' : f.kind === 'number' ? 'numeric' : undefined}
                      autoComplete="off"
                      spellCheck={f.kind === 'text'}
                      value={String(v ?? '')}
                      placeholder={f.placeholder ?? (f.kind === 'money' ? '0.00' : '')}
                      max={f.kind === 'date' ? '2099-12-31' : undefined}
                      onChange={(e) => set(f.key, e.target.value)}
                      aria-invalid={bad || undefined}
                      aria-describedby={f.hint ? `${id}-hint` : undefined}
                    />
                    {f.kind === 'secret' && (
                      <button type="button" className="icon-button small rf-eye" aria-label={shown[f.key] ? 'Hide it' : 'Show it'} title={shown[f.key] ? 'Hide it' : 'Show it'} onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}>
                        <Icon name="eye" size={13} />
                      </button>
                    )}
                    {f.kind === 'date' && !v && (
                      <button type="button" className="rf-today" onClick={() => set(f.key, todayIso())}>
                        Today
                      </button>
                    )}
                  </div>
                )}
                {f.hint && (
                  <p id={`${id}-hint`} className="rf-hint">
                    {f.kind === 'secret' && <Icon name="lock" size={11} />} {f.hint}
                  </p>
                )}
                {bad && <p className="rf-problem">{problem!.words}</p>}
              </div>
            );
          })}
        </div>
        {problem && !problem.key && (
          <p className="rf-problem rf-problem-all" role="alert">
            <Icon name="warning" size={13} /> {problem.words}
          </p>
        )}
        <div className="dialog-actions rf-actions">
          <button type="button" className="button" disabled={busy} onClick={closeForm}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void go()}>
            {busy ? 'Saving…' : spec.ok}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A form's value as words, a number (money and numbers: "$1,234.50" → 1234.5), a day, or a yes. */
export const valueWords = (v: FormValues, k: string): string => (typeof v[k] === 'string' ? (v[k] as string).trim() : '');
export const valueNumber = (v: FormValues, k: string): number | null => {
  const s = valueWords(v, k).replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
export const valueFiles = (v: FormValues, k: string): string[] => (Array.isArray(v[k]) ? (v[k] as string[]) : []);
