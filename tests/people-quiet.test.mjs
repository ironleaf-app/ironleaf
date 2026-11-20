// node --test tests/people-quiet.test.mjs — people gone quiet (10.0 v2locked, plan item 25, vault-deep rank 11): the
// usual gap between contacts with a floor and a ceiling, one brief line per quiet person with a one-line drafted
// check-in that is never sent by itself, and the exclusions (no contacts, organisations, yourself, a meeting coming
// up). Made-up people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-people-quiet-'));
let P, B, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};\nexport { buildRecordModel } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  await build({ input: path.join(root, 'src/shared/brief.ts'), platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
  await build({ input: path.join(root, 'src/main/brief.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-04';
const meeting = (date, title = 'Catch-up') => ({ id: `meeting:${date}`, title, date });
const card = (meetings, lastContact, nextMeeting) => ({ meetings, ...(lastContact ? { lastContact } : {}), ...(nextMeeting ? { nextMeeting } : {}) });

test('quiet past the usual gap: the median gap, the 30-day floor, the 90-day ceiling', () => {
  // Met every two weeks through spring, silent since 19 September: quiet for 6 weeks, usually 2.
  const often = card([meeting('2026-08-22'), meeting('2026-09-05'), meeting('2026-09-19')], { date: '2026-09-19', what: 'Spring review' });
  assert.deepEqual(P.personQuiet(often, TODAY), { days: 46, usualDays: 14 });
  // As silent as usual is not quiet: met every two months, 45 days silent.
  const slow = card([meeting('2026-05-01'), meeting('2026-07-01'), meeting('2026-09-20')], { date: '2026-09-20', what: 'Winter review' });
  assert.equal(P.personQuiet(slow, TODAY), null);
  // The floor: met weekly, 25 days silent is not quiet yet; 35 is.
  const weekly = [meeting('2026-09-20'), meeting('2026-09-27'), meeting('2026-10-04')];
  assert.equal(P.personQuiet(card(weekly), '2026-10-29'), null);
  assert.deepEqual(P.personQuiet(card(weekly), '2026-11-08'), { days: 35, usualDays: 7 });
  // The ceiling: met twice, nine months apart, 100 days silent is quiet (the ceiling, not the nine months).
  const rare = card([meeting('2025-11-04'), meeting('2026-07-27')]);
  assert.deepEqual(P.personQuiet(rare, TODAY), { days: 100, usualDays: 265 });
  assert.equal(P.personQuiet(rare, '2026-10-15'), null);
  // An even count of gaps takes the middle pair's mean.
  const even = card([meeting('2026-09-01'), meeting('2026-09-08'), meeting('2026-09-29')]);
  assert.deepEqual(P.personQuiet(even, '2026-11-04'), { days: 36, usualDays: 14 });
});

test('one contact uses the default, none never flags, a meeting resets it or heads it off', () => {
  const once = card([meeting('2026-09-01')]);
  assert.equal(P.personQuiet(once, '2026-10-10'), null, '40 days after a single meeting: not yet');
  assert.deepEqual(P.personQuiet(once, '2026-10-20'), { days: 49 }, 'past the 45-day default, with no "usually" to say');
  assert.equal(P.personQuiet(card([]), TODAY), null, 'never in touch: nothing gone quiet');
  // A recent meeting resets the silence even with a long gap behind it.
  const back = card([meeting('2026-05-01'), meeting('2026-10-30')], { date: '2026-10-30', what: 'In touch' });
  assert.equal(P.personQuiet(back, TODAY), null);
  // A meeting coming up heads the nudge off, however long the silence.
  const soon = { ...card([meeting('2026-05-01')]), nextMeeting: { id: 'meeting:next', title: 'Planning', date: '2026-11-05' } };
  assert.equal(P.personQuiet(soon, TODAY), null);
  // The last-contact note counts as a contact beside the meetings.
  const wrote = card([meeting('2026-09-01')], { date: '2026-10-20', what: 'In touch' });
  assert.equal(P.personQuiet(wrote, TODAY), null, 'a fortnight since the last word: not quiet');
});

test('cards: quiet attached for people, never for organisations or yourself', () => {
  const note = (p, title, props, content) => ({ path: p, title, props, content, mtime: 0 });
  const project = ['---', 'type: project', 'owner: Ana Ruiz', '---', '# Harbour Fit-out', '', "## What's next", '', '- [ ] Send the plan — Ana Ruiz · by 2026-11-02', ''].join('\n');
  const sam = ['---', 'type: person', '---', '# Sam Okafor', ''].join('\n');
  const ana = ['---', 'type: person', '---', '# Ana Ruiz', ''].join('\n');
  const tessaly = ['---', 'type: organisation', '---', '# Tessaly', ''].join('\n');
  const old1 = ['---', 'type: meeting', 'date: 2026-08-22', 'attendees: [Sam Okafor]', '---', '# Site walk', ''].join('\n');
  const old2 = ['---', 'type: meeting', 'date: 2026-09-20', 'attendees: [Sam Okafor]', '---', '# Spring review', ''].join('\n');
  const oldAna = ['---', 'type: meeting', 'date: 2026-06-01', 'attendees: [Ana Ruiz]', '---', '# Handover', ''].join('\n');
  const model = P.buildRecordModel({
    notes: [
      note('Projects/Harbour Fit-out.md', 'Harbour Fit-out', { type: 'project', owner: 'Ana Ruiz' }, project),
      note('People/Sam Okafor.md', 'Sam Okafor', { type: 'person' }, sam),
      note('People/Ana Ruiz.md', 'Ana Ruiz', { type: 'person' }, ana),
      note('Orgs/Tessaly.md', 'Tessaly', { type: 'organisation' }, tessaly),
      note('Meetings/2026-08-22 Site walk.md', 'Site walk', { type: 'meeting', date: '2026-08-22', attendees: ['Sam Okafor'] }, old1),
      note('Meetings/2026-09-20 Spring review.md', 'Spring review', { type: 'meeting', date: '2026-09-20', attendees: ['Sam Okafor'] }, old2),
      note('Meetings/2026-06-01 Handover.md', 'Handover', { type: 'meeting', date: '2026-06-01', attendees: ['Ana Ruiz'] }, oldAna),
    ],
    resolve: () => null, today: TODAY, me: 'Ana Ruiz',
  });
  const cards = P.personCards(model);
  const samCard = cards.find((c) => c.name === 'Sam Okafor');
  assert.deepEqual(samCard.quiet, { days: 45, usualDays: 29 }, 'two meetings five weeks apart, quiet six weeks on');
  const anaCard = cards.find((c) => c.name === 'Ana Ruiz');
  assert.equal(anaCard.quiet, undefined, 'your own card never flags, however silent');
  const tessalyCard = cards.find((c) => c.name === 'Tessaly');
  assert.equal(tessalyCard?.quiet, undefined, 'organisations never flag');
  const brief = P.quietBriefPeople(cards);
  assert.deepEqual(brief.map((q) => q.name), ['Sam Okafor']);
  assert.ok(brief[0].draft.startsWith('Hi Sam,'), 'each carries its drafted check-in');
});

test('the draft is one line from what is open or last shared, never wordy', () => {
  const base = { name: 'Sam Okafor', owesYouItems: [], youOweItems: [], lastContact: { date: '2026-09-20', what: 'Spring review' } };
  assert.equal(P.checkInDraft({ ...base, owesYouItems: [{ id: 'a', title: 'The freight quote', path: 'Projects/P.md' }] }), 'Hi Sam, how did The freight quote go?');
  assert.equal(P.checkInDraft({ ...base, youOweItems: [{ id: 'a', title: 'Send the samples', path: 'Projects/P.md' }] }), 'Hi Sam, how did Send the samples go?');
  assert.equal(P.checkInDraft(base), 'Hi Sam, how did things go after Spring review?');
  assert.equal(P.checkInDraft({ ...base, lastContact: { date: '2026-09-20', what: 'In touch' } }), 'Hi Sam, it has been a while. How have you been?');
  for (const d of [P.checkInDraft(base), P.checkInDraft({ ...base, name: '  ' })]) {
    assert.ok(!d.includes('\n') && !d.includes('—') && d.length <= 120, `one plain line: ${d}`);
  }
});

test('the brief carries one line per quiet person with the draft as its action', () => {
  const NOW = new Date(2026, 10, 4, 8, 30).getTime();
  const people = [
    { id: 'person:sam-okafor', name: 'Sam Okafor', path: 'People/Sam Okafor.md', days: 42, usualDays: 14, draft: 'Hi Sam, how did The freight quote go?' },
    { id: 'person:priya-shah', name: 'Priya Shah', days: 60, draft: 'Hi Priya, it has been a while. How have you been?' },
  ];
  const input = { now: NOW, calendar: null, meetingNotes: {}, due: null, projects: null, decks: [], people, found: [], foundState: 'none', prefs: B.NO_PREFS };
  const brief = B.buildBrief(input);
  const lines = brief.items.filter((i) => i.kind === 'person');
  assert.equal(lines.length, 2);
  const sam = lines.find((l) => l.title === 'Sam Okafor has gone quiet');
  const priya = lines.find((l) => l.title === 'Priya Shah has gone quiet');
  assert.equal(sam.detail, 'Quiet for 6 weeks, usually every 2 weeks');
  assert.deepEqual(sam.actions[0], { kind: 'ask', label: 'Draft check-in', words: 'Hi Sam, how did The freight quote go?' });
  assert.equal(priya.detail, 'Quiet for 2 months');
  // Never sent by itself: the action only drafts into the chat box (the brief runner puts ask words there, unsent).
  assert.ok(lines.every((l) => l.actions.every((a) => a.kind === 'ask' || a.kind === 'open')));
  // At most three of one kind, like every kind.
  const four = B.buildBrief({ ...input, people: [...people, { id: 'person:c', name: 'C', days: 50, draft: 'Hi C.' }, { id: 'person:d', name: 'D', days: 51, draft: 'Hi D.' }] });
  assert.equal(four.items.filter((i) => i.kind === 'person').length, 3);
  // "Not useful" hides the line and ranks the kind lower after.
  const hidden = B.markNotUseful(B.NO_PREFS, { ...sam, from: B.fromOf(sam) }, NOW);
  const again = B.buildBrief({ ...input, prefs: hidden });
  assert.ok(again.items.every((i) => i.id !== sam.id), 'hidden');
  assert.ok(B.setAside(hidden, 'person|notes', NOW) > 0, 'the kind set aside');
});

test('the main side gathers quiet people, and says so when it cannot', async () => {
  const handlers = {};
  const empty = { overdue: [], today: [], week: [], undated: [], undatedCount: 0 };
  const projects = { due: { overdue: [], today: [] }, atRisk: [], quiet: [] };
  const base = { handle: (ch, fn) => (handlers[ch] = fn), due: () => empty, today: () => projects, calendar: async () => ({ connected: false }), decks: () => [], meetingNotes: () => ({}), load: async () => null, save: async () => {}, now: () => new Date(2026, 10, 4, 8, 30).getTime() };
  M.registerBrief({ ...base, people: () => [{ id: 'person:sam-okafor', name: 'Sam Okafor', days: 42, usualDays: 14, draft: 'Hi Sam.' }] });
  const brief = await handlers['brief:get']();
  assert.ok(brief.items.some((i) => i.kind === 'person' && i.title === 'Sam Okafor has gone quiet'), 'the people line is in the brief');
  M.registerBrief({ ...base, people: () => { throw new Error('no notes open'); } });
  const failed = await handlers['brief:get']();
  assert.ok(failed.items.some((i) => i.kind === 'problem' && i.title === 'Couldn’t read the people'), 'a failure is said, never silent');
});
