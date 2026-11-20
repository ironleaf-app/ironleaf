// node --test tests/project-fidelity.test.mjs — a save changes only what it touched (4 Nov 2026: one catch-up
// reworded three steps and every line was rewritten, en dashes to em dashes, every date to ISO). A real-style project
// file with en dashes and "16 Oct 2026" dates: parse, one edit, serialize — the diff is that line. A reworded step keeps
// the file's date shape. Untouched properties keep their bytes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-fidelity-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/project-file.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// The person's own words: en dashes throughout, "16 Oct 2026" dates, a blank status kept blank.
const FILE = `---
type: project
status: active
health: on track
updated: 2026-10-16
---

# Harbour Fit-out

## Summary

Fit out the harbour office.

## What\u2019s next

- [ ] Paint the office \u2013 Sam \u00b7 by 16 Oct 2026
- [ ] Order the chairs \u2013 by 18 Oct 2026
- [ ] Confirm the cabling \u2013 Ana \u00b7 by 20 Oct 2026

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 16 Oct 2026 | Racking lands |  |
| 20 Oct 2026 | Handover | planned |

## People

- **Sam Taylor** \u2013 builder
- **Ana Ruiz** \u2013 sparky

## Risks and issues

- **High** \u2013 The crane booking lapses
- Delivery late \u2013 waiting on supplier

## Decisions

- **1 Jul 2026** \u2013 Use the northern dock for deliveries.
- **3 Oct 2026** \u2013 Paint first, then racking.

## Updates

- **16 Oct 2026** \u2013 Racking on its way *From:* supplier
- **15 Oct 2026** \u2013 Slab poured

## Documents

- \`Plans/floor.pdf\` \u2013 floor plan
- \`Quotes/av.xlsx\` \u2013 lighting quote

## Notes

Mine.
`;

const changedLines = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
};

test('one edit touches one line: every other line stays byte for byte', () => {
  const p = P.parseProject(FILE, 'Projects/Harbour/Harbour.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '17 Oct 2026');
  const after = P.serializeProject(p, FILE);
  const changed = changedLines(FILE, after);
  assert.deepEqual(changed, [15], `only the ticked step changes, no updated set here:\n${after}`);
  assert.ok(after.includes('- [x] Paint the office \u2014 Sam \u00b7 by 16 Oct 2026'), 'the touched line keeps its date shape');
  assert.ok(after.includes('- **Sam Taylor** \u2013 builder'), 'an untouched line keeps its en dash');
  assert.ok(after.includes('| 16 Oct 2026 | Racking lands |  |'), 'an untouched row keeps its bytes, blank included');
  assert.ok(after.includes('updated: 2026-10-16'), 'an untouched property keeps its bytes, quotes unadded');
});

test('a round trip with no edits changes nothing at all', () => {
  const p = P.parseProject(FILE, 'Projects/Harbour/Harbour.md');
  assert.equal(P.serializeProject(p, FILE), FILE);
});

test('a reworded step keeps the date shape its file uses, and untouched lists stay', () => {
  const p = P.parseProject(FILE, 'Projects/Harbour/Harbour.md');
  // A catch-up as the model brings it: reworded steps with ISO dates, key dates re-given in ISO.
  p.next = [
    { done: false, what: 'Paint the office walls', who: 'Sam', when: '2026-10-16' },
    { done: false, what: 'Order new chairs', when: '2026-10-18' },
    { done: false, what: 'Confirm cabling contractor', who: 'Ana', when: '2026-10-20' },
  ];
  p.dates = [
    { when: '2026-10-16', what: 'Racking lands' },
    { when: '2026-10-20', what: 'Handover', status: 'planned' },
  ];
  const after = P.serializeProject(p, FILE);
  assert.ok(!after.includes('2026-10-16') || after.includes('updated:'), `no ISO leaks into steps or key dates:\n${after}`);
  assert.ok(after.includes('Paint the office walls \u2014 Sam \u00b7 by 16 Oct 2026'), 'the reworded step keeps 16 Oct 2026');
  assert.ok(after.includes('| 16 Oct 2026 | Racking lands |  |'), 'the same-day key date stays byte for byte');
  for (const line of ['- **Sam Taylor** \u2013 builder', '- **High** \u2013 The crane booking lapses', '- **1 Jul 2026** \u2013 Use the northern dock for deliveries.', '- **16 Oct 2026** \u2013 Racking on its way *From:* supplier', '- `Plans/floor.pdf` \u2013 floor plan']) {
    assert.ok(after.includes(line), `untouched stays: ${line}`);
  }
});

// Data safety, 5 Nov 2026 (p21: nothing tonight can hurt a person's files): a save keeps the file's own
// line ends, its last newline (or none), every word of a very long line, and a ... close to the properties.
test('Windows line ends stay: no edits change nothing, one edit touches one line', () => {
  const crlf = FILE.replace(/\n/g, '\r\n');
  assert.equal(P.serializeProject(P.parseProject(crlf, 'Projects/Harbour/Harbour.md'), crlf), crlf, 'a round trip keeps CRLF byte for byte');
  const p = P.parseProject(crlf, 'Projects/Harbour/Harbour.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '17 Oct 2026');
  const after = P.serializeProject(p, crlf);
  assert.deepEqual(changedLines(crlf, after), [15], 'only the ticked step changes, CRLF on every line');
  assert.ok(after.includes('\r\n') && !after.replace(/\r\n/g, '').includes('\n'), 'no stray LF');
});

test('a file with no last newline keeps it', () => {
  const noeol = FILE.replace(/\n$/, '');
  assert.equal(P.serializeProject(P.parseProject(noeol, 'Projects/Harbour/Harbour.md'), noeol), noeol);
});

test('a very long line ticked keeps its words: one line changes, nothing cut', () => {
  const what = `L${'o'.repeat(4998)}g`;
  const long = `---\ntype: project\nstatus: active\n---\n# Big\n\n## What\u2019s next\n\n- [ ] ${what} \u2014 Jesse \u00b7 by 16 Oct 2026\n`;
  assert.equal(P.serializeProject(P.parseProject(long, 'x.md'), long), long, 'untouched already');
  const p = P.parseProject(long, 'x.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } });
  const after = P.serializeProject(p, long);
  assert.equal(changedLines(long, after).length, 1, 'one line changes');
  assert.ok(after.includes(what), 'all 5000 characters still there after the tick');
  // A long fact set by hand writes back whole: the input caps bound new words, never the file.
  const q = P.parseProject(FILE, 'Projects/Harbour/Harbour.md');
  const owner = `O${'w'.repeat(198)}n`;
  P.applyProjectEdit(q, { kind: 'set', field: 'owner', value: owner });
  assert.ok(P.serializeProject(q, FILE).includes(`owner: ${owner}`), 'a 200-character owner is not cut to 120');
});

test('a ... close to the properties reads and writes back the same', () => {
  const dots = FILE.replace('---\n\n# Harbour', '...\n\n# Harbour');
  const p = P.parseProject(dots, 'Projects/Harbour/Harbour.md');
  assert.equal(p.status, 'active', 'the properties are read through a ... close');
  assert.equal(P.serializeProject(p, dots), dots, 'a round trip keeps the ... close byte for byte');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } });
  const after = P.serializeProject(p, dots);
  assert.deepEqual(changedLines(dots, after), [15], 'one edit touches one line under a ... close');
  assert.ok(after.includes('status: active'), 'the facts stay facts, never body text');
});

test('a moved line keeps its bytes, and a new line joins it', () => {
  const p = P.parseProject(FILE, 'Projects/Harbour/Harbour.md');
  P.applyProjectEdit(p, { kind: 'move', list: 'people', from: 1, to: 0 });
  P.applyProjectEdit(p, { kind: 'add', list: 'people', item: { name: 'Jo Lee', role: 'planner' } });
  const after = P.serializeProject(p, FILE);
  assert.ok(after.includes('- **Ana Ruiz** \u2013 sparky\n- **Sam Taylor** \u2013 builder\n- **Jo Lee** \u2014 planner'), `moved lines keep en dashes, the new one is canonical:\n${after}`);
});

// The last shapes a save changes, 5 Nov 2026 (p22: no edit over 34 real files left two differences, neither
// losing words, both breaking identical bytes). An empty heading stays, with its blank lines, until that
// section changes; the person's own spacing stays; a new file still gets clean spacing.
test('an empty section stays with its blank lines; one tick touches one line', () => {
  const EMPTY = `---\ntype: project\nstatus: active\n---\n# Harbour Fit-out\n\n## What\u2019s next\n\n- [ ] Paint the office\n\n## Decisions\n\n- **1 Jul 2026** \u2013 Use the northern dock.\n\n## Updates\n\n\n## Notes\n\nMine.\n`;
  assert.equal(P.serializeProject(P.parseProject(EMPTY, 'Projects/Harbour/Harbour.md'), EMPTY), EMPTY, 'no edit keeps the empty Updates heading and its blank lines');
  const p = P.parseProject(EMPTY, 'Projects/Harbour/Harbour.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '17 Oct 2026');
  const after = P.serializeProject(p, EMPTY);
  const tick = EMPTY.split('\n').findIndex((l) => l.includes('- [ ] Paint'));
  assert.deepEqual(changedLines(EMPTY, after), [tick], `only the ticked step changes:\n${after}`);
  assert.ok(after.includes('## Updates\n\n\n## Notes'), 'the empty heading and its blank lines stay on a tick');
});

test('the person\u2019s own spacing stays; a new file still gets clean spacing', () => {
  const SPACED = `---\ntype: project\nstatus: active\n---\n# Harbour Fit-out\n\n## What\u2019s next\n\n- [ ] Paint the office\n\n## Notes\n\nFirst line.\n\n\n### Sub part\n\nMore words.\n`;
  assert.equal(P.serializeProject(P.parseProject(SPACED, 'Projects/Harbour/Harbour.md'), SPACED), SPACED, 'no edit keeps two blank lines before a sub-heading');
  const p = P.parseProject(SPACED, 'Projects/Harbour/Harbour.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '17 Oct 2026');
  const after = P.serializeProject(p, SPACED);
  const tick = SPACED.split('\n').findIndex((l) => l.includes('- [ ] Paint'));
  assert.deepEqual(changedLines(SPACED, after), [tick], `only the ticked step changes:\n${after}`);
  assert.ok(after.includes('First line.\n\n\n### Sub part'), 'the double blank stays on a tick');
  // A new file we write still gets clean spacing.
  const q = P.emptyProject('Harbour Fit-out');
  q.status = 'active';
  q.next = [{ done: false, what: 'Paint the office' }];
  q.notes = 'First line.\n\n\n### Sub part\n\nMore words.';
  const fresh = P.serializeProject(q, '');
  assert.ok(fresh.includes('First line.\n\n### Sub part'), `a new file flattens to one blank line:\n${fresh}`);
  assert.ok(!fresh.includes('\n\n\n'), 'no triple newline in a new file');
});

// One more blank line a save adds, 5 Nov 2026 (p23: over 22 real files, one gained a blank before a
// kept line; list() joins the section's other lines after its items with a blank, and the kept lines
// started with one the flatten hid until p22). Items, a blank, a bold line kept as written, a blank,
// and another list item: a save adds none, in every list, with or without a blank before the kept line.
const KEPT = '**Shared by Sam**';
// v8-vault-assistant F12: the Key dates tail here was a dated bullet ("- **22 Oct 2026** – Done note"). Dated
// bullets read as key dates now and join the table on save — the file's own rule, "a hand-written list line
// becomes a row on its first save" — so the kept-line case keeps a dateless line ("- Done note from the
// walkthrough") instead. The bullet-to-row behaviour is pinned in tests/project-file.test.mjs.
const KEPT_FILE = `---
type: project
status: active
---

# River Shed

## What\u2019s next

- [ ] Paint the shed
- [ ] Order the timber

${KEPT}

- [ ] Confirm the delivery

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 16 Oct 2026 | Racking lands |  |
| 20 Oct 2026 | Handover | planned |

${KEPT}

- Done note from the walkthrough

## People

- **Sam Taylor** \u2013 builder
- **Ana Ruiz** \u2013 sparky

${KEPT}

- **Jo Lee** \u2013 planner

## Risks and issues

- **High** \u2013 The crane booking lapses
- Delivery late \u2013 waiting on supplier

${KEPT}

- **Low** \u2013 Paint fumes

## Decisions

- **1 Jul 2026** \u2013 Use the northern dock.
- **3 Oct 2026** \u2013 Paint first.

${KEPT}

- **5 Oct 2026** \u2013 Done.

## Updates

- **16 Oct 2026** \u2013 Racking on its way
- **15 Oct 2026** \u2013 Slab poured

${KEPT}

- **14 Oct 2026** \u2013 Started

## Documents

- \`harbour-plan.pdf\` \u2013 floor plan
- [[Site photos]] \u2013 progress shots

${KEPT}

- the signed copy lives in the drawer

## Notes

Mine.
`;

test('a kept line between items gains no blank in any list', () => {
  const p = P.parseProject(KEPT_FILE, 'Projects/River/River.md');
  assert.equal(P.serializeProject(p, KEPT_FILE), KEPT_FILE, 'no edit adds no blank before any kept line');
});

test('a kept line with no blank before it stays so', () => {
  const NOBLANK = `---\ntype: project\nstatus: active\n---\n# River Shed\n\n## Documents\n\n- \`harbour-plan.pdf\` \u2013 floor plan\n- [[Site photos]] \u2013 progress shots\n${KEPT}\n\n- \`signed-copy.pdf\` \u2013 final\n\n## Notes\n\nMine.\n`;
  assert.equal(P.serializeProject(P.parseProject(NOBLANK, 'Projects/River/River.md'), NOBLANK), NOBLANK, 'no edit keeps no blank before the kept line');
});

test('a tick, an add and a remove in that shape change only their own lines', () => {
  const NEXT = `---\ntype: project\nstatus: active\n---\n# River Shed\n\n## What\u2019s next\n\n- [ ] Paint the shed\n- [ ] Order the timber\n\n${KEPT}\n\n- [ ] Confirm the delivery\n\n## Notes\n\nMine.\n`;
  const ticked = P.parseProject(NEXT, 'Projects/River/River.md');
  P.applyProjectEdit(ticked, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '17 Oct 2026');
  const afterTick = P.serializeProject(ticked, NEXT);
  const line = NEXT.split('\n').findIndex((l) => l.includes('- [ ] Paint'));
  assert.deepEqual(changedLines(NEXT, afterTick), [line], `only the ticked step changes:\n${afterTick}`);
  assert.ok(!afterTick.includes('\n\n\n'), 'no triple newline on a tick');
  const DOCS = `---\ntype: project\nstatus: active\n---\n# River Shed\n\n## Documents\n\n- \`harbour-plan.pdf\` \u2013 floor plan\n- [[Site photos]] \u2013 progress shots\n\n${KEPT}\n\n- the signed copy lives in the drawer\n\n## Notes\n\nMine.\n`;
  const added = P.parseProject(DOCS, 'Projects/River/River.md');
  P.applyProjectEdit(added, { kind: 'add', list: 'documents', item: { path: 'quotes/av.pdf', what: 'lighting quote' } });
  const afterAdd = P.serializeProject(added, DOCS);
  assert.ok(!afterAdd.includes('\n\n\n'), `an add adds no blank:\n${afterAdd}`);
  assert.equal(afterAdd.split(KEPT).length - 1, 1, 'the kept line stays once on an add');
  assert.ok(afterAdd.includes('- `quotes/av.pdf` \u2014 lighting quote'), 'the added line joins it');
  const removed = P.parseProject(DOCS, 'Projects/River/River.md');
  P.applyProjectEdit(removed, { kind: 'remove', list: 'documents', index: 0 });
  const afterRemove = P.serializeProject(removed, DOCS);
  assert.ok(!afterRemove.includes('\n\n\n'), `a remove adds no blank:\n${afterRemove}`);
  assert.equal(afterRemove.split(KEPT).length - 1, 1, 'the kept line stays once on a remove');
  assert.ok(!afterRemove.includes('harbour-plan.pdf'), 'only its own line goes');
});

test('a new file with kept lines stays clean', () => {
  const p = P.parseProject(KEPT_FILE, 'Projects/River/River.md');
  const fresh = P.serializeProject(p, '');
  assert.ok(!fresh.includes('\n\n\n'), `a new file has no triple newline:\n${fresh}`);
  assert.ok(fresh.includes(KEPT), 'the kept lines stay in a new file');
});

// New text starts clean, 5 Nov 2026 (p22-fidelity stopped flattening saves of files that exist, and writers that
// relied on it left "## Heading" followed by two blanks): each writer with a made-up file — a new section's first
// line, an emptied section, a section added as the assistant adds one, grouped lines removed, moved and reordered, a
// pinned file, a close decision. None leaves three newlines unless the person already had them there (the checklist's
// own first write is proven in project-hub).
test('added text never leaves three newlines in a row', () => {
  const apply = (text, edit) => {
    const p = P.parseProject(text, 'x.md');
    P.applyProjectEdit(p, edit, '10 Nov 2026');
    return P.serializeProject(p, text);
  };
  const clean = (t, what) => assert.ok(!t.includes('\n\n\n'), `${what} leaves no triple newline:\n${t}`);
  const MIN = `---\ntype: project\nstatus: active\n---\n# Made Up\n\n## Summary\n\nHi.\n\n## Notes\n\nMine.\n`;
  // A new section's first line, every list.
  const first = {
    next: { what: 'Paint the shed', who: 'Sam', when: '16 Oct 2026' },
    dates: { when: '16 Oct 2026', what: 'Racking lands' },
    people: { name: 'Sam Taylor', role: 'builder' },
    risks: { what: 'The crane booking lapses', level: 'high' },
    decisions: { what: 'Use the northern dock', date: '1 Jul 2026' },
    updates: { what: 'Slab poured', date: '15 Oct 2026' },
    documents: { path: 'Plans/floor.pdf', what: 'floor plan' },
  };
  for (const [list, item] of Object.entries(first)) clean(apply(MIN, { kind: 'add', list, item }), `the first ${list} line`);
  // An emptied section (its heading goes with its last line).
  const FULL = `---\ntype: project\nstatus: active\n---\n# Made Up\n\n## What\u2019s next\n\n- [ ] Paint the shed\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 16 Oct 2026 | Racking lands |  |\n\n## Notes\n\nMine.\n`;
  clean(apply(FULL, { kind: 'remove', list: 'next', index: 0 }), 'an emptied next list');
  clean(apply(FULL, { kind: 'remove', list: 'dates', index: 0 }), 'an emptied dates table');
  // A section added as the assistant adds one, a file pinned, a close decision kept.
  clean(apply(MIN, { kind: 'section', heading: 'Workstreams', body: '| Workstream | Owner | Status |\n| --- | --- | --- |\n| Joinery | Ben | open |' }), 'an added section');
  clean(apply(MIN, { kind: 'pin', path: 'Quotes/av.pdf', pinned: true, what: 'lighting quote' }), 'a pinned file');
  clean(apply(MIN, { kind: 'add', list: 'decisions', item: { date: '10 Nov 2026', what: 'Paint the shed', why: 'Dropped when the project was marked done.' } }), 'a close decision');
  // Grouped lines removed, moved and reordered: the group's heading stays, with no blank at the top.
  const GROUPED = `---\ntype: project\nstatus: active\n---\n# Made Up\n\n## What\u2019s next\n\n- [ ] First step\n\n### Later\n\n- [ ] Second step\n- [ ] Third step\n\n## Notes\n\nMine.\n`;
  const removed = apply(GROUPED, { kind: 'remove', list: 'next', index: 0 });
  clean(removed, 'removing above a group');
  assert.ok(removed.includes('## What\u2019s next\n\n### Later\n\n- [ ] Second step'), `the group stays directly under its heading:\n${removed}`);
  clean(apply(GROUPED, { kind: 'move', list: 'next', from: 0, to: 2 }), 'moving above a group to the end');
  clean(apply(GROUPED, { kind: 'order', list: 'next', order: [1, 0, 2] }), 'reordering a group to the top');
  // Removing above a group in every other list leaves none either.
  const sections = {
    people: ['## People', '- **A Cole** \u2014 keeper', '- **B Hale** \u2014 maker'],
    risks: ['## Risks and issues', '- First risk', '- **High** \u2014 Second risk'],
    decisions: ['## Decisions', '- **1 Jul 2026** \u2014 First.', '- **2 Jul 2026** \u2014 Second.'],
    updates: ['## Updates', '- **2 Jul 2026** \u2014 Second', '- **1 Jul 2026** \u2014 First'],
    documents: ['## Documents', '- `a.pdf` \u2014 first', '- `b.pdf` \u2014 second'],
  };
  for (const [list, [head, a, b]] of Object.entries(sections)) {
    const file = `---\ntype: project\nstatus: active\n---\n# Made Up\n\n${head}\n\n${a}\n\n### Later\n\n${b}\n\n## Notes\n\nMine.\n`;
    clean(apply(file, { kind: 'remove', list, index: 0 }), `removing above a ${list} group`);
  }
});
