// node --test tests/w2b-87.test.mjs — the Vault redesign, wave 2b (30 Oct 2026): Notes with its folder rail, the
// daily head, one Meetings place (list, week calendar, one meeting page in three states on the real recorder), and
// People with organisations and person pages. Pure shared logic is checked as it is; the screens are guarded by the
// kit they wear and the wiring they keep, so each check fails without its change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-w2b-87-'));
let N;
let WM;
let P;
let PM;
let MD;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [mod, file] of [['N', 'src/shared/notes-list.ts'], ['WM', 'src/shared/work-meetings.ts'], ['P', 'src/shared/people.ts'], ['PM', 'src/shared/personal-modules.ts'], ['MD', 'src/shared/markdown.ts']]) {
    const entry = path.join(work, `entry-${mod}.ts`);
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, file))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, `${mod}.mjs`), format: 'esm' }, logLevel: 'silent' });
    if (mod === 'N') N = await import(pathToFileURL(path.join(work, `${mod}.mjs`)).href);
    if (mod === 'WM') WM = await import(pathToFileURL(path.join(work, `${mod}.mjs`)).href);
    if (mod === 'P') P = await import(pathToFileURL(path.join(work, `${mod}.mjs`)).href);
    if (mod === 'PM') PM = await import(pathToFileURL(path.join(work, `${mod}.mjs`)).href);
    if (mod === 'MD') MD = await import(pathToFileURL(path.join(work, `${mod}.mjs`)).href);
  }
});
after(() => rmSync(work, { recursive: true, force: true }));

const row = (p, extra = {}) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: 1, kind: 'note', kindLabel: 'Note', snippet: '', ...extra });

test('folders: top folders with their subs, most notes first; Daily and Docs stay kinds, not folders', () => {
  const rows = [row('House/Kitchen.md'), row('House/Appliances/Fridge.md'), row('House/Appliances/Oven.md'), row('Money/Bills.md'), row('Daily/2026-10-29.md'), row('Docs/Server.md'), row('Loose.md')];
  const folders = N.folderChoices(rows);
  assert.deepEqual(folders.map((f) => [f.name, f.count]), [['House', 3], ['Money', 1]]);
  assert.deepEqual(folders[0].subs, [{ name: 'Appliances', prefix: 'House/Appliances', count: 2 }]);
  assert.equal(folders[0].prefix, 'House');
});

test('the folder filter leaves one folder: a top folder takes its subs, a sub takes itself', () => {
  const rows = [row('House/Kitchen.md'), row('House/Appliances/Fridge.md'), row('Money/Bills.md')];
  assert.deepEqual(N.filterNoteRows(rows, { folder: 'House' }).map((r) => r.path), ['House/Kitchen.md', 'House/Appliances/Fridge.md']);
  assert.deepEqual(N.filterNoteRows(rows, { folder: 'House/Appliances' }).map((r) => r.path), ['House/Appliances/Fridge.md']);
  assert.deepEqual(N.filterNoteRows(rows, { folder: 'Money', query: 'bills' }).map((r) => r.path), ['Money/Bills.md']);
});

test('a row reads its when short: the time today, the weekday this week, the date after that', () => {
  const now = new Date(2026, 9, 30, 12, 0); // Friday 30 Oct 2026
  assert.equal(N.shortWhen(new Date(2026, 9, 30, 9, 12).getTime(), now), '9:12 am');
  assert.equal(N.shortWhen(new Date(2026, 9, 27, 9).getTime(), now), 'Tue');
  assert.equal(N.shortWhen(new Date(2026, 9, 21, 9).getTime(), now), '21 Oct');
  assert.equal(N.shortWhen(new Date(2025, 4, 2, 9).getTime(), now), '2 May 2025');
});

test('the week is Monday to Sunday, always holding today, and reads in a person words', () => {
  assert.deepEqual(WM.weekOf('2026-10-30'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(WM.weekOf('2026-10-31'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'], 'a Saturday is inside its week, never past it');
  assert.deepEqual(WM.weekOf('2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'], 'a Sunday ends its week');
  assert.equal(WM.weekRangeWords(WM.weekOf('2026-10-30')), '26 Oct to 1 Nov');
  assert.equal(WM.weekRangeWords(WM.weekOf('2026-09-01')), '31 Aug to 6 Sep');
  assert.equal(WM.weekDayHead('2026-10-26'), 'Mon 26');
  assert.equal(WM.weekDayHead('2026-10-31'), 'Sat 31');
  assert.equal(WM.dayColumnHead('2026-10-30'), 'Friday 30 October');
});

test('one day meetings, earliest first; undated never land on a day', () => {
  const ms = [
    { title: 'Late', date: '2026-10-30', dated: true, time: '15:00' },
    { title: 'Early', date: '2026-10-30', dated: true, time: '09:00' },
    { title: 'No day', date: '', dated: false, time: '' },
    { title: 'Other day', date: '2026-10-29', dated: true, time: '09:00' },
  ];
  assert.deepEqual(WM.meetingsOn(ms, '2026-10-30').map((m) => m.title), ['Early', 'Late']);
});

test('the home numbers: coming up, actions still open, questions still open, decisions this week, series, this month', () => {
  const m = (date, actions = [], decisions = [], questions = []) => ({ date, dated: true, actions, decisions, questions });
  const stats = WM.meetingStats(
    [m('2026-10-31', [{ done: false }, { done: true }], [{}, {}], [{ answered: false }, { answered: true }]), m('2026-10-28', [], [{}], [{ answered: false }]), m('2026-09-01', [{ done: false }], [])],
    [{ cadence: 'Weekly' }, { cadence: 'Monthly' }],
    '2026-10-30',
  );
  // (p9 fresh-eyes, 4 Nov 2026: the stat reads "series" and opens the Series list with every series, so the
  // number counts every series — a weekly-only count behind the Series name said "1 series" with two shown.)
  assert.deepEqual(stats, { comingUp: 1, openActions: 2, decisionsWeek: 3, openQuestions: 2, series: 2, thisMonth: 2 });
});

test('people filters keep the caller card shape, so the list keeps its area and protected flag', () => {
  const cards = [
    { name: 'Mia', role: '', orgName: '', youOwe: 0, owesYou: 1, youOweItems: [], owesYouItems: [], lastContact: undefined, nextMeeting: undefined, area: 'work', protected: false },
    { name: 'Kim', role: '', orgName: '', youOwe: 0, owesYou: 0, youOweItems: [], owesYouItems: [], lastContact: undefined, nextMeeting: undefined, area: 'work', protected: true },
  ];
  const owes = P.filterPeople(cards, 'owes-you', '2026-10-30');
  assert.equal(owes.length, 1);
  assert.equal(owes[0].protected, false);
  assert.equal(P.sortPeopleByAction(cards)[0].name, 'Mia');
  assert.equal(P.sortPeopleByAction(cards)[1].protected, true);
});

test('the notes list wears the kit and the rail, and keeps every way in and out', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  for (const bit of ['w2b-folders', 'className={`frow', 'frow sub', 'className="chips"', '<ListFind id="notes"', 'gtile xs', 'folderChoices(rows)', 'shortWhen(r.mtime)', 'Show as a table', 'Open today’s note', 'New {kind'] ) assert.ok(page.includes(bit), `notes ${bit}`);
  assert.ok(page.includes("openTypePage('note', 'tab', { asTable: true })"), 'the table stays one menu row away');
});

test('a daily note reads its day in words, says where filings land, and reaches yesterday', () => {
  const head = read('src/renderer/src/views/note/DailyHead.tsx');
  for (const bit of ['Daily note', 'dailyPageTitle', 'captureNoProject', "section: 'capture'", 'Your choice, kept', 'w2b-keep']) assert.ok(head.includes(bit), `daily head ${bit}`);
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes('DailyHead') && view.includes('dailyWords'), 'the note shows it for daily notes');
  // 5 Nov 2026, the clean header: yesterday and tomorrow run from the note's ⋯ menu, not the bar.
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes('Yesterday') && menus.includes('openDailyOffset(-1)'), 'yesterday from the … menu');
  assert.ok(menus.includes('Tomorrow') && menus.includes('openDailyOffset(1)'), 'tomorrow from the … menu');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('export async function openDailyOffset'), 'the opener');
  assert.ok(read('src/preload/index.ts').includes('open: (iso?: string)'), 'the bridge takes a day');
  assert.ok(read('src/main/app.ts').includes('dayFromIso'), 'the day opens like today, never the day before');
});

test('one meetings place: the home, the week, and one page in three states on the real recorder', () => {
  // 9.2 uplift F21: deletes go through the one remove-words helper ("Delete … to the Bin").
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // Packs uplift item 10: the home moved into the pack shell; round 3 folds the this-month count into its one
  // summary line ("4 this month").
  for (const bit of ['WeekCalendar', 'MeetingRecorder', 'useMeetingParts', 'meetingStats', "'upcoming'", "'past'", "'series'", "'actions'", "'decisions'", "'questions'", 'Every action', 'Every decision', 'Every question', 'Every meeting as a table', 'this month', 'Live transcript', 'recbanner', 'tscript', 'Prep, from your notes', 'recording filed', "deleteToBin('the meeting')", "deleteToBin('the series')", 'A.trashPath', 'meetingPhase', 'useRecorder', 'isBusy(v.live)', 'stopRecording', 'mergeTranscript', 'clockWords', 'Bring in a transcript', 'Make prep sheet', 'Draft follow-up', 'Add from a file', 'Show the folder']) assert.ok(page.includes(bit), `meetings ${bit}`);
  assert.ok(!page.includes('<WorkShell'), 'no second chrome: one page, not module tabs');
  assert.ok(page.includes('openModule(\'meetings\', \'calendar\')') && page.includes('openModule(\'meetings\', \'overview\')'), 'list and calendar are one tab');
});

test('the week shows full titles, month week and day in words, and peeks before it opens', () => {
  const cal = read('src/renderer/src/views/meetings/WeekCalendar.tsx');
  for (const bit of ['weekOf', 'weekRangeWords', 'meetingsOn', 'weekDayHead', 'dayColumnHead', "'month', 'week', 'day'", 'Today', 'peek({ path: m.path }', 'onOpen(m.path)', 'Choosing a block opens the meeting in a side peek']) assert.ok(cal.includes(bit), `week ${bit}`);
  assert.ok(/button\.ev\.w2b-ev \{[^}]*white-space: normal/.test(read('src/renderer/src/styles/w2b.css')), 'full titles wrap, never cut');
});

test('people keep organisations, owes, and the way to cards; a person page stays whole', () => {
  const list = read('src/renderer/src/views/PeoplePage.tsx');
  for (const bit of ['Organisations', 'personHue', 'pc-avatar', 'owes you', 'you owe', 'nothing open', 'Make cards for people named in projects', 'same person under two names', 'New organisation']) assert.ok(list.includes(bit), `people ${bit}`);
  const person = read('src/renderer/src/views/PersonPage.tsx');
  // 10.0 papercuts: the three lists (Meetings together, Projects they are in, Notes that mention them) are one
  // Timeline of meetings, promises either way, projects and notes.
  for (const bit of ['metapills', 'Prep for next meeting', 'Their note', 'Delete their note to the Bin', 'Timeline', 'Coming up', 'They owe', 'You owe', 'tickAction']) assert.ok(person.includes(bit), `person ${bit}`);
});

test('the product rules hold on the new words and styles', () => {
  const files = ['src/renderer/src/views/NotesPage.tsx', 'src/renderer/src/views/PeoplePage.tsx', 'src/renderer/src/views/PersonPage.tsx', 'src/renderer/src/views/modules/work/MeetingsPage.tsx', 'src/renderer/src/views/meetings/WeekCalendar.tsx', 'src/renderer/src/views/note/DailyHead.tsx', 'src/renderer/src/styles/w2b.css'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!src.includes('—'), `${f} has no em dashes`);
    assert.ok(!/deepseek/i.test(src) && !/pi-ai/i.test(src), `${f} names no engine`);
  }
  const css = read('src/renderer/src/styles/w2b.css');
  const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0].toLowerCase());
  assert.deepEqual([...new Set(hexes)], ['#d93b2b'], 'the only raw colour is the recorder red, as the kit');
  assert.ok(!/cream/i.test(css), 'no cream');
});

test('round 2: the prep answer cites its sources, and a daily heading that repeats the day hides', () => {
  const pack = {
    count: 2,
    meeting: { title: 'Site sync', date: '2026-11-02', time: '8:00 AM', path: 'Meetings/Site sync.md' },
    people: [{ name: 'Marco Costa', theirs: [{ what: 'Call Alpine about the seal', path: 'Notes/Seal.md', from: 'Seal note' }], lastMet: null }],
    last: null,
    project: { path: 'Projects/Fitzroy fit-out.md', name: 'Fitzroy fit-out', items: [{ what: 'Reply on the clause', path: 'Projects/Fitzroy fit-out.md', from: 'Fitzroy fit-out' }] },
    earlier: [],
    linked: [],
    recent: [],
  };
  const ans = WM.prepAnswer(pack);
  assert.equal(ans.sources.length, 2);
  assert.equal(ans.sentences.length, 2);
  assert.ok(ans.sentences.every((s) => s.whats.every((w) => w.cite >= 1 && w.cite <= ans.sources.length)));
  assert.ok(N.hidesFirstLine('# 2026-10-30\n\n## Plan', '2026-10-30'));
  assert.ok(N.hidesFirstLine('# Fri 30 Oct 2026\n\nBody', '2026-10-30'));
  assert.ok(!N.hidesFirstLine('## Plan\n\nBody', '2026-10-30'));
  assert.ok(!N.hidesFirstLine('# Something else\n\nBody', '2026-10-30'));
});

test('round 3: the daily page title, every date form that repeats it, and prep from linked notes', () => {
  assert.equal(N.dailyPageTitle('2026-10-30'), 'Friday 30 October');
  assert.equal(N.dailyPageTitle('2026-02-30'), '');
  assert.equal(N.dailyPageTitle('Weekly review'), '');
  assert.ok(N.hidesFirstLine('# Friday 30 October\n\n## Plan', '2026-10-30'));
  assert.ok(N.hidesFirstLine('# Friday 30 October 2026\n\nBody', '2026-10-30'));
  assert.ok(N.hidesFirstLine('# 30 October 2026\n\nBody', '2026-10-30'));
  assert.ok(!N.hidesFirstLine('# Thursday 30 October\n\nBody', '2026-10-30'), 'the wrong weekday never hides');
  assert.ok(!N.hidesFirstLine('# 2026-10-29\n\nBody', '2026-10-30'), 'another day never hides');
  assert.equal(N.firstRepeatLine('---\ntype: note\n---\n\n# 2026-10-30\n\nBody', '2026-10-30'), 4);
  assert.equal(N.firstRepeatLine('# Something else\n\nBody', '2026-10-30'), null);
  const pack = {
    count: 4,
    meeting: { title: 'Site sync', date: '2026-11-02', time: '8:00 AM', path: 'Meetings/Site sync.md' },
    people: [],
    last: { path: 'Meetings/Last.md', title: 'Last sync', date: '2026-10-26', open: [{ what: 'Confirm the sealer', path: 'Meetings/Last.md', from: 'Last sync' }], notReached: [] },
    project: null,
    earlier: [],
    linked: [{ what: 'Tiler handover checklist', path: 'Notes/Checklist.md', from: 'Tiler handover checklist' }],
    recent: [{ what: 'Cool-room service log', path: 'House/Cool-room.md', from: 'Cool-room service log' }],
  };
  const ans = WM.prepAnswer(pack);
  assert.ok(ans.sentences.some((s) => s.lead === 'Linked notes'), 'linked notes read as a sentence');
  assert.ok(ans.sentences.some((s) => s.lead === 'Recent on the project'), 'recent notes read as a sentence');
  assert.equal(ans.sources.length, 3);
  assert.ok(ans.sentences.every((s) => s.whats.every((w) => w.cite >= 1 && w.cite <= ans.sources.length)));
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  for (const bit of ['Linked notes', 'Recent on the project', 'or in linked notes']) assert.ok(meet.includes(bit), `meetings ${bit}`);
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes('notesPageKeepsType(typeId'), 'a pack record reads in Notes; only projects, people, meetings and series stay out');
  const shared = read('src/shared/notes-list.ts');
  for (const bit of ["'project'", "'person'", "'meeting'", "'meeting-series'"]) assert.ok(shared.includes(bit), `the shared rule stays out ${bit}`);
  assert.ok(!notes.includes("typeId !== 'note'"), 'the old blanket exclusion is gone');
});

test('round 2: the meeting page wears the mock shape, and the daily view keeps its fixes', () => {
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  for (const bit of ['prepAnswer', 'className="cite"', 'Sources ·', 'open items', 'w2b-reccard', 'askMeetingsTour', 'Show me around Meetings', 'w2b-titleacts']) assert.ok(meet.includes(bit), `meetings ${bit}`);
  assert.ok(!meet.includes('w2b-backrow'), 'the floating back row is gone');
  const view = read('src/renderer/src/views/NoteView.tsx');
  for (const bit of ['hidesFirstLine', 'w2b-hide-first', 'w2b-is-daily', 'strip={!isDaily}']) assert.ok(view.includes(bit), `note ${bit}`);
  const rail = read('src/renderer/src/views/note/ContextRail.tsx');
  for (const bit of ['defaultOpen', 'nv-context-toggle']) assert.ok(rail.includes(bit), `rail ${bit}`);
  const css = read('src/renderer/src/styles/w2b.css');
  for (const bit of ['w2b-hide-first', 'w2b-titleacts', 'w2b-reccard', 'w2b-is-daily']) assert.ok(css.includes(bit), `css ${bit}`);
});

test('round 4: on any note the first heading that only repeats the page title is not drawn again', () => {
  assert.ok(N.hidesFirstLine('# Cool-room service log\n\n## September visit', 'Cool-room service log'), 'an ordinary note');
  assert.ok(N.hidesFirstLine('# Site sync - tiler handover\n\n## Agenda', 'Site sync - tiler handover'), 'a meeting note');
  assert.equal(N.firstRepeatLine('---\nproject: "[[Fitzroy fit-out]]"\n---\n# Cool-room service log\n\nBody', 'Cool-room service log'), 3, 'past the front matter, file untouched');
  assert.ok(!N.hidesFirstLine('# September visit\n\nBody', 'Cool-room service log'), 'another heading stays');
  assert.ok(!N.hidesFirstLine('Words first.\n\n# Cool-room service log\n', 'Cool-room service log'), 'only the first heading counts');
  assert.ok(N.hidesFirstLine('# 2026-10-30\n\n## Plan', '2026-10-30'), 'daily notes keep round 3');
  const shown = N.stripRepeatHeading('# Cool-room service log\n\n## September visit\n', 'Cool-room service log');
  assert.doesNotMatch(shown, /Cool-room service log/, 'reading and peek copies leave it out');
  assert.match(shown, /September visit/);
  assert.equal(N.stripRepeatHeading('# Friday 30 October\n\nBody', '2026-10-30'), 'Body', 'daily words strip the same way');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(!view.includes('isDaily && hidesFirstLine'), 'the editor hides it on every note, not only daily ones');
  assert.ok(view.includes('stripRepeatHeading'), 'reading uses the one copy');
  const live = read('src/renderer/src/editor/live-preview.ts');
  assert.ok(!live.includes('/(^|\\/)daily\\/i.test(ctx.path)'), 'live preview hides it on every note, not only daily ones');
  assert.ok(live.includes('firstRepeatLine'), 'live preview hides the exact line');
  const hover = read('src/renderer/src/components/HoverPreview.tsx');
  assert.ok(hover.includes('stripRepeatHeading'), 'a peek leaves it out too');
  assert.ok(read('src/renderer/src/editor/widgets.ts').includes('stripRepeatHeading'), 'an embedded note leaves it out');
  assert.ok(read('src/renderer/src/lib/hydrate.ts').includes('stripRepeatHeading'), 'an embedded note leaves it out in reading');
});

test('round 4: the strip is the default and Context is the one a person opens', () => {
  const heads = MD.headingsWithLines('---\ntitle: x\n---\n# Cool-room service log\n\n## September visit\n\n```\n# not a heading\n```\n\n### Warranty terms\n');
  assert.deepEqual(heads.map((h) => [h.level, h.text, h.line]), [[1, 'Cool-room service log', 3], [2, 'September visit', 5], [3, 'Warranty terms', 11]], 'headings with their lines, front matter and fences skipped');
  const rail = read('src/renderer/src/views/note/ContextRail.tsx');
  for (const bit of ['On this page', 'Tags', 'onTag', 'headingsWithLines', 'firstRepeatLine', 'Show this note', 'nv-context-toggle']) assert.ok(rail.includes(bit), `rail ${bit}`);
  assert.ok(!rail.includes('Linked here'), 'links left the strip for the foot (t22-note-once, 8 Nov 2026)');
  assert.ok(rail.includes('defaultOpen = false'), 'shut until asked, on every note');
  assert.ok(/contextOpenNow[\s\S]*?v === null \? false/.test(rail), 'nothing remembered means shut');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes('onTag={openTag}'), 'tags search from the strip');
  assert.ok(!view.includes('defaultOpen='), 'no note opens Context by itself any more');
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(/localStorage\.getItem\('nv\.noteRail\.open'\)[\s\S]*?v === null \? false/.test(menus), 'the menu offers to show it');
});

test('round 4: the catalogue short names wherever a pack name is shown', () => {
  const house = PM.HOUSE.types.find((t) => t.id === 'house');
  assert.equal(PM.HOUSE.name, 'House');
  assert.equal(house.name, 'House', 'the chip above the title');
  assert.equal(house.plural, 'Houses');
  assert.ok(house.aliases.includes('home') && house.aliases.includes('homes'), 'an old type: still answers');
  assert.match(house.empty.title, /houses/i);
});
