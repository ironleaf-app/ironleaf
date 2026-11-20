// A view as a board (src/shared/views.ts groupBoard): a column for each value of one property (Planned, In progress,
// Done…, then "No value"), a card for each note. A card dragged to another column — or moved with Alt and an arrow key —
// has that property written into its note. Columns fold to a narrow strip, hide, move, and take a new note of their own.

import { useState } from 'react';
import type { PropValue } from '../../../../shared/frontmatter';
import { columnLabel, groupBoard, isField, movedValue, valueOf, type BoardGroup, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { fileMenu } from '../../state/menus';
import { openMenu, type MenuItem } from '../../components/Menu';
import { FIRST, isNoteDrag, NoteCard, readDragged, type WriteProp } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  change(patch: Partial<ViewDef>): void;
  write: WriteProp;
  newNote(values: Record<string, PropValue>): void;
}

export function BoardLayout({ def, rows, known, canEdit: mayEdit, change, write, newNote }: Props) {
  const prop = def.groupBy!;
  // Columns from a formula or a field (21 Oct 2026) are worked out, not written: cards stay where they are.
  const canEdit = mayEdit && !isField(prop);
  const groups = groupBoard(rows, def);
  const visible = groups.filter((g) => !g.hidden);
  const hidden = groups.filter((g) => g.hidden);
  const [over, setOver] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const byPath = new Map(rows.map((r) => [r.path, r]));

  /** A note put in a column: its property becomes the column's value (a list swaps only the item that placed it). */
  const moveTo = (path: string, from: string, to: BoardGroup) => {
    const row = byPath.get(path);
    if (!row || from === to.key) return;
    write(path, prop, movedValue(valueOf(row, prop), from, to.value));
    // Where the card lands, the keys carry on from.
    requestAnimationFrame(() => (document.querySelector(`.sv-board [data-path="${CSS.escape(path)}"]`) as HTMLElement | null)?.focus());
  };
  const toggle = (list: 'hiddenGroups' | 'collapsedGroups', key: string, on: boolean) => change({ [list]: on ? [...new Set([...def[list], key])] : def[list].filter((k) => k !== key) });
  /** Columns moved by hand keep that order (the value names, as written). */
  const moveColumn = (g: BoardGroup, by: number) => {
    const order = groups.filter((x) => x.key !== '').map((x) => x.label);
    const at = order.indexOf(g.label);
    const to = at + by;
    if (at < 0 || to < 0 || to >= order.length) return;
    order.splice(at, 1);
    order.splice(to, 0, g.label);
    change({ groupOrder: order });
  };
  const columnMenu = (g: BoardGroup, at: HTMLElement | React.MouseEvent) => {
    const items: MenuItem[] = [
      { label: g.collapsed ? 'Unfold the column' : 'Fold the column', icon: g.collapsed ? 'expand' : 'collapse', run: () => toggle('collapsedGroups', g.key, !g.collapsed) },
      { label: 'Hide the column', icon: 'eye', run: () => toggle('hiddenGroups', g.key, true) },
      ...(g.key !== ''
        ? [
            { separator: true } as MenuItem,
            { label: 'Move left', icon: 'back', run: () => moveColumn(g, -1) } as MenuItem,
            { label: 'Move right', icon: 'forward', run: () => moveColumn(g, 1) } as MenuItem,
            { separator: true } as MenuItem,
            { label: `New note in ${g.label}`, icon: 'filePlus', disabled: !canEdit, run: () => g.value !== null && newNote({ [prop]: g.value }) } as MenuItem,
          ]
        : []),
    ];
    openMenu(at instanceof HTMLElement ? at : { clientX: at.clientX, clientY: at.clientY }, items);
  };
  const cardMenu = (row: ViewRow, from: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e, [
      { heading: `Move to` },
      ...groups.map((g) => ({ label: g.label, checked: g.key === from, disabled: !canEdit, run: () => moveTo(row.path, from, g) }) as MenuItem),
      { separator: true },
      ...fileMenu(row.path),
    ]);
  };
  const keys = (row: ViewRow, from: string) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !canEdit) return;
    e.preventDefault();
    const at = visible.findIndex((g) => g.key === from);
    const next = visible[at + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (next) moveTo(row.path, from, next);
  };
  const lift = (g: BoardGroup) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit || !isNoteDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== g.key) setOver(g.key);
    },
    onDragLeave: (e: React.DragEvent) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && setOver((o) => (o === g.key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      setOver(null);
      const d = readDragged(e);
      if (!d || !canEdit) return;
      e.preventDefault();
      moveTo(d.path, d.from, g);
    },
  });

  return (
    <div className="sv-board" role="list" aria-label={`Board by ${columnLabel(def, prop)}`}>
      {visible.map((g) =>
        g.collapsed ? (
          <section key={g.key} role="listitem" className={`sv-column folded${over === g.key ? ' is-over' : ''}`} {...lift(g)}>
            <button type="button" className="sv-fold" onClick={() => toggle('collapsedGroups', g.key, false)} title={`Unfold ${g.label}`} aria-expanded={false}>
              <Icon name="chevron" size={12} />
              <span className="sv-fold-label">{g.label}</span>
              <span className="sv-count">{g.rows.length}</span>
            </button>
          </section>
        ) : (
          <section key={g.key} role="listitem" aria-label={`${g.label}, ${g.rows.length} ${g.rows.length === 1 ? 'note' : 'notes'}`} className={`sv-column${g.key === '' ? ' no-value' : ''}${over === g.key ? ' is-over' : ''}`} {...lift(g)}>
            <header className="sv-column-head" onContextMenu={(e) => (e.preventDefault(), columnMenu(g, e))}>
              <button type="button" className="sv-column-fold" aria-label={`Fold ${g.label}`} title="Fold the column" aria-expanded onClick={() => toggle('collapsedGroups', g.key, true)}>
                <Icon name="chevronDown" size={12} />
              </button>
              <span className="sv-column-name">{g.label}</span>
              <span className="sv-count">{g.rows.length}</span>
              <span className="sv-grow" />
              <button type="button" className="sv-column-more" aria-label={`${g.label}: more`} onClick={(e) => columnMenu(g, e.currentTarget)}>
                <Icon name="more" size={13} />
              </button>
            </header>
            <div className="sv-column-cards">
              {g.rows.slice(0, limits[g.key] ?? FIRST.column).map((r) => (
                <NoteCard key={r.path} row={r} cardProps={def.cardProps} known={known} draggable={canEdit} from={g.key} onKeyDown={keys(r, g.key)} menu={cardMenu(r, g.key)} />
              ))}
              {g.rows.length > (limits[g.key] ?? FIRST.column) && (
                <button type="button" className="sv-more" onClick={() => setLimits((l) => ({ ...l, [g.key]: (l[g.key] ?? FIRST.column) + FIRST.column }))}>
                  Show {Math.min(FIRST.column, g.rows.length - (limits[g.key] ?? FIRST.column))} more
                </button>
              )}
              {!g.rows.length && <p className="sv-column-empty">{canEdit ? 'Drag a card here' : 'Nothing here'}</p>}
            </div>
            {canEdit && g.value !== null && (
              <button type="button" className="sv-column-new" onClick={() => newNote({ [prop]: g.value as PropValue })}>
                <Icon name="plus" size={13} /> New note
              </button>
            )}
          </section>
        ),
      )}
      {hidden.length > 0 && (
        <button
          type="button"
          className="sv-hidden-columns"
          onClick={(e) => openMenu(e.currentTarget, [{ heading: 'Hidden columns' }, ...hidden.map((g) => ({ label: `Show ${g.label}`, icon: 'eye', hint: `${g.rows.length}`, run: () => toggle('hiddenGroups', g.key, false) }) as MenuItem)])}
        >
          <Icon name="eye" size={13} />
          {hidden.length} hidden
        </button>
      )}
    </div>
  );
}
