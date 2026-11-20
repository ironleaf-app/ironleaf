// node --test tests/daily-note-same.test.mjs — the daily note's Yesterday and Tomorrow (src/shared/days.ts,
// 10.0 papercuts): stepping whole days from any day, across months, years and leap days, never from today only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-daily-same-'));
let D;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/days.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'd.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'd.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('Yesterday and Tomorrow from any day', () => {
  assert.equal(D.offsetIsoDay('2026-11-02', -1), '2026-11-01');
  assert.equal(D.offsetIsoDay('2026-11-02', 1), '2026-11-03');
  assert.equal(D.offsetIsoDay('2026-11-02', 0), '2026-11-02');
  assert.equal(D.offsetIsoDay('2026-01-01', -1), '2025-12-31');
  assert.equal(D.offsetIsoDay('2025-12-31', 1), '2026-01-01');
});

test('month ends and leap days step truly', () => {
  assert.equal(D.offsetIsoDay('2026-03-01', -1), '2026-02-28');
  assert.equal(D.offsetIsoDay('2024-03-01', -1), '2024-02-29');
  assert.equal(D.offsetIsoDay('2026-02-28', 1), '2026-03-01');
  assert.equal(D.offsetIsoDay('2026-10-25', 10), '2026-11-04');
});

test('what reads as no day steps nowhere', () => {
  assert.equal(D.offsetIsoDay('tomorrow', 1), '');
  assert.equal(D.offsetIsoDay('2026-02-30', 1), '');
  assert.equal(D.offsetIsoDay('', -1), '');
});
