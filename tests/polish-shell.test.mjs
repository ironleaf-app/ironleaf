// node --test tests/polish-shell.test.mjs — Polish round 1 (29 Oct 2026, the plan items 1 to 8): the one
// page frame, the calmer PageHead, Meetings and People opening their own pages, one pane on reopen, Notes rows
// with the title on its own line and no repeated "Part of", Inbox actions on hover, the quiet path bar, and
// long task lines wrapping to two lines. Polish round 2 (same day, ITEMS 1 to 4): Docs and Daily from Your notes
// open the Notes page with that filter and no kind opens the Files panel from the nav; with tabs off an opening
// replaces the page in the one pane and never makes a split; the context rail hides the person's own name, is a
// fixed 280 px and never breaks a label mid-word; note property rows share one 180 px label column. A new
// behaviour gets a check that would fail without it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-shell-'));
let N, W, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, file))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  N = await make('notes', 'src/shared/notes-list.ts');
  W = await make('workspace', 'src/renderer/src/state/workspace.ts');
  P = await make('plan', 'src/renderer/src/components/plan/plan.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('item 5: a snippet never repeats the project its chip already names', () => {
  assert.equal(N.snippetForDisplay('Part of Marlowe Gallery Fit-out (Tessaly Studio). From the survey', 'Marlowe Gallery Fit-out (Tessaly Studio)'), 'From the survey');
  assert.equal(N.snippetForDisplay('Part of Desk Hub. The Tessaly consultant', 'Desk Hub'), 'The Tessaly consultant');
  assert.equal(N.snippetForDisplay('Part of Desk Hub', 'Desk Hub'), '');
  assert.equal(N.snippetForDisplay('Part of Another Project. Words', 'Desk Hub'), 'Part of Another Project. Words', 'another project stays');
  assert.equal(N.snippetForDisplay('Part of Desk Hub Extra. Words', 'Desk Hub'), 'Part of Desk Hub Extra. Words', 'a longer name is not this project');
  assert.equal(N.snippetForDisplay('Notes on the Part of the plan', 'Desk Hub'), 'Notes on the Part of the plan', 'only a lead goes');
  assert.equal(N.snippetForDisplay('Plain words', undefined), 'Plain words');
});

test('item 4: a split left from an old session reopens as one pane, the active page kept', () => {
  let ws = W.defaultWorkspace();
  ws = W.open(ws, { type: 'note', path: 'A.md' });
  ws = W.open(ws, { type: 'note', path: 'B.md' }, 'right');
  assert.equal(W.groups(ws.root).length, 2, 'the session is split before it is saved');
  const activePath = W.activeTab(ws).path;
  // Polish round 3 (ITEMS 4): one pane on reopen is with tabs off; with tabs on the split is kept.
  W.showTabs(false);
  try {
    const restored = W.restore(JSON.parse(JSON.stringify(ws)));
    assert.equal(restored.root.kind, 'group', 'one pane on reopen');
    assert.equal(W.groups(restored.root).length, 1);
    assert.equal(W.activeTab(restored).path, activePath, 'the active page is kept in front');
    assert.deepEqual(W.groups(restored.root)[0].tabs.map((t) => t.path).sort(), ['A.md', 'B.md'], 'no pane loses its tabs');
    const single = W.restore(JSON.parse(JSON.stringify(W.defaultWorkspace())));
    assert.equal(single.root.kind, 'group', 'a single pane stays a single pane');
  } finally {
    W.showTabs(true);
  }
});

test('items 1, 2, 6, 7 and 8: the polish frame holds the numbers the brief names', () => {
  const css = read('src/renderer/src/styles/polish-shell.css');
  // 20 Nov 2026: the widths are named once, in page-frame.css (--w-content 1160, the 36 px gutter on the
  // spacing scale); this sheet no longer sets its own.
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.match(frame, /--w-content:\s*1160px/, 'one content width, named');
  assert.match(frame, /--page-max: calc\(var\(--w-content\) \+ 2 \* var\(--page-pad-side\)\)/, 'the column is the content width plus its gutters');
  assert.match(frame, /--page-pad-side: var\(--space-6\)/, 'a 36 px side gutter');
  assert.match(frame, /--space-6: 36px/, 'which is the scale\u2019s 36');
  assert.doesNotMatch(css, /^\s*--page-max:\s*\d+px/m, 'this sheet sets no width of its own');
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*?--page-pad-side:\s*16px/, '16 px under 1000 px');
  assert.match(css, /\.nv-page-icon\s*\{\s*width:\s*28px;\s*height:\s*28px/, 'the PageHead icon tile is 28 px');
  assert.doesNotMatch(css, /\.nv-page-lead\.nv-page-lead\s*\{[^}]*-webkit-line-clamp/, 'the summary never clamps with dots (t207 pass 2: it wraps whole)');
  assert.match(css, /\.nv-page-lead\.nv-page-lead\s*\{[^}]*overflow-wrap:\s*break-word/, 'the summary wraps whole words');
  assert.match(read('src/renderer/src/styles/kit.css'), /\.topbar \{\s*min-height: var\(--header-h\)[\s\S]*?border-bottom: 1px solid var\(--border\)/, 'the 57px top bar spans the window with its divider (8.7 wave 1 replaces the path band; 3 Nov: one row, never wrapping)');
  assert.match(css, /\.ib-item:hover \.ib-actions/, 'Inbox actions show on hover');
  assert.doesNotMatch(css, /\.td-row-what > \.td-text,\s*\.tk-row \.td-row-what > \.td-text\s*\{[^}]*-webkit-line-clamp/, 'long task lines never clamp with dots (t207 pass 2: they wrap whole)');
  assert.match(css, /\.td-row-what > \.td-text,\s*\.tk-row \.td-row-what > \.td-text\s*\{[^}]*overflow-wrap:\s*break-word/, 'long task lines wrap whole words');
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, 'numbers are tabular');
  assert.ok(read('src/renderer/src/main.tsx').includes("styles/polish-shell.css"), 'the polish frame is loaded');
});

test('item 3: Meetings opens the Meetings page and People the People page, never the tables', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.match(places, /open: \(\) => openMeetings\(\)/, 'the nav Meetings row opens the Meetings page');
  assert.match(places, /open: \(\) => openPeople\(\)/, 'the nav People row opens the People page');
  assert.match(places, /onClick=\{row\.open\}/, 'a row runs its own opener');
  const ws = read('src/renderer/src/views/Workspace.tsx');
  // 5 Nov 2026, views load with their route: the Meetings page arrives through lazy(), same page, loaded later.
  assert.match(ws, /const MeetingsPage = lazy\(\(\) => import\('\.\/modules\/work\/MeetingsPage'\)/, 'Workspace opens the new Meetings page (additive line, ITEMS 3)');
  assert.match(ws, /tab\.type === 'meetings' \? \(\s*<MeetingsPage/, 'a meetings tab draws the Meetings page');
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.match(types, /typeId === 'meeting' \|[|] typeId === 'person'/, 'opening a meeting or person type routes to its own page');
  assert.match(types, /asTable/, 'an explicit table ask is the only way back to a table');
  assert.match(read('src/renderer/src/views/PeoplePage.tsx'), /openTypePage\('person', 'tab', \{ asTable: true \}\)/, 'Show as a table still shows a table');
});

test('items 5 and 6: Notes and Inbox rows are built the new way', () => {
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.match(notes, /nj-row-line2/, 'chip, kind and date sit on the second line');
  assert.match(notes, /snippetForDisplay\(r\.snippet, r\.project\?\.name\)/, 'the snippet is shown without its repeated lead');
  assert.doesNotMatch(notes, /nj-row-side/, 'nothing squeezes the title from the side any more');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  // The w2a cards (30 Oct 2026): the suggested File button leads the actions as the one primary, and the rest
  // are the mock-up's plain word buttons.
  assert.match(inbox, /w2a-ib-actions[\s\S]*?fileToWords\(lead\)[\s\S]*?Move to a project/, 'the suggested File button leads the actions');
  assert.match(inbox, /className="btn pri"[\s\S]{0,300}\{fileToWords\(lead\)\}/, 'the suggestion is the one primary');
  assert.match(inbox, /'Move to a project' : 'Make it a task'/, 'a tick-box line moves to a project, a plain line still becomes a task (5 Nov 2026: one bad label fixed)');
  assert.match(inbox, />\s*File…\s*</, 'File… is a plain word button');
  assert.match(inbox, />\s*Done\s*</, 'Done is a plain word button');
});

test('round 2 item 1: Docs and Daily open the Notes page with that filter; no kind opens the Files panel from the nav', () => {
  const shell = read('src/renderer/src/state/shellTypes.ts');
  assert.doesNotMatch(shell, /askForSection|openSection|showSide\('left', 'files'\)/, 'the Files-panel fallback is gone from shellTypes');
  assert.doesNotMatch(shell, /id: 'views'/, 'Views is not listed under Your notes');
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.match(types, /typeId === 'doc' \|[|] typeId === 'daily'/, 'Docs and Daily route together in openTypePage');
  assert.match(read('src/renderer/src/views/NotesPage.tsx'), /fromTab === 'daily' \? 'daily'/, 'the Notes page starts on the Daily filter');
  assert.match(read('src/renderer/src/views/Workspace.tsx'), /typeOfTab\(tab\) === 'daily'\)/, 'Workspace draws the Notes page for a daily type tab (additive line, ITEMS 1)');
  assert.match(read('src/renderer/src/state/commands.ts'), /id: 'files', name: 'Show your files'/, 'the Files panel still opens from Ctrl+K › Show your files (8 Nov 2026, the quiet More: out of More)');
  assert.match(read('src/renderer/src/state/menus.ts'), /Show in the file list/, 'and from Show in the file list');
});

test('round 2 item 2: with tabs off, opening replaces the page in the one pane and never makes a split', () => {
  W.showTabs(true);
  let ws = W.defaultWorkspace();
  ws = W.open(ws, { type: 'note', path: 'A.md' });
  ws = W.open(ws, { type: 'note', path: 'B.md' }, 'right');
  assert.equal(W.groups(ws.root).length, 2, 'a split exists before tabs go off');
  W.showTabs(false);
  try {
    const opened = W.open(ws, { type: 'note', path: 'C.md' }, 'tab');
    assert.equal(opened.root.kind, 'group', 'the old split is closed');
    assert.equal(W.groups(opened.root).length, 1, 'one pane only');
    assert.equal(W.activeTab(opened).path, 'C.md', 'the opened note replaces the page on show');
    assert.ok(W.groups(opened.root)[0].tabs.some((t) => t.path === 'A.md'), 'the other pane page is kept behind it, not lost');
    const beside = W.open(W.defaultWorkspace(), { type: 'note', path: 'D.md' }, 'right');
    assert.equal(W.groups(beside.root).length, 1, 'opening beside makes no split by itself');
    assert.equal(W.activeTab(beside).path, 'D.md');
    const revealed = W.revealExisting(ws, 'A.md');
    assert.ok(revealed && W.groups(revealed.root).length === 1 && W.activeTab(revealed).path === 'A.md', 'an already-open note is revealed in the one pane');
    // 8.0.1: the Graph centred on a project carries its path; Open must open the project, not come back to the Graph.
    const onGraph = W.open(W.defaultWorkspace(), { type: 'graph', path: 'Work/Projects/X/X.md' });
    assert.equal(W.revealExisting(onGraph, 'Work/Projects/X/X.md'), null, 'a Graph page centred on a project is not that project');
  } finally {
    W.showTabs(true);
  }
});

test('round 2 item 3: the rail hides the person own name, stays 280 px, and its labels never break mid-word', () => {
  assert.equal(P.isOwnName('Jesse Arlow', 'Jesse Arlow'), true);
  assert.equal(P.isOwnName('Jesse', 'Jesse Arlow'), true, 'their first name alone is them');
  assert.equal(P.isOwnName('me', 'Jesse Arlow'), true);
  assert.equal(P.isOwnName('Sam Lee', 'Jesse Arlow'), false, 'other people still show');
  assert.equal(P.isOwnName(undefined, 'Jesse Arlow'), false);
  const rail = read('src/renderer/src/views/note/ContextRail.tsx');
  assert.match(rail, /import \{ isOwnName \} from '..\/..\/components\/plan\/plan'/, 'the rail uses plan.ts isOwnName');
  // t146 (9 Nov 2026): Today's answer comes through the kept todayData(), ProjectPage the same way.
  assert.match(rail, /todayData\(\)\.then\(\(d\) => live && setMe\(d\.me\)/, "the rail takes Today's me, as ProjectPage does");
  assert.match(read('src/renderer/src/views/ProjectPage.tsx'), /todayData\(\)\.then\(\(d\) => live && setMe\(d\.me\)/, 'ProjectPage takes the same me');
  assert.match(rail, /!isOwnName\(t\.owner, me\)/, 'an own-name owner chip is not drawn');
  assert.doesNotMatch(rail, /ownNames/, 'project owners are no longer mistaken for the person');
  const css = read('src/renderer/src/styles/note-context.css');
  assert.match(css, /\.nv-rail \{\s*width: 280px;\s*flex: 0 0 280px;/, 'the rail is a fixed 280 px');
  // 10.0 third round F1: a narrow middle folds the rail (the old window-keyed 900 px rule crushed the note to
  // ~220 px with the side chat docked). The open rail is still never squeezed: it draws over the note instead.
  assert.match(css, /\.nv-note-layout \{\s*display: flex;\s*align-items: stretch;\s*(?:\/\*[\s\S]*?\*\/\s*)?justify-content: center;\s*min-height: 0;\s*flex: 1;\s*position: relative;\s*container: nvnote \/ inline-size;/, 'the note layout is a sized container for its own width');
  const narrow = /@container nvnote \(max-width: 600px\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';
  assert.match(narrow, /\.nv-rail\.is-strip \{ width: 40px; flex-basis: 40px;/, 'a narrow middle folds the strip to its bar');
  assert.match(narrow, /\.nv-rail:not\(\.is-strip\):not\(\.is-shut\) \{[^}]*position: absolute;/s, 'an opened rail draws over, never beside');
  assert.doesNotMatch(css, /@media \(max-width: 900px\)/, 'no window-keyed rule missing docked sides');
  // 5 Nov 2026, the huge right panel: the brief sets the panel at 260 to 300 px (was 220), so the strip
  // holds the rail's 280 px instead of its own narrower width.
  assert.match(css, /\.nv-rail\.is-strip \{ width: 280px; flex-basis: 280px; \}/, 'the slim strip holds the panel width');
  assert.match(css, /\.nv-rail-section h3,\s*\.nv-rail-field > span \{\s*white-space: nowrap;/, 'rail labels stay whole');
  assert.match(css, /\.nv-note-main \.cm-content,\s*\.nv-note-main \.reading-page \{\s*max-width: calc\(var\(--page-column/, 'the note keeps a comfortable reading width beside the rail');
});

test('round 2 item 4: one label column wide enough for its words, values aligned', () => {
  const css = read('src/renderer/src/styles/note-page.css');
  assert.match(css, /--field-label: 180px;/, 'the one label column is 180 px');
  assert.doesNotMatch(css, /--field-label: minmax\(96px/, 'the old squeezing column is gone');
  assert.match(css, /\.field-row \{\s*display: grid;\s*grid-template-columns: var\(--field-label\) minmax\(0, 1fr\);/, 'every row uses that column, so values align');
  assert.match(css, /\.page-people-label \{[^}]*white-space: nowrap;/, '"Also mentioned" never breaks mid-word');
});

test('item 7: the path bar never repeats the title', () => {
  const head = read('src/renderer/src/views/ViewHeader.tsx');
  assert.match(head, /repeatsTitle/, 'the bar works out when its name would repeat the PageHead');
  // A note's inline title below is a repeat too (t7-note-window, 8 Nov 2026): the page says so.
  assert.match(head, /!repeatsTitle &&( !hideName &&)? <b>\{name\}<\/b>/, 'a repeating name is not drawn');
});
