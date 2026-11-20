// node --test tests/agent.test.mjs — the chat's assistant at work (src/main/agent.ts; 16 Oct 2026). Its tools on made-up
// notes in memory and a made-up projects folder on disk: it reads only folders the person named (never through a
// shortcut that leads out), makes and changes notes, and one Undo puts an answer's changes back (leaving what the person
// changed since). The loop with a scripted model: tool calls, tools' answers, thinking aloud, the step limit.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Notes in memory, indexed as the app indexes them. */
function fakeHost(notes) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  const folders = new Set();
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const trashed = [];
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [...new Set([...folders, ...[...files.keys()].filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/')))])] }),
    exists: async (rel) => files.has(rel) || folders.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    write: async (rel, text) => {
      files.set(rel, text);
      reindex(rel);
    },
    makeFolder: async (rel) => folders.add(rel),
    move: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
      reindex(from);
      reindex(to);
      return { path: to, linksUpdated: 0 };
    },
    trash: async (rel) => {
      trashed.push(rel);
      files.delete(rel);
      folders.delete(rel);
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Friday 16 October 2026 (2026-10-16)',
  };
  return { host, files, trashed };
}
const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });

test('folders the person named are found in their words', () => {
  assert.deepEqual(M.namedPaths(['C:\\Users\\jarlow\\Downloads\\projects - go and inventory this folder.. here are all my projects']), ['C:\\Users\\jarlow\\Downloads\\projects']);
  assert.deepEqual(M.namedPaths(['look in "D:\\Work\\Client files", then \\\\nas\\share\\docs.']), ['D:\\Work\\Client files', '\\\\nas\\share\\docs']);
  assert.deepEqual(M.namedPaths([(process.env.HOME || '') + '/projects/site is the one']), [(process.env.HOME || '') + '/projects/site is the one']);
  assert.deepEqual(M.namedPaths(['no paths here, just C: drive talk']), []);
  assert.deepEqual(M.namedPaths(['C:\\Users\\jarlow\\Downloads\\projects\\04 Marlowe Gallery Fit-out (Tessaly Studio)']), ['C:\\Users\\jarlow\\Downloads\\projects\\04 Marlowe Gallery Fit-out (Tessaly Studio)'], 'a closing bracket that is part of the folder name stays');
  assert.deepEqual(M.namedPaths(['(see C:\\Work\\plans)']), ['C:\\Work\\plans'], 'a closing bracket around the path goes');
});

test('looking through the notes: overview, search, lists, recent, read, links', async () => {
  const { host } = fakeHost({ '05 Decisions/Decision Log.md': '---\ntype: log\n---\n# Decision Log\n- 2026-10-10 We chose the harbour site. #decision', 'Home.md': 'See [[Decision Log]].', '02 Projects/Harbour Cafe.md': 'Status: planning' });
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const overview = await run(tools, 'notes_overview', {});
  assert.match(overview.text, /3 notes/);
  assert.match(overview.text, /05 Decisions \(1\)/);
  assert.match(overview.text, /type \(1\)/);
  assert.match((await run(tools, 'search_notes', { query: 'chose' })).text, /Decision Log\.md/);
  assert.match((await run(tools, 'search_notes', { query: 'nothing-like-this' })).text, /Nothing in Ironleaf matches “nothing-like-this”\. Try other words\./, 'one miss in one voice on every door (seams O3)');
  assert.match((await run(tools, 'list_notes', { folder: '02 Projects' })).text, /Harbour Cafe\.md/);
  assert.match((await run(tools, 'recent_notes', { days: 7 })).text, /Home\.md/);
  assert.match((await run(tools, 'read_note', { path: 'Decision Log' })).text, /harbour site/, 'a note found by its title too');
  assert.match((await run(tools, 'note_links', { path: '05 Decisions/Decision Log.md' })).text, /← Home\.md/);
  assert.equal((await run(tools, 'read_note', { path: 'Nope' })).isError, true);
  assert.ok(steps.some((s) => s.kind === 'read' && s.path === '05 Decisions/Decision Log.md'), 'reading shows as a step with the note to open');
});

test('making and changing notes, and one Undo for all of it', async () => {
  const { host, files, trashed } = fakeHost({ 'Projects.md': '---\ntags: [hub]\n---\n# Projects\n- [[Old one]]\n' });
  const tools = new M.AgentTools(host, [], () => {});
  assert.match((await run(tools, 'create_note', { path: '02 Projects/Harbour Cafe', content: '---\ntype: project\n---\n# Harbour Cafe' })).text, /Made 02 Projects\/Harbour Cafe\.md/, '.md added when left off');
  assert.equal((await run(tools, 'create_note', { path: '02 Projects/Harbour Cafe.md', content: 'again' })).isError, true, 'an existing note is never written over');
  await run(tools, 'edit_note', { path: 'Projects.md', action: 'append', text: '- [[Harbour Cafe]]' });
  assert.match(files.get('Projects.md'), /- \[\[Old one\]\]\n\n- \[\[Harbour Cafe\]\]\n$/);
  await run(tools, 'edit_note', { path: 'Projects.md', action: 'prepend', text: 'Updated today.' });
  assert.match(files.get('Projects.md'), /^---\ntags: \[hub\]\n---\nUpdated today\.\n\n# Projects/, 'prepend goes under the properties');
  assert.equal((await run(tools, 'edit_note', { path: 'Projects.md', action: 'replace', find: '- ', text: '* ' })).isError, true, 'a piece found twice is refused');
  await run(tools, 'edit_note', { path: 'Projects.md', action: 'replace', find: '[[Old one]]', text: '[[Old one]] (finished)' });
  await run(tools, 'set_properties', { path: '02 Projects/Harbour Cafe.md', properties: { status: 'planning', tags: ['project', 'cafe'] } });
  assert.match(files.get('02 Projects/Harbour Cafe.md'), /^---\ntype: project\nstatus: planning\ntags:\n  - project\n  - cafe\n---\n# Harbour Cafe/);
  await run(tools, 'move_note', { from: 'Projects.md', to: '00 Home/Projects' });
  assert.ok(files.has('00 Home/Projects.md') && !files.has('Projects.md'));
  assert.equal(tools.steps.at(-1).words, 'Moved Projects to 00 Home', 'the step reads titles, never raw paths (v8-vault-assistant F6)');
  const summary = M.summarise('t1', tools.changes);
  assert.deepEqual([summary.made, summary.changed, summary.moved], [1, 1, 1], "a note made in this answer and changed again counts as made");
  // The person changes the hub themselves after the move: Undo leaves their change and puts back the rest.
  files.set('02 Projects/Harbour Cafe.md', files.get('02 Projects/Harbour Cafe.md') + '\nMy own words.');
  const words = await M.undoChanges(host, tools.changes);
  assert.ok(files.has('Projects.md') && !files.has('00 Home/Projects.md'), 'the move is undone');
  assert.equal(files.get('Projects.md'), '---\ntags: [hub]\n---\n# Projects\n- [[Old one]]\n', 'every change to the hub is undone');
  assert.ok(files.has('02 Projects/Harbour Cafe.md') && !trashed.includes('02 Projects/Harbour Cafe.md'), 'a note the person changed since is left');
  assert.match(words, /Left as they are because you changed them since: 02 Projects\/Harbour Cafe/);
});

test('folders on this PC: only ones the person named, never through a shortcut that leads out', async () => {
  const projects = path.join(work, 'projects');
  mkdirSync(path.join(projects, 'harbour-cafe', 'node_modules', 'lib'), { recursive: true });
  mkdirSync(path.join(projects, 'site'), { recursive: true });
  writeFileSync(path.join(projects, 'harbour-cafe', 'README.md'), '# Harbour Cafe\nBookings app for the cafe.');
  writeFileSync(path.join(projects, 'harbour-cafe', 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 0]));
  writeFileSync(path.join(projects, 'site', 'data.bin'), Buffer.from([1, 0, 2, 0]));
  const secret = path.join(work, 'secret');
  mkdirSync(secret, { recursive: true });
  writeFileSync(path.join(secret, 'keys.txt'), 'not for the assistant');
  try { symlinkSync(secret, path.join(projects, 'shortcut'), 'dir'); } catch {}
  const { host } = fakeHost({});
  const tools = new M.AgentTools(host, M.namedPaths([`${projects} - take stock of these`]), () => {});
  const listing = await run(tools, 'list_pc_folder', { path: projects, depth: 3 });
  assert.match(listing.text, /harbour-cafe\/\n(?: {2}.*\n)* {2}README\.md \(41 B, \d{4}-\d{2}-\d{2}\)/);
  assert.doesNotMatch(listing.text, /node_modules\//, 'package folders are left out');
  assert.match(listing.text, /left out/);
  writeFileSync(path.join(projects, 'harbour-cafe', '.env'), 'EXAMPLE_KEY=not-a-real-key');
  assert.match((await run(tools, 'read_pc_file', { path: path.join(projects, 'harbour-cafe', 'README.md') })).text, /Bookings app/);
  const env = await run(tools, 'read_pc_file', { path: path.join(projects, 'harbour-cafe', '.env') });
  assert.equal(env.isError, true);
  assert.match(env.text, /it is a \.env file, and its values are never read out/);
  assert.match((await run(tools, 'read_pc_file', { path: path.join(projects, 'harbour-cafe', 'logo.png') })).text, /not something that can be read here/);
  assert.match((await run(tools, 'read_pc_file', { path: path.join(projects, 'site', 'data.bin') })).text, /not a text file/);
  const outside = await run(tools, 'read_pc_file', { path: path.join(secret, 'keys.txt') });
  assert.equal(outside.isError, true);
  assert.match(outside.text, /Only these folders can be read/);
  const through = await run(tools, 'read_pc_file', { path: path.join(projects, 'shortcut', 'keys.txt') });
  assert.equal(through.isError, true, 'a shortcut inside the folder that leads out is refused');
  const guessed = await run(tools, 'list_pc_folder', { path: path.join(projects, 'no-such-project') });
  assert.equal(guessed.isError, true);
  assert.match(guessed.text, /There is no .*no-such-project\. List .*projects to see the names there\./, 'a guessed name inside the folder is said to be missing, not outside');
  const none = await run(new M.AgentTools(host, [], () => {}), 'list_pc_folder', { path: projects });
  assert.match(none.text, /No folder on this PC has been named/);
});

test('a project is one project file: save_project sets it up, finds it again by its folder, keeps what people wrote, proposes changes to accept', async () => {
  const old = '---\ntype: project\nstatus: done\nfolder: C:\\work\\old\nneuralspark-project: local:c:/work/old\nreviewed-by: Sam\n---\n# Old\n\nThe old site.\n\n## Updates\n\n- **1 Oct 2026** — Fix (finished) · [[Activity/2026-10-01 Fix|the task]]\n\n## Notes\n\nMy own words.\n';
  const { host, files } = fakeHost({ '02 Projects/Old/Old.md': old });
  host.listing = async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: ['02 Projects', '02 Projects/Old'] });
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const harbour = { name: 'Harbour Cafe bookings', folder: 'C:\\Users\\jarlow\\Downloads\\projects\\harbour-cafe\\', status: 'active', health: 'on track', progress: 40, owner: 'Jesse', started: '2026-09-01', due: '2026-11-30', summary: 'Table bookings for the cafe on the wharf.', next: [{ what: 'Winter menu page', who: 'Sam', when: '2026-10-30' }], dates: [{ when: '2026-11-01', what: 'Winter menu live', status: 'planned' }], people: [{ name: 'Sam Lee', role: 'Cafe manager' }], risks: [{ level: 'high', what: 'The kitchen closes early in winter' }], decisions: [{ date: '2026-10-02', what: 'Bookings close at 8 pm', why: 'the kitchen closes' }], updates: [{ date: '2026-10-14', what: 'Menu photos taken', from: 'Photos/menu.zip' }], documents: [{ path: 'Plan/Bookings plan.docx', what: 'the plan' }], tags: ['client', '#cafe'] };
  const r = await run(tools, 'save_project', harbour);
  assert.ok(!r.isError, r.text);
  const file = '02 Projects/Harbour Cafe bookings/Harbour Cafe bookings.md';
  assert.deepEqual([...files.keys()].filter((k) => k.startsWith('02 Projects/Harbour')), [file], 'one file for the project, in the vault’s own projects folder: no Overview, Summary, Decisions or hub');
  const p = M.parseProject(files.get(file), file);
  assert.deepEqual([p.name, p.folder, p.key, p.status, p.health, p.progress, p.owner, p.started, p.due, p.tags], ['Harbour Cafe bookings', 'C:\\Users\\jarlow\\Downloads\\projects\\harbour-cafe', 'local:c:/users/jarlow/downloads/projects/harbour-cafe', 'active', 'on track', 40, 'Jesse', '2026-09-01', '2026-11-30', ['client', 'cafe']], 'its facts, and the key the host app finds it by');
  assert.equal(p.summary, 'Table bookings for the cafe on the wharf.');
  assert.deepEqual(p.next, [{ done: false, what: 'Winter menu page', who: 'Sam', when: '2026-10-30' }]);
  assert.deepEqual(p.dates, [{ when: '2026-11-01', what: 'Winter menu live', status: 'planned' }]);
  assert.deepEqual([p.people, p.risks], [[{ name: 'Sam Lee', role: 'Cafe manager' }], [{ level: 'high', what: 'The kitchen closes early in winter' }]]);
  assert.deepEqual(p.decisions, [{ date: '2026-10-02', what: 'Bookings close at 8 pm.', why: 'the kitchen closes' }]);
  assert.deepEqual(p.updates, [{ date: '2026-10-14', what: 'Menu photos taken', from: 'Photos/menu.zip' }]);
  assert.deepEqual(p.documents, [{ path: 'Plan/Bookings plan.docx', what: 'the plan' }]);
  assert.ok(steps.some((s) => s.kind === 'write' && s.words === 'Set up the project Harbour Cafe bookings' && s.path === file), 'a step that opens the project');
  assert.equal((await run(tools, 'save_project', harbour)).text, 'Harbour Cafe bookings is already up to date.', 'the same again changes nothing');
  // Again by its folder under another name: the same file; decisions and updates already there aren't added twice.
  await run(tools, 'save_project', { name: 'Harbour Cafe', folder: 'C:\\Users\\jarlow\\Downloads\\projects\\harbour-cafe', summary: 'Bookings for the cafe.', decisions: [{ what: 'Bookings close at 8 pm.' }], updates: [{ date: '2026-10-15', what: 'Winter menu drafted' }, { what: 'Menu photos taken' }] });
  const again = M.parseProject(files.get(file), file);
  assert.deepEqual([again.name, again.decisions.length, again.updates.map((u) => u.what)], ['Harbour Cafe', 1, ['Winter menu drafted', 'Menu photos taken']], 'found by its folder; new updates go first');
  assert.deepEqual([again.owner, again.next.length, again.people.length], ['Jesse', 1, 1], 'what wasn’t given again stays');
  // Empty lists keep too: a catch-up with only next steps never wipes the key dates.
  await run(tools, 'save_project', { name: 'Harbour Cafe', folder: 'C:\\\\Users\\\\jarlow\\\\Downloads\\\\projects\\\\harbour-cafe', summary: 'Bookings for the cafe.', next: [{ what: 'Print the winter menus' }], dates: [], risks: [] });
  const kept2 = M.parseProject(files.get(file), file);
  assert.deepEqual([kept2.next.map((n) => n.what), kept2.dates.length, kept2.risks.length], [['Print the winter menus'], 1, 1], 'new steps in, dates and risks untouched');
  // A project the former host app already keeps: found by its key; the person's property, notes and the former host
  // app's updates stay.
  await run(tools, 'save_project', { name: 'Old', folder: 'C:\\work\\old', status: 'on hold', summary: 'The old site, kept running.' });
  const kept = files.get('02 Projects/Old/Old.md');
  assert.match(kept, /^---\ntype: project\nstatus: on hold\n/);
  assert.match(kept, /reviewed-by: Sam/, 'a property the person added stays');
  assert.match(kept, /- \*\*1 Oct 2026\*\* — Fix \(finished\) · \[\[Activity\/2026-10-01 Fix\|the task\]\]/, 'the host app’s update stays');
  assert.match(kept, /## Notes\n\nMy own words\.\n$/, 'the person’s notes stay, word for word');
  assert.ok(![...files.keys()].some((k) => k.startsWith('02 Projects/Old (2)')), 'never set up twice');
  // Catching up proposes: nothing is written until the person accepts; the changes are said in words.
  const before = files.get('02 Projects/Old/Old.md');
  const proposed = await run(tools, 'save_project', { name: 'Old', folder: 'C:\\work\\old', summary: 'The old site, kept running.', health: 'at risk', next: [{ what: 'Archive it', who: 'Jesse' }], mode: 'propose' });
  assert.match(proposed.text, /^Proposed to the person/);
  assert.equal(files.get('02 Projects/Old/Old.md'), before, 'nothing written yet');
  const offer = tools.proposals[0];
  assert.deepEqual([offer.path, offer.name, offer.before], ['02 Projects/Old/Old.md', 'Old', before]);
  assert.deepEqual(offer.changes, ['Health not set → at risk', '1 next step added']);
  assert.match(offer.after, /## What’s next\n\n- \[ \] Archive it — Jesse/);
  // Refused: no name or summary, a folder that isn't a whole path.
  assert.equal((await run(tools, 'save_project', { name: 'X' })).isError, true);
  assert.match((await run(tools, 'save_project', { name: 'X', summary: 'x', folder: 'projects\\x' })).text, /full path/);
  // The chat counts projects, and one Undo puts everything back.
  const summary = M.summarise('t1', tools.changes);
  assert.deepEqual([summary.projectsMade, summary.projectsChanged, summary.made, summary.changed], [1, 1, 0, 0], 'one project set up and one brought up to date');
  await M.undoChanges(host, tools.changes);
  assert.ok(!files.has(file), 'the new project is undone');
  assert.equal(files.get('02 Projects/Old/Old.md'), old, 'and the old one is as it was');
});

test('save_project never closes silently (p12-close-and-noise round 2): status done with open steps answers with the steps', async () => {
  const { host, files } = fakeHost({});
  host.listing = async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: ['02 Projects'] });
  const tools = new M.AgentTools(host, [], () => undefined);
  const base = { name: 'Harbour Cafe', folder: 'C:\\work\\harbour', summary: 'Bookings for the cafe.', next: [{ what: 'Print the winter menus' }] };
  await run(tools, 'save_project', base);
  const file = '02 Projects/Harbour Cafe/Harbour Cafe.md';
  const shut = await run(tools, 'save_project', { ...base, status: 'done' });
  assert.match(shut.text, /Print the winter menus/);
  assert.match(shut.text, /Nothing was changed/);
  assert.equal(M.parseProject(files.get(file), file).status, 'active', 'the project stays as it is');
  const proposed = await run(tools, 'save_project', { ...base, status: 'done', mode: 'propose' });
  assert.match(proposed.text, /Print the winter menus/, 'proposed or not, the steps come back');
  assert.equal(tools.proposals.length, 0, 'nothing proposed either');
  // Every step ticked: done goes through.
  await run(tools, 'save_project', { ...base, next: [{ what: 'Print the winter menus', done: true }] });
  await run(tools, 'save_project', { ...base, status: 'done', next: [{ what: 'Print the winter menus', done: true }] });
  assert.equal(M.parseProject(files.get(file), file).status, 'done');
});

test('a refused close writes nothing anywhere (p21-six-check): notes wait for the guard too', async () => {
  const HARBOUR_PROJECT = '02 Projects/Harbour/Harbour.md';
  const NOTE = '02 Projects/Harbour/Notes/Walk.md';
  const { host, files } = fakeHost({
    [HARBOUR_PROJECT]: '---\ntype: project\nstatus: active\nowner: Jesse\n---\n# Harbour\n\n## Summary\n\nThe harbour work.\n\n## What’s next\n\n- [ ] Chase the calibration certificate — Jesse\n',
    [NOTE]: '---\nproject: "[[Harbour]]"\n---\n# Walk\n\n- [ ] Confirm the mooring fees\n',
  });
  const tools = new M.AgentTools(host, [], () => {});
  const before = files.get(NOTE);
  // The twin carries a new day, so the write check has a note update waiting — then the close is refused.
  const shut = await run(tools, 'save_project', {
    name: 'Harbour',
    summary: 'The harbour work.',
    next: [
      { what: 'Chase the calibration certificate', who: 'Jesse' },
      { what: 'Confirm the mooring fees', when: 'Friday' },
    ],
    status: 'done',
  });
  assert.match(shut.text, /Chase the calibration certificate/);
  assert.match(shut.text, /Nothing was changed/);
  assert.equal(M.parseProject(files.get(HARBOUR_PROJECT), HARBOUR_PROJECT).status, 'active', 'the project stays as it is');
  assert.equal(files.get(NOTE), before, 'the note is untouched too: a refusal writes nothing anywhere');
});

test('p12-task-writes: save_project resolves relative days, joins twins, and keeps a note’s task in the note', async () => {
  const { host, files } = fakeHost({
    '02 Projects/Harbour/Harbour.md': '---\ntype: project\nstatus: active\nowner: Jesse\n---\n# Harbour\n\n## Summary\n\nThe harbour work.\n',
    '02 Projects/Harbour/Notes/Walk.md': '---\nproject: "[[Harbour]]"\n---\n# Walk\n\n- [ ] Confirm the mooring fees\n',
  });
  const tools = new M.AgentTools(host, [], () => {});
  const r = await run(tools, 'save_project', {
    name: 'Harbour',
    summary: 'The harbour work.',
    next: [
      { what: 'Confirm the mooring fees', who: 'Jesse', when: 'Friday' },
      { what: 'Paint the shed', when: 'tomorrow' },
      { what: 'Paint the shed.' },
    ],
  });
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /kept there, not doubled/);
  const p = M.parseProject(files.get('02 Projects/Harbour/Harbour.md'), '02 Projects/Harbour/Harbour.md');
  assert.deepEqual(p.next.map((n) => n.what), ['Paint the shed'], 'twins join; the note’s task stays out');
  assert.ok(p.next[0].when && p.next[0].when !== 'tomorrow', `a real date, not “tomorrow”: ${p.next[0].when}`);
  assert.match(files.get('02 Projects/Harbour/Notes/Walk.md'), /Confirm the mooring fees — Jesse/, 'the note’s line gains the owner');
  assert.match(files.get('02 Projects/Harbour/Notes/Walk.md'), /📅 \d{4}-\d{2}-\d{2}/, 'and the real day');
});

test('a write invalidates what was read: verifying it reads fresh, never “already above”', async () => {
  const { host } = fakeHost({ 'Note.md': '# Note\n\nFirst words.\n' });
  const tools = new M.AgentTools(host, [], () => undefined);
  const first = await run(tools, 'read_note', { path: 'Note.md' });
  assert.match(first.text, /First words/);
  const repeat = await run(tools, 'read_note', { path: 'Note.md' });
  assert.equal(repeat.repeat, true, 'the same read twice is still answered from above');
  await run(tools, 'edit_note', { path: 'Note.md', action: 'append', text: 'Second words.' });
  const verify = await run(tools, 'read_note', { path: 'Note.md' });
  assert.equal(verify.repeat, undefined, 'after a write the read is done again');
  assert.match(verify.text, /Second words/, 'and it sees what the write did');
});

test('documents on this PC are read by the host app’s readers, in parts; older tools’ answers are cut short later', async () => {
  const docs = path.join(work, 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(path.join(docs, 'Monthly update.docx'), 'PK fake');
  writeFileSync(path.join(docs, 'Plan.pdf'), '%PDF fake');
  const { host } = fakeHost({});
  const long = 'Status: green. '.repeat(3000);
  host.readDocument = async (file) => (file.endsWith('.docx') ? long : null);
  const tools = new M.AgentTools(host, [docs], () => {});
  const first = await run(tools, 'read_pc_file', { path: path.join(docs, 'Monthly update.docx') });
  assert.match(first.text, /^Status: green\./);
  assert.match(first.text, /part 1 of 4: ask for part 2 for more\)$/);
  assert.match((await run(tools, 'read_pc_file', { path: path.join(docs, 'Monthly update.docx'), part: 4 })).text, /part 4 of 4\)$/);
  assert.match((await run(tools, 'read_pc_file', { path: path.join(docs, 'Plan.pdf') })).text, /could not be read as a document/);
  const alone = new M.AgentTools(fakeHost({}).host, [docs], () => {});
  assert.match((await run(alone, 'read_pc_file', { path: path.join(docs, 'Monthly update.docx') })).text, /this kind of document can’t be read here/, 'on its own, a document says why it is not read');
  const msgs = [{ role: 'user', text: 'q' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'tool', callId: String(i), name: 'read_pc_file', text: 'x'.repeat(5000) }))];
  const trimmed = M.trimOld(msgs);
  assert.ok(trimmed.slice(1, 11).every((m) => m.text.length < 1400 && /cut short here/.test(m.text)) && trimmed.slice(11).every((m) => m.text.length === 5000), 'the newest answers stay whole, older ones are cut short');
});

test('the loop: tools asked for and answered, thinking aloud kept apart, then the answer', async () => {
  const { host } = fakeHost({ '05 Decisions/Decision Log.md': '# Decision Log\nWe chose the harbour site.' });
  const tools = new M.AgentTools(host, [], () => {});
  const seen = [];
  const steps = [];
  let text = '';
  const result = await M.runAgent({
    messages: [{ role: 'user', text: 'What have I decided lately?' }],
    tools,
    signal: new AbortController().signal,
    onText: (d) => (text += d),
    onStep: (s, clear) => steps.push({ ...s, clear }),
    stream: async (messages, onText) => {
      seen.push(messages);
      if (seen.length === 1) {
        onText('Let me look.');
        return { text: 'Let me look.', stopReason: 'stop', toolCalls: [{ id: 'a', name: 'search_notes', arguments: '{"query":"chose"}' }], replay: { r: 1 } };
      }
      onText('You chose the harbour site ([[Decision Log]]).');
      return { text: 'You chose the harbour site ([[Decision Log]]).', stopReason: 'stop' };
    },
  });
  assert.equal(result.text, 'You chose the harbour site ([[Decision Log]]).');
  const second = seen[1];
  assert.deepEqual(second.at(-2), { role: 'assistant', text: 'Let me look.', toolCalls: [{ id: 'a', name: 'search_notes', arguments: '{"query":"chose"}' }], replay: { r: 1 } }, 'the step goes back with its calls and replay');
  assert.equal(second.at(-1).role, 'tool');
  assert.match(second.at(-1).text, /Decision Log\.md/);
  assert.deepEqual(steps[0], { kind: 'say', words: 'Let me look.', clear: true }, 'thinking aloud moves into the steps');
  const noTools = await M.runAgent({ messages: [{ role: 'user', text: 'hi' }], tools, signal: new AbortController().signal, onText: () => {}, onStep: () => {}, stream: async () => ({ text: '', stopReason: 'error', error: 'This model does not support tools' }) });
  assert.equal(noTools.noTools, true, 'a model that can’t use tools is answered the plain way');
  // A reply that only says what it will do carries on, so the job gets done (16 Oct 2026: Muse stopped at a plan).
  assert.ok(M.announcesWork('I’ll inventory your 11 project folders and set up each one properly in your notes.'));
  assert.ok(M.announcesWork('Got it. Let me go through each project now.'));
  // 19 Oct 2026, the real app: the reminder's own promise read as a plan, and the nudge sent it auditing every project.
  assert.ok(!M.announcesWork('Done. I’ll remind you on Thursday 23 October at 11:00 am.'), 'a reminder’s promise is the answer');
  assert.ok(!M.announcesWork('I will remind you on Friday at 9:00 am.'));
  assert.ok(!M.announcesWork('I’ve set up 11 projects: [[Harbour]] and the rest. Shall I write a report?'), 'a summary or a question is an answer');
  assert.ok(!M.announcesWork('Done. Two projects set up.'));
  assert.ok(!M.announcesWork('You chose the harbour site ([[Decision Log]]).'));
  const seenPlan = [];
  const planned = await M.runAgent({
    messages: [{ role: 'user', text: 'Set up my projects' }],
    tools,
    signal: new AbortController().signal,
    onText: () => {},
    onStep: () => {},
    stream: async (messages) => {
      seenPlan.push([...messages]);
      if (seenPlan.length === 1) return { text: 'I’ll set up each project properly in your notes.', stopReason: 'stop' };
      if (seenPlan.length === 2) return { text: '', stopReason: 'stop', toolCalls: [{ id: 'p', name: 'notes_overview', arguments: '{}' }] };
      return { text: 'Done: set up your projects.', stopReason: 'stop' };
    },
  });
  assert.equal(planned.text, 'Done: set up your projects.', 'it carried on and finished');
  assert.match(seenPlan[1].at(-1).text, /^Carry on and do it now/, 'told to carry on');
  let stubborn = 0;
  const neverActs = await M.runAgent({ messages: [{ role: 'user', text: 'x' }], tools, signal: new AbortController().signal, onText: () => {}, onStep: () => {}, stream: async () => (stubborn++, { text: 'I’ll do it now.', stopReason: 'stop' }) });
  assert.deepEqual([stubborn, neverActs.text], [3, 'I’ll do it now.'], 'twice at most, then its words stand');
  // Once something was changed in the answer, an "I'll…" reply is its answer: no nudge (19 Oct 2026, after a reminder).
  const changed = new M.AgentTools(fakeHost({}).host, [], () => {});
  changed.changes.push({ kind: 'made', path: 'Reminders.md', text: '- [ ] ring the plumber ⏰ 2026-10-23 11:00' });
  let asked = 0;
  const afterChange = await M.runAgent({ messages: [{ role: 'user', text: 'Remind me to ring the plumber on Thursday at 11am.' }], tools: changed, signal: new AbortController().signal, onText: () => {}, onStep: () => {}, stream: async () => (asked++, { text: 'Set. I’ll keep an eye on the rest of the week too.', stopReason: 'stop' }) });
  assert.deepEqual([asked, afterChange.text], [1, 'Set. I’ll keep an eye on the rest of the week too.'], 'no carry-on after a change');
  let calls = 0;
  const endless = await M.runAgent({ messages: [{ role: 'user', text: 'loop' }], tools, signal: new AbortController().signal, onText: () => {}, onStep: () => {}, stream: async () => ({ text: '', stopReason: 'stop', toolCalls: [{ id: String(++calls), name: 'notes_overview', arguments: '{}' }] }) });
  // A model that asks for the same look for ever: refused, then stopped, and the person still gets plain words (the last
  // turn's model here keeps asking for tools, so the words are Ironleaf's own).
  assert.equal(endless.stopped, 'stuck');
  assert.equal(endless.error, undefined);
  assert.match(endless.text, /^I got stuck going over the same things — here's where it got to\./);
  assert.ok(calls < 20, `stopped early, after ${calls} model turns`);
});

// Docs (18 Oct 2026): documenting a system makes one doc for the subject and brings that one up to date in place; a
// near name is refused.
test('save_doc: one doc per subject, sections changed in place, a dated line in Changes, a near name refused', async () => {
  const { host, files } = fakeHost({});
  const tools = new M.AgentTools(host, [], () => {});
  const first = await run(tools, 'save_doc', { name: 'Minecraft server', about: 'How the family Minecraft server is set up and run.', summary: 'A Paper server on the study desktop.', sections: [{ heading: 'Setup', text: 'Paper 1.21, port 25565.' }, { heading: 'Access', text: 'Whitelist only.' }], change: 'Wrote down how it is set up.' });
  assert.match(first.text, /Made the doc Minecraft server with 2 sections/);
  const made = files.get('Docs/Minecraft server.md');
  assert.match(made, /^---\ntype: doc\nabout: How the family Minecraft server is set up and run\.\n/);
  assert.match(made, /## Changes\n\n- \*\*\d{1,2} \w{3} \d{4}\*\* — Wrote down how it is set up\./);
  // Brought up to date by name: Access replaced where it is, Backups added before Changes, the rest kept.
  const second = await run(tools, 'save_doc', { name: 'minecraft server', sections: [{ heading: 'Access', text: 'Whitelist only; Mum or Dad add names.' }, { heading: 'Backups', text: 'Nightly to the NAS.' }], change: 'Backups written down.' });
  assert.match(second.text, /Updated the doc Minecraft server: added Backups; updated Access/);
  const after = files.get('Docs/Minecraft server.md');
  assert.equal([...files.keys()].filter((k) => k.startsWith('Docs/')).length, 1, 'never a second doc');
  assert.match(after, /## Setup\n\nPaper 1\.21, port 25565\.\n\n## Access\n\nWhitelist only; Mum or Dad add names\.\n\n## Backups\n\nNightly to the NAS\.\n\n## Changes\n\n- \*\*[^*]+\*\* — Backups written down\.\n- \*\*[^*]+\*\* — Wrote down how it is set up\./);
  assert.match(after, /^updated: \d{4}-\d{2}-\d{2}$/m);
  // A near name: refused, saying which doc to update.
  const near = await run(tools, 'save_doc', { name: 'Minecraft', sections: [{ heading: 'Setup', text: 'x' }] });
  assert.equal(near.isError, true);
  assert.match(near.text, /There is a doc “Minecraft server” already/);
  // Undo takes the answer's changes back.
  assert.ok(tools.changes.some((c) => c.kind === 'made' && c.path === 'Docs/Minecraft server.md'));
  assert.ok(tools.changes.some((c) => c.kind === 'edited' && c.path === 'Docs/Minecraft server.md'));
});

test('the assistant is told what goes where: docs for how things are run, projects for work with an end, notes for a quick remember', () => {
  const words = M.agentSystem(null, 'today', null, []);
  assert.match(words, /How something is set up, run or done \(a server, a system, a routine, a process, a how-to\) is a doc: one doc per subject, written with save_doc, never a project/);
  assert.match(words, /A quick "note that…", or a "remember…" with no day or time, is a plain note/);
  assert.ok(M.TOOLS.some((t) => t.name === 'save_doc'));
});

// 20 Oct 2026 (Ironleaf Calm, note types): "add Sam from Rhino Ovens as a contact" makes a Person in People/ with its
// type and fields; the vault's own types (renamed, its own folders) come with the words.
test('note types: a person, meeting, resource or idea is made as its type, in its folder, with the vault’s types listed', () => {
  const plain = M.agentSystem(null, 'today', null, []);
  assert.match(plain, /"Add Sam from Rhino Ovens as a contact" is a Person: People\/Sam\.md with type: person and organisation: Rhino Ovens/);
  assert.doesNotMatch(plain, /The types in these notes/);
  const words = M.agentSystem(null, 'today', null, [], '', 'Person (type: person) in 03 People/; fields: role, organisation, email, phone');
  assert.match(words, /The types in these notes:\nPerson \(type: person\) in 03 People\//);
});

// 19 Oct 2026 (approved reminders: "remember to order flour on Friday"): the old rule ("a note reminds no one… noted,
// not set as a reminder") is gone. Asked to be reminded, the assistant sets one with set_reminder, says the exact moment
// in Australian words, and never invents a time (a day alone is 9:00 am, and it says so).
test('reminders: the rules say set one and say the exact moment, never invent a time', () => {
  const words = M.agentSystem(null, 'today', null, []);
  assert.doesNotMatch(words, /reminds no one|not set as a reminder/);
  assert.match(words, /set a reminder with set_reminder/);
  assert.match(words, /Never invent a time or day they didn't give/);
  assert.match(words, /say when it is set for, in your own words/);
  assert.doesNotMatch(words, /Tell them exactly|for example "I'll remind you/);
  assert.ok(M.TOOLS.some((t) => t.name === 'set_reminder'));
});

test('set_reminder: Reminders.md made, then added to; the exact moment back; never a guessed time', async () => {
  const { host, files } = fakeHost({ 'Shop.md': '# Shop\n\n- [ ] Butter' });
  host.now = () => new Date(2026, 9, 19, 10, 30); // Monday 19 October 2026, 10:30 am
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const first = await run(tools, 'set_reminder', { what: 'Order 20 bags of flour from Laucke', when: 'on Friday' });
  assert.ok(!first.isError, first.text);
  assert.equal(files.get('Reminders.md'), '# Reminders\n\n- [ ] Order 20 bags of flour from Laucke ⏰ 2026-10-23 09:00\n');
  assert.match(first.text, /Friday 23 October at 9:00 am/);
  assert.doesNotMatch(first.text, /Tell them exactly/);
  assert.match(first.text, /No time was given, so it is at 9:00 am/);
  const second = await run(tools, 'set_reminder', { what: 'Put the bins out', when: 'every Monday at 6pm' });
  assert.match(second.text, /Monday 19 October at 6:00 pm, repeating every Monday/);
  assert.doesNotMatch(second.text, /No time was given/);
  assert.equal(files.get('Reminders.md'), '# Reminders\n\n- [ ] Order 20 bags of flour from Laucke ⏰ 2026-10-23 09:00\n- [ ] Put the bins out ⏰ 2026-10-19 18:00 every Monday\n');
  // In the note it belongs in, under its tasks.
  await run(tools, 'set_reminder', { what: 'Pick up butter', when: 'tomorrow at 3pm', note: 'Shop' });
  assert.equal(files.get('Shop.md'), '# Shop\n\n- [ ] Butter\n- [ ] Pick up butter ⏰ 2026-10-20 15:00\n');
  // Not understood, or already passed: nothing written, and the person is asked.
  const vague = await run(tools, 'set_reminder', { what: 'Ring Sam', when: 'after lunch' });
  assert.ok(vague.isError);
  assert.match(vague.text, /Ask the person/);
  const gone = await run(tools, 'set_reminder', { what: 'Ring Sam', when: 'today at 9am' });
  assert.ok(gone.isError);
  assert.match(gone.text, /already passed/);
  assert.ok(!files.get('Reminders.md').includes('Ring Sam'));
  assert.ok(steps.some((s) => s.kind === 'write' && /Set a reminder for Friday 23 October at 9:00 am/.test(s.words)));
  // One Undo takes them all back.
  assert.equal(tools.changes.length, 3);
});

test('set_reminder across both homes: already set names the note; another moment is another (seams O1)', async () => {
  const { host, files } = fakeHost({ 'Inbox.md': '# Inbox\n\n- [ ] Call Mum ⏰ 2026-10-20 09:00\n' });
  host.now = () => new Date(2026, 9, 19, 10, 30); // Monday 19 October 2026, 10:30 am
  const tools = new M.AgentTools(host, [], () => {});
  const dup = await run(tools, 'set_reminder', { what: 'Call mum', when: 'tomorrow at 9am' });
  assert.ok(!dup.isError, dup.text);
  assert.match(dup.text, /already set in your note “Inbox”/);
  assert.ok(!files.has('Reminders.md'), 'no second line in a second home');
  // The same words at another moment are another reminder, kept where they belong.
  const other = await run(tools, 'set_reminder', { what: 'Call mum', when: 'Thursday at 9am' });
  assert.ok(!other.isError, other.text);
  assert.match(files.get('Reminders.md'), /Call mum ⏰ 2026-10-22 09:00/);
  assert.match(files.get('Inbox.md'), /Call Mum ⏰ 2026-10-20 09:00/, 'the first one untouched');
  // Into a named note, while Reminders.md holds the same: named, and the note untouched.
  const h2 = fakeHost({ 'Reminders.md': '# Reminders\n\n- [ ] Pick up butter ⏰ 2026-10-20 15:00\n', 'Shop.md': '# Shop\n\n- [ ] Butter' });
  h2.host.now = () => new Date(2026, 9, 19, 10, 30);
  const t2 = new M.AgentTools(h2.host, [], () => {});
  const r2 = await run(t2, 'set_reminder', { what: 'Pick up butter', when: 'tomorrow at 3pm', note: 'Shop' });
  assert.match(r2.text, /already set in your note “Reminders”/);
  assert.equal(h2.files.get('Shop.md'), '# Shop\n\n- [ ] Butter');
});

test('set_reminder near-duplicates: Replace or Keep, answered with replace (seams O2)', async () => {
  const { host, files } = fakeHost({ 'Reminders.md': '# Reminders\n\n- [ ] Call Priya ⏰ 2026-10-20 09:00\n' });
  host.now = () => new Date(2026, 9, 19, 10, 30);
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const offer = await run(tools, 'set_reminder', { what: 'Phone Priya', when: 'tomorrow at 9am' });
  assert.ok(!offer.isError, offer.text);
  assert.match(offer.text, /close to a reminder already set in your note “Reminders”/);
  assert.match(offer.text, /Replace or Keep/);
  assert.match(offer.text, /"replace": true/);
  assert.equal(files.get('Reminders.md'), '# Reminders\n\n- [ ] Call Priya ⏰ 2026-10-20 09:00\n', 'nothing written on the offer');
  // Replace: in its place, one line, one Undo.
  const rep = await run(tools, 'set_reminder', { what: 'Phone Priya', when: 'tomorrow at 9am', replace: true });
  assert.ok(!rep.isError, rep.text);
  assert.match(rep.text, /Replaced the reminder in Reminders\.md/);
  assert.equal(files.get('Reminders.md'), '# Reminders\n\n- [ ] Phone Priya ⏰ 2026-10-20 09:00\n');
  assert.ok(steps.some((s) => s.kind === 'write' && s.path === 'Reminders.md' && /Replaced the reminder for Tuesday 20 October at 9:00 am/.test(s.words)));
  assert.equal(tools.changes.length, 1);
  const undone = await M.undoChanges(host, tools.changes);
  assert.match(files.get('Reminders.md'), /Call Priya/, 'one Undo puts the old one back');
  assert.match(undone, /Undone: 1 change/);
  // Keep: set as well.
  const k = fakeHost({ 'Reminders.md': '# Reminders\n\n- [ ] Call Priya ⏰ 2026-10-20 09:00\n' });
  k.host.now = () => new Date(2026, 9, 19, 10, 30);
  const t3 = new M.AgentTools(k.host, [], () => {});
  const kept = await run(t3, 'set_reminder', { what: 'Phone Priya', when: 'tomorrow at 9am', replace: false });
  assert.ok(!kept.isError, kept.text);
  assert.match(k.files.get('Reminders.md'), /Call Priya ⏰ 2026-10-20 09:00\n- \[ \] Phone Priya ⏰ 2026-10-20 09:00/);
  // Across homes: the near one in Inbox.md is named and replaced where it is.
  const x = fakeHost({ 'Inbox.md': '# Inbox\n\n- [ ] Call Priya ⏰ 2026-10-20 09:00\n' });
  x.host.now = () => new Date(2026, 9, 19, 10, 30);
  const t4 = new M.AgentTools(x.host, [], () => {});
  const offer2 = await run(t4, 'set_reminder', { what: 'Phone Priya', when: 'tomorrow at 9am' });
  assert.match(offer2.text, /already set in your note “Inbox”/);
  await run(t4, 'set_reminder', { what: 'Phone Priya', when: 'tomorrow at 9am', replace: true });
  assert.match(x.files.get('Inbox.md'), /Phone Priya/);
  assert.ok(!x.files.has('Reminders.md'), 'replaced where it is, never copied across');
  // Offered in the tool's own words and the rules.
  const spec = M.TOOLS.find((t) => t.name === 'set_reminder');
  assert.ok(spec.parameters.properties.replace, 'replace is offered');
  assert.match(spec.description, /replace.*keep both/);
  assert.match(M.agentSystem(null, 'today', null, []), /replace it or keep both/);
});

// 19 Oct 2026 (asked for a brand template, it said it could not make PDFs): work beyond notes goes to the former host app
// at once, with the notes it is about and the project; the chat follows it. The rules say so, and never to ask first or
// say it can't.
test('9.2 making notes: the same note by another path is refused until it has been read', async () => {
  const { host, files } = fakeHost({ 'Me/Finance/Bills/Credit Card.md': '# Credit Card\n' });
  const tools = new M.AgentTools(host, [], () => {});
  const first = await run(tools, 'create_note', { path: 'Notes/Credit Card.md', content: '# Credit Card\n' });
  assert.equal(first.isError, true);
  assert.match(first.text, /There is already “Credit Card” at Me\/Finance\/Bills\/Credit Card\.md\. Read it first/);
  assert.ok(!files.has('Notes/Credit Card.md'), 'no second note');
  await run(tools, 'read_note', { path: 'Me/Finance/Bills/Credit Card.md' });
  const second = await run(tools, 'create_note', { path: 'Notes/Credit Card.md', content: '# Credit Card\n' });
  assert.ok(!second.isError, second.text);
  assert.ok(files.has('Notes/Credit Card.md'), 'read, judged another note, made');
  assert.match(M.TOOLS.find((t) => t.name === 'create_note').description, /Look for the note first/);
});

test('9.2 docs: a narrower subject is its own doc, a shorthand still reaches the doc', async () => {
  const { host, files } = fakeHost({});
  const tools = new M.AgentTools(host, [], () => {});
  await run(tools, 'save_doc', { name: 'Minecraft server', sections: [{ heading: 'Setup', text: 'Paper.' }] });
  const mods = await run(tools, 'save_doc', { name: 'Minecraft server mods', sections: [{ heading: 'Setup', text: 'Modpack.' }] });
  assert.ok(!mods.isError, mods.text);
  assert.ok(files.has('Docs/Minecraft server mods.md'));
  const near = await run(tools, 'save_doc', { name: 'server mods', sections: [{ heading: 'Setup', text: 'x' }] });
  assert.equal(near.isError, true);
  assert.match(near.text, /There is a doc “Minecraft server mods” already/);
  const both = await run(tools, 'save_doc', { name: 'Minecraft', sections: [{ heading: 'Setup', text: 'x' }] });
  assert.equal(both.isError, true);
  assert.match(both.text, /More than one doc could be “Minecraft”: “Minecraft server mods”, “Minecraft server”/);
});

test('9.2 reorganise: propose shows, write writes', async () => {
  const { host, files } = fakeHost({ 'Projects/Old.md': '---\ntype: project\n---\n# Old\n\n## Notes\n\nKept.\n' });
  const tools = new M.AgentTools(host, [], () => {});
  const propose = await run(tools, 'reorganise_project', { project: 'Old', content: '---\ntype: project\nlayout: simple\n---\n# Old\n\n## Summary\n\nOld.\n\n## Notes\n\nKept.\n' });
  assert.ok(!propose.isError, propose.text);
  assert.match(propose.text, /Shown to the person to accept/);
  assert.doesNotMatch(propose.text, /Say in a line/);
  assert.equal(files.get('Projects/Old.md').includes('layout: simple'), false, 'propose writes nothing');
  const write = await run(tools, 'reorganise_project', { project: 'Old', mode: 'write', content: '---\ntype: project\nlayout: simple\n---\n# Old\n\n## Summary\n\nOld.\n\n## Notes\n\nKept.\n' });
  assert.ok(!write.isError, write.text);
  assert.match(write.text, /Laid out Old/);
  assert.match(files.get('Projects/Old.md'), /layout: simple/);
});

test('9.2 voice: answers end plainly unless they wrote, and no owner names leak into examples', () => {
  const words = M.agentSystem(null, 'today', null, []);
  assert.match(words, /When you made or changed notes or files, end by saying briefly what you did/);
  assert.match(words, /A plain answer to a question ends plainly, with no round-up/);
  assert.doesNotMatch(words, /Launch template/);
  assert.doesNotMatch(words, /for example "I'll remind you/);
  assert.match(M.TOOLS.find((t) => t.name === 'copy_project_file').description, /never a silent "\(2\)"/);
});

test('nothing the assistant may do depends on the words of the message (8.0 TR5)', () => {
  // 28 Oct 2026. The word list that held writes back (writeScope) is gone; the model judges, and every change of an
  // answer can be undone.
  assert.equal(M.writeScope, undefined);
  assert.equal(M.writeHeld, undefined);
  assert.match(M.agentSystem(null, 'today', null, []), /A question is answered, not written up/);
  assert.match(M.agentSystem(null, 'today', null, []), /Act on their latest message only/);
});

test('a near-named project is found, not set up twice: one near refused, several listed, a new name goes ahead', async () => {
  const lane = '---\ntype: project\nstatus: active\n---\n# Harbour Lane\n\n## Summary\n\nThe lane shop.\n';
  const { host, files } = fakeHost({ 'Projects/Harbour Lane/Harbour Lane.md': lane });
  const tools = new M.AgentTools(host, [], () => {});
  const one = await run(tools, 'save_project', { name: 'Harbour', summary: 'The harbour work.' });
  assert.equal(one.isError, true);
  assert.match(one.text, /There’s already a project called “Harbour Lane”/);
  assert.ok(![...files.keys()].some((k) => k.includes('Projects/Harbour/')), 'no second project beside it');
  // A narrower name with words added is its own project.
  const hotels = await run(tools, 'save_project', { name: 'Harbour Hotels', summary: 'The hotel job.' });
  assert.ok(!hotels.isError, hotels.text);
  assert.deepEqual(
    M.nearProjects('Harbour', ['Harbour Lane', 'Harbour St Rollout', 'Depot']),
    ['Harbour Lane', 'Harbour St Rollout'],
    'the shared near-name rule',
  );
  assert.match(M.nearProjectRefusal('Harbour', ['Harbour Lane', 'Harbour St Rollout']), /Several projects have names like that: Harbour Lane, Harbour St Rollout/);
  assert.equal(M.nearProjectRefusal('Depot', ['Harbour Lane']), null);
});

test('“the harbour project” with two harbours says which: never the first match, silently', async () => {
  const lane = '---\ntype: project\nstatus: active\n---\n# Harbour Lane\n\n## Summary\n\nThe lane shop.\n';
  const rollout = '---\ntype: project\nstatus: active\n---\n# Harbour St Rollout\n\n## Summary\n\nThe rollout.\n';
  const { host } = fakeHost({ 'Projects/Harbour Lane/Harbour Lane.md': lane, 'Projects/Harbour St Rollout/Harbour St Rollout.md': rollout });
  host.folders = { projects: () => [
    { path: 'Projects/Harbour Lane/Harbour Lane.md', project: { name: 'Harbour Lane', folder: '/tmp/hl' } },
    { path: 'Projects/Harbour St Rollout/Harbour St Rollout.md', project: { name: 'Harbour St Rollout', folder: '/tmp/hs' } },
  ], access: { changed: async () => ({ files: [], more: 0 }) } };
  const tools = new M.AgentTools(host, [], () => {});
  const both = await run(tools, 'project_changes', { project: 'harbour' });
  assert.equal(both.isError, true);
  assert.match(both.text, /Several projects match “harbour”: Harbour Lane, Harbour St Rollout\. Say which\./);
  const logged = await run(tools, 'log_entry', { project: 'harbour' });
  assert.equal(logged.isError, true, 'the log path refuses alike, instead of its own “no project”');
  assert.match(logged.text, /Several projects match/);
  const unique = await run(tools, 'project_changes', { project: 'lane' });
  assert.ok(!unique.isError, unique.text);
  assert.match(unique.text, /Harbour Lane/, 'a unique substring still finds its project');
  assert.deepEqual(M.projectNameMatches('harbour', [{ name: 'Harbour Lane' }, { name: 'Depot' }]), { exact: [], near: [0] });
});

test('a doc is not made beside a plain note on the same subject', async () => {
  const { host, files } = fakeHost({ 'Home Lab/Minecraft server.md': '# Minecraft server\n\nPaper on the study desktop.\n' });
  const tools = new M.AgentTools(host, [], () => {});
  const refused = await run(tools, 'save_doc', { name: 'Minecraft server', sections: [{ heading: 'Setup', text: 'Paper.' }] });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /There is already “Minecraft server” at Home Lab\/Minecraft server\.md\. Read it first/);
  assert.ok(!files.has('Docs/Minecraft server.md'), 'no Docs copy beside it');
  await run(tools, 'read_note', { path: 'Home Lab/Minecraft server.md' });
  const judged = await run(tools, 'save_doc', { name: 'Minecraft server', sections: [{ heading: 'Setup', text: 'Paper.' }] });
  assert.ok(!judged.isError, judged.text);
  assert.ok(files.has('Docs/Minecraft server.md'), 'read first, then truly another: goes ahead');
});

test('adding what is already there adds nothing: a retried append or prepend writes once', async () => {
  const { host, files } = fakeHost({ 'Today.md': '# Today\n\nCalled the plumber.\n', 'Recall.md': '# Recall\n\nI can recall\n' });
  const tools = new M.AgentTools(host, [], () => {});
  assert.match((await run(tools, 'edit_note', { path: 'Today.md', action: 'append', text: 'Called the plumber.' })).text, /already the last thing in Today\.md, so nothing was added/);
  assert.equal(files.get('Today.md').split('Called the plumber.').length - 1, 1, 'written once');
  assert.match((await run(tools, 'edit_note', { path: 'Today.md', action: 'prepend', text: '# Today' })).text, /already the first thing in Today\.md, so nothing was added/);
  await run(tools, 'edit_note', { path: 'Recall.md', action: 'append', text: 'call' });
  assert.match(files.get('Recall.md'), /recall\n\ncall\n$/, 'mid-word is not already there: still writes');
  await run(tools, 'edit_note', { path: 'Recall.md', action: 'append', text: 'Ring them.' });
  await run(tools, 'edit_note', { path: 'Recall.md', action: 'append', text: 'Ring them.' });
  assert.equal(files.get('Recall.md').split('Ring them.').length - 1, 1, 'the retry adds nothing');
  assert.equal(tools.changes.length, 2, 'skipped adds leave no change behind');
  assert.equal(M.alreadyAppended('a\nb', 'b'), true);
  assert.equal(M.alreadyAppended('a\nrecall', 'call'), false);
  assert.equal(M.alreadyAppended('', 'x'), false);
  assert.equal(M.alreadyPrepended('---\nt: 1\n---\n# T\nbody', '# T', 13), true);
  assert.equal(M.alreadyPrepended('# T\nbody', 'Other', 0), false);
});

test('a log entry with the log name taken is said, never a “ 2” log beside it', async () => {
  const lane = '---\ntype: project\nstatus: active\n---\n# Harbour Lane\n\n## Summary\n\nThe lane shop.\n';
  const { host, files } = fakeHost({ 'Projects/Harbour Lane/Harbour Lane.md': lane, 'Projects/Harbour Lane/Harbour Lane log.md': '# Harbour Lane log\n\nNot a log, just a note of that name.\n' });
  const tools = new M.AgentTools(host, [], () => {});
  const r = await run(tools, 'log_entry', { project: 'Harbour Lane', fields: { Sales: 12 } });
  assert.equal(r.isError, true);
  assert.match(r.text, /Projects\/Harbour Lane\/Harbour Lane log\.md is already there and isn’t the project’s log/);
  assert.ok(![...files.keys()].some((k) => /log 2\.md$/.test(k)), 'no numbered copy');
});

test('tags merge, remove and replace through the one rule, whatever the key’s capitalisation', async () => {
  const { host, files } = fakeHost({ 'Note.md': '---\ntags: [harbour]\nstatus: draft\n---\n# Note\n', 'Caps.md': '---\nTags: [harbour]\n---\n# Caps\n' });
  const tools = new M.AgentTools(host, [], () => {});
  await run(tools, 'set_properties', { path: 'Note.md', properties: { tags: ['urgent'] } });
  assert.match(files.get('Note.md'), /tags:\n {2}- harbour\n {2}- urgent/, 'given tags join the note’s own');
  await run(tools, 'set_properties', { path: 'Note.md', remove_tags: ['harbour'] });
  assert.match(files.get('Note.md'), /tags:\n {2}- urgent\n/, 'taken off, the rest stay');
  await run(tools, 'set_properties', { path: 'Note.md', properties: { tags: ['solo'] }, replace_tags: true });
  assert.match(files.get('Note.md'), /tags:\n {2}- solo\n/, 'replaced exactly');
  await run(tools, 'set_properties', { path: 'Caps.md', remove_tags: ['harbour'] });
  assert.doesNotMatch(files.get('Caps.md'), /harbour/, 'a capitalised Tags key is read too');
  await run(tools, 'set_properties', { path: 'Caps.md', properties: { Tags: ['pier'] } });
  assert.match(files.get('Caps.md'), /pier/, 'added under the key given');
  await run(tools, 'set_properties', { path: 'Caps.md', properties: { tags: ['quay'] } });
  assert.equal((files.get('Caps.md').match(/tags:/gi) || []).length, 1, 'no second tags key beside the first, whatever the case given');
  assert.match(files.get('Caps.md'), /pier/, 'the note’s tags stay');
  assert.match(files.get('Caps.md'), /quay/, 'and the new one joins them');
  assert.deepEqual(M.tagEdit({ Tags: ['a'] }, {}, ['a'], false), { key: 'Tags', next: [] });
  assert.equal(M.tagEdit({ tags: ['a'] }, {}, null, true), null, 'a lone replace_tags touches nothing');
});

test('save_project catch-up rewrites only what it changed (4 Nov 2026: en dashes and ISO dates everywhere)', async () => {
  const file = '02 Projects/Harbour/Harbour.md';
  const before = '---\ntype: project\nstatus: active\n---\n# Harbour\n\n## Summary\n\nThe harbour work.\n\n## What\u2019s next\n\n- [ ] Paint the office \u2013 Sam \u00b7 by 16 Oct 2026\n  - use the new stock\n- [ ] Order the chairs \u2013 by 18 Oct 2026\n\n## Key dates\n\n| Date | Milestone | Status |\n| --- | --- | --- |\n| 16 Oct 2026 | Racking lands |  |\n\n## People\n\n- **Sam Taylor** \u2013 builder\n\n## Risks and issues\n\n| Risk | Impact | Owner | Status |\n| --- | --- | --- | --- |\n| Crane booking lapses | High | Ana | Open |\n';
  const { host, files } = fakeHost({ [file]: before });
  host.listing = async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: ['02 Projects', '02 Projects/Harbour'] });
  const tools = new M.AgentTools(host, [], () => {});
  const r = await run(tools, 'save_project', { name: 'Harbour', summary: 'The harbour work, brought up to date.', next: [{ what: 'Paint the office walls', who: 'Sam', when: '2026-10-16' }, { what: 'Order the chairs', when: '2026-10-18' }], risks: [{ what: 'Crane booking lapses' }] });
  assert.ok(!r.isError, r.text);
  const after = files.get(file);
  assert.ok(after.includes('Paint the office walls \u2014 Sam \u00b7 by 16 Oct 2026'), `reworded step keeps 16 Oct 2026:\n${after}`);
  assert.ok(!after.split('\n').some((l) => l.startsWith('- [ ]') && l.includes('2026-10-')), 'no ISO in the steps');
  assert.ok(after.includes('| 16 Oct 2026 | Racking lands |  |'), 'the untouched key date stays byte for byte');
  assert.ok(after.includes('- **Sam Taylor** \u2013 builder'), 'the untouched person keeps its en dash');
  assert.ok(after.includes('  - use the new stock'), 'the kept step keeps its sub-line');
  assert.ok(after.includes('| Crane booking lapses | High | Ana | Open |'), 'the kept risk keeps its owner and cells');
});
