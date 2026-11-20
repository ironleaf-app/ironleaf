// The relations seam, the main side (10.0 Endless Tech, b1links: links between notes stay right whoever writes them).
// Every note write lands here after it lands (src/main/app.ts noteWritten and the create doors): the changed relation
// properties are planned through the shared planner (src/shared/relation-links.ts) and the back-links written back
// through the guarded write, so the side chat, agents, imports, the bot, views and note Properties all keep the other
// side in sync the same way. Pure planning plus a host-injected applier, so the tests drive it on fakes.

import { readProps } from '../shared/frontmatter';
import { bracketTargets, diffRelationProps, planRelationSync, relationTargets, resolveRelation, unlinkPathFromProps, type LinkedNote, type RelationWrite, type UnlinkWrite } from '../shared/relation-links';
import type { SyncedBacklink } from '../shared/types';
import { setNoteProp } from '../shared/views';

export interface SyncNotes {
  notes: readonly LinkedNote[];
  propsOf(path: string): Record<string, unknown>;
}

/** The back-writes a save needs: each changed relation key planned through the shared planner. Pure. */
export function planSyncAfterWrite(source: LinkedNote, beforeText: string, afterText: string, by: SyncNotes): RelationWrite[] {
  const out: RelationWrite[] = [];
  for (const { key, before, after } of diffRelationProps(readProps(beforeText), readProps(afterText))) {
    const was = resolveRelation(relationTargets(before), by.notes);
    const now = resolveRelation(relationTargets(after), by.notes);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const explicit = resolveRelation(bracketTargets(after), by.notes);
    out.push(...planRelationSync({ source, key, before: was, after: now, explicit, propsOf: by.propsOf, notes: by.notes }));
  }
  return out;
}

/** A trashed note's links taken out of every other note's properties (body links stay for the tidy to offer). Pure. */
export function planUnlinkForTrash(trashed: readonly string[], notes: readonly LinkedNote[], propsOf: (path: string) => Record<string, unknown>): { path: string; writes: UnlinkWrite[] }[] {
  const gone = new Set(trashed);
  const out: { path: string; writes: UnlinkWrite[] }[] = [];
  for (const n of notes) {
    if (gone.has(n.path)) continue;
    const props = propsOf(n.path);
    const writes = trashed.flatMap((t) => unlinkPathFromProps(props, t, notes));
    if (writes.length) out.push({ path: n.path, writes });
  }
  return out;
}

/** Back-writes never land in a template (20 Nov 2026: an import rewrote the relation properties of templates it
 *  brought in): the templates folder, whatever the vault calls it, and any note whose type is template. A template's
 *  own relation properties are placeholders, so a save of one plans nothing either. Pure. */
export function withoutTemplates(writes: readonly RelationWrite[], isTemplate: (path: string) => boolean): RelationWrite[] {
  return writes.filter((w) => !isTemplate(w.path));
}

/** Whether a note is a template: in the templates folder (any case), or `type: template`. Pure. */
export function templateNote(path: string, templatesFolder: string | undefined, props: Record<string, unknown> | undefined): boolean {
  const dir = (templatesFolder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (dir && path.toLowerCase().startsWith(`${dir}/`)) return true;
  const type = props?.type;
  const first = Array.isArray(type) ? type[0] : type;
  return typeof first === 'string' && /^templates?$/i.test(first.trim());
}

export interface SyncHost {
  /** Fresh text, or null when the note is gone (a back-link never recreates a note). */
  read(path: string): Promise<string | null>;
  /** The guarded write; false when it did not land (changed mid-save, gone, unreadable properties). */
  write(path: string, text: string): Promise<boolean>;
}

/** Back-writes applied: each note read fresh, its property and kind sibling set, written once. */
export async function applyRelationWrites(writes: readonly RelationWrite[], host: SyncHost): Promise<{ synced: SyncedBacklink[]; missed: number }> {
  let missed = 0;
  const synced: SyncedBacklink[] = [];
  for (const w of writes) {
    const text = await host.read(w.path);
    if (text === null) {
      missed++;
      continue;
    }
    let next: string;
    try {
      next = setNoteProp(text, w.key, w.value);
      if (w.kindKey !== undefined) next = setNoteProp(next, w.kindKey, w.kindValue ?? null);
    } catch {
      missed++;
      continue;
    }
    if (next !== text && !(await host.write(w.path, next))) {
      missed++;
      continue;
    }
    synced.push({ path: w.path, key: w.key });
  }
  return { synced, missed };
}

// A back-write landing re-enters the seam (it is a write too): its echo plans nothing, because the note it would write
// back already links it — the planner is a fixpoint (applying it twice is applying it once), so no guard is needed and
// none may skip a real save's sync under concurrent writes.
