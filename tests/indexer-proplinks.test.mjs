// node --test tests/indexer-proplinks.test.mjs — the index’s property links (src/main/indexer.ts; 10.0 Endless Tech,
// b1links): a note’s [[links]] in its properties are indexed apart from body links (the graph and search read body
// links only), each with its property, kind and line — what the relations seam, renames and the links-to-this-note
// panel read. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-idxprops-'));
let I;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as I from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'i.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ I } = await import(pathToFileURL(path.join(work, 'i.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const now = Date.now();
const set = (index, p, content) => index.set(p, content, now, content.length);

test('property links are indexed with their property, kind and line, apart from body links', () => {
  const index = new I.VaultIndex();
  set(index, 'Bakery/Loyalty cards.md', 'The cards.\n');
  set(index, 'Bakery/Sourdough starter.md', '---\nlinks:\n  - "[[Loyalty cards]]"\n  - "[[Supplier call]]"\nlinks kind:\n  - works with\n  - about\n---\n\nFed [[Loyalty cards]] daily.\n');
  set(index, 'Meetings/Supplier call.md', 'The call.\n');
  const meta = index.allMeta().find((m) => m.path === 'Bakery/Sourdough starter.md');
  assert.deepEqual(meta.propLinks, [
    { key: 'links', target: 'Loyalty cards', kind: 'works with', line: 1 },
    { key: 'links', target: 'Supplier call', kind: 'about', line: 1 },
  ]);
  assert.deepEqual(meta.links.map((l) => l.target), ['Loyalty cards'], 'body links alone, as before');
});

test('the links to a note include the properties linking it, saying which and as what', () => {
  const index = new I.VaultIndex();
  set(index, 'Bakery/Loyalty cards.md', 'The cards.\n');
  set(index, 'Meetings/Supplier call.md', '---\npeople: "[[Loyalty cards]]"\npeople kind: follows up\n---\n\nNo body link here.\n');
  const back = index.backlinks('Bakery/Loyalty cards.md');
  assert.equal(back.length, 1);
  assert.equal(back[0].source, 'Meetings/Supplier call.md');
  assert.equal(back[0].prop, 'people');
  assert.equal(back[0].kind, 'follows up');
  assert.match(back[0].context, /people:/);
});

test('kind siblings, tags, type and aliases are never read as links', () => {
  const index = new I.VaultIndex();
  set(index, 'About.md', 'A note called About.\n');
  set(index, 'Bakery/Sourdough starter.md', '---\nlinks: "[[About]]"\nlinks kind: About\ntags:\n  - About\ntype: About\naliases:\n  - Starter alias\n---\n\nBody.\n');
  const meta = index.allMeta().find((m) => m.path === 'Bakery/Sourdough starter.md');
  assert.deepEqual(meta.propLinks.map((l) => l.target), ['About']);
  assert.deepEqual(meta.propLinks.map((l) => l.key), ['links'], 'only the links themselves');
  // ...but a kind word matching a note must not forge a relation either: one source only.
  assert.equal(index.backlinks('About.md').filter((b) => b.source === 'Bakery/Sourdough starter.md').length, 1);
});
