// node --test tests/today.test.mjs — Today (src/shared/today.ts; 17 Oct 2026): what is due and overdue across projects
// (with who), the projects at risk, what waits on other people (longest first), what changed since yesterday, today's
// meetings and automations, dates read as people write them and snoozed in the file's own style. Made-up projects; every
// date relative to a fixed today (Saturday 17 October 2026).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-today-'));
let T, P, MT;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  P = T;
  const mainEntry = path.join(work, 'main-entry.ts');
  writeFileSync(mainEntry, `export * from ${JSON.stringify(path.join(root, 'src/main/today.ts'))};`);
  await build({ input: mainEntry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'tm.mjs'), format: 'esm' }, logLevel: 'silent' });
  MT = await import(pathToFileURL(path.join(work, 'tm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 17, 9, 30); // Saturday 17 October 2026, 9:30 am
const at = (days, hours = 10) => new Date(2026, 9, 17 + days, hours).getTime();
const iso = (days) => { const d = new Date(2026, 9, 17 + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Made-up projects: a bakery and an IT shop, owned (mostly) by Mia Tran.
const files = {
  'Projects/Studio Upgrade/Studio Upgrade.md': `---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 90\nowner: Mia Tran\ndue: "${iso(5)}"\n---\n# Studio Upgrade\n\n## What’s next\n\n- [ ] Send the reconciliation to finance — Mia · by 17 Oct\n- [ ] Chase the spare tills — Shift leads · by 14 Oct\n- [ ] Book the Sydney wave — Priya\n- [x] Export the device inventory — Mia · by 10 Oct\n- [ ] Order spare tills — me · by Tue 20 Oct\n- [ ] Write the wrap-up — Mia · by 30 Nov\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 9 Sep 2026 | Scope signed off | done |\n| 30 Sep 2026 | First target | missed |\n| ${iso(5)} | All stores upgraded | on track |\n\n## Risks and issues\n\n- **High** — 11 spare tills can’t be reached remotely\n- **Medium** — 5 tills under 30 GB free\n- **High** — The vendor’s patch is late *Closed:* 15 Oct 2026\n\n## Updates\n\n- **17 Oct 2026** — 212 of 236 tills done. *From:* Status.xlsx\n- **16 Oct 2026** — Reconciliation v4 ready.\n- **14 Oct 2026** — Inventory reconciled.\n`,
  'Projects/Winter Menu/Winter Menu.md': `---\ntype: project\nstatus: active\nhealth: off track\nprogress: 60\nowner: Mia Tran\ndue: "${iso(-2)}"\n---\n# Winter Menu\n\n## What’s next\n\n- [ ] Photograph the soups — Alex Lee · by 2026-10-15\n- [ ] Print the menu cards — Alex\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 18/10/2026 | Tasting day | planned |\n| 12 Oct 2026 | Supplier call | |\n`,
  'Projects/Harbour Fit-out/Harbour Fit-out.md': `---\ntype: project\nstatus: planning\nhealth: on track\nprogress: 30\nowner: Mia Tran\ndue: "2026-12-12"\n---\n# Harbour Fit-out\n\n## What’s next\n\n- [ ] Approve the lighting quote — Mia · by Oct 24, 2026\n\n## Risks and issues\n\n- **Critical** — The lease isn’t signed\n`,
  'Projects/Old Review/Old Review.md': `---\ntype: project\nstatus: done\nhealth: off track\nowner: Sam\ndue: "${iso(-30)}"\n---\n# Old Review\n\n## What’s next\n\n- [ ] Never finished — Sam · by 1 Oct\n`,
};
const projects = () =>
  Object.entries(files).map(([p, text], i) => ({ path: p, version: `v${i}`, modified: at(-10 + i), project: P.parseProject(text, p) }));
const notes = [
  { path: 'Projects/Studio Upgrade/Activity/Fix the till report.md', title: 'Fix the till report', mtime: at(0, 8), props: { status: 'done' } },
  { path: 'Projects/Studio Upgrade/Activity/Older task.md', title: 'Older task', mtime: at(-3), props: { status: 'done' } },
  { path: 'Projects/Winter Menu/Tasting notes.md', title: 'Tasting notes', mtime: at(-1, 15), props: {} },
  { path: 'Meetings/Supplier call.md', title: 'Supplier call', mtime: at(-1), props: { date: '2026-10-17', time: '14:00', attendees: ['Mia Tran', 'Western Plains Mill'] } },
  { path: 'Meetings/2026-10-17 Stand-up.md', title: '2026-10-17 Stand-up', mtime: at(0, 7), props: {} },
  { path: 'Meetings/Kick-off.md', title: 'Kick-off', mtime: at(-30), props: { date: '2026-09-14' } },
  { path: 'Daily/2026-10-17.md', title: '2026-10-17', mtime: at(0, 7), props: {} },
  { path: 'Notes/Ideas.md', title: 'Ideas', mtime: at(0), props: { date: '2026-10-17' } },
];

test('health reads whole words: "offer" is not off track, "delivered" is not red', () => {
  assert.equal(T.toneOf('Offer extended'), 'none');
  assert.equal(T.toneOf('Delivered'), 'ok', '"delivered" is done, never red (one standing, 8 Nov 2026)');
  assert.equal(T.toneOf('Something came up'), 'none');
  assert.equal(T.toneOf('Off track'), 'bad');
  assert.equal(T.toneOf('Blocked'), 'bad');
  assert.equal(T.toneOf('At risk'), 'warn');
  assert.equal(T.toneOf('On track'), 'ok');
});

test('dates are read as people write them, against today', () => {
  const off = (s) => T.readDay(s, TODAY)?.offset ?? null;
  assert.equal(off('2026-10-17'), 0);
  assert.equal(off('17 Oct 2026'), 0);
  assert.equal(off('18 October'), 1);
  // Reason changed (6 Nov 2026, HOLD 5): a weekday beside a date must fall on it — 20 Oct 2026 is
  // a Tuesday, so the fixture's old "Mon 20 Oct" is doubtful words now, never a guessed day.
  assert.equal(off('Tue 20 Oct'), 3);
  assert.equal(off('Mon 20 Oct'), null, 'a weekday that does not fall on its date is not that day');
  assert.equal(off('by 14 Oct'), -3);
  assert.equal(off('Oct 24, 2026'), 7);
  assert.equal(off('18/10/2026'), 1, 'day first, as in Australia');
  assert.equal(off('today'), 0);
  assert.equal(off('tomorrow'), 1);
  assert.equal(off('Friday'), null, 'a weekday alone is not a day');
  assert.equal(off('TBC'), null);
  assert.equal(off('31 Feb 2026'), null);
  // No year: the one nearest today (in December, "10 Jan" is next month).
  assert.equal(T.readDay('10 Jan', new Date(2026, 11, 20)).year, 2027);
  assert.equal(T.readDay('20 Dec', new Date(2027, 0, 5)).year, 2026);
});

test('a snoozed date moves on a day or a week, written the way the file wrote it', () => {
  assert.equal(T.snoozeDate('2026-10-17', 1, TODAY), '2026-10-18');
  assert.equal(T.snoozeDate('17 Oct', 7, TODAY), '24 Oct');
  assert.equal(T.snoozeDate('17 Oct 2026', 1, TODAY), '18 Oct 2026');
  assert.equal(T.snoozeDate('17 October', 1, TODAY), '18 October');
  assert.equal(T.snoozeDate('Oct 24, 2026', 7, TODAY), 'Oct 31, 2026');
  assert.equal(T.snoozeDate('18/10/2026', 7, TODAY), '25/10/2026');
  assert.equal(T.snoozeDate('28 Dec', 7, new Date(2026, 11, 27)), '4 Jan 2027', 'a new year is written');
  // Overdue: from today, so it is never still overdue.
  assert.equal(T.snoozeDate('by 14 Oct', 1, TODAY), '18 Oct');
  assert.equal(T.snoozeDate('2026-10-10', 7, TODAY), '2026-10-24');
  assert.equal(T.snoozeDate('TBC', 1, TODAY), null);
});

test('due and overdue: steps, key dates and projects’ due dates by day, across projects, with who', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  const words = (list) => list.map((x) => `${x.projectName}: ${x.what}${x.who ? ` (${x.who})` : ''} @${x.offset}`);
  // Someone else's steps wait on them (Waiting on others), never the person's own overdue work (29 Oct 2026).
  assert.deepEqual(words(d.due.overdue), ['Winter Menu: Winter Menu is due @-2']);
  assert.ok(d.waiting.some((w) => w.what === 'Chase the spare tills') && d.waiting.some((w) => w.what === 'Photograph the soups'));
  assert.deepEqual(words(d.due.today), ['Studio Upgrade: Send the reconciliation to finance (Mia) @0']);
  assert.deepEqual(words(d.due.soon), [
    'Winter Menu: Tasting day @1',
    'Studio Upgrade: Order spare tills (me) @3',
    'Studio Upgrade: All stores upgraded @5',
    'Harbour Fit-out: Approve the lighting quote (Mia) @7',
  ]);
  // A done step, a finished or missed key date, a past date with no status, a step far off and a done project: none.
  const all = [...d.due.overdue, ...d.due.today, ...d.due.soon].map((x) => x.what);
  for (const gone of ['Export the device inventory', 'Scope signed off', 'First target', 'Supplier call', 'Write the wrap-up', 'Never finished', 'Studio Upgrade is due']) assert.ok(!all.includes(gone), gone);
  // Each line knows where it lives in its file, to tick or snooze it.
  const send = d.due.today[0];
  assert.deepEqual([send.kind, send.project, send.index, send.version, send.when, send.others], ['step', 'Projects/Studio Upgrade/Studio Upgrade.md', 0, 'v0', '17 Oct', false]);
  assert.equal(d.due.soon[0].kind, 'date');
  assert.equal(d.due.soon[0].index, 0);
  assert.equal(d.due.overdue[0].kind, 'project');
});

test('waiting on others: steps owned by someone else, the longest waiting first', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  assert.equal(d.me, 'Mia Tran', 'the person whose projects these are');
  assert.deepEqual(
    d.waiting.map((w) => `${w.who}: ${w.what}`),
    ['Shift leads: Chase the spare tills', 'Alex Lee: Photograph the soups', 'Priya: Book the Sydney wave', 'Alex: Print the menu cards'],
  );
  // "Mia", "me" and the person's full name are theirs; done steps and done projects never wait.
  assert.ok(!d.waiting.some((w) => /Mia|^me$/.test(w.who)));
  // Given a name in Settings, that is who "me" is.
  const asAlex = T.buildToday({ projects: projects(), notes, me: 'Alex Morgan' }, TODAY);
  assert.ok(asAlex.waiting.some((w) => w.who === 'Mia'));
  assert.ok(!asAlex.waiting.some((w) => w.who === 'Alex'));
});

test('with no clear owner, a step waits when it names anyone but its project’s owner', () => {
  const list = projects().map((x, i) => ({ ...x, project: { ...x.project, owner: ['Mia Tran', 'Sam Okafor', 'Alex Lee', 'Priya Shah'][i] } }));
  const d = T.buildToday({ projects: list, notes }, TODAY);
  assert.equal(d.me, null);
  assert.ok(!d.waiting.some((w) => w.who === 'Mia' && w.projectName === 'Studio Upgrade'));
  assert.ok(d.waiting.some((w) => w.who === 'Alex Lee'));
  assert.ok(T.isPerson('Alex', 'Alex Morgan'));
  assert.ok(T.isPerson('Darcy, Alex', 'Alex Morgan'));
  assert.ok(!T.isPerson('Ginny', 'Alex Morgan'));
  assert.ok(T.isPerson('me', undefined));
});

test('at risk: off track and at risk projects, and open high risks, worst first', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  assert.deepEqual(d.atRisk.map((r) => [r.projectName, r.tone, r.risks.map((x) => x.level).join(',')]), [
    ['Winter Menu', 'bad', ''],
    ['Studio Upgrade', 'warn', 'high'],
    ['Harbour Fit-out', 'ok', 'critical'],
  ]);
  assert.equal(d.atRisk[1].risks[0].what, '11 spare tills can’t be reached remotely', 'a closed risk is left out');
  assert.equal(d.atRisk[0].next, 'Photograph the soups');
});

test('changed since yesterday: updates, the host app’s task notes, the project’s notes, then its folder’s files', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  assert.deepEqual(d.changed.map((g) => g.projectName), ['Studio Upgrade', 'Winter Menu']);
  assert.deepEqual(d.changed[0].lines.map((l) => `${l.kind}: ${l.what}`), ['update: 212 of 236 tills done.', 'activity: Fix the till report', 'update: Reconciliation v4 ready.']);
  assert.equal(d.changed[0].lines[1].status, 'done');
  assert.deepEqual(d.changed[1].lines.map((l) => `${l.kind}: ${l.what}`), ['note: Tasting notes']);
  assert.equal(d.since, new Date(2026, 9, 16).getTime());
  // The folders' files, read later, join their projects (four listed, the rest counted); older ones are left out.
  const fileList = [
    ...Array.from({ length: 6 }, (_, i) => ({ project: 'Projects/Harbour Fit-out/Harbour Fit-out.md', projectName: 'Harbour Fit-out', version: 'v2', rel: `Quotes/Quote ${i}.pdf`, name: `Quote ${i}.pdf`, ext: 'pdf', modified: at(0, 9) - i * 60000 })),
    { project: 'Projects/Studio Upgrade/Studio Upgrade.md', rel: 'Status.xlsx', name: 'Status.xlsx', ext: 'xlsx', modified: at(0, 9) },
    { project: 'Projects/Studio Upgrade/Studio Upgrade.md', rel: 'Old.docx', name: 'Old.docx', ext: 'docx', modified: at(-4) },
  ];
  const w = T.withChangedFiles(d, fileList);
  assert.deepEqual(w.changed.map((g) => g.projectName), ['Studio Upgrade', 'Harbour Fit-out', 'Winter Menu']);
  const harbour = w.changed[1];
  assert.equal(harbour.lines.length, 4);
  assert.equal(harbour.files, 6);
  assert.equal(harbour.moreFiles, 2);
  assert.equal(harbour.version, 'v2');
  assert.ok(w.changed[0].lines.some((l) => l.kind === 'file' && l.rel === 'Status.xlsx'));
  assert.ok(!w.changed[0].lines.some((l) => l.rel === 'Old.docx'));
  assert.equal(w.counts.changed, 3 + 1 + 6 + 1);
  // Read again, the files replace the ones before (never listed twice).
  assert.equal(T.withChangedFiles(w, fileList).changed[0].lines.filter((l) => l.kind === 'file').length, 1);
});

test('today’s note and meetings: a Meetings note dated today by its properties or its name', () => {
  const d = T.buildToday({ projects: projects(), notes, daily: { path: 'Daily/2026-10-17.md', exists: true } }, TODAY);
  assert.deepEqual(d.daily, { path: 'Daily/2026-10-17.md', exists: true });
  assert.deepEqual(d.meetings.map((m) => [m.title, m.time ?? '', m.attendees.length]), [['Supplier call', '14:00', 2], ['2026-10-17 Stand-up', '', 0]]);
});

test('automations that run today, soonest first; none readable means the section isn’t there', () => {
  const list = [
    { id: 'a', title: 'Weekly catch-up', status: 'on', next: at(0, 16), project: { name: 'Studio Upgrade', note: 'Projects/Studio Upgrade/Studio Upgrade.md' } },
    { id: 'b', title: 'Morning brief', status: 'on', next: at(0, 11) },
    { id: 'c', title: 'Paused one', status: 'paused', next: at(0, 12) },
    { id: 'd', title: 'Tomorrow', status: 'on', next: at(1, 8) },
    { id: 'e', title: 'No time', status: 'on', next: null },
  ];
  assert.deepEqual(T.automationsToday(list, TODAY).map((a) => a.title), ['Morning brief', 'Weekly catch-up']);
  assert.equal(T.automationsToday(list, TODAY)[1].projectName, 'Studio Upgrade');
  assert.equal(T.automationsToday(null, TODAY), null);
  assert.equal(T.buildToday({ projects: [], notes: [] }, TODAY).automations, null);
});

test('the header line and the quiet All clear', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  assert.deepEqual(T.headline(d.counts).map((h) => h.words), ['1 due today', '1 overdue', '3 at risk', '4 waiting']);
  assert.equal(d.clear, false);
  const calm = T.buildToday({ projects: [{ path: 'Projects/Calm/Calm.md', version: 'v', modified: at(-3), project: P.parseProject('---\ntype: project\nhealth: on track\nowner: Mia\n---\n# Calm\n\n## What’s next\n\n- [ ] Plan next year — Mia · by 30 Nov\n', 'Projects/Calm/Calm.md') }], notes: [] }, TODAY);
  assert.equal(calm.clear, true);
  assert.deepEqual(T.headline(calm.counts), []);
});

test('an empty vault: nothing on the person yet, and any one list filling stops saying so', () => {
  const empty = T.buildToday({ projects: [], notes: [] }, TODAY);
  assert.equal(empty.projects, 0);
  assert.deepEqual([empty.due.overdue, empty.due.today, empty.due.soon, empty.due.later, empty.waiting], [[], [], [], [], []]);
  assert.equal(empty.nothingOnYou, true, 'no projects and no notes: the empty state, never a blank main column');
  assert.equal(T.buildToday({ projects: projects(), notes }, TODAY).nothingOnYou, false, 'the made-up vault has work on the person');
  // Only waiting (an undated step of someone else's): that list alone is something on the person.
  const waitingOnly = T.buildToday({ projects: [{ path: 'Projects/Wait/Wait.md', version: 'v', modified: at(-3), project: P.parseProject('---\ntype: project\nowner: Mia\n---\n# Wait\n\n## What’s next\n\n- [ ] Send the figures — Priya\n', 'Projects/Wait/Wait.md') }], notes: [] }, TODAY);
  assert.equal(waitingOnly.waiting.length, 1);
  assert.equal(waitingOnly.nothingOnYou, false, 'waiting on someone is not the empty state');
  // Only coming up (an own step within 30 days, nothing sooner): that list alone is something on the person.
  const laterOnly = T.buildToday({ projects: [{ path: 'Projects/Later/Later.md', version: 'v', modified: at(-3), project: P.parseProject('---\ntype: project\nowner: Mia\n---\n# Later\n\n## What’s next\n\n- [ ] Plan next year — Mia · by 10 Nov\n', 'Projects/Later/Later.md') }], notes: [] }, TODAY);
  assert.equal(laterOnly.due.later.length, 1);
  assert.equal(laterOnly.nothingOnYou, false, 'a deadline coming up is not the empty state');
});

test('fast with many projects', () => {
  const many = [];
  for (let i = 0; i < 600; i++) {
    const text = files['Projects/Studio Upgrade/Studio Upgrade.md'].replace(/# Studio Upgrade/, `# Project ${i}`);
    many.push({ path: `Projects/Project ${i}/Project ${i}.md`, version: `v${i}`, modified: at(-i % 30), project: P.parseProject(text, `Projects/Project ${i}/Project ${i}.md`) });
  }
  const lots = Array.from({ length: 20000 }, (_, i) => ({ path: `Projects/Project ${i % 600}/Notes/n${i}.md`, title: `n${i}`, mtime: at(-(i % 5)), props: {} }));
  const start = performance.now();
  const d = T.buildToday({ projects: many, notes: lots }, TODAY);
  const took = performance.now() - start;
  assert.equal(d.due.today.length, 600);
  assert.ok(took < 1500, `took ${Math.round(took)} ms`);
});

test('only real work is overdue, one thing once, and the deadlines ahead show', () => {
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Launch\n\n## What’s next\n\n- [ ] Send the plan to Darcy — North team, coordinated by Mia Tran · by ${iso(15)}\n- [ ] Ask for the recording — from [[Review]] — Mia Tran · by ${iso(-2)}\n- [ ] Join the alignment call — Fri 16 Oct, 11:00 AM AEDT ([[Call]])\n- [ ] Book the venue — Mia · by ${iso(-1)}\n- [ ] Programme v2 — Coach · by ${iso(-3)}\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| ${iso(-1)} | Venue booked | planned |\n| ${iso(-4)} | Alignment call | planned |\n| ${iso(-5)} | Quote validity ends | late |\n`;
  const d = T.buildToday({ projects: [{ path: 'Projects/Launch/Launch.md', version: 'v', modified: at(-1), project: P.parseProject(text, 'Launch.md') }], notes: [], me: 'Mia Tran' }, TODAY);
  const w = (list) => list.map((x) => x.what);
  assert.deepEqual(w(d.due.overdue).sort(), ['Ask for the recording', 'Book the venue', 'Join the alignment call'], 'the person’s own late steps; the coach’s is not theirs');
  assert.equal(d.due.overdue.find((x) => x.what === 'Ask for the recording').who, 'Mia Tran', '"from [[a note]] — Mia Tran" is Mia’s');
  assert.equal(d.due.overdue.find((x) => x.what === 'Join the alignment call').when, 'Fri 16 Oct, 11:00 AM AEDT', 'a day written where the owner goes is the day');
  assert.deepEqual(w(d.due.later), ['Send the plan to Darcy'], '"coordinated by Mia Tran" is hers, and a deadline 15 days off shows as Coming up');
  assert.deepEqual(w(d.due.passed), ['Alignment call', 'Quote validity ends'], 'key dates that went by are asked about, not overdue; "Venue booked" is the step on the same day, shown once');
  assert.deepEqual(w(d.waiting), ['Programme v2']);
  assert.equal(d.counts.overdue, 3);
});

test('a key date that went by with no status is asked about (passed), never dropped', () => {
  const d = T.buildToday({ projects: projects(), notes }, TODAY);
  // 'Supplier call' (Winter Menu, 12 Oct 2026, no status) went by: the project page asks about dates
  // like it (toConfirm), so Today asks too — under passed, never as overdue work.
  assert.deepEqual(
    d.due.passed.map((x) => x.what),
    ['Supplier call'],
  );
  assert.ok(![...d.due.overdue, ...d.due.today, ...d.due.soon].some((x) => x.what === 'Supplier call'), 'never overdue work');
});

test('an undated own step waits in Unscheduled instead of vanishing (9.5 fourth pass)', () => {
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Calls\n\n## What’s next\n\n- [ ] Call the supplier — Mia\n- [ ] Chase the invoice — Priya\n`;
  const d = T.buildToday({ projects: [{ path: 'Projects/Calls/Calls.md', version: 'v', modified: at(-1), project: P.parseProject(text, 'Calls.md') }], notes: [], me: 'Mia Tran' }, TODAY);
  assert.deepEqual(d.unscheduled.map((x) => x.what), ['Call the supplier']);
  assert.deepEqual([d.unscheduled[0].projectName, d.unscheduled[0].index, d.unscheduled[0].version], ['Calls', 0, 'v']);
  assert.ok(!d.unscheduled.some((x) => x.what === 'Chase the invoice'), 'someone else’s undated step waits on them');
  assert.ok(d.waiting.some((x) => x.what === 'Chase the invoice'));
  assert.equal(d.nothingOnYou, false, 'an undated own step is something on the person');
  assert.equal(d.counts.unscheduled, 1);
});

test('key dates marked finished, shipped or resolved are done; held and met stay done too (9.5 fourth pass)', () => {
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Dates\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${iso(-3)} | Old launch | Finished |\n| ${iso(-3)} | Store rollout | Shipped |\n| ${iso(-3)} | Till dispute | Resolved |\n| ${iso(-3)} | Supplier call | held |\n| ${iso(-3)} | Scope review | met |\n| ${iso(-3)} | Quote lapses | planned |\n`;
  const d = T.buildToday({ projects: [{ path: 'Projects/Dates/Dates.md', version: 'v', modified: at(-1), project: P.parseProject(text, 'Dates.md') }], notes: [], me: 'Mia Tran' }, TODAY);
  const all = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.passed].map((x) => x.what);
  for (const gone of ['Old launch', 'Store rollout', 'Till dispute', 'Supplier call', 'Scope review']) assert.ok(!all.includes(gone), gone);
  assert.ok(all.includes('Quote lapses'), 'a past date still marked coming is asked about');
});

test('a last name alone names the person; two full names that differ stay different (9.5 fourth pass)', () => {
  assert.ok(T.isPerson('Morgan', 'Alex Morgan'));
  assert.ok(T.isPerson('Lee', 'Alex Lee'));
  assert.ok(!T.isPerson('Alex Lee', 'Alex Morgan'), 'two full names that differ stay different people');
  assert.ok(!T.isPerson('Ginny', 'Alex Morgan'));
});

test('a “Meeting Notes” folder counts as meetings, like Meetings (9.5 fourth pass)', () => {
  const d = T.buildToday({ projects: [], notes: [
    { path: 'Meeting Notes/Supplier call.md', title: 'Supplier call', mtime: at(0), props: { date: '2026-10-17' } },
    { path: 'meeting notes/Stand-up.md', title: 'Stand-up', mtime: at(0), props: { date: '2026-10-17' } },
  ] }, TODAY);
  assert.deepEqual(d.meetings.map((m) => m.title).sort(), ['Stand-up', 'Supplier call']);
});

test('an activity note counts however its folder capitalises activity (9.5 fourth pass)', () => {
  const d = T.buildToday({ projects: projects(), notes: [{ path: 'Projects/Studio Upgrade/activity/fix.md', title: 'fix', mtime: at(0, 8), props: {} }] }, TODAY);
  const g = d.changed.find((x) => x.projectName === 'Studio Upgrade');
  assert.ok(g.lines.some((l) => l.kind === 'activity' && l.what === 'fix'));
});

test('a quick chore in brackets or with a hyphen still never outranks a deadline (9.5 fourth pass)', () => {
  const item = (what) => ({ id: what, kind: 'step', what, others: false, when: 'today', offset: 0, tone: 'none', project: 'p', projectName: 'P', version: 'v' });
  const ranked = T.rankNextForYou([item('[5 min] tidy the desk'), item('Pay the power bill'), item('5-min call to the bank')]).map((x) => x.what);
  assert.deepEqual(ranked, ['Pay the power bill', '[5 min] tidy the desk', '5-min call to the bank']);
});

test('changed-since and the automations’ midnight stay on the local day across daylight saving (9.5 fourth pass)', () => {
  const was = process.env.TZ;
  process.env.TZ = 'Australia/Sydney';
  try {
    const d = T.buildToday({ projects: [], notes: [] }, new Date(2026, 9, 5, 9, 0));
    assert.equal(d.since, new Date(2026, 9, 4).getTime(), 'since is the local start of yesterday, not 24h back');
    const list = [{ id: 'a', title: 'Late', status: 'on', next: new Date(2026, 9, 5, 0, 30).getTime() }];
    assert.deepEqual(T.automationsToday(list, new Date(2026, 9, 4, 9, 0)), [], 'past local midnight is tomorrow, even in the 24th hour');
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
  }
});

test('today’s meetings sort by time of day, however the time is written (9.5 fourth pass)', () => {
  const d = T.buildToday({ projects: [], notes: [
    { path: 'Meetings/Late.md', title: 'Late', mtime: at(0), props: { date: '2026-10-17', time: '14:00' } },
    { path: 'Meetings/Early.md', title: 'Early', mtime: at(0), props: { date: '2026-10-17', time: '9:30 am' } },
  ] }, TODAY);
  assert.deepEqual(d.meetings.map((m) => m.title), ['Early', 'Late']);
});

test('the folders’ files join their projects; a folder that isn’t there stays silent (9.5 fourth pass)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-today-files-'));
  try {
    writeFileSync(path.join(dir, 'Quote.pdf'), 'x');
    const texts = {
      'Projects/Here/Here.md': `---\ntype: project\nstatus: active\nowner: Mia\nfolder: ${dir}\n---\n# Here\n`,
      'Projects/Gone/Gone.md': `---\ntype: project\nstatus: active\nowner: Mia\nfolder: ${path.join(dir, 'nope')}\n---\n# Gone\n`,
    };
    const index = { allMeta: () => Object.keys(texts).map((p) => ({ path: p, label: p, title: p, mtime: at(0), props: { type: 'project' } })), content: (p) => texts[p] };
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      const out = await MT.changedFiles(index, at(-2));
      assert.ok(out.some((f) => f.name === 'Quote.pdf' && f.projectName === 'Here'));
      assert.ok(!out.some((f) => f.project === 'Projects/Gone/Gone.md'));
      assert.deepEqual(errors, [], 'a missing drive is routine, not an error line');
    } finally {
      console.error = orig;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
