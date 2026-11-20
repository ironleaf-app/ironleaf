// One reading of a workspace record's status word (split out of views/workspace/recordParts.tsx in the 9.2
// uplift F160, so tests pin it directly): done things calm green, risks amber, late or high red, what's next
// in the accent. Whole words in the red and amber branches: "Translate the brief" is not late and
// "Highlight for review" is not high. Pure: callers pass what they already have.

import type { FieldValue, WsRecord } from '../../../shared/workspace-records';

/** A tone for a status-like word: done things calm green, risks amber, late or high red, what's next in the accent. */
export function toneOf(value: FieldValue, field = ''): 'ok' | 'warn' | 'bad' | 'next' | 'none' {
  const v = String(value ?? '').toLowerCase();
  if (!v) return 'none';
  if (field === 'impact') return /\b(high|critical)\b/.test(v) ? 'bad' : /\bmedium\b/.test(v) ? 'warn' : 'none';
  // Home, Vehicles, Career and Travel (Wave 7 part a).
  if (/^(due soon|warranty ends soon|needs repair)$/.test(v)) return 'warn';
  if (/^(interview|offer|away)$/.test(v)) return 'next';
  if (/^(under warranty|booked)$/.test(v)) return 'ok';
  if (/^(done|closed|complete|completed|met|achieved|resolved|delivered|on track|live|yes|in stock|sent|accepted|paid|in its project|up|solved|released|watched|read|got|got it|bought|been|shared|posted)\b/.test(v)) return 'ok';
  if (/\b(overdue|late|off track|blocked|missed|no budget|high|in repair|lost|lapsed|expired|faulty|out of warranty|urgent|failed|churned|pulled)\b/.test(v) || v === 'down') return 'bad';
  if (/\b(at risk|risky?|medium|on hold|waiting|passed|ending|expires soon|lapses soon|to patch|not yet|degraded|maintenance|problems)\b/.test(v) || v === 'slow') return 'warn';
  if (/^(next|today|due today|this week|in progress|active|current|now|watching|reading|listening|making|live now)\b/.test(v)) return 'next';
  return 'none';
}

/** Whether a record reads finished: its done or closed flag, else a status starting with a finished word. */
export const isDoneRecord = (r: WsRecord) => r.fields.done === true || r.fields.closed === true || /^(done|closed|complete)\b/i.test(String(r.fields.status ?? ''));
