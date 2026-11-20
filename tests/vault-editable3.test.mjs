// node --test tests/vault-editable3.test.mjs — p17-editable (Nov 2026): a
// meeting note's top edits its facts where they show, through the note-fact
// mechanism (src/shared/records.ts noteFactWrite): day, time, attendees and
// project were round 2; where the meeting is joins them here. The note's own
// spelling wins (place stays place); clearing takes the property off. Made-up
// notes only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-editable3-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { canEditNoteFact, noteFactWrite } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { setNoteProp } from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'shared.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const MEETING = `---
type: meeting
date: 2026-11-03
time: 10:00 AM
attendees: Alex Chen, Priya Nair
project: "[[Harbourview Fete]]"
where: Teams
---

# Fete committee
`;

test('a meeting changes where it is in its own note', () => {
  const rec = { type: 'meeting', page: true };
  assert.equal(S.canEditNoteFact(rec, 'where'), true);
  const props = { type: 'meeting', date: '2026-11-03', time: '10:00 AM', where: 'Teams' };
  const w = S.noteFactWrite(rec, 'where', props, 'The hall');
  assert.deepEqual(w, { key: 'where', value: 'The hall' });
  const text = S.setNoteProp(MEETING, w.key, w.value);
  assert.match(text, /where: The hall/);
  assert.match(text, /time: 10:00 AM/);
  // The note's own spelling wins (place stays place, location stays location).
  assert.equal(S.noteFactWrite(rec, 'where', { place: 'Teams' }, 'The hall')?.key, 'place');
  assert.equal(S.noteFactWrite(rec, 'where', { location: 'Teams' }, 'The hall')?.key, 'location');
  // Clearing takes the property off; someone else's note stays read-only.
  assert.deepEqual(S.noteFactWrite(rec, 'where', props, '  '), { key: 'where', value: null });
  assert.equal(S.canEditNoteFact({ type: 'meeting', page: false }, 'where'), false);
});
