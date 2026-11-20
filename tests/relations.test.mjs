// node --test tests/relations.test.mjs — how notes and projects are connected (src/shared/relations.ts): a project's own
// notes, shared people, mentions, projects that go together, shared tags and links, each with its reason in plain words;
// and no lines where nothing connects them. Made-up projects only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-relations-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/relations.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A project file as Ironleaf writes it (Projects/<Name>/<Name>.md). */
function project(name, { people = [], owner, tags = [], body = '', health = 'on track', props = {} } = {}) {
  const front = ['---', 'type: project', `health: ${health}`, ...(owner ? [`owner: ${owner}`] : []), ...(tags.length ? [`tags: [${tags.join(', ')}]`] : []), ...Object.entries(props).map(([k, v]) => `${k}: ${v}`), '---'].join('\n');
  const text = `${front}\n# ${name}\n\n## Summary\n\n${body || `Made-up project ${name}.`}\n\n## People\n\n${people.map((p) => `- **${p}** — Someone`).join('\n')}\n`;
  return { path: `Projects/${name}/${name}.md`, label: name, content: text, props: { type: 'project', health, ...props }, tags, links: [] };
}
const note = (p, content = '', extra = {}) => ({ path: p, label: p.split('/').pop().replace(/\.md$/, ''), content, props: {}, tags: [], links: [], ...extra });

const between = (r, a, b) => r.relations.find((x) => (x.source === a && x.target === b) || (x.source === b && x.target === a));
const pathOf = (name) => `Projects/${name}/${name}.md`;
const projectPairs = (r) => r.relations.filter((x) => r.projects.includes(x.source) && r.projects.includes(x.target));

test('a project owns the notes in its folder, its Activity notes and notes whose project names it', () => {
  const r = R.computeRelations([
    project('Bakery Website'),
    note('Projects/Bakery Website/Kick-off notes.md', 'We met.'),
    note('Projects/Bakery Website/Activity/Draft the menu page.md', 'Done.'),
    note('Reports/Bakery Website progress.md', 'A report.', { props: { project: '[[Bakery Website]]' } }),
    note('Loose idea.md', 'Nothing to do with it.'),
  ]);
  const p = pathOf('Bakery Website');
  assert.equal(r.owner.get('Projects/Bakery Website/Kick-off notes.md'), p);
  assert.equal(r.owner.get('Projects/Bakery Website/Activity/Draft the menu page.md'), p);
  assert.equal(r.owner.get('Reports/Bakery Website progress.md'), p);
  assert.equal(r.owner.has('Loose idea.md'), false);
  assert.equal(r.noteCount.get(p), 3);
  const owns = between(r, p, 'Projects/Bakery Website/Kick-off notes.md');
  assert.deepEqual(owns.kinds, ['owns']);
  assert.equal(owns.reasons[0], 'Kick-off notes belongs to Bakery Website');
  assert.equal(between(r, p, 'Loose idea.md'), undefined);
});

test('a note naming a project by its alias belongs to it (9.5 fourth pass)', () => {
  const r = R.computeRelations([
    { ...project('Penhallow St Ashford (Close)'), aliases: ['Penhallow'] },
    note('Reports/Penhallow visit.md', 'Went well.', { props: { project: '[[Penhallow]]' } }),
  ]);
  assert.equal(r.owner.get('Reports/Penhallow visit.md'), pathOf('Penhallow St Ashford (Close)'));
});

test('a note in one folder naming another project belongs to the one it names (9.5 fourth pass)', () => {
  const r = R.computeRelations([
    project('Alpha Ovens'),
    project('Bravo Planters'),
    note('Projects/Alpha Ovens/Shared register notes.md', 'For both.', { props: { project: '[[Bravo Planters]]' } }),
  ]);
  assert.equal(r.owner.get('Projects/Alpha Ovens/Shared register notes.md'), pathOf('Bravo Planters'));
});

test('projects sharing a person are connected, however the name is written', () => {
  const r = R.computeRelations([
    project('Harbour Office Network', { people: ['Bettina Maddox', 'Tom Ng'] }),
    project('Meeting Room Screens', { people: ['bettina  maddox (Harbourline Signs)', 'Lee Park'] }),
    project('Payroll Change', { people: ['Lee Parker'] }),
  ]);
  const rel = between(r, pathOf('Harbour Office Network'), pathOf('Meeting Room Screens'));
  assert.deepEqual(rel.kinds, ['people']);
  assert.equal(rel.reasons[0], 'Both have Bettina Maddox');
  // "Lee Park" is not "Lee Parker".
  assert.equal(between(r, pathOf('Meeting Room Screens'), pathOf('Payroll Change')), undefined);
});

test('a group, a first name alone, and the person on every project connect nothing', () => {
  const owner = 'Sam Taylor';
  const r = R.computeRelations([
    project('Alpha Ovens', { owner, people: ['Finance team', 'Priya'] }),
    project('Bravo Planters', { owner, people: ['Finance team', 'Priya'] }),
    project('Charlie Scales', { owner }),
    project('Delta Ovens', { owner }),
    project('Echo Freezers', { owner }),
  ]);
  assert.equal(projectPairs(r).length, 0);
  assert.equal(R.personKey('Finance team'), null);
  assert.equal(R.personKey('Priya'), null);
  assert.equal(R.personKey('Dr Bettina Maddox, Tessaly'), 'bettina maddox');
  assert.equal(R.personKey('José Núñez'), 'jose nunez');
  assert.equal(R.personKey('Li Na Wang'), 'li na wang', 'Na is her name, not “n/a”');
  assert.equal(R.personKey('N/A'), null);
  assert.equal(R.personKey('n/a'), null);
  // A code or email routing is never a person (10 Nov 2026 read as Person).
  assert.equal(R.personKey('Q47 on copy'), null, 'a circuit code on copy is not someone');
  assert.equal(R.personKey('Room 4B set-up'), null, 'a room with a figure is not someone');
  assert.equal(R.personKey('Mereana on copy'), null, 'on copy is who the mail went to, never a name');
  assert.equal(R.personKey('D Lam'), 'd lam', 'an initial stays a name');
  assert.equal(R.personKey('Bettina Maddox'), 'bettina maddox', 'a plain name still passes');
});

test('a note or project naming another project mentions it, by name or a short form', () => {
  const r = R.computeRelations([
    project('01 Garden Shed Upgrade'),
    project('SSL Inspection'),
    project('Tessaly Meeting Rooms'),
    project('Studio Upgrade'),
    note('Monthly update - September.md', 'This month: SSL Inspection is in testing, Garden Shed passed 90%, and Tessaly fitted two rooms. The Studio Upgrade is waiting, and the studio upgrade notes are not a name.'),
    project('Firewall Refresh', { body: 'Needs the ssl inspection rules first.' }),
  ]);
  const m = 'Monthly update - September.md';
  assert.equal(between(r, m, pathOf('SSL Inspection')).reasons[0], 'Monthly update - September mentions SSL Inspection');
  assert.ok(between(r, m, pathOf('01 Garden Shed Upgrade')).reasons[0].endsWith('mentions Garden Shed'));
  assert.ok(between(r, m, pathOf('Tessaly Meeting Rooms')).reasons[0].endsWith('mentions Tessaly'));
  // A name of ordinary words counts when it is written as the name, with its capitals.
  assert.ok(between(r, m, pathOf('Studio Upgrade')));
  // A project file mentioning another project.
  assert.deepEqual(between(r, pathOf('Firewall Refresh'), pathOf('SSL Inspection')).kinds, ['mentions']);
});

test('a lead acronym and a project actually named AI match; IT alone never names IT Upgrade (9.5 fourth pass)', () => {
  const r = R.computeRelations([
    project('SSL Inspection'),
    project('AI'),
    project('IT Upgrade'),
    note('Net notes.md', 'The SSL rules changed.'),
    note('AI notes.md', 'The AI roadmap is set.'),
    note('Desk notes.md', 'Ask IT about the VPN.'),
  ]);
  assert.ok(between(r, 'Net notes.md', pathOf('SSL Inspection')), 'SSL names SSL Inspection');
  assert.ok(between(r, 'AI notes.md', pathOf('AI')));
  assert.equal(between(r, 'Desk notes.md', pathOf('IT Upgrade')), undefined, 'IT alone never names IT Upgrade');
});

test('mentions are not found in ordinary words, lower-case single words, or a project’s own notes', () => {
  const r = R.computeRelations([
    project('Studio Upgrade'),
    project('Tessaly Recording'),
    project('Harbour Fit-out'),
    note('Projects/Studio Upgrade/Visit.md', 'Studio Upgrade visit went well.'),
    note('Shopping.md', 'Went to the studio to upgrade my phone. The tessaly old man said hello. A harbour view.'),
  ]);
  assert.equal(between(r, 'Shopping.md', pathOf('Studio Upgrade')), undefined);
  assert.equal(between(r, 'Shopping.md', pathOf('Tessaly Recording')), undefined);
  assert.equal(between(r, 'Shopping.md', pathOf('Harbour Fit-out')), undefined);
  const own = between(r, 'Projects/Studio Upgrade/Visit.md', pathOf('Studio Upgrade'));
  assert.deepEqual(own.kinds, ['owns']);
  const forms = R.projectForms(['Studio Upgrade']).map((f) => f.text);
  assert.deepEqual(forms, ['Studio Upgrade', 'Studio']);
});

test('a place closing and one opening in the same city go together; nothing else pairs', () => {
  const r = R.computeRelations([
    project('Penhallow St Ashford (Close)'),
    project('Wexley St Ashford (Launch)'),
    project('Wexley St Brookvale (Close)'),
    project('Harrow Quay Brookvale (Close)'),
    project('Open Banking API'),
    project('API Gateway Decommission'),
    project('Calloway Ashford Refit'),
  ]);
  const pair = between(r, pathOf('Penhallow St Ashford (Close)'), pathOf('Wexley St Ashford (Launch)'));
  assert.deepEqual(pair.kinds, ['paired']);
  assert.equal(pair.reasons[0], 'Both in Ashford: one closing, one opening');
  // The same street in another city, two closings, and words that only look like phases.
  assert.equal(between(r, pathOf('Wexley St Ashford (Launch)'), pathOf('Wexley St Brookvale (Close)')), undefined);
  assert.equal(between(r, pathOf('Wexley St Brookvale (Close)'), pathOf('Harrow Quay Brookvale (Close)')), undefined);
  assert.equal(between(r, pathOf('Open Banking API'), pathOf('API Gateway Decommission')), undefined);
  assert.equal(between(r, pathOf('Calloway Ashford Refit'), pathOf('Penhallow St Ashford (Close)')), undefined);
});

test('projects sharing a tag are connected; a tag on most projects is not', () => {
  const r = R.computeRelations([
    project('Alpha Ovens', { tags: ['garden', 'work'] }),
    project('Bravo Planters', { tags: ['garden', 'work'] }),
    project('Charlie Scales', { tags: ['work'] }),
    project('Delta Ovens', { tags: ['work'] }),
    project('Echo Freezers', { tags: ['work'] }),
  ]);
  const rel = between(r, pathOf('Alpha Ovens'), pathOf('Bravo Planters'));
  assert.deepEqual(rel.kinds, ['tags']);
  assert.equal(rel.reasons[0], 'Both tagged #garden');
  assert.equal(projectPairs(r).length, 1);
});

test('links as written, with every reason on one line per pair', () => {
  const a = project('Alpha Ovens', { people: ['Bettina Maddox'] });
  a.links = [pathOf('Bravo Planters')];
  const r = R.computeRelations([a, project('Bravo Planters', { people: ['Bettina Maddox'] }), note('A.md', '', { links: ['B.md'] }), note('B.md')]);
  const rel = between(r, pathOf('Alpha Ovens'), pathOf('Bravo Planters'));
  assert.deepEqual(rel.kinds.sort(), ['link', 'people']);
  assert.ok(rel.reasons.includes('Alpha Ovens links to Bravo Planters'));
  assert.ok(rel.reasons.includes('Both have Bettina Maddox'));
  assert.ok(rel.strength > 1);
  const ab = between(r, 'A.md', 'B.md');
  assert.equal(ab.source, 'A.md');
  assert.deepEqual(ab.kinds, ['link']);
  // A link already says it: no mention on top.
  assert.equal(r.relations.filter((x) => x.kinds.includes('mentions')).length, 0);
});

test('unrelated projects stay apart', () => {
  const r = R.computeRelations([
    project('Winter Menu', { people: ['Alex Lee'], tags: ['menu'], body: 'Soups and the website page.' }),
    project('Supplier Review', { people: ['Jo Smith'], tags: ['suppliers'], body: 'Flour and butter suppliers compared.' }),
    project('Harbour Fit-out', { people: ['Priya Shah'], tags: ['office'], body: 'Meeting rooms and network for the move.' }),
    note('Daily/2026-10-17.md', 'Baked bread. Rang the bank. Winter is coming.'),
  ]);
  assert.equal(projectPairs(r).length, 0);
  assert.equal(r.relations.length, 0);
});

test('a few thousand notes are worked out quickly, and again faster with the word cache', () => {
  const notes = [];
  for (let i = 0; i < 40; i++) notes.push(project(`Project Number${i} Upgrade`, { people: [`Person ${String.fromCharCode(65 + (i % 20))}ee Name`] }));
  const filler = 'Lorem ipsum dolor sit amet, the shop ordered flour and butter for the week. '.repeat(40);
  for (let i = 0; i < 3000; i++) notes.push(note(`Notes/${i}.md`, `${filler} ${i % 50 === 0 ? `See Project Number${i % 40} for details.` : ''}`, { links: i > 0 ? [`Notes/${i - 1}.md`] : [] }));
  const cache = new Map();
  let t = Date.now();
  const r = R.computeRelations(notes, cache);
  const first = Date.now() - t;
  t = Date.now();
  R.computeRelations(notes, cache);
  const second = Date.now() - t;
  assert.ok(r.relations.some((x) => x.kinds.includes('mentions')));
  assert.ok(first < 3000, `took ${first} ms`);
  assert.ok(second < 1500, `took ${second} ms again`);
});

test('a doc that names a project or another doc is joined to it in the graph', () => {
  const doc = (name, body) => ({ path: `Docs/${name}.md`, label: name, content: `---\ntype: doc\n---\n# ${name}\n\n${body}\n`, props: { type: 'doc' }, tags: [], links: [] });
  const r = R.computeRelations([
    project('Garage Rebuild'),
    doc('Minecraft server', 'Runs on the old desktop. Its traffic goes through the Home network router. The Garage Rebuild moved the desktop.'),
    doc('Home network', 'The router, the Wi-Fi and the NAS.'),
    doc('Payroll', 'Nothing about the others.'),
  ]);
  const mentions = between(r, 'Docs/Minecraft server.md', 'Docs/Home network.md');
  assert.ok(mentions && mentions.kinds.includes('mentions'), 'doc to doc');
  assert.match(mentions.reasons[0], /Minecraft server mentions Home network/);
  assert.ok(between(r, 'Docs/Minecraft server.md', pathOf('Garage Rebuild')), 'doc to project');
  assert.equal(between(r, 'Docs/Payroll.md', 'Docs/Home network.md'), undefined);
});
