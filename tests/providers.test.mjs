// node --test tests/providers.test.mjs — Ironleaf's models are the person's own connections (Anthropic, OpenAI, Google
// Gemini, a local Ollama, any OpenAI-compatible address): kept in connections.json with no key in it, each one's model
// mapped for pi-ai 0.87.1, a reply streamed for each format, the provider's models listed, and speech written down,
// all against a local test server. Nothing reaches a real provider. The TypeScript is bundled with rolldown.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-providers-'));
let P; // the bundled providers module
const servers = [];

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href).catch(() => import('rolldown'));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/providers/index.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/providers/connections.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/providers/pi-model.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: [/^@earendil-works\//, 'electron'], output: { file: path.join(work, 'providers.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  // The bundle imports pi-ai from the repo's node_modules.
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', '@earendil-works'), path.join(work, 'node_modules', '@earendil-works'), 'junction'); } catch {}
  P = await import(pathToFileURL(path.join(work, 'providers.mjs')).href);
});
after(() => {
  for (const s of servers) s.close();
  rmSync(work, { recursive: true, force: true });
});

// Keys as the KeyStore keeps them (in memory here).
const fakeKeys = (keys = {}) => ({ keys, has: (id) => Object.hasOwn(keys, id), get: (id) => keys[id], set: async (id, key) => void (keys[id] = String(key).trim()), remove: async (id) => void delete keys[id] });

// A connections.json as Ironleaf writes it, with a model's reasoning levels declared by hand.
function saved(dir, port) {
  mkdirSync(dir, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  writeFileSync(path.join(dir, 'connections.json'), JSON.stringify({ version: 1, connections: [
    { id: 'c-chat', name: 'Test completions', kind: 'custom', baseURL: `${base}/v1`, api: 'openai-completions', noAuth: false, models: [{ id: 'chat-1', name: 'Chat One', contextWindow: 65536, maxTokens: 4096, reasoningEfforts: { off: 'none', low: 'low', xhigh: 'high' } }] },
    { id: 'c-resp', name: 'Test responses', kind: 'openai', baseURL: `${base}/v1`, api: 'openai-responses', noAuth: false, models: [{ id: 'resp-1' }] },
    { id: 'c-claude', name: 'Test Anthropic', kind: 'anthropic', baseURL: `${base}/v1`, api: 'anthropic-messages', noAuth: false, models: [{ id: 'claude-x', name: 'Claude X' }] },
    { id: 'c-gemini', name: 'Test Gemini', kind: 'google', baseURL: `${base}/v1beta`, api: 'google-generative-ai', noAuth: false, models: [{ id: 'gemini-x' }] },
    { id: 'c-local', name: 'Ollama', kind: 'ollama', baseURL: `${base}/v1`, api: 'openai-completions', noAuth: true, models: [{ id: 'llama' }] },
  ], transcription: null }));
  return dir;
}
async function serviceAt(dir, port, keys) {
  const service = new P.ProviderService(fakeKeys(keys), new P.ConnectionStore(saved(dir, port)));
  await service.start();
  return service;
}

// One server speaking every format; it records what it was sent.
const seen = [];
function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [event, data] of events) res.write((event ? `event: ${event}\n` : '') + `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  res.end();
}
async function startServer() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const multipart = /multipart\/form-data/.test(req.headers['content-type'] ?? '');
      const json = body && !multipart ? JSON.parse(body) : {};
      const route = req.url.split('?')[0];
      seen.push({ url: route, query: req.url.slice(route.length), headers: req.headers, body: json, raw: multipart ? body : '' });
      if (req.headers.authorization === 'Bearer refused' || req.headers['x-api-key'] === 'refused') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } }));
      }
      const sendJson = (value) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.method === 'GET' && route === '/v1/models') return sendJson(req.headers['x-api-key'] ? { data: [{ id: 'claude-x', display_name: 'Claude X' }, { id: 'claude-y', display_name: 'Claude Y' }] } : { data: [{ id: 'chat-2' }, { id: 'chat-1' }, { id: 'chat-1' }] });
      if (req.method === 'GET' && route === '/api/tags') return sendJson({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }] });
      if (req.method === 'GET' && route === '/v1beta/models') return sendJson({ models: [{ name: 'models/gemini-x', displayName: 'Gemini X', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-1', displayName: 'Embed', supportedGenerationMethods: ['embedContent'] }] });
      if (route === '/v1/audio/transcriptions') return sendJson({ text: 'Good morning everyone.', segments: [{ start: 0, text: 'Good morning' }, { start: 1.5, text: 'everyone.' }] });
      if (/^\/v1beta\/models\/[^/]+:streamGenerateContent$/.test(route)) {
        return sse(res, [
          ['', { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from ' }] }, index: 0 }] }],
          ['', { candidates: [{ content: { role: 'model', parts: [{ text: 'Gemini' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, totalTokenCount: 12 } }],
        ]);
      }
      if (route === '/v1/chat/completions') {
        const chunk = (delta, finish = null, usage) => ['', { id: 'c1', object: 'chat.completion.chunk', created: 1, model: json.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) }];
        return sse(res, [chunk({ role: 'assistant', content: 'Hello from ' }), chunk({ content: 'completions' }), chunk({}, 'stop', { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }), ['', '[DONE]']]);
      }
      if (route === '/v1/responses') {
        const item = { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] };
        const done = { ...item, status: 'completed', content: [{ type: 'output_text', text: 'Hello from responses', annotations: [] }] };
        return sse(res, [
          ['response.created', { type: 'response.created', sequence_number: 0, response: { id: 'resp_1', object: 'response', status: 'in_progress', model: json.model, output: [] } }],
          ['response.output_item.added', { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item }],
          ['response.content_part.added', { type: 'response.content_part.added', sequence_number: 2, item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
          ['response.output_text.delta', { type: 'response.output_text.delta', sequence_number: 3, item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hello from responses' }],
          ['response.output_text.done', { type: 'response.output_text.done', sequence_number: 4, item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Hello from responses' }],
          ['response.content_part.done', { type: 'response.content_part.done', sequence_number: 5, item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: 'Hello from responses', annotations: [] } }],
          ['response.output_item.done', { type: 'response.output_item.done', sequence_number: 6, output_index: 0, item: done }],
          ['response.completed', { type: 'response.completed', sequence_number: 7, response: { id: 'resp_1', object: 'response', status: 'completed', model: json.model, output: [done], usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 } } }],
        ]);
      }
      if (route === '/v1/messages') {
        return sse(res, [
          ['message_start', { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, usage: { input_tokens: 9, output_tokens: 0 } } }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from Anthropic' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }],
          ['message_stop', { type: 'message_stop' }],
        ]);
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return server.address().port;
}


test('the presets: Anthropic, OpenAI, Google Gemini, Ollama and any OpenAI-compatible address', () => {
  assert.deepEqual(P.PRESETS.map((p) => [p.kind, p.api, p.noAuth]), [['anthropic', 'anthropic-messages', false], ['openai', 'openai-responses', false], ['google', 'google-generative-ai', false], ['ollama', 'openai-completions', true], ['custom', 'openai-completions', false]]);
  assert.equal(P.presetOf('ollama').baseURL, 'http://127.0.0.1:11434/v1');
  const claude = P.toConnection({ id: 'a', name: 'Anthropic', kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1/', api: 'anthropic-messages', models: [], noAuth: false });
  assert.equal(claude.engineBase, 'https://api.anthropic.com', 'Anthropic: the library is given the address without /v1');
  assert.equal(claude.restBase, 'https://api.anthropic.com/v1');
});

test('connections are added, changed and removed, and a key is never written to connections.json', async () => {
  const dir = path.join(work, 'store');
  const keys = fakeKeys();
  const service = new P.ProviderService(keys, new P.ConnectionStore(dir));
  await service.start();
  let changes = 0;
  service.onChange(() => changes++);
  assert.deepEqual(service.view(), { connections: [], transcription: null }, 'nothing until the person adds one');
  assert.equal(service.effectiveChoice(null), null);
  const none = await service.stream(null, 'x', [{ role: 'user', text: 'hi' }], { signal: AbortSignal.timeout(5000) });
  assert.equal(none.error, P.NO_CONNECTION, 'no connection: one calm line, nothing sent');

  const id = await service.addConnection({ kind: 'openai', name: 'My OpenAI', baseURL: 'https://evil.example/v1', models: ['gpt-x', 'gpt-x', ' ', 'gpt-y'], key: 'sk-SECRET-IN-INPUT', apiKey: 'sk-SECRET-IN-INPUT' });
  await service.setKey(id, 'sk-SECRET-VALUE-123');
  const text = readFileSync(path.join(dir, 'connections.json'), 'utf8');
  assert.ok(!text.includes('sk-SECRET'), 'no key in connections.json: ' + text);
  const record = JSON.parse(text).connections[0];
  assert.deepEqual(Object.keys(record).sort(), ['api', 'baseURL', 'id', 'kind', 'models', 'name', 'noAuth']);
  assert.equal(record.baseURL, 'https://api.openai.com/v1', 'a named provider keeps its own address');
  assert.deepEqual(record.models, [{ id: 'gpt-x' }, { id: 'gpt-y' }]);
  assert.equal(keys.keys[id], 'sk-SECRET-VALUE-123', 'the key is kept by the key store, under the connection’s id');
  assert.equal(service.view().connections[0].key, 'here');
  assert.ok(changes >= 2, 'the view is told to read again');

  const local = await service.addConnection({ kind: 'ollama' });
  assert.deepEqual([service.view().connections[1].baseURL, service.view().connections[1].key], ['http://127.0.0.1:11434/v1', 'not-needed']);
  await assert.rejects(service.addConnection({ kind: 'custom', baseURL: 'file:///etc/passwd' }), /http/);
  await assert.rejects(service.addConnection({ kind: 'custom', baseURL: 'https://user:pw@x.example/v1' }), /key box/);
  const custom = await service.addConnection({ kind: 'custom', name: 'LM Studio', baseURL: 'http://localhost:1234/v1/', noAuth: true });
  assert.equal(service.view().connections[2].baseURL, 'http://localhost:1234/v1');
  await service.updateConnection(custom, { models: ['qwen'], baseURL: 'http://localhost:1235/v1' });
  assert.deepEqual(service.effectiveChoice({ provider: custom, model: 'qwen' }), { provider: custom, model: 'qwen' });

  await service.setTranscription({ connection: id, model: 'whisper-1' });
  assert.deepEqual(service.view().transcription, { connection: id, model: 'whisper-1' });
  await service.removeConnection(id);
  assert.equal(keys.has(id), false, 'removing a connection removes its key');
  assert.equal(service.view().transcription, null, 'and its transcription choice');
  assert.deepEqual(service.view().connections.map((c) => c.id), [local, custom]);

  // What is saved is read again as it was; anything that isn't a connection is dropped, a stray key with it.
  writeFileSync(path.join(dir, 'connections.json'), JSON.stringify({ connections: [{ id: 'ok-1', kind: 'custom', baseURL: 'http://127.0.0.1:9/v1', apiKey: 'sk-STRAY', models: ['m'] }, { id: 'bad id', kind: 'custom' }, { id: 'x', kind: 'nope' }, 7] }));
  const again = new P.ConnectionStore(dir);
  await again.load();
  assert.deepEqual(again.list().map((r) => r.id), ['ok-1']);
  assert.equal('apiKey' in again.list()[0], false);
  await again.update('ok-1', { name: 'Renamed' });
  assert.ok(!readFileSync(path.join(dir, 'connections.json'), 'utf8').includes('sk-STRAY'), 'a key pasted into the file by hand is not carried along');
  assert.deepEqual(readdirSync(dir).sort(), ['connections.json'], 'no temp file is left behind');
  service.stop();
});

test('reasoning levels map to their wire values', () => {
  const conn = P.toConnection({ id: 'c', name: 'C', kind: 'custom', baseURL: 'https://x.example/v1', api: 'openai-completions', noAuth: false, models: [
    { id: 'a', reasoningEfforts: { off: 'none', low: 'low', xhigh: 'high' } },
    { id: 'b', reasoningEfforts: false },
    { id: 'c', reasoningEfforts: { off: null, high: 'high' } },
  ] });
  const a = P.toPiModel(conn, 'a');
  assert.equal(a.reasoning, true);
  assert.deepEqual(a.thinkingLevelMap, { off: 'none', minimal: null, low: 'low', medium: null, high: null, xhigh: 'high', max: null });
  assert.equal(P.toPiModel(conn, 'b').reasoning, false);
  const c = P.toPiModel(conn, 'c');
  assert.equal('off' in c.thinkingLevelMap, false, 'a declared off with no value is left out: send nothing');
  assert.deepEqual(P.levelsOf(conn, 'a'), ['off', 'low', 'xhigh']);
  assert.equal(P.toPiModel(conn, 'unknown').maxTokens, 4096, 'a model typed by hand takes the connection’s defaults');
  assert.equal(P.toPiModel(conn, 'unknown').reasoning, false);
});

test('a reply streams through pi-ai for each format', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p3'), port, { 'c-chat': 'key-chat', 'c-resp': 'key-resp', 'c-claude': 'key-claude', 'c-gemini': 'key-gemini' });
  try {
    const ask = async (choice) => {
      let streamed = '';
      const result = await service.stream(choice, 'Be brief.', [{ role: 'user', text: 'Say hello.' }], { signal: AbortSignal.timeout(15000), onText: (d) => (streamed += d) });
      return { ...result, streamed };
    };
    seen.length = 0;
    const completions = await ask({ provider: 'c-chat', model: 'chat-1', reasoning: 'low' });
    assert.equal(completions.text, 'Hello from completions', completions.error);
    assert.equal(completions.streamed, completions.text, 'text arrives as it streams');
    assert.equal(seen[0].headers.authorization, 'Bearer key-chat');
    assert.equal(seen[0].body.reasoning_effort, 'low', 'the level goes as its wire value');

    seen.length = 0;
    const responses = await ask({ provider: 'c-resp', model: 'resp-1' });
    assert.equal(responses.text, 'Hello from responses', responses.error);
    assert.equal(seen[0].url, '/v1/responses');

    seen.length = 0;
    const anthropic = await ask({ provider: 'c-claude', model: 'claude-x' });
    assert.equal(anthropic.text, 'Hello from Anthropic', anthropic.error);
    assert.equal(seen[0].url, '/v1/messages');
    assert.equal(seen[0].headers['x-api-key'], 'key-claude');

    seen.length = 0;
    const gemini = await ask({ provider: 'c-gemini', model: 'gemini-x' });
    assert.equal(gemini.text, 'Hello from Gemini', gemini.error);
    assert.equal(gemini.streamed, 'Hello from Gemini');
    assert.equal(seen[0].url, '/v1beta/models/gemini-x:streamGenerateContent');
    assert.equal(seen[0].headers['x-goog-api-key'], 'key-gemini');

    seen.length = 0;
    const local = await ask({ provider: 'c-local', model: 'llama' });
    assert.equal(local.text, 'Hello from completions', 'a local server needs no key: ' + local.error);

    seen.length = 0;
    const first = await ask(null);
    assert.equal(first.text, 'Hello from completions', 'with no choice, the first connection’s first model answers: ' + first.error);
    assert.deepEqual(await service.test('c-claude', 'claude-x'), { ok: true, words: 'Test Anthropic answered: “Hello from Anthropic”' });
  } finally {
    service.stop();
  }
});

// Claude counts its thinking against max_tokens, and Sonnet 5.5 and Opus 5.5 think by default: at the old 8192 ceiling a
// designed handout came back cut off (24 Nov 2026). An ask's room gets the thinking's room on top, within the model's
// own ceiling; other formats send what was asked, within theirs.
test('Claude gets room to think on top of what an ask asked for', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p-room'), port, { 'c-chat': 'key-chat', 'c-claude': 'key-claude' });
  try {
    const sent = async (choice, maxTokens) => {
      seen.length = 0;
      const r = await service.stream(choice, 'Be brief.', [{ role: 'user', text: 'Say hello.' }], { signal: AbortSignal.timeout(15000), ...(maxTokens ? { maxTokens } : {}) });
      assert.ok(!r.error, r.error);
      const b = seen[0].body;
      return b.max_tokens ?? b.max_completion_tokens;
    };
    assert.equal(P.toPiModel(P.toConnection({ id: 'a', name: 'A', kind: 'anthropic', baseURL: 'http://127.0.0.1:1/v1', api: 'anthropic-messages', models: [{ id: 'x' }] }), 'x').maxTokens, 64000, 'a Claude model with no stated ceiling may write 64K');
    assert.equal(await sent({ provider: 'c-claude', model: 'claude-x' }), 64000, 'no ask cap: the model’s whole ceiling');
    assert.equal(await sent({ provider: 'c-claude', model: 'claude-x' }, 4000), 4000 + P.THINKING_ROOM, 'a short ask still leaves room for thinking');
    assert.equal(await sent({ provider: 'c-claude', model: 'claude-x' }, 60000), 64000, 'never past the model’s ceiling');
    assert.equal(await sent({ provider: 'c-chat', model: 'chat-1' }, 16000), 4096, 'another format: what was asked, within its ceiling');
    assert.equal(await sent({ provider: 'c-chat', model: 'chat-1' }, 1000), 1000);
  } finally {
    service.stop();
  }
});

// A picture attached in the chat goes to a model that sees pictures as a picture; one that can't gets pi-ai's note
// instead; the model list says which see pictures.
test('an attached picture goes as a picture to a model that sees pictures', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p5'), port, { 'c-chat': 'key-chat', 'c-claude': 'key-claude' });
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const msg = [{ role: 'user', text: 'What is in this picture?', images: [{ mediaType: 'image/png', data: png, name: 'dot.png' }] }];
    seen.length = 0;
    const seeing = await service.stream({ provider: 'c-claude', model: 'claude-x' }, 'Be brief.', msg, { signal: AbortSignal.timeout(15000) });
    assert.equal(seeing.text, 'Hello from Anthropic', seeing.error);
    const content = seen[0].body.messages[0].content;
    assert.deepEqual(content.map((c) => c.type), ['image', 'text'], 'the picture, then the words: ' + JSON.stringify(content).slice(0, 200));
    assert.equal(content[0].source.data, png);
    assert.equal(content[0].source.media_type, 'image/png');
    seen.length = 0;
    const blind = await service.stream({ provider: 'c-chat', model: 'chat-1' }, 'Be brief.', msg, { signal: AbortSignal.timeout(15000) });
    assert.equal(blind.text, 'Hello from completions', blind.error);
    const sent = JSON.stringify(seen[0].body.messages);
    assert.ok(!sent.includes(png) && /image omitted/.test(sent), 'a model that can’t see pictures gets no picture, and a note: ' + sent.slice(0, 300));
    const models = Object.fromEntries(service.view().connections.flatMap((c) => c.models.map((m) => [m.id, m.images])));
    assert.equal(models['claude-x'], true);
    assert.equal(models['chat-1'], false, 'an OpenAI-compatible address is taken to send words only');
    assert.equal(models['llama'], false);
  } finally {
    service.stop();
  }
});

test('what the person is told when a model can’t answer', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p4'), port, { 'c-chat': 'refused' });
  try {
    const run = (choice) => service.stream(choice, 'x', [{ role: 'user', text: 'hi' }], { signal: AbortSignal.timeout(15000) });
    const missing = await run({ provider: 'c-resp', model: 'resp-1' });
    assert.equal(missing.error, 'Test responses needs its key: add it in Settings › AI.');
    const refused = await run({ provider: 'c-chat', model: 'chat-1' });
    assert.equal(refused.stopReason, 'error');
    assert.match(refused.error, /401|key/i, refused.error);
    assert.ok(!/NeuralSpark/.test(missing.error + refused.error));
    assert.deepEqual(service.effectiveChoice({ provider: 'c-gone', model: 'x' }), { provider: 'c-chat', model: 'chat-1' }, 'a choice whose connection is gone falls back to the first connection that can answer');
    assert.deepEqual(service.effectiveChoice({ provider: 'c-resp', model: 'resp-x9' }), { provider: 'c-chat', model: 'chat-1' }, 'a typo’d model falls back too, never streams with guessed limits');
    assert.deepEqual(service.effectiveChoice({ provider: 'c-resp', model: 'resp-1' }), { provider: 'c-resp', model: 'resp-1' }, 'a model that exists is used');
    assert.deepEqual(await service.test('c-chat', 'chat-x9'), { ok: false, words: 'chat-x9 is not one of Test completions’s models here. Its models: chat-1.' }, 'testing a gone model says so');
    assert.deepEqual(await service.test('c-nope', 'x'), { ok: false, words: 'That connection is no longer here.' });
    assert.deepEqual(service.view().connections.map((c) => [c.id, c.key]), [['c-chat', 'here'], ['c-resp', 'missing'], ['c-claude', 'missing'], ['c-gemini', 'missing'], ['c-local', 'not-needed']]);
  } finally {
    service.stop();
  }
});

test('the provider’s own models are listed: /models, Anthropic’s /v1/models, Google’s, Ollama’s /api/tags', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p6'), port, { 'c-chat': 'key-chat', 'c-claude': 'key-claude', 'c-gemini': 'key-gemini', 'c-resp': 'refused' });
  try {
    seen.length = 0;
    assert.deepEqual(await service.listRemote('c-chat'), [{ id: 'chat-1', name: 'chat-1' }, { id: 'chat-2', name: 'chat-2' }], 'sorted, each once');
    assert.equal(seen[0].url, '/v1/models');
    assert.equal(seen[0].headers.authorization, 'Bearer key-chat');
    seen.length = 0;
    assert.deepEqual(await service.listRemote('c-claude'), [{ id: 'claude-x', name: 'Claude X' }, { id: 'claude-y', name: 'Claude Y' }]);
    assert.deepEqual([seen[0].url, seen[0].headers['x-api-key'], seen[0].headers['anthropic-version']], ['/v1/models', 'key-claude', '2023-06-01']);
    assert.deepEqual(await service.listRemote('c-gemini'), [{ id: 'gemini-x', name: 'Gemini X' }], 'only the models that answer');
    seen.length = 0;
    assert.deepEqual(await service.listRemote('c-local'), [{ id: 'llama3.2:latest', name: 'llama3.2:latest' }, { id: 'qwen3:8b', name: 'qwen3:8b' }]);
    assert.equal(seen[0].url, '/api/tags');
    assert.equal(seen[0].headers.authorization, undefined, 'a local server is sent no key');
    await assert.rejects(service.listRemote('c-resp'), /didn’t accept the key/);
    await service.removeConnection('c-resp');
    await assert.rejects(service.listRemote('c-resp'), /no longer here/);
    const gone = P.toConnection({ id: 'g', name: 'Ollama', kind: 'ollama', baseURL: 'http://127.0.0.1:9/v1', api: 'openai-completions', models: [], noAuth: true });
    await assert.rejects(P.listRemoteModels(gone, undefined), /Ollama isn’t answering/, 'a server that isn’t running is said plainly, and a model can still be typed');
  } finally {
    service.stop();
  }
});

test('speech is written down by the connection the person chose, and says plainly when none is', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p7'), port, { 'c-chat': 'key-chat' });
  try {
    const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    assert.equal(service.transcribeStatus().ready, false);
    assert.equal(service.transcribeStatus().setUp, false);
    const none = await service.transcribe(audio, 'audio/wav');
    assert.match(none.error, /Add a transcription connection in Settings › AI/);
    await assert.rejects(service.setTranscription({ connection: 'c-nope', model: 'whisper-1' }), /Choose a connection/);
    await service.setTranscription({ connection: 'c-chat', model: 'whisper-1' });
    assert.deepEqual(service.transcribeStatus(), { ready: true, route: 'openai', provider: 'Test completions', setUp: true });
    seen.length = 0;
    const heard = await service.transcribe(audio, 'audio/wav', ['Aroha', 'Kaitiaki'], { language: 'en' });
    assert.deepEqual(heard, { text: 'Good morning everyone.', segments: [{ start: 0, text: 'Good morning' }, { start: 1.5, text: 'everyone.' }] });
    assert.equal(seen[0].url, '/v1/audio/transcriptions');
    assert.equal(seen[0].headers.authorization, 'Bearer key-chat');
    assert.match(seen[0].raw, /name="model"\r\n\r\nwhisper-1/);
    assert.match(seen[0].raw, /name="file"; filename="audio.wav"/);
    assert.match(seen[0].raw, /name="prompt"\r\n\r\nAroha, Kaitiaki/);
    assert.match(seen[0].raw, /name="language"\r\n\r\nen/, 'meetings ask for English');
    await service.setTranscription({ connection: 'c-resp', model: 'gpt-4o-transcribe' });
    assert.match(service.transcribeStatus().error, /Test responses needs its key/);
    await service.setTranscription(null);
    assert.equal(service.view().transcription, null);
  } finally {
    service.stop();
  }
});

test('one ask’s effort wins over the choice’s, offered or not sent', async () => {
  const port = await startServer();
  const service = await serviceAt(path.join(work, 'p-effort'), port, { 'c-chat': 'key-chat' });
  try {
    const ask = (choice, effort) => service.stream(choice, 'Be brief.', [{ role: 'user', text: 'Say hello.' }], { signal: AbortSignal.timeout(15000), ...(effort ? { effort } : {}) });
    seen.length = 0;
    await ask({ provider: 'c-chat', model: 'chat-1' }, 'low');
    assert.equal(seen[0].body.reasoning_effort, 'low', 'the ask’s low goes as its wire value');
    seen.length = 0;
    await ask({ provider: 'c-chat', model: 'chat-1', reasoning: 'low' }, 'xhigh');
    assert.equal(seen[0].body.reasoning_effort, 'high', 'the ask’s effort wins over the choice’s');
    seen.length = 0;
    await ask({ provider: 'c-chat', model: 'chat-1' });
    const baseline = seen[0].body.reasoning_effort;
    seen.length = 0;
    await ask({ provider: 'c-chat', model: 'chat-1' }, 'medium');
    assert.equal(seen[0].body.reasoning_effort, baseline, 'not offered: as if no effort was named');
  } finally {
    service.stop();
  }
});
