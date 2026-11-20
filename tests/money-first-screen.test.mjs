// node --test tests/money-first-screen.test.mjs — the Money first screen's looking-ahead line
// (src/shared/finance.ts, 10.0 papercuts): what goes out, what is expected in, and the tightest week in one plain
// line; nothing when there is nothing to look ahead at.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-money-first-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/finance.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a week reads in words, within a month or across two', () => {
  assert.equal(F.forecastWeekRange({ start: '2026-11-03', end: '2026-11-09' }), '3 to 9 Nov');
  assert.equal(F.forecastWeekRange({ start: '2026-10-28', end: '2026-11-03' }), '28 Oct to 3 Nov');
});

test('the line carries out, in, and the tightest week', () => {
  const fc = { events: [{ name: 'Power', amount: 120, date: '2026-11-05' }], totalOut: 1240, totalIn: 500, tightest: { start: '2026-11-03', end: '2026-11-09', out: 800, in: 0, net: -800, balance: 210 } };
  const line = F.forecastHeadline(fc, 'AUD');
  assert.ok(line.includes('going out in the next 90 days'), line);
  assert.ok(line.includes('expected in'), line);
  assert.ok(line.includes('tightest week 3 to 9 Nov, ending at'), line);
  const bare = F.forecastHeadline({ events: [{ name: 'Power', amount: 120, date: '2026-11-05' }], totalOut: 120, totalIn: 0, tightest: null }, 'AUD');
  assert.ok(bare.includes('going out'), bare);
  assert.ok(!bare.includes('expected in'), bare);
  assert.ok(!bare.includes('tightest'), bare);
});

test('nothing to look ahead at is nothing, not a broken line', () => {
  assert.equal(F.forecastHeadline({ events: [], totalOut: 0, totalIn: 0, tightest: null }, 'AUD'), null);
});
