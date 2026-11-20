// node --test tests/pages-w4b.test.mjs — the Vault redesign, wave 2 design C (8.7): the other pages (Automations,
// Bookmarks, Canvas, Files and assets, Map, Templates, Timeline) in the one page shape, each with its empty, loading
// and error states, and template {{placeholders}} as friendly chips, never raw braces. Round 2 (the plan):
// the timeline as one bar per project, files leading with the table under a filter strip, the templates list alone
// with its legend in the editor. Round 3: the seven pages draw the one shared page head, and the shared states are
// wired into Home, a note, a project and search. Round 4: the search states live in the one search window after the
// join with main. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const view = (f) => read(`src/renderer/src/views/${f}`);
const css = read('src/renderer/src/styles/page-states-87.css');

test('every w4b page wears the one page shape: the shared head, kit labels, tiles and tags', () => {
  const pages = {
    'BookmarksPage.tsx': 'Bookmarks',
    'CanvasView.tsx': 'w4b-cv-status',
    'AssetsPage.tsx': 'Files and assets',
    // 9.2 uplift F112: one name ("Graph") on the tab, the head and the palette.
    'GraphTab.tsx': 'Graph',
    'TemplatesPage.tsx': 'Templates',
    'TimelineView.tsx': 'Timeline',
  };
  for (const [file, title] of Object.entries(pages)) {
    const src = view(file);
    assert.ok(src.includes(title), `${file} says ${title}`);
    // Round 3: every page's title is the one shared head, never its own <h1> (page-frame.test.mjs guards it too).
    assert.ok(src.includes("from '../components/PageHead'") && src.includes('<PageHead'), `${file} draws its title through the shared head`);
    assert.ok(!src.match(/<h1(\s[^>]*)?>/), `${file} draws no title of its own`);
  }
  for (const [file, bits] of [
    ['BookmarksPage.tsx', ['glabel', 'gtile xs', 'tag slate', 'w4b-bm-grip']],
    ['AssetsPage.tsx', ['glabel', 'w4b-tiles', 'w4b-kit', 'w4b-fstrip', 'FilterChip', 'chip${on']],
    // 8 Nov 2026, the living graph: the centred trio (w4b-map-*) went with the card map; the Graph page is the
    // one dark canvas with its Whole vault way back.
    ['GraphTab.tsx', ['Whole vault', '<GraphView', 'local={false}', 'onCentre']],
    ['TemplatesPage.tsx', ['glabel', 'gtile sm', 'iconbtn', 'w4b-tp-name']],
    ['TimelineView.tsx', ['seg', 'w4b-tl-bar', 'w4b-tl-hint', 'BarRow', 'tl-clash-note']],
    ['CanvasView.tsx', ['w4b-cv-bar', 'w4b-cv-status', 'w4b-cv-hint']],
  ]) {
    for (const bit of bits) assert.ok(view(file).includes(bit), `${file} keeps ${bit}`);
  }
});

test('row words shrink inside their column: block-level flex middles (the templates preview overlap)', () => {
  // 8 Nov 2026, the living graph: the trio's card rows went with it, so GraphTab keeps no row-middle span.
  for (const [file, n] of [['TemplatesPage.tsx', 1], ['BookmarksPage.tsx', 1]]) {
    const middles = view(file).match(/<span style=\{\{[^}]*minWidth: 0[^}]*\}\}>/g) ?? [];
    assert.equal(middles.length, n, `${file} keeps ${n} row-middle spans`);
    for (const m of middles) assert.ok(m.includes("display: 'block'") && m.includes('flex: 1'), `${file} middle shrinks: ${m}`);
  }
  // The groups track itself must not size to content, or rows push under the preview.
  assert.ok(read('src/renderer/src/styles/templates.css').includes('grid-template-columns: minmax(0, 1fr);'), 'tp-groups track constrained');
});

test('one primary button per w4b screen', () => {
  for (const file of ['BookmarksPage.tsx', 'AssetsPage.tsx', 'GraphTab.tsx', 'TemplatesPage.tsx', 'TimelineView.tsx', 'CanvasView.tsx']) {
    const n = (view(file).match(/btn pri|button primary/g) ?? []).length;
    assert.ok(n <= 1, `${file} keeps at most one primary (has ${n})`);
  }
});

test('the shared states: empty, error and loading in the page’s real shape', () => {
  const states = read('src/renderer/src/components/PageStates.tsx');
  for (const fn of ['PageEmpty', 'PageError', 'PageLoading', 'Skel', 'RowsSkeleton', 'CardsSkeleton', 'TableSkeleton', 'BoardSkeleton']) assert.ok(states.includes(`export function ${fn}`), `states share ${fn}`);
  // The -empty shape: one muted ring, one head, one line, one button.
  assert.ok(css.includes('.w4b-ering') && css.includes('width: 64px') && css.includes('.w4b-empty h3') && css.includes('.w4b-empty-go'), 'empty ring, head and button');
  // The -error shape: the ring tinted red in a centred card.
  assert.ok(css.includes('.w4b-ering.is-bad') && css.includes('var(--red-bg)') && css.includes('.w4b-err'), 'error card');
  // The -loading shape: pulsing blocks, still when the person asked for less motion (5 Nov 2026 feel-motion: the
  // page's own w4b-pulse is the shared nv-pulse now, same guard).
  assert.ok(css.includes('nv-pulse') && css.includes('prefers-reduced-motion: no-preference'), 'loading pulse with reduced-motion guard');
  // Every w4b page shows a loading and an empty state; the reaching pages show an error state too.
  for (const [file, bits] of [
    ['BookmarksPage.tsx', ['PageEmpty']],
    ['AssetsPage.tsx', ['PageLoading', 'PageEmpty', 'PageError']],
    // 8 Nov 2026, the living graph: the page's states live in the canvas shell (plain centred lines on the
    // dark, the shared error with its retry), not the trio's card shapes.
    ['../components/GraphView.tsx', ['Loading the graph', 'Nothing to show yet', 'Nothing connected within two levels yet', 'PageError']],
    ['TemplatesPage.tsx', ['PageLoading', 'PageEmpty']],
    ['TimelineView.tsx', ['PageLoading', 'PageEmpty']],
  ]) {
    for (const bit of bits) assert.ok(view(file).includes(bit), `${file} shows ${bit}`);
  }
});

test('state and page surfaces use tokens only: dark follows, no cream', () => {
  const bodies = css.replace(/:root[^{]*\{[^}]*\}/gs, '');
  for (const hex of bodies.match(/#[0-9a-f]{6}/gi) ?? []) assert.fail(`state css fixes ${hex}`);
  const warm = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.min(r, g, b) >= 190 && r - b >= 8;
  };
  for (const hex of css.match(/#[0-9a-f]{6}/gi) ?? []) assert.ok(!warm(hex), `state css ${hex} is a warm off-white`);
  assert.ok(css.includes('max-width: 760px') && css.includes('w4b-narrow'), 'narrow windows stack');
});

test('templates show placeholders as friendly chips, never raw braces', () => {
  const page = view('TemplatesPage.tsx');
  // Anything the template itself wrote goes through VarWords: rows, preview, legend (round 2: the legend lives in
  // the template editor, shown under the last line of a note in the Templates folder).
  assert.ok(page.includes('<VarWords text={t.name}'), 'row names through chips');
  assert.ok(page.includes('<VarWords text={ds}'), 'row descriptions through chips');
  assert.ok(page.includes('<VarWords text={current.name}'), 'preview names through chips');
  assert.ok(page.includes('<VarWords text={current.description}'), 'preview descriptions through chips');
  const legend = read('src/renderer/src/components/TemplateLegend.tsx');
  assert.ok(legend.includes('<VarChip name={v.name}'), 'the legend through chips');
  assert.ok(legend.includes('<VarWords text={v.words}'), 'the legend words through chips');
  assert.ok(!page.includes('tp-how'), 'the legend left the list for the editor');
  assert.ok(view('NoteView.tsx').includes('<TemplateLegend'), 'the editor shows the legend for templates');
  // The outline never carries braces into the row (shared/templates.ts strips them).
  assert.ok(read('src/shared/templates.ts').includes("replace(/\\{\\{[^}]*\\}\\}/g, '')"), 'outlines strip placeholders');
  const vars = read('src/renderer/src/components/TemplateVar.tsx').replace(/\/\/.*$/gm, '');
  assert.ok(vars.includes('varInner(name)') && !vars.includes('{{'), 'the chip shows the name without its braces');
});

test('bookmarks: mock-up rows, and every ability kept', () => {
  const page = view('BookmarksPage.tsx');
  for (const bit of ['{kept.length} kept', 'Bookmark anything', 'w4b-bm-x', 'moveBookmark', 'removeBookmark', 'renameBookmark', 'addBookmark']) assert.ok(page.includes(bit), `bookmarks ${bit}`);
  // Files, folders, headings, searches and groups all still open where they should.
  for (const bit of ["case 'file'", "case 'folder'", "case 'heading'", "case 'search'", "case 'group'", 'revealInExplorer', 'requestSearch']) assert.ok(page.includes(bit), `bookmarks ${bit}`);
});

test('the living graph (8 Nov 2026: the find box, depth, chips and trio went with the card map)', () => {
  const page = view('GraphTab.tsx');
  // One dark canvas, whole or centred; Whole vault steps back out; the head counts the centre's links.
  for (const bit of ['<GraphView', 'local={false}', 'current={centre}', 'onCentre={recentre}', 'Whole vault', 'linked', 'useGraphData(revision, !!centre)', 'Click a point to see its links. Double-click to open it.']) assert.ok(page.includes(bit), `graph ${bit}`);
  assert.ok(!page.includes('w4b-map') && !page.includes('w4b-mcard'), 'no trio parts survive');
  // The centre follows the tab in and the tab follows it back out.
  assert.ok(page.includes('setCentre(tab.path ?? null)') && page.includes('W.updateTab(ws, tab.id, { path })'), 'centre and tab stay together');
  assert.ok(page.includes('W.updateTab(ws, tab.id, { path: undefined })'), 'Whole vault clears the centre');
});

test('files and assets: the table first, then the tiles, then the brand kit', () => {
  const page = view('AssetsPage.tsx');
  const grid = read('src/renderer/src/views/assets/AssetGrid.tsx');
  assert.ok(page.includes('<Icon name="plus" size={14} /> Add files') && page.includes('className="btn pri"'), 'Add files is the primary, icon + label like the other pages');
  for (const bit of ['<span>Name</span>', '<span>In</span>', '>Size</span>', '<span>Changed</span>', 'place?.(a)']) assert.ok(grid.includes(bit), `table ${bit}`);
  assert.ok(page.includes('Files ·'), 'the table leads');
  assert.ok(page.includes('bottom={section.kind') && grid.includes('bottom?: ReactNode'), 'tiles and brand kit below the table');
  // Several kits are real now (one per area or project, 5 Nov 2026): the highlights label counts past one kit,
  // else it names the one kit — still below the table, still opening the brand section.
  for (const bit of ['Assets · Logos, pictures, documents', 'Brand kit · ${', 'Brand kits · ${', 'Drop files here', "section: { kind: 'brand' }"]) assert.ok(page.includes(bit), `highlights ${bit}`);
  // Round 2: the rail's filters are chips in the strip above the table; the rail itself is gone.
  assert.ok(!page.includes('as-rail'), 'the rail moved into the strip');
  for (const bit of ['w4b-fstrip', 'FilterChip', "kind: 'type'", "kind: 'collection'", "kind: 'tag'", "kind: 'area'", "kind: 'attachments'"]) assert.ok(page.includes(bit), `strip ${bit}`);
  // Everything kept: search, sort, grid and list, details, collections, areas, drop-to-add.
  for (const bit of ['as-search', 'as-views', 'AssetDetails', 'newCollection', 'addFiles', 'BrandKitView']) assert.ok(page.includes(bit), `files keeps ${bit}`);
});

test('timeline: one bar per project, the zoom words, the group dropdown, the filters and the board', () => {
  const page = view('TimelineView.tsx');
  for (const bit of ['Group: {GROUP_WORDS[mem.group]}', 'className="seg"', 'tl-chips', 'scrollToDay(today', 'Drag a bar to move it']) assert.ok(page.includes(bit), `timeline ${bit}`);
  for (const bit of ['tl-needs', 'tl-board', 'onKeyDown', 'Alt+←', 'useMarkDrag', 'MarkCard']) assert.ok(page.includes(bit), `timeline keeps ${bit}`);
  // Round 2: bars with their dates on them, month heads, the clash note, Rows / Board / Timeline up top.
  for (const bit of ['monthName(t.day)', 'tl-clash-note', 'Clashes and slips show here first', 'aria-current="page"', 'openPortfolioBoard', 'A.openProjects()', 'moveBar']) assert.ok(page.includes(bit), `timeline ${bit}`);
  const bars = read('src/renderer/src/views/timeline/BarRow.tsx');
  for (const bit of ['tl-bbar', 'tl-bbar-words', 'barTint', 'barWords', 'rowSub', 'onMoveBar', 'markClass']) assert.ok(bars.includes(bit), `bars ${bit}`);
});

test('templates: the list, and the preview of the chosen template (or the first) beside it', () => {
  const page = view('TemplatesPage.tsx');
  assert.ok(page.includes('as-sheet') && page.includes('tp-scrim'), 'the preview comes in as a sheet over the list');
  assert.ok(page.includes('w4b-tp-name'), 'a template’s name opens its preview');
  // Layout round 3: list and detail, so the preview pane beside the list shows the chosen template, or the first.
  assert.ok(page.includes('visible.find((t) => t.path === selected) ?? visible[0]'), 'the preview shows the chosen template, or the first');
  assert.ok(!page.includes('tp-how'), 'the legend is not on the list');
  assert.ok(read('src/renderer/src/components/TemplateLegend.tsx').includes('In a template'), 'the legend says what a template can say');
});

test('canvas: one add toolbar, the count and saved words, the hint, the grey ground', () => {
  const page = view('CanvasView.tsx');
  // One toolbar (5 Nov 2026, rest-quieten M5): the top keeps the count and saved words, the toolbar below keeps
  // every add. The top bar's own add buttons are gone.
  for (const bit of ['w4b-cv-bar', 'w4b-cv-title', 'w4b-cv-status', 'useSaveState(path)', 'saved', 'cards', 'edge dot to join it']) assert.ok(page.includes(bit), `canvas ${bit}`);
  const bar = page.slice(page.indexOf('w4b-cv-bar'), page.indexOf('canvas-surface'));
  assert.ok(!bar.includes('+ Card') && !bar.includes('Web link'), 'the top bar adds nothing');
  for (const bit of ['Text card (T)', 'Sticky note (S)', 'A note: new, or one already here', 'A picture or file', 'A drawing: new, or one already here', 'A web link', 'A group (G)', 'Undo (Ctrl+Z)']) assert.ok(page.includes(bit), `canvas keeps ${bit}`);
  assert.ok(read('src/renderer/src/styles/canvas.css').includes('.canvas-surface') && read('src/renderer/src/styles/canvas.css').includes('background: var(--bg-side)'), 'grey board ground');
});

test('round 3: Home, a note, a project and search show the shared states', () => {
  // Home: the rows and cards in their real shapes while it loads; what happened with the next steps when the
  // vault can't be reached (the home-loading and home-error mock-ups).
  // 10.0: Home and Today are one page (TodayView), so its shared states live there.
  const home = view('HomeView.tsx') + view('TodayView.tsx');
  for (const bit of ['PageLoading', 'RowsSkeleton', 'CardsSkeleton', 'Opening your vault…', 'PageError', 'Your notes couldn’t be reached', 'Open another vault…', 'window.nv.vault.pick']) assert.ok(home.includes(bit), `home ${bit}`);
  // A note: the title, facts and body in their shapes while it opens; a failed open says so with a way back
  // (the note-loading and note-error mock-ups). The empty note is the editor's own placeholder, as drawn.
  const note = view('NoteView.tsx');
  for (const bit of ['PageLoading', 'Opening the note…', 'PageError', 'This note couldn’t be opened', 'Back to Notes', 'setAttempt']) assert.ok(note.includes(bit), `note ${bit}`);
  // A project: the head, facts and board in their shapes while it opens; a missing file says so with a way back
  // (the project-loading and project-error mock-ups). No tasks hides the section now (t12, 8 Nov 2026, wanted
  // nothing empty on show): each quiet tab offers its own Add one click away, and a brand-new project keeps its
  // short helpful start instead of the old project-empty mock-up.
  const project = view('ProjectPage.tsx');
  for (const bit of ['PageLoading', 'BoardSkeleton', 'Opening the project…', 'PageError', 'This project couldn’t be opened', 'Open the Bin', 'A.openBin']) assert.ok(project.includes(bit), `project ${bit}`);
  const tasks = view('project/ProjectTabs87.tsx');
  assert.ok(!tasks.includes('No tasks yet'), 'project tasks: no empty words on show');
  // t242's one view removed the project-tasks search and layouts (commit 4638960c5): no search states
  // left to pin; the brand-new start reads 'Add task' beside 'Add note' and 'Add key date'. t267: the foot
  // line went with the tabs (each quiet tab carries its own Add), the brand-new start stays.
  for (const bit of ['Add task', 'data-folio-empty']) assert.ok(tasks.includes(bit), `project tasks ${bit}`);
  assert.ok(!tasks.includes('data-folio-foot'), 'project tasks: the dead foot marker is gone');
  assert.ok(project.includes('function TabEmpty') && project.includes('data-add={id}'), 'project tasks: each quiet tab carries its own Add');
  // Search (round 4 joined with main's one search window): rows in their shape while the index answers; what
  // happened with another try when it doesn't; no match offers the helper while keeping the clear (the
  // search-loading, search-error and search-empty mock-ups).
  const search = read('src/renderer/src/components/SearchView.tsx');
  for (const bit of ['PageLoading', 'Searching ', 'PageError', 'Search isn’t working right now', 'PageEmpty', 'Nothing matches', 'Ask instead', 'askInChat', 'Clear the search']) assert.ok(search.includes(bit), `search ${bit}`);
});
