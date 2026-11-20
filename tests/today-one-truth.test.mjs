// node --test tests/today-one-truth.test.mjs — t129: the former host app's Today and Vault's Today agree,
// item for item. This half pins Vault's side of the one shared fixture (mirrored word for word in the
// former host app's tests/today-one-truth.mjs): every vector below is Vault's real answer on that fixture
// — its Today lists, the one day-shape count, the side bar count, the top five, the bills due and the
// Inbox. The former host app's test asserts its Chat-home Today, bot attention and morning brief show the
// same items and counts. Change the fixture or a rule and both tests must move together; each test fails
// without the other half's agreement.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-one-truth-'));
let T, HUB, BT, FIN, INBOX, TASKS, REM, BTAB;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const bundle = async (name, files) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, files.map((f) => `export * from ${JSON.stringify(path.join(root, f))};\n`).join(''));
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  T = await bundle('t', ['src/shared/today.ts', 'src/shared/project-file.ts']);
  HUB = await bundle('hub', ['src/shared/hub.ts']);
  BT = await bundle('bt', ['src/shared/brief-tasks.ts']);
  FIN = await bundle('fin', ['src/shared/finance.ts']);
  INBOX = await bundle('inbox', ['src/shared/inbox.ts']);
  TASKS = await bundle('tasks', ['src/shared/tasks.ts']);
  REM = await bundle('rem', ['src/shared/reminders.ts']);
  BTAB = await bundle('btab', ['src/shared/bills-table.ts']);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 4, 9, 0); // Wednesday 4 November 2026, 9:00 am
// The one fixture. Made-up bakery and IT shop work, owned by Mia Tran, with Priya Shah as the other
// name. Mirrored word for word in ns/tests/today-one-truth.mjs; change both together.
const FILES = {
  'Projects/Bakery Launch/Bakery Launch.md':
    '---\ntype: project\nstatus: active\nhealth: on track\nowner: Mia Tran\ndue: "2026-11-06"\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by 2026-11-03\n- [ ] Ice the showcase cake — Mia · by 2026-11-04\n- [ ] Plan the tasting menu — Mia · by 2026-11-09\n- [ ] Their ovens — Priya · by 2026-11-03\n- [ ] Sharpen the scorers — Zed · by 2026-11-03\n- [ ] Sketch the new sign\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 2026-11-04 | Tasting day | planned |\n\n## People\n\n- **Theo Calder** — Joiner\n',
  'Projects/IT Shop/IT Shop.md':
    '---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# IT Shop\n\n## What’s next\n\n- [ ] Patch the server — Mia · by 2026-11-02\n- [ ] Replace the back-room bulb — Mia · by 2026-09-15\n- [x] Rack the deliveries — Mia · by 2026-11-01\n',
  'Projects/Held Over/Held Over.md':
    '---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by 2026-10-31\n',
  'Tasks.md':
    '- [ ] File the BAS due 2026-11-02\n- [ ] Send the quote — Mia 📅 2026-11-04\n- [ ] Their filing — Priya · by 2026-11-03\n- [ ] Old council letter due 2026-09-15\n- [ ] Chase the menu proofs — Priya\n- [ ] Buy stamps\n- [ ] File the Smithers form — Smithers · by 2026-11-12\n- [ ] Old Priya grumble — Priya · by 2026-09-01\n- [ ] Order the display stands — Theo · by 2026-11-03\n- [ ] Send Jo the dates — Jo · by 2026-11-05\n',
  'Reminders.md': '- [ ] Call the supplier ⏰ 2026-11-04 17:00\n- [ ] Pay the cleaner ⏰ 2026-11-02 09:00\n',
  'Money/Bills/Due soon.md':
    '---\ntype: bill\nkind: Bill\namount: 45\ncycle: Once\ndue: 2026-11-07\ncategory: Utilities\nstatus: Active\n---\n## Notes\n\n',
  'Money/Bills/Once overdue old.md':
    '---\ntype: bill\nkind: Bill\namount: 120\ncycle: Once\ndue: 2026-10-01\ncategory: Loans and cards\nstatus: Active\n---\n## Notes\n\n',
  'Money/Bills/Monthly cycled.md':
    '---\ntype: bill\nkind: Bill\namount: 80\ncycle: Monthly\ndue: 2026-09-15\npaid: 2026-09-15\ncategory: Utilities\nstatus: Active\n---\n## Notes\n\n',
  'Money/Bills/Paused.md':
    '---\ntype: bill\nkind: Subscription\namount: 18.99\ncycle: Monthly\ndue: 2026-11-05\ncategory: Subscriptions\nstatus: Paused\n---\n## Notes\n\n',
  'Money/Bills.md':
    '---\ntype: bills-table\ntable: bills\nversion: 1\n---\n# Bills\n\n| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Harbour Internet | Bill | 95 | Monthly | 2026-11-05 | Utilities |  |  | No | Active |  |  |\n',
  'People/Priya Shah.md': '---\ntype: person\n---\n# Priya Shah\n\nBakery fit-out contact.\n',
  'Meetings/Nov planning.md': '---\ntype: meeting\nattendees: Jo Park\ndate: 2026-11-04\n---\n# Nov planning\n\nNovember fit-out planning session.\n',
  'Inbox.md': '- Call the plumber about the shop sink\n- [ ] Book the van for Friday\n',
};
const titleOf = (p) => p.split('/').pop().replace(/\.md$/, '');
const projectsOf = () =>
  Object.entries(FILES)
    .filter(([p]) => p.startsWith('Projects/'))
    .map(([p, text], i) => ({ path: p, version: `v${i}`, modified: NOW.getTime() - 3 * 86400000, project: T.parseProject(text, p) }));
// The hub's entries for the fixture notes, the way the main side shapes them (DueTask/DueEntry from the
// finders' lines, titles from paths).
const hubOf = () => {
  const tasks = [];
  const reminders = [];
  for (const p of ['Tasks.md', 'Reminders.md']) {
    for (const t of HUB.findTasks(FILES[p], NOW)) {
      const words = HUB.taskDue(t.text, NOW).words || t.text;
      tasks.push({ key: HUB.taskKey(p, t.text, 0), path: p, title: titleOf(p), line: t.line, text: t.text, words, due: t.due });
    }
    for (const r of REM.findReminders(FILES[p])) reminders.push({ key: REM.reminderKey(p, r), path: p, title: titleOf(p), ...r });
  }
  return HUB.groupDue(tasks, reminders, NOW.getTime());
};
// A hub entry's words for the owner reading (TodayView's dueOwnerText: a reminder's text, a task's words).
const ownerText = (e) => (e.kind === 'reminder' ? e.item.text : e.item.words);

test('Vault Today on the fixture: the day lists, waiting and the quiet corners', () => {
  const d = T.buildToday({ projects: projectsOf(), notes: [] }, NOW);
  assert.equal(d.me, 'Mia Tran', 'the day is Mia’s: two live projects carry her name');
  assert.deepEqual(
    d.due.overdue.map((x) => `${x.what} [${x.kind} ${x.offset}]`),
    ['Patch the server [step -2]', 'Order flour [step -1]'],
    'late steps, oldest first',
  );
  assert.deepEqual(
    d.due.today.map((x) => `${x.what} [${x.kind} ${x.offset}]`),
    ['Ice the showcase cake [step 0]'],
    'today: the step; the key date on the same day folds into it, shown once',
  );
  assert.deepEqual(
    d.due.soon.map((x) => `${x.what} [${x.kind} ${x.offset}]`),
    ['Bakery Launch is due [project 2]', 'Plan the tasting menu [step 5]'],
    'this week: the project due and the step, soonest first',
  );
  assert.deepEqual(d.due.later, [], 'nothing coming up past the week');
  assert.deepEqual(d.due.passed, [], 'no passed dates to confirm');
  assert.deepEqual(
    d.due.stale.map((x) => x.what),
    ['Replace the back-room bulb'],
    'stale: the 50-day-old step, in the quiet group apart',
  );
  assert.deepEqual(
    d.waiting.map((w) => `${w.what} — ${w.who}`),
    ['Their ovens — Priya', 'Sharpen the scorers — Zed'],
    'waiting on others: their steps only, never an own step — a stranger’s step waits too',
  );
  assert.deepEqual(
    d.unscheduled.map((x) => x.what),
    ['Sketch the new sign'],
    'unscheduled: the own step with no day',
  );
  assert.deepEqual(d.dormantOpen, [{ project: 'Projects/Held Over/Held Over.md', projectName: 'Held Over', finished: false, open: 1 }], 'the on-hold project names its one open task quietly');
  assert.ok(!JSON.stringify(d).includes('Held late job') || JSON.stringify(d.dormantOpen).includes('Held Over'), 'the held step counts nowhere but the quiet line');
});

test('the notes’ dated lines group by day, own and others’ apart', () => {
  const g = hubOf();
  const words = (list) => list.map((e) => `${ownerText(e)} @${e.day}`);
  assert.deepEqual(words(g.overdue), ['Pay the cleaner @2026-11-02', 'File the BAS @2026-11-02', 'Order the display stands — Theo @2026-11-03', 'Their filing — Priya @2026-11-03'], 'overdue notes’ lines');
  assert.deepEqual(words(g.today), ['Call the supplier @2026-11-04', 'Send the quote — Mia @2026-11-04'], 'today’s note lines');
  assert.deepEqual(words(g.week), ['Send Jo the dates — Jo @2026-11-05'], 'this week’s note lines');
  assert.deepEqual(words(g.later), ['File the Smithers form — Smithers @2026-11-12'], 'later: the stranger’s line, still listed');
  assert.deepEqual(words(g.stale), ['Old Priya grumble — Priya @2026-09-01', 'Old council letter @2026-09-15'], 'stale: old lines, oldest first');
  assert.deepEqual(
    g.undated.map((t) => t.words),
    ['Chase the menu proofs — Priya', 'Buy stamps'],
    'no day: theirs and ours wait in No date',
  );
});

test('known people, the one day-shape count and the side bar count', () => {
  const d = T.buildToday({ projects: projectsOf(), notes: [] }, NOW);
  // knownPeople reads person notes and project owners (metas’ props below repeat the fixture’s own
  // front matter, asserted line by line so the two cannot drift apart silently).
  const props = {
    'Projects/Bakery Launch/Bakery Launch.md': { type: 'project', owner: 'Mia Tran' },
    'Projects/IT Shop/IT Shop.md': { type: 'project', owner: 'Mia Tran' },
    'Projects/Held Over/Held Over.md': { type: 'project', owner: 'Mia Tran' },
    'People/Priya Shah.md': { type: 'person' },
    'Meetings/Nov planning.md': { type: 'meeting', attendees: 'Jo Park' },
  };
  for (const [p, pr] of Object.entries(props)) for (const [k, v] of Object.entries(pr)) assert.ok(FILES[p].includes(`${k}: ${v}`), `${p} writes ${k}: ${v}`);
  const metas = Object.keys(FILES).map((p) => ({ path: p, title: titleOf(p), props: props[p] ?? {} }));
  const known = TASKS.knownPeople(metas, (p) => FILES[p]);
  assert.deepEqual(known, ['Mia Tran', 'Theo Calder', 'Priya Shah', 'Jo Park'], 'known: the owner, the People table, the person note and the meeting attendee');
  const g = hubOf();
  const own = [...g.overdue, ...g.today, ...g.week, ...g.later, ...g.stale].filter((e) => T.isOwnText(ownerText(e), d.me, NOW, known));
  assert.deepEqual(
    own.map((e) => `${ownerText(e)} @${e.day}`),
    ['Pay the cleaner @2026-11-02', 'File the BAS @2026-11-02', 'Call the supplier @2026-11-04', 'Send the quote — Mia @2026-11-04', 'File the Smithers form — Smithers @2026-11-12', 'Old council letter @2026-09-15'],
    'own dated lines (TodayView’s ownNoteDated): a stranger’s mention is never debt',
  );
  const theirs = [...g.overdue, ...g.today, ...g.week, ...g.later].filter((e) => !T.isOwnText(ownerText(e), d.me, NOW, known));
  assert.deepEqual(
    theirs.map((e) => `${ownerText(e)} @${e.day}`),
    ['Order the display stands — Theo @2026-11-03', 'Their filing — Priya @2026-11-03', 'Send Jo the dates — Jo @2026-11-05'],
    'others’ fresh lines sit under Waiting with the steps',
  );
  assert.deepEqual(
    g.undated.filter((t) => !T.isOwnText(t.words, d.me, NOW, known)).map((t) => t.words),
    ['Chase the menu proofs — Priya'],
    'others’ dateless lines wait too',
  );
  assert.deepEqual(
    (g.stale ?? []).filter((e) => !T.isOwnText(ownerText(e), d.me, NOW, known)).map((e) => ownerText(e)),
    ['Old Priya grumble — Priya'],
    'others’ stale lines sit in the quiet group, never in Waiting’s count',
  );
  const projectSteps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale].filter((x) => x.kind === 'step');
  assert.deepEqual(T.dayShapeCounts(projectSteps, own.map((e) => e.day), NOW), { late: 4, today: 3, week: 1 }, 'one rule: late, today and this week over the rows shown');
  assert.equal(T.sidebarTodayCount(d, { ...g, known }, NOW), 7, 'the side bar: late plus today');
});

test('the top five rank steps and own note lines as one list', () => {
  const d = T.buildToday({ projects: projectsOf(), notes: [] }, NOW);
  const g = hubOf();
  const known = ['Mia Tran', 'Theo Calder', 'Priya Shah', 'Jo Park'];
  const own = [...g.overdue, ...g.today, ...g.week, ...g.later, ...g.stale].filter((e) => T.isOwnText(ownerText(e), d.me, NOW, known));
  const projectSteps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale].filter((x) => x.kind === 'step');
  const five = BT.topFiveFor(projectSteps, own, NOW, 5).map((w) => (w.kind === 'step' ? w.step.what : ownerText(w.entry)));
  assert.deepEqual(five, ['Patch the server', 'Pay the cleaner', 'File the BAS', 'Order flour', 'Ice the showcase cake'], 'latest first by day, steps and notes together');
  const fromTexts = BT.topFiveFromProjectTexts(
    Object.entries(FILES).map(([p, text]) => ({ path: p, text, modified: 0 })),
    NOW,
    undefined,
    known,
  ).map((w) => (w.kind === 'step' ? w.step.what : ownerText(w.entry)));
  assert.deepEqual(fromTexts, five, 'the files read straight through the same rank give the same five');
  assert.equal(T.isOwnText('File the Smithers form — Smithers', d.me, NOW, known), true, 'a stranger’s mention is never debt, against the known list');
  assert.equal(T.isOwnText('File the Smithers form — Smithers', d.me, NOW), false, 'without the list every name reads as before');
});

test('the bills due: overdue of any age or due within the week ahead', () => {
  // FinanceNote props repeat the fixture’s own front matter, asserted line by line below.
  const bills = [
    { name: 'Due soon', props: { amount: '45', cycle: 'Once', due: '2026-11-07', category: 'Utilities', status: 'Active' } },
    { name: 'Once overdue old', props: { amount: '120', cycle: 'Once', due: '2026-10-01', category: 'Loans and cards', status: 'Active' } },
    { name: 'Monthly cycled', props: { amount: '80', cycle: 'Monthly', due: '2026-09-15', paid: '2026-09-15', category: 'Utilities', status: 'Active' } },
    { name: 'Paused', props: { amount: '18.99', cycle: 'Monthly', due: '2026-11-05', category: 'Subscriptions', status: 'Paused' } },
  ];
  for (const b of bills) {
    const text = FILES[`Money/Bills/${b.name}.md`];
    for (const [k, v] of Object.entries(b.props)) assert.ok(text.includes(`${k}: ${v}`), `${b.name} writes ${k}: ${v}`);
  }
  const rows = BTAB.readBillsTable(FILES['Money/Bills.md']).rows;
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Harbour Internet'],
    'the Bills list holds the bill that lives as a row',
  );
  const model = FIN.financeModel(
    [
      ...bills.map((b) => ({ path: `Money/Bills/${b.name}.md`, title: b.name, type: 'bill', props: b.props, content: FILES[`Money/Bills/${b.name}.md`] })),
      ...rows.map((r) => ({ path: `Money/Bills.md`, title: r.name, type: 'bill', props: { ...r.cells }, content: '' })),
    ],
    NOW,
  );
  assert.deepEqual(
    model.bills.map((b) => `${b.name}: next=${b.next} days=${b.days} overdue=${b.overdue}`),
    ['Due soon: next=2026-11-07 days=3 overdue=false', 'Once overdue old: next=2026-10-01 days=-34 overdue=true', 'Monthly cycled: next=2026-10-15 days=-20 overdue=true', 'Paused: next=null days=null overdue=false', 'Harbour Internet: next=2026-11-05 days=1 overdue=false'],
    'each bill’s next day: cycles roll on, paid covers its cycle, paused has none, rows read as notes',
  );
  assert.deepEqual(
    FIN.billsDue(model.bills, 7, '2026-11-04').map((b) => `${b.name}@${b.next}`),
    ['Once overdue old@2026-10-01', 'Monthly cycled@2026-10-15', 'Harbour Internet@2026-11-05', 'Due soon@2026-11-07'],
    'due: overdue of any age plus the week ahead, soonest first, paused out',
  );
});

test('the Inbox holds two captures waiting to be filed', () => {
  const items = INBOX.inboxLines(FILES['Inbox.md']);
  assert.equal(items.length, 2, 'two captures wait');
  assert.deepEqual(
    items.map((i) => i.words),
    ['Call the plumber about the shop sink', 'Book the van for Friday'],
    'their words',
  );
});

test('the host app’s side bar count reads this same rule (the chain’s Vault end)', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('sidebarTodayCount(todayData(index, undefined), hub.due(), new Date())'), 'todayCount answers the side bar’s own query');
});
