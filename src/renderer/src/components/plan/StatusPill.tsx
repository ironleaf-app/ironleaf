// A status in plain words (5 Nov 2026, the plan "Vault: status in plain words"; one set,
// the plan): Off track, At risk, On track, Done, Waiting (sentence case). No fill, no dot —
// the words alone, late and at-risk in the attention colour (off track stronger in weight, never a
// third hue), on track and the rest muted. Both sizes read through the one statusReading
// (9.2 uplift F4), so each screen's words read the same. A label and tone may be given outright.
import { statusOf, statusPill, type StatusTone } from './plan';

export function StatusPill({ words, label, tone, size = 'regular' }: { words?: string; label?: string; tone?: StatusTone; size?: 'small' | 'regular' }) {
  const s = label ? { label, tone: tone ?? ('none' as StatusTone) } : size === 'small' ? (() => { const p = statusPill(words); return p ? { label: p.words, tone: p.tone as StatusTone } : null; })() : statusOf(words);
  if (!s) return null;
  const cls = s.tone === 'bad' ? 'is-attention is-strong' : s.tone === 'warn' ? 'is-attention' : 'is-muted';
  return <span className={`plan-status-words ${cls}`}>{s.label}</span>;
}
