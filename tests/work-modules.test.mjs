// node --test tests/work-modules.test.mjs — Weekly Updates and Meetings (Wave 6 part b): a week's note read and written
// back exactly (src/shared/weekly-updates.ts), an older long note of updates brought in with every fact kept, the next
// week started from the last, the page's changes, workstream history and trends, the plain text, Word and printed
// exports; meetings read from their notes (src/shared/work-meetings.ts) with agendas, decisions and actions, series,
// transcripts in every common shape; and the main side (src/main/work-modules.ts, src/main/work/weekly.ts, meetings.ts)
// through a real vault index and agent gates: actions carried into a project once and ticked in both places, a
// transcript written up, the prep pack, progress and risks written into the project, notices said once, nothing when off.
// Made-up people and work only; a fixed day (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-workmod-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['weekly-updates', 'work-meetings', 'work-modules', 'module-records', 'module-tools', 'life-modules', 'sensitivity', 'project-file'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`, `export { docxText } from ${JSON.stringify(path.join(root, 'src/main/doc-text.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Weekly Updates ───────────────────────────────────────────────────────────────────────────────────────────────────

const LONG_NOTE = `---
type: doc
about: Weekly status updates to Sam Lee, newest first.
---
# Weekly Updates

## Week of 19 October 2026 (prepared Wed 21 Oct)

Source: figures from the seed list export of 21 Oct 2026.

### 1. Studio Relocation
Status: Planned. Onsite Thursday, gear in the van, back Friday.

Blockers / Risks: None

### 2. Spring Festival
Status: On track
- 6x marquees have landed with the vendor.
- One support person locked in.
  Interviews for the second start next week.

Blockers / Risks: None currently

### 3. Seed Library
Status: Working through the last packets

| Measure | Count |
|---|---|
| In scope | 1,047 |
| Catalogued | 1,009 |
| % of scope | 96.4% |

Outstanding by shelf: Top 12, Bottom 9, (blank) 4.

Blockers / Risks: A few packets have no label; asked the donors for help.

### Attachments
- Seed_Count.xlsx

[[Files/Seed_Count.xlsx|Seed_Count.xlsx]] — seed count workbook, 21 Oct export

## Week of 12 October 2026

### 1. Seed Library
Status: At risk
- Labels fixed for the new packets.

| Measure | Count |
|---|---|
| In scope | 1,050 |
| Catalogued | 980 |
| % of scope | 93.3% |

Blockers / Risks: Donations low.
`;

test('a week’s note reads and writes back exactly, and numbers stay numbers', () => {
  const W = S.weeklyUpdates;
  assert.deepEqual(W.readMetricValue('1,047'), { value: 1047, unit: '' });
  assert.deepEqual(W.readMetricValue('96.4%'), { value: 96.4, unit: '%' });
  assert.deepEqual(W.readMetricValue('$12.5k'), { value: 12500, unit: '$' });
  assert.deepEqual(W.readMetricValue('lots'), { value: null, unit: '' });
  assert.equal(W.metricWords({ value: 1047, unit: '' }), '1,047');
  assert.equal(W.metricWords({ value: 96.4, unit: '%' }), '96.4%');
  assert.equal(W.mondayOf('2026-10-24'), '2026-10-19');
  assert.equal(W.readDayWords('2026-10-19'), '2026-10-19');
  assert.equal(W.readDayWords('2026-13-45'), null, 'a day that is not there is no day');
  assert.equal(W.readDayWords('30 February 2026'), null, '30 February is no day');
  const u = W.newWeekly('2026-10-21', null, { audience: 'Sam Lee' });
  W.applyWeeklyEdit(u, { kind: 'add-section', name: 'Studio Relocation', project: 'Harbour Studio' });
  W.applyWeeklyEdit(u, { kind: 'section', section: 0, field: 'flag', value: 'At risk' });
  W.applyWeeklyEdit(u, { kind: 'section', section: 0, field: 'status', value: 'Hardware late' });
  W.applyWeeklyEdit(u, { kind: 'add-item', section: 0, list: 'progress', text: 'Racks delivered' });
  W.applyWeeklyEdit(u, { kind: 'add-item', section: 0, list: 'blockers', text: 'Switch on back order' });
  W.applyWeeklyEdit(u, { kind: 'metric', section: 0, name: 'Points live', value: 42, unit: '' });
  W.applyWeeklyEdit(u, { kind: 'metric', section: 0, name: 'Top', value: 3, group: 'By floor' });
  const text = W.writeWeekly({ ...u, path: 'Work/Weekly Updates/Weekly update 2026-10-19.md' });
  assert.match(text, /^---\ntype: weekly-update\nweek: 2026-10-19\naudience: Sam Lee\nstatus: Draft/);
  assert.match(text, /## Studio Relocation\nProject: \[\[Harbour Studio\]\]\nFlag: At risk\nStatus: Hardware late/);
  assert.match(text, /\| Points live \| 42 \|  \|  \|/);
  const back = W.readWeekly('Work/Weekly Updates/Weekly update 2026-10-19.md', text);
  assert.deepEqual(back, { ...u, path: 'Work/Weekly Updates/Weekly update 2026-10-19.md' }, 'read back exactly');
  assert.equal(W.writeWeekly(back, text), text, 'written again: the same bytes');
  // The person's own properties stay as written.
  const own = text.replace('status: Draft', 'status: Draft\ntags: [team]');
  assert.match(W.writeWeekly(W.readWeekly('x.md', own), own), /tags: \[team\]/);
  // A hand-edited note: bold keys, "Risks:" inline and a stray paragraph are all kept.
  const hand = W.readWeekly('x.md', '---\ntype: weekly-update\nweek: 2026-10-19\n---\n## Garden\n**Status:** Seeds in\nA note to self.\n- Watered\nRisks: frost\n');
  assert.equal(hand.sections[0].status, 'Seeds in');
  assert.deepEqual(hand.sections[0].progress, ['Watered']);
  assert.deepEqual(hand.sections[0].blockers, ['frost']);
  assert.equal(hand.sections[0].notes, 'A note to self.');
  assert.throws(() => W.applyWeeklyEdit(back, { kind: 'add-section', name: 'studio relocation' }), /already/);
  assert.throws(() => W.applyWeeklyEdit(back, { kind: 'add-section', name: 'Studio Relokation' }), /Studio Relocation/, 'a near-miss is a typo until proven otherwise');
  assert.throws(() => W.applyWeeklyEdit(back, { kind: 'metric', section: 0, name: 'X', value: Number.NaN }), /number/);
});

test('an older long note of updates comes in one week each, every fact kept, and the next week starts from the last', () => {
  const W = S.weeklyUpdates;
  assert.equal(W.looksLikeWeeklyNote(LONG_NOTE), true);
  assert.equal(W.audienceFrom({ about: 'Weekly status updates to Sam Lee, newest first.' }), 'Sam Lee');
  const weeks = W.importWeeklyNote(LONG_NOTE, { year: 2026, audience: 'Sam Lee', thisWeek: '2026-10-19' });
  assert.deepEqual(weeks.map((w) => w.week), ['2026-10-19', '2026-10-12']);
  const [now, before] = weeks.map((w) => w.update);
  assert.equal(now.prepared, '2026-10-21');
  assert.equal(now.status, 'Draft', 'this week is a draft');
  assert.equal(before.status, 'Sent', 'an earlier week was sent');
  assert.equal(now.intro, 'Source: figures from the seed list export of 21 Oct 2026.');
  assert.deepEqual(now.sections.map((s) => s.name), ['Studio Relocation', 'Spring Festival', 'Seed Library']);
  assert.equal(now.sections[0].status, 'Planned. Onsite Thursday, gear in the van, back Friday.');
  assert.equal(now.sections[0].none, true);
  assert.equal(now.sections[1].flag, 'On track');
  assert.deepEqual(now.sections[1].progress, ['6x marquees have landed with the vendor.', 'One support person locked in. Interviews for the second start next week.']);
  assert.equal(now.sections[1].noneWords, 'None currently');
  const lr = now.sections[2];
  assert.deepEqual(lr.metrics.map((m) => [m.name, m.value, m.unit, m.group]), [['In scope', 1047, '', ''], ['Catalogued', 1009, '', ''], ['% of scope', 96.4, '%', ''], ['Top', 12, '', 'Outstanding by shelf'], ['Bottom', 9, '', 'Outstanding by shelf'], ['(blank)', 4, '', 'Outstanding by shelf']]);
  assert.deepEqual(lr.blockers, ["A few packets have no label; asked the donors for help."]);
  assert.deepEqual(now.attachments, [{ link: 'Files/Seed_Count.xlsx', name: 'Seed_Count.xlsx', what: 'seed count workbook, 21 Oct export' }]);
  // Every line of the original survives in the records (words, or numbers equal to what was written).
  const written = weeks.map((w) => W.writeWeekly({ ...w.update, path: 'x.md' })).join('\n');
  for (const line of LONG_NOTE.split('\n').slice(6)) {
    const t = line.replace(/^#+\s*(\d+\.\s*)?/, '').replace(/^Status:\s*|^Blockers \/ Risks:\s*|^-\s+/, '').trim();
    if (!t || /^\|[-|]+\|$/.test(t) || /^(Week of|Attachments|\| Measure)/.test(t)) continue;
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(t);
    if (row) {
      const v = W.readMetricValue(row[2]).value;
      assert.ok(weeks.some((w) => w.update.sections.some((s) => s.metrics.some((m) => m.name === row[1] && m.value === v))), `${row[1]} = ${row[2]} kept as a number`);
      continue;
    }
    const g = W.readGroupLine(t);
    if (g) {
      for (const m of g) assert.ok(lr.metrics.some((x) => x.group === m.group && x.name === m.name && x.value === m.value), `${m.group}: ${m.name} kept`);
      continue;
    }
    const flat = written.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\n\s*/g, ' ');
    for (const piece of t.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/, '$1').split(/\s{2,}/)) assert.ok(flat.includes(piece.trim()), `kept: ${piece}`);
  }
  // Next week from this one: workstreams, projects, flags, status lines, next steps, blockers and measures carried; no
  // progress yet; numbers to fill; a Done workstream left behind.
  now.sections[0].flag = 'Done';
  const next = W.newWeekly('2026-10-26', now);
  assert.deepEqual(next.sections.map((s) => s.name), ['Spring Festival', 'Seed Library']);
  assert.deepEqual(next.sections[0].progress, []);
  assert.equal(next.sections[1].status, 'Working through the last packets');
  assert.ok(next.sections[1].metrics.every((m) => m.value === null) && next.sections[1].metrics.length === 6);
  assert.equal(next.audience, 'Sam Lee');
});

test('history per workstream with trends, due on its day, and the update as text, Word and a printed page', async () => {
  const W = S.weeklyUpdates;
  const weeks = W.importWeeklyNote(LONG_NOTE, { year: 2026, audience: 'Sam Lee', thisWeek: '2026-10-19' }).map((w, i) => ({ ...w.update, path: `W/${i}.md` }));
  const m = W.weeklyModel(weeks, TODAY, 3);
  assert.equal(m.thisWeek, '2026-10-19');
  assert.equal(m.current.path, 'W/0.md');
  assert.equal(m.last.path, 'W/1.md');
  assert.deepEqual(m.due, { state: 'draft', dueDay: '2026-10-22', overdue: true, dueToday: false }, 'due Thursday, a draft on Saturday is overdue');
  const lr = m.workstreams.find((h) => h.key === 'seed library');
  assert.deepEqual(lr.weeks.map((p) => [p.week, p.flag]), [['2026-10-12', 'At risk'], ['2026-10-19', '']]);
  assert.deepEqual(lr.metrics.find((s) => s.name === '% of scope').points, [{ week: '2026-10-12', value: 93.3 }, { week: '2026-10-19', value: 96.4 }]);
  weeks[0].status = 'Sent';
  assert.equal(W.weeklyModel(weeks, TODAY, 3).due.state, 'sent');
  // Plain text, as sent.
  const text = W.weeklyText(weeks[0]);
  assert.match(text, /^Week of 19 October 2026\n\n1\. Studio Relocation\nStatus: Planned\. Onsite Thursday/);
  assert.match(text, /2\. Spring Festival\nStatus: On track\n- 6x marquees have landed/);
  assert.match(text, /In scope: 1,047\nCatalogued: 1,009\n% of scope: 96\.4%\nOutstanding by shelf: Top 12, Bottom 9, \(blank\) 4\./);
  assert.match(text, /Blockers \/ Risks: None currently/);
  assert.match(text, /Attachments:\n- Seed_Count\.xlsx \(seed count workbook, 21 Oct export\)/);
  // Word: a real .docx (read back by Ironleaf's own reader), in the brand kit's colour.
  const docx = W.weeklyDocx(weeks[0], { name: 'Harbour Studio', colour: '#0f766e', font: 'Inter' });
  const words = await M.docxText(Buffer.from(docx));
  for (const t of ['Harbour Studio', 'Week of 19 October 2026', '3. Seed Library', 'In scope', '1,047', 'Blockers / Risks:', 'None currently']) assert.ok(words.includes(t), `docx holds ${t}`);
  // The page printed to PDF: escaped, in the brand colour.
  const html = W.weeklyHtml({ ...weeks[0], sections: [{ ...weeks[0].sections[0], name: 'A <b>bold</b> move' }] }, { colour: '#0f766e' });
  assert.match(html, /A &lt;b&gt;bold&lt;\/b&gt; move/);
  assert.match(html, /color:#0f766e/);
  // A workstream's project, surely or not at all.
  const projects = [{ path: 'P/Harbour Studio Relocation.md', name: 'Harbour Studio Relocation' }, { path: 'P/Spring Festival North.md', name: 'Spring Festival North' }, { path: 'P/Spring Festival South.md', name: 'Spring Festival South' }];
  assert.equal(W.sureProject('Studio Relocation', projects), 'Harbour Studio Relocation');
  assert.equal(W.sureProject('Seed Library', [{ path: 'P/Seed Library (Front Back)/Seed Library (Front Back).md', name: 'Seed Library (Front/Back)' }]), 'Seed Library (Front Back)', 'linked by its file’s name, never a slash');
  assert.equal(W.sureProject('Spring Festival', projects), '', 'two equally likely: never a guess');
  assert.equal(W.suggestProjects('SF 2027', [{ path: 'a', name: 'Spring Festival 2027' }])[0].name, 'Spring Festival 2027', 'initials count');
});

// ── Meetings ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MEETING = `---
type: meeting
date: 2026-10-27
project: "[[Harbour Fit-out]]"
series: "[[Fit-out sync]]"
---
**When:** Tuesday 27 October 2026, 10:00 AM to 11:00 AM
**Where:** Site office
**Who is invited:** Priya Shah, Sam Okafor and Lee Wong; others on copy.

## Agenda
- [ ] Racks delivery date
- [x] Budget sign-off

## Decisions
- Go with the two-rack layout

## Actions
- [ ] Send the floor plan — Sam Okafor · by 30 Oct 2026
- [x] Book the electrician — Priya Shah
- [ ] Order cable trays → [[Harbour Fit-out]]
`;

test('a meeting reads into its agenda, attendees, decisions and actions; series come round', () => {
  const X = S.workMeetings;
  const m = X.readMeeting({ path: 'Work/Meetings/2026-10-27 Fit-out sync.md', title: '2026-10-27 Fit-out sync', props: X.meetingProps(MEETING), content: MEETING }, ['Sam Okafor', 'Priya Shah']);
  assert.equal(m.date, '2026-10-27');
  assert.equal(m.time, '10:00 AM');
  assert.equal(m.where, 'Site office');
  assert.deepEqual(m.people, ['Priya Shah', 'Sam Okafor', 'Lee Wong']);
  assert.equal(m.project, 'Harbour Fit-out');
  assert.equal(m.series, 'Fit-out sync');
  assert.deepEqual(m.agenda.map((a) => [a.text, a.done]), [['Racks delivery date', false], ['Budget sign-off', true]]);
  assert.deepEqual(m.decisions.map((d) => d.text), ['Go with the two-rack layout']);
  assert.deepEqual(m.actions.map((a) => [a.what, a.who ?? '', a.due ?? '', a.done, a.filedTo ?? '']), [['Send the floor plan', 'Sam Okafor', '2026-10-30', false, ''], ['Book the electrician', 'Priya Shah', '', true, ''], ['Order cable trays', '', '', false, 'Harbour Fit-out']]);
  // The model: upcoming, and the one action still to carry into its project.
  const series = { path: 'Work/Meetings/Series/Fit-out sync.md', title: 'Fit-out sync', props: { type: 'meeting-series', cadence: 'Weekly', day: 'Tuesday', time: '10:00 AM' }, content: '## Standing agenda\n\n- Safety\n- Programme\n', type: 'meeting-series' };
  const past = { path: 'Work/Meetings/2026-10-20 Fit-out sync.md', title: '2026-10-20 Fit-out sync', props: { type: 'meeting', date: '2026-10-20', series: '[[Fit-out sync]]', project: '[[Harbour Fit-out]]' }, content: '## Actions\n\n- [ ] Chase the landlord — Lee Wong\n' };
  const mm = X.meetingsModel([{ path: m.path, title: m.title, props: X.meetingProps(MEETING), content: MEETING }, series, past], TODAY, { known: ['Sam Okafor'] });
  assert.deepEqual(mm.upcoming.map((x) => x.date), ['2026-10-27']);
  assert.deepEqual(mm.recent.map((x) => x.date), ['2026-10-20']);
  assert.equal('toFile' in mm, false, 'nothing to carry: a meeting in a project has its actions as its tasks');
  assert.deepEqual(mm.series[0].standing, ['Safety', 'Programme']);
  assert.equal(mm.series[0].next, '2026-10-27', 'its next is the one already in the diary');
  assert.equal(X.nextOfSeries({ cadence: 'Weekly', day: 1 }, '2026-10-24', null), '2026-10-27');
  assert.equal(X.nextOfSeries({ cadence: 'Fortnightly', day: 1 }, '2026-10-24', '2026-10-20'), '2026-11-03');
  assert.equal(X.nextOfSeries({ cadence: 'Monthly', day: -1 }, '2026-10-24', '2026-09-29'), '2026-10-29');
  assert.equal(X.nextOfSeries({ cadence: 'Ad hoc', day: -1 }, '2026-10-24', '2026-09-29'), null);
  // A new meeting's note reads back as itself; lines added to sections land in them; a tick lands on its own line.
  const fresh = X.newMeetingText({ title: 'Kick-off', date: '2026-10-28', time: '9:00 AM', attendees: ['Priya Shah'], project: 'Harbour Fit-out', agenda: ['Scope'], carried: ['Follow up: Chase the landlord'] });
  const r = X.readMeeting({ path: 'Work/Meetings/2026-10-28 Kick-off.md', title: '2026-10-28 Kick-off', props: X.meetingProps(fresh), content: fresh });
  assert.deepEqual([r.date, r.time, r.people, r.project, r.agenda.map((a) => a.text)], ['2026-10-28', '9:00 AM', ['Priya Shah'], 'Harbour Fit-out', ['Scope', 'Follow up: Chase the landlord']]);
  const withAction = X.addToSection(fresh, X.ACTIONS_HEADING, 'Actions', '- [ ] Draw the plan');
  assert.match(withAction, /## Actions\n\n- \[ \] Draw the plan\n*$/);
  const withDecision = X.addToSection(fresh, X.DECISIONS_HEADING, 'Decisions', '- Two racks');
  assert.match(withDecision, /## Decisions\n\n- Two racks\n/);
  const line = MEETING.split('\n').findIndex((l) => l.startsWith('- [ ] Racks'));
  assert.match(X.setTick(MEETING, line, '- [ ] Racks delivery date', true), /- \[x\] Racks delivery date/);
  assert.throws(() => X.setTick(MEETING, line, '- [ ] Something else', true), /changed/);
  assert.equal(X.findMeeting(mm.meetings, 'fit-out sync 2026-10-20', mm.today).date, '2026-10-20');
  assert.equal(X.findMeeting(mm.meetings, '', mm.today).date, '2026-10-27', 'nothing named: the next one');
});

test('a transcript reads in every common shape', () => {
  const X = S.workMeetings;
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Priya Shah>Morning all.</v>\n\n00:00:04.500 --> 00:00:06.000\n<v Priya Shah>Racks first.</v>\n\n00:00:07.000 --> 00:00:09.000\n<v Sam Okafor>They land Thursday.</v>\n';
  assert.deepEqual(X.readTranscriptText(vtt), [{ at: 1, who: 'Priya Shah', text: 'Morning all. Racks first.' }, { at: 7, who: 'Sam Okafor', text: 'They land Thursday.' }]);
  const srt = '1\n00:01:02,000 --> 00:01:04,000\nSam Okafor: Plans are drawn.\n\n2\n00:01:05,000 --> 00:01:07,000\nPriya Shah: Good.\n';
  assert.deepEqual(X.readTranscriptText(srt).map((l) => [l.at, l.who, l.text]), [[62, 'Sam Okafor', 'Plans are drawn.'], [65, 'Priya Shah', 'Good.']]);
  const teams = 'Priya Shah   0:03\nMorning all.\nSam Okafor   1:02\nThey land Thursday.\n';
  assert.deepEqual(X.readTranscriptText(teams).map((l) => [l.at, l.who, l.text]), [[3, 'Priya Shah', 'Morning all.'], [62, 'Sam Okafor', 'They land Thursday.']]);
  const bracket = '[00:01:02] Sam Okafor: Plans are drawn.\n[00:02:00] Lee Wong: Landlord replied.\n';
  assert.deepEqual(X.readTranscriptText(bracket).map((l) => [l.at, l.who]), [[62, 'Sam Okafor'], [120, 'Lee Wong']]);
  const plain = 'Priya Shah: Morning all.\nSam Okafor: They land Thursday.\nAnd the trays after.\n';
  assert.deepEqual(X.readTranscriptText(plain).map((l) => [l.who, l.text]), [['Priya Shah', 'Morning all.'], ['Sam Okafor', 'They land Thursday. And the trays after.']]);
  assert.deepEqual(X.readTranscriptText('   \n\n'), []);
  assert.ok(X.transcriptSeconds(X.readTranscriptText(bracket)) >= 120);
});

// ── The main side ────────────────────────────────────────────────────────────────────────────────────────────────────

const PROJECT = `---
type: project
status: active
health: on track
owner: Alex Example
due: 2026-12-18
---
# Harbour Fit-out

## Summary
Fit out the new shop.

## What’s next
- [ ] Order cable trays
- [ ] Sign the lease — Lee Wong

## Risks and issues
- Landlord slow to reply

## Updates
- 20 Oct 2026 — Plans drawn
`;

function setup(files, switches, now = TODAY, extra = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const index = new M.VaultIndex();
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
    if (rel.endsWith('.md')) index.set(rel, text, TODAY.getTime(), text.length);
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  const P = S.projectFile;
  const posted = [];
  let ask = async () => ({ reply: null, error: 'No model is set up yet.' });
  const sw = { value: switches };
  const w = new M.WorkModules({
    vault: () => ({ root: dir, any: async (rel) => existsSync(path.join(dir, rel)) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: sw.value }),
    writeNote: async (rel, text) => put(rel, text),
    importFiles: async (paths, folder) => paths.map((p) => {
      const rel = `${folder}/${path.basename(p)}`;
      put(rel, readFileSync(p, 'utf8'));
      return rel;
    }),
    pickFiles: async () => [],
    saveFile: async (o) => {
      const f = path.join(dir, `${o.name}.${o.ext}`);
      writeFileSync(f, typeof o.data === 'string' ? o.data : Buffer.from(o.data));
      return f;
    },
    post: (items) => {
      const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
      posted.push(...fresh);
      return fresh.length;
    },
    editProject: async (rel, edit) => {
      const before = index.content(rel);
      const p = P.parseProject(before, rel);
      const words = (Array.isArray(edit) ? edit : [edit]).map((e) => P.applyProjectEdit(p, e, '24 Oct 2026'));
      put(rel, P.serializeProject(p, before));
      return { words: words.join(' ') };
    },
    projects: () => index.allMeta().filter((m) => m.props?.type === 'project').map((m) => ({ path: m.path, name: m.title })),
    records: (ix) => (ix ?? index).records({ templatesFolder: 'Templates', today: '2026-10-24' }),
    askJson: (system, user) => ask(system, user),
    requireCreate: async () => {},
    now: () => now,
    ...extra,
  });
  return { dir, index, w, posted, sw, setAsk: (fn) => (ask = fn), read: (rel) => readFileSync(path.join(dir, rel), 'utf8'), write: put, op: (module, name, ...args) => w.parts.find((p) => p.id === module).ops[name](...args) };
}

const gateFor = (index, who, name, store) => {
  const L = S.sensitivity;
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (w, rel, n) => L.decide(store, w, rel, sens.level(rel), n),
    useGrant: () => false,
    allows: (w, level) => L.allows(store, w, level),
    audit: () => {},
  };
  return M.makeGate(sens, who, name);
};

test('weekly updates on the main side: started from last week, changed, written into the project, brought in, sent, said once', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const v = setup({ '.neuralvault/areas.json': areas, 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT, 'Docs/Weekly Updates.md': LONG_NOTE }, { weekly: { on: true } });
  // The long note is offered, brought in one note a week, the note itself left as it was.
  let model = await v.op('weekly', 'model');
  assert.deepEqual(model.importable.map((x) => [x.path, x.new]), [['Docs/Weekly Updates.md', 2]]);
  const plan = await v.op('weekly', 'import-plan', 'Docs/Weekly Updates.md');
  assert.equal(plan.audience, 'Sam Lee');
  const res = await v.op('weekly', 'import', 'Docs/Weekly Updates.md');
  assert.deepEqual(res.created, ['Work/Weekly Updates/Weekly update 2026-10-19.md', 'Work/Weekly Updates/Weekly update 2026-10-12.md']);
  assert.match(v.read('Work/Weekly Updates/Weekly update 2026-10-19.md'), /^---\ntype: weekly-update[\s\S]*\nsource: "\[\[Docs\/Weekly Updates\]\]"\n---\n/);
  const imported = v.read('Work/Weekly Updates/Weekly update 2026-10-19.md');
  assert.equal(S.weeklyUpdates.writeWeekly(S.weeklyUpdates.readWeekly('x.md', imported), imported), imported, 'a later save writes it back byte for byte');
  assert.equal(v.read('Docs/Weekly Updates.md'), LONG_NOTE, 'the old note is untouched');
  assert.match((await v.op('weekly', 'import', 'Docs/Weekly Updates.md')).words, /here already/, 'never twice');
  model = await v.op('weekly', 'model');
  assert.equal(model.importable.length, 0);
  assert.equal(model.current.path, 'Work/Weekly Updates/Weekly update 2026-10-19.md');
  // A change on the page: one change of the note; a progress line and a blocker written into the linked project.
  const rel = model.current.path;
  await v.op('weekly', 'edit', rel, [{ kind: 'section', section: 0, field: 'project', value: 'Harbour Fit-out' }, { kind: 'add-item', section: 0, list: 'progress', text: 'Gear in the van' }]);
  assert.match(await v.op('weekly', 'to-project', rel, 0, 'progress', 0), /Written into Harbour Fit-out’s updates/);
  assert.match(v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md'), /Gear in the van/);
  assert.match(await v.op('weekly', 'to-project', rel, 0, 'progress', 0), /already/, 'once');
  await v.op('weekly', 'edit', rel, { kind: 'add-item', section: 0, list: 'blockers', text: 'Lift booking not confirmed' });
  assert.match(await v.op('weekly', 'to-project', rel, 0, 'risk', 0), /Added to Harbour Fit-out’s risks/);
  assert.match(v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md'), /Lift booking not confirmed/);
  // The project page's tile: this week's line for the linked workstream.
  const tile = await v.op('weekly', 'project', 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md');
  assert.equal(tile.tile.title, 'Weekly updates');
  assert.match(tile.tile.rows[0].words, /^w\/c 19 Oct/);
  // Overdue on Saturday (due Thursday): said once in the bell; sent, nothing more.
  assert.equal(await v.w.check(), 1);
  assert.equal(v.posted[0].title, 'This week’s update is overdue');
  assert.equal(await v.w.check(), 0, 'said once');
  assert.match(await v.op('weekly', 'mark-sent', rel, { by: 'Alex Example' }), /marked sent/);
  assert.match(v.read(rel), /status: Sent\nsent: 2026-10-24\nsent_by: Alex Example/);
  // Next week starts from this one.
  const next = await v.op('weekly', 'create', '2026-10-28', { fromLast: true });
  assert.equal(next, 'Work/Weekly Updates/Weekly update 2026-10-26.md');
  assert.match(v.read(next), /## Spring Festival\nFlag: On track\nStatus: On track/);
  // Exports.
  assert.match(await v.op('weekly', 'export-text', rel), /^Week of 19 October 2026/);
  const docx = await v.op('weekly', 'export-word', rel, {});
  assert.ok(docx.endsWith('.docx') && readFileSync(docx).subarray(0, 2).toString() === 'PK');
});

test('weekly tools through the gate: drafted from words and numbers, read back, and refused what isn’t allowed', async () => {
  const v = setup({ 'Work/Weekly Updates/Weekly update 2026-10-12.md': S.weeklyUpdates.writeWeekly({ ...S.weeklyUpdates.newWeekly('2026-10-12'), sections: [{ name: 'Seed Library', project: '', flag: 'At risk', status: 'Donations low', progress: [], next: ['Order more'], blockers: [], none: false, noneWords: '', metrics: [{ name: '% of scope', value: 93.3, unit: '%', group: '' }], notes: '' }] }) }, { weekly: { on: true } });
  const L = S.sensitivity;
  const store = L.emptyStore();
  const spark = gateFor(v.index, 'neuralspark', 'the host app', store);
  let r = await v.w.callTool('weekly_update_add_section', { workstream: 'Seed Library', flag: 'On track', status: 'Last packets', progress: ['Labels fixed'], blockers: ['None'] }, spark);
  assert.match(r.text, /Started the week of 19 October 2026 from last week first\. Brought Seed Library up to date/);
  r = await v.w.callTool('weekly_update_set_metric', { workstream: 'seed library', measure: '% of scope', value: 96.4, unit: '%' }, spark);
  assert.match(r.text, /Set % of scope to 96\.4%/);
  r = await v.w.callTool('weekly_update_get', {}, spark);
  assert.match(r.text, /1\. Seed Library\nStatus: On track\. Last packets\n- Labels fixed\nNext steps:\n- Order more\n% of scope: 96\.4%/);
  r = await v.w.callTool('weekly_update_get', { workstream: 'Seed library' }, spark);
  assert.match(r.text, /% of scope: w\/c 12 Oct 93\.3%, w\/c 19 Oct 96\.4%/);
  r = await v.w.callTool('weekly_update_mark_sent', { sent_by: 'Alex Example' }, spark);
  assert.match(r.text, /marked sent/);
  // An update marked Personal: a chat bot (not allowed Personal) is told so, never shown it.
  const rel = 'Weekly Updates/Weekly update 2026-10-19.md';
  const text = v.read(rel).replace('type: weekly-update', 'type: weekly-update\nsensitivity: personal');
  v.index.set(rel, text, TODAY.getTime(), text.length);
  const bot = gateFor(v.index, 'neuralbot', 'Chat bot', store);
  r = await v.w.callTool('weekly_update_get', {}, bot);
  assert.match(r.text, /There’s no update for the week of 19 October 2026 yet[\s\S]*1 weekly update is at a level Chat bot isn’t allowed/);
  // Switched off: no tools, no notices, and the tools say so.
  v.sw.value = { weekly: { on: false } };
  assert.deepEqual(v.w.toolsOn(), []);
  assert.equal(await v.w.check(), 0);
  assert.match((await v.w.callTool('weekly_update_get', {}, spark)).text, /switched off/);
  assert.equal(await v.w.callTool('not_a_work_tool', {}, spark), null);
});

test('meetings in the nav with the module off: the page reads them, and its extras still need the module (Polish round 3, ITEMS 1)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const v = setup(
    {
      '.neuralvault/areas.json': areas,
      'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT,
      'Work/Meetings/2026-10-27 Fit-out sync.md': MEETING,
    },
    { meetings: { on: false } },
  );
  const handlers = new Map();
  M.registerWorkModules(v.w, (channel, fn) => handlers.set(channel, fn));
  const call = handlers.get('work:call');
  const model = await call('meetings', 'model', []);
  assert.deepEqual(model.meetings.map((m) => m.path), ['Work/Meetings/2026-10-27 Fit-out sync.md'], 'the vault meetings are read while the module is off');
  assert.equal(model.prepOn, false, 'the prep pack stays off with the module');
  await assert.rejects(() => call('meetings', 'prep', ['Work/Meetings/2026-10-27 Fit-out sync.md']), /Meetings is switched off/, 'the prep pack is an extra of the module');
  await assert.rejects(() => call('meetings', 'add-series', [{ name: 'Fit-out sync' }]), /Meetings is switched off/, 'series are an extra of the module');
  await assert.rejects(() => call('weekly', 'model', []), /Weekly is switched off/, 'another module switched off still refuses, as before');
  // The agent tools stay the module's: switched off, they say so and show nothing.
  const spark = gateFor(v.index, 'neuralspark', 'the host app', S.sensitivity.emptyStore());
  assert.match((await v.w.callTool('meeting_list', {}, spark)).text, /switched off/);
});

test('meetings on the main side: actions are the project’s tasks with no filing, ticked in both places, a transcript written up, the prep pack', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const v = setup(
    {
      '.neuralvault/areas.json': areas,
      'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT,
      'Work/Meetings/2026-10-27 Fit-out sync.md': MEETING,
      'Work/Meetings/2026-10-20 Fit-out sync.md': '---\ntype: meeting\ndate: 2026-10-20\nseries: "[[Fit-out sync]]"\nproject: "[[Harbour Fit-out]]"\npeople: ["[[Priya Shah]]", "[[Sam Okafor]]"]\n---\n## Agenda\n\n- [ ] Lift booking\n\n## Actions\n\n- [ ] Chase the landlord — Lee Wong\n',
      'Work/People/Sam Okafor.md': '---\ntype: person\nrole: Site lead\n---\n',
      'Work/People/Priya Shah.md': '---\ntype: person\n---\n',
    },
    { meetings: { on: true } },
  );
  const model = await v.op('meetings', 'model');
  assert.deepEqual(model.upcoming.map((m) => m.path), ['Work/Meetings/2026-10-27 Fit-out sync.md']);
  // No filing: the meeting's actions are the project's tasks already — nothing is copied in, nothing marked.
  const m27 = 'Work/Meetings/2026-10-27 Fit-out sync.md';
  assert.equal('toFile' in model, false);
  assert.equal(v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md').includes('Send the floor plan'), false, 'no copy in the project');
  assert.equal((await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).actions.find((x) => x.what === 'Send the floor plan').inProject, true, 'in its project from the moment it is written');
  // Ticked in the meeting: ticked in the project too (one task, one row).
  const a = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).actions.find((x) => x.what === 'Order cable trays');
  assert.match(await v.op('meetings', 'tick', m27, a.line, a.raw, true), /Ticked in Harbour Fit-out too/);
  assert.match(v.read(m27), /- \[x\] Order cable trays/);
  assert.match(v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md'), /- \[x\] Order cable trays/);
  await v.op('meetings', 'tick', m27, a.line, v.read(m27).split('\n')[a.line], false);
  assert.match(v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md'), /- \[ \] Order cable trays/, 'unticked in both too');
  // The prep pack: last time's open action and the item not reached, and what's open with the people coming.
  const prep = await v.op('meetings', 'prep', m27);
  assert.equal(prep.last.path, 'Work/Meetings/2026-10-20 Fit-out sync.md');
  assert.deepEqual(prep.last.open.map((x) => x.what), ['Chase the landlord']);
  assert.deepEqual(prep.last.notReached, ['Lift booking']);
  assert.ok(prep.count >= 2);
  // The next meeting of the series carries what was left open.
  await v.op('meetings', 'add-series', { name: 'Fit-out sync', cadence: 'Weekly', day: 'Tuesday', time: '10:00 AM', attendees: ['Priya Shah'], project: 'Harbour Fit-out', standing: ['Safety'] });
  const series = (await v.op('meetings', 'model')).series[0];
  assert.equal(series.next, '2026-10-27');
  // Agenda, decision and action lines added where they belong.
  await v.op('meetings', 'add-item', m27, 'decision', 'Electrician starts Monday');
  await v.op('meetings', 'add-item', m27, 'agenda', 'Signage');
  assert.match(v.read(m27), /- Go with the two-rack layout\n- Electrician starts Monday/);
  assert.match(v.read(m27), /- \[x\] Budget sign-off\n- \[ \] Signage/);
  // A transcript: written up by the assistant (the recorder's own notes) and folded at the end.
  v.setAsk(async () => ({ reply: { summary: 'Racks land Thursday.', decisions: [{ text: 'Trays after racks', at: '00:07' }], actions: [{ what: 'Confirm the lift', who: 'Lee Wong', due: '2026-10-29', time: '' }], people: ['Lee Wong'] } }));
  const t = await v.op('meetings', 'transcript', m27, '[00:00:01] Priya Shah: Morning all.\n[00:00:07] Sam Okafor: Racks land Thursday, trays after.\n', 'call.vtt');
  assert.equal(t.notes, true);
  const note = v.read(m27);
  assert.match(note, /## Summary\n\nRacks land Thursday\./);
  assert.match(note, /Trays after racks/);
  assert.match(note, /- \[ \] Confirm the lift/);
  assert.match(note, /## Transcript[\s\S]*> \*\*0:01\*\* \*Priya Shah:\* Morning all\./);
  // Without a model the transcript still goes in, and says why the notes weren't made.
  v.setAsk(async () => ({ reply: null, error: 'No model is set up yet.' }));
  const m20 = 'Work/Meetings/2026-10-20 Fit-out sync.md';
  const t2 = await v.op('meetings', 'transcript', m20, 'Priya Shah: Quick one.\n', '');
  assert.match(t2.words, /notes couldn’t be made: No model is set up yet/);
  await assert.rejects(() => v.op('meetings', 'transcript', m20, '   ', ''), /Paste the transcript/);
  // Brought in again once a model is there: the notes are made, the transcript isn't added twice.
  v.setAsk(async () => ({ reply: { summary: 'A quick one.', decisions: [], actions: [], people: [] } }));
  const t3 = await v.op('meetings', 'transcript', m20, 'Priya Shah: Quick one.\n', '');
  assert.match(t3.words, /in the note already and stays as it was/);
  assert.equal(v.read(m20).match(/## Transcript/g).length, 1);
  assert.equal(v.read(m20).match(/Quick one\./g).length, 1);
  assert.match(v.read(m20), /## Summary\n\nA quick one\.[\s\S]*## Transcript/);
  // Tools: a meeting read back, a new one added only with its day.
  const spark = gateFor(v.index, 'neuralspark', 'the host app', S.sensitivity.emptyStore());
  assert.match((await v.w.callTool('meeting_get', { meeting: 'fit-out sync 2026-10-27' }, spark)).text, /Decisions:\n- Go with the two-rack layout\n- Electrician starts Monday\n- Trays after racks/);
  assert.match((await v.w.callTool('meeting_list', { when: 'upcoming' }, spark)).text, /2026-10-27 10:00 AM 2026-10-27 Fit-out sync/);
  assert.match((await v.w.callTool('meeting_add', { title: 'Landlord call', date: 'Friday' }, spark)).text, /Added the meeting Landlord call on 2026-10-30 \[Work\/Meetings\/2026-10-30 Landlord call\.md\]/);
  assert.match((await v.w.callTool('meeting_add', { title: 'Landlord call', date: '2026-10-30', attendees: ['Lee Wong'] }, spark)).text, /already a meeting called Landlord call/);
  assert.match((await v.w.callTool('meeting_prep', { meeting: 'fit-out sync 2026-10-27' }, spark)).text, /Prep for 2026-10-27 Fit-out sync/);
});

test('questions: asked, answered, and made a task or a decision in one click', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const m27 = 'Work/Meetings/2026-10-27 Fit-out sync.md';
  const v = setup({ '.neuralvault/areas.json': areas, 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT, [m27]: MEETING, 'Work/People/Sam Okafor.md': '---\ntype: person\n---\n' }, { meetings: { on: true } });
  await v.op('meetings', 'add-item', m27, 'question', 'Who signs off the oven logs?');
  await v.op('meetings', 'add-item', m27, 'question', 'Does the receipt show the tax line? — for [[Sam Okafor]]');
  assert.match(v.read(m27), /## Questions\n\n- \? Who signs off the oven logs\?\n- \? Does the receipt show the tax line\? — for \[\[Sam Okafor\]\]/);
  let qs = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).questions;
  assert.equal(qs.filter((q) => !q.answered).length, 2);
  assert.equal(qs[1].owner, 'Sam Okafor');
  assert.equal(qs[1].ownerPath, 'Work/People/Sam Okafor.md', 'its for is a typed link to their note');
  await assert.rejects(v.op('meetings', 'question-task', m27, qs[0].line, qs[0].raw), /Answer it first/);
  await v.op('meetings', 'answer-question', m27, qs[0].line, qs[0].raw, 'the head baker signs');
  assert.match(v.read(m27), /Who signs off the oven logs\? — answer: the head baker signs/);
  qs = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).questions;
  assert.equal(qs[0].answered, true);
  assert.equal(qs[0].answer, 'the head baker signs');
  await v.op('meetings', 'question-task', m27, qs[0].line, qs[0].raw);
  assert.match(v.read(m27), /- \[ \] Who signs off the oven logs\?/);
  assert.match(v.read(m27), /Who signs off the oven logs\? — answer: the head baker signs/, 'the question keeps its answer');
  await v.op('meetings', 'answer-question', m27, qs[1].line, qs[1].raw, 'yes, every line');
  const qs2 = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).questions;
  await v.op('meetings', 'question-decision', m27, qs2[1].line, qs2[1].raw);
  assert.match(v.read(m27), /- Does the receipt show the tax line\? — yes, every line/);
  await v.op('meetings', 'add-item', m27, 'question', 'Who files the dockets? — for Sam Okafor');
  const qs3 = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).questions;
  const dockets = qs3.find((q) => q.what.includes('dockets'));
  await v.op('meetings', 'answer-question', m27, dockets.line, dockets.raw, 'Sam does, Fridays');
  const qs4 = (await v.op('meetings', 'model')).meetings.find((m) => m.path === m27).questions;
  const dockets2 = qs4.find((q) => q.what.includes('dockets'));
  await v.op('meetings', 'question-task', m27, dockets2.line, dockets2.raw);
  assert.match(v.read(m27), /- \[ \] Who files the dockets\? — \[\[Sam Okafor\]\]/, 'its owner written as a typed link');
});

test('8.3 wave 1 meetings: a prep sheet saved on request and the evening before; a follow-up drafted, never sent', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const files = {
    '.neuralvault/areas.json': areas,
    'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT,
    'Work/Meetings/2026-10-25 Fit-out sync.md': MEETING.replaceAll('2026-10-27', '2026-10-25'),
    'Work/People/Sam Okafor.md': '---\ntype: person\n---\n',
    'Work/People/Priya Shah.md': '---\ntype: person\n---\n',
  };
  const rel = 'Work/Meetings/2026-10-25 Fit-out sync.md';
  // On request: the sheet lands in the note, with who is coming and what is open.
  const v = setup(files, { meetings: { on: true } });
  const sheet = await v.op('meetings', 'prep-sheet', rel);
  assert.match(sheet, /Who is coming/);
  assert.match(v.read(rel), /## Prep sheet\n+For \*\*/);
  const again = await v.op('meetings', 'prep-sheet', rel);
  assert.equal(v.read(rel).match(/## Prep sheet/g).length, 1, 'made again, it replaces itself, never stacks');
  // By chat: the same sheet, and a follow-up draft that is not sent.
  const spark = gateFor(v.index, 'neuralspark', 'the host app', S.sensitivity.emptyStore());
  assert.match((await v.w.callTool('meeting_prep_sheet', { meeting: 'fit-out sync' }, spark)).text, /Saved in its note/);
  const draft = await v.op('meetings', 'follow-up', rel);
  assert.match(draft.text, /Go with the two-rack layout/);
  assert.match(draft.text, /Send the floor plan/);
  assert.match((await v.w.callTool('meeting_follow_up', { meeting: 'fit-out sync' }, spark)).text, /Draft only, not sent/);
  // The evening before: at 6 pm the sheet is made by itself; at 10 am it is not.
  const morning = setup(files, { meetings: { on: true } }, new Date(2026, 9, 24, 10, 0));
  await morning.w.check();
  assert.ok(!/## Prep sheet/.test(morning.read(rel)), 'no sheet in the morning');
  const evening = setup(files, { meetings: { on: true } }, new Date(2026, 9, 24, 18, 0));
  await evening.w.check();
  assert.match(evening.read(rel), /## Prep sheet/, 'the sheet is ready the evening before');
});

test('the work modules in the catalogue: off by default, their types, folders and levels; vendors Work-confidential', () => {
  const L = S.lifeModules;
  const R = S.moduleRecords;
  assert.deepEqual(L.modulesOn({}).map((m) => m.id), []);
  for (const id of ['meetings', 'weekly', 'sites', 'vendors']) assert.ok(L.moduleInfo(id) && R.moduleById(id), `${id} is in both lists`);
  assert.equal(R.typeFolder('weekly-update', [{ id: 'work', folder: 'Work' }]), 'Work/Weekly Updates');
  assert.equal(R.typeFolder('meeting-series', null), 'Meetings/Series');
  assert.equal(S.sensitivity.levelOf(S.sensitivity.emptyStore(), 'x.md', undefined, 'quote').level, 'work');
  assert.equal(S.sensitivity.levelOf(S.sensitivity.emptyStore(), 'x.md', undefined, 'weekly-update').level, 'open');
  const names = S.moduleTools.MODULE_TOOLS.map((t) => t.name);
  for (const t of ['weekly_update_create', 'weekly_update_get', 'weekly_update_add_section', 'weekly_update_set_metric', 'weekly_update_mark_sent', 'meeting_list', 'meeting_get', 'meeting_prep', 'meeting_add']) assert.ok(names.includes(t), `${t} offered`);
  assert.ok(!names.includes('meeting_file_actions'), 'no filing tool: nothing to carry');
  assert.ok(S.moduleTools.MODULE_TOOLS.filter((t) => t.module === 'weekly' || t.module === 'meetings').every((t) => t.step && t.title && !/_/.test(t.step)), 'each has its own step words');
  // Offered when the vault shows it would use one (meeting notes), and the options keep a module's own settings.
  assert.deepEqual(R.moduleOffers([], {}, [{ title: '2026-10-20 Fit-out meeting' }, { title: 'Supplier kick-off agenda' }]).map((o) => o.module), ['meetings']);
  const o = R.withModuleOptions({}, 'weekly', { settings: { dueDay: 4, audience: 'Sam Lee' } });
  assert.deepEqual(R.readModuleOptions(R.writeModuleOptions(o)).weekly.settings, { dueDay: 4, audience: 'Sam Lee' });
  assert.deepEqual(R.withModuleOptions(o, 'weekly', { settings: { audience: '' } }).weekly.settings, { dueDay: 4 });
});

test('9.5 batch 10: a Meeting Summary section is the summary; meetings found by person and project (F110, F115)', () => {
  const X = S.workMeetings;
  const m = X.readMeeting({ path: 'M.md', title: 'Landlord call', props: { type: 'meeting', date: '2026-10-27' }, content: '## Meeting Summary\n\nAgreed the rent review.\n' });
  assert.match(m.summary, /Agreed the rent review/);
  const sam = X.readMeeting({ path: 'S.md', title: 'Lease review', props: { type: 'meeting', date: '2026-10-27', people: ['Sam Okafor'] }, content: '' }, []);
  const other = X.readMeeting({ path: 'O.md', title: 'Lease review', props: { type: 'meeting', date: '2026-11-03', people: ['Priya Shah'] }, content: '' }, []);
  assert.equal(X.findMeeting([sam, other], 'meet Sam?', '2026-10-24').path, 'S.md');
  const proj = X.readMeeting({ path: 'P.md', title: 'Site walk', props: { type: 'meeting', date: '2026-10-27', project: '[[Harbour Fit-out]]' }, content: '' }, []);
  assert.equal(X.findMeeting([other, proj], 'harbour fit-out site', '2026-10-24').path, 'P.md');
});

test('9.5 batch 10: a meeting day in words (F131)', () => {
  const X = S.workMeetings;
  const sat = new Date(2026, 9, 24, 10, 0);
  assert.equal(X.meetingDay('Friday', sat), '2026-10-30');
  assert.equal(X.meetingDay('24 Oct', sat), '2026-10-24');
  assert.equal(X.meetingDay('2026-10-27', sat), '2026-10-27');
  assert.equal(X.meetingDay('2026-13-45', sat), null);
  assert.equal(X.meetingDay('', sat), null);
  assert.equal(X.meetingDay('someday', sat), null);
});

test('9.5 batch 10: Who does what is an actions section everywhere; a draft with no fixed voice (F100, F113)', () => {
  const X = S.workMeetings;
  const text = '# Call\n\n## Who does what\n\n- [x] Drawn the plan\n';
  const m = X.readMeeting({ path: 'M.md', title: 'Call', props: { type: 'meeting', date: '2026-10-27' }, content: text });
  assert.deepEqual(m.actions.map((a) => [a.what, a.done]), [['Drawn the plan', true]]);
  const added = X.addToSection(text, X.ACTIONS_HEADING, 'Actions', '- [ ] Price the racks');
  assert.ok(!/^## Actions$/m.test(added), 'no second actions section');
  assert.match(added, /- \[ \] Price the racks/);
  const d = X.followUpDraft(m);
  assert.ok(!/Kia ora/.test(d.text) && !/Ngā mihi/.test(d.text), 'no fixed voice unless given');
  assert.match(d.text, /Thanks for Call/);
  const Kiwi = X.followUpDraft(m, (a) => a.done, { greeting: 'Kia ora,', signoff: 'Ngā mihi' });
  assert.match(Kiwi.text, /Kia ora,/);
});

test('9.5 batch 11: meeting_add and add-series refuse dupes; bad days and day words (F122, F123, F131)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const v = setup({ '.neuralvault/areas.json': areas }, { meetings: { on: true } });
  const r1 = await v.w.callTool('meeting_add', { title: 'Landlord call', date: '2026-10-27' }, null);
  assert.match(r1.text, /Added the meeting Landlord call/);
  const r2 = await v.w.callTool('meeting_add', { title: 'Landlord call', date: '2026-10-27' }, null);
  assert.match(r2.text, /already a meeting called Landlord call/);
  assert.ok(!v.index.allMeta().some((m) => m.path.includes('Landlord call 2')), 'no " 2" note minted');
  const rw = await v.w.callTool('meeting_add', { title: 'Rent review', date: 'Friday' }, null);
  assert.match(rw.text, /2026-10-30/);
  const bad = await v.w.callTool('meeting_add', { title: 'Bad day', date: '2026-13-45' }, null);
  assert.match(bad.text, /Give the day/);
  const opPath = await v.op('meetings', 'add-meeting', { title: 'Op day words', date: 'Friday' });
  assert.match(opPath, /2026-10-30/);
  await assert.rejects(v.op('meetings', 'add-meeting', { title: 'Op bad', date: 'someday' }), /Give the day/);
  await v.op('meetings', 'add-series', { name: 'Sync' });
  await assert.rejects(v.op('meetings', 'add-series', { name: 'Sync' }), /already a series called Sync/);
  const s2 = await v.w.callTool('meeting_series_add', { name: 'Sync' }, null);
  assert.match(s2.text, /already a series called Sync/);
});

test('9.5 batch 11: a failed project tick unticks the meeting again (F128)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const rel = 'Work/Meetings/2026-10-27 Fit-out sync.md';
  const proj = 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md';
  let v;
  v = setup({ '.neuralvault/areas.json': areas, [rel]: MEETING, [proj]: PROJECT }, { meetings: { on: true } }, TODAY, {
    writeNote: async (to, text) => {
      if (to === proj) throw new Error('project locked');
      v.write(to, text);
    },
  });
  const line = MEETING.split('\n').findIndex((l) => l.startsWith('- [ ] Order cable trays'));
  await assert.rejects(v.op('meetings', 'tick', rel, line, '- [ ] Order cable trays → [[Harbour Fit-out]]', true), /project locked/);
  assert.match(v.read(rel), /- \[ \] Order cable trays → \[\[Harbour Fit-out\]\]/, 'unticked back');
});

test('9.5 batch 11: the prep sheet reads through the asker’s gate (F129)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const a = 'Work/Meetings/2026-10-25 Planning.md';
  const b = 'Work/Meetings/2026-10-20 Planning.md';
  const v = setup(
    {
      '.neuralvault/areas.json': areas,
      [a]: '---\ntype: meeting\ndate: 2026-10-25\npeople:\n  - "[[Sam Okafor]]"\n  - "[[Priya Shah]]"\n---\n## Notes\n\nSoon.\n',
      [b]: '---\ntype: meeting\ndate: 2026-10-20\nsensitivity: personal\npeople:\n  - "[[Sam Okafor]]"\n  - "[[Priya Shah]]"\n---\n## Actions\n\n- [ ] Chase the landlord — Sam Okafor\n',
    },
    { meetings: { on: true, prep: true } },
  );
  const L = S.sensitivity;
  const bot = gateFor(v.index, 'neuralbot', 'Chat bot', L.emptyStore());
  const sheet = await v.w.callTool('meeting_prep_sheet', { meeting: a }, bot);
  assert.ok(!sheet.text.includes('Chase the landlord'), 'nothing past the gate');
  const prep = await v.w.callTool('meeting_prep', { meeting: a }, bot);
  assert.ok(!prep.text.includes('Chase the landlord'));
});

test('9.5 batch 11: a prep sheet that cannot be reworded still says why in the log (F126)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const rel = 'Work/Meetings/2026-10-27 Fit-out sync.md';
  const logs = [];
  const v = setup({ '.neuralvault/areas.json': areas, [rel]: MEETING }, { meetings: { on: true } }, TODAY, { log: (m) => logs.push(m) });
  v.setAsk(async () => { throw new Error('model down'); });
  const words = await v.op('meetings', 'prep-sheet', rel);
  assert.match(words, /Fit-out sync/);
  assert.ok(logs.some((l) => l.includes('model down')), 'the failure is logged');
});

test('9.5 batch 11: a bell that fails is logged, not swallowed (F125)', async () => {
  const areas = JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] });
  const logs = [];
  const v = setup({ '.neuralvault/areas.json': areas }, { weekly: { on: true } }, TODAY, { post: () => { throw new Error('bell down'); }, log: (m) => logs.push(m) });
  await v.w.tick();
  assert.ok(logs.some((l) => l.includes('bell down')), 'the failure is logged');
});

// m4-minutes-clean fault 7 (6 Nov 2026, "Fitzroy cafe opening: weekly" became "Fitzroy cafe opening weekly"
// through the New meeting form): the file name cannot hold a colon, but the note's displayed title still must.
// A meeting whose name holds what the file system refuses keeps its full display title in its properties.
test('m4: a meeting name with a colon keeps its displayed title in its properties', () => {
  const X = S.workMeetings;
  const colon = X.newMeetingText({ title: 'Fitzroy cafe opening: weekly', date: '2026-11-06' });
  const props = X.meetingProps(colon);
  assert.equal(props.title, '2026-11-06 Fitzroy cafe opening: weekly', 'the full display title, colon kept');
  const plain = X.newMeetingText({ title: 'Fitzroy cafe opening weekly', date: '2026-11-06' });
  assert.equal(X.meetingProps(plain).title, undefined, 'no extra title when the file name holds it');
});

// m7-minutes-last fault 4 (6 Nov 2026, a second same-day meeting showed its file's " 2" as its name): when the
// file took a copy number to stay unique, `title:` keeps what the person typed, number-free.
test('m7: a second same-day meeting keeps its typed name in its properties', () => {
  const X = S.workMeetings;
  const second = X.newMeetingText({ title: 'Cart retry standup', date: '2026-11-06', fileBase: '2026-11-06 Cart retry standup 2' });
  assert.equal(X.meetingProps(second).title, '2026-11-06 Cart retry standup', 'typed words, no number');
  const first = X.newMeetingText({ title: 'Cart retry standup', date: '2026-11-06', fileBase: '2026-11-06 Cart retry standup' });
  assert.equal(X.meetingProps(first).title, undefined, 'no extra title when the file is the name');
});
