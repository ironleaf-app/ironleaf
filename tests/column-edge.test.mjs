// One content column edge for every page (8.6: the checker found page titles, tabs and first cards starting at
// different left edges). A page-level tab strip starts its first tab at the column edge (no side padding of its own
// inside the page frame), the Timeline's banner shares the head and board inset, and activating a tab never changes
// its width (a bolder active tab widened the Projects strip until it scrolled and clipped its first tab,
// 024-Projects-Finished in the sweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const shell = read('styles/polish-shell.css');

test('page-level tab strips carry no second gutter inside the frame', () => {
  for (const strip of ['.rm-page > .rm-tabs', '.sv-page > .rm-tabs', '.pv-page > .rm-tabs', '.sv-page > .ar-kinds', '.sv-page > .ar-modules']) {
    assert.ok(shell.includes(strip), `${strip} is settled to the frame edge`);
  }
  const block = /\.sv-page > \.sv-head,([\s\S]*?)\{([^}]*)\}/.exec(shell);
  assert.ok(block, 'the no-second-gutter block is there');
  assert.match(block[2], /padding-left:\s*0/, 'strips start at the column edge');
  assert.match(block[2], /padding-right:\s*0/, 'strips end at the column edge');
});

test("the Timeline's banner shares the head and board inset", () => {
  assert.match(shell, /\.tl-needs[^{]*\{[^}]*var\(--page-pad-side\)/, 'tl-needs uses the frame inset, not its own 28 px');
});

test('activating a tab never changes its width', () => {
  const actives = [
    ['styles.css', '.pj-filter.active'],
    ['styles/record-modules.css', '.rm-tab.is-on'],
    ['styles/life.css', '.ar-kind.on'],
    ['styles/kit.css', '.chip.on'],
    ['styles/life.css', '.seg > button.on'],
  ];
  for (const [file, selector] of actives) {
    const css = read(file);
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} exists in ${file}`);
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    assert.doesNotMatch(body, /font-weight/, `${selector} shows active without a bolder (wider) word`);
  }
});
