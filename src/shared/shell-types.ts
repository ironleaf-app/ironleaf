// The kinds of thing in a vault as the calm left side lists them (Ironleaf Calm, 20 Oct 2026): each with its plural
// name and how many there are, in the person's own order. Until note types arrive (state/noteTypes.ts on calm/types),
// the kinds are today's sections of the file list (src/shared/navigator.ts), so the order someone dragged their
// sections into is the order of this list too (the same saved keys). A pure function of the sections and a few choices,
// shared by the window and the tests.

import { inOrder, moveKey, SECTION_ORDER, SECTION_WORDS, type NavSections, type SectionId } from './navigator';

export interface SectionKind {
  id: SectionId;
  /** Its name as a heading: Projects, Docs, Notes… */
  plural: string;
  count: number;
}

export interface SectionKindChoices {
  /** The order of the person's own (the file list's `sections` order, shared/navigator.ts inOrder). */
  order?: string[];
  /** Attachments are listed only when the person asked to see them (the file list's Show attachments). */
  showAttachments?: boolean;
  /** Kinds the person switched off (Settings › Appearance › Interface). */
  hidden?: SectionId[];
}

/** Whether a section is listed: an empty one isn't, except Projects and Notes, which a fresh vault starts from (Projects
 *  has its own page, with the way to set up the first one). */
export function sectionHasAny(sections: NavSections, id: SectionId): boolean {
  if (id === 'notes' || id === 'projects') return true;
  if (id === 'daily') return !!sections.daily.today || sections.daily.months.length > 0;
  return sections.counts[id] > 0;
}

/** The kinds shown, in the person's order. */
export function sectionKinds(sections: NavSections, choices: SectionKindChoices = {}): SectionKind[] {
  const hidden = new Set(choices.hidden ?? []);
  return inOrder(SECTION_ORDER, choices.order, (s) => s)
    .filter((id) => !hidden.has(id) && (id !== 'attachments' || choices.showAttachments) && sectionHasAny(sections, id))
    .map((id) => ({ id, plural: SECTION_WORDS[id], count: sections.counts[id] }));
}

/**
 * The saved order after a kind is dragged before or after another. Every section is kept in it (shown or not), so a
 * kind that shows later (the first doc written) comes back where it was.
 */
export function movedKinds(saved: string[] | undefined, moving: string, target: string, after: boolean): string[] {
  return moveKey(inOrder(SECTION_ORDER, saved, (s) => s), moving, target, after);
}
