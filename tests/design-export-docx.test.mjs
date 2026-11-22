// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/design-export-docx.test.mjs — the Design studio's Word export (22 Nov 2026,
// src/main/design-export/docx.ts): a real note read by brandContent, in a fictional brand kit, becomes a .docx that is a
// valid package with real styles in the brand's fonts and colours, a cover, a header and a footer with a page number,
// the table, lists, quote, callout, code and picture converted, and every word of the note present. When LibreOffice
// is on the machine the document is also printed to PDF (at least one page), and pages 1 to 3 are drawn to PNGs that
// stay in the temp folder to look at (KEEP_DOCX=1 keeps the .docx and the PDF too).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { unzipSync, strFromU8 } = require('fflate');
const root = path.join(import.meta.dirname, '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-docx-'));
const keep = !!process.env.KEEP_DOCX;
let X;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/main/design-export/docx.ts'))};\nexport { brandContent } from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};\nexport { designTheme } from ${JSON.stringify(path.join(root, 'src/shared/design-doc.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'dx.mjs'), format: 'esm' }, logLevel: 'silent' });
  X = await import(pathToFileURL(path.join(work, 'dx.mjs')).href);
});
after(() => {
  if (!keep) rmSync(work, { recursive: true, force: true });
});

// ── A tiny PNG maker (no libraries): solid shapes on a transparent ground.
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? [0, 0, 0, 0];
      raw.set(c, y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PINE = [15, 107, 92, 255];
const SAND = [232, 220, 196, 255];
// The logo: a pine mark (a triangle on a trunk) and three bars standing for the name.
const LOGO = png(300, 80, (x, y) => {
  if (x < 70) {
    const cx = 35;
    if (y >= 8 && y <= 58 && Math.abs(x - cx) <= (y - 8) * 0.55) return PINE;
    if (y > 58 && y <= 72 && Math.abs(x - cx) <= 5) return PINE;
    return null;
  }
  if (x >= 86 && x <= 290 && y >= 22 && y <= 36) return PINE;
  if (x >= 86 && x <= 230 && y >= 46 && y <= 54) return SAND;
  return null;
});
// A small bar chart, as a picture in the note.
const CHART = png(360, 160, (x, y) => {
  const bars = [[30, 120], [120, 80], [210, 60]];
  for (const [bx, top] of bars) if (x >= bx && x < bx + 70 && y >= 160 - top - 10 && y < 150) return PINE;
  if (y >= 150 && y < 152) return [90, 96, 103, 255];
  return [255, 255, 255, 255];
});

const KIT = { name: 'Harbour Pine', logos: { primary: 'Logos/dark.png' }, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }, { name: 'Sand', hex: '#e8dcc4' }, { name: 'Coral', hex: '#e4572e' }], fonts: [{ name: 'Figtree', use: 'Headings' }, { name: 'Source Sans 3', use: 'Body' }] };

const NOTE = `---
type: report
confidential: true
figures:
  - value: $82,600
    label: Winter revenue
  - value: 9,185
    label: Loaves sold
  - value: 12 weeks
    label: Menu run
  - value: 3
    label: Stores
---
# Winter menu review

The winter menu ran for **twelve weeks** across all three stores. Sales held up well, and the *sourdough range* carried the season. Full figures sit in the [shared ledger](https://example.com/ledger/winter) and the [draft plan](#).

## Sales by store

| Store | Loaves | Pastries | Revenue |
| --- | ---: | ---: | ---: |
| Harbour Street | 4,210 | 2,980 | $38,450 |
| Pine Hill | 3,105 | 2,210 | $27,930 |
| Quay Market | 1,870 | 1,440 | $16,220 |
| Total | 9,185 | 6,630 | $82,600 |

![Loaves by store](data:image/png;base64,${CHART.toString('base64')})

### What worked

- Rye and caraway sold out most mornings
- The pastry case moved closer to the till
  - Croissants up by a fifth
  - Danishes flat
- Weekend specials drew new faces

### What we change

1. Bring the seeded loaf back in March
2. Train two more bakers on lamination
   1. Start with the Pine Hill team
   2. Then Quay Market
3. Review flour contracts before June

> Good bread is the most satisfying of all foods. Our regulars told us the rye was the best they had tasted.

> [!tip] Keep it simple
> Fewer lines, baked better, sold out by two.

## Done this season

- [x] Send the store reports to Maya Fisher
- [x] Move the pastry case at Harbour Street

\`\`\`
oven_temp = 230
bake_minutes = 38
\`\`\`

---

Questions go to the bakery office. Thanks to everyone who worked the early shifts.
`;

const MEETING = `---
type: meeting
date: 2026-11-18
---
# Supplier catch-up

Present: Maya Fisher, Tom Reyes, Ana Silva

## Summary

We agreed to trial the stone-ground flour at **Pine Hill** first.

## Actions

- [ ] Order two sacks of stone-ground flour — Tom Reyes — Friday
- [ ] Book a tasting for the staff — Ana Silva
`;

const xmlText = (xml) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>/g)]
    .map((m) => (m[1] === undefined ? ' ' : m[1]))
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
const wordsOf = (s) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,$%-]*/gu)?.map((w) => w.replace(/[.,]+$/, '')) ?? [];
const counts = (list) => list.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
const htmlWords = (html) =>
  html
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

function read(buf) {
  const files = unzipSync(new Uint8Array(buf));
  const get = (name) => (files[name] ? strFromU8(files[name]) : '');
  return { files, get };
}

test('a note becomes a branded, editable Word document with every word in it', async () => {
  const content = X.brandContent({ title: 'Winter menu review', text: NOTE, path: 'Reports/Winter menu review.md', kit: KIT, url: () => '', now: new Date(2026, 10, 22) });
  assert.ok(content.blocks.length > 8, 'the note reads as blocks');
  assert.ok(content.figures.length === 4 && content.confidential, 'figures and the confidential mark come through');
  const theme = X.designTheme(KIT);
  const buf = await X.designDocx({ content, theme, kindName: 'Report', brandName: 'Harbour Pine', logo: LOGO });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 2000);
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'a zip package');
  const { files, get } = read(buf);
  const doc = get('word/document.xml');
  const styles = get('word/styles.xml');
  assert.ok(doc && styles && files['[Content_Types].xml'], 'document, styles and content types are there');

  // Real styles, in the brand's fonts and colours.
  for (const id of ['Title', 'Heading1', 'Heading2', 'Heading3', 'Normal', 'ListBullet', 'ListNumber', 'Quote', 'Callout', 'CodeBlock', 'Caption', 'Hyperlink', 'BrandTable']) assert.match(styles, new RegExp(`w:styleId="${id}"`), `style ${id}`);
  assert.match(styles, /w:ascii="Figtree"/, 'the heading font is the kit’s');
  assert.match(styles, /w:ascii="Source Sans 3"/, 'the body font is the kit’s');
  assert.match(styles, /0F6B5C/i, 'the accent colour is in the styles');
  assert.match(styles, /101820/i, 'body text in the ink colour');
  assert.match(get('word/theme/theme1.xml'), /Figtree/, 'the theme’s heading font is the kit’s');

  // A4 portrait with margins between 20 and 25 mm; the cover on its own page; header and footer with a page number.
  const pg = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(doc);
  assert.deepEqual([Number(pg[1]), Number(pg[2])], [11906, 16838]);
  for (const m of doc.matchAll(/<w:pgMar ([^>]*)\/>/g)) {
    const left = Number(/w:left="(\d+)"/.exec(m[1])[1]) / 56.69;
    assert.ok(left >= 20 && left <= 25, `margin ${left} mm`);
  }
  assert.equal((doc.match(/<w:sectPr/g) ?? []).length, 2, 'a report’s cover is its own section');
  const footers = Object.keys(files).filter((n) => /^word\/footer\d+\.xml$/.test(n)).map(get).join('');
  assert.match(footers, /PAGE/, 'a page number field');
  assert.match(footers, /NUMPAGES/);
  assert.match(footers, /Confidential/, 'the footer says it is confidential');
  const headers = Object.keys(files).filter((n) => /^word\/header\d+\.xml$/.test(n)).map(get).join('');
  assert.match(headers, /Winter menu review/);

  // The cover: logo, label, title, figures, the confidential note.
  assert.ok(Object.keys(files).some((n) => n.startsWith('word/media/')), 'the logo and the picture are embedded');
  assert.match(doc, /w:pStyle w:val="Kicker"/);
  assert.match(doc, /w:pStyle w:val="Title"/);
  assert.equal((doc.match(/w:pStyle w:val="FigureValue"/g) ?? []).length, 4, 'four key figures');
  assert.match(doc, /Confidential, internal use/);

  // The blocks converted: headings, lists (nested), the table, quote, callout, code, rule, picture, tasks, links.
  assert.match(doc, /w:pStyle w:val="Heading1"/);
  assert.match(doc, /w:pStyle w:val="Heading2"/);
  assert.match(doc, /w:pStyle w:val="ListBullet"/);
  assert.match(doc, /w:pStyle w:val="ListNumber"/);
  assert.match(doc, /<w:ilvl w:val="1"\/>/, 'a nested list');
  assert.match(doc, /w:pStyle w:val="Quote"/);
  assert.match(doc, /w:pStyle w:val="Callout"/);
  assert.match(doc, /w:pStyle w:val="CodeBlock"/);
  assert.match(doc, /w:pStyle w:val="Rule"/);
  assert.match(doc, /☑/, 'a done task keeps its tick');
  assert.match(doc, /<w:hyperlink [^>]*r:id=/, 'a real link is a hyperlink');
  assert.match(get('word/_rels/document.xml.rels'), /https:\/\/example\.com\/ledger\/winter/);
  assert.ok(!/w:anchor="_top"/.test(doc), 'a placeholder link reads as words');
  assert.ok(doc.includes('<w:drawing>'), 'pictures are drawn');
  const tables = doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  const sales = tables.find((t) => t.includes('Harbour Street'));
  assert.ok(sales, 'the sales table is there');
  assert.match(sales, /w:tblStyle w:val="BrandTable"/);
  assert.match(sales, /<w:tblHeader\/>/, 'its header row repeats');
  assert.match(sales, /w:fill="0F6B5C"/i, 'its header row is in the accent');
  assert.match(sales, /<w:jc w:val="right"\/>[\s\S]*?4,210/, 'numbers right-aligned');
  assert.match(sales, /w:pStyle w:val="TableTotal"/, 'the total row stands out');

  // Every word of the note's blocks, title, label, figures and footer is in the document.
  const docText = xmlText(doc) + ' ' + xmlText(headers) + ' ' + xmlText(footers);
  const have = counts(wordsOf(docText));
  const want = counts(wordsOf([content.title, content.label, ...content.sub, ...content.figures.flatMap((f) => [f.value, f.label]), ...content.blocks.map(htmlWords)].join(' ')));
  const missing = [...want].filter(([w, n]) => (have.get(w) ?? 0) < n).map(([w, n]) => `${w} (${have.get(w) ?? 0}/${n})`);
  assert.deepEqual(missing, [], 'no word is lost');

  const file = path.join(work, 'winter-menu-review.docx');
  writeFileSync(file, buf);

  // ── The render check: LibreOffice prints it to PDF; page 1 is drawn for a person to look at.
  const soffice = ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice'].find((p) => existsSync(p)) ?? (spawnSync('which', ['soffice']).stdout?.toString().trim() || null);
  if (!soffice) {
    console.log('soffice is not on this machine: the render check is skipped');
    return;
  }
  const profile = path.join(work, 'lo-profile');
  const outDir = path.join(work, 'pdf');
  mkdirSync(outDir, { recursive: true });
  execFileSync(soffice, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, file], { stdio: 'pipe', timeout: 180_000 });
  const pdf = path.join(outDir, 'winter-menu-review.pdf');
  assert.ok(existsSync(pdf), 'the PDF was printed');
  const pdfinfo = spawnSync('pdfinfo', [pdf]);
  if (pdfinfo.status === 0) {
    const pages = Number(/Pages:\s+(\d+)/.exec(pdfinfo.stdout.toString())?.[1] ?? 0);
    assert.ok(pages >= 1, `the PDF has ${pages} pages`);
    console.log(`printed ${pages} pages`);
  }
  if (spawnSync('which', ['pdftoppm']).status === 0) {
    // The pictures stay after the run (the rest of the work folder goes), so a person can look at them.
    const shots = mkdtempSync(path.join(tmpdir(), 'nv-docx-pages-'));
    execFileSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '3', pdf, path.join(shots, 'page')], { timeout: 60_000 });
    const pngs = readdirSync(shots).filter((n) => n.endsWith('.png')).sort();
    assert.ok(pngs.length >= 1, 'page 1 was drawn');
    console.log(`page 1 of the Word export: ${path.join(shots, pngs[0])}`);
  }
});

test('a meeting prints who came; a one-pager keeps the title on page one; odd HTML never loses a word', async () => {
  const content = X.brandContent({ title: 'Supplier catch-up', text: MEETING, path: 'Meetings/2026-11-18 Supplier catch-up.md', kit: KIT, url: () => '', now: new Date(2026, 10, 22) });
  assert.ok(content.people.some((r) => r.label === 'Present'), 'the meeting has its people rows');
  const odd = [
    '<p>Before <foo>an unknown tag</foo> and <span>a span</span> &amp; an entity &#8212; done</p>',
    '<section><p>Inside a section<p>and an unclosed paragraph</section>',
    '<ul><li>One<li>Two <input type="checkbox" checked> ticked<li><p>Three in a paragraph</p><ol><li>Deep</ol></ul>',
    '<details><summary>More</summary>Hidden words show</details>',
    '<p><img src="file:///Vault/Photos/oven.png" alt="The new oven"> <img src="https://example.com/x.png"> after the pictures</p>',
    '<table><tr><th>Item<th>Cost</tr><tr><td>Flour<td>$1,200</tr><tr><td colspan="2">A wide note</td></tr></table>',
    '<p>Stray close</div> tags </b>and <a href="javascript:alert(1)">a bad link</a> and <a href="">an empty one</a></p>',
    '<script>never shown()</script><p>After the script</p>',
    'Loose words with no tag at all',
  ];
  const buf = await X.designDocx({ content: { ...content, blocks: [...content.blocks, ...odd] }, theme: X.designTheme(KIT), kindName: 'One-pager', brandName: 'Harbour Pine', logo: null });
  const { get } = read(buf);
  const doc = get('word/document.xml');
  assert.equal((doc.match(/<w:sectPr/g) ?? []).length, 1, 'a one-pager is one section');
  assert.match(doc, /Present/);
  assert.match(doc, /Maya Fisher, Tom Reyes, Ana Silva/);
  assert.match(doc, /w:pStyle w:val="MetaRow"/);
  assert.match(doc, /Harbour Pine/, 'no logo: the brand name is set in type');
  const text = xmlText(doc);
  for (const w of ['unknown tag', 'a span', '& an entity —', 'Inside a section', 'an unclosed paragraph', 'One', 'Two', 'ticked', 'Three in a paragraph', 'Deep', 'More', 'Hidden words show', 'The new oven', 'after the pictures', 'Flour', '$1,200', 'A wide note', 'Stray close', 'a bad link', 'an empty one', 'After the script', 'Loose words with no tag at all']) assert.ok(text.includes(w), `kept: ${w}`);
  assert.ok(!text.includes('never shown'), 'a script’s code is no words');
  assert.match(text, /☑\s*ticked/, 'a checked box reads as a tick');
  assert.ok(!/javascript:/i.test(get('word/_rels/document.xml.rels')), 'no script link');
  assert.ok(!/file:/i.test(doc + get('word/_rels/document.xml.rels')), 'no file address');

  // No kit: quiet neutral styles and safe fonts every copy of Word has.
  const plain = await X.designDocx({ content: { title: 'A plain note', label: 'Note', sub: [], figures: [], people: [], blocks: ['<p>Just words.</p>'], confidential: false, foot: '' }, theme: X.designTheme(null), kindName: 'Report', brandName: '', logo: null });
  const ps = read(plain).get('word/styles.xml');
  assert.match(ps, /w:ascii="Calibri"/);
  assert.ok(!/Inter/.test(ps), 'the app’s own font is never named');
  assert.equal(X.wordFont('"Figtree","Inter",sans-serif'), 'Figtree');
  assert.equal(X.wordFont('Georgia, serif', 'serif'), 'Cambria');
  assert.ok(X.realLink('https://example.com/ledger') && !X.realLink('#') && !X.realLink('https://example.com') && !X.realLink('javascript:x'));
});
