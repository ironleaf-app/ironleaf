// node --test tests/reviews.test.mjs — the weekly review (src/main/reviews.ts; 9.5 fourth pass): the
// week's draft read against the week's starting words, even when a project file moved since. Made-up projects only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-reviews-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/reviews.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a project renamed mid-week is still read against its week-old words (9.5 fourth pass)', async () => {
  const oldText = '---\ntype: project\nstatus: active\n---\n# Shop\n\n## What’s next\n\n- [ ] Paint the sign\n';
  const newText = '---\ntype: project\nstatus: active\n---\n# Shop\n\n## What’s next\n\n- [x] Paint the sign\n- [ ] Hang the sign\n';
  const notes = new Map([['Projects/New.md', newText]]);
  const r = new M.Reviews({
    index: {
      get: (p) => (notes.has(p) ? { path: p, title: 'Shop', mtime: 0, props: { type: 'project' }, links: [] } : undefined),
      content: (p) => notes.get(p),
      resolve: () => null,
    },
    projects: {
      list: () => [{ path: 'Projects/New.md', name: 'Shop' }],
      view: () => ({ project: { folder: null }, activity: [], notes: [], linkedFrom: [] }),
      known: () => ({ people: [] }),
    },
    history: { record: () => {}, peek: () => undefined, counts: () => ({}) },
    writeNote: async () => {},
    exists: async () => false,
    trash: async () => {},
    versions: async () => [],
    version: async () => { throw new Error('none'); },
    load: async () => ({ last: null, baselines: { 'Projects/Old.md': { time: new Date(2026, 9, 14).getTime(), text: oldText } } }),
    save: async () => {},
    askJson: async () => ({ reply: null, error: 'no' }),
    undoProject: async () => ({}),
  });
  const draft = await r.draft(new Date(2026, 9, 21, 12));
  const shop = draft.projects.find((p) => p.name === 'Shop');
  assert.ok(shop.changed.some((c) => /Done: Paint the sign/.test(c.words)), 'the ticked step is seen');
  assert.ok(shop.changed.some((c) => /New next step: Hang the sign/.test(c.words)), 'the added step is seen');
});
