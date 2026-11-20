// node --test tests/sensitivity.test.mjs — Secrets and sensitivity levels (Wave 4, 24 Oct 2026; src/shared/sensitivity.ts,
// src/shared/secret-scan.ts, src/main/sensitivity.ts, src/main/secrets.ts, src/main/agent-gate.ts, src/main/sensitive.ts).
// On a made-up household vault (neutral fixtures: a fit-out at work, a knee rehab, a school pickup, a CV, a beach photo):
// where a level comes from; who may read what; the scanner's precision on a planted set (and silence on a clean one) with
// nothing found ever leaving unmasked; Secrets sealed and opened again, refused with the wrong passphrase, masked, copied
// and cleared; every agent path (search, read, lists, projects, Today, the timeline, meetings, the connected vault's
// records, links both ways, related notes, retrieval, writes) refusing what an agent isn't allowed; the audit trail and
// its export; a Family-private photo refused to other AI apps; the scanner's move with Undo; Private notes moved into levels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-sensitive-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as S from ${src('src/shared/sensitivity.ts')};`,
      `export * as X from ${src('src/shared/secret-scan.ts')};`,
      `export { Sensitivity } from ${src('src/main/sensitivity.ts')};`,
      `export { SecretsStore } from ${src('src/main/secrets.ts')};`,
      `export { PrivateNotes } from ${src('src/main/private-notes.ts')};`,
      `export { SensitiveWork } from ${src('src/main/sensitive.ts')};`,
      `export { makeGate, gateIndex, gateNotes, gateAccessHost } from ${src('src/main/agent-gate.ts')};`,
      `export { AgentAccess } from ${src('src/main/agent-access.ts')};`,
      `export { AgentTools } from ${src('src/main/agent.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject } from ${src('src/shared/project-file.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'sensitive.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'sensitive.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Fake keys are made here, not stored in the fixture: a key-shaped string in the repository is reported by every secret
// scanner (and by GitHub's) as a leak, whether it is real or not. Same shape as the real thing, made-up characters.
const fakeChars = (n, seed) => Array.from({ length: n }, (_, i) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[(i * 7 + seed) % 57]).join('');
const FAKES = { '{{FAKE_OPENAI_KEY}}': 'sk-' + 'proj-' + fakeChars(40, 3), '{{FAKE_BOT_TOKEN}}': '1234567890:' + 'AA' + fakeChars(33, 11) };
const fixture = (name) =>
  readFileSync(path.join(root, 'tests', 'fixtures', 'secrets', name), 'utf8').replace(/\{\{FAKE_[A-Z_]+\}\}/g, (k) => FAKES[k] ?? k);

// ── The rules ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('where a level comes from: the note’s own, a file’s entry, its type, its area, its folder, else Open', () => {
  const st = M.S.parseSensitivity({ folders: { Health: 'Health', 'Work/Clients': 'work-confidential', Family: 'family private' }, types: { 'health-checkin': 'health' }, items: { 'Family/Photos/beach.jpg': 'family' }, access: {}, photos: 'ask' });
  assert.deepEqual(st.folders, { Health: 'health', 'Work/Clients': 'work', Family: 'family' }, 'labels as people write them are read');
  assert.deepEqual(M.S.levelOf(st, 'Health/Knee rehab.md'), { level: 'health', from: 'folder', folder: 'Health' });
  assert.deepEqual(M.S.levelOf(st, 'Health/Knee rehab.md', 'open'), { level: 'open', from: 'note' }, 'the note’s own wins');
  assert.equal(M.S.levelOf(st, 'Work/Clients/Acme/Quote.md').level, 'work', 'the nearest folder with a default');
  assert.equal(M.S.levelOf(st, 'Work/Notes.md').level, 'open');
  assert.deepEqual(M.S.levelOf(st, 'Family/Photos/beach.jpg'), { level: 'family', from: 'file' });
  assert.deepEqual(M.S.levelOf(st, 'Daily/2026-10-24.md', undefined, 'health-checkin'), { level: 'health', from: 'type' });
  assert.equal(M.S.levelOf(st, 'Daily/2026-10-24.md', undefined, undefined, 'Health').level, 'health', 'a note that says its area');
  assert.deepEqual(M.S.levelOf(st, 'Notes/Oven.md'), { level: 'open', from: 'none' });
  assert.equal(M.S.frontLevel('---\ntitle: x\nsensitivity: Work-confidential\n---\nbody'), 'work');
  assert.equal(M.S.frontLevel('no front matter'), null);
  // Written back steadily: the same store, the same bytes.
  assert.equal(M.S.writeSensitivity(M.S.parseSensitivity(M.S.writeSensitivity(st))), M.S.writeSensitivity(st));
  assert.deepEqual(M.S.parseSensitivity('not json'), M.S.emptyStore());
});

test('who may read what: groups, rows of their own, defaults, Open always; photos asked for each use', () => {
  const st = M.S.emptyStore();
  assert.deepEqual(M.S.accessOf(st, 'side-chat'), ['open', 'work', 'personal']);
  assert.deepEqual(M.S.accessOf(st, 'neuralbot'), ['open', 'work']);
  assert.deepEqual(M.S.accessOf(st, 'bot:coach'), ['open', 'work'], 'a bot follows the chat bots row');
  assert.deepEqual(M.S.accessOf(st, 'agent:abc'), ['open', 'work'], 'an outside agent follows Outside agents');
  st.access['bot:coach'] = ['health'];
  assert.deepEqual(M.S.accessOf(st, 'bot:coach'), ['open', 'health'], 'its own row; Open always');
  st.access.agents = ['open'];
  assert.deepEqual(M.S.accessOf(st, 'agent:abc'), ['open']);
  st.access['agent:chief'] = ['open', 'work', 'personal'];
  assert.equal(M.S.allows(st, 'agent:chief', 'personal'), true);
  assert.equal(M.S.allows(st, 'agent:chief', 'family'), false);
  const refused = M.S.decide(st, 'agent:chief', 'Health/Plan.md', 'health', 'Chief');
  assert.equal(refused.ok, false);
  assert.match(refused.why, /marked Health and Chief isn’t allowed Health/);
  st.access['agent:chief'] = ['open', 'family'];
  assert.deepEqual(M.S.decide(st, 'agent:chief', 'Family/School pickup.md', 'family', 'Chief'), { ok: true, level: 'family' });
  const photo = M.S.decide(st, 'agent:chief', 'Family/Photos/beach.jpg', 'family', 'Chief');
  assert.equal(photo.ok, false);
  assert.equal(photo.consent, true, 'a Family-private photo needs the person’s OK each time');
  st.photos = 'never';
  assert.equal(M.S.decide(st, 'agent:chief', 'Family/Photos/beach.jpg', 'family', 'Chief').consent, false);
});

// ── The scanner ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('the scanner finds every planted secret with its name, and nothing in a clean note', () => {
  const text = fixture('planted.md');
  const found = M.X.scanText(text);
  const got = found.map((f) => `${f.line} ${f.kind} ${f.label}`);
  assert.deepEqual(got, [
    '8 passcode Front counter iPad passcode',
    '9 passcode Alarm code',
    '10 passcode Back door keypad code',
    '11 password Office Wi-Fi password',
    '12 password Guest wifi key',
    '13 password Router admin password',
    '14 password POS login password',
    '20 password Xero password',
    '21 password Square password',
    '25 passcode Alarm PIN',
    '29 card Business Visa',
    '29 card CVV',
    '33 licence Office licence key',
    '34 api-key OPENAI_API_KEY',
    '35 api-key Ordering bot token',
    '36 password Password for backup',
    '40 id-number Passport number',
    '41 id-number Tax file number',
    '42 bank BSB',
    '42 bank Account number',
  ]);
  const values = found.map((f) => text.slice(f.start, f.end));
  assert.deepEqual(values.slice(0, 3), ['482915', '7731', '2468']);
  assert.ok(values.includes('Kp9#vLm2qq') && values.includes('4111 1111 1111 1111') && values.includes('123 456 782'));
  // Nothing that leaves the scanner carries a value in the clear.
  for (const f of found) {
    const value = text.slice(f.start, f.end);
    for (const shown of [f.context, f.masked, f.label]) assert.ok(!shown.includes(value), `“${f.label}” shows no value (${shown})`);
  }
  assert.equal(found.find((f) => f.kind === 'card' && f.label === 'Business Visa').masked, '•••• •••• •••• 1111');
  assert.equal(M.X.scanText(fixture('clean.md')).length, 0, 'policy, reset, pins, phone numbers, invoices, placeholders and locked links are not secrets');
});

test('scanner precision on the planted set and a fingerprint that never holds the value', async () => {
  const planted = M.X.scanText(fixture('planted.md'));
  const clean = M.X.scanText(fixture('clean.md'));
  const precision = planted.length / (planted.length + clean.length);
  assert.equal(precision, 1);
  const f = planted[0];
  const fp = await M.X.fingerprint('Notes/Setup.md', f);
  assert.match(fp, /^[a-f0-9]{24}$/);
  assert.equal(fp, await M.X.fingerprint('Notes/Setup.md', f), 'the same finding, the same fingerprint');
  assert.notEqual(fp, await M.X.fingerprint('Notes/Other.md', f));
  // A finding's place in the note becomes a locked link, nothing else changes.
  const text = fixture('planted.md');
  const out = M.X.lockFindings(text, [{ start: f.start, end: f.end, id: 'AbCdEfGhIjKl' }]);
  assert.ok(out.includes('Front counter iPad passcode: [locked](secret:AbCdEfGhIjKl)'));
  assert.equal(out.replace('[locked](secret:AbCdEfGhIjKl)', '482915'), text);
  assert.equal(M.X.scanText(out).length, planted.length - 1, 'a locked link is never found again');
  assert.equal(M.X.nameFor({ label: 'Password', kind: 'password' }, 'Office setup'), 'Password in Office setup');
});

test('secret file names are never read out: .env, private keys, key stores, credential files', () => {
  for (const [file, words] of [['.env', 'a .env file'], ['shop/.env.local', 'a .env file'], ['C:\\shop\\.env.production', 'a .env file'], ['deploy.pem', 'a private key file'], ['certs/shop.key', 'a private key file'], ['~/.ssh/id_ed25519', 'a private key file'], ['id_rsa_work', 'a private key file'], ['shop.p12', 'a private key file'], ['credentials.json', 'a credentials file'], ['my-secrets.yaml', 'a credentials file'], ['config/.npmrc', 'a credentials file']]) {
    assert.equal(M.X.secretFileWhy(file), words, file);
  }
  for (const file of ['README.md', 'shop/.env.example', 'id_rsa.pub', '~/.ssh/id_ed25519.pub', 'secretary.txt', 'Notes/My secrets.md', 'key-concepts.md', 'credentialism.txt', '']) {
    assert.equal(M.X.secretFileWhy(file), null, `${file || '(empty)'} is ordinary`);
  }
});

// ── Secrets ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const hello = (pcKey) => ({ available: async () => true, secret: async (name, challenge) => createHash('sha256').update(pcKey).update(name).update(challenge).digest() });
function lockedStore(vault, id = 'pc-1') {
  const trashed = [];
  const store = new M.PrivateNotes({ root: () => vault, hello: hello(id), device: { id, name: id }, lockAfter: () => 0, onLocked: () => {}, trash: async (abs) => (trashed.push(abs), rmSync(abs)) });
  return { store, trashed };
}
function clip() {
  const c = { text: '', cleared: 0, write: async (t) => (c.text = t), read: async () => c.text, clear: () => ((c.text = ''), c.cleared++) };
  return c;
}

test('Secrets: sealed on disk, opened again with the passphrase, refused with a wrong one, masked, copied and cleared', async () => {
  const vault = path.join(work, 'vault-secrets');
  const { store } = lockedStore(vault);
  const cb = clip();
  const secrets = new M.SecretsStore({ store, trash: async (abs) => rmSync(abs), clipboard: cb, clearAfter: 40 });
  await assert.rejects(() => secrets.list(), /locked/);
  await store.setUp('correct horse battery', true);
  const v = await secrets.add({ name: 'Front counter iPad passcode', kind: 'passcode', value: '482915', where: 'Front counter' });
  assert.equal(v.masked, '••••••');
  assert.equal(v.length, 6);
  assert.ok(!('value' in v), 'the list never carries the value');
  await secrets.add({ name: 'Office Wi-Fi', kind: 'password', value: 'Croissant!2026', username: 'office' });
  // On disk: sealed, under random names.
  const dir = path.join(vault, 'Private notes');
  const files = readdirSync(dir).filter((n) => n.endsWith('.nvsecret'));
  assert.equal(files.length, 2);
  const disk = files.map((n) => readFileSync(path.join(dir, n), 'utf8')).join('\n');
  for (const word of ['482915', 'Croissant', 'iPad', 'Front counter', 'office']) assert.ok(!disk.includes(word), `“${word}” isn’t readable on disk`);
  // Reveal and copy; the clipboard clears itself when it still holds the secret.
  assert.equal((await secrets.reveal(v.id)).value, '482915');
  assert.deepEqual(await secrets.copy(v.id), { name: 'Front counter iPad passcode', seconds: 0 });
  assert.equal(cb.text, '482915');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(cb.text, '', 'cleared after a while');
  await secrets.copy(v.id);
  cb.text = 'something else the person copied';
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(cb.text, 'something else the person copied', 'never clears what someone else put there');
  // Edited in place: a new value, the username taken off.
  const changed = await secrets.update(v.id, { value: '771234', where: '' });
  assert.equal(changed.length, 6);
  assert.equal(changed.where, undefined);
  // Locked: forgotten. Another PC (or this one again): the passphrase opens it, a wrong one doesn't.
  store.lock();
  await assert.rejects(() => secrets.reveal(v.id), /locked/);
  const other = lockedStore(vault, 'pc-2').store;
  const there = new M.SecretsStore({ store: other, trash: async () => {}, clipboard: clip() });
  await assert.rejects(() => other.unlockWithPassword('wrong horse battery'), /isn’t the recovery password/);
  await assert.rejects(() => there.list(), /locked/);
  await other.unlockWithPassword('correct horse battery');
  assert.deepEqual((await there.list()).map((x) => x.name), ['Front counter iPad passcode', 'Office Wi-Fi']);
  assert.equal((await there.reveal(v.id)).value, '771234');
  // A tampered file is left alone, never read as something else.
  writeFileSync(path.join(dir, files[0]), readFileSync(path.join(dir, files[0]), 'utf8').replace(/"data":"(.)/, (m, c) => `"data":"${c === 'A' ? 'B' : 'A'}`));
  await there.load();
  assert.equal((await there.list()).length, 1);
});

// ── Every agent path ─────────────────────────────────────────────────────────────────────────────────────────────────

const KNEE = 'Health/Knee rehab/Knee rehab.md';
const HARBOUR = 'Work/Harbour Fit-out/Harbour Fit-out.md';
const NOTES = {
  [HARBOUR]: `---\ntype: project\nstatus: active\nhealth: on track\nowner: Sam Taylor\ndue: "2026-11-20"\n---\n# Harbour Fit-out\n\n## Summary\n\nThe harbour office fit-out.\n\n## What’s next\n\n- [ ] Send the joinery drawings — Sam Taylor · by 30 Oct 2026\n\n## People\n\n- **Sam Taylor** — Project owner\n`,
  [KNEE]: `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Sam Taylor\n---\n# Knee rehab\n\n## Summary\n\nPhysio twice a week and the MRI.\n\n## What’s next\n\n- [ ] Book the MRI — Sam Taylor · by 29 Oct 2026\n\n## People\n\n- **Sam Taylor** — Patient\n`,
  'Health/Physio sessions.md': '# Physio sessions\n\nSam Taylor saw the physio about the knee. The ice pack is in the [[Oven service]] cupboard.\n',
  'Meetings/Physio check-in.md': '---\ntype: meeting\ndate: 2026-10-20\nsensitivity: health\nattendees: [Sam Taylor]\n---\n## Actions\n- [ ] Sam Taylor to book the knee scan — by Friday\n',
  'Meetings/Harbour site walk.md': '---\ntype: meeting\ndate: 2026-10-21\nattendees: [Sam Taylor]\n---\n## Actions\n- [ ] Sam Taylor to confirm the joinery — by Friday\n',
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March. Ask Sam Taylor about the knee brace.\n',
  'Notes/Wexley St iPad.md': '# Wexley St iPad\n\niPad passcode: [locked](secret:AbCdEfGhIjKl)\n',
  'Family/School pickup.md': '# School pickup\n\nThe kids finish at 3:10 on Fridays.\n',
  'Me/CV.md': '---\nsensitivity: personal\n---\n# CV\n\nSam Taylor, project manager.\n',
  'Private notes/Diary.md': '# Diary\n\nNever readable.\n',
};
const FILES = ['Family/Photos/beach.jpg', 'Work/Harbour Fit-out/Drawings.pdf'];

function makeHost(dataDir, vaultRoot) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  index.setFiles(FILES);
  const projects = new M.Projects(index);
  const history = new M.ProjectHistory();

  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return !p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..') ? '' : p;
  };
  const assetDetails = (rel) => ({ path: rel, name: rel.split('/').pop(), kind: 'image', inferred: 'image', tags: [], collections: [] });
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys(), ...FILES].map((rel) => ({ rel, kind: rel.endsWith('.md') ? 'note' : 'image' })), folders: [...new Set([...files.keys()].filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async (rel) => {
      files.delete(rel);
      reindex(rel);
    },
    clean,
    today: () => 'Saturday 24 October 2026 (2026-10-24)',
    assets: { list: async () => ({ folder: 'Assets', attachments: '', index: '', assets: FILES.map((p) => ({ path: p, name: p.split('/').pop(), size: 1, mtime: 0, kind: 'image', tags: [], collections: [] })), collections: [], tags: [] }), details: async (rel) => assetDetails(rel) },
  };
  const host = {
    dataDir,
    kind: 'embedded',
    ready: async () => {},
    library: () => vaultRoot,
    index,
    notes,
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async (rel, edits, by, words) => {
      const before = index.content(rel);
      const p = M.parseProject(before, rel);
      const done = edits.map((e) => M.applyProjectEdit(p, e, '24 Oct 2026'));
      const after = M.serializeProject(p, before);
      await writeNote(rel, after);
      history.record(rel, { before, after, words: done[0], by });
      return { file: rel, words: done[0], before, after };
    },
    undoProject: async () => {},
    createProject: async (name) => `Projects/${name}/${name}.md`,
    writeNote,
    trash: async (rel) => notes.trash(rel),
    today: () => M.todayData(index, { path: 'Daily/2026-10-24.md', exists: false }),
    dailyPath: () => 'Daily/2026-10-24.md',
    dailyNote: async () => 'Daily/2026-10-24.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam Taylor',
    changed: () => {},
    full: {
      readText: async (rel) => files.get(rel) ?? '',
      writeText: async (rel, t) => writeNote(rel, t),
      isFolder: async () => false,
      move: async (from, to) => ({ path: to, linksUpdated: 0 }),
      makeFolder: async () => {},
      trashPath: async (rel) => notes.trash(rel),
      templateNote: async () => '',
      templateCreate: async () => '',
      templateFromNote: async () => '',
      assets: { add: async () => ({ added: [], reused: [] }), update: async (rel) => assetDetails(rel), details: async (rel) => assetDetails(rel), brand: async () => ({ logos: {}, colours: [], fonts: [] }), setBrand: async (b) => b },
      reviewDraft: async () => ({}),
      reviewApply: async () => ({ note: '', changes: 0, words: '', id: '' }),
      reviewUndo: async () => '',
    },
  };
  return { host, files, index };
}

let runs = 0;
async function setupVault(store = {}) {
  const base = path.join(work, `agents-${++runs}`);
  const vaultRoot = path.join(base, 'vault');
  mkdirSync(path.join(vaultRoot, '.neuralvault'), { recursive: true });
  writeFileSync(path.join(vaultRoot, '.neuralvault', 'sensitivity.json'), JSON.stringify({ folders: { Work: 'work', Health: 'health', Family: 'family', Me: 'personal' }, items: { 'Family/Photos/beach.jpg': 'family' }, access: {}, photos: 'ask', ...store }));
  const t = makeHost(path.join(base, 'data'), vaultRoot);
  const sensitivity = new M.Sensitivity({ root: () => vaultRoot, props: (rel) => t.index.get(rel)?.props, pc: 'TEST-PC' });
  t.host.gate = (who, name) => M.makeGate(sensitivity, who, name);
  const access = new M.AgentAccess(t.host);
  access.load();
  return { ...t, access, sensitivity, vaultRoot };
}
const said = (r) => r.content.map((c) => c.text).join('\n');
/** Connect an AI at Read and write: the local MCP server's one row ("agent:local-mcp", under Outside agents). */
async function localAgent(access) {
  await access.setLocalMcp({ on: true, level: 'edit' });
  return { who: 'agent:local-mcp', name: 'Other AI apps' };
}

test('outside agents: nothing they aren’t allowed reaches them by search, read, lists, projects, Today, records or links', async () => {
  const { access, sensitivity } = await setupVault();
  const a = await localAgent(access);
  const call = async (name, args = {}) => said(await access.asLocalMcp(name, args));
  const HEALTH_WORDS = /Knee rehab|Physio|MRI|knee scan|School pickup|kids finish|project manager/;

  // Search and lists.
  const search = await call('vault_search', { query: 'Sam Taylor' });
  assert.match(search, /Harbour Fit-out/);
  assert.doesNotMatch(search, HEALTH_WORDS);
  assert.doesNotMatch(await call('vault_search', { query: 'knee' }), /Physio sessions|Knee rehab|Physio check-in/, 'a Health note never matches');
  assert.doesNotMatch(await call('notes_list', { folder: '' }), HEALTH_WORDS);
  assert.doesNotMatch(await call('notes_list', { folder: 'Health' }), /Physio sessions|Knee rehab\.md/);
  assert.doesNotMatch(await call('notes_recent', { days: 30 }), HEALTH_WORDS);
  assert.doesNotMatch(await call('vault_overview'), /Knee rehab/);
  // Reading one by name: refused, saying its level, never its words.
  const read = await call('note_read', { path: 'Health/Physio sessions.md' });
  assert.match(read, /marked Health and Other AI apps isn’t allowed Health/);
  assert.doesNotMatch(read, /physio about the knee/);
  assert.match(await call('note_read', { path: 'Physio sessions' }), /marked Health/, 'by its title too');
  assert.match(await call('note_read', { path: 'Me/CV.md' }), /marked Personal/);
  assert.match(await call('note_read', { path: 'Oven service' }), /deck oven/, 'an Open note reads as before');
  assert.match(await call('note_read', { path: 'Private notes/Diary.md' }), /Private notes are never open to agents/);
  // Projects, Today, the timeline, meetings.
  assert.deepEqual(JSON.parse(await call('projects_list')).projects.map((p) => p.name), ['Harbour Fit-out']);
  assert.match(await call('project_get', { project: 'Knee rehab' }), /marked Health/);
  assert.doesNotMatch(await call('today_get'), /Knee rehab|MRI/);
  assert.doesNotMatch(await call('timeline_get', { days_back: 60, days_ahead: 60 }), /Knee rehab|MRI/);
  const meetings = await call('meetings_list', { days: 3650 });
  assert.match(meetings, /Harbour site walk/);
  assert.doesNotMatch(meetings, /Physio check-in/);
  assert.match(await call('meeting_actions', { note: 'Physio check-in' }), /marked Health/);
  // The connected vault's records: what's open with a person, everything about them.
  const open = await call('person_open_items', { person: 'Sam Taylor' });
  assert.match(open, /joinery/);
  assert.doesNotMatch(open, /MRI|knee scan|Knee rehab/);
  assert.doesNotMatch(await call('connected_to', { what: 'Sam Taylor' }), /Knee rehab|Physio/);
  // Writes: not into what it can't read.
  assert.match(await call('note_append', { path: 'Health/Physio sessions.md', text: 'More.' }), /marked Health/);
  assert.match(await call('project_add_next_step', { project: 'Knee rehab', steps: [{ what: 'Call the physio' }] }), /marked Health/);
  // A locked link is all there is of a secret.
  assert.match(await call('note_read', { path: 'Wexley St iPad' }), /\[locked\]\(secret:AbCdEfGhIjKl\)/);

  // Allowed Health: it reads, and the read goes in the audit trail.
  const who = a.who;
  await sensitivity.update((st) => (st.access[who] = ['open', 'work', 'health']));
  assert.match(await call('note_read', { path: 'Health/Physio sessions.md' }), /physio about the knee/);
  assert.match(await call('vault_search', { query: 'knee' }), /Physio sessions/);
  assert.deepEqual(JSON.parse(await call('projects_list')).projects.map((p) => p.name).sort(), ['Harbour Fit-out', 'Knee rehab']);
  const trail = await sensitivity.trail();
  assert.ok(trail.some((e) => e.who === who && e.action === 'refused' && e.item === 'Health/Physio sessions.md' && e.level === 'health'), 'the refusal is in the trail');
  assert.ok(trail.some((e) => e.who === who && e.action === 'read' && e.item === 'Health/Physio sessions.md' && e.whoName === 'Other AI apps'), 'the read is in the trail');
  assert.ok(trail.some((e) => e.who === who && e.action === 'listed' && /Physio sessions/.test(e.item)), 'a search that showed it');
  assert.ok(trail.every((e) => e.pc === 'TEST-PC'));
  assert.ok(!trail.some((e) => /Oven service/.test(e.item)), 'Open items’ everyday reads aren’t logged');
  const csv = M.S.auditCsv(trail);
  assert.match(csv.split('\n')[0], /^When,Who,What,Item,Level,Detail,PC$/);
  assert.match(csv, /Other AI apps,Read,Health\/Physio sessions\.md,Health/);
});

test('the side chat’s way in (the assistant’s tools, links both ways, related notes, records, retrieval) through its gate', async () => {
  const { host, sensitivity, index } = await setupVault();
  const g = M.makeGate(sensitivity, 'side-chat', 'The side chat');
  const gi = M.gateIndex(index, g);
  // Links both ways: the Health note linking to Oven service isn't shown as a backlink.
  assert.deepEqual(index.backlinks('Notes/Oven service.md').map((b) => b.source), ['Health/Physio sessions.md']);
  assert.deepEqual(gi.backlinks('Notes/Oven service.md'), []);
  assert.equal(gi.content('Health/Physio sessions.md'), undefined);
  assert.equal(gi.get(KNEE), undefined);
  assert.equal(gi.resolve('Physio sessions'), null);
  assert.ok(!gi.allMeta().some((m) => m.path.startsWith('Health/')));
  assert.ok(!gi.search('knee').some((h) => h.path.startsWith('Health/')));
  assert.ok(!gi.retrieve('knee physio MRI').some((c) => c.path.startsWith('Health/')), 'what the chat retrieves');
  assert.ok(!gi.related('Notes/Oven service.md').some((r) => r.path.startsWith('Health/')), 'related notes');
  assert.ok(!gi.relatedNotes('Notes/Oven service.md').some((r) => r.path.startsWith('Health/')));
  assert.ok(!gi.tasks().some((t) => t.path.startsWith('Health/') || t.path === 'Meetings/Physio check-in.md'));
  const flat = (m) => JSON.stringify(m, (_k, x) => (x instanceof Map ? [...x] : x));
  const model = flat(gi.records({ templatesFolder: 'Templates' }));
  assert.ok(model.includes('joinery'), 'the record model has what the side chat may read');
  assert.ok(!model.includes('MRI') && !model.includes('knee scan'), 'and none of the rest');
  assert.ok(flat(index.records({ templatesFolder: 'Templates' })).includes('MRI'), 'while the window’s own model has everything');
  assert.throws(() => gi.set('x.md', '', 0, 0), /Agents don’t use/, 'nothing else on the index is reachable');
  // The assistant's own tools over the gated notes.
  const tools = new M.AgentTools(M.gateNotes(host.notes, g), [], () => {});
  const run = async (name, args) => (await tools.run({ id: String(Math.random()), name, arguments: JSON.stringify(args) })).text;
  assert.doesNotMatch(await run('search_notes', { query: 'knee' }), /Physio sessions|Knee rehab/);
  assert.match(await run('read_note', { path: 'Health/Physio sessions.md' }), /marked Health and The side chat isn’t allowed Health/);
  assert.doesNotMatch(await run('note_links', { path: 'Notes/Oven service.md' }), /Physio/);
  assert.doesNotMatch(await run('list_assets', {}), /beach\.jpg/, 'a Family-private photo isn’t listed');
  assert.match(await run('read_note', { path: 'Me/CV.md' }), /project manager/, 'Personal is the side chat’s by default');
  assert.doesNotMatch(await run('person_open_items', { person: 'Sam Taylor' }), /MRI|knee scan/);
});

test('a Family-private photo: another AI app is refused, never asked on its behalf', async () => {
  const { access, sensitivity } = await setupVault();
  const a = await localAgent(access);
  await sensitivity.update((st) => (st.access[a.who] = ['open', 'family']));
  const r = await access.asLocalMcp('asset_update', { asset: 'Family/Photos/beach.jpg', description: 'The beach' });
  assert.equal(r.isError, true);
  assert.match(said(r), /needs your OK in Ironleaf first/);
  // Photos never given: refused outright.
  await sensitivity.update((st) => (st.photos = 'never'));
  assert.match(said(await access.asLocalMcp('asset_update', { asset: 'Family/Photos/beach.jpg', description: 'x' })), /never given to agents/);
});

// ── The scanner's move, and Private notes into levels ────────────────────────────────────────────────────────────────

function work4(vaultRoot, t, sensitivity, store, secrets) {
  return new M.SensitiveWork({
    dataDir: path.join(vaultRoot, '..', 'data'),
    index: t.index,
    sensitivity,
    secrets,
    privateNotes: store,
    root: () => vaultRoot,
    canEdit: async () => {},
    writeNote: (rel, text) => t.host.writeNote(rel, text),
    exists: async (rel) => t.files.has(rel),
    files: async () => FILES,
    noteTypes: async () => [{ id: 'meeting', name: 'Meeting' }],
    changed: () => {},
  });
}

test('the scanner moves what it found into Secrets, leaving locked links, and Undo puts it all back', async () => {
  const v = await setupVault();
  const { store } = lockedStore(v.vaultRoot);
  const secrets = new M.SecretsStore({ store, trash: async (abs) => rmSync(abs), clipboard: clip() });
  const w = work4(v.vaultRoot, v, v.sensitivity, store, secrets);
  const original = fixture('planted.md');
  await v.host.writeNote('Notes/Bakery setup.md', original);
  const report = await w.scan();
  const note = report.notes.find((n) => n.path === 'Notes/Bakery setup.md');
  assert.equal(note.findings.length, 20);
  assert.ok(!JSON.stringify(report).includes('482915') && !JSON.stringify(report).includes('Kp9#vLm2qq'), 'the report carries no value');
  assert.deepEqual(report.files, [], 'no file named for passwords here');
  await assert.rejects(() => w.move([{ path: note.path, fp: note.findings[0].fp }]), /Open Locked first/);
  await store.setUp('correct horse battery', false);
  // "Not a secret": left out of the next scan.
  await w.ignore(note.findings.at(-1).fp);
  assert.equal((await w.scan()).notes.find((n) => n.path === note.path).findings.length, 19);
  const moved = await w.move(note.findings.slice(0, 19).map((f) => ({ path: note.path, fp: f.fp })));
  assert.equal(moved.moved, 19);
  const after = v.files.get(note.path);
  assert.ok(!after.includes('482915') && !after.includes('Croissant!2026') && !after.includes('4111 1111 1111 1111'));
  assert.match(after, /Front counter iPad passcode: \[locked\]\(secret:[A-Za-z0-9_-]{12}\)/);
  const list = await secrets.list();
  assert.equal(list.length, 19);
  const ipad = list.find((s) => s.name === 'Front counter iPad passcode');
  assert.equal((await secrets.reveal(ipad.id)).value, '482915');
  assert.equal(ipad.from, note.path);
  assert.deepEqual(w.usedIn(ipad.id).map((x) => x.path), [note.path]);
  assert.equal(await w.undoMove(moved.undoId), 'Put back as it was: 1 note.');
  assert.equal(v.files.get(note.path), original);
  assert.equal((await secrets.list()).length, 0, 'the secrets it made are taken back');
  const trail = await v.sensitivity.trail();
  assert.equal(trail.filter((e) => e.action === 'moved-to-secrets').length, 19);
  assert.ok(!JSON.stringify(trail).includes('482915'), 'the trail never holds a value');
});

test('Private notes move into levels without losing a word: secrets first, read back, then the sealed note to the Recycle Bin', async () => {
  const v = await setupVault();
  const { store, trashed } = lockedStore(v.vaultRoot);
  const secrets = new M.SecretsStore({ store, trash: async (abs) => rmSync(abs), clipboard: clip() });
  const w = work4(v.vaultRoot, v, v.sensitivity, store, secrets);
  assert.deepEqual(await w.migrationPlan(), [], 'none set up: nothing to move');
  await store.setUp('correct horse battery', false);
  await store.write('Blood tests', '# Blood tests\n\nIron is low. Ask Dr Patel at the GP.\n');
  await store.write('Gym locker', '# Gym locker\n\nLocker 12, combination: 12-34-56.\n');
  await store.write('Kids/School logins', '# School logins\n\nThe school portal password: Maple#2019\n');
  await store.write('Diary', '# Diary\n\nA quiet week.\n');
  const plan = await w.migrationPlan();
  const by = Object.fromEntries(plan.map((p) => [p.title, p]));
  assert.equal(by['Blood tests'].suggested, 'health');
  assert.equal(by['Blood tests'].destination, 'Health/Blood tests.md');
  assert.equal(by['School logins'].suggested, 'family');
  assert.equal(by['School logins'].secrets, 1);
  assert.equal(by['Gym locker'].secrets, 1);
  assert.equal(by.Diary.suggested, 'personal');
  assert.equal(by.Diary.destination, 'Me/Diary.md');
  const r = await w.migrate([
    { path: by['Blood tests'].path, level: 'health' },
    { path: by['School logins'].path, level: 'family' },
    { path: by['Gym locker'].path, level: 'personal', destination: 'Me/Gym locker.md' },
    { path: by.Diary.path, keep: true },
  ]);
  assert.deepEqual([r.moved, r.kept, r.secrets, r.problems], [3, 1, 2, []]);
  const blood = v.files.get('Health/Blood tests.md');
  assert.equal(blood, '---\nsensitivity: health\n---\n\n# Blood tests\n\nIron is low. Ask Dr Patel at the GP.\n', 'every word, with its level');
  const school = v.files.get(r.placed.find((p) => p.to.includes('School logins')).to);
  assert.match(school, /sensitivity: family/);
  assert.match(school, /The school portal password: \[locked\]\(secret:/);
  assert.ok(!school.includes('Maple#2019'));
  assert.match(v.files.get('Me/Gym locker.md'), /combination: \[locked\]\(secret:/);
  const all = await secrets.list();
  assert.deepEqual(all.map((s) => s.kind).sort(), ['passcode', 'password']);
  assert.equal((await secrets.reveal(all.find((s) => s.kind === 'password').id)).value, 'Maple#2019');
  assert.equal(trashed.length, 3, 'the three moved went to the Recycle Bin, still sealed');
  assert.deepEqual(store.list().map((e) => e.path), ['Private notes/Diary.md'], 'the one kept stays a Private note');
  // An agent allowed Health now reads the blood tests; one that isn't, doesn't.
  assert.equal(v.sensitivity.level('Health/Blood tests.md'), 'health');
  assert.equal(M.makeGate(v.sensitivity, 'neuralbot', 'Chat bot').sees('Health/Blood tests.md'), false);
  assert.equal((await v.sensitivity.store()).migrated.notes, 3);
});

test('Settings rows: the groups and each bot under Chat bots; access set and reset', async () => {
  const v = await setupVault();
  const { store } = lockedStore(v.vaultRoot);
  const secrets = new M.SecretsStore({ store, trash: async () => {}, clipboard: clip() });
  const w = work4(v.vaultRoot, v, v.sensitivity, store, secrets);
  mkdirSync(path.join(v.vaultRoot, '..', 'data'), { recursive: true });
  writeFileSync(path.join(v.vaultRoot, '..', 'data', 'agents-known.json'), JSON.stringify({ bots: [{ id: 'main', name: 'Chat bot', main: true }, { id: 'coach', name: 'Coach' }] }));
  const state = await w.state();
  assert.deepEqual(state.rows.map((r) => r.id), ['side-chat', 'neuralbot', 'bot:coach', 'agents']);
  assert.equal(state.rows.find((r) => r.id === 'bot:coach').follows, 'neuralbot');
  assert.deepEqual(state.folders.find((f) => f.folder === 'Health'), { folder: 'Health', notes: 2, level: 'health', suggested: 'health' });
  assert.equal(state.counts.health, 3, 'the knee rehab, the physio sessions and the check-in');
  assert.equal(state.counts.family, 2, 'the school pickup and the beach photo');
  await w.setAccess('bot:coach', ['health']);
  assert.deepEqual(M.S.accessOf(v.sensitivity.store(), 'bot:coach'), ['open', 'health']);
  await w.setAccess('agents', ['work', 'personal']);
  assert.equal(v.sensitivity.allows('agent:local-mcp', 'personal'), true, 'other AI apps follow Outside agents');
  await w.setAccess('bot:coach', null);
  assert.deepEqual(M.S.accessOf(v.sensitivity.store(), 'bot:coach'), ['open', 'work'], 'follows the chat bots row again');
  await assert.rejects(() => w.setAccess('agent:someone-else', ['health']), /isn’t one Ironleaf knows/);
  const trail = await v.sensitivity.trail();
  assert.ok(trail.some((e) => e.action === 'access-set' && e.item === 'Coach' && /allowed Health/.test(e.detail)));
  // A note's level set from the picker: written as its property; a file's in the vault's file.
  const lv = await w.setLevel('Notes/Oven service.md', 'work');
  assert.equal(lv.level, 'work');
  assert.match(v.files.get('Notes/Oven service.md'), /^---\nsensitivity: work\n---\n/);
  assert.ok(lv.readers.includes('The side chat') && !lv.readers.includes('Chat bot') === false);
  await w.setLevel('Work/Harbour Fit-out/Drawings.pdf', 'personal');
  assert.equal(v.sensitivity.store().items['Work/Harbour Fit-out/Drawings.pdf'], 'personal');
  await w.setLevel('Notes/Oven service.md', null);
  assert.equal(v.sensitivity.level('Notes/Oven service.md'), 'open');
});

test('an agent writes nothing new where it may not write: new notes checked, both ends of a move checked', async () => {
  const t = await setupVault();
  const a = await localAgent(t.access);
  const call = async (name, args = {}) => said(await t.access.asLocalMcp(name, args));
  // A new note in Health is refused, naming its level; an Open one goes ahead.
  const refused = await t.access.asLocalMcp('note_create', { path: 'Health/Sneak.md', content: '# Sneak\n' });
  assert.equal(refused.isError, true);
  assert.match(said(refused), /marked Health and Other AI apps isn’t allowed Health/);
  assert.ok(!t.files.has('Health/Sneak.md'), 'nothing written');
  assert.match(await call('note_create', { path: 'Notes/Sneak.md', content: '# Sneak\n' }), /Made Notes\/Sneak\.md/);
  // The same through the gates directly: both note writers, both moves, and Full control’s file writer.
  const g = t.host.gate(a.who, a.name);
  const notes = M.gateNotes(t.host.notes, g);
  await assert.rejects(() => notes.write('Health/Sneak.md', 'x'), /marked Health/);
  await notes.write('Notes/Sneak.md', '# Sneak\n');
  await assert.rejects(() => notes.move('Notes/Oven service.md', 'Health/Moved.md'), /marked Health/, 'a move into Health is refused');
  const gated = M.gateAccessHost(t.host, g);
  await assert.rejects(() => gated.writeNote('Health/Sneak.md', 'x'), /marked Health/);
  await assert.rejects(() => gated.full.writeText('Health/Sneak.md', 'x'), /marked Health/);
  await assert.rejects(() => gated.full.move('Notes/Oven service.md', 'Health/Moved.md'), /marked Health/);
  assert.ok(!t.files.has('Health/Moved.md') && t.files.has('Notes/Oven service.md'), 'nothing moved');
});
