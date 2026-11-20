// node --test tests/onebar-break.test.mjs — break-it t31 (8 Nov 2026): Today's count on the one side bar
// is the one count Vault itself shows: late plus today through the one rule on the day's own lists (project
// steps plus the hub's dated lines), read against the people the vault knows. Each test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('one rule for the side bar count: the day’s rows plus the hub, late and due today', () => {
  const shared = read('src/shared/today.ts');
  assert.ok(shared.includes('sidebarTodayCount'), 'shared/today.ts names the side bar count');
  const body = shared.slice(shared.indexOf('sidebarTodayCount'), shared.indexOf('sidebarTodayCount') + 1600);
  assert.ok(body.includes('dayShapeCounts('), 'through the one late/today rule');
  assert.ok(!body.includes("kind === 'step'"), 'steps, key dates and project dues — Late draws them, so the badge does (t249: never 8 on the bar above a Late 9)');
  for (const group of ['overdue', 'today', 'week', 'later']) assert.ok(body.includes(group), `with the hub ${group} lines`);
  assert.ok(body.includes('known'), 'read against the people the vault knows');
  assert.ok(body.includes('late') && body.includes('+'), 'late plus today');
});

test('todayCount answers it: the main side reads the one count, 0 until the notes open', () => {
  const src = read('src/main/app.ts');
  assert.ok(src.includes('sidebarTodayCount'), 'todayCount reads the side bar count');
  assert.ok(src.includes('hub.due()'), 'with the hub due');
  assert.ok(src.includes('return 0'), '0 until the notes open');
});

test('Vault’s own bar reads the same query (never a second count)', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('sidebarTodayCount'), 'Places reads the side bar count');
});
