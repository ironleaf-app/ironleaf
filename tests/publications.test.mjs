// node --test tests/publications.test.mjs — Publications (Wave 6 part a): the puzzle engine (src/shared/puzzles.ts: every
// crossword, sudoku, word search and daily word sound, with its answers), a publication, its editions and pieces read and
// written as plain notes (src/shared/publications.ts), the fit of an edition onto its page budgets, the archive's search,
// the import of a publication note written before the module (lossless), the edition's pages (src/shared/edition-doc.ts)
// and the agents' tools through a gate (src/main/publications.ts). Made-up publications, people and words only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pub-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 9, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['puzzles', 'publications', 'edition-doc', 'publication-tools', 'publication-module', 'module-records', 'module-tools', 'sensitivity', 'life-modules'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/publications.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const CLUES = `HARBOUR — Where the boats come in
LIGHTHOUSE — It keeps ships off the rocks
GULL — Noisy seabird after your chips
FERRY — It crosses the bay every hour
ANCHOR — Dropped to stay put
TIDE — It comes in twice a day
Sea breeze — Cool afternoon wind off the water
CAPTAIN — In charge on the bridge
OAR — Row with one
PIER — Walk out over the water on it`;

// ── The puzzle engine ───────────────────────────────────────────────────────────────────────────────────────────────

test('crossword: every answer joined into a sound grid, numbered as a paper does, the same seed the same grid', () => {
  const P = S.puzzles;
  const entries = P.readClueLines(CLUES);
  assert.equal(entries.length, 10);
  assert.equal(entries[6].answer, 'Sea breeze');
  for (let seed = 1; seed <= 12; seed++) {
    const cw = P.makeCrossword(entries, { seed });
    assert.deepEqual(P.checkCrossword(cw), [], `seed ${seed} is sound`);
    assert.ok(cw.width <= 15 && cw.height <= 15);
    const placed = [...cw.across, ...cw.down].map((e) => e.answer).sort();
    assert.equal(placed.length + cw.left.length, 10, 'every answer placed or said to be left out');
    assert.ok(placed.length >= 8, `seed ${seed}: most answers joined (${placed.length})`);
    // Numbers start at 1 and go up in reading order.
    const nums = [...new Set([...cw.across, ...cw.down].map((e) => e.n))].sort((a, b) => a - b);
    assert.deepEqual(nums, nums.map((_, i) => i + 1));
  }
  const a = P.makeCrossword(entries, { seed: 7 });
  const b = P.makeCrossword(entries, { seed: 7 });
  assert.deepEqual(a.grid, b.grid, 'the same seed makes the same grid');
  const sb = [...a.across, ...a.down].find((e) => e.answer === 'SEABREEZE');
  if (sb) assert.equal(sb.enumeration, '3,6');
  // A broken grid is caught.
  const broken = { ...a, grid: a.grid.map((r, i) => (i === a.across[0].row ? r.replace(/[A-Z]/, 'Q') : r)) };
  assert.ok(P.checkCrossword(broken).length > 0);
  // Answers in words, for the next edition.
  assert.match(P.answersText(a), /\*\*Across:\*\* 1 /);
});

test('sudoku: exactly one answer at every difficulty, givens from the answer', () => {
  const P = S.puzzles;
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const seed of [3, 99]) {
      const s = P.makeSudoku({ difficulty, seed });
      assert.deepEqual(P.checkSudoku(s), [], `${difficulty} ${seed}`);
      assert.equal(P.countSolutions([...s.grid].map((c) => (c === '.' ? 0 : Number(c))), 2), 1);
      assert.ok(s.clues <= P.DIFFICULTY_CLUES[difficulty] + 2 && s.clues >= 17, `${difficulty}: ${s.clues} given`);
    }
  }
  const s = P.makeSudoku({ difficulty: 'hard', seed: 5 });
  assert.ok(P.checkSudoku({ ...s, solution: s.solution.replace(/^./, s.solution[0] === '1' ? '2' : '1') }).length > 0, 'a wrong answer is caught');
});

test('word search: every word where it says, the ways asked for, and none dropped without saying', () => {
  const P = S.puzzles;
  const words = ['harbour', 'lighthouse', 'gull', 'ferry', 'anchor', 'tide', 'captain', 'oar', 'pier', 'Sea breeze'];
  const easy = P.makeWordSearch(words, { ways: 'easy', seed: 11 });
  assert.deepEqual(P.checkWordSearch(easy), []);
  assert.equal(easy.words.length + easy.left.length, 10);
  for (const w of easy.words) assert.ok(w.dr >= 0 && w.dc >= 0, 'easy: never backwards');
  const hard = P.makeWordSearch(words, { ways: 'hard', seed: 12, size: 12 });
  assert.deepEqual(P.checkWordSearch(hard), []);
  assert.equal(hard.size, 12);
  assert.ok(hard.rows.every((r) => /^[A-Z]{12}$/.test(r)));
  assert.match(P.answersText(easy), /HARBOUR \(row \d+, column \d+, /);
});

test('daily word: marks as the game marks them (a letter guessed twice marked once), guesses that narrow it down', () => {
  const P = S.puzzles;
  assert.deepEqual(P.marksOf('EERIE', 'THREE'), ['present', 'absent', 'right', 'absent', 'right']);
  assert.deepEqual(P.marksOf('SPEED', 'ABIDE'), ['absent', 'absent', 'present', 'absent', 'present']);
  assert.deepEqual(P.marksOf('CRANE', 'CRANE'), Array(5).fill('right'));
  const d = P.makeDailyWord({ seed: 5 });
  assert.deepEqual(P.checkDailyWord(d), []);
  assert.ok(d.guesses.length >= 2 && d.guesses.length <= 4);
  assert.ok(d.fits >= 1 && d.fits <= 3, `the marks leave few words (${d.fits})`);
  const mine = P.makeDailyWord({ answer: 'tides', words: ['tides', 'sides', 'rides', 'hides', 'tiles', 'times', 'tired'], seed: 1 });
  assert.equal(mine.answer, 'TIDES');
  assert.deepEqual(P.checkDailyWord(mine), []);
  assert.throws(() => P.makeDailyWord({ length: 6, words: [] }), /Give a word to find/);
});

test('solve times: read as a person writes them, printed as a paper prints them', () => {
  const P = S.puzzles;
  assert.equal(P.readSolveTime('4:05'), 245);
  assert.equal(P.readSolveTime('12 min'), 720);
  assert.equal(P.readSolveTime('1h 2m 3s'), 3723);
  assert.equal(P.readSolveTime('1:02:03'), 3723);
  assert.equal(P.readSolveTime('soon'), null);
  assert.equal(P.solveTimeWords(245), '4:05');
  assert.equal(P.solveTimeWords(3723), '1:02:03');
  const puzzle = P.readPuzzle(JSON.stringify(P.makeSudoku({ seed: 4 })));
  assert.equal(puzzle.kind, 'sudoku');
  assert.equal(P.readPuzzle('{not json'), null);
});

// ── Notes: a publication, its pieces, its editions ──────────────────────────────────────────────────────────────

test('a publication: its schedule, sections with sources and rules, house style and delivery, from its note', () => {
  const B = S.publications;
  const text = B.newPublicationText({ title: 'The Harbour Gazette', motto: 'From our house to yours', schedule: 'Monday and Friday, 7am', template: 'classic' });
  const props = { type: 'publication', masthead: 'The Harbour Gazette', motto: 'From our house to yours', schedule: 'Mon, Fri 07:00', template: 'Classic', telegram: 'Yes', print: 'Yes', printer: 'Office Laser', email: 'a@example.com, nope', body_font: '[[Fonts/Body-Regular.ttf]]', crest: '[[Pictures/crest.png]]' };
  const p = B.readPublication({ path: 'Publications/The Harbour Gazette/The Harbour Gazette.md', title: 'The Harbour Gazette', props, content: text });
  assert.equal(p.folder, 'Publications/The Harbour Gazette', 'a note that is its folder’s keeps its editions in that folder');
  assert.equal(B.publicationFolder('Publications/The Harbour Gazette.md'), 'Publications/The Harbour Gazette');
  assert.deepEqual(p.schedule, { days: [1, 5], time: '07:00' });
  assert.equal(B.scheduleWords(p.schedule), 'Mondays and Fridays at 7:00 am');
  assert.equal(p.template.id, 'classic');
  assert.deepEqual(p.sections.map((s) => s.name), ['Front', 'News', 'Sport', 'Puzzles']);
  assert.equal(p.sections[1].sources, 'Any named source');
  assert.deepEqual(p.delivery, { telegram: true, email: ['a@example.com'], printer: 'Office Laser', print: true, copies: 1 });
  assert.equal(p.style.bodyFont, 'Fonts/Body-Regular.ttf');
  assert.equal(p.style.crest, 'Pictures/crest.png');
  // The sections table changed in place, every other line kept.
  const next = B.withSections(text, [{ name: 'Front', pages: 1, sources: '', rules: 'Lead and weather' }, { name: 'Local | Harbour', pages: 2.5, sources: 'Harbour Post, Bay FM', rules: 'Local only' }]);
  assert.deepEqual(B.readSections(next), [{ name: 'Front', pages: 1, sources: '', rules: 'Lead and weather' }, { name: 'Local | Harbour', pages: 2.5, sources: 'Harbour Post, Bay FM', rules: 'Local only' }]);
  const outside = (t) => t.split('\n').filter((l) => !/^\|/.test(l));
  assert.deepEqual(outside(next), outside(text));
  // A section's sources decide which pieces it takes.
  const local = B.readSections(next)[1];
  assert.equal(B.sourceProblem(local, 'Bay FM'), null);
  assert.match(B.sourceProblem(local, 'A blog'), /takes items only from Harbour Post, Bay FM, not A blog/);
  assert.match(B.sourceProblem(p.sections[1], ''), /needs every item to say where it came from/);
  assert.equal(B.sourceProblem(p.sections[0], ''), null);
  // Schedules in words.
  assert.deepEqual(B.readSchedule('weekdays at 6:30'), { days: [1, 2, 3, 4, 5], time: '06:30' });
  assert.deepEqual(B.readSchedule('daily 9pm'), { days: [0, 1, 2, 3, 4, 5, 6], time: '21:00' });
  assert.equal(B.readSchedule('whenever'), null);
  const nx = B.nextRun({ days: [1, 5], time: '07:00' }, TODAY);
  assert.equal(B.isoOf(nx), '2026-10-26', 'Saturday → the Monday after');
});

test('pieces and editions: written and read back, sections set without losing notes or the delivery log', () => {
  const B = S.publications;
  const P = S.puzzles;
  const story = B.newItemText('The Harbour Gazette', { kind: 'story', headline: 'New path opens: walkers welcome', section: 'News', body: 'The council opened the path.\n\nIt runs 2 km.', source: 'Harbour Post', sourceUrl: 'https://example.com/a', lead: true, date: '2026-10-24' });
  const it = B.readItem({ path: 'Publications/G/Items/2026-10-24 New path.md', title: '2026-10-24 New path', props: { type: 'publication-item', kind: 'Headline story', section: 'News', source: 'Harbour Post', lead: 'Yes', date: '2026-10-24', publication: '[[The Harbour Gazette]]' }, content: story });
  assert.equal(it.kind, 'story');
  assert.equal(it.headline, 'New path opens: walkers welcome');
  assert.equal(it.body, 'The council opened the path.\n\nIt runs 2 km.');
  assert.equal(it.publication, 'The Harbour Gazette');
  assert.ok(it.lead);
  const sd = P.makeSudoku({ seed: 8 });
  const pz = B.newItemText('The Harbour Gazette', { kind: 'sudoku', headline: 'Sudoku', section: 'Puzzles', puzzle: sd });
  const pi = B.readItem({ path: 'x.md', title: 'x', props: { kind: 'Sudoku' }, content: pz });
  assert.deepEqual(pi.puzzle, sd);
  assert.equal(pi.body, '', 'the puzzle block and answers are not its words');
  const solved = B.withSolve(B.withSolve(pz, { who: 'Mia', seconds: 750, day: '2026-10-24', note: '' }), { who: 'Sam', seconds: 512, day: '2026-10-25', note: 'pen' });
  assert.deepEqual(B.readSolves(solved).map((s) => [s.who, s.seconds]), [['Mia', 750], ['Sam', 512]]);
  assert.ok(solved.includes('```puzzle'), 'the puzzle stays');
  // An edition.
  const ed = B.newEditionText({ title: 'The Harbour Gazette', masthead: 'The Harbour Gazette' }, { number: 3, date: '2026-10-26', sections: [{ name: 'Front', items: ['Publications/G/Items/2026-10-24 New path'] }, { name: 'Puzzles', items: [] }], notes: 'Made for the long weekend.' });
  let e = B.readEdition({ path: 'Publications/G/Editions/No. 3 – 2026-10-26.md', title: 'No. 3 – 2026-10-26', props: { type: 'edition', number: 3, date: '2026-10-26', status: 'Draft', publication: '[[The Harbour Gazette]]' }, content: ed });
  assert.deepEqual(e.sections, [{ name: 'Front', items: ['Publications/G/Items/2026-10-24 New path'] }, { name: 'Puzzles', items: [] }]);
  assert.equal(e.notes, 'Made for the long weekend.');
  let text = B.withDeliveryRow(ed, { when: '2026-10-26 07:00', how: 'Telegram', to: 'the chat', result: 'Sent' });
  text = B.withEditionSections(text, [{ name: 'Front', items: [] }, { name: 'Puzzles', items: ['Items/Sudoku', 'Items/Crossword'] }]);
  e = B.readEdition({ path: 'e.md', title: 'e', props: {}, content: text });
  assert.deepEqual(e.sections, [{ name: 'Front', items: [] }, { name: 'Puzzles', items: ['Items/Sudoku', 'Items/Crossword'] }]);
  assert.equal(e.notes, 'Made for the long weekend.', 'notes kept');
  assert.deepEqual(e.delivery, [{ when: '2026-10-26 07:00', how: 'Telegram', to: 'the chat', result: 'Sent' }], 'the delivery log kept');
  // The one before (for its answers): the highest number below, never a preview.
  const eds = [{ path: 'a', number: 1, date: '2026-10-19', preview: false }, { path: 'b', number: 2, date: '2026-10-22', preview: true }, { path: 'c', number: 2, date: '2026-10-23', preview: false }, { path: 'd', number: 3, date: '2026-10-26', preview: false }];
  assert.equal(B.previousEdition(eds, eds[3]).path, 'c');
  assert.equal(B.nextNumber(eds), 4);
});

test('fit: a section with more words than its pages is said to run over, and which pieces don’t fit', () => {
  const B = S.publications;
  const t = B.templateOf('broadsheet');
  const para = 'The quick council meeting heard from residents about the new harbour path and the plans for the summer. '.repeat(6);
  const story = (i, n) => ({ id: `s${i}`, kind: 'story', headline: `Story number ${i} about the harbour`, body: Array(n).fill(para).join('\n\n') });
  const small = B.estimateFit([{ name: 'Front', pages: 1, items: [{ ...story(0, 2), lead: true }] }, { name: 'News', pages: 2, items: [story(1, 3), story(2, 3)] }], t);
  assert.equal(small[1].over, false, B.fitWords(small));
  assert.ok(small[1].used > 0 && small[1].used <= 2);
  const big = B.estimateFit([{ name: 'Front', pages: 1, items: [] }, { name: 'News', pages: 1, items: Array.from({ length: 12 }, (_, i) => story(i + 1, 4)) }], t);
  assert.equal(big[1].over, true);
  assert.ok(big[1].used > 1.5, `runs well over (${big[1].used})`);
  assert.ok(big[1].overflow.length >= 4 && !big[1].overflow.includes('s1'), 'the last pieces are the ones past the budget');
  assert.match(B.fitWords(big), /News runs [\d.]+ of a page over its 1/);
  // Bigger type, fewer columns: the same words take more pages.
  const tab = B.estimateFit([{ name: 'News', pages: 9, items: Array.from({ length: 6 }, (_, i) => story(i, 3)) }], B.templateOf('tabloid'));
  const brd = B.estimateFit([{ name: 'News', pages: 9, items: Array.from({ length: 6 }, (_, i) => story(i, 3)) }], t);
  assert.ok(tab[0].used > brd[0].used);
});

test('search: “the crossword with HARBOUR in it” finds the crossword and its edition; words in a PDF find the edition', () => {
  const B = S.publications;
  const P = S.puzzles;
  const cw = P.makeCrossword(P.readClueLines(CLUES), { seed: 3 });
  const items = [
    B.readItem({ path: 'G/Items/Crossword.md', title: 'Crossword', props: { kind: 'Crossword', section: 'Puzzles' }, content: B.newItemText('G', { kind: 'crossword', headline: 'Around the bay', puzzle: cw }) }),
    B.readItem({ path: 'G/Items/Hawks win.md', title: 'Hawks win', props: { kind: 'Headline story', section: 'Sport', source: 'Bay FM' }, content: '# Hawks win the derby\n\nThe Hawks beat the Gulls 24–12 at the harbour oval.' }),
    B.readItem({ path: 'G/Items/Rain.md', title: 'Rain', props: { kind: 'Brief', section: 'News', source: 'Weather office' }, content: '# Rain on the way\n\nShowers from Tuesday.' }),
  ];
  const editions = [
    B.readEdition({ path: 'G/Editions/No. 4.md', title: 'No. 4', props: { number: 4, date: '2026-10-23' }, content: '# G No. 4\n\n## Puzzles\n\n- [[G/Items/Crossword]]\n\n## Sport\n\n- [[G/Items/Hawks win]]\n' }),
    B.readEdition({ path: 'G/Editions/No. 1.md', title: 'No. 1', props: { number: 1, date: '2026-10-01', pdf: '[[G/No1.pdf]]' }, content: '# G No. 1\n' }),
  ];
  const hits = B.searchArchive('the crossword with HARBOUR in it', { editions, items });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].item, 'G/Items/Crossword.md');
  assert.equal(hits[0].editionLabel, 'No. 4');
  assert.match(hits[0].snippet, /Crossword with HARBOUR in its answers/);
  const sport = B.searchArchive('every Hawks story', { editions, items });
  assert.deepEqual(sport.map((h) => h.item), ['G/Items/Hawks win.md']);
  assert.equal(B.searchArchive('the crossword with ZEBRA in it', { editions, items }).length, 0);
  const pdf = B.searchArchive('lighthouse keeper retires', { editions, items, pdfText: { 'G/Editions/No. 1.md': 'Page 3. The lighthouse keeper retires after forty years.' } });
  assert.equal(pdf[0].edition, 'G/Editions/No. 1.md');
  assert.match(pdf[0].snippet, /lighthouse keeper retires/);
  assert.deepEqual(B.readQuery('the crossword with BOLAND in it'), { kind: 'crossword', words: ['BOLAND'], recent: false });
  assert.deepEqual(B.readQuery('the latest report'), { kind: null, words: ['report'], recent: true }, 'the newest is asked for, not the word (9.2)');
  const older = B.searchArchive('Hawks', { editions, items });
  assert.deepEqual(older.map((h) => h.item), ['G/Items/Hawks win.md']);
  const newest = B.searchArchive('newest Hawks', { editions, items });
  assert.deepEqual(newest.map((h) => h.item), ['G/Items/Hawks win.md'], 'recency words narrow nothing out');
});

// ── Import: a publication note written before the module ───────────────────────────────────────────────────────

const OLD_NOTE = `---
type: publication
about: The Bayside Courier, the family paper. Tuesdays and Saturdays at 6:30am.
tags: ["publication", "family"]
---
# The Bayside Courier

The family's own paper. Each edition's PDF is linked below.

## Releases
- **Tuesday and Saturday, 6:30am.** Built early, sent to Telegram, printed on the Office Laser 200 at 6:30.

## What's in it (6 A4 pages)
- **Front (1):** the masthead, the lead story and the weather.
- **Local (2):** stories from the bay, named outlets only, every story sourced.
- **Fun (3):** the comic strip, crossword and sudoku, with last edition's answers.

## Look
Black ink only: a blackletter title (Assets/Fonts/Blackletter-Bold.ttf, masthead), Classic-Regular, Bold and Italic.ttf for the body.

![[Assets/Pictures/courier-crest.png]]

## Editions

[[Assets/Papers/Bayside_Courier_No1_2026-10-13.pdf|Bayside_Courier_No1_2026-10-13.pdf]] — No. 1, Tue 13 Oct 2026 (first edition)

[[Assets/Papers/Bayside_Courier_No2_2026-10-17.pdf|No. 2 PREVIEW]] — preview, not printed

[[Assets/Papers/Bayside Courier No2 2026-10-17.pdf|Bayside Courier No2 2026-10-17.pdf]] — No. 2, Sat 17 Oct 2026. Lead: Ferry timetable changes for summer. Cartoon: [[Assets/Pictures/Gus and Tilly No2 Rain.png|Gus & Tilly: Rain]].
`;
const FILES = [
  { path: 'Assets/Fonts/Blackletter-Bold.ttf', size: 40000 },
  { path: 'Assets/Fonts/Classic-Regular.ttf', size: 200000 },
  { path: 'Assets/Fonts/Classic-Bold.ttf', size: 200000 },
  { path: 'Assets/Fonts/Classic-Italic.ttf', size: 200000 },
  { path: 'Assets/Pictures/courier-crest.png', size: 5000 },
  { path: 'Assets/Pictures/Gus and Tilly No2 Rain.png', size: 5000 },
  { path: 'Assets/Papers/Bayside_Courier_No1_2026-10-13.pdf', size: 1000 },
  { path: 'Assets/Papers/Bayside_Courier_No2_2026-10-17.pdf', size: 2222 },
  { path: 'Assets/Papers/Bayside Courier No2 2026-10-17.pdf', size: 3000 },
  { path: 'Assets/Docs/Bayside Courier No2 PREVIEW 2026-10-16.pdf', size: 2222 },
];

test('import: schedule, printer, sections, type, crest and every linked edition read from the note; a copy is offered unticked', () => {
  const B = S.publications;
  const plan = B.planImport({ path: 'Publications/The Bayside Courier.md', title: 'The Bayside Courier', props: { type: 'publication' }, content: OLD_NOTE }, FILES, '2026-10-24');
  assert.deepEqual(plan.schedule, { days: [2, 6], time: '06:30' });
  assert.equal(plan.printer, 'Office Laser 200');
  assert.equal(plan.telegram, true);
  assert.deepEqual(plan.sections.map((s) => [s.name, s.pages]), [['Front', 1], ['Local', 2], ['Fun', 3]]);
  assert.equal(plan.sections[1].sources, 'Any named source');
  assert.equal(plan.style.mastheadFont, 'Assets/Fonts/Blackletter-Bold.ttf');
  assert.equal(plan.style.bodyFont, 'Assets/Fonts/Classic-Regular.ttf');
  assert.deepEqual(plan.style.bodyFaces.sort(), ['Assets/Fonts/Classic-Bold.ttf', 'Assets/Fonts/Classic-Italic.ttf']);
  assert.equal(plan.style.crest, 'Assets/Pictures/courier-crest.png');
  assert.equal(plan.style.greyscale, true);
  const linked = plan.editions.filter((e) => !e.unlinked);
  assert.deepEqual(linked.map((e) => [e.number, e.date, e.preview, e.status]), [[1, '2026-10-13', false, 'Delivered'], [2, '2026-10-17', true, 'Draft'], [2, '2026-10-17', false, 'Delivered']]);
  const no2 = linked.find((e) => e.number === 2 && !e.preview);
  assert.equal(no2.lead, 'Ferry timetable changes for summer');
  assert.deepEqual(no2.pictures, [{ path: 'Assets/Pictures/Gus and Tilly No2 Rain.png', label: 'Gus & Tilly: Rain' }]);
  // Both fonts named on one line, each with what it is for in brackets after it.
  const one = B.planImport({ path: 'P.md', title: 'P', props: {}, content: '# P\n\n- **Fonts:** Assets/Fonts/Blackletter-Bold.ttf (masthead), Classic-Regular, Bold and Italic.ttf (body, headlines)\n' }, FILES, '2026-10-24');
  assert.equal(one.style.mastheadFont, 'Assets/Fonts/Blackletter-Bold.ttf');
  assert.equal(one.style.bodyFont, 'Assets/Fonts/Classic-Regular.ttf');
  const extra = plan.editions.filter((e) => e.unlinked);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].sameAs, 'Assets/Papers/Bayside_Courier_No2_2026-10-17.pdf', 'the same size as the linked preview: said to be a copy');
});

// ── The main side: import applied, pieces, the gate, the tools ─────────────────────────────────────────────────

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const index = new M.VaultIndex();
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
    if (rel.endsWith('.md')) index.set(rel, text, Date.now(), text.length);
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  return { dir, index, put };
}

function service({ dir, index, put }, switches, extra = {}) {
  const written = [];
  const placed = [];
  const printer = {
    pdf: async (html) => ({ pdf: Buffer.from(`%PDF-1.4 ${html.length}`), laidOut: { pages: 3, sections: [{ name: 'Front', budget: 1, used: 0.8, pages: 1, first: 1, over: false, overflow: [] }], items: {}, cut: [] } }),
    print: async () => ({ pages: 3, sections: [], items: {}, cut: [] }),
    printers: async () => [],
    stage: async () => 'file:///stage.html',
  };
  const p = new M.Publications({
    root: () => dir,
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: switches() }),
    writeNote: async (rel, text) => {
      written.push(rel);
      put(rel, text);
    },
    requireCreate: async () => {},
    exists: async (rel) => existsSync(path.join(dir, rel)),
    files: async () => FILES.map((f) => ({ ...f })),
    placeFile: async (o) => {
      const rel = `${o.record.replace(/\/[^/]+$/, '')}/Files/${o.name}`;
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), readFileSync(o.src));
      placed.push(rel);
      return { rel, version: 1 };
    },
    copyIn: async () => [],
    pickFiles: async () => [],
    pickSave: async () => null,
    printer,
    appFonts: async () => ({}),
    readPdfText: async () => '',
    post: () => 0,
    changed: () => {},
    now: () => TODAY,
    ...extra,
  });
  return { p, written, placed };
}

function sensitivityFor(index, store) {
  const L = S.sensitivity;
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name),
    useGrant: () => false,
    allows: (who, level) => L.allows(store, who, level),
    audit: () => {},
  };
  return sens;
}

test('main side: the import keeps every word of the note, links the PDFs where they are, and is never made twice', async () => {
  const v = vault({ 'Publications/The Bayside Courier.md': OLD_NOTE, '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const st0 = await p.state();
  assert.deepEqual(st0.waiting.map((w) => w.title), ['The Bayside Courier']);
  const words = await p.importApply('Publications/The Bayside Courier.md', {});
  assert.match(words, /3 sections, 3 editions, 1 cartoon kept as pieces/);
  const after = readFileSync(path.join(v.dir, 'Publications/The Bayside Courier.md'), 'utf8');
  for (const line of OLD_NOTE.split('\n')) if (line.trim() && line !== '---') assert.ok(after.includes(line), `kept: ${line.slice(0, 60)}`);
  assert.match(after, /^schedule: Tue, Sat 06:30$/m);
  assert.match(after, /^printer: Office Laser 200$/m);
  assert.match(after, /^masthead_font: "\[\[Assets\/Fonts\/Blackletter-Bold\.ttf\]\]"$/m);
  assert.match(after, /## Sections\n\n\| Section \| Pages \| Sources \| Rules \|/);
  assert.ok(after.indexOf('## Sections') < after.indexOf('## Editions'), 'the sections go before the editions');
  const st = await p.state();
  assert.equal(st.waiting.length, 0);
  assert.deepEqual(st.current.editions.map((e) => e.label), ['No. 2', 'No. 2 (preview)', 'No. 1']);
  const no2 = st.current.editions.find((e) => e.label === 'No. 2');
  assert.equal(no2.pdf, 'Assets/Papers/Bayside Courier No2 2026-10-17.pdf', 'the PDF linked where it is');
  assert.equal(no2.lead, 'Ferry timetable changes for summer');
  assert.equal(no2.pieces, 1, 'its cartoon is a piece in it');
  const cartoon = st.current.items.find((i) => i.kind === 'cartoon');
  assert.equal(cartoon.headline, 'Rain');
  assert.equal(cartoon.image, 'Assets/Pictures/Gus and Tilly No2 Rain.png');
  // Never twice.
  await p.importApply('Publications/The Bayside Courier.md', {});
  assert.equal((await p.state()).current.editions.length, 3);
  for (const f of FILES) assert.ok(!f.path.startsWith('Publications/'), 'nothing moved');
});

test('main side: pieces follow their section’s rules; an edition is built, its PDF kept with it; the answers carry over', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p, placed } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  assert.equal(pub, 'Publications/The Harbour Gazette/The Harbour Gazette.md');
  await assert.rejects(() => p.addItem(pub, { kind: 'story', headline: 'Unsourced', section: 'News', body: 'x' }), /needs every item to say where it came from/);
  await assert.rejects(() => p.addItem(pub, { kind: 'story', headline: 'Wrong section', section: 'Weather desk', source: 'X' }), /has no section called Weather desk/);
  const s1 = await p.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post', lead: true });
  // 27 Oct 2026: a piece goes into its day's edition (made when there is none), inside that edition's note.
  assert.match(s1, /^Publications\/The Harbour Gazette\/Editions\/No\. 1 – 2026-10-24\.md#path-opens$/);
  assert.ok(!existsSync(path.join(v.dir, 'Publications', 'The Harbour Gazette', 'Items')), 'no note of its own');
  // A puzzle made, kept with its answers, in No. 1; No. 2 prints its answers.
  const made = p.makePuzzle({ kind: 'crossword', clues: CLUES, seed: 4 });
  assert.deepEqual(made.problems, []);
  const cw = await p.savePuzzle(pub, { puzzle: made.puzzle, title: 'Around the bay' });
  const e1 = s1.split('#')[0];
  assert.equal(cw.split('#')[0], e1, 'the puzzle went into the same day\'s edition');
  assert.match(readFileSync(path.join(v.dir, e1), 'utf8'), /### Around the bay\n<!--nv:piece \{"kind":"crossword"[^\n]*-->\n[\s\S]*#### Answers\n\n\*\*Across:\*\*/);
  await p.setEdition(e1, { sections: [{ name: 'Front', items: [s1.replace(/\.md$/, '')] }, { name: 'Puzzles', items: [cw.replace(/\.md$/, '')] }] });
  const built = await p.build(e1);
  assert.equal(built.pdf, placed[0]);
  assert.match(built.words, /Built No\. 1: 3 pages\./);
  const e1Text = readFileSync(path.join(v.dir, e1), 'utf8');
  assert.match(e1Text, /^status: Built$/m);
  assert.match(e1Text, /^pages: 3$/m);
  assert.ok(e1Text.includes(`pdf: "[[${built.pdf}]]"`));
  const e2 = await p.newEdition(pub, { date: '2026-10-31' });
  const d2 = await p.edition(e2);
  assert.deepEqual(d2.answers, { from: 'No. 1', count: 1 });
  await assert.rejects(p.newEdition(pub, { date: '2026-10-31' }), /already has an edition for 2026-10-31/, 'one evening never yields two editions for the same date');
  // The pages: the masthead, the lead, the answers to No. 1 at the end of the puzzles.
  await p.setEdition(e2, { sections: [{ name: 'Front', items: [s1.replace(/\.md$/, '')] }, { name: 'Puzzles', items: [] }] });
  // Solve times kept in the puzzle's note.
  assert.match(await p.solve(cw, { who: 'Mia', time: '12:30' }), /Mia: Crossword in 12:30/);
  assert.match(await p.solve(cw, { who: 'Mia', time: '9:05' }), /a new best \(was 12:30\)/);
  const st = await p.state();
  assert.equal(st.current.board.best[0].seconds, 545);
  // Searching finds the crossword by an answer.
  const hits = await p.search('the crossword with LIGHTHOUSE in it');
  assert.equal(hits[0].item, cw);
});

test('main side: the agents’ tools through a gate — Family-private unless allowed, and then they work', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  let on = true;
  const { p } = service(v, () => ({ publications: { on } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  const L = S.sensitivity;
  const store = L.emptyStore();
  const sens = sensitivityFor(v.index, store);
  assert.equal(L.levelOf(store, pub, undefined, 'publication').level, 'family', 'a publication is Family-private by its type');
  // A chat bot isn't allowed Family-private by default: told so, nothing written.
  const bot = M.makeGate(sens, 'neuralbot', 'Chat bot');
  assert.match((await p.callTool('publication_list', {}, bot)).text, /isn’t allowed Family-private/);
  assert.match((await p.callTool('puzzle_generate', { kind: 'sudoku' }, bot)).text, /isn’t allowed Family-private/);
  // Allowed (the person's choice in Settings › Privacy and secrets): the tools work.
  store.access.neuralbot = ['open', 'work', 'family'];
  const list = await p.callTool('publication_list', {}, bot);
  assert.match(list.text, /\*\*The Harbour Gazette\*\*/);
  assert.match(list.text, /- News \(2 pages\) — sources: Any named source — rules: Named outlets only/);
  const sudoku = await p.callTool('puzzle_generate', { kind: 'sudoku', difficulty: 'easy', title: 'Saturday sudoku' }, bot);
  assert.match(sudoku.text, /An easy sudoku|A easy sudoku/);
  assert.match(sudoku.done.words, /Made a sudoku for The Harbour Gazette/);
  // An edition built from pieces: an unsourced news story refuses the whole build; with sources it is made and laid out.
  const refused = await p.callTool('publication_edition_build', { items: [{ kind: 'story', section: 'News', headline: 'No source here', body: 'x' }] }, bot);
  assert.match(refused.text, /^Nothing was written\. “No source here”: News needs every item to say where it came from/);
  const ok = await p.callTool('publication_edition_build', { date: '2026-10-24', items: [{ kind: 'story', section: 'Front', headline: 'Path opens', body: 'The path opened today.', source: 'Harbour Post', lead: true }, { kind: 'brief', section: 'News', headline: 'Rain due', body: 'Showers Tuesday.', source: 'Weather office' }], pieces: [{ path: sudoku.text.match(/\[([^\]]+)\]/)[1] }] }, bot);
  assert.match(ok.text, /Made The Harbour Gazette No\. 1 for Saturday 24 October 2026/);
  assert.match(ok.text, /Built No\. 1: 3 pages/);
  const ed = await p.callTool('publication_edition', {}, bot);
  assert.match(ed.text, /News \(2 pages\): Brief “Rain due” \(Weather office\)/);
  assert.match(ed.text, /Puzzles \(1 page\): Sudoku “Saturday sudoku”/);
  const solve = await p.callTool('puzzle_solve_time', { kind: 'sudoku', who: 'Sam', time: '6:40' }, bot);
  assert.match(solve.text, /Sam: Sudoku in 6:40/);
  const found = await p.callTool('publication_search', { query: 'rain' }, bot);
  assert.match(found.text, /No\. 1 \(Sat 24 Oct\): Brief “Rain due”/);
  // Sending needs the former host app: said in the delivery log, never a raw error.
  await p.setPublication(pub, { telegram: true });
  const sent = await p.callTool('publication_edition_deliver', {}, bot);
  assert.match(sent.text, /Telegram \(the chat\): Not sent: nothing is connected to send it by Telegram/);
  // With a host that delivers: sent, and the status says so.
  const got = [];
  const { p: p2 } = service(v, () => ({ publications: { on: true } }), { deliver: async (r) => (got.push(r), { ok: true, words: 'Sent' }) });
  const sent2 = await p2.callTool('publication_edition_deliver', { how: ['telegram'] }, bot);
  assert.match(sent2.text, /Telegram \(the chat\): Sent/);
  assert.equal(got[0].channel, 'telegram');
  assert.match(got[0].caption, /The Harbour Gazette · No\. 1 · Saturday 24 October 2026/);
  assert.ok(got[0].file.endsWith('.pdf'));
  const state = await p2.state();
  assert.equal(state.current.editions[0].status, 'Delivered');
  // Switched off: no tools; every note as it was.
  on = false;
  assert.deepEqual(p.toolsOn(), []);
  assert.match((await p.callTool('publication_list', {}, bot)).text, /switched off/);
  assert.equal(await p.callTool('finance_bills_due', {}, bot), null, 'not one of its tools');
});

test('main side: on the schedule, today’s edition goes out once; no edition for today is said once in the bell', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const posted = [];
  const got = [];
  let now = new Date(2026, 9, 24, 8, 3);
  const { p } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (r) => (got.push(r), { ok: true, words: 'Sent' }), now: () => now });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(pub, { telegram: true });
  assert.equal(await p.tick(now), 0);
  assert.match(posted[0].title, /No edition of The Harbour Gazette for today/);
  assert.equal(await p.tick(now), 0);
  assert.equal(posted.length, 1, 'said once');
  const { p: q } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (r) => (got.push(r), { ok: true, words: 'Sent' }), now: () => now });
  const e = await q.newEdition(pub, { date: '2026-10-24' });
  // An edition with nothing in it is never printed as a bare masthead (26 Oct 2026): the bell says why.
  assert.equal(await q.tick(now), 0);
  assert.equal(got.length, 0);
  assert.match(posted.at(-1).title, /didn’t go out/);
  assert.match(posted.at(-1).body, /no stories or pieces in its sections yet, so there is nothing to print/);
  const { p: r } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (x) => (got.push(x), { ok: true, words: 'Sent' }), now: () => now });
  const s1 = await r.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
  await r.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
  { const n = await r.tick(now); if (n !== 1) console.log('DBG', JSON.stringify(posted.slice(-2)), readFileSync(path.join(v.dir, e), 'utf8')); assert.equal(n, 1); }
  assert.equal(got.length, 1);
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /\| Scheduled \| Sat 08:00 \| Done \|/);
  assert.equal(await r.tick(now), 0, 'once a day');
  now = new Date(2026, 9, 24, 9, 30);
  assert.equal(await r.tick(now), 0, 'not long after its time');
});

test('main side: an edition made elsewhere and filed in the vault is that edition, never a second one built beside it', async () => {
  // 26 Oct 2026: an agent filed The Arlow Times No. 3 into the asset store; the publication printed a bare masthead.
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }), 'Assets/Documents/Harbour Gazette No4 2026-10-31.pdf': '%PDF-1.7 the real paper', 'Assets/Documents/Other Paper No4 2026-10-31.pdf': '%PDF-1.7 not ours' });
  const posted = [];
  const got = [];
  const now = new Date(2026, 9, 31, 8, 2);
  const walk = (d, at = '') => readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name), `${at}${x.name}/`) : [{ path: `${at}${x.name}`, size: readFileSync(path.join(d, x.name)).length }]));
  const { p } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (r) => (got.push(r), { ok: true, words: 'Sent' }), now: () => now, files: async () => walk(v.dir) });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(pub, { telegram: true });
  const shown = await p.state(pub);
  assert.equal(await p.tick(now), 1, 'today’s filed paper goes out');
  assert.equal(got.length, 1);
  assert.match(got[0].file.replace(/\\/g, '/'), /Assets\/Documents\/Harbour Gazette No4 2026-10-31\.pdf$/, 'the filed PDF, not a new one');
  const state = await p.state(pub);
  const ed = state.current.editions.find((x) => x.date === '2026-10-31');
  assert.equal(ed.number, 4, 'numbered from its file');
  assert.equal(ed.pdf, 'Assets/Documents/Harbour Gazette No4 2026-10-31.pdf');
  assert.equal(shown.current.editions.length, 0);
  // An edition note that has no PDF of its own shows and sends the one filed for it.
  const e5 = await p.newEdition(pub, { number: 5, date: '2026-11-07' });
  writeFileSync(path.join(v.dir, 'Assets/Documents/Arlow Harbour Gazette No. 5 – 2026-11-07.pdf'), '%PDF-1.7 five');
  assert.equal((await p.state(pub)).current.editions.find((x) => x.number === 5).pdf, 'Assets/Documents/Arlow Harbour Gazette No. 5 – 2026-11-07.pdf');
  await p.deliver(e5, ['telegram']);
  assert.match(got.at(-1).file, /No\. 5 – 2026-11-07\.pdf$/);
  assert.match(readFileSync(path.join(v.dir, e5), 'utf8'), /^pdf: "?\[\[Assets\/Documents\/Arlow Harbour Gazette No\. 5 – 2026-11-07\.pdf\]\]"?$/m);
  const S2 = S.publications;
  assert.equal(S2.editionFileOf({ title: 'The Arlow Times', masthead: 'The Arlow Times' }, 'Assets/Documents/Arlow_Times_No2_2026-10-23.pdf').number, 2);
  assert.equal(S2.editionFileOf({ title: 'The Arlow Times', masthead: 'The Arlow Times' }, 'Assets/Documents/Arlow Times No3 2026-10-26.pdf').date, '2026-10-26');
  assert.equal(S2.editionFileOf({ title: 'The Arlow Times', masthead: 'The Arlow Times' }, 'Assets/Documents/Times Crossword answers.pdf'), null);
});

// ── The edition's pages ────────────────────────────────────────────────────────────────────────────────────────

test('pages: the masthead, sections in order, puzzles drawn, the last answers, and every word made safe', () => {
  const B = S.publications;
  const P = S.puzzles;
  const D = S.editionDoc;
  const pub = B.readPublication({ path: 'G.md', title: 'The Harbour Gazette', props: { masthead: 'The Harbour Gazette', motto: 'From our house to yours' }, content: B.newPublicationText({ title: 'The Harbour Gazette' }) });
  const cw = P.makeCrossword(P.readClueLines(CLUES), { seed: 2 });
  const sd = P.makeSudoku({ seed: 2 });
  const item = (path, kind, headline, body, extra = {}) => ({ path, title: headline, kind, publication: '', section: '', headline, deck: '', source: '', sourceUrl: '', credit: '', who: '', image: '', lead: false, date: null, body, puzzle: null, solves: [], ...extra });
  const html = D.editionDocument({
    pub,
    number: 5,
    date: '2026-10-24',
    template: B.templateOf('classic'),
    sections: [
      { name: 'Front', pages: 1, items: [item('a.md', 'story', 'Path <opens> & walkers cheer', 'First para.\n\nSecond **bold** para.', { lead: true, source: 'Harbour Post' }), item('w.md', 'weather', 'The week ahead', '| Place | Today | Sun |\n| --- | --- | --- |\n| Harbour Town | 21° Sunny | 18° |')] },
      { name: 'Puzzles', pages: 1, items: [item('c.md', 'crossword', 'Around the bay', '', { puzzle: cw }), item('s.md', 'sudoku', 'Sudoku', '', { puzzle: sd })] },
    ],
    answers: { from: 'No. 4', blocks: [{ item: 'old.md', kind: 'sudoku', title: 'Sudoku', puzzle: P.makeSudoku({ seed: 9 }) }] },
    url: () => '',
    mode: 'print',
  });
  assert.match(html, /<div class="mast-title">The Harbour Gazette<\/div>/);
  assert.match(html, /From our house to yours/);
  assert.match(html, /Saturday 24 October 2026/);
  assert.ok(html.includes('Path &lt;opens&gt; &amp; walkers cheer'), 'a headline is made safe');
  assert.ok(!html.includes('<opens>'));
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /class="drop"/, 'the lead’s first paragraph has a drop cap');
  assert.ok(html.indexOf('data-name="Front"') < html.indexOf('data-name="Puzzles"'));
  assert.match(html, /class="xw" style="--w:\d+;--h:\d+"/);
  assert.match(html, /class="sd"/);
  assert.match(html, /Answers<\/span><span class="pz-title">to No\. 4/);
  assert.match(html, /<div class="ear">Harbour Town<b>21° Sunny<\/b><\/div>/, 'the weather’s first line in the ear');
  assert.match(html, /data-inside="Puzzles"/, 'Inside lists the other sections');
  assert.match(D.laidOutWords({ pages: 4, sections: [{ name: 'News', budget: 2, used: 2.4, pages: 3, first: 2, over: true, overflow: ['x.md'] }], items: {}, cut: [] }, () => 'Hawks win'), /^4 pages\. News runs 0\.4 of a page over its 2 \(“Hawks win” past it\)\.$/);
});

test('the module: in the catalogue, its types Family-private, its tools offered only while it is on', () => {
  const R = S.moduleRecords;
  const T = S.moduleTools;
  const LM = S.lifeModules;
  assert.ok(R.moduleById('publications'));
  assert.equal(R.moduleTypeLevel('edition'), 'family');
  assert.equal(R.moduleTypeLevel('publication-item'), 'family');
  assert.equal(R.typeFolder('publication', [{ id: 'publications', folder: 'Publications' }]), 'Publications');
  assert.equal(R.moduleFolder('publications', null), 'Publications');
  assert.equal(LM.moduleInfo('publications').level, 'family');
  assert.equal(LM.moduleOn({}, 'publications'), false, 'off by default');
  const tools = T.MODULE_TOOLS.filter((t) => t.module === 'publications').map((t) => t.name);
  assert.deepEqual(tools.sort(), ['publication_edition', 'publication_edition_build', 'publication_edition_deliver', 'publication_item_add', 'publication_list', 'publication_next', 'publication_search', 'publication_setup', 'puzzle_generate', 'puzzle_solve_time']);
  for (const t of T.MODULE_TOOLS.filter((x) => x.module === 'publications')) assert.ok(t.step && t.title && t.description.length > 40);
});

test('a publication’s own layout: the edition is poured into the spots it marks, each piece once, its files beside it', () => {
  // 26 Oct 2026. A layout made once from the person's own example (Layout/edition.html in the publication's folder)
  // takes every later edition's words.
  const D = S.editionDoc;
  const item = (path, kind, headline, body, extra = {}) => ({ path, title: headline, kind, publication: '', section: '', headline, deck: '', source: 'Harbour Post', sourceUrl: '', credit: '', who: '', image: '', lead: false, date: null, body, puzzle: null, solves: [], ...extra });
  const lead = item('I/Lead.md', 'story', 'Path opens', 'The path opened today.', { lead: true });
  const other = item('I/Two.md', 'story', 'Ferry late', 'The ferry ran late.');
  const wx = item('I/Wx.md', 'weather', 'Weather', '| Place | Today |\n| --- | --- |\n| Bay | 20° |');
  const layout = '<!doctype html><html><head><style>@page{size:A4}</style></head><body><header><!--nv:masthead--> · <!--nv:number--> · <!--nv:date--></header><div class="ear"><!--nv:kind:weather--></div><main><!--nv:lead--></main><section><!--nv:section:News--></section><img src="crest.png"><i><!--nv:nothing--></i></body></html>';
  const html = D.layoutDocument(layout, { pub: { title: 'The Harbour Gazette', masthead: 'The Harbour Gazette', motto: '', style: {} }, number: 4, date: '2026-10-31', template: {}, sections: [{ name: 'News', pages: 2, items: [lead, other, wx] }], answers: null, url: (r) => `file:///v/${r}`, mode: 'print' }, 'file:///v/Publications/The%20Harbour%20Gazette/Layout/');
  assert.match(html, /<header>The Harbour Gazette · No\. 4 · Saturday 31 October 2026<\/header>/);
  assert.match(html, /<main><div class="it it-story lead span"[^>]*>.*Path opens/s, 'the lead in its spot');
  assert.match(html, /<div class="ear"><div class="it it-weather/, 'the weather where the layout put it');
  const news = html.slice(html.indexOf('<section>'), html.indexOf('</section>'));
  assert.ok(news.includes('Ferry late') && !news.includes('Path opens') && !news.includes('it-weather'), 'the section has the rest, each piece once');
  assert.match(html, /<head><base href="file:\/\/\/v\/Publications\/The%20Harbour%20Gazette\/Layout\/">/, 'its fonts and pictures open from beside it');
  assert.match(html, /<i><\/i>/, 'an unknown spot is left empty');
  assert.match(html, /getAttribute\('data-section'\)[\s\S]*s\.used\+=over\?p\.scrollHeight\/h/, 'and it says how full each section’s pages are, for the fit');
  assert.match(readFileSync(path.join(import.meta.dirname, '../src/main/publications.ts'), 'utf8'), /const own = `\$\{pub\.folder\}\/\$\{LAYOUT_FILE\}`;[\s\S]{0,300}layoutDocument\(layout, input/, 'the build uses the publication’s own layout when it has one');
});

test('main side: a matched page is kept as the publication’s layout, with the files it uses', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette' });
  const work = mkdtempSync(path.join(tmpdir(), 'nv-layout-'));
  mkdirSync(path.join(work, 'fonts'));
  writeFileSync(path.join(work, 'fonts', 'Mast.ttf'), 'font');
  writeFileSync(path.join(work, 'crest.png'), 'png');
  writeFileSync(path.join(work, 'plain.html'), '<html><body><h1>The Harbour Gazette</h1><p>Today’s story.</p></body></html>');
  await assert.rejects(() => p.keepLayout({ publication: 'Harbour Gazette', page: path.join(work, 'plain.html') }), /Mark where each edition’s words go/);
  writeFileSync(path.join(work, 'paper.html'), '<html><head><style>@font-face{font-family:M;src:url("fonts/Mast.ttf")}</style></head><body><img src="crest.png"><img src="https://example.org/x.png"><h1><!--nv:masthead--></h1><!--nv:section:News--></body></html>');
  const words = await p.keepLayout({ publication: 'Harbour Gazette', page: path.join(work, 'paper.html') });
  assert.match(words, /now has its own layout .*with 2 files it uses/);
  const dir = path.join(v.dir, 'Publications/The Harbour Gazette/Layout');
  assert.match(readFileSync(path.join(dir, 'edition.html'), 'utf8'), /<!--nv:section:News-->/);
  assert.ok(existsSync(path.join(dir, 'fonts', 'Mast.ttf')) && existsSync(path.join(dir, 'crest.png')), 'its font and crest beside it');
  // A paper that isn't a publication yet is made one (asked for the paper, not for a module).
  const made = await p.keepLayout({ publication: 'The Bayside Bugle', page: path.join(work, 'paper.html') });
  assert.match(made, /The Bayside Bugle now has its own layout/);
  assert.ok(existsSync(path.join(v.dir, 'Publications/The Bayside Bugle/Layout/edition.html')));
  assert.match(readFileSync(path.join(import.meta.dirname, '../src/main/app.ts'), 'utf8'), /if \(!was\) await settings\.update\(\{ prefs: \{ modules: withSwitch\(settings\.raw\.prefs\.modules, 'publications', true\) \} \}\)/, 'and asking to keep one switches Publications on');
  rmSync(work, { recursive: true, force: true });
});

test('main side: a paper is set up in one call, made when it is new, with its look from files on this PC', async () => {
  // 26 Oct 2026.
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const copied = [];
  const { p } = service(v, () => ({ publications: { on: true } }), { copyIn: async (abs, folder) => { const out = []; for (const f of abs) { copied.push(f); const rel = `${folder}/${path.basename(f)}`; mkdirSync(path.dirname(path.join(v.dir, rel)), { recursive: true }); writeFileSync(path.join(v.dir, rel), readFileSync(f)); out.push(rel); } return out; } });
  const pc = mkdtempSync(path.join(tmpdir(), 'nv-setup-'));
  for (const f of ['Mast.ttf', 'Body.ttf']) writeFileSync(path.join(pc, f), 'x');
  writeFileSync(path.join(pc, 'crest.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const r = await p.callTool('publication_setup', { publication: 'The Harbour Times', schedule: 'Mon, Fri 07:00', template: 'Broadsheet', sections: [{ name: 'Front', pages: 1 }, { name: 'News', pages: 2, sources: 'Any named source' }], telegram: true, ink: '#111111', greyscale: true, masthead_font: path.join(pc, 'Mast.ttf'), body_font: path.join(pc, 'Body.ttf'), crest: path.join(pc, 'crest.png') });
  assert.match(r.text, /The Harbour Times is set up: Front \(1 page\), News \(2 pages\); .*template Broadsheet/);
  assert.match(r.text, /one publication_edition_build/);
  const note = readFileSync(path.join(v.dir, 'Publications/The Harbour Times/The Harbour Times.md'), 'utf8');
  assert.match(note, /^schedule: Mon, Fri 07:00$/m);
  assert.match(note, /^telegram: Yes$/m);
  assert.match(note, /^masthead_font: "?\[\[Publications\/The Harbour Times\/Fonts\/Mast\.ttf\]\]"?$/m);
  assert.match(note, /^crest: "?\[\[Publications\/The Harbour Times\/Pictures\/crest\.png\]\]"?$/m);
  assert.equal(copied.length, 3, 'its fonts and crest copied in from this PC');
  rmSync(pc, { recursive: true, force: true });
});

test('main side: a built edition says what it still lacks: the lead on page 1, the weather as a table, every section filled, the pieces its rules ask for', async () => {
  // 26 Oct 2026: the proof run handed over 7 of 9 pages, its front a masthead and a weather sentence, and no cartoon.
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const laid = { pages: 7, sections: [{ name: 'Front', budget: 1, used: 1, pages: 1, first: 1, over: false, overflow: [] }, { name: 'News', budget: 2, used: 0.8, pages: 1, first: 2, over: false, overflow: [] }, { name: 'Funnies & puzzles', budget: 2, used: 2, pages: 2, first: 3, over: false, overflow: [] }], items: {}, cut: [] };
  const { p } = service(v, () => ({ publications: { on: true } }), { printer: { pdf: async (html) => ({ pdf: Buffer.from(`%PDF ${html.length}`), laidOut: laid }), print: async () => laid, printers: async () => [], stage: async () => '' } });
  await p.callTool('publication_setup', { publication: 'The Harbour Times', sections: [{ name: 'Front', pages: 1, rules: 'Weather for both cities' }, { name: 'News', pages: 2 }, { name: 'Funnies & puzzles', pages: 2, rules: 'One cartoon strip and a crossword' }] });
  // Weather as a sentence is refused, with the table it should be.
  const prose = await p.callTool('publication_edition_build', { publication: 'The Harbour Times', date: '2026-10-26', items: [{ kind: 'weather', headline: 'Weather', section: 'Front', body: 'Mon 18/9 showers; Tue 20/11 fine.' }] });
  assert.match(prose.text, /^Nothing was written\. “Weather”: weather is a table, a row per place and a column per day/);
  // A lead filed under News goes on page 1; what is still missing is said before anything is handed over.
  const built = await p.callTool('publication_edition_build', { publication: 'The Harbour Times', date: '2026-10-26', items: [
    { kind: 'weather', headline: 'Weather', section: 'Front', body: '| Place | Mon |\n| --- | --- |\n| Bay | 18° |' },
    { kind: 'story', headline: 'Harbour bridge reopens', section: 'News', body: 'It reopened.', source: 'Harbour Post', lead: true },
    { kind: 'brief', headline: 'Ferry late', section: 'News', body: 'It was late.', source: 'Harbour Post' },
  ] });
  assert.match(built.text, /^NOT FINISHED, so don't hand it over yet:/);
  assert.match(built.text, /News fills 0\.8 of its 2 pages: add about 5 more briefs or stories/);
  assert.match(built.text, /Funnies & puzzles has no cartoon, which its rules ask for: add a cartoon \(make the strip with the picture tool/);
  assert.match(built.text, /Funnies & puzzles has no crossword/);
  assert.doesNotMatch(built.text, /front page has no lead/, 'the lead filed under News is on page 1');
  assert.doesNotMatch(built.text, /Front has no weather/, 'and the front has its weather');
  const ed = await p.edition(built.text.match(/\[(Publications\/[^\]]+\.md)\]/)[1]);
  assert.ok(ed.sections[0].items.some((i) => i.headline === 'Harbour bridge reopens'), 'the lead is drawn in the front page’s section');
});

test('main side: a cartoon made on this PC is copied into the publication with its piece', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const pc = mkdtempSync(path.join(tmpdir(), 'nv-strip-'));
  const strip = path.join(pc, 'strip.png');
  writeFileSync(strip, 'png');
  const { p } = service(v, () => ({ publications: { on: true } }), { copyIn: async (abs, folder) => abs.map((f) => { const rel = `${folder}/${path.basename(f)}`; mkdirSync(path.join(v.dir, folder), { recursive: true }); writeFileSync(path.join(v.dir, rel), readFileSync(f)); return rel; }), exists: async (rel) => existsSync(path.join(v.dir, rel)) });
  const pub = await p.createPublication({ title: 'The Harbour Times' });
  const rel = await p.addItem(pub, { kind: 'cartoon', headline: 'Chief and the Boss', section: 'Puzzles', body: '1. Rain again.\n2. Saturday is fine.', image: strip });
  assert.match(readFileSync(path.join(v.dir, rel.split('#')[0]), 'utf8'), /"image":"Publications\/The Harbour Times\/Pictures\/strip\.png"/);
  rmSync(pc, { recursive: true, force: true });
});

test('main side: an edition is one note — building again the same day replaces it; older item notes fold into their editions (27 Oct 2026)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const trashed = [];
  const { p } = service(v, () => ({ publications: { on: true } }), { trash: async (rel) => { trashed.push(rel); rmSync(path.join(v.dir, rel)); v.index.remove?.(rel) ?? v.index.delete?.(rel); } });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  const first = await p.callTool('publication_edition_build', { date: '2026-10-24', items: [{ kind: 'story', section: 'Front', headline: 'Path opens', body: 'The path opened today.', source: 'Harbour Post', lead: true }, { kind: 'brief', section: 'News', headline: 'Rain due', body: 'Showers Tuesday.', source: 'Weather office' }] }, null);
  assert.match(first.text, /Made The Harbour Gazette No\. 1/);
  const again = await p.callTool('publication_edition_build', { date: '2026-10-24', items: [{ kind: 'story', section: 'Front', headline: 'Ferry back on', body: 'The ferry runs again.', source: 'Harbour Post', lead: true }] }, null);
  assert.match(again.text, /Updated The Harbour Gazette No\. 1/, 'the same day: the same edition, the same number');
  const eds = readdirSync(path.join(v.dir, 'Publications', 'The Harbour Gazette', 'Editions')).filter((f) => f.endsWith('.md'));
  assert.deepEqual(eds, ['No. 1 – 2026-10-24.md'], 'never a No. 2 for the same day');
  const note = readFileSync(path.join(v.dir, 'Publications', 'The Harbour Gazette', 'Editions', eds[0]), 'utf8');
  assert.match(note, /## Front\n\n### Ferry back on\n<!--nv:piece \{"kind":"story","lead":true,"date":"2026-10-24","source":"Harbour Post"\}-->\n\nThe ferry runs again\./, 'the piece is in the edition, readable as a note');
  assert.ok(!note.includes('Path opens') && !note.includes('Rain due'), 'building again replaces what was in it');
  assert.ok(!existsSync(path.join(v.dir, 'Publications', 'The Harbour Gazette', 'Items')), 'no item notes');
  // An older vault: No. 4 and No. 5 link the same item notes (the evening). Folded in, the notes go to the bin.
  const items = 'Publications/The Harbour Gazette/Items';
  v.put(`${items}/2026-10-27 Weather.md`, '---\ntype: publication-item\nkind: Weather\npublication: "[[The Harbour Gazette]]"\nsection: Front\ndate: 2026-10-27\nsource: Open-Meteo\n---\n# Weather · Seven days\n\n| Place | Tue |\n| --- | --- |\n| Melbourne | 15° |\n');
  v.put(`${items}/2026-10-27 Cup Day.md`, '---\ntype: publication-item\nkind: Headline story\npublication: "[[The Harbour Gazette]]"\nsection: Sport\nsource: Racing Victoria\n---\n# Cup Day next Tuesday\n\nThe Carnival returns.\n');
  const old = (n) => `---\ntype: edition\npublication: "[[The Harbour Gazette]]"\nnumber: ${n}\ndate: 2026-10-27\nstatus: Built\n---\n# The Harbour Gazette · No. ${n}\n\n## Front\n\n- [[${items}/2026-10-27 Weather]]\n\n## Sport\n\n- [[${items}/2026-10-27 Cup Day]]\n\n## Delivery\n\n| When | How | To | Result |\n| --- | --- | --- | --- |\n| 2026-10-27 | Telegram | Jesse | Sent |\n`;
  v.put('Publications/The Harbour Gazette/Editions/No. 4 – 2026-10-27.md', old(4));
  v.put('Publications/The Harbour Gazette/Editions/No. 5 – 2026-10-27.md', old(5));
  assert.equal(await p.foldItems(), 2);
  const no5 = readFileSync(path.join(v.dir, 'Publications/The Harbour Gazette/Editions/No. 5 – 2026-10-27.md'), 'utf8');
  assert.match(no5, /## Front\n\n### Weather · Seven days\n<!--nv:piece \{"kind":"weather","date":"2026-10-27","source":"Open-Meteo"\}-->\n\n\| Place \| Tue \|/, 'each edition holds its pieces');
  assert.match(no5, /## Sport\n\n### Cup Day next Tuesday\n/);
  assert.match(no5, /## Delivery\n\n\| When \| How \| To \| Result \|/, 'its delivery log kept');
  assert.deepEqual(trashed.sort(), [`${items}/2026-10-27 Cup Day.md`, `${items}/2026-10-27 Weather.md`], 'the item notes go to the bin once folded');
  const d5 = await p.edition('Publications/The Harbour Gazette/Editions/No. 5 – 2026-10-27.md');
  assert.deepEqual(d5.sections.filter((s) => s.items.length).map((s) => [s.name, s.items.map((i) => i.headline)]), [['Front', ['Cup Day next Tuesday', 'Weather · Seven days']]], 'and reads them back as pieces (with no lead marked, the first story leads on the front)');
  assert.equal(await p.foldItems(), 0, 'once');
});

test('9.2 section rules: a negated kind is not asked for', () => {
  assert.equal(M.wantedRules('one cartoon strip + crossword; no sudoku'), 'one cartoon strip ; crossword');
  assert.equal(M.wantedRules('no cartoons this week'), '');
  assert.equal(M.wantedRules('sudoku + Wordle + word search'), 'sudoku ; Wordle ; word search');
});

test('9.5 batch 12: variant headings reuse their table; unknown kinds and lone times stay raw (F147, F148)', () => {
  const P = S.publications;
  const v = '# T\n\n## Paper Sections\n\n| Section | Pages |\n| --- | --- |\n| News | 2 |\n';
  const out = P.withSections(v, [{ name: 'News', pages: 3, sources: '', rules: '' }]);
  assert.equal((out.match(/\| Section \| Pages \|/g) ?? []).length, 1, 'no second table');
  assert.match(out, /\| News \| 3 \|/);
  const sv = '# T\n\n## My Solve Times\n\n| Who | Time |\n| --- | --- |\n| Mia | 12:30 |\n';
  assert.match(P.withSolve(sv, { who: 'Jo', seconds: 400, day: '2026-10-24', note: '' }), /Mia/);
  assert.equal(P.readKind('Potato'), null);
  assert.equal(P.readKind('Word search'), 'wordsearch');
  const item = P.readItem({ path: 'I.md', title: 'I', props: { kind: 'Potato' }, content: '# I\n\nWords.\n' });
  assert.equal(item.kind, 'Potato');
  assert.deepEqual(P.readSchedule('7'), { days: [], time: '07:00' });
  assert.deepEqual(P.readSchedule('Mon, Fri 07:00')?.days, [1, 5]);
});

test('9.5 batch 12: no dead code, no canned filler, the template read from the note (F149)', () => {
  const P = S.publications;
  assert.ok(!/it\.kind === 'image' && it\.body \? '' : ''/.test(readFileSync(path.join(root, 'src/shared/edition-doc.ts'), 'utf8')), 'the dead ternary is gone');
  assert.ok(!P.newPublicationText({ title: 'G' }).includes('A publication kept in Ironleaf'), 'no canned filler');
  const plan = P.planImport({ path: 'G.md', title: 'Gazette', props: {}, content: '# Gazette\n\nA tabloid, out weekly.\n' }, [], '2026-10-24');
  assert.equal(plan.template, 'Tabloid');
  assert.deepEqual(P.importProps({ ...plan, schedule: null, printer: '', telegram: false, sections: [], style: {}, editions: [], read: [], path: 'G.md', title: 'G', masthead: 'G' }, {}).template, 'Tabloid');
  const nohint = P.planImport({ path: 'G.md', title: 'Gazette', props: {}, content: '# Gazette\n\nOut weekly.\n' }, [], '2026-10-24');
  assert.equal(nohint.template, undefined);
});

test('9.5 batch 12: a broken piece mark is said, not swallowed; day words read cleanly twice (F150, F151)', () => {
  const P = S.publications;
  const ed = '# E\n\n## News\n\n### Bad piece\n<!--nv:piece {oops-->\n\nWords here.\n';
  const items = P.readEditionPieces({ path: 'E.md', title: 'E', props: {}, content: ed }, [{ name: 'News', items: ['E.md#bad-piece'] }]);
  assert.equal(items.length, 1);
  assert.match(items[0].body, /Words here/);
  assert.ok(items[0].problems.length > 0, 'the bad mark is said');
  assert.deepEqual(P.readSchedule('Mon 07:00')?.days, [1]);
  assert.deepEqual(P.readSchedule('Fri 18:00')?.days, [5]);
  const plan = P.planImport({ path: 'G.md', title: 'G', props: {}, content: 'Out Monday and Friday 07:00.\n' }, [], '2026-10-24');
  assert.ok(plan.schedule && plan.schedule.days.length === 2);
  assert.deepEqual(P.readSchedule('Tue 07:00')?.days, [2], 'no shared lastIndex');
});

test('9.5 batch 12: one source of sections; pipes and bullets read the same everywhere; wider signals; bad dates never throw (F152, F153, F154, F155)', () => {
  const P = S.publications;
  const D = S.editionDoc;
  for (const s of P.DEFAULT_SECTIONS) assert.ok(S.publicationModule.PUBLICATION_MODULE.template.includes(`| ${s.name} |`), `the template starts with ${s.name}`);
  const sig = S.publicationModule.PUBLICATION_SIGNALS;
  for (const w of ['a new puzzle', 'the daily word', 'issue 3', 'read the paper', 'a crossword']) assert.ok(sig.test(w), `signals hear "${w}"`);
  for (const w of ['a paper cut', 'an issue with the till']) assert.ok(!sig.test(w), `signals ignore "${w}"`);
  const t = D.mdHtml('| A | B\n| --- | ---\n| 1 | 2\n', () => '');
  assert.match(t, /<table>/, 'a table without closing pipes renders as a table');
  const caps = D.editionDocument({ pub: { title: 'T', masthead: 'M', motto: '', style: { mastheadFont: '', headFont: '', bodyFont: '', bodyFaces: [], crest: '', ink: '#1a1a1a', greyscale: false, justify: false } }, number: 1, date: '2026-10-26', template: P.templateOf('classic'), sections: [{ name: 'Fun', pages: 1, items: [{ path: 'p', title: 't', kind: 'cartoon', publication: '', section: 'Fun', headline: 'C', deck: '', source: '', sourceUrl: '', credit: '', who: '', image: '', lead: false, date: null, body: '• First\n• Second\n', puzzle: null, solves: [] }] }], answers: null, url: () => '', mode: 'print' });
  assert.match(caps, /panels/, '• bullets are panels');
  const bad = D.editionDocument({ pub: { title: 'T', masthead: 'M', motto: '', style: { mastheadFont: '', headFont: '', bodyFont: '', bodyFaces: [], crest: '', ink: '#1a1a1a', greyscale: false, justify: false } }, number: 1, date: 'someday', template: P.templateOf('classic'), sections: [], answers: null, url: () => '', mode: 'print' });
  assert.match(bad, /—/, 'a bad date degrades, never throws');
});

test('9.5 batch 13: a scheduled send that misses says so: no “went out”, the log honest (F133)', async () => {
  const area = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) };
  const now = new Date(2026, 9, 24, 8, 3);
  const make = async () => {
    const v = vault(area);
    const posted = [];
    const { p } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), now: () => now });
    const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
    return { v, p, posted, pub };
  };
  const fill = async (p, pub) => {
    const e = await p.newEdition(pub, { date: '2026-10-24' });
    const s1 = await p.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
    await p.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
    return e;
  };
  // Every way missed (sending needs the former host app): not done, and the bell says it missed.
  {
    const { v, p, posted, pub } = await make();
    await p.setPublication(pub, { telegram: true });
    const e = await fill(p, pub);
    assert.equal(await p.tick(now), 0, 'nothing went out');
    const note = readFileSync(path.join(v.dir, e), 'utf8');
    assert.match(note, /\| Scheduled \| Sat 08:00 \| Not sent \|/, 'the schedule row says it missed');
    assert.match(posted.at(-1).title, /didn’t go out/);
    assert.doesNotMatch(posted.map((x) => x.title).join('\n'), /went out/);
  }
  // One way out, one missed: partly, said as partly.
  {
    const v = vault(area);
    const posted = [];
    const { p } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (r) => (r.channel === 'telegram' ? { ok: true, words: 'Sent' } : { ok: false, words: 'mailbox full' }), now: () => now });
    const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
    await p.setPublication(pub, { telegram: true, email: 'sam@example.com' });
    const e = await fill(p, pub);
    assert.equal(await p.tick(now), 1, 'the schedule fired and settled');
    const note = readFileSync(path.join(v.dir, e), 'utf8');
    assert.match(note, /\| Scheduled \| Sat 08:00 \| Partially sent \|/);
    assert.match(posted.at(-1).title, /partly went out/);
    assert.match(posted.at(-1).body, /mailbox full/);
  }
});

test('9.5 batch 13: a day with no edition yet still goes out once the edition is made (F135)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const posted = [];
  const got = [];
  const now = new Date(2026, 9, 24, 8, 3);
  const { p } = service(v, () => ({ publications: { on: true } }), { post: (items) => (posted.push(...items), items.length), deliver: async (r) => (got.push(r), { ok: true, words: 'Sent' }), now: () => now });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(pub, { telegram: true });
  assert.equal(await p.tick(now), 0);
  assert.match(posted[0].title, /No edition of The Harbour Gazette for today/);
  assert.equal(await p.tick(now), 0);
  assert.equal(posted.length, 1, 'said once');
  const e = await p.newEdition(pub, { date: '2026-10-24' });
  const s1 = await p.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
  await p.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
  assert.equal(await p.tick(now), 1, 'the same day’s edition goes out once made');
  assert.equal(got.length, 1);
  assert.equal(await p.tick(now), 0, 'once a day');
});

test('9.5 batch 13: building again after delivery starts it over at Built (F136)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }), { deliver: async () => ({ ok: true, words: 'Sent' }) });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(pub, { telegram: true, print: true, printer: 'Lab' });
  const e = await p.newEdition(pub, { date: '2026-10-24' });
  const s1 = await p.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
  await p.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
  await p.deliver(e, ['telegram']);
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /\nstatus: Delivered\n/);
  await p.build(e);
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /\nstatus: Built\n/, 'a rebuild after delivery is Built, never silently Delivered');
  await p.deliver(e, ['print']);
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /\nstatus: Printed\n/);
  await p.build(e);
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /\nstatus: Built\n/, 'and after printing too');
});

test('9.5 batch 13: an edition named by its number is that edition, never the latest by accident (F134)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  const e1 = await p.newEdition(pub, { date: '2026-10-20' });
  const e2 = await p.newEdition(pub, { date: '2026-10-21' });
  await p.addItem(pub, { kind: 'story', headline: 'First morning', section: 'News', body: 'One.', source: 'Harbour Post' }, 'you', undefined, e1);
  await p.addItem(pub, { kind: 'story', headline: 'Second morning', section: 'News', body: 'Two.', source: 'Harbour Post' }, 'you', undefined, e2);
  const one = await p.callTool('publication_edition', { number: '#1' }, null);
  assert.match(one.text, /First morning/, '“#1” is No. 1, not the latest');
  assert.doesNotMatch(one.text, /Second morning/);
  const named = await p.callTool('publication_edition', { number: 'No 2' }, null);
  assert.match(named.text, /Second morning/);
  assert.match((await p.callTool('publication_edition', { number: 'No 13' }, null)).text, /no No\. 13/i, 'a missing written number is said, never the latest');
  assert.match((await p.callTool('publication_edition', { number: 9 }, null)).text, /no No\. 9/i, 'a missing number is said');
});

test('9.5 batch 13: setting up a name a typo away finds the publication instead of doubling it (F156)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  await p.createPublication({ title: 'Weekend Post', schedule: 'Sat 08:00' });
  const r = await p.callTool('publication_setup', { publication: 'Weeknd Post' }, null);
  assert.match(r.text, /Weekend Post is set up/, 'the typo finds the paper');
  assert.equal((await p.state()).publications.length, 1, 'no second paper made');
  await p.createPublication({ title: 'Harbour Gazette', schedule: 'Sat 08:00' });
  await p.createPublication({ title: 'Harbour Gazetta', schedule: 'Sat 08:00' });
  assert.match((await p.callTool('publication_setup', { publication: 'Harbour Gazete' }, null)).text, /Did you mean/, 'two close papers are asked about, never guessed');
  assert.equal((await p.state()).publications.length, 3, 'and no third paper made for the guess');
});

test('9.5 batch 13: every path says the ways of sending the same way; an unknown way is said, never silent (F144)', async () => {
  const P = S.publications;
  const pub = P.readPublication({ path: 'P.md', title: 'P', props: { type: 'publication', masthead: 'P', telegram: 'Yes', email: 'a@x.com', print: 'Yes', printer: 'Lab' }, content: '---\ntype: publication\n---\n# P\n' });
  assert.deepEqual(P.deliveryWays(pub).map((w) => w.id), ['telegram', 'email', 'print']);
  assert.deepEqual(P.deliveryWays(pub).map((w) => w.label), ['Telegram', 'email to a@x.com', 'printed on Lab']);
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }), { deliver: async () => ({ ok: true, words: 'Sent' }) });
  const rel = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(rel, { telegram: true, email: 'a@x.com', print: true, printer: 'Lab' });
  const e = await p.newEdition(rel, { date: '2026-10-24' });
  const s1 = await p.addItem(rel, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
  await p.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
  assert.match((await p.callTool('publication_next', {}, null)).text, /It goes out by Telegram, email to a@x\.com, printed on Lab\./);
  assert.match((await p.callTool('publication_list', {}, null)).text, /Telegram, email to a@x\.com, printed on Lab/);
  const words = await p.deliver(e, ['pigeon post']);
  assert.match(words, /Not sent/, 'an unknown way is said, never silent');
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /pigeon post[\s\S]{0,80}Not sent/);
  const capped = await p.deliver(e, ['Telegram']);
  assert.match(capped, /Telegram \(the chat\): Sent/, 'a way named any way round still goes');
});

test('9.5 batch 13: an edition’s notes patch is written where its Notes are, never doubled at the bottom (F142, F143)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setPublication(pub, { telegram: true });
  const e = await p.newEdition(pub, { date: '2026-10-24' });
  const s1 = await p.addItem(pub, { kind: 'story', headline: 'Path opens', section: 'News', body: 'The path opened.', source: 'Harbour Post' });
  await p.setEdition(e, { sections: [{ name: 'News', items: [s1.replace(/\.md$/, '')] }] });
  await p.setEdition(e, { notes: 'First.' });
  assert.match(readFileSync(path.join(v.dir, e), 'utf8'), /## Notes\n\nFirst\./, 'the notes patch is written');
  await p.deliver(e, ['telegram']);
  await p.setEdition(e, { notes: 'Second.' });
  const note = readFileSync(path.join(v.dir, e), 'utf8');
  assert.equal(note.match(/^## Notes$/gm).length, 1, 'one Notes section, not a second at the bottom');
  assert.ok(note.indexOf('## Notes') < note.indexOf('## Delivery'), 'kept where it was, beside the edition it describes');
  assert.match(note, /Second\./);
  assert.doesNotMatch(note, /First\./);
});

test('9.5 batch 13: orphans kept or said: a bare piece, a custom section, a second PDF, a non-picture file (F145)', async () => {
  const P = S.publications;
  const D = S.editionDoc;
  // A piece without its mark is kept and read, and survives a rewrite.
  const bare = '# G · No. 1 · 24 October 2026\n\n## News\n\n### Hand-added\n\nA few hand words.\n';
  const ed = P.readEdition({ path: 'E.md', title: 'E', props: { type: 'edition', number: 1 }, content: `---\ntype: edition\nnumber: 1\n---\n${bare}` });
  assert.deepEqual(ed.sections.find((s) => s.name === 'News').items, [P.pieceId('E.md', 'Hand-added')], 'a bare piece is listed');
  const pieces = P.readEditionPieces({ path: 'E.md', title: 'E', props: {}, content: bare });
  assert.equal(pieces.length, 1);
  assert.match(pieces[0].body, /hand words/);
  const again = P.withEditionSections(`---\ntype: edition\n---\n${bare}`, [{ name: 'News', items: [P.pieceId('E.md', 'Hand-added')] }], 'E.md');
  assert.match(again, /A few hand words/, 'and survives a rewrite');
  // A custom section heading with its pieces survives a whole-edition build.
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }), { deliver: async () => ({ ok: true, words: 'Sent' }) });
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  const e = await p.newEdition(pub, { date: '2026-10-24' });
  const block = P.pieceBlock({ kind: 'story', headline: 'Custom tale', section: 'My News', body: 'Custom words.', source: 'Harbour Post', date: '2026-10-24' });
  v.put(e, `${readFileSync(path.join(v.dir, e), 'utf8')}\n## My News\n\n${block.join('\n')}\n`);
  await p.callTool('publication_edition_build', { date: '2026-10-24', items: [{ kind: 'story', section: 'News', headline: 'Path opens', body: 'The path opened.', source: 'Harbour Post' }] }, null);
  const rebuilt = readFileSync(path.join(v.dir, e), 'utf8');
  assert.match(rebuilt, /^## My News$/m, 'the custom section keeps its heading');
  assert.match(rebuilt, /Custom words/, 'and its piece keeps its words');
  // A second PDF on an import line is said, not silently dropped.
  const plan = P.planImport({ path: 'G.md', title: 'G', props: {}, content: '---\ntype: publication\n---\n# G\n\nNo. 4 · 12 Oct · [[a.pdf]] [[b.pdf]] · Lead: Big day.\n' }, [], '2026-10-24');
  assert.equal(plan.editions.length, 1);
  assert.ok(plan.read.some((l) => l.includes('b.pdf')), `the second PDF is said: ${JSON.stringify(plan.read)}`);
  // A non-picture file is linked, never a broken picture.
  assert.doesNotMatch(D.mdHtml('See ![[Files/doc.pdf]] here.', () => 'u'), /<img/);
  assert.match(D.mdHtml('See ![[Files/doc.pdf]] here.', () => 'u'), /<a /);
  const doc = D.editionDocument({ pub: { title: 'T', masthead: 'M', motto: '', style: { mastheadFont: '', headFont: '', bodyFont: '', bodyFaces: [], crest: '', ink: '#1a1a1a', greyscale: false, justify: false } }, number: 1, date: '2026-10-26', template: P.templateOf('classic'), sections: [{ name: 'News', pages: 1, items: [{ path: 'p', title: 't', kind: 'story', publication: '', section: 'News', headline: 'H', deck: '', source: '', sourceUrl: '', credit: '', who: '', image: 'Files/doc.pdf', lead: true, date: null, body: 'Words.', puzzle: null, solves: [] }] }], answers: null, url: (r) => `file:///${r}`, mode: 'print' });
  assert.doesNotMatch(doc, /<img[^>]*doc\.pdf/);
  assert.match(doc, /<a[^>]*doc\.pdf/, 'a piece file is linked where a picture would go');
});

test('9.5 batch 13: puzzles go to the paper’s puzzle section by any of its names (F141)', async () => {
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  await p.setSections(pub, [{ name: 'Front', pages: 1 }, { name: 'Crossword', pages: 1 }, { name: 'Sport', pages: 1 }]);
  const made = p.makePuzzle({ kind: 'sudoku', seed: 3 });
  const rel = await p.savePuzzle(pub, { puzzle: made.puzzle, title: 'Saturday sudoku' });
  const items = (await p.state(pub)).current.items;
  assert.equal(items.find((i) => i.path === rel).section, 'Crossword', 'the imported paper’s Crossword section takes it, not the last one');
});

test('9.5 batch 13: a house crest must be a real picture file, never a link, missing or other bytes (F139)', async () => {
  const P = S.publications;
  assert.equal(P.sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(P.sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(P.sniffImage(new Uint8Array([0x49, 0x49, 0x2a, 0x00])), 'tiff');
  assert.equal(P.sniffImage(new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), 'heic');
  assert.equal(P.sniffImage(new Uint8Array([0x3c, 0x73, 0x76, 0x67])), 'svg');
  assert.equal(P.sniffImage(new Uint8Array([0x41, 0x42, 0x43])), null);
  const v = vault({ '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'publications', name: 'Publications', folder: 'Publications' }] }) });
  const { p } = service(v, () => ({ publications: { on: true } }));
  const pub = await p.createPublication({ title: 'The Harbour Gazette', schedule: 'Sat 08:00' });
  mkdirSync(path.join(v.dir, 'Pictures'), { recursive: true });
  writeFileSync(path.join(v.dir, 'Pictures', 'crest.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await p.setPublication(pub, { crest: 'Pictures/crest.png' });
  assert.match(readFileSync(path.join(v.dir, pub), 'utf8'), /\[\[Pictures\/crest\.png\]\]/, 'a real picture is kept');
  await assert.rejects(p.setPublication(pub, { crest: 'https://example.com/crest.png' }), /not a link/, 'a link crest is refused, never silently broken');
  await assert.rejects(p.setPublication(pub, { crest: 'Pictures/missing.png' }), /can’t be found/, 'a missing crest is said');
  writeFileSync(path.join(v.dir, 'Pictures', 'notes.png'), 'just words');
  await assert.rejects(p.setPublication(pub, { crest: 'Pictures/notes.png' }), /isn’t a picture/, 'bytes are checked, not the name');
  writeFileSync(path.join(v.dir, 'Pictures', 'scan.tif'), Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x01, 0x02]));
  await assert.rejects(p.setPublication(pub, { crest: 'Pictures/scan.tif' }), /TIF/, 'a format that doesn’t print says how to fix it');
});
