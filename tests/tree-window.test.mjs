// node --test tests/tree-window.test.mjs — the side bar folder tree draws a window, not every row (t163,
// 9 Nov 2026: t155's report — opening a 2,000-note folder drew 2,000 rows). The first eighty open rows, as
// the Notes page windows its list, with Show more for the rest saying how many are left. Opening or folding
// starts the window over; the keys, a reveal and the open note draw up to their row; the open/fold state,
// the full order for the keys and the selection never shrink — only what is drawn does. Each check fails
// without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/renderer/src/panels/FileExplorer.tsx'), 'utf8');
const css = readFileSync(path.join(root, 'src/renderer/src/styles.css'), 'utf8');

test('the tree draws eighty rows at a time, slicing the drawn order with Show more', () => {
  assert.match(src, /\[shownCount, setShownCount\] = useState\(80\)/, 'eighty rows at a time, as the Notes page');
  assert.match(src, /renderFolder\(tree, 0, \{ left: shownCount \}\)/, 'the window budgets the drawn rows');
  assert.match(src, /if \(win\.left <= 0\) return null/, 'rows past the budget are not drawn');
  assert.match(src, /flatRows\.length > shownCount/, 'Show more only past the window');
  assert.match(src, /Show more \(\{\s*flatRows\.length - shownCount\s*\} left\)/, 'saying exactly how many are left');
  assert.match(src, /setShownCount\(\(n\) => n \+ 80\)/, 'eighty more per press');
});

test('opening or folding starts the window over', () => {
  const at = src.indexOf('const toggle = ');
  assert.ok(at > 0, 'toggle is there');
  assert.ok(src.slice(at, at + 400).includes('setShownCount(80)'), 'opening or folding reads from the first rows again');
  assert.ok(src.includes("run: () => { setShownCount(80);"), 'open-every and close-every start over too');
});

test('the keys, a reveal and the open note draw up to their row', () => {
  assert.match(src, /if \(to >= shownCount\) setShownCount\(to \+ 1\)/, 'arrowing past the drawn rows draws up to the key row');
  const follows = src.match(/setShownCount\(\(n\) => Math\.max\(n, i \+ 1\)\)/g) ?? [];
  assert.equal(follows.length, 2, 'a reveal and the open note draw up to their row, never shrinking the window');
});

test('the open/fold state, the full key order and the selection never shrink', () => {
  assert.ok(src.includes('rememberExplorer({ expanded: [...expanded] })'), 'the open folders are still remembered whole');
  assert.match(src, /const visible = useMemo\(\(\) => \{/, 'the keys still walk every open row');
  assert.match(src, /visible\.slice\(Math\.min\(a, b\), Math\.max\(a, b\) \+ 1\)/, 'Shift+click ranges still span the full order');
  assert.ok(!src.includes('visible.slice(0, shownCount)'), 'the key order itself is never sliced');
});

test('Show more is a calm tree row from the theme, never an accent', () => {
  assert.match(src, /className="tree-row tree-showmore"/, 'a tree row of its own');
  const rule = css.match(/\.tree-showmore \{([^}]*)\}/)?.[1] ?? assert.fail('no Show-more rule');
  assert.ok(rule.includes('var(--text-faint)'), 'quiet words from the theme');
  assert.ok(!rule.includes('accent') && !rule.includes('background'), 'never an accent, never a box');
});
