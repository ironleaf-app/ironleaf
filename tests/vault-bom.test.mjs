// node --test tests/vault-bom.test.mjs — a note saved with a byte-order mark (Windows PowerShell 5, older Notepad) reads as
// the note itself (src/main/vault.ts; 18 Oct 2026: a project file written that way was never listed as a project, because
// every front-matter reader looks for "---" at the very start).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let M, work;
before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'nv-bom-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(entry, [`export { Vault, withoutBom } from ${from('src/main/vault.ts')};`, `export { isProjectText, parseProject } from ${from('src/shared/project-file.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  // The vault's file watcher and Recycle Bin come from Electron; reading a note needs neither.
  mkdirSync(path.join(work, 'node_modules', 'electron'), { recursive: true });
  writeFileSync(path.join(work, 'node_modules', 'electron', 'package.json'), '{"name":"electron","type":"module","main":"index.js"}');
  writeFileSync(path.join(work, 'node_modules', 'electron', 'index.js'), 'export const shell = {}; export const app = {}; export default { shell, app };');
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a note with a byte-order mark reads as the note itself, so a project file written that way is a project', async () => {
  const vault = path.join(work, 'vault');
  mkdirSync(path.join(vault, 'Projects', 'Shop'), { recursive: true });
  const text = '---\ntype: project\nstatus: active\n---\n# Shop\n\n## Summary\nA new shop.\n';
  writeFileSync(path.join(vault, 'Projects', 'Shop', 'Shop.md'), '﻿' + text, 'utf8');
  const v = await M.Vault.open(vault);
  const read = await v.read('Projects/Shop/Shop.md');
  assert.equal(read, text);
  assert.equal(await v.readText('Projects/Shop/Shop.md'), text);
  assert.ok(M.isProjectText(read));
  assert.equal(M.withoutBom('plain'), 'plain');
  assert.equal(M.withoutBom(''), '');
});

test('opening sweeps stale crash temps but never a fresh one or a nested vault’s', async () => {
  const vault = path.join(work, 'sweep');
  mkdirSync(path.join(vault, '.neuralvault'), { recursive: true });
  mkdirSync(path.join(vault, 'Inner', '.neuralvault'), { recursive: true });
  writeFileSync(path.join(vault, 'Inner', '.neuralvault', 'vault.json'), '{}');
  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 2 * 3600_000);
  writeFileSync(path.join(vault, 'Plans.md.abc123.nvtmp'), 'crashed');
  utimesSync(path.join(vault, 'Plans.md.abc123.nvtmp'), old, old);
  writeFileSync(path.join(vault, '.neuralvault', 'settings.json.pid.nvtmp'), 'crashed');
  utimesSync(path.join(vault, '.neuralvault', 'settings.json.pid.nvtmp'), old, old);
  writeFileSync(path.join(vault, 'Live.md.fresh.nvtmp'), 'writing now');
  writeFileSync(path.join(vault, 'Inner', 'Inner.md.old.nvtmp'), 'nested');
  utimesSync(path.join(vault, 'Inner', 'Inner.md.old.nvtmp'), old, old);
  const v = await M.Vault.open(vault);
  assert.equal(await v.sweepTemps(), 2, 'the two stale temps go');
  assert.ok(!existsSync(path.join(vault, 'Plans.md.abc123.nvtmp')));
  assert.ok(!existsSync(path.join(vault, '.neuralvault', 'settings.json.pid.nvtmp')));
  assert.ok(existsSync(path.join(vault, 'Live.md.fresh.nvtmp')), 'a fresh temp stays');
  assert.ok(existsSync(path.join(vault, 'Inner', 'Inner.md.old.nvtmp')), 'a nested vault is untouched');
});
