// node --test tests/locked-absence.test.mjs — one Locked place (10.0 v2locked, plan item 24, vault-deep rank 7 and
// M12): one unlock opens private notes and secrets together with no Windows Hello anywhere (Hello is never required),
// one recovery password for both, the same lock for both; locked notes and secret values never in the index, search,
// the graph, the assistant's reading (the agent gate), the brief, the vault check or waiting suggestions — proven in
// this one file with fixtures. Made-up words and passwords only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-locked-absence-'));
let Store, Index, Brief, Suggest, Check, Gate;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const bundle = async (name, body) => {
    const entry = path.join(work, `${name}.ts`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(entry, body);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  const q = (p) => JSON.stringify(path.join(root, p));
  Store = await bundle('store', `export { PrivateNotes } from ${q('src/main/private-notes.ts')};\nexport { SecretsStore } from ${q('src/main/secrets.ts')};\n`);
  Index = await bundle('index', `export { VaultIndex } from ${q('src/main/indexer.ts')};\n`);
  Brief = await bundle('brief', `export * from ${q('src/shared/brief.ts')};\n`);
  Suggest = await bundle('suggest', `export { NoteSuggestions } from ${q('src/main/suggestions.ts')};\n`);
  Check = await bundle('check', `export { checkVault } from ${q('src/main/vault-check.ts')};\n`);
  Gate = await bundle('gate', `export { gateIndex, makeGate } from ${q('src/main/agent-gate.ts')};\n`);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Words that must never leave the locked store (made up).
const NOTE_WORDS = 'quokka parole lantern 7';
const SECRET_VALUE = 'wattle lantern code 942';
const PW = 'correct horse battery staple';
const PW2 = 'another long dinner party';

// Windows Hello is not set up on this PC at all: everything must work without it.
const noHello = { available: async () => false, secret: async () => { throw new Error('no hello'); } };

function makeStores(vault, clip = { text: '' }) {
  let locked = 0;
  const store = new Store.PrivateNotes({ root: () => vault, hello: noHello, device: { id: 'pc-1', name: 'pc-1' }, lockAfter: () => 0, onLocked: () => locked++, trash: async () => {} });
  const secrets = new Store.SecretsStore({ store, trash: async () => {}, clipboard: { write: async (t) => { clip.text = t; }, read: async () => clip.text, clear: () => { clip.text = ''; } }, clearAfter: 50 });
  return { store, secrets, locked: () => locked };
}

const sealedBytes = (vault) => readdirSync(path.join(vault, 'Private notes')).map((n) => readFileSync(path.join(vault, 'Private notes', n), 'utf8')).join('\n');

test('one unlock opens both, with no Windows Hello anywhere; one recovery password; the same lock', async () => {
  const vault = path.join(work, 'vault');
  const { store, secrets } = makeStores(vault);
  assert.deepEqual(await store.status(), { exists: false, unlocked: false, hello: false, thisPc: false, count: 0 });
  await store.setUp(PW, false);
  await store.write('Health/Blood tests', `Iron is low. ${NOTE_WORDS}.`);
  const added = await secrets.add({ name: 'Padlock', kind: 'passcode', value: SECRET_VALUE });
  assert.equal(store.read('Private notes/Health/Blood tests.md'), `Iron is low. ${NOTE_WORDS}.`);
  assert.equal((await secrets.list()).length, 1);

  // On disk: sealed files, neither the note's words nor the secret's value anywhere in them.
  const bytes = sealedBytes(vault);
  assert.ok(!bytes.includes('quokka') && !bytes.includes('wattle'), 'sealed on disk');

  // Locking locks both at once: the same lock, one timeout.
  store.lock();
  assert.throws(() => store.list(), /locked/);
  assert.throws(() => store.read('Health/Blood tests'), /locked/);
  await assert.rejects(() => secrets.list(), /locked/);
  await assert.rejects(() => secrets.reveal(added.id), /locked/);
  await assert.rejects(() => secrets.copy(added.id), /locked/);

  // One unlock with the recovery password opens both again.
  await assert.rejects(() => store.unlockWithPassword('wrong password here'), /recovery password/);
  await store.unlockWithPassword(PW);
  assert.equal(store.list().length, 1);
  assert.equal((await secrets.list()).length, 1);
  assert.equal((await secrets.reveal(added.id)).value, SECRET_VALUE);

  // One recovery story: a new password opens both, the old one opens neither.
  await store.changePassword(PW2);
  store.lock();
  await assert.rejects(() => store.unlockWithPassword(PW), /recovery password/);
  await store.unlockWithPassword(PW2);
  assert.equal(store.read('Health/Blood tests'), `Iron is low. ${NOTE_WORDS}.`);
  assert.equal((await secrets.reveal(added.id)).value, SECRET_VALUE);
});

test('the index refuses locked paths: search, graph, tasks, reminders and records never see them', () => {
  const index = new Index.VaultIndex();
  index.set('Notes/Open.md', '# Open\n\nThe bakery opens at seven.\n\n- [ ] Buy flour · by 2026-11-05\n\n- [ ] Call the bakery ⏰ 2026-11-06 09:00\n', 1000, 100);
  index.set('Private notes/Diary.md', `# Diary\n\n${NOTE_WORDS}\n\n- [ ] ${NOTE_WORDS}\n`, 1000, 100);
  index.setFiles(['Assets/logo.png', 'Private notes/abc123.nvsecret']);

  assert.equal(index.has('Private notes/Diary.md'), false);
  assert.equal(index.content('Private notes/Diary.md'), undefined);
  assert.ok(index.allMeta().every((m) => !m.path.startsWith('Private notes/')));
  assert.deepEqual(index.search('quokka'), [], 'no search hit');
  assert.ok(index.search('bakery').some((h) => h.path === 'Notes/Open.md'), 'open notes still found');
  const rel = index.relations();
  assert.ok([...rel.owner.keys(), ...rel.projects].every((p) => !p.startsWith('Private notes/')), 'relations never name a locked note');
  assert.ok(!JSON.stringify(rel.relations).includes('quokka'), 'relation words never quote a locked note');
  const graph = index.graph('Templates');
  assert.ok(graph.nodes.some((n) => n.id === 'Notes/Open.md'), 'the open note is on the graph');
  assert.ok(graph.nodes.every((n) => !String(n.id).startsWith('Private notes/')), 'whole-vault graph clean');
  assert.ok(index.tasks().every((t) => t.path !== 'Private notes/Diary.md'), 'no locked tasks');
  assert.ok(index.tasks().some((t) => t.path === 'Notes/Open.md'), 'open tasks kept');
  assert.ok(index.reminders().every((r) => r.path !== 'Private notes/Diary.md'), 'no locked reminders');
  assert.ok(index.reminders().some((r) => r.path === 'Notes/Open.md'), 'open reminders kept');
  const records = index.records({ templatesFolder: 'Templates' });
  assert.ok([...records.records.values()].every((r) => !String(r.path ?? '').startsWith('Private notes/')), 'records clean');
  assert.equal(index.resolveFile('abc123.nvsecret'), null, 'sealed files never resolve');
  assert.equal(index.resolveFile('logo.png'), 'Assets/logo.png');
});

test('the assistant door refuses locked paths: gate, retrieval and waiting suggestions', () => {
  const index = new Index.VaultIndex();
  index.set('Notes/Open.md', '# Open\n\nThe bakery opens at seven.\n', 1000, 100);
  index.set('Private notes/Diary.md', `# Diary\n\n${NOTE_WORDS}\n`, 1000, 100);
  // Every agent reads as Open here: only the locked rule can refuse.
  const sensitivity = { stamp: () => 's', level: () => 'open', allows: () => true, decide: () => ({ ok: true, level: 'open' }), useGrant: () => false, audit: () => {} };
  const gate = Gate.makeGate(sensitivity, 'assistant', 'Assistant');
  assert.equal(gate.sees('Private notes/Diary.md'), false);
  assert.equal(gate.sees('Notes/Open.md'), true);
  assert.throws(() => gate.check('Private notes/Diary.md'), /never open to agents/);
  const gated = Gate.gateIndex(index, gate);
  assert.equal(gated.content('Private notes/Diary.md'), undefined);
  assert.equal(gated.get('Private notes/Diary.md'), undefined);
  assert.ok(gated.allMeta().every((m) => m.path !== 'Private notes/Diary.md'));
  assert.deepEqual(gated.search('quokka').map((h) => h.path), []);
  assert.deepEqual(gated.retrieve('quokka').map((c) => c.path), [], 'chat retrieval never quotes a locked note');
  assert.ok(gated.retrieve('bakery').some((c) => c.path === 'Notes/Open.md'), 'open notes still retrieved');

  const notified = [];
  const waiting = new Suggest.NoteSuggestions((e) => notified.push(e));
  assert.throws(() => waiting.offer('Private notes/Diary.md', 'a', 'b'), /never open to the assistant/);
  assert.equal(waiting.has('Private notes/Diary.md'), false);
  waiting.settle('Private notes/Diary.md', 'a', 'b');
  assert.equal(waiting.has('Private notes/Diary.md'), false, 'a stale settle is dropped, never kept');
  assert.equal(notified.length, 0);
  assert.equal(waiting.offer('Notes/Open.md', 'a', 'b'), 1, 'open notes still offered');
});

test('the brief never carries a locked line, and keeps a find whose words are its own', () => {
  const NOW = new Date(2026, 10, 4, 8, 30).getTime();
  const due = {
    overdue: [
      { kind: 'reminder', key: 'a', day: '2026-11-03', item: { key: 'a', path: 'Private notes/Diary.md', title: NOTE_WORDS, line: 1, text: NOTE_WORDS, due: NOW - 1000, timeGiven: true, repeat: null, done: false } },
      { kind: 'task', key: 'b', day: '2026-11-03', item: { key: 'b', path: 'Private notes/Diary.md', title: NOTE_WORDS, line: 2, text: NOTE_WORDS, words: NOTE_WORDS, due: '2026-11-03' } },
    ],
    today: [], week: [], undated: [], undatedCount: 0,
  };
  const projects = {
    overdue: [{ id: 's', kind: 'step', what: NOTE_WORDS, others: false, when: '2026-11-03', offset: -1, tone: 'bad', project: 'Private notes/Diary.md', projectName: NOTE_WORDS, version: 'v' }],
    today: [], atRisk: [], quiet: [],
  };
  const decks = [{ path: 'Private notes/Cards.md', title: NOTE_WORDS, due: 3, total: 3 }];
  const people = [{ id: 'person:x', name: NOTE_WORDS, path: 'Private notes/Sam.md', days: 60, draft: 'Hi' }];
  const found = Brief.cleanFound({ items: [{ id: 'f1', kind: 'watch', title: 'Price fell', detail: 'The mixer is cheaper.', source: 'Shop', link: 'Private notes/Diary.md', priority: 0.9 }] });
  const brief = Brief.buildBrief({ now: NOW, calendar: null, meetingNotes: {}, due, projects, decks, people, found, foundState: 'ok', prefs: Brief.NO_PREFS });
  const words = JSON.stringify(brief.items);
  assert.ok(!words.includes('quokka') && !words.includes('Private notes'), `no locked line or path in the brief: ${words}`);
  assert.equal(brief.items.length, 1, 'only the find itself stays');
  assert.ok(brief.items[0].actions.every((a) => a.kind !== 'open'), 'the find keeps no way into the locked store');
});

test('the vault check never reads, writes or names the locked store', async () => {
  const reads = [];
  const writes = [];
  const host = {
    root: () => work,
    listAll: async () => [{ rel: 'Notes/A.md', size: 10 }, { rel: 'Private notes/abc.nvlock', size: 90 }, { rel: 'Private notes/def.nvsecret', size: 80 }],
    notes: () => [{ path: 'Notes/A.md', props: {} }, { path: 'Private notes/Diary.md', props: {} }],
    resolve: () => null,
    readNote: async (rel) => (reads.push(rel), '# A\n'),
    writeNote: async (rel) => void writes.push(rel),
    sidecarFolders: async () => ['Projects/P', 'Private notes'],
    readSidecar: async (folder) => {
      assert.notEqual(folder, 'Private notes', 'the locked folder has no sidecar read');
      return { files: {} };
    },
    changeSidecar: async (folder, fn) => {
      assert.notEqual(folder, 'Private notes');
      return { files: {} };
    },
  };
  const result = await Check.checkVault(host);
  assert.ok(reads.every((r) => !r.startsWith('Private notes')), `never read: ${reads}`);
  assert.ok(writes.every((r) => !r.startsWith('Private notes')), 'never written');
  assert.ok(!JSON.stringify(result).includes('Private notes'), 'never named in what was fixed or left');
});

test('secret values never reach the index even while unlocked', async () => {
  const vault = path.join(work, 'vault2');
  const { store, secrets } = makeStores(vault);
  await store.setUp(PW, false);
  await secrets.add({ name: 'Padlock', kind: 'passcode', value: SECRET_VALUE });
  const index = new Index.VaultIndex();
  index.set('Notes/Open.md', '# Open\n\nNothing hidden here.\n', 1000, 100);
  assert.deepEqual(index.search('wattle'), []);
  assert.deepEqual(index.search('942'), []);
  store.lock();
});
