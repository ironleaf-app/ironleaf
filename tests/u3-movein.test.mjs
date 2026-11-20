// node --test tests/u3-movein.test.mjs — Moving in with the notes you already have (5 Nov 2026, u3-vault-moving-in):
// a person opens years of foreign Markdown in Ironleaf and it feels like home, not a wall of ancient overdue tasks.
// One file for the whole job's proofs: one case rule for type:/folder compares (item 5), stale-task amnesty (item 1),
// one owner rule with confidence (item 3), no silent writes on the adopting doors (item 4), project folders offered
// never silent (item 6), corrupt canvas warns never blank (item 7), graph without projects (item 8), faithful leaving
// (item 10), daily-folder hint (item 12), tree names and foreign task marks (items 13, 14). Made-up notes throughout.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCore, openServices } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u3movein-'));
let M;
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/tasks.ts'))};`,
      `export * as relations from ${JSON.stringify(path.join(root, 'src/shared/relations.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/paths.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/finished.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/today-count.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/brief-tasks.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/one-task.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/days.ts'))};`,
      `export * as canvas from ${JSON.stringify(path.join(root, 'src/shared/project-canvas.ts'))};`,
      `export * as graphLayout from ${JSON.stringify(path.join(root, 'src/shared/graph-layout.ts'))};`,
      `export * as layouts from ${JSON.stringify(path.join(root, 'src/shared/layouts.ts'))};`,
      `export * as areas from ${JSON.stringify(path.join(root, 'src/shared/areas.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'u3.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  M = await import(pathToFileURL(path.join(work, 'u3.mjs')).href);
  // The adopting doors (item 4) live main-side behind electron: a stub answers the app and dialog calls.
  const electron = {
    name: 'electron-stand-in',
    resolveId: (id) => (id === 'electron' ? '\0electron' : null),
    load: (id) =>
      id === '\0electron'
        ? `export const app = { getPath: () => ${JSON.stringify(path.join(work, 'userdata'))}, isPackaged: true };
           export const shell = { trashItem: async () => {} };
           export const dialog = { showMessageBox: async (...a) => (globalThis.__nvDialogCalls.push(a), globalThis.__nvDialog ?? { response: 2 }),
             showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) };`
        : null,
  };
  globalThis.__nvDialogCalls = [];
  const entryMain = path.join(work, 'entry-main.ts');
  writeFileSync(
    entryMain,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/main/settings.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/main/library-state.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/main/vault-home-service.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/main/vault-home.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/main/vault-place.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entryMain, platform: 'node', plugins: [electron], external: ['yaml'], output: { file: path.join(work, 'u3main.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'u3main.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Item 1: stale-task amnesty ────────────────────────────────────────────────────────────────────────────────────

const U3NOW = new Date(2026, 10, 5, 9, 0).getTime(); // Thursday 5 November 2026
const U3TODAY = '2026-11-05';
const u3task = (words, due, extra = {}) => ({ key: `T.md\n${words}`, path: 'T.md', title: 'T', line: 0, text: words, words, due, ...extra });

test('u3 item 1: Due folds old lines into from a while back, never leading', () => {
  const g = M.groupDue(
    [u3task('Pay the power bill', '2024-02-01'), u3task('Last week’s call', '2026-10-29'), u3task('Today’s task', U3TODAY), u3task('Someday', null)],
    [],
    U3NOW,
  );
  assert.deepEqual(g.stale.map((e) => e.item.words), ['Pay the power bill'], 'a 2024 line folds into stale');
  assert.deepEqual(g.overdue.map((e) => e.item.words), ['Last week’s call'], 'a lately-late line stays overdue');
  assert.deepEqual(g.today.map((e) => e.item.words), ['Today’s task']);
  assert.equal(g.undatedCount, 1);
  assert.equal(M.isStaleOffset(-31), true);
  assert.equal(M.isStaleOffset(-30), false, '30 days late is still late');
  assert.equal(M.isStaleDay('2024-02-01', U3TODAY), true);
  assert.equal(M.isStaleDay('2026-10-29', U3TODAY), false);
});

test('u3 item 1: Tasks groups an old line apart and counts it apart', () => {
  assert.equal(M.dueGroup({ done: false, due: '2024-02-01' }, U3TODAY), 'stale');
  assert.equal(M.dueGroup({ done: false, due: '2026-10-29' }, U3TODAY), 'overdue');
  assert.equal(M.dueGroup({ done: true, due: '2024-02-01' }, U3TODAY), 'earlier', 'a done old line stays earlier');
  const gathered = M.gatherTasks(
    [{ path: 'N.md', title: 'N', content: '- [ ] Old 📅 2024-02-01\n- [ ] Recent 📅 2026-10-29\n', mtime: 1, tags: [], props: {} }],
    { resolve: () => null, projectOf: () => null, projectName: () => null, isPerson: () => false, ref: new Date(U3NOW) },
  );
  const f = M.taskFacets(gathered, U3TODAY, (p) => p);
  assert.equal(f.counts.overdue, 1, 'late counts what is lately late');
  assert.equal(f.counts.stale, 1, 'old lines count apart');
});

test('u3 item 1: Today puts an old step last, counts it apart, says it quietly', () => {
  const project = (steps) => ({ name: 'Shed', status: 'active', tags: [], summary: '', next: steps, dates: [], people: [], risks: [], decisions: [], updates: [], documents: [], notes: '', extra: [] });
  const day = M.buildToday(
    {
      projects: [
        { path: 'Projects/Shed/Shed.md', version: 'v', modified: U3NOW, project: project([{ done: false, what: 'Rehang the door', when: '1 Feb 2024' }, { done: false, what: 'Buy hinges', when: '4 Nov 2026' }]) },
      ],
      notes: [],
      me: 'Mia Tran',
    },
    new Date(U3NOW),
  );
  assert.deepEqual(day.due.stale.map((x) => x.what), ['Rehang the door'], 'the 2024 step folds into stale');
  assert.deepEqual(day.due.overdue.map((x) => x.what), ['Buy hinges']);
  assert.equal(day.counts.stale, 1);
  assert.equal(day.counts.overdue, 1);
  assert.equal(M.todayDueCount(day), 1, 'the one count counts lately-late steps only');
  assert.deepEqual(M.headline(day.counts).map((h) => h.words), ['1 overdue', '1 from a while back']);
  const ranked = M.rankNextForYou([...day.due.overdue, ...day.due.stale]);
  assert.deepEqual(ranked.map((x) => x.what), ['Buy hinges', 'Rehang the door'], 'fresh leads; stale never does');
  const onlyStale = M.pickNextForYou({ overdue: [], today: [], soon: [], later: [], stale: day.due.stale });
  assert.equal(onlyStale?.what, 'Rehang the door', 'with only stale, the day still has a next thing');
});

test('u3 item 1: the one ranked list puts a stale note line after fresh steps', () => {
  const step = (what, offset) => ({ id: what, project: 'p', projectName: 'Shed', version: 'v', kind: 'step', what, others: false, when: '', offset, tone: 'none' });
  const ranked = M.rankAllFor([step('Buy hinges', -1)], [{ kind: 'task', key: 'k', day: '2024-02-01', item: { path: 'N.md', title: 'N', line: 0, words: 'Pay the power bill', due: '2024-02-01' } }], new Date(U3NOW));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].kind, 'step', 'the fresh step ranks first');
  assert.equal(ranked[1].kind, 'note', 'the stale note line ranks last');
});

// ── Item 3: one owner rule with confidence ───────────────────────────────────────────────────────────────────────────

const U3ME = 'Mia Tran';
const U3KNOWN = ['Mia Tran', 'Sam Okafor', 'Ana O’Brien'];

test('u3 item 3: a bare tail naming a stranger is a mention, never debt', () => {
  const now = new Date(U3NOW);
  // Without known people, every name reads as before.
  assert.equal(M.isOwnText('Ring back — Sam Okafor', U3ME, now), false, 'legacy: a name is theirs');
  // With known people, strangers stay quiet.
  assert.equal(M.isOwnText('Ring back — Stranger Name', U3ME, now, U3KNOWN), true, 'a stranger’s mention stays mine');
  assert.equal(M.isOwnText('Ring back — Sam Okafor', U3ME, now, U3KNOWN), false, 'a known other is still theirs');
  assert.equal(M.isOwnText('Ring back — Sam', U3ME, now, U3KNOWN), false, 'a known first name is still theirs');
  assert.equal(M.isOwnText('Ring back — Mia Tran', U3ME, now, U3KNOWN), true, 'my own name stays mine');
  assert.equal(M.isOwnText('Ring back — me', U3ME, now, U3KNOWN), true, 'me stays mine');
  assert.equal(M.isOwnText('Just a task', U3ME, now, U3KNOWN), true, 'no tail stays mine');
  assert.equal(M.isKnownOwner('Sam', U3KNOWN), true);
  assert.equal(M.isKnownOwner('Stranger Name', U3KNOWN), false);
});

test('u3 item 3: known people are the deliberate ones', () => {
  const metas = [
    { path: 'People/Ana O’Brien.md', title: 'Ana O’Brien', props: { type: 'person' } },
    { path: 'Projects/Shed/Shed.md', title: 'Shed', props: { type: 'project', owner: 'Mia Tran' } },
    { path: 'Meetings/2026-11-04 Chat.md', title: 'Chat', props: { attendees: ['Sam Okafor'] } },
    { path: 'Notes/Random.md', title: 'Random', props: {} },
  ];
  const known = M.knownPeople(metas, (p) => (p === 'Projects/Shed/Shed.md' ? '---\ntype: project\nowner: Mia Tran\n---\n# Shed\n\n## People\n\n- **Jo Kawiti** — Advisor\n' : ''));
  assert.ok(known.includes('Ana O’Brien'), 'a People note is known');
  assert.ok(known.includes('Mia Tran'), 'a project owner is known');
  assert.ok(known.includes('Jo Kawiti'), 'a project member is known');
  assert.ok(known.includes('Sam Okafor'), 'a meeting attendee is known');
  assert.equal(known.length, 4, 'nothing else is known');
});

test('u3 item 3: a meeting’s tick-box assignees are known, so their tasks are theirs (t172)', () => {
  const metas = [
    { path: 'Projects/Shed/Shed.md', title: 'Shed', props: { type: 'project', owner: 'Mia Tran' } },
    { path: 'Meetings/2026-11-04 Chat.md', title: 'Chat', props: {} },
  ];
  const meeting = '---\nproject: Shed\n---\n# Chat\n\n## Actions\n\n- [ ] Ring the supplier – Sam Okafor · by 2026-11-06\n- [ ] Tidy the bench – team\n\n```\n- [ ] Fenced quote – Fenced Name\n```\n';
  const known = M.knownPeople(metas, (p) => (p === 'Meetings/2026-11-04 Chat.md' ? meeting : ''));
  assert.ok(known.includes('Mia Tran'), 'the project owner is known');
  assert.ok(known.includes('Sam Okafor'), 'the meeting’s assignee is known');
  assert.ok(!known.includes('team'), 'a bare attribution is not a person');
  assert.ok(!known.includes('Fenced Name'), 'a fenced line names nobody');
  const now = new Date(U3NOW);
  assert.equal(M.isOwnText('Ring the supplier – Sam Okafor · by 2026-11-06', U3ME, now, known), false, 'another person’s meeting task is never mine');
  assert.equal(M.isOwnText('File the Smithers form — Smithers · by 2026-11-12', U3ME, now, known), true, 'a stranger’s loose mention stays mine');
});

test('u3 item 3: People owes-you counts known owners, never strangers', () => {
  const model = M.buildRecordModel({
    notes: [
      { path: 'People/Ana O’Brien.md', title: 'Ana O’Brien', content: '---\ntype: person\n---\n# Ana O’Brien\n', props: { type: 'person' }, mtime: 1 },
      { path: 'Notes/Calls.md', title: 'Calls', content: '# Calls\n- [ ] Ring back — Ana O’Brien\n- [ ] Chase the quote — Stranger Name\n', props: {}, mtime: 1 },
    ],
    resolve: () => null,
    today: U3TODAY,
  });
  const ana = M.personOpenItems(model, 'Ana O’Brien');
  assert.ok(ana, 'a known person has a page');
  assert.equal(ana.theirs.length, 1, 'the known tail is debt');
  assert.equal(ana.theirs[0].title, 'Ring back');
  assert.equal(M.personOpenItems(model, 'Stranger Name'), null, 'a stranger gets no page, no debt');
  const calls = [...model.records.values()].find((r) => r.path === 'Notes/Calls.md' && r.type === 'note');
  assert.ok(calls && calls.facts.every((f) => f.key !== 'owner' || !/Stranger/.test(String(f.value))), 'the stranger is not an owner fact');
});

test('u3 item 3: only an owned folder files notes under its project', () => {
  assert.equal(M.projectOwnsFolder('Projects/Shed/Shed.md'), true);
  assert.equal(M.projectOwnsFolder('Notes/volcano homework.md'), false, 'a file beside strangers owns nothing');
  assert.equal(M.projectOwnsFolder('Shed.md'), false, 'a root file owns nothing');
  const owner = M.makeProjectOwner([
    { path: 'Projects/Shed/Shed.md', names: ['Shed'] },
    { path: 'Notes/volcano homework.md', names: ['volcano homework'] },
  ]);
  assert.equal(owner('Projects/Shed/door.md', undefined), 'Projects/Shed/Shed.md', 'an owned folder files');
  assert.equal(owner('Notes/other.md', undefined), null, 'a coincidental file claims nothing');
  assert.equal(owner('Notes/other.md', '[[volcano homework]]'), 'Notes/volcano homework.md', 'a deliberate property still files');
  const rel = M.relations.computeRelations([
    { path: 'Projects/Shed/Shed.md', label: 'Shed', content: '# Shed\n', props: { type: 'project' }, tags: [], links: [] },
    { path: 'Projects/Shed/door.md', label: 'door', content: '# door\n', props: {}, tags: [], links: [] },
    { path: 'Notes/volcano homework.md', label: 'volcano homework', content: '# volcano\n', props: { type: 'project' }, tags: [], links: [] },
    { path: 'Notes/other.md', label: 'other', content: '# other\n', props: {}, tags: [], links: [] },
  ]);
  assert.equal(rel.owner.get('Projects/Shed/door.md'), 'Projects/Shed/Shed.md');
  assert.equal(rel.owner.get('Notes/other.md') ?? null, null, 'relations file nothing under the coincidental project');
});

// ── Item 4: no silent writes on the adopting doors ────────────────────────────────────────────────────────────────────

test('u3 item 4: browsing a foreign folder writes nothing into it; adopting writes its settings', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nv-u3data-'));
  const foreign = mkdtempSync(path.join(tmpdir(), 'nv-u3foreign-'));
  try {
    writeFileSync(path.join(foreign, 'Notes.md'), '# Notes\n');
    const S = new B.SettingsStore(dataDir);
    await S.load();
    await S.useVault(foreign, { inPlace: true });
    assert.ok(!existsSync(path.join(foreign, '.neuralvault')), 'browsing writes no .neuralvault folder');
    assert.ok(S.sharedState().vaultFile.startsWith(dataDir), 'its settings live on this PC');
    await S.update({ dailyFolder: 'Journal' });
    assert.ok(!existsSync(path.join(foreign, '.neuralvault')), 'changing a setting while browsing still writes nothing there');
    await S.useVault(foreign);
    const written = path.join(foreign, '.neuralvault', 'settings.json');
    assert.ok(existsSync(written), 'adopting writes .neuralvault/settings.json');
    assert.match(readFileSync(written, 'utf8'), /Journal/, 'the adoption carries what was chosen while browsing');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(foreign, { recursive: true, force: true });
  }
});

test('u3 item 4: browsing remembers only on this PC', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nv-u3data-'));
  const foreign = mkdtempSync(path.join(tmpdir(), 'nv-u3foreign-'));
  try {
    writeFileSync(path.join(foreign, 'Notes.md'), '# Notes\n');
    const L = new B.LibraryState(dataDir);
    L.useVault(foreign, { inPlace: true });
    await L.save(foreign, 'bookmarks', { items: [{ path: 'Notes.md' }] });
    assert.ok(!existsSync(path.join(foreign, '.neuralvault')), 'state while browsing stays on this PC');
    assert.deepEqual(await L.load(foreign, 'bookmarks'), { items: [{ path: 'Notes.md' }] }, 'and reads back from there');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(foreign, { recursive: true, force: true });
  }
});

const u3home = (over = {}) => {
  const calls = { opened: [], adopted: [] };
  const settings = { raw: { library: '', lastVault: '', recentVaults: [], prefs: { templatesFolder: 'Templates' } } };
  const svc = B.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: path.join(tmpdir(), 'nv-u3nolib'), dataDir: mkdtempSync(path.join(tmpdir(), 'nv-u3data-')) },
    settings,
    places: async () => ({ roots: [], network: [] }),
    placesStubbed: true,
    placeDeps: B.systemDeps(),
    vaultRoot: () => null,
    library: () => path.join(tmpdir(), 'nv-u3nolib'),
    templates: () => 'Templates',
    ownCounts: () => null,
    ownFiles: () => new Map(),
    openVault: async (f) => (calls.opened.push(f), { path: f, name: path.basename(f) }),
    useLibrary: async (f) => (calls.adopted.push(f), { path: f, name: path.basename(f), library: true }),
    carryLibraryData: async () => {},
    toTrash: async () => {},
    canWrite: async () => true,
    keepRecovery: () => {},
    send: () => {},
    win: () => ({}),
    moving: { get: () => false, set: () => {} },
    rescan: async () => {},
    ...over,
  });
  return { svc, calls, settings };
};

test('u3 item 4: adopting asks once for a foreign folder, never for a vault', async () => {
  const foreign = mkdtempSync(path.join(tmpdir(), 'nv-u3foreign-'));
  const owned = mkdtempSync(path.join(tmpdir(), 'nv-u3owned-'));
  try {
    writeFileSync(path.join(foreign, 'Notes.md'), '# Notes\n');
    writeFileSync(path.join(owned, 'Notes.md'), '# Notes\n');
    assert.ok(await B.ensureIdentity(owned, 'Owned'));
    const { svc } = u3home();
    globalThis.__nvDialogCalls = [];
    assert.equal(await svc.confirmAdopt(owned), 'adopt', 'a vault adopts straight away');
    assert.equal(globalThis.__nvDialogCalls.length, 0, 'no dialog for a vault');
    globalThis.__nvDialog = { response: 0 };
    assert.equal(await svc.confirmAdopt(foreign), 'adopt', 'Make it my vault adopts');
    globalThis.__nvDialog = { response: 1 };
    assert.equal(await svc.confirmAdopt(foreign), 'browse', 'Just browse browses');
    globalThis.__nvDialog = { response: 2 };
    assert.equal(await svc.confirmAdopt(foreign), null, 'Cancel cancels');
    const [, asked] = globalThis.__nvDialogCalls.at(-1);
    assert.match(asked.message, /your vault/, 'one honest line');
    assert.match(asked.detail, /Nothing is renamed, moved or rewritten/, 'saying what stays untouched (merge: the em dash became a full stop, no em dashes in new words)');
    assert.deepEqual(asked.buttons, ['Make it my vault', 'Just browse', 'Cancel']);
  } finally {
    delete globalThis.__nvDialog;
    rmSync(foreign, { recursive: true, force: true });
    rmSync(owned, { recursive: true, force: true });
  }
});

test('u3 item 4: first start adopts a vault, only browses a foreign folder', async () => {
  const docs = mkdtempSync(path.join(tmpdir(), 'nv-u3docs-'));
  const sync = mkdtempSync(path.join(tmpdir(), 'nv-u3sync-'));
  try {
    const library = path.join(docs, 'Ironleaf');
    const foreign = path.join(sync, 'Ironleaf');
    mkdirSync(foreign, { recursive: true });
    for (let i = 1; i <= 3; i++) writeFileSync(path.join(foreign, `Note ${i}.md`), `# Note ${i}\n\nSome words here.\n`);
    const { svc, calls } = u3home({
      host: { kind: 'test', appId: 'test', defaultLibrary: library, dataDir: mkdtempSync(path.join(tmpdir(), 'nv-u3data-')) },
      library: () => library,
      places: async () => ({ roots: [{ path: sync, service: 'onedrive', name: 'OneDrive' }], network: [] }),
    });
    assert.equal(await svc.firstStart(), true, 'the foreign notes are found and opened');
    assert.deepEqual(calls.adopted, [], 'never adopted silently');
    assert.deepEqual(calls.opened, [foreign], 'opened for a look');
    assert.ok(!existsSync(path.join(foreign, '.neuralvault')), 'nothing written into them');
  } finally {
    rmSync(docs, { recursive: true, force: true });
    rmSync(sync, { recursive: true, force: true });
  }
});

// ── Item 2: the moving-in census (day-shaped notes; the card itself is proved in shots) ─────────────────────────────

test('u3 item 2: day-shaped names read, whatever the padding', () => {
  assert.equal(M.isDayShaped('Daily/2024-03-12.md'), true);
  assert.equal(M.isDayShaped('Journal/2024-3-2 thoughts.md'), true, 'unpadded counts too');
  assert.equal(M.isDayShaped('Journal/Morning pages.md'), false);
  assert.equal(M.isDayShaped('Notes/2024-13-99.md'), false, 'an impossible day never counts');
  assert.equal(M.isDayShaped('Notes/Meeting 2026-11-04.md'), true, 'a day anywhere in the name counts');
  assert.deepEqual(M.dayShapedByFolder(['Daily/2024-03-12.md', 'Daily/2024-03-13.md', 'Journal/2024-3-2 thoughts.md', 'Notes/Plain.md']), [
    { folder: 'Daily', count: 2 },
    { folder: 'Journal', count: 1 },
  ]);
});

test('u3 item 2: the moving-in card shows for an unorganised vault, and only then', () => {
  const show = M.areas.shouldShowMovingIn;
  assert.equal(show(23, null, 0, false), true, 'notes past a glance, no areas file, no projects: show');
  assert.equal(show(23, { version: 1, areas: [] }, 0, false), true, 'an empty areas file shows too');
  assert.equal(show(9, null, 0, false), false, 'below a screenful Home is already readable');
  assert.equal(show(23, { version: 1, areas: [{ id: 'home', name: 'Home' }] }, 0, false), false, 'organised: the card waits its turn');
  assert.equal(show(23, null, 2, false), false, 'projects already: no card');
  assert.equal(show(23, null, 0, true), false, 'hidden stays hidden');
  assert.equal(show(23, null, null, false), false, 'still loading: no flash');
});

// ── Item 5: one case rule for type: and folder compares ──────────────────────────────────────────────────────────

test('u3 item 5: type: project reads the same in every case, quoted or linked', () => {
  assert.equal(M.isProjectProps({ type: 'project' }), true);
  assert.equal(M.isProjectProps({ type: 'Project' }), true, 'a capital P is still a project file');
  assert.equal(M.isProjectProps({ type: '  PROJECT  ' }), true);
  assert.equal(M.isProjectProps({ type: '"project"' }), true);
  assert.equal(M.isProjectProps({ type: '[[Project]]' }), true);
  assert.equal(M.isProjectProps({ Type: 'Project' }), true, 'a capitalised key reads too');
  assert.equal(M.isProjectProps({ type: 'projects' }), false);
  assert.equal(M.isProjectProps({ type: 'note' }), false);
  assert.equal(M.isProjectProps({}), false);
  assert.equal(M.isProjectProps(undefined), false);
  assert.equal(M.isProjectProps({ type: 42 }), false);
});

test('u3 item 5: project files read as projects from their text in any case', () => {
  assert.equal(M.isProjectText('---\ntype: project\n---\n# Volcano homework\n'), true);
  assert.equal(M.isProjectText('---\ntype: Project\n---\n# Tree hut\n'), true, 'capital P in the file reads too');
  assert.equal(M.isProjectText('---\nType: PROJECT\n---\n# Shed\n'), true);
  assert.equal(M.isProjectText('---\ntype: note\n---\n# Shopping\n'), false);
});

test('u3 item 5: records leave out the templates folder however it is cased', () => {
  const notes = [
    { path: 'templates/Fill this in.md', title: 'Fill this in', content: '- [ ] Fill this in\n', props: {}, mtime: 1 },
    { path: 'Templates/Meeting.md', title: 'Meeting', content: '- [ ] Greet\n', props: {}, mtime: 1 },
    { path: 'Notes/Real.md', title: 'Real', content: '- [ ] Buy milk\n', props: {}, mtime: 1 },
  ];
  const model = M.buildRecordModel({ notes, resolve: () => null, today: '2026-11-05', templatesFolder: 'Templates' });
  const paths = [...model.records.values()].map((r) => r.path);
  assert.ok(!paths.includes('templates/Fill this in.md'), 'a lowercase templates/ note is not a record');
  assert.ok(!paths.includes('Templates/Meeting.md'), 'a capital Templates/ note is not a record');
  assert.ok(paths.includes('Notes/Real.md'), 'an ordinary note still is');
});

test('u3 item 9: the harness indexes what the app would, and nothing else', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-u3harness-'));
  try {
    writeFileSync(path.join(dir, 'Notes.md'), '# Notes\n- [ ] Buy milk\n');
    mkdirSync(path.join(dir, 'node_modules', 'fakepkg'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules', 'fakepkg', 'note.md'), '# Fake\n');
    mkdirSync(path.join(dir, 'Nested', '.neuralvault'), { recursive: true });
    writeFileSync(path.join(dir, 'Nested', '.neuralvault', 'vault.json'), '{}');
    writeFileSync(path.join(dir, 'Nested', 'inner.md'), '# Inner\n');
    writeFileSync(path.join(dir, 'real.md'), '# Real\n');
    try {
      symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'link-inside.md'));
    } catch {}
    const core = await loadCore(work);
    const services = await openServices(dir, mkdtempSync(path.join(tmpdir(), 'nv-u3data-')), core);
    const paths = services.index.allMeta().map((m) => m.path);
    assert.ok(paths.includes('Notes.md'), 'an ordinary note is indexed');
    assert.ok(paths.includes('real.md'), 'a second ordinary note is indexed');
    assert.ok(!paths.some((p) => p.includes('node_modules')), 'node_modules is never indexed');
    assert.ok(!paths.some((p) => p.startsWith('Nested/')), 'a nested vault is never indexed');
    assert.ok(!paths.includes('link-inside.md'), 'a symlink is never indexed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('u3 item 5: relations and tasks agree with records on a capital-P project', () => {
  const rel = M.relations.computeRelations([
    { path: 'Dream.md', label: 'Dream', content: '# Dream\n', props: { type: 'Project' }, tags: [], links: [] },
    { path: 'Notes/Side.md', label: 'Side', content: '# Side\n', props: {}, tags: [], links: [] },
  ]);
  assert.deepEqual(rel.projects, ['Dream.md'], 'relations count type: Project as a project');
  const gathered = M.gatherTasks(
    [{ path: 'Dream.md', title: 'Dream', content: '# Dream\n- [ ] Paint the hut\n', mtime: 1, tags: [], props: { type: 'Project' } }],
    { resolve: () => null, projectOf: () => null, projectName: () => null, isPerson: () => false },
  );
  assert.equal(gathered[0]?.project, 'Dream.md', 'tasks file a capital-P note under itself');
});

// ── Item 6: project folders offered, never silent ────────────────────────────────────────────────────────────────

test('u3 item 6: substance is the blank-file line, not liveliness', () => {
  const proj = (text, file = 'Projects/X.md') => M.parseProject(text, file);
  assert.equal(M.hasProjectSubstance(proj('---\ntype: project\n---\n# Volcano notes\n')), false, 'a blank file has no substance');
  assert.equal(M.hasProjectSubstance(proj('---\ntype: project\nstatus: idea\n---\n# Volcano notes\n\nGoal: see the crater\n')), false, 'an idea with a goal but no facts is still thin');
  assert.equal(
    M.hasProjectSubstance(proj('---\ntype: project\n---\n# Real\n\n## Next steps\n- [ ] Book the ferry\n')),
    true,
    'one next step is substance',
  );
  assert.equal(M.hasProjectSubstance(proj('---\ntype: project\ndue: 2026-12-01\n---\n# Wedding\n')), true, 'a date is substance');
  assert.equal(M.hasProjectSubstance(proj('---\ntype: project\nstatus: active\n---\n# Shed\n')), true, 'a live status is substance');
  assert.equal(M.hasProjectSubstance(proj('---\ntype: project\nhealth: red\n---\n# Shed\n')), true, 'health is substance');
});

test('u3 item 6: unclaim removes the project line and keeps the note', () => {
  assert.equal(M.unclaimProjectText('---\ntype: project\n---\n# Volcano notes\n'), '# Volcano notes\n', 'an empty block goes with the line');
  assert.equal(
    M.unclaimProjectText('---\nType: Project\narea: home\n---\n# X\n'),
    '---\narea: home\n---\n# X\n',
    'other keys stay, whatever the case',
  );
  assert.equal(M.unclaimProjectText('---\ntype: [[project]]\n---\n# X\n'), '# X\n', 'a linked type unclaims too');
  assert.equal(M.unclaimProjectText('# Plain\n'), null, 'a plain note is left alone');
  assert.equal(M.unclaimProjectText('---\ntype: note\n---\n# X\n'), null, 'another type is left alone');
});

test('u3 item 6: a folder of project notes is offered, then made or left alone', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-u3offer-'));
  try {
    mkdirSync(path.join(dir, 'Projects', 'Volcano'), { recursive: true });
    writeFileSync(path.join(dir, 'Projects', 'Volcano', 'Day one.md'), '# Day one\n- [ ] Pack boots\n');
    writeFileSync(path.join(dir, 'Projects', 'Volcano', 'Day two.md'), '# Day two\nThe crater at dawn.\n');
    mkdirSync(path.join(dir, 'Projects', 'Real'), { recursive: true });
    writeFileSync(path.join(dir, 'Projects', 'Real', 'Real.md'), '---\ntype: project\n---\n# Real\n\n## Next steps\n- [ ] Pour the footing\n');
    writeFileSync(path.join(dir, 'Volcano notes.md'), '---\ntype: project\n---\n# Volcano notes\n');
    const core = await loadCore(work);
    const services = await openServices(dir, mkdtempSync(path.join(tmpdir(), 'nv-u3data-')), core);
    const offers = await services.invoke('projects:folder-offers', []);
    assert.deepEqual(offers, [{ folder: 'Projects/Volcano', name: 'Volcano', notes: 2, tasks: 1 }], 'only the unclaimed folder with notes and a task is offered');
    const cards = await services.invoke('projects:list', []);
    assert.equal(cards.find((c) => c.name === 'Volcano notes')?.thin, true, 'the blank project file is flagged thin');
    assert.ok(!cards.find((c) => c.name === 'Real')?.thin, 'the worked project is not thin');
    // Make it a project: one owned file, nothing else touched.
    const made = await services.invoke('project:from-folder', ['Projects/Volcano']);
    assert.equal(made, 'Projects/Volcano/Volcano.md', 'the file lands owned-named in the folder');
    assert.equal(readFileSync(path.join(dir, 'Projects', 'Volcano', 'Volcano.md'), 'utf8'), '---\ntype: project\n---\n# Volcano\n', 'the file is blank but for the line');
    assert.equal(readFileSync(path.join(dir, 'Projects', 'Volcano', 'Day one.md'), 'utf8'), '# Day one\n- [ ] Pack boots\n', 'the folder notes are untouched');
    assert.deepEqual(await services.invoke('projects:folder-offers', []), [], 'a claimed folder is never offered again');
    // Not a project: the line goes, the note stays.
    await services.invoke('project:unclaim', ['Volcano notes.md']);
    assert.equal(readFileSync(path.join(dir, 'Volcano notes.md'), 'utf8'), '# Volcano notes\n', 'unclaim leaves an ordinary note');
    assert.ok(!(await services.invoke('projects:list', [])).some((c) => c.name === 'Volcano notes'), 'the note leaves the project list');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Item 7: corrupt canvas warns, never blank ─────────────────────────────────────────────────────────────────────

test('u3 item 7: damaged bytes read as damaged, with the damage said', () => {
  const bad = M.canvas.readBoardText('{ this is not json');
  assert.equal(bad.damaged, true, 'unparseable bytes are damaged');
  assert.deepEqual([bad.board.nodes, bad.board.edges], [[], []], 'a damaged board shows empty');
  assert.ok(bad.reason.length > 0, 'the damage is said');
  const shaped = M.canvas.readBoardText('{"nodes": 5, "edges": []}');
  assert.equal(shaped.damaged, true, 'valid JSON in the wrong shape is damaged too');
  assert.ok(shaped.reason.length > 0, 'the wrong shape is said');
});

test('u3 item 7: a board and an empty file read clean', () => {
  const good = M.canvas.readBoardText('{"nodes": [{"id": "a", "x": 1, "y": 2}], "edges": []}');
  assert.equal(good.damaged, false, 'a board reads clean');
  assert.equal(good.board.nodes.length, 1, 'its cards survive');
  assert.equal(M.canvas.readBoardText('').damaged, false, 'an empty file is an empty board, not damage');
  assert.equal(M.canvas.readBoardText('{}').damaged, false, 'bare braces are an empty board');
});

test('u3 item 7: starting over keeps the damaged bytes first', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-u3canvas-'));
  try {
    mkdirSync(path.join(dir, 'Boards'), { recursive: true });
    writeFileSync(path.join(dir, 'Boards', 'broken.canvas'), '{ this is not json');
    const core = await loadCore(work);
    const services = await openServices(dir, mkdtempSync(path.join(tmpdir(), 'nv-u3data-')), core);
    assert.equal(await services.invoke('canvas:keep-damaged', ['Boards/broken.canvas']), true, 'the damaged bytes are kept');
    assert.equal(services.damagedKept.get('Boards/broken.canvas'), '{ this is not json', 'the kept copy is the bytes as they were');
    assert.equal(readFileSync(path.join(dir, 'Boards', 'broken.canvas'), 'utf8'), '{ this is not json', 'keeping a copy writes nothing into the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Item 8: graph for vaults without projects ────────────────────────────────────────────────────────────────────────

test('u3 item 8: a vault with no projects still gets a link map', () => {
  const nodes = [
    { id: 'Journal/2024-01-01.md', title: '2024-01-01', kind: 'note' },
    { id: 'Journal/2024-01-02.md', title: '2024-01-02', kind: 'note' },
    { id: 'Recipes/Soup.md', title: 'Soup', kind: 'note' },
    { id: 'Daily/2024-01-01.md', title: '2024-01-01', kind: 'note' },
  ];
  const links = [
    { source: 'Journal/2024-01-01.md', target: 'Journal/2024-01-02.md' },
    { source: 'Journal/2024-01-01.md', target: 'Recipes/Soup.md' },
  ];
  assert.deepEqual(M.graphLayout.buildMap(nodes, links), [], 'no projects means no project map');
  const map = M.graphLayout.buildLinkMap(nodes, links);
  assert.equal(map.length, 2, 'one column per folder with notes');
  assert.equal(map[0].folder, 'Journal', 'the busiest folder first');
  assert.equal(map[0].notes[0].id, 'Journal/2024-01-01.md', 'the busiest note first');
  assert.equal(map[0].notes[0].links, 2, 'link counts ride along');
  assert.ok(!map.some((c) => c.folder === 'Daily'), 'Daily stays out, as the Map');
});

test('u3 item 8: link neighbours read both directions', () => {
  const links = [
    { source: 'a.md', target: 'b.md' },
    { source: 'c.md', target: 'a.md' },
  ];
  assert.deepEqual(M.graphLayout.linkNeighbours('a.md', links).sort(), ['b.md', 'c.md'], 'out and in');
  assert.deepEqual(M.graphLayout.linkNeighbours('zzz.md', links), [], 'a stranger has none');
});

// ── Item 10: leaving faithfully ─────────────────────────────────────────────────────────────────────────────────────

test('u3 item 10: .git never rides along, and what stays behind is named', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-u3export-'));
  try {
    mkdirSync(path.join(dir, 'Notes'), { recursive: true });
    writeFileSync(path.join(dir, 'Notes', 'a.md'), '# A\n');
    mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
    writeFileSync(path.join(dir, '.git', 'objects', 'x'), 'history');
    mkdirSync(path.join(dir, 'Nested'), { recursive: true });
    writeFileSync(path.join(dir, 'Nested', 'inner.md'), '# Inner\n');
    assert.ok(await B.ensureIdentity(path.join(dir, 'Nested'), 'Nested'));
    const { files, nested, git } = await B.vaultFiles(dir);
    assert.ok(!files.some((f) => f.rel.split('/').includes('.git')), '.git never rides along');
    assert.deepEqual(git, ['.git'], 'the skipped .git is named');
    assert.deepEqual(nested, ['Nested'], 'the nested vault is named');
    assert.ok(!files.some((f) => f.rel.startsWith('Nested/')), 'the nested vault stays behind');
    assert.ok(files.some((f) => f.rel === 'Notes/a.md'), 'ordinary notes ride along');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('u3 item 10: the export words say what stayed behind', () => {
  assert.equal(B.exportLeftBehind([], []), '', 'nothing stayed, nothing said');
  assert.match(B.exportLeftBehind(['.git'], []), /\.git/, '.git staying is said');
  assert.match(B.exportLeftBehind([], ['Nested']), /Nested/, 'a nested vault staying is said');
});

// ── Item 12: daily-folder hint ──────────────────────────────────────────────────────────────────────────────────────

test('u3 item 12: the daily hint points at the folder their days live in', () => {
  assert.deepEqual(
    M.dailyFolderHint([{ folder: 'Journal', count: 140 }, { folder: 'Daily', count: 0 }], 'Daily'),
    { folder: 'Journal', count: 140 },
    'an empty Daily and 140 days in Journal: point there',
  );
  assert.equal(
    M.dailyFolderHint([{ folder: 'Daily', count: 200 }, { folder: 'Journal', count: 140 }], 'Daily'),
    null,
    'days already home: silence',
  );
  assert.equal(M.dailyFolderHint([{ folder: 'Journal', count: 4 }], 'Daily'), null, 'a few strays: silence');
  assert.equal(M.dailyFolderHint([{ folder: '(no folder)', count: 50 }], 'Daily'), null, 'top-level days are not a folder to point at');
});

test('u3 item 12: the hint reads the vault, not the settings default', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-u3daily-'));
  try {
    mkdirSync(path.join(dir, 'Journal'), { recursive: true });
    for (let d = 1; d <= 12; d++) writeFileSync(path.join(dir, 'Journal', `2024-01-${String(d).padStart(2, '0')}.md`), `# Jan ${d}\n`);
    mkdirSync(path.join(dir, 'Daily'), { recursive: true });
    writeFileSync(path.join(dir, 'Daily', 'todo.md'), '# Todo\n');
    const core = await loadCore(work);
    const services = await openServices(dir, mkdtempSync(path.join(tmpdir(), 'nv-u3data-')), core);
    assert.deepEqual(await services.invoke('daily:folder-hint', []), { folder: 'Journal', count: 12 }, 'twelve days in Journal, none in Daily');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Item 14: foreign task marks ─────────────────────────────────────────────────────────────────────────────────────

test('u3 item 14: a cancelled step is done and an in-progress step is open, wherever steps are read', () => {
  const p = M.parseProject('---\ntype: project\n---\n# Shed\n\n## Next steps\n- [-] Buy paint\n- [/] Prime the walls\n- [ ] Hang the door\n', 'Projects/Shed.md');
  const paint = p.next.find((s) => s.what.includes('paint'));
  assert.equal(paint?.done, true, 'a cancelled step reads done');
  assert.ok(!paint?.what.includes('['), 'the mark is not the words');
  const prime = p.next.find((s) => s.what.includes('Prime'));
  assert.equal(prime?.done, false, 'an in-progress step reads open');
  assert.ok(!prime?.what.includes('['), 'the mark is not the words');
  const phases = M.layouts.runSheet('- [-] Buy paint\n- [/] Prime the walls\n- [ ] Hang the door\n');
  assert.equal(phases[0]?.done, 1, 'the run sheet counts the cancelled box done');
  assert.equal(phases[0]?.total, 3, 'every mark counts');
});

test('u3 item 14: an untouched foreign mark survives a project save byte-identical', () => {
  const before = '---\ntype: project\n---\n# Shed\n\n## Next steps\n- [-] Buy paint\n- [ ] Hang the door\n';
  const p = M.parseProject(before, 'Projects/Shed.md');
  assert.ok(M.serializeProject(p, before).includes('- [-] Buy paint'), 'the cancelled line keeps its mark');
});

test('u3 item 14: a note with only foreign marks is still read for actions', () => {
  const model = M.buildRecordModel({
    notes: [
      { path: 'People/Ana O’Brien.md', title: 'Ana O’Brien', content: '---\ntype: person\n---\n# Ana O’Brien\n', props: { type: 'person' }, mtime: 1 },
      { path: 'Notes/Calls.md', title: 'Calls', content: '# Calls\n- [/] Ring back — Ana O’Brien\n', props: {}, mtime: 1 },
      { path: 'Notes/Ask.md', title: 'Ask', content: '# Ask\n- [?] Ask about the van — Ana O’Brien\n', props: {}, mtime: 1 },
    ],
    resolve: () => null,
    today: U3TODAY,
  });
  const ana = M.personOpenItems(model, 'Ana O’Brien');
  assert.equal(ana?.theirs.length, 2, 'the foreign tails are read');
  assert.ok(ana?.theirs.some((t) => t.title === 'Ring back'), 'in-progress is read');
  assert.ok(ana?.theirs.some((t) => t.title === 'Ask about the van'), 'a question is read');
});
