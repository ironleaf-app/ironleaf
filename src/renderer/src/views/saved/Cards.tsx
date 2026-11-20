// A view as cards (21 Oct 2026): a grid of notes, each a card with its cover on top (a picture from the vault, or one of
// the calm colours, from the property the view names), its name, and the view's chosen properties under it, the same
// ones the table shows as columns. A card opens its note (Ctrl for a new tab); right-click has everything a note has;
// Delete sends it to Recently deleted with Undo. Split into groups when the view says so.

import { useState } from 'react';
import { readCover } from '../../../../shared/note-page';
import { isEmpty, sectionRows, valueOf, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { openMenu } from '../../components/Menu';
import { fileUrl, resolveFile } from '../../lib/resolve';
import * as A from '../../state/actions';
import { fileMenu } from '../../state/menus';
import { FIRST, kindFor, openNote, ValueView } from './common';

interface Props {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  canEdit: boolean;
  /** A column's heading as the view names it. */
  label(key: string): string;
}

export function CardsLayout({ def, rows, known, canEdit, label }: Props) {
  const sections = sectionRows(rows, def);
  return (
    <div className="sv-cards-wrap">
      {sections ? (
        sections.map((s) => (
          <section key={s.key} className="sv-section-group" aria-label={`${s.label}, ${s.rows.length} ${s.rows.length === 1 ? 'note' : 'notes'}`}>
            <h2 className="sv-section-head">
              <span>{s.label}</span>
              <span className="sv-count">{s.rows.length}</span>
            </h2>
            <CardGrid def={def} rows={s.rows} known={known} canEdit={canEdit} label={label} />
          </section>
        ))
      ) : (
        <CardGrid def={def} rows={rows} known={known} canEdit={canEdit} label={label} />
      )}
    </div>
  );
}

function CardGrid({ def, rows, known, canEdit, label }: Props) {
  const [limit, setLimit] = useState(FIRST.cards);
  return (
    <>
      <ul className="sv-cards" role="list">
        {rows.slice(0, limit).map((r) => (
          <li key={r.path}>
            <ViewCard def={def} row={r} known={known} canEdit={canEdit} label={label} />
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="sv-more sv-more-wide" onClick={() => setLimit((n) => n + FIRST.cards)}>
          Show {Math.min(FIRST.cards, rows.length - limit)} more
        </button>
      )}
    </>
  );
}

/** One note's card: its cover (when the view has one), its name, then each chosen property that has a value. */
export function ViewCard({ def, row, known, canEdit, label }: { def: ViewDef; row: ViewRow; known: Map<string, KnownProp>; canEdit: boolean; label(key: string): string }) {
  const shown = def.columns.map((k) => ({ k, v: valueOf(row, k) })).filter((x) => !isEmpty(x.v));
  return (
    <button
      type="button"
      className={`sv-tile${def.cover ? ' has-cover' : ''}`}
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
      {def.cover && <CardCover value={valueOf(row, def.cover)} from={row.path} />}
      <span className="sv-tile-words">
        <span className="sv-tile-title">{row.title}</span>
        {shown.length > 0 && (
          <span className="sv-tile-props">
            {shown.map(({ k, v }) => (
              <span key={k} className="sv-tile-prop">
                <span className="sv-tile-prop-name">{label(k)}</span>
                <ValueView value={v} kind={kindFor(k, known, v)} field={k} />
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** A card's cover, read the way a note's own `cover:` is (src/shared/note-page.ts): a picture, a calm colour, or a quiet
 *  blank band so the cards in a row still line up. */
function CardCover({ value, from }: { value: unknown; from: string }) {
  const cover = readCover(Array.isArray(value) ? value[0] : value);
  const [broken, setBroken] = useState(false);
  if (cover?.kind === 'picture' && !broken) {
    const path = resolveFile(cover.path, from) ?? cover.path;
    return (
      <span className="sv-tile-cover is-picture" aria-hidden="true">
        <img src={fileUrl(path)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      </span>
    );
  }
  return <span className={`sv-tile-cover${cover?.kind === 'colour' ? ` is-${cover.colour}` : ' is-blank'}`} aria-hidden="true" />;
}
