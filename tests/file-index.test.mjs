// node --test tests/file-index.test.mjs — searching inside project files (src/main/doc-text.ts, src/main/file-index.ts;
// 17 Oct 2026). Tiny Word, Excel and PowerPoint files and a PDF are made here; their words are read (the zip reader,
// the XML, PDF.js in its worker). A made-up IT project's folder is gone through: found by words with the lines marked,
// a change re-reads only that file, the limits hold, junk is left out, nothing is written in the folder or outside the
// index's own folder, nothing is read outside the folder, and switching a project off forgets it.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-file-index-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/doc-text.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/file-index.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/file-index.ts'))};\nexport { AgentTools } from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Tiny files made here ──────────────────────────────────────────────────────────────────────────────────────────

/** A zip of { name: text }, deflated (or stored with `store`). */
function zip(files, { store = false } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const packed = store ? data : zlib.deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (...runs) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;
function docx(body, header = '') {
  return zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    ...(header ? { 'word/header1.xml': `<w:hdr ${W}>${p(header)}</w:hdr>` } : {}),
  });
}

function xlsx() {
  return zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Dates &amp; times" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Harbourline </t></r><r><t>lighting refit</t></r><rPh><t>ignored</t></rPh></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="d mmm yyyy"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>48200</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Paid</t></is></c><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>SSL renewed</v></c><c r="B1" s="1"><v>46308</v></c></row></sheetData></worksheet>',
  });
}

function pptx() {
  const slide = (words) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${words.map((w) => `<a:p><a:r><a:t>${w}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return zip({
    'ppt/presentation.xml': '<p:presentation/>',
    'ppt/slides/slide10.xml': slide(['Last slide']),
    'ppt/slides/slide2.xml': slide(['Rollout plan', 'Wave 2 in November']),
    'ppt/slides/slide1.xml': slide(['Studio Upgrade', 'Monthly update']),
    'ppt/notesSlides/notesSlide2.xml': slide(['Mention the SSL certificate', '2']),
  });
}

/** A one-page (or more) PDF with the words given, in Helvetica. */
function pdf(pages) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map((l, i) => `BT /F1 14 Tf 72 ${720 - i * 20} Td (${l}) Tj ET`).join('\n');
    const content = add(`<</Length ${stream.length}>>stream\n${stream}\nendstream`);
    kids.push(add(`<</Type/Page/Parent ${pagesObj} 0 R/MediaBox[0 0 612 792]/Contents ${content} 0 R/Resources<</Font<</F1 ${font} 0 R>>>>>>`));
  }
  objs[catalog - 1] = `<</Type/Catalog/Pages ${pagesObj} 0 R>>`;
  objs[pagesObj - 1] = `<</Type/Pages/Kids[${kids.map((k) => `${k} 0 R`).join(' ')}]/Count ${kids.length}>>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj${body}endobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer<</Size ${objs.length + 1}/Root ${catalog} 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const pdfJs = () => ({ lib: path.join(root, 'src/renderer/src/assets/pdfjs/pdf.min.mjs'), worker: path.join(root, 'src/renderer/src/assets/pdfjs/pdf.worker.min.mjs') });

// ── Reading files ─────────────────────────────────────────────────────────────────────────────────────────────────

test('the zip reader: deflated and stored files back as they were; not a zip, refused; too big unpacked, refused', async () => {
  for (const store of [false, true]) {
    const buf = zip({ 'a.txt': 'hello', 'folder/ü.xml': '<x>née</x>' }, { store });
    const entries = M.zipEntries(buf);
    assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'folder/ü.xml']);
    assert.equal((await M.zipRead(buf, entries[1])).toString('utf8'), '<x>née</x>');
  }
  assert.throws(() => M.zipEntries(Buffer.from('not a zip at all, just some words here')), /Not a zip/);
  const big = zip({ 'big.xml': 'x'.repeat(200_000) });
  await assert.rejects(M.zipRead(big, M.zipEntries(big)[0], 1000), 'a file that unpacks past the limit is refused');
});

test('a Word document: paragraphs, tabs, table rows side by side, entities; deleted words and field codes left out; headers too', async () => {
  const body =
    p('Harbourline quote for the ', 'lighting refit') +
    '<w:p><w:r><w:t>Total</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>$48,200 &amp; GST</w:t></w:r></w:p>' +
    '<w:p><w:del><w:r><w:delText>old price $51,000</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>Valid 30 days</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc>' + p('Room') + '</w:tc><w:tc>' + p('Boardroom') + '</w:tc></w:tr><w:tr><w:tc>' + p('Screens') + '</w:tc><w:tc>' + p('2 &lt;85"&gt;') + '</w:tc></w:tr></w:tbl>';
  const text = await M.docxText(docx(body, 'Kaitiaki IT · Confidential'));
  const lines = text.split('\n');
  assert.equal(lines[0], 'Harbourline quote for the lighting refit');
  assert.equal(lines[1], 'Total $48,200 & GST', 'a tab reads as a space');
  assert.equal(lines[2], 'Valid 30 days', 'deleted words and field codes are not the document’s words');
  assert.ok(lines.includes('Room | Boardroom') && lines.includes('Screens | 2 <85">'), text);
  assert.ok(text.endsWith('Kaitiaki IT · Confidential'), 'the header comes after the body');
  await assert.rejects(M.docxText(zip({ 'x.xml': '<x/>' })), /Not a Word/);
});

test('a workbook: sheets in the book’s order, shared and inline words, true/false, dates as dates, money as written', async () => {
  const text = await M.xlsxText(xlsx());
  assert.equal(text, ['\fBudget', 'Item | Cost', 'Harbourline lighting refit | 48200', 'Paid | TRUE', '\fDates & times', 'SSL renewed | 13 Oct 2026'].join('\n'));
  assert.equal(M.excelDate(46308), '13 Oct 2026');
});

test('an Excel serial as its day: whole days, never rounded up, or nothing when it is not a day (O5)', () => {
  assert.equal(M.excelDate(45658), '1 Jan 2025');
  assert.equal(M.excelDate(45658.75), '1 Jan 2025', 'six in the evening stays on its day');
  assert.equal(M.excelSerialIso(45658), '2025-01-01');
  assert.equal(M.excelSerialIso('45658'), '2025-01-01');
  assert.equal(M.excelSerialIso(45658.75), '2025-01-01');
  assert.equal(M.excelSerialIso('hello'), null);
  assert.equal(M.excelSerialIso(0), null);
  assert.equal(M.excelSerialIso(''), null);
});

test('a presentation: slides in their order (2 before 10), with the speaker’s notes', async () => {
  const text = await M.pptxText(pptx());
  assert.equal(text, ['\fslide 1', 'Studio Upgrade', 'Monthly update', '\fslide 2', 'Rollout plan', 'Wave 2 in November', 'Notes: Mention the SSL certificate', '\fslide 10', 'Last slide'].join('\n'));
});

test('text files: UTF-8, UTF-16 from Windows tools, not text, and web pages without their tags', () => {
  assert.equal(M.plainText(Buffer.from('﻿line one\r\nline two'), 'txt'), 'line one\nline two');
  assert.equal(M.plainText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('SSL cert renewed', 'utf16le')]), 'log'), 'SSL cert renewed');
  assert.equal(M.plainText(Buffer.from([0x50, 0x00, 0x01, 0x02]), 'txt'), null);
  assert.match(M.plainText(Buffer.from('<html><style>x{}</style><p>Hello &amp; welcome</p></html>'), 'html'), /Hello & welcome/);
});

test('a PDF: its words page by page with PDF.js in a worker; a broken one fails without harm', async () => {
  const reader = new M.PdfReader(pdfJs);
  try {
    const text = await reader.read(new Uint8Array(pdf([['Harbourline quote', 'Total 48200 inc GST'], ['SSL update 13 Oct']])));
    assert.match(text, /^\fpage 1\nHarbourline quote/);
    assert.match(text, /\fpage 2\nSSL update 13 Oct/);
    await assert.rejects(reader.read(new Uint8Array(Buffer.from('%PDF-1.4 broken'))));
    // Still reads after a broken one.
    assert.match(await reader.read(new Uint8Array(pdf([['Again']]))), /Again/);
  } finally {
    reader.stop();
  }
});

test('one file: what can be read, what is found by name, what is too big', async () => {
  const dir = path.join(work, 'one');
  mkdirSync(dir, { recursive: true });
  const put = (name, data) => {
    writeFileSync(path.join(dir, name), data);
    return [path.join(dir, name), name.split('.').pop(), statSync(path.join(dir, name)).size];
  };
  assert.equal((await M.readFileText(...put('a.docx', docx(p('Hello'))), { pdf: null })).state, 'text');
  assert.equal((await M.readFileText(...put('b.png', Buffer.alloc(10)), { pdf: null })).state, 'name', 'pictures: by name only');
  assert.equal((await M.readFileText(...put('c.docx', Buffer.from('not really')), { pdf: null })).state, 'failed');
  assert.ok((await M.readFileText(...put('c2.docx', Buffer.from('not really')), { pdf: null })).why?.length, 'a broken file says why (9.2)');
  assert.equal((await M.readFileText(...put('d.msg', Buffer.alloc(10)), { pdf: null })).state, 'name', 'an email needs the host app');
  const bridged = await M.readFileText(...put('e.msg', Buffer.alloc(10)), { pdf: null, bridge: async () => 'From: Harbourline\nSubject: Quote' });
  assert.deepEqual([bridged.state, bridged.text], ['text', 'From: Harbourline\nSubject: Quote'], 'inside the host app, its reader reads it');
  const long = await M.readFileText(...put('f.txt', 'word '.repeat(1000)), { pdf: null, maxChars: 100 });
  assert.deepEqual([long.state, long.text.length, long.cut], ['text', 100, true]);
});

// ── A project's folder ────────────────────────────────────────────────────────────────────────────────────────────

/** A made-up IT project's folder (and junk that must be left out). */
function makeFolder(name) {
  const folder = path.join(work, name);
  const put = (rel, data) => {
    mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
    writeFileSync(path.join(folder, rel), data);
  };
  put('Quotes/Harbourline quote.docx', docx(p('Harbourline quote for the lighting refit') + p('Total $48,200 inc GST')));
  put('Status/Status update 13 Oct.md', '# Status\n\nSSL certificate renewed on the web server.\nNext: the Wi-Fi survey.\n');
  put('Budget.xlsx', xlsx());
  put('Rollout.pptx', pptx());
  put('Contacts.csv', 'name,role\nAroha Ngata,Cafe manager\n');
  put('Photos/Boardroom.jpg', Buffer.alloc(64));
  put('Scope.pdf', pdf([['Scope of works'], ['Boardroom screens', 'SSL for the booking site']]));
  put('.hidden/secret.txt', 'SSL hidden');
  put('node_modules/pkg/readme.md', 'SSL junk');
  put('~$Harbourline quote.docx', 'lock file');
  return folder;
}

function makeIndex(dir, projects, prefs = { on: true, off: [] }, extra = {}) {
  const statuses = [];
  const index = new M.FileIndex({ dir, pdf: new M.PdfReader(pdfJs), projects: () => projects, prefs: () => prefs, onStatus: (s) => statuses.push(s), watch: false, ...extra });
  return { index, statuses };
}

const listAll = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(`${path.relative(dir, abs)}|${statSync(abs).size}|${statSync(abs).mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort();
};

test('a project’s folder: found by its words, the words marked, with the page or sheet; by name too; junk left out', async () => {
  const folder = makeFolder('Studio Upgrade');
  const before = listAll(folder);
  const store = path.join(work, 'store-a');
  const { index, statuses } = makeIndex(store, [{ path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade', folder }]);
  try {
    await index.sync();
    await index.idle();
    const s = index.status();
    assert.equal(s.files, 7, 'seven files; hidden, Office’s own ~$ and node_modules left out');
    assert.equal(s.withText, 6, 'the picture is found by name only');
    assert.ok(statuses.some((x) => x.busy && x.todo > 0), 'a progress line while it reads');
    assert.equal(statuses.at(-1).busy, false);

    const tessaly = index.search('Harbourline quote');
    assert.equal(tessaly[0].rel, 'Quotes/Harbourline quote.docx', 'its name and words: first');
    assert.equal(tessaly[0].projectName, 'Studio Upgrade');
    const total = index.search('48,200')[0];
    assert.equal(total.rel, 'Quotes/Harbourline quote.docx');
    const sn = total.snippets[0];
    assert.equal(sn.text.slice(sn.ranges[0][0], sn.ranges[0][1]), '48,200', 'the words are marked');

    const ssl = index.search('SSL');
    const rels = ssl.map((h) => h.rel).sort();
    assert.deepEqual(rels, ['Budget.xlsx', 'Rollout.pptx', 'Scope.pdf', 'Status/Status update 13 Oct.md'], 'never the hidden or junk copies');
    assert.equal(ssl.find((h) => h.rel === 'Scope.pdf').snippets[0].where, 'page 2');
    assert.equal(ssl.find((h) => h.rel === 'Rollout.pptx').snippets[0].where, 'slide 2');
    assert.equal(index.search('13 Oct 2026')[0].snippets[0].where, 'Dates & times', 'a date in a sheet reads as a date');
    const photo = index.search('boardroom jpg');
    assert.deepEqual([photo[0].rel, photo[0].byName], ['Photos/Boardroom.jpg', true], 'a picture by its name');
    assert.equal(index.search('"SSL update 13 Oct" -nothing').length, 0);
    assert.ok(index.search('/48,?200/').length, 'patterns work as in the notes’ search');
    assert.equal(index.search('SSL', { project: 'Projects/Other/Other.md' }).length, 0, 'kept to one project');

    // Read for the assistant: from the index; never outside the folder.
    const read = await index.read('Studio Upgrade', 'Quotes/Harbourline quote.docx');
    assert.match(read.file.text, /Total \$48,200 inc GST/);
    await assert.rejects(index.read('Studio Upgrade', '../store-a/x.json'), /isn’t in the project’s folder/);
    await assert.rejects(index.read('Studio Upgrade', 'Nope.docx'), /There is no/);
    await index.flush();
  } finally {
    index.stop();
  }
  assert.deepEqual(listAll(folder), before, 'nothing in the project’s folder is written, touched or added');
  assert.deepEqual(readdirSync(store).filter((n) => !n.endsWith('.json')), [], 'the index keeps only its own files, in its own folder');
});

test('a change re-reads only the files that changed; a file gone is dropped; kept between runs', async () => {
  const folder = makeFolder('Wifi Refresh');
  const store = path.join(work, 'store-b');
  let reads = 0;
  const pdfReader = new M.PdfReader(pdfJs);
  const counting = { read: (...a) => (reads++, pdfReader.read(...a)), stop: () => pdfReader.stop() };
  const projects = [{ path: 'Projects/Wifi Refresh/Wifi Refresh.md', name: 'Wifi Refresh', folder }];
  const { index } = makeIndex(store, projects, undefined, { pdf: counting });
  try {
    await index.sync();
    await index.idle();
    assert.equal(reads, 1, 'the PDF read once');
    writeFileSync(path.join(folder, 'Status/Status update 13 Oct.md'), '# Status\n\nCertificate swapped for the new one.\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(folder, 'Status/Status update 13 Oct.md'), later, later);
    rmSync(path.join(folder, 'Contacts.csv'));
    index.checkAll();
    await index.idle();
    assert.equal(reads, 1, 'the PDF didn’t change: not read again');
    assert.equal(index.search('Certificate swapped')[0].rel, 'Status/Status update 13 Oct.md', 'the changed file’s new words');
    assert.equal(index.search('"SSL certificate renewed"').length, 0, 'its old words are gone');
    assert.equal(index.search('Aroha').length, 0, 'a file gone is dropped');
    await index.flush();
  } finally {
    index.stop();
  }
  // A new run (Ironleaf opened again): what was kept is used, nothing read again.
  reads = 0;
  const again = makeIndex(store, projects, undefined, { pdf: counting }).index;
  try {
    await again.sync();
    await again.idle();
    assert.equal(reads, 0, 'kept between runs');
    assert.ok(again.search('Scope of works').length);
  } finally {
    again.stop();
  }
});

test('the limits: a big file by name only; the index full, the rest by name; files in a folder, at most so many', async () => {
  const folder = makeFolder('Caps');
  writeFileSync(path.join(folder, 'Huge.txt'), 'SSL '.repeat(400));
  const store = path.join(work, 'store-c');
  const { index } = makeIndex(store, [{ path: 'Projects/Caps/Caps.md', name: 'Caps', folder }], undefined, { limits: { textBytes: 1000, totalChars: 300, files: 100 } });
  try {
    await index.sync();
    await index.idle();
    const huge = index.search('Huge')[0];
    assert.deepEqual([huge.state, huge.byName], ['big', true]);
    const s = index.status();
    assert.ok(s.chars <= 300, `kept ${s.chars} characters, the most is 300`);
    const states = new Set(index.search('.', { limit: 100 }).map((h) => h.state));
    assert.ok(states.has('full'), 'once full, files are found by name only');
  } finally {
    index.stop();
  }
  const few = makeIndex(path.join(work, 'store-d'), [{ path: 'Projects/Caps/Caps.md', name: 'Caps', folder }], undefined, { limits: { files: 3 } }).index;
  try {
    await few.sync();
    await few.idle();
    assert.equal(few.status().files, 3, 'the newest three only');
  } finally {
    few.stop();
  }
});

test('never outside the folder: a link out of it isn’t followed or read', async () => {
  const folder = makeFolder('Links');
  const outside = path.join(work, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'private.md'), 'Harbourline secret outside');
  try {
    symlinkSync(outside, path.join(folder, 'Shortcut'), 'dir');
    symlinkSync(path.join(outside, 'private.md'), path.join(folder, 'private.md'));
  } catch {
    return; // This PC doesn't allow links: nothing to check.
  }
  const { index } = makeIndex(path.join(work, 'store-e'), [{ path: 'Projects/Links/Links.md', name: 'Links', folder }]);
  try {
    await index.sync();
    await index.idle();
    assert.equal(index.search('secret').length, 0, 'what a link leads to is not indexed');
    await assert.rejects(index.read('Links', 'private.md'), /isn’t in the project’s folder/);
    await assert.rejects(index.read('Links', 'Shortcut/private.md'), /isn’t in the project’s folder/);
  } finally {
    index.stop();
  }
});

test('switched off for a project, or entirely: not searched, and what was kept is forgotten', async () => {
  const folder = makeFolder('Switch');
  const store = path.join(work, 'store-f');
  const prefs = { on: true, off: [] };
  const projects = [{ path: 'Projects/Switch/Switch.md', name: 'Switch', folder }];
  const { index } = makeIndex(store, projects, prefs);
  try {
    await index.sync();
    await index.idle();
    await index.flush();
    assert.ok(index.search('Harbourline').length);
    assert.equal(readdirSync(store).length, 1);
    prefs.off = ['Projects/Switch/Switch.md'];
    await index.sync();
    assert.equal(index.search('Harbourline').length, 0);
    assert.equal(index.status().projects[0].on, false);
    assert.deepEqual(readdirSync(store), [], 'what was kept for it is deleted');
    prefs.off = [];
    await index.sync();
    await index.idle();
    assert.ok(index.search('Harbourline').length, 'back on: read again');
    prefs.on = false;
    await index.sync();
    assert.equal(index.search('Harbourline').length, 0);
    assert.equal(index.status().on, false);
    await index.flush();
    assert.equal(existsSync(store) ? readdirSync(store).length : 0, 0, 'off entirely: nothing kept');
  } finally {
    index.stop();
  }
});

test('the assistant’s link to a file: written and read back', () => {
  const href = M.projectFileHref('Projects/Gallery Fit-out (Harbourline)/Gallery Fit-out (Harbourline).md', 'Quotes/Harbourline quote #2.pdf');
  assert.match(href, /^nv-file:[^ ]+$/, 'no spaces: a Markdown link keeps it whole');
  assert.deepEqual(M.parseProjectFileHref(href), { project: 'Projects/Gallery Fit-out (Harbourline)/Gallery Fit-out (Harbourline).md', rel: 'Quotes/Harbourline quote #2.pdf' });
  assert.equal(M.parseProjectFileHref('https://example.com'), null);
});

test('the assistant: searches inside project files and reads one, read only, with the link to give', async () => {
  const folder = makeFolder('Assistant');
  const projects = [{ path: 'Projects/Studio Upgrade/Studio Upgrade.md', name: 'Studio Upgrade', folder }];
  const { index } = makeIndex(path.join(work, 'store-g'), projects);
  const before = listAll(folder);
  try {
    await index.sync();
    await index.idle();
    const steps = [];
    const host = { index: null, projectFiles: { search: (q, p, l) => index.search(q, { ...(p ? { project: p } : {}), limit: l }), read: (p, r) => index.read(p, r), projects: () => projects, status: () => index.status() } };
    const tools = new M.AgentTools(host, [], (s) => steps.push(s));
    const found = await tools.run({ id: 'a', name: 'search_project_files', arguments: JSON.stringify({ query: 'Harbourline quote' }) });
    assert.ok(!found.isError, found.text);
    assert.match(found.text, /^Studio Upgrade · Quotes\/Harbourline quote\.docx \(Word document, \d+ K?B, changed \d{4}-\d\d-\d\d\)/);
    assert.match(found.text, /link: \[Harbourline quote\.docx\]\(nv-file:Projects%2FStudio%20Upgrade%2FStudio%20Upgrade\.md\/Quotes%2FHarbourline%20quote\.docx\)/);
    assert.match(found.text, /Harbourline quote for the lighting refit/);
    const read = await tools.run({ id: 'b', name: 'read_project_file', arguments: JSON.stringify({ project: 'studio upgrade', path: 'Quotes/Harbourline quote.docx' }) });
    assert.match(read.text, /Total \$48,200 inc GST/);
    const pdfRead = await tools.run({ id: 'c', name: 'read_project_file', arguments: JSON.stringify({ project: 'Studio Upgrade', path: 'Scope.pdf' }) });
    assert.match(pdfRead.text, /\[page 2\]\nBoardroom screens/, 'pages are marked in words');
    const outside = await tools.run({ id: 'd', name: 'read_project_file', arguments: JSON.stringify({ project: 'Studio Upgrade', path: '../store-g/x' }) });
    assert.ok(outside.isError);
    const none = await tools.run({ id: 'e', name: 'search_project_files', arguments: JSON.stringify({ query: 'zebra crossing' }) });
    assert.match(none.text, /No project file matches/);
    assert.deepEqual(steps.map((s) => s.words).slice(0, 2), ['Searched the project files for “Harbourline quote”', 'Read Harbourline quote.docx in Studio Upgrade']);
  } finally {
    index.stop();
  }
  assert.deepEqual(listAll(folder), before, 'reading for the assistant changes nothing');
});

// 19 Oct 2026: a file attached to the assistant's chat is read from its bytes (the window hands over the file, never a
// path): Word, PDF and text as words, an unknown kind read as text when it is text, a picture-only PDF or a binary said
// in words, a long one cut and marked; the former host app's reader gets a copy that is removed straight after.
test('a file attached to the chat: its words from its bytes, or why not in words', async () => {
  const reader = new M.PdfReader(pdfJs);
  const tmpDir = path.join(work, 'attach-read');
  const read = (name, buf, extra = {}) => M.attachmentText(name, buf, { pdf: reader, tmpDir, maxChars: 2000, ...extra });
  try {
    const word = await read('Harbourline quote.docx', docx('<w:p><w:r><w:t>Total $48,200 inc GST</w:t></w:r></w:p>'));
    assert.equal(word.cut, false);
    assert.match(word.text, /Total \$48,200 inc GST/);
    const paper = await read('Quote.pdf', pdf([['Harbourline quote'], ['SSL update 13 Oct']]));
    assert.match(paper.text, /^\[page 1\]\nHarbourline quote/, 'pages marked in words: ' + JSON.stringify(paper));
    assert.match(paper.text, /\[page 2\]\nSSL update 13 Oct/);
    assert.match((await read('server.toml', Buffer.from('[server]\nport = 19132\n'))).text, /port = 19132/, 'an unknown kind that is text is read as text');
    assert.match((await read('setup.exe', Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x01]))).error, /Only pictures and documents/);
    const scan = await read('Scan.pdf', pdf([[]]));
    assert.equal(scan.scanned, true, 'a PDF with no words is said as a scan (the chat sends its pages as pictures)');
    assert.match((await read('broken.pdf', Buffer.from('%PDF-1.4 broken'))).error, /couldn’t be read/);
    const long = await read('long.txt', Buffer.from('word '.repeat(1000)));
    assert.equal(long.cut, true);
    assert.equal(long.text.length, 2000);
    // Inside the former host app: an old Word file goes to its reader as a copy, removed after.
    let given = '';
    const old = await read('Letter.doc', Buffer.from('old word bytes'), { bridge: async (abs) => ((given = abs), existsSync(abs) ? 'Dear Jesse' : null) });
    assert.equal(old.text, 'Dear Jesse');
    assert.ok(given.startsWith(tmpDir) && given.endsWith('.doc') && !existsSync(given), 'the copy is removed straight after');
    assert.match((await read('Letter.doc', Buffer.from('x'))).error, /older kind of document/, 'on its own, an old Word file is said, not read as text');
  } finally {
    reader.stop();
  }
});
