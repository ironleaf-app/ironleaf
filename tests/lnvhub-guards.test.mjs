// node --test tests/lnvhub-guards.test.mjs — guards for the nv-hub audit's renderer fixes (Nov 2026): Today counts
// Due in its head, the board's Undo walks the whole move back, opening at a due/start date lands on it, the
// portfolio timeline refreshes, key-date tone reads whole words, the side chat files the right answer, the
// day's note keeps late keystrokes, Stop settles ticked-sources asks, and the dead views stay gone. Source guards
// in the uplift-92-guards tradition: behaviour React tests can't reach in node.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('Today’s head counts Due with the projects (welcome, all-clear, the one count)', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // 5 Nov 2026, one rule (the audit found 13 versus 33 for the same thing): the project steps plus the
  // own hub lines the list shows, through dayShapeCounts — Due counted with the projects, never beside them.
  // No figures line any more (one sentence says the day), and no separate week figure (today-day-shape guards
  // that too).
  assert.ok(src.includes('ownNoteDated'), 'Due’s own dated lines feed the one count');
  assert.ok(src.includes('dayShapeCounts(projectSteps, ownNoteDated.map((e) => e.day), now)'), 'steps plus Due through the one rule');
  assert.ok(src.includes('dueLaterOwn === 0') && src.includes('undatedOwn.length === 0') && src.includes('dueOthersCount === 0'), 'Due’s later, undated and others’ lines keep “Nothing on you yet” away');
  assert.ok(src.includes('view.clear'), 'at-risk projects keep “All clear” away through the shared clear verdict');
  assert.ok(src.includes('{welcomeOn &&'), 'the welcome reads the combined verdict');
  assert.ok(!src.includes('{view.nothingOnYou &&'), 'never the projects-only verdict alone');
});

test('the board’s move undoes as one action, however many writes it took', () => {
  const src = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(src.includes('runEditBatch({'), 'the shared multi-edit undo');
  assert.ok(src.includes('for (let i = 0; i < all.length; i++) await window.nv.projects.undo(c.path);'), 'Undo walks every write back');
});

test('the portfolio timeline reads again when the notes change', () => {
  const src = read('src/renderer/src/views/ProjectsHome.tsx');
  const pane = src.split('function TimelinePane')[1].split('function ')[0];
  assert.ok(pane.includes('useApp((s) => s.revision)'), 'subscribed to the revision');
  assert.ok(pane.includes('}, [revision]);'), 'reloaded on it, like every list around it');
});

test('opening at a due/start date opens Facts and flashes the row', () => {
  const reveal = read('src/renderer/src/views/timeline/reveal.ts');
  assert.doesNotMatch(reveal, /\.pj-head/, 'no dead header selector');
  assert.ok(reveal.includes('[data-item="${CSS.escape(item)}"]'), 'due/start read their marks');
  assert.ok(reveal.includes('export function showItemSoon'), 'the page waits for the panel to draw');
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes("mark: 'due'") && page.includes("mark: 'start'"), 'the facts are marked');
  // t255, tabs: one showKey — due/start open the Facts panel and flash there; everything else opens its
  // tab through the shared hook and flashes there (proved live in t255-tabs: a due date from Today
  // opens Facts and flashes its row).
  const showKey = page.slice(page.indexOf('const showKey'), page.indexOf('const openCtx'));
  assert.ok(showKey.includes("if (key === 'due' || key === 'start')"), 'due/start take the Facts branch');
  assert.ok(showKey.includes('setFactsOpen(true)') && showKey.includes('flashKey(key)'), 'Facts opens first, then the row flashes');
  assert.ok(showKey.includes('reveal(target, key'), 'the rest reveal through the shared tab hook');
  assert.ok(page.includes('takeItem(path)') && page.includes('sectionForKey(item)'), 'an opening from elsewhere lands once, without pushing');
  const head = read('src/renderer/src/components/PageHead.tsx');
  assert.ok(head.includes('data-item={f.mark}'), 'PageProps draws the mark');
});

test('the old section cards stay gone (their substring tone went with them)', () => {
  assert.throws(() => read('src/renderer/src/views/project/Sections.tsx'), 'Sections.tsx deleted: the sections render the lists now');
});

test('an answer is filed under its question, even after Retry', () => {
  const src = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(src.includes('priorUserText(chat.messages, i)'), 'the nearest user message before it');
  assert.doesNotMatch(src, /chat\.messages\[i - 1\]/, 'never the message just above (a Retry’s earlier answer)');
});

test('the Ask float is gone: the side chat is the one place to ask', () => {
  assert.throws(() => read('src/renderer/src/components/AskFloat.tsx'), 'the floating card file is deleted');
});

test('the day’s note takes the typing even when the handoff snapshot is empty', () => {
  const src = read('src/renderer/src/views/today/DayNote.tsx');
  assert.ok(src.includes('if (pendingRef.current) view.focus();'), 'late keys land in the note, not the dying starter');
});

test('Stop settles a ticked-sources ask at once and drops its late result', () => {
  const src = read('src/renderer/src/state/chat.ts');
  assert.ok(src.includes("if (store.requestId === 'chosen') {"), 'Stop handles the notebook ask');
  assert.ok(src.includes('stoppedChosen'), 'the late result is dropped');
});

test('a reminder ticked in Due offers Undo (one-offs; repeating ones moved on)', () => {
  const src = read('src/renderer/src/views/today/DueCard.tsx');
  assert.ok(src.includes('window.nv.reminders.untick(r.key)'), 'Undo unticks the line');
  assert.ok(src.includes('if (r.repeat) return toast(words);'), 'a repeating one simply moved on, as on Tasks');
  assert.ok(read('src/preload/index.ts').includes("untick: (key: string) => invoke<string>('reminders:untick', key)"), 'the channel exists');
});

test('Waiting joins the line without stacking tails', () => {
  const src = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!src.includes('waitingLine(line, name)'), 'the board drop is gone (t249, plan decision 2: one view, no Board switch)');
  assert.ok(src.includes('setTaskWho('), 'who changes on the row and in its menu through the shared write, never a second dash');
});

test('the dead views stay gone (the old Files view, Today’s BriefCard)', () => {
  assert.throws(() => read('src/renderer/src/views/project/Files.tsx'), 'Files.tsx deleted: FilesSection is the files view');
  const brief = read('src/renderer/src/views/today/BriefCard.tsx');
  assert.ok(brief.includes('export function runBriefAction'), 'the shared action runner stays (Home, the F61 guard)');
  assert.doesNotMatch(brief, /export function BriefCard/, 'the unrendered card stays out');
  assert.ok(brief.includes('openMeetingNoteFor('), 'the F61 guard’s meeting rule still holds');
});
