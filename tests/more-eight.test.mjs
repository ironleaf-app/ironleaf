// node --test tests/more-eight.test.mjs — More keeps the eight on top, then a quiet second group (9 Nov
// 2026, on 10.1.7): the eight a person reaches for stay first (Graph, Templates, Files and assets,
// Bookmarks, Locked, Bin, Import, Commands), then a thin line and small group names hold every row taken out
// on 8 Nov (Pages, Make and open, Find, Packs and kinds); the menu never scrolls at 1219x709 (the biggest
// group folds into a submenu to fit, arrows walk every row); New stays one door, Ctrl+K still finds
// everything, old command names still answer, Settings still names the note types once. Each check fails
// without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-more-eight-'));
let F; // lib/fuzzy.ts, the real matcher
let PR; // lib/paletteRows.ts, the real type/pack rows
let NT; // shared/note-types.ts, the real kinds
let LM; // shared/life-modules.ts, the real packs
let DF; // shared/doc-file.ts
let S; // lib/settingsSearch.ts, the real index
let MF; // shared/more-fit.ts, the real fold-to-fit math
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * as F from ${JSON.stringify(path.join(root, 'src', 'renderer', 'src', 'lib', 'fuzzy.ts'))};\n` +
      `export * as PR from ${JSON.stringify(path.join(root, 'src', 'renderer', 'src', 'lib', 'paletteRows.ts'))};\n` +
      `export * as NT from ${JSON.stringify(path.join(root, 'src', 'shared', 'note-types.ts'))};\n` +
      `export * as LM from ${JSON.stringify(path.join(root, 'src', 'shared', 'life-modules.ts'))};\n` +
      `export * as DF from ${JSON.stringify(path.join(root, 'src', 'shared', 'doc-file.ts'))};\n` +
      `export * as S from ${JSON.stringify(path.join(root, 'src', 'renderer', 'src', 'lib', 'settingsSearch.ts'))};\n` +
      `export * as MF from ${JSON.stringify(path.join(root, 'src', 'shared', 'more-fit.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  F = all.F;
  PR = all.PR;
  NT = all.NT;
  LM = all.LM;
  DF = all.DF;
  S = all.S;
  MF = all.MF;
});
after(() => rmSync(work, { recursive: true, force: true }));

/** More's body: everything between moreItems and the frame rows below it. */
const moreBody = () => {
  const src = read('src/renderer/src/panels/Places.tsx');
  return src.slice(src.indexOf('function moreItems'), src.indexOf('export interface FrameRow'));
};

/** The palette's registry as parsed: every command's id, name, alias and keys. */
function registry() {
  const src = read('src/renderer/src/state/commands.ts');
  const array = src.slice(src.indexOf('export const COMMANDS'), src.indexOf('let lastSearch'));
  const out = [];
  for (const line of array.split('\n')) {
    const id = line.match(/\bid: '([^']+)'/)?.[1];
    const name = line.match(/\bname: '([^']+)'/)?.[1];
    if (!id || !name || id === 'id') continue;
    out.push({ id, name, aliasOf: line.match(/\baliasOf: '([^']+)'/)?.[1], hotkey: line.match(/\bhotkey: '([^']+)'/)?.[1] });
  }
  assert.ok(out.length > 100, `the registry parsed (${out.length})`);
  return out;
}

/** Everything Ctrl+K matches: the listed commands plus a type row per kind and a pack row per pack. */
function paletteItems() {
  const commands = registry().filter((c) => !c.aliasOf).map((c) => ({ id: c.id, words: c.name }));
  const types = NT.resolveTypes(NT.emptyConfig(), { topFolders: [], templatesFolder: 'Templates', docsFolder: DF.DOCS_FOLDER })
    .filter((t) => !t.hidden && !['project', 'meeting', 'person', 'note'].includes(t.id))
    .map((t) => ({ id: t.id, plural: t.plural, icon: t.icon, count: 1 }));
  assert.ok(types.length >= 3, `the kinds parsed (${types.map((t) => t.plural).join(', ')})`);
  const typeRows = PR.typePaletteRows(types).map((r) => ({ id: r.id, words: r.label }));
  const packs = LM.LIFE_MODULES.filter((m) => m.id !== 'meetings').map((m) => ({ id: m.id, name: m.name, icon: m.icon }));
  assert.ok(packs.length >= 10, `the packs parsed (${packs.length})`);
  const packRows = PR.packPaletteRows(packs).map((r) => ({ id: r.id, words: r.label }));
  return { commands, typeRows, packRows, all: [...commands, ...typeRows, ...packRows] };
}

test('More keeps the eight on top, then the quiet second group', () => {
  const body = moreBody();
  // The eight stay first in the returned menu, in order (pins and folded rows keep their sections above).
  const ret = body.slice(body.indexOf('return ['));
  const labels = [...ret.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    labels.slice(0, 8),
    ['Graph', 'Templates', 'Files and assets', 'Bookmarks', 'Locked', 'Bin', 'Import', 'Commands'],
    `the eight on top in order (saw: ${labels.slice(0, 8).join(' · ')})`,
  );
  assert.ok(!body.includes('inSpark'), 'no gate left: Bin shows on its own too');
  // Then a thin line and small group names: Pages, Make and open, Find, Packs and kinds, in order.
  for (const h of ["heading: 'Pages'", "heading: 'Make and open'", "heading: 'Find'", "heading: 'Packs and kinds'"])
    assert.ok(body.includes(h), `the second group names ${h}`);
  const at = (bit) => ret.indexOf(bit);
  assert.ok(at("includes('pages')") < at("includes('make'") && at("includes('make'") < at("includes('find'") && at("includes('find'") < at("includes('packs'"), 'the groups keep their order');
  assert.ok(ret.includes('{ separator: true }'), 'a thin line parts the eight from the second group');
});

test('every row taken out on 8 Nov is back in More', () => {
  const body = moreBody();
  // Pages (Areas reads the vault: Areas of life once organised, else the organise row).
  for (const row of ["label: 'Timeline'", "label: 'Shared spaces'", "label: 'People and organisations'", "label: 'Tags'", "label: 'What Ironleaf can do'"])
    assert.ok(body.includes(row), `More holds ${row}`);
  assert.ok(body.includes('Areas of life') && body.includes('Organise by area of life'), 'More holds Areas of life (or its organise row when unorganised)');
  // Make and open.
  for (const row of ["label: 'Daily note'", "label: 'New canvas'", "label: 'New drawing'", "label: 'New view'", "label: 'Open a file from this PC…'", "label: 'Import CSV…'"])
    assert.ok(body.includes(row), `More holds ${row}`);
  assert.ok(body.includes("hint: 'Ctrl+Shift+D'"), 'the daily note names its keys');
  // Find.
  for (const row of ["label: 'Search inside notes'", "label: 'Earlier versions of notes'"])
    assert.ok(body.includes(row), `More holds ${row}`);
  assert.ok(body.includes("hint: 'Ctrl+Shift+F'"), 'the search names its keys');
  // Packs and kinds: each switched-on pack by name, Other kinds as a submenu, the chooser.
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('modulesOn(') && places.includes('openModule('), 'each switched-on pack opens by name');
  assert.ok(places.includes('useShellTypes()'), 'kinds come from the vault’s own types');
  assert.ok(body.includes('...packItems') && body.includes("label: 'Other kinds'") && body.includes('submenu:'), 'Other kinds opens its kinds as a submenu');
  assert.ok(body.includes("label: 'Choose packs…'"), 'the packs chooser stays in More');
  // The person's pins and hidden rows still apply to every row.
  assert.ok(body.includes('pinItems'), 'pins keep their section above');
  for (const sw of ['ribbon:timeline', 'ribbon:daily', 'ribbon:canvas', 'ribbon:recovery'])
    assert.ok(body.includes(`'${sw}'`), `the ${sw} switch still gates its row`);
  assert.ok(read('src/shared/prefs.ts').includes("label: 'Timeline'"), 'the switches are back in Settings › Appearance › Interface');
  // Files and Fold/Unfold stay out on purpose (9 Nov 2026): Files duplicates the left side itself
  // (Show your files stays in Ctrl+K), and Fold/Unfold is a view toggle with two commands, double-click
  // and the rail button — neither belongs in the four quiet groups, and the brief's list omits both.
  assert.ok(!body.includes("label: 'Files'"), 'no Files row (the left side already is the file list)');
  assert.ok(!body.includes('Fold the side bar to icons') && !body.includes('Unfold the side bar'), 'no fold toggle (commands, double-click and the rail button cover it)');
});

test('every function that left More is still found by name in Ctrl+K', () => {
  const { all } = paletteItems();
  const hits = (q) => F.fuzzyFilter(all, q, (c) => c.words, 80).map((c) => c.id);
  // [words typed, command that must come first]
  const first = [
    ['what ironleaf can do', 'abilities'],
    ['timeline', 'timeline'],
    ['people and organisations', 'people'],
    ['tags', 'tags'],
    ['areas of life', 'areas'],
    ['shared spaces', 'shared-spaces'],
    ['search inside notes', 'search'],
    ['daily note', 'daily'],
    ['new canvas', 'new-canvas'],
    ['new drawing', 'new-drawing'],
    ['open a file from this pc', 'open-file'],
    ['csv', 'import'],
    ['import csv', 'import'],
    ['earlier versions', 'recovery'],
    ['fold the side bar', 'rail-on'],
    ['unfold the side bar', 'rail-off'],
    ['choose packs', 'packs'],
  ];
  for (const [q, want] of first) assert.equal(hits(q)[0], want, `“${q}” finds ${want} first (saw: ${hits(q).slice(0, 3).join(', ')})`);
  // Two different things share these words, so both must be there, not one first.
  assert.ok(hits('files').includes('files'), '“files” still finds Show your files');
  assert.ok(hits('new view').includes('new-view'), '“new view” still finds New view of notes');
});

test('every kind and every pack answers in Ctrl+K by its own name', () => {
  const { all } = paletteItems();
  const hits = (q) => F.fuzzyFilter(all, q, (c) => c.words, 80).map((c) => c.id);
  const types = NT.resolveTypes(NT.emptyConfig(), { topFolders: [], templatesFolder: 'Templates', docsFolder: DF.DOCS_FOLDER }).filter(
    (t) => !t.hidden && !['project', 'meeting', 'person', 'note'].includes(t.id),
  );
  for (const t of types) assert.equal(hits(t.plural)[0], `type:${t.id}`, `“${t.plural}” opens the ${t.plural} page first`);
  for (const m of LM.LIFE_MODULES.filter((x) => x.id !== 'meetings')) assert.equal(hits(m.name)[0], `pack:${m.id}`, `“${m.name}” opens the ${m.name} pack first`);
  // The palette builds these rows from the same lists and opens them (lib/paletteRows.ts above is what it calls).
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('typePaletteRows(') && modals.includes('packPaletteRows('), 'the palette builds type and pack rows');
  assert.ok(modals.includes("startsWith('type:')") && modals.includes('openTypePage('), 'a type row opens its page');
  assert.ok(modals.includes("startsWith('pack:')") && modals.includes('openModule('), 'a pack row opens its pack');
  assert.ok(modals.includes("!['project', 'meeting', 'person', 'note'].includes(t.id)"), 'the bar’s own rows are not repeated');
});

test('New is one door, and every shortcut still fires', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('<span>New</span>') && places.includes('openNewDoor(e.currentTarget)'), 'the bar’s button opens the door');
  const head = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(head.includes('aria-label="New"') && head.includes('openNewDoor(e.currentTarget)'), 'the header’s plus opens the same door');
  const kinds = read('src/renderer/src/state/noteTypes.ts');
  for (const row of ["label: 'New note…'", "label: 'New canvas'", "label: 'New view'"]) assert.ok(kinds.includes(row), `the door holds ${row}`);
  assert.ok(kinds.includes('What kind of note? A kind or a template'), 'the note list asks kind or template');
  assert.ok(kinds.includes('noteTemplates()') && kinds.includes('type:${') && kinds.includes('template:${'), 'kinds and templates chosen inline');
  const cmds = registry();
  assert.equal(cmds.find((c) => c.id === 'new-note')?.hotkey, 'Mod+N', 'Ctrl+N still makes a note straight away');
  assert.equal(cmds.find((c) => c.id === 'new-note-tab')?.hotkey, 'Mod+Shift+N', 'Ctrl+Shift+N still makes one in a new tab');
  assert.ok(read('src/renderer/src/App.tsx').includes('for (const cmd of COMMANDS)'), 'the key loop reads every command, aliases too');
});

test('commands name each thing once, and every alias still runs', () => {
  const cmds = registry();
  const byId = new Map(cmds.map((c) => [c.id, c]));
  // [alias, the survivor shown instead]
  const aliases = [
    ['home', 'today'],
    ['new-note-tab', 'new-note'],
    ['new-plain-note', 'new-note'],
    ['new-person', 'new-note'],
    ['new-meeting', 'new-note'],
    ['new-resource', 'new-note'],
    ['new-idea', 'new-note'],
    ['new-note-from-template', 'new-note'],
    ['new-project', 'new-note'],
    ['new-doc', 'new-note'],
    ['new-view-board', 'new-view'],
    ['new-view-calendar', 'new-view'],
    ['new-view-cards', 'new-view'],
    ['new-folder', 'files'],
    ['import-csv', 'import'],
  ];
  for (const [alias, survivor] of aliases) {
    assert.equal(byId.get(alias)?.aliasOf, survivor, `${alias} is an alias of ${survivor}`);
    assert.ok(byId.has(survivor) && !byId.get(survivor)?.aliasOf, `${survivor} is shown`);
  }
  // The lists show survivors only; running still reads every id.
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('listedCommands()'), 'Ctrl+K lists survivors');
  assert.ok(read('src/renderer/src/components/SearchView.tsx').includes('listedCommands()'), 'search lists survivors');
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('listedCommands()'), 'Settings › Keys lists survivors');
  assert.ok(read('src/renderer/src/lib/settingsSearch.ts').includes('!c.aliasOf'), 'Settings search lists survivors');
  assert.ok(read('src/renderer/src/state/commands.ts').includes('commandById.get(id)'), 'runs go through the one registry, aliases too');
});

test('Settings names the note types once', () => {
  const titles = S.SETTINGS_INDEX.filter((e) => /note types/i.test(e.title)).map((e) => e.title);
  assert.deepEqual(titles, ['Your note types'], `one types entry (saw: ${titles.join(', ')})`);
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('title="Your note types"'), 'the door wears the name');
  assert.ok(read('src/renderer/src/lib/settingsSearch.ts').includes("types: { section: 'general', row: 'Your note types' }"), 'the old door lands on it');
});

test('More never scrolls at 1219x709: the biggest group folds to fit, arrows walk every row', () => {
  // The math matches the kit (styles/kit.css): 40px rows, 32px headings, 9px separators, 14px pad and border.
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('min-height: 40px'), 'rows are 40px');
  assert.ok(kit.includes('.menu .mlab, .menu .menu-heading'), 'headings wear the kit');
  assert.equal(MF.MORE_ROW_H, 40, 'the row constant matches');
  assert.equal(MF.MORE_HEADING_H, 32, 'the heading constant matches');
  assert.equal(MF.MORE_PAD, 14, 'the pad counts the 6px padding plus the 1px border top and bottom (Choose packs cut off by 2px without it)');
  // At 1219x709 the menu has 655px (709 less the window edge and the buttons band).
  const available = 709 - 8 - 46;
  // Quiet vault: no pins, nothing folded, the eight, Pages 7, Make 6, Find 2, Packs (Other kinds + chooser).
  const quiet = { available, pinned: 0, folded: 0, eight: 8, groups: [{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }, { id: 'find', rows: 2 }, { id: 'packs', rows: 2 }] };
  const folded = MF.moreFoldToFit(quiet);
  assert.ok(folded.includes('pages'), `Pages (the biggest) folds first (folded: ${folded.join(', ') || 'none'})`);
  assert.ok(MF.moreHeight({ ...quiet, foldedIds: folded }) <= available, `the folded menu fits 709px (${MF.moreHeight({ ...quiet, foldedIds: folded })}px over ${available}px)`);
  // A full vault still fits: two pins with long names, four packs on, kinds kept (packs + Other kinds + chooser).
  const full = { available, pinned: 2, folded: 0, eight: 8, groups: [{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }, { id: 'find', rows: 2 }, { id: 'packs', rows: 6 }] };
  const foldedFull = MF.moreFoldToFit(full);
  assert.ok(MF.moreHeight({ ...full, foldedIds: foldedFull }) <= available, `a full vault fits too (${MF.moreHeight({ ...full, foldedIds: foldedFull })}px over ${available}px)`);
  // More reads the math at open time, folding by viewport height, then measures the real menu and folds on.
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('moreFoldToFit(') && places.includes('window.innerHeight'), 'More folds by the window’s height');
  assert.equal(MF.nextMoreFold([{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }], []), 'pages', 'the measured loop folds the biggest next');
  assert.equal(MF.nextMoreFold([{ id: 'pages', rows: 7 }, { id: 'make', rows: 6 }], ['pages', 'make']), null, 'no next fold when all are folded');
  assert.ok(places.includes('nextMoreFold(') && places.includes('menu.style.top') && places.includes('menu.offsetHeight') && places.includes('scrollHeight - menu.clientHeight'), 'More measures its layout bottom and scroll, folding the next biggest group until it fits with an 8px margin');
  assert.ok(read('src/renderer/src/components/Menu.tsx').includes('el.offsetWidth, height: el.offsetHeight'), 'menus place by layout size, not the settle-scaled rect');
  assert.ok(places.includes('requestAnimationFrame'), 'the measure waits a frame for the menu’s own placing');
  // A folded group keeps its rows in a submenu, and arrows walk every row at every depth.
  const body = moreBody();
  for (const g of ["label: 'Pages'", "label: 'Make and open'", "label: 'Find'", "label: 'Packs and kinds'"])
    assert.ok(body.includes(g) && body.includes('submenu:'), `the folded ${g} keeps a submenu`);
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(!menu.includes('if (depth > 0) return;'), 'every depth answers the keys, not only the top');
  assert.ok(menu.includes('onCloseSub') && menu.includes("e.key === 'ArrowLeft'"), 'Left puts a submenu away, arrows walk every row');
});
