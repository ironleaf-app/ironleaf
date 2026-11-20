// node --test tests/agent-files.test.mjs — files agents make, delivered into the project they are for (18 Oct 2026; the
// ). ONE RULE: anything an agent makes for a project lands in that project. On made-up bakery and IT projects (one with
// a folder on this PC, one with none, one on a remote computer): the names (safe, never a program, the next free name),
// a file whole in one call, a file over 1 MB in parts through the real chunk path (each call well under 1 MB), carrying
// on after a break, a SHA-256 that doesn't match, a name already there (a new name, or replaced when asked), the
// project's own Files when it has no folder, a remote project's files kept in Ironleaf, a note's attachment, Undo, and
// the rule in what agents are told.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-files-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/main/agent-access.ts')};`,
      `export { AgentUploads, decodeBase64 } from ${src('src/main/agent-files.ts')};`,
      `export { VaultFiles } from ${src('src/main/vault-files.ts')};`,
      `export * from ${src('src/shared/agent-files.ts')};`,
      `export { AGENT_TOOLS } from ${src('src/shared/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject } from ${src('src/shared/project-file.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'files.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'files.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const STORE = 'Projects/Studio Upgrade/Studio Upgrade.md';
const WINTER = 'Projects/Winter Menu Launch/Winter Menu Launch.md';
const HARBOUR = 'Projects/Harbour Lane/Harbour Lane.md';
const REMOTE = 'remote:3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f:/home/office/harbour-lane';

let n = 0;
/** A library on disk, one project with a folder on this PC, one with none, one on a remote computer. */
function setup({ level = 'edit' } = {}) {
  const base = path.join(work, `run-${++n}`);
  const library = path.join(base, 'library');
  const pcFolder = path.join(base, 'pc', 'Studio Upgrade');
  const dataDir = path.join(base, 'data');
  mkdirSync(pcFolder, { recursive: true });
  writeFileSync(path.join(pcFolder, 'Closeout report.pdf'), 'an older closeout');
  const notes = {
    [STORE]: `---\ntype: project\nstatus: active\nhealth: on track\nfolder: ${pcFolder}\n---\n# Studio Upgrade\n\n## Summary\n\nEvery store’s tills move to the new build.\n`,
    [WINTER]: `---\ntype: project\nstatus: active\n---\n# Winter Menu Launch\n\n## Summary\n\nThe bakery’s winter menu.\n`,
    [HARBOUR]: `---\ntype: project\nstatus: active\nneuralspark-project: ${REMOTE}\n---\n# Harbour Lane\n\n## Summary\n\nOn officebox, in /home/office/harbour-lane.\n`,
    'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
    'Private notes/Diary.md': '# Diary\n\nSecret.\n',
  };
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const history = new M.ProjectHistory();
  const added = [];
  const trashed = [];
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const host = {
    dataDir,
    kind: 'embedded',
    ready: async () => {},
    library: () => library,
    index,
    notes: { index, exists: async (rel) => files.has(rel), read: async (rel) => files.get(rel), clean, listing: async () => ({ files: [], folders: [] }) },
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async (rel, edits, by, words) => {
      const before = index.content(rel);
      const p = M.parseProject(before, rel);
      const done = edits.map((e) => M.applyProjectEdit(p, e, '18 Oct 2026'));
      const after = M.serializeProject(p, before);
      await writeNote(rel, after);
      history.record(rel, { before, after, words: words ?? done[0], by });
      return { file: rel, words: words ?? done[0], before, after };
    },
    undoProject: async () => {},
    createProject: async () => '',
    writeNote,
    trash: async () => {},
    today: () => M.todayData(index, { path: 'Daily/2026-10-18.md', exists: false }),
    dailyPath: () => 'Daily/2026-10-18.md',
    dailyNote: async () => 'Daily/2026-10-18.md',
    freeNote: async (folder, title) => `${folder}/${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    files: {
      target: (rel) => {
        const p = projects.view(rel).project;
        if (p.folder) return { kind: 'folder', folder: p.folder };
        return { kind: 'library', folder: M.ownFilesFolder(rel), ...(p.key?.startsWith('remote:') ? { remoteName: 'officebox' } : {}) };
      },
      absolute: (rel) => (rel ? path.join(library, ...rel.split('/')) : library),
      addedToLibrary: async (rel) => void added.push(rel),
      addedToFolder: (rel, abs) => void added.push(`${rel} → ${abs}`),
      trashFile: async (abs) => {
        trashed.push(abs);
        rmSync(abs, { force: true });
      },
      attachmentsFor: () => 'Attachments',
    },
    changed: () => {},
  };
  const access = new M.AgentAccess(host);
  access.load();
  return { access, host, files, library, pcFolder, dataDir, added, trashed, level };
}
const words = (r) => r.content.map((c) => c.text).join('\n');
/** Connect an AI at a level: Read only for 'read', Read and write for anything more. */
async function agent(_t, level = 'edit') {
  return { who: { level: level === 'read' ? 'read' : 'edit' } };
}
/** One call from another AI app on this PC, at that agent's level (the local MCP server's own door). */
async function callAs(access, who, name, args) {
  await access.setLocalMcp({ on: true, level: who.level });
  return access.asLocalMcp(name, args);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('names: only the last part, nothing Windows refuses, never a program; the next free name; a project’s own Files', () => {
  assert.equal(M.safeFileName('../../evil/Closeout report.pdf'), 'Closeout report.pdf');
  // The one shared cleaner (5 Nov 2026, one reserved-name rule): the refused `?` becomes a space, then the stem's
  // trailing space before the extension drops, as a title's full stop does ("LF meeting..md" reads "LF meeting.md").
  assert.equal(M.safeFileName('C:\\Users\\x\\Q3: plan?.docx'), 'Q3 plan.docx');
  assert.equal(M.safeFileName('report.pdf. . '), 'report.pdf');
  assert.equal(M.safeFileName('CON.txt'), 'CON file.txt');
  assert.throws(() => M.safeFileName('setup.exe'), /runs when it is opened/);
  assert.throws(() => M.safeFileName('run.ps1'), /runs when it is opened/);
  assert.throws(() => M.safeFileName('   '), /Give the file a name/);
  assert.equal(M.safeFileName(`${'a'.repeat(300)}.pdf`).length, 150);
  assert.equal(M.freeName('Report.pdf', new Set(['report.pdf'])), 'Report (2).pdf');
  assert.equal(M.freeName('Report.pdf', new Set(['report.pdf', 'report (2).pdf'])), 'Report (3).pdf');
  assert.equal(M.freeName('Report (2).pdf', new Set(['report (2).pdf'])), 'Report (3).pdf');
  assert.equal(M.ownFilesFolder(STORE), 'Projects/Studio Upgrade/Files');
  assert.equal(M.ownFilesFolder('Clients/Harbour.md'), 'Clients/Files/Harbour', 'one rule for every record: Files beside it');
  assert.throws(() => M.safeSubfolder('../outside'), /inside the project/);
  assert.equal(M.safeSubfolder('Reports\\2026'), 'Reports/2026');
  assert.deepEqual(M.namedFiles('Closeout report saved: Harbour closeout.pdf (6 pages)', ['Harbour closeout.pdf', 'closeout.pdf', 'Other.docx']), ['Harbour closeout.pdf']);
  assert.throws(() => M.decodeBase64('***'), /valid base64/);
  assert.throws(() => M.decodeBase64('A'.repeat(M.CHUNK_CHARS + 4)), /in parts/);
  assert.equal(M.deliveredWords({ agentName: 'Other AI apps', name: 'Plan.pdf', project: { path: STORE, name: 'Studio Upgrade' } }), 'Other AI apps delivered Plan.pdf to Studio Upgrade');
});

test('a file whole in one call lands in the project’s folder on this PC, shows as a card, and a name already there gets a new name', async () => {
  const t = setup();
  const a = await agent(t);
  const r = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Rollout plan.md', what: 'The rollout plan, store by store', content: '# Rollout plan\n\n- Week 1: Melbourne\n' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Saved Rollout plan\.md .* into Studio Upgrade’s folder\. Tell the person in one line: it’s in Studio Upgrade as Rollout plan\.md/);
  assert.equal(readFileSync(path.join(t.pcFolder, 'Rollout plan.md'), 'utf8'), '# Rollout plan\n\n- Week 1: Melbourne\n');
  // A name already there: never written over unless asked.
  const pdf = Buffer.from('%PDF-1.7 new closeout');
  const r2 = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Closeout report.pdf', what: '6-page closeout', base64: pdf.toString('base64') });
  assert.ok(!r2.isError, words(r2));
  assert.match(words(r2), /A file called Closeout report\.pdf was there already, so this one is Closeout report \(2\)\.pdf\./);
  assert.equal(readFileSync(path.join(t.pcFolder, 'Closeout report.pdf'), 'utf8'), 'an older closeout');
  assert.deepEqual(readFileSync(path.join(t.pcFolder, 'Closeout report (2).pdf')), pdf);
  const state = await t.access.state();
  const [card] = state.delivered;
  assert.equal(card.name, 'Closeout report (2).pdf');
  assert.equal(card.what, '6-page closeout');
  assert.equal(card.place, 'folder');
  assert.equal(card.path, 'Closeout report (2).pdf');
  assert.equal(card.project.name, 'Studio Upgrade');
  assert.equal(card.exists, true);
  assert.equal(card.seen, false);
  const line = state.activity.find((e) => e.tool === 'project_save_file');
  assert.equal(line.words, 'Saved “Closeout report (2).pdf” to Studio Upgrade.');
  assert.equal(line.file.name, 'Closeout report (2).pdf');
  assert.equal(line.canUndo, true);
  // Put away.
  await t.access.seenFile(card.id);
  assert.equal((await t.access.state()).delivered[0].seen, true);
  // Read can’t save; a folder inside the project’s folder is made.
  const reader = await agent(t, 'read');
  assert.match(words(await callAs(t.access, reader.who, 'project_save_file', { project: 'Studio Upgrade', name: 'x.txt', content: 'x' })), /Read only/);
  const r3 = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Till audit.csv', folder: 'Reports/2026', content: 'store,tills\nMelbourne,12\n' });
  assert.ok(!r3.isError, words(r3));
  assert.ok(existsSync(path.join(t.pcFolder, 'Reports', '2026', 'Till audit.csv')));
  assert.match(words(r3), /\(Reports\/2026\/Till audit\.csv\)/);
});

test('Full control may replace a file of the same name when it asks', async () => {
  const t = setup();
  const a = await agent(t, 'full');
  const r = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Closeout report.pdf', content: 'the new closeout', replace: true });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /It replaced the Closeout report\.pdf that was there/);
  assert.equal(readFileSync(path.join(t.pcFolder, 'Closeout report.pdf'), 'utf8'), 'the new closeout');
  const line = (await t.access.state()).activity[0];
  assert.equal(line.words, 'Replaced “Closeout report.pdf” to Studio Upgrade.');
  assert.equal(line.canUndo, false, 'a replaced file isn’t taken back (the old one is gone)');
});

test('a file over 1 MB in parts: begin, append (each call well under 1 MB), finish with its SHA-256; it carries on after a break', async () => {
  const t = setup();
  const a = await agent(t);
  const bytes = randomBytes(2_600_000);
  const begin = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Site photos.zip', what: 'Photos from the site walk', step: 'begin', size: bytes.length, sha256: sha(bytes) });
  assert.ok(!begin.isError, words(begin));
  const b = JSON.parse(words(begin));
  assert.equal(b.parts, Math.ceil(bytes.length / M.CHUNK_BYTES));
  assert.equal(b.part_bytes, M.CHUNK_BYTES);
  let i = 0;
  const parts = [];
  for (let at = 0; at < bytes.length; at += M.CHUNK_BYTES) parts.push(bytes.subarray(at, at + M.CHUNK_BYTES));
  for (const part of parts.slice(0, 2)) {
    const args = { upload_id: b.upload_id, step: 'append', index: i++, base64: part.toString('base64') };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'project_save_file', arguments: args } });
    assert.ok(Buffer.byteLength(body) < 1024 * 1024, `a part’s request is ${Buffer.byteLength(body)} bytes: under 1 MB`);
    const r = await callAs(t.access, a.who, 'project_save_file', args);
    assert.ok(!r.isError, words(r));
  }
  // A break: the same part again is fine; one out of order says which comes next; status says where it is.
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'append', index: 1, base64: parts[1].toString('base64') })), /already here/);
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'append', index: 4, base64: 'AAAA' })), /Part 2 comes next/);
  const status = JSON.parse(words(await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'status' })));
  assert.equal(status.next, 2);
  assert.equal(status.received, parts[0].length + parts[1].length);
  // Finishing early says what is missing.
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'finish', sha256: sha(bytes) })), /Only .* bytes have come/);
  // A fresh AgentAccess (Ironleaf restarted) carries on from what is kept.
  const again = new M.AgentAccess(t.host);
  again.load();
  for (const part of parts.slice(2)) {
    const r = await callAs(again, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'append', index: i++, base64: part.toString('base64') });
    assert.ok(!r.isError, words(r));
  }
  const done = await callAs(again, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'finish', sha256: sha(bytes) });
  assert.ok(!done.isError, words(done));
  assert.deepEqual(readFileSync(path.join(t.pcFolder, 'Site photos.zip')), bytes);
  assert.equal(readdirSync(path.join(t.dataDir, 'agent-uploads')).length, 0, 'nothing left part-way');
  assert.match(words(await callAs(again, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'status' })), /no upload with that id/);
});

test('a SHA-256 that doesn’t match: nothing saved, the upload gone; a size over 4 GB refused at the start', async () => {
  const t = setup();
  const a = await agent(t);
  const bytes = randomBytes(1_200_000);
  const b = JSON.parse(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Drawings.pdf', step: 'begin', size: bytes.length })));
  for (let at = 0, i = 0; at < bytes.length; at += M.CHUNK_BYTES, i++) await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'append', index: i, base64: bytes.subarray(at, at + M.CHUNK_BYTES).toString('base64') });
  const r = await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'finish', sha256: sha(Buffer.from('something else')) });
  assert.equal(r.isError, true);
  assert.match(words(r), /doesn’t match its SHA-256, so it wasn’t saved/);
  assert.ok(!existsSync(path.join(t.pcFolder, 'Drawings.pdf')));
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { upload_id: b.upload_id, step: 'status' })), /no upload with that id/);
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Huge.zip', step: 'begin', size: 5 * 1024 * 1024 * 1024 })), /at most 4 GB/);
  // One call with a SHA-256 that doesn't match.
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'x.pdf', base64: Buffer.from('abc').toString('base64'), sha256: sha(Buffer.from('abd')) })), /doesn’t match/);
});

test('no folder on this PC: the project’s own Files in Ironleaf; a remote computer’s project: kept in Ironleaf with a note', async () => {
  const t = setup();
  const a = await agent(t);
  const r = await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', name: 'Soup menu.pdf', what: 'The winter soups, one page', base64: Buffer.from('%PDF soups').toString('base64') });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /into Winter Menu Launch’s Files in Ironleaf \(Projects\/Winter Menu Launch\/Files\/Soup menu\.pdf\)/);
  assert.ok(existsSync(path.join(t.library, 'Projects', 'Winter Menu Launch', 'Files', 'Soup menu.pdf')));
  assert.ok(t.added.includes('Projects/Winter Menu Launch/Files/Soup menu.pdf'), 'indexed as the library’s file');
  const r2 = await callAs(t.access, a.who, 'project_save_file', { project: 'Harbour Lane', name: 'Closeout.pdf', base64: Buffer.from('%PDF harbour').toString('base64') });
  assert.ok(!r2.isError, words(r2));
  assert.match(words(r2), /Harbour Lane’s folder is on officebox, which Ironleaf reads but never changes, so the file is kept in Ironleaf with the project/);
  const card = (await t.access.state()).delivered[0];
  assert.equal(card.place, 'library');
  assert.equal(card.path, 'Projects/Harbour Lane/Files/Closeout.pdf');
  assert.equal(card.remoteName, 'officebox');
});

test('note_attach_file: beside the note’s attachments, linked in the note; Undo takes both back; Private notes refused; a copy from this PC', async () => {
  const t = setup();
  const a = await agent(t, 'edit');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const r = await callAs(t.access, a.who, 'note_attach_file', { note: 'Oven service', name: 'Oven plate.png', what: 'The service plate', base64: png.toString('base64') });
  assert.ok(!r.isError, words(r));
  assert.ok(existsSync(path.join(t.library, 'Attachments', 'Oven plate.png')));
  assert.match(t.files.get('Notes/Oven service.md'), /!\[\[Attachments\/Oven plate\.png\]\] — The service plate\n$/);
  const line = (await t.access.state()).activity[0];
  assert.match(await t.access.undo(line.id), /^Undone/);
  assert.ok(!existsSync(path.join(t.library, 'Attachments', 'Oven plate.png')));
  assert.equal(t.files.get('Notes/Oven service.md'), '# Oven service\n\nThe deck oven is serviced every March.\n');
  assert.match(words(await callAs(t.access, a.who, 'note_attach_file', { note: 'Private notes/Diary.md', name: 'x.txt', content: 'x' })), /Private notes/);
  // A copy from this PC (an agent on this PC), never from Ironleaf’s own data.
  const src = path.join(work, `copy-${n}.csv`);
  writeFileSync(src, 'a,b\n1,2\n');
  const c = await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', from: src, what: 'Numbers' });
  assert.ok(!c.isError, words(c));
  assert.ok(existsSync(src), 'the original stays where it is');
  assert.equal(readFileSync(path.join(t.pcFolder, path.basename(src)), 'utf8'), 'a,b\n1,2\n');
  mkdirSync(t.dataDir, { recursive: true });
  writeFileSync(path.join(t.dataDir, 'agents-copy.json'), '{}');
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', from: path.join(t.dataDir, 'agents-copy.json') })), /never copied/);
});

test('Undo of a saved file: to the Recycle Bin while it is as the agent left it, else left alone', async () => {
  const t = setup();
  const a = await agent(t);
  await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Draft.txt', content: 'draft' });
  const first = (await t.access.state()).activity[0];
  assert.match(await t.access.undo(first.id), /^Undone: saved “Draft\.txt” to Studio Upgrade/);
  assert.deepEqual(t.trashed, [path.join(t.pcFolder, 'Draft.txt')]);
  assert.ok(!existsSync(path.join(t.pcFolder, 'Draft.txt')));
  assert.equal((await t.access.state()).delivered.length, 0, 'an undone file is no longer a delivered card');
  await callAs(t.access, a.who, 'project_save_file', { project: 'Studio Upgrade', name: 'Draft.txt', content: 'draft' });
  const second = (await t.access.state()).activity[0];
  writeFileSync(path.join(t.pcFolder, 'Draft.txt'), 'changed by the person, and longer');
  assert.match(await t.access.undo(second.id), /changed since/);
  assert.equal(readFileSync(path.join(t.pcFolder, 'Draft.txt'), 'utf8'), 'changed by the person, and longer');
});

test('agents are told the rule in the tool: save what you make with project_save_file', () => {
  const tool = M.AGENT_TOOLS.find((x) => x.name === 'project_save_file');
  assert.equal(tool.level, 'edit', 'Edit can save files');
  assert.match(tool.description, /Always use this when you make anything for a project/);
  assert.equal(M.AGENT_TOOLS.find((x) => x.name === 'note_attach_file').level, 'edit');
});

// ── Files done properly (Wave 4 part c, 24 Oct 2026): an agent's file gets its record beside it (who sent it, how, its
//    note), a newer version keeps the one before, and a file on the PC can be linked where it is (nothing copied). ──

test('an agent’s file gets its record; new_version keeps the one before; reference links a file on the PC where it is', async () => {
  const t = setup();
  const vf = new M.VaultFiles({
    root: () => t.library,
    listAll: async () => [],
    notes: () => [],
    resolve: () => null,
    readNote: async () => '',
    movePath: async () => ({ path: '', linksUpdated: 0 }),
    added: async () => {},
    dataDir: t.dataDir,
    prefs: () => ({ attachmentsFolder: 'Attachments', filesWithRecord: true }),
  });
  Object.assign(t.host.files, {
    recorded: (rel, o) => vf.recordAdded(rel, { source: { by: o.by, how: o.how, ...(o.from ? { from: o.from } : {}), at: '2026-10-24T03:00:00.000Z' }, ...(o.record ? { record: o.record } : {}), ...(o.what ? { what: o.what } : {}) }),
    newVersion: async (rel, src, o) => (await vf.addVersion(rel, src, { source: { by: o.by, how: o.how, at: '2026-10-24T04:00:00.000Z' }, move: o.move })).version,
    reference: (record, abs, o) => vf.reference({ record, path: abs, by: o.by, ...(o.what ? { what: o.what } : {}) }),
  });
  const a = await agent(t);
  const first = words(await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', name: 'Menu.txt', what: 'The winter menu, first draft', content: 'Soup of the day\nPie\n' }));
  assert.match(first, /Saved Menu\.txt/);
  const side = () => JSON.parse(readFileSync(path.join(t.library, 'Projects/Winter Menu Launch/Files/.files.json'), 'utf8'));
  assert.equal(side().files['Menu.txt'].source.by, 'Other AI apps');
  assert.equal(side().files['Menu.txt'].source.how, 'agent');
  assert.equal(side().files['Menu.txt'].record, WINTER);
  assert.equal(side().files['Menu.txt'].summary, 'The winter menu, first draft');
  const second = words(await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', name: 'Menu.txt', content: 'Soup of the day\nPie\nScones\n', new_version: true }));
  assert.match(second, /version 2 of Menu\.txt: the one before is kept/);
  assert.equal(readFileSync(path.join(t.library, 'Projects/Winter Menu Launch/Files/Menu.txt'), 'utf8'), 'Soup of the day\nPie\nScones\n');
  assert.equal(readFileSync(path.join(t.library, 'Projects/Winter Menu Launch/Files/.versions/Menu (v1).txt'), 'utf8'), 'Soup of the day\nPie\n');
  assert.equal(side().files['Menu.txt'].version, 2);
  // A big file stays where it is on the PC: linked, never copied (an agent anywhere may link; nothing comes back to it).
  mkdirSync(path.join(work, 'elsewhere'), { recursive: true });
  const outside = path.join(work, 'elsewhere', 'Survey photos.zip');
  writeFileSync(outside, 'zip bytes');
  const linked = words(await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', reference: outside, what: 'Room photos (287 MB)' }));
  assert.match(linked, /Linked Survey photos\.zip to Winter Menu Launch where it is on the person’s PC/);
  assert.equal(existsSync(path.join(t.library, 'Projects/Winter Menu Launch/Files/Survey photos.zip')), false);
  // Where it is stays on this PC (src/main/vault-files.ts › LinkedRefs): the vault's file has the link's id only.
  assert.equal(side().files['Survey photos.zip'].ref.path, undefined);
  assert.equal(await vf.referencePath('Projects/Winter Menu Launch/Files', 'Survey photos.zip'), outside);
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', reference: path.join(t.dataDir, 'keys.json') })), /There is no file|settings folders/);
  assert.match(words(await callAs(t.access, a.who, 'project_save_file', { project: 'Winter Menu Launch', reference: 'Survey.zip' })), /whole path/);
});
