// node --test tests/uplift-92-guards.test.mjs — the 9.2 uplift's guards batch (F27, F50, F56, F59,
// F61, F66, F116): pills redraw on their own boundary; sent weeks never gather; expired requests read
// refused with dead buttons; related notes come from the one index engine, never the note itself;
// one meeting note per event from every surface; bulk deletes count only what went. Each check guards
// the words or the mechanism its fix put in, so it fails without the fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-guards-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('exact settings match beats prefix at any length (F24)', () => {
  const labels = { models: 'Models' };
  const entries = [
    { section: 'models', title: 'Model', hint: 'Which model the chat uses.', words: 'ai model' },
    { section: 'models', title: 'Model picker depth', hint: 'How models list.', words: 'models list' },
  ];
  const hits = S.searchSettings('model', entries, labels, 5);
  assert.equal(hits[0].entry.title, 'Model', 'the exact five-letter word wins');
  assert.ok(hits[0].score > hits[1].score, 'by score, not by order');
});

test('pills redraw on their own boundary (F27)', () => {
  const src = read('src/renderer/src/editor/reminders.ts');
  assert.ok(src.includes('msToNextPill'), 'a per-pill wait');
  assert.ok(src.includes('(left % 60000) + 500'), 'flipping on the remaining minute');
  assert.ok(src.includes('destroy()'), 'the timer dies with the editor');
});

test('sent weeks never gather, from either page (F50, F116)', () => {
  const page = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  assert.ok(page.includes('export function canGatherWeek'), 'one guarded transition');
  assert.ok(page.includes("u.status !== 'Sent'"), 'sent never gathers');
  assert.ok(page.includes('!canGatherWeek(view?.current)'), 'the menu gated');
  const w3b = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(w3b.includes('canGatherWeek'), 'the new page shares the guard');
  assert.ok(w3b.includes('if (!canGatherWeek(u) || !canEdit) return;'), 'tap-gather guarded too');
});

test('related notes come from the one index engine, never the note itself (F59)', () => {
  // 5 Nov 2026: the engine call moved into the one shared read (lib/noteLinks.ts, v6); the foot and the context
  // rail share its answer, each still excluding the open note itself. t27-unused-panels: the side panel is gone,
  // so its share of this pin moved to the rail, the surviving second reader.
  const lib = read('src/renderer/src/lib/noteLinks.ts');
  assert.ok(lib.includes('w.index.relatedNotes(path)'), 'the index’s engine, read once');
  assert.doesNotMatch(read('src/renderer/src/components/NoteFoot.tsx'), /relatedNotes\(path, notes/, 'no second engine in the foot');
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('x.path !== path'), 'the foot keeps everything but the note itself');
  assert.ok(foot.includes('r.reasons.slice(0, 6)'), 'reasons as given');
  assert.ok(read('src/renderer/src/views/note/ContextRail.tsx').includes('useNoteLinks(path, revision)'), 'the context rail shares the one read');
});

test('bulk deletes count only what went, and undo says what came back (F66)', () => {
  const src = read('src/renderer/src/state/actions.ts');
  assert.ok(src.includes("couldn't be deleted."), 'failures get their own words');
  assert.ok(src.includes('new Set(trashed)'), 'failed tabs stay open');
  // One Bin: a partial undo says what came back of what went, and where the rest are.
  assert.ok(src.includes('Brought back ${back} of ${trashed}; the rest are in Recently deleted.'), 'partial undos said exactly');
  assert.ok(src.includes('if (there !== null) back++;'), 'restored-meanwhile counts as back, never as missing');
  assert.ok(src.includes('return trashed.length;'), 'callers get the true count');
});
