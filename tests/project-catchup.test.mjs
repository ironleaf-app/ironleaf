// node --test tests/project-catchup.test.mjs — projects:checks serving (10.0 item 19): each live project gets its
// standing checks and its catch-up proposals from the notes changed since it was last updated; finished projects keep
// nothing waiting; the cache lasts until the notes change. A made-up vault held in memory; fixed today (Monday
// 2 November 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-catchup-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const dialog = {};\nexport const shell = {};\nexport const app = {};\n');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [`export { VaultIndex } from ${src('src/main/indexer.ts')};`, `export { Projects } from ${src('src/main/projects.ts')};`, `export { projectChecksFor, createProjectChecks } from ${src('src/main/project-checks.ts')};`].join(
      '\n',
    ),
  );
  await build({
    input: entry,
    platform: 'node',
    external: ['yaml', /^node:/],
    plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }],
    output: { file: path.join(work, 'c.mjs'), format: 'esm' },
    logLevel: 'silent',
  });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 2, 12, 0); // Monday 2 November 2026, midday
const ms = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h, 0).getTime();

const PROJECT = `---
type: project
status: active
---

# Harbour Fit-out

## What's next

- [ ] Paint the office

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 20 Oct 2026 | Racking lands |  |

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| The crane booking lapses | High |  | Open |

## Decisions

- **1 Jul 2026** — Use the northern dock for deliveries
`;

const REVIEW = `---
type: meeting
date: 2026-10-30
---

# Harbour review

## Decisions

- The dock work starts on Monday

## Actions

Sam to confirm the cabling contractor by Friday
`;

const vault = () => {
  const index = new M.VaultIndex();
  // An owned folder (u3: only a folder the project file names lists as its notes).
  const files = new Map([
    ['Harbour Fit-out/Harbour Fit-out.md', { text: PROJECT, mtime: ms(2026, 10, 20) }],
    ['Harbour Fit-out/Review.md', { text: REVIEW, mtime: ms(2026, 10, 30) }],
    ['Old/Old job.md', { text: '---\ntype: project\nstatus: finished\n---\n\n# Old job\n', mtime: ms(2026, 10, 1) }],
  ]);
  for (const [rel, f] of files) index.set(rel, f.text, f.mtime, f.text.length);
  return { index, projects: new M.Projects(index) };
};

test('a live project gets its checks and its changed-note proposals; a finished one keeps nothing waiting', () => {
  const { index, projects } = vault();
  const states = M.projectChecksFor(projects, index, NOW);
  assert.deepEqual(
    states.map((s) => s.path),
    ['Harbour Fit-out/Harbour Fit-out.md'],
  );
  const [harbour] = states;
  assert.deepEqual(
    harbour.checks.map((c) => c.kind),
    ['slipped-date', 'risk-owner', 'stale-decision'],
  );
  const whats = harbour.proposals.map((p) => p.what);
  assert.ok(whats.includes('Confirm the cabling contractor'), `proposals: ${whats.join(' / ')}`);
  assert.ok(whats.includes('The dock work starts on Monday'));
  // Its own line already on the project is never proposed back.
  assert.ok(!whats.includes('Paint the office'));
});

test('the cache lasts until the notes change (and never past the day)', () => {
  const { index, projects } = vault();
  const served = M.createProjectChecks(projects, index);
  const first = served.checks(NOW);
  assert.equal(served.checks(NOW), first, 'same notes, same answer');
  index.set('Harbour/Review.md', `${REVIEW}\nExtra line.\n`, ms(2026, 10, 31), REVIEW.length + 14);
  assert.notEqual(served.checks(NOW), first, 'changed notes, fresh answer');
  assert.notEqual(served.checks(new Date(2026, 10, 3, 12, 0)), first, 'a new day, fresh answer');
});
