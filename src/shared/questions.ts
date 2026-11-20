// Questions asked and answered (t238 vault rebuild step 1, 12 Nov 2026). A question a client asks in a meeting had
// nowhere to live — it died in the Notes prose (critic 1 F5, critic 2 F05). Now it is its own kind: asked by,
// asked of or owned by, where (the meeting or note it is written in), when, answered or not, and the answer. A
// meeting's questions become Questions; an answered question keeps its answer and becomes a task or a decision in
// one click. Plain text, one line each:
//
//   ## Questions
//
//   - ? Does the receipt show the tax line? — asked by Priya Nair — for Alex Chen
//   - ? Who signs off the till logs? — asked by June Park — answer: the shop manager signs
//
// `- ?` is never a tick box (src/shared/tasks.ts leaves it alone) and never an action (it lives under Questions,
// not Actions). Names may be [[links]] to people (typed: they survive renames). Pure: meetings read through here,
// the window writes through the meetings' own ops, and the vault tidy rewrites old Questions sections into this.

import { sameWhat } from './meetings';

/** Headings whose lines are questions. Shared with the writers (main/work/meetings.ts addItem) and the tidy, so a
 *  section the reader reads is one the writers write to, never a second section beside it. */
export const QUESTION_HEADING = /^(?:\d+[.)]?\s*)?(?:questions?(?:\s+asked)?|open questions?|q\s*(?:&|and)\s*a)\b/i;

/** A question line: `- ? words`, `* ? words`, `1. ? words`. */
const QUESTION_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+\?\s+(.*)$/;

/** Whether a line is a question line (the tidy moves strays into Questions, wherever they sit). */
export const isQuestionLine = (line: string): boolean => QUESTION_LINE.test(String(line ?? ''));
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(\s*)(`{3,}|~{3,})/;

export interface Question {
  /** The line in the note (0 is the first, the properties counted), and the line as written. */
  line: number;
  raw: string;
  what: string;
  askedBy?: string;
  /** Asked of, or owned by. */
  owner?: string;
  /** Answered: the answer, kept on the line. */
  answer?: string;
  /** Whether it is answered (an answer tail, however short, answers it). */
  answered: boolean;
}

const tidy = (s: string) => String(s ?? '').replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/!?\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop() ?? t).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** A question's words to compare by: no case, marks or extra words (the meetings' own reading). */
export const sameQuestion = (s: string) => sameWhat(s);

/** The tails of a question line: `— asked by X`, `— for X` / `— owned by X`, `— answer: X`. Split on dashes and
 *  middots, as task tails are; the answer tail is taken first and keeps everything after it, dashes included. Raw
 *  as written ([[links]] kept): writers put it back word for word, readers tidy it for display. */
export function splitQuestionTails(rest: string): { what: string; askedBy?: string; owner?: string; answer?: string } {
  let work = String(rest ?? '');
  let answer: string | undefined;
  const am = /\s+[—–]\s+answer\s*:\s*/i.exec(work);
  if (am) {
    answer = work.slice(am.index + am[0].length).trim();
    work = work.slice(0, am.index);
  }
  const m = /\s+[—–]\s+/.exec(work);
  if (!m) return { what: work.trim(), ...(answer !== undefined ? { answer } : {}) };
  const what = work.slice(0, m.index).trim();
  const tails = work.slice(m.index + m[0].length).split(/\s*[—–·]\s*/);
  const out: { what: string; askedBy?: string; owner?: string; answer?: string } = { what, ...(answer !== undefined ? { answer } : {}) };
  for (const tail of tails) {
    const t = tail.trim();
    if (!t) continue;
    const asked = /^asked\s+by\s+(.+)$/i.exec(t);
    if (asked) {
      out.askedBy = asked[1].trim();
      continue;
    }
    const owned = /^(?:for|owned\s+by|owner)\s+(.+)$/i.exec(t);
    if (owned) {
      out.owner = owned[1].trim();
      continue;
    }
  }
  return out;
}

/** Whether a line opens a fenced block (questions inside code are examples, never asked). */
function fenceOf(line: string, open: string | null): string | null {
  const m = FENCE.exec(line);
  if (!m) return open;
  if (open === null) return m[2][0];
  return line.includes(open === '`' ? '```' : '~~~') ? null : open;
}

/** Every question in a note, in order, each once: the `- ?` lines under a Questions heading (nowhere else: a `?`
 *  line under Actions is an action's words, not a question). Ticked boxes are never questions. */
export function findQuestions(content: string): Question[] {
  const text = String(content ?? '');
  if (!text.includes('?')) return [];
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  const out: Question[] = [];
  let inQuestions = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    fence = fenceOf(l, fence);
    if (fence !== null) continue;
    const h = HEADING.exec(l.trim());
    if (h) {
      inQuestions = h[1].length <= 3 && QUESTION_HEADING.test(h[2].trim());
      continue;
    }
    if (!inQuestions) continue;
    const q = QUESTION_LINE.exec(l);
    if (!q || !q[2].trim()) continue;
    const tails = splitQuestionTails(q[2].trim());
    if (!tails.what) continue;
    const askedBy = tails.askedBy ? tidy(tails.askedBy) : '';
    const owner = tails.owner ? tidy(tails.owner) : '';
    const answer = tails.answer ? tidy(tails.answer) : '';
    out.push({ line: i, raw: l, what: tidy(tails.what), ...(askedBy ? { askedBy } : {}), ...(owner ? { owner } : {}), ...(answer ? { answer } : {}), answered: !!answer });
  }
  return out;
}

/** A question line written the one plain way. */
export function questionLine(what: string, tails: { askedBy?: string; owner?: string; answer?: string } = {}): string {
  const words = String(what ?? '').replace(/\s+/g, ' ').trim();
  const parts = [words];
  if (tails.askedBy?.trim()) parts.push(`asked by ${tails.askedBy.trim()}`);
  if (tails.owner?.trim()) parts.push(`for ${tails.owner.trim()}`);
  if (tails.answer !== undefined) parts.push(`answer: ${tails.answer.trim()}`);
  return `- ? ${parts.filter(Boolean).join(' — ')}`;
}

/** The line holding a question: where it was, else the line still holding its words. */
export function locateQuestion(lines: string[], line: number, raw: string): number {
  if (lines[line] === raw) return line;
  return lines.findIndex((l) => l === raw);
}

/** A question answered (or re-answered): its answer tail set, everything else as written ([[links]] kept word for
 *  word). Null when its line is gone from the note (moved on; said, never misapplied). */
export function answerQuestionLine(text: string, line: number, raw: string, answer: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const at = locateQuestion(lines, line, raw);
  if (at < 0) return null;
  const q = QUESTION_LINE.exec(lines[at]);
  if (!q) return null;
  const am = /\s+[—–]\s+answer\s*:\s*/i.exec(lines[at]);
  const head = (am ? lines[at].slice(0, am.index) : lines[at]).replace(/\s+$/, '');
  lines[at] = `${head} — answer: ${String(answer ?? '').replace(/\s+/g, ' ').trim()}`;
  return lines.join(eol);
}

/** An answered question as a task line in its note's Actions ("- [ ] … — owner · by …", the meeting write-up's
 *  own joins, so the meeting reads it back as the same action). */
export function questionTaskLine(q: { what: string; owner?: string; askedBy?: string }): string {
  const who = String(q.owner ?? q.askedBy ?? '').replace(/\s+/g, ' ').trim();
  return `- [ ] ${String(q.what ?? '').replace(/\s+/g, ' ').trim()}${who ? ` — ${who}` : ''}`;
}

/** An answered question as a decision line ("- what — answer"). */
export function questionDecisionLine(q: { what: string; answer?: string }): string {
  const what = String(q.what ?? '').replace(/\s+/g, ' ').trim();
  const answer = String(q.answer ?? '').replace(/\s+/g, ' ').trim();
  return answer ? `- ${what} — ${answer}` : `- ${what}`;
}
