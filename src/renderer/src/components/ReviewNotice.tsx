// The weekly review's reminder (Settings › Today and reviews › Weekly review): a quiet card in the corner of the middle of
// Ironleaf from the chosen day and time — never a Windows notification, never over the side panels or the chat — until
// the review is done or put off for the week. Not shown while Today is on screen (Today offers the review itself) or
// while the review is open, nor after Today's card was seen that day; it steps up out of the way of a message along the bottom.

import { useState } from 'react';
import { WEEKDAYS } from '../../../shared/days';
import * as A from '../state/actions';
import { useWorkspace } from '../state/layout';
import { isReviewDue, refreshReviewStanding, reviewSeenToday, useReviewStanding } from '../state/reviews';
import { showError, useApp, usePrefs } from '../state/store';
import { useModal } from '../state/modals';
import * as W from '../state/workspace';
import { Icon } from './Icon';

export function ReviewNotice() {
  const prefs = usePrefs();
  const vault = useApp((s) => s.vault);
  const ws = useWorkspace();
  const standing = useReviewStanding();
  /** A window over the app (Settings, Commands…): the reminder waits behind it rather than sitting on top. */
  const modal = useModal();
  /** "Later": not again while Ironleaf stays open. */
  const [later, setLater] = useState(false);
  // Seen on Today already today: Today keeps offering it; the corner doesn't repeat it on every other page.
  if (!vault || later || modal || !isReviewDue(standing) || reviewSeenToday()) return null;
  // On screen already: the review itself, or Today (in its tab, or an empty tab showing it), which offers it.
  const showing = W.groups(ws.root).map((g) => g.tabs.find((t) => t.id === g.active) ?? g.tabs[0]);
  if (showing.some((t) => t.type === 'review' || t.type === 'today' || (t.type === 'empty' && prefs.home && prefs.today))) return null;
  const projects = standing?.projects ?? 0;
  const today = new Date().getDay() === prefs.weeklyReviewDay;
  return (
    <aside className="wr-notice" role="status" aria-label="Weekly review">
      <span className="wr-notice-icon">
        <Icon name="review" size={16} />
      </span>
      <div className="wr-notice-words">
        <strong>{today ? `It’s ${WEEKDAYS[prefs.weeklyReviewDay]}: time for the weekly review` : 'This week’s review is waiting'}</strong>
        <span>What moved, slipped and needs chasing across {projects === 1 ? 'your project' : `your ${projects} projects`}, in one pass.</span>
        <span className="wr-notice-actions">
          <button className="button primary" onClick={() => A.openWeeklyReview()}>
            Start the review
          </button>
          <button className="text-button" onClick={() => void window.nv.reviews.putOff().then(refreshReviewStanding, showError)}>
            Not this week
          </button>
        </span>
      </div>
      <button className="wr-notice-close" aria-label="Later" title="Later (it comes back next time Ironleaf opens)" onClick={() => setLater(true)}>
        <Icon name="close" size={13} />
      </button>
    </aside>
  );
}
