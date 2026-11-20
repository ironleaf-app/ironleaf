// node --test tests/layouts.test.mjs — project layouts (src/shared/layouts.ts; docs/LAYOUTS.md, 21 Oct 2026): log notes read
// and written in the contract's format, tables, run sheets, every block on the fixtures in tests/fixtures/layouts (one
// project per layout, their logs, a project with no layout, one with its own blocks), the one-liners, the suggestion from
// structure (never topic), the project edits a layout needs, and the ready-made project for each preset.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'layouts');
const work = mkdtempSync(path.join(tmpdir(), 'nv-layouts-'));
let L, P, F, M, S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['l', 'src/shared/layouts.ts'], ['p', 'src/shared/project-file.ts'], ['f', 'src/shared/frontmatter.ts'], ['m', 'src/main/templates.ts'], ['s', 'src/shared/templates.ts']])
    await build({ input: path.join(root, file), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  [L, P, F, M, S] = await Promise.all(['l', 'p', 'f', 'm', 's'].map((n) => import(pathToFileURL(path.join(work, `${n}.mjs`)).href)));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 21); // Wed 21 Oct 2026
const read = (name) => readFileSync(path.join(fixtures, `${name}.md`), 'utf8');
/** A fixture project as the window gets it: the project, its properties and its logs. */
function input(name) {
  const text = read(name);
  const logs = readdirSync(fixtures)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, text: readFileSync(path.join(fixtures, f), 'utf8') }))
    .filter((x) => L.isLogProps(F.readProps(x.text)))
    .map((x) => ({ ...L.parseLog(x.text, TODAY), path: `Projects/${x.f}`, title: x.f.replace(/\.md$/, '') }));
  const project = P.parseProject(text, `Projects/${name}.md`);
  return { project, props: F.readProps(text), logs: L.logsFor(logs, project.name, `Projects/${name}/${name}.md`), today: TODAY };
}
const block = (name, type) => L.dashboard(input(name)).find((m) => m.type === type);

// ── Log notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('milestone tones read whole words: "something" is not met, "pending review" waits', () => {
  const tones = (status) => L.milestones({ dates: [{ when: '', what: 'X', status }] }, TODAY)[0].tone;
  assert.equal(tones('Something came up'), 'none');
  assert.equal(tones('Unmet needs'), 'none');
  assert.equal(tones('Done pending review'), 'warn');
  assert.equal(tones('Under review'), 'warn');
  assert.equal(tones('Done'), 'ok');
  assert.equal(tones('Missed'), 'bad');
});

test('a log is read: fields, units, entries oldest first, numbers, yes/no, words and notes', () => {
  const log = L.parseLog(read('Spring Training Block log'), TODAY);
  assert.equal(log.project, 'Spring Training Block');
  assert.deepEqual(log.fields, ['Weight', 'Steps']);
  assert.deepEqual(log.units, { Weight: 'kg' });
  assert.deepEqual(log.entries.map((e) => e.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  assert.equal(log.newestFirst, false);
  const first = log.entries[0];
  assert.equal(first.label, 'Day 1');
  assert.deepEqual(first.values.Weight, { kind: 'number', n: 104.8, text: '104.8 kg' });
  assert.equal(first.values.Session.kind, 'text', 'words that start with a word stay words (not the 6 in "6 km")');
  assert.deepEqual(first.notes, ['Felt good, sore knees on the hills']);
  const habit = L.parseLog(read('Sugar-free check-ins'), TODAY);
  assert.equal(habit.project, 'Sugar-free Month', 'link brackets taken off');
  assert.equal(habit.newestFirst, true);
  assert.deepEqual(habit.entries[3].values['Sugar-free'], { kind: 'yes', yes: true, text: 'Y' });
  assert.equal(habit.entries[3].values.Cravings.n, 2, '"2/10" reads as 2');
});

test('log headings: ISO, words, a weekday with a comma, extra words; headings without a day are not entries', () => {
  const text = '---\ntype: log\n---\n## 2026-10-18\n- A: 1\n## Mon, 19 Oct 2026\n- A: 2\n## 20 Oct 2026 — after work\n- A: 3\n## Wed 21 Oct 2026, Day 4, late\n- A: 4\n## Notes\n- not an entry: 9\n## Today\n- B: 1\n';
  const log = L.parseLog(text, TODAY);
  assert.deepEqual(log.entries.map((e) => [e.date, e.values.A?.n]), [['2026-10-18', 1], ['2026-10-19', 2], ['2026-10-20', 3], ['2026-10-21', 4]]);
  assert.equal(log.entries[2].label, 'after work');
  assert.equal(log.entries[3].label, 'Day 4, late');
});

test('appending an entry: a new day goes where the person’s entries go; the same day gets its fields set; nothing else changes', () => {
  const asc = read('Spring Training Block log');
  const next = L.appendLogEntry(asc, { date: new Date(2026, 9, 22), label: 'Day 5', values: { Weight: '103.7 kg', Session: 'Strength, lower body' }, notes: ['Slept well'] }, TODAY);
  assert.ok(next.startsWith(asc.replace(/\s+$/, '')), 'everything before is kept as written');
  assert.ok(next.endsWith('## Thu 22 Oct 2026, Day 5\n\n- Weight: 103.7 kg\n- Session: Strength, lower body\n- Slept well\n'));
  assert.equal(L.parseLog(next, TODAY).entries.length, 5);
  // Newest first: the new day goes at the top, under the title.
  const desc = read('Sugar-free check-ins');
  const top = L.appendLogEntry(desc, { date: new Date(2026, 9, 22), values: { 'Sugar-free': true, Cravings: '1/10' } }, TODAY);
  assert.match(top, /# Sugar-free check-ins\n\n## Thu 22 Oct 2026\n\n- Sugar-free: Y\n- Cravings: 1\/10\n\n## Wed 21 Oct 2026, Day 4/);
  // The same day: a field it has is changed where it is, a new one added, its notes kept.
  const same = L.appendLogEntry(desc, { date: TODAY, values: { Water: 8, Mood: 'Calm' } }, TODAY);
  const day = L.parseLog(same, TODAY).entries.find((e) => e.date === '2026-10-21');
  assert.equal(day.values.Water.n, 8);
  assert.equal(day.values.Mood.text, 'Calm');
  assert.equal(day.values.Cravings.n, 2);
  assert.deepEqual(day.notes, ['Easier today']);
  assert.equal((same.match(/## Wed 21 Oct 2026/g) ?? []).length, 1, 'never a second heading for the same day');
  // A day between others, in an oldest-first log.
  const mid = L.appendLogEntry(asc.replace(/## Mon 19 Oct[\s\S]*?(?=## Tue)/, ''), { date: new Date(2026, 9, 19), values: { Weight: 104.6 } }, TODAY);
  assert.deepEqual(L.parseLog(mid, TODAY).entries.map((e) => e.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  assert.ok(mid.indexOf('## Mon 19 Oct 2026') < mid.indexOf('## Tue 20 Oct 2026'));
});

test('a new log note is in the contract’s format and reads back', () => {
  const text = L.newLogNote('Spring Training Block', { fields: ['Weight', 'Resting heart rate'], units: { Weight: 'kg' }, entry: { date: TODAY, values: { Weight: '103.9 kg', 'Resting heart rate': 61 } } }, TODAY);
  assert.match(text, /^---\ntype: log\nproject: "Spring Training Block"\nfields: \[Weight, Resting heart rate\]\nunits: \{Weight: kg\}\n---\n# Spring Training Block log\n/);
  const log = L.parseLog(text, TODAY);
  assert.equal(log.project, 'Spring Training Block');
  assert.deepEqual(log.fields, ['Weight', 'Resting heart rate']);
  assert.equal(log.entries[0].values['Resting heart rate'].n, 61);
});

test('logs belong to a project by its name (link or not, any case) or by being in its folder with no project named', () => {
  const logs = [{ path: 'Logs/a.md', project: '[[spring training block]]' }, { path: 'Projects/X/b.md' }, { path: 'Logs/c.md', project: 'Other' }, { path: 'Projects/Y/d.md' }];
  assert.deepEqual(L.logsFor(logs, 'Spring Training Block', 'Projects/X/Spring Training Block.md').map((l) => l.path), ['Logs/a.md', 'Projects/X/b.md']);
});

// ── Tables and run sheets ────────────────────────────────────────────────────────────────────────────────────────────

test('tables are read and added to by their own columns; run sheets are read and ticked in place', () => {
  const body = 'Words before.\n\n| Name | Role | Company | Contact |\n| --- | --- | --- | --- |\n| Josh | Builder | Patel | 0412 |\n\nWords after.';
  assert.deepEqual(L.readTable(body), { head: ['Name', 'Role', 'Company', 'Contact'], rows: [['Josh', 'Builder', 'Patel', '0412']] });
  const added = L.addTableRow(body, ['Name', 'Role', 'Company', 'Contact'], { contact: 'ruth@x.example', Name: 'Ruth | Kim', Role: 'Signs' });
  assert.equal(added, 'Words before.\n\n| Name | Role | Company | Contact |\n| --- | --- | --- | --- |\n| Josh | Builder | Patel | 0412 |\n| Ruth \\| Kim | Signs |  | ruth@x.example |\n\nWords after.');
  assert.deepEqual(L.readTable(added).rows[1], ['Ruth | Kim', 'Signs', '', 'ruth@x.example']);
  assert.equal(L.addTableRow('', ['Item', 'Stage'], ['First', 'Idea']), '| Item | Stage |\n| --- | --- |\n| First | Idea |');
  const sheet = '### Eight weeks out\n\n- [x] Sign the lease\n- [ ] Order internet\n\n### After\n\n- [ ] Snag list';
  const phases = L.runSheet(sheet);
  assert.deepEqual(phases.map((p) => [p.name, p.done, p.total]), [['Eight weeks out', 1, 2], ['After', 0, 1]]);
  const ticked = L.toggleRunSheetItem(sheet, phases[0].items[1].line, true);
  assert.equal(ticked, sheet.replace('- [ ] Order internet', '- [x] Order internet'));
  assert.equal(L.addRunSheetItem(sheet, 'After', 'Thank everyone'), `${sheet}\n- [ ] Thank everyone`);
  assert.equal(L.addRunSheetPhase(sheet, 'Build week', 'Power in'), `${sheet}\n\n### Build week\n\n- [ ] Power in`);
});

// ── Blocks and layouts ───────────────────────────────────────────────────────────────────────────────────────────────

test('blocks: a project’s own list wins, else its layout’s preset, else nothing (the page as it was); names forgiven', () => {
  assert.deepEqual(L.parseBlocks(['countdown', 'trend:Weight', 'Board: Pipeline', { grid: 'Register' }, 'nonsense', 'chart']), [{ type: 'countdown' }, { type: 'trend', arg: 'Weight' }, { type: 'board', arg: 'Pipeline' }, { type: 'grid', arg: 'Register' }, { type: 'trend' }]);
  assert.deepEqual(L.parseBlocks('[status, cards]'), [{ type: 'status' }, { type: 'cards' }]);
  assert.deepEqual(L.blocksOf({ layout: 'register' }), [{ type: 'grid', arg: 'Register' }]);
  assert.deepEqual(L.blocksOf({ layout: 'register', blocks: ['status'] }), [{ type: 'status' }]);
  assert.deepEqual(L.blocksOf({ layout: 'nonsense' }), []);
  assert.deepEqual(L.blocksOf({}), []);
  assert.equal(L.layoutOf({ layout: 'Tracker' }), 'fitness', 'the names shown are accepted too');
  assert.equal(L.layoutOf({ layout: 'habit' }), 'wellbeing');
  assert.deepEqual(L.LAYOUTS.map((l) => l.name), ['Programme', 'Site or event', 'Register', 'Tracker', 'Habit', 'Venture']);
});

test('programme: status band with sponsor, budget and phase; workstreams with progress; milestones; risks; next actions', () => {
  const models = L.dashboard(input('Branch Library Refresh'));
  // v10, 6 Nov 2026: Next actions sit above Milestones, back where the old page had them (Workstreams, then
  // Next actions, then the milestone rows).
  assert.deepEqual(models.map((m) => m.type), ['status', 'progress', 'actions', 'timeline']);
  const [status, progress, actions, timeline] = models;
  assert.equal(status.progress, 62);
  assert.equal(status.health, 'at risk');
  assert.deepEqual(status.due, { date: '2026-12-18', days: 58 });
  assert.deepEqual(status.facts.map((f) => [f.label, f.value]), [['Sponsor', 'Dana Whitlock'], ['Budget', 'A$1.2m capex'], ['Phase', 'Delivery']]);
  assert.equal(status.risks, 2, 'the closed row of the risks table isn’t counted');
  assert.equal(progress.mode, 'table');
  assert.deepEqual(progress.rows.map((r) => [r.name, r.progress, r.tone]), [['Shelving', 80, 'ok'], ['Kiosks', 45, 'warn'], ['Reading corners', 70, 'ok'], ['Training', 35, 'warn']]);
  assert.equal(progress.overall, 58);
  assert.deepEqual(timeline.items.map((i) => [i.date, i.tone]), [['2026-08-04', 'ok'], ['2026-09-15', 'ok'], ['2026-10-27', 'next'], ['2026-11-17', 'warn'], ['2026-12-18', 'none']]);
  assert.equal(actions.items.length, 5);
  assert.equal(actions.open, 5);
  assert.equal(actions.items[0].who, 'Sam Okafor');
  assert.deepEqual(L.layoutLine(input('Branch Library Refresh')), { words: '62% · at risk', tone: 'warn' });
});

test('site: the countdown to opening, the run sheet by phase (the named phase current), contacts, key dates', () => {
  const i = input('Harbour Street Opening');
  const [count, progress, timeline, cards] = L.dashboard(i);
  assert.equal(count.type, 'countdown');
  assert.equal(count.words, '47 days to opening');
  assert.equal(count.address, '14 Harbour Street, Geelong');
  assert.deepEqual(count.period && [count.period.week, count.period.weeks], [8, 14]);
  assert.equal(progress.mode, 'phases');
  assert.deepEqual(progress.phases.map((p) => `${p.name} ${p.done}/${p.total}`), ['Eight weeks out 3/3', 'Six weeks out 1/3', 'Build week 0/3', 'Opening day 0/2', 'After 0/1']);
  assert.equal(progress.current, 1);
  assert.equal(timeline.items.length, 4);
  assert.deepEqual(cards.cards.map((c) => c.company), ['Patel Fitouts', 'Brightline Signs', 'Bayside Fibre']);
  assert.deepEqual(L.layoutLine(i), { words: '47 days to opening', tone: 'none' });
  // On the day, and after.
  assert.equal(L.layoutLine({ ...i, today: new Date(2026, 11, 7) }).words, 'Opening is today');
  assert.equal(L.layoutLine({ ...i, today: new Date(2026, 11, 10) }).words, '3 days since opening');
  assert.equal(L.layoutLine({ ...i, props: { ...i.props, site_kind: 'close' } }).words, '47 days to closing');
});

test('register: the grid with counts by status and the quantities summed; its one line counts the things, not the rows', () => {
  const [grid] = L.dashboard(input('Spare Equipment'));
  assert.equal(grid.type, 'grid');
  assert.equal(grid.table.rows.length, 12);
  assert.deepEqual(grid.byStatus, [{ status: 'In stock', count: 7, qty: 51 }, { status: 'Allocated', count: 3, qty: 6 }, { status: 'In repair', count: 2, qty: 3 }]);
  assert.deepEqual(grid.totals, [{ col: 2, label: 'Qty', sum: 60 }]);
  assert.deepEqual(grid.units, { col: 2, label: 'Qty', sum: 60 }, 'a Qty column: each row holds that many');
  assert.deepEqual(L.layoutLine(input('Spare Equipment')), { words: '60 spare items · 3 in repair', tone: 'warn' });
});

test('tracker (layout: fitness): week of the block, the weight against its start and target, sessions this week, the latest entry, the plan', () => {
  const models = L.dashboard(input('Spring Training Block'));
  assert.deepEqual(models.map((m) => m.type), ['status', 'countdown', 'trend', 'streak', 'entry', 'grid']);
  const [status, count, trend, streak, entry, plan] = models;
  assert.equal(status.aim, 'Down to 98 kg and running 5 km without stopping by mid-December.');
  assert.deepEqual([count.period.week, count.period.weeks], [1, 8]);
  const weight = trend.series.find((s) => s.field === 'Weight');
  assert.deepEqual([weight.start, weight.latest, weight.target, weight.unit, weight.from, weight.to], [104.8, 103.9, 98, 'kg', '2026-10-18', '2026-12-12']);
  assert.deepEqual(trend.series.map((s) => s.field), ['Weight', 'Steps'], 'the log’s own fields: only these are charted');
  assert.equal(streak.field, undefined, 'no yes/no field: no grid');
  assert.deepEqual(streak.week, { label: 'sessions', count: 2, of: 4, days: [true, true, false, false, false, false, false] }, '"Rest" is not a session');
  assert.equal(entry.latest.date, '2026-10-21');
  assert.deepEqual(entry.fields.map((f) => [f.name, f.kind, f.unit]), [['Weight', 'number', 'kg'], ['Steps', 'number', ''], ['Session', 'text', '']]);
  assert.equal(plan.table.rows.length, 5);
  assert.deepEqual(L.layoutLine(input('Spring Training Block')), { words: 'Week 1 of 8 · 103.9 kg', tone: 'none' });
});

test('habit (layout: wellbeing): day of the streak, the next milestone, the last 14 days, the trends and the latest entry', () => {
  const [streak, trend, entry] = L.dashboard(input('Sugar-free Month'));
  assert.equal(streak.type, 'streak');
  assert.equal(streak.field, 'Sugar-free');
  assert.equal(streak.day, 4);
  assert.equal(streak.run, 4);
  assert.deepEqual(streak.next, { days: 7, left: 3, from: 0 });
  assert.deepEqual(streak.grid.slice(-5).map((g) => g.state), ['before', 'yes', 'yes', 'yes', 'yes']);
  assert.deepEqual(streak.milestones.map((m) => [m.days, m.date, m.reached]), [[7, '2026-10-24', false], [14, '2026-10-31', false], [30, '2026-11-16', false], [90, '2027-01-15', false]]);
  assert.deepEqual(trend.series.map((s) => [s.field, s.latest, s.unit]), [['Cravings', 2, ''], ['Sleep', 7.5, 'h'], ['Water', 7, 'glasses']]);
  assert.equal(entry.latest.notes[0], 'Easier today');
  assert.deepEqual(L.layoutLine(input('Sugar-free Month')), { words: 'Day 4 sugar-free', tone: 'ok' });
  // A day logged "no" ends the run (and the grid shows it).
  const i = input('Sugar-free Month');
  const broke = L.parseLog(L.appendLogEntry(read('Sugar-free check-ins'), { date: new Date(2026, 9, 20), values: { 'Sugar-free': 'N' } }, TODAY), TODAY);
  const s2 = L.blockModel({ type: 'streak' }, { ...i, logs: [broke] });
  assert.equal(s2.run, 1);
  assert.equal(s2.best, 2);
  assert.equal(s2.grid[12].state, 'no');
});

test('venture: the stage on its path, the pipeline as a board (won last, overdue marked), what’s due on a timeline, contacts, the site', () => {
  const [status, board, timeline, cards] = L.dashboard(input('Tidewater Ceramics'));
  assert.deepEqual(status.steps, { key: 'stage', names: ['Idea', 'Building', 'Launched', 'Growing'], current: 1 });
  assert.deepEqual(status.facts.map((f) => [f.label, f.kind]), [['Site', 'link']]);
  assert.deepEqual(board.columns.map((c) => [c.stage, c.items.length]), [['Talking', 2], ['Proposal', 1], ['Idea', 1], ['Won', 1]]);
  assert.equal(board.columns[0].items.find((x) => x.title === 'Saltbush Kitchen').overdue, true);
  assert.equal(board.columns[3].items[0].overdue, false, 'a won deal is never overdue');
  assert.deepEqual(timeline.items.map((x) => x.what), ['Wholesale price list', 'Studio open day', 'Online shop soft launch']);
  assert.equal(cards.cards.length, 2);
  assert.deepEqual(L.layoutLine(input('Tidewater Ceramics')), { words: 'Building · 4 open in pipeline · 1 overdue', tone: 'warn' });
});

test('a project’s own blocks: any table read as a board and a timeline, a countdown to its due date', () => {
  const i = input('Quarterly Hiring');
  const models = L.dashboard(i);
  assert.deepEqual(models.map((m) => m.type), ['countdown', 'board', 'timeline']);
  assert.equal(models[0].words, '40 days to the due date');
  assert.deepEqual(models[1].columns.map((c) => c.stage), ['Interview', 'Screening', 'Offer']);
  assert.equal(models[2].items[0].what, 'B. Okoro');
  assert.equal(L.layoutLine(i).words, '40 days to the due date');
});

test('empty blocks say what to add and how: rows in the contract’s columns, a milestone, an entry, a date', () => {
  const p = P.parseProject('---\ntype: project\nlayout: venture\n---\n# New thing\n');
  const models = L.dashboard({ project: p, props: { layout: 'venture', blocks: ['countdown:go_live', 'board:Pipeline', 'timeline', 'trend', 'entry', 'progress:Run sheet', 'cards'] }, logs: [], today: TODAY });
  assert.ok(models.every((m) => m.empty));
  assert.deepEqual(models.map((m) => m.add), [
    { kind: 'prop', key: 'go_live', label: 'Set the date for go-live', date: true },
    { kind: 'row', section: 'Pipeline', head: ['Item', 'Stage', 'Owner', 'Due', 'Notes'] },
    { kind: 'date' },
    { kind: 'entry' },
    { kind: 'entry' },
    { kind: 'phase', section: 'Run sheet' },
    { kind: 'row', section: 'Suppliers and contacts', head: ['Name', 'Role', 'Company', 'Contact'] },
  ]);
  // A preset steps its empty optional blocks aside once something else shows (a timeline with no dates among them).
  const reg = L.dashboard({ project: p, props: { layout: 'programme' }, logs: [], today: TODAY });
  assert.deepEqual(reg.map((m) => m.type), ['status', 'progress']);
});

// ── The suggestion: from structure, never from topic ─────────────────────────────────────────────────────────────────

test('a project without a layout gets a suggestion from its structure only', () => {
  const i = input('Riverside Pop-up');
  const s = L.suggestLayout(i.project, i.props, i.logs);
  assert.equal(s.layout, 'site');
  assert.equal(s.why, 'This project has a go-live date and a run sheet in phases');
  // Topic words alone never suggest anything.
  const words = P.parseProject('---\ntype: project\n---\n# Gym and weight\n\n## Summary\n\nGym three times a week, weigh in on Sundays, sober October, launch the Etsy shop, cafe opening and stocktake.\n');
  assert.equal(L.suggestLayout(words, {}, []), null);
  // Logs: yes/no days → Habit; numbers → Tracker.
  const plain = P.parseProject('---\ntype: project\n---\n# Something\n');
  assert.equal(L.suggestLayout(plain, {}, [L.parseLog(read('Sugar-free check-ins'), TODAY)]).layout, 'wellbeing');
  assert.equal(L.suggestLayout(plain, {}, [L.parseLog(read('Spring Training Block log'), TODAY)]).layout, 'fitness');
  // A table with progress per row → Programme; with stages → Venture; a long one with status → Register.
  const table = (head, rows) => `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
  const withSection = (h, body) => P.parseProject(`---\ntype: project\n---\n# X\n\n## ${h}\n\n${body}\n`);
  assert.equal(L.suggestLayout(withSection('Streams', table(['Name', 'Progress'], [['A', '10'], ['B', '50']])), {}, []).layout, 'programme');
  assert.equal(L.suggestLayout(withSection('Deals', table(['Item', 'Stage'], [['A', 'Idea'], ['B', 'Won']])), {}, []).layout, 'venture');
  assert.equal(L.suggestLayout(withSection('Kit', table(['Item', 'Status'], Array.from({ length: 9 }, (_, n) => [`Thing ${n}`, 'Ok']))), {}, []).layout, 'register');
  // Already laid out: nothing to suggest.
  assert.equal(L.suggestLayout(i.project, { ...i.props, layout: 'site' }, []), null);
  assert.equal(L.suggestLayout(i.project, { ...i.props, blocks: ['countdown'] }, []), null);
});

// ── The project edits a layout needs ─────────────────────────────────────────────────────────────────────────────────

test('layout, a property of the person’s own, and a section: set, written back, everything else kept', () => {
  const text = read('Harbour Street Opening');
  const p = P.parseProject(text);
  assert.equal(p.layout, 'site');
  const once = P.serializeProject(p, text);
  assert.match(once, /\| Date \| Milestone \| Status \|/, 'the Key dates header kept as written');
  assert.equal(P.serializeProject(P.parseProject(once), once), once, 'and stable from then on');
  assert.equal(P.applyProjectEdit(p, { kind: 'set', field: 'layout', value: 'programme' }), 'Set the layout to Programme.');
  assert.throws(() => P.applyProjectEdit(p, { kind: 'set', field: 'layout', value: 'dashboard' }), /isn’t one Ironleaf knows/);
  assert.equal(P.applyProjectEdit(p, { kind: 'prop', key: 'go_live', value: '2026-12-14' }), 'Set go live to “2026-12-14”.');
  assert.equal(P.applyProjectEdit(p, { kind: 'prop', key: 'budget', value: 'A$40k' }), 'Set budget to “A$40k”.');
  assert.throws(() => P.applyProjectEdit(p, { kind: 'prop', key: 'health', value: 'x' }), /can’t be set here/);
  const body = L.addTableRow(L.sectionText(p, 'Suppliers and contacts'), ['Name', 'Role', 'Company', 'Contact'], ['Ana Silva', 'Furniture', 'Coastal', 'ana@x.example']);
  assert.equal(P.applyProjectEdit(p, { kind: 'section', heading: 'Suppliers and contacts', body }), 'Changed “Suppliers and contacts”.');
  assert.equal(P.applyProjectEdit(p, { kind: 'section', heading: 'Workstreams', body: '| Workstream | Owner | Status | Progress | Next step |\n| --- | --- | --- | --- | --- |\n| Fit-out | Josh | on track | 20 | |' }), 'Added “Workstreams”.');
  const out = P.serializeProject(p, text);
  const props = F.readProps(out);
  assert.equal(props.layout, 'programme');
  assert.equal(props.go_live, '2026-12-14', 'changed where it was');
  assert.equal(props.budget, 'A$40k', 'added');
  assert.equal(props.address, '14 Harbour Street, Geelong', 'the rest kept');
  assert.ok(out.indexOf('go_live: 2026-12-14') < out.indexOf('address:'), 'in its place');
  assert.match(out, /\| Ana Silva \| Furniture \| Coastal \| ana@x\.example \|/);
  assert.match(out, /## Workstreams\n\n\| Workstream/);
  assert.match(out, /\| Date \| Milestone \| Status \|/);
  assert.equal(P.applyProjectEdit(p, { kind: 'set', field: 'layout', value: null }), 'Back to the standard page.');
  assert.equal(P.applyProjectEdit(p, { kind: 'prop', key: 'budget', value: null }), 'Took off budget.');
  const back = P.serializeProject(p, out);
  assert.ok(!/^layout:/m.test(back) && !/^budget:/m.test(back));
});

// ── The ready-made project for each preset ───────────────────────────────────────────────────────────────────────────

test('each preset has a ready-made project: valid, its layout set, its dashboard showing from the first minute', () => {
  const presets = M.BUILT_INS.filter((b) => b.id.startsWith('project-layout-'));
  assert.deepEqual(presets.map((b) => `${b.folder}/${b.name}`), ['Projects/Programme', 'Projects/Site or event', 'Projects/Register', 'Projects/Tracker', 'Projects/Habit', 'Projects/Venture']);
  for (const b of presets) {
    assert.equal(S.templateKind(b.text), 'project', `${b.name}: a project template`);
    const { text } = S.projectFromTemplate(b.text, { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', name: 'Test', today: '2026-10-21' });
    assert.ok(P.isProjectText(text) && !text.includes('{{'), `${b.name}: filled`);
    const props = F.readProps(text);
    const layout = L.layoutOf(props);
    assert.ok(layout, `${b.name}: layout set (${props.layout})`);
    const p = P.parseProject(text, 'Projects/Test/Test.md');
    assert.equal(P.serializeProject(p, text), text, `${b.name}: stable`);
    const models = L.dashboard({ project: p, props, logs: [], today: TODAY });
    assert.ok(models.length > 0, `${b.name}: a dashboard`);
    const shows = models.filter((m) => !m.empty).map((m) => m.type);
    // The log-based presets wait for the first entry; the others show something straight away.
    if (!['fitness', 'wellbeing'].includes(layout)) assert.ok(shows.length > 0, `${b.name}: something shows (${models.map((m) => `${m.type}${m.empty ? ' (empty)' : ''}`).join(', ')})`);
  }
});

// ── 21 Oct 2026: what a real person writes (proved on the reorganised projects; neutral notes here) ─────────────────────

test('logs as people write them: a yes or no with words after it, a day mentioned in a bullet, the format the log shows', () => {
  assert.deepEqual(L.readLogValue('Y (first try, self-reported)'), { kind: 'yes', yes: true, text: 'Y (first try, self-reported)' });
  assert.deepEqual(L.readLogValue('N — slept in'), { kind: 'yes', yes: false, text: 'N — slept in' });
  assert.equal(L.readLogValue('not confirmed').kind, 'text');
  assert.equal(L.readLogValue('none yet').kind, 'text');
  assert.equal(L.readLogValue('No idea').kind, 'text', 'a sentence starting with No is words');
  const log = L.parseLog('---\ntype: log\nproject: Reading habit\nfields: [Pages]\nunits: {Pages: pages}\n---\n# Reading log\n\nEach evening: `- Read: Y` or `N`, `- Pages:` (a number), `- Book:` and any notes as plain bullets.\n\n## Sun 18 Oct 2026, Day 1\n- Read: Y (on the train)\n- Pages: 30\n- Book: The Long Way\n\n## Mon 19 Oct 2026, Day 2\n- Read: N (late meeting)\n- Fri 23 Oct: away, no reading planned\n- Plan: finish the book by the weekend, then start the next one on the list from the library\n\n## Tue 20 Oct 2026\n- Read: not confirmed\n', TODAY);
  assert.deepEqual(log.declared, ['Read', 'Pages', 'Book'], 'the fields its own format shows, in its order');
  assert.ok(!('Fri 23 Oct' in log.entries[1].values) && log.entries[1].notes.includes('Fri 23 Oct: away, no reading planned'), 'a day is a note, not a field');
  assert.deepEqual(L.formFields(log).map((f) => [f.name, f.kind, f.unit]), [['Read', 'yes', ''], ['Pages', 'number', 'pages'], ['Book', 'text', '']], 'the form asks the log’s own fields');
  const p = P.parseProject('---\ntype: project\nlayout: habit\nstreak_label: Read\n---\n# Reading habit\n');
  const [streak] = L.dashboard({ project: p, props: F.readProps('---\nlayout: habit\nstreak_label: Read\n---\n'), logs: [{ ...log, path: 'Projects/Reading habit/Reading log.md', title: 'Reading log' }], today: TODAY });
  assert.equal(streak.type, 'streak');
  assert.equal(streak.field, 'Read', 'answered yes or no (a "not confirmed" day doesn’t make it words)');
  assert.deepEqual([streak.run, streak.best], [0, 1]);
  assert.deepEqual(L.layoutLine({ project: p, props: { layout: 'habit', streak_label: 'Read' }, logs: [log], today: TODAY }), { words: '0 days read · best 1', tone: 'warn' });
});

test('several logs: each keeps its own fields for its form; the latest entry and the trends read them all', () => {
  const sessions = { ...L.parseLog('---\ntype: log\nproject: Rowing block\nfields: [Effort]\n---\n# Sessions\n\nFormat: `- Session:` (A or B), `- Effort:` (1 to 10).\n\n## Wed 21 Oct 2026\n- Session: none yet\n- Effort: 0\n', TODAY), path: 'Projects/Rowing block/Sessions.md', title: 'Sessions' };
  const weights = { ...L.parseLog('---\ntype: log\nproject: Rowing block\nfields: [Weight, Waist]\nunits: {Weight: kg, Waist: cm}\n---\n# Weigh-ins\n\n## Wed 21 Oct 2026\n- Weight: 92.4 kg\n- Waist: not yet measured\n', TODAY), path: 'Projects/Rowing block/Weigh-ins.md', title: 'Weigh-ins' };
  const props = { layout: 'tracker', start: '2026-10-24', end: '2026-12-12', start_weight: 92.4, sessions_per_week: 3 };
  const p = P.parseProject('---\ntype: project\nlayout: tracker\n---\n# Rowing block\n');
  const models = L.dashboard({ project: p, props, logs: [sessions, weights], today: TODAY });
  const entry = models.find((m) => m.type === 'entry');
  assert.deepEqual(entry.logs.map((l) => [l.title, l.fields.map((f) => f.name)]), [['Sessions', ['Session', 'Effort']], ['Weigh-ins', ['Weight', 'Waist']]]);
  assert.equal(entry.logs[1].fields[1].kind, 'number', 'Waist is charted (fields:), though not measured yet');
  const trend = models.find((m) => m.type === 'trend');
  assert.deepEqual(trend.series.map((s) => s.field), ['Weight', 'Effort'], 'the measure the project gives a start for comes first');
  const streak = models.find((m) => m.type === 'streak');
  assert.equal(streak.week.count, 0, '"none yet" is not a session');
  // Before the block starts: a countdown to the start, week 0, and the one line says so.
  const count = models.find((m) => m.type === 'countdown');
  assert.deepEqual([count.words, count.date, count.period.week, count.period.weeks], ['3 days to the start', '2026-10-24', 0, 8]);
  assert.deepEqual(L.layoutLine({ project: p, props, logs: [sessions, weights], today: TODAY }), { words: 'Starts in 3 days · 92.4 kg', tone: 'none' });
});

test('a programme with some or no progress figures, a finished project, a health with its phase', () => {
  const text = '---\ntype: project\nlayout: programme\nstatus: active\nhealth: at risk\nphase: Design and pricing\ndue: 2026-10-19\n---\n# Office fit-outs\n\n## Workstreams\n\n| Workstream | Owner | Status | Progress | Next step |\n| --- | --- | --- | --- | --- |\n| Site surveys | Ana | done | 100% | |\n| Pricing | Ben | at risk | | Get the missing pages |\n| Design | Cy | in progress | | Agree the layout |\n';
  const p = P.parseProject(text);
  const props = F.readProps(text);
  const [status, progress] = L.dashboard({ project: p, props, logs: [], today: TODAY });
  assert.equal(progress.overall, undefined, 'one of three with a figure: no figure for the whole');
  assert.deepEqual([progress.done, progress.total], [1, 3]);
  assert.deepEqual(status.due, { date: '2026-10-19', days: -2 });
  assert.deepEqual(L.layoutLine({ project: p, props, logs: [], today: TODAY }), { words: 'at risk · Design and pricing', tone: 'warn' });
  const done = P.parseProject(text.replace('status: active', 'status: done'));
  assert.equal(L.dashboard({ project: done, props, logs: [], today: TODAY })[0].due, undefined, 'a finished project is never overdue');
});

test('a register of grouped rows, and a venture whose stages are in Campaigns', () => {
  const reg = P.parseProject('---\ntype: project\nlayout: register\n---\n# Chairs\n\n## Register\n\n| Item | Status | Qty |\n| --- | --- | --- |\n| Chairs ready | Available | 20 |\n| Chairs to fix | Needs parts | 4 |\n');
  const props = { layout: 'register', register_of: 'spare chairs, grouped by status until the count' };
  assert.deepEqual(L.layoutLine({ project: reg, props, logs: [], today: TODAY }), { words: '24 spare chairs · 4 needs parts', tone: 'warn' });
  assert.equal(L.pluralNoun('spare chairs, grouped by status', 1), 'spare chair');
  assert.equal(L.pluralNoun('box', 2), 'boxes');
  assert.equal(L.pluralNoun('boxes', 1), 'box');
  const v = P.parseProject('---\ntype: project\nlayout: venture\nstage: launched\n---\n# Pottery shop\n\n## Campaigns\n\n| Item | Stage | Owner | Due | Notes |\n| --- | --- | --- | --- | --- |\n| Spring post | To do | Mo | 2026-10-25 | |\n| Newsletter | Live | Mo | 2026-10-20 | |\n| Old offer | Excluded | Mo | | |\n');
  const models = L.dashboard({ project: v, props: { layout: 'venture', stage: 'launched' }, logs: [], today: TODAY });
  assert.deepEqual(models.map((m) => `${m.type}:${m.title}`), ['status:Status', 'board:Campaigns', 'timeline:Campaigns'], 'no Pipeline: the board reads the table with stages');
  assert.deepEqual(models[1].columns.map((c) => c.stage), ['To do', 'Live', 'Excluded'], 'finished and excluded stages last');
  const bare = P.parseProject('---\ntype: project\nlayout: venture\nstage: idea\n---\n# Idea\n\n## Pipeline\n\n| Item | Stage | Owner | Due | Notes |\n| --- | --- | --- | --- | --- |\n| First buyer | Talking | Mo | | |\n');
  assert.deepEqual(L.dashboard({ project: bare, props: { layout: 'venture', stage: 'idea' }, logs: [], today: TODAY }).map((m) => m.type), ['status', 'board'], 'no Campaigns and no dates: the empty timeline steps aside');
});

// A date in an owner tail is never a person (p16-owner-tail, 4 Nov 2026: a run-sheet line "— Priya Nair — due
// 2026-11-06" read its owner as "Priya Nair — due 2026-11-06"). All three shapes the assistant writes read as that
// person and that date; a real name with a hyphen or a dash inside stays whole.
test('an owner tail with a date reads as that person and that date', () => {
  const parts = (tail) => L.itemParts(`Retry the failed payment twice — ${tail}`);
  for (const tail of ['Priya Nair — due 2026-11-06', 'Priya Nair, due 2026-11-06', 'Priya Nair · by 2026-11-06', 'Priya Nair · due 2026-11-06']) {
    const p = parts(tail);
    assert.equal(p.what, 'Retry the failed payment twice', tail);
    assert.equal(p.who, 'Priya Nair', tail);
    assert.equal(p.when, '2026-11-06', tail);
  }
  assert.equal(parts('Anne-Marie Jones — due 2026-11-06').who, 'Anne-Marie Jones');
  assert.equal(parts('Anne-Marie Jones — due 2026-11-06').when, '2026-11-06');
  assert.equal(parts('Smith – Jones').who, 'Smith – Jones', 'a dash in a name without a date word after stays whole');
  assert.equal(parts('due 2026-11-06').who, '', 'a date alone is no one');
});
