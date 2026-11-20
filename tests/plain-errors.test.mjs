// node --test tests/plain-errors.test.mjs — raw errors never reach the person (p16 loose ends): dictation
// events reaching toast(), calendar sync words, record, file and saved-view failures and module EmptyState
// lines all read through the plain-error words (src/renderer/src/lib/errors.ts errorMessage), each at its own
// mechanism. The grep below fails on any toast(err.message) style call: every remaining `.message` read in
// the window must be one of the justified ones beside it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src/renderer/src');

function files(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === 'assets') continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const bare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.split('//')[0]);

// Every `.message` read left in the window, each justified where it stands: the cleaner itself, a byte
// offset parsed to resume an upload, detail for the console or a support message (the window shows fixed
// words), a regex test choosing fixed words, and dialog props (not errors at all).
const JUSTIFIED = [
  { file: 'lib/errors.ts', keep: /const raw = err instanceof Error/, why: 'the cleaner itself reads the raw message' },
  { file: 'state/vaultFiles.ts', keep: /starts at byte/, why: 'parses the byte offset to resume an upload; never shown' },
  { file: 'lib/hydrate.ts', keep: /\.message\.split/, why: 'detail for the console; the page shows fixed words' },
  { file: 'lib/charts.ts', keep: /drawChart\(source\)\.catch/, why: 'detail for the console; the page shows fixed words' },
  { file: 'views/modules/personal/CareerPage.tsx', keep: /console\.warn/, why: 'console.warn only' },
  { file: 'views/pdf/PdfView.tsx', keep: /const why = String\(\(err as \{ message\?: unknown \}/, why: 'read once, only to choose fixed plain words (t250: missing/empty/non-PDF; f10 rule 19: never shown itself)' },
  { file: 'components/ErrorBoundary.tsx', keep: /error\?\.message \|\| String\(error\)|caught\?\.message/, why: 'the support log and Copy details; the window shows fixed words' },
  // 5 Nov 2026 feel-motion: the render reads the held dialog (`show`, fading or live), not the live one.
  { file: 'components/Dialogs.tsx', keep: /(options|ask|show)\.message/, why: 'dialog props, not errors' },
];

test('no toast(err.message) style call: every .message read left is a justified one', () => {
  const bad = [];
  for (const f of files(src)) {
    const rel = path.relative(src, f).replace(/\\/g, '/');
    bare(readFileSync(f, 'utf8')).forEach((line, i) => {
      if (!/\.message\b/.test(line)) return;
      if (JUSTIFIED.some((j) => j.file === rel && j.keep.test(line))) return;
      bad.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  // Each justification must still hold its read, so the list cannot rot silently.
  for (const j of JUSTIFIED) {
    const text = readFileSync(path.join(src, j.file), 'utf8');
    assert.ok(j.keep.test(text), `${j.file} still holds its justified read (${j.why})`);
  }
  assert.deepEqual(bad, [], `raw .message reaching the window:\n${bad.join('\n')}`);
});

test('each loose end reads through the plain-error words', () => {
  const read = (f) => readFileSync(path.join(root, f), 'utf8');
  for (const [file, want, why] of [
    ['src/renderer/src/lib/dictation.ts', `kind === 'error' && words ? errorMessage(words) : words`, 'dictation error events'],
    ['src/renderer/src/state/recordModules.ts', 'setError(errorMessage(e))', 'record failures'],
    ['src/renderer/src/state/projectWorkspace.ts', 'setError(errorMessage(e))', 'workspace record failures'],
    ['src/renderer/src/views/RecordsView.tsx', 'setError(errorMessage(e))', 'records view failures'],
    ['src/renderer/src/views/ProjectPage.tsx', 'setError(errorMessage(e))', 'project page failures'],
    ['src/renderer/src/components/FileCard.tsx', 'setProblem(errorMessage(e))', 'file card failures'],
    ['src/renderer/src/components/FilesMove.tsx', 'setProblem(errorMessage(e))', 'file move failures'],
    ['src/renderer/src/views/SavedView.tsx', 'setFailed(errorMessage(err))', 'saved view failures'],
    ['src/renderer/src/views/saved/FormDialog.tsx', 'setFailed(errorMessage(err))', 'view form failures'],
    ['src/renderer/src/views/saved/ViewEmbed.tsx', 'setFailed(errorMessage(err))', 'embedded view failures'],
    ['src/renderer/src/views/modules/FamilyPage.tsx', 'setFailed(errorMessage(err))', 'Family EmptyState'],
    ['src/renderer/src/views/modules/publications/Studio.tsx', 'setFailed(errorMessage(err))', 'studio EmptyState'],
    ['src/renderer/src/views/modules/publications/usePub.ts', 'setFailed(errorMessage(err))', 'publications EmptyState'],
    ['src/renderer/src/capture/CaptureBox.tsx', 'errorMessage(err)', 'capture undo words'],
    ['src/renderer/src/state/docs.ts', 'doc.error = errorMessage(err)', 'file save failures'],
  ]) assert.ok(read(file).includes(want), `${why} read through errorMessage (${file})`);
});
