// node --test tests/remote-projects.test.mjs — a project whose folder is on a remote computer the former host app
// connects to (4.9.5). and was told, twice, that /home/fileserver-01/MarketingMachine "hasn't been authorised in this
// chat. Please add or type that folder path". Now the project is the permission: its folder is read through the former
// host app (here a stand-in for its remoteFolder), Catch up sees what changed since the project's last update and
// proposes the changes, a path the model saw is read as the project's, and a computer that is off is said plainly.
// src/shared/project-folder.ts, src/main/project-folders.ts, src/main/agent.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-remote-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
      `export { parseProject, serializeProject, emptyProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/project-folder.ts'))};`,
      `export { ProjectFolders, RemoteFolders, FolderProblem } from ${JSON.stringify(path.join(root, 'src/main/project-folders.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const DAY = 86400000;
const NOW = Date.parse('2026-10-17T10:00:00Z');
const PROJECT = `---
type: project
status: active
health: on track
progress: 40
updated: 2026-10-12
neuralspark-project: "remote:${ID}:/home/fileserver-01/MarketingMachine"
---
# fileserver-01 · MarketingMachine

## Summary
On fileserver-01, in \`/home/fileserver-01/MarketingMachine\`. The host app works on fileserver-01 · MarketingMachine here.
`;
const REL = 'Projects/fileserver-01 · MarketingMachine/fileserver-01 · MarketingMachine.md';

/** A stand-in for the former host app's remoteFolder: the folder as the former host app's route answers, or a computer
that is off. */
function standIn({ off = false } = {}) {
  const asked = [];
  const files = [
    { path: 'README.md', name: 'README.md', kind: 'file', size: 812, modified: NOW - 2 * DAY },
    { path: 'campaigns', name: 'campaigns', kind: 'folder', modified: NOW - DAY },
    { path: 'campaigns/spring-launch.md', name: 'spring-launch.md', kind: 'file', size: 2310, modified: NOW - DAY },
    { path: 'campaigns/old-plan.md', name: 'old-plan.md', kind: 'file', size: 1200, modified: NOW - 30 * DAY },
    { path: 'Reports', name: 'Reports', kind: 'folder', modified: NOW - 3 * DAY },
    { path: 'Reports/Status.docx', name: 'Status.docx', kind: 'file', size: 40210, modified: NOW - 3 * DAY },
  ];
  const ask = async (r) => {
    asked.push(r);
    if (off) throw Object.assign(new Error('fileserver-01 isn’t connected in the host app right now.'), { kind: 'offline' });
    assert.equal(r.computer, ID);
    assert.equal(r.root, '/home/fileserver-01/MarketingMachine');
    const computer = { id: ID, name: 'fileserver-01', os: 'Linux' };
    if (r.op === 'list') {
      const inside = r.path || '';
      const depth = r.depth ?? 1;
      const entries = files.filter((f) => (inside ? f.path.startsWith(`${inside}/`) : true) && f.path.slice(inside ? inside.length + 1 : 0).split('/').length <= depth);
      return { computer, root: r.root, path: inside, entries, truncated: false };
    }
    if (r.op === 'changed') return { computer, root: r.root, files: files.filter((f) => f.kind === 'file' && f.modified > r.since).sort((a, b) => b.modified - a.modified), more: 0, truncated: false };
    if (r.op === 'find') return { computer, root: r.root, entries: files.filter((f) => f.path.toLowerCase().includes(r.query)), more: 0 };
    if (r.op === 'read') {
      if (r.path === 'Reports/Status.docx') return { computer, root: r.root, file: { path: r.path, name: 'Status.docx', size: 40210, modified: NOW - 3 * DAY }, kind: 'document', text: '# Status\nLaunch moved to 3 November. Budget approved.' };
      if (r.path === 'campaigns/spring-launch.md') return { computer, root: r.root, file: { path: r.path, name: 'spring-launch.md', size: 2310, modified: NOW - DAY }, kind: 'text', text: '# Spring launch\nNew landing page live; email sequence drafted.' };
      throw Object.assign(new Error(`There is no ${r.path} in MarketingMachine on fileserver-01.`), { kind: 'missing' });
    }
    if (r.op === 'bytes') return { computer, root: r.root, file: { path: r.path }, base64: Buffer.from('png').toString('base64') };
    throw new Error('unexpected ' + r.op);
  };
  return { ask, asked };
}

function fakeHost(notes, ask) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  for (const [rel, text] of files) index.set(rel, text, NOW, text.length);
  const access = new M.ProjectFolders(new M.RemoteFolders(ask), async () => {
    throw new Error('not on this PC');
  });
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: ['Projects'] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => files.get(rel),
    write: async (rel, text) => {
      files.set(rel, text);
      index.set(rel, text, NOW, text.length);
    },
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Saturday 17 October 2026 (2026-10-17)',
    folders: { access, projects: () => [...files].filter(([, t]) => /type: project/.test(t)).map(([rel, t]) => ({ path: rel, project: M.parseProject(t, rel) })) },
  };
  return { host, files };
}
const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

test('where a project’s files are', () => {
  const p = M.parseProject(PROJECT, REL);
  const w = M.projectWhere(p);
  assert.deepEqual(w, { kind: 'remote', computer: ID, path: '/home/fileserver-01/MarketingMachine', computerName: 'fileserver-01', folderName: 'MarketingMachine' });
  assert.equal(M.folderHandle(p), `remote:${ID}:/home/fileserver-01/MarketingMachine`);
  assert.ok(M.isRemoteHandle(M.folderHandle(p)) && !M.isRemoteHandle('C:\\Work\\Site'));
  assert.deepEqual(M.projectWhere({ ...p, folder: 'C:\\Work\\Site' }), { kind: 'local', folder: 'C:\\Work\\Site' }, 'a folder on this PC wins');
  assert.equal(M.parseRemoteKey(`remote:${ID}:C:/Users/pat/app`).path, '/C:/Users/pat/app', 'a Windows computer’s folder as the host app names it');
  assert.equal(M.parseRemoteKey(`remote:${ID}:~`).path, '~');
  assert.equal(M.parseRemoteKey('remote:not-an-id:/x'), null);
  assert.equal(M.parseRemoteKey(`local:c:/work`), null);
  assert.equal(M.computerNameOf({ name: 'Website', summary: 'On build-box, in `/srv/site`. The host app works…' }), 'build-box', 'from the summary when the name doesn’t say');
  assert.equal(M.remoteProblem('offline', 'fileserver-01').words, 'fileserver-01 isn’t connected right now.');
});

test('the Files panel lists the remote folder, grouped as a local one is; a computer that is off is a calm line', async () => {
  const { ask, asked } = standIn();
  const folders = new M.ProjectFolders(new M.RemoteFolders(ask), async () => ({}));
  const w = M.projectWhere(M.parseProject(PROJECT, REL));
  const files = await folders.files(w);
  assert.equal(files.exists, true);
  assert.equal(files.total, 4, 'its files, four folders deep');
  assert.deepEqual(files.groups.map((g) => g.name), ['', 'campaigns', 'Reports'], 'the folder’s own files first, then folders by their newest file');
  assert.deepEqual(files.remote, { computer: ID, name: 'fileserver-01', path: '/home/fileserver-01/MarketingMachine', os: 'Linux' });
  assert.equal(files.folder, `remote:${ID}:/home/fileserver-01/MarketingMachine`);
  assert.equal(asked[0].op, 'list');
  assert.equal(asked[0].depth, 4);
  await folders.files(w);
  assert.equal(asked.length, 1, 'a second look within moments uses what was just read');
  await folders.files(w, { fresh: true });
  assert.equal(asked.length, 2, 'Refresh asks again');
  const off = new M.ProjectFolders(new M.RemoteFolders(standIn({ off: true }).ask), async () => ({}));
  const down = await off.files(w);
  assert.equal(down.exists, false);
  assert.equal(down.problem.kind, 'offline');
  assert.equal(down.problem.words, 'fileserver-01 isn’t connected right now.');
  const alone = await new M.ProjectFolders(new M.RemoteFolders(undefined), async () => ({})).files(w);
  assert.equal(alone.problem.kind, 'standalone', 'Ironleaf on its own says where the files are and how to reach them');
  assert.match(alone.problem.words, /another computer/);
  assert.match(alone.problem.hint, /Open the project’s folder on that computer/);
  assert.doesNotMatch(`${alone.problem.words} ${alone.problem.hint}`, /from NeuralSpark to see them/);
});

test('a local listing skips machine files and junk folders like the walker does (9.5 fourth pass)', async () => {
  const dir = path.join(work, 'local-list');
  mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'pkg', 'lib.js'), 'x');
  writeFileSync(path.join(dir, 'app.log'), 'x');
  writeFileSync(path.join(dir, 'plan.md'), 'x');
  const folders = new M.ProjectFolders(new M.RemoteFolders(undefined), async () => ({}));
  const { entries } = await folders.list({ kind: 'local', folder: dir }, '', 4);
  assert.deepEqual(entries.map((e) => e.path), ['plan.md']);
});

test('changed past its limit says truncated, like more says (9.5 fourth pass)', async () => {
  const dir = path.join(work, 'changed-list');
  mkdirSync(dir, { recursive: true });
  for (const n of ['a.md', 'b.md', 'c.md']) writeFileSync(path.join(dir, n), 'x');
  const folders = new M.ProjectFolders(new M.RemoteFolders(undefined), async () => ({}));
  const r = await folders.changed({ kind: 'local', folder: dir }, 0, 2);
  assert.equal(r.files.length, 2);
  assert.equal(r.more, 1);
  assert.equal(r.truncated, true);
});

test('a remote file read says nothing about when it was made (9.5 fourth pass)', async () => {
  const { ask } = standIn();
  const folders = new M.ProjectFolders(new M.RemoteFolders(ask), async () => ({}));
  const w = M.projectWhere(M.parseProject(PROJECT, REL));
  const f = await folders.read('Projects/X.md', w, 'campaigns/spring-launch.md');
  assert.equal(f.modified, NOW - DAY);
  assert.equal(f.created, undefined, 'birth time unknown: omitted, never copied from modified');
});

test('forgetting clears one folder’s memory, never another’s with a tricky name (9.5 fourth pass)', async () => {
  let asked = 0;
  const ask = async (r) => {
    asked++;
    return { computer: {}, root: r.root, entries: [], truncated: false };
  };
  const remote = new M.RemoteFolders(ask);
  const w1 = { computer: 'a', path: 'x', computerName: 'a', folderName: 'x' };
  const w2 = { computer: 'a","x', path: 'y', computerName: 'b', folderName: 'y' };
  await remote.call(w1, 'list', {}, 60_000);
  await remote.call(w2, 'list', {}, 60_000);
  assert.equal(asked, 2);
  remote.forget(w1);
  await remote.call(w1, 'list', {}, 60_000);
  await remote.call(w2, 'list', {}, 60_000);
  assert.equal(asked, 3, 'w1 asked again, w2 still remembered');
});

test('Catch up on a remote project: what changed since its last update, read, proposed — never “add or type the folder path”', async () => {
  const { ask } = standIn();
  const { host, files } = fakeHost({ [REL]: PROJECT }, ask);
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s), REL);
  // The model's first try in the chat: the path from the open note, with the PC folder tool.
  const listed = await run(tools, 'list_pc_folder', { path: '/home/fileserver-01/MarketingMachine' });
  assert.equal(listed.isError, undefined, listed.text);
  assert.match(listed.text, /MarketingMachine on fileserver-01/);
  assert.match(listed.text, /README\.md \(Markdown, 812 B, changed 2026-10-15\)/);
  assert.doesNotMatch(listed.text, /authoris|add or type/i);
  assert.ok(listed.text.indexOf('campaigns/') < listed.text.indexOf('README.md'), 'folders first, as a folder window shows them');
  const changed = await run(tools, 'project_changes', {});
  assert.match(changed.text, /3 files changed since 2026-10-12 \(its last update\)/, changed.text);
  assert.ok(changed.text.indexOf('spring-launch.md') < changed.text.indexOf('README.md'), 'newest first');
  assert.doesNotMatch(changed.text, /old-plan/);
  const doc = await run(tools, 'read_project_file', { project: 'fileserver-01 · MarketingMachine', path: 'Reports/Status.docx' });
  assert.match(doc.text, /Launch moved to 3 November/);
  const seen = await run(tools, 'read_pc_file', { path: '/home/fileserver-01/MarketingMachine/campaigns/spring-launch.md' });
  assert.match(seen.text, /New landing page live/, 'a full path the model saw is read as the project’s file');
  const proposed = await run(tools, 'save_project', { name: 'fileserver-01 · MarketingMachine', folder: '/home/fileserver-01/MarketingMachine', summary: 'The spring campaign site on fileserver-01: the landing page is live and the launch moved to 3 November.', mode: 'propose', updates: [{ date: '2026-10-16', what: 'Landing page live; email sequence drafted', from: 'campaigns/spring-launch.md' }], next: [{ what: 'Send the email sequence for review', who: 'Jesse', when: '2026-10-24' }] });
  assert.match(proposed.text, /^Proposed to the person/, proposed.text);
  assert.equal(tools.proposals.length, 1);
  const p = tools.proposals[0];
  assert.equal(p.path, REL, 'the remote project’s own file, not a second project');
  assert.ok(p.changes.includes('1 next step added') && p.changes.includes('1 update added') && p.changes.includes('Summary rewritten'), p.changes.join('; '));
  const after = M.parseProject(p.after, REL);
  assert.equal(after.key, `remote:${ID}:/home/fileserver-01/MarketingMachine`, 'its key is kept');
  assert.equal(after.folder, undefined, 'and it never gets a folder on this PC');
  assert.equal(files.get(REL), PROJECT, 'nothing is written until the person accepts');
  // The chat shows what changed as a tidy list beside the answer.
  const cards = tools.cards();
  assert.deepEqual(cards.map((c) => c.kind), ['changed'], 'catching up shows what changed (the listing was a step on the way)');
  const card = cards.find((c) => c.kind === 'changed');
  assert.equal(card.title, 'Changed since 12 Oct 2026');
  assert.equal(card.place, 'On fileserver-01 · /home/fileserver-01/MarketingMachine');
  assert.equal(card.computerName, 'fileserver-01');
  assert.deepEqual(card.entries.map((e) => e.path), ['campaigns/spring-launch.md', 'README.md', 'Reports/Status.docx']);
  assert.ok(card.entries.every((e) => e.kind === 'file' && e.size > 0 && e.modified > 0));
  assert.ok(steps.some((s) => s.words === 'Looked at what changed in MarketingMachine on fileserver-01 since 12 Oct 2026'));
});

test('the assistant is told where the open project’s folder is, and that it needs no path from the person', async () => {
  const sys = M.agentSystem('GPT-5.6 Luna', 'today', 'fileserver-01 · MarketingMachine', [], 'The open note is the project file of “fileserver-01 · MarketingMachine”: its files are in its folder /home/fileserver-01/MarketingMachine on fileserver-01.');
  assert.match(sys, /its folder \/home\/fileserver-01\/MarketingMachine on fileserver-01/);
  assert.match(sys, /Never ask the person to type, add or authorise a project’s folder/);
  assert.match(sys, /project_changes gives the files in its folder changed since the project was last updated/);
});

test('a computer that is off is said plainly, and outside agents read remote files the same way', async () => {
  const { host } = fakeHost({ [REL]: PROJECT }, standIn({ off: true }).ask);
  const tools = new M.AgentTools(host, [], () => {}, REL);
  const r = await run(tools, 'project_changes', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /^fileserver-01 isn’t connected right now\./);
  assert.doesNotMatch(r.text, /authoris|type that folder/i);
  // No project open, none named: it asks which, naming them.
  const which = await run(new M.AgentTools(host, [], () => {}), 'list_project_folder', {});
  assert.match(which.text, /Say which project\. The projects: fileserver-01 · MarketingMachine/);
  // Search: remote files are found by their names.
  const on = fakeHost({ [REL]: PROJECT }, standIn().ask);
  on.host.projectFiles = { search: () => [], read: async () => ({}), projects: () => [{ path: REL, name: 'fileserver-01 · MarketingMachine' }], status: () => ({ on: true, busy: false, done: 0, todo: 0 }) };
  const found = await run(new M.AgentTools(on.host, [], () => {}), 'search_project_files', { query: 'status' });
  assert.match(found.text, /fileserver-01 · MarketingMachine · Reports\/Status\.docx .* found by its name/, found.text);
  assert.match(found.text, /link: \[Status\.docx\]\(nv-file:/);
});
