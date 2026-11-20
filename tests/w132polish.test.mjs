// node --test tests/w132polish.test.mjs — the live-check polish of 31 Oct 2026 (9.0 job w132polish): Settings ›
// General › About › Where your notes are kept names the folder of the vault that is open, saying in a few words when
// that is not the usual place; opening the folder opens the folder named. Fails before the fix (it named the library
// while another vault was open).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the row names the open vault, saying when it is not the usual place', () => {
  const src = read('src/renderer/src/components/Settings.tsx');
  assert.ok(src.includes('vault?.path ?? library'), 'it reads the open vault first, the library only while none is open');
  assert.ok(src.includes('Not your usual vault') && src.includes('tag slate'), 'another place says so in a few words, on a tag the one-line hint cannot clip');
  assert.ok(!src.includes('hint={`${library} — open its folder to check.`}'), 'the library-only hint is gone');
});

test('opening the folder opens the folder named', () => {
  const main = read('src/main/app.ts');
  assert.ok(main.includes("handle('path:reveal'") && main.includes('shell.openPath(v.root)'), 'Show opens the open vault');
  const place = read('src/renderer/src/components/VaultPlace.tsx');
  assert.ok(place.includes("window.nv.files.reveal('')"), 'Details offers it on the open vault');
});
