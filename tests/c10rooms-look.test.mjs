// node --test tests/c10rooms-look.test.mjs — the 10.0 rooms critique fixes, one guard per finding
// (the findings F1-F10): the header wraps instead of overlapping, the brief's kind tag stays slate with a
// plain Open, tabs scroll instead of cutting, the note-foot Filter yields, the project hero's subtitle wraps and
// its art stands down by the middle's width, clipped Settings hints keep their words, "File in" in sentence case.
// Each test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return noComments(css).match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel}`);
};

test('F1: the header is one row, never overlapping, and the search never crushes or paints over', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const bar = rule(kit, '.topbar');
  assert.ok(bar.includes('min-height: var(--header-h)'), '57px tall (shell parity, 4 Nov 2026: token 56 + hairline)');
  assert.ok(bar.includes('display: grid') && bar.includes('column-gap: 12px') && bar.includes('container-name: topbar'), 'one row (3 Nov 2026), the grid keeping 12px, measured as a container');
  assert.ok(!/^\s*height: var\(--header-h\)/m.test(bar), 'no exact height clipping');
  assert.ok(rule(kit, '.topbar .crumb').includes('min-width: 0'), 'the crumb shrinks instead of shoving actions out');
  const search = rule(kit, '.topbar .top-search');
  assert.ok(search.includes('width: 100%') && search.includes('max-width: 520px') && search.includes('min-width: 0'), 'the search keeps one 520px-max bar on every page, filled from its track; page actions give way first (shell parity, 4 Nov 2026; was flex 1 1 250px)');
  assert.ok(search.includes('overflow: hidden'), 'search contents never paint over the neighbour');
  assert.ok(rule(kit, '.topbar .top-search .clip').includes('min-width: 0'), 'the placeholder shrinks with an ellipsis');
  assert.ok(rule(kit, '.topbar .top-search kbd').includes('flex: none'), 'the key hint keeps its shape');
  const narrow = noComments(kit).match(/@media \(max-width: 1150px\) \{([\s\S]*?)\n\}/)?.[1] ?? assert.fail('no narrow rule');
  assert.ok(narrow.includes('.topbar .crumb') && narrow.includes('display: none'), 'the crumb yields first');
  assert.ok(narrow.includes('.topbar .right .avatars') && narrow.includes('display: none'), 'the people stack yields (the People tab keeps it)');
});

test('F2: the brief kind tag stays slate; tone never repaints a kind', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('<span className="tag slate">{kindWords(item.kind)}</span>'), 'one tag, always slate');
  assert.ok(!home.includes("item.tone === 'warn' ? 'amber'"), 'no tone conditional on the kind tag');
});

test('F3: every brief open action reads plain Open (the detail names the target)', () => {
  const brief = read('src/shared/brief.ts');
  assert.ok(!brief.includes('`Open ${short(x.projectName'), 'no Open <project> label');
  assert.ok(brief.includes("label: 'Open meeting note'"), 'Open meeting note keeps its what');
});

test('F4: kit tabs scroll instead of cutting, one line per tab, and show they scroll', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const tabs = rule(kit, '.tabs');
  assert.ok(tabs.includes('overflow-x: auto'), 'cut tabs scroll into reach');
  assert.ok(!tabs.includes('scrollbar-width: none'), 'no hidden scrollbar (10.0 third round F2: invisible scroll is cut for a mouse)');
  assert.ok(noComments(kit).includes('.tabs, .nv-tabs') && !noComments(kit).includes('.foot-tabs') && noComments(kit).includes('scrollbar-width: thin'), 'one thin thumb over every strip kind (the foot strip went with its tabs, 5 Nov 2026 rest-quieten and v6)');
  const tab = rule(kit, '.tab');
  assert.ok(tab.includes('flex: none') && tab.includes('white-space: nowrap'), 'labels and counts never wrap');
});

test('F5: the note-foot Filter wraps under the bar, the title keeps its width, sections head the list', () => {
  // One Linked list (5 Nov 2026, rest-quieten and v6): sections, not tabs. The folded title keeps its width;
  // the Filter wraps under the bar instead of shrinking (10.0 N12).
  const css = read('src/renderer/src/styles/note-foot.css');
  assert.ok(rule(css, '.foot-title').includes('white-space: nowrap'), 'the title keeps its width');
  const search = rule(css, '.foot-search');
  assert.ok(search.includes('flex: 1 0 168px') && search.includes('min-width: min(168px, 100%)'), 'the Filter wraps under the bar instead of shrinking (10.0 N12)');
  assert.ok(!css.includes('.foot-tab'), 'no tab rules left');
  assert.ok(rule(css, '.foot-section-head').includes('font-weight: 600'), 'sections head the list quietly');
});

test('F6/F7: the project lead clamps to two lines with Read more, and the tab bar scrolls with a fade', () => {
  // 5 Nov 2026, the vault folio: the hero (subtitle clamp, art stand-down) is gone; the lede reads whole and
  // the sticky line is the narrow-middle rule now. v9, 6 Nov 2026: the hero is back — the lead reads two
  // lines at most, the whole a quiet Read more away (t207 pass 2: a height cap, not a clamp, because a clamp
  // draws dots).
  const css = read('src/renderer/src/styles/w2a.css');
  const lead = rule(css, '.w2a-psub .w2a-clip');
  assert.ok(!lead.includes('-webkit-line-clamp'), 'no clamp, so no dots');
  assert.ok(/max-height: calc\(2 \* 1lh\)/.test(lead), 'the lead reads two lines at most');
  assert.ok(lead.includes('display: block'), 'a block box, so the height cap applies to the inline span (t215)');
  assert.ok(css.includes('.w2a-psub .w2a-readmore'), 'one quiet Read more opens the whole');
  // t267: the folio line is the shared tab bar now (the dead folionav rules went with the foot).
  const barCss = read('src/renderer/src/styles/page-tabs.css');
  const bar = rule(barCss, '.pt-bar[role="tablist"]');
  assert.ok(bar.includes('flex-wrap: nowrap'), 'the bar never wraps to a second line');
  assert.ok(bar.includes('overflow-x: auto'), 'it scrolls sideways instead');
  assert.ok(barCss.includes('.pt-bar[data-fade="right"]'), 'with a fade signalling more, never dots');
  assert.ok(noComments(css).includes('.pj-page { container: pj / inline-size; }'), 'the page is a sized container');
  assert.ok(!noComments(css).includes('@media (max-width: 760px)'), 'no viewport rule missing docked sides');
});

test('F9: the Today hero breaks out by the column gutter token, never a fixed margin', () => {
  const css = read('src/renderer/src/styles/today.css');
  const hero = rule(css, '.nv-today-head.nv-hero');
  assert.ok(hero.includes('margin: 0 calc(var(--page-pad-side) * -1) 24px'), 'the breakout matches the gutter by construction');
  assert.ok(hero.includes('padding: 44px var(--page-pad-side) 34px'), 'the text insets match the column');
  const narrow = noComments(css).match(/@container today \(max-width: 620px\) \{([\s\S]*?)\n\}/)?.[1] ?? assert.fail('no narrow rule');
  assert.ok(!narrow.includes('margin: 0 -18px'), 'no fixed margin disagreeing with the gutter');
});

test('F8: a clipped Settings hint keeps its full words on hover', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes("title={oneLine && typeof hint === 'string' ? hint : undefined}"), 'string hints ride on title');
});

test('F10: sentence case in the Inbox filing row; no literal caps labels in the rooms', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(!inbox.includes('>FILE IN<'), 'FILE IN is gone');
  assert.ok(inbox.includes('>File in<'), 'File in reads sentence case');
  for (const f of ['src/renderer/src/views/TodayView.tsx', 'src/renderer/src/views/HomeView.tsx', 'src/renderer/src/views/InboxPage.tsx', 'src/renderer/src/views/NoteView.tsx', 'src/renderer/src/views/ProjectsHome.tsx', 'src/renderer/src/views/ProjectPage.tsx', 'src/renderer/src/views/PeoplePage.tsx', 'src/renderer/src/views/PersonPage.tsx', 'src/renderer/src/views/NotesPage.tsx', 'src/renderer/src/views/LockedView.tsx', 'src/renderer/src/panels/ChatPanel.tsx', 'src/renderer/src/components/Settings.tsx']) {
    const code = noComments(read(f)).replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/>[A-Z][A-Z0-9 /&·-]{3,}</g)) assert.fail(`${f}: caps label ${m[0]}`);
  }
});
