// The areas of life on the calm left side (Wave 4, 24 Oct 2026; src/shared/areas.ts): each area with how much it holds,
// opening its page; its chevron shows its five kinds (Projects, Notes, People, Files, Assets) with their counts, each
// opening the area at that kind. "Not in an area" when something isn't in one yet. Before the vault is organised by
// area, a quiet card offers the move (and can be put away). Also the Inbox's place, with how many wait in it.

import { useEffect, useState } from 'react';
import { AREA_KINDS, KIND_WORDS, type AreaKind } from '../../../shared/areas';
import { Icon, type IconName } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { areaOfTab, kindOfTab, openArea, useAreaCounts, useAreas } from '../state/areas';
import { useWorkspace } from '../state/layout';
import { openInbox, openLife, useLifeTick } from '../state/life';
import { useApp } from '../state/store';
import { activeTab } from '../state/workspace';

const KIND_ICONS: Record<AreaKind, IconName> = { projects: 'layers', notes: 'notes', people: 'people', files: 'files', assets: 'image' };
const OPEN_KEY = 'nv.areas.open';

function readOpen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** How many captures wait in the Inbox (the side bar's count and the rail's dot read the same hook). */
/** Waiting captures, unknown until read (9.2 uplift F101): null is "not known", never a zero from an error.
 *  A failed read tries again quietly; the last-known count stays meanwhile. */
export function useInboxCount(): number | null {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const vault = useApp((s) => s.vault?.path);
  const tick = useLifeTick();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!vault) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void window.nv.life.inbox.list().then(
        (r) => live && setCount(r.items.length),
        () => {
          if (live) retry = setTimeout(load, 30000);
        },
      );
    const t = setTimeout(load, 400);
    return () => {
      live = false;
      clearTimeout(t);
      clearTimeout(retry);
    };
  }, [revision, filesRevision, tick, vault]);
  return count;
}

export function InboxPlace({ current }: { current: boolean }) {
  const count = useInboxCount();
  return (
    <button className={`place la-inbox${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => openInbox()} title="Everything captured without a place, waiting to be filed">
      <Icon name="inbox" size={15} />
      <span>Inbox</span>
      {count !== null && count > 0 && (
        <span className="la-badge" aria-label={`${count} waiting`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function AreasPlaces() {
  const config = useAreas();
  const counts = useAreaCounts();
  const canEdit = useApp((s) => s.canEdit);
  const ws = useWorkspace();
  const tab = activeTab(ws);
  const here = areaOfTab(tab);
  const hereKind = here !== undefined ? kindOfTab(tab) : undefined;
  const [open, setOpen] = useState<string[]>(readOpen);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = o.includes(id) ? o.filter((x) => x !== id) : [...o, id];
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Kept while the window is open.
      }
      return next;
    });

  // No promo card on a working screen (29 Oct 2026, REDESIGN Job A): the offer lives in Settings and in More.
  if (!config) return null;

  const none = counts.get('')?.total ?? 0;
  const areas = config.areas.filter((a) => !a.hidden);
  return (
    <div className="calm-kinds la-areas" role="group" aria-labelledby="la-areas-title">
      <div className="calm-kinds-head">
        <span id="la-areas-title">Areas</span>
        <button className="calm-kinds-add" title="Areas of life: add, rename, reorder" aria-label="Manage areas" aria-haspopup="menu" onClick={(e) => openMenu(e.currentTarget, [{ label: 'Manage areas…', icon: 'settings', run: () => openLife({ kind: 'areas' }) }, { label: 'Move things into areas…', icon: 'layers', disabled: !canEdit, run: () => openLife({ kind: 'migration' }) }])}>
          <Icon name="more" size={14} />
        </button>
      </div>
      <nav className="places-list" aria-label="Areas of life">
        {areas.map((a) => {
          const c = counts.get(a.id);
          const isOpen = open.includes(a.id);
          return (
            <div key={a.id} className={`la-area-wrap nt-${a.color}`}>
              <div className={`place calm-kind la-area${here === a.id ? ' is-current' : ''}`}>
                <button type="button" className="la-chevron" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} what ${a.name} holds`} onClick={() => toggle(a.id)}>
                  <Icon name="chevron" size={10} className={isOpen ? 'is-open' : ''} />
                </button>
                <button className="calm-kind-open" aria-current={here === a.id ? 'page' : undefined} onClick={() => openArea(a.id, hereKind && here === a.id ? hereKind : 'projects')} title={`${a.name}${a.about ? `: ${a.about}` : ''}`}>
                  <Icon name={a.icon as IconName} size={15} />
                  <span className="calm-kind-name">{a.name}</span>
                  {a.quiet && <Icon name="eye" size={11} className="la-quiet" />}
                  {c && c.total > 0 && (
                    <span className="la-badge" aria-label={`${c.total} in ${a.name}`}>
                      {c.total}
                    </span>
                  )}
                </button>
              </div>
              {isOpen && (
                <div className="la-kinds" role="group" aria-label={`${a.name}: what it holds`}>
                  {AREA_KINDS.map((k) => (
                    <button key={k} type="button" className={`place la-kind${here === a.id && hereKind === k ? ' is-current' : ''}${!c?.[k] ? ' is-empty' : ''}`} onClick={() => openArea(a.id, k)}>
                      <Icon name={KIND_ICONS[k]} size={13} />
                      <span>{KIND_WORDS[k]}</span>
                      {!!c?.[k] && (
                        <span className="la-badge" aria-label={`${c[k]} ${KIND_WORDS[k].toLowerCase()} in ${a.name}`}>
                          {c[k]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {none > 0 && (
          <button type="button" className={`place la-none${here === '' ? ' is-current' : ''}`} onClick={() => openArea('', 'notes')} title="Things not in an area yet">
            <Icon name="help" size={14} />
            <span>Not in an area</span>
          </button>
        )}
      </nav>
    </div>
  );
}
