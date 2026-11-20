// node --test tests/error-log.test.mjs — 8.7.1 urgent, never silent (31 Oct 2026): the guard writes every caught
// error to Ironleaf's own log file (its data folder, a rolling file: the page kind, the error message and stack,
// the time, the version — no note content, no secrets), and its card gets "Copy details" so the person can send it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-error-log-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/error-log.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const dir = () => mkdtempSync(path.join(work, 'data-'));

test('a caught error is one line in the log: kind, message, stack, time, version — and nothing else', async () => {
  const d = dir();
  await L.reportError(d, '1.0.0', { kind: 'page', name: 'module', message: "Cannot read properties of undefined (reading 'slice')", stack: 'TypeError: x\n    at shortDate (publications.ts:169:21)', components: '\n    in EditionPage' });
  const lines = readFileSync(path.join(d, 'page-errors.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.kind, 'page');
  assert.equal(row.name, 'module');
  assert.match(row.message, /reading 'slice'/);
  assert.match(row.stack, /shortDate/);
  assert.match(row.components, /EditionPage/);
  assert.ok(!Number.isNaN(Date.parse(row.at)), 'the time parses');
  assert.equal(row.version, '1.0.0');
  assert.deepEqual(Object.keys(row).sort(), ['at', 'components', 'kind', 'message', 'name', 'stack', 'version'], 'no note content, no paths, no secrets');
});

test('long errors are capped, and the file rolls over instead of growing forever', async () => {
  const d = dir();
  await L.reportError(d, '1.0.0', { kind: 'page', name: 'x', message: 'm'.repeat(5000), stack: 's'.repeat(20000) });
  const row = JSON.parse(readFileSync(path.join(d, 'page-errors.log'), 'utf8'));
  assert.ok(row.message.length <= 2000 && row.stack.length <= 8000, 'capped');
  for (let i = 0; i < 120; i++) await L.reportError(d, '1.0.0', { kind: 'card', name: `card-${i}`, message: 'b'.repeat(1500), stack: 's'.repeat(7000) });
  assert.ok(statSync(path.join(d, 'page-errors.log')).size <= 600 * 1024, 'the live file stays small');
});

test("the guard's card reports what it caught and offers Copy details", () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/components/ErrorBoundary.tsx'), 'utf8');
  assert.ok(src.includes('errors.report'), 'the guard reports what it caught');
  assert.ok(src.includes('Copy details'), 'its card gets Copy details');
  assert.ok(src.includes('clipboard'), 'copying uses the clipboard');
  const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  assert.ok(preload.includes('errors:') && preload.includes("'errors:report'"), 'the window can report errors');
  const main = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(main.includes("'errors:report'"), 'the main side keeps the log');
});
