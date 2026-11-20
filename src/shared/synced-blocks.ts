// Synced blocks (31 Oct 2026, 8.8 database depth): one block of text shown in several notes, edited anywhere,
// changed everywhere. The block is stored once in its own note under Synced blocks/; each use is a plain ![[embed]]
// of it, so files stay plain Markdown and other apps read the reference as the embed it is. The editor draws the live
// block with "Edit the original" and "Unsync here" (editor/widgets.ts). Pure: resolving, naming and unsyncing here.

import { normalizeTarget } from './markdown';

/** The folder synced blocks are kept in. */
export const SYNCED_FOLDER = 'Synced blocks';

/** Whether a path is a synced block's own note. */
export function isSyncedPath(path: string | undefined): boolean {
  return !!path && path.toLowerCase().startsWith(`${SYNCED_FOLDER.toLowerCase()}/`) && /\.md$/i.test(path);
}

/** The reference that places a synced block: ![[Synced blocks/<name>]]. */
export function syncRefFor(path: string): string {
  return `![[${path.replace(/\.md$/i, '')}]]`;
}

/**
 * The synced block a reference names (by its path or its title), or null when it names no synced block — an
 * ordinary note, even embedded, is never a synced block.
 */
export function syncedPathOf(target: string, notes: readonly { path: string; title: string }[]): string | null {
  const want = normalizeTarget(target.trim());
  if (!want) return null;
  const hit =
    notes.find((n) => isSyncedPath(n.path) && normalizeTarget(n.path) === want) ??
    notes.find((n) => isSyncedPath(n.path) && n.title.trim().toLowerCase() === target.trim().toLowerCase());
  return hit ? hit.path : null;
}

/** A new synced block's file: its words exactly, ending with a new line. */
export function makeSyncedFile(_name: string, body: string): string {
  return body.replace(/\s+$/, '') ? `${body.replace(/\s+$/, '')}\n` : '\n';
}

/** A file name for words made into a synced block: the first line's words, without their Markdown. */
export function nameFromText(text: string): string {
  const first = text
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/[*_`~]/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim())
    .find(Boolean);
  return (first ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Synced block';
}

/**
 * The note with one synced-block embed put back as its block's words ("Unsync here"), or null when the note has no
 * such embed. Only the first matching embed is replaced; the block's own file is untouched.
 */
export function unsyncRef(noteText: string, target: string, blockText: string): string | null {
  const want = target.trim().toLowerCase();
  const re = /!\[\[([^[\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noteText))) {
    const inner = m[1].split('|')[0].split('#')[0].trim().toLowerCase();
    const bare = inner.replace(/\.md$/i, '');
    if (inner === want || bare === want || bare === `${SYNCED_FOLDER.toLowerCase()}/${want}` || inner === `${SYNCED_FOLDER.toLowerCase()}/${want}`) {
      return `${noteText.slice(0, m.index)}${blockText.replace(/\s+$/, '')}${noteText.slice(m.index + m[0].length)}`;
    }
  }
  return null;
}
