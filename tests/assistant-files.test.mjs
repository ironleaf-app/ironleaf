// node --test tests/assistant-files.test.mjs — the chat's assistant working with the files in a project's folder
// (src/main/office-edit.ts, src/main/agent.ts; 18 Oct 2026, and was told no file was called "launch checklist", then asked
// which file, then told the tools couldn't copy or edit an Excel file). A real small workbook (and a Word document and a
// PowerPoint) is made here with a zip writer of the test's own. Proven: a workbook read cell by cell; a reset clears the
// filled-in entries and keeps the headings, task names, formulas, formatting, merged cells, validation and every other
// part byte for byte; cells set (dates as dates, new rows in order); words replaced across runs in Word and PowerPoint;
// the tools find "the launch checklist" by meaning, copy, save a template beside the original with the file card and link,
// never change or overwrite the original, change in place only what they made, never write outside a project's folder or
// on a remote computer; one Undo takes it all back (leaving what the person changed since); and the whole conversation
// with a scripted model: ask → find → look → save the template → answer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { COLS, DOCX, MERGE, PPTX, VALID, ix, checklist, s } from '../tools/office-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-assistant-files-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    entry,
    [
      `export * from ${from('src/main/office-edit.ts')};`,
      `export { AgentTools, runAgent, summarise, undoChanges, agentSystem, TOOLS } from ${from('src/main/agent.ts')};`,
      `export { VaultIndex } from ${from('src/main/indexer.ts')};`,
      `export { FileIndex } from ${from('src/main/file-index.ts')};`,
      `export { zipEntries } from ${from('src/main/doc-text.ts')};`,
      `export { ProjectFolders, RemoteFolders } from ${from('src/main/project-folders.ts')};`,
      `export { parseProject } from ${from('src/shared/project-file.ts')};`,
      `export { parseProjectFileHref } from ${from('src/shared/file-index.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Files made here ───────────────────────────────────────────────────────────────────────────────────────────────

/** Every part of a zip, unpacked (the zip reader Ironleaf already had, doc-text.ts). */
function unzip(buf) {
  const out = {};
  for (const e of M.zipEntries(buf)) {
    const at = e.offset;
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + e.compressed);
    out[e.name] = (e.method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  }
  return out;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const listAll = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
};

// ── Excel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a workbook read cell by cell: sheets, dates, formulas, the heading row and what a reset would clear', async () => {
  const wb = await M.readWorkbook(checklist());
  assert.deepEqual(wb.sheets.map((x) => x.name), ['Tasks', 'Lists']);
  const t = wb.sheets[0].cells;
  assert.equal(t.get('B2').value, 'Wexley St');
  assert.ok(t.get('D6').date, 'a number in a date format is a date');
  assert.equal(M.shown(t.get('D6')), M.serialToIso(46300));
  assert.equal(M.serialToIso(46313), '2026-10-18');
  assert.equal(M.isoToSerial('2026-10-18'), 46313);
  assert.equal(t.get('G6').formula, 'D6-$B$3');
  assert.ok(t.get('G6').sharedMaster && t.get('G7').sharedFormula);
  const words = M.workbookWords(wb);
  assert.match(words, /Headings in row 5: A Phase · B Task · C Owner · D Due · E Status · F Notes · G Days to go/);
  assert.match(words, /A reset clears \(filled in\): C Owner \(3 cells\) · D Due \(3 cells\) · E Status \(3 cells\) · F Notes \(1 cell\) · B2 beside “Venue” · B3 beside “Opening date”/);
  assert.match(words, /A reset keeps: the headings and titles; A Phase, B Task, G Days to go \(formulas\); 5 formula cells; all formatting/);
  assert.match(words, /6: A6 Before opening \| B6 Order signage \| C6 Sam \| D6 \d{4}-\d\d-\d\d \| E6 Done \| G6 =D6-\$B\$3/);
  assert.match(words, /Sheet “Lists”[\s\S]*A reset clears nothing here\./, 'a list of choices is the template’s own');
  const part = M.workbookWords(wb, { range: M.parseRange('Tasks!A9:G10') });
  assert.ok(!/Order signage/.test(part) && /E10 =COUNTIF\(E6:E9,"Done"\)/.test(part), 'a range looks at part of a sheet');
  assert.deepEqual(M.parseRange("'Site list'!C:E"), { sheet: 'Site list', c1: 3, r1: 1, c2: 5, r2: 1048576 });
  assert.deepEqual(M.parseRange('b4'), { c1: 2, r1: 4, c2: 2, r2: 4 });
  assert.equal(M.parseRange('not a range'), null);
});

test('reset: the filled-in entries cleared; headings, tasks, formulas, formatting and every other part kept', async () => {
  const before = checklist();
  const r = await M.changeWorkbook(before, { reset: true });
  assert.equal(r.cleared, 12);
  const a = unzip(before), b = unzip(r.bytes);
  assert.deepEqual(Object.keys(b), Object.keys(a), 'the same parts, in the same order (calcChain kept: no formula was touched)');
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet2.xml', 'xl/calcChain.xml']) assert.equal(b[part], a[part], `${part} byte for byte`);
  assert.equal(b['xl/workbook.xml'], a['xl/workbook.xml'].replace('<calcPr calcId="191029"/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>'), 'Excel works the formulas out again on opening');
  const sheet = b['xl/worksheets/sheet1.xml'];
  for (const keep of [COLS, MERGE, VALID, '<dimension ref="A1:G10"/>', '<pageMargins']) assert.ok(sheet.includes(keep), `kept: ${keep.slice(0, 30)}`);
  for (const cell of ['<c r="B2" s="3"/>', '<c r="B3" s="4"/>', '<c r="C6" s="3"/>', '<c r="D6" s="4"/>', '<c r="E6" s="3"/>', '<c r="F7" s="3"/>', '<c r="E8" s="3"/>']) assert.ok(sheet.includes(cell), `cleared with its formatting: ${cell}`);
  assert.ok(sheet.includes(`<c r="B6" ${s(ix('Order signage'))}</c>`) && sheet.includes(`<c r="A1" s="1" ${s(ix('Cafe Opening Checklist'))}</c>`) && sheet.includes(`<c r="C5" s="1" ${s(ix('Owner'))}</c>`), 'tasks, the title and the headings stay');
  assert.ok(sheet.includes('<c r="G6"><f t="shared" ref="G6:G9" si="0">D6-$B$3</f></c>') && sheet.includes('<c r="G7"><f t="shared" si="0"/></c>') && sheet.includes('<c r="E10" s="1"><f>COUNTIF(E6:E9,"Done")</f></c>'), 'formulas stay; their old answers go (no stale totals)');
  const back = await M.readWorkbook(r.bytes);
  const t = back.sheets[0].cells;
  assert.deepEqual(['B2', 'B3', 'C6', 'D6', 'E6', 'C7', 'D7', 'E7', 'F7', 'C8', 'D8', 'E8'].filter((x) => t.has(x)), [], 'every entry is blank');
  assert.equal(t.get('A6').value, 'Before opening');
  assert.equal(back.sheets[1].cells.size, 4);
  // keep: a column the reset would clear is left when asked (an Owner column holding roles, say).
  const kept = await M.changeWorkbook(before, { reset: { keep: [M.parseRange('Tasks!C:C')] } });
  assert.equal(kept.cleared, 9);
  assert.equal((await M.readWorkbook(kept.bytes)).sheets[0].cells.get('C6').value, 'Sam');
});

test('cells set: words, numbers, dates as dates, formulas, new rows in their place; a shared formula is never broken', async () => {
  const before = checklist();
  const r = await M.changeWorkbook(before, {
    edits: [
      { sheet: 'Tasks', ref: 'B2', value: 'Calloway Rd' },
      { sheet: 'Tasks', ref: 'D9', value: '2026-11-02' },
      { sheet: 'Tasks', ref: 'H6', value: 3 },
      { sheet: 'Tasks', ref: 'B12', value: 'Hand back the keys & sign off' },
      { sheet: 'Tasks', ref: 'B4', value: '=B2' },
      { sheet: 'Tasks', ref: 'A11', value: true },
    ],
  });
  assert.equal(r.set, 6);
  const sheet = unzip(r.bytes)['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('<c r="B2" s="3" t="inlineStr"><is><t xml:space="preserve">Calloway Rd</t></is></c>'), 'words, its formatting kept');
  assert.ok(sheet.includes(`<c r="D9" s="4"><v>${M.isoToSerial('2026-11-02')}</v></c>`), 'a date in a date cell is a date');
  assert.ok(/<row r="6">(?:(?!<\/row>).)*<c r="G6">(?:(?!<\/row>).)*<c r="H6"><v>3<\/v><\/c><\/row>/.test(sheet), 'a new cell goes after the others in its row (and the row loses its spans hint)');
  assert.ok(/<row r="3">.*<\/row><row r="4"><c r="B4"><f>B2<\/f><\/c><\/row><row r="5"/.test(sheet), 'a new row goes between its neighbours');
  assert.ok(/<row r="10">.*<\/row><row r="11"><c r="A11" t="b"><v>1<\/v><\/c><\/row><row r="12"><c r="B12" t="inlineStr"><is><t xml:space="preserve">Hand back the keys &amp; sign off<\/t><\/is><\/c><\/row><\/sheetData>/.test(sheet), 'new rows at the end, in order, escaped');
  assert.ok(sheet.includes('<c r="G7"><f t="shared" si="0"/><v>-20</v></c>'), 'setting cells keeps the formulas’ answers (nothing they use was cleared)');
  const back = (await M.readWorkbook(r.bytes)).sheets[0].cells;
  assert.equal(back.get('B12').value, 'Hand back the keys & sign off');
  assert.equal(M.shown(back.get('D9')), '2026-11-02');
  await assert.rejects(M.changeWorkbook(before, { edits: [{ sheet: 'Tasks', ref: 'G6', value: '' }] }), /holds a formula other cells share/);
  await assert.rejects(M.changeWorkbook(before, { edits: [{ sheet: 'Nope', ref: 'A1', value: 'x' }] }), /There is no sheet “Nope”\. The sheets: “Tasks”, “Lists”/);
  await assert.rejects(M.changeWorkbook(before, { edits: [{ sheet: '', ref: 'A1', value: 'x' }] }), /Say which sheet/);
  // A formula changed: Excel's list of formulas goes (it makes it again), with its link and its type.
  const f = await M.changeWorkbook(before, { edits: [{ sheet: 'Tasks', ref: 'E10', value: 'none' }] });
  const parts = unzip(f.bytes);
  assert.ok(!('xl/calcChain.xml' in parts) && !/calcChain/.test(parts['xl/_rels/workbook.xml.rels']) && !/calcChain/.test(parts['[Content_Types].xml']));
  // A range cleared leaves the formulas inside it.
  const c = await M.changeWorkbook(before, { clear: [M.parseRange('Tasks!E6:G10')] });
  assert.equal(c.formulasKept, 5);
  assert.equal((await M.readWorkbook(c.bytes)).sheets[0].cells.get('E10').formula, 'COUNTIF(E6:E9,"Done")');
});

test('Word and PowerPoint: words replaced across the runs they are split into, formatting kept, never across paragraphs', async () => {
  const r = await M.replaceInOffice(DOCX(), 'docx', [{ find: 'Wexley St', text: 'Calloway Rd' }]);
  assert.deepEqual(r.counts, [2]);
  const doc = unzip(r.bytes);
  assert.ok(doc['word/document.xml'].includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Calloway Rd</w:t></w:r><w:r><w:t xml:space="preserve"> cafe</w:t></w:r>'), 'the bold run takes the new words');
  assert.ok(doc['word/document.xml'].includes('<w:t>Opening: Wexley</w:t>') && doc['word/document.xml'].includes('<w:t>St is separate &amp; kept</w:t>'), 'a match never crosses paragraphs');
  assert.ok(doc['word/footer1.xml'].includes('Calloway Rd · confidential'), 'footers too');
  const p = await M.replaceInOffice(PPTX(), 'pptx', [{ find: 'Wexley St opening', text: 'Grand opening' }, { find: 'zebra', text: 'x' }]);
  assert.deepEqual(p.counts, [1, 0]);
  assert.ok(unzip(p.bytes)['ppt/slides/slide1.xml'].includes('<a:r><a:rPr sz="4000"/><a:t xml:space="preserve">Grand opening</a:t></a:r><a:r><a:t xml:space="preserve"></a:t></a:r>'));
  await assert.rejects(M.changeWorkbook(Buffer.from('not a zip at all, just words in a file'), { reset: true }), /protected with a password, or isn’t a working Office file/);
});

// ── The assistant's tools on a real folder ────────────────────────────────────────────────────────────────────────

const Launch = 'Projects/07 Wexley St Ashford (Launch)/07 Wexley St Ashford (Launch).md';
const NEXT = 'Projects/08 Calloway Rd (Launch)/08 Calloway Rd (Launch).md';
const REMOTE = 'Projects/fileserver-01 · Site/fileserver-01 · Site.md';
const RID = '0b6a9d2e-1c1f-4c8e-9a51-6f5c2d7e8a90';

/** A library with two cafe-opening projects (folders on this PC) and one on a remote computer; the files index real. */
async function setUp(name) {
  const base = path.join(work, name);
  const launch = path.join(base, 'pc', '07 Wexley St Ashford (Launch)');
  const next = path.join(base, 'pc', '08 Calloway Rd (Launch)');
  mkdirSync(path.join(launch, 'Checklist'), { recursive: true });
  mkdirSync(next, { recursive: true });
  writeFileSync(path.join(launch, 'Checklist', 'Cafe_Opening_Checklist_WexleySt.xlsx'), checklist());
  writeFileSync(path.join(launch, 'Checklist', 'Cafe_Opening_Checklist_MASTER.xlsx'), checklist());
  writeFileSync(path.join(launch, 'Cafe brief.docx'), DOCX());
  writeFileSync(path.join(launch, 'Floor plan.pdf'), Buffer.from('%PDF-1.4 not really'));
  writeFileSync(path.join(launch, 'Notes.md'), '# Notes\nKeys from the landlord on Friday.\n');
  const notes = {
    [Launch]: `---\ntype: project\nstatus: active\nfolder: ${launch}\n---\n# 07 Wexley St Ashford (Launch)\n\n## Summary\nThe new cafe on Wexley St.\n`,
    [NEXT]: `---\ntype: project\nstatus: planning\nfolder: ${next}\n---\n# 08 Calloway Rd (Launch)\n\n## Summary\nThe next new cafe.\n`,
    [REMOTE]: `---\ntype: project\nneuralspark-project: "remote:${RID}:/home/deploy/site"\n---\n# fileserver-01 · Site\n`,
  };
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(notes)) index.set(rel, text, Date.now(), text.length);
  const projects = () => Object.entries(notes).map(([rel, text]) => ({ path: rel, project: M.parseProject(text, rel) }));
  const refs = () => projects().filter((x) => x.project.folder).map((x) => ({ path: x.path, name: x.project.name, folder: x.project.folder }));
  const files = new M.FileIndex({ dir: path.join(base, 'index'), pdf: null, projects: refs, prefs: () => ({ on: true, off: [] }), watch: false });
  await files.sync();
  await files.idle();
  const ask = async (r) => {
    if (r.op === 'bytes') return { base64: checklist().toString('base64') };
    throw Object.assign(new Error('not here'), { kind: 'missing' });
  };
  const access = new M.ProjectFolders(new M.RemoteFolders(ask), (project, rel) => files.read(project, rel));
  const trashed = [];
  const writes = [];
  const host = {
    index,
    listing: async () => ({ files: Object.keys(notes).map((rel) => ({ rel, kind: 'note' })), folders: ['Projects'] }),
    exists: async (rel) => rel in notes,
    read: async (rel) => notes[rel],
    write: async () => {
      throw new Error('no notes are written in these tests');
    },
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Sunday 18 October 2026 (2026-10-18)',
    projectFiles: {
      search: (q, p, l) => files.search(q, { ...(p ? { project: p } : {}), limit: l ?? 12, snippets: 3 }),
      read: (p, r) => files.read(p, r),
      projects: refs,
      status: () => files.status(),
    },
    folders: { access, projects },
    fileWrites: {
      write: async (abs, data, mode) => {
        writes.push({ abs, mode });
        await M.writeFileSafely(abs, data, mode);
      },
      trash: async (abs) => {
        trashed.push(abs);
        rmSync(abs);
      },
    },
  };
  return { base, launch, next, host, files, trashed, writes, original: path.join(launch, 'Checklist', 'Cafe_Opening_Checklist_WexleySt.xlsx') };
}
const call = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

test('found by meaning: “the launch checklist” is the checklist in the project whose name has Launch', async () => {
  const { host, files } = await setUp('meaning');
  try {
    const tools = new M.AgentTools(host, [], () => {});
    const r = await call(tools, 'search_project_files', { query: 'launch checklist' });
    assert.ok(!r.isError, r.text);
    assert.match(r.text, /^No file has every one of those words\. “launch” is in the project’s name \(07 Wexley St Ashford \(Launch\), 08 Calloway Rd \(Launch\)\), so it counts for every file there\./);
    assert.match(r.text, /07 Wexley St Ashford \(Launch\) · Checklist\/Cafe_Opening_Checklist_(WexleySt|MASTER)\.xlsx \(Excel workbook/);
    assert.match(r.text, /link: \[Cafe_Opening_Checklist_WexleySt\.xlsx\]\(nv-file:/);
    assert.match(r.text, /matches: checklist/);
    const plural = await call(tools, 'search_project_files', { query: 'the Wexley St checklists file' });
    assert.match(plural.text, /Cafe_Opening_Checklist_WexleySt\.xlsx/, 'filler words left out; a plural finds the one');
    const none = await call(tools, 'search_project_files', { query: 'zebra crossing' });
    assert.match(none.text, /^No project file matches “zebra crossing”/);
  } finally {
    files.stop();
  }
});

test('copies and templates: a new file beside the original (or in another project), the original never changed or overwritten', async () => {
  const { host, files, original, launch, next, writes } = await setUp('copies');
  try {
    const keep = sha(readFileSync(original));
    const steps = [];
    const tools = new M.AgentTools(host, [], (x) => steps.push(x), Launch);
    const look = await call(tools, 'read_spreadsheet', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx' });
    assert.ok(!look.isError, look.text);
    assert.match(look.text, /^07 Wexley St Ashford \(Launch\) · Checklist\/Cafe_Opening_Checklist_WexleySt\.xlsx \(Excel workbook/);
    assert.match(look.text, /A reset clears \(filled in\): C Owner/);
    // Never in place: the person's own file.
    const inPlace = await call(tools, 'edit_project_file', { project: '07 Wexley St', path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', cells: [{ cell: 'Tasks!B2', value: 'x' }] });
    assert.ok(inPlace.isError);
    assert.match(inPlace.text, /the person’s own file, so it is never changed in place\. Give save_as/);
    assert.equal(inPlace.shown, 'Cafe_Opening_Checklist_WexleySt.xlsx is your own file, so it isn’t changed in place.', 'the step says it to the person, not the model');
    // The template: reset, saved beside the original.
    const made = await call(tools, 'edit_project_file', { project: '07 Wexley St', path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', save_as: 'Launch template – Cafe Opening Checklist', reset: true });
    assert.ok(!made.isError, made.text);
    const tpl = path.join(launch, 'Checklist', 'Launch template – Cafe Opening Checklist.xlsx');
    assert.ok(existsSync(tpl), 'the extension is the original’s');
    assert.match(made.text, /^Saved a new file, Checklist\/Launch template – Cafe Opening Checklist\.xlsx, in 07 Wexley St Ashford \(Launch\)’s folder/);
    assert.match(made.text, /Cleared 12 filled-in cells back to blank — “Tasks”: C Owner \(3\), D Due \(3\), E Status \(3\), F Notes \(1\), B2 beside “Venue”, B3 beside “Opening date”\. Kept: the headings and titles, “Tasks”: A Phase, B Task, G Days to go \(formulas\)/);
    assert.match(made.text, /The original, Checklist\/Cafe_Opening_Checklist_WexleySt\.xlsx, is exactly as it was\./);
    const link = /link: \[(.+?)\]\((nv-file:[^)]+)\)/.exec(made.text);
    assert.deepEqual(M.parseProjectFileHref(link[2]), { project: Launch, rel: 'Checklist/Launch template – Cafe Opening Checklist.xlsx' });
    const t = (await M.readWorkbook(readFileSync(tpl))).sheets[0].cells;
    assert.ok(!t.has('C6') && !t.has('B2') && t.get('B6').value === 'Order signage' && t.get('G6').formula === 'D6-$B$3');
    assert.equal(sha(readFileSync(original)), keep, 'the original is byte for byte as it was');
    assert.deepEqual(writes.map((w) => w.mode), ['new'], 'a new file: never written over anything');
    // The card beside the answer, and the change kept for Undo.
    const cards = tools.cards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].kind, 'made');
    assert.equal(cards[0].title, 'Made for you');
    assert.equal(cards[0].project, Launch);
    assert.equal(cards[0].place, launch);
    assert.deepEqual(cards[0].entries.map((e) => [e.path, e.name, e.kind, e.ext]), [['Checklist/Launch template – Cafe Opening Checklist.xlsx', 'Launch template – Cafe Opening Checklist.xlsx', 'file', 'xlsx']]);
    assert.deepEqual(M.summarise('t', tools.changes), { turnId: 't', made: 0, changed: 0, moved: 0, paths: [], projectsMade: 0, projectsChanged: 0, filesMade: 1 });
    assert.ok(steps.some((x) => x.words === 'Saved Launch template – Cafe Opening Checklist.xlsx' && !x.path), 'a step in words, never opened as a note');
    // The same name again: a second file, never over the first.
    const again = await call(tools, 'edit_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', save_as: 'Launch template – Cafe Opening Checklist.xlsx', reset: true });
    assert.match(again.text, /Checklist\/Launch template – Cafe Opening Checklist \(2\)\.xlsx/);
    assert.match(again.text, /A file called Launch template – Cafe Opening Checklist\.xlsx was there already, so this one is Launch template – Cafe Opening Checklist \(2\)\.xlsx/);
    // What it made can be changed in place.
    const fill = await call(tools, 'edit_project_file', { path: 'Checklist/Launch template – Cafe Opening Checklist.xlsx', cells: [{ cell: 'Tasks!A1', value: 'Launch Cafe Opening Checklist' }] });
    assert.ok(!fill.isError, fill.text);
    assert.match(fill.text, /^Changed Checklist\/Launch template – Cafe Opening Checklist\.xlsx/);
    assert.equal((await M.readWorkbook(readFileSync(tpl))).sheets[0].cells.get('A1').value, 'Launch Cafe Opening Checklist');
    // Used on a new one: copied into the next project's folder.
    const use = await call(tools, 'copy_project_file', { path: 'Checklist/Launch template – Cafe Opening Checklist.xlsx', to: 'Cafe Opening Checklist – Calloway Rd.xlsx', to_project: '08 Calloway' });
    assert.ok(!use.isError, use.text);
    assert.ok(existsSync(path.join(next, 'Cafe Opening Checklist – Calloway Rd.xlsx')));
    assert.match(use.text, /in 08 Calloway Rd \(Launch\)’s folder/);
    assert.deepEqual(tools.cards().map((c) => [c.projectName, c.title]), [['07 Wexley St Ashford (Launch)', 'Made for you · 2 files'], ['08 Calloway Rd (Launch)', 'Made for you']]);
    // Word: words replaced in a copy, the original kept.
    const brief = await call(tools, 'edit_project_file', { path: 'Cafe brief.docx', save_as: 'Cafe brief – Calloway Rd.docx', replace: [{ find: 'Wexley St', text: 'Calloway Rd' }] });
    assert.match(brief.text, /Replaced “Wexley St” with “Calloway Rd” \(2 places\)\. The formatting is as it was\./);
    // Text: replaced and added to.
    const notes = await call(tools, 'edit_project_file', { path: 'Notes.md', save_as: 'Notes for the template.md', replace: [{ find: 'Friday', text: 'opening week' }], append: '- Check the signage order.' });
    assert.equal(readFileSync(path.join(launch, 'Notes for the template.md'), 'utf8'), '# Notes\nKeys from the landlord on opening week.\n\n- Check the signage order.\n');
    assert.match(notes.text, /Added the words at the end\./);
    // A dot in a name isn't an extension: "v1.2" keeps its words and gets the original's.
    const dotted = await call(tools, 'copy_project_file', { path: 'Notes.md', to: 'Notes v1.2' });
    assert.ok(!dotted.isError && existsSync(path.join(launch, 'Notes v1.2.md')), dotted.text);
    // A PDF can be copied, not changed: said, with what can be done instead.
    const pdf = await call(tools, 'edit_project_file', { path: 'Floor plan.pdf', save_as: 'x.pdf', replace: [{ find: 'a', text: 'b' }] });
    assert.ok(pdf.isError);
    assert.match(pdf.text, /can’t be changed here \(\.pdf\)\. It can be copied with copy_project_file/);
    const copyPdf = await call(tools, 'copy_project_file', { path: 'Floor plan.pdf', to: 'Templates/Floor plan template' });
    assert.ok(existsSync(path.join(launch, 'Templates', 'Floor plan template.pdf')), 'a folder named in to is made inside the project’s folder');
    assert.ok(!copyPdf.isError);
  } finally {
    files.stop();
  }
});

test('never outside a project’s folder, never on a remote computer, never without the host’s say-so; Undo takes it back', async () => {
  const { host, files, original, launch, base, trashed } = await setUp('limits');
  try {
    const tools = new M.AgentTools(host, [], () => {}, Launch);
    for (const [name, args, words] of [
      ['copy_project_file', { path: '../../outside.xlsx', to: 'x.xlsx' }, /isn’t inside the project’s folder/],
      ['copy_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', to: '../../escaped.xlsx' }, /Give the new file a name|isn’t inside the project’s folder/],
      ['copy_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', to: '.hidden/x.xlsx' }, /empty or hidden/],
      ['copy_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', to: 'Copy.xlsx', to_project: 'fileserver-01' }, /on fileserver-01, a remote computer: files there can be read but not written from here\. A copy can go into a project on this PC instead \(to_project\)/],
      ['edit_project_file', { project: 'fileserver-01', path: 'plan.xlsx', reset: true }, /never changed in place|can be read but not written from here/],
      ['edit_project_file', { project: 'fileserver-01', path: 'plan.docx', replace: [{ find: 'a', text: 'b' }] }, /never changed in place/],
      ['copy_project_file', { path: 'Checklist/Nope.xlsx', to: 'x.xlsx' }, /There is no Checklist\/Nope\.xlsx in 07 Wexley St Ashford \(Launch\)’s folder\. List the folder/],
      ['edit_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', save_as: 'y.xlsx', replace: [{ find: 'a', text: 'b' }] }, /For a workbook, set cells/],
      ['edit_project_file', { path: 'Cafe brief.docx', save_as: 'y.docx', reset: true }, /a reset is for Excel workbooks/],
      ['edit_project_file', { path: 'Cafe brief.docx', save_as: 'y.docx', replace: [{ find: 'zebra', text: 'b' }] }, /None of those words are in Cafe brief\.docx/],
    ]) {
      const r = await call(tools, name, args);
      assert.ok(r.isError, `${name} ${JSON.stringify(args)} → ${r.text}`);
      assert.match(r.text, words);
    }
    // A link inside the folder that leads out of it is never followed.
    symlinkSync(base, path.join(launch, 'way-out'), 'dir');
    const out = await call(tools, 'copy_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', to: 'way-out/stolen.xlsx' });
    assert.ok(out.isError && /isn’t inside the project’s folder/.test(out.text), out.text);
    assert.ok(!existsSync(path.join(base, 'stolen.xlsx')));
    // From a remote computer into a project on this PC: read through the former host app, written
    // here.
    const fromRemote = await call(tools, 'copy_project_file', { project: 'fileserver-01', path: 'plan.xlsx', to: 'Plan from fileserver-01.xlsx', to_project: '07 Wexley St' });
    assert.ok(!fromRemote.isError, fromRemote.text);
    assert.ok(existsSync(path.join(launch, 'Plan from fileserver-01.xlsx')));
    // Agents' readers (agent-access.ts) have no fileWrites: nothing is written.
    const reader = new M.AgentTools({ ...host, fileWrites: undefined }, [], () => {});
    const refused = await call(reader, 'copy_project_file', { project: '07 Wexley St', path: 'Notes.md', to: 'n2.md' });
    assert.ok(refused.isError && /can’t be written here/.test(refused.text));
    // Undo: the files it made go to the Recycle Bin, one changed by the person since stays.
    const made = await call(tools, 'edit_project_file', { path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', save_as: 'Blank.xlsx', reset: true });
    assert.ok(!made.isError, made.text);
    const blank = path.join(launch, 'Checklist', 'Blank.xlsx');
    await call(tools, 'edit_project_file', { path: 'Checklist/Blank.xlsx', cells: [{ cell: 'Tasks!B2', value: 'Calloway Rd' }] });
    const edited = await call(tools, 'copy_project_file', { path: 'Notes.md', to: 'Notes copy.md' });
    assert.ok(!edited.isError);
    writeFileSync(path.join(launch, 'Notes copy.md'), 'the person changed this');
    const words = await M.undoChanges(host, tools.changes);
    assert.match(words, /^Undone: 3 changes\. Left as they are because you changed them since: Notes copy\.md\.$/);
    assert.ok(!existsSync(blank) && !existsSync(path.join(launch, 'Plan from fileserver-01.xlsx')));
    assert.ok(existsSync(path.join(launch, 'Notes copy.md')));
    assert.ok(trashed.every((t) => t.startsWith(launch)), 'only what it made goes to the Recycle Bin');
    assert.equal(sha(readFileSync(original)), sha(checklist()), 'the original never changed');
  } finally {
    files.stop();
  }
});

test('the whole conversation, scripted: ask for the launch checklist as a template → found, looked at, saved, linked', async () => {
  const { host, files, original, launch } = await setUp('conversation');
  try {
    const sys = M.agentSystem(null, host.today(), null, []);
    for (const rule of [/Act on the obvious reading; don't ask what you can tell/, /IS the thing they mean/, /“put it back to default”/, /Rollout template – Cafe Opening Checklist\.xlsx/, /Never say you can't do something your tools can do/, /with its link exactly as the tool gave it/]) assert.match(sys, rule);
    for (const name of ['copy_project_file', 'edit_project_file', 'read_spreadsheet']) assert.ok(M.TOOLS.some((t) => t.name === name), `${name} is offered`);
    assert.ok(!/Read only: it never changes the file\.$/.test(M.TOOLS.find((t) => t.name === 'read_project_file').description), 'reading no longer reads as “can’t change files”');
    const steps = [];
    // As the chat wires it (src/main/ai.ts): the tools' steps and the loop's go to the same list.
    const tools = new M.AgentTools(host, [], (x) => steps.push(x));
    const asked = [];
    const toolText = (msgs) => msgs.filter((m) => m.role === 'tool').at(-1)?.text ?? '';
    // A capable model's moves, read from where the conversation is (as tools/agent-e2e.mjs's scripted model does).
    const stream = async (messages) => {
      asked.push(messages.length);
      const last = toolText(messages);
      if (asked.length === 1) return { text: '', stopReason: 'stop', toolCalls: [{ id: '1', name: 'search_project_files', arguments: JSON.stringify({ query: 'launch checklist' }) }] };
      if (asked.length === 2) {
        const file = /· (Checklist\/Cafe_Opening_Checklist_WexleySt\.xlsx) /.exec(last)[1];
        return { text: 'Found it.', stopReason: 'stop', toolCalls: [{ id: '2', name: 'read_spreadsheet', arguments: JSON.stringify({ project: '07 Wexley St Ashford (Launch)', path: file }) }] };
      }
      if (asked.length === 3) {
        assert.match(last, /A reset clears \(filled in\)/);
        return { text: '', stopReason: 'stop', toolCalls: [{ id: '3', name: 'edit_project_file', arguments: JSON.stringify({ project: '07 Wexley St Ashford (Launch)', path: 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', save_as: 'Launch template – Cafe Opening Checklist.xlsx', reset: true }) }] };
      }
      const link = /link: (\[.+?\]\(nv-file:[^)]+\))/.exec(last)[1];
      const text = `Done: I made ${link} in the Checklist folder of 07 Wexley St Ashford (Launch). It's the Wexley St checklist with the owners, dates, statuses, notes and the cafe's details cleared; the phases, tasks, headings and formulas are kept. Your Wexley St copy is untouched.`;
      return { text, stopReason: 'stop' };
    };
    const run = await M.runAgent({
      messages: [{ role: 'user', text: 'keep it as a template.. make a copy. put it back to default then save it as a Launch template to use on a new one' }],
      tools,
      signal: new AbortController().signal,
      onText: () => {},
      onStep: (x) => steps.push(x),
      stream,
    });
    assert.equal(run.error, undefined);
    assert.match(run.text, /^Done: I made \[Launch template – Cafe Opening Checklist\.xlsx\]\(nv-file:[^)]+\) in the Checklist folder/);
    const tpl = path.join(launch, 'Checklist', 'Launch template – Cafe Opening Checklist.xlsx');
    assert.ok(existsSync(tpl));
    assert.equal(sha(readFileSync(original)), sha(checklist()));
    assert.deepEqual(tools.cards().map((c) => [c.kind, c.entries.map((e) => e.name)]), [['made', ['Launch template – Cafe Opening Checklist.xlsx']]]);
    assert.deepEqual(steps.filter((x) => x.kind !== 'say').map((x) => x.words), ['Searched the project files for “launch checklist”', 'Looked over every sheet of Cafe_Opening_Checklist_WexleySt.xlsx in 07 Wexley St Ashford (Launch)', 'Saved Launch template – Cafe Opening Checklist.xlsx']);
    assert.ok(!steps.some((x) => x.kind === 'error'), 'no step failed');
    assert.deepEqual(listAll(launch), ['Cafe brief.docx', 'Checklist/Cafe_Opening_Checklist_MASTER.xlsx', 'Checklist/Cafe_Opening_Checklist_WexleySt.xlsx', 'Checklist/Launch template – Cafe Opening Checklist.xlsx', 'Floor plan.pdf', 'Notes.md'], 'one new file, nothing else touched');
    assert.ok(statSync(tpl).size > 0);
  } finally {
    files.stop();
  }
});
