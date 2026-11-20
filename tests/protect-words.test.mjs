// node --test tests/protect-words.test.mjs — a folder named Health, or a #health tag, does not protect a note
// (t28 follow-up, 8 Nov 2026, the call on the break-it job's question). Only the person's explicit
// level (sensitivity/level saying family or health) or their area (Family/Health) protects, through the one
// rule the People page and the served cards share (src/shared/people.ts isProtected). Saying yes to folder
// names or tags would gate a capability on the person's words, against the global-fix rule: the model
// interprets or asks, and protection stays on the level and the area. No behaviour change here; this pins it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-protect-words-'));
let P; // shared/people.ts, the one protected rule
let A; // shared/areas.ts, which area a note is in
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { isProtected } from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};\nexport { areaOf } from ${JSON.stringify(path.join(root, 'src/shared/areas.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  P = A = all;
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = [
  { id: 'work', name: 'Work', folder: 'Work' },
  { id: 'family', name: 'Family', folder: 'Family' },
  { id: 'health', name: 'Health', folder: 'Health' },
];
/** Whether a note with this path and properties is protected, areas as configured (or none). */
const protects = (rel, props, areas = AREAS) => P.isProtected(props, A.areaOf({ path: rel, props }, areas)?.id);

test('a level saying family or health protects, wherever the note sits', () => {
  assert.equal(protects('Notes/Cardio.md', { sensitivity: 'Health' }), true, 'sensitivity: Health');
  assert.equal(protects('Notes/Cardio.md', { sensitivity: 'Family-private' }), true, 'sensitivity: Family-private');
  assert.equal(protects('Notes/Cardio.md', { level: 'family' }), true, 'level: family');
  assert.equal(protects('Notes/Cardio.md', { level: 'HEALTH' }), true, 'level reads any case');
  assert.equal(protects('Notes/Cardio.md', {}), false, 'no level, no area: open');
});

test('the Family or Health area protects, with no level on the note', () => {
  assert.equal(protects('Health/Walk log.md', {}), true, 'inside the Health area');
  assert.equal(protects('Family/Photos.md', {}), true, 'inside the Family area');
  assert.equal(protects('Notes/Walk log.md', { area: 'Health' }), true, 'an area: property naming Health');
  assert.equal(protects('Work/Beacon.md', {}), false, 'a work note stays open');
});

test('a folder named Health protects nothing when it is no area', () => {
  assert.equal(A.areaOf({ path: 'Health/Cardio.md', props: {} }, []), undefined, 'no areas: the folder is not an area');
  assert.equal(protects('Health/Cardio.md', {}, []), false, 'the folder name alone never protects');
  assert.equal(protects('Health/Cardio.md', {}, [{ id: 'work', name: 'Work', folder: 'Work' }]), false, 'nor beside other areas');
});

test('a nested folder named Health protects nothing either', () => {
  assert.equal(A.areaOf({ path: 'Work/Health/Plan.md', props: {} }, AREAS)?.id, 'work', 'the note is in Work, its first folder');
  assert.equal(protects('Work/Health/Plan.md', {}), false, 'the nested Health name never protects');
});

test('a health tag protects nothing: tags are words, not a level', () => {
  assert.equal(protects('Notes/Cardio.md', { tags: ['health'] }), false, 'a tags list naming health');
  assert.equal(protects('Notes/Cardio.md', { tags: 'health' }), false, 'a tags line naming health');
  assert.equal(protects('Notes/Cardio.md', { tag: 'health' }), false, 'a tag property naming health');
  assert.equal(protects('Notes/Health review.md', { title: 'Health review' }), false, 'health in the title');
});
