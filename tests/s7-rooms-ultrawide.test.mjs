// Ultrawide rooms, the Vault side (rooms F2, 5 Nov 2026): past 1700px viewports the page column widens to
// the same 1280px measure as the former host app's --ns-reading-ultra at the same breakpoint, so the two
// apps' measures stay equal. The base 880px column below the breakpoint stands as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');
const css = readFileSync(path.join(root, 'styles.css'), 'utf8');

test('the page column widens to the shared ultra measure past 1700px', () => {
  const at = css.indexOf('@media (min-width: 1700px)');
  assert.ok(at > 0, 'the breakpoint matches the host app\'s');
  const ultra = css.slice(at);
  assert.match(ultra, /\.pv-inner \{\s*max-width: 1280px;/, 'the same 1280px measure as --ns-reading-ultra');
});

test('below the breakpoint the 880px column stands', () => {
  const base = css.slice(0, css.indexOf('@media (min-width: 1700px)'));
  assert.match(base, /\.pv-inner \{\s*max-width: 880px;/, 'base column untouched');
});
