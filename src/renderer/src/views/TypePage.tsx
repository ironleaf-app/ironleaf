// A note type's page (20 Oct 2026, Ironleaf Calm wave B; src/shared/note-types.ts): every note of one type — every
// person, every meeting, every idea — as a table, a board or a month calendar, on the saved views engine
// (src/shared/views.ts, views/saved/*) without a view file: the view comes from the type (its columns, its grouping, its
// day), and the person's changes to how it looks are remembered for that type in the vault's types file. The notes come
// from the index already in memory, so the page draws at once; a cell typed or a card moved is written into that note.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PropValue } from '../../../shared/frontmatter';
import { notesOfType, setTypeDisplay, typeView } from '../../../shared/note-types';
import { filterWords, knownProps, LAYOUT_WORDS, propWords, runView, suggestDisplay, type ViewDef } from '../../../shared/views';
import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { changeTypes, newNoteOfType, typeOfTab, typesProblem, useAllNoteTypes } from '../state/noteTypes';
import { exportViewCsv, setProp, viewExclusions } from '../state/savedViews';
import { openMenu } from '../components/Menu';
import { showError, useApp, usePrefs } from '../state/store';
import type * as W from '../state/workspace';
import { LAYOUT_ICON } from './saved/common';
import { DisplayPanel } from './saved/Display';
import { ViewLayoutBody } from './saved/Layouts';
import { withPending, type Pending } from './SavedView';
import { PageHead } from '../components/PageHead';

export function TypePage({ tab }: { tab: W.TabState }) {
  const id = typeOfTab(tab)!;
  const types = useAllNoteTypes();
  const type = types.find((t) => t.id === id);
  const notes = useApp((s) => s.notes);
  const byPath = useApp((s) => s.byPath);
  const canEdit = useApp((s) => s.canEdit);
  const templatesFolder = usePrefs().templatesFolder;
  const [display, setDisplay] = useState(false);
  const [pending, setPending] = useState<Pending>(() => new Map());
  // Without a licence a change of look is kept while the page is open, never written.
  const [local, setLocal] = useState<ViewDef | null>(null);

  const def = useMemo(() => local ?? (type ? typeView(type) : null), [local, type]);
  const change = useCallback(
    (patch: Partial<ViewDef>) => {
      if (!def) return;
      const next = { ...def, ...patch, source: { kind: 'all' as const } };
      if (!canEdit) return setLocal(next);
      void changeTypes((c, ctx) => setTypeDisplay(c, ctx, id, next)).catch(showError);
    },
    [def, canEdit, id],
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
  // The type's notes by what the notes say now (a card moved never changes which type it is: `type:` isn't a column).
  const typed = useMemo(() => (type ? notesOfType(live, type.id, types, templatesFolder) : []), [live, type, types, templatesFolder]);
  const rows = useMemo(() => (def ? runView(def, typed, { exclude }) : []), [def, typed, exclude]);
  const sourceRows = useMemo(() => (def && def.filters.length ? runView({ ...def, filters: [] }, typed, { exclude }) : rows), [def, typed, exclude, rows]);
  const props = useMemo(() => knownProps(sourceRows).filter((p) => p.key.toLowerCase() !== 'type'), [sourceRows]);
  const known = useMemo(() => new Map(props.map((p) => [p.key.toLowerCase(), p])), [props]);

  const write = useCallback(
    (note: string, key: string, value: PropValue | null) => {
      if (!canEdit) return;
      setPending((p) => new Map(p).set(note, [...(p.get(note) ?? []).filter((x) => x.key.toLowerCase() !== key.toLowerCase()), { key, value, at: Date.now() }]));
      void setProp(note, key, value).then((ok) => {
        if (!ok)
          setPending((p) => {
            const next = new Map(p);
            next.delete(note);
            return next;
          });
      });
    },
    [canEdit],
  );
  const newNote = useCallback((values: Record<string, PropValue>) => void newNoteOfType(id, { values, where: 'tab' }), [id]);

  if (!type || !def) {
    return (
      <div className="sv-page">
        <PageHead title="Note type" lead="This type is not here any more." />
        <EmptyState icon="notes" title="This type isn’t here any more" line="It was taken away in Settings › Note types. Its notes are as they were, and show as notes." />
      </div>
    );
  }

  const count = typed.length;
  const name = type.name.toLowerCase();
  const needsGroup = def.layout === 'board' && !def.groupBy;
  const needsDate = (def.layout === 'calendar' || def.layout === 'timeline') && !def.dateProp;
  const needsPlace = def.layout === 'map' && !def.placeProp;
  const pickFor = (layout: 'board' | 'calendar' | 'timeline' | 'map') => {
    const s = suggestDisplay(sourceRows);
    return layout === 'board' ? s.groupBy : layout === 'map' ? s.placeProp : s.dateProp;
  };
  const needsKind = needsGroup ? ('board' as const) : needsDate ? (def.layout === 'timeline' ? ('timeline' as const) : ('calendar' as const)) : ('map' as const);
  const problem = typesProblem();

  return (
    <div className={`sv-page nt-page nt-${type.color}`}>
      <PageHead
        className="sv-head nt-head"
        icon={type.icon as IconName}
        title={type.plural}
        count={count}
        lead={<>{type.hint}{def.filters.length ? ` · ${rows.length} of ${count} shown` : ''}{type.folder && type.id !== 'note' ? ` · new ones go in ${type.folder}` : ''}</>}
        actions={<div className="sv-tools">
          {canEdit && (
            <button type="button" className="sv-tool nt-new" onClick={() => newNote({})}>
              <Icon name="plus" size={14} />
              New {name}
            </button>
          )}
          <button type="button" className="sv-tool sv-tool-icon" aria-label={`More for ${type.plural}`} title="More" onClick={(e) => openMenu(e.currentTarget, [{ label: 'Export as CSV…', icon: 'download', disabled: !rows.length, run: () => void exportViewCsv(type.plural, def, rows) }])}>
            <Icon name="more" size={15} />
          </button>
          <div className="sv-display-anchor">
            <button type="button" className={`sv-tool sv-display-button${display ? ' menu-open' : ''}`} aria-haspopup="dialog" aria-expanded={display} onClick={() => setDisplay((d) => !d)}>
              <Icon name={LAYOUT_ICON[def.layout]} size={14} />
              Display
              <span className="sv-faint">· {LAYOUT_WORDS[def.layout]}</span>
              <Icon name="chevronDown" size={11} />
            </button>
            {display && <DisplayPanel def={def} props={props} folders={[]} tags={[]} change={change} close={() => setDisplay(false)} rows={rows} fixedSource={`Every ${name}`} />}
          </div>
        </div>}
      />
      {def.filters.length > 0 && (
        <div className="sv-chips" aria-label="Filters">
          {def.filters.map((f, i) => (
            <span key={i} className="sv-chip">
              <button type="button" className="sv-chip-words" onClick={() => setDisplay(true)} title="Change in Display">
                {filterWords(def, f)}
              </button>
              <button type="button" className="sv-chip-x" aria-label={`Remove the filter ${filterWords(def, f)}`} onClick={() => change({ filters: def.filters.filter((_, j) => j !== i) })}>
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {problem && (
        <p className="sv-problem" role="status">
          <Icon name="warning" size={14} /> {problem}
        </p>
      )}

      <div className="sv-body">
        {count === 0 ? (
          <EmptyState
            className={`nt-empty nt-${type.color}`}
            icon={type.icon as IconName}
            title={type.empty.title}
            line={type.empty.line}
            action={canEdit ? { label: `New ${name}`, icon: 'plus', run: () => newNote({}) } : undefined}
          />
        ) : needsGroup || needsDate || needsPlace ? (
          <div className="sv-empty">
            <Icon name={needsGroup ? 'board' : needsDate ? (def.layout === 'timeline' ? 'timeline' : 'calendar') : 'pin'} size={28} />
            <h2>{needsGroup ? 'Choose what makes the columns' : needsDate ? 'Choose which property holds the day' : 'Choose which property holds the place'}</h2>
            <p>{needsGroup ? `A board has a column for each value of one property, such as status. Drag a card across and the ${name} changes with it.` : needsDate ? (def.layout === 'timeline' ? `Each ${name} sits on the day one of its properties says, and stretches to its end day when the view names one. Drag a mark and its day moves with it.` : `Each ${name} goes on the day one of its properties says. Drag one to another day and its date changes with it.`) : `Each ${name} gathers under the place one of its properties names.`}</p>
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
        ) : rows.length === 0 && def.layout !== 'calendar' ? (
          <EmptyState icon="filter" title="Nothing matches the filters" line={`${count} ${count === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()} here, but the filters leave none of them.`} action={{ label: 'Clear the filters', run: () => change({ filters: [] }) }} also={{ label: 'Change them', run: () => setDisplay(true) }} />
        ) : (
          <ViewLayoutBody def={def} rows={rows} known={known} props={props} canEdit={canEdit} change={change} write={write} newNote={newNote} />
        )}
      </div>
    </div>
  );
}
