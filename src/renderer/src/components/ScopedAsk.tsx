import { useState } from 'react';
import { askInChat } from '../state/chat';

/** The one plain hint for a scoped ask box (9.2 uplift F19). */
export const SCOPED_ASK_HINT = 'Ask about this page…';

/** The Ask box at the foot of a record page (9.2 uplift F19): one box, not the two drifting
 *  copies. The words go to the helper in the side chat, scoped to the page's note when one is passed;
 *  question() wraps the words with page context where a scope path alone says too little. No glyph chrome:
 *  a labelled Send. */
export function ScopedAsk({ hint, scope, question }: { hint?: string; scope?: string; question?: (words: string) => string }) {
  const [words, setWords] = useState('');
  const label = hint ?? SCOPED_ASK_HINT;
  const send = () => {
    const w = words.trim();
    if (!w) return;
    askInChat(question ? question(w) : w, scope);
    setWords('');
  };
  return (
    <div className="ask float" style={{ marginTop: 18 }} role="search" aria-label={label}>
      <input className="ask-text" value={words} placeholder={label} aria-label={label} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button type="button" className="send send-words" title="Send" aria-label="Send" disabled={!words.trim()} onClick={send}>
        Send
      </button>
    </div>
  );
}
