// The palette's rows for note types and packs (8 Nov 2026, the quiet More): More's kinds and packs left the
// menu, so Ctrl+K answers to each by its own name. Pure builders over the same lists More read (the visible
// types with their counts, the packs switched on), so the committed test runs the real matcher over the real
// rows without the window.

import type { IconName } from '../components/Icon';

export interface PaletteRow {
  id: string;
  label: string;
  detail?: string;
  icon: IconName;
}

/** One row per note type: its plural, with how many notes are that type (More showed the same count). */
export function typePaletteRows(types: { id: string; plural: string; icon: string; count: number }[]): PaletteRow[] {
  return types.map((t) => ({
    id: `type:${t.id}`,
    label: t.plural,
    detail: t.count === 0 ? 'No notes yet' : `${t.count} ${t.count === 1 ? 'note' : 'notes'}`,
    icon: t.icon as IconName,
  }));
}

/** One row per pack switched on, by its own name (More showed the same rows with their chooser). */
export function packPaletteRows(packs: { id: string; name: string; icon: string }[]): PaletteRow[] {
  return packs.map((m) => ({ id: `pack:${m.id}`, label: m.name, icon: m.icon as IconName }));
}
