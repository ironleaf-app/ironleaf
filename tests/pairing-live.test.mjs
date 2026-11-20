// node --test tests/pairing-live.test.mjs — live pairing (V9 pause/disconnect, V10 Notion, V11 Todoist), 29 Oct 2026:
// stand-in Notion and Todoist servers on this PC answer the published API shapes, so no real network and no real
// token is ever used. A change made here is sent back, a change on both sides is never overwritten quietly, a
// paused pairing does nothing, and disconnecting keeps every note that came in. The made-up token must appear in
// no vault file.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The stand-ins live on this PC: no proxy stands between the test and them.
process.env.NO_PROXY = [...(process.env.NO_PROXY ? [process.env.NO_PROXY] : []), '127.0.0.1', 'localhost'].join(',');
process.env.no_proxy = process.env.NO_PROXY;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pairing-live-'));
const TOKEN = 'made-up-token-12345';
let E, L, FM;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as E from ${JSON.stringify(path.join(root, 'src/main/pairing/engine.ts'))};`,
    `export * as L from ${JSON.stringify(path.join(root, 'src/main/pairing/live.ts'))};`,
    `export * as FM from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
  ].join('\n'));
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'live.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ E, L, FM } = await import(pathToFileURL(path.join(work, 'live.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const freshVault = () => { const v = path.join(work, `vault-${++n}`); mkdirSync(v, { recursive: true }); return v; };
const read = (v, rel) => readFileSync(path.join(v, ...rel.split('/')), 'utf8');
const has = (v, rel) => existsSync(path.join(v, ...rel.split('/')));
const walkFiles = (v) => { const out = []; const go = (rel) => { for (const e of readdirSync(rel ? path.join(v, ...rel.split('/')) : v, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) go(r); else out.push(r); } }; go(''); return out; };
const assertNoToken = (v) => { for (const r of walkFiles(v)) assert.doesNotMatch(readFileSync(path.join(v, ...r.split('/')), 'utf8'), new RegExp(TOKEN), `token leaked into ${r}`); };
const listen = (handler) => new Promise((resolve) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` })); });
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const authed = (req, res) => { if (req.headers.authorization !== `Bearer ${TOKEN}`) { json(res, 401, { code: 'unauthorized' }); return false; } return true; };
const bodyOf = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b ? JSON.parse(b) : {})); });

// ── Notion stand-in ────────────────────────────────────────────────────────────────────────────────────────────
function notionStandIn(state) {
  return listen(async (req, res) => {
    if (!authed(req, res)) return;
    const url = req.url;
    if (req.method === 'POST' && url === '/v1/search') return json(res, 200, { results: [
      { object: 'page', id: 'page-home', properties: { Name: { type: 'title', title: [{ plain_text: 'Home page' }] } } },
      { object: 'database', id: 'db1', title: [{ plain_text: 'Tasks' }], properties: { Name: { type: 'title' }, Status: { type: 'status' }, Due: { type: 'date' } } },
    ], has_more: false });
    if (req.method === 'POST' && url === '/v1/databases/db1/query') return json(res, 200, { results: [
      { object: 'page', id: 'row-1', properties: {
        Name: { type: 'title', title: [{ plain_text: state.title }] },
        Status: { type: 'status', status: { name: state.status } },
        Due: { type: 'date', date: { start: '2026-11-02' } },
      } },
    ], has_more: false });
    if (req.method === 'GET' && url.startsWith('/v1/blocks/') && url.endsWith('/children?page_size=100')) {
      const id = url.split('/')[3];
      return json(res, 200, { results: id === 'row-1' ? [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: state.body }] } }] : [], has_more: false });
    }
    if (req.method === 'GET' && url === '/v1/pages/row-1') return json(res, 200, { object: 'page', id: 'row-1', properties: { Name: { type: 'title', title: [] }, Status: { type: 'status', status: { name: state.status } }, Due: { type: 'date', date: null } } });
    if (req.method === 'PATCH' && url === '/v1/pages/row-1') { state.patched = await bodyOf(req); if (state.patched.properties?.Status?.status?.name) state.status = state.patched.properties.Status.status.name; return json(res, 200, { object: 'page', id: 'row-1' }); }
    return json(res, 404, { code: 'not_found' });
  });
}

test('Notion live: pages and a database come in, a change here is sent back, both-changed is never overwritten', async () => {
  const state = { title: 'Write report', status: 'Doing', body: 'Draft the report.' };
  const { server, base } = await notionStandIn(state);
  try {
    const v = freshVault();
    const at = { now: new Date(2026, 9, 29, 10, 0), base };
    let summary = await L.syncLive(v, 'notion', TOKEN, at);
    assert.equal(summary.added, 2);
    assertNoToken(v);
    const rel = 'From Notion/Live/Tasks/Write report.md';
    assert.ok(has(v, rel));
    assert.equal(FM.readProps(read(v, rel)).Status, 'Doing');
    assert.ok(has(v, 'From Notion/Live/Tasks.view.json'), 'the database becomes a view');
    // Only here changed: sent back, agreed, no copy.
    writeFileSync(path.join(v, ...rel.split('/')), read(v, rel).replace('Status: Doing', 'Status: Done'));
    summary = await L.syncLive(v, 'notion', TOKEN, at);
    assert.equal(state.patched.properties.Status.status.name, 'Done');
    assert.equal(summary.sent, 1);
    assert.equal(summary.conflicts.length, 0);
    // Both changed: yours kept, theirs beside it.
    writeFileSync(path.join(v, ...rel.split('/')), read(v, rel) + '\nMy extra line.\n');
    state.body = 'Draft the report. With charts.';
    summary = await L.syncLive(v, 'notion', TOKEN, at);
    assert.equal(summary.conflicts.length, 1);
    assert.match(read(v, rel), /My extra line/);
    assertNoToken(v);
  } finally { server.close(); }
});

test('a refused token is said plainly and the token is in no error and no file', async () => {
  const { server, base } = await notionStandIn({ title: 'X', status: 'Doing', body: '' });
  try {
    const v = freshVault();
    await assert.rejects(L.syncLive(v, 'notion', 'wrong-token', { base }), /Notion did not accept that token/);
    assert.deepEqual(walkFiles(v), []);
  } finally { server.close(); }
});

test('pause stops a sync doing anything, resume lets it through, disconnect keeps what came in', async () => {
  const state = { title: 'Write report', status: 'Doing', body: 'Draft.' };
  const { server, base } = await notionStandIn(state);
  try {
    const v = freshVault();
    await L.syncLive(v, 'notion', TOKEN, { base });
    const id = E.pairIdFor('notion', 'From Notion/Live');
    await E.setPairPaused(v, id, true);
    assert.equal((await E.listPairs(v))[0].paused, true);
    await assert.rejects(L.syncLive(v, 'notion', TOKEN, { base }), /is paused\. Resume it/);
    await E.setPairPaused(v, id, false);
    const again = await L.syncLive(v, 'notion', TOKEN, { base });
    assert.equal(again.same + again.updated + again.added >= 1, true);
    await E.disconnectPair(v, id);
    assert.deepEqual(await E.listPairs(v), [], 'a disconnected pairing is no longer listed');
    assert.ok(has(v, 'From Notion/Live/Tasks/Write report.md'), 'what came in stays');
    assertNoToken(v);
  } finally { server.close(); }
});

// ── Import uplift (9.5, nv-import F21): live reads say what they could not bring ───────────────────────────────────

test('F21: live Notion pictures, deep nesting and odd blocks are said per page', async () => {
  const { server, base } = await listen(async (req, res) => {
    if (!authed(req, res)) return;
    const url = req.url;
    if (req.method === 'POST' && url === '/v1/search') return json(res, 200, { results: [{ object: 'page', id: 'p1', properties: { Name: { type: 'title', title: [{ plain_text: 'Spec' }] } } }], has_more: false });
    if (req.method === 'GET' && url === '/v1/blocks/p1/children?page_size=100') return json(res, 200, { results: [
      { type: 'paragraph', id: 'b1', paragraph: { rich_text: [{ plain_text: 'Start.' }] }, has_children: true },
      { type: 'image', id: 'b2', image: { caption: [] } },
      { type: 'table', id: 'b3', table: {} },
    ], has_more: false });
    if (req.method === 'GET' && url === '/v1/blocks/b1/children?page_size=100') return json(res, 200, { results: [{ type: 'paragraph', id: 'b1a', paragraph: { rich_text: [{ plain_text: 'Level 1.' }] }, has_children: true }], has_more: false });
    if (req.method === 'GET' && url === '/v1/blocks/b1a/children?page_size=100') return json(res, 200, { results: [{ type: 'paragraph', id: 'b1b', paragraph: { rich_text: [{ plain_text: 'Level 2.' }] }, has_children: true }], has_more: false });
    if (req.method === 'GET' && url === '/v1/blocks/b1b/children?page_size=100') return json(res, 200, { results: [{ type: 'paragraph', id: 'b1c', paragraph: { rich_text: [{ plain_text: 'Level 3.' }] }, has_children: true }], has_more: false });
    if (req.method === 'GET' && url === '/v1/blocks/b1c/children?page_size=100') return json(res, 200, { results: [{ type: 'paragraph', id: 'b1d', paragraph: { rich_text: [{ plain_text: 'Level 4, too deep.' }] } }], has_more: false });
    return json(res, 404, { code: 'not_found' });
  });
  try {
    const v = freshVault();
    const summary = await L.syncLive(v, 'notion', TOKEN, { base });
    assert.equal(summary.added, 1);
    assert.ok(summary.skipped.some((s) => s.what === 'Spec' && /picture or file/.test(s.why)), `pictures said: ${JSON.stringify(summary.skipped)}`);
    assert.ok(summary.skipped.some((s) => s.what === 'Spec' && /deeper than 3/.test(s.why)), `depth said: ${JSON.stringify(summary.skipped)}`);
    assert.ok(summary.skipped.some((s) => s.what === 'Spec' && /table/.test(s.why)), `tables said: ${JSON.stringify(summary.skipped)}`);
    assert.match(read(v, 'From Notion/Live/Spec.md'), /Start\./);
    assertNoToken(v);
  } finally { server.close(); }
});

// ── Todoist stand-in ───────────────────────────────────────────────────────────────────────────────────────────
test('Todoist live: tasks come in under their project, and due, priority and Done go back', async () => {
  const sent = [];
  const { server, base } = await listen(async (req, res) => {
    if (!authed(req, res)) return;
    if (req.method === 'GET' && req.url === '/projects') return json(res, 200, [{ id: 'p1', name: 'Home jobs' }]);
    if (req.method === 'GET' && req.url === '/tasks') return json(res, 200, [{ id: 't1', project_id: 'p1', content: 'Fix the gate', description: 'Latch is loose.', due: { date: '2026-11-03' }, priority: 3, labels: ['outside'] }]);
    if (req.method === 'POST' && req.url === '/tasks/t1') { sent.push(await bodyOf(req)); return json(res, 200, { id: 't1' }); }
    if (req.method === 'POST' && req.url === '/tasks/t1/close') { sent.push({ closed: true }); res.writeHead(204); return res.end(); }
    return json(res, 404, {});
  });
  try {
    const v = freshVault();
    let summary = await L.syncLive(v, 'todoist', TOKEN, { base });
    assert.equal(summary.added, 1);
    const rel = 'From Todoist/Live/Home jobs/Fix the gate.md';
    const props = FM.readProps(read(v, rel));
    assert.equal(props.Due, '2026-11-03');
    assert.equal(props.Priority, 'High');
    assert.match(read(v, rel), /Latch is loose/);
    // Change Due and Priority, and tick it done (Done as a property in the block at the top).
    writeFileSync(path.join(v, ...rel.split('/')), read(v, rel).replace('Due: 2026-11-03', 'Due: 2026-11-05').replace(/^(Priority: .*)$/m, '$1\nDone: true').replace('Priority: High', 'Priority: Highest'));
    summary = await L.syncLive(v, 'todoist', TOKEN, { base });
    assert.ok(sent.some((b) => b.due_date === '2026-11-05' && b.priority === 4), `sent back: ${JSON.stringify(sent)}`);
    assert.ok(sent.some((b) => b.closed === true), 'ticking Done closes the task');
    assert.equal(summary.conflicts.length, 0);
    assertNoToken(v);
  } finally { server.close(); }
});

test('F22: a Todoist rename and new labels here are sent back', async () => {
  const sent = [];
  const { server, base } = await listen(async (req, res) => {
    if (!authed(req, res)) return;
    if (req.method === 'GET' && req.url === '/projects') return json(res, 200, [{ id: 'p1', name: 'Home jobs' }]);
    if (req.method === 'GET' && req.url === '/tasks') return json(res, 200, [{ id: 't1', project_id: 'p1', content: 'Fix the gate', description: '', priority: 1, labels: [] }]);
    if (req.method === 'POST' && req.url === '/tasks/t1') { sent.push(await bodyOf(req)); return json(res, 200, { id: 't1' }); }
    return json(res, 404, {});
  });
  try {
    const v = freshVault();
    await L.syncLive(v, 'todoist', TOKEN, { base });
    const from = path.join(v, 'From Todoist', 'Live', 'Home jobs', 'Fix the gate.md');
    const to = path.join(v, 'From Todoist', 'Live', 'Home jobs', 'Fix the side gate.md');
    const text = readFileSync(from, 'utf8').replace('---\n', '---\ntags:\n  - urgent\n');
    rmSync(from);
    writeFileSync(to, text);
    await L.syncLive(v, 'todoist', TOKEN, { base });
    assert.ok(sent.some((b) => b.content === 'Fix the side gate'), `renamed: ${JSON.stringify(sent)}`);
    assert.ok(sent.some((b) => Array.isArray(b.labels) && b.labels.includes('urgent')), `labels: ${JSON.stringify(sent)}`);
    assertNoToken(v);
  } finally { server.close(); }
});

// v4-no-clutter item 2: a live sync with more than a handful of notes says so first, and one Undo takes it back.
test('Todoist live: 14 new tasks hold for confirmation, then undo whole', async () => {
  const tasks = Array.from({ length: 14 }, (_, k) => ({ id: `t${k + 1}`, project_id: 'p1', content: `Job ${k + 1}`, description: '', priority: 1, labels: [] }));
  const { server, base } = await listen(async (req, res) => {
    if (!authed(req, res)) return;
    if (req.method === 'GET' && req.url === '/projects') return json(res, 200, [{ id: 'p1', name: 'Home jobs' }]);
    if (req.method === 'GET' && req.url === '/tasks') return json(res, 200, tasks);
    return json(res, 404, {});
  });
  try {
    const v = freshVault();
    const held = await L.syncLive(v, 'todoist', TOKEN, { base });
    assert.equal(held.held, true, 'held: nothing written yet');
    assert.match(held.words, /this will add 14 notes, from the check just now/i, 'said first, in words');
    assert.equal(has(v, 'From Todoist/Live/Home jobs/Job 1.md'), false, 'nothing written while held');
    const done = await L.syncLive(v, 'todoist', TOKEN, { base, confirmed: held.check });
    assert.equal(done.added, 14, 'confirmed: 14 notes added');
    const trash = async (rel) => {
      const to = path.join(v, 'Bin', ...rel.split('/'));
      mkdirSync(path.dirname(to), { recursive: true });
      renameSync(path.join(v, ...rel.split('/')), to);
    };
    const back = await E.undoImport(v, done.pairId, { trash });
    assert.equal(back.notes, 14, 'one Undo takes all 14 back');
    assert.equal(has(v, 'From Todoist/Live/Home jobs/Job 1.md'), false, 'gone from the notes');
    assertNoToken(v);
  } finally { server.close(); }
});
