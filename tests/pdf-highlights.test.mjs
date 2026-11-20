// node --test tests/pdf-highlights.test.mjs — the PDF reader's highlights (19 Oct 2026, 5.0.0): the highlights note
// beside a PDF (src/shared/pdf-highlights.ts) is written readable and read back the same, keeps what the person wrote
// (their words under a highlight, their own opening, a colour changed by hand), drops a highlight whose quote they
// deleted, and links into the PDF as [[Report.pdf#page=4&hl=id]]; and the reader's arithmetic
// (src/renderer/src/views/pdf/geometry.ts): boxes on the screen to the PDF's units and back at any zoom and turn, a
// selection's boxes tidied into one per line, zoom sizes, and finding words.
// (31 Oct 2026, 8.9 read and highlight PDFs in the Vault): clips of a pictured or scanned part round-trip too (the
// picture in the note, its place in the positions block), a [[pdf#page=4]] link from any note resolves to the PDF at
// that page, a scanned PDF without words says so plainly, and a highlight dragged into a note carries its words with
// a link back.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pdf-highlights-'));
let S;
let G;
let IDX;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/pdf-highlights.ts'), platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/renderer/src/views/pdf/geometry.ts'), platform: 'node', output: { file: path.join(work, 'g.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/indexer.ts'), platform: 'node', output: { file: path.join(work, 'i.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  G = await import(pathToFileURL(path.join(work, 'g.mjs')).href);
  IDX = await import(pathToFileURL(path.join(work, 'i.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const two = () => [
  { id: 'hb2', page: 4, colour: 'green', rects: [[72.04, 600.11, 300.5, 612.9]], text: 'Second on page four', note: '', at: '2026-10-19' },
  { id: 'ha1', page: 4, colour: 'yellow', rects: [[72, 700, 310.5, 712.8], [72, 686, 200, 698.6]], text: 'The quick brown fox\n  jumps over the lazy dog.', note: 'My thought.\n\nA second paragraph.', at: '2026-10-19' },
  { id: 'hc3', page: 1, colour: 'pink', rects: [[50, 50, 90, 60]], text: '# Not a heading', note: '' },
];

test('the highlights note sits beside the PDF and is never titled like it', () => {
  assert.equal(S.sidecarPathFor('Reading/Report.pdf'), 'Reading/Report (highlights).md');
  assert.equal(S.sidecarPathFor('Report.PDF'), 'Report (highlights).md');
  assert.ok(S.isSidecarPath('Reading/Report (highlights).md'));
  assert.ok(!S.isSidecarPath('Reading/Report.md'));
});

test('links into a PDF: page, and page with a highlight', () => {
  assert.deepEqual(S.parsePdfAnchor('page=4&hl=h7k2m9'), { page: 4, hl: 'h7k2m9' });
  assert.deepEqual(S.parsePdfAnchor('#page=12'), { page: 12 });
  assert.deepEqual(S.parsePdfAnchor('7'), { page: 7 });
  assert.deepEqual(S.parsePdfAnchor('Some heading'), {});
  assert.deepEqual(S.parsePdfAnchor(undefined), {});
  assert.deepEqual(S.parsePdfAnchor('page=0'), { page: 1 });
  assert.equal(S.pdfAnchor(4, 'h1'), 'page=4&hl=h1');
  assert.equal(S.pdfAnchor(2), 'page=2');
});

test('written readable: page headings in order, each highlight a quote with a link back, the note under it', () => {
  const md = S.writeSidecar({ preamble: null, highlights: two() }, 'Reading/Report.pdf', 'Report.pdf');
  assert.match(md, /^---\npdf: "\[\[Report\.pdf\]\]"\n---\n\n# Report: highlights\n/);
  const p1 = md.indexOf('## Page 1');
  const p4 = md.indexOf('## Page 4');
  assert.ok(p1 > 0 && p4 > p1);
  // Higher on the page first; words on one line; the link and colour word.
  assert.ok(md.indexOf('The quick brown fox jumps over the lazy dog.') < md.indexOf('Second on page four'));
  assert.match(md, /> The quick brown fox jumps over the lazy dog\.\n>\n> — \[\[Report\.pdf#page=4&hl=ha1\|Page 4\]\] · Yellow\n\nMy thought\.\n\nA second paragraph\./);
  // A quote that starts like a heading is kept as words.
  assert.match(md, /> \\# Not a heading/);
  // Positions at the end, rounded, one line each.
  assert.match(md, /```nv-pdf-highlights\n\{"id":"hc3","page":1,"colour":"pink","rects":\[\[50,50,90,60\]\]\}\n/);
  assert.match(md, /"rects":\[\[72,600\.1,300\.5,612\.9\]\]/);
  assert.ok(md.endsWith('```\n'));
});

test('read back the same, and written again unchanged', () => {
  const md = S.writeSidecar({ preamble: null, highlights: two() }, 'Report.pdf', 'Report.pdf');
  const back = S.parseSidecar(md);
  assert.equal(back.highlights.length, 3);
  const a = back.highlights.find((h) => h.id === 'ha1');
  assert.equal(a.text, 'The quick brown fox jumps over the lazy dog.');
  assert.equal(a.note, 'My thought.\n\nA second paragraph.');
  assert.equal(a.colour, 'yellow');
  assert.equal(a.page, 4);
  assert.deepEqual(a.rects, [[72, 700, 310.5, 712.8], [72, 686, 200, 698.6]]);
  assert.equal(a.at, '2026-10-19');
  assert.equal(back.highlights.find((h) => h.id === 'hc3').text, '# Not a heading');
  assert.equal(S.writeSidecar(back, 'Report.pdf', 'Report.pdf'), md);
});

test('what the person writes in the note comes back into the reader', () => {
  const md = S.writeSidecar({ preamble: null, highlights: two() }, 'Report.pdf', 'Report.pdf');
  // A comment added under a highlight that had none, a colour changed by hand, their own words in the opening, and
  // CRLF line ends from another editor.
  const edited = md
    .replace('· Green', '· Blue\n\nAdded later, with **bold**.')
    .replace('· Pink', '· Green')
    .replace('the PDF itself is never changed.', 'the PDF itself is never changed.\n\nRead for the March review.')
    .replace(/\n/g, '\r\n');
  const back = S.parseSidecar(edited);
  const b = back.highlights.find((h) => h.id === 'hb2');
  assert.equal(b.note, 'Added later, with **bold**.');
  assert.equal(b.colour, 'blue');
  assert.equal(back.highlights.find((h) => h.id === 'hc3').colour, 'green');
  assert.match(back.preamble, /Read for the March review\.$/);
  // Written again, the opening is kept as they left it.
  assert.match(S.writeSidecar(back, 'Report.pdf', 'Report.pdf'), /Read for the March review\.\n\n## Page 1/);
});

test('a highlight whose quote is deleted from the note is gone; a broken position line spoils only its own', () => {
  const md = S.writeSidecar({ preamble: null, highlights: two() }, 'Report.pdf', 'Report.pdf');
  const withoutB = md.replace(/\n> Second on page four\n>\n> — [^\n]+\n/, '\n');
  assert.deepEqual(S.parseSidecar(withoutB).highlights.map((h) => h.id).sort(), ['ha1', 'hc3']);
  const broken = md.replace(/\{"id":"hc3"[^\n]*/, '{"id":"hc3", oops');
  assert.deepEqual(S.parseSidecar(broken).highlights.map((h) => h.id).sort(), ['ha1', 'hb2']);
  // An ordinary quote the person writes in their note stays part of the note.
  const quoted = md.replace('My thought.', 'My thought.\n\n> A quote of my own.');
  assert.equal(S.parseSidecar(quoted).highlights.find((h) => h.id === 'ha1').note, 'My thought.\n\n> A quote of my own.\n\nA second paragraph.');
});

test('an empty or plain note starts fresh, keeping words the person wrote', () => {
  assert.deepEqual(S.parseSidecar(''), { preamble: null, highlights: [] });
  const plain = S.parseSidecar('# My reading notes\n\nSome words.\n');
  assert.equal(plain.preamble, '# My reading notes\n\nSome words.');
  assert.equal(plain.highlights.length, 0);
  // Front matter that looks like a quote is never read as one.
  assert.equal(S.parseSidecar('---\nnote: "> [[x.pdf#page=1&hl=h1|Page 1]]"\n---\n').highlights.length, 0);
  // No highlights left: no positions block.
  assert.ok(!S.writeSidecar({ preamble: plain.preamble, highlights: [] }, 'x.pdf', 'x.pdf').includes('```'));
});

test('new ids are short and never repeat one in use', () => {
  let n = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const id = S.newHighlightId(['h000000'], () => seq[n++ % seq.length]);
  assert.equal(id, 'hiiiiii');
  assert.match(S.newHighlightId(), /^h[0-9a-z]{6}$/);
});

test('a box on the screen goes into the PDF’s units and back, at any zoom and any turn of the page', () => {
  const viewBox = [0, 0, 612, 792];
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [0.5, 1, 1.333, 2.75]) {
      const { matrix, width, height } = G.viewportMatrix(viewBox, scale, rotation);
      const r = [72, 600, 300.5, 612.9];
      const box = G.pdfToBox(matrix, r);
      assert.ok(box.left >= 0 && box.right <= width + 1e-6 && box.top >= 0 && box.bottom <= height + 1e-6, `inside the page at ${rotation}°`);
      const back = G.boxToPdf(matrix, box);
      back.forEach((v, i) => assert.ok(Math.abs(v - r[i]) < 1e-9, `${rotation}° ×${scale}: ${back} vs ${r}`));
    }
  }
  // Unturned: the top left of the page is the PDF's (0, 792); y runs down the screen.
  const { matrix } = G.viewportMatrix(viewBox, 2, 0);
  assert.deepEqual(G.toScreen(matrix, 0, 792), [0, 0]);
  assert.deepEqual(G.toScreen(matrix, 612, 0), [1224, 1584]);
  assert.deepEqual(G.pdfToBox(matrix, [72, 700, 100, 712]), { left: 144, top: 160, right: 200, bottom: 184 });
  // A crop box that doesn't start at 0 and a page with a user unit.
  const crop = G.viewportMatrix([10, 20, 622, 812], 1, 0, 2);
  assert.deepEqual(G.toScreen(crop.matrix, 10, 812), [0, 0]);
  assert.equal(crop.width, 1224);
  // The same zoom twice: the same box, so a highlight stays over its words when the zoom changes.
  const at1 = G.pdfToBox(G.viewportMatrix(viewBox, 1).matrix, [72, 700, 100, 712]);
  const at3 = G.pdfToBox(G.viewportMatrix(viewBox, 3).matrix, [72, 700, 100, 712]);
  assert.deepEqual([at3.left, at3.top, at3.right, at3.bottom], [at1.left * 3, at1.top * 3, at1.right * 3, at1.bottom * 3]);
});

test('a selection’s boxes become one per stretch of line', () => {
  const merged = G.mergeLineBoxes([
    { left: 10, top: 100, right: 60, bottom: 112 },
    { left: 59, top: 100.5, right: 120, bottom: 112.2 },
    { left: 122, top: 100, right: 180, bottom: 112 },
    { left: 10, top: 114, right: 90, bottom: 126 },
    { left: 300, top: 114, right: 340, bottom: 126 },
    { left: 50, top: 50, right: 50, bottom: 60 },
  ]);
  assert.deepEqual(merged, [
    { left: 10, top: 100, right: 180, bottom: 112.2 },
    { left: 10, top: 114, right: 90, bottom: 126 },
    { left: 300, top: 114, right: 340, bottom: 126 },
  ]);
});

test('zoom: fit width, fit page, a percentage, and the steps in and out', () => {
  const pt = 96 / 72;
  assert.equal(G.scaleFor('width', 612, 792, 918, 600), 1.5);
  assert.ok(Math.abs(G.scaleFor('page', 612, 792, 918, 594) - 0.75) < 1e-9);
  assert.ok(Math.abs(G.scaleFor(100, 612, 792, 10, 10) - pt) < 1e-9);
  assert.ok(Math.abs(G.scaleFor(10000, 612, 792, 10, 10) - 5 * pt) < 1e-9);
  assert.equal(G.stepZoom(pt, 1), 110);
  assert.equal(G.stepZoom(pt, -1), 90);
  assert.equal(G.stepZoom(pt * 5, 1), 500);
  assert.equal(G.stepZoom(pt * 0.25, -1), 25);
});

test('finding words: across runs, any capitals and spacing, and back to the run and letter', () => {
  const p = G.pageText([{ str: 'The Quick ' }, { str: 'brown', hasEOL: true }, { str: 'fox jumps' }, { str: '' }, { str: 'over' }]);
  assert.equal(p.text, 'The Quick brown fox jumpsover');
  assert.deepEqual(p.starts, [0, 10, 16, 25, 25]);
  const found = G.findAll([p.text, 'nothing here', 'BROWN   FOX'], 'brown fox');
  assert.deepEqual(found, [
    { page: 0, start: 10, end: 19 },
    { page: 2, start: 0, end: 11 },
  ]);
  assert.deepEqual(G.findAll(['a.b a-b'], 'a.b'), [{ page: 0, start: 0, end: 3 }]);
  assert.deepEqual(G.findAll(['x'], '   '), []);
  // The match "brown fox" starts in run 1 and ends in run 2.
  assert.deepEqual(G.locate(p, 10, 'start'), { item: 1, char: 0 });
  assert.deepEqual(G.locate(p, 19, 'end'), { item: 2, char: 3 });
  // On the space added after "brown": the start moves to the next run, the end stays at the end of "brown".
  assert.deepEqual(G.locate(p, 15, 'start'), { item: 2, char: 0 });
  assert.deepEqual(G.locate(p, 16, 'end'), { item: 1, char: 5 });
});

const clip = () => ({ id: 'hk9clip', page: 2, colour: 'blue', rects: [[100, 400, 300, 520]], text: '', note: 'The chart for March.', image: 'Reading/Files/Report clip hk9clip.png', at: '2026-10-31' });

test('a clip is named for its PDF, and kept beside it under any name', () => {
  assert.equal(S.clipImageName('Reading/Report.pdf', 'hk9clip'), 'Report clip hk9clip.png');
  assert.equal(S.clipImageName('Report.PDF', 'h1'), 'Report clip h1.png');
});

test('a clip in the note: its picture with a link back to the page, read back with its place, written again unchanged', () => {
  const md = S.writeSidecar({ preamble: null, highlights: [clip()] }, 'Reading/Report.pdf', 'Report.pdf');
  // The picture where the quote would be (a [[..]] embed, so renames keep it pointing at the picture), then the link and colour.
  assert.match(md, /!\[\[Reading\/Files\/Report clip hk9clip\.png\|Clipped picture, page 2\]\]\n— \[\[Report\.pdf#page=2&hl=hk9clip\|Page 2\]\] · Blue\n\nThe chart for March\./);
  const back = S.parseSidecar(md);
  assert.equal(back.highlights.length, 1);
  assert.deepEqual(back.highlights[0], clip());
  assert.equal(S.writeSidecar(back, 'Reading/Report.pdf', 'Report.pdf'), md);
  // A clip drawn in ![](..) form by hand reads the same.
  const mdForm = md.replace('![[Reading/Files/Report clip hk9clip.png|Clipped picture, page 2]]', '![Clipped picture, page 2](Reading/Files/Report%20clip%20hk9clip.png)');
  assert.deepEqual(S.parseSidecar(mdForm).highlights, [clip()]);
});

test('a clip whose picture is deleted from the note is gone; a moved picture is followed by its new place', () => {
  const md = S.writeSidecar({ preamble: null, highlights: [clip()] }, 'Reading/Report.pdf', 'Report.pdf');
  const withoutPic = md.replace(/!\[\[Reading[^\n]*\n/, '');
  assert.equal(S.parseSidecar(withoutPic).highlights.length, 0);
  // The picture moved (renames rewrite the readable line, never the positions block): the readable place wins.
  const moved = md.replace('Reading/Files/Report clip hk9clip.png', 'Reading/Files/March chart.png');
  assert.equal(S.parseSidecar(moved).highlights[0].image, 'Reading/Files/March chart.png');
});

test('a [[pdf#page=4]] link from any note resolves: the name to the PDF, the anchor to the page', () => {
  const idx = new IDX.VaultIndex();
  idx.set('Notes/Harbour.md', '# Harbour\n\nSee [[Report.pdf#page=4]].\n', Date.now(), 40);
  idx.set('Reading/Report (highlights).md', '# Report: highlights\n', Date.now(), 10);
  idx.setFiles(['Reading/Report.pdf']);
  // The halves the app follows (state/actions.ts openLink): the name resolves, the anchor parses.
  const target = 'Report.pdf#page=4';
  const hash = target.indexOf('#');
  assert.equal(idx.resolveAny(target.slice(0, hash), 'Notes/Harbour.md'), 'Reading/Report.pdf');
  assert.deepEqual(S.parsePdfAnchor(target.slice(hash + 1)), { page: 4 });
  // The highlights note never shadows its PDF (why it is "(highlights)", not "Report.pdf").
  assert.equal(idx.resolveAny('Report.pdf', 'Notes/Harbour.md'), 'Reading/Report.pdf');
});

test('a scanned PDF without words says so plainly, offering the host app’s make-searchable path inside it', () => {
  assert.equal(S.isScannedPdfText(['', '  \n ']), true);
  assert.equal(S.isScannedPdfText(['Words on page one', '']), false);
  assert.equal(S.isScannedPdfText([]), false);
  for (const inSpark of [false, true]) {
    const notice = S.scannedPdfNotice(inSpark);
    assert.equal(notice.title, 'This PDF has no words in it.');
    assert.match(notice.body, /shows as pictures/);
    assert.match(notice.body, /clip parts of it as pictures/);
    assert.ok(!notice.title.includes('—') && !notice.body.includes('—'), 'no em dashes in new UI words');
    assert.equal(notice.action, inSpark ? 'Make searchable' : null);
  }
});

test('a highlight dragged into a note drops its words with a link back to the PDF at that place', () => {
  const h = { id: 'ha1', page: 4, colour: 'yellow', rects: [[72, 700, 310, 712]], text: 'The quick brown fox.', note: '' };
  assert.equal(S.highlightShareBlock(h, 'Report.pdf', 'Report, page 4'), '> The quick brown fox.\n>\n> — [[Report.pdf#page=4&hl=ha1|Report, page 4]]');
  assert.equal(
    S.highlightShareBlock(clip(), 'Report.pdf', 'Report, page 2'),
    '![[Reading/Files/Report clip hk9clip.png|Clipped picture, page 2]]\n— [[Report.pdf#page=2&hl=hk9clip|Report, page 2]]',
  );
});
