// The work modules' agent tools (Wave 6 part b, 24 Oct 2026; the rule for every module: "Agents get tools per module …
// and access per sensitivity level"). Each module's file defines its own (src/shared/work-meetings.ts, weekly-updates.ts,
// work-sites.ts, work-vendors.ts); this list is all of them, offered to the side chat, outside agents, the former host
// app and a chat bot (through src/shared/module-tools.ts) only while their module is on, each carried out through the
// asking agent's gate (src/main/work-modules.ts). Pure: words and schemas only.

import { MEETING_TOOLS } from './work-meetings';
import { WEEKLY_TOOLS } from './weekly-updates';
import { SITE_TOOLS } from './work-sites';
import { VENDOR_TOOLS } from './work-vendors';

export interface WorkToolDef {
  name: string;
  /** Its module (src/shared/work-modules.ts). */
  module: string;
  /** It changes or adds a note (refused unless the asker is allowed the module's level). */
  write: boolean;
  /** A short name ("Meetings coming up"). */
  title: string;
  /** What the side chat, the former host app and a chat bot show while it runs ("Looked through your meetings"). */
  step: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

export const WORK_TOOLS: WorkToolDef[] = [...MEETING_TOOLS, ...WEEKLY_TOOLS, ...SITE_TOOLS, ...VENDOR_TOOLS];
export const WORK_TOOL_NAMES = WORK_TOOLS.map((t) => t.name);
export const isWorkTool = (name: string) => WORK_TOOL_NAMES.includes(name);
