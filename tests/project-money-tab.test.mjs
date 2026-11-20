// node --test tests/project-money-tab.test.mjs — a project's Money tab (src/shared/finance.ts, 10.0 papercuts):
// the project's bills head the tab still due first (soonest first), then the paid and paused, with what the due ones
// cost a month together and how many are late.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-proj-money-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/finance.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const bill = (name, next, days, monthly, overdue = false) => ({ path: `${name}.md`, name, next, days, monthly, overdue });

test('still due first in due order, the paid and paused after', () => {
  const bills = [
    bill('Paid off', null, null, 10),
    bill('Site power', '2026-11-20', 18, 120),
    bill('Crane hire', '2026-11-05', 3, 800, true),
    bill('Undated', '2026-12-01', null, 40),
  ];
  const s = F.projectMoneySummary(bills);
  assert.deepEqual(s.due.map((b) => b.name), ['Crane hire', 'Site power', 'Undated']);
  assert.deepEqual(s.rest.map((b) => b.name), ['Paid off']);
  assert.equal(s.monthly, 960);
  assert.equal(s.overdue, 1);
});

test('nothing due is an empty tab, not a broken one', () => {
  assert.deepEqual(F.projectMoneySummary([]), { due: [], rest: [], monthly: 0, overdue: 0 });
  const paid = F.projectMoneySummary([bill('Old', null, null, null)]);
  assert.deepEqual(paid.due, []);
  assert.equal(paid.rest.length, 1);
  assert.equal(paid.monthly, 0);
});
