// The registry as JSON (8.8): docs/abilities.json for the website's features page, from the one source
// (src/shared/abilities.ts), so the site lists the Vault's abilities without copying them by hand:
//   node tools/export-abilities.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-abilities-'));
try {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src', 'shared', 'abilities.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  const A = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
  const out = path.join(root, 'docs', 'abilities.json');
  writeFileSync(out, `${JSON.stringify(A.abilitiesJson(), null, 2)}\n`);
  console.log(`wrote ${path.relative(root, out)} (${A.ABILITIES.length} abilities)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
