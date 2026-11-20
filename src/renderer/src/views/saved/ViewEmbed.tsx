// A view inside a note (21 Oct 2026): ![[Reading list.view.json]] draws that view in place — its table, cards or list,
// read-only and at most 20 notes, with "Open view" for the rest and for changing anything. Live Preview and Reading
// both draw it (editor/widgets.ts, lib/hydrate.ts), each into a small React root of its own. It reads the notes from the
// index in memory, as the view's own tab does, so it stays current as notes change; the view's file is read again when
// it changes.

import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readViewFile } from '../../../../shared/base-file';
import { columnLabel, runView, summarize, summaryText, valueOf, viewName, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { Icon } from '../../components/Icon';
import { errorMessage } from '../../lib/errors';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { viewExclusions } from '../../state/savedViews';
import { useApp, usePrefs } from '../../state/store';
import { ViewCard } from './Cards';
import { kindFor, LAYOUT_ICON, openNote, ValueView } from './common';
import { ListLine } from './List';

/** The most notes an embedded view draws; the rest are a click away. */
export const EMBED_ROWS = 20;

/** A view file's words as a view: a .view.json file, or one of a .base file's views (by the name after #). */
export function readEmbedded(path: string, text: string, part?: string): { def: ViewDef; problem: string | null; where?: string[] } {
  return readViewFile(path, text, part);
}

export function ViewEmbed({ path, part }: { path: string; part?: string }) {
  const notes = useApp((s) => s.notes);
  const stamp = useApp((s) => s.files.find((f) => f.rel === path)?.mtime ?? 0);
  const templatesFolder = usePrefs().templatesFolder;
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // The view's words: from its open tab when it is open (changes there show at once), else from disk, again whenever
  // the file changes.
  useEffect(() => {
    let alive = true;
    const open = docs.text(path);
    if (open !== undefined) setText(open);
    else
      void window.nv.files
        .readText(path)
        .then((t) => alive && (setText(t), setFailed(null)))
        .catch((err) => alive && setFailed(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [path, stamp]);

  const { def, problem, where } = useMemo(() => readEmbedded(path, text ?? '', part), [path, text, part]);
  const exclude = useMemo(() => viewExclusions(), [templatesFolder]);
  const rows = useMemo(() => (text === null ? [] : runView(def, notes, { exclude, where })), [def, notes, exclude, where, text]);
  const name = part ? `${viewName(path)} › ${part}` : viewName(path);
  const open = (e: React.MouseEvent) => A.openPath(path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' });
  // The embed only reads: each value is shown by what it holds.
  const kinds = useMemo(() => new Map<string, KnownProp>(), []);

  return (
    <div className="nv-view-embed" role="group" aria-label={`The view ${name}`}>
      <div className="nv-view-embed-head">
        <Icon name={LAYOUT_ICON[def.layout]} size={14} />
        <button type="button" className="nv-view-embed-name" onClick={open} title={`Open ${name}`}>
          {name}
        </button>
        <span className="sv-faint">{text === null ? (failed ? '' : 'Opening…') : `${rows.length} ${rows.length === 1 ? 'note' : 'notes'}`}</span>
        <span className="sv-grow" />
        <button type="button" className="nv-view-embed-open" onClick={open}>
          Open view <Icon name="external" size={12} />
        </button>
      </div>
      {failed ? (
        <p className="nv-view-embed-empty">This view can’t be read: {failed}</p>
      ) : text === null ? null : problem && !rows.length ? (
        <p className="nv-view-embed-empty">{problem}</p>
      ) : rows.length === 0 ? (
        <p className="nv-view-embed-empty">No notes in this view yet.</p>
      ) : def.layout === 'cards' ? (
        <ul className="sv-cards nv-view-embed-cards" role="list">
          {rows.slice(0, EMBED_ROWS).map((r) => (
            <li key={r.path}>
              <ViewCard def={def} row={r} known={kinds} canEdit={false} label={(k) => columnLabel(def, k)} />
            </li>
          ))}
        </ul>
      ) : def.layout === 'list' ? (
        <ul className="sv-list nv-view-embed-list" role="list">
          {rows.slice(0, EMBED_ROWS).map((r) => (
            <li key={r.path}>
              <ListLine def={def} row={r} known={kinds} canEdit={false} label={(k) => columnLabel(def, k)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmbedTable def={def} rows={rows} />
      )}
      {rows.length > EMBED_ROWS && (
        <button type="button" className="nv-view-embed-more" onClick={open}>
          Showing {EMBED_ROWS} of {rows.length} · Open view to see them all
        </button>
      )}
    </div>
  );
}

/** A board or calendar embeds as a table too: its name, then what its cards show (or the table's columns). */
function EmbedTable({ def, rows }: { def: ViewDef; rows: ViewRow[] }) {
  const columns = def.layout === 'table' ? def.columns : [def.layout === 'board' ? def.groupBy : def.dateProp, ...def.cardProps].filter((k, i, all): k is string => !!k && all.indexOf(k) === i);
  const known = new Map<string, KnownProp>();
  const summaries = def.layout === 'table' ? columns.filter((k) => def.summaries[k]) : [];
  return (
    <div className="nv-view-embed-table">
      <table className="sv-table">
        <thead>
          <tr>
            <th scope="col" className="sv-col-title">
              <span className="sv-th-static">{columnLabel(def, 'file.title')}</span>
            </th>
            {columns.map((k) => (
              <th key={k} scope="col">
                <span className="sv-th-static">{columnLabel(def, k)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, EMBED_ROWS).map((r) => (
            <tr key={r.path}>
              <th scope="row" className="sv-col-title">
                <button type="button" className="sv-open" onClick={(e) => openNote(r.path, e)} title={`Open ${r.title} (Ctrl for a new tab)`}>
                  <Icon name="notes" size={13} />
                  <span>{r.title}</span>
                </button>
              </th>
              {columns.map((k) => {
                const v = valueOf(r, k);
                return (
                  <td key={k}>
                    <span className="sv-cell">
                      <ValueView value={v} kind={kindFor(k, known, v)} field={k} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {summaries.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row" className="sv-col-title" />
              {columns.map((k) => {
                const s = def.summaries[k] ? summarize(rows, k, def.summaries[k]) : null;
                return (
                  <td key={k}>
                    {s && (
                      <span className="sv-summary">
                        <span className="sv-summary-label">{s.label}</span>
                        <span className="sv-summary-value">{summaryText(s) || ''}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const roots = new Map<HTMLElement, Root>();

/** Draws a view into an element (a Live Preview widget, a Reading page); call the answer to take it away again. */
export function mountViewEmbed(el: HTMLElement, path: string, part?: string): () => void {
  // Embeds whose page has gone (Reading drawn again) are let go of first.
  for (const [other, root] of roots) {
    if (!other.isConnected) {
      root.unmount();
      roots.delete(other);
    }
  }
  const root = createRoot(el);
  roots.set(el, root);
  root.render(<ViewEmbed path={path} part={part || undefined} />);
  return () => {
    // Unmounting during React's own render is refused; a moment later is fine.
    queueMicrotask(() => {
      root.unmount();
      roots.delete(el);
    });
  };
}
