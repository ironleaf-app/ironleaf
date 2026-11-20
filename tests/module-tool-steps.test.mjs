// node --test tests/module-tool-steps.test.mjs — every module tool carries its own step words to the former host app
// (src/shared/ module-tools.ts MODULE_TOOLS, src/shared/life-tools.ts; src/main/app.ts modules.tools() hands the former
// host app each tool's step, module and module name), so the former host app's step row says "Checked the bills due in
// Money", never "Looked in Ironleaf's Money" or a tool's code name. A module added later is held to the same.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-steps-'));
let T, L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'steps.ts');
  writeFileSync(entry, [`export * as T from ${JSON.stringify(path.join(root, 'src/shared/module-tools.ts'))};`, `export * as LT from ${JSON.stringify(path.join(root, 'src/shared/life-tools.ts'))};`, `export * as L from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'steps.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  ({ T, L } = await import(pathToFileURL(path.join(work, 'steps.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('every module tool has its own step words, in plain words, and belongs to a module in the catalogue', () => {
  assert.ok(T.MODULE_TOOLS.length >= 20, 'Finance, Documents, Health, Family, the work modules and Publications are all there');
  for (const t of T.MODULE_TOOLS) {
    assert.ok(typeof t.step === 'string' && t.step.trim().length >= 8, `${t.name} has step words`);
    assert.notEqual(t.step, t.name, `${t.name}'s step is not its code name`);
    assert.doesNotMatch(t.step, /_|^Looked in Ironleaf/, `${t.name}'s step is its own words: "${t.step}"`);
    assert.ok(L.moduleInfo(t.module), `${t.name}'s module (${t.module}) is in the catalogue, so the host app gets its name`);
  }
  const finance = T.MODULE_TOOLS.find((t) => t.name === 'finance_bills_due');
  assert.equal(finance.step, 'Checked the bills due in Money');
});

test('Ironleaf hands the host app each tool’s step, module and module name (src/main/app.ts modules.tools)', () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const line = app.split('\n').find((l) => /const view = \(t: \(typeof MODULE_TOOLS\)\[number\], off = false\) => \(\{/.test(l));
  assert.ok(line, 'the list the host app asks for');
  for (const field of ['step: t.step', 'module: t.module', 'moduleName: moduleInfo(t.module)?.name']) assert.ok(line.includes(field), `it carries ${field}`);
});
