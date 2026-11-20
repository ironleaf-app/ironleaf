// node --test tests/project-edit.test.mjs — every fact on a project page changed by hand (src/shared/project-file.ts
// applyProjectEdit): each section's lines added, changed, moved and removed, written back and read again the same, and
// nothing the person wrote that the page doesn't understand is ever lost (paragraphs, sub-lists, their own properties,
// lists written one item a line).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-edit-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/project-file.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// A made-up bakery project, written partly by hand: a paragraph in What's next, a sub-list under a step, a note under a
// person, the person's own property, tags one a line, a section of their own.
const BAKERY = `---
type: project
status: active
health: at risk
progress: 40
owner: Mia Chen
colour: wheat
started: "2026-09-01"
due: "2026-11-20"
tags:
  - bakery
  - winter
---
# Winter Menu Launch

## Summary

Three soups and a new loaf for winter, on the menu by late November.

The website page goes live the same day.

## What’s next

These are for the kitchen team.

- [ ] Test the pumpkin soup — Mia · by 24 Oct
  - with the new stock
  - and less salt
- [ ] Order the rye flour — Sam
- [x] Choose the soups

## Key dates

| When | What | Status |
| --- | --- | --- |
| 1 Sep 2026 | Started | done |
| 20 Nov 2026 | Menu launch | — |

Dates may move with the supplier.

## People

- **Mia Chen** — Head baker
  Prefers mornings.
- **Sam Ortiz** — Buyer

## Risks and issues

- **High** — Rye flour supply is short
- **Low** — Soup bowls on back order *Closed:* 10 Oct 2026

## Decisions

- **3 Oct 2026** — Three soups, not four. *Why:* the kitchen is small

## Updates

- **14 Oct 2026** — Pumpkin soup tasted well. *From:* Tasting notes.docx

## Documents

- \`Menu/Winter menu v2.docx\` — The menu draft
- \`Costs.xlsx\`

## Notes

My own words, kept.

## Budget

A$2,400 for ingredients.
`;

test('an introduction above the Summary and headings over groups stay where they are on every change (24 Oct 2026)', () => {
  // above ## Summary, and their hub groups its steps under headings; every change on the page moved the first under
  // the Summary heading and the headings below all the steps.
  const text = '---\ntype: project\nstatus: active\nowner: Ana Ruiz\n---\n# Harbour Fit-out\n\nPart of [[Desk Hub]]. Files for this project are in the Files panel.\n\n## Summary\n\nFit-out of the harbour café.\n\n## What’s next\n\n### By Mon 26 Oct\n\n- [ ] Send the joinery quote — Sam · by Mon 26 Oct\n- [ ] Approve the lighting plan — Ana\n\n### This week and next\n\n- [ ] Book the electrician — Mia\n- [ ] Order the oak slab\n\n## Waiting on others\n\n| Who | What |\n|---|---|\n| Sam | Quote |\n\n## People\n\n- **Ana Ruiz** — Owner\n';
  const p = P.parseProject(text);
  assert.equal(p.intro, 'Part of [[Desk Hub]]. Files for this project are in the Files panel.');
  assert.equal(p.summary, 'Fit-out of the harbour café.');
  assert.equal(P.serializeProject(p, text), text, 'read and written back: byte for byte');
  const changes = [
    [{ kind: 'change', list: 'next', index: 1, item: { done: true } }, (t) => t.replace('- [ ] Approve the lighting plan', '- [x] Approve the lighting plan')],
    [{ kind: 'set', field: 'status', value: 'planning' }, (t) => t.replace('status: active', 'status: planning')],
    [{ kind: 'set', field: 'summary', value: 'Fit-out of the harbour café and bar.' }, (t) => t.replace('Fit-out of the harbour café.', 'Fit-out of the harbour café and bar.')],
    [{ kind: 'change', list: 'people', index: 0, item: { role: 'Owner and sponsor' } }, (t) => t.replace('— Owner\n', '— Owner and sponsor\n')],
  ];
  for (const [change, expect] of changes) {
    const q = P.parseProject(text);
    P.applyProjectEdit(q, change, '24 Oct 2026');
    assert.equal(P.serializeProject(q, text), expect(text), `only the part changed: ${JSON.stringify(change)}`);
  }
  // A step taken off: its group's heading stays, over the next step.
  const r = P.parseProject(text);
  P.applyProjectEdit(r, { kind: 'remove', list: 'next', index: 2 }, '24 Oct 2026');
  assert.equal(P.serializeProject(r, text), text.replace('- [ ] Book the electrician — Mia\n', ''));
  // A file with no Summary heading keeps its words where they are, with no heading added, and no empty Notes either.
  const plain = '---\ntype: project\n---\n# Launch\n\nIntro words.\n\n## What’s next\n\n- [ ] Book the venue\n';
  const s = P.parseProject(plain);
  P.applyProjectEdit(s, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '24 Oct 2026');
  assert.equal(P.serializeProject(s, plain), plain.replace('- [ ]', '- [x]'));
});

test('a hand-written project is read, and written back exactly as it was', () => {
  const p = P.parseProject(BAKERY, 'Projects/Winter Menu Launch/Winter Menu Launch.md');
  assert.deepEqual(p.tags, ['bakery', 'winter'], 'tags written one a line are read');
  assert.equal(p.next[0].more, '  - with the new stock\n  - and less salt', 'a sub-list stays with its step');
  assert.equal(p.next.length, 3, 'sub-items are not steps of their own');
  assert.equal(p.people[0].more, '  Prefers mornings.');
  assert.deepEqual(p.risks[1], { level: 'low', what: 'Soup bowls on back order', closed: true, closedOn: '10 Oct 2026' });
  assert.deepEqual(p.rest, { dates: 'Dates may move with the supplier.' });
  assert.equal(p.next[0].before, 'These are for the kitchen team.\n', 'a paragraph above the steps stays above them (24 Oct 2026)');
  const out = P.serializeProject(p, BAKERY);
  // Tags one a line stay one a line while they say the same things (4 Nov 2026: a save changes only what it touched).
  assert.equal(out, BAKERY);
  assert.equal(P.serializeProject(P.parseProject(out), out), out, 'and again: nothing changes');
});

/** Applies a change to the bakery file and reads the result back. */
function edit(change, text = BAKERY) {
  const p = P.parseProject(text);
  const words = P.applyProjectEdit(p, change, '17 Oct 2026');
  const out = P.serializeProject(p, text);
  return { words, out, back: P.parseProject(out) };
}

/** Everything the person wrote that isn't in the part changed stays (their property, paragraph, notes, own section). */
function kept(out) {
  for (const s of ['colour: wheat', 'These are for the kitchen team.', '  - with the new stock', '  Prefers mornings.', 'Dates may move with the supplier.', 'My own words, kept.', '## Budget\n\nA$2,400 for ingredients.']) assert.ok(out.includes(s), `kept: ${s}`);
}

test('the facts at the top: name, status, health, progress, owner, dates, tags, summary, notes', () => {
  const cases = [
    [{ kind: 'set', field: 'name', value: 'Winter Menu 2026' }, (b) => b.name === 'Winter Menu 2026', /Renamed the project to “Winter Menu 2026”/],
    [{ kind: 'set', field: 'status', value: 'on hold' }, (b) => b.status === 'on hold', /Set status to On hold/],
    [{ kind: 'set', field: 'health', value: 'on track' }, (b) => b.health === 'on track', /Set health to On track/],
    [{ kind: 'set', field: 'progress', value: 75 }, (b) => b.progress === 75, /75%/],
    [{ kind: 'set', field: 'progress', value: 140 }, (b) => b.progress === 100, /100%/],
    [{ kind: 'set', field: 'owner', value: 'Sam Ortiz' }, (b) => b.owner === 'Sam Ortiz', /owner/],
    [{ kind: 'set', field: 'owner', value: '' }, (b) => b.owner === undefined, /Cleared the owner/],
    [{ kind: 'set', field: 'started', value: '2026-09-03' }, (b) => b.started === '2026-09-03', /start date/],
    [{ kind: 'set', field: 'due', value: '2026-12-01' }, (b) => b.due === '2026-12-01', /due date/],
    [{ kind: 'tags', tags: ['bakery', '#Soup', 'bakery', 'a,b'] }, (b) => b.tags.join('|') === 'bakery|Soup|a b', /tags/],
    [{ kind: 'set', field: 'summary', value: 'One line now.\n\nAnd a second paragraph.' }, (b) => b.summary === 'One line now.\n\nAnd a second paragraph.', /summary/],
    [{ kind: 'set', field: 'notes', value: 'New notes.\n- a list' }, (b) => b.notes === 'New notes.\n- a list', /notes/],
    [{ kind: 'extra', index: 0, body: 'A$3,000 now.' }, (b) => b.extra[0].body === 'A$3,000 now.', /“Budget”/],
  ];
  for (const [change, check, words] of cases) {
    const { words: said, out, back } = edit(change);
    assert.ok(check(back), `${JSON.stringify(change)} → ${out}`);
    assert.match(said, words);
    if (change.field !== 'notes' && change.kind !== 'extra') kept(out);
  }
  assert.throws(() => edit({ kind: 'set', field: 'name', value: '  ' }), /needs a name/);
  assert.throws(() => edit({ kind: 'set', field: 'folder', value: 'C:\\x' }), /isn’t one Ironleaf knows/, 'the folder is not changed from the page');
});

test('a project name past 120 letters fits to leading words, said aloud', () => {
  const long = 'Winter menu launch for Wiremu Te Rangi-Fitzgerald & Associates across the northern region with tastings every Friday until Christmas';
  assert.ok(long.length > 120, 'the typed name runs past the cap');
  const { words, back } = edit({ kind: 'set', field: 'name', value: long });
  assert.ok(back.name.length <= 120, `fitted to ${back.name.length} letters`);
  assert.ok(long.startsWith(back.name) && long[back.name.length] === ' ', 'leading words, never mid-word');
  assert.match(words, /That name was shortened to fit\./, 'the cut is said, never silent');
  const kept = 'C# & Q&A planning: Mia’s “fresh” menu (v2)';
  const whole = edit({ kind: 'set', field: 'name', value: kept });
  assert.equal(whole.back.name, kept, 'a short name keeps every character');
  assert.doesNotMatch(whole.words, /shortened/, 'nothing said when nothing cut');
});

test('every list: add, change, move, remove — read back the same', () => {
  const lists = {
    next: [{ what: 'Book the photographer', who: 'Mia', when: '30 Oct 2026' }, { who: 'Sam' }, (b, i) => b.next[i].who === 'Sam'],
    dates: [{ when: '5 Nov 2026', what: 'Tasting day', status: 'planned' }, { status: 'done' }, (b, i) => b.dates[i].status === 'done'],
    people: [{ name: 'Lee Park', role: 'Photographer' }, { role: 'Food photographer' }, (b, i) => b.people[i].role === 'Food photographer'],
    risks: [{ what: 'Oven repairs', level: 'Medium' }, { level: 'high' }, (b, i) => b.risks[i].level === 'high'],
    decisions: [{ date: '17 Oct 2026', what: 'Launch on a Thursday', why: 'markets are on Fridays' }, { why: 'quieter' }, (b, i) => b.decisions[i].why === 'quieter'],
    updates: [{ what: 'Rye flour ordered', from: 'Order 1182.pdf' }, { what: 'Rye flour ordered (50 kg)' }, (b, i) => b.updates[i].what === 'Rye flour ordered (50 kg)'],
    documents: [{ path: 'Photos/Soup 1.jpg', what: 'Hero picture' }, { what: 'The hero picture' }, (b, i) => b.documents[i].what === 'The hero picture'],
  };
  for (const [list, [item, change, check]] of Object.entries(lists)) {
    const added = edit({ kind: 'add', list, item });
    kept(added.out);
    const i = list === 'updates' ? 0 : added.back[list].length - 1;
    // (a decision is written as a sentence: it gains its full stop)
    for (const [k, v] of Object.entries(item)) assert.equal(added.back[list][i][k], k === 'level' ? v.toLowerCase() : list === 'decisions' && k === 'what' ? `${v}.` : v, `${list}.${k} added`);
    const changed = edit({ kind: 'change', list, index: i, item: change }, added.out);
    assert.ok(check(changed.back, i), `${list} changed: ${changed.out}`);
    kept(changed.out);
    const moved = edit({ kind: 'move', list, from: i, to: 0 }, changed.out);
    // (lines written above the top line, a paragraph or a group's heading, stay at the top: the moved line goes under them)
    const { before: _above, ...top } = moved.back[list][0];
    if (i !== 0) assert.deepEqual(top, changed.back[list][i], `${list} moved to the top`);
    if (i !== 0) assert.equal(_above, changed.back[list][0].before, `${list}: what was above the top line is still there`);
    const removed = edit({ kind: 'remove', list, index: 0 }, moved.out);
    assert.equal(removed.back[list].length, changed.back[list].length - 1, `${list} removed`);
    kept(removed.out);
  }
});

test('moving a step down takes the heading where it lands, not the next one’s (9.5 fourth pass)', () => {
  const text = '---\ntype: project\n---\n# Shop\n\n## What’s next\n\nKitchen\n\n- [ ] A step\n\nCounter\n\n- [ ] B step\n\nTables\n\n- [ ] C step\n\nFloor\n\n- [ ] D step\n';
  const moved = edit({ kind: 'move', list: 'next', from: 0, to: 2 }, text);
  assert.deepEqual(moved.back.next.map((n) => n.what), ['B step', 'C step', 'A step', 'D step']);
  assert.equal(moved.back.next[2].before?.trim(), 'Tables', 'A takes C’s heading, where it lands');
  assert.equal(moved.back.next[1].before, undefined, 'C is bare under B’s group');
  assert.equal(moved.back.next[3].before?.trim(), 'Floor', 'D keeps its own');
  assert.match(moved.back.next[0].before ?? '', /Kitchen/, 'B keeps the heading A left');
  assert.match(moved.back.next[0].before ?? '', /Counter/, 'and its own');
});

test('steps tick off and come back; risks close and reopen; a step keeps its sub-list through every change', () => {
  const ticked = edit({ kind: 'change', list: 'next', index: 0, item: { done: true } });
  assert.equal(ticked.back.next[0].done, true);
  assert.match(ticked.words, /Ticked off “Test the pumpkin soup”/);
  assert.equal(ticked.back.next[0].more, '  - with the new stock\n  - and less salt');
  const reworded = edit({ kind: 'change', list: 'next', index: 0, item: { what: 'Test the pumpkin soup again', when: null } }, ticked.out);
  assert.deepEqual(reworded.back.next[0], { done: true, what: 'Test the pumpkin soup again', who: 'Mia', more: '  - with the new stock\n  - and less salt', before: 'These are for the kitchen team.\n' });
  assert.throws(() => edit({ kind: 'change', list: 'next', index: 0, item: { what: '' } }), /can’t be empty/);
  assert.throws(() => edit({ kind: 'remove', list: 'risks', index: 9 }), /isn’t in the project any more/);
  const closed = edit({ kind: 'change', list: 'risks', index: 0, item: { closed: true } });
  assert.deepEqual(closed.back.risks[0], { level: 'high', what: 'Rye flour supply is short', closed: true, closedOn: '17 Oct 2026' });
  assert.match(closed.out, /- \*\*High\*\* — Rye flour supply is short \*Closed:\* 17 Oct 2026/);
  assert.match(closed.words, /Closed a risk/);
  const reopened = edit({ kind: 'change', list: 'risks', index: 1, item: { closed: false } });
  assert.deepEqual(reopened.back.risks[1], { level: 'low', what: 'Soup bowls on back order' });
  assert.match(reopened.words, /Reopened/);
  // An update without a date is dated today; a removed line can be put back where it was.
  const update = edit({ kind: 'add', list: 'updates', item: { what: 'Soup bowls arrived' } });
  assert.deepEqual(update.back.updates[0], { date: '17 Oct 2026', what: 'Soup bowls arrived' });
  const putBack = edit({ kind: 'add', list: 'people', item: { name: 'Mia Chen', role: 'Head baker' }, at: 0 }, edit({ kind: 'remove', list: 'people', index: 0 }).out);
  assert.equal(putBack.back.people[0].name, 'Mia Chen');
});

test('documents: pinned, unpinned and described by their path in the folder', () => {
  const pinned = edit({ kind: 'pin', path: 'Photos\\Soup 2.jpg', pinned: true });
  assert.deepEqual(pinned.back.documents.at(-1), { path: 'Photos/Soup 2.jpg' });
  assert.match(pinned.words, /Pinned “Soup 2\.jpg”/);
  assert.match(edit({ kind: 'pin', path: 'costs.xlsx', pinned: true }).words, /pinned already/);
  const unpinned = edit({ kind: 'pin', path: 'menu/winter menu v2.docx', pinned: false });
  assert.deepEqual(unpinned.back.documents, [{ path: 'Costs.xlsx' }]);
  const described = edit({ kind: 'describe', path: 'Costs.xlsx', what: 'What each soup costs to make' });
  assert.equal(described.back.documents[1].what, 'What each soup costs to make');
  const cleared = edit({ kind: 'describe', path: 'Menu/Winter menu v2.docx', what: '' });
  assert.deepEqual(cleared.back.documents[0], { path: 'Menu/Winter menu v2.docx' });
  const newOne = edit({ kind: 'describe', path: 'Supplier list.pdf', what: 'Who supplies what' });
  assert.deepEqual(newOne.back.documents.at(-1), { path: 'Supplier list.pdf', what: 'Who supplies what' });
  assert.match(newOne.words, /Described and pinned/);
});

test('the older changes still work, and a file’s fingerprint follows its text', () => {
  assert.equal(edit({ kind: 'next-toggle', index: 1 }).back.next[1].done, true);
  assert.equal(edit({ kind: 'next-add', text: 'Print the menus' }).back.next.at(-1).what, 'Print the menus');
  assert.equal(edit({ kind: 'update-add', text: 'Menus printed' }).back.updates[0].what, 'Menus printed');
  assert.throws(() => edit({ kind: 'explode' }), /isn’t one Ironleaf knows/);
  assert.equal(P.textVersion(BAKERY), P.textVersion(String(BAKERY)));
  assert.notEqual(P.textVersion(BAKERY), P.textVersion(BAKERY + ' '));
});
