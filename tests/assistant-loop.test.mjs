// node --test tests/assistant-loop.test.mjs — the chat's assistant on a long job, as the request of 18 Oct 2026 went in
// the real app (Muse Spark 1.3). The project's folder had Project files/checklist/ with Cafe_Opening_Checklist_MASTER.xlsx
// and Cafe_Opening_Checklist_WexleySt.xlsx (many sheets), a README, a CHANGELOG and structure_baseline.json. The model
// looked for "checklist" at the top of the folder (a failure whose words for the model showed in the step list), then read
// the two workbooks cell range by cell range 32 times, never wrote, and the answer ended with no words at all. Proven
// here, with scripted models that behave like that one and like one following the instructions: the whole workbook in one
// look; the same read again refused; a file looked at too often refused; a nudge well before the end; at the end, plain
// last words (by one more model turn with no tools, or written here when that brings nothing); a template made in one
// call from the project's own copy (its master mentioned), with the file card and link, in a few steps; a sub-folder
// found by its name; the step list short (the same file counted on one line) and never showing words meant for the model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bigChecklist } from '../tools/office-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-assistant-loop-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    entry,
    [
      `export * from ${from('src/main/office-edit.ts')};`,
      `export { AgentTools, runAgent, agentSystem, forPerson, withoutModelNotes, MODEL_DIRECTED, NUDGE_HEAD, AGENT_LIMITS, writtenAnswer, undoChanges, TOOLS, trimOld } from ${from('src/main/agent.ts')};`,
      `export { addStep, stepWords } from ${from('src/shared/chat-steps.ts')};`,
      `export { VaultIndex } from ${from('src/main/indexer.ts')};`,
      `export { FileIndex } from ${from('src/main/file-index.ts')};`,
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

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const Launch = 'Projects/07 Wexley St Ashford (Launch)/07 Wexley St Ashford (Launch).md';
const NAME = '07 Wexley St Ashford (Launch)';
const RID = '0b6a9d2e-1c1f-4c8e-9a51-6f5c2d7e8a90';
const MASTER = 'Project files/checklist/Cafe_Opening_Checklist_MASTER.xlsx';
const WEXLEY = 'Project files/checklist/Cafe_Opening_Checklist_WexleySt.xlsx';

/** The project as it was: the checklist two folders down, the master and the cafe's working copy side by side. */
async function setUp(name) {
  const base = path.join(work, name);
  const folder = path.join(base, 'pc', NAME);
  const book = path.join(folder, 'Project files', 'checklist');
  mkdirSync(book, { recursive: true });
  writeFileSync(path.join(folder, MASTER), bigChecklist());
  writeFileSync(path.join(folder, WEXLEY), bigChecklist({ venue: 'Wexley St' }));
  writeFileSync(path.join(book, 'README.md'), '# Cafe opening checklist\n\nThe MASTER is the blank one; the filled-in copy is named for the shop (Cafe_Opening_Checklist_<Shop>.xlsx).\n');
  writeFileSync(path.join(book, 'CHANGELOG.md'), '# Changes\n\n- v3: Opening week sheet added.\n- v2: Equipment & supplies split from Kitchen.\n');
  writeFileSync(path.join(book, 'structure_baseline.json'), JSON.stringify({ sheets: ['Overview', 'Before opening', 'Kitchen', 'Equipment & supplies', 'Staff', 'Getting the word out', 'Opening week', 'Contacts', 'Lists'] }));
  const notes = {
    [Launch]: `---\ntype: project\nstatus: active\nfolder: ${folder}\n---\n# ${NAME}\n\n## Summary\nThe new cafe on Wexley St.\n`,
    'Projects/fileserver-01 · Site/fileserver-01 · Site.md': `---\ntype: project\nneuralspark-project: "remote:${RID}:/home/deploy/site"\n---\n# fileserver-01 · Site\n`,
  };
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(notes)) index.set(rel, text, Date.now(), text.length);
  const projects = () => Object.entries(notes).map(([rel, text]) => ({ path: rel, project: M.parseProject(text, rel) }));
  const refs = () => projects().filter((x) => x.project.folder).map((x) => ({ path: x.path, name: x.project.name, folder: x.project.folder }));
  const files = new M.FileIndex({ dir: path.join(base, 'index'), pdf: null, projects: refs, prefs: () => ({ on: true, off: [] }), watch: false });
  await files.sync();
  await files.idle();
  // The remote computer is off (its failure's words are the person's).
  const ask = async () => {
    throw Object.assign(new Error('offline'), { kind: 'offline' });
  };
  const access = new M.ProjectFolders(new M.RemoteFolders(ask), (project, rel) => files.read(project, rel));
  const trashed = [];
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
      write: async (abs, data, mode) => M.writeFileSafely(abs, data, mode),
      trash: async (abs) => {
        trashed.push(abs);
        rmSync(abs);
      },
    },
  };
  return { folder, host, files, trashed, hashes: { master: sha(readFileSync(path.join(folder, MASTER))), wexley: sha(readFileSync(path.join(folder, WEXLEY))) } };
}
const call = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
const toolCall = (id, name, args) => ({ id: String(id), name, arguments: JSON.stringify(args) });
/** A step list's words must never be the model's: instructions, "the person", tool names, Ironleaf's nudges. */
const TOOL_NAMES = () => new RegExp(`\\b(${M.TOOLS.map((t) => t.name).join('|')}|save_as|to_project)\\b`);
const modelWords = (words) => M.MODEL_DIRECTED.test(words) || TOOL_NAMES().test(words);

test('the whole workbook in one look: every sheet, its headings, what a reset clears and keeps, its first rows — short', async () => {
  const wb = await M.readWorkbook(bigChecklist({ venue: 'Wexley St' }));
  assert.equal(wb.sheets.length, 9);
  const text = M.workbookOverview(wb);
  assert.ok(text.length < 9_500, `short: ${text.length} characters`);
  for (const s of ['Overview', 'Before opening', 'Kitchen', 'Equipment & supplies', 'Staff', 'Getting the word out', 'Opening week', 'Contacts', 'Lists']) assert.match(text, new RegExp(`Sheet “${s.replace(/[&]/g, '\\$&')}” \\(A1:`), `${s} is in it`);
  assert.match(text, /Sheet “Kitchen” \(A1:H\d+, \d+ formulas\)\n  Above the headings: A1 Kitchen — tasks\n  Headings in row 3: A Ref · B Task · C Owner · D Due · E Status · F Notes · G Days before opening · H Days to go\n  \d+ rows under the headings/);
  assert.match(text, /Sheet “Kitchen”[\s\S]*?A reset clears \(filled in\): C Owner \(\d+ cells\) · D Due \(\d+ cells\) · E Status \(\d+ cells\) · F Notes \(\d+ cells\)/);
  assert.match(text, /Sheet “Kitchen”[\s\S]*?A reset keeps: the headings and titles; A Ref, B Task, G Days before opening, H Days to go \(formulas\)/);
  assert.match(text, /Filled-in fields: B3 beside “Venue” = Wexley St · B4 beside “Opening date” = 2026-11-04 · B5 beside “Cafe manager” = Ana Ruiz · B6 beside “Prepared by” = Sam Taylor/);
  assert.match(text, /First rows: 4: A4 2\.1 \| B4 Strip out \| C4 Priya Shah/);
  const blank = M.workbookOverview(await M.readWorkbook(bigChecklist()));
  assert.match(blank, /Sheet “Kitchen”[\s\S]*?A reset clears nothing here\./, 'the master is blank already');
  // A tiny budget: the sheets that don't fit are a line each, never left out.
  const tight = M.workbookOverview(wb, { maxChars: 2_000 });
  assert.match(tight, /More sheets, in a line each: .*“Lists”/);
});

test('names: a file in plain words without the one job’s details; the project’s own copy and the master told apart', () => {
  assert.equal(M.plainName('Cafe_Opening_Checklist_WexleySt.xlsx', NAME), 'Cafe Opening Checklist');
  assert.equal(M.plainName('Cafe_Opening_Checklist_MASTER.xlsx', NAME), 'Cafe Opening Checklist');
  assert.equal(M.plainName('Opening checklist v3 2026-10-12.docx'), 'Opening checklist');
  assert.equal(M.plainName('New Cafe Opening.xlsx'), 'New Cafe Opening', 'words that are the thing’s own stay');
  assert.equal(M.templateName('Cafe_Opening_Checklist_WexleySt.xlsx', NAME, 'Launch'), 'Launch template – Cafe Opening Checklist.xlsx');
  assert.equal(M.templateName('Cafe_Opening_Checklist_WexleySt.xlsx', NAME), 'Cafe Opening Checklist – template.xlsx');
  assert.ok(M.isOwnCopy('Cafe_Opening_Checklist_WexleySt.xlsx', NAME) && !M.isOwnCopy('Cafe_Opening_Checklist_MASTER.xlsx', NAME) && !M.isOwnCopy('Cafe_Opening_Checklist_CallowayRd.xlsx', NAME));
  assert.ok(M.isMasterCopy('Cafe_Opening_Checklist_MASTER.xlsx') && !M.isMasterCopy('Cafe_Opening_Checklist_WexleySt.xlsx'));
});

test('the step list: the same file again counts on one line; a write starts afresh; the model’s words never merge', () => {
  let list = [];
  const read = (file) => ({ kind: 'read', words: `Looked at the cells of ${file} in ${NAME}`, about: `workbook:${file}` });
  for (let i = 0; i < 12; i++) list = M.addStep(list, read(i % 2 ? 'Cafe_Opening_Checklist_WexleySt.xlsx' : 'Cafe_Opening_Checklist_MASTER.xlsx'));
  assert.equal(list.length, 2, 'two workbooks read by turns: two lines');
  assert.deepEqual(list.map(M.stepWords), [`Looked at the cells of Cafe_Opening_Checklist_MASTER.xlsx in ${NAME} · 6 times`, `Looked at the cells of Cafe_Opening_Checklist_WexleySt.xlsx in ${NAME} · 6 times`]);
  list = M.addStep(list, { kind: 'say', words: 'Let me look again.' });
  list = M.addStep(list, read('Cafe_Opening_Checklist_MASTER.xlsx'));
  assert.equal(list.at(-1).times, 7, 'the model’s words in between are passed over');
  list = M.addStep(list, { kind: 'write', words: 'Made the template Launch template – Cafe Opening Checklist.xlsx' });
  list = M.addStep(list, read('Cafe_Opening_Checklist_MASTER.xlsx'));
  assert.equal(list.at(-1).times, undefined, 'after something was made, a look is a new line');
  // Identical lines without a key count too.
  let same = [];
  for (let i = 0; i < 3; i++) same = M.addStep(same, { kind: 'search', words: 'Searched the project files for “launch checklist”' });
  assert.deepEqual(same.map(M.stepWords), ['Searched the project files for “launch checklist” · 3 times']);
});

test('a tool’s words for the person: notes to the model never reach the step list', () => {
  assert.equal(M.forPerson("There is no checklist in the project’s folder. (Tell the person this plainly; don't ask them for the folder's path.)"), 'There is no checklist in the project’s folder.');
  assert.equal(M.forPerson('There is no Checklist/Nope.xlsx in X’s folder. List the folder (list_project_folder) or search (search_project_files) to find its name.'), 'There is no Checklist/Nope.xlsx in X’s folder.');
  assert.equal(M.forPerson('Cafe_Opening_Checklist_WexleySt.xlsx is the person’s own file, so it is never changed in place. Give save_as with a new name.'), 'Cafe_Opening_Checklist_WexleySt.xlsx is your own file, so it is never changed in place.');
  assert.equal(M.forPerson('Give the project a name and a summary.'), '', 'nothing for the person: no step');
  assert.equal(M.withoutModelNotes('Looked in checklist (Tell the person plainly)'), 'Looked in checklist');
});

test('one look per thing: the same read refused, a file looked at too often refused, a sub-folder found by its name', async () => {
  const { host, files } = await setUp('looks');
  try {
    const steps = [];
    const tools = new M.AgentTools(host, [], (s) => steps.push(s), Launch);
    // "checklist" is two folders down: found by its name, listed, said where it is.
    const listed = await call(tools, 'list_project_folder', { path: 'checklist' });
    assert.ok(!listed.isError, listed.text);
    assert.match(listed.text, /› Project files\/checklist\n\(There is no “checklist” at the top of the project’s folder: the folder of that name is Project files\/checklist/);
    assert.match(listed.text, /Cafe_Opening_Checklist_MASTER\.xlsx \(Excel workbook/);
    assert.match(steps.at(-1).words, /^Looked in Project files\/checklist in /);
    // The whole workbook in one call, with what to do next.
    const look = await call(tools, 'read_spreadsheet', { path: WEXLEY });
    assert.ok(!look.isError, look.text);
    assert.match(look.text, /9 sheets\. This is the whole workbook in short:/);
    assert.match(look.text, /That is the whole workbook\./);
    assert.doesNotMatch(look.text, /call make_template on it now/, 'a look never pushes its own next step');
    assert.equal(steps.at(-1).words, `Looked over every sheet of Cafe_Opening_Checklist_WexleySt.xlsx in ${NAME}`);
    // The same again: refused, nothing done, no step.
    const n = steps.length;
    const again = await call(tools, 'read_spreadsheet', { path: WEXLEY.toUpperCase().replace('.XLSX', '.xlsx'), project: '' });
    assert.ok(again.repeat && !again.isError);
    assert.match(again.text, /^You already read exactly this earlier in this answer: what it said is above\. Act on it now; don't read it again\.$/);
    assert.equal(steps.length, n, 'a refused repeat is not a step');
    // Parts of it, a range at a time: allowed up to six looks at the file, then refused.
    for (let i = 0; i < 5; i++) assert.ok(!(await call(tools, 'read_spreadsheet', { path: WEXLEY, range: `Kitchen!A${4 + i * 5}:H${8 + i * 5}` })).repeat);
    const seventh = await call(tools, 'read_spreadsheet', { path: WEXLEY, range: 'Staff!A1:H9' });
    assert.ok(seventh.repeat);
    assert.match(seventh.text, /^You have looked at Cafe_Opening_Checklist_WexleySt\.xlsx 6 times in this answer: that is enough to act on/);
    assert.deepEqual(tools.mostLooked(), { name: 'Cafe_Opening_Checklist_WexleySt.xlsx', n: 6 });
    // A failure asked for again the same way: said, not done again.
    const missing = await call(tools, 'read_project_file', { project: NAME, path: 'nowhere.md' });
    assert.ok(missing.isError);
    const missingAgain = await call(tools, 'read_project_file', { project: NAME, path: 'nowhere.md' });
    assert.ok(missingAgain.repeat);
    // Search results say which copy is which.
    const found = await call(tools, 'search_project_files', { query: 'Cafe Opening Checklist' });
    assert.match(found.text, /Cafe_Opening_Checklist_WexleySt\.xlsx \(Excel workbook[^)]*\) — this project’s own copy/);
    assert.match(found.text, /Cafe_Opening_Checklist_MASTER\.xlsx \(Excel workbook[^)]*\) — a master copy/);
  } finally {
    files.stop();
  }
});

test('make_template: one call from the project’s own copy — copied, back to default by itself, saved beside it, said back', async () => {
  const { host, files, folder, hashes, trashed } = await setUp('template');
  try {
    const steps = [];
    const tools = new M.AgentTools(host, [], (s) => steps.push(s), Launch);
    // The path as a model might give it (the folder name only): the file is found by its name.
    const made = await call(tools, 'make_template', { path: 'checklist/Cafe_Opening_Checklist_WexleySt.xlsx', for: 'Launch' });
    assert.ok(!made.isError, made.text);
    const tpl = path.join(folder, 'Project files', 'checklist', 'Launch template – Cafe Opening Checklist.xlsx');
    assert.ok(existsSync(tpl));
    assert.match(made.text, /^Made a blank template: Project files\/checklist\/Launch template – Cafe Opening Checklist\.xlsx, in 07 Wexley St Ashford \(Launch\)’s folder \(.+\), from Project files\/checklist\/Cafe_Opening_Checklist_WexleySt\.xlsx\./);
    assert.match(made.text, /Cleared \d+ filled-in cells back to blank — “Overview”: B3 beside “Venue”, B4 beside “Opening date”, B5 beside “Cafe manager”, B6 beside “Prepared by”; “Before opening”: C Owner \(\d+\), D Due \(\d+\), E Status \(\d+\), F Notes \(\d+\)/);
    assert.match(made.text, /Kept: the headings and titles, .*“Kitchen”: A Ref, B Task, G Days before opening, H Days to go \(formulas\)/);
    assert.match(made.text, /The original, Project files\/checklist\/Cafe_Opening_Checklist_WexleySt\.xlsx, is exactly as it was\./);
    assert.match(made.text, /Beside it: Cafe_Opening_Checklist_MASTER\.xlsx \(a master copy\)\. The template was made from this project’s own copy, Cafe_Opening_Checklist_WexleySt\.xlsx/);
    const link = /link: \[(.+?)\]\((nv-file:[^)]+)\)/.exec(made.text);
    assert.deepEqual(M.parseProjectFileHref(link[2]), { project: Launch, rel: 'Project files/checklist/Launch template – Cafe Opening Checklist.xlsx' });
    const wb = await M.readWorkbook(readFileSync(tpl));
    const fit = wb.sheets.find((s) => s.name === 'Kitchen').cells;
    assert.ok(!fit.has('C4') && !fit.has('D4') && !fit.has('E4') && fit.get('B4').value === 'Strip out' && fit.get('H4').formula === 'IF(D4="","",D4-Overview!$B$4)', 'entries blank; tasks and formulas kept');
    assert.ok(!wb.sheets[0].cells.has('B3') && wb.sheets[0].cells.get('B9').formula === "COUNTA('Before opening'!B4:B60)");
    assert.equal(sha(readFileSync(path.join(folder, WEXLEY))), hashes.wexley, 'the working copy is byte for byte as it was');
    assert.equal(sha(readFileSync(path.join(folder, MASTER))), hashes.master);
    assert.deepEqual(steps.filter((s) => s.kind === 'write').map((s) => s.words), ['Made the template Launch template – Cafe Opening Checklist.xlsx']);
    assert.deepEqual(tools.cards().map((c) => [c.kind, c.title, c.entries.map((e) => e.name)]), [['made', 'Made for you', ['Launch template – Cafe Opening Checklist.xlsx']]]);
    assert.deepEqual(tools.madeLinks(), [`[Launch template – Cafe Opening Checklist.xlsx](${link[2]})`]);
    // The same call again makes nothing more.
    const again = await call(tools, 'make_template', { path: 'checklist/Cafe_Opening_Checklist_WexleySt.xlsx', for: 'Launch' });
    assert.ok(again.repeat && /^You did exactly this already in this answer; nothing was done again\. What it said then:\nMade a blank template/.test(again.text));
    assert.ok(!existsSync(path.join(folder, 'Project files', 'checklist', 'Launch template – Cafe Opening Checklist (2).xlsx')));
    // Into a folder the person named; a reset asked of the person's own file goes into a new file by itself.
    const named = await call(tools, 'make_template', { path: MASTER, folder: 'Templates' });
    assert.ok(existsSync(path.join(folder, 'Templates', 'Cafe Opening Checklist – template.xlsx')), named.text);
    const reset = await call(tools, 'edit_project_file', { path: WEXLEY, reset: true });
    assert.ok(!reset.isError, reset.text);
    assert.match(reset.text, /^Saved a new file, Project files\/checklist\/Cafe Opening Checklist – template\.xlsx, .*\(the original is the person’s own file, so the reset went into a new file\)/);
    // One Undo takes the three back to the Recycle Bin.
    const words = await M.undoChanges(host, tools.changes);
    assert.match(words, /^Undone: 3 changes\.$/);
    assert.equal(trashed.length, 3);
    assert.ok(!existsSync(tpl));
  } finally {
    files.stop();
  }
});

test('the guard: no step the person sees carries words meant for the model, whatever fails', async () => {
  const { host, files } = await setUp('guard');
  try {
    const steps = [];
    const tools = new M.AgentTools(host, [], () => {}, Launch);
    const failing = [
      ['list_project_folder', { path: 'nowhere at all' }],
      ['list_project_folder', { project: 'fileserver-01' }],
      ['read_project_file', { project: NAME, path: 'Project files/missing.docx' }],
      ['copy_project_file', { path: 'Project files/checklist/Nope.xlsx', to: 'x.xlsx' }],
      ['edit_project_file', { path: WEXLEY, cells: [{ cell: 'Overview!B3', value: 'x' }] }],
      ['edit_project_file', { path: WEXLEY, save_as: 'y.xlsx', replace: [{ find: 'a', text: 'b' }] }],
      ['read_spreadsheet', { path: 'Project files/checklist/README.md' }],
      ['read_spreadsheet', { path: WEXLEY, range: 'not a range' }],
      ['read_note', { path: 'Nope' }],
      ['search_notes', { query: '' }],
      ['save_project', { name: 'X' }],
      ['make_template', { path: WEXLEY, keep: ['zebra'] }],
      ['list_pc_folder', { path: '/etc' }],
      ['no_such_tool', {}],
    ];
    let n = 0;
    const run = await M.runAgent({
      messages: [{ role: 'user', text: 'do things' }],
      tools,
      signal: new AbortController().signal,
      onText: () => {},
      onStep: (s) => steps.push(s),
      stream: async (_m, _t, o) => {
        if (o?.tools === false) return { text: 'Some of that could not be done: the remote computer is off.', stopReason: 'stop' };
        if (n < failing.length) {
          const [name, args] = failing[n];
          return { text: '', stopReason: 'stop', toolCalls: [toolCall(++n, name, args)] };
        }
        return { text: 'Some of that could not be done: the remote computer is off.', stopReason: 'stop' };
      },
    });
    assert.ok(run.text);
    const shown = steps.filter((s) => s.kind !== 'say');
    assert.ok(shown.filter((s) => s.kind === 'error').length >= 5, `failures are shown: ${shown.map((s) => s.words).join(' | ')}`);
    for (const s of shown) assert.ok(!modelWords(s.words), `a step carries words for the model: “${s.words}”`);
    assert.ok(shown.some((s) => /^There is no nowhere at all in the project’s folder\.$/.test(s.words)), 'the folder problem in the person’s words');
    assert.ok(shown.some((s) => /isn’t connected right now/.test(s.words)), 'the remote computer said plainly');
  } finally {
    files.stop();
  }
});

/** The real failure, scripted: a model that looks and looks (new ranges, the two workbooks by turns, the same range now and
 *  then, the README and friends) and never writes. `last` answers the last turn (tools off). */
function lookingModel(last) {
  const seen = [];
  let k = 0;
  const opening = [
    ['notes_overview', {}],
    ['search_notes', { query: 'launch checklist' }],
    ['search_project_files', { query: 'launch checklist' }],
    ['search_project_files', { query: 'Cafe Opening Checklist' }],
    ['list_project_folder', { project: NAME, path: 'checklist' }],
    ['read_project_file', { project: NAME, path: 'Project files/checklist/README.md' }],
    ['read_project_file', { project: NAME, path: 'Project files/checklist/CHANGELOG.md' }],
    ['read_project_file', { project: NAME, path: 'Project files/checklist/structure_baseline.json' }],
  ];
  const stream = async (messages, onText, o) => {
    seen.push({ messages, tools: o?.tools !== false });
    if (o?.tools === false) return last(messages, onText);
    if (k < opening.length) {
      const [name, args] = opening[k++];
      return { text: '', stopReason: 'stop', toolCalls: [toolCall(`o${k}`, name, args)] };
    }
    // The cells, a window at a time, the two workbooks by turns; every third time a window it has read already.
    const i = k++ - opening.length;
    const file = i % 2 ? WEXLEY : MASTER;
    const row = i % 3 === 2 ? 4 : 4 + i * 6;
    return { text: '', stopReason: 'stop', toolCalls: [toolCall(`r${k}`, 'read_spreadsheet', { project: NAME, path: file, range: `Kitchen!A${row}:H${row + 5}` })] };
  };
  return { stream, seen };
}

test('a looping model, scripted: repeats refused, nudged early, stopped, and the person still gets a plain answer', async () => {
  const { host, files, folder, hashes } = await setUp('failure');
  try {
    const steps = [];
    const tools = new M.AgentTools(host, [], (s) => steps.push(s));
    let streamedLast = '';
    const model = lookingModel((messages, onText) => {
      const asked = messages.at(-1).text;
      assert.match(asked, /<what_you_did>\nSteps:\n- Looked at how your notes are organised/);
      assert.match(asked, /Looked at the cells of Cafe_Opening_Checklist_MASTER\.xlsx in 07 Wexley St Ashford \(Launch\) · \d+ times/);
      assert.match(asked, /I got stuck going over the same things, and you can't use tools now\./);
      assert.ok(!messages.some((m) => m.role === 'tool' || m.toolCalls), 'the last turn is plain words: any model takes it');
      const text = 'I found the launch checklist: Cafe_Opening_Checklist_WexleySt.xlsx (this cafe’s copy) and Cafe_Opening_Checklist_MASTER.xlsx, in Project files/checklist. I looked through them but didn’t make the template yet. Next: say “make a blank Launch template from Cafe_Opening_Checklist_WexleySt.xlsx” and I’ll do it in one step.';
      onText(text);
      streamedLast = text;
      return { text, stopReason: 'stop' };
    });
    const run = await M.runAgent({
      messages: [{ role: 'user', text: 'wheres the launch checklist? keep it as a template.. make a copy. put it back to default then save it as a Launch template to use on a new one' }],
      tools,
      signal: new AbortController().signal,
      onText: () => {},
      onStep: (s) => steps.push(s),
      stream: model.stream,
    });
    // (c) The person gets a plain answer, from one last turn with no tools.
    assert.equal(run.stopped, 'stuck');
    assert.equal(run.error, undefined);
    assert.equal(run.text, streamedLast);
    assert.equal(model.seen.at(-1).tools, false);
    assert.ok(model.seen.length <= 30, `stopped well before the old 40 steps: ${model.seen.length} model turns`);
    // (a) Repeats refused.
    const toolTexts = model.seen.at(-2).messages.filter((m) => m.role === 'tool').map((m) => m.text);
    assert.ok(toolTexts.some((t) => /^You already read exactly this earlier in this answer/.test(t)), 'a window read already is refused');
    // (b) The nudge came, before the end.
    const nudgedAt = model.seen.findIndex((x) => x.messages.some((m) => m.role === 'tool' && m.text.includes(`${M.NUDGE_HEAD} you have looked at`)));
    assert.ok(nudgedAt > 0 && nudgedAt < model.seen.length - 3, `nudged at turn ${nudgedAt} of ${model.seen.length}`);
    assert.match(toolTexts.find((t) => t.includes(M.NUDGE_HEAD)), /a blank template or “back to default” is one make_template call/);
    // The steps: short, and none for the model.
    const lines = steps.reduce((l, s) => M.addStep(l, s), []).filter((s) => s.kind !== 'say');
    assert.ok(lines.length <= 12, `a short list: ${lines.map(M.stepWords).join(' | ')}`);
    assert.ok(lines.some((s) => /^Looked at the cells of Cafe_Opening_Checklist_(MASTER|WexleySt)\.xlsx in .* · \d+ times$/.test(M.stepWords(s))));
    assert.ok(lines.some((s) => /^Looked in Project files\/checklist in /.test(s.words)), '“checklist” found two folders down');
    for (const s of lines) assert.ok(!modelWords(s.words), `model words in a step: ${s.words}`);
    assert.equal(sha(readFileSync(path.join(folder, WEXLEY))), hashes.wexley);
  } finally {
    files.stop();
  }
});

test('the same failure when the last turn brings nothing: plain words written by Ironleaf, never an empty answer', async () => {
  const { host, files } = await setUp('failure-quiet');
  try {
    const tools = new M.AgentTools(host, [], () => {});
    let shown = '';
    const model = lookingModel(() => ({ text: '', stopReason: 'stop' }));
    const run = await M.runAgent({ messages: [{ role: 'user', text: 'wheres the launch checklist? keep it as a template' }], tools, signal: new AbortController().signal, onText: (d) => (shown += d), onStep: () => {}, stream: model.stream });
    assert.equal(run.stopped, 'stuck');
    assert.match(run.text, /^I got stuck going over the same things — here's where it got to\.\n\nWhat I did: .*Looked at the cells of Cafe_Opening_Checklist_(MASTER|WexleySt)\.xlsx in 07 Wexley St Ashford \(Launch\) · \d+ times/);
    assert.match(run.text, /Nothing was changed\.\n\nWhat’s left: the rest of what you asked\.\n\nNext step: tell me exactly what to do with Cafe_Opening_Checklist_(MASTER|WexleySt)\.xlsx \(for example “make a blank template from Cafe_Opening_Checklist_(MASTER|WexleySt)\.xlsx”\) and I’ll do it in one go\.$/);
    assert.equal(shown, run.text, 'the words reach the window');
    assert.ok(!modelWords(run.text.replace(/“make a blank template[^”]*”/, '')), 'plain words for the person');
  } finally {
    files.stop();
  }
});

test('the end of the steps, the time, an error part way and a model that goes quiet: each ends in plain words', async () => {
  const { host, files } = await setUp('limits');
  try {
    // New files every step (no repeats): the steps run out; told how many are left first.
    const reads = ['README.md', 'CHANGELOG.md', 'structure_baseline.json', 'Cafe_Opening_Checklist_WexleySt.xlsx', 'Cafe_Opening_Checklist_MASTER.xlsx'];
    let i = 0;
    const asked = [];
    const many = await M.runAgent({
      messages: [{ role: 'user', text: 'read everything' }],
      tools: new M.AgentTools(host, [], () => {}, Launch),
      signal: new AbortController().signal,
      onText: () => {},
      onStep: () => {},
      limits: { steps: 5, nudgeAt: 3 },
      stream: async (messages, _t, o) => {
        asked.push(messages);
        if (o?.tools === false) return { text: 'I read the checklist’s files; the template isn’t made yet. Next: ask me to make it.', stopReason: 'stop' };
        const name = reads[i++ % reads.length];
        return { text: '', stopReason: 'stop', toolCalls: [toolCall(i, name.endsWith('.xlsx') ? 'read_spreadsheet' : 'read_project_file', { project: NAME, path: `Project files/checklist/${name}` })] };
      },
    });
    assert.equal(many.stopped, 'steps');
    assert.match(many.text, /^I read the checklist’s files/);
    assert.ok(asked.some((m) => m.some((x) => x.role === 'tool' && x.text.includes(`${M.NUDGE_HEAD} you have 3 steps left in this answer. Act now`))), 'told how many steps are left');
    // The time.
    let clock = 0;
    const slow = await M.runAgent({
      messages: [{ role: 'user', text: 'x' }],
      tools: new M.AgentTools(host, [], () => {}, Launch),
      signal: new AbortController().signal,
      onText: () => {},
      onStep: () => {},
      now: () => (clock += 400_000),
      stream: async (_m, _t, o) => (o?.tools === false ? { text: 'It took too long; here is what I found.', stopReason: 'stop' } : { text: '', stopReason: 'stop', toolCalls: [toolCall(clock, 'notes_overview', { n: clock })] }),
    });
    assert.equal(slow.stopped, 'time');
    // An error part way: the last words, and the error kept (Try again is offered).
    let e = 0;
    const broke = await M.runAgent({
      messages: [{ role: 'user', text: 'x' }],
      tools: new M.AgentTools(host, [], () => {}, Launch),
      signal: new AbortController().signal,
      onText: () => {},
      onStep: () => {},
      stream: async (_m, _t, o) => (o?.tools === false ? { text: 'The model stopped part way; I had looked at your notes.', stopReason: 'stop' } : ++e === 1 ? { text: '', stopReason: 'stop', toolCalls: [toolCall(1, 'notes_overview', {})] } : { text: 'Half a sen', stopReason: 'error', error: 'Connection reset' }),
    });
    assert.deepEqual([broke.stopped, broke.error, broke.text], ['error', 'Connection reset', 'The model stopped part way; I had looked at your notes.']);
    // Quiet after a step: no answer made of steps alone.
    let q = 0;
    const quiet = await M.runAgent({
      messages: [{ role: 'user', text: 'x' }],
      tools: new M.AgentTools(host, [], () => {}, Launch),
      signal: new AbortController().signal,
      onText: () => {},
      onStep: () => {},
      stream: async (_m, _t, o) => (o?.tools === false ? { text: 'I looked at how your notes are organised; nothing else was done yet.', stopReason: 'stop' } : ++q === 1 ? { text: '', stopReason: 'stop', toolCalls: [toolCall(1, 'notes_overview', {})] } : { text: '', stopReason: 'stop' }),
    });
    assert.deepEqual([quiet.stopped, quiet.text], ['silent', 'I looked at how your notes are organised; nothing else was done yet.']);
  } finally {
    files.stop();
  }
});

test('a model following the instructions: the template in a few steps, from the project’s own copy, with its card and link', async () => {
  const { host, files, folder, hashes } = await setUp('instructed');
  try {
    const sys = M.agentSystem(null, host.today(), null, [], '');
    for (const rule of [/call make_template on the file straight away/, /Don't look at the cells first/, /mean the project's own copy: make the template from it, and say in one short line that the master is there too\. Don't ask which\./, /Never read the same thing twice in one answer/, new RegExp(`Notes that start “${M.NUDGE_HEAD.replace(/[()]/g, '\\$&')}”`), /If the work stops before the job is done, say plainly what you did, what you found, what is left and one next step\./]) assert.match(sys, rule);
    assert.ok(!/look at it before changing a workbook/.test(sys), 'no longer told to look before changing');
    const steps = [];
    const tools = new M.AgentTools(host, [], (s) => steps.push(s));
    const seen = [];
    const last = (msgs) => msgs.filter((m) => m.role === 'tool').at(-1)?.text ?? '';
    const run = await M.runAgent({
      messages: [{ role: 'user', text: 'wheres the launch checklist? keep it as a template.. make a copy. put it back to default then save it as a Launch template to use on a new one' }],
      tools,
      signal: new AbortController().signal,
      onText: () => {},
      onStep: (s) => steps.push(s),
      stream: async (messages) => {
        seen.push(messages);
        if (seen.length === 1) return { text: '', stopReason: 'stop', toolCalls: [toolCall(1, 'search_project_files', { query: 'launch checklist' })] };
        if (seen.length === 2) {
          // The search marks the project's own copy: that one, straight to the template.
          const own = /· (\S.*?\.xlsx) \([^)]*\) — this project’s own copy/.exec(last(messages))[1];
          return { text: '', stopReason: 'stop', toolCalls: [toolCall(2, 'make_template', { project: NAME, path: own, for: 'Launch' })] };
        }
        const said = last(messages);
        const link = /link: (\[.+?\]\(nv-file:[^)]+\))/.exec(said)[1];
        assert.match(said, /Beside it: Cafe_Opening_Checklist_MASTER\.xlsx \(a master copy\)/);
        return { text: `Done. The launch checklist is the Wexley St cafe's copy in Project files/checklist. I made ${link} beside it: the owners, dates, statuses, notes and the cafe's details cleared; the sheets, tasks, headings and formulas kept. Your Wexley St copy is untouched, and the blank master (Cafe_Opening_Checklist_MASTER.xlsx) is there too.`, stopReason: 'stop' };
      },
    });
    assert.equal(run.stopped, undefined);
    assert.ok(seen.length <= 6, `${seen.length} steps`);
    assert.match(run.text, /I made \[Launch template – Cafe Opening Checklist\.xlsx\]\(nv-file:[^)]+\) beside it/);
    assert.ok(existsSync(path.join(folder, 'Project files', 'checklist', 'Launch template – Cafe Opening Checklist.xlsx')));
    assert.deepEqual(tools.cards().map((c) => [c.kind, c.entries.map((e) => e.name)]), [['made', ['Launch template – Cafe Opening Checklist.xlsx']]]);
    assert.equal(sha(readFileSync(path.join(folder, WEXLEY))), hashes.wexley);
    assert.equal(sha(readFileSync(path.join(folder, MASTER))), hashes.master);
    const lines = steps.reduce((l, s) => M.addStep(l, s), []).filter((s) => s.kind !== 'say');
    assert.deepEqual(lines.map(M.stepWords), ['Searched the project files for “launch checklist”', 'Made the template Launch template – Cafe Opening Checklist.xlsx']);
  } finally {
    files.stop();
  }
});
