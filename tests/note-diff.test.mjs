// node --test tests/note-diff.test.mjs — what changed between two versions of a note (src/shared/note-diff.ts; 19 Oct
// 2026, 5.0.0: "AI edits you approve" and earlier versions that credit each edit). The assistant's change split into the
// smallest pieces (a word changed reads as that word, an append as the lines added), every piece put back makes exactly
// its version, pieces follow the person's typing (moved when it is elsewhere, out of date when it is over them), changes
// from a sync placed by their lines, and the earlier versions' line-by-line view and its "+3 −1". Who made a version, in
// words. Made-up bakery notes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-note-diff-'));
let D, V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as D from ${JSON.stringify(path.join(root, 'src/shared/note-diff.ts'))};\nexport * as V from ${JSON.stringify(path.join(root, 'src/shared/versions.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'diff.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ D, V } = await import(pathToFileURL(path.join(work, 'diff.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOTE = '---\nstatus: planning\n---\n# Sourdough starter\n\nFeed the starter twice a day.\nKeep it at room temperature.\n\n## Flour\n- Rye for the first week\n- Then strong white\n';

test('a word changed is that word, not its line', () => {
  const after = NOTE.replace('twice a day', 'three times a day');
  const h = D.hunks(NOTE, after);
  assert.equal(h.length, 1);
  assert.equal(h[0].old, 'twice');
  assert.equal(h[0].insert, 'three times');
  assert.equal(NOTE.slice(h[0].from, h[0].to), 'twice');
  assert.equal(D.hunkLook(h[0]), 'inline');
  assert.equal(D.applyHunks(NOTE, h), after);
});

test('half a word changed reads as the whole word', () => {
  const after = NOTE.replace('temperature', 'temperatures');
  const [h] = D.hunks(NOTE, after);
  assert.equal(h.old, 'temperature.');
  assert.equal(h.insert, 'temperatures.');
});

test('an append is the lines added, at the end, and nothing struck through', () => {
  const after = `${NOTE}\n## Next\n- Bake the first loaf\n`;
  const h = D.hunks(NOTE, after);
  assert.equal(h.length, 1);
  assert.equal(h[0].old, '');
  assert.equal(h[0].from, NOTE.length);
  assert.equal(D.hunkLook(h[0]), 'lines');
  assert.equal(D.applyHunks(NOTE, h), after);
  // A note without a last line break: the line it ends with is not taken out and put back.
  const bare = 'Feed the starter.';
  const [b] = D.hunks(bare, `${bare}\n\nThen bake.\n`);
  assert.equal(b.old, '');
  assert.equal(b.from, bare.length);
});

test('separate changes are separate pieces, and every piece kept makes the version asked for', () => {
  const after = NOTE.replace('status: planning', 'status: active').replace('twice a day', 'every morning').replace('- Then strong white\n', '- Then strong white\n- Spelt on Sundays\n');
  const h = D.hunks(NOTE, after);
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((x) => x.old), ['planning', 'twice a day.', '']);
  assert.equal(D.applyHunks(NOTE, h), after);
  // Only some kept: the others leave their words as they were.
  assert.equal(D.applyHunks(NOTE, [h[0]]), NOTE.replace('status: planning', 'status: active'));
});

test('kept pieces make their version exactly, across many made-up edits', () => {
  const words = ['flour', 'water', 'salt', 'starter', 'loaf', 'oven', '\n', '\n', '- ', '# '];
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const make = (n) => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');
  for (let i = 0; i < 300; i++) {
    const a = make(rnd(40));
    let b = a;
    for (let k = rnd(4); k >= 0; k--) {
      const at = rnd(b.length + 1);
      b = b.slice(0, at) + (rnd(2) ? make(rnd(6)) : '') + b.slice(at + rnd(12));
    }
    assert.equal(D.applyHunks(a, D.hunks(a, b)), b, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

test('typing elsewhere moves a piece along; typing over it puts it out of date', () => {
  const after = NOTE.replace('Rye for the first week', 'Rye for the first fortnight');
  const [h] = D.hunks(NOTE, after);
  // Typing above it: it moves by what was typed.
  const typedAbove = D.mapHunks([h], { from: 3, to: 3, insert: 'xx' });
  assert.equal(typedAbove[0].from, h.from + 2);
  assert.ok(!typedAbove[0].stale);
  // Typing below it: it stays.
  assert.equal(D.mapHunks([h], { from: NOTE.length, to: NOTE.length, insert: 'more' })[0].from, h.from);
  // Typing over its words: out of date, kept as a point where the typing began.
  const over = D.mapHunks([h], { from: h.from + 1, to: h.from + 2, insert: 'E' })[0];
  assert.equal(over.stale, true);
  assert.equal(over.from, over.to);
  // Out of date: never put in.
  assert.equal(D.applyHunks(NOTE, [over]), NOTE);
});

test('a note changed in many places (a sync) keeps the pieces whose lines are still there', () => {
  const after = NOTE.replace('Feed the starter twice a day.', 'Feed the starter every morning.').replace('- Then strong white', '- Then a strong white');
  const [feed, flour] = D.hunks(NOTE, after);
  // Someone else added a line at the top and rewrote the flour line.
  const synced = NOTE.replace('# Sourdough starter\n', '# Sourdough starter\nFrom Mia.\n').replace('- Then strong white', '- Then wholemeal');
  const [f2, fl2] = D.rebaseHunks([feed, flour], NOTE, synced);
  assert.ok(!f2.stale);
  assert.equal(synced.slice(f2.from, f2.to), feed.old);
  assert.equal(fl2.stale, true);
  // Placed straight from the versions: the person's own typing stays, the suggestion goes in around it.
  const placed = D.placeHunks(NOTE, after, synced);
  assert.equal(D.applyHunks(synced, placed), synced.replace('twice a day', 'every morning'));
});

test('word by word inside a line, or whole when mostly rewritten', () => {
  assert.deepEqual(D.wordParts('Feed it twice a day', 'Feed it three times a day'), [
    { kind: 'same', text: 'Feed it ' },
    { kind: 'del', text: 'twice' },
    { kind: 'add', text: 'three times' },
    { kind: 'same', text: ' a day' },
  ]);
  assert.deepEqual(D.wordParts('Rye flour', 'Completely new words here'), [
    { kind: 'del', text: 'Rye flour' },
    { kind: 'add', text: 'Completely new words here' },
  ]);
  assert.deepEqual(D.wordParts('', 'new'), [{ kind: 'add', text: 'new' }]);
});

test('the earlier versions view: lines out and in, the rest folded, and the counts', () => {
  const a = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n';
  const b = a.replace('Line 10\n', 'Line ten\n').replace('Line 20\n', 'Line 20\nLine 21\n');
  const rows = D.changeRows(a, b, 1);
  assert.deepEqual(rows[0], { kind: 'gap', count: 8 });
  assert.deepEqual(rows.slice(1, 5), [
    { kind: 'same', text: 'Line 9' },
    { kind: 'del', text: 'Line 10' },
    { kind: 'add', text: 'Line ten' },
    { kind: 'same', text: 'Line 11' },
  ]);
  assert.deepEqual(rows.at(-1), { kind: 'add', text: 'Line 21' });
  assert.deepEqual(D.changeCounts(a, b), { added: 2, removed: 1 });
  assert.ok(!D.changeRows(a, a).some((r) => r.kind === 'add' || r.kind === 'del'));
});

test('who made a version, in words; anything unknown is an earlier edit', () => {
  assert.equal(V.authorWords('you'), 'You');
  assert.equal(V.authorWords('assistant'), 'Ironleaf’s assistant');
  assert.equal(V.authorWords('neuralspark'), 'Another app');
  assert.equal(V.authorWords('sync:OneDrive'), 'Sync (OneDrive)');
  assert.equal(V.authorWords('sync:OneDrive – Contoso'), 'Sync (OneDrive – Contoso)');
  assert.equal(V.authorWords('agent:Research agent'), 'Research agent');
  assert.equal(V.authorWords('outside'), 'Changed outside Ironleaf');
  assert.equal(V.authorWords(undefined), 'Earlier edit');
  assert.equal(V.authorWords('<script>'), 'Earlier edit');
  assert.equal(V.cleanAuthor('agent:<b>x</b>'), undefined);
});
