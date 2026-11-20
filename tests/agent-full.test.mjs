// node --test tests/agent-full.test.mjs — Full control for AI agents (src/shared/agent-full.ts, src/main/agent-full.ts;
// 18 Oct 2026, for every customer alike), reached through Connect an AI's Read and write. On made-up bakery and IT
// projects in memory: nothing waiting for Allow / Deny, each tool (notes and folders, properties, the daily note, every
// part of a project, templates, canvases, assets and the brand kit, the weekly review), Undo, and Private notes still out
// of reach.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-full-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/main/agent-access.ts')};`,
      `export { readBoard, addToBoard, changeBoard, removeFromBoard } from ${src('src/main/agent-full.ts')};`,
      `export { AGENT_TOOLS } from ${src('src/shared/agent-access.ts')};`,
      `export { FULL_TOOLS, READ_EXTRA_TOOLS } from ${src('src/shared/agent-full.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects, ProjectHistory } from ${src('src/main/projects.ts')};`,
      `export { todayData } from ${src('src/main/today.ts')};`,
      `export { applyProjectEdit, parseProject, serializeProject } from ${src('src/shared/project-file.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'full.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'full.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const STORE = 'Projects/Studio Upgrade/Studio Upgrade.md';
const WINTER = 'Projects/Winter Menu Launch/Winter Menu Launch.md';
const NOTES = {
  [STORE]: `---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 80\nowner: Sam Taylor\ndue: "2026-11-20"\n---\n# Studio Upgrade\n\n## Summary\n\nEvery store’s point-of-sale PCs move to the new build before the holiday trading period.\n\n## What’s next\n\n- [ ] Send the reconciliation v4 to finance — Sam Taylor · by 14 Oct 2026\n- [ ] Chase the 11 spare tills — Priya Shah · by 24 Oct 2026\n- [ ] Book the Sydney wave — Priya Shah\n\n## Risks and issues\n\n- **High** — 11 spare tills can’t be reached remotely\n`,
  [WINTER]: `---\ntype: project\nstatus: active\nhealth: on track\nprogress: 60\nowner: Alex Lee\n---\n# Winter Menu Launch\n\n## Summary\n\nThe bakery’s winter menu: new soups and the website page.\n\n## What’s next\n\n- [ ] Photograph the soups — Alex Lee\n`,
  'Meetings/Harbour site meeting.md': `---\ntype: meeting\ndate: 2026-10-16\nattendees: [Priya Shah, Sam Taylor]\n---\n## Actions\n- [ ] Approve the lighting quote — Priya — by Friday\n- Sam to confirm the cabling contractor\n`,
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
  'Templates/Notes/Supplier call.md': '---\ntype: template\nfor: note\n---\n# {{title}}\n\nDate: {{date}}\n\n## Notes\n',
  'Boards/Launch.canvas': JSON.stringify({ nodes: [{ id: 'a1', type: 'text', x: 0, y: 0, width: 300, height: 160, text: 'Soups' }, { id: 'p1', type: 'text', x: 400, y: 0, width: 300, height: 160, text: 'Photograph the soups', neuralvault: { part: 'item', section: 'next', key: 'k', index: 0 } }], edges: [] }),
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios.\n',
};

function makeHost(dataDir, overrides = {}) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const folders = new Set(['Projects', 'Meetings', 'Notes', 'Templates', 'Templates/Notes', 'Boards', 'Private notes']);
  const now = Date.now();
  const isNote = (rel) => /\.md$/i.test(rel);
  const reindex = (rel) => (files.has(rel) && isNote(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const history = new M.ProjectHistory();
  const trashed = [];
  const brand = { value: { name: 'Saltwater Bakehouse', logos: {}, colours: [{ hex: '#1f3a5f', name: 'Harbour' }], fonts: [] } };
  const assetMeta = new Map();
  const reviews = { applied: [], undone: [] };
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const exists = async (rel) => files.has(rel) || folders.has(rel);
  const move = async (from, to) => {
    const moved = [];
    for (const rel of [...files.keys()]) {
      if (rel === from || rel.startsWith(`${from}/`)) {
        const dest = to + rel.slice(from.length);
        files.set(dest, files.get(rel));
        files.delete(rel);
        reindex(rel);
        reindex(dest);
        moved.push(dest);
      }
    }
    for (const f of [...folders]) if (f === from || f.startsWith(`${from}/`)) {
      folders.delete(f);
      folders.add(to + f.slice(from.length));
    }
    if (!moved.length && !folders.has(to)) throw new Error('nothing moved');
    return { path: to, linksUpdated: 1 };
  };
  const trashPath = async (rel) => {
    trashed.push(rel);
    for (const k of [...files.keys()]) if (k === rel || k.startsWith(`${rel}/`)) {
      files.delete(k);
      reindex(k);
    }
    for (const f of [...folders]) if (f === rel || f.startsWith(`${rel}/`)) folders.delete(f);
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: isNote(rel) ? 'note' : 'canvas' })), folders: [...folders] }),
    exists,
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async (rel) => folders.add(rel),
    move,
    trash: trashPath,
    clean,
    today: () => 'Saturday 17 October 2026 (2026-10-17)',
  };
  const full = {
    readText: async (rel) => {
      if (!files.has(rel)) throw new Error('missing');
      return files.get(rel);
    },
    writeText: async (rel, text) => writeNote(rel, text),
    isFolder: async (rel) => folders.has(rel),
    move,
    makeFolder: async (rel) => {
      folders.add(rel);
    },
    trashPath,
    templateNote: async (template, name, folder, project) => {
      const rel = `${folder ? `${folder}/` : ''}${name}.md`;
      await writeNote(rel, files.get(template).replace('{{title}}', name).replace('{{date}}', '2026-10-17').replace(/^---[\s\S]*?---\n/, project ? `---\nproject: "[[${project}]]"\n---\n` : ''));
      return rel;
    },
    templateCreate: async (group, name, content) => {
      const rel = `Templates/${group === 'notes' ? 'Notes' : group === 'projects' ? 'Projects' : 'Reports'}/${name}.md`;
      await writeNote(rel, content ?? `---\ntype: template\n---\n# {{title}}\n`);
      return rel;
    },
    templateFromNote: async (note, name) => {
      const rel = `Templates/Notes/${name}.md`;
      await writeNote(rel, files.get(note));
      return rel;
    },
    assets: {
      add: async (paths, options) => {
        const rel = `Assets/Images/${path.basename(paths[0])}`;
        if (files.has(rel)) return { added: [], reused: [rel] };
        await writeNote(rel, 'bytes');
        assetMeta.set(rel, { kind: options.kind ?? 'image', inferred: 'image', tags: [], collections: options.collection ? [options.collection] : [] });
        return { added: [rel], reused: [] };
      },
      update: async (rel, patch) => {
        const m = { ...(assetMeta.get(rel) ?? { kind: 'image', inferred: 'image', tags: [], collections: [] }) };
        for (const [k, v] of Object.entries(patch)) m[k] = v;
        assetMeta.set(rel, m);
        return { path: rel, ...m };
      },
      details: async (rel) => {
        if (!assetMeta.has(rel)) throw new Error('That asset is no longer there.');
        return { path: rel, ...assetMeta.get(rel) };
      },
      brand: async () => structuredClone(brand.value),
      setBrand: async (b) => (brand.value = structuredClone(b)),
    },
    reviewDraft: async () => ({ week: '2026-W42', projects: [{ name: 'Studio Upgrade', moved: 'tills done' }] }),
    reviewApply: async (draft) => {
      reviews.applied.push(draft);
      await writeNote('Reviews/2026-W42.md', '# Week 42\n');
      return { note: 'Reviews/2026-W42.md', changes: 2, words: 'Saved the review.', id: 'rv1' };
    },
    reviewUndo: async (id) => {
      reviews.undone.push(id);
      return 'Undone.';
    },
    download: async (url, name) => {
      const dir = mkdtempSync(path.join(work, 'dl-'));
      const file = path.join(dir, name || path.basename(new URL(url).pathname));
      writeFileSync(file, 'picture');
      return file;
    },
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
      const done = edits.map((e) => M.applyProjectEdit(p, e, '17 Oct 2026'));
      const after = M.serializeProject(p, before);
      const said = words ?? (done.length === 1 ? done[0] : `Made ${done.length} changes.`);
      await writeNote(rel, after);
      history.record(rel, { before, after, words: said, by });
      return { file: rel, words: said, before, after };
    },
    undoProject: async (file, step) => {
      await writeNote(file, step.before);
    },
    createProject: async (name) => {
      const rel = `Projects/${name}/${name}.md`;
      await writeNote(rel, `---\ntype: project\nstatus: planning\n---\n# ${name}\n`);
      return rel;
    },
    writeNote,
    trash: trashPath,
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
    full,
    changed: () => {},
    ...overrides,
  };
  return { host, files, folders, history, trashed, brand, assetMeta, reviews };
}

let n = 0;
async function setup(overrides = {}) {
  const dataDir = path.join(work, `data-${++n}`);
  const t = makeHost(dataDir, overrides);
  const access = new M.AgentAccess(t.host);
  access.load();
  return { ...t, access, dataDir };
}
const words = (r) => r.content.map((c) => c.text).join('\n');
/** Connect an AI at Read and write: every Full control tool, nothing waiting (or Read only). */
async function fullAgent(t, level = 'edit') {
  await t.access.setLocalMcp({ on: true, level });
  return { level };
}
/** One call from another AI app on this PC, at that agent's level. */
async function callAs(access, a, name, args) {
  await access.setLocalMcp({ on: true, level: a.level });
  return access.asLocalMcp(name, args);
}
const ok = (r) => {
  assert.ok(!r.isError, words(r));
  return words(r);
};

test('nothing waits at Full control: deletes and removals run at once, each listed', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  const del = await callAs(t.access, a, 'note_delete', { path: 'Notes/Oven service.md' });
  assert.match(ok(del), /Deleted Notes\/Oven service\.md/);
  assert.deepEqual(t.trashed, ['Notes/Oven service.md']);
  ok(await callAs(t.access, a, 'project_remove_item', { project: 'Studio Upgrade', list: 'next', number: 3 }));
  assert.ok(!t.files.get(STORE).includes('Book the Sydney wave'));
  const state = await t.access.state();
  assert.ok(state.activity.some((e) => /Deleted the note “Oven service”/.test(e.words) && e.canUndo));
  // Undo brings the deleted note back.
  const del2 = state.activity.find((e) => /Deleted the note/.test(e.words));
  assert.match(await t.access.undo(del2.id), /^Undone/);
  assert.ok(t.files.has('Notes/Oven service.md'));
});

test('notes and folders: rewrite, move and rename, make folders, properties and tags, today’s note, with Undo', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  ok(await callAs(t.access, a, 'note_write', { path: 'Notes/Oven service.md', content: '# Oven service\n\nServiced in March and September.\n' }));
  assert.match(t.files.get('Notes/Oven service.md'), /September/);
  let state = await t.access.state();
  assert.match(state.activity[0].words, /Rewrote the note “Oven service”/);
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.equal(t.files.get('Notes/Oven service.md'), NOTES['Notes/Oven service.md']);
  // A project's file is refused through the note tools.
  assert.match(words(await callAs(t.access, a, 'note_write', { path: STORE, content: 'x' })), /project’s file/);
  // Move and rename, and Undo moves it back.
  assert.match(ok(await callAs(t.access, a, 'note_move', { from: 'Notes/Oven service.md', to: 'Equipment/Oven service' })), /Moved Notes\/Oven service\.md to Equipment\/Oven service\.md/);
  assert.ok(t.files.has('Equipment/Oven service.md') && !t.files.has('Notes/Oven service.md'));
  state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.ok(t.files.has('Notes/Oven service.md'));
  assert.match(ok(await callAs(t.access, a, 'note_move', { from: 'Notes/Oven service.md', to: 'Notes/Deck oven' })), /Renamed/);
  // Folders.
  ok(await callAs(t.access, a, 'folder_create', { path: 'Clients/Harbour Lane' }));
  assert.ok(t.folders.has('Clients/Harbour Lane'));
  // Properties and tags.
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Deck oven.md', properties: { tags: ['equipment', '#bakery'], status: 'current' } }));
  assert.match(t.files.get('Notes/Deck oven.md'), /^---\ntags:\n {2}- equipment\n {2}- bakery\nstatus: current\n---\n/);
  state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.ok(!t.files.get('Notes/Deck oven.md').startsWith('---'));
  // Today's note: made, read, added to.
  assert.match(ok(await callAs(t.access, a, 'daily_note', {})), /Daily\/2026-10-17\.md/);
  ok(await callAs(t.access, a, 'daily_note', { text: '- Rang the supplier', heading: 'Log' }));
  assert.match(t.files.get('Daily/2026-10-17.md'), /## Log\n\n- Rang the supplier/);
});

test('projects: name, repository, notes and tags; reorder a list; put away and bring back; pin a file', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  ok(await callAs(t.access, a, 'project_set_details', { project: 'Studio Upgrade', field: 'tags', value: ['retail', 'IT'] }));
  assert.match(t.files.get(STORE), /tags:/);
  ok(await callAs(t.access, a, 'project_set_details', { project: 'Studio Upgrade', field: 'repository', value: 'github.com/example/tills' }));
  assert.match(t.files.get(STORE), /github\.com\/example\/tills/);
  ok(await callAs(t.access, a, 'project_set_details', { project: 'Studio Upgrade', field: 'notes', value: 'Keep the area coordinators in the loop.' }));
  assert.match(t.files.get(STORE), /Keep the area coordinators in the loop\./);
  ok(await callAs(t.access, a, 'project_move_item', { project: 'Studio Upgrade', list: 'next', from: 3, to: 1 }));
  const p = M.parseProject(t.files.get(STORE), STORE);
  assert.equal(p.next[0].what, 'Book the Sydney wave');
  // p12-close-and-noise A (4 Nov 2026): putting away with open tasks never closes silently — the open tasks come
  // back in plain words, and the project stays as it is until they are answered for.
  assert.match(ok(await callAs(t.access, a, 'project_archive', { project: 'Winter Menu Launch', why: 'Menu launched' })), /Photograph the soups/);
  assert.doesNotMatch(t.files.get(WINTER), /^status: done$/m);
  ok(await callAs(t.access, a, 'project_tick_next_step', { project: 'Winter Menu Launch', step: 1 }));
  ok(await callAs(t.access, a, 'project_archive', { project: 'Winter Menu Launch', why: 'Menu launched' }));
  assert.match(t.files.get(WINTER), /^status: done$/m);
  assert.match(t.files.get(WINTER), /Menu launched/);
  ok(await callAs(t.access, a, 'project_archive', { project: 'Winter Menu Launch', done: false }));
  assert.match(t.files.get(WINTER), /^status: active$/m);
  ok(await callAs(t.access, a, 'project_pin_file', { project: 'Studio Upgrade', path: 'Reports/Rollout.xlsx', what: 'Rollout tracker' }));
  assert.match(t.files.get(STORE), /Rollout\.xlsx/);
  assert.equal((await callAs(t.access, a, 'project_pin_file', { project: 'Studio Upgrade', path: '../../secret.txt' })).isError, true);
  assert.equal((await callAs(t.access, a, 'project_set_details', { project: 'Studio Upgrade', field: 'name', value: 'Winter Menu Launch' })).isError, true, 'never two projects of one name');
  // Each in the project's history, named.
  assert.equal(t.history.peek(STORE).by, 'Other AI apps (agent)');
});

test('templates: a note from a template, a new template, a note saved as one', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  assert.match(ok(await callAs(t.access, a, 'template_apply', { template: 'Templates/Notes/Supplier call.md', name: 'Flour supplier call', folder: 'Meetings', project: 'Studio Upgrade' })), /Made Meetings\/Flour supplier call\.md/);
  assert.match(t.files.get('Meetings/Flour supplier call.md'), /# Flour supplier call\n\nDate: 2026-10-17/);
  ok(await callAs(t.access, a, 'template_create', { group: 'notes', name: 'Site visit', content: '# {{title}}\n\n## Found\n' }));
  assert.equal(t.files.get('Templates/Notes/Site visit.md'), '# {{title}}\n\n## Found\n');
  ok(await callAs(t.access, a, 'template_from_note', { note: 'Oven service', name: 'Equipment service' }));
  assert.ok(t.files.has('Templates/Notes/Equipment service.md'));
  const state = await t.access.state();
  assert.ok(state.activity.every((e) => e.canUndo), 'each can be undone');
  assert.equal((await callAs(t.access, a, 'template_create', { group: 'secrets', name: 'x' })).isError, true);
});

test('canvases: make one with cards and lines, add, change and move, remove, read; a project’s card keeps its words; Undo', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  const made = JSON.parse(ok(await callAs(t.access, a, 'canvas_create', { path: 'Boards/Opening plan.canvas', cards: [{ type: 'text', text: 'Open day', ref: 'day' }, { type: 'note', file: 'Notes/Oven service.md', ref: 'oven' }, { type: 'link', url: 'https://example.com/menu', ref: 'menu' }, { type: 'group', label: 'Week one', x: -800, y: 0 }], links: [{ from: 'day', to: 'oven', label: 'needs' }] })));
  const board = JSON.parse(t.files.get('Boards/Opening plan.canvas'));
  assert.equal(board.nodes.length, 4);
  assert.equal(board.edges.length, 1);
  assert.equal(board.nodes.find((x) => x.id === made.cards.oven).file, 'Notes/Oven service.md');
  assert.equal(board.nodes.find((x) => x.type === 'group').x, -800);
  // Nothing placed on top of another card.
  const free = board.nodes.filter((x) => x.type !== 'group');
  for (const p of free) for (const q of free) if (p !== q) assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, 'no overlap');
  const added = JSON.parse(ok(await callAs(t.access, a, 'canvas_add', { canvas: 'Boards/Launch.canvas', cards: [{ type: 'text', text: 'Breads', ref: 'b' }], links: [{ from: 'a1', to: 'b' }] })));
  assert.ok(added.cards.b);
  ok(await callAs(t.access, a, 'canvas_change', { canvas: 'Boards/Launch.canvas', changes: [{ id: 'a1', text: 'Winter soups', x: 40, color: '4' }, { id: 'p1', x: 900 }] }));
  const launch = JSON.parse(t.files.get('Boards/Launch.canvas'));
  assert.equal(launch.nodes.find((x) => x.id === 'a1').text, 'Winter soups');
  assert.equal(launch.nodes.find((x) => x.id === 'p1').x, 900, 'a project’s card moves');
  const bound = await callAs(t.access, a, 'canvas_change', { canvas: 'Boards/Launch.canvas', changes: [{ id: 'p1', text: 'changed' }] });
  assert.equal(bound.isError, true);
  assert.match(words(bound), /drawn from the project/);
  const read = JSON.parse(ok(await callAs(t.access, a, 'canvas_get', { canvas: 'Boards/Launch.canvas' })));
  assert.equal(read.cards.find((x) => x.id === 'p1').fromProject, true);
  ok(await callAs(t.access, a, 'canvas_remove', { canvas: 'Boards/Launch.canvas', ids: [added.cards.b] }));
  assert.equal(JSON.parse(t.files.get('Boards/Launch.canvas')).edges.length, 0, 'its lines go with it');
  // Undo the removal, then the change.
  let state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.ok(JSON.parse(t.files.get('Boards/Launch.canvas')).nodes.some((x) => x.id === added.cards.b));
  assert.equal((await callAs(t.access, a, 'canvas_add', { canvas: 'Boards/Launch.canvas', cards: [{ type: 'link', url: 'javascript:alert(1)' }] })).isError, true);
  assert.equal((await callAs(t.access, a, 'canvas_get', { canvas: 'Boards/Nope.canvas' })).isError, true);
  assert.equal((await callAs(t.access, a, 'canvas_create', { path: 'Boards/Launch.canvas' })).isError, true, 'never over one that is there');
});

test('assets and the brand kit: added from a path and from the web, described, the kit changed, with Undo', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  // A picture somewhere on the PC (outside Ironleaf's data, whose parent stands for the former host app's
  // profile here).
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-full-pic-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const pic = path.join(dir, 'Shopfront.png');
  writeFileSync(pic, 'png');
  assert.match(ok(await callAs(t.access, a, 'asset_add', { from: pic, tags: ['shop'], description: 'The shop at dawn' })), /Added Assets\/Images\/Shopfront\.png/);
  assert.deepEqual(t.assetMeta.get('Assets/Images/Shopfront.png').tags, ['shop']);
  assert.match(ok(await callAs(t.access, a, 'asset_add', { from: 'https://example.com/files/logo.png', name: 'Bakehouse logo.png', kind: 'logo' })), /Bakehouse logo\.png/);
  assert.equal(t.assetMeta.get('Assets/Images/Bakehouse logo.png').kind, 'logo');
  assert.equal((await callAs(t.access, a, 'asset_add', { from: 'relative/file.png' })).isError, true);
  // Never from Ironleaf's (or the former host app's) own data, where keys are kept; never a note or canvas in
  // disguise.
  mkdirSync(t.dataDir, { recursive: true });
  writeFileSync(path.join(t.dataDir, 'agents.json'), '{}');
  assert.match(words(await callAs(t.access, a, 'asset_add', { from: path.join(t.dataDir, 'agents.json') })), /settings folders are never copied/);
  assert.match(words(await callAs(t.access, a, 'asset_add', { from: path.join(path.dirname(t.dataDir), 'secrets.json') })), /settings folders are never copied/, 'inside the host app, its own profile too');
  assert.match(words(await callAs(t.access, a, 'asset_add', { from: pic, name: 'Sneaky.md' })), /aren’t assets/);
  ok(await callAs(t.access, a, 'asset_update', { asset: 'Assets/Images/Shopfront.png', tags: ['shop', 'hero'], alt: 'The bakery shopfront' }));
  assert.deepEqual(t.assetMeta.get('Assets/Images/Shopfront.png').tags, ['shop', 'hero']);
  let state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.deepEqual(t.assetMeta.get('Assets/Images/Shopfront.png').tags, ['shop']);
  ok(await callAs(t.access, a, 'brand_kit_set', { colours: [{ hex: '#1f3a5f', name: 'Harbour' }, { hex: '#e8d5b0', name: 'Crust' }], logos: { primary: 'Assets/Images/Bakehouse logo.png' } }));
  assert.equal(t.brand.value.colours.length, 2);
  assert.equal(t.brand.value.name, 'Saltwater Bakehouse', 'what wasn’t given stays');
  state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.equal(t.brand.value.colours.length, 1);
});

test('a new next step added and undone, and the weekly review drafted and saved, with Undo', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  // t238: no filing tool — a meeting’s actions are its project’s tasks already. A genuinely new step goes
  // through project_add_next_step, still with Undo.
  await callAs(t.access, a, 'project_add_next_step', { project: 'Studio Upgrade', what: 'Approve the lighting quote', who: 'Priya Nair' });
  assert.match(t.files.get(STORE), /Approve the lighting quote/);
  let state = await t.access.state();
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.ok(!t.files.get(STORE).includes('Approve the lighting quote'));
  const draft = JSON.parse(ok(await callAs(t.access, a, 'review_draft', {})));
  assert.equal(draft.week, '2026-W42');
  assert.match(ok(await callAs(t.access, a, 'review_apply', { draft })), /Reviews\/2026-W42\.md/);
  state = await t.access.state();
  assert.match(state.activity[0].words, /Saved the weekly review “2026-W42” with 2 changes/);
  assert.match(await t.access.undo(state.activity[0].id), /^Undone/);
  assert.deepEqual(t.reviews.undone, ['rv1']);
});

test('Private notes stay out of reach at Full control', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  for (const [tool, args] of [
    ['note_write', { path: 'Private notes/Diary.md', content: 'x' }],
    ['note_write', { path: 'private notes/New.md', content: 'x' }],
    ['note_move', { from: 'Private notes/Diary.md', to: 'Notes/Diary.md' }],
    ['note_move', { from: 'Notes/Oven service.md', to: 'Private notes/Oven.md' }],
    ['note_set_properties', { path: 'Private notes/Diary.md', properties: { a: 1 } }],
    ['canvas_create', { path: 'Private notes/Board.canvas' }],
    ['canvas_create', { path: 'Boards/Peek.canvas', cards: [{ type: 'note', file: 'Private notes/Diary.md' }] }],
    ['template_from_note', { note: 'Private notes/Diary.md', name: 'Leak' }],
  ]) {
    const r = await callAs(t.access, a, tool, args);
    assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.match(words(r), /Private notes are never open to agents|There is no note/);
  }
  assert.equal(t.files.get('Private notes/Diary.md'), NOTES['Private notes/Diary.md']);
  assert.ok(!t.files.has('Notes/Diary.md'));
});

test('rewriting to a new path under a kept title is refused until it has been read', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  const refused = await callAs(t.access, a, 'note_write', { path: 'Baking/Oven service.md', content: '# Oven service\n\nOther words.\n' });
  assert.equal(refused.isError, true);
  assert.match(words(refused), /There is already “Oven service” at Notes\/Oven service\.md\. Read it first \(note_read\)/);
  assert.ok(!t.files.has('Baking/Oven service.md'), 'no second note');
  ok(await callAs(t.access, a, 'note_read', { path: 'Notes/Oven service.md' }));
  ok(await callAs(t.access, a, 'note_write', { path: 'Baking/Oven service.md', content: '# Oven service\n\nOther words.\n' }));
  assert.ok(t.files.has('Baking/Oven service.md'), 'read first, then truly another: goes ahead');
});

test('adding to today’s note twice writes once', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  ok(await callAs(t.access, a, 'daily_note', { text: 'Rang the supplier.' }));
  assert.match(words(await callAs(t.access, a, 'daily_note', { text: 'Rang the supplier.' })), /already the last thing in today’s note, so nothing was added/);
  assert.equal(t.files.get('Daily/2026-10-17.md').split('Rang the supplier.').length - 1, 1, 'written once');
});

test('properties and tags through the one rule: merge, remove, replace, whatever the key’s capitalisation', async () => {
  const t = await setup();
  const a = await fullAgent(t);
  ok(await callAs(t.access, a, 'note_write', { path: 'Notes/Shop.md', content: '---\ntags: [harbour]\n---\n# Shop\n' }));
  ok(await callAs(t.access, a, 'note_write', { path: 'Notes/Caps.md', content: '---\nTags: [harbour]\n---\n# Caps\n' }));
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Shop.md', properties: { tags: ['urgent'] } }));
  assert.match(t.files.get('Notes/Shop.md'), /tags:\n {2}- harbour\n {2}- urgent/, 'given tags join the note’s own');
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Shop.md', remove_tags: ['harbour'] }));
  assert.match(t.files.get('Notes/Shop.md'), /tags:\n {2}- urgent\n/, 'taken off, the rest stay');
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Shop.md', properties: { tags: ['solo'] }, replace_tags: true }));
  assert.match(t.files.get('Notes/Shop.md'), /tags:\n {2}- solo\n/, 'replaced exactly');
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Caps.md', remove_tags: ['harbour'] }));
  assert.doesNotMatch(t.files.get('Notes/Caps.md'), /harbour/, 'a capitalised Tags key is read too');
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Caps.md', properties: { Tags: ['pier'] } }));
  ok(await callAs(t.access, a, 'note_set_properties', { path: 'Notes/Caps.md', properties: { tags: ['quay'] } }));
  assert.equal((t.files.get('Notes/Caps.md').match(/tags:/gi) || []).length, 1, 'no second tags key beside the first, whatever the case given');
  assert.match(t.files.get('Notes/Caps.md'), /pier/, 'the note’s tags stay');
  assert.match(t.files.get('Notes/Caps.md'), /quay/, 'and the new one joins them');
});
