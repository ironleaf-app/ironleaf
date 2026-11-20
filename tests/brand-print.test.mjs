// node --test tests/brand-print.test.mjs — a note's branded document printed (src/main/brand-print.ts):
// its html file lives in the app's data folder while it prints. If the app dies mid-print the file
// stays; the next print sweeps the stale ones (files of processes that are gone), and keeps files
// of live processes (a print still going, in this run or another). Each test fails without its fix.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brand-print-'));
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/brand-print.ts'))};\n`);
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export class BrowserWindow {}\nexport const session = { fromPartition: () => ({ webRequest: { onBeforeRequest: () => {} }, setPermissionRequestHandler: () => {} })};\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: [/^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const DEAD_PID = 2147483647;
const seed = (dir, name) => writeFileSync(path.join(dir, name), '<html></html>');

test('a dead run’s print files are swept; live ones and anything else stay', async () => {
  const dir = mkdtempSync(path.join(work, 'print-'));
  const live = `brand-${process.pid}-${Date.now()}-1.html`;
  seed(dir, `brand-${DEAD_PID}-1700000000000-1.html`);
  seed(dir, `brand-${DEAD_PID}-1700000000001-2.html`);
  seed(dir, live);
  seed(dir, 'notes.html');
  seed(dir, 'brand-old.html');
  assert.equal(await B.sweepBrandDir(dir), 2, 'the two stale files go');
  assert.deepEqual(readdirSync(dir).sort(), [live, 'brand-old.html', 'notes.html'].sort(), 'this run’s file and anything else stay');
});

test('a print still going in another live process is kept', async () => {
  const dir = mkdtempSync(path.join(work, 'live-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
  try {
    seed(dir, `brand-${child.pid}-1700000000000-1.html`);
    assert.equal(await B.sweepBrandDir(dir), 0, 'a live maker’s file stays');
    assert.deepEqual(readdirSync(dir), [`brand-${child.pid}-1700000000000-1.html`]);
  } finally {
    child.kill();
  }
});

test('a missing folder sweeps to nothing, never throwing', async () => {
  assert.equal(await B.sweepBrandDir(path.join(work, 'no-such-dir')), 0);
});

test('the next print sweeps before it writes its own file', () => {
  const src = read('src/main/brand-print.ts');
  assert.ok(src.includes('await sweepBrandDir(o.dir)'), 'pdf() sweeps the folder on every print');
  assert.ok(src.indexOf('await sweepBrandDir(o.dir)') < src.indexOf('brand-${process.pid}'), 'the sweep runs before the new file is written');
});
