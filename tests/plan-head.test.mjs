// node --test tests/plan-head.test.mjs — Today's head and the plan lists' shared reading
// (src/renderer/src/components/plan/plan.ts): Due counted in the head figures, an answer's question after Retry,
// and the Waiting drop's owner tail. Pure; bundled like the shared tests.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-plan-head-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/components/plan/plan.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('Due feeds the head figures: overdue, today and next 7 days count; undated never does', () => {
  const due = { overdue: [{}, {}], today: [{}], week: [{}, {}, {}], undated: new Array(40), undatedCount: 40 };
  assert.deepEqual(P.dueHeadCounts(due), { late: 2, today: 1, week: 3 });
  assert.deepEqual(P.dueHeadCounts(null), { late: 0, today: 0, week: 0 }, 'not loaded yet: nothing');
  assert.deepEqual(P.dueHeadCounts({ overdue: [], today: [], week: [], undated: [{}], undatedCount: 1 }), { late: 0, today: 0, week: 0 }, 'undated has no day: never on you');
});

test('the subtitle counts projects at risk too, so “All clear” never shows above them', () => {
  assert.deepEqual(P.subtitleFigures({ late: 0, today: 0, week: 0, waiting: 0, risk: 2 }), ['2 at risk']);
  assert.deepEqual(P.subtitleFigures({ late: 1, today: 0, week: 0, waiting: 0, risk: 1 }), ['1 late for you', '1 at risk']);
  assert.deepEqual(P.subtitleFigures({ late: 0, today: 0, week: 0, waiting: 0 }), [], 'no risk passed: as before');
});

test('the owner reading sees a task’s words with its day taken out (round 3)', () => {
  const now = new Date(2026, 10, 4, 9, 30);
  const t = (text, words, day) => ({ kind: 'task', key: text, day, item: { text, words, path: 'Tasks.md', title: 'Tasks', line: 1, due: day } });
  const due = {
    overdue: [t('Their filing — Priya 📅 2026-11-03', 'Their filing — Priya', '2026-11-03')],
    today: [
      t('Send the quote — Mia 📅 2026-11-04', 'Send the quote — Mia', '2026-11-04'),
      t('File the BAS 📅 2026-11-04', 'File the BAS', '2026-11-04'),
    ],
    week: [],
  };
  assert.equal(P.dueOwnerText(due.today[0]), 'Send the quote — Mia', 'the due mark is not part of the owner reading');
  assert.equal(P.dueOwnCount(due, 'Mia Tran', now), 2, 'own 📅 lines count, however the mark sits; theirs does not');
  assert.deepEqual(P.dueOwnSplit(due, 'Mia Tran', now), { late: 0, today: 2, week: 0, stale: 0 }, 'stale counted apart (5 Nov 2026, u3 moving-in)');
  assert.equal(P.dueOwnKeepsWelcome(due, 'Mia Tran', now), true);
});

test('Due keeps “Nothing on you yet” away while any dated line is on the person', () => {
  assert.equal(P.dueKeepsWelcome(null), false);
  assert.equal(P.dueKeepsWelcome({ overdue: [], today: [], week: [] }), false);
  assert.equal(P.dueKeepsWelcome({ overdue: [{}], today: [], week: [] }), true);
  assert.equal(P.dueKeepsWelcome({ overdue: [], today: [{}], week: [] }), true);
  assert.equal(P.dueKeepsWelcome({ overdue: [], today: [], week: [{}] }), true);
});

test('an answer belongs to the nearest user message before it, even after Retry', () => {
  const messages = [
    { role: 'user', content: 'What is due?' },
    { role: 'assistant', content: 'First answer.' },
    { role: 'assistant', content: 'Second answer.' },
  ];
  assert.equal(P.priorUserText(messages, 2), 'What is due?', 'a Retry’s second answer files under the question asked');
  assert.equal(P.priorUserText(messages, 1), 'What is due?');
  assert.equal(P.priorUserText(messages, 0), '');
  assert.equal(P.priorUserText([], 0), '');
});

test('waiting on someone joins the line without stacking tails', () => {
  assert.equal(P.waitingLine('- [ ] Call Mia', 'Priya'), '- [ ] Call Mia — Priya');
  const stacked = P.waitingLine('- [ ] Call — Fri 23 Oct', 'Priya');
  assert.equal(stacked, '- [ ] Call — Priya · by Fri 23 Oct');
  // And the reader splits it back: Priya owns it, Fri 23 Oct stays its day.
  const split = P.splitTaskOwner(stacked.replace(/^- \[[ xX]\] /, ''), new Date(2026, 9, 17, 9, 30));
  assert.equal(split.owner, 'Priya');
  assert.equal(split.when, 'Fri 23 Oct');
});
