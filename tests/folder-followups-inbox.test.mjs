// node --test tests/folder-followups-inbox.test.mjs — item 1 (8 Nov 2026):
// The Inbox can't be kept out of view. The folder menu doesn't offer it on the
// Inbox folder, and a stored entry for the Inbox is ignored. New captures wait
// there and must never hide. The Daily folder may be kept out; today's note
// still opens from Today.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-followups-inbox-'));
let F;
let PR;
let H;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`,
      `export * as prefsMod from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`,
      `export * as hub from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  F = S.fewer;
  PR = S.prefsMod;
  H = S.hub;
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ctxWith = (quiet) => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  docsFolder: 'Docs',
  areas: [],
  moduleFolders: [],
  quietFolders: quiet,
});

test('a stored Inbox entry is ignored: new captures never hide', () => {
  assert.equal(F.isQuietPath('Inbox/Captured.md', ctxWith(['Inbox'])), false, 'a note in the Inbox reads in view, whatever is stored');
  assert.equal(F.isQuietPath('Inbox', ctxWith(['Inbox'])), false, 'the Inbox itself reads in view');
  assert.equal(F.isQuietPath('Inbox/Captured.md', ctxWith(['inbox/'])), false, 'whatever case or slashes it is stored as');
  assert.equal(F.isMachineryPath('Inbox/Captured.md', ctxWith(['Inbox'])), false, 'never under Show everything either');
  assert.equal(F.isMachineryTop('Inbox', ctxWith(['Inbox'])), false, 'the top never hides');
  assert.equal(F.isQuietFolder(['Inbox'], 'Inbox'), false, 'the exact reading says it is not kept out');
  assert.deepEqual(F.addQuietFolder([], 'Inbox'), [], 'keeping the Inbox adds nothing');
  assert.deepEqual(F.addQuietFolder(['Archive'], 'INBOX'), ['Archive'], 'whatever case');
  assert.deepEqual(F.removeQuietFolder(['Inbox', 'Archive'], 'Archive'), ['Inbox'], 'bringing back another leaves the ignored entry alone');
});

test('the folder menu is not the door for the Inbox', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes('INBOX_FOLDER') || menus.includes("'Inbox'") || menus.includes('"Inbox"'), 'the menu knows the Inbox by name');
  // The Keep out row is conditional on not being the Inbox (not merely relabelled).
  const folderMenu = menus.slice(menus.indexOf('options.isFolder'));
  assert.ok(folderMenu.includes('Keep out of view'), 'folders still offer Keep out of view');
  assert.ok(/Inbox/i.test(folderMenu), 'the folder menu treats the Inbox apart');
});

test('cleaning drops the Inbox on the way in, on both sides', () => {
  const merged = PR.mergePrefs(PR.DEFAULT_PREFS, { quietFolders: ['Inbox', 'Archive'] });
  assert.deepEqual(merged.quietFolders, ['Archive'], 'kept folders are cleaned, the Inbox left out');
  const index = new M.VaultIndex();
  index.set('Inbox/Captured.md', '# Captured\n\nWords.\n', 0, 10);
  index.set('Archive/Old.md', '# Old\n\nWords.\n', 0, 10);
  index.setQuiet(['Inbox', 'Archive']);
  assert.equal(index.isQuiet('Inbox/Captured.md'), false, 'the main side reads the Inbox in view');
  assert.equal(index.isQuiet('Archive/Old.md'), true, 'the rest still hides');
});

test('the Daily folder may be kept out; today’s note still opens from Today', () => {
  assert.deepEqual(F.addQuietFolder([], 'Daily'), ['Daily'], 'Daily can be kept out');
  assert.equal(F.isQuietPath('Daily/2026-11-08.md', ctxWith(['Daily'])), true, 'its notes read quiet');
  // Today’s note is the day’s own: buildDay returns it whatever skip says.
  const day = H.buildDay({
    iso: '2026-11-08',
    notes: [{ path: 'Daily/2026-11-08.md', title: '2026-11-08', mtime: 0, props: {} }],
    dates: () => [],
    daily: { path: 'Daily/2026-11-08.md', exists: true },
    linkedToDaily: [],
    skip: (p) => F.isQuietPath(p, ctxWith(['Daily'])),
    now: new Date(2026, 10, 8, 9, 0),
  });
  assert.equal(day.daily.path, 'Daily/2026-11-08.md', 'the day carries its note’s place');
  assert.equal(day.daily.exists, true, 'and whether it is written yet');
});
