// node --test tests/vault-editable.test.mjs — everything shown is editable where it
// is shown (p10-vault-editable, 4 Nov 2026: "everything is editable, updates are
// accurate"). One mechanism per surface, never one case: a record's fact (the peek)
// maps to the ProjectEdit that writes the note it came from
// (src/shared/record-edits.ts); a Reading table cell maps to its source line
// (setTableLineCell in src/shared/layouts.ts); a tick box flips only its box
// (setTaskBox in src/shared/tasks.ts). Each check is the full round trip the
// person sees: edit in place -> the note's text changes -> every other view of
// the same fact (the project hub, the records peek) shows it at once, with the
// person's other words and layout kept byte for byte. Made-up vault only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-editable-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { recordFactEdit, canEditFact, recordChoices, recordFactText } from ${JSON.stringify(path.join(root, 'src/shared/record-edits.ts'))};`,
      `export { parseProject, serializeProject, applyProjectEdit, textVersion } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export { workstreams } from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};`,
      `export { readTable, sectionText, setTableCell, setTableLineCell, tableLineCell } from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};`,
      `export { buildRecordModel, peekOf } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { setTaskBox } from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'shared.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const P = 'Projects/Harbourview Fete/Harbourview Fete.md';
const NOTE = `---
type: project
status: active
health: on track
progress: 40
owner: Alex Chen
due: 2026-12-05
tags: [fete, school]
---

# Harbourview Fete

## Summary

A stalls-and-music day on the oval.

## Workstreams

| Workstream   | Owner     | Status      | Progress | Next step                  |
| ------------ | --------- | ----------- | -------- | -------------------------- |
| Stalls       | Alex Chen | In progress | 60%      | Confirm the cake stall map |
| Music        | Sam Lee   | Not started | 10       | Book the PA hire           |
| First aid    | Priya Nair | At risk    |          | Find a second volunteer    |

## What's next

- [ ] Confirm the cake stall map — Alex Chen · by 20 Nov 2026
- [x] Book the oval with the council — Sam Lee

## Key dates

| Date       | Milestone              | Status |
| ---------- | ---------------------- | ------ |
| 2026-11-20 | Stall map locked in    | next   |
| 2026-12-05 | Fete day               |        |

## People

- Alex Chen — stalls
- Sam Lee

## Risks and issues

| Risk               | Impact | Owner   | Status |
| ------------------ | ------ | ------- | ------ |
| Wet weather backup | high   | Alex Chen | Open   |

## Decisions

- **12 Oct 2026** — Entry stays free. *Why:* so every family can come.

## Updates

- 20 Oct 2026: The oval booking came through, from Sam Lee.
`;

/** The records model over one note, as the peek reads it. */
const modelOf = (content) =>
  S.buildRecordModel({
    notes: [{ path: P, title: 'Harbourview Fete', content, props: { type: 'project' } }],
    resolve: () => null,
    today: '2026-11-04',
    me: 'Alex Chen',
  });
const factOf = (record, key) => record.facts.find((f) => f.key === key)?.value;
/** Apply one record-fact edit the way the peek does, and return the note as written. */
const written = (content, record, fact, value) => {
  const p = S.parseProject(content, P);
  const edit = S.recordFactEdit(p, record, fact, value);
  assert.ok(edit, `no edit for ${record.type}/${fact}`);
  S.applyProjectEdit(p, edit, '4 Nov 2026');
  return S.serializeProject(p, content);
};

test('a workstream owner edited in the peek writes its cell and shows everywhere', () => {
  const before = modelOf(NOTE);
  const rec = S.peekOf(before, { id: `workstream:${P}#stalls` })?.record;
  assert.ok(rec, 'the peek reads the Stalls workstream');
  assert.equal(factOf(rec, 'owner'), 'Alex Chen');
  assert.equal(rec.owner, 'Alex Chen');
  assert.equal(S.canEditFact(S.parseProject(NOTE, P), rec, 'owner'), true);
  // Against the file as the writer keeps it: only that line changed.
  const base = S.serializeProject(S.parseProject(NOTE, P), NOTE);
  const after = written(base, S.peekOf(modelOf(base), { id: `workstream:${P}#stalls` })?.record, 'owner', 'Priya Nair');
  assert.match(after, /\| Stalls\s+\| Priya Nair\s+\| In progress \|/);
  const a = base.split('\n'), b = after.split('\n');
  assert.equal(a.length, b.length);
  assert.deepEqual(a.filter((l, i) => l !== b[i]).length, 1);
  // Every other view of the fact agrees at once.
  assert.equal(S.workstreams(S.parseProject(after, P)).find((w) => w.name === 'Stalls')?.owner, 'Priya Nair');
  const peek = S.peekOf(modelOf(after), { id: `workstream:${P}#stalls` })?.record;
  assert.equal(peek?.owner, 'Priya Nair');
});

test('a workstream status, progress and next step edit the same way', () => {
  const rec = S.peekOf(modelOf(NOTE), { id: `workstream:${P}#music` })?.record;
  assert.ok(rec);
  let text = written(NOTE, rec, 'status', 'At risk');
  assert.equal(S.workstreams(S.parseProject(text, P)).find((w) => w.name === 'Music')?.status, 'At risk');
  assert.equal(factOf(S.peekOf(modelOf(text), { id: `workstream:${P}#music` })?.record, 'status'), 'At risk');
  // A plain-number column stays plain; a % column keeps its %.
  text = written(text, S.peekOf(modelOf(text), { id: `workstream:${P}#music` })?.record, 'progress', '35');
  assert.match(text, /\| Music\s+\| Sam Lee\s+\| At risk\s+\| 35\s+\|/);
  text = written(text, S.peekOf(modelOf(text), { id: `workstream:${P}#stalls` })?.record, 'progress', '80');
  assert.match(text, /\| 80%\s+\| Confirm the cake stall map \|/);
  // Clearing empties the cell; the row stays.
  text = written(text, S.peekOf(modelOf(text), { id: `workstream:${P}#stalls` })?.record, 'progress', '');
  assert.match(text, /\| In progress \| \| Confirm the cake stall map \|/);
  text = written(text, S.peekOf(modelOf(text), { id: `workstream:${P}#stalls` })?.record, 'next', 'Print the stall map');
  assert.equal(S.workstreams(S.parseProject(text, P)).find((w) => w.name === 'Stalls')?.next, 'Print the stall map');
});

test('facts with nowhere to write say so instead of guessing', () => {
  const p = S.parseProject(NOTE, P);
  const rec = S.peekOf(modelOf(NOTE), { id: `workstream:${P}#stalls` })?.record;
  assert.ok(rec);
  assert.equal(S.recordFactEdit(p, { ...rec, title: 'No such stream' }, 'owner', 'x'), null);
  assert.equal(S.recordFactEdit(p, rec, 'owner', 'x') !== null, true);
  assert.equal(S.canEditFact(p, rec, 'owner'), true);
  // A table without that column: no edit (the peek stays read-only there).
  const noProg = NOTE.replace('| Progress |', '| Notes |').replace('| 60%      |', '| ok       |').replace('| 10       |', '| ok       |').replace('|          |', '| ok       |');
  const rec2 = S.peekOf(modelOf(noProg), { id: `workstream:${P}#stalls` })?.record;
  assert.equal(S.recordFactEdit(S.parseProject(noProg, P), rec2, 'progress', '50'), null);
  assert.equal(S.canEditFact(S.parseProject(noProg, P), rec2, 'progress'), false);
  // A record from a plain note, not a project: not this mechanism.
  assert.equal(S.recordFactEdit(p, { ...rec, project: 'Notes/Random.md' }, 'owner', 'x'), null);
});

test('a key date day and status edit by the record item', () => {
  const rec = S.peekOf(modelOf(NOTE), { id: `milestone:${P}#stall-map-locked-in` })?.record;
  assert.ok(rec, 'the peek reads the milestone');
  assert.equal(rec.item, 'dates:0');
  let text = written(NOTE, rec, 'date', '2026-11-27');
  assert.equal(S.parseProject(text, P).dates[0].when, '2026-11-27');
  text = written(text, S.peekOf(modelOf(text), { id: `milestone:${P}#stall-map-locked-in` })?.record, 'status', 'late');
  const d = S.parseProject(text, P).dates[0];
  assert.equal(d.status, 'late');
  assert.equal(factOf(S.peekOf(modelOf(text), { id: `milestone:${P}#stall-map-locked-in` })?.record, 'status'), 'late');
  // A stale item (the line went) refuses instead of changing the wrong line.
  assert.equal(S.recordFactEdit(S.parseProject(text, P), { ...rec, item: 'dates:9' }, 'status', 'x'), null);
});

test('ticking a next step keeps its owner and date', () => {
  const p = S.parseProject(NOTE, P);
  const said = S.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '4 Nov 2026');
  assert.match(said, /Ticked off/);
  assert.equal(p.next[0].done, true);
  assert.equal(p.next[0].who, 'Alex Chen');
  assert.equal(p.next[0].when, '20 Nov 2026');
  const text = S.serializeProject(p, NOTE);
  assert.match(text, /- \[x\] Confirm the cake stall map — Alex Chen · by 20 Nov 2026/);
  // The peek's action flips the same way and still names its owner and day.
  const rec = S.peekOf(modelOf(NOTE), { id: `action:${P}#confirm-the-cake-stall-map` })?.record;
  assert.ok(rec, 'the peek reads the action');
  assert.equal(rec.item, 'next:0');
  const text2 = written(NOTE, rec, 'done', 'true');
  const n = S.parseProject(text2, P).next[0];
  assert.equal(n.done, true);
  assert.equal(n.who, 'Alex Chen');
  assert.equal(n.when, '20 Nov 2026');
  const text3 = written(NOTE, rec, 'owner', 'Sam Lee');
  assert.equal(S.parseProject(text3, P).next[0].who, 'Sam Lee');
});

test('risks, decisions and the project facts edit by the same rule', () => {
  const risk = S.peekOf(modelOf(NOTE), { id: `risk:${P}#wet-weather-backup` })?.record;
  assert.ok(risk);
  let text = written(NOTE, risk, 'level', 'medium');
  assert.equal(S.parseProject(text, P).risks[0].level, 'medium');
  text = written(text, S.peekOf(modelOf(text), { id: `risk:${P}#wet-weather-backup` })?.record, 'status', 'Mitigated');
  assert.equal(S.parseProject(text, P).risks[0].status, 'Mitigated');
  const dec = S.peekOf(modelOf(NOTE), { id: `decision:${P}#entry-stays-free` })?.record;
  assert.ok(dec);
  text = written(text, dec, 'why', 'so no family misses out');
  assert.equal(S.parseProject(text, P).decisions[0].why, 'so no family misses out');
  const proj = S.peekOf(modelOf(NOTE), { id: `project:${P}` })?.record;
  assert.ok(proj);
  for (const [fact, value, check] of [['status', 'on hold', 'on hold'], ['health', 'at risk', 'at risk'], ['owner', 'Sam Lee', 'Sam Lee'], ['due', '2026-12-12', '2026-12-12']]) {
    text = written(text, proj, fact, value);
    assert.equal(S.parseProject(text, P)[fact], check, fact);
  }
  text = written(text, proj, 'progress', '55');
  assert.equal(S.parseProject(text, P).progress, 55);
});

test('a Reading table cell writes its source line and nothing else', () => {
  assert.equal(S.setTableLineCell('| Stalls | Alex Chen | In progress |', 1, 'Priya Nair'), '| Stalls | Priya Nair | In progress |');
  // Padding kept, escaped pipes safe, emptied cells stay cells.
  assert.equal(S.setTableLineCell('| a  |  b |', 1, 'xyz'), '| a  |  xyz |');
  assert.equal(S.setTableLineCell('| a | b |', 0, 'x|y'), '| x\\|y | b |');
  assert.equal(S.setTableLineCell('| a | b |', 1, ''), '| a | |');
  assert.equal(S.setTableLineCell('| a |', 2, 'c'), '| a |  | c |');
  assert.equal(S.setTableLineCell('not a table line', 0, 'x'), 'not a table line');
  // The full round trip: the line in the note changes, the peek reads the new cell.
  const lines = NOTE.split('\n');
  const at = lines.findIndex((l) => l.includes('| Music'));
  lines[at] = S.setTableLineCell(lines[at], 4, 'Collect the PA quote');
  const text = lines.join('\n');
  assert.equal(S.workstreams(S.parseProject(text, P)).find((w) => w.name === 'Music')?.next, 'Collect the PA quote');
  assert.equal(factOf(S.peekOf(modelOf(text), { id: `workstream:${P}#music` })?.record, 'next'), 'Collect the PA quote');
});

test('a tick box flips only its box; the line keeps its owner and date', () => {
  const line = '- [ ] Confirm the cake stall map — Alex Chen · by 20 Nov 2026';
  assert.equal(S.setTaskBox(line, true), '- [x] Confirm the cake stall map — Alex Chen · by 20 Nov 2026');
  assert.equal(S.setTaskBox('- [x] Done already — Sam Lee', false), '- [ ] Done already — Sam Lee');
  assert.equal(S.setTaskBox('1. [ ] Numbered — Sam Lee · by Fri', true), '1. [x] Numbered — Sam Lee · by Fri');
  assert.equal(S.setTaskBox('no box here', true), 'no box here');
  // Through the project: the same flip, the same who and when.
  const lines = NOTE.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- [ ] Confirm'));
  lines[at] = S.setTaskBox(lines[at], true);
  const n = S.parseProject(lines.join('\n'), P).next[0];
  assert.equal(n.done, true);
  assert.equal(n.who, 'Alex Chen');
  assert.equal(n.when, '20 Nov 2026');
});

test('status choices start from the words the person wrote', () => {
  const p = S.parseProject(NOTE, P);
  const rec = S.peekOf(modelOf(NOTE), { id: `workstream:${P}#stalls` })?.record;
  assert.deepEqual(S.recordChoices(p, rec, 'status'), ['In progress', 'Not started', 'At risk']);
  const ms = S.peekOf(modelOf(NOTE), { id: `milestone:${P}#stall-map-locked-in` })?.record;
  assert.deepEqual(S.recordChoices(p, ms, 'status'), ['next']);
  assert.equal(S.recordChoices(p, rec, 'owner'), null);
  assert.equal(S.recordChoices(p, { ...rec, title: 'No such stream' }, 'status'), null);
});

test('a Reading cell reads as written, escapes and all', () => {
  assert.equal(S.tableLineCell('| Stalls | Alex [[Chen]] | 60% |', 1), 'Alex [[Chen]]');
  assert.equal(S.tableLineCell('| a | x\\|y |', 1), 'x|y');
  assert.equal(S.tableLineCell('| a |  spaced  |', 1), 'spaced');
  assert.equal(S.tableLineCell('| a |', 3), null);
  assert.equal(S.tableLineCell('not a table line', 0), null);
  assert.equal(S.tableLineCell('| lone words', 0), null);
});

test('fields open on the words as written, links and all', () => {
  const p = S.parseProject(NOTE, P);
  const rec = S.peekOf(modelOf(NOTE), { id: `workstream:${P}#stalls` })?.record;
  assert.equal(S.recordFactText(p, rec, 'owner'), 'Alex Chen');
  assert.equal(S.recordFactText(p, rec, 'status'), 'In progress');
  assert.equal(S.recordFactText(p, rec, 'progress'), '60%');
  assert.equal(S.recordFactText(p, rec, 'next'), 'Confirm the cake stall map');
  assert.equal(S.recordFactText(p, rec, 'title'), 'Stalls');
  assert.equal(S.recordFactText(p, rec, 'nonsense'), null);
  const ms = S.peekOf(modelOf(NOTE), { id: `milestone:${P}#stall-map-locked-in` })?.record;
  assert.equal(S.recordFactText(p, ms, 'date'), '2026-11-20');
  const proj = S.peekOf(modelOf(NOTE), { id: `project:${P}` })?.record;
  assert.equal(S.recordFactText(p, proj, 'owner'), 'Alex Chen');
  assert.equal(S.recordFactText(p, proj, 'progress'), '40');
});

test('names with links still match, and edits keep the links', () => {
  const linked = NOTE.replace('| Stalls       | Alex Chen |', '| Wave list    | [[Alex Chen]] |');
  const p = S.parseProject(linked, P);
  const rec = S.peekOf(modelOf(linked), { id: `workstream:${P}#wave-list` })?.record;
  assert.ok(rec, 'the peek reads the linked workstream');
  assert.equal(S.recordFactText(p, rec, 'owner'), '[[Alex Chen]]');
  const edit = S.recordFactEdit(p, rec, 'status', 'At risk');
  assert.ok(edit);
  S.applyProjectEdit(p, edit, '4 Nov 2026');
  const text = S.serializeProject(p, linked);
  assert.match(text, /\| Wave list\s+\| \[\[Alex Chen\]\] \| At risk \|/);
});

test('through a real vault folder: write, edit, re-read, every view agrees', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-editable-vault-'));
  try {
    const file = path.join(dir, P);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, NOTE);
    const read = readFileSync(file, 'utf8');
    const rec = S.peekOf(modelOf(read), { id: `workstream:${P}#first-aid` })?.record;
    assert.ok(rec);
    const p = S.parseProject(read, P);
    const version = S.textVersion(read);
    S.applyProjectEdit(p, S.recordFactEdit(p, rec, 'status', 'In progress'), '4 Nov 2026');
    writeFileSync(file, S.serializeProject(p, read));
    const again = readFileSync(file, 'utf8');
    assert.notEqual(S.textVersion(again), version);
    assert.equal(S.workstreams(S.parseProject(again, P)).find((w) => w.name === 'First aid')?.status, 'In progress');
    assert.equal(factOf(S.peekOf(modelOf(again), { id: `workstream:${P}#first-aid` })?.record, 'status'), 'In progress');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
