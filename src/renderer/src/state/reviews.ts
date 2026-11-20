// The weekly review's standing, shared by every place that offers it (Today, the Projects home, the corner notice): when
// the last one was done or put off, how many projects there are to go over, and whether this week's is due. Read once
// and again every minute while anything shows it, and at once after a review is applied, undone or put off.

import { useEffect, useSyncExternalStore } from 'react';
import { reviewDue } from '../../../shared/weekly-review';
import { prefs as getPrefs } from './store';
import { isFinished } from '../../../shared/finished';

export interface ReviewStanding {
  /** The last review applied (ms), or null before the first. */
  last: number | null;
  /** "Not this week" pressed (ms). */
  putOff: number | null;
  /** Projects not done (what a review goes over). */
  projects: number;
  /** Every project, done or not. */
  all: number;
}

let standing: ReviewStanding | null = null;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** Reads the standing again (one read at a time). */
export function refreshReviewStanding(): Promise<void> {
  reading ??= Promise.all([window.nv.reviews.status(), window.nv.projects.list()])
    .then(
      ([status, list]) => {
        standing = { last: status.last, putOff: status.putOff, projects: list.filter((p) => !isFinished(p.status)).length, all: list.length };
      },
      () => undefined, // Not now (no notes open yet): asked again in a minute.
    )
    .finally(() => {
      reading = null;
      listeners.forEach((fn) => fn());
    });
  return reading;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    void refreshReviewStanding();
    timer = setInterval(() => void refreshReviewStanding(), 60_000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) clearInterval(timer);
  };
}

/** The standing, read again when the notes change (`revision`). */
export function useReviewStanding(revision?: number): ReviewStanding | null {
  const s = useSyncExternalStore(subscribe, () => standing);
  useEffect(() => {
    if (revision !== undefined) void refreshReviewStanding();
  }, [revision]);
  return s;
}

/**
 * Whether this week's review is due now: past the chosen day and time (Settings › Today and reviews) and not done or put
 * off since. `reminder: false` ignores the reminder's switch (Today's own line always knows).
 */
export function isReviewDue(s: ReviewStanding | null, now = new Date(), reminder = true): boolean {
  if (!s || !s.all) return false;
  const p = getPrefs();
  return reviewDue(now, { on: reminder ? p.weeklyReview : true, day: p.weeklyReviewDay, time: p.weeklyReviewTime }, s.last, s.putOff);
}

/**
 * Today's review card was on screen (the day, as "YYYY-M-D"): the corner reminder stays away for the rest of that day,
 * so the same offer doesn't follow the person to the next page they open.
 */
let seenOn = '';
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export function noteReviewSeen(): void {
  if (seenOn === dayKey()) return;
  seenOn = dayKey();
  listeners.forEach((fn) => fn());
}
export function reviewSeenToday(): boolean {
  return seenOn === dayKey();
}
