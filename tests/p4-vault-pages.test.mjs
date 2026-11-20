// node --test tests/p4-vault-pages.test.mjs — Vault pages polish (4 Nov 2026, fourth
// wave): one name for assets ("Files and assets", kit "Brand kit" singular), kit
// chips on Notes/People/Templates/Assets filters, cool-hue people avatars, meter
// bars in theme data colours, plain Meetings tour words, and every clipped list
// row carrying its full text on hover. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const view = (f) => read(`src/renderer/src/views/${f}`);

test('one name for assets: Files and assets everywhere, Brand kit singular', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes("label: 'Files and assets'"), 'More says Files and assets');
  assert.ok(!places.includes('Assets and brand kits'), 'More drops the old name');
  const abilities = read('src/shared/abilities.ts');
  assert.ok(abilities.includes("title: 'Files and assets'"), 'search says Files and assets');
  assert.ok(!abilities.includes('Assets and brand kits'), 'search drops the old name');
  assert.ok(view('AssetsPage.tsx').includes('title="Files and assets"'), 'page keeps its title');
  for (const [name, src] of [['Places', places], ['abilities', abilities]]) {
    assert.ok(!/brand kits/i.test(src.replace(/brandKits/g, '')), `${name} has no brand-kits plural in product words`);
  }
  // Several kits are real now (one per area or project, 5 Nov 2026): the page pluralises only where it counts past
  // one kit (the highlights label and the section lead, both behind `kits?.length > 1`); the section keeps its
  // singular name everywhere else.
  const assetsPage = view('AssetsPage.tsx');
  assert.ok(assetsPage.includes('label="Brand kit"'), 'the section keeps its singular name');
  const oneKit = assetsPage.split('\n').filter((l) => !/kits\?\.\length \?\? 0\) > 1/.test(l)).join('\n');
  assert.ok(!/brand kits/i.test(oneKit.replace(/brandKits/g, '')), 'AssetsPage pluralises only past one kit');
  assert.ok(assetsPage.includes('Brand kits · ${'), 'the highlights label counts past one');
  assert.ok(assetsPage.includes('Your brand kits: colours, fonts and logos, one per area or project.'), 'the lead says one per area or project');
  assert.ok(assetsPage.includes('Brand kit'), 'kit stays singular');
});

test('Templates and Assets filters wear the kit chips, as Notes and People', () => {
  for (const f of ['NotesPage.tsx', 'PeoplePage.tsx']) assert.ok(view(f).includes('className={`chip'), `${f} reference chips`);
  const tpl = view('TemplatesPage.tsx');
  assert.ok(tpl.includes('className="chips tp-filters"'), 'templates strip is chips');
  assert.ok(tpl.includes('className={`chip'), 'templates buttons are chips');
  assert.ok(tpl.includes('<span className="n">'), 'templates counts are chip counts');
  assert.ok(!tpl.includes('`tp-filter') && !tpl.includes('tp-count'), 'templates drops its own filter buttons');
  assert.ok(!tpl.includes('tp-filter active'), 'no active filter class');
  const tcss = read('src/renderer/src/styles/templates.css');
  assert.ok(!tcss.includes('.tp-filter ') && !tcss.includes('.tp-filter.') && !tcss.includes('.tp-filter{') && !tcss.includes('.tp-count'), 'dead filter rules gone');
  assert.ok(tcss.includes('.tp-filters'), 'strip spacing kept');
  const assets = view('AssetsPage.tsx');
  assert.ok(assets.includes('className={`chip'), 'assets FilterChip is a chip');
  // Layout round 2 (20 Nov 2026): one row of kind chips; areas, collections and tags are dropdowns, New
  // collection the last line of the Collection one.
  assert.ok(assets.includes('<FilterMenu') && assets.includes("label: 'New collection…'"), 'assets adds a collection from its dropdown');
  assert.ok(read('src/renderer/src/components/FilterMenu.tsx').includes('chip nv-filter-menu'), 'the dropdowns wear the kit chip');
  assert.ok(!assets.includes('w4b-fchip'), 'assets drops its own filter look');
  const pcss = read('src/renderer/src/styles/page-states-87.css');
  assert.ok(pcss.includes('.w4b-fstrip-chips .chip'), 'strip chips keep their room');
  assert.ok(pcss.includes('.chip.is-add'), 'dashed add kept');
  assert.ok(!pcss.includes('.w4b-fchip'), 'dead filter rules gone');
});

test('people avatars use the grid cool hues, never coral-by-hash', () => {
  const list = view('PeoplePage.tsx');
  assert.ok(list.includes('pc-avatar w2b-pava'), 'rows wear pc-avatar');
  assert.ok(list.includes('personHue(c.name)'), 'rows hue by name');
  assert.ok(!list.includes('personTint'), 'no tint lottery in the list');
  assert.ok(!list.includes('pava w2b-pava'), 'no pava rows');
  const person = view('PersonPage.tsx');
  assert.ok(person.includes('pc-avatar w2b-avatar'), 'person head wears pc-avatar');
  assert.ok(person.includes('personHue(card.name)'), 'head hues by name');
  assert.ok(!person.includes('personTint'), 'no tint lottery on the head');
  const css = read('src/renderer/src/styles/w2b.css');
  assert.ok(css.includes('.pc-avatar.w2b-pava') && css.includes('.pc-avatar.w2b-avatar'), 'row and head sizes kept');
  const look = read('src/renderer/src/lib/projectLook.ts');
  assert.ok(look.includes('return 150 + (h % 100)'), 'hues stay in the cool 150-250 range');
});

test('meter bars use theme data colours: green ok, amber near, coral over (attention, DECISIONS 3)', () => {
  const css = read('src/renderer/src/styles/packs-87.css');
  assert.match(css, /\.p87-meter \.bar > span \{[^}]*var\(--green-tx\)/, 'normal is green');
  assert.match(css, /\.p87-meter\.near \.bar > span \{[^}]*var\(--amber-tx\)/, 'near is amber');
  assert.match(css, /\.p87-meter\.over \.bar > span \{[^}]*var\(--coral\)/, 'over is coral (the one thing that needs attention), not amber');
});

test('every clipped list row carries its full text for hover', () => {
  // t102 (9 Nov 2026) reads the snippet once per row into snip instead of three inline calls; the clipped
  // row still carries the full text as its hover title.
  const notes = view('NotesPage.tsx');
  assert.ok(notes.includes('const snip = snippetForDisplay(r.snippet'), 'notes snippets title');
  assert.ok(notes.includes('<span className="clip" title={snip}>{snip}</span>'), 'notes clipped row hovers its full text');
  const people = view('PeoplePage.tsx');
  assert.ok(people.includes('title={`${c.name}'), 'people names title');
  assert.ok(people.includes("title={show === 'orgs'"), 'people second lines title');
  assert.ok(view('TemplatesPage.tsx').includes('title={ds}'), 'templates descriptions title');
  assert.ok(read('src/renderer/src/views/assets/AssetGrid.tsx').includes('title={place?.(a)'), 'assets places title');
});

test('Meetings tour words stay plain (guard)', () => {
  const page = view('modules/work/MeetingsPage.tsx');
  assert.ok(page.includes('Show me around Meetings'), 'meetings menu plain');
  assert.ok(page.includes('Show me around ${name}'), 'series menu plain');
  assert.ok(!page.includes('Show the tour'), 'no tour words');
  assert.ok(read('src/renderer/src/state/commands.ts').includes('Show me around'), 'palette plain');
});

// 4 Nov 2026 reviewer: every People row carried a solid coral "Owes you" block; like project health (sweep D) it is a
// quiet neutral chip with the one coral dot.
test('People rows: Owes you is a quiet chip with the coral dot, never a solid coral block', () => {
  const tsx = read('src/renderer/src/views/PeoplePage.tsx');
  assert.doesNotMatch(tsx, /tag coral w2b-tag/, 'no solid coral chip on people rows');
  assert.match(tsx, /<span className="tag slate w2b-tag"><span className="dot" aria-hidden="true" \/>Owes you \{c\.owesYou\}<\/span>/);
});
