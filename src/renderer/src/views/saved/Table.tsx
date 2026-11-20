// A view as a table (src/shared/views.ts): a row for each note, its name first and the chosen properties beside it. A
// heading sorts (again for the other way, a third time back to by name); a cell edits in place — typed, ticked or
// picked from a calendar — and is written into the note's properties; the name opens the note. A formula column
// (21 Oct 2026) is worked out, never typed into: its ⋯ changes the formula. Under the columns, a summary row: each
// column can show its count, how many are filled or empty, how many different values, and for numbers the sum,
// average, smallest and largest, for days the earliest and latest — worked out over every note the view shows.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PropKind, PropValue } from '../../../../shared/frontmatter';
import { linkTargetType, notesOfType, typeOfNote } from '../../../../shared/note-types';
import { addLink, kindKeyFor, LINK_KINDS, linkFor, looksLikeRelation, readLinkKinds, relationTargets, removeLink, resolveRelation, setLinkKind } from '../../../../shared/relation-links';
import { cellValue, columnKind, columnLabel, FIELD_TITLE, formulaKey, formulaName, isField, isFormulaKey, isRollupKey, movedDate, propWords, readDate, rollupKey, rollupName, sectionRows, summarize, summaryChoices, summaryText, SUMMARY_WORDS, valueOf, valueText, withoutFormula, withoutRollup, type KnownProp, type SummaryKind, type ViewDef, type ViewRow } from '../../../../shared/views';
import { prompt } from '../../components/Dialogs';
import { openFormulaEditor } from './FormulaEditor';
import { openRollupEditor } from './RollupEditor';
import { Icon } from '../../components/Icon';
import { openMenu, type MenuItem } from '../../components/Menu';
import { pick } from '../../components/Pickers';
import { fuzzyFilter } from '../../lib/fuzzy';
import { fileMenu } from '../../state/menus';
import * as A from '../../state/actions';
import { loadFiles, useApp, usePrefs } from '../../state/store';
import { FIRST, kindFor, openNote, ValueView, type WriteProp } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  props: KnownProp[];
  canEdit: boolean;
  change(patch: Partial<ViewDef>): void;
  write: WriteProp;
}

export function TableLayout({ def, rows, known, props, canEdit, change, write }: Props) {
  const [limit, setLimit] = useState(FIRST.table);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const columns = [FIELD_TITLE, ...def.columns];
  const sort = def.sort ?? { prop: FIELD_TITLE, dir: 'asc' as const };
  // Relation columns (8.8): those holding links to other notes, picked, searched and made from the cell.
  const vaultNotes = useApp((s) => s.notes);
  const linkNotes = useMemo(() => vaultNotes.map((n) => ({ path: n.path, title: n.label || n.title })), [vaultNotes]);
  const relations = useMemo(() => new Set(def.columns.filter((c) => looksLikeRelation(rows.slice(0, 40).map((r) => valueOf(r, c))))), [def.columns, rows]);

  const sortBy = (key: string) => {
    if (sort.prop !== key) return change({ sort: { prop: key, dir: 'asc' } });
    if (sort.dir === 'asc') return change({ sort: { prop: key, dir: 'desc' } });
    change({ sort: undefined });
  };
  const moveColumn = (key: string, by: number) => {
    const at = def.columns.indexOf(key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= def.columns.length) return;
    const next = [...def.columns];
    next.splice(at, 1);
    next.splice(to, 0, key);
    change({ columns: next });
  };
  const label = (key: string) => columnLabel(def, key);
  const editFormula = (name?: string) => openFormulaEditor({ def, rows, props, change, name });
  const editRollup = (name?: string) => openRollupEditor({ def, rows, props, change, name });
  const renameHeading = async (key: string) => {
    const words = await prompt('Rename the heading', { value: label(key), ok: 'Rename', message: `Only the heading changes; the notes keep ${isFormulaKey(key) ? 'their values' : `“${key}” as it is`}.` });
    if (words === null) return;
    const labels = { ...def.labels };
    // Back to the property's own name when the heading is cleared or set to it.
    if (!words.trim() || words.trim() === (isFormulaKey(key) ? formulaName(key) : propWords(key))) delete labels[key];
    else labels[key] = words.trim().slice(0, 120);
    change({ labels });
  };
  const headMenu = (key: string, at: HTMLElement | React.MouseEvent) => {
    const items: MenuItem[] = [
      { label: 'Sort A to Z', icon: 'sort', checked: sort.prop === key && sort.dir === 'asc', run: () => change({ sort: { prop: key, dir: 'asc' } }) },
      { label: 'Sort Z to A', icon: 'sort', checked: sort.prop === key && sort.dir === 'desc', run: () => change({ sort: { prop: key, dir: 'desc' } }) },
    ];
    if (key !== FIELD_TITLE) {
      items.push(
        { separator: true },
        { label: 'Move left', icon: 'back', disabled: def.columns.indexOf(key) <= 0, run: () => moveColumn(key, -1) },
        { label: 'Move right', icon: 'forward', disabled: def.columns.indexOf(key) >= def.columns.length - 1, run: () => moveColumn(key, 1) },
        { label: 'Hide this column', icon: 'eye', run: () => change({ columns: def.columns.filter((c) => c !== key), sort: sort.prop === key ? undefined : def.sort }) },
        { label: 'Rename the heading…', icon: 'pencil', run: () => void renameHeading(key) },
      );
      if (isFormulaKey(key))
        items.push(
          { separator: true },
          { label: 'Change the formula…', icon: 'math', run: () => editFormula(formulaName(key)) },
          { label: 'Remove the formula', icon: 'trash', danger: true, run: () => change(withoutFormula(def, formulaName(key))) },
        );
      if (isRollupKey(key))
        items.push(
          { separator: true },
          { label: 'Change the rollup…', icon: 'chart', run: () => editRollup(rollupName(key)) },
          { label: 'Remove the rollup', icon: 'trash', danger: true, run: () => change(withoutRollup(def, rollupName(key))) },
        );
    }
    openMenu(at instanceof HTMLElement ? at : { clientX: at.clientX, clientY: at.clientY }, items);
  };
  const addMenu = (anchor: HTMLElement) => {
    const offer = props.filter((p) => !def.columns.some((c) => c.toLowerCase() === p.key.toLowerCase()));
    const hiddenFormulas = Object.keys(def.formulas).filter((n) => !def.columns.includes(formulaKey(n)));
    const hiddenRollups = Object.keys(def.rollups ?? {}).filter((n) => !def.columns.includes(rollupKey(n)));
    const items: MenuItem[] = [
      { label: 'New formula column…', icon: 'math', run: () => editFormula() },
      ...hiddenFormulas.map((n) => ({ label: n, icon: 'math', hint: 'Formula', run: () => change({ columns: [...def.columns, formulaKey(n)] }) }) as MenuItem),
      { label: 'New rollup column…', icon: 'chart', run: () => editRollup() },
      ...hiddenRollups.map((n) => ({ label: n, icon: 'chart', hint: 'Rollup', run: () => change({ columns: [...def.columns, rollupKey(n)] }) }) as MenuItem),
      { separator: true },
      { heading: offer.length ? 'Add a column' : 'Every property is shown' },
      ...offer.slice(0, 40).map((p) => ({ label: propWords(p.key), hint: `${p.count}`, run: () => change({ columns: [...def.columns, p.key] }) }) as MenuItem),
      ...(!def.columns.includes('file.folder') ? [{ separator: true } as MenuItem, { label: 'Folder', icon: 'folder', run: () => change({ columns: [...def.columns, 'file.folder'] }) } as MenuItem] : []),
      ...(!def.columns.includes('file.modified') ? [{ label: 'Changed', icon: 'clock', run: () => change({ columns: [...def.columns, 'file.modified'] }) } as MenuItem] : []),
    ];
    openMenu(anchor, items);
  };

  // Split into groups when the view says so (21 Oct 2026); "Show more" still counts rows across the groups.
  const sections = sectionRows(rows, def);
  const visible = new Set((sections ? sections.flatMap((x) => x.rows) : rows).slice(0, limit).map((r) => r.path));
  const row = (r: ViewRow) => (
    // A row: right-click for everything a note has (open beside, rename, move, copy, delete); the bin at its end on
    // hover, and Delete on any of its cells, send it to Recently deleted with Undo (5.2.0, "easy delete").
    <tr
      key={r.path}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea, select')) return;
        e.preventDefault();
        openMenu({ clientX: e.clientX, clientY: e.clientY }, fileMenu(r.path));
      }}
      onKeyDown={(e) => {
        if ((e.key !== 'Delete' && !(e.key === 'Backspace' && (e.ctrlKey || e.metaKey))) || !canEdit || editing) return;
        if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
        e.preventDefault();
        void A.trashPath(r.path);
      }}
    >
      {columns.map((key) =>
        key === FIELD_TITLE ? (
          <th key={key} scope="row" className="sv-col-title">
            <button type="button" className="sv-open" onClick={(e) => openNote(r.path, e)} onAuxClick={(e) => e.button === 1 && openNote(r.path, e)} title={`Open ${r.title} (Ctrl for a new tab)`}>
              <Icon name="notes" size={13} />
              <span>{r.title}</span>
            </button>
          </th>
        ) : relations.has(key) ? (
          <td key={key}>
            <RelationCell row={r} field={key} label={label(key)} notes={linkNotes} canEdit={canEdit} write={write} />
          </td>
        ) : (
          <td key={key}>
            <Cell row={r} field={key} label={label(key)} kind={kindFor(key, known, valueOf(r, key))} canEdit={canEdit && !isField(key)} editing={editing?.path === r.path && editing.key === key} setEditing={(on) => setEditing(on ? { path: r.path, key } : null)} write={write} suggest={editing?.path === r.path && editing.key === key ? () => usedValues(rows, key) : undefined} />
          </td>
        ),
      )}
      <td className="sv-col-add sv-row-end">
        <span className="sv-row-tools">
          <button type="button" className="sv-row-tool" aria-label={`More for ${r.title}`} title="More" onClick={(e) => openMenu(e.currentTarget, fileMenu(r.path))}>
            <Icon name="more" size={14} />
          </button>
          {canEdit && (
            <button type="button" className="sv-row-tool sv-row-delete" aria-label={`Delete ${r.title}`} title="Delete (to Recently deleted, with Undo)" onClick={() => void A.trashPath(r.path)}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </span>
      </td>
    </tr>
  );

  return (
    // Each column's widest is its share of the room there is (saved-views.css, 20 Oct 2026: a long About line pushed the
    // table past a narrow pane and Updated showed as "Upd"); long words end in an ellipsis instead.
    <div className="sv-table-wrap" style={{ '--sv-cols': columns.length + 1 } as React.CSSProperties}>
      <table className="sv-table">
        <thead>
          <tr>
            {columns.map((key) => {
              const on = sort.prop === key;
              return (
                <th key={key} scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={key === FIELD_TITLE ? 'sv-col-title' : undefined} onContextMenu={(e) => (e.preventDefault(), headMenu(key, e))}>
                  <span className="sv-th">
                    <button type="button" className={`sv-th-sort${on ? ' on' : ''}`} onClick={() => sortBy(key)} title={isFormulaKey(key) ? `Sort by ${label(key)} · formula: ${def.formulas[formulaName(key)] ?? ''}` : isRollupKey(key) ? `Sort by ${label(key)} · rollup of ${def.rollups?.[rollupName(key)]?.field ?? ''}` : `Sort by ${label(key)}`}>
                      {isFormulaKey(key) && <Icon name="math" size={11} className="sv-th-formula" />}
                      {isRollupKey(key) && <Icon name="chart" size={11} className="sv-th-formula" />}
                      <span>{label(key)}</span>
                      {on && <Icon name="chevronDown" size={11} className={sort.dir === 'asc' ? 'sv-up' : undefined} />}
                    </button>
                    <button type="button" className="sv-th-more" aria-label={`${label(key)}: more`} onClick={(e) => headMenu(key, e.currentTarget)}>
                      <Icon name="more" size={13} />
                    </button>
                  </span>
                </th>
              );
            })}
            <th className="sv-col-add" scope="col">
              <button type="button" className="sv-th-add" aria-label="Add a column" title="Add a column" onClick={(e) => addMenu(e.currentTarget)}>
                <Icon name="plus" size={14} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sections
            ? sections.map((sec) => {
                const shown = sec.rows.filter((r) => visible.has(r.path));
                if (!shown.length) return null;
                return [
                  <tr key={`section:${sec.key}`} className="sv-section-row">
                    <th scope="rowgroup" colSpan={columns.length + 1}>
                      <span className="sv-section-head">
                        <span>{sec.label}</span>
                        <span className="sv-count">{sec.rows.length}</span>
                      </span>
                    </th>
                  </tr>,
                  ...shown.map(row),
                ];
              })
            : rows.slice(0, limit).map(row)}
        </tbody>
        <tfoot>
          <tr className="sv-summary-row">
            {columns.map((key) => (
              <SummaryCell key={key} def={def} rows={rows} field={key} kind={key === FIELD_TITLE ? 'text' : (known.get(key.toLowerCase())?.kind ?? columnKind(rows, key))} label={label(key)} change={change} />
            ))}
            <td className="sv-col-add" />
          </tr>
        </tfoot>
      </table>
      <div className="sv-table-foot">
        <span>
          {rows.length} {rows.length === 1 ? 'note' : 'notes'}
        </span>
        {rows.length > limit && (
          <button type="button" className="button" onClick={() => setLimit((n) => n + FIRST.table)}>
            Show {Math.min(FIRST.table, rows.length - limit)} more
          </button>
        )}
      </div>
    </div>
  );
}

/** A column's summary in the row under the table: its answer, or (on hover or focus) a quiet "Summary" to choose one. */
function SummaryCell({ def, rows, field, kind, label, change }: { def: ViewDef; rows: ViewRow[]; field: string; kind: PropKind; label: string; change(patch: Partial<ViewDef>): void }) {
  const how = def.summaries[field];
  // A summary chosen while the column held numbers stays chosen; it simply has nothing to add up when they're gone.
  const s = how ? summarize(rows, field, how) : null;
  const choose = (anchor: HTMLElement) => {
    const set = (next: SummaryKind | null) => {
      const summaries = { ...def.summaries };
      if (next) summaries[field] = next;
      else delete summaries[field];
      change({ summaries });
    };
    const choices = summaryChoices(kind);
    openMenu(anchor, [
      { heading: `Sum up ${label}` },
      { label: 'None', checked: !how, run: () => set(null) },
      ...[...choices, ...(how && !choices.includes(how) ? [how] : [])].map((k) => ({ label: SUMMARY_WORDS[k], checked: how === k, run: () => set(k) }) as MenuItem),
    ]);
  };
  const Tag = field === FIELD_TITLE ? 'th' : 'td';
  return (
    <Tag className={field === FIELD_TITLE ? 'sv-col-title' : undefined} {...(field === FIELD_TITLE ? { scope: 'row' } : {})}>
      <button type="button" className={`sv-summary${s ? ' on' : ''}`} aria-label={s ? `${label}: ${s.label} ${summaryText(s) || 'nothing to sum up'}. Choose another summary.` : `Choose a summary for ${label}`} onClick={(e) => choose(e.currentTarget)}>
        {s ? (
          <>
            <span className="sv-summary-label">{s.label}</span>
            {s.value === null ? null : s.day ? <ValueView value={s.value} kind={String(s.value).includes('T') ? 'datetime' : 'date'} /> : <span className="sv-summary-value">{summaryText(s)}</span>}
          </>
        ) : (
          <span className="sv-summary-add">Summary</span>
        )}
      </button>
    </Tag>
  );
}

/** One cell: shown, or edited in place (Enter or a click to edit; Enter keeps it, Esc puts it back). */
/** The values a column already has in other rows (most used first), offered while a cell of it is typed in. */
function usedValues(rows: ViewRow[], field: string): string[] {
  const count = new Map<string, number>();
  for (const r of rows) {
    const v = valueOf(r, field);
    for (const one of Array.isArray(v) ? v : [v]) {
      const words = valueText(one).trim();
      if (words && words.length <= 80) count.set(words, (count.get(words) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 50).map(([w]) => w);
}

function Cell({ row, field, label: heading, kind, canEdit, editing, setEditing, write, suggest }: { row: ViewRow; field: string; label: string; kind: PropKind; canEdit: boolean; editing: boolean; setEditing(on: boolean): void; write: WriteProp; suggest?(): string[] }) {
  const value = valueOf(row, field);
  const label = `${heading} of ${row.title}`;
  // Back on the cell after editing, so the keys carry on from where they were.
  const button = useRef<HTMLButtonElement>(null);
  const was = useRef(editing);
  useEffect(() => {
    if (was.current && !editing && document.activeElement === document.body) button.current?.focus();
    was.current = editing;
  }, [editing]);
  if (kind === 'checkbox' && (typeof value === 'boolean' || value === undefined || value === null)) {
    return (
      <label className="sv-cell sv-check">
        <input type="checkbox" checked={value === true} disabled={!canEdit} aria-label={label} onChange={(e) => write(row.path, field, e.currentTarget.checked)} />
      </label>
    );
  }
  if (editing && canEdit) return <CellEditor row={row} field={field} kind={kind} value={value} label={label} done={() => setEditing(false)} write={write} suggestions={suggest?.() ?? []} />;
  return (
    <button ref={button} type="button" className={`sv-cell${canEdit ? ' editable' : ''}`} aria-label={canEdit ? `${label}: ${valueText(value) || 'empty'}. Press Enter to change it.` : undefined} onClick={() => canEdit && setEditing(true)} tabIndex={canEdit ? 0 : -1}>
      <ValueView value={value} kind={kind} field={field} />
    </button>
  );
}

/** A relation cell (8.8): each linked record a chip (opens it; × unlinks it), what it is to this one beside it, and a
 *  quiet + to pick, search or make one. The picker offers the field's type of note first (every note one press away). */
function RelationCell({ row, field, label, notes, canEdit, write }: { row: ViewRow; field: string; label: string; notes: { path: string; title: string }[]; canEdit: boolean; write: WriteProp }) {
  const value = valueOf(row, field);
  const targets = relationTargets(value);
  const paths = resolveRelation(targets, notes);
  const kinds = readLinkKinds(row.props, field, targets.length);
  const templatesFolder = usePrefs().templatesFolder;
  const vaultNotes = useApp((s) => s.notes);
  const titleOf = (path: string) => notes.find((n) => n.path === path)?.title ?? path.split('/').pop()!.replace(/\.md$/i, '');
  // Named but not written yet: shown as words, still removable.
  const missing = targets.filter((t) => !resolveRelation([t], notes).length);
  const dropRaw = (raw: string) => {
    const items = (Array.isArray(value) ? value.flat(Infinity) : [value]).filter((x): x is string => typeof x === 'string' && !!x.trim());
    const kept = items.filter((s) => !relationTargets(s).some((t) => t.toLowerCase() === raw.toLowerCase()));
    write(row.path, field, kept.length ? (Array.isArray(value) ? kept : (kept as unknown as PropValue)) : null);
  };
  /** One link's kind (two links to one record share its chip; the first one's kind shows). */
  const kindAt = (at: number): string => kinds[at] ?? '';
  const setKind = (at: number, kind: string | null) => {
    const sib = Object.keys(row.props).find((k) => k.toLowerCase() === kindKeyFor(field).toLowerCase()) ?? kindKeyFor(field);
    write(row.path, sib, setLinkKind(row.props, field, targets.length, at, kind));
  };
  const kindMenu = (at: number, anchor: HTMLElement) => {
    openMenu(anchor, [
      { heading: 'Kind of link' },
      ...LINK_KINDS.map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), checked: kindAt(at) === k, run: () => setKind(at, k) })),
      { label: 'No kind', checked: !kindAt(at), run: () => setKind(at, null) },
    ]);
  };
  const kindButton = (at: number, name: string) =>
    canEdit ? (
      <button type="button" className={`sv-kind${kindAt(at) ? '' : ' is-empty'}`} title={kindAt(at) ? `Kind of link: ${kindAt(at)}. Change it.` : 'Kind of link: add one.'} aria-label={kindAt(at) ? `Kind of link to ${name}: ${kindAt(at)}. Change it.` : `Kind of link to ${name}: add one.`} onClick={(e) => kindMenu(at, e.currentTarget)}>
        {kindAt(at) || '+'}
      </button>
    ) : kindAt(at) ? (
      <span className="sv-kind">{kindAt(at)}</span>
    ) : null;
  const add = async () => {
    const createAndLink = async (title: string) => {
      const clean = title.replace(/[\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!clean) return;
      const path = await window.nv.files.create(row.folder, clean, '.md', '');
      await loadFiles();
      write(row.path, field, addLink(value, linkFor({ path, title: clean }, [...notes, { path, title: clean }])));
    };
    const { getNoteTypes } = await import('../../state/noteTypes');
    const types = getNoteTypes();
    const expected = linkTargetType(types, typeOfNote({ path: row.path, props: row.props }, types, templatesFolder), field);
    const pool = expected ? notesOfType(vaultNotes, expected, types, templatesFolder).map((n) => ({ path: n.path, title: n.label || n.title })) : null;
    const plural = expected ? (types.find((t) => t.id === expected)?.plural ?? 'notes') : '';
    let showAll = false;
    for (;;) {
      const list = (showAll || !pool ? notes : pool).filter((n) => n.path !== row.path && !paths.includes(n.path));
      const id = await pick({
        placeholder: `Link to which record?`,
        items: (q) => [
          ...(!showAll && pool ? [{ id: '__all__', label: 'Show every note', detail: `Only ${plural.charAt(0).toLowerCase() + plural.slice(1)} shown`, icon: 'notes' as const }] : []),
          ...fuzzyFilter(list, q, (n) => `${n.title} ${n.path}`, 40).map((n) => ({ id: n.path, label: n.title, detail: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : 'Top of the notes', icon: 'notes' as const })),
        ],
        extraRow: (q) => (q.trim() && !notes.some((n) => n.title.toLowerCase() === q.trim().toLowerCase()) ? { label: `New “${q.trim().slice(0, 60)}”`, run: () => void createAndLink(q.trim()) } : null),
        footer: '↑↓ to move · Enter to link it · Esc to cancel',
      });
      if (id === '__all__') {
        showAll = true;
        continue;
      }
      if (id) write(row.path, field, addLink(value, linkFor({ path: id, title: titleOf(id) }, notes)));
      break;
    }
  };
  if (!targets.length) {
    if (!canEdit) return <span className="sv-value sv-blank" aria-label="Empty" />;
    return (
      <button type="button" className="sv-cell sv-relation-add" aria-label={`${label} of ${row.title}: empty. Link a record.`} onClick={() => void add()}>
        <Icon name="plus" size={12} />
        <span>Link</span>
      </button>
    );
  }
  return (
    <span className="sv-relation">
      {paths.map((p) => {
        const at = targets.findIndex((t) => resolveRelation([t], notes).includes(p));
        return (
          <span key={p} className="sv-pill is-link">
            <button type="button" className="sv-pill-open" onClick={(e) => openNote(p, e)} onAuxClick={(e) => e.button === 1 && openNote(p, e)} title={`Open ${titleOf(p)} (Ctrl for a new tab)`}>
              {titleOf(p)}
            </button>
            {kindButton(at, titleOf(p))}
            {canEdit && (
              <button type="button" className="sv-pill-x" aria-label={`Unlink ${titleOf(p)}`} title="Unlink" onClick={() => write(row.path, field, removeLink(value, p, notes))}>
                <Icon name="close" size={10} />
              </button>
            )}
          </span>
        );
      })}
      {missing.map((t) => (
        <span key={t} className="sv-pill is-missing" title="Not written yet">
          {t}
          {kindButton(targets.indexOf(t), t)}
          {canEdit && (
            <button type="button" className="sv-pill-x" aria-label={`Remove ${t}`} title="Remove" onClick={() => dropRaw(t)}>
              <Icon name="close" size={10} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button type="button" className="sv-relation-add" aria-label={`Link another record to ${row.title}`} title="Link a record" onClick={() => void add()}>
          <Icon name="plus" size={12} />
        </button>
      )}
    </span>
  );
}

function CellEditor({ row, field, kind, value, label, done, write, suggestions }: { row: ViewRow; field: string; kind: PropKind; value: unknown; label: string; done(): void; write: WriteProp; suggestions: string[] }) {
  const isDate = kind === 'date' || kind === 'datetime';
  const initial = isDate ? (readDate(value)?.iso ?? '') : Array.isArray(value) ? value.map(valueText).join(', ') : valueText(value);
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const listId = useId();
  useEffect(() => {
    ref.current?.focus();
    if (!isDate) ref.current?.select();
  }, []);
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    done();
    if (text === initial) return;
    let next: PropValue | null;
    if (isDate) next = text ? movedDate(value, text) : null;
    else next = cellValue(text, typeof value === 'number' ? 'number' : kind);
    write(row.path, field, next);
  };
  return (
    <>
    <input
      ref={ref}
      className="sv-cell-input"
      type={isDate ? 'date' : 'text'}
      // The column keeps its width while a cell of it is edited: the box takes the cell's room, not its own.
      size={1}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      value={text}
      aria-label={label}
      placeholder={kind === 'tags' || kind === 'list' ? 'Separate with commas' : kind === 'number' ? 'A number' : isDate ? undefined : `${propWords(field)}…`}
      list={!isDate && suggestions.length ? listId : undefined}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finished.current = true;
          done();
        }
      }}
    />
    {!isDate && suggestions.length > 0 && (
      <datalist id={listId}>
        {suggestions.filter((w) => w !== initial).map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>
    )}
    </>
  );
}
