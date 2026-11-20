// Connect an AI (20 Nov 2026, standalone, workstream B): the MCP server against the app's own dispatch
// (AgentAccess.asLocalMcp), no former host app anywhere. initialize, tools/list (every tool with a schema), a read
// call, a write refused at Read only and allowed at Read and write, the MCP-only tools, note resources, the local URL's
// token, and the "ironleaf mcp" word. Made-up values only.

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'tests', 'tmp', 'mcp-server');
const src = (p) => JSON.stringify(pathToFileURL(path.join(root, p)).href);
let M;

before(async () => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { AgentAccess } from ${src('src/main/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { handleMcpLine } from ${src('src/main/mcp-local.ts')};`,
      `export { McpHttpServer } from ${src('src/main/mcp-http.ts')};`,
      `export { isMcpCommand, runMcpBridge } from ${src('src/main/mcp-bridge.ts')};`,
      `export * from ${src('src/shared/mcp-local.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'bundle.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'bundle.mjs')).href);
}, { timeout: 120000 });
after(() => rmSync(work, { recursive: true, force: true }));

const NOTES = {
  'Notes/Oven service.md': '---\ntags: [bakery]\nstatus: active\n---\n# Oven service\n\nThe deck oven is serviced every March. See [[Suppliers]].\n',
  'Notes/Suppliers.md': '# Suppliers\n\nFlour from the mill. #bakery\n',
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios.\n',
  'People/Mia Tran.md': '---\ntype: person\n---\n# Mia Tran\n\nRuns the mill.\n',
  'Notes/Jobs.md': '# Jobs\n\n- [ ] Order flour\n- [ ] Order yeast\n- [x] Clean the proofer\n',
};

let n = 0;
function setup() {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), Date.now(), files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return !p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..') ? '' : p;
  };
  const host = {
    dataDir: path.join(work, `data-${++n}`),
    kind: 'standalone',
    ready: async () => {},
    library: () => '/made-up/library',
    index,
    notes: {
      index,
      listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
      exists: async (rel) => files.has(rel),
      read: async (rel) => {
        if (!files.has(rel)) throw new Error(`No ${rel}`);
        return files.get(rel);
      },
      write: writeNote,
      makeFolder: async () => {},
      move: async () => {},
      trash: async () => {},
      clean,
      today: () => 'Friday 20 November 2026 (2026-11-20)',
    },
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async (rel) => ({ file: rel, words: 'made', before: '', after: '' }),
    createProject: async (name) => `Projects/${name}/${name}.md`,
    writeNote,
    trash: async (rel) => {
      files.delete(rel);
      reindex(rel);
    },
    today: () => M.todayData(index, { path: 'Daily/2026-11-20.md', exists: false }),
    dailyPath: () => 'Daily/2026-11-20.md',
    dailyNote: async () => 'Daily/2026-11-20.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    changed: () => {},
    tasks: () => ({ today: '2026-11-20', tasks: [] }),
    mcp: {
      versions: async (rel) => (rel === 'Notes/Suppliers.md' ? [{ id: 'v1', time: Date.parse('2026-11-19T10:00:00Z'), size: 20 }] : []),
      version: async (rel, id) => {
        if (rel !== 'Notes/Suppliers.md' || id !== 'v1') throw new Error('No such version.');
        return '# Suppliers\n\nFlour from the old mill.\n';
      },
      bookmarks: async () => [{ type: 'file', path: 'Notes/Oven service.md' }],
    },
  };
  const access = new M.AgentAccess(host, {});
  access.load();
  // The backend exactly as the app gives it (src/main/external.ts mcpBackend).
  const text = (r) => r.content.map((c) => c.text).join('\n');
  const backend = {
    version: () => '9.9.9',
    tools: () => access.localMcpTools(),
    call: async (name, args) => {
      const r = await access.asLocalMcp(name, args);
      return { text: text(r), ...(r.isError ? { isError: true } : {}) };
    },
    resources: () => access.localMcpResources(),
    readResource: (uri) => access.readLocalMcpResource(uri),
  };
  let id = 0;
  const rpc = async (method, params) => JSON.parse(await M.handleMcpLine(backend, JSON.stringify({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) })));
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { access, files, backend, rpc, call };
}
const said = (r) => r.content.map((c) => c.text).join('\n');

test('initialize: the protocol, the server, tools and resources', async () => {
  const { rpc } = setup();
  const r = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.equal(r.serverInfo.name, 'ironleaf');
  assert.equal(r.serverInfo.version, '9.9.9');
  assert.ok(r.capabilities.tools);
  assert.ok(r.capabilities.resources);
  assert.match(r.instructions, /vault_overview/);
});

test('tools/list: every tool has a name, a description and an object schema whose required fields it defines', async () => {
  const { access, rpc } = setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  const tools = (await rpc('tools/list')).result.tools;
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'no name twice');
  assert.ok(tools.length >= 60, `the whole catalogue is served (${tools.length})`);
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]{1,63}$/, `${t.name} is a plain name`);
    assert.ok(typeof t.description === 'string' && t.description.length >= 20, `${t.name} says what it does`);
    assert.equal(t.inputSchema?.type, 'object', `${t.name} has an object schema`);
    assert.equal(typeof t.inputSchema.properties, 'object', `${t.name} lists its properties`);
    for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name}: ${r} is defined`);
    assert.equal(typeof t.annotations?.readOnlyHint, 'boolean');
  }
  // Every vault function a user listed has its tool.
  for (const want of ['note_read', 'note_create', 'note_replace', 'note_append', 'note_move', 'note_rename', 'note_delete', 'vault_search', 'meaning_search', 'note_links', 'graph_neighbours', 'tags_list', 'note_properties', 'note_set_properties', 'tasks_list', 'today_get', 'daily_note', 'templates_list', 'template_apply', 'canvas_get', 'canvas_create', 'bookmarks_list', 'projects_list', 'project_get', 'person_open_items', 'meetings_list', 'reminders_list', 'reminder_set', 'files_search', 'note_attach_file', 'note_to_pdf', 'note_versions', 'note_version_restore']) {
    assert.ok(names.includes(want), `${want} is served`);
  }
  for (const want of ['task_set_done', 'people_list']) assert.ok(names.includes(want), `${want} is served`);
  for (const t of tools) assert.doesNotMatch(JSON.stringify(t), /NeuralSpark/, `${t.name} stands on its own (no host-app words)`);
  for (const never of ['folder_delete']) assert.ok(!names.includes(never), `${never} is not served`);
  await access.setLocalMcp({ level: 'read' });
  const readOnly = (await rpc('tools/list')).result.tools;
  assert.ok(readOnly.length < tools.length && readOnly.every((t) => t.annotations.readOnlyHint), 'Read only lists the read tools only');
});

test('a read call: a note, its links and backlinks, tags and properties; never a Private note', async () => {
  const { access, call } = setup();
  await access.setLocalMcp({ on: true });
  const read = await call('note_read', { path: 'Notes/Oven service.md' });
  assert.ok(!read.isError, said(read));
  assert.match(said(read), /serviced every March/);
  const links = JSON.parse(said(await call('note_links', { path: 'Notes/Suppliers.md' })));
  assert.deepEqual(links.backlinks.map((b) => b.from), ['Notes/Oven service.md']);
  assert.ok(JSON.parse(said(await call('tags_list'))).some((t) => t.tag.replace(/^#/, '') === 'bakery'));
  assert.deepEqual(JSON.parse(said(await call('note_properties', { path: 'Oven service' }))).properties.status, 'active');
  assert.ok(JSON.parse(said(await call('graph_neighbours', { path: 'Notes/Oven service.md' }))).nodes.some((x) => x.path === 'Notes/Suppliers.md'));
  assert.equal(JSON.parse(said(await call('note_versions', { path: 'Notes/Suppliers.md' })))[0].id, 'v1');
  assert.match(said(await call('bookmarks_list')), /Oven service/);
  const diary = await call('note_read', { path: 'Private notes/Diary.md' });
  assert.equal(diary.isError, true);
  assert.doesNotMatch(said(await call('meaning_search', { query: 'sourdough ratios' })), /Secret/);
});

test('a write call is refused at Read only, and nothing changes', async () => {
  const { access, call, files } = setup();
  await access.setLocalMcp({ on: true, level: 'read' });
  const r = await call('note_create', { path: 'Notes/New.md', content: '# New\n' });
  assert.equal(r.isError, true);
  assert.equal(said(r), M.LOCAL_MCP_READONLY);
  assert.ok(!files.has('Notes/New.md'));
  const restore = await call('note_version_restore', { path: 'Notes/Suppliers.md', id: 'v1' });
  assert.equal(restore.isError, true);
  assert.equal((await access.state()).activity.length, 0);
});

test('a write call is allowed at Read and write, logged with Undo, and the Undo restores', async () => {
  const { access, call, files } = setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  const made = await call('note_create', { path: 'Notes/New.md', content: '# New\n' });
  assert.ok(!made.isError, said(made));
  assert.equal(files.get('Notes/New.md'), '# New\n');
  const restored = await call('note_version_restore', { path: 'Notes/Suppliers.md', id: 'v1' });
  assert.ok(!restored.isError, said(restored));
  assert.match(files.get('Notes/Suppliers.md'), /old mill/);
  const activity = (await access.state()).activity;
  assert.equal(activity.length, 2);
  assert.ok(activity.every((e) => e.agentName === M.LOCAL_MCP_NAME && e.canUndo));
  await access.undo(activity[0].id);
  assert.doesNotMatch(files.get('Notes/Suppliers.md'), /old mill/);
});

test('ticking a task: only its box changes, one task named, with Undo; people are listed', async () => {
  const { access, call, files } = setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  const vague = await call('task_set_done', { path: 'Notes/Jobs.md', text: 'Order' });
  assert.equal(vague.isError, true, 'two tasks have that word');
  const ticked = await call('task_set_done', { path: 'Notes/Jobs.md', text: 'Order flour' });
  assert.ok(!ticked.isError, said(ticked));
  assert.equal(files.get('Notes/Jobs.md'), '# Jobs\n\n- [x] Order flour\n- [ ] Order yeast\n- [x] Clean the proofer\n');
  assert.match(said(await call('task_set_done', { path: 'Notes/Jobs.md', text: 'Order flour' })), /already ticked/);
  await call('task_set_done', { path: 'Notes/Jobs.md', text: 'Clean the proofer', done: false });
  assert.match(files.get('Notes/Jobs.md'), /- \[ \] Clean the proofer/);
  const activity = (await access.state()).activity;
  assert.equal(activity.length, 2);
  await access.undo(activity[0].id);
  assert.match(files.get('Notes/Jobs.md'), /- \[x\] Clean the proofer/);
  assert.deepEqual(JSON.parse(said(await call('people_list'))), [{ path: 'People/Mia Tran.md', name: 'Mia Tran' }]);
});

test('off: every call refused with where to switch on; resources list nothing', async () => {
  const { call, rpc } = setup();
  const r = await call('note_read', { path: 'Notes/Oven service.md' });
  assert.equal(r.isError, true);
  assert.equal(said(r), M.LOCAL_MCP_OFF);
  assert.deepEqual((await rpc('resources/list')).result.resources, []);
});

test('notes as resources: listed without Private notes, and read', async () => {
  const { access, rpc } = setup();
  await access.setLocalMcp({ on: true });
  const list = (await rpc('resources/list')).result.resources;
  assert.ok(list.some((x) => x.uri === 'ironleaf://note/Notes/Oven%20service.md'));
  assert.ok(!list.some((x) => /Private/.test(x.uri)));
  const read = (await rpc('resources/read', { uri: 'ironleaf://note/Notes/Oven%20service.md' })).result;
  assert.match(read.contents[0].text, /serviced every March/);
  const priv = await rpc('resources/read', { uri: 'ironleaf://note/Private%20notes/Diary.md' });
  assert.ok(priv.error);
});

test('the local URL: Streamable HTTP with a Bearer token, on this PC only', async () => {
  const { access, backend } = setup();
  await access.setLocalMcp({ on: true });
  const server = new M.McpHttpServer({ dataDir: path.join(work, 'http'), backend: () => backend });
  const port = 47731;
  const send = (method, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = Readable.from(body ? [Buffer.from(body)] : []);
      req.method = method;
      req.url = '/mcp';
      req.headers = { host: `127.0.0.1:${port}`, authorization: `Bearer ${server.token}`, ...headers };
      const res = { status: 0, headers: {}, text: '', writeHead(s, h) { this.status = s; this.headers = h ?? {}; }, end(t) { this.text += t ?? ''; resolve(this); } };
      server.answer(req, res, port).catch(reject);
    });
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {} } });
  const good = await send('POST', init);
  assert.equal(good.status, 200);
  assert.equal(JSON.parse(good.text).result.serverInfo.name, 'ironleaf');
  assert.ok(good.headers['mcp-session-id']);
  const list = await send('POST', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  assert.ok(JSON.parse(list.text).result.tools.length > 10);
  assert.equal((await send('POST', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  assert.equal((await send('POST', init, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await send('POST', init, { authorization: '' })).status, 401);
  assert.equal((await send('POST', init, { origin: 'https://made-up.example' })).status, 403);
  assert.equal((await send('POST', init, { host: 'made-up.example' })).status, 403);
  assert.equal((await send('GET')).status, 405);
  assert.ok(server.token.length >= 32);
  const old = server.token;
  await server.newToken();
  assert.notEqual(server.token, old);
  assert.equal(server.view(port).url, 'http://127.0.0.1:47731/mcp');
});

test('the set-up: stdio for every app, the URL with its token where an app takes one', () => {
  const cmd = '/opt/Ironleaf/Ironleaf.AppImage';
  const http = { url: 'http://127.0.0.1:47731/mcp', token: 'made-up-token' };
  assert.deepEqual(JSON.parse(M.mcpSetupJson('claude-desktop', cmd, http)), { mcpServers: { ironleaf: { command: cmd, args: ['mcp'] } } });
  assert.deepEqual(JSON.parse(M.mcpSetupJson('claude-code', cmd, http)), { mcpServers: { ironleaf: { type: 'http', url: http.url, headers: { Authorization: 'Bearer made-up-token' } } } });
  assert.deepEqual(JSON.parse(M.mcpSetupJson('vscode', cmd, http)).servers.ironleaf.type, 'http');
  assert.deepEqual(JSON.parse(M.mcpSetupJson('cursor', cmd, http)).mcpServers.ironleaf.url, http.url);
  assert.equal(JSON.parse(M.mcpSetupJson('chatgpt', cmd, http)).url, http.url);
  assert.equal(M.mcpClaudeCodeCommand(cmd), `claude mcp add ironleaf -- ${cmd} mcp`);
  assert.match(M.mcpClaudeCodeCommand(cmd, http), /--transport http ironleaf http:\/\/127\.0\.0\.1:47731\/mcp --header "Authorization: Bearer made-up-token"/);
});

test('"Ironleaf mcp" is the bridge word, installed or in development', () => {
  assert.equal(M.isMcpCommand(['/opt/Ironleaf', 'mcp'], true), true);
  assert.equal(M.isMcpCommand(['/usr/bin/electron', '.', 'mcp'], false), true);
  assert.equal(M.isMcpCommand(['/opt/Ironleaf', '--no-sandbox', 'mcp'], true), true);
  assert.equal(M.isMcpCommand(['/opt/Ironleaf'], true), false);
  assert.equal(M.isMcpCommand(['/opt/Ironleaf', 'notes/mcp.md'], true), false);
});

test('the local URL over a real socket: initialize, tools/list and a call with the token; refused without it', async () => {
  const { access, backend } = setup();
  await access.setLocalMcp({ on: true });
  const server = new M.McpHttpServer({ dataDir: path.join(work, 'http-real'), backend: () => backend });
  await server.sync({ on: true, port: 0 });
  try {
    const url = `http://127.0.0.1:${server.port}/mcp`;
    const post = (body, token = server.token) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    assert.equal(init.status, 200);
    assert.equal((await init.json()).result.serverInfo.name, 'ironleaf');
    const tools = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools;
    assert.ok(tools.length > 30 && tools.every((t) => t.inputSchema.type === 'object'));
    const read = (await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_read', arguments: { path: 'Notes/Suppliers.md' } } })).json()).result;
    assert.match(said(read), /Flour from the mill/);
    assert.equal((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, 'wrong')).status, 401);
  } finally {
    await server.stop();
  }
  assert.equal(server.port, null);
});

test('the stdio bridge: each stdin line posted to the running app, each answer one line on stdout', async () => {
  const { access, backend } = setup();
  await access.setLocalMcp({ on: true, level: 'read' });
  const secret = 'made-up-secret';
  const app = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp' || req.headers['x-neuralvault-cli'] !== secret) return void res.writeHead(403).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await M.handleMcpLine(backend, Buffer.concat(chunks).toString('utf8'));
    if (out === null) return void res.writeHead(204).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(out);
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const endpointFile = path.join(work, 'bridge-cli.json');
  writeFileSync(endpointFile, JSON.stringify({ port: app.address().port, token: secret }));
  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let got = '';
    output.on('data', (d) => (got += d));
    const done = M.runMcpBridge({ endpointFile, input, output, waitMs: 500 });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_create', arguments: { path: 'Notes/No.md', content: 'x' } } })}\n`);
    input.end();
    await done;
    const lines = got.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.id), [1, 2, 3], 'answers in order, the notification unanswered');
    assert.equal(lines[0].result.serverInfo.name, 'ironleaf');
    assert.ok(lines[1].result.tools.length > 30);
    assert.equal(lines[2].result.isError, true);
    assert.equal(said(lines[2].result), M.LOCAL_MCP_READONLY);
  } finally {
    await new Promise((r) => app.close(r));
  }
  // Ironleaf not running and not startable: said in words, as a JSON-RPC error.
  const input = new PassThrough();
  const output = new PassThrough();
  let got = '';
  output.on('data', (d) => (got += d));
  const done = M.runMcpBridge({ endpointFile: path.join(work, 'none.json'), input, output, waitMs: 100 });
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })}\n`);
  await done;
  assert.match(JSON.parse(got).error.message, /Open Ironleaf/);
});

test('docs/MCP.md names every tool and every app', () => {
  const doc = readFileSync(path.join(root, 'docs', 'MCP.md'), 'utf8');
  for (const name of M.LOCAL_MCP_TOOL_NAMES) assert.ok(doc.includes(`\`${name}\``), `${name} is in docs/MCP.md`);
  assert.ok(doc.includes(`## The tools (${M.LOCAL_MCP_TOOL_NAMES.length})`), 'the count is right');
  for (const app of ['Claude Desktop', 'Claude Code', 'Cursor', 'VS Code', 'ChatGPT desktop', 'Any other MCP app']) assert.ok(doc.includes(`### ${app}`), `${app} has its set-up`);
});
