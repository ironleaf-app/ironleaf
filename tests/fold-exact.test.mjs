// node --test tests/fold-exact.test.mjs — one task, one row, never one task swallowed (b6 break job, Nov 2026:
// the one list folds a note of no project against every live project's steps — "Call Priya" and "Call Priya about
// the invoice" must stay two rows, two people's same words stay two rows, and the same words on two projects row
// on both while their daily copy folds). An invented vault: Mia's bakery and kiosk share the words "Order flour",
// a daily note holds near-misses and copies, and a finished shop's old copy rows quietly on its own. The walks and
// the vault also attribute the same notes to the same projects: by title, file name, folder name and aliases alike,
// so an alias-linked note outside its project's folder counts nowhere in one and everywhere in the other never again.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-fold-exact-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as oneTask from ${src('src/shared/one-task.ts')};`,
      `export { topFiveFromProjectTexts } from ${src('src/shared/brief-tasks.ts')};`,
      `export { parseProject } from ${src('src/shared/project-file.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Hub } from ${src('src/main/hub.ts')};`,
      `export { TasksService } from ${src('src/main/tasks.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'fold.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'fold.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 4, 10, 0); // Wednesday 4 November 2026
const AT = new Date(2026, 10, 3, 10).getTime();
const P1 = 'Projects/Bakery Launch/Bakery Launch.md';
const P2 = 'Projects/Harbour Kiosk/Harbour Kiosk.md';
const P3 = 'Projects/Old Shop/Old Shop.md';
const P4 = 'Projects/EW/Kiosk.md';

function vaultFiles() {
  return {
    [P1]: `---\ntype: project\nstatus: active\nowner: Mia Tran\naliases: [The Bakery]\n---\n# Bakery Launch\n\n## What’s next\n\n- [ ] Call Priya — Mia · by 4 Nov 2026\n- [ ] Order flour — Mia · by 3 Nov 2026\n`,
    [P2]: `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Harbour Kiosk\n\n## What’s next\n\n- [ ] Order flour — Alex · by 4 Nov 2026\n`,
    [P3]: `---\ntype: project\nstatus: done\nowner: Mia Tran\n---\n# Old Shop\n\n## What’s next\n\n- [ ] File the old permit — Mia · by 1 Oct 2026\n`,
    [P4]: `---\ntype: project\nstatus: done\nowner: Mia Tran\naliases: [The Kiosk]\n---\n# Harbour Kiosk\n\n## What’s next\n\n- [ ] Count the old stock — Mia · by 1 Oct 2026\n`,
    'Daily/2026-11-04.md': `# 4 November 2026\n\n- [ ] Call Priya about the invoice 📅 2026-11-04\n- [ ] Order flour — Mia 📅 2026-11-04\n- [ ] File the old permit 📅 2026-10-20\n- [ ] Call Priya — Alex 📅 2026-11-04\n`,
    'Daily/2026-11-03.md': `# 3 November 2026\n\n- [ ] Call Priya — Mia Tran 📅 2026-11-03\n`,
    'Meetings/2026-11-04 Kiosk call.md': `---\nproject: "[[The Kiosk]]"\n---\n# Kiosk call\n\n- [ ] Chase the old invoice 📅 2026-11-03\n`,
    'Meetings/2026-11-04 EW call.md': `---\nproject: "[[EW]]"\n---\n# EW call\n\n- [ ] Chase the older invoice 📅 2026-11-03\n`,
    'Meetings/2026-11-04 Bread call.md': `---\nproject: "[[The Bakery]]"\n---\n# Bread call\n\n- [ ] Order flour — Alex 📅 2026-11-04\n`,
  };
}

function mainViews() {
  const index = new M.VaultIndex();
  const files = vaultFiles();
  for (const [rel, text] of Object.entries(files)) index.set(rel, text, AT, text.length);
  const write = async (rel, text) => index.set(rel, text, AT + 1, text.length);
  const hub = new M.Hub({
    index,
    dailyPath: (day) => `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => [],
    write,
    startDay: async (day) => `Daily/${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}.md`,
    now: () => NOW.getTime(),
  });
  const tasks = new M.TasksService({ index, templatesFolder: () => 'Templates', write, now: () => NOW.getTime() });
  return { index, hub, tasks };
}

const walkFiles = () => Object.entries(vaultFiles()).map(([p, text]) => ({ path: p, text }));

test('near words are not the same task: "Call Priya" and "Call Priya about the invoice" stay two rows', () => {
  const step = { what: 'Call Priya', who: 'Mia' };
  assert.ok(!M.oneTask.isSameTask(step, 'Call Priya about the invoice', NOW), 'more words is a different job');
  assert.ok(!M.oneTask.isSameTask(step, 'Call Priya — Alex', NOW), 'another person’s same words are another job');
  assert.ok(M.oneTask.isSameTask(step, 'Call Priya — Mia Tran', NOW), 'the same person written fuller is the same job');
  const dups = M.oneTask.dupNoteWords(walkFiles(), NOW);
  assert.ok(!dups.has('Daily/2026-11-04.md\nCall Priya about the invoice'), 'the near-miss never folds');
  assert.ok(!dups.has('Daily/2026-11-04.md\nCall Priya — Alex'), 'Alex’s never folds into Mia’s step');
  assert.ok(dups.has('Daily/2026-11-03.md\nCall Priya — Mia Tran'), 'Mia Tran’s folds into Mia’s step');
  const { hub } = mainViews();
  const due = hub.due();
  const texts = [...due.overdue, ...due.today, ...due.week, ...due.later].map((e) => (e.kind === 'task' ? e.item.words : e.item.text));
  assert.ok(texts.includes('Call Priya about the invoice'), 'the near-miss rows in Due');
  assert.ok(texts.includes('Call Priya — Alex'), 'Alex’s rows in Due');
  assert.ok(!texts.includes('Call Priya — Mia Tran'), 'the copy stays out: the step is the row');
});

test('the same words on two projects row on both, while their daily copy folds', () => {
  const dups = M.oneTask.dupNoteWords(walkFiles(), NOW);
  assert.ok(dups.has('Daily/2026-11-04.md\nOrder flour — Mia'), 'the daily copy folds against the live steps');
  const { tasks } = mainViews();
  const open = tasks.view().tasks.filter((t) => !t.done);
  const flour = open.filter((t) => t.words.startsWith('Order flour'));
  const steps = flour.filter((t) => t.path === t.project);
  assert.equal(steps.length, 2, 'both projects’ steps row: same words, two jobs');
  assert.deepEqual(
    steps.map((t) => t.project).sort(),
    [P1, P2].sort(),
    'one row per project',
  );
  assert.ok(!flour.some((t) => t.path.startsWith('Daily/')), 'the daily copy rows nowhere itself');
});

test('a daily copy of a finished step still rows, quietly, on its own', () => {
  const { hub, tasks } = mainViews();
  const due = hub.due();
  const texts = [...due.overdue, ...due.today, ...due.week, ...due.later, ...(due.stale ?? [])].map((e) => (e.kind === 'task' ? e.item.words : e.item.text));
  assert.ok(texts.includes('File the old permit'), 'the finished step hides, but its live copy is an open box a person wrote: it rows');
  const rows = tasks.view().tasks.filter((t) => !t.done && t.words === 'File the old permit');
  assert.equal(rows.length, 1, 'once, as itself');
});

test('an alias- or folder-linked note outside its dormant project’s folder counts nowhere, in every reading', () => {
  const skip = M.oneTask.dormantNotePaths(walkFiles());
  assert.ok(skip.has(P4), 'the finished project file itself');
  assert.ok(skip.has('Meetings/2026-11-04 Kiosk call.md'), 'linked by its alias, outside its folder: skipped');
  assert.ok(skip.has('Meetings/2026-11-04 EW call.md'), 'linked by its folder’s name: skipped');
  const { hub, tasks } = mainViews();
  const due = hub.due();
  const texts = [...due.overdue, ...due.today, ...due.week, ...due.later, ...(due.stale ?? [])].map((e) => (e.kind === 'task' ? e.item.words : e.item.text));
  for (const quiet of ['Chase the old invoice', 'Chase the older invoice']) {
    assert.ok(!texts.includes(quiet), `${quiet} is out of Due`);
  }
  const rows = tasks.view().tasks.filter((t) => !t.done).map((t) => t.words);
  assert.ok(!rows.includes('Chase the old invoice') && !rows.includes('Chase the older invoice'), 'out of Tasks too');
  const files = walkFiles().map((f) => ({ ...f, modified: AT }));
  const five = M.topFiveFromProjectTexts(files, NOW, 'Mia Tran');
  const words = five.map((w) => (w.kind === 'step' ? w.step.what : w.entry.kind === 'task' ? w.entry.item.words : w.entry.item.text));
  assert.ok(!words.includes('Chase the old invoice') && !words.includes('Chase the older invoice'), 'out of the five as well');
});

test('an alias-linked note folds against its own live project only, never another’s', () => {
  const dups = M.oneTask.dupNoteWords(walkFiles(), NOW);
  assert.ok(!dups.has('Meetings/2026-11-04 Bread call.md\nOrder flour — Alex'), 'The Bakery owns it, and The Bakery holds no such step: it rows');
  const { tasks } = mainViews();
  const rows = tasks.view().tasks.filter((t) => !t.done && t.words === 'Order flour — Alex');
  assert.deepEqual(
    rows.map((t) => t.path).sort(),
    [P2, 'Meetings/2026-11-04 Bread call.md'].sort(),
    'the vault rows it too: the kiosk’s step and the bakery’s line stay two rows',
  );
});
