/** The quiet More's alias rule (t28 follow-up, 8 Nov 2026: "an alias's use counts as its
 *  survivor's use" in "used lately", and its keys "show under the survivor in Settings › Keys, so they can be
 *  changed there"). One rule for the recents and the keys list, kept pure so the tests run it for real: a person
 *  who uses the old name sees the survivor in recents, and a key that fires — an alias's own, default or the
 *  person's — is always changeable under the survivor. Aliases without keys earn no row: the lists stay quiet. */
export interface AliasedCommand {
  id: string;
  aliasOf?: string;
  hotkey?: string;
}

/** The id "used lately" means: an alias counts as its survivor. Survivors and unknown ids pass through. */
export function survivorId(id: string, commands: readonly AliasedCommand[]): string {
  return commands.find((c) => c.id === id)?.aliasOf ?? id;
}

/** A use recorded: the id first, once, at most eight remembered. */
export function withRecentUsed(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, 8);
}

/** Stored ids as the nothing-typed list reads them: every alias as its survivor (uses from before the rule
 *  count too), each once, order kept, at most eight. */
export function readRecent(list: readonly string[], commands: readonly AliasedCommand[]): string[] {
  const out: string[] = [];
  for (const id of list) {
    const survivor = survivorId(id, commands);
    if (!out.includes(survivor)) out.push(survivor);
  }
  return out.slice(0, 8);
}

/** A survivor's alias sub-rows in Settings › Keys: the aliases with keys now — a default, or the person's own
 *  (even None, so it can be changed back). */
export function keyedAliases<C extends AliasedCommand>(commands: readonly C[], hotkeys: Record<string, string>, survivor: string): C[] {
  return commands.filter((c) => c.aliasOf === survivor && (c.hotkey !== undefined || hotkeys[c.id] !== undefined));
}
