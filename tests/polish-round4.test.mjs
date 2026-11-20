// node --test tests/polish-round4.test.mjs — Polish round 4 (29 Oct 2026, the plan): a meeting's YAML
// date is its calendar day in every time zone and next meetings are said as today / tomorrow / Fri 30 Oct; the
// actions card belongs on meeting notes only and offers only lines that read as an action; People in it are
// the people a note links to, @mentions and people linked from it; reading view never repeats the title as
// the body's first heading; the path bar shows at most the last two parts whole with the ellipsis at the
// start; Next for you is always the person's own action, never a key date. Made-up names only.
process.env.TZ = 'Australia/Melbourne';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-round4-'));
let D, M, P, R, NP, PA, T, buildModel;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(entry, [
    `export * as D from ${src('src/shared/days.ts')};`,
    `export * as M from ${src('src/shared/meetings.ts')};`,
    `export * as P from ${src('src/shared/people.ts')};`,
    `export { buildRecordModel } from ${src('src/shared/records.ts')};`,
    `export * as R from ${src('src/shared/note-rail.ts')};`,
    `export * as NP from ${src('src/shared/note-page.ts')};`,
    `export * as PA from ${src('src/shared/paths.ts')};`,
    `export * as T from ${src('src/shared/today.ts')};`,
    '',
  ].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'all.mjs'), format: 'esm' }, logLevel: 'silent' });
  const m = await import(pathToFileURL(path.join(work, 'all.mjs')).href);
  ({ D, M, P, R, NP, PA, T } = m);
  buildModel = m.buildRecordModel;
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const TODAY = '2026-10-29'; // a Thursday in Melbourne

test('item 1: a YAML date (midnight UTC) is taken as that calendar day, never shifted', () => {
  const yamlDate = new Date(Date.UTC(2026, 9, 30)); // 2026-10-30 as YAML reads a bare date
  assert.equal(D.calendarDayOf(yamlDate), '2026-10-30');
  assert.equal(D.calendarDayOf('2026-10-30'), '2026-10-30');
  assert.equal(D.calendarDayOf('2026-13-45'), undefined, 'a day that is not there is no day');
  assert.equal(D.calendarDayOf('2026-02-30'), undefined, '30 February is no day');
  assert.equal(D.isoDay(M.meetingDate('Meetings/Harbour.md', { date: yamlDate })), '2026-10-30', 'meetingDate keeps the written day on a Melbourne PC');
  const note = (p, title, props, content) => ({ path: p, title, props, content, mtime: 0 });
  const meeting = ['---', 'type: meeting', 'attendees: [Mia Tran]', '---', '# Harbour site meeting', ''].join('\n');
  const model = buildModel({ notes: [note('People/Mia Tran.md', 'Mia Tran', { type: 'person' }, '# Mia Tran\n'), note('Meetings/Harbour site meeting.md', 'Harbour site meeting', { type: 'meeting', date: yamlDate, attendees: ['Mia Tran'] }, meeting)], resolve: () => null, today: TODAY, me: 'Ana Ruiz' });
  const mia = P.personCards(model).find((c) => c.name === 'Mia Tran');
  assert.equal(mia.nextMeeting.date, '2026-10-30', 'the people cards keep the written day, not the day before in Melbourne');
});

test('item 1: next meeting words are today, tomorrow, then the day itself', () => {
  assert.equal(P.nextMeetingWords('2026-10-29', TODAY), 'today');
  assert.equal(P.nextMeetingWords('2026-10-30', TODAY), 'tomorrow');
  assert.equal(P.nextMeetingWords('2026-11-03', TODAY), 'Tue 3 Nov');
  assert.equal(P.nextMeetingWords('2026-10-20', TODAY), 'Tue 20 Oct', 'a past day is never called today');
});

test('item 2: only lines that read as an action (a verb and a thing to do) are offered', () => {
  const text = [
    '## Register',
    '- [ ] Send the updated RACI file to Darcy Lin',
    '- [ ] Jesse',
    '- [ ] Others',
    '- [ ] Corrected: the design rule is the approved global design that any vendor must build unchanged',
    '- [ ] "Jesse" is Jesse Arlow. "Open" means no deadline on record',
    '- [ ] Tessaly: Darcy Lin\'s eight questions (28 Oct) plus extras. None answered yet',
    '## Decisions',
    '- [ ] Book the room for Friday',
  ].join('\n');
  const found = M.findActions(text, { date: new Date(2026, 9, 29), people: ['Darcy Lin'] });
  assert.deepEqual(found.map((a) => a.what), ['Send the updated RACI file to Darcy Lin']);
  assert.equal(M.looksLikeAction('Send the updated RACI file'), true);
  assert.equal(M.looksLikeAction('Jesse'), false, 'a bare name');
  assert.equal(M.looksLikeAction('Others'), false, 'a bare heading word');
  assert.equal(M.looksLikeAction('Corrected: the design rule is approved'), false, 'a correction note');
  assert.equal(M.looksLikeAction('"Jesse" is Jesse Arlow'), false, 'a definition');
  assert.equal(M.looksLikeAction('Tessaly: eight questions. None answered yet'), false, 'a statement, not a job');
});

test('item 2: the actions card shows on meeting notes only', () => {
  const panel = read('src/renderer/src/views/MeetingActions.tsx');
  assert.match(panel, /if \(!ctx\.meeting\) return null;/, 'a plain note never gets the card, even in a project');
  assert.doesNotMatch(panel, /ctx\.projects\.length > 0 \? found/, 'having a project no longer brings the card up');
});

test('item 3: People in it are people linked to, @mentioned, and people linked from it', () => {
  const notes = [
    { path: 'Notes/Plan.md', title: 'Plan', props: {}, links: [{ target: 'People/Sam' }] },
    { path: 'People/Sam.md', title: 'Sam Okafor', props: { type: 'person' }, links: [] },
    { path: 'People/Priya.md', title: 'Priya Shah', props: { type: 'person' }, links: [{ target: 'Notes/Plan' }] },
    { path: 'People/Mia.md', title: 'Mia Tran', props: { type: 'person' }, links: [] },
    { path: 'Notes/Other.md', title: 'Other', props: {}, links: [{ target: 'Notes/Plan' }] },
  ];
  const resolve = (target) => notes.find((n) => n.path.replace(/\.md$/i, '') === target.replace(/\.md$/i, '') || n.title === target)?.path ?? null;
  const rail = R.noteRail({ path: 'Notes/Plan.md', text: '# Plan\n\nAsk @Mia Tran about the quote.', notes, backlinkPaths: ['People/Priya.md', 'Notes/Other.md'], resolve, ref: new Date(2026, 9, 29) });
  assert.deepEqual(rail.people.map((p) => p.title), ['Mia Tran', 'Priya Shah', 'Sam Okafor'], 'linked to, @mentioned and linked from, each once, by name');
});

test('item 4: reading view never shows the title twice; the file keeps its heading', () => {
  const text = '---\ntype: note\n---\n# Gallery Fit-out Action Register and Timeline\n\nBody words.\n';
  const shown = NP.stripTitleHeading(text, 'Gallery Fit-out Action Register and Timeline');
  assert.doesNotMatch(shown, /# Gallery Fit-out/, 'the heading that repeats the title is not shown again');
  assert.match(shown, /Body words\./);
  assert.match(text, /# Gallery Fit-out/, 'the file itself is untouched');
  assert.equal(NP.stripTitleHeading('# A different heading\n\nBody.', 'Plan'), '# A different heading\n\nBody.', 'a heading that is not the title stays');
  assert.equal(NP.stripTitleHeading('Words first.\n\n# Plan\n', 'Plan'), 'Words first.\n\n# Plan\n', 'only the first heading counts');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.match(view, /stripTitleHeading/, 'reading view uses it');
});

test('item 5: the path bar shows at most the last two parts whole, ellipsis only at the start', () => {
  assert.deepEqual(PA.pathParts(['Work', 'Projects', 'Marlowe Gallery Fit-out (Tessaly Studio)', 'Notes']), ['…', 'Marlowe Gallery Fit-out (Tessaly Studio)', 'Notes']);
  assert.deepEqual(PA.pathParts(['Projects', 'Notes']), ['Projects', 'Notes'], 'two parts are shown whole, with no ellipsis');
  assert.deepEqual(PA.pathParts(['Notes']), ['Notes']);
  assert.deepEqual(PA.pathParts([]), []);
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.match(header, /pathParts\(/, 'the path bar uses it');
});

test('item 6: Next for you is always the person\'s own action; key dates stay in the day lists', () => {
  const item = (what, offset, kind = 'step', extra = {}) => ({ id: what, project: 'p', projectName: 'Alpha', version: 'v', kind, what, others: false, when: '', offset, tone: 'none', ...extra });
  const due = {
    overdue: [],
    today: [item('Jay Lu back from travel', 0, 'date'), item('Send Bettina the Tessaly points', 0)],
    soon: [item('Alpha is due', 2, 'project')],
    later: [],
  };
  assert.equal(T.pickNextForYou(due).what, 'Send Bettina the Tessaly points', 'a key date today is something to know, not the next thing to do');
  assert.equal(T.pickNextForYou({ overdue: [], today: [item('Jay Lu back from travel', 0, 'date')], soon: [], later: [] }), null, 'with only a key date, nothing is picked');
  assert.deepEqual(T.rankNextForYou([item('Jay Lu back from travel', 0, 'date'), item('Reply to Bettina', 1)]).map((x) => x.what), ['Reply to Bettina'], 'key dates and project deadlines never rank as actions');
});
