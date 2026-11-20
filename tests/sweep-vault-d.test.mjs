// node --test tests/sweep-vault-d.test.mjs — third-wave sweep D (3 Nov 2026, the plan): what the
// owner-side walk of the real app found in the Vault. Menus fit the window, the header search is one fixed bar,
// Projects health is quiet, Settings rows breathe, Today sits 36px down, the bell matches the former host app.
// Each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-sweep-d-'));
let MP;
let L;
let BP;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/menu-place.ts'), platform: 'node', output: { file: path.join(work, 'menu-place.mjs'), format: 'esm' }, logLevel: 'silent' });
  MP = await import(pathToFileURL(path.join(work, 'menu-place.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/projectLook.ts'), platform: 'node', output: { file: path.join(work, 'look.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'look.mjs')).href);
  await build({ input: path.join(root, 'src/shared/bell-place.ts'), platform: 'node', output: { file: path.join(work, 'bell.mjs'), format: 'esm' }, logLevel: 'silent' });
  BP = await import(pathToFileURL(path.join(work, 'bell.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('1: a menu always fits the window: below, above, shifted, capped only past the window', () => {
  const place = MP.menuPlace;
  // Room below: under its anchor, no cap.
  assert.deepEqual(place({ left: 100, top: 100, bottom: 130 }, { width: 220, height: 200 }, { width: 1219, height: 709 }, 40), { left: 100, top: 134 });
  // No room below, room above (the Packs menu near the foot): opens upward, whole.
  assert.deepEqual(place({ left: 20, top: 630, bottom: 660 }, { width: 220, height: 232 }, { width: 1219, height: 709 }, 40), { left: 20, top: 394 });
  // Shorter than the window but longer than either side (the More menu at 709): shifted up, whole, never capped.
  const more = place({ left: 20, top: 470, bottom: 500 }, { width: 220, height: 600 }, { width: 1219, height: 709 }, 40);
  assert.equal(more.maxHeight, undefined, 'a menu shorter than the window never caps');
  assert.equal(more.top, 101, 'shifted so the whole menu shows');
  assert.ok(more.top >= 40 && more.top + 600 <= 709 - 8, 'inside the window');
  // Longer than the window (the More menu at 600px): the window's full height, scrolled within.
  const tall = place({ left: 20, top: 450, bottom: 480 }, { width: 220, height: 600 }, { width: 1219, height: 600 }, 40);
  assert.deepEqual(tall, { left: 20, top: 40, maxHeight: 552 });
  // Never up under the window buttons, never past the right edge.
  assert.ok(tall.top >= 40, 'below the window buttons’ band');
  assert.equal(place({ left: 1200, top: 100, bottom: 130 }, { width: 220, height: 100 }, { width: 1219, height: 709 }, 40).left, 1219 - 220 - 6);
  // The shared Menu reads it, with the anchor's edges, so every popover benefits.
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(menu.includes("from '../../../shared/menu-place'"), 'Menu imports the shared placer');
  assert.ok(menu.includes('menuPlace({ left: x, top: ay, bottom: ab }'), 'placed by anchor edges and measured size');
});

test('2: the search is one bar centred by the grid; crowded page buttons hide into their menu', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(0, 1fr)'), 'the grid centres the bar between always-equal sides, 360px to 520px (Round 6: nothing overlaps by construction)');
  assert.ok(read('src/renderer/src/lib/headerOverflow.ts').includes('HEADER_SEARCH_FLOOR = 360'), 'the 360px floor under the middle track');
  // Projects: Weekly review, then New project, yield while their side crowds its cell (Round 2, 4 Nov 2026,
  // the reviewer: nothing may ever overlap the centred search; Round 6: centring wins, the most used last)
  // and ride in the menu only then, Due hint and all.
  const proj = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(proj.includes('data-overflow="weekly-review" data-overflow-order={1}'), 'Weekly review yields first');
  assert.ok(proj.includes('data-overflow="new-project" data-overflow-order={2}'), 'New project yields next');
  assert.ok(proj.includes("label: 'Weekly review'") && proj.includes('headerOverflowHidden(tab.id)'), 'the menu carries exactly the hidden ones');
  assert.ok(proj.includes("hint: reviewDue ? 'Due' : undefined"), 'the Due signal rides along');
  // Inbox, Today and Home: their actions yield measured behind a ⋯ that only shows then (suite-green,
  // 4 Nov 2026: the Today-and-Home job moved Change Home into the header beside the search — a page control
  // under the cards it arranges read as an afterthought — through this same contract, so Home joins the
  // yielding pages instead of the bare ones).
  // 5 Nov 2026, Home folded into Today: the button changes the cards it sits beside, so it says Change
  // cards (the dialog too) — same yielding contract, same one click away.
  for (const [f, words, item] of [['src/renderer/src/views/InboxPage.tsx', 'Inbox note', "label: 'Inbox note'"], ['src/renderer/src/views/TodayView.tsx', 'Start from a template', "label: 'Start from a template…'"], ['src/renderer/src/views/HomeView.tsx', 'Change cards', "label: 'Change cards…'"]]) {
    const src = read(f);
    assert.ok(src.includes('data-overflow=') && src.includes(words), `${f} yields its action`);
    assert.ok(src.includes('navbtn topbar-tight-only') && src.includes('data-overflow-fallback') && src.includes(item), `${f} keeps it one click away`);
  }
  // The listed pages without header buttons draw a bare bar, so the search matches everywhere.
  assert.ok(read('src/renderer/src/views/modules/work/MeetingsPage.tsx').includes('<ViewHeader tab={tab} />'), 'Meetings bare');
  for (const f of ['src/renderer/src/views/NotesPage.tsx', 'src/renderer/src/views/PeoplePage.tsx']) assert.ok(!read(f).includes('<ViewHeader'), `${f} keeps its actions in the page, out of the bar`);
});

test('3: Projects health is quiet: plain words, attention only for Off track and Overdue', () => {
  assert.deepEqual(L.healthPill({ health: 'off track', lateMine: 0 }), { words: 'Off track', tint: 'slate', attention: true });
  assert.deepEqual(L.healthPill({ health: 'on track', lateMine: 0, due: '2020-01-01', status: 'active' }), { words: 'Overdue', tint: 'slate', attention: true });
  assert.deepEqual(L.healthPill({ health: 'at risk', lateMine: 0 }), { words: 'At risk', tint: 'slate', attention: false });
  assert.deepEqual(L.healthPill({ health: 'on track', lateMine: 0 }), { words: 'On track', tint: 'slate', attention: false });
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(!home.includes('gtile xs ${') && !home.includes('gtile ${'), 'no tinted tile anywhere (was coral squares)');
  assert.ok(home.includes('className="gtile xs slate"') && home.includes('className="gtile slate"'), 'tiles always neutral slate');
  // 5 Nov 2026, status in plain words: the coral dot went with the chips — off track reads attention and
  // stronger, at risk attention, the rest muted; the words alone, never a tinted chip, dot or block.
  assert.ok(home.includes("tone === 'bad' ? 'is-attention is-strong' : tone === 'warn' ? 'is-attention' : 'is-muted'"), 'rows and gallery read attention, off track stronger');
  // Edit-in-place (t75) split the one due tag into an editable and a plain branch; both keep the same
  // rule: attention only when the due date is overdue (tone bad), muted otherwise.
  assert.ok(home.includes("tag is-plain ${due.tone === 'bad' ? 'is-attention' : 'is-muted'}"), 'board due tags read attention only when overdue');
  assert.ok(home.includes("col.id === 'off-track' ? 'is-attention is-strong'"), 'the off-track column reads attention, never a coral block');
  assert.ok(!home.includes('className="dot"'), 'no dot rendered anywhere on Projects');
  assert.ok(!home.includes('pill ${health.tint}') && !home.includes('tag ${health.tint}') && !home.includes('tag ${col.tint}') && !home.includes("tag ${due.tone"), 'no health-driven tint class left');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.pill .dot, .tag .dot'), 'the dot rule');
  assert.ok(/\.pill \.dot, \.tag \.dot\s*\{[^}]*background:\s*var\(--coral\)/s.test(kit), 'the dot is the one coral');
});

test('4: Settings headings are one size; the vault row breathes like the host app’s', () => {
  // Every group heading renders through the one .set-nav-name; only the base rule sets size and weight.
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('<div className="set-nav-name">{g.label}</div>'), 'one heading element for all five groups');
  const css = read('src/renderer/src/styles/settings-87.css');
  const heads = [...css.matchAll(/\.set-nav-name\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(heads.length >= 1, 'a heading rule');
  const sized = heads.filter((h) => h.includes('font-size') || h.includes('font-weight'));
  assert.equal(sized.length, 1, 'exactly one rule sets size and weight (the rest only pad)');
  assert.ok(sized[0].includes('font-size: var(--fs-small)') && sized[0].includes('font-weight: 600'), 'You, AI, Connections, Your work and Help read the same');
  // The vault row: folder left on one line, tags under it, Move… and Details right.
  assert.ok(settings.includes('className="setting-folder"') && settings.includes('className="setting-tags"'), 'folder with tags under the description');
  const row = settings.split('Where your notes are kept')[1].split('</Row>')[0];
  assert.ok(row.includes('Move…') && row.includes('<DetailsButton'), 'Move… and Details stay right');
  assert.ok(row.indexOf('setting-tags') !== -1 && row.indexOf('setting-tags') < row.indexOf('Move…'), 'tags under the description, controls at the edge');
  assert.ok(row.indexOf('Only on this PC') < row.indexOf('Move…') && row.indexOf('Not your usual vault') < row.indexOf('Move…'), 'both tags in the hint, none in the control');
  assert.ok(settings.includes('className="link-button"') && />\s*Details\s*</.test(settings), 'Details is a quiet link-button, as Learn more');
  assert.ok(css.includes('.setting-hint .setting-folder') && /\.setting-hint \.setting-folder \{[^}]*text-overflow: clip/.test(css), 'long folders clip on one line without dots, the full path on hover (t207 pass 2)');
});

test('5: Today starts its greeting with the rooms under its date line; area chips stay monochrome, hovered or picked', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  // p25 one column supersedes the sweep-D 36px pad (it sat the greeting lowest of every room): the date's block is
  // exactly 20px and the head gives those 20px back out of the frame's pad, so the greeting joins the other titles.
  assert.ok(/\.nv-today-head\s*\{[^}]*padding-top:\s*calc\(var\(--page-pad-top\) - 20px\)/s.test(frame), 'the head gives back exactly the date block');
  assert.ok(/\.td-head-top \.td-date\s*\{[^}]*line-height:\s*20px/s.test(frame), 'the date block is exactly 20px');
  const life = read('src/renderer/src/styles/life.css');
  for (const [sel, what] of [['.td-areas > button svg', 'at rest'], ['.td-areas > button:hover svg', 'hovered'], ['.td-areas > button.on svg', 'picked']]) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = life.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel}`);
    assert.ok(!rule.includes('var(--type'), `chip icons ${what} never read the area colour`);
  }
});

test('6: the bell matches the host app and its panel stays inside at 709 and 600', () => {
  const css = read('src/renderer/src/styles.css');
  const count = css.match(/\.places-bell-count\s*\{([^}]*)\}/s)?.[1] ?? assert.fail('no badge rule');
  assert.ok(count.includes('height: 14px') && count.includes('top: 2px') && count.includes('right: 1px'), 'the count at the corner, as the host app');
  assert.ok(count.includes('background: var(--primary)'), 'navy, as the host app\'s badge (shell parity, 4 Nov 2026), never the picked accent');
  // The foot bell flips its panel above it, fully inside, at both heights.
  for (const h of [709, 600]) {
    const at = BP.bellPanelPlace({ left: 40, top: h - 69, bottom: h - 37 }, { width: 1219, height: h });
    assert.ok(at.bottom !== undefined, `above the foot bell at ${h}px`);
    assert.ok(at.left >= 8 && at.left <= 1219 - 368, `inside sideways at ${h}px`);
  }
  const bell = read('src/renderer/src/panels/NoticeBell.tsx');
  assert.ok(bell.includes('bellPanelPlace(r, { width: window.innerWidth, height: window.innerHeight })'), 'placed by the one helper');
  assert.ok(bell.includes("state.unread > 9 ? '9+' : state.unread"), 'the count caps at 9+, as the host app');
});
