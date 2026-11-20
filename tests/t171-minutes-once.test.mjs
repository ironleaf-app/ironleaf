// node --test tests/t171-minutes-once.test.mjs — minutes made twice (t171 break-it third,
// 9 Nov 2026: two doors mount the same card — the note and the Meetings page — and Make
// pressed twice before the re-render ran the ask twice, applying two minutes). The guard
// reads the shared run map itself, synchronously, not only the React busy flag.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/renderer/src/views/MeetingMinutes.tsx'), 'utf8');

test('Make guards on the shared run map, not only the React flag', () => {
  const at = src.indexOf('const make = async ()');
  assert.ok(at > 0, 'Make is there');
  const guard = src.slice(at, at + 400);
  assert.ok(
    guard.includes("minuteRuns.get(path)?.phase === 'working'"),
    'a second Make while one runs returns (the map, read synchronously)',
  );
});
