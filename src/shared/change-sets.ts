// One change set: several proposed edits reviewed once, even after a restart (10.0 Endless Tech, v2changes: 2 Nov
// 2026). When the side chat, the former host app or the bot proposes several edits, they wait here as ONE set: each
// file with its words before and after, Accept all, Accept this, Reject. Kept on disk per library
// (src/main/change-sets.ts); this file is the one shape both sides and the tests share.

import type { VersionAuthor } from './versions';

/** One file in a set: its words before and after, what changed in words, and what became of it. */
export interface ChangeSetEntry {
  id: string;
  path: string;
  /** The file's name as the person says it. */
  name: string;
  /** Its words when proposed, or null when it is a new file. */
  base: string | null;
  after: string;
  changes: string[];
  state: 'waiting' | 'accepted' | 'rejected' | 'stale';
}

export interface ChangeSet {
  id: string;
  /** When it was proposed (ms). */
  at: number;
  /** Who proposed it, in words: 'The side chat', 'the former host app', a bot's name. */
  askedBy: string;
  /** Who the accepted writes are credited to in earlier versions (kept with the set, so a restart keeps it). */
  by?: VersionAuthor;
  /** The ask, in the person's words (trimmed short). */
  askWords: string;
  entries: ChangeSetEntry[];
}

/** A set as the list shows it: every file's state, without the before/after bodies (the review reads those). */
export interface ChangeSetSummary {
  id: string;
  at: number;
  askedBy: string;
  askWords: string;
  waiting: number;
  accepted: number;
  rejected: number;
  stale: number;
  files: { id: string; path: string; name: string; changes: string[]; state: ChangeSetEntry['state'] }[];
}

export const changeSetSummary = (s: ChangeSet): ChangeSetSummary => ({
  id: s.id,
  at: s.at,
  askedBy: s.askedBy,
  askWords: s.askWords,
  waiting: s.entries.filter((e) => e.state === 'waiting').length,
  accepted: s.entries.filter((e) => e.state === 'accepted').length,
  rejected: s.entries.filter((e) => e.state === 'rejected').length,
  stale: s.entries.filter((e) => e.state === 'stale').length,
  files: s.entries.map((e) => ({ id: e.id, path: e.path, name: e.name, changes: e.changes, state: e.state })),
});

/** Nothing left to decide in the set. */
export const isSettled = (s: ChangeSet): boolean => s.entries.every((e) => e.state !== 'waiting');

/** How an ask reads on the card: the person's words, or what proposed it when they said nothing. */
export const setAskWords = (s: Pick<ChangeSet, 'askedBy' | 'askWords'>): string => s.askWords || `Changes from ${s.askedBy}`;

/** '3 files', '1 file'. */
export const setFilesWords = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

/** What accepting did, in one line: what landed, and what was left because it changed since. */
export function acceptWords(accepted: string[], stale: string[]): string {
  const names = (ps: string[]) => ps.map((p) => `“${p}”`).join(', ');
  if (accepted.length && !stale.length) return accepted.length === 1 ? `Updated ${names(accepted)}.` : `Updated ${accepted.length} files.`;
  if (!accepted.length && stale.length) return stale.length === 1 ? `${names(stale)} changed since this was proposed, so it was left as it is.` : `${stale.length} files changed since this was proposed, so they were left as they are. Ask again to catch them up.`;
  return `Updated ${accepted.length === 1 ? names(accepted) : `${accepted.length} files`}. ${stale.length === 1 ? `${names(stale)} changed since, so it was left as it is.` : `${stale.length} changed since, so they were left as they are.`}`;
}

/** What rejecting did: nothing was written, and the files are named so it reads as undone, not lost. */
export const rejectWords = (names: string[]): string => (names.length === 1 ? `Left ${names[0]} as it is. Nothing was changed.` : `Left ${names.length} files as they are. Nothing was changed.`);

/** A file that changed since it was proposed: why accepting left it alone. */
export const staleWords = (name: string): string => `${name} changed since this was proposed, so it was left as it is. Ask again to catch it up.`;
