// node --test tests/pdf-thumbs.test.mjs — first-page pictures of PDFs (src/main/pdf-thumbs.ts; 17 Oct 2026: Windows'
// own thumbnail call returned nothing for PDFs on the PC). The name a picture is kept under follows the file's path,
// time and size; a kept picture is found again; a PDF that couldn't be drawn is remembered (it keeps its designed
// tile); only small PNG or WebP pictures are kept, under a proper name; non-PDFs and big PDFs are never read.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pdf-thumbs-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/main/pdf-thumbs.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...new Array(20).fill(0)]);

test('the name a picture is kept under follows the path, the time and the size', () => {
  const a = M.pdfThumbKey('/x/Scope.pdf', 1000, 10);
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.equal(M.pdfThumbKey('/x/Scope.pdf', 1000.2, 10), a, 'the same file, the same name');
  assert.notEqual(M.pdfThumbKey('/x/Scope.pdf', 2000, 10), a, 'changed since: drawn again');
  assert.notEqual(M.pdfThumbKey('/x/Scope.pdf', 1000, 11), a);
  assert.notEqual(M.pdfThumbKey('/y/Scope.pdf', 1000, 10), a);
});

test('a PDF: its bytes to draw first; the picture once kept; changed, drawn again; broken, its tile for good', async () => {
  const store = new M.PdfThumbs(path.join(work, 'cache'));
  const pdf = path.join(work, 'Scope.pdf');
  writeFileSync(pdf, '%PDF-1.4\n%made up\n');
  const first = await store.page(pdf);
  assert.ok(first.key && first.bytes instanceof Uint8Array && first.bytes.byteLength > 0, 'its bytes, to draw');
  const url = await store.save(first.key, WEBP);
  assert.ok(url.startsWith('file://') && url.endsWith('.webp'));
  assert.deepEqual(await store.page(pdf), { url }, 'kept: found again without reading the PDF');
  // The PDF changes: a new name, drawn again.
  utimesSync(pdf, new Date(), new Date(Date.now() + 5000));
  const again = await store.page(pdf);
  assert.ok(again.key && again.key !== first.key);
  // It couldn't be drawn (broken, protected): remembered, so its designed tile stays and it isn't tried every time.
  assert.equal(await store.save(again.key, null), null);
  assert.deepEqual(await store.page(pdf), { failed: true });
});

test('only small PNG or WebP pictures, under a proper name; never a non-PDF, an empty or a huge one', async () => {
  const store = new M.PdfThumbs(path.join(work, 'cache2'));
  const key = 'a'.repeat(40);
  assert.ok(M.isPagePicture(PNG) && M.isPagePicture(WEBP));
  assert.ok(!M.isPagePicture(new TextEncoder().encode('<script>alert(1)</script>....')));
  await assert.rejects(store.save(key, new Uint8Array(40)), /Not a picture/);
  await assert.rejects(store.save('../../evil', PNG), /name/);
  assert.ok((await store.save(key, PNG)).endsWith('.png'));
  assert.ok(!existsSync(path.join(work, 'cache2', `${key}.png.part`)));
  const doc = path.join(work, 'Notes.docx');
  writeFileSync(doc, 'not a pdf');
  assert.deepEqual(await store.page(doc), { failed: true });
  const empty = path.join(work, 'Empty.pdf');
  writeFileSync(empty, '');
  assert.deepEqual(await store.page(empty), { failed: true });
  assert.ok(M.MAX_PDF_BYTES >= 50 * 1024 * 1024);
});
