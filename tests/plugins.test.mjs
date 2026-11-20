// Plugins, a first small door (8.9): the manifest read, off until allowed and on (asked again when the folder changes),
// the sandboxed API (read, write with Undo, toasts, one command, one card), never Private notes or Secrets, and a crash
// anywhere guarded and logged without taking anything else down. The example word-count card end to end. Made-up values.

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';

const root = path.resolve(import.meta.dirname, '..');
const work = path.join(root, 'tests', 'tmp', 'plugins');
const src = (p) => JSON.stringify(pathToFileURL(path.join(root, p)).href);

let M;

before(async () => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const entry = path.join(work, 'plugins-entry.ts');
  writeFileSync(entry, [`export { PluginManager } from ${src('src/main/plugins.ts')};`, `export { parsePluginManifest, pluginPermissionWords, PLUGIN_ID } from ${src('src/shared/plugins.ts')};`, `export { EXAMPLE_PLUGIN_FOLDER, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_PLUGIN_SCRIPT } from ${src('src/main/plugin-example.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'plugins.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'plugins.mjs')).href);
}, { timeout: 120000 });
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
/** A fixture vault (notes in memory, the plugins folder on disk) behind a real PluginManager. */
function setup(notes = {}) {
  const tag = `p${++n}`;
  const vault = path.join(work, tag, 'vault');
  const dataDir = path.join(work, tag, 'data');
  const bin = path.join(work, tag, 'bin');
  mkdirSync(vault, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const files = new Map(Object.entries({ 'Notes/Hello.md': '# Hello\n\nSome words here.\n', 'Private notes/Diary.md': '# Diary\n\nSecret words.\n', ...notes }));
  const sent = [];
  const logs = [];
  const trashed = [];
  const host = {
    dataDir,
    vaultRoot: () => vault,
    listNotes: async () => [...files.keys()],
    readNote: async (rel) => {
      if (!files.has(rel)) throw new Error(`There is no note “${rel}”.`);
      return files.get(rel);
    },
    writeNote: async (rel, text) => {
      files.set(rel, text);
    },
    existsNote: async (rel) => files.has(rel),
    canWrite: async () => {},
    trashPath: async (abs) => {
      trashed.push(abs);
      rmSync(abs, { recursive: true, force: true });
    },
    send: (channel, payload) => sent.push({ channel, payload }),
    log: (m) => logs.push(m),
    scriptTimeoutMs: 300,
    callTimeoutMs: 800,
  };
  const manager = new M.PluginManager(host);
  manager.load();
  const dir = path.join(vault, '.neuralvault', 'plugins');
  const writePlugin = (folder, manifest, script) => {
    mkdirSync(path.join(dir, folder), { recursive: true });
    if (manifest !== null) writeFileSync(path.join(dir, folder, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    if (script !== null) writeFileSync(path.join(dir, folder, 'plugin.js'), script);
  };
  return { manager, host, files, sent, logs, trashed, vault, dataDir, dir, writePlugin };
}
const toasts = (sent) => sent.filter((s) => s.channel === 'plugins:toast').map((s) => s.payload);
const GOOD_SCRIPT = `module.exports.activate = async (api) => {
  api.setCard(async () => ({ title: 'Good card', lines: [(await api.listNotes()).length + ' notes'] }));
  api.addCommand({ id: 'hello', title: 'Say hello' }, async () => { api.toast('Hello from Good.'); });
};`;
const goodManifest = (over = {}) => ({ id: 'good', name: 'Good', version: '1.0.0', description: 'A good plugin.', permissions: ['read-notes'], command: { id: 'hello', title: 'Say hello' }, card: { id: 'card', title: 'Good card' }, ...over });

test('the manifest read: good ones pass, mistakes say what is wrong', () => {
  assert.equal(M.parsePluginManifest(goodManifest()).ok, true);
  assert.equal(M.parsePluginManifest({ ...goodManifest(), permissions: ['read-notes', 'write-notes'] }).ok, true);
  assert.equal(M.parsePluginManifest({ ...goodManifest(), permissions: undefined }).ok, true);
  assert.match(M.parsePluginManifest({ ...goodManifest(), id: 'Bad id!' }).error, /lowercase, numbers and dashes/);
  assert.match(M.parsePluginManifest({ ...goodManifest(), name: '  ' }).error, /needs a name/);
  assert.match(M.parsePluginManifest({ ...goodManifest(), permissions: ['read-everything'] }).error, /cannot have/);
  assert.match(M.parsePluginManifest({ ...goodManifest(), command: { id: 'x' } }).error, /needs an id and a title/);
  assert.match(M.parsePluginManifest('nope').error, /could not be read/);
  assert.equal(M.pluginPermissionWords('read-notes'), 'Read your notes (never Private notes or Secrets)');
  assert.equal(M.pluginPermissionWords('write-notes'), 'Change your notes (every change with Undo)');
});

test('lists what is in the folder, each broken one saying why', async () => {
  const t = setup();
  t.writePlugin('good', goodManifest(), GOOD_SCRIPT);
  t.writePlugin('no-manifest', null, GOOD_SCRIPT);
  t.writePlugin('bad-json', '{oops', GOOD_SCRIPT);
  t.writePlugin('bad-manifest', { ...goodManifest(), id: 'Bad!' }, GOOD_SCRIPT);
  t.writePlugin('no-script', goodManifest({ id: 'noscript', name: 'Noscript' }), null);
  t.writePlugin('dup-a', goodManifest({ id: 'dup', name: 'Dup A' }), GOOD_SCRIPT);
  t.writePlugin('dup-b', goodManifest({ id: 'dup', name: 'Dup B' }), GOOD_SCRIPT);
  const list = await t.manager.list();
  const by = (folder) => list.find((v) => v.folder === folder);
  assert.equal(by('good').error, undefined);
  assert.deepEqual([by('good').on, by('good').allowed], [false, false]);
  assert.equal(by('good').hasCommand, true);
  assert.equal(by('good').hasCard, true);
  assert.match(by('no-manifest').error, /needs its manifest/);
  assert.match(by('bad-json').error, /not JSON/);
  assert.match(by('bad-manifest').error, /lowercase/);
  assert.match(by('no-script').error, /needs its script/);
  const dups = list.filter((v) => v.id === 'dup');
  assert.equal(dups.length, 2);
  assert.ok(dups.filter((v) => v.error).length === 1 && dups.some((v) => /already uses the id/.test(v.error ?? '')));
});

test('off until allowed and on; the example arrives with a new plugins folder', async () => {
  const t = setup();
  await t.manager.useVault(t.vault);
  assert.ok(existsSync(path.join(t.dir, 'word-count', 'plugin.json')), 'the example is written with the folder');
  let list = await t.manager.list();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].on, list[0].allowed], [false, false]);
  await assert.rejects(t.manager.setOn('word-count', true), /Allow Word count first/);
  list = await t.manager.allow('word-count');
  assert.equal(list.find((v) => v.id === 'word-count').allowed, true);
  list = await t.manager.setOn('word-count', true);
  const word = list.find((v) => v.id === 'word-count');
  assert.equal(word.on, true);
  assert.equal(word.error, undefined);
  assert.deepEqual(t.manager.commands().map((c) => c.title), ['Count words in notes']);
  // Removing it sticks: the next vault open does not write it again.
  await t.manager.remove('word-count');
  assert.ok(t.trashed[0].endsWith(path.join('.neuralvault', 'plugins', 'word-count')));
  assert.ok(!existsSync(path.join(t.dir, 'word-count')));
  await t.manager.useVault(t.vault);
  assert.ok(!existsSync(path.join(t.dir, 'word-count')));
});

test('a changed plugin goes off and asks again', async () => {
  const t = setup();
  t.writePlugin('good', goodManifest(), GOOD_SCRIPT);
  await t.manager.allow('good');
  await t.manager.setOn('good', true);
  assert.equal((await t.manager.list()).find((v) => v.id === 'good').on, true);
  // Its script changed under it (an update, or something else's hand).
  writeFileSync(path.join(t.dir, 'good', 'plugin.js'), `${GOOD_SCRIPT}\n// changed\n`);
  const list = await t.manager.list();
  const good = list.find((v) => v.id === 'good');
  assert.equal(good.on, false, 'off until allowed again');
  assert.equal(good.allowed, false);
  assert.deepEqual(t.manager.commands(), [], 'stopped running');
  await t.manager.allow('good');
  await t.manager.setOn('good', true);
  assert.equal((await t.manager.list()).find((v) => v.id === 'good').on, true);
});

test('reads, writes with Undo, toasts, a command and a card', async () => {
  const t = setup();
  t.writePlugin('writer', goodManifest({ id: 'writer', name: 'Writer', permissions: ['read-notes', 'write-notes'], description: 'Writes a line.' }), `module.exports.activate = async (api) => {
    api.addCommand({ id: 'hello', title: 'Write the line' }, async () => {
      const paths = await api.listNotes();
      const text = await api.readNote('Notes/Hello.md');
      await api.writeNote('Notes/Hello.md', text + 'Written.\\n');
      api.toast('Wrote it (' + paths.length + ' notes).');
    });
    api.setCard(async () => ({ title: 'Writer card', lines: ['ready'] }));
  };`);
  await t.manager.allow('writer');
  await t.manager.setOn('writer', true);
  assert.deepEqual((await t.manager.cards()).map((c) => [c.title, c.lines, c.failed]), [['Writer card', ['ready'], false]]);
  const ran = await t.manager.runCommand('writer', 'hello');
  assert.deepEqual(ran, { ok: true, words: '' });
  assert.match(t.files.get('Notes/Hello.md'), /Written\./);
  const said = toasts(t.sent);
  assert.ok(said.some((x) => x.words === 'Wrote it (1 notes).' && !x.undo), 'its own toast');
  const changed = said.find((x) => x.undo);
  assert.match(changed.words, /Writer changed Hello\./);
  // The write's Undo restores, and only while nothing else changed the note.
  assert.match(await t.manager.undo(changed.undo), /Undid Writer’s change to Hello/);
  assert.ok(!t.files.get('Notes/Hello.md').includes('Written.'));
  assert.equal(await t.manager.undo(changed.undo), 'There is nothing to undo.');
});

test('never Private notes, Secrets, or anything outside notes', async () => {
  const t = setup();
  t.writePlugin('sneaky', goodManifest({ id: 'sneaky', name: 'Sneaky', permissions: ['read-notes', 'write-notes'], description: 'Tries to reach.' }), `module.exports.activate = async (api) => {
    const tries = [];
    tries.push(await api.listNotes().then((p) => p.join('|')));
    for (const rel of ['Private notes/Diary.md', '.neuralvault/settings.json', '../outside.md', 'Notes/Hello.pdf']) {
      tries.push(await api.readNote(rel).then(() => 'READ:' + rel, (e) => 'REFUSED:' + e.message));
    }
    tries.push(await api.writeNote('Private notes/Diary.md', 'x').then(() => 'WROTE', (e) => 'REFUSED:' + e.message));
    api.addCommand({ id: 'hello', title: 'Try' }, async () => { api.toast(tries.join(' // ')); });
  };`);
  await t.manager.allow('sneaky');
  await t.manager.setOn('sneaky', true);
  await t.manager.runCommand('sneaky', 'hello');
  const said = toasts(t.sent).at(-1).words;
  assert.match(said, /^Notes\/Hello\.md \/\//, 'Private notes never listed');
  assert.doesNotMatch(said, /Secret words/);
  assert.match(said, /REFUSED:Private notes are never open to plugins\./);
  assert.match(said, /REFUSED:That is Ironleaf’s own folder\./);
  assert.match(said, /REFUSED:Give a note’s path inside the vault/);
  assert.match(said, /REFUSED:Plugins read notes \(\.md\)\./);
  assert.ok(!t.files.has('Private notes/Diary.md') || t.files.get('Private notes/Diary.md').includes('Secret words'), 'never written');
});

test('without the permission, reading and writing refuse', async () => {
  const t = setup();
  t.writePlugin('quiet', goodManifest({ id: 'quiet', name: 'Quiet', permissions: [], description: 'Wants nothing.' }), `module.exports.activate = async (api) => {
    const r = await api.readNote('Notes/Hello.md').then(() => 'READ', (e) => e.message);
    const w = await api.writeNote('Notes/Hello.md', 'x').then(() => 'WROTE', (e) => e.message);
    api.addCommand({ id: 'hello', title: 'Try' }, async () => { api.toast(r + ' // ' + w); });
  };`);
  await t.manager.allow('quiet');
  await t.manager.setOn('quiet', true);
  await t.manager.runCommand('quiet', 'hello');
  assert.equal(toasts(t.sent).at(-1).words, 'Quiet needs your permission to read notes. // Quiet needs your permission to change notes.');
  assert.ok(!t.files.get('Notes/Hello.md').includes('x\n'));
});

test('a project’s file is refused (its page keeps the history)', async () => {
  const t = setup({ 'Projects/Made/Made.md': '---\ntype: project\nstatus: active\n---\n# Made\n' });
  t.writePlugin('writer', goodManifest({ id: 'writer', name: 'Writer', permissions: ['write-notes'], description: 'Writes.' }), `module.exports.activate = async (api) => {
    api.addCommand({ id: 'hello', title: 'Try' }, async () => {
      api.toast(await api.writeNote('Projects/Made/Made.md', 'changed').then(() => 'WROTE', (e) => e.message));
    });
  };`);
  await t.manager.allow('writer');
  await t.manager.setOn('writer', true);
  await t.manager.runCommand('writer', 'hello');
  assert.match(toasts(t.sent).at(-1).words, /change it on the project’s page in Ironleaf/);
  assert.match(t.files.get('Projects/Made/Made.md'), /# Made/);
});

test('a crash anywhere is guarded and logged: the app and the other plugins carry on', async () => {
  const t = setup();
  t.writePlugin('good', goodManifest(), GOOD_SCRIPT);
  t.writePlugin('boom-start', goodManifest({ id: 'boom-start', name: 'Boom start', description: 'Throws starting.' }), `module.exports.activate = async () => { throw new Error('bang on start'); };`);
  t.writePlugin('boom-command', goodManifest({ id: 'boom-command', name: 'Boom command', description: 'Throws running.' }), `module.exports.activate = async (api) => { api.addCommand({ id: 'hello', title: 'Boom' }, async () => { throw new Error('bang running'); }); };`);
  t.writePlugin('boom-card', goodManifest({ id: 'boom-card', name: 'Boom card', description: 'Throws drawing.', card: { id: 'card', title: 'Boom card' } }), `module.exports.activate = async (api) => { api.setCard(async () => { throw new Error('bang drawing'); }); };`);
  t.writePlugin('needs-require', goodManifest({ id: 'needs-require', name: 'Needs require', description: 'Reaches outside.' }), `const fs = require('node:fs');\nmodule.exports.activate = async () => {};`);
  t.writePlugin('loops', goodManifest({ id: 'loops', name: 'Loops', description: 'Never stops.' }), `while (true) {}\nmodule.exports.activate = async () => {};`);
  for (const id of ['good', 'boom-start', 'boom-command', 'boom-card', 'needs-require', 'loops']) await t.manager.allow(id);
  for (const id of ['good', 'boom-start', 'boom-command', 'boom-card', 'needs-require', 'loops']) await t.manager.setOn(id, true);
  const list = await t.manager.list();
  assert.match(list.find((v) => v.id === 'boom-start').error, /bang on start/);
  assert.match(list.find((v) => v.id === 'needs-require').error, /require is not defined/);
  assert.match(list.find((v) => v.id === 'loops').error, /took too long/);
  assert.ok(t.logs.some((m) => m.includes('Boom start') && m.includes('bang on start')), 'logged with its name');
  const ran = await t.manager.runCommand('boom-command', 'hello');
  assert.deepEqual(ran, { ok: false, words: 'Boom command couldn’t run.' });
  const cards = await t.manager.cards();
  const boomCard = cards.find((c) => c.pluginId === 'boom-card');
  assert.equal(boomCard.failed, true);
  assert.equal(boomCard.title, 'Boom card');
  // The good plugin never noticed.
  assert.deepEqual(t.manager.commands().map((c) => c.pluginId).sort(), ['boom-command', 'good']);
  const cardsAgain = await t.manager.cards();
  assert.deepEqual(cardsAgain.find((c) => c.pluginId === 'good').lines, ['1 notes']);
  const hello = await t.manager.runCommand('good', 'hello');
  assert.deepEqual(hello, { ok: true, words: '' });
});

test('the example word-count card counts every note’s words', async () => {
  const t = setup({ 'Notes/Two.md': 'One two three four.\n' });
  await t.manager.useVault(t.vault);
  await t.manager.allow('word-count');
  await t.manager.setOn('word-count', true);
  const cards = await t.manager.cards();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].failed, false);
  // '# Hello Some words here.' (5) + 'One two three four.' (4): Private notes never counted.
  assert.deepEqual(cards[0].lines, ['9 words in 2 notes']);
  await t.manager.runCommand('word-count', 'count');
  assert.equal(toasts(t.sent).at(-1).words, '9 words in 2 notes.');
});

test('on and allowed are kept: the next start runs without asking again', async () => {
  const t = setup();
  t.writePlugin('good', goodManifest(), GOOD_SCRIPT);
  await t.manager.allow('good');
  await t.manager.setOn('good', true);
  await t.manager.flush();
  const again = new M.PluginManager(t.host);
  again.load();
  await again.useVault(t.vault);
  const list = await again.list();
  assert.deepEqual([list.find((v) => v.id === 'good').on, list.find((v) => v.id === 'good').allowed], [true, true]);
  assert.deepEqual(again.commands().map((c) => c.title), ['Say hello']);
});

test('a foreign folder opened in place gets nothing written into it', async () => {
  const t = setup();
  await t.manager.useVault(t.vault, true);
  assert.ok(!existsSync(t.dir));
  assert.deepEqual(await t.manager.list(), []);
});

test('the example present the first time Plugins opens in any vault, never read-only', async () => {
  const t = setup();
  await t.manager.useVault(t.vault, true);
  assert.ok(!existsSync(t.dir), 'browsing writes nothing');
  const list = await t.manager.listWithExample();
  assert.ok(existsSync(path.join(t.dir, 'word-count', 'plugin.json')), 'opening Plugins writes it, even in place');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Word count');
  assert.deepEqual([list[0].on, list[0].allowed], [false, false], 'off until allowed');
  // Removing it still sticks: the next open does not write it again.
  await t.manager.remove('word-count');
  assert.deepEqual((await t.manager.listWithExample()).map((v) => v.id), [], 'removal sticks');
  // A read-only vault gets nothing, even when Plugins opens.
  const r = setup();
  r.host.canWrite = async () => {
    throw new Error('Read-only.');
  };
  await r.manager.useVault(r.vault);
  assert.ok(!existsSync(r.dir));
  assert.deepEqual(await r.manager.listWithExample(), []);
  assert.ok(!existsSync(r.dir), 'never into a read-only vault');
});

test('remove stops, forgets, and moves the folder to the Bin', async () => {
  const t = setup();
  t.writePlugin('good', goodManifest(), GOOD_SCRIPT);
  await t.manager.allow('good');
  await t.manager.setOn('good', true);
  assert.equal(t.manager.commands().length, 1);
  const list = await t.manager.remove('good');
  assert.deepEqual(list, []);
  assert.deepEqual(t.manager.commands(), []);
  assert.ok(t.trashed[0].endsWith(path.join('plugins', 'good')));
  assert.ok(!existsSync(path.join(t.dir, 'good')));
  await t.manager.flush();
  assert.ok(!JSON.parse(readFileSync(path.join(t.dataDir, 'plugins.json'), 'utf8')).plugins.good, 'forgotten');
});
