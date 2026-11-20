// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/policy.test.mjs — managed policy (src/main/policy.ts): parsing, the registry and file merged, and
// each enforcement hook at its decision point: adding an AI connection (connections.ts), managed connections and their
// keys (providers/index.ts), other AI apps over MCP (agent-access.ts › localMcpSettings), ask before changes (app.ts)
// and the update checker (update-check.ts). One bundle, so every module shares the one policy in force.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-policy-'));
let P, C, U;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const at = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(entry, `export * as P from ${at('src/main/policy.ts')};\nexport * as C from ${at('src/main/providers/connections.ts')};\nexport * as U from ${at('src/main/update-check.ts')};\n`);
  await build({ input: entry, platform: 'node', external: ['electron', /^@earendil-works\//], output: { file: path.join(work, 'p.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  ({ P, C, U } = await import(pathToFileURL(path.join(work, 'p.mjs')).href));
});
afterEach(() => P.setPolicyForTests({}));
after(() => rmSync(work, { recursive: true, force: true }));

test('parsing keeps what it understands and reports the rest in words', () => {
  const problems = [];
  const p = P.parsePolicy({
    ai: { allowedProviders: ['anthropic', 'skynet'], allowPersonalKeys: false, managedConnections: [{ id: 'gw', name: 'Company gateway', kind: 'custom', baseURL: 'https://ai.corp.example/v1', models: ['m1'], apiKeyEnv: 'CORP_AI_KEY' }, { id: 'bad' }] },
    mcp: { allowed: true, maxLevel: 'admin' },
    updates: { disabled: 1, channel: 'Beta Channel!', origin: 'http://insecure.example' },
    telemetry: 'all',
    askBeforeChanges: { forceOn: true },
    unknown: { x: 1 },
  }, problems);
  assert.deepEqual(p.ai.allowedProviders, ['anthropic']);
  assert.equal(p.ai.allowPersonalKeys, false);
  assert.equal(p.ai.managedConnections.length, 1);
  assert.equal(p.ai.managedConnections[0].apiKeyEnv, 'CORP_AI_KEY');
  assert.equal(p.mcp.allowed, true);
  assert.equal(p.mcp.maxLevel, undefined);
  assert.equal(p.updates.disabled, true);
  assert.equal(p.updates.channel, undefined);
  assert.equal(p.updates.origin, undefined);
  assert.equal(p.telemetry, undefined);
  assert.equal(p.askBeforeChanges.forceOn, true);
  for (const words of [/skynet/, /"bad"/, /maxLevel/, /channel/, /origin/, /telemetry/]) assert.ok(problems.some((x) => words.test(x)), `reported: ${words}`);
  assert.deepEqual(P.parsePolicy(null), {});
  assert.deepEqual(P.parsePolicy('nonsense', []), {});
});

test('the registry and the file are merged, the registry winning key by key', () => {
  const reg = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Ironleaf',
    '    Policy    REG_SZ    {"mcp":{"allowed":true,"maxLevel":"edit"}}',
    '    mcp.maxLevel    REG_SZ    read',
    '    updates.disabled    REG_DWORD    0x1',
    '    ai.allowedProviders    REG_SZ    ["openai","custom"]',
    '',
  ].join('\r\n');
  const file = JSON.stringify({ mcp: { allowed: false }, updates: { channel: 'beta' }, askBeforeChanges: { forceOn: true }, ai: { allowedProviders: ['anthropic'] } });
  const l = P.loadPolicy({ platform: 'win32', env: { ProgramData: 'C:\\ProgramData' }, readFile: (f) => (f === 'C:\\ProgramData\\Ironleaf\\policy.json' ? file : null), readRegistry: () => reg });
  assert.deepEqual(l.sources, ['C:\\ProgramData\\Ironleaf\\policy.json', P.REGISTRY_KEY]);
  assert.equal(l.policy.mcp.allowed, true, 'the registry\'s JSON wins over the file');
  assert.equal(l.policy.mcp.maxLevel, 'read', 'a dotted registry value wins over the registry\'s JSON');
  assert.equal(l.policy.updates.disabled, true);
  assert.equal(l.policy.updates.channel, 'beta', 'the file\'s other keys are kept');
  assert.deepEqual(l.policy.ai.allowedProviders, ['openai', 'custom']);
  assert.equal(l.policy.askBeforeChanges.forceOn, true);
  assert.deepEqual(l.problems, []);
});

test('Linux reads /etc/ironleaf/policy.json only; bad JSON is ignored with a problem, never a crash', () => {
  const asked = [];
  const none = P.loadPolicy({ platform: 'linux', env: { HOME: '/home/u' }, readFile: (f) => (asked.push(f), null) });
  assert.deepEqual(asked, ['/etc/ironleaf/policy.json']);
  assert.deepEqual(none.policy, {});
  assert.equal(P.policyView(none).managed, false);
  const bad = P.loadPolicy({ platform: 'linux', env: {}, readFile: () => '{ not json' });
  assert.deepEqual(bad.policy, {});
  assert.match(bad.problems[0], /not valid JSON/);
});

test('hook: adding an AI connection (allowedProviders, allowPersonalKeys)', async () => {
  const dir = mkdtempSync(path.join(work, 'conn-'));
  const store = new C.ConnectionStore(dir);
  await store.load();
  P.setPolicyForTests({ ai: { allowedProviders: ['ollama'] } });
  await assert.rejects(store.add({ kind: 'openai' }), (e) => e.managed === true && /managed by your organisation/.test(e.message));
  const ok = await store.add({ kind: 'ollama' });
  assert.ok(ok.id);
  P.setPolicyForTests({ ai: { allowPersonalKeys: false } });
  await assert.rejects(store.add({ kind: 'ollama' }), /Adding your own AI connections is managed by your organisation/);
  assert.equal(store.list().length, 0, 'personal connections are not offered while personal keys are off');
  P.setPolicyForTests({});
  assert.equal(store.list().length, 1, 'and come back when the policy goes: nothing was deleted');
});

test('hook: managed connections are listed first, cannot be changed, and take their key from the environment', async () => {
  const dir = mkdtempSync(path.join(work, 'conn-'));
  const store = new C.ConnectionStore(dir);
  await store.load();
  await store.add({ kind: 'anthropic' });
  P.setPolicyForTests({ ai: { managedConnections: [{ id: 'gw', name: 'Company gateway', kind: 'custom', baseURL: 'https://ai.corp.example/v1', models: ['m1'], apiKeyEnv: 'CORP_AI_KEY' }], allowedProviders: ['custom', 'anthropic'] } });
  const list = store.list();
  assert.equal(list[0].id, 'managed-gw');
  assert.equal(list[0].baseURL, 'https://ai.corp.example/v1');
  assert.equal(list.length, 2);
  await assert.rejects(store.update('managed-gw', { name: 'Mine now' }), /managed by your organisation/);
  await assert.rejects(store.remove('managed-gw'), /managed by your organisation/);
  const saved = JSON.parse((await import('node:fs')).readFileSync(path.join(dir, 'connections.json'), 'utf8'));
  assert.ok(!saved.connections.some((c) => c.id.startsWith('managed-')), 'managed connections are never saved');
  const own = new Map([['conn-1', 'personal-key']]);
  const base = { has: (id) => own.has(id), get: (id) => own.get(id), set: async (id, k) => void own.set(id, k), remove: async (id) => void own.delete(id) };
  const keys = P.keysUnderPolicy(base, { CORP_AI_KEY: 'from-env' });
  assert.equal(keys.get('managed-gw'), 'from-env');
  assert.equal(keys.has('managed-gw'), true);
  assert.equal(keys.get('conn-1'), 'personal-key');
  await assert.rejects(keys.set('managed-gw', 'x'), /managed by your organisation/);
  P.setPolicyForTests({ ai: { allowPersonalKeys: false } });
  await assert.rejects(keys.set('conn-1', 'x'), /Adding your own AI keys/);
});

test('hook: other AI apps over MCP (allowed, maxLevel) and making agent keys', () => {
  const s = { on: true, level: 'edit', http: true, port: 47731 };
  P.setPolicyForTests({});
  assert.deepEqual(P.localMcpUnderPolicy(s), s, 'no policy: the person\'s choice as it is');
  P.setPolicyForTests({ mcp: { maxLevel: 'read' } });
  assert.deepEqual(P.localMcpUnderPolicy(s), { ...s, level: 'read' });
  P.setPolicyForTests({ mcp: { allowed: false } });
  assert.equal(P.localMcpUnderPolicy(s).on, false);
  assert.throws(() => P.assertCanConnectAgents(), /Connecting AI apps is managed by your organisation/);
  P.setPolicyForTests({ mcp: { allowed: true } });
  assert.doesNotThrow(() => P.assertCanConnectAgents());
});

test('hook: ask before changes is forced on, never forced off', () => {
  P.setPolicyForTests({});
  assert.equal(P.askBeforeChangesUnderPolicy(false), false);
  P.setPolicyForTests({ askBeforeChanges: { forceOn: true } });
  assert.equal(P.askBeforeChangesUnderPolicy(false), true);
  P.setPolicyForTests({ askBeforeChanges: { forceOn: false } });
  assert.equal(P.askBeforeChangesUnderPolicy(false), false);
  assert.equal(P.askBeforeChangesUnderPolicy(true), true);
});

test('hook: updates disabled means no check at all; an origin and channel move where latest.json is read', async () => {
  P.setPolicyForTests({ updates: { disabled: true } });
  assert.deepEqual(P.updatesUnderPolicy(), { disabled: true });
  let fetched = 0;
  const checker = new U.UpdateChecker({
    current: '2.0.0', platform: 'linux',
    fetch: async () => (fetched++, { ok: true, status: 200, text: async () => '{}' }),
    readState: async () => null, writeState: async () => {}, openExternal: () => {},
    managed: { disabled: true, words: 'Managed by your organisation. Updates are installed by your organisation.' },
  });
  const forced = await checker.check(true);
  assert.equal(fetched, 0, '"Check now" checks nothing either');
  assert.equal(forced.enabled, false);
  assert.match(forced.managed, /Managed by your organisation/);
  assert.equal((await checker.setEnabled(true)).enabled, false, 'the switch stays off');
  P.setPolicyForTests({ updates: { origin: 'https://updates.corp.example', channel: 'beta' } });
  const u = P.updatesUnderPolicy();
  assert.deepEqual(u, { disabled: false, origin: 'https://updates.corp.example', channel: 'beta' });
  assert.equal(P.managedLatestUrl(u.origin, u.channel), 'https://updates.corp.example/download/beta/latest.json');
  assert.equal(P.managedLatestUrl('https://x.example'), 'https://x.example/download/latest.json');
  P.setPolicyForTests({ updates: { channel: 'stable' } });
  assert.deepEqual(P.updatesUnderPolicy(), { disabled: false }, 'stable is the default layout');
});

test('the window\'s view lists each lock in words; telemetry is always none', () => {
  const v = P.policyView({ policy: { ai: { allowPersonalKeys: false }, mcp: { allowed: false }, updates: { disabled: true }, askBeforeChanges: { forceOn: true }, telemetry: 'none' }, sources: ['/etc/ironleaf/policy.json'], problems: [] });
  assert.equal(v.managed, true);
  assert.deepEqual(v.locks.map((l) => l.area), ['ai', 'mcp', 'updates', 'askBeforeChanges']);
  assert.equal(P.MANAGED_WORDS, 'Managed by your organisation');
});

test('the window is told what it may offer: only allowed AI kinds, own keys, and MCP write', () => {
  assert.deepEqual(P.policyView({ policy: {}, sources: [], problems: [] }).allows, { providers: null, personalKeys: true, mcp: true, mcpWrite: true });
  const v = P.policyView({ policy: { ai: { allowedProviders: ['anthropic', 'ollama'] }, mcp: { maxLevel: 'read' } }, sources: ['team: Bakehouse'], problems: [] });
  assert.deepEqual(v.allows, { providers: ['anthropic', 'ollama'], personalKeys: true, mcp: true, mcpWrite: false });
  assert.deepEqual(P.policyView({ policy: { ai: { allowPersonalKeys: false }, mcp: { allowed: false } }, sources: ['x'], problems: [] }).allows, { providers: null, personalKeys: false, mcp: false, mcpWrite: false });
});
