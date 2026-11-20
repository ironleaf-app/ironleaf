// When each template was last used (10.0 papercuts): the Templates page's last-used order. Every door that makes
// something from a template marks it here (a note, a doc, a project, a report), so the order is the same however the
// template was used. Kept on this PC, beside the vault, never in the notes.

import { recordTemplateUsed, type TemplateUsed } from '../../../shared/templates';

const KEY = 'nv-template-used';

/** When each template was last used (paths that no longer exist are left for the page to prune). */
export function readTemplateUsed(): TemplateUsed {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'number')) as TemplateUsed;
  } catch {
    return {};
  }
}

/** One template used now. */
export function markTemplateUsed(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recordTemplateUsed(readTemplateUsed(), path)));
  } catch {
    // Remembering is a convenience.
  }
}
