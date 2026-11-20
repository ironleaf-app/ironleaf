// node --test tests/layout-writes.test.mjs — project layouts written by the assistant (src/shared/layout-writes.ts and its
// tools in src/main/agent.ts; 21 Oct 2026). Neutral made-up notes only (a sales-calls log kept newest first, a reading
// habit kept oldest first and counting its days, a cafe opening, a data-migration programme): an entry goes into the
// log the file already keeps, in its order, names and units; a log is made only when the project has none; a row goes
// into a table by its own columns and the same row is updated, not doubled; a layout adds only what is missing; and a
// project put into its layout loses no number, date or link, and waits for the person to accept it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-layout-writes-'));
let L, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  const shared = path.join(work, 'shared.ts');
  writeFileSync(shared, `export * from ${JSON.stringify(path.join(root, 'src/shared/layout-writes.ts'))};\nexport { parseLog } from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};\n`);
  await build({ input: shared, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  const agent = path.join(work, 'agent.ts');
  writeFileSync(agent, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: agent, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'shared.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 21, 9, 30); // Wednesday 21 October 2026

const SALES = `---
type: log
project: "[[Northside sales]]"
fields: [Calls, Meetings booked]
units: {Calls: calls}
---
# Sales calls

## Tue 20 Oct 2026

- Calls: 14 calls
- Meetings booked: 2
- Followed up: Y

## Mon 19 Oct 2026

- Calls: 9 calls
- Meetings booked: 1
- Quiet morning, two voicemails.
`;

const READING = `---
type: log
project: Reading habit
fields: [Pages]
---
# Reading

Intro words the person wrote stay here.

## Sun 18 Oct 2026, Day 1

- Read: Y
- Pages: 20

## Mon 19 Oct 2026, Day 2

- Read: Y
- Pages: 35
- Screen-free evening: Y
`;

test('an entry goes in at the top of a log kept newest first, names and units its own', () => {
  const r = L.writeLogEntry(SALES, { date: '2026-10-21', fields: [['calls', 11], ['meetings', 3]], notes: ['Two referrals from Harbour Co.'] }, NOW);
  assert.equal(r.order, 'top');
  assert.equal(r.addedTo, false);
  assert.deepEqual(r.written, [['Calls', '11 calls'], ['Meetings booked', '3']], 'plural and first word matched to the log’s own names; its unit carried');
  assert.deepEqual(r.newFields, []);
  const body = r.text.slice(r.text.indexOf('# Sales calls'));
  assert.ok(body.indexOf('## Wed 21 Oct 2026') < body.indexOf('## Tue 20 Oct 2026'), 'newest at the top, as the file keeps them');
  assert.match(r.text, /## Wed 21 Oct 2026\n\n- Calls: 11 calls\n- Meetings booked: 3\n- Two referrals from Harbour Co\.\n\n## Tue 20 Oct 2026/);
  assert.ok(r.text.includes('- Quiet morning, two voicemails.'), 'every other line kept');
  // The same day again: added to, a changed value said back.
  const again = L.writeLogEntry(r.text, { date: '2026-10-21', fields: [['Calls', 12], ['Proposals sent', 1]] }, NOW);
  assert.equal(again.addedTo, true);
  assert.deepEqual(again.replaced, [{ field: 'Calls', was: '11 calls', now: '12 calls' }]);
  assert.deepEqual(again.newFields, ['Proposals sent']);
  assert.equal((again.text.match(/## Wed 21 Oct 2026/g) || []).length, 1, 'never a second heading for the same day');
  assert.match(again.text, /- Calls: 12 calls\n- Meetings booked: 3\n- Two referrals from Harbour Co\.\n- Proposals sent: 1\n\n## Tue/, 'a new field goes at the end of the day’s entry');
});

test('an entry goes at the end of a log kept oldest first, and its day count carries on', () => {
  const r = L.writeLogEntry(READING, { date: '2026-10-21', fields: [['read', 'yes'], ['pages', 18]] }, NOW);
  assert.equal(r.order, 'bottom');
  assert.equal(r.heading, 'Wed 21 Oct 2026, Day 4');
  assert.match(r.text, /- Screen-free evening: Y\n\n## Wed 21 Oct 2026, Day 4\n\n- Read: Y\n- Pages: 18\n$/);
  assert.ok(r.text.includes('Intro words the person wrote stay here.'));
  // A back-dated day goes where its date falls.
  const back = L.writeLogEntry(READING, { date: '2026-10-17', fields: [['Pages', 5]] }, NOW);
  assert.ok(back.text.indexOf('## Sat 17 Oct 2026') < back.text.indexOf('## Sun 18 Oct 2026'));
});

test('words as said become the log’s fields, whatever the topic', () => {
  const words = L.parseLogWords('check in: read yes, 18 pages, no screens, lovely quiet night');
  assert.deepEqual(words.fields, [['read', 'Y'], ['pages', '18']]);
  assert.deepEqual(words.negated, ['screens']);
  const log = L.parseLog(READING, NOW);
  const { fields, notes } = L.fieldsFromWords(words, log);
  assert.deepEqual(fields, [['Read', 'Y'], ['Pages', '18'], ['Screen-free evening', 'Y']], '"no screens" fills the log’s screen-free field');
  assert.deepEqual(notes, ['lovely quiet night']);
  // A lone number for a log with one number field.
  const lone = L.fieldsFromWords(L.parseLogWords('log 42'), log);
  assert.deepEqual(lone.fields, [['Pages', '42']]);
  // "no X" with no such field: X is N.
  assert.deepEqual(L.negatedField('calls', ['Calls']), ['Calls', 'N']);
  assert.deepEqual(L.parseLogWords('site visits 4, spend $450, mood: steady').fields, [['site visits', '4'], ['spend', '$450'], ['mood', 'steady']]);
});

test('a new log carries its number fields and the units said with them; the right one of several logs is chosen', () => {
  const text = L.newLogText({ title: 'Site visits', project: 'Cafe opening', entry: { date: '2026-10-21', fields: [['Visits', '3'], ['Drive time', '2.5 h'], ['Weather', 'wet']] } }, NOW);
  assert.match(text, /^---\ntype: log\nproject: "Cafe opening"\nfields: \[Visits, Drive time\]\nunits: \{Drive time: h\}\n---\n# Site visits\n/);
  assert.match(text, /## Wed 21 Oct 2026\n\n- Visits: 3\n- Drive time: 2\.5 h\n- Weather: wet\n$/);
  const logs = [{ path: 'a.md', text: SALES, mtime: 2 }, { path: 'b.md', text: READING, mtime: 1 }];
  assert.equal(L.chooseLog(logs, ['pages'], NOW).path, 'b.md', 'by the fields it shares');
  assert.equal(L.chooseLog(logs, ['something new'], NOW).path, 'a.md', 'else the newest');
  assert.equal(L.chooseLog([{ path: 'only.md', text: READING }], ['anything'], NOW).path, 'only.md', 'one log: that one, never a second');
});

const PROGRAMME = `---
type: project
status: active
layout: programme
sponsor: Dana Lee
---
# Data migration

## Summary

Move the finance data to the new platform.

## Key dates

| When | What | Status |
| --- | --- | --- |
| 2026-11-02 | Dry run | next |
| 2026-12-07 | Cut-over | |

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Data cleansing | Priya | on track | 60% | Dedupe suppliers |

## Notes

My own words.
`;

test('rows go into a table by its own columns; the same row is updated, never doubled', () => {
  const r = L.addTableRow(PROGRAMME, 'workstreams', { workstream: 'Reporting', who: 'Sam', progress: 40, 'next step': 'Map the GL codes' }, { today: NOW });
  assert.equal(r.action, 'added');
  assert.match(r.text, /\| Data cleansing \| Priya \| on track \| 60% \| Dedupe suppliers \|\n\| Reporting \| Sam \|   \| 40% \| Map the GL codes \|\n/);
  const up = L.addTableRow(r.text, 'Workstreams', { Workstream: 'reporting', Status: 'at risk' }, { today: NOW });
  assert.equal(up.action, 'updated');
  assert.match(up.text, /\| Reporting \| Sam \| at risk \| 40% \| Map the GL codes \|/);
  assert.equal((up.text.match(/Reporting/g) || []).length, 1);
  // A key date in date order, in a table headed When/What (the other names of Date/Milestone).
  const d = L.addTableRow(PROGRAMME, 'Key dates', { Date: '20 Nov 2026', Milestone: 'User testing' }, { today: NOW });
  assert.match(d.text, /\| 2026-11-02 \| Dry run \| next \|\n\| 2026-11-20 \| User testing \|   \|\n\| 2026-12-07 \| Cut-over \|/);
  // A cell with no column and no Notes column is refused with the columns, never dropped.
  assert.throws(() => L.addTableRow(PROGRAMME, 'Workstreams', { Workstream: 'X', Budget: '$5k' }), /no column for Budget\. Its columns: Workstream, Owner, Status, Progress, Next step/);
  // A section that isn't there is made with the layout's columns; a cell with no column goes in Notes.
  const p = L.addTableRow(PROGRAMME, 'Suppliers and contacts', { Name: 'Kim Ng', Company: 'Ledgerly', Phone: '0400 000 000' }, { today: NOW });
  assert.ok(p.madeSection);
  assert.match(p.text, /## Suppliers and contacts\n\n\| Name \| Role \| Company \| Contact \|\n\| --- \| --- \| --- \| --- \|\n\| Kim Ng \|   \| Ledgerly \| 0400 000 000 \|\n/);
  assert.equal(L.addTableRow(PROGRAMME, 'Pipeline', { Item: 'Upsell', Owner: 'Jo', Extra: 'yes' }).row[4], 'Extra: yes', 'Pipeline has Notes: the extra goes there');
  assert.ok(p.text.includes('My own words.'));
});

test('a layout adds only what is missing; blocks compose one when no preset fits', () => {
  const plain = '---\ntype: project\nstatus: planning\n---\n# Cafe opening\n\n## Summary\n\nA new cafe in the city.\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n';
  const r = L.setLayout(plain, 'site', { go_live: '10 Jan 2027', site_kind: 'opening', address: '1 Main St', colour: 'blue' });
  assert.deepEqual(r.added, ['Run sheet', 'Suppliers and contacts'], 'Key dates was already there');
  assert.deepEqual(r.ignored, ['colour']);
  assert.match(r.text, /^---\ntype: project\nstatus: planning\nlayout: site\ngo_live: 2027-01-10\nsite_kind: opening\naddress: 1 Main St\n---\n/);
  assert.match(r.text, /## Run sheet\n\n### Eight weeks out\n\n### Build week\n\n### Go-live day\n\n### After\n/);
  assert.equal(L.setLayout(r.text, 'site', {}).text, r.text, 'the same again changes nothing');
  assert.throws(() => L.setLayout(plain, 'kanban'), /no layout called/);
  const b = L.setLayout(plain, null, { go_live: '2026-12-01' }, ['countdown', 'trend:Visits', 'bogus', 'streak']);
  assert.deepEqual(b.blocks, ['countdown', 'trend:Visits', 'streak']);
  assert.match(b.text, /blocks:\n {2}- countdown\n {2}- trend:Visits\n {2}- streak\ngo_live: 2026-12-01\n/);
  // The layouts' other names, and keys any layout may take from the shape (a start and target for a field).
  const t = L.setLayout(plain, 'tracker', { start_visits: '3', target_visits: 12, visits_per_week: '4' });
  assert.match(t.text, /layout: fitness\nstart_visits: 3\ntarget_visits: 12\nvisits_per_week: 4\n/);
  assert.doesNotMatch(b.text, /layout:/);
});

test('a rewrite that drops a number, date, link or property is caught', () => {
  const beforeText = `---\ntype: project\nowner: Dana\n---\n# Data migration\n\nBudget A$120,000. Dry run 2 Nov 2026, cut-over 2026-12-07. See [[Finance platform]] and https://example.com/plan.\n`;
  const good = `---\ntype: project\nowner: Dana\nlayout: programme\n---\n# Data migration\n\n## Summary\n\nBudget A$120,000. See [[Finance platform]] and [the plan](https://example.com/plan).\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 2026-11-02 | Dry run | |\n| 7 Dec 2026 | Cut-over | |\n`;
  assert.deepEqual(L.missingFacts(beforeText, good), []);
  const bad = good.replace('A$120,000', 'a budget').replace('| 7 Dec 2026 | Cut-over | |\n', '').replace('owner: Dana\n', '').replace('[[Finance platform]]', 'the platform');
  assert.deepEqual(L.missingFacts(beforeText, bad), ['the date 2026-12-07', 'the number 120000', 'the link [[finance platform]]', 'the property owner']);
});

/** Notes in memory, indexed as the app indexes them (as tests/agent.test.mjs does). */
function fakeHost(notes) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  let tick = 1;
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), tick++, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    write: async (rel, text) => {
      files.set(rel, text);
      reindex(rel);
    },
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async (rel) => {
      files.delete(rel);
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Wednesday 21 October 2026 (2026-10-21)',
    now: () => NOW,
  };
  return { host, files };
}
const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

const SALES_PROJECT = '---\ntype: project\nstatus: active\n---\n# Northside sales\n\n## Summary\n\nNew accounts in the north.\n';
const READING_PROJECT = '---\ntype: project\nstatus: active\nlayout: wellbeing\nstreak_start: 2026-10-18\n---\n# Reading habit\n\n## Summary\n\nRead every night.\n';

test('the assistant logs into the project’s own log, makes one only when there is none, and Undo takes it back', async () => {
  const { host, files } = fakeHost({
    'Projects/Northside sales/Northside sales.md': SALES_PROJECT,
    'Projects/Northside sales/Sales calls.md': SALES,
    'Projects/Reading habit/Reading habit.md': READING_PROJECT,
    'Projects/Reading habit/Reading log.md': READING,
    'Projects/Cafe opening/Cafe opening.md': '---\ntype: project\n---\n# Cafe opening\n\n## Summary\n\nA new cafe.\n',
  });
  const tools = new M.AgentTools(host, [], () => {});
  const r = await run(tools, 'log_entry', { project: 'Northside sales', text: 'calls 11, meetings 3' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /Logged in Projects\/Northside sales\/Sales calls\.md under “Wed 21 Oct 2026”: Calls: 11 calls; Meetings booked: 3\./);
  assert.match(files.get('Projects/Northside sales/Sales calls.md'), /# Sales calls\n\n## Wed 21 Oct 2026\n\n- Calls: 11 calls/);
  const read = await run(tools, 'log_entry', { project: 'reading', fields: { Read: true, Pages: 12 }, notes: ['Started a new book'] });
  assert.match(read.text, /under “Wed 21 Oct 2026, Day 4”/);
  assert.match(files.get('Projects/Reading habit/Reading log.md'), /## Wed 21 Oct 2026, Day 4\n\n- Read: Y\n- Pages: 12\n- Started a new book\n$/);
  // No log yet: one is made beside the project, and the next entry goes in it (never a second).
  const made = await run(tools, 'log_entry', { project: 'Cafe opening', name: 'Site visits', fields: { Visits: 2, Contractors: 5 } });
  assert.match(made.text, /had no log, so Projects\/Cafe opening\/Site visits\.md was made/);
  assert.match(files.get('Projects/Cafe opening/Site visits.md'), /^---\ntype: log\nproject: "Cafe opening"\nfields: \[Visits, Contractors\]\n---/);
  const next = await run(tools, 'log_entry', { project: 'Cafe opening', date: 'yesterday', fields: { visits: 1 } });
  assert.match(next.text, /Logged in Projects\/Cafe opening\/Site visits\.md under “Tue 20 Oct 2026”/);
  assert.equal([...files.keys()].filter((k) => k.startsWith('Projects/Cafe opening/')).length, 2);
  await M.undoChanges(host, tools.changes);
  assert.equal(files.get('Projects/Northside sales/Sales calls.md'), SALES);
  assert.equal(files.get('Projects/Reading habit/Reading log.md'), READING);
  assert.ok(!files.has('Projects/Cafe opening/Site visits.md'));
  assert.equal((await run(tools, 'log_entry', { project: 'Nope', fields: { A: 1 } })).isError, true);
});

test('rows and layouts through the assistant; a question changes nothing', async () => {
  const { host, files } = fakeHost({ 'Projects/Data migration/Data migration.md': PROGRAMME, 'Private notes/Secret project.md': '---\ntype: project\n---\n# Secret project\n' });
  const tools = new M.AgentTools(host, [], () => {}, 'Projects/Data migration/Data migration.md');
  const row = await run(tools, 'add_row', { section: 'Workstreams', cells: { Workstream: 'Reporting', Owner: 'Sam', Progress: '40%' } });
  assert.match(row.text, /Added the row “Reporting” in Data migration’s Workstreams/);
  const lay = await run(tools, 'set_layout', { project: 'Data migration', layout: 'programme', keys: { budget: 'A$120k capex', phase: 'Build' } });
  assert.match(lay.text, /Set budget, phase\. Added the empty sections Risks and issues/);
  assert.match(files.get('Projects/Data migration/Data migration.md'), /layout: programme\nsponsor: Dana Lee\nbudget: A\$120k capex\nphase: Build\n/);
  assert.equal((await run(tools, 'set_layout', { project: 'Secret project', layout: 'site' })).isError, true, 'a private note is never a project the assistant reaches');
});

test('a project put into its layout keeps every fact and waits for the person', async () => {
  const messy = `---\ntype: project\nstatus: active\n---\n# Cafe opening\n\nOpening 2027-01-10 at 1 Main St. Fit-out budget $85,000.\n\n- Signage from [[Brightsign]] due 12 Dec 2026\n- Hire 6 staff\n\n## Notes\n\nCall the landlord about parking.\n`;
  const { host, files } = fakeHost({ 'Projects/Cafe opening/Cafe opening.md': messy });
  const tools = new M.AgentTools(host, [], () => {});
  const lossy = `---\ntype: project\nstatus: active\n---\n# Cafe opening\n\n## Summary\n\nA new cafe at 1 Main St.\n\n## Notes\n\nCall the landlord about parking.\n`;
  const no = await run(tools, 'reorganise_project', { project: 'Cafe opening', layout: 'site', content: lossy });
  assert.equal(no.isError, true);
  assert.match(no.text, /lost \d+ facts: .*the date 2027-01-10.*the number 85000.*the link \[\[brightsign\]\]/);
  assert.equal(tools.proposals.length, 0);
  const tidy = `---\ntype: project\nstatus: active\ngo_live: 2027-01-10\naddress: 1 Main St\n---\n# Cafe opening\n\n## Summary\n\nA new cafe at 1 Main St. Fit-out budget $85,000.\n\n## Run sheet\n\n### Eight weeks out\n\n- [ ] Hire 6 staff\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 2026-12-12 | Signage from [[Brightsign]] | next |\n| 2027-01-10 | Opening | |\n\n## Notes\n\nCall the landlord about parking.\n`;
  const yes = await run(tools, 'reorganise_project', { project: 'Cafe opening', layout: 'site', content: tidy });
  assert.equal(yes.isError, undefined, yes.text);
  assert.match(yes.text, /Shown to the person to accept/);
  assert.equal(files.get('Projects/Cafe opening/Cafe opening.md'), messy, 'nothing written before they accept');
  const offer = tools.proposals[0];
  assert.match(offer.after, /layout: site/);
  assert.match(offer.after, /## Suppliers and contacts/, 'the layout’s missing section added');
  assert.deepEqual(offer.changes.slice(0, 1), ['Laid out as a site']);
  const notesGone = tidy.replace('Call the landlord about parking.', 'Parking.');
  assert.match((await run(tools, 'reorganise_project', { project: 'Cafe opening', content: notesGone })).text, /the Notes section word for word/);
});

test('the assistant is told about layouts by shape, never by topic', () => {
  const guide = L.layoutsGuide();
  assert.match(guide, /STRUCTURE of the information/);
  assert.match(guide, /trend:<field>/);
  assert.match(guide, /Never lose information when reorganising: move it/);
  assert.match(guide, /never make a second log for the same thing/i);
  const system = M.agentSystem(null, 'today', null, []);
  assert.ok(system.includes('Project layouts (21 Oct 2026)'));
  for (const word of ['weigh-in', 'alcohol', 'drink', 'urge', 'Win11', 'toe']) assert.doesNotMatch(guide, new RegExp(word, 'i'));
});
