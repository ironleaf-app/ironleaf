// Which template a TemplateInfo is, by identity (9.2 uplift F2): the daily-note template is the built-in
// still where Ironleaf put it, or the vault's chosen daily template (the main side marks exactly that one
// with DAILY_USED_FOR). Never a word match on the person's own text: a template about today's meeting is a
// template, not today's note. Pure, so tests pin it directly. (The lasting fix is a `daily: true` flag on
// TemplateInfo from the shared side; until then the exact machine-written sentence below is the identity.)

import type { TemplateInfo } from '../../../shared/templates';

/** The exact sentence the main side writes on the vault's daily template (shared/templates.ts templateUsedFor). */
export const DAILY_USED_FOR = 'Used for today’s note (Ctrl+Shift+D)';

/** Whether the template IS today's note (open it) rather than a template to make from. */
export function isDailyTemplate(t: Pick<TemplateInfo, 'builtIn' | 'usedFor'>): boolean {
  return t.builtIn === 'daily-note' || t.usedFor === DAILY_USED_FOR;
}
