// Reviewing flashcards (21 Oct 2026, notebook mode; the format and spacing rule are in src/shared/flashcards.ts): the
// cards due today one at a time, the question, then the answer on Space, then how well it was known (Again, Hard, Good,
// Easy, or the keys 1 to 4), each grade written into the note's properties at once so nothing is lost if the window
// closes. A card answered Again comes back once more before the end. Opened from the notebook, from Today's "Cards to
// review", and from a flashcards note's ⋯ menu.

import { useEffect, useMemo, useRef, useState } from 'react';
import { GRADES, schedule, type Card, type Grade, type ReviewState } from '../../../shared/flashcards';
import { isoOf } from '../../../shared/hub';
import { errorMessage } from '../lib/errors';
import { renderMarkdown, wikilinkFromClick } from '../lib/markdownRender';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { showError } from '../state/store';
import { Icon } from './Icon';

/** "in 3 days" for a grade's button. */
function gapWords(next: ReviewState, today: string): string {
  if (next.due <= today) return 'again today';
  return next.days === 1 ? 'tomorrow' : `in ${next.days} days`;
}

export function ReviewCards({ path, onClose }: { path: string; onClose(): void }) {
  const [deck, setDeck] = useState<{ title: string; cards: Card[]; review: Record<string, ReviewState> } | null>(null);
  const [queue, setQueue] = useState<Card[]>([]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const again = useRef(new Set<string>());
  const today = isoOf(new Date());
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  const start = (all: boolean) =>
    window.nv.notebook.deck(path).then(
      (d) => {
        setDeck(d);
        setQueue(all ? d.cards : d.cards.filter((c) => d.due.includes(c.id)));
        setShown(false);
        setDone(0);
        again.current = new Set();
      },
      (e) => setFailed(errorMessage(e)),
    );
  useEffect(() => void start(false), [path]);
  useEffect(() => box.current?.focus(), [deck !== null]);

  const card = queue[0];
  const grade = (g: Grade) => {
    if (!card || !shown || busy) return;
    setBusy(true);
    window.nv.notebook
      .grade(path, card.id, g)
      .then((state) => {
        setDeck((d) => (d ? { ...d, review: { ...d.review, [card.id]: state } } : d));
        // Again: once more at the end of this sitting (not round and round).
        const back = g === 'again' && !again.current.has(card.id);
        if (back) again.current.add(card.id);
        setQueue((q) => [...q.slice(1), ...(back ? [card] : [])]);
        setDone((n) => n + 1);
        setShown(false);
      }, showError)
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!box.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if ((e.key === ' ' || e.key === 'Enter') && !shown && card) {
        e.preventDefault();
        setShown(true);
        return;
      }
      const g = GRADES.find((x) => x.key === e.key);
      if (g && shown) {
        e.preventDefault();
        grade(g.grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const follow = (e: React.MouseEvent) => {
    const target = wikilinkFromClick(e);
    if (target === null) return;
    e.preventDefault();
    onClose();
    void A.openLink(target, path, 'tab');
  };
  const previews = useMemo(() => (card && deck ? GRADES.map((g) => ({ ...g, next: schedule(deck.review[card.id], g.grade, today) })) : []), [card?.id, deck, today]);
  const nextDue = deck ? Object.values(deck.review).map((r) => r.due).filter((d) => d > today).sort()[0] : undefined;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog nb-review" role="dialog" aria-label={`Review ${deck?.title ?? 'flashcards'}`} tabIndex={-1} ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <header className="nb-review-head">
          <Icon name="layers" size={16} />
          <h2>{deck?.title ?? 'Flashcards'}</h2>
          {card && (
            <span className="nb-review-count">
              {done + 1} of {done + queue.length}
            </span>
          )}
          <button className="icon-button" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </header>
        {failed ? (
          <p className="nb-error">{failed}</p>
        ) : !deck ? (
          <div className="view-loading" />
        ) : !card ? (
          <div className="nb-review-end">
            <Icon name="check" size={22} />
            <h3>{done ? `All done for today: ${done} ${done === 1 ? 'card' : 'cards'} reviewed.` : 'Nothing is due today.'}</h3>
            <p>{nextDue ? `The next cards come back on ${new Date(`${nextDue}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}.` : deck.cards.length ? '' : 'This note has no cards yet.'}</p>
            <div className="dialog-actions">
              {deck.cards.length > 0 && (
                <button className="button" onClick={() => void start(true)}>
                  Go through them all anyway
                </button>
              )}
              <button className="button primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="nb-card" onClick={follow}>
              <div className="nb-card-q markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.q, { from: path }) }} />
              {shown ? (
                <div className="nb-card-a markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.a, { from: path }) }} />
              ) : (
                <button className="button primary nb-show" onClick={() => setShown(true)}>
                  Show the answer <kbd>Space</kbd>
                </button>
              )}
            </div>
            {shown && (
              <div className="nb-grades" role="group" aria-label="How well did you know it?">
                {previews.map((g) => (
                  <button key={g.grade} className={`nb-grade g-${g.grade}`} disabled={busy} onClick={() => grade(g.grade)}>
                    <b>{g.label}</b>
                    <small>{gapWords(g.next, today)}</small>
                    <kbd>{g.key}</kbd>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
