// Cards to review on Today (21 Oct 2026, notebook mode; src/shared/flashcards.ts): the flashcard decks with cards due
// today (new ones and those whose day has come), each with Review, read again as the notes change. Nothing shows when
// no cards are due.

import { useEffect, useState } from 'react';
import type { DueDeck } from '../../../../main/notebook';
import { Icon } from '../../components/Icon';
import * as A from '../../state/actions';
import { openModal } from '../../state/modals';
import { useApp } from '../../state/store';

/** Flashcard decks with cards due today (notebook mode), read again as the notes change. */
export function CardsDue() {
  const revision = useApp((s) => s.revision);
  const [decks, setDecks] = useState<DueDeck[]>([]);
  // Five decks, then Show all (4 Nov 2026, p17-today-note-cap: six with a one-deck link hid the rest one deck at a time).
  const [all, setAll] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => void window.nv.notebook.due().then(setDecks, () => undefined), 300);
    return () => clearTimeout(t);
  }, [revision]);
  if (!decks.length) return null;
  const total = decks.reduce((n, d) => n + d.due, 0);
  return (
    <section className="td-section th-cards" data-section="cards" aria-labelledby="td-h-cards" data-look-row>
      <header className="td-section-head">
        <h2 id="td-h-cards">
          Cards to review<span className="td-count">{total}</span>
        </h2>
        <span className="td-section-hint">Flashcards from your notebooks</span>
      </header>
      <ul className="th-cards-list">
        {(all ? decks : decks.slice(0, 5)).map((d) => (
          <li key={d.path}>
            <button className="th-cards-name" onClick={(e) => A.openPath(d.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={d.path}>
              <Icon name="layers" size={14} />
              <span>{d.title}</span>
              <small>
                {d.due} of {d.total} due
              </small>
            </button>
            <button className="button th-cards-go" onClick={() => openModal({ kind: 'review-cards', path: d.path })}>
              Review
            </button>
          </li>
        ))}
      </ul>
      {decks.length > 5 && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${decks.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
    </section>
  );
}
