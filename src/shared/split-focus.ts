// The split focus the former host app's window tells Vault's view (one product step 5 part 3, 8 Nov 2026):
// whether the main area is split and which side has focus. The chat panel re-scopes from it at once — the
// focused note, or its own chat — so the panel answers about the focused side. Part 4 carries the chat side
// along while split (its id, title and withheld state), so the panel is "About this chat" and answers from
// its transcript. Coerced at every boundary: split or not, chat or note, and a chat side only with an id —
// the transcript itself never rides the tell.
export interface SplitChat {
  id: string;
  title: string;
  withheld: 'private' | 'locked' | null;
}

export interface SplitFocus {
  split: boolean;
  focus: 'chat' | 'note';
  chat?: SplitChat | null;
}

/** What the view was told, read safely: anything unreadable is a whole view with the note showing. The chat
 *  side rides only while split with an id; whole, or unreadable, it reads as no chat side. */
export function coerceSplitFocus(input: unknown): SplitFocus {
  const v = input && typeof input === 'object' ? (input as { split?: unknown; focus?: unknown; chat?: unknown }) : {};
  const split = v.split === true;
  const out: SplitFocus = { split, focus: v.focus === 'chat' ? 'chat' : 'note' };
  if (!split) return out;
  const c = v.chat && typeof v.chat === 'object' ? (v.chat as { id?: unknown; title?: unknown; withheld?: unknown }) : null;
  if (!c) return out;
  const id = typeof c.id === 'string' ? c.id.slice(0, 128) : '';
  if (!id) return out;
  const title = typeof c.title === 'string' ? c.title.trim().replace(/\s+/g, ' ').slice(0, 140) : '';
  out.chat = { id, title, withheld: c.withheld === 'private' || c.withheld === 'locked' ? c.withheld : null };
  return out;
}

/** Whether two tells match whole: split, focus and the chat side's id, title and withheld state (t50
 *  break: comparing split and focus alone kept the panel answering about the old chat after its side changed). */
export function sameSplitFocus(a: SplitFocus, b: SplitFocus): boolean {
  if (a.split !== b.split || a.focus !== b.focus) return false;
  const ac = a.chat ?? null, bc = b.chat ?? null;
  if (!ac || !bc) return ac === bc;
  return ac.id === bc.id && ac.title === bc.title && (ac.withheld ?? null) === (bc.withheld ?? null);
}

/** The chat scope for the told focus: the chat while a chat has focus, the note while a note-like page has
 *  focus, else the chat's own. Null while whole: the person's own scope stands, as today. A private note never
 *  scopes (the panel passes false); a withheld chat keeps its scope, so the answer says plainly why. */
export function splitScopeFor(told: SplitFocus, hasNote: boolean): 'all' | 'note' | 'chat' | null {
  if (!told.split) return null;
  if (told.focus === 'chat') return 'chat';
  return hasNote ? 'note' : 'all';
}

/** The scope the panel asks in while split, read synchronously at ask time (t50 break: the scope the
 *  panel kept lagged a render behind a fast switch, so the answer came from the wrong side): the told chat
 *  while a chat has focus (degrading to the chat's own without a told chat), the note while a note-like page
 *  has focus, else the chat's own. Null while whole: the person's own scope stands, as today. */
export function splitAskScope(told: SplitFocus, hasNote: boolean): { scope: 'all' | 'note' | 'chat'; chat?: { id: string; title: string } } | null {
  if (!told.split) return null;
  const following = splitScopeFor(told, hasNote);
  if (following === 'chat') return told.chat ? { scope: 'chat', chat: { id: told.chat.id, title: told.chat.title } } : { scope: 'all' };
  if (following === 'note') return { scope: 'note' };
  return { scope: 'all' };
}

/** The scope's words: About this chat while a chat has focus, About this note while a note has focus, All
 *  notes as the chat's own reads today. A withheld chat carries no title, so it reads About this chat. */
export function splitScopeWords(scope: 'all' | 'note' | 'chat', title: string): string {
  if (scope === 'chat') {
    const chat = title.trim().replace(/\s+/g, ' ');
    return chat ? `About this chat: ${chat}` : 'About this chat';
  }
  if (scope !== 'note') return 'All notes';
  const note = title.trim().replace(/\s+/g, ' ');
  return note ? `About this note: ${note}` : 'About this note';
}
