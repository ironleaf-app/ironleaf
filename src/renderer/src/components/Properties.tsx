// Properties above a note: each one with an editor that suits it (tags and lists as items, tick-boxes, numbers, dates,
// text), added, renamed, retyped and removed here, written back to the note's YAML so it stays plain text.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Document } from 'yaml';
import { fieldProps } from '../../../shared/inline-fields';
import { asStrings, changeProps, isMachineProp, isMap, propKind, propsReadable, readProps, type PropKind } from '../../../shared/frontmatter';
import { linkTargetType, typeOfNote } from '../../../shared/note-types';
import { cascadeKeysForRemove, cascadeRenamesFor, isKindKey, isStructuralProp, mismatchWords, shownProps, type LinkedNote } from '../../../shared/relation-links';
import { getNoteTypes, pageTypeFor } from '../state/noteTypes';
import { getState, prefs, showError, toast } from '../state/store';
import { GrowField } from './GrowField';
import { Icon, type IconName } from './Icon';
import { openMenu } from './Menu';
import { isEnterKey } from '../lib/enterKey';

export const KIND_ICON: Record<PropKind, IconName> = { text: 'text', list: 'list', number: 'hash', checkbox: 'task', date: 'calendar', datetime: 'calendar', tags: 'tag', aliases: 'link' };
export const KIND_NAME: Record<PropKind, string> = { text: 'Text', list: 'List', number: 'Number', checkbox: 'Tick-box', date: 'Date', datetime: 'Date and time', tags: 'Tags', aliases: 'Other names' };

interface Props {
  text: string;
  readOnly: boolean;
  onChange(next: string): void;
  onOpenTag(tag: string): void;
  /** Bumped by "Add property" from elsewhere (the note's menu). */
  addKey?: number;
  /** The note's path, when known: links to notes of another kind than the field wants are named under the field. */
  path?: string;
}

export function setValue(doc: Document, key: string, value: unknown): void {
  const existing = isMap(doc.contents) ? doc.contents.items.find((p) => String((p.key as { value?: unknown })?.value ?? p.key) === key) : undefined;
  const node = doc.createNode(value);
  // A list written [a, b] stays that way.
  if (existing && typeof existing.value === 'object' && existing.value && 'flow' in existing.value && (existing.value as { flow?: boolean }).flow && typeof node === 'object' && node && 'flow' in node) (node as { flow?: boolean }).flow = true;
  if (existing) existing.value = node;
  else doc.set(key, node);
}

export function renameKey(doc: Document, from: string, to: string): void {
  if (!isMap(doc.contents)) return;
  const pair = doc.contents.items.find((p) => String((p.key as { value?: unknown })?.value ?? p.key) === from);
  if (pair) pair.key = doc.createNode(to);
}

export function convert(value: unknown, kind: PropKind): unknown {
  const first = Array.isArray(value) ? value[0] : value;
  switch (kind) {
    case 'list':
    case 'tags':
    case 'aliases':
      return asStrings(value);
    case 'number': {
      // Nothing invented (9.2 uplift F131): what cannot convert stays empty, and the retype says so.
      if (first === null || first === undefined || String(first).trim() === '') return '';
      const n = Number(first);
      return Number.isFinite(n) ? n : '';
    }
    case 'checkbox':
      return first === true || first === 'true';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(String(first ?? '')) ? String(first).slice(0, 10) : '';
    case 'datetime':
      return /^\d{4}-\d{2}-\d{2}/.test(String(first ?? '')) ? String(first).slice(0, 16).replace(' ', 'T') : '';
    default:
      return first === null || first === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(first);
  }
}

/** Retype a field (9.2 uplift F131), shared by the properties panel and the note inline fields: a value that
 *  cannot convert is left empty, and said so, instead of today, now or 0 appearing from nowhere. */
export function retypeValue(doc: Document, key: string, value: unknown, kind: PropKind): void {
  const next = convert(value, kind);
  const first = Array.isArray(value) ? value[0] : value;
  if (next === '' && (kind === 'number' || kind === 'date' || kind === 'datetime') && first !== null && first !== undefined && String(first).trim() !== '') {
    toast(`“${key}” had no ${kind === 'number' ? 'number' : 'date'} in it, so it was left empty.`);
  }
  setValue(doc, key, next);
}

/** A list's items (tags, other names, a list). `chip` draws an item its own way (the note page's links to notes). */
export function ListEditor({ items, kind, readOnly, onChange, onOpenTag, chip }: { items: string[]; kind: PropKind; readOnly: boolean; onChange(v: string[]): void; onOpenTag(tag: string): void; chip?(item: string): ReactNode | null }) {
  const [draft, setDraft] = useState('');
  const suggestions = useMemo(() => {
    if (kind !== 'tags' || !draft) return [];
    const all = new Set<string>();
    for (const n of getState().notes) for (const t of n.tags) all.add(t);
    return [...all].filter((t) => t.toLowerCase().startsWith(draft.replace(/^#/, '').toLowerCase()) && !items.includes(t)).slice(0, 6);
  }, [draft, kind, items]);
  const add = (raw: string) => {
    const value = (kind === 'tags' ? raw.replace(/^#/, '') : raw).trim();
    if (!value || items.includes(value)) return setDraft('');
    onChange([...items, value]);
    setDraft('');
  };
  return (
    <div className="prop-list">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className={`prop-item${kind === 'tags' ? ' is-tag' : ''}`}>
          {chip?.(item) ?? (
            <button className="prop-item-text" onClick={() => kind === 'tags' && onOpenTag(item)} disabled={kind !== 'tags'}>
              {kind === 'tags' ? `#${item}` : item}
            </button>
          )}
          {!readOnly && (
            <button className="prop-item-remove" title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Icon name="close" size={11} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <span className="prop-add-wrap">
          <input
            className="prop-add-input"
            value={draft}
            placeholder={items.length ? '' : 'Empty'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isEnterKey(e) || e.key === ',') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1));
            }}
            onBlur={() => draft && add(draft)}
          />
          {suggestions.length > 0 && (
            <span className="prop-suggest">
              {suggestions.map((s) => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); add(s); }}>
                  #{s}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function TextEditor({ value, readOnly, onChange, autoFocus, onCancel }: { value: string; readOnly: boolean; onChange(v: string): void; autoFocus?: boolean; onCancel?(): void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const cancelled = useRef(false);
  return (
    <GrowField
      className="prop-text"
      value={draft}
      readOnly={readOnly}
      placeholder="Empty"
      autoFocus={autoFocus}
      onFocus={() => {
        focused.current = true;
        cancelled.current = false;
      }}
      onChange={setDraft}
      onBlur={() => {
        focused.current = false;
        // Esc leaves it as it was (the draft put back may not have reached this yet).
        if (cancelled.current) {
          setDraft(value);
          onCancel?.();
          return;
        }
        if (draft !== value) onChange(draft);
        else onCancel?.();
      }}
      onEnter={(e) => e.currentTarget.blur()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function Properties({ text, readOnly, onChange, onOpenTag, addKey, path }: Props) {
  const props = useMemo(() => readProps(text), [text]);
  const readable = useMemo(() => propsReadable(text), [text]);
  // A link kind's sibling shows with its links, never as its own row (orphaned, it shows, so it can be taken off).
  const shown = useMemo(() => new Set(shownProps(props)), [props]);
  const entries = Object.entries(props).filter(([k]) => shown.has(k));
  // "Key:: value" written in the note's words (V12, 28 Oct 2026): shown under the properties, changed where they're written.
  const fields = useMemo(() => {
    const have = new Set(Object.keys(props).map((k) => k.toLowerCase()));
    return Object.entries(fieldProps(text)).filter(([k]) => !have.has(k.toLowerCase()));
  }, [text, props]);
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    if (addKey) {
      setOpen(true);
      setAdding(true);
    }
  }, [addKey]);

  const apply = (mutate: (doc: Document) => void) => {
    try {
      onChange(changeProps(text, mutate));
    } catch (err) {
      showError(err);
    }
  };

  const keySuggestions = useMemo(() => {
    if (!adding) return [];
    const keys = new Set<string>();
    for (const n of getState().notes) for (const k of Object.keys(n.props ?? {})) keys.add(k);
    for (const k of Object.keys(props)) keys.delete(k);
    for (const k of [...keys]) if (isKindKey(k) || isMachineProp(k)) keys.delete(k);
    return [...keys].filter((k) => !newKey || k.toLowerCase().includes(newKey.toLowerCase())).sort().slice(0, 8);
  }, [adding, newKey, props]);

  /** Links to notes of another kind than the field wants, in plain words (none without the path, or when all agrees). */
  const mismatchFor = (key: string, value: unknown): string | null => {
    if (!path || isKindKey(key) || isStructuralProp(key)) return null;
    const types = getNoteTypes();
    const expected = linkTargetType(types, pageTypeFor(path, props)?.id, key);
    const linked: LinkedNote[] = getState().notes.map((n) => ({ path: n.path, title: n.label || n.title }));
    const byPath = getState().byPath;
    const typeOf = (p: string): string | null => typeOfNote({ path: p, props: byPath.get(p)?.props }, types, prefs().templatesFolder);
    const nameOf = (id: string): string => types.find((t) => t.id === id)?.name ?? id;
    return mismatchWords(value, expected, linked, typeOf, nameOf);
  };

  if (!readable) {
    return (
      <div className="properties is-broken">
        <Icon name="warning" size={15} /> The properties at the top of this note can’t be read. Open Source mode to fix them.
      </div>
    );
  }
  if (!entries.length && !fields.length && !adding) return null;

  const commitNew = (key: string) => {
    const k = key.trim();
    setAdding(false);
    setNewKey('');
    if (!k || Object.prototype.hasOwnProperty.call(props, k)) return;
    const kind = propKind(k, '');
    apply((doc) => setValue(doc, k, kind === 'tags' || kind === 'aliases' ? [] : ''));
  };

  return (
    <div className="properties">
      <button className="properties-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron" size={12} className={`properties-chevron${open ? ' open' : ''}`} />
        <span>Properties</span>
        {!open && <span className="properties-count">{entries.length + fields.length}</span>}
      </button>
      {open && (
        <div className="properties-body">
          {entries.map(([key, value]) => {
            const kind = propKind(key, value);
            const mismatch = mismatchFor(key, value);
            return (
              <div key={key} className="prop-row">
                <button
                  className="prop-kind"
                  title={`${KIND_NAME[kind]}: change or remove`}
                  disabled={readOnly}
                  onClick={(e) =>
                    openMenu(e.currentTarget, [
                      { heading: 'Kind' },
                      ...(['text', 'list', 'number', 'checkbox', 'date', 'datetime'] as PropKind[]).map((k) => ({
                        label: KIND_NAME[k],
                        icon: KIND_ICON[k],
                        checked: k === kind,
                        run: () => apply((doc) => retypeValue(doc, key, value, k)),
                      })),
                      { separator: true },
                      { label: 'Rename', icon: 'edit', run: () => setRenaming(key) },
                      { label: 'Remove', icon: 'trash', danger: true, run: () => apply((doc) => { for (const gone of cascadeKeysForRemove(props, key)) doc.delete(gone); }) },
                    ])
                  }
                >
                  <Icon name={KIND_ICON[kind]} size={14} />
                </button>
                {renaming === key ? (
                  <input
                    className="prop-key-input"
                    autoFocus
                    defaultValue={key}
                    onBlur={(e) => {
                      setRenaming(null);
                      const to = e.target.value.trim();
                      if (to && to !== key && Object.prototype.hasOwnProperty.call(props, to)) toast(`There is already a field called ${to}.`);
                      else if (to && to !== key) apply((doc) => { for (const r of cascadeRenamesFor(props, key, to)) renameKey(doc, r.from, r.to); });
                    }}
                    onKeyDown={(e) => {
                      if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="prop-key" title={key} onDoubleClick={() => !readOnly && setRenaming(key)}>
                    {key}
                  </span>
                )}
                <div className="prop-value">
                  {kind === 'tags' || kind === 'aliases' || kind === 'list' ? (
                    <ListEditor items={asStrings(value)} kind={kind} readOnly={readOnly} onChange={(v) => apply((doc) => setValue(doc, key, v))} onOpenTag={onOpenTag} />
                  ) : kind === 'checkbox' ? (
                    <input type="checkbox" className="prop-check" checked={value === true} disabled={readOnly} onChange={(e) => apply((doc) => setValue(doc, key, e.target.checked))} />
                  ) : kind === 'number' ? (
                    <TextEditor value={String(value ?? '')} readOnly={readOnly} onChange={(v) => apply((doc) => setValue(doc, key, v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v))} />
                  ) : kind === 'date' || kind === 'datetime' ? (
                    <input
                      type={kind === 'date' ? 'date' : 'datetime-local'}
                      className="prop-date"
                      value={String(value ?? '').replace(' ', 'T').slice(0, kind === 'date' ? 10 : 16)}
                      readOnly={readOnly}
                      onChange={(e) => apply((doc) => setValue(doc, key, e.target.value))}
                    />
                  ) : (
                    <TextEditor value={value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)} readOnly={readOnly} onChange={(v) => apply((doc) => setValue(doc, key, v))} />
                  )}
                  {mismatch && <div className="field-note">{mismatch}</div>}
                </div>
              </div>
            );
          })}
          {fields.map(([key, value]) => (
            <div key={`field:${key}`} className="prop-row is-field" title={`Written in the note as “${key}:: …”. Change it there.`}>
              <span className="prop-kind">
                <Icon name="text" size={14} />
              </span>
              <span className="prop-key">{key}</span>
              <div className="prop-value prop-field-value">
                {Array.isArray(value) ? value.map(String).join(', ') : String(value)}
                <span className="prop-field-where">in the note</span>
              </div>
            </div>
          ))}
          {adding ? (
            <div className="prop-row is-new">
              <span className="prop-kind">
                <Icon name="plus" size={14} />
              </span>
              <span className="prop-add-wrap">
                <input
                  className="prop-key-input"
                  autoFocus
                  value={newKey}
                  placeholder="Name"
                  onChange={(e) => setNewKey(e.target.value)}
                  onBlur={() => commitNew(newKey)}
                  onKeyDown={(e) => {
                    if (isEnterKey(e)) commitNew(newKey);
                    if (e.key === 'Escape') {
                      setAdding(false);
                      setNewKey('');
                    }
                  }}
                />
                {keySuggestions.length > 0 && (
                  <span className="prop-suggest">
                    {keySuggestions.map((k) => (
                      <button key={k} onMouseDown={(e) => { e.preventDefault(); commitNew(k); }}>
                        {k}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            </div>
          ) : (
            !readOnly && (
              <button className="prop-add" onClick={() => setAdding(true)}>
                <Icon name="plus" size={13} /> Add a property
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
