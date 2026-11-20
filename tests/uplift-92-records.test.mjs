// node --test tests/uplift-92-records.test.mjs — the 9.2 uplift's find-before-create (F10, F62, F65, F71,
// F77, F78, F139): imports update or keep both by choice and reuse the folder's view; people, links and logs
// find what's there before making; ambiguous links resolve to nothing, never a silent pick; renamed copies say
// their drift first; a project already here opens instead of erroring. Pure logic is checked as it is; the
// screens are guarded by the lookup they call, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-records-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/resolve.ts'))};\nexport { setState } from ${JSON.stringify(path.join(root, 'src/renderer/src/state/store.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  const note = (p, title) => ({ path: p, title, aliases: [], props: {}, links: [], tags: [] });
  R.setState({
    notes: [note('A/Harbour.md', 'Harbour'), note('B/Harbour.md', 'Harbour'), note('Notes/Solo.md', 'Solo')],
    files: [
      { rel: 'A/pic.png', mtime: 0, size: 0, kind: 'file' },
      { rel: 'B/pic.png', mtime: 0, size: 0, kind: 'file' },
    ],
  });
});
after(() => rmSync(work, { recursive: true, force: true }));

test('ambiguous links resolve to nothing, never a silent pick (F71)', () => {
  assert.equal(R.resolveNote('Harbour'), null, 'two Harbours, no winner: nothing');
  assert.equal(R.resolveNote('Harbour', 'A/Other.md'), 'A/Harbour.md', 'the same folder still wins');
  assert.equal(R.resolveNote('Solo'), 'Notes/Solo.md');
  assert.equal(R.resolveNote('Missing'), null);
  assert.equal(R.resolveFile('pic.png'), null, 'two files, no winner: nothing');
});

test('imports, people, links and logs find before they make (F10, F62, F65, F77)', () => {
  const csv = read('src/renderer/src/state/importCsv.ts');
  assert.ok(csv.includes("label: collide.length === 1 ? 'Update it' : 'Update them'"), 'collisions update or keep both (F10)');
  assert.ok(csv.includes('notes.write(at, importedNoteText(n))'), 'updates write the rows in (F10)');
  assert.ok(csv.includes('reuse ?? (await window.nv.files.create'), 'the folder’s view is reused (F10)');
  assert.ok(read('src/renderer/src/state/peek.ts').includes('already has a page'), 'a person’s page found first (F62)');
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes('n.title.toLowerCase() === name.toLowerCase()'), 'links near-match before creating (F65)');
  assert.ok(actions.includes("names ${plural(near.length, 'note')}. Which one?"), 'several matches pick (F65; one plural rule, 10.0)');
  const logs = read('src/renderer/src/state/layoutLogs.ts');
  assert.ok(logs.includes("n.title.toLowerCase() === prefix"), 'the log found first (F77)');
  assert.doesNotMatch(logs, /let path = `\$\{dir \? `\$\{dir\}\/` : ''\}\$\{opts\.project\} log\.md`;\n    for/, 'no blind probe-then-create (F77)');
});

test('copies and clashes say so before they happen (F78, F139)', () => {
  const vault = read('src/renderer/src/state/vaultFiles.ts');
  assert.ok(vault.includes('Keep both copies?'), 'the drift is said first (F78)');
  assert.ok(vault.includes('won’t stay in step'), 'in plain words (F78)');
  const dialog = read('src/renderer/src/components/NewProjectDialog.tsx');
  assert.ok(dialog.includes('is already a project'), 'the clash shows inline (F139)');
  assert.ok(dialog.includes('Open it'), 'with Open it (F139)');
});

test('stable identity from list to write, never first-match (F35, F36, F37)', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('lines[item.from]?.includes(first)'), 'its place when still true (F35)');
  assert.ok(inbox.includes('l.trim() === first.trim()'), 'else its exact line (F35)');
  assert.ok(inbox.includes('x.from === at'), 'refound by place (F35)');
  const person = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(person.includes('whole(lines[item.line])'), 'its place with its whole title (F36)');
  assert.ok(person.includes('findIndex(whole)'), 'else the whole title found (F36)');
  assert.ok(person.includes('String.fromCharCode(8212)'), 'tails allowed, prefixes never (F36)');
  assert.ok(read('src/renderer/src/views/MeetingActions.tsx').includes(':${a.line}:'), 'row keys carry lines (F37)');
});

test('joins prefer paths and owners never stack (F40, F49, F113)', () => {
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes('resolveNote(ref, n.path)'), 'project chips resolve by path first (F40)');
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.equal((vendors.match(/sameRecord\(v\.path \|\| null, v\.name, x\.vendorPath, x\.vendor\)/g) ?? []).length, 2, 'both joins prefer paths (F49)');
  // t249's one view moved the owner writer out of Tasks into the shared setTaskWho (REPORT-t249 item 3):
  // the row writes through it, and it rebuilds one tail (unit-pinned in vault-editable2).
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('setTaskWho'), 'the owner writes through the shared function (F113)');
  assert.ok(read('src/shared/tasks.ts').includes('`${title} — ${segments}`'), 'one tail rebuilt, owners never stack (F113)');
});
