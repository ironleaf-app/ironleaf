// node --test tests/interface-size.test.mjs — the size of everything (src/shared/interface-size.ts; 5.0.0, 19 Oct 2026):
// six sizes, an older saved size moved to the nearest, Ctrl + plus, minus and 0 read from Electron's key events as a
// browser reads them (never with Alt, the AltGr of European keyboards), the main side stepping aside for keys the person
// changed in Settings › Keys, and the preferences keeping only a real size and density.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-size-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/interface-size.ts'))};\nexport { mergePrefs, loadPrefs, DEFAULT_PREFS } from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const key = (k, extra = {}) => ({ type: 'keyDown', key: k, code: '', control: true, ...extra });

test('six sizes; anything else goes to the nearest, and nonsense to 100%', () => {
  assert.deepEqual([...S.INTERFACE_SIZES], [0.8, 0.9, 1, 1.1, 1.25, 1.5]);
  assert.equal(S.nearestSize(1.05), 1);
  assert.equal(S.nearestSize(1.2), 1.25);
  assert.equal(S.nearestSize(1.6), 1.5);
  assert.equal(S.nearestSize(0.5), 0.8);
  assert.equal(S.nearestSize('big'), 1);
  assert.equal(S.nearestSize(NaN), 1);
  assert.equal(S.sizeWords(1.25), '125%');
});

test('a step goes one size up or down, stops at the ends, and 0 is back to 100%', () => {
  assert.equal(S.stepSize(1, 1), 1.1);
  assert.equal(S.stepSize(1.1, 1), 1.25);
  assert.equal(S.stepSize(1.5, 1), 1.5);
  assert.equal(S.stepSize(0.9, -1), 0.8);
  assert.equal(S.stepSize(0.8, -1), 0.8);
  assert.equal(S.stepSize(1.25, 0), 1);
  // An older 1.05 steps from its nearest size.
  assert.equal(S.stepSize(1.05, 1), 1.1);
});

test('the keys: Ctrl with plus or equals, minus, 0 and the number pad; ⌘ on a Mac; never Alt, a key up or a bare key', () => {
  assert.equal(S.keyStep(key('=')), 1);
  assert.equal(S.keyStep(key('+', { shift: true })), 1);
  assert.equal(S.keyStep(key('+', { code: 'NumpadAdd' })), 1);
  assert.equal(S.keyStep(key('-')), -1);
  assert.equal(S.keyStep(key('_', { shift: true })), -1);
  assert.equal(S.keyStep(key('-', { code: 'NumpadSubtract' })), -1);
  assert.equal(S.keyStep(key('0')), 0);
  assert.equal(S.keyStep(key('0', { code: 'Numpad0' })), 0);
  assert.equal(S.keyStep({ type: 'keyDown', key: '=', meta: true }), 1);
  assert.equal(S.keyStep(key('=', { alt: true })), null);
  assert.equal(S.keyStep(key('=', { type: 'keyUp' })), null);
  assert.equal(S.keyStep({ type: 'keyDown', key: '=' }), null);
  assert.equal(S.keyStep(key(')', { code: 'Digit0', shift: true })), null);
  assert.equal(S.keyStep(key('k')), null);
  assert.equal(S.keyStep(null), null);
});

test('keys changed in Settings › Keys are the page’s: the main side takes only the usual ones', () => {
  assert.equal(S.mainTakesZoomKey(1, {}), true);
  assert.equal(S.mainTakesZoomKey(0, undefined), true);
  // The person moved "Make everything bigger" to other keys, or took its keys away.
  assert.equal(S.mainTakesZoomKey(1, { 'zoom-in': 'Mod+Shift+Up' }), false);
  assert.equal(S.mainTakesZoomKey(1, { 'zoom-in': '' }), false);
  assert.equal(S.mainTakesZoomKey(-1, { 'zoom-in': '' }), true);
  // Ctrl+0 given to another command: that command has it.
  assert.equal(S.mainTakesZoomKey(0, { 'daily-note': 'Mod+0' }), false);
  assert.equal(S.mainTakesZoomKey(1, { 'daily-note': 'Mod+0' }), true);
  assert.equal(S.mainTakesZoomKey(-1, { other: 'Mod+-' }), false);
});

test('preferences keep a real size and density', () => {
  const base = S.DEFAULT_PREFS;
  assert.equal(base.zoom, 1);
  assert.equal(base.density, 'comfortable');
  assert.equal(S.mergePrefs(base, { zoom: 1.18 }).zoom, 1.25);
  assert.equal(S.mergePrefs(base, { zoom: 9 }).zoom, 1.5);
  assert.equal(S.mergePrefs(base, { zoom: 'x' }).zoom, 1);
  assert.equal(S.mergePrefs(base, { density: 'compact' }).density, 'compact');
  assert.equal(S.mergePrefs(base, { density: 'tiny' }).density, 'comfortable');
  // A settings file from before 5.0.0: its slider's 1.05 becomes 100%, and density is Comfortable.
  const old = S.loadPrefs({ zoom: 1.05, theme: 'dark' });
  assert.equal(old.zoom, 1);
  assert.equal(old.density, 'comfortable');
});
