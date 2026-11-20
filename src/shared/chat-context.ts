// The focused the former host app conversation as the chat panel's context (one product step 5 part 4, 8 Nov
// 2026, the ): with a chat focused the panel is "About this chat" and answers from that conversation's
// transcript. The transcript rides into the answer as one <open_chat> block, capped within the model's limits; a
// private or locked chat is never sent across and is said in plain words instead. Save as note lands in the
// folder in view. Pure, shared by the main process (which asks the former host app for the transcript behind the
// native header) and the panel (which words the scope and the notice).
export const MAX_CHAT_CHARS = 60000;

/** The conversation as one context block for the model's question, newest words kept within the limit. */
export function chatContextBlock(title: string, text: string): string {
  const body = text.length > MAX_CHAT_CHARS ? text.slice(-MAX_CHAT_CHARS) : text;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<open_chat title="${esc(title.trim().replace(/\s+/g, ' ') || 'this chat')}">\n${body}\n</open_chat>`;
}

/** Why the panel cannot read the chat, in plain words for the notice and the answer alike. */
export function chatWithheldWords(withheld: 'private' | 'locked'): string {
  return withheld === 'private'
    ? 'This is a private chat, so the panel can’t read it. Nothing from it is kept or sent anywhere.'
    : 'That chat is locked, so the panel can’t read it. Unlock it first.';
}

/** An empty chat, in plain words: no model call, no tools, nothing made. */
export function chatEmptyWords(): string {
  return 'That chat has nothing in it yet, so there is nothing to answer from.';
}

/** A chat that cannot be read any more (gone, or not answering), in plain words: no model call, no tools. */
export function chatMissingWords(): string {
  return 'That chat couldn’t be read, so there is nothing to answer from.';
}

/** Which transcript a chat-scope question may read (t46 break: the page named any id it liked): the told chat
 *  alone, and only when the question names it. A withheld chat answers why without ever being asked for; any
 *  other id, or none while whole, reads as no chat at all. */
export function resolveChatAsk(
  told: { split: boolean; chat?: { id: string; withheld: 'private' | 'locked' | null } | null },
  askedId: string | undefined,
): { id: string } | { withheld: 'private' | 'locked' } | null {
  const chat = told && told.split && told.chat ? told.chat : null;
  if (!chat || !askedId || askedId !== chat.id) return null;
  if (chat.withheld === 'private' || chat.withheld === 'locked') return { withheld: chat.withheld };
  return { id: chat.id };
}

/** Where Save as note lands while a chat is focused: the folder of the note in view, or null for the usual
 *  place (no split, a note focused, or no note in view such as Graph beside a chat). */
export function splitSaveFolder(told: { split: boolean; focus: 'chat' | 'note' }, notePath: string | undefined): string | null {
  if (!told.split || told.focus !== 'chat' || !notePath) return null;
  return notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
}
