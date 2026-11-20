// A view over notes in its own tab (src/shared/views.ts; release 5.0.0): a table, cards, a list, a board or a month
// calendar of the notes a folder or tag gives, by their properties. The view's file (Views/<name>.view.json) holds only how to look;
// the notes come from the index already in memory (the store's notes, kept current as notes change), so a view over
// thousands of notes draws at once and never reads a note from disk to show it. A change made here — a cell typed, a
// card moved, a day dragged — is written into that note's properties (state/savedViews.ts), shown straight away and
// undoable from the message.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PropValue } from '../../../shared/frontmatter';
import { isBasePath, readViewFile, writeViewFile } from '../../../shared/base-file';
import { columnLabel, filterWords, knownProps, LAYOUT_PHRASE, LAYOUT_WORDS, propWords, runView, sourceWords, suggestDisplay, viewName, type ViewDef } from '../../../shared/views';
import { Icon } from '../components/Icon';
import { errorMessage } from '../lib/errors';
import { docs } from '../state/docs';
import { fileMenu } from '../state/menus';
import { exportViewCsv, newNoteInView, setProp, viewExclusions } from '../state/savedViews';
import { openMenu, type MenuItem } from '../components/Menu';
import { showError, useApp, usePrefs } from '../state/store';
import type * as W from '../state/workspace';
import { LAYOUT_ICON } from './saved/common';
import { DisplayPanel } from './saved/Display';
import { ViewLayoutBody } from './saved/Layouts';
import { PageHead } from '../components/PageHead';

/** Values written a moment ago, shown before the index has them (so a moved card never jumps back). */
export type Pending = Map<string, { key: string; value: PropValue | null; at: number }[]>;

export function withPending(props: Record<string, unknown>, list: { key: string; value: PropValue | null }[]): Record<string, unknown> {
  const next = { ...props };
  for (const { key, value } of list) {
    const own = Object.keys(next).find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
    if (value === null) delete next[own];
    else next[own] = value;
  }
  return next;
}

export function SavedView({ tab }: { tab: W.TabState }) {
  const path = tab.path!;
  const notes = useApp((s) => s.notes);
  const byPath = useApp((s) => s.byPath);
  const folders = useApp((s) => s.folders);
  const canEdit = useApp((s) => s.canEdit);
  const templatesFolder = usePrefs().templatesFolder;
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [display, setDisplay] = useState(false);
  const [pending, setPending] = useState<Pending>(() => new Map());
  // A .base file can hold several views (21 Oct 2026): which one this tab shows.
  const [part, setPart] = useState(0);
  useEffect(() => setPart(0), [path]);

  // The view's file, shared with any other tab showing it and reloaded when it changes outside Ironleaf.
  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    setText(null);
    setFailed(null);
    void docs
      .acquire(path)
      .then((t) => {
        if (!alive) return docs.release(path);
        setText(t);
        unsubscribe = docs.subscribe(path, (next) => setText(next));
      })
      .catch((err) => alive && setFailed(errorMessage(err)));
    return () => {
      alive = false;
      unsubscribe();
      docs.release(path);
    };
  }, [path]);

  const { def, problem, where, views, notes: fileNotes } = useMemo(() => readViewFile(path, text ?? '', part), [path, text, part]);
  const foreign = isBasePath(path);
  /** A change to how the view looks: written to its file (without a licence, kept for now, not saved). A .base file
   *  keeps everything else in it as it was (src/shared/base-file.ts). */
  const change = useCallback(
    (patch: Partial<ViewDef>) => {
      const next = writeViewFile(path, text ?? '', { ...def, ...patch }, part);
      if (canEdit) docs.update(path, next, 'view');
      else setText(next);
    },
    [def, canEdit, path, text, part],
  );

  // Once the index has caught up with a written value (or a few seconds have gone), it no longer needs holding.
  useEffect(() => {
    if (!pending.size) return;
    setPending((p) => {
      const now = Date.now();
      const next: Pending = new Map();
      for (const [k, list] of p) {
        const props = byPath.get(k)?.props ?? {};
        const kept = list.filter((x) => now - x.at < 4000 && JSON.stringify(withPending(props, [x])) !== JSON.stringify(props));
        if (kept.length) next.set(k, kept);
      }
      return next;
    });
  }, [notes]);
  const live = useMemo(() => (pending.size ? notes.map((n) => (pending.has(n.path) ? { ...n, props: withPending(n.props, pending.get(n.path)!) } : n)) : notes), [notes, pending]);

  const exclude = useMemo(() => viewExclusions(), [templatesFolder]);
  const rows = useMemo(() => runView(def, live, { exclude, where }), [def, live, exclude, where]);
  // Properties are offered from every note the view's source gives, not only those the filters leave.
  const sourceRows = useMemo(() => (def.filters.length || def.limit ? runView({ ...def, filters: [], limit: undefined }, live, { exclude, where }) : rows), [def, live, exclude, where, rows]);
  // A view made before its notes had any properties (a new, empty folder: 19 Oct 2026, the first try in the real app showed
  // names only once notes arrived) takes the usual columns, grouping and day as soon as its notes have some. Once anything
  // is chosen, the person's choice stands.
  useEffect(() => {
    // A .base file from elsewhere is never written to just by opening it.
    if (text === null || problem || foreign || def.columns.length || def.cardProps.length || def.groupBy || def.dateProp) return;
    const s = suggestDisplay(sourceRows);
    if (s.columns.length) change({ columns: s.columns, groupBy: s.groupBy, dateProp: s.dateProp, cardProps: s.cardProps, ...(s.cover ? { cover: s.cover } : {}) });
  }, [sourceRows, def, text, problem, foreign, change]);
  const props = useMemo(() => knownProps(sourceRows), [sourceRows]);
  const known = useMemo(() => new Map(props.map((p) => [p.key.toLowerCase(), p])), [props]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([t]) => t);
  }, [notes]);
  const shownFolders = useMemo(() => folders.filter((f) => !exclude.some((h) => f === h || f.startsWith(`${h}/`))), [folders, exclude]);

  const write = useCallback((note: string, key: string, value: PropValue | null) => {
    if (!canEdit) return;
    setPending((p) => new Map(p).set(note, [...(p.get(note) ?? []).filter((x) => x.key.toLowerCase() !== key.toLowerCase()), { key, value, at: Date.now() }]));
    void setProp(note, key, value).then((ok) => {
      if (!ok) setPending((p) => {
        const next = new Map(p);
        next.delete(note);
        return next;
      });
    });
  }, [canEdit]);
  const newNote = useCallback((values: Record<string, PropValue>) => void newNoteInView(def, values).catch(showError), [def]);

  if (failed) {
    return (
      <div className="sv-page nv-page">
        <PageHead icon="views" title={viewName(path)} />
        <div className="sv-empty">
          <Icon name="warning" size={26} />
          <h2>This view can’t be opened</h2>
          <p>{failed}</p>
        </div>
      </div>
    );
  }

  const name = viewName(path);
  const count = rows.length;
  const needsGroup = def.layout === 'board' && !def.groupBy;
  const needsDate = (def.layout === 'calendar' || def.layout === 'timeline') && !def.dateProp;
  const needsPlace = def.layout === 'map' && !def.placeProp;
  const subtitle = [sourceWords(def.source), `${count} ${count === 1 ? 'note' : 'notes'}${def.filters.length ? ` of ${sourceRows.length}` : ''}`, def.layout === 'board' && def.groupBy ? `columns by ${columnLabel(def, def.groupBy).toLowerCase()}` : null].filter(Boolean).join(' · ');
  /** The view's ⋯: its notes out as a spreadsheet, or a spreadsheet in as notes; its form to fill in or link to. */
  const viewMenu = (): MenuItem[] => [
    { label: 'Export as CSV…', icon: 'download', disabled: !rows.length, run: () => void exportViewCsv(name, def, rows) },
    { label: 'Import CSV…', icon: 'table', disabled: !canEdit, run: () => void import('../state/importCsv').then((m) => m.importCsv()) },
    { separator: true },
    { label: 'Fill in the form…', icon: 'text', disabled: !canEdit, run: () => void import('./saved/FormDialog').then((m) => m.openFormDialog({ viewPath: path })) },
    {
      label: 'Copy a link to the form',
      icon: 'link',
      run: () => void import('../../../shared/view-forms').then((m) => navigator.clipboard.writeText(m.formRefFor(path))),
    },
  ];
  /** The first useful choice for a board, calendar, timeline or map that hasn't one yet. */
  const pickFor = (layout: 'board' | 'calendar' | 'timeline' | 'map') => {
    const s = suggestDisplay(sourceRows);
    return layout === 'board' ? s.groupBy : layout === 'map' ? s.placeProp : s.dateProp;
  };
  const needsKind = needsGroup ? ('board' as const) : needsDate ? (def.layout === 'timeline' ? ('timeline' as const) : ('calendar' as const)) : ('map' as const);

  return (
    <div className="sv-page nv-page">
      {/* Job C: this page's header is the one PageHead, as every page (SPEC: no screen left on the old header). */}
      <PageHead
        icon="views"
        title={name}
        count={count}
        lead={<>{views.length > 1 && (
              <select className="sv-part" aria-label="Which view of this file" value={part} onChange={(e) => setPart(Number(e.currentTarget.value))}>
                {views.map((v, i) => (
                  <option key={i} value={i}>
                    {v}
                  </option>
                ))}
              </select>
            )} {text === null ? 'Opening…' : subtitle}</>}
        actions={<div className="sv-tools">
          {canEdit && (
            <button type="button" className="sv-tool" onClick={() => newNote({})} title="A new note in this view">
              <Icon name="filePlus" size={14} />
              New note
            </button>
          )}
          <button type="button" className="sv-tool sv-tool-icon" aria-label="File menu for this view" title="File" onClick={(e) => openMenu(e.currentTarget, fileMenu(path))}>
            <Icon name="file" size={15} />
          </button>
          <button type="button" className="sv-tool sv-tool-icon" aria-label="More for this view" title="More" onClick={(e) => openMenu(e.currentTarget, viewMenu())}>
            <Icon name="more" size={15} />
          </button>
          <div className="sv-display-anchor">
            <button type="button" className={`sv-tool sv-display-button${display ? ' menu-open' : ''}`} aria-haspopup="dialog" aria-expanded={display} onClick={() => setDisplay((d) => !d)}>
              <Icon name={LAYOUT_ICON[def.layout]} size={14} />
              Display
              <span className="sv-faint">· {LAYOUT_WORDS[def.layout]}</span>
              <Icon name="chevronDown" size={11} />
            </button>
            {display && <DisplayPanel def={def} props={props} folders={shownFolders} tags={tags} change={change} close={() => setDisplay(false)} rows={rows} />}
          </div>
        </div>}
      />
      {def.filters.length > 0 && (
        <div className="sv-chips" aria-label="Filters">
          {def.filters.map((f, i) => (
            <span key={i} className="sv-chip">
              <button type="button" className="sv-chip-words" onClick={() => setDisplay(true)} title="Change in Display">{filterWords(def, f)}</button>
              <button type="button" className="sv-chip-x" aria-label={`Remove the filter ${filterWords(def, f)}`} onClick={() => change({ filters: def.filters.filter((_, j) => j !== i) })}><Icon name="close" size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {problem && (
        <p className="sv-problem" role="status">
          <Icon name="warning" size={14} /> {problem}
        </p>
      )}
      {!problem && fileNotes.length > 0 && (
        // What a .base file has that Ironleaf doesn't use: said once, quietly; it stays in the file as it is.
        <details className="sv-file-notes">
          <summary>
            <Icon name="info" size={13} /> Opened from a .base file. {fileNotes.length === 1 ? 'One thing in it isn’t used here' : `${fileNotes.length} things in it aren’t used here`}; the file keeps {fileNotes.length === 1 ? 'it' : 'them'} as {fileNotes.length === 1 ? 'it is' : 'they are'}.
          </summary>
          <ul>
            {fileNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="sv-body">
        {text === null ? null : sourceRows.length === 0 ? (
          <div className="sv-empty">
            <Icon name={LAYOUT_ICON[def.layout]} size={28} />
            <h2>{def.source.kind === 'folder' ? `No notes in ${def.source.value} yet` : def.source.kind === 'tag' ? `No notes tagged #${def.source.value} yet` : 'No notes yet'}</h2>
            <p>
              This view shows {sourceWords(def.source).charAt(0).toLowerCase() + sourceWords(def.source).slice(1)} as {LAYOUT_PHRASE[def.layout]}, by their properties.{' '}
              {def.source.kind === 'tag' ? `Add #${def.source.value} to a note, or make one here, and it shows up straight away.` : 'Make a note here and it shows up straight away.'}
            </p>
            <div className="sv-empty-actions">
              {canEdit && (
                <button type="button" className="button primary" onClick={() => newNote({})}>
                  <Icon name="filePlus" size={14} /> New note here
                </button>
              )}
              <button type="button" className="button" onClick={() => setDisplay(true)}>
                Show other notes
              </button>
            </div>
          </div>
        ) : needsGroup || needsDate || needsPlace ? (
          <div className="sv-empty">
            <Icon name={needsGroup ? 'board' : needsDate ? (def.layout === 'timeline' ? 'timeline' : 'calendar') : 'pin'} size={28} />
            <h2>{needsGroup ? 'Choose what makes the columns' : needsDate ? 'Choose which property holds the day' : 'Choose which property holds the place'}</h2>
            <p>{needsGroup ? 'A board has a column for each value of one property, such as status: Planned, In progress, Done. Drag a card across and the note changes with it.' : needsDate ? (def.layout === 'timeline' ? 'Each note sits on the day one of its properties says, such as due or date, and stretches to its end day when the view names one. Drag a mark and its day moves with it.' : 'Each note goes on the day one of its properties says, such as due or date. Drag a note to another day and its date changes with it.') : 'Each note gathers under the place one of its properties names, such as place or venue.'}</p>
            <div className="sv-empty-actions">
              {pickFor(needsKind) && (
                <button type="button" className="button primary" onClick={() => change(needsGroup ? { groupBy: pickFor('board') } : needsDate ? { dateProp: pickFor(needsKind) } : { placeProp: pickFor('map') })}>
                  Use {propWords(pickFor(needsKind)!).toLowerCase()}
                </button>
              )}
              <button type="button" className="button" onClick={() => setDisplay(true)}>
                Choose in Display
              </button>
            </div>
          </div>
        ) : count === 0 && def.layout !== 'calendar' ? (
          <div className="sv-empty">
            <Icon name="filter" size={28} />
            <h2>No notes match the filters</h2>
            <p>
              {sourceRows.length} {sourceRows.length === 1 ? 'note is' : 'notes are'} in this view, but the filters leave none of them.
            </p>
            <div className="sv-empty-actions">
              <button type="button" className="button primary" onClick={() => change({ filters: [] })}>
                Clear the filters
              </button>
              <button type="button" className="button" onClick={() => setDisplay(true)}>
                Change them
              </button>
            </div>
          </div>
        ) : (
          <ViewLayoutBody def={def} rows={rows} known={known} props={props} canEdit={canEdit} change={change} write={write} newNote={newNote} />
        )}
      </div>
    </div>
  );
}
