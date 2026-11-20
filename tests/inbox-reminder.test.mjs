// node --test tests/inbox-reminder.test.mjs — the filing prompt's "reminder" made real (Nov 2026
// review: src/shared/inbox-file.ts offered it, yet no filing path made one, so it came to nothing).
// Through the existing reminders (src/shared/reminders.ts): a capture with a time files to Reminders.md
// with its date from the words, by hand or sure straight there with one Undo; what can't be told when
// stays in the Inbox. Made-up captures only. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-inbox-reminder-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};\n`);
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// This Saturday at 3pm, always ahead: the model's "when" in the capture's own words.
const whenWords = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} at 3pm`;
};
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const saturdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return isoOf(d);
};

// A vault on disk (made-up captures only), with the handlers' other doors standing in.
function rig(inboxText, askJson) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const files = new Map();
  const put = (rel, text) => {
    files.set(rel, String(text));
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  };
  if (inboxText !== null) put('Inbox.md', inboxText);
  const vault = {
    root: dir,
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`missing ${rel}`);
      return files.get(rel);
    },
    write: async (rel, text) => put(rel, String(text)),
    create: async (rel, text = '') => {
      if (files.has(rel)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      put(rel, text);
    },
    any: async (rel) => files.has(rel),
    listAll: async () => ({ files: [...files.keys()].filter((r) => !r.startsWith('.')).map((rel) => ({ rel, mtime: 0, size: 0, kind: rel.endsWith('.md') ? 'note' : 'file' })), folders: [] }),
  };
  const handlers = new Map();
  L.registerLife({
    handle: (ch, fn) => handlers.set(ch, fn),
    vault: () => vault,
    index: { allMeta: () => [], content: () => null, get: () => undefined, resolveAny: () => null },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => ({ records: new Map() }),
    movePath: async () => {
      throw new Error('no move in this test');
    },
    indexFile: async () => null,
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async () => {
      throw new Error('no projects in this test');
    },
    ...(askJson ? { askJson } : {}),
  });
  return { handlers, read: (rel) => files.get(rel) ?? null, put };
}

const INBOX = '# Inbox\n\n## Captured\n\n- Ring Priya about the Harbour benchtop on Saturday at 3pm\n';

test('a capture with a time files to a reminder by hand', async () => {
  const { handlers, read } = rig(INBOX);
  const { items } = await handlers.get('inbox:list')();
  assert.equal(items.length, 1);
  const r = await handlers.get('inbox:file')(items[0].id, { kind: 'reminder', name: 'Reminders', when: whenWords() });
  assert.match(r.words, /Set a reminder for Saturday \d+ \w+ at 3:00 pm\./, r.words);
  assert.deepEqual(r.paths, ['Reminders.md']);
  assert.match(read('Reminders.md') ?? '', new RegExp(`- \\[ \\] Ring Priya about the Harbour benchtop on Saturday at 3pm ⏰ ${saturdayIso()} 15:00`), read('Reminders.md') ?? '');
  assert.ok(!(read('Inbox.md') ?? '').includes('Ring Priya'), 'the line leaves the Inbox');
});

test('what can’t be told when stays in the Inbox, in plain words', async () => {
  const { handlers, read } = rig(INBOX);
  const { items } = await handlers.get('inbox:list')();
  await assert.rejects(handlers.get('inbox:file')(items[0].id, { kind: 'reminder', name: 'Reminders', when: 'sometime' }), /Couldn’t tell when/, 'guessed at never');
  await assert.rejects(handlers.get('inbox:file')(items[0].id, { kind: 'reminder', name: 'Reminders' }), /Couldn’t tell when/, 'no moment: stays too');
  assert.ok((read('Inbox.md') ?? '').includes('Ring Priya'), 'the line stays');
  assert.equal(read('Reminders.md'), null, 'no reminder made');
});

test('a sure reminder files straight there, with one Undo for the batch', async () => {
  const askJson = async () => ({ reply: { items: [{ id: 'x', homes: [{ path: 'reminder', when: whenWords(), why: 'Asks to be told Saturday', sure: true }] }] } });
  // The update's first open marks (old captures stay); the capture under test arrives after.
  const { handlers, read, put } = rig('# Inbox\n\n## Captured\n\n- An old shopping list\n', async (system, user) => {
    const ids = JSON.parse(user).items.map((i) => i.id);
    const reply = await askJson();
    reply.reply.items[0].id = ids[0];
    return reply;
  });
  await handlers.get('inbox:auto-file')(); // the first run marks, never files
  put('Inbox.md', `${read('Inbox.md')}- Ring Priya about the Harbour benchtop on Saturday at 3pm\n`); // the capture arrives after the filer first ran: new, so it files
  const auto = await handlers.get('inbox:auto-file')();
  assert.equal(auto.words, 'Filed in Reminders.');
  assert.match(read('Reminders.md') ?? '', /Ring Priya about the Harbour benchtop on Saturday at 3pm ⏰/, 'the date from the words');
  assert.ok(!(read('Inbox.md') ?? '').includes('Ring Priya'));
  assert.ok(auto.undo, 'one Undo for the batch');
  const undone = await handlers.get('inbox:undo-auto')(auto.undo);
  assert.match(undone.words, /back in the Inbox/);
  assert.ok((read('Inbox.md') ?? '').includes('Ring Priya'), 'the line comes back');
  assert.ok(!(read('Reminders.md') ?? '').includes('Ring Priya'), 'the reminder goes');
});

test('a sure reminder with no moment understood stays, and the rest still file', async () => {
  const both = '- Ring Priya at sometime-ish o’clock\n- Water the HPC plants Saturday at 3pm\n';
  const { handlers, read, put } = rig('# Inbox\n\n## Captured\n\n- An old shopping list\n', async (system, user) => {
    const ids = JSON.parse(user).items.map((i) => i.id);
    return { reply: { items: [{ id: ids[0], homes: [{ path: 'reminder', when: 'sometime-ish', why: 'Might be a reminder', sure: true }] }, { id: ids[1], homes: [{ path: 'reminder', when: whenWords(), why: 'Asks to be told Saturday', sure: true }] }] } };
  });
  await handlers.get('inbox:auto-file')(); // the first run marks, never files
  put('Inbox.md', `${read('Inbox.md')}${both}`); // both captures arrive after the filer first ran
  const auto = await handlers.get('inbox:auto-file')();
  assert.equal(auto.words, 'Filed in Reminders.');
  assert.ok((read('Inbox.md') ?? '').includes('sometime-ish'), 'the unknowable one stays');
  assert.match(read('Reminders.md') ?? '', /Water the HPC plants Saturday at 3pm ⏰/, 'the knowable one files');
});
