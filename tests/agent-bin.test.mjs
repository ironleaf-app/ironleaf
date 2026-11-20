// node --test tests/agent-bin.test.mjs — the Vault's own Bin for its assistant (5 Nov 2026). Asked to delete a note,
// the side chat said writes were disabled and the Bin tool wasn't available: neuralvault_bin exists only as a former
// host app tool, and the side chat's prompt said "when it is offered... otherwise you can't delete". Now the side
// chat has its own Bin tool (move_to_bin: move, list, restore) over the vault's own Bin (.neuralvault/bin, the same
// Bin Recently deleted shows), with Undo through the answer's changes. A real tool round through AgentTools on a temp
// vault on disk: binning a note and a folder, restoring, and Undo. And no system prompt or tool reply says read-only
// (or its cousins) except for a remote computer's files.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-bin-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport * as binStore from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};\nexport { gateNotes } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { changeWords } from ${JSON.stringify(path.join(root, 'src/shared/search-ask-87.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

/** A vault on disk (so the real Bin moves real files), indexed in memory like the app indexes it. */
function diskHost(initial) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-bin-vault-'));
  const index = new M.VaultIndex();
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const now = Date.now();
  const reindex = (rel) => {
    const f = abs(rel);
    if (existsSync(f) && /\.md$/i.test(rel)) {
      const text = readFileSync(f, 'utf8');
      index.set(rel, text, now, text.length);
    } else index.delete(rel);
  };
  for (const [rel, text] of Object.entries(initial)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), text);
    reindex(rel);
  }
  const allRels = () => {
    const out = [];
    const walk = (d, prefix) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (rel.startsWith('.neuralvault')) continue;
        if (e.isDirectory()) walk(path.join(d, e.name), rel);
        else out.push(rel);
      }
    };
    walk(dir, '');
    return out;
  };
  const bin = M.binStore.createVaultBin({ root: dir });
  // The app forgets a binned note from its index (and learns a restored one); the fake does the same, so link
  // reporting is proven against the real condition, not a stale index.
  const resync = () => {
    const onDisk = new Set(allRels());
    for (const m of index.allMeta()) if (!onDisk.has(m.path)) index.delete(m.path);
    for (const rel of onDisk) reindex(rel);
  };
  const host = {
    dir,
    index,
    listing: async () => {
      const files = allRels();
      const folders = [...new Set(files.filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))];
      return { files: files.map((rel) => ({ rel, kind: 'note' })), folders };
    },
    exists: async (rel) => existsSync(abs(rel)),
    read: async (rel) => readFileSync(abs(rel), 'utf8'),
    write: async (rel, text) => {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), text);
      reindex(rel);
    },
    makeFolder: async (rel) => mkdirSync(abs(rel), { recursive: true }),
    move: async (from, to) => {
      mkdirSync(path.dirname(abs(to)), { recursive: true });
      renameSync(abs(from), abs(to));
      reindex(from);
      reindex(to);
      return { path: to, linksUpdated: 0 };
    },
    trash: async (rel) => {
      rmSync(abs(rel), { recursive: true, force: true });
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Thursday 5 November 2026 (2026-11-05)',
    bin: {
      put: async (rel, opts) => {
        const r = await bin.put(rel, opts);
        resync();
        return r;
      },
      list: async () => bin.list(),
      restore: async (which) => {
        const r = await bin.restore(which);
        resync();
        return r;
      },
    },
  };
  return { host, dir, bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('binning a note: gone from the notes, in the Bin, links to it reported', async () => {
  const v = diskHost({ 'Notes/Old idea.md': '# Old idea\n', 'Notes/Hub.md': '# Hub\nSee [[Old idea]].\n' });
  try {
    const steps = [];
    const tools = new M.AgentTools(v.host, [], (s) => steps.push(s));
    const r = await run(tools, 'move_to_bin', { action: 'move', items: ['Old idea'], why: 'no longer needed' });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /Old idea/, 'names what went');
    assert.match(r.text, /30 days/, 'says it can come back');
    assert.ok(!existsSync(path.join(v.dir, 'Notes', 'Old idea.md')), 'the note is gone from the notes');
    assert.ok(existsSync(path.join(v.dir, '.neuralvault', 'bin')), 'the vault’s own Bin holds it');
    assert.match(r.text, /Hub/, 'notes left linking to it are reported');
    assert.ok(steps.some((s) => s.kind === 'write' && /Bin/.test(s.words)), 'a step says it went to the Bin');
    assert.equal(tools.changes.length, 1);
    assert.equal(tools.changes[0].kind, 'binned');
  } finally {
    v.cleanup();
  }
});

test('binning several notes and a whole folder with everything in it', async () => {
  const v = diskHost({
    'Notes/One.md': '# One\n',
    'Notes/Two.md': '# Two\n',
    'Projects/Acme/Plan.md': '# Plan\n',
    'Projects/Acme/Board.canvas': '{}',
    'Projects/Acme/files/quote.pdf': '%pdf',
    'Projects/Acme/deep/Nested.md': '# Nested\n',
    'Projects/Keep.md': '# Keep\n',
  });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const r = await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/One.md', 'Notes/Two.md', 'Projects/Acme'] });
    assert.equal(r.isError, undefined, r.text);
    for (const rel of ['Notes/One.md', 'Notes/Two.md', 'Projects/Acme/Plan.md', 'Projects/Acme/Board.canvas', 'Projects/Acme/files/quote.pdf', 'Projects/Acme/deep/Nested.md'])
      assert.ok(!existsSync(path.join(v.dir, ...rel.split('/'))), `${rel} went with it`);
    assert.ok(existsSync(path.join(v.dir, 'Projects', 'Keep.md')), 'what was not named stays');
    const list = await run(tools, 'move_to_bin', { action: 'list' });
    assert.match(list.text, /One/, 'list names them');
    assert.match(list.text, /Acme/, 'the folder lists as one item');
    assert.match(list.text, /30 days|days left/, 'the Bin says how long they can come back');
  } finally {
    v.cleanup();
  }
});

test('restoring brings it back where it was, links working again', async () => {
  const v = diskHost({ 'Notes/Old idea.md': '# Old idea\nThe words.\n', 'Notes/Hub.md': '# Hub\nSee [[Old idea]].\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/Old idea.md'] });
    const r = await run(tools, 'move_to_bin', { action: 'restore', item: 'Old idea' });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /Restored/, 'says it is back');
    assert.equal(readFileSync(path.join(v.dir, 'Notes', 'Old idea.md'), 'utf8'), '# Old idea\nThe words.\n', 'back word for word');
    assert.match(readFileSync(path.join(v.dir, 'Notes', 'Hub.md'), 'utf8'), /\[\[Old idea\]\]/, 'the link works again');
  } finally {
    v.cleanup();
  }
});

test('a folder binned or restored says its name and how many notes went with it', async () => {
  const v = diskHost({ 'Receipts/Jan.md': '# Jan\n', 'Receipts/Feb.md': '# Feb\n', 'Receipts/scan.pdf': '%pdf' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const r = await run(tools, 'move_to_bin', { action: 'move', items: ['Receipts'] });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /Receipts/, 'names the folder');
    assert.match(r.text, /2 notes/, 'says how many notes went with it');
    const summary = M.summarise('t1', tools.changes);
    assert.match(M.changeWords(summary), /Receipts/, 'the card names the folder, not “1 note”');
    assert.match(M.changeWords(summary), /2 notes/, 'the card says how many notes went with it');
    const back = await run(tools, 'move_to_bin', { action: 'restore', item: 'Receipts' });
    assert.equal(back.isError, undefined, back.text);
    assert.match(back.text, /Receipts/, 'restoring names the folder');
    assert.match(back.text, /2 notes/, 'restoring says how many notes came back with it');
    const summary2 = M.summarise('t2', tools.changes.slice(1));
    assert.match(M.changeWords(summary2), /Receipts/, 'the restored card names the folder, not “Changed 1 note”');
  } finally {
    v.cleanup();
  }
});

test('Undo puts binned notes back, and says so on the card', async () => {
  const v = diskHost({ 'Notes/One.md': '# One\n', 'Notes/Two.md': '# Two\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/One.md', 'Notes/Two.md'] });
    const summary = M.summarise('t1', tools.changes);
    assert.equal(summary.binned, 2, 'the card counts what went to the Bin');
    assert.match(M.changeWords(summary), /Bin/, 'the card says it in words');
    const words = await M.undoChanges(v.host, tools.changes);
    assert.match(words, /Undone: 2 changes/);
    assert.ok(existsSync(path.join(v.dir, 'Notes', 'One.md')) && existsSync(path.join(v.dir, 'Notes', 'Two.md')), 'both are back');
  } finally {
    v.cleanup();
  }
});

test('the Bin refuses what it must: the vault’s own folders, outside paths, nothing there', async () => {
  const v = diskHost({ 'Projects/Keep.md': '# Keep\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    assert.equal((await run(tools, 'move_to_bin', { action: 'move', items: ['Projects'] })).isError, true, 'a vault folder goes item by item, never whole');
    assert.equal((await run(tools, 'move_to_bin', { action: 'move', items: ['../outside.md'] })).isError, true, 'outside the vault is refused');
    assert.equal((await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/Missing.md'] })).isError, true, 'nothing there is said');
    assert.equal((await run(tools, 'move_to_bin', { action: 'restore', item: 'Nothing binned' })).isError, true, 'restoring what is not there is said');
    assert.match((await run(tools, 'move_to_bin', { action: 'list' })).text, /empty/, 'an empty Bin says so');
  } finally {
    v.cleanup();
  }
});

test('a note’s own files go with it and come back with it', async () => {
  const v = diskHost({ 'Meetings/Kick-off.md': '# Kick-off\n', 'Meetings/Files/Kick-off/plan.pdf': '%pdf' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const put = await run(tools, 'move_to_bin', { action: 'move', items: ['Meetings/Kick-off.md'] });
    assert.equal(put.isError, undefined, put.text);
    assert.ok(!existsSync(path.join(v.dir, 'Meetings', 'Files', 'Kick-off', 'plan.pdf')), 'its files went with it');
    const back = await run(tools, 'move_to_bin', { action: 'restore', item: 'Kick-off' });
    assert.equal(back.isError, undefined, back.text);
    assert.ok(existsSync(path.join(v.dir, 'Meetings', 'Files', 'Kick-off', 'plan.pdf')), 'its files came back with it');
  } finally {
    v.cleanup();
  }
});

test('a note with no Files folder is never said to have left files behind', async () => {
  const v = diskHost({ 'Notes/Plain.md': '# Plain\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const put = await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/Plain.md'] });
    assert.equal(put.isError, undefined, put.text);
    assert.doesNotMatch(put.text, /files stayed|could not move/i, put.text);
    const back = await run(tools, 'move_to_bin', { action: 'restore', item: 'Plain' });
    assert.doesNotMatch(back.text, /files|Bin.s storage/i, back.text);
  } finally {
    v.cleanup();
  }
});

test('what is past 30 days leaves the Bin by itself', async () => {
  const v = diskHost({ 'Notes/Old.md': '# Old\n' });
  try {
    await v.bin.put('Notes/Old.md', { by: 'test' });
    const items = await v.bin.list();
    assert.equal(items.length, 1);
    const old = M.binStore.createVaultBin({ root: v.dir, now: () => Date.now() + 31 * 86400000 });
    assert.deepEqual(await old.list(), [], 'listing past 30 days empties it');
    assert.ok(!existsSync(path.join(v.dir, 'Notes', 'Old.md')), 'it does not come back by itself');
  } finally {
    v.cleanup();
  }
});

// ── Never read-only ──

const FORBIDDEN = ['read-only', 'read only', 'writes are disabled', 'in this session', 'when you are in Ironleaf', "otherwise you can't", 'when it is offered'];
/** Lines the model reads that may not carry a refusal: the prompt, every tool's words, and live tool replies. */
function modelTexts() {
  const out = [];
  out.push(['prompt', M.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', 'Hub', [])]);
  out.push(['prompt with folders and memory', M.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', null, ['C:\\Work'], 'The open note is the project file of “Acme”.', '', 'They like oat milk.')]);
  for (const t of [...M.TOOLS, ...M.MEMORY_TOOLS, ...M.WEB_TOOLS]) {
    out.push([`tool ${t.name}`, `${t.name}\n${t.description}\n${JSON.stringify(t.parameters ?? {})}`]);
  }
  return out;
}

test('no system prompt or tool words say read-only or its cousins, except a remote computer’s files', () => {
  for (const [where, text] of modelTexts()) {
    for (const line of String(text).split('\n')) {
      for (const phrase of FORBIDDEN) {
        if (!line.toLowerCase().includes(phrase)) continue;
        assert.ok(/remote computer/i.test(line), `${where} invites refusal: “${line.slice(0, 160)}”`);
      }
    }
  }
  const prompt = M.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', null, []);
  assert.match(prompt, /move_to_bin/, 'the prompt names the Bin tool it always has');
  assert.match(prompt, /only when the person asks/i, 'binning stays only when asked');
  assert.match(prompt, /your tools write as well as read/i, 'the prompt says its tools write too');
  assert.match(prompt, /never claim you cannot write/i, 'the prompt forbids the read-only claim outright');
});

test('live tool replies never say read-only either', async () => {
  const v = diskHost({ 'Notes/One.md': '# One\n- [ ] Call Priya\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const replies = [
      (await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/Missing.md'] })).text,
      (await run(tools, 'move_to_bin', { action: 'restore', item: 'nothing' })).text,
      (await run(tools, 'move_to_bin', { action: 'list' })).text,
      (await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/One.md'] })).text,
      (await run(tools, 'move_to_bin', { action: 'restore', item: 'One' })).text,
    ];
    for (const text of replies) {
      for (const line of String(text).split('\n')) {
        for (const phrase of FORBIDDEN) {
          if (!line.toLowerCase().includes(phrase)) continue;
          assert.ok(/remote computer/i.test(line), `a tool reply invites refusal: “${line.slice(0, 160)}”`);
        }
      }
    }
  } finally {
    v.cleanup();
  }
});

test('the gate holds the Bin like every other write', async () => {
  const v = diskHost({ 'Secret/Plan.md': '# Plan\n', 'Notes/Open.md': '# Open\n' });
  try {
    // Someone limited the side chat in Settings › Privacy: Secret/ is not its to change.
    const gate = {
      who: 'side-chat',
      name: 'The side chat',
      key: () => 'k',
      level: () => 'open',
      sees: (p) => !String(p).startsWith('Secret/'),
      allowsLevel: () => true,
      check: (rel, action) => {
        if (String(rel).startsWith('Secret/')) throw new Error('That is marked Family-private and The side chat isn’t allowed Family-private items (the person sets this in Ironleaf › Settings › Privacy and secrets).');
      },
      note: () => {},
      listed: () => {},
    };
    const tools = new M.AgentTools(M.gateNotes(v.host, gate), [], () => {});
    const refused = await run(tools, 'move_to_bin', { action: 'move', items: ['Secret/Plan.md'] });
    assert.equal(refused.isError, true, 'a note it may not change is refused');
    assert.match(refused.text, /Privacy and secrets/, 'the refusal says the limit and where to change it');
    assert.ok(existsSync(path.join(v.dir, 'Secret', 'Plan.md')), 'nothing moved');
    const ok = await run(tools, 'move_to_bin', { action: 'move', items: ['Notes/Open.md'] });
    assert.equal(ok.isError, undefined, ok.text);
    // Binned before the limit (or by the person): the list hides it, and restoring it refuses.
    await v.host.bin.put('Secret/Plan.md', { by: 'You' });
    const gated = M.gateNotes(v.host, gate);
    const list = await gated.bin.list();
    assert.ok(list.length && list.every((it) => !it.path.startsWith('Secret/')), 'the Bin list shows only what it may read');
    await assert.rejects(() => gated.bin.restore('Secret/Plan.md'), /Privacy and secrets/, 'restoring what it may not change refuses');
  } finally {
    v.cleanup();
  }
});
