// node --test tests/uplift-95-glyphs.test.mjs — controls are drawn, not typed (9.5 polished, 1 Nov 2026, the ). Send,
// dismiss, tick, see-all, move, expand, tile and marker controls render the kit's Icon set, never raw text glyphs;
// primary adds pair the kit plus with their words instead of a glued-on '+'. The ratchet below caps the remaining raw
// glyphs across the renderer (pack glyphs behind glyph=, key labels, maths and prose breadcrumbs stay); the named
// files hold none at all. Fails without each change.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
// Text used as chrome: arrows, triangles, ticks, crosses, tiles, diamonds, dots and dots-menus. Pack marks behind
// glyph=, key labels (arrows in footers stay), maths (x, minus), degrees and ordinary typography are not chrome.
const BANNED = ['↑', '↓', '←', '→', '▾', '▿', '▼', '▲', '◂', '▸', '‹', '›', '«', '»', '✓', '✔', '✕', '✗', '✖', '◧', '▦', '▤', '▣', '◆', '◇', '●', '○', '◉', '◍', '◷', '◔', '◑', '⋯', '•', '⠿', '⌂', '⌕', '◈', '▶', '◀', '↺', '✎', '☰', '⚡', '📅', '⏰'];
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/glyph="[^"]*"/g, '');
const hits = (src) => [...codeOf(src)].filter((ch) => BANNED.includes(ch));

const tsxFiles = [];
{
  const walk = (dir) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.tsx')) tsxFiles.push(path.join(dir, e.name));
    }
  };
  walk('src/renderer/src');
}

test('the kit draws up as well as down', () => {
  assert.ok(read('src/renderer/src/components/Icon.tsx').includes('chevronUp'), 'Icon draws chevronUp for move-up controls');
});

test('no new raw glyphs: the renderer-wide count never grows', () => {
  let total = 0;
  for (const f of tsxFiles) total += hits(read(f)).length;
  assert.ok(total <= 204, `at most 204 raw glyphs renderer-wide (got ${total})`);
});

test('the fixed screens hold no raw glyphs at all', () => {
  for (const f of [
    'src/renderer/src/views/NotebookView.tsx',
    'src/renderer/src/views/HomeView.tsx',
    'src/renderer/src/components/SearchView.tsx',
    'src/renderer/src/components/SearchModal.tsx',
    'src/renderer/src/panels/ChatPanel.tsx',
    'src/renderer/src/views/ProjectsHome.tsx',
    'src/renderer/src/views/project/ProjectTabs87.tsx',
    'src/renderer/src/views/TimelineView.tsx',
  ]) {
    const found = hits(read(f));
    assert.equal(found.length, 0, `${f} holds no raw glyphs (got ${[...new Set(found)].join(' ')})`);
  }
});

test('send, move, expand and dismiss controls draw the kit icons', () => {
  const modal = read('src/renderer/src/components/SearchModal.tsx');
  assert.ok(modal.includes('<Icon name="send"'), 'the follow-up box sends with the kit icon');
  const search = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(!search.includes('▾'), 'search filters expand with the kit chevron');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('<Icon name="grip"'), 'home card rows grip the kit icon');
  assert.ok(settings.includes('<Icon name="chevronUp"') && settings.includes('<Icon name="chevronDown"'), 'home card rows move with kit chevrons');
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('<Icon name="check"'), 'task ticks draw the kit tick');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('<Icon name="more"'), 'the bar draws kit icons');
  // 20 Nov 2026: the foot's Settings row moved into the account menu, which draws the kit icons too.
  assert.ok(read('src/renderer/src/components/account/AccountMenu.tsx').includes('<Icon name={e.icon}'), 'the foot’s account menu draws kit icons');
  const chat = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(!chat.includes('Review ›'), 'the suggestion review reads without the glyph arrow');
});

test('tiles, markers and counts draw the kit, not typed art', () => {
  const bm = read('src/renderer/src/views/BookmarksPage.tsx');
  assert.ok(!bm.includes('⠿') && !bm.includes('×</button>') && !bm.includes('>★<'), 'bookmarks grip, remove and tile with the kit');
  assert.ok(bm.includes('TILE_ICON'), 'bookmark tiles map types to kit icons');
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes('<Icon name="briefcase"'), 'project tiles draw the kit briefcase');
  assert.ok(!home.includes('◆'), 'clash markers draw from CSS, not typed diamonds');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tabs.includes('● {n}') && !tabs.includes('◆ {plain'), 'calendar counts and milestones read without typed art');
  const secrets = read('src/renderer/src/views/SecretsView.tsx');
  assert.ok(secrets.includes('<Icon name="back"'), 'back to Secrets draws the kit arrow');
  for (const f of [
    'src/renderer/src/views/SecretsView.tsx',
    'src/renderer/src/views/PrivateView.tsx',
    'src/renderer/src/views/TemplatesPage.tsx',
    'src/renderer/src/views/modules/pack87.tsx',
    'src/renderer/src/views/modules/w3b/Lists87.tsx',
  ]) {
    assert.ok(!read(f).includes('>•••<'), `${f}: More buttons draw the kit icon`);
  }
});

test('primary adds pair the kit plus with their words', () => {
  const adds = [
    ['src/renderer/src/views/ProjectsHome.tsx', '>+ New project<'],
    ['src/renderer/src/views/ProjectPage.tsx', '>+ Add task<'],
    ['src/renderer/src/views/ProjectPage.tsx', '>+ Add note<'],
    ['src/renderer/src/views/ProjectPage.tsx', '>+ Add person<'],
    ['src/renderer/src/views/modules/w3b/Goals87.tsx', '>+ New goal<'],
    ['src/renderer/src/views/SecretsView.tsx', '>+ New secret<'],
  ];
  for (const [f, label] of adds) assert.ok(!read(f).includes(label), `${f}: no glued-on '${label}'`);
  assert.ok(read('src/renderer/src/views/ProjectsHome.tsx').includes('<Icon name="plus"'), 'New project pairs the kit plus');
  // Direction C (5 Nov 2026): the adds live in the folio sections now, still pairing the kit plus.
  assert.ok(read('src/renderer/src/views/project/ProjectTabs87.tsx').includes('<Icon name="plus"'), 'Add task pairs the kit plus');
});
