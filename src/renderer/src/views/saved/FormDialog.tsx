// A view's form (8.8 database depth; src/shared/view-forms.ts): the view's fields as a form — a name and one input
// per property — opened from the view's ⋯ or a [[link to the view#form]]; each submission is a new record. Local only:
// no public web form. What it asks (hidden and required fields, a heading of its own) is kept in the view's file. One
// dialog for the whole window. Round 2: each field asked the right way (a number box, the date picker, a switch,
// a relation multi-pick, a choice, typed words); the list scrolls, the buttons stay in view.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PropKind } from '../../../../shared/frontmatter';
import { readViewFile, writeViewFile } from '../../../../shared/base-file';
import { isFormulaKey, isRollupKey, knownProps, newNoteText, propWords, runView, valueOf, valueText, viewName, type ViewDef, type ViewRow } from '../../../../shared/views';
import { fieldInput, fieldOptions, formKeys, formValues, validateForm } from '../../../../shared/view-forms';
import { linkTargetType, notesOfType, typeForFolder } from '../../../../shared/note-types';
import { linkFor, looksLikeRelation, relationTargets, resolveRelation } from '../../../../shared/relation-links';
import { Icon } from '../../components/Icon';
import { pick } from '../../components/Pickers';
import { fuzzyFilter } from '../../lib/fuzzy';
import { fitTypedName } from '../../../../shared/paths';
import { errorMessage } from '../../lib/errors';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { loadFiles, showError, toast, useApp, usePrefs } from '../../state/store';
import { kindFor } from './common';

interface Request {
  viewPath: string;
}

let open: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openFormDialog(request: Request): void {
  open = request;
  emit();
}

function close(): void {
  open = null;
  emit();
}

export function FormDialogHost() {
  const request = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
  if (!request) return null;
  return <FormDialog key={request.viewPath} request={request} />;
}

/** A column's values, most used first (for a choice, or to suggest while typing). */
function sampled(rows: ViewRow[], key: string): string[] {
  const count = new Map<string, number>();
  for (const r of rows.slice(0, 200)) {
    const v = valueOf(r, key);
    for (const one of Array.isArray(v) ? v : [v]) {
      const words = valueText(one).trim();
      if (words && words.length <= 80) count.set(words, (count.get(words) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A relation asked as a multi-pick with search and create, like the relation chips in the table. The picker offers the
 *  field's type of note first (every note one press away). */
function RelationField({ label, fieldKey, selected, notes, folder, onChange }: { label: string; fieldKey: string; selected: string[]; notes: { path: string; title: string }[]; folder: string | undefined; onChange(next: string[]): void }) {
  const titleOf = (link: string) => {
    const target = relationTargets([link])[0] ?? link.replace(/^\[\[|\]\]$/g, '');
    const path = resolveRelation([target], notes)[0];
    return (path && notes.find((n) => n.path === path)?.title) || target.split('/').pop() || target;
  };
  const paths = resolveRelation(selected.flatMap((s) => relationTargets([s])), notes);
  const vaultNotes = useApp((s) => s.notes);
  const templatesFolder = usePrefs().templatesFolder;
  const add = async () => {
    const createAndLink = async (title: string) => {
      const clean = title.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!clean) return;
      try {
        const path = await window.nv.files.create(A.newNoteFolder(folder), clean, '.md', '');
        await loadFiles();
        const link = linkFor({ path, title: clean }, [...notes, { path, title: clean }]);
        onChange([...selected, link]);
      } catch (err) {
        showError(err);
      }
    };
    const { getNoteTypes } = await import('../../state/noteTypes');
    const types = getNoteTypes();
    const expected = linkTargetType(types, folder ? typeForFolder(folder, types)?.id ?? null : null, fieldKey);
    const pool = expected ? notesOfType(vaultNotes, expected, types, templatesFolder).map((n) => ({ path: n.path, title: n.label || n.title })) : null;
    const plural = expected ? (types.find((t) => t.id === expected)?.plural ?? 'notes') : '';
    let showAll = false;
    for (;;) {
      const id = await pick({
        placeholder: `Link to which record?`,
        items: (q) => [
          ...(!showAll && pool ? [{ id: '__all__', label: 'Show every note', detail: `Only ${plural.charAt(0).toLowerCase() + plural.slice(1)} shown`, icon: 'notes' as const }] : []),
          ...fuzzyFilter((showAll || !pool ? notes : pool).filter((n) => !paths.includes(n.path)), q, (n) => `${n.title} ${n.path}`, 40).map((n) => ({ id: n.path, label: n.title, detail: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : 'Top of the notes', icon: 'notes' as const })),
        ],
        extraRow: (q) => (q.trim() && !notes.some((n) => n.title.toLowerCase() === q.trim().toLowerCase()) ? { label: `New “${q.trim().slice(0, 60)}”`, run: () => void createAndLink(q.trim()) } : null),
        footer: '↑↓ to move · Enter to link it · Esc to cancel',
      });
      if (id === '__all__') {
        showAll = true;
        continue;
      }
      if (!id) return;
      const title = notes.find((n) => n.path === id)?.title ?? id.split('/').pop()!.replace(/\.md$/i, '');
      const link = linkFor({ path: id, title }, notes);
      if (selected.some((s) => s.trim().toLowerCase() === link.trim().toLowerCase()) || paths.includes(id)) return;
      onChange([...selected, link]);
      return;
    }
  };
  return (
    <span className="sv-relation sv-form-relation">
      {selected.map((link) => (
        <span key={link} className="sv-pill is-link">
          <span className="sv-pill-open" title={titleOf(link)}>
            {titleOf(link)}
          </span>
          <button type="button" className="sv-pill-x" aria-label={`Unlink ${titleOf(link)}`} title="Unlink" onClick={() => onChange(selected.filter((s) => s !== link))}>
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      <button type="button" className="sv-relation-add" aria-label={selected.length ? `Link another record to ${label}` : `${label}: empty. Link a record.`} onClick={() => void add()}>
        <Icon name="plus" size={12} />
        <span>{selected.length ? 'Link' : 'Link a record'}</span>
      </button>
    </span>
  );
}

function FormDialog({ request }: { request: Request }) {
  const { viewPath } = request;
  const notes = useApp((s) => s.notes);
  const canEdit = useApp((s) => s.canEdit);
  const templatesFolder = usePrefs().templatesFolder;
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | boolean | string[]>>({});
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    setText(null);
    setFailed(null);
    void docs
      .acquire(viewPath)
      .then((t) => {
        if (!alive) return docs.release(viewPath);
        setText(t);
        unsubscribe = docs.subscribe(viewPath, (next) => setText(next));
      })
      .catch((err) => alive && setFailed(errorMessage(err)));
    return () => {
      alive = false;
      unsubscribe();
      docs.release(viewPath);
    };
  }, [viewPath]);

  const def: ViewDef = useMemo(() => readViewFile(viewPath, text ?? '').def, [viewPath, text]);
  const change = (patch: Partial<ViewDef>) => {
    const next = writeViewFile(viewPath, text ?? '', { ...def, ...patch });
    if (canEdit) docs.update(viewPath, next, 'view');
    else setText(next);
  };
  const rows = useMemo(() => runView(def, notes, { exclude: [templatesFolder].filter(Boolean) }), [def, notes, templatesFolder]);
  const known = useMemo(() => new Map(knownProps(rows).map((p) => [p.key.toLowerCase(), p])), [rows]);
  const keys = useMemo(() => formKeys(def), [def]);
  const kinds = useMemo(() => new Map(keys.map((k) => [k, kindFor(k, known, rows.length ? valueOf(rows[0], k) : undefined)] as [string, PropKind])), [keys, known, rows]);
  const options = useMemo(() => new Map(keys.map((k) => [k, fieldOptions(sampled(rows, k), kinds.get(k) ?? 'text')] as [string, string[] | undefined])), [keys, rows, kinds]);
  const relations = useMemo(() => new Set(keys.filter((k) => looksLikeRelation(rows.slice(0, 40).map((r) => valueOf(r, k))))), [keys, rows]);
  const linkNotes = useMemo(() => notes.map((n) => ({ path: n.path, title: n.label || n.title })), [notes]);
  const folder = def.source.kind === 'folder' ? def.source.value : undefined;
  const required = useMemo(() => new Set((def.form?.required ?? []).map((r) => r.toLowerCase())), [def]);
  const fields = useMemo(() => keys.map((key) => ({ key, kind: kinds.get(key) ?? 'text', required: required.has(key.toLowerCase()), label: propWords(key) })), [keys, kinds, required]);

  const submit = async () => {
    const clean = name.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim();
    const missing = validateForm(clean, fields, answers);
    setProblems(missing);
    if (missing.length) return;
    try {
      const values = formValues(fields, answers);
      // A typed name past what a file keeps is fitted to leading words, said aloud (t207 pass 2: it cut silently).
      const fit = fitTypedName(clean);
      const kept = fit.name || 'Untitled';
      const { getNoteTypes, newNoteOfType } = await import('../../state/noteTypes');
      const { typeForFolder } = await import('../../../../shared/note-types');
      const typed = folder ? typeForFolder(folder, getNoteTypes()) : undefined;
      if (typed) await newNoteOfType(typed.id, { folder, where: 'tab', values, title: kept });
      else await A.newNote(folder, 'tab', newNoteText(def, values), kept);
      toast(`Added “${kept}”.${fit.cut ? ' That name was shortened to fit.' : ''}`);
      close();
    } catch (err) {
      showError(err);
    }
  };

  const setForm = (form: ViewDef['form']) => change({ form });
  const ask = (key: string, on: boolean) => {
    const hidden = new Set((def.form?.hidden ?? []).map((h) => h.toLowerCase()));
    if (on) hidden.delete(key.toLowerCase());
    else hidden.add(key);
    setForm({ ...(def.form ?? {}), hidden: [...hidden] });
  };
  const must = (key: string, on: boolean) => {
    const req = new Set((def.form?.required ?? []).map((r) => r.toLowerCase()));
    if (on) req.add(key);
    else req.delete(key.toLowerCase());
    setForm({ ...(def.form ?? {}), required: [...req] });
  };

  const heading = def.form?.title?.trim() || `New in ${viewName(viewPath)}`;
  return (
    <div className="overlay" onMouseDown={close}>
      <div
        className="dialog sv-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-form-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2 id="sv-form-title">{heading}</h2>
        {def.form?.note?.trim() ? <p className="hint">{def.form.note.trim()}</p> : <p className="hint">Each submission is a new record in this view.</p>}
        {failed ? (
          <p className="sv-form-problem" role="alert">
            <Icon name="warning" size={13} /> This view can’t be opened: {failed}
          </p>
        ) : text === null ? (
          <p className="sv-hint">Opening…</p>
        ) : (
          <div className="sv-form-body">
            <label className="sv-formula-field">
              <span>
                Name<span className="sv-form-required" aria-label="must be filled in"> · must fill in</span>
              </span>
              <input value={name} placeholder="For example: Sourdough starter" spellCheck={false} autoFocus onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void submit())} />
            </label>
            {keys.map((key) => {
              const kind = kinds.get(key) ?? 'text';
              const label = propWords(key);
              const mustFill = required.has(key.toLowerCase());
              const opts = options.get(key);
              const answer = answers[key];
              const set = (v: string | boolean | string[]) => setAnswers((a) => ({ ...a, [key]: v }));
              const input = fieldInput(kind, relations.has(key), !!opts);
              const head = (
                <span>
                  {label}
                  {mustFill && <span className="sv-form-required" aria-label="must be filled in"> · must fill in</span>}
                </span>
              );
              if (input === 'relation') {
                const picked = Array.isArray(answer) ? answer : [];
                return (
                  <div key={key} className="sv-formula-field">
                    {head}
                    <RelationField label={label} fieldKey={key} selected={picked} notes={linkNotes} folder={folder} onChange={(next) => set(next)} />
                  </div>
                );
              }
              if (input === 'checkbox') {
                const yes = answer === true;
                return (
                  <div key={key} className="sv-formula-field">
                    {head}
                    <button type="button" role="switch" aria-checked={yes} aria-label={label} className={`sv-form-switch${yes ? ' is-on' : ''}`} onClick={() => set(!yes)}>
                      <span className="sv-form-knob" aria-hidden="true" />
                      <span className="sv-form-switch-words">{yes ? 'Yes' : 'No'}</span>
                    </button>
                  </div>
                );
              }
              if (input === 'date') {
                const isTime = kind === 'datetime';
                const words = typeof answer === 'string' ? answer : '';
                return (
                  <div key={key} className="sv-formula-field">
                    {head}
                    <span className="sv-form-date-wrap">
                      <input type={isTime ? 'datetime-local' : 'date'} value={words} max={isTime ? undefined : '2099-12-31'} onChange={(e) => set(e.currentTarget.value)} />
                      {!words && (
                        <button type="button" className="sv-form-today" onClick={() => set(isTime ? nowLocal() : todayIso())}>
                          {isTime ? 'Now' : 'Today'}
                        </button>
                      )}
                    </span>
                  </div>
                );
              }
              if (input === 'number') {
                return (
                  <label key={key} className="sv-formula-field">
                    {head}
                    <input type="number" inputMode="decimal" value={typeof answer === 'string' ? answer : ''} placeholder={`${label}…`} spellCheck={false} onChange={(e) => set(e.currentTarget.value)} />
                  </label>
                );
              }
              if (input === 'choice' && opts) {
                return (
                  <label key={key} className="sv-formula-field">
                    {head}
                    <select value={typeof answer === 'string' ? answer : ''} onChange={(e) => set(e.currentTarget.value)}>
                      <option value="">Pick one…</option>
                      {opts.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              return (
                <label key={key} className="sv-formula-field">
                  {head}
                  <input
                    type="text"
                    value={typeof answer === 'string' ? answer : ''}
                    placeholder={kind === 'tags' || kind === 'list' ? 'Separated by commas' : `${label}…`}
                    spellCheck={false}
                    onChange={(e) => set(e.currentTarget.value)}
                  />
                </label>
              );
            })}
            {problems.length > 0 && (
              <div className="sv-form-problem" role="alert">
                {problems.map((p, i) => (
                  <p key={i}>
                    <Icon name="warning" size={13} /> {p}
                  </p>
                ))}
              </div>
            )}
            <details className="sv-formula-help">
              <summary>What it asks</summary>
              <label className="sv-formula-field">
                <span>Heading</span>
                <input value={def.form?.title ?? ''} placeholder={heading} spellCheck={false} onChange={(e) => setForm({ ...(def.form ?? {}), title: e.currentTarget.value.trim() ? e.currentTarget.value : undefined })} />
              </label>
              <label className="sv-formula-field">
                <span>A line under the heading</span>
                <input value={def.form?.note ?? ''} placeholder="For example: One per bake." spellCheck={false} onChange={(e) => setForm({ ...(def.form ?? {}), note: e.currentTarget.value.trim() ? e.currentTarget.value : undefined })} />
              </label>
              {def.columns.map((c) => {
                if (isFormulaKey(c) || isRollupKey(c)) return null;
                const hidden = (def.form?.hidden ?? []).some((h) => h.toLowerCase() === c.toLowerCase());
                const req = required.has(c.toLowerCase());
                return (
                  <div key={c} className="sv-form-row">
                    <span className="sv-form-name">{propWords(c)}</span>
                    <label>
                      <input type="checkbox" checked={!hidden} onChange={(e) => ask(c, e.currentTarget.checked)} /> Ask
                    </label>
                    <label>
                      <input type="checkbox" checked={req} disabled={hidden} onChange={(e) => must(c, e.currentTarget.checked)} /> Must fill in
                    </label>
                  </div>
                );
              })}
              {def.columns.some((c) => isFormulaKey(c) || isRollupKey(c)) && <p className="sv-hint">Worked-out columns are never asked for.</p>}
            </details>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!canEdit || text === null || !!failed} title={canEdit ? undefined : 'This vault can’t be changed here.'} onClick={() => void submit()}>
            Add the record
          </button>
        </div>
      </div>
    </div>
  );
}
