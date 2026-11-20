// node --test tests/seam-sidechat.test.mjs — 9.2 seam, Ironleaf's side chat (the findings
// F1-F8): the same request gets the same answer in the side chat as over the catalogue. One read with
// parts, one default per listing family, project changes counted as projects, per-action served steps,
// the open project as the catalogue default, and paired served specs with a timeout. Made-up notes in
// memory; never a real vault.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-seam-side-'));
let M;
let V;
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
      `export * as VAULT from ${JSON.stringify(path.join(root, 'src/shared/vault-tools.ts'))};`,
      `export * as SHARED from ${JSON.stringify(path.join(root, 'src/shared/agent-access.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'side.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'side.mjs')).href);
  V = M.VAULT;
  S = M.SHARED;
});
after(() => rmSync(work, { recursive: true, force: true }));

function fakeHost(notes, mtimes = {}) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), mtimes[rel] ?? now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [...new Set([...files.keys()].filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    write: async (rel, text) => {
      files.set(rel, text);
      reindex(rel);
    },
    makeFolder: async () => {},
    move: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
      reindex(from);
      reindex(to);
      return { path: to, linksUpdated: 0 };
    },
    trash: async (rel) => {
      files.delete(rel);
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Saturday 1 November 2026 (2026-11-01)',
  };
  return { host, files };
}
const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

test('F1: a long note reads in parts, path first, as note_read does', async () => {
  const long = `# Harbour minutes\n\n${'Agreed the crane arrives Monday. '.repeat(800)}`;
  assert.ok(long.length > 24000 && long.length <= 36000, `long enough for three parts, got ${long.length}`);
  const { host } = fakeHost({ 'Meetings/Harbour.md': long });
  const tools = new M.AgentTools(host, [], () => {});
  const first = await run(tools, 'read_note', { path: 'Meetings/Harbour.md' });
  assert.ok(!first.isError, first.text);
  assert.match(first.text, /^Meetings\/Harbour\.md\n\n/, 'the path first, as note_read');
  assert.match(first.text, /part 1 of 3: ask for part 2 for more/, 'paged, not truncated');
  assert.doesNotMatch(first.text, /rest of this long note is left out/, 'never a dead end');
  const second = await run(tools, 'read_note', { path: 'Meetings/Harbour.md', part: 2 });
  assert.ok(!second.isError, second.text);
  assert.match(second.text, /part 2 of 3/, 'the next part on request');
  assert.notEqual(second.text, first.text, 'a different part, not the same truncation');
  const spec = M.TOOLS.find((t) => t.name === 'read_note');
  assert.ok(spec.parameters.properties.part, 'part is offered');
});

test('F2/F3/F4: one default per listing family on both sides', async () => {
  // F2: "lately" is 7 days and 40 notes, not 14 days and 60.
  assert.equal(S.RECENT_DAYS, 7);
  assert.equal(S.RECENT_LIMIT, 40);
  const old = Date.now() - 10 * 86400000;
  const notes = { 'Recent.md': '# Recent\nFresh words.' };
  for (let i = 0; i < 45; i++) notes[`Log/Day ${i}.md`] = `# Day ${i}\nFresh words.`;
  notes['Old.md'] = '# Old\nFresh words.';
  const mtimes = { 'Old.md': old };
  const { host } = fakeHost(notes, mtimes);
  const tools = new M.AgentTools(host, [], () => {});
  const recent = await run(tools, 'recent_notes', {});
  assert.ok(!recent.text.includes('Old.md'), 'ten days back is not "lately"');
  const lines = recent.text.split('\n').filter((l) => l.endsWith('.md (changed'));
  assert.ok(recent.text.split('\n').length <= 43, `at most 40 notes plus head lines, got ${recent.text.split('\n').length}`);
  // F3: one search asks for 10 of 30.
  assert.equal(S.SEARCH_LIMIT, 10);
  assert.equal(S.SEARCH_MAX, 30);
  const many = {};
  for (let i = 0; i < 15; i++) many[`Bills/Bill ${i}.md`] = `# Bill ${i}\nThe credit card bill is due.`;
  const h2 = fakeHost(many);
  const t2 = new M.AgentTools(h2.host, [], () => {});
  const hits = await run(t2, 'search_notes', { query: 'credit card' });
  assert.equal(hits.text.split('\n').filter((l) => l.endsWith('.md')).length, 10, 'the shared default, not 15');
  // F4: folders list 60 of 200, assets 30 of 60.
  assert.equal(S.LIST_LIMIT, 60);
  assert.equal(S.ASSET_LIMIT, 30);
  const folder = {};
  for (let i = 0; i < 70; i++) folder[`Harbour/Note ${i}.md`] = `# Note ${i}\nWords.`;
  const h3 = fakeHost(folder);
  const t3 = new M.AgentTools(h3.host, [], () => {});
  const listed = await run(t3, 'list_notes', { folder: 'Harbour' });
  assert.match(listed.text, /70 notes \(showing 60\)/, 'the shared cap, not 150');
});

test('F5: a catalogue edit of a project counts as a project, not a note', async () => {
  const before = '---\ntype: project\nstatus: active\n---\n# Studio Upgrade\n\n## Summary\n\nFit-out.\n';
  const afterText = `${before}\n## What's next\n\n- [ ] Send v4 — Sam Taylor\n`;
  const { host } = fakeHost({ 'Projects/Studio Upgrade/Studio Upgrade.md': before });
  const served = [{ name: 'project_add_next_step', tool: 'project_add_next_step', title: 'Add a next step', description: 'Add.', parameters: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }, level: 'edit', readOnly: false }];
  const catalogue = {
    specs: () => served,
    call: async () => {
      await host.write('Projects/Studio Upgrade/Studio Upgrade.md', afterText);
      return { text: 'Added.', isError: false, changed: [{ path: 'Projects/Studio Upgrade/Studio Upgrade.md', before }] };
    },
  };
  const tools = new M.AgentTools({ ...host, catalogue }, [], () => {}, null);
  const r = await run(tools, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Send v4' });
  assert.ok(!r.isError, r.text);
  assert.equal(tools.changes.length, 1);
  assert.equal(tools.changes[0].project, true, 'the project flag survives the catalogue door');
  const summary = M.summarise('t1', tools.changes);
  assert.deepEqual([summary.projectsChanged, summary.changed], [1, 0], 'the card reads "brought 1 project up to date"');
});

test('F6: served steps say what was done and for whom, never a bare title', () => {
  assert.equal(M.servedStepWords({ title: 'Today', readOnly: true }, {}), 'Looked at today');
  assert.equal(M.servedStepWords({ title: 'The timeline', readOnly: true }, { project: 'Studio Upgrade' }), 'Looked at the timeline for Studio Upgrade');
  assert.equal(M.servedStepWords({ title: 'Add a next step', readOnly: false }, { project: 'Projects/Studio Upgrade/Studio Upgrade.md' }), 'Add a next step for Studio Upgrade');
  assert.match(M.servedStepWords({ title: 'Every project', readOnly: true }, { query: 'harbour' }), /harbour/, 'the query is named');
});

test('F6b: views, charts and dashboards step per action, never the bare listing title (seams O6)', async () => {
  const view = { name: 'neuralvault_view', title: 'Views, charts and dashboards', readOnly: false };
  assert.equal(M.servedStepWords(view, { action: 'create', name: 'Q3 sales' }), 'Made a view “Q3 sales”');
  assert.equal(M.servedStepWords(view, { action: 'create' }), 'Made a view');
  assert.equal(M.servedStepWords(view, { action: 'update', name: 'Q3 sales' }), 'Changed the view “Q3 sales”');
  assert.equal(M.servedStepWords(view, { action: 'delete', name: 'Q3 sales' }), 'Removed the view “Q3 sales”');
  assert.equal(M.servedStepWords({ ...view, readOnly: true }, { action: 'list' }), 'Looked at the views');
  assert.equal(M.servedStepWords({ ...view, readOnly: true }, { action: 'get', name: 'Q3 sales' }), 'Looked at the view “Q3 sales”');
  assert.equal(M.servedStepWords(view, { action: 'create', name: 'Q3 sales', project: 'Projects/Harbour/Harbour.md' }), 'Made a view “Q3 sales” for Harbour');
  const chart = { name: 'make_chart', title: 'A live chart in a note', readOnly: false };
  assert.equal(M.servedStepWords(chart, { note: 'Me/Finance/Spending.md' }), 'Made a chart in Spending');
  assert.equal(M.servedStepWords(chart, { action: 'create', title: 'Spend by month', note: 'Spending.md' }), 'Made a chart “Spend by month” in Spending');
  // Unknown actions and tools keep the title words.
  assert.equal(M.servedStepWords(view, { action: 'frobnicate' }), 'Views, charts and dashboards');
  assert.equal(M.servedStepWords(view, {}), 'Views, charts and dashboards');
  assert.equal(M.servedStepWords({ name: 'neuralvault_bin', title: 'The Bin', readOnly: false }, { action: 'create' }), 'The Bin');
  // Through the side chat's served door, the step is per action.
  const { host } = fakeHost({ 'Projects/Studio Upgrade/Studio Upgrade.md': '---\ntype: project\n---\n# Studio Upgrade\n' });
  const served = [{ name: 'neuralvault_view', tool: 'neuralvault_view', title: 'Views, charts and dashboards', description: 'Views.', parameters: { type: 'object', properties: {}, additionalProperties: false }, level: 'edit', readOnly: false }];
  const catalogue = { specs: () => served, call: async () => ({ text: 'Made.', isError: false, changed: [] }) };
  const steps = [];
  const tools = new M.AgentTools({ ...host, catalogue }, [], (s) => steps.push(s));
  await run(tools, 'neuralvault_view', { action: 'create', name: 'Q3 sales' });
  assert.ok(steps.some((s) => s.words === 'Made a view “Q3 sales”'), JSON.stringify(steps.map((s) => s.words)));
});

test('F7: the open project is the catalogue default when none is named', async () => {
  const { host } = fakeHost({ 'Projects/Studio Upgrade/Studio Upgrade.md': '---\ntype: project\n---\n# Studio Upgrade\n' });
  const seen = [];
  const served = [{ name: 'project_get', tool: 'project_get', title: 'One project in full', description: 'One.', parameters: { type: 'object', properties: { project: { type: 'string' } }, additionalProperties: false }, level: 'read', readOnly: true }];
  const catalogue = {
    specs: () => served,
    call: async (name, args) => {
      seen.push(args);
      return { text: '{}', isError: false, changed: [] };
    },
  };
  const steps = [];
  const tools = new M.AgentTools({ ...host, catalogue }, [], (s) => steps.push(s), 'Projects/Studio Upgrade/Studio Upgrade.md');
  const r = await run(tools, 'project_get', {});
  assert.ok(!r.isError, r.text);
  assert.equal(seen[0].project, 'Projects/Studio Upgrade/Studio Upgrade.md', 'the open project goes over');
  assert.match(steps.map((s) => s.words).join(' '), /Studio Upgrade/, 'the step names it too');
  // An explicit project wins over the open one.
  const tools2 = new M.AgentTools({ ...host, catalogue }, [], () => {}, 'Projects/Studio Upgrade/Studio Upgrade.md');
  await run(tools2, 'project_get', { project: 'Other' });
  assert.equal(seen[1].project, 'Other');
});

test('F8: served specs pair from one listing, and a hung call fails plainly', async () => {
  let calls = 0;
  const host = {
    tools: () => {
      calls++;
      return calls === 1
        ? [{ name: 'neuralvault_view', title: 'Views', description: 'Views.', parameters: { type: 'object', properties: {} }, level: 'edit', readOnly: true }]
        : [{ name: 'neuralvault_bin', title: 'Bin', description: 'Bin.', parameters: { type: 'object', properties: {} }, level: 'edit' }];
    },
    call: async () => ({ text: 'done' }),
  };
  const paired = V.sparkPaired(host);
  assert.equal(calls, 1, 'one listing, not two');
  assert.deepEqual(paired.defs.map((t) => t.name), ['neuralvault_view']);
  assert.deepEqual(paired.served.map((t) => t.name), ['neuralvault_view'], 'specs and router pair');
  await assert.rejects(() => M.catalogueCallWithTimeout(() => new Promise(() => {}), 20), /didn’t answer just now/, 'plain words, not a hang');
  assert.equal(await M.catalogueCallWithTimeout(async () => 'quick', 500), 'quick', 'a prompt answer passes through');
});
