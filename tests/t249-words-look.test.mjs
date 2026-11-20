// node --test tests/t249-words-look.test.mjs — old words for the new thing, whole words on screen,
// your own name off your own list, and a named Meetings block (t249, 12 Nov 2026, the critics).
// Projects home counts tasks; "Your next" holding "Your next 3" reads once; row titles and Inbox
// file buttons wrap whole instead of cutting mid-word; Your next hides your own name as Today does;
// Today’s empty Meetings block carries its name. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('Projects home counts tasks, one kind called Task', () => {
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes('`${c.openNext} task${c.openNext === 1'), 'the row counts tasks, never next steps');
  assert.ok(home.includes('`${c.openNext} task${c.openNext === 1') || home.includes("{c.openNext} task{"), 'the gallery and board tags count tasks');
  assert.ok(home.includes("'no open tasks'"), 'an empty count reads as tasks');
  assert.ok(home.includes("Counted from the project's open tasks."), 'the count says where it comes from');
  assert.ok(!home.includes('next step'), 'no old words for the new thing on Projects home');
  assert.ok(home.includes('with no tasks or dates yet'), 'the files-to-check line reads tasks too');
});

test('the same old words nowhere else on these screens', () => {
  assert.ok(read('src/shared/inbox-tour.ts').includes('with its tasks and dates'), 'the Inbox tour reads tasks');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('Your tasks, what’s due and who you’re waiting on will show here'), 'Today’s welcome reads tasks');
  assert.ok(today.includes('No task or key date falls due in the next seven days'), 'the empty week reads tasks');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('a tick-box becomes a task'), 'File… reads tasks');
  assert.ok(!inbox.includes("that project's next step"), 'no next-step tooltips left');
});

test('Your next reads once: its head names what it shows', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const at = tabs.indexOf('export function WhatsNextSection');
  const sec = tabs.slice(at, at + 6000);
  assert.ok(sec.includes('title={head}'), 'one head, naming what it shows');
  assert.ok(sec.includes("'Your next 3'"), 'the folded head names its three, as the plan sketches');
  assert.ok(!sec.includes('tksec'), 'no second "Your next 3" line under the head');
  assert.ok(sec.includes('of yours'), 'then All N of yours');
});

test('row titles and Inbox file buttons wrap whole, never cut mid-word', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const rowTitle = kit.match(/\.trow \.t \{([^}]*)\}/)?.[1] ?? assert.fail('no .trow .t rule');
  assert.ok(/white-space: normal/.test(rowTitle), 'a row’s title wraps (.trow .t)');
  assert.ok(/overflow-wrap: break-word/.test(rowTitle), 'whole words first, breaking only unbreakable strings');
  const today = read('src/renderer/src/styles/today.css');
  const sub = today.match(/\.td-row-sub \{([^}]*)\}/)?.[1] ?? assert.fail('no .td-row-sub rule');
  assert.ok(/white-space: normal/.test(sub), 'a Today sub wraps');
  const subText = today.match(/\.td-row-sub \.td-text \{([^}]*)\}/)?.[1] ?? assert.fail('no .td-row-sub .td-text rule');
  assert.ok(/white-space: normal/.test(subText) && /overflow: visible/.test(subText), 'a project name under a row wraps whole');
  assert.ok(!/text-overflow: ellipsis/.test(`${sub} ${subText}`), 'never dots');
  const w2a = read('src/renderer/src/styles/w2a.css');
  const lead = w2a.match(/\.w2a-ib-leadwords \{([^}]*)\}/)?.[1] ?? assert.fail('no lead-words rule');
  assert.ok(/white-space: normal/.test(lead), 'the File-in lead button wraps whole');
  const chips = w2a.match(/\.w2a-ib-filein \.chip \{([^}]*)\}/)?.[1] ?? assert.fail('no file-in chip rule');
  assert.ok(/white-space: normal/.test(chips) && /height: auto/.test(chips), 'long File-in chips grow to a second line');
  assert.ok(/\.w2a-ib-actions \.btn\.pri \{[^}]*height: auto/s.test(w2a), 'the lead button grows with its words');
});

test('Your next hides your own name, as Today does', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('visibleWho(displayWho, ctx.hub.me)'), 'a step row hides your own name through the one rule');
  assert.ok(tabs.includes('visibleWho(a.person || a.who, ctx.hub.me)'), 'a meeting or note row hides it too');
});

test('Today’s empty Meetings block carries its name', () => {
  const view = read('src/renderer/src/views/TodayView.tsx');
  // Layout round 2 (20 Nov 2026): the day's column always heads with Meetings; with none, its head and one quiet
  // line ("No meetings today"), New and Record under it.
  const at = view.indexOf("th-meetings${hubDay.meetings.length ? '' : ' is-none'}");
  assert.ok(at > 0, 'the empty meetings block is marked quiet');
  assert.ok(view.slice(at, at + 900).includes('Meetings') && view.slice(at, at + 1400).includes('No meetings today.'), 'it names itself Meetings and says there are none');
});

test('Tasks hides your own name on your own rows, the same rule as Today and Your next', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('<WhoInner name={visibleWho(info?.owner, me) || undefined} />'), 'an editable row hides your own name');
  assert.ok(tasks.includes('<WhoCell name={visibleWho(info?.owner, me) || undefined} />'), 'a read-only row hides it too');
  assert.equal((tasks.match(/me=\{me\} \/>/g) || []).length, 2, 'both row lists pass who you are');
});

test('the project meeting card hides your own name too; Waiting on others keeps every name', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const card = tabs.slice(tabs.indexOf('function MeetingActionRow'));
  assert.ok(card.includes('visibleWho(a.person || a.who, ctx.hub.me)'), 'an editable meeting card row hides your own name');
  assert.ok(card.includes('visibleWho(a.person, ctx.hub.me)'), 'a read-only one does too');
});
