// node --test tests/vault-keys-count.test.mjs — Settings › Keys counts what it shows (t21, 8 Nov 2026). The "N
// changed" count read every command while the list shows the survivors once, so a changed alias key the list hides
// still counted and the count and the list disagreed. The count reads the shown rows only. Since the t28 follow-up
// an alias's keys show under its survivor as sub-rows, so the shown rows are the survivors with their keyed
// aliases, and the count counts those — still never a key the list hides. Fails first: the count reads COMMANDS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = () => readFileSync(path.join(root, 'src/renderer/src/components/Settings.tsx'), 'utf8');
const keysFn = () => {
  const src = settings();
  return src.slice(src.indexOf('function Keys('), src.indexOf('function Keys(') + 7000);
};

test('the changed count counts the shown rows, survivors and alias keys alike', () => {
  const keys = keysFn();
  assert.ok(keys.includes('listedCommands()'), 'the list shows the survivors once');
  assert.ok(keys.includes('keyedAliases(COMMANDS, prefs.hotkeys, c.id)'), 'each with its keyed aliases beneath');
  assert.ok(/const changed = rows\.filter\(/.test(keys), 'the count reads the shown rows');
  assert.ok(!/const changed = COMMANDS\.filter\(/.test(keys), 'never every command behind it');
});

test('a changed row still marks itself where it shows', () => {
  const keys = keysFn();
  assert.ok(keys.includes('const isChanged = prefs.hotkeys[c.id] !== undefined'), 'each shown row marks its own change');
  assert.ok(keys.includes('{changed} changed from the default'), 'the count still says what it is');
});
