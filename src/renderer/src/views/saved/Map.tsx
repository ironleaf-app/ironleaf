// A view as a map (10.0 papercuts): notes grouped by the place they name, most notes first, for notes that hold a
// place (site visits, venues, trips). Each place is a heading with its notes under it; notes naming no place sit in
// the "No place named" tray at the end. A line opens its note (Ctrl for a new tab); right-click has everything a note
// has; Delete sends it to Recently deleted with Undo.

import { useState } from 'react';
import { groupByPlace, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { EmptyState } from '../../components/EmptyState';
import { FIRST } from './common';
import { ListLine } from './List';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  label(key: string): string;
}

export function MapLayout({ def, rows, known, canEdit, label }: Props) {
  const [limit, setLimit] = useState(FIRST.table);
  if (!def.placeProp) {
    return (
      <div className="sv-list-wrap">
        <EmptyState icon="pin" title="No place to map by yet" line="Choose which property holds the place, under Display, and the notes gather under each place." />
      </div>
    );
  }
  const { groups, unplaced } = groupByPlace(rows, def.placeProp);
  const shown = groups.slice(0, limit);
  return (
    <div className="sv-list-wrap">
      {groups.length === 0 && unplaced.length === 0 && <EmptyState icon="pin" title="Nothing to map" line="No note here names a place yet." />}
      {shown.map((g) => (
        <section key={g.place.toLowerCase()} className="sv-section-group" aria-label={`${g.place}, ${g.rows.length} ${g.rows.length === 1 ? 'note' : 'notes'}`}>
          <h2 className="sv-section-head">
            <span>{g.place}</span>
            <span className="sv-count">{g.rows.length}</span>
          </h2>
          <ul className="sv-list" role="list">
            {g.rows.map((r) => (
              <li key={r.path}>
                <ListLine def={def} row={r} known={known} canEdit={canEdit} label={label} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length > limit && (
        <button type="button" className="sv-more sv-more-wide" onClick={() => setLimit((n) => n + FIRST.table)}>
          Show {Math.min(FIRST.table, groups.length - limit)} more places
        </button>
      )}
      {unplaced.length > 0 && (
        <section className="sv-section-group" aria-label={`No place named, ${unplaced.length} ${unplaced.length === 1 ? 'note' : 'notes'}`}>
          <h2 className="sv-section-head">
            <span>No place named</span>
            <span className="sv-count">{unplaced.length}</span>
          </h2>
          <ul className="sv-list" role="list">
            {unplaced.map((r) => (
              <li key={r.path}>
                <ListLine def={def} row={r} known={known} canEdit={canEdit} label={label} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
