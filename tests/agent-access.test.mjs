// node --test tests/agent-access.test.mjs — other AI apps using Ironleaf (src/main/agent-access.ts,
// src/shared/agent-access.ts). On made-up bakery and IT projects in memory, through Connect an AI's local MCP door
// (Read only, or Read and write) and the side chat's catalogue: reads, an edit landing in the project's history with
// the agent's name (and Undo), Private notes refused, and everything kept in Ironleaf's own data.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-access-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/main/agent-access.ts')};`,
      `export { planNextAdds, plannedEdits, plannedWords, writeNoteUpdates } from ${src('src/main/task-write.ts')};`,
      `export { AGENT_TOOLS, BATCH_LIMIT } from ${src('src/shared/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { catalogueFor, nameFor, wordsFor, served, toolOf, OWN, VAULT_TOOLS, sparkDefs, sparkServed, SPARK_ONLY } from ${src('src/shared/vault-tools.ts')};`,
      `export { TOOLS as SIDE_TOOLS, AgentTools } from ${src('src/main/agent.ts')};`,
      `export { RECORD_TOOLS } from ${src('src/shared/records.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject } from ${src('src/shared/project-file.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'access.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'access.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const STORE = 'Projects/Studio Upgrade/Studio Upgrade.md';
const WINTER = 'Projects/Winter Menu Launch/Winter Menu Launch.md';
const NOTES = {
  [STORE]: `---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 80\nowner: Sam Taylor\ndue: "2026-11-20"\n---\n# Studio Upgrade\n\n## Summary\n\nEvery store’s point-of-sale PCs move to the new build before the holiday trading period.\n\n## What’s next\n\n- [ ] Send the reconciliation v4 to finance — Sam Taylor · by 14 Oct 2026\n- [ ] Chase the 11 spare tills — Priya Shah · by 24 Oct 2026\n\n## People\n\n- **Sam Taylor** — Project owner\n- **Priya Shah** — Rollout lead\n\n## Risks and issues\n\n- **High** — 11 spare tills can’t be reached remotely\n\n## Updates\n\n- **15 Oct 2026** — 212 of 236 tills done. *From:* Store_Upgrade_Status.xlsx\n`,
  [WINTER]: `---\ntype: project\nstatus: active\nhealth: on track\nprogress: 60\nowner: Alex Lee\n---\n# Winter Menu Launch\n\n## Summary\n\nThe bakery’s winter menu: new soups and the website page.\n\n## What’s next\n\n- [ ] Photograph the soups — Alex Lee\n`,
  'Meetings/Harbour site meeting.md': `---\ntype: meeting\ndate: 2026-10-16\nattendees: [Priya Shah, Sam Taylor]\n---\n## Actions\n- [ ] Approve the lighting quote — Priya — by Friday\n- Sam to confirm the cabling contractor\n`,
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios.\n',
};

/** The notes in memory, and Ironleaf's steps as the app takes them (the project page's edit with its history). */
function makeHost(dataDir, overrides = {}) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const history = new M.ProjectHistory();
  const kept = [];
  const trashed = [];
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    kept.push({ rel, text });
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [...new Set([...files.keys()].filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async () => {},
    move: async () => {
      throw new Error('no moves here');
    },
    trash: async () => {},
    clean,
    today: () => 'Saturday 17 October 2026 (2026-10-17)',
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
    editProject: async (rel, edits, by, words) => {
      const before = index.content(rel);
      const p = M.parseProject(before, rel);
      // The project-edit path's own check, as the app's does it (src/main/app.ts): every add runs the one mechanism.
      const rest = [...edits];
      let said = words;
      const adds = rest.filter((e) => e && e.kind === 'add' && e.list === 'next');
      if (adds.length) {
        const { planned, updates } = await M.planNextAdds(index, rel, adds.map((e) => e.item), {});
        await M.writeNoteUpdates(index, planned, writeNote);
        rest.splice(0, rest.length, ...rest.filter((e) => !(e && e.kind === 'add' && e.list === 'next')), ...M.plannedEdits(planned));
        said = M.plannedWords(planned, updates) ?? said;
        if (!rest.length) return { file: rel, words: said ?? 'Already there.', before, after: before };
      }
      const done = rest.map((e) => M.applyProjectEdit(p, e, '17 Oct 2026'));
      const after = M.serializeProject(p, before);
      said = said ?? (done.length === 1 ? done[0] : `Made ${done.length} changes.`);
      await writeNote(rel, after);
      history.record(rel, { before, after, words: said, by });
      return { file: rel, words: said, before, after };
    },
    undoProject: async (file, step, words) => {
      const top = history.peek(file);
      if (top && top.after === step.after) history.shift(file, false);
      else history.record(file, { before: step.after, after: step.before, words, by: 'you' });
      await writeNote(file, step.before);
    },
    createProject: async (name) => {
      const rel = `Projects/${name}/${name}.md`;
      await writeNote(rel, `---\ntype: project\nstatus: planning\n---\n# ${name}\n`);
      return rel;
    },
    writeNote,
    trash: async (rel) => {
      trashed.push(rel);
      files.delete(rel);
      reindex(rel);
    },
    today: () => M.todayData(index, { path: 'Daily/2026-10-17.md', exists: files.has('Daily/2026-10-17.md') }),
    dailyPath: () => 'Daily/2026-10-17.md',
    dailyNote: async () => {
      if (!files.has('Daily/2026-10-17.md')) await writeNote('Daily/2026-10-17.md', '# 17 October\n');
      return 'Daily/2026-10-17.md';
    },
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    changed: () => {},
    ...overrides,
  };
  return { host, files, history, kept, trashed };
}

let n = 0;
async function setup(opts = {}, overrides = {}) {
  const dataDir = path.join(work, `data-${++n}`);
  const t = makeHost(dataDir, overrides);
  const access = new M.AgentAccess(t.host);
  access.load();
  return { ...t, access, dataDir };
}
const words = (r) => r.content.map((c) => c.text).join('\n');
/** Connect an AI at a level: Read only for 'read', Read and write for anything more. */
const agentOf = (level) => ({ level: level === 'read' ? 'read' : 'edit' });
/** One call from another AI app on this PC, at that agent's level (the local MCP server's own door). */
async function callAs(access, a, name, args) {
  await access.setLocalMcp({ on: true, level: a.level });
  return access.asLocalMcp(name, args);
}
const AS = 'Other AI apps';

test('reads: compact answers from the projects, Today, the timeline, meetings and notes', async () => {
  const { access } = await setup();
  const a = agentOf('read');
  const list = JSON.parse(words(await callAs(access, a, 'projects_list', {})));
  assert.deepEqual(list.projects.map((p) => p.name), ['Studio Upgrade', 'Winter Menu Launch']);
  assert.equal(list.projects[0].health, 'at risk');
  const p = JSON.parse(words(await callAs(access, a, 'project_get', { project: 'studio upgrade' })));
  assert.equal(p.name, 'Studio Upgrade');
  assert.deepEqual(p.next.map((x) => [x.n, x.what]), [[1, 'Send the reconciliation v4 to finance'], [2, 'Chase the 11 spare tills']]);
  assert.equal(p.risks[0].level, 'high');
  const today = JSON.parse(words(await callAs(access, a, 'today_get', {})));
  assert.equal(today.projects, 2);
  assert.ok(Array.isArray(today.overdue) && Array.isArray(today.atRisk));
  const tl = JSON.parse(words(await callAs(access, a, 'timeline_get', { days_back: 30, days_ahead: 60 })));
  assert.ok(tl.dates.some((d) => d.project === 'Studio Upgrade'));
  const meetings = JSON.parse(words(await callAs(access, a, 'meetings_list', { days: 3650 })));
  assert.equal(meetings.meetings[0].path, 'Meetings/Harbour site meeting.md');
  const actions = JSON.parse(words(await callAs(access, a, 'meeting_actions', { note: 'Harbour site meeting' })));
  assert.ok(actions.actions.some((x) => /Approve the lighting quote/.test(x.what)));
  assert.match(words(await callAs(access, a, 'vault_search', { query: 'deck oven' })), /Notes\/Oven service\.md/);
  assert.match(words(await callAs(access, a, 'vault_search', { query: 'nothing-like-this' })), /Nothing in Ironleaf matches “nothing-like-this”\. Try other words\./, 'the catalogue misses in the same words as the side chat (seams O3)');
  assert.match(words(await callAs(access, a, 'note_read', { path: 'Oven service' })), /serviced every March/);
  const overview = words(await callAs(access, a, 'vault_overview', {}));
  assert.match(overview, /Projects \(2\): Studio Upgrade/);
  assert.ok(!overview.includes('Private notes'), 'the overview never shows Private notes');
  const nope = await callAs(access, a, 'project_get', { project: 'Harbour' });
  assert.equal(nope.isError, true);
  assert.match(words(nope), /no project called “Harbour”.*Studio Upgrade/);
});

test('a step is a short action with a person, an update a line or two', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const before = files.get(STORE);
  const long = 'Get Tessaly’s answers to the challenge list: BYOD and standardisation justification, equipment and labour breakdown (columns M and O), the 20% uplift, the LED display and shared screen, and the duplicate PDU lines across the Eastwick rooms';
  const r1 = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: long, who: 'Tessaly' });
  assert.ok(r1.isError && /one short action someone does, under 25 words/.test(words(r1)), words(r1));
  const r2 = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Join the alignment call', who: 'Fri 23 Oct, 11:00 AM AEDT' });
  assert.ok(r2.isError && /who is the person who does it, not a day/.test(words(r2)), words(r2));
  const r3 = await callAs(access, a, 'project_log_update', { project: 'Studio Upgrade', what: Array(70).fill('another').join(' ') });
  assert.ok(r3.isError && /one or two plain sentences, under 50 words/.test(words(r3)), words(r3));
  assert.equal(files.get(STORE), before, 'nothing written');
  assert.ok(!(await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Ask Tessaly for the Northgate re-quote', who: 'Priya Shah', when: '30 Oct 2026' })).isError, 'a short step goes in');
});

test('systems rows (5 Nov 2026, records as data): an agent reads a list row as its record; writes go through the Systems tools', async () => {
  const { access, host } = await setup();
  const a = agentOf('read');
  const table = '---\ntype: systems-table\ntable: services\nversion: 1\n---\n# Services\n\nOne line per service. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Runs on | Address | Port | Status | Depends on | Runbook | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Photo library | Media | [[Media box]] | http://media.local:2342 | 2342 | Up |  |  | 2026-10-23 |  |  |\n';
  host.index.set('Home/Systems and Home Lab/Services.md', table, 0, table.length);
  const r = await callAs(access, a, 'note_read', { path: 'Home/Systems and Home Lab/Services.md#photo-library' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Photo library/);
  assert.match(words(r), /2342/, 'its facts read too');
  assert.doesNotMatch(words(r), /\| --- \|/, 'the agent reads the record, not the whole list');
  const w = agentOf('edit');
  const nope = await callAs(access, w, 'note_append', { path: 'Home/Systems and Home Lab/Services.md#photo-library', text: 'hello' });
  assert.equal(nope.isError, true);
  assert.match(words(nope), /Systems tools/, 'a row is changed through the Systems tools, not note tools');
});

test('an edit goes through the project’s own edit: in its history with the agent’s name, in What agents did, and undone', async () => {
  const { access, files, history } = await setup();
  const a = agentOf('edit');
  const r = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Book the second wave for Sydney cafes', who: 'Priya Shah', when: '30 Oct 2026' });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Added a next step: “Book the second wave for Sydney cafes” in Studio Upgrade/);
  assert.ok(files.get(STORE).includes('- [ ] Book the second wave for Sydney cafes — Priya Shah · by 30 Oct 2026'));
  assert.equal(history.peek(STORE).by, `${AS} (agent)`, 'the project’s history says which agent');
  const state = await access.state();
  assert.equal(state.activity[0].agentName, AS);
  assert.equal(state.activity[0].project.name, 'Studio Upgrade');
  assert.equal(state.activity[0].canUndo, true);
  assert.match(await access.undo(state.activity[0].id), /^Undone: added a next step/);
  assert.equal(files.get(STORE), NOTES[STORE], 'the project is as it was');
  assert.equal((await access.state()).activity[0].undone, true);
  // p12-close-and-noise A (4 Nov 2026): marking done with open tasks never closes silently — the open tasks come back
  // in plain words, and the project stays as it is.
  const blocked = await callAs(access, a, 'project_set_field', { project: 'Studio Upgrade', field: 'status', value: 'done' });
  assert.ok(!blocked.isError);
  assert.match(words(blocked), /Send the reconciliation v4 to finance/);
  assert.doesNotMatch(files.get(STORE), /^status: done$/m);
  // Facts, updates and ticks too.
  assert.ok(!(await callAs(access, a, 'project_set_field', { project: 'Studio Upgrade', field: 'health', value: 'On track' })).isError);
  assert.match(files.get(STORE), /^health: on track$/m);
  assert.ok(!(await callAs(access, a, 'project_log_update', { project: 'Studio Upgrade', what: 'Sydney wave booked', from: 'Email from Priya' })).isError);
  assert.match(files.get(STORE), /— Sydney wave booked \*From:\* Email from Priya/);
  assert.ok(!(await callAs(access, a, 'project_tick_next_step', { project: 'Studio Upgrade', step: 1 })).isError);
  assert.match(files.get(STORE), /- \[x\] Send the reconciliation v4/);
  const bad = await callAs(access, a, 'project_set_field', { project: 'Studio Upgrade', field: 'folder', value: 'C:\\Users' });
  assert.equal(bad.isError, true, 'a project’s folder on the PC can’t be pointed elsewhere by an agent');
  // A note made, added to, and a project file refused through the note tools.
  assert.ok(!(await callAs(access, a, 'note_create', { path: 'Notes/Till audit', content: '# Till audit\n' })).isError);
  assert.equal(files.get('Notes/Till audit.md'), '# Till audit\n');
  assert.ok(!(await callAs(access, a, 'note_append', { path: 'Notes/Till audit.md', text: '- 11 spare tills', heading: 'Found' })).isError);
  assert.match(files.get('Notes/Till audit.md'), /## Found\n\n- 11 spare tills/);
  const proj = await callAs(access, a, 'note_append', { path: STORE, text: 'sneaky' });
  assert.equal(proj.isError, true);
  assert.match(words(proj), /project’s file: use the project tools/);
  // A capture: a task for a project with a day in its words becomes its next step with a date.
  const cap = await callAs(access, a, 'capture', { kind: 'task', text: 'Order two spare tills by Friday', project: 'Studio Upgrade' });
  assert.ok(!cap.isError, words(cap));
  assert.match(files.get(STORE), /- \[ \] Order two spare tills — by \d+ [A-Z][a-z]{2} \d{4}/);
  const capNote = await callAs(access, a, 'capture', { text: 'Ask the landlord about the loading dock' });
  assert.match(words(capNote), /today’s note/);
  assert.match(files.get('Daily/2026-10-17.md'), /## Captured\n\n- \d\d:\d\d Ask the landlord about the loading dock/);
});

test('capturing the same note twice grows one note, never a second; a task keeps its detail', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const one = await callAs(access, a, 'capture', { text: 'Tiler short of grout\ntwo bags short', project: 'Studio Upgrade' });
  assert.ok(!one.isError, words(one));
  const two = await callAs(access, a, 'capture', { text: 'Tiler short of grout\nfound one bag', project: 'Studio Upgrade' });
  assert.ok(!two.isError, words(two));
  const note = files.get('Projects/Studio Upgrade/Tiler short of grout.md');
  assert.match(note, /two bags short/);
  assert.match(note, /found one bag/, 'the second capture joins the first note');
  assert.ok(![...files.keys()].some((k) => /Tiler short of grout 2/.test(k)), 'no “ 2” note');
  const task = await callAs(access, a, 'capture', { kind: 'task', text: 'Ring Priya\nabout the lease', project: 'Studio Upgrade' });
  assert.ok(!task.isError, words(task));
  assert.match(files.get(STORE), /- \[ \] Ring Priya\n  about the lease/, 'the step keeps its detail under it');
});

test('a Read agent can’t change anything', async () => {
  const { access, files } = await setup();
  const a = agentOf('read');
  const r = await callAs(access, a, 'note_create', { path: 'Notes/x.md', content: 'x' });
  assert.equal(r.isError, true);
  assert.match(words(r), /Connect an AI is set to Read only in Ironleaf/);
  assert.ok(!files.has('Notes/x.md'));
  // Switched off, nothing at all.
  await access.setLocalMcp({ on: false });
  const r2 = await access.asLocalMcp('note_read', { path: 'Notes/Oven service.md' });
  assert.equal(r2.isError, true);
});

test('Private notes, settings, keys and the licence are never reachable', async () => {
  const { access, files } = await setup();
  const a = agentOf('jobs');
  for (const [tool, args] of [
    ['note_read', { path: 'Private notes/Diary.md' }],
    ['note_read', { path: 'private notes/diary' }],
    ['note_append', { path: 'Private notes/Diary.md', text: 'x' }],
    ['note_create', { path: 'Private notes/New.md', content: 'x' }],
    ['note_delete', { path: 'Private notes/Diary.md' }],
  ]) {
    const r = await callAs(access, a, tool, args);
    assert.equal(r.isError, true, `${tool} ${args.path}`);
    assert.match(words(r), /Private notes are never open to agents/);
  }
  assert.equal(files.get('Private notes/Diary.md'), NOTES['Private notes/Diary.md']);
  const listed = words(await callAs(access, a, 'notes_list', { folder: '' }));
  assert.ok(!listed.includes('Private notes'), 'never listed');
  // Outside the library (Ironleaf's own data: its settings, agents' keys) and tools that don't exist.
  for (const p of ['../agents.json', '../../settings.json', '/etc/passwd']) assert.equal((await callAs(access, a, 'note_read', { path: p })).isError, true, p);
  for (const name of ['settings_get', 'licence_get', 'keys_list', 'private_read']) assert.match(words(await callAs(access, a, name, {})), /There is no tool called/);
});

test('one catalogue: what each consumer is served, by its own names, in its own words', () => {
  const sideOwn = new Set([...M.SIDE_TOOLS.map((t) => t.name)]);
  // Every tool a consumer is said to do its own way is a catalogue tool, and the side chat really has that tool.
  for (const consumer of ['spark', 'side']) for (const [tool, own] of Object.entries(M.OWN[consumer])) {
    assert.ok(M.VAULT_TOOLS.some((t) => t.name === tool), `${consumer}: ${tool} is in the catalogue`);
    if (consumer === 'side') assert.ok(sideOwn.has(own), `the side chat has ${own}`);
  }
  // Every catalogue tool reaches every consumer: served, done its own way, or (deleting, outside agents' own) said why not.
  for (const t of M.VAULT_TOOLS) for (const consumer of ['spark', 'side']) {
    const name = M.nameFor(consumer, t.name);
    if (name === null) assert.ok(t.deletes, `${consumer} lacks ${t.name} only for a reason`);
  }
  const spark = M.catalogueFor('spark'), side = M.catalogueFor('side');
  const sparkNames = spark.map((t) => t.name);
  for (const name of ['vault_today_get', 'vault_tasks_list', 'vault_files_find', 'vault_calendar_get', 'neuralvault_reminder_set', 'neuralvault_note_move', 'neuralvault_note_set_properties', 'neuralvault_project_archive', 'neuralvault_canvas_create', 'neuralvault_template_apply', 'vault_overview']) assert.ok(sparkNames.includes(name), `the host app is served ${name}`);
  for (const t of spark) {
    assert.match(t.name, t.readOnly ? /^vault_/ : /^neuralvault_/, `${t.name}: a look is vault_*, a change neuralvault_* (the bots' permissions read them)`);
    assert.equal(M.toolOf('spark', t.name)?.name, t.tool, `${t.name} stands for ${t.tool}`);
    assert.ok(['neuralvault', 'neuralvault_more'].includes(t.family));
    assert.doesNotMatch(t.description, /waits? for the person/i, `${t.name}: nothing waits in the host app`);
  }
  assert.deepEqual(spark.filter((t) => t.family === 'neuralvault').map((t) => t.tool).sort(), ['files_find', 'note_move', 'note_set_properties', 'project_archive', 'reminder_set', 'tasks_list', 'today_get']);
  assert.ok(!sparkNames.some((n) => /delete/.test(n)), 'no deleting for the host app');
  const sideNames = side.map((t) => t.name);
  for (const name of ['today_get', 'tasks_list', 'calendar_get', 'timeline_get', 'files_find', 'project_archive', 'template_apply', 'canvas_create', 'project_tick_next_step']) assert.ok(sideNames.includes(name), `the side chat is served ${name}`);
  assert.ok(!sideNames.includes('meeting_file_actions'), 'no filing tool served: nothing to carry');
  for (const name of sideNames) assert.ok(!sideOwn.has(name), `${name} isn’t one the side chat already has`);
  assert.ok(!sideNames.includes('reminder_set') && !sideNames.includes('note_move'), 'the side chat keeps its own set_reminder and move_note');
  // Words name tools as each consumer knows them.
  const read = (list, tool) => list.find((t) => t.tool === tool);
  assert.match(read(spark, 'project_move_item').description, /vault_read/, 'the host app is told vault_read where outside agents are told project_get');
  assert.doesNotMatch(read(spark, 'project_move_item').description, /project_get/);
  assert.match(read(side, 'reviews_list').description, /read_note/, 'the side chat is told read_note');
  assert.equal(M.wordsFor('mcp', 'Read it with note_read.'), 'Read it with note_read.');
  // Other AI apps keep the whole list, the four new tools included.
  for (const name of ['files_find', 'tasks_list', 'calendar_get', 'reminder_set']) assert.ok(M.VAULT_TOOLS.some((t) => t.name === name), `MCP has ${name}`);
  assert.equal(M.VAULT_TOOLS.find((t) => t.name === 'reminder_set').level, 'edit', 'a reminder is an edit');
});

test('Ironleaf’s own AIs call the catalogue: same handlers, their gate, nothing waits', async () => {
  const catalogue = [
    { path: 'Projects/Studio Upgrade/Files/Keg steamer manual.pdf', name: 'Keg steamer manual.pdf', folder: 'Projects/Studio Upgrade/Files', size: 2_400_000, mtime: Date.parse('2026-10-27T10:00:00Z'), kind: 'Manual', title: 'Keg steamer manual', what: 'the steamer’s manual', source: { by: 'the host app', how: 'agent', from: 'C:\\Users\\sam\\Downloads\\keg-steamer.pdf', at: '2026-10-27T10:00:00Z' }, added: '2026-10-27T10:00:00Z', record: 'Projects/Studio Upgrade/Studio Upgrade.md', version: 1 },
    { path: 'Business/Files/Harbour logo v3.png', name: 'Harbour logo v3.png', folder: 'Business/Files', size: 80_000, mtime: Date.parse('2026-10-26T10:00:00Z'), kind: 'Logo', title: 'Harbour logo', what: 'the logo', added: '2026-10-26T10:00:00Z', version: 3 },
    { path: 'Private notes/Files/secret.pdf', name: 'secret.pdf', folder: 'Private notes/Files', size: 1, mtime: 0, kind: 'Document', title: 'secret', what: '', version: 1 },
  ];
  const tasks = { today: '2026-10-17', tasks: [
    { key: 'a', path: 'Projects/Studio Upgrade/Studio Upgrade.md', title: 'Studio Upgrade', line: 1, project: STORE, projectName: 'Studio Upgrade', people: [], allTags: [], mtime: 0, done: false, mark: ' ', text: 'Send the reconciliation', words: 'Send the reconciliation', due: '2026-10-14', time: null, reminder: false, repeats: false, tags: [], links: [] },
    { key: 'b', path: 'Notes/Oven service.md', title: 'Oven service', line: 1, project: null, projectName: null, people: [], allTags: [], mtime: 0, done: false, mark: ' ', text: 'Book the oven service', words: 'Book the oven service', due: '2026-11-02', time: null, reminder: false, repeats: false, tags: [], links: [] },
  ] };
  const { access, files } = await setup({}, { fileCatalogue: async () => catalogue, tasks: () => tasks, calendar: async () => ({ connected: false, reason: 'not-set-up' }) });
  const spark = { id: 'neuralspark', name: 'the host app', consumer: 'spark' };
  const found = words(await access.asOwn(spark, null, 'files_find', { query: 'keg steamer' }));
  assert.match(found, /Keg steamer manual\.pdf — with “Studio Upgrade” \(Projects\/Studio Upgrade\/Studio Upgrade\.md\): it shows on that page/);
  assert.match(found, /from C:\\Users\\sam\\Downloads\\keg-steamer\.pdf/, 'where it came from');
  assert.match(words(await access.asOwn(spark, null, 'files_find', { query: 'downloads steamer' })), /Keg steamer manual/, 'found by where it came from too');
  assert.match(words(await access.asOwn(spark, null, 'files_find', { query: 'logo' })), /Harbour logo v3\.png — loose in Business\/Files .*version 3/);
  assert.doesNotMatch(words(await access.asOwn(spark, null, 'files_find', { query: 'secret' })), /secret\.pdf/, 'never a Private note’s file');
  assert.match(words(await access.asOwn(spark, null, 'files_find', { query: 'tractor' })), /No file in Ironleaf matches “tractor”/);
  const overdue = JSON.parse(words(await access.asOwn(spark, null, 'tasks_list', { when: 'overdue' })));
  assert.deepEqual(overdue.tasks.map((t) => [t.what, t.overdue, t.project]), [['Send the reconciliation', true, 'Studio Upgrade']]);
  assert.equal(JSON.parse(words(await access.asOwn(spark, null, 'tasks_list', {}))).count, 2);
  assert.match(words(await access.asOwn(spark, null, 'calendar_get', {})), /No calendar is connected/);
  // A reminder: Ironleaf's own ⏰ line, through the side chat's own handler.
  const r = await access.asOwn(spark, null, 'reminder_set', { what: 'Renew the rego', when: '20 Nov 2026 at 9am' });
  assert.ok(!r.isError, words(r));
  assert.match(files.get('Reminders.md'), /- \[ \] Renew the rego ⏰ 2026-11-20 09:00/);
  assert.equal((await access.asOwn(spark, null, 'reminder_set', { what: 'x', when: 'sometime soonish' })).isError, true, 'a moment it can’t tell is a failed step');
  // A near one offers Replace or Keep through this door too, and replace answers it (seams O2).
  const near = await access.asOwn(spark, null, 'reminder_set', { what: 'Renew the registration', when: '20 Nov 2026 at 9am' });
  assert.ok(!near.isError, words(near));
  assert.match(words(near), /Replace or Keep/);
  const kept = await access.asOwn(spark, null, 'reminder_set', { what: 'Renew the registration', when: '20 Nov 2026 at 9am', replace: false });
  assert.ok(!kept.isError, words(kept));
  assert.match(files.get('Reminders.md'), /Renew the registration ⏰ 2026-11-20 09:00/);
  const again = await access.asOwn(spark, null, 'reminder_set', { what: 'Renew the rego', when: '20 Nov 2026 at 9am' });
  assert.match(words(again), /already set in your note “Reminders”/, 'the same one through this door is already set (seams O1)');
  // A change with the former host app's own call: done at once, nothing waits, nothing in What
  // agents did.
  const replaced = await access.asOwn(spark, null, 'note_replace', { path: 'Notes/Oven service.md', find: 'every March', text: 'every April' });
  assert.ok(!replaced.isError, words(replaced));
  assert.match(files.get('Notes/Oven service.md'), /every April/);
  assert.equal((await access.state()).activity?.length ?? 0, 0, 'the host app’s own calls are not listed as an outside agent’s');
  // Not for Ironleaf's own AIs: deleting (until the bin), jobs, outside agents' approvals; and unknown askers.
  assert.equal((await access.asOwn(spark, null, 'note_delete', { path: 'Notes/Oven service.md' })).isError, true);
  assert.ok(files.has('Notes/Oven service.md'));
  assert.equal((await access.asOwn({ id: 'someone', name: 'X', consumer: 'spark' }, null, 'vault_overview', {})).isError, true);
  // The side chat's served tools are its own list: reminder_set is its set_reminder, not served again.
  assert.equal((await access.asOwn({ id: 'assistant', name: 'Assistant', consumer: 'side' }, null, 'reminder_set', { what: 'x', when: 'tomorrow' })).isError, true);
  assert.ok(!words(await access.asOwn({ id: 'assistant', name: 'Assistant', consumer: 'side' }, null, 'today_get', {})).startsWith('There is no'));
  // An outside agent's id never comes in through this door.
  assert.equal((await access.asOwn({ id: 'agent:reader', name: 'Reader', consumer: 'spark' }, null, 'tasks_list', {})).isError, true);
});

test('a tag given is added, never the note’s other tags wiped (8.0 V1): the side chat and the catalogue alike', async () => {
  const { host, files } = await setup();
  await host.writeNote('Notes/Client list.md', '---\ntags: [clients, urgent]\n---\n# Client list\n');
  const side = new M.AgentTools(host.notes, [], () => {});
  const run = (args) => side.run({ id: 'x', name: 'set_properties', arguments: JSON.stringify(args) });
  const tagsNow = () => { const t = files.get('Notes/Client list.md'), m = /tags:(.*)\n((?:\s+- .*\n)*)/.exec(t); return m ? (m[1].trim() ? m[1].replace(/[\[\]\s]/g, '').split(',') : m[2].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim())).filter(Boolean) : []; };
  let r = await run({ path: 'Notes/Client list.md', properties: { tags: ['vip'] } });
  assert.ok(!r.isError, r.text);
  assert.deepEqual(tagsNow(), ['clients', 'urgent', 'vip'], 'a tag given is added');
  r = await run({ path: 'Notes/Client list.md', remove_tags: ['urgent'] });
  assert.ok(!r.isError, r.text);
  assert.deepEqual(tagsNow(), ['clients', 'vip'], 'remove_tags takes one off, the rest stay');
  r = await run({ path: 'Notes/Client list.md', properties: { tags: ['only'] }, replace_tags: true });
  assert.deepEqual(tagsNow(), ['only'], 'only replace_tags makes the list exactly what was given');
  assert.match(M.catalogueFor('spark').find((t) => t.tool === 'note_set_properties').description, /added to the note’s own/, 'the catalogue says the same to the host app');
});

test('note_replace keeps a bill’s paid and due as they were (no way around Mark paid)', async () => {
  assert.match(M.AGENT_TOOLS.find((t) => t.name === 'note_replace').description, /paid and due stay as they are/);
  assert.match(M.AGENT_TOOLS.find((t) => t.name === 'note_replace').description, /finance_bill_mark_paid/);
  const { access, files, host } = await setup();
  const rel = 'Me/Finance/Bills/Harbour Credit Card.md';
  await host.writeNote(rel, '---\ntype: bill\nkind: Bill\namount: 150.00\ncycle: Monthly\ndue: 2026-11-08\ncategory: Loans and cards\nautopay: Yes\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n');
  const a = agentOf('edit');
  const moved = await callAs(access, a, 'note_replace', { path: rel, find: 'due: 2026-11-08', text: 'due: 2026-11-15' });
  assert.ok(!moved.isError, words(moved));
  assert.match(words(moved), /finance_bill_add/);
  assert.match(files.get(rel), /due: 2026-11-08/);
  const typed = await callAs(access, a, 'note_replace', { path: rel, find: 'status: Active', text: 'status: Active\npaid: 2026-11-02' });
  assert.ok(!typed.isError, words(typed));
  assert.match(words(typed), /finance_bill_mark_paid/);
  assert.doesNotMatch(files.get(rel), /^paid:/m);
  const body = await callAs(access, a, 'note_replace', { path: rel, find: '## Notes', text: '## Notes\n\nHoliday flights are on this card.' });
  assert.equal(words(body), `Changed ${rel}.`, 'a change that leaves them alone says nothing extra');
});


test('the side chat carries out a host vault tool only when the checked catalogue serves it (8.0 V1, V8)', () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const call = app.slice(app.indexOf('ai.catalogue = '), app.indexOf('ai.catalogue = ') + 1200);
  assert.match(call, /sparkDefs\(host\.sparkVault\)\.some\(\(t\) => t\.name === name\)/, 'routed by the checked list (known name, object schema), not the raw list the host app sends');
  assert.doesNotMatch(call, /host\.sparkVault\?\.tools\(\)\.some/, 'a tool the catalogue does not know is never carried out as the side chat');
});

test('a line said again stays single: steps update the line and name it, never doubled (updates, decisions, people still skip)', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  assert.ok(!(await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Book the Sydney wave', who: 'Priya Shah' })).isError);
  const again = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'book the Sydney wave!', who: 'Priya Shah' });
  assert.equal(again.isError, undefined, 'a repeat is said, not an error');
  assert.match(words(again), /already there: Book the Sydney wave — Priya Shah in Studio Upgrade\./, 'case and punctuation aside, the same step');
  assert.equal(files.get(STORE).split('Book the Sydney wave').length - 1, 1, 'on the list once');
  const mixed = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', steps: [{ what: 'Book the Sydney wave', who: 'Priya Shah' }, { what: 'Book the Sydney wave' }, { what: 'Ring the landlord' }] });
  assert.match(words(mixed), /Added a next step\. already there: Book the Sydney wave — Priya Shah/, 'the same words without who update the line, never a second line');
  assert.equal(files.get(STORE).split('Book the Sydney wave').length - 1, 1, 'still once: no owner, no new line');
  const twice = await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', steps: [{ what: 'Mop the floor' }, { what: 'Mop the floor' }] });
  assert.match(words(twice), /Added a next step\. already there: Mop the floor/);
  // A done step said again is a new ask, and goes on.
  await callAs(access, a, 'project_tick_next_step', { project: 'Studio Upgrade', step: 3 });
  assert.match(words(await callAs(access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Book the Sydney wave', who: 'Priya Shah' })), /Added a next step/);
  // Updates, decisions and people alike.
  assert.ok(!(await callAs(access, a, 'project_log_update', { project: 'Studio Upgrade', what: 'Tills done' })).isError);
  assert.match(words(await callAs(access, a, 'project_log_update', { project: 'Studio Upgrade', what: 'Tills done.' })), /Nothing added: “Tills done\.” is already logged \(update \d+\)\./);
  assert.ok(!(await callAs(access, a, 'project_add_item', { project: 'Studio Upgrade', list: 'decisions', item: { what: 'Close at 8pm' } })).isError);
  assert.match(words(await callAs(access, a, 'project_add_item', { project: 'Studio Upgrade', list: 'decisions', item: { what: 'Close at 8pm!' } })), /Nothing added: “Close at 8pm!” \(already decision \d+\)\./);
  assert.match(words(await callAs(access, a, 'project_add_item', { project: 'Studio Upgrade', list: 'people', item: { name: 'Sam Taylor' } })), /Nothing added: “Sam Taylor” \(already person 1\)\./);
  assert.equal(files.get(STORE).split('**Sam Taylor** — Project owner').length - 1, 1, 'the person once');
  // A captured step already open stays single too.
  const cap = await callAs(access, a, 'capture', { kind: 'task', text: 'Order two spare tills by Friday', project: 'Studio Upgrade' });
  assert.ok(!cap.isError, words(cap));
  assert.match(words(await callAs(access, a, 'capture', { kind: 'task', text: 'Order two spare tills by Friday', project: 'Studio Upgrade' })), /already there: Order two spare tills/);
});

test('a second note on the same subject is refused until it has been read', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const refused = await callAs(access, a, 'note_create', { path: 'Baking/Oven service.md', content: '# Oven service\n\nOther words.\n' });
  assert.equal(refused.isError, true);
  assert.match(words(refused), /There is already “Oven service” at Notes\/Oven service\.md\. Read it first \(note_read\)/);
  assert.ok(!files.has('Baking/Oven service.md'), 'no second note');
  assert.ok(!(await callAs(access, a, 'note_read', { path: 'Notes/Oven service.md' })).isError);
  const judged = await callAs(access, a, 'note_create', { path: 'Baking/Oven service.md', content: '# Oven service\n\nOther words.\n' });
  assert.ok(!judged.isError, words(judged));
  assert.ok(files.has('Baking/Oven service.md'), 'read first, then truly another: goes ahead');
});

test('a near-named project is found, not started twice', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  const one = await callAs(access, a, 'project_create', { name: 'Studio' });
  assert.equal(one.isError, true);
  assert.match(words(one), /There’s already a project called “Studio Upgrade”/);
  assert.ok(![...files.keys()].some((k) => k === 'Projects/Studio/Studio.md'), 'no second project');
  const depot = await callAs(access, a, 'project_create', { name: 'Depot' });
  assert.ok(!depot.isError, words(depot));
  assert.ok(files.has('Projects/Depot/Depot.md'), 'a name of its own goes ahead');
});

test('adding what is already there adds nothing: a retried append or task writes once', async () => {
  const { access, files } = await setup();
  const a = agentOf('edit');
  assert.ok(!(await callAs(access, a, 'note_append', { path: 'Notes/Oven service.md', text: 'Serviced this March.' })).isError);
  assert.match(words(await callAs(access, a, 'note_append', { path: 'Notes/Oven service.md', text: 'Serviced this March.' })), /already the last thing in Notes\/Oven service\.md, so nothing was added/);
  assert.equal(files.get('Notes/Oven service.md').split('Serviced this March.').length - 1, 1, 'written once');
  await access.setLocalMcp({ on: true, level: 'edit' });
  assert.match(words(await access.asLocalMcp('note_add_task', { path: 'Notes/Oven service.md', text: 'Order filters' })), /Added to Notes\/Oven service\.md/);
  assert.match(words(await access.asLocalMcp('note_add_task', { path: 'Notes/Oven service.md', text: 'Order filters' })), /already there: Order filters/);
  assert.equal(files.get('Notes/Oven service.md').split('Order filters').length - 1, 1, 'the retried task writes once');
});

test('note_read and read_note read a Word file, a picture and a long note the same way, in the same parts (seams O4)', async () => {
  const { access, host, files } = await setup();
  const long = `# Harbour minutes\n\n${'Agreed the crane arrives Monday. '.repeat(800)}`;
  files.set('Meetings/Harbour.md', long);
  host.index.set('Meetings/Harbour.md', long, Date.now(), long.length);
  host.index.setFiles(['Docs/Harbour quote.docx', 'Photos/Whiteboard.jpg']);
  const docs = { 'Docs/Harbour quote.docx': 'Harbour lighting quote: $12,400 for the main room, $3,100 for the foyer.' };
  host.notes.readNoteDocument = async (rel) => (rel in docs ? docs[rel] : null);
  host.notes.pictureWords = { search: () => [], read: (rel) => (rel === 'Photos/Whiteboard.jpg' ? 'whiteboard: order more cable ties' : null), has: (rel) => rel === 'Photos/Whiteboard.jpg' };
  const a = agentOf('edit');
  const sideRead = async (args) => (await new M.AgentTools(host.notes, [], () => {}).run({ id: 'c', name: 'read_note', arguments: JSON.stringify(args) })).text;
  for (const args of [{ path: 'Notes/Oven service.md' }, { path: 'Meetings/Harbour.md' }, { path: 'Meetings/Harbour.md', part: 2 }, { path: 'Docs/Harbour quote.docx' }, { path: 'Photos/Whiteboard.jpg' }]) {
    assert.equal(words(await callAs(access, a, 'note_read', args)), await sideRead(args), `one result for ${JSON.stringify(args)}`);
  }
  assert.match(await sideRead({ path: 'Docs/Harbour quote.docx' }), /Harbour lighting quote: \$12,400/, 'the Word file reads as its words');
  assert.match(await sideRead({ path: 'Photos/Whiteboard.jpg' }), /order more cable ties/, 'the picture reads as its recognised words');
  assert.match(await sideRead({ path: 'Meetings/Harbour.md' }), /part 1 of 3: ask for part 2 for more/, 'the same paging words');
  // A miss keeps each door's own words (its own tool names to try next).
  assert.match(words(await callAs(access, a, 'note_read', { path: 'Nope' })), /There is no note.*vault_search or notes_list/);
  assert.match(await sideRead({ path: 'Nope' }), /There is no note.*list_notes or search_notes/);
  assert.match(M.VAULT_TOOLS.find((t) => t.name === 'note_read').description, /Word, Excel, PowerPoint/);
  assert.match(M.SIDE_TOOLS.find((t) => t.name === 'read_note').description, /Word, Excel, PowerPoint/);
});
