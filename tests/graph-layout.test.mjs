// node --test tests/graph-layout.test.mjs — the card map as pure maths (src/shared/graph-layout.ts): the Map groups
// projects under their areas busiest first and leaves Daily/Templates out, shared-people links between projects
// are found both ways, and the Focus view groups an item's neighbours into its columns with the cut at 6.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-graph-layout-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/graph-layout.ts'), platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const gn = (id, title, extra = {}) => ({ id, title, kind: 'note', tags: [], ...extra });
const TODAY = Math.round(Date.UTC(2026, 9, 29) / 86400000);

test('health reads whole words, and what it cannot read stays neutral', () => {
  assert.equal(L.healthTone('Offer extended'), 'none', '"offer" is not "off track"');
  assert.equal(L.healthTone('Delivered'), 'ok', '"delivered" is done, never "red" (one standing, 8 Nov 2026)');
  assert.equal(L.healthTone('Off track'), 'bad');
  assert.equal(L.healthWord('Offer extended', '2026-11-02', Math.floor(new Date(2026, 9, 29).getTime() / 86400000)), 'Active', 'what no list reads says Active, like the Projects page');
});

test('the Map: projects under their areas, busiest first, Daily and Templates left out', () => {
  const big = 'Work/Projects/Big/Big.md';
  const nodes = [
    gn(big, 'Big', { project: true, health: 'at risk', due: '2026-11-01' }),
    gn('Work/Projects/Big/People/Ana.md', 'Ana Lee'),
    gn('Work/Projects/Big/Meetings/Kickoff.md', 'Kickoff'),
    gn('Work/Projects/Big/Notes/Plan.md', 'Plan'),
    gn('Work/Projects/Big/Notes/Budget.md', 'Budget'),
    gn('Work/Projects/Small/Small.md', 'Small', { project: true, health: 'on track' }),
    gn('Business/Projects/Shop/Shop.md', 'Shop', { project: true }),
    gn('Home/Projects/Garden/Garden.md', 'Garden', { project: true }),
    gn('Me/Projects/CV/CV.md', 'CV', { project: true }),
    gn('Zebra/Projects/Stripes/Stripes.md', 'Stripes', { project: true }),
    gn('Daily/Projects/Log/Log.md', 'Log', { project: true }),
    gn('Templates/Projects/Blank/Blank.md', 'Blank', { project: true }),
    gn('Work/Notes/Loose.md', 'Loose'),
    gn('Daily/2026-10-29.md', 'Today'),
  ];
  const map = L.buildMap(nodes, [], TODAY);
  assert.deepEqual(map.map((c) => c.area), ['Work', 'Business', 'Home', 'Me', 'Zebra'], 'Work, Business, Home, Me, then any other area');
  const workCol = map[0];
  assert.deepEqual(workCol.projects.map((p) => p.title), ['Big', 'Small'], 'busiest first');
  assert.deepEqual(workCol.projects[0].counts, { people: 1, meetings: 1, notes: 2, total: 4 });
  assert.equal(workCol.projects[0].healthWord, 'At risk');
  assert.equal(workCol.projects[0].dueWords, 'Due in 3 days');
  assert.equal(workCol.projects[1].healthWord, 'On track');
  assert.equal(workCol.loose, 1, 'the loose Work note is counted, not carded');
  assert.equal(workCol.counts.projects, 2);
  assert.ok(!map.some((c) => ['Daily', 'Templates'].includes(c.area)), 'no Daily or Templates column');
  assert.ok(!map.flatMap((c) => c.projects).some((p) => ['Log', 'Blank'].includes(p.title)), 'no Daily or Templates project card');
});

test('the Map cut: more than 8 projects in an area keeps the busiest 8 first for the page to show', () => {
  const nodes = [];
  for (let i = 0; i < 10; i++) {
    const p = `Work/Projects/P${i}/P${i}.md`;
    nodes.push(gn(p, `P${i}`, { project: true }));
    for (let j = 0; j < i; j++) nodes.push(gn(`Work/Projects/P${i}/Notes/N${j}.md`, `N${j}`));
  }
  const [workCol] = L.buildMap(nodes, [], TODAY);
  assert.equal(workCol.projects.length, 10);
  assert.equal(workCol.projects[0].title, 'P9');
  assert.deepEqual(workCol.projects.slice(0, L.MAP_SHOW).length, 8, 'the page shows 8, then Show 2 more');
  assert.equal(L.MAP_SHOW, 8);
});

test('shared people and links between projects are found both ways', () => {
  const a = 'Work/Projects/A/A.md'; const b = 'Work/Projects/B/B.md'; const c = 'Work/Projects/C/C.md';
  const nodes = [gn(a, 'A', { project: true }), gn(b, 'B', { project: true }), gn(c, 'C', { project: true }), gn('People/Ana.md', 'Ana Lee')];
  const links = [
    { source: a, target: 'People/Ana.md', kind: 'link' },
    { source: b, target: 'People/Ana.md', kind: 'link' },
    { source: a, target: c, kind: 'people', kinds: ['people'], reasons: ['Both have Ben Fox and Ana Lee'] },
    { source: c, target: b, kind: 'link', kinds: ['link'], reasons: [] },
  ];
  const shared = L.sharedProjectLinks(nodes, links);
  const fromA = L.sharedWith(a, shared);
  const fromB = L.sharedWith(b, shared);
  const fromC = L.sharedWith(c, shared);
  assert.deepEqual(fromA.find((x) => x.id === b)?.people, ['Ana Lee'], 'A and B share Ana, through her own note');
  assert.deepEqual(fromB.find((x) => x.id === a)?.people, ['Ana Lee'], 'the same from B: both ways');
  assert.deepEqual(fromA.find((x) => x.id === c)?.people, ['Ana Lee', 'Ben Fox'], 'names out of the Both have reason, sorted');
  assert.deepEqual(fromC.find((x) => x.id === a)?.people, ['Ana Lee', 'Ben Fox'], 'the same from C');
  assert.ok(fromB.some((x) => x.id === c) && fromC.some((x) => x.id === b), 'a plain link between projects counts, either direction');
  assert.equal(new Set(shared.map((p) => `${p.a}\0${p.b}`)).size, shared.length, 'no pair twice');
});

test('the Focus view: neighbours grouped into the named columns, meetings upcoming first, cut at 6', () => {
  const centre = 'Work/Projects/Harbour/Harbour.md';
  const nodes = [gn(centre, 'Harbour', { project: true, health: 'on track', due: '2026-11-12' })];
  const links = [];
  for (let i = 0; i < 9; i++) { const id = `Notes/N${i}.md`; nodes.push(gn(id, `Note ${i}`)); links.push({ source: centre, target: id }); }
  for (let i = 0; i < 7; i++) { const id = `People/P${i}.md`; nodes.push(gn(id, `Person ${i}`, { role: 'Builder', org: 'Acme' })); links.push({ source: centre, target: id }); }
  const meetings = [['Meetings/Past.md', 'Past', '2026-10-20'], ['Meetings/Soon.md', 'Soon', '2026-11-05'], ['Meetings/Next.md', 'Next', '2026-11-01']];
  for (const [id, title, date] of meetings) { nodes.push(gn(id, title, { date })); links.push({ source: centre, target: id }); }
  nodes.push(gn('Notes/Decision.md', 'Go with steel', { tags: ['decision'] })); links.push({ source: centre, target: 'Notes/Decision.md' });
  nodes.push(gn('Files/quote.pdf', 'quote.pdf', { kind: 'file' })); links.push({ source: centre, target: 'Files/quote.pdf' });
  nodes.push(gn('Work/Projects/Other/Other.md', 'Other', { project: true })); links.push({ source: centre, target: 'Work/Projects/Other/Other.md' });
  const cols = L.focusColumns(nodes, links, centre, { today: TODAY });
  assert.deepEqual(cols.map((c) => c.label), ['People', 'Meetings', 'Notes', 'Decisions', 'Files', 'Related projects']);
  const people = cols.find((c) => c.id === 'people'); const notes = cols.find((c) => c.id === 'notes'); const mtg = cols.find((c) => c.id === 'meetings');
  assert.equal(people.visible.length, 6); assert.equal(people.more, 1, 'the seventh person waits behind Show 1 more');
  assert.equal(notes.visible.length, 6); assert.equal(notes.more, 3);
  assert.equal(L.FOCUS_SHOW, 6);
  assert.deepEqual(mtg.nodes.map((n) => n.title), ['Next', 'Soon', 'Past'], 'upcoming first, soonest first, then past');
  assert.equal(L.cardDetail(people.visible[0]), 'Builder · Acme');
  assert.equal(L.kindWord(nodes[0]), 'Project');
  assert.deepEqual(L.focusColumns(nodes, links, 'Missing.md'), []);
});

test('round 2 counts: the card counts are the Focus view’s neighbours, for a project with people and meetings', () => {
  const centre = 'Work/Projects/Harbour/Harbour.md';
  const nodes = [gn(centre, 'Harbour', { project: true })];
  const links = [];
  for (const [id, title] of [['People/Ana.md', 'Ana Lee'], ['People/Ben.md', 'Ben Fox'], ['People/Cy.md', 'Cy Kim']]) { nodes.push(gn(id, title)); links.push({ source: centre, target: id }); }
  nodes.push(gn('Meetings/Kickoff.md', 'Kickoff', { date: '2026-11-01' })); links.push({ source: centre, target: 'Meetings/Kickoff.md' });
  nodes.push(gn('Meetings/Review.md', 'Review', { date: '2026-11-03' })); links.push({ source: 'People/Ana.md', target: 'Meetings/Review.md' });
  nodes.push(gn('Notes/Plan.md', 'Plan')); links.push({ source: centre, target: 'Notes/Plan.md' });
  nodes.push(gn('Work/Projects/Harbour/Notes/Own.md', 'Own note'));
  const counts = L.projectCounts(centre, nodes, links);
  const cols = L.focusColumns(nodes, links, centre, { today: TODAY });
  const byId = Object.fromEntries(cols.map((c) => [c.id, c.nodes.length]));
  // A card counts the project's own (direct) neighbours; the Focus view also shows the second level (29 Oct 2026: two levels
  // out, most projects showed the same counts). Review is Ana's meeting, so it is in the Focus view but not the count.
  const direct = Object.fromEntries(cols.map((c) => [c.id, c.nodes.filter((n) => n.depth !== 2).length]));
  assert.equal(counts.people, 3); assert.equal(counts.meetings, 1); assert.equal(byId.meetings, 2);
  assert.equal(counts.people, direct.people, 'card people = the Focus view\'s direct people');
  assert.equal(counts.meetings, direct.meetings, 'card meetings = the Focus view\'s direct meetings');
  assert.equal(counts.notes, (byId.notes ?? 0) + (byId.decisions ?? 0), 'card notes = Focus notes and decisions');
  assert.equal(counts.notes, 2, 'the linked note and the project’s own unlinked note');
  assert.equal(counts.total, cols.reduce((n, c) => n + c.nodes.filter((x) => x.depth !== 2).length, 0), 'card total = every direct Focus neighbour');
  const [work] = L.buildMap(nodes, links, TODAY);
  assert.deepEqual(work.projects[0].counts, counts, 'the Map card carries the same counts');
});

test('round 2 columns: only areas with a project; loose top-level projects in Not in an area', () => {
  const nodes = [
    gn('Work/Projects/Big/Big.md', 'Big', { project: true }),
    gn('Projects/Solo/Solo.md', 'Solo', { project: true }),
    gn('Publications/Issues/One.md', 'One'),
    gn('Views/Board.md', 'Board'),
    gn('Publications/Notes/Draft.md', 'Draft'),
  ];
  const map = L.buildMap(nodes, [], TODAY);
  assert.deepEqual(map.map((c) => c.area), ['Work', 'Not in an area'], 'no Publications or Views column; top-level projects last');
  assert.ok(!map.some((c) => c.area === 'Notes at the top'), 'never Notes at the top');
  assert.equal(L.NO_AREA, 'Not in an area');
});

test('round 2 card words: no HTML comment, mark or raw link in a summary', () => {
  const n = gn('Notes/X.md', 'X', { summary: '<!-- the host app keeps the part below up to date --> **Big** [plan](https://example.com/x) https://example.com/y' });
  const words = L.cardDetail(n);
  assert.equal(words, 'Big plan');
  assert.ok(!/<!--|\*\*|https?:/.test(words), words);
  assert.equal(L.cardDetail(gn('Notes/Y.md', 'Y', { summary: '<!-- only a comment -->' })), 'Notes', 'a comment alone leaves the plain fallback');
  assert.equal(L.rectVisible({ x: 0, y: 900, w: 10, h: 10 }, { x: 0, y: 0, w: 800, h: 600 }), false, 'below the fold is not visible');
  assert.equal(L.rectVisible({ x: 0, y: 590, w: 10, h: 20 }, { x: 0, y: 0, w: 800, h: 600 }), true, 'partly on screen is visible');
});

test("card words and the breadcrumb: health in the one standing's words, due in words, last five centres", () => {
  assert.equal(L.healthWord('on track'), 'On track');
  assert.equal(L.healthWord('off track'), 'Off track', 'off track reads Off track, like the Projects page — never the old collapsed At risk');
  assert.equal(L.healthWord(''), 'Active');
  assert.equal(L.dueWords('2026-10-29', TODAY), 'Due today');
  assert.equal(L.dueWords('2026-10-27', TODAY), '2 days overdue');
  assert.equal(L.dueWords('2026-12-25', TODAY), 'Due 25 Dec');
  let h = [];
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) h = L.pushCentre(h, id);
  assert.deepEqual(h, ['B', 'C', 'D', 'E', 'F'], 'only the last five centres are kept');
  assert.deepEqual(L.pushCentre(h, 'D'), ['B', 'C', 'D'], 'going back drops the centres after it');
  const d = L.cardLinkPath({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 80, w: 100, h: 40 });
  assert.ok(d.startsWith('M 100 20 C ') && d.endsWith(', 300 100'), `a curve out of one facing edge into the other: ${d}`);
});
