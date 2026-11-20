// node --test tests/uplift-round2c-screens.test.mjs — 9.2 fresh-eyes second pass on the screens
// (the findings W5-1 to W5-35): each check fails without its fix. Pure logic is bundled and
// run; the screens are guarded by the mechanism they call, as the earlier uplift tests do.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-w5-'));
let FZ, SS;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as FZ from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/fuzzy.ts'))};\nexport * as SS from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ FZ, SS } = await import(pathToFileURL(path.join(work, 'r.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('word-wise matching finds names out of order (W5-13)', () => {
  assert.equal(FZ.wordsMatch('upgrade studio', 'Studio Upgrade'), true);
  assert.equal(FZ.wordsMatch('tick box', 'Tick-box task'), true);
  assert.equal(FZ.wordsMatch('studio', 'Studio Upgrade'), true);
  assert.equal(FZ.wordsMatch('upgrade zebra', 'Studio Upgrade'), false);
  assert.deepEqual(FZ.wordFilter([{ n: 'Studio Upgrade' }, { n: 'Shop' }], 'upgrade studio', (x) => x.n).map((x) => x.n), ['Studio Upgrade']);
  const capture = read('src/renderer/src/capture/CaptureBox.tsx');
  assert.ok(capture.includes('wordsMatch(q, p.name)'), 'capture picker uses the shared word matcher');
  assert.doesNotMatch(capture, /p\.name\.toLowerCase\(\)\.includes\(q\)/, 'no whole-phrase substring');
  const slash = read('src/renderer/src/editor/slash.ts');
  assert.ok(slash.includes('wordsMatch(query,'), 'slash menu uses the shared word matcher');
  assert.doesNotMatch(slash, /query\.includes\(' '\)/, 'a space never closes the slash menu');
});

test('settings search finds word forms, ranked below exact words (W5-15)', () => {
  const labels = { general: 'General' };
  const entries = [
    { section: 'general', title: 'Note types', hint: 'What a note can be.', words: 'note kinds' },
    { section: 'general', title: 'Delete', hint: 'Remove things.', words: 'delete remove bin' },
  ];
  const titles = (q) => SS.searchSettings(q, entries, labels, 5).map((h) => h.entry.title);
  assert.ok(titles('notes').includes('Note types'), 'plural finds singular');
  assert.ok(titles('deleting').includes('Delete'), 'ing form finds the row');
  assert.deepEqual(titles('zebra'), [], 'unrelated still finds nothing');
});

test('@-mentions have no word-count gate (W5-14)', () => {
  const src = read('src/renderer/src/editor/typeLinks.ts');
  assert.doesNotMatch(src, /split\(\/\\s\+\/\)\.length > 3/, 'no three-word cap');
});

test('a failed read never becomes an empty document or empty day (W5-1, W5-2, W5-5, W5-6)', () => {
  // t249's one view removed the board's scoped day-note add with the board (REPORT-t249 item 3: scoped adds
  // are gone from Tasks), so no day-note write is left to pin here; the rule stands on the six doors below.
  const ws = read('src/renderer/src/state/projectWorkspace.ts');
  assert.doesNotMatch(ws, /readWorkspace\('', project\)\)/, 'workspace failure is not an empty workspace');
  assert.ok(ws.includes('setFile(null)'), 'workspace failure stays unloaded');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('setHubFailed(true)'), 'hub failure is a state');
  assert.ok(today.includes('Parts of today could not be read'), 'hub failure is said on Today');
  const person = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(person.includes("title=\"Couldn't check\""), 'a person read failure is not "gone"');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes("title=\"Couldn't check the inbox\""), 'inbox failure is not Inbox zero');
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('failed, retry'), 'people failure travels with a retry');
  // t22-note-once, 8 Nov 2026: the backlinks list (and its failed check) moved from the rail to the foot.
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('failed') && foot.includes('Try again'), 'backlinks failure is not "nothing links here"');
});

test('unreadable areas and types block writes instead of resetting (W5-3)', () => {
  const areas = read('src/renderer/src/state/areas.ts');
  assert.ok(areas.includes('unreadable = true'), 'areas load failure recorded');
  assert.ok(areas.includes("if (unreadable) throw new Error"), 'areas writes blocked while unread');
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('unreadable = true'), 'types load failure recorded');
  assert.ok(types.includes("if (unreadable) throw new Error"), 'types writes blocked while unread');
});

test('delete keeps what the person sees, in both delete paths (W5-4)', () => {
  const actions = read('src/renderer/src/state/actions.ts');
  assert.equal((actions.match(/docs\.text\(p\)/g) ?? []).length >= 1, true);
  assert.ok(actions.includes('docs.text(path) ??'), 'single delete keeps open words');
  assert.ok(actions.includes('docs.text(p) ??'), 'bulk delete keeps open words');
  assert.ok(actions.includes("formatDate('YYYYMMDDHHmmss')"), 'timed note names have seconds (W5-23)');
});

test('find before create: close-out, kept answers, imports, bookmarks (W5-7, W5-9, W5-10, W5-21)', () => {
  const life = read('src/renderer/src/views/project/Lifecycle.tsx');
  assert.ok(life.includes('window.nv.notes.write(report.path, text)'), 'close-out rewritten in place');
  const chat = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(chat.includes('kept.trimStart().startsWith(answer.trim())'), 'kept answer found on disk after restart');
  const md = read('src/renderer/src/state/imports.ts');
  assert.ok(md.includes("id: 'update'"), 'markdown import asks update or keep both');
  assert.ok(md.includes('if (made.length) onDone?.(made, where, source);'), 'part-done markdown import recorded');
  const csv = read('src/renderer/src/state/importCsv.ts');
  assert.ok(csv.includes('freshMade.filter'), 'renamed counted against fresh rows (W5-20)');
  assert.ok(csv.includes('madeSoFar'), 'part-done CSV import recorded (W5-20)');
  const bm = read('src/renderer/src/state/bookmarks.ts');
  assert.ok(bm.includes("b.type !== 'group' && flat(items).some(same)"), 'bookmarks never stack');
  assert.ok(bm.includes('Bookmarks could not be saved'), 'bookmark save failure said');
});

test('fields: dates clear, renames clash out loud (W5-11, W5-16)', () => {
  for (const f of ['src/renderer/src/components/Properties.tsx', 'src/renderer/src/components/NoteFields.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /e\.target\.value && apply/, `${f}: empty date applies`);
    assert.ok(src.includes('There is already a field called'), `${f}: rename clash said`);
  }
});

test('search failure is the real reason in plain words (W5-12)', () => {
  const src = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(src.includes('setFailed(errorMessage(e))'), 'the real error is kept');
  assert.doesNotMatch(src, /rebuilding after the last import/, 'no stock rebuilding story');
});

test('follow-on writes are never swallowed (W5-17, W5-18, W5-19, W5-23)', () => {
  const np = read('src/renderer/src/components/NewProjectDialog.tsx');
  assert.doesNotMatch(np, /workspace\.save\(file.*catch\(\(\) => undefined\)/, 'project sections failure said');
  const rec = read('src/renderer/src/state/recorder.ts');
  assert.ok(rec.includes("loaded = '';"), 'failed jobs read is retried');
  const vf = read('src/renderer/src/state/vaultFiles.ts');
  assert.doesNotMatch(vf, /vfiles\.taken\(record, names\)\.catch/, 'failed name check stops the add');
  assert.ok(vf.includes('Sending '), 'big files are sending, not added');
  const tf = read('src/renderer/src/state/templateFields.ts');
  assert.doesNotMatch(tf, /err instanceof Error \? err\.message/, 'no raw failure text in the toast');
  const attach = read('src/renderer/src/lib/attach.ts');
  assert.ok(attach.includes('size: blob.size'), 're-encoded picture reports its real size');
  assert.ok(attach.includes("second: '2-digit'"), 'pasted pictures named to the second');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('.catch(showError);\n    take();'), 'outside items failure said');
  assert.ok(app.includes('frontMatterRange(text)'), 'word count uses the shared frontmatter reading');
});

test('screens read status exactly and label honestly (W5-24 to W5-35)', () => {
  const fam = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  assert.ok(fam.includes('const bday = nextBirthday(m.born, today);'), 'family birthday worked out first');
  assert.doesNotMatch(fam, /nextBirthday\(m\.born, today\)!\.day/, 'no forced birthday');
  const goals = read('src/renderer/src/views/modules/life/GoalsPage.tsx');
  assert.ok(goals.includes("g.status === 'On track'"), 'goals count exact status');
  assert.doesNotMatch(goals, /\/on track\|achieved\/i/, 'no substring status');
  const g87 = read('src/renderer/src/views/modules/w3b/Goals87.tsx');
  assert.ok(g87.includes("g.status === 'At risk'"), 'slipped is the exact status');
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('b.in >= 0 && b.in <= 7'), 'birthday today counts');
  assert.ok(read('src/renderer/src/views/TodayView.tsx').includes('reload={reloadBrief}'), 'brief snooze reloads the one page (10.0)');
  assert.doesNotMatch(home, /reload: \(\) => undefined/, 'no stub reload');
  const veh = read('src/renderer/src/views/modules/w3b/Vehicles87.tsx');
  assert.ok(veh.includes("prop('fuel_type')"), 'fuel saved under its real field');
  const cal = read('src/renderer/src/views/meetings/WeekCalendar.tsx');
  assert.ok(cal.includes('Math.min(ms.length, 3)'), 'more counts what was not rendered');
  const wk = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(wk.includes('done: ${doneFirst}'), 'done work labelled done');
  const canvas = read('src/renderer/src/views/CanvasView.tsx');
  assert.ok(canvas.includes('await Promise.all(pending)'), 'board waits for project writes');
  assert.ok(canvas.includes('commit(base, false)'), 'failed board write puts cards back');
  // t249's one view removed the board drops with the board (REPORT-t249 item 3): leaving Waiting is the
  // row's who taken off, through the shared writer.
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('const saveWho = async (t: VaultTask, who: string)'), 'the row owns the who write (W5-31)');
  assert.ok(tasks.includes('setTaskWho(`- [ ] ${t.text}`, name)'), 'it writes through the shared function (W5-31)');
  assert.ok(tasks.includes("'Took the owner off.'"), 'empty takes it off (W5-31)');
  const career = read('src/renderer/src/views/modules/personal/CareerPage.tsx');
  assert.ok(career.includes('x.trim().toLowerCase() === name.trim().toLowerCase()'), 'career finds the person any case');
  const health = read('src/renderer/src/views/modules/health/HealthTrack.tsx');
  assert.ok(health.includes('Brought back the habit'), 'existing habit brought back, not duplicated');
  const boards = read('src/renderer/src/views/canvas/projectBoards.ts');
  assert.ok(boards.includes('making.get(target)'), 'one board make in flight');
  const health87 = read('src/renderer/src/views/modules/w3b/Health87.tsx');
  assert.doesNotMatch(health87, /tint="red"/, 'health identity is not the warning colour');
  const house87 = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.doesNotMatch(house87, /tint="amber"/, 'house identity is not the warning colour');
  const ws = read('src/renderer/src/state/projectWorkspace.ts');
  assert.ok(ws.includes('More than one note is called'), 'ambiguous record names never guess');
});
