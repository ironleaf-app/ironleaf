// node --test tests/today-focus.test.mjs — p12-today-focus: Today answers "what do I do now?" Big
// vault: 70 own tasks, 31 others', on-hold and done projects. On-hold and idea count nowhere; Next
// for you is at most 5 own items by the existing rank; the rest folds; others sit under Waiting
// folded; the rail counts own late or due today only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-focus-'));
let T, P, HUB, BT;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject, applyProjectEdit } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  P = T;
  // Due grouping (round 4: Later) and the hub's tick (a note's line writes its note).
  const hubEntry = path.join(work, 'hub.ts');
  writeFileSync(hubEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};\nexport { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: hubEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'hub.mjs'), format: 'esm' }, logLevel: 'silent' });
  try {
    const { mkdirSync, symlinkSync, existsSync } = await import('node:fs');
    mkdirSync(path.join(work, 'node_modules'), { recursive: true });
    if (!existsSync(path.join(work, 'node_modules', 'yaml'))) symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  HUB = await import(pathToFileURL(path.join(work, 'hub.mjs')).href);
  // One ranked list (round 4): project steps and own note lines through the same rank.
  try {
    await build({ input: path.join(root, 'src/shared/brief-tasks.ts'), platform: 'node', output: { file: path.join(work, 'bt.mjs'), format: 'esm' }, logLevel: 'silent' });
    BT = await import(pathToFileURL(path.join(work, 'bt.mjs')).href);
  } catch {
    BT = null;
  }
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 10, 4, 9, 30); // Wednesday 4 November 2026
const iso = (days) => { const d = new Date(2026, 10, 4 + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (days) => new Date(2026, 10, 4 + days, 10).getTime();

// Big vault: active projects with 70 own dated steps (late, today, this week,
// coming up), 31 others' steps, plus on-hold, idea and done projects whose
// steps must count nowhere. Made-up bakery and IT shop work, owned by Mia Tran.
function bigVault() {
  const own = [];
  for (let i = 0; i < 70; i++) {
    const off = i < 12 ? -1 - (i % 5) : i < 22 ? 0 : i < 45 ? 1 + (i % 6) : 8 + (i % 20);
    own.push(`- [ ] Own job ${i + 1} — Mia · by ${iso(off)}`);
  }
  const others = [];
  for (let i = 0; i < 31; i++) {
    const off = i % 3 === 0 ? -2 : 1 + (i % 5);
    others.push(`- [ ] Their job ${i + 1} — Priya · by ${iso(off)}`);
  }
  const active = `---\ntype: project\nstatus: active\nhealth: on track\nowner: Mia Tran\n---\n# Active Work\n\n## What’s next\n\n${[...own.slice(0, 35), ...others.slice(0, 15)].join('\n')}\n`;
  const active2 = `---\ntype: project\nstatus: planning\nhealth: on track\nowner: Mia Tran\n---\n# Second Active\n\n## What’s next\n\n${[...own.slice(35), ...others.slice(15)].join('\n')}\n`;
  const held = `---\ntype: project\nstatus: on hold\nhealth: at risk\nowner: Mia Tran\ndue: "${iso(-3)}"\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by ${iso(-4)}\n- [ ] Held today job — Mia · by ${iso(0)}\n- [ ] Held waiting job — Priya · by ${iso(-2)}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${iso(1)} | Held date | planned |\n\n## Risks and issues\n\n- **High** — Held risk\n`;
  const idea = `---\ntype: project\nstatus: idea\nowner: Mia Tran\n---\n# Maybe One Day\n\n## What’s next\n\n- [ ] Idea late job — Mia · by ${iso(-6)}\n- [ ] Idea today job — Mia · by ${iso(0)}\n`;
  const done = `---\ntype: project\nstatus: done\nowner: Mia Tran\n---\n# Finished Job\n\n## What’s next\n\n- [ ] Done late job — Mia · by ${iso(-9)}\n`;
  const files = {
    'Projects/Active Work/Active Work.md': active,
    'Projects/Second Active/Second Active.md': active2,
    'Projects/Held Over/Held Over.md': held,
    'Projects/Maybe One Day/Maybe One Day.md': idea,
    'Projects/Finished Job/Finished Job.md': done,
  };
  return Object.entries(files).map(([p, text], i) => ({ path: p, version: `v${i}`, modified: at(-2), project: P.parseProject(text, p) }));
}

test('on-hold and idea projects count nowhere in Today, but keep their tasks on their page', () => {
  const projects = bigVault();
  // Their tasks stay on the project page: the file still holds them.
  const held = projects.find((x) => x.project.name === 'Held Over').project;
  assert.ok(held.next.some((n) => n.what === 'Held late job' && !n.done), 'on-hold keeps its steps');
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  const allDue = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.passed];
  const allWait = d.waiting.map((w) => w.what);
  for (const gone of ['Held late job', 'Held today job', 'Held waiting job', 'Held date', 'Idea late job', 'Idea today job', 'Done late job']) {
    assert.ok(!allDue.some((x) => x.what === gone), `${gone} is not due`);
    assert.ok(!allWait.includes(gone), `${gone} is not waiting`);
  }
  assert.ok(!d.atRisk.some((r) => r.projectName === 'Held Over'), 'on-hold at risk is not at risk');
  assert.ok(!d.unscheduled.some((x) => x.projectName === 'Held Over' || x.projectName === 'Maybe One Day'), 'no unscheduled from shelved');
  assert.equal(d.projects, 2, 'only the two live projects count');
});

test('one Today count: own items late or due today only, everywhere', () => {
  assert.equal(typeof T.todayDueCount, 'function', 'one function counts the projects');
  const d = T.buildToday({ projects: bigVault(), notes: [], me: 'Mia Tran' }, TODAY);
  const n = T.todayDueCount(d);
  assert.equal(n, d.due.overdue.length + d.due.today.length, 'late plus today');
  assert.ok(n > 0 && n < 70, `a real number, not the whole vault: ${n}`);
  // Same shape accepted everywhere: the due groups alone.
  assert.equal(T.todayDueCount(d.due), n, 'the due groups count the same');
  // 5 Nov 2026, one rule for late, today and this week (the audit found 13 versus 33): the rail,
  // Today and Tasks count the filtered lists they show through dayShapeCounts now (late/today/week
  // together), not the late-plus-today pair alone. The pair still counts correctly above; the surfaces
  // moved on (t76: re-deriving ownership from words disagreed with the lists when me was null).
  const places = read('src/renderer/src/panels/Places.tsx');
  // t31 (8 Nov 2026): sidebarTodayCount reads the one rule, shared with the former host app's one
  // side bar.
  assert.ok(places.includes('sidebarTodayCount('), 'the rail reads the one rule');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('dayShapeCounts(projectSteps'), 'Today reads the one rule');
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('dayShapeCounts('), 'Tasks reads the one rule');
  // The owner reading both doors share: no owner is theirs, a day is not a person, a name is them or not.
  assert.equal(typeof T.isOwnText, 'function', 'one owner reading');
  assert.ok(T.isOwnText('Own job — Mia · by 2026-11-03', 'Mia Tran', TODAY), 'their first name is theirs');
  assert.ok(!T.isOwnText('Their job — Priya · by 2026-11-03', 'Mia Tran', TODAY), 'another name is not');
  assert.ok(T.isOwnText('Just a thought', 'Mia Tran', TODAY), 'no owner is theirs');
  assert.ok(T.isOwnText('Call — by 23 Oct 2026', 'Mia Tran', TODAY), 'a day after the dash is theirs');
  assert.ok(!T.shelvedProjectText('---\ntype: project\nstatus: active\n---\n'), 'live is not shelved');
  assert.ok(T.shelvedProjectText('---\ntype: project\nstatus: on hold\n---\n'), 'on hold is shelved');
  assert.ok(!T.shelvedProjectText('---\ntype: project\nstatus: Placeholder\n---\n'), 'Placeholder is not on hold');
});

test('Next is at most 5 own items by the existing rank, with done and open', () => {
  const d = T.buildToday({ projects: bigVault(), notes: [], me: 'Mia Tran' }, TODAY);
  const ranked = T.rankNextForYou([...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later]);
  assert.ok(ranked.length > 5, 'the big vault ranks more than five');
  assert.ok(ranked.every((x) => x.kind === 'step' && !x.others), 'own steps only, never dates or others');
  assert.deepEqual(ranked.slice(0, 5).map((x) => x.offset <= 0), [true, true, true, true, true].slice(0, Math.min(5, ranked.filter((x) => x.offset <= 0).length)), 'late and today first');
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(/slice\(0,\s*5\)/.test(src) || /NEXT_SHOWN\s*=\s*5/.test(src) || /at most 5/i.test(src), 'the top shows at most five');
  assert.ok(src.includes('>Next</h2>'), 'Next keeps its head (step 2: Late reads above it)');
  // Round 4: one list — Next draws each row where it lives (a step as the project rows do, a note's line as Due
  // did), one-click done and open, their buttons shown in the row, not only on hover.
  assert.ok(/next\.map\(\(item\) => workRow\(item\)\)/.test(src), 'Next draws the one list’s rows');
  const css = read('src/renderer/src/styles/today.css');
  assert.ok(!/\.td-next\s+\.td-actions\s*\{[^}]*position:\s*static/.test(css), 'Next never gives its buttons a line of their own');
  assert.ok(/\.td-row\.tkrow\s+\.td-actions\s*\{[^}]*--who-w/.test(css), 'the hover buttons stay clear of who and when');
  // Done ticks the note's box: the tick edits the step done, as the row's tick does.
  const first = ranked[0];
  assert.ok(first.kind === 'step' && first.index !== undefined, 'the first Next item is a step with a line');
  const proj = bigVault().find((x) => x.path === first.project).project;
  T.applyProjectEdit(proj, { kind: 'change', list: 'next', index: first.index, item: { done: true } });
  assert.ok(proj.next[first.index].done, 'the step ticks done in the project');
});

test('everything else folds under one Also section, remembered', () => {
  // Step 2 (12 Nov 2026): the whisper line is one Also fold that looks like a section.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!src.includes('more this week'), 'never "more this week" when later weeks fold in too (round 2)');
  // One Also section past Meetings, opening the full list — the rows first, then the day's note, waiting on
  // others and the week inside.
  assert.ok(!src.includes('Show everything else'), 'never the old naming any more');
  assert.ok(src.includes('data-section="also"') && src.includes('td-h-also'), 'one Also section');
  assert.ok(!src.includes('things need a look'), 'never the whisper line any more');
  assert.ok(src.includes('<DayNote') && src.includes('Waiting on others') && src.includes('<WeekStrip'), 'the day’s note, waiting and the week fold inside');
  assert.ok(/localStorage/.test(src), 'the fold is remembered');
  // 5 Nov 2026, the walk: the brief, the risks and the dates gone by stood open below a CLOSED
  // line — a fault, not a remembered fold (they rendered outside it). Everything below the line folds now,
  // shut by default, one click away.
  const at = (mark) => {
    const i = src.indexOf(mark);
    assert.ok(i >= 0, `${mark} is on the page`);
    return i;
  };
  // Layout round 2 (20 Nov 2026): the folded sections are More for today's list (defined before the page), passed
  // to the balanced columns only while the fold is open.
  at('data-section="also"');
  const more = src.slice(at('const moreForToday'), at('const near = nearWords'));
  assert.ok(more.includes('data-section="brief"'), 'the morning brief folds inside');
  assert.ok(more.includes('title="Projects at risk"'), 'projects at risk fold inside');
  assert.ok(more.includes('Dates that went by: did they happen?'), 'dates that went by fold inside');
  assert.ok(src.includes('...(elseOpen ? moreForToday : [])'), 'only while open');
  assert.ok(src.includes('setElseOpen(open)') && src.includes('keepElseOpen(open)'), 'a person’s own open-or-shut stays remembered');
});

test('other people never mix in: Waiting only, folded', () => {
  const d = T.buildToday({ projects: bigVault(), notes: [], me: 'Mia Tran' }, TODAY);
  const allDue = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later];
  assert.ok(allDue.every((x) => !x.others), 'no others in due');
  assert.equal(d.waiting.length, 31, 'all 31 others wait together');
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('<details') || /fold/i.test(src), 'Waiting folds');
});

test('one fixture vault: the rail, heading, Needs you and the brief agree (round 2)', () => {
  // The shared fixture (ns/tests/needs-you.mjs and ns/tests/morning-brief.mjs build the same vault on disk):
  // two live projects owned by Mia Tran, one shelved, and other notes with dated tasks and reminders.
  // Late or due today and own: 2 project steps + 1 dated task + 1 reminder = 4 everywhere.
  const live1 = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by ${iso(-1)}\n- [ ] Ring the landlord — Mia · by ${iso(0)}\n- [ ] Their ovens — Priya · by ${iso(-1)}\n- [ ] Later fit-out — Mia · by ${iso(9)}\n`;
  const live2 = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# IT Shop\n\n## What’s next\n\n- [ ] Patch the server — Mia · by ${iso(5)}\n`;
  const held = `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by ${iso(-4)}\n`;
  const projects = [
    { path: 'Projects/Bakery Launch/Bakery Launch.md', version: 'v1', modified: at(-2), project: P.parseProject(live1, 'Bakery Launch.md') },
    { path: 'Projects/IT Shop/IT Shop.md', version: 'v2', modified: at(-2), project: P.parseProject(live2, 'IT Shop.md') },
    { path: 'Projects/Held Over/Held Over.md', version: 'v3', modified: at(-2), project: P.parseProject(held, 'Held Over.md') },
  ];
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  const projectCount = T.todayDueCount(d);
  assert.equal(projectCount, 2, '2 own project steps late or today (theirs and shelved out)');
  // Due's other notes, as the hub groups them: an own dated task late, an own reminder today, theirs out, future out.
  const other = {
    overdue: [
      { kind: 'task', key: 'a', day: iso(-2), item: { text: `File the BAS due ${iso(-2)}`, words: 'File the BAS' } },
      { kind: 'task', key: 'b', day: iso(-1), item: { text: `Their filing — Priya · by ${iso(-1)}`, words: 'Their filing — Priya' } },
    ],
    today: [{ kind: 'reminder', key: 'c', day: iso(0), item: { text: 'Call the supplier' } }],
  };
  const otherCount = [...other.overdue, ...other.today].filter((e) =>
    T.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.text, 'Mia Tran', TODAY),
  ).length;
  assert.equal(otherCount, 2, '1 own dated task + 1 own reminder (theirs out)');
  assert.equal(projectCount + otherCount, 4, 'the one number is 4: the rail, heading, Needs you and the brief say it');
});

test('round 3: key dates and project dues show in the date list but count nowhere', () => {
  // Steps late, the key date today (its own day, so it lists), the project's own due day late: all listed.
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\ndue: "${iso(-1)}"\n---\n# Dated\n\n## What’s next\n\n- [ ] Late own job — Mia · by ${iso(-1)}\n- [ ] Older own job — Mia · by ${iso(-2)}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${iso(0)} | Tasting day | planned |\n`;
  const projects = [{ path: 'Projects/Dated/Dated.md', version: 'v', modified: at(-1), project: P.parseProject(text, 'Dated.md') }];
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  // They show in the date list: the key date and the project's own due day are listed with the steps.
  assert.ok(d.due.today.some((x) => x.kind === 'date' && x.what === 'Tasting day'), 'the key date lists today');
  assert.ok(d.due.overdue.some((x) => x.kind === 'project'), 'the project due lists late');
  // But the one count is steps (dates are not tasks): 2, not 4.
  assert.equal(T.todayDueCount(d), 2, 'own steps late or today only');
  assert.equal(T.todayDueCount(d.due), 2, 'the due groups count the same');
});

test('round 3: Late, Next, questions, then meetings, then Also; setup and Waiting fold inside', () => {
  // Step 2 reshapes the day (5 Nov 2026 shape kept, three questions first): Late, Next, Waiting on an answer,
  // meetings as their own section, then one Also fold. Setup folds inside (never between the person and their
  // work), waiting folds inside too (never a second fold beside the first). The brief stays below the work,
  // task-free as round 3 holds.
  const src = read('src/renderer/src/views/TodayView.tsx');
  const head = src.indexOf('nv-today-head');
  const late = src.indexOf('data-section="late"');
  const next = src.indexOf('data-section="next"');
  const questions = src.indexOf('<Section id="questions"');
  const meetings = src.indexOf('data-section="meetings"');
  const fold = src.indexOf('data-section="also"');
  const brief = src.indexOf('data-section="brief"');
  const setup = src.indexOf('<SetupLine');
  const waiting = src.indexOf('id="waiting"');
  for (const [name, i] of [['heading', head], ['late', late], ['next', next], ['questions', questions], ['meetings', meetings], ['fold', fold], ['brief', brief], ['setup', setup], ['waiting', waiting]]) assert.ok(i > 0, `${name} is on the page`);
  assert.ok(head < late && late < next && next < questions && questions < meetings, 'Late, Next, questions, then meetings');
  assert.ok(meetings < fold, 'Also follows meetings');
  // Layout round 2: waiting is More for today's (defined before the page, shown only while open); the set-up line
  // sits at the foot of the day, after the fold.
  assert.ok(src.slice(src.indexOf('const moreForToday'), src.indexOf('const near = nearWords')).includes('id="waiting"'), 'waiting folds inside');
  assert.ok(fold < setup, 'setup follows the fold, at the foot');
  assert.ok(src.includes('todayCardBrief') || src.includes('isBriefTask'), 'the Today card filters through the shared brief rule');
});

test('round 3: meetings unbox when empty — no card, the two actions kept on one quiet line', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // 5 Nov 2026, the walk: with no meetings the card held only New meeting and Record a meeting.
  // 2.0.1 (one Meetings card): the day's column always heads with Meetings, so with none it reads its head with
  // New and Record small in it, one quiet line, and the meetings finished with actions still open; never an
  // empty column, never two Meetings blocks.
  assert.ok(src.includes('hubDay.meetings.length > 0 ? <DayAgenda'), 'the timeline shows only with meetings');
  assert.ok(src.includes('<p className="td-none">No meetings today.</p>'), 'without, one quiet line');
  assert.ok(src.includes('<DayMeetingActions day={hubDay}') && src.includes('th-meetings-actions'), 'New and Record small in its head');
  assert.ok(!src.includes('<TodayModules group="waiting"'), 'no second Meetings block');
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(parts.includes('New meeting') && parts.includes('Record a meeting'), 'both actions kept');
});

test('round 3: the Due card keeps own lines only; other people’s dated lines sit under Waiting', () => {
  const card = read('src/renderer/src/views/today/DueCard.tsx');
  assert.ok(card.includes('isOwnText'), 'the Due rows read the one owner reading');
  assert.ok(/me[?:]/.test(card), 'the Due rows know whose lines are theirs');
  assert.ok(!/view\.overdue\.length \+ view\.today\.length/.test(card), 'a Due count is what is listed (own lines), never the unfiltered groups');
  // Round 4: the separate Due list is gone from Today (its rows live in the one list now); other people's lines —
  // dated and undated — sit under Waiting, counted with the steps there.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!src.includes('<DueCard view={due}'), 'no separate Due list on Today');
  assert.ok(/DueOthers|dueOthers/.test(src), 'other people’s lines sit under Waiting');
  assert.ok(!/Waiting on others · \$\{view\.waiting\.length\}/.test(src), 'the Waiting fold counts every line it lists, not only project steps');
});

test('round 3: one fixture vault (old late task, key date, project due, theirs dated): 6 everywhere', () => {
  // The shared fixture (ns/tests/needs-you.mjs and ns/tests/morning-brief.mjs build the same vault on disk):
  // late or due today and own: 2 project steps + 2 dated tasks + 1 old late task + 1 reminder = 6.
  // The key date and the project's own due day list but count nowhere; theirs counts nowhere.
  // Both steps late, the key date today and the project's own due day late: every line lists.
  const live1 = `---\ntype: project\nstatus: active\nowner: Mia Tran\ndue: "${iso(-1)}"\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by ${iso(-1)}\n- [ ] Ring the landlord — Mia · by ${iso(-2)}\n- [ ] Their ovens — Priya · by ${iso(-1)}\n- [ ] Later fit-out — Mia · by ${iso(9)}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${iso(0)} | Tasting day | planned |\n`;
  const live2 = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# IT Shop\n\n## What’s next\n\n- [ ] Patch the server — Mia · by ${iso(5)}\n`;
  const held = `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by ${iso(-4)}\n`;
  const projects = [
    { path: 'Projects/Bakery Launch/Bakery Launch.md', version: 'v1', modified: at(-2), project: P.parseProject(live1, 'Bakery Launch.md') },
    { path: 'Projects/IT Shop/IT Shop.md', version: 'v2', modified: at(-2), project: P.parseProject(live2, 'IT Shop.md') },
    { path: 'Projects/Held Over/Held Over.md', version: 'v3', modified: at(-2), project: P.parseProject(held, 'Held Over.md') },
  ];
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  assert.equal(T.todayDueCount(d), 2, '2 own project steps (key date, project due, theirs and shelved out)');
  assert.ok(d.due.today.some((x) => x.kind === 'date'), 'the key date still lists');
  assert.ok(d.due.overdue.some((x) => x.kind === 'project'), 'the project due still lists');
  // Due's other notes, as the hub groups them: own dated tasks (one of them long late, one an owner tail with the
  // app's 📅 mark), an own reminder today, theirs out, future out. All late counts, however old (round 3: no 7-day
  // window anywhere); the owner reads the words with the day taken out, as dueOwnerText does.
  const other = {
    overdue: [
      { kind: 'task', key: 'a', day: iso(-2), item: { text: `File the BAS due ${iso(-2)}`, words: 'File the BAS' } },
      { kind: 'task', key: 'a-old', day: iso(-50), item: { text: `Old council letter due ${iso(-50)}`, words: 'Old council letter' } },
      { kind: 'task', key: 'b', day: iso(-1), item: { text: `Their filing — Priya · by ${iso(-1)}`, words: 'Their filing — Priya' } },
    ],
    today: [
      { kind: 'reminder', key: 'c', day: iso(0), item: { text: 'Call the supplier' } },
      { kind: 'task', key: 'd', day: iso(0), item: { text: `Send the quote — Mia 📅 ${iso(0)}`, words: 'Send the quote — Mia' } },
    ],
  };
  const otherCount = [...other.overdue, ...other.today].filter((e) =>
    T.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, 'Mia Tran', TODAY),
  ).length;
  assert.equal(otherCount, 4, '3 own dated tasks however late + 1 own reminder (theirs out)');
  assert.equal(T.todayDueCount(d) + otherCount, 6, 'the one number is 6: rail, heading, Needs you and the brief say it');
});

test('round 4: one ranked list — a 7-weeks-late note ranks after fresh work, top five mixed (5 Nov 2026, u3 moving-in: stale never leads)', () => {
  assert.ok(BT, 'brief-tasks.ts exists for the host app and Telegram to call');
  assert.equal(typeof BT.topFiveFor, 'function', 'one function the morning brief calls: topFiveFor');
  const src = read('src/shared/brief-tasks.ts');
  assert.ok(src.includes('rankNextForYou'), 'notes rank through the same rank as steps, never a second rank');
  const d = T.buildToday({ projects: bigVault(), notes: [], me: 'Mia Tran' }, TODAY);
  const steps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later].filter((x) => x.kind === 'step');
  // The reviewer's case: Old council letter 7 weeks late and File the BAS 1 day late, own note lines.
  const entries = [
    { kind: 'task', key: 'N.md\nOld council letter', day: iso(-49), item: { key: 'N.md\nOld council letter', path: 'Notes/N.md', title: 'N', line: 3, text: `Old council letter due ${iso(-49)}`, words: 'Old council letter', due: iso(-49) } },
    { kind: 'task', key: 'N.md\nFile the BAS', day: iso(-1), item: { key: 'N.md\nFile the BAS', path: 'Notes/N.md', title: 'N', line: 5, text: `File the BAS due ${iso(-1)}`, words: 'File the BAS', due: iso(-1) } },
    { kind: 'reminder', key: 'R.md\nCall the supplier', day: iso(0), item: { key: 'R.md\nCall the supplier', path: 'Reminders.md', title: 'Reminders', line: 1, text: 'Call the supplier', due: TODAY.getTime(), timeGiven: false, repeat: null, done: false } },
  ];
  const five = BT.topFiveFor(steps, entries, TODAY, 5);
  assert.equal(five.length, 5, 'at most five');
  const words = five.map((w) => (w.kind === 'note' ? (w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text) : w.step.what));
  assert.ok(!words.includes('Old council letter'), 'the 7-weeks-late note is stale: fresh work answers first');
  assert.ok(five.some((w) => w.kind === 'step'), 'project steps still rank in');
  // The 1-day-late note ranks with the steps by its day (ahead of today's steps, behind older late ones).
  const all = BT.rankAllFor(steps, entries, TODAY);
  const wordsAll = all.map((w) => (w.kind === 'note' ? (w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text) : w.step.what));
  assert.ok(wordsAll.includes('Old council letter'), 'the stale note stays in the one list: nothing vanishes');
  assert.equal(wordsAll[wordsAll.length - 1], 'Old council letter', 'stale ranks last, never leading');
  assert.ok(wordsAll.includes('File the BAS'), 'the 1-day-late note ranks in the one list');
  const off = (w) => (w.kind === 'step' ? w.step.offset : w.offset);
  assert.ok(wordsAll.indexOf('File the BAS') < all.findIndex((w) => off(w) === 0), 'it ranks before today’s steps');
  assert.ok(wordsAll.includes('Call the supplier'), 'a reminder ranks in the one list too');
});

test('round 4: Later kept, the fold groups Late Today This week Later No date, Due gone, All tasks on the fold', () => {
  const g = HUB.groupDue(
    [{ key: 'T.md\nEight days', path: 'T.md', title: 'T', line: 0, text: 'Eight days', words: 'Eight days', due: iso(8) }],
    [],
    TODAY.getTime(),
  );
  assert.ok(Array.isArray(g.later), 'Due keeps Later past the next 7 days');
  assert.deepEqual(g.later.map((e) => e.item.words), ['Eight days']);
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!src.includes('<DueCard view={due}'), 'the separate Due list is gone from Today');
  assert.ok(src.includes('topFiveFor') || src.includes('rankAllFor') || src.includes('brief-tasks'), 'Today ranks steps and notes as one list');
  // One task name (5 Nov 2026, rest-quieten: the fold's Overdue/Next 7 days renamed Tasks' Late/This week),
  // with the stale fold kept (5 Nov 2026, u3 moving-in: old lines fold into a quiet group that never leads).
  for (const h of ['Late', 'Today', 'This week', 'Later', 'From a while back', 'No date']) assert.ok(src.includes(h), `the fold groups ${h}`);
  assert.ok(!src.includes('Overdue <span>') && !src.includes('Next 7 days <span>'), 'no renamed heads left');
  assert.ok(src.includes('All tasks'), 'the All tasks link stays, on Also’s head');
  // Step 2: one Also section, opening the full list.
  assert.ok(src.includes('data-section="also"'), 'one Also section');
});

test('round 4: tick writes the right note — a project step and a note’s line', async () => {
  const d = T.buildToday({ projects: bigVault(), notes: [], me: 'Mia Tran' }, TODAY);
  const first = T.rankNextForYou([...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later])[0];
  const proj = bigVault().find((x) => x.path === first.project).project;
  T.applyProjectEdit(proj, { kind: 'change', list: 'next', index: first.index, item: { done: true } });
  assert.ok(proj.next[first.index].done, 'the step ticks done in its project file');
  // A note's line ticks through the note's own write, in the right note.
  const index = new HUB.VaultIndex();
  index.set('Notes/N.md', `## Jobs\n- [ ] File the BAS due ${iso(-1)}\n- [ ] Keep this open\n`, at(-1), 60);
  const writes = [];
  const hub = new HUB.Hub({
    index,
    dailyPath: (dt) => `Daily/${HUB.isoOf(dt)}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => [],
    write: async (rel, text) => {
      writes.push([rel, text]);
      index.set(rel, text, at(0), text.length);
    },
    startDay: async (dt) => `Daily/${HUB.isoOf(dt)}.md`,
    now: () => TODAY.getTime(),
  });
  assert.ok(BT, 'brief-tasks.ts exists for the unified tick');
  const tasks = hub.tasks();
  assert.ok(tasks.some((t) => t.words === 'File the BAS'), 'the hub reads the note’s line');
  const line = tasks.find((t) => t.words === 'File the BAS');
  assert.equal(await hub.tick(line.path, line.line, line.text, true), 'Done.');
  assert.equal(writes[0][0], 'Notes/N.md', 'the right note is written');
  assert.ok(writes[0][1].includes('- [x] File the BAS'), 'its box ticks');
  assert.ok(writes[0][1].includes('- [ ] Keep this open'), 'the other line stays open');
});

test('round 4: same number everywhere still holds on the round-3 fixture (6)', () => {
  const live1 = `---\ntype: project\nstatus: active\nowner: Mia Tran\ndue: "${iso(-1)}"\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by ${iso(-1)}\n- [ ] Ring the landlord — Mia · by ${iso(-2)}\n- [ ] Their ovens — Priya · by ${iso(-1)}\n- [ ] Later fit-out — Mia · by ${iso(9)}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${iso(0)} | Tasting day | planned |\n`;
  const live2 = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# IT Shop\n\n## What’s next\n\n- [ ] Patch the server — Mia · by ${iso(5)}\n`;
  const held = `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by ${iso(-4)}\n`;
  const projects = [
    { path: 'Projects/Bakery Launch/Bakery Launch.md', version: 'v1', modified: at(-2), project: P.parseProject(live1, 'Bakery Launch.md') },
    { path: 'Projects/IT Shop/IT Shop.md', version: 'v2', modified: at(-2), project: P.parseProject(live2, 'IT Shop.md') },
    { path: 'Projects/Held Over/Held Over.md', version: 'v3', modified: at(-2), project: P.parseProject(held, 'Held Over.md') },
  ];
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  const other = {
    overdue: [
      { kind: 'task', key: 'a', day: iso(-2), item: { text: `File the BAS due ${iso(-2)}`, words: 'File the BAS' } },
      { kind: 'task', key: 'a-old', day: iso(-50), item: { text: `Old council letter due ${iso(-50)}`, words: 'Old council letter' } },
      { kind: 'task', key: 'b', day: iso(-1), item: { text: `Their filing — Priya · by ${iso(-1)}`, words: 'Their filing — Priya' } },
    ],
    today: [
      { kind: 'reminder', key: 'c', day: iso(0), item: { text: 'Call the supplier' } },
      { kind: 'task', key: 'd', day: iso(0), item: { text: `Send the quote — Mia 📅 ${iso(0)}`, words: 'Send the quote — Mia' } },
    ],
  };
  const otherCount = [...other.overdue, ...other.today].filter((e) =>
    T.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, 'Mia Tran', TODAY),
  ).length;
  assert.equal(T.todayDueCount(d) + otherCount, 6, 'rail, heading, Needs you and the brief still say 6');
});

test('no owner and no date never counts as late', () => {
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Bare\n\n## What’s next\n\n- [ ] Just a thought\n- [ ] Dated but ownerless · by ${iso(-3)}\n- [ ] Owned but dateless — Mia\n`;
  const projects = [{ path: 'Projects/Bare/Bare.md', version: 'v', modified: at(-1), project: P.parseProject(text, 'Bare.md') }];
  const d = T.buildToday({ projects, notes: [], me: 'Mia Tran' }, TODAY);
  assert.ok(![...d.due.overdue, ...d.due.today].some((x) => x.what === 'Just a thought'), 'bare item is never late or today');
  assert.ok(d.unscheduled.some((x) => x.what === 'Just a thought'), 'it waits to be scheduled');
});

// A date in an owner tail is never a person (p16-owner-tail, 4 Nov 2026): "— me — due 2026-11-06" read its owner as
// "me — due 2026-11-06", so an own task fell out of Needs you and the counts.
test('an owner tail with a date reads as its owner', () => {
  assert.ok(T.isOwnText('File the return — me — due 2026-11-06', 'Mia Tran', TODAY), 'me with a date tail is theirs');
  assert.ok(T.isOwnText('File the return — me, due 2026-11-06', 'Mia Tran', TODAY), 'me with a comma date tail is theirs');
  assert.ok(T.isOwnText('File the return — Mia Tran — due 2026-11-06', 'Mia Tran', TODAY), 'their name with a date tail is theirs');
  assert.ok(!T.isOwnText('Their job — Priya Nair — due 2026-11-06', 'Mia Tran', TODAY), 'another name with a date tail is not');
  assert.ok(T.isOwnText('Call — due 2026-11-06', 'Mia Tran', TODAY), 'a date alone is no one');
});
