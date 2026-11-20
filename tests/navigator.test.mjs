// node --test tests/navigator.test.mjs — the file list in sections (src/shared/navigator.ts; 17 Oct 2026). Made-up bakery
// and IT projects: each project gathers all its parts, every note and file is in exactly one place, today's daily note
// comes first, templates and assets keep to themselves, and thousands of notes stay quick.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-nav-'));
let N;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/navigator.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'nav.mjs'), format: 'esm' }, logLevel: 'silent' });
  N = await import(pathToFileURL(path.join(work, 'nav.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-10-17T09:00:00');
const day = 86400000;
const note = (p, props = {}, ago = 1, label) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), label: label ?? p.split('/').pop().replace(/\.md$/, ''), mtime: T - ago * day, props });
const project = (name, props = {}) => note(`Projects/${name}/${name}.md`, { type: 'project', status: 'active', health: 'on track', ...props }, 2, name);

// A lived-in library: a bakery and an IT team, notes everywhere.
function library() {
  const notes = [
    project('Saltwater Bakehouse', { health: 'at risk', folder: 'C:\\Users\\mia\\Bakehouse' }),
    project('Studio Upgrade', { health: 'off track' }),
    project('Supplier Review', { status: 'done' }),
    note('Projects/Saltwater Bakehouse/Kick-off meeting.md', {}, 9),
    note('Projects/Saltwater Bakehouse/Activity/Draft the order form.md', { status: 'done' }, 3),
    note('Projects/Saltwater Bakehouse/Activity/Price the loyalty cards.md', { status: 'failed' }, 1),
    note('Projects/Saltwater Bakehouse/Reports/Progress report October.md', {}, 0.5),
    note('Projects/Studio Upgrade/Meetings/Wave two.md', {}, 4),
    note('Meetings/Supplier call.md', { project: '[[Saltwater Bakehouse]]' }, 2),
    note('Meetings/Till vendor.md', { project: 'Projects/Studio Upgrade/Studio Upgrade.md' }, 6),
    note('Meetings/Team lunch.md', { project: 'Not a project' }, 5),
    note('Pricing ideas.md', {}, 7),
    note('Weekly menu.md', {}, 1),
    note('Daily/2026-10-17.md', {}, 0),
    note('Daily/2026-10-16.md', {}, 1),
    note('Daily/2026-09-30.md', {}, 17),
    note('Daily/2026-09-02.md', { project: '[[Studio Upgrade]]' }, 45),
    note('Templates/Meeting.md', { project: '{{project}}' }, 30),
    note('Templates/Projects/Office move.md', { type: 'project', status: 'planning' }, 30),
    note('Templates/Reports/Progress report.md', {}, 30),
    note('Projects/Website rebuild.md', { tags: ['project'] }, 8),
  ];
  const files = [
    ...notes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' })),
    { rel: 'Projects/Saltwater Bakehouse/Saltwater Bakehouse.canvas', mtime: T - day, kind: 'canvas' },
    { rel: 'Projects/Saltwater Bakehouse/storefront sketch.png', mtime: T - day, kind: 'image' },
    { rel: 'Projects/Portfolio board.canvas', mtime: T - day, kind: 'canvas' },
    { rel: 'Board.canvas', mtime: T - 2 * day, kind: 'canvas' },
    { rel: 'Attachments/storefront.png', mtime: T - 3 * day, kind: 'image' },
    { rel: 'Attachments/receipt.pdf', mtime: T - 3 * day, kind: 'pdf' },
    { rel: 'Assets/Logos/Bakehouse logo.svg', mtime: T, kind: 'image' },
    { rel: 'Assets/Images/Sourdough.jpg', mtime: T, kind: 'image' },
    { rel: 'Assets/Images/Croissant.jpg', mtime: T, kind: 'image' },
    { rel: 'Assets/Documents/Menu.pdf', mtime: T, kind: 'pdf' },
  ];
  const folders = ['Projects', 'Projects/Saltwater Bakehouse', 'Projects/Saltwater Bakehouse/Activity', 'Projects/Saltwater Bakehouse/Reports', 'Projects/Studio Upgrade', 'Projects/Studio Upgrade/Meetings', 'Projects/Supplier Review', 'Meetings', 'Daily', 'Templates', 'Templates/Projects', 'Templates/Reports', 'Attachments', 'Assets', 'Assets/Logos', 'Assets/Images', 'Assets/Documents', 'Recipes', 'Projects/Studio Upgrade/Empty inside'];
  return { notes, files, folders };
}
const config = (more = {}) => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', todayName: '2026-10-17', showAllFiles: true, ...more });
const sections = (more) => {
  const { notes, files, folders } = library();
  return N.buildSections(notes, files, folders, config(more));
};
const paths = (items) => items.map((i) => i.path);
const treePaths = (f) => [...paths(f.items), ...f.folders.flatMap(treePaths)];

test('each project gathers all its parts: its page, notes, activity, reports, canvas and files', () => {
  const s = sections();
  const bake = s.projects.find((p) => p.name === 'Saltwater Bakehouse');
  assert.equal(bake.dir, 'Projects/Saltwater Bakehouse');
  assert.equal(bake.health, 'at risk');
  assert.equal(bake.pcFolder, 'C:\\Users\\mia\\Bakehouse');
  assert.deepEqual(paths(bake.notes), ['Meetings/Supplier call.md', 'Projects/Saltwater Bakehouse/Kick-off meeting.md'], 'its folder’s notes and notes naming it, newest first');
  assert.deepEqual(paths(bake.activity), ['Projects/Saltwater Bakehouse/Activity/Price the loyalty cards.md', 'Projects/Saltwater Bakehouse/Activity/Draft the order form.md']);
  assert.deepEqual(bake.activity.map((a) => a.status), ['failed', 'done']);
  assert.deepEqual(paths(bake.reports), ['Projects/Saltwater Bakehouse/Reports/Progress report October.md']);
  assert.deepEqual(paths(bake.canvases), ['Projects/Saltwater Bakehouse/Saltwater Bakehouse.canvas']);
  assert.deepEqual(paths(bake.files), ['Projects/Saltwater Bakehouse/storefront sketch.png']);
  const store = s.projects.find((p) => p.name === 'Studio Upgrade');
  assert.deepEqual(paths(store.notes).sort(), ['Meetings/Till vendor.md', 'Projects/Studio Upgrade/Meetings/Wave two.md'], 'a project named by its path; a note in a subfolder of its folder');
  assert.equal(s.place.get('Projects/Saltwater Bakehouse/Saltwater Bakehouse.md').part, 'overview');
  assert.equal(s.place.get('Meetings/Supplier call.md').project, 'Projects/Saltwater Bakehouse/Saltwater Bakehouse.md');
});

test('projects go by name with done ones last; a project template is a template, not a project', () => {
  const s = sections();
  assert.deepEqual(s.projects.map((p) => p.name), ['Saltwater Bakehouse', 'Studio Upgrade', 'Supplier Review']);
  assert.equal(s.projects[2].done, true);
  assert.ok(treePaths(s.templates).includes('Templates/Projects/Office move.md'));
  assert.equal(s.counts.projects, 3);
});

test('a note in a project’s folder is under its project, never again under Notes', () => {
  const s = sections();
  const notes = treePaths(s.notes);
  for (const p of notes) assert.ok(!p.startsWith('Projects/Saltwater Bakehouse/') && !p.startsWith('Projects/Studio Upgrade/'), p);
  assert.ok(!notes.includes('Meetings/Supplier call.md'), 'a note naming a project is under the project');
  assert.ok(notes.includes('Meetings/Team lunch.md'), 'a property naming no project leaves the note in Notes');
  assert.ok(notes.includes('Projects/Website rebuild.md'), 'a loose note in the projects folder (not a project) stays a note');
  assert.ok(!s.notes.folders.some((f) => f.path === 'Daily' || f.path === 'Templates' || f.path === 'Assets' || f.path === 'Attachments'), 'no system folders in Notes');
  assert.ok(s.notes.folders.some((f) => f.path === 'Recipes' && f.count === 0), 'an empty folder the person made shows');
  assert.ok(!JSON.stringify(s.notes).includes('Empty inside'), 'an empty folder inside a project stays out of Notes');
});

test('every note and file is in exactly one place', () => {
  const { notes, files, folders } = library();
  const s = N.buildSections(notes, files, folders, config());
  const seen = [];
  for (const p of s.projects) seen.push(p.path, ...paths(p.notes), ...paths(p.activity), ...paths(p.reports), ...paths(p.canvases), ...paths(p.files));
  seen.push(...treePaths(s.notes), ...treePaths(s.templates), ...treePaths(s.attachments), ...paths(s.canvases), ...paths(s.assets.items));
  if (s.daily.today) seen.push(s.daily.today.path);
  for (const m of s.daily.months) seen.push(...paths(m.items));
  assert.equal(new Set(seen).size, seen.length, 'nothing twice');
  assert.deepEqual([...seen].sort(), files.map((f) => f.rel).sort(), 'nothing left out');
  for (const f of files) assert.ok(s.place.has(f.rel), `a place for ${f.rel}`);
});

test('daily: today first, then month by month, newest first; a daily note naming a project stays in Daily', () => {
  const s = sections();
  assert.equal(s.daily.today.path, 'Daily/2026-10-17.md');
  assert.equal(s.daily.todayPath, 'Daily/2026-10-17.md');
  assert.deepEqual(s.daily.months.map((m) => m.label), ['October 2026', 'September 2026']);
  assert.deepEqual(paths(s.daily.months[1].items), ['Daily/2026-09-30.md', 'Daily/2026-09-02.md']);
  assert.equal(s.counts.daily, 4);
  const notToday = N.buildSections(library().notes.filter((n) => n.path !== 'Daily/2026-10-17.md'), [], [], config());
  assert.equal(notToday.daily.today, null);
  assert.equal(notToday.daily.todayPath, 'Daily/2026-10-17.md', 'where today’s note will go, to make it');
});

test('views over notes go under Views wherever their file is, named without .view.json', () => {
  const notes = [note('Meetings/Supplier call.md')];
  const files = [
    { rel: 'Meetings/Supplier call.md', mtime: T, kind: 'note' },
    { rel: 'Views/Reading list.view.json', mtime: T, kind: 'view' },
    { rel: 'Projects/Studio Upgrade/Board.view.json', mtime: T, kind: 'view' },
  ];
  const s = N.buildSections(notes, files, ['Meetings', 'Views', 'Projects', 'Projects/Studio Upgrade'], { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', showAllFiles: false });
  assert.deepEqual(s.views.map((v) => v.name), ['Board', 'Reading list']);
  assert.equal(s.views[0].ext, '');
  assert.equal(s.counts.views, 2);
  assert.equal(s.place.get('Views/Reading list.view.json').section, 'views');
  assert.ok(N.navEntries(s).some((e) => e.kind === 'view' && e.name === 'Reading list'));
});

test('canvases and boards, templates, assets by kind, attachments', () => {
  const s = sections();
  assert.deepEqual(paths(s.canvases), ['Board.canvas', 'Projects/Portfolio board.canvas']);
  assert.equal(s.counts.templates, 3);
  assert.equal(s.assets.total, 4);
  assert.deepEqual(s.assets.kinds.map((k) => [k.kind, k.count]), [['logo', 1], ['image', 2], ['document', 1]]);
  assert.deepEqual(treePaths(s.attachments).sort(), ['Attachments/receipt.pdf', 'Attachments/storefront.png']);
});

test('with only notes listed (Settings), pictures and PDFs leave Notes but the asset store still counts', () => {
  const s = sections({ showAllFiles: false });
  assert.ok(!treePaths(s.templates).some((p) => p.endsWith('.png')));
  assert.equal(s.assets.total, 4);
});

test('attachments beside each note (./files) and at the top', () => {
  const notes = [note('Recipes/Bread.md'), note('Pricing.md')];
  const files = [...notes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' })), { rel: 'Recipes/files/loaf.png', mtime: T, kind: 'image' }, { rel: 'top.png', mtime: T, kind: 'image' }];
  const beside = N.buildSections(notes, files, [], config({ attachmentsFolder: './files' }));
  assert.deepEqual(treePaths(beside.attachments), ['Recipes/files/loaf.png']);
  assert.ok(treePaths(beside.notes).includes('top.png'));
  const top = N.buildSections(notes, files, [], config({ attachmentsFolder: '' }));
  assert.deepEqual(treePaths(top.attachments), ['top.png']);
});

test('a project file kept loose owns no folder, and the property values people write all find it', () => {
  const notes = [note('Bakery.md', { type: 'project' }, 1, 'Saltwater Bakery'), note('Ideas/Loaf.md', { project: ['[[Saltwater Bakery|the bakery]]'] }), note('Ideas/Rolls.md', { projects: 'Bakery' }), note('Ideas/Other.md')];
  const s = N.buildSections(notes, [], [], config());
  assert.equal(s.projects[0].dir, null);
  assert.deepEqual(paths(s.projects[0].notes).sort(), ['Ideas/Loaf.md', 'Ideas/Rolls.md']);
  assert.deepEqual(treePaths(s.notes), ['Ideas/Other.md']);
  assert.deepEqual(N.propertyProjects('[Bakery](Projects/Bakery/Bakery.md)'), ['projects/bakery/bakery.md', 'projects/bakery/bakery']);
});

test('a note naming several projects (a weekly review) stays in Notes; naming one project twice still files it there', () => {
  const notes = [note('Projects/Bakery/Bakery.md', { type: 'project' }, 1, 'Bakery'), note('Projects/Store/Store.md', { type: 'project' }, 1, 'Store'), note('Reviews/Weekly review.md', { type: 'review', projects: ['[[Bakery]]', '[[Store]]'] }), note('Ideas/Loaf.md', { project: '[[Bakery]]', projects: ['[[Bakery]]'] })];
  const s = N.buildSections(notes, [], [], config());
  assert.ok(treePaths(s.notes).includes('Reviews/Weekly review.md'), 'in Notes, in its Reviews folder');
  assert.ok(!s.projects.some((p) => paths(p.notes).includes('Reviews/Weekly review.md')), 'under no single project');
  assert.deepEqual(paths(s.projects.find((p) => p.name === 'Bakery').notes), ['Ideas/Loaf.md']);
});

test('the filter finds across every section, names first, and says where each one is', () => {
  const s = sections();
  const entries = N.navEntries(s);
  const found = N.findEntries(entries, 'studio');
  assert.equal(found[0].kind, 'project');
  assert.equal(found[0].name, 'Studio Upgrade');
  assert.ok(!found.some((e) => e.path === 'Meetings/Till vendor.md'), 'typing a project’s name finds the project, not every note in it');
  const till = N.findEntries(entries, 'till studio');
  assert.ok(till.some((e) => e.path === 'Meetings/Till vendor.md' && e.where === 'Studio Upgrade · Notes'), 'a word can match where a note is');
  const loaf = N.findEntries(entries, 'progress report');
  assert.deepEqual(loaf.map((e) => e.section).sort(), ['projects', 'templates']);
  assert.equal(N.findEntries(entries, 'storefront').length, 1, 'attachments are found only when shown');
  assert.equal(N.findEntries(N.navEntries(s, true), 'storefront').length, 2);
  assert.deepEqual(N.findEntries(entries, '   '), []);
});

test('thousands of notes are sorted into sections quickly', () => {
  const notes = [];
  for (let p = 0; p < 60; p++) notes.push(project(`Project ${p}`));
  for (let i = 0; i < 6000; i++) {
    const r = i % 6;
    if (r === 0) notes.push(note(`Projects/Project ${i % 60}/Note ${i}.md`));
    else if (r === 1) notes.push(note(`Area ${i % 40}/Sub ${i % 7}/Note ${i}.md`));
    else if (r === 2) notes.push(note(`Daily/2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')} ${i}.md`));
    else if (r === 3) notes.push(note(`Inbox/Note ${i}.md`, { project: `Project ${i % 60}` }));
    else notes.push(note(`Note ${i}.md`));
  }
  const files = notes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' }));
  const started = performance.now();
  const s = N.buildSections(notes, files, [], config());
  N.findEntries(N.navEntries(s), 'note 12');
  const took = performance.now() - started;
  assert.ok(took < 400, `took ${Math.round(took)} ms`);
  const total = s.projects.reduce((n, p) => n + 1 + p.notes.length + p.activity.length + p.reports.length, 0) + s.notes.count + s.daily.count;
  assert.equal(total, notes.length);
});

// Docs (18 Oct 2026): their own section between Projects and Notes, each with its canvas and its own folder's things; a
// doc is never a note in Notes.
test('docs have their own section: by type anywhere or in the Docs folder; canvas and own folder go with them', () => {
  const { notes, files, folders } = library();
  const docNotes = [
    note('Docs/Minecraft server.md', { type: 'doc', about: 'How the family server is set up and run.', canvas: 'Docs/Minecraft server.canvas' }, 1),
    note('Docs/Backups.md', {}, 2),
    note('Reference/Payroll.md', { type: 'doc' }, 3),
    note('Docs/Minecraft server/Activity/Restart it.md', { status: 'done' }, 1),
    note('Docs/Meeting with IT.md', { type: 'meeting' }, 4),
  ];
  const allNotes = [...notes, ...docNotes];
  const allFiles = [...files, ...docNotes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' })), { rel: 'Docs/Minecraft server.canvas', mtime: T, kind: 'canvas' }, { rel: 'Docs/Minecraft server/world map.png', mtime: T, kind: 'image' }];
  const s = N.buildSections(allNotes, allFiles, [...folders, 'Docs', 'Docs/Minecraft server', 'Reference'], config());
  assert.deepEqual(N.SECTION_ORDER.slice(0, 3), ['projects', 'docs', 'notes']);
  assert.equal(N.SECTION_WORDS.docs, 'Docs');
  assert.deepEqual(s.docs.map((d) => d.name), ['Backups', 'Minecraft server', 'Payroll']);
  assert.equal(s.counts.docs, 3);
  const mc = s.docs.find((d) => d.name === 'Minecraft server');
  assert.equal(mc.about, 'How the family server is set up and run.');
  assert.equal(mc.canvas.path, 'Docs/Minecraft server.canvas');
  assert.deepEqual(paths(mc.items).sort(), ['Docs/Minecraft server/Activity/Restart it.md', 'Docs/Minecraft server/world map.png']);
  assert.deepEqual(s.place.get('Docs/Minecraft server.md'), { section: 'docs', doc: 'Docs/Minecraft server.md' });
  assert.deepEqual(s.place.get('Docs/Minecraft server.canvas'), { section: 'docs', doc: 'Docs/Minecraft server.md', part: 'canvas' });
  // Not in Notes, nor Canvases; the meeting note kept in Docs stays a note.
  const inNotes = [];
  const walk = (f) => { inNotes.push(...paths(f.items)); f.folders.forEach(walk); };
  walk(s.notes);
  assert.ok(!inNotes.some((p) => p === 'Docs/Backups.md' || p === 'Reference/Payroll.md' || p.startsWith('Docs/Minecraft server')));
  assert.ok(inNotes.includes('Docs/Meeting with IT.md'));
  assert.ok(!paths(s.canvases).includes('Docs/Minecraft server.canvas'));
  // Found by name, ahead of notes, with their about line as where they are.
  const found = N.findEntries(N.navEntries(s), 'minecraft');
  assert.equal(found[0].kind, 'doc');
  assert.equal(found[0].where, 'How the family server is set up and run.');
  // With no docs, the section is there and empty (the window shows "No docs yet.").
  const none = sections();
  assert.equal(none.counts.docs, 0);
  assert.deepEqual(none.docs, []);
});

// An order of the person's own (19 Oct 2026).
test('a saved order wins; what it does not name follows in its own order', () => {
  const list = ['a', 'b', 'c', 'd', 'new'];
  assert.deepEqual(N.inOrder(list, ['c', 'a', 'gone'], (x) => x), ['c', 'a', 'b', 'd', 'new']);
  assert.deepEqual(N.inOrder(list, undefined, (x) => x), list);
  assert.deepEqual(N.inOrder(list, [], (x) => x), list);
});

test('moving a key before or after another', () => {
  const keys = ['a', 'b', 'c', 'd'];
  assert.deepEqual(N.moveKey(keys, 'd', 'a', false), ['d', 'a', 'b', 'c']);
  assert.deepEqual(N.moveKey(keys, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(N.moveKey(keys, 'b', 'b', true), keys);
  assert.deepEqual(N.moveKey(keys, 'x', 'a', false), keys);
});
