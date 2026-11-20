// node --test tests/capture.test.mjs — Quick capture (src/shared/capture.ts): due dates read from a task's words relative to
// a fixed day, the project a capture is suggested for (and why), where each kind of capture is filed, the lines it adds to
// today's note, and the Windows-wide key as Electron writes it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-capture-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/capture.ts'), platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Wednesday 14 October 2026, mid-morning.
const WED = new Date(2026, 9, 14, 10, 30);
const due = (text, today = WED) => C.parseDue(text, today);

test('weekdays: the next one after today; "this" can be today; "next" is next week’s', () => {
  assert.equal(due('Send the quote to Priya by Friday').iso, '2026-10-16');
  assert.equal(due('Send the quote to Priya by Friday').rest, 'Send the quote to Priya');
  assert.equal(due('Send the quote to Priya by Friday').words, 'Fri 16 Oct');
  assert.equal(due('Send the quote to Priya by Friday').line, '16 Oct 2026');
  assert.equal(due('by fri: book the room').iso, '2026-10-16');
  assert.equal(due('by fri: book the room').rest, 'book the room');
  assert.equal(due('Chase the tills by Wednesday').iso, '2026-10-21', 'said on a Wednesday: next week’s');
  assert.equal(due('Chase the tills this Wednesday').iso, '2026-10-14', '"this" on the day is today');
  assert.equal(due('Book the second wave next Friday').iso, '2026-10-23', '"next Friday" is the Friday of next week');
  assert.equal(due('Book the second wave next Monday').iso, '2026-10-19');
  assert.equal(due('Call Sam Friday').iso, '2026-10-16', 'a weekday in full, last');
  assert.equal(due('Call Sam on Mon').iso, '2026-10-19');
  // Said on a Friday: "by Friday" is a week away; "this Friday" is today.
  const FRI = new Date(2026, 9, 16, 9);
  assert.equal(due('Ship it by Friday', FRI).iso, '2026-10-23');
  assert.equal(due('Ship it this Friday', FRI).iso, '2026-10-16');
});

test('words that only look like days are left alone', () => {
  assert.equal(due('I sat with Priya about the floor plan'), null);
  assert.equal(due('Wed the two lists together'), null);
  assert.equal(due('Review Friday’s numbers with finance'), null, 'a weekday in the middle of words, without by/on');
  assert.equal(due('Order 1/2 a pallet of flour'), null, 'a half is not 1 February');
  assert.equal(due('Write the opening hours block'), null);
});

test('a weekday with a time keeps its day: the time stays in the words', () => {
  assert.equal(due('Call Sam Friday 3pm').iso, '2026-10-16');
  assert.equal(due('Call Sam Friday 3pm').rest, 'Call Sam 3pm');
  assert.equal(due('Call Sam Friday at 3pm').iso, '2026-10-16');
  assert.equal(due('Call Sam Friday 3:30 pm').iso, '2026-10-16');
  assert.equal(due('Call Sam Friday 3 stooges'), null, 'a bare number is not a time');
});

test('today, tomorrow, the end of the week or month, next week, in N days', () => {
  assert.equal(due('Ring the landlord today').iso, '2026-10-14');
  assert.equal(due('Ring the landlord tomorrow').iso, '2026-10-15');
  assert.equal(due('Ring the landlord tomorrow').rest, 'Ring the landlord');
  assert.equal(due('Ring the landlord by tmrw').iso, '2026-10-15');
  assert.equal(due('Send the report by end of the week').iso, '2026-10-16');
  assert.equal(due('Send the report by EOW').iso, '2026-10-16');
  assert.equal(due('Send the report by the end of the week', new Date(2026, 9, 17)).iso, '2026-10-23', 'on a Saturday: next week’s Friday');
  assert.equal(due('Plan the menu next week').iso, '2026-10-23', '"next week" is the Friday of next week, as meeting actions read it, not its Monday');
  assert.equal(due('Start the stocktake next month').iso, '2026-11-30', '"next month" is the end of next month, as meeting actions read it, not its first day');
  assert.equal(due('Invoice by end of month').iso, '2026-10-31');
  assert.equal(due('Check the backups in 3 days').iso, '2026-10-17');
  assert.equal(due('Check the backups in two weeks').iso, '2026-10-28');
  assert.equal(due('Renew the domain in a month').iso, '2026-11-14');
  assert.equal(due('Renew the domain in a month', new Date(2027, 0, 31)).iso, '2027-02-28', 'a month on from 31 Jan is the end of Feb');
});

test('written dates: day first, no year means the next one', () => {
  assert.equal(due('Approve the lighting quote by 24 Oct').iso, '2026-10-24');
  assert.equal(due('Approve the lighting quote by 24 Oct').rest, 'Approve the lighting quote');
  assert.equal(due('Approve the lighting quote by 24th of October').iso, '2026-10-24');
  assert.equal(due('Approve the lighting quote by Oct 24').iso, '2026-10-24');
  assert.equal(due('Approve the lighting quote by October 24th, 2027').iso, '2027-10-24');
  assert.equal(due('Approve the lighting quote by 24/10').iso, '2026-10-24');
  assert.equal(due('Approve the lighting quote 24/10/2026').iso, '2026-10-24', 'with a year it needs no "by"');
  assert.equal(due('Move in by 2026-12-12').iso, '2026-12-12');
  assert.equal(due('Renew the lease by 3 March').iso, '2027-03-03', 'a passed day and month: next year');
  assert.equal(due('Renew the lease by 3 March').words, 'Wed 3 Mar 2027', 'another year is written');
  assert.equal(due('Pay by 31 Feb'), null, 'a day that isn’t there');
});

test('several dates: the one said with "by" or "due" wins, else the last', () => {
  const d = due('After Monday’s meeting, send the minutes due Thursday');
  assert.equal(d.iso, '2026-10-15');
  assert.equal(d.rest, 'After Monday’s meeting, send the minutes');
  assert.equal(due('Book next Friday tomorrow').iso, '2026-10-15', 'neither firm: the last');
});

const day = 86400000;
const NOW = WED.getTime();
const PROJECTS = [
  { path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade', folderName: '01 Studio upgrade', people: ['Sam Taylor', 'Priya Shah', 'Finance team'], tags: ['stores', 'rollout'], status: 'active', modified: NOW - 2 * 3600000 },
  { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out', folderName: '02 Harbour fit-out', people: ['Priya Shah'], tags: [], status: 'planning', modified: NOW - 4 * day },
  { path: 'Projects/Winter Menu Launch/Winter Menu Launch.md', name: 'Winter Menu Launch', people: ['Alex Lee'], tags: ['menu'], status: 'active', modified: NOW - 9 * day },
  { path: 'Projects/Supplier Review/Supplier Review.md', name: 'Supplier Review', people: [], tags: [], status: 'done', modified: NOW - 20 * day },
];
const suggest = (text, more = {}) => C.suggestProjects({ text, projects: PROJECTS, now: NOW, ...more });

test('a project named in the words comes first, with why', () => {
  const s = suggest('Studio upgrade: the Bendigo tills still need disk space');
  assert.equal(s[0].name, 'Studio Upgrade');
  assert.equal(s[0].evidence, 'words');
  assert.equal(s[0].reason, 'Says “Studio Upgrade”');
  assert.equal(C.chosenSuggestion(s).name, 'Studio Upgrade');
});

test('a distinctive word of the name, a person, a tag', () => {
  const harbour = suggest('Ask Harbourline about the harbour meeting rooms');
  assert.equal(harbour[0].name, 'Harbour Fit-out');
  assert.equal(harbour[0].reason, 'Says “Harbour”');
  const alex = suggest('Alex said the soup photos are late');
  assert.equal(alex[0].name, 'Winter Menu Launch');
  assert.equal(alex[0].reason, 'Mentions Alex');
  const full = suggest('Check with Sam Taylor before Friday');
  assert.equal(full[0].name, 'Studio Upgrade');
  assert.equal(full[0].reason, 'Mentions Sam Taylor');
  const menu = suggest('New menu boards for the counter');
  assert.equal(menu[0].name, 'Winter Menu Launch', 'its name word and its tag');
  // A first name two projects share: both are offered, the more recent first, and neither is chosen for the person.
  const priya = suggest('Priya wants the numbers');
  assert.deepEqual(priya.slice(0, 2).map((x) => x.name), ['Studio Upgrade', 'Harbour Fit-out']);
  assert.equal(priya[0].reason, 'Mentions Priya');
});

test('one short word is not evidence; two short words are, and a long word still is (t243)', () => {
  const refit = { path: 'Projects/The December refit of the back room/The December refit of the back room.md', name: 'The December refit of the back room', people: [], tags: [], modified: NOW - 9 * day };
  const withRefit = [refit, ...PROJECTS];
  // Critic 1 #6: a bank email saying "wrote back" was filed to the refit on "back" alone, reason "Says back".
  const one = C.suggestProjects({ text: 'The bank wrote back about the Saturday failure', projects: withRefit, now: NOW });
  assert.ok(one.filter((x) => x.evidence === 'words').every((x) => x.score < 24), 'one short word stays under the bar');
  assert.equal(C.chosenSuggestion(one), null, 'nothing chosen for the person');
  const two = C.suggestProjects({ text: 'Back room rewire quotes are in', projects: withRefit, now: NOW });
  assert.equal(two[0].name, 'The December refit of the back room');
  assert.equal(two[0].reason, 'Says “back” and “room”', 'each word that counted is named');
  assert.equal(C.chosenSuggestion(two).name, 'The December refit of the back room');
  const long = C.suggestProjects({ text: 'Ask Harbourline about the harbour meeting rooms', projects: PROJECTS, now: NOW });
  assert.equal(long[0].name, 'Harbour Fit-out', 'a long word still suggests on its own');
  assert.equal(long[0].reason, 'Says “Harbour”');
});

test('the window the person was in', () => {
  const s = suggest('Chase this one', { windowTitle: 'Store_Upgrade_Status_2026-10-16.xlsx - Excel' });
  assert.equal(s[0].name, 'Studio Upgrade');
  assert.equal(s[0].evidence, 'window');
  assert.equal(s[0].reason, 'From the window you were in');
  assert.equal(C.chosenSuggestion(s).name, 'Studio Upgrade');
  const folder = suggest('Floor plan comments', { windowTitle: '02 Harbour fit-out - File Explorer' });
  assert.equal(folder[0].name, 'Harbour Fit-out');
  // The words beat the window.
  const both = suggest('Alex needs the soup photos', { windowTitle: 'Store_Upgrade_Status.xlsx - Excel' });
  assert.equal(both[0].name, 'Winter Menu Launch');
});

test('nothing to go on: recent projects to choose from, none chosen; done ones left out', () => {
  const s = suggest('Remember to buy milk', { recent: ['Projects/Harbour Fit-out/Harbour Fit-out.md'] });
  assert.ok(s.every((x) => x.evidence === 'recent'));
  assert.equal(s[0].name, 'Harbour Fit-out', 'the last capture’s project first');
  assert.equal(s[0].reason, 'Your last capture');
  assert.equal(s[1].name, 'Studio Upgrade');
  assert.equal(s[1].reason, 'Worked on today');
  assert.ok(!s.some((x) => x.name === 'Supplier Review'), 'a done project is not offered without a reason');
  assert.equal(C.chosenSuggestion(s), null, '"No project" until the person picks one');
  assert.equal(suggest('Supplier review notes')[0].name, 'Supplier Review', 'a done project named in the words still comes up');
});

const files = (kind, text, project, extra = {}) =>
  C.planCapture({
    kind,
    text,
    project,
    pictures: 0,
    files: 0,
    toAssets: false,
    noProject: 'daily',
    dailyPath: 'Daily/2026-10-14.md',
    inboxPath: 'Inbox.md',
    attachmentsFor: () => 'Attachments',
    now: WED,
    ...extra,
  });
const STORE = { path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade', pcFolder: 'C:\\Work\\01 Studio upgrade' };
const MENU = { path: 'Projects/Winter Menu Launch/Winter Menu Launch.md', name: 'Winter Menu Launch', pcFolder: null };

test('where it files: a task becomes a next step in the project, with its by-when', () => {
  const plan = files('task', 'Send the reconciliation to finance by Friday', STORE);
  assert.deepEqual(plan.nextStep, { project: STORE.path, what: 'Send the reconciliation to finance', when: '16 Oct 2026' });
  assert.equal(plan.newNote, undefined);
  assert.equal(plan.append, undefined);
  assert.deepEqual(files('task', 'Photograph the soups', MENU).nextStep, { project: MENU.path, what: 'Photograph the soups' });
});

test('a task keeps its whole body: the first line is the task, the rest rides along', () => {
  const plan = files('task', 'Ring Priya\nabout the lease\nbefore lunch', STORE);
  assert.equal(plan.what, 'Ring Priya');
  assert.equal(plan.rest, 'about the lease\nbefore lunch');
  assert.deepEqual(plan.nextStep, { project: STORE.path, what: 'Ring Priya', more: 'about the lease\nbefore lunch' });
  const daily = files('task', 'Ring Priya\nabout the lease', null);
  assert.equal(C.taskLine(daily.what, daily.due, daily.rest), '- [ ] Ring Priya\n  about the lease');
  assert.equal(C.taskLine('Ring Priya', null, ''), '- [ ] Ring Priya');
  assert.equal(files('task', 'Photograph the soups', MENU).rest, undefined, 'one line: nothing rides along');
});

test('short names said in capitals still suggest their project: “IT” is not “it”', () => {
  const IT = { path: 'Projects/IT/IT.md', name: 'IT', folderName: 'IT', people: [], tags: [], status: 'active', modified: NOW };
  const s = C.suggestProjects({ text: 'Working on the IT upgrade', projects: [...PROJECTS, IT], now: NOW });
  assert.equal(s[0].name, 'IT');
  const lower = C.suggestProjects({ text: 'split it up and stack it', projects: [...PROJECTS, IT], now: NOW });
  assert.ok(!lower.some((x) => x.name === 'IT' && x.evidence === 'words'), 'lowercase “it” is no project');
  const AL = { path: 'Projects/Ops/Ops.md', name: 'Ops', folderName: 'Ops', people: ['Al Taylor'], tags: [], status: 'active', modified: NOW };
  const al = C.suggestProjects({ text: 'Ask Al about Friday', projects: [AL], now: NOW });
  assert.equal(al[0].reason, 'Mentions Al');
});

test('a capture note lands where the note keeps such lines, even renamed', () => {
  assert.equal(C.captureNotePath('Projects/Studio Upgrade', 'Tiler short of grout'), 'Projects/Studio Upgrade/Tiler short of grout.md');
});

test('where it files: a note goes in the project’s folder of notes; its pictures beside it', () => {
  const plan = files('note', 'Bendigo tills\nFive are short of disk space.', STORE, { pictures: 1 });
  assert.deepEqual(plan.newNote, { folder: 'Projects/Studio Upgrade', title: 'Bendigo tills' });
  assert.deepEqual(plan.attach, { place: 'library', folder: 'Projects/Studio Upgrade/Captures' });
});

test('where it files: a picture on its own goes to the project’s folder on the PC › Captures', () => {
  assert.deepEqual(files('note', '', STORE, { pictures: 1 }).attach, { place: 'pc', folder: 'C:\\Work\\01 Studio upgrade\\Captures' });
  assert.deepEqual(files('note', '', MENU, { pictures: 1 }).attach, { place: 'library', folder: 'Projects/Winter Menu Launch/Captures' }, 'no folder on the PC: the library’s');
  assert.deepEqual(files('task', 'Fix the till screen', STORE, { pictures: 1 }).attach, { place: 'pc', folder: 'C:\\Work\\01 Studio upgrade\\Captures' }, 'with a next step: the folder too');
  assert.deepEqual(files('note', 'Signage', STORE, { pictures: 1, toAssets: true }).attach, { place: 'assets', folder: '' }, 'Save to assets');
});

test('where it files: no project → today’s note, or the Inbox', () => {
  assert.deepEqual(files('note', 'Buy milk', null).append, { path: 'Daily/2026-10-14.md', place: 'daily' });
  assert.deepEqual(files('task', 'Buy milk tomorrow', null).append, { path: 'Daily/2026-10-14.md', place: 'daily' });
  assert.equal(files('task', 'Buy milk tomorrow', null).due.iso, '2026-10-15');
  assert.deepEqual(files('note', 'Buy milk', null, { noProject: 'inbox' }).append, { path: 'Inbox.md', place: 'inbox' });
  const picture = files('note', '', null, { pictures: 1 });
  assert.deepEqual(picture.append, { path: 'Daily/2026-10-14.md', place: 'daily' }, 'a picture alone still lands in today’s note');
  assert.deepEqual(picture.attach, { place: 'library', folder: 'Attachments' });
  assert.equal(files('note', '   ', null).append, undefined, 'nothing to save');
});

test('note names from the first line', () => {
  assert.equal(C.noteTitle('# Bendigo tills: 5 short of space\nmore', WED), 'Bendigo tills 5 short of space');
  assert.equal(C.noteTitle('- [ ] a/b test?', WED), 'a b test');
  assert.equal(C.noteTitle('', WED), 'Capture 14 Oct 2026 1030');
  const long = C.noteTitle('The regional shift leads asked for a quiet week before the change freeze so we wait', WED);
  assert.ok(long.length <= 61 && !long.endsWith(' '), long);
  assert.equal(C.screenshotName(WED), 'Screenshot 14 Oct 2026 1030.png');
});

test('lines added to today’s note under Captured, keeping the rest exactly', () => {
  const lines = C.captureLines('Buy milk\nand bread', '10:30', ['![[Attachments/Screenshot.png]]']);
  assert.deepEqual(lines, ['- 10:30 Buy milk', '  and bread', '  ![[Attachments/Screenshot.png]]']);
  assert.equal(C.appendUnder('', ['- a']), '## Captured\n\n- a\n');
  assert.equal(C.appendUnder('# 14 Oct\n\nPlans.\n\n', ['- a']), '# 14 Oct\n\nPlans.\n\n## Captured\n\n- a\n');
  const twice = C.appendUnder(C.appendUnder('# Day\n', ['- a']), ['- b']);
  assert.equal(twice, '# Day\n\n## Captured\n\n- a\n- b\n');
  const middle = C.appendUnder('# Day\n\n## Captured\n\n- a\n\n## Later\n\nKept.\n', ['- b']);
  assert.equal(middle, '# Day\n\n## Captured\n\n- a\n- b\n\n## Later\n\nKept.\n');
  assert.equal(C.appendUnder('# Day\r\n\r\n## Captured\r\n', ['- b']), '# Day\r\n\r\n## Captured\r\n\r\n- b\r\n', 'Windows line ends kept');
  assert.equal(C.taskLine('Call Priya', due('Call Priya by Friday')), '- [ ] Call Priya — by 16 Oct 2026');
  assert.equal(C.appendUnder('# Day\n\n## Notes\n\n- a\n', ['- b']), '# Day\n\n## Notes\n\n- a\n- b\n', 'no Captured: the notes pile takes them');
  assert.equal(C.appendUnder('# Day\n\n## Captured\n\n- a\n\n## Notes\n\n- n\n', ['- b']), '# Day\n\n## Captured\n\n- a\n- b\n\n## Notes\n\n- n\n', 'Captured first when it is there');
  assert.equal(C.appendUnder('# Day\n\n## Notes\n\n- n\n', ['- b'], 'Log'), '# Day\n\n## Notes\n\n- n\n\n## Log\n\n- b\n', 'a named heading stays exact');
  assert.equal(C.noteText('Words', ['![[Captures/a.png]]'], 'Studio Upgrade', '2026-10-14 10:30'), '---\ncaptured: 2026-10-14 10:30\nproject: "[[Studio Upgrade]]"\n---\n\nWords\n\n![[Captures/a.png]]\n');
});

test('the key, as Electron writes it', () => {
  assert.equal(C.DEFAULT_CAPTURE_KEY, 'Control+Alt+N');
  assert.equal(C.acceleratorOf('Mod+Alt+Space'), 'Control+Alt+Space');
  assert.equal(C.acceleratorOf('Mod+Shift+K'), 'Control+Shift+K');
  assert.equal(C.acceleratorOf('Meta+Shift+N'), 'Shift+Super+N');
  assert.equal(C.acceleratorOf('Alt+F9'), 'Alt+F9');
  assert.equal(C.acceleratorOf('Shift+K'), null, 'needs Ctrl, Alt or the Windows key');
  assert.equal(C.acceleratorOf('K'), null);
  assert.equal(C.acceleratorOf('Alt+Tab'), null, 'Windows’ own');
  assert.equal(C.keyWords('Control+Alt+Space'), 'Ctrl + Alt + Space');
  assert.equal(C.keyWords('Shift+Super+N'), 'Shift + Win + N');
});
