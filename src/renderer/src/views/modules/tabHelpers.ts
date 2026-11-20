// A module tab's title and icon (5 Nov 2026 speed audit item 7: split from the modules registry so the tab
// strip can title module tabs without loading every module's pages).
import { moduleInfo } from '../../../../shared/life-modules';
import type { IconName } from '../../components/Icon';
import { moduleOfTab } from '../../state/module-tabs';
import type * as W from '../../state/workspace';

export function moduleTitle(tab: W.TabState): string {
  return moduleInfo(moduleOfTab(tab) ?? '')?.name ?? 'Module';
}
export function moduleIcon(tab: W.TabState): IconName {
  return (moduleInfo(moduleOfTab(tab) ?? '')?.icon ?? 'layers') as IconName;
}
