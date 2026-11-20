// A date in plain words (5 Nov 2026, the plan "Vault: status in plain words"; one set,
// the plan): late ("2 days late", "Yesterday") in the attention colour, today, tomorrow and
// weekday with date muted. No fill, no dot. Two ways in, as the screens already have them: an offset
// from now (Today and Tasks) and timeline days (Projects and the project page, with its long day as
// the title), so every screen's words read the same through the one reader. Words and tone may be
// given outright.
import { longDay } from '../../../../shared/timeline';
import { datePill, dateTone, dateWords, type DateTone } from './plan';

export function DatePill({ offset, now, day, today, words, tone }: { offset?: number | null; now?: Date; day?: number; today?: number; words?: string; tone?: DateTone | 'ok' | 'warn' | 'bad' }) {
  if (day !== undefined || today !== undefined) {
    const t = tone ?? dateTone(day, today ?? 0);
    const label = words ?? dateWords(day, today ?? 0);
    const cls = t === 'late' || t === 'bad' ? 'is-attention' : 'is-muted';
    return (
      <span className={`plan-status-words ${cls}`} title={day !== undefined ? longDay(day) : label}>
        {label}
      </span>
    );
  }
  const p = datePill(offset ?? null, now ?? new Date());
  const t = tone ?? p.tone;
  const cls = t === 'bad' || t === 'late' ? 'is-attention' : 'is-muted';
  return <span className={`plan-status-words ${cls}`}>{words ?? p.words}</span>;
}
