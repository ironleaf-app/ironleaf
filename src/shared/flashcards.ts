// Flashcards and quizzes from a notebook (21 Oct 2026, gap G10), kept as plain Markdown any app reads, and the spaced
// review that brings each card back when it is due.
//
// The flashcards format (a note with `notebook-kind: flashcards`):
//
//     Q: Which mill supplies the flour?
//     A: Western Plains Mill, for its steadier price. ([[Decision Log#Flour|1]])
//
// A card is a line starting "Q:" and a line starting "A:"; lines straight after either carry on that part, and a blank
// line ends the card. Anything else in the note (headings, a callout, the Sources list) is left alone. A card is known by
// its question (a short hash of its words), so editing an answer keeps its schedule and rewording a question starts it
// again as a new card.
//
// When each card comes back is kept in the note's properties, one line per card reviewed:
//
//     review:
//       k1x9f2a: 2026-10-24 3 2.5 2
//
// that is: next due day, days between reviews, ease, and reviews in a row answered. A card with no line is new, and due.
// Grades: Again (back today, ease down), Hard (a little longer, ease down), Good (1 day, then 3, then days × ease), Easy
// (longer still, ease up) — a small, well-known spacing rule, written out below.
//
// The quiz format (`notebook-kind: quiz`): each question a "### 1. …" heading, its four choices as "- A. …" lines, and
// the answer folded away in a callout, "> [!success]- Answer" then "> B. … — why".

import { changeProps, isMap, readProps } from './frontmatter';

export interface Card {
  id: string;
  q: string;
  a: string;
}

export interface ReviewState {
  /** Next due day (YYYY-MM-DD). */
  due: string;
  /** Days between the last review and the next. */
  days: number;
  ease: number;
  /** Reviews in a row not answered Again. */
  reps: number;
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' },
];

/** A card's id from its question: "k" and a short hash of its words (case and spacing ignored). */
export function cardId(question: string): string {
  const s = question.replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `k${h.toString(36)}`;
}

/** The note's words after its properties. */
function bodyOf(text: string): string {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Every card in a flashcards note, in order (a card missing its question or answer is skipped). */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  let q: string[] | null = null;
  let a: string[] | null = null;
  const end = () => {
    if (q && a && q.join(' ').trim() && a.join(' ').trim()) {
      const question = q.join('\n').trim();
      out.push({ id: cardId(question), q: question, a: a.join('\n').trim() });
    }
    q = null;
    a = null;
  };
  for (const line of bodyOf(text).split(/\r?\n/)) {
    const qm = /^Q:\s?(.*)$/.exec(line);
    const am = /^A:\s?(.*)$/.exec(line);
    if (qm) {
      end();
      q = [qm[1]];
    } else if (am && q) a = [am[1]];
    else if (!line.trim()) end();
    else if (a) a.push(line);
    else if (q) q.push(line);
  }
  end();
  return out;
}

/** The cards written as a flashcards note (with its properties and the line saying how to use it). */
export function writeCards(o: { title: string; folder: string; iso: string; cards: { q: string; a: string }[]; sources?: string }): string {
  const one = (s: string) => s.replace(/\r?\n\s*\r?\n/g, '\n').trim();
  return [
    '---',
    'notebook-kind: flashcards',
    `notebook: ${JSON.stringify(o.folder || '/')}`,
    `made: ${o.iso}`,
    'review: {}',
    '---',
    `# ${o.title}`,
    '',
    '> [!tip] Review these from the notebook, from Today when cards are due, or from this note’s ⋯ menu. Each card is a “Q:” line and an “A:” line, with a blank line between cards.',
    '',
    ...o.cards.flatMap((c) => [`Q: ${one(c.q)}`, `A: ${one(c.a)}`, '']),
    ...(o.sources ? [o.sources] : []),
  ].join('\n');
}

const STATE = /^(\d{4}-\d{2}-\d{2})\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)$/;

/** When each reviewed card comes back, from the note's properties (lines that can't be read are left out). */
export function readReview(text: string): Record<string, ReviewState> {
  const raw = readProps(text).review;
  const out: Record<string, ReviewState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    const m = STATE.exec(String(v ?? '').trim());
    if (m) out[id] = { due: m[1], days: Number(m[2]), ease: Number(m[3]), reps: Number(m[4]) };
  }
  return out;
}

export const stateWords = (s: ReviewState) => `${s.due} ${s.days} ${Math.round(s.ease * 100) / 100} ${s.reps}`;

/** The note with one card's schedule written into its properties (the rest of the note untouched). */
export function writeReview(text: string, id: string, state: ReviewState): string {
  if (!/^k[0-9a-z]+$/.test(id)) throw new Error('That card can’t be found.');
  return changeProps(text, (doc) => {
    if (!isMap(doc.get('review', true))) doc.set('review', doc.createNode({}));
    const review = doc.get('review', true);
    // One line per card, however the list was started ("review: {}" when the note is made).
    if (isMap(review)) review.flow = false;
    doc.setIn(['review', id], stateWords(state));
  });
}

/** A day so many days after another (YYYY-MM-DD, by the calendar, so daylight saving never moves it). */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * The next review for a card graded today. New cards start at ease 2.5. Again: due again today, ease −0.2, the run starts
 * over. Hard: about 1.2 × the last gap (at least a day), ease −0.15. Good: 1 day the first time, 3 the second, then the
 * last gap × ease. Easy: 4 days the first time, then the last gap × ease × 1.3, ease +0.15. Ease stays between 1.3 and 3.
 */
export function schedule(prev: ReviewState | undefined, grade: Grade, today: string): ReviewState {
  const ease0 = prev?.ease ?? 2.5;
  const days0 = prev?.days ?? 0;
  const reps0 = prev?.reps ?? 0;
  const clamp = (e: number) => Math.min(3, Math.max(1.3, Math.round(e * 100) / 100));
  let days: number;
  let ease = ease0;
  let reps = reps0 + 1;
  switch (grade) {
    case 'again':
      days = 0;
      ease = clamp(ease0 - 0.2);
      reps = 0;
      break;
    case 'hard':
      days = Math.max(1, Math.round(days0 * 1.2));
      ease = clamp(ease0 - 0.15);
      break;
    case 'good':
      days = reps0 === 0 ? 1 : reps0 === 1 ? 3 : Math.max(days0 + 1, Math.round(days0 * ease0));
      break;
    case 'easy':
      days = reps0 === 0 ? 4 : Math.max(days0 + 2, Math.round(days0 * ease0 * 1.3));
      ease = clamp(ease0 + 0.15);
      break;
  }
  return { due: addDaysIso(today, days), days, ease, reps };
}

/** The cards due on a day (new ones, and those whose day has come), in the note's order. */
export function dueCards(text: string, today: string): Card[] {
  const review = readReview(text);
  return parseCards(text).filter((c) => !review[c.id] || review[c.id].due <= today);
}

// ── Quizzes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  q: string;
  choices: string[];
  /** The right choice (from 0). */
  answer: number;
  why: string;
  /** Links to the passages it comes from (" ([[…|1]])"), written after the reason. */
  links?: string;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A quiz note: each question with its choices, and its answer folded away. */
export function writeQuiz(o: { title: string; folder: string; iso: string; questions: QuizQuestion[]; sources?: string }): string {
  const one = (s: string) => s.replace(/\s+/g, ' ').trim();
  return [
    '---',
    'notebook-kind: quiz',
    `notebook: ${JSON.stringify(o.folder || '/')}`,
    `made: ${o.iso}`,
    '---',
    `# ${o.title}`,
    '',
    '> [!tip] Choose an answer for each question, then open its Answer to check.',
    '',
    ...o.questions.flatMap((x, i) => [`### ${i + 1}. ${one(x.q)}`, '', ...x.choices.map((c, j) => `- ${LETTERS[j]}. ${one(c)}`), '', '> [!success]- Answer', `> ${LETTERS[x.answer]}. ${one(x.choices[x.answer] ?? '')} — ${one(x.why)}${x.links ?? ''}`, '']),
    ...(o.sources ? [o.sources] : []),
  ].join('\n');
}

/** A quiz note's questions read back (the links after a reason stay with the reason's words). */
export function parseQuiz(text: string): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  let cur: QuizQuestion | null = null;
  for (const line of bodyOf(text).split(/\r?\n/)) {
    const h = /^###\s+\d+\.\s+(.*)$/.exec(line);
    if (h) {
      if (cur) out.push(cur);
      cur = { q: h[1].trim(), choices: [], answer: -1, why: '' };
      continue;
    }
    if (!cur) continue;
    const c = /^-\s+([A-F])\.\s+(.*)$/.exec(line);
    if (c) {
      cur.choices.push(c[2].trim());
      continue;
    }
    const a = /^>\s+([A-F])\.\s+.*?\s+—\s+(.*)$/.exec(line);
    if (a) {
      cur.answer = LETTERS.indexOf(a[1]);
      cur.why = a[2].trim();
    }
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.choices.length >= 2 && x.answer >= 0);
}
