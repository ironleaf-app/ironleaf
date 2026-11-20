// Every life module's page and its part of Today (Wave 5, 24 Oct 2026; src/shared/life-modules.ts). One line per module
// here is all the shell needs: the tab's page ("module:<id>#<part>"), its title and icon come from the catalogue, and
// Today's section shows what each module that is on puts there. A module without a page yet says so on its tab.

import { createElement, Fragment, type ComponentType } from 'react';
import { moduleInfo, moduleOn } from '../../../../shared/life-modules';
import { EmptyState } from '../../components/EmptyState';
import type { IconName } from '../../components/Icon';
import { moduleOfTab, useModules } from '../../state/modules';
import type * as W from '../../state/workspace';
import { FamilyPage } from './FamilyPage';
import { FamilyToday } from './FamilyToday';
import { HealthPage } from './HealthPage';
import { HealthToday } from './HealthToday';
import { DocumentsPage, FinancePage } from './RecordModulePage';
import { DocumentsToday, FinanceToday } from './RecordModulesToday';
import { PERSONAL_PAGES, PERSONAL_TODAY } from './personal/registry';
import { MeetingsPage, MeetingsToday } from './work/MeetingsPage';
import { WeeklyPage, WeeklyToday } from './work/WeeklyPage';
import { SitesPage, SitesToday } from './work/SitesPage';
import { VendorsPage, VendorsToday } from './work/VendorsPage';
import { PublicationsPage } from './PublicationsPage';
import { PublicationsToday } from './PublicationsToday';
import { LIFE_RECORD_PAGES, LIFE_RECORD_TODAY } from './life/registry';
import { ModuleTour } from './ModuleTour';
import { ModuleFills } from '../../state/moduleFills';

export type ModulePageProps = { tab: W.TabState };

/** Each module's page, by its id. */
export const MODULE_PAGES: Record<string, ComponentType<ModulePageProps>> = {
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading, Watching and Lists (Wave 7 part b).
  ...LIFE_RECORD_PAGES,
  health: HealthPage,
  family: FamilyPage,
  finance: FinancePage,
  documents: DocumentsPage,
  // Home, Vehicles, Career and Travel (Wave 7 part a).
  ...PERSONAL_PAGES,
  meetings: MeetingsPage,
  weekly: WeeklyPage,
  sites: SitesPage,
  vendors: VendorsPage,
  publications: PublicationsPage,
};

/** What each module puts on Today (its own rows, or nothing when it has nothing to say), by its id. */
export const TODAY_PARTS: Record<string, ComponentType> = {
  ...LIFE_RECORD_TODAY,
  health: HealthToday,
  family: FamilyToday,
  finance: FinanceToday,
  documents: DocumentsToday,
  ...PERSONAL_TODAY,
  meetings: MeetingsToday,
  weekly: WeeklyToday,
  sites: SitesToday,
  vendors: VendorsToday,
  publications: PublicationsToday,
};

export function ModulePage({ tab }: ModulePageProps) {
  const id = moduleOfTab(tab) ?? '';
  const on = moduleOn(useModules(), id);
  const info = moduleInfo(id);
  const Page = MODULE_PAGES[id];
  if (!info || !on) return createElement(EmptyState, { icon: 'layers', title: info ? `${info.name} is switched off` : 'This module isn’t here', line: info ? 'Switch it on in Settings › Packs. Everything it holds is kept.' : 'It may have been removed.' });
  if (!Page) return createElement(EmptyState, { icon: info.icon as IconName, title: info.name, line: 'Its page is coming in a later version.' });
  // Inside its page: empty places lead with how it fills itself. The pack's tour is mounted with no link (8.7 round 2):
  // its ⋯ menu, the command list and Settings open it (the classic shells keep their own link under the title).
  // The page scrolls in the frame's scroller, as BinView's does (p25 one column: the column's gutters match the
  // vscroll rooms' at every window, and a long page scrolls instead of running past the window's edge). Meetings
  // brings its own scroller: its page renders in two tab kinds (its own tab and its module tab), so one scroller
  // there would nest inside this one.
  const page = createElement(Page, { tab });
  const tour = createElement(ModuleTour, { module: info, link: false });
  const scrolled = id === 'meetings' ? page : createElement('div', { className: 'nv-page-scroll' }, page);
  return createElement(ModuleFills.Provider, { value: { id, name: info.name, fills: info.fills } }, createElement(Fragment, null, scrolled, tour));
}
