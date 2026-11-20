// node --test tests/uplift-95-states.test.mjs — every state designed, one kit (9.5 polished, 1 Nov 2026, the ).
// The blank boot says what is happening; the notebook fails and loads through the shared states with a way back;
// Today ticks the kit check and starts notes from the kit button; Home lays out with classes, never inline
// styles. Every check fails without its change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('the blank boot says what is happening', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.ok(!app.includes('if (booting) return <div className="boot" />;'), 'boot is never a bare box');
  assert.ok(app.includes('Opening your vault'), 'boot says what is happening');
  const css = read('src/renderer/src/styles.css');
  assert.ok(/\.boot \{[^}]*place-items: center/.test(css), 'boot centres its words');
});

test('the notebook fails and loads through the shared states', () => {
  const nb = read('src/renderer/src/views/NotebookView.tsx');
  assert.ok(!nb.includes('nb-failed') && !nb.includes('view-loading'), 'no hand-rolled notebook states');
  assert.ok(nb.includes('PageError') && nb.includes('PageLoading') && nb.includes('RowsSkeleton'), 'the shared error, loading and skeleton');
  assert.ok(nb.includes('retry='), 'failure offers the way back');
});

test('Today ticks and starts from the kit', () => {
  for (const f of ['src/renderer/src/views/TodayView.tsx', 'src/renderer/src/views/today/DueCard.tsx']) {
    assert.ok(!read(f).includes('td-check'), `${f}: the kit check, not td-check`);
  }
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('td-new'), 'New note starts from the kit button');
  assert.ok(!today.includes('+ New'), 'no glued-on plus label');
  assert.ok(today.includes('check${done') || today.includes('check done') || today.includes("check${isDone") || today.includes('`check'), 'the kit check carries the tick');
});

test('Home lays out with classes, never inline styles', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(!home.includes('marginLeft'), 'no inline push-margins (the kit push class)');
  assert.ok(!home.includes('height: 28'), 'no inline button heights (the kit small button)');
  assert.ok(!home.includes('width: 760'), 'no inline dialog width');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.push'), 'the kit pushes to the edge');
  assert.ok(kit.includes('.btn.small'), 'the kit sizes a small button');
});
