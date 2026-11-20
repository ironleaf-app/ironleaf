// node --test tests/meetings.test.mjs — meetings → next steps (src/shared/meetings.ts, src/shared/days.ts): a meeting
// note's actions read into what / who / by when (Actions headings, open tick boxes, "Sam to … by Friday", @mentions,
// the template's "what — who — by when"), days read from the meeting's date, the project the note belongs to, filed
// marks written and taken off again, and nothing offered twice. Made-up bakery and IT meetings only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meetings-'));
let M, D, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['m', 'meetings'], ['d', 'days'], ['p', 'project-file']]) await build({ input: path.join(root, `src/shared/${file}.ts`), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  D = await import(pathToFileURL(path.join(work, 'd.mjs')).href);
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Thursday 15 October 2026, the made-up site meeting.
const THU = new Date(2026, 9, 15);
const iso = (d) => D.isoDay(d);

const SITE_MEETING = `---
type: meeting
date: 2026-10-15
project: "[[Harbour Fit-out]]"
attendees: [Priya Shah, Sam Taylor, Mere Walker]
tags: [meeting]
---
**When:** Thursday 15 October 2026, 10:00
**Who came:** Priya Shah, Sam Taylor, Mere Walker

## What we talked about
- The lighting quote came in higher than planned.
- Sam to confirm the cabling contractor by Friday
- We agreed to move the phone booth to level 3.
- Move to the new floor plan.

## Decisions
- Mere to own the room booking system
- [ ] Not an action: a decision with a box

## Actions
- [ ] Approve the Harbourline Signs quote — Priya — by 24 Oct
- [ ] Send the revised floor plan to the landlord — Mere · by Tue
- [x] Book the site walk-through — Sam
- [ ] What needs doing — who — by when
- Priya: chase the network vendor for the switch prices (next week)
- @Sam check the lift access hours
  - with the building manager
- Order the meeting room signs by the end of the week
- Mere and Priya will draft the move-in checklist by 2026-10-30

## Next meeting
Thursday 22 Oct.
`;

test('days are read from the day they were written', () => {
  assert.equal(iso(D.readDay('Friday', THU)), '2026-10-16');
  assert.equal(iso(D.readDay('by Fri', THU)), '2026-10-16');
  assert.equal(iso(D.readDay('Thursday', THU)), '2026-10-22', 'the same weekday is a week later');
  assert.equal(iso(D.readDay('next Friday', new Date(2026, 9, 12))), '2026-10-23', 'said on a Monday: the Friday of the week after');
  assert.equal(iso(D.readDay('Tue', THU)), '2026-10-20');
  assert.equal(iso(D.readDay('tomorrow', THU)), '2026-10-16');
  assert.equal(iso(D.readDay('end of the week', THU)), '2026-10-16');
  assert.equal(iso(D.readDay('EOW', new Date(2026, 9, 17))), '2026-10-23', 'on a Saturday the end of the week is the coming Friday');
  assert.equal(iso(D.readDay('next week', THU)), '2026-10-23');
  assert.equal(iso(D.readDay('end of month', THU)), '2026-10-31');
  assert.equal(iso(D.readDay('24 Oct', THU)), '2026-10-24');
  assert.equal(iso(D.readDay('24th of October', THU)), '2026-10-24');
  assert.equal(iso(D.readDay('October 24', THU)), '2026-10-24');
  assert.equal(iso(D.readDay('Fri 23 Oct', THU)), '2026-10-23');
  assert.equal(iso(D.readDay('24/10', THU)), '2026-10-24', 'day then month');
  assert.equal(iso(D.readDay('2026-11-02', THU)), '2026-11-02');
  assert.equal(iso(D.readDay('the 3rd', THU)), '2026-11-03', 'a day already past this month is next month’s');
  assert.equal(iso(D.readDay('10 Jan', new Date(2026, 11, 14))), '2027-01-10', 'the nearest year');
  assert.equal(iso(D.readDay('in 2 weeks', THU)), '2026-10-29');
  assert.equal(D.readDay('the menu', THU), null);
  assert.equal(D.readDay('31 Feb', THU), null);
  assert.equal(D.dayWords(new Date(2026, 9, 24), THU), '24 Oct');
  assert.equal(D.dayWords(new Date(2027, 0, 10), THU), '10 Jan 2027');
});

// HOLD 5 (6 Nov 2026, h1 break-it): "Thursday the 19th" firming to Thu 12 Nov. A weekday with a
// numbered day is that date (the date with that number on or after the day it was written); when
// that date is not that weekday the words are doubtful and stay words, never a guess. Written on
// Friday 6 Nov 2026 unless said; loose days keep staying words as e2 left them.
test('hold5: a weekday with a numbered day is that date, or stays words', () => {
  const fri = new Date(2026, 10, 6);
  assert.equal(iso(D.readDay('Thursday the 19th', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('Thursday the 19th of November', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('Thu 19th', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('Thu 19 Nov', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('the 19th', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('19 November', fri)), '2026-11-19');
  assert.equal(iso(D.readDay('Monday the 16th', fri)), '2026-11-16');
  assert.equal(iso(D.readDay('Tuesday the 17th', fri)), '2026-11-17', 'the minutes’ own words keep resolving');
  assert.equal(iso(D.readDay('Thursday the 12th', new Date(2026, 10, 12))), '2026-11-12', 'said that day, it is that day');
  assert.equal(D.readDay('Monday the 19th', fri), null, '19 Nov 2026 is a Thursday: doubtful, never the coming Monday');
  assert.equal(D.readDay('Friday the 19th of November', fri), null, 'a wrong weekday beside a full date stays words too');
  assert.equal(D.readDay('Thu 20 Nov', fri), null, '20 Nov 2026 is a Friday');
  assert.equal(iso(D.readDay('Tuesday the 1st', new Date(2026, 10, 27))), '2026-12-01', 'across a month end');
  assert.equal(iso(D.readDay('Friday the 1st', new Date(2026, 11, 28))), '2027-01-01', 'across a year end');
  assert.equal(D.readDay('Thursday the 19th', new Date(2026, 10, 20)), null, 'the next 19th (19 Dec) is a Saturday: doubtful');
  assert.equal(D.looseDayWords('Monday the 19th', fri), true, 'doubtful words are loose words');
  assert.equal(D.looseDayWords('Thursday the 19th', fri), false, 'a matching weekday and number is exact');
  assert.equal(D.looseDayWords('Friday', fri), true, 'by Friday said on a Friday still stays words (e2)');
  assert.equal(iso(D.readDay('next Thursday', fri)), '2026-11-12');
  assert.equal(iso(D.readDay('this Thursday', fri)), '2026-11-12');
  // The meeting reader takes the whole phrase as the when, and firms only a true one.
  const opts = { date: fri, people: ['Sam Taylor'] };
  assert.deepEqual(M.readAction('Book the crane by Thursday the 19th', opts), { what: 'Book the crane', whenWords: 'Thursday the 19th', due: '2026-11-19' });
  assert.deepEqual(M.readAction('Book the crane by Monday the 19th', opts), { what: 'Book the crane', whenWords: 'Monday the 19th' }, 'doubtful words kept whole, no due invented');
});

test('one action read into what / who / by when', () => {
  const opts = { date: THU, people: ['Priya Shah', 'Sam Taylor', 'Mere Walker'] };
  assert.deepEqual(M.readAction('Sam to confirm the cabling contractor by Friday', opts), { what: 'Confirm the cabling contractor', who: 'Sam Taylor', whenWords: 'Friday', due: '2026-10-16' });
  assert.deepEqual(M.readAction('Approve the Harbourline Signs quote — Priya — by 24 Oct', opts), { what: 'Approve the Harbourline Signs quote', who: 'Priya Shah', whenWords: '24 Oct', due: '2026-10-24' });
  assert.deepEqual(M.readAction('Send the plan — Mere · by Tue', opts), { what: 'Send the plan', who: 'Mere Walker', whenWords: 'Tue', due: '2026-10-20' });
  // Reason changed (6 Nov 2026, e2): a span is loose words with no firm day, as the minutes and PDF
  // already kept it; this reader used to firm "(next week)" to the coming Friday.
  assert.deepEqual(M.readAction('Priya: chase the vendor (next week)', opts), { what: 'Chase the vendor', who: 'Priya Shah', whenWords: 'Next week' });
  assert.deepEqual(M.readAction('@Sam check the lift access hours', opts), { what: 'Check the lift access hours', who: 'Sam Taylor' });
  assert.deepEqual(M.readAction('Call the printer @mia.chen tomorrow', {}), { what: 'Call the printer', who: 'Mia Chen', whenWords: 'Tomorrow', due: D.isoDay(D.addDays(new Date(), 1)) });
  assert.deepEqual(M.readAction('Owner to do the stocktake by Friday', { date: THU }), { what: 'Do the stocktake', who: 'Owner', whenWords: 'Friday', due: '2026-10-16' }, 'the brief’s own example');
  assert.deepEqual(M.readAction('Mere and Priya will draft the checklist by 2026-10-30', opts), { what: 'Draft the checklist', who: 'Mere Walker and Priya Shah', whenWords: '2026-10-30', due: '2026-10-30' });
  assert.deepEqual(M.readAction('Action: book the van (Sam)', opts), { what: 'Book the van', who: 'Sam Taylor' });
  assert.deepEqual(M.readAction('Sam to book the van', { people: ['Sam', 'Sam Taylor'] }), { what: 'Book the van', who: 'Sam Taylor' }, 'the full name, even when a bare “Sam” is known too');
  assert.deepEqual(M.readAction('Sam to book the van', { people: ['Sam Taylor', 'Sam Okafor'] }), { what: 'Book the van', who: 'Sam' }, 'two Sams: left as written');
  assert.deepEqual(M.readAction('Ring the council — owner: Mere', opts), { what: 'Ring the council', who: 'Mere Walker' });
  assert.deepEqual(M.readAction('I will send the minutes', { me: 'Priya Shah' }), { what: 'I will send the minutes' }, '"I" isn’t read as a name');
  assert.deepEqual(M.readAction('Decide the menu — this matters', {}), { what: 'Decide the menu — this matters' }, 'words after a dash that aren’t a person stay in what');
  assert.deepEqual(M.readAction('Read [[Pricing ideas|the pricing note]] and **reply**', {}), { what: 'Read the pricing note and reply' });
  // e2-meeting-faults fault 2 (6 Nov 2026, the Fitzroy take): loose words read as words with no
  // firm day, in every shape, judged against the meeting's day (Friday 6 Nov 2026).
  const fri = new Date(2026, 10, 6);
  assert.deepEqual(M.readAction('Chase the stone top for Thursday morning — by Thursday morning', { date: fri }), { what: 'Chase the stone top for Thursday morning', whenWords: 'Thursday morning' }, 'a weekday with its part of day names no known day');
  assert.deepEqual(M.readAction('Chase the stone top by Thursday morning', { date: fri }), { what: 'Chase the stone top', whenWords: 'Thursday morning' }, 'and never half of it');
  assert.deepEqual(M.readAction('Check the opening stock order totals — Kate Sullivan · by Friday', { date: fri, people: ['Kate Sullivan'] }), { what: 'Check the opening stock order totals', who: 'Kate Sullivan', whenWords: 'Friday' }, '"Friday" said on a Friday stays words');
  assert.deepEqual(M.readAction('Chase the vendor (next week)', { date: fri }), { what: 'Chase the vendor', whenWords: 'Next week' }, 'a span stays words');
  assert.deepEqual(M.readAction('Check the first day totals on opening morning, by opening morning', { date: fri }), { what: 'Check the first day totals on opening morning', whenWords: 'Opening morning' }, 'a comma tail reads as the dash tail did (e2: no em dash written)');
  assert.deepEqual(M.readAction('Book the van, by 11 Nov 2026', { date: fri }), { what: 'Book the van', whenWords: '11 Nov 2026', due: '2026-11-11' }, 'a comma exact day still firms');
  assert.equal(M.readAction('What needs doing — who — by when', {}), null, 'the template’s example line');
  assert.equal(M.readAction('None this week', {}), null);
});

// Dates keep the words' meaning (t248 item 3, 12 Nov 2026, structure N7): "Book the room for next
// Tuesday" read "Book the room for" — the day's lead word dangled. for, to and from belong to the
// day, so the shown words stay whole and read naturally beside the day.
test('a date read out leaves no dangling word', () => {
  const fri = new Date(2026, 10, 6);
  assert.deepEqual(M.readAction('Book the room for next Tuesday', { date: fri }), { what: 'Book the room', whenWords: 'Next Tuesday', due: '2026-11-10' });
  assert.deepEqual(M.readAction('Book travel to next Tuesday', { date: fri }), { what: 'Book travel', whenWords: 'Next Tuesday', due: '2026-11-10' });
  assert.deepEqual(M.readAction('Off from Monday', { date: THU }), { what: 'Off', whenWords: 'Monday', due: '2026-10-19' });
  assert.deepEqual(M.readAction('Follow up with June for Friday', { date: fri }), { what: 'Follow up with June', whenWords: 'Friday' }, 'loose words still stay words, whole');
  assert.deepEqual(M.readAction('Ask Sam for the logs by Friday', { date: THU, people: ['Sam Taylor'] }), { what: 'Ask Sam for the logs', whenWords: 'Friday', due: '2026-10-16' }, 'a for inside the words stays');
});

test('every action in a meeting note, and only actions', () => {
  const people = M.notePeople(SITE_MEETING, { attendees: ['Priya Shah', 'Sam Taylor', 'Mere Walker'] });
  assert.deepEqual(people, ['Priya Shah', 'Sam Taylor', 'Mere Walker']);
  const found = M.findActions(SITE_MEETING, { date: THU, people });
  const brief = found.map((a) => [a.how, a.what, a.who ?? '', a.due ?? '']);
  assert.deepEqual(brief, [
    ['phrase', 'Confirm the cabling contractor', 'Sam Taylor', '2026-10-16'],
    ['actions', 'Approve the Harbourline Signs quote', 'Priya Shah', '2026-10-24'],
    ['actions', 'Send the revised floor plan to the landlord', 'Mere Walker', '2026-10-20'],
    // Spans ("next week", "the end of the week") carry no firm day (6 Nov 2026, e2, as above).
    ['actions', 'Chase the network vendor for the switch prices', 'Priya Shah', ''],
    ['actions', 'Check the lift access hours', 'Sam Taylor', ''],
    ['actions', 'Order the meeting room signs', '', ''],
    ['actions', 'Draft the move-in checklist', 'Mere Walker and Priya Shah', '2026-10-30'],
  ]);
  // Left out: talk that isn't a job, Decisions (even with a box), the ticked box, the template line, the sub-point, the next meeting.
  const words = found.map((a) => a.what).join('|');
  for (const not of ['lighting quote came in', 'phone booth', 'new floor plan.', 'room booking', 'Not an action', 'site walk-through', 'What needs doing', 'building manager', 'Thursday 22']) assert.ok(!words.includes(not), `not an action: ${not}`);
  // Each one knows its line, as written.
  const a = found[1];
  assert.equal(SITE_MEETING.split('\n')[a.line], a.raw);
});

test('a place, topic or supplier before a colon is not who, and a day inside a sentence stays in it (24 Oct 2026)', () => {
  const opts = { date: THU, people: ['Bettina Kent', 'Sam Taylor'] };
  // read as who, and "on 19 Oct" cut out of the middle of the sentence.
  assert.deepEqual(M.readAction('Northgate: Tessaly quote v2.2 lapsed on 19 Oct; reprice before the board pack', opts), { what: 'Northgate: Tessaly quote v2.2 lapsed on 19 Oct; reprice before the board pack' });
  assert.deepEqual(M.readAction('Budget: tiles came in over by 12%', opts), { what: 'Budget: tiles came in over by 12%' });
  assert.deepEqual(M.readAction('Bettina: send the RACI by Fri 16 Oct', opts), { what: 'Send the RACI', who: 'Bettina Kent', whenWords: 'Fri 16 Oct', due: '2026-10-16' }, 'someone the note knows');
  assert.deepEqual(M.readAction('Sam Okafor: book the hall', opts), { what: 'Book the hall', who: 'Sam Okafor' }, 'a whole name');
  assert.deepEqual(M.readAction('Tessaly quote lapsed on 9 Oct', opts), { what: 'Tessaly quote lapsed on 9 Oct' }, 'what already happened is not a due day');
  assert.deepEqual(M.readAction('Chase the vendor by Friday, then send the pack', opts), { what: 'Chase the vendor, then send the pack', whenWords: 'Friday', due: '2026-10-16' }, '"by" asks for a day anywhere');
  assert.deepEqual(M.readAction('Call the printer on Friday', opts), { what: 'Call the printer', whenWords: 'Friday', due: '2026-10-16' }, 'a day ending the line');
  const found = M.findActions('## Actions\n\n- Northgate: Tessaly quote v2.2 lapsed on 19 Oct; reprice\n- Bettina: send the RACI\n', opts);
  assert.deepEqual(found.map((a) => [a.what, a.who ?? '', a.due ?? '']), [['Northgate: Tessaly quote v2.2 lapsed on 19 Oct; reprice', '', ''], ['Send the RACI', 'Bettina Kent', '']]);
});

test('open tick boxes anywhere, @mentions in lists, and headings written other ways', () => {
  const text = `Catch-up with the bakery\n\n- [ ] Mia: list the weekend products\n- talked about the loyalty card @Sam\n- Payment at collection to start with\n\n**Next steps:**\n1. Print the new menus by Saturday\n2) Tell the staff\n\n### Notes\nJust notes here.\n- Sam to look at it some time\n`;
  const found = M.findActions(text, { date: THU });
  assert.deepEqual(found.map((a) => [a.how, a.what, a.who ?? '']), [
    ['task', 'List the weekend products', 'Mia'],
    ['mention', 'Talked about the loyalty card', 'Sam'],
    ['actions', 'Print the new menus', ''],
    ['actions', 'Tell the staff', ''],
  ]);
  assert.ok(!found.some((a) => a.what.includes('look at it')), '"Sam to …" outside Actions, with no day and Sam not known: left for the assistant');
  const known = M.findActions(text, { date: THU, people: ['Sam Okafor'] });
  assert.ok(known.some((a) => a.what === 'Look at it some time' && a.who === 'Sam Okafor' && a.how === 'phrase'), 'with Sam known, it is an action');
});

test('the same action twice is offered once; code blocks and properties are never actions', () => {
  const text = `---\ntodo: "- [ ] not this"\n---\n## Actions\n- [ ] Send the quote — Sam\n- [ ] send the quote.\n\n\`\`\`\n- [ ] code, not a job\n\`\`\`\n`;
  const found = M.findActions(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].what, 'Send the quote');
});

test('meeting notes are known by their type, tag, folder or name', () => {
  assert.ok(M.isMeetingNote('Notes/x.md', { type: 'meeting' }));
  assert.ok(M.isMeetingNote('Notes/x.md', { tags: ['meeting'] }));
  assert.ok(M.isMeetingNote('Meetings/Supplier chat.md', {}));
  assert.ok(M.isMeetingNote('Projects/Studio Upgrade/04 Meetings/2026-10-14.md', {}));
  assert.ok(M.isMeetingNote('Notes/Kick-off meeting.md', {}));
  assert.ok(M.isMeetingNote('Notes/Weekly stand-up.md', {}));
  assert.ok(!M.isMeetingNote('Notes/Pricing ideas.md', { tags: ['ideas'] }));
  assert.ok(!M.isMeetingNote('Notes/Meetingless.md', {}));
  assert.ok(!M.isMeetingNote('Projects/Harbourline/Kickoff.md', { type: 'note' }), 'an explicit non-meeting type beats the name guess (v8-vault-assistant F7)');
  assert.ok(!M.isMeetingNote('Meetings/2026-11-03 Roster.md', { type: 'note' }), 'and the folder guess');
  assert.ok(M.isMeetingNote('Projects/Harbourline/Kickoff.md', { type: 'note', tags: ['meeting'] }), 'a meeting tag still counts: the person put it there');
  assert.equal(D.isoDay(M.meetingDate('Meetings/x.md', { date: '2026-10-15' })), '2026-10-15');
  assert.equal(D.isoDay(M.meetingDate('Meetings/2026-10-09 Site walk.md', {})), '2026-10-09');
  assert.equal(D.isoDay(M.meetingDate('Meetings/Site walk.md', {}, THU)), '2026-10-15');
});

test('the same deed reworded matches by subject; other deeds never do (v8-vault-assistant F8)', () => {
  assert.ok(M.sameSubject('Receipt v2 review', 'Send the receipt v2 for review'), 'reworded, one word added');
  assert.ok(M.sameSubject('Send the receipt v2 for review', 'Receipt v2 review'), 'either way round');
  assert.ok(M.sameSubject('Book the electrician', 'Book electrician for Friday'), 'a day word aside');
  assert.ok(!M.sameSubject('Review the roster', 'Send the roster'), 'verbs tell deeds apart');
  assert.ok(!M.sameSubject('Review receipt v2', 'Review receipt v3'), 'versions tell deeds apart');
  assert.ok(!M.sameSubject('Chase PAY-101 and PAY-102', 'PAY-101 follow-up'), 'a joint chase is not its split follow-up');
  assert.ok(!M.sameSubject('Book flights', 'Book flights and hotel'), 'a bigger deed stays its own');
  assert.ok(!M.sameSubject('Call mum', 'Call dad'), 'different subjects');
  assert.ok(!M.sameSubject('the', 'the'), 'glue alone never matches');
});

test('the project a meeting belongs to: its property, its folder, then what it links', () => {
  const projects = [
    { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out' },
    { path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade' },
    { path: 'Projects/Winter Menu Launch/Winter Menu Launch.md', name: 'Winter Menu Launch' },
  ];
  const resolve = (t) => projects.find((p) => p.name.toLowerCase() === t.toLowerCase())?.path ?? null;
  assert.deepEqual(M.projectsFor({ path: 'Meetings/Site.md', props: { project: '[[Harbour Fit-out]]' }, links: ['Projects/Studio Upgrade/Studio Upgrade.md'] }, projects, resolve).map((p) => [p.name, p.why]), [['Harbour Fit-out', 'property'], ['Studio Upgrade', 'link']]);
  assert.deepEqual(M.projectsFor({ path: 'Projects/Studio Upgrade/Meetings/Wave 2.md', props: {} }, projects, resolve).map((p) => [p.name, p.why]), [['Studio Upgrade', 'folder']]);
  assert.deepEqual(M.projectsFor({ path: 'Projects/Studio Upgrade/Activity/Task.md', props: {} }, projects, resolve), [], 'an Activity note isn’t a meeting of the project');
  assert.deepEqual(M.projectsFor({ path: 'Meetings/x.md', props: { project: 'Winter Menu Launch' } }, projects, resolve).map((p) => p.name), ['Winter Menu Launch']);
  assert.deepEqual(M.projectsFor({ path: 'Projects/Studio Upgrade/Studio Upgrade.md', props: {} }, projects, resolve), [], 'the project file itself');
  assert.deepEqual(M.projectsFor({ path: 'Meetings/x.md', props: { project: '[[Nothing like it]]' } }, projects, resolve), []);
});

test('filed marks: old notes still read them, and the tidy takes them off', () => {
  // t238: meetings file nothing any more, so nothing writes marks — but old notes carry them, and the read
  // honours them until the tidy strips them.
  const people = ['Priya Shah', 'Sam Taylor', 'Mere Walker'];
  const marked = SITE_MEETING.replace('- [ ] Approve the Harbourline Signs quote — Priya — by 24 Oct', '- [ ] Approve the Harbourline Signs quote — Priya — by 24 Oct → [[Harbour Fit-out]]').replace(
    '- Priya: chase the network vendor for the switch prices (next week)',
    '- Priya: chase the network vendor for the switch prices (next week) → [[Harbour Fit-out]]',
  );
  const found = M.findActions(SITE_MEETING, { date: THU, people });
  const again = M.findActions(marked, { date: THU, people });
  assert.equal(again.length, found.length, 'marked actions are still read');
  assert.deepEqual(
    again.filter((a) => a.filedTo).map((a) => [a.what, a.filedTo]),
    [
      ['Approve the Harbourline Signs quote', 'Harbour Fit-out'],
      ['Chase the network vendor for the switch prices', 'Harbour Fit-out'],
    ],
  );
  // The tidy takes every mark off, and the note is as it was.
  assert.equal(M.unmarkFiled(marked), SITE_MEETING);
  assert.equal(M.unmarkFiled(SITE_MEETING), SITE_MEETING, 'no marks, nothing changes');
  // Windows line ends are kept.
  const crlf = marked.replace(/\n/g, '\r\n');
  assert.equal(M.unmarkFiled(crlf), SITE_MEETING.replace(/\n/g, '\r\n'));
});

test('an action becomes a next step the project file keeps, read back the same', () => {
  const [a] = M.findActions('## Actions\n- [ ] Approve the lighting quote — Priya Shah — by Friday\n', { date: THU });
  const step = M.asNextStep(a, THU);
  assert.deepEqual(step, { what: 'Approve the lighting quote', who: 'Priya Shah', when: '16 Oct' });
  const p = P.parseProject('---\ntype: project\n---\n# Harbour Fit-out\n');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: step });
  const text = P.serializeProject(p);
  assert.ok(text.includes('- [ ] Approve the lighting quote — Priya Shah · by 16 Oct'));
  assert.deepEqual(P.parseProject(text).next, [{ done: false, what: 'Approve the lighting quote', who: 'Priya Shah', when: '16 Oct' }]);
  // A day that couldn't be read keeps its words.
  assert.deepEqual(M.asNextStep({ what: 'Call', whenWords: 'After the long weekend' }, THU), { what: 'Call', when: 'After the long weekend' });
});

test('the assistant’s finds are kept only when they quote the note and are new', () => {
  const text = 'We should probably get the oven serviced before winter.\nSam mentioned the till keeps freezing.\n## Actions\n- [ ] Send the quote — Sam\n';
  const found = M.findActions(text, { date: THU });
  const reply = { actions: [
    { what: 'Get the oven serviced', who: 'Mia', when: 'Friday', quote: 'get the oven serviced before winter' },
    { what: 'Look at the till', quote: 'the till keeps freezing' },
    { what: 'Made up', quote: 'words that are not in the note' },
    { what: 'send the quote', quote: 'Send the quote' },
    { what: '', quote: 'Sam mentioned' },
  ] };
  const extra = M.readAssistantActions(reply, text, found, { date: THU });
  assert.deepEqual(extra.map((a) => [a.what, a.who ?? '', a.due ?? '', a.line, a.how]), [
    ['Get the oven serviced', 'Mia', '2026-10-16', 0, 'assistant'],
    ['Look at the till', '', '', 1, 'assistant'],
  ]);
  assert.deepEqual(M.readAssistantActions('not json', text, found), []);
});

test('9.5 batch 9: politeness first, then the verb (F97)', () => {
  assert.equal(M.looksLikeAction('Please send the quote'), true);
  assert.equal(M.looksLikeAction('Kindly confirm the booking'), true);
  assert.deepEqual(M.readAction('Please send the quote', { date: THU }), { what: 'Send the quote' });
  const found = M.findActions('- [ ] Please send the quote\n', { date: THU });
  assert.deepEqual(found.map((a) => [a.how, a.what]), [['task', 'Send the quote']]);
});

test('9.5 batch 9: a lead with no people known needs fuller evidence (F102)', () => {
  assert.deepEqual(M.readAction('Northgate: quote lapsed', {}), { what: 'Northgate: quote lapsed' });
  assert.deepEqual(M.readAction('Mia: list the weekend products', { date: THU }), { what: 'List the weekend products', who: 'Mia' });
  assert.deepEqual(M.readAction('Sam Okafor: book the hall', {}), { what: 'Book the hall', who: 'Sam Okafor' });
  assert.deepEqual(M.readAction('Northgate: quote lapsed', { date: THU, people: [] }), { what: 'Northgate: quote lapsed' });
});

test('9.5 batch 9: bare Actions and Decisions lines open their section (F103)', () => {
  assert.deepEqual(M.findActions('Actions\n\n- send the quote\n', { date: THU }).map((a) => [a.how, a.what]), [['actions', 'Send the quote']]);
  assert.deepEqual(M.findActions('Decisions\n\n- [ ] Go with two racks\n', { date: THU }), []);
});

test('9.5 batch 9: the assistant’s quote matches whatever its case (F105)', () => {
  const text = '## Notes\nSend the quote this week.\n';
  const extra = M.readAssistantActions({ actions: [{ what: 'Send the quote', quote: 'send the quote this week' }] }, text, [], { date: THU });
  assert.equal(extra.length, 1);
  assert.equal(extra[0].line, 1);
});

test('9.5 batch 9: retro, kick-off and workshop folders are meetings (F107)', () => {
  assert.ok(M.isMeetingNote('Retros/Sprint 12.md', {}));
  assert.ok(M.isMeetingNote('Workshops/Intro to tills.md', {}));
  assert.ok(M.isMeetingNote('Kick-offs/Q1 planning.md', {}));
  assert.ok(M.isMeetingNote('Stand-ups/Daily.md', {}));
});

// A date in an owner tail is never a person (p16-owner-tail, 4 Nov 2026): "— Priya, due 24 Oct" lost its owner and
// kept the name in the words. All three shapes the assistant writes read as that person and that date.
// n4-minutes-pdf fault 1 (6 Nov 2026, the branded PDF printed "[[David Kim]]" raw): the meeting reader
// takes link marks off names and words through the shared cleaner, including paths and #heading forms.
test('n4: names and words read through the shared cleaner', () => {
  assert.deepEqual(M.notePeople('', { attendees: ['[[People/Priya Shah]]', '[[Sam Taylor|Sam]]', '[[Minutes#Mere Walker]]'] }), ['Priya Shah', 'Sam', 'Minutes']);
  assert.deepEqual(M.readAction('Read [[Pricing ideas#Q3|the pricing note]] — [[Priya Shah]]', { people: ['Priya Shah'] }), { what: 'Read the pricing note', who: 'Priya Shah' });
  assert.deepEqual(M.readAction('Check [[#Fire drill]] times — Sam', { people: ['Sam Taylor'] }), { what: 'Check Fire drill times', who: 'Sam Taylor' });
});

test('an owner tail with a date reads as that person and that date', () => {
  const opts = { date: THU, people: ['Priya Shah', 'Sam Taylor', 'Mere Walker'] };
  assert.deepEqual(M.readAction('Approve the Harbourline Signs quote — Priya — due 24 Oct', opts), { what: 'Approve the Harbourline Signs quote', who: 'Priya Shah', whenWords: '24 Oct', due: '2026-10-24' });
  assert.deepEqual(M.readAction('Approve the Harbourline Signs quote — Priya, due 24 Oct', opts), { what: 'Approve the Harbourline Signs quote', who: 'Priya Shah', whenWords: '24 Oct', due: '2026-10-24' });
  assert.deepEqual(M.readAction('Send the plan — Mere · due Tue', opts), { what: 'Send the plan', who: 'Mere Walker', whenWords: 'Tue', due: '2026-10-20' });
});
