// node --test tests/uplift-92-errors.test.mjs — the 9.2 uplift's no-silent-failure batch (F68, F69, F72,
// F76, F88–F91, F99–F102, F126, F128, F129): unknown targets speak and land on Home; Show me asks before
// opening a note and awaits its editor; failed reads are failed states with a retry, never empty words;
// batches apply in order, roll back, and undo in reverse. Each check guards the words or the mechanism
// its fix put in, so it fails without the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('show-me targets speak and waits are awaited, never slept or silent (F68, F69)', () => {
  const src = read('src/renderer/src/state/abilities.ts');
  assert.ok(src.includes('That place is not here any more. Home opens instead.'), 'unknown pages speak (F68)');
  assert.ok(src.includes('A.openHome()'), 'and land on Home (F68)');
  assert.ok(src.includes('awaitEditor()'), 'the editor is awaited (F69)');
  assert.ok(src.includes('Open today’s note?'), 'today’s note opens only with a yes (F69)');
  assert.doesNotMatch(src, /setTimeout\(\(\) => \{[^}]*\}, 700\)/, 'no fixed 700ms sleep (F69)');
});

test('failed reads are failed states with a retry, never empty words (F72)', () => {
  const ws = read('src/renderer/src/state/projectWorkspace.ts');
  assert.ok(ws.includes('failed, reload'), 'records carry failed plus reload');
  assert.ok(ws.includes('setFailedAll(true)'), 'a failed read marks failed');
  assert.doesNotMatch(ws, /\(\) => live && setAll\(\[\]\)/, 'never an empty list from an error');
  assert.ok(read('src/renderer/src/state/vaultFiles.ts').includes('failed: failed && items === null'), 'the catalogue fails honestly');
  const view = read('src/renderer/src/views/RecordsView.tsx');
  assert.ok(view.includes('The records could not be read.'), 'said in the page');
  assert.ok(view.includes('onClick={reload}'), 'with a retry');
});

test('batches apply in order, roll back, and undo in reverse (F76)', () => {
  const ws = read('src/renderer/src/state/projectWorkspace.ts');
  assert.ok(ws.includes('export async function runEditBatch'), 'one batch mechanism');
  assert.ok(ws.includes("Undid ${applied.length} of ${plural(opts.edits.length, 'change')}."), 'rollbacks are said (one plural rule, 10.0)');
  assert.ok(ws.includes('opts.edits.length > 1 ? `${opts.edits.length} changes.`'), 'one words for the batch');
  assert.doesNotMatch(ws, /Promise\.all\(edits\.map/, 'no concurrent unordered undos');
  assert.ok(ws.includes('edits.length - 1; i >= 0; i--'), 'undos walk back in reverse');
  const view = read('src/renderer/src/views/RecordsView.tsx');
  assert.ok(view.includes('runEditBatch({'), 'vault views batch through it');
  assert.doesNotMatch(view, /Promise\.all\(edits\.map/, 'no concurrent unordered undos there either');
});

test('reminders speak instead of staying silent (F88, F89)', () => {
  const r = read('src/renderer/src/editor/reminders.ts');
  assert.ok(r.includes('This line already reminds. Choose its pill to change it.'), 'already reminding is said (F88)');
  assert.ok(r.includes('Pick a day for the reminder first.'), 'a missing day is said (F89)');
  const c = read('src/renderer/src/editor/taskChips.ts');
  assert.ok(c.includes('Pick a day first, or Clear to take it off.'), 'save-empty says so (F89)');
  assert.doesNotMatch(c, /write\(date\.value \|\| null\)/, 'save-empty never silently clears (F89)');
});

test('embeds and notes that will not load say so (F90, F91)', () => {
  const w = read('src/renderer/src/editor/widgets.ts');
  assert.equal((w.match(/Couldn’t load this note\./g) ?? []).length, 2, 'both embed kinds say it (F90)');
  assert.ok(w.includes('Promise<string | null>'), 'unreadable is null, never empty (F90)');
  assert.ok(w.includes('Couldn’t load the block’s note.'), 'unsync refuses an unread block (F90)');
  const e = read('src/renderer/src/editor/NoteEditor.tsx');
  assert.ok(e.includes("title=\"Couldn't open this note\""), 'pane-level error state (F91)');
  assert.ok(e.includes('setRetry((n) => n + 1)'), 'with a retry (F91)');
});

test('feet, graphs and vaults fail loudly with a retry (F126, F128, F129)', () => {
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('Couldn’t load what’s joined to this note.'), 'the foot says failed (F126)');
  // 5 Nov 2026: the foot reads through the one shared hook (v6); its retry re-reads the links and the joins.
  assert.ok(foot.includes('retry()') && foot.includes('setPeekTick((n) => n + 1)'), 'with a retry (F126)');
  const graph = read('src/renderer/src/components/GraphView.tsx');
  assert.ok(graph.includes("title=\"Couldn't load the graph\""), 'the graph errors with retry (F128)');
  const home = read('src/renderer/src/components/VaultHome.tsx');
  assert.ok(home.includes("Couldn't find your vaults."), 'vaults say failed (F129)');
  assert.ok(home.includes('last-known warning stays visible'), 'last-known is kept (F129)');
  const place = read('src/renderer/src/components/VaultPlace.tsx');
  assert.ok(place.includes('Couldn’t check'), 'the place says failed (F129)');
});
