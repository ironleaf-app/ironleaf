// node --test tests/sweep3.test.mjs — sweep 3's pure readings (29 Oct 2026): a meeting time read one way
// (and no time as nothing), Timeline labels that never collide, chart shares that add to 100, a Graph
// health that is never "On track" past its due day, and a Notes snippet with no words showing as nothing.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-sweep3-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { meetingTimeWords } from ${JSON.stringify(path.join(root, 'src/shared/work-meetings.ts'))};`,
      `export { labelIds } from ${JSON.stringify(path.join(root, 'src/shared/timeline.ts'))};`,
      `export { sharePercents } from ${JSON.stringify(path.join(root, 'src/shared/record-views.ts'))};`,
      `export { healthWord } from ${JSON.stringify(path.join(root, 'src/shared/graph-layout.ts'))};`,
      `export { snippetForDisplay } from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'sweep3.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'sweep3.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a meeting time reads one way, and no time reads as nothing (015)', () => {
  assert.equal(M.meetingTimeWords('10:00'), '10:00 am');
  assert.equal(M.meetingTimeWords('10:00 AM'), '10:00 am');
  assert.equal(M.meetingTimeWords('22:00'), '10:00 pm');
  assert.equal(M.meetingTimeWords('1:30 PM'), '1:30 pm');
  assert.equal(M.meetingTimeWords('12:00 AM'), '');
  assert.equal(M.meetingTimeWords('00:00'), '');
  assert.equal(M.meetingTimeWords(''), '');
  assert.equal(M.meetingTimeWords(null), '');
  assert.equal(M.meetingTimeWords('after standup'), 'after standup');
});

test('Timeline labels never collide across lanes (062)', () => {
  const items = [
    { id: 'a', x: 0, lane: 0, words: 'Stock count 13:10: 1,017 of 1,200 bricks', room: 180 },
    { id: 'b', x: 30, lane: 1, words: 'Second label close by', room: 180 },
    { id: 'c', x: 400, lane: 0, words: 'Far away', room: 180 },
    { id: 'd', x: 410, lane: 2, words: 'Two lanes clear', room: 180 },
  ];
  const kept = M.labelIds(items);
  assert.ok(kept.has('a'));
  assert.ok(!kept.has('b'), 'a label in the next lane under a kept one is held back');
  assert.ok(kept.has('c'));
  assert.ok(kept.has('d'), 'two lanes apart may both show');
  assert.equal(M.labelIds([{ id: 'x', x: 0, lane: 0, words: 'Tiny', room: 20 }]).size, 0, 'no room, no label');
});

test('chart shares add to 100 (043)', () => {
  const shares = M.sharePercents([452.63, 154.85, 86.35]);
  assert.equal(shares.reduce((n, v) => n + v, 0), 100);
  assert.deepEqual(M.sharePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(M.sharePercents([0, 0]), [0, 0]);
});

test('a project past its due day is never "On track" on the Graph (063)', () => {
  const today = Math.floor(Date.UTC(2026, 9, 29) / 86400000);
  assert.equal(M.healthWord('on track', '2026-10-27', today), 'Overdue', 'past due reads Overdue, like the Projects page (one standing, 8 Nov 2026)');
  assert.equal(M.healthWord('on track', '2026-11-02', today), 'On track');
  assert.equal(M.healthWord('at risk', '2026-11-02', today), 'At risk');
  assert.equal(M.healthWord('', '2026-10-27', today), 'Overdue');
});

test('a snippet with no words shows as nothing (028)', () => {
  assert.equal(M.snippetForDisplay('-'), '');
  assert.equal(M.snippetForDisplay(' — '), '');
  assert.equal(M.snippetForDisplay('Real words'), 'Real words');
});
