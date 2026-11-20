// node --test tests/w2a-projects.test.mjs — the Vault redesign's projects (8.7 wave 2a): one view switch over the
// same projects (rows, cards, a board grouped by health or status, every project's dates on one gantt with the
// Timeline's own clash reading), and one project page with seven tabs (Overview, Tasks, Notes, Files, People,
// Decisions, Timeline) and facts that edit in place. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-w2a-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/projects-87.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w2a.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'w2a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the one Status reads finished first, else the health', () => {
  assert.equal(P.propStatus({ status: 'done', health: 'on track' }), 'finished');
  assert.equal(P.propStatus({ status: 'Archived', health: 'at risk' }), 'finished');
  assert.equal(P.propStatus({ status: 'active', health: 'at risk' }), 'at-risk');
  assert.equal(P.propStatus({ status: 'active', health: 'Off track' }), 'off-track');
  assert.equal(P.propStatus({ status: 'active', health: 'On track' }), 'on-track');
  assert.equal(P.propStatus({ status: 'active' }), 'active');
  assert.equal(P.propStatus({ status: 'active', health: 'Overdue' }), 'off-track');
  assert.equal(P.propStatus({ status: 'active', health: 'Offer extended' }), 'active', '"offer" is not "off track"');
  assert.equal(P.propStatus({ status: 'active', health: 'Delivered' }), 'active', '"delivered" is not "red"');
  assert.equal(P.PROP_STATUS_WORDS['at-risk'], 'At risk');
  assert.equal(P.PROP_STATUS_TINT['off-track'], 'red');
  // Shelved reads as shelved (b6 break job: on hold read as Active while its tasks counted nowhere).
  assert.equal(P.propStatus({ status: 'on hold' }), 'on-hold');
  assert.equal(P.propStatus({ status: 'idea' }), 'idea');
  assert.equal(P.propStatus({ status: 'on hold', health: 'at risk' }), 'on-hold', 'a paused health is history, like a finished one (one standing, 8 Nov 2026)');
  assert.equal(P.PROP_STATUS_WORDS['on-hold'], 'On hold');
  assert.equal(P.PROP_STATUS_WORDS['idea'], 'Idea');
  assert.equal(P.PROP_STATUS_TINT['on-hold'], 'slate');
});

test('choosing a Status writes the status or the health, never both wrong', () => {
  assert.deepEqual(P.propStatusEdits('finished', { status: 'active', health: 'on track' }), [{ field: 'status', value: 'done' }]);
  assert.deepEqual(P.propStatusEdits('at-risk', { status: 'done', health: 'on track' }), [
    { field: 'status', value: 'active' },
    { field: 'health', value: 'at risk' },
  ]);
  assert.deepEqual(P.propStatusEdits('active', { status: 'active', health: 'at risk' }), [{ field: 'health', value: null }]);
  assert.deepEqual(P.propStatusEdits('on-track', { status: 'active' }), [{ field: 'health', value: 'on track' }]);
  assert.deepEqual(P.propStatusEdits('on-hold', { status: 'active', health: 'on track' }), [{ field: 'status', value: 'on hold' }], 'pausing moves the status, the health stays as history');
  assert.deepEqual(P.propStatusEdits('idea', { status: 'active' }), [{ field: 'status', value: 'idea' }]);
  assert.deepEqual(P.propStatusEdits('active', { status: 'on hold', health: 'at risk' }), [
    { field: 'status', value: 'active' },
    { field: 'health', value: null },
  ], 'resuming clears the shelf and the health');
  assert.deepEqual(P.propStatusEdits('at-risk', { status: 'on hold' }), [
    { field: 'status', value: 'active' },
    { field: 'health', value: 'at risk' },
  ], 'a track word from the shelf resumes with that health');
});

test('gantt bars sit inside 0–100 and dateless projects still show', () => {
  assert.deepEqual(P.barPct(10, 20, 0, 100), { left: (10 / 101) * 100, width: ((21 - 10) / 101) * 100 });
  const clip = P.barPct(-50, 500, 0, 100);
  assert.ok(clip.left >= 0 && clip.left + clip.width <= 100.5);
  assert.deepEqual(P.barPct(null, null, 0, 100), { left: 50, width: 2 });
  assert.deepEqual(P.barPct(50, null, 0, 100), P.barPct(50, 50, 0, 100));
});

test('the gantt head names the months its span crosses', () => {
  const day = (y, m, d) => Math.round(Date.UTC(y, m, d) / 86400000);
  assert.deepEqual(P.ganttMonths(day(2026, 8, 1), day(2026, 11, 15)), ['Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual(P.ganttMonths(day(2026, 9, 5), day(2026, 9, 28)), ['Oct']);
});

test('the projects board groups by health with Done for the finished', () => {
  assert.equal(P.projectBoardColumn({ status: 'done', health: 'off track' }), 'done');
  assert.equal(P.projectBoardColumn({ status: 'archived' }), 'done');
  assert.equal(P.projectBoardColumn({ status: 'active', health: 'off track' }), 'off-track');
  assert.equal(P.projectBoardColumn({ status: 'active', health: 'at risk' }), 'at-risk');
  assert.equal(P.projectBoardColumn({ status: 'active', health: 'on track' }), 'on-track');
  assert.equal(P.projectBoardColumn({ status: 'active' }), 'on-track');
  assert.deepEqual(P.projectBoardDrop('done', { status: 'active' }), [{ field: 'status', value: 'done' }]);
  assert.deepEqual(P.projectBoardDrop('at-risk', { status: 'done' }), [
    { field: 'status', value: 'active' },
    { field: 'health', value: 'at risk' },
  ]);
});

test('each project view is one switch over the same projects, kept on this PC', () => {
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  for (const v of ['list', 'gallery', 'board', 'timeline']) assert.ok(home.includes(`'${v}'`), `the ${v} view`);
  assert.ok(home.includes('readProjectsView') && home.includes('writeProjectsView'), 'the choice sticks on this PC');
  assert.ok(home.includes('findProblems'), 'the timeline reuses the Timeline’s own clash reading');
  assert.ok(home.includes('By health') && home.includes('By status'), 'the board groups by health or status');
  assert.ok(home.includes('projectBoardDrop') || home.includes('moveProject'), 'a dropped card moves the project');
  assert.ok(home.includes('openWeeklyReview'), 'the weekly review stays');
  assert.ok(home.includes('new-project'), 'a new project stays');
  assert.ok(home.includes('portfolio'), 'the update across every project stays');
  assert.ok(home.includes('openPortfolioBoard') || home.includes('portfolio board'), 'the portfolio board canvas keeps a home');
  assert.ok(home.includes('Catch up all projects'), 'catching them all up stays');
  assert.ok(home.includes('Set up more from a folder'), 'setting more up from a folder stays');
  assert.ok(home.includes('Delete the project'), 'delete to the Bin stays');
});

test('the project page has ten folio sections with facts that edit in place', () => {
  // 5 Nov 2026, the vault folio: the eight tabs became one scrolling page (the tab ids now live only in memory.ts
  // as old links). t239, 12 Nov 2026 (their decision 4, brief-directed): notes, documents and files are one list,
  // so the Files split is gone and ten sections show. The facts, work, report, workspace, tidy and send-to-agent
  // doors below are unchanged.
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  for (const s of ['WhatsNextSection', 'WaitingSection', 'KeyDatesSection', 'PeopleSection', 'DecisionsSection', 'NotesSection', 'RisksSection', 'UpdatesSection', 'MoneySection', 'ActivitySection']) assert.ok(page.includes(s), `the ${s} section`);
  assert.ok(!page.includes('FilesSection'), 'no separate Files split (t239: one list)');
  assert.ok(page.includes('PageProps'), 'the facts block');
  assert.ok(page.includes('propStatusEdits'), 'the one Status writes the file');
  assert.ok(page.includes("'on-hold', 'idea'") || page.includes("'on-hold','idea'"), 'the Status menu offers pausing and ideas too (b6 break job)');
  assert.ok(page.includes("kind: 'prop'"), 'a fact of the person’s own is set');
  assert.ok(page.includes('Fields'), 'the Fields button');
  assert.ok(page.includes('Workspace'), 'the workspace stays');
  assert.ok(page.includes('Tidy this project'), 'tidy stays');
  assert.ok(page.includes('Send to an agent'), 'send to an agent stays');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tabs.includes('readProjectTasksView') && !tabs.includes('writeProjectTasksView'), 'no Rows/Board/Calendar/Timeline switch on the tasks (one view, plan decision 2)');
  assert.ok(tabs.includes('addFiles'), 'attaching copies files into the folder');
  assert.ok(tabs.includes('openFolderFile'), 'files open in the full viewer as a tab (t239, brief-directed: no preview overlay)');
  assert.ok(tabs.includes('kind: \'pin\''), 'pinning stays');
  assert.ok(read('src/renderer/src/views/workspace/ProjectWorkspace.tsx').includes('PlanTimeline'), 'the plan bars stay, in the workspace view');
  assert.ok(tabs.includes('projectMilestones'), 'milestones from the file’s own dates');
  // t255 (13 Nov): deliveries read as compact rows in the Updates tab, never tall cards (t255 pins every fact stays).
  assert.ok(tabs.includes('DeliveredRow'), 'agent deliveries stay');
});

test('the project page sits in the Projects column (p11-vault-care, was full width), with hero, lead and pill', () => {
  // 5 Nov 2026, the vault folio: the hero (its tile, pill and tab-gated summary) became the title block, always
  // shown; the 980 column moved from an inline style to the folio class so it can widen past 2400px. v9, 6 Nov
  // 2026: the hero is back (tile, pill, lead with Read more); the status line is gone.
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(!page.includes('pj-page pj-head'), 'the old flex header class no longer squeezes the page into a column');
  // t255 (13 Nov): the folio reads through real tabs, the same class with its tabs marker.
  assert.ok(page.includes('className="vpage wide pj-folio is-tabs"'), 'the folio class carries the reading width');
  assert.ok(page.includes('nv-hero') && page.includes('{standing.words}') && page.includes('chooseStatus'), 'the hero pill reads the one standing and opens the status menu (one fact, one value, 8 Nov 2026)');
  assert.ok(!page.includes('<StatusLine'), 'no status line repeating the band');
  assert.ok(!page.includes("tab === 'overview'"), 'no tab-gated summary line left');
  const css = read('src/renderer/src/styles/w2a.css');
  assert.ok(css.includes('.vpage.wide.pj-folio { max-width: 980px'), 'a reading width at every window size');
});

test('round 2: the project draws its own top bar (people, Share, Publish; primaries in the section heads)', () => {
  // 5 Nov 2026, the vault folio: with no tabs the top bar cannot carry six primaries; each section head carries
  // its own (the same prompts, where the rows are). Share, Publish, the facts door and the back door stay.
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes('<ViewHeader tab={wtab}'), 'the page draws the top bar itself');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('Add task') && tabs.includes('Add note') && tabs.includes('> Attach<'), 'each section’s primary action in its head');
  assert.ok(tabs.includes('Add person') && tabs.includes('Log decision') && tabs.includes('> Milestone<'), 'every section’s primary action in its head');
  assert.ok(page.includes('Share') && page.includes('shareMenu'), 'Share in the bar');
  assert.ok(page.includes('Facts…') && page.includes('w2a-addfact'), 'the facts panel opens from ⋯');
  assert.ok(page.includes('Back to the project'), 'the facts panel goes back');
  assert.ok(page.includes('Edit as a note'), 'editing as a note stays');
  assert.ok(!page.includes('pj-actions'), 'no floating row above the title');
  const note = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(note.includes('<ProjectPage path={path} tab={tab} />'), 'the note hosts the page with its tab');
});

test('round 2: the board card is a title, small tags and the owner’s avatar', () => {
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes('miniava'), 'the owner’s avatar on the card');
  assert.ok(!home.includes('{c.progress}%'), 'no percentage tag');
  assert.ok(!home.includes('Next: '), 'no next-step line on the list row');
  assert.ok(home.includes('<ViewHeader tab={tab}'), 'the home draws the top bar itself');
});

test('round 3: finished projects carry no health pill or counts and ask for nothing', () => {
  // The sweep-3 shape restored in the w2a rows and cards (sweep 3, 012: Done cards still read AT RISK).
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes('finished ? null : healthPill'), 'rows and cards draw no pill for a finished project');
  // Edit-in-place (t75) made the row pill a button when editable; it still draws only while health is live.
  assert.ok(/\{health &&[\s\S]{0,500}pill is-plain/.test(home), 'the row pill shows only while live');
  assert.ok(home.includes('{health && ('), 'the gallery tags show only while live');
  assert.ok(home.includes('!finished && (due || c.openNext > 0)'), 'the board card shows no tags once finished');
  assert.ok(home.includes('Finished · ${due.words}'), 'a finished row says Finished, never stale health');
  assert.ok(!home.includes("words: 'Finished'"), 'no Finished pill from the health pill');
});

test('round 3: the Projects filters scroll sideways although the kit loads last', () => {
  // The round-3 strip on the kit's chips: the kit wraps and loads last, so w2a.css wins on specificity.
  const css = read('src/renderer/src/styles/w2a.css');
  assert.match(css, /\.chips\.pj-filter-tabs \{[^}]*flex-wrap: nowrap/, 'the strip never wraps to a second line');
  assert.match(css, /\.chips\.pj-filter-tabs \{[^}]*overflow-x: auto/, 'it scrolls sideways instead');
  assert.match(css, /\.pj-filter-tabs \.chip \{[^}]*flex: none/, 'each tab keeps its width while scrolling');
});
