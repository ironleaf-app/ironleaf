// node --test tests/meeting-minutes.test.mjs — the meeting minutes, ready to send (src/shared/meeting-minutes.ts; 5
// Nov 2026). On an invented cart-fix meeting: the assistant's answer checked (figures capped at four, "not assigned"
// never a guess), actions with owners and due days, the minutes written into the note (who was there and who was not,
// summary, figures where the branded document prints them, decisions, actions, what is still open, discussion by
// topic), the person's own words kept where they are and winning, and making them again never doubling anything.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meeting-minutes-'));
let M, Mt, F, R, Sp;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    ['meeting-minutes', 'meetings', 'frontmatter', 'recorder', 'meeting-speakers'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`).join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  [M, Mt, F, R, Sp] = [all.m0, all.m1, all.m2, all.m3, all.m4];
});
after(() => rmSync(work, { recursive: true, force: true }));

// Break-it finding 12 (6 Nov 2026): the source held raw control bytes in a regular expression, so git read
// the file as binary and its diffs could not be reviewed. Escape text now; the cleaning reads the same.
test('the minutes source reads as text to git, and control chars clean as before', () => {
  const bytes = readFileSync(path.join(root, 'src/shared/meeting-minutes.ts'));
  for (const b of bytes) assert.ok((b === 9 || b === 10 || b === 13 || b >= 32) && b !== 127, `no raw control byte in the source (saw ${b})`);
  const m = M.readMinutesReply({ summary: 'Cart\u0000 retry\u0007 agreed\u001f today.', decisions: [], actions: [] });
  assert.equal(m.summary, 'Cart retry agreed today.');
});

const PEOPLE = ['Priya Nair', 'Alex Chen'];
const REPLY = {
  present: ['Priya Nair', 'Alex'],
  absent: ['Sam Okafor'],
  named: ['Tessaly'],
  summary: 'Priya and Alex went over the cart retry. The receipt printer still needs a quote.',
  figures: [
    { value: '20 Mar', label: 'Retry ships' },
    { value: '2 Apr', label: 'Receipts review' },
    { value: '$4,200', label: 'Printer quote' },
    { value: '40', label: 'Orders a day' },
    { value: 'extra', label: 'Past the cap' },
  ],
  decisions: [{ text: 'Ship the retry before the receipts review', at: '1:00' }, 'Keep Tessaly as the printer supplier'],
  actions: [
    { what: 'chase the failed payments', who: 'Priya', due: '2026-11-06', time: '' },
    { what: 'Ask Tessaly for a printer quote', who: '', due: '', time: '' },
  ],
  questions: [{ what: 'Whether the receipt printer arrives before opening.' }],
  topics: [{ heading: 'Cart retry', words: ['The retry fails on Fridays.', 'Priya will chase the failed payments.'] }],
};

test('the answer checked: figures capped at four, nobody guessed, caps counted', () => {
  const m = M.readMinutesReply(REPLY);
  assert.deepEqual(m.present, ['Priya Nair', 'Alex']);
  assert.deepEqual(m.absent, ['Sam Okafor']);
  assert.deepEqual(m.named, ['Tessaly']);
  assert.equal(m.figures.length, 4, 'up to four for the band');
  assert.deepEqual(m.decisions, ['Ship the retry before the receipts review', 'Keep Tessaly as the printer supplier']);
  assert.deepEqual(m.decisionTimes, [60, null]);
  assert.deepEqual(m.actions, [{ what: 'Chase the failed payments', who: 'Priya', due: '2026-11-06' }, { what: 'Ask Tessaly for a printer quote' }]);
  assert.deepEqual(m.questions, [{ what: 'Whether the receipt printer arrives before opening.' }]);
  assert.equal(m.topics.length, 1);
  assert.deepEqual(m.truncated, { figures: 1 });
  assert.equal(M.readMinutesReply(null), null);
  assert.equal(M.readMinutesReply({}), null);
  assert.equal(M.readMinutesReply({ summary: '', decisions: [], actions: [], questions: [], topics: [], figures: [], present: [], absent: [], named: [] }), null);
  // An old answer's `open` list reads as unanswered questions.
  assert.deepEqual(M.readMinutesReply({ ...REPLY, questions: undefined, open: ['Whether the printer arrives.'] }).questions, [{ what: 'Whether the printer arrives.' }]);
});

test('actions say who and by when; nobody named stays "not assigned"', () => {
  const m = M.readMinutesReply(REPLY);
  assert.equal(M.minutesActionLine(m.actions[0], PEOPLE), '- [ ] Chase the failed payments — [[Priya Nair|Priya]] · by 6 Nov 2026');
  assert.equal(M.minutesActionLine(m.actions[1], PEOPLE), '- [ ] Ask Tessaly for a printer quote — not assigned');
  assert.equal(M.minutesActionLine({ what: 'Ring the mill', due: '2026-11-06' }, PEOPLE), '- [ ] Ring the mill — not assigned · by 6 Nov 2026');
  // The meetings reader takes it as no owner (src/shared/meetings.ts).
  const read = Mt.readAction(M.minutesActionLine(m.actions[1], PEOPLE).replace(/^- \[ \] /, ''));
  assert.equal(read.who, undefined);
  assert.equal(read.what, 'Ask Tessaly for a printer quote');
});

test('the minutes in the note: people, summary, decisions, actions, questions, figures, folded discussion', () => {
  const note = '# Cart fix\n\n## Notes\n\nThe till queue was long.\n\n## Actions\n\n- [ ] \n';
  const m = M.readMinutesReply(REPLY);
  const out = M.applyMeetingMinutes(note, m, { people: PEOPLE, date: '2026-11-05' });
  const t = out.text;
  assert.match(t, /## Summary\n\n\[\[Priya Nair\|Priya\]\] and \[\[Alex Chen\|Alex\]\] went over the cart retry/, 'people linked as known');
  // A colon, never an em dash, in words a person reads (6 Nov 2026, e2); dash lines in old notes still read.
  assert.match(t, /## Key figures\n\n- 20 Mar: Retry ships\n- 2 Apr: Receipts review\n- \$4,200: Printer quote\n- 40: Orders a day\n/, 'four figures where the document prints them');
  assert.ok(!t.includes('Past the cap'), 'the fifth never written');
  assert.match(t, /## Decisions\n\n- Ship the retry before the receipts review\n- Keep Tessaly as the printer supplier\n/);
  assert.match(t, /## Actions\n\n- \[ \] Chase the failed payments — \[\[Priya Nair\]\] · by 6 Nov 2026\n- \[ \] Ask Tessaly for a printer quote — not assigned\n/, 'owners spelt as known, nobody as not assigned');
  assert.ok(!/^- \[ \] *$/m.test(t), 'no empty box left');
  assert.match(t, /## Questions\n\n- \? Whether the receipt printer arrives before opening\.\n/, 'the Questions kind’s own line');
  assert.match(t, /## Discussion\n\n> \[!quote\]- Cart retry\n> The retry fails on Fridays\.\n>\n> Priya will chase the failed payments\.\n/, 'folded, linked once in the Summary, plain after');
  assert.ok(t.includes('The till queue was long.'), 'the person’s own notes kept');
  // The calm order: Summary, Decisions, Actions, Questions, Key figures, then the folded Discussion.
  const order = ['## Summary', '## Decisions', '## Actions', '## Questions', '## Key figures', '## Discussion'].map((h) => t.indexOf(h));
  assert.ok(order.every((at, i) => i === 0 || at > order[i - 1]), 'sections in order');
  const props = F.readProps(t);
  assert.deepEqual(props.people, ['[[Priya Nair]]', '[[Alex Chen]]']);
  assert.deepEqual(props.absent, ['Sam Okafor']);
  // t240 (the review, 12 Nov: 16 names was clutter): also holds known mentioned people only —
  // Tessaly is an unknown vendor, so nothing is written (the known-only rule is pinned by t240-meeting-calm).
  assert.deepEqual(props.also ?? [], []);
  assert.equal(props.date, '2026-11-05');
  assert.equal(props.type, 'meeting');
  assert.equal(out.added, 2);
});

test('making them again never doubles; the person’s own wins', () => {
  const m = M.readMinutesReply(REPLY);
  const first = M.applyMeetingMinutes('# Cart fix\n', m, { people: PEOPLE }).text;
  const again = M.applyMeetingMinutes(first, m, { people: PEOPLE });
  assert.equal(again.added, 0);
  assert.equal(again.text, first, 'identical minutes re-run are a no-op');
  const edited = `${first.replace('## Decisions\n', '## Decisions\n\nWe will meet again on Monday.\n').replace('- [ ] Ask Tessaly', '- [x] Ask Tessaly')}\n## Open\n\n- The mill’s delivery day.\n`;
  const kept = M.applyMeetingMinutes(edited, m, { people: PEOPLE });
  assert.equal(kept.added, 0);
  assert.match(kept.text, /We will meet again on Monday\./);
  assert.match(kept.text, /- \[x\] Ask Tessaly/);
  assert.match(kept.text, /The mill’s delivery day\./);
  assert.equal((kept.text.match(/Ship the retry before the receipts review/g) ?? []).length, 1);
});

test('figures fill the properties when they already hold some; discussion merges by topic', () => {
  const withProps = '---\nfigures:\n  - { value: 20 Mar, label: Retry ships }\n---\n# Cart fix\n';
  const m = M.readMinutesReply(REPLY);
  const out = M.applyMeetingMinutes(withProps, m, { people: PEOPLE }).text;
  assert.ok(!/^## Key figures$/m.test(out), 'no section beside the properties’ figures');
  assert.equal(F.readProps(out).figures.length, 4, 'filled to four, never past');
  const discussed = '# Cart fix\n\n## Discussion\n\n### Cart retry\n\nThe retry fails on Fridays.\n';
  const merged = M.applyMeetingMinutes(discussed, m, { people: PEOPLE }).text;
  assert.equal((merged.match(/\[!quote\]- Cart retry/g) ?? []).length, 1, 'one folded topic');
  assert.ok(!merged.includes('### Cart retry'), 'the old heading folded with it');
  assert.match(merged, /Priya.*will chase the failed payments/, 'the missing words added under it');
  assert.equal((merged.match(/The retry fails on Fridays\./g) ?? []).length, 1, 'nothing twice');
});

test('the question asked: the meeting, the people, the transcript; never inventing', () => {
  const q = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, transcript: '[0:00] Hello.' });
  assert.match(q, /^Meeting: Cart fix\nDate: 2026-11-05\nPeople the person keeps notes on: Priya Nair, Alex Chen/);
  assert.match(M.MINUTES_SYSTEM, /Only what the transcript says: never add/);
  assert.match(M.MINUTES_SYSTEM, /empty whenever the owner isn't clear/, 'nobody guessed (m4 fault 2: blank when unclear)');
  assert.match(M.MINUTES_SYSTEM, /without a name/, 'an unclear speaker unnamed');
  assert.match(M.MINUTES_SYSTEM, /up to 4 key dates and figures actually said/);
  assert.equal(M.minutesWords(M.readMinutesReply(REPLY), 2), 'Minutes made: a summary, 2 decisions, 2 actions, 1 question and 1 topic. 1 more figure did not fit.');
  assert.equal(M.minutesWords(null, 0), 'The minutes could not be made.');
});

// p7-minutes-for-others (5 Nov 2026): the minutes were run on Muse Spark 1.3 and they could not go out:
// present ["You"], the attendees filed as merely named, "You said…" through the discussion, figures as spoken,
// the same point twice. Minutes are for other people to read, so they never say "You".

/** The run as it came back: "You" in every list, through the prose, and "It was said" filler. */
const YOU_REPLY = {
  present: ['You', 'Priya Nair'],
  absent: ['Sam Okafor', 'You'],
  named: ['You', 'Tessaly'],
  summary: 'You opened on the cart with Priya.',
  figures: [{ value: '2 Apr', label: 'Receipts review' }],
  decisions: [{ text: 'You will chase the failed payments', at: '9:05' }],
  actions: [{ what: 'Ask Tessaly for a loan unit', who: 'You', due: '', time: '' }],
  questions: [{ what: 'Whether you can get a loan unit.' }],
  topics: [{ heading: 'Cart retry', words: ['You said the retry fails on Fridays.', 'It was said the queue was long.'] }],
};

test('p7: a "You" reaching the reader is the recorder’s name, or written around', () => {
  // The recorder named: every "You" in a label or an owner field is them, and the meeting's own list is in present.
  // Said words keep their pronouns (t301 round 2: a "you" asked of someone else is not the recorder).
  const named = M.readMinutesReply(YOU_REPLY, { me: 'Jo Tran', attendees: ['Priya Nair', 'Alex Chen'] });
  assert.deepEqual(named.present, ['Jo Tran', 'Priya Nair', 'Alex Chen']);
  assert.deepEqual(named.absent, ['Sam Okafor']);
  assert.deepEqual(named.named, ['Tessaly']);
  assert.equal(named.summary, 'You opened on the cart with Priya.');
  assert.deepEqual(named.decisions, ['You will chase the failed payments']);
  assert.deepEqual(named.decisionTimes, [545]);
  assert.deepEqual(named.actions, [{ what: 'Ask Tessaly for a loan unit', who: 'Jo Tran' }]);
  assert.deepEqual(named.questions, [{ what: 'Whether you can get a loan unit.' }]);
  assert.deepEqual(named.topics[0].words, ['You said the retry fails on Fridays.', 'It was said the queue was long.']);
  // No name known: labels and owners written around, still proper grammar; said words untouched.
  const bare = M.readMinutesReply(YOU_REPLY);
  assert.deepEqual(bare.present, ['Priya Nair']);
  assert.deepEqual(bare.absent, ['Sam Okafor']);
  assert.deepEqual(bare.named, ['Tessaly']);
  assert.equal(bare.summary, 'You opened on the cart with Priya.');
  assert.deepEqual(bare.decisions, ['You will chase the failed payments']);
  assert.deepEqual(bare.actions, [{ what: 'Ask Tessaly for a loan unit' }]);
  assert.deepEqual(bare.questions, [{ what: 'Whether you can get a loan unit.' }]);
  assert.deepEqual(bare.topics[0].words, ['You said the retry fails on Fridays.', 'It was said the queue was long.']);
  // A "me" that is itself "You" is no name at all.
  assert.deepEqual(M.readMinutesReply(YOU_REPLY, { me: 'You' }).present, ['Priya Nair']);
});

test('p7: the meeting’s own list are attendees unless the transcript says they could not come', () => {
  const reply = { present: ['Priya Nair'], absent: ['Lee Park'], named: [], summary: 'Short.', figures: [], decisions: [], actions: [], open: [], topics: [] };
  // Lee was on the list but could not come: absent wins.
  const m = M.readMinutesReply(reply, { attendees: ['Priya Nair', 'Alex Chen', 'Lee Park'] });
  assert.deepEqual(m.present, ['Priya Nair', 'Alex Chen']);
  assert.deepEqual(m.absent, ['Lee Park']);
  // An attendee the model filed as merely named moves to present (named is for people mentioned who were
  // not there); only the transcript saying they could not come keeps them out.
  const n = M.readMinutesReply({ ...reply, named: ['Alex Chen', 'Tessaly'] }, { attendees: ['Priya Nair', 'Alex Chen'] });
  assert.deepEqual(n.present, ['Priya Nair', 'Alex Chen']);
  assert.deepEqual(n.named, ['Tessaly']);
});

test('p7: the writer converts a "You" too, and never prints one', () => {
  // Raw minutes, as an answer with "You" still in it: the writer converts labels and owners, not just the reader.
  // Said words keep their pronouns (t301 round 2: a "you" asked of someone else is not the recorder).
  const raw = { present: ['You', 'Priya Nair'], absent: ['Sam Okafor'], named: ['Tessaly'], summary: 'You opened on the cart with Priya.', figures: [], decisions: ['You will chase the failed payments'], actions: [{ what: 'Ask Tessaly for a loan unit', who: 'You' }], questions: [], topics: [{ heading: 'Cart retry', words: ['You said the retry fails on Fridays.', 'It was said the queue was long.'] }] };
  const out = M.applyMeetingMinutes('# Cart fix\n', raw, { people: PEOPLE }).text;
  assert.match(out, /## Summary\n\nYou opened on the cart/);
  assert.match(out, /- \[ \] Ask Tessaly for a loan unit — not assigned/);
  assert.match(out, /You said the retry fails on Fridays\./);
  assert.deepEqual(F.readProps(out).people, ['[[Priya Nair]]']);
  // Named: the name in every label and owner field, the meeting's own list beside them.
  const out2 = M.applyMeetingMinutes('# Cart fix\n', raw, { people: PEOPLE, me: 'Jo Tran', attendees: ['Priya Nair', 'Alex Chen'] }).text;
  // t301: the owner links like every owner.
  assert.match(out2, /## Summary\n\nYou opened on the cart/);
  assert.match(out2, /- \[ \] Ask Tessaly for a loan unit — \[\[Jo Tran\]\]/);
  assert.deepEqual(F.readProps(out2).people, ['[[Jo Tran]]', '[[Priya Nair]]', '[[Alex Chen]]']);
});

test('the writer takes a partial answer without crashing (a list missing reads as none)', () => {
  const out = M.applyMeetingMinutes('# Cart fix\n', { summary: 'They met.', decisions: ['Ship it'] }, { people: PEOPLE }).text;
  assert.match(out, /## Summary\n\nThey met\./);
  assert.match(out, /- Ship it/);
  assert.ok(!/^## Actions$/m.test(out) && !/^## Questions$/m.test(out), 'nothing said, no sections');
});

test('an "Update <document>" names its document as a link when the vault knows it once', () => {
  const DOCS = ['lighting plan', 'Till rollout'];
  assert.equal(M.minutesActionLine({ what: 'Update the lighting plan: the second lane changes the speaker layout', who: 'Mia' }, PEOPLE, undefined, DOCS), '- [ ] Update [[lighting plan|the lighting plan]]: the second lane changes the speaker layout — Mia');
  assert.equal(M.minutesActionLine({ what: 'Update lighting plan: the second lane changes the speaker layout', who: 'Mia' }, PEOPLE, undefined, DOCS), '- [ ] Update [[lighting plan]]: the second lane changes the speaker layout — Mia');
  assert.equal(M.minutesActionLine({ what: 'Update the lighting plan: the second lane changes the speaker layout', who: 'Mia' }, PEOPLE), '- [ ] Update the lighting plan: the second lane changes the speaker layout — Mia', 'no docs known, plain words');
  assert.equal(M.minutesActionLine({ what: 'Update the lighting plan: the second lane changes the speaker layout', who: 'Mia' }, PEOPLE, undefined, ['lighting plan', 'lighting plan']), '- [ ] Update the lighting plan: the second lane changes the speaker layout — Mia', 'two notes sharing it link nowhere');
  assert.equal(M.minutesActionLine({ what: 'Ring the mill about the quote', who: 'Mia' }, PEOPLE, undefined, DOCS), '- [ ] Ring the mill about the quote — Mia', 'anything else unchanged');
});

test('p7: an action owned by "You" gets the person’s name, else not assigned', () => {
  assert.equal(M.minutesActionLine({ what: 'Ask Tessaly for a loan unit', who: 'You' }, PEOPLE), '- [ ] Ask Tessaly for a loan unit — not assigned');
  assert.equal(M.minutesActionLine({ what: 'Ask Tessaly for a loan unit', who: 'You' }, PEOPLE, 'Jo Tran'), '- [ ] Ask Tessaly for a loan unit — Jo Tran');
  assert.equal(M.minutesActionLine({ what: 'Ask Tessaly for a loan unit', who: 'Others' }, PEOPLE, 'Jo Tran'), '- [ ] Ask Tessaly for a loan unit — not assigned');
});

test('p7: the question names the meeting’s people and the recorder, and tells the voice', () => {
  const q = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, attendees: ['Priya Nair', 'Alex Chen'], me: 'Jo Tran', transcript: '[0:00] Hello.' });
  assert.match(q, /People at the meeting: Priya Nair, Alex Chen/);
  assert.match(q, /The person keeping these notes is Jo Tran/);
  const bare = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, transcript: '[0:00] Hello.' });
  assert.ok(!bare.includes('People at the meeting:'), 'no list, no line');
  assert.match(M.MINUTES_SYSTEM, /Minutes never say "You"/);
  assert.match(M.MINUTES_SYSTEM, /third person/);
  assert.match(M.MINUTES_SYSTEM, /past tense/);
  assert.match(M.MINUTES_SYSTEM, /such as "It was said"/);
  assert.match(M.MINUTES_SYSTEM, /merge what is the same point/);
  assert.match(M.MINUTES_SYSTEM, /read in one minute/);
  assert.match(M.MINUTES_SYSTEM, /"2 Apr" not "second of April"/);
  assert.match(M.MINUTES_SYSTEM, /\$4,200/);
  assert.match(M.MINUTES_SYSTEM, /unless the transcript says/);
  assert.match(M.MINUTES_SYSTEM, /"Others" are the other people/);
});

// p9-minutes-actions-words (5 Nov 2026): a real run on Muse Spark 1.3 gave two actions where three
// were said — "Ask them if a loan unit is possible" landed only in Discussion and Open, and "Priya owns the retry"
// became "Own the retry". The prompt now says what an action is, with two short worked examples; the reader keeps a
// state-like what as written, since words are the model's job and code must not guess.

test('p9: the reader keeps a state-like action as written, never guessing the job', () => {
  const m = M.readMinutesReply({ present: [], absent: [], named: [], summary: '', figures: [], decisions: [], actions: [{ what: 'Own the retry', who: 'Priya Nair' }, { what: 'Is responsible for the receipts review', who: 'Alex Chen' }], open: [], topics: [] });
  assert.deepEqual(m.actions, [{ what: 'Own the retry', who: 'Priya Nair' }, { what: 'Is responsible for the receipts review', who: 'Alex Chen' }]);
});

test('p9: the question says what an action is: a request with no owner, an owned job, its due from wherever said', () => {
  assert.match(M.MINUTES_SYSTEM, /request someone must act on is an action even with no owner/);
  assert.match(M.MINUTES_SYSTEM, /Update the lighting plan/, 'a follow-up that would change a document is an action, never a new note');
  assert.match(M.MINUTES_SYSTEM, /the action is the job itself/);
  assert.match(M.MINUTES_SYSTEM, /never "own" or "responsible"/);
  assert.match(M.MINUTES_SYSTEM, /For example/);
  assert.match(M.MINUTES_SYSTEM, /Ask the mill whether Tuesday delivery is possible/);
  assert.match(M.MINUTES_SYSTEM, /Finish the till count before stocktake/);
});

test('chunked asks back as one: figures capped, each decision and action once, topics merged', () => {
  const a = M.readMinutesReply({ present: ['Priya Nair'], absent: [], named: [], summary: 'They went over the cart retry.', figures: [{ value: '20 Mar', label: 'Retry ships' }], decisions: [{ text: 'Ship the retry first', at: '1:00' }], actions: [{ what: 'chase the failed payments', who: 'Priya', due: '', time: '' }], questions: [], topics: [{ heading: 'Cart retry', words: ['The retry fails on Fridays.'] }] });
  const b = M.readMinutesReply({ present: ['Alex Chen'], absent: [], named: [], summary: 'The receipts review was set.', figures: [{ value: '2 Apr', label: 'Receipts review' }], decisions: [{ text: 'Ship the retry first', at: '1:00' }, { text: 'Keep Tessaly as supplier', at: '41:00' }], actions: [{ what: 'Chase the failed payments', who: 'Priya', due: '', time: '' }, { what: 'ask for a printer quote', who: '', due: '', time: '' }], questions: [{ what: 'Whether the printer arrives in time.', askedBy: 'Alex Chen' }, { what: 'Whether the printer arrives in time.' }], topics: [{ heading: 'Cart retry', words: ['Priya will chase the failed payments.'] }, { heading: 'Receipts', words: ['The review is in April.'] }] });
  const m = M.mergeMeetingMinutes([a, b]);
  assert.equal(m.summary, 'They went over the cart retry. The receipts review was set.');
  assert.deepEqual(m.present, ['Priya Nair', 'Alex Chen']);
  assert.deepEqual(m.figures, [{ value: '20 Mar', label: 'Retry ships' }, { value: '2 Apr', label: 'Receipts review' }]);
  assert.deepEqual(m.decisions, ['Ship the retry first', 'Keep Tessaly as supplier']);
  assert.deepEqual(m.actions.map((x) => x.what), ['Chase the failed payments', 'Ask for a printer quote']);
  assert.deepEqual(m.actions[1], { what: 'Ask for a printer quote' }, 'nobody named stays unassigned');
  assert.deepEqual(m.questions, [{ what: 'Whether the printer arrives in time.', askedBy: 'Alex Chen' }], 'the same question lands once');
  assert.deepEqual(m.topics, [{ heading: 'Cart retry', words: ['The retry fails on Fridays.', 'Priya will chase the failed payments.'] }, { heading: 'Receipts', words: ['The review is in April.'] }], 'the same topic merges its words');
  assert.equal(M.mergeMeetingMinutes([]), null);
});

test('speakers: the minutes name each voice, and a numbered voice never owns an action', () => {
  const marks = [{ id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 }];
  const q = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, transcript: '[0:00] Speaker 1: hello.', speakers: { marks, names: {} } });
  assert.match(q, /Speaker 1 \(not named\)/);
  assert.match(q, /never invent a name/);
  assert.match(M.MINUTES_SYSTEM, /never invent a name for it/);
  const r = M.readMinutesReply({ present: [], absent: [], named: [], summary: 'They met.', figures: [], decisions: [], actions: [{ what: 'chase the quote', who: 'Speaker 1' }], open: [], topics: [] });
  assert.deepEqual(r.actions, [{ what: 'Chase the quote' }]);
});

// The merge (m2 on m4/m9, 6 Nov 2026): voices and what the note holds ride one ask —
// the numbered voice is named in the ask and the existing minutes ride for the merged whole.
test('speakers with existing: one ask carries the voices and the note\u2019s minutes', () => {
  const marks = [{ id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 }];
  const q = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, transcript: '[0:00] Speaker 1: hello.', speakers: { marks, names: { spk1: 'Priya Nair' } }, existing: { decisions: ['Ship the retry first'] } });
  assert.match(q, /Priya Nair/);
  assert.match(q, /Already there/);
  assert.match(q, /Ship the retry first/);
});

// n4-minutes-pdf fault 6 (6 Nov 2026, the Fitzroy run firmed "by Friday", said on a Friday, to next Friday):
// the minutes keep the same promise as the notes — the model says the words, exact days resolve here, loose
// words stay words — and what the note already holds rides the same way. Invented jobs, safe to keep.
test('n4: the minutes keep loose due words as words, exact days as dates', () => {
  assert.ok(M.MINUTES_SYSTEM.includes('"when" is the words said for the due day'), 'the ask wants the words');
  const friday = '2026-11-06';
  const transcript = [{ at: 0, text: 'Mia will check the totals by Friday. Noah books council by Monday the 9th.' }];
  const r = M.readMinutesReply({
    present: [], absent: [], named: [], summary: 'They met.', figures: [], decisions: [], open: [], topics: [],
    actions: [
      { what: 'check the totals', who: 'Mia', when: 'Friday', due: '2026-11-13' },
      { what: 'confirm the council booking', who: 'Noah', when: 'Monday the 9th' },
    ],
  }, { date: friday, transcript });
  assert.deepEqual(r.actions, [
    { what: 'Check the totals', who: 'Mia', when: 'Friday' },
    { what: 'Confirm the council booking', who: 'Noah', due: '2026-11-09' },
  ]);
  assert.equal(M.minutesActionLine({ what: 'Check the totals', who: 'Mia Chen', when: 'Friday' }, PEOPLE), '- [ ] Check the totals — Mia Chen · by Friday');
  // What the note holds: a date rides as a date, loose words ride as words against the meeting's day.
  const held = M.readMinutesExisting(`---\ndate: ${friday}\n---\n\n## Actions\n\n- [ ] Check the totals — Mia · by Friday\n- [ ] Confirm the council booking — Noah · by 9 Nov 2026\n`);
  assert.deepEqual(held.actions, [
    { what: 'Check the totals', who: 'Mia', when: 'Friday' },
    { what: 'Confirm the council booking', who: 'Noah', due: '2026-11-09' },
  ]);
  const asked = M.minutesPrompt({ title: 'Mill call', date: friday, people: PEOPLE, transcript: '[0:00] You: Morning all.', existing: held });
  assert.ok(asked.includes('Check the totals — Mia (by Friday)'), 'loose words ride as words');
  assert.ok(asked.includes('Confirm the council booking — Noah (due 2026-11-09)'), 'a date rides as a date');
});

// n4-minutes-pdf fault 5 (6 Nov 2026, six "I'll do it" actions stayed blank because no voice was named):
// once a person names a speaker, the name reaches the minutes' ask — the voices' names and the transcript in
// those names — so a stub answering with the named owner keeps it, while an unnamed voice still owns nothing.
// Make and Make again run the one make, which reads the names fresh from the note each run, so naming after
// the first run lands in the next. Invented voices, safe to keep.
test('n4: a named voice reaches the ask and owns its action; Make again picks names up', () => {
  const lines = [{ at: 19, text: "I'll book the council inspection.", who: 'Speaker 2' }];
  const marks = Sp.marksFromLines(lines, 'mix');
  assert.deepEqual(marks.map((m) => m.id), ['spk2'], 'the voice rebuilt from the transcript labels');
  const shown = Sp.shownLines(lines, { spk2: 'Noah Patel' });
  assert.equal(shown[0].who, 'Noah Patel', 'the ask hears the voice in its name');
  const q = M.minutesPrompt({ title: 'Cart fix', date: '2026-11-05', people: PEOPLE, transcript: '[0:19] Speaker 2: I’ll book the council inspection.', speakers: { parts: [{ marks, names: { spk2: 'Noah Patel' } }] } });
  assert.match(q, /Speaker 2 is Noah Patel/, 'the voice named in the ask');
  // Changed 6 Nov 2026 (ff3d: two mixed clusters named, the Discussion then gave Mia's and Noah's work to the
  // cluster names): a named voice's name is used only where the words fit that person, never wherever the
  // label sits. The reader below still keeps a named owner the answer gives.
  assert.match(q, /not proof of who spoke/, 'told the label alone never names who acted');
  assert.match(q, /addressed by name/, 'told how owners are heard in real talk');
  // A stub answering as told: the named owner kept, an unnamed voice still owning nothing.
  const kept = M.readMinutesReply({ present: [], absent: [], named: [], summary: 'They met.', figures: [], decisions: [], actions: [{ what: 'book the council inspection', who: 'Noah Patel' }], open: [], topics: [] });
  assert.deepEqual(kept.actions, [{ what: 'Book the council inspection', who: 'Noah Patel' }], 'the named owner kept');
  const dropped = M.readMinutesReply({ present: [], absent: [], named: [], summary: 'They met.', figures: [], decisions: [], actions: [{ what: 'book the council inspection', who: 'Speaker 2' }], open: [], topics: [] });
  assert.deepEqual(dropped.actions, [{ what: 'Book the council inspection' }], 'an unnamed voice still owns nothing');
});

// m4-minutes-clean fault 2 (6 Nov 2026, Mia's roster action went to Alex: both sides carried the same "I will",
// and the ask said empty only when nobody took it, so the speaker was guessed): when the owner isn't clear, the
// owner stays empty for the person to see, never guessed.
test('m4: an unclear owner stays empty, never guessed', () => {
  assert.match(M.MINUTES_SYSTEM, /same words.*both sides/i);
  assert.match(M.MINUTES_SYSTEM, /never guess/i);
  assert.match(M.MINUTES_SYSTEM, /empty whenever the owner isn't clear/i);
});

// m4-minutes-clean fault 1 (6 Nov 2026, the Fitzroy run doubled: two summaries, five decisions for three, thirteen
// actions with near-duplicates): Make the minutes never doubles. One summary, one decisions list, one actions list;
// the same point or job in different words lands once. Invented meeting words, safe to keep.
test('m4: make the minutes never doubles the notes already there', () => {
  const note = '# Fitzroy\n\n## Summary\n\nThe weekly meeting covered the Fitzroy opening. They set dates for the till rollout and stock orders.\n\n## Decisions\n\n- Fitzroy store opens on Friday the 27th of November.\n- Cafe soft opens for locals Thursday afternoon, 26 November.\n- Merricks Creek Dairy starts the milk run on Monday the 23rd of November.\n\n## Actions\n\n- [ ] Have the roster for opening week done — [[Mia Chen]] · by 20 Nov 2026\n- [ ] Book the council final inspection for Tuesday the 17th — [[Noah Patel]] · by 17 Nov 2026\n';
  const m = M.readMinutesReply({ present: [], absent: [], named: [], summary: 'The meeting covered Fitzroy opening plans. Till training and milk supply dates were agreed.', figures: [], decisions: [{ text: 'Fitzroy opens Friday 27 November with a soft open for locals on Thursday afternoon 26 November.', at: '0:20' }, { text: 'Merricks Creek Dairy starts milk deliveries Monday 23 November.', at: '2:30' }], actions: [{ what: 'Complete roster for opening week', who: 'Mia Chen', due: '2026-11-20', time: '' }, { what: 'Book council final inspection for Tuesday 17th and confirm booking', who: 'Noah Patel', due: '2026-11-09', time: '' }], open: [], topics: [] });
  const out = M.applyMeetingMinutes(note, m, { people: ['Alex Rivera', 'Mia Chen', 'Kate Sullivan', 'Noah Patel'] });
  const summaries = out.text.split('## Summary')[1].split('## ')[0].split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.equal(summaries.length, 1, `one summary, not two: ${JSON.stringify(summaries)}`);
  const decisions = out.text.split('## Decisions')[1].split('## ')[0].split('\n').filter((l) => l.startsWith('- '));
  assert.equal(decisions.length, 3, `one decisions list of three, not five: ${JSON.stringify(decisions)}`);
  const actions = out.text.split('## Actions')[1].split('## ')[0].split('\n').filter((l) => l.startsWith('- [ ]') || l.startsWith('- [x]'));
  assert.equal(actions.length, 2, `one actions list of two, not four: ${JSON.stringify(actions)}`);
  assert.equal(out.added, 0);
});

// m4-minutes-clean fault 4 (6 Nov 2026, the Fitzroy run's council action inferred a 10:00 time that was never
// said for its day): nothing in the minutes may state a time, date or figure the transcript doesn't support. A
// time stays only with the day it was said for; a day or figure stays only when its words were said. Invented
// meeting words, safe to keep.
test('m4: a time stays only with its day, a day or figure only when said', () => {
  const lines = [
    { at: 0, text: 'Council can do the final inspection in the week of the 16th.', who: 'Others' },
    { at: 20, text: 'I will book it for Tuesday the 17th at 10, and confirm the booking by Monday the 9th.', who: 'You' },
    { at: 40, text: 'Two new tills arrive for the counter.', who: 'Others' },
  ];
  const r = M.readMinutesReply({ present: [], absent: [], named: [], summary: 'They set the inspection.', figures: [{ value: '2', label: 'New tills' }, { value: '3', label: 'Extra tills' }], decisions: [], actions: [{ what: 'Book council inspection and confirm booking', who: 'Noah Patel', due: '2026-11-09', time: '10:00' }, { what: 'Book inspection for Tuesday', who: 'Noah Patel', due: '2026-11-17', time: '10:00' }, { what: 'Chase an invented day', who: '', due: '2026-11-12', time: '' }], open: [], topics: [] }, { transcript: lines });
  assert.deepEqual(r.actions[0], { what: 'Book council inspection and confirm booking', who: 'Noah Patel', due: '2026-11-09' }, '10:00 was for the 17th, not the 9th');
  assert.deepEqual(r.actions[1], { what: 'Book inspection for Tuesday', who: 'Noah Patel', due: '2026-11-17', time: '10:00' }, '10:00 stays with the 17th');
  assert.deepEqual(r.actions[2], { what: 'Chase an invented day' }, 'the 12th was never said');
  assert.deepEqual(r.figures, [{ value: '2', label: 'New tills' }], 'two tills were said, three were not');
});

// m7-minutes-last fault 1 (6 Nov 2026, the Fitzroy minutes restated two decisions in new words: word overlap
// cannot tell the same point said differently): the note's own minutes ride along with the ask, the answer comes
// back as the merged whole, and replaces only the recorder's own lines — each kept verbatim where it still
// stands, a restating line gone, the person's ticked boxes kept whatever the answer says, and an empty answer
// never wiping a section. Running it again on its own result changes nothing. Invented meeting words.
const MERGED_NOTE = `---
type: meeting
date: 2026-11-06
---

## Summary

Priya and Alex went over the cart retry.

## Decisions

- Ship the retry before the receipts review.
- Keep Tessaly as the printer supplier.
- The retry ships first, ahead of receipts review.

## Actions

- [ ] Chase the failed payments — [[Priya Nair]]
- [x] Ring the mill about the quote
- [ ] Chase failed payments quickly

## Open

- The stock order totals still needed checking.
- Checking the stock order totals was still outstanding.

## Discussion

### Cart retry

The retry fails on Fridays.

Friday failures still hit the retry.

## Transcript

> [!quote]- Transcript · 4 minutes
> **0:00** *You:* Morning all, let us start with the cart and the retry.
`;

const MERGED_REPLY = {
  present: ['Priya Nair', 'Alex Chen'],
  absent: [],
  named: [],
  summary: 'Priya and Alex went over the cart retry.',
  figures: [],
  decisions: [{ text: 'Ship the retry before the receipts review.', at: '0:00' }, { text: 'Keep Tessaly as the printer supplier.', at: '0:00' }],
  actions: [{ what: 'Chase the failed payments', who: 'Priya Nair', due: '', time: '' }],
  questions: [{ what: 'The stock order totals still needed checking.' }],
  topics: [{ heading: 'Cart retry', words: ['The retry fails on Fridays.'] }],
};

test('m7: the merged whole replaces restated lines, keeps the person’s, and holds steady', () => {
  const minutes = M.readMinutesReply(MERGED_REPLY, { me: 'Alex Chen' });
  const out = M.applyMeetingMinutes(MERGED_NOTE, minutes, { people: PEOPLE, me: 'Alex Chen', merged: true });
  const decisions = out.text.split('## Decisions')[1].split('## Actions')[0];
  assert.ok(decisions.includes('- Ship the retry before the receipts review.'), 'the first wording kept verbatim');
  assert.ok(decisions.includes('- Keep Tessaly as the printer supplier.'), 'the second kept');
  assert.ok(!decisions.includes('ahead of receipts review'), 'the restating line gone');
  const actions = out.text.split('## Actions')[1].split('## Questions')[0];
  assert.ok(actions.includes('- [ ] Chase the failed payments — [[Priya Nair]]'), 'the row kept verbatim, link and all');
  assert.ok(actions.includes('- [x] Ring the mill about the quote'), 'the person’s ticked box kept');
  assert.ok(!actions.includes('Chase failed payments quickly'), 'the restated row gone: one job, one row');
  const discussion = out.text.split('## Discussion')[1].split('## Transcript')[0];
  const questions = out.text.split('## Questions')[1].split('## Discussion')[0];
  assert.ok(questions.includes('- ? The stock order totals still needed checking.') && !questions.includes('still outstanding'), 'open folded into one question');
  assert.ok(!/^## Open$/m.test(out.text), 'the old Open section gone');
  assert.ok(discussion.includes('The retry fails on Fridays.') && !discussion.includes('still hit the retry'), 'discussion merged to one');
  assert.equal(out.added, 0, 'nothing new added');
  // Running it again on its own result: steady.
  const again = M.applyMeetingMinutes(out.text, minutes, { people: PEOPLE, me: 'Alex Chen', merged: true });
  assert.equal(again.text, out.text, 'a second run changes nothing');
  assert.equal(again.added, 0);
  // An empty answer never wipes a section.
  const empty = M.applyMeetingMinutes(MERGED_NOTE, { ...minutes, decisions: [], actions: [], questions: [], topics: [] }, { people: PEOPLE, me: 'Alex Chen', merged: true });
  assert.ok(empty.text.includes('ahead of receipts review') && empty.text.includes('Chase failed payments quickly'), 'empty answer: everything stays');
  assert.ok(empty.text.includes('still outstanding') && empty.text.includes('still hit the retry'), 'empty answer: open and discussion stay');
  assert.ok(/^## Open$/m.test(empty.text), 'empty answer: the Open section stays');
});

test('m7: what the note holds rides along with the ask', () => {
  const held = M.readMinutesExisting(MERGED_NOTE);
  assert.equal(held.summary, 'Priya and Alex went over the cart retry.');
  assert.deepEqual(held.decisions, ['Ship the retry before the receipts review.', 'Keep Tessaly as the printer supplier.', 'The retry ships first, ahead of receipts review.']);
  assert.deepEqual(held.actions.map((a) => a.what), ['Chase the failed payments', 'Ring the mill about the quote', 'Chase failed payments quickly']);
  assert.deepEqual(held.questions, [{ what: 'The stock order totals still needed checking.' }, { what: 'Checking the stock order totals was still outstanding.' }], 'an old Open section rides as questions');
  assert.deepEqual(held.topics, [{ heading: 'Cart retry', words: ['The retry fails on Fridays.', 'Friday failures still hit the retry.'] }]);
  assert.ok(M.hasMinutesExisting(held), 'there is something to merge against');
  assert.ok(!M.hasMinutesExisting({}), 'an empty note merges nothing');
  const asked = M.minutesPrompt({ title: 'Cart retry standup', date: '2026-11-06', people: PEOPLE, transcript: '[0:00] You: Morning all.', existing: held });
  assert.ok(asked.includes('Already there (decisions):') && asked.includes('ahead of receipts review'), 'the ask carries the note’s lines');
  assert.ok(asked.includes('Never drop an existing point, job, question or word'), 'the ask says to keep every point, job and question');
  assert.ok(!M.minutesPrompt({ title: 'Cart retry standup', date: '2026-11-06', people: PEOPLE, transcript: '[0:00] You: Morning all.' }).includes('Already there'), 'no existing, no merge');
});

// m7-minutes-last fault 2 (6 Nov 2026, the minutes said totals "were reviewed" when nobody said that was
// done): the ask states it — nothing may read as done, agreed or decided unless the transcript says so.
test('m7: the ask states nothing as done, agreed or decided unless the transcript says so', () => {
  assert.ok(M.MINUTES_SYSTEM.includes('only when the transcript says it was'), 'the minutes ask carries the rule');
  assert.ok(M.MINUTES_SYSTEM.includes('never work finished'), 'a request is never a completion');
});

// m9-minutes-keep (6 Nov 2026, the m7 merged whole drops any unticked line the model leaves out — a model
// that silently drops a person-added line would lose it, and Undo only helps when noticed): a line goes
// only when shown to restate a line that stays. A person-added decision, action, open item and discussion
// word the stub answer leaves out all survive verbatim, exactly where they are; a ticked box stays; nothing
// was tidied; pressing twice holds steady. Invented meeting words.
const KEPT_NOTE = `---
type: meeting
date: 2026-11-06
---

## Summary

Priya and Alex went over the cart retry.

## Decisions

- Ship the retry before the receipts review.
- Keep Tessaly as the printer supplier.
- Ask the bank about the overdraft facility.

## Actions

- [ ] Chase the failed payments — [[Priya Nair]]
- [ ] Water the shop plants every Saturday
- [x] Ring the mill about the quote

## Open

- The stock order totals still needed checking.
- Whether the front window sign arrives before Saturday.

## Discussion

### Cart retry

The retry fails on Fridays.

The lunch queue stretched past the till counter.

## Transcript

> [!quote]- Transcript · 4 minutes
> **0:00** *You:* Morning all, let us start with the cart and the retry.
`;

const KEPT_REPLY = {
  present: ['Priya Nair', 'Alex Chen'],
  absent: [],
  named: [],
  summary: 'Priya and Alex went over the cart retry.',
  figures: [],
  decisions: [{ text: 'Ship the retry before the receipts review.', at: '0:00' }, { text: 'Keep Tessaly as the printer supplier.', at: '0:00' }],
  actions: [{ what: 'Chase the failed payments', who: 'Priya Nair', due: '', time: '' }],
  questions: [{ what: 'The stock order totals still needed checking.' }],
  topics: [{ heading: 'Cart retry', words: ['The retry fails on Fridays.'] }],
};

test('m9: a line the merged whole leaves out stays verbatim where it is', () => {
  const minutes = M.readMinutesReply(KEPT_REPLY, { me: 'Alex Chen' });
  const out = M.applyMeetingMinutes(KEPT_NOTE, minutes, { people: PEOPLE, me: 'Alex Chen', merged: true });
  const decisions = out.text.split('## Decisions')[1].split('## Actions')[0];
  assert.ok(decisions.includes('- Ask the bank about the overdraft facility.'), 'the person-added decision survives verbatim');
  assert.ok(decisions.indexOf('Keep Tessaly') < decisions.indexOf('Ask the bank'), 'exactly where it was');
  const actions = out.text.split('## Actions')[1].split('## Questions')[0];
  assert.ok(actions.includes('- [ ] Water the shop plants every Saturday'), 'the person-added action survives verbatim');
  assert.ok(actions.includes('- [x] Ring the mill about the quote'), 'the ticked box stays');
  const questions = out.text.split('## Questions')[1].split('## Discussion')[0];
  assert.ok(questions.includes('- ? Whether the front window sign arrives before Saturday.'), 'the person-added open item survives, folded into a question');
  assert.ok(!/^## Open$/m.test(out.text), 'the old Open section gone');
  const discussion = out.text.split('## Discussion')[1].split('## Transcript')[0];
  assert.ok(discussion.includes('The lunch queue stretched past the till counter.'), 'the person-added discussion word survives verbatim');
  assert.ok(discussion.indexOf('The retry fails on Fridays.') < discussion.indexOf('The lunch queue'), 'exactly where it was');
  assert.equal(out.tidied, 0, 'nothing restated, nothing tidied');
  assert.equal(M.tidiedWords(out.tidied), '', 'no tidying, no words');
  const again = M.applyMeetingMinutes(out.text, minutes, { people: PEOPLE, me: 'Alex Chen', merged: true });
  assert.equal(again.text, out.text, 'pressing twice holds steady');
  assert.equal(again.tidied, 0);
});

// m9-minutes-keep: the bar for "restates" is set by the real Fitzroy restated pairs (6 Nov 2026, footage
// "2026-11-06 Fitzroy cafe opening weekly 2.md": two decisions restated in new words). The merged whole
// keeps one wording of each pair; the other goes, and the toast count says two. Real meeting words, kept.
const FITZROY_NOTE = `---
type: meeting
date: 2026-11-06
---

## Decisions

- Agreed to open the following week if council was happy on the 17th and joinery landed on the 19th.
- Fitzroy to open Friday 27 November with a soft open for locals Thursday afternoon 26 November.
- Merricks Creek Dairy to start Monday 23 November for Brunswick and Fitzroy.
- Fitzroy opens the week after council approval on the 17th and joinery delivery on the 19th.
- Both stores move from Fresh Dairy Co to Merricks Creek Dairy.

## Transcript

> [!quote]- Transcript · 4 minutes
> **0:00** *You:* Morning all.
`;

test('m9: the real restated pairs still merge to one, and the toast says how many', () => {
  const minutes = M.readMinutesReply({
    present: [], absent: [], named: [], summary: '', figures: [],
    decisions: [
      { text: 'Agreed to open the following week if council was happy on the 17th and joinery landed on the 19th.', at: '1:00' },
      { text: 'Fitzroy to open Friday 27 November with a soft open for locals Thursday afternoon 26 November.', at: '1:19' },
      { text: 'Merricks Creek Dairy to start Monday 23 November for Brunswick and Fitzroy.', at: '2:39' },
    ],
    actions: [], open: [], topics: [],
  });
  const out = M.applyMeetingMinutes(FITZROY_NOTE, minutes, { people: PEOPLE, merged: true });
  const decisions = out.text.split('## Decisions')[1].split('## Transcript')[0];
  assert.ok(decisions.includes('- Agreed to open the following week if council was happy on the 17th and joinery landed on the 19th.'), 'the first wording kept verbatim');
  assert.ok(decisions.includes('- Fitzroy to open Friday 27 November with a soft open for locals Thursday afternoon 26 November.'), 'the middle decision untouched');
  assert.ok(decisions.includes('- Merricks Creek Dairy to start Monday 23 November for Brunswick and Fitzroy.'), 'the third kept verbatim');
  assert.ok(!decisions.includes('joinery delivery on the 19th'), 'the council restatement gone');
  assert.ok(!decisions.includes('Both stores move from Fresh Dairy Co'), 'the dairy restatement gone');
  assert.equal(out.tidied, 2, 'two restated lines tidied');
  assert.equal(M.tidiedWords(1), 'Tidied 1 restated line.');
  assert.equal(M.tidiedWords(2), 'Tidied 2 restated lines.');
  const again = M.applyMeetingMinutes(out.text, minutes, { people: PEOPLE, merged: true });
  assert.equal(again.text, out.text, 'pressing twice holds steady');
  assert.equal(again.tidied, 0, 'nothing left to tidy');
});
