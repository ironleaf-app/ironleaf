// Small questions asked in Ironleaf's own style (never the browser's grey boxes): a name to type, a yes or no, or one
// of a few choices. Each returns a promise with the answer.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLeaving } from '../lib/useLeaving';
import { closeTours } from '../state/moduleFills';

type Ask =
  | { kind: 'prompt'; title: string; message?: string; value: string; placeholder?: string; ok: string; select?: [number, number]; password?: boolean; resolve(v: string | null): void }
  | { kind: 'confirm'; title: string; message?: ReactNode; ok: string; danger?: boolean; resolve(v: boolean): void }
  | { kind: 'choose'; title: string; message?: ReactNode; options: { id: string; label: string; primary?: boolean; danger?: boolean }[]; resolve(v: string | null): void }
  | { kind: 'form'; title: string; message?: ReactNode; fields: FormField[]; checks: FormCheck[]; ok: string; resolve(v: FormAnswer | null): void }
  | { kind: 'multiline'; title: string; message?: string; placeholder?: string; ok: string; resolve(v: string | null): void }
  | { kind: 'arrival'; title: string; from: string; projects: { path: string; name: string; why: string }[]; all: { path: string; name: string }[]; picked: string; resolve(v: { project: string; step: string } | { project: string; step: null } | null): void };

/** A form's field and tick-box, and what comes back (21 Oct 2026: a template's prompts, src/shared/template-fields.ts). */
export interface FormField {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
}
export interface FormCheck {
  id: string;
  label: string;
  hint?: ReactNode;
  value: boolean;
}
export interface FormAnswer {
  values: Record<string, string>;
  checks: Record<string, boolean>;
}

let queue: Ask[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function push(ask: Ask): void {
  // A tour left open would sit dimmed behind the question with its Close unreachable (p14, 4 Nov 2026).
  closeTours();
  queue = [...queue, ask];
  emit();
}

function finish(): void {
  queue = queue.slice(1);
  emit();
}

export function prompt(title: string, options: { message?: string; value?: string; placeholder?: string; ok?: string; select?: [number, number]; password?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'prompt', title, message: options.message, value: options.value ?? '', placeholder: options.placeholder, ok: options.ok ?? 'OK', select: options.select, password: options.password, resolve }));
}

export function confirm(title: string, options: { message?: ReactNode; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', title, message: options.message, ok: options.ok ?? 'OK', danger: options.danger, resolve }));
}

export function choose(title: string, options: { id: string; label: string; primary?: boolean; danger?: boolean }[], message?: ReactNode): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'choose', title, message, options, resolve }));
}

/** A few named fields (and tick-boxes) asked at once: Enter in the last field, or OK, gives them; Esc cancels. Fields may
 *  be left empty. */
export function multiline(title: string, options: { message?: string; placeholder?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'multiline', title, message: options.message, placeholder: options.placeholder, ok: options.ok ?? 'Save it', resolve }));
}

/** The one question when an email or PDF lands (t243): which project, and what is the next step. The suggested
 *  projects come first, the step is typed once; answering with a step, without one, or not now (null). */
export function arrivalQuestion(title: string, from: string, projects: { path: string; name: string; why: string }[], all: { path: string; name: string }[], picked: string): Promise<{ project: string; step: string } | { project: string; step: null } | null> {
  return new Promise((resolve) => push({ kind: 'arrival', title, from, projects, all, picked, resolve }));
}

export function form(title: string, options: { message?: ReactNode; fields: FormField[]; checks?: FormCheck[]; ok?: string }): Promise<FormAnswer | null> {
  return new Promise((resolve) => push({ kind: 'form', title, message: options.message, fields: options.fields, checks: options.checks ?? [], ok: options.ok ?? 'OK', resolve }));
}

function FormBody({ ask }: { ask: Extract<Ask, { kind: 'form' }> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ask.fields.map((f) => [f.id, f.value ?? ''])));
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(ask.checks.map((c) => [c.id, c.value])));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), [ask]);
  const done = (v: FormAnswer | null) => {
    finish();
    ask.resolve(v);
  };
  // Enter's own key-down gives the answers (never a form's submit: the Enter that answered the question before this one
  // would arrive here as a key press and give them before anything was typed).
  return (
    <div
      className="dialog-form"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          done({ values, checks });
        }
      }}
    >
      <h2>{ask.title}</h2>
      {ask.message && <div className="dialog-message">{ask.message}</div>}
      {ask.fields.map((f, i) => (
        <label key={f.id} className="dialog-field">
          <span>{f.label}</span>
          <input ref={i === 0 ? first : undefined} value={values[f.id] ?? ''} placeholder={f.placeholder} spellCheck onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
        </label>
      ))}
      {ask.checks.map((c) => (
        <label key={c.id} className="dialog-check">
          <input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setChecks((v) => ({ ...v, [c.id]: e.target.checked }))} />
          <span>
            {c.label}
            {c.hint && <span className="hint">{c.hint}</span>}
          </span>
        </label>
      ))}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={() => done(null)}>
          Cancel
        </button>
        <button type="button" className="button primary" onClick={() => done({ values, checks })}>
          {ask.ok}
        </button>
      </div>
    </div>
  );
}

function MultilineBody({ ask }: { ask: Extract<Ask, { kind: 'multiline' }> }) {
  const [value, setValue] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), [ask]);
  const done = (v: string | null) => {
    finish();
    ask.resolve(v);
  };
  return (
    <>
      <h2>{ask.title}</h2>
      {ask.message && <div className="dialog-message">{ask.message}</div>}
      <textarea ref={area} value={value} rows={8} placeholder={ask.placeholder} spellCheck onChange={(e) => setValue(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
      <div className="dialog-actions">
        <button className="button" onClick={() => done(null)}>
          Cancel
        </button>
        <button className="button primary" disabled={!value.trim()} onClick={() => done(value.trim())}>
          {ask.ok}
        </button>
      </div>
    </>
  );
}

function ArrivalBody({ ask }: { ask: Extract<Ask, { kind: 'arrival' }> }) {
  const [picked, setPicked] = useState(ask.picked);
  const [step, setStep] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [ask]);
  const done = (v: { project: string; step: string } | { project: string; step: null } | null) => {
    finish();
    ask.resolve(v);
  };
  const names = new Map(ask.all.map((p) => [p.path, p.name]));
  const another = async () => {
    const { pick } = await import('./Pickers');
    const { fuzzyFilter } = await import('../lib/fuzzy');
    const id = await pick({ placeholder: 'Which project?', items: (q) => fuzzyFilter(ask.all, q, (p) => p.name, 60).map((p) => ({ id: p.path, label: p.name })), footer: '↑↓ to move · Enter to choose it · Esc to cancel' });
    if (id) setPicked(id);
  };
  const chosen = names.get(picked) ?? ask.projects.find((p) => p.path === picked)?.name ?? '';
  return (
    <>
      <h2>Which project, and what is the next step?</h2>
      <div className="dialog-message">
        {ask.title}
        {ask.from && <> · from {ask.from}</>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
        {ask.projects.map((p) => (
          <button key={p.path} type="button" className={`chip${p.path === picked ? ' on' : ''}`} title={p.why} style={{ whiteSpace: 'normal', textAlign: 'left', overflow: 'visible', textOverflow: 'clip' }} onClick={() => setPicked(p.path)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => void another()}>
          Another project…
        </button>
      </div>
      {picked && !ask.projects.some((p) => p.path === picked) && chosen && <div className="dialog-message">{chosen}</div>}
      <label className="dialog-field">
        <span>Next step (or file it with no next step)</span>
        <input
          ref={input}
          value={step}
          placeholder="What needs doing?"
          spellCheck
          onChange={(e) => setStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && picked && step.trim()) done({ project: picked, step: step.trim() });
          }}
        />
      </label>
      <div className="dialog-actions">
        <button className="button" onClick={() => done(null)}>
          Not now
        </button>
        <button className="button" disabled={!picked} title={picked ? `File it under ${chosen} with no next step` : 'Choose a project first'} onClick={() => picked && done({ project: picked, step: null })}>
          File it with no next step
        </button>
        <button className="button primary" disabled={!picked || !step.trim()} title={picked ? `File it under ${chosen} and make this its next step` : 'Choose a project first'} onClick={() => picked && step.trim() && done({ project: picked, step: step.trim() })}>
          File it with this step
        </button>
      </div>
    </>
  );
}

function PromptBody({ ask }: { ask: Extract<Ask, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(ask.value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    if (ask.select) el.setSelectionRange(ask.select[0], ask.select[1]);
    else el.select();
  }, [ask]);
  const done = (v: string | null) => {
    finish();
    ask.resolve(v);
  };
  return (
    <>
      <h2>{ask.title}</h2>
      {ask.message && <div className="dialog-message">{ask.message}</div>}
      <input
        ref={input}
        type={ask.password ? 'password' : 'text'}
        autoComplete={ask.password ? 'current-password' : 'off'}
        value={value}
        placeholder={ask.placeholder}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) done(value.trim());
          if (e.key === 'Escape') done(null);
        }}
      />
      <div className="dialog-actions">
        <button className="button" onClick={() => done(null)}>
          Cancel
        </button>
        <button className="button primary" disabled={!value.trim()} onClick={() => done(value.trim())}>
          {ask.ok}
        </button>
      </div>
    </>
  );
}

export function DialogHost() {
  const ask = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => queue[0] ?? null,
  );
  const held = useLeaving(ask);
  const show = held.value;
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask && ask.kind !== 'prompt' && ask.kind !== 'form') okRef.current?.focus();
  }, [ask]);
  if (!show) return null;
  const cancel = () => {
    if (held.leaving) return;
    finish();
    if (show.kind === 'prompt' || show.kind === 'choose' || show.kind === 'form' || show.kind === 'multiline' || show.kind === 'arrival') show.resolve(null);
    else show.resolve(false);
  };
  const done = (run: () => void) => {
    if (held.leaving) return;
    finish();
    run();
  };
  return (
    <div className="overlay" data-nv-leaving={held.leaving ? 'true' : undefined} inert={held.leaving} onMouseDown={cancel}>
      <div
        className="dialog small"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        {show.kind === 'prompt' ? (
          <PromptBody key={show.title + show.value} ask={show} />
        ) : show.kind === 'form' ? (
          <FormBody key={show.title} ask={show} />
        ) : show.kind === 'multiline' ? (
          <MultilineBody key={show.title} ask={show} />
        ) : show.kind === 'arrival' ? (
          <ArrivalBody key={show.title} ask={show} />
        ) : show.kind === 'confirm' ? (
          <>
            <h2>{show.title}</h2>
            {show.message && <div className="dialog-message">{show.message}</div>}
            <div className="dialog-actions">
              <button className="button" onClick={cancel}>
                Cancel
              </button>
              <button
                ref={okRef}
                className={`button ${show.danger ? 'danger' : 'primary'}`}
                onClick={() => done(() => show.resolve(true))}
              >
                {show.ok}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>{show.title}</h2>
            {show.message && <div className="dialog-message">{show.message}</div>}
            <div className="dialog-actions">
              <button className="button" onClick={cancel}>
                Cancel
              </button>
              {show.options.map((o) => (
                <button
                  key={o.id}
                  ref={o.primary ? okRef : undefined}
                  className={`button${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}`}
                  onClick={() => done(() => show.resolve(o.id))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
