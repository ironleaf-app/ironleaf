// The clean-room build check (docs/CLEAN-ROOM.md): every asset listed with its licence, bundled packages under allowed
// licences, and no other notes app's name in the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const walk = (dir) => readdirSync(path.join(root, dir)).flatMap((name) => {
  const rel = `${dir}/${name}`;
  return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
});

test('every asset is listed in ASSETS.md', () => {
  const list = read('ASSETS.md');
  const assets = [...walk('resources'), ...walk('src/renderer/src/assets')];
  const missing = assets.filter((f) => !list.includes(path.basename(f)));
  assert.deepEqual(missing, [], `Not in ASSETS.md: ${missing.join(', ')}`);
});

test('bundled packages carry allowed licences', () => {
  const pkg = JSON.parse(read('package.json'));
  // A choice of licences is taken under its permissive one: JSZip is (MIT OR GPL-3.0-or-later), used under MIT.
  const allowed = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|OFL-1\.1|\(MPL-2\.0 OR Apache-2\.0\)|\(MIT OR GPL-3\.0-or-later\)|Unlicense)$/;
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const bad = [];
  for (const name of names) {
    let license = '';
    try {
      const meta = JSON.parse(read(`node_modules/${name}/package.json`));
      // The older form, "licenses": [{ "type": "MIT" }] (ssh2), counts the same.
      license = meta.license ?? meta.licenses?.[0]?.type ?? '';
    } catch {
      continue;
    }
    if (!allowed.test(license)) bad.push(`${name} (${license || 'none'})`);
  }
  assert.deepEqual(bad, [], `Licences to check: ${bad.join(', ')}`);
});

test('no other notes app is named in the source', () => {
  const files = [...walk('src'), ...walk('tools'), ...walk('sample-vault')].filter((f) => /\.(ts|tsx|js|mjs|cjs|css|html|md|json|py|ps1)$/.test(f));
  const named = files.filter((f) => /obsidian/i.test(read(f)));
  assert.deepEqual(named, [], `A vendor name appears in: ${named.join(', ')}`);
});
