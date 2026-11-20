// What changed between two versions of a note, for the assistant's suggested changes and the earlier versions' view
// (19 Oct 2026, 5.0.0: "AI edits you approve", and earlier versions that say who made each change). Lines are compared
// first (a change is the lines it touches), then narrowed to the words that differ, so a suggestion covers as little of
// the note as it can: the person's typing elsewhere on the page never puts it out of date.

/** Lines with their line breaks, so joined they are the text again. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export type DiffOp = 'same' | 'del' | 'add';

/** Above this many cells the middle of two long, very different texts is taken as one change (it stays quick). */
const MAX_CELLS = 4_000_000;

/**
 * Two lists compared: each item of `a` kept or taken out, each of `b` kept or added, in order. The same start and end
 * are taken off first (most changes are small), then the longest run in common is found for the middle.
 */
export function diffSeq<T>(a: readonly T[], b: readonly T[]): [DiffOp, T][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: [DiffOp, T][] = [];
  for (let i = 0; i < start; i++) out.push(['same', a[i]]);
  const n = endA - start;
  const m = endB - start;
  if (n && m && (n + 1) * (m + 1) <= MAX_CELLS) {
    // lcs[i][j]: the longest run in common of a[start+i…] and b[start+j…].
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push(['same', a[start + i]]);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) out.push(['del', a[start + i++]]);
      else out.push(['add', b[start + j++]]);
    }
    while (i < n) out.push(['del', a[start + i++]]);
    while (j < m) out.push(['add', b[start + j++]]);
  } else {
    for (let i = start; i < endA; i++) out.push(['del', a[i]]);
    for (let j = start; j < endB; j++) out.push(['add', b[j]]);
  }
  for (let i = endA; i < a.length; i++) out.push(['same', a[i]]);
  return out;
}

/** One suggested change: the words from `from` to `to` (the note as it is) become `insert`. `old` is what it replaces,
 *  checked again before it is kept; `stale` when the person changed that part since (it can only be discarded). */
export interface Hunk {
  id: string;
  from: number;
  to: number;
  old: string;
  insert: string;
  stale?: boolean;
}

/** A change cut between words: at the start or end, or beside a space. */
const isCut = (s: string, p: number) => p === 0 || p === s.length || /\s/.test(s[p - 1]) || /\s/.test(s[p]);

/** A change narrowed to the words that differ (whole words, so "colour" → "color" reads as a word changed). */
function narrow(old: string, insert: string): { head: number; tail: number } {
  let head = 0;
  const max = Math.min(old.length, insert.length);
  while (head < max && old[head] === insert[head]) head++;
  while (head > 0 && !(isCut(old, head) && isCut(insert, head))) head--;
  let tail = 0;
  while (tail < max - head && old[old.length - 1 - tail] === insert[insert.length - 1 - tail]) tail++;
  while (tail > 0 && !(isCut(old, old.length - tail) && isCut(insert, insert.length - tail))) tail--;
  return { head, tail };
}

/** The changes that turn `base` into `after`, each as small as it can be, in order. */
export function hunks(base: string, after: string): Hunk[] {
  if (base === after) return [];
  const A = splitLines(base);
  const B = splitLines(after);
  const out: Hunk[] = [];
  let offset = 0;
  let pending: { from: number; old: string[]; insert: string[] } | null = null;
  const push = (from: number, old: string, insert: string) => {
    const { head, tail } = narrow(old, insert);
    const o = old.slice(head, old.length - tail);
    const ins = insert.slice(head, insert.length - tail);
    if (o !== ins) out.push({ id: `c${out.length + 1}`, from: from + head, to: from + head + o.length, old: o, insert: ins });
  };
  const flush = () => {
    if (!pending) return;
    const { from, old, insert } = pending;
    pending = null;
    // Lines changed one for one (each line next to the last edited): a change for each line, kept or discarded alone.
    if (old.length > 1 && old.length === insert.length) {
      let at = from;
      old.forEach((line, i) => {
        push(at, line, insert[i]);
        at += line.length;
      });
    } else push(from, old.join(''), insert.join(''));
  };
  for (const [op, line] of diffSeq(A, B)) {
    if (op === 'same') {
      flush();
      offset += line.length;
      continue;
    }
    pending ??= { from: offset, old: [], insert: [] };
    if (op === 'del') {
      pending.old.push(line);
      offset += line.length;
    } else pending.insert.push(line);
  }
  flush();
  return out;
}

/** The smallest single change that turns `from` into `to`. */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endA = from.length;
  let endB = to.length;
  while (endA > start && endB > start && from.charCodeAt(endA - 1) === to.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: to.slice(start, endB) };
}

/**
 * Suggestions carried through one change to the note (the person typing): those before it move, those after it stay,
 * and one the change touches is out of date (it no longer says what it would replace). An out-of-date one is kept as a
 * point where the change began, for its Discard to show.
 */
export function mapHunks(list: Hunk[], change: { from: number; to: number; insert: string } | null): Hunk[] {
  if (!change) return list;
  const delta = change.insert.length - (change.to - change.from);
  return list.map((h) => {
    // Before it (typing just in front of one moves it along), or after it.
    if (change.to <= h.from) return delta ? { ...h, from: h.from + delta, to: h.to + delta } : h;
    if (change.from >= h.to) return h;
    const at = Math.min(h.from, change.from);
    return { ...h, stale: true, from: at, to: at };
  });
}

/** Where each line starts in its text (and one more: the end). */
function lineStarts(lines: string[]): number[] {
  const out = [0];
  for (const l of lines) out.push(out[out.length - 1] + l.length);
  return out;
}

/**
 * Suggestions made against one text placed on another (the note changed in many places since, on disk or by a sync):
 * each one whose lines are still there, unchanged, moves with them; any other is out of date.
 */
export function rebaseHunks(list: Hunk[], from: string, to: string): Hunk[] {
  if (from === to || !list.length) return list;
  const A = splitLines(from);
  const B = splitLines(to);
  const startA = lineStarts(A);
  const startB = lineStarts(B);
  // Each line of `from` that is still in `to`, by its number there.
  const where = new Int32Array(A.length + 1).fill(-1);
  let i = 0;
  let j = 0;
  for (const [op] of diffSeq(A, B)) {
    if (op === 'same') where[i++] = j++;
    else if (op === 'del') i++;
    else j++;
  }
  // The end of the text counts as a line that is there when the last lines are.
  where[A.length] = A.length === 0 || where[A.length - 1] === B.length - 1 ? B.length : -1;
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = A.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (startA[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  /** Where a place in `from` is in `to`: the same place when its line is still there, else the start of the nearest line
   *  before it that is. */
  const pointAt = (pos: number) => {
    const line = lineOf(Math.min(pos, from.length));
    if (where[line] >= 0) return Math.min(to.length, startB[where[line]] + Math.min(pos - startA[line], (A[line] ?? '').length));
    for (let k = line - 1; k >= 0; k--) if (where[k] >= 0) return startB[where[k]];
    return 0;
  };
  const outOfDate = (h: Hunk): Hunk => {
    const p = pointAt(h.from);
    return { ...h, stale: true, from: p, to: p };
  };
  return list.map((h) => {
    if (h.stale) return outOfDate(h);
    const first = lineOf(h.from);
    const last = h.to > h.from ? lineOf(h.to - 1) : first;
    const at = where[first];
    let ok = at >= 0;
    for (let k = first + 1; ok && k <= last; k++) ok = where[k] === at + (k - first);
    if (!ok) return outOfDate(h);
    const moved = { ...h, from: startB[at] + (h.from - startA[first]), to: startB[at] + (h.to - startA[first]) };
    return to.slice(moved.from, moved.to) === h.old ? moved : outOfDate(h);
  });
}

/** Suggestions for `base` → `after`, placed on the note as it is now (`current`). */
export function placeHunks(base: string, after: string, current: string): Hunk[] {
  return rebaseHunks(hunks(base, after), base, current);
}

/** The note with these suggestions kept (those still in date and still matching); the rest are left out. */
export function applyHunks(text: string, list: Hunk[]): string {
  let out = text;
  for (const h of [...list].filter((x) => !x.stale).sort((a, b) => b.from - a.from)) {
    if (out.slice(h.from, h.to) !== h.old) continue;
    out = out.slice(0, h.from) + h.insert + out.slice(h.to);
  }
  return out;
}

export interface Part {
  kind: DiffOp;
  text: string;
}

/** Words, spaces and marks: what a change inside a line is measured in. */
const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];

/**
 * A change within a line, word by word: what stays, what goes, what comes in. Mostly rewritten, it reads better as the
 * old words out and the new words in, whole.
 */
export function wordParts(old: string, insert: string): Part[] {
  if (!old) return insert ? [{ kind: 'add', text: insert }] : [];
  if (!insert) return [{ kind: 'del', text: old }];
  const ops = diffSeq(tokens(old), tokens(insert));
  const same = ops.filter(([op]) => op === 'same').reduce((n, [, t]) => n + t.trim().length, 0);
  if (same < Math.min(old.replace(/\s/g, '').length, insert.replace(/\s/g, '').length) * 0.4) {
    return [
      { kind: 'del', text: old },
      { kind: 'add', text: insert },
    ];
  }
  const out: Part[] = [];
  for (const [kind, text] of ops) {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  }
  return out;
}

/** How a suggestion shows in the note: changed words in their line, or lines out and lines in. */
export function hunkLook(h: Pick<Hunk, 'old' | 'insert'>): 'inline' | 'lines' {
  return h.old.includes('\n') || h.insert.includes('\n') ? 'lines' : 'inline';
}

export type ChangeRow = { kind: DiffOp; text: string } | { kind: 'gap'; count: number };

/**
 * What changed from one version to the next, line by line, for the earlier versions' view: the lines taken out and
 * put in, with a little of what stayed around them; long runs that stayed the same fold into "12 lines the same".
 */
export function changeRows(before: string, after: string, context = 2): ChangeRow[] {
  const ops = diffSeq(splitLines(before), splitLines(after)).map(([kind, line]) => ({ kind, text: line.replace(/\r?\n$/, '') }));
  const near = new Uint8Array(ops.length);
  ops.forEach((o, i) => {
    if (o.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) near[k] = 1;
  });
  const out: ChangeRow[] = [];
  let gap = 0;
  ops.forEach((o, i) => {
    if (o.kind !== 'same' || near[i]) {
      if (gap) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(o);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}

/** Lines added and taken out from one version to the next ("+3 −1"). */
export function changeCounts(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const [op] of diffSeq(splitLines(before), splitLines(after))) {
    if (op === 'add') added++;
    else if (op === 'del') removed++;
  }
  return { added, removed };
}
