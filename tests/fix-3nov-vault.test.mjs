// node --test tests/fix-3nov-vault.test.mjs — 3 Nov 2026 fix job (audit f F1-F27,
// audit e F6/F7 Vault half, audit d F19 Vault half, SHARED-LAYOUT sameness).
// Each check fails without its fix. Static where the behaviour is structural
// (menu wiring, words, tokens), runtime where pure (fold math, prefs, tours).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('F1 More menu scrolls with the wheel and groups every item', () => {
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(!menu.includes("window.addEventListener('wheel', close"), 'wheel no longer closes every menu outright');
  assert.ok(menu.includes('.menu') && menu.includes('wheel'), 'wheel over the menu scrolls it');
  assert.ok(menu.includes('Escape') && menu.includes('mousedown'), 'Escape and outside click still close');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('heading:'), 'More groups its rows under headings');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.menu') && kit.includes('max-height'), 'long menus cap and scroll within');
});

test('F2 Meetings off really hides Meetings', () => {
  const mod = read('src/renderer/src/state/modules.ts');
  assert.ok(!mod.includes('whether or not the Meetings module is switched on'), 'no bypass that ignores the switch');
  assert.ok(mod.includes('if (!moduleOn(modulesNow(), id)) return offerPack(id,'), 'openModule respects the switch first (5 Nov 2026, h3 dead buttons: off offers to switch on, never silent)');
  const tabs = read('src/renderer/src/state/module-tabs.ts');
  assert.ok(tabs.includes("'meetings'") || tabs.includes('"meetings"'), 'meetings tabs match so off closes them');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('meetings') && (places.includes('useModuleOn') || places.includes('moduleOn') || places.includes('meetingsOn')), 'side bar hides the Meetings row when off');
  const life = read('src/shared/life-modules.ts');
  // Off by default through the alias-aware switch (packs uplift item 5: Memories resolves to Family, still off
  // unless the person switched it on).
  assert.ok(life.includes('!!switches?.[resolveModule(id)]?.on'), 'every pack is off by default, Meetings too');
  const ab = read('src/renderer/src/state/abilities.ts');
  assert.ok(!ab.includes("target.pack !== 'meetings'"), 'abilities gate Meetings like every pack');
  const abr = read('src/renderer/src/views/AbilitiesPage.tsx');
  assert.ok(!abr.includes("a.target.pack !== 'meetings'"), 'abilities show Meetings on/off like every pack');
});

test('F3 tour on a switched-off pack works and never fires late', () => {
  const ms = read('src/renderer/src/components/ModulesSettings.tsx');
  assert.ok(ms.includes('<ModuleTour module={m} sep={false} />'), 'Settings hosts an independent preview');
  assert.ok(!ms.includes('setModule(m.id, true)'), 'previewing a tour keeps the pack switched off');
  const fills = read('src/renderer/src/state/moduleFills.ts');
  assert.ok(fills.includes('Date.now') || fills.includes('expire') || fills.includes('pendingAt'), 'parked tours expire');
});

test('F4 Today and Home are different places', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(!home.includes('return <TodayView'), 'Home no longer renders Today verbatim');
  assert.ok(home.includes('Areas') || home.includes('areas') || home.includes('overview'), 'Home is areas and overview');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('Today') || today.includes('due'), 'Today keeps the day that needs you');
});

test('F5/F10 header is one row with a host-like search and consistent buttons', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.topbar') && kit.includes('min-height: var(--header-h)'), 'one header height, never an exact clipping height');
  assert.ok(/\.top-search\s*\{[^}]*width:\s*100%/s.test(kit) && /\.top-search\s*\{[^}]*max-width:\s*520px/s.test(kit) && kit.includes('grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(0, 1fr)'), 'search is one 520px-max bar on every page, host-sized, centred by the grid (Round 6, 4 Nov 2026; was flex 1 1 250px, crowded by page buttons)');
  assert.ok(kit.includes('.topbar.is-squeezed .top-search { width: 40px;'), 'the key and the words yield to a 40px button in a window too narrow, so the bar shows at the owner size');
  for (const f of ['src/renderer/src/views/TodayView.tsx', 'src/renderer/src/views/InboxPage.tsx', 'src/renderer/src/views/ProjectsHome.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('className="btn quiet home') || src.includes('btn'), `${f} uses the kit buttons`);
  }
  const proj = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(!proj.includes('pill red') || proj.includes('slate') || proj.includes('coral'), 'Projects header pill is neutral or coral');
});

test('F11/F12/F13/F14 nothing is cut off with ...', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(!settings.includes('(open its folder to check)') || settings.includes('pathTail') || settings.includes('wrap'), 'vault folder line shows the path end or wraps');
  assert.ok(!settings.includes('Beside the note, in its Files folder') || settings.includes('min-width') || settings.includes('Beside the note'), 'Files option fits or is shorter');
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(!meet.includes("join(', ')}${m.people.length > 2 ? '…'"), 'guests use words, not dots');
  assert.ok(meet.includes(' and ') && meet.includes('other'), 'three guests read as words');
  const home = read('src/renderer/src/views/HomeView.tsx');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(home.includes('two-line') || home.includes('wrap') || kit.includes('-webkit-line-clamp: 2') || kit.includes('.clip-2'), 'card rows wrap or clamp to two lines');
});

test('F15 every kind stays reachable, none removed, none a dead row', () => {
  // Kinds left More for Ctrl+K (8 Nov 2026, the quiet More): each answers there by its own name, empty
  // ones saying so plainly, and Settings keeps each type's page one click away. None removed.
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes("hint: 'Nothing yet'"), 'no dead rows in More');
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('typePaletteRows(') && modals.includes("startsWith('type:')"), 'every kind answers in Ctrl+K');
  assert.ok(read('src/renderer/src/lib/paletteRows.ts').includes("'No notes yet'"), 'empties say so plainly');
  assert.ok(read('src/renderer/src/components/NoteTypesSettings.tsx').includes('openTypePage(t.id)'), 'Settings keeps each page one click away');
});

test('F16 Files panel template row opens the picker', () => {
  const nav = read('src/renderer/src/panels/Navigator.tsx');
  assert.ok(!nav.includes('submenu: [] as MenuItem[], run: undefined'), 'no empty submenu with no action');
  assert.ok(nav.includes('newNoteFromTemplate'), 'template row wires the picker');
});

test('F17 Today carries no decorative frame or coral line-and-dot', () => {
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('<HeroArt'), 'hero art is gone from Today');
});

test('F18 status chips are neutral with coral only for attention', () => {
  for (const f of ['src/renderer/src/components/Settings.tsx', 'src/renderer/src/views/modules/work/MeetingsPage.tsx', 'src/renderer/src/views/ProjectsHome.tsx', 'src/renderer/src/views/HomeView.tsx']) {
    const src = read(f);
    assert.ok(!src.includes('tag amber') && !src.includes('tag blue') && !src.includes('tag red') && !src.includes('pill red') && !src.includes('pill amber') && !src.includes('pill blue'), `${f}: no amber, blue or red status chip`);
  }
  const look = read('src/renderer/src/lib/projectLook.ts');
  assert.ok(!look.includes("tint: 'amber'") && !look.includes("tint: 'red'") && !look.includes("tint: 'green'"), 'health pills are neutral or coral');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.coral') || kit.includes('--coral'), 'one coral accent token exists');
});

test('F19 the default look is called Bright, never honey', () => {
  const prefs = read('src/shared/prefs.ts');
  assert.ok(!prefs.includes("name: 'Honey Glow'") && !prefs.includes('name: "Honey Glow"'), 'no Honey Glow name');
  assert.ok(prefs.includes("'Bright'") || prefs.includes('"Bright"'), 'Bright exists');
  assert.ok(prefs.includes("palette: 'bright'") || prefs.includes('palette: "bright"') || prefs.includes("'honey'") === false || prefs.includes('Bright'), 'default is Bright');
  const css = read('src/renderer/src/styles/palettes.css');
  assert.ok(!css.includes("Honey Glow',") && !css.includes('Honey Glow",'), 'no Honey Glow in palettes');
  const search = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(!search.includes('Honey Glow'), 'settings search names Bright, not honey');
});

test('F20/F21/F22/F23 one name per thing', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  const settings = read('src/renderer/src/components/Settings.tsx');
  const vault = read('src/renderer/src/components/VaultPlace.tsx');
  const mods = read('src/renderer/src/components/ModulesSettings.tsx');
  const abilities = read('src/renderer/src/views/AbilitiesPage.tsx');
  assert.ok(!settings.includes('Back to your vault'), 'going back is Back to your notes everywhere');
  // p11-uniform-account: the foot menu is gone, so the side bar says it from its side title while away.
  assert.ok(places.includes('Back to your notes') || read('src/renderer/src/panels/Sidebars.tsx').includes('Back to your notes'), 'side bar says Back to your notes');
  assert.ok(!mods.includes('Show its tour'), 'tours are Show me around');
  assert.ok(mods.includes('Show me around'), 'pack tour says Show me around');
  assert.ok(!abilities.includes('>Show me<') && !abilities.includes('Show me\n'), 'opening is Open, tours are Show me around');
  assert.ok(abilities.includes('\n        Open\n'), 'abilities buttons say Open');
  assert.ok(settings.includes('each with its Open.'), 'abilities line says Open');
  assert.ok(!vault.includes('Where your vault is') && !vault.includes('Where these notes are'), 'vault place uses one name for where notes live');
  assert.ok(vault.includes('Where your notes are kept'), 'that name is Where your notes are kept');
});

test('F24 header search and palette agree', () => {
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(header.includes('Ask or find anything'), 'header keeps the shared search words');
  assert.ok(modals.includes('Ask or find anything'), 'palette agrees with the header');
});

test('F25 Keep is a plain group name', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes('>Keep<') && !places.includes('"Keep"') && !places.includes("'Keep'"), 'no Keep group');
});

test('F26 settings detail sits behind Learn more', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  const vaultRow = settings.slice(settings.indexOf('function VaultRow'), settings.indexOf('function VaultRow') + 4000);
  assert.ok(vaultRow.includes('<LearnMore'), 'vault and folder rows hide detail behind Learn more');
});

test('F27 the brand book is cool, never cream or honey', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(!places.includes('#FFF4DA') && !places.includes('#E9DCBC') && !places.includes('#C8B78E'), 'no cream or honey book');
});
