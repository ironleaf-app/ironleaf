// node --test tests/meaning-first-look.test.mjs — find by meaning where a person looks first
// (6 Nov 2026: the Ask/Find palette showed "renting a new shop" no note for "Brunswick site lease
// renewal", and the model runtime never loaded on Windows until today). Full search must find the
// note: the SHIPPED runner (tools/ort-ship.mjs into a bare folder, the .cjs required as the app
// requires it), the real embed model and the real rerank model, over a heavy invented vault
// (Harbour Lane Coffee Co., 300 notes). Queries share no words with their targets (pinned per
// query); meaning hits read as ordinary hits with preview lines; stored stand-in vectors are
// replaced safely when the real model loads. Made-up notes in temporary folders, never a real
// vault; nothing leaves this PC.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meaning-first-look-'));
const embedDir = path.join(root, 'resources', 'models', 'all-MiniLM-L6-v2');
const rerankDir = path.join(root, 'resources', 'models', 'ms-marco-MiniLM-L-6-v2');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortCommon = path.join(root, 'node_modules', 'onnxruntime-common');
let M;
let ship;
let emb;
let rer;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-tokenizer.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-embed.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-build.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/main/meaning-rerank.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  ship = await import(pathToFileURL(path.join(root, 'tools', 'ort-ship.mjs')).href);
  // The shipped runner, not the dev copy: trimmed and renamed as the packer ships it, required as
  // the app requires it beside the bundle.
  const alone = path.join(work, 'shipped');
  ship.copyOrtShip(ortDist, ortCommon, alone);
  const req = createRequire(path.join(alone, 'probe.cjs'));
  const [runner] = readdirSync(alone).filter((n) => n.startsWith('ort.node.min.'));
  assert.equal(runner, 'ort.node.min.cjs', 'the shipped runner loads as CommonJS beside the bundle');
  const ort = req(path.join(alone, runner));
  emb = new M.MeaningEmbedder({ modelDir: embedDir, factory: M.ortSessionFactory(ort, alone) });
  assert.equal((await emb.start()).ok, true, 'the on-device model starts on the shipped runner');
  rer = new M.MeaningReranker({ modelDir: rerankDir, factory: M.ortPairSessionFactory(ort, alone) });
  assert.equal(await rer.start(), true, 'the cross-encoder starts on the shipped runner');
}, { timeout: 180000 });
after(async () => {
  await emb?.close().catch(() => {});
  await rer?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
// Harbour Lane Coffee Co.: 300 neutral filler notes plus targets none of whose words appear in
// their queries (each query pins that below). Filler words avoid every query word too.
const SUBJECTS = ['Harbour fit-out', 'Morning tea', 'Cake recipe', 'Garden beds', 'Car service', 'Book club', 'Budget review', 'Holiday plans', 'Bean profiles', 'Machine service'];
const BODIES = [
  'Flour, sugar, butter, bake at 180 until golden. The catering order for the function.',
  'Discussed the morning tea plan with the team in the back room.',
  'The decking boards for the courtyard arrived on Tuesday, stacked by the fence.',
  'Oil and filters changed on the delivery van, tyres rotated, washed after.',
  'Chapters three to five of the staff handbook, then notes on the harbour crossing.',
  'Paper, toner and stamps against last month’s office order.',
  'Ferry times, the shack keys, and who brings the esky for the staff day.',
  'Single origin tasting notes: citrus, chocolate, long finish. Dial in the grind.',
  'Descale the espresso machines, replace group seals, backflush nightly.',
  'Council permit for the footpath tables, insurance certificate attached.',
];
const TARGETS = {
  'Sites/Brunswick site lease renewal.md':
    '# Brunswick site lease renewal\nThe Fitzroy landlord wants the commercial tenancy agreement for the Sydney Road premises signed by March. Rent review clause, five year option, fit-out contribution. Meeting with the property solicitor Thursday.',
  'Suppliers/Green bean contract talks.md':
    '# Green bean contract talks\nNegotiating the forward purchase of Colombian and Ethiopian lots with the importer. Price per bag, shipment windows, quality scoring on arrival. Cupping samples Friday.',
  'Staff/Weekend crew roster.md':
    '# Weekend crew roster\nSaturday and Sunday shifts for baristas and floor staff across both stores. Mia covers opening, Priya closes. Swap requests in the book by Wednesday.',
  'Notes/Siesta.md': '# Siesta\nThe feline domestic companion reclined on the heated textile.',
};
const QUERIES = [
  // [query, target]: the walk's headline first, each sharing no word with its target.
  ['renting a new shop', 'Sites/Brunswick site lease renewal.md'],
  ['buying coffee from overseas', 'Suppliers/Green bean contract talks.md'],
  ['who is rostered to work', 'Staff/Weekend crew roster.md'],
  ['cat sat on warm rug', 'Notes/Siesta.md'],
];
const wordsOf = (s) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2));

/** A VaultIndex over the heavy vault, attached to a builder on the shipped runner, built to idle. */
async function built(count = 300) {
  const index = new M.VaultIndex();
  for (let i = 0; i < count; i++) {
    const title = `${SUBJECTS[i % SUBJECTS.length]} ${i}`;
    const para = BODIES[i % BODIES.length];
    index.set(`Notes/${title}.md`, `# ${title}\n${para} ${para} Note ${i} of the Harbour Lane vault.\n${para}`, NOW, 10);
  }
  for (const [p, t] of Object.entries(TARGETS)) index.set(p, t, NOW, 10);
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-first-look-cache-'));
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
  index.attachRerank({ score: (q, texts) => rer.score(q, texts) });
  const t0 = Date.now();
  await builder.start();
  const starting = builder.status();
  await builder.idle();
  await builder.flush();
  return { index, builder, dir, buildMs: Date.now() - t0, starting };
}

test('the walk headline: "renting a new shop" finds Brunswick site lease renewal, an ordinary hit', async () => {
  const { index, builder, dir, buildMs, starting } = await built();
  try {
    assert.equal(index.meanings().hasTermVectors(), false, 'every note embedded: only embeddings answer');
    assert.match(starting.words, /Getting meaning search ready… \d+ of 30\d/, `the quiet line while building (${starting.words})`);
    console.log(`first-look timing: ${300 + Object.keys(TARGETS).length} notes built in ${buildMs} ms (threads: ${emb.threadsUsed})`);
    for (const [q, target] of QUERIES) {
      const note = `${target.replace(/\.md$/, '').split('/').pop()} ${TARGETS[target]}`;
      const shared = [...wordsOf(q)].filter((w) => wordsOf(note).has(w) && !['the', 'and', 'with', 'on', 'in', 'of', 'to', 'for'].includes(w));
      assert.deepEqual(shared, [], `${JSON.stringify(q)} shares no word with its target`);
      assert.ok(!index.search(q).some((h) => h.path === target && !h.meaning), `${JSON.stringify(q)}: no word hit on the target, so this proves the meaning path`);
      const t0 = Date.now();
      const hits = await index.searchAsync(q);
      console.log(`first-look timing: ${JSON.stringify(q)} answered in ${Date.now() - t0} ms`);
      const hit = hits.find((h) => h.path === target);
      assert.ok(hit, `${JSON.stringify(q)} finds ${target} (saw ${hits.slice(0, 5).map((h) => h.path).join(', ') || 'nothing'})`);
      assert.equal(hit.meaning, true, 'labelled as meaning, not words');
      assert.ok(hit.snippets.length >= 1, 'an ordinary hit carries preview lines');
    }
    assert.deepEqual(await index.searchAsync('zzz-no-such-note'), [], 'nonsense still finds nothing');
  } finally {
    builder.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 300000 });

test('a paraphrase with no shared ideas still reads as an ordinary hit: opening lines, not silence', async () => {
  // "cat sat on warm rug" shares no stem and no hashed idea with the Siesta note (pinned): the
  // hashed preview finder reads empty, so the hit falls back to the note's opening lines.
  const qb = M.meaningWords('cat sat on warm rug');
  const nb = M.meaningWords('Siesta Siesta The feline domestic companion reclined on the heated textile.');
  assert.equal(M.sharedConcepts(qb, nb), 0, 'no shared hashed idea');
  const sharedStems = [...qb.words.keys()].filter((w) => nb.words.has(w));
  assert.deepEqual(sharedStems, [], 'no shared stem either');
  const { index, builder, dir } = await built(60);
  try {
    const hits = await index.searchAsync('cat sat on warm rug');
    const hit = hits.find((h) => h.path === 'Notes/Siesta.md');
    assert.ok(hit && hit.meaning, 'found by meaning');
    assert.ok(hit.snippets.length >= 1, 'preview lines even with nothing shared');
    assert.ok(hit.snippets[0].text.includes('feline'), `the opening line, not silence (${hit.snippets[0].text})`);
  } finally {
    builder.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 300000 });

test('stored stand-in vectors are replaced safely when the real model loads', async () => {
  // A vault whose index answers from hashed stand-ins (as on Windows before the runner loaded):
  // once the model runs, every vector is replaced, none compared across the two spaces.
  const index = new M.VaultIndex();
  for (let i = 0; i < 20; i++) index.set(`Notes/Note ${i}.md`, `# Note ${i}\nFlour, sugar, butter, bake at 180.`, NOW, 10);
  index.set('Sites/Brunswick site lease renewal.md', TARGETS['Sites/Brunswick site lease renewal.md'], NOW, 10);
  assert.equal(index.meanings().hasTermVectors(), true, 'before the model: hashed stand-ins answer');
  assert.equal((index.meanings().vectors('Sites/Brunswick site lease renewal.md') ?? []).length, 128, 'the hashed width');
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-first-look-cache-'));
  try {
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
    index.attachRerank({ score: (q, texts) => rer.score(q, texts) });
    await builder.start();
    await builder.idle();
    try {
      assert.equal(index.meanings().hasTermVectors(), false, 'after the model: every stand-in replaced');
      assert.equal((index.meanings().vectors('Sites/Brunswick site lease renewal.md') ?? []).length, 384, 'the taught width');
      const hits = await index.searchAsync('renting a new shop');
      assert.ok(hits.some((h) => h.path === 'Sites/Brunswick site lease renewal.md' && h.meaning), 'the replaced index finds by meaning');
    } finally {
      builder.stop();
    }
    // A cache in a foreign width (never written by us: we keep embeddings only) is ignored and
    // rebuilt, never compared against the model's vectors.
    writeFileSync(
      path.join(dir, 'map.json'),
      JSON.stringify({ v: 1, dim: 128, order: [{ path: 'Sites/Brunswick site lease renewal.md', hash: 'deadbeef', chunks: 1 }] }),
    );
    writeFileSync(path.join(dir, 'vecs.f32'), Buffer.alloc(384 * 4));
    const orig = emb.embed.bind(emb);
    let runs = 0;
    emb.embed = async (texts) => {
      runs += texts.length;
      return orig(texts);
    };
    try {
      const index2 = new M.VaultIndex();
      for (let i = 0; i < 20; i++) index2.set(`Notes/Note ${i}.md`, `# Note ${i}\nFlour, sugar, butter, bake at 180.`, NOW, 10);
      index2.set('Sites/Brunswick site lease renewal.md', TARGETS['Sites/Brunswick site lease renewal.md'], NOW, 10);
      const builder2 = new M.MeaningBuilder({
        dir,
        embedder: emb,
        index: index2.meanings(),
        list: () => index2.allMeta().map((m) => m.path),
        read: (p) => {
          const meta = index2.get(p);
          const content = index2.content(p);
          return meta && content !== undefined ? { title: meta.label, content } : null;
        },
        isExcluded: (p) => index2.isExcluded(p),
      });
      await builder2.start();
      await builder2.idle();
      try {
        assert.ok(runs >= 21, `the foreign cache ignored, every note embedded again (${runs})`);
        assert.equal(index2.meanings().hasTermVectors(), false, 'rebuilt, not mixed');
      } finally {
        builder2.stop();
      }
    } finally {
      emb.embed = orig;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 300000 });
