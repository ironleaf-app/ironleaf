// Undo for module records (25 Oct 2026, plan Phase 2 item 2.3; the former host app's
// native-runtime/plugins/desktop/vault-modules.mjs). Ironleaf writes Finance, Documents and ID, Family, Meetings and the
// other modules' records itself, so the former host app's Rewind and the reply's Ironleaf card never saw them. While the
// former host app (or a chat bot) runs a module tool, each note's text before its first write in that call is kept here
// (writeNote reports it), and the call's answer lists them. A note that existed but whose text is not known is not
// listed: putting it "back" as new would remove it.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ModuleWrite {
  path: string;
  /** The note's text before the call changed it; null when the call made it. */
  before: string | null;
}

const store = new AsyncLocalStorage<Map<string, string | null>>();

/** Called by writeNote before it writes `rel`: `existed` and the text it had (undefined when not known). */
export function noteBefore(rel: string, existed: boolean, text: string | undefined): void {
  const m = store.getStore();
  if (!m || m.has(rel)) return;
  if (!existed) m.set(rel, null);
  else if (typeof text === 'string') m.set(rel, text);
}

/** Runs one module call, and lists each note it changed with its text before. */
export async function recordingWrites<T>(fn: () => Promise<T>): Promise<{ out: T; changed: ModuleWrite[] }> {
  const m = new Map<string, string | null>();
  const out = await store.run(m, fn);
  return { out, changed: [...m].map(([path, before]) => ({ path, before })) };
}
