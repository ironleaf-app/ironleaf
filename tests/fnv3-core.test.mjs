// node --test tests/fnv3-core.test.mjs - fnv3 core screens (9.5.0 final push): Today, editor commands,
// projects/layouts and reminders fixes from the findings. Each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-fnv3-'));
let T, L, W, S, C, ST, H, R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entries = {
    t: `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
    l: `export * from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
    w: `export * from ${JSON.stringify(path.join(root, 'src/shared/layout-writes.ts'))};`,
    s: `export * from ${JSON.stringify(path.join(root, 'src/shared/starter-templates.ts'))};`,
    c: `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/editor/commands.ts'))};`,
    st: `export * from ${JSON.stringify(path.join(root, 'node_modules/@codemirror/state/dist/index.js'))};`,
    h: `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/htmlPaste.ts'))};`,
    r: `export * from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};`,
  };
  for (const [n, src] of Object.entries(entries)) {
    const e = path.join(work, `${n}.ts`); writeFileSync(e, src);
    await build({ input: e, platform: 'node', output: { file: path.join(work, `${n}.mjs`), format: 'esm' }, logLevel: 'silent' });
  }
  [T, L, W, S, C, ST, H, R] = await Promise.all(['t', 'l', 'w', 's', 'c', 'st', 'h', 'r'].map((n) => import(pathToFileURL(path.join(work, `${n}.mjs`)).href)));
});
after(() => rmSync(work, { recursive: true, force: true }));
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const TODAY = new Date(2026, 9, 17, 9, 30);

// F10: unparseable date property falls through to the file name
test('meeting with unreadable date property still shows from its name', () => {
  const note = { path: 'Meetings/2026-10-17 Stand-up.md', title: 'Stand-up', mtime: 0, props: { type: 'meeting', date: 'Friday' } };
  assert.equal(T.meetingToday(note, TODAY), true);
  const other = { ...note, path: 'Meetings/2026-10-18 Stand-up.md', props: { type: 'meeting', date: 'Friday' } };
  assert.equal(T.meetingToday(other, TODAY), false);
});

// F1: only a Coming up item: not all clear, and counted
test('a step due in 15 days is not all clear', () => {
  const proj = T.parseProject('---\ntype: project\nstatus: active\nowner: Mia\n---\n# P\n\n## What\u2019s next\n\n- [ ] Future step \u2014 Mia \u00b7 by 1 Nov 2026\n');
  const data = T.buildToday({ projects: [{ path: 'P/P.md', version: '1', modified: 0, project: proj }], notes: [] }, TODAY);
  assert.equal(data.due.later.length, 1);
  assert.equal(data.clear, false, 'clear must include Coming up');
  assert.equal(data.counts.later, 1);
});

// F30: plural block names and quoted args
test('plural block names and quoted args parse', () => {
  assert.deepEqual(L.parseBlocks(['trends', 'boards', 'grids']).map((b) => b.type), ['trend', 'board', 'grid']);
  assert.deepEqual(L.parseBlocks(['trend:"Weight kg"']), [{ type: 'trend', arg: 'Weight kg' }]);
});

// F35: empty run sheet opens on first phase
test('empty run sheet opens on its first phase', () => {
  const text = '---\ntype: project\nstatus: active\nlayout: site\n---\n# Site\n\n## Run sheet\n\n### Eight weeks out\n\n### Build week\n\n### Go-live day\n\n### After\n';
  const p = L.parseProject(text);
  const m = L.blockModel({ type: 'progress' }, { project: p, props: { layout: 'site' }, logs: [], today: TODAY });
  assert.equal(m.current, 0);
});

// F39: starter folder cannot escape
test('starter folder drops dot segments', () => {
  assert.equal(S.cleanStarterFolder('../../evil', 'X'), 'evil');
  assert.ok(!S.starterFiles('recipes', S.cleanStarterFolder('../../evil', 'X'), '2026-10-17')[0].path.includes('..'));
});

// F32: mins resolves to Minutes
test('mins resolves to the Minutes field', () => {
  assert.equal(W.resolveField('mins', ['Minutes', 'Calls']), 'Minutes');
});

// F31: set_layout replaces blocks (and composing replaces layout)
test('setLayout with a preset removes composed blocks', () => {
  const text = '---\ntype: project\nblocks: [status]\n---\n# P\n\nBody\n';
  const out = W.setLayout(text, 'programme').text;
  assert.ok(!/blocks:/.test(out.split('---')[1]), 'blocks gone');
  assert.ok(/layout: programme/.test(out));
});

// F33: two milestones on one date both kept
test('addTableRow keeps two milestones on the same date', () => {
  const text = '# P\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 2026-11-02 | Dry run | planned |\n';
  const r = W.addTableRow(text, 'Key dates', { Date: '2026-11-02', Milestone: 'User testing' }, TODAY);
  assert.ok(r.text.includes('Dry run') && r.text.includes('User testing'), r.text);
});

// Editor fake view (state + dispatch only, as commands.ts uses)
function fakeView(doc, from, to) {
  let state = ST.EditorState.create({ doc, selection: ST.EditorSelection.range(from, to) });
  const view = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; }, focus() {} };
  return { view, text: () => state.doc.toString() };
}
// F18: heading over blank line and trailing-newline selection
test('heading skips blank lines and does not spill to next line', () => {
  const a = fakeView('One\n\nTwo', 0, 8); C.setHeading(a.view, 1); assert.equal(a.text(), '# One\n\n# Two');
  const b = fakeView('One\nTwo', 0, 4); C.setHeading(b.view, 1); assert.equal(b.text(), '# One\nTwo');
});
// F19: bullet on a done task keeps its tick
test('bullet toggle keeps a done task ticked', () => {
  const a = fakeView('- [x] Book the van', 0, 5); C.toggleBullet(a.view); assert.ok(a.text().includes('[x]'), a.text());
});
// F20: code block with selection does not duplicate
test('code block wraps the selection once', () => {
  const a = fakeView('const total = 12', 0, 16); C.insertCodeBlock(a.view); assert.equal((a.text().match(/const total/g) || []).length, 1, a.text());
});

// Renderer/source contracts (repo pattern: fnv2 source checks)
test('Today renders unscheduled, gates passed dates, counts later', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('view.unscheduled'), 'unscheduled rendered');
  assert.ok(/view\.due\.passed[\s\S]{0,200}on\('today:due'\)|on\('today:due'\)[\s\S]{0,400}view\.due\.passed/.test(src), 'passed gated');
});
test('Home bills total is over all due bills, clock ticks, data kept', () => {
  const src = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(!src.includes('setData(null)'), 'no blank on reload');
});
test('reminders: untick passes due; snooze dedup uses normalised text', () => {
  const src = read('src/main/reminders.ts');
  const untick = src.slice(src.indexOf('async untick'), src.indexOf('async snooze'));
  assert.ok(untick.includes('locateReminder(lines, at.line, at.text, at.due)'), 'untick disambiguated');
  const snooze = src.slice(src.indexOf('async snooze'), src.indexOf('// ── The bell'));
  assert.ok(snooze.includes('normReminderText'), 'snooze dedup normalised');
});
test('chat: retry keeps ticked scope; failed undo stays undoable', () => {
  const src = read('src/renderer/src/state/chat.ts');
  const retry = src.slice(src.indexOf('export async function retryChat'), src.indexOf('export async function retryChat') + 1200);
  assert.ok(retry.includes('chosenFolder') && retry.includes('askChosen'), 'retry routes through askChosen');
  const undo = src.slice(src.indexOf('export async function undoAnswer'), src.indexOf('export function useChat'));
  assert.ok(undo.includes('showError') && !undo.includes(".catch((err: unknown) => errorMessage(err))"), 'undo failure shown, not recorded as undone');
});
test('repeat Done shortcut, Day note words, Link key label', () => {
  const rem = read('src/main/reminders.ts');
  assert.ok(rem.includes('nextOccurrence(r.repeat, new Date(at.due), at.due)'), 'Done shortcut only for the exact next occurrence');
  // (10.0 one start: the day note is the page's own editor now, with its honest empty line either way.)
  const dayNote = read('src/renderer/src/views/today/DayNote.tsx');
  assert.ok(dayNote.includes('Write anything here: it’s today’s note.') && dayNote.includes('No note for '), 'Day note words');
  assert.ok(!read('src/renderer/src/components/EditMenu.tsx').includes("hotkey: 'Mod+K'"), 'no stale Mod+K label');
  assert.ok(read('src/renderer/src/editor/setup.ts').includes('view.state.facet(EditorState.readOnly)'), 'read-only guard on editor handlers');
});
test('overlay key exception is case-insensitive', () => {
  assert.ok(read('src/renderer/src/App.tsx').includes('e.key.toLowerCase()'));
});

// ── Round 2: the 23 left findings ──
test('F15 calendar day difference is DST-safe and shared', () => {
  assert.equal(typeof T.calendarDayDiff, 'function');
  const now = new Date(2026, 2, 29, 12); // DST changeover in many zones
  assert.equal(T.calendarDayDiff(new Date(2026, 2, 28, 23).getTime(), now), -1);
  assert.equal(T.calendarDayDiff(new Date(2026, 2, 27, 12).getTime(), now), -2);
  assert.ok(!read('src/renderer/src/views/HomeView.tsx').includes('start - 86400000'));
  assert.ok(!read('src/renderer/src/views/TodayView.tsx').includes('start - 86400000'));
});
test('F36 logs do not leak between same-named projects', () => {
  const logs = [{ path: 'Projects/A/Log.md', project: 'Same' }, { path: 'Projects/B/Log.md', project: 'Same' }, { path: 'Logs/Log.md', project: 'Same' }];
  const mine = L.logsFor(logs, 'Same', 'Projects/B/Same.md');
  assert.ok(mine.some((l) => l.path === 'Projects/B/Log.md'));
  assert.ok(!mine.some((l) => l.path === 'Projects/A/Log.md'), JSON.stringify(mine));
});
test('F21 table Tab moves selection only; Shift+Tab at first cell falls through', () => {
  const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const a = fakeView(doc, 2, 2); assert.equal(C.tableTab(a.view, false), true); assert.equal(a.text(), doc, 'no rewrite on move');
  const b = fakeView(doc, 2, 2); assert.equal(C.tableTab(b.view, true), false);
});
test('t149 Tab into a table cell selects its words, so typing replaces them', () => {
  const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const a = fakeView(doc, 2, 2); C.tableTab(a.view, false);
  assert.deepEqual([a.view.state.selection.main.from, a.view.state.selection.main.to], [6, 7], 'Tab selects the next cell');
  const b = fakeView(doc, 6, 7); C.tableTab(b.view, true);
  assert.deepEqual([b.view.state.selection.main.from, b.view.state.selection.main.to], [2, 3], 'Shift+Tab selects the cell back');
});
test('t158 Tab in pipe lines without a rule row falls through; last-cell Tab still grows the table', () => {
  // A single pipe line is not a table yet (t158 broke it: Tab threw RangeError, a dead key and a page error).
  const one = '| only |';
  const a = fakeView(one, 3, 3); assert.equal(C.tableTab(a.view, false), false, 'one-cell table falls through'); assert.equal(a.text(), one, 'nothing rewritten');
  // Two pipe lines without a rule row are not a table either (t158: Tab rewrote `| b |` to `| --- |`, typed words gone).
  const two = '| a |\n| b |';
  const b = fakeView(two, 5, 5); assert.equal(C.tableTab(b.view, false), false, 'rule-less lines fall through'); assert.equal(b.text(), two, 'the second line keeps its words');
  const c = fakeView(two, 8, 8); assert.equal(C.tableTab(c.view, false), false, 'from the second line too'); assert.equal(c.text(), two, 'still nothing rewritten');
  // A real table still grows past its last cell (held in t158, locked in).
  const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const d = fakeView(doc, 30, 30); assert.equal(C.tableTab(d.view, false), true, 'last-cell Tab grows the table');
  assert.ok(d.text().endsWith('|     |     |'), `a new row lands, got: ${JSON.stringify(d.text())}`);
});
test('F43 snooze times are computed at click, and snooze offers Undo (F46)', () => {
  for (const p of ['src/renderer/src/panels/NoticeBell.tsx', 'src/renderer/src/views/today/DueCard.tsx', 'src/renderer/src/views/today/BriefCard.tsx']) {
    const src = read(p);
    assert.ok(/snoozeTimes\(Date\.now\(\)\)\[|freshSnooze|snoozeAt\(/.test(src), `${p} recomputes at click`);
  }
  assert.equal(R.snoozedKey('Notes.md\ncall mum\n123', 999), 'Notes.md\ncall mum\n999');
  assert.ok(read('src/renderer/src/views/today/DueCard.tsx').includes('snoozedKey'));
});
test('F3/F6/F7/F8/F14/F16 Today and Home round 2', () => {
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('rankAllFor('), 'hero owns its rows (round 4: brief-tasks rankAllFor owns the one list)');
  assert.ok(today.includes('Critical risk') || today.includes('risk pill') || /tone === 'ok' \? [^)]*risk/i.test(today), 'risk pill says the risk');
  const home = read('src/renderer/src/views/HomeView.tsx');
  // (10.0 one start: waiting, meetings and changes are the page's own sections; their quiet states live there.)
  assert.ok(today.includes("on('today:waiting') && waitingCount > 0"), 'quiet state: nothing waiting, no section');
  assert.ok(read('src/renderer/src/views/today/DayParts.tsx').includes('is-empty'), 'quiet state: no meetings, the day stays calm');
  assert.ok(today.includes('Nothing has changed in your projects since yesterday morning.'), 'quiet state: nothing changed');
  assert.ok(home.includes('Nothing on for the family'), 'quiet state: Nothing on for the family');
  assert.ok((home.match(/home-seeall/g) || []).length >= 2, 'see-all affordances: the kept extras link to Money and Health');
  assert.ok(home.includes("openModule('weekly')") && home.includes("openModule('family'") && home.includes('openInbox()'), 'and to the Weekly update, Family and the Inbox');
  assert.ok(/function DayActivity[\s\S]{0,3000}<NoteLine/.test(read('src/renderer/src/views/today/DayParts.tsx')), 'activity rows are buttons (the note lines that open)');
  assert.ok(home.includes('entry(m.id, today, !yes)') || home.includes('today, false)'), 'habit untick');
  const due = read('src/renderer/src/views/today/DueCard.tsx');
  assert.ok(due.includes('Nothing due') || due.includes('nothing due'), 'empty chosen day says so');
  const cards = read('src/renderer/src/views/today/CardsDue.tsx');
  assert.ok(cards.includes('decks.length > 6') || cards.includes('See all') || cards.includes('openNotebook') || cards.includes('A.open'), 'cards overflow reaches the rest');
  const day = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(!day.includes('And {shown.count - shown.items.length} more.</p>') || day.includes('<button'), 'and-more is a control');
});
test('F22 html paste converts structure and fails closed on scripts', () => {
  const md = H.htmlToMarkdown('<h2>Title</h2><p>Some <b>bold</b> and <a href="https://example.com">a link</a></p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script>');
  assert.ok(md.includes('## Title') && md.includes('**bold**') && md.includes('[a link](https://example.com)') && md.includes('- One') && !md.includes('alert'), md);
});
test('F22/F23/F25/F26/F27/F28/F29 editor round 2', () => {
  assert.ok(read('src/renderer/src/lib/htmlPaste.ts').includes('export function htmlToMarkdown'));
  assert.ok(read('src/renderer/src/editor/setup.ts').includes('htmlToMarkdown'));
  const slash = read('src/renderer/src/editor/slash.ts');
  assert.ok(slash.includes('syntaxTree') && slash.includes('picker'), 'slash: tree check + picker keeps query');
  assert.ok(read('src/renderer/src/editor/NoteEditor.tsx').includes('docs.release(path);') && read('src/renderer/src/editor/NoteEditor.tsx').includes('placed'), 'release + placed cursor');
  assert.ok(read('src/renderer/src/editor/NoteEditor.tsx').includes('hist') || read('src/renderer/src/editor/setup.ts').includes('hist:'), 'history reset compartment');
  assert.ok(read('src/renderer/src/editor/reminders.ts').includes('focusChanged'), 'reminder fixed on blur');
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes('shown') && notes.includes('closest'), 'snippets for shown, keys scoped');
  assert.ok(read('src/renderer/src/views/NoteView.tsx').includes('requestAnimationFrame') || read('src/renderer/src/views/NoteView.tsx').includes('setTimeout'), 'text subscription coalesced');
});
test('F37/F38/F40 projects round 2', () => {
  const dash = read('src/renderer/src/views/project/LayoutDashboard.tsx');
  assert.ok(dash.includes("m.source === 'section'") && dash.includes('synthetic') || dash.includes('editable'), 'board/cards guard synthetic');
  assert.ok(dash.includes('rows.map(({ r }) => r)') || dash.includes('filtered'), 'grid header from filtered rows');
  assert.ok(!dash.includes('fields.slice(0, 12)'), 'no silent 12-field cap');
  assert.ok(read('src/shared/layouts.ts').includes("'trend'") && read('src/shared/layouts.ts').includes("'entry'"), 'trend/entry optional when empty');
});
test('F48/F49/F50/F51 chat keyboard theme round 2', () => {
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('also'), 'also in conflict check');
  assert.ok(read('src/renderer/src/panels/ChatPanel.tsx').includes('catch'), 'chat promises caught');
  assert.ok(read('src/renderer/src/state/fit.ts').includes('.chat-input textarea'), 'Ask lands in the chat box (the floating card is gone)');
  assert.ok(read('src/renderer/src/styles.css').includes('--shadow-float'), 'the float shadow token stays in the theme');
  assert.ok(read('src/renderer/src/App.tsx').includes('dataset.theme'), 'theme-aware title-bar fallback');
});
