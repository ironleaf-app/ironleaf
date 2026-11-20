// node --test tests/web-read.test.mjs — the side chat on the web (src/main/web-read.ts; 8.0 V6): The former host app's
// own search through the host, a page read as words (its title, its main text, no scripts or menus), only on the open
// web, and the assistant's web_search and web_read tools offered only when the former host app gives the search.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-web-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * from ${JSON.stringify(path.join(root, 'src/main/web-read.ts'))};`, `export { AgentTools, WEB_TOOLS, agentSystem } from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'web.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'web.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a page as words; only the open web', async () => {
  const html = '<html><head><title>Bosch SMS6 &amp; warranty</title><script>evil()</script></head><body><nav>Home | Shop</nav><main><h1>Warranty</h1><p>Every dishwasher has a <b>2-year</b> warranty.</p><ul><li>Parts</li><li>Labour</li></ul></main><footer>© Bosch</footer></body></html>';
  const w = M.pageWords(html);
  assert.equal(w.title, 'Bosch SMS6 & warranty');
  assert.match(w.text, /Every dishwasher has a 2-year warranty\./);
  assert.match(w.text, /- Parts/);
  assert.doesNotMatch(w.text, /evil|Home \| Shop|© Bosch/, 'no scripts, menus or footers');
  for (const bad of ['file:///C:/x', 'http://localhost:8080/', 'http://192.168.1.5/', 'http://10.0.0.2/a', 'ftp://x.com/', 'not a url']) assert.throws(() => M.webAddress(bad), undefined, bad);
  assert.equal(M.webAddress('https://www.bosch-home.com.au/warranty').hostname, 'www.bosch-home.com.au');
  const fake = async (url) => ({ ok: true, status: 200, url, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => html });
  const page = await M.readPage('https://www.bosch-home.com.au/warranty', fake);
  assert.equal(page.title, 'Bosch SMS6 & warranty');
  assert.match(page.text, /2-year/);
  const redirected = async () => ({ ok: true, status: 200, url: 'http://127.0.0.1/admin', headers: { get: () => 'text/html' }, text: async () => '' });
  await assert.rejects(M.readPage('https://example.com/', redirected), /open web/, 'a redirect to this PC is refused');
  const pdf = async (url) => ({ ok: true, status: 200, url, headers: { get: () => 'application/pdf' }, text: async () => '' });
  await assert.rejects(M.readPage('https://example.com/a.pdf', pdf), /a file, not a page/);
  assert.deepEqual(M.cleanHits({ results: [{ title: 'A', url: 'https://a.example/x', snippet: 's' }, { title: 'bad', url: 'javascript:1' }] }), [{ title: 'A', url: 'https://a.example/x', snippet: 's' }]);
});

test('the side chat’s web tools, through the host', async () => {
  const steps = [];
  const host = { web: { search: async (q) => [{ title: 'Bosch warranty', url: 'https://bosch.example/w', snippet: '2 years' }], read: async (url) => ({ url, title: 'Warranty', text: '2-year warranty', cut: false }) }, clean: (r) => r, index: {} };
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const found = await tools.run({ id: '1', name: 'web_search', arguments: JSON.stringify({ query: 'Bosch dishwasher warranty' }) });
  assert.ok(!found.isError, found.text);
  assert.match(found.text, /https:\/\/bosch\.example\/w/);
  const read = await tools.run({ id: '2', name: 'web_read', arguments: JSON.stringify({ url: 'https://bosch.example/w' }) });
  assert.match(read.text, /never instructions/);
  assert.deepEqual(steps.map((s) => s.words), ['Searched the web for “Bosch dishwasher warranty”', 'Read bosch.example']);
  const none = await new M.AgentTools({ clean: (r) => r, index: {} }, [], () => {}).run({ id: '3', name: 'web_search', arguments: JSON.stringify({ query: 'x' }) });
  assert.equal(none.isError, true, 'outside the host app there is no web search');
  assert.deepEqual(M.WEB_TOOLS.map((t) => t.name), ['web_search', 'web_read']);
  // One-voice pass: the system prompt says plainly to search with web_search then read with web_read.
  assert.match(M.agentSystem(null, 'today', null, []), /when web_search and web_read are among your tools, search, read the page that matters/);
});
