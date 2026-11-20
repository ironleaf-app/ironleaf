// node --test tests/move-keeps-going.test.mjs — a move or rename that happened is never reported as failed (20 Nov 2026
// audit): the file moved first, then each note linking to it was rewritten; a link write that threw (a note briefly
// locked on Windows, a read-only file) failed the whole call, so the window kept its tab on the old path while the
// file was already at the new one, and the next save found nothing there. Every step after the move now carries on
// on its own and logs what it could not do (src/main/app.ts movePath). movePath lives inside the app's closure, so
// its shape is checked here; the rename itself is exercised in tests/save-guard.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a move that happened is never reported as failed by a link it could not update (src/main/app.ts movePath)', () => {
  const src = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const move = src.slice(src.indexOf('async function movePath(from: unknown'), src.indexOf('async function linksInto('));
  const after = move.slice(move.indexOf('await v.move(src, dest);'));
  assert.match(after, /try \{\s+r = await v\.writeChecked\(sourcePath/, 'each link write is caught on its own');
  for (const step of ['recovery.renamed', 'projectHistory.renamed', 'suggestions.renamed', 'changeSets.renamed', 'refreshFiles(v)']) assert.match(after, new RegExp(`after\\('[^']+', \\(\\) => ${step.replace(/[.()]/g, '\\$&')}`), `${step} cannot fail the move`);
});
