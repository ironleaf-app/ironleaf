// node --test tests/life-records.test.mjs — the Wave 7 part b modules (src/shared/life-records.ts): Memories and Media,
// Business, Systems and Home Lab, Goals and Habits, and Reading, Watching and Lists. Each module's records read from
// plain notes, a change written as one property or one cell (every other character kept), its agent tools through a
// real gate (src/main/life-records.ts on the work modules' machinery), the bell's notices said once, and nothing at all
// while a module is off. A made-up household on a fixed day (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-life-records-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['lists', 'goals', 'systems', 'business', 'memories', 'life-records', 'life-modules', 'module-records', 'module-tools', 'sensitivity'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  return { dir, index };
}

/** The group on a made-up vault, with its switches (`switches.now`), its notices and what it wrote. */
function core(files, switches, extra = {}) {
  const { dir, index } = vault(files);
  const posted = [];
  const written = [];
  const w = new M.WorkModules(
    {
      vault: () => ({ root: dir, any: async (rel) => Object.prototype.hasOwnProperty.call(files, rel) || written.some((x) => x.rel === rel) }),
      index,
      prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
      writeNote: async (rel, text) => {
        written.push({ rel, text });
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
        index.set(rel, text, 0, text.length);
      },
      importFiles: async (paths, folder) => paths.map((p) => `${folder}/${path.basename(p)}`),
      pickFiles: async () => [],
      saveFile: async (o) => ((written.push({ rel: `export:${o.name}.${o.ext}`, text: String(o.data) }), `/exports/${o.name}.${o.ext}`)),
      post: (items) => {
        const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
        posted.push(...fresh);
        return fresh.length;
      },
      editProject: async () => ({}),
      projects: () => [],
      records: () => ({}),
      requireCreate: async () => {},
      now: () => TODAY,
      ...extra,
    },
    M.LIFE_RECORDS_GROUP,
  );
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  return { w, dir, index, posted, written, part, read };
}

/** A gate for an agent, with the person's levels (`store`). */
function gateFor(index, store, who, name) {
  const L = S.sensitivity;
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (w, rel, n) => L.decide(store, w, rel, sens.level(rel), n),
    useGrant: () => false,
    allows: (w, level) => L.allows(store, w, level),
    audit: () => {},
  };
  return M.makeGate(sens, who, name);
}

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'business', name: 'Business', folder: 'Business' }, { id: 'home', name: 'Home', folder: 'Home' }, { id: 'family', name: 'Family', folder: 'Family' }, { id: 'me', name: 'Me', folder: 'Me' }] });

// ── The catalogue ────────────────────────────────────────────────────────────────────────────────────────────────────

test('catalogue: four packs plus the albums’ machinery, off by default, each in its area with its level, its pages and its tools', () => {
  const { lifeModules: LM, moduleRecords: MR, lifeRecords: LR, moduleTools: MT, sensitivity: L } = S;
  const ids = ['business', 'systems', 'goals', 'lists'];
  for (const id of ids) {
    const info = LM.moduleInfo(id);
    const rec = MR.moduleById(id);
    assert.ok(info && rec, `${id} is in both catalogues`);
    assert.equal(LM.moduleOn({}, id), false, `${id} is off for a new vault`);
    assert.equal(info.level, rec.level, `${id}: one level`);
    assert.equal(info.area, rec.area, `${id}: one area`);
    assert.ok(info.offer?.does && info.offer.signals, `${id} has its own offer`);
    assert.ok(rec.sections.length >= 3, `${id} has its pages`);
    for (const t of rec.tools) assert.equal(MT.moduleToolDef(t)?.module, id, `${t} is offered as ${id}’s`);
  }
  // Packs uplift item 5 (5 Nov 2026): Memories merged into Family — no Memories pack, but the albums' record
  // machinery stands, and the old id reads as Family.
  assert.ok(!LM.LIFE_MODULES.some((m) => m.id === 'memories'), 'no Memories pack in the catalogue');
  assert.equal(LM.moduleInfo('memories').id, 'family', 'the old id reads as Family');
  assert.equal(LM.moduleOn({ family: { on: true } }, 'memories'), true, 'the machinery is on when Family is on');
  const mem = MR.moduleById('memories');
  assert.ok(mem.sections.length >= 3, 'the albums’ pages stand');
  for (const t of mem.tools) assert.equal(MT.moduleToolDef(t)?.module, 'memories', `${t} is still offered`);
  assert.deepEqual(['memories', ...ids].map((id) => MR.moduleById(id).level), ['family', 'work', 'personal', 'health', 'personal']);
  // A record type has its module's level whether the module is on or off.
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'album').level, 'family');
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'customer').level, 'work');
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'machine').level, 'personal');
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'habit').level, 'health');
  assert.equal(L.levelOf(L.emptyStore(), 'x.md', undefined, 'list').level, 'personal');
  // Where each keeps its records, with areas and without.
  const areas = JSON.parse(AREAS).areas;
  assert.equal(MR.typeFolder('album', areas), 'Family/Memories and Media/Albums');
  assert.equal(MR.typeFolder('release', areas), 'Business/Releases');
  assert.equal(MR.typeFolder('machine', areas), 'Home/Systems and Home Lab/Machines');
  assert.equal(MR.typeFolder('goal', areas), 'Me/Goals and Habits/Goals');
  assert.equal(MR.typeFolder('list', areas), 'Me/Lists');
  assert.equal(MR.typeFolder('release', null), 'Business/Releases');
  // 26 Oct 2026: module folders left at the top of a vault with areas go into their area (only modules that are on).
  assert.deepEqual(MR.strayModuleFolders(['Systems and Home Lab', 'Finance', 'Work', 'Projects', 'Publications'], ['systems', 'finance', 'publications'], areas), [{ from: 'Finance', to: 'Me/Finance' }, { from: 'Systems and Home Lab', to: 'Home/Systems and Home Lab' }]);
  assert.deepEqual(MR.strayModuleFolders(['Systems and Home Lab'], ['finance'], areas), [], 'a module that is off is left alone');
  assert.deepEqual(MR.strayModuleFolders(['Finance'], ['finance'], null), [], 'a vault without areas keeps its top-level module folders');
  assert.equal(LR.LIFE_RECORD_MODULES.length, 5);
});

// ── Reading, Watching and Lists ──────────────────────────────────────────────────────────────────────────────────────

const SHOWS = `---
type: list
kind: Watching
---
Things Rua keeps recommending.

## Items

| Show | Status | On | Notes |
|---|---|---|---|
| Salt Roads | To watch | Streamline | |
| Paper Moons | watched | | Loved it |
| The Lighthouse Keepers | Watching | Harbour TV | Season 2 |
`;
const SHOPPING = `---
type: list
kind: Shopping
---
## Items

| Item | Status | Qty | Shop | Note | Added |
| --- | --- | --- | --- | --- | --- |
| Milk | Need | 2 | | | 2026-10-23 |
| Apples | Got | 6 | | | 2026-10-20 |
`;
const LISTS = () => ({ '.neuralvault/areas.json': AREAS, 'Me/Lists/Shows.md': SHOWS, 'Me/Lists/Shopping.md': SHOPPING });

test('lists: read from a hand-made table, each kind’s statuses, what is under way', () => {
  const { lists: X } = S;
  const m = X.listsModel([{ path: 'Me/Lists/Shows.md', title: 'Shows', props: { kind: 'Watching' }, content: SHOWS }, { path: 'Me/Lists/Shopping.md', title: 'Shopping', props: { kind: 'Shopping' }, content: SHOPPING }], TODAY);
  const shows = m.lists.find((l) => l.name === 'Shows');
  assert.deepEqual(shows.items.map((i) => [i.title, i.status, i.state, i.where, i.note]), [
    ['Salt Roads', 'To watch', 'open', 'Streamline', ''],
    ['Paper Moons', 'Watched', 'done', '', 'Loved it'],
    ['The Lighthouse Keepers', 'Watching', 'doing', 'Harbour TV', 'Season 2'],
  ]);
  assert.deepEqual(shows.columns, ['title', 'status', 'where', 'note']);
  assert.deepEqual([shows.open, shows.doing, shows.done], [1, 1, 1]);
  assert.deepEqual(m.doing.map((i) => i.title), ['The Lighthouse Keepers']);
  assert.equal(X.nextStatus('Watching', 'To watch'), 'Watching');
  assert.equal(X.nextStatus('Watching', 'Watched'), 'To watch');
  assert.equal(X.nextStatus('Shopping', 'Need'), 'Got');
  assert.equal(X.findList(m, 'my watch list')?.name, 'Shows');
  assert.equal(X.findList(m, 'grocery list')?.name, 'Shopping');
  assert.match(X.newListText('Wish list', 'Ari', [{ title: 'Skates' }], '2026-10-24'), /kind: "Wish list"\nfor: "Ari"\n---\n## Items\n\n\| Item \| Status \| Price \| For \| Link \| Note \| Added \|\n\| --- \| --- \| --- \| --- \| --- \| --- \| --- \|\n\| Skates \| Wanted \|   \|   \|   \|   \| 2026-10-24 \|/);
});

test('lists (8.3 wave 1): shopping adds up, and a list writes out as plain words to share', () => {
  const { lists: X } = S;
  const m = X.listsModel([{ path: 'Me/Lists/Shows.md', title: 'Shows', props: { kind: 'Watching' }, content: SHOWS }, { path: 'Me/Lists/Shopping.md', title: 'Shopping', props: { kind: 'Shopping' }, content: SHOPPING }], TODAY);
  const more = X.planListChange('list_add_item', { list: 'Shopping', item: 'Milk', qty: '1' }, { on: true, model: m });
  assert.deepEqual(more.set?.values, { qty: '3' }, 'two already there and one more is three, never a second row');
  assert.equal(X.planListChange('list_add_item', { list: 'Shopping', item: 'Milk' }, { on: true, model: m }).set?.values.qty, '3');
  const stocked = X.listsModel([{ path: 'Me/Lists/Shopping.md', title: 'Shopping', props: { kind: 'Shopping' }, content: `${SHOPPING}| Eggs | Need | 6 | | | 2026-10-24 |\n| Flour | Need | 500g | | | 2026-10-24 |\n` }], TODAY);
  assert.deepEqual(X.planListChange('list_add_item', { list: 'Shopping', item: 'egg' }, { on: true, model: stocked }).set?.values, { qty: '7' }, 'egg is more Eggs, never a second row');
  assert.deepEqual(X.planListChange('list_add_item', { list: 'Shopping', item: 'Flour', qty: '500g' }, { on: true, model: stocked }).set?.values, { qty: '1000g' }, 'the same unit adds up with its unit kept');
  assert.deepEqual(X.planListChange('list_add_item', { list: 'Shopping', item: 'flour' }, { on: true, model: stocked }).set?.values, { qty: '500g + 1' }, 'different quantities are both kept, never mushed to 501');
  assert.throws(() => X.planListChange('list_add_item', { list: 'Shows', item: 'Salt Roads' }, { on: true, model: m }), /already on Shows/, 'only shopping adds up');
  assert.equal(X.listShareText(m.lists.find((l) => l.name === 'Shopping')), 'Shopping:\n- Milk × 2\n\nDone:\n- Apples × 6');
  assert.match(X.answerListTool({ model: m, on: true }, 'list_share', { list: 'shopping' }), /^Shopping:/);
});

test('lists: an item added is one row, a change one cell, the finished taken off, a new list with its kind’s columns', async () => {
  const files = LISTS();
  const switches = { now: { lists: { on: true } } };
  const { part, read } = core(files, switches);
  const lists = part('lists');
  const rel = 'Me/Lists/Shows.md';
  // A row added to the hand-made table: its own columns (Show, On, Notes) kept; a new column only when needed.
  assert.equal(await lists.ops['add-item'](rel, { title: 'Night Market' }), 'Added Night Market to Shows.');
  assert.equal(read(rel), SHOWS.replace('| Season 2 |\n', '| Season 2 |\n| Night Market | To watch |  |  |  |\n').replace('| Show | Status | On | Notes |\n|---|---|---|---|', '| Show | Status | On | Notes | Added |\n|---|---|---|---| --- |').replace(/(\| Salt Roads \| To watch \| Streamline \| \|)/, '$1  |').replace(/(\| Paper Moons \| watched \| \| Loved it \|)/, '$1  |').replace(/(\| The Lighthouse Keepers \| Watching \| Harbour TV \| Season 2 \|)/, '$1  |').replace('| Night Market | To watch |  |  |  |', '| Night Market | To watch |  |  | 2026-10-24 |'));
  await assert.rejects(lists.ops['add-item'](rel, { title: 'night market' }), /already on Shows/);
  // A status moved on: that one cell, checked against the row shown.
  const before = read(rel);
  assert.equal(await lists.ops['set-item'](rel, 0, 'Salt Roads', { status: 'Watching' }), null);
  assert.equal(read(rel), before.replace('| Salt Roads | To watch |', '| Salt Roads | Watching |'));
  await assert.rejects(lists.ops['set-item'](rel, 0, 'Somebody else', { status: 'Watched' }), /changed just now/);
  await assert.rejects(lists.ops['set-item'](rel, 0, 'Salt Roads', { rating: 9 }), /rating from 1 to 5/);
  // A rating where the table has no Rating column: the column is added.
  assert.equal(await lists.ops['set-item'](rel, 1, 'Paper Moons', { rating: '4' }), null);
  assert.match(read(rel), /\| Show \| Status \| On \| Notes \| Added \| Rating \|/);
  assert.match(read(rel), /\| Paper Moons \| watched \| \| Loved it \|  \| 4 \|/);
  assert.match(read(rel), /^Things Rua keeps recommending\.$/m);
  // From a record view.
  await lists.ops['set-field']({ kind: 'listitem', path: rel, ref: { row: 2 }, title: 'The Lighthouse Keepers', field: 'where_on', value: 'Streamline' });
  assert.match(read(rel), /\| The Lighthouse Keepers \| Watching \| Streamline \|/);
  await lists.ops['set-field']({ kind: 'list', path: rel, field: 'list_for', value: 'Rua' });
  assert.match(read(rel), /^for: Rua$/m);
  // Shopping: what's got taken off in one go, then everything back to Need.
  const shop = 'Me/Lists/Shopping.md';
  assert.match(await lists.ops['clear-done'](shop), /Took Apples off Shopping/);
  assert.doesNotMatch(read(shop), /Apples/);
  await lists.ops['add-item'](shop, { title: 'Bread', status: 'Got' });
  assert.match(await lists.ops.restart(shop), /Every item on Shopping is need again/);
  assert.match(read(shop), /\| Bread \| Need \|/);
  assert.match(await lists.ops['remove-item'](shop, 0, 'Milk'), /Took Milk off Shopping/);
  // A new list, with its kind's columns and a name of its own.
  const made = await lists.ops['add-list']({ name: 'Podcasts', kind: 'Listening' });
  assert.equal(made, 'Me/Lists/Podcasts.md');
  assert.match(read(made), /kind: Listening[\s\S]*\| Item \| Status \| Artist \| On \| Link \| Note \| Added \|/);
  await assert.rejects(lists.ops['add-list']({ name: 'podcasts' }), /already a list called/);
});

test('lists: the tools through a gate, and switched off nothing shows and nothing is lost', async () => {
  const L = S.sensitivity;
  const files = LISTS();
  const switches = { now: { lists: { on: true } } };
  const { w, index, read, dir } = core(files, switches);
  // Personal by default: a chat bot (Open and Work only) is told why it sees none; the former host
  // app sees them.
  const store = L.emptyStore();
  const bot = await w.callTool('list_overview', {}, gateFor(index, store, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No lists yet\.\n2 lists are at a level Chat bot isn’t allowed/);
  const refused = await w.callTool('list_add_item', { list: 'shopping', item: 'Eggs' }, gateFor(index, store, 'neuralbot', 'Chat bot'));
  assert.match(refused.text, /marked Personal and Chat bot isn’t allowed/);
  const spark = gateFor(index, { ...store, access: { neuralspark: ['open', 'work', 'personal'] } }, 'neuralspark', 'the host app');
  assert.match((await w.callTool('list_get', { list: 'watch list', status: 'open' }, spark)).text, /Shows \(Watching\): 2 items \(open\)\. \[Me\/Lists\/Shows\.md\]\n- Salt Roads \(To watch\), on Streamline\n- The Lighthouse Keepers \(Watching\), on Harbour TV — Season 2/);
  assert.match((await w.callTool('list_add_item', { list: 'shopping list', item: 'Eggs', qty: '12' }, spark)).text, /Added Eggs to Shopping\. \[Me\/Lists\/Shopping\.md\]/);
  assert.match(read('Me/Lists/Shopping.md'), /\| Eggs \| Need \| 12 \|  \|  \| 2026-10-24 \|/);
  assert.match((await w.callTool('list_set_status', { list: 'Shows', item: 'salt roads', status: 'watched', rating: 5 }, spark)).text, /Salt Roads on Shows is watched now \(5\/5\)/);
  assert.match((await w.callTool('list_add_item', { list: 'Recipes', item: 'x' }, spark)).text, /There is no list called “Recipes”\. Lists: Shows, Shopping/);
  // Switched off: no tools, the tool says so, every note as it was.
  const kept = read('Me/Lists/Shows.md');
  switches.now = { lists: { on: false } };
  assert.deepEqual(w.toolsOn(), []);
  assert.equal(await w.check(), 0);
  assert.match((await w.callTool('list_overview', {}, null)).text, /switched off/);
  assert.equal(readFileSync(path.join(dir, 'Me/Lists/Shows.md'), 'utf8'), kept);
});

// ── Goals and Habits ─────────────────────────────────────────────────────────────────────────────────────────────────

const RUN = `---
type: goal
category: Fitness
status: On track
started: 2026-08-25
by: 2026-12-03
unit: km
start_value: 0
target_value: 21
current: 12
---
## Why

For the harbour race.

## Milestones

| Milestone | Due | Done |
| --- | --- | --- |
| First 5 km | 2026-09-09 | 2026-09-14 |
| 10 km | 2026-10-12 | yes |
| 15 km | 2026-10-25 | |

## Notes

`;
const READ = `---
type: habit
days_a_week: 7
status: Active
---
## Log

- 2026-10-15
- 2026-10-17
- 18 Oct 2026
- 2026-10-19 — on the train
- 2026-10-20
- 2026-10-21
- 2026-10-22
- 2026-10-23

## Notes

`;
const RUNS = `---
type: habit
goal: "[[Run a half marathon]]"
days_a_week: 3
status: Active
---
## Log

- 2026-10-05
- 2026-10-07
- 2026-10-09
- 2026-10-12
- 2026-10-14
- 2026-10-16
- 2026-10-20
- 2026-10-22

## Notes

`;
const GOALS = () => ({ '.neuralvault/areas.json': AREAS, 'Me/Goals and Habits/Goals/Run a half marathon.md': RUN, 'Me/Goals and Habits/Habits/Read for 20 minutes.md': READ, 'Me/Goals and Habits/Habits/Morning run.md': RUNS });

test('goals: progress from the numbers, pace, milestones, streaks by day and by week, the week’s summary', () => {
  const { goals: G } = S;
  const notes = Object.entries(GOALS()).filter(([k]) => k.endsWith('.md')).map(([path, content]) => ({ path, title: path.split('/').pop().replace(/\.md$/, ''), props: Object.fromEntries([...content.matchAll(/^(\w+): ?(.*)$/gm)].map((x) => [x[1], x[2].replace(/^"|"$/g, '')])), content, type: /type: (\S+)/.exec(content)[1] }));
  const m = G.goalsModel(notes, TODAY, { health: [{ id: 'af', name: 'Alcohol-free day', days: ['2026-10-22', '2026-10-23', '2026-10-24'] }] });
  const g = m.goals[0];
  assert.equal(Math.round(g.progress * 100), 57);
  assert.equal(g.progressFrom, 'value');
  assert.equal(g.pace, 'On pace');
  assert.deepEqual(g.milestones.map((x) => [x.title, x.done, x.doneOn]), [['First 5 km', true, '2026-09-14'], ['10 km', true, null], ['15 km', false, null]]);
  assert.equal(g.next.title, '15 km');
  assert.deepEqual(g.habits, ['Morning run']);
  assert.equal(G.ofTarget(g), '12 of 21 km');
  const read = m.habits.find((h) => h.name === 'Read for 20 minutes');
  assert.deepEqual([read.streak, read.unit, read.best, read.today, read.thisWeek], [7, 'day', 7, false, 5]);
  const run = m.habits.find((h) => h.name === 'Morning run');
  assert.deepEqual([run.streak, run.unit, run.thisWeek], [2, 'week', 2]);
  assert.deepEqual(m.healthHabits.map((h) => [h.name, h.streak, h.today, h.source]), [['Alcohol-free day', 3, true, 'health']]);
  assert.equal(m.week.start, '2026-10-19');
  assert.deepEqual(m.week.habits.map((h) => [h.name, h.done, h.target]), [['Morning run', 2, 3], ['Read for 20 minutes', 5, 7], ['Alcohol-free day', 3, 7]]);
  assert.equal(m.reviewDue, false, 'the review is due on Sunday');
  assert.equal(G.goalsModel(notes, '2026-10-25').reviewDue, true);
  assert.equal(G.amountIn(900, '$'), '$900');
  // A log line ticked in order; unticked; an empty log made.
  assert.match(G.withLogDay(READ, '2026-10-16', true), /- 2026-10-15\n- 2026-10-16\n- 2026-10-17/);
  assert.doesNotMatch(G.withLogDay(READ, '2026-10-20', false), /2026-10-20/);
  assert.match(G.withLogDay('---\ntype: habit\n---\n## Log\n\n\n## Notes\n\n', '2026-10-24', true), /## Log\n\n- 2026-10-24\n\n## Notes/);
});

test('goals: changes as one property, one cell or one log line; a review saved with how the week went; tools through a gate', async () => {
  const L = S.sensitivity;
  const files = GOALS();
  const switches = { now: { goals: { on: true } } };
  const { part, read, w, index, posted } = core(files, switches);
  const goals = part('goals');
  const rel = 'Me/Goals and Habits/Goals/Run a half marathon.md';
  await goals.ops['set-goal'](rel, 'current', '14');
  assert.equal(read(rel), RUN.replace('current: 12', 'current: 14'));
  assert.equal(await goals.ops['set-milestone'](rel, 2, '15 km', { done: true }), '15 km: reached.');
  assert.match(read(rel), /\| 15 km \| 2026-10-25 \| 2026-10-24 \|/);
  await assert.rejects(goals.ops['set-milestone'](rel, 2, 'Other', { due: '2026-11-01' }), /changed just now/);
  assert.match(await goals.ops['add-milestone'](rel, { title: '18 km', due: '2026-11-15' }), /Added the milestone 18 km/);
  assert.match(read(rel), /\| 18 km \| 2026-11-15 \|  \|\n\n## Notes/);
  await goals.ops['set-goal'](rel, 'why', 'For the harbour race, with Rua.');
  assert.match(read(rel), /## Why\n\nFor the harbour race, with Rua\.\n\n## Milestones/);
  const habit = 'Me/Goals and Habits/Habits/Read for 20 minutes.md';
  await goals.ops.tick(habit, '2026-10-24', true);
  assert.match(read(habit), /- 2026-10-23\n- 2026-10-24\n/);
  await assert.rejects(goals.ops.tick(habit, '2026-10-30', true), /still to come/);
  await assert.rejects(goals.ops.tick(habit, 'someday', true), /YYYY-MM-DD/, 'a day that is not a day is refused, never silently today');
  const made = await goals.ops['add-goal']({ name: 'Save for a trip', category: 'Money', unit: '$', start_value: '0', target_value: '3000', by: '2027-02-01', milestones: [{ title: 'First $1000' }] });
  assert.match(read(made), /type: goal\ncategory: Money\nstatus: Not started\nstarted: 2026-10-24\nby: 2027-02-01\nunit: "\$"\nstart_value: 0\ntarget_value: 3000\ncurrent: 0/);
  // The review: its reflections written, and how the week went kept with it.
  const review = await goals.ops['save-review']({ wins: 'Ran 15 km.', mood: 'Good' });
  assert.equal(review, 'Me/Goals and Habits/Reviews/Goals review 2026-10-19.md');
  assert.match(read(review), /week: 2026-10-19\nmood: Good\n---\n## Wins\n\nRan 15 km\.\n\n## What got in the way\n\n\n## Focus next week\n\n\n## Goals this week\n\n- \[\[Run a half marathon\]\]: On track \(67%\); reached 15 km/);
  await assert.rejects(goals.ops['save-review']({ week: 'someday', wins: 'x' }), /day/, 'a week that is not a day is refused, never silently this week');
  await goals.ops['save-review']({ focus: 'Three runs.' });
  assert.match(read(review), /## Focus next week\n\nThree runs\.\n\n## Goals this week/);
  assert.match(read(review), /## Wins\n\nRan 15 km\./);
  // Notices: the milestone due (none now), said once.
  await w.check();
  const again = await w.check();
  assert.equal(again, 0, 'said once');
  void posted;
  // Health level: an agent allowed only Open and Work gets nothing and is told why.
  const store = L.emptyStore();
  const bot = await w.callTool('goal_list', {}, gateFor(index, store, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No goals yet\.\n\d goal or habit notes? (is|are) at a level Chat bot isn’t allowed/);
  const spark = gateFor(index, { ...store, access: { neuralspark: ['open', 'work', 'personal', 'health'] } }, 'neuralspark', 'the host app');
  assert.match((await w.callTool('habit_streaks', {}, spark)).text, /Read for 20 minutes: done today; 6 of 7 this week \(every day\); streak 8 days/);
  assert.match((await w.callTool('habit_log', { habit: 'morning run' }, spark)).text, /Ticked Morning run for today/);
  assert.match((await w.callTool('goal_milestone_done', { goal: 'Run a half', milestone: '18 km', day: '2026-10-24' }, spark)).text, /Marked 18 km reached/);
  assert.match((await w.callTool('goal_review_week', {}, spark)).text, /Week of Mon 19 Oct to Sun 25 Oct\.[\s\S]*The person’s review[\s\S]*Focus next week: Three runs\./);
});

// ── Systems and Home Lab ─────────────────────────────────────────────────────────────────────────────────────────────

const NAS = `---
type: machine
kind: NAS
role: Files
address: 192.168.1.20
status: Up
---
## Credentials

- Admin: [locked](secret:Ab12Cd34Ef)

## Health log

| Date | Status | Note |
| --- | --- | --- |
| 2026-10-20 | Up | 61% full |

## Notes

`;
const BOX = `---
type: machine
kind: Server
address: 192.168.1.30
status: Up
---
## Notes

Admin password: Tui-Kereru-4471!
`;
const svc = (p, extra = '') => `---\ntype: service\n${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n${extra}\n## Notes\n\n`;
const SYSTEMS = () => ({
  '.neuralvault/areas.json': AREAS,
  'Home/Systems and Home Lab/Machines/Garage NAS.md': NAS,
  'Home/Systems and Home Lab/Machines/Media box.md': BOX,
  'Home/Systems and Home Lab/Services/Photos.md': svc({ kind: 'Media', runs_on: '"[[Media box]]"', port: 2342, status: 'Up', depends_on: '["[[Database]]"]' }),
  'Home/Systems and Home Lab/Services/Database.md': svc({ kind: 'Database', runs_on: '"[[Media box]]"', port: 5432, status: 'Up' }),
  'Home/Systems and Home Lab/Services/Game server.md': svc({ kind: 'Game server', runs_on: '"[[Media box]]"', status: 'Down' }, '| 2026-10-24 | Down | Won’t start |\n'),
  'Home/Systems and Home Lab/Runbooks/Update the NAS.md': `---\ntype: runbook\nfor: ["[[Garage NAS]]"]\nevery: Monthly\nlast_run: 2026-09-14\n---\n## Steps\n\n1. Save the config\n2. Install updates\n3. Restart\n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n\n## Notes\n\n`,
});

test('systems: the map, logins only as locked links, a password in a note counted, runbooks due, steps and runs', async () => {
  const files = SYSTEMS();
  const switches = { now: { systems: { on: true } } };
  const { part, read, w, posted } = core(files, switches);
  const systems = part('systems');
  const m = await systems.ops.model();
  const box = m.machines.find((x) => x.name === 'Media box');
  assert.deepEqual(box.services.map((p) => p.split('/').pop()), ['Database.md', 'Game server.md', 'Photos.md']);
  assert.equal(box.plain, 1, 'the password written in the note is found');
  assert.deepEqual(m.machines.find((x) => x.name === 'Garage NAS').credentials, [{ label: 'Admin', id: 'Ab12Cd34Ef' }]);
  assert.deepEqual(m.services.find((x) => x.name === 'Database').dependents.map((p) => p.split('/').pop()), ['Photos.md']);
  assert.deepEqual(m.trouble.map((t) => [t.name, t.status, t.note]), [['Game server', 'Down', 'Won’t start']]);
  assert.deepEqual(m.runbooksDue.map((r) => [r.name, r.nextDue]), [['Update the NAS', '2026-10-14']]);
  // A health note: one row, its status and the day checked.
  const game = 'Home/Systems and Home Lab/Services/Game server.md';
  await systems.ops['health-note'](game, { status: 'up', note: 'Restarted' });
  assert.match(read(game), /status: Up\nchecked: 2026-10-24\n---[\s\S]*\| 2026-10-24 \| Up \| Restarted \|/);
  // A login linked (the value never comes here) and unlinked.
  const nas = 'Home/Systems and Home Lab/Machines/Garage NAS.md';
  await systems.ops['link-secret'](nas, 'Web admin', 'Zz98Yy76Xx');
  assert.match(read(nas), /- Admin: \[locked\]\(secret:Ab12Cd34Ef\)\n- Web admin: \[locked\]\(secret:Zz98Yy76Xx\)\n\n## Health log/);
  await assert.rejects(systems.ops['link-secret'](nas, 'x', 'hunter2 plain'), /isn’t a secret/);
  await systems.ops['unlink-secret'](nas, 'Ab12Cd34Ef');
  assert.doesNotMatch(read(nas), /Ab12Cd34Ef/);
  // Steps: one changed, one added (numbered on), one taken out (numbered again); a run kept.
  const rb = 'Home/Systems and Home Lab/Runbooks/Update the NAS.md';
  await systems.ops.step(rb, { at: 1, words: 'Install the updates' });
  await systems.ops.step(rb, { add: 'Check the shares' });
  assert.match(read(rb), /1\. Save the config\n2\. Install the updates\n3\. Restart\n4\. Check the shares/);
  await systems.ops.step(rb, { remove: 0 });
  assert.match(read(rb), /## Steps\n\n1\. Install the updates\n2\. Restart\n3\. Check the shares\n/);
  assert.match(await systems.ops['mark-run'](rb, { result: 'done with problems', note: 'One share slow' }), /done with problems today/);
  assert.match(read(rb), /last_run: 2026-10-24[\s\S]*\| 2026-10-24 \| Done with problems \| One share slow \|/);
  // The finding offered for the move into Secrets: masked, never its value.
  const found = await systems.ops.findings('Home/Systems and Home Lab/Machines/Media box.md');
  assert.equal(found.length, 1);
  assert.doesNotMatch(JSON.stringify(found), /Tui-Kereru-4471/);
  // Notices said once; the runbook was run, so only the game server (now up) and nothing else.
  await w.check();
  assert.equal(await w.check(), 0);
  assert.ok(posted.every((p) => !/Tui-Kereru/.test(JSON.stringify(p))));
  // Tools: the map never carries a login's value.
  const map = (await w.callTool('system_map', {}, null)).text;
  assert.match(map, /Garage NAS \(NAS, Files\): Up; 192\.168\.1\.20.*1 login kept in Secrets/);
  assert.doesNotMatch(map, /Zz98Yy76Xx|Tui-Kereru/);
  assert.match((await w.callTool('system_runbook_get', { runbook: 'garage nas' }, null)).text, /Update the NAS \(for Garage NAS\): Monthly; last run Sat 24 Oct[\s\S]*1\. Install the updates/);
  assert.match((await w.callTool('system_health_note', { name: 'photos', status: 'Degraded', note: 'Slow thumbnails' }, null)).text, /Noted Photos’s health \(Degraded\)/);
});

test('systems watching (30 Oct 2026): duplicate lines shown once, change-only log, 7 days, alerts, fix plans, runbooks written from a check', async () => {
  const { systems: X } = S;
  const checked = 'Checked: Ubuntu 26.04 LTS, up 11 days, disk 92% used, memory 14.5 of 15.3 GB, 65 updates waiting, 4 security updates waiting; 4 services running.';
  const files = SYSTEMS();
  files['Home/Systems and Home Lab/Machines/Garage NAS.md'] = NAS.replace('| 2026-10-20 | Up | 61% full |', '| 2026-10-17 | Up | Checked: Ubuntu 26.04 LTS, disk 70% used, memory 2.1 of 15.3 GB, 4 security updates waiting. |\n| 2026-10-24 | Up | ' + checked + ' |\n| 2026-10-24 | Up | ' + checked + ' |');
  const switches = { now: { systems: { on: true } } };
  const { part, read, w, posted } = core(files, switches);
  const m = await part('systems').ops.model();
  const nas = m.machines.find((x) => x.name === 'Garage NAS');
  assert.equal(nas.health.filter((h) => h.date === '2026-10-24').length, 1, 'the same line twice on one day is shown once, nothing deleted from the note');
  assert.equal((read('Home/Systems and Home Lab/Machines/Garage NAS.md').match(/up 11 days/g) ?? []).length, 2, 'both lines stay in the note');
  assert.deepEqual(X.historyOf(nas.health, '2026-10-24').map((d) => [d.date, d.disk]), [['2026-10-18', null], ['2026-10-19', null], ['2026-10-20', null], ['2026-10-21', null], ['2026-10-22', null], ['2026-10-23', null], ['2026-10-24', 92]]);
  assert.equal(X.shouldKeepCheck(nas.health, '2026-10-24', 'Up', checked), false, 'the same check again today keeps no line');
  assert.equal(X.shouldKeepCheck(nas.health, '2026-10-25', 'Up', checked), true, 'a new day keeps its one summary');
  assert.equal(X.shouldKeepCheck(nas.health, '2026-10-24', 'Down', 'Stopped answering'), true, 'a change today keeps a line');
  const alerts = X.alertsOf(m);
  for (const words of [/disk is 92% full/, /filling fast/, /memory is nearly full \(95%\)/, /Security updates have waited over a week/]) assert.ok(alerts.some((a) => words.test(a.title)), `alert: ${words}`);
  assert.ok(alerts.every((a) => a.nextStep.length > 3), 'every alert has its one next step');
  assert.equal(X.machineTone(m, nas), 'bad');
  assert.equal(X.actionPlan('free-disk', 'Garage NAS').command.includes('du -xhd1'), true, 'free disk shows what is big first and deletes nothing');
  assert.equal(X.actionPlan('free-disk', 'Garage NAS').command.includes('rm '), false);
  assert.match(X.actionPlan('restart-service', 'Garage NAS', 'Photo Library').command, /systemctl restart photo-library/);
  assert.equal(X.actionPlan('restart-service', 'Garage NAS', ''), null);
  assert.equal(X.actionPlan('wipe', 'Garage NAS'), null);
  const books = X.runbooksFromCheck('Garage NAS', 'Ubuntu 26.04 LTS', [{ name: 'Photos', kind: 'Media' }]);
  assert.deepEqual(books.map((b) => b.name), ['Update Garage NAS', 'Check backups on Garage NAS', 'Restore Garage NAS', 'Restart Photos']);
  assert.ok(books.every((b) => b.steps.length >= 3 && !/write the steps/i.test(b.steps.join(' '))));
  const many = X.runbooksFromCheck('Busy box', 'Ubuntu 26.04 LTS', Array.from({ length: 12 }, (_, i) => ({ name: `Svc ${i + 1}`, kind: 'Other' })));
  assert.equal(many.length, 12, '3 machine runbooks, 8 restarts, 1 summary — never 23 notes');
  assert.equal(many[11].name, 'Restart the other services on Busy box');
  assert.ok(many[11].steps.join(' ').includes('Svc 12'), 'every service past eight is still named in the summary');
  // Chat tools: status, a plan that still needs the person's OK, runbooks written, a result recorded.
  assert.match((await w.callTool('system_status', {}, null)).text, /Next step:/);
  assert.match((await w.callTool('system_action_plan', { machine: 'Garage NAS', action: 'install-updates' }, null)).text, /only with the person’s OK/);
  assert.match((await w.callTool('system_runbooks_write', { machine: 'Media box' }, null)).text, /This adds 6 runbooks for Media box/);
  assert.match((await w.callTool('system_runbooks_write', { machine: 'Media box' }, null)).text, /already has the runbooks it needs/);
  assert.match((await w.callTool('system_action_result', { machine: 'Garage NAS', action: 'Install the updates', note: 'Done; it answers again.' }, null)).text, /Recorded what the fix did/);
  assert.match(read('Home/Systems and Home Lab/Machines/Garage NAS.md'), /Install the updates: Done; it answers again\./);
  // The beat setting is kept, and check-all without a login checks nothing rather than failing.
  assert.deepEqual(await part('systems').ops.options({ checkMinutes: 30 }), { remindDays: 7, checkMinutes: 30 });
  assert.match(await part('systems').ops['check-all'](), /No machine could be checked yet/);
  await w.check();
  assert.ok(posted.some((p) => /disk is 92% full/.test(p.title) && /Next step:/.test(p.body)), 'the bell is told, with its next step');
});

test('systems truth (30 Oct 2026, fourth pass): a machine never checked is never up, and a failed check says so', async () => {
  const { systems: X, lifeModules: LM } = S;
  const note = (title, props, content) => ({ path: `Home/Systems and Home Lab/Machines/${title}.md`, title, props, content, type: 'machine' });
  const office = note('Office NAS', { kind: 'NAS', address: '192.168.1.50', status: 'Up' }, '## Credentials\n\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n');
  const failed = note('Failed box', { kind: 'Server', address: '192.168.1.60', status: 'Up', checked: '2026-10-24' }, '## Credentials\n\n- Admin: [locked](secret:Ab12Cd34Ef)\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-24 |  | Check now: It refused the login. Check the user name and password in Secrets. |\n');
  const m = X.systemsModel([office, failed], '2026-10-24');
  const [o, f] = [m.machines.find((x) => x.name === 'Office NAS'), m.machines.find((x) => x.name === 'Failed box')];
  assert.equal(X.machineState(o).words, 'Not checked yet', 'a machine never checked has its own state, not Up');
  assert.equal(X.machineState(o).tone, 'none', 'not checked yet is a neutral grey dot, not green');
  assert.equal(X.machineState(o).needsLogin, true);
  assert.equal(X.machineTone(m, o), 'none', 'a machine never checked is never shown green');
  const alerts = X.alertsOf(m);
  assert.ok(alerts.some((a) => a.title === 'Office NAS needs its login so it can be checked' && /Add its login/.test(a.nextStep)), 'it needs the person, with its one next step: add its login');
  assert.equal(X.machineState(f).words, 'Could not be checked', 'a failed check is not Up either');
  assert.equal(X.machineState(f).tone, 'warn');
  assert.ok(alerts.some((a) => /Failed box could not be checked: It refused the login/.test(a.title) && /Check its login in Secrets, then check Failed box again/.test(a.nextStep)), 'a failed check says why, with its next step');
  assert.doesNotMatch(X.newMachineText({ kind: 'NAS', address: '192.168.1.50' }), /status: Up/, 'a new machine note does not claim it is up before any check');
  const fills = LM.moduleInfo('systems').fills;
  assert.match(fills, /checks each machine on its own every 15 minutes once it has its address and login/);
  assert.match(fills, /writes its runbooks/);
  assert.match(fills, /says so when one drops/);
  assert.doesNotMatch(fills, /Check now signs in to a machine/);
  // In the window's own words (chat): nothing unchecked or failed is "everything is up".
  const files = SYSTEMS();
  files['Home/Systems and Home Lab/Machines/Office NAS.md'] = `---\ntype: machine\nkind: NAS\naddress: 192.168.1.50\nstatus: Up\n---\n## Credentials\n\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n`;
  const { part, w, posted } = core(files, { now: { systems: { on: true } } });
  const status = (await w.callTool('system_status', {}, null)).text;
  assert.match(status, /Office NAS needs its login so it can be checked/);
  assert.doesNotMatch(status, /everything is up/);
  const map = (await w.callTool('system_map', {}, null)).text;
  assert.match(map, /Office NAS \(NAS\): Not checked yet; 192\.168\.1\.50/);
  assert.doesNotMatch(map, /Everything is up/);
  await w.check();
  assert.ok(posted.some((p) => /Office NAS needs its login/.test(p.title)), 'the bell is told an unchecked machine needs its login');
  void part;
});

test('systems: linking a login to a machine with an address checks it straight away', async () => {
  const files = SYSTEMS();
  const { part, read } = core(files, { now: { systems: { on: true } } }, { login: async () => ({ username: 'madeup', value: 'made-up-value' }) });
  const rel = await part('systems').ops['add-machine']({ name: 'Socket box', kind: 'Server', address: '127.0.0.1:1' });
  const words = await part('systems').ops['link-secret'](rel, 'Admin login', 'Ab12Cd34Ef');
  assert.match(words, /Linked Admin login/, 'the login is linked from Secrets, its value never in the note');
  // Records as data (5 Nov 2026): the machine is a row, so its check lands in the list, not a note.
  const m = await part('systems').ops.model();
  const box = m.machines.find((x) => x.path === rel);
  assert.equal(box.checked, '2026-10-24', 'it was checked straight away, not at the next beat');
  assert.ok(box.health.some((h) => h.note.startsWith('Check now:')), 'the failed check is written to its health log');
  assert.deepEqual(box.credentials, [{ label: 'Admin login', id: 'Ab12Cd34Ef' }]);
  assert.doesNotMatch(read('Home/Systems and Home Lab/Machines.md'), /made-up-value/, 'the login value is never written in the list');
});

// ── Business ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const fm = (type, p, body = '') => `---\ntype: ${type}\n${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;
const BUSINESS = () => ({
  '.neuralvault/areas.json': AREAS,
  'Business/Releases/Tidewater 2.4.0.md': fm('release', { product: 'Tidewater', version: '"2.4.0"', date: '2026-10-21', status: 'Released' }, '## What changed\n\n- Search in attachments\n- CSV export\n\n## Notes\n\n'),
  'Business/Releases/Tidewater 2.3.2.md': fm('release', { product: 'Tidewater', version: '"2.3.2"', date: '2026-10-04', status: 'Released' }, '## What changed\n\n- Faster start\n'),
  'Business/Customers/Harbour Cafe.md': fm('customer', { plan: 'Pro', status: 'Active', value: 49, period: 'Monthly', renews: '2026-11-03' }, '## Notes\n\n'),
  'Business/Customers/Northside Gym.md': fm('customer', { plan: 'Team', status: 'Active', value: 990, period: 'Yearly' }, '## Notes\n\n'),
  'Business/Customers/Old Mill.md': fm('customer', { status: 'Churned', value: 49, period: 'Monthly' }, ''),
  'Business/Campaigns/Spring launch.md': fm('campaign', { channel: 'LinkedIn', status: 'Live', starts: '2026-10-19' }, '## Posts\n\n| Date | Channel | What | Status | Link |\n| --- | --- | --- | --- | --- |\n| 2026-10-19 | LinkedIn | What 2.4 does | Posted | |\n| 2026-10-24 | LinkedIn | Behind the scenes | Scheduled | |\n\n## Notes\n\n'),
  'Business/Support/Sign-in loop.md': fm('support-item', { customer: '"[[Harbour Cafe]]"', received: '2026-10-23', status: 'New', priority: 'Urgent' }, '## What they said\n\nIt keeps asking us to sign in.\n\n## What we did\n\n'),
  'Business/Websites/Main site.md': fm('website', { url: 'https://example.com', status: 'Up', domain_renews: '2026-11-05' }, '## Checks\n\n| Date | Status | Response | Note |\n| --- | --- | --- | --- |\n\n## Notes\n\n'),
});

test('business: the release log, what customers bring in, campaigns and their posts, support most urgent first, renewals', async () => {
  const L = S.sensitivity;
  const files = BUSINESS();
  const switches = { now: { business: { on: true } } };
  const { part, read, w, index, posted } = core(files, switches);
  const biz = part('business');
  const m = await biz.ops.model();
  assert.deepEqual(m.releases.map((r) => [r.version, r.changes.length]), [['2.4.0', 2], ['2.3.2', 1]]);
  assert.equal(Math.round(m.monthly * 100) / 100, 131.5);
  assert.equal(m.customers.find((c) => c.name === 'Harbour Cafe').openSupport, 1);
  assert.deepEqual(m.postsDue.map((p) => p.title), ['Behind the scenes']);
  assert.deepEqual(m.renewals.map((r) => [r.what, r.days]), [['domain', 12]]);
  // A change, a post, a check, a support item's words, each one line, one cell or one section.
  const rel = 'Business/Releases/Tidewater 2.4.0.md';
  await biz.ops.changes(rel, { add: 'Dark mode' });
  assert.match(read(rel), /- CSV export\n- Dark mode\n\n## Notes/);
  const camp = 'Business/Campaigns/Spring launch.md';
  await biz.ops['set-post'](camp, 1, 'Behind the scenes', { status: 'posted' });
  assert.match(read(camp), /\| 2026-10-24 \| LinkedIn \| Behind the scenes \| Posted \|/);
  await biz.ops['add-check']('Business/Websites/Main site.md', { status: 'Slow', response: '2.1 s' });
  assert.match(read('Business/Websites/Main site.md'), /status: Slow[\s\S]*checked: 2026-10-24[\s\S]*\| 2026-10-24 \| Slow \| 2\.1 s \|  \|/);
  await biz.ops['support-words']('Business/Support/Sign-in loop.md', 'did', 'Reset their session.');
  assert.match(read('Business/Support/Sign-in loop.md'), /## What we did\n\nReset their session\.\n/);
  await biz.ops['set-field']({ kind: 'ticket', path: 'Business/Support/Sign-in loop.md', field: 'status', value: 'Solved' });
  assert.match(read('Business/Support/Sign-in loop.md'), /status: Solved/);
  // Notices: the domain renewing, said once (the support item is solved now).
  await w.check();
  assert.ok(posted.some((p) => /Main site: domain renews in 12 days/.test(p.title)));
  assert.equal(await w.check(), 0);
  // Work-confidential: a chat bot (Open and Work by default) sees them; an agent allowed Open only does
  // not.
  const store = L.emptyStore();
  assert.match((await w.callTool('business_customer_list', {}, gateFor(index, store, 'neuralbot', 'Chat bot'))).text, /3 customers; active customers bring in about \$131\.50 a month/);
  const outside = gateFor(index, { ...store, access: { 'agent:x': ['open'] } }, 'agent:x', 'Chief');
  assert.match((await w.callTool('business_release_log', {}, outside)).text, /No releases logged in Business yet\.\n\d+ business notes are at a level Chief isn’t allowed/);
  assert.match((await w.callTool('business_release_add', { product: 'Tidewater', version: '2.4.1', changes: ['Sign-in fix'] }, outside)).text, /marked Work-confidential and Chief isn’t allowed/);
  assert.match((await w.callTool('business_release_add', { product: 'Tidewater', version: '2.4.1', changes: ['Sign-in fix'] }, null)).text, /Logged Tidewater 2\.4\.1 \(Released, Sat 24 Oct\)/);
  assert.match(read('Business/Releases/Tidewater 2.4.1.md'), /## What changed\n\n- Sign-in fix/);
});

test('8.3 wave 1 business: websites are checked on a schedule, page words watched, a failure nudged', async () => {
  const files = BUSINESS();
  files['Business/Websites/Main site.md'] = files['Business/Websites/Main site.md'].replace('url: https://example.com', 'url: http://example.test').replace('status: Up', 'status: Up\nchecked: 2026-10-23');
  const { part, read, w } = core(files, { now: { business: { on: true } } });
  const biz = part('business');
  const realFetch = globalThis.fetch;
  let body = '<p>Hello there</p>';
  globalThis.fetch = async () => ({ status: 200, text: async () => body });
  try {
    await w.check();
    const first = read('Business/Websites/Main site.md');
    assert.match(first, /checked: 2026-10-24/, 'the scheduled check wrote today');
    assert.match(first, /page_hash: [0-9a-f]{8}/, 'the page words were fingerprinted');
    assert.match(first, /Scheduled check/, 'the check says it was scheduled');
    // The same day again: no second visit.
    await w.check();
    assert.equal(read('Business/Websites/Main site.md').match(/Scheduled check/g).length, 1, 'once a day');
    // Its words change: the next check says so, in the note and by chat.
    body = '<p>Hello again, we moved</p>';
    assert.match(await biz.ops['site-check']('Business/Websites/Main site.md'), /page words have changed/);
    assert.match(read('Business/Websites/Main site.md'), /Page words changed since the last check/);
    // Down: the check writes Down, and the weekly answer says so.
    globalThis.fetch = async () => {
      throw new Error('no answer');
    };
    assert.match(await biz.ops['site-check']('Business/Websites/Main site.md'), /down/);
    assert.match(read('Business/Websites/Main site.md'), /status: Down/);
    assert.match(await biz.ops.week(), /Websites:/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('8.3 wave 1 business: the scheduled check reads the certificate expiry from the site itself', async (t) => {
  let opensslOk = true;
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    opensslOk = false;
  }
  if (!opensslOk) return t.skip('openssl is not available to make a test certificate');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-cert-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '400', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const expected = new Date(new X509Certificate(readFileSync(crt)).validTo);
  const expectedDay = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(crt) }, (req, res) => res.end('<p>Hello there</p>'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const files = BUSINESS();
  files['Business/Websites/Main site.md'] = files['Business/Websites/Main site.md'].replace('url: https://example.com', `url: https://127.0.0.1:${port}`).replace('status: Up', 'status: Up\nchecked: 2026-10-23');
  const { part, read } = core(files, { now: { business: { on: true } } });
  const biz = part('business');
  const realFetch = globalThis.fetch;
  // The visit is stubbed (a self-signed test certificate is not trusted by fetch); the certificate read is real TLS.
  globalThis.fetch = async () => ({ status: 200, text: async () => '<p>Hello there</p>' });
  try {
    await biz.ops['site-check']('Business/Websites/Main site.md');
    assert.match(read('Business/Websites/Main site.md'), new RegExp(`cert_expires: ${expectedDay}`), 'the certificate day from the site is written');
  } finally {
    globalThis.fetch = realFetch;
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Memories and Media ───────────────────────────────────────────────────────────────────────────────────────────────

const BEACH = `---
type: album
kind: Trip
date: 2024-10-24
place: Shell Bay
people: ["[[Ari Moana]]", "[[Tia Moana]]"]
cover: beach-2.jpg
---
## Photos

| File | Who | Caption | Date |
| --- | --- | --- | --- |
| beach-1.jpg | Ari Moana, Tia Moana | Sandcastle | |
| gone.jpg | Tia Moana | Moved away | |

## Notes

`;
const MEMS = () => ({
  '.neuralvault/areas.json': AREAS,
  'Family/Memories and Media/Albums/Beach weekend.md': BEACH,
  'Family/Memories and Media/Albums/Files/Beach weekend/beach-1.jpg': 'jpg',
  'Family/Memories and Media/Albums/Files/Beach weekend/beach-2.jpg': 'jpg',
  'Family/Memories and Media/Albums/Files/Beach weekend/clip.mp4': 'mp4',
  'Family/Memories and Media/Creative projects/Sports day poster.md': `---\ntype: creative-project\nkind: Poster\nstatus: Making\ndue: 2026-10-26\n---\n## Brief\n\n- Purpose: Cheer them on\n- Audience: The school\n- Tone: \n- Must-haves: Both girls\n\n## Notes\n\n`,
  'Family/Memories and Media/Creative projects/Files/Sports day poster/Sports day poster v2.png': 'png',
});

test('memories: albums with who is in each photo, on this day, by person, a brief line, versions; photos Family-private and asked for each use', async () => {
  const L = S.sensitivity;
  const files = MEMS();
  // Packs uplift item 5 (5 Nov 2026): the albums' machinery answers when Family is on (Memories merged into Family).
  const switches = { now: { family: { on: true } } };
  const { part, read, w, index, posted } = core(files, switches);
  const mem = part('memories');
  const m = await mem.ops.model();
  const a = m.albums[0];
  // Packs uplift item 5 (5 Nov 2026): a hand-written Photos row counts even when its file is not beside the
  // note (gone.jpg), so the count agrees with the table; it stays on `missing` until the file is added.
  assert.deepEqual(a.photos.map((p) => [p.name, p.who.join('+'), p.caption, p.video]), [['beach-1.jpg', 'Ari Moana+Tia Moana', 'Sandcastle', false], ['beach-2.jpg', '', '', false], ['clip.mp4', '', '', true], ['gone.jpg', 'Tia Moana', 'Moved away', false]]);
  assert.equal(a.cover.split('/').pop(), 'beach-2.jpg');
  assert.deepEqual(a.missing, ['gone.jpg']);
  assert.deepEqual(m.onThisDay.map((x) => [x.album.name, x.years]), [['Beach weekend', 2]]);
  assert.deepEqual(m.people.map((p) => [p.name, p.photos.length]), [['Tia Moana', 2], ['Ari Moana', 1]]);
  assert.deepEqual(m.creative[0].versions.map((v) => v.label), ['v2']);
  // Who is in a photo: its row, made the first time; changed after.
  const rel = 'Family/Memories and Media/Albums/Beach weekend.md';
  await mem.ops.photo(rel, 'beach-2.jpg', { who: 'Ari Moana', caption: 'Sunset walk' });
  assert.match(read(rel), /\| gone\.jpg \| Tia Moana \| Moved away \| \|\n\| beach-2\.jpg \| Ari Moana \| Sunset walk \|  \|/);
  await mem.ops.photo(rel, 'beach-1.jpg', { caption: 'The sandcastle' });
  assert.match(read(rel), /\| beach-1\.jpg \| Ari Moana, Tia Moana \| The sandcastle \| \|/);
  await mem.ops.brief('Family/Memories and Media/Creative projects/Sports day poster.md', 'tone', 'Wild West');
  assert.match(read('Family/Memories and Media/Creative projects/Sports day poster.md'), /- Audience: The school\n- Tone: Wild West\n- Must-haves: Both girls/);
  await w.check();
  assert.ok(posted.some((p) => /Sports day poster is needed in 2 days/.test(p.title)));
  // The photos are Family-private as their album is (whatever folder they sit in), so an agent allowed Family-private
  // is asked for each use, and one that isn't never sees them.
  const store = L.emptyStore();
  const photo = 'Family/Memories and Media/Albums/Files/Beach weekend/beach-1.jpg';
  assert.equal(L.fileLevelOf(store, photo, (r) => index.get(r)?.props).level, 'family');
  assert.equal(L.fileLevelOf(store, 'Somewhere/else.jpg', (r) => index.get(r)?.props).level, 'open');
  assert.equal(L.decide(store, 'neuralspark', photo, 'family').consent, false, 'the host app isn’t allowed Family-private by default');
  const allowed = { ...store, access: { neuralspark: ['open', 'family'] } };
  const d = L.decide(allowed, 'neuralspark', photo, L.fileLevelOf(allowed, photo, (r) => index.get(r)?.props).level);
  assert.equal(d.ok, false);
  assert.equal(d.consent, true, 'allowed Family-private: still asked for each use');
  const bot = await w.callTool('memory_album_list', {}, gateFor(index, store, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No photo albums yet\.[\s\S]*at a level Chat bot isn’t allowed/);
  const spark = gateFor(index, allowed, 'neuralspark', 'the host app');
  const got = (await w.callTool('memory_album_get', { album: 'beach' }, spark)).text;
  assert.match(got, /beach-1\.jpg: Ari Moana, Tia Moana — The sandcastle/);
  assert.match(got, /Family-private: using one needs the person’s OK each time/);
  assert.match((await w.callTool('creative_project_add', { name: 'Grandma’s card', kind: 'Card', due: '2026-11-10', tone: 'Warm' }, spark)).text, /Started Grandma’s card with its brief/);
  assert.match(read('Family/Memories and Media/Creative projects/Grandma’s card.md'), /- Tone: Warm/);
});

// ── The Inbox files into these modules' records ──────────────────────────────────────────────────────────────────────

test('inbox: a show onto the watch list, a habit ticked, a note on a machine, a customer’s problem, a photo into its album', async () => {
  const { personalInbox } = await import(pathToFileURL(path.join(work, 'inbox-main.mjs')).href).catch(async () => {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'inbox-main.ts');
    writeFileSync(entry, `export { personalInbox } from ${JSON.stringify(path.join(root, 'src/main/personal-modules.ts'))};`);
    await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'inbox-main.mjs'), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, 'inbox-main.mjs')).href);
  });
  const files = { ...LISTS(), ...GOALS(), ...SYSTEMS(), ...BUSINESS(), ...MEMS() };
  const switches = { now: { lists: { on: true }, goals: { on: true }, systems: { on: true }, business: { on: true }, family: { on: true } } };
  const { w, read } = core(files, switches);
  const inbox = personalInbox(w);
  const line = (words) => ({ id: `line:${words}`, kind: 'line', path: 'Inbox.md', text: words, words, task: false, embeds: [], links: [] });
  const first = async (item) => (await inbox.suggestions(item))[0];
  const show = await first(line('watch Night Market'));
  assert.deepEqual([show.target.module, show.target.name, show.target.label], ['lists', 'Shows', 'Add to Shows']);
  assert.match((await inbox.file(line('watch Night Market'), show.target)).words, /Added Night Market to Shows/);
  assert.match(read('Me/Lists/Shows.md'), /\| Night Market \| To watch \|/);
  const egg = await first(line('Add eggs to the shopping list'));
  assert.equal(egg.target.name, 'Shopping');
  await inbox.file(line('Add eggs to the shopping list'), egg.target);
  assert.match(read('Me/Lists/Shopping.md'), /\| eggs \| Need \|/);
  const habit = await first(line('Did my read for 20 minutes on the bus'));
  assert.equal(habit.target.label, 'Tick Read for 20 minutes for today');
  await inbox.file(line('x'), habit.target);
  assert.match(read('Me/Goals and Habits/Habits/Read for 20 minutes.md'), /- 2026-10-24/);
  const box = await first(line('Media box fan is loud again'));
  assert.equal(box.target.label, 'Note on Media box’s health');
  await inbox.file(line('Media box fan is loud again'), box.target);
  assert.match(read('Home/Systems and Home Lab/Machines/Media box.md'), /\| 2026-10-24 \|  \| Media box fan is loud again \|/);
  const cafe = await first(line('Harbour Cafe can’t print receipts. Since Tuesday.'));
  assert.equal(cafe.target.label, 'A support item from Harbour Cafe');
  const filed = await inbox.file(line('Harbour Cafe can’t print receipts. Since Tuesday.'), cafe.target);
  assert.match(read(filed.paths[0]), /customer: "\[\[Harbour Cafe\]\]"[\s\S]*## What they said\n\nHarbour Cafe can’t print receipts\. Since Tuesday\./);
  const pic = { id: 'Inbox/IMG_2001.jpg', kind: 'file', path: 'Inbox/IMG_2001.jpg', text: '', words: 'IMG 2001', stamp: '24 Oct 2024 09:10', task: false, embeds: [], links: [] };
  const album = await first(pic);
  assert.deepEqual([album.target.name, album.why], ['Beach weekend', 'Taken during Beach weekend']);
  assert.equal((await inbox.file(pic, album.target)).keepWith, 'Family/Memories and Media/Albums/Beach weekend.md');
  assert.equal(await first(line('Call the dentist')), undefined, 'nothing named: nothing offered');
});

// ── Check now (26 Oct 2026): what a machine's SSH read says, turned into its fields and services ─────────────────────
test('Check now reads a server: system, uptime, disk, memory, updates and the services that are its own', () => {
  const out = ['@@os', 'Ubuntu 24.04.1 LTS', '@@kernel', '6.8.0-45-generic', '@@uptime', '1036800.51 4000000.2', '@@disk', '/dev/sda2 102626232 41000000 56000000 43% /', '@@memory', '7951 2150', '@@updates', '3', '@@security', '2',
    '@@services', 'cron.service', 'docker.service', 'nginx.service', 'smbd.service', 'ssh.service', 'systemd-journald.service', 'tailscaled.service', 'minecraft-bedrock.service', 'smartmontools.service', 'site-link.service',
    '@@containers', 'jellyfin|jellyfin/jellyfin:latest|0.0.0.0:8096->8096/tcp', 'gitea|gitea/gitea:1.22|0.0.0.0:3000->3000/tcp',
    '@@ports', '0.0.0.0:80|users:(("nginx",pid=812,fd=6))', '0.0.0.0:445|users:(("smbd",pid=900,fd=31))'].join('\n');
  const r = S.systems.readProbe(out);
  assert.equal(r.os, 'Ubuntu 24.04.1 LTS');
  assert.deepEqual([r.upDays, r.diskUsed, r.memory, r.updates, r.securityUpdates], [12, 43, { total: 7951, used: 2150 }, 3, 2]);
  assert.deepEqual(r.services.map((s) => [s.name, s.kind, s.port]), [['jellyfin', 'Media', '8096'], ['gitea', 'Web app', '3000'], ['nginx', 'Web app', '80'], ['smbd', 'Storage', '445'], ['tailscaled', 'VPN', ''], ['minecraft-bedrock', 'Game server', ''], ['site-link', 'Other', '']], 'the system’s own plumbing (cron, docker, ssh, systemd) is left out');
  assert.equal(S.systems.probeWords(r), 'Checked: Ubuntu 24.04.1 LTS, up 12 days, disk 43% used, memory 2.1 of 7.8 GB, 3 updates waiting, 2 security updates waiting; 7 services running.');
  assert.match(S.systems.PROBE, /@@services.*systemctl list-units/);
});
