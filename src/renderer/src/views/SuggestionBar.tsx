// The bar at the top of a note with the assistant's suggested changes waiting in it (19 Oct 2026, 5.0.0: "Ironleaf's
// assistant suggests 3 changes · Keep all · Discard all · Next ›"). The changes themselves show in the note, each with
// Keep and Discard (editor/suggestions.ts). In Reading, Review switches to editing to see them.

import { keysFor } from '../editor/keysFor';
import { Icon } from '../components/Icon';
import { discardAllSuggestions, keepAllSuggestions, moveSuggestion, useSuggestions, useSuggestionsUnknown } from '../state/suggestions';

export function SuggestionBar({ path, reading, canEdit, onReview }: { path: string; reading: boolean; canEdit: boolean; onReview(): void }) {
  const entry = useSuggestions(path);
  const unknown = useSuggestionsUnknown(path);
  if (!entry) return null;
  const n = entry.hunks.length;
  const stale = entry.hunks.filter((h) => h.stale).length;
  const next = keysFor('suggestion-next');
  return (
    <div className="suggestion-bar" role="region" aria-label="Suggested changes">
      <Icon name="sparkle" size={14} />
      <span className="suggestion-bar-words">
        Ironleaf’s assistant suggests {n === 1 ? 'a change' : `${n} changes`}
        {stale > 0 && <span className="suggestion-bar-stale"> · {stale === n ? (n === 1 ? 'out of date' : 'all out of date') : `${stale} out of date`}</span>}
        {unknown && <span className="suggestion-bar-stale"> · couldn’t tell the assistant what still waits</span>}
      </span>
      {canEdit && n > stale && (
        <button className="suggestion-bar-button primary" title="Keep every change that is still in date" onClick={() => keepAllSuggestions(path)}>
          Keep all
        </button>
      )}
      <button className="suggestion-bar-button" title="Discard every change: the note stays as it is" onClick={() => discardAllSuggestions(path)}>
        Discard all
      </button>
      {reading ? (
        <button className="suggestion-bar-button" title="See each change in the note" onClick={onReview}>
          Review ›
        </button>
      ) : (
        <button className="suggestion-bar-button" title={`Go to the next change${next ? ` (${next})` : ''}`} onClick={() => moveSuggestion(path, 1)}>
          Next ›
        </button>
      )}
    </div>
  );
}
