// node --test tests/inbox-bulk-fallback.test.mjs — the Inbox fallback and bulk plan (src/shared/inbox-suggest.ts,
// 10.0 papercuts): with the vault's notes, areas and link map, a capture naming a note or carrying a link is offered
// a home where the old empty fallback offered nothing, and filing the ticked files each where suggested, leaving the
// ones with no suggestion for the person.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-inbox-fb-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/inbox-suggest.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const item = (words, links = []) => ({ words, text: words, links, task: false });
const weak = { projects: [], people: [], notes: [], areas: [], modules: [], resolve: () => null };
const full = {
  projects: [],
  people: [],
  notes: [
    { title: 'Galaxy Tab S12 Ultra', path: 'Notes/Galaxy Tab S12 Ultra.md', area: 'home' },
    { title: 'Car', path: 'Notes/Car.md', area: 'home' },
  ],
  areas: [{ id: 'home', name: 'Home' }],
  modules: [],
  resolve: (t) => (t === 'Galaxy Tab S12 Ultra' ? 'Notes/Galaxy Tab S12 Ultra.md' : null),
};

test('a capture naming a note is offered it, and its area after it', () => {
  assert.deepEqual(S.suggestInboxHome(item('Pick up the Galaxy Tab charger'), weak), []);
  const out = S.suggestInboxHome(item('Pick up the Galaxy Tab charger'), full);
  assert.equal(out[0].target.kind, 'note');
  assert.equal(out[0].target.path, 'Notes/Galaxy Tab S12 Ultra.md');
  assert.ok(out.some((s) => s.target.kind === 'area' && s.target.name === 'Home'), JSON.stringify(out));
});

test('a link it carries is followed to the note', () => {
  assert.deepEqual(S.suggestInboxHome(item('Read this later', ['Galaxy Tab S12 Ultra']), weak), []);
  const out = S.suggestInboxHome(item('Read this later', ['Galaxy Tab S12 Ultra']), full);
  assert.ok(out.some((s) => s.target.kind === 'note' && s.target.path === 'Notes/Galaxy Tab S12 Ultra.md'), JSON.stringify(out));
});

test('filing the ticked files each where suggested and leaves the rest', () => {
  const byId = {
    a: [{ target: { kind: 'project', path: 'P.md', name: 'P' }, why: 'Names P' }],
    b: [],
  };
  const plan = S.planBulkFile([{ id: 'a' }, { id: 'b' }], (id) => byId[id]);
  assert.deepEqual(plan, [{ id: 'a', target: { kind: 'project', path: 'P.md', name: 'P' } }]);
  assert.deepEqual(S.planBulkFile([], () => []), []);
});
