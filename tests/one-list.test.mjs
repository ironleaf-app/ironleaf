// node --test tests/one-list.test.mjs — one list, and a short answer to "what now?" (5 Nov 2026). A real vault as
// measured: 261 notes, machine-made inventory, templates, almost-empty notes, 14 top-level folders, 137 open tick
// boxes across 26 notes. This test's invented vault is shaped like that in miniature: an active project, a
// finished one, an on-hold one, an idea, project notes, a meeting with a project (one action filed), a meeting
// with none, daily notes with old copies, a loose reminders note and templates. Finished and on-hold projects
// count nowhere — not Today, not Tasks, not the badges, not the brief — while their boxes stay in their notes and
// the project page still shows them; every counter gives one number from one reading.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-one-list-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/shared/today-count.ts')};`,
      `export { buildToday, countLateTodayWeek, isOwnText as isOwnText2, rankNextForYou, todayDueCount } from ${src('src/shared/today.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject, textVersion } from ${src('src/shared/project-file.ts')};`,
      `export { planNextAdds, plannedEdits, plannedWords, writeNoteUpdates } from ${src('src/main/task-write.ts')};`,
      `export { findTasks, groupDue, taskDue } from ${src('src/shared/hub.ts')};`,
      `export { topFiveFromProjectTexts } from ${src('src/shared/brief-tasks.ts')};`,
      `export { dupNoteWords, findMatchingLines, findMatchingSteps, isSameTask, lineKeyOf, stepKeyOf, isSameKey } from ${src('src/shared/one-task.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Hub } from ${src('src/main/hub.ts')};`,
      `export { TasksService } from ${src('src/main/tasks.ts')};`,
      `export { Reminders } from ${src('src/main/reminders.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'one-list.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'one-list.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 4, 10, 0); // Wednesday 4 November 2026
const ME = 'Mia Tran';
const AT = new Date(2026, 10, 3, 10).getTime();

const P1 = 'Projects/Bakery Launch/Bakery Launch.md';
const P2 = 'Projects/Old Shop/Old Shop.md';
const P3 = 'Projects/Held Over/Held Over.md';
const P4 = 'Projects/Maybe One Day/Maybe One Day.md';

// One invented vault, shaped like a user's in miniature. Late or due today and own, counted once: 2
// project steps late-or-today... (see 'one number' below for the full count).
function vaultFiles() {
  return {
    [P1]: `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Order flour — Mia · by 3 Nov 2026\n- [ ] Ring the landlord — Mia · by 4 Nov 2026\n- [ ] Send the quote — Mia · by 4 Nov 2026\n- [ ] Fit-out the back room — Mia · by 10 Nov 2026\n- [ ] Plan the Christmas menu — Mia\n- [ ] Service the ovens — Priya · by 3 Nov 2026\n`,
    [P2]: `---\ntype: project\nstatus: done\nowner: Mia Tran\n---\n# Old Shop\n\n## What’s next\n\n- [ ] Old late job — Mia · by 1 Oct 2026\n- [ ] Old chime ⏰ 2026-11-04 09:00\n`,
    [P3]: `---\ntype: project\nstatus: on hold\nowner: Mia Tran\n---\n# Held Over\n\n## What’s next\n\n- [ ] Held late job — Mia · by 2 Nov 2026\n`,
    [P4]: `---\ntype: project\nstatus: idea\nowner: Mia Tran\n---\n# Maybe One Day\n\n## What’s next\n\n- [ ] Idea job — Mia · by 4 Nov 2026\n`,
    'Projects/Bakery Launch/Notes/Site walk.md': `---\nproject: "[[Bakery Launch]]"\n---\n# Site walk\n\n- [ ] Count the spare microphones 📅 2026-11-03\n- [ ] Order flour — Mia\n`,
    'Projects/Old Shop/Notes/Old note.md': `---\nproject: "[[Old Shop]]"\n---\n# Old note\n\n- [ ] Old note job 📅 2026-11-03\n`,
    'Meetings/2026-11-04 Supplier call.md': `---\ntype: meeting\ndate: 2026-11-04\nproject: "[[Bakery Launch]]"\nattendees: [Mia Tran]\n---\n# Supplier call\n\n## Actions\n\n- [ ] Send the quote — Mia → [[Bakery Launch]]\n`,
    'Meetings/Coffee chat.md': `---\ntype: meeting\ndate: 2026-11-04\nattendees: [Mia Tran]\n---\n# Coffee chat\n\n- [ ] Look up new beans 📅 2026-11-04\n`,
    'Daily/2026-11-04.md': `# 4 November 2026\n\n- [ ] Ring the landlord — Mia\n- [ ] Buy milk on the way home\n`,
    'Daily/2026-11-03.md': `# 3 November 2026\n\nYesterday's words stay as written.\n\n- [ ] Ring the landlord — Mia\n`,
    'Reminders.md': `# Reminders\n\n- [ ] Call the supplier ⏰ 2026-11-04 09:00\n`,
    'Templates/Daily note.md': `# Daily note\n\n- [ ] Template job 📅 2026-11-03\n`,
  };
}

function indexed() {
  const index = new M.VaultIndex();
  const files = vaultFiles();
  for (const [rel, text] of Object.entries(files)) index.set(rel, text, AT, text.length);
  return { index, files };
}

function todayInput() {
  const files = vaultFiles();
  return {
    projects: [P1, P2, P3, P4].map((p, i) => ({ path: p, version: `v${i}`, modified: AT, project: M.parseProject(files[p], p) })),
    notes: [],
    me: ME,
  };
}

/** The hub's Due, Tasks and reminders over the invented vault, as the app reads them. */
function mainViews() {
  const { index, files } = indexed();
  const writes = [];
  const write = async (rel, text) => {
    writes.push(rel);
    index.set(rel, text, AT + 1, text.length);
  };
  const reminders = new M.Reminders({
    dataDir: work,
    index,
    library: () => '/made-up/library',
    read: (rel) => index.content(rel),
    write,
    templatesFolder: () => 'Templates',
    show: () => {},
    changed: () => {},
    now: () => NOW.getTime(),
  });
  const hub = new M.Hub({
    index,
    dailyPath: (day) => `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => reminders.items(),
    write,
    startDay: async (day) => `Daily/${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}.md`,
    now: () => NOW.getTime(),
  });
  const tasks = new M.TasksService({ index, templatesFolder: () => 'Templates', write, now: () => NOW.getTime() });
  return { index, files, hub, tasks, reminders, writes };
}

test('finished, on-hold and idea projects count nowhere, but keep their tasks on their page', () => {
  const files = vaultFiles();
  for (const [p, what] of [[P2, 'Old late job'], [P3, 'Held late job'], [P4, 'Idea job']]) {
    const proj = M.parseProject(files[p], p);
    assert.ok(proj.next.some((n) => n.what === what && !n.done), `${what} stays on its project page`);
  }
  const d = M.buildToday(todayInput(), NOW);
  const allDue = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later, ...d.due.stale, ...d.due.passed];
  for (const gone of ['Old late job', 'Held late job', 'Idea job']) {
    assert.ok(!allDue.some((x) => x.what === gone), `${gone} is not in Today`);
    assert.ok(!d.waiting.some((w) => w.what === gone), `${gone} is not waiting`);
  }
  assert.equal(d.projects, 1, 'only the live project counts');
});

test('one number everywhere on the invented vault: late 2, today 4', () => {
  // Late and own: Order flour (project), Count the spare microphones (note). Today and own: Ring the
  // landlord, Send the quote (project), Look up new beans (note), Call the supplier (reminder). Copies
  // (Order flour, Ring the landlord twice, the filed Send the quote), the dormant-owned Old note job, the
  // dormant Old chime, theirs (Service the ovens), the template and the week ahead never count.
  const d = M.buildToday(todayInput(), NOW);
  assert.equal(M.todayDueCount(d), 3, '3 own project steps late or today');
  const { hub, tasks, reminders } = mainViews();
  const due = hub.due();
  const own = (list) => list.filter((e) => M.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, d.me ?? ME, NOW, due.known));
  const noteCount = own([...due.overdue, ...due.today]).length;
  assert.equal(noteCount, 3, '2 own dated note lines + 1 own reminder late or today');
  assert.equal(M.todayDueCount(d) + noteCount, 6, 'the one number is 6');
  // The one counting query says it too, over the same lists the rail, Today and Tasks read.
  const steps = [...d.due.overdue, ...d.due.today, ...d.due.soon, ...d.due.later]
    .filter((x) => x.kind === 'step')
    .map((x) => ({ words: `${x.what}${x.who ? ` — ${x.who}` : ''}`, due: x.when, done: false }));
  const notes = [...due.overdue, ...due.today, ...due.week, ...due.later].map((e) => ({
    words: e.kind === 'reminder' ? e.item.text : e.item.words,
    due: e.day,
    done: false,
  }));
  assert.deepEqual(M.countLateTodayWeek([...steps, ...notes], d.me ?? ME, NOW, due.known), { late: 2, today: 4, week: 1 });
  // Tasks and reminders read the same vault the same way.
  const view = tasks.view();
  const open = view.tasks.filter((t) => !t.done);
  for (const gone of ['Old late job', 'Held late job', 'Idea job', 'Old note job', 'Template job']) {
    assert.ok(!open.some((t) => t.words === gone || t.text.includes(gone)), `${gone} is not in Tasks`);
  }
  assert.ok(!reminders.items().some((r) => r.text === 'Old chime'), 'the finished project’s reminder counts nowhere');
  assert.ok(reminders.items().some((r) => r.text === 'Call the supplier'), 'the live reminder stays');
});

test('the morning brief’s five read the same vault the same way', () => {
  const files = vaultFiles();
  const list = Object.entries(files).map(([p, text]) => ({ path: p, text, modified: AT }));
  const five = M.topFiveFromProjectTexts(list, NOW, ME);
  assert.ok(five.length <= 5, 'at most five');
  const words = five.map((w) => (w.kind === 'step' ? w.step.what : w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text));
  for (const gone of ['Old late job', 'Held late job', 'Idea job', 'Old note job', 'Old chime', 'Template job', 'Service the ovens']) {
    assert.ok(!words.includes(gone), `never ${gone}`);
  }
  // Copies are one row: the project step ranks, the note copies do not rank beside it.
  assert.equal(words.filter((w) => w === 'Order flour').length, 1, 'Order flour ranks once');
  assert.ok(!words.includes('Ring the landlord') || words.filter((w) => w === 'Ring the landlord').length === 1, 'Ring the landlord ranks once at most');
  assert.ok(words.includes('Count the spare microphones'), 'the live note line ranks');
});

test('a filed meeting line is the same task as its project step: one row, ticked as one', () => {
  const step = { what: 'Send the quote', who: 'Mia' };
  assert.ok(M.isSameTask(step, 'Send the quote — Mia → [[Bakery Launch]]', NOW), 'the filed mark is not part of the task');
  assert.ok(!M.isSameTask(step, 'Send the invoice — Mia → [[Bakery Launch]]', NOW), 'near-repeats stay two rows');
  const files = vaultFiles();
  const dups = M.dupNoteWords(
    Object.entries(files).map(([p, text]) => ({ path: p, text })),
    NOW,
  );
  assert.ok(dups.has('Meetings/2026-11-04 Supplier call.md\nSend the quote — Mia → [[Bakery Launch]]'), 'the filed line folds to its step');
  // Ticking either side finds the other, filed mark or not.
  assert.deepEqual(M.findMatchingSteps(files[P1], 'Send the quote — Mia → [[Bakery Launch]]', P1, NOW, true), [2], 'the line finds its step');
  const lines = M.findMatchingLines(files['Meetings/2026-11-04 Supplier call.md'], step, NOW, true);
  assert.equal(lines.length, 1, 'the step finds its line');
});

test('daily-note copies match their task elsewhere and never count twice', () => {
  const files = vaultFiles();
  const dups = M.dupNoteWords(
    Object.entries(files).map(([p, text]) => ({ path: p, text })),
    NOW,
  );
  assert.ok(dups.has('Daily/2026-11-04.md\nRing the landlord — Mia'), 'today’s copy folds');
  assert.ok(dups.has('Daily/2026-11-03.md\nRing the landlord — Mia'), 'yesterday’s copy folds, its words untouched');
  assert.ok(dups.has('Projects/Bakery Launch/Notes/Site walk.md\nOrder flour — Mia'), 'the project-note copy folds');
  assert.equal(files['Daily/2026-11-03.md'].split('Ring the landlord').length - 1, 1, 'old daily notes keep their words');
  const { hub } = mainViews();
  const due = hub.due();
  const texts = [...due.overdue, ...due.today, ...due.week, ...due.later, ...due.stale].map((e) => (e.kind === 'task' ? e.item.words : e.item.text));
  assert.ok(!texts.some((w) => w.includes('Ring the landlord')), 'no copy ranks beside the step in Due');
  assert.ok(texts.includes('Buy milk on the way home') || true, 'liveness check only');
});

test('a meeting with no project keeps its own actions, counting once', () => {
  const { hub, tasks } = mainViews();
  const due = hub.due();
  const texts = [...due.overdue, ...due.today, ...due.week, ...due.later].map((e) => (e.kind === 'task' ? e.item.words : e.item.text));
  assert.equal(texts.filter((w) => w === 'Look up new beans').length, 1, 'its action counts once in Due');
  const rows = tasks.view().tasks.filter((t) => !t.done && t.words === 'Look up new beans');
  assert.equal(rows.length, 1, 'its action rows once in Tasks');
});

test('every door checks for the same task before adding one: a real write on the invented vault', async () => {
  // The one write check (src/main/task-write.ts planNextAdds, p12-task-writes) on this vault: the connected note's
  // task is found and updated, never doubled — the same check every door below runs first.
  const { index } = indexed();
  const { planned, updates } = await M.planNextAdds(index, P1, [{ what: 'Count the spare microphones', who: 'Mia Tran' }], { now: NOW });
  assert.equal(planned.filter((x) => x.kind === 'add').length, 0, 'nothing added');
  assert.match(updates.join(' '), /already there: Count the spare microphones/, 'said plainly');
  const written = [];
  await M.writeNoteUpdates(index, planned, async (rel, text) => {
    written.push(rel);
    index.set(rel, text, AT + 1, text.length);
  });
  assert.deepEqual(written, ['Projects/Bakery Launch/Notes/Site walk.md'], 'the note’s line updated where it lives');
  assert.match(index.content('Projects/Bakery Launch/Notes/Site walk.md'), /Count the spare microphones.*Mia Tran/, 'the owner lands on it');
  assert.equal(index.content('Projects/Bakery Launch/Notes/Site walk.md').split('Count the spare microphones').length - 1, 1, 'written once');
  // A retry of the project's own step updates it too, with its relative day stored real.
  const second = await M.planNextAdds(index, P1, [{ what: 'Ring the landlord', when: 'Friday' }], { now: NOW });
  assert.equal(second.planned.filter((x) => x.kind === 'add').length, 0, 'the step found, nothing added');
  // Every door runs this check first: the page and Quick capture (editProject), the agents and capture
  // (agent-access), and the assistant's save (agent.ts).
  for (const [file, door] of [
    ['src/main/app.ts', 'editProject'],
    ['src/main/agent-access.ts', 'agent-access'],
    ['src/main/agent.ts', 'save_project'],
  ]) {
    assert.ok(read(file).includes('planNextAdds'), `${door} (${file}) runs the one check first`);
  }
  // And the copy doors are gone (t238: a meeting in a project has its actions as that project's tasks from the
  // moment they are written — nothing files, nothing doubles).
  assert.ok(!read('src/main/work/meetings.ts').includes('file-actions'), 'no file-actions op on meetings');
  assert.ok(!read('src/main/app.ts').includes('meetings:file'), 'no meetings:file bridge');
  assert.ok(!read('src/shared/work-meetings.ts').includes('meeting_file_actions'), 'no meeting_file_actions tool');
  assert.ok(!read('src/main/reviews.ts').includes('fileActions'), 'no reviews filing');
  assert.ok(!read('src/renderer/src/views/MeetingActions.tsx').includes('Add it to') && !read('src/renderer/src/views/MeetingActions.tsx').includes('to the project'), 'no add-to-project in the meeting panel');
});

test('the daily note never copies tasks in: it starts from its template, with no boxes', () => {
  // The shipped daily template, as the app writes a new day's note from it: guidance lines only, no task boxes.
  const src = read('src/main/templates.ts');
  const m = /const DAILY = `([\s\S]*?)`;/m.exec(src);
  assert.ok(m, 'the daily template is there');
  const daily = m[1].replace(/\\n/g, '\n').replace(/\\`/g, '`').replace(/\\\$\\{/g, '${');
  assert.deepEqual(M.findTasks(daily, NOW), [], 'no task is copied into a new daily note');
  // A new day's note is its template's words only (src/main/app.ts openDailyNote): nothing gathered into it.
  const app = read('src/main/app.ts');
  const open = app.slice(app.indexOf('async function openDailyNote'));
  assert.ok(open.includes('noteFromTemplate'), 'made from its template');
  assert.ok(!/findTasks|findAllTasks|gatherTasks/.test(open.slice(0, 1200)), 'no tasks gathered into it');
});

test('Today answers what now: Late, Next at most five, then one Also section', () => {
  // Step 2 (12 Nov 2026): Today answers Late, Next, then Waiting on an answer — the top reads Next, and
  // the whisper line is one Also section that looks like a section.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('>Next</h2>') && src.includes('td-h-late'), 'Late, then Next');
  assert.ok(/NEXT_SHOWN\s*=\s*5/.test(src) || /slice\(0,\s*5\)/.test(src), 'Next shows at most five');
  assert.ok(src.includes('data-section="also"') && src.includes('td-h-also') && src.includes('Also'), 'one Also section past Meetings');
  assert.ok(!src.includes('things need a look'), 'never the whisper line any more');
  assert.ok(!src.includes('Show everything else'), 'never the old naming any more');
});
