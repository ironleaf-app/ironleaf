// node --test tests/note-task.test.mjs — a task line in a note read for the editor (src/shared/note-task.ts), and
// the note's context rail worked out from the notes (src/shared/note-rail.ts): the owner and day as chips (every
// owner chips the same, the note owner included, p16), a plain-words day ("fri", "next tue", "13 nov") read and written the canonical
// way so Tasks and projects keep reading the line, selected words as a task, and the rail's project, area, people,
// open tasks, links and meetings. A fixed today: Thursday 29 October 2026.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-note-task-'));
let M;
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const bundle = async (name, file) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, file))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  M = await bundle('task', 'src/shared/note-task.ts');
  R = await bundle('rail', 'src/shared/note-rail.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const REF = new Date(2026, 9, 29, 10, 0); // Thursday 29 Oct 2026

test('an owner and a by day: the chips, and where they are written', () => {
  const line = '- [ ] Send the quote — Sam Okafor · by 13 Nov';
  const c = M.taskChips(line, REF, []);
  assert.equal(c.owner, 'Sam Okafor');
  assert.equal(line.slice(...c.ownerSpan), 'Sam Okafor');
  assert.equal(c.due, '2026-11-13');
  assert.equal(c.dueWords, 'Fri 13 Nov');
  assert.equal(c.done, false);
});

test('the canonical day, and a linked owner read as their name', () => {
  const c = M.taskChips('- [x] Book the van — [[People/Priya Nair|Priya]] 📅 2026-10-30', REF, []);
  assert.equal(c.done, true);
  assert.equal(c.owner, 'Priya');
  assert.equal(c.due, '2026-10-30');
  assert.equal(c.dueWords, 'Tomorrow');
  assert.equal(c.plain, false);
});

test("the person's own name chips like any other (p16: the never-chip rule left a bare name with a stray dash)", () => {
  assert.equal(M.taskChips('- [ ] Ring the bank — Jesse Arlow · by 13 Nov', REF, ['Jesse Arlow']).owner, 'Jesse Arlow');
  assert.equal(M.taskChips('- [ ] Ring the bank — Jesse · by 13 Nov', REF, ['Jesse Arlow']).owner, 'Jesse');
  assert.equal(M.isOwnName('Sam', ['Jesse Arlow']), false);
});

test('a plain-words day at the end of a task line is its due day', () => {
  assert.equal(M.taskChips('- [ ] Call Sam fri', REF).due, '2026-10-30', 'fri is tomorrow, a Friday');
  assert.equal(M.taskChips('- [ ] Call Sam next tue', REF).due, '2026-11-03', 'readDay’s own reading of a coming weekday');
  assert.equal(M.taskChips('- [ ] Call Sam 13 nov', REF).due, '2026-11-13');
  assert.equal(M.taskChips('- [ ] Call Sam tomorrow', REF).due, '2026-10-30');
  assert.equal(M.taskChips('- [ ] Write the Friday report', REF).due, null, 'a day inside the words is not a due day');
  assert.equal(M.taskChips('Call Sam fri', REF), null, 'not a task line');
  assert.equal(M.taskChips('- [ ] Call Sam ⏰ 2026-10-30 09:00', REF), null, 'a reminder is left to the reminders');
});

test('a plain-words day is written the canonical way, and then reads back the same', () => {
  const line = '- [ ] Call Sam — Priya · by fri';
  const edit = M.plainDateRewrite(line, REF);
  const next = line.slice(0, edit.from) + edit.insert + line.slice(edit.to);
  assert.equal(next, '- [ ] Call Sam — Priya · 📅 2026-10-30');
  assert.equal(M.taskChips(next, REF).due, '2026-10-30');
  assert.equal(M.plainDateRewrite(next, REF), null, 'canonical already: nothing to rewrite');
  const bare = '- [ ] Call Sam 13 nov';
  const b = M.plainDateRewrite(bare, REF);
  assert.equal(bare.slice(0, b.from) + b.insert + bare.slice(b.to), '- [ ] Call Sam 📅 2026-11-13');
  assert.equal(M.plainDateRewrite('- [ ] Call Sam 📅 2026-11-13', REF), null);
  assert.equal(M.plainDateRewrite('- [ ] No day here', REF), null);
});

test('due chip words', () => {
  assert.equal(M.dueChipWords('2026-10-29', REF), 'Today');
  assert.equal(M.dueChipWords('2026-10-28', REF), 'Yesterday');
  assert.equal(M.dueChipWords('2026-11-13', REF), 'Fri 13 Nov');
});

test('due chip tone: one colour rule for Live and Reading (10.0 third round F9)', () => {
  assert.equal(M.dueChipTone('2026-10-29', '2026-10-29', false), 'today');
  assert.equal(M.dueChipTone('2026-10-28', '2026-10-29', false), 'overdue');
  assert.equal(M.dueChipTone('2026-10-28', '2026-10-29', true), 'done', 'ticked, however late');
  assert.equal(M.dueChipTone('2026-10-29', '2026-10-29', true), 'done');
  assert.equal(M.dueChipTone('2026-10-30', '2026-10-29', false), '');
  assert.equal(M.dueChipTone('2026-11-13', '2026-10-29', false), '');
});

test('an owner after a wide separator still points at the name (9.5 fourth pass)', () => {
  const line = '- [ ] Renew the licence — by fri  ·  Sam';
  const c = M.taskChips(line, REF, []);
  assert.equal(c.owner, 'Sam');
  assert.equal(line.slice(...c.ownerSpan), 'Sam');
});

test('a hyphen tail with a middot names the owner; a bare hyphen is just words (9.5 fourth pass)', () => {
  assert.equal(M.taskChips('- [ ] Fix the till - Sam · by fri', REF, []).owner, 'Sam');
  assert.equal(M.taskChips('- [ ] Buy milk - dark, not white', REF, []).owner, null);
});

test('selected words become one task line, without doubling marks', () => {
  assert.equal(M.taskLineFor('Send the quote'), '- [ ] Send the quote');
  assert.equal(M.taskLineFor('- [x] Send the quote'), '- [ ] Send the quote');
  assert.equal(M.taskLineFor('## Send\nthe quote'), '- [ ] Send the quote');
});

test('the selection offers and the slash coverage the spec names are all there', () => {
  // t238: no 'project' offer — selected words become a task here (in a meeting or note of a project, that is
  // the project's task); nothing copies words into a project any more.
  assert.deepEqual(M.SELECTION_ACTIONS.map((a) => a.id), ['task', 'summarise', 'reply', 'actions']);
  assert.deepEqual(M.SLASH_COVERAGE.map((a) => a.id), ['task', 'heading', 'table', 'callout', 'meeting', 'decision', 'date', 'person', 'file', 'chart']);
});

test('chips swallow their separators: the dash and the dot hide when chips show (p14)', () => {
  const line = '- [ ] Get Paul Harris on board – Paul Harris · by Fri 30 Oct';
  const c = M.taskChips(line, REF, []);
  assert.equal(line.slice(...c.ownerSpan), 'Paul Harris');
  assert.ok(c.dueSpan, 'the due chip shows');
  assert.ok(Array.isArray(c.hideSpans) && c.hideSpans.length >= 2, `the dash and the dot hide, got ${JSON.stringify(c.hideSpans)}`);
  for (const [a, b] of c.hideSpans) assert.match(line.slice(a, b), /^[\s·—–-]+$/, `only separators hide: ${JSON.stringify(line.slice(a, b))}`);
  const shown = line.split('').filter((_, i) => !c.hideSpans.some(([a, b]) => i >= a && i < b)).join('');
  assert.ok(!/– Paul Harris/.test(shown) || !shown.includes('–'), 'no stray dash beside the chips');
});

test('a double-dash tail: the owner stops before the due, the dash between hides (p14)', () => {
  const line = '- [ ] Chase the 2 carts — Alex Chen — due 2026-11-05';
  const c = M.taskChips(line, REF, []);
  assert.equal(c.owner, 'Alex Chen');
  assert.equal(line.slice(...c.ownerSpan), 'Alex Chen');
  assert.equal(c.due, '2026-11-05');
  assert.ok(Array.isArray(c.hideSpans) && c.hideSpans.length >= 2, `both dashes hide, got ${JSON.stringify(c.hideSpans)}`);
});

test('every owner chips the same, the note owner included, no stray dash or dot (p16)', () => {
  for (const dash of ['—', '–']) {
    const line = `- [ ] Chase the 2 carts ${dash} Alex Chen · by 13 Nov`;
    const c = M.taskChips(line, REF, ['Alex Chen']);
    assert.equal(c.owner, 'Alex Chen', `own name chips with ${dash === '—' ? 'em' : 'en'} dash`);
    assert.equal(line.slice(...c.ownerSpan), 'Alex Chen');
    assert.ok(c.hideSpans.length >= 2, `dash and dot hide, got ${JSON.stringify(c.hideSpans)}`);
    for (const [a, b] of c.hideSpans) assert.match(line.slice(a, b), /^[\s·—–-]+$/);
  }
  const first = M.taskChips('- [ ] Ring the bank — Jesse · by 13 Nov', REF, ['Jesse Arlow']);
  assert.equal(first.owner, 'Jesse', 'a first name alone chips too');
  const double = '- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05';
  const dc = M.taskChips(double, REF, ['Alex Chen']);
  assert.equal(dc.owner, 'Alex Chen');
  assert.equal(double.slice(...dc.ownerSpan), 'Alex Chen');
  assert.equal(dc.due, '2026-11-05', 'the tail due wins over "on Friday" in the words');
  assert.equal(double.slice(...dc.dueSpan), 'due 2026-11-05');
  assert.ok(dc.hideSpans.length >= 2, `both dashes hide, got ${JSON.stringify(dc.hideSpans)}`);
  const done = '- [x] Confirm the caterer — Priya Nair';
  const d = M.taskChips(done, REF, ['Priya Nair', 'Alex Chen']);
  assert.equal(d.done, true);
  assert.equal(d.owner, 'Priya Nair', 'a done line chips its owner the same');
  assert.equal(done.slice(...d.ownerSpan), 'Priya Nair');
  assert.ok(d.hideSpans.length >= 1, `the dash hides on a done line, got ${JSON.stringify(d.hideSpans)}`);
});

test('a comma before the due: the owner stops before it, no comma kept (p16-owner-tail)', () => {
  const line = '- [ ] Retry the failed payment twice — Priya Nair, due 2026-11-06';
  const c = M.taskChips(line, REF, []);
  assert.equal(c.owner, 'Priya Nair');
  assert.equal(line.slice(...c.ownerSpan), 'Priya Nair');
  assert.equal(c.due, '2026-11-06');
  for (const [a, b] of c.hideSpans) assert.match(line.slice(a, b), /^[\s·—–,;:+-]+$/, `only separators hide: ${JSON.stringify(line.slice(a, b))}`);
});

// ── The rail ───────────────────────────────────────────────────────────────────────────────────────────────────

const notes = [
  { path: 'Projects/Harbour.md', title: 'Harbour fit-out', props: { type: 'project', area: 'Work' }, links: [] },
  { path: 'People/Sam.md', title: 'Sam Okafor', props: { type: 'person' }, links: [] },
  { path: 'Meetings/2026-10-30 Harbour.md', title: 'Harbour site meeting', props: { type: 'meeting', date: '2026-10-30', project: '[[Harbour fit-out]]', attendees: ['[[Sam Okafor]]'] }, links: [{ target: 'Notes/Plan' }] },
  { path: 'Notes/Other.md', title: 'Other note', props: {}, links: [{ target: 'Notes/Plan' }] },
  { path: 'Notes/Plan.md', title: 'Plan', props: { project: '[[Harbour fit-out]]' }, links: [{ target: 'People/Sam' }, { target: 'Notes/Other' }] },
];
const resolve = (target, from) => {
  const clean = target.replace(/\.md$/i, '');
  return notes.find((n) => n.path.replace(/\.md$/i, '') === clean || n.title === clean)?.path ?? null;
};

test('the rail: project and area, people, open tasks, links both ways, related meetings', () => {
  const text = ['# Plan', '', '- [ ] Send the quote — Sam Okafor · by 13 Nov', '- [x] Done thing', '- [ ] Ring Sam fri', '', 'See [[Other note]].'].join('\n');
  const rail = R.noteRail({ path: 'Notes/Plan.md', text, notes, backlinkPaths: ['Notes/Other.md', 'Meetings/2026-10-30 Harbour.md'], resolve, ownNames: ['Jesse'], ref: REF });
  assert.equal(rail.project.title, 'Harbour fit-out');
  assert.equal(rail.area, 'Work');
  assert.deepEqual(rail.people.map((p) => p.title), ['Sam Okafor']);
  assert.deepEqual(rail.openTasks.map((t) => [t.words, t.owner, t.due]), [
    ['Send the quote', 'Sam Okafor', '2026-11-13'],
    ['Ring Sam', null, '2026-10-30'],
  ]);
  assert.deepEqual(rail.outgoing.map((p) => p.title), ['Other note', 'Sam Okafor']);
  assert.deepEqual(rail.backlinks.map((p) => p.title), ['Harbour site meeting', 'Other note']);
  assert.deepEqual(rail.meetings.map((p) => [p.title, p.date]), [['Harbour site meeting', '2026-10-30']]);
  assert.equal(rail.meetingsTotal, 1, 'the rail says how many meetings there are (9.2)');
});

// e2-meeting-faults fault 2 (6 Nov 2026, the Fitzroy take: "by Thursday morning" showed a
// "Thu 12 Nov" chip and a stray "morning", and "by Friday" said on a Friday showed next Friday):
// loose day words stay words in the note, never a chip, and never rewritten to a firm day. The
// meeting's day: Friday 6 Nov 2026.
test('e2: loose day words stay words, never a chip or a firm rewrite', () => {
  const fri = new Date(2026, 10, 6, 10, 0);
  const loose = '- [ ] Chase the stone top for Thursday morning — by Thursday morning';
  assert.equal(M.taskChips(loose, fri).due, null, '"Thursday morning" names no known day');
  assert.equal(M.plainDateRewrite(loose, fri), null, 'and is never written firm');
  assert.equal(M.taskChips('- [ ] Check the opening stock order totals — Kate Sullivan · by Friday', fri).due, null, '"Friday" on a Friday stays words');
  assert.equal(M.plainDateRewrite('- [ ] Check the totals — Kate · by Friday', fri), null);
  assert.equal(M.taskChips('- [ ] Check the totals — Kate · by next week', fri).due, null, 'a span stays words');
  assert.equal(M.taskChips('- [ ] Confirm the install day — Kate Sullivan · by 11 Nov 2026', fri).due, '2026-11-11', 'an exact day still chips');
  // No em dash beside a linked owner chip either (e2): the dash hides, one space stays.
  const linked = '- [ ] Confirm the install day with the joiners — [[Kate Sullivan]] · by 11 Nov 2026';
  const hidden = M.taskChips(linked, fri).hideSpans.map(([a, b]) => linked.slice(a, b)).join('');
  assert.ok(hidden.includes('—'), `the dash beside the linked owner hides (hid ${JSON.stringify(hidden)})`);
  assert.ok(!hidden.startsWith(' —'), 'one space of the separator stays before the mention');
});

// HOLD 5 (6 Nov 2026, h1 break-it): "Book the crane by Thursday the 19th" chipped Thu 12 Nov and
// left "the 19th" dangling in the words; the rewrite wrote "📅 2026-11-12 the 19th". The whole
// weekday-and-number phrase is the day, consumed whole; a weekday that does not fall on that
// numbered date stays words. Read on Friday 6 Nov 2026 unless said.
test('hold5: Thursday the 19th is the 19th, whole, or stays words', () => {
  const fri = new Date(2026, 10, 6, 10, 0);
  const line = '- [ ] Book the crane by Thursday the 19th';
  const c = M.taskChips(line, fri);
  assert.equal(c.due, '2026-11-19');
  assert.equal(c.dueWords, 'Thu 19 Nov');
  assert.equal(c.words, 'Book the crane', 'no numbered day left dangling in the words');
  assert.equal(line.slice(...c.dueSpan), 'by Thursday the 19th', 'the whole phrase is the day’s span');
  const edit = M.plainDateRewrite(line, fri);
  assert.equal(line.slice(0, edit.from) + edit.insert + line.slice(edit.to), '- [ ] Book the crane 📅 2026-11-19');
  assert.equal(M.taskChips('- [ ] Review it on Monday the 16th', fri).due, '2026-11-16');
  assert.equal(M.taskChips('- [ ] Book it by Thursday the 19th of November', fri).due, '2026-11-19');
  assert.equal(M.taskChips('- [ ] Book it by Thu 19th', fri).due, '2026-11-19');
  assert.equal(M.taskChips('- [ ] Book it by Thu 19 Nov', fri).due, '2026-11-19');
  assert.equal(M.taskChips('- [ ] Pay rent by the 19th', fri).due, '2026-11-19');
  assert.equal(M.taskChips('- [ ] Pay rent by 19 November', fri).due, '2026-11-19');
  assert.equal(M.taskChips('- [ ] Send it by next Thursday', fri).due, '2026-11-12');
  assert.equal(M.taskChips('- [ ] Send it this Thursday', fri).due, '2026-11-12');
  const wrong = '- [ ] Review it on Monday the 19th';
  assert.equal(M.taskChips(wrong, fri).due, null, '19 Nov 2026 is not a Monday: doubtful, stays words');
  assert.equal(M.taskChips(wrong, fri).words, 'Review it on Monday the 19th', 'the doubtful phrase stays whole in the words');
  assert.equal(M.plainDateRewrite(wrong, fri), null, 'and is never written firm');
  assert.equal(M.taskChips('- [ ] Chase it by Friday', fri).due, null, 'by Friday on a Friday still stays words (e2)');
  assert.equal(M.taskChips('- [ ] Party on Friday the 13th', fri).due, '2026-11-13', 'a numbered Friday on a Friday is exact, not loose');
  assert.equal(M.taskChips('- [ ] Open on Tuesday the 1st', new Date(2026, 10, 27)).due, '2026-12-01', 'across a month end');
  assert.equal(M.taskChips('- [ ] Open on Friday the 1st', new Date(2026, 11, 28)).due, '2027-01-01', 'across a year end');
});

test('a note in no project, with nothing in it: an empty rail, not a crash', () => {
  const rail = R.noteRail({ path: 'Notes/Other.md', text: 'Just words.', notes, backlinkPaths: [], resolve, ref: REF });
  assert.equal(rail.project, null);
  assert.deepEqual(rail.openTasks, []);
  assert.deepEqual(rail.meetings, []);
});
