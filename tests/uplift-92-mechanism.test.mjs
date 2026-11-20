// node --test tests/uplift-92-mechanism.test.mjs — the 9.2 uplift's mechanism batch (F75, F81, F83,
// F85, F105, F111, F114, F115, F116, F117, F121, F124, F130, F133, F143, F145, F146, F147, F151, F154):
// one honest mechanism per fix. Half-added meetings join their event instead of doubling it; search marks
// come from the same parse the search runs; the capture box closes only when idle; charts fall back to a
// real shared property or say so; the orphan bookmarks panel is gone; audit rows open by resolved path;
// quote extends land together; clipboard and import-undo claims hold; gathers run once per week with read
// failures heard; meetings open once per click; every unfinished meeting keeps its pill; replaced files draw
// fresh thumbnails; flow projects, reloaded versions, settled suggestions, undone imports, private areas and
// step-up refusals each go through one mechanism; column cursors land inside the block; made links keep the
// made name. Each check fails without its fix.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-mech-'));
let FS;
let COL;
let CM;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  // t239 wires file hits through actions (A.openFolderFile, pinned by t239-click-opens), whose graph the
  // bundler cannot load (asset URLs, stylesheets, lazy chunks): stand it in, as a12/editor-markdown stub what
  // the units never touch (F81 calls only the pure searchWords, never showFileHit).
  const actionsStub = path.join(work, 'actions-stub.ts');
  writeFileSync(actionsStub, 'export const openFolderFile = (..._a: unknown[]): void => undefined;\n');
  const stubActions = { name: 'stub-actions', resolveId: (id, importer) => (id === './actions' && importer?.endsWith('fileSearch.ts') ? actionsStub : null) };
  writeFileSync(path.join(work, 'fs.ts'), `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/fileSearch.ts'))};\n`);
  await build({ input: path.join(work, 'fs.ts'), platform: 'node', plugins: [stubActions], output: { file: path.join(work, 'fs.mjs'), format: 'esm' }, logLevel: 'silent' });
  FS = await import(pathToFileURL(path.join(work, 'fs.mjs')).href);
  writeFileSync(
    path.join(work, 'cols.ts'),
    `export * as COL from ${JSON.stringify(path.join(root, 'src/renderer/src/editor/columns.ts'))};\nexport * as CM from ${JSON.stringify(path.join(root, 'node_modules/@codemirror/state/dist/index.js'))};\n`,
  );
  await build({ input: path.join(work, 'cols.ts'), platform: 'node', output: { file: path.join(work, 'cols.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ COL, CM } = await import(pathToFileURL(path.join(work, 'cols.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('search marks come from the same parse the search runs (F81)', () => {
  assert.deepEqual(FS.searchWords('from:x'), ['from:x'], 'read as words, marked as words');
  assert.deepEqual(FS.searchWords('-draft'), [], 'excluded words mark nothing');
  assert.deepEqual(FS.searchWords('alpha OR beta'), ['alpha', 'beta'], 'both sides marked');
  assert.deepEqual(FS.searchWords('"exact phrase"'), ['exact phrase'], 'phrases kept whole');
  assert.deepEqual(FS.searchWords('file:x'), [], 'filename scopes mark nothing');
  assert.deepEqual(FS.searchWords('content:deep'), ['deep'], 'content scopes mark');
  assert.deepEqual(FS.searchWords(''), [], 'nothing typed, nothing marked');
  const src = read('src/renderer/src/state/fileSearch.ts');
  assert.doesNotMatch(src, /w\.startsWith\('-'\)/, 'no renderer-side term gates');
});

test('the capture box closes only when idle (F83)', () => {
  const box = read('src/renderer/src/capture/CaptureBox.tsx');
  assert.ok(box.includes('closeWhenIdle'), 'one idle closer');
  assert.ok(box.includes("matches(':hover, :focus-within')"), 'hover and focus hold it open');
  assert.ok(box.includes('if (shell.current?.matches'), 're-checked while engaged');
  assert.doesNotMatch(box, /setTimeout\(\(\) => close\(\), TOAST_MS\)/, 'no fixed mid-read close');
});

test('charts fall back to a real property or say so (F85)', () => {
  const chart = read('src/renderer/src/editor/insertChart.ts');
  assert.ok(chart.includes('fallbackChart(read, folder)'), 'a real fallback');
  assert.ok(chart.includes('count > 1'), 'shared across notes');
  assert.ok(chart.includes('No countable property in'), 'said when none');
  assert.doesNotMatch(chart, /by: 'status'/, 'no invented status');
});

test('bookmarks are a page, never a panel (F105)', () => {
  assert.equal(existsSync(path.join(root, 'src/renderer/src/panels/BookmarksPanel.tsx')), false, 'the orphan file gone');
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  assert.doesNotMatch(side, /id: 'bookmarks'/, 'no dead entry');
  assert.doesNotMatch(side, /panel === 'bookmarks'/, 'no forced home');
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("export type LeftPanel = 'home' | 'files' | 'search';"), 'no dead panel id');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'bookmarks'"), 'the page still opens');
});

test('audit rows open by resolved path (F111)', () => {
  const secrets = read('src/renderer/src/views/SecretsView.tsx');
  assert.ok(secrets.includes('function auditTarget(item: string)'), 'one resolution');
  assert.ok(secrets.includes('return resolveAny(item);'), 'by the vault, not the words');
  assert.ok(secrets.includes('disabled={!auditTarget(e.item)}'), 'openable exactly when resolved');
  assert.doesNotMatch(secrets, /a-z0-9\]\{1,6\}\$/, 'no extension guess');
});

test('quote extends land together or not at all (F114)', () => {
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.ok(vendors.includes('await call(\'set-field\', { kind: \'quote\', path: q.path, field: \'valid_until\', value: day });'), 'the new day first');
  assert.ok(vendors.includes('revived = true'), 'revival tracked');
  assert.ok(vendors.includes('value: q.validUntil ??'), 'backed out on failure');
  assert.ok(vendors.includes('The new day wouldn’t save. Nothing was changed.'), 'failure said, success never toasted');
  assert.doesNotMatch(vendors, /value: 'Received' \}\)\.catch\(\(\) => null\)/, 'no swallowed half-write');
});

test('copied said only when it copied (F115)', () => {
  const meetings = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meetings.includes('const copied = (await navigator.clipboard?.writeText'), 'the write watched');
  assert.ok(meetings.includes('The draft wouldn’t copy. Try again.'), 'failure said');
  assert.doesNotMatch(meetings, /writeText\(`Subject: \$\{draft\.subject\}\\n\\n\$\{draft\.text\}\)\.catch\(\(\) => undefined\)/, 'no blind success');
});

test('weeks gather once, read failures heard (F116)', () => {
  const weekly = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  assert.ok(weekly.includes('export async function gatherWeek'), 'one shared gather');
  assert.ok(weekly.includes('gathering.has(u.path)'), 'in-flight weeks guarded');
  assert.ok(weekly.includes('This week’s note couldn’t be read just now. Try gathering again.'), 'read failures speak');
  assert.ok(weekly.includes('void gatherWeek(view.current)'), 'the classic page shares it');
  const w87 = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(w87.includes('void gatherWeek(u, setUndoText)'), 'the pack draft shares it');
  assert.ok(w87.includes('void gatherWeek(u).then(() => openModule(MOD, \'draft\'))'), 'the pack overview shares it');
  assert.doesNotMatch(w87, /catch \{\s*\/\* the gather says its own words \*\/\s*\}/, 'no silent swallows');
});

test('a meeting row opens once (F117)', () => {
  const meetings = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meetings.includes("onClick={(e) => openMeeting(m.path, e.ctrlKey || e.metaKey ? 'tab' : 'current')}"), 'one opener');
  assert.doesNotMatch(meetings, /onDoubleClick=\{\(\) => openMeeting\(m\.path, 'tab'\)\}/, 'no second opener');
});

test('every unfinished meeting keeps its pill (F121)', () => {
  const pill = read('src/renderer/src/components/RecordingPill.tsx');
  assert.ok(pill.includes('const pending = v.jobs.filter((j) => (j.working || j.interrupted) && !hasPanel(j.note));'), 'all of them');
  assert.ok(pill.includes('{pending.map((job) => {'), 'each rendered');
  assert.doesNotMatch(pill, /const job = writing \?\? stopped/, 'never only the first');
  assert.ok(read('src/renderer/src/styles/recorder.css').includes('.mr-pills'), 'stacked at the foot');
});

test('replaced files draw fresh thumbnails (F124)', () => {
  const delivered = read('src/renderer/src/components/DeliveredFile.tsx');
  assert.ok(delivered.includes('}, [f.id, f.at, f.size]);'), 'the version stamp watched');
  assert.doesNotMatch(delivered, /window\.nv\.projects\.thumb[\s\S]{0,200}\}, \[f\.id\]\);/, 'never the id alone');
});

test('flow projects count however typed (F130)', () => {
  const flows = read('src/renderer/src/components/CaptureFlowsSettings.tsx');
  assert.ok(flows.includes("typeOfPath(n.path)?.id === 'project'"), 'the shared reading');
  assert.doesNotMatch(flows, /n\.props\?\.type === 'project'/, 'no raw type-prop gate');
});

test('restored versions read fresh (F133)', () => {
  const extras = read('src/renderer/src/components/Extras.tsx');
  assert.ok(extras.includes('window.nv.recovery.versions(chosen)'), 'the list read again');
  assert.ok(extras.includes('setVersion(fresh[0]?.id ?? null);'), 'the new current selected');
  assert.ok(extras.includes('setTexts({});'), 'stale readings dropped');
});

test('failed suggestion tells retry, speak and mark (F143)', () => {
  const sug = read('src/renderer/src/state/suggestions.ts');
  assert.ok(sug.includes('settle(path, true)'), 'settles retry once');
  assert.ok(sug.includes('readList(true)'), 'the first read retries once');
  assert.ok(sug.includes('The assistant couldn’t be told what still waits in this note.'), 'settle failures speak');
  assert.ok(sug.includes('The assistant’s waiting changes couldn’t be read just now.'), 'read failures speak');
  assert.ok(sug.includes('export function useSuggestionsUnknown'), 'unknown-state marked');
  assert.ok(read('src/renderer/src/views/SuggestionBar.tsx').includes('couldn’t tell the assistant what still waits'), 'marked where read');
  assert.doesNotMatch(sug, /\.catch\(\(\) => \{\}\)/, 'nothing swallowed');
});

test('undone said only when something moved (F145)', () => {
  const imports = read('src/renderer/src/state/imports.ts');
  assert.ok(imports.includes('Those notes are already gone, so nothing was undone. The import stays on record.'), 'said with the record kept');
  assert.ok(imports.includes('if (!n) {'), 'nothing moved, nothing marked');
});

test('private areas stay out by mechanism (F146)', () => {
  const areas = read('src/renderer/src/state/areas.ts');
  assert.equal((areas.match(/isPrivatePath\(/g) ?? []).length, 2, 'both loops share it');
  assert.doesNotMatch(areas, /private notes\\\/\//i, 'no name regex');
});

test('step-up refusals ride a machine flag (F147)', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('.needStepUp = true'), 'the bridge flags it');
  assert.ok(preload.includes("e.message === STEP_UP_MESSAGE"), 'exactly, never a substring');
  assert.ok(read('src/renderer/src/lib/step-up.ts').includes('.needStepUp === true'), 'the window reads the flag');
  assert.doesNotMatch(read('src/renderer/src/lib/step-up.ts'), /includes\('Step-up needed'\)/, 'no prose gate');
  const main = read('src/main/private-notes.ts');
  assert.ok(main.includes("STEP_UP_NEEDED = 'Step-up needed'"), 'the main constant pinned');
  assert.ok(main.includes('`${STEP_UP_NEEDED}: confirm it is you to do that.`'), 'the main sentence pinned');
});

test('column cursors land inside the block (F151)', () => {
  const real = (doc, from, to) => {
    const state = CM.EditorState.create({ doc, selection: { anchor: from, head: to } });
    let next = state;
    COL.layOutInColumns({ state, dispatch: (spec) => (next = next.update(spec).state), focus: () => undefined }, 2);
    return { text: next.doc.toString(), at: next.selection.main.head };
  };
  const two = real('para1\n\npara2', 0, 12);
  assert.equal(two.text.slice(0, two.at).endsWith('para2'), true, 'at the end of the last column’s words');
  assert.ok(two.text.slice(two.at).startsWith('\n<!-- end columns -->'), 'inside the block, never past the marker');
  const typed = `${two.text.slice(0, two.at)}more${two.text.slice(two.at)}`;
  assert.ok(typed.includes('para2more\n<!-- end columns -->'), 'the next keystroke stays in the column');
  const cols = read('src/renderer/src/editor/columns.ts');
  assert.ok(cols.includes('columnSeparators(lines, block)'), 'from the shared block offsets');
  assert.ok(cols.includes("close.from + '\\n<!-- column -->\\n'.length"), 'added columns land on the empty line');
});

test('made links keep the made name (F154)', () => {
  const setup = read('src/renderer/src/editor/setup.ts');
  assert.ok(setup.includes('`${insert}|${name}`'), 'the [[ path aliases the name');
  assert.ok(read('src/renderer/src/editor/typeLinks.ts').includes('{ alias: name }'), 'the @ path aliases the name');
  assert.doesNotMatch(setup, /made\) => finish\(linkTarget\(made, host\.path\)\)/, 'never path-only');
});
