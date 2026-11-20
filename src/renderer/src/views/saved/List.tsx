// A view as a list (21 Oct 2026): the quietest layout, one line per note — its name, then the view's chosen properties
// inline after it — for a reading list or a run of meetings where a table would be too much. A line opens its note
// (Ctrl for a new tab); right-click has everything a note has; Delete sends it to Recently deleted with Undo.

import { useState } from 'react';
import { isEmpty, sectionRows, valueOf, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import * as A from '../../state/actions';
import { fileMenu } from '../../state/menus';
import { FIRST, kindFor, openNote, ValueView } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  label(key: string): string;
}

export function ListLayout(props: Props) {
  const sections = sectionRows(props.rows, props.def);
  return (
    <div className="sv-list-wrap">
      {sections ? (
        sections.map((s) => (
          <section key={s.key} className="sv-section-group" aria-label={`${s.label}, ${s.rows.length} ${s.rows.length === 1 ? 'note' : 'notes'}`}>
            <h2 className="sv-section-head">
              <span>{s.label}</span>
              <span className="sv-count">{s.rows.length}</span>
            </h2>
            <Lines {...props} rows={s.rows} />
          </section>
        ))
      ) : (
        <Lines {...props} />
      )}
    </div>
  );
}

function Lines({ def, rows, known, canEdit, label }: Props) {
  const [limit, setLimit] = useState(FIRST.table);
  return (
    <>
      <ul className="sv-list" role="list">
        {rows.slice(0, limit).map((r) => (
          <li key={r.path}>
            <ListLine def={def} row={r} known={known} canEdit={canEdit} label={label} />
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="sv-more sv-more-wide" onClick={() => setLimit((n) => n + FIRST.table)}>
          Show {Math.min(FIRST.table, rows.length - limit)} more
        </button>
      )}
    </>
  );
}

export function ListLine({ def, row, known, canEdit, label }: { def: ViewDef; row: ViewRow; known: Map<string, KnownProp>; canEdit: boolean; label(key: string): string }) {
  const shown = def.columns.map((k) => ({ k, v: valueOf(row, k) })).filter((x) => !isEmpty(x.v));
  return (
    <button
      type="button"
      className="sv-line"
      title={`Open ${row.title} (Ctrl for a new tab)`}
      onClick={(e) => openNote(row.path, e)}
      onAuxClick={(e) => e.button === 1 && openNote(row.path, e)}
      onKeyDown={(e) => {
        if (canEdit && (e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)))) {
          e.preventDefault();
          void A.trashPath(row.path);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({ clientX: e.clientX, clientY: e.clientY }, fileMenu(row.path));
      }}
    >
      <Icon name="notes" size={13} />
      <span className="sv-line-title">{row.title}</span>
      {shown.map(({ k, v }) => (
        <span key={k} className="sv-line-prop" title={label(k)}>
          <ValueView value={v} kind={kindFor(k, known, v)} field={k} />
        </span>
      ))}
    </button>
  );
}
