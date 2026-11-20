// A page's one summary line ("18 projects · 11 at risk · 7 on track · 2 due within a week"): its parts, and the
// line they make joined with " · " (Polish round 3, 29 Oct 2026, ITEMS 2: the Projects summary had lost its
// separators, so its words ran together). Every summary line builds its parts here, so no part is ever drawn
// straight against the next. Pure, so it is proved without a window (tests/polish-round3.test.mjs).

/** One part of a summary line, coloured only when it needs attention. */
export interface SummaryPart {
  words: string;
  tone?: 'bad' | 'warn' | 'ok' | 'none';
}

/** The parts that are there, in order: nothing, no words and empty words leave no gap in the line. */
export function summaryParts(parts: readonly (SummaryPart | false | null | undefined)[]): SummaryPart[] {
  return parts.filter((p): p is SummaryPart => !!p && !!p.words);
}

/** The whole line, its parts joined with " · ": "18 projects · 11 at risk". One part stands alone. */
export function summaryLine(parts: readonly (SummaryPart | false | null | undefined)[]): string {
  return summaryParts(parts)
    .map((p) => p.words)
    .join(' · ');
}
