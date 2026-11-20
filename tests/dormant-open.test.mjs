// node --test tests/dormant-open.test.mjs — a finished or on-hold project counts nowhere, but its open work must
// still reach the person (b6 break job, Nov 2026: the one list hid dormant projects whole — a timed reminder on
// one never fired, and open tasks added after it finished showed nowhere but its own page). An invented vault
// shaped like a real one: a finished kiosk with a cost correction to review and units still to ship, an on-hold
// night market with a task due tomorrow, an idea with a test due this week, and a live bakery beside them. A
// reminder with a time on a dormant project still fires (and rolls, ticks and snoozes from the bell) while
// staying out of Due, the counts and the lists; Today carries one quiet line naming the dormant projects that
// still hold open work, and every dormant project page says plainly how many it holds.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-dormant-open-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as todayCount from ${src('src/shared/today-count.ts')};`,
      `export * as today from ${src('src/shared/today.ts')};`,
      `export * as projectFile from ${src('src/shared/project-file.ts')};`,
      `export * as projectClose from ${src('src/shared/project-close.ts')};`,
      `export { Reminders } from ${src('src/main/reminders.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'dormant.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'dormant.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 4, 10, 0); // Wednesday 4 November 2026, 10:00 am
const AT = new Date(2026, 10, 3, 10).getTime();
const ME = 'Mia Tran';

const KIOSK = 'Projects/Harbour Kiosk/Harbour Kiosk.md';
const MARKET = 'Projects/Night Market/Night Market.md';
const TRAIL = 'Projects/Salt Trail/Salt Trail.md';
const COOKBOOK = 'Projects/Cookbook/Cookbook.md';
const BAKERY = 'Projects/Bakery Launch/Bakery Launch.md';
const SHOP = 'Projects/Old Shop/Old Shop.md';

function vaultFiles() {
  return {
    [KIOSK]: `---\ntype: project\nstatus: done\nowner: Mia Tran\n---\n# Harbour Kiosk\n\n## What’s next\n\n- [ ] Fix the cost correction — Mia · by 3 Nov 2026\n- [ ] Ship the units — Mia · by 10 Nov 2026\n- [ ] Repaint the sign — Mia\n\n## Bills\n\n- [ ] Kiosk power bill ⏰ 2026-11-04 09:00\n`,
    'Projects/Harbour Kiosk/Notes/Kiosk handover.md': `---\nproject: "[[Harbour Kiosk]]"\n---\n# Kiosk handover\n\n- [ ] Read the meter ⏰ 2026-11-04 09:30\n- [ ] Check the coolroom ⏰ 2026-11-04 08:00 every day\n`,
    [MARKET]: `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Night Market\n\n## What’s next\n\n- [ ] Ring Mara about the stall — Mia · by 5 Nov 2026\n- [ ] Redesign the flyer — Mia\n`,
    'Projects/Night Market/Notes/Stall map.md': `---\nproject: "[[Night Market]]"\n---\n# Stall map\n\n- [ ] Confirm the stall ⏰ 2026-11-04 09:15\n`,
    [TRAIL]: `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Salt Trail\n\n## What’s next\n\n- [ ] Walk the track again — Mia\n- [ ] File the permit — Mia · by 1 Sep 2026\n`,
    [COOKBOOK]: `---\ntype: project\nstatus: idea\nowner: Mia Tran\n---\n# Cookbook\n\n## What’s next\n\n- [ ] Test the soup — Mia · by 6 Nov 2026\n`,
    [BAKERY]: `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by 3 Nov 2026\n`,
    [SHOP]: `---\ntype: project\nstatus: done\nowner: Mia Tran\n---\n# Old Shop\n\n## What’s next\n\n- [x] Shut the lease — Mia · by 1 Oct 2026\n`,
    'Reminders.md': `# Reminders\n\n- [ ] Buy milk ⏰ 2026-11-04 09:45\n`,
  };
}

function service() {
  const index = new M.VaultIndex();
  const files = vaultFiles();
  for (const [rel, text] of Object.entries(files)) index.set(rel, text, AT, text.length);
  const clock = { now: new Date(2026, 10, 4, 7, 0).getTime() };
  const shown = [];
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const svc = new M.Reminders({
    dataDir,
    index,
    library: () => '/made-up/library',
    read: (rel) => index.content(rel),
    write: async (rel, text) => index.set(rel, text, AT + 1, text.length),
    templatesFolder: () => 'Templates',
    show: (n) => shown.push(n),
    changed: () => {},
    now: () => clock.now,
  });
  return { index, svc, clock, shown };
}

test('a reminder with a time on a finished or on-hold project still fires, and still counts nowhere', async () => {
  const { svc, clock, shown, index } = service();
  await svc.check(); // the first check ever: nothing said
  assert.equal(shown.length, 0);
  clock.now = NOW.getTime();
  await svc.check();
  // All five come due while the PC is away (several missed at once: one notification, as ever).
  assert.equal(shown.length, 1, 'one Windows notice for the missed batch');
  assert.match(shown[0].title, /5 reminders you missed/, 'naming the batch');
  assert.match(shown[0].body, /Kiosk power bill/, 'a finished project’s chime among them');
  // The bell holds each fired one by name (Done and Snooze work from there); the lists still count them nowhere.
  const notices = svc.notices();
  for (const chime of ['Kiosk power bill', 'Read the meter', 'Check the coolroom', 'Confirm the stall', 'Buy milk']) {
    assert.ok(notices.some((n) => n.title === chime), `${chime} is said at its time, finished project or not`);
  }
  assert.ok(notices.some((n) => n.title === 'Confirm the stall' && n.note === 'Projects/Night Market/Notes/Stall map.md'), 'the fired one opens its note');
  await svc.check();
  assert.equal(svc.notices().length, 5, 'said once, never twice');
  const items = svc.items().map((i) => i.text);
  for (const quiet of ['Kiosk power bill', 'Read the meter', 'Check the coolroom', 'Confirm the stall']) {
    assert.ok(!items.includes(quiet), `${quiet} stays out of the reminder lists`);
  }
  assert.ok(items.includes('Buy milk'), 'the live reminder still lists');
  const v = svc.view();
  const grouped = [...(v.overdue ?? []), ...(v.today ?? []), ...(v.upcoming ?? [])].map((i) => i.text);
  assert.ok(!grouped.includes('Confirm the stall'), 'out of the card’s groups too');
});

test('a repeating reminder on a finished project moves on, and ticks from the bell', async () => {
  const { svc, clock, index } = service();
  await svc.check();
  clock.now = NOW.getTime();
  await svc.check();
  const handover = 'Projects/Harbour Kiosk/Notes/Kiosk handover.md';
  assert.match(index.content(handover) ?? '', /Check the coolroom ⏰ 2026-11-05/, 'the repeat moves to its next day in the note');
  const notice = svc.notices().find((n) => n.title === 'Confirm the stall');
  assert.ok(notice?.reminder, 'the fired notice carries its reminder');
  await svc.done(notice.reminder);
  assert.match(index.content('Projects/Night Market/Notes/Stall map.md') ?? '', /\[x\] Confirm the stall/, 'ticked where it lives, from the bell');
});

function todayInput() {
  const files = vaultFiles();
  return {
    projects: [KIOSK, MARKET, TRAIL, COOKBOOK, BAKERY, SHOP].map((p, i) => ({ path: p, version: `v${i}`, modified: AT, project: M.projectFile.parseProject(files[p], p) })),
    notes: [],
    me: ME,
  };
}

test('Today names the dormant projects that still hold open work, and nothing else', () => {
  assert.equal(typeof M.today.dormantOpenProjects, 'function', 'the one dormant-open reading lives beside buildToday');
  const d = M.today.buildToday(todayInput(), NOW);
  assert.ok(Array.isArray(d.dormantOpen), 'Today carries the quiet list');
  assert.deepEqual(
    d.dormantOpen,
    [
      { project: KIOSK, projectName: 'Harbour Kiosk', finished: true, open: 3 },
      { project: MARKET, projectName: 'Night Market', finished: false, open: 1 },
      { project: COOKBOOK, projectName: 'Cookbook', finished: false, open: 1 },
    ],
    'finished names every open step; on-hold and ideas name what falls due within the week; parked dateless and stale work, live projects and finished-and-done stay out',
  );
  // The counts never move: the quiet list informs, it does not count.
  const allDue = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale, ...d.due.passed];
  for (const quiet of ['Fix the cost correction', 'Ring Mara about the stall', 'Test the soup']) {
    assert.ok(!allDue.some((x) => x.what === quiet), `${quiet} is still out of Today’s lists`);
  }
});

test('the quiet line says it plainly, in the project page’s own words', () => {
  assert.equal(typeof M.today.dormantOpenWords, 'function', 'one words helper, so Today and the page say the same');
  const one = [{ project: KIOSK, projectName: 'Harbour Kiosk', finished: true, open: 3 }];
  assert.equal(M.today.dormantOpenWords(one), 'Harbour Kiosk still has 3 loose ends');
  assert.equal(M.today.dormantOpenWords([{ project: MARKET, projectName: 'Night Market', finished: false, open: 1 }]), 'Night Market still has 1 open task');
  assert.equal(
    M.today.dormantOpenWords([...one, { project: MARKET, projectName: 'Night Market', finished: false, open: 2 }, { project: COOKBOOK, projectName: 'Cookbook', finished: false, open: 1 }]),
    'Harbour Kiosk still has 3 loose ends · Night Market still has 2 open tasks · Cookbook still has 1 open task',
  );
  assert.equal(
    M.today.dormantOpenWords([...one, { project: MARKET, projectName: 'Night Market', finished: false, open: 1 }, { project: COOKBOOK, projectName: 'Cookbook', finished: false, open: 1 }, { project: TRAIL, projectName: 'Salt Trail', finished: false, open: 1 }]),
    'Harbour Kiosk still has 3 loose ends · Night Market still has 1 open task · Cookbook still has 1 open task and 1 more',
  );
  assert.equal(M.today.dormantOpenWords([]), '');
  assert.equal(M.today.dormantOpenCountWords({ finished: true, open: 3 }), '3 loose ends');
  assert.equal(M.today.dormantOpenCountWords({ finished: false, open: 1 }), '1 open task');
});

test('Today draws the quiet line, opening one project or choosing between several', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('dormantOpen'), 'Today reads the quiet list');
  assert.ok(src.includes('dormantOpenWords'), 'in the one words');
  assert.ok(src.includes('td-quiet-line') && /dormant/i.test(src), 'as one quiet line');
});

test('an on-hold or idea project page says plainly how many tasks are still open', () => {
  const files = vaultFiles();
  const market = M.projectFile.parseProject(files[MARKET], MARKET);
  assert.equal(M.projectClose.openProjectTasks(market).length, 2, 'both steps still open on the page');
  const src = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(src.includes('isShelved'), 'the page knows a shelved project from a live one');
  assert.ok(/whats-next/.test(src), 'the line lands on What’s next');
});
