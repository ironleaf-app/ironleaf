// node --test tests/folder-followups-today.test.mjs — item 2 (8 Nov 2026):
// Today's meetings and anything due today always reach Today, even from a
// kept-out folder. A missed meeting or due task hurts more than any noise.
// The rest of a kept-out folder stays out.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-followups-today-'));
let A;
let T;
let F;
let M;
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as areas from ${JSON.stringify(path.join(root, 'src/shared/areas.ts'))};`,
      `export * as today from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};`,
      `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`,
      `export * as hubShared from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  A = S.areas;
  T = S.today;
  F = S.fewer;
  H = S.hubShared;
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const QUIET = 'Archive';
const NOW = new Date(2026, 10, 8, 9, 0); // Sunday 8 November 2026
const T0 = NOW.getTime();
const areasWith = () => [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: '' },
  { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: '' },
];
const ctxWith = (quiet = [QUIET]) => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  docsFolder: 'Docs',
  areas: [],
  moduleFolders: [],
  quietFolders: quiet,
});

test('Today’s meetings and due today reach todayFor from a kept-out folder; the rest stays out', () => {
  const proj = (p, what) => ({ path: p, version: 'v', modified: T0 - 3600000, project: T.parseProject ? T.parseProject(`---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# ${p}\n\n## What’s next\n\n- [ ] ${what}\n`, p) : null });
  // Build via buildToday with projects due today, overdue, and soon in the kept-out folder.
  const mk = (when) => `- [ ] Fix the till — Mia · by ${when}`;
  const parse = (p, lines) => ({ path: p, version: 'v', modified: T0 - 3600000, project: T.parseProject ? null : null });
  // Simpler: call buildToday directly with project texts (as quiet-folders.test does via parseProject from project-file).
  // Here drive todayFor on a hand-made TodayData to keep the test small and exact.
  const dueItem = (project, what, when, offset) => ({ id: `${project}:${what}`, kind: 'step', project, projectName: project, version: 'v', what, others: false, when, offset, tone: 'none' });
  const data = {
    date: '2026-11-08',
    since: T0 - 86400000,
    me: 'Mia Tran',
    projects: 2,
    due: {
      overdue: [dueItem(`${QUIET}/Website refresh.md`, 'Approve the homepage words', '7 Nov 2026', -1)],
      today: [dueItem(`${QUIET}/Website refresh.md`, 'Pay the deposit', '8 Nov 2026', 0)],
      soon: [dueItem(`${QUIET}/Website refresh.md`, 'Order the till roll', '9 Nov 2026', 1)],
      later: [],
      passed: [],
      stale: [],
    },
    atRisk: [],
    waiting: [],
    unscheduled: [],
    changed: [{ id: 'c1', project: `${QUIET}/Website refresh.md`, projectName: 'Website refresh', version: 'v', latest: T0, lines: [{ id: 'l1', kind: 'update', what: 'Words', at: T0 }], moreFiles: 0, files: 0 }],
    daily: null,
    meetings: [{ path: `${QUIET}/Meetings/Standup.md`, title: 'Standup', attendees: [] }],
    docs: [],
    automations: null,
    counts: { overdue: 1, today: 1, soon: 1, later: 0, stale: 0, atRisk: 0, waiting: 0, unscheduled: 0, changed: 1, meetings: 1, automations: 0 },
    clear: false,
    nothingOnYou: false,
  };
  const areas = areasWith();
  const keepArea = (path) => A.wanted({ path }, 'all', areas);
  const keep = (path) => keepArea(path) && !F.isQuietPath(path, ctxWith());
  const shown = A.todayFor(data, keep, keepArea);
  assert.equal(shown.due.today.length, 1, 'due today reaches from the kept-out folder');
  assert.equal(shown.due.overdue.length, 1, 'overdue reaches too: a missed due task hurts');
  assert.equal(shown.due.soon.length, 0, 'due tomorrow stays out');
  assert.equal(shown.meetings.length, 1, 'today’s meeting reaches');
  assert.equal(shown.changed.length, 0, 'changed stays out');
});

test('the hub’s day and due lists reach today from a kept-out folder; the rest stays out', async () => {
  const index = new M.VaultIndex();
  // A meeting today in the kept-out folder, and one tomorrow; a task due today, one tomorrow, one undated.
  index.set(`${QUIET}/Meetings/Standup.md`, '---\ntype: meeting\ndate: 2026-11-08\n---\n# Standup\n', T0, 10);
  index.set(`${QUIET}/Meetings/Planning.md`, '---\ntype: meeting\ndate: 2026-11-09\n---\n# Planning\n', T0, 10);
  index.set(`${QUIET}/Website refresh.md`, '# Website refresh\n\n- [ ] Pay the deposit 📅 2026-11-08\n- [ ] Order the till roll 📅 2026-11-09\n- [ ] Tidy the links\n', T0, 10);
  index.set('Work/Notes/Kick-off.md', '# Kick-off\n\n- [ ] Order the till roll 📅 2026-11-08\n', T0, 10);
  index.setQuiet([QUIET]);
  const hub = new M.Hub({
    index,
    dailyPath: () => 'Daily/2026-11-08.md',
    templatesFolder: () => 'Templates',
    reminders: () => [],
    write: async () => {},
    startDay: async () => 'Daily/2026-11-08.md',
    now: () => T0,
  });
  const day = hub.day('2026-11-08');
  assert.ok(day.meetings.some((m) => m.path === `${QUIET}/Meetings/Standup.md`), 'today’s meeting reaches from the kept-out folder');
  assert.ok(!day.meetings.some((m) => m.path === `${QUIET}/Meetings/Planning.md`), 'tomorrow’s meeting is not today’s');
  const tomorrow = hub.day('2026-11-09');
  // Tomorrow viewed tomorrow still shows its meeting (the day’s own), but today does not carry it.
  assert.ok(tomorrow.meetings.some((m) => m.path === `${QUIET}/Meetings/Planning.md`), 'the viewed day carries its own meeting');
  const due = hub.due();
  const paths = [...due.overdue, ...due.today].map((e) => (e.kind === 'task' ? e.item.path : ''));
  assert.ok(paths.includes(`${QUIET}/Website refresh.md`), 'due today reaches from the kept-out folder');
  assert.ok(!due.week.some((e) => e.kind === 'task' && e.item.path === `${QUIET}/Website refresh.md` && e.item.words.includes('till roll')), 'due tomorrow stays out of the week');
  assert.ok(!due.undated.some((t) => t.path === `${QUIET}/Website refresh.md` && t.words.includes('Tidy')), 'undated stays out');
  const marks = hub.marks('2026-11-08', '2026-11-09');
  assert.ok((marks['2026-11-08']?.meetings ?? 0) >= 1, 'today’s dot counts the kept-out meeting');
  assert.equal(marks['2026-11-09']?.meetings ?? 0, 0, 'tomorrow’s dot does not: the rest stays out');
});

test('Today’s keep leaves the bypass to the day’s own lists', () => {
  const hook = read('src/renderer/src/views/today/TodayAreas.tsx');
  assert.ok(hook.includes('dueFor') && hook.includes('dayFor'), 'the day’s lists filter through their own helpers');
  // The helpers take the day’s own keep for today’s meetings and due today (defaulting to the same keep).
  assert.ok(/dueFor\(due[^)]*keepToday|dueFor\(due,\s*keep,\s*\w+/.test(hook) || hook.includes('keepToday') || hook.includes('keepArea'), 'due today bypasses quiet through its own keep');
  assert.ok(/dayFor\(day[^)]*keepToday|dayFor\(day,\s*keep,\s*\w+/.test(hook) || hook.includes('keepToday') || hook.includes('keepArea'), 'today’s meetings bypass quiet through their own keep');
});
