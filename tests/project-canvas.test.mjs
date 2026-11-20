// node --test tests/project-canvas.test.mjs — project canvases (src/shared/project-canvas.ts): a project's board laid out
// around it, cards bound to the project file (edits round-trip through the file's own format), new facts placed in
// their group without moving anything the person arranged, files dropped in copied under a free name, and the
// portfolio board's columns, moves and related projects.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-canvas-'));
let C, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/project-canvas.ts'), platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/shared/project-file.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const FILE = 'Projects/Studio Upgrade/Studio Upgrade.md';
const TEXT = `---
type: project
status: active
health: at risk
progress: 90
owner: Sam Taylor
folder: C:\\Work\\01 Studio upgrade
due: "2026-10-22"
---
# Studio Upgrade

## Summary

Every store's tills on the new build.

## What’s next

- [ ] Send the reconciliation v4 to finance — Sam · by 17 Oct
- [ ] Book the second wave for Sydney cafes — Priya
- [x] Export the device inventory

## Key dates

| When | What | Status |
| --- | --- | --- |
| 17 Oct 2026 | Finance sign-off | planned |
| 22 Oct 2026 | All stores upgraded | on track |

## People

- **Sam Taylor** — Project owner
- **Priya Shah** — Rollout lead, Sydney

## Risks and issues

- **High** — 11 spare tills can’t be reached remotely
- **Medium** — 5 tills under 30 GB free

## Documents

- \`Current/Store_Reconciliation_v4.docx\` — The reconciliation for finance
- \`Site photos/IMG_2041.jpg\` — The new counter

## Notes

Keep the outer cafes until last.
`;

const bound = (board, part, section) => board.nodes.filter((n) => n.neuralvault?.part === part && (!section || n.neuralvault.section === section));
const group = (board, section) => bound(board, 'group', section)[0];
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const within = (n, g) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;
const roundTrip = (board) => JSON.parse(JSON.stringify(board));

test('board columns read whole words: "offered" is not off track, "delivered" is done', () => {
  assert.equal(C.columnOf('health', { health: 'Offer extended' }), 'not set');
  assert.equal(C.columnOf('health', { health: 'Off track' }), 'off track');
  assert.equal(C.columnOf('status', { status: 'Delivered' }), 'done');
  assert.equal(C.columnOf('status', { status: 'Archived' }), 'done');
  assert.equal(C.columnOf('status', { status: 'Inactive' }), 'not set', '"inactive" is not "active"');
  assert.equal(C.columnOf('status', { status: 'Incomplete' }), 'not set', '"incomplete" is not "done"');
});

test('a project lays out around its card: every group, every fact in its group, nothing overlapping', () => {
  const p = P.parseProject(TEXT, FILE);
  const board = C.layoutProject(p, FILE);
  // Valid JSON Canvas: every node has its id, type, place and size; every line joins two nodes on the board.
  const ids = new Set(board.nodes.map((n) => n.id));
  assert.equal(ids.size, board.nodes.length);
  for (const n of board.nodes) for (const k of ['id', 'type', 'x', 'y', 'width', 'height']) assert.ok(n[k] !== undefined, `${k} on ${n.id}`);
  for (const e of board.edges) assert.ok(ids.has(e.fromNode) && ids.has(e.toNode));
  assert.equal(board.neuralvault.kind, 'project');
  const centre = bound(board, 'project')[0];
  assert.equal(centre.type, 'file');
  assert.equal(centre.file, FILE);
  for (const s of ['next', 'dates', 'risks', 'people', 'documents', 'notes']) {
    const g = group(board, s);
    assert.ok(g, s);
    assert.equal(g.type, 'group');
    assert.ok(!overlap(g, centre), `${s} clear of the project card`);
    assert.ok(board.edges.some((e) => e.fromNode === centre.id && e.toNode === g.id), `a line to ${s}`);
  }
  const groups = bound(board, 'group');
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) assert.ok(!overlap(groups[i], groups[j]), `${groups[i].label} / ${groups[j].label}`);
  assert.equal(bound(board, 'item', 'next').length, 3);
  assert.equal(bound(board, 'item', 'risks').length, 2);
  assert.equal(bound(board, 'item', 'documents').length, 2);
  for (const s of ['next', 'dates', 'risks', 'people', 'documents']) for (const n of bound(board, 'item', s)) assert.ok(within(n, group(board, s)), `${n.text} inside ${s}`);
  // Cards read as ordinary text in other readers: the project file's own lines.
  assert.equal(bound(board, 'item', 'next')[0].text, '- [ ] Send the reconciliation v4 to finance — Sam · by 17 Oct');
  assert.equal(bound(board, 'item', 'risks')[0].text, '**High** — 11 spare tills can’t be reached remotely');
  assert.equal(bound(board, 'notes')[0].text, 'Keep the outer cafes until last.');
  // A picture document is drawn taller (shown as the picture).
  const photo = bound(board, 'item', 'documents').find((n) => n.text.includes('IMG_2041'));
  assert.equal(photo.height, C.PICTURE_H);
  // The same project lays out the same way (ids included).
  assert.deepEqual(C.layoutProject(P.parseProject(TEXT, FILE), FILE), board);
  // Already in step.
  assert.equal(C.syncProject(roundTrip(board), p, FILE).changed, false);
});

test('lines between facts the file says refer to each other', () => {
  const p = P.parseProject(TEXT, FILE);
  const refs = C.references(p).map((r) => `${r.from.section}>${r.to.section}`);
  // Sam's step → Sam Taylor; Priya's step → Priya Shah; the reconciliation step → the reconciliation document; due 17 Oct → the 17 Oct key date.
  assert.equal(refs.filter((r) => r === 'next>people').length, 2);
  assert.ok(refs.includes('next>documents'));
  assert.ok(refs.includes('next>dates'));
  const board = C.layoutProject(p, FILE);
  const auto = board.edges.filter((e) => e.neuralvault?.auto === 'ref');
  assert.equal(auto.length, refs.length);
});

test('every kind of card round-trips through the project file’s own lines', () => {
  const p = P.parseProject(TEXT, FILE);
  for (const s of C.ITEM_SECTIONS) for (const item of p[s]) assert.deepEqual(C.parseItem(s, C.itemMarkdown(s, item)), item, `${s}: ${C.itemMarkdown(s, item)}`);
  // Edited words keep what the words don't hold (the tick, the level, the status, the path).
  const step = { done: true, what: 'Old', who: 'Sam' };
  assert.deepEqual(C.withWords('next', step, 'Send the list — Priya · by 24 Oct'), { done: true, what: 'Send the list', who: 'Priya', when: '24 Oct' });
  assert.deepEqual(C.withWords('risks', { level: 'high', what: 'x' }, 'Tills unreachable'), { level: 'high', what: 'Tills unreachable' });
  assert.deepEqual(C.withWords('dates', { when: '1 Nov', what: 'x', status: 'planned' }, '2 Nov — Freeze starts'), { when: '2 Nov', what: 'Freeze starts', status: 'planned' });
  assert.deepEqual(C.withWords('people', { name: 'A' }, 'Alex Lee — Chef'), { name: 'Alex Lee', role: 'Chef' });
  assert.deepEqual(C.withWords('documents', { path: 'a/b.pdf' }, 'The plan'), { path: 'a/b.pdf', what: 'The plan' });
  for (const s of C.ITEM_SECTIONS) for (const item of p[s]) assert.deepEqual(C.withWords(s, item, C.itemWords(s, item)), item, `words of ${s}`);
});

test('edits on bound cards write the project file, and the cards follow without moving', () => {
  const p = P.parseProject(TEXT, FILE);
  let board = C.layoutProject(p, FILE);
  // The person arranges things: moves a step and a risk, colours one, adds their own card and an arrow.
  const step = bound(board, 'item', 'next')[1];
  const risk = bound(board, 'item', 'risks')[1];
  board.nodes = board.nodes.map((n) => (n.id === step.id ? { ...n, x: n.x - 400, y: n.y + 33, color: '1' } : n.id === risk.id ? { ...n, x: n.x + 500 } : n));
  board.nodes.push({ id: 'mine', type: 'text', text: 'Ask about weekend work', x: 2000, y: 2000, width: 250, height: 60 });
  board.edges.push({ id: 'arrow', fromNode: 'mine', toNode: step.id });
  board = roundTrip(board);
  const before = new Map(board.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  // Tick the step, change the risk level, reword the step — each applied as the main process does.
  const b1 = step.neuralvault;
  C.applyItemEdit(p, { op: 'replace', section: 'next', key: b1.key, index: b1.index, item: { ...p.next[1], done: true } });
  const b2 = risk.neuralvault;
  C.applyItemEdit(p, { op: 'replace', section: 'risks', key: b2.key, index: b2.index, item: { ...p.risks[1], level: 'high' } });
  C.applyItemEdit(p, { op: 'replace', section: 'next', key: C.itemKey('next', p.next[0]), index: 0, item: C.withWords('next', p.next[0], 'Send the reconciliation v5 to finance — Sam · by 17 Oct') });
  C.applyItemEdit(p, { op: 'notes', text: 'Outer cafes last.\nQuiet week first.' });
  const written = P.serializeProject(p, TEXT);
  const again = P.parseProject(written, FILE);
  assert.equal(again.next[1].done, true);
  assert.equal(again.risks[1].level, 'high');
  assert.equal(again.next[0].what, 'Send the reconciliation v5 to finance');
  assert.equal(again.notes, 'Outer cafes last.\nQuiet week first.');
  assert.match(written, /- \[x\] Book the second wave for Sydney cafes — Priya/);
  assert.match(written, /\*\*High\*\* — 5 tills under 30 GB free/);

  const { board: next, changed } = C.syncProject(board, again, FILE);
  assert.ok(changed);
  for (const n of next.nodes) if (before.has(n.id)) assert.deepEqual({ x: n.x, y: n.y }, before.get(n.id), `${n.text ?? n.label ?? n.id} stayed put`);
  assert.equal(next.nodes.find((n) => n.id === step.id).text, '- [x] Book the second wave for Sydney cafes — Priya');
  assert.equal(next.nodes.find((n) => n.id === step.id).color, '1');
  assert.equal(next.nodes.find((n) => n.id === risk.id).text, '**High** — 5 tills under 30 GB free');
  // The reworded step kept its card (found by where it was) and now carries its new words.
  const reworded = bound(next, 'item', 'next').find((n) => n.text.includes('v5'));
  assert.equal(reworded.id, bound(board, 'item', 'next')[0].id);
  assert.equal(reworded.neuralvault.key, C.itemKey('next', again.next[0]));
  assert.equal(bound(next, 'notes')[0].text, 'Outer cafes last.\nQuiet week first.');
  // The person's own card and arrow are still there.
  assert.ok(next.nodes.some((n) => n.id === 'mine'));
  assert.ok(next.edges.some((e) => e.id === 'arrow'));
});

test('new facts go into their group, in a free place, and nothing already there moves', () => {
  const p = P.parseProject(TEXT, FILE);
  let board = roundTrip(C.layoutProject(p, FILE));
  const before = new Map(board.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.width, h: n.height }]));
  // The assistant adds a risk and a person, and a step.
  p.risks.push({ level: 'low', what: 'Holiday change freeze starts 1 Nov' });
  p.people.push({ name: 'Alex Lee', role: 'Finance' });
  p.next.push({ done: false, what: 'Confirm the freeze dates', who: 'Alex' });
  const { board: next } = C.syncProject(board, p, FILE);
  for (const n of next.nodes) {
    const was = before.get(n.id);
    if (!was || n.type === 'group') continue;
    assert.deepEqual({ x: n.x, y: n.y, w: n.width, h: n.height }, was, `${n.text} stayed put`);
  }
  const risks = group(next, 'risks');
  const added = bound(next, 'item', 'risks').find((n) => n.text.includes('freeze'));
  assert.ok(added, 'the new risk has a card');
  assert.ok(within(added, risks), 'inside Risks and issues');
  const cards = next.nodes.filter((n) => n.type !== 'group');
  for (const c of cards) if (c.id !== added.id) assert.ok(!overlap(c, added), `clear of ${c.text}`);
  // Groups only ever grow (still covering where they were), and never into another group or the name above it.
  const groupsNow = bound(next, 'group');
  for (const g of groupsNow) {
    const was = before.get(g.id);
    assert.ok(g.x <= was.x && g.y <= was.y && g.x + g.width >= was.x + was.w && g.y + g.height >= was.y + was.h, `${g.label} covers where it was`);
    for (const o of groupsNow) if (o !== g) assert.ok(!overlap({ ...g, height: g.height + 40 }, o), `${g.label} clear of ${o.label} and its name`);
  }
  // The new step for Alex is joined to Alex Lee.
  const alex = bound(next, 'item', 'people').find((n) => n.text.includes('Alex Lee'));
  const confirm = bound(next, 'item', 'next').find((n) => n.text.includes('Confirm the freeze'));
  assert.ok(next.edges.some((e) => e.fromNode === confirm.id && e.toNode === alex.id));

  // When the group is boxed in below, the new card goes in a new column on its right instead of running into it.
  let boxed = roundTrip(next);
  const people = group(boxed, 'people');
  const r = group(boxed, 'risks');
  boxed.nodes.push({ id: 'below', type: 'text', text: 'mine', x: people.x, y: people.y + people.height + 20, width: 300, height: 80 });
  boxed.nodes = boxed.nodes.filter((n) => n.id !== r.id);
  boxed.nodes.unshift({ ...r });
  p.people.push({ name: 'Jo Park', role: 'Cafe manager' });
  const { board: grown } = C.syncProject(boxed, p, FILE);
  const jo = bound(grown, 'item', 'people').find((n) => n.text.includes('Jo Park'));
  assert.ok(!overlap(jo, boxed.nodes.find((n) => n.id === 'below')), 'clear of the card below');
  assert.ok(within(jo, group(grown, 'people')));
});

test('facts gone from the project leave the board; a card taken off stays off', () => {
  const p = P.parseProject(TEXT, FILE);
  const board = roundTrip(C.layoutProject(p, FILE));
  p.risks.shift();
  const { board: next } = C.syncProject(board, p, FILE);
  assert.equal(bound(next, 'item', 'risks').length, 1);
  assert.match(bound(next, 'item', 'risks')[0].text, /5 tills/);
  // Taken off by the person (remembered on the board): not put back.
  const person = bound(next, 'item', 'people')[0];
  const off = { ...next, nodes: next.nodes.filter((n) => n.id !== person.id), neuralvault: { ...next.neuralvault, hidden: [C.hiddenKey(person.neuralvault)] } };
  const { board: after } = C.syncProject(off, p, FILE);
  assert.equal(bound(after, 'item', 'people').length, 1);
  assert.ok(!bound(after, 'item', 'people').some((n) => n.id === person.id));
});

test('edits that name a fact that is gone are refused; adds and removes', () => {
  const p = P.parseProject(TEXT, FILE);
  assert.throws(() => C.applyItemEdit(p, { op: 'replace', section: 'risks', key: 'nothing like it', index: 9, item: { what: 'x' } }), /isn’t in the project/);
  assert.throws(() => C.applyItemEdit(p, { op: 'set', section: 'summary' }), /isn’t one Ironleaf knows/);
  assert.throws(() => C.applyItemEdit(p, { op: 'replace', section: 'risks', key: C.itemKey('risks', p.risks[0]), index: 0, item: { what: '  ' } }), /without words/);
  C.applyItemEdit(p, { op: 'add', section: 'risks', item: { level: 'severe', what: 'New risk', extra: 'dropped' } });
  assert.deepEqual(p.risks.at(-1), { what: 'New risk' });
  C.applyItemEdit(p, { op: 'remove', section: 'risks', key: C.itemKey('risks', p.risks[0]), index: 0 });
  assert.equal(p.risks.length, 2);
});

test('a dropped file is copied under its own name, else a free one; never a path outside the folder', () => {
  assert.equal(C.copyTarget('Quote.pdf', []), 'Quote.pdf');
  assert.equal(C.copyTarget('Quote.pdf', ['quote.PDF']), 'Quote (2).pdf');
  assert.equal(C.copyTarget('Quote.pdf', ['Quote.pdf', 'Quote (2).pdf']), 'Quote (3).pdf');
  assert.equal(C.copyTarget('C:\\Users\\sam\\Desktop\\Plan.v2.xlsx', []), 'Plan.v2.xlsx');
  assert.equal(C.copyTarget('../../evil.txt', []), 'evil.txt');
  assert.equal(C.copyTarget('README', ['README']), 'README (2)');
  const card = C.fileCard('Site photo.jpg', { x: 10, y: 20 });
  assert.deepEqual(card.neuralvault, { part: 'file', rel: 'Site photo.jpg' });
  assert.equal(card.height, C.PICTURE_H);
  assert.equal(C.projectCanvasPath(FILE), 'Projects/Studio Upgrade/Studio Upgrade.canvas');
  assert.equal(C.portfolioPath(['02 Projects/A/A.md', '02 Projects/B/B.md']), '02 Projects/Portfolio board.canvas');
});

const entry = (name, props, body = '') => ({ path: `Projects/${name}/${name}.md`, project: P.parseProject(`---\ntype: project\n${props}\n---\n# ${name}\n\n${body}`, `Projects/${name}/${name}.md`) });

test('the portfolio board: columns by status or health, related projects joined, moves follow status', () => {
  const entries = [
    entry('Studio Upgrade', 'status: active\nhealth: at risk\nowner: Sam Taylor', '## People\n\n- **Priya Shah** — Rollout lead\n- **Finance team** — sign-off\n'),
    entry('Harbour Fit-out', 'status: planning\nhealth: on track\nowner: Priya Shah', '## Summary\n\nThe new office. Waits on the Studio Upgrade tills.\n'),
    entry('Winter Menu', 'status: active\nhealth: off track\nowner: Alex Lee', '## People\n\n- **Finance team** — budget\n'),
    entry('Supplier Review', 'status: closed\nhealth: on track'),
  ];
  const board = C.layoutPortfolio(entries, 'status');
  const cols = bound(board, 'column');
  assert.deepEqual(cols.map((c) => c.label), ['Idea', 'Planning', 'Active', 'On hold', 'Done']);
  const cardOf = (b, name) => b.nodes.find((n) => n.neuralvault?.part === 'portfolio-project' && n.neuralvault.project.includes(name));
  assert.equal(C.columnAt(board, cardOf(board, 'Studio Upgrade')), 'active');
  assert.equal(C.columnAt(board, cardOf(board, 'Winter Menu')), 'active');
  assert.equal(C.columnAt(board, cardOf(board, 'Supplier Review')), 'done');
  assert.equal(cardOf(board, 'Studio Upgrade').file, 'Projects/Studio Upgrade/Studio Upgrade.md');
  // Studio Upgrade and Harbour share Priya and one mentions the other; "Finance team" isn't a person they share.
  const rel = C.relations(entries);
  assert.equal(rel.length, 1);
  assert.deepEqual(rel[0].people, ['Priya Shah']);
  assert.equal(rel[0].mentions, true);
  assert.equal(board.edges.filter((e) => e.neuralvault?.auto === 'related').length, 1);
  assert.equal(board.edges[0].label, 'Priya Shah');

  // Status changed elsewhere: the card moves to its column; a card the person put outside the columns stays.
  const moved = roundTrip(board);
  const winter = cardOf(moved, 'Winter Menu');
  winter.x = -2000;
  entries[0].project.status = 'on hold';
  entries[2].project.status = 'done';
  const { board: next } = C.syncPortfolio(moved, entries);
  assert.equal(C.columnAt(next, cardOf(next, 'Studio Upgrade')), 'on hold');
  assert.equal(cardOf(next, 'Winter Menu').x, -2000);
  // By health; the person's own card stays.
  const withMine = { ...next, nodes: [...next.nodes, { id: 'mine', type: 'text', text: 'Board meeting 3 Nov', x: 0, y: -300, width: 260, height: 60 }] };
  const byHealth = C.layoutPortfolio(entries, 'health', withMine);
  assert.deepEqual(bound(byHealth, 'column').map((c) => c.label), ['On track', 'At risk', 'Off track']);
  assert.equal(C.columnAt(byHealth, cardOf(byHealth, 'Winter Menu')), 'off track');
  assert.ok(byHealth.nodes.some((n) => n.id === 'mine'));
  assert.equal(byHealth.neuralvault.groupBy, 'health');
  // A new project appears in its column without moving the rest; a project that's gone leaves.
  const before = new Map(byHealth.nodes.map((n) => [n.id, [n.x, n.y]]));
  const more = [...entries.slice(1), entry('Website Refresh', 'status: idea\nhealth: on track')];
  const { board: after } = C.syncPortfolio(roundTrip(byHealth), more);
  assert.ok(!cardOf(after, 'Studio Upgrade'));
  const web = cardOf(after, 'Website Refresh');
  assert.equal(C.columnAt(after, web), 'on track');
  for (const n of after.nodes) if (before.has(n.id) && n.type !== 'group') assert.deepEqual([n.x, n.y], before.get(n.id));
  for (const n of after.nodes) if (n.id !== web.id && n.type !== 'group') assert.ok(!overlap(n, web), `${n.file ?? n.text} clear of the new card`);
  assert.equal(C.columnValue('not set'), null);
  assert.equal(C.columnValue('on hold'), 'on hold');
});

test('the portfolio board: the column a card leaves closes up behind it, in the order its cards stood', () => {
  const entries = [
    entry('Alpha', 'status: active'),
    entry('Bravo', 'status: active'),
    entry('Charlie', 'status: active'),
    entry('Delta', 'status: planning'),
  ];
  const board = C.layoutPortfolio(entries, 'status');
  const cardOf = (nodes, name) => nodes.find((n) => n.neuralvault?.part === 'portfolio-project' && n.neuralvault.project.includes(name));
  const top = cardOf(board.nodes, 'Alpha').y;
  const third = cardOf(board.nodes, 'Charlie').y;
  // Alpha (the top one) is dragged to Planning: Bravo and Charlie move up, Delta (another column) stays.
  const planning = board.nodes.find((n) => n.neuralvault?.part === 'column' && n.neuralvault.key === 'planning');
  const moved = board.nodes.map((n) => (n === cardOf(board.nodes, 'Alpha') ? { ...n, x: planning.x + 24, y: planning.y + 400 } : n));
  const closed = C.closeUpColumn(moved, 'active');
  assert.equal(cardOf(closed, 'Bravo').y, top);
  assert.ok(cardOf(closed, 'Charlie').y < third);
  assert.deepEqual(cardOf(closed, 'Delta'), cardOf(moved, 'Delta'));
  assert.equal(cardOf(closed, 'Alpha').y, planning.y + 400, 'the moved card is the other column’s business');
});
