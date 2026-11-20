// node --test tests/csv.test.mjs — spreadsheets in and out of views (src/shared/csv.ts; 21 Oct 2026): a view written as
// CSV the way Excel opens it (byte-order mark, Windows line ends, quotes only where needed, nothing a spreadsheet would
// run), with its own columns and formulas worked out; and a spreadsheet read back (commas, semicolons, quotes, line
// breaks inside a cell) and shaped into notes whose properties are numbers, ticks and days where every row agrees.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-csv-'));
let C, V, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ['csv', 'views', 'frontmatter'].map((m, i) => `export * as ${'CVF'[i]} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'csv.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ C, V, F } = await import(pathToFileURL(path.join(work, 'csv.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = new Date(2026, 9, 19, 9, 5).getTime();
const note = (p, props = {}, tags = []) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T, tags, props });
const orders = () => [
  note('Orders/Wedding cake.md', { price: 320, quantity: 1, due: '2026-10-24', paid: true, people: ['Mia', 'Tama'], client: '[[Harbour Cafe|the cafe]]' }),
  note('Orders/Croissants, plain.md', { price: 4.5, quantity: 60, due: '2026-10-22', paid: false, notes: 'Say "thanks"\nand smile' }),
  note('Orders/Pie week.md', { price: 6, quantity: 'lots', notes: '=HYPERLINK("x")' }),
];

test('a view as CSV: Excel’s byte-order mark, Windows line ends, the view’s headings, its order and its formulas', () => {
  const def = { ...V.defaultView({ kind: 'folder', value: 'Orders' }), columns: ['price', 'formula.Total', 'due', 'paid', 'people', 'client', 'notes', 'file.modified'], formulas: { Total: 'price * quantity' }, labels: { price: 'Price (A$)' }, sort: { prop: 'formula.Total', dir: 'desc' } };
  const rows = V.runView(def, orders());
  const text = C.viewCsv(def, rows);
  assert.ok(text.startsWith('﻿'), 'the byte-order mark Excel looks for');
  assert.ok(text.endsWith('\r\n'));
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0], 'Name,Price (A$),Total,Due,Paid,People,Client,Notes,Changed');
  assert.equal(lines[1], 'Wedding cake,320,320,2026-10-24,Yes,"Mia, Tama",the cafe,,2026-10-19 09:05');
  assert.equal(lines[2], '"Croissants, plain",4.5,270,2026-10-22,No,,,"Say ""thanks""\nand smile",2026-10-19 09:05', 'a line break stays inside its quoted cell');
  assert.equal(lines[3], `Pie week,6,,,,,,"'=HYPERLINK(""x"")",2026-10-19 09:05`, 'a formula that can’t be worked out is empty; words a spreadsheet would run get a quote mark');
  assert.equal(C.csvCell('-12.5'), '-12.5', 'a negative number stays a number');
  assert.equal(C.csvCell('+61 400 000 000'), "'+61 400 000 000");
  assert.equal(C.csvCell('@home'), "'@home");

  const board = { ...V.defaultView(), layout: 'board', groupBy: 'paid', cardProps: ['price'] };
  assert.deepEqual(C.shownColumns(board), ['file.title', 'paid', 'price'], 'a board: the name, its columns’ property, what its cards show');
  assert.deepEqual(C.shownColumns({ ...V.defaultView(), layout: 'calendar', dateProp: 'due', cardProps: ['due'] }), ['file.title', 'due']);
});

test('a CSV file read back: quotes, line breaks in a cell, semicolons or tabs, the byte-order mark, blank lines', () => {
  const back = C.parseCsv(C.toCsv([['Name', 'Notes'], ['A, B', 'two\nlines'], ['Say "hi"', '']]));
  assert.deepEqual(back, [['Name', 'Notes'], ['A, B', 'two\nlines'], ['Say "hi"', '']]);
  assert.deepEqual(C.parseCsv('Name;Price\r\nPie;6,50\r\n\r\n'), [['Name', 'Price'], ['Pie', '6,50']], 'a semicolon file (a comma is then part of a number)');
  assert.deepEqual(C.parseCsv('Name\tQty\nPie\t3'), [['Name', 'Qty'], ['Pie', '3']]);
  assert.deepEqual(C.parseCsv('only'), [['only']]);
  assert.deepEqual(C.parseCsv(''), []);
});

test('rows become notes: one column names them, the rest are properties of the right kind', () => {
  const table = C.parseCsv(
    [
      'Client,Stage,Budget,Signed,Start,Tags,Notes,Stage',
      'Harbour Cafe,Lead,"12,500",yes,24/10/2026,"food, local",Met at the market,x',
      'Coastline Joinery,Won,9800,no,03/11/2026,trades,,',
      'Harbour Cafe,Won,400,true,1/12/2026,,"Second job",',
      ',Lead,1,no,01/01/2027,,no name,',
      'What/is: this?,Lead,,,,,,',
    ].join('\n'),
  );
  const plan = C.planImport(table);
  assert.equal(plan.nameColumn, 'Client');
  assert.deepEqual(plan.columns.map((c) => [c.key, c.kind]), [['Stage', 'text'], ['Budget', 'number'], ['Signed', 'checkbox'], ['Start', 'date'], ['Tags', 'list'], ['Notes', 'text'], ['Stage 2', 'text']]);
  assert.deepEqual(plan.notes.map((n) => n.name), ['Harbour Cafe', 'Coastline Joinery', 'Harbour Cafe 2', 'What is this'], 'one name twice gets a 2; what file names can’t hold is taken out');
  assert.equal(plan.skipped, 1, 'a row with no name is left out');
  assert.deepEqual(plan.notes[0].props, { Stage: 'Lead', Budget: 12500, Signed: true, Start: '2026-10-24', Tags: ['food', 'local'], Notes: 'Met at the market', 'Stage 2': 'x' }, 'Australian days, day first');
  assert.deepEqual(plan.notes[1].props, { Stage: 'Won', Budget: 9800, Signed: false, Start: '2026-11-03', Tags: ['trades'] }, 'empty cells are left off');

  const text = C.importedNoteText(plan.notes[0]);
  assert.match(text, /^---\nStage: Lead\nBudget: 12500\nSigned: true\nStart: 2026-10-24\nTags:\n  - food\n  - local\n/);
  assert.deepEqual(F.readProps(text), plan.notes[0].props, 'what is written reads back the same');
  assert.equal(C.importedNoteText({ name: 'x', props: {} }), '');

  const byStage = C.planImport(table, 'Notes');
  assert.equal(byStage.nameColumn, 'Notes');
  assert.deepEqual(byStage.notes.map((n) => n.name), ['Met at the market', 'Second job', 'no name']);
  assert.deepEqual(C.importedViewColumns(byStage).slice(0, 2), ['Client', 'Stage']);

  const american = C.planImport(C.parseCsv('Name,When\nA,10/24/2026\nB,11/3/2026'));
  assert.deepEqual(american.notes.map((n) => n.props.When), ['2026-10-24', '2026-11-03'], 'month first when a day over 12 says so');
  assert.equal(C.cleanNoteName('  Report: Q3 / final.  '), 'Report Q3 final');
});

test('a spreadsheet exported from a view comes back in as the same notes', () => {
  const def = { ...V.defaultView({ kind: 'folder', value: 'Orders' }), columns: ['price', 'due', 'paid'] };
  const rows = V.runView(def, orders().slice(0, 2));
  const plan = C.planImport(C.parseCsv(C.viewCsv(def, rows)));
  assert.deepEqual(plan.notes.map((n) => n.name), ['Croissants, plain', 'Wedding cake']);
  assert.deepEqual(plan.notes[1].props, { Price: 320, Due: '2026-10-24', Paid: true });
});

test('F19: bare Y/N is ticks under a flag heading, words elsewhere — and the kinds are previewed', () => {
  const flag = C.planImport(C.parseCsv('Supplier,GST,Paid\nAcme,Y,N\nBaker,N,Y\n'));
  assert.deepEqual(flag.columns.map((c) => [c.key, c.kind]), [['GST', 'checkbox'], ['Paid', 'checkbox']]);
  assert.deepEqual(flag.notes[0].props, { GST: true, Paid: false });
  const words = C.planImport(C.parseCsv('Supplier,Notes\nAcme,Y\nBaker,N\n'));
  assert.deepEqual(words.columns.map((c) => [c.key, c.kind]), [['Notes', 'text']]);
  assert.deepEqual(words.notes[0].props, { Notes: 'Y' });
  const question = C.planImport(C.parseCsv('Supplier,Has GST?\nAcme,Y\nBaker,N\n'));
  assert.equal(question.columns[0].kind, 'checkbox');
  assert.equal(C.columnKindWords(flag.columns), '“GST”, “Paid” as ticks');
  assert.equal(C.columnKindWords(words.columns), '');
});

test('F20: a table with no headings keeps every row as data', () => {
  const table = C.parseCsv('Apples,4.50\nPears,3.20\nOranges,5.00\n');
  assert.equal(C.hasHeadings(table), false);
  const plan = C.planImport(table);
  assert.equal(plan.nameColumn, 'Column 1');
  assert.deepEqual(plan.notes.map((n) => n.name), ['Apples', 'Pears', 'Oranges']);
  assert.deepEqual(plan.notes[0].props, { 'Column 2': 4.5 });
  const headed = C.parseCsv('Fruit,Price\nApples,4.50\nPears,3.20\n');
  assert.equal(C.hasHeadings(headed), true);
  assert.deepEqual(C.planImport(headed).notes.map((n) => n.name), ['Apples', 'Pears']);
});
