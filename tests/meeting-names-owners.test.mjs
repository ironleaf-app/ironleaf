// node --test tests/meeting-names-owners.test.mjs — names and owners the way real people talk (6 Nov 2026, the ;
// the ff3d silent take: naming Speaker 1/2 left the transcript text, the Summary and the PDF saying "Speaker 1/2",
// owners fell to 0 of 12, and the Discussion gave work to the wrong people from voice labels alone). Naming a voice
// relabels every door a person reads without touching the stored lines; owners come from how the meeting talked
// (the asks say so, the readers only keep the meeting's own people); a merge never drops an owner a later part
// found. The made-up Brookfield meeting from the take only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meeting-names-owners-'));
let S, N, M, Sh, Mt, Tk;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    ['meeting-speakers', 'meeting-notes', 'meeting-minutes', 'share', 'meetings', 'tasks'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`).join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'x.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'x.mjs')).href);
  [S, N, M, Sh, Mt, Tk] = [all.m0, all.m1, all.m2, all.m3, all.m4, all.m5];
});
after(() => rmSync(work, { recursive: true, force: true }));

const PEOPLE = ['Alex Rivera', 'Mia Chen', 'Kate Sullivan', 'Noah Patel', 'David Kim'];
const NOTE = `---
type: meeting
title: "2026-11-06 Brookfield bakery opening: weekly"
date: 2026-11-06
people:
  - "[[Alex Rivera]]"
  - "[[Mia Chen]]"
  - "[[Kate Sullivan]]"
  - "[[Noah Patel]]"
speakers:
  "":
    spk1: Alex Rivera
    spk2: Kate Sullivan
---
## Summary

Speaker 1 and Speaker 2 settled Friday the 27th. Speaker 10 was never there.

## Actions

- [ ] Check the totals on the opening stock order — by Friday

## Transcript

> [!quote]- Transcript · 3 minutes
> **0:00** *Speaker 1:* Right. Shall we start?
>
> **0:19** *Speaker 2:* The revised drawing is locked.
`;

test('a name set on a voice relabels mentions whole-word only (Speaker 10 never catches Speaker 1)', () => {
  const out = S.relabelSpeakerMentions('Speaker 1 and Speaker 2 met. Speaker 10 left. Speaker 1’s roster.', { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' });
  assert.equal(out, 'Alex Rivera and Kate Sullivan met. Speaker 10 left. Alex Rivera’s roster.');
  assert.equal(S.relabelSpeakerMentions('Speaker 1 met.', {}), 'Speaker 1 met.');
});

test('the whole note as a person reads it carries the names, the stored lines unchanged', () => {
  const shown = S.withSpeakerNames(NOTE);
  assert.ok(shown.includes('Alex Rivera and Kate Sullivan settled Friday the 27th.'), shown);
  assert.ok(shown.includes('*Alex Rivera:* Right. Shall we start?'), shown);
  assert.ok(shown.includes('*Kate Sullivan:* The revised drawing is locked.'), shown);
  assert.ok(NOTE.includes('*Speaker 1:*'), 'the note on disk keeps its labels');
});

test('two recordings naming Speaker 1 differently never guess in prose', () => {
  let two = S.writeSpeakerNames(NOTE, 'Part 2 · 14.05', { spk1: 'Priya Nair' });
  const shown = S.withSpeakerNames(two);
  assert.ok(shown.includes('Speaker 1 and Kate Sullivan settled'), shown);
});

test('the shared copy (PDF, email, formatted copy) uses the names', () => {
  const body = Sh.shareBody(NOTE);
  assert.ok(!/\bSpeaker [12]\b/.test(body), body);
  assert.ok(body.includes('Alex Rivera and Kate Sullivan settled'), body);
  assert.ok(body.includes('*Alex Rivera:*'), body);
});

test('stale written labels are told apart from the transcript labels', () => {
  assert.deepEqual(S.staleSpeakerLabels(NOTE), ['spk1', 'spk2']);
  assert.deepEqual(S.staleSpeakerLabels(S.withSpeakerNames(NOTE).replace(/^---[\s\S]*?---\n/, '')), []);
  assert.deepEqual(S.staleSpeakerLabels('## Summary\n\nThey met.\n'), []);
});

test('the notes reader maps a named voice to its owner, keeps an unnamed voice blank, and relabels prose', () => {
  const r = N.readMeetingReply(
    { summary: 'Speaker 1 settled the date with Speaker 2.', decisions: ['Speaker 1 chose Friday.'], actions: [{ what: 'book the inspection', who: 'Speaker 1' }, { what: 'chase the stone top', who: 'Speaker 2' }], people: ['Speaker 1'], named: [] },
    { speakerNames: { spk1: 'Noah Patel' } },
  );
  assert.equal(r.summary, 'Noah Patel settled the date with Speaker 2.');
  assert.equal(r.actions[0].who, 'Noah Patel');
  assert.equal(r.actions[1].who, undefined);
  assert.deepEqual(r.people, ['Noah Patel']);
});

test('only the meeting’s own people can own an action (a name merely mentioned cannot)', () => {
  const r = N.readMeetingReply(
    { summary: 'They met.', decisions: [], actions: [{ what: 'check the totals', who: 'Mia' }, { what: 'send the beans', who: 'David Kim' }], people: ['Alex Rivera', 'Mia Chen'], named: ['David Kim'] },
    { attendees: ['Alex Rivera', 'Mia Chen', 'Kate Sullivan', 'Noah Patel'] },
  );
  assert.equal(r.actions[0].who, 'Mia Chen');
  assert.equal(r.actions[1].who, undefined);
});

test('the minutes reader does the same through topics', () => {
  const r = M.readMinutesReply(
    { present: ['Mia Chen'], absent: [], named: ['David Kim'], summary: 'Speaker 2 spoke.', figures: [], decisions: [], actions: [{ what: 'check the totals', who: 'Speaker 2' }, { what: 'send the beans', who: 'David Kim' }], open: [], topics: [{ heading: 'Stock', words: ['Speaker 2 will check them.'] }] },
    { attendees: PEOPLE.slice(0, 4), speakerNames: { spk2: 'Mia Chen' } },
  );
  assert.equal(r.actions[0].who, 'Mia Chen');
  assert.equal(r.actions[1].who, undefined);
  assert.equal(r.topics[0].words[0], 'Mia Chen will check them.');
  assert.equal(r.summary, 'Mia Chen spoke.');
});

test('a merge keeps an owner a later part found, and never overwrites one already there', () => {
  const a = { summary: 'One.', decisions: [], actions: [{ what: 'Check the totals' }], people: [], named: [] };
  const b = { summary: 'Two.', decisions: [], actions: [{ what: 'Check the totals', who: 'Mia Chen', when: 'Friday' }], people: [], named: [] };
  const c = { summary: 'Three.', decisions: [], actions: [{ what: 'Check the totals', who: 'Kate Sullivan' }], people: [], named: [] };
  const merged = N.mergeMeetingNotes([a, b, c]);
  assert.equal(merged.actions.length, 1);
  assert.equal(merged.actions[0].who, 'Mia Chen');
  assert.equal(merged.actions[0].when, 'Friday');

  const m1 = { present: [], absent: [], named: [], summary: 'One.', figures: [], decisions: [], actions: [{ what: 'Check the totals' }], questions: [], topics: [] };
  const m2 = { present: [], absent: [], named: [], summary: 'Two.', figures: [], decisions: [], actions: [{ what: 'Check the totals', who: 'Mia Chen' }], questions: [], topics: [] };
  assert.equal(M.mergeMeetingMinutes([m1, m2]).actions[0].who, 'Mia Chen');
});

test('the asks teach owners from how people talk, and never trust a voice label alone', () => {
  for (const sys of [N.MEETING_NOTES_SYSTEM, M.MINUTES_SYSTEM]) {
    assert.match(sys, /addressed by name/i, sys.slice(0, 200));
    assert.match(sys, /only (one of )?the meeting(’s|')s (own )?people/i);
    assert.match(sys, /voice label alone|not proof/i);
    assert.match(sys, /without (a|naming a) name|neutral/i);
  }
  const add = S.speakersPromptAddition([{ id: 'spk1', side: 'mix', clipAt: 0, clipLen: 6 }], {});
  assert.ok(!/keeps "who" empty/.test(add), add);
  assert.match(add, /addressed by name/i);
  // The first real run (6 Nov 2026, ff3d through the app): with names flatly on the voices the model gave
  // six of twelve owners to the two mixed clusters' names, so the ask never lets a label outrank the words.
  // Changed 6 Nov 2026 (e1-speaker-turns): pieces are cut at the voice changes, so the old warning that one
  // segment holds everyone's turns (and a name is only who was heard most in it) is no longer true of the
  // lines the write-up reads; the caution that stands is quick lines under the wrong voice, and blank first.
  assert.match(add, /quick lines a short line can still sit under the wrong voice/i);
  assert.match(add, /blank beats wrong/i);
  const named = S.speakersPromptAddition([{ id: 'spk1', side: 'mix', clipAt: 0, clipLen: 6 }], { spk1: 'Alex Rivera' });
  assert.match(named, /Speaker 1 is Alex Rivera\./);
});

test('the notes ask carries the meeting’s own people', () => {
  const q = N.meetingNotesPrompt({ title: 'Brookfield', date: '2026-11-06', people: PEOPLE, attendees: PEOPLE.slice(0, 4), transcript: '[0:00] Speaker 1: hi.' });
  assert.match(q, /People at the meeting: Alex Rivera, Mia Chen, Kate Sullivan, Noah Patel/);
});

// ── The one who said "I'll do it" owns it (7 Nov 2026, j1: the g1 real run had voices told apart 23/31 yet
// owners 4 right, 8 blank, 0 wrong of 12, and naming the voices changed nothing: the write-up runs at Stop,
// before any voice is named, the ask sent every self-taken job away ownerless, and the reader threw the voice
// label away). The real script's lines (ff7a-meeting-script, the take's 31 turns, Alex = the first voice heard)
// through the real reader: an action keeps which voice took it, naming that voice fills the blank owner in the
// note (and so in tasks and minutes, which read the note), a name set first is used at once, and a person's
// own owner edit is never overwritten. Blank still beats wrong: an invented voice and a job nobody took stay
// blank.
const SCRIPT = [
  ['Alex', "Right, door's shut. Opening date first, then joinery, ovens and stock, and the milk last."],
  ['Kate', "Good. Mind the wall, the paint's still wet."],
  ['Alex', "Noted. How's the counter joinery looking?"],
  ['Kate', 'The revised drawing is locked. The joiners can install on Thursday the nineteenth of November, as long as the stone top lands that morning.'],
  ['Alex', 'Kate, can you confirm the install day with the joiners by Wednesday the eleventh?'],
  ['Kate', "Yep, I'll ring them. And I'll chase the stone top for the Thursday morning as well."],
  ['Alex', 'And council?'],
  ['Kate', 'They can do the final inspection in the week of the sixteenth. Can you book it for Tuesday the seventeenth at ten?'],
  ['Alex', "Yep. I'll book it, and I'll confirm the booking by Monday the ninth. Then we could open the following week: Friday the twenty-seventh of November, soft open for locals Thursday afternoon the twenty-sixth. Right with that?"],
  ['Kate', 'The twenty-seventh works for me.'],
  ['Alex', "That's the date then. Ovens: two new ovens for the Brookfield kitchen arrive Monday the twenty-third."],
  ['Kate', "Can you sign off the oven quote by Tuesday the tenth, so the order isn't held up?"],
  ['Alex', "Yep, I'll sign it Tuesday. Four thousand eight hundred dollars, all up."],
  ['Kate', 'Right.'],
  ['Alex', 'Stock. Did the totals on the opening stock order come through?'],
  ['Kate', 'They did. Six thousand two hundred and forty dollars, all up.'],
  ['Alex', 'Kate, can you check those totals by Friday, and send the full order by Friday the thirteenth?'],
  ['Kate', "Yep, I'll check them by Friday and send the order on the thirteenth. Green beans from David Kim arrive on the twentieth, by the way."],
  ['Alex', 'Good. And the menu boards?'],
  ['Kate', "They still need printing before opening week. We haven't agreed who owns that. Leave it open?"],
  ['Alex', 'Leave it open. Last one, the milk. We agreed last week to move from Fresh Dairy Co to Merricks Creek Dairy for the bakery and the stall. What did they say?'],
  ['Kate', 'They can start Monday the twenty-third, same day as the ovens, with a six a.m. drop at Brookfield.'],
  ['Alex', 'Can you ring Merricks Creek today and confirm the first delivery in writing?'],
  ['Kate', "Yep, I'll ring them today."],
  ['Alex', 'Right. Can you also have the roster for opening week done by Friday the twentieth?'],
  ['Kate', "Yep, I'll have it done by the twentieth. Can you run oven training on Wednesday the twenty-fifth?"],
  ['Alex', "Yep, two sessions on the Wednesday. And I'll check the first day totals on opening morning, and send the soft open invites by Monday the twenty-third."],
  ['Kate', 'Good. So soft open Thursday the twenty-sixth, doors open Friday.'],
  ['Alex', "That's it. Anything else?"],
  ['Kate', "No, that's me. Thanks, Alex."],
  ['Alex', 'Thanks. Same time next week.'],
];
/** The take's transcript as the write-up reads it at Stop: one person per line, nobody named yet. */
const TAKE = SCRIPT.map(([s, t], i) => ({ at: i * 6, who: s === 'Alex' ? 'Speaker 1' : 'Speaker 2', text: t }));
/** A correct answer to the ask: asked-by-name jobs name their person; self-taken jobs carry the voice that
 *  took them; the menu boards nobody took, and one action claims a voice that was never there. */
const TAKE_ACTIONS = [
  { what: 'Confirm the install day with the joiners', who: 'Kate Sullivan', when: 'Wednesday the eleventh' },
  { what: 'Chase the stone top for Thursday morning', who: 'Speaker 2', when: 'Thursday morning' },
  { what: 'Book the council final inspection', who: 'Speaker 1', when: 'Tuesday the seventeenth' },
  { what: 'Confirm the council booking', who: 'Speaker 1', when: 'Monday the ninth' },
  { what: 'Sign off the oven quote', who: 'Speaker 1', when: 'Tuesday the tenth' },
  { what: 'Check the opening stock order totals', who: 'Kate Sullivan', when: 'Friday' },
  { what: 'Send the full opening stock order', who: 'Kate Sullivan', when: 'Friday the thirteenth' },
  { what: 'Ring Merricks Creek today', who: 'Speaker 2', when: 'today' },
  { what: 'Have the roster for opening week done', who: 'Speaker 2', when: 'Friday the twentieth' },
  { what: 'Run oven training', who: 'Speaker 1', when: 'Wednesday the twenty-fifth' },
  { what: 'Check the first day totals', who: 'Speaker 1', when: 'opening morning' },
  { what: 'Send the soft open invites', who: 'Speaker 1', when: 'Monday the twenty-third' },
  { what: 'Print the menu boards', who: '', when: '' },
  { what: 'Water the window plants', who: 'Speaker 9', when: '' },
];
/** The truth (TRUTH.md): who owns each of the 12 scripted jobs. */
const TRUTH_OWNERS = {
  'Confirm the install day with the joiners': 'Kate Sullivan',
  'Chase the stone top for Thursday morning': 'Kate Sullivan',
  'Book the council final inspection': 'Alex Rivera',
  'Confirm the council booking': 'Alex Rivera',
  'Sign off the oven quote': 'Alex Rivera',
  'Check the opening stock order totals': 'Kate Sullivan',
  'Send the full opening stock order': 'Kate Sullivan',
  'Ring Merricks Creek today': 'Kate Sullivan',
  'Have the roster for opening week done': 'Kate Sullivan',
  'Run oven training': 'Alex Rivera',
  'Check the first day totals': 'Alex Rivera',
  'Send the soft open invites': 'Alex Rivera',
};
const NAMES = { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' };
const atStop = () =>
  N.readMeetingReply(
    { summary: 'The Brookfield opening date was settled for Friday the twenty-seventh of November.', decisions: [{ text: 'Open on Friday the 27th of November', at: '0:48' }], actions: TAKE_ACTIONS, people: [], named: ['David Kim'] },
    { transcript: TAKE, date: '2026-11-06', attendees: ['Alex Rivera', 'Kate Sullivan'], speakerNames: {} },
  );
const ownersOf = (text) => Object.fromEntries(Mt.findActions(text, { people: PEOPLE }).map((a) => [a.what, a.who]));

test('at Stop, before any naming, a self-taken job keeps which voice took it and no owner; asked-by-name keeps its person', () => {
  const r = atStop();
  const byWhat = Object.fromEntries(r.actions.map((a) => [a.what, a]));
  assert.equal(byWhat['Book the council final inspection'].who, undefined);
  assert.equal(byWhat['Book the council final inspection'].voice, 'spk1');
  assert.equal(byWhat['Chase the stone top for Thursday morning'].voice, 'spk2');
  assert.equal(byWhat['Ring Merricks Creek today'].voice, 'spk2');
  assert.equal(byWhat['Confirm the install day with the joiners'].who, 'Kate Sullivan', 'asked by name by the other voice, agreed next: hers');
  assert.equal(byWhat['Print the menu boards'].voice, undefined, 'nobody took it: no voice, no owner');
  assert.equal(byWhat['Water the window plants'].voice, undefined, 'a voice that was never there is invented: dropped');
  assert.equal(byWhat['Water the window plants'].who, undefined);
});

test('the note written at Stop shows blank owners (never a voice label as a person), and naming the voices fills all 12', () => {
  const note = N.applyMeetingNotes('# 2026-11-06 Brookfield bakery opening: weekly\n', atStop(), { transcript: TAKE, length: '3 minutes', people: PEOPLE, date: '2026-11-06' }).text;
  assert.ok(!/^- \[[ x]\] .*— (?:\[\[)?Speaker \d/m.test(note), note);
  const before = ownersOf(note);
  assert.equal(Object.keys(TRUTH_OWNERS).filter((w) => before[w] === TRUTH_OWNERS[w]).length, 3, 'only the asked-by-name jobs own before naming (the g1 shape)');
  // The Tasks list reads the same lines: its titles never carry the voice mark.
  for (const t of Tk.findAllTasks(note)) assert.ok(!/<!--|nv:voice/.test(t.words), t.words);
  const named = N.fillVoiceOwners(S.writeSpeakerNames(note, '', NAMES));
  const after = ownersOf(named);
  const right = Object.keys(TRUTH_OWNERS).filter((w) => after[w] === TRUTH_OWNERS[w]);
  assert.equal(right.length, 12, JSON.stringify(after));
  assert.equal(after['Print the menu boards'], undefined, 'left open in the meeting: still blank');
  assert.equal(after['Water the window plants'], undefined, 'the invented voice never becomes an owner');
  assert.ok(!/Speaker \d/.test(Sh.shareBody(named).split('## Transcript')[0]), 'the shared copy carries names, no voice labels above the transcript');
});

test('a name set before the write-up is used at once', () => {
  const r = N.readMeetingReply(
    { summary: 'They settled the date.', decisions: [], actions: TAKE_ACTIONS, people: [], named: [] },
    { transcript: TAKE, date: '2026-11-06', attendees: ['Alex Rivera', 'Kate Sullivan'], speakerNames: NAMES },
  );
  const got = Object.fromEntries(r.actions.map((a) => [a.what, a.who]));
  for (const [what, who] of Object.entries(TRUTH_OWNERS)) assert.equal(got[what], who, what);
});

test('a person’s own edit to an owner is never overwritten by a naming', () => {
  const note = N.applyMeetingNotes('# Brookfield\n', atStop(), { transcript: TAKE, length: '3 minutes', people: PEOPLE, date: '2026-11-06' }).text;
  const edited = note.replace(/^(- \[[ x]\] Ring Merricks Creek today)(.*)$/m, '$1 — Mia Chen$2');
  assert.ok(edited !== note, note);
  const named = N.fillVoiceOwners(S.writeSpeakerNames(edited, '', NAMES));
  assert.equal(ownersOf(named)['Ring Merricks Creek today'], 'Mia Chen');
  assert.equal(ownersOf(named)['Book the council final inspection'], 'Alex Rivera', 'the untouched ones still fill');
});

test('the minutes keep the voice the same way, and minutes made after naming read the filled owners as existing', () => {
  const r = M.readMinutesReply(
    { present: [], absent: [], named: ['David Kim'], summary: 'They settled the date.', figures: [], decisions: [], actions: TAKE_ACTIONS, open: ['Menu boards still need printing'], topics: [] },
    { transcript: TAKE, date: '2026-11-06', attendees: ['Alex Rivera', 'Kate Sullivan'], speakerNames: {} },
  );
  const byWhat = Object.fromEntries(r.actions.map((a) => [a.what, a]));
  assert.equal(byWhat['Run oven training'].voice, 'spk1');
  const line = M.minutesActionLine(byWhat['Run oven training'], PEOPLE);
  assert.match(line, /not assigned/, line);
  assert.ok(!/— Speaker \d(?!>)/.test(line.replace(/<!--[^>]*-->/g, '')), line);
  const note = N.applyMeetingNotes('# Brookfield\n', atStop(), { transcript: TAKE, length: '3 minutes', people: PEOPLE, date: '2026-11-06' }).text;
  const named = N.fillVoiceOwners(S.writeSpeakerNames(note, '', NAMES));
  const existing = Object.fromEntries((M.readMinutesExisting(named).actions ?? []).map((a) => [a.what, a.who]));
  assert.equal(existing['Book the council final inspection'], 'Alex Rivera');
  assert.equal(existing['Send the soft open invites'], 'Alex Rivera');
});

test('a merge fills a voice in like an owner, and the asks say a voice label may stand for who took a job', () => {
  const a = { summary: 'One.', decisions: [], actions: [{ what: 'Book the inspection' }], people: [], named: [] };
  const b = { summary: 'Two.', decisions: [], actions: [{ what: 'Book the inspection', voice: 'spk1' }], people: [], named: [] };
  assert.equal(N.mergeMeetingNotes([a, b]).actions[0].voice, 'spk1');
  for (const sys of [N.MEETING_NOTES_SYSTEM, M.MINUTES_SYSTEM]) assert.match(sys, /voice (that took|label)/i);
  const add = S.speakersPromptAddition([{ id: 'spk1', side: 'mix', clipAt: 0, clipLen: 6 }], {});
  assert.match(add, /"who" (is|as) (that voice's label|the voice)/i, add);
  assert.match(add, /never prints as a person/i, add);
});
