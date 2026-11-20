// node --test tests/note-context.test.mjs — the foot of a note (src/shared/note-context.ts): a line of another note cut to
// a snippet with the link (or the name, where it isn't linked) marked, Markdown marks left out; the notes most like this
// one by the tags, properties and links they share, rarest first; and the foot's search.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-note-context-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/note-context.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const marks = (s) => s.ranges.map(([a, b]) => s.text.slice(a, b));

test('a link to this note reads as its words and is marked; other links read plainly', () => {
  const s = C.snippetOf('- [ ] Ring **Dana** about [[Clients/Acme Pty|Acme]] and [[Budget]]', ['Acme Pty']);
  assert.equal(s.text, 'Ring Dana about Acme and Budget');
  assert.deepEqual(marks(s), ['Acme']);
  assert.equal(s.cutStart, false);
  assert.equal(s.cutEnd, false);
});

test('a Markdown link to this note is marked too, by its file name', () => {
  const s = C.snippetOf('See [the plan](Projects/Roof%20Plan.md#Costs) first.', ['Roof Plan']);
  assert.equal(s.text, 'See the plan first.');
  assert.deepEqual(marks(s), ['the plan']);
});

test('a mention without a link: the name itself is marked, as whole words only, in any case', () => {
  const s = C.snippetOf('Spoke to acme pty today; Acme Pty Ltd later. Not acmepty.', ['Acme Pty']);
  assert.deepEqual(marks(s), ['acme pty', 'Acme Pty']);
});

test('an alias counts as the note’s name', () => {
  const s = C.snippetOf('Met [[ACME]] again', ['Acme Pty', 'ACME']);
  assert.deepEqual(marks(s), ['ACME']);
});

test('a long line is cut round the first mark, on word breaks, with the marks moved to match', () => {
  const before = 'word '.repeat(60);
  const after = ' more'.repeat(60);
  const s = C.snippetOf(`${before}links to [[Roof Plan]] here${after}`, ['Roof Plan'], 80);
  assert.ok(s.text.length <= 80, `${s.text.length}`);
  assert.equal(s.cutStart, true);
  assert.equal(s.cutEnd, true);
  assert.deepEqual(marks(s), ['Roof Plan']);
  assert.ok(!s.text.startsWith(' ') && !s.text.endsWith(' '));
});

const note = (p, o = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), tags: [], props: {}, links: [], ...o });
const resolver = (notes) => (target) => notes.find((n) => n.title.toLowerCase() === target.toLowerCase() || n.path.toLowerCase() === `${target.toLowerCase()}.md`)?.path ?? null;

test('related notes: shared rare things outrank shared common ones, and notes sharing nothing are left out', () => {
  const notes = [
    note('A.md', { tags: ['roofing', 'work'], props: { status: 'Active', client: '[[Acme]]' } }),
    note('B.md', { tags: ['work'] }),
    note('C.md', { tags: ['roofing'] }),
    note('D.md', { tags: ['work'], props: { status: 'active' } }),
    note('E.md', { links: [{ target: 'Acme' }] }),
    note('F.md', { tags: ['work'] }),
    note('G.md'),
    note('Acme.md'),
  ];
  const got = C.relatedNotes('A.md', notes, resolver(notes));
  const order = got.map((r) => r.path);
  assert.ok(!order.includes('G.md'), 'G shares nothing');
  assert.ok(!order.includes('A.md'), 'never itself');
  // #roofing is on two notes, #work on five: C (roofing) beats B (work).
  assert.ok(order.indexOf('C.md') < order.indexOf('B.md'), order.join(','));
  // D shares #work and status: Active (case doesn't matter), so it beats B and F.
  assert.ok(order.indexOf('D.md') < order.indexOf('B.md'));
  const d = got.find((r) => r.path === 'D.md');
  assert.deepEqual(d.tags, ['work']);
  assert.deepEqual(d.props, ['status: Active']);
  // A property naming a note is a link: E links to Acme too.
  const e = got.find((r) => r.path === 'E.md');
  assert.deepEqual(e.links, ['Acme']);
  // Acme itself: A links to it (through the property) but shares nothing else with it, so it isn't "related".
  assert.ok(!order.includes('Acme.md'));
});

test('related notes: dates, numbers and plain keys (created, tags, aliases) are never something shared', () => {
  const notes = [note('A.md', { props: { created: '2026-10-19', due: '2026-11-01', rating: '5', aliases: ['X'] } }), note('B.md', { props: { created: '2026-10-19', due: '2026-11-01', rating: '5', aliases: ['X'] } })];
  assert.deepEqual(C.relatedNotes('A.md', notes, resolver(notes)), []);
});

test('related notes: skipped notes (private, left out of suggestions) never show, and a note one links to gets a nudge', () => {
  const notes = [note('A.md', { tags: ['x'], links: [{ target: 'B' }] }), note('B.md', { tags: ['x'] }), note('C.md', { tags: ['x'] }), note('Private notes/P.md', { tags: ['x'] })];
  const got = C.relatedNotes('A.md', notes, resolver(notes), { skip: (p) => p.startsWith('Private notes/') });
  assert.deepEqual(got.map((r) => r.path), ['B.md', 'C.md']);
  assert.equal(got[0].linked, true);
  assert.ok(got[0].score > got[1].score);
  assert.deepEqual(C.relatedNotes('Missing.md', notes, resolver(notes)), []);
});

test('the foot’s search: every word typed, anywhere in the name, folder or snippet', () => {
  assert.equal(C.matchesQuery('', 'anything'), true);
  assert.equal(C.matchesQuery('roof acme', 'Roof Plan', 'Clients/Acme'), true);
  assert.equal(C.matchesQuery('roof dana', 'Roof Plan', 'Clients/Acme'), false);
});
