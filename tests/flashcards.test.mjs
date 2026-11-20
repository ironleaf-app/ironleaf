// node --test tests/flashcards.test.mjs — flashcards and quizzes from a notebook (src/shared/flashcards.ts; 21 Oct 2026,
// gap G10): the Markdown format written and read back the same, a card known by its question, the spaced review (Again,
// Hard, Good, Easy) and its schedule kept in the note's properties without touching the rest, and the cards due on a
// day. Made-up bakery cards; every day fixed.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-flashcards-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/flashcards.ts'), platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const CARDS = [
  { q: 'Which mill supplies the flour?', a: 'Western Plains Mill, for its steadier price. ([[Supply/Flour supply#Mill|1]])' },
  { q: 'How cold is the walk-in fridge kept?', a: '4 degrees or colder.' },
  { q: 'When do deliveries come?', a: 'Tuesdays before the ovens are lit.' },
];
const deck = () => F.writeCards({ title: 'Flashcards: Supply', folder: 'Supply', iso: '2026-10-21', cards: CARDS, sources: '## Sources\n\n1. [[Supply/Flour supply#Mill|Flour supply › Mill]]\n' });

test('the flashcards format: written as Q:/A: lines and read back the same, each card known by its question', () => {
  const text = deck();
  assert.match(text, /^---\nnotebook-kind: flashcards\nnotebook: "Supply"\nmade: 2026-10-21\nreview: \{\}\n---\n# Flashcards: Supply\n/);
  assert.match(text, /\nQ: Which mill supplies the flour\?\nA: Western Plains Mill/);
  const cards = F.parseCards(text);
  assert.deepEqual(cards.map(({ q, a }) => ({ q, a })), CARDS);
  assert.equal(new Set(cards.map((c) => c.id)).size, 3);
  for (const c of cards) assert.match(c.id, /^k[0-9a-z]+$/);
  // Written again from what was read: the same note.
  assert.equal(F.writeCards({ title: 'Flashcards: Supply', folder: 'Supply', iso: '2026-10-21', cards, sources: '## Sources\n\n1. [[Supply/Flour supply#Mill|Flour supply › Mill]]\n' }), text);
  // The id follows the question's words, not its spacing or capitals; a reworded question is a new card.
  assert.equal(F.cardId('Which mill  supplies the FLOUR?'), cards[0].id);
  assert.notEqual(F.cardId('Which mill do we use?'), cards[0].id);
});

test('cards written by hand: an answer over several lines, a half card skipped, other lines left alone', () => {
  const text = '# My cards\n\nSome words first.\n\nQ: What is levain?\nA: A starter built up\nthe night before.\n\nQ: A question with no answer\n\nQ: Last one\nA: Done\n';
  assert.deepEqual(F.parseCards(text).map(({ q, a }) => ({ q, a })), [
    { q: 'What is levain?', a: 'A starter built up\nthe night before.' },
    { q: 'Last one', a: 'Done' },
  ]);
});

test('the spacing rule: Good 1, 3, then gap × ease; Hard a little longer; Easy longer and easier; Again back today', () => {
  const today = '2026-10-21';
  const g1 = F.schedule(undefined, 'good', today);
  assert.deepEqual(g1, { due: '2026-10-22', days: 1, ease: 2.5, reps: 1 });
  const g2 = F.schedule(g1, 'good', '2026-10-22');
  assert.deepEqual(g2, { due: '2026-10-25', days: 3, ease: 2.5, reps: 2 });
  const g3 = F.schedule(g2, 'good', '2026-10-25');
  assert.deepEqual(g3, { due: '2026-11-02', days: 8, ease: 2.5, reps: 3 });
  assert.deepEqual(F.schedule(g3, 'hard', '2026-11-02'), { due: '2026-11-12', days: 10, ease: 2.35, reps: 4 });
  assert.deepEqual(F.schedule(g3, 'easy', '2026-11-02'), { due: '2026-11-28', days: 26, ease: 2.65, reps: 4 });
  assert.deepEqual(F.schedule(g3, 'again', '2026-11-02'), { due: '2026-11-02', days: 0, ease: 2.3, reps: 0 });
  assert.deepEqual(F.schedule(undefined, 'easy', today), { due: '2026-10-25', days: 4, ease: 2.65, reps: 1 });
  // Ease stays between 1.3 and 3.
  let s;
  for (let i = 0; i < 12; i++) s = F.schedule(s, 'again', today);
  assert.equal(s.ease, 1.3);
  for (let i = 0; i < 12; i++) s = F.schedule(s, 'easy', today);
  assert.equal(s.ease, 3);
  // Days are counted on the calendar: across the change to daylight saving (4 Oct 2026 here) and month ends.
  assert.equal(F.addDaysIso('2026-10-03', 1), '2026-10-04');
  assert.equal(F.addDaysIso('2026-10-31', 1), '2026-11-01');
  assert.equal(F.addDaysIso('2026-12-31', 1), '2027-01-01');
});

test('a review kept in the note’s properties, one line per card, the rest of the note untouched; due cards read from it', () => {
  let text = deck();
  const [mill, fridge, delivery] = F.parseCards(text);
  assert.equal(F.dueCards(text, '2026-10-21').length, 3);
  text = F.writeReview(text, mill.id, F.schedule(undefined, 'good', '2026-10-21'));
  text = F.writeReview(text, fridge.id, F.schedule(undefined, 'again', '2026-10-21'));
  assert.match(text, new RegExp(`^---\\nnotebook-kind: flashcards\\nnotebook: "Supply"\\nmade: 2026-10-21\\nreview:\\n  ${mill.id}: 2026-10-22 1 2.5 1\\n  ${fridge.id}: 2026-10-21 0 2.3 0\\n---\\n`));
  // Everything under the properties is as it was.
  assert.equal(text.slice(text.indexOf('# Flashcards')), deck().slice(deck().indexOf('# Flashcards')));
  assert.deepEqual(F.readReview(text)[mill.id], { due: '2026-10-22', days: 1, ease: 2.5, reps: 1 });
  // Today: the card answered Again and the one never seen. Tomorrow: the Good one too.
  assert.deepEqual(F.dueCards(text, '2026-10-21').map((c) => c.id), [fridge.id, delivery.id]);
  assert.deepEqual(F.dueCards(text, '2026-10-22').map((c) => c.id), [mill.id, fridge.id, delivery.id]);
  // A card's line rewritten in place, not added again.
  text = F.writeReview(text, mill.id, F.schedule(F.readReview(text)[mill.id], 'good', '2026-10-22'));
  assert.equal(text.split(mill.id).length, 2);
  assert.equal(F.readReview(text)[mill.id].due, '2026-10-25');
  // A line that can't be read is ignored, and a made-up id is refused.
  assert.deepEqual(F.readReview('---\nreview:\n  kabc: soon\n---\n'), {});
  assert.throws(() => F.writeReview(text, '../x', F.schedule(undefined, 'good', '2026-10-21')));
});

test('the quiz format: questions, choices and the folded answer, read back the same', () => {
  const questions = [
    { q: 'Which mill supplies the flour?', choices: ['The co-op', 'Western Plains Mill', 'Harbour Mill', 'None'], answer: 1, why: 'Its price stayed steady.', links: ' ([[Supply/Flour supply#Mill|1]])' },
    { q: 'How cold is the fridge?', choices: ['4 degrees or colder', '8 degrees'], answer: 0, why: 'The safety plan says so.' },
  ];
  const text = F.writeQuiz({ title: 'Quiz: Supply', folder: 'Supply', iso: '2026-10-21', questions });
  assert.match(text, /### 1\. Which mill supplies the flour\?\n\n- A\. The co-op\n- B\. Western Plains Mill/);
  assert.match(text, /> \[!success\]- Answer\n> B\. Western Plains Mill — Its price stayed steady\. \(\[\[Supply\/Flour supply#Mill\|1\]\]\)/);
  assert.deepEqual(
    F.parseQuiz(text).map(({ q, choices, answer }) => ({ q, choices, answer })),
    questions.map(({ q, choices, answer }) => ({ q, choices, answer })),
  );
  assert.equal(F.parseQuiz(text)[1].why, 'The safety plan says so.');
});
