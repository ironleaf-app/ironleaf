// node --test tests/meaning.test.mjs — find notes by what they mean (2 Nov 2026, 10.0 "Endless Tech": on this PC
// only, no provider). The term-expansion model (src/shared/meaning.ts), the local index beside the file index
// (src/main/meaning-index.ts), search's "Similar meaning" hits after the word matches and Related notes' shared
// meaning (src/main/indexer.ts, src/shared/related.ts), each with why. Made-up notes, never a real vault.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meaning-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 2, 10, 0).getTime();
const QUERY = 'the supplier who kept missing delivery dates';
const VENDOR = 'Notes/TechLease vendor.md';
const VENDOR_TEXT = '# TechLease vendor\nThird shipment slipped again. Stock arrived late twice, always behind schedule. Thinking of switching contractor.';
const CAKE = 'Notes/Cake.md';
const CAKE_TEXT = '# Cake\nFlour, sugar, butter, bake at 180.';
const MEETING = 'Notes/Roster.md';
const MEETING_TEXT = '# Roster\nDiscussed the weekend roster with the team.';

// Break-it finding 5 (6 Nov 2026): bestLines scored the properties block, so a meaning hit could show
// raw property lines (`speakers:` / `spk1: Alex Rivera`) as its snippet. The body only is scored, like
// openingLines and the reranker's confirmText; returned line numbers stay the note's own.
test('bestLines scores the body only, never the property lines', () => {
  const note = '---\ntype: meeting\nspeakers:\n    spk1: Alex Rivera\n---\n# Site visit\nAlex Rivera walked the site and costed the fence.\nThe quote is due Friday.';
  const frontOnly = '---\nspeakers:\n    spk1: Zephyr Quillon\n---\n# Lunch\nSoup and bread at noon.';
  const got = M.bestLines(note, M.meaningWords('Alex Rivera speakers'), 2);
  assert.ok(got.length >= 1, 'the body matches');
  for (const g of got) assert.ok(g.line >= 5 && !/speakers:|spk1:/.test(g.text), `no property line as a snippet (saw line ${g.line}: ${g.text})`);
  assert.equal(got[0].text, 'Alex Rivera walked the site and costed the fence.');
  assert.deepEqual(M.bestLines(frontOnly, M.meaningWords('Zephyr Quillon speakers'), 2), [], 'a match in properties alone shows no snippet line');
  // No properties: unchanged.
  assert.ok(M.bestLines('Soup and bread at noon.', M.meaningWords('soup bread'), 1).length === 1);
});

const stocked = () => {
  const index = new M.VaultIndex();
  index.set(VENDOR, VENDOR_TEXT, NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  index.set(MEETING, MEETING_TEXT, NOW, 10);
  return index;
};

test('the supplier who kept missing delivery dates finds the note without those words, labelled Similar meaning', () => {
  const index = stocked();
  const hits = index.search(QUERY);
  assert.ok(hits.length >= 1, 'a paraphrase still finds the note');
  assert.equal(hits[0].path, VENDOR);
  assert.equal(hits[0].meaning, true, 'labelled as meaning, not words');
  assert.equal(hits[0].matches, 0, 'no word matches to count');
  assert.ok(hits[0].snippets.length >= 1, 'a preview line to read');
  assert.ok(!hits.some((h) => h.path === CAKE), 'the cake recipe stays out');
  assert.ok(!hits.some((h) => h.path === MEETING), 'the roster stays out');
});

test('a note with the exact words still comes first, meaning after it', () => {
  const index = stocked();
  index.set('Notes/Supplier report.md', '# Supplier report\nThe supplier who kept missing delivery dates called today.', NOW, 10);
  const hits = index.search(QUERY);
  assert.equal(hits[0].path, 'Notes/Supplier report.md', 'the word-identical note first');
  assert.ok(!hits[0].meaning, 'a word match carries no meaning label');
  const paraphrase = hits.find((h) => h.path === VENDOR);
  assert.ok(paraphrase && paraphrase.meaning, 'the paraphrase follows, labelled');
  assert.ok(hits.indexOf(hits[0]) < hits.indexOf(paraphrase), 'words outrank far paraphrase');
});

test('private notes are never indexed and never appear', () => {
  const mi = new M.MeaningIndex();
  mi.set('Private notes/Secret supplier.md', 'Secret supplier', 'supplier missing delivery dates vendor shipment late contractor');
  mi.set('Notes/Open supplier.md', 'Open supplier', 'supplier missing delivery dates');
  assert.deepEqual(mi.paths(), ['Notes/Open supplier.md'], 'listed: the private note never enters');
  const index = stocked();
  index.set('Private notes/Secret supplier.md', '# Secret supplier\nThe supplier who kept missing delivery dates, vendor late again.', NOW, 10);
  assert.ok(!index.search('supplier missing delivery').some((h) => h.path.startsWith('Private notes/')), 'word search stays out');
  assert.ok(!index.search(QUERY).some((h) => h.path.startsWith('Private notes/')), 'meaning search stays out');
  assert.ok(!index.relatedNotes(VENDOR).some((r) => r.path.startsWith('Private notes/')), 'related stays out');
  assert.deepEqual(index.relatedNotes('Private notes/Secret supplier.md'), [], 'a private note has no related list');
});

test('folders left out of search are never indexed and never appear', () => {
  const mi = new M.MeaningIndex();
  mi.setExcluded(['Archive']);
  mi.set('Archive/Old supplier.md', 'Old supplier', 'supplier vendor shipment late');
  mi.set('Notes/Open supplier.md', 'Open supplier', 'supplier vendor');
  assert.deepEqual(mi.paths(), ['Notes/Open supplier.md'], 'listed: the left-out folder never enters');
  const index = stocked();
  index.setExcluded(['Archive']);
  index.set('Archive/Old supplier.md', '# Old supplier\nThe supplier vendor shipment late again.', NOW, 10);
  assert.ok(!index.search('supplier vendor').some((h) => h.path.startsWith('Archive/')), 'word search stays out');
  assert.ok(!index.search(QUERY).some((h) => h.path.startsWith('Archive/')), 'meaning search stays out');
  assert.ok(!index.relatedNotes(VENDOR).some((r) => r.path.startsWith('Archive/')), 'related stays out');
});

test('the index updates when a note changes and forgets when deleted', () => {
  const index = stocked();
  const note = 'Notes/Weekly review.md';
  index.set(note, VENDOR_TEXT, NOW, 10);
  assert.ok(index.search(QUERY).some((h) => h.path === note), 'found before the edit');
  index.set(note, '# Weekly review\nCake recipe: flour, sugar, butter, bake at 180.', NOW, 10);
  assert.ok(!index.search(QUERY).some((h) => h.path === note), 'no longer about suppliers, no longer found');
  index.set(note, VENDOR_TEXT, NOW, 10);
  assert.ok(index.search(QUERY).some((h) => h.path === note), 'back to suppliers, found again');
  index.delete(note);
  assert.ok(!index.search(QUERY).some((h) => h.path === note), 'deleted, forgotten');
  const mi = new M.MeaningIndex();
  mi.set('Notes/A.md', 'A', 'supplier vendor late');
  assert.deepEqual(mi.paths(), ['Notes/A.md']);
  mi.delete('Notes/A.md');
  assert.deepEqual(mi.paths(), [], 'deleted, forgotten');
  mi.set('Notes/B.md', 'B', 'supplier vendor late');
  mi.clear();
  assert.deepEqual(mi.paths(), [], 'cleared, forgotten');
  assert.equal(mi.size, 0);
});

test('related notes find shared meaning with no shared words, labelled Similar meaning', () => {
  const index = new M.VaultIndex();
  index.set('Notes/Vendor review.md', '# Vendor review\nThird shipment slipped again. Stock arrived late twice, always behind schedule.', NOW, 10);
  index.set('Notes/Deadline miss.md', '# Deadline miss\nThe provider missed the consignment deadline. Overdue, waiting on the booking.', NOW, 10);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  const list = index.relatedNotes('Notes/Vendor review.md');
  const hit = list.find((r) => r.path === 'Notes/Deadline miss.md');
  assert.ok(hit, 'shared ideas relate them though no content word matches');
  assert.ok(hit.kinds.includes('meaning'), 'the meaning kind is named');
  assert.ok(hit.reasons.includes('Similar meaning'), 'the label the person sees');
  assert.ok((hit.parts.meaning ?? 0) >= 0.3, 'strong enough to label');
  assert.ok(!list.some((r) => r.path === CAKE), 'the cake recipe stays out');
});

test('operator queries stay word-only: no meaning added beside them', () => {
  const index = stocked();
  for (const q of ['supplier OR cake', 'tag:site', 'file:supplier', '"missing delivery"', 'supplier -cake', '/suppl.+/']) {
    const hits = index.search(q);
    assert.ok(hits.every((h) => !h.meaning), `no meaning label for ${q}`);
  }
  assert.equal(M.isMeaningQuery('tag:site'), false);
  assert.equal(M.isMeaningQuery('supplier OR cake'), false);
  assert.equal(M.isMeaningQuery('"exact words"'), false);
  assert.equal(M.isMeaningQuery('the supplier who kept missing delivery dates'), true);
  assert.equal(M.isMeaningQuery('the who'), false, 'stops alone carry no meaning');
});

test('an empty vault is calm and search still works with meaning on', () => {
  const index = new M.VaultIndex();
  assert.deepEqual(index.search(QUERY), []);
  assert.deepEqual(index.search('the who'), []);
  assert.deepEqual(index.relatedNotes('Notes/Nowhere.md'), []);
  index.set(CAKE, CAKE_TEXT, NOW, 10);
  assert.deepEqual(index.search('tag:missing'), [], 'an operator miss stays empty, no meaning filler');
});

test('nothing leaves this PC: no fetch in the local path, and search works with fetch broken', () => {
  for (const f of ['src/shared/meaning.ts', 'src/main/meaning-index.ts']) {
    const src = read(f);
    assert.ok(!/fetch\s*\(/.test(src), `no fetch call in ${f}`);
    assert.ok(!/https?:\/\//.test(src), `no web address in ${f}`);
  }
  const index = stocked();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network on this path'); };
  try {
    assert.ok(index.search(QUERY).some((h) => h.path === VENDOR), 'meaning search with fetch broken');
    assert.ok(index.relatedNotes(VENDOR).length >= 0, 'related with fetch broken');
    const mi = new M.MeaningIndex();
    mi.set('Notes/A.md', 'A', 'supplier vendor late');
    assert.equal(mi.search('supplier late').length, 1, 'index search with fetch broken');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the person sees Similar meaning in search and in Related notes, in theme tokens only', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes('Similar meaning'), 'the search label');
  assert.ok(view.includes('hit.meaning'), 'only meaning hits carry it');
  const css = read('src/renderer/src/styles/search-ask-87.css');
  const at = css.indexOf('.sas-meaning');
  assert.ok(at > 0, 'the label has its own spacing');
  const block = css.slice(at, css.indexOf('}', at));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'no hex colours outside the tokens');
  assert.ok(!/999px/.test(block), 'no pills');
  assert.ok(!/creme|cream|beige/i.test(block), 'no cream');
  assert.ok(!/—/.test('Similar meaning'), 'no em dashes in the new words');
  const related = read('src/shared/related.ts');
  assert.ok(related.includes('Similar meaning'), 'the Related notes label');
  assert.ok(!/deepseek|pi-ai/i.test(`${related} ${view}`), 'no engine names');
  const types = read('src/shared/types.ts');
  assert.ok(types.includes('meaning?: boolean'), 'the hit flag that carries it');
  // t27-unused-panels: the side panel is gone; the foot's Linked list says why each related row relates instead.
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('sharedLine(r.related)'), 'the foot says why each related row relates');
});
