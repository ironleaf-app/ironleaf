// node --test tests/meaning-embed.test.mjs — real find-by-meaning (10.0 Wave 2, 2 Nov 2026, still on this PC only).
// The on-device model (resources/models/all-MiniLM-L6-v2) behind the same seam as the hashed fallback
// (tests/meaning.test.mjs): the WordPiece tokenizer, chunking, embeddings cached per note, the background build, the
// fallback when the model cannot load, and the shipped runner files. Reuse (10.0 m10reuse): the weekly tidy's
// near-duplicates by meaning, sender-to-customer matching through the former host app's real sender code, and the
// one embedding service (caps, refusals, off words). Made-up notes in temporary folders, never a real vault; nothing
// leaves this PC (fetch is broken in the fallback test to prove it).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meaning-embed-'));
const modelDir = path.join(root, 'resources', 'models', 'all-MiniLM-L6-v2');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let M;
let ort;
let ship;
let emb;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-tokenizer.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-embed.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-build.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport * as W from ${JSON.stringify(path.join(root, 'src/shared/weekly-tidy.ts'))};\nexport * as MS from ${JSON.stringify(path.join(root, 'src/main/meaning-service.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  ort = await import(pathToFileURL(path.join(ortDist, 'ort.node.min.mjs')).href);
  ship = await import(pathToFileURL(path.join(root, 'tools', 'ort-ship.mjs')).href);
  emb = new M.MeaningEmbedder({ modelDir, factory: M.ortSessionFactory(ort, ortDist), threads: 1 });
  const started = await emb.start();
  assert.equal(started.ok, true, 'the on-device model starts in the test');
}, { timeout: 180000 });
after(async () => {
  await emb?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
const QUERY = 'the supplier who kept missing delivery dates';
// The job's example: none of the query's words appear here (TechParts/keep/shipping/late vs the/supplier/who/kept/missing/delivery/dates).
const VENDOR = 'Notes/TechParts.md';
const VENDOR_TEXT = '# TechParts\nKeep shipping late.';
const CAKE = 'Notes/Cake.md';
const CAKE_TEXT = '# Cake\nFlour, sugar, butter, bake at 180.';
const ROSTER = 'Notes/Roster.md';
const ROSTER_TEXT = '# Roster\nDiscussed the weekend roster with the team.';
const DEADLINE = 'Notes/Deadline miss.md';
const DEADLINE_TEXT = '# Deadline miss\nThe provider missed the consignment deadline. Overdue, waiting on the booking.';

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** A VaultIndex with the fixtures, attached to a builder over `dir`, built to idle. */
async function built(dir, extra = []) {
  const index = new M.VaultIndex();
  index.set(VENDOR, VENDOR_TEXT, NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  index.set(ROSTER, ROSTER_TEXT, NOW, 10);
  index.set(DEADLINE, DEADLINE_TEXT, NOW, 10);
  for (const [p, text] of extra) index.set(p, text, NOW, 10);
  const builder = new M.MeaningBuilder({
    dir,
    embedder: emb,
    index: index.meanings(),
    list: () => index.allMeta().map((m) => m.path),
    read: (p) => {
      const meta = index.get(p);
      const content = index.content(p);
      return meta && content !== undefined ? { title: meta.label, content } : null;
    },
    isExcluded: (p) => index.isExcluded(p),
  });
  index.attachMeaning(builder);
  await builder.start();
  await builder.idle();
  await builder.flush();
  return { index, builder };
}

test('the tokenizer reads the model’s own words file: known ids, lower-case, punctuation split, capped', () => {
  const tok = M.loadTokenizer(modelDir);
  assert.equal(tok.vocab.get('supplier'), 17024);
  assert.equal(tok.vocab.get('ship'), 2911);
  assert.equal(tok.vocab.get('##ping'), 4691);
  assert.deepEqual(M.wordPieces(tok, 'shipping'), ['shipping'], 'a known word stays whole');
  assert.deepEqual(M.encodeText(tok, 'Supplier'), M.encodeText(tok, 'supplier'), 'upper case reads as lower');
  const punct = M.encodeText(tok, 'hello, world');
  assert.ok(punct.includes(tok.vocab.get('hello')), 'words around punctuation');
  assert.ok(punct.includes(tok.vocab.get(',')), 'the comma its own token');
  assert.deepEqual(M.wordPieces(tok, 'w'.repeat(101)), ['[UNK]'], 'past 100 characters reads as unknown');
  assert.deepEqual(M.encodeText(tok, '🎂 cake').slice(0, 2), [tok.clsId, tok.unkId], 'no word for it reads as unknown');
  const ids = M.encodeText(tok, 'TechParts keep shipping late');
  assert.equal(ids[0], 101, 'wrapped in [CLS]');
  assert.equal(ids[ids.length - 1], 102, 'wrapped in [SEP]');
  assert.equal(ids.length, 7, 'TechParts/keep/shipping/late plus the wrap');
  const long = M.encodeText(tok, 'supplier '.repeat(500));
  assert.equal(long.length, 256, 'cut to 256 tokens');
  assert.equal(long[long.length - 1], 102, 'still wrapped after the cut');
  assert.throws(() => M.loadTokenizer(path.join(work, 'nowhere')), /missing/, 'a missing words file says so');
});

test('long notes split by heading and paragraph, small ones stay whole, at most eight pieces', () => {
  assert.deepEqual(M.chunkNote(''), [], 'nothing in, nothing out');
  assert.deepEqual(M.chunkNote(VENDOR_TEXT), [VENDOR_TEXT], 'a short note is the one piece it is');
  const headed = ['# Alpha', 'first lines.', '', '# Beta', 'second lines.', '', '# Gamma', 'third lines.'].join('\n');
  const chunks = M.chunkNote(headed);
  assert.equal(chunks.length, 3, 'a piece per heading');
  assert.ok(chunks.every((c, i) => c.startsWith(['# Alpha', '# Beta', '# Gamma'][i])), 'each heading stays with what it heads');
  assert.deepEqual(M.chunkNote('one short line.\n\nanother short line.'), ['one short line.\n\nanother short line.'], 'small paragraphs join up');
  const many = Array.from({ length: 20 }, (_, i) => `# Part ${i}\nwords here.`).join('\n\n');
  assert.equal(M.chunkNote(many).length, 8, 'capped at eight pieces, the opening first');
  assert.ok(M.chunkNote(many)[0].startsWith('# Part 0'), 'the opening is kept');
});

test('the model embeds: 384-wide unit vectors, deterministic, threads tried then single when unsafe', async () => {
  const [a, b] = await emb.embed(['TechParts keep shipping late', 'TechParts keep shipping late']);
  assert.equal(a.length, 384, 'the taught width');
  assert.ok(Math.abs(Math.sqrt(a.reduce((s, x) => s + x * x, 0)) - 1) < 1e-4, 'L2 normalised');
  assert.deepEqual(a, b, 'the same words embed the same');
  assert.equal(emb.threadsUsed, 1, 'the asked threads');
  // Threads off unless safe: a runner that fails threaded still starts single-threaded.
  let threadsSeen = [];
  const flaky = new M.MeaningEmbedder({
    modelDir,
    factory: async (modelPath, threads) => {
      threadsSeen.push(threads);
      if (threads > 1) throw new Error('no threads here');
      return { run: async () => ({ data: new Float32Array(384).fill(1), dim: 384 }), close: async () => {} };
    },
  });
  assert.deepEqual(await flaky.start(), { ok: true });
  const want = cpus().length > 1 ? Math.min(4, cpus().length) : 1;
  assert.deepEqual(threadsSeen, want > 1 ? [want, 1] : [1], 'threaded tried first, single when threads fail');
  assert.equal(flaky.threadsUsed, 1, 'then single when threads fail');
  const dead = new M.MeaningEmbedder({ modelDir, factory: async () => { throw new Error('no runner'); } });
  assert.match((await dead.start()).words, /would not start/, 'plain words when nothing runs');
});

test('the supplier who kept missing delivery dates finds TechParts, labelled Similar meaning, from embeddings', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const { index, builder } = await built(dir);
    try {
      assert.equal(index.meanings().hasTermVectors(), false, 'every note embedded: only embeddings can answer');
      assert.equal(builder.status().mode, 'ready', 'the build finished');
      const hits = await index.searchAsync(QUERY);
      assert.ok(hits.length >= 1, 'a paraphrase with no shared words still finds the note');
      assert.equal(hits[0].path, VENDOR);
      assert.equal(hits[0].meaning, true, 'labelled as meaning, not words');
      assert.equal(hits[0].matches, 0, 'no word matches to count');
      assert.ok(hits[0].snippets.length >= 1, 'a preview line to read');
      assert.ok(hits[0].score >= M.EMBED_SEARCH_MIN && hits[0].score < 0.9, `an embedding score, not a hashed one (${hits[0].score})`);
      assert.ok(!hits.some((h) => h.path === CAKE), 'the cake recipe stays out');
      assert.ok(!hits.some((h) => h.path === ROSTER), 'the roster stays out');
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a note with the exact words still comes first, the embedding paraphrase after it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const { index, builder } = await built(dir, [['Notes/Supplier report.md', '# Supplier report\nThe supplier who kept missing delivery dates called today. Mia will ring them back.']]);
    try {
      const hits = await index.searchAsync(QUERY);
      assert.equal(hits[0].path, 'Notes/Supplier report.md', 'the word-identical note first');
      assert.ok(!hits[0].meaning, 'a word match carries no meaning label');
      const paraphrase = hits.find((h) => h.path === VENDOR);
      assert.ok(paraphrase && paraphrase.meaning, 'the paraphrase follows, labelled');
      assert.ok(hits.indexOf(hits[0]) < hits.indexOf(paraphrase), 'words outrank the embedding paraphrase');
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('related notes share embedding meaning with no shared words, through the same vectors seam', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const vendor = 'Notes/Vendor review.md';
    const { index, builder } = await built(dir, [[vendor, '# Vendor review\nThird shipment slipped again. Stock arrived late twice, always behind schedule.']]);
    try {
      assert.equal(index.meanings().hasTermVectors(), false, 'related answers from embeddings too');
      const list = index.relatedNotes(vendor);
      const hit = list.find((r) => r.path === DEADLINE);
      assert.ok(hit, 'shared meaning relates them though no content word matches');
      assert.ok(hit.kinds.includes('meaning'), 'the meaning kind is named');
      assert.ok(hit.reasons.includes('Similar meaning'), 'the label the person sees');
      assert.ok(!list.some((r) => r.path === CAKE), 'the cake recipe stays out');
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the weekly tidy finds near-duplicate notes by meaning, each pair shown with why', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const index = new M.VaultIndex();
    const line = 'The hall committee agreed the roster and the paint colours for spring. ';
    index.set('Notes/Hall notes.md', `# Hall notes\n\n${line.repeat(6)}`, NOW, 10);
    index.set('Notes/Hall jottings.md', `# Hall jottings\n\n${line.repeat(6)}Tea after.\n`, NOW, 10);
    index.set('Notes/Hall roster.md', `# Hall roster\n\n${'The weekend roster for the front desk is pinned by the door. Mia covers Saturdays and Priya covers Sundays. '.repeat(4)}`, NOW, 10);
    index.set(CAKE, CAKE_TEXT, NOW, 10);
    const builder = new M.MeaningBuilder({
      dir,
      embedder: emb,
      index: index.meanings(),
      list: () => index.allMeta().map((m) => m.path),
      read: (p) => {
        const meta = index.get(p);
        const content = index.content(p);
        return meta && content !== undefined ? { title: meta.label, content } : null;
      },
      isExcluded: (p) => index.isExcluded(p),
    });
    index.attachMeaning(builder);
    await builder.start();
    await builder.idle();
    try {
      assert.equal(index.meanings().hasTermVectors(), false, 'the meaning pass reads embeddings');
      const notes = index.allMeta().map((m) => ({ path: m.path, title: m.label, content: index.content(m.path), mtime: NOW }));
      const items = M.W.planWeeklyTidy({ notes, resolve: () => null, now: NOW, vectors: (p) => index.meanings().vectors(p) });
      const dup = items.filter((i) => i.kind === 'duplicate');
      assert.equal(dup.length, 1, 'the near-identical pair under different names, and only it');
      assert.match(dup[0].detail, /They say nearly the same thing\./, 'each pair shown with why');
      assert.ok(dup[0].paths.includes('Notes/Hall notes.md') && dup[0].paths.includes('Notes/Hall jottings.md'));
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when the model is off, the tidy still proposes by name and body, never by hashed meaning', () => {
  const index = new M.VaultIndex();
  index.set('Notes/Shopping list.md', `# Shopping list\n\n${'Milk, flour, eggs. '.repeat(30)}`, NOW, 10);
  index.set('Notes/Shopping  list.md', `# Shopping list\n\n${'Milk, flour, eggs, butter. '.repeat(30)}`, NOW, 10);
  assert.equal((index.meanings().vectors('Notes/Shopping list.md') ?? []).length, 128, 'hashed vectors present, as without the model');
  const notes = index.allMeta().map((m) => ({ path: m.path, title: m.label, content: index.content(m.path), mtime: NOW }));
  const items = M.W.planWeeklyTidy({ notes, resolve: () => null, now: NOW, vectors: (p) => index.meanings().vectors(p) });
  const dup = items.filter((i) => i.kind === 'duplicate');
  assert.equal(dup.length, 1, 'the name pair only: hashed vectors sit the meaning pass out');
  assert.ok(!dup[0].detail.includes('nearly the same thing'), 'no meaning line without the model');
});

// The former host app's checkout beside this one: NS_REPO when set, else a job's ns/ beside nv/, else the dev
// checkout. The test says it skipped when none is here (Ironleaf on its own); it never passes without running.
const NS_SENDER = [process.env.NS_REPO, path.join(root, '..', 'ns')]
  .filter(Boolean).map((d) => path.join(d, 'native-runtime', 'plugins', 'desktop', 'vault-meaning.mjs')).find((f) => existsSync(f));
test('an email from accounts@harbourbakery matches the customer Harbour Bakery, by meaning', { skip: NS_SENDER ? false : 'the host app is not checked out beside Ironleaf' }, async () => {
  // Through the former host app's real sender code (native-runtime/plugins/desktop/vault-meaning.mjs):
  // the joined domain splits against the known names, then the on-device model scores it.
  const VM = await import(pathToFileURL(NS_SENDER).href);
  const clients = [{ name: 'Harbour Bakery' }, { name: 'Harbour Boats' }, { name: 'Mereana Baker' }];
  const vocab = VM.vocabOf(clients);
  const sender = VM.senderText('accounts@harbourbakery', vocab);
  assert.equal(sender, 'accounts harbour bakery', 'the joined domain splits against the known names');
  const [sv, ...cands] = await emb.embed([sender, ...clients.map((c) => VM.nameText(c.name))]);
  const hit = VM.bestMatch(sv, cands);
  assert.ok(hit && hit.index === 0, `matches Harbour Bakery, not Harbour Boats (${cands.map((v) => VM.cosine(sv, v).toFixed(3)).join(', ')})`);
  assert.ok(hit.score >= VM.MATCH_MIN, `above the bar (${hit.score.toFixed(3)})`);
  // A first name alone matches its person (the word matcher misses this); the unrelated match nothing.
  const [mv, ...mcands] = await emb.embed([VM.senderText('Mereana <mereana@example.com>', vocab), ...clients.map((c) => VM.nameText(c.name))]);
  const mhit = VM.bestMatch(mv, mcands);
  assert.ok(mhit && mhit.index === 2, `a first name alone matches its person (${mcands.map((v) => VM.cosine(mv, v).toFixed(3)).join(', ')})`);
  for (const from of ['Priya Nair <priya@example.com>', 'Harbour Supplies <orders@example.com>']) {
    const [uv, ...ucands] = await emb.embed([VM.senderText(from, vocab), ...clients.map((c) => VM.nameText(c.name))]);
    assert.equal(VM.bestMatch(uv, ucands), null, `no suggestion for ${from}: a supplier sharing Harbour must not attach`);
  }
  // A person and their own bakery close together: ambiguous, so silence, never a guess.
  const [av, ...acands] = await emb.embed([VM.senderText('Mereana Baker <mereana@harbourbakery.example>', vocab), ...clients.map((c) => VM.nameText(c.name))]);
  assert.equal(VM.bestMatch(av, acands), null, 'ambiguous between the person and their bakery: no suggestion');
  // Subjects: a bare first name matches, a receipt line matches nothing.
  const [sv2, ...scands] = await emb.embed([VM.subjectText('Mereana', vocab), ...clients.map((c) => VM.nameText(c.name))]);
  assert.equal(VM.bestMatch(sv2, scands)?.index, 2, 'a first-name subject matches its person');
  const [rv, ...rcands] = await emb.embed([VM.subjectText('Receipt for order 881', vocab), ...clients.map((c) => VM.nameText(c.name))]);
  assert.equal(VM.bestMatch(rv, rcands), null, 'a receipt subject matches nothing');
});

test('the embedding service caps texts, refuses note bodies, and says when off', async () => {
  assert.deepEqual(M.MS.cleanEmbedTexts('nope'), { words: 'Give one or more short texts to embed.' });
  assert.deepEqual(M.MS.cleanEmbedTexts([]), { words: 'Give one or more short texts to embed.' });
  assert.deepEqual(M.MS.cleanEmbedTexts(Array(21).fill('x')), { words: 'Embed at most 20 short texts at once.' });
  assert.deepEqual(M.MS.cleanEmbedTexts(['x'.repeat(501)]), { words: 'Each text must be short: at most 500 characters.' });
  assert.deepEqual(M.MS.cleanEmbedTexts(['  ']), { words: 'Each text must hold some words.' });
  assert.deepEqual(M.MS.cleanEmbedTexts([' a ', 'b']), { texts: ['a', 'b'] }, 'trimmed, kept');
  const real = { embed: async (t) => (await emb.embed([t]))[0] };
  const r = await M.MS.embedShortTexts(real, ['Harbour Bakery', 'harbour boats']);
  assert.equal(r.ok, true);
  assert.equal(r.vectors.length, 2);
  assert.ok(r.vectors.every((v) => v.length === 384), 'the taught width');
  const off = await M.MS.embedShortTexts(null, ['Harbour Bakery'], 'Meaning search is off on this PC: the meaning model is missing from this install.');
  assert.deepEqual(off, { ok: false, words: 'Meaning search is off on this PC: the meaning model is missing from this install.' });
  assert.ok(!/—/.test(off.words) && !/deepseek|pi-ai/i.test(off.words), 'plain words when off');
  // Refusals never reach the model.
  let asked = 0;
  const counting = {
    embed: async (t) => {
      asked++;
      return (await emb.embed([t]))[0];
    },
  };
  assert.equal((await M.MS.embedShortTexts(counting, Array(21).fill('x'))).ok, false);
  assert.equal((await M.MS.embedShortTexts(counting, ['x'.repeat(501)])).ok, false, 'a note body cannot pass: nothing private embedded');
  assert.equal(asked, 0, 'refused before the model');
  const stumbled = await M.MS.embedShortTexts(
    {
      embed: async () => {
        throw new Error('down');
      },
    },
    ['x'],
  );
  assert.equal(stumbled.ok, false);
  assert.match(stumbled.words, /stumbled/, 'a stumble says so, plainly');
  const wide = await M.MS.embedShortTexts({ embed: async () => [1, 2, 3] }, ['x']);
  assert.equal(wide.ok, false, 'a wrong-width vector is refused');
});

test('private notes are never embedded: not read, not kept, never found', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  const seen = [];
  const orig = emb.embed.bind(emb);
  emb.embed = async (texts) => {
    seen.push(...texts);
    return orig(texts);
  };
  try {
    const index = new M.VaultIndex();
    index.set('Private notes/ClassifiedXJ29 supplier.md', '# ClassifiedXJ29 supplier\nClassifiedXJ29 vendor missing delivery dates late again.', NOW, 10);
    index.set('Notes/Open supplier.md', '# Open supplier\nThe supplier missed the delivery date.', NOW, 10);
    const builder = new M.MeaningBuilder({
      dir,
      embedder: emb,
      index: index.meanings(),
      list: () => index.allMeta().map((m) => m.path),
      read: (p) => {
        const meta = index.get(p);
        const content = index.content(p);
        return meta && content !== undefined ? { title: meta.label, content } : null;
      },
      isExcluded: (p) => index.isExcluded(p),
    });
    index.attachMeaning(builder);
    await builder.start();
    await builder.idle();
    await builder.flush();
    try {
      assert.ok(!seen.some((t) => t.includes('ClassifiedXJ29')), 'the model never read the private note');
      assert.ok(seen.some((t) => t.includes('Open supplier')), 'the open note was embedded');
      const map = JSON.parse(readFileSync(path.join(dir, 'map.json'), 'utf8'));
      assert.ok(map.order.every((e) => !e.path.startsWith('Private notes/')), 'nothing private kept');
      assert.deepEqual(index.meanings().paths().filter((p) => p.startsWith('Private notes/')), [], 'nothing private indexed');
      assert.ok(!(await index.searchAsync('ClassifiedXJ29 supplier missing delivery')).some((h) => h.path.startsWith('Private notes/')), 'meaning search stays out');
      assert.deepEqual(index.relatedNotes('Private notes/ClassifiedXJ29 supplier.md'), [], 'a private note has no related list');
    } finally {
      builder.stop();
    }
  } finally {
    emb.embed = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('embeddings are kept per note and reused: the second open embeds nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  let runs = 0;
  const orig = emb.embed.bind(emb);
  emb.embed = async (texts) => {
    runs += texts.length;
    return orig(texts);
  };
  try {
    const first = await built(dir);
    const firstRuns = runs;
    assert.ok(firstRuns >= 4, `the first open embeds every note (${firstRuns})`);
    const before = (await first.index.searchAsync(QUERY)).map((h) => h.path);
    first.builder.stop();
    runs = 0;
    const second = await built(dir);
    try {
      assert.equal(runs, 0, 'the second open embeds nothing: the cache answers');
      assert.deepEqual((await second.index.searchAsync(QUERY)).map((h) => h.path), before, 'the same hits from kept vectors');
      assert.ok(existsSync(path.join(dir, 'map.json')) && existsSync(path.join(dir, 'vecs.f32')), 'the cache files');
      const map = JSON.parse(readFileSync(path.join(dir, 'map.json'), 'utf8'));
      assert.equal(map.dim, 384, 'the taught width on the box');
      assert.equal(statSync(path.join(dir, 'vecs.f32')).size, map.order.reduce((n, e) => n + e.chunks, 0) * 384 * 4, 'one float32 vector per piece');
      // A note edited is embedded again (its hash moved); the rest stay kept.
      runs = 0;
      second.index.set(CAKE, '# Cake\nFlour, sugar, butter, bake at 180. Now with lemon icing.', NOW, 10);
      second.builder.notesChanged([CAKE]);
      await second.builder.idle();
      assert.equal(runs, 1, 'only the edited note embedded again');
    } finally {
      second.builder.stop();
    }
  } finally {
    emb.embed = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('when the model cannot load, the fallback answers and says so once, plainly, with no network', async () => {
  for (const f of ['src/main/meaning-tokenizer.ts', 'src/main/meaning-embed.ts', 'src/main/meaning-build.ts', 'src/main/meaning-index.ts', 'src/main/meaning-service.ts', 'src/shared/weekly-tidy.ts']) {
    const src = read(f);
    assert.ok(!/fetch\s*\(/.test(src), `no fetch call in ${f}`);
    assert.ok(!/https?:\/\//.test(src), `no web address in ${f}`);
  }
  const broken = new M.MeaningEmbedder({ modelDir: path.join(work, 'no-model-here'), factory: async () => { throw new Error('unreachable'); } });
  const started = await broken.start();
  assert.equal(started.ok, false);
  assert.match(started.words, /missing/, 'plain words');
  assert.ok(!/onnx|wasm|deepseek|pi-ai|—/i.test(started.words), `no jargon or engine names: ${started.words}`);
  const index = new M.VaultIndex();
  // The term fallback's own proven fixture (tests/meaning.test.mjs): rich shared ideas.
  index.set('Notes/TechLease vendor.md', '# TechLease vendor\nThird shipment slipped again. Stock arrived late twice, always behind schedule. Thinking of switching contractor.', NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  index.set(ROSTER, ROSTER_TEXT, NOW, 10);
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const builder = new M.MeaningBuilder({
      dir,
      embedder: null,
      fallbackWords: started.words,
      index: index.meanings(),
      list: () => index.allMeta().map((m) => m.path),
      read: (p) => {
        const meta = index.get(p);
        const content = index.content(p);
        return meta && content !== undefined ? { title: meta.label, content } : null;
      },
      isExcluded: (p) => index.isExcluded(p),
    });
    index.attachMeaning(builder);
    await builder.start();
    await builder.idle();
    try {
      const status = builder.status();
      assert.equal(status.mode, 'fallback');
      assert.equal(status.words, `Meaning search is off on this PC: ${started.words}.`, 'said once, plainly');
      const realFetch = globalThis.fetch;
      globalThis.fetch = () => { throw new Error('no network on this path'); };
      try {
        const hits = await index.searchAsync(QUERY);
        assert.ok(hits.some((h) => h.path === 'Notes/TechLease vendor.md' && h.meaning), 'the fallback still finds the paraphrase, labelled');
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only the runner files used ship, and the trimmed set runs real inference', async () => {
  assert.deepEqual(ship.ORT_SHIP_FILES, ['ort.node.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'], 'the shipped set, exactly');
  // Trimming keeps the set and drops everything else.
  const fake = mkdtempSync(path.join(tmpdir(), 'nv-meaning-dist-'));
  try {
    for (const n of [...ship.ORT_SHIP_FILES, 'ort-wasm-simd-threaded.jsep.wasm', 'ort.all.min.js', 'stray.txt']) writeFileSync(path.join(fake, n), 'x');
    const trimmed = ship.trimOrtDist(fake);
    assert.deepEqual(trimmed.kept.sort(), ship.ORT_SHIP_FILES.slice().sort(), 'kept');
    assert.deepEqual(trimmed.removed.sort(), ['ort-wasm-simd-threaded.jsep.wasm', 'ort.all.min.js', 'stray.txt'].sort(), 'dropped');
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
  // The shared package trims to its manifest and plain scripts.
  const fakeCommon = mkdtempSync(path.join(tmpdir(), 'nv-meaning-common-'));
  try {
    mkdirSync(path.join(fakeCommon, 'dist', 'cjs'), { recursive: true });
    mkdirSync(path.join(fakeCommon, 'dist', 'esm'), { recursive: true });
    writeFileSync(path.join(fakeCommon, 'package.json'), '{}');
    writeFileSync(path.join(fakeCommon, 'README.md'), 'x');
    for (const n of ['index.js', 'tensor.js', 'package.json', 'index.d.ts', 'index.js.map']) writeFileSync(path.join(fakeCommon, 'dist', 'cjs', n), 'x');
    writeFileSync(path.join(fakeCommon, 'dist', 'esm', 'index.js'), 'x');
    const trimmedCommon = ship.trimOrtCommon(fakeCommon);
    assert.ok(trimmedCommon.kept.includes('package.json'), 'the manifest stays');
    assert.ok(trimmedCommon.kept.includes('dist/cjs/index.js') && trimmedCommon.kept.includes('dist/cjs/package.json'), 'scripts and their manifest stay');
    assert.ok(!existsSync(path.join(fakeCommon, 'dist', 'esm')), 'the browser build goes');
    assert.ok(!existsSync(path.join(fakeCommon, 'dist', 'cjs', 'index.d.ts')), 'the type files go');
  } finally {
    rmSync(fakeCommon, { recursive: true, force: true });
  }
  // The trimmed set, alone in a folder, runs the model (nothing else needed, nothing downloaded).
  const alone = mkdtempSync(path.join(tmpdir(), 'nv-meaning-ort-'));
  try {
    ship.copyOrtShip(ortDist, path.join(root, 'node_modules', 'onnxruntime-common'), alone);
    // The installed app reads as a module (its package says so): the runner must load there too (6 Nov 2026,
    // speakers-apart — require() of the shipped .js threw, and voices stayed You and Others).
    writeFileSync(path.join(alone, 'package.json'), JSON.stringify({ type: 'module' }));
    const req = createRequire(path.join(alone, 'probe.cjs'));
    const [runner] = readdirSync(alone).filter((n) => n.startsWith('ort.node.min.'));
    const trimmedOrt = req(path.join(alone, runner));
    const factory = M.ortSessionFactory(trimmedOrt, alone);
    const session = await factory(path.join(modelDir, 'onnx', 'model_quantized.onnx'), 1);
    try {
      const tok = M.loadTokenizer(modelDir);
      const out = await session.run(M.encodeText(tok, 'the supplier who kept missing delivery dates'));
      assert.equal(out.dim, 384, 'real inference from the trimmed set');
    } finally {
      await session.close();
    }
  } finally {
    rmSync(alone, { recursive: true, force: true });
  }
}, { timeout: 120000 });

test('the runner loads beside the bundle first, then the installed copy, else quietly nothing', () => {
  const mainDir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-main-'));
  try {
    const ortDir = path.join(mainDir, 'meaning', 'ort');
    mkdirSync(ortDir, { recursive: true });
    writeFileSync(path.join(ortDir, 'ort.node.min.cjs'), 'module.exports = { beside: true };');
    const beside = M.loadOrtModule(mainDir);
    assert.ok(beside && beside.ort.beside === true && beside.wasmDir === ortDir, 'beside the bundle wins');
  } finally {
    rmSync(mainDir, { recursive: true, force: true });
  }
  // Nowhere (a bare folder, no bundle copy, no installed package above it): null, no throw.
  const bare = mkdtempSync(path.join(tmpdir(), 'nv-meaning-bare-'));
  try {
    assert.equal(M.loadOrtModule(bare), null, 'quietly nothing: the caller falls back');
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
  // A throw from the copy beside the bundle is said aloud through report (6 Nov 2026, speakers-apart: that throw
  // hid, and every transcript stayed You and Others), then the caller falls back.
  const broken = mkdtempSync(path.join(tmpdir(), 'nv-meaning-broken-'));
  try {
    const brokenOrt = path.join(broken, 'meaning', 'ort');
    mkdirSync(brokenOrt, { recursive: true });
    writeFileSync(path.join(brokenOrt, 'ort.node.min.cjs'), 'throw new Error("damaged runner");');
    const said = [];
    assert.equal(M.loadOrtModule(broken, (err) => said.push(err)), null);
    assert.match(String(said[0]?.message ?? said[0]), /damaged runner/);
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
});

test('the session factory hands the runner file URLs, on every platform', async () => {
  // 6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows a bare path fails ("Received
  // protocol 'c:'"), so no session ever started there. A folder with a space proves the encoding too.
  const fake = { env: { wasm: {} }, InferenceSession: { create: async () => ({ run: async () => ({}), release: async () => {} }) } };
  await M.ortSessionFactory(fake, path.join(tmpdir(), 'nv-meaning dir'))('/model.onnx', 1);
  assert.ok(fake.env.wasm.wasmPaths.startsWith('file://'), fake.env.wasm.wasmPaths);
  assert.ok(fake.env.wasm.wasmPaths.endsWith('/'), fake.env.wasm.wasmPaths);
  assert.ok(!fake.env.wasm.wasmPaths.includes(' '), 'spaces encoded');
});

test('a 2,000-note made-up vault builds in the stated time, and the paraphrase is found among them', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-cache-'));
  try {
    const index = new M.VaultIndex();
    const subjects = ['Harbour fit-out', 'Roster', 'Cake recipe', 'Garden beds', 'Car service', 'Book club', 'Budget review', 'Holiday plans'];
    const bodies = [
      'Flour, sugar, butter, bake at 180 until golden.',
      'Discussed the weekend roster with the team over tea.',
      'The decking boards arrived on Tuesday, stacked by the fence.',
      'Oil and filters changed, tyres rotated, washed after.',
      'Chapters three to five, then notes on the harbour crossing.',
      'Rent, power and groceries against last month’s pay.',
      'Ferry times, the shack keys, and who brings the esky.',
    ];
    for (let i = 0; i < 1999; i++) {
      const title = `${subjects[i % subjects.length]} ${i}`;
      index.set(`Notes/${title}.md`, `# ${title}\n${bodies[i % bodies.length]} Note ${i} of the made-up vault.`, NOW, 10);
    }
    index.set(VENDOR, VENDOR_TEXT, NOW, 10);
    const builder = new M.MeaningBuilder({
      dir,
      embedder: emb,
      index: index.meanings(),
      list: () => index.allMeta().map((m) => m.path),
      read: (p) => {
        const meta = index.get(p);
        const content = index.content(p);
        return meta && content !== undefined ? { title: meta.label, content } : null;
      },
      isExcluded: (p) => index.isExcluded(p),
    });
    index.attachMeaning(builder);
    const t0 = Date.now();
    await builder.start();
    const starting = builder.status();
    assert.equal(starting.mode, 'starting', 'the build announces itself');
    assert.match(starting.words, /Getting meaning search ready… \d+ of 2000/, `the quiet progress line (${starting.words})`);
    await builder.idle();
    const ms = Date.now() - t0;
    try {
      assert.equal(builder.status().mode, 'ready');
      assert.ok(ms < 240000, `2,000 notes build in under four minutes (${Math.round(ms / 1000)}s)`);
      const hits = await index.searchAsync(QUERY);
      assert.ok(hits.some((h) => h.path === VENDOR && h.meaning), 'the paraphrase is found among 2,000 notes');
    } finally {
      builder.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 300000 });
