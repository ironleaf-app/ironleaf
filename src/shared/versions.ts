// Who made each earlier version of a note (19 Oct 2026, 5.0.0: version history that credits each edit). Recorded the
// moment File recovery keeps a copy (src/main/recovery.ts), as a short word; shown in the earlier versions' view as the
// person reads it. Copies kept before 5.0.0 have none and say "Earlier edit".

/** Who changed a note: the person, their restoring an earlier version, the vault assistant, the former host app (work handed
 *  over), an automation, an AI agent (by its name when known), a sync service (by its name), or something else outside. */
export type VersionAuthor = 'you' | 'restored' | 'assistant' | 'neuralspark' | 'automation' | 'agent' | `agent:${string}` | 'outside' | `sync:${string}`;

/** An author as kept: a known word, or a name (an agent's, a sync service's) that is plain words only. */
export function cleanAuthor(by: unknown): VersionAuthor | undefined {
  if (typeof by !== 'string' || by.length > 90) return undefined;
  if (['you', 'restored', 'assistant', 'neuralspark', 'automation', 'agent', 'outside'].includes(by)) return by as VersionAuthor;
  const named = /^(agent|sync):([\p{L}\p{N} ()&'’.,–-]{1,80})$/u.exec(by);
  return named ? (`${named[1]}:${named[2].trim()}` as VersionAuthor) : undefined;
}

/** Who made a version, in the words the earlier versions' view shows. */
export function authorWords(by: string | undefined): string {
  const clean = cleanAuthor(by);
  if (!clean) return 'Earlier edit';
  if (clean.startsWith('agent:')) return clean.slice(6);
  if (clean.startsWith('sync:')) return `Sync (${clean.slice(5)})`;
  switch (clean) {
    case 'you':
      return 'You';
    case 'restored':
      return 'You, bringing back an earlier version';
    case 'assistant':
      return 'Ironleaf’s assistant';
    case 'neuralspark':
      return 'Another app';
    case 'automation':
      return 'An automation';
    case 'agent':
      return 'An AI agent';
    case 'outside':
      return 'Changed outside Ironleaf';
    default:
      return 'Earlier edit';
  }
}
