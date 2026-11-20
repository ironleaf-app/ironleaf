// node --test tests/ai-ask.test.mjs — one question for a JSON answer (src/main/ai.ts askJson; 5 Nov
// 2026, the minutes ran 240 s at the model's default depth: the ask named no effort, so the model
// thought hard over a 1.8 KB transcript while a one-line chat answered in seconds). The ask runs low
// unless its job needs more (resolved against what the model offers), and a caller stopping it aborts
// the wait. Made-up models and replies only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-ai-ask-'));
let A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/ai.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  A = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** An AiService on a stand-in model: what each ask sent, and the reply it gets. */
function asked(levels, reply = { text: '{"summary":"Done."}', stopReason: 'stop' }) {
  const sent = [];
  const settings = { raw: { model: { provider: 'muse', model: 'muse-1.3' } } };
  const providers = {
    view: () => ({ neuralSpark: 'found', connections: [{ id: 'muse', name: 'Muse', models: [{ id: 'muse-1.3', name: 'Muse 1.3', levels }] }], neuralSparkDefault: null }),
    effectiveChoice: (c) => c ?? { provider: 'muse', model: 'muse-1.3' },
    stream: async (choice, system, messages, opts) => {
      sent.push({ choice, system, messages, opts });
      return typeof reply === 'function' ? reply(opts) : reply;
    },
  };
  return { ai: new A.AiService(settings, {}, providers), sent };
}

test('a JSON ask runs low: the reply parsed, the effort sent with it', async () => {
  const { ai, sent } = asked(['low', 'medium', 'high', 'xhigh']);
  const r = await ai.askJson('Reply with JSON only.', 'Meeting: Cart retry', 5000, 4000);
  assert.deepEqual(r, { reply: { summary: 'Done.' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].opts.effort, 'low', 'low rides with the ask');
  assert.equal(sent[0].opts.maxTokens, 4000);
});

test('low only when the model offers it: minimal, else the model’s default', async () => {
  const { ai, sent } = asked(['minimal', 'medium']);
  await ai.askJson('s', 'u');
  assert.equal(sent[0].opts.effort, 'minimal', 'minimal when there is no low');
  const plain = asked([]);
  await plain.ai.askJson('s', 'u');
  assert.equal(plain.sent[0].opts.effort, undefined, 'no levels offered: the model’s default stands');
});

test('a job that needs more names it', async () => {
  const { ai, sent } = asked(['low', 'medium', 'high', 'xhigh']);
  await ai.askJson('s', 'u', 5000, 4000, { effort: 'high' });
  assert.equal(sent[0].opts.effort, 'high');
  await ai.askJson('s', 'u', 5000, 4000, { effort: 'turbo' });
  assert.equal(sent[1].opts.effort, 'low', 'an unknown effort falls back to low, never sent on');
});

test('stopping the caller aborts the wait; a timeout still ends it', async () => {
  const slow = asked(['low'], () => new Promise(() => {}));
  const c = new AbortController();
  const p = slow.ai.askJson('s', 'u', 5000, 4000, { signal: c.signal });
  await wait(20);
  assert.equal(slow.sent.length, 1);
  c.abort();
  await wait(20);
  assert.equal(slow.sent[0].opts.signal.aborted, true, 'the abort reaches the model wait');
  const quick = asked(['low'], (opts) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve({ text: '', stopReason: 'aborted', error: 'Stopped.' }))));
  const c2 = new AbortController();
  const p2 = quick.ai.askJson('s', 'u', 5000, 4000, { signal: c2.signal });
  await wait(20);
  c2.abort();
  assert.deepEqual(await p2, { reply: null, error: 'Stopped.' }, 'a stopped ask says it was stopped');
  void p.catch(() => {});
  const hanging = asked(['low'], (opts) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve({ text: '', stopReason: 'aborted', error: 'Stopped.' }))));
  // AbortSignal.timeout's timer does not hold the event loop open (in the app, Electron's loop does), so the test
  // holds it while it waits, or node:test would cancel the test before the timeout fires.
  const hold = setInterval(() => {}, 1000);
  try {
    assert.deepEqual(await hanging.ai.askJson('s', 'u', 60, 4000), { reply: null, error: 'Stopped.' }, 'a wait past its timeout still ends');
  } finally {
    clearInterval(hold);
  }
});
