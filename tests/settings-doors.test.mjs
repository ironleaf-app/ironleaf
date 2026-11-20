// node --test tests/settings-doors.test.mjs — every door into Ironleaf Settings lands on its own row (4 Nov 2026
// polish): the former host app's Settings › Ironleaf rows name a section id; the window resolves the id to its
// section AND its row (SETTINGS_REVEAL), opens the section and scrolls to and briefly highlights the row, the same
// way as a Settings search hit. The bare-section form keeps working for old callers and saved layouts.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-setdoors-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (p) => readFileSync(path.join(root, p), 'utf8');
// The former host app's 14 Ironleaf rows (ns VAULT_SECTIONS ids, pinned here so a door dropped on either side
// fails loudly).
const DOORS = ['general', 'modules', 'files', 'types', 'templates', 'capture', 'editor', 'daily', 'privacy', 'search', 'recovery', 'backup', 'keys', 'agents'];

test('one reveal map covers all 14 doors, each on its own section where the id already lands', () => {
  assert.deepEqual(Object.keys(S.SETTINGS_REVEAL).sort(), [...DOORS].sort(), 'door id -> section + row, all 14');
  const live = new Set(S.SETTINGS_GROUPS.map((g) => g.id));
  for (const id of DOORS) {
    const door = S.SETTINGS_REVEAL[id];
    assert.ok(live.has(door.section), `${id}: no live section ${door.section}`);
    assert.equal(door.section, S.resolveSection(id), `${id}: the map lands where the id already lands`);
    assert.ok(door.row && door.row.length >= 2, `${id}: names its row`);
  }
  assert.equal(new Set(DOORS.map((id) => S.SETTINGS_REVEAL[id].row)).size, 14, 'no two doors share a row');
});

test('every row the map names exists as a row or a heading in its own section', () => {
  const files = {
    general: ['src/renderer/src/components/Settings.tsx'],
    packs: ['src/renderer/src/components/Settings.tsx'],
    'quick-add': ['src/renderer/src/components/CaptureSettings.tsx'],
    home: ['src/renderer/src/components/Settings.tsx'],
    privacy: ['src/renderer/src/components/PrivacySettings.tsx'],
    backups: ['src/renderer/src/components/Settings.tsx', 'src/renderer/src/components/BackupSettings.tsx'],
    keys: ['src/renderer/src/components/Settings.tsx'],
    agents: ['src/renderer/src/components/AgentsSettings.tsx', 'src/renderer/src/components/ConnectAiSettings.tsx'],
  };
  const src = {};
  for (const [section, paths] of Object.entries(files)) src[section] = paths.map(read).join('\n');
  const h1 = (label) => new RegExp(`\\{ id: '[a-z-]+', label: '${label}', icon:`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const id of DOORS) {
    const { section, row } = S.SETTINGS_REVEAL[id];
    const body = src[section];
    const asRow = new RegExp(`<Row\\s+title="${esc(row)}"`).test(body);
    const asH3 = body.includes(`<h3>${row}</h3>`);
    const asH1 = section === 'packs' && row === 'Packs' && h1('Packs').test(body);
    assert.ok(asRow || asH3 || asH1, `${id}: "${row}" is a row or heading in ${section}`);
  }
  // Rows hiding inside General's closed Details open first: the reveal names what holds each one.
  const tsx = read('src/renderer/src/components/Settings.tsx');
  const details = tsx.slice(tsx.indexOf('const GENERAL_DETAILS'), tsx.indexOf('\n};', tsx.indexOf('const GENERAL_DETAILS')));
  for (const row of ['New tabs open in', 'Search inside project files']) assert.ok(details.includes(`'${row}'`), `"${row}" opens its Details on reveal`);
});

test('openSettingsAt takes a section AND a row; the bare section sends the bare id as before', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('openSettingsAt?(section: string, row?: string): Promise<void>'), 'the contract names the row');
  assert.ok(app.includes('openSettingsAt: async (section: string, row?: string) =>'), 'the main side takes it');
  assert.ok(app.includes("send('agents:show', named ? { section: shaped, row: named } : shaped)"), 'a named row rides along, a bare section sends the bare id');
});

test('the row rides agents:show to the window, which resolves the id when no row was named', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('agentsShow: (cb: (section?: string, row?: string) => void)'), 'the window hears section and row');
  assert.ok(preload.includes("if (typeof payload === 'string') return cb(payload, undefined)"), 'a bare id stays a bare section');
  const tsx = read('src/renderer/src/App.tsx');
  assert.ok(tsx.includes("import { SETTINGS_REVEAL } from './lib/settingsSearch'"), 'the window holds the map, not the host app');
  assert.ok(tsx.includes('api.on.agentsShow((section, row) =>'), 'section and row arrive together');
  assert.ok(tsx.includes('SETTINGS_REVEAL[section]'), 'the row resolves from the id alone');
  assert.ok(tsx.includes("openModal({ kind: 'settings', section: (section ?? 'agents') as never, row: row ?? door?.row })"), 'an explicitly named row wins over the map');
  assert.ok(tsx.includes('A.openSettings(section, \'current\', row)'), 'the page opens with its row');
});

test('a named row is asked once and taken once; without one the page lands on the top as before', () => {
  const modals = read('src/renderer/src/state/modals.ts');
  assert.ok(modals.includes("{ kind: 'settings'; section?: string; row?: string }"), 'the request carries the row');
  for (const fn of ['requestSettingsDoor', 'takeSettingsDoor', 'useSettingsDoor']) assert.ok(modals.includes(`export function ${fn}`), fn);
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes('export function openSettings(section?: string, where: W.Where = \'current\', row?: string)'), 'openSettings takes the row after its old arguments');
  assert.ok(actions.includes('if (row) requestSettingsDoor(row)'), 'only a named row asks; bare callers and saved tabs land on the top');
});

test('the page lands a door row the same way as a search hit, and waits out a loading section', () => {
  const tsx = read('src/renderer/src/components/Settings.tsx');
  assert.ok(tsx.includes('takeSettingsDoor') && tsx.includes('useSettingsDoor'), 'the page takes the asked row');
  assert.ok(tsx.includes('setFound({ title: req.row, command: false, n: req.at })'), 'a door row becomes the found setting, like a search hit');
  assert.ok(tsx.includes('setFound({ title: entry.title, command: !!entry.command, n: Date.now() })'), 'search still lands through the same found setting');
  assert.ok(tsx.includes('function showFound(body: HTMLElement | null, title: string, command: boolean): boolean'), 'landing reports whether it landed');
  assert.ok(tsx.includes("?? [...body.querySelectorAll<HTMLElement>('h1')].find((h) => h.textContent?.trim() === title)"), 'a landing with no row of its own falls back to the group title');
  assert.ok(tsx.includes('if (showFound(page.current, found.title, found.command)) return;'), 'a landed row stops; a missed one is tried again');
  assert.ok(tsx.includes('if (++tries > 24) return;') && tsx.includes('frame = requestAnimationFrame(tick)'), 'bounded retries across a loading section');
});
