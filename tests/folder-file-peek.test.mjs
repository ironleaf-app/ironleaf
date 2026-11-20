// node --test tests/folder-file-peek.test.mjs — a file in a project's folder opens in the peek (27 Oct 2026;
// src/main/folder-file-peek.ts). Every file the project page's Latest files shows from the project's folder opened as
// "This isn't in the vault any more" unless the Documents list named it. Neutral made-up fixtures only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-ffpeek-'));
let F, R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { peekWithFolderFiles } from ${JSON.stringify(path.join(root, 'src/main/folder-file-peek.ts'))};\nexport { buildRecordModel } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = R = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('every file in a project’s folder opens with its details; only one gone from it says so', async () => {
  const folder = path.join(work, 'PC', '12 Store move');
  mkdirSync(path.join(folder, 'Designs', 'Store photos', 'assets'), { recursive: true });
  writeFileSync(path.join(folder, 'Designs', 'Store photos', 'assets', 'register-20.jpg'), Buffer.alloc(170000));
  writeFileSync(path.join(folder, 'Plan.pdf'), '%PDF');
  const project = 'Work/Projects/Store move/Store move.md';
  const content = `---\ntype: project\nfolder: ${folder}\n---\n# Store move\n\n## Documents\n\n- \`Plan.pdf\` — the plan\n`;
  const model = R.buildRecordModel({ notes: [{ path: project, title: 'Store move', content, props: { type: 'project', folder } }], resolve: () => null, today: '2026-10-27' });
  const folderOf = (p) => (p === project ? folder : undefined);
  const named = await F.peekWithFolderFiles(model, { type: 'file', path: project, folderFile: 'Plan.pdf' }, folderOf);
  assert.equal(named?.record.title, 'Plan.pdf', 'a file the Documents list names opens as before');
  const other = await F.peekWithFolderFiles(model, { type: 'file', path: project, folderFile: 'Designs/Store photos/assets/register-20.jpg' }, folderOf);
  assert.ok(other, 'a file the Documents list doesn’t name opens too (it said "This isn’t in the vault any more")');
  assert.equal(other.record.title, 'register-20.jpg');
  assert.equal(other.record.folderFile, 'Designs/Store photos/assets/register-20.jpg');
  assert.deepEqual(other.record.facts.map((f) => f.value).slice(0, 3), ['JPG', 'The project’s folder › Designs › Store photos › assets', '166 KB']);
  assert.equal(other.projectTitle, 'Store move');
  assert.equal(await F.peekWithFolderFiles(model, { type: 'file', path: project, folderFile: 'Gone.docx' }, folderOf), null, 'a file not in the folder any more still says so');
  assert.equal(await F.peekWithFolderFiles(model, { type: 'file', path: project, folderFile: '../../outside.txt' }, folderOf), null, 'nothing outside the project’s folder');
});
