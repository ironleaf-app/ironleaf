// The calm left side's list of what is in the vault, by kind (Ironleaf Calm, 20 Oct 2026): the note types
// (state/noteTypes.ts: Note, Project, Doc, Person, Meeting, Resource, Idea and the person's own), each with how many
// there are, opening its page, "+" making a new one of it; then saved Views when there are any (the person made them to
// come back to). Dragging a type puts the types in that order, the same order Settings › Note types shows.

import { useMemo } from 'react';
import { shows } from '../../../shared/prefs';
import { moveType, resolveTypes } from '../../../shared/note-types';
import type { IconName } from '../components/Icon';
import { changeTypes, newNoteOfType, openTypePage, typeOfTab, useNoteTypes } from './noteTypes';
import { useWorkspace } from './layout';
import { useApp, usePrefs } from './store';
import { activeTab } from './workspace';

/** One kind of thing on the calm left side. */
export interface ShellType {
  id: string;
  icon: IconName;
  /** Its colour (styles/types.css nt-<colour>): the icon in the side bar is drawn in it. */
  color?: string;
  /** Its name as a heading: Projects, Docs, Notes… */
  plural: string;
  count: number;
  /** Its page is the one on show. */
  current: boolean;
  /** Opens its page. */
  open(): void;
  /** Makes a new one of it, when that can be done from the list. */
  add?: { label: string; run(): void };
}

// Polish round 2 (29 Oct 2026, ITEMS 1): every kind listed here opens its own page (openTypePage), never the
// Files panel. Kinds with no page of their own (Views, Canvases and the like) are not listed under Your notes
// at all: they stay under More and in Search. The Files panel opens only from More › Files or from a note's
// "Show in the file list".

/** The kinds of thing in the vault, in the person's order, for the calm left side. */
export function useShellTypes(): ShellType[] {
  const types = useNoteTypes();
  const canEdit = useApp((s) => s.canEdit);
  const prefs = usePrefs();
  const ws = useWorkspace();
  const tab = activeTab(ws);
  // Projects switched off among the places (Settings › Appearance › Interface) stays off here; its projects are still
  // in Files.
  const projectsOff = !shows(prefs, 'ribbon:projects');
  const openType = typeOfTab(tab);
  return useMemo(() => {
    // Only kinds with a page of their own are listed (Polish round 2, ITEMS 1): no Views entry is added here.
    const list: ShellType[] = types
      // A module's record types are on the left side under Modules (its page), not among the kinds of note.
      .filter((t) => !(projectsOff && t.id === 'project') && !t.module)
      .map((t) => ({
        id: t.id,
        icon: t.icon as IconName,
        color: t.color,
        plural: t.plural,
        count: t.count,
        current: openType === t.id || (t.id === 'project' && tab.type === 'projects'),
        open: () => openTypePage(t.id),
        add: canEdit ? { label: `New ${t.name.toLowerCase()}`, run: () => void newNoteOfType(t.id) } : undefined,
      }));
    return list;
    // canEdit: what can be added follows the licence.
  }, [types, openType, tab.type, canEdit, projectsOff]);
}

/** A type dragged before or after another: the types' own order (Settings › Note types) follows. */
export function moveShellType(moving: string, target: string, after: boolean): void {
  if (moving === 'views' || target === 'views' || moving === target) return;
  void changeTypes((config, ctx) => {
    const order = resolveTypes(config, ctx).map((t) => t.id);
    const from = order.indexOf(moving), to = order.indexOf(target);
    if (from < 0 || to < 0) return config;
    let dest = after ? to + 1 : to;
    if (from < dest) dest -= 1;
    return dest === from ? config : moveType(config, ctx, moving, dest - from);
  }).catch(() => {});
}
