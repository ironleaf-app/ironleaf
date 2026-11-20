// The search window (8.7 w2c): the mock-up's centred modal over a dimmed vault — SearchView inside, and an "Ask a
// follow-up" pill at its foot that puts the words to the helper in the side chat. Opened from anywhere by
// state/modals.ts requestSearch (the Ctrl+Shift+F command, tags, bookmarks, Home's Find); Esc closes it.

import { useState } from 'react';
import { askInChat } from '../state/chat';
import { closeModal } from '../state/modals';
import { Icon } from './Icon';
import { SearchView } from './SearchView';

export function SearchModal({ query }: { query: string }) {
  const [ask, setAsk] = useState('');
  const close = () => closeModal();
  return (
    <div
      className="overlay"
      onMouseDown={close}
      onKeyDown={(e) => {
        // A filter menu open above the window keeps Escape for itself (it closes menus first).
        if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input') && !document.querySelector('.menu')) close();
      }}
    >
      <div className="smodal sas-modal" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <SearchView host="modal" initialQuery={query} active autoFocus onOpenResult={close} />
        <div className="sas-askfoot">
          <form
            className="ask float"
            onSubmit={(e) => {
              e.preventDefault();
              const q = ask.trim();
              if (!q) return;
              setAsk('');
              close();
              askInChat(q);
            }}
          >
            <input className="ask-text" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask a follow-up…" aria-label="Ask a follow-up" />
            <button type="submit" className="send" title="Ask the assistant" aria-label="Ask the assistant" disabled={!ask.trim()}>
              <Icon name="send" size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
