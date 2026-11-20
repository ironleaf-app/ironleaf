// node --test tests/project-files.test.mjs — a project's files as its page lists them
// (src/renderer/src/views/project/fileModel.ts): the pinned documents left out of the folders (never listed twice), kinds
// and their counts, finding by name, folder or description, sorting, folders in order, file addresses on Windows and
// elsewhere, CSV previews.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-files-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/views/project/fileModel.ts'), platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const day = 86400000;
const t0 = Date.UTC(2026, 9, 17);
const f = (rel, ageDays, size = 1000) => ({ rel, name: rel.split('/').pop(), ext: rel.split('.').pop().toLowerCase(), size, modified: t0 - ageDays * day });
// A made-up bakery's folder, grouped as the main side groups it (by top folder, newest first).
const files = {
  folder: 'C:\\Bakery\\Winter menu',
  exists: true,
  total: 9,
  more: 0,
  groups: [
    { name: '', files: [f('RECORD.md', 1, 4000), f('Menu draft.docx', 3, 30000)] },
    { name: 'Costs', files: [f('Costs/Soup costs.xlsx', 0, 20000), f('Costs/Old/Soup costs v1.xlsx', 20, 18000)] },
    { name: 'Photos', files: [f('Photos/Pumpkin soup.jpg', 2, 2400000), f('Photos/Rye loaf.png', 5, 1800000)] },
    { name: 'Suppliers', files: [f('Suppliers/Western Plains Mill quote.pdf', 9, 140000), f('Suppliers/Tasting day.pptx', 30, 900000), f('Suppliers/notes.zip', 40, 50)] },
  ],
};

test('pinned documents are left out of their folders, and a folder of only pinned files goes', () => {
  const pinned = new Set(['menu draft.docx', 'costs/soup costs.xlsx', 'costs/old/soup costs v1.xlsx'].map(F.relKey));
  const groups = F.fileGroups(files, pinned, '', 'all', 'newest');
  assert.deepEqual(groups.map((g) => g.name), ['', 'Photos', 'Suppliers'], 'the folder itself first, then by newest file; Costs is all pinned');
  assert.deepEqual(groups[0].files.map((x) => x.name), ['RECORD.md']);
  assert.equal(groups[0].total, 1);
  assert.equal(F.relKey('Costs\\Soup costs.xlsx'), 'costs/soup costs.xlsx', 'Windows paths are the same file');
});

test('kinds, their counts, and filtering by one', () => {
  const all = files.groups.flatMap((g) => g.files);
  assert.deepEqual(F.categoryCounts(all), [
    { category: 'documents', count: 2 },
    { category: 'spreadsheets', count: 2 },
    { category: 'slides', count: 1 },
    { category: 'pdfs', count: 1 },
    { category: 'pictures', count: 2 },
    { category: 'other', count: 1 },
  ]);
  assert.deepEqual(F.filterFiles(all, '', 'pictures').map((x) => x.name), ['Pumpkin soup.jpg', 'Rye loaf.png']);
  const groups = F.fileGroups(files, new Set(), '', 'spreadsheets', 'newest');
  assert.deepEqual(groups.map((g) => [g.name, g.files.length, g.total]), [['Costs', 2, 2]]);
});

test('finding by words: in the name, the folder, or the description', () => {
  const all = files.groups.flatMap((g) => g.files);
  assert.deepEqual(F.filterFiles(all, 'soup', 'all').map((x) => x.name), ['Soup costs.xlsx', 'Soup costs v1.xlsx', 'Pumpkin soup.jpg']);
  assert.deepEqual(F.filterFiles(all, 'suppliers quote', 'all').map((x) => x.name), ['Western Plains Mill quote.pdf'], 'every word must match, the folder counts');
  assert.deepEqual(F.filterFiles(all, 'flour', 'all', (x) => (x.name === 'Western Plains Mill quote.pdf' ? 'Flour prices for winter' : undefined)).map((x) => x.name), ['Western Plains Mill quote.pdf'], 'descriptions count');
  const groups = F.fileGroups(files, new Set(), 'soup', 'all', 'newest');
  assert.equal(F.groupWords(groups.find((g) => g.name === 'Photos'), true, () => '15 Oct'), '1 of 2 files · newest 15 Oct');
  assert.equal(F.groupWords(groups.find((g) => g.name === 'Costs'), false, () => 'today'), '2 files · newest today');
});

test('sorting: newest, name (numbers in order), size; folders by name when sorted by name', () => {
  const list = [f('Wave 10.docx', 1, 5), f('Wave 2.docx', 3, 50), f('wave 1.docx', 2, 500)];
  assert.deepEqual(F.sortFiles(list, 'newest').map((x) => x.name), ['Wave 10.docx', 'wave 1.docx', 'Wave 2.docx']);
  assert.deepEqual(F.sortFiles(list, 'name').map((x) => x.name), ['wave 1.docx', 'Wave 2.docx', 'Wave 10.docx']);
  assert.deepEqual(F.sortFiles(list, 'size').map((x) => x.name), ['wave 1.docx', 'Wave 2.docx', 'Wave 10.docx']);
  assert.deepEqual(F.fileGroups(files, new Set(), '', 'all', 'name').map((g) => g.name), ['', 'Costs', 'Photos', 'Suppliers']);
});

test('how each file is previewed, and its address on this PC', () => {
  assert.equal(F.viewerFor('JPG'), 'image');
  assert.equal(F.viewerFor('pdf'), 'pdf');
  assert.equal(F.viewerFor('md'), 'markdown');
  assert.equal(F.viewerFor('csv'), 'csv');
  assert.equal(F.viewerFor('xlsx'), 'office');
  assert.equal(F.viewerFor('zip'), 'none');
  assert.ok(F.showsHere('png') && !F.showsHere('docx'));
  assert.equal(F.folderFileUrl('C:\\Bakery\\Winter menu', 'Photos/Pumpkin soup #1.jpg'), 'file:///C:/Bakery/Winter%20menu/Photos/Pumpkin%20soup%20%231.jpg');
  assert.equal(F.folderFileUrl('/home/sam/Bakery/', 'RECORD.md'), 'file:///home/sam/Bakery/RECORD.md');
  assert.equal(F.folderFileUrl('\\\\server\\share\\Bakery', 'a b.pdf'), 'file://server/share/Bakery/a%20b.pdf');
});

test('a CSV preview reads quoted cells and stops at its row limit', () => {
  const rows = F.csvRows('Item,Price,Note\nPumpkin soup,9.50,"Warm, with bread"\n"Rye ""dark"" loaf",7,\n', 10);
  assert.deepEqual(rows, [['Item', 'Price', 'Note'], ['Pumpkin soup', '9.50', 'Warm, with bread'], ['Rye "dark" loaf', '7', '']]);
  assert.equal(F.csvRows('a\nb\nc\nd\n', 2).length, 2);
  assert.deepEqual(F.csvRows('a\tb\n1\t2'), [['a', 'b'], ['1', '2']], 'tab-separated too');
});
