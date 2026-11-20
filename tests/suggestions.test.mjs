// node --test tests/suggestions.test.mjs — the assistant's edits waiting for the person (19 Oct 2026, 5.0.0: "AI edits
// you approve"; src/main/suggestions.ts, src/main/agent.ts) and earlier versions that credit each edit
// (src/main/recovery.ts). With asking first on, an edit of a note writes nothing: it waits, the model is told it is
// waiting (so it never claims the note is changed), a second edit builds on the first, and a new note or a project's
// file is still written straight away. Off, today's direct write and Undo. File recovery records who made each copy,
// keeps the last words under their own author when someone else changes the note straight after, never credits
// Ironleaf's own write heard again by the folder watcher to anyone new, and carries the credit through a rename.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-suggest-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { AgentTools } from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
      `export { NoteSuggestions } from ${JSON.stringify(path.join(root, 'src/main/suggestions.ts'))};`,
      `export { Recovery } from ${JSON.stringify(path.join(root, 'src/main/recovery.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'suggest.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'suggest.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Notes in memory, the assistant's way in, with asking first switched as given. */
function setUp(notes, ask = true) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), Date.now(), files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const told = [];
  const waiting = new M.NoteSuggestions((e) => told.push(e));
  const writes = [];
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    write: async (rel, text) => {
      writes.push(rel);
      files.set(rel, text);
      reindex(rel);
    },
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Monday 19 October 2026 (2026-10-19)',
    suggest: { on: () => ask, pending: (rel, cur) => waiting.pending(rel, cur), offer: (rel, cur, after) => waiting.offer(rel, cur, after) },
  };
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const run = (name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
  return { files, told, waiting, writes, tools, run, steps };
}

const BAKERY = 'Bakery/Opening.md';
const NOTE = '# Opening\n\nOpen at 7am.\nClose at 3pm.\n';

test('an edit waits in the note: nothing written, the model told it is waiting, the chat told how many', async () => {
  const { files, told, writes, tools, run, steps } = setUp({ [BAKERY]: NOTE });
  const r = await run('edit_note', { path: BAKERY, action: 'replace', find: 'Open at 7am.', text: 'Open at 6:30am.' });
  assert.ok(!r.isError);
  assert.equal(files.get(BAKERY), NOTE, 'the file is untouched');
  assert.deepEqual(writes, []);
  assert.match(r.text, /NOT changed yet/);
  assert.match(r.text, /say it is ready to review, not that you changed it/);
  assert.equal(tools.changes.length, 0, 'nothing for Undo: nothing was changed');
  assert.deepEqual([...tools.suggested], [[BAKERY, 1]]);
  assert.equal(steps.at(-1).words, 'Suggested 1 change in Opening');
  assert.equal(told.length, 1);
  assert.equal(told[0].base, NOTE);
  assert.equal(told[0].after, NOTE.replace('7am', '6:30am'));
});

test('a second edit builds on the first, and reading the note shows both', async () => {
  const { files, told, run, tools } = setUp({ [BAKERY]: NOTE });
  await run('edit_note', { path: BAKERY, action: 'replace', find: 'Open at 7am.', text: 'Open at 6:30am.' });
  const read = await run('read_note', { path: BAKERY });
  assert.match(read.text, /still waiting/);
  assert.match(read.text, /6:30am/);
  await run('edit_note', { path: BAKERY, action: 'append', text: 'Closed on Mondays.' });
  assert.equal(files.get(BAKERY), NOTE);
  assert.equal(told.at(-1).after, `${NOTE.replace('7am', '6:30am')}\nClosed on Mondays.\n`);
  assert.equal(tools.suggested.get(BAKERY), 2);
});

test('properties set wait too; a new note and a project file are written straight away', async () => {
  const project = 'Projects/Harbour Cafe.md';
  const { files, writes, run } = setUp({ [BAKERY]: NOTE, [project]: '---\ntype: project\nstatus: planning\n---\n# Harbour Cafe\n' });
  await run('set_properties', { path: BAKERY, properties: { status: 'active' } });
  assert.equal(files.get(BAKERY), NOTE);
  await run('create_note', { path: 'Bakery/Suppliers.md', content: '# Suppliers\n' });
  assert.equal(files.get('Bakery/Suppliers.md'), '# Suppliers\n');
  await run('edit_note', { path: project, action: 'append', text: 'Lease signed.' });
  assert.match(files.get(project), /Lease signed/);
  assert.deepEqual(writes, ['Bakery/Suppliers.md', project]);
});

test('asking first off: today’s direct write, with Undo, and nothing waiting is ever written in', async () => {
  const { files, waiting, run, tools } = setUp({ [BAKERY]: NOTE }, false);
  waiting.offer(BAKERY, NOTE, NOTE.replace('3pm', '4pm'));
  const r = await run('edit_note', { path: BAKERY, action: 'replace', find: 'Open at 7am.', text: 'Open at 8am.' });
  assert.match(r.text, /^Changed/);
  assert.equal(files.get(BAKERY), NOTE.replace('7am', '8am'), 'the change waiting (4pm) is not slipped in');
  assert.equal(tools.changes.length, 1);
});

test('what waits follows the person: their typing stays, a change they typed over drops out', () => {
  const told = [];
  const s = new M.NoteSuggestions((e) => told.push(e));
  const after = NOTE.replace('7am', '6:30am').replace('3pm', '4pm');
  assert.equal(s.offer(BAKERY, NOTE, after), 2);
  // The person added a line at the top and changed the closing time themselves.
  const typed = `Note from Mia.\n${NOTE.replace('3pm', '2pm')}`;
  assert.equal(s.pending(BAKERY, typed), typed.replace('7am', '6:30am'));
  assert.equal(s.count(BAKERY, typed), 1);
  // Kept or discarded in the window: only the rest waits; none left, nothing waits.
  s.settle(BAKERY, NOTE, NOTE.replace('3pm', '4pm'));
  assert.equal(s.pending(BAKERY, NOTE), NOTE.replace('3pm', '4pm'));
  s.settle(BAKERY, NOTE, null);
  assert.equal(s.pending(BAKERY, NOTE), undefined);
  // No difference: nothing offered.
  assert.equal(s.offer(BAKERY, NOTE, NOTE), 0);
});

test('suggestions follow a renamed note, and another folder of notes starts with none', () => {
  const told = [];
  const s = new M.NoteSuggestions((e) => told.push(e));
  s.offer('Bakery/Opening.md', NOTE, NOTE.replace('7am', '8am'));
  s.renamed('Bakery', 'Cafe');
  assert.equal(s.has('Cafe/Opening.md'), true);
  assert.equal(s.has('Bakery/Opening.md'), false);
  assert.deepEqual(told.slice(-2).map((e) => [e.path, e.after === null]), [['Bakery/Opening.md', true], ['Cafe/Opening.md', false]]);
  s.reset();
  assert.deepEqual(s.list(), []);
  assert.equal(told.at(-1).after, null);
});

test('earlier versions say who made each one, and the last words before a handover are kept under their own author', async () => {
  const data = path.join(work, 'data-1');
  const rec = new M.Recovery(data, () => ({ minutes: 5, days: 7 }));
  rec.use(path.join(work, 'vault-1'));
  await rec.keep(BAKERY, NOTE, { by: 'you' });
  // The person keeps typing (within the five minutes: no copy), then the assistant's change is kept.
  await rec.keep(BAKERY, `${NOTE}More.\n`, { by: 'you' });
  await rec.keep(BAKERY, `${NOTE}More.\nFrom the assistant.\n`, { by: 'assistant' });
  // The folder watcher hears that write again: the same words, credited to nobody new.
  await rec.keep(BAKERY, `${NOTE}More.\nFrom the assistant.\n`, { by: 'outside' });
  // A sync changes it from outside.
  await rec.keep(BAKERY, `${NOTE}More.\nFrom the assistant.\nFrom the other PC.\n`, { by: 'sync:OneDrive' });
  const versions = await rec.versions(BAKERY);
  assert.deepEqual(versions.map((v) => v.by).reverse(), ['you', 'you', 'assistant', 'sync:OneDrive']);
  assert.equal(await rec.read(BAKERY, versions[2].id), `${NOTE}More.\n`, 'the person’s typing is kept as theirs, before the assistant’s change');
  // A rename keeps the credit.
  await rec.renamed(BAKERY, 'Cafe/Opening.md');
  assert.deepEqual((await rec.versions('Cafe/Opening.md')).map((v) => v.by).reverse(), ['you', 'you', 'assistant', 'sync:OneDrive']);
});

test('copies kept before 5.0.0 have no author, and a bringing-back is kept even straight after the last copy', async () => {
  const data = path.join(work, 'data-2');
  const rec = new M.Recovery(data, () => ({ minutes: 5, days: 7 }));
  rec.use(path.join(work, 'vault-2'));
  await rec.keep(BAKERY, NOTE);
  await rec.keep(BAKERY, 'Restored words.\n', { by: 'restored', force: true });
  const versions = await rec.versions(BAKERY);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].by, undefined);
  assert.equal(versions[0].by, 'restored');
  // The record of who made each copy sits beside the copies (Ironleaf's own data), never in the notes.
  const library = path.join(data, 'recovery', readdirSync(path.join(data, 'recovery'))[0]);
  const meta = JSON.parse(readFileSync(path.join(library, readdirSync(library)[0], 'meta.json'), 'utf8'));
  assert.equal(meta.path, BAKERY);
  assert.equal(Object.values(meta.by).length, 1);
});
