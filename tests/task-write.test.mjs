// node --test tests/task-write.test.mjs — one task, one home (src/shared/task-write.ts; p12-task-writes, 4 Nov 2026).
// At write a relative day becomes a real date from today's date; an event condition stays as words, never a due date;
// Ongoing and Open read as a quiet state, never a date; old words such as "Next week" read as No date everywhere they
// are read; and the meaning match only fires at a strict threshold.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-task-write-'));
let T;
let H;
let TD;
let PH;
let TS;
let PF;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as T from ${src('src/shared/task-write.ts')};`,
      `export * as H from ${src('src/shared/hub.ts')};`,
      `export * as TD from ${src('src/shared/today.ts')};`,
      `export * as PH from ${src('src/shared/project-hub.ts')};`,
      `export * as TS from ${src('src/shared/tasks.ts')};`,
      `export * as PF from ${src('src/shared/project-file.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  ({ T, H, TD, PH, TS, PF } = M);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Wednesday 4 November 2026, mid-morning (the briefing day).
const WED = new Date(2026, 10, 4, 10, 30);
const rw = (when, today = WED) => T.resolveWriteWhen(when, today);

test('a relative day becomes a real date from today', () => {
  assert.deepEqual(rw('Friday'), { when: '6 Nov', iso: '2026-11-06' });
  assert.deepEqual(rw('by Friday'), { when: '6 Nov', iso: '2026-11-06' });
  assert.deepEqual(rw('tomorrow'), { when: '5 Nov', iso: '2026-11-05' });
  assert.deepEqual(rw('next week'), { when: '13 Nov', iso: '2026-11-13' });
  assert.deepEqual(rw('by next week'), { when: '13 Nov', iso: '2026-11-13' });
});

test('a real date stays as written (never rewritten into another shape)', () => {
  assert.deepEqual(rw('6 Nov'), { when: '6 Nov', iso: '2026-11-06' });
  assert.deepEqual(rw('2026-11-30'), { when: '2026-11-30', iso: '2026-11-30' });
  assert.deepEqual(rw('by 6 Nov 2026'), { when: '6 Nov 2026', iso: '2026-11-06' });
  assert.deepEqual(rw('Fri 6 Nov'), { when: 'Fri 6 Nov', iso: '2026-11-06' });
});

test('an event condition stays as words, never a due date; nothing written means nothing', () => {
  assert.deepEqual(rw('before the counter build'), { words: 'before the counter build' });
  assert.deepEqual(rw('after the quote lands'), { words: 'after the quote lands' });
  assert.deepEqual(rw('TBC'), { words: 'TBC' });
  assert.deepEqual(rw(''), {});
  assert.deepEqual(rw(undefined), {});
});

test('Ongoing and Open are a quiet state, never a date', () => {
  assert.deepEqual(rw('Ongoing'), { state: 'ongoing' });
  assert.deepEqual(rw('by Ongoing'), { state: 'ongoing' });
  assert.deepEqual(rw('Open'), { state: 'open' });
  assert.deepEqual(rw('open'), { state: 'open' });
  assert.equal(T.readTaskState('Ongoing'), 'ongoing');
  assert.equal(T.readTaskState('by open'), 'open');
  assert.equal(T.readTaskState('Friday'), null);
  assert.equal(T.readTaskState('before the counter build'), null);
  assert.equal(T.readTaskState('Open the safe'), null, 'longer words are not the state');
  assert.equal(T.readTaskState(''), null);
});

test('old words such as "Next week" read as No date everywhere they are read', () => {
  assert.equal(H.readTaskDue('Audit Column Q by Next week', WED).due, null);
  assert.ok(H.readTaskDue('Audit Column Q by Next week', WED).words.includes('Next week'), 'the words stay for the person');
  assert.equal(H.readTaskDue('Ask Darcy Lin to confirm by Friday', WED).due, null);
  assert.equal(TD.readDay('Next week', WED), null);
  assert.equal(TD.readDay('by Friday', WED), null);
  assert.equal(TD.readDay('Ongoing', WED), null);
  assert.equal(TD.readDay('Open', WED), null);
  assert.equal(TD.readDay('before the counter build', WED), null);
  const t = TS.parseTaskLine('- [ ] Audit Column Q by Next week', WED);
  assert.equal(t.due, null);
});

test('a project step with old relative words sits undated and never counts as late', () => {
  const p = PF.parseProject(
    `---\ntype: project\nstatus: active\nowner: Sam Taylor\n---\n# Lighting Upgrade\n\n## What's next\n\n- [ ] Audit Column Q — Sam Taylor · by Next week\n- [ ] Ask Darcy Lin to confirm — by Open\n- [ ] Chase the quote — Sam Taylor · by 30 Oct 2026\n- [ ] Book the bump-in — Sam Taylor · by before the counter build\n`,
    'Projects/Lighting Upgrade/Lighting Upgrade.md',
  );
  const hub = PH.hubModel({ project: p, today: Math.round(Date.UTC(2026, 10, 4) / 86_400_000), me: 'Sam Taylor' });
  assert.equal(hub.plan.late.length, 1, 'only the real past date is late');
  assert.equal(hub.plan.late[0].what, 'Chase the quote');
  assert.deepEqual(
    hub.plan.undated.map((a) => a.what).sort(),
    ['Ask Darcy Lin to confirm', 'Audit Column Q', 'Book the bump-in'],
    'old relative words, Open and an event condition all sit undated',
  );
  assert.ok(hub.plan.undated.every((a) => !a.overdue), 'undated is never overdue');
});

test('the meaning match only fires at a strict threshold', () => {
  assert.ok(T.TASK_MEANING_MIN >= 0.8, 'stricter than the tidy’s note-scale bar');
  assert.equal(T.pickMeaningMatch([1, 0], [[1, 0], [0, 1]]), 0);
  assert.equal(T.pickMeaningMatch([1, 0], [[0, 1]]), -1, 'below the bar is a new task');
  assert.equal(T.pickMeaningMatch([1, 0], []), -1);
  const near = [0.9, Math.sqrt(1 - 0.81)];
  assert.equal(T.pickMeaningMatch([1, 0], [near]), 0, 'cosine 0.9 is a match');
  const far = [0.7, Math.sqrt(1 - 0.49)];
  assert.equal(T.pickMeaningMatch([1, 0], [far]), -1, 'cosine 0.7 is a new task');
  assert.equal(T.pickMeaningMatch([1, 0], [[1, 0], near], (i) => i === 0), 1, 'a skipped line never wins, even itself');
});

test('the model is told plainly, and a person’s page gets a plain pointer', () => {
  assert.equal(T.alreadyThereWords('Ask Darcy Lin to confirm'), 'already there: Ask Darcy Lin to confirm; updated');
  assert.equal(T.taskPointerLine('Ask Darcy Lin to confirm', 'Lighting Upgrade'), '- Ask Darcy Lin to confirm — see [[Lighting Upgrade]]');
  assert.ok(!T.taskPointerLine('Ask Darcy Lin to confirm', 'Lighting Upgrade').includes('[ ]'), 'a pointer is not a second task');
});

test('normalising reads the same task in different capitals and punctuation as one', () => {
  assert.equal(T.normalizeTaskWhat('Send the quote.'), T.normalizeTaskWhat('send the quote'));
  assert.notEqual(T.normalizeTaskWhat('Send the quote'), T.normalizeTaskWhat('Send the invoice'));
});

test('one project fits a person, or none does (never a guess between two)', () => {
  const projects = [
    { path: 'Projects/Lighting Upgrade/Lighting Upgrade.md', name: 'Lighting Upgrade', owner: 'Darcy Lin', people: [] },
    { path: 'Projects/Bakery/Bakery.md', name: 'Bakery', owner: 'Sam Taylor', people: ['Priya Shah'] },
  ];
  assert.equal(T.fitProjectForPerson(projects, 'Darcy Lin').name, 'Lighting Upgrade');
  assert.equal(T.fitProjectForPerson(projects, 'Priya Shah').name, 'Bakery');
  assert.equal(T.fitProjectForPerson(projects, 'Nobody Here'), null);
  const two = [...projects, { path: 'Projects/Other/Other.md', name: 'Other', owner: 'Darcy Lin', people: [] }];
  assert.equal(T.fitProjectForPerson(two, 'Darcy Lin'), null, 'two fitting is no fit');
  assert.equal(T.fitProjectForPerson(projects, ''), null);
});
