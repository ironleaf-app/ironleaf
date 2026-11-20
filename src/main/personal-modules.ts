// Home, Vehicles, Career and Travel on the main side (Wave 7 part a, 24 Oct 2026; src/shared/personal-modules.ts). They
// are a group of modules made of notes, so they share every rule of the work modules' machinery (src/main/work-modules.ts:
// switches, places inside their areas, the vault's options, notices said once, files kept beside a record, tools through
// each agent's gate, one window call per job); each module's own work is its part (src/main/personal/<module>.ts), and
// each also files Inbox items into its records (personalInbox). Nothing runs while all four are off.

import type { InboxItem, InboxSuggestion } from '../shared/inbox';
import { PERSONAL_MODULES } from '../shared/personal-modules';
import { PERSONAL_TOOLS } from '../shared/personal-module-tools';
import type { ModuleGroup, WorkModules } from './work-modules';
import type { Filed, PersonalPart } from './personal/common';
import { makeCareer } from './personal/career';
import { makeHouse } from './personal/house';
import { makeTravel } from './personal/travel';
import { makeVehicles } from './personal/vehicles';

export const PERSONAL_GROUP: ModuleGroup = {
  modules: PERSONAL_MODULES,
  tools: PERSONAL_TOOLS,
  parts: (w) => [makeHouse(w), makeVehicles(w), makeCareer(w), makeTravel(w)],
};

/** The Inbox's way into the personal modules: where an item would go in a module that is on (its records named in it),
 *  and filing it there. */
export function personalInbox(w: WorkModules) {
  const parts = () => (w.parts as PersonalPart[]).filter((p) => w.isOn(p.id));
  return {
    async suggestions(item: InboxItem): Promise<InboxSuggestion[]> {
      const out: InboxSuggestion[] = [];
      for (const p of parts()) {
        if (!p.inbox) continue;
        try {
          const s = await p.inbox(item);
          if (s) out.push(s);
        } catch {
          // A module that can't read its notes just now offers nothing.
        }
      }
      return out;
    },
    async file(item: InboxItem, target: { module?: string; path?: string; type?: string; name: string }): Promise<Filed | null> {
      const p = parts().find((x) => x.id === target.module);
      if (!p?.fileInbox) return null;
      return p.fileInbox(item, target);
    },
  };
}
