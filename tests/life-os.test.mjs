// node --test tests/life-os.test.mjs — the vault as a life OS (Wave 4): areas of life (src/shared/areas.ts), the move into
// areas (src/shared/area-migration.ts), People and Organisations (src/shared/people.ts), the Inbox (src/shared/inbox.ts)
// and the tag manager (src/shared/tags.ts), with colour codes no longer read as tags (src/shared/markdown.ts). Made-up
// notes only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-life-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    ['areas', 'area-migration', 'people', 'inbox', 'tags', 'markdown', 'records']
      .map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`)
      .join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Areas ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('areas: read, write, add, rename, move and remove, every word the person’s', () => {
  const { readAreas, writeAreas, defaultConfig, addArea, changeArea, moveArea, removeArea } = L.areas;
  assert.equal(readAreas('').config, null, 'no file: not organised by area yet');
  assert.match(readAreas('{').problem, /couldn’t be read/);
  const c = defaultConfig();
  assert.deepEqual(c.areas.map((a) => a.name), ['Work', 'Business', 'Home', 'Family', 'Health', 'Me', 'Publications', 'Library']);
  assert.equal(c.areas.find((a) => a.id === 'library').quiet, true);
  const back = readAreas(writeAreas(c)).config;
  assert.deepEqual(back, c, 'written and read back the same');
  const { config: more, id } = addArea(c, { name: 'Home lab', icon: 'server' });
  assert.equal(id, 'home-lab');
  assert.equal(more.areas.at(-1).folder, 'Home lab');
  assert.throws(() => addArea(more, { name: 'work' }), /already/);
  const renamed = changeArea(more, 'work', { name: 'Blue Peak' });
  assert.equal(renamed.areas[0].name, 'Blue Peak');
  assert.equal(renamed.areas[0].folder, 'Work', 'the folder keeps its name until it is moved');
  assert.equal(moveArea(renamed, 'home-lab', -100).areas[0].id, 'home-lab');
  assert.equal(removeArea(renamed, 'work').home, 'business', 'home moves to the next area');
  // A hand-edited file: junk left out, duplicates once.
  const hand = readAreas(JSON.stringify({ areas: [{ name: 'Garden', icon: 'nope' }, { name: 'Garden' }, { nothing: 1 }, { name: 'Shed', folder: '../x' }] })).config;
  assert.deepEqual(hand.areas.map((a) => [a.name, a.folder, a.icon]), [['Garden', 'Garden', 'layers'], ['Shed', 'x', 'layers']]);
});

test('areas: which area a thing is in, its kind, and the counts', () => {
  const { defaultConfig, areaOf, kindOf, countAreas, isQuiet, projectFolders, projectFolderOf, homeIn, wanted } = L.areas;
  const areas = defaultConfig().areas;
  const places = { templatesFolder: 'Templates', assetsFolder: 'Assets' };
  assert.equal(areaOf({ path: 'Home/Bills/Power.md' }, areas)?.id, 'home');
  assert.equal(areaOf({ path: 'Daily/2026-10-24.md', props: { area: 'Health' } }, areas)?.id, 'health', 'its area: wins');
  assert.equal(areaOf({ path: 'Work/x.md', props: { area: 'personal' } }, areas)?.id, 'me', 'a usual word for an area');
  assert.equal(areaOf({ path: 'Templates/Notes/Daily.md' }, areas, places)?.id, 'library');
  assert.equal(areaOf({ path: 'Assets/Logos/logo.png' }, areas, places)?.id, 'library');
  assert.equal(areaOf({ path: 'Notes/loose.md' }, areas), undefined);
  assert.equal(isQuiet({ path: 'Templates/x.md' }, areas, places), true);
  assert.equal(isQuiet({ path: 'Library/Refs/Style guide.md' }, areas, places), true);
  assert.equal(isQuiet({ path: 'Work/x.md' }, areas, places), false);
  assert.equal(kindOf({ path: 'Work/Projects/Fit-out/Fit-out.md', props: { type: 'project' } }), 'projects');
  assert.equal(kindOf({ path: 'Work/People/Ana Ruiz.md', props: { type: 'person' } }), 'people');
  assert.equal(kindOf({ path: 'Work/People/Harbourline.md', props: { type: 'organisation' } }), 'people');
  assert.equal(kindOf({ path: 'Work/People/Org chart.md', props: { type: 'doc' } }), 'notes', 'a doc kept in People is a doc');
  assert.equal(kindOf({ path: 'Home/Files/lease.pdf' }), 'files');
  assert.equal(kindOf({ path: 'Family/Photos/beach.jpg' }), 'assets');
  assert.equal(kindOf({ path: 'Work/Files/mix.opus' }), 'assets', 'an opus recording is media');
  assert.equal(kindOf({ path: 'Work/Files/book.m4b' }), 'assets', 'an m4b audiobook is media');
  assert.equal(kindOf({ path: 'Work/Assets/brand.pdf' }), 'assets');
  const notes = [
    { path: 'Work/Projects/Fit-out/Fit-out.md', props: { type: 'project' } },
    { path: 'Work/Projects/Fit-out/Notes/Walkthrough.md', props: {} },
    { path: 'Work/People/Ana Ruiz.md', props: { type: 'person' } },
    { path: 'Home/Bills/Power.md', props: {} },
    { path: 'Notes/loose.md', props: {} },
  ];
  const dirs = projectFolders(notes);
  const items = [...notes, { path: 'Work/Projects/Fit-out/Files/plan.pdf' }, { path: 'Home/Files/lease.pdf' }].map((n) => ({ ...n, project: projectFolderOf(n.path, dirs, n.props?.type === 'project') }));
  const counts = countAreas(items, areas, places);
  assert.deepEqual({ ...counts.get('work') }, { projects: 1, notes: 0, people: 1, files: 0, assets: 0, total: 2 }, 'a project’s own notes and files count with it');
  assert.equal(counts.get('home').total, 2);
  assert.equal(counts.get('').notes, 1, 'the things in no area yet');
  assert.equal(homeIn(areas[0], 'people'), 'Work/People');
  assert.equal(homeIn(areas[0], 'Meetings'), 'Work/Meetings');
  assert.equal(wanted({ path: 'Templates/x.md' }, 'all', areas, places), false, 'templates out of search unless asked');
  assert.equal(wanted({ path: 'Templates/x.md' }, 'all', areas, places, true), true);
  assert.equal(wanted({ path: 'Library/x.md' }, ['library'], areas, places), true, 'the Library chosen on its own shows');
  assert.equal(wanted({ path: 'Notes/loose.md' }, ['work'], areas, places), false);
  assert.equal(wanted({ path: 'Notes/loose.md' }, [''], areas, places), true);
});

test('areas: Today for some areas only, its counts made again', () => {
  const { todayFor } = L.areas;
  const ref = (project) => ({ project, projectName: project, version: 'v' });
  const data = {
    date: '2026-10-24', since: 0, me: null, projects: 3,
    due: { overdue: [{ ...ref('Work/Projects/A/A.md'), id: 'a', kind: 'step', what: 'a', others: false, when: '', offset: -1, tone: 'bad' }], today: [{ ...ref('Home/Projects/B/B.md'), id: 'b', kind: 'step', what: 'b', others: false, when: '', offset: 0, tone: 'warn' }], soon: [] },
    atRisk: [{ ...ref('Home/Projects/B/B.md'), id: 'r', tone: 'bad', dueOffset: null, risks: [] }],
    waiting: [], changed: [], daily: null, meetings: [{ path: 'Work/Meetings/m.md', title: 'm', attendees: [] }], docs: [], automations: null,
    counts: { overdue: 1, today: 1, soon: 0, atRisk: 1, waiting: 0, changed: 0, meetings: 1, automations: 0 }, clear: false,
  };
  const home = todayFor(data, (p) => p.startsWith('Home/'));
  assert.equal(home.counts.overdue, 0);
  assert.equal(home.counts.today, 1);
  assert.equal(home.counts.atRisk, 1);
  assert.equal(home.counts.meetings, 0);
  assert.equal(home.clear, false);
  const none = todayFor(data, () => false);
  assert.equal(none.clear, true);
  assert.equal(home.nothingOnYou, false, 'an area with work due today is not the empty state');
  assert.equal(none.nothingOnYou, true, 'filtering to no areas leaves nothing on the person, so Today says so there too');
});

// ── The move into areas ──────────────────────────────────────────────────────────────────────────────────────────────

const vaultNotes = () => [
  { path: 'Projects/Harbour Fit-out/Harbour Fit-out.md', props: { type: 'project', folder: 'C:\\Users\\sam\\Documents\\Bakery Work\\01 Harbour Fit-out' }, tags: ['retail'], links: ['People/Ana Ruiz.md'] },
  { path: 'Projects/Harbour Fit-out/Notes/Walkthrough.md', props: {}, tags: [], links: [] },
  { path: 'Projects/Desk Hub/Desk Hub.md', props: { type: 'project', folder: 'C:\\Users\\sam\\Documents\\Bakery Work' }, tags: ['work', 'hub'], links: [] },
  { path: 'Projects/Winter Menu/Winter Menu.md', props: { type: 'project', folder: 'C:\\Users\\sam\\Documents\\Bakery Work\\02 Winter Menu' }, tags: [], links: [] },
  { path: 'Projects/Couch to 5k/Couch to 5k.md', props: { type: 'project', layout: 'habit' }, tags: [], links: [] },
  { path: 'People/Ana Ruiz.md', props: { type: 'person' }, tags: [], links: [] },
  { path: 'People/Mia Chen.md', props: { type: 'person' }, tags: ['family'], links: [] },
  { path: 'Docs/Oven runbook.md', props: { type: 'doc' }, tags: ['retail'], links: ['Attachments/oven-manual.pdf'] },
  { path: 'Docs/My CV.md', props: { type: 'doc' }, tags: ['personal'], links: ['Attachments/cv.pdf'] },
  { path: 'Docs/Router.md', props: { type: 'doc', about: 'The house router and the network' }, tags: [], links: [] },
  { path: 'Meetings/2026-10-20 Kick-off.md', props: { type: 'meeting', project: '[[Harbour Fit-out]]' }, tags: [], links: ['Projects/Harbour Fit-out/Harbour Fit-out.md'] },
  { path: 'Home/Garden.md', props: {}, tags: [], links: [] },
  { path: 'Templates/Notes/Daily.md', props: {}, tags: [], links: [] },
  { path: 'Daily/2026-10-24.md', props: {}, tags: [], links: [] },
  { path: 'Inbox.md', props: {}, tags: [], links: [] },
  { path: 'Notes/Untitled.md', props: {}, tags: [], links: [] },
  { path: 'Plan.md', props: { area: 'Business' }, tags: [], links: [] },
];
const vaultFiles = () => ['Attachments/oven-manual.pdf', 'Attachments/cv.pdf', 'Attachments/stray.zip', 'Assets/Logos/logo.png', 'Projects/Harbour Fit-out/Files/plan.pdf', 'Docs/Router.canvas'];

test('migration: proposes each thing’s area from what the vault says, with why, and where it goes', () => {
  const { planMigration } = L.areaMigration;
  const areas = L.areas.defaultConfig().areas;
  const plan = planMigration({ notes: vaultNotes(), files: vaultFiles(), areas, places: { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily' }, joins: new Map([['People/Ana Ruiz.md', ['Projects/Harbour Fit-out/Harbour Fit-out.md']]]) });
  const of = (p) => plan.units.find((u) => u.path === p);
  // A project moves with its whole folder.
  const fit = of('Projects/Harbour Fit-out');
  assert.equal(fit.folder, true);
  assert.equal(fit.files, 3);
  assert.equal(fit.area, 'work');
  assert.equal(fit.to, 'Work/Projects/Harbour Fit-out');
  assert.match(fit.why.join(' '), /folder on the PC/);
  assert.equal(of('Projects/Desk Hub').sure, 'sure', 'tagged work');
  assert.equal(of('Projects/Winter Menu').area, 'work', 'its PC folder sits with the hub’s');
  assert.equal(of('Projects/Couch to 5k').area, 'health', 'a habit project');
  assert.equal(of('People/Ana Ruiz.md').area, 'work', 'named in a work project');
  assert.equal(of('People/Mia Chen.md').area, 'family');
  assert.equal(of('People/Mia Chen.md').to, 'Family/People/Mia Chen.md');
  assert.equal(of('Docs/My CV.md').area, 'me');
  assert.equal(of('Attachments/cv.pdf').area, 'me', 'a file goes with the note it is linked from');
  assert.equal(of('Attachments/cv.pdf').to, 'Me/Files/cv.pdf', 'the attachments folder’s files go in the area’s Files');
  assert.equal(of('Attachments/oven-manual.pdf').area, 'work');
  assert.equal(of('Meetings/2026-10-20 Kick-off.md').area, 'work');
  assert.equal(of('Docs/Router.md').area, 'home', 'a guess from the area’s own words');
  assert.equal(of('Docs/Router.md').sure, 'guess');
  assert.equal(of('Docs/Router.canvas').area, 'home', 'a canvas goes with its doc');
  assert.equal(of('Plan.md').to, 'Business/Notes/Plan.md', 'its area: says; a note at the top goes in Notes');
  assert.equal(of('Attachments/stray.zip').area, undefined, 'nothing says');
  assert.equal(of('Attachments/stray.zip').to, undefined);
  assert.equal(of('Notes/Untitled.md').sure, 'none');
  // What stays.
  assert.equal(of('Home/Garden.md'), undefined, 'already in an area');
  assert.equal(of('Templates/Notes/Daily.md'), undefined);
  assert.ok(plan.stays.some((s) => s.path === 'Templates'));
  assert.ok(plan.stays.some((s) => s.path === 'Daily'));
  assert.ok(plan.stays.some((s) => s.path === 'Inbox.md'));
  assert.ok(plan.stays.some((s) => s.path === 'Assets'));
  assert.equal(plan.units.filter((u) => u.path.startsWith('Projects/Harbour Fit-out/')).length, 0, 'a project’s own things move with it, not again');
});

test('migration: the person’s choices, the moves, and paths followed in Ironleaf’s own files', () => {
  const { planMigration, withChoices, movesOf, movedPaths, followPathsIn } = L.areaMigration;
  const areas = L.areas.defaultConfig().areas;
  const plan = planMigration({ notes: vaultNotes(), files: vaultFiles(), areas, places: { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily' } });
  const chosen = withChoices(plan, { 'Attachments/stray.zip': 'home', 'Docs/Router.md': '' }, areas);
  assert.equal(chosen.units.find((u) => u.path === 'Attachments/stray.zip').to, 'Home/Files/stray.zip');
  assert.equal(chosen.units.find((u) => u.path === 'Docs/Router.md').to, undefined, 'left where it is');
  const moves = movesOf(chosen);
  assert.ok(moves[0][0].startsWith('Projects/'), 'folders first');
  const all = [...vaultNotes().map((n) => n.path), ...vaultFiles()];
  const moved = movedPaths(moves, all);
  assert.equal(moved.get('Projects/Harbour Fit-out/Notes/Walkthrough.md'), 'Work/Projects/Harbour Fit-out/Notes/Walkthrough.md');
  const { value, changed } = followPathsIn({ project: 'Projects/Harbour Fit-out/Harbour Fit-out.md', id: 'project:Projects/Harbour Fit-out/Harbour Fit-out.md', node: { file: 'Docs/My CV.md#Skills' }, items: { 'Attachments/cv.pdf': 'personal' }, url: 'https://example.com/a/b', win: 'C:/Users/x' }, moved);
  assert.deepEqual(value, { project: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', id: 'project:Work/Projects/Harbour Fit-out/Harbour Fit-out.md', node: { file: 'Me/Docs/My CV.md#Skills' }, items: { 'Me/Files/cv.pdf': 'personal' }, url: 'https://example.com/a/b', win: 'C:/Users/x' });
  assert.equal(changed, 4);
  // Two things wanting one place: the second gets its own.
  const clash = planMigration({ notes: [{ path: 'People/Ana.md', props: { type: 'person' }, tags: ['work'], links: [] }, { path: 'Work/People/Ana.md', props: { type: 'person' }, tags: [], links: [] }], files: [], areas, places: {} });
  assert.equal(clash.units[0].to, 'Work/People/Ana (2).md');
});

// ── People and Organisations ─────────────────────────────────────────────────────────────────────────────────────────

function model(today = '2026-10-24') {
  const notes = [
    { path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', title: 'Harbour Fit-out', content: '---\ntype: project\nstatus: active\nowner: Ana Ruiz\n---\n# Harbour Fit-out\n\n## What’s next\n\n- [ ] Approve the lighting quote — Jordan Wu · by 2026-10-30\n- [ ] Send the floor plan — Thad Vance\n\n## People\n\n- **Jordan Wu** — Network\n- **Harbourline Signs Pty Ltd** — sign supplier\n- **Priya Shah** — Rollout lead\n', props: { type: 'project', status: 'active', owner: 'Ana Ruiz' } },
    { path: 'Work/People/Ana Ruiz.md', title: 'Ana Ruiz', content: '---\ntype: person\nrole: Cafe manager\norg: Bayside Bakery\nemail: ana@example.com\n---\n# Ana Ruiz\n', props: { type: 'person', role: 'Cafe manager', org: 'Bayside Bakery', email: 'ana@example.com' } },
    { path: 'Work/People/Thaddeus Vance.md', title: 'Thaddeus Vance', content: '---\ntype: person\nrole: Platforms\n---\n# Thaddeus Vance\n', props: { type: 'person', role: 'Platforms' } },
    { path: 'Work/Meetings/2026-10-20 Kick-off.md', title: '2026-10-20 Kick-off', content: '---\ntype: meeting\ndate: 2026-10-20\nattendees: [Ana Ruiz, Jordan Wu]\nproject: "[[Harbour Fit-out]]"\n---\n# Kick-off\n\n- [ ] Book the electrician — Jordan Wu\n', props: { type: 'meeting', date: '2026-10-20', attendees: ['Ana Ruiz', 'Jordan Wu'], project: '[[Harbour Fit-out]]' } },
  ];
  const byName = new Map(notes.map((n) => [n.title.toLowerCase(), n.path]));
  return L.records.buildRecordModel({ notes, files: [], resolve: (t) => byName.get(t.toLowerCase().replace(/\.md$/, '').split('/').pop()) ?? null, today });
}

test('people: cards from the records — role, organisation, contact, projects, meetings, last contact, open items', () => {
  const m = model();
  const { personCard, personCards } = L.people;
  const ana = personCard(m, 'person:ana ruiz');
  assert.equal(ana.page, true);
  assert.equal(ana.role, 'Cafe manager');
  assert.equal(ana.org.name, 'Bayside Bakery');
  assert.equal(ana.email, 'ana@example.com');
  assert.deepEqual(ana.projects.map((p) => p.title), ['Harbour Fit-out']);
  assert.equal(ana.meetings.length, 1);
  assert.deepEqual(ana.lastContact, { date: '2026-10-20', what: '2026-10-20 Kick-off', id: 'meeting:Work/Meetings/2026-10-20 Kick-off.md' });
  const jordan = personCard(m, 'person:jordan wu');
  assert.equal(jordan.page, false);
  assert.ok(jordan.open >= 2, 'the quote and the electrician are Jordan’s');
  const last = personCard(m, 'person:ana ruiz', { 'last contact': '2026-10-23' });
  assert.equal(last.lastContact.date, '2026-10-23', 'their page’s last contact when later');
  const cards = personCards(m);
  assert.ok(cards.some((c) => c.type === 'org' && c.name === 'Harbourline Signs Pty Ltd'));
  assert.equal(cards.findIndex((c) => c.type === 'org') > cards.findIndex((c) => c.type === 'person'), true, 'people first');
});

test('people: the people named without a card, and two names that are one person', () => {
  const m = model();
  const { cardSuggestions, samePeople, samePairKey, cardText } = L.people;
  const names = cardSuggestions(m).map((s) => s.name);
  assert.ok(names.includes('Jordan Wu'));
  assert.ok(names.includes('Priya Shah'));
  assert.ok(!names.includes('Ana Ruiz'), 'she has a card');
  const jordan = cardSuggestions(m).find((s) => s.name === 'Jordan Wu');
  assert.deepEqual(jordan.projects, ['Work/Projects/Harbour Fit-out/Harbour Fit-out.md']);
  const same = samePeople(m);
  assert.equal(same.length, 1);
  assert.equal(same[0].keepName, 'Thaddeus Vance', 'the one with a page is kept');
  assert.equal(same[0].otherName, 'Thad Vance');
  assert.match(same[0].why, /Thad is short for Thaddeus/);
  assert.equal(samePeople(m, new Set([samePairKey(same[0].keep, same[0].other)])).length, 0, 'said not the same: not offered again');
  const text = cardText({ name: 'Mia Chen', type: 'person', role: 'Daughter', area: 'Family', sensitivity: 'Family-private', projects: ['Family/Projects/School/School.md'] });
  assert.match(text, /^---\ntype: person\nrole: Daughter\narea: Family\nsensitivity: Family-private\n---\n# Mia Chen\n\nNamed in \[\[School\]\]\./);
  assert.match(cardText({ name: 'Harbourline Signs', type: 'org' }), /type: organisation/);
});

test('people: a first name alone, or a name two people could have, is never merged', () => {
  const notes = [
    { path: 'People/Darcy Lin.md', title: 'Darcy Lin', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/Darcy North.md', title: 'Darcy North', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/D Lin.md', title: 'D Lin', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/Dana Lin.md', title: 'Dana Lin', content: '---\ntype: person\n---\n', props: { type: 'person' } },
  ];
  const m = L.records.buildRecordModel({ notes, files: [], resolve: () => null, today: '2026-10-24' });
  assert.deepEqual(L.people.samePeople(m), [], 'D Lin could be Darcy or Dana; Darcy Lin and Darcy North are two people');
});

test('people: a last initial and a nickname suggest one person, never when two could match (9.5 fourth pass)', () => {
  const notes = [
    { path: 'People/Alex Morgan.md', title: 'Alex Morgan', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/Alex M.md', title: 'Alex M', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/Bob Jones.md', title: 'Bob Jones', content: '---\ntype: person\n---\n', props: { type: 'person' } },
    { path: 'People/Robert Jones.md', title: 'Robert Jones', content: '---\ntype: person\n---\n', props: { type: 'person' } },
  ];
  const m = L.records.buildRecordModel({ notes, files: [], resolve: () => null, today: '2026-10-24' });
  const same = L.people.samePeople(m);
  assert.ok(same.some((s) => [s.keepName, s.otherName].includes('Alex M') && [s.keepName, s.otherName].includes('Alex Morgan')), 'a last initial suggests');
  assert.ok(same.some((s) => [s.keepName, s.otherName].includes('Bob Jones') && [s.keepName, s.otherName].includes('Robert Jones')), 'a nickname suggests');
  const crowded = [...notes, { path: 'People/Alex Murphy.md', title: 'Alex Murphy', content: '---\ntype: person\n---\n', props: { type: 'person' } }];
  const m2 = L.records.buildRecordModel({ notes: crowded, files: [], resolve: () => null, today: '2026-10-24' });
  assert.ok(!L.people.samePeople(m2).some((s) => [s.keepName, s.otherName].includes('Alex M')), 'Alex M could be Morgan or Murphy: never offered');
});

test('people: one address written two ways still matches (9.5 fourth pass)', () => {
  const notes = [
    { path: 'People/Sam Okafor.md', title: 'Sam Okafor', content: '---\ntype: person\n---\n', props: { type: 'person', email: 'Sam <sam@x.com>' } },
    { path: 'People/Sam Okoro.md', title: 'Sam Okoro', content: '---\ntype: person\n---\n', props: { type: 'person', email: 'sam@x.com' } },
  ];
  const m = L.records.buildRecordModel({ notes, files: [], resolve: () => null, today: '2026-10-24' });
  const same = L.people.samePeople(m);
  assert.equal(same.length, 1);
  assert.match(same[0].why, /Both give sam@x\.com/);
});

test('people: a last name alone links when one person in the project has it (9.5 fourth pass)', () => {
  const shop = (extra) => ({
    path: 'Work/Projects/Shop/Shop.md',
    title: 'Shop',
    content: `---\ntype: project\nstatus: active\nowner: Alex Lee\n---\n# Shop\n\n## What’s next\n\n- [ ] Call back — Lee\n${extra}`,
    props: { type: 'project', status: 'active', owner: 'Alex Lee' },
  });
  const solo = L.records.buildRecordModel({ notes: [shop('')], files: [], resolve: () => null, today: '2026-10-24' });
  assert.ok(L.people.personCard(solo, 'person:alex lee').owesYouItems.some((a) => a.title.includes('Call back')), 'the step owned by Lee is Alex’s');
  const two = L.records.buildRecordModel({ notes: [shop('\n## People\n\n- **Sam Lee** — Mentor\n')], files: [], resolve: () => null, today: '2026-10-24' });
  assert.equal(L.people.personCard(two, 'person:alex lee').owesYou, 0, 'two Lees in the project: no guess');
});

test('people: make-cards skips names already on a card and repeats in the run, never "Name 2"', () => {
  assert.deepEqual(
    L.people.pickNewCards(['New Person', 'new  person', 'Ava Reed', 'Sam Okafor'], ['Sam Okafor', 'Ava Reed']),
    [true, false, false, false],
    'first spelling made; in-run repeat and existing cards skipped',
  );
});

// ── Inbox ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const INBOX = `# Inbox

## Captured

- 24 Oct 2026 09:12 — Ask Jordan Wu about the switch for Harbour Fit-out
- [ ] Book the oven service — 24 Oct 2026 09:30
- 24 Oct 2026 10:02 — Photo from the market
  ![[Attachments/market.jpg]]
- 24 Oct 2026 10:15 — Read about [[Couch to 5k]] week two

## Filed

- An old thing
`;

test('inbox: its items as captured, each found again, taken out and turned into a note or a step', () => {
  const { inboxLines, withoutItem, itemTitle, itemNoteText, itemStep, itemLines } = L.inbox;
  const items = inboxLines(INBOX);
  assert.equal(items.length, 4, 'what was filed isn’t an item');
  assert.equal(items[0].words, 'Ask Jordan Wu about the switch for Harbour Fit-out');
  assert.equal(items[0].stamp, '24 Oct 2026 09:12');
  assert.equal(items[1].task, true);
  assert.equal(items[1].words, 'Book the oven service');
  assert.deepEqual(items[2].embeds, ['Attachments/market.jpg']);
  assert.equal(items[2].to - items[2].from, 1, 'the picture under it is part of it');
  assert.deepEqual(items[3].links, ['Couch to 5k']);
  const after = withoutItem(INBOX, items[2]);
  assert.ok(!after.includes('market.jpg'));
  assert.equal(inboxLines(after).length, 3);
  assert.ok(after.includes('## Filed\n\n- An old thing'), 'everything else as it was');
  const moved = withoutItem(`# Inbox\n\nNew line on top\n\n${INBOX.slice(8)}`, items[0]);
  assert.ok(moved && !moved.includes('Ask Jordan'), 'found again by its words after the note changed');
  assert.equal(withoutItem('# Inbox\n', items[0]), null);
  assert.equal(itemTitle(items[0]), 'Ask Jordan Wu about the switch for Harbour');
  assert.equal(itemTitle({ words: '', embeds: ['Attachments/market.jpg'] }), 'market');
  assert.equal(itemTitle({ words: 'Idea: a crossword about the long weekend for the next paper', embeds: [] }), 'A crossword about the long weekend', 'no label, never ending on a little word');
  assert.equal(itemNoteText(items[2], 'idea'), '---\ntype: idea\ncaptured: 24 Oct 2026 10:02\n---\nPhoto from the market\n![[Attachments/market.jpg]]\n');
  assert.equal(itemStep(items[1]), 'Book the oven service');
  assert.match(itemNoteText(items[1], 'task'), /^- \[ \] Book the oven service$/m, 'filed as a task, the tick-box stays');
  assert.doesNotMatch(itemNoteText(items[1], 'task'), /^type: /m, 'no meaningless type line');
  assert.doesNotMatch(itemNoteText(items[1], 'note'), /^- \[ \]/m, 'filed as a note, plain words');
  assert.deepEqual(itemLines(items[2]), ['- 24 Oct 2026 10:02 — Photo from the market', '  ![[Attachments/market.jpg]]']);
});

test('inbox: where it probably goes, from the vault’s own structure only', () => {
  const { inboxLines, suggestFiling } = L.inbox;
  const items = inboxLines(INBOX);
  const ctx = {
    projects: [
      { path: 'Work/Projects/Harbour Fit-out/Harbour Fit-out.md', name: 'Harbour Fit-out', people: ['Jordan Wu'], tags: [], modified: 0, area: 'work' },
      { path: 'Health/Projects/Couch to 5k/Couch to 5k.md', name: 'Couch to 5k', people: [], tags: [], modified: 0, area: 'health' },
    ],
    people: [{ name: 'Jordan Wu', path: 'Work/People/Jordan Wu.md', names: [], area: 'work' }],
    areas: [{ id: 'work', name: 'Work' }, { id: 'health', name: 'Health' }],
    resolve: (t) => (t === 'Couch to 5k' ? 'Health/Projects/Couch to 5k/Couch to 5k.md' : null),
    now: 0,
  };
  const first = suggestFiling(items[0], ctx);
  assert.equal(first[0].target.kind, 'project');
  assert.equal(first[0].target.name, 'Harbour Fit-out');
  assert.ok(first.some((s) => s.target.kind === 'person' && s.target.name === 'Jordan Wu'));
  assert.ok(first.some((s) => s.target.kind === 'area' && s.target.area === 'work'));
  const named = suggestFiling({ words: 'Read about the Oven Runbook steps again', text: '', links: [], task: false }, { ...ctx, notes: [{ title: 'Oven runbook', path: 'Work/Docs/Oven runbook.md', area: 'work' }] });
  assert.deepEqual(named.map((s) => [s.target.kind, s.target.name]), [['note', 'Oven runbook'], ['area', 'Work']], 'a note it names, and that note’s area');
  const linked = suggestFiling(items[3], ctx);
  assert.equal(linked[0].why, 'Links to Couch to 5k');
  assert.deepEqual(suggestFiling(items[1], ctx), [], 'nothing in it points anywhere: no guess');
});

// ── Tags ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('tags: colour codes and numbers are not tags; a word that looks like hex stays one', () => {
  const { extractTags, isNotATag } = L.markdown;
  assert.deepEqual(extractTags('Brand red #CF0A2C, grey #5A6067 and #ff0; issue #12; #facade #weekly-update #c0ffee'), ['facade', 'weekly-update']);
  assert.equal(isNotATag('D6D9DC'), true);
  assert.equal(isNotATag('cafe'), false);
});

test('tags: renamed, merged and taken off in the words and the tags property, the rest as written', () => {
  const { renameTag, removeTag, tagUses, similarTags, cleanTag } = L.tags;
  const note = '---\ntitle: Visit\ntags: [av, site]\n---\n# Visit\n\nRooms checked #av and #av/rooms, not #avid. `#av in code`\n';
  assert.equal(renameTag(note, 'av', 'AV'), '---\ntitle: Visit\ntags: [AV, site]\n---\n# Visit\n\nRooms checked #AV and #AV/rooms, not #avid. `#av in code`\n');
  assert.equal(removeTag(note, 'av'), '---\ntitle: Visit\ntags: [site]\n---\n# Visit\n\nRooms checked and, not #avid. `#av in code`\n');
  // Merged into one already there: once.
  assert.match(renameTag('---\ntags:\n  - site\n  - visit\n---\nx #visit\n', 'visit', 'site'), /tags:\n {2}- site\n---\nx #site\n/);
  assert.equal(renameTag('no tags here', 'a', 'b'), 'no tags here');
  assert.equal(cleanTag('#Weekly update'), 'Weekly-update');
  assert.equal(cleanTag('#CF0A2C'), null);
  const uses = tagUses([{ path: 'a.md', tags: ['AV', 'site'] }, { path: 'b.md', tags: ['av'] }, { path: 'Templates/t.md', tags: ['template'] }], (p) => p.startsWith('Templates/'));
  assert.deepEqual(uses.map((u) => [u.tag, u.count]).sort(), [['AV', 1], ['av', 1], ['site', 1]]);
  assert.deepEqual(similarTags(uses).map(([a, b]) => [a.tag, b.tag]), [['AV', 'av']]);
});

// 26 Oct 2026. A home server project drawn with the venture layout went to Business on that alone; a layout is now only a
// hint, and what reading the thing says places it (and its doc).
test('a layout alone never decides an area; a reading does, and the doc of the same name follows', () => {
  const { planMigration } = L.areaMigration;
  const areas = L.areas.defaultConfig().areas;
  const notes = [
    { path: 'Projects/Game Box/Game Box.md', props: { type: 'project', layout: 'venture' }, tags: [], links: [] },
    { path: 'Docs/Game Box.md', props: { type: 'doc' }, tags: [], links: [] },
  ];
  const places = { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily' };
  const before = planMigration({ notes, files: [], areas, places });
  assert.notEqual(before.units.find((u) => u.path === 'Projects/Game Box').area, 'business', 'the venture layout no longer sends it to Business');
  const readings = new Map([['Projects/Game Box', { area: 'home', why: 'Read as a game server at home' }]]);
  const after = planMigration({ notes, files: [], areas, places, readings });
  const project = after.units.find((u) => u.path === 'Projects/Game Box');
  assert.deepEqual([project.area, project.sure, project.to], ['home', 'likely', 'Home/Projects/Game Box']);
  assert.ok(project.why.includes('Read as a game server at home'), 'the preview says why');
  assert.equal(after.units.find((u) => u.path === 'Docs/Game Box.md').area, 'home', 'its doc of the same name goes with it');
});
