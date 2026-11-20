// node --test tests/project-file.test.mjs — a project's file (src/shared/project-file.ts; docs/PROJECTS-DESIGN.md): every
// fact read back as written, hand-written headings and lines understood, the person's properties, notes and other
// sections kept word for word, the former host app's key for the project's folder.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-file-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/project-file.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const full = () => ({
  ...P.emptyProject('Garden Shed Upgrade'),
  status: 'active', health: 'at risk', progress: 95, owner: 'Alex Morgan', folder: 'C:\\Users\\jarlow\\Downloads\\projects\\01 Garden Shed Upgrade', started: '2026-09-09', due: '2026-10-31', updated: '2026-10-16', tags: ['windows-11', 'intune'],
  key: P.projectKey('C:\\Users\\jarlow\\Downloads\\projects\\01 Garden Shed Upgrade'),
  summary: 'The north and west beds around the garden shed.\n\n940 of 1,012 bricks laid.',
  next: [{ done: false, what: 'Send Darcy the list check', who: 'Jesse', when: '17 Oct' }, { done: true, what: 'Order from the brick yard' }],
  dates: [{ when: '30 Sep 2026', what: 'Target | first session', status: 'missed' }, { when: '31 Oct 2026', what: 'New target' }],
  people: [{ name: 'Wesley Stavely', role: 'Report sponsor' }, { name: 'Darcy Lin' }],
  risks: [{ level: 'high', what: 'No new target date' }, { what: '7 devices under 30 GB free' }],
  decisions: [{ date: '14 Oct 2026', what: 'Retired devices are dropped from every list.', why: 'stop chasing them' }],
  updates: [{ date: '16 Oct 2026', what: '940 of 1,012 bricks laid', from: 'Shed_Status_2026-10-16.xlsx' }],
  documents: [{ path: 'Current/Shed_Status_2026-10-16.xlsx', what: 'Latest status' }, { path: 'RECORD.md' }],
  notes: 'My own words.\n\n- keep this list',
});

test('every fact is written in plain text and read back the same', () => {
  const text = P.serializeProject(full());
  assert.match(text, /^---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 95\nowner: Alex Morgan\nfolder: C:\\Users\\jarlow\\Downloads\\projects\\01 Garden Shed Upgrade\nstarted: "2026-09-09"\ndue: "2026-10-31"\nupdated: "2026-10-16"\ntags: \[windows-11, intune\]\nneuralspark-project: local:c:\/users\/jarlow\/downloads\/projects\/01 garden shed upgrade\n---\n# Garden Shed Upgrade\n/);
  assert.match(text, /## What’s next\n\n- \[ \] Send Darcy the list check — Jesse · by 17 Oct\n- \[x\] Order from the brick yard\n/);
  assert.match(text, /## Key dates\n\n\| When \| What \| Status \|\n\| --- \| --- \| --- \|\n\| 30 Sep 2026 \| Target \\\| first session \| missed \|\n\| 31 Oct 2026 \| New target \| — \|/);
  assert.match(text, /## Risks and issues\n\n- \*\*High\*\* — No new target date\n- 7 devices under 30 GB free/);
  assert.match(text, /## Decisions\n\n- \*\*14 Oct 2026\*\* — Retired devices are dropped from every list\. \*Why:\* stop chasing them/);
  assert.match(text, /## Updates\n\n- \*\*16 Oct 2026\*\* — 940 of 1,012 bricks laid \*From:\* Shed_Status_2026-10-16\.xlsx/);
  assert.match(text, /## Documents\n\n- `Current\/Shed_Status_2026-10-16\.xlsx` — Latest status\n- `RECORD\.md`/);
  const back = P.parseProject(text);
  const want = full();
  assert.deepEqual({ ...back, extra: [] }, { ...want, dates: [{ when: '30 Sep 2026', what: 'Target | first session', status: 'missed' }, { when: '31 Oct 2026', what: 'New target' }] });
  assert.equal(P.serializeProject(back, text), text, 'writing what was read changes nothing');
});

test('a hand-written project is understood, and the person’s own lines stay', () => {
  const hand = '---\nstatus: planning\ncolour: blue\ntype: project\n---\nIntro words.\n\n## Next steps\n- Book the venue\n- [x] Pick a date\n\n## Milestones\n- **1 Nov** — Launch\n\n## Stakeholders\n- Sam — sponsor\n\n## Budget\nA$40k approved.\n\n## Notes\nKeep it small.\n';
  const p = P.parseProject(hand, 'Projects/Launch/Launch party.md');
  assert.equal(p.name, 'Launch party', 'the file’s name when there is no title');
  assert.equal(p.summary, 'Intro words.');
  assert.deepEqual(p.next, [{ done: false, what: 'Book the venue' }, { done: true, what: 'Pick a date' }]);
  assert.deepEqual(p.dates, [{ when: '1 Nov', what: 'Launch' }]);
  assert.deepEqual(p.people, [{ name: 'Sam', role: 'sponsor' }]);
  assert.deepEqual(p.extra, [{ heading: 'Budget', body: 'A$40k approved.', after: 'people' }], 'and where it was: after People');
  p.health = 'on track';
  const out = P.serializeProject(p, hand);
  assert.match(out, /^---\nstatus: planning\ncolour: blue\ntype: project\nhealth: on track\n---\n/, 'the person’s property stays where it was');
  assert.match(out, /## Budget\n\nA\$40k approved\./, 'a section of their own stays');
  assert.match(out, /## Notes\n\nKeep it small\./, 'their notes stay word for word');
});

test('a key date with no date is kept as it was, and so is an empty due line', () => {
  const text = '---\ntype: project\nstatus: active\ndue: ""\n---\n# Release\n\n## Summary\n\nShip it.\n\n## What’s next\n\n- [ ] Book the hall — Ana\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 1 Sep 2026 | Lease signed | done |\n| | 8.0 released | planned |\n\n## Notes\n\nMine.\n';
  const p = P.parseProject(text);
  assert.deepEqual(p.dates, [
    { when: '1 Sep 2026', what: 'Lease signed', status: 'done' },
    { when: '', what: '8.0 released', status: 'planned' },
  ], 'a milestone not yet dated is still a key date');
  assert.equal(P.serializeProject(p, text), text, 'parse and write is the same text, the empty due line included');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Ship the thing' } });
  const out = P.serializeProject(p, text);
  assert.match(out, /\| \| 8\.0 released \| planned \|/, 'an added next step keeps the dateless row');
  assert.match(out, /^due: ""$/m, 'the empty due line is still there');
  assert.match(out, /- \[ \] Ship the thing/);
  P.applyProjectEdit(p, { kind: 'change', list: 'dates', index: 1, item: { status: 'done' } });
  assert.match(P.serializeProject(p, text), /\| \| 8\.0 released \| done \|/, 'a dateless key date can be changed without gaining a date');
});

test('rows a list cannot fully read are kept as written, not dropped', () => {
  const text = '---\ntype: project\nstatus: active\n---\n# Depot\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 1 Sep 2026 | Lease signed | done |\n| 3 Oct 2026 | | planned |\n\n## Risks and issues\n\n| Risk | Impact | Owner | Status |\n| --- | --- | --- | --- |\n| Real risk | High | Ana | Open |\n| | Low | Ben | Open |\n';
  const out = P.serializeProject(P.parseProject(text), text);
  for (const line of ['| 3 Oct 2026 | | planned |', '| | Low | Ben | Open |']) assert.ok(out.includes(line), `kept: ${line}\n${out}`);
});

test('names, keys and places', () => {
  assert.equal(P.projectKey('C:\\Work\\Site\\'), 'local:c:/work/site');
  assert.equal(P.projectKey('/home/jesse/site'), 'local:/home/jesse/site');
  assert.equal(P.safeName('LF 2027: Elm Sq / Ashgrove?'), 'LF 2027 Elm Sq Ashgrove');
  assert.equal(P.projectsFolder(['00 Inbox', '02 Projects', 'Daily']), '02 Projects');
  assert.equal(P.projectPath('02 Projects', 'Wexley St Ashford (Launch)'), '02 Projects/Wexley St Ashford (Launch)/Wexley St Ashford (Launch).md');
  assert.ok(P.isProjectText('---\ntype: project\n---\n# X') && !P.isProjectText('# Just a note'));
});

test('a project file written wrongly is put right, every word kept (18 Oct 2026: a title above the properties)', () => {
  const owner = '# Minecraft server\n\n---\ntype: project\nstatus: active\nhealth: on track\nneuralspark-project: local:/srv/mc\n---\n\n## Summary\n\nTwo servers run Bedrock.\n\n## What’s next\n\n- [ ] Open the firewall — Jesse · by 20 Oct\n\n## Server design brief\n\nThe plan.\n';
  const r = P.repairProjectText(owner);
  assert.deepEqual(r.repaired, ['moved the properties above the title']);
  assert.match(r.text, /^---\ntype: project\nstatus: active\nhealth: on track\nneuralspark-project: local:\/srv\/mc\n---\n# Minecraft server\n\n## Summary/);
  for (const words of ['Two servers run Bedrock.', 'Open the firewall', 'The plan.']) assert.ok(r.text.includes(words), words);
  const p = P.parseProject(owner, 'Projects/Minecraft server/Minecraft server.md');
  assert.equal(p.name, 'Minecraft server');
  assert.equal(p.health, 'on track');
  assert.equal(p.key, 'local:/srv/mc');
  assert.equal(p.next[0].what, 'Open the firewall');
  assert.equal(p.summary, 'Two servers run Bedrock.', 'the title is not read as the summary');
  assert.ok(P.isProjectText(owner));
  const out = P.serializeProject(p, owner);
  assert.match(out, /^---\ntype: project\nstatus: active\nhealth: on track\n/);
  assert.equal((out.match(/^---$/gm) || []).length, 2, 'one block of properties');
  assert.ok(out.includes('## Server design brief\n\nThe plan.'));
  assert.equal(P.repairProjectText(out).repaired.length, 0, 'well formed now');
  // A byte-order mark, and a second block of properties.
  const twice = '﻿---\ntype: project\nstatus: active\n---\n# Shop\n\n---\nstatus: done\nowner: Sam\ntags:\n  - web\n---\nWords.\n';
  const t = P.repairProjectText(twice);
  assert.deepEqual(t.repaired, ['took out a byte-order mark before the properties', 'joined a second block of properties to the first']);
  assert.match(t.text, /^---\ntype: project\nstatus: active\nstatus-was: done\nowner: Sam\ntags:\n  - web\n---\n# Shop\n/);
  assert.ok(t.text.includes('Words.'));
  const tp = P.parseProject(twice);
  assert.deepEqual([tp.status, tp.owner, tp.tags, tp.summary], ['active', 'Sam', ['web'], 'Words.']);
  // Well-formed files and ordinary notes are left exactly as they are.
  const fine = '---\ntype: project\n---\n# X\n\n---\n\nA rule above, not properties.\n';
  assert.deepEqual(P.repairProjectText(fine), { text: fine, repaired: [] });
  assert.deepEqual(P.repairProjectText('# A note\n\n---\n\nText').repaired, []);
  assert.deepEqual(P.repairProjectText('# A note\n\n---\nnot: really\nsome words here\n---\n').repaired, [], 'a block that is not all properties stays');
});

// 5 Nov 2026, vault folio F5: key dates written "date: words" ("- 2026-11-06: Retry fix live") read as key
// dates, so Next milestones sees them; decisions and updates read the same way. A colon that is not a date ("owner:
// Priya Nair" inside a risk) keeps the line whole.
test('key dates written "date: words" read as key dates, and other colon lines stay whole', () => {
  const text = '---\ntype: project\nstatus: active\n---\n# Harbourline Cart Fix\n\n## Summary\n\nFix the retry.\n\n## Key dates\n\n- 2026-11-06: Retry fix live\n- 2026-11-20: Cart fix done\n\n## Decisions\n\n- 2026-11-01: Retry twice, then fail loud\n\n## Updates\n\n- 2026-11-03: Retry staged\n\n## Risks and issues\n\n- Repeat failures on old Safari (owner: Priya Nair, level: medium)\n\n## People\n\n- Alex Chen (owner)\n- Priya Nair\n';
  const p = P.parseProject(text);
  assert.deepEqual(p.dates, [
    { when: '2026-11-06', what: 'Retry fix live' },
    { when: '2026-11-20', what: 'Cart fix done' },
  ], 'the milestones the page counts to');
  assert.deepEqual(p.decisions, [{ date: '2026-11-01', what: 'Retry twice, then fail loud' }]);
  assert.deepEqual(p.updates, [{ date: '2026-11-03', what: 'Retry staged' }]);
  assert.deepEqual(p.risks, [{ what: 'Repeat failures on old Safari (owner: Priya Nair, level: medium)' }], 'not a date before the colon: kept whole');
  assert.deepEqual(p.people, [{ name: 'Alex Chen (owner)' }, { name: 'Priya Nair' }], 'no colon lead: kept whole');
  // Unchanged dates stay as written (5 Nov 2026 x4 polish list item 6: a tick never reformats list-form key
  // dates); only changed dates are written as the one table. Every other line keeps its words.
  const out = P.serializeProject(p, text);
  assert.ok(out.includes('- 2026-11-06: Retry fix live\n- 2026-11-20: Cart fix done'), 'unchanged dates keep their lines');
  assert.ok(!out.includes('| --- |'), 'and gain no table head');
  assert.ok(out.includes('- 2026-11-01: Retry twice, then fail loud'), 'an unchanged decision keeps its line');
  assert.ok(out.includes('- Repeat failures on old Safari (owner: Priya Nair, level: medium)'), 'an unchanged risk keeps its line');
  p.dates.push({ when: '2026-12-20', what: 'wrap up' });
  const changed = P.serializeProject(p, text);
  assert.match(changed, /## Key dates\n\n\| When \| What \| Status \|\n\| --- \| --- \| --- \|\n\| 2026-11-06 \| Retry fix live \| — \|\n\| 2026-11-20 \| Cart fix done \| — \|/);
  assert.equal(P.serializeProject(P.parseProject(changed), changed), changed, 'written once, it stays byte for byte');
});

test('third pass: "Send the quote" never duplicates "Send quote" (articles fold)', () => {
  const p = P.emptyProject('Harbour Fit-out');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Send quote' } });
  assert.match(P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Send the quote' } }), /there already/);
  assert.equal(p.next.length, 1);
});

// 21 Oct 2026, proving the layouts on a real person's reorganised projects: a risks table is the project's risks (shown,
// counted, closed and reopened on the page) and written back as the same table; links in Documents stay links; a blank
// key-date status stays blank in the person's own table; the person's own sections stay where they were.
test('a risks table is read as the risks, and written back as the same table', () => {
  const text = '---\ntype: project\n---\n# Depot move\n\n## Summary\n\nMoving the depot.\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 2026-11-02 | Lease signed | done |\n| 2026-12-01 | Move day | |\n\n## Run sheet\n\n### Week before\n\n- [ ] Label the racks\n\n## Risks and issues\n\n| Risk | Impact | Owner | Status |\n| --- | --- | --- | --- |\n| Forklift hire not booked | High | Ana | Open |\n| Power to the new racks unconfirmed | Severe | | |\n| Council permit | Low | | Closed 3 Oct 2026 |\n\n## Documents\n\n- [[Lease notes]] — the signed terms\n- [[Files/plan.pdf|plan.pdf]] — floor plan\n- `Shared/budget.xlsx` — costs\n\n## Notes\n\nMine.\n';
  const p = P.parseProject(text, 'Projects/Depot move/Depot move.md');
  assert.deepEqual(p.risksHead, ['Risk', 'Impact', 'Owner', 'Status']);
  assert.deepEqual(p.risks.map((r) => [r.what, r.level ?? null, r.owner ?? null, !!r.closed, r.closedOn ?? null]), [
    ['Forklift hire not booked', 'high', 'Ana', false, null],
    ['Power to the new racks unconfirmed', null, null, false, null],
    ['Council permit', 'low', null, true, '3 Oct 2026'],
  ]);
  assert.equal(p.rest?.risks, undefined, 'the table is not left over as words');
  assert.equal(P.serializeProject(p, text), text, 'written back exactly as it was: the table, the links, the blank status, the Run sheet in its place');
  // Closed, reopened and added on the page: still the person's table, other cells as written.
  P.applyProjectEdit(p, { kind: 'change', list: 'risks', index: 0, item: { closed: true } }, '21 Oct 2026');
  P.applyProjectEdit(p, { kind: 'change', list: 'risks', index: 2, item: { closed: false } });
  P.applyProjectEdit(p, { kind: 'change', list: 'risks', index: 1, item: { level: 'medium' } });
  P.applyProjectEdit(p, { kind: 'add', list: 'risks', item: { what: 'Rain on move day', level: 'low' } });
  const out = P.serializeProject(p, text);
  assert.match(out, /## Risks and issues\n\n\| Risk \| Impact \| Owner \| Status \|\n\| --- \| --- \| --- \| --- \|\n\| Forklift hire not booked \| High \| Ana \| Closed 21 Oct 2026 \|\n\| Power to the new racks unconfirmed \| Medium \| \| \|\n\| Council permit \| Low \| \| Open \|\n\| Rain on move day \| Low \| \| Open \|\n/);
  assert.ok(out.indexOf('## Run sheet') < out.indexOf('## Risks and issues'), 'a section of the person’s own stays where it was');
  // A level of the person's own word stays until the page sets one.
  const q = P.parseProject(text);
  P.applyProjectEdit(q, { kind: 'change', list: 'risks', index: 0, item: { level: null } });
  assert.match(P.serializeProject(q, text), /\| Forklift hire not booked \| \| Ana \| Open \|\n\| Power to the new racks unconfirmed \| Severe \| \| \|/);
});

test('the open project briefed: summary, next, risks, pages, capped short (seams O5)', () => {
  assert.equal(typeof P.projectContext, 'function', 'project-file.ts carries it, so the embed gives the host app the same code');
  const p = {
    ...P.emptyProject('Harbour Cafe'),
    summary: 'A cafe fit-out at the harbour.\n\nDue before summer.',
    next: [
      { done: false, what: 'Send v4 to finance', who: 'Sam Taylor', when: '14 Oct' },
      { done: true, what: 'Sign the lease' },
      { done: false, what: 'Chase the microphone stands' },
    ],
    risks: [{ level: 'high', what: 'Stands missing' }, { what: 'Paint late', closed: true }],
    documents: [{ path: 'Quotes/Lighting.pdf', what: 'lighting quote' }],
  };
  assert.equal(
    P.projectContext(p, ['lighting quote (Quotes/Lighting.pdf)', 'Site notes']),
    'Summary: A cafe fit-out at the harbour. Due before summer.\nNext: Send v4 to finance — Sam Taylor (14 Oct); Chase the microphone stands\nRisks: high: Stands missing\nPages: lighting quote (Quotes/Lighting.pdf); Site notes',
  );
  assert.equal(P.projectContext(P.emptyProject('Bare'), []), '', 'nothing to brief is nothing said');
  const many = { ...P.emptyProject('Big'), next: Array.from({ length: 7 }, (_, i) => ({ done: false, what: `Step ${i + 1}` })), risks: Array.from({ length: 5 }, (_, i) => ({ what: `Risk ${i + 1}` })) };
  assert.match(P.projectContext(many, Array.from({ length: 10 }, (_, i) => `Page ${i + 1}`)), /Step 5; and 2 more\nRisks: Risk 1; Risk 2; Risk 3; and 2 more\nPages: Page 1; Page 2; Page 3; Page 4; Page 5; Page 6; Page 7; Page 8; and 2 more/);
  assert.ok(!P.projectContext(p, []).includes('Sign the lease') && !P.projectContext(p, []).includes('Paint late'), 'done steps and closed risks stay out');
});

test('the side chat briefs the open project from it, withheld past its level (seams O5 wiring)', () => {
  const ai = readFileSync(path.join(root, 'src/main/ai.ts'), 'utf8');
  assert.ok(ai.includes('projectContext(p, [...docs, ...linked])'), 'projectWords briefs summary, next, risks and pages');
  assert.ok(ai.includes('g && !g.sees(openProject)'), 'a project past the side chat’s level is withheld, like an open note');
  assert.ok(ai.includes("g.note(openProject, 'read', 'the project open beside the side chat')"), 'the briefing is logged as a read');
});

// A date in an owner tail is never a person (p16-owner-tail, 4 Nov 2026: "Retry the failed payment twice — Priya
// Nair — due 2026-11-06" made a person "Priya Nair — due 2026-11-06"). All three shapes the assistant writes read
// as that person and that date; the file keeps its own words.
test('an owner tail with a date reads as that person and that date, the line unchanged', () => {
  const step = (tail) => P.parseProject(`---\ntype: project\n---\n# T\n\n## What’s next\n\n- [ ] Retry the failed payment twice — ${tail}\n`).next[0];
  for (const tail of ['Priya Nair — due 2026-11-06', 'Priya Nair, due 2026-11-06', 'Priya Nair · by 2026-11-06']) {
    const n = step(tail);
    assert.equal(n.who, 'Priya Nair', tail);
    assert.equal(n.when, '2026-11-06', tail);
    assert.equal(n.what, 'Retry the failed payment twice', tail);
  }
  assert.deepEqual([step('due 2026-11-06').who, step('due 2026-11-06').when], [undefined, '2026-11-06'], 'a date alone is no one');
  // A real name with a hyphen or a dash inside stays whole.
  assert.equal(step('Anne-Marie Jones — due 2026-11-06').who, 'Anne-Marie Jones');
  assert.equal(step('Anne-Marie Jones — due 2026-11-06').when, '2026-11-06');
  assert.equal(step('Jean–Luc Picard · by 2026-11-06').who, 'Jean–Luc Picard');
  assert.equal(step('Smith – Jones').who, 'Smith – Jones', 'a dash in a name without a date word after stays whole');
  // Round trip: the words in the file do not change.
  for (const tail of ['Priya Nair — due 2026-11-06', 'Priya Nair, due 2026-11-06', 'Priya Nair · by 2026-11-06', 'Anne-Marie Jones — due 2026-11-06']) {
    const text = `---\ntype: project\n---\n# T\n\n## What’s next\n\n- [ ] Retry the failed payment twice — ${tail}\n`;
    assert.equal(P.serializeProject(P.parseProject(text), text), text, `kept: ${tail}`);
  }
});

// Key dates written as bullets are read as dates — with a colon lead as well as bold and dash. While the dates say
// the same things they stay as written (5 Nov 2026 polish list item 6: a tick rewrote them as rows); when the dates
// change the section is written as the one table, never the old bullets beside a new table (v8 F12).
test('bullet key dates read as dates, stay bullets until the dates change, then write as the one table', () => {
  const text = '---\ntype: project\n---\n# Cart Fix\n\n## Key dates\n\n- 2026-11-06: retry fix live\n- Fri 20 Nov: cart fix done\n- **1 Dec 2026** — Christmas freeze\n';
  const p = P.parseProject(text);
  assert.deepEqual(
    p.dates.map((d) => [d.when, d.what]),
    [['2026-11-06', 'retry fix live'], ['Fri 20 Nov', 'cart fix done'], ['1 Dec 2026', 'Christmas freeze']],
  );
  const kept = P.serializeProject(p, text);
  assert.ok(kept.includes('- 2026-11-06: retry fix live') && kept.includes('- Fri 20 Nov: cart fix done'), 'unchanged dates stay bullets');
  assert.ok(!kept.includes('| --- |'), 'and gain no table head');
  p.dates.push({ when: '2026-12-20', what: 'wrap up' });
  const out = P.serializeProject(p, text);
  assert.ok(!out.includes('- 2026-11-06:'), 'no bullet survives beside the table');
  assert.ok(out.includes('| 2026-11-06 | retry fix live |'), 'the old bullet is a row now');
  assert.ok(out.includes('| Fri 20 Nov | cart fix done |'), 'a weekday lead reads too');
  // Bullets beside a table stay as written until the dates change; then they join the one table. Anything else in
  // the section stays as written, never dropped.
  const mixed = '---\ntype: project\n---\n# Cart Fix\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 6 Nov 2026 | Review at 2pm | — |\n\n- 20 Nov 2026: cart fix done\n\nDates move when the build slips.\n';
  const q = P.parseProject(mixed);
  assert.equal(q.dates.length, 2, 'the table row and the bullet are both dates');
  const qkept = P.serializeProject(q, mixed);
  assert.ok(qkept.includes('- 20 Nov 2026: cart fix done'), 'the bullet stays until the dates change');
  assert.ok(qkept.includes('| 6 Nov 2026 | Review at 2pm | — |'), 'the row stays a row');
  assert.ok(qkept.includes('Dates move when the build slips.'), 'the prose stays as written');
  q.dates.push({ when: '2026-12-20', what: 'wrap up' });
  const qout = P.serializeProject(q, mixed);
  assert.ok(!qout.includes('- 20 Nov 2026:'), 'the bullet joined the table');
  assert.ok(qout.includes('Dates move when the build slips.'), 'the prose stays as written');
});

// A tick never reformats a person's list-form key dates (5 Nov 2026 polish list item 6: v8 F12 rewrote dated
// bullets as table rows on any save, so ticking a step reformatted the Key dates section too).
test('a tick leaves list-form key dates as written', () => {
  const text = '---\ntype: project\n---\n# Cart Fix\n\n## What’s next\n\n- [ ] Retry the fix\n\n## Key dates\n\n- 2026-11-06: retry fix live\n- **1 Dec 2026** — Christmas freeze\n';
  const p = P.parseProject(text);
  assert.equal(p.dates.length, 2, 'the bullets read as dates');
  p.next[0].done = true;
  const out = P.serializeProject(p, text);
  assert.ok(out.includes('- [x] Retry the fix'), 'the step ticked');
  assert.ok(out.includes('- 2026-11-06: retry fix live\n- **1 Dec 2026** — Christmas freeze'), 'the bullets stay bullets, byte for byte');
  assert.ok(!out.includes('| --- |'), 'no table written for dates nobody touched');
});
