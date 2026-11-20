// node --test tests/fewer-folders.test.mjs — fewer folders on show (5 Nov 2026). The Notes folder
// tree and the file views show machinery next to a person's work; the main view shows only their own
// areas and real folders, the rest under one quiet Show everything. Finished projects sit under one
// quiet Finished line, never among active ones. A folder with a single note of the same name reads
// as that note. Made-up vault, a realistic shape: areas, machinery, inventory, finished work.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-fewer-'));
let F;
let N;
let L;
let Fin;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as fewer from ${JSON.stringify(path.join(root, 'src/shared/fewer-folders.ts'))};`,
      `export * as navigator from ${JSON.stringify(path.join(root, 'src/shared/navigator.ts'))};`,
      `export * as notesList from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};`,
      `export * as finished from ${JSON.stringify(path.join(root, 'src/shared/finished.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  F = M.fewer;
  N = M.navigator;
  L = M.notesList;
  Fin = M.finished;
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-11-05T09:00:00');
const note = (p, props = {}, ago = 1) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), label: p.split('/').pop().replace(/\.md$/, ''), mtime: T - ago * 86400000, props });
const areasWith = () => [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: '' },
  { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: '' },
  { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: '' },
  { id: 'me', name: 'Me', folder: 'Me', icon: 'person', color: 'sky', about: '' },
  { id: 'library', name: 'Library', folder: 'Library', icon: 'bookmark', color: 'stone', about: '', quiet: true },
];
const ctxWith = () => ({
  templatesFolder: 'Templates',
  assetsFolder: 'Assets',
  attachmentsFolder: 'Attachments',
  dailyFolder: 'Daily',
  docsFolder: 'Docs',
  areas: areasWith(),
  moduleFolders: ['Me/Finance', 'Home/Systems and Home Lab'],
});
const config = (more = {}) => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments', dailyFolder: 'Daily', todayName: '2026-11-05', showAllFiles: true, ...more });

// An invented a made-up vault of realistic size: own areas with real folders, machinery beside them, a
// finished project, and a folder holding one note of its own name.
function vault() {
  const notes = [
    note('Work/Notes/Kick-off.md'),
    note('Business/Plan.md'),
    note('Home/Notes/Paint colours.md'),
    note('Me/Notes/Weekend.md'),
    note('Assets/logo.png.md'),
    note('Daily/2026-11-05.md'),
    note('Templates/Meeting.md'),
    note('Views/Reading list.md'),
    note('Reviews/Weekly review.md'),
    note('Private notes/Quiet.md'),
    note('Dashboards/Overlook.md'),
    note('Me/Finance/Bills/Internet.md', { type: 'bill' }),
    note('Home/Systems and Home Lab/Services/kaitiaki-arcade.md', { type: 'service' }),
    note('Projects/Studio Upgrade/Studio Upgrade.md', { type: 'project', status: 'active' }),
    note('Projects/Old Fit-out/Old Fit-out.md', { type: 'project', status: 'archived' }),
    note('Work/Meeting notes/Meeting notes.md'),
    note('Work/Meeting notes/Extra.md'),
    note('Home/Garden/Garden.md'),
  ];
  const files = [
    ...notes.map((n) => ({ rel: n.path, mtime: n.mtime, kind: 'note' })),
    { rel: 'Assets/Logos/Bakehouse logo.svg', mtime: T, kind: 'image' },
  ];
  const folders = ['Work', 'Work/Notes', 'Business', 'Home', 'Home/Notes', 'Me', 'Me/Notes', 'Assets', 'Daily', 'Templates', 'Views', 'Reviews', 'Private notes', 'Dashboards', 'Me/Finance', 'Me/Finance/Bills', 'Home/Systems and Home Lab', 'Home/Systems and Home Lab/Services', 'Projects', 'Projects/Studio Upgrade', 'Projects/Old Fit-out', 'Work/Meeting notes', 'Home/Garden', 'Library'];
  return { notes, files, folders };
}

test('what hides under Show everything, with areas and without (a person’s own folder outside the areas sits there too until filed)', () => {
  const ctx = ctxWith();
  for (const top of ['Work', 'Business', 'Home', 'Me']) assert.equal(F.isMachineryTop(top, ctx), false, `${top} is the person’s own area`);
  for (const top of ['Assets', 'Daily', 'Templates', 'Views', 'Reviews', 'Private notes', 'Dashboards', 'Projects']) assert.equal(F.isMachineryTop(top, ctx), true, `${top} sits under Show everything when the vault has areas`);
  assert.equal(F.isMachineryTop('Library', ctx), true, 'the quiet area sits under Show everything too');
  assert.equal(F.isMachineryTop('Inbox', ctx), false, 'the Inbox stays where new things wait');
  assert.equal(F.isMachineryTop('Recipes', ctx), true, 'a top folder outside the areas is not shown with them');
  // A vault without areas: only what the app manages hides, and a person’s own folder never does.
  const bare = { ...ctx, areas: [] };
  for (const top of ['Assets', 'Daily', 'Templates', 'Views', 'Reviews', 'Private notes', 'Dashboards']) assert.equal(F.isMachineryTop(top, bare), true, top);
  for (const top of ['Work', 'Recipes', 'My Templates', 'Daily notes']) assert.equal(F.isMachineryTop(top, bare), false, `${top} is a folder the person made`);
  // Inside an area, the app’s own subfolders hide the same way; the person’s folders do not.
  assert.equal(F.isMachineryPath('Me/Finance/Bills/Internet.md', ctx), true);
  assert.equal(F.isMachineryPath('Home/Systems and Home Lab/Services/kaitiaki-arcade.md', ctx), true);
  assert.equal(F.isMachineryPath('Work/Notes/Kick-off.md', ctx), false);
  assert.equal(F.isMachineryPath('Me/Notes/Weekend.md', ctx), false);
});

test('the Notes rail shows only their own folders, counts what is shown', () => {
  const { notes } = vault();
  const rows = notes.map((n) => L.noteRow({ path: n.path, title: n.title, mtime: n.mtime, props: n.props }));
  const ctx = ctxWith();
  const shown = rows.filter((r) => !F.isMachineryPath(r.path, ctx));
  const folders = L.folderChoices(shown);
  assert.ok(folders.some((f) => f.prefix === 'Work'), 'their Work folder shows');
  assert.ok(!folders.some((f) => f.prefix === 'Assets'), 'Assets sits under Show everything');
  assert.ok(!folders.some((f) => f.prefix === 'Templates'), 'Templates sits under Show everything');
  assert.ok(!folders.some((f) => f.prefix === 'Me' && f.subs.some((s) => s.prefix === 'Me/Finance')), 'the Money pack’s folder sits under Show everything inside its area');
  const work = folders.find((f) => f.prefix === 'Work');
  assert.equal(work.count, shown.filter((r) => r.path.startsWith('Work/')).length, 'a folder’s count counts what is shown');
});

test('the Notes tree hides machinery unless Show everything, and still finds it', () => {
  const { notes, files, folders } = vault();
  const ctx = ctxWith();
  const hidden = N.buildSections(notes, files, folders, { ...config(), machinery: ctx, showMachinery: false });
  const tops = hidden.notes.folders.map((f) => f.path);
  assert.ok(tops.includes('Work'), 'their area shows');
  for (const m of ['Assets', 'Daily', 'Templates', 'Views', 'Reviews', 'Private notes', 'Dashboards']) assert.ok(!tops.includes(m), `${m} sits under Show everything`);
  assert.ok(!JSON.stringify(hidden.notes).includes('kaitiaki-arcade'), 'machine-made inventory sits under Show everything inside its area');
  // Counts count what is shown.
  const work = hidden.notes.folders.find((f) => f.path === 'Work');
  assert.ok(work.count < N.buildSections(notes, files, folders, config()).notes.count, 'hidden things leave the counts');
  // Show everything brings it back, and search still finds what it should either way.
  const all = N.buildSections(notes, files, folders, { ...config(), machinery: ctx, showMachinery: true });
  assert.ok(all.notes.folders.some((f) => f.path === 'Views'), 'Show everything brings the folders back');
  assert.ok(N.navEntries(hidden, true).some((e) => e.path === 'Views/Reading list.md'), 'search still finds a hidden folder’s notes');
  assert.ok(N.navEntries(hidden, true).some((e) => e.path === 'Home/Systems and Home Lab/Services/kaitiaki-arcade.md'), 'search still finds hidden inventory');
  // Every page that uses those folders keeps working: templates and assets still build.
  assert.ok(hidden.counts.templates > 0 && hidden.assets.total > 0, 'Templates and Assets still build while hidden from Notes');
});

test('a folder with a single note of the same name reads as that note', () => {
  const { notes, files, folders } = vault();
  const s = N.buildSections(notes, files, folders, config());
  const walk = (f) => [...f.items.map((i) => i.path), ...f.folders.flatMap(walk)];
  const paths = walk(s.notes);
  assert.ok(paths.includes('Home/Garden/Garden.md'), 'the note still shows');
  const garden = s.notes.folders.find((f) => f.path === 'Home')?.folders.find((f) => f.path === 'Home/Garden');
  assert.equal(garden, undefined, 'no folder row for a folder that only holds its own note');
  assert.ok(s.notes.folders.find((f) => f.path === 'Work')?.folders.some((f) => f.path === 'Work/Meeting notes'), 'a folder with two notes stays a folder');
});

test('the kept lookups answer as the loops always did, and follow the vault as it changes (t146)', () => {
  // The same vault asked twice, then a changed one, then the first again: a kept answer must never
  // outlive its vault. Each branch the old loops walked (store names, ./… beside-the-note folders,
  // case, the Inbox, kept-out folders, pack tops and subs, areas with quiet and hidden).
  const a = { templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: './media', dailyFolder: 'Daily', docsFolder: 'Docs', areas: [], moduleFolders: ['Finance', 'Me/Finance', 'Home/Systems and Home Lab'], quietFolders: ['Old'] };
  const paths = ['Templates/a.md', 'Assets/x.png', 'media/y.png', 'Daily/2026-11-01.md', 'Docs/r.md', 'Finance/b.md', 'Me/Finance/Bills/i.md', 'Home/Systems and Home Lab/Services/s.md', 'Old/z.md', 'Old Vault/z.md', 'Inbox/n.md', 'Work/w.md', 'Views/v.md', 'Reviews/r.md'];
  const tops = ['Templates', 'Assets', 'Daily', 'Docs', 'Finance', 'Me', 'Old', 'Inbox', 'Work', 'Views', 'Media', '.'];
  const read = (ctx) => ({ paths: paths.map((p) => F.isMachineryPath(p, ctx)), tops: tops.map((t) => F.isMachineryTop(t, ctx)), quiet: paths.map((p) => F.isQuietPath(p, ctx)) });
  const first = read(a);
  assert.deepEqual(read(a), first, 'asked twice, the same answers');
  // Spot checks on the branches (the old loops' answers, kept by the sets).
  assert.equal(F.isMachineryTop('Finance', a), true, 'a pack’s own top folder hides without areas');
  assert.equal(F.isMachineryPath('Me/Finance/Bills/i.md', a), true, 'a pack’s subfolder hides inside an area folder');
  assert.equal(F.isMachineryPath('media/y.png', a), false, 'a ./… folder lives beside each note, never at the top');
  assert.equal(F.isMachineryTop('Media', a), false, 'a ./… folder hides no top folder');
  assert.equal(F.isMachineryTop('Inbox', a), false, 'the Inbox never hides');
  assert.equal(F.isQuietPath('Inbox/n.md', a), false, 'the Inbox never reads quiet');
  assert.equal(F.isQuietPath('Old/z.md', a), true, 'a kept-out folder hides what is in it');
  assert.equal(F.isQuietPath('Old Vault/z.md', a), false, 'a kept-out folder hides by the folder, not the start of a name');
  const b = { ...a, quietFolders: ['Old', 'Inbox', 'Work'], moduleFolders: ['Me/Finance'], areas: [{ id: 'work', folder: 'Work' }, { id: 'me', folder: 'Me', quiet: true }, { id: 'lib', folder: 'Library', hidden: true }] };
  const changed = read(b);
  assert.equal(F.isMachineryTop('Finance', b), true, 'outside the areas it still hides, as unknown now');
  assert.equal(F.isMachineryTop('Work', b), true, 'a folder kept out by choice hides even as an area');
  assert.equal(F.isMachineryTop('Me', b), true, 'a quiet area hides');
  assert.equal(F.isMachineryTop('Library', b), true, 'a hidden area hides');
  assert.equal(F.isMachineryTop('Inbox', b), false, 'even kept out on paper, the Inbox stays where new things wait');
  assert.equal(F.isQuietPath('Inbox/n.md', b), false, 'a stored Inbox entry is ignored however it is written');
  assert.equal(F.isMachineryPath('Work/w.md', b), true, 'kept out wins inside areas too');
  assert.notDeepEqual(changed, first, 'a changed vault answers changed');
  assert.deepEqual(read(a), first, 'back to the first vault, its answers come back whole');
});

test('finished projects sit under one quiet Finished line, never among active ones', () => {
  assert.equal(Fin.isFinished('archived'), true);
  assert.equal(Fin.isFinished('cancelled'), true);
  const { notes, files, folders } = vault();
  const s = N.buildSections(notes, files, folders, config());
  const old = s.projects.find((p) => p.name === 'Old Fit-out');
  assert.equal(old.done, true, 'archived counts as finished, the one rule');
  assert.deepEqual(s.projects.filter((p) => !p.done).map((p) => p.name), ['Studio Upgrade'], 'no finished project sits among active ones');
  assert.deepEqual(s.projects.filter((p) => p.done).map((p) => p.name), ['Old Fit-out'], 'finished projects stay reachable under their own line');
});
