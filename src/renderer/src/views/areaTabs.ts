// An area tab's title and icon (5 Nov 2026 speed audit item 7: split from AreaPage so the tab strip can
// title area tabs without loading the page).
import type { Area } from '../../../shared/areas';
import type { IconName } from '../components/Icon';
import { areaOfTab, getAreas } from '../state/areas';
import type * as W from '../state/workspace';

export const NO_AREA: Area = { id: '', name: 'Not in an area', folder: '', icon: 'layers', color: 'stone', about: 'Things not in an area yet' };

function areaFor(tab: W.TabState): Area | undefined {
  const id = areaOfTab(tab);
  if (id === '') return NO_AREA;
  return getAreas()?.areas.find((a) => a.id === id);
}
export const areaTitle = (tab: W.TabState): string => areaFor(tab)?.name ?? 'Area';
export const areaIcon = (tab: W.TabState): IconName => (areaFor(tab)?.icon as IconName) ?? 'layers';
