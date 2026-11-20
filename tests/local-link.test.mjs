// node --test tests/local-link.test.mjs — ironleaf:// registration and handling (the local link, 16 Nov 2026,
// "make sure they all communicate"): registered per user at install (the installer's protocols) and repaired at
// start (src/main/windows-entry.ts); open, note?path= and capture?text= handled in the running copy (single
// instance forwards second starts). Paths are vault-relative and never leave the vault.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-local-link-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const dialog = { showMessageBox: async () => ({ response: 1, checkboxChecked: false }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };\nexport const shell = {};\nexport const app = {};\n');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/shared/uri.ts')};`,
      `export { commandLine, pathWith, regAdds, windowsEntries } from ${src('src/main/windows-entry.ts')};`,
      `export { ExternalEntry } from ${src('src/main/external.ts')};`,
      `export { AgentAccess } from ${src('src/main/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects } from ${src('src/main/projects.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'local-link.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'local-link.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('registered at install: the installer claims ironleaf://', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'build-standalone', 'electron-builder.json'), 'utf8'));
  const schemes = (config.protocols ?? []).flatMap((p) => p.schemes ?? []);
  assert.ok(schemes.includes('neuralvault'), 'the installer registers the ironleaf:// scheme');
  assert.equal(config.nsis.perMachine, false, 'per user, no admin');
});

test('repaired at start: the per-user keys open this copy with the link', () => {
  const exe = 'C:\\Users\\Made Up\\AppData\\Local\\Programs\\Ironleaf\\Ironleaf.exe';
  const entries = M.windowsEntries({ exe, launchArgs: [] });
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  const scheme = byKey['HKCU\\Software\\Classes\\neuralvault'];
  assert.equal(scheme.values[''].data, 'URL:Ironleaf link');
  assert.equal(scheme.values['URL Protocol'].data, '');
  const command = byKey['HKCU\\Software\\Classes\\neuralvault\\shell\\open\\command'];
  assert.equal(command.values[''].data, `"${exe}" "%1"`);
  // Offered for Markdown files beside the person's own choice, never taking it.
  for (const ext of ['.md', '.markdown']) assert.ok(byKey[`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`].values['NeuralVault.Markdown'], ext);
  // Written with reg add, whole values quoted.
  const adds = M.regAdds({ key: 'HKCU\\Software\\Classes\\neuralvault', values: { '': { type: 'REG_SZ', data: 'URL:Ironleaf link' } } });
  assert.deepEqual(adds, [['add', 'HKCU\\Software\\Classes\\neuralvault', '/ve', '/t', 'REG_SZ', '/d', 'URL:Ironleaf link', '/f']]);
  assert.equal(M.commandLine(exe, [], '%1'), `"${exe}" "%1"`);
});

test('the contract links are read: open, note and capture', () => {
  const ok = (link) => {
    const r = M.parseVaultUri(link);
    assert.equal(r.ok, true, `${link}: ${r.error}`);
    return r.action;
  };
  assert.deepEqual(ok('ironleaf://open'), { kind: 'open', note: '' });
  assert.deepEqual(ok('ironleaf://'), { kind: 'open', note: '' });
  assert.deepEqual(ok('neuralvault:'), { kind: 'open', note: '' });
  assert.deepEqual(ok('ironleaf://open?note=Log'), { kind: 'open', note: 'Log' });
  assert.deepEqual(ok('ironleaf://note?path=Meetings%2FSite%20walk'), { kind: 'open', note: 'Meetings/Site walk' });
  assert.deepEqual(ok('ironleaf://capture?text=Sourdough%20starter'), { kind: 'new', name: 'Sourdough starter', folder: 'Inbox', text: 'Sourdough starter', open: true });
  // The name comes from the first line, cleaned; empty words still capture.
  assert.deepEqual(ok('ironleaf://capture?text=%23%20Hello%0ASecond'), { kind: 'new', name: 'Hello', folder: 'Inbox', text: '# Hello\nSecond', open: true });
  assert.equal(ok('ironleaf://capture?text=').folder, 'Inbox');
  const no = (link, re) => {
    const r = M.parseVaultUri(link);
    assert.equal(r.ok, false, link);
    assert.match(r.error, re);
  };
  no('ironleaf://note', /isn’t inside your notes/);
  no('ironleaf://note?path=..%2F..%2FWindows%2Ffile', /isn’t inside your notes/);
  no('ironleaf://note?path=..%5C..%5CWindows', /isn’t inside your notes/);
  no('ironleaf://note?path=C%3A%5CWindows%5Cfile', /isn’t inside your notes/);
});

/** A small vault in memory behind AgentAccess, and the app's side of links (as tests/external.test.mjs). */
function makeVault(dataDir, asked = []) {
  const index = new M.VaultIndex();
  const files = new Map([['Notes/Oven service.md', '# Oven service\n\nThe deck oven is serviced every March.\n']]);
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
    today: () => 'Monday 16 November 2026 (2026-11-16)',
  };
  const access = new M.AgentAccess({
    dataDir, kind: 'standalone', ready: async () => {}, library: () => '/made-up/library', index, notes,
    projects: () => projects.list(), projectView: (rel) => projects.view(rel), allProjects: () => projects.all(),
    editProject: async () => { throw new Error('no projects here'); }, undoProject: async () => {}, createProject: async () => '',
    writeNote, trash: async () => {}, today: () => ({}), dailyPath: () => 'Daily/2026-11-16.md', dailyNote: async () => 'Daily/2026-11-16.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }), templates: () => [], lastReview: async () => null,
    person: () => 'Made Up', changed: () => {},
  });
  access.load();
  const opened = [];
  const external = new M.ExternalEntry({
    dataDir, kind: 'standalone', version: '1.0.0', icon: '', handle: () => {}, send: () => {}, window: () => null,
    openWindow: async (target) => void opened.push(target?.note ?? '(window)'),
    ready: async () => {}, vaultRoot: () => null, agents: access,
    readNote: async (rel) => files.get(rel), writeNote, canWrite: async () => {},
    dailyNote: async () => 'Daily/2026-11-16.md',
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
  return { files, writes, opened, external };
}

test('open and note are handled by the running copy; a bad note never leaves the vault', async () => {
  const v = makeVault(mkdtempSync(path.join(work, 'data-')));
  let r = await v.external.link('ironleaf://open');
  assert.deepEqual(r, { done: true, words: 'Opened Ironleaf.' });
  assert.deepEqual(v.opened, ['(window)']);
  r = await v.external.link('ironleaf://note?path=Notes%2FOven%20service.md');
  assert.deepEqual(r, { done: true, words: 'Opened Notes/Oven service.md.' });
  r = await v.external.link('ironleaf://note?path=..%2F..%2Fsecret.md');
  assert.equal(r.done, false);
  assert.match(r.words, /isn’t inside your notes/);
  r = await v.external.link('ironleaf://note?path=C%3A%5CWindows%5Csecret.md');
  assert.equal(r.done, false);
  assert.deepEqual(v.writes, []);
});

test('capture asks first, then makes the note in the Inbox; Cancel makes nothing', async () => {
  const asked = [];
  const v = makeVault(mkdtempSync(path.join(work, 'data-')), asked);
  let r = await v.external.link('ironleaf://capture?text=Sourdough%20starter');
  assert.equal(r.done, false);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].words.title, 'Make a note from a link?');
  assert.match(asked[0].words.message, /Inbox\/Sourdough starter\.md/);
  assert.deepEqual(v.writes, []);
  asked.answer = { ok: true, always: false };
  r = await v.external.link('ironleaf://capture?text=Sourdough%20starter');
  assert.equal(r.done, true);
  assert.deepEqual(v.writes, ['Inbox/Sourdough starter.md']);
  assert.equal(v.files.get('Inbox/Sourdough starter.md'), 'Sourdough starter');
  assert.deepEqual(v.opened, ['(window)', '(window)', 'Inbox/Sourdough starter.md']);
});

test("a second start's links run in this copy (single instance)", async () => {
  const asked = [];
  asked.answer = { ok: true, always: false };
  const v = makeVault(mkdtempSync(path.join(work, 'data-')), asked);
  await v.external.launch(['/made-up/Ironleaf.exe', 'ironleaf://open', 'ironleaf://note?path=Notes%2FOven%20service.md']);
  assert.deepEqual(v.opened, ['(window)', 'Notes/Oven service.md']);
});

test('the window forwards every start to the link handler', () => {
  const app = readFileSync(path.join(root, 'src', 'main', 'app.ts'), 'utf8');
  assert.ok(app.includes('external.launch(process.argv)'), 'the first start runs its links');
  assert.ok(app.includes("app.on('second-instance', (_event, argv) => void external.launch(argv))"), 'a second start hands its links to the running copy');
});
