// node --test tests/open-pdf.test.mjs — "Open a PDF in the reader…" end to end from the palette (8.9 w114pdf
// round 2: round 1 ran the command, the palette closed, and then no picker opened — closing the palette cancelled the
// pick its command had just opened, in the same frame). Made-up vaults in temporary folders, never anyone's real
// vault: PDFs anywhere among the files (notes folders, Assets, attachments beside notes) are what the real listing
// holds and what the command offers, by file name; with none the command says so where the reviewer looks; and a
// closing window never cancels a pending pick while an opening one still does.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-open-pdf-'));
let S; // src/shared/pdf-highlights.ts
let M; // src/renderer/src/state/modals.ts
let V; // src/main/vault.ts
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/pdf-highlights.ts'), platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  const electron = { name: 'electron-stand-in', resolveId: (id) => (id === 'electron' ? '\0electron' : null), load: (id) => (id === '\0electron' ? 'export const shell = { trashItem: async () => {} }; export const app = { getPath: () => "" };' : null) };
  await build({ input: path.join(root, 'src/main/vault.ts'), platform: 'node', plugins: [electron], output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  V = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export { modalChangeCancelsPick } from ${JSON.stringify(path.join(root, 'src', 'renderer', 'src', 'state', 'modals.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const put = (dir, rel, data = 'x') => {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};

test('PDFs anywhere in the vault are what the command offers, by file name', async () => {
  const dir = path.join(work, 'vault');
  put(dir, 'Reading/Harbour.pdf', '%PDF-1.4\n');
  put(dir, 'Reading/Anchor.pdf', '%PDF-1.4\n');
  put(dir, 'Assets/Brand.pdf', '%PDF-1.4\n');
  put(dir, 'Notes/Trip/Files/Zebra.PDF', '%PDF-1.4\n');
  put(dir, 'Reading/Harbour (highlights).md', '# Harbour: highlights\n');
  put(dir, 'Notes/Trip/Visit.md', '# Visit\n');
  put(dir, 'Assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const v = await V.Vault.open(dir);
  const { files } = await v.listAll();
  v.close();
  for (const rel of ['Reading/Harbour.pdf', 'Reading/Anchor.pdf', 'Assets/Brand.pdf', 'Notes/Trip/Files/Zebra.PDF']) {
    assert.equal(files.find((f) => f.rel === rel)?.kind, 'pdf', `${rel} is listed as a PDF`);
  }
  // The command offers exactly this list (the same function it calls): every PDF wherever it sits, notes and
  // pictures left out, by file name whatever the folder.
  assert.deepEqual(
    S.pdfChoices(files),
    ['Reading/Anchor.pdf', 'Assets/Brand.pdf', 'Reading/Harbour.pdf', 'Notes/Trip/Files/Zebra.PDF'],
  );
});

test('with no PDFs there is nothing to offer, and the command says so where the reviewer looks', async () => {
  const dir = path.join(work, 'empty');
  put(dir, 'Notes/Visit.md', '# Visit\n');
  put(dir, 'Assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const v = await V.Vault.open(dir);
  const { files } = await v.listAll();
  v.close();
  assert.deepEqual(S.pdfChoices(files), [], 'nothing to pick');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes('No PDFs among your notes yet.'), 'openPdf says so when there are none');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('className="toast" role="status"'), 'the message shows where the reviewer looks (.toast, [role=status])');
});

test('a closing window never cancels a pending pick; an opening one still does', () => {
  // The palette's sequence: it opens (nothing pending), the person runs the command, the palette closes and the
  // command's picker opens in the same frame. The old window effect cancelled on every change, so the close killed
  // the picker before it showed; the rule keeps the opening cancel and drops the closing one.
  assert.equal(M.modalChangeCancelsPick(null, 'palette'), true, 'a window opening over the page cancels a pick');
  assert.equal(M.modalChangeCancelsPick('palette', null), false, 'the palette closing for its command cancels nothing');
  assert.equal(M.modalChangeCancelsPick(null, null), false);
  assert.equal(M.modalChangeCancelsPick('palette', 'palette'), false);
  assert.equal(M.modalChangeCancelsPick('palette', 'search'), true, 'another window opening still cancels');
});

test('wired: the palette command offers the PDFs through a picker, and the window uses the rule', () => {
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes(`id: 'open-pdf'`) && commands.includes(`name: 'Open a PDF in the reader…'`), 'the palette command');
  assert.ok(commands.includes('pdfChoices(getState().files)'), 'openPdf offers every PDF in the vault listing');
  assert.ok(commands.includes(`pickFile('Open which PDF?'`), 'the picker the reviewer waits for (its placeholder)');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('modalChangeCancelsPick('), 'the window cancels a pick by the rule');
  assert.ok(app.includes('[modal?.kind]'), 'the rule runs when the window changes');
  assert.ok(!app.includes('[pageNow.id, pageNow.type, pageNow.path, modal?.kind]'), 'closing the window no longer cancels with the page');
  assert.ok(app.includes('[pageNow.id, pageNow.type, pageNow.path]') && app.includes('cancelPick()'), 'changing page still cancels a pick (sweep 058)');
});
