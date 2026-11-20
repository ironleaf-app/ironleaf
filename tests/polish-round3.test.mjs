// node --test tests/polish-round3.test.mjs — Polish round 3 (29 Oct 2026, the plan items 1, 2, 4 and 5):
// Meetings in the nav works for everyone (it reads the vault's meetings whether or not the Meetings module is
// switched on; its extras stay with the module), every summary line joins its parts with " · " so words never
// run together, with tabs off there is one pane on every vault open and in normal use (bringing a page forward
// from another pane closes the split; only a person's own Split choice makes one), and the Projects page's
// filter tabs scroll sideways in a narrow pane instead of wrapping. Made-up names only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-round3-'));
let S, W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (name, file) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, file))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  S = await make('summary', 'src/shared/summary-line.ts');
  W = await make('workspace', 'src/renderer/src/state/workspace.ts');
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('item 2: a summary line joins its parts with " · ", so its words always have spaces', () => {
  const parts = S.summaryParts([
    { words: '18 projects' },
    { words: '11 at risk', tone: 'warn' },
    false,
    { words: '7 on track', tone: 'ok' },
    null,
    { words: '2 due within a week' },
    { words: '' },
  ]);
  assert.deepEqual(parts.map((p) => p.words), ['18 projects', '11 at risk', '7 on track', '2 due within a week'], 'empty parts leave no gaps');
  const line = S.summaryLine(parts);
  assert.equal(line, '18 projects · 11 at risk · 7 on track · 2 due within a week');
  assert.doesNotMatch(line, /projects11|risk7|track2/, 'no two parts run together without a space');
  assert.equal(S.summaryLine([{ words: '1 project' }]), '1 project', 'one part has no separator');
  assert.equal(S.summaryLine([]), '');
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  // The w2a home (30 Oct 2026) carries the counts in its filter chips — the mock-ups have no summary line — so
  // the same intent lives in the chips and the joins.
  assert.match(home, /counts\.warn \+ counts\.bad/, 'Needs attention still counts the at-risk projects');
  assert.match(home, /counts\.due/, 'Due soon still counts what is still to come');
  // Edit-in-place (t75) split the row's join(' · ') into editable JSX: the separator lives as {' · '}
  // between steps and due, and as ` · ${...}` for the layout line — both with spaces, same promise.
  assert.ok(home.includes("{' · '}"), 'a joined line parts its words with " · "');
  assert.ok(home.includes('` · ${'), 'the layout line parts its words too');
  assert.match(home, /Finished · /, 'finished rows keep their spaces too');
  assert.doesNotMatch(home, /join\(''\)|join\(""\)/, 'no parts are joined without a separator');
});

test('item 1: the nav Meetings page reads meetings with the module off; its extras stay with the module', () => {
  const main = read('src/main/work-modules.ts');
  assert.match(main, /meetings/, 'the main side knows Meetings is the nav page');
  assert.match(main, /name !== 'prep'/, 'the prep pack (an extra) still needs the module on');
  assert.match(main, /add-series/, 'series (an extra) still needs the module on');
  const meetings = read('src/main/work/meetings.ts');
  assert.doesNotMatch(meetings.slice(meetings.indexOf('async function addMeeting'), meetings.indexOf('async function addSeries')), /w\.need\('meetings'\)/, 'adding a meeting (the core page) is not refused while the module is off');
  const modules = read('src/renderer/src/state/modules.ts');
  assert.match(modules, /id === 'meetings'/, 'opening Meetings goes to the nav Meetings page, not the module tab that says it is switched off');
  assert.match(modules, /type: 'meetings'/, 'on a meetings tab, so Workspace draws the Meetings page');
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.match(places, /open: \(\) => openMeetings\(\)/, 'the nav row still opens Meetings');
});

test('item 4: with tabs off, a saved split reopens as one pane, and bringing a page forward closes a split', () => {
  W.showTabs(true);
  let ws = W.defaultWorkspace();
  ws = W.open(ws, { type: 'note', path: 'A.md' });
  ws = W.open(ws, { type: 'note', path: 'B.md' }, 'right');
  assert.equal(W.groups(ws.root).length, 2, 'a split exists before it is saved');
  const saved = JSON.parse(JSON.stringify(ws));
  // Tabs on: the person's split is theirs to keep.
  const kept = W.restore(saved);
  assert.equal(W.groups(kept.root).length, 2, 'with tabs on, a saved split reopens as it was');
  W.showTabs(false);
  try {
    const restored = W.restore(saved);
    assert.equal(restored.root.kind, 'group', 'with tabs off, every vault open closes the split');
    assert.equal(W.groups(restored.root).length, 1);
    assert.deepEqual(W.groups(restored.root)[0].tabs.map((t) => t.path).sort(), ['A.md', 'B.md'], 'no pane loses its pages');
    // Normal use: a page already open in the other pane comes forward in the one pane (nav openers go through
    // activate with a tab, as state/actions.ts, life.ts and noteTypes.ts do).
    let split = W.defaultWorkspace();
    W.showTabs(true);
    split = W.open(split, { type: 'note', path: 'A.md' });
    split = W.open(split, { type: 'projects' }, 'right');
    const projectsGroup = W.groups(split.root).find((g) => g.tabs.some((t) => t.type === 'projects'));
    const projectsTab = projectsGroup.tabs.find((t) => t.type === 'projects');
    W.showTabs(false);
    const forward = W.activate(split, projectsGroup.id, projectsTab.id);
    assert.equal(W.groups(forward.root).length, 1, 'bringing a page forward leaves one pane');
    assert.equal(W.activeTab(forward).type, 'projects', 'the page asked for is the page on show');
    assert.ok(W.groups(forward.root)[0].tabs.some((t) => t.path === 'A.md'), 'the other page is kept behind it');
    // Opening anything still makes no split by itself.
    const opened = W.open(split, { type: 'note', path: 'C.md' }, 'tab');
    assert.equal(W.groups(opened.root).length, 1);
    assert.equal(W.activeTab(opened).path, 'C.md');
  } finally {
    W.showTabs(true);
  }
});

test('item 5: the Projects filter tabs scroll sideways instead of wrapping', () => {
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.match(home, /pj-filter-tabs/, 'the filter tabs have their own strip');
  const css = read('src/renderer/src/styles/polish-round3.css');
  assert.match(css, /\.pj-filter-tabs\s*\{[^}]*overflow-x:\s*auto/, 'the strip scrolls sideways');
  assert.match(css, /\.pj-filter-tabs\s*\{[^}]*flex-wrap:\s*nowrap/, 'its tabs never wrap to a second line');
  assert.match(css, /\.pj-filter-tabs \.pj-filter\s*\{[^}]*flex:\s*none/, 'each tab keeps its width while scrolling');
  assert.match(read('src/renderer/src/main.tsx'), /styles\/polish-round3\.css/, 'the round 3 styles are loaded');
});
