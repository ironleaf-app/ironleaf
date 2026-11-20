// node --test tests/assistant-tools-lean.test.mjs — the side chat keeps its tool
// list lean (5 Nov 2026, s10-assistant-tools-lean: every turn sent 84+ tool
// descriptions, ~71,000 chars, after p5 cut the 40-cap that had silently
// dropped note_to_pdf, the catalogue, web and memory). The everyday set is
// always offered; the rest opens with one more_tools door the model calls
// itself, appended for later rounds of the same answer. Through the real
// functions (AgentTools.offeredTools/run, the real catalogue): the everyday
// set keeps note_to_pdf, a rarely used catalogue tool is reached end to end,
// the everyday list stays under budget, and the suggest-mode read-only
// narrowing still holds (door included). A call of a known tool always runs,
// offered or not, so the door can never strand a capability.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tools-lean-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [`export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/shared/vault-tools.ts'))};`].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// The side chat's catalogue as the app wires it: the catalogue's own tools plus the former host
// app's served ones (the Bin excepted, as the app excepts it).
const servedStub = () => ({
  tools: () => ['neuralvault_view', 'make_chart', 'neuralvault_record', 'neuralvault_clip', 'neuralvault_receipt', 'neuralvault_import', 'neuralvault_bulk'].map((name) => ({ name, title: name, description: `${name} does its thing.`, parameters: { type: 'object', properties: {} }, level: 'full' })),
});
const sideSpecs = () => [...M.catalogueFor('side'), ...M.sparkServed(servedStub()).filter((t) => t.name !== 'neuralvault_bin')];
const fakeCatalogue = (specs = sideSpecs(), seen = []) => ({
  specs: () => specs,
  call: async (name, args) => {
    seen.push([name, args]);
    return { text: `called ${name}`, isError: false, changed: [] };
  },
});
const tools = (host, emit = () => {}) => new M.AgentTools({ index: { get: () => undefined }, ...host }, [], emit);
const names = (list) => list.map((t) => t.name);

test('the everyday set always offers note_to_pdf, web and memory', () => {
  const t = tools({ catalogue: fakeCatalogue(), web: {}, memory: {} });
  const offered = names(t.offeredTools());
  for (const name of ['note_to_pdf', 'web_search', 'web_read', 'remember', 'forget', 'more_tools']) assert.ok(offered.includes(name), `${name} is offered every round`);
});

test('the offered web tools follow the host app’s web-search switch', () => {
  // Merged with c3 item 2: offeredTools keeps the landed webToolsOffered
  // gating, so no web tool is sent while the switch is off.
  const off = names(tools({ catalogue: fakeCatalogue(), web: {}, webSearchOff: () => true }).offeredTools());
  assert.ok(!off.includes('web_search') && !off.includes('web_read'), 'no web tool is offered while switched off');
  const on = names(tools({ catalogue: fakeCatalogue(), web: {}, webSearchOff: () => false }).offeredTools());
  assert.ok(on.includes('web_search') && on.includes('web_read'), 'both web tools are offered while switched on');
  const older = names(tools({ catalogue: fakeCatalogue(), web: {} }).offeredTools());
  assert.ok(older.includes('web_search') && older.includes('web_read'), 'an older host app with no signal still gets both');
});

test('a rarely used catalogue tool is reached end to end through the door', async () => {
  const seen = [];
  const steps = [];
  const t = tools({ catalogue: fakeCatalogue(sideSpecs(), seen) }, (s) => steps.push(s));
  assert.ok(!names(t.offeredTools()).includes('canvas_create'), 'canvas_create is not sent every turn');
  const opened = await t.run({ id: '1', name: 'more_tools', arguments: '{}' });
  assert.equal(opened.isError, undefined);
  assert.ok(opened.text.includes('canvas_create'), 'the door names what opened');
  assert.ok(
    steps.some((s) => s.words === 'Opened more tools'),
    'the person sees one plain step line',
  );
  assert.ok(names(t.offeredTools()).includes('canvas_create'), 'the rare tool is offered from the next round');
  const answer = await t.run({ id: '2', name: 'canvas_create', arguments: '{"path":"Boards/Launch plan.canvas"}' });
  assert.equal(answer.isError, undefined);
  assert.deepEqual(seen, [['canvas_create', { path: 'Boards/Launch plan.canvas' }]], 'the call went through the real catalogue caller');
});

test('the everyday list stays under budget', () => {
  const t = tools({ catalogue: fakeCatalogue(), web: {}, memory: {} });
  const offered = t.offeredTools();
  const wire = JSON.stringify(offered.map((s) => ({ name: s.name, description: s.description, parameters: s.parameters })));
  assert.ok(offered.length <= 70, `${offered.length} tools offered (budget 70)`);
  assert.ok(wire.length <= 60000, `${wire.length} chars sent (budget 60000)`);
});

test('suggest-mode read-only narrowing still holds, door included', async () => {
  // ai.ts narrows the catalogue to its looks while the person approves each
  // change first; the door and the offered list read those same specs.
  const looks = sideSpecs().filter((t) => t.readOnly);
  assert.ok(looks.length < sideSpecs().length, 'the fixture narrows something');
  const t = tools({ catalogue: fakeCatalogue(looks) });
  const offered = names(t.offeredTools());
  assert.ok(!offered.includes('canvas_create'), 'a write stays unoffered in suggest mode');
  assert.ok(offered.includes('today_get'), 'an everyday look stays offered in suggest mode');
  assert.ok(!offered.includes('canvas_get'), 'a rare look waits for the door in suggest mode');
  const opened = await t.run({ id: '1', name: 'more_tools', arguments: '{}' });
  assert.ok(!opened.text.includes('canvas_create'), 'the door lists no write in suggest mode');
  assert.ok(opened.text.includes('canvas_get'), 'the door lists the looks in suggest mode');
  const after = names(t.offeredTools());
  assert.ok(!after.includes('canvas_create'), 'opening the door adds no write in suggest mode');
  assert.ok(after.includes('canvas_get'), 'opening the door adds the looks in suggest mode');
});

test('a call of a known tool runs whether the door opened or not', async () => {
  const seen = [];
  const t = tools({ catalogue: fakeCatalogue(sideSpecs(), seen) });
  const answer = await t.run({ id: '1', name: 'canvas_create', arguments: '{"path":"Boards/Launch plan.canvas"}' });
  assert.equal(answer.isError, undefined);
  assert.deepEqual(seen, [['canvas_create', { path: 'Boards/Launch plan.canvas' }]]);
});

test("the host app's served tools open through the door, never every turn", async () => {
  const t = tools({ catalogue: fakeCatalogue() });
  assert.ok(!names(t.offeredTools()).includes('neuralvault_view'), 'served views are not sent every turn');
  await t.run({ id: '1', name: 'more_tools', arguments: '{}' });
  assert.ok(names(t.offeredTools()).includes('neuralvault_view'), 'served views open with the door');
});
