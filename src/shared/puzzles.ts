// The puzzle engine for Publications (Wave 6 part a, 24 Oct 2026; the plan, 22 Oct: "Puzzle engine: generate, store
// answers, print yesterday's answers automatically, and track the household's solve times"). Four kinds, each made from
// what the person or an assistant gives (a word list with clues, a few words, a difficulty), each with its answers kept
// beside it and a check that says whether it is sound:
//   - crossword     words and clues laid across and down, joined where they share a letter, numbered as a paper does;
//   - sudoku        a 9 × 9 grid with exactly one answer (checked by solving it), at an easy, medium or hard clue count;
//   - word search   words hidden in a square of letters (across and down only, or every way including backwards);
//   - daily word    a word to find from a few guesses already marked as a word game marks them (right place, in the
//                   word, not in it), with the guesses chosen so the marks leave as few words as possible.
// Everything comes from a seed, so the same words and seed always make the same puzzle (a puzzle can be made again, and a
// test can check one). Pure: no files, no Node, no DOM.

// ── A seeded random ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A seed from any words (the same words, the same seed). */
export function seedOf(words: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < words.length; i++) {
    h ^= words.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A random number maker (mulberry32): the same seed, the same numbers. */
export function randomFrom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A word as a grid takes it: capital letters A to Z only ("Rock 'n' roll" → ROCKNROLL). */
export const gridWord = (w: string): string =>
  String(w ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

/** A crossword answer's lengths as a paper prints them ("Silver fern" → "6,4"). */
export function enumeration(w: string): string {
  const parts = String(w ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s-]+/)
    .map((p) => p.replace(/[^A-Za-z]/g, '').length)
    .filter((n) => n > 0);
  return parts.join(',');
}

// ── Crossword ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CrosswordEntry {
  n: number;
  /** The answer as the grid has it (capitals, no spaces). */
  answer: string;
  /** The answer as it was given ("Silver fern"), for the answers. */
  words: string;
  clue: string;
  row: number;
  col: number;
  enumeration: string;
}

export interface Crossword {
  kind: 'crossword';
  width: number;
  height: number;
  /** Each row: a letter per open square, '#' for a black one. */
  grid: string[];
  across: CrosswordEntry[];
  down: CrosswordEntry[];
  /** Words that couldn't be joined into the grid (said, never silently dropped). */
  left: string[];
  seed: number;
}

export interface ClueInput {
  answer: string;
  clue: string;
}

/** Lines of "ANSWER — clue" (or "answer: clue", "answer | clue", "answer - clue") read as entries. */
export function readClueLines(text: string): ClueInput[] {
  const out: ClueInput[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:—|–|\||:|\s-\s|\t)\s*(.+)$/.exec(line);
    const answer = (m ? m[1]! : line).trim();
    if (gridWord(answer).length < 2) continue;
    out.push({ answer, clue: (m ? m[2]! : '').trim() });
  }
  return out;
}

type Dir = 'across' | 'down';
interface Placed {
  word: string;
  words: string;
  clue: string;
  row: number;
  col: number;
  dir: Dir;
}

const DR: Record<Dir, [number, number]> = { across: [0, 1], down: [1, 0] };

class Board {
  cells = new Map<string, string>();
  minR = 0;
  maxR = -1;
  minC = 0;
  maxC = -1;
  placed: Placed[] = [];
  at(r: number, c: number): string | undefined {
    return this.cells.get(`${r},${c}`);
  }
  /** How many squares a word would share there, or -1 when it can't go there. */
  fits(word: string, r: number, c: number, dir: Dir, max: number): number {
    const [dr, dc] = DR[dir];
    const er = r + dr * (word.length - 1);
    const ec = c + dc * (word.length - 1);
    if (this.placed.length) {
      const h = Math.max(this.maxR, er) - Math.min(this.minR, r) + 1;
      const w = Math.max(this.maxC, ec) - Math.min(this.minC, c) + 1;
      if (h > max || w > max) return -1;
    } else if (word.length > max) return -1;
    // The squares just before and after the word stay black.
    if (this.at(r - dr, c - dc) !== undefined || this.at(er + dr, ec + dc) !== undefined) return -1;
    let shared = 0;
    for (let i = 0; i < word.length; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      const have = this.at(rr, cc);
      if (have !== undefined) {
        if (have !== word[i]) return -1;
        // A square already crossed the same way would run two words together.
        if (this.placed.some((p) => p.dir === dir && onWord(p, rr, cc))) return -1;
        shared++;
        continue;
      }
      // A new square: nothing beside it across the word's way (else it would make a word nobody clued).
      const [sr, sc] = dir === 'across' ? [1, 0] : [0, 1];
      if (this.at(rr + sr, cc + sc) !== undefined || this.at(rr - sr, cc - sc) !== undefined) return -1;
    }
    return shared;
  }
  put(p: Placed): void {
    const [dr, dc] = DR[p.dir];
    for (let i = 0; i < p.word.length; i++) this.cells.set(`${p.row + dr * i},${p.col + dc * i}`, p.word[i]!);
    const er = p.row + dr * (p.word.length - 1);
    const ec = p.col + dc * (p.word.length - 1);
    if (!this.placed.length) {
      this.minR = p.row;
      this.minC = p.col;
      this.maxR = er;
      this.maxC = ec;
    } else {
      this.minR = Math.min(this.minR, p.row);
      this.minC = Math.min(this.minC, p.col);
      this.maxR = Math.max(this.maxR, er);
      this.maxC = Math.max(this.maxC, ec);
    }
    this.placed.push(p);
  }
}

function onWord(p: Placed, r: number, c: number): boolean {
  const [dr, dc] = DR[p.dir];
  for (let i = 0; i < p.word.length; i++) if (p.row + dr * i === r && p.col + dc * i === c) return true;
  return false;
}

function layOnce(entries: { word: string; words: string; clue: string }[], max: number, rnd: () => number): Board {
  const b = new Board();
  const [first, ...rest] = entries;
  if (!first) return b;
  b.put({ ...first, row: 0, col: 0, dir: rnd() < 0.5 ? 'across' : 'down' });
  let waiting = rest;
  // Words that found no crossing yet are tried again once others are in.
  for (let pass = 0; pass < 3 && waiting.length; pass++) {
    const still: typeof waiting = [];
    for (const e of waiting) {
      let best: { r: number; c: number; dir: Dir; score: number } | null = null;
      for (const p of b.placed) {
        const dir: Dir = p.dir === 'across' ? 'down' : 'across';
        const [pdr, pdc] = DR[p.dir];
        for (let i = 0; i < p.word.length; i++) {
          for (let j = 0; j < e.word.length; j++) {
            if (p.word[i] !== e.word[j]) continue;
            const [dr, dc] = DR[dir];
            const r = p.row + pdr * i - dr * j;
            const c = p.col + pdc * i - dc * j;
            const shared = b.fits(e.word, r, c, dir, max);
            if (shared < 1) continue;
            // More crossings first, then the squarer, smaller grid, then a little chance (so tries differ).
            const h = Math.max(b.maxR, r + dr * (e.word.length - 1)) - Math.min(b.minR, r) + 1;
            const w = Math.max(b.maxC, c + dc * (e.word.length - 1)) - Math.min(b.minC, c) + 1;
            const score = shared * 10 - Math.max(h, w) * 0.6 - Math.abs(h - w) * 0.3 + rnd();
            if (!best || score > best.score) best = { r, c, dir, score };
          }
        }
      }
      if (best) b.put({ ...e, row: best.r, col: best.c, dir: best.dir });
      else still.push(e);
    }
    waiting = still;
  }
  return b;
}

/**
 * A crossword from answers and clues: the most words joined, in the smallest grid, from a number of tries (the same entries
 * and seed always give the same grid). `size` is the most squares across or down (15 unless given, 5 to 25).
 */
export function makeCrossword(input: readonly ClueInput[], o: { size?: number; seed?: number; tries?: number } = {}): Crossword {
  const max = Math.max(5, Math.min(25, Math.round(o.size ?? 15)));
  const seen = new Set<string>();
  const entries = input
    .map((e) => ({ word: gridWord(e.answer), words: String(e.answer ?? '').trim(), clue: String(e.clue ?? '').trim() }))
    .filter((e) => e.word.length >= 2 && e.word.length <= max && !seen.has(e.word) && (seen.add(e.word), true))
    .slice(0, 60);
  const tooLong = input.map((e) => String(e.answer ?? '').trim()).filter((w) => gridWord(w).length > max);
  const seed = o.seed ?? seedOf(entries.map((e) => e.word).join(' '));
  const rnd = randomFrom(seed);
  let best: Board | null = null;
  const tries = Math.max(1, Math.min(400, o.tries ?? 120));
  for (let t = 0; t < tries; t++) {
    // Longest words first (they give the most to cross), the order shaken a little each try.
    const order = shuffle(entries, rnd).sort((a, b) => b.word.length - a.word.length + (rnd() - 0.5) * (t ? 3 : 0));
    const b = layOnce(order, max, rnd);
    if (!best) best = b;
    else {
      const area = (x: Board) => (x.maxR - x.minR + 1) * (x.maxC - x.minC + 1);
      const crossings = (x: Board) => [...x.cells.keys()].length;
      if (b.placed.length > best.placed.length || (b.placed.length === best.placed.length && (area(b) < area(best) || (area(b) === area(best) && crossings(b) < crossings(best))))) best = b;
    }
    if (best.placed.length === entries.length && t > 20) break;
  }
  const board = best ?? new Board();
  const height = board.placed.length ? board.maxR - board.minR + 1 : 0;
  const width = board.placed.length ? board.maxC - board.minC + 1 : 0;
  const grid: string[] = [];
  for (let r = 0; r < height; r++) {
    let row = '';
    for (let c = 0; c < width; c++) row += board.at(r + board.minR, c + board.minC) ?? '#';
    grid.push(row);
  }
  // Numbered as a paper does: left to right, top to bottom, one number per square that starts a word.
  const starts = board.placed.map((p) => ({ ...p, row: p.row - board.minR, col: p.col - board.minC }));
  const numbers = new Map<string, number>();
  let n = 0;
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      if (starts.some((p) => p.row === r && p.col === c)) numbers.set(`${r},${c}`, ++n);
  const entryOf = (p: (typeof starts)[number]): CrosswordEntry => ({ n: numbers.get(`${p.row},${p.col}`)!, answer: p.word, words: p.words, clue: p.clue, row: p.row, col: p.col, enumeration: enumeration(p.words) || String(p.word.length) });
  const placedWords = new Set(board.placed.map((p) => p.word));
  return {
    kind: 'crossword',
    width,
    height,
    grid,
    across: starts.filter((p) => p.dir === 'across').map(entryOf).sort((a, b) => a.n - b.n),
    down: starts.filter((p) => p.dir === 'down').map(entryOf).sort((a, b) => a.n - b.n),
    left: [...entries.filter((e) => !placedWords.has(e.word)).map((e) => e.words), ...tooLong],
    seed,
  };
}

/** What is wrong with a crossword, in words (none: it is sound): every answer where its squares say, every run of two or
 *  more letters one of its answers, every entry numbered where it starts, and every clue written. */
export function checkCrossword(p: Crossword): string[] {
  const out: string[] = [];
  const cell = (r: number, c: number) => (r >= 0 && c >= 0 && r < p.height && c < p.width ? p.grid[r]![c]! : '#');
  const words = new Set<string>();
  for (const [dir, list] of [['across', p.across], ['down', p.down]] as const) {
    for (const e of list) {
      const [dr, dc] = DR[dir];
      let got = '';
      for (let i = 0; i < e.answer.length; i++) got += cell(e.row + dr * i, e.col + dc * i);
      if (got !== e.answer) out.push(`${e.n} ${dir} reads ${got}, not ${e.answer}.`);
      if (cell(e.row - dr, e.col - dc) !== '#' || cell(e.row + dr * e.answer.length, e.col + dc * e.answer.length) !== '#') out.push(`${e.n} ${dir} runs into another word.`);
      if (!e.clue) out.push(`${e.n} ${dir} (${e.words}) has no clue.`);
      words.add(`${dir}:${e.row},${e.col}`);
    }
  }
  // Every run of two or more letters is an entry.
  for (let r = 0; r < p.height; r++)
    for (let c = 0; c < p.width; c++) {
      if (cell(r, c) === '#') continue;
      if (cell(r, c - 1) === '#' && cell(r, c + 1) !== '#' && !words.has(`across:${r},${c}`)) out.push(`Row ${r + 1} has letters across from column ${c + 1} that no clue asks for.`);
      if (cell(r - 1, c) === '#' && cell(r + 1, c) !== '#' && !words.has(`down:${r},${c}`)) out.push(`Column ${c + 1} has letters down from row ${r + 1} that no clue asks for.`);
    }
  // Numbers in order.
  const all = [...p.across, ...p.down].sort((a, b) => a.row - b.row || a.col - b.col);
  let last = 0;
  for (const e of all) {
    if (e.n < last) out.push(`${e.n} is numbered out of order.`);
    last = Math.max(last, e.n);
  }
  return out;
}

// ── Sudoku ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTY_CLUES: Record<Difficulty, number> = { easy: 38, medium: 31, hard: 26 };
export const DIFFICULTY_WORDS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export interface Sudoku {
  kind: 'sudoku';
  /** 81 characters, row by row: a digit given, '.' for a square to fill. */
  grid: string;
  /** 81 digits: the one answer. */
  solution: string;
  difficulty: Difficulty;
  clues: number;
  seed: number;
}

const ROW = (i: number) => Math.floor(i / 9);
const COL = (i: number) => i % 9;
const BOX = (i: number) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set<number>();
  for (let j = 0; j < 81; j++) if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) s.add(j);
  return [...s];
});

/** How many answers a grid has, counted up to `limit` (0: none, 1: exactly one). */
export function countSolutions(grid: readonly number[], limit = 2): number {
  const g = [...grid];
  let count = 0;
  const solve = (): boolean => {
    // The square with the fewest choices next.
    let best = -1;
    let bestOpts: number[] = [];
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const used = new Set(PEERS[i]!.map((j) => g[j]));
      const opts = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !used.has(d));
      if (!opts.length) return false;
      if (best < 0 || opts.length < bestOpts.length) {
        best = i;
        bestOpts = opts;
        if (opts.length === 1) break;
      }
    }
    if (best < 0) {
      count++;
      return count >= limit;
    }
    for (const d of bestOpts) {
      g[best] = d;
      if (solve()) return true;
    }
    g[best] = 0;
    return false;
  };
  solve();
  return count;
}

function fullGrid(rnd: () => number): number[] {
  const g = new Array<number>(81).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const used = new Set(PEERS[i]!.map((j) => g[j]));
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd)) {
      if (used.has(d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

/** A sudoku with exactly one answer: squares taken away (in pairs that mirror, as papers print them) while it still has
 *  one, down to the difficulty's number of givens. */
export function makeSudoku(o: { difficulty?: Difficulty | string; seed?: number } = {}): Sudoku {
  const difficulty: Difficulty = o.difficulty === 'easy' || o.difficulty === 'hard' ? o.difficulty : 'medium';
  const seed = o.seed ?? seedOf(`sudoku ${difficulty} ${Date.now()}`);
  const rnd = randomFrom(seed);
  const solution = fullGrid(rnd);
  const g = [...solution];
  const target = DIFFICULTY_CLUES[difficulty];
  let given = 81;
  for (const i of shuffle([...Array(41).keys()], rnd)) {
    if (given <= target) break;
    const j = 80 - i;
    const keep = [g[i]!, g[j]!];
    g[i] = 0;
    g[j] = 0;
    if (countSolutions(g, 2) !== 1) {
      g[i] = keep[0]!;
      g[j] = keep[1]!;
      continue;
    }
    given -= i === j ? 1 : 2;
  }
  // Still above the difficulty's count: single squares, where taking one keeps it to one answer.
  for (const i of shuffle([...Array(81).keys()], rnd)) {
    if (given <= target) break;
    if (!g[i]) continue;
    const keep = g[i]!;
    g[i] = 0;
    if (countSolutions(g, 2) !== 1) g[i] = keep;
    else given--;
  }
  return { kind: 'sudoku', grid: g.map((d) => (d ? String(d) : '.')).join(''), solution: solution.join(''), difficulty, clues: given, seed };
}

/** What is wrong with a sudoku, in words (none: it is sound). */
export function checkSudoku(p: Sudoku): string[] {
  const out: string[] = [];
  if (!/^[1-9.]{81}$/.test(p.grid) || !/^[1-9]{81}$/.test(p.solution)) return ['The grid isn’t 81 squares.'];
  for (let i = 0; i < 81; i++) if (p.grid[i] !== '.' && p.grid[i] !== p.solution[i]) out.push(`Square ${i + 1} is given as ${p.grid[i]} but the answer has ${p.solution[i]}.`);
  const sol = [...p.solution].map(Number);
  for (let i = 0; i < 81; i++) if (PEERS[i]!.some((j) => sol[j] === sol[i])) {
    out.push('The answer repeats a digit in a row, column or box.');
    break;
  }
  const n = countSolutions([...p.grid].map((c) => (c === '.' ? 0 : Number(c))), 2);
  if (n !== 1) out.push(n === 0 ? 'The grid has no answer.' : 'The grid has more than one answer.');
  return out;
}

// ── Word search ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WordSearchWord {
  word: string;
  /** As given, for the list printed beside the grid. */
  words: string;
  row: number;
  col: number;
  dr: number;
  dc: number;
}

export interface WordSearch {
  kind: 'wordsearch';
  size: number;
  rows: string[];
  words: WordSearchWord[];
  /** Too long, or no room: said, never silently dropped. */
  left: string[];
  ways: 'easy' | 'hard';
  seed: number;
}

const EASY_WAYS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
];
const ALL_WAYS: [number, number][] = [...EASY_WAYS, [0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]];
const FILL = 'EEEEEAAAARRRIIIOOOTTTNNNSSSLLCCUUDDPPMMHHGBFYWKVXZJQ';

/** Words hidden in a square of letters: across, down and diagonally (easy), or every way including backwards (hard). */
export function makeWordSearch(input: readonly string[], o: { size?: number; ways?: 'easy' | 'hard' | string; seed?: number } = {}): WordSearch {
  const ways: 'easy' | 'hard' = o.ways === 'hard' ? 'hard' : 'easy';
  const seen = new Set<string>();
  const list = input
    .map((w) => ({ word: gridWord(w), words: String(w ?? '').trim() }))
    .filter((w) => w.word.length >= 3 && !seen.has(w.word) && (seen.add(w.word), true))
    .slice(0, 40);
  const longest = Math.max(0, ...list.map((w) => w.word.length));
  const size = Math.max(8, Math.min(20, Math.round(o.size ?? Math.max(10, longest + 2, Math.ceil(Math.sqrt(list.reduce((a, w) => a + w.word.length, 0) * 2.2))))));
  const seed = o.seed ?? seedOf(`${list.map((w) => w.word).join(' ')} ${size} ${ways}`);
  const rnd = randomFrom(seed);
  const dirs = ways === 'hard' ? ALL_WAYS : EASY_WAYS;
  let best: { cells: (string | null)[][]; placed: WordSearchWord[] } | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const cells: (string | null)[][] = Array.from({ length: size }, () => new Array<string | null>(size).fill(null));
    const placed: WordSearchWord[] = [];
    for (const w of [...list].sort((a, b) => b.word.length - a.word.length)) {
      if (w.word.length > size) continue;
      const spots: { r: number; c: number; dr: number; dc: number; overlap: number }[] = [];
      for (const [dr, dc] of dirs)
        for (let r = 0; r < size; r++)
          for (let c = 0; c < size; c++) {
            const er = r + dr * (w.word.length - 1);
            const ec = c + dc * (w.word.length - 1);
            if (er < 0 || ec < 0 || er >= size || ec >= size) continue;
            let overlap = 0;
            let ok = true;
            for (let i = 0; i < w.word.length; i++) {
              const have = cells[r + dr * i]![c + dc * i];
              if (have === null) continue;
              if (have !== w.word[i]) {
                ok = false;
                break;
              }
              overlap++;
            }
            if (ok && overlap < w.word.length) spots.push({ r, c, dr, dc, overlap });
          }
      if (!spots.length) continue;
      // A little sharing of letters is good; a random spot among the better ones.
      spots.sort((a, b) => b.overlap - a.overlap + (rnd() - 0.5) * 2.5);
      const s = spots[Math.floor(rnd() * Math.min(spots.length, 12))]!;
      for (let i = 0; i < w.word.length; i++) cells[s.r + s.dr * i]![s.c + s.dc * i] = w.word[i]!;
      placed.push({ word: w.word, words: w.words, row: s.r, col: s.c, dr: s.dr, dc: s.dc });
    }
    if (!best || placed.length > best.placed.length) best = { cells, placed };
    if (placed.length === list.filter((w) => w.word.length <= size).length) break;
  }
  const { cells, placed } = best ?? { cells: [], placed: [] };
  const rows = cells.map((row) => row.map((ch) => ch ?? FILL[Math.floor(rnd() * FILL.length)]!).join(''));
  const got = new Set(placed.map((p) => p.word));
  return { kind: 'wordsearch', size, rows, words: placed.sort((a, b) => a.words.localeCompare(b.words)), left: list.filter((w) => !got.has(w.word)).map((w) => w.words), ways, seed };
}

/** What is wrong with a word search, in words (none: every word is where it says). */
export function checkWordSearch(p: WordSearch): string[] {
  const out: string[] = [];
  if (p.rows.length !== p.size || p.rows.some((r) => r.length !== p.size || !/^[A-Z]+$/.test(r))) out.push('The grid isn’t a square of letters.');
  for (const w of p.words) {
    let got = '';
    for (let i = 0; i < w.word.length; i++) got += p.rows[w.row + w.dr * i]?.[w.col + w.dc * i] ?? '?';
    if (got !== w.word) out.push(`${w.words} isn’t where it says (it reads ${got}).`);
  }
  return out;
}

/** The way a hidden word runs, in words (for the answers). */
export function wayWords(dr: number, dc: number): string {
  const v = dr > 0 ? 'down' : dr < 0 ? 'up' : '';
  const h = dc > 0 ? 'right' : dc < 0 ? 'left' : '';
  return v && h ? `${v} and ${h}` : v || h;
}

// ── Daily word ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Mark = 'right' | 'present' | 'absent';

export interface DailyWord {
  kind: 'dailyword';
  answer: string;
  length: number;
  guesses: { word: string; marks: Mark[] }[];
  /** How many words in the list the marks still leave (1: only the answer). */
  fits: number;
  seed: number;
}

/** The marks a word game gives a guess against the answer (a letter guessed twice is marked once per time it is there). */
export function marksOf(guess: string, answer: string): Mark[] {
  const g = gridWord(guess);
  const a = gridWord(answer);
  const marks: Mark[] = new Array<Mark>(g.length).fill('absent');
  const left = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) marks[i] = 'right';
    else left.set(a[i]!, (left.get(a[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'right') continue;
    const n = left.get(g[i]!) ?? 0;
    if (n > 0) {
      marks[i] = 'present';
      left.set(g[i]!, n - 1);
    }
  }
  return marks;
}

/** Everyday five-letter words, for a daily word when no list is given (plain English, nothing rude). */
export const DAILY_WORDS = (
  'about above actor acute adopt adult after again agent agree ahead alarm album alert alike alive allow alone along alter amber among angle angry ankle apple apply apron arena argue arise armor aroma arrow aside asset audio avoid award aware bacon badge baker basic basin beach beard beast begin being bench berry birth black blade blank blend bless blind block bloom board boast bonus boost booth brain brake brand brave bread break brick bride brief bring broad brown brush build bunch burst cabin cable camel candy canoe cargo carry catch cause chain chair chalk charm chart chase cheap check cheek cheer chess chest chief child chill chord civic claim class clean clear clerk click cliff climb clock close cloth cloud coach coast cocoa colour coral couch count court cover craft crane crash cream crest crisp crowd crown crumb crust curve cycle daily dairy dance delta depth diary dizzy dough draft drama dream dress drift drink drive eager eagle early earth easel eight elbow elder elect empty enjoy enter entry equal error essay event every exact exist extra fable faint fairy faith false feast fence ferry fetch fever fibre field fifth fight final flame flash fleet flint float flock flood floor flour fluid flute focus force forge forum frame fresh front frost fruit fudge funny gamer giant glass gleam globe glove grace grade grain grand grape graph grass great green greet grill groan group grove guard guess guest guide habit happy harsh haven heart heavy hedge hello honey horse hotel house human humid hurry ideal image index inner input issue ivory jelly jewel joint jolly judge juice kayak kiosk knife knock koala label laser later laugh layer learn lemon level light linen liner local lodge logic lucky lunar lunch magic major maple march marsh match mayor medal melon merit metal meter midst might minor model money month moose motor mount mouse mouth movie music naval nerve never night noble noise north novel nurse ocean offer often olive onion opera orbit order organ otter outer owner oxide paint panel paper party pasta patch pause peace peach pearl pedal penny phone photo piano pilot pinch pitch pizza place plain plane plant plate plaza plume point polar porch pound power press price pride prime print prize proof proud prune pulse punch pupil puppy quail queen quest quick quiet quilt quota radar radio rainy rally ranch range rapid raven reach ready realm relax relay reply ridge rifle right rival river roast robin robot rocky rouge round route royal rugby ruler rural sable salad sauce scale scarf scene scone score scout screw seven shade shake shape share shark sharp sheep shelf shell shine shirt shore short shout sight skate skill skirt slate sleep slice slide slope small smart smile smoke snack snail snake solar solid sound south space spare spark speak spice spike spine spoon sport spray squad stack staff stage stair stamp stand start state steam steel stick still stone stool store storm story stove straw strip study style sugar suite sunny super surge swamp sweet swift table taste teach teeth thank theme thick thing think third thorn three throw thumb tiger toast today token topic torch total touch tough tower trace track trade trail train treat trend trial tribe trick truck truly trunk trust truth tulip tuner twist ultra uncle under union unity upper urban usual vapor vault verse video vigor vinyl viola visit vital vivid vocal voice wagon waist watch water whale wheat wheel while white whole width witty woman world worry wrist write yacht yeast young youth zebra'
)
  .split(/\s+/)
  .filter((w) => w.length === 5);

/** A word to find from a few marked guesses. The guesses are chosen from the list so their marks leave the fewest words
 *  (at most `guesses`, 4 unless given); `fits` says how many words they still leave. */
export function makeDailyWord(o: { answer?: string; words?: readonly string[]; guesses?: number; seed?: number; length?: number } = {}): DailyWord {
  const given = (o.words ?? []).map(gridWord).filter((w) => w.length >= 4 && w.length <= 7);
  const want = o.answer ? gridWord(o.answer) : '';
  const length = want.length || Math.max(4, Math.min(7, Math.round(o.length ?? 5)));
  const pool = [...new Set([...given, ...(length === 5 ? DAILY_WORDS.map(gridWord) : [])])].filter((w) => w.length === length);
  const seed = o.seed ?? seedOf(`${want} ${pool.length} ${given.join(' ')}`);
  const rnd = randomFrom(seed);
  const answer = want || (given.filter((w) => w.length === length).length ? shuffle(given.filter((w) => w.length === length), rnd)[0]! : pool[Math.floor(rnd() * pool.length)] ?? '');
  if (!answer) throw new Error(`Give a word to find (or a list of ${length}-letter words to choose from).`);
  const words = pool.includes(answer) ? pool : [...pool, answer];
  const most = Math.max(1, Math.min(5, Math.round(o.guesses ?? 4)));
  const guesses: { word: string; marks: Mark[] }[] = [];
  let left = words;
  const key = (m: Mark[]) => m.map((x) => x[0]).join('');
  for (let k = 0; k < most && left.length > 1; k++) {
    // The guess whose marks would leave the fewest words on average, from a sample of the list (never the answer).
    const sample = shuffle(words.filter((w) => w !== answer && !guesses.some((g) => g.word === w)), rnd).slice(0, 160);
    let best: { word: string; score: number } | null = null;
    for (const g of sample) {
      const buckets = new Map<string, number>();
      for (const w of left) buckets.set(key(marksOf(g, w)), (buckets.get(key(marksOf(g, w))) ?? 0) + 1);
      const score = [...buckets.values()].reduce((a, n) => a + n * n, 0) / left.length;
      if (!best || score < best.score) best = { word: g, score };
    }
    if (!best) break;
    const marks = marksOf(best.word, answer);
    guesses.push({ word: best.word, marks });
    left = left.filter((w) => key(marksOf(best!.word, w)) === key(marks));
  }
  return { kind: 'dailyword', answer, length, guesses, fits: left.length, seed };
}

/** What is wrong with a daily word, in words (none: each guess is marked as the answer says). */
export function checkDailyWord(p: DailyWord): string[] {
  const out: string[] = [];
  if (gridWord(p.answer).length !== p.length) out.push('The answer isn’t the length it says.');
  for (const g of p.guesses) {
    if (g.word.length !== p.length) out.push(`${g.word} isn’t ${p.length} letters.`);
    if (marksOf(g.word, p.answer).join() !== g.marks.join()) out.push(`${g.word} is marked wrongly.`);
    if (g.word === p.answer) out.push('A guess gives the answer away.');
  }
  return out;
}

// ── Any puzzle ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Puzzle = Crossword | Sudoku | WordSearch | DailyWord;
export const PUZZLE_KINDS = ['crossword', 'sudoku', 'wordsearch', 'dailyword'] as const;
export type PuzzleKind = (typeof PUZZLE_KINDS)[number];

export function checkPuzzle(p: Puzzle): string[] {
  if (p.kind === 'crossword') return checkCrossword(p);
  if (p.kind === 'sudoku') return checkSudoku(p);
  if (p.kind === 'wordsearch') return checkWordSearch(p);
  return checkDailyWord(p);
}

/** Every word a puzzle's answers hold (for searching: "the crossword with BOLAND in it"). */
export function puzzleWords(p: Puzzle): string[] {
  if (p.kind === 'crossword') return [...p.across, ...p.down].flatMap((e) => [e.answer, e.words, e.clue]);
  if (p.kind === 'wordsearch') return p.words.flatMap((w) => [w.word, w.words]);
  if (p.kind === 'dailyword') return [p.answer, ...p.guesses.map((g) => g.word)];
  return [];
}

/** A puzzle's answers in plain words (kept under ## Answers in its note, and printed in the next edition). */
export function answersText(p: Puzzle): string {
  if (p.kind === 'crossword')
    return [`**Across:** ${p.across.map((e) => `${e.n} ${e.words.toUpperCase()}`).join(', ')}`, `**Down:** ${p.down.map((e) => `${e.n} ${e.words.toUpperCase()}`).join(', ')}`].join('\n');
  if (p.kind === 'sudoku') return Array.from({ length: 9 }, (_, r) => p.solution.slice(r * 9, r * 9 + 9).replace(/(\d{3})(?=\d)/g, '$1 ')).join('\n');
  if (p.kind === 'wordsearch') return p.words.map((w) => `${w.words.toUpperCase()} (row ${w.row + 1}, column ${w.col + 1}, ${wayWords(w.dr, w.dc)})`).join('; ');
  return `The word was **${p.answer}**.`;
}

/** A puzzle read back from its note's ```puzzle block (anything not sound is null, never an error). */
export function readPuzzle(raw: unknown): Puzzle | null {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object') return null;
  const p = o as Record<string, unknown>;
  const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (p.kind === 'crossword' && strs(p.grid) && Array.isArray(p.across) && Array.isArray(p.down) && num(p.width) && num(p.height)) {
    const entry = (e: unknown): CrosswordEntry | null => {
      const x = e as Record<string, unknown>;
      return x && num(x.n) && typeof x.answer === 'string' && num(x.row) && num(x.col) ? { n: x.n as number, answer: gridWord(x.answer), words: String(x.words ?? x.answer), clue: String(x.clue ?? ''), row: x.row as number, col: x.col as number, enumeration: String(x.enumeration ?? (x.answer as string).length) } : null;
    };
    return { kind: 'crossword', width: p.width as number, height: p.height as number, grid: p.grid as string[], across: (p.across as unknown[]).map(entry).filter((e): e is CrosswordEntry => !!e), down: (p.down as unknown[]).map(entry).filter((e): e is CrosswordEntry => !!e), left: strs(p.left) ? (p.left as string[]) : [], seed: num(p.seed) ? (p.seed as number) : 0 };
  }
  if (p.kind === 'sudoku' && typeof p.grid === 'string' && typeof p.solution === 'string' && /^[1-9.]{81}$/.test(p.grid) && /^[1-9]{81}$/.test(p.solution)) {
    const d: Difficulty = p.difficulty === 'easy' || p.difficulty === 'hard' ? p.difficulty : 'medium';
    return { kind: 'sudoku', grid: p.grid, solution: p.solution, difficulty: d, clues: [...p.grid].filter((c) => c !== '.').length, seed: num(p.seed) ? (p.seed as number) : 0 };
  }
  if (p.kind === 'wordsearch' && strs(p.rows) && Array.isArray(p.words)) {
    const words = (p.words as unknown[])
      .map((w) => w as Record<string, unknown>)
      .filter((w) => w && typeof w.word === 'string' && num(w.row) && num(w.col) && num(w.dr) && num(w.dc))
      .map((w) => ({ word: gridWord(w.word as string), words: String(w.words ?? w.word), row: w.row as number, col: w.col as number, dr: w.dr as number, dc: w.dc as number }));
    return { kind: 'wordsearch', size: (p.rows as string[]).length, rows: p.rows as string[], words, left: strs(p.left) ? (p.left as string[]) : [], ways: p.ways === 'hard' ? 'hard' : 'easy', seed: num(p.seed) ? (p.seed as number) : 0 };
  }
  if (p.kind === 'dailyword' && typeof p.answer === 'string' && Array.isArray(p.guesses)) {
    const answer = gridWord(p.answer);
    const guesses = (p.guesses as unknown[])
      .map((g) => g as Record<string, unknown>)
      .filter((g) => g && typeof g.word === 'string')
      .map((g) => ({ word: gridWord(g.word as string), marks: marksOf(g.word as string, answer) }));
    return { kind: 'dailyword', answer, length: answer.length, guesses, fits: num(p.fits) ? (p.fits as number) : 0, seed: num(p.seed) ? (p.seed as number) : 0 };
  }
  return null;
}

// ── Solve times ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** "4:05", "12 min", "1h 2m 3s", "245" (seconds) read as seconds; null when it isn't a time. */
export function readSolveTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  let m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):(\d{2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const parts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g)];
  if (parts.length) {
    let s = 0;
    for (const p of parts) s += Number(p[1]) * (p[2]!.startsWith('h') ? 3600 : p[2]!.startsWith('m') ? 60 : 1);
    return s > 0 ? Math.round(s) : null;
  }
  if (/^\d+$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  return null;
}

/** Seconds as a paper prints a time ("4:05", "1:02:03"). */
export function solveTimeWords(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
