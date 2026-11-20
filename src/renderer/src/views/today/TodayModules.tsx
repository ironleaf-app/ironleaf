// The life modules on Today (Wave 5, 24 Oct 2026; the rule: "Today pulls from every module, not just projects: bills
// due, kids' events, the paper, deadlines, check-ins"). Each module that is on puts its own rows here (a check-in due,
// an appointment, who's where today), from views/modules/registry.ts; a module off, or an area of life not chosen in
// Today's row, shows nothing. Grouped for the calm list's order (8 Nov 2026): due today first (bills, editions), then
// waiting (meetings), then upkeep (systems); everything else follows in the catalogue's order.

import { modulesOn } from '../../../../shared/life-modules';
import { useModules } from '../../state/modules';
import { useAreas, usePick } from '../../state/areas';
import { TODAY_PARTS } from '../modules/registry';

export type TodayGroup = 'due' | 'waiting' | 'upkeep' | 'rest';

const GROUP_OF: Record<string, Exclude<TodayGroup, 'rest'>> = {
  finance: 'due',
  publications: 'due',
  meetings: 'waiting',
  systems: 'upkeep',
};

export function TodayModules({ group }: { group: TodayGroup }) {
  const on = modulesOn(useModules());
  const config = useAreas();
  const pick = usePick('today');
  const shown = on.filter((m) => TODAY_PARTS[m.id] && (!config || pick === 'all' || pick.includes(m.area)) && (group === 'rest' ? !GROUP_OF[m.id] : GROUP_OF[m.id] === group));
  // "Switch on a pack" offers never show on Today (8 Nov 2026, calm Today): they belong in Settings › Packs.
  if (!shown.length) return null;
  return (
    <div className="tm-modules">
      {shown.map((m) => {
        const Part = TODAY_PARTS[m.id];
        return <Part key={m.id} />;
      })}
    </div>
  );
}
