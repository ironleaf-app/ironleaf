// node --test tests/shared-space.test.mjs: shared spaces done properly (10.0 item 26, 2 Nov 2026): the shared
// module every door reads (src/shared/shared-space.ts), the main side's list and home (src/main/shared-spaces.ts),
// and the wiring (IPC, tabs, Places, the two views). Made-up notes; a fixed today (Monday 2 November 2026).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-shared-space-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/shared-space.ts'))};\nexport { SharedSpacesService } from ${JSON.stringify(path.join(root, 'src/main/shared-spaces.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'shared-space.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'shared-space.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-02'; // a Monday
const NOTES = [
  { path: 'Home/Our planning/Shopping.md', title: 'Shopping', content: '# Shopping\n\n- [ ] Milk\n- [x] Bread\n- [ ] Cheese for [[Sam]]\n' },
  { path: 'Home/Our planning/To do.md', title: 'To do', content: '# To do\n\n- [ ] Dentist forms for [[Sam]] 📅 2026-11-02\n- [ ] Pay the cleaner 📅 2026-10-30 15:00\n- [ ] Book flights 📅 2026-11-09\n- [ ] Call Priya ⏰ 2026-11-02 09:00\n' },
];

test('the marker says which bot looks after the space; a broken one is an ordinary folder', () => {
  assert.equal(S.SPACE_MARKER, '.shared-space.json');
  assert.deepEqual(S.parseSpaceMarker(JSON.stringify({ version: 1, bot: 'Household' })), { bot: 'Household' });
  for (const bad of ['nope', '', '{}', '[]', 'null', '{"bot":""}', '{"bot":42}']) assert.equal(S.parseSpaceMarker(bad), null, bad || '(empty)');
});

test('names read as people see them', () => {
  assert.equal(S.spaceName('Home/Our planning'), 'Our planning');
  assert.equal(S.linkName('People/Sam.md'), 'Sam');
  assert.equal(S.showWords('Dentist forms for [[People/Sam|Sam]] and [[Kid]]'), 'Dentist forms for Sam and Kid');
});

test('the summary: dates, open tasks and who owes what', () => {
  const s = S.summariseSpace('Home/Our planning', NOTES, TODAY);
  assert.equal(s.name, 'Our planning');
  assert.deepEqual(s.counts, { notes: 2, open: 6, overdue: 1, dueToday: 2, reminders: 1 });
  assert.deepEqual(
    s.owes.map((o) => [o.who, o.tasks.length]),
    [['Sam', 2]],
  );
  assert.equal(s.everyone.length, 4);
  assert.equal(s.reminders.length, 1);
  assert.ok(s.open[0].due === '2026-10-30' && s.open[0].words.includes('cleaner'), 'soonest due first');
  assert.equal(S.summariseSpace('Home/Our planning', [], TODAY).counts.open, 0);
  assert.equal(S.summariseSpace('Home/Our planning', NOTES, 'nope').counts.open, 6);
});

test('the phone words: the head, the sections, every cut named', () => {
  const words = S.sharedTodayWords(S.summariseSpace('Home/Our planning', NOTES, TODAY), TODAY, 'Monday 2 November 2026');
  assert.ok(words.startsWith('**Shared today** · Our planning\nMonday 2 November 2026'));
  for (const bit of ['**Dates**', 'Pay the cleaner', 'overdue', '**Open (6)**', 'Milk', '**Who owes what**', 'Sam owes:', 'For everyone:']) assert.ok(words.includes(bit), bit);
  assert.ok(!words.includes('[[') && !/—|–/.test(words));
  const many = S.summariseSpace('Home/Our planning', [{ path: 'Home/Our planning/To do.md', title: 'To do', content: Array.from({ length: 20 }, (_, i) => `- [ ] Job ${i + 1}`).join('\n') }], TODAY);
  assert.ok(S.sharedTodayWords(many, TODAY, 'Monday 2 November 2026').includes('Plus 10 more in the space.'));
});

test('the main side lists marked folders and reads one home', async () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'nv-space-vault-'));
  try {
    const space = path.join(vault, 'Home', 'Our planning');
    mkdirSync(space, { recursive: true });
    mkdirSync(path.join(vault, 'Me'), { recursive: true });
    writeFileSync(path.join(space, S.SPACE_MARKER), JSON.stringify({ version: 1, bot: 'Household', space: 'Home/Our planning' }));
    for (const n of NOTES) writeFileSync(path.join(vault, ...n.path.split('/')), n.content);
    writeFileSync(path.join(vault, 'Me', 'Private.md'), '# Private\n\n- [ ] Secret\n');
    const metas = [...NOTES.map((n) => ({ path: n.path, title: n.title })), { path: 'Me/Private.md', title: 'Private' }];
    const byPath = new Map([...NOTES.map((n) => [n.path, n.content]), ['Me/Private.md', '# Private\n\n- [ ] Secret\n']]);
    // The same fixed Monday as the rest of this file (it passed only on 2 Nov while the service read the real clock).
    const svc = new S.SharedSpacesService({ root: () => vault, now: () => new Date(`${TODAY}T12:00:00`).getTime(), index: { allMeta: () => metas, content: (p) => byPath.get(p) } });
    const list = await svc.list();
    assert.deepEqual(
      list.map((s) => [s.folder, s.name, s.bot, s.open]),
      [['Home/Our planning', 'Our planning', 'Household', 6]],
    );
    const home = await svc.home('Home/Our planning');
    assert.equal(home.name, 'Our planning');
    assert.equal(home.bot, 'Household');
    assert.deepEqual(home.summary.counts, { notes: 2, open: 6, overdue: 1, dueToday: 2, reminders: 1 });
    assert.equal(await svc.home('Me'), null, 'an ordinary folder has no home');
    assert.equal(await svc.home('../x'), null, 'a path out of the vault is refused');
    assert.equal(await new S.SharedSpacesService({ root: () => null, index: { allMeta: () => [], content: () => '' } }).list().then((l) => l.length), 0, 'no vault, no spaces');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('the wiring: IPC, tabs, Places and the two views', () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(app.includes("handle('shared-spaces:list'") && app.includes("handle('shared-spaces:home'") && app.includes('new SharedSpacesService'), 'the main side answers');
  const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  assert.ok(preload.includes('sharedSpaces:') && preload.includes("'shared-spaces:list'") && preload.includes("'shared-spaces:home'"), 'the window reaches it');
  const workspace = readFileSync(path.join(root, 'src/renderer/src/state/workspace.ts'), 'utf8');
  assert.ok(workspace.includes("'shared-spaces'") && workspace.includes("'shared-space'"), 'both tab types exist');
  const views = readFileSync(path.join(root, 'src/renderer/src/views/Workspace.tsx'), 'utf8');
  assert.ok(views.includes('<SharedSpacesHome') && views.includes('<SharedSpacePage'), 'both views render');
  const actions = readFileSync(path.join(root, 'src/renderer/src/state/actions.ts'), 'utf8');
  assert.ok(actions.includes('openSharedSpaces') && actions.includes('openSharedSpace'), 'both open');
  const commands = readFileSync(path.join(root, 'src/renderer/src/state/commands.ts'), 'utf8');
  assert.ok(commands.includes("id: 'shared-spaces'") && commands.includes('A.openSharedSpaces()'), 'the palette lists them (8 Nov 2026, the quiet More: out of More)');
  for (const view of ['SharedSpacesHome.tsx', 'SharedSpacePage.tsx']) {
    const tsx = readFileSync(path.join(root, 'src/renderer/src/views', view), 'utf8');
    assert.ok(!/—|–/.test(tsx), `${view}: no em dash in its words`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(tsx), `${view}: no hard color, the theme's own`);
  }
  assert.ok(!['shared-space.css', 'shared-spaces.css'].some((f) => { try { readFileSync(path.join(root, 'src/renderer/src/styles', f), 'utf8'); return true; } catch { return false; } }), 'no new stylesheet: the kit\u2019s own rows, cards and tags');
});
