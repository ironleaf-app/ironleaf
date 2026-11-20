// The personal modules' agent tools (Wave 7 part a, 24 Oct 2026; the rule for every module: "Agents get tools per module
// (e.g. … career_application_add) and access per sensitivity level"). Each module's file defines its own
// (src/shared/house.ts, vehicles.ts, career.ts, travel.ts); this list is all of them, offered to the side chat, outside
// agents, the former host app and a chat bot (through src/shared/module-tools.ts) only while their module is on, each
// carried out through the asking agent's gate (src/main/personal-modules.ts, on the work modules' machinery). Pure: words
// and schemas only.

import type { WorkToolDef } from './work-module-tools';
import { HOUSE_TOOLS } from './house';
import { VEHICLE_TOOLS } from './vehicles';
import { CAREER_TOOLS } from './career';
import { TRAVEL_TOOLS } from './travel';

export const PERSONAL_TOOLS: WorkToolDef[] = [...HOUSE_TOOLS, ...VEHICLE_TOOLS, ...CAREER_TOOLS, ...TRAVEL_TOOLS];
export const PERSONAL_TOOL_NAMES = PERSONAL_TOOLS.map((t) => t.name);
