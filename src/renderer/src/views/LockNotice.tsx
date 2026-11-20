// The vault lock notice: another app or window holds the vault for writing. It reuses the suggestion bar, as a
// note's save bar does. Plain Australian English throughout; nothing here names an engine.

import { Icon } from '../components/Icon';

export function LockNotice({ words, otherApp, onOpenOther, onReadOnly }: { words: string; otherApp: 'neuralspark' | 'neuralvault' | null; onOpenOther(): void; onReadOnly(): void }) {
  return (
    <div className="suggestion-bar" role="alert">
      <Icon name="warning" size={14} />
      <span className="suggestion-bar-words">{words}</span>
      {otherApp && (
        <button className="suggestion-bar-button" title="Open the other window, where your vault is open" onClick={onOpenOther}>
          Open it there
        </button>
      )}
      <button className="suggestion-bar-button primary" title="Stay here and read; the first save after the other app closes lands" onClick={onReadOnly}>
        Read only here
      </button>
    </div>
  );
}
