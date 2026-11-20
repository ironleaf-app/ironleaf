// node --test tests/synced-blocks-88.test.mjs — synced blocks (src/shared/synced-blocks.ts; 8.8 database
// depth): one block of text shown in several notes, edited anywhere, changed everywhere. The block is stored once in
// its own note under Synced blocks/; each use is a plain ![[embed]] of it, which other apps read as an embed. The
// editor draws the live block with "Edit the original" and "Unsync here". Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-syncblocks-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as S from ${JSON.stringify(path.join(root, 'src/shared/synced-blocks.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'sync.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ S } = await import(pathToFileURL(path.join(work, 'sync.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const notes = [
  { path: 'Synced blocks/Opening hours.md', title: 'Opening hours' },
  { path: 'Bakery/Pie week.md', title: 'Pie week' },
];

test('a synced block is its own note under Synced blocks/, placed by a plain embed', () => {
  assert.equal(S.isSyncedPath('Synced blocks/Opening hours.md'), true);
  assert.equal(S.isSyncedPath('synced blocks/opening hours.MD'), true);
  assert.equal(S.isSyncedPath('Bakery/Pie week.md'), false);
  assert.equal(S.isSyncedPath('Synced blocks.md'), false);
  assert.equal(S.syncRefFor('Synced blocks/Opening hours.md'), '![[Synced blocks/Opening hours]]');
  assert.equal(S.syncedPathOf('Synced blocks/Opening hours', notes), 'Synced blocks/Opening hours.md');
  assert.equal(S.syncedPathOf('Opening hours', notes), 'Synced blocks/Opening hours.md', 'its title alone finds it');
  assert.equal(S.syncedPathOf('Pie week', notes), null, 'an ordinary note is not a synced block');
  assert.equal(S.syncedPathOf('Nobody wrote this', notes), null);
});

test('a new synced block keeps its words exactly, and is named for them', () => {
  const body = 'Open 7am to 3pm, Tuesday to Sunday.\n\n- [ ] Put the sign out';
  assert.equal(S.makeSyncedFile('Opening hours', body), `${body}\n`);
  assert.equal(S.nameFromText('# Opening hours\n\nOpen 7am to 3pm.'), 'Opening hours');
  assert.equal(S.nameFromText('- [ ] Put the sign out'), 'Put the sign out');
  assert.equal(S.nameFromText(''), 'Synced block');
});

test('two notes show the one block; unsyncing here puts its words in place of the embed', () => {
  const first = '# Pie week\n\n![[Synced blocks/Opening hours]]\n';
  const second = '# Market stall\n\n![[Opening hours]]\n';
  assert.equal(S.syncedPathOf('Synced blocks/Opening hours', notes), S.syncedPathOf('Opening hours', notes), 'both embeds name the one file');
  const body = 'Open 7am to 3pm, Tuesday to Sunday.';
  assert.equal(S.unsyncRef(first, 'Synced blocks/Opening hours', body), '# Pie week\n\nOpen 7am to 3pm, Tuesday to Sunday.\n');
  assert.equal(S.unsyncRef(second, 'Opening hours', body), '# Market stall\n\nOpen 7am to 3pm, Tuesday to Sunday.\n');
  assert.equal(S.unsyncRef(first, 'Nobody wrote this', body), null, 'no such embed, nothing changes');
});
