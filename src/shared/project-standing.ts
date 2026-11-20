// One fact, one value (8 Nov 2026, the plan item 1): every page reads a project's standing here — the
// Projects page, the Graph's card map, the project page and Today — so a status means the same everywhere. Finished,
// closed or on-hold projects read Finished, On hold or Idea whatever their health still says (never "On track" when
// finished), and read closed for every open count. The word lists moved whole from the renderer's projectLook (the
// 9.2 uplift's one reading: whole words only, so "offer" is not off track and "delivered" is not red); projectLook
// keeps delegating wrappers so its callers read the same words. Pure.
import { isFinished } from './finished';
import { isLive, isShelved } from './today-count';

export type StandingTone = 'ok' | 'warn' | 'bad' | 'none';
export type StandingWords = 'Finished' | 'On hold' | 'Idea' | 'Off track' | 'At risk' | 'Overdue' | 'On track' | 'Active';

/** A status or health in one canonical state: over, held for someone, off track, at risk, on track, or none. */
export type StatusState = 'done' | 'waiting' | 'off-track' | 'at-risk' | 'on-track' | 'none';

const DONE_WORDS = /\b(done|complete|completed|closed|finished|delivered|live|met|achieved|resolved|passed|paid|sent|accepted)\b/i;
const WAITING_WORDS = /\b(awaiting|waiting|pending|on hold|paused|blocked on)\b/i;
const BAD_WORDS = /\b(off track|off-track|red|critical|blocked|overdue|late|stuck|broken|lost|missing|faulty|fault|failed|failure|errors?|missed|lapsed|expired|out of stock|cancelled|no budget|churned|pulled|in repair|out of warranty|urgent)\b/i;
const WARN_WORDS = /\b(at risk|at-risk|risk|amber|warn(?:ing)?|behind|watch|repair|needs repair|low|hold|delayed|slipping|today|running?|started?|starting|working?|in progress|ending|expires soon|lapses soon|to patch|degraded|maintenance|problems|medium)\b/i;
const OK_WORDS = /\b(on track|on-track|track|green|good|ok|active|in use|under warranty|booked|ready|healthy|available|in stock|won)\b/i;

/** A status or health word in its canonical state ("Held over" is open, never done; "High" alone is none —
 *  a risk level's High is levelTone). Order matters: waiting ahead of bad ("blocked on" waits, "blocked" is bad).
 *  A negated claim ("Not done", "Not at risk") reads as nothing rather than as its opposite. */
export function statusReading(words?: string): { state: StatusState; tone: StandingTone } {
  const w = String(words ?? '');
  if (!w.trim()) return { state: 'none', tone: 'none' };
  const negated = /^\s*(not|no|never)\s+(.+)$/i.exec(w);
  if (negated && negated[2].trim() && statusInner(negated[2]).state !== 'none') return { state: 'none', tone: 'none' };
  return statusInner(w);
}

function statusInner(w: string): { state: StatusState; tone: StandingTone } {
  if (DONE_WORDS.test(w)) return { state: 'done', tone: 'ok' };
  if (WAITING_WORDS.test(w)) return { state: 'waiting', tone: 'none' };
  if (BAD_WORDS.test(w)) return { state: 'off-track', tone: 'bad' };
  if (WARN_WORDS.test(w)) return { state: 'at-risk', tone: 'warn' };
  if (OK_WORDS.test(w)) return { state: 'on-track', tone: 'ok' };
  return { state: 'none', tone: 'none' };
}

export function healthTone(health?: string): StandingTone {
  return statusReading(health).tone;
}

/** One "I say" override line (vault rebuild step 2, 12 Nov 2026 — the standing works itself out from the dates, and
 *  the person overrides with one "I say: at risk, because ..." line, shown as theirs): its claim ("at risk")
 *  and its reason ("ShadeCo may lapse", '' when none). Null when no override. */
export interface SayOverride {
  claim: string;
  reason: string;
}

export function parseSayOverride(health?: string): SayOverride | null {
  const m = /^\s*i say\s*:\s*(.+?)\s*$/i.exec(String(health ?? ''));
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest) return null;
  const cut = /\s*(?:,?\s*because\s+|[—–-]\s*)/i.exec(rest);
  if (!cut) return { claim: rest, reason: '' };
  return { claim: rest.slice(0, cut.index).trim(), reason: rest.slice(cut.index + cut[0].length).trim() };
}

/** Open for every open count: not finished and not shelved (on hold or an idea). */
export const isOpenProject = (status?: string): boolean => isLive(status);

/** The health a card weighs (sweep 023/024: "on track" with the person's own steps late is not on track,
 *  whatever the stored word says; past its due day and not finished, never "on track" either). The stored
 *  word is untouched; callers pass what they know (the Graph has no late steps, so it passes none) and the
 *  rule weighs it the same for every page. An "I say" override wins outright (step 2: disagreeing is its point). */
export function effectiveHealthOf(c: { health?: string; lateMine?: number; overdue?: boolean }): string | undefined {
  const said = parseSayOverride(c.health);
  if (said) return said.claim;
  if ((c.lateMine ?? 0) > 0 && healthTone(c.health) === 'ok') return 'At risk';
  if (c.overdue && healthTone(c.health) !== 'bad') return 'Overdue';
  return c.health;
}

export interface Standing {
  words: StandingWords;
  tone: StandingTone;
  open: boolean;
}

/** The standing line's counts (step 2: "5 of yours open, 3 late. 11 with others, 2 late. Next milestone
 *  Fri 20 Nov" works itself out from the dates): yours are the hub's own open actions written as steps or in
 *  notes and meetings (run-sheet boxes are their layout's door, never counted here); others are the waiting
 *  groups' items; nextDay is the nearest coming milestone's day, or null. Pure. */
export interface StandingLine {
  mineOpen: number;
  mineLate: number;
  othersOpen: number;
  othersLate: number;
  nextDay: number | null;
}

export function standingLine(hub: {
  plan: { late: { ref: { kind: string } }[]; week: { ref: { kind: string } }[]; later: { ref: { kind: string } }[]; undated: { ref: { kind: string } }[] };
  waiting: { items: { overdue?: boolean }[] }[];
  upcoming: { day?: number }[];
}): StandingLine {
  const own = (list: { ref: { kind: string } }[]) => list.filter((a) => a.ref.kind === 'next' || a.ref.kind === 'record');
  const late = own(hub.plan.late);
  const mineOpen = late.length + own(hub.plan.week).length + own(hub.plan.later).length + own(hub.plan.undated).length;
  const others = hub.waiting.flatMap((g) => g.items);
  return { mineOpen, mineLate: late.length, othersOpen: others.length, othersLate: others.filter((a) => a.overdue).length, nextDay: hub.upcoming[0]?.day ?? null };
}

/** A project's standing: finished first (whatever the health still says), else shelved (on hold or an idea),
 *  else its effective health's tone — off track, at risk, overdue, on track, or active when nothing is written.
 *  `overdue` is past its due day (each page reads its own due day); `lateMine` is the person's own late steps
 *  where the page knows them. */
export function projectStanding(p: { status?: string; health?: string; overdue?: boolean; lateMine?: number }): Standing {
  if (isFinished(p.status)) return { words: 'Finished', tone: 'none', open: false };
  if (isShelved(p.status)) return { words: /\bidea\b/i.test(p.status ?? '') ? 'Idea' : 'On hold', tone: 'none', open: false };
  const h = effectiveHealthOf({ health: p.health, lateMine: p.lateMine, overdue: p.overdue });
  if (!h) return { words: 'Active', tone: 'none', open: true };
  const tone = healthTone(h);
  if (tone === 'ok') return { words: 'On track', tone, open: true };
  if (tone === 'warn') return { words: /\boverdue\b/i.test(h) ? 'Overdue' : 'At risk', tone, open: true };
  if (tone === 'bad') return { words: /\boverdue\b/i.test(h) ? 'Overdue' : 'Off track', tone, open: true };
  return { words: 'Active', tone: 'none', open: true };
}
