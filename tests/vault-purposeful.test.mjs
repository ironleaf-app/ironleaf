// node --test tests/vault-purposeful.test.mjs — p10-vault-connected item 1 (4 Nov 2026): what a panel
// says about something fits where you are. A person's line in any context shows their role in THAT
// context, never facts from other areas of life. Made-up notes only. Fails first (C2: global role
// leaks).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-purposeful-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const notes = [
  { path: 'Projects/Health/Health.md', title: 'Health', label: 'Health', mtime: 1, props: { type: 'project' }, content: `---
type: project
status: active
---
# Health
## People
- **Sam Lee** — Patient
` },
  { path: 'Projects/Work/Work.md', title: 'Work', label: 'Work', mtime: 1, props: { type: 'project' }, content: `---
type: project
status: active
owner: Sam Lee
---
# Work
## People
- **Sam Lee** — Owner
## Workstreams
| Workstream | Owner | Status |
| --- | --- | --- |
| Wave list | Sam Lee | in progress |
` },
];
const resolve = () => null;

// What the peek row shows for a person in a context: mirrors Peek.tsx rowMeta for person/org.
// The fix keeps this in the renderer; the test pins the rule here so the leak cannot return.
function personRowFor(model, contextId, personId) {
  const item = R.connectedTo(model, contextId).find((x) => x.record.id === personId);
  assert.ok(item, 'person is connected in this context');
  // The rule: the row's words come from THIS context (its whys), never the person's global role fact.
  // A global fact from another area ("Patient") must not appear on a work row.
  const globalRole = item.record.facts.find((f) => f.key === 'role')?.value ?? '';
  const contextWords = item.whys.join(' · ');
  return { globalRole, contextWords, item };
}

test('C2: in a work context, a person reads by their work role, not a health role', () => {
  const m = R.buildRecordModel({ notes, resolve, today: '2026-11-04' });
  const sam = m.records.get('person:sam lee');
  assert.ok(sam, 'Sam');
  // The global fact keeps the first role it saw (Health first here): the leak is what the ROW shows.
  assert.equal(sam.facts.find((f) => f.key === 'role')?.value, 'Patient');
  const ws = [...m.records.values()].find((r) => r.type === 'workstream');
  assert.ok(ws, 'a workstream');
  const row = personRowFor(m, ws.id, sam.id);
  assert.ok(row.contextWords.includes('Owner'), `work context says Owner (got ${JSON.stringify(row.contextWords)})`);
  assert.ok(!row.contextWords.includes('Patient'), 'work context never says the health role');
  // The renderer must draw the context words, not the global fact (Peek.tsx rowMeta).
  const peek = readFileSync(path.join(root, 'src/renderer/src/components/Peek.tsx'), 'utf8');
  const personBranch = peek.slice(peek.indexOf("r.type === 'person'"), peek.indexOf("r.type === 'person'") + 600);
  assert.ok(!personBranch.includes("facts.find((f) => f.key === 'role')"), `peek person rows read the context, not the global role fact (got ${JSON.stringify(personBranch.slice(0, 200))})`);
});

test('in a health context, the same person reads by their health role', () => {
  const m = R.buildRecordModel({ notes, resolve, today: '2026-11-04' });
  const sam = m.records.get('person:sam lee');
  const health = m.records.get('project:Projects/Health/Health.md');
  const row = personRowFor(m, health.id, sam.id);
  assert.ok(row.contextWords.includes('Patient'), `health context says Patient (got ${JSON.stringify(row.contextWords)})`);
});

test('a project line fits its context: in a workstream peek it says it is the project', () => {
  const m = R.buildRecordModel({ notes, resolve, today: '2026-11-04' });
  const ws = [...m.records.values()].find((r) => r.type === 'workstream');
  const proj = m.records.get('project:Projects/Work/Work.md');
  const item = R.connectedTo(m, ws.id).find((x) => x.record.id === proj.id);
  assert.ok(item, 'workstream reaches its project');
  assert.ok(item.whys.includes('Its project'), `project line says Its project (got ${JSON.stringify(item.whys)})`);
});
