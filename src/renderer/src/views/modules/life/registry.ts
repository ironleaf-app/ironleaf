// The Wave 7 part b modules' pages and their parts of Today (Business, Systems and Home Lab, Goals and Habits,
// Reading, Watching and Lists), joined into the shell's registry (../registry.ts) in one line each. Memories and
// Media's albums answer under Family now (packs uplift item 5): its page and Today card are Family's.

import type { ComponentType } from 'react';
import type * as W from '../../../state/workspace';
import { BusinessPage, BusinessToday } from './BusinessPage';
import { GoalsPage, GoalsToday } from './GoalsPage';
import { ListsPage, ListsToday } from './ListsPage';
import { SystemsPage, SystemsToday } from './SystemsPage';

export const LIFE_RECORD_PAGES: Record<string, ComponentType<{ tab: W.TabState }>> = {
  business: BusinessPage,
  systems: SystemsPage,
  goals: GoalsPage,
  lists: ListsPage,
};

export const LIFE_RECORD_TODAY: Record<string, ComponentType> = {
  business: BusinessToday,
  systems: SystemsToday,
  goals: GoalsToday,
  lists: ListsToday,
};
