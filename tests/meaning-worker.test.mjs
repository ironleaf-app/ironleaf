// node --test tests/meaning-worker.test.mjs — the meaning index never blocks the app (9 Nov 2026). Embedding and
// reranking ran on Electron's main thread; they run in a worker now (src/main/meaning-worker.ts,
// src/main/meaning-worker-client.ts), the main process only sending text and receiving vectors. The same vectors
// (byte-identical), the same search results, indexing in single pieces so a search asked while indexing goes first,
// and the worker file ships beside the bundle. Made-up notes in temporary folders, never a real vault; nothing
// leaves this PC.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meaning-worker-'));
const modelDir = path.join(root, 'resources', 'models', 'all-MiniLM-L6-v2');
const rerankDir = path.join(root, 'resources', 'models', 'ms-marco-MiniLM-L-6-v2');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let M;
let emb;
let runner;
let worker;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-tokenizer.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-embed.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-rerank.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-build.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-worker-client.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  const ort = await import(pathToFileURL(path.join(ortDist, 'ort.node.min.mjs')).href);
  emb = new M.MeaningEmbedder({ modelDir, factory: M.ortSessionFactory(ort, ortDist), threads: 1 });
  assert.equal((await emb.start()).ok, true, 'the in-process model starts for the comparison');
  // The worker the way the app holds it: its file built beside a home with the modules linked, started once.
  const home = path.join(work, 'worker-home');
  mkdirSync(home, { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(home, 'node_modules'));
  const file = path.join(home, 'meaning-worker.cjs');
  await build({ input: path.join(root, 'src/main/meaning-worker.ts'), platform: 'node', external: [/^node:/, 'electron'], output: { file, format: 'cjs', exports: 'named' }, logLevel: 'silent' });
  worker = new Worker(file, { workerData: { mainDir: home } });
  const host = { post: (m) => worker.postMessage(m), onMessage: (fn) => worker.on('message', fn), end: async () => { await worker.terminate(); } };
  runner = new M.WorkerMeaningRunner(host, { embedDir: modelDir, rerankDir, threads: 1 });
  const r = await runner.start();
  assert.equal(r.embed.ok, true, 'the worker starts on the same models');
  assert.equal(r.rerank, true, 'and the reranker with it');
}, { timeout: 180000 });
after(async () => {
  await runner?.close().catch(() => {});
  await worker?.terminate().catch(() => {});
  await emb?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
const QUERY = 'the supplier who kept missing delivery dates';
const VENDOR = 'Notes/TechParts.md';
const VENDOR_TEXT = '# TechParts\nKeep shipping late.';

// The main thread's own delays while `fn` runs: a 5 ms timer records how late it runs (normally a millisecond;
// any block on the thread shows as the lateness). Returns the longest block in milliseconds, with every block past
// 10 ms and when it landed (for the report: what, if anything, still holds the thread).
// A block is the thread's own work (23 Nov 2026): the lateness counts only as far as the main thread actually ran
// (process.threadCpuUsage), so a busy machine that leaves the thread waiting for a core no longer reads as a block.
// In a full suite run the timer was often 15-20 ms late with nothing of the app's running; a real block still runs
// on the thread and still counts in full.
async function mainDelays(fn) {
  let max = 0;
  const gaps = [];
  const cpu = () => {
    const u = process.threadCpuUsage();
    return (u.user + u.system) / 1000;
  };
  const t0 = performance.now();
  let last = t0;
  let lastCpu = cpu();
  const every = 5;
  const note = (now, nowCpu, where) => {
    const late = now - last - every;
    const block = Math.min(late, nowCpu - lastCpu);
    max = Math.max(max, block);
    if (block > 10) gaps.push(`${block.toFixed(1)}ms (late ${late.toFixed(1)}ms)@${where}`);
    last = now;
    lastCpu = nowCpu;
  };
  const timer = setInterval(() => {
    const now = performance.now();
    note(now, cpu(), `${((now - t0) / 1000).toFixed(1)}s`);
  }, every);
  try {
    await fn();
  } finally {
    clearInterval(timer);
    // A block that never let the timer fire (the whole run as microtasks): the trailing gap is the block.
    note(performance.now(), cpu(), 'trailing');
  }
  return { max, gaps };
}

test('the worker embeds byte-identical vectors for the same text', async () => {
  const texts = ['TechParts keep shipping late', 'Flour, sugar, butter, bake at 180.', 'the supplier who kept missing delivery dates'];
  const a = await emb.embed(texts);
  const b = await runner.embed(texts);
  assert.deepEqual(b, a, 'the same model, the same classes, the same vectors across the thread');
  const q = await runner.embedQuery([QUERY]);
  assert.deepEqual(q, [a[2]], 'a search’s texts embed the same through the priority door');
});

test('search results are the same before and after', async () => {
  const notes = [
    [VENDOR, VENDOR_TEXT],
    ['Notes/Cake.md', '# Cake\nFlour, sugar, butter, bake at 180.'],
    ['Notes/Roster.md', '# Roster\nDiscussed the weekend roster with the team.'],
    ['Notes/Deadline miss.md', '# Deadline miss\nThe provider missed the consignment deadline. Overdue, waiting on the booking.'],
  ];
  async function searchWith(embedder) {
    const { VaultIndex, MeaningBuilder } = M;
    const index = new VaultIndex();
    for (const [p, text] of notes) index.set(p, text, NOW, 10);
    const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-worker-cache-'));
    try {
      const builder = new MeaningBuilder({
        dir,
        embedder,
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
        return (await index.searchAsync(QUERY)).map((h) => [h.path, h.meaning ? 1 : 0]);
      } finally {
        builder.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const before = await searchWith(emb);
  const after = await searchWith(runner);
  assert.deepEqual(after, before, `the same hits, in the same order (${JSON.stringify(after)})`);
  assert.ok(after.some(([p, m]) => p === VENDOR && m === 1), 'the paraphrase found both ways');
});

test('the main thread blocks without the worker, proving the timer sees blocks', async () => {
  // Eight long texts through the main-process model: each inference blocks the thread that routes clicks.
  const long = Array.from({ length: 8 }, (_, i) => `TechParts note ${i}: ` + 'the supplier kept missing delivery dates and the consignment slipped again '.repeat(20));
  const { max } = await mainDelays(() => emb.embed(long));
  assert.ok(max > 16, `eight texts on the main thread block past a frame (${max.toFixed(1)} ms)`);
});

test('a 2,000-note made-up vault indexes with no block over 16 ms, and the paraphrase is found', async () => {
  const { VaultIndex, MeaningBuilder } = M;
  const index = new VaultIndex();
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
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-meaning-worker-cache-'));
  try {
    const builder = new MeaningBuilder({
      dir,
      embedder: runner,
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
    const { max, gaps } = await mainDelays(async () => {
      await builder.start();
      await builder.idle();
    });
    const ms = Date.now() - t0;
    try {
      assert.equal(builder.status().mode, 'ready');
      assert.ok(max <= 16, `no block over a frame while 2,000 notes index (${max.toFixed(1)} ms; gaps: ${gaps.join(', ') || 'none past 10 ms'})`);
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

test('the worker re-scores a search: the answer lifts past the decoy', async () => {
  const { VaultIndex } = M;
  const index = new VaultIndex();
  index.set('Notes/Missed supplier delivery.md', '# Missed supplier delivery\nFlour orders moved to the intranet. See the list there.', NOW, 10);
  index.set('Notes/TechParts.md', '# TechParts\nOur flour supplier missed the May delivery, and Western Plains Mill apologised for the delay.', NOW, 10);
  index.set('Notes/Supplier missed flour delivery.md', '# Supplier missed flour delivery\nA log of every missed flour delivery, kept for the autumn review.', NOW, 10);
  index.attachRerank({ score: (q, texts) => runner.score(q, texts) });
  const scores = await runner.score('supplier missed flour delivery', ['Flour orders moved.', 'Our flour supplier missed the May delivery.']);
  assert.equal(scores?.length, 2, 'two pairs scored across the thread');
  assert.ok(scores[1] > scores[0], `the answering text outscores the nothing text (${scores})`);
  const hits = await index.searchAsync('supplier missed flour delivery');
  const titles = hits.map((h) => h.path);
  assert.ok(titles.indexOf('Notes/TechParts.md') < titles.indexOf('Notes/Missed supplier delivery.md'), `the answer lifts past the decoy (${titles.slice(0, 3).join(' / ')})`);
});
