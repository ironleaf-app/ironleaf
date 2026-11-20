// node --test tests/settings-save-race.test.mjs — settings.json survives saves at the same moment (20 Nov 2026, the on
// the first Windows build). Opening a vault and an import each save settings.json several times at once (rememberVault,
// useVault, setCurrent from the vault home, setCurrent again once the synced places are known). Every save went through
// one temp file named by the process id, so the second rename failed with ENOENT (the vault's opening stopped halfway,
// and a failed open forgot the vault), and two writes into the same temp could leave half of one and half of the other,
// which the next start read as no settings at all. Real files in a temp folder; made-up paths only
// (src/main/settings.ts, src/main/library-state.ts).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-settings-race-'));
let ST, LS;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const eDir = path.join(work, 'node_modules', 'electron');
  mkdirSync(eDir, { recursive: true });
  writeFileSync(path.join(eDir, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', type: 'module', main: './index.mjs', exports: { '.': './index.mjs' } }));
  writeFileSync(path.join(eDir, 'index.mjs'), `export const app = { getPath: () => ${JSON.stringify(path.join(work, 'appdata'))} };\n`);
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { SettingsStore } from ${JSON.stringify(path.join(root, 'src/main/settings.ts'))};\nexport { LibraryState } from ${JSON.stringify(path.join(root, 'src/main/library-state.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['electron', 'yaml'], output: { file: path.join(work, 'entry.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ SettingsStore: ST, LibraryState: LS } = await import(pathToFileURL(path.join(work, 'entry.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const pcWith = (name, settings) => {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  return dir;
};

test('a vault opening and an import saving at once: no save fails, settings.json stays whole and current', async () => {
  const vault = path.join(work, 'Documents', 'Ironleaf');
  const dir = pcWith('pc-a', { library: vault, lastVault: vault, recentVaults: [vault] });
  const s = new ST(dir);
  await s.load();
  // The saves an opening and an import make together, none awaited before the next starts (as app.ts and
  // vault-home-service.ts do), of different lengths, so a mixed file would not read as JSON.
  const all = [];
  for (let i = 0; i < 40; i++) {
    all.push(s.rememberVault(i % 2 ? vault : path.join(work, 'Other', `Vault ${i}`)));
    all.push(s.setCurrent({ path: vault, id: `id-${i}`, name: 'Ironleaf'.repeat(1 + (i % 7)), ...(i % 3 ? { place: 'onedrive', placeName: 'OneDrive' } : {}) }));
    all.push(s.update({ dailyFolder: `Daily ${'x'.repeat(i % 13)}` }));
  }
  const results = await Promise.allSettled(all);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message ?? r.reason));
  assert.deepEqual(failed, [], 'no save failed (one shared temp made the second rename fail with ENOENT)');
  const text = readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const disk = JSON.parse(text);
  assert.equal(disk.current.id, 'id-39', 'the last save is what is on disk');
  assert.equal(disk.lastVault, vault);
  assert.equal(disk.library, vault, 'the library is still known');
  assert.deepEqual(readdirSync(dir).filter((n) => /tmp$/.test(n)), [], 'no temp left behind');
  // The next start reads the same settings, not the defaults.
  const again = new ST(dir);
  await again.load();
  assert.equal(again.raw.library, vault);
  assert.equal(again.raw.current?.id, 'id-39');
});

test('the vault’s own state files beside settings (moved.json and friends) save at once without failing', async () => {
  const dir = path.join(work, 'pc-b');
  mkdirSync(dir, { recursive: true });
  const ls = new LS(dir);
  const vault = path.join(work, 'Vault B');
  mkdirSync(vault, { recursive: true });
  const all = [];
  for (let i = 0; i < 30; i++) all.push(ls.save(vault, 'graph', { n: i, pad: 'y'.repeat(i * 3) }));
  const results = await Promise.allSettled(all);
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)), []);
});

test('memories read together as a vault opens each move in once, and moved.json keeps every name', async () => {
  const dir = path.join(work, 'pc-c');
  mkdirSync(dir, { recursive: true });
  const vault = path.join(work, 'Vault C');
  mkdirSync(vault, { recursive: true });
  const ls = new LS(dir);
  const said = [];
  ls.log = (m) => said.push(m);
  ls.useVault(vault);
  const names = ['graph', 'brief', 'reviews', 'bookmarks', 'workspace', 'projects', 'templates', 'timeline'];
  await Promise.all(names.map((n) => ls.load(vault, n)));
  assert.deepEqual(said, [], 'nothing fell back to this PC’s copy (a shared temp made moved.json fail with ENOENT)');
  const movedIn = (pc) => {
    const libs = path.join(pc, 'libraries');
    return JSON.parse(readFileSync(path.join(libs, readdirSync(libs)[0], 'moved.json'), 'utf8')).names.sort();
  };
  // The same memories read one after another on a fresh PC: the names a together-read must also keep.
  const dir2 = path.join(work, 'pc-d');
  mkdirSync(dir2, { recursive: true });
  const one = new LS(dir2);
  one.useVault(vault);
  for (const n of names) await one.load(vault, n);
  const expected = movedIn(dir2);
  assert.ok(expected.length >= 2, `several memories have a vault part (${expected})`);
  assert.deepEqual(movedIn(dir), expected, 'every memory that moved in is named in moved.json');
});
