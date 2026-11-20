// node --test tests/p17-connected.test.mjs — p17-connected (4 Nov 2026): everything links both
// ways. A task names its project and opens it; a project lists its meetings, people and notes and
// each opens; a person lists what they owe and are owed, their projects and meetings; a meeting
// links its project and people, and its actions show on the project; a pack row links to its note.
// In the peek's Connected list, things say how they are connected in plain words, without two rows
// reading the same. Made-up notes only. Fails first.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-p17-'));
let R;
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { Projects } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml')); } catch { /* already there */ }
  T = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const WORK = 'Projects/Work/Work.md';
const notes = [
  { path: WORK, title: 'Work', label: 'Work', mtime: 1, props: { type: 'project' }, content: `---
type: project
status: active
owner: Ana Ruiz
---
# Work
## What's next
- [ ] Send the quote — Sam Okafor
- [ ] Book the van — Ana Ruiz
## People
- **Ana Ruiz** — Owner
- **Sam Okafor** — Joinery lead
` },
  { path: 'People/Ana.md', title: 'Ana Ruiz', label: 'Ana', mtime: 1, props: { type: 'person', role: 'Owner' }, content: `---
type: person
role: Owner
---
# Ana Ruiz
` },
  { path: 'Meetings/Walk.md', title: 'Walk', label: 'Walk', mtime: 1, props: { type: 'meeting', date: '2026-03-10', project: '[[Work]]', attendees: ['Ana Ruiz'] }, content: `---
type: meeting
date: 2026-03-10
project: "[[Work]]"
attendees: [Ana Ruiz]
---
# Walk
## Actions
- [ ] Book the electrician — Ana Ruiz
` },
  { path: 'Notes/Quote.md', title: 'Quote', label: 'Quote', mtime: 1, props: { type: 'note' }, content: `# Quote\n\nSee [[Work]].\n` },
];
const resolve = (t, from) => {
  const base = t.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  const hit = notes.find((n) => n.title === base || n.path.endsWith(`${base}.md`));
  return hit ? hit.path : null;
};
const model = () => R.buildRecordModel({ notes, resolve, today: '2026-11-04' });

// ── The peek's Connected list: plain words, no two rows reading the same ──────

test('a project with two actions says how each joins it, in different words', () => {
  const m = model();
  const proj = m.records.get(`project:${WORK}`);
  const groups = R.groupConnected(m, proj.id);
  const actions = groups.find((g) => g.key === 'actions');
  assert.ok(actions && actions.items.length >= 2, 'two actions on the project');
  const readings = actions.items.map((x) => x.whys.filter(Boolean).join(' · '));
  assert.ok(readings.every(Boolean), `each says how it joins (${JSON.stringify(readings)})`);
  assert.equal(new Set(readings).size, readings.length, `no two read the same (got ${JSON.stringify(readings)})`);
});

test('a person with two tasks says how each joins them, in different words', () => {
  const m = model();
  const ana = m.records.get('person:ana ruiz');
  const groups = R.groupConnected(m, ana.id);
  const actions = groups.find((g) => g.key === 'actions');
  assert.ok(actions && actions.items.length >= 2, 'two tasks with Ana');
  const readings = actions.items.map((x) => x.whys.filter(Boolean).join(' · '));
  assert.ok(readings.every(Boolean), 'each says how it joins');
  assert.equal(new Set(readings).size, readings.length, `no two read the same (got ${JSON.stringify(readings)})`);
});

test('one pair reads once: a meeting of a project says so, not twice', () => {
  const m = model();
  const meet = [...m.records.values()].find((r) => r.type === 'meeting');
  const item = R.connectedTo(m, meet.id).find((x) => x.record.type === 'project');
  assert.ok(item, 'meeting reaches its project');
  // The frontmatter project prop ([[Work]]) must not add a second generic link
  // beside the specific one: one pair, one reading.
  assert.equal(item.whys.filter(Boolean).length, 1, `one reading, not ${JSON.stringify(item.whys)}`);
});

// ── A project lists its meetings (outside its folder, by its project prop) ────

test('a project lists a meeting kept elsewhere that names it as its project', () => {
  const index = new T.VaultIndex();
  const projText = `---\ntype: project\nstatus: active\n---\n# Work\n`;
  const meetText = `---\ntype: meeting\ndate: 2026-03-10\nproject: ${WORK}\nattendees: [Ana Ruiz]\n---\n# Walk\n`;
  index.set(WORK, projText, 1, projText.length);
  index.set('Meetings/Walk.md', meetText, 1, meetText.length);
  const projects = new T.Projects(index);
  const view = projects.view(WORK);
  const paths = [...view.notes.map((n) => n.path), ...view.linkedFrom.map((n) => n.path)];
  assert.ok(paths.includes('Meetings/Walk.md'), `the meeting is among the project's notes (got ${JSON.stringify(paths)})`);
});

// ── A meeting's actions show on the project ───────────────────────────────────

test("a meeting's actions show on its project, each opening back to the meeting", () => {
  const m = model();
  const proj = m.records.get(`project:${WORK}`);
  const groups = R.groupConnected(m, proj.id);
  const actions = groups.find((g) => g.key === 'actions');
  const fromMeeting = actions.items.find((x) => x.record.source?.startsWith('meeting:'));
  assert.ok(fromMeeting, 'a meeting action shows on the project');
  const meet = R.connectedTo(m, fromMeeting.record.id).find((x) => x.record.type === 'meeting');
  assert.ok(meet, 'that action opens back to its meeting');
});

// ── A person lists what they owe and are owed, their projects and meetings ────

test('a person reaches their tasks both ways, their projects and their meetings', () => {
  const m = model();
  const items = R.personOpenItems(m, 'Ana Ruiz');
  assert.ok(items, 'Ana');
  assert.ok(items.theirs.length >= 1, 'what they owe');
  assert.ok(items.projects.length >= 1, 'their projects');
  assert.ok(items.meetings.length >= 1, 'their meetings');
  // Each of those opens back to the person with words.
  for (const r of [...items.theirs, ...items.projects, ...items.meetings]) {
    const back = R.connectedTo(m, r.id).find((x) => x.record.id === items.person.id);
    assert.ok(back, `${r.type} opens back to the person`);
    assert.ok(back.whys.length && back.whys.every(Boolean), `${r.type} says how`);
  }
});

// ── The screens open what they name (no dead plain words) ─────────────────────
// The renderer checks below pin the mechanism: the row that names a project,
// person or note opens it in the peek or on its page. Each fails first.

test('a task names its project and opens it', () => {
  const view = read('src/renderer/src/views/TasksView.tsx');
  // The project under a task's words opens the project file it already knows
  // (t.project), in the peek — never plain text, never the task itself. The
  // row's own click opens the task; the project's own control opens the project.
  assert.ok(/peek\(\{[^}]*t\.project|openPath\(t\.project/.test(view), 'the task row project opens the project it names (peek or page)');
});

test("a meeting's page opens its project as the project, not as a note", () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // peek({ path: project.path }, { ..., type: 'project' }): type 'note' resolves
  // to nothing for a project path (resolveRef finds no note there), so the pill
  // would open an empty peek. It must ask for the project.
  assert.ok(page.includes("peek({ path: project.path }") && page.includes("type: 'project'"), "the meeting's project pill peeks the project");
  assert.ok(!/peek\(\{ path: project\.path \}[^;]{0,120}?type: 'note'/.test(page), 'never as a note');
});

test("a series' project and a filed action's project each open", () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // SeriesPage: the project pill is a button that peeks the project it names.
  const seriesPart = page.slice(page.indexOf('function SeriesPage'), page.indexOf('function SeriesPage') + 6000);
  assert.ok(seriesPart.includes('s.project') && /<button[^>]*>[\s\S]{0,300}?project\.name/.test(seriesPart) && /peek\(\{ path: project\.path \}, \{[^}]*type: 'project'/.test(seriesPart), "the series' project is a button to the peek");
  // t248: the note is the meeting — the ActionsCard is gone; the note's Tasks head names the one
  // project ("all <project>'s tasks") as a button that opens it.
  const note = read('src/renderer/src/views/MeetingActions.tsx');
  assert.ok(note.includes('{project}</button>'), 'a filed action names its project as a button');
  assert.ok(note.includes("peek({ type: 'project', path: projectPath }"), 'the button opens the project it names');
});

test('who on a row opens the person: the shared who cell and meeting actions', () => {
  const cells = read('src/renderer/src/components/plan/TaskCells.tsx');
  // The mechanism: every task grid's who (project Tasks, Tasks page, Today rows)
  // opens the person it names. A plain span opens nothing.
  assert.ok(cells.includes('peek(') || cells.includes('onOpen') || cells.includes('<button'), 'the who cell opens the person it names');
  // t248: the note is the meeting — meeting actions read in the note's Tasks rows, through the one
  // who cell, which opens the person it names.
  const note = read('src/renderer/src/views/MeetingActions.tsx');
  assert.ok(note.includes('<WhoCell name={r.who} />'), 'a meeting action names who as a button to the peek');
});

test("a pack row links to its note: a meeting action opens what it names", () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  // t248: the note is the meeting — Every action rows open the meeting note itself, at the action's
  // own line (which names where it is written), never plain text; a click opens the document (t239).
  assert.ok(page.includes("A.openPath(r.path, { where: 'current'"), 'a meeting action opens the note it names');
  assert.ok(page.includes('line: r.line'), 'at its own line');
});

test("a meeting action's tooltip says plainly that it opens", () => {
  // t248: the note is the meeting, and the project card reads the meeting's own actions unfolded —
  // those rows' tooltips say "(open it)", as every row does (p22-words: "(open what it joins)"
  // is neither plain nor what the click does).
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('`${plain(a.what)} (open it)`'), 'the action tooltip says it opens');
  assert.ok(!tabs.includes('open what it joins'), 'no unplain tooltip');
});

test("Today's rows name the project as a button that opens it", () => {
  const today = read('src/renderer/src/views/TodayView.tsx');
  // dueRow and waitingRow show the project under the task's words: the name
  // opens the project it names in the peek (the row itself opens the task;
  // the arrow still opens the project's page at the line). A plain span
  // opens nothing, so each must be a button that peeks its x.project.
  const duePart = today.slice(today.indexOf('const dueRow'), today.indexOf('const waitingRow'));
  assert.ok(/<button[^>]*td-project[^>]*>[\s\S]{0,300}?x\.projectName/.test(duePart), 'a due line names its project as a button');
  assert.ok(/peek\(\{\s*type: 'project', path: x\.project/.test(duePart), 'a due line peeks the project it names');
  const waitPart = today.slice(today.indexOf('const waitingRow'), today.indexOf('const riskRow'));
  assert.ok(/<button[^>]*td-project[^>]*>[\s\S]{0,200}?x\.projectName/.test(waitPart), 'a waiting line names its project as a button');
  assert.ok(/peek\(\{\s*type: 'project', path: x\.project/.test(waitPart), 'a waiting line peeks the project it names');
});

test('a project lists its people by names that open, not plain words', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  // PeopleSection: each name opens that card in the peek (the same go the row
  // and the Open card button use). A plain div opens nothing.
  const peoplePart = tabs.slice(tabs.indexOf('export function PeopleSection'), tabs.indexOf('export function PeopleSection') + 3200);
  assert.ok(/<button[^>]*>[\s\S]{0,200}?\{x\.name\}/.test(peoplePart), 'each person is named as a button');
  assert.ok(/ctx\.go\(\{\s*kind: 'person', name: x\.name \}/.test(peoplePart), 'the name opens the person it names');
});

test("a meeting's actions on the project open back, each from its words", () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  // DecisionsSection's flowed rows show the action's words: they open the action
  // in the peek (a record ref, the same go the Waiting rows use), never
  // plain text beside a tick that only ticks.
  // v9-vault-truth D1: the heading names notes and meetings, as what lands there does.
  const flowedPart = tabs.slice(tabs.indexOf('Actions filed from its notes and meetings') - 1500, tabs.indexOf('Actions filed from its notes and meetings') + 2500);
  assert.ok(/<button[^>]*>[\s\S]{0,120}?\{plain\(a\.what\)\}/.test(flowedPart), 'a flowed action names its words as a button');
  assert.ok(/ctx\.go\(a\.ref, a\.what\)/.test(flowedPart), 'those words open the action they name');
});

test('the folio opens what Waiting and risks name', () => {
  // 5 Nov 2026, the vault folio: the Overview's Waiting tile became the Waiting section (its head keeps the row's
  // go) and its risks card the Risks section. The opens below are unchanged.
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  // Waiting names who and what: the head opens the waiting item in
  // the peek (Chase only drafts a message). A risk names its owner: the name
  // opens that person. Plain spans open nothing.
  const overPart = tabs.slice(tabs.indexOf('export function WaitingSection'), tabs.indexOf('export function KeyDatesSection'))
    + tabs.slice(tabs.indexOf('export function RisksSection'), tabs.indexOf('export function UpdatesSection'));
  assert.ok(/<button className="t clip-2"[^>]*>[\s\S]{0,200}?\{g\.person\}/.test(overPart), 'a waiting head is a button, not plain words');
  assert.ok(/ctx\.go\(g\.items\[0\]\.ref/.test(overPart), 'a waiting row opens the item it names');
  // t242 reads tail owners too (owner = r.owner ?? tail.owner): the button and the person-open are
  // intact on the same line, one variable renamed.
  assert.ok(/owner && <button[^>]*>[\s\S]{0,60}?\{owner\}/.test(overPart), 'a risk names its owner as a button');
  assert.ok(/ctx\.go\(\{\s*kind: 'person', name: owner \}/.test(overPart), 'that owner opens the person it names');
});
