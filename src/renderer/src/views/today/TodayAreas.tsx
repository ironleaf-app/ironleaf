// Today by area of life (Wave 4, 24 Oct 2026; the plan: "Today and Review across all areas"). A row of the vault's
// areas under Today's greeting: All (every area but the quiet ones, the Library), or one or more areas; this PC
// remembers the choice. Every list on Today follows it, and a template or anything in a quiet area never shows
// unless that area is chosen.

import { useCallback, useMemo } from 'react';
import { countChipAreas, todayChips, wanted } from '../../../../shared/areas';
import { isQuietPath } from '../../../../shared/fewer-folders';
import type { DueView } from '../../../../main/hub';
import type { HubDay } from '../../../../shared/hub';
import { Icon, type IconName } from '../../components/Icon';
import { areaPlaces, setPick, useAreaItems, useAreas, usePick } from '../../state/areas';
import { useApp, usePrefs } from '../../state/store';

/** Whether a note or project is shown on Today with the areas chosen now (never a folder kept out of view). */
export function useTodayKeep(): (path: string) => boolean {
  const config = useAreas();
  const pick = usePick('today');
  const byPath = useApp((s) => s.byPath);
  const quietFolders = usePrefs().quietFolders ?? [];
  return useCallback(
    (path: string) => wanted({ path, props: byPath.get(path)?.props }, config ? pick : 'all', config?.areas ?? [], areaPlaces()) && !isQuietPath(path, { quietFolders }),
    [config, pick, byPath, quietFolders],
  );
}

/** Whether a note or project is shown with the areas chosen now, kept-out folders aside: today's meetings and
 *  anything due today reach through it (8 Nov 2026, item 2). */
export function useTodayKeepArea(): (path: string) => boolean {
  const config = useAreas();
  const pick = usePick('today');
  const byPath = useApp((s) => s.byPath);
  return useCallback((path: string) => wanted({ path, props: byPath.get(path)?.props }, config ? pick : 'all', config?.areas ?? [], areaPlaces()), [config, pick, byPath]);
}

export function dueFor(due: DueView, keep: (path: string) => boolean, keepToday: (path: string) => boolean = keep): DueView {
  const one = (list: DueView['overdue'], k: (path: string) => boolean) => list.filter((e) => k(e.item.path));
  const undated = due.undated.filter((t) => keep(t.path));
  return { ...due, overdue: one(due.overdue, keepToday), today: one(due.today, keepToday), week: one(due.week, keep), later: one(due.later ?? [], keep), undated, undatedCount: Math.max(undated.length, due.undatedCount - (due.undated.length - undated.length)) };
}

export function dayFor(day: HubDay, keep: (path: string) => boolean, keepToday: (path: string) => boolean = keep): HubDay {
  const made = day.made.filter((n) => keep(n.path));
  const changed = day.changed.filter((n) => keep(n.path));
  const linked = day.linked.filter((n) => keep(n.path));
  const saved = day.saved.filter((n) => keep(n.path));
  return { ...day, meetings: day.meetings.filter((m) => keepToday(m.path)), made, changed, linked, saved, counts: { made: made.length, changed: changed.length, linked: linked.length, saved: saved.length } };
}

export function TodayAreas() {
  const config = useAreas();
  const pick = usePick('today');
  const items = useAreaItems();
  const prefs = usePrefs();
  const counts = useMemo(() => countChipAreas(items, config?.areas ?? [], areaPlaces()), [config, items, prefs]);
  if (!config) return null;
  // Only the areas that hold something chip (8 Nov 2026, calm Today): an area with no folder and nothing
  // in it is no choice. All areas stays, so a choice left on an emptied area is one click off.
  const shown = todayChips(config.areas, counts);
  const on = (id: string) => pick !== 'all' && pick.includes(id);
  const toggle = (id: string, many: boolean) => {
    if (pick === 'all' || !many) return setPick('today', pick !== 'all' && pick.length === 1 && pick[0] === id ? 'all' : [id]);
    const next = pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id];
    setPick('today', next.length ? next : 'all');
  };
  return (
    <div className="td-areas" role="group" aria-label="Show Today for">
      <button type="button" className={pick === 'all' ? 'on' : ''} aria-pressed={pick === 'all'} onClick={() => setPick('today', 'all')} title="Every area (the Library stays out)">
        All areas
      </button>
      {shown.map((a) => (
        <button key={a.id} type="button" className={`nt-${a.color}${on(a.id) ? ' on' : ''}${a.quiet ? ' is-quiet' : ''}`} aria-pressed={on(a.id)} onClick={(e) => toggle(a.id, e.ctrlKey || e.metaKey || e.shiftKey)} title={`${a.name} only (Ctrl+click to add it to those shown)`}>
          <Icon name={a.icon as IconName} size={12} />
          {a.name}
        </button>
      ))}
    </div>
  );
}
