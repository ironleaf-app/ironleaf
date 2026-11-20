// A view as a gallery (10.0 Endless Tech, v10records2): notes as large tiles with
// their cover on top (a picture from the vault, or one of the calm colours, from
// the property the view names), then the name and the view's chosen properties,
// the same ones the table shows as columns. A tile opens its note (Ctrl for a new
// tab); right-click has everything a note has; Delete sends it to the Bin with
// Undo. Split into groups when the view says so.

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
  label(key: string): string;
}

export function GalleryLayout({ def, rows, known, canEdit, label }: Props) {
  const sections = sectionRows(rows, def);
  return (
    <div className="sv-gallery-wrap">
      {sections ? (
        sections.map((s) => (
          <section key={s.key} className="sv-section-group" aria-label={`${s.label}, ${s.rows.length} ${s.rows.length === 1 ? 'note' : 'notes'}`}>
            <h2 className="sv-section-head">
              <span>{s.label}</span>
              <span className="sv-count">{s.rows.length}</span>
            </h2>
            <GalleryGrid def={def} rows={s.rows} known={known} canEdit={canEdit} label={label} />
          </section>
        ))
      ) : (
        <GalleryGrid def={def} rows={rows} known={known} canEdit={canEdit} label={label} />
      )}
    </div>
  );
}

function GalleryGrid({ def, rows, known, canEdit, label }: Props) {
  const [limit, setLimit] = useState(FIRST.gallery);
  return (
    <>
      <ul className="sv-gallery" role="list">
        {rows.slice(0, limit).map((r) => (
          <li key={r.path}>
            <GalleryTile def={def} row={r} known={known} canEdit={canEdit} label={label} />
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" className="sv-more sv-more-wide" onClick={() => setLimit((n) => n + FIRST.gallery)}>
          Show {Math.min(FIRST.gallery, rows.length - limit)} more
        </button>
      )}
    </>
  );
}

/** One note's gallery tile: its cover, its name, then each chosen property that has a value. */
function GalleryTile({ def, row, known, canEdit, label }: { def: ViewDef; row: ViewRow; known: Map<string, KnownProp>; canEdit: boolean; label(key: string): string }) {
  const shown = def.columns.map((k) => ({ k, v: valueOf(row, k) })).filter((x) => !isEmpty(x.v));
  return (
    <button
      type="button"
      className="sv-gtile"
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
      <GalleryCover value={def.cover ? valueOf(row, def.cover) : undefined} from={row.path} />
      <span className="sv-gtile-words">
        <span className="sv-gtile-title">{row.title}</span>
        {shown.length > 0 && (
          <span className="sv-gtile-props">
            {shown.map(({ k, v }) => (
              <span key={k} className="sv-gtile-prop">
                <span className="sv-gtile-prop-name">{label(k)}</span>
                <ValueView value={v} kind={kindFor(k, known, v)} field={k} />
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** A tile's cover, read the way a note's own `cover:` is: a picture, a calm colour, or a quiet blank band. */
function GalleryCover({ value, from }: { value: unknown; from: string }) {
  const cover = readCover(Array.isArray(value) ? value[0] : value);
  const [broken, setBroken] = useState(false);
  if (cover?.kind === 'picture' && !broken) {
    const path = resolveFile(cover.path, from) ?? cover.path;
    return (
      <span className="sv-gtile-cover is-picture" aria-hidden="true">
        <img src={fileUrl(path)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      </span>
    );
  }
  return <span className={`sv-gtile-cover${cover?.kind === 'colour' ? ` is-${cover.colour}` : ' is-blank'}`} aria-hidden="true" />;
}
