// node --test tests/meaning-rerank.test.mjs — the on-device reranker (10.0 m10rerank, 2 Nov 2026: agreed, "the
// other 2 use"). The cross-encoder (resources/models/ms-marco-MiniLM-L-6-v2, beside the meaning model) re-scores
// the top 30 results of a search by real relevance: query and result as one pair, sigmoid, mixed with the
// existing rank so exact title matches stay first. Lazy start, today's order when it cannot load, private notes
// never scored, and the model shipped beside the meaning model. Made-up notes in temporary folders, never a real
// vault; nothing leaves this PC.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meaning-rerank-'));
const modelDir = path.join(root, 'resources', 'models', 'ms-marco-MiniLM-L-6-v2');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let M;
let ship;
let ortMod;
let rer1;
let rerDef;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-tokenizer.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-embed.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-rerank.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  const ort = await import(pathToFileURL(path.join(ortDist, 'ort.node.min.mjs')).href);
  ortMod = ort;
  ship = await import(pathToFileURL(path.join(root, 'tools', 'ort-ship.mjs')).href);
  // The production-width session first: the runner's thread pool is fixed process-wide by the first session in it.
  rerDef = new M.MeaningReranker({ modelDir, factory: M.ortPairSessionFactory(ort, ortDist) });
  assert.equal(await rerDef.start(), true, 'the cross-encoder starts on the production thread path');
  rer1 = new M.MeaningReranker({ modelDir, factory: M.ortPairSessionFactory(ort, ortDist), threads: 1 });
  assert.equal(await rer1.start(), true, 'the cross-encoder starts single-threaded too');
}, { timeout: 180000 });
after(async () => {
  await rer1?.close().catch(() => {});
  await rerDef?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
const QUERY = 'supplier missed flour delivery';
// The lift vault (design A, proven against the real model): the decoy's title carries the query's words (best word
// match) but its body answers nothing; the answer's body answers directly with no title words (worst word match).
const DECOY = 'Notes/Missed supplier delivery.md';
const DECOY_TEXT = '# Missed supplier delivery\nFlour orders moved to the intranet. See the list there.';
const ANSWER = 'Notes/TechParts.md';
const ANSWER_TEXT = '# TechParts\nOur flour supplier missed the May delivery, and Western Plains Mill apologised for the delay.';
const EXACT = 'Notes/Supplier missed flour delivery.md';
const EXACT_TEXT = '# Supplier missed flour delivery\nA log of every missed flour delivery, kept for the autumn review.';
const CAKE = 'Notes/Cake.md';
const CAKE_TEXT = '# Cake\nFlour, sugar, butter, bake at 180.';

function liftIndex() {
  const index = new M.VaultIndex();
  index.set(DECOY, DECOY_TEXT, NOW, 10);
  index.set(ANSWER, ANSWER_TEXT, NOW, 10);
  index.set(EXACT, EXACT_TEXT, NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  return index;
}

test('a pair reads [CLS] query [SEP] text [SEP], segments split, each side cut to its budget', () => {
  const tok = M.loadTokenizer(modelDir);
  assert.equal(tok.vocab.get('supplier'), 17024, 'the rerank model reads the same words file as the meaning model');
  const { ids, typeIds } = M.encodePair(tok, 'Supplier missed delivery', 'Flour orders moved.');
  assert.equal(ids.length, typeIds.length, 'a segment for every id');
  assert.deepEqual(ids.slice(0, 1), [tok.clsId], 'opens with [CLS]');
  assert.equal(ids[ids.length - 1], tok.sepId, 'closes with [SEP]');
  const firstSep = 1 + M.encodeSide(tok, 'Supplier missed delivery', 32).length;
  assert.equal(ids[firstSep], tok.sepId, 'the query walled off by [SEP]');
  assert.ok(typeIds.slice(0, firstSep + 1).every((t) => t === 0), 'the question and its wall read as segment 0');
  assert.ok(typeIds.slice(firstSep + 1).every((t) => t === 1), 'the result reads as segment 1');
  assert.deepEqual(M.encodeSide(tok, 'Supplier', 32), M.encodeSide(tok, 'supplier', 32), 'a side reads lower-cased, as encodeText does');
  const q = M.encodePair(tok, 'supplier '.repeat(100), 'flour', 32, 64);
  assert.deepEqual(q.ids.slice(1, 33), M.encodeSide(tok, 'supplier '.repeat(100), 32), 'the query cut to 32 tokens');
  assert.equal(q.ids.length, 1 + 32 + 1 + M.encodeSide(tok, 'flour', 64).length + 1, 'wrapped around the cut query');
  const t = M.encodePair(tok, 'flour', 'delivery '.repeat(200), 32, 64);
  const qs = M.encodeSide(tok, 'flour', 32).length;
  assert.deepEqual(t.ids.slice(2 + qs, 2 + qs + 64), M.encodeSide(tok, 'delivery '.repeat(200), 64), 'the result cut to 64 tokens');
  const empty = M.encodePair(tok, '', '');
  assert.deepEqual(empty.ids, [tok.clsId, tok.sepId, tok.sepId], 'empty sides stay wrapped');
  assert.deepEqual(empty.typeIds, [0, 0, 1], 'and split');
});

test('sigmoid and the scored order: exacts pinned first, score decides, ties keep today, unscored sinks', () => {
  assert.equal(M.sigmoid(0), 0.5, 'a logit of nothing reads half');
  assert.ok(M.sigmoid(9) > 0.999 && M.sigmoid(-11) < 0.0001, 'an exact match reads ~1, an unrelated one ~0');
  assert.equal(M.sigmoid(Number.POSITIVE_INFINITY), 1, 'no overflow either way');
  assert.equal(M.sigmoid(Number.NEGATIVE_INFINITY), 0, 'no overflow either way');
  assert.ok(M.isExactTitle('Supplier missed flour delivery', 'supplier missed flour delivery'), 'case is not a difference');
  assert.ok(M.isExactTitle('  supplier   missed flour delivery ', 'Supplier missed flour delivery'), 'spacing is not a difference');
  assert.ok(M.isExactTitle('café accounts', 'Cafe accounts'), 'accents are not a difference');
  assert.ok(!M.isExactTitle('supplier missed flour', 'supplier missed flour delivery'), 'a near title is not exact');
  assert.ok(!M.isExactTitle('', ''), 'nothing asked, nothing exact');
  const titles = ['Exact note', 'Decoy note', 'Answer note'];
  // The exact title scores worst and still stays first; the best score lifts the last result above the middle one.
  assert.deepEqual(
    M.applyRerank('exact note', titles, (t) => t, [0.0, 0.1, 0.9]),
    ['Exact note', 'Answer note', 'Decoy note'],
    'pinned, then by score',
  );
  assert.deepEqual(M.applyRerank('other words', titles, (t) => t, [0.5, 0.5, 0.5]), titles, 'ties keep today’s order');
  assert.deepEqual(
    M.applyRerank('other words', titles, (t) => t, [null, 0.4, null]),
    ['Decoy note', 'Exact note', 'Answer note'],
    'unscored results sink, keeping their own order',
  );
  assert.deepEqual(M.applyRerank('other words', titles, (t) => t, [Number.NaN, 0.4, 0.4]), ['Decoy note', 'Answer note', 'Exact note'], 'a broken score sinks, never throws');
});

test('the cross-encoder scores relevance: exact above paraphrase above unrelated, deterministic', async () => {
  // Clearly separated pairs (a near-verbatim tie would sit within the batch's own wiggle, below).
  const texts = [
    'Supplier missed flour delivery\nA log of every missed flour delivery, kept for the autumn review.',
    'TechParts\nKeep shipping late.',
    'Cake\nFlour, sugar, butter, bake at 180.',
  ];
  const [exact, paraphrase, unrelated] = await rer1.score(QUERY, texts);
  for (const s of [exact, paraphrase, unrelated]) assert.ok(s >= 0 && s <= 1, `a 0..1 score (${s})`);
  assert.ok(exact > 0.99, `an exact answer reads ~1 (${exact})`);
  assert.ok(paraphrase > unrelated, `a paraphrase (${paraphrase}) outscores the unrelated note (${unrelated})`);
  assert.ok(paraphrase < 0.05 && unrelated < 0.001, `with room between them (${paraphrase} vs ${unrelated})`);
  assert.deepEqual(await rer1.score(QUERY, texts), [exact, paraphrase, unrelated], 'the same pairs score the same');
  assert.deepEqual(await rer1.score(QUERY, []), [], 'nothing to score is nothing, without touching the model');
  assert.deepEqual(await rer1.score('   ', texts), [], 'nothing asked is nothing');
});

test('one batched run is deterministic and keeps clear separations (quantization wiggles near-ties)', async () => {
  const tok = M.loadTokenizer(modelDir);
  const texts = ['Supplier missed flour delivery\nA log of every missed flour delivery.', 'Cake\nFlour, sugar, butter, bake at 180.'];
  const pairs = texts.map((t) => M.encodePair(tok, QUERY, t));
  assert.notEqual(pairs[0].ids.length, pairs[1].ids.length, 'uneven pairs, so padding has work to do');
  const session = await M.ortPairSessionFactory(ortMod, ortDist)(path.join(modelDir, 'onnx', 'model_quantized.onnx'), 1);
  try {
    const batched = await session.runBatch(pairs);
    assert.equal(batched.length, 2, 'one logit per pair');
    assert.deepEqual(await session.runBatch(pairs), batched, 'the same batch scores the same');
    assert.ok(batched[0] > batched[1] + 5, `the answer (${batched[0]}) far above the unrelated note (${batched[1]})`);
    const alone = [await session.run(pairs[0].ids, pairs[0].typeIds), await session.run(pairs[1].ids, pairs[1].typeIds)];
    assert.ok(alone[0] > alone[1], 'one by one agrees on the order');
    assert.deepEqual(await session.runBatch([]), [], 'no pairs, no run');
  } finally {
    await session.close();
  }
});

test('lazy start, busy searches fall back, a failed load stays failed without retrying', async () => {
  let factoryCalls = 0;
  const gate = { held: null };
  const lazy = new M.MeaningReranker({
    modelDir,
    factory: async (modelPath, threads) => {
      factoryCalls++;
      return {
        run: async () => {
          if (gate.held) await gate.held;
          return 1.5;
        },
        runBatch: async (pairs) => {
          if (gate.held) await gate.held;
          return pairs.map(() => 1.5);
        },
        close: async () => {},
      };
    },
    threads: 1,
  });
  assert.equal(lazy.ready, false, 'not started by making it');
  assert.equal(factoryCalls, 0, 'nothing loaded until the first search');
  let release = () => {};
  gate.held = new Promise((r) => {
    release = r;
  });
  const first = lazy.score('flour delivery', ['a delivery note', 'another delivery note']);
  assert.equal(await lazy.score('flour delivery', ['a delivery note', 'another delivery note']), null, 'a search while one scores falls back, never queues');
  assert.equal(factoryCalls, 1, 'one session for both');
  release();
  assert.deepEqual(await first, [M.sigmoid(1.5), M.sigmoid(1.5)], 'the first search still scores');
  assert.equal(lazy.ready, true, 'started by the first search');
  await lazy.close();
  const missing = new M.MeaningReranker({ modelDir: path.join(work, 'no-model-here'), factory: async () => { throw new Error('unreachable'); } });
  assert.equal(await missing.start(), false, 'a missing model file does not start');
  assert.equal(await missing.score('flour', ['flour note', 'flour list']), null, 'and scores nothing');
  let failingCalls = 0;
  const failing = new M.MeaningReranker({ modelDir, factory: async () => { failingCalls++; throw new Error('no runner'); }, threads: 1 });
  assert.equal(await failing.start(), false, 'a runner that cannot run does not start');
  const calls = failingCalls;
  assert.ok(calls >= 1, 'it tried');
  assert.equal(await failing.start(), false, 'still failed');
  assert.equal(failingCalls, calls, 'a failed load is not retried every search');
  const odd = new M.MeaningReranker({ modelDir, factory: async () => ({ run: async () => Number.NaN, close: async () => {} }), threads: 1 });
  assert.equal(await odd.start(), false, 'a model that answers no number is refused at the probe');
});

test('Vault search with stub scores: the best answer lifts, the exact title stays first whatever it scores', async () => {
  const index = liftIndex();
  const seen = [];
  index.attachRerank({
    score: async (q, texts) => {
      assert.equal(q, QUERY, 'the question as asked');
      seen.push(...texts);
      // Word order here is exact, decoy, answer: the exact scores worst on purpose.
      return [0.0, 0.1, 0.9];
    },
  });
  const hits = await index.searchAsync(QUERY);
  assert.deepEqual(hits.map((h) => h.path), [EXACT, ANSWER, DECOY], 'exact first, then by score: the answer lifts above the decoy');
  assert.equal(seen.length, 3, 'every top result scored once');
  assert.ok(seen[0].startsWith('Supplier missed flour delivery\n'), 'a scored text carries its title first');
  assert.ok(seen[1].startsWith('Missed supplier delivery\n') && seen[1].includes('Flour orders moved'), 'then its best lines');
  assert.ok(Math.max(...seen.map((t) => t.length)) <= M.RERANK_MAX_TEXT_CHARS, 'cut to 600 characters');
});

test('a long note scores cut, and only the top 30 are ever scored', async () => {
  const line = `The supplier missed the flour delivery round again, with apologies all round. ${'Late again. '.repeat(30)}`;
  const longBody = [line, line, line, line].join('\n');
  const fill = (index) => {
    index.set('Notes/Long supplier note.md', `# Long supplier note\n${longBody}`, NOW, 10);
    for (let i = 0; i < 34; i++) index.set(`Notes/Batch ${i}.md`, `# Batch ${i}\nThe supplier missed the flour delivery round again. Note ${i} of the batch.`, NOW, 10);
  };
  const index = new M.VaultIndex();
  fill(index);
  const seen = [];
  index.attachRerank({ score: async (q, texts) => { seen.push(...texts); return texts.map(() => 0.5); } });
  const hits = await index.searchAsync(QUERY);
  assert.ok(hits.length >= 35, `all 35 word matches still listed (${hits.length})`);
  assert.equal(seen.length, 30, 'only the top 30 scored');
  assert.ok(seen.every((t) => t.length <= M.RERANK_MAX_TEXT_CHARS), 'each scored text cut to 600 characters');
  const unranked = new M.VaultIndex();
  fill(unranked);
  const wordOrder = (await unranked.searchAsync(QUERY)).map((h) => h.path);
  assert.deepEqual(hits.slice(30).map((h) => h.path), wordOrder.slice(30), 'past the 30, today’s order stands');
  // The long note on its own with one short note: scored, its title first with its best lines, cut to the
  // budget, still listed. (5 Nov 2026, v5-vault-speed: search carries two context lines now, what the window
  // shows, down from six — the scorer reads those same shown lines, so a long note's text fills below the 600
  // budget instead of slicing exactly at it. The bound stands, the top-30 cap above stands.)
  const cut = new M.VaultIndex();
  cut.set('Notes/Long supplier note.md', `# Long supplier note\n${longBody}`, NOW, 10);
  cut.set('Notes/Batch 0.md', '# Batch 0\nThe supplier missed the flour delivery round again. Note 0 of the batch.', NOW, 10);
  const cutSeen = [];
  cut.attachRerank({ score: async (q, texts) => { cutSeen.push(...texts); return texts.map(() => 0.5); } });
  const cutHits = await cut.searchAsync(QUERY);
  const longSeen = cutSeen.find((t) => t.startsWith('Long supplier note\n'));
  assert.ok(longSeen, 'the long note scored, not dropped');
  assert.ok(longSeen.length <= M.RERANK_MAX_TEXT_CHARS, `cut to the ${M.RERANK_MAX_TEXT_CHARS} budget (${longSeen.length})`);
  assert.ok(longSeen.includes('Late again.'), 'its best lines carried, not just its title');
  assert.ok(cutHits.some((h) => h.path === 'Notes/Long supplier note.md'), 'and still listed');
});

test('without the model, search is exactly as today: null, thrown, short and single', async () => {
  const plain = liftIndex();
  const wordOrder = (await plain.searchAsync(QUERY)).map((h) => h.path);
  assert.deepEqual(wordOrder, [EXACT, DECOY, ANSWER], 'the best answer is not the best word match');
  const thrown = liftIndex();
  thrown.attachRerank({ score: async () => { throw new Error('the model stumbled'); } });
  assert.deepEqual((await thrown.searchAsync(QUERY)).map((h) => h.path), wordOrder, 'a stumbling model changes nothing');
  const short = liftIndex();
  short.attachRerank({ score: async () => [0.9] });
  assert.deepEqual((await short.searchAsync(QUERY)).map((h) => h.path), wordOrder, 'short scores change nothing');
  const nil = liftIndex();
  nil.attachRerank({ score: async () => null });
  assert.deepEqual((await nil.searchAsync(QUERY)).map((h) => h.path), wordOrder, 'null (still starting, busy) changes nothing');
  const single = new M.VaultIndex();
  single.set(CAKE, CAKE_TEXT, NOW, 10);
  let called = 0;
  single.attachRerank({ score: async () => { called++; return [1]; } });
  assert.deepEqual((await single.searchAsync('cake')).map((h) => h.path), [CAKE], 'one hit has nothing to re-order');
  assert.equal(called, 0, 'and the model is never asked');
  const empty = liftIndex();
  let asked = 0;
  empty.attachRerank({ score: async () => { asked++; return []; } });
  assert.deepEqual(await empty.searchAsync('   '), [], 'nothing asked finds nothing');
  assert.equal(asked, 0, 'and asks nothing');
});

test('the real model lifts the best answer past the best word match, exact titles stay first', async () => {
  const index = liftIndex();
  const before = (await index.searchAsync(QUERY)).map((h) => h.path);
  assert.deepEqual(before, [EXACT, DECOY, ANSWER], 'without the reranker, the decoy outranks the answer by words');
  const seen = [];
  let scores = [];
  index.attachRerank({
    score: async (q, texts) => {
      seen.push(...texts);
      scores = await rer1.score(q, texts);
      return scores;
    },
  });
  const after = (await index.searchAsync(QUERY)).map((h) => h.path);
  assert.deepEqual(after, [EXACT, ANSWER, DECOY], 'with the reranker, the answer lifts past the decoy and the exact title stays first');
  assert.ok(scores[2] > scores[1], `the answer (${scores[2]}) outscores the decoy (${scores[1]})`);
  assert.equal(seen.length, 3, 'one pair per top result');
});

test('30 results re-score in under 300 ms on the production path (stated), warmed', async () => {
  const index = new M.VaultIndex();
  for (let i = 0; i < 35; i++) index.set(`Notes/Supplier note ${i}.md`, `# Supplier note ${i}\nThe supplier missed the flour delivery round again.`, NOW, 10);
  let scored = 0;
  index.attachRerank({
    score: (q, texts) => {
      scored = texts.length;
      return rerDef.score(q, texts);
    },
  });
  await index.searchAsync(QUERY);
  const t0 = Date.now();
  const hits = await index.searchAsync(QUERY);
  const ms = Date.now() - t0;
  assert.ok(hits.length >= 35, `all 35 word matches listed (${hits.length})`);
  assert.equal(scored, 30, '30 pairs through the model');
  console.log(`rerank timing: 30 results in ${ms} ms (threads: ${rerDef.threadsUsed})`);
  assert.ok(ms < 300, `30 results re-score in under 300 ms (${ms} ms)`);
}, { timeout: 60000 });

test('private notes are never scored: not read, never found', async () => {
  const MARK = 'ClassifiedXJ29';
  const index = new M.VaultIndex();
  index.set(`Private notes/${MARK} supplier.md`, `# ${MARK} supplier\n${MARK} supplier missed the flour delivery every week.`, NOW, 10);
  index.set('Notes/Open supplier.md', '# Open supplier\nThe supplier missed the flour delivery once.', NOW, 10);
  index.set('Notes/Open delivery.md', '# Open delivery\nSupplier missed flour delivery twice more.', NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  const seen = [];
  index.attachRerank({ score: async (q, texts) => { seen.push(...texts); return texts.map(() => 0.5); } });
  const hits = await index.searchAsync(QUERY);
  assert.ok(seen.length >= 2, 'open results were scored');
  assert.ok(!seen.some((t) => t.includes(MARK)), 'the reranker never read the private note');
  assert.deepEqual(hits.map((h) => h.path).filter((p) => p.startsWith('Private notes/')), [], 'no private hit to score');
  assert.ok(hits.some((h) => h.path === 'Notes/Open supplier.md'), 'the open notes still searched');
});

test('the rerank path phones nowhere and names no engine', () => {
  for (const f of ['src/main/meaning-rerank.ts', 'src/main/meaning-tokenizer.ts']) {
    const src = read(f);
    assert.ok(!/fetch\s*\(/.test(src), `no fetch call in ${f}`);
    assert.ok(!/https?:\/\//.test(src), `no web address in ${f}`);
    assert.ok(!/deepseek|pi-ai|\bDSH\b/i.test(src), `no engine names in ${f}`);
  }
});

test('the pair factory hands the runner file URLs, on every platform', async () => {
  // 6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows a bare path fails ("Received
  // protocol 'c:'"), so no session ever started there. A folder with a space proves the encoding too.
  const fake = { env: { wasm: {} }, InferenceSession: { create: async () => ({ run: async () => ({}), release: async () => {} }) } };
  await M.ortPairSessionFactory(fake, path.join(tmpdir(), 'nv-rerank dir'))('/model.onnx', 1);
  assert.ok(fake.env.wasm.wasmPaths.startsWith('file://'), fake.env.wasm.wasmPaths);
  assert.ok(fake.env.wasm.wasmPaths.endsWith('/'), fake.env.wasm.wasmPaths);
  assert.ok(!fake.env.wasm.wasmPaths.includes(' '), 'spaces encoded');
});
