// node --test tests/t249-counts.test.mjs — every count matches what its list shows (t249, 12 Nov 2026,
// the critics: the greeting and the sidebar said 8 late while Late said 9; Projects home said "16 next
// steps" while the page counted 19 open; Notes 13 against All 10). One rule: a number counts exactly the
// rows its list draws, everywhere it appears. A project's due row in Late reads as what it is ("X is due")
// and counts in the greeting and the badge too. Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t249-counts-'));
let T;
let BT;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const one = path.join(work, 'one.ts');
  writeFileSync(one, `export { buildToday, dayShapeCounts, sidebarTodayCount } from ${src('src/shared/today.ts')};\nexport { parseProject } from ${src('src/shared/project-file.ts')};\n`);
  await build({ input: one, platform: 'node', output: { file: path.join(work, 'one.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 'one.mjs')).href);
  const two = path.join(work, 'two.ts');
  writeFileSync(two, `export { rankAllFor, splitTodayTop } from ${src('src/shared/brief-tasks.ts')};\n`);
  await build({ input: two, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'two.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  BT = await import(pathToFileURL(path.join(work, 'two.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Thursday 12 November 2026: the project itself is a day past due, one step with it, one step due
// today, and one of the person's own dated lines in a note, two days late.
const NOW = new Date(2026, 10, 12, 9, 0);
const FILES = {
  'Projects/Bakery Launch/Bakery Launch.md':
    '---\ntype: project\nstatus: active\nhealth: on track\nowner: Mia Tran\ndue: "2026-11-11"\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by 2026-11-11\n- [ ] Ice the showcase cake — Mia · by 2026-11-12\n',
};
const projectsOf = () => Object.entries(FILES).map(([p, text], i) => ({ path: p, version: `v${i}`, modified: NOW.getTime() - 86400000, project: T.parseProject(text, p) }));
const noteEntry = (day) => ({ kind: 'task', key: `Tasks.md\nFile the BAS ${day}`, day, item: { key: `Tasks.md\nFile the BAS ${day}`, path: 'Tasks.md', title: 'Tasks', line: 1, text: `File the BAS due ${day}`, words: 'File the BAS', due: day } });

test('a late project due reads as what it is, and counts in the greeting, the badge and Late', () => {
  const d = T.buildToday({ projects: projectsOf(), notes: [], me: 'Mia Tran' }, NOW);
  const dues = d.due.overdue.filter((x) => x.kind === 'project');
  assert.equal(dues.length, 1, 'the late project due lists in Late’s rows');
  assert.equal(dues[0].what, 'Bakery Launch is due', 'it reads as what it is');
  // The greeting’s rule (TodayView’s oneCount): steps and own note lines, plus the dates Late draws.
  const steps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale].filter((x) => x.kind === 'step');
  const dates = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale].filter((x) => x.kind !== 'step');
  const own = [noteEntry('2026-11-10')];
  const base = T.dayShapeCounts(steps, own.map((e) => e.day), NOW);
  const dated = T.dayShapeCounts(dates, [], NOW);
  const greeting = { late: base.late + dated.late, today: base.today + dated.today };
  // Late’s rows (TodayView’s split): the ranked late rows plus the dates’ late rows.
  const ranked = BT.rankAllFor(steps, own, NOW);
  const late = BT.splitTodayTop(ranked, dates).late;
  assert.equal(greeting.late, 3, 'the greeting counts the late step, the late project due and the late note line');
  assert.equal(late.length, 3, 'Late draws exactly those three rows');
  assert.equal(greeting.late, late.length, 'one true late count in the greeting and the section');
  // The badge: late plus today through the same rule.
  const hub = { overdue: own, today: [], week: [], later: [], stale: [], known: ['Mia Tran'] };
  assert.equal(T.sidebarTodayCount(d, hub, NOW), 4, 'the badge counts the three late rows plus the one due today');
});

test('Projects home counts the page’s open rows, and the sticky notes badge counts its All list', () => {
  const main = read('src/main/projects.ts');
  assert.ok(main.includes('standingLine(own)'), 'home counts through the standing line, steps and meeting actions alike');
  assert.ok(main.includes('openNext: counts.mineOpen + counts.othersOpen'), 'home’s number is the page’s yours plus others’');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const at = tabs.indexOf('export function notesListCount');
  const body = tabs.slice(at, at + 2500);
  assert.ok(!body.includes('meetings.length'), 'the sticky notes badge never counts meetings');
  assert.ok(tabs.includes('>Meetings · {meetings.length}</div>'), 'meetings read under their own head with their own count');
});
