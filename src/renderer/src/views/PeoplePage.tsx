// People and Organisations (Wave 4, 24 Oct 2026; module 4 of the catalogue, 22 Oct: "One card per person with role,
// organisation, contact, which projects and meetings they appear in, and last contact date. Built from what's already in
// the projects. Family members get their own protected cards."; 8.7 w2b, 30 Oct 2026). Every person and organisation the
// vault knows, as rows read from the connected records (src/shared/people.ts): the ones with a page, and the ones only
// named in projects and meetings, with "12 people named in your projects, make their cards" and the names that are
// probably one person. A click opens their page with everything joined to them.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonCard, SamePerson } from '../../../shared/people';
import { mergePreviewWords, personTabPath } from '../../../shared/people';
import { recordFactEdit, recordFactText } from '../../../shared/record-edits';
import { Icon } from '../components/Icon';
import { ListDetail, RecordDetail } from '../components/ListDetail';
import { EmptyState } from '../components/EmptyState';
import { openMenu } from '../components/Menu';
import { initials, personHue, shortDate, readDate } from '../lib/projectLook';
import { saveNoteFact } from '../lib/noteFacts';
import { areaOfPath, useAreas } from '../state/areas';
import { lifeChanged, mergePair, openLife, useLifeTick } from '../state/life';
import * as A from '../state/actions';
import { newNoteOfType, openTypePage } from '../state/noteTypes';
import { setWorkspace } from '../state/layout';
import { showError, toast, useApp } from '../state/store';
import { EditorContext, Inline } from './project/Inline';
import * as Ws from '../state/workspace';
import type * as W from '../state/workspace';
import { PageHead } from '../components/PageHead';
import { ListFind, useFindMemory } from '../components/PageTabs';
import { filterPeople, isProtected, nextMeetingWords, sortPeopleByAction, type PeopleFilter } from '../../../shared/people';
import { showCount } from '../../../shared/words';
import '../styles/people-meetings.css';
import '../styles/w2b.css';

/** Open a person's page (Job B, 29 Oct 2026): a People tab carrying the person, so Back returns to the list. */
export function openPerson(id: string, where: Ws.Where = 'current'): void {
  // personTabPath: the id already carries `person:` (record ids do), so prefixing it raw doubled every tab.
  setWorkspace((ws) => Ws.open(ws, { type: 'people', path: personTabPath(id) }, where));
}

export interface ShownCard extends PersonCard {
  area?: string;
  protected: boolean;
}

/** The cards (with their area and whether they are protected), the suggestions and the same-person pairs, read again
 *  when the notes change. */
export function usePeople(): { cards: ShownCard[] | null; suggestions: number; orgSuggestions: number; same: number; samePairs: SamePerson[]; failed: boolean; retry(): void } {
  const revision = useApp((s) => s.revision);
  const byPath = useApp((s) => s.byPath);
  const areas = useAreas();
  const tick = useLifeTick();
  const [raw, setRaw] = useState<{ cards: PersonCard[]; suggestions: number; orgs: number; same: number; samePairs: SamePerson[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void Promise.all([window.nv.life.people.cards(), window.nv.life.people.suggestions(), window.nv.life.people.same()]).then(
        ([cards, s, same]) => live && (setRaw({ cards, suggestions: s.length, orgs: s.filter((x) => x.type === 'org').length, same: same.length, samePairs: same }), setFailed(false)),
        // A failed read is not "no people" (W5-6): it is said, with another try.
        () => live && setFailed(true),
      );
    }, raw ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, tick, attempt]);
  const cards = useMemo(() => {
    if (!raw) return null;
    return raw.cards.map((c) => {
      const where = c.path ?? c.namedIn;
      const area = where ? areaOfPath(where)?.id : undefined;
      // Protected (family or health, by its level or its area): the one shared rule, which the served cards filter by too.
      return { ...c, area, protected: isProtected(c.path ? byPath.get(c.path)?.props : undefined, area) };
    });
    // areas: a card's area follows the areas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, byPath, areas]);
  return { cards, suggestions: raw?.suggestions ?? 0, orgSuggestions: raw?.orgs ?? 0, same: raw?.same ?? 0, samePairs: raw?.samePairs ?? [], failed, retry: () => setAttempt((a) => a + 1) };
}

const DAY = 86400000;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function lastWords(iso: string): string {
  const ms = readDate(iso);
  if (ms === null) return iso;
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - ms) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(ms);
}

/** A card's role changed where shown: in their own note with a page, else their role in the project naming them. */
async function saveCardRole(c: PersonCard, value: string): Promise<boolean> {
  if (c.path) return saveNoteFact(c.path, { type: c.type, page: true }, 'role', value, value.trim() ? 'Changed the role.' : 'Took the role off.');
  // An organisation with a page shows a project's role without saying which: nowhere certain to write.
  if (!c.namedIn || (c.type === 'org' && c.page)) return false;
  try {
    const v = await window.nv.projects.view(c.namedIn);
    const record = { type: c.type, title: c.name, path: c.namedIn, page: false as const };
    if (recordFactText(v.project, record, 'role', c.namedIn) === null) {
      toast('That is not changeable here any more.');
      return false;
    }
    const change = recordFactEdit(v.project, record, 'role', value, c.namedIn);
    if (!change) {
      toast('That is not changeable here any more.');
      return false;
    }
    const r = await window.nv.projects.edit(c.namedIn, change, v.version);
    toast(r.words, { label: 'Undo', run: () => void window.nv.projects.undo(c.namedIn!).then((u) => toast(u.words), showError) });
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

export function PersonTile({ c }: { c: ShownCard }) {
  const canEdit = useApp((s) => s.canEdit);
  const open = (e: React.MouseEvent) => {
    if ((e.ctrlKey || e.metaKey) && c.path) return A.openPath(c.path, { where: 'tab' });
    openPerson(c.id, e.ctrlKey || e.metaKey ? 'tab' : 'current');
  };
  const orgShown = c.type === 'person' ? c.orgName || undefined : c.people.length ? `${c.people.length} ${c.people.length === 1 ? 'person' : 'people'}` : undefined;
  // Someone with a page changes in their note; someone only named changes their role where named. An organisation
  // with a page shows a project's role without saying which, so its role stays read-only here. An empty role or
  // organisation still offers its change (t8, 8 Nov 2026, "everything is editable"): the placeholder adds it where
  // the value would change.
  const roleEditable = !!c.namedIn || (c.type === 'person' && !!c.path);
  const orgEditable = c.type === 'person' && !!c.path;
  const roleShown = !!c.role || (canEdit && roleEditable);
  const orgShownNow = !!orgShown || (canEdit && orgEditable);
  const editor = useMemo(() => ({ path: '', canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [canEdit]);
  return (
    <li className={`pc-card${c.page ? '' : ' is-named'}${c.protected ? ' is-protected' : ''}`}>
      {/* A click opens their page, a double-click their note (p15-person, 4 Nov 2026): the old words said peek
        and page, which is not what either click does. */}
      <button
        type="button"
        className="pc-card-main"
        onClick={open}
        onDoubleClick={() => c.path && A.openPath(c.path)}
        title={`${c.name}\nOpen their page, with everything joined to ${c.type === 'org' ? 'it' : 'them'}${c.path ? ' (double-click: their note)' : ''}`}
      >
        <span className={`pc-avatar${c.type === 'org' ? ' is-org' : ''}`} style={{ ['--hue' as string]: personHue(c.name) }} aria-hidden="true">
          {c.type === 'org' ? <Icon name="briefcase" size={16} /> : initials(c.name)}
        </span>
        <span className="pc-words">
          <span className="pc-name">
            {c.name}
            {c.protected && (
              <span className="pc-lock" title="Protected: family and health cards are kept from agents unless you allow them">
                <Icon name="lock" size={11} />
              </span>
            )}
          </span>
          {(c.role || orgShown || (canEdit && (roleEditable || orgEditable))) && (
            <span className="pc-sub" onClick={canEdit && (roleEditable || orgEditable) ? (e) => e.stopPropagation() : undefined}>
              <EditorContext.Provider value={editor}>
                {canEdit && roleEditable ? (
                  <Inline value={c.role ?? ''} label="role" placeholder="+ Role" onSave={(v) => saveCardRole(c, v)}>
                    {c.role}
                  </Inline>
                ) : (
                  c.role
                )}
                {roleShown && orgShownNow ? ' · ' : null}
                {canEdit && orgEditable ? (
                  <Inline value={c.orgName} label="organisation" placeholder="+ Organisation" onSave={(v) => saveNoteFact(c.path!, { type: 'person', page: true }, 'org', v, v.trim() ? 'Changed the organisation.' : 'Took the organisation off.')}>
                    {orgShown}
                  </Inline>
                ) : (
                  orgShown
                )}
              </EditorContext.Provider>
            </span>
          )}
          <span className="pc-meta">
            {c.youOwe > 0 && <span className="pc-open">You owe {c.youOwe}</span>}
            {c.owesYou > 0 && <span className="pc-open">Owes you {c.owesYou}</span>}
            {c.lastContact && <span>Last met {lastWords(c.lastContact.date)}</span>}
            {c.nextMeeting?.date && <span>Next meeting {nextMeetingWords(c.nextMeeting.date, todayIso())}</span>}
            {!c.page && <span className="pc-faint">No card yet</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

type Show = 'people' | 'orgs';

/** A new organisation's card (in the area the person is in), opened to name it. */
export async function newOrganisation(area?: string): Promise<void> {
  try {
    const { made: [path] } = await window.nv.life.people.make([{ name: 'New organisation', type: 'org', ...(area ? { area } : {}) }]);
    if (path) A.openPath(path, { mode: 'live' });
  } catch (err) {
    showError(err);
  }
}

/** The cards of the vault, or of one area ('' for the things in no area yet). */
export function PeopleGrid({ area, compact = false }: { area?: string; compact?: boolean }) {
  const { cards, suggestions, orgSuggestions, same, samePairs, failed, retry } = usePeople();
  const canEdit = useApp((s) => s.canEdit);
  const [show, setShow] = useState<Show>('people');
  const [find, setFind] = useState('');
  const [merging, setMerging] = useState<string | null>(null);
  const shown = useMemo(() => {
    if (!cards) return null;
    const q = find.trim().toLowerCase();
    return cards.filter((c) => (area === undefined || (c.area ?? '') === area) && (show === 'orgs' ? c.type === 'org' : c.type === 'person') && (!q || [c.name, c.role ?? '', c.org?.name ?? '', ...c.names].some((s) => s.toLowerCase().includes(q))));
  }, [cards, area, show, find]);
  if (failed && !cards) return <EmptyState size="panel" icon="people" title="Couldn't check" line="Your people are still there. Try again in a moment." action={{ label: 'Try again', run: retry }} />;
  if (!cards || !shown) return <div className="pc-loading" aria-busy="true" />;
  const withCards = shown.filter((c) => c.page);
  const named = shown.filter((c) => !c.page).sort((a, b) => b.mentions - a.mentions);
  // The counts are of cards (as the area's People and the side bar count them); the people only named show below.
  const people = cards.filter((c) => c.type === 'person' && c.page && (area === undefined || (c.area ?? '') === area)).length;
  const orgs = cards.filter((c) => c.type === 'org' && c.page && (area === undefined || (c.area ?? '') === area)).length;
  return (
    <div className={`pc-grid-wrap${compact ? ' is-compact' : ''}`}>
      {(suggestions > 0 || same > 0) && area === undefined && (
        <div className="pc-banners">
          {suggestions > 0 && (
            <div className="pc-banner">
              <Icon name="people" size={16} />
              <span>
                <strong>
                  {suggestions - orgSuggestions > 0 && `${suggestions - orgSuggestions} ${suggestions - orgSuggestions === 1 ? 'person' : 'people'}`}
                  {suggestions - orgSuggestions > 0 && orgSuggestions > 0 && ' and '}
                  {orgSuggestions > 0 && `${orgSuggestions} ${orgSuggestions === 1 ? 'organisation' : 'organisations'}`}
                </strong>{' '}
                named in your projects and meetings {suggestions === 1 ? 'has' : 'have'} no card yet.
              </span>
              <button type="button" className="button primary small" disabled={!canEdit} onClick={() => openLife({ kind: 'make-cards' })}>
                Make their cards
              </button>
            </div>
          )}
          {same > 0 && (
            <div className="pc-banner is-pairs">
              <Icon name="merge" size={16} />
              <div className="pc-pairs">
                <span>
                  <strong>{same}</strong> {same === 1 ? 'pair of names looks' : 'pairs of names look'} like the same person. Merging keeps every name, detail and note on one card, and every link and mention follows.
                </span>
                <ul>
                  {samePairs.map((p) => (
                    <li key={`${p.keep}|${p.other}`}>
                      <span className="pc-pair-names">
                        <strong>{p.otherName}</strong> into <strong>{p.keepName}</strong>
                        <span className="pc-faint"> · {p.why}{p.preview ? ` · ${mergePreviewWords(p.preview)}` : ''}</span>
                      </span>
                      <button
                        type="button"
                        className="button primary small"
                        disabled={!canEdit || merging !== null}
                        onClick={() => {
                          setMerging(p.other);
                          void mergePair(p.keep, p.other).finally(() => setMerging(null));
                        }}
                      >
                        {merging === p.other ? 'Merging…' : 'Merge'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" className="button small" disabled={!canEdit} onClick={() => openLife({ kind: 'same-people' })}>
                Review
              </button>
            </div>
          )}
        </div>
      )}
      <div className="pc-tools">
        <div className="seg" role="tablist" aria-label="People or organisations">
          <button type="button" role="tab" aria-selected={show === 'people'} className={show === 'people' ? 'on' : ''} onClick={() => setShow('people')}>
            People{showCount(people) ? <> <span className="seg-count">{people}</span></> : null}
          </button>
          <button type="button" role="tab" aria-selected={show === 'orgs'} className={show === 'orgs' ? 'on' : ''} onClick={() => setShow('orgs')}>
            Organisations{showCount(orgs) ? <> <span className="seg-count">{orgs}</span></> : null}
          </button>
        </div>
        <label className="pc-find">
          <Icon name="search" size={13} />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this list" aria-label="Find in this list" />
        </label>
      </div>
      {failed ? (
        <EmptyState size="panel" icon="people" title="Couldn't check" line="Your people are still there. Try again in a moment." action={{ label: 'Try again', run: retry }} />
      ) : !shown.length ? (
        <EmptyState
          size="panel"
          icon={show === 'orgs' ? 'briefcase' : 'people'}
          title={find ? 'No one by that name' : show === 'orgs' ? 'No organisations here yet' : 'No people here yet'}
          line={find ? 'Try another name, or part of one.' : 'People named in projects, meetings and steps show here by themselves; make a card for anyone.'}
          action={!find && canEdit ? { label: show === 'orgs' ? 'New organisation' : 'New person', icon: 'plus', run: () => void (show === 'orgs' ? newOrganisation() : newNoteOfType('person')) } : undefined}
        />
      ) : (
        <>
          {withCards.length > 0 && (
            <ul className="pc-grid" aria-label={show === 'orgs' ? 'Organisations with a card' : 'People with a card'}>
              {withCards.map((c) => (
                <PersonTile key={c.id} c={c} />
              ))}
            </ul>
          )}
          {named.length > 0 && (
            <section className="pc-named">
              <h3 className="pc-section-head">
                Named in your projects <span className="pc-faint">· {named.length} with no card yet</span>
              </h3>
              <ul className="pc-grid">
                {named.map((c) => (
                  <PersonTile key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const FILTERS: readonly (readonly [PeopleFilter, string])[] = [['all', 'All'], ['owes-you', 'Owes you'], ['you-owe', 'You owe'], ['recent', 'Met recently']];

/** A row's second line: who they are, the first thing open between you, when you last met, and the projects they are
 *  on (t8, 8 Nov 2026: a person on a project shows it here, both ways). Projects read last, so a narrow row
 *  clips them first and keeps who, waiting and met. Two names at most, then a count; the whole line stays on
 *  hover. */
function rowMeta(c: ShownCard): string {
  const who = [c.role, c.orgName].filter(Boolean).join(' · ');
  const first = c.owesYouItems[0] ? `owes you: ${c.owesYouItems[0].title}` : c.youOweItems[0] ? `you owe: ${c.youOweItems[0].title}` : '';
  const met = c.lastContact ? `met ${lastWords(c.lastContact.date)}` : '';
  const projs = !c.projects.length ? '' : c.projects.length <= 2 ? `on ${c.projects.map((p) => p.title).join(', ')}` : `on ${c.projects.slice(0, 2).map((p) => p.title).join(', ')} +${c.projects.length - 2} more`;
  return [who, first || (!c.youOwe && !c.owesYou ? 'nothing open' : ''), met, projs].filter(Boolean).join(' · ');
}

export function PeoplePage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const { cards, samePairs } = usePeople();
  const [show, setShow] = useState<Show>('people');
  const [filter, setFilter] = useState<PeopleFilter>('all');
  // The words stand as left (t266: leaving the room forgot them; Tasks remembers its filter).
  const [find, setFind] = useFindMemory('people');
  const findRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [merging, setMerging] = useState<string | null>(null);
  const today = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  const reset = (fn: () => void) => () => { fn(); setSelected(0); };
  const peopleCards = useMemo(() => (cards ? cards.filter((c) => c.type === 'person') : null), [cards]);
  const orgCards = useMemo(() => {
    if (!cards) return null;
    const q = find.trim().toLowerCase();
    return sortPeopleByAction(cards.filter((c) => c.type === 'org' && (!q || [c.name, c.role ?? '', ...c.names].some((s) => s.toLowerCase().includes(q)))));
  }, [cards, find]);
  const people = useMemo(() => (peopleCards ? sortPeopleByAction(filterPeople(peopleCards, filter, today, find)) : null), [peopleCards, filter, today, find]);
  const shown = show === 'orgs' ? orgCards : people;
  // The Find counts its chip without its words (t262): the same rows with the words off.
  const match = useMemo(() => {
    if (!find.trim() || !cards) return null;
    const m = show === 'orgs' ? cards.filter((c) => c.type === 'org').length : filterPeople(cards.filter((c) => c.type === 'person'), filter, today, '').length;
    return { n: shown?.length ?? 0, m };
  }, [find, cards, show, filter, today, shown]);
  // The title counts the rows on show (10.0 second round N4): the list shows everyone, so the count does too.
  const count = shown?.length ?? 0;
  const filterCount = (id: PeopleFilter) => (peopleCards ? filterPeople(peopleCards, id, today, '').length : 0);
  const lead = !cards ? 'Reading your people.' : (() => { const owes = cards.reduce((n, c) => n + c.owesYou, 0); const owe = cards.reduce((n, c) => n + c.youOwe, 0); return [owes ? `${owes} ${owes === 1 ? 'thing' : 'things'} to chase` : '', owe ? `${owe} ${owe === 1 ? 'thing' : 'things'} you owe` : ''].filter(Boolean).join(' · ') || 'Nothing open with anyone. New people show here as your notes name them.'; })();
  return (
    // The page scrolls in the frame's scroller, as BinView's does (p25 one column: the column's gutters match the
    // vscroll rooms' at every window, and a long list scrolls instead of running past the window's edge).
    <div
      className="nv-page-scroll"
      data-tab={tab.id}
      onKeyDown={(e) => {
        // The room's / key jumps to the Find (fnv3 F29: a key is the list's only outside a field).
        if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
        if (e.key === '/' && document.activeElement !== findRef.current) {
          e.preventDefault();
          findRef.current?.focus();
        }
      }}
    >
    <div className="nv-page full w2b-list w2b-people has-split">
      <PageHead
        icon="people"
        title="People"
        count={count}
        lead={lead}
        actions={
          <>
            <div className="seg" role="tablist" aria-label="People or organisations">
              <button type="button" role="tab" aria-selected={show === 'people'} className={show === 'people' ? 'on' : ''} onClick={reset(() => setShow('people'))}>People</button>
              <button type="button" role="tab" aria-selected={show === 'orgs'} className={show === 'orgs' ? 'on' : ''} onClick={reset(() => setShow('orgs'))}>Organisations</button>
            </div>
            {canEdit && <button type="button" className="button primary" onClick={() => void (show === 'orgs' ? newOrganisation() : newNoteOfType('person'))}><Icon name="plus" size={14} /> {show === 'orgs' ? 'New organisation' : 'New person'}</button>}
            <button type="button" className="iconbtn" aria-label="More for people" title="More" onClick={(e) => openMenu(e.currentTarget, [
              { label: 'Make cards for people named in projects…', icon: 'people', disabled: !canEdit, run: () => openLife({ kind: 'make-cards' }) },
              { label: 'Find the same person under two names…', icon: 'merge', disabled: !canEdit, run: () => openLife({ kind: 'same-people' }) },
              { separator: true },
              { label: 'Show as a table', icon: 'table', run: () => openTypePage('person', 'tab', { asTable: true }) },
            ])}><Icon name="more" size={15} /></button>
          </>
        }
      />
      <div className="chips w2b-chips">
        {/* Filters share the one zero rule (3 Nov 2026, fifth-round H1): a zero stays off, like a badge. */}
        {show === 'people' && FILTERS.map(([id, words]) => {
          const n = filterCount(id);
          return (<button key={id} type="button" role="tab" aria-selected={filter === id} className={`chip${filter === id ? ' on' : ''}`} onClick={reset(() => setFilter(id))}>{words}{showCount(n) ? <span className="n">{n}</span> : null}</button>);
        })}
      </div>
      <ListFind id="people" open always value={find} onChange={(v) => { setFind(v); setSelected(0); }} match={match} inputRef={findRef} inputProps={{ 'data-people-search': true }} hint="Press / to jump to the find" />
      {/* Two names for one person (9 Nov 2026, one person one page): each pair with its reason and what a merge moves,
        one tap to merge, never by itself. */}
      {show === 'people' && samePairs.length > 0 && (
        <section className="w2b-same" aria-label="These look like the same person">
          <h2 className="glabel w2b-group">These look like the same person</h2>
          <ul className="sp-list">
            {samePairs.map((p) => (
              <li key={`${p.keep}|${p.other}`} className="sp-row">
                <span className="sp-names">
                  <strong>{p.otherName}</strong> <Icon name="forward" size={11} /> <strong>{p.keepName}</strong>
                  <span className="ld-line">{p.why}{p.preview ? ` · ${mergePreviewWords(p.preview)}` : ''}</span>
                </span>
                <button
                  type="button"
                  className="button small"
                  disabled={!canEdit || merging !== null}
                  onClick={() => {
                    setMerging(p.other);
                    void window.nv.life.people
                      .notSame(p.keep, p.other)
                      .then(() => lifeChanged(), showError)
                      .finally(() => setMerging(null));
                  }}
                >
                  Not the same
                </button>
                <button
                  type="button"
                  className="button primary small"
                  disabled={!canEdit || merging !== null}
                  onClick={() => {
                    setMerging(p.other);
                    void mergePair(p.keep, p.other).finally(() => setMerging(null));
                  }}
                >
                  {merging === p.other ? 'Merging…' : `Merge into ${p.keepName}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!shown ? <div className="pc-loading" aria-busy="true" /> : !shown.length ? (
        <EmptyState size="panel" icon={show === 'orgs' ? 'briefcase' : 'people'} title={find ? 'No one by that name' : show === 'orgs' ? 'No organisations here yet' : 'No one here yet'} line={find ? 'Try another name, or part of one.' : 'People named in projects, meetings and notes show here. Make a card for anyone you work with.'} action={!find && canEdit ? { label: show === 'orgs' ? 'New organisation' : 'New person', icon: 'plus', run: () => void (show === 'orgs' ? newOrganisation() : newNoteOfType('person')) } : undefined} />
      ) : (
        <ListDetail
                rows={shown.length}

          label="The person chosen"
          list={
          <div className="card w2b-card" onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, shown.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); } else if (e.key === 'Enter') { const c = shown[selected]; if (c) openPerson(c.id); } }}>
            {shown.map((c, i) => (
              <button key={c.id} type="button" className={`trow w2b-row${i === selected ? ' is-active' : ''}`} onClick={() => openPerson(c.id)} onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)} title={`Everything about ${c.name}`}>
                {c.type === 'org' ? (
                  <span className="gtile sm slate" aria-hidden="true"><Icon name="briefcase" size={15} /></span>
                ) : (
                  <span className="pc-avatar w2b-pava" style={{ ['--hue' as string]: personHue(c.name) }} aria-hidden="true">{initials(c.name)}</span>
                )}
                <span className="w2b-row-main">
                  <span className="t clip" title={`${c.name}${!c.page ? ' · No card yet' : ''}`}>
                    {c.name}
                    {c.protected && <span className="w2b-lock" title="Protected: family and health cards are kept from agents unless you allow them"><Icon name="lock" size={11} /></span>}
                    {!c.page && <span className="w2b-faint"> · No card yet</span>}
                  </span>
                  <span className="meta clip" title={show === 'orgs' && c.people.length ? `${c.people.length} ${c.people.length === 1 ? 'person' : 'people'} · ${rowMeta(c)}` : rowMeta(c)}>{show === 'orgs' && c.people.length ? `${c.people.length} ${c.people.length === 1 ? 'person' : 'people'} · ${rowMeta(c)}` : rowMeta(c)}</span>
                </span>
                {c.owesYou > 0 ? <span className="tag slate w2b-tag"><span className="dot" aria-hidden="true" />Owes you {c.owesYou}</span> : c.youOwe > 0 ? <span className="tag slate w2b-tag">You owe {c.youOwe}</span> : <span className="tag slate w2b-tag">Nothing open</span>}
              </button>
            ))}
          </div>
          }
          detail={shown[selected] ? <RecordDetail refTo={{ id: shown[selected].id }} onOpen={(tab) => openPerson(shown[selected].id, tab ? 'tab' : 'current')} /> : null}
        />
      )}
      {/* No help sentence under the list (p25 one column, "everything earns its place"): the ⋯ beside the
          primary action already names both actions whole, as every other room's ⋯ does. */}
    </div>
    </div>
  );
}
