// node --test tests/notebook.test.mjs — Notebook mode (src/shared/notebook.ts; 21 Oct 2026, gap G10): notes and PDFs cut
// into passages with their places, BM25-style scoring that finds the passage that answers, the model's [c3] ids turned
// into numbered chips that point back to the exact passage (ids it wasn't given dropped), the refusal rule, the sources
// list round trip, the Studio's notes, and the mind map as a valid JSON Canvas with no cards on top of each other.
// A made-up bakery's notes only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notebook-'));
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/notebook.ts'), platform: 'node', output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  N = await import(pathToFileURL(path.join(work, 'n.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const FLOUR = `---
type: decision
tags: [supply]
---
# Flour supply

We buy flour by the pallet every fortnight.

## Mill

On 12 October we chose Western Plains Mill for flour because its price stayed steady through winter, unlike the co-op.

The co-op's price rose 18% between June and August.

## Delivery

\`\`\`
Tuesday 6 am drop

back door
\`\`\`

Deliveries come on Tuesdays before the ovens are lit.
`;

const PDF = '\fpage 1\nSaltwater Bakehouse food safety plan\nAll staff wash hands before handling dough.\n\fpage 2\nThe walk-in fridge is kept at 4 degrees or colder.\nTemperatures are logged twice a day by the opener and the closer.\n';

test('a note is cut into passages under its headings, with the lines they cover counted as the editor counts them', () => {
  const chunks = N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR);
  assert.ok(chunks.length >= 3);
  const mill = chunks.find((c) => c.text.includes('Western Plains Mill'));
  assert.equal(mill.heading, 'Mill');
  // Line 8 (from 0) is the Western Plains paragraph, after the properties and the first heading.
  assert.equal(FLOUR.split('\n')[mill.line].startsWith('On 12 October'), true);
  // The co-op line is joined to it (same heading, short), so the passage runs to its line.
  assert.ok(mill.text.includes('rose 18%'));
  assert.equal(FLOUR.split('\n')[mill.endLine].startsWith('The co-op'), true);
  // Properties never become a passage; a code block keeps its blank line inside one passage.
  assert.ok(!chunks.some((c) => c.text.includes('type: decision')));
  const code = chunks.find((c) => c.text.includes('Tuesday 6 am drop'));
  assert.ok(code.text.includes('back door'));
  assert.equal(code.heading, 'Delivery');
  // A heading that only repeats the title is no place of its own.
  assert.equal(chunks[0].heading, undefined);
  for (const c of chunks) assert.ok(c.key.startsWith('Supply/Flour supply.md#'));
});

test('a long paragraph is cut into pieces of a passage’s size, each keeping its lines', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} about sourdough starters and how they are fed.`).join(' ');
  const chunks = N.chunkNote('Long.md', 'Long', `# Starter\n\n${long}\n`);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.text.length <= 1400, `${c.text.length}`);
    assert.equal(c.line, 2);
  }
  assert.equal(chunks.map((c) => c.text).join(' ').split('Sentence').length, 61);
});

test('a PDF is cut by page, each passage knowing its page', () => {
  const chunks = N.chunkDocument('Safety.pdf', 'Safety.pdf', PDF, 'pdf');
  assert.deepEqual(chunks.map((c) => c.page), [1, 2]);
  assert.ok(chunks[1].text.includes('4 degrees'));
  // A presentation's slides are sections by name.
  const slides = N.chunkDocument('Deck.pptx', 'Deck.pptx', '\fslide 1\nWinter menu\n\fslide 2\nPies return in May\n', 'doc');
  assert.deepEqual(slides.map((c) => c.heading), ['slide 1', 'slide 2']);
});

test('scoring finds the passage that answers, rare words counting most, and nothing for a question no passage shares a word with', () => {
  const chunks = [...N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR), ...N.chunkDocument('Safety.pdf', 'Safety plan', PDF, 'pdf')];
  const top = N.rankChunks(chunks, 'Which mill did we choose for the flour, and why?');
  assert.ok(top[0].chunk.text.includes('Western Plains Mill'));
  const fridge = N.rankChunks(chunks, 'How cold is the fridge kept?');
  assert.equal(fridge[0].chunk.page, 2);
  // Stems meet: "logging temperatures" finds "Temperatures are logged".
  assert.equal(N.rankChunks(chunks, 'logging temperature')[0].chunk.page, 2);
  // A word in common is enough to be read (the model then says the sources don't say what colour the van is).
  assert.equal(N.rankChunks(chunks, 'What colour is the delivery van?')[0].chunk.heading, 'Delivery');
  assert.deepEqual(N.rankChunks(chunks, 'zebra quantum'), []);
  // Only the little words: nothing.
  assert.deepEqual(N.rankChunks(chunks, 'what is it'), []);
  // The limits hold.
  assert.ok(N.rankChunks(chunks, 'flour fridge mill staff', 2).length <= 2);
});

test('the model’s ids become numbered chips in the order first cited, each pointing to its exact passage', () => {
  const chunks = [...N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR), ...N.chunkDocument('Safety.pdf', 'Safety plan', PDF, 'pdf')];
  const given = [chunks.find((c) => c.page === 2), chunks.find((c) => c.heading === 'Mill')];
  const r = N.readAnswer('We chose Western Plains Mill for its steady price [c2]. The fridge stays at 4 degrees [c1, c2]. Again [c2][c1] and [c9].', given);
  assert.equal(r.refused, false);
  assert.equal(r.text, 'We chose Western Plains Mill for its steady price [1]. The fridge stays at 4 degrees [2][1]. Again [1][2] and.');
  assert.equal(r.citations.length, 2);
  assert.deepEqual(
    r.citations.map((c) => ({ n: c.n, path: c.path, heading: c.heading, page: c.page })),
    [
      { n: 1, path: 'Supply/Flour supply.md', heading: 'Mill', page: undefined },
      { n: 2, path: 'Safety.pdf', heading: undefined, page: 2 },
    ],
  );
  assert.equal(FLOUR.split('\n')[r.citations[0].line].startsWith('On 12 October'), true);
  assert.ok(r.citations[1].quote.startsWith('The walk-in fridge'));
});

test('the refusal rule: an answer that cites nothing it was given, or says the sources don’t say, is the refusal', () => {
  const given = N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR).slice(0, 2);
  assert.deepEqual(N.readAnswer('Flour is usually milled from wheat.', given), { text: N.NOTEBOOK_REFUSAL, citations: [], refused: true });
  assert.equal(N.readAnswer('Flour costs $40 a bag [c7].', given).refused, true);
  assert.equal(N.readAnswer('The ticked sources don’t say.', given).refused, true);
  assert.equal(N.readAnswer("The sources don't say what the van costs [c1].", given).refused, true);
  // Partly answered: kept, with its one sentence on what isn't covered.
  const part = N.readAnswer('Flour comes by the pallet every fortnight [c1]. The sources don’t cover the price per bag.', given);
  assert.equal(part.refused, false);
  assert.equal(part.citations.length, 1);
});

test('chips become links to the passage in a saved note: a note at its heading, a PDF at its page', () => {
  const chunks = [...N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR), ...N.chunkDocument('Safety.pdf', 'Safety plan', PDF, 'pdf')];
  const given = [chunks.find((c) => c.heading === 'Mill'), chunks.find((c) => c.page === 2)];
  const r = N.readAnswer('Western Plains [c1]. Fridge at 4 degrees [c1][c2].', given);
  assert.equal(N.linkCitations(r.text, r.citations), 'Western Plains ([[Supply/Flour supply#Mill|1]]). Fridge at 4 degrees ([[Supply/Flour supply#Mill|1]], [[Safety.pdf#page=2|2]]).');
  const list = N.sourcesList(r.citations);
  assert.match(list, /^## Sources\n\n1\. \[\[Supply\/Flour supply#Mill\|Flour supply › Mill\]\] — “On 12 October/);
  assert.match(list, /2\. \[\[Safety\.pdf#page=2\|Safety plan › page 2\]\]/);
  const note = N.answerNote('Why Western Plains?', r, { folder: 'Supply', iso: '2026-10-21' });
  assert.match(note, /^---\nnotebook-kind: answer\nnotebook: "Supply"\nmade: 2026-10-21\n---\n# Why Western Plains\?/);
});

test('the sources list: added links and unticked ones, written as a note and read back the same', () => {
  const choice = { added: ['Research/Flour prices.md', 'Docs/Safety plan.pdf'], off: ['Supply/Old plan.md'] };
  const text = N.writeSources('Supply', choice);
  assert.match(text, /- \[\[Research\/Flour prices\]\]/);
  assert.match(text, /- \[\[Docs\/Safety plan\.pdf\]\]/);
  assert.deepEqual(N.readSources(text), choice);
  assert.deepEqual(N.readSources(N.writeSources('', { added: [], off: [] })), { added: [], off: [] });
  // The person's own edits: an alias and a heading link still read as the note.
  assert.deepEqual(N.readSources('## Added\n- [[Research/Flour prices|prices]] and [[Supply/Mill#Price]]\n## Something else\n- [[Ignored]]\n'), { added: ['Research/Flour prices.md', 'Supply/Mill.md'], off: [] });
  assert.equal(N.sourcesNotePath('Supply'), 'Supply/Notebook/Sources.md');
  assert.equal(N.sourcesNotePath(''), 'Notebook/Sources.md');
  assert.equal(N.notebookOfFile('Supply/Notebook/Briefing 21 Oct 2026.md'), 'Supply');
  assert.equal(N.notebookOfFile('Notebook/Quiz.md'), '');
  assert.equal(N.notebookOfFile('Supply/Flour.md'), null);
});

test('the Studio’s spread takes passages from every source in turn', () => {
  const a = N.chunkNote('A.md', 'A', '# A\n\n' + 'Alpha words here. '.repeat(50) + '\n\nMore alpha.\n\n## Two\n\nAlpha two.\n');
  const b = N.chunkDocument('B.pdf', 'B', PDF, 'pdf');
  const spread = N.spreadChunks([...a, ...b], 100000);
  assert.deepEqual(spread.slice(0, 2).map((c) => c.path), ['A.md', 'B.pdf']);
  assert.equal(spread.length, a.length + b.length);
  assert.ok(N.spreadChunks([...a, ...b], 900).reduce((n, c) => n + c.text.length, 0) <= 900);
});

const overlap = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;

test('the mind map is a valid JSON Canvas: unique ids, whole numbers, edges between its cards, no two cards on top of each other', () => {
  const given = N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR);
  for (const branches of [2, 5, 8]) {
    const reply = {
      topic: 'Flour supply',
      branches: Array.from({ length: branches }, (_, i) => ({ label: `Branch ${i + 1} with a longer label`, leaves: Array.from({ length: 6 }, (_, j) => ({ text: `Leaf ${j + 1} of branch ${i + 1}, with a few more words to wrap`, cites: ['c1', 'c99'] })) })),
    };
    const canvas = JSON.parse(JSON.stringify(N.mindMapCanvas(reply, given)));
    const ids = canvas.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(canvas.nodes.length, 1 + branches + branches * 6);
    for (const n of canvas.nodes) {
      assert.equal(n.type, 'text');
      for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isInteger(n[k]) && (k === 'x' || k === 'y' || n[k] > 0), `${n.id}.${k}`);
      assert.equal(typeof n.text, 'string');
      if (n.color) assert.match(n.color, /^[1-6]$/);
    }
    for (const e of canvas.edges) {
      assert.ok(ids.includes(e.fromNode) && ids.includes(e.toNode));
    }
    assert.equal(new Set(canvas.edges.map((e) => e.id)).size, canvas.edges.length);
    for (let i = 0; i < canvas.nodes.length; i++) for (let j = i + 1; j < canvas.nodes.length; j++) assert.ok(!overlap(canvas.nodes[i], canvas.nodes[j]), `${canvas.nodes[i].id} meets ${canvas.nodes[j].id} (${branches} branches)`);
    // Leaves carry their (known) citations as links to the passage; unknown ids are dropped.
    // (The note's first passage sits under a heading that only repeats its title, so the link is to the note itself.)
    assert.match(canvas.nodes.find((n) => n.id === 'b1l1').text, /\(\[\[Supply\/Flour supply\|1\]\]\)$/);
  }
  assert.throws(() => N.mindMapCanvas({ topic: 'x', branches: [] }, given), /no branches/);
});

test('the Studio’s notes: a briefing, a data table and an audio script, each citing the passages and kept only when they do', () => {
  const given = N.chunkNote('Supply/Flour supply.md', 'Flour supply', FLOUR);
  const o = { folder: 'Supply', name: 'Supply', iso: '2026-10-21' };
  const brief = N.briefingNote({ title: 'Flour in brief', summary: 'We buy from Western Plains.', summaryCites: ['c2'], sections: [{ heading: 'Key points', points: [{ text: 'Pallets every fortnight', cites: ['c1'] }] }] }, given, o);
  assert.match(brief, /notebook-kind: briefing/);
  assert.match(brief, /We buy from Western Plains\. \(\[\[Supply\/Flour supply#Mill\|1\]\]\)/);
  assert.match(brief, /## Sources/);
  assert.throws(() => N.briefingNote({ summary: 'Uncited.', sections: [] }, given, o), /didn’t cite/);
  const table = N.tableNote({ title: 'Suppliers', columns: ['Supplier', 'Price | trend'], rows: [{ cells: ['Western Plains', 'steady'], cites: ['c2'] }, { cells: ['Co-op', 'up 18%'], cites: ['c2'] }] }, given, o);
  assert.match(table, /\| Supplier \| Price \\\| trend \| Source \|/);
  assert.match(table, /\| Western Plains \| steady \| 1 \|/);
  const audio = N.audioNote({ title: 'Flour talk', lines: [{ voice: 'Alex', text: 'Why that mill?', cites: [] }, { voice: 'sam', text: 'Steady prices.', cites: ['c2'] }] }, given, o);
  assert.match(audio, /\*\*Alex:\*\* Why that mill\?/);
  assert.match(audio, /\*\*Sam:\*\* Steady prices\. \(\[\[/);
  assert.deepEqual(N.scriptLines(audio), [
    { voice: 'Alex', text: 'Why that mill?' },
    { voice: 'Sam', text: 'Steady prices.' },
  ]);
  assert.equal(N.studioFileName('mindmap', '2026-10-21'), 'Mind map 21 Oct 2026.canvas');
  assert.equal(N.studioFileName('flashcards', '2026-10-21'), 'Flashcards 21 Oct 2026.md');
});

test('Find sources: the brief asks for sections with links and quotes, and the reply is kept as a note of the notebook', () => {
  const brief = N.findSourcesBrief('flour price trends in Australia', 'Supply');
  assert.match(brief, /flour price trends in Australia/);
  assert.match(brief, /Don't make any files/);
  const note = N.foundSourcesNote('## ABS wheat prices\nhttps://example.org/wheat\n\nPrices rose.\n\n> Wheat rose 4%.', { folder: 'Supply', topic: 'flour prices', iso: '2026-10-21' });
  assert.match(note, /^---\nnotebook-kind: found\n/);
  assert.match(note, /# Found sources: flour prices/);
  assert.match(note, /## ABS wheat prices/);
});
