// One rule for "is it finished" (26 Oct 2026; the audit found six different checks, so an archived or cancelled project
// showed as live in one list and finished in another). Every list, count, card, Today, the timeline and the graph ask
// this, so a status means the same everywhere. Pure.

/** The words a status uses when the thing is over, whichever way it ended. */
export const FINISHED_WORDS = ['done', 'closed', 'complete', 'completed', 'finished', 'archived', 'cancelled', 'canceled', 'dropped', 'delivered', 'achieved', 'rejected', 'ended', 'retired', 'resolved', 'abandoned', 'withdrawn', 'shipped'];
const FINISHED = new RegExp(`^\\s*(${FINISHED_WORDS.join('|')})\\b`, 'i');

/** Whether a status says it is over ("Done", "Archived", "Cancelled — client pulled out"). Empty or live words are not. */
export const isFinished = (status: unknown): boolean => FINISHED.test(String(status ?? ''));

/** Whether a tick-box mark says done: ticked ([x], [X]) or cancelled ([-]). In-progress ([/]), a question ([?]) and
 *  every other mark stay open (Nov 2026 audit: an in-progress task vanished from the open lists). The one rule for
 *  tasks, reminders, the hub, the command line and search, so a box means the same everywhere. */
export const isBoxDone = (mark: string): boolean => mark === 'x' || mark === 'X' || mark === '-';

/**
 * One rule for a health's tone (the audit found six copies matching bare substrings, so "Offer extended" read as
 * Off track and "Delivered" as red). Whole words only ("offer" is not "off", "delivered" is not "red"), bad before
 * warn before ok, and null when the words say no health at all — every caller keeps its own fallback for that.
 */
export function readHealthTone(health: unknown): 'bad' | 'warn' | 'ok' | null {
  const h = String(health ?? '').toLowerCase();
  if (!h.trim()) return null;
  if (/\b(off track|off|red|critical|block(?:ed|s|ers)?|overdue)\b/.test(h)) return 'bad';
  if (/\b(at risk|risks?|risky|amber|warn(?:ing|ed|s)?|watch(?:ing|ed|es)?)\b/.test(h)) return 'warn';
  if (/\b(on track|track(?:ing|ed)?|green|good|ok(?:ay)?)\b/.test(h)) return 'ok';
  return null;
}
