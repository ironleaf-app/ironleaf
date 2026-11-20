// The Wave 7 part b modules on the main side (src/shared/life-records.ts): Memories and Media, Business, Systems and Home
// Lab, Goals and Habits, and Reading, Watching and Lists. They are a group of modules made of notes, so they share every
// rule of the work modules' machinery (src/main/work-modules.ts: switches, places inside their areas, the vault's
// options, notices said once, files kept beside a record, tools through each agent's gate, one window call per job);
// each module's own work is its part (src/main/life-records/<module>.ts). Nothing runs while all five are off.

import { LIFE_RECORD_MODULES } from '../shared/life-records';
import { LIFE_RECORD_TOOLS } from '../shared/life-record-tools';
import type { ModuleGroup } from './work-modules';
import { makeBusiness } from './life-records/business';
import { makeGoals } from './life-records/goals';
import { makeLists } from './life-records/lists';
import { makeMemories } from './life-records/memories';
import { makeSystems } from './life-records/systems';

export const LIFE_RECORDS_GROUP: ModuleGroup = {
  modules: LIFE_RECORD_MODULES,
  tools: LIFE_RECORD_TOOLS,
  parts: (w) => [makeMemories(w), makeBusiness(w), makeSystems(w), makeGoals(w), makeLists(w)],
};
