// node --test tests/docs.test.mjs — docs (src/shared/doc-file.ts, src/shared/doc-canvas.ts; 18 Oct 2026). A family
// Minecraft server, set up as a project by mistake, is the made-up case throughout: recognising docs, reading one,
// changing it in place, turning the project into a doc with every word kept, and its canvas built and kept in step in
// place.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-docs-'));
let D;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [...['doc-file', 'doc-canvas'].map((m) => `export * from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`), `export { boundId } from ${JSON.stringify(path.join(root, 'src/shared/project-canvas.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'docs.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'docs.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const DOC = `---
type: doc
about: How the family Minecraft server is set up and run.
tags: [minecraft, family]
---
# Minecraft server

The kids' Java server on the old desktop in the study, for cousins and school friends.

## Setup

Paper 1.21 on the study desktop, port 25565.

## Access

Whitelist only. Ask Dad to add a name.

\`\`\`
## not a heading (inside code)
\`\`\`

## Changes

- **18 Oct 2026** — Added the Access section.
- **12 Oct 2026** — Moved to Paper.
`;

test('a doc is recognised by its type anywhere, or by sitting in the Docs folder with no type of its own', () => {
  assert.equal(D.isDocNote('Anywhere/Backups.md', { type: 'doc' }), true);
  assert.equal(D.isDocNote('Docs/Backups.md', {}), true);
  assert.equal(D.isDocNote('Docs/Backups.md', { type: 'project' }), false, 'a project in Docs stays a project');
  assert.equal(D.isDocNote('Docs/Backups/Activity/Run.md', { status: 'done' }), false, 'a doc’s own folder holds its things, not docs');
  assert.equal(D.isDocNote('Notes/Backups.md', {}), false);
  assert.equal(D.isDocNote('Docs/Board.canvas', {}), false);
  assert.equal(D.isDocNote('Reference/Payroll.md', {}, 'Reference'), true, 'the Docs folder can be another');
  assert.equal(D.isDocText(DOC), true);
  assert.equal(D.isDocText('# Just a note\n'), false);
});

test('a doc reads as its name, about line, summary, sections (headings in code aside) and dated Changes', () => {
  const d = D.parseDoc(DOC, 'Docs/Minecraft server.md');
  assert.equal(d.name, 'Minecraft server');
  assert.equal(d.about, 'How the family Minecraft server is set up and run.');
  assert.deepEqual(d.tags, ['minecraft', 'family']);
  assert.match(d.summary, /^The kids' Java server/);
  assert.deepEqual(d.sections.map((s) => s.heading), ['Setup', 'Access']);
  assert.match(d.sections[1].body, /not a heading/);
  assert.equal(d.changes.length, 2);
  assert.deepEqual([d.changes[0].date, d.changes[0].what], ['18 Oct 2026', 'Added the Access section.']);
  assert.ok(d.changesLine > d.sections[1].line);
  assert.deepEqual(D.firstLines('- [ ] Ask **Dad**\n| a | b |\n| --- | --- |\nSee [[Server#Ports|the ports]].'), ['• Ask Dad', 'a · b', 'See the ports.']);
});

test('a doc is changed in place: sections replaced where they are, new ones before Changes, one dated line on top', () => {
  const r = D.applyDocSave(DOC, { name: 'Minecraft server', sections: [{ heading: 'access', text: 'Whitelist only. Mum or Dad can add a name with /whitelist add.' }, { heading: 'Backups', text: 'Nightly to the NAS.' }], change: 'Backups written down; Access brought up to date.' }, '19 Oct 2026');
  const d = D.parseDoc(r.text);
  assert.deepEqual(d.sections.map((s) => s.heading), ['Setup', 'access', 'Backups']);
  assert.match(d.sections[1].body, /Mum or Dad/);
  assert.doesNotMatch(r.text, /Ask Dad to add a name/);
  assert.equal(d.changes[0].date, '19 Oct 2026');
  assert.equal(d.changes.length, 3, 'one line added, the old ones kept');
  assert.equal(r.made, false);
  const fresh = D.applyDocSave(null, { name: 'Payroll', about: 'How pay runs each fortnight.', sections: [{ heading: 'Steps', text: '1. Export hours' }] }, '19 Oct 2026');
  assert.equal(fresh.made, true);
  assert.equal(D.parseDoc(fresh.text).about, 'How pay runs each fortnight.');
  assert.deepEqual(D.parseDoc(fresh.text).sections.map((s) => s.heading), ['Steps']);
  assert.match(fresh.text, /^---\ntype: doc\n/);
  // The canvas property is written into the front matter, every other line kept.
  const withCanvas = D.setDocProp(DOC, 'canvas', 'Docs/Minecraft server.canvas');
  assert.equal(D.parseDoc(withCanvas).canvas, 'Docs/Minecraft server.canvas');
  assert.equal(D.parseDoc(withCanvas).about, D.parseDoc(DOC).about);
  assert.equal(withCanvas.replace(/canvas: .*\n/, ''), DOC);
});

const PROJECT = `---
type: project
status: active
health: on track
progress: 40
owner: Jesse
tags: [minecraft]
updated: 2026-10-18
---
# Minecraft server

## Summary

The family's Minecraft server: who plays, where it runs and how it is kept going.

## What’s next

- [ ] Set up nightly backups — Jesse · by Fri

## Server

Paper 1.21 on the study desktop.

## Access

Whitelist only.

## Updates

- **18 Oct 2026** — Whitelist turned on.
- 16 Oct 2026 — Server moved to Paper.

## Documentation

- [[Operations]]
- [[Add-ons]]
- [[Change log]]

## Notes
`;
const PAGES = [
  { path: 'Projects/Minecraft server/Operations.md', title: 'Operations', text: '# Operations\n\nRestart it every Sunday night.\n\n## Backups\n\nCopy the world folder to the NAS.\n\n### Restoring\n\nStop the server first.\n' },
  { path: 'Projects/Minecraft server/Add-ons.md', title: 'Add-ons', text: '---\ntags: [plugins]\n---\nEssentialsX and a dynmap for the cousins.\n' },
  { path: 'Projects/Minecraft server/Server.md', title: 'Server', text: 'The machine has 16 GB of memory; the server gets 6.\n' },
  { path: 'Projects/Minecraft server/Change log.md', title: 'Change log', text: '- **14 Oct 2026** — Dynmap added.\n' },
];

test('a project that is really documentation becomes a doc with every word kept, as the host app writes it', () => {
  const r = D.projectToDoc(PROJECT, PAGES, { name: 'Minecraft server', canvas: 'Docs/Minecraft server.canvas', isoToday: '2026-10-18' });
  const d = D.parseDoc(r.text, 'Docs/Minecraft server.md');
  // Its own properties only, in the former host app's order (a project's status, health and progress stay with the
  // project).
  assert.match(r.text, /^---\ntype: doc\ntags: \[minecraft\]\ncanvas: Docs\/Minecraft server\.canvas\nupdated: 2026-10-18\n---\n# Minecraft server\n/);
  assert.equal(d.canvas, 'Docs/Minecraft server.canvas');
  assert.equal(d.updated, '2026-10-18');
  assert.equal(d.summary, 'The family\'s Minecraft server: who plays, where it runs and how it is kept going.');
  // Its own sections, then its pages, then its lists (Next steps).
  assert.deepEqual(d.sections.map((s) => s.heading), ['Server', 'Access', 'Operations', 'Add-ons', 'Next steps']);
  // A page named like a section joins it; a page's sections sit under its section as ###.
  assert.match(d.sections[0].body, /study desktop[\s\S]*16 GB/);
  assert.equal(d.sections[2].body, 'Restart it every Sunday night.\n\n### Backups\n\nCopy the world folder to the NAS.\n\n### Restoring\n\nStop the server first.');
  assert.equal(d.sections[4].body, '- [ ] Set up nightly backups — Jesse · by Fri');
  // Updates and the Change log page are Changes, newest first.
  assert.deepEqual(d.changes.map((c) => c.what), ['Whitelist turned on.', 'Server moved to Paper.', 'Dynmap added.'].filter((w) => d.changes.some((c) => c.what.includes(w))).map((w) => d.changes.find((c) => c.what.includes(w)).what));
  assert.equal(d.changes[0].date, '18 Oct 2026');
  assert.ok(d.changes.some((c) => c.what === 'Dynmap added.' && c.date === '14 Oct 2026'));
  // The list of its pages is gone (they are sections now); the empty Notes section too.
  assert.doesNotMatch(r.text, /## Documentation|\[\[Operations\]\]|## Notes|## Related/);
  assert.deepEqual(r.merged.map((m) => m.heading), ['Operations', 'Add-ons', 'Server', 'Changes']);
  // Every word of the project's words and its pages is in the doc (headings that became the summary, Changes or a list's
  // own name aside).
  const have = new Set(D.wordsOf(r.text));
  const source = [PROJECT.replace(/^---[\s\S]*?---\n/, '').replace(/## Documentation[\s\S]*?## Notes/, ''), ...PAGES.map((p) => p.text.replace(/^---[\s\S]*?---\n/, ''))].join('\n');
  const lost = [...new Set(D.wordsOf(source))].filter((w) => !have.has(w) && !['summary', 'updates', 'what', 's'].includes(w));
  assert.deepEqual(lost, []);
});

test('turning a doc into a project keeps its words, with Changes as Updates', () => {
  const p = D.docToProject(DOC, { today: '2026-10-18' });
  assert.match(p, /^---\ntype: project\nstatus: planning\nhealth: on track\n/);
  assert.doesNotMatch(p, /type: doc/);
  assert.match(p, /## Summary\n\nThe kids' Java server/);
  assert.match(p, /## Updates\n\n- \*\*18 Oct 2026\*\*/);
  const have = new Set(D.wordsOf(p));
  assert.deepEqual([...new Set(D.wordsOf(DOC.replace(/^---[\s\S]*?---\n/, '')))].filter((w) => !have.has(w) && w !== 'changes'), []);
});

test('links that reached the project or its pages reach the doc, words unchanged for the reader', () => {
  const files = { 'minecraft server': 'Projects/Minecraft server/Minecraft server.md', operations: 'Projects/Minecraft server/Operations.md', 'projects/minecraft server/operations': 'Projects/Minecraft server/Operations.md', 'add-ons': 'Projects/Minecraft server/Add-ons.md' };
  const resolve = (t) => files[t.toLowerCase().replace(/\.md$/, '').replace(/%20/g, ' ')] ?? null;
  const redirect = new Map([
    ['Projects/Minecraft server/Minecraft server.md', { docLink: 'Docs/Minecraft server', heading: '' }],
    ['Projects/Minecraft server/Operations.md', { docLink: 'Docs/Minecraft server', heading: 'Operations' }],
    ['Projects/Minecraft server/Add-ons.md', { docLink: 'Docs/Minecraft server', heading: 'Add-ons' }],
  ]);
  const before = 'See [[Operations]], [[Operations#Backups|backups]], ![[Add-ons]], [[Minecraft server]] and [ops](Projects/Minecraft%20server/Operations.md). Not [[Recipes]]. `[[Operations]]`';
  const r = D.redirectLinks(before, resolve, redirect);
  assert.equal(r.text, 'See [[Docs/Minecraft server#Operations|Operations]], [[Docs/Minecraft server#Backups|backups]], ![[Docs/Minecraft server#Add-ons|Add-ons]], [[Docs/Minecraft server|Minecraft server]] and [ops](Docs/Minecraft%20server.md#Operations). Not [[Recipes]]. `[[Operations]]`');
  assert.equal(r.count, 5);
});

test('a page’s headings nest under its section, its own title dropped, code left alone', () => {
  assert.equal(D.nestPage('# Ports\n\nOpen 25565.\n\n## Firewall\n\n```\n## comment\n```\n', 'Ports'), 'Open 25565.\n\n### Firewall\n\n```\n## comment\n```');
  assert.equal(D.nestPage('---\ntags: [x]\n---\nText.\n\n### Deep\n', 'X'), 'Text.\n\n### Deep');
});

const area = (r) => r.width * r.height;
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('a canvas built from a doc: its card, a card per section under it linking to its heading, in the host app’s shape', () => {
  const docPath = 'Docs/Minecraft server.md';
  const text = D.projectToDoc(PROJECT, PAGES, { name: 'Minecraft server' }).text;
  const board = D.buildDocCanvas(docPath, text);
  assert.deepEqual(board.neuralvault, { kind: 'doc', doc: docPath });
  const centre = board.nodes.find((n) => n.neuralvault?.part === 'doc');
  assert.deepEqual([centre.type, centre.file, centre.neuralvault.doc], ['file', docPath, docPath]);
  const cards = board.nodes.filter((n) => n.neuralvault?.part === 'section');
  assert.deepEqual(cards.map((c) => c.subpath), ['#Server', '#Access', '#Operations', '#Add-ons', '#Next steps']);
  assert.deepEqual(cards.map((c) => c.neuralvault.heading), ['Server', 'Access', 'Operations', 'Add-ons', 'Next steps']);
  assert.ok(cards.every((c) => c.type === 'file' && c.file === docPath && c.neuralvault.doc === docPath));
  // The same ids the former host app gives them (Ironleaf's boundId of the doc and the section).
  const P = D.boundId;
  assert.equal(centre.id, P(docPath, 'doc'));
  assert.equal(cards[3].id, P(docPath, 'section', 'add ons'));
  for (let i = 0; i < board.nodes.length; i++) for (let j = i + 1; j < board.nodes.length; j++) assert.ok(!overlap(board.nodes[i], board.nodes[j]), `${board.nodes[i].id} overlaps ${board.nodes[j].id}`);
  assert.equal(board.edges.length, cards.length);
  assert.ok(board.edges.every((e) => e.fromNode === centre.id && e.neuralvault.auto === 'section'));
  assert.equal(board.edges[3].neuralvault.key, 'add ons');
  // Under the doc's card, three to a row, in reading order.
  assert.ok(cards.every((c) => c.y > centre.y + centre.height));
  assert.ok(cards[0].x < cards[1].x && cards[1].x < cards[2].x && cards[3].y > cards[0].y);
  const w = Math.max(...board.nodes.map((n) => n.x + n.width)) - Math.min(...board.nodes.map((n) => n.x));
  assert.ok(w < 1300, `board ${w} wide`);
  const big = D.buildDocCanvas(docPath, `# Big\n\n${Array.from({ length: 23 }, (_, i) => `## Part ${i + 1}\n\nWords ${i}.\n`).join('\n')}`);
  for (let i = 0; i < big.nodes.length; i++) for (let j = i + 1; j < big.nodes.length; j++) assert.ok(!overlap(big.nodes[i], big.nodes[j]));
});

test('Update canvas from doc works in place: renamed, added and removed sections; the person’s cards and positions kept', () => {
  const docPath = 'Docs/Minecraft server.md';
  const board = D.buildDocCanvas(docPath, DOC);
  // The person moves the Access card, colours it, adds a card of their own joined to it.
  const access = board.nodes.find((n) => n.subpath === '#Access');
  access.x += 77;
  access.y -= 33;
  access.color = '4';
  board.nodes.push({ id: 'mine', type: 'text', text: 'Ask about a second world', x: 2000, y: 0, width: 260, height: 120 });
  board.edges.push({ id: 'my-line', fromNode: access.id, toNode: 'mine' });
  // The doc changes: Access renamed (same words), Setup taken out, Backups added.
  let text = DOC.replace('## Access', '## Who can play').replace(/## Setup\n\nPaper 1.21 on the study desktop, port 25565.\n\n/, '');
  text = D.upsertDocSections(text, [{ heading: 'Backups', text: 'Nightly to the NAS.' }]).text;
  const r = D.syncDocCanvas(board, docPath, text);
  assert.deepEqual(r.renamed, [['Access', 'Who can play']]);
  assert.deepEqual(r.added, ['Backups']);
  assert.deepEqual(r.removed, ['Setup']);
  const renamed = r.board.nodes.find((n) => n.id === access.id);
  assert.equal(renamed.subpath, '#Who can play');
  assert.deepEqual([renamed.x, renamed.y, renamed.color], [access.x, access.y, '4'], 'its place and colour kept');
  assert.ok(r.board.nodes.some((n) => n.id === 'mine') && r.board.edges.some((e) => e.id === 'my-line'), 'the person’s card and line kept');
  assert.ok(!r.board.nodes.some((n) => n.subpath === '#Setup'));
  const backups = r.board.nodes.find((n) => n.subpath === '#Backups');
  for (const n of r.board.nodes) if (n !== backups) assert.ok(!overlap(n, backups), 'the new card sits in free space');
  assert.equal(D.syncWords(r), 'Canvas updated: 1 section added, 1 renamed, 1 taken off.');
  // Again with nothing changed: the same board.
  const again = D.syncDocCanvas(r.board, docPath, text);
  assert.equal(again.changed, false);
  assert.equal(D.syncWords(again), 'The canvas already matches the doc.');
  // A doc moved: its cards follow it.
  const moved = D.syncDocCanvas(r.board, 'Docs/Family/Minecraft.md', text).board;
  assert.ok(moved.nodes.filter((n) => n.neuralvault).every((n) => n.file === 'Docs/Family/Minecraft.md'));
});

test('a project’s canvas re-pointed at its doc: the project card is the doc’s, page cards open their sections', () => {
  const docPath = 'Docs/Minecraft server.md';
  const text = D.projectToDoc(PROJECT, PAGES, { name: 'Minecraft server' }).text;
  const project = 'Projects/Minecraft server/Minecraft server.md';
  const old = {
    nodes: [
      { id: 'p', type: 'file', file: project, x: -220, y: -136, width: 440, height: 272, neuralvault: { part: 'project', project } },
      { id: 'g', type: 'group', label: 'What’s next', x: 400, y: 0, width: 348, height: 200, neuralvault: { part: 'group', section: 'next' } },
      { id: 'ops', type: 'file', file: 'Projects/Minecraft server/Operations.md', x: -900, y: 500, width: 300, height: 200 },
      { id: 'own', type: 'text', text: 'My idea', x: 0, y: 900, width: 200, height: 100 },
    ],
    edges: [{ id: 'e', fromNode: 'p', toNode: 'g', neuralvault: { auto: 'group', key: 'next' } }],
    neuralvault: { kind: 'project', project },
  };
  const pages = new Map([['Projects/Minecraft server/Operations.md', 'Operations']]);
  const b = D.repointProjectCanvas(old, { project, docPath, docText: text, pages });
  assert.deepEqual(b.neuralvault, { kind: 'doc', doc: docPath });
  // The project's own cards (and their lines) go; the person's stay; the page's card opens the doc at its section.
  assert.ok(!b.nodes.some((n) => n.id === 'p' || n.id === 'g'));
  assert.equal(b.edges.some((e) => e.id === 'e'), false);
  const ops = b.nodes.find((n) => n.id === 'ops');
  assert.deepEqual([ops.file, ops.subpath, ops.x], [docPath, '#Operations', -900]);
  assert.ok(b.nodes.some((n) => n.id === 'own'));
  assert.equal(b.nodes.filter((n) => n.neuralvault?.part === 'doc').length, 1);
  assert.deepEqual(b.nodes.filter((n) => n.neuralvault?.part === 'section').map((n) => n.subpath).sort(), ['#Access', '#Add-ons', '#Next steps', '#Operations', '#Server']);
});

test('doc templates have names a file can take (no slashes), and make a doc', () => {
  for (const t of D.DOC_TEMPLATES) {
    assert.doesNotMatch(t.name, /[\\/:*?"<>|]/, t.name);
    assert.match(t.text, /^---\ntype: doc-template\n/);
    assert.match(t.text, /\n## Changes\n\n- \*\*\{\{date:D MMM YYYY\}\}\*\* — Started this doc\.\n$/);
  }
  assert.deepEqual(D.DOC_TEMPLATES.map((t) => t.name), ['System or server', 'Process or how-to', 'Runbook']);
});
