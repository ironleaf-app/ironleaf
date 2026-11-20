// node --test tests/portable-export.test.mjs — Export everything (31 Oct 2026: portable export to prove no lock-in):
// one zip saved where chosen, in a made-up vault in a temporary folder (never anyone's real vault). Notes exactly as
// on disk (folders kept), attachments and assets beside them, one CSV per record type (columns from the records'
// real fields, dates as ISO), a plain README, private notes/secrets/health left out by default and decrypted only
// when ticked, a cancelled export leaving no half file, and a project export holding only its own.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-portable-'));
let P, Z, H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (input, file) => {
    await build({ input: path.join(root, input), platform: 'node', output: { file: path.join(work, file), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, file)).href);
  };
  P = await one('src/main/portable-export.ts', 'portable.mjs');
  Z = await one('src/main/zip.ts', 'zip.mjs');
  H = await one('src/main/vault-home.ts', 'home.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const put = (abs, data) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};

/** A made-up vault: two projects, a meeting, a person, a bill, an attachment, an asset, private and own files. */
function fixture(dir) {
  put(path.join(dir, 'Projects', 'Riverside Pop-up', 'Riverside Pop-up.md'), '---\ntype: project\nstatus: active\nowner: Mia Tran\ndue: "2026-11-20"\n---\n# Riverside Pop-up\n\n## Summary\n\nA stall at the market.\n\n## What\'s next\n\n- [ ] Order cups — Mia · by 5 Nov 2026\n- [x] Book the stall — Mia\n');
  put(path.join(dir, 'Projects', 'Riverside Pop-up', 'Supplier list.md'), '# Supplier list\n\n- [ ] Ask the mill about flour · by 2026-11-06\n');
  put(path.join(dir, 'Projects', 'Harbour Fit-out', 'Harbour Fit-out.md'), '---\ntype: project\nstatus: planning\nowner: Tom Nguyen\n---\n# Harbour Fit-out\n\n## Summary\n\nThe new office.\n');
  put(path.join(dir, 'Meetings', 'Supplier call.md'), '---\ntype: meeting\ndate: 2026-10-30\ntime: "14:00"\nattendees: [Mia Tran]\n---\n# Supplier call\n\nPrices for flour.\n');
  put(path.join(dir, 'People', 'Priya Shah.md'), '---\ntype: person\nrole: Area coordinator\norg: Cafe Group\nemail: priya@example.com\n---\n# Priya Shah\n\nRuns the stores.\n');
  put(path.join(dir, 'Me', 'Finance', 'Bills', 'Power bill.md'), '---\ntype: bill\namount: 182.4\ncycle: Monthly\ndue: "2026-11-12"\naccount: Everyday\n---\n# Power bill\n');
  put(path.join(dir, 'Attachments', 'bench.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]));
  put(path.join(dir, 'Assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  put(path.join(dir, 'Private notes', 'abc123.nvlock'), 'sealed-bytes');
  put(path.join(dir, 'Private notes', 'xyz.nvsecret'), 'sealed-bytes');
  put(path.join(dir, '.neuralvault', 'vault.json'), '{"id":"x"}');
  put(path.join(dir, '.git', 'config'), '[core]');
}

const T = new Date(2026, 9, 31, 9, 0).getTime();
const notesOf = () => [
  { path: 'Projects/Riverside Pop-up/Riverside Pop-up.md', title: 'Riverside Pop-up', props: { type: 'project', status: 'active', owner: 'Mia Tran', due: '2026-11-20' }, mtime: T },
  { path: 'Projects/Riverside Pop-up/Supplier list.md', title: 'Supplier list', props: {}, mtime: T },
  { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', title: 'Harbour Fit-out', props: { type: 'project', status: 'planning', owner: 'Tom Nguyen' }, mtime: T },
  { path: 'Meetings/Supplier call.md', title: 'Supplier call', props: { type: 'meeting', date: '2026-10-30', time: '14:00', attendees: ['Mia Tran'] }, mtime: T },
  { path: 'People/Priya Shah.md', title: 'Priya Shah', props: { type: 'person', role: 'Area coordinator', org: 'Cafe Group', email: 'priya@example.com' }, mtime: T },
  { path: 'Me/Finance/Bills/Power bill.md', title: 'Power bill', props: { type: 'bill', amount: 182.4, cycle: 'Monthly', due: '2026-11-12', account: 'Everyday' }, mtime: T },
];
const projectsOf = () => [
  { path: 'Projects/Riverside Pop-up/Riverside Pop-up.md', name: 'Riverside Pop-up', status: 'active', owner: 'Mia Tran', due: '2026-11-20', tags: [] },
  { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out', status: 'planning', owner: 'Tom Nguyen', tags: [] },
];
const tasksOf = () => [
  { words: 'Order cups', done: false, due: '2026-11-05', time: null, projectName: 'Riverside Pop-up', path: 'Projects/Riverside Pop-up/Riverside Pop-up.md', title: 'Riverside Pop-up', line: 10, tags: [], reminder: false, repeats: false },
  { words: 'Book the stall', done: true, due: null, time: null, projectName: 'Riverside Pop-up', path: 'Projects/Riverside Pop-up/Riverside Pop-up.md', title: 'Riverside Pop-up', line: 11, tags: [], reminder: false, repeats: false },
  { words: 'Ask the mill about flour', done: false, due: '2026-11-06', time: null, projectName: 'Riverside Pop-up', path: 'Projects/Riverside Pop-up/Supplier list.md', title: 'Supplier list', line: 2, tags: [], reminder: false, repeats: false },
];
const billType = () => [{ id: 'bill', name: 'Bill', plural: 'Bills', fields: [{ key: 'amount' }, { key: 'cycle' }, { key: 'due' }, { key: 'account' }] }];

async function names(zip) {
  return (await Z.zipItems(zip)).map((i) => i.name).sort();
}

async function textOf(zip, name) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-portable-read-'));
  try {
    await Z.extractZip(zip, dir, {});
    return readFileSync(path.join(dir, name), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the zip holds notes exactly as on disk, attachments beside them, CSVs from real fields, and a plain README', async () => {
  const vault = path.join(work, 'vault');
  fixture(vault);
  const { files } = await H.vaultFiles(vault);
  const dest = path.join(work, 'everything.zip');
  const seen = [];
  const done = await P.exportPortable({ root: vault, dest, vaultName: 'Vault', day: '2026-10-31', includePrivate: false, files, notes: notesOf(), projects: projectsOf(), tasks: tasksOf(), moduleTypes: billType(), onProgress: (p) => seen.push(p) });
  assert.equal(done.file, dest);
  assert.ok(done.files > 10 && done.bytes > 0);
  assert.match(done.words, /saved in one file/);

  const all = await names(dest);
  for (const rel of ['Projects/Riverside Pop-up/Riverside Pop-up.md', 'Projects/Riverside Pop-up/Supplier list.md', 'Projects/Harbour Fit-out/Harbour Fit-out.md', 'Meetings/Supplier call.md', 'People/Priya Shah.md', 'Me/Finance/Bills/Power bill.md', 'Attachments/bench.png', 'Assets/logo.svg', 'README.md', 'tables/projects.csv', 'tables/tasks.csv', 'tables/meetings.csv', 'tables/people.csv', 'tables/bills.csv']) assert.ok(all.includes(rel), `${rel} is in the zip`);
  assert.ok(!all.some((n) => n.startsWith('Private notes/') || n.endsWith('.nvlock') || n.endsWith('.nvsecret') || n.startsWith('.neuralvault/') || n.startsWith('.git/')), 'nothing secret, own or Git history');

  // Notes byte for byte as on disk (folders kept), attachments beside them.
  const out = path.join(work, 'out');
  rmSync(out, { recursive: true, force: true });
  await Z.extractZip(dest, out, {});
  for (const rel of ['Projects/Riverside Pop-up/Riverside Pop-up.md', 'Attachments/bench.png', 'Assets/logo.svg']) assert.deepEqual(readFileSync(path.join(out, rel)), readFileSync(path.join(vault, rel)), `${rel} exactly as on disk`);

  // Tables: columns from the records' real fields, dates as ISO, Excel's mark and line ends.
  const projects = await textOf(dest, 'tables/projects.csv');
  assert.ok(projects.startsWith('﻿') && projects.includes('\r\n'));
  assert.ok(projects.split('\r\n')[0].includes('Name,Status') && projects.includes('Riverside Pop-up,active') && projects.includes('2026-11-20'));
  const tasks = await textOf(dest, 'tables/tasks.csv');
  assert.ok(tasks.includes('Order cups,No,2026-11-05') && tasks.includes('Book the stall,Yes'));
  const bills = await textOf(dest, 'tables/bills.csv');
  const head = bills.slice(1).split('\r\n')[0];
  assert.ok(head.includes('Amount') && head.includes('Due') && head.includes('Account'), `bill fields head the table: ${head}`);
  assert.ok(bills.includes('182.4') && bills.includes('2026-11-12'));
  const meetings = await textOf(dest, 'tables/meetings.csv');
  assert.ok(meetings.includes('2026-10-30') && meetings.includes('Mia Tran'));

  // The README says what each part is and how to open it elsewhere, in plain words (no em dashes).
  const readme = await textOf(dest, 'README.md');
  assert.ok(readme.includes('Markdown') && readme.includes('another notes app') && readme.includes('CSV') && readme.includes('Excel'));
  assert.ok(readme.includes('Not in here') && readme.includes('Include my private notes'));
  assert.ok(!readme.includes('—'), 'no em dashes in words a person reads');
  assert.ok(seen.some((p) => p.phase === 'packing' && p.total > 0), 'progress as it packed');
});

test('private notes, secrets and health stay out by default; ticked, they go in decrypted with a warning', async () => {
  const vault = path.join(work, 'vault');
  const { files } = await H.vaultFiles(vault);
  const plain = path.join(work, 'plain.zip');
  await P.exportPortable({ root: vault, dest: plain, vaultName: 'Vault', day: '2026-10-31', includePrivate: false, files, notes: notesOf(), projects: projectsOf(), tasks: tasksOf(), moduleTypes: billType() });
  const plainNames = await names(plain);
  assert.ok(!plainNames.some((n) => n.startsWith('Private notes/') || n === 'tables/secrets.csv' || n.includes('Health')), 'left out unless ticked');

  const full = path.join(work, 'full.zip');
  await P.exportPortable({
    root: vault, dest: full, vaultName: 'Vault', day: '2026-10-31', includePrivate: true, files, notes: notesOf(), projects: projectsOf(), tasks: tasksOf(), moduleTypes: billType(),
    privateNotes: [{ path: 'Private notes/Diary.md', text: '# Diary\n\nMade-up words.\n', modified: T }],
    secrets: [{ name: 'Made-up wifi', kind: 'other', value: 'made-up-value-123', created: T, modified: T }],
    health: { measures: [], entries: [{ measure: 'Steps', day: '2026-10-30', value: 8000 }], notes: [], sessions: [], plans: [], exercises: [], meals: [], appointments: [] },
  });
  const fullNames = await names(full);
  assert.ok(fullNames.includes('Private notes/Diary.md'), 'private notes decrypted as Markdown');
  assert.ok(fullNames.includes('tables/secrets.csv'), 'secrets listed');
  assert.ok(fullNames.some((n) => n.includes('health')), 'health tables');
  assert.ok(!fullNames.some((n) => n.endsWith('.nvlock') || n.endsWith('.nvsecret')), 'never the sealed files');
  assert.equal(await textOf(full, 'Private notes/Diary.md'), '# Diary\n\nMade-up words.\n');
  assert.ok((await textOf(full, 'tables/secrets.csv')).includes('made-up-value-123'), 'decrypted, as warned');
  const readme = await textOf(full, 'README.md');
  assert.ok(readme.includes('readable by anyone') && readme.includes('Keep it somewhere safe'));
});

test('a cancelled export leaves no half file', async () => {
  const vault = path.join(work, 'big');
  for (let i = 0; i < 60; i++) put(path.join(vault, 'Notes', `Note ${i}.md`), `# Note ${i}\n\nMade-up words ${i}.\n`);
  const { files } = await H.vaultFiles(vault);
  const notes = files.filter((f) => f.rel.endsWith('.md')).map((f) => ({ path: f.rel, title: f.rel, props: {}, mtime: T }));
  const dest = path.join(work, 'cancelled.zip');
  let calls = 0;
  await assert.rejects(
    () => P.exportPortable({ root: vault, dest, vaultName: 'Vault', day: '2026-10-31', includePrivate: false, files, notes, projects: [], tasks: [], moduleTypes: [], shouldCancel: () => ++calls > 3 }),
    /Export cancelled/,
  );
  assert.equal(existsSync(dest), false, 'no half file at the destination');
  assert.deepEqual(readdirSync(work).filter((n) => n.startsWith('cancelled.zip.')), [], 'no temporary file left beside it');
});

test('a project export holds only its own note, folder, files and tables', async () => {
  const vault = path.join(work, 'vault');
  const { files } = await H.vaultFiles(vault);
  const dest = path.join(work, 'project.zip');
  await P.exportPortable({ root: vault, dest, vaultName: 'Vault', day: '2026-10-31', includePrivate: true, files, notes: notesOf(), projects: projectsOf(), tasks: tasksOf(), moduleTypes: billType(), project: { path: 'Projects/Riverside Pop-up/Riverside Pop-up.md', name: 'Riverside Pop-up' }, secrets: [{ name: 'Made-up wifi', kind: 'other', value: 'made-up-value-123', created: T, modified: T }] });
  const all = await names(dest);
  assert.ok(all.includes('Projects/Riverside Pop-up/Riverside Pop-up.md') && all.includes('Projects/Riverside Pop-up/Supplier list.md'));
  assert.ok(!all.includes('Projects/Harbour Fit-out/Harbour Fit-out.md') && !all.includes('Meetings/Supplier call.md'), 'only the project’s own');
  assert.ok(!all.includes('tables/secrets.csv'), 'a project never takes secrets with it');
  const projects = await textOf(dest, 'tables/projects.csv');
  assert.ok(projects.includes('Riverside Pop-up') && !projects.includes('Harbour Fit-out'));
  const tasks = await textOf(dest, 'tables/tasks.csv');
  assert.ok(tasks.includes('Order cups'));
  assert.ok((await textOf(dest, 'README.md')).includes('Riverside Pop-up'));
});
