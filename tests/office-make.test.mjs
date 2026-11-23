// node --test tests/office-make.test.mjs — new Word, Excel and PowerPoint files from what the chat's assistant writes
// (src/main/office-make.ts, 24 Nov 2026). Each file is made, then read back with the app's own readers (office-edit.ts
// readWorkbook and zipParts, doc-text.ts docxText, xlsxText and pptxText) and its XML looked at. Proven: Word headings
// are real Heading 1 to 6 styles with outline levels; lists have real numbering (nested levels, each list starting
// again); links are real hyperlinks with relationships, and only to the web or email; tables repeat their header row;
// --- is a page break; tick boxes; the title in the properties. Excel formulas are formulas (from "=" words and
// { formula }), ISO dates are real dates, $1,250 is a number in its format; the header row is bold, filled, frozen and
// filtered; odd sheet names are made ones Excel takes; a formula that reaches outside the workbook stays words.
// PowerPoint: 16:9, a title slide, real paragraph levels, notes as real notes pages, shrink-on-overflow, too many points
// go on to a second slide, and one paragraph's properties written once. In all three, <&>"' and control characters
// in the words never become markup, every XML part is well formed, and the brand reaches the theme.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-office-make-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    entry,
    [
      `export * from ${from('src/main/office-make.ts')};`,
      `export { readWorkbook, zipParts, isoToSerial } from ${from('src/main/office-edit.ts')};`,
      `export { docxText, pptxText, xlsxText } from ${from('src/main/doc-text.ts')};`,
    ].join('\n'),
  );
  // The libraries stay the installed packages (as in the app's main bundle), found through the temp folder.
  symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'junction');
  await build({
    input: entry,
    platform: 'node',
    external: [/^(docx|exceljs|pptxgenjs|jszip|markdown-it|yaml)(\/|$)/],
    output: { file: path.join(work, 'm.mjs'), format: 'esm' },
    logLevel: 'silent',
  });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Reading the files back ──────────────────────────────────────────────────────────────────────────────────────────

/** Every part of a zip, unpacked, by the app's own zip reader (office-edit.ts). */
function unzip(buf) {
  const out = {};
  for (const p of M.zipParts(buf)) {
    const at = p.offset;
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + p.compressed);
    out[p.name] = (p.method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  }
  return out;
}

/** A plain check that XML is well formed: every tag closed in order, attributes quoted, every & an entity, no
 *  character XML can't carry. (A file that fails this is one Office calls damaged.) */
function wellFormed(name, xml) {
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), `${name}: a control character`);
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(body), `${name}: a bare &`);
  const stack = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|</g;
  for (const m of body.matchAll(tag)) {
    assert.ok(m[2], `${name}: a < that starts no tag, near ${body.slice(m.index, m.index + 60)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: </${m[2]}> closes the wrong tag`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], `${name}: tags left open`);
}
const allWellFormed = (parts) => {
  for (const [name, xml] of Object.entries(parts)) if (/\.(xml|rels)$/.test(name)) wellFormed(name, xml);
};

const NASTY = `Fish & chips <b>bold</b> "quoted" 'single' \u0001\u0007\u000b`;

// ── Word ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const REPORT = `---
title: Front matter title
tags: [report]
---
# Garden plan

Intro with **bold**, *italic*, \`code\`, ~~old~~ and a [link](https://example.org/plan?a=1&b=2) and [[Seed list|the seed list]].
A bad [link](javascript:alert(1)) and an [ftp one](ftp://files.example.org/a) stay words.

## Beds

- North bed
  - Tomatoes
    - Cherry
- South bed

1. Dig
2. Plant
   1. Seeds first
3. Water

Then a second list:

1. Mulch
2. Wait

### Tasks

- [ ] Buy compost
- [x] Fix the tap

#### Costs

| Item | Cost |
|:-----|-----:|
| Compost | $40.00 |
| Seeds | $12.50 |
| Total | $52.50 |

> Grow what you eat.

> [!warning] Frost
> Cover the seedlings.

##### Code

\`\`\`
water = 2 L
\`\`\`

---

###### Last page

${NASTY}
`;

test('Word: headings, lists, links, a table, quotes, code, tick boxes and a page break, read back', async () => {
  const buf = await M.makeDocx(REPORT, { brand: { accent: '#0f6b5c', font: 'Source Sans 3' } });
  const parts = unzip(buf);
  allWellFormed(parts);
  const doc = parts['word/document.xml'];
  const styles = parts['word/styles.xml'];
  const text = await M.docxText(buf);

  // Real heading styles 1 to 6, each with its outline level (the navigation pane and a table of contents use them).
  for (let n = 1; n <= 6; n++) {
    assert.match(doc, new RegExp(`<w:pStyle w:val="Heading${n}"/>`), `Heading ${n} used`);
    const style = new RegExp(`<w:style [^>]*w:styleId="Heading${n}"[\\s\\S]*?</w:style>`).exec(styles)?.[0] ?? '';
    assert.match(style, new RegExp(`<w:name w:val="Heading ${n}"/>`));
    assert.match(style, new RegExp(`<w:outlineLvl w:val="${n - 1}"/>`));
  }
  assert.ok(!/Times New Roman/.test(styles), 'no Times New Roman');
  assert.match(styles, /w:ascii="Source Sans 3"/, 'the brand font');
  assert.match(parts['word/theme/theme1.xml'], /0F6B5C/i, 'the brand accent in the theme');

  // The front matter's title in the properties and on the page (the words open with a heading of their own: no).
  assert.match(parts['docProps/core.xml'], /<dc:title>Front matter title<\/dc:title>/);
  assert.ok(!/tags:/.test(text), 'front matter not printed');
  assert.match(text, /Garden plan/);

  // Inline words.
  assert.match(text, /Intro with bold, italic, code, old and a link and the seed list\./);
  assert.match(doc, /<w:b\/>[\s\S]*?<w:t[^>]*>bold<\/w:t>/);
  assert.match(doc, /<w:rStyle w:val="InlineCode"\/>[\s\S]*?<w:t[^>]*>code<\/w:t>/);
  assert.match(doc, /<w:strike\/>/);

  // Links: real hyperlinks with an external relationship; javascript: stays words.
  const rels = parts['word/_rels/document.xml.rels'];
  // (docx names relationships with random letters, dashes among them.)
  const link = /<w:hyperlink [^>]*r:id="([^"]+)"/.exec(doc);
  assert.ok(link, 'a hyperlink');
  const rel = new RegExp(`<Relationship [^>]*Id="${link[1].replace(/[^\w]/g, '\\$&')}"[^>]*>`).exec(rels)?.[0] ?? '';
  assert.match(rel, /Target="https:\/\/example\.org\/plan\?a=1&amp;b=2"/);
  assert.match(rel, /TargetMode="External"/);
  assert.equal((doc.match(/<w:hyperlink /g) ?? []).length, 1, 'only the web link is a link');
  assert.ok(!/javascript/i.test(rels));
  assert.match(text, /A bad \[?link\]?\S* and an ftp one stay words\./);

  // Lists: bullets nest three deep; numbers restart for the second list and nest a level.
  const numbering = parts['word/numbering.xml'];
  assert.match(numbering, /<w:numFmt w:val="bullet"\/>/);
  assert.match(numbering, /<w:numFmt w:val="decimal"\/>/);
  assert.match(numbering, /<w:numFmt w:val="lowerLetter"\/>/);
  const para = (words) => new RegExp(`<w:p>(?:(?!<w:p>)[\\s\\S])*?>${words}<\\/w:t>`).exec(doc)?.[0] ?? '';
  const numOf = (p) => ({ id: /<w:numId w:val="(\d+)"\/>/.exec(p)?.[1], lvl: /<w:ilvl w:val="(\d+)"\/>/.exec(p)?.[1] });
  assert.deepEqual(numOf(para('North bed')).lvl, '0');
  assert.deepEqual(numOf(para('Tomatoes')).lvl, '1');
  assert.deepEqual(numOf(para('Cherry')).lvl, '2');
  assert.equal(numOf(para('Seeds first')).lvl, '1');
  const dig = numOf(para('Dig'));
  const mulch = numOf(para('Mulch'));
  assert.equal(numOf(para('Water')).id, dig.id, 'one list, one numbering');
  assert.notEqual(mulch.id, dig.id, 'the second list numbers from 1 again');
  assert.match(numbering, new RegExp(`<w:num w:numId="${mulch.id}"[^>]*>[\\s\\S]*?<w:startOverride w:val="1"/>`));

  // Tick boxes in the bullet's place.
  assert.match(text, /☐\s*Buy compost/);
  assert.match(text, /☒\s*Fix the tap/);
  assert.ok(!/\[ \]|\[x\]/.test(text));

  // The table: a repeating header row, numbers right-aligned, the total bold.
  assert.match(doc, /<w:tblHeader\/>/);
  assert.match(text, /Item \| Cost/);
  assert.match(text, /Total \| \$52\.50/);
  assert.match(para('\\$12\\.50'), /<w:jc w:val="right"\/>/);
  assert.match(para('\\$52\\.50'), /<w:b\/>/);

  // A quote, a callout with its title, monospace code, the page break before the last page.
  assert.match(para('Grow what you eat\\.'), /<w:pStyle w:val="Quote"\/>/);
  assert.match(text, /Frost\s+Cover the seedlings\./);
  assert.match(para('water = 2 L'), /<w:pStyle w:val="CodeBlock"\/>/);
  assert.match(styles, /w:styleId="CodeBlock"[\s\S]*?w:ascii="Consolas"/);
  assert.match(para('Last page'), /<w:pageBreakBefore\/>/);

  // Untrusted words: never markup, control characters gone, the words themselves kept.
  assert.ok(!/<b>/.test(doc), 'no raw tag');
  assert.match(doc, /Fish &amp; chips &lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(text, /Fish & chips <b>bold<\/b> "quoted" 'single'/);
});

test('Word: a given title goes in the properties and on top when the words have no # heading; escaping in titles', async () => {
  const buf = await M.makeDocx('## Notes\n\nJust words.', { title: 'Q3 <review> & "plan"' });
  const parts = unzip(buf);
  allWellFormed(parts);
  assert.match(parts['docProps/core.xml'], /<dc:title>Q3 &lt;review&gt; &amp; (&quot;|")plan(&quot;|")<\/dc:title>/);
  assert.match(parts['word/document.xml'], /<w:pStyle w:val="Title"\/>[\s\S]*?Q3 &lt;review&gt;/);
  assert.match(parts['word/footer1.xml'] ?? Object.entries(parts).find(([k]) => /footer/.test(k))?.[1] ?? '', /Q3 &lt;review&gt;/);
  // Empty Markdown still makes a whole document.
  const empty = unzip(await M.makeDocx(''));
  allWellFormed(empty);
  assert.match(empty['docProps/core.xml'], /<dc:title>Document<\/dc:title>/);
});

// ── Excel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const BOOK = {
  brand: { accent: '0f6b5c', dark: '#102030', font: 'Aptos' },
  sheets: [
    {
      name: 'Budget',
      rows: [
        ['Item', 'Due', 'Budget', 'Spent', 'Left', 'Note'],
        ['Joinery', '2026-12-05', 48000, 46250, '=C2-D2', NASTY],
        ['Electrical', { date: '2027-01-15' }, 62000, '$64,100.00', { formula: '=C3-D3' }, 'Over'],
        ['Lift', '2027-02-20T09:30', 85000, 0, { formula: 'C4-D4', format: 'currency' }, true],
        ['Total', null, '=SUM(C2:C4)', '=SUM(D2:D4)', '=SUM(E2:E4)', '12.5%'],
      ],
    },
    { name: 'Q1: payments [draft]?', rows: [['a'], ['=cmd|\' /C calc\'!A0'], ['=WEBSERVICE("http://x")'], ['=IF(A1<5,"a&b","<c>")']] },
    { name: 'budget', rows: [] },
    { name: 'History', rows: [[1, 2]] },
    { name: "'A very long sheet name that Excel would refuse'", rows: [['x']], header: false, widths: [40] },
    { name: '', rows: [['x', 'y']] },
  ],
};

test('Excel: formulas, dates, numbers in their formats, the header row, and sheet names Excel takes', async () => {
  const buf = await M.makeXlsx(BOOK);
  const parts = unzip(buf);
  allWellFormed(parts);
  const wb = await M.readWorkbook(buf);
  const names = wb.sheets.map((s) => s.name);
  assert.deepEqual(names.slice(0, 4), ['Budget', 'Q1 payments draft', 'budget (2)', 'History table']);
  assert.ok(names[4].length <= 31 && !/['[\]:*?/\\]/.test(names[4]) && names[4].startsWith('A very long sheet name'), names[4]);
  assert.equal(names[5], 'Sheet 6');
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'no two the same');

  const s = wb.sheets[0];
  const cell = (ref) => s.cells.get(ref);
  // Formulas: from "=" words, from { formula } with or without its "=".
  assert.equal(cell('E2').formula, 'C2-D2');
  assert.equal(cell('E3').formula, 'C3-D3');
  assert.equal(cell('E4').formula, 'C4-D4');
  assert.equal(cell('C5').formula, 'SUM(C2:C4)');
  // Dates: real day numbers in a date format (a time too when given).
  assert.equal(cell('B2').date, true);
  assert.equal(cell('B2').value, M.isoToSerial('2026-12-05'));
  assert.equal(cell('B3').date, true);
  assert.equal(cell('B3').value, M.isoToSerial('2027-01-15'));
  assert.equal(cell('B4').date, true);
  assert.equal(cell('B4').value, M.isoToSerial('2027-02-20 09:30'));
  // Numbers as written: $64,100.00 a number, 12.5% a fraction, true a true.
  assert.equal(cell('D3').value, 64100);
  assert.equal(cell('D3').text, false);
  assert.equal(cell('F5').value, 0.125);
  assert.equal(cell('F4').value, true);
  // Words stay words, exactly, with no markup and no control characters.
  assert.equal(cell('F2').value, `Fish & chips <b>bold</b> "quoted" 'single' `);
  assert.equal(cell('F2').text, true);

  // The look: header bold and filled, frozen under row 1, filtered; formats on the columns; the total ruled.
  const sheet1 = parts[s.part];
  assert.match(sheet1, /<pane[^>]*ySplit="1"[^>]*state="frozen"|<pane[^>]*state="frozen"[^>]*ySplit="1"/);
  assert.match(sheet1, /<autoFilter ref="A1:F5"\/>/);
  assert.match(sheet1, /<col [^>]*width="[\d.]+"[^>]*customWidth="1"/);
  const styles = parts['xl/styles.xml'];
  assert.match(styles, /<b\/>/);
  assert.match(styles, /<patternFill patternType="solid"><fgColor rgb="FF[0-9A-F]{6}"\/>/);
  assert.match(styles, /formatCode="d mmm yyyy"/);
  assert.match(styles, /formatCode="&quot;\$&quot;#,##0\.00"/);
  assert.match(styles, /<name val="Aptos"\/>/);
  assert.match(parts['xl/workbook.xml'], /fullCalcOnLoad="1"/);
  assert.match(parts['xl/theme/theme1.xml'], /<a:accent1><a:srgbClr val="0F6B5C"\/><\/a:accent1>/);
  assert.match(parts['xl/theme/theme1.xml'], /<a:minorFont>\s*<a:latin typeface="Aptos"/);

  // A formula that reaches outside the workbook stays words; one with <&> in it is a formula, escaped.
  const q = wb.sheets[1];
  assert.equal(q.cells.get('A2').formula, undefined);
  assert.equal(q.cells.get('A2').value, "=cmd|' /C calc'!A0");
  assert.equal(q.cells.get('A3').formula, undefined);
  assert.equal(q.cells.get('A4').formula, 'IF(A1<5,"a&b","<c>")');
  assert.match(parts[q.part], /<f>IF\(A1&lt;5,(&quot;|")a&amp;b(&quot;|"),(&quot;|")&lt;c&gt;(&quot;|")\)<\/f>/);
  // No header row asked for: nothing frozen, the width as given.
  const long = parts[wb.sheets[4].part];
  assert.ok(!/state="frozen"/.test(long));
  assert.match(long, /width="40"/);

  // The app's own text reader reads it too.
  const words = await M.xlsxText(buf);
  assert.match(words, /Joinery/);
  assert.match(words, /Fish & chips <b>bold<\/b>/);
});

test('Excel: dates and sheet names, the rules', () => {
  assert.deepEqual(M.excelSerial('2026-11-24'), { serial: M.isoToSerial('2026-11-24'), time: false });
  assert.equal(M.excelSerial('2026-02-30'), null, 'no 30 February');
  assert.equal(M.excelSerial('1900-01-15'), null, 'before Excel counts days right');
  assert.equal(M.excelSerial('24/11/2026'), null);
  const names = M.sheetNames(['Sales', 'sales', 'SALES', 'a/b\\c*d?e:f[g]', '', 'x'.repeat(40), 'History', "'quoted'"]);
  assert.deepEqual(names.slice(0, 3), ['Sales', 'sales (2)', 'SALES (3)']);
  assert.ok(!/[[\]:*?/\\]/.test(names[3]));
  assert.equal(names[4], 'Sheet 5');
  assert.ok(names[5].length <= 31);
  assert.notEqual(names[6].toLowerCase(), 'history');
  assert.equal(names[7], 'quoted');
});

// ── PowerPoint ────────────────────────────────────────────────────────────────────────────────────────────────────

const DECK = {
  title: `Garden <plan> & "more"`,
  subtitle: 'Spring review',
  brand: { accent: '#0f6b5c', headingFont: 'Georgia' },
  slides: [
    { title: 'Where we are', bullets: ['Beds dug', { text: 'North first', level: 1 }, { text: 'Deeper', level: 2 }, 'Seeds **bought**'], notes: 'Say the north bed is ready. <not a tag> & more' },
    { title: 'Part two', layout: 'section', bullets: ['Planting'] },
    { title: 'Before and after', bullets: ['Lawn', 'Weeds'], right: ['Beds', 'Paths'] },
    { title: 'Grow what you eat.', layout: 'quote', bullets: ['A gardener'] },
    { title: 'Long list', bullets: Array.from({ length: 20 }, (_, i) => `Point ${i + 1} about the garden and what it needs this season`), notes: 'Many points.' },
    { title: NASTY, bullets: [NASTY] },
  ],
};

test('PowerPoint: a 16:9 deck with a title slide, levels, two columns, a quote, notes pages, and long lists split', async () => {
  const buf = await M.makePptx(DECK);
  const parts = unzip(buf);
  allWellFormed(parts);
  assert.match(parts['ppt/presentation.xml'], /<p:sldSz cx="12192000" cy="6858000"/);
  assert.match(parts['docProps/core.xml'], /<dc:title>Garden &lt;plan&gt; &amp; (&quot;|")more(&quot;|")<\/dc:title>/);
  const slides = Object.keys(parts).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  // The cover, five slides as given, and the twenty points over three slides.
  assert.equal(slides.length, 1 + 5 + 2 + 1);
  const text = await M.pptxText(buf);
  assert.match(text, /\fslide 1\nGarden <plan> & "more"\nSpring review/);
  assert.match(text, /Long list \(continued\)/);
  for (let i = 1; i <= 20; i++) assert.match(text, new RegExp(`Point ${i} about`), `point ${i} is on a slide`);

  // Levels are real paragraph levels; bullets in the accent; one paragraph's properties written once, first.
  const where = parts[slides[1]];
  assert.match(where, /<a:pPr lvl="1"/);
  assert.match(where, /<a:pPr lvl="2"/);
  assert.match(where, /<a:buClr><a:srgbClr val="0F6B5C"\/><\/a:buClr>/);
  for (const name of slides) {
    for (const p of parts[name].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
      const all = p[1].match(/<a:pPr\b/g) ?? [];
      assert.ok(all.length <= 1 && (all.length === 0 || /^\s*<a:pPr\b/.test(p[1])), `${name}: paragraph properties once, first`);
    }
  }
  // Words that could overflow shrink: normAutofit on the slides' text.
  assert.match(where, /<a:normAutofit\/>/);
  // Placeholders from the slide masters (title and body), so the outline and layouts work in PowerPoint.
  assert.match(where, /<p:ph\s[^>]*type="title"/);
  assert.match(where, /<p:ph\s[^>]*type="body"/);

  // Notes: real notes pages for the slides that have them.
  const notesFor = (slide) => {
    const rel = parts[slide.replace('slides/', 'slides/_rels/') + '.rels'];
    const target = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rel)?.[1];
    return target ? parts[`ppt/notesSlides/${target}`] : '';
  };
  assert.match(notesFor(slides[1]), /Say the north bed is ready\. &lt;not a tag&gt; &amp; more/);
  assert.match(text, /Notes: Say the north bed is ready\. <not a tag> & more/);
  assert.match(text, /Notes: Many points\./);

  // Untrusted words in a title and a point: no markup, no control characters.
  const nasty = parts[slides[slides.length - 1]];
  assert.ok(!/<b>/.test(nasty));
  assert.match(nasty, /Fish &amp; chips &lt;b&gt;bold&lt;\/b&gt;/);

  // The brand in the theme: the accent and the heading font.
  const theme = parts['ppt/theme/theme1.xml'];
  assert.match(theme, /<a:accent1><a:srgbClr val="0F6B5C"\/><\/a:accent1>/);
  assert.match(theme, /<a:majorFont>\s*<a:latin typeface="Georgia"/);
});

test('PowerPoint: a first slide laid out as a title is the cover; layouts are worked out when not given', async () => {
  const buf = await M.makePptx({ title: 'Deck', slides: [{ title: 'My cover', layout: 'title', bullets: ['Under it'] }, { title: 'Only a title' }, { title: 'Two', right: ['R'] }] });
  const parts = unzip(buf);
  allWellFormed(parts);
  const slides = Object.keys(parts).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
  assert.equal(slides.length, 3);
  const text = await M.pptxText(buf);
  assert.match(text, /\fslide 1\nMy cover\nUnder it/);
  assert.ok(!/\nDeck\n/.test(text), 'no second cover');
  // A link on a coloured ground is a real link, in white (the accent would vanish into the ground).
  const end = unzip(await M.makePptx({ title: 'Deck', slides: [{ title: 'Thanks', layout: 'section', bullets: ['Questions: help@example.org'] }] }));
  const thanks = end['ppt/slides/slide2.xml'];
  assert.match(thanks, /<a:srgbClr val="FFFFFF"\/><\/a:solidFill>[^]*?<a:hlinkClick r:id="[^"]+"/);
  assert.match(end['ppt/slides/_rels/slide2.xml.rels'], /Target="mailto:help@example.org" TargetMode="External"/);
  // An empty deck still opens.
  const empty = unzip(await M.makePptx({ title: '', slides: [] }));
  allWellFormed(empty);
});

test('the XML clean-up: properties once per paragraph, and control characters out of every word', () => {
  const xml = '<a:p><a:pPr marL="1"><a:buSzPct val="100000"/><a:buChar char="&#x2022;"/></a:pPr><a:r><a:t>a</a:t></a:r><a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>';
  assert.equal(
    M.tidySlideXml(xml, '112233'),
    '<a:p><a:pPr marL="1"><a:buClr><a:srgbClr val="112233"/></a:buClr><a:buSzPct val="100000"/><a:buChar char="&#x2022;"/></a:pPr><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p>',
  );
  assert.equal(M.clean('a\u0000b\u0008c\td\ne\r\nf￾\ud800g'), 'abc\td\ne\nfg');
  assert.equal(M.hexColour('#abc', '000000'), 'AABBCC');
  assert.equal(M.hexColour('red', '000000'), '000000');
});
