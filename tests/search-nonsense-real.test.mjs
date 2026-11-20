// node --test tests/search-nonsense-real.test.mjs — nonsense must find nothing, with the REAL model
// (v12search, 2 Nov 2026: typing "zzz-no-such-note" in the real window showed "Best matches · 2 Launch
// notes, Similar meaning" because the embedding path had cosine alone, no confirmation). Every meaning-only
// hit is now confirmed before it shows: a strong cosine shows unasked, a weaker one shows only when the
// on-device reranker confirms it, otherwise it is dropped — with the real embedder and the real cross-encoder
// (resources/models), over the shots-w4vault fixture notes frozen word for word (dates frozen to 2 Nov 2026:
// measured identical to 4dp against +60-day dates, so the reviewer's live-date run scores the same). Made-up
// notes in temporary folders, never a real vault; nothing leaves this PC.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-search-nonsense-'));
const embedDir = path.join(root, 'resources', 'models', 'all-MiniLM-L6-v2');
const rerankDir = path.join(root, 'resources', 'models', 'ms-marco-MiniLM-L-6-v2');
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
let M;
let ort;
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
  ort = await import(pathToFileURL(path.join(ortDist, 'ort.node.min.mjs')).href);
  emb = new M.MeaningEmbedder({ modelDir: embedDir, factory: M.ortSessionFactory(ort, ortDist), threads: 1 });
  assert.equal((await emb.start()).ok, true, 'the on-device model starts in the test');
  rer = new M.MeaningReranker({ modelDir: rerankDir, factory: M.ortPairSessionFactory(ort, ortDist), threads: 1 });
  assert.equal(await rer.start(), true, 'the cross-encoder starts in the test');
  shared = await built();
  assert.equal(shared.index.meanings().hasTermVectors(), false, 'every note embedded: only embeddings can answer');
}, { timeout: 180000 });
after(async () => {
  shared?.builder.stop();
  await emb?.close().catch(() => {});
  await rer?.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
// The shots-w4vault.mjs fixture, frozen word for word (2 Nov 2026 dates), plus paraphrase targets that share no
// content word with their queries (TechParts, TechLease, Cake, Roster, Dentist, Deadline).
const NOTES = {
  'Projects/Launch/Launch.md': '---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 60\nowner: Mia Tran\ndue: "2026-11-11"\nupdated: "2026-11-02"\n---\n# Launch\n\n## Summary\n\nForty Mini units land before launch day, and the product page goes live the Monday before.\n\n## What\'s next\n\n- [ ] Send the signed form — Mia · by 30 Oct\n- [ ] Book the hall — Mia · by 2 Nov\n- [ ] Print the agenda — Mia · by 6 Nov\n- [ ] Send the invoice — Priya Nair · by 4 Nov\n- [x] Export the device inventory — Mia\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| 7 Nov 2026 | Doors open | on track |\n\n## Risks and issues\n\n- **High** — The hall isn\'t booked\n\n## Notes\n',
  'Notes/Launch notes.md': '---\ntype: note\ntags: [launch]\n---\n# Launch notes\n\nThe hall holds 200. See [[Supplier quote]] for the catering numbers and [[Projects/Launch/Launch|the launch plan]].\n\n- [ ] Confirm the headcount — Mia · by 3 Nov\n',
  'Notes/Supplier quote.md': '# Supplier quote\n\nCatering for 200, two courses, $38 a head.\n',
  'People/Sam Okafor.md': '---\ntype: person\nrole: Supplier\norg: Harbour Fit-outs\nemail: sam@example.com\n---\n# Sam Okafor\n\nRuns the Harbour store fit-out.\n',
  'People/Priya Nair.md': '---\ntype: person\nrole: Buyer\norg: Box Hill Institute\n---\n# Priya Nair\n\nFirst buyer, twelve workstations.\n',
  'Resources/Hall layouts.md': '---\ntype: resource\nkind: Link\nurl: https://example.com/hall-layouts\nauthor: Harbour Venues\nstatus: Reading\n---\n# Hall layouts\n\nThe room plans for the three shortlisted halls.\n',
  'Resources/Catering menus.md': '---\ntype: resource\nkind: Article\nauthor: Priya Nair\nstatus: To read\n---\n# Catering menus\n\nWhat the shortlisted caterers serve for 200.\n',
  'Meetings/Standup.md': '---\ndate: 2026-11-02\ntime: "09:00"\nattendees: [Mia Tran]\ntags: [meeting]\n---\n# Standup\n\nWhat each of us is doing today.\n\n## Actions\n\n- [ ] Book the hall — Mia · by 2 Nov\n',
  'Daily/2026-11-02.md': '## Notes\n\n- [ ] Call Priya — by 2 Nov 2026\n',
  'Me/Finance/Bills/Harbour Internet.md': '---\ntype: bill\namount: \'89.00\'\ncycle: Monthly\ndue: 2026-10-30\ncategory: Phone and internet\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n',
  'Me/Finance/Bills/Gym.md': '---\ntype: bill\namount: \'29.00\'\ncycle: Monthly\ndue: 2026-11-07\ncategory: Health\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n',
  'Notes/TechParts.md': '# TechParts\nKeep shipping late.',
  'Notes/TechLease vendor.md': '# TechLease vendor\nThird shipment slipped again. Stock arrived late twice, always behind schedule. Thinking of switching contractor.',
  'Notes/Cake.md': '# Cake\nFlour, sugar, butter, bake at 180.',
  'Notes/Roster.md': '# Roster\nDiscussed the weekend roster with the team.',
  'Notes/Dentist bill.md': '# Dentist bill\nTooth check and clean, $180, due Friday.',
  'Notes/Deadline miss.md': '# Deadline miss\nThe provider missed the consignment deadline. Overdue, waiting on the booking.',
};

/** A VaultIndex with the fixture, attached to a builder, built to idle (the reranker attaches per test). */
async function built(extra = []) {
  const index = new M.VaultIndex();
  for (const [p, t] of Object.entries(NOTES)) index.set(p, t, NOW, 10);
  for (const [p, t] of extra) index.set(p, t, NOW, 10);
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-nonsense-cache-'));
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
  return { index, builder, dir };
}
let shared = null;
const withRerank = (index) => index.attachRerank({ score: (q, texts) => rer.score(q, texts) });
/** Word hits alone (sync search carries hashed meaning too; the flag tells them apart). */
const wordPaths = (index, q) => index.search(q).filter((h) => !h.meaning).map((h) => h.path);

test('zzz-no-such-note finds nothing with the real model, with and without the reranker', async () => {
  withRerank(shared.index);
  assert.deepEqual(await shared.index.searchAsync('zzz-no-such-note'), [], 'with the reranker: nothing at all, so the view shows Nothing matches');
  shared.index.attachRerank(null);
  try {
    assert.deepEqual(await shared.index.searchAsync('zzz-no-such-note'), [], 'without the reranker: the cosine bar alone still finds nothing');
  } finally {
    withRerank(shared.index);
  }
});

const NONSENSE = [
  'zzz-no-such-note', 'xqjv', 'blorpt', 'zzzzzzzzz', 'asdkfjhasd', 'qwxyz',
  'kjsdfh ksjdhf kjsdhf', 'zzzzz qqqqq xxxxx', 'lorem ipsum xyzzy', 'asdfghjkl',
  'qwerty uiop', 'supercalifragilistic', 'flibbertigibbet', 'aaaaaaaaaa bbbbbbbbbb',
  'wobble gobbledegook fiddlesticks', '1234567890', 'zzz 123 qqq', 'mnbv cxxz',
  'qxjvkw pffft zzzzzzzzzz', 'aoeu ht ns',
];
test('twenty nonsense queries find nothing: gibberish, single made-up tokens, random letters', async () => {
  assert.ok(NONSENSE.length >= 15, 'at least 15 nonsense queries pinned');
  withRerank(shared.index);
  for (const q of NONSENSE) {
    assert.deepEqual(wordPaths(shared.index, q), [], `${JSON.stringify(q)}: no word hit, so only confirmation stands between it and the list`);
    assert.deepEqual(await shared.index.searchAsync(q), [], `${JSON.stringify(q)} finds nothing`);
  }
  shared.index.attachRerank(null);
  try {
    for (const q of NONSENSE) assert.deepEqual(await shared.index.searchAsync(q), [], `${JSON.stringify(q)} finds nothing without the reranker too`);
  } finally {
    withRerank(shared.index);
  }
});

const PARAPHRASES = [
  ['supplier missed flour delivery', 'Notes/TechParts.md'],
  ['the supplier who kept missing delivery dates', 'Notes/TechParts.md'],
  ['who is working on Saturday and Sunday', 'Notes/Roster.md'],
  ['how many people fit in the venue', 'Notes/Launch notes.md'],
  ['how many guests fit inside the hall', 'Notes/Launch notes.md'],
  ['which person looks after the store fitout', 'People/Sam Okafor.md'],
  ['when is the teeth cleaning bill due', 'Notes/Dentist bill.md'],
  ['who covers weekends on the roster', 'Notes/Roster.md'],
  ['the caterers and what they serve', 'Resources/Catering menus.md'],
  ['where are the room plans', 'Resources/Hall layouts.md'],
  ['cake ingredients and baking', 'Notes/Cake.md'],
  ['what is the group doing this morning', 'Meetings/Standup.md'],
];
test('twelve true paraphrases still find their note, labelled Similar meaning', async () => {
  assert.ok(PARAPHRASES.length >= 10, 'at least 10 true paraphrases pinned');
  withRerank(shared.index);
  for (const [q, target] of PARAPHRASES) {
    assert.deepEqual(wordPaths(shared.index, q), [], `${JSON.stringify(q)}: no word hit, so this proves the meaning path`);
    const hits = await shared.index.searchAsync(q);
    const hit = hits.find((h) => h.path === target);
    assert.ok(hit, `${JSON.stringify(q)} still finds ${target} (saw ${hits.map((h) => h.path).join(', ') || 'nothing'})`);
    assert.equal(hit.meaning, true, 'labelled as meaning, not words');
  }
});

test('without the reranker the strong paraphrases still find their note; the moderate one waits', async () => {
  shared.index.attachRerank(null);
  try {
    for (const [q, target] of PARAPHRASES) {
      const hits = await shared.index.searchAsync(q);
      if (q === 'how many people fit in the venue') {
        assert.ok(!hits.some((h) => h.path === target), 'the moderate cosine (0.3851) needs the reranker: dropped, never guessed');
      } else {
        assert.ok(hits.some((h) => h.path === target), `${JSON.stringify(q)} still finds ${target} on the cosine bar alone`);
      }
    }
  } finally {
    withRerank(shared.index);
  }
});

test('the bars sit in their measured gaps (a model upgrade that moves scores says so here)', async () => {
  withRerank(shared.index);
  let nonsenseTop = 0;
  for (const q of NONSENSE) {
    const qv = (await emb.embed([q]))[0];
    for (const c of shared.index.meanings().searchVector(qv, { limit: 5, min: 0 })) nonsenseTop = Math.max(nonsenseTop, c.score);
  }
  assert.ok(nonsenseTop < M.EMBED_CONFIRM_MIN, `nonsense tops ${nonsenseTop.toFixed(4)}, below the cosine bar ${M.EMBED_CONFIRM_MIN} (measured 0.3936)`);
  const COS_KEPT = PARAPHRASES.filter(([q]) => q !== 'how many people fit in the venue');
  for (const [q, target] of COS_KEPT) {
    const qv = (await emb.embed([q]))[0];
    const cands = shared.index.meanings().searchVector(qv, { limit: 5, min: 0 });
    const cand = cands.find((c) => c.path === target);
    assert.ok(cand && cand.score >= M.EMBED_CONFIRM_MIN, `${JSON.stringify(q)} -> ${target} clears the cosine bar (remeasure the bar if this fails)`);
  }
  // The reranker bar: the rescued paraphrase clears it, the nonsense that reaches confirmation does not.
  const venueQv = (await emb.embed(['how many people fit in the venue']))[0];
  const venueCands = shared.index.meanings().searchVector(venueQv, { limit: 5, min: M.EMBED_SEARCH_MIN });
  assert.ok(venueCands.some((c) => c.path === 'Notes/Launch notes.md'), 'the venue paraphrase reaches confirmation');
  const zzzQv = (await emb.embed(['zzz-no-such-note']))[0];
  const zzzCands = shared.index.meanings().searchVector(zzzQv, { limit: 5, min: M.EMBED_SEARCH_MIN });
  assert.ok(zzzCands.length >= 2, 'nonsense still reaches confirmation as candidates (the bar does the dropping, not retrieval)');
  const confirmText = (p) => {
    const meta = shared.index.get(p);
    let content = shared.index.content(p) ?? '';
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---', 3);
      if (end > 0) content = content.slice(end + 4);
    }
    return `${meta.label}\n${content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8).join('\n')}`.slice(0, M.RERANK_MAX_TEXT_CHARS);
  };
  const venueScores = await rer.score('how many people fit in the venue', venueCands.map((c) => confirmText(c.path)));
  const venueHit = venueCands.findIndex((c) => c.path === 'Notes/Launch notes.md');
  assert.ok(venueScores[venueHit] >= M.RERANK_CONFIRM_MIN, `the venue paraphrase clears the reranker bar (${venueScores[venueHit].toExponential(2)} >= ${M.RERANK_CONFIRM_MIN})`);
  const zzzScores = await rer.score('zzz-no-such-note', zzzCands.map((c) => confirmText(c.path)));
  assert.ok(zzzScores.every((s) => s < M.RERANK_CONFIRM_MIN), `nonsense stays below the reranker bar (max ${Math.max(...zzzScores).toExponential(2)}, measured 2.1e-5)`);
});

test('confirmation costs one small batched run, and word-only searches never ask', async () => {
  const widths = [];
  shared.index.attachRerank({
    score: async (q, texts) => {
      widths.push(texts.length);
      return rer.score(q, texts);
    },
  });
  try {
    const hits = await shared.index.searchAsync('how many people fit in the venue');
    assert.ok(hits.some((h) => h.path === 'Notes/Launch notes.md'), 'the rescued paraphrase still found through the counting wrapper');
    assert.ok(widths.length >= 1 && widths.length <= 2, `one confirmation run plus the top-list re-score at most (${widths.length})`);
    assert.ok(widths[0] <= 5, `confirmation scores at most the meaning candidates (${widths[0]})`);
    assert.ok(widths.every((w) => w <= M.RERANK_MAX), 'no run wider than the re-score cap');
    widths.length = 0;
    assert.deepEqual(await shared.index.searchAsync('tag:no-such-tag-zz'), [], 'an operator miss stays empty');
    assert.deepEqual(await shared.index.searchAsync('   '), [], 'nothing asked finds nothing');
    assert.equal(widths.length, 0, 'no candidates, no confirmation run, no re-score of one');
  } finally {
    withRerank(shared.index);
  }
});

test('confirmation never reads a private note', async () => {
  const MARK = 'ClassifiedXJ29';
  const own = await built([[`Private notes/${MARK} supplier.md`, `# ${MARK} supplier\n${MARK} vendor missing delivery dates late again.`]]);
  try {
    const seen = [];
    own.index.attachRerank({
      score: async (q, texts) => {
        seen.push(...texts);
        return texts.map(() => 0.5);
      },
    });
    const hits = await own.index.searchAsync('the supplier who kept missing delivery dates');
    assert.ok(!seen.some((t) => t.includes(MARK)), 'the confirmation run never read the private note');
    assert.deepEqual(hits.filter((h) => h.path.startsWith('Private notes/')), [], 'no private hit to confirm');
    assert.ok(hits.some((h) => h.path === 'Notes/TechParts.md'), 'the open paraphrase still found');
  } finally {
    own.builder.stop();
    rmSync(own.dir, { recursive: true, force: true });
  }
});

test('a note with the exact words still comes first, the confirmed paraphrase after it', async () => {
  const own = await built([['Notes/Supplier report.md', '# Supplier report\nThe supplier who kept missing delivery dates called today. Mia will ring them back.']]);
  try {
    withRerank(own.index);
    const hits = await own.index.searchAsync('the supplier who kept missing delivery dates');
    assert.equal(hits[0].path, 'Notes/Supplier report.md', 'the word-identical note first');
    assert.ok(!hits[0].meaning, 'a word match carries no meaning label');
    const paraphrase = hits.find((h) => h.path === 'Notes/TechParts.md');
    assert.ok(paraphrase && paraphrase.meaning, 'the paraphrase follows, labelled');
  } finally {
    own.builder.stop();
    rmSync(own.dir, { recursive: true, force: true });
  }
});
