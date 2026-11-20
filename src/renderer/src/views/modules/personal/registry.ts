// Home, Vehicles, Career and Travel's pages and their parts of Today (Wave 7 part a), by module id, for the modules'
// registry (views/modules/registry.ts).

import type { ComponentType } from 'react';
import type * as W from '../../../state/workspace';
import { CareerPage, CareerToday } from './CareerPage';
import { HousePage, HouseToday } from './HousePage';
import { TravelPage, TravelToday } from './TravelPage';
import { VehiclesPage, VehiclesToday } from './VehiclesPage';

export const PERSONAL_PAGES: Record<string, ComponentType<{ tab: W.TabState }>> = { house: HousePage, vehicles: VehiclesPage, career: CareerPage, travel: TravelPage };
export const PERSONAL_TODAY: Record<string, ComponentType> = { house: HouseToday, vehicles: VehiclesToday, career: CareerToday, travel: TravelToday };
