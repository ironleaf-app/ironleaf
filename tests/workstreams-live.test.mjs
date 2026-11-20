// node --test tests/workstreams-live.test.mjs — the Desk Hub's Workstreams block reading live values
// (p12-close-and-noise C, src/shared/layouts.ts liveWorkstream + src/shared/project-hub.ts firstOwnOpen): a row whose
// name matches a project reads status, progress and next step from that project; a typed row with no matching project
// stays as typed. The next step is the project's first open task of the person's own.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-workstreams-live-'));
let L, H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as l from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};\nexport * as h from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
  L = all.l;
  H = all.h;
});
after(() => rmSync(work, { recursive: true, force: true }));

const THADDEUS = { name: 'Wexley St', status: 'active', health: 'at risk', progress: 60, firstOwn: 'Reply to Thaddeus' };
const DONE_JOB = { name: 'Penhallow St', status: 'done', health: 'on track', progress: 100, firstOwn: '' };

test('a row matching a project reads its status, progress and next step live', () => {
  assert.deepEqual(L.liveWorkstream('Wexley St', [THADDEUS, DONE_JOB]), { status: 'At risk', progress: 60, next: 'Reply to Thaddeus' });
  assert.deepEqual(L.liveWorkstream('  wexley st ', [THADDEUS]), { status: 'At risk', progress: 60, next: 'Reply to Thaddeus' }, 'case and spacing do not matter');
  assert.deepEqual(L.liveWorkstream('[[Wexley St]]', [THADDEUS]).next, 'Reply to Thaddeus', 'a linked name matches');
  assert.deepEqual(L.liveWorkstream('Penhallow St', [THADDEUS, DONE_JOB]), { status: 'Done', progress: 100, next: '' }, 'a finished project reads Done');
});

test('a typed row with no matching project stays as typed', () => {
  assert.equal(L.liveWorkstream('Something else', [THADDEUS]), null);
  assert.equal(L.liveWorkstream('', [THADDEUS]), null);
  assert.equal(L.liveWorkstream('Wexley St', []), null);
});

test('the next step is the first open task of the person’s own, in the project’s order', () => {
  const p = {
    name: 'Wexley St', tags: [], summary: '', next: [
      { done: true, what: 'Sign the lease', who: 'Sam' },
      { done: false, what: 'Wait on the landlord', who: 'Landlord' },
      { done: false, what: 'Reply to Thaddeus', who: 'Sam Taylor' },
      { done: false, what: 'Confirm the alarm code' },
    ], dates: [], people: [], risks: [], decisions: [], updates: [], documents: [], notes: '', extra: [],
  };
  const today = Math.floor(new Date(2026, 10, 4).getTime() / 86400000);
  assert.equal(H.firstOwnOpen(p, 'Sam Taylor', today), 'Reply to Thaddeus', 'skips done and other people’s, keeps file order');
  assert.equal(H.firstOwnOpen(p, 'Nobody Here', today), 'Confirm the alarm code', 'an unassigned step is the person’s own');
  assert.equal(H.firstOwnOpen({ ...p, next: [{ done: false, what: 'Wait on the landlord', who: 'Landlord' }] }, 'Sam Taylor', today), '', 'nothing of their own: empty, so the typed row stays');
});
