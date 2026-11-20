// node --test tests/abilities-88.test.mjs — What the Vault can do (8.8, src/shared/abilities.ts): the one registry of
// every ability, grouped, each in one plain line with a "Show me" target that exists; the guard that fails if a page
// or command is added without a registry entry or an explicit "not a feature" mark; search by plain words; the JSON
// export the website reads; and every entry point (More, the palette, Settings › General's About, Home). Fails
// without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-abilities-'));
let A; // src/shared/abilities.ts
let LM; // src/shared/life-modules.ts
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src', 'shared', 'abilities.ts'))};\nexport * as LM from ${JSON.stringify(path.join(root, 'src', 'shared', 'life-modules.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
  A = all;
  LM = all.LM;
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Every command id the app has: the palette's COMMANDS (state/commands.ts), the capture flows' (state/captureFlows.ts)
// and the generated ones (heading-1..6, capture-flow-1..5). */
function commandIds() {
  const src = read('src/renderer/src/state/commands.ts');
  const array = src.slice(src.indexOf('export const COMMANDS'), src.indexOf('let lastSearch'));
  const ids = new Set([...array.matchAll(/\bid: '([^']+)'/g)].map((m) => m[1]));
  assert.ok(src.includes('`heading-${n}`'), 'headings are still generated 1..6');
  for (let n = 1; n <= 6; n++) ids.add(`heading-${n}`);
  const flows = read('src/renderer/src/state/captureFlows.ts');
  for (const m of flows.matchAll(/\bid: '([^']+)'/g)) ids.add(m[1]);
  const max = Number(read('src/shared/capture-flows.ts').match(/MAX_FLOWS = (\d+)/)?.[1] ?? 0);
  assert.ok(max > 0, 'MAX_FLOWS read');
  for (let n = 1; n <= max; n++) ids.add(`capture-flow-${n}`);
  ids.delete('id');
  return ids;
}

/** Every page the app has: the ViewType union (state/workspace.ts). */
function viewTypes() {
  const line = read('src/renderer/src/state/workspace.ts').match(/export type ViewType = ([^;]+);/)?.[1] ?? '';
  const types = new Set([...line.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(types.size > 20, 'the union parsed');
  return types;
}

test('the ten groups, in the brief’s words', () => {
  assert.deepEqual(A.ABILITY_GROUPS.map((g) => g.id), ['write', 'organise', 'views', 'projects', 'meetings', 'packs', 'find', 'capture', 'private', 'spark']);
  const titles = Object.fromEntries(A.ABILITY_GROUPS.map((g) => [g.id, g.title]));
  assert.equal(titles.views, 'Views and databases');
  assert.equal(titles.projects, 'Projects and tasks');
  assert.equal(titles.find, 'Find and ask');
  assert.equal(titles.capture, 'Capture and import');
  assert.equal(titles.private, 'Private and safe');
  assert.equal(titles.spark, 'AI and other apps');
});

test('every ability: one line, plain words, a target', () => {
  const ids = new Set();
  const groups = new Set(A.ABILITY_GROUPS.map((g) => g.id));
  for (const a of A.ABILITIES) {
    assert.ok(a.id && !ids.has(a.id), `unique id: ${a.id}`);
    ids.add(a.id);
    assert.ok(groups.has(a.group), `${a.id} has a real group`);
    assert.ok(a.title && !a.title.includes('\n'), `${a.id} has a one-line title`);
    assert.ok(a.words && !a.words.includes('\n'), `${a.id} has its one plain line`);
    assert.ok(!a.title.includes('—') && !a.words.includes('—'), `${a.id}: no em dashes in new UI words`);
    assert.ok(!/deepseek|\bDSH\b|pi-ai/i.test(`${a.title} ${a.words}`), `${a.id}: no engine names`);
    assert.ok(a.target && ['command', 'page', 'pack'].includes(a.target.kind), `${a.id} has a target`);
  }
  for (const g of groups) assert.ok(A.abilitiesByGroup(g).length > 0, `${g} is not empty`);
});

test('the Packs group lists the seventeen packs, by their own names', () => {
  // Seventeen since the packs uplift item 5 (5 Nov 2026): Memories merged into Family, so the catalogue and the
  // group list one fewer pack, each still by its own name.
  assert.equal(LM.LIFE_MODULES.length, 17);
  const packs = A.abilitiesByGroup('packs');
  assert.equal(packs.length, 17);
  for (const m of LM.LIFE_MODULES) {
    const found = packs.find((p) => p.id === `pack-${m.id}`);
    assert.ok(found, `the ${m.name} pack is listed`);
    assert.equal(found.title, m.name);
    assert.deepEqual(found.target, { kind: 'pack', pack: m.id, part: undefined });
  }
});

test('every “Show me” target exists', () => {
  const commands = commandIds();
  const pages = viewTypes();
  const sections = new Set([...read('src/renderer/src/components/Settings.tsx').matchAll(/\{\s*id: '([^']+)', label:/g)].map((m) => m[1]));
  assert.ok(sections.has('packs') && sections.has('backups'), 'Settings sections parsed');
  const packs = new Map(LM.LIFE_MODULES.map((m) => [m.id, m.parts.map((p) => p.id)]));
  for (const a of A.ABILITIES) {
    const t = a.target;
    if (t.kind === 'command') assert.ok(commands.has(t.command), `${a.id}: command ${t.command} exists`);
    else if (t.kind === 'page') {
      assert.ok(pages.has(t.page), `${a.id}: page ${t.page} exists`);
      if (t.path) assert.ok(sections.has(t.path), `${a.id}: Settings section ${t.path} exists`);
    } else {
      assert.ok(packs.has(t.pack), `${a.id}: pack ${t.pack} exists`);
      if (t.part) assert.ok(packs.get(t.pack).includes(t.part), `${a.id}: part ${t.pack}/${t.part} exists`);
    }
  }
});

test('guard: every command is an ability or marked “not a feature”, and no mark is stale', () => {
  const commands = commandIds();
  const covered = new Set(A.ABILITIES.filter((a) => a.target.kind === 'command').map((a) => a.target.command));
  const marked = new Set(A.NON_FEATURE_COMMANDS);
  const missing = [...commands].filter((id) => !covered.has(id) && !marked.has(id));
  assert.deepEqual(missing, [], `commands with neither an entry nor a mark: ${missing.join(', ')}`);
  const stale = [...marked].filter((id) => !commands.has(id));
  assert.deepEqual(stale, [], `marks for commands that are gone: ${stale.join(', ')}`);
});

test('guard: every page is an ability or marked “not a feature”, and no mark is stale', () => {
  const pages = viewTypes();
  const covered = new Set(A.ABILITIES.filter((a) => a.target.kind === 'page').map((a) => a.target.page));
  const marked = new Set(A.NON_FEATURE_PAGES);
  const missing = [...pages].filter((id) => !covered.has(id) && !marked.has(id));
  assert.deepEqual(missing, [], `pages with neither an entry nor a mark: ${missing.join(', ')}`);
  const stale = [...marked].filter((id) => !pages.has(id));
  assert.deepEqual(stale, [], `marks for pages that are gone: ${stale.join(', ')}`);
});

test('search finds abilities by plain words', () => {
  const ids = (q) => A.searchAbilities(q).map((a) => a.id);
  assert.ok(ids('spreadsheet').includes('import-csv'), 'spreadsheet finds the CSV import');
  assert.ok(ids('latex').includes('maths'), 'latex finds the maths blocks');
  assert.ok(ids('notion').includes('import-apps'), 'notion finds the app imports');
  assert.ok(ids('mermaid').includes('diagrams'), 'mermaid finds diagrams');
  assert.ok(ids('board').includes('boards-view'), 'board finds board views');
  assert.ok(ids('secret').some((id) => ['secrets-page', 'secrets-scan'].includes(id)), 'secret finds the secrets');
  assert.ok(ids('weekly review').includes('week-review'), 'weekly review finds the review');
  assert.ok(ids('SPREADSHEET').includes('import-csv'), 'case does not matter');
  assert.equal(ids('').length, A.ABILITIES.length, 'empty finds everything');
  assert.deepEqual(ids('xyzzy-no-such-thing'), [], 'nonsense finds nothing');
});

test('the JSON export matches the registry', () => {
  const file = JSON.parse(read('docs/abilities.json'));
  assert.deepEqual(file, A.abilitiesJson(), 'docs/abilities.json is what export-abilities.mjs writes (run it again)');
});

test('the page opens from More, the palette, Settings About and Home', () => {
  // Back in More's quiet second group (9 Nov 2026): Ctrl+K, Settings and Home stay doors too.
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes("label: 'What Ironleaf can do'"), 'More lists it again');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("{ id: 'abilities', name: 'See what Ironleaf can do'"), 'the palette runs it');
  assert.ok(commands.includes("{ id: 'starter-template', name: 'Start from a template…'"), 'the palette starts templates');
  assert.ok(commands.includes("{ id: 'open-views-folder', name: 'Open the Views folder'"), 'the palette opens the Views folder');
  assert.ok(commands.includes("{ id: 'insert-mermaid', name: 'Mermaid diagram'"), 'the palette inserts diagrams');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('title="What Ironleaf can do"'), 'Settings General About links it');
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('See what Ironleaf can do') && home.includes('Start from a template'), 'Home’s first run points at both');
  assert.ok(home.includes('openStarterPicker()'), 'Home opens the starter picker');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes("tab.type === 'abilities'") && ws.includes('<AbilitiesPage'), 'the frame routes the page');
  // Tab names live in one place since 9 Nov 2026 (tabSync placeName).
  assert.ok(read('src/renderer/src/state/tabSync.ts').includes("case 'abilities': return 'What Ironleaf can do'"), 'the tab is named');
  const run = read('src/renderer/src/state/abilities.ts');
  assert.ok(run.includes("target.page === 'settings'") && run.includes('openModule(') && run.includes('runCommand('), 'Show me runs every kind of target');
  const projects = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(projects.includes("label: 'Start from a template…'"), 'Projects offers starters');
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes("label: 'Start from a template…'"), 'Notes offers starters');
});
