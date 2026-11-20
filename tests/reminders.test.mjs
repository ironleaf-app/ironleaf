// node --test tests/reminders.test.mjs — reminders (src/shared/reminders.ts; 19 Oct 2026, approved them: "remember to
// order flour on Friday"): the ⏰ line read and written, the moments people say ("on Friday", "tomorrow at 3pm", "next
// Monday", "in 2 hours", "23 Oct", "every Monday") read exactly and never guessed, repeats moved on, Today's groups, and
// firing once (missed ones after the PC slept, said once, a week back at most). Every date against a fixed now: Monday 19
// October 2026, 10:30 am, the PC's own time.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-reminders-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 19, 10, 30); // Monday 19 October 2026, 10:30 am
const at = (d, h = 9, m = 0, month = 9, y = 2026) => new Date(y, month, d, h, m).getTime();
const when = (s, now = NOW) => {
  const r = R.parseWhen(s, now);
  return r && { at: r.at.getTime(), timeGiven: r.timeGiven, repeat: r.repeat && R.repeatText(r.repeat) };
};

test('a reminder line: date and time, date alone (9:00 am), done, repeat, and words kept', () => {
  const r = R.parseReminderLine('- [ ] Order 20 bags of flour from Laucke ⏰ 2026-10-23 09:00');
  assert.equal(r.text, 'Order 20 bags of flour from Laucke');
  assert.equal(r.due, at(23));
  assert.equal(r.timeGiven, true);
  assert.equal(r.done, false);
  assert.equal(r.repeat, null);
  const d = R.parseReminderLine('  * [x] Ring the accountant ⏰ 2026-10-23');
  assert.equal(d.due, at(23, 9));
  assert.equal(d.timeGiven, false);
  assert.equal(d.done, true);
  const rep = R.parseReminderLine('- [ ] Put the bins out ⏰ 2026-10-26 18:30 every Monday #home');
  assert.equal(rep.due, at(26, 18, 30));
  assert.deepEqual(rep.repeat, { unit: 'week', every: 1, days: [1] });
  assert.equal(rep.text, 'Put the bins out #home');
  assert.equal(R.parseReminderLine('- [ ] Call Sam ⏰ 2026-10-23 3:15pm').due, at(23, 15, 15));
  // A number that isn't a time stays in the words; not a task, a bad date or no ⏰: not a reminder.
  const odd = R.parseReminderLine('- [ ] Order ⏰ 2026-10-23 9 bags');
  assert.equal(odd.due, at(23, 9));
  assert.equal(odd.text, 'Order 9 bags');
  assert.equal(R.parseReminderLine('Order flour ⏰ 2026-10-23 09:00'), null);
  assert.equal(R.parseReminderLine('- [ ] Order flour ⏰ 2026-02-30 09:00'), null);
  assert.equal(R.parseReminderLine('- [ ] Order flour on Friday'), null);
});

test('written back the one way: the mark, a new moment, ticked, and found in a note (not in code or properties)', () => {
  assert.equal(R.formatMark(at(23, 9)), '⏰ 2026-10-23 09:00');
  assert.equal(R.reminderLine('Order flour', at(23, 14, 5), { unit: 'week', every: 1, days: [1, 4] }), '- [ ] Order flour ⏰ 2026-10-23 14:05 every Monday and Thursday');
  const line = '- [ ] Order flour ⏰ 2026-10-23 09:00 every Friday and more';
  assert.equal(R.moveReminder(line, at(30, 9)), '- [ ] Order flour ⏰ 2026-10-30 09:00 every Friday and more');
  assert.equal(R.setTicked(line, true), line.replace('[ ]', '[x]'));
  const note = ['---', 'note: "- [ ] x ⏰ 2026-10-20 09:00"', '---', '# Shop', '- [ ] Flour ⏰ 2026-10-23 09:00', '```', '- [ ] Not this ⏰ 2026-10-24 09:00', '```', '- [x] Done one ⏰ 2026-10-19'].join('\n');
  const found = R.findReminders(note);
  assert.deepEqual(found.map((f) => [f.line, f.text, f.done]), [[4, 'Flour', false], [8, 'Done one', true]]);
  assert.equal(R.locateReminder(note.split('\n'), 2, 'Flour'), 4);
  assert.equal(R.locateReminder(note.split('\n'), 4, 'Gone'), -1);
});

test('twins on different days tell apart by their moment (9.5 fourth pass)', () => {
  const lines = ['- [ ] Put the bins out ⏰ 2026-10-23 18:30', '- [ ] Put the bins out ⏰ 2026-10-30 18:30'];
  assert.equal(R.locateReminder(lines, 0, 'Put the bins out', new Date(2026, 9, 30, 18, 30).getTime()), 1);
  assert.equal(R.locateReminder(lines, 1, 'Put the bins out', new Date(2026, 9, 23, 18, 30).getTime()), 0);
  assert.equal(R.locateReminder(lines, 0, 'Put the bins out'), 0, 'no moment: the old nearest-words reading');
});

test('repeats read and written: every Monday, other Friday, 2 weeks, weekday, fortnight, monthly', () => {
  for (const s of ['every Monday', 'every Monday and Thursday', 'every Monday, Wednesday and Friday', 'every other Friday', 'every 3 weeks on Tuesday', 'every weekday', 'every day', 'every fortnight', 'every month', 'every year', 'every 2 days']) assert.equal(R.repeatText(R.parseRepeat(s)), s, s);
  assert.equal(R.repeatText(R.parseRepeat('weekly')), 'every week');
  assert.equal(R.repeatText(R.parseRepeat('every mon & thurs')), 'every Monday and Thursday');
  assert.equal(R.parseRepeat('every so often'), null);
});

test('the next time a repeat comes round, keeping its time of day', () => {
  const start = new Date(at(19, 9)); // a Monday
  assert.equal(+R.nextOccurrence({ unit: 'week', every: 1, days: [1] }, start, at(19, 9)), at(26, 9));
  assert.equal(+R.nextOccurrence({ unit: 'week', every: 1, days: [1, 4] }, start, at(19, 9)), at(22, 9));
  assert.equal(+R.nextOccurrence({ unit: 'week', every: 2, days: [1] }, start, at(19, 9)), at(2, 9, 0, 10));
  assert.equal(+R.nextOccurrence({ unit: 'day', every: 1 }, start, at(21, 12)), at(22, 9));
  assert.equal(+R.nextOccurrence({ unit: 'weekday', every: 1 }, new Date(at(23, 9)), at(23, 9)), at(26, 9));
  assert.equal(+R.nextOccurrence({ unit: 'month', every: 1 }, new Date(at(31, 9)), at(31, 9)), at(30, 9, 0, 10));
  // Across the start of daylight saving (4 October 2026 in Melbourne) the time of day stays 9:00.
  assert.equal(new Date(R.nextOccurrence({ unit: 'week', every: 1 }, new Date(at(1, 9)), at(1, 9))).getHours(), 9);
});

test('a repeating reminder moves on when it fires or is ticked', () => {
  // Fired (or ticked) after it was due: the next one after now.
  assert.equal(R.rollReminder('- [x] Bins ⏰ 2026-10-19 09:00 every Monday', NOW.getTime()), '- [ ] Bins ⏰ 2026-10-26 09:00 every Monday');
  // Ticked early (the one shown is still to come): that one is done, so the one after it.
  assert.equal(R.rollReminder('- [x] Bins ⏰ 2026-10-26 09:00 every Monday', NOW.getTime()), '- [ ] Bins ⏰ 2026-11-02 09:00 every Monday');
  assert.equal(R.rollReminder('- [ ] Once ⏰ 2026-10-19 09:00', NOW.getTime()), null);
});

test('what people say: on Friday, tomorrow at 3pm, next Monday, in 2 hours, 23 Oct, every Monday', () => {
  assert.deepEqual(when('on Friday'), { at: at(23, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('Friday at 2:30pm'), { at: at(23, 14, 30), timeGiven: true, repeat: null });
  assert.deepEqual(when('tomorrow at 3pm'), { at: at(20, 15), timeGiven: true, repeat: null });
  assert.deepEqual(when('tomorrow morning'), { at: at(20, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('next Monday'), { at: at(26, 9), timeGiven: false, repeat: null });
  // Today is Monday: "Monday" at a time still ahead is today; with no time (9:00 am, gone) it is next week's.
  assert.deepEqual(when('Monday at 4pm'), { at: at(19, 16), timeGiven: true, repeat: null });
  assert.deepEqual(when('Monday'), { at: at(26, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('in 2 hours'), { at: at(19, 12, 30), timeGiven: true, repeat: null });
  assert.deepEqual(when('in half an hour'), { at: at(19, 11, 0), timeGiven: true, repeat: null });
  assert.deepEqual(when('in 3 days'), { at: at(22, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('23 Oct'), { at: at(23, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('Friday 23 October at 9:30 am'), { at: at(23, 9, 30), timeGiven: true, repeat: null });
  assert.deepEqual(when('Oct 23 at 17:00'), { at: at(23, 17), timeGiven: true, repeat: null });
  assert.deepEqual(when('23/10'), { at: at(23, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('2026-10-23 09:00'), { at: at(23, 9), timeGiven: true, repeat: null });
  assert.deepEqual(when('2026-10-23T14:00'), { at: at(23, 14), timeGiven: true, repeat: null });
  assert.deepEqual(when('the 3rd'), { at: at(3, 9, 0, 10), timeGiven: false, repeat: null });
  // HOLD 5 (6 Nov 2026): a weekday with a numbered day is that date (22 Oct 2026 is a Thursday);
  // a weekday that does not fall on that date is doubtful and is never guessed at.
  assert.deepEqual(when('Thursday the 22nd'), { at: at(22, 9), timeGiven: false, repeat: null });
  assert.deepEqual(when('Thu 22nd at 2pm'), { at: at(22, 14), timeGiven: true, repeat: null });
  assert.deepEqual(when('Thursday the 22nd of October'), { at: at(22, 9), timeGiven: false, repeat: null });
  assert.equal(when('Friday the 22nd'), null, 'the 22nd is a Thursday, never the coming Friday');
  assert.equal(when('Friday 22 October'), null, 'a wrong weekday beside a date is not read as that date');
  // A date gone this year is next year's; a time gone today is tomorrow's.
  assert.deepEqual(when('3 Jan'), { at: at(3, 9, 0, 0, 2027), timeGiven: false, repeat: null });
  assert.deepEqual(when('at 9am'), { at: at(20, 9), timeGiven: true, repeat: null });
  assert.deepEqual(when('at noon'), { at: at(19, 12), timeGiven: true, repeat: null });
  assert.deepEqual(when('next week'), { at: at(26, 9), timeGiven: false, repeat: null });
});

test('repeats said: every Monday (the first one to come), every weekday at 8am, every other Friday', () => {
  assert.deepEqual(when('every Monday'), { at: at(26, 9), timeGiven: false, repeat: 'every Monday' });
  assert.deepEqual(when('every Monday at 6pm'), { at: at(19, 18), timeGiven: true, repeat: 'every Monday' });
  assert.deepEqual(when('every weekday at 8am'), { at: at(20, 8), timeGiven: true, repeat: 'every weekday' });
  assert.deepEqual(when('every other Friday'), { at: at(23, 9), timeGiven: false, repeat: 'every other Friday' });
  assert.deepEqual(when('every day at 7:30 pm'), { at: at(19, 19, 30), timeGiven: true, repeat: 'every day' });
  assert.deepEqual(when('every Thursday from 5 November'), { at: at(5, 9, 0, 10), timeGiven: false, repeat: 'every Thursday' });
});

test('never guessed: words not understood, a time without am or pm, nonsense dates', () => {
  for (const s of ['end of the month', 'after lunch', 'at 3', 'soon', 'order flour on Friday', '31 Feb', 'in the afternoon', '25:00', '13pm', '']) assert.equal(R.parseWhen(s, NOW), null, s);
});

test('words: the moment in Australian words, the pill, times', () => {
  assert.equal(R.reminderWords(at(23, 9), NOW), 'Friday 23 October at 9:00 am');
  assert.equal(R.reminderWords(at(8, 15, 5, 0, 2027), NOW), 'Friday 8 January 2027 at 3:05 pm');
  assert.equal(R.pillWords(at(23, 9), NOW), 'Fri 23 Oct, 9:00 am');
  assert.equal(R.pillWords(at(19, 12), NOW), 'Today, 12:00 pm');
  assert.equal(R.pillWords(at(20, 0, 30), NOW), 'Tomorrow, 12:30 am');
  assert.equal(R.timeWords(at(19, 21, 45)), '9:45 pm');
});

const item = (key, due, done = false) => ({ key, path: 'Reminders.md', title: 'Reminders', line: 0, text: key, due, timeGiven: true, repeat: null, done });

test("Today's groups: overdue, the rest of today, the next seven days", () => {
  const g = R.groupReminders([item('late', at(19, 9)), item('later', at(19, 15)), item('fri', at(23, 9)), item('far', at(2, 9, 0, 11)), item('ticked', at(19, 8), true)], NOW.getTime());
  assert.deepEqual(g.overdue.map((i) => i.key), ['late']);
  assert.deepEqual(g.today.map((i) => i.key), ['later']);
  assert.deepEqual(g.upcoming.map((i) => i.key), ['fri']);
});

test('firing: once, nothing on the very first check, missed ones after sleep said once and a week back at most', () => {
  const items = [item('a', at(19, 10, 29)), item('b', at(19, 10, 31)), item('old', at(1, 9)), item('done', at(19, 10, 0), true)];
  let r = R.dueToFire(items, { lastCheck: null, fired: {} }, NOW.getTime());
  assert.equal(r.fire.length, 0, 'the first check ever says nothing');
  r = R.dueToFire(items, { lastCheck: at(19, 10, 0), fired: {} }, NOW.getTime());
  assert.deepEqual(r.fire.map((f) => [f.item.key, f.missed]), [['a', false]]);
  const again = R.dueToFire(items, { ...r.state, lastCheck: at(19, 10, 0) }, NOW.getTime() + 1000);
  assert.equal(again.fire.length, 0, 'said once');
  // The PC asleep since Saturday: due meanwhile, said as missed; the one from the 1st (over a week) is left for Today.
  const slept = R.dueToFire([item('sat', at(17, 18)), item('old', at(1, 9))], { lastCheck: at(17, 12), fired: {} }, NOW.getTime());
  assert.deepEqual(slept.fire.map((f) => [f.item.key, f.missed]), [['sat', true]]);
  const asleep = R.dueToFire([item('x', at(1, 9))], { lastCheck: at(1, 8), fired: {} }, NOW.getTime());
  assert.equal(asleep.fire.length, 0);
});

test('snooze choices: ten minutes, an hour, tomorrow at 9:00 am', () => {
  const s = R.snoozeTimes(NOW.getTime());
  assert.deepEqual(s.map((x) => x.at), [at(19, 10, 40), at(19, 11, 30), at(20, 9)]);
});

test('a moment typed as people say it after the ⏰ is written the exact way (left alone when exact or not understood)', () => {
  const apply = (line) => {
    const c = R.exactMoment(line, NOW);
    return c ? line.slice(0, c.from) + c.insert + line.slice(c.to) : line;
  };
  assert.equal(apply('- [ ] Order flour ⏰ friday 3pm'), '- [ ] Order flour ⏰ 2026-10-23 15:00');
  assert.equal(apply('- [ ] Bins ⏰ every Monday at 6pm'), '- [ ] Bins ⏰ 2026-10-19 18:00 every Monday');
  assert.equal(apply('- [ ] Ring Sam ⏰ tomorrow'), '- [ ] Ring Sam ⏰ 2026-10-20 09:00');
  assert.equal(apply('- [ ] Exact ⏰ 2026-10-23 09:00'), '- [ ] Exact ⏰ 2026-10-23 09:00');
  assert.equal(apply('- [ ] Vague ⏰ after lunch'), '- [ ] Vague ⏰ after lunch');
  assert.equal(apply('Not a task ⏰ friday'), 'Not a task ⏰ friday');
});

test('the same words in other capitals or punctuation are one reminder, found and fired once (9.5 O1/O2)', () => {
  // Matching is lower-case, punctuation and spacing blind; the note keeps the person's own words.
  assert.equal(R.normReminderText('Call Mum'), 'call mum');
  assert.equal(R.normReminderText('  call—mum! '), 'call mum');
  assert.equal(R.normReminderText("Mum's birthday"), 'mums birthday');
  const note = '- [ ] Call Mum ⏰ 2026-10-20 09:00\n';
  assert.equal(R.sameReminder(note, 'call mum', at(20, 9)), true);
  assert.equal(R.sameReminder(note, 'Call—Mum!', at(20, 9)), true);
  assert.equal(R.sameReminder(note, 'Call Dad', at(20, 9)), false);
  assert.equal(R.sameReminder(note, 'call mum', at(21, 9)), false, 'another morning is another reminder');
  assert.equal(R.sameReminder(note, 'call mum', at(20, 9), { unit: 'week', every: 1, days: [2] }), false, 'one-off and repeating are not the same');
  // One fired key however it was typed, so duplicates share it.
  const due = at(20, 9);
  assert.equal(R.reminderKey('Reminders.md', { text: 'Call Mum', due }), R.reminderKey('Reminders.md', { text: 'call mum!', due }));
  assert.notEqual(R.reminderKey('Reminders.md', { text: 'Call Mum', due }), R.reminderKey('Reminders.md', { text: 'Call Dad', due }));
  // Found after a case/punctuation-only edit, wherever the line moved to.
  const lines = ['# Reminders', '', '- [ ] call—mum! ⏰ 2026-10-20 09:00'];
  assert.equal(R.locateReminder(lines, 0, 'Call Mum'), 2);
  assert.equal(R.locateReminder(lines, 2, 'Call Dad'), -1);
  // Two duplicate lines due together fire as one (first wins), never two notices.
  const key = R.reminderKey('Reminders.md', { text: 'Call Mum', due: at(19, 10, 29) });
  const dupes = [
    { key, path: 'Reminders.md', title: 'Reminders', line: 1, text: 'Call Mum', due: at(19, 10, 29), timeGiven: true, repeat: null, done: false },
    { key, path: 'Reminders.md', title: 'Reminders', line: 2, text: 'call mum!', due: at(19, 10, 29), timeGiven: true, repeat: null, done: false },
  ];
  const r = R.dueToFire(dupes, { lastCheck: at(19, 10, 0), fired: {} }, NOW.getTime());
  assert.equal(r.fire.length, 1);
  assert.equal(r.fire[0].item.line, 1);
});

test('ticking rewrites an in-progress box too, never a silent no-op (9.5 fourth pass)', () => {
  assert.equal(R.setTicked('- [/] Nearly done', true), '- [x] Nearly done');
  assert.equal(R.setTicked('- [?] Not sure', true), '- [x] Not sure');
  assert.equal(R.setTicked('- [/] Nearly done', false), '- [ ] Nearly done');
});

test('across every home it could be in: Reminders.md and Inbox.md (seams O1)', () => {
  assert.deepEqual(R.REMINDER_HOMES, ['Reminders.md', 'Inbox.md']);
  const homes = [
    { path: 'Reminders.md', content: '# Reminders\n\n- [ ] Order flour ⏰ 2026-10-20 09:00\n' },
    { path: 'Inbox.md', content: '# Inbox\n\n- [ ] Call Mum ⏰ 2026-10-21 09:00\n' },
  ];
  assert.equal(R.findSameReminder(homes, 'call mum', at(21, 9)), 'Inbox.md', 'found in the other home');
  assert.equal(R.findSameReminder(homes, 'order flour', at(20, 9)), 'Reminders.md');
  assert.equal(R.findSameReminder(homes, 'call mum', at(22, 9)), null, 'another morning is another reminder');
  assert.equal(R.findSameReminder(homes, 'call dad', at(21, 9)), null);
  assert.equal(R.findSameReminder(homes, 'call mum', at(21, 9), { unit: 'week', every: 1, days: [3] }), null, 'one-off and repeating are not the same');
  assert.equal(R.findSameReminder([{ path: 'Shop.md', content: '- [ ] Call Mum ⏰ 2026-10-21 09:00\n' }, ...homes], 'call mum', at(21, 9)), 'Shop.md', 'the target first: named when it holds it too');
  assert.equal(R.findSameReminder([{ path: 'Reminders.md', content: '- [x] Call Mum ⏰ 2026-10-21 09:00\n' }], 'call mum', at(21, 9)), null, 'a ticked one is done with');
});

test('a near one at the same moment: within 5 minutes sharing a word of substance (seams O2)', () => {
  const homes = [{ path: 'Reminders.md', content: '# Reminders\n\n- [ ] Call Priya ⏰ 2026-10-20 09:00\n' }];
  assert.deepEqual(R.nearReminder(homes, 'phone Priya', at(20, 9)), { path: 'Reminders.md', line: 2, text: 'Call Priya', due: at(20, 9) });
  assert.equal(R.nearReminder(homes, 'phone Priya', new Date(2026, 9, 20, 9, 5).getTime())?.text, 'Call Priya', 'five minutes either way');
  assert.equal(R.nearReminder(homes, 'phone Priya', new Date(2026, 9, 20, 9, 6).getTime()), null, 'six minutes is another occasion');
  assert.equal(R.nearReminder(homes, 'phone Sam', at(20, 9)), null, 'no word of substance shared');
  assert.equal(R.nearReminder(homes, 'call Priya', at(20, 9)), null, 'the same reminder is already-set, never an offer');
  assert.equal(R.nearReminder(homes, 'go to', at(20, 9)), null, 'short words alone never match');
  assert.equal(R.nearReminder(homes, 'call Priya', new Date(2026, 9, 20, 9, 3).getTime())?.text, 'Call Priya', 'the same words a few minutes out are offered, so replacing asks first');
  const daily = [{ path: 'Reminders.md', content: '- [ ] Take pill ⏰ 2026-10-20 09:00 every day\n' }];
  assert.equal(R.nearReminder(daily, 'take pill', at(20, 9), null)?.text, 'Take pill', 'a one-off beside the daily one asks first');
  const ticked = [{ path: 'Reminders.md', content: '- [x] Call Priya ⏰ 2026-10-20 09:00\n' }];
  assert.equal(R.nearReminder(ticked, 'phone Priya', at(20, 9)), null, 'a ticked one is done with');
});

test('small words never match: "the" at the same default 9:00 am is two reminders (v8-vault-assistant F4)', () => {
  const homes = [{ path: 'Reminders.md', content: '- [ ] Send the receipt v2 for review ⏰ 2026-11-06 09:00\n' }];
  assert.equal(R.nearReminder(homes, 'Call the caterer', new Date(2026, 10, 6, 9, 0).getTime()), null, 'only "the" shared: set, never a bogus Replace-or-Keep');
  const caterer = [{ path: 'Reminders.md', content: '- [ ] Ring the caterer about Friday ⏰ 2026-11-06 09:00\n' }];
  assert.equal(R.nearReminder(caterer, 'Call the caterer', new Date(2026, 10, 6, 9, 0).getTime())?.text, 'Ring the caterer about Friday', 'a real word shared still asks first');
  assert.equal(R.nearReminder(homes, 'the and', new Date(2026, 10, 6, 9, 0).getTime()), null, 'nothing of substance to judge by');
});
