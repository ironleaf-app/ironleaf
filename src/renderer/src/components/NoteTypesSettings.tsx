// Settings › Note types (20 Oct 2026, Ironleaf Calm wave B; src/shared/note-types.ts): every type in order with its
// icon, folder, fields and how many notes it has; rename, hide, reorder, open its page; and types of the person's own,
// added, changed and taken away (the built-ins can be renamed and hidden, never deleted). Every change is written to the
// vault's .neuralvault/types.json at once, so the types travel with the notes. Nothing on disk moves or is renamed.

import { useMemo, useState } from 'react';
import { addCustomType, COLOR_WORDS, countTypes, deleteCustomType, editCustomType, FIELD_KIND_WORDS, FIELD_KINDS, hideType, moveType, NOTE_TYPE, renameType, TYPE_COLORS, TYPE_ICONS, type CustomTypeInput, type FieldKind, type NoteType, type TypeColor, type TypeField, type TypeIcon } from '../../../shared/note-types';
import { LAYOUT_WORDS, LAYOUTS, type ViewLayout } from '../../../shared/views';
import { changeTypes, openTypePage, typesProblem, useAllNoteTypes } from '../state/noteTypes';
import { openModal } from '../state/modals';
import { showError, useApp, usePrefs } from '../state/store';
import { confirm, prompt } from './Dialogs';
import { Icon, type IconName } from './Icon';
import { Row } from './Settings';

interface Draft {
  id: string | null;
  name: string;
  plural: string;
  icon: TypeIcon;
  color: TypeColor;
  folder: string;
  layout: ViewLayout;
  fields: TypeField[];
  template: string;
}

const blank = (): Draft => ({ id: null, name: '', plural: '', icon: 'tag', color: 'teal', folder: '', layout: 'table', fields: [{ key: '', kind: 'text' }], template: '' });

/** The form for a type of the person's own: its name, plural, icon, colour, folder, layout, fields and first words. */
function TypeForm({ draft, onDone }: { draft: Draft; onDone(): void }) {
  const [d, setD] = useState(draft);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setField = (i: number, patch: Partial<TypeField>) => set({ fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const save = async () => {
    const input: CustomTypeInput = {
      name: d.name,
      plural: d.plural.trim() || undefined,
      icon: d.icon,
      color: d.color,
      folder: d.folder.trim() || undefined,
      layout: d.layout,
      template: d.template,
      fields: d.fields.filter((f) => f.key.trim()).map((f) => ({ ...f, key: f.key.trim(), ...(f.kind === 'choice' ? { options: (f.options ?? []).filter(Boolean) } : {}) })),
    };
    try {
      await changeTypes((c, ctx) => (d.id ? editCustomType(c, ctx, d.id, input) : addCustomType(c, ctx, input).config));
      onDone();
    } catch (err) {
      showError(err);
    }
  };
  return (
    <div className={`nt-form nt-${d.color}`} role="group" aria-label={d.id ? 'Change the type' : 'A new type'}>
      <label className="nt-form-row">
        <span>Name</span>
        <input className="setting-input" autoFocus value={d.name} placeholder="For example: Recipe" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="nt-form-row">
        <span>More than one</span>
        <input className="setting-input" value={d.plural} placeholder={d.name ? `${d.name.trim()}s` : 'For example: Recipes'} onChange={(e) => set({ plural: e.target.value })} />
      </label>
      <div className="nt-form-row">
        <span>Icon</span>
        <div className="nt-icons" role="radiogroup" aria-label="Icon">
          {TYPE_ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={d.icon === i} aria-label={i} className="nt-icon-choice" onClick={() => set({ icon: i })}>
              <Icon name={i as IconName} size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="nt-form-row">
        <span>Colour</span>
        <div className="nt-swatches" role="radiogroup" aria-label="Colour">
          {TYPE_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={d.color === c} aria-label={COLOR_WORDS[c]} title={COLOR_WORDS[c]} className={`nt-swatch nt-${c}`} onClick={() => set({ color: c })} />
          ))}
        </div>
      </div>
      <label className="nt-form-row">
        <span>Kept in</span>
        <input className="setting-input" value={d.folder} placeholder={d.plural.trim() || (d.name.trim() ? `${d.name.trim()}s` : 'A folder in your notes')} spellCheck={false} onChange={(e) => set({ folder: e.target.value })} />
      </label>
      <label className="nt-form-row">
        <span>Its page shows</span>
        <select className="setting-input" value={d.layout} onChange={(e) => set({ layout: e.target.value as ViewLayout })}>
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {LAYOUT_WORDS[l]}
            </option>
          ))}
        </select>
      </label>
      <div className="nt-form-row">
        <span>Fields</span>
        <div className="nt-fields">
          {d.fields.map((f, i) => (
            <div key={i} className="nt-field">
              <input className="setting-input" value={f.key} placeholder="For example: serves" aria-label="Field name" spellCheck={false} onChange={(e) => setField(i, { key: e.target.value })} />
              <select className="setting-input" value={f.kind} aria-label="What it holds" onChange={(e) => setField(i, { kind: e.target.value as FieldKind })}>
                {FIELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FIELD_KIND_WORDS[k]}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-button" title="Take this field off" onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })}>
                <Icon name="close" size={14} />
              </button>
              {f.kind === 'choice' && <input className="setting-input" style={{ gridColumn: '1 / -1' }} value={(f.options ?? []).join(', ')} placeholder="The choices, with commas: Lead, Quoted, Won" onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()) })} />}
            </div>
          ))}
          <div>
            <button type="button" className="text-button" onClick={() => set({ fields: [...d.fields, { key: '', kind: 'text' }] })}>
              <Icon name="plus" size={13} /> Add a field
            </button>
          </div>
        </div>
      </div>
      <label className="nt-form-row">
        <span>First words</span>
        <textarea className="setting-input" value={d.template} placeholder={'## Ingredients\n\n## Method'} onChange={(e) => set({ template: e.target.value })} />
      </label>
      <div className="nt-form-actions">
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="button primary" disabled={!d.name.trim()} onClick={() => void save()}>
          {d.id ? 'Save the type' : 'Add the type'}
        </button>
      </div>
    </div>
  );
}

export function NoteTypesSettings() {
  const types = useAllNoteTypes();
  const notes = useApp((s) => s.notes);
  const canEdit = useApp((s) => s.canEdit);
  const templatesFolder = usePrefs().templatesFolder;
  const counts = useMemo(() => countTypes(notes, types, templatesFolder), [notes, types, templatesFolder]);
  const [form, setForm] = useState<Draft | null>(null);
  const run = (change: Parameters<typeof changeTypes>[0]) => void changeTypes(change).catch(showError);
  const problem = typesProblem();

  const rename = async (t: NoteType) => {
    const name = await prompt(`Rename ${t.name}`, { value: t.name, ok: 'Next', message: 'What one is called. Its notes stay as they are; a note that says type: ' + t.id + ' is still this type.' });
    if (!name?.trim()) return;
    const plural = await prompt('And more than one?', { value: name.trim() === t.name ? t.plural : `${name.trim()}s`, ok: 'Rename it' });
    if (!plural?.trim()) return;
    run((c, ctx) => renameType(c, ctx, t.id, name, plural));
  };
  const remove = async (t: NoteType) => {
    const n = counts.get(t.id) ?? 0;
    const sure = await confirm(`Take away the type “${t.name}”?`, { ok: 'Take it away', danger: true, message: n ? `Its ${n} ${n === 1 ? 'note stays' : 'notes stay'} exactly as ${n === 1 ? 'it is' : 'they are'}, where ${n === 1 ? 'it is' : 'they are'}, and show as notes.` : 'No notes are this type yet.' });
    if (sure) run((c, ctx) => deleteCustomType(c, ctx, t.id));
  };
  const edit = (t: NoteType) => setForm({ id: t.id, name: t.name, plural: t.plural, icon: t.icon, color: t.color, folder: t.folder, layout: t.view.layout, fields: t.fields.length ? t.fields : [{ key: '', kind: 'text' }], template: t.template });

  return (
    <>
      <h3>Note types</h3>
      <Row title="Your note types" hint="What a note can be: each type has its icon, the fields it starts with, the folder new ones go in, and a page of every note of that type. A note’s type: property says which it is; otherwise its folder does.">
        {canEdit && (
          <button type="button" className="button" disabled={!!form} onClick={() => setForm(blank())}>
            <Icon name="plus" size={14} /> Add a type
          </button>
        )}
      </Row>
      {problem && <p className="setting-said">{problem}</p>}
      {form && <TypeForm key={form.id ?? 'new'} draft={form} onDone={() => setForm(null)} />}
      <div className="nt-list">
        {types.map((t, i) => {
          const n = counts.get(t.id) ?? 0;
          return (
            <div key={t.id} className={`nt-item${t.hidden ? ' is-hidden' : ''}`}>
              <span className={`nt-chip nt-${t.color}`} aria-hidden="true">
                <Icon name={t.icon as IconName} size={15} />
              </span>
              <div className="nt-item-words">
                <div className="nt-item-name">
                  {t.name}
                  {t.plural !== `${t.name}s` && <span className="sv-faint">· {t.plural}</span>}
                  {!t.builtIn && <span className="nt-tag">Your own</span>}
                  {t.hidden && <span className="nt-tag">Hidden</span>}
                </div>
                <div className="nt-item-meta">
                  {[`${n} ${n === 1 ? 'note' : 'notes'}`, t.id === NOTE_TYPE ? 'where new notes go' : t.folder ? `in ${t.folder}` : null, t.fields.length ? t.fields.map((f) => f.key).join(', ') : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="nt-item-tools">
                <button type="button" className="icon-button" title={`Open ${t.plural}`} onClick={() => (openModal(null), openTypePage(t.id))}>
                  <Icon name="external" size={14} />
                </button>
                {canEdit && (
                  <>
                    <button type="button" className="icon-button" title="Move up" disabled={i <= 1 || t.id === NOTE_TYPE} onClick={() => run((c, ctx) => moveType(c, ctx, t.id, -1))}>
                      <Icon name="chevronDown" size={14} className="nt-up" />
                    </button>
                    <button type="button" className="icon-button" title="Move down" disabled={i === types.length - 1 || t.id === NOTE_TYPE} onClick={() => run((c, ctx) => moveType(c, ctx, t.id, 1))}>
                      <Icon name="chevronDown" size={14} />
                    </button>
                    <button type="button" className="icon-button" title={t.builtIn ? 'Rename' : 'Change'} onClick={() => (t.builtIn ? void rename(t) : edit(t))}>
                      <Icon name="pencil" size={14} />
                    </button>
                    {t.id !== NOTE_TYPE && (
                      <button type="button" className="icon-button" title={t.hidden ? 'Show it again' : 'Hide it (its notes keep their type)'} onClick={() => run((c, ctx) => hideType(c, ctx, t.id, !t.hidden))}>
                        <Icon name="eye" size={14} />
                      </button>
                    )}
                    {!t.builtIn && (
                      <button type="button" className="icon-button" title="Take this type away" onClick={() => void remove(t)}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Row title="Add a type of your own" hint="A recipe, a client site, a supplier: its own icon, colour, fields and folder. Kept in your notes (.neuralvault/types.json), so it comes with them to another PC.">
        {canEdit && (
          <button type="button" className="button" disabled={!!form} onClick={() => setForm(blank())}>
            Add a type
          </button>
        )}
      </Row>
    </>
  );
}
