// One date strip, everywhere (v9, 6 Nov 2026). Dots used to sit at their true date, so a strip spanning months
// piled fifteen dots on top of one another around Today and left the rest empty. Now each stop keeps its own
// room in order, a long gap reads as a marked break, Today keeps its true place, and the stops past counting
// fold honestly ("8 earlier"). The dashboard's Milestones card and the workspace's Next milestones tile both
// draw this (components/DateStrip.tsx); the Timeline packs its marks by the same rule (packMarks), and the
// plan's rows never shared a line. Nothing here touches the DOM: the tests drive it directly.

/** One dated stop on the strip (a milestone, a key date). */
export interface StripStop {
  /** Steady identity for keys and rows. */
  id: string;
  /** The timeline day (shared/timeline.ts days). */
  day: number;
  /** Short plain name, as written. */
  label: string;
  /** Short date words ("Thu 6 Nov"). */
  date: string;
  done: boolean;
  /** Passed and not done. */
  late: boolean;
}

/** A stop placed on the strip, with its share of the line. */
export interface StripPlaced extends StripStop {
  /** The stop's middle, 0..1 across the strip. */
  x01: number;
  /** Why it is named under the strip (null: a dot with its words on hover). */
  key: 'late' | 'last-done' | 'next' | null;
}

/** A long gap between two stops on show, as one marked break. */
export interface StripBreak {
  /** The break's middle, 0..1 across the strip. */
  x01: number;
  /** The empty days it stands for. */
  days: number;
}

export interface StripLayout {
  /** The stops on show, oldest first. */
  stops: StripPlaced[];
  /** The marked breaks between them. */
  breaks: StripBreak[];
  /** Past stops folded away ("N earlier"), future stops folded away ("N later"). */
  earlier: number;
  later: number;
  /** Today at its true place: after every stop up to today, 0..1 across the strip. */
  today01: number;
}

/** Late stops named under the strip (the nearest); older late ones fold into "earlier". */
export const STRIP_LATE_SHOWN = 5;
/** Coming stops on show (next and the seven after it); the rest fold into "later". */
export const STRIP_COMING_SHOWN = 8;
/** A gap past this many days reads as a marked break, never empty distance. */
export const STRIP_BREAK_DAYS = 45;

const byDay = (a: StripStop, b: StripStop) => a.day - b.day || a.label.localeCompare(b.label);

/** Lay stops on the strip (showAll: every stop on show, for an opened fold — the strip scrolls sideways). */
export function layoutStrip(all: readonly StripStop[], today: number, showAll = false): StripLayout {
  const dated = [...all].sort(byDay);
  if (!dated.length) return { stops: [], breaks: [], earlier: 0, later: 0, today01: 0 };
  if (showAll) return place(dated, today, 0, 0);
  const late = dated.filter((s) => s.late);
  const done = dated.filter((s) => s.done);
  const lastDone = done.length ? done[done.length - 1] : undefined;
  const coming = dated.filter((s) => s.day >= today && !s.done);
  const next = coming[0];
  const show = new Set<string>();
  for (const s of late.slice(-STRIP_LATE_SHOWN)) show.add(s.id);
  if (lastDone) show.add(lastDone.id);
  for (const s of coming.slice(0, STRIP_COMING_SHOWN)) show.add(s.id);
  // Defensive: dated but nothing chosen (flags the caller never sets) still shows its nearest stop.
  if (!show.size) {
    const near = [...dated].sort((a, b) => Math.abs(a.day - today) - Math.abs(b.day - today))[0];
    show.add(near.id);
  }
  const earlier = dated.filter((s) => s.day < today && !show.has(s.id)).length;
  const later = dated.filter((s) => s.day >= today && !show.has(s.id)).length;
  const keyOf = (s: StripStop): StripPlaced['key'] => {
    if (next && s.id === next.id) return 'next';
    if (lastDone && s.id === lastDone.id) return 'last-done';
    if (s.late) return 'late';
    return null;
  };
  return place(
    dated.filter((s) => show.has(s.id)),
    today,
    earlier,
    later,
    keyOf,
  );
}

function place(stops: StripStop[], today: number, earlier: number, later: number, keyOf: (s: StripStop) => StripPlaced['key'] = () => null): StripLayout {
  const n = stops.length;
  if (!n) return { stops: [], breaks: [], earlier, later, today01: 0 };
  const placed: StripPlaced[] = stops.map((s, i) => ({ ...s, x01: (i + 0.5) / n, key: keyOf(s) }));
  const breaks: StripBreak[] = [];
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].day - stops[i - 1].day;
    if (gap > STRIP_BREAK_DAYS) breaks.push({ x01: i / n, days: gap });
  }
  return { stops: placed, breaks, earlier, later, today01: stops.filter((s) => s.day <= today).length / n };
}

// ── Date labels under the stops (v10, 6 Nov 2026: 14 bare dots "still says nothing") ───────────────────────────
// Every stop in view shows its date under it ("5 Nov"), small and neat, never overlapping. Stops sharing a day
// share one label with a count ("5 Nov · 3"). The next stop adds its short name, so what is next reads at a
// glance. Today stays above the line, dates below it, so they never collide. An opened strip thins its labels to
// what fits, always keeping the first of each month and the next stop, so months read clearly.

/** One date label under the strip, for every stop sharing its day. */
export interface StripLabel {
  /** The day it names (timeline days). */
  day: number;
  /** "5 Nov", or "5 Nov · 3" when stops share the day. */
  text: string;
  /** The label's middle, 0..1 across the strip (its stops' middle, nudged to fit). */
  x01: number;
  /** First label of its month: always kept when thinning, so months read. */
  firstOfMonth: boolean;
  /** The next stop's day: always kept, with its short name. */
  isNext: boolean;
  /** The next stop's short name (isNext only). */
  nextName: string;
  /** Every stop done (green), any late (red), else coming (grey, next in accent). */
  tone: 'done' | 'late' | 'next' | 'coming';
}

/** A label's month key ("Nov", "Nov 2027") from its date words. */
const monthOf = (date: string) => {
  const parts = date.trim().split(/\s+/);
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : (parts[1] ?? parts[0] ?? '');
};

/** Group placed stops by day into date labels, in order. */
export function stripLabels(stops: readonly StripPlaced[], today: number): StripLabel[] {
  if (!stops.length) return [];
  const next = stops.find((s) => s.key === 'next') ?? [...stops].sort(byDay).find((s) => s.day >= today && !s.done);
  const groups = new Map<number, StripPlaced[]>();
  for (const s of stops) groups.set(s.day, [...(groups.get(s.day) ?? []), s]);
  const labels: StripLabel[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, ss]) => {
      const x01 = ss.reduce((a, s) => a + s.x01, 0) / ss.length;
      const isNext = next !== undefined && ss.some((s) => s.id === next.id);
      const tone: StripLabel['tone'] = isNext ? 'next' : ss.some((s) => s.late) ? 'late' : ss.every((s) => s.done) ? 'done' : 'coming';
      return { day, text: ss.length > 1 ? `${ss[0].date} · ${ss.length}` : ss[0].date, x01, firstOfMonth: false, isNext, nextName: isNext ? next!.label : '', tone };
    });
  const seen = new Set<string>();
  for (const l of labels) {
    const k = monthOf(l.text);
    if (!seen.has(k)) {
      seen.add(k);
      l.firstOfMonth = true;
    }
  }
  return labels;
}

/** Rough label widths in px (11px words): overestimated a little, so estimates never overlap for real. */
export const labelWidth = (l: StripLabel): number => {
  const dateW = l.text.length * 6 + 10;
  if (!l.isNext) return dateW;
  return Math.max(dateW, Math.min(l.nextName.length, 28) * 6 + 10);
};

/** A label centre clamped so the whole label sits inside widthPx (break-it finding 9, 6 Nov 2026: labels
 *  centred near the ends spilled past them, "Today" at an end included). Shared with the strip's Today word. */
export function clampedLabel01(x01: number, labelPx: number, widthPx: number): number {
  if (widthPx <= 0) return x01;
  const half = Math.min(labelPx, widthPx) / 2;
  return Math.max(half, Math.min(widthPx - half, x01 * widthPx)) / widthPx;
}

/** Thin labels to what fits in widthPx: must-keeps first (nudged apart and clamped at both ends), the rest
 *  where they fit wholly inside, never overlapping. */
export function thinLabels(labels: readonly StripLabel[], widthPx: number): StripLabel[] {
  if (!labels.length || widthPx <= 0) return labels.filter((l) => l.firstOfMonth || l.isNext).map((l) => ({ ...l }));
  const GAP = 8;
  const w = new Map<StripLabel, number>(labels.map((l) => [l, labelWidth(l)]));
  const must = labels.filter((l) => l.firstOfMonth || l.isNext);
  const rest = labels.filter((l) => !l.firstOfMonth && !l.isNext);
  const out: StripLabel[] = [];
  let right = -Infinity;
  // Must-keeps in order, each nudged right past the last when they would touch, and in from the left end.
  for (const l of must) {
    const half = w.get(l)! / 2;
    let x = l.x01 * widthPx;
    if (x - half < right + GAP) x = right + GAP + half;
    if (x - half < 0) x = half;
    right = x + half;
    out.push({ ...l, x01: x / widthPx });
  }
  // Then back in from the right end, each nudged left past the next when they would touch.
  let left = Infinity;
  for (let i = out.length - 1; i >= 0; i--) {
    const half = w.get(must[i])! / 2;
    let x = out[i].x01 * widthPx;
    if (x + half > widthPx) x = widthPx - half;
    if (x + half > left - GAP) x = left - GAP - half;
    left = x - half;
    out[i] = { ...out[i], x01: x / widthPx };
  }
  out.sort((a, b) => a.x01 - b.x01);
  // The rest where they fit between (and around) what is kept, wholly inside and never touching.
  const spans = out.map((l) => ({ l, half: w.get(labels.find((x) => x.day === l.day)!)! / 2, x: l.x01 * widthPx }));
  for (const l of rest) {
    const half = w.get(l)! / 2;
    const x = clampedLabel01(l.x01, w.get(l)!, widthPx) * widthPx;
    if (spans.every((s) => x + half + GAP <= s.x - s.half || x - half - GAP >= s.x + s.half)) {
      spans.push({ l, half, x });
      out.push({ ...l, x01: x / widthPx });
    }
  }
  return out.sort((a, b) => a.x01 - b.x01);
}
