// node --test tests/ocr.test.mjs — words in pictures and scans (src/shared/ocr.ts, src/main/ocr.ts; 9.0 w123ocr,
// 31 Oct 2026: rivals find the words in pictures and scans). Pictures among the notes and scanned PDF pages are
// read by Windows' own recogniser behind a seam (OcrEngine); a fake engine drives every test here, so they prove
// the queue, the store and search without Windows. Made-up pictures and folders in a temporary folder only;
// nothing is written outside the store's own folder, and a source file is never changed.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-ocr-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/ocr.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/ocr.ts'))};\nexport * as GEO from ${JSON.stringify(path.join(root, 'src/renderer/src/views/pdf/geometry.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const vault = mkdtempSync(path.join(tmpdir(), 'nv-ocr-vault-'));
after(() => rmSync(vault, { recursive: true, force: true }));
const put = (rel, bytes) => {
  const abs = path.join(vault, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return abs;
};
const px = (text, x, y, w, h, words) => ({ text, box: [x, y, w, h], words: words ?? [{ text, box: [x, y, w, h] }] });

/** A fake recogniser: canned lines per file (or per PDF page), counting its calls and how many ran at once. */
function fakeEngine(o = {}) {
  const calls = [];
  let running = 0;
  let peak = 0;
  const lines = o.lines ?? { 'Receipts/bunnings.png': [{ page: 1, width: 800, height: 1200, lines: [px('BUNNINGS MORNINGTON', 40, 60, 720, 60), px('TOTAL $42.50', 40, 900, 400, 70)] }] };
  const engine = {
    calls,
    peak: () => peak,
    available: async () => (o.missing ? { ok: false, reason: o.missing } : { ok: true }),
    languages: async () => (o.missing ? [] : [{ tag: 'en-AU', name: 'English (Australia)' }]),
    readImage: async (abs) => {
      calls.push(['image', abs]);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      const rel = path.relative(vault, abs).replace(/\\/g, '/');
      const found = (lines[rel] ?? []).find((l) => l.page === 1) ?? { width: 100, height: 100, lines: [] };
      return { width: found.width, height: found.height, lines: found.lines, lang: 'en-AU' };
    },
    readPdfPage: async (abs, page) => {
      calls.push(['pdf', abs, page]);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      const rel = path.relative(vault, abs).replace(/\\/g, '/');
      const found = (lines[rel] ?? []).find((l) => l.page === page) ?? { width: 800, height: 1100, lines: [] };
      return { width: found.width, height: found.height, lines: found.lines, lang: 'en-AU' };
    },
  };
  return engine;
}

const pdfPages = (map) => async (abs) => map[path.relative(vault, abs).replace(/\\/g, '/')] ?? { pages: 0, empty: [] };

function listing() {
  const out = [];
  const walk = (dir, base) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, name.name);
      const rel = (base ? `${base}/` : '') + name.name;
      if (name.isDirectory()) walk(abs, rel);
      else {
        const s = statSync(abs);
        out.push({ rel, abs, mtime: s.mtimeMs, size: s.size, kind: /\.pdf$/i.test(name.name) ? 'pdf' : 'image' });
      }
    }
  };
  walk(vault, '');
  return out;
}

function queueFor(o) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-ocr-store-'));
  const store = new M.OcrStore(dir);
  const engine = o.engine ?? fakeEngine(o.fake);
  const q = new M.OcrQueue({
    store,
    engine,
    pdfPages: o.pdfPages ?? (async () => ({ pages: 0, empty: [] })),
    prefs: o.prefs ?? (() => ({ on: true, lang: '' })),
    gapMs: 1,
  });
  return { dir, store, engine, q };
}

// ── The shared words and boxes ──────────────────────────────────────────────────────────────────────────────────

test('pictures it reads, and the words a person sees', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif']) assert.ok(M.isOcrImage(ext), ext);
  assert.ok(!M.isOcrImage('svg') && !M.isOcrImage('pdf') && !M.isOcrImage('mp3'));
  assert.equal(M.mediaFoundWords('image'), 'Found in the picture');
  assert.equal(M.mediaFoundWords('pdf', 3), 'Found on page 3 of the scan');
  assert.equal(M.ocrProgressWords(312, 540), '312 of 540 read');
  // Boxes go in as pixels and come out as fractions of the picture, there and back.
  assert.deepEqual(M.normaliseBox([40, 60, 720, 60], 800, 1200), [0.05, 0.05, 0.9, 0.05]);
});

// ── The queue: pictures read in the background ────────────────────────────────────────────────────────────────

test('pictures are read one at a time, with where each line sits, and the files never change', async () => {
  const abs = put('Receipts/bunnings.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  const before = readFileSync(abs);
  const { dir, store, engine, q } = queueFor({});
  q.scan(listing().filter((f) => f.rel === 'Receipts/bunnings.png'));
  await q.idle();
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.peak(), 1, 'one at a time, gentle on the PC');
  const entry = store.get('Receipts/bunnings.png');
  assert.equal(entry.state, 'words');
  assert.deepEqual(entry.pages['1'].map((l) => l.text), ['BUNNINGS MORNINGTON', 'TOTAL $42.50']);
  assert.deepEqual(entry.pages['1'][0].box, [0.05, 0.05, 0.9, 0.05]);
  assert.ok(entry.pages['1'][0].words.length >= 1, 'word boxes for marking the found words');
  const s = q.status();
  assert.equal(s.withWords, 1);
  assert.deepEqual(readFileSync(abs), before, 'the picture itself is never changed');
  // The store keeps only its own files.
  assert.ok(readdirSync(dir).every((n) => n.endsWith('.json')));
  q.stop();
});

test('a restart resumes: nothing read twice, a changed picture read again', async () => {
  put('Receipts/bunnings.png', Buffer.from('89504e470d0a1a0a1', 'hex'));
  put('Photos/hallway.jpg', Buffer.from('ffd81', 'hex'));
  const { dir, store, q, engine } = queueFor({});
  q.scan(listing());
  await q.idle();
  const first = engine.calls.length;
  assert.ok(first >= 2, 'both pictures read');
  await store.flush();
  q.stop();
  // After a restart: the same files are known, so nothing is read again.
  const store2 = new M.OcrStore(dir);
  const engine2 = fakeEngine({});
  const q2 = new M.OcrQueue({ store: store2, engine: engine2, pdfPages: async () => ({ pages: 0, empty: [] }), prefs: () => ({ on: true, lang: '' }), gapMs: 1 });
  q2.scan(listing());
  await q2.idle();
  assert.equal(engine2.calls.length, 0, 'resumed without reading anything again');
  // One picture changed: only it is read again.
  const abs = put('Photos/hallway.jpg', Buffer.from('ffd82-changed', 'hex'));
  const st = statSync(abs);
  q2.noteChanged({ rel: 'Photos/hallway.jpg', abs, mtime: st.mtimeMs + 1000, size: st.size, kind: 'image' });
  await q2.idle();
  assert.equal(engine2.calls.length, 1);
  assert.ok(engine2.calls[0][1].endsWith('hallway.jpg'));
  q2.stop();
});

// ── Scanned PDFs: only the pages with no words ───────────────────────────────────────────────────────────────

test('a PDF’s scanned pages are read, its text pages left alone', async () => {
  const abs = put('Letters/scan.pdf', Buffer.from('%PDF-1.4 fake', 'utf8'));
  const lines = { 'Letters/scan.pdf': [{ page: 2, width: 800, height: 1100, lines: [px('Yours sincerely', 100, 900, 300, 40)] }] };
  const { store, engine, q } = queueFor({ fake: { lines }, pdfPages: pdfPages({ 'Letters/scan.pdf': { pages: 3, empty: [false, true, false] } }) });
  const st = statSync(abs);
  q.scan([{ rel: 'Letters/scan.pdf', abs, mtime: st.mtimeMs, size: st.size, kind: 'pdf' }]);
  await q.idle();
  assert.deepEqual(engine.calls, [['pdf', abs, 2]], 'only the page with no words');
  const entry = store.get('Letters/scan.pdf');
  assert.equal(entry.state, 'words');
  assert.deepEqual(Object.keys(entry.pages), ['2']);
  assert.deepEqual(entry.scanned, [2]);
  // The reader asks page by page: words, still coming, or a page with words of its own.
  assert.equal(M.ocrPageState(entry, 2).state, 'words');
  assert.equal(M.ocrPageState(entry, 1).state, 'clear');
  assert.equal(M.ocrPageState(undefined, 2).state, 'pending');
  q.stop();
});

test('a PDF with words on every page is never sent to the recogniser', async () => {
  const abs = put('Letters/real.pdf', Buffer.from('%PDF-1.4 fake', 'utf8'));
  const { store, engine, q } = queueFor({ pdfPages: pdfPages({ 'Letters/real.pdf': { pages: 2, empty: [false, false] } }) });
  const st = statSync(abs);
  q.scan([{ rel: 'Letters/real.pdf', abs, mtime: st.mtimeMs, size: st.size, kind: 'pdf' }]);
  await q.idle();
  assert.equal(engine.calls.length, 0);
  assert.equal(store.get('Letters/real.pdf').state, 'clear');
  q.stop();
});

// ── Search: hits with positions, private notes never ─────────────────────────────────────────────────────────

test('search finds picture words with their lines', async () => {
  put('Receipts/bunnings.png', Buffer.from('89504e470d0a1a0a2', 'hex'));
  const { store, q } = queueFor({});
  q.scan(listing().filter((f) => f.rel === 'Receipts/bunnings.png'));
  await q.idle();
  const hits = M.searchOcr(store.all(), 'total', {});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'Receipts/bunnings.png');
  assert.equal(hits[0].kind, 'image');
  assert.equal(hits[0].snippets[0].line, 1);
  assert.deepEqual(hits[0].snippets[0].ranges, [[0, 5]], 'where the word falls in the line');
  // The assistant reads the whole of it.
  assert.ok(M.ocrFileText(store.get('Receipts/bunnings.png')).includes('TOTAL $42.50'));
  q.stop();
});

// A scanned PDF's recognised words are found exactly as a picture's (9.0 w123ocr round 2: the reviewer's run found the
// picture's words but no search results at all for the scan, so the scan's search path gets its own test).
test('search finds scan words with their pages, like a picture’s', async () => {
  // A stored reading for page 1, as the queue keeps it for a PDF with an empty page.
  const { store } = queueFor({});
  store.set({ rel: 'Receipts/marina-invoice.pdf', mtime: 1, size: 10, state: 'words', pages: { 1: [{ text: 'REPAIRS $210.00', box: [0, 0, 1, 1], words: [{ text: 'REPAIRS', box: [0, 0, 0.5, 1] }] }] }, scanned: [1] });
  const hits = M.searchOcr(store.all(), 'repairs', {});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'Receipts/marina-invoice.pdf');
  assert.equal(hits[0].kind, 'pdf');
  assert.equal(hits[0].page, 1);
  assert.equal(M.mediaFoundWords(hits[0].kind, hits[0].page), 'Found on page 1 of the scan');
  assert.equal(hits[0].snippets[0].page, 1);
  assert.deepEqual(hits[0].snippets[0].ranges, [[0, 7]], 'where the word falls in the line');
  // And through the queue itself: a PDF with an empty page is read and then found the same way.
  const abs = put('Letters/scan2.pdf', Buffer.from('%PDF-1.4 fake', 'utf8'));
  const st = statSync(abs);
  const lines = { 'Letters/scan2.pdf': [{ page: 1, width: 800, height: 1100, lines: [px('REPAIRS $210.00', 60, 550, 670, 150)] }] };
  const second = queueFor({ fake: { lines }, pdfPages: pdfPages({ 'Letters/scan2.pdf': { pages: 1, empty: [true] } }) });
  second.q.scan([{ rel: 'Letters/scan2.pdf', abs, mtime: st.mtimeMs, size: st.size, kind: 'pdf' }]);
  await second.q.idle();
  const found = M.searchOcr(second.store.all(), 'repairs', {});
  assert.equal(found.length, 1);
  assert.equal(found[0].page, 1);
  assert.equal(M.mediaFoundWords(found[0].kind, found[0].page), 'Found on page 1 of the scan');
  second.q.stop();
});

test('private notes are never read and never found, even when handed over', async () => {
  const abs = put('Private notes/receipt.png', Buffer.from('89504e470d0a1a0a3', 'hex'));
  const { store, engine, q } = queueFor({});
  const st = statSync(abs);
  q.scan([{ rel: 'Private notes/receipt.png', abs, mtime: st.mtimeMs, size: st.size, kind: 'image' }]);
  await q.idle();
  assert.equal(engine.calls.length, 0, 'never read');
  assert.equal(store.get('Private notes/receipt.png'), undefined);
  // And never found, even if words for such a path were somehow kept.
  store.set({ rel: 'Private notes/receipt.png', mtime: 1, size: 1, state: 'words', pages: { 1: [{ text: 'TOTAL $9.99', box: [0, 0, 1, 1], words: [] }] } });
  assert.deepEqual(M.searchOcr(store.all(), 'total', {}), [], 'never found');
  assert.equal(M.ocrFileText(store.get('Private notes/receipt.png') ?? null), null);
  q.stop();
});

test('folders left out of search stay out of picture search too', async () => {
  const { store } = queueFor({});
  store.set({ rel: 'Archive/old.png', mtime: 1, size: 1, state: 'words', pages: { 1: [{ text: 'TOTAL $1.00', box: [0, 0, 1, 1], words: [] }] } });
  assert.equal(M.searchOcr(store.all(), 'total', { isExcluded: (rel) => rel.startsWith('Archive/') }).length, 0);
  assert.equal(M.searchOcr(store.all(), 'total', {}).length, 1);
});

// ── No recogniser: nothing breaks ─────────────────────────────────────────────────────────────────────────────

test('without the recogniser nothing is read, nothing breaks, and search is empty', async () => {
  put('Receipts/other.png', Buffer.from('89504e470d0a1a0a4', 'hex'));
  const { engine, q } = queueFor({ fake: { missing: 'ocr-missing' } });
  q.scan(listing().filter((f) => f.rel === 'Receipts/other.png'));
  await q.idle();
  assert.equal(engine.calls.length, 0);
  const s = q.status();
  assert.equal(s.available, false);
  assert.equal(s.reason, 'ocr-missing');
  assert.equal(s.busy, false);
  assert.deepEqual(M.searchOcr([], 'total', {}), []);
  q.stop();
});

test('9.2 a failed read is tried again after a week, not written off and not hammered', async () => {
  put('Receipts/bad.png', Buffer.from('89504e470d0a1a0a5', 'hex'));
  let calls = 0;
  const engine = { ...fakeEngine(), readImage: async () => { calls++; throw new Error('locked'); } };
  const { store, q } = queueFor({ engine });
  q.scan(listing().filter((f) => f.rel === 'Receipts/bad.png'));
  await q.idle();
  assert.equal(store.get('Receipts/bad.png').state, 'failed');
  assert.equal(calls, 1);
  q.scan(listing().filter((f) => f.rel === 'Receipts/bad.png'));
  await q.idle();
  assert.equal(calls, 1, 'not tried again and again');
  store.set({ ...store.get('Receipts/bad.png'), at: Date.now() - 8 * 24 * 3600 * 1000 });
  q.scan(listing().filter((f) => f.rel === 'Receipts/bad.png'));
  await q.idle();
  assert.equal(calls, 2, 'tried again after its week');
  q.stop();
});

test('9.2 one scan gives its best three pages, not a hit per page', () => {
  const L = (text) => ({ text, box: [0, 0, 1, 1], words: [{ text, box: [0, 0, 1, 1] }] });
  const entry = {
    rel: 'Scans/long.pdf', mtime: 1, size: 1, state: 'words', at: Date.now(), pages: {
      1: [L('total one')], 2: [L('total two total three')], 3: [L('total four')], 4: [L('total five')], 5: [L('nothing here')],
    },
  };
  const hits = M.searchOcr([entry], 'total', {});
  assert.equal(hits.length, 3);
  assert.equal(hits[0].page, 2, 'the page with most hits first');
});

test('switched off, nothing is read and what was kept is kept (9.2 reverses "forgotten": a settings toggle pauses, never wipes hours of readings)', async () => {
  put('Receipts/off.png', Buffer.from('89504e470d0a1a0a5', 'hex'));
  const { store, engine, q } = queueFor({ prefs: () => ({ on: false, lang: '' }) });
  q.scan(listing().filter((f) => f.rel === 'Receipts/off.png'));
  await q.idle();
  assert.equal(engine.calls.length, 0);
  store.set({ rel: 'Receipts/off.png', mtime: 1, size: 1, state: 'words', pages: { 1: [] } });
  q.scan(listing().filter((f) => f.rel === 'Receipts/off.png'));
  await q.idle();
  assert.ok(store.get('Receipts/off.png'), 'kept while off; back on, still fresh, never re-read');
  q.stop();
});

// ── The reader’s recognised-words layer ───────────────────────────────────────────────────────────────────────

test('recognised lines become the page’s words in order, for selecting, copying and finding', () => {
  const lines = [
    { text: 'BUNNINGS MORNINGTON', box: [0, 0, 1, 0.1], words: [] },
    { text: 'TOTAL $42.50', box: [0, 0.8, 0.5, 0.1], words: [] },
  ];
  const t = M.GEO.ocrPageText(lines);
  assert.equal(t.text, 'BUNNINGS MORNINGTON TOTAL $42.50 ');
  assert.deepEqual(t.starts, [0, 20]);
  const found = M.GEO.findAll([t.text], 'total $42.50');
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].start, found[0].end], [20, 32]);
  assert.deepEqual(M.GEO.locate(t, 20, 'start'), { item: 1, char: 0 });
});

// Windows PowerShell 5.1 cannot read .Status on a raw WinRT operation (it reads empty), so polling it waited until the
// timeout and every picture failed on a real PC (31 Oct 2026). Every Windows step is waited on as a .NET task instead.
test('the Windows reader waits on tasks, never on a raw operation status', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'ocr.ts'), 'utf8');
  const ps = src.slice(src.indexOf('const OCR_PS = `'), src.indexOf('`.trim();'));
  assert.ok(ps.length > 500, 'the script is found');
  assert.ok(!/\$op\.Status/.test(ps), 'no polling of a raw operation');
  assert.ok(/WindowsRuntimeSystemExtensions/.test(ps) && /MakeGenericMethod/.test(ps), 'operations become .NET tasks');
  for (const call of ps.matchAll(/\bAwait \(([^\n]*)/g)) assert.ok(/\)\s+(\$\w+|\(WinType '[^']+'\))\s+\d+/.test(call[1]), 'each Await names the result type: ' + call[1].slice(0, 80));
  assert.ok(/AwaitAction \(\$pg\.RenderToStreamAsync/.test(ps), 'a PDF page render (an action, no result) is awaited as one');
});
