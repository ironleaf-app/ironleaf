// The Vault's own local MCP server for other AI apps (8.9): the fixed tools and set-up JSON (shared), the JSON-RPC over
// real stdio with a fixture vault (the server), the same dispatch agents use (AgentAccess.asLocalMcp, with Undo proved
// by undoing), the "ironleaf mcp" parsing and bridge, and the /mcp local-connection endpoint. Made-up values only.

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';
import { createFixtureBackend } from './fixtures/mcp-local-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'tests', 'tmp', 'mcp-local');
const src = (p) => JSON.stringify(pathToFileURL(path.join(root, p)).href);
const yamlLink = () => {
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
};

let S;
let Server;
let A;
let Cli;

before(async () => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  yamlLink();
  const sharedEntry = path.join(work, 'shared-entry.ts');
  writeFileSync(sharedEntry, `export * from ${src('src/shared/mcp-local.ts')};\n`);
  await build({ input: sharedEntry, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'mcp-shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'mcp-shared.mjs')).href);
  const serverEntry = path.join(work, 'server-entry.ts');
  writeFileSync(serverEntry, `export { McpLocalServer, handleMcpLine, MCP_MAX_LINE } from ${src('src/main/mcp-local.ts')};\n`);
  await build({ input: serverEntry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'mcp-server.mjs'), format: 'esm' }, logLevel: 'silent' });
  Server = await import(pathToFileURL(path.join(work, 'mcp-server.mjs')).href);
  const accessEntry = path.join(work, 'access-entry.ts');
  writeFileSync(
    accessEntry,
    [
      `export { AgentAccess } from ${src('src/main/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { parseCli, cliWrites, cliHelp } from ${src('src/shared/cli.ts')};`,
    ].join('\n'),
  );
  await build({ input: accessEntry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'access.mjs'), format: 'esm' }, logLevel: 'silent' });
  A = await import(pathToFileURL(path.join(work, 'access.mjs')).href);
  const cliEntry = path.join(work, 'cli-entry.ts');
  writeFileSync(cliEntry, [`export { CliServer, runCliArgs } from ${src('src/main/cli.ts')};`, `export { cliScripts } from ${src('src/main/windows-entry.ts')};`].join('\n'));
  await build({ input: cliEntry, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'cli.mjs'), format: 'esm' }, logLevel: 'silent' });
  Cli = await import(pathToFileURL(path.join(work, 'cli.mjs')).href);
  // The stdio runner: the server with the fixture vault, stdin in, stdout out, what happened dumped at the end.
  writeFileSync(
    path.join(work, 'runner.mjs'),
    [
      `import { McpLocalServer } from './mcp-server.mjs';`,
      `import * as shared from './mcp-shared.mjs';`,
      `import { createFixtureBackend } from ${JSON.stringify(pathToFileURL(path.join(root, 'tests', 'fixtures', 'mcp-local-fixture.mjs')).href)};`,
      `import { readFileSync } from 'node:fs';`,
      `const seed = JSON.parse(readFileSync(process.argv[2], 'utf8'));`,
      `const backend = createFixtureBackend(shared, seed);`,
      `const server = new McpLocalServer(backend, { input: process.stdin, output: process.stdout, log: (m) => process.stderr.write('[fixture] ' + m + '\\n') });`,
      `await server.start();`,
      `backend.dump();`,
      '',
    ].join('\n'),
  );
}, { timeout: 120000 });
after(() => rmSync(work, { recursive: true, force: true }));

// ── stdio ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const FIXED7 = ['vault_search', 'note_read', 'projects_list', 'tasks_list', 'note_create', 'note_append', 'note_add_task'];

const SEED_NOTES = {
  'Notes/Hello.md': '# Hello\n\nSome words here for the search to find.\n',
  'Notes/Tasks.md': '# Tasks\n\n- [ ] Buy milk\n- [x] Post the letter\n',
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios nobody else reads.\n',
};
const SEED_PROJECTS = [{ name: 'Studio Upgrade', status: 'active', health: 'at risk' }];
const SEED_PACKS = { testpack: [{ id: 'r1', title: 'First record' }] };

/** The server over real stdio: messages in (objects, or raw lines), parsed answers and the dump out. */
async function runStdio(settings, messages) {
  const tag = `run-${Math.random().toString(36).slice(2)}`;
  const seedPath = path.join(work, `${tag}-seed.json`);
  const outPath = path.join(work, `${tag}-dump.json`);
  writeFileSync(seedPath, JSON.stringify({ settings, notes: SEED_NOTES, projects: SEED_PROJECTS, packs: SEED_PACKS, outPath }));
  const child = spawn(process.execPath, [path.join(work, 'runner.mjs'), seedPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += String(c)));
  child.stderr.on('data', (c) => (stderr += String(c)));
  for (const m of messages) child.stdin.write(typeof m === 'string' ? `${m}\n` : `${JSON.stringify(m)}\n`);
  child.stdin.end();
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 0, `the server exits cleanly (stderr: ${stderr.slice(0, 500)})`);
  const responses = stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const dump = JSON.parse(readFileSync(outPath, 'utf8'));
  return { responses, stderr, dump };
}
const byId = (responses, id) => responses.find((r) => !Array.isArray(r) && r.id === id);
const callText = (r) => r.result.content.map((c) => c.text).join('\n');

test('speaks MCP over stdio: initialize, tools/list, ping', async () => {
  const { responses } = await runStdio({ on: true, level: 'edit' }, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  assert.equal(responses.length, 3, 'the notification is never answered');
  assert.equal(byId(responses, 1).result.protocolVersion, '2025-06-18');
  assert.equal(byId(responses, 1).result.serverInfo.name, 'ironleaf');
  assert.deepEqual(byId(responses, 1).result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(byId(responses, 2).result.tools.map((t) => t.name), [...FIXED7, 'testpack_records', 'testpack_record_add']);
  assert.ok(byId(responses, 2).result.tools.every((t) => t.inputSchema?.type === 'object' && typeof t.description === 'string'));
  assert.deepEqual(byId(responses, 3).result, {});
});

test('reads over stdio, and never Private notes', async () => {
  const { responses } = await runStdio({ on: true, level: 'edit' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Notes/Hello.md' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Private notes/Diary.md' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vault_search', arguments: { query: 'sourdough' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'projects_list', arguments: {} } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'tasks_list', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'testpack_records', arguments: { pack: 'testpack' } } },
  ]);
  assert.match(callText(byId(responses, 1)), /Some words here/);
  assert.equal(byId(responses, 2).result.isError, true);
  assert.match(callText(byId(responses, 2)), /Private notes are never open/);
  assert.doesNotMatch(callText(byId(responses, 3)), /sourdough ratios/, 'search never shows a Private note’s words');
  assert.match(callText(byId(responses, 4)), /Studio Upgrade/);
  assert.equal(JSON.parse(callText(byId(responses, 5))).count, 2);
  assert.equal(JSON.parse(callText(byId(responses, 6))).records.length, 1);
});

test('writes over stdio land in activity with Undo, and the Undo restores', async () => {
  const { responses, dump } = await runStdio({ on: true, level: 'edit' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'note_create', arguments: { path: 'Notes/New.md', content: '# New\n' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note_append', arguments: { path: 'Notes/Hello.md', text: 'An added line.' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_add_task', arguments: { path: 'Notes/Tasks.md', text: 'Water the plants' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'testpack_record_add', arguments: { pack: 'testpack', title: 'Second record' } } },
  ]);
  for (const id of [1, 2, 3, 4]) assert.ok(!byId(responses, id).result.isError, `call ${id} went through: ${callText(byId(responses, id))}`);
  assert.equal(dump.activity.length, 4);
  assert.ok(dump.activity.every((e) => e.agent === 'Other AI apps' && e.undo && !e.undone), 'every write is activity with Undo');
  assert.equal(dump.notes['Notes/New.md'], '# New\n');
  assert.match(dump.notes['Notes/Hello.md'], /An added line\./);
  assert.match(dump.notes['Notes/Tasks.md'], /- \[ \] Water the plants/);
  assert.equal(dump.packs.testpack.length, 2);
  // The recorded Undo restores (in the same fixture, through its own call path).
  const backend = createFixtureBackend(S, { settings: { on: true, level: 'edit' }, notes: { ...SEED_NOTES }, projects: SEED_PROJECTS, packs: { testpack: [{ id: 'r1', title: 'First record' }] } });
  const said = await backend.call('note_append', { path: 'Notes/Hello.md', text: 'Gone soon.' });
  assert.ok(!said.isError);
  const entry = backend.activity().at(-1);
  assert.match(entry.words, /Added to the note/);
  assert.equal(backend.applyUndo(entry.id), `Undid ${entry.words}`);
  assert.equal((await backend.call('note_read', { path: 'Notes/Hello.md' })).text, SEED_NOTES['Notes/Hello.md']);
});

test('Read only reads but never writes', async () => {
  const { responses, dump } = await runStdio({ on: true, level: 'read' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Notes/Hello.md' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_create', arguments: { path: 'Notes/No.md', content: 'x' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'note_append', arguments: { path: 'Notes/Hello.md', text: 'x' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'note_add_task', arguments: { path: 'Notes/Tasks.md', text: 'x' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'testpack_record_add', arguments: { pack: 'testpack', title: 'x' } } },
  ]);
  assert.deepEqual(byId(responses, 1).result.tools.map((t) => t.name), ['vault_search', 'note_read', 'projects_list', 'tasks_list', 'testpack_records']);
  assert.ok(!byId(responses, 2).result.isError);
  for (const id of [3, 4, 5, 6]) {
    assert.equal(byId(responses, id).result.isError, true);
    assert.equal(callText(byId(responses, id)), S.LOCAL_MCP_READONLY);
  }
  assert.equal(dump.activity.length, 0, 'nothing was written, nothing logged');
  assert.ok(!('Notes/No.md' in dump.notes));
});

test('off refuses even reads, with where to switch on (the tools still list, so set-up reads right)', async () => {
  const { responses, dump } = await runStdio({ on: false, level: 'read' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Notes/Hello.md' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_create', arguments: { path: 'Notes/No.md', content: 'x' } } },
  ]);
  assert.equal(byId(responses, 1).result.tools.length, 9);
  assert.equal(callText(byId(responses, 2)), S.LOCAL_MCP_OFF);
  assert.equal(byId(responses, 2).result.isError, true);
  assert.equal(callText(byId(responses, 3)), S.LOCAL_MCP_OFF);
  assert.match(S.LOCAL_MCP_OFF, /Settings › Connect an AI/);
  assert.equal(dump.activity.length, 0);
});

test('protocol failures stay JSON-RPC: bad lines, unknown methods, batches, unknown tools', async () => {
  const { responses } = await runStdio({ on: true, level: 'edit' }, [
    'this is not json',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'no_such_method' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Notes/Hello.md' } } },
    JSON.stringify([{ jsonrpc: '2.0', id: 3, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/tick' }]),
  ]);
  const bad = responses[0];
  assert.equal(bad.error.code, -32700);
  assert.equal(bad.id, null);
  assert.equal(byId(responses, 1).result.isError, true, 'an unknown tool is a tool error, not a broken connection');
  assert.match(callText(byId(responses, 1)), /no tool called/);
  assert.equal(byId(responses, 2).error.code, -32601);
  const batch = responses.find((r) => Array.isArray(r));
  assert.equal(batch.length, 1, 'the batch’s notification is dropped, its ping answered');
  assert.deepEqual(batch[0], { jsonrpc: '2.0', id: 3, result: {} });
});

// ── the fixed tools and set-up JSON ───────────────────────────────────────────────────────────────────────────────────

test('the catalogue: every agent tool but folder deletes, plus add a task and the MCP-only tools', () => {
  for (const n of FIXED7) assert.ok(S.LOCAL_MCP_TOOL_NAMES.includes(n), `${n} is served`);
  assert.ok(!S.LOCAL_MCP_TOOL_NAMES.includes('folder_delete'), 'no folder deletes');
  const add = S.localMcpDef('note_add_task');
  assert.equal(add.level, 'edit');
  assert.deepEqual(add.required, ['path', 'text']);
  const tool = S.mcpToolOf(add);
  assert.equal(tool.inputSchema.type, 'object');
  assert.equal(tool.inputSchema.additionalProperties, false);
  const read = S.localMcpTools({ on: true, level: 'read' });
  assert.ok(read.length > 20 && read.every((d) => d.level === 'read'));
  assert.equal(S.localMcpTools({ on: true, level: 'edit' }).length, S.LOCAL_MCP_TOOL_NAMES.length);
  assert.equal(S.localMcpTools({ on: false, level: 'read' }).length, read.length, 'off still lists the read ones, so set-up reads right');
  assert.equal(S.localMcpAllows({ on: true, level: 'read' }, { name: 'x', level: 'read' }), true);
  assert.equal(S.localMcpAllows({ on: true, level: 'read' }, { name: 'x', level: 'edit' }), false);
  assert.equal(S.localMcpAllows({ on: true, level: 'edit' }, { name: 'note_delete', level: 'edit', deletes: true }), true, 'a delete goes to the Bin, with Undo');
  assert.equal(S.localMcpAllows({ on: true, level: 'edit' }, { name: 'folder_delete', level: 'full', deletes: true }), false, 'never a whole folder');
  assert.equal(S.localMcpAllows({ on: false, level: 'edit' }, { name: 'x', level: 'read' }), false);
});

test('the set-up JSON: the exact shape each app takes, with the real path', () => {
  const cmd = 'C:\\Users\\MadeUp\\AppData\\Roaming\\Ironleaf\\bin\\ironleaf.cmd';
  assert.deepEqual(JSON.parse(S.mcpSetupJson('claude-code', cmd)), { mcpServers: { ironleaf: { command: cmd, args: ['mcp'] } } });
  assert.deepEqual(JSON.parse(S.mcpSetupJson('claude-desktop', cmd)), { mcpServers: { ironleaf: { command: cmd, args: ['mcp'] } } });
  assert.deepEqual(JSON.parse(S.mcpSetupJson('cursor', cmd)), { mcpServers: { ironleaf: { command: cmd, args: ['mcp'] } } });
  assert.deepEqual(JSON.parse(S.mcpSetupJson('vscode', cmd)), { servers: { ironleaf: { type: 'stdio', command: cmd, args: ['mcp'] } } });
  assert.ok(S.mcpSetupJson('claude-desktop', cmd).includes('C:\\\\Users\\\\MadeUp'), 'backslashes escaped as JSON needs');
  assert.deepEqual(S.MCP_SETUP_APPS.map((a) => a.id), ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'chatgpt', 'other']);
  for (const a of S.MCP_SETUP_APPS) assert.ok(a.file && a.words, `${a.id} says where to paste`);
});

// ── the app's own dispatch, through asLocalMcp ────────────────────────────────────────────────────────────────────────
// The notes in memory, and Ironleaf's steps as the app takes them (as tests/agent-access.test.mjs keeps them).

const STUDIO = 'Projects/Studio Upgrade/Studio Upgrade.md';
const WINTER = 'Projects/Winter Menu Launch/Winter Menu Launch.md';
const NOTES = {
  [STUDIO]: `---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 80\nowner: Sam Taylor\ndue: "2026-11-20"\n---\n# Studio Upgrade\n\n## Summary\n\nThe studio gets a new mixing desk, new speakers and soundproofing before the summer bookings.\n\n## What’s next\n\n- [ ] Send the reconciliation v4 to finance — Sam Taylor · by 14 Oct 2026\n`,
  [WINTER]: `---\ntype: project\nstatus: active\nhealth: on track\nprogress: 60\nowner: Alex Lee\n---\n# Winter Menu Launch\n\n## Summary\n\nThe bakery’s winter menu: new soups and the website page.\n\n## What’s next\n\n- [ ] Photograph the soups — Alex Lee\n`,
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios.\n',
};

function makeHost(dataDir, overrides = {}) {
  const index = new A.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new A.Projects(index);
  const history = new A.ProjectHistory();
  const trashed = [];
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async () => {},
    move: async () => {
      throw new Error('no moves here');
    },
    trash: async () => {},
    clean,
    today: () => 'Saturday 17 October 2026 (2026-10-17)',
  };
  const host = {
    dataDir,
    kind: 'embedded',
    ready: async () => {},
    library: () => '/made-up/library',
    index,
    notes,
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async (rel) => {
      const before = index.content(rel);
      return { file: rel, words: 'made', before, after: before };
    },
    createProject: async (name) => {
      const rel = `Projects/${name}/${name}.md`;
      await writeNote(rel, `---\ntype: project\nstatus: planning\n---\n# ${name}\n`);
      return rel;
    },
    writeNote,
    trash: async (rel) => {
      trashed.push(rel);
      files.delete(rel);
      reindex(rel);
    },
    today: () => A.todayData(index, { path: 'Daily/2026-10-17.md', exists: false }),
    dailyPath: () => 'Daily/2026-10-17.md',
    dailyNote: async () => {
      if (!files.has('Daily/2026-10-17.md')) await writeNote('Daily/2026-10-17.md', '# 17 October\n');
      return 'Daily/2026-10-17.md';
    },
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    changed: () => {},
    ...overrides,
  };
  return { host, files, trashed };
}

const TASKS_VIEW = {
  today: '2026-10-17',
  tasks: [
    { key: 'a', path: STUDIO, title: 'Studio Upgrade', line: 11, project: STUDIO, projectName: 'Studio Upgrade', people: [], allTags: [], mtime: 0, done: false, mark: ' ', text: 'Send the reconciliation v4 to finance', words: 'Send the reconciliation v4 to finance', due: '2026-10-14', time: null, reminder: false, repeats: false, tags: [], links: [] },
    { key: 'b', path: 'Notes/Oven service.md', title: 'Oven service', line: 3, project: null, projectName: null, people: [], allTags: [], mtime: 0, done: false, mark: ' ', text: 'Book the oven service', words: 'Book the oven service', due: '2026-11-02', time: null, reminder: false, repeats: false, tags: [], links: [] },
  ],
};

/** One switched-on pack behind the production path (a fixture pack, like the fixture vault's). */
function packOverrides(records) {
  return {
    gate: (who, name) => ({ who, name, key: () => 'test', level: () => 'open', sees: () => true, allowsLevel: () => true, check: () => {}, note: () => {}, listed: () => {} }),
    modules: {
      tools: () => [
        { name: 'testpack_records', title: 'Test pack records', level: 'read', readOnly: true, description: 'List the test pack’s records (a fixture pack for the local MCP tests).', input: { pack: { type: 'string', description: 'The pack.' } }, required: ['pack'] },
        { name: 'testpack_record_add', title: 'Add a test pack record', level: 'edit', description: 'Add a record to the test pack.', input: { pack: { type: 'string', description: 'The pack.' }, title: { type: 'string', description: 'The record’s title.' } }, required: ['pack', 'title'] },
      ],
      call: async (_gate, name, a) => {
        if (name === 'testpack_records') return { text: JSON.stringify({ records }) };
        if (name === 'testpack_record_add') {
          const record = { id: `r${records.length + 1}`, title: String(a.title ?? '').trim() };
          records.push(record);
          return { text: `Added “${record.title}”.`, done: { words: `Added “${record.title}” to the test pack.` } };
        }
        throw new Error(`There is no tool called ${name}.`);
      },
    },
  };
}

let n = 0;
async function setup(overrides = {}) {
  const dataDir = path.join(work, `access-${++n}`);
  const t = makeHost(dataDir, { tasks: () => TASKS_VIEW, ...overrides });
  const access = new A.AgentAccess(t.host, {});
  access.load();
  return { ...t, access, dataDir };
}
const words = (r) => r.content.map((c) => c.text).join('\n');

test('off until switched on, and the switch is kept', async () => {
  const { access } = await setup();
  assert.deepEqual(access.localMcpSettings(), { on: false, level: 'read' });
  const refused = await access.asLocalMcp('note_read', { path: 'Notes/Oven service.md' });
  assert.equal(refused.isError, true);
  assert.equal(words(refused), S.LOCAL_MCP_OFF);
  const state = await access.setLocalMcp({ on: true });
  assert.deepEqual(state.localMcp, { on: true, level: 'read' });
  await access.flush();
});

test('reads through the app’s dispatch, Private notes never readable', async () => {
  const { access } = await setup();
  await access.setLocalMcp({ on: true });
  assert.match(words(await access.asLocalMcp('note_read', { path: 'Notes/Oven service.md' })), /serviced every March/);
  const diary = await access.asLocalMcp('note_read', { path: 'Private notes/Diary.md' });
  assert.equal(diary.isError, true);
  assert.match(words(diary), /Private notes are never open/);
  assert.doesNotMatch(words(await access.asLocalMcp('vault_search', { query: 'sourdough' })), /ratios/);
  assert.match(words(await access.asLocalMcp('projects_list', {})), /Studio Upgrade/);
  assert.equal(JSON.parse(words(await access.asLocalMcp('tasks_list', {}))).count, 2);
  const missing = await access.asLocalMcp('no_such_tool', {});
  assert.equal(missing.isError, true);
  assert.match(words(missing), /no tool called/);
});

test('Read only refuses writes; Read and write logs them with Undo, and the Undo restores', async () => {
  const { access, files } = await setup();
  await access.setLocalMcp({ on: true });
  assert.ok(access.localMcpTools().every((t) => t.annotations.readOnlyHint), 'Read only lists the read tools');
  const refused = await access.asLocalMcp('note_create', { path: 'Notes/No.md', content: 'x' });
  assert.equal(refused.isError, true);
  assert.equal(words(refused), S.LOCAL_MCP_READONLY);
  await access.setLocalMcp({ level: 'edit' });
  assert.deepEqual(access.localMcpTools().map((t) => t.name), [...S.LOCAL_MCP_TOOL_NAMES]);
  const made = await access.asLocalMcp('note_create', { path: 'Notes/Made.md', content: '# Made\n' });
  assert.ok(!made.isError, words(made));
  assert.equal(files.get('Notes/Made.md'), '# Made\n');
  const appended = await access.asLocalMcp('note_append', { path: 'Notes/Oven service.md', text: 'Booked for March.' });
  assert.ok(!appended.isError, words(appended));
  const tasked = await access.asLocalMcp('note_add_task', { path: 'Notes/Oven service.md', text: 'Order filters' });
  assert.ok(!tasked.isError, words(tasked));
  assert.match(files.get('Notes/Oven service.md'), /- \[ \] Order filters/);
  const activity = (await access.state()).activity;
  assert.equal(activity.length, 3);
  assert.ok(activity.every((e) => e.agentName === 'Other AI apps' && e.canUndo && !e.undone), 'every change logged with Undo');
  // Each Undo restores (in reverse: the task, the append, then the created note is taken away).
  assert.match(await access.undo(activity[0].id), /Undone/);
  assert.doesNotMatch(files.get('Notes/Oven service.md'), /Order filters/);
  assert.match(await access.undo(activity[1].id), /Undone/);
  assert.doesNotMatch(files.get('Notes/Oven service.md'), /Booked for March/);
  assert.match(await access.undo(activity[2].id), /Undone/);
  assert.ok(!files.has('Notes/Made.md'));
});

test('a switched-on pack’s records list and add through the same path', async () => {
  const records = [{ id: 'r1', title: 'First record' }];
  const { access } = await setup(packOverrides(records));
  await access.setLocalMcp({ on: true, level: 'edit' });
  assert.deepEqual(access.localMcpTools().map((t) => t.name), [...S.LOCAL_MCP_TOOL_NAMES, 'testpack_records', 'testpack_record_add']);
  assert.equal(JSON.parse(words(await access.asLocalMcp('testpack_records', { pack: 'x' }))).records.length, 1);
  const added = await access.asLocalMcp('testpack_record_add', { pack: 'x', title: 'Second record' });
  assert.ok(!added.isError, words(added));
  assert.equal(records.length, 2);
  const activity = (await access.state()).activity;
  assert.equal(activity.length, 1);
  assert.equal(activity[0].agentName, 'Other AI apps');
  await access.setLocalMcp({ level: 'read' });
  assert.deepEqual(access.localMcpTools().filter((t) => t.name.startsWith('testpack')).map((t) => t.name), ['testpack_records']);
  const refused = await access.asLocalMcp('testpack_record_add', { pack: 'x', title: 'Third record' });
  assert.equal(words(refused), S.LOCAL_MCP_READONLY);
});

test('add a task is the local server’s own: agents and the command cannot name it', async () => {
  const { access } = await setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  assert.match(words(await access.asPerson('note_add_task', { path: 'Notes/Oven service.md', text: 'x' })), /There is no command for note_add_task/);
});

// ── the command and the local connection ─────────────────────────────────────────────────────────────────────────────

test('ironleaf mcp parses, and says where to go (the script bridges; the verb is never typed)', async () => {
  const parsed = A.parseCli(['mcp']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.command, { verb: 'mcp' });
  assert.equal(A.parseCli(['mcp', 'extra']).ok, false);
  assert.equal(A.cliWrites({ verb: 'mcp' }), true);
  assert.match(A.cliHelp(), /ironleaf mcp/);
  const said = await Cli.runCliArgs(['mcp'], '', {});
  assert.equal(said.exit, 0);
  assert.match(said.text, /runs from your other AI apps’ set-up, not by hand/);
  assert.match(said.text, /Settings › Connect an AI/);
});

test('the command script bridges stdio to /mcp (before stdin is read as one command’s words)', () => {
  const s = Cli.cliScripts({ exe: 'C:\\MadeUp\\Ironleaf.exe', launchArgs: [], endpointFile: 'C:\\MadeUp\\cli.json', ps1: 'C:\\MadeUp\\bin\\neuralvault.ps1' });
  const ps1 = s.ps1;
  assert.match(ps1, /words\[0\] -eq 'mcp'/);
  assert.ok(ps1.indexOf("-eq 'mcp'") > 0 && ps1.indexOf("-eq 'mcp'") < ps1.indexOf('ReadToEnd'), 'mcp is caught before stdin is read to the end');
  assert.match(ps1, /IsInputRedirected/);
  assert.match(ps1, /ReadLine/);
  assert.match(ps1, /\/mcp/);
  assert.match(ps1, /MCP server is started by your other AI app, not by hand\. Switch it on in Ironleaf \(Settings › Connect an AI\)/);
  assert.match(ps1, /StatusCode -eq 200/);
  assert.match(ps1, /x-neuralvault-cli/);
  assert.match(ps1, /\/cli/, 'the one-shot verbs still post to /cli');
});

test('/mcp answers one message line: answers, notifications, and refusals', async () => {
  const { Readable } = await import('node:stream');
  const file = path.join(work, 'mcp-cli.json');
  const server = new Cli.CliServer({ file, version: 'test', run: async () => ({ exit: 0, text: 'unused' }), mcp: (line) => Server.handleMcpLine({ version: () => 'test', tools: async () => [], call: async () => ({ text: 'called' }) }, line) });
  try {
    const ep = await server.start();
    // Straight into the handler (localhost sockets are proxied in sandboxes, which answers for them instead).
    const send = (method, urlPath, body, headers = {}) =>
      new Promise((resolve, reject) => {
        const req = Readable.from(body ? [Buffer.from(body)] : []);
        req.method = method;
        req.url = urlPath;
        req.headers = { host: `127.0.0.1:${ep.port}`, 'x-neuralvault-cli': ep.token, ...headers };
        const res = { status: 0, text: '', writeHead(s) { this.status = s; }, end(t) { this.text += t ?? ''; resolve(this); } };
        server.answer(req, res, ep.token).catch(reject);
      });
    const init = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {} } });
    const good = await send('POST', '/mcp', init);
    assert.equal(good.status, 200);
    assert.equal(JSON.parse(good.text).id, 7);
    const note = await send('POST', '/mcp', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    assert.equal(note.status, 204);
    assert.equal(note.text, '');
    const wrong = await send('POST', '/mcp', init, { 'x-neuralvault-cli': 'wrong' });
    assert.equal(wrong.status, 403);
    const browser = await send('POST', '/mcp', init, { origin: 'https://made-up.example' });
    assert.equal(browser.status, 403);
    const get = await send('GET', '/mcp');
    assert.equal(get.status, 403);
    const cliPath = await send('POST', '/cli', JSON.stringify({ args: [], stdin: '' }));
    assert.equal(cliPath.status, 200, 'the one-shot verbs still answer on /cli');
  } finally {
    await server.stop();
  }
});
