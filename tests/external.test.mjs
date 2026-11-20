// node --test tests/external.test.mjs — Ironleaf from outside its window (src/shared/uri.ts, src/main/external.ts,
// src/main/loose-files.ts, AgentAccess.asPerson; 21 Oct 2026, gap G26): ironleaf:// links read (and anything else
// ignored), the rule that every link changing notes asks first unless its kind is allowed (kept in links.json), a link
// cancelled changing nothing, "Don't ask again" remembered; links and the command running the verbs agents use as the
// person, never in Private notes; what a start was for read from its arguments; and a Markdown file from outside the vault
// opened, read and saved where it is, only by the number it was given, while one inside the vault opens as its note.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-external-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'electron-stub.mjs');
  // Electron isn't here: a stand-in with the one thing external.ts imports (its dialog; the tests give their own answer).
  writeFileSync(stub, 'export const dialog = { showMessageBox: async () => ({ response: 1, checkboxChecked: false }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };\nexport const shell = {};\nexport const app = {};\n');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/shared/uri.ts')};`,
      `export { ExternalEntry } from ${src('src/main/external.ts')};`,
      `export { LooseFiles, LOOSE_MAX_BYTES } from ${src('src/main/loose-files.ts')};`,
      `export { AgentAccess } from ${src('src/main/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects } from ${src('src/main/projects.ts')};`,
    ].join('\n'),
  );
  await build({
    input: entry,
    platform: 'node',
    external: ['yaml', /^node:/],
    plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }],
    output: { file: path.join(work, 'external.mjs'), format: 'esm' },
    logLevel: 'silent',
  });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'external.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('links are read into what they ask for; anything else is ignored', () => {
  const ok = (link) => {
    const r = M.parseVaultUri(link);
    assert.equal(r.ok, true, r.error);
    return r.action;
  };
  assert.deepEqual(ok('ironleaf://open?note=Meetings%2FSite%20walk'), { kind: 'open', note: 'Meetings/Site walk' });
  assert.deepEqual(ok('neuralvault:open?path=Oven%20service.md'), { kind: 'open', note: 'Oven service.md' });
  assert.deepEqual(ok('ironleaf:///search?q=deck+oven'), { kind: 'search', query: 'deck oven' });
  assert.deepEqual(ok('NEURALVAULT://search/?query=flour#x'), { kind: 'search', query: 'flour' });
  assert.deepEqual(ok('ironleaf://new?name=Idea%3A%20Fridays&folder=Inbox&text=Sourdough'), { kind: 'new', name: 'Idea  Fridays'.replace('  ', ' '), folder: 'Inbox', text: 'Sourdough', open: true });
  assert.deepEqual(ok('ironleaf://append?note=Log&text=Done&heading=%23%23%20Today'), { kind: 'append', note: 'Log', text: 'Done', heading: 'Today' });
  assert.deepEqual(ok('ironleaf://daily?text=Rang%20the%20mill'), { kind: 'daily', text: 'Rang the mill', heading: '' });
  const no = (link, re) => {
    const r = M.parseVaultUri(link);
    assert.equal(r.ok, false);
    assert.match(r.error, re);
  };
  assert.deepEqual(ok('ironleaf://open'), { kind: 'open', note: '' });
  assert.deepEqual(ok('ironleaf://note?path=Meetings%2FSite%20walk'), { kind: 'open', note: 'Meetings/Site walk' });
  assert.deepEqual(ok('ironleaf://capture?text=Sourdough%20starter'), { kind: 'new', name: 'Sourdough starter', folder: 'Inbox', text: 'Sourdough starter', open: true });
  no('https://example.com', /isn’t an Ironleaf link/);
  no('ironleaf://delete?note=Log', /don’t do “delete”/);
  no('ironleaf://note?path=..%2F..%2FWindows', /isn’t inside your notes/);
  no('ironleaf://append?note=Log', /no words/);
  no('ironleaf://new?folder=..%2F..%2FWindows', /isn’t inside your notes/);
  no(`ironleaf://daily?text=${'a'.repeat(40000)}`, /too long/);
  // Control characters are dropped and the words kept to a note's worth.
  assert.equal(ok('ironleaf://daily?text=a%00b%07c').text, 'abc');
  assert.equal(ok(`ironleaf://daily?text=${'x'.repeat(25000)}`).text.length, M.URI_TEXT_MAX);
});

test('every link that changes notes asks first, unless its kind is allowed', () => {
  const open = { kind: 'open', note: 'x' };
  const search = { kind: 'search', query: 'x' };
  const add = { kind: 'append', note: 'x', text: 'y', heading: '' };
  const made = { kind: 'new', name: '', folder: '', text: '', open: true };
  assert.equal(M.needsConfirm(open, []), false);
  assert.equal(M.needsConfirm(search, []), false);
  assert.equal(M.needsConfirm(add, []), true);
  assert.equal(M.needsConfirm(made, []), true);
  assert.equal(M.needsConfirm(add, ['append']), false);
  assert.equal(M.needsConfirm(made, ['append']), true);
  assert.deepEqual(M.cleanAllowList(['daily', 'open', 'append', 'append', 42, 'rm']), ['append', 'daily']);
  assert.deepEqual(M.cleanAllowList('append'), []);
  const w = M.confirmWords({ kind: 'append', note: 'Log', text: 'Done', heading: 'Today' }, 'Notes/Log.md');
  assert.equal(w.title, 'Add to a note from a link?');
  assert.match(w.message, /“Notes\/Log\.md” under Today/);
  assert.match(w.detail, /It would add:\nDone/);
});

test('what a start was for: links, and whole paths to Markdown files', () => {
  const t = M.launchTargets([
    'C:\\Program Files\\HostApp\\HostApp.exe',
    '--neuralvault',
    'ironleaf://open?note=Log',
    '--neuralvault-open=C:\\Users\\pat\\Desktop\\Read me.md',
    '--neuralvault-open="D:\\Notes\\Quoted.markdown"',
    '/home/pat/plan.md',
    'relative.md',
    '--neuralvault-open=C:\\evil.exe',
    '--neuralvault-open=C:\\a\u0001b.md',
    'ironleaf://open?note=Log',
    42,
  ]);
  assert.deepEqual(t.links, ['ironleaf://open?note=Log']);
  assert.deepEqual(t.files, ['C:\\Users\\pat\\Desktop\\Read me.md', 'D:\\Notes\\Quoted.markdown', '/home/pat/plan.md']);
  assert.deepEqual(M.launchTargets(null), { links: [], files: [] });
  // Every Open with file type opens (16 Nov 2026 audit finding 14): the same list both places.
  const exts = M.launchTargets(['.md', '.markdown', '.mdown', '.mkd', '.txt'].map((ext) => `--neuralvault-open=C:\\Notes\\Read me${ext}`));
  assert.deepEqual(exts.files, ['.md', '.markdown', '.mdown', '.mkd', '.txt'].map((ext) => `C:\\Notes\\Read me${ext}`));
});

test('a file from outside the vault is read and saved where it is, only by its number', async () => {
  const vault = path.join(work, 'vault');
  const outside = path.join(work, 'Desktop');
  mkdirSync(path.join(vault, 'Notes'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'Read me.md'), '\uFEFF# Read me\n\nFrom a zip file.\n');
  writeFileSync(path.join(vault, 'Notes', 'Inside.md'), '# Inside\n');
  writeFileSync(path.join(outside, 'photo.png'), 'png');
  writeFileSync(path.join(outside, 'Huge.md'), Buffer.alloc(M.LOOSE_MAX_BYTES + 1, 97));
  const loose = new M.LooseFiles(() => vault);
  const r = await loose.open(path.join(outside, 'Read me.md'));
  assert.equal(r.kind, 'loose');
  assert.equal(r.file.name, 'Read me.md');
  assert.match(r.file.id, /^[\w-]{12}$/);
  // Opened twice: the same number.
  assert.equal((await loose.open(path.join(outside, '.', 'Read me.md'))).file.id, r.file.id);
  assert.equal((await loose.read(r.file.id)).text, '# Read me\n\nFrom a zip file.\n', 'the byte-order mark is not shown');
  await loose.write(r.file.id, '# Read me\n\nChanged in Ironleaf.\n');
  assert.equal(readFileSync(path.join(outside, 'Read me.md'), 'utf8'), '# Read me\n\nChanged in Ironleaf.\n');
  await assert.rejects(loose.write('made-up', 'x'), /was closed/);
  await assert.rejects(loose.read(path.join(outside, 'Read me.md')), /was closed/, 'never by a path');
  // Inside the vault: its note.
  assert.deepEqual(await loose.open(path.join(vault, 'Notes', 'Inside.md')), { kind: 'vault', rel: 'Notes/Inside.md' });
  await assert.rejects(loose.open(path.join(outside, 'photo.png')), /Markdown/);
  await assert.rejects(loose.open('relative/Read me.md'), /whole path/);
  await assert.rejects(loose.open(path.join(outside, 'Gone.md')), /isn’t there any more/);
  await assert.rejects(loose.open(path.join(outside, 'Huge.md')), /too big/);
  loose.close(r.file.id);
  await assert.rejects(loose.read(r.file.id), /was closed/);
});

/** A small vault in memory behind AgentAccess (as tests/agent-access.test.mjs builds one), and the app's side of links. */
function makeVault(dataDir, asked = []) {
  const index = new M.VaultIndex();
  const files = new Map([
    ['Notes/Oven service.md', '# Oven service\n\nThe deck oven is serviced every March.\n'],
    ['Private notes/Diary.md', '# Diary\n'],
  ]);
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), Date.now(), files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const writes = [];
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    writes.push(rel);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return !p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..') ? '' : p;
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => files.get(rel),
    write: writeNote,
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async () => {},
    clean,
    today: () => 'Wednesday 21 October 2026 (2026-10-21)',
  };
  const access = new M.AgentAccess({
    dataDir,
    kind: 'standalone',
    ready: async () => {},
    library: () => '/made-up/library',
    index,
    notes,
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async () => {
      throw new Error('no projects here');
    },
    undoProject: async () => {},
    createProject: async () => '',
    writeNote,
    trash: async () => {},
    today: () => ({}),
    dailyPath: () => 'Daily/2026-10-21.md',
    dailyNote: async () => 'Daily/2026-10-21.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Mere',
    changed: () => {},
  });
  access.load();
  const opened = [];
  const sent = [];
  const external = new M.ExternalEntry({
    dataDir,
    kind: 'standalone',
    version: '5.3.0',
    icon: '',
    handle: () => {},
    send: (channel) => sent.push(channel),
    window: () => null,
    openWindow: async (target) => void opened.push(target?.note ?? '(window)'),
    ready: async () => {},
    vaultRoot: () => null,
    agents: access,
    readNote: async (rel) => files.get(rel),
    writeNote,
    canWrite: async () => {},
    dailyNote: async () => {
      if (!files.has('Daily/2026-10-21.md')) await writeNote('Daily/2026-10-21.md', '# 21 October\n');
      return 'Daily/2026-10-21.md';
    },
    freeNote: async (folder, title) => {
      let rel = `${folder ? `${folder}/` : ''}${title}.md`;
      for (let i = 1; files.has(rel); i++) rel = `${folder ? `${folder}/` : ''}${title} ${i}.md`;
      return rel;
    },
    notes: () => [...files].map(([p, content]) => ({ path: p, content })),
    ask: async (words, always) => {
      asked.push({ words, always });
      return asked.answer ?? { ok: false, always: false };
    },
  });
  return { files, writes, opened, sent, external, access };
}

test('a link that opens or searches never asks; one that changes notes asks, and Cancel changes nothing', async () => {
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const asked = [];
  const v = makeVault(dataDir, asked);
  let r = await v.external.link('ironleaf://open?note=Oven%20service');
  assert.deepEqual(r, { done: true, words: 'Opened Notes/Oven service.md.' });
  assert.deepEqual(v.opened, ['Notes/Oven service.md']);
  r = await v.external.link('ironleaf://search?q=oven');
  assert.equal(r.done, true);
  assert.deepEqual(await v.external.items.splice(0).filter((i) => i.kind === 'search'), [{ kind: 'search', query: 'oven' }]);
  assert.equal(asked.length, 0);
  // Changing notes: asked, cancelled, nothing written.
  r = await v.external.link('ironleaf://append?note=Oven%20service&text=Booked%20for%20Tuesday');
  assert.equal(r.done, false);
  assert.match(r.words, /Nothing was changed/);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].words.title, 'Add to a note from a link?');
  assert.equal(asked[0].always, 'Don’t ask again for links that add to a note');
  assert.deepEqual(v.writes, []);
  // Allowed once: written through the verbs agents use, opened, and still asked next time.
  asked.answer = { ok: true, always: false };
  r = await v.external.link('ironleaf://append?note=Oven%20service&text=Booked%20for%20Tuesday');
  assert.deepEqual(r, { done: true, words: 'Added to Notes/Oven service.md from a link.' });
  assert.match(v.files.get('Notes/Oven service.md'), /every March\.\n\nBooked for Tuesday\n$/);
  assert.equal(v.opened.at(-1), 'Notes/Oven service.md');
  assert.equal(asked.length, 2);
  assert.deepEqual(v.external.state().allow, []);
  // "Don't ask again": remembered in links.json, and the next one of that kind runs without asking.
  asked.answer = { ok: true, always: true };
  r = await v.external.link('ironleaf://new?name=Idea&folder=Inbox&text=Sourdough%20Fridays');
  assert.deepEqual(r, { done: true, words: 'Made Inbox/Idea.md from a link.' });
  assert.equal(v.files.get('Inbox/Idea.md'), 'Sourdough Fridays');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dataDir, 'links.json'), 'utf8')), { allow: ['new'] });
  asked.answer = { ok: false, always: false };
  r = await v.external.link('ironleaf://new?name=Idea&folder=Inbox&text=Another');
  assert.deepEqual(r, { done: true, words: 'Made Inbox/Idea 1.md from a link.' }, 'a free name, never over the first');
  assert.equal(asked.length, 3, 'not asked again for new notes');
  // …but still for the other kinds.
  r = await v.external.link('ironleaf://daily?text=Rang%20the%20mill');
  assert.equal(r.done, false);
  assert.equal(asked.length, 4);
  // A second ExternalEntry on the same data reads the allow-list back.
  const again = makeVault(dataDir, []);
  assert.deepEqual(again.external.state().allow, ['new']);
  await again.external.setAllow([]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dataDir, 'links.json'), 'utf8')), { allow: [] });
});

test('links and the command never reach Private notes, and refusals are said', async () => {
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const v = makeVault(dataDir, Object.assign([], { answer: { ok: true, always: false } }));
  let r = await v.external.link('ironleaf://open?note=Private%20notes%2FDiary');
  assert.equal(r.done, false);
  assert.match(r.words, /Private notes/);
  r = await v.external.link('ironleaf://append?note=Private%20notes%2FDiary&text=x');
  assert.equal(r.done, false);
  assert.equal(v.files.get('Private notes/Diary.md'), '# Diary\n');
  r = await v.external.link('ironleaf://bogus');
  assert.equal(r.done, false);
  // Every refusal is also a line the window shows.
  const toasts = v.external.items.filter((i) => i.kind === 'toast').map((i) => i.words);
  assert.equal(toasts.length, 3);
  assert.ok(v.sent.includes('external:items'));
  // The command, through the same verbs as the person.
  let c = await v.external.runCommand(['read', 'Private notes/Diary'], '');
  assert.deepEqual(c, { exit: 1, text: 'Private notes are never reached from the command line or links.' });
  c = await v.external.runCommand(['search', 'deck', 'oven'], '');
  assert.equal(c.exit, 0);
  assert.match(c.text, /Notes\/Oven service\.md/);
  c = await v.external.runCommand(['create', 'Inbox/From the terminal', 'Hello'], '');
  assert.deepEqual(c, { exit: 0, text: 'Made Inbox/From the terminal.md.' });
  c = await v.external.runCommand(['daily:append', '--heading', 'Log'], 'Piped in');
  assert.equal(c.exit, 0);
  assert.match(v.files.get('Daily/2026-10-21.md'), /## Log\n+Piped in/);
  // AgentAccess.asPerson runs only the person's verbs, and logs nothing as an agent's.
  const denied = await v.access.asPerson('note_delete', { path: 'Notes/Oven service.md' });
  assert.equal(denied.isError, true);
  assert.equal(v.files.has('Notes/Oven service.md'), true);
  assert.equal(existsSync(path.join(dataDir, 'agent-activity.json')), false);
});

test('a file from outside opens in a tab of its own; one in the vault opens as its note', async () => {
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const v = makeVault(dataDir);
  const file = path.join(work, 'Brief.md');
  writeFileSync(file, '# Brief\n');
  await v.external.launch(['HostApp.exe', '--neuralvault', `--neuralvault-open=${file}`, 'ironleaf://open?note=Oven%20service']);
  const items = v.external.items.splice(0);
  const loose = items.find((i) => i.kind === 'loose');
  assert.equal(loose.file.path, file);
  assert.deepEqual(v.opened, ['(window)', 'Notes/Oven service.md'], 'the file first, then the link');
});
