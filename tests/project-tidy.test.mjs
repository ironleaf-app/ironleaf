// node --test tests/project-tidy.test.mjs — Tidy (src/shared/project-tidy.ts; 29 Oct 2026): what moves to a
// project's History note, what stays, and what is only said. A made-up project holds 15 updates, a "Merged from"
// section, ticked old steps, a done and an unconfirmed past date, a long step and two alike steps; keep + history
// must hold every original line.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tidy-'));
let T, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, 'src/shared', f));
  writeFileSync(entry, `export * as T from ${src('project-tidy.ts')};\nexport * as P from ${src('project-file.ts')};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'tidy.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ T, P } = await import(pathToFileURL(path.join(work, 'tidy.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 29); // 29 Oct 2026.
const LONG = 'Write the long handover note for the hall team covering the keys, the alarm code, the supplier list, the cleaning roster, the pack-down order and who to call when the power trips during the event';
const PROJECT = `---
type: project
status: active
updated: "2026-10-29"
---
# Hall Opening

## Summary

Open the new hall.

## What’s next

- [x] Book the hall for the launch — Ana · by 1 Oct 2026
- [x] Send the thank-you note — Ana · by 28 Oct 2026
- [ ] ${LONG} — Ana
- [ ] Email the caterer about the final menu numbers — Ana
- [ ] Email caterer about final menu numbers — Ben

## Key dates

| When | What | Status |
| --- | --- | --- |
| 20 Sep 2026 | Sign the lease | Done |
| 22 Sep 2026 | Old supplier meeting | — |
| 20 Nov 2026 | Launch day | — |

## Updates

- **28 Oct 2026** — Sent the thank-you note to the hall committee.
- **25 Oct 2026** — Update two: the painters finished the foyer.
- **22 Oct 2026** — Update three: the chairs arrived.
- **19 Oct 2026** — Update four: the sign went up.
- **16 Oct 2026** — Update five: the kitchen passed inspection.
- **13 Oct 2026** — Update six: the floor was polished.
- **10 Oct 2026** — Book the hall is booked and paid for the launch.
- **7 Oct 2026** — Update eight: the lights were fitted.
- **4 Oct 2026** — Update nine: the doors were hung.
- **1 Oct 2026** — Update ten: the lease papers were filed.
- **28 Sep 2026** — Update eleven: the first quote came in.
- **25 Sep 2026** — Update twelve: the site was measured.
- **22 Sep 2026** — Update thirteen: the agent called back.
- **19 Sep 2026** — Update fourteen: the shortlist was made.
- **16 Sep 2026** — Update fifteen: the search began.

## Merged from Old Hall Project

These words came from the old project.
- A line from the old project, kept as it was.

## Notes

My own words stay here.
`;

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const count = (list, line) => list.filter((l) => l === line).length;

test('every case moves or is said, and no line is lost', () => {
  assert.ok(LONG.length > 160, 'the long step really is long');
  const plan = T.planTidy(PROJECT, TODAY);
  const keep = P.parseProject(plan.keep);
  // a) The 10 newest updates stay; the 5 older ones move.
  assert.equal(keep.updates.length, 10);
  assert.equal(keep.updates[0].what, 'Sent the thank-you note to the hall committee.');
  const movedUpdates = plan.moves.filter((m) => m.kind === 'updates');
  assert.equal(movedUpdates.length, 5);
  assert.match(movedUpdates[0].text, /Update eleven/);
  assert.match(plan.history, /### Older updates/);
  // b) The merged-from section moves word for word, and is gone from what stays.
  assert.equal(plan.moves.filter((m) => m.kind === 'merged').length, 1);
  assert.match(plan.history, /## Merged from Old Hall Project\n\nThese words came from the old project\.\n- A line from the old project, kept as it was\./);
  assert.equal(keep.extra.some((x) => /merged/i.test(x.heading)), false);
  assert.doesNotMatch(plan.keep, /Merged from Old Hall Project/);
  // c) The ticked step last mentioned on 10 Oct (19 days ago) moves under Done; the one mentioned on 28 Oct stays.
  assert.deepEqual(plan.moves.filter((m) => m.kind === 'done').map((m) => m.words), ['Done step: Book the hall for the launch']);
  assert.match(plan.history, /### Done\n\n- \[x\] Book the hall for the launch/);
  assert.equal(keep.next.some((n) => n.what === 'Book the hall for the launch'), false);
  assert.equal(keep.next.some((n) => n.what === 'Send the thank-you note' && n.done), true);
  // d) The done past date moves; the past date with no status stays and is said, never changed.
  assert.equal(plan.moves.filter((m) => m.kind === 'dates').length, 1);
  assert.match(plan.history, /\| 20 Sep 2026 \| Sign the lease \| Done \|/);
  assert.equal(keep.dates.some((d) => d.what === 'Sign the lease'), false);
  assert.equal(keep.dates.some((d) => d.what === 'Old supplier meeting'), true, 'the unconfirmed date stays in the project');
  assert.ok(plan.said.some((s) => /dates to confirm/i.test(s) && s.includes('Old supplier meeting')), plan.said.join(' | '));
  // e) The long step is said, and stays word for word.
  assert.ok(plan.said.some((s) => /too long to scan: shorten in Details/i.test(s)), plan.said.join(' | '));
  assert.equal(keep.next.some((n) => n.what === LONG), true);
  // f) The two alike open steps are said, and both stay.
  assert.ok(plan.said.some((s) => /say the same thing/i.test(s)), plan.said.join(' | '));
  assert.equal(keep.next.filter((n) => /caterer/i.test(n.what)).length, 2);
  // The History block is dated as Tidy's own.
  assert.match(plan.history, /^## Moved by Tidy on 29 Oct 2026/);
  // Nothing lost: every original line is in keep + history at least as many times as it was written.
  const together = lines(`${plan.keep}\n${plan.history}`);
  for (const line of new Set(lines(PROJECT))) assert.ok(count(together, line) >= count(lines(PROJECT), line), `lost: ${line}`);
});

test('a milestone marked Passed moves to History with the other done dates (9.5 fourth pass)', () => {
  const plan = T.planTidy('---\ntype: project\n---\n# Shop\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 20 Sep 2026 | Passed the inspection | Passed |\n', TODAY);
  assert.equal(P.parseProject(plan.keep).dates.length, 0);
  assert.match(plan.history, /Passed the inspection/);
});

test('tidy keeps a When table’s own header in the project and in History', () => {
  const text = `---
type: project
status: active
updated: "2026-10-29"
---
# Hall Two

## What's next

- [ ] Book the hall — Ana

## Key dates

| When | What | Status |
| --- | --- | --- |
| 20 Sep 2026 | Sign the lease | Done |
| 20 Nov 2026 | Launch day | — |
`;
  const plan = T.planTidy(text, TODAY);
  assert.equal(plan.moves.filter((m) => m.kind === 'dates').length, 1);
  assert.match(plan.keep, /\| When \| What \| Status \|\n\| --- \| --- \| --- \|/, 'the header and separator stay in the project, where a row stays');
  assert.match(plan.history, /### Key dates\n\n\| When \| What \| Status \|\n\| --- \| --- \| --- \|\n\| 20 Sep 2026 \| Sign the lease \| Done \|/, 'the header and separator go to History with the rows that move');
  // Every date moves: the header is still somewhere in keep + history.
  const all = T.planTidy(text.replace('| 20 Nov 2026 | Launch day | — |', '| 21 Sep 2026 | Pay the bond | Done |'), TODAY);
  const together = lines(`${all.keep}\n${all.history}`);
  for (const line of ['| When | What | Status |', '| --- | --- | --- |']) assert.ok(count(together, line) >= 1, `kept: ${line}`);
});

test('planTidy and a plain parse and write lose no line of varied projects', () => {
  const varied = [
    // A Date table, a dateless milestone, an empty due line, the person's own section and notes.
    `---
type: project
status: active
due: ""
updated: "2026-10-29"
---
# Release Two

## Summary

Ship the release.

## What's next

- [ ] Book the hall — Ana

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 1 Sep 2026 | Lease signed | done |
| | 8.0 released | planned |
| 20 Nov 2026 | Launch day | |

## Budget

A$40k approved.

## Notes

My own words stay here.
`,
    // A When table with done rows that move, an unconfirmed row that stays, and an unread risk row.
    `---
type: project
status: active
updated: "2026-10-29"
---
# Hall Three

## What's next

- [ ] Email the caterer — Ana

## Key dates

| When | What | Status |
| --- | --- | --- |
| 20 Sep 2026 | Sign the lease | Done |
| 22 Sep 2026 | Old supplier meeting | — |
| 20 Nov 2026 | Launch day | — |

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| Real risk | High | Ana | Open |
| | Low | Ben | Open |

## Updates

- **28 Oct 2026** — Started the work.
`,
    // Other headings for the same sections, a differently headed dates table, empty cells.
    `---
type: project
status: planning
---
# Depot Three

## Next steps

- [ ] Label the racks — Ana

## Milestones

| Day | Event | State |
| --- | --- | --- |
| 2 Nov 2026 | Lease starts | planned |
| | Move day chosen | planned |

## People

- **Ana** — Owner

## Decisions

- **1 Oct 2026** — Use the north door.
`,
    // A section left over from a merge (which moves), ticked steps and many updates (some move).
    `---
type: project
status: active
updated: "2026-10-29"
---
# Merged Project

## What's next

- [x] Book the hall for the launch — Ana · by 1 Oct 2026
- [ ] Send the invites — Ana

## Updates

- **28 Oct 2026** — Book the hall is booked and paid for the launch.
- **25 Oct 2026** — Update two happened.
- **22 Oct 2026** — Update three happened.
- **19 Oct 2026** — Update four happened.
- **16 Oct 2026** — Update five happened.
- **13 Oct 2026** — Update six happened.
- **10 Oct 2026** — Update seven happened.
- **7 Oct 2026** — Update eight happened.
- **4 Oct 2026** — Update nine happened.
- **1 Oct 2026** — Update ten happened.
- **28 Sep 2026** — Update eleven happened.
- **25 Sep 2026** — Update twelve happened.

## Merged from Old Project

These words came from the old project.
- A line from the old project, kept as it was.

## Notes

Mine again.
`,
  ];
  const squash = (s) => s.split('\n').map((l) => l.replace(/\s+/g, '')).filter(Boolean);
  for (const [n, text] of varied.entries()) {
    const plain = P.serializeProject(P.parseProject(text), text);
    const plan = T.planTidy(text, TODAY);
    for (const [label, together] of [['parse and write', squash(plain)], ['tidy keep + history', squash(`${plan.keep}\n${plan.history}`)]]) {
      const want = squash(text);
      for (const line of new Set(want)) assert.ok(together.filter((l) => l === line).length >= want.filter((l) => l === line).length, `project ${n + 1}, ${label} lost: ${line}`);
    }
  }
});

test('a ticked step nobody mentioned ages by when the file last changed', () => {
  const text = `---
type: project
status: active
updated: 2026-09-01
---
# Quiet Project

## What’s next

- [x] File the old papers — Ana
- [ ] File the new papers — Ana

## Updates

- **1 Sep 2026** — Started looking at venues.
`;
  const plan = T.planTidy(text, TODAY);
  assert.deepEqual(plan.moves.filter((m) => m.kind === 'done').map((m) => m.words), ['Done step: File the old papers']);
  // The same file, changed today: nothing is old enough to move.
  const fresh = T.planTidy(text.replace('2026-09-01', '2026-10-29'), TODAY);
  assert.equal(fresh.moves.filter((m) => m.kind === 'done').length, 0);
});

test('a project with nothing to tidy moves nothing and says nothing', () => {
  const text = `---
type: project
status: active
updated: 2026-10-29
---
# Small Project

## What’s next

- [ ] Book the hall — Ana

## Updates

- **28 Oct 2026** — Started.
`;
  const plan = T.planTidy(text, TODAY);
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.history, '');
  assert.deepEqual(plan.said, []);
  assert.match(plan.keep, /Book the hall/);
});

test('the History note is made with its type and project, and new blocks go above older ones', () => {
  const made = T.historyNoteText(null, 'Hall Opening', '## Moved by Tidy on 29 Oct 2026\n\n- a');
  assert.match(made, /^---\ntype: note\nproject: Hall Opening\n---\n# Hall Opening history\n\n## Moved by Tidy on 29 Oct 2026/);
  const again = T.historyNoteText(made, 'Hall Opening', '## Moved by Tidy on 5 Nov 2026\n\n- b');
  assert.ok(again.indexOf('5 Nov 2026') < again.indexOf('29 Oct 2026'), 'newest first');
  assert.match(again, /- a/);
  assert.equal(T.historyPathFor('Projects/Hall Opening/Hall Opening.md'), 'Projects/Hall Opening/History.md');
});
