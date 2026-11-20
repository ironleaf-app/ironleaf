// node --test tests/vault-connected.test.mjs — p10-vault-connected item 3 (4 Nov 2026): from
// anything you can reach what it belongs to and what belongs to it, in one click, both ways. Every
// link has words both ways; no dead end. Made-up notes only. Fails first (C1: project links have
// empty backs).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-connected-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const WORK = 'Projects/Work/Work.md';
const notes = [
  { path: WORK, title: 'Work', label: 'Work', mtime: 1, props: { type: 'project' }, content: `---
type: project
status: active
health: at risk
owner: Ana Ruiz
---
# Work
## Workstreams
| Workstream | Owner | Status | Progress |
| --- | --- | --- | --- |
| Joinery | Sam Okafor | in progress | 40 |
## What's next
- [ ] Send the quote — Sam Okafor
## Key dates
| Date | Milestone | Status |
| --- | --- | --- |
| 2026-03-20 | Install starts | next |
## People
- **Ana Ruiz** — Owner
- **Sam Okafor** — Joinery lead
## Documents
- [[Attachments/quote.pdf|quote.pdf]]
` },
  { path: 'People/Ana.md', title: 'Ana Ruiz', label: 'Ana', mtime: 1, props: { type: 'person', role: 'Owner' }, content: `---
type: person
role: Owner
---
# Ana Ruiz
` },
  { path: 'Meetings/Walk.md', title: 'Walk', label: 'Walk', mtime: 1, props: { type: 'meeting', date: '2026-03-10', project: '[[Work]]', attendees: ['Ana Ruiz'] }, content: `---
type: meeting
date: 2026-03-10
project: "[[Work]]"
attendees: [Ana Ruiz]
---
# Walk
## Actions
- [ ] Book the electrician — Ana Ruiz
` },
  { path: 'Notes/Quote.md', title: 'Quote', label: 'Quote', mtime: 1, props: { type: 'note' }, content: `# Quote\n\nSee [[Work]].\n` },
];
const resolve = (t, from) => {
  const base = t.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  const hit = notes.find((n) => n.title === base || n.path.endsWith(`${base}.md`));
  return hit ? hit.path : null;
};
const model = () => R.buildRecordModel({ notes, resolve, today: '2026-11-04' });

test('C1: a workstream to its project and back, both with words', () => {
  const m = model();
  const ws = [...m.records.values()].find((r) => r.type === 'workstream');
  assert.ok(ws, 'a workstream');
  const toProj = R.connectedTo(m, ws.id).find((x) => x.record.type === 'project');
  assert.ok(toProj, 'workstream reaches its project');
  assert.ok(toProj.whys.length && toProj.whys.every(Boolean), 'workstream says how the project joins it');
  const back = R.connectedTo(m, toProj.record.id).find((x) => x.record.id === ws.id);
  assert.ok(back, 'project reaches the workstream back');
  assert.ok(back.whys.length && back.whys.every(Boolean), `project says how the workstream joins it (got ${JSON.stringify(back.whys)})`);
});

test('C1: an action to its project and back, both with words', () => {
  const m = model();
  const act = [...m.records.values()].find((r) => r.type === 'action' && r.path === WORK);
  assert.ok(act, 'an action in the project');
  const toProj = R.connectedTo(m, act.id).find((x) => x.record.type === 'project');
  assert.ok(toProj, 'action reaches its project');
  const back = R.connectedTo(m, toProj.record.id).find((x) => x.record.id === act.id);
  assert.ok(back, 'project reaches the action back');
  assert.ok(back.whys.length && back.whys.every(Boolean), `project says how the action joins it (got ${JSON.stringify(back.whys)})`);
});

test('C1: a meeting to its project and back, both with words', () => {
  const m = model();
  const meet = [...m.records.values()].find((r) => r.type === 'meeting');
  assert.ok(meet, 'a meeting');
  const toProj = R.connectedTo(m, meet.id).find((x) => x.record.type === 'project');
  assert.ok(toProj, 'meeting reaches its project');
  const back = R.connectedTo(m, toProj.record.id).find((x) => x.record.id === meet.id);
  assert.ok(back, 'project reaches the meeting back');
  assert.ok(back.whys.length && back.whys.every(Boolean), `project says how the meeting joins it (got ${JSON.stringify(back.whys)})`);
});

test('a person to their projects, tasks and meetings, and back', () => {
  const m = model();
  const ana = m.records.get('person:ana ruiz');
  assert.ok(ana, 'Ana');
  const near = R.connectedTo(m, ana.id);
  assert.ok(near.some((x) => x.record.type === 'project'), 'person reaches a project');
  assert.ok(near.some((x) => x.record.type === 'action'), 'person reaches a task');
  assert.ok(near.some((x) => x.record.type === 'meeting'), 'person reaches a meeting');
  // Back: each of those reaches the person with words.
  for (const x of near.filter((y) => ['project', 'action', 'meeting'].includes(y.record.type))) {
    const back = R.connectedTo(m, x.record.id).find((y) => y.record.id === ana.id);
    assert.ok(back, `${x.record.type} reaches the person back`);
    assert.ok(back.whys.length && back.whys.every(Boolean), `${x.record.type} says how the person joins it`);
  }
});

test('a doc to where it is linked, and back', () => {
  const m = model();
  const note = m.records.get('note:Notes/Quote.md');
  assert.ok(note, 'a doc');
  const toProj = R.connectedTo(m, note.id).find((x) => x.record.type === 'project');
  assert.ok(toProj, 'doc reaches the project it links to');
  const back = R.connectedTo(m, toProj.record.id).find((x) => x.record.id === note.id);
  assert.ok(back, 'project reaches the doc back');
});

test('a task to its meeting (source) and back', () => {
  const m = model();
  const act = [...m.records.values()].find((r) => r.type === 'action' && r.source?.startsWith('meeting:'));
  assert.ok(act, 'an action written in a meeting');
  const meet = R.connectedTo(m, act.id).find((x) => x.record.type === 'meeting');
  assert.ok(meet, 'task reaches its meeting');
  assert.ok(meet.whys.length && meet.whys.every(Boolean), 'task says how the meeting joins it');
});
