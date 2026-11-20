// node --test tests/uplift-92-identity.test.mjs — the 9.2 uplift's identity batch (F40, F49, F84,
// F86, F87, F125, F141, F153): project chips resolve once, never a silent title pick; module rows join by
// note path through one helper; synced blocks reuse identical words and undo their own insert; made-as-type
// links are written from the made note's path with failures named; picker rows carry their query plus a
// stable file key; flow ids are unique even double-clicked. Each check pins the mechanism, failing without it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-identity-'));
let ids;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/ids.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  ids = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('project chips resolve once, never a silent title pick (F40)', () => {
  const src = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(src.includes('resolveNote(ref, n.path)'), 'one resolution');
  assert.ok(src.includes('viaPath ? projects.find((p) => p.path === viaPath) : undefined'), 'path match or nothing');
  assert.doesNotMatch(src, /toLowerCase\(\) === ref\.toLowerCase\(\)/, 'no title fallback');
});

test('module rows join by note path through one helper (F49)', () => {
  const shell = read('src/renderer/src/views/modules/work/WorkShell.tsx');
  assert.ok(shell.includes('export const sameRecord'), 'one join helper');
  assert.ok(shell.includes('aPath && bPath ? aPath === bPath'), 'paths when both known');
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.equal((vendors.match(/sameRecord\(v\.path \|\| null, v\.name, x\.vendorPath, x\.vendor\)/g) ?? []).length, 2, 'both joins share it');
  const weekly = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  const pathAt = weekly.indexOf("endsWith(`/${n}`)");
  const nameAt = weekly.indexOf('p.name.toLowerCase() === n');
  assert.ok(pathAt > 0 && nameAt > pathAt, 'identity before display name');
});

test('synced blocks reuse identical words, never a 2 copy (F84)', () => {
  const src = read('src/renderer/src/editor/syncedBlocks.ts');
  assert.ok(src.includes("body.replace(/\\s+$/, '') === words"), 'content compared');
  assert.ok(src.includes('Used the'), 'reuse said');
  assert.ok(src.includes('window.nv.notes.read(b.path)'), 'blocks read for it');
});

test('synced-block undo puts back its own insert (F153)', () => {
  const src = read('src/renderer/src/editor/syncedBlocks.ts');
  assert.ok(src.includes('indexOf(ref, Math.min(from, doc.length))'), 'at or after where placed');
  assert.ok(src.includes('const from = range.from;'), 'the insert remembered');
});

test('made-as-type links come from the made note, failures named (F86, F87)', () => {
  const src = read('src/renderer/src/editor/typeLinks.ts');
  assert.ok(src.includes('function makeThen'), 'made first, linked after');
  assert.ok(src.includes('insert(view, from, to, name, type, path)'), 'the link from the made path');
  assert.ok(src.includes('Could not make'), 'failures name the note');
  assert.doesNotMatch(src, /pathFor|void make\(/, 'no assumed path, no unhandled make');
  assert.ok(read('src/renderer/src/editor/setup.ts').includes('linkTarget(made, host.path)'), '[[]] links from the made path');
  assert.ok(src.includes('writeLink(made, host, linkTarget(made, host) !== name ? { alias: name } : {})'), '@ links from the made path, aliased (F154)');
});

test('picker rows carry their query plus a stable file key (F125)', () => {
  const src = read('src/renderer/src/components/FileHits.tsx');
  assert.ok(src.includes('byQuery = new Map<string, FileHit[]>()'), 'each query keeps its own answers');
  assert.ok(src.includes('`${h.project}\\n${h.rel}`'), 'stable file identity');
  assert.ok(src.includes('encodeURIComponent(q)'), 'the query in the id');
  assert.doesNotMatch(src, /pf:\$\{i\}|last\.hits\[/, 'no positions into one latest list');
});

test('flow ids are unique even double-clicked (F141)', () => {
  const made = new Set(Array.from({ length: 500 }, () => ids.uniqueId('flow')));
  assert.equal(made.size, 500, '500 ids, 500 different');
  assert.ok([...made].every((id) => id.startsWith('flow-')), 'the prefix kept');
  assert.ok(read('src/renderer/src/components/CaptureFlowsSettings.tsx').includes("uniqueId('flow')"), 'Add a flow uses it');
});
