// node --test tests/t179-owner-joins.test.mjs — t179 break-it fourth: a task assigned in one meeting to
// someone who is the person in another. Task joins compared words only, so one person's same-worded task read as
// another's: a second same-words action in a meeting note was dropped, prep kept one owner's telling, ticking
// ticked the wrong person's step, and done-ness crossed owners. Joins compare owners too now (t238: the one-task
// merge in src/shared/unified-tasks.ts, ownerCompatible in src/shared/today-count.ts underneath): two different
// named people never join. Made-up people and meetings only.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t179-'));
let S, M;
const TODAY = new Date(2026, 10, 9, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['today-count', 'meetings', 'work-meetings', 'one-task', 'unified-tasks', 'meeting-notes', 'meeting-minutes', 'project-file'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const OKAFOR = 'Sam Okafor', REID = 'Sam Reid';
const KNOWN = ['Ana Ruiz', OKAFOR, REID];

test('ownerCompatible: two different named people differ, an unnamed side never contradicts', () => {
  const f = S.todayCount.ownerCompatible;
  assert.equal(typeof f, 'function');
  assert.equal(f(OKAFOR, REID), false, 'two different named people differ');
  assert.equal(f(REID, OKAFOR), false, 'either way round');
  assert.equal(f(OKAFOR, OKAFOR), true, 'the same person joins');
  assert.equal(f('Sam', OKAFOR), true, 'a first name of the person joins');
  assert.equal(f('', OKAFOR), true, 'an unnamed side never contradicts a named one');
  assert.equal(f(OKAFOR, ''), true, 'either way round');
  assert.equal(f('', ''), true, 'neither naming anyone joins');
  assert.equal(f(undefined, undefined), true, 'missing owners join');
});

test('one meeting, two owners, the same words: both actions are read', () => {
  const text = ['---', 'type: meeting', 'date: 2026-11-05', '---', '# Joinery review', '', '## Actions', '', `- [ ] Send the revised plan — ${OKAFOR}`, `- [ ] Send the revised plan — ${REID}`, '- [ ] Send the revised plan', ''].join('\n');
  const found = S.meetings.findActions(text, { people: KNOWN, date: TODAY });
  assert.deepEqual(found.map((a) => [a.what, a.who ?? '']), [['Send the revised plan', OKAFOR], ['Send the revised plan', REID]], 'different owners are two jobs; a third unnamed telling still folds');
  const dupes = S.meetings.findActions('## Actions\n- [ ] Send the quote — Sam\n- [ ] send the quote.\n', {});
  assert.equal(dupes.length, 1, 'the same telling twice still reads once');
});

test('ticked same-words rows: another owner still reads', () => {
  const text = ['---', 'type: meeting', 'date: 2026-11-05', '---', '# Joinery review', '', '## Actions', '', `- [ ] Send the revised plan — ${OKAFOR}`, `- [x] Send the revised plan — ${REID}`, ''].join('\n');
  const m = S.workMeetings.readMeeting({ path: 'Meetings/Review.md', title: 'Review', props: { type: 'meeting', date: '2026-11-05' }, content: text }, KNOWN);
  assert.deepEqual(m.actions.map((a) => [a.who, a.done]), [[OKAFOR, false], [REID, true]]);
});

test('merge and actionDone: another owner’s step is another row; its own merges', () => {
  const U = S.unifiedTasks;
  const X = S.workMeetings;
  const PROJ = 'Projects/Harbour Fit-out.md';
  const row = (words, owner, kind, p = PROJ) => ({
    words, text: words, owner, due: null, done: false, project: p, projectName: 'Harbour Fit-out',
    home: { path: kind === 'project' ? p : 'Meetings/Review.md', line: 0 },
    source: U.sourceOf(kind, kind === 'project' ? p : 'Meetings/Review.md', kind === 'project' ? 'Harbour Fit-out' : 'Review'),
  });
  const groups = (stepWho) => U.mergeGroups([row('Send the revised plan', stepWho, 'project'), row(`Send the revised plan — ${OKAFOR}`, OKAFOR, 'meeting')], TODAY);
  assert.equal(groups(REID).length, 2, 'another owner’s step is another row');
  assert.equal(groups(OKAFOR).length, 1, 'its own step merges into one row');
  assert.deepEqual(groups(OKAFOR)[0].map((g) => g.source.kind).sort(), ['meeting', 'project'], 'both sources on the one row');
  const a = { what: 'Send the revised plan', who: OKAFOR, done: false };
  assert.equal(X.actionDone(a, [{ what: 'Send the revised plan', who: REID, done: true }]), false, 'not done when only the other owner’s step is ticked');
  assert.equal(X.actionDone(a, [{ what: 'Send the revised plan', who: OKAFOR, done: true }]), true, 'done when its own step is ticked');
  assert.equal(X.actionDone(a, [{ what: 'Send the revised plan', done: true }]), true, 'an ownerless ticked step still counts');
});

test('prepDistinct: the same words for two owners are two items', () => {
  const out = S.workMeetings.prepDistinct([{ what: 'Send the revised plan', who: OKAFOR }, { what: 'Send the revised plan', who: REID }, { what: 'Send the revised plan', who: OKAFOR }]);
  assert.deepEqual(out.map((x) => x.who), [OKAFOR, REID], 'each owner once');
  const plain = S.workMeetings.prepDistinct([{ what: 'Book the tilers' }, { what: 'Book the tilers' }]);
  assert.equal(plain.length, 1, 'unnamed retellings still fold');
});

test('notes and minutes merges: another owner’s fresh action is added, not swallowed', () => {
  const note = ['---', 'type: meeting', 'date: 2026-11-05', '---', '# Review', '', '## Actions', '', `- [ ] Send the revised plan — ${OKAFOR}`, ''].join('\n');
  const made = { summary: 'A short one.', decisions: [], actions: [{ what: 'Send the revised plan', who: REID }], people: [OKAFOR, REID], named: [] };
  const opts = { transcript: [], length: '3 minutes', people: KNOWN, date: '2026-11-05' };
  const into = S.meetingNotes.applyMeetingNotes(note, made, opts).text;
  assert.match(into, /Send the revised plan — .*Reid/, 'the notes merge adds the other owner’s action');
  const same = S.meetingNotes.applyMeetingNotes(note, { ...made, actions: [{ what: 'Send the revised plan', who: OKAFOR }] }, opts).text;
  assert.equal(same.match(/Send the revised plan/g).length, 1, 'its own telling still merges');
  const minutes = { present: [OKAFOR, REID], absent: [], named: [], summary: 'A short one.', figures: [], decisions: [], actions: [{ what: 'Send the revised plan', who: REID }], questions: [], topics: [] };
  const mins = S.meetingMinutes.applyMeetingMinutes(note, minutes, { people: KNOWN, date: '2026-11-05', merged: true }).text;
  assert.match(mins, /Send the revised plan — .*Reid/, 'the merged minutes keep the other owner’s action too');
  const minsPlain = S.meetingMinutes.applyMeetingMinutes(note, minutes, { people: KNOWN, date: '2026-11-05' }).text;
  assert.match(minsPlain, /Send the revised plan — .*Reid/, 'and the plain minutes add it too');
});

// ── The main side, through a real vault ──────────────────────────────────────────────────────────────────────────────

const PROJECT = `---
type: project
status: active
owner: Ana Ruiz
---
# Harbour Fit-out

## What’s next
- [ ] Send the revised plan — ${REID}
`;
const MEETA = `---
type: meeting
date: 2026-11-05
project: "[[Harbour Fit-out]]"
attendees: ["[[Ana Ruiz]]", "[[${OKAFOR}]]"]
---
# Joinery review

Who came: Ana Ruiz, ${OKAFOR}

## Actions

- [ ] Send the revised plan — ${OKAFOR} · by 12 Nov 2026
`;
function setup(files, switches, now = TODAY, extra = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const index = new M.VaultIndex();
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
    if (rel.endsWith('.md')) index.set(rel, text, TODAY.getTime(), text.length);
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  const P = S.projectFile;
  const ask = async () => ({ reply: null, error: 'No model is set up yet.' });
  const w = new M.WorkModules({
    vault: () => ({ root: dir, any: async (rel) => existsSync(path.join(dir, rel)) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: switches }),
    writeNote: async (rel, text) => put(rel, text),
    importFiles: async () => [],
    pickFiles: async () => [],
    saveFile: async () => '',
    post: () => 0,
    editProject: async (rel, edit) => {
      const before = index.content(rel);
      const p = P.parseProject(before, rel);
      const words = (Array.isArray(edit) ? edit : [edit]).map((e) => P.applyProjectEdit(p, e, '9 Nov 2026'));
      put(rel, P.serializeProject(p, before));
      return { words: words.join(' ') };
    },
    projects: () => index.allMeta().filter((m) => m.props?.type === 'project').map((m) => ({ path: m.path, name: m.title })),
    records: (ix) => (ix ?? index).records({ templatesFolder: 'Templates', today: '2026-11-09' }),
    askJson: (system, user) => ask(system, user),
    requireCreate: async () => {},
    now: () => now,
    ...extra,
  });
  return { dir, index, w, write: put, read: (rel) => readFileSync(path.join(dir, rel), 'utf8'), op: (module, name, ...args) => w.parts.find((p) => p.id === module).ops[name](...args) };
}
const VAULT = () => ({
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }),
  'Work/Projects/Harbour Fit-out/Harbour Fit-out.md': PROJECT,
  'Work/Meetings/2026-11-05 Joinery review.md': MEETA,
  'Work/People/Sam Okafor.md': '---\ntype: person\n---\n',
  'Work/People/Sam Reid.md': '---\ntype: person\n---\n',
});

test('no filing: the action is the project’s task already, beside the other owner’s step', async () => {
  const v = setup(VAULT(), { meetings: { on: true } });
  const rel = 'Work/Meetings/2026-11-05 Joinery review.md';
  const a = (await v.op('meetings', 'model')).meetings.find((m) => m.path === rel).actions.find((x) => x.what === 'Send the revised plan');
  assert.equal(a.who, OKAFOR);
  assert.equal(a.inProject, true, 'in its project from the moment it is written');
  const proj = v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md');
  assert.match(proj, new RegExp(`Send the revised plan — ${REID}`), 'the other owner’s step is untouched');
  assert.equal(proj.includes(OKAFOR), false, 'nothing copied in beside it');
});

test('moving the meeting moves its open tasks with it', async () => {
  const files = VAULT();
  files['Work/Projects/Wattle Rooms/Wattle Rooms.md'] = PROJECT.replace('# Harbour Fit-out', '# Wattle Rooms').replace(`- [ ] Send the revised plan — ${REID}`, '- [ ] Paint the hallway');
  const v = setup(files, { meetings: { on: true } });
  const rel = 'Work/Meetings/2026-11-05 Joinery review.md';
  const tasks = new M.TasksService({ index: v.index, templatesFolder: () => 'Templates', write: async (p, t) => v.write(p, t), now: () => TODAY.getTime() });
  const where = () => tasks.view().tasks.find((t) => t.words.includes('Send the revised plan') && t.path === rel)?.projectName;
  assert.equal(where(), 'Harbour Fit-out');
  await v.op('meetings', 'set-prop', rel, 'project', 'Wattle Rooms');
  assert.match(v.read(rel), /\[\[Wattle Rooms\]\]/, 'the meeting moved');
  assert.equal(where(), 'Wattle Rooms', 'its open task moved with it');
});

test('ticking: only the same owner’s step ticks with the meeting’s action', async () => {
  const files = VAULT();
  files['Work/Projects/Harbour Fit-out/Harbour Fit-out.md'] = PROJECT.replace('## What’s next', `## What’s next\n- [ ] Send the revised plan — ${OKAFOR}`);
  const v = setup(files, { meetings: { on: true } });
  const rel = 'Work/Meetings/2026-11-05 Joinery review.md';
  const a = (await v.op('meetings', 'model')).meetings.find((m) => m.path === rel).actions.find((x) => x.what === 'Send the revised plan');
  assert.equal(a.inProject, true);
  assert.equal(a.projectDone, false);
  await v.op('meetings', 'tick', rel, a.line, a.raw, true);
  const proj = v.read('Work/Projects/Harbour Fit-out/Harbour Fit-out.md');
  assert.match(proj, new RegExp(`- \\[x\\] Send the revised plan — ${OKAFOR}`), 'its own step is ticked');
  assert.match(proj, new RegExp(`- \\[ \\] Send the revised plan — ${REID}`), 'the other owner’s step stays open');
});

test('done-ness: the meeting’s action is not done when only the other owner’s step is ticked', async () => {
  const files = VAULT();
  files['Work/Projects/Harbour Fit-out/Harbour Fit-out.md'] = PROJECT.replace('- [ ] Send the revised plan', '- [x] Send the revised plan');
  const v = setup(files, { meetings: { on: true } });
  const rel = 'Work/Meetings/2026-11-05 Joinery review.md';
  const a = (await v.op('meetings', 'model')).meetings.find((m) => m.path === rel).actions.find((x) => x.what === 'Send the revised plan');
  assert.equal(a.projectDone, false, 'open while only the other owner’s step is ticked');
});

test('prep: the same words for two people coming are two items', async () => {
  const files = VAULT();
  files['Work/Meetings/2026-11-06 Roster talk.md'] = `---
type: meeting
date: 2026-11-06
project: "[[Harbour Fit-out]]"
attendees: ["[[Ana Ruiz]]", "[[${REID}]]"]
---
# Roster talk

Who came: Ana Ruiz, ${REID}

## Actions

- [ ] Send the revised plan — ${REID} · by 13 Nov 2026
`;
  files['Work/Meetings/2026-11-12 Joinery check-in.md'] = `---
type: meeting
date: 2026-11-12
project: "[[Harbour Fit-out]]"
attendees: ["[[Ana Ruiz]]", "[[${OKAFOR}]]", "[[${REID}]]"]
---
# Joinery check-in

Who came: Ana Ruiz, ${OKAFOR}, ${REID}
`;
  const v = setup(files, { meetings: { on: true } });
  const pack = await v.op('meetings', 'prep', 'Work/Meetings/2026-11-12 Joinery check-in.md');
  const theirs = pack.people.flatMap((p) => p.theirs.map((x) => [p.name, x.what, x.who]));
  const plans = theirs.filter(([, what]) => what === 'Send the revised plan');
  assert.deepEqual(plans.map(([name]) => name).sort(), [OKAFOR, REID].sort(), `each person coming keeps their telling (${JSON.stringify(plans)})`);
});
