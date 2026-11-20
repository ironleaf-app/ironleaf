// node --test tests/w3b-packs-87.test.mjs — the Vault redesign, life half (8.7 w3b): Family, Health, House,
// Vehicles, Travel, Goals, Lists and Weekly render the mock-ups' pages (the kit's shapes, the one page
// head, key facts, home-card strip) wired to the packs' real data and actions, with every record deletable to the
// Bin and the previous layout kept behind "classic". Memories' overview merged into Family (packs uplift item 5);
// its album page stands under Family. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const PACKS = [
  { id: 'family', file: 'src/renderer/src/views/modules/FamilyPage.tsx', view: 'Family87', classic: 'FamilyClassic' },
  { id: 'health', file: 'src/renderer/src/views/modules/HealthPage.tsx', view: 'Health87', classic: 'HealthClassic' },
  { id: 'house', file: 'src/renderer/src/views/modules/personal/HousePage.tsx', view: 'House87', classic: 'HouseClassic' },
  { id: 'vehicles', file: 'src/renderer/src/views/modules/personal/VehiclesPage.tsx', view: 'Vehicles87', classic: 'VehiclesClassic' },
  { id: 'travel', file: 'src/renderer/src/views/modules/personal/TravelPage.tsx', view: 'Travel87', classic: 'TravelClassic' },
  // Packs uplift item 5: no memories row — its overview merged into Family (family#albums, the previous layout's
  // albums tabs and the album page below).
  { id: 'goals', file: 'src/renderer/src/views/modules/life/GoalsPage.tsx', view: 'Goals87', classic: 'GoalsClassic' },
  { id: 'lists', file: 'src/renderer/src/views/modules/life/ListsPage.tsx', view: 'Lists87', classic: 'ListsClassic' },
  { id: 'weekly', file: 'src/renderer/src/views/modules/work/WeeklyPage.tsx', view: 'Weekly87', classic: 'WeeklyClassic' },
];

test('every pack page routes to its 8.7 views, keeping the previous layout', () => {
  for (const p of PACKS) {
    const src = read(p.file);
    assert.ok(src.includes(`from '../w3b/${p.view}'`) || src.includes(`from './w3b/${p.view}'`), `${p.id} imports its 8.7 views`);
    assert.ok(src.includes(`export function ${p.classic}(`), `${p.id} keeps its previous layout`);
    assert.ok(src.includes("'classic'"), `${p.id} answers the classic escape`);
  }
});

test('every 8.7 view stands in the one page shape with key facts', () => {
  const heads = { Family87: 'Family', Health87: 'Health', House87: 'House', Vehicles87: 'Cars', Travel87: 'Trips', Goals87: 'Goals', Lists87: 'Lists', Weekly87: 'Weekly' };
  for (const [view, title] of Object.entries(heads)) {
    const src = read(`src/renderer/src/views/modules/w3b/${view}.tsx`);
    assert.ok(src.includes('PackPage') && src.includes('PackHead'), `${view} uses the pack page and head`);
    assert.ok(src.includes('PageProps'), `${view} shows key facts in the shared shape`);
    assert.ok(src.includes(`title="${title}"`) || src.includes(`title={\`${title},`) || src.includes(`title={<span className="clip">${title}`), `${view} keeps the mock-up's words`);
    assert.ok(src.includes('HomeCard'), `${view} names what Home shows`);
  }
});

test('the album page stands in the one page shape with key facts', () => {
  // Packs uplift item 5: the overview merged into Family, but an album's page keeps the shape.
  const src = read('src/renderer/src/views/modules/w3b/Memories87.tsx');
  for (const bit of ['PackPage', 'PackHead', 'PageProps', 'HomeCard', '<RecordFormHost />']) assert.ok(src.includes(bit), `AlbumDetail keeps ${bit}`);
});

test('every inner screen exists with the mock-up’s sections', () => {
  const screens = [
    ['Family87', 'MemberDetail', ['Milestones', 'Reward trackers', 'Papers and albums']],
    ['Health87', 'CheckinDetail', ['>Done</button>']],
    ['House87', 'ApplianceDetail', ['Manual and receipt', 'If it breaks down']],
    ['Vehicles87', 'VehicleDetail', ['Distance log', 'Service history']],
    ['Travel87', 'TripDetail', ['Checklist', 'Spend against budget']],
    ['Memories87', 'AlbumDetail', ['Photo search', 'Photos']],
    ['Family87', 'PersonDetail', ['Reading your albums', 'No photos of them yet']],
    ['Family87', 'CreativeDetail', ['It isn’t here any more', 'Creative projects']],
    ['Goals87', 'GoalsReview', ['Look-back', 'Earlier weeks']],
    ['Lists87', 'ListDetail', ['Still needed']],
    ['Weekly87', 'WeeklyDraft', ['Draft ·', 'Sources']],
  ];
  for (const [view, fn, bits] of screens) {
    const src = read(`src/renderer/src/views/modules/w3b/${view}.tsx`);
    assert.ok(src.includes(`export function ${fn}(`), `${view} exports ${fn}`);
    for (const b of bits) assert.ok(src.includes(b), `${fn} keeps ${b}`);
  }
});

test('one primary button per screen', () => {
  // An overview and its inner screen never show together; each keeps at most one.
  const parts = { Family87: ['FamilyOverview', 'MemberDetail', 'PersonDetail', 'CreativeDetail'], Health87: ['HealthOverview', 'CheckinDetail'], House87: ['HouseOverview', 'ApplianceDetail'], Vehicles87: ['VehiclesOverview', 'VehicleDetail'], Travel87: ['TravelOverview', 'TripDetail'], Memories87: ['AlbumDetail'], Goals87: ['GoalsOverview', 'GoalsReview'], Lists87: ['ListsOverview', 'ListDetail'], Weekly87: ['WeeklyOverview', 'WeeklyDraft'] };
  for (const [view, fns] of Object.entries(parts)) {
    const src = read(`src/renderer/src/views/modules/w3b/${view}.tsx`);
    for (const fn of fns) {
      const at = src.indexOf(`export function ${fn}(`);
      assert.ok(at > 0, `${view} ${fn} exists`);
      const next = Math.min(...fns.map((o) => (o === fn ? Infinity : src.indexOf(`export function ${o}(`, at + 1))).filter((i) => i > 0), src.length);
      const body = src.slice(at, next === Infinity ? undefined : next);
      const primaries = body.match(/btn pri/g) ?? [];
      // Weekly's overview shows either Send (a draft) or Start (no week), never both.
      assert.ok(primaries.length <= (view === 'Weekly87' && fn === 'WeeklyOverview' ? 2 : 1), `${fn} keeps one primary (has ${primaries.length})`);
    }
  }
});

test('no em dashes in the new UI words', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(!src.includes('—'), `${p.view} has no em dash`);
  }
  assert.ok(!read('src/renderer/src/views/modules/w3b/W3b.tsx').includes('—'), 'W3b has no em dash');
});

test('the 8.7 styles use theme tokens and tints only, never fixed greys or cream', () => {
  const css = read('src/renderer/src/styles/w3b-packs.css');
  assert.equal(css.match(/#[0-9a-f]{6}/gi)?.length ?? 0, 0, 'no fixed colours in w3b-packs.css');
  const main = read('src/renderer/src/main.tsx');
  assert.ok(!main.includes('w3b-packs.css'), 'the pack styles load from their own views, leaving the kit last');
  const shell = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(shell.includes('styles/w3b-packs.css'), 'the shell loads the pack styles');
});

test('every pack deletes whole records to the Bin, never for good', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    // Health lives in the encrypted store on this PC, not in notes: each answer saves at once through the store.
    if (p.id === 'health') assert.ok(src.includes('H().entry(m.id, today, v)') && !src.includes('saveAll'), 'Health87 saves each answer at once through the store');
    else assert.ok(src.includes('trashRecord'), `${p.view} deletes to the Bin`);
  }
  const shell = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(shell.includes('A.trashPath'), 'trashRecord moves to Recently deleted with Undo');
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.doesNotMatch(src, /files\.remove\(|\.unlink\(|rmSync\(|rmdir\(/, `${p.view} never deletes for good`);
  }
});

test('the pack ask box asks the helper in the side chat with the page as scope', () => {
  // 9.2 uplift F19: the one shared box lives in components/ScopedAsk.tsx; W3b renders it.
  const box = read('src/renderer/src/components/ScopedAsk.tsx');
  assert.ok(box.includes('askInChat(') && box.includes(', scope)'), 'AskFloat asks with scope');
  const shell = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(shell.includes('<ScopedAsk'), 'W3b renders the one box');
  for (const view of ['Family87', 'House87', 'Vehicles87', 'Travel87']) {
    const src = read(`src/renderer/src/views/modules/w3b/${view}.tsx`);
    assert.ok(src.includes('<AskFloat'), `${view} keeps the ask box on its inner screen`);
  }
});

test('the packs honour being switched off and their parts', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(src.includes('useCanEdit') || src.includes('canEdit'), `${p.view} reads whether it can change things`);
  }
  const family = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  assert.ok(family.includes("usePartOn('family', 'calendar')"), 'family hides parts switched off');
  const health = read('src/renderer/src/views/modules/w3b/Health87.tsx');
  assert.ok(health.includes("partOn(sw, 'health'"), 'health hides parts switched off');
});

test('the weekly draft gathers from projects with sources and Undo', () => {
  const src = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  // 9.2 uplift F116: all gathers run through the one shared guard (once per week, read failures heard).
  assert.ok(src.includes('gatherWeek(u'), 'the draft gathers through the one guard');
  assert.ok(read('src/renderer/src/views/modules/work/WeeklyPage.tsx').includes("call<string>('gather', u.path)"), 'the guard gathers from the projects’ own words');
  assert.ok(src.includes('className="cite"'), 'every gathered line shows its source');
  assert.ok(src.includes('Undo this draft') && src.includes('notes.write(u.path, undoText)'), 'the draft undoes word for word');
});

test('round 2: pack pages stand full width, with the crumb in the top bar and no back link above the title', () => {
  const shell = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(shell.includes('nv-page full w3b-page'), 'PackPage is the full page width with 32 px sides');
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(!src.includes('w3b-back'), `${p.view} has no back link above the title`);
  }
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('Packs') && header.includes('packDetail'), 'the top bar crumbs Packs / pack / record');
});

test('round 2: no title is ever cut mid-word', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(!src.includes('title={<span className="clip">'), `${p.view} never clips a page title to one line`);
  }
  const travel = read('src/renderer/src/views/modules/w3b/Travel87.tsx');
  assert.ok(travel.includes('tripRangeWords(x)'), 'a trip’s title is its name and short range');
  assert.ok(!travel.includes('tripDates(x, m.today)}'), 'no long dates in titles or lists');
});

test('round 2: the tour link under the title is gone; the tour stays in ⋯ and the command list', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(!src.includes('ModuleTour'), `${p.view} has no tour link under the title`);
    assert.ok(src.includes('Show me around '), `${p.view} keeps the tour in its ⋯ menu`);
  }
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("'tour-pack'") && commands.includes('Show me around this pack'), 'the command list opens the tour for the pack in front');
  const registry = read('src/renderer/src/views/modules/registry.ts');
  assert.ok(registry.includes('link: false'), 'every pack page mounts its tour for ⋯, the list and Settings');
});

test('round 2: no Share button on pack pages; Copy link stays in ⋯', () => {
  for (const p of PACKS) {
    const src = read(`src/renderer/src/views/modules/w3b/${p.view}.tsx`);
    assert.ok(!src.includes('>Share<'), `${p.view} has no Share button`);
  }
  // Health’s check-in is not a note, so it has no link; every other inner screen copies one from ⋯.
  for (const view of ['Family87', 'House87', 'Vehicles87', 'Travel87', 'Memories87', 'Goals87', 'Lists87', 'Weekly87']) {
    const src = read(`src/renderer/src/views/modules/w3b/${view}.tsx`);
    assert.ok(src.includes("'Copy link'"), `${view} keeps Copy link in ⋯`);
  }
});

test('round 2: a list’s rows drop the tag the section already says', () => {
  const src = read('src/renderer/src/views/modules/w3b/Lists87.tsx');
  assert.ok(src.includes('row(i, show === \'all\')'), 'tags show only where sections mix');
  assert.ok(!src.includes('Add with detail'), 'no primary button the mock-up lacks');
});

test('round 2: the packs use the short names, and the old names still find them', () => {
  const catalogue = read('src/shared/life-modules.ts');
  for (const [id, name] of [['health', 'Health'], ['house', 'House'], ['vehicles', 'Cars'], ['travel', 'Trips'], ['weekly', 'Weekly'], ['goals', 'Goals'], ['lists', 'Lists']]) {
    assert.ok(catalogue.includes(`id: '${id}',\n    name: '${name}'`), `${id} is called ${name}`);
  }
  // Packs uplift item 5: no Memories pack; the old name still finds Family (asserted below with the old names).
  for (const old of ['Health and Fitness', 'Memories and Media', 'Goals and Habits', 'Reading, Watching and Lists', 'Reading Watching and Lists', 'Weekly Update']) {
    assert.ok(catalogue.includes(`'${old}'`), `the catalogue still answers to ${old}`);
  }
  assert.ok(catalogue.includes("aliases: ['Home']") && catalogue.includes("aliases: ['Vehicles']") && catalogue.includes("aliases: ['Travel']"), 'Home, Vehicles and Travel still find their packs');
  const search = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(search.includes('moduleEntries'), 'Settings search lists every pack with its earlier names');
});
