// node --test tests/dropdowns-styled.test.mjs — every drop-down styled (30 Oct 2026): the global select rule in
// styles.css gives every select the app's chevron, height, line, hover and disabled, and no page class takes the
// chevron back off. Fails without each rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('every select wears the app control', () => {
  const css = read('src/renderer/src/styles.css');
  const rule = css.match(/select:not\(\[multiple\]\) \{([^}]*)\}/s)?.[1] ?? '';
  for (const bit of ['appearance: none', "url(\"data:image/svg+xml", 'min-height: 36px', 'padding-right: 32px', 'cursor: pointer'])
    assert.ok(rule.includes(bit), `the global select rule has ${bit}`);
  assert.ok(/select:not\(\[multiple\]\):hover:not\(:disabled\)/.test(css), 'hover is styled');
  assert.ok(/select:disabled \{[^}]*opacity: 0\.55/.test(css), 'disabled is styled');
  assert.ok(css.includes('select:focus'), 'focus keeps its ring from the field rule');
});

test('no select rule takes the chevron back off', () => {
  const pub = read('src/renderer/src/styles/publications.css');
  assert.ok(pub.includes('select.pb-input { padding-right: 32px; }'), 'publication selects keep room for the chevron');
  const rec = read('src/renderer/src/styles/record-modules.css');
  assert.ok(rec.includes('.bi-account select { -webkit-appearance: none;'), 'bank import selects carry the chevron too');
});
