// Template placeholders show as friendly chips, never raw braces (8.6: the checker found {{date}}-style placeholders
// shown raw in the Templates legend and Settings). Help words split on {{variable}} (src/shared/template-vars.ts)
// and the renderer draws each as a chip (components/TemplateVar.tsx); the full {{name}} to type stays on hover, so
// nothing to learn is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-varwords-'));
let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/template-vars.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'vars.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'vars.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('words without a variable stay whole', () => {
  assert.deepEqual(V.splitVarWords('a date from today'), [{ words: 'a date from today' }]);
});

test('each {{variable}} splits out whole, words around it kept', () => {
  assert.deepEqual(V.splitVarWords('In a template, {{title}} is the note’s name, {{project}} the project.'), [
    { words: 'In a template, ' },
    { name: '{{title}}' },
    { words: ' is the note’s name, ' },
    { name: '{{project}}' },
    { words: ' the project.' },
  ]);
});

test('offsets, formats and prompts stay inside their variable', () => {
  assert.deepEqual(V.splitVarWords('{{date+2w}} and {{date:dddd D MMMM}} and {{prompt:Client name|Acme}}'), [{ name: '{{date+2w}}' }, { words: ' and ' }, { name: '{{date:dddd D MMMM}}' }, { words: ' and ' }, { name: '{{prompt:Client name|Acme}}' }]);
});

test('the Templates legend draws chips, not braces', () => {
  // 8.7 wave 2 round 2 (the plan): the legend moved off the Templates page into the template editor.
  const legend = readFileSync(path.join(root, 'src/renderer/src/components/TemplateLegend.tsx'), 'utf8');
  assert.ok(legend.includes('VarChip') && legend.includes('VarWords'), 'the legend uses the chip components');
  assert.doesNotMatch(legend, /<code>\{v\.name\}<\/code>/, 'no raw variable in a code tag');
});

test('every raw {{ in Settings sits inside a chip', () => {
  const settings = readFileSync(path.join(root, 'src/renderer/src/components/Settings.tsx'), 'utf8');
  // A code comment that names a variable (how {{date}} is written) is not shown, so it is not raw in the UI.
  const bad = settings.split('\n').filter((line) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false;
    return /\{\{[A-Za-z]/.test(line) && !line.includes('VarWords') && !line.includes('VarChip');
  });
  assert.deepEqual(bad, []);
});

test('the chip keeps the full name to type on hover', () => {
  const chip = readFileSync(path.join(root, 'src/renderer/src/components/TemplateVar.tsx'), 'utf8');
  assert.match(chip, /title=\{[`'"]Type /, 'hover says what to type');
  assert.match(chip, /tpl-var/, 'the chip has its shared style');
  const css = readFileSync(path.join(root, 'src/renderer/src/styles/templates.css'), 'utf8');
  assert.match(css, /\.tpl-var\s*\{/, 'the shared style exists');
});
