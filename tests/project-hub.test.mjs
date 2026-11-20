// node --test tests/project-hub.test.mjs — the project hub and its timeline (src/shared/project-hub.ts,
// src/shared/project-plan.ts; 23 Oct 2026, workstream 1 part C): days read and moved inside words as people write them,
// actions sorted into mine, waiting on others (with since) and no owner, what needs attention, files grouped by purpose,
// what changed between two versions, the lifecycle (stage, checklist written into the project, the stage edit), moving
// an action or milestone to another day written the way it was, the plan grouped by workstream or phase with
// dependencies, the close-out report, and the project file keeping every word of a next step when it is written back.
// Neutral fixtures: tests/fixtures/hub.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-hub-'));
let H, PL, P, T, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, 'src/shared', f));
  writeFileSync(entry, `export * as H from ${src('project-hub.ts')};\nexport * as PL from ${src('project-plan.ts')};\nexport * as P from ${src('project-file.ts')};\nexport * as T from ${src('timeline.ts')};\nexport * as F from ${src('frontmatter.ts')};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'hub.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ H, PL, P, T, F } = await import(pathToFileURL(path.join(work, 'hub.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const fixture = (name) => readFileSync(path.join(root, 'tests', 'fixtures', 'hub', `${name}.md`), 'utf8');
const day = (iso) => T.readDay(iso);
const TODAY = () => day('2026-11-10');
const load = (name) => {
  const text = fixture(name);
  return { text, p: P.parseProject(text, `Projects/${name}/${name}.md`), props: F.readProps(text) };
};
/** A change applied as the main side applies it: parsed, changed, written back over the file as it was. */
const apply = (text, edit) => {
  const p = P.parseProject(text, 'x.md');
  P.applyProjectEdit(p, edit, '10 Nov 2026');
  return P.serializeProject(p, text);
};
const changedLines = (a, b) => {
  const A = a.split('\n'), B = b.split('\n');
  return { gone: A.filter((l) => !B.includes(l)), added: B.filter((l) => !A.includes(l)) };
};

test('a day inside words is read where it is, and moved the way it was written', () => {
  const t = TODAY();
  assert.equal(T.isoDay(H.dayIn('by Mon 26 Oct (see the RACI)', t).day), '2026-10-26');
  assert.equal(T.isoDay(H.dayIn('Week of 12 Oct (overdue)', t).day), '2026-10-12');
  assert.equal(H.dayIn('end of the month', t), null);
  assert.equal(H.replaceDayIn('Mon 26 Oct ([[Review]])', day('2026-10-28'), t), 'Wed 28 Oct ([[Review]])');
  assert.equal(H.replaceDayIn('2026-11-01', day('2026-11-03'), t), '2026-11-03');
  assert.equal(H.replaceDayIn('Fri, 13 Nov 2026, 9:00 AM', day('2026-11-16'), t), 'Mon, 16 Nov 2026, 9:00 AM');
  assert.equal(H.replaceDayIn('31/10/2026', day('2026-11-02'), t), '2/11/2026');
  assert.equal(H.replaceDayIn('12 Nov', day('2027-01-05'), t), '5 Jan 2027', 'another year says its year');
  assert.equal(H.replaceDayIn('', day('2026-11-03'), t), '2026-11-03');
});

test('actions: mine, waiting on others with since, no owner; a day written among the who parts is its when', () => {
  const { p } = load('Harbour Street Fit-out');
  const acts = H.projectActions(p, 'Ana Lopez', TODAY());
  const by = (w) => acts.find((a) => a.what.startsWith(w));
  assert.equal(by('Approve the Coastline').mine, true);
  assert.equal(by('Book the council').person, 'Cara Wu');
  assert.equal(by('Book the council').overdue, true);
  assert.equal(T.isoDay(by('Send the final counter').since), '2026-10-28', '"Requested 28 Oct" is when it was asked');
  assert.equal(by('Send the final counter').due, undefined);
  assert.equal(T.isoDay(by('Chase the coffee').since), '2026-10-30');
  assert.equal(by('Brief the sign writer').unassigned, true);
  assert.equal(by('Order the menu boards').unassigned, true);
  const walk = by('Walk through the site');
  assert.equal(walk.who, 'Ana Lopez');
  assert.equal(T.isoDay(walk.due), '2026-11-13');
  assert.equal(by('Install the counter').after, 'Approve the Coastline joinery quote');
  assert.equal(by('Install the counter').who, 'Ben Hale');
  assert.equal(by('Choose the kitchen').done, true);
  // A run sheet's tick boxes are actions too, under their phase.
  const site = load('Riverside Pop-up');
  const run = H.projectActions(site.p, 'Sam Reid', TODAY());
  assert.equal(run.find((a) => a.what.startsWith('Order the point-of-sale')).phase, 'Six weeks out');
  assert.equal(run.find((a) => a.what.startsWith('Stock delivered')).after, 'Stand built');
  assert.equal(run.find((a) => a.what.startsWith('Stock delivered')).mine, true, 'nobody named: the owner has it');
});

test('the hub: needs attention in order, my actions, waiting on others by person, upcoming, people, decisions', () => {
  const { p, props } = load('Harbour Street Fit-out');
  const h = H.hubModel({ project: p, props, today: TODAY() });
  assert.equal(h.me, 'Ana Lopez');
  const kinds = h.attention.map((a) => a.kind);
  assert.equal(kinds[0], 'expiring', 'what ends soon first, now that other people’s overdue items stay in Waiting on others');
  assert.ok(!h.attention.some((a) => /Book the council/.test(a.title)), 'Cara Wu’s overdue item is not in Needs attention: it stays in Waiting on others');
  assert.ok(h.attention.some((a) => a.kind === 'expiring' && /validity ends/.test(a.title) && /Ends in 2 days/.test(a.detail)), 'the quote ending in two days');
  assert.ok(!h.attention.some((a) => a.kind === 'late'), 'a missed milestone is a date to confirm, not needs attention');
  assert.ok(h.toConfirm.some((a) => a.kind === 'late' && /rough-in/.test(a.title)), 'a missed milestone');
  assert.ok(h.attention.some((a) => a.kind === 'waiting' && /Send the final counter/.test(a.title) && /13 days on Ben Hale/.test(a.detail)), 'waiting on someone too long');
  assert.ok(h.attention.some((a) => a.kind === 'waiting' && /coffee/.test(a.title) && /Asked 30 Oct/.test(a.detail)), 'something I asked for with no reply');
  assert.ok(h.attention.findIndex((a) => a.tone === 'warn') > h.attention.findLastIndex((a) => a.tone === 'bad'), 'red before amber');
  assert.equal(h.attention.filter((a) => a.kind === 'expiring').length, 1, 'the quote said three ways (key date, action, risk) shows once');
  assert.deepEqual(h.mine.map((a) => a.what.slice(0, 14)), ['Approve the Co', 'Walk through t', 'Chase the coff']);
  assert.deepEqual(h.unowned.map((a) => a.what.slice(0, 10)), ['Brief the ', 'Order the ']);
  assert.deepEqual(h.waiting.map((g) => [g.person, g.items.length]), [['Cara Wu', 1], ['Ben Hale', 2]]);
  assert.equal(h.waiting[1].waitingDays, 13);
  assert.equal(T.isoDay(h.waiting[0].heard), '2026-11-06', 'last heard in an update');
  assert.deepEqual(h.upcoming.map((m) => m.what), ['Coastline joinery quote validity ends', 'Practical completion', 'Café opens']);
  assert.equal(h.people.find((x) => x.name === 'Ben Hale').open, 2);
  assert.equal(h.decisions[0].what, 'Keep the existing floor tiles.', 'newest decision first');
  assert.equal(h.openRisks.length, 3, 'the closed risk is left out');
  assert.deepEqual(h.counts, { open: 8, done: 1, overdue: 1, mine: 3, waiting: 3 });
});

// 5 Nov 2026, vault folio F5: "Next milestones" sees key dates written "date: words", the way the harness vault
// (and hand-written projects) hold them — the card said "No milestones coming up" while the file held two.
test('upcoming sees key dates written "date: words"', () => {
  const p = P.parseProject('---\ntype: project\nstatus: active\n---\n# Harbourline Cart Fix\n\n## Summary\n\nFix the retry.\n\n## Key dates\n\n- 2026-11-06: Retry fix live\n- 2026-11-20: Cart fix done\n');
  const h = H.hubModel({ project: p, today: day('2026-11-05') });
  assert.deepEqual(h.upcoming.map((m) => m.what), ['Retry fix live', 'Cart fix done']);
});

test('the countdown: a future due date first, else the next milestone after today, never today itself', () => {
  const t = TODAY(); // 10 Nov 2026.
  const make = (due, dates) => P.parseProject(`---\ntype: project\nstatus: active\n${due ? `due: "${due}"\n` : ''}---\n# Counted\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n${dates}\n`);
  // A milestone today (a weekly meeting) is not "0 days": the next one after today counts.
  const weekly = make('', '| 10 Nov 2026 | Weekly meeting | — |\n| 17 Nov 2026 | Weekly meeting | — |\n| 24 Nov 2026 | Fit-out complete | — |');
  assert.deepEqual((({ days, label, target }) => ({ days, label, target }))(H.projectCountdown(weekly, t)), { days: 7, label: 'to the next milestone', target: 'milestone' });
  // A due date in the future wins over a sooner milestone.
  const withDue = make('2026-12-01', '| 17 Nov 2026 | Weekly meeting | — |');
  assert.deepEqual((({ days, label, target }) => ({ days, label, target }))(H.projectCountdown(withDue, t)), { days: 21, label: 'to the due date', target: 'due' });
  // A due date today or past does not count either: the next milestone after today does.
  const dueToday = make('2026-11-10', '| 10 Nov 2026 | Weekly meeting | — |\n| 17 Nov 2026 | Weekly meeting | — |');
  assert.equal(H.projectCountdown(dueToday, t).days, 7);
  // Nothing after today: no countdown.
  assert.equal(H.projectCountdown(make('', '| 10 Nov 2026 | Weekly meeting | — |'), t), null);
});

test('the hub of a site: phases, contacts as people, nothing heard from a supplier', () => {
  const { p, props } = load('Riverside Pop-up');
  const h = H.hubModel({ project: p, props, today: TODAY() });
  assert.ok(h.people.some((x) => x.name === 'Riverside Stands' && x.company === 'Riverside Stands Pty Ltd'));
  assert.deepEqual(h.waiting.map((g) => g.person), ['Dee Park', 'Riverside Stands'], 'the soonest due first');
  assert.ok(!h.attention.some((a) => a.kind === 'silent'), 'a project without dated updates never says "nothing heard"');
});

test('two lines differing on both sides are two things; one inside the other is one (9.5 fourth pass)', () => {
  assert.equal(H.alike('Harbour fitout stage two', 'Harbour fitout stage three'), false, 'two stages, never one');
  assert.equal(H.alike('Send signed quote to mill', 'Send signed quote to coop'), false, 'two recipients, never one');
  assert.equal(H.alike('Email the caterer about the final menu', 'Email caterer about final menu'), true);
  assert.equal(H.alike('Send quote', 'Send the quote to the mill'), true, 'fewer words inside more');
});

test('files grouped by purpose, newest first', () => {
  const { p } = load('Harbour Street Fit-out');
  const files = p.documents.map((d) => ({ path: d.path, name: d.path.split('/').pop(), what: d.what }));
  const g = H.filesByPurpose([...files, { path: 'Photos/site.jpg', name: 'site.jpg', modified: Date.UTC(2026, 10, 9) }], TODAY());
  const of = (purpose) => g.find((x) => x.purpose === purpose)?.files.map((f) => f.name);
  assert.deepEqual(of('quotes'), ['Coastline joinery quote v2.pdf']);
  assert.deepEqual(of('plans'), ['Counter drawing rev C.pdf']);
  assert.deepEqual(of('reports'), ['Weekly report 2026-11-06.docx']);
  assert.deepEqual(of('contracts'), ['Coastline SOW signed.pdf']);
  assert.equal(g.at(-1).purpose, 'other', 'other files last');
  assert.equal(H.purposeOf('Meeting_Notes_2026-10-12.docx'), 'meetings');
  assert.equal(H.purposeOf('Devices_Export.xlsx'), 'data');
  const g2 = H.filesByPurpose([{ path: 'Plans/Status.pdf', name: 'Status.pdf' }, { path: 'Reports/Status.pdf', name: 'Status.pdf' }, { path: 'Plans/Status.pdf', name: 'Status.pdf' }], TODAY());
  assert.equal(g2.flatMap((x) => x.files).length, 2, 'two folders two files; the same path twice one');
});

test('a Passed milestone is behind it, never late (9.5 fourth pass)', () => {
  assert.ok(H.DONE_WORDS.test('Passed') && H.DONE_WORDS.test('Live') && H.DONE_WORDS.test('Delivered'));
  assert.equal(H.DONE_WORDS.test('In progress'), false);
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 20 Sep 2026 | Passed the inspection | Passed |\n', 'Projects/Shop/Shop.md');
  const ms = H.projectMilestones(p, TODAY());
  assert.equal(ms[0].done, true);
  assert.equal(ms[0].late, false);
});

test('what changed between two versions, in words', () => {
  const { text } = load('Harbour Street Fit-out');
  const after1 = apply(text, { kind: 'change', list: 'next', index: 0, item: { done: true } });
  const after2 = apply(after1, { kind: 'change', list: 'dates', index: 3, item: { when: '2026-11-26' } });
  const after3 = apply(after2, { kind: 'set', field: 'health', value: 'off track' });
  const words = H.projectChanges(P.parseProject(text), P.parseProject(after3), TODAY());
  assert.ok(words.includes('Health: At risk → Off track'));
  assert.ok(words.some((w) => /^Ticked off “Approve the Coastline/.test(w)));
  assert.ok(words.includes('“Practical completion” moved to 26 Nov'));
  assert.deepEqual(H.projectChanges(P.parseProject(text), P.parseProject(text), TODAY()), []);
});

test('the lifecycle: the stage read and written, the checklist written into the project on its first tick', () => {
  const { text, p, props } = load('Harbour Street Fit-out');
  assert.equal(H.stageOf(props, p), 'active', 'from the status when no stage is written');
  assert.equal(H.stageOf({}, { status: 'on hold' }), 'active');
  assert.equal(H.stageOf({ stage: 'closing' }, p), 'closing');
  assert.equal(H.stageKey({ stage: 'building' }), 'lifecycle', 'a venture’s own stage is left alone');
  assert.equal(H.stageOf({ stage: 'building', lifecycle: 'planning' }, p), 'planning');
  const lists = H.stageChecklists(p);
  assert.equal(lists.length, 5);
  assert.ok(lists.every((l) => !l.written && l.items.length >= 3), 'the defaults until changed');
  // Tick the first Active check: the whole list is written, every other line kept.
  const tick = H.checklistEdit(p, { kind: 'toggle', stage: 'active', index: 0 });
  const t1 = apply(text, tick);
  assert.match(t1, /## Stage checklist\n\n### Idea\n\n- \[ \] The outcome/);
  assert.match(t1, /### Active\n\n- \[x\] Every action has an owner and a date/);
  assert.deepEqual(changedLines(text, t1).gone, [], 'nothing else changed');
  const p1 = P.parseProject(t1);
  assert.equal(H.stageChecklists(p1).find((l) => l.stage === 'active').items[0].done, true);
  // Add, rename and take off a line; the hub's section is never read as a layout's run sheet.
  const t2 = apply(t1, H.checklistEdit(p1, { kind: 'add', stage: 'closing', what: 'Keys returned to the landlord' }));
  const p2 = P.parseProject(t2);
  assert.ok(H.stageChecklists(p2).find((l) => l.stage === 'closing').items.some((i) => i.what === 'Keys returned to the landlord'));
  const t3 = apply(t2, H.checklistEdit(p2, { kind: 'rename', stage: 'idea', index: 0, what: 'Why we are doing it' }));
  const t4 = apply(t3, H.checklistEdit(P.parseProject(t3), { kind: 'remove', stage: 'done', index: 1 }));
  const p4 = P.parseProject(t4);
  assert.equal(H.stageChecklists(p4).find((l) => l.stage === 'idea').items[0].what, 'Why we are doing it');
  assert.ok(!H.stageChecklists(p4).find((l) => l.stage === 'done').items.some((i) => i.what === 'Files archived'));
  // The stage edit: stage written, status following (Active and Closing are both active; on hold stays on hold).
  const s1 = apply(text, { kind: 'stage', stage: 'closing' });
  assert.match(s1, /^stage: closing$/m);
  assert.match(s1, /^status: active$/m);
  const s2 = apply(text, { kind: 'stage', stage: 'done' });
  assert.match(s2, /^status: done$/m);
  assert.match(apply(text, { kind: 'stage', stage: 'planning', key: 'lifecycle' }), /^lifecycle: planning$/m);
  assert.throws(() => apply(text, { kind: 'stage', stage: 'shipping' }), /isn’t one Ironleaf knows/);
});

test('moving an action or milestone to another day writes only its date, the way it was written', () => {
  const { text, p } = load('Harbour Street Fit-out');
  const t = TODAY();
  const moved = (ref, iso) => apply(text, H.rescheduleEdit(p, ref, day(iso), t));
  // A key date (ISO in its table).
  const d = moved({ kind: 'date', index: 3 }, '2026-11-26');
  assert.deepEqual(changedLines(text, d), { gone: ['| 2026-11-24 | Practical completion | next |'], added: ['| 2026-11-26 | Practical completion | next |'] });
  // A next step with "by".
  const n = moved({ kind: 'next', index: 1 }, '2026-11-09');
  assert.deepEqual(changedLines(text, n).added, ['- [ ] Book the council electrical inspection — Cara Wu · by 2026-11-09']);
  // A day written among the who parts, with words after it: the day alone moves.
  const w = moved({ kind: 'next', index: 6 }, '2026-11-16');
  assert.deepEqual(changedLines(text, w).added, ['- [ ] Walk through the site with the landlord — Ana Lopez · Mon 16 Nov, 9:00 AM (see [[Landlord walk-through]])']);
  // A run sheet's tick box.
  const site = load('Riverside Pop-up');
  const run = H.projectActions(site.p, 'Sam Reid', t).find((a) => a.what.startsWith('Order the point-of-sale'));
  const r = apply(site.text, H.rescheduleEdit(site.p, run.ref, day('2026-11-18'), t));
  assert.deepEqual(changedLines(site.text, r), { gone: ['- [ ] Order the point-of-sale kit — Dee Park · by 2026-11-16'], added: ['- [ ] Order the point-of-sale kit — Dee Park · by 2026-11-18'] });
});

test('the plan: grouped by workstream (or phase), one line each, dependencies, a run sheet line that is a key date shows once', () => {
  const { p } = load('Harbour Street Fit-out');
  const plan = PL.planOf(p, TODAY());
  const names = plan.groups.map((g) => g.name);
  assert.deepEqual(names.slice(0, 5), ['Key dates', 'Joinery (Coastline)', 'Electrical', 'Kitchen equipment', 'Signage']);
  const group = (n) => plan.groups.find((g) => g.name === n);
  assert.ok(group('Joinery (Coastline)').items.some((i) => /joinery quote validity/.test(i.what)), 'a key date goes to the workstream it names');
  assert.ok(group('Electrical').items.some((i) => /council electrical inspection/.test(i.what)));
  assert.ok(group('Electrical').items.some((i) => /rough-in/.test(i.what)));
  assert.ok(group('Kitchen equipment').items.some((i) => /Kitchen equipment delivered/.test(i.what) && i.done));
  assert.equal(group('Signage').items.length, 0, 'a workstream with nothing dated keeps its line');
  assert.equal(group('Other actions').undated, 3, 'undated actions no workstream names are counted under Other actions');
  const install = plan.groups.flatMap((g) => g.items).find((i) => /Install the counter/.test(i.what));
  assert.equal(install.afterId, 'next:0');
  assert.deepEqual(plan.deps, [{ from: 'next:0', to: install.id, clash: false }]);
  assert.ok(plan.groups.flatMap((g) => g.items).find((i) => /Book the council/.test(i.what)).overdue);
  // A site: phases from its run sheet; "Stand built" (a key date and a run sheet line, same day) once.
  const site = load('Riverside Pop-up');
  const sp = PL.planOf(site.p, TODAY());
  assert.deepEqual(sp.groups.map((g) => g.name), ['Key dates', 'Six weeks out', 'Build week']);
  assert.equal(sp.groups.flatMap((g) => g.items).filter((i) => /^Stand built/.test(i.what)).length, 1);
  assert.equal(sp.deps.length, 1, 'Stock delivered comes after Stand built');
  // The scale.
  const range = PL.planRange(sp, 'week', TODAY());
  assert.equal(T.ymd(range.from).weekday, 1, 'a week starts on a Monday');
  const ticks = PL.planTicks(range.from, range.to, 'month');
  assert.ok(ticks.major.some((x) => x.label === 'Dec'));
  assert.equal(PL.matchWorkstream('Meeting about everything', [{ name: 'Northgate', done: false }, { name: 'Westbury', done: false }]), -1);
});

test('Alex Morgan is never mine when I am Alex Lee; Alex alone is (9.5 fourth pass)', () => {
  assert.equal(H.namesPerson('Alex Morgan', 'Alex Lee'), false);
  assert.equal(H.namesPerson('Alex', 'Alex Lee'), true);
  assert.equal(H.namesPerson('Alex Lee', 'Alex Lee'), true);
  assert.equal(H.namesPerson('Lee, Alex', 'Alex Lee'), true, 'last name first still names them');
});

test('after: matches whole words, never inside another word (9.5 fourth pass)', () => {
  const p = P.parseProject('---\ntype: project\n---\n# Shop\n\n## What’s next\n\n- [ ] Understand the brief — Ana · by 24 Oct 2026\n- [ ] Order signs — Ana · by 26 Oct 2026 · after:Stand\n', 'Projects/Shop/Shop.md');
  const order = PL.planOf(p, TODAY()).groups.flatMap((g) => g.items).find((i) => /Order signs/.test(i.what));
  assert.equal(order.afterId, undefined, 'Stand is not inside Understand');
  const p2 = P.parseProject('---\ntype: project\n---\n# Shop\n\n## What’s next\n\n- [ ] Stand up the site — Ana · by 25 Oct 2026\n- [ ] Order signs — Ana · by 26 Oct 2026 · after:Stand up\n', 'Projects/Shop/Shop.md');
  assert.ok(PL.planOf(p2, TODAY()).groups.flatMap((g) => g.items).find((i) => /Order signs/.test(i.what)).afterId, 'whole words still match');
});

test('the plan and the hub count a meeting’s dated actions, once, with where they come from (WS1 integration, 24 Oct 2026)', () => {
  const { p } = load('Harbour Street Fit-out');
  const day = T.isoDay(TODAY() + 5);
  const connected = [
    { id: 'action:Meetings/Site walk.md#check-the-switchboard-labels', path: 'Meetings/Site walk.md', line: 12, what: 'Check the electrical switchboard labels', who: 'Mia', due: day, done: false, from: 'Site walk', task: 'Check the electrical switchboard labels — Mia · by soon' },
    { id: 'action:Meetings/Site walk.md#dup', path: 'Meetings/Site walk.md', line: 13, what: p.next[0].what, done: false, from: 'Site walk' },
  ];
  const plan = PL.planOf(p, TODAY(), '', connected);
  const all = plan.groups.flatMap((g) => g.items);
  const check = all.find((i) => /switchboard labels/.test(i.what));
  assert.ok(check && check.ref.kind === 'record' && check.from === 'Site walk', 'on the timeline, opening its record');
  assert.ok(plan.groups.find((g) => g.name === 'Electrical').items.includes(check), 'in the workstream it names');
  assert.equal(all.filter((i) => i.what === p.next[0].what).length <= 1, true, 'the project’s own line, once');
  const hub = H.hubModel({ project: p, today: TODAY(), connected });
  assert.equal(hub.actions.filter((a) => a.what === p.next[0].what).length, 1);
  const g = hub.waiting.find((x) => x.items.some((a) => /switchboard labels/.test(a.what)));
  assert.ok(g && /Mia/.test(g.person), 'waiting on Mia');
});

test('the close-out report: from the project’s own data, a note of its own', () => {
  const { p, props } = load('Harbour Street Fit-out');
  const r = H.closeOutReport({ project: p, props, today: day('2026-12-02'), files: [{ path: 'Photos/opening.jpg', name: 'opening.jpg' }] });
  assert.match(r, /^---\ntype: report\nproject: "\[\[Harbour Street Fit-out\]\]"\ncreated: 2026-12-02\n/);
  assert.match(r, /# Harbour Street Fit-out: close-out report/);
  assert.match(r, /## What was delivered\n\n- \*\*Kitchen equipment\*\* — Delivered and tested\n- Kitchen equipment delivered \(20 Oct 2026\)\n- Choose the kitchen equipment/);
  assert.match(r, /## Still open at close[\s\S]*\n- Book the council electrical inspection — Cara Wu/);
  assert.doesNotMatch(r, /- \[[ x]\]/, 'no tick boxes: the open actions stay the project’s own');
  assert.match(r, /## Decisions\n\n- \*\*2026-10-28\*\* — Keep the existing floor tiles/);
  assert.match(r, /Dealt with: Wrong counter height/);
  assert.match(r, /It finished 2 days after its due date \(30 Nov 2026\)\./);
  assert.match(r, /\*\*What went well\*\*/);
  assert.match(r, /## Files[\s\S]*`Quotes\/Coastline joinery quote v2.pdf` — Joinery quote v2[\s\S]*`Photos\/opening.jpg`/);
  assert.equal(H.closeOutName('A/B: test'), 'A B test close-out report');
});

test('a project written back keeps every word of its next steps, its documents’ links, its headings and tags', () => {
  const text = [
    '---',
    'type: project',
    'tags: [ work, North ]',
    '---',
    '# Plain',
    '',
    '## What’s next',
    '',
    '- [ ] Join the call — Ana Lopez · Fri 13 Nov, 9:00 AM ([[Call notes]])',
    '- [ ] Send the review — Ana Lopez · by Mon 16 Nov ([[2026-11-17 Survey Report Review]]) and more words after it to be long',
    '- [ ] Upload the contracts — Ana Lopez · suggest by 2026-11-20, when Jay is back',
    '',
    '## Files',
    '',
    '- [[Call notes]] and [[Council letter]] — the notes and the letter',
    '',
    '## Notes',
    '',
  ].join('\n');
  const p = P.parseProject(text);
  assert.equal(p.next[0].who, 'Ana Lopez · Fri 13 Nov, 9:00 AM ([[Call notes]])');
  assert.equal(P.serializeProject(p, text), text);
  // A change elsewhere leaves them as written.
  const t = apply(text, { kind: 'change', list: 'next', index: 2, item: { done: true } });
  assert.deepEqual(changedLines(text, t), { gone: ['- [ ] Upload the contracts — Ana Lopez · suggest by 2026-11-20, when Jay is back'], added: ['- [x] Upload the contracts — Ana Lopez · suggest by 2026-11-20, when Jay is back'] });
});

test("the person's plan: only their own work, grouped by when; gone-by dates to confirm", () => {
  const text = [
    '---',
    'type: project',
    'status: active',
    'owner: Mia Tran',
    '---',
    '# Plan test project',
    '',
    '## Summary',
    '',
    'A made-up project for the plan.',
    '',
    '## What’s next',
    '',
    '- [ ] Alex overdue step — Alex Lee · by 2026-11-01',
    "- [ ] Mia's overdue step — Mia Tran · by 2026-11-02",
    "- [ ] Mia's step this week — Mia Tran · by 2026-11-13",
    "- [ ] Mia's later step — Mia Tran · by 2026-11-30",
    "- [ ] Mia's undated step — Mia Tran",
    '',
    '## Key dates',
    '',
    '| Date | Milestone | Status |',
    '| --- | --- | --- |',
    '| 2026-11-05 | Quote valid until 2026-11-05 | |',
    '| 2026-10-31 | Site visit | |',
    '',
  ].join('\n');
  const p = P.parseProject(text, 'Projects/Plan test/Plan test.md');
  const h = H.hubModel({ project: p, today: TODAY(), me: 'Mia Tran' });
  const allPlan = [...h.plan.late, ...h.plan.week, ...h.plan.later, ...h.plan.undated];
  assert.ok(!h.attention.some((a) => /Alex overdue step/.test(a.title)), "Alex Lee's overdue step is not in attention");
  assert.ok(!allPlan.some((a) => /Alex overdue step/.test(a.what)), "Alex Lee's overdue step is not in the plan");
  assert.ok(h.plan.late.some((a) => /Mia's overdue step/.test(a.what)), "Mia Tran's overdue step is late");
  assert.ok(h.attention.some((a) => a.kind === 'overdue' && /Mia's overdue step/.test(a.title)), "Mia Tran's overdue step is in attention");
  assert.equal(h.next?.what, "Mia's overdue step", 'the most urgent step is next');
  assert.ok(h.plan.week.some((a) => /Mia's step this week/.test(a.what)), 'due in 3 days is this week');
  assert.ok(h.plan.later.some((a) => /Mia's later step/.test(a.what)), 'due in 20 days is later');
  assert.ok(h.plan.undated.some((a) => /Mia's undated step/.test(a.what)), 'no day is undated');
  assert.ok(h.toConfirm.some((a) => /Quote valid until/.test(a.title)), 'a quote that ended 5 days ago is a date to confirm');
  assert.ok(!h.attention.some((a) => /Quote valid until/.test(a.title)), 'a quote that ended 5 days ago is not in attention');
  assert.ok(h.toConfirm.some((a) => a.kind === 'late' && /Site visit/.test(a.title)), 'a missed milestone 10 days ago is a date to confirm');
});
