// A note's fields as quiet rows under its title (wave D of Ironleaf Calm, 20 Oct 2026, approved the plan: "its fields
// as quiet rows. Empty fields hide, and 'Add a field' sits at the end"). In place of the boxed Properties block: the
// name on the left, the value on the right, no heading. Which rows show is src/shared/note-page.ts (fieldRows): a
// field with a value always; an empty one while the fields are being edited; the note type's own fields as faint "Add
// <field>" rows only while the pointer or the focus is on the fields. The editors are the Properties block's own
// (lists, tick-boxes, dates, numbers, words), written back through the same safe writer, so the person's order,
// comments and quoting stay as they were. Links to other notes in a field show as chips with the note's type. Folded
// to one quiet line ("6 properties") that opens in place (t7-note-window, 8 Nov 2026); open, the rows are these same
// rows, editable as today.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Document } from 'yaml';
import { asStrings, changeProps, isMachineProp, propKind, propsReadable, readProps, type PropKind, type PropValue } from '../../../shared/frontmatter';
import { inlineFields, setInlineField } from '../../../shared/inline-fields';
import { factKind, fieldRows, isEmptyValue, linkOf, linksOnly, type FieldKindHint, type FieldLink, type FieldRow } from '../../../shared/note-page';
import { DatePill } from './plan/DatePill';
import { OwnerChip } from './plan/OwnerChip';
import { StatusPill } from './plan/StatusPill';
import { readDate, shortDate, statusReading } from '../lib/projectLook';
import { Progress } from '../views/project/parts';
import { linkTargetType, notesOfType, typeOfNote } from '../../../shared/note-types';
import { addLink, isKindKey, isStructuralProp, kindKeyFor, LINK_KINDS, linkFor, looksLikeRelation, mismatchWords, onlyKindShown, pickerPool, pickRefusal, readLinkKinds, relationTargets, resolveRelation, setLinkKind } from '../../../shared/relation-links';
import { getNoteTypes, pageTypeFor, typeOfPath } from '../state/noteTypes';
import { fuzzyFilter } from '../lib/fuzzy';
import { resolveNote } from '../lib/resolve';
import { getState, loadFiles, prefs, showError, toast, useApp } from '../state/store';
import { Icon } from './Icon';
import { openMenu } from './Menu';
import { typeIcon } from './NotePageTop';
import { pick } from './Pickers';
import { KIND_ICON, KIND_NAME, ListEditor, renameKey, retypeValue, setValue, TextEditor } from './Properties';
import { isEnterKey } from '../lib/enterKey';

interface Props {
  path: string;
  text: string;
  readOnly: boolean;
  onChange(next: string): void;
  onOpenTag(tag: string): void;
  onOpenLink(target: string, newTab: boolean): void;
  /** Bumped by "Add property" from elsewhere (the note's menu). */
  addKey?: number;
}

const OPEN_KEY = 'nv.noteFields.open';
const recallOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberOpen = (open: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Kept for this time only.
  }
};

/** A field's editor kind: what its value is, or (still empty) what the note's type says it holds. */
function kindOf(row: FieldRow): PropKind {
  const empty = row.value === null || row.value === undefined || row.value === '' || (Array.isArray(row.value) && !row.value.length);
  if (empty && row.hint) return row.hint;
  return propKind(row.key, row.value);
}

/** A link to a note as a chip: the note's type icon and its name; a click opens it (Ctrl+click: a new tab). With `onKind`,
 *  what the note is to this one follows the chip (or a quiet +), changed from its own menu. */
export function LinkChip({ link, from, onOpen, kind, onKind }: { link: FieldLink; from: string; onOpen(target: string, newTab: boolean): void; kind?: string; onKind?: (anchor: HTMLElement) => void }) {
  // Plain values from the store (a fresh object each time would never settle).
  const notePath = useApp(() => resolveNote(link.target, from));
  const noteType = useApp(() => (notePath ? (typeOfPath(notePath)?.id ?? null) : null));
  const resolved = notePath ? { path: notePath, type: noteType } : null;
  const name = link.alias ?? link.target.split('/').pop()!;
  const chip = (
    <button className={`field-link${resolved ? '' : ' is-missing'}`} title={resolved ? `Open ${name} (Ctrl+click: in a new tab)` : `${name} isn’t written yet: open to start it`} onClick={(e) => onOpen(link.target, e.ctrlKey || e.metaKey)}>
      <Icon name={resolved ? typeIcon(resolved.type) : 'file'} size={12} />
      <span>{name}</span>
    </button>
  );
  if (!onKind && !kind) return chip;
  return (
    <span className="field-link-wrap">
      {chip}
      {onKind ? (
        <button
          className={`field-kind${kind ? '' : ' is-empty'}`}
          title={kind ? `Kind of link: ${kind}. Change it.` : 'Kind of link: add one.'}
          aria-label={kind ? `Kind of link to ${name}: ${kind}. Change it.` : `Kind of link to ${name}: add one.`}
          onClick={(e) => {
            e.stopPropagation();
            onKind(e.currentTarget);
          }}
        >
          {kind || '+'}
        </button>
      ) : (
        <span className="field-kind">{kind}</span>
      )}
    </span>
  );
}

/** Words that are only links show as chips until clicked to change; any other words are the plain text editor. */
function TextOrLinks({ value, readOnly, from, onChange, onOpen, kinds, onKind, onLink }: { value: string; readOnly: boolean; from: string; onChange(v: string): void; onOpen(target: string, newTab: boolean): void; kinds?: string[]; onKind?: (index: number, anchor: HTMLElement) => void; onLink?: () => void }) {
  const [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const links = editing ? null : linksOnly(value);
  useEffect(() => {
    if (editing) box.current?.querySelector('textarea')?.focus();
  }, [editing]);
  if (!links)
    return (
      <div ref={box} className="field-text" onBlur={() => setEditing(false)}>
        <TextEditor value={value} readOnly={readOnly} onChange={onChange} />
        {!readOnly && onLink && (
          <button className="field-link-pick" title="Link a note" aria-label="Link a note" onMouseDown={(e) => e.preventDefault()} onClick={onLink}>
            <Icon name="link" size={12} />
            <span>Link</span>
          </button>
        )}
      </div>
    );
  return (
    <div className="field-links" onClick={(e) => !readOnly && e.target === e.currentTarget && setEditing(true)}>
      {links.map((l, i) => (
        <LinkChip key={`${l.target}-${i}`} link={l} from={from} onOpen={onOpen} kind={kinds?.[i]} onKind={onKind && !readOnly ? (anchor) => onKind(i, anchor) : undefined} />
      ))}
      {!readOnly && onLink && (
        <button className="field-links-edit" title="Link a note" aria-label="Link a note" onClick={onLink}>
          <Icon name="plus" size={12} />
        </button>
      )}
      {!readOnly && (
        <button className="field-links-edit" title="Change" aria-label="Change" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={12} />
        </button>
      )}
    </div>
  );
}

export function NoteFields({ path, text, readOnly, onChange, onOpenTag, onOpenLink, addKey }: Props) {
  const props = useMemo(() => readProps(text), [text]);
  const readable = useMemo(() => propsReadable(text), [text]);
  // "Key:: value" written in the note's words (V12, 28 Oct 2026): shown under its fields. Written once, it
  // changes here too (Nov 2026, "everything is editable where shown"), through the same save; written twice,
  // it stays as it is written, to change there.
  const inline = useMemo(() => {
    const have = new Set(Object.keys(props).map((k) => k.toLowerCase()));
    // One pass (t102, 9 Nov 2026): the counts and the properties read the note's fields together, not twice.
    const counts = new Map<string, number>();
    const merged: Record<string, PropValue> = {};
    for (const f of inlineFields(text)) {
      counts.set(f.key, (counts.get(f.key) ?? 0) + 1);
      if (f.value === null) continue;
      const had = merged[f.key];
      if (had === undefined) merged[f.key] = f.value;
      else merged[f.key] = Array.isArray(had) ? [...had, f.value] : [had, f.value];
    }
    return Object.entries(merged)
      .filter(([k]) => !have.has(k.toLowerCase()))
      .map(([key, value]) => ({ key, value, once: counts.get(key) === 1 }));
  }, [text, props]);
  const type = pageTypeFor(path, props);
  // Folded to one quiet line, opened in place (t7-note-window, 8 Nov 2026): shut unless left open.
  const [open, setOpen] = useState(recallOpen);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // A designed fact being changed (p14): its pill shows its editor until saved or left.
  const [editingFact, setEditingFact] = useState<string | null>(null);
  // A field just added stays shown while empty, until the note changes, so it isn't lost from sight.
  const [keep, setKeep] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // "Add property" from the note's menu opens the fields to add into.
    if (addKey) {
      setAdding(true);
      setOpen(true);
      rememberOpen(true);
    }
  }, [addKey]);
  useEffect(() => setKeep(null), [path]);
  useEffect(() => setEditingFact(null), [path]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // A field just added (from "Add <field>"): its editor takes the focus once it is drawn.
  useEffect(() => {
    if (!focusKey) return;
    const row = root.current?.querySelector(`[data-field="${CSS.escape(focusKey)}"]`);
    const field = row?.querySelector<HTMLElement>('textarea, input, button.prop-check');
    if (field) {
      field.focus();
      setFocusKey(null);
    }
  }, [focusKey, text]);

  const apply = (mutate: (doc: Document) => void) => {
    try {
      onChange(changeProps(text, mutate));
    } catch (err) {
      showError(err);
    }
  };

  const keySuggestions = useMemo(() => {
    if (!adding) return [];
    const keys = new Set<string>(type?.fields.map((f) => f.key));
    for (const n of getState().notes) for (const k of Object.keys(n.props ?? {})) keys.add(k);
    for (const k of Object.keys(props)) keys.delete(k);
    for (const k of ['cover', 'icon', 'type']) keys.delete(k);
    for (const k of [...keys]) if (isKindKey(k) || isMachineProp(k)) keys.delete(k);
    return [...keys].filter((k) => !newKey || k.toLowerCase().includes(newKey.toLowerCase())).sort().slice(0, 8);
  }, [adding, newKey, props, type]);
  const notes = useApp((s) => s.notes);

  /** A field's kind sibling as written ("People Kind" for people), when it has one. */
  const siblingOf = (key: string): string | undefined => Object.keys(props).find((k) => k.toLowerCase() === kindKeyFor(key).toLowerCase());

  /** One link's kind set from its chip's menu (null clears it; the sibling goes when nothing kinded is left). */
  const applyKind = (key: string, count: number, index: number, kind: string | null) => {
    const sib = siblingOf(key);
    apply((doc) => {
      const v = setLinkKind(props, key, count, index, kind);
      if (v === null) {
        if (sib) doc.delete(sib);
      } else setValue(doc, sib ?? kindKeyFor(key), v);
    });
  };

  const openKindMenu = (key: string, count: number, index: number, anchor: HTMLElement) => {
    const kinds = readLinkKinds(props, key, count);
    openMenu(anchor, [
      { heading: 'Kind of link' },
      ...LINK_KINDS.map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), checked: kinds[index] === k, run: () => applyKind(key, count, index, k) })),
      { label: 'No kind', checked: !kinds[index], run: () => applyKind(key, count, index, null) },
    ]);
  };

  /** Links in a field to notes of another type than the field wants, in plain words (none when all agrees). */
  const mismatchLine = (key: string, value: unknown): string | null => {
    if (isKindKey(key) || isStructuralProp(key)) return null;
    const types = getNoteTypes();
    const expected = linkTargetType(types, type?.id, key);
    const linked = notes.map((n) => ({ path: n.path, title: n.label || n.title }));
    const byPath = getState().byPath;
    const typeOf = (p: string): string | null => typeOfNote({ path: p, props: byPath.get(p)?.props }, types, prefs().templatesFolder);
    const nameOf = (id: string): string => types.find((t) => t.id === id)?.name ?? id;
    return mismatchWords(value, expected, linked, typeOf, nameOf);
  };

  /** A note picked for a field: the field's kind first ("Only people shown", every note one press away), a wrong-kind
   *  pick named in plain words and left standing, never blocked. */
  const pickLink = async (key: string, value: unknown) => {
    const types = getNoteTypes();
    const expected = linkTargetType(types, type?.id, key);
    const all = notes.map((n) => ({ path: n.path, title: n.label || n.title }));
    const byPath = getState().byPath;
    const templatesFolder = prefs().templatesFolder;
    const typeOf = (p: string): string | null => typeOfNote({ path: p, props: byPath.get(p)?.props }, types, templatesFolder);
    const nameOf = (id: string): string => types.find((t) => t.id === id)?.name ?? id;
    const pool = expected ? pickerPool(notesOfType(notes, expected, types, templatesFolder).map((n) => ({ path: n.path, title: n.label || n.title })), typeOf, expected) : null;
    const plural = expected ? (types.find((t) => t.id === expected)?.plural ?? 'notes') : '';
    const linked = new Set(resolveRelation(relationTargets(value), all));
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const createAndLink = async (title: string) => {
      const clean = title.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!clean) return;
      const made = await window.nv.files.create(folder, clean, '.md', '');
      await loadFiles();
      apply((doc) => setValue(doc, key, addLink(value, linkFor({ path: made, title: clean }, [...all, { path: made, title: clean }]), all)));
    };
    let showAll = false;
    for (;;) {
      const list = (showAll || !pool ? all : pool).filter((n) => n.path !== path && !linked.has(n.path));
      const id = await pick({
        placeholder: 'Link to which note?',
        items: (q) => [
          ...(!showAll && pool ? [{ id: '__all__', label: 'Show every note', detail: onlyKindShown(plural), icon: 'notes' as const }] : []),
          ...fuzzyFilter(list, q, (n) => `${n.title} ${n.path}`, 40).map((n) => ({ id: n.path, label: n.title, detail: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : 'Top of the notes', icon: 'notes' as const })),
        ],
        extraRow: (q) => (q.trim() && !all.some((n) => n.title.toLowerCase() === q.trim().toLowerCase()) ? { label: `New "${q.trim().slice(0, 60)}"`, run: () => void createAndLink(q.trim()) } : null),
        footer: 'Up and down to move, Enter to link it, Esc to cancel',
      });
      if (id === '__all__') {
        showAll = true;
        continue;
      }
      if (!id) return;
      const title = all.find((n) => n.path === id)?.title ?? id.split('/').pop()!.replace(/\.md$/i, '');
      const refusal = expected ? pickRefusal({ path: id, title }, typeOf, expected, nameOf) : null;
      if (refusal) toast(refusal);
      apply((doc) => setValue(doc, key, addLink(value, linkFor({ path: id, title }, all), all)));
      return;
    }
  };

  /** Whether a field offers the link picker: it wants a kind of note, or already holds links. */
  const offersLink = (key: string, value: unknown): boolean => {
    if (isKindKey(key) || isStructuralProp(key)) return false;
    const types = getNoteTypes();
    if (linkTargetType(types, type?.id, key)) return true;
    return looksLikeRelation(Array.isArray(value) ? value : [value]);
  };

  if (!readable) {
    return (
      <div className="properties is-broken">
        <Icon name="warning" size={15} /> The properties at the top of this note can’t be read. Open Source mode to fix them.
      </div>
    );
  }

  // Reading shows only what has a value; editing offers the rest (the shared rules, tests/note-page.test.mjs).
  const rows = fieldRows(props, type?.fields ?? [], readOnly ? {} : { editing: focusIn || adding, active: hover || focusIn || adding, keep });
  if (readOnly && !rows.length && !inline.length) return null;
  // The fold line counts what opening shows: valued rows and the note's inline fields, never the offers.
  const count = rows.filter((r) => r.show !== 'add').length + inline.length;
  const countWords = count === 0 ? 'No properties' : `${count} ${count === 1 ? 'property' : 'properties'}`;
  const toggle = () =>
    setOpen((was) => {
      rememberOpen(!was);
      return !was;
    });

  /** Adds a field (empty) and keeps it in sight; its editor takes the focus unless the person has clicked elsewhere. */
  const addField = (key: string, hint?: FieldKindHint, focus = true) => {
    const k = key.trim();
    if (!k) return;
    if (focus) setFocusKey(k);
    setKeep(k);
    if (Object.prototype.hasOwnProperty.call(props, k)) return;
    const kind = hint ?? propKind(k, '');
    apply((doc) => setValue(doc, k, kind === 'tags' || kind === 'aliases' || kind === 'list' ? [] : kind === 'checkbox' ? false : ''));
  };
  const commitNew = (key: string, focus: boolean) => {
    setAdding(false);
    setNewKey('');
    addField(key, undefined, focus);
  };

  /** One list item's link among its field's links (single-link items only; an item of several links keeps its kinds
   *  in order, changed from the field's words). */
  const itemLinkIndex = (items: string[], item: string): number => {
    let at = 0;
    for (const it of items) {
      const ts = relationTargets(it);
      if (it === item) return ts.length === 1 ? at : -1;
      at += ts.length;
    }
    return -1;
  };

  const chipFor = (key: string, items: string[], kinds: string[]) => (item: string) => {
    const at = itemLinkIndex(items, item);
    const kindProps = at >= 0 && !readOnly ? { kind: kinds[at], onKind: (anchor: HTMLElement) => openKindMenu(key, kinds.length, at, anchor) } : at >= 0 ? { kind: kinds[at] } : {};
    const link = linkOf(item);
    if (link) return <LinkChip link={link} from={path} onOpen={onOpenLink} {...kindProps} />;
    // A plain name that is a person's note (a meeting's "Sam Lee") reads as that person too.
    const named = resolveNote(item, path);
    return named && typeOfPath(named)?.id === 'person' ? <LinkChip link={{ target: item }} from={path} onOpen={onOpenLink} {...kindProps} /> : null;
  };

  return (
    <div
      ref={root}
      className={`note-fields${hover || focusIn ? ' is-active' : ''}${rows.length || inline.length ? '' : ' is-empty'}`}
      onMouseEnter={() => {
        // A short rest before the type's empty fields show, so passing over the fields on the way to the words doesn't
        // shift the page.
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHover(true), 260);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHover(false), 420);
      }}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
      }}
    >
      <button className="note-fields-fold" aria-expanded={open} title={open ? 'Fold the properties away' : 'Show the properties'} onClick={toggle}>
        <Icon name="chevron" size={11} className={`tree-chevron${open ? ' open' : ''}`} />
        <span>{countWords}</span>
      </button>
      {open && (
        <>
      {rows.map((row) => {
        const { key, value } = row;
        if (row.show === 'add')
          return (
            <button key={`add-${key}`} className="field-row field-offer" data-field={key} onMouseDown={(e) => e.preventDefault()} onClick={() => addField(key, row.hint)}>
              <span className="field-key">
                <Icon name="plus" size={12} />
                <span>Add {key}</span>
              </span>
            </button>
          );
        const kind = kindOf(row);
        // A designed fact (p14): status, progress, dates and owner show as the shared pills and chips. An
        // empty date still counts (its pill is "Set date" until it has one); other empty rows keep editors.
        const fact = !isEmptyValue(value) || kind === 'date' || kind === 'datetime' ? factKind(key, value, kind) : null;
        const factEditing = editingFact === key;
        const targets = relationTargets(value);
        const kinds = readLinkKinds(props, key, targets.length);
        const mismatch = mismatchLine(key, value);
        // A field's kind sibling follows it: renamed and removed with it, never orphaned by those.
        const cascadeRename = (to: string) => {
          const sib = siblingOf(key);
          apply((doc) => {
            renameKey(doc, key, to);
            if (sib) renameKey(doc, sib, kindKeyFor(to));
          });
        };
        const cascadeRemove = () => {
          const sib = siblingOf(key);
          apply((doc) => {
            doc.delete(key);
            if (sib) doc.delete(sib);
          });
        };
        // A designed fact's pill or its editor (p14): the file's words stay the file's words — the pill shows
        // them the shared way, the editor writes them back unchanged in shape. Null: the plain row below.
        const factNode = (() => {
          if (!fact) return null;
          if (factEditing && !readOnly) {
            const done = () => setEditingFact(null);
            if (fact === 'date') {
              const dateType = kind === 'datetime' ? 'datetime-local' : 'date';
              const dateLen = kind === 'datetime' ? 16 : 10;
              return (
                <input
                  type={dateType}
                  autoFocus
                  className="prop-date"
                  value={String(value ?? '').replace(' ', 'T').slice(0, dateLen)}
                  onChange={(e) => {
                    apply((doc) => setValue(doc, key, e.target.value));
                    done();
                  }}
                  onBlur={done}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') done();
                  }}
                />
              );
            }
            if (fact === 'progress') {
              return <TextEditor value={String(value ?? '')} readOnly={false} autoFocus onChange={(v) => { apply((doc) => setValue(doc, key, v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v)); done(); }} onCancel={done} />;
            }
            return <TextEditor value={String(value ?? '')} readOnly={false} autoFocus onChange={(v) => { apply((doc) => setValue(doc, key, v)); done(); }} onCancel={done} />;
          }
          if (isEmptyValue(value)) {
            // An empty date (only dates reach here empty): a quiet way to set it, never an empty box.
            return (
              <button type="button" className="field-factbtn is-empty" title={`Set ${key.toLowerCase()}`} onClick={() => setEditingFact(key)}>
                <span className="field-fact-empty">Set date</span>
              </button>
            );
          }
          const shown =
            fact === 'status'
              ? (() => {
                  const v = String(value).trim();
                  return <StatusPill label={v.charAt(0).toUpperCase() + v.slice(1)} tone={statusReading(String(value)).tone} size="small" />;
                })()
              : fact === 'date'
                ? (() => {
                    const iso = String(value);
                    const ms = readDate(iso);
                    const time = kind === 'datetime' ? iso.slice(11, 16) : '';
                    return <DatePill words={ms !== null ? shortDate(ms) + (time ? ` ${time}` : '') : iso} tone="none" />;
                  })()
                : fact === 'progress'
                  ? <Progress value={Number(value)} tone="none" />
                  : <OwnerChip name={String(value)} size="small" />;
          return readOnly ? (
            <span className="field-fact" title={fact === 'date' ? String(value) : undefined}>{shown}</span>
          ) : (
            <button type="button" className="field-factbtn" title={`Change ${key.toLowerCase()}`} onClick={() => setEditingFact(key)}>
              {shown}
            </button>
          );
        })();
        return (
          <div key={key} className="field-row" data-field={key}>
            {renaming === key ? (
              <input
                className="field-key-input"
                autoFocus
                defaultValue={key}
                onBlur={(e) => {
                  setRenaming(null);
                  const to = e.target.value.trim();
                  if (to && to !== key && Object.prototype.hasOwnProperty.call(props, to)) toast(`There is already a field called ${to}.`);
                  else if (to && to !== key) cascadeRename(to);
                }}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button
                className="field-key"
                title={readOnly ? key : `${key} · ${KIND_NAME[kind]}: change, rename or remove`}
                disabled={readOnly}
                onDoubleClick={() => !readOnly && setRenaming(key)}
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
                    { label: 'Remove', icon: 'trash', danger: true, run: cascadeRemove },
                  ])
                }
              >
                <Icon name={KIND_ICON[kind]} size={12} className="field-kind" />
                <span>{key}</span>
              </button>
            )}
            <div className="field-value">
              {factNode ??
                (kind === 'tags' || kind === 'aliases' || kind === 'list' ? (
                  <div className="field-list-wrap">
                    <ListEditor items={asStrings(value)} kind={kind} readOnly={readOnly} onChange={(v) => apply((doc) => setValue(doc, key, v))} onOpenTag={onOpenTag} chip={kind === 'list' ? chipFor(key, asStrings(value), kinds) : undefined} />
                    {!readOnly && kind === 'list' && offersLink(key, value) && (
                      <button className="field-link-pick" title="Link a note" aria-label={`Link a note to ${key}`} onClick={() => void pickLink(key, value)}>
                        <Icon name="link" size={12} />
                        <span>Link</span>
                      </button>
                    )}
                  </div>
                ) : kind === 'checkbox' ? (
                  <input type="checkbox" className="prop-check" checked={value === true} disabled={readOnly} onChange={(e) => apply((doc) => setValue(doc, key, e.target.checked))} />
                ) : kind === 'number' ? (
                  <TextEditor value={String(value ?? '')} readOnly={readOnly} onChange={(v) => apply((doc) => setValue(doc, key, v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : v))} />
                ) : (
                  <TextOrLinks value={value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)} readOnly={readOnly} from={path} onChange={(v) => apply((doc) => setValue(doc, key, v))} onOpen={onOpenLink} kinds={kinds} onKind={(i, anchor) => openKindMenu(key, kinds.length, i, anchor)} onLink={!readOnly && offersLink(key, value) ? () => void pickLink(key, value) : undefined} />
                ))}
              {mismatch && <div className="field-note">{mismatch}</div>}
            </div>
          </div>
        );
      })}
      {inline.map(({ key, value, once }) => (
        <div key={`inline:${key}`} className="field-row is-inline-field" data-inline-field={key} title={once ? `Written in the note as “${key}:: …”. Change it here.` : `Written in the note as “${key}:: …” more than once. Change it there.`}>
          <span className="field-key">
            <Icon name="text" size={12} className="field-kind" />
            <span>{key}</span>
          </span>
          <div className="field-value field-inline-value">
            {once && !readOnly ? (
              <TextEditor
                value={Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')}
                readOnly={false}
                onChange={(v) => {
                  const next = setInlineField(text, key, v);
                  if (next === null) showError('That field moved in the note just now. Change it where it is written.');
                  else onChange(next);
                }}
              />
            ) : (
              <span>{Array.isArray(value) ? value.map(String).join(', ') : String(value)}</span>
            )}
            <span className="field-where">in the note</span>
          </div>
        </div>
      ))}
      {!readOnly &&
        (adding ? (
          <div className="field-row is-new">
            <span className="prop-add-wrap">
              <input
                className="field-key-input"
                autoFocus
                value={newKey}
                placeholder="Field name"
                onChange={(e) => setNewKey(e.target.value)}
                onBlur={() => commitNew(newKey, false)}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) commitNew(newKey, true);
                  if (e.key === 'Escape') {
                    setAdding(false);
                    setNewKey('');
                  }
                }}
              />
              {keySuggestions.length > 0 && (
                <span className="prop-suggest">
                  {keySuggestions.map((k) => (
                    <button key={k} onMouseDown={(e) => { e.preventDefault(); commitNew(k, true); }}>
                      {k}
                    </button>
                  ))}
                </span>
              )}
            </span>
          </div>
        ) : (
          <button className="field-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} />
            <span>Add a field</span>
          </button>
        ))}
        </>
      )}
    </div>
  );
}
