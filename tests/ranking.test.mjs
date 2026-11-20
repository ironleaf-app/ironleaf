// node --test tests/ranking.test.mjs — Relevance ranking and related notes (src/shared/ranking.ts, src/shared/related.ts,
// src/main/indexer.ts; 21 Oct 2026, gap G25): BM25F over names, headings, properties and words, part-typed words, the
// recency and link boosts, search's "Best match first" in the index, the [[ / @ suggestion scores, and Related notes by
// links, tags, shared words and similar meaning (2 Nov 2026, 10.0: on this PC only), each with why. Made-up notes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-ranking-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/ranking.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/shared/related.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 21, 10, 0).getTime();
const doc = (path, content, more = {}) => ({ path, title: path.replace(/\.md$/, '').split('/').pop(), content, mtime: NOW - 400 * DAY, ...more });
const ranker = (docs, links = {}) => {
  const r = new R.Ranker();
  r.sync(1, docs, (p) => links[p] ?? []);
  return r;
};
const filler = (n) => Array.from({ length: n }, (_, i) => `filler${i % 40} words here`).join(' ');

test('BM25F: a word in the name counts most, then headings, then properties, then the words', () => {
  const r = ranker([
    doc('Crane hire.md', 'Notes about the site.'),
    doc('Site plan.md', '## Crane\nWhere it goes.', { headings: ['Crane'] }),
    doc('Lease.md', 'Body text.', { props: { supplier: 'Crane Co' } }),
    doc('Diary.md', 'We talked about the crane today.'),
    doc('Other.md', 'Nothing related at all.'),
  ]);
  assert.deepEqual(r.rank(['crane'], NOW).map((h) => h.path), ['Crane hire.md', 'Site plan.md', 'Lease.md', 'Diary.md']);
});

test('a rare word outranks a common one; a long note does not win for being long', () => {
  const docs = [
    doc('A.md', 'harbour quote for the fit-out'),
    doc('B.md', 'harbour harbour'),
    doc('C.md', 'harbour'),
    doc('D.md', `harbour ${filler(400)} quote`),
  ];
  const r = ranker(docs);
  const hits = r.rank(['harbour', 'quote'], NOW).map((h) => h.path);
  assert.equal(hits[0], 'A.md', 'both words, short note');
  assert.ok(hits.indexOf('A.md') < hits.indexOf('D.md'), 'the long note with both words comes after the short one');
  assert.ok(r.bm25f('A.md', ['quote']) > r.bm25f('A.md', ['harbour']), '"quote" is rarer than "harbour"');
});

test('9.2 plurals reach the singular, marks fold, and word order never matters for a name', () => {
  const bills = ranker([doc('Bill.md', 'the bill is due'), doc('Other.md', 'nothing here')]);
  assert.ok(bills.expand('bills').some((e) => e.word === 'bill'), 'expand reaches back to "bill"');
  assert.ok(bills.rank(['bills'], NOW).some((h) => h.path === 'Bill.md'), '"bills" reaches a note with "bill"');
  const cafe = ranker([doc('Cafe.md', 'meet at the café'), doc('Other.md', 'nothing here')]);
  assert.ok(cafe.rank(['cafe'], NOW).some((h) => h.path === 'Cafe.md'), '"cafe" reaches "café"');
  assert.equal(R.exactTitleBonus('Bill Visa', ['visa', 'bill']), 25, 'the name in any order');
  assert.equal(R.exactTitleBonus('My Bill Visa', ['visa', 'bill']), 0, 'extra words are no exact name');
});

test('a word typed part-way matches the words it starts, a little less than the whole word', () => {
  const r = ranker([doc('Harbour.md', 'x'), doc('Harb.md', 'x'), doc('Other.md', 'harbourside walk')]);
  const hits = r.rank(['harb'], NOW).map((h) => h.path);
  assert.equal(hits[0], 'Harb.md');
  assert.ok(hits.includes('Harbour.md') && hits.includes('Other.md'));
  assert.deepEqual(r.expand('ha'), [], 'two letters alone don’t expand');
});

test('recency and links lift a note a little; an exact name comes first', () => {
  assert.equal(R.recencyBoost(NOW, NOW), 1.25);
  assert.ok(R.recencyBoost(NOW - 45 * DAY, NOW) < 1.1 && R.recencyBoost(NOW - 45 * DAY, NOW) > 1.09);
  assert.equal(R.recencyBoost(0, NOW), 1);
  assert.equal(R.linkBoost(0), 1);
  assert.ok(R.linkBoost(1) > 1.1 && R.linkBoost(7) < 1.4);
  assert.equal(R.linkBoost(10_000), 1.5);
  const r = ranker([doc('Fresh.md', 'budget review', { mtime: NOW }), doc('Old.md', 'budget review'), doc('Hub.md', 'budget review'), doc('Budget review.md', 'notes')], { 'Fresh.md': ['Hub.md'], 'Old.md': ['Hub.md'] });
  const hits = r.rank(['budget', 'review'], NOW).map((h) => h.path);
  assert.equal(hits[0], 'Budget review.md', 'the exact name first');
  assert.ok(hits.indexOf('Fresh.md') < hits.indexOf('Old.md'), 'changed today beats a year ago');
  assert.ok(hits.indexOf('Hub.md') < hits.indexOf('Old.md'), 'linked to by two beats linked to by none');
  assert.equal(r.linksTo('Hub.md'), 2);
});

test('the index ranks search hits best match first; a search with no words keeps its old reading', () => {
  const index = new R.VaultIndex();
  index.set('Harbour fit-out.md', '# Harbour fit-out\nThe crane arrives Monday.', NOW - 300 * DAY, 10);
  index.set('Weekly.md', 'Spoke about the harbour and the harbour lease, and the harbour again.', NOW - 300 * DAY, 10);
  index.set('Inbox.md', 'Ring the crane company about the harbour #site', NOW, 10);
  const hits = index.search('harbour');
  assert.equal(hits[0].path, 'Harbour fit-out.md', 'the name beats saying it three times');
  assert.equal(hits.length, 3);
  assert.ok(hits.every((h) => h.score > 0));
  const tagged = index.search('tag:site');
  assert.deepEqual(tagged.map((h) => h.path), ['Inbox.md']);
  assert.ok(tagged[0].score > 0);
  // A changed note is ranked by its new words.
  index.set('Weekly.md', 'Nothing about it now.', NOW, 10);
  assert.deepEqual(index.search('harbour').map((h) => h.path).sort(), ['Harbour fit-out.md', 'Inbox.md']);
});

test('9.2 a hit shows its best lines first: most hits, prose before fenced code', () => {
  const index = new R.VaultIndex();
  index.set('Card.md', '# Credit Card\nThe credit card bill.\n\n```\ncredit card credit card credit card\n```\n\nPaid the credit card bill, credit card done.', NOW, 10);
  const [hit] = index.search('credit card', 10, 3);
  assert.equal(hit.path, 'Card.md');
  assert.equal(hit.snippets.length, 3);
  assert.match(hit.snippets[0].text, /Paid the credit card bill/, 'the line with most hits first');
  assert.deepEqual(hit.snippets.map((s) => s.line), [7, 0, 1], 'prose first, the fenced line left out');
});

test('suggestions: exact, then the start of the name, a word in it, inside it, letters in order; aliases a little less', () => {
  const s = (typed, note) => R.suggestionScore(typed, { mtime: NOW - 400 * DAY, inLinks: 0, ...note }, NOW).score;
  assert.ok(s('sam', { title: 'Sam' }) > s('sam', { title: 'Sam Okafor' }));
  assert.ok(s('sam', { title: 'Sam Okafor' }) > s('sam', { title: 'Call with Sam' }));
  assert.ok(s('sam', { title: 'Call with Sam' }) > s('sam', { title: 'Balsamic' }));
  assert.ok(s('sam', { title: 'Samples ok' }) > s('sam', { title: 'Balsamic' }), 'starting the name beats being inside it');
  assert.ok(s('hbr', { title: 'Harbour' }) > 0, 'letters in order');
  assert.equal(s('zzz', { title: 'Harbour' }), 0);
  assert.equal(R.suggestionScore('okafor', { title: 'Sam O', aliases: ['Okafor'], mtime: 0, inLinks: 0 }, NOW).match, 'Okafor');
  assert.ok(s('sam', { title: 'Sam Okafor' }) > s('sam', { title: 'Zed', aliases: ['Sam Okafor'] }), 'the name beats an alias');
  // The same boosts as search, and a little more for a note near the one being written.
  assert.ok(s('sam', { title: 'Sam B', mtime: NOW }) > s('sam', { title: 'Sam A' }));
  assert.ok(s('sam', { title: 'Sam B', inLinks: 5 }) > s('sam', { title: 'Sam A' }));
  assert.ok(s('sam', { title: 'Sam B', near: true }) > s('sam', { title: 'Sam A' }));
  // Nothing typed: the notes changed lately and linked most first.
  assert.ok(s('', { title: 'B', mtime: NOW }) > s('', { title: 'A' }));
  const counts = R.linkCountsByName([{ links: [{ target: 'Sam Okafor' }, { target: 'People/Sam Okafor.md' }] }, { links: [{ target: 'sam okafor#About' }] }]);
  assert.equal(counts.get('sam okafor'), 2, 'one note linking twice counts once');
});

const words = (text) => {
  const m = new Map();
  for (const w of R.rankWords(text)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

test('related notes: links, notes linked from the same notes, the same notes linked to, tags and words, each with why', () => {
  const docs = [
    { path: 'Harbour.md', title: 'Harbour', tags: ['fit-out'], links: ['Crane.md', 'Lease.md'], text: 'crane lease signage harbour opening' },
    { path: 'Crane.md', title: 'Crane', tags: [], links: [], text: 'crane hire booking' },
    { path: 'Wharf.md', title: 'Wharf', tags: ['fit-out'], links: ['Lease.md'], text: 'wharf lease signage opening' },
    { path: 'Weekly.md', title: 'Weekly', tags: [], links: ['Harbour.md', 'Bakery.md'], text: 'weekly plan' },
    { path: 'Bakery.md', title: 'Bakery', tags: [], links: [], text: 'flour ovens' },
    { path: 'Lease.md', title: 'Lease', tags: [], links: [], text: 'lease terms' },
    { path: 'Recipes.md', title: 'Recipes', tags: ['food'], links: [], text: 'flour sugar butter' },
    { path: 'Templates/Plan.md', title: 'Plan', tags: ['fit-out'], links: ['Lease.md'], text: 'lease signage opening' },
  ];
  const byPath = new Map(docs.map((d) => [d.path, words(`${d.title} ${d.text}`)]));
  const df = (w) => docs.filter((d) => byPath.get(d.path).has(w)).length;
  const opts = { words: (p) => byPath.get(p), rarity: (w) => Math.log(1 + (docs.length - df(w) + 0.5) / (df(w) + 0.5)), skip: (p) => p.startsWith('Templates/') };
  const list = R.relatedTo('Harbour.md', docs, opts);
  const at = (p) => list.find((x) => x.path === p);
  assert.ok(!at('Templates/Plan.md'), 'notes never suggested are left out');
  assert.ok(!at('Recipes.md'), 'nothing shared: not related');
  assert.equal(at('Crane.md').reasons[0], 'This note links to it');
  assert.ok(at('Wharf.md').reasons.includes('Both link to Lease'));
  assert.ok(at('Wharf.md').reasons.includes('Both tagged #fit-out'));
  assert.ok(at('Wharf.md').reasons.some((r) => /^Shares words: /.test(r) && r.includes('signage')));
  assert.equal(at('Bakery.md').reasons[0], 'Both linked from Weekly');
  assert.equal(at('Weekly.md').reasons[0], 'Links to this note');
  assert.equal(list[0].path, 'Wharf.md', 'sharing links, a tag and words beats one link alone');
  assert.ok(list.every((x, i) => i === 0 || list[i - 1].score >= x.score), 'most alike first');
  assert.ok(list.every((x) => x.score > 0 && x.score <= 1));
  assert.deepEqual(R.relatedTo('Nowhere.md', docs, opts), []);
  // Meaning from this PC's meaning index counts only when both notes have one (2 Nov 2026, 10.0: on-PC only).
  const vectors = (p) => ({ 'Harbour.md': [1, 0, 0], 'Recipes.md': [0.95, 0.05, 0] })[p] ?? null;
  const withMeaning = R.relatedTo('Harbour.md', docs, { ...opts, vectors });
  const recipes = withMeaning.find((x) => x.path === 'Recipes.md');
  assert.ok(recipes, 'alike in meaning though sharing no words');
  assert.ok(recipes.reasons.includes('Similar meaning'));
  assert.ok(recipes.parts.meaning > 0.9);
  assert.equal(withMeaning.find((x) => x.path === 'Crane.md').parts.meaning, undefined, 'no vector: meaning left out');
});

test('related notes use meaning only when both vectors share a space (embedded never meets hashed)', () => {
  const docs = [
    { path: 'Harbour.md', title: 'Harbour', tags: ['fit-out'], links: ['Crane.md', 'Lease.md'] },
    { path: 'Crane.md', title: 'Crane', tags: [], links: [] },
    { path: 'Wharf.md', title: 'Wharf', tags: ['fit-out'], links: ['Lease.md'] },
    { path: 'Weekly.md', title: 'Weekly', tags: [], links: ['Harbour.md', 'Bakery.md'] },
    { path: 'Bakery.md', title: 'Bakery', tags: [], links: [] },
    { path: 'Lease.md', title: 'Lease', tags: [], links: [] },
    { path: 'Recipes.md', title: 'Recipes', tags: ['food'], links: [] },
  ];
  const texts = { 'Harbour.md': 'Harbour crane lease signage harbour opening', 'Crane.md': 'Crane crane hire booking', 'Wharf.md': 'Wharf wharf lease signage opening', 'Weekly.md': 'Weekly weekly plan', 'Bakery.md': 'Bakery flour ovens', 'Lease.md': 'Lease lease terms', 'Recipes.md': 'Recipes flour sugar butter' };
  const byPath = new Map(Object.entries(texts).map(([p, t]) => [p, words(t)]));
  const df = (w) => [...byPath.values()].filter((m) => m.has(w)).length;
  const opts = { words: (p) => byPath.get(p), rarity: (w) => Math.log(1 + (byPath.size - df(w) + 0.5) / (df(w) + 0.5)) };
  const plain = R.relatedTo('Harbour.md', docs, opts);
  // While the on-device build runs, an embedded note (3-wide here) stands beside hashed ones (2-wide): meaning
  // sits out for every cross-space pair, and the weights never shift.
  const mixed = (p) => ({ 'Harbour.md': [1, 0, 0], 'Wharf.md': [1, 0], 'Recipes.md': [0.99, 0.01] })[p] ?? null;
  const list = R.relatedTo('Harbour.md', docs, { ...opts, vectors: mixed });
  assert.deepEqual(list.map((x) => x.path), plain.map((x) => x.path), 'mixed spaces change nothing: links, tags and words decide');
  assert.ok(list.every((x) => x.parts.meaning === undefined), 'no meaning part anywhere across spaces');
  assert.ok(!list.some((x) => x.path === 'Recipes.md'), 'no meaning lift across spaces either');
  // Same space still counts (the 10.0 on-PC meaning the earlier test proves).
  const same = (p) => ({ 'Harbour.md': [1, 0, 0], 'Recipes.md': [0.99, 0.01, 0] })[p] ?? null;
  const withMeaning = R.relatedTo('Harbour.md', docs, { ...opts, vectors: same });
  assert.ok((withMeaning.find((x) => x.path === 'Recipes.md')?.parts.meaning ?? 0) > 0.9, 'one space: meaning counts');
});

test('the index gives Related notes from its own notes, worked out on this PC', () => {
  const index = new R.VaultIndex();
  index.set('Harbour.md', '---\ntags: [fit-out]\n---\n# Harbour\nThe crane and the [[Lease]] for the signage.', NOW, 10);
  index.set('Wharf.md', '---\ntags: [fit-out]\n---\n# Wharf\nThe [[Lease]] for the signage and the crane.', NOW, 10);
  index.set('Lease.md', 'Terms.', NOW, 10);
  index.set('Recipes.md', 'Flour, sugar, butter.', NOW, 10);
  const list = index.relatedNotes('Harbour.md');
  assert.equal(list[0].path, 'Wharf.md');
  assert.ok(list[0].reasons.includes('Both link to Lease'));
  assert.ok(list[0].reasons.includes('Both tagged #fit-out'));
  assert.ok(!list.some((x) => x.path === 'Recipes.md'));
  assert.ok(list.some((x) => x.path === 'Lease.md' && x.reasons[0] === 'This note links to it'));
  assert.deepEqual(index.relatedNotes('Harbour.md', 12, (p) => p === 'Wharf.md').map((x) => x.path), ['Lease.md']);
});

test('9.2 every related surface agrees: the same engine, linked notes left out where asked', () => {
  const index = new R.VaultIndex();
  index.set('Harbour.md', '---\ntags: [fit-out]\n---\n# Harbour\nThe crane and the [[Lease]] for the signage.', NOW, 10);
  index.set('Wharf.md', '---\ntags: [fit-out]\n---\n# Wharf\nThe [[Lease]] for the signage and the crane.', NOW, 10);
  index.set('Lease.md', 'Terms.', NOW, 10);
  index.set('Recipes.md', 'Flour, sugar, butter.', NOW, 10);
  const panel = index.relatedNotes('Harbour.md').map((x) => x.path);
  const plain = index.related('Harbour.md').map((x) => x.path);
  assert.deepEqual(plain, panel.filter((p) => p !== 'Lease.md'), 'one answer: linked notes left out, order kept');
  assert.equal(plain[0], 'Wharf.md');
});
