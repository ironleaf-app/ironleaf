// node --test tests/first-ten-minutes.test.mjs — a new person's first ten minutes (5 Nov 2026): the Vault's half.
// Fewer gates, fewer words, nothing asked twice. Each source check fails without its fix.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(e)) out.push(f);
  }
  return out;
};

test('the setup card counts its steps honestly: five small steps', () => {
  // t156, 9 Nov 2026: the fifth row (Start from a template, 8.8) came after the lead was written — the lead said
  // four while five rows followed. The lead names five now, as listed.
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('Five small steps'), 'five steps, as listed');
  assert.ok(!home.includes('Four small steps'), 'no wrong count is left');
});

test('the first step writes here; capture stays one click below', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const write = home.indexOf('Write your first note');
  const capture = home.indexOf('Capture from anywhere');
  assert.ok(write > 0 && capture > write, 'write first, capture second');
  assert.ok(/onClick=\{\(\) => void A\.newNote\(\)\}>New note</.test(home), 'New note makes the note');
  for (const kept of ['>Capture</button>', '>Packs</button>', '>Open</button>', '>Start</button>']) {
    assert.ok(home.includes(kept), 'still one click: ' + kept);
  }
});

test('packs are called Packs everywhere a person reads (Settings › Modules is gone)', () => {
  const bad = [];
  for (const f of walk(path.join(root, 'src'))) {
    if (readFileSync(f, 'utf8').includes('Settings › Modules')) bad.push(path.relative(root, f));
  }
  assert.equal(bad.length, 0, 'no stale path: ' + bad.join(', '));
  assert.ok(read('src/renderer/src/lib/settingsSearch.ts').includes("modules: 'packs'"), 'old modules links still land on Packs');
});

test('the welcome note is short: yours, write, link, ask, and going', () => {
  const src = read('src/main/welcome.ts');
  const note = src.slice(src.indexOf('`'), src.lastIndexOf('`'));
  assert.ok(note.split('\n').length < 30, 'under 30 lines, not a 45-line manual');
  for (const kept of ['They are yours', '[[', '## Ask', 'Ctrl+O', 'Ctrl+K', '## Get going', "Open today's note"]) {
    assert.ok(note.includes(kept), 'kept: ' + kept);
  }
  for (const gone of ['Alt+F10', 'Windows+H', 'Ctrl+Shift+F', 'Ctrl+J', 'Private notes', 'six-colour']) {
    assert.ok(!note.includes(gone), 'left for the app to teach: ' + gone);
  }
});

test('a new welcome never overwrites a note someone wrote', () => {
  const app = read('src/main/app.ts');
  const at = app.indexOf('Welcome to Ironleaf.md');
  assert.ok(at > 0 && app.slice(at, at + 400).includes("flag: 'wx'"), 'new vaults only: wx never overwrites');
});

test('the readme names the command keys the app uses', () => {
  assert.ok(read('README.md').includes('every command (Ctrl+K)'), 'Ctrl+K, as the app and the note say');
});
