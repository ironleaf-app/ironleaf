// node --test tests/f10vault-fixes.test.mjs — the 10.0 fresh-eyes fixes, one guard per finding
// (inputs/a10vault-findings.md, 19 findings): the Direction B shell (foot, brand row, header avatar, Today row),
// one 38px title, Geist with no shipped serif, no pills (the global corner-shape rule lives in endless-shape),
// sentence case, no em dashes in the walked words, en-AU dates, switches on in primary, Blush retired, cool
// previews, the map card without its coral edge, one New note per screen, one Today, plain-word errors.
// Each test fails without its fix.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const places = () => read('src/renderer/src/panels/Places.tsx');
const footOf = () => places().split('export function PlacesFoot')[1] ?? assert.fail('no PlacesFoot');

test('1: the foot holds Settings above, the person with the bell at the very bottom', () => {
  // p11-uniform-account (4 Nov 2026): the profile row reads the licence account and opens the account settings;
  // the vault doors the old menu held stay in Settings (tests/uniform-account.test.mjs).
  const foot = footOf();
  // 20 Nov 2026: the foot is one account row with the bell; Settings and the version are in its menu
  // (tests/account-menu.test.mjs).
  assert.ok(!foot.includes('places-me') && !foot.includes('My account'), 'no old account block in the foot');
  assert.ok(foot.includes('<AccountChip variant="foot" />') && !foot.includes('places-settings'), 'the account row, Settings in its menu');
  assert.ok(places().includes('NoticeBell') && foot.includes('<NoticeBell />'), 'the bell beside the person, as in the host app');
  assert.ok(read('src/renderer/src/panels/Sidebars.tsx').includes('<PlacesFoot'), 'the one foot on every panel');
});

test('3: no avatar in the headers (the account is the foot’s row); the bell is in the foot, Ask is in the bar', () => {
  // 20 Nov 2026: the header's avatar (one in every pane, opening Settings › General) left for the side bar's account
  // chip, the one account door. 5 Nov 2026, one search door: the Ask button left the header (Ctrl+J still asks).
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(!bar.includes('<NoticeBell />') && !bar.includes('NoticeBell'), 'the bell left the header for the foot, as in the host app');
  assert.ok(!bar.includes('<span>Ask</span>') && !bar.includes('toggleChat'), 'no Ask button in the header');
  assert.ok(!bar.includes('HeaderAvatar') && !bar.includes('topbar-ava'), 'no avatar in every header');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'ask'"), 'asking stays a command (Ctrl+J)');
});

test('4: Today is its own nav row above Inbox, with its due count', () => {
  // 5 Nov 2026, the quiet rail and Home folded into Today: Today stands above Inbox now, the one morning place.
  const src = places();
  assert.ok(src.includes("label: 'Today'") && src.includes("icon: 'sun'") && src.includes('A.openToday()'), 'the Today row');
  // t31 (8 Nov 2026): sidebarTodayCount reads the one rule, shared with the former host app's one
  // side bar.
  assert.ok(src.includes('sidebarTodayCount('), 'its count is the one count Today and Tasks read');
  assert.ok(src.includes("const showToday = shows(prefs, 'ribbon:today');") && src.includes('{showToday && <Row row={f.today} />}'), 'Today gated on its own switch');
  assert.ok(src.indexOf('<Row row={f.today} />') < src.indexOf('<Row row={f.inbox} />'), 'Today above Inbox');
  assert.ok(!src.includes("label: 'Home'"), 'no Home row (Home folded into Today: old links open Today)');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'today'"), 'still in the palette');
});

test('5: list pages open with the same 38px title as every other screen', () => {
  assert.ok(!read('src/renderer/src/styles/w2b.css').includes('.w2b-list h1.nv-page-title'), 'the list override is gone');
  const title = read('src/renderer/src/styles/page-frame.css').match(/h1\.nv-page-title[^{]*\{([^}]*)\}/s)?.[1] ?? assert.fail('no page title rule');
  assert.ok(title.includes('650') && title.includes('var(--page-title)') && title.includes('var(--font-ui)'), 'one 38px Geist 650 title');
  assert.ok(read('src/renderer/src/styles/page-frame.css').includes('--page-title: var(--fs-page)'), 'the Page step');
});

test('6: no serif anywhere: only Geist ships, and display type points at it', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(!css.includes("'Ironleaf Sans'") && !css.includes("'Ironleaf Serif'"), 'no non-Geist faces');
  assert.ok(!css.includes('inter-latin') && !css.includes('source-serif'), 'no non-Geist files served');
  for (const f of ['inter-latin.woff2', 'inter-latin-italic.woff2', 'source-serif-4-latin.woff2'])
    assert.ok(!existsSync(path.join(root, 'src/renderer/src/assets/fonts', f)), `${f} is gone`);
  assert.ok(css.includes("--font-serif: 'Geist'") && css.includes("--font-display: 'Geist'"), 'serif and display point at Geist');
  const pubs = read('src/renderer/src/styles/publications.css');
  assert.ok(!pubs.includes('Ironleaf Serif') && !pubs.includes('Georgia'), 'publications read the interface font');
  assert.ok(!read('src/renderer/src/App.tsx').includes('Ironleaf Sans'), 'no dead fallback name in the look');
});

test('7+8: no pill shapes where the findings named them (the global rule is endless-shape’s)', () => {
  for (const [file, sels] of [
    ['today-hub.css', ['.th-action', '.th-pill-btn', '.th-num', '.th-meeting-time', '.th-new-meeting', '.th-note-open', '.th-tab', '.th-cal-tag', '.th-cal-note']],
    ['life-records.css', ['.lr-progress-track', '.lr-starter', '.lr-tag', '.lr-step-n', '.lr-protected']],
    ['family.css', ['.fy-today-pill', '.fy-lock']],
    ['work-weekly.css', ['.wu-chip']],
    ['personal-modules.css', ['.pm .pm-chip']],
    ['record-modules.css', ['.bi-note']],
  ]) {
    const css = noComments(read(`src/renderer/src/styles/${file}`));
    for (const sel of sels) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = css.match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
      assert.ok(!rule.includes('corner-shape'), `${file} ${sel} still rounds like a pill`);
    }
  }
  assert.ok(!read('src/renderer/src/styles/today-hub.css').includes('Circles and pills carry corner-shape'), 'the comment no longer embraces pills');
  assert.ok(!read('src/renderer/src/styles/reminders.css').includes('as every rounded thing of ours does'), 'nor the reminders one');
});

test('9: day heads, file counts and version stamps read sentence case', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!tasks.includes("month: 'long' }).toUpperCase()"), 'the day head is not uppercased in code');
  const assets = read('src/renderer/src/views/AssetsPage.tsx');
  assert.ok(!assets.includes('FILES ·') && !assets.includes('SHOWN'), 'the file count no longer shouts');
  assert.ok(assets.includes('Files ·') && assets.includes(' shown'), 'Files · 12 shown');
  const extras = noComments(read('src/renderer/src/components/Extras.tsx'));
  assert.ok(!extras.includes('.toUpperCase()'), 'no generated caps in Earlier versions');
  assert.ok(!extras.includes('AGAINST CURRENT') && !extras.includes("'CURRENT'") && !extras.includes("'COPY'") && !extras.includes("'COPIES'"), 'no hard-coded caps');
  assert.ok(extras.includes('Against current') && extras.includes('Current') && extras.includes('copies'), 'sentence case');
});

test('10: section and group heads are sentence case, with no tracking', () => {
  const files = ['styles.css', 'graph.css', 'timeline.css', 'flows.css', 'canvas.css', 'assets.css', 'docs.css', 'notebook.css', 'w2b.css', 'navigator.css'];
  for (const file of files) {
    const css = noComments(read(file === 'styles.css' ? 'src/renderer/src/styles.css' : `src/renderer/src/styles/${file}`));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*text-transform\s*:\s*uppercase[^{}]*)\}/g)) {
      const sel = m[1].trim().split(/\s+/).join(' ');
      assert.ok(file === 'styles.css' && (sel === '.side-title' || sel === '.tree-ext'), `${file}: tracked caps survive (${sel})`);
    }
  }
  for (const [file, sel] of [['styles.css', '.menu-heading'], ['styles.css', '.settings-body h3'], ['graph.css', '.lg-head'], ['flows.css', '.flow-palette h3'], ['assets.css', '.as-d-top-kind'], ['docs.css', '.doc-toc-label'], ['notebook.css', '.nb-group'], ['navigator.css', '.nav-section']]) {
    const css = noComments(read(file === 'styles.css' ? 'src/renderer/src/styles.css' : `src/renderer/src/styles/${file}`));
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(!rule.includes('letter-spacing'), `${file} ${sel} still tracked`);
  }
});

test('11: no em dashes in the walked words', () => {
  const files = ['src/renderer/src/views/BinView.tsx', 'src/renderer/src/views/TimelineView.tsx', 'src/renderer/src/views/GraphTab.tsx', 'src/renderer/src/panels/NoticeBell.tsx', 'src/renderer/src/views/AssetsPage.tsx', 'src/renderer/src/state/imports.ts', 'src/renderer/src/state/importCsv.ts', 'src/renderer/src/views/canvas/BoundCards.tsx', 'src/renderer/src/views/modules/publications/Puzzles.tsx'];
  for (const f of files) assert.ok(!noComments(read(f)).includes('—'), `${f}: an em dash survives`);
  // The vault-place ' — ' separators are parsing, not words.
  const place = noComments(read('src/renderer/src/components/VaultPlace.tsx')).split("' — '").join('').split('` — ').join('');
  assert.ok(!place.includes('—'), 'VaultPlace: an em dash survives outside its separators');
  assert.ok(read('src/renderer/src/views/modules/publications/Puzzles.tsx').includes('HARBOUR: Where the boats come in'), 'the clue placeholder shows the colon form the parser reads');
  // The clue error names the same colon form (the parser reads it); the tool-result strings keep their pinned form.
  const pubs = read('src/main/publications.ts');
  assert.ok(!pubs.includes('“ANSWER — clue”') && pubs.includes('“ANSWER: clue”'), 'the clue error shows the colon form');
});

test('12: dates and times read Australian English on any PC', () => {
  const files = [];
  const gather = (dir) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) gather(p);
      else if (/\.(tsx?|mts|cts)$/.test(e.name)) files.push(p);
    }
  };
  gather('src/renderer/src');
  for (const f of files) {
    const code = noComments(read(f));
    assert.ok(!code.includes('toLocaleString(undefined') && !code.includes('toLocaleTimeString([]') && !code.includes('toLocaleDateString(undefined') && !code.includes('toLocaleDateString([]'), `${f}: a date follows the PC locale`);
  }
  assert.ok(read('src/renderer/src/views/project/ProjectHub.tsx').includes("toLocaleTimeString('en-AU'"), 'project times pin en-AU');
});

test('13: a switch on is primary, whichever switch it is', () => {
  const base = noComments(read('src/renderer/src/styles.css'));
  assert.ok(/input\[type='checkbox'\]\.switch:checked\s*\{\s*background: var\(--primary\);/.test(base), 'the base switch');
  const kit = noComments(read('src/renderer/src/styles/kit.css'));
  assert.ok(/\.switch:not\(input\)\s*\{[^}]*background: var\(--primary\);/.test(kit), 'the button twin');
  assert.ok(noComments(read('src/renderer/src/styles/settings-87.css')).includes(".settings-body input[type='checkbox'].switch:checked { background: var(--primary); }"), 'Settings');
  assert.ok(noComments(read('src/renderer/src/styles/record-modules.css')).includes('.rf-switch.is-on .rf-knob { background: var(--primary); }'), 'records');
  assert.ok(!read('src/renderer/src/styles.css').includes('coral when on'), 'the base comment agrees');
  assert.ok(!read('src/renderer/src/styles/settings-87.css').includes('coral when on'), 'the Settings comment agrees');
});

test('14: Blush is offered like Sunny and Paper: a block, a choice, no migration (4 Nov 2026: nothing removed)', () => {
  const palettes = read('src/renderer/src/styles/palettes.css');
  assert.ok(palettes.includes("'blush'"), 'blush paints its own block');
  const prefs = read('src/shared/prefs.ts');
  assert.ok(prefs.includes("id: 'blush'"), 'offered in Settings');
  assert.ok(!prefs.includes("palette === 'blush'"), 'a stored blush stays blush');
  const search = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(search.includes('Lavender and more.'), 'Settings names the looks with room for all fourteen');
  for (const id of ['blush', 'sunny', 'paper', 'ocean', 'lagoon', 'forest', 'rose', 'cocoa', 'dusk']) assert.ok(search.includes(id), `search finds ${id}`);
});

test('15: previews paint cool grey, never beige or peach', () => {
  const assets = read('src/renderer/src/styles/assets.css');
  assert.ok(!assets.includes('#e9e6de') && !assets.includes('#d8d4c9') && !assets.includes('#fbfaf6'), 'cool checkers');
  assert.ok(assets.includes('repeating-conic-gradient(#e2e7ee 0 25%, #f2f4f7 0 50%)'), 'the Line-on-Mist pair');
  const pubs = read('src/renderer/src/styles/publications.css');
  assert.ok(!pubs.includes('#e4dfd6') && !pubs.includes('#f1d9cf'), 'no warm lines or peach answers');
  assert.ok(pubs.includes('.pb-front-cols i { background: repeating-linear-gradient(var(--border) 0 2px, transparent 2px 6px); }'), 'ruled lines on the Line token');
  assert.ok(pubs.includes('.pz-ws i.is-ans { background: var(--accent-soft);'), 'answers on the soft accent');
});

test('16: the living graph’s legend wears a quiet edge on the dark, never coral (8 Nov 2026: the cards went)', () => {
  const rule = noComments(read('src/renderer/src/styles/graph.css')).match(/\.lg-legend\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .lg-legend');
  assert.ok(rule.includes('border: 1px solid rgba(255, 255, 255, 0.14)'), 'the quiet light edge');
  assert.ok(!/var\(--(accent|accent-line|accent-base)\)/.test(rule), 'no coral on the edge');
});

test('17: one New button per screen, one label, one behaviour', () => {
  // 8 Nov 2026, the quiet More: the button is the New door (note with kind or template inline, canvas, view).
  const src = places();
  assert.ok(!src.includes('className="compose"'), 'the bar’s plus is gone');
  assert.ok((src.match(/places-action/g) ?? []).length === 1, 'the bar holds one main action');
  const action = src.match(/<button className="btn pri places-action"[\s\S]*?<\/button>/)?.[0] ?? assert.fail('no main action');
  assert.ok(action.includes('<span>New</span>') && action.includes('openNewDoor('), 'labelled New, opening the door');
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(bar.includes('title="New"') && bar.includes('aria-label="New"'), 'the header plus shares the label');
  assert.ok(bar.includes('openNewDoor('), 'and the behaviour');
  const head = read('src/renderer/src/views/TodayView.tsx').split('<ViewHeader')[1].split('</ViewHeader>')[0];
  assert.ok(!head.includes('New note'), 'Today’s fourth New is gone');
  assert.ok(head.includes('Start from a template'), 'its own action stays');
});

test('18: one Today: the daily note is found by its name, Today keeps the day page', () => {
  // Back in More's quiet second group (9 Nov 2026): Ctrl+K keeps it too.
  assert.ok(places().includes("label: 'Daily note'"), 'More names it again');
  assert.ok(!places().includes("label: 'Today’s note'"), 'More names no second Today');
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes("name: 'Open the daily note'"), 'the palette names the daily note');
  assert.ok(cmds.includes("name: 'Open Today'"), 'the day page keeps Today');
  assert.ok(read('src/shared/prefs.ts').includes("label: 'Daily note'"), 'its switch is back with the row');
});

test('19: files fail in plain words, with somewhere to go', () => {
  const pdf = read('src/renderer/src/views/pdf/PdfView.tsx');
  assert.ok(pdf.includes('This PDF is too large to show here.'), 'too-big PDFs say so plainly');
  assert.ok(!pdf.includes('? err.message'), 'never the engine’s own message');
  assert.ok(pdf.includes('Open in its default app'), 'with somewhere to go');
  const career = read('src/renderer/src/views/modules/personal/CareerPage.tsx');
  assert.ok(career.includes('That contact couldn’t be added just now.'), 'a friendly write-failed line');
  assert.ok(career.includes('console.warn'), 'the raw error logged, not shown');
  assert.ok(!career.includes('showError(e instanceof Error ? e : new Error(String(e)))'), 'never the raw object');
});
