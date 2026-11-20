// node --test tests/meeting-after.test.mjs — the meeting after-flow (10.0 item 19): meeting actions filed one tap
// into Tasks (their line becomes a tick box in the meeting note) and reminders (a ⏰ line in Reminders.md, the one home),
// each once, re-offers never duplicating; and Today nudging once after a meeting with what is left. Pure layer
// (src/shared/meeting-after.ts over src/shared/tasks.ts and src/shared/reminders.ts). Made-up meetings only; fixed today
// (Monday 2 November 2026).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meeting-after-'));
let A, T, R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * as after from ${JSON.stringify(path.join(root, 'src/shared/meeting-after.ts'))};\n` +
      `export * as tasks from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};\n` +
      `export * as reminders from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
  A = M.after;
  T = M.tasks;
  R = M.reminders;
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-02'; // a Monday
const NOW = new Date(2026, 10, 2, 9, 0); // Monday 2 November 2026, 9:00 am

const meeting = (over = {}) => ({
  path: 'Meetings/2026-10-30 Harbour review.md',
  title: '2026-10-30 Harbour review',
  date: '2026-10-30',
  dated: true,
  actions: [
    { what: 'Send the quote to the mill', done: false },
    { what: 'Book the crane for Thursday', done: false },
  ],
  ...over,
});

// ── The nudge: once after a meeting, with what is left ───────────────────────────────────────────────────────────────

test('a past meeting with open actions nudges once, with what is left', () => {
  const nudges = A.meetingsNeedingAfterflow([meeting()], TODAY);
  assert.equal(nudges.length, 1);
  assert.equal(nudges[0].path, 'Meetings/2026-10-30 Harbour review.md');
  assert.equal(nudges[0].open, 2);
  assert.equal(nudges[0].total, 2);
});

test('no nudge before or during: today, tomorrow and undated meetings stay quiet', () => {
  const ms = [
    meeting({ path: 'a.md', title: 'a', date: '2026-11-02' }),
    meeting({ path: 'b.md', title: 'b', date: '2026-11-03' }),
    meeting({ path: 'c.md', title: 'c', date: '', dated: false }),
  ];
  assert.deepEqual(A.meetingsNeedingAfterflow(ms, TODAY), []);
});

test('no nudge when nothing is left: all ticked, or filed and ticked in the project', () => {
  const done = meeting({ actions: [{ what: 'Send the quote', done: true }] });
  assert.deepEqual(A.meetingsNeedingAfterflow([done], TODAY), []);
  const filedDone = meeting({ actions: [{ what: 'Send the quote', done: false }] });
  assert.deepEqual(A.meetingsNeedingAfterflow([filedDone], TODAY, () => true), []);
});

test('old meetings stop nudging: past a fortnight they are history, not after-flow', () => {
  const old = meeting({ path: 'old.md', title: 'old', date: '2026-10-18' });
  assert.deepEqual(A.meetingsNeedingAfterflow([old], TODAY), []);
  const edge = meeting({ path: 'edge.md', title: 'edge', date: '2026-10-19' });
  assert.equal(A.meetingsNeedingAfterflow([edge], TODAY).length, 1);
});

test('every finished meeting with open actions nudges, the most recent first (9 Nov 2026, break job: the old cap of three hid meetings once the nudges folded into one row)', () => {
  const ms = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((date, i) => meeting({ path: `${i}.md`, title: `m${i}`, date }));
  const nudges = A.meetingsNeedingAfterflow(ms, TODAY);
  assert.deepEqual(
    nudges.map((n) => n.path),
    ['4.md', '3.md', '2.md', '1.md', '0.md'],
  );
});

test('the nudge reads plainly, with no em dash', () => {
  const [n] = A.meetingsNeedingAfterflow([meeting()], TODAY);
  const words = A.afterflowWords(n, TODAY);
  assert.match(words, /Harbour review/);
  assert.match(words, /2 actions still open/);
  assert.doesNotMatch(words, /—/);
  assert.equal(A.afterflowSub(n, TODAY), 'Finished 3 days ago. 2 actions still open.');
});

// ── Into Tasks: the action's line becomes a tick box ────────────────────────────────────────────────────────────────

const NOTE = `---
type: meeting
date: 2026-10-30
---

## Actions

Sam to send the quote by Friday
- [ ] Book the crane for Thursday
- [x] Done already
`;

test('a plain-line action becomes a tick box in place, keeping its words', () => {
  const r = A.fileActionsToTasks(NOTE, [{ line: 7, raw: 'Sam to send the quote by Friday', what: 'Send the quote', who: 'Sam', due: '2026-11-06' }]);
  assert.equal(r.added, 1);
  assert.equal(r.already, 0);
  const lines = r.text.split('\n');
  assert.equal(lines[7], '- [ ] Send the quote — Sam · by 6 Nov 2026');
  // Everything else untouched.
  assert.equal(lines[8], '- [ ] Book the crane for Thursday');
});

test('an action already a tick box is already in Tasks: left alone, counted so', () => {
  const r = A.fileActionsToTasks(NOTE, [{ line: 8, raw: '- [ ] Book the crane for Thursday', what: 'Book the crane for Thursday' }]);
  assert.equal(r.added, 0);
  assert.equal(r.already, 1);
  assert.equal(r.text, NOTE);
});

test('a filed mark stays on the line (still one action with its project)', () => {
  const marked = NOTE.replace('Sam to send the quote by Friday', 'Sam to send the quote by Friday → [[Harbour Fit-out]]');
  const r = A.fileActionsToTasks(marked, [{ line: 7, raw: 'Sam to send the quote by Friday → [[Harbour Fit-out]]', what: 'Send the quote', due: '2026-11-06' }]);
  assert.equal(r.added, 1);
  assert.equal(r.text.split('\n')[7], '- [ ] Send the quote — by 6 Nov 2026 → [[Harbour Fit-out]]');
});

test('a line that moved is never misapplied: found by its words, else skipped and said', () => {
  const moved = `---\ntype: meeting\n---\n\n## Actions\n\nA new first line\nSam to send the quote by Friday\n`;
  const r = A.fileActionsToTasks(moved, [{ line: 0, raw: 'Sam to send the quote by Friday', what: 'Send the quote' }]);
  assert.equal(r.added, 1);
  assert.ok(r.text.includes('- [ ] Send the quote'));
  const gone = A.fileActionsToTasks('## Actions\n\nNothing here now\n', [{ line: 6, raw: 'Sam to send the quote by Friday', what: 'Send the quote' }]);
  assert.equal(gone.added, 0);
  assert.equal(gone.moved, 1);
  assert.equal(gone.text, '## Actions\n\nNothing here now\n');
});

test('filing twice files once: the second run adds nothing', () => {
  const picks = [{ line: 7, raw: 'Sam to send the quote by Friday', what: 'Send the quote' }];
  const once = A.fileActionsToTasks(NOTE, picks);
  assert.equal(once.added, 1);
  const twice = A.fileActionsToTasks(once.text, [{ line: 7, raw: '- [ ] Send the quote', what: 'Send the quote' }]);
  assert.equal(twice.added, 0);
  assert.equal(twice.already, 1);
});

test('the task line reads the one plain way, with its day so Today reads it', () => {
  assert.equal(T.meetingTaskLine({ what: 'Send the quote', who: 'Sam Taylor', due: '2026-11-06' }), '- [ ] Send the quote — Sam Taylor · by 6 Nov 2026');
  assert.equal(T.meetingTaskLine({ what: 'Send the quote' }), '- [ ] Send the quote');
  assert.ok(T.hasTaskLike(NOTE, 'book the crane for thursday!'));
  assert.equal(T.hasTaskLike(NOTE, 'something else entirely'), false);
});

// ── Remind me: a ⏰ line in Reminders.md ──────────────────────────────────────────────────────────────────────────────

const pick = (over = {}) => ({ what: 'Send the quote', who: 'Sam', at: new Date(2026, 10, 6, 9, 0).getTime(), ...over });

test('an action becomes one reminder line, at 9:00 am when no time was said', () => {
  assert.equal(R.meetingReminderLine('Send the quote', 'Sam', new Date(2026, 10, 6, 9, 0)), '- [ ] Send the quote — Sam ⏰ 2026-11-06 09:00');
  const r = A.reminderLinesForActions([pick()], { reminders: null, inbox: null });
  assert.deepEqual(r.lines, ['- [ ] Send the quote — Sam ⏰ 2026-11-06 09:00']);
  assert.equal(r.already, 0);
});

test('the same reminder set already (any home, any capitals) is never written twice', () => {
  const homes = { reminders: '# Reminders\n\n- [ ] Send the quote — Sam ⏰ 2026-11-06 09:00\n', inbox: null };
  const r = A.reminderLinesForActions([pick({ what: 'send the QUOTE!' })], homes);
  assert.deepEqual(r.lines, []);
  assert.equal(r.already, 1);
  const inInbox = { reminders: null, inbox: '- [ ] Send the quote — Sam ⏰ 2026-11-06 09:00\n' };
  assert.deepEqual(A.reminderLinesForActions([pick()], inInbox).lines, []);
});

test('two actions alike at once become one line, not twins', () => {
  const r = A.reminderLinesForActions([pick(), pick({ who: 'Sam' })], { reminders: null, inbox: null });
  assert.equal(r.lines.length, 1);
  assert.equal(r.already, 1);
});

test('planning twice plans once: run again on the homes with the lines in, nothing is new', () => {
  const first = A.reminderLinesForActions([pick()], { reminders: null, inbox: null });
  const homes = { reminders: R.appendReminderLine(null, first.lines[0]), inbox: null };
  const second = A.reminderLinesForActions([pick()], homes);
  assert.deepEqual(second.lines, []);
  assert.equal(second.already, 1);
});

test('appending follows the assistant: under the tasks, else a blank line; a missing home starts headed', () => {
  assert.equal(R.appendReminderLine(null, '- [ ] x ⏰ 2026-11-06 09:00'), '# Reminders\n\n- [ ] x ⏰ 2026-11-06 09:00\n');
  assert.equal(
    R.appendReminderLine('# Reminders\n\n- [ ] a ⏰ 2026-11-05 09:00\n', '- [ ] b ⏰ 2026-11-06 09:00'),
    '# Reminders\n\n- [ ] a ⏰ 2026-11-05 09:00\n- [ ] b ⏰ 2026-11-06 09:00\n',
  );
  assert.equal(R.appendReminderLine('# Reminders\n\nSome words.\n', '- [ ] b ⏰ 2026-11-06 09:00'), '# Reminders\n\nSome words.\n\n- [ ] b ⏰ 2026-11-06 09:00\n');
});

test('an action due day means 9:00 am that day, the time reminders use with no time said', () => {
  assert.equal(A.actionReminderAt('2026-11-06', NOW), new Date(2026, 10, 6, 9, 0).getTime());
  assert.equal(A.actionReminderAt('not a day', NOW), null);
});

test('a private meeting never files reminders out (its words stay locked); Tasks stays in-note', () => {
  assert.equal(A.mayFileReminders('Private notes/Harbour review.md'), false);
  assert.equal(A.mayFileReminders('Meetings/Harbour review.md'), true);
});

test('both doors say what happened the same way, plainly', () => {
  assert.equal(A.tasksFiledWords({ added: 2, already: 1, moved: 0 }), 'Added 2 actions to Tasks. 1 was already in Tasks.');
  assert.equal(A.tasksFiledWords({ added: 0, already: 0, moved: 1 }), '1 line moved on and was left alone.');
  assert.equal(A.remindersSetWords({ set: 1, already: 1, past: 1 }), 'Set 1 reminder. 1 was already set. 1 day has already passed, so no reminder was set for it.');
  for (const w of [A.tasksFiledWords({ added: 1, already: 1, moved: 1 }), A.remindersSetWords({ set: 2, already: 2, past: 2 })]) assert.doesNotMatch(w, /—/);
});
