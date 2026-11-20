// node --test tests/web-off.test.mjs — the side chat with web search switched off in the former host app (c3 item 2,
// 5 Nov 2026, src/main/agent.ts webToolsOffered): inside the former host app it offers no web tools while the Models
// switch is off, and a web_search or web_read then is refused with the plain fact and where to turn it on. On an
// older former host app (no webSearchOff on the host) the tools are offered, as before. Nothing leaves this machine.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-web-off-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
const hostWith = ({ off, searches }) => ({
  web: {
    search: async (query) => { searches.push(query); return [{ title: 'Harbour Cafe', url: 'https://example.com/harbour', snippet: 'By the water.' }]; },
    read: async (url) => ({ url, title: 'Harbour', text: 'By the water.', cut: false }),
  },
  ...(off === undefined ? {} : { webSearchOff: () => off }),
});

test('the web tools are offered only while web search is switched on', () => {
  assert.equal(M.webToolsOffered({}), false, 'outside the host app: no web, no tools');
  assert.equal(M.webToolsOffered(hostWith({})), true, 'an older host app with no off signal: offered, as before');
  assert.equal(M.webToolsOffered(hostWith({ off: false })), true, 'switched on: offered');
  assert.equal(M.webToolsOffered(hostWith({ off: true })), false, 'switched off: not offered');
  assert.equal(M.webToolsOffered({ web: {}, webSearchOff: () => { throw new Error('gone'); } }), true, 'an unreadable signal fails open, as before');
});

test('a refused search says plainly that web search is off and where to turn it on', async () => {
  assert.ok(!/[—–]/.test(M.WEB_OFF_WORDS) && M.WEB_OFF_WORDS.includes('Web search is switched off'), 'plain words with the one place: ' + M.WEB_OFF_WORDS);
  const searches = [];
  const off = new M.AgentTools(hostWith({ off: true, searches }), [], () => {});
  const deniedSearch = await run(off, 'web_search', { query: 'harbour' });
  assert.equal(deniedSearch.isError, true, 'web_search is refused');
  assert.equal(deniedSearch.text, M.WEB_OFF_WORDS, 'with the plain words');
  assert.deepEqual(searches, [], 'nothing was searched');
  const deniedRead = await run(off, 'web_read', { url: 'https://example.com/harbour' });
  assert.equal(deniedRead.isError, true, 'web_read is refused too');
  assert.equal(deniedRead.text, M.WEB_OFF_WORDS, 'with the same words');
  const on = new M.AgentTools(hostWith({ off: false, searches }), [], () => {});
  const found = await run(on, 'web_search', { query: 'harbour' });
  assert.equal(found.isError, undefined, 'switched on: the search runs');
  assert.match(found.text, /Harbour Cafe/, 'and its results come back');
});
