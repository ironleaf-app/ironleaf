// node --test tests/frame-87.test.mjs — the frame (8.7 wave 1, item 2): the slim side bar with its rows in the
// mock-up's order, the packs as their own group only while switched on, the folded icon rail, the Ctrl+K palette and
// Quick add in the kit. The guard: every place the person could reach still opens from the bar, its More, or the
// palette. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const places = () => read('src/renderer/src/panels/Places.tsx');
const commands = () => read('src/renderer/src/state/commands.ts');

test('the bar holds the quiet rows in order, then More, then Settings pinned', () => {
  // 5 Nov 2026, one search door and a quiet rail: Search left for the centred bar, Tasks joined the bar from
  // More, Home/Shared spaces/packs left for More, and the group labels went with them.
  const src = places();
  // 5 Nov 2026, Home folded into Today: no Home row anywhere; the quiet rows keep their order.
  const order = ['<Row row={f.today} />', '<Row row={f.inbox} />', '<Row row={f.projects} />', '<Row row={f.tasks} />', '<Row row={f.meetings} />', '<Row row={f.notes} />', '<Row row={f.people} />', '>More<']; // the rendered rows, in order (the fold list above names them too)
  let at = -1;
  for (const bit of order) {
    const next = src.indexOf(bit, at + 1);
    assert.ok(next > at, `${bit} follows in order`);
    at = next;
  }
  assert.ok(src.includes("label: 'Today'") && src.includes("label: 'Inbox'") && src.includes("label: 'Tasks'"), 'top rows');
  assert.ok(src.includes("label: 'Projects'") && src.includes("label: 'Meetings'"), 'projects rows');
  assert.ok(src.includes("label: 'Notes'") && src.includes("label: 'People'"), 'notes and people rows');
  assert.ok(!src.includes('<Row row={f.search} />') && !src.includes('<Row row={f.home} />') && !src.includes('<Row row={f.shared} />'), 'no Search, Home or Shared spaces row on the bar');
  assert.ok(!src.includes('>Projects<') && !src.includes('>Notes and people<'), 'no group labels');
  assert.ok(!src.includes("label: 'Home'"), 'no Home anywhere on the rail (Home folded into Today: old links open Today)');
  assert.ok(src.indexOf('PlacesFoot') > 0 && read('src/renderer/src/panels/Sidebars.tsx').includes('<PlacesFoot'), 'settings pinned at the bottom');
});

test('the packs answer in Ctrl+K by name, and are chosen in Settings › Packs', () => {
  // 8 Nov 2026, the quiet More: packs left More for the palette, each switched-on pack as its own row.
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('packPaletteRows('), 'the palette builds a row per pack');
  assert.ok(modals.includes("startsWith('pack:')") && modals.includes('openModule('), 'a pack row opens its pack');
  assert.ok(commands().includes("id: 'packs'") && commands().includes("section: 'packs'"), 'Choose packs opens Settings › Packs');
  assert.ok(!places().includes("heading: 'Packs'"), 'no packs section in More');
});

test('guard: every place still has a way in (bar, More, or palette)', () => {
  const src = places();
  const cmds = commands();
  // [place, bar/More proof in Places.tsx, palette command id ('' when More is its way in)]
  // 5 Nov 2026: search lives in the centred bar (Ctrl+O/Ctrl+K), Shared spaces/packs in More, Tasks on the bar,
  // Home folded into Today (the palette's Home entry opens Today).
  const destinations = [
    ['search', null, 'palette'],
    ['home', "label: 'Home'", 'home'],
    ['today-hub', null, 'today'],
    ['inbox', 'openInbox()', 'inbox'],
    ['projects', 'A.openProjects()', 'projects'],
    ['meetings', 'openMeetings()', 'meetings'],
    ['notes', "openTypePage('note')", 'open-note-type'],
    ['people', 'openPeople()', 'people'],
    ['settings', "openModal({ kind: 'settings' })", 'settings'],
    ['shared', "label: 'Shared spaces'", 'shared-spaces'],
    ['packs', "heading: 'Packs'", 'packs'],
    ['tasks', 'A.openTasks()', 'tasks'],
    ['timeline', "label: 'Timeline'", 'timeline'],
    ['graph', "label: 'Graph'", 'graph'],
    ['templates', "label: 'Templates'", 'templates'],
    ['assets', "label: 'Files and assets'", 'assets'],
    ['bookmarks', "label: 'Bookmarks'", 'bookmarks'],
    ['private', "label: 'Private notes'", 'private'],
    ['secrets', "label: 'Secrets'", 'secrets'],
    ['files', "label: 'Files'", 'files'],
    ['tags', "label: 'Tags…'", 'tags'],
    ['areas', "label: 'Areas of life…'", 'areas'],
    ['search-inside', "label: 'Search inside notes'", 'search'],
    ['daily', "label: 'Today’s note'", 'daily'],
    ['new-canvas', "label: 'New canvas'", 'new-canvas'],
    ['new-drawing', "label: 'New drawing'", 'new-drawing'],
    ['loose-file', "label: 'Open a file from this PC…'", 'open-file'],
    ['new-view', "label: 'New view'", 'new-view'],
    ['import-csv', "label: 'Import CSV…'", 'import-csv'],
    ['recovery', "label: 'Earlier versions of notes'", 'recovery'],
    ['bin', "label: 'Bin'", 'bin'],
    ['commands', "label: 'Commands'", 'palette'],
  ];
  for (const [place, proof, cmd] of destinations) {
    const viaBar = proof ? src.includes(proof) : false;
    const viaPalette = cmd ? cmds.includes(`id: '${cmd}'`) : false;
    assert.ok(viaBar || viaPalette, `${place} still has a way in`);
  }
  // Kinds left More for the palette (8 Nov 2026, the quiet More): each answers there by its own name.
  // Pinned keep one click in More, whatever they are called.
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('typePaletteRows(') && modals.includes("startsWith('type:')"), 'every kind answers in Ctrl+K');
  assert.ok(src.includes('pinItems') && src.includes('A.openPath(b.path)'), 'pinned keep their More rows');
  // Rare screens sit behind Settings too (the spec's rule): each opens from a settings section or a command above.
  assert.ok(cmds.includes("kind: 'settings'"), 'settings sections open from the palette');
});

test('the palette answers to Ctrl+K, Ctrl+O and Ctrl+P', () => {
  const cmds = commands();
  assert.ok(cmds.includes("id: 'palette'") && cmds.includes("hotkey: 'Mod+K'"), 'Ctrl+K opens the palette');
  assert.ok(cmds.includes("'Mod+O'") && cmds.includes("'Mod+P'"), 'Ctrl+O and Ctrl+P open the same panel (5 Nov 2026, one search door)');
  assert.ok(read('src/renderer/src/App.tsx').includes('alsoKeys(cmd)'), 'the key loop honours every extra combo');
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('Ctrl+K or Ctrl+O anywhere'), 'the palette says its keys');
  assert.ok(read('src/renderer/src/styles/kit.css').includes('.picker .picker-row'), 'the palette wears the kit');
});

test('folding and unfolding the bar are commands', () => {
  const cmds = commands();
  assert.ok(cmds.includes("id: 'rail-on'") && cmds.includes('Fold the side bar to icons'), 'fold command');
  assert.ok(cmds.includes("id: 'rail-off'") && cmds.includes('Unfold the side bar'), 'unfold command');
  // Out of More (8 Nov 2026, the quiet More): the palette names both ways.
  const more = places().slice(places().indexOf('function moreItems'), places().indexOf('export interface FrameRow'));
  assert.ok(!more.includes('Fold the side bar to icons') && !more.includes('Unfold the side bar'), 'More carries neither');
});

test('quick add wears the kit and the person’s palette', () => {
  const box = read('src/renderer/src/capture/CaptureBox.tsx');
  for (const bit of ['kindtabs', 'className="input qc-field', 'tag amber', 'className="chips', 'btn quiet', 'btn pri', 'not a date']) assert.ok(box.includes(bit), `quick add ${bit}`);
  assert.ok(read('src/renderer/src/capture/main.tsx').includes('styles/kit.css'), 'the box loads the kit');
  assert.ok(read('src/shared/capture.ts').includes('palette: string'), 'the look travels with the context');
  assert.ok(box.includes("dataset.palette"), 'the box wears the person’s palette');
});

// The folded rail in the fit (src/shared/layout-fit.ts): always 64 wide, never shrunk, kept over the right side.
const work = mkdtempSync(path.join(tmpdir(), 'nv-frame-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/layout-fit.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'fit.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'fit.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the rail docks at 64 and never shrinks', () => {
  assert.equal(F.RAIL, 64);
  const fit = F.fitSides({ width: 1440, left: { open: true, width: 248, rail: true }, right: { open: false, width: 380 }, drawer: null });
  assert.equal(fit.left, 'docked');
  assert.equal(fit.leftWidth, 64);
  const narrow = F.fitSides({ width: 900, left: { open: true, width: 248, rail: true }, right: { open: true, width: 380 }, drawer: null });
  assert.equal(narrow.left, 'docked');
  assert.equal(narrow.leftWidth, 64);
});
