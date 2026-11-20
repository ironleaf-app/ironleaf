// node --test tests/connector-rows.test.mjs — 8.9 connector rows (round 2, 31 Oct 2026, the reviewer: "the
// other-AI-apps row never showed" after opening Settings › Agents through the palette; round 3: "One place, not two",
// the command for the former host app customers, "no plugin shows"): Settings › Agents shows one Other AI apps
// section (the on/off switch, what they may do, and the set-up for the four apps, with no former host app needed,
// plus the keyed list inside it), Settings › Plugins shows the Word count example the first time it opens, and
// tools/shots-connector.mjs waits on boolean page state (a bare DOM node never arrives through returnByValue) and
// prints what is on screen when a wait fails. Made-up values.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-connrows-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
}, { timeout: 120000 });
after(() => rmSync(work, { recursive: true, force: true }));

test('Settings shows AgentsSettings for Agents and the plugins list for Plugins', () => {
  const src = read('src/renderer/src/components/Settings.tsx');
  assert.ok(src.includes("{ id: 'agents', label: 'Connect an AI'"), 'the rail has Connect an AI');
  assert.ok(src.includes("{ id: 'plugins', label: 'Plugins'"), 'the rail has Plugins');
  assert.ok(src.includes("{current === 'agents' && <AgentsSettings />}"), 'Agents shows AgentsSettings');
  assert.ok(src.includes("{current === 'plugins' && <PluginsGroup />}"), 'Plugins shows the plugins list');
  assert.equal(S.resolveSection('agents'), 'agents');
  assert.equal(S.resolveSection('plugins'), 'plugins');
  assert.equal(S.resolveSection(undefined), 'general');
  assert.equal(S.SETTINGS_GROUPS.find((g) => g.id === 'agents').label, 'Connect an AI');
});

test('Connect an AI is its own component, always rendered: the switch, the level, and the set-up', () => {
  const src = read('src/renderer/src/components/AgentsSettings.tsx');
  const use = src.split('\n').find((l) => l.includes('<ConnectAiSettings'));
  assert.ok(use && /^<ConnectAiSettings state=\{state\}\s*\/?>/.test(use.trim()), 'Connect an AI renders with the page, gated on nothing');
  const local = read('src/renderer/src/components/ConnectAiSettings.tsx');
  assert.ok(local.includes('export function ConnectAiSettings'), 'its own file');
  assert.ok(local.includes('<Section title="Connect an AI">'), 'one section');
  assert.ok(!/NeuralSpark/.test(local), 'nothing of the old host app in it');
  const firstGate = local.indexOf('{mcp.on &&');
  assert.ok(firstGate > 0, 'the level and set-up wait until switched on');
  assert.ok(local.indexOf('<Row title="Connect an AI"') > 0 && local.indexOf('<Row title="Connect an AI"') < firstGate, 'the on/off switch shows while off');
  assert.ok(local.includes('title="What they may do"'), 'what they may do shows once on');
  assert.ok(local.includes("allows.mcpWrite ? [{ id: 'read', label: 'Read only' }, { id: 'edit', label: 'Read and write' }] : [{ id: 'read', label: 'Read only' }]"), 'Read only / Read and write, and only Read only when policy allows reading only');
  assert.ok(local.includes('title="Local URL"') && local.includes('Make a new token'), 'the local URL and its token');
  assert.ok(local.includes('className="ag-setup-body"') && local.includes('MCP_SETUP_APPS.map'), 'the set-up lines, one per app');
  assert.ok(local.includes('className="notice"') && local.includes('is not set up on this PC yet'), 'or plain words where the command is not set up');
});

test('the new rows are indexed for search, in the groups that show them', () => {
  const titles = new Map(S.SETTINGS_INDEX.map((e) => [e.title, e.section]));
  assert.equal(titles.get('Connect an AI'), 'agents');
  assert.equal(titles.get('What they may do'), 'agents');
  assert.equal(titles.get('Add your own'), 'plugins');
});

test('Plugins lists each plugin with on/off and Remove, and the example is Word count', () => {
  const src = read('src/renderer/src/components/Settings.tsx');
  const group = src.slice(src.indexOf('function PluginsGroup'), src.indexOf('export function SettingsPage'));
  assert.ok(group.includes('title={p.name}'), 'each plugin is a row under its own name');
  assert.ok(group.includes('onChange={(on) => void switchPlugin(p, on)}'), 'each row switches on and off');
  assert.ok(/>\s*Remove\s*</.test(group), 'each row removes');
  assert.ok(group.includes('Allow ${p.name}'), 'switching on asks first, with what it wants');
  assert.ok(group.includes('title="Add your own"'), 'the folder row for your own');
  assert.ok(group.includes('ensurePlugins()'), 'opening Plugins writes the example first');
  const manifest = read('src/main/plugin-example.ts').match(/EXAMPLE_PLUGIN_MANIFEST = `([\s\S]*?)`;/);
  assert.equal(JSON.parse(manifest[1]).name, 'Word count');
  assert.ok(read('src/main/plugins.ts').includes('EXAMPLE_PLUGIN_MANIFEST'), 'a new plugins folder is made with the example in it');
  assert.ok(read('src/main/plugins.ts').includes('async listWithExample'), 'the example arrives when Plugins opens, in any vault');
  assert.ok(read('src/main/app.ts').includes("handle('plugins:ensure'"), 'the window can ask for it');
  assert.ok(read('src/preload/index.ts').includes("ensure: () => invoke<PluginView[]>('plugins:ensure')"), 'the window reaches it');
});

test('the command is read again when on, and said for a standalone install (no host wording)', () => {
  const local = read('src/renderer/src/components/ConnectAiSettings.tsx');
  assert.ok(local.includes('[mcp.on]'), 'where the command is, read again when switched on');
  assert.ok(local.includes('state.localMcpCommand'), "this app's own program when there is no ironleaf command");
  assert.ok(local.includes('when Ironleaf is installed'), 'the standalone words kept');
});
