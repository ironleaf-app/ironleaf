// node --test tests/graph-scope.test.mjs — the graph's tag and folder filters (src/shared/graph-scope.ts): what there is
// to choose from, which dots stay once some are chosen (a tag takes in the tags under it), and names fading in with zoom.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-graph-scope-'));
let G;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/graph-scope.ts'), platform: 'node', output: { file: path.join(work, 'g.mjs'), format: 'esm' }, logLevel: 'silent' });
  G = await import(pathToFileURL(path.join(work, 'g.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const n = (id, tags = [], kind = 'note') => ({ id, kind, tags });
const nodes = [n('Work/A.md', ['work', 'work/clients']), n('Work/B.md', ['work']), n('Home/C.md', ['garden']), n('D.md'), n('tag:work', [], 'tag'), n('Work/pic.png', [], 'file'), n('Nowhere', [], 'missing')];

test('choices: top folders and tags of notes, most notes first', () => {
  assert.deepEqual(G.folderChoices(nodes), [{ folder: 'Work', count: 2 }, { folder: '', count: 1 }, { folder: 'Home', count: 1 }]);
  assert.deepEqual(G.tagChoices(nodes), [{ tag: 'work', count: 2 }, { tag: 'garden', count: 1 }, { tag: 'work/clients', count: 1 }]);
});

test('nothing chosen: every dot stays', () => {
  for (const x of nodes) assert.equal(G.inScope(x, { folders: [], tags: [] }), true, x.id);
});

test('folders: notes and files in a chosen folder; the top of the notes is its own choice; not-written notes go', () => {
  const s = { folders: ['Work', ''], tags: [] };
  assert.deepEqual(nodes.filter((x) => G.inScope(x, s)).map((x) => x.id), ['Work/A.md', 'Work/B.md', 'D.md', 'tag:work', 'Work/pic.png']);
});

test('tags: a chosen tag takes in the tags under it; a tag’s own dot stays only when chosen', () => {
  assert.deepEqual(nodes.filter((x) => G.inScope(x, { folders: [], tags: ['Work'] })).map((x) => x.id), ['Work/A.md', 'Work/B.md', 'tag:work', 'Work/pic.png']);
  assert.deepEqual(nodes.filter((x) => G.inScope(x, { folders: [], tags: ['work/clients'] })).map((x) => x.id), ['Work/A.md', 'Work/pic.png']);
});

test('names fade in with zoom: none below the threshold, all a little above, easing between, always-shown ones at full', () => {
  assert.equal(G.labelAlpha(0.5, 1), 0);
  assert.equal(G.labelAlpha(1.5, 1), 1);
  const mid = G.labelAlpha(1.05, 1);
  assert.ok(mid > 0 && mid < 1, `${mid}`);
  assert.ok(G.labelAlpha(1.1, 1) > mid);
  assert.equal(G.labelAlpha(0.1, 1, true), 1);
});

test('focus groups: two levels around a centre, labelled, the person themselves never a hub', () => {
  const gn = [
    { id: 'P/Harbour.md', title: 'Harbour', kind: 'note', project: true, tags: [] },
    { id: 'People/Priya.md', title: 'Priya Shah', kind: 'note', tags: [] },
    { id: 'People/Me.md', title: 'Me Myself', kind: 'note', tags: [] },
    { id: 'Meetings/Kickoff.md', title: 'Kickoff', kind: 'note', tags: [] },
    { id: 'Notes/Decision.md', title: 'Go with steel', kind: 'note', tags: ['decision'] },
    { id: 'Files/quote.pdf', title: 'quote.pdf', kind: 'file', tags: [] },
    { id: 'Notes/Far.md', title: 'Far away', kind: 'note', tags: [] },
    { id: 'Notes/Close.md', title: 'Close note', kind: 'note', tags: [] },
  ];
  const links = [
    { source: 'P/Harbour.md', target: 'People/Priya.md' },
    { source: 'P/Harbour.md', target: 'People/Me.md' },
    { source: 'People/Priya.md', target: 'Meetings/Kickoff.md' },
    { source: 'P/Harbour.md', target: 'Notes/Decision.md' },
    { source: 'P/Harbour.md', target: 'Files/quote.pdf' },
    { source: 'Meetings/Kickoff.md', target: 'Notes/Far.md' },
    { source: 'P/Harbour.md', target: 'Notes/Close.md' },
  ];
  const groups = G.focusGroups(gn, links, 'P/Harbour.md', { ownNames: ['Me Myself'] });
  assert.deepEqual(groups.map((g) => [g.label, g.nodes.map((n) => [n.title, n.depth])]), [
    ['People', [['Priya Shah', 1]]],
    ['Meetings', [['Kickoff', 2]]],
    ['Decisions', [['Go with steel', 1]]],
    ['Notes', [['Close note', 1]]],
    ['Files', [['quote.pdf', 1]]],
  ]);
  assert.deepEqual(G.focusGroups(gn, links, 'Missing.md'), []);
  assert.equal(G.focusGroupOf({ id: 'Notes/Sync.md', title: 'Sync', kind: 'note', type: 'Meeting' }), 'meetings', 'what it is beats where it is filed (9.2)');
  assert.equal(G.focusGroupOf({ id: 'Notes/Sync.md', title: 'Sync', kind: 'note' }), 'notes', 'no type: the folder still rules');
  // Round 3: the project's own cluster holds the project alone here (nothing owns to it), the rest
  // sit in the loose cluster at the top of the vault; the file counts with them.
  assert.deepEqual(G.wholeVaultClusters(gn).map((c) => [c.name, c.count]), [['Notes at the top', 7], ['Harbour', 1]]);
});

test('round 3 clustering: a project holds its notes, meetings and files; areas hold their projects; counts add up', () => {
  const proj = 'Work/Projects/Harbour/Harbour.md';
  const gn = [
    { id: proj, title: 'Harbour fit-out', kind: 'note', project: true, tags: [] },
    { id: 'Work/Projects/Harbour/Notes/Plan.md', title: 'Plan', kind: 'note', tags: [], owner: proj },
    { id: 'Work/Projects/Harbour/Meetings/Kickoff.md', title: 'Kickoff', kind: 'note', tags: [] },
    { id: 'Work/Projects/Harbour/Files/quote.pdf', title: 'quote.pdf', kind: 'file', tags: [] },
    { id: 'Home/Notes/Loose.md', title: 'Loose', kind: 'note', tags: [] },
    { id: 'Work/Dashboards/Board.md', title: 'Board', kind: 'note', tags: [] },
    { id: 'Daily/2026-10-29.md', title: 'Today', kind: 'note', tags: [] },
    { id: 'Templates/Notes/Blank.md', title: 'Blank', kind: 'note', tags: [] },
    { id: 'Home/Templates-ish.md', title: 'Made from a template', kind: 'note', tags: [], template: true },
  ];
  const clusters = G.vaultClusters(gn);
  const harbour = clusters.find((c) => c.name === 'Harbour fit-out');
  assert.deepEqual(harbour.ids, [proj, 'Work/Projects/Harbour/Notes/Plan.md', 'Work/Projects/Harbour/Meetings/Kickoff.md', 'Work/Projects/Harbour/Files/quote.pdf'], 'the project note, its owned note, its meeting (its folder) and its file in one cluster');
  assert.equal(harbour.area, 'Work');
  assert.ok(!clusters.some((c) => ['Daily', 'Templates', 'Dashboards'].includes(c.name)), 'those folders never name a cluster');
  assert.ok(!clusters.flatMap((c) => c.ids).some((id) => id.startsWith('Daily/') || id.startsWith('Templates/') || id.endsWith('Templates-ish.md')), 'Daily and Templates left out by default');
  assert.ok(clusters.find((c) => c.name === 'Work notes').ids.includes('Work/Dashboards/Board.md'), 'a Dashboards note in Work sits with Work’s loose notes');
  const areas = G.vaultAreas(gn);
  assert.equal(areas.find((a) => a.name === 'Work').count, 5, 'Work: the project’s 4 plus its loose note');
  assert.equal(areas.reduce((n, a) => n + a.count, 0), clusters.reduce((n, c) => n + c.count, 0), 'area counts add up to the clusters');
  assert.equal(areas.reduce((n, a) => n + a.count, 0), 6, 'and to the notes shown');
  const shown = G.vaultClusters(gn, { showHidden: true });
  assert.ok(shown.flatMap((c) => c.ids).some((id) => id.startsWith('Daily/')), 'the filter shows Daily again');
  assert.ok(shown.flatMap((c) => c.ids).some((id) => id.startsWith('Templates/')), 'the filter shows Templates again');
  assert.ok(!shown.some((c) => ['Daily', 'Templates'].includes(c.name)), 'shown, they still name no cluster of their own');
});
