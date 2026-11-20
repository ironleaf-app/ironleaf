// node --test tests/packs-uplift.test.mjs — the v10-vault-packs uplift (the 5 Nov 2026 packs audit's 15 ranked
// build items): Today cards that never cut words, fills lines that say what needs the bot, the one column at every
// window (item 3, reconciled with p25), Systems' maintenance tone, Memories merged into Family, Goals counts and Reached buttons,
// Trips' booked-vs-paid words, the House starter card, Papers listing documents, Meetings in the pack shell,
// the Lists Today title, Cars' overdue pills, Health's export and linked ticks, the dead rail file gone, and
// the small words. Static checks plus one live pass over a rich made-up vault. Made-up notes only.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-uplift-'));
after(() => rmSync(work, { recursive: true, force: true }));

let L;
let S;
let MM;
let MT;
let HH;
let GG;
let HB;
let VV;
let WS;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'life-modules.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'life-modules.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'life-modules.mjs')).href);
  const sysEntry = path.join(work, 'systems.ts');
  writeFileSync(sysEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/systems.ts'))};\n`);
  await build({ input: sysEntry, platform: 'node', output: { file: path.join(work, 'systems.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'systems.mjs')).href);
  const memEntry = path.join(work, 'memories.ts');
  writeFileSync(memEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/memories.ts'))};\n`);
  await build({ input: memEntry, platform: 'node', output: { file: path.join(work, 'memories.mjs'), format: 'esm' }, logLevel: 'silent' });
  MM = await import(pathToFileURL(path.join(work, 'memories.mjs')).href);
  const tabsEntry = path.join(work, 'tabs.ts');
  writeFileSync(tabsEntry, `export * as M from ${JSON.stringify(path.join(root, 'src/renderer/src/state/module-tabs.ts'))};\n`);
  await build({ input: tabsEntry, platform: 'node', output: { file: path.join(work, 'tabs.mjs'), format: 'esm' }, logLevel: 'silent' });
  MT = (await import(pathToFileURL(path.join(work, 'tabs.mjs')).href)).M;
  const houseEntry = path.join(work, 'house.ts');
  writeFileSync(houseEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/house.ts'))};\n`);
  await build({ input: houseEntry, platform: 'node', output: { file: path.join(work, 'house.mjs'), format: 'esm' }, logLevel: 'silent' });
  HH = await import(pathToFileURL(path.join(work, 'house.mjs')).href);
  const goalsEntry = path.join(work, 'goals.ts');
  writeFileSync(goalsEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/goals.ts'))};\n`);
  await build({ input: goalsEntry, platform: 'node', output: { file: path.join(work, 'goals.mjs'), format: 'esm' }, logLevel: 'silent' });
  GG = await import(pathToFileURL(path.join(work, 'goals.mjs')).href);
  const healthEntry = path.join(work, 'health.ts');
  writeFileSync(healthEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/health.ts'))};\n`);
  await build({ input: healthEntry, platform: 'node', output: { file: path.join(work, 'health.mjs'), format: 'esm' }, logLevel: 'silent' });
  HB = await import(pathToFileURL(path.join(work, 'health.mjs')).href);
  const vendorsEntry = path.join(work, 'vendors.ts');
  writeFileSync(vendorsEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/work-vendors.ts'))};\n`);
  await build({ input: vendorsEntry, platform: 'node', output: { file: path.join(work, 'vendors.mjs'), format: 'esm' }, logLevel: 'silent' });
  VV = await import(pathToFileURL(path.join(work, 'vendors.mjs')).href);
  const sitesEntry = path.join(work, 'sites.ts');
  writeFileSync(sitesEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/work-sites.ts'))};\n`);
  await build({ input: sitesEntry, platform: 'node', output: { file: path.join(work, 'sites.mjs'), format: 'esm' }, logLevel: 'silent' });
  WS = await import(pathToFileURL(path.join(work, 'sites.mjs')).href);
});

// ── Item 1: Today cards never cut words ──────────────────────────────────────────────────────────────────────────

test('item 1: every Today pack card wraps whole words, never one clipped line', () => {
  const css = read('src/renderer/src/styles/today.css');
  // The rule's last block for Today names wraps whole words (t207 pass 2: the two-line clamp drew dots).
  const at = css.lastIndexOf('.rm-today-name');
  assert.ok(at > 0, 'today.css carries the Today-cards rule');
  const block = css.slice(at, css.indexOf('}', at) + 1);
  for (const sel of ['.rm-today-sub', '.wmt-row-name', '.wmt-row-sub']) assert.ok(css.slice(Math.max(0, at - 400), at).includes(sel) || block.includes(sel), `${sel} wraps with the rest`);
  assert.doesNotMatch(block, /line-clamp/, 'no clamp, so no dots');
  assert.match(block, /white-space:\s*normal/, 'names and details wrap');
  assert.match(block, /overflow-wrap:\s*normal/, 'at word edges, never mid-word (the uplift’s own rule)');
  assert.doesNotMatch(block, /white-space:\s*nowrap/, 'no single-line lock');
  assert.ok(css.slice(Math.max(0, at - 60), at + 30).includes('.rm-today-main .rm-today-name'), 'scoped to beat the one-line rules whatever order loads');
  assert.doesNotMatch(block, /word-break:\s*break-(all|word)/, 'no mid-word breaks');
});

// ── Item 2: say how each pack fills ─────────────────────────────────────────────────────────────────────────────────

test('item 2: every fills line says what is automatic and what the chat reads', () => {
  const byId = Object.fromEntries(L.LIFE_MODULES.map((m) => [m.id, m.fills]));
  // Add from a file always ends with the chat assistant reading: every fills line that offers it says so.
  for (const m of L.LIFE_MODULES) {
    if (!m.fills.includes('Add from a file')) continue;
    assert.match(m.fills, /chat assistant/, `${m.name}: Add from a file names the chat assistant`);
  }
  // No pack promises a path through a bot Ironleaf doesn't have.
  for (const m of L.LIFE_MODULES) assert.doesNotMatch(m.fills, /\bbot\b|Telegram/i, `${m.name}: no bot path`);
  assert.match(byId.family, /as you add/, 'family says what fills as you add');
});

test('item 2: the new overviews show the fills line when the pack is empty', () => {
  assert.match(read('src/renderer/src/views/modules/w3b/W3b.tsx'), /export function FillsLine/, 'one shared fills line');
  for (const [file, id] of [['Family87', 'family'], ['House87', 'house'], ['Vehicles87', 'vehicles'], ['Travel87', 'travel'], ['Goals87', 'goals'], ['Lists87', 'lists'], ['Health87', 'health'], ['Weekly87', 'weekly']]) {
    const src = read(`src/renderer/src/views/modules/w3b/${file}.tsx`);
    assert.ok(src.includes('<FillsLine') && src.includes(`id="${id}"`), `${file} shows the fills line when empty`);
  }
});

// ── Item 3: one column at every window (reconciled with p25) ─────────────────────────────────────────────────────────
// Item 3 widened pack overviews to 2000px past 1600px viewports with two-across sections; p25 one column (the same day)
// keeps every room's column, title and body edges put at a real window, so the widening went. One column everywhere
// wins; a pack section stays one element (Business keeps its Customers-beside-Support pair inside the column through
// its own p87-cols).

test('item 3: pack overviews keep the one column past 1600px, never widening', () => {
  const css = read('src/renderer/src/styles/packs-87.css');
  assert.ok(!css.includes('@media (min-width: 1600px)'), 'no wide-window widening rule');
  assert.ok(!/max-width:\s*min\(2000px/.test(css), 'the column never grows past the frame');
  assert.match(read('src/renderer/src/views/modules/pack87.tsx'), /<section className="p87-sec">/, 'a pack section is one element so the pair stays together');
});

// ── Item 4: maintenance is not down ─────────────────────────────────────────────────────────────────────────────────

const SYS_NOTES = () => {
  const machine = (name, status, note) => ({ path: `Home/Systems and Home Lab/Machines/${name}.md`, title: name, type: 'machine', props: { kind: 'NAS', address: '192.168.1.20', status }, content: `---\ntype: machine\nstatus: ${status}\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-11-04 | ${status} | ${note} |\n` });
  return [machine('Garage NAS', 'Up', '41% full'), machine('Media box', 'Down', 'No reply'), machine('Workshop PC', 'Maintenance', 'Rebuilding the index')];
};

test('item 4: a machine in maintenance is amber and out of the down count, never red Down', () => {
  const m = S.systemsModel(SYS_NOTES(), '2026-11-05', {});
  assert.deepEqual(m.trouble.map((t) => t.name), ['Media box'], 'only the down machine is trouble');
  const ws = m.machines.find((x) => x.name === 'Workshop PC');
  assert.equal(S.machineTone(m, ws), 'warn', 'maintenance tones amber');
  assert.ok(!S.alertsOf(m).some((a) => /is maintenance/i.test(a.title)), 'no failure alert for a choice');
  const page = read('src/renderer/src/views/modules/life/SystemsPage.tsx');
  assert.match(page, /In maintenance/, 'the tag says In maintenance');
  assert.doesNotMatch(page, /ownDown = \/\^\(down\|maintenance\)/i, 'a maintenance machine is not its own outage');
});

// ── Item 5: Memories counted, shown, and merged into Family ─────────────────────────────────────────────────────────

test('item 5: an album counts its Photos-table rows as well as the files beside it', () => {
  const table = '## Photos\n\n| File | Who | Caption | Date |\n| --- | --- | --- | --- |\n| tree-morning.png | Mia Morgan | Tree at dawn | 2024-12-25 |\n| lunch-table.png |  | The long lunch | 2024-12-25 |\n';
  const note = { path: 'Family/Memories and Media/Albums/Christmas 2024.md', title: 'Christmas 2024', props: { kind: 'Event', date: '2024-12-25' }, content: table, files: [] };
  const a = MM.readAlbum(note);
  assert.equal(a.photos.length, 2, 'table rows count with no files beside');
  assert.deepEqual(a.photos.find((p) => p.name === 'tree-morning.png').who, ['Mia Morgan'], 'who comes from the row');
  // A row for a file beside the note is the same photo, not a second one.
  const mixed = MM.readAlbum({ ...note, files: ['Family/Memories and Media/Albums/Files/Christmas 2024/tree-morning.png'] });
  assert.equal(mixed.photos.length, 2, 'no double count');
  assert.ok(mixed.photos.some((p) => p.rel.endsWith('tree-morning.png') && p.row >= 0), 'the file keeps its row');
});

test('item 5: Memories is one home with Family: no pack, old links land, settings migrate', () => {
  assert.ok(!L.LIFE_MODULES.some((m) => m.id === 'memories'), 'no Memories pack in the catalogue');
  const fam = L.LIFE_MODULES.find((m) => m.id === 'family');
  for (const p of ['people', 'creative', 'onthisday']) assert.ok(fam.parts.some((x) => x.id === p), `family has the ${p} part`);
  assert.ok((fam.aliases ?? []).some((a) => /memories and media/i.test(a)), 'Memories and Media still finds Family');
  assert.equal(L.resolveModule('memories'), 'family', 'the old id resolves');
  assert.equal(L.moduleInfo('memories').id, 'family', 'old links read as Family');
  assert.equal(L.moduleOn({ family: { on: true } }, 'memories'), true, 'on when Family is on');
  assert.equal(L.moduleOn({ family: { on: false } }, 'memories'), false, 'off when Family is off');
  // A vault that had Memories on keeps its albums page, with its parts' switches carried across.
  assert.deepEqual(L.cleanModules({ memories: { on: true, off: ['creative'] } }, {}), { family: { on: true, off: ['creative'] } });
  const merged = L.cleanModules({ memories: { on: true, off: ['people'] }, family: { on: false, off: ['rewards'] } }, {});
  assert.equal(merged.family.on, true, 'Memories on switches Family on');
  assert.deepEqual([...merged.family.off].sort(), ['people', 'rewards'], 'both parts lists join');
  assert.ok(!('memories' in merged), 'the old switch is gone once migrated');
  // Old tabs land on the same content under Family.
  assert.equal(MT.moduleOfTab({ type: 'module', path: 'module:memories#album:X' }), 'family');
  assert.equal(MT.moduleOfTab({ type: 'module', path: 'module:memories' }), 'family');
  assert.equal(MT.partOfTab({ path: 'module:memories#album:X' }), 'album:X', 'the part rides along');
});

test('item 5: Family hosts every album screen, and nothing still opens a Memories pack', () => {
  const router = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  for (const p of ["startsWith('album:')", "startsWith('person:')", "startsWith('creative:')", "part === 'albums'", "part === 'people'", "part === 'creative'"]) assert.ok(router.includes(p), `family routes ${p}`);
  const page = read('src/renderer/src/views/modules/FamilyPage.tsx');
  assert.ok(page.includes('<AlbumDetail path=') && page.includes('<PersonDetail name=') && page.includes('<CreativeDetail path='), 'details render under Family');
  assert.ok(page.includes('<PeoplePart />') && page.includes('<CreativePart'), 'the previous layout holds by-person and creative');
  const today = read('src/renderer/src/views/modules/FamilyToday.tsx');
  assert.ok(today.includes('onThisDay') && today.includes('dueSoon'), 'Today’s Family card carries on-this-day and due projects');
  assert.ok(!read('src/renderer/src/views/modules/life/registry.ts').includes('memories:'), 'no Memories page or Today card registered');
  assert.ok(!read('src/renderer/src/views/modules/life/MemoriesPage.tsx').includes('export function MemoriesPage'), 'no Memories router left');
  assert.ok(router.includes('Family’s albums') && page.includes('Family’s albums'), 'the album move reads as Family’s albums');
  assert.ok(!read('src/main/modules.ts').includes('into Memories and Media'), 'the move lands in Family’s albums');
});

// ── Item 6: the Goals count agrees with its list, and Reached names the milestone ────────────────────────────────

test('item 6: the home card counts what it lists, and every Reached button names its milestone', () => {
  const over = read('src/renderer/src/views/modules/w3b/Goals87.tsx');
  assert.match(over, /and \$\{left\.length - 3\} more/, 'the card says how many more past three');
  assert.ok(!over.includes('>Reached</button>'), 'no bare Reached on the overview');
  assert.ok((over.match(/Reached: \{/g) || []).length >= 2, 'both overview buttons name the milestone');
  const classic = read('src/renderer/src/views/modules/life/GoalsPage.tsx');
  assert.ok(!classic.includes('>Reached</button>'), 'no bare Reached on the previous layout');
  assert.ok((classic.match(/Reached: \{/g) || []).length >= 2, 'both previous-layout buttons name the milestone');
});

// ── Item 7: booked is not paid ──────────────────────────────────────────────────────────────────────────────────────

test('item 7: an unpaid booking with a ref reads to pay, never booked', () => {
  const src = read('src/renderer/src/views/modules/w3b/Travel87.tsx');
  assert.ok(src.includes("'To pay'") || src.includes('"To pay"') || src.includes('`To pay`') || src.includes(' to pay'), 'unpaid-with-ref reads to pay');
  assert.match(src, /const done = b\.paid/, 'the tick marks paid, not booked');
  assert.match(src, /everything paid/, 'a settled trip says everything paid');
  assert.ok(!src.includes("'everything booked'") && !src.includes('"everything booked"'), 'nothing settled reads booked');
});

// ── Item 8: the House starter card plans first ──────────────────────────────────────────────────────────────────────

test('item 8: the starter offers the current season’s missing jobs, and hides when all are there', () => {
  assert.equal(HH.currentSeasonalPack('2026-11-05').id, 'before-summer', 'November offers Before summer');
  assert.equal(HH.currentSeasonalPack('2026-03-15').id, 'autumn', 'March offers Autumn');
  assert.equal(HH.currentSeasonalPack('2026-01-10').id, 'before-summer', 'January wraps to Before summer');
  const plan = HH.planSeasonalPack('before-summer', '2026-11-05', ['Check the smoke alarms']);
  assert.ok(plan.jobs.every((j) => j.name !== 'Check the smoke alarms'), 'jobs already there are not offered');
  assert.ok(plan.jobs.length > 0 && plan.jobs.length < 3, 'only the missing jobs are listed');
  const src = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.ok(src.includes('currentSeasonalPack') && src.includes('planSeasonalPack'), 'the card plans first');
  assert.match(src, /plan\.jobs\.length/, 'the card hides when every job is there');
});

// ── Item 9: Papers lists the documents; Certificate out of Licences ─────────────────────────────────────────────────

test('item 9: the Papers overview names every document, and Certificates sit apart from Licences', () => {
  const src = read('src/renderer/src/views/modules/RecordModulePage.tsx');
  assert.ok(src.includes("m.documents.length") && src.includes('document'), 'the hero counts the documents');
  const group = src.slice(src.indexOf('function kindGroup('), src.indexOf('function DocRow('));
  assert.ok(!group.includes("'Certificate'") || group.includes('Certificates'), 'a Certificate does not group under Licences');
  assert.ok(group.includes('Certificates'), 'Certificates have their own group');
  const section = src.slice(src.indexOf('Every document by kind'));
  assert.ok(!section.includes('compressNames(list.map((d) => d.kind))'), 'groups are not compressed to kind names');
  assert.ok(section.includes('<DocRow'), 'every document is listed');
});

// ── Item 10: Meetings into the pack shell ─────────────────────────────────────────────────────────────────────────────

test('item 10: the Meetings home has the pack shell, and keeps its list/calendar switch', () => {
  const src = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  const page = src.slice(src.indexOf('export function MeetingsPage'));
  assert.ok(page.includes('<PackShell'), 'the list home is in the pack shell');
  assert.ok(page.includes('Notes, decisions and actions for every meeting'), 'the lead line reads like the catalogue');
  assert.ok(!page.includes('<PageHead'), 'no bare page header remains');
  assert.ok(page.includes('List or calendar'), 'the list/calendar switch stays');
  assert.ok(page.includes('New meeting'), 'New meeting stays on the header');
});

// ── Item 11: the Lists Today card is titled Lists ────────────────────────────────────────────────────────────────────

test('item 11: the Lists Today card reads Lists even with shopping open', () => {
  const src = read('src/renderer/src/views/modules/life/ListsPage.tsx');
  const today = src.slice(src.indexOf('export function ListsToday'));
  assert.ok(!today.includes("'Shopping' : 'Lists'") && !today.includes('? \'Shopping\''), 'no Shopping title when shopping is open');
  assert.match(today, /<h2 id="td-h-lists">\s*Lists/, 'the card is titled Lists');
});

// ── Item 12: overdue pills keep the year ──────────────────────────────────────────────────────────────────────────────

test('item 12: a same-year due day that is already past keeps its year', () => {
  const src = read('src/renderer/src/views/modules/w3b/Vehicles87.tsx');
  const def = src.slice(src.indexOf('const dmy ='), src.indexOf('function Reminders'));
  assert.ok(def.includes('iso < today'), 'past days keep the year; only this year still to come drops it');
  assert.ok(!src.includes('m.today.slice(0, 4)'), 'the short day works from the full day');
});

// ── Item 13: Health export, linked ticks, training words ─────────────────────────────────────────────────────────────

test('item 13: my health data exports as one CSV table, from every door', () => {
  const db = HB.emptyDb();
  db.measures.push({ id: 'm1', name: 'Weight', kind: 'number', group: 'body', unit: 'kg', created: 1 });
  db.entries.push({ id: 'e1', day: '2026-11-04', measure: 'm1', n: 82.4, at: 1 });
  db.notes.push({ id: 'n1', day: '2026-11-03', text: 'Walked, sore knee', at: 1 });
  db.sessions.push({ id: 's1', day: '2026-11-02', title: 'Upper body', kind: 'strength', minutes: 40, exercises: [{ name: 'Press', sets: [{ reps: 8, weight: 40 }] }], at: 1 });
  db.meals.push({ id: 'f1', day: '2026-11-04', meal: 'lunch', what: 'Chicken, rice', kcal: 520, at: 1 });
  db.appointments.push({ id: 'a1', day: '2026-11-06', who: 'Physio', status: 'booked', results: [], at: 1 });
  const csv = HB.exportCsv(db);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'day,type,name,value,detail', 'one uniform table');
  assert.ok(lines.length === 6, 'every record exports');
  assert.ok(csv.includes('Weight') && csv.includes('82.4'), 'an entry with its measure’s name');
  assert.ok(csv.includes('"Lunch: Chicken, rice"'), 'commas are quoted');
  assert.ok(csv.indexOf('2026-11-02') < csv.indexOf('2026-11-06'), 'oldest first');
  assert.ok(read('src/shared/modules-api.ts').includes('health:export-csv'), 'the bridge carries it');
  assert.ok(read('src/main/modules.ts').includes('health:export-csv'), 'the main side answers');
  for (const door of ['src/renderer/src/views/modules/w3b/Health87.tsx', 'src/renderer/src/views/modules/HealthPage.tsx', 'src/renderer/src/views/modules/health/HealthMore.tsx'])
    assert.ok(read(door).includes('Export my data (CSV)'), `offered from ${door.split('/').pop()}`);
});

test('item 13: a habit linked to a goal feeds its progress with this week’s ticks', () => {
  const goal = (name, extra = '') => ({ path: `Me/Goals and Habits/Goals/${name}.md`, title: name, props: { type: 'goal', status: 'Started' }, content: `---\ntype: goal\nstatus: Started\n---\n${extra}\n## Milestones\n\n## Notes\n\n`, type: 'goal' });
  const habit = (name, goalName, log) => ({ path: `Me/Goals and Habits/Habits/${name}.md`, title: name, props: { type: 'habit', goal: goalName ? `[[${goalName}]]` : '', days_a_week: '3', status: 'Active' }, content: `---\ntype: habit\ngoal: ${goalName ? `[[${goalName}]]` : ''}\ndays_a_week: 3\nstatus: Active\n---\n## Log\n\n${log}\n\n## Notes\n\n`, type: 'habit' });
  const m = GG.goalsModel([
    goal('Run often'),
    goal('Save money'),
    habit('Morning run', 'Run often', '- 2026-11-02\n- 2026-11-04'),
    habit('Read', '', '- 2026-11-02\n- 2026-11-03\n- 2026-11-04'),
  ], '2026-11-05');
  const fed = m.goals.find((g) => g.name === 'Run often');
  assert.equal(fed.progressFrom, 'habits', 'ticks feed a goal with no target or milestones');
  assert.ok(Math.abs(fed.progress - 2 / 3) < 0.001, 'two of three ticks this week');
  const lone = m.goals.find((g) => g.name === 'Save money');
  assert.equal(lone.progress, null, 'a goal with no linked habits still has no progress');
  const ui = read('src/renderer/src/views/modules/life/GoalsPage.tsx');
  assert.ok(ui.includes("progressFrom === 'habits'"), 'the goal page says where its progress comes from');
});

test('item 13: with no training at all there is nothing “to do” yet', () => {
  const src = read('src/renderer/src/views/modules/w3b/Health87.tsx');
  const stat = src.slice(src.indexOf('Training this week') - 400, src.indexOf('Training this week'));
  assert.ok(stat.includes('db.sessions.length'), 'the to-do counts only once training exists');
  const today = read('src/renderer/src/views/modules/HealthToday.tsx');
  assert.ok(today.includes('week.target && db.sessions.length'), 'Today’s card stays quiet too until training exists');
});

// ── Item 14: the dead rail file is gone ──────────────────────────────────────────────────────────────────────────────

test('item 14: ModulesPlaces.tsx is deleted, and the rail never looked back', () => {
  assert.ok(!existsSync(path.join(root, 'src/renderer/src/panels/ModulesPlaces.tsx')), 'the dead file is gone');
  assert.ok(!read('src/renderer/src/panels/Places.tsx').includes('ModulesPlaces'), 'the fold in Places is the only truth');
});

// ── Item 15: small words ─────────────────────────────────────────────────────────────────────────────────────────────

test('item 15: planned releases qualify their changes, one renews line, patch Due in new notes', () => {
  const biz = read('src/renderer/src/views/modules/life/BusinessPage.tsx');
  const row = biz.slice(biz.indexOf('function ReleaseRow'), biz.indexOf('function ReleaseRow') + 1500);
  assert.ok(row.includes('planned:'), 'an unshipped release’s changes read as planned');
  const m = VV.vendorsModel([{ path: 'Work/Vendors and Contracts/Contracts/Telco.md', title: 'Telco', props: { type: 'contract', vendor: '[[Bluegum Telco]]', amount: '1800', period: 'Yearly', starts: '2025-11-15', ends: '2026-11-15', notice_days: '30', renewal: 'Auto-renews', status: 'Active' }, content: '', type: 'contract' }], '2026-11-05');
  const a = m.attention.find((x) => x.kind === 'contract');
  assert.ok(a.words.includes('renews on') && a.words.includes('too late to give notice'), 'one plain renews line');
  assert.ok(!a.words.includes('renews by itself'), 'no more “renews by itself” beside “notice has passed”');
  const page = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.ok(!page.includes('it renews by itself on'), 'the contract page says the same plain line');
  assert.ok(WS.PATCH_HEAD.includes('Due') && !WS.PATCH_HEAD.includes('Date'), 'new patch tables head their day Due');
  assert.ok(WS.newSiteText({}).includes('| Due |'), 'a new site note says Due');
  assert.ok(WS.PATCH_COLS.date.test('Due') && WS.PATCH_COLS.date.test('Date'), 'old Date tables still read');
});
