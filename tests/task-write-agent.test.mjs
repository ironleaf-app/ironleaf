// node --test tests/task-write-agent.test.mjs — one task, one home through every door (src/main/task-write.ts with
// src/main/agent-access.ts, src/main/reviews.ts and src/shared/project-checks.ts; p12-task-writes, 4 Nov 2026). Before a
// next step is added it is compared with the project's open tasks and its connected notes' open tasks — exact after
// normalising, then the on-device meaning model at a strict threshold — and a match updates that task instead of adding
// another. A task for a person's page goes on the project with a plain pointer left behind, or to the Inbox when no
// project fits. Model off means exact only; below the threshold is a new task.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-task-write-agent-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/main/task-write.ts')};`,
      `export * from ${src('src/main/agent-access.ts')};`,
      `export { AGENT_TOOLS } from ${src('src/shared/agent-access.ts')};`,
      `export { NOTE_ADD_TASK_DEF } from ${src('src/shared/mcp-local.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { Reviews } from ${src('src/main/reviews.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject } from ${src('src/shared/project-file.ts')};`,
      `export { catchUpProposals } from ${src('src/shared/project-checks.ts')};`,
      `export { readDay as readDayOf, dayWords } from ${src('src/shared/days.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
});
// Every AgentAccess made below saves its activity in the background; the folder goes once those saves finish
// (23 Nov 2026: under load the last save landed while the folder was being removed, ENOTEMPTY).
const accesses = [];
after(async () => {
  await Promise.all(accesses.map((a) => a.flush()));
  rmSync(work, { recursive: true, force: true });
});

const LIGHTS = 'Projects/Lighting Upgrade/Lighting Upgrade.md';
const NOTES = {
  [LIGHTS]: `---\ntype: project\nstatus: active\nowner: Darcy Lin\n---\n# Lighting Upgrade\n\n## Summary\n\nThe hall’s sound system rebuilt before the season opens.\n\n## What's next\n\n- [ ] Chase the calibration certificate — Darcy Lin\n`,
  'Projects/Lighting Upgrade/Notes/Site walk.md': `---\nproject: "[[Lighting Upgrade]]"\n---\n# Site walk\n\n- [ ] Ask Darcy Lin to confirm the cable paths\n- [ ] Count the spare microphones\n`,
  'People/Darcy Lin.md': `---\ntype: person\n---\n# Darcy Lin\n\nAV lead.\n`,
  'People/Robin Banks.md': `---\ntype: person\n---\n# Robin Banks\n\nCatering.\n`,
  'Meetings/Lighting site meeting.md': `---\ntype: meeting\ndate: 2026-11-03\nattendees: [Darcy Lin]\n---\n# Lighting site meeting\n\n## Actions\n\n- Darcy to confirm the cable paths by Friday\n- Count the spare microphones\n- Label the spare patch leads\n`,
};

function makeHost(dataDir, overrides = {}) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const now = new Date(2026, 10, 4, 10, 30).getTime();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const history = new M.ProjectHistory();
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async () => {},
    move: async () => { throw new Error('no moves here'); },
    trash: async () => {},
    clean,
    today: () => 'Wednesday 4 November 2026 (2026-11-04)',
  };
  const host = {
    dataDir,
    kind: 'embedded',
    ready: async () => {},
    library: () => '/made-up/library',
    index,
    notes,
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    // The project-edit path's own check, as the app's does it (src/main/app.ts): every add runs the one mechanism.
    editProject: async (rel, edits, by, words) => {
      const before = index.content(rel);
      const p = M.parseProject(before, rel);
      const adds = edits.filter((e) => e && e.kind === 'add' && e.list === 'next');
      let said = words;
      let rest = edits;
      if (adds.length) {
        const { planned, updates } = await M.planNextAdds(index, rel, adds.map((e) => e.item), { embed: host.embed, now: new Date(now) });
        await M.writeNoteUpdates(index, planned, writeNote);
        rest = [...edits.filter((e) => !(e && e.kind === 'add' && e.list === 'next')), ...M.plannedEdits(planned)];
        said = M.plannedWords(planned, updates) ?? said;
      }
      const done = rest.map((e) => M.applyProjectEdit(p, e, '4 Nov 2026'));
      const after = M.serializeProject(p, before);
      said = said ?? (done.length === 1 ? done[0] : `Made ${done.length} changes.`);
      await writeNote(rel, after);
      history.record(rel, { before, after, words: said, by });
      return { file: rel, words: said, before, after };
    },
    writeNote,
    trash: async () => {},
    today: () => ({ projects: 1 }),
    dailyPath: () => 'Daily/2026-11-04.md',
    dailyNote: async () => 'Daily/2026-11-04.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'inbox', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    changed: () => {},
    ...overrides,
  };
  return { host, files, index, projects, history, writeNote, now };
}

let n = 0;
async function setup(overrides = {}) {
  const dataDir = path.join(work, `data-${++n}`);
  const t = makeHost(dataDir, overrides);
  const access = new M.AgentAccess(t.host);
  accesses.push(access);
  access.load();
  const reviews = new M.Reviews({
    index: t.index,
    projects: t.projects,
    history: t.history,
    writeNote: t.writeNote,
    exists: async (rel) => t.files.has(rel),
    trash: async () => {},
    versions: async () => [],
    version: async () => '',
    load: async () => ({}),
    save: async () => {},
    askJson: async () => ({ reply: null, error: 'no model here' }),
    undoProject: async () => { throw new Error('no undo here'); },
    ...(overrides.embed ? { embed: overrides.embed } : {}),
  });
  return { ...t, access, reviews, dataDir };
}
const words = (r) => r.content.map((c) => c.text).join('\n');
const agentOf = (level) => ({ level: level === 'read' ? 'read' : 'edit' });
/** One call from another AI app on this PC, at that agent's level (the local MCP server's own door). */
async function callAs(access, a, name, args) {
  await access.setLocalMcp({ on: true, level: a.level });
  return access.asLocalMcp(name, args);
}
const nextOf = (files) => M.parseProject(files.get(LIGHTS), LIGHTS).next;

/** A stub on-device model: the vectors the test gives, silence ([0,0]) for anything else. */
const stubEmbed = (vecs) => async (texts) => texts.map((t) => vecs.get(t) ?? [0, 0]);

test('adding the same next step twice adds it once; the second updates and says already there', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const first = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Count the till log' });
  assert.ok(!first.isError, words(first));
  const second = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Count the till log', who: 'Darcy Lin', when: 'Friday' });
  assert.ok(!second.isError, words(second));
  assert.match(words(second), /already there: Count the till log; updated/);
  const steps = nextOf(files).filter((s) => /till log/i.test(s.what));
  assert.equal(steps.length, 1, 'one home');
  assert.equal(steps[0].who, 'Darcy Lin', 'the owner updates');
  assert.ok(steps[0].when && steps[0].when !== 'Friday', `the day is real, not “Friday”: ${steps[0].when}`);
});

test('said twice in one call adds once', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const r = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', steps: [{ what: 'Polish the lens caps' }, { what: 'Polish the lens caps' }] });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /already there: Polish the lens caps/);
  assert.equal(nextOf(files).filter((s) => /lens caps/i.test(s.what)).length, 1);
});

test('a reworded step updates at meaning; below the bar, or model off, it is a new task', async () => {
  const hit = [0.9, Math.sqrt(1 - 0.81)];
  const vecs = new Map([
    ['Ask Darcy Lin to confirm the cable paths', [1, 0]],
    ['Ask Darcy Lin to verify the cable paths', hit],
    ['Book the calibration visit', [1, 0]],
    ['Book the calibration excursion', [0.7, Math.sqrt(1 - 0.49)]],
  ]);
  const { access, files } = await setup({ embed: stubEmbed(vecs) });
  const a = agentOf('edit');
  const r = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Ask Darcy Lin to verify the cable paths', who: 'Darcy Lin' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /already there: .*; updated/, 'cosine 0.9 updates the note’s task');
  assert.equal(nextOf(files).filter((s) => /cable paths/i.test(s.what)).length, 0, 'nothing doubled onto the project');
  assert.match(files.get('Projects/Lighting Upgrade/Notes/Site walk.md'), /Ask Darcy Lin to confirm the cable paths.*Darcy Lin/, 'the note’s line carries the owner');
  const r2 = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Book the calibration excursion' });
  assert.ok(!r2.isError, words(r2));
  const r3 = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Book the calibration visit' });
  assert.ok(!r3.isError, words(r3));
  assert.equal(nextOf(files).filter((s) => /calibration (visit|excursion)/i.test(s.what)).length, 2, 'cosine 0.7 is a new task');

  const off = await setup();
  const b = agentOf('edit');
  await callAs(off.access, b, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Label the spare cables' });
  const r4 = await callAs(off.access, b, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Tag the spare cables' });
  assert.ok(!r4.isError, words(r4));
  assert.equal(nextOf(off.files).filter((s) => /spare cables/i.test(s.what)).length, 2, 'model off: exact only');
});

test('capital and punctuation aside, the same step said again updates', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Send the quote.' });
  const r = await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'send the quote' });
  assert.match(words(r), /already there: Send the quote\./);
  assert.equal(nextOf(files).filter((s) => /quote/i.test(s.what)).length, 1);
});

test('capture twice files once', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  await callAs(access, a, 'capture', { kind: 'task', text: 'Order the spare HDMI cables', project: 'Lighting Upgrade' });
  const r = await callAs(access, a, 'capture', { kind: 'task', text: 'Order the spare HDMI cables', project: 'Lighting Upgrade' });
  assert.match(words(r), /already there: Order the spare HDMI cables/);
  assert.equal(nextOf(files).filter((s) => /HDMI/i.test(s.what)).length, 1);
});

test('two catch-ups over the same inbox facts add each task once', async () => {
  // The stub model reads cable-paths lines as the same task however the owner and day join them (as the on-device
  // model would), so the second run still finds the note's updated line.
  const embed = async (texts) => texts.map((t) => (t === 'Confirm the cable paths' ? [0.9, Math.sqrt(1 - 0.81)] : /cable paths/i.test(t) ? [1, 0] : [0, 0]));
  const { access, files } = await setup({ embed });
  const a = agentOf('edit');
  const run = async () => {
    const p = M.parseProject(files.get(LIGHTS), LIGHTS);
    const rel = 'Meetings/Lighting site meeting.md';
    const out = [];
    for (const c of M.catchUpProposals(p, [{ path: rel, title: 'Lighting site meeting', modified: Date.now(), content: files.get(rel) }], new Date())) {
      if (c.kind !== 'next') continue;
      out.push(words(await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: c.what, ...(c.who ? { who: c.who } : {}), ...(c.when ? { when: c.when } : {}) })));
    }
    return out;
  };
  const first = await run();
  assert.ok(first.length >= 3, `the meeting’s actions are proposed: ${first.length}`);
  const second = await run();
  const whats = () => nextOf(files).map((s) => s.what);
  const siteWalk = () => files.get('Projects/Lighting Upgrade/Notes/Site walk.md');
  assert.equal(whats().filter((w) => /patch leads/i.test(w)).length, 1, 'the new action lands on the project once');
  assert.equal(whats().filter((w) => /cable paths/i.test(w)).length, 0, 'the reworded action never doubles onto the project');
  assert.equal(siteWalk().split('Ask Darcy Lin to confirm the cable paths').length - 1, 1, 'its one home stays the note');
  assert.match(siteWalk(), /Ask Darcy Lin to confirm the cable paths.*— Darcy/, 'the note’s line gains the owner');
  assert.equal(whats().filter((w) => /microphones/i.test(w)).length, 0, 'the exact action never doubles onto the project');
  assert.equal(siteWalk().split('Count the spare microphones').length - 1, 1, 'its one home stays the note');
  assert.ok(second.every((w) => /already there/.test(w)), `the second run adds nothing: ${JSON.stringify(second)}`);
});

test('a task for a person’s page goes on the project and the page gets a plain pointer', async () => {
  const { access, files } = await setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  const r = await access.asLocalMcp('note_add_task', { path: 'People/Darcy Lin.md', text: 'Walk the hall with Sam' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Lighting Upgrade/);
  assert.match(words(r), /Darcy Lin’s page now points to it\./, 'the reply names the page that points, not the person');
  assert.equal(nextOf(files).filter((s) => /Walk the hall/i.test(s.what)).length, 1, 'the project holds the task');
  assert.match(files.get('People/Darcy Lin.md'), /Walk the hall with Sam — see \[\[Lighting Upgrade\]\]/, 'the page holds a plain pointer');
  assert.ok(!files.get('People/Darcy Lin.md').includes('- [ ] Walk the hall'), 'the pointer is not a second task');
});

test('no project fits a person’s page: the task goes to Inbox', async () => {
  const { access, files } = await setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  const r = await access.asLocalMcp('note_add_task', { path: 'People/Robin Banks.md', text: 'Order the napkins' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Inbox/);
  assert.match(files.get('Inbox.md'), /Order the napkins/);
  assert.equal(nextOf(files).filter((s) => /napkins/i.test(s.what)).length, 0);
  assert.ok(!files.get('People/Robin Banks.md').includes('Order the napkins'), 'nothing half-written on the page');
});

test('a retried note task writes once and says already there', async () => {
  const { access, files } = await setup();
  await access.setLocalMcp({ on: true, level: 'edit' });
  await access.asLocalMcp('note_add_task', { path: 'Notes/Site walk.md', text: 'Order filters' }).catch(() => {});
  const made = 'Projects/Lighting Upgrade/Notes/Site walk.md';
  const r = await access.asLocalMcp('note_add_task', { path: made, text: 'Count the spare microphones' });
  assert.match(words(r), /already there: Count the spare microphones/);
  assert.equal(files.get(made).split('Count the spare microphones').length - 1, 1, 'written once');
});

test('a meeting action’s words added twice land once, and say so', async () => {
  // t238: no filing door any more — the meeting’s actions are the project’s tasks already. An agent adding the
  // same new step twice still writes once through the one check (project_add_next_step).
  const { access, files } = await setup();
  const a = agentOf('edit');
  const args = { project: 'Lighting Upgrade', what: 'Confirm the cable paths with Darcy', who: 'Darcy Lin' };
  await callAs(access, a, 'project_add_next_step', args);
  const r = await callAs(access, a, 'project_add_next_step', args);
  assert.match(words(r), /already there: Confirm the cable paths with Darcy/);
  assert.equal(nextOf(files).filter((s) => /cable paths with Darcy/i.test(s.what)).length, 1, 'written once');
});

test('a relative day is stored as a real date; a condition stays as words; Ongoing is a state', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Test the radio microphones', when: 'Friday' });
  const dated = nextOf(files).find((s) => /radio microphones/i.test(s.what));
  const d = M.readDayOf(dated.when, new Date());
  assert.ok(d && d.getDay() === 5, `stored “${dated.when}” is a real Friday`);
  await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Book the bump-in', when: 'before the counter build' });
  const cond = nextOf(files).find((s) => /bump-in/i.test(s.what));
  assert.equal(cond.when, 'before the counter build', 'an event condition stays as words in the task, never a due date');
  await callAs(access, a, 'project_add_next_step', { project: 'Lighting Upgrade', what: 'Keep the spares log', when: 'Ongoing' });
  const state = nextOf(files).find((s) => /spares log/i.test(s.what));
  assert.equal(state.when, 'Ongoing');
});

test('the tool words tell the model the rule, briefly', async () => {
  const def = M.AGENT_TOOLS.find((t) => t.name === 'project_add_next_step');
  assert.match(def.description, /already there/i);
  assert.match(def.description, /never doubled/i);
  assert.match(def.description, /real date/i);
  const capture = M.AGENT_TOOLS.find((t) => t.name === 'capture');
  assert.match(capture.description, /never doubled/i);
  assert.match(M.NOTE_ADD_TASK_DEF.description, /pointer/);
  assert.match(M.NOTE_ADD_TASK_DEF.description, /Inbox/);
});
