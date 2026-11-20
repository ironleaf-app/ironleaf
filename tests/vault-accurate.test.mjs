// node --test tests/vault-accurate.test.mjs — p10-vault-connected item 2 (4 Nov 2026): one fact, one
// value everywhere. A project's health, late counts and progress come from the same source and agree
// across views; when one changes, every view showing it updates. Made-up notes only. Fails first (C3:
// raw vs effective health; C4: list vs page late counts).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-accurate-'));
let R, H, P, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const { writeFileSync } = await import('node:fs');
  const src = (f) => JSON.stringify(path.join(root, 'src/shared', f));
  writeFileSync(entry, `export * as H from ${src('project-hub.ts')};\nexport * as P from ${src('project-file.ts')};\nexport * as T from ${src('timeline.ts')};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'hub.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ H, P, T } = await import(pathToFileURL(path.join(work, 'hub.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('C3: Connected and Home read a project health from one source (effective, not raw)', () => {
  // A project stored "on track" with the person's own steps late is not on track (projectLook.ts
  // effectiveHealth): Home shows "At risk". Connected must show the same, not the raw "on track".
  const peek = readFileSync(path.join(root, 'src/renderer/src/components/Peek.tsx'), 'utf8');
  // The project branch must weigh late/due like Home (effectiveHealth), not the raw fact alone.
  const branch = peek.slice(peek.indexOf("r.type === 'project'"), peek.indexOf("r.type === 'project'") + 800);
  assert.ok(
    branch.includes('effectiveHealth') || branch.includes('lateMine') || branch.includes('effective'),
    `peek project rows weigh late/due like Home (got ${JSON.stringify(branch.slice(0, 250))})`,
  );
});

test('C4: the Projects list counts late like the project page (connected actions included)', () => {
  // An action written only in meeting notes (connected action) that is late counts on the page
  // (hubModel with connected) and must count on Home (Projects.list) too.
  const projText = `---
type: project
status: active
owner: Ana Ruiz
---
# Work
## What's next
- [ ] Done in the file — Ana Ruiz
`;
  const p = P.parseProject(projText, 'Projects/Work/Work.md');
  const today = T.readDay('2026-11-04');
  const without = H.hubModel({ project: p, today, me: 'Ana Ruiz', connected: [] });
  const connected = [{ id: 'action:Meetings/Walk.md#late-one', path: 'Meetings/Walk.md', what: 'Late from the meeting', who: 'Ana Ruiz', due: '2026-10-20', done: false, from: 'Walk' }];
  const withConn = H.hubModel({ project: p, today, me: 'Ana Ruiz', connected });
  assert.equal(without.plan.late.length, 0, 'no late without the connected action');
  assert.equal(withConn.plan.late.length, 1, 'one late with it');
  // Projects.list must pass connected actions (it has the index's records), not hubModel alone.
  const list = readFileSync(path.join(root, 'src/main/projects.ts'), 'utf8');
  assert.ok(
    list.includes('connectedActions') || list.includes('connected:') || list.includes('records()'),
    `Projects.list counts connected actions like the page (got ${JSON.stringify(list.slice(list.indexOf('lateMine') - 200, list.indexOf('lateMine') + 100))})`,
  );
});

test('workstream progress and project progress come from the file, unchanged', () => {
  // The file's figures are the source (records.ts reads them straight): 98% on the project, 97% on
  // the workstream. Views must not recompute them differently.
  const notes = [
    { path: 'Projects/Work/Work.md', title: 'Work', label: 'Work', mtime: 1, props: { type: 'project' }, content: `---
type: project
status: active
health: off track
progress: 98
---
# Work
## Workstreams
| Workstream | Status | Progress |
| --- | --- | --- |
| Wave list | in progress | 97 |
` },
  ];
  const m = R.buildRecordModel({ notes, resolve: () => null, today: '2026-11-04' });
  const proj = m.records.get('project:Projects/Work/Work.md');
  const ws = [...m.records.values()].find((r) => r.type === 'workstream');
  assert.equal(proj.progress, 98, 'project 98%');
  assert.equal(ws.progress, 97, 'workstream 97%');
  assert.equal(proj.facts.find((f) => f.key === 'progress')?.value, '98%');
  assert.equal(ws.facts.find((f) => f.key === 'progress')?.value, '97%');
});
