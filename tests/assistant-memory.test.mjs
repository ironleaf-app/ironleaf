// node --test tests/assistant-memory.test.mjs — the assistant remembers the person (5 Nov 2026,
// v8-vault-assistant: the audit found it starts every chat a stranger). Stated facts and preferences persist across
// chats in Ironleaf's own data (never the notes) through the model's own remember/forget tools — the model
// interprets what is lasting, nothing gates on the person's words — and what it knows is recalled into every answer's
// instructions, tools path and plain path alike. Made-up facts only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-assistant-memory-'));
let M;
let A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/assistant-memory.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  const aentry = path.join(work, 'agent.ts');
  writeFileSync(aentry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: aentry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  A = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Notes in memory with a memory store beside them, as the app wires it. */
function fakeHost(notes, mem = { facts: [] }) {
  const index = new A.VaultIndex();
  const files = new Map(Object.entries(notes));
  const now = Date.now();
  for (const [rel, text] of files) index.set(rel, text, now, text.length);
  const memory = {
    facts: () => mem.facts.map((f) => ({ ...f })),
    remember: (fact) => {
      const r = M.rememberFact(mem, fact, '2026-11-05');
      mem = r.mem;
      return { kept: r.kept, words: r.words };
    },
    forget: (topic) => {
      const r = M.forgetFact(mem, topic);
      mem = r.mem;
      return { forgot: r.forgot, words: r.words };
    },
  };
  const host = {
    index,
    memory,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    write: async (rel, text) => {
      files.set(rel, text);
      index.set(rel, text, Date.now(), text.length);
    },
    makeFolder: async () => {},
    move: async (from, to) => ({ path: to, linksUpdated: 0 }),
    trash: async (rel) => {
      files.delete(rel);
    },
    clean: (rel) => rel,
    today: () => 'Thursday 5 November 2026 (2026-11-05)',
  };
  return { host, files, mem: () => mem };
}
const run = async (tools, name, args) => (await tools.run({ id: 'c', name, arguments: JSON.stringify(args) })).text;

// ── The store: keep, replace, forget ──────────────────────────────────────────

test('remembering keeps a fact; the same fact twice keeps once', () => {
  const first = M.rememberFact({ facts: [] }, '  Prefers oat milk in coffee. ', '2026-11-05');
  assert.equal(first.kept, true);
  assert.deepEqual(first.mem.facts, [{ fact: 'Prefers oat milk in coffee.', updated: '2026-11-05' }]);
  const twice = M.rememberFact(first.mem, 'prefers oat milk in coffee', '2026-11-06');
  assert.equal(twice.kept, true);
  assert.equal(twice.mem.facts.length, 1, 'said again, kept once');
  assert.match(twice.words, /already know/i);
});

test('a fact restated replaces the old line instead of doubling it', () => {
  const mem = { facts: [{ fact: 'Allergic to peanuts.', updated: '2026-11-01' }] };
  const r = M.rememberFact(mem, 'Allergic to peanuts and sesame.', '2026-11-05');
  assert.equal(r.kept, true);
  assert.equal(r.mem.facts.length, 1);
  assert.equal(r.mem.facts[0].fact, 'Allergic to peanuts and sesame.');
  assert.match(r.words, /updated/i);
});

test('a full memory refuses with the oldest named, never drops one silently', () => {
  const facts = Array.from({ length: M.MEMORY_CAP }, (_, i) => ({ fact: `Fact number ${i + 1} about them.`, updated: '2026-11-05' }));
  const r = M.rememberFact({ facts }, 'One fact too many.', '2026-11-05');
  assert.equal(r.kept, false);
  assert.match(r.words, /Fact number 1/, 'the oldest is named so the person can choose');
  assert.match(r.words, /forget/i);
});

test('forgetting drops what the topic names and says what went', () => {
  const mem = { facts: [{ fact: 'Prefers oat milk in coffee.', updated: '2026-11-05' }, { fact: 'Daughter Maya plays netball on Saturdays.', updated: '2026-11-05' }] };
  const r = M.forgetFact(mem, 'oat milk');
  assert.deepEqual(r.forgot, ['Prefers oat milk in coffee.']);
  assert.equal(r.mem.facts.length, 1);
  const none = M.forgetFact(r.mem, 'sailing');
  assert.deepEqual(none.forgot, []);
  assert.match(none.words, /nothing/i);
});

test('junk is refused with plain words: empty, a question, a wall of text', () => {
  assert.equal(M.rememberFact({ facts: [] }, '   ', '2026-11-05').kept, false);
  assert.equal(M.rememberFact({ facts: [] }, 'What time is it?', '2026-11-05').kept, false);
  const wall = M.rememberFact({ facts: [] }, `${'word '.repeat(100)}end.`, '2026-11-05');
  assert.equal(wall.kept, true, 'a long fact is trimmed, not lost');
  assert.ok(wall.mem.facts[0].fact.length <= 220, 'capped in length');
});

// ── Recall: every answer knows them ───────────────────────────────────────────

test('recalled facts read as a block for the instructions, empty when none', () => {
  assert.equal(M.memoryWords({ facts: [] }), '');
  const words = M.memoryWords({ facts: [{ fact: 'Prefers oat milk in coffee.', updated: '2026-11-05' }] });
  assert.ok(words.includes('Prefers oat milk in coffee.'), 'the fact is there');
  assert.ok(/use (them|it) naturally|naturally/i.test(words), 'used, never recited');
  assert.ok(/never (read|recite|list)/i.test(words), 'the list itself is never the answer');
});

test('the tools prompt carries what it knows when there is something to know', () => {
  const bare = A.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', null, []);
  assert.doesNotMatch(bare, /already know about them/, 'no block when the memory is empty');
  const block = M.memoryWords({ facts: [{ fact: 'Prefers oat milk in coffee.', updated: '2026-11-05' }] });
  const full = A.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', null, [], '', '', block);
  assert.ok(full.includes('Prefers oat milk in coffee.'), 'the fact reaches the instructions');
  // The model is told when to remember and when to forget (it interprets; nothing gates on words).
  assert.ok(/remember/i.test(full) && /forget/i.test(full), 'remember and forget are briefed');
});

// ── The tools: the model decides what lasts ───────────────────────────────────

test('remember and forget are offered only where a memory is wired (like the web tools)', () => {
  assert.ok(!A.TOOLS.some((t) => t.name === 'remember' || t.name === 'forget'), 'never in the core list');
  assert.deepEqual(A.MEMORY_TOOLS.map((t) => t.name).sort(), ['forget', 'remember']);
});

test('remembering through the tool stores for the next chat; forgetting drops', async () => {
  const { host, mem } = fakeHost({ 'Home.md': 'hi' });
  const tools = new A.AgentTools(host, [], () => {});
  const kept = await run(tools, 'remember', { fact: 'Prefers oat milk in coffee' });
  assert.match(kept, /kept|remember/i);
  assert.equal(mem().facts.length, 1);
  assert.equal(mem().facts[0].fact, 'Prefers oat milk in coffee.');
  // Recalled next chat: the stored facts brief the instructions.
  const words = M.memoryWords({ facts: host.memory.facts() });
  assert.ok(words.includes('oat milk'));
  const dropped = await run(tools, 'forget', { topic: 'oat milk' });
  assert.match(dropped, /forgot/i);
  assert.equal(mem().facts.length, 0);
});

test('with no memory wired the tools say so plainly instead of failing', async () => {
  const { host } = fakeHost({ 'Home.md': 'hi' });
  delete host.memory;
  const tools = new A.AgentTools(host, [], () => {});
  assert.match(await run(tools, 'remember', { fact: 'Prefers oat milk.' }), /can.t keep/i);
  assert.match(await run(tools, 'forget', { topic: 'oat milk' }), /can.t keep|nothing/i);
});
