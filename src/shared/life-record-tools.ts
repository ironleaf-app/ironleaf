// The Wave 7 part b modules' agent tools (Memories and Media, Business, Systems and Home Lab, Goals and Habits, Reading,
// Watching and Lists). Each module's file defines its own; this list is all of them, offered to the side chat, outside
// agents, the former host app and a chat bot (through src/shared/module-tools.ts) only while their module is on, each
// carried out through the asking agent's gate (src/main/life-records.ts). Pure: words and schemas only.

import type { WorkToolDef } from './work-module-tools';
import { BUSINESS_TOOLS } from './business';
import { GOAL_TOOLS } from './goals';
import { LIST_TOOLS } from './lists';
import { MEMORY_TOOLS } from './memories';
import { SYSTEM_TOOLS } from './systems';

export const LIFE_RECORD_TOOLS: WorkToolDef[] = [...MEMORY_TOOLS, ...BUSINESS_TOOLS, ...SYSTEM_TOOLS, ...GOAL_TOOLS, ...LIST_TOOLS];
export const LIFE_RECORD_TOOL_NAMES = LIFE_RECORD_TOOLS.map((t) => t.name);
