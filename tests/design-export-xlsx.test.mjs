// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/design-export-xlsx.test.mjs — the Design studio's Excel export (22 Nov 2026,
// src/main/design-export/xlsx.ts): a fictional bakery's fit-out note, read by brandContent as every design is, becomes
// a branded workbook. Read back with ExcelJS: a Summary sheet first, one sheet per table named after its heading,
// numbers as numbers in their written formats, dates as dates, the total row as SUM formulas with the typed totals
// cached, the header frozen, nothing invented where the note has no total. Then LibreOffice (when it is installed)
// prints it to PDF and works every formula out again, so the totals are proven live, not pasted.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const ExcelJS = require(path.join(root, 'node_modules', 'exceljs'));
const work = mkdtempSync(path.join(tmpdir(), 'nv-xlsx-'));
let X;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/main/design-export/xlsx.ts'))};`,
      `export { readTables, htmlText } from ${JSON.stringify(path.join(root, 'src/main/design-export/html-tables.ts'))};`,
      `export { brandContent } from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};`,
      `export { designTheme } from ${JSON.stringify(path.join(root, 'src/shared/design-doc.ts'))};`,
    ].join('\n'),
  );
  // ExcelJS stays the installed package (as in the app's main bundle), found through the temp folder's node_modules.
  symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  await build({ input: entry, platform: 'node', external: ['exceljs'], output: { file: path.join(work, 'x.mjs'), format: 'esm' }, logLevel: 'silent' });
  X = await import(pathToFileURL(path.join(work, 'x.mjs')).href);
});
after(() => {
  if (!process.env.KEEP_XLSX_TEST) rmSync(work, { recursive: true, force: true });
});

const KIT = { name: 'Harbour Pine', logos: { primary: 'Logos/dark.png' }, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }, { name: 'Sand', hex: '#e8dcc4' }], fonts: [{ name: 'Figtree', use: 'Headings' }, { name: 'Source Sans 3', use: 'Body' }], footer: 'Harbour Pine Bakery · Internal planning' };

const NOTE = `---
type: Project brief
project: "[[Second shop]]"
date: 2026-11-20
---
# Second shop fit-out

The second Harbour Pine shop opens on the corner of Wattle and Quay streets. This brief sets out the budget and the
first week we expect to trade.

## Key figures

- $184k — Total budget
- 20 Mar 2027 — Doors open
- 22 months — Payback
- 12.5% — Expected margin

## Fit-out budget

| Item | Supplier | Cost | Share | Ordered |
|---|---|---|---|---|
| Deck ovens | Kiln & Co | $54,000 | 29.3% | 2026-11-02 |
| Fit-out and joinery | Northside Joinery | $68,500 | 37.2% | 9 Nov 2026 |
| Counters and display | Glassline | $21,250 | 11.5% | Fri 6 Nov |
| Coffee machine | [Crema Works](https://crema.example) | $18,400 | 10.0% | 16/11/2026 |
| Signage | Bright Letters | $6,850 | 3.7% | pending |
| Contingency | — | $15,000 | 8.2% | |
| **Total** | | **$184,000** | 100% | |

## Opening week forecast

| Day | Loaves | Coffees | Revenue | Staff |
|---|---|---|---|---|
| Mon | 320 | 410 | $4,180.50 | 6 |
| Tue | 290 | 385 | $3,860.00 | 5 |
| Wed | 305 | 402 | $4,012.25 | 5 |
| Thu | 330 | 428 | $4,295.75 | 6 |
| Fri | 410 | 515 | $5,320.00 | 7 |
| Sat | 520 | 640 | $6,744.80 | 8 |

Numbers are from the first shop's opening, scaled for the bigger site.
`;

/** A small logo as a real PNG: a pine-green mark and a bar of type-coloured blocks on transparency. */
function logoPng() {
  const w = 240;
  const h = 80;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const inMark = (x - 40) ** 2 + (y - 40) ** 2 < 32 ** 2;
      const tree = inMark && Math.abs(x - 40) < (y - 14) * 0.55 && y > 14 && y < 60;
      const word = x > 86 && x < 228 && ((y > 24 && y < 38) || (y > 46 && y < 54 && x < 190));
      const [r, g, b, a] = tree ? [255, 255, 255, 255] : inMark ? [15, 107, 92, 255] : word ? [16, 24, 32, 255] : [0, 0, 0, 0];
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const contentOf = (text, title = 'Second shop fit-out') => X.brandContent({ title, text, path: 'Projects/Second shop fit-out.md', kit: KIT, url: () => '', now: new Date(2026, 10, 22) });
const inputOf = (content) => ({ content, theme: X.designTheme(KIT), kindName: 'Report', brandName: 'Harbour Pine', logo: logoPng() });
const readBook = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};

test('words read as values: currencies keep their symbol, percentages and counts their form, dates only when certain', () => {
  const v = (s) => X.readValue(s);
  assert.deepEqual([v('$54,000').value, v('$54,000').fmt, v('$54,000').kind], [54000, '"$"#,##0', 'money']);
  assert.deepEqual([v('$4,180.50').value, v('$4,180.50').fmt], [4180.5, '"$"#,##0.00']);
  assert.deepEqual([v('$184k').value, v('$184k').fmt], [184000, '"$"#,##0,"k"']);
  assert.deepEqual([v('€1.2m').value, v('€1.2m').fmt], [1200000, '"€"#,##0.0,,"m"']);
  assert.deepEqual([v('($300)').value, v('($300)').fmt], [-300, '"$"#,##0;("$"#,##0)']);
  assert.equal(v('-$1,200').value, -1200);
  assert.deepEqual([v('1,200 AUD').value, v('1,200 AUD').fmt], [1200, '#,##0" AUD"']);
  assert.deepEqual([v('12.5%').value, v('12.5%').fmt, v('12.5%').kind], [0.125, '0.0%', 'percent']);
  assert.equal(v('100%').fmt, '0.0%');
  assert.deepEqual([v('+3%').value, v('+3%').fmt], [0.03, '+0.0%;-0.0%;0.0%']);
  assert.deepEqual([v('1,284').value, v('1,284').fmt], [1284, '#,##0']);
  assert.equal(v('40k').value, 40000);
  assert.deepEqual([v('22 months').value, v('22 months').fmt], [22, '#,##0" months"']);
  assert.equal(v('2026').fmt, '0', 'a year never gets a thousands separator');
  assert.deepEqual([v('2026-11-02').kind, v('2026-11-02').value.toISOString()], ['date', '2026-11-02T00:00:00.000Z']);
  assert.equal(v('20 Mar 2027').value.toISOString(), '2027-03-20T00:00:00.000Z');
  assert.equal(v('Friday, 20 March 2027').value.toISOString(), '2027-03-20T00:00:00.000Z');
  assert.equal(v('March 20, 2027').value.toISOString(), '2027-03-20T00:00:00.000Z');
  assert.equal(v('16/11/2026').value.toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(v('Mar 2027').fmt, 'mmm yyyy');
  for (const words of ['Fri 6 Nov', '3/4/2026', '0412 555 019', '007', '~$40k', '$40–50k', '3 to 5', '2 pm', '12:30', 'pending', '1.2.3', '5m', '20 Mar', 'Kiln & Co', '2026-02-30', 'v2', '12 Market'])
    assert.equal(v(words), null, `"${words}" stays words`);
});

test('the tables come out of the blocks as plain words, under their headings', () => {
  const tables = X.readTables(contentOf(NOTE).blocks);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].heading, 'Fit-out budget');
  assert.deepEqual(tables[0].head, ['Item', 'Supplier', 'Cost', 'Share', 'Ordered']);
  assert.equal(tables[0].rows[0][1].text, 'Kiln & Co', 'entities decoded');
  assert.deepEqual(tables[0].rows[3][1], { text: 'Crema Works', link: 'https://crema.example' });
  assert.equal(tables[0].rows[6][0].text, 'Total', 'bold marks never reach a cell');
  assert.equal(tables[1].heading, 'Opening week forecast');
  assert.equal(X.htmlText('<p>a &lt;b&gt; <b>c</b><br>d &#x2014; &amp;</p>'), 'a <b> c\nd — &');
});

test('the workbook: a Summary first, a sheet per table, real numbers, live totals, a frozen header', async () => {
  const content = contentOf(NOTE);
  assert.ok(X.hasSheetContent(content));
  const buf = await X.designXlsx(inputOf(content));
  assert.ok(Buffer.isBuffer(buf) && buf.length > 2000);
  writeFileSync(path.join(work, 'fit-out.xlsx'), buf);
  const wb = await readBook(buf);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Fit-out budget', 'Opening week forecast']);
  assert.equal(wb.title, 'Second shop fit-out');
  assert.equal(wb.company, 'Harbour Pine');

  const sum = wb.getWorksheet('Summary');
  const cells = [];
  sum.eachRow((row) => row.eachCell((c) => cells.push(c)));
  const find = (text) => cells.find((c) => c.text === text || c.value === text);
  assert.equal(find('Second shop fit-out').font.color.argb, 'FF101820');
  assert.equal(find('Second shop fit-out').font.name, 'Figtree');
  assert.ok(find('Project brief'), 'the label');
  assert.ok(find('Second shop'), 'the subtitle line');
  const figure = (label) => sum.getCell(find(label).row, 5);
  assert.deepEqual([figure('Total budget').value, figure('Total budget').numFmt], [184000, '"$"#,##0,"k"']);
  assert.ok(figure('Doors open').value instanceof Date);
  assert.equal(figure('Doors open').value.toISOString(), '2027-03-20T00:00:00.000Z');
  assert.deepEqual([figure('Payback').value, figure('Expected margin').value, figure('Expected margin').numFmt], [22, 0.125, '0.0%']);
  const links = cells.filter((c) => c.formula && /HYPERLINK/.test(c.formula)).map((c) => c.formula);
  assert.deepEqual(links, [`HYPERLINK("#'Fit-out budget'!A1","Fit-out budget")`, `HYPERLINK("#'Opening week forecast'!A1","Opening week forecast")`]);
  assert.equal(sum.getImages().length, 1, 'the logo');

  const budget = wb.getWorksheet('Fit-out budget');
  assert.equal(budget.views[0].state, 'frozen');
  assert.equal(budget.views[0].ySplit, 4, 'frozen under the header row');
  const header = budget.getRow(4);
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => header.getCell(k).value), ['Item', 'Supplier', 'Cost', 'Share', 'Ordered']);
  assert.equal(header.getCell(1).fill.fgColor.argb, 'FF0F6B5C', 'the accent');
  assert.equal(header.getCell(1).font.color.argb, 'FFFFFFFF', 'words that read on it');
  assert.deepEqual([budget.getCell('C5').value, budget.getCell('C5').numFmt], [54000, '"$"#,##0']);
  assert.deepEqual([budget.getCell('D5').value, budget.getCell('D5').numFmt], [0.293, '0.0%']);
  assert.equal(budget.getCell('E5').value.toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(budget.getCell('E5').numFmt, 'd mmm yyyy');
  assert.equal(budget.getCell('E7').value, 'Fri 6 Nov', 'a day without its year stays words');
  assert.equal(budget.getCell('E8').value.toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(budget.getCell('E9').value, 'pending');
  assert.equal(budget.getCell('B5').value, 'Kiln & Co');
  assert.deepEqual(budget.getCell('B8').value, { text: 'Crema Works', hyperlink: 'https://crema.example' });
  assert.equal(budget.getCell('A11').value, 'Total');
  assert.deepEqual(budget.getCell('C11').value, { formula: 'SUM(C5:C10)', result: 184000 });
  assert.equal(budget.getCell('C11').numFmt, '"$"#,##0');
  assert.deepEqual(budget.getCell('D11').value, { formula: 'SUM(D5:D10)', result: 1 }, 'rounded shares that add to 100% within their rounding');
  assert.ok(!budget.getCell('C11').note, 'a right total has no note');
  assert.equal(budget.getCell('B11').value, null, 'an empty cell in the total row stays empty');
  assert.equal(budget.autoFilter, 'A4:E10', 'the filter stops above the total');
  assert.equal(budget.pageSetup.fitToWidth, 1);
  assert.equal(budget.pageSetup.printTitlesRow, '4:4');
  for (const c of [budget.getCell('A5'), budget.getCell('B5'), budget.getCell('E9')]) assert.ok(!/[<>]/.test(String(c.value)), 'no tag in a cell');

  const week = wb.getWorksheet('Opening week forecast');
  assert.deepEqual([week.getCell('B5').value, week.getCell('B5').numFmt], [320, '#,##0']);
  assert.deepEqual([week.getCell('D10').value, week.getCell('D10').numFmt], [6744.8, '"$"#,##0.00']);
  assert.equal(week.getCell('A5').value, 'Mon');
  let formulas = 0;
  week.eachRow((row) => row.eachCell((c) => (formulas += c.formula ? 1 : 0)));
  assert.equal(formulas, 1, 'no total invented: only the link back to the summary');
  assert.equal(week.rowCount, 10);

  const none = contentOf('# Plain\n\nJust words, no figures and no tables.\n\n- a list\n- of things\n', 'Plain');
  assert.equal(X.hasSheetContent(none), false);
  assert.equal(await X.designXlsx(inputOf(none)), null);
});

test('a typed total that disagrees keeps the formula and says what the note said; subtotals add up', async () => {
  const text = `# Stock order

## Flour order

| Supplier | Bags | Cost |
|---|---|---|
| Mill one | 40 | $1,200 |
| Mill two | 25 | $800 |
| Subtotal | 65 | $2,000 |
| Freight | 1 | $150 |
| Subtotal | 1 | $150 |
| Grand total | 66 | $2,250 |

## Fit-out budget

| Item | Cost | Margin |
|---|---|---|
| Ovens | $1,000 | 30% |
| Bench | $500 | 20% |
| Total | $1,600 | 27% |
`;
  const buf = await X.designXlsx(inputOf(contentOf(text, 'Stock order')));
  const wb = await readBook(buf);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Flour order', 'Fit-out budget']);
  const flour = wb.getWorksheet('Flour order');
  assert.equal(flour.getCell('C7').formula, 'SUM(C5:C6)');
  assert.equal(flour.getCell('C9').formula, 'SUM(C8)');
  assert.equal(flour.getCell('C10').formula, 'SUM(C7,C9)', 'a grand total adds the subtotals');
  assert.equal(flour.getCell('B10').formula, 'SUM(B7,B9)');
  const fit = wb.getWorksheet('Fit-out budget');
  assert.deepEqual(fit.getCell('B7').value, { formula: 'SUM(B5:B6)', result: 1600 }, 'the typed total is the cached result');
  assert.match(String(fit.getCell('B7').note?.texts?.[0]?.text ?? fit.getCell('B7').note), /The note said \$1,600; the rows above add up to \$1,500/);
  assert.equal(fit.getCell('C7').value, 0.27, 'a margin is no sum of its rows: the note’s figure stays');
});

// ── In LibreOffice ───────────────────────────────────────────────────────────────────────────────────────────────────

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const SOFFICE = has('soffice');

/** A LibreOffice profile of its own, set to work every formula out on opening (never trusting the cached results). */
function profile() {
  const dir = path.join(work, 'lo-profile');
  mkdirSync(path.join(dir, 'user'), { recursive: true });
  writeFileSync(
    path.join(dir, 'user', 'registrymodifications.xcu'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>\n</oor:items>\n`,
  );
  return pathToFileURL(dir).href;
}

const convert = (file, to, outdir) => {
  mkdirSync(outdir, { recursive: true });
  execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=${profile()}`, '--convert-to', to, '--outdir', outdir, file], { stdio: 'pipe', timeout: 120_000 });
  return path.join(outdir, `${path.basename(file, path.extname(file))}.${to.split(':')[0]}`);
};

test('in LibreOffice: it prints, and every total works itself out again', { skip: !SOFFICE && 'no soffice', timeout: 240_000 }, async () => {
  const file = path.join(work, 'fit-out.xlsx');
  if (!existsSync(file)) writeFileSync(file, await X.designXlsx(inputOf(contentOf(NOTE))));
  const pdf = convert(file, 'pdf', path.join(work, 'pdf'));
  assert.ok(existsSync(pdf) && readFileSync(pdf).length > 1000, 'the PDF exists');
  if (has('pdftoppm')) {
    execFileSync('pdftoppm', ['-png', '-r', '110', pdf, path.join(work, 'pdf', 'page')]);
    const first = ['page-1.png', 'page-01.png'].map((n) => path.join(work, 'pdf', n)).find(existsSync);
    assert.ok(first, 'page 1 rendered');
    console.log(`rendered page 1: ${first}`);
  }

  // The cached results wiped to zero: whatever LibreOffice shows now, it worked out itself.
  const wb = await readBook(readFileSync(file));
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
    if (c.formula && /^SUM/.test(c.formula)) c.value = { formula: c.formula, result: 0 };
  })));
  const wiped = path.join(work, 'wiped', 'fit-out.xlsx');
  mkdirSync(path.dirname(wiped), { recursive: true });
  writeFileSync(wiped, Buffer.from(await wb.xlsx.writeBuffer()));
  for (const [name, src] of [['as made', file], ['wiped', wiped]]) {
    const again = await readBook(readFileSync(convert(src, 'xlsx', path.join(work, `resaved-${name.replace(/\s/g, '-')}`))));
    const budget = again.getWorksheet('Fit-out budget');
    assert.equal(budget.getCell('C11').result, 184000, `${name}: the cost total`);
    assert.ok(Math.abs(budget.getCell('D11').result - 1) < 0.0015, `${name}: the shares (${budget.getCell('D11').result})`);
    assert.match(budget.getCell('C11').formula ?? '', /^SUM\(C5:C10\)$/i, `${name}: still a formula`);
  }
});

test('no kit and no logo: a quiet workbook; a table with no heading and no header row still gets a sheet', async () => {
  const text = `# Prices

| Loaf | $8.50 |
| Roll | $1.20 |

## Wide [draft]: week*

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 5 | 6 | 7 |
`;
  const content = X.brandContent({ title: 'Prices', text, kit: null, url: () => '' });
  const buf = await X.designXlsx({ content, theme: X.designTheme(null), kindName: 'One-pager', brandName: '', logo: null });
  const wb = await readBook(buf);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Table 1', 'Wide draft week']);
  const t = wb.getWorksheet('Table 1');
  assert.deepEqual([t.getCell('A4').value, t.getCell('A5').value, t.getCell('B5').value], ['Column 1', 'Loaf', 8.5]);
  assert.equal(t.getCell('A4').fill.fgColor.argb, 'FF101820', 'the neutral band');
  assert.equal(wb.getWorksheet('Wide draft week').pageSetup.orientation, 'landscape', 'a wide table prints landscape');
  assert.equal(wb.getWorksheet('Summary').getImages().length, 0);
  assert.equal(X.sheetName('A very long heading that runs well past thirty-one characters', 'x').length <= 31, true);
  assert.equal(X.sheetName("'History'", 'x'), 'History table');
});
