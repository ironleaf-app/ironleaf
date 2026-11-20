// node --test tests/import-no-backwrites.test.mjs — an import never silently changes the notes it brings in (20 Nov
// 2026, decided after the 1,661-file Obsidian import: the relations seam rewrote the relation properties of about 25
// imported notes, templates among them). (1) No back-write ever lands in a template: the templates folder, whatever the
// vault calls it, or a note whose type is template; a template's own relation properties sync nothing. (2) Back-writes
// run only when a relation property is edited (the person, or the assistant on their behalf): never as a side effect of
// an import (folder or vault export, another app, a live source, Markdown files, a spreadsheet) or of reading a vault
// that just opened. Made-up notes only (src/main/relation-sync.ts, src/main/app.ts, the import services, state/imports.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-import-nobw-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/relation-sync.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  const { symlinkSync, mkdirSync } = await import('node:fs');
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('a template is known by its folder (any name, any case) or by type: template', () => {
  assert.equal(R.templateNote('90 Templates/Projects/Register.md', '90 Templates', {}), true);
  assert.equal(R.templateNote('90 templates/Daily.md', '90 Templates/', {}), true);
  assert.equal(R.templateNote('Templates/Meeting.md', 'Templates', {}), true);
  assert.equal(R.templateNote('Notes/Plan skeleton.md', 'Templates', { type: 'template' }), true);
  assert.equal(R.templateNote('Notes/Plan skeleton.md', 'Templates', { type: ['Template'] }), true);
  assert.equal(R.templateNote('90 Templates elsewhere/Note.md', '90 Templates', {}), false);
  assert.equal(R.templateNote('01 Work/Bakery.md', '90 Templates', { type: 'project' }), false);
});

test('back-writes planned into templates are dropped; real notes still get theirs', () => {
  const notes = [
    { path: '01 Work/Bakery.md', title: 'Bakery' },
    { path: '01 Work/Oven quote.md', title: 'Oven quote' },
    { path: '90 Templates/Projects/Register.md', title: 'Register' },
  ];
  const props = { '01 Work/Bakery.md': { type: 'project' }, '01 Work/Oven quote.md': {}, '90 Templates/Projects/Register.md': { type: 'project' } };
  const by = { notes, propsOf: (p) => props[p] ?? {} };
  const planned = R.planSyncAfterWrite({ path: '01 Work/Oven quote.md', title: 'Oven quote' }, '# Oven quote\n', '---\nproject:\n  - "[[Bakery]]"\n  - "[[Register]]"\n---\n# Oven quote\n', by);
  assert.ok(planned.some((w) => w.path === '90 Templates/Projects/Register.md'), 'the planner alone would write into the template');
  const kept = R.withoutTemplates(planned, (p) => R.templateNote(p, '90 Templates', props[p]));
  assert.ok(kept.length >= 1 && kept.every((w) => w.path !== '90 Templates/Projects/Register.md'), 'nothing lands in the template');
  assert.ok(kept.some((w) => w.path === '01 Work/Bakery.md'), 'a real note still gets its back-link');
});

test('the app guards every back-write against templates, and a template’s own edit syncs nothing', () => {
  const app = read('src/main/app.ts');
  const forWrite = app.slice(app.indexOf('async function relationSyncForWrite('), app.indexOf('const withSyncResult'));
  assert.match(forWrite, /if \(isTemplateNote\(rel\)\) return none;/);
  assert.match(forWrite, /withoutTemplates\(/);
  const forCreates = app.slice(app.indexOf('async function relationSyncForCreates('), app.indexOf('async function writeNote('));
  assert.match(forCreates, /!isTemplateNote\(r\)/);
  assert.match(forCreates, /withoutTemplates\(/);
  assert.match(app, /templateNote\(p, settings\.raw\.prefs\.templatesFolder, index\.get\(p\)\?\.props\)/, 'the vault’s own templates folder setting');
});

test('no import writes back: folder and export imports, other apps and live sources, spreadsheets, Markdown files', () => {
  const app = read('src/main/app.ts');
  assert.doesNotMatch(app, /relationsSynced/, 'the import services get no back-write hook');
  assert.doesNotMatch(read('src/main/vault-home-service.ts'), /relationsSynced/);
  assert.doesNotMatch(read('src/main/pairing/service.ts'), /relationsSynced/);
  const csv = app.slice(app.indexOf("handle('import:csv-notes'"), app.indexOf("handle('import:csv-notes'") + 2000);
  assert.doesNotMatch(csv.slice(0, csv.indexOf('    });')), /relationSyncForCreates/, 'a spreadsheet’s rows come in as they are');
  assert.match(app, /if \(\(opts as \{ imported\?: unknown \} \| undefined\)\?\.imported !== true\) await relationSyncForCreates\(v, \[p\], 'you'\);/, 'note:create from an import syncs nothing');
  assert.match(app, /relationSync: \(opts as \{ imported\?: unknown \} \| undefined\)\?\.imported !== true/, 'note:write from an import syncs nothing');
  assert.match(app, /if \(o\.relationSync === false\) return \{ synced: \[\], missed: 0 \};/);
  const imports = read('src/renderer/src/state/imports.ts');
  assert.equal((imports.match(/window\.nv\.notes\.create\([^)]*\{ imported: true \}\)/g) ?? []).length, 2, 'Markdown files are created as imported');
  assert.match(imports, /docs\.writeThrough\(at, f\.text, 'import'\)/, 'and merged as an import (docs.ts carries it: tests/save-docs.test.mjs)');
});

test('reading a vault that just opened writes nothing back (rescan and indexFile never sync)', () => {
  const app = read('src/main/app.ts');
  const rescan = app.slice(app.indexOf('  async function rescan(v: Vault)'), app.indexOf('  const info = (v: Vault)'));
  const indexFile = app.slice(app.indexOf('  async function indexFile('), app.indexOf('  /** The files that aren'));
  for (const body of [rescan, indexFile]) assert.doesNotMatch(body, /relationSync|applyRelationWrites|writeNote\(/);
  const onChange = app.slice(app.indexOf("next.on('change'"), app.indexOf("next.on('rescan'"));
  assert.doesNotMatch(onChange, /relationSync|applyRelationWrites|writeNote\(/, 'an outside change is read, never synced back');
});
