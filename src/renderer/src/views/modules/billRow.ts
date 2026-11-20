import type { Bill } from '../../../../shared/finance';
import { isJustPaid } from '../../../../shared/finance';
import { shortDay, weekdayOf } from '../../../../shared/pack-dates';

/** Just paid (9.2 uplift F3): paid in the last week and now due more than a week out. The row stays
 *  visible everywhere bills show: Paid plus its next day, never vanished, never payable twice. One rule in
 *  shared finance (3 Nov 2026, fourth-round G1), so the due list can never drift from the Paid row. */
export function justPaid(b: Bill, today: string): boolean {
  return isJustPaid(b, today);
}

/** Whether a bill shows its Mark-paid tick (9.5 fresh eyes, 2 Nov 2026): any bill with a coming
 *  day that isn't just paid — autopay ones too, since the person may pay one by hand before
 *  its day (or after its debit failed). The one rule the Bills page, Today and Home share. */
export function payableByHand(b: Bill, today: string): boolean {
  return b.next !== null && !justPaid(b, today);
}

export type BillTint = 'red' | 'green' | 'amber' | 'slate';

/** A bill's tag, the one bill-row state (F3): how late, its weekday within the week, its day past it,
 *  Paid plus its next day when just paid. A live bill with no due date written says so plainly (bills as
 *  one list, 8 Nov 2026): it is never counted as due. */
export function billRowTag(b: Bill, today: string): { tone: BillTint; words: string } {
  if (b.overdue && b.days !== null) return { tone: 'red', words: b.days === -1 ? '1 day late' : `${-b.days} days late` };
  if (b.next === null && !b.anchor && !/^(paused|cancelled|canceled|stopped|ended)$/i.test(b.status || '')) return { tone: 'slate', words: 'due date not set' };
  if (b.next === null) return { tone: 'slate', words: b.status || 'Paused' };
  if (justPaid(b, today)) return { tone: 'green', words: `Paid · next ${shortDay(b.next)}` };
  if (b.days === 0) return { tone: 'amber', words: 'Today' };
  if (b.days !== null && b.days >= 1 && b.days <= 7) return { tone: 'amber', words: weekdayOf(b.next) };
  return { tone: 'slate', words: shortDay(b.next) };
}
