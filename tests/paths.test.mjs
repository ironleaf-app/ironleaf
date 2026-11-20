// node --test tests/paths.test.mjs — paths inside the notes (src/shared/paths.ts; 9.5 fourth pass): whether a note is in
// a folder, the one check every templates/skip rule shares. Made-up paths.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-paths-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/paths.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('in a folder: the folder’s notes, slash or not, never its neighbours', () => {
  assert.equal(P.inFolder('Templates/Weekly.md', 'Templates'), true);
  assert.equal(P.inFolder('Templates/Weekly.md', 'Templates/'), true);
  assert.equal(P.inFolder('Templates/Weekly.md', 'templates'), true);
  assert.equal(P.inFolder('Templates/Sub/Deep.md', 'Templates//Sub//'), true);
  assert.equal(P.inFolder('Templates.md', 'Templates'), false);
  assert.equal(P.inFolder('Notes/X.md', 'Templates'), false);
  assert.equal(P.inFolder('Notes/X.md', ''), false);
});

test('trailing dots and spaces are dropped from every name Windows cannot keep (r2 meeting: “LF internal IT meeting.”)', () => {
  assert.equal(P.stripTrailingDots('LF internal IT meeting. '), 'LF internal IT meeting');
  assert.equal(P.stripTrailingDots('LF internal IT meeting.'), 'LF internal IT meeting');
  assert.equal(P.stripTrailingDots('Meeting'), 'Meeting');
  assert.equal(P.stripTrailingDots('v1.2'), 'v1.2', 'dots inside stay');
  assert.equal(P.stripTrailingDots('...', 'Note'), 'Note', 'nothing left: the fallback');
  assert.equal(P.stripTrailingDots('   ', 'File'), 'File');
  assert.equal(P.healRel('Meetings/LF internal IT meeting..md'), 'Meetings/LF internal IT meeting.md', 'a note’s stem, not its extension');
  assert.equal(P.healRel('Meetings/Files/LF internal IT meeting./rec.m4a'), 'Meetings/Files/LF internal IT meeting/rec.m4a', 'a folder on the way');
  assert.equal(P.healRel('Meetings/Files/Weekly sync /rec.m4a'), 'Meetings/Files/Weekly sync/rec.m4a', 'a trailing space too');
  assert.equal(P.healRel('Notes/Good.md'), 'Notes/Good.md', 'already clean: unchanged');
  assert.equal(P.healRel('Files/.files.json'), 'Files/.files.json', 'a dotfile’s own dots stay');
});

test('a Windows path through trailing dots reaches the file (\\\\?\\ form); elsewhere unchanged', () => {
  assert.equal(P.win32Abs('C:\\Vault\\Files\\LF internal IT meeting.\\rec.m4a', 'win32'), '\\\\?\\C:\\Vault\\Files\\LF internal IT meeting.\\rec.m4a');
  assert.equal(P.win32Abs('C:/Vault/Files/X.', 'win32'), '\\\\?\\C:\\Vault\\Files\\X.', 'forward slashes become backslashes under \\\\?\\');
  assert.equal(P.win32Abs('C:\\Vault\\Notes\\Good.md', 'win32'), 'C:\\Vault\\Notes\\Good.md', 'clean: unchanged');
  assert.equal(P.win32Abs('/vault/Files/X.', 'linux'), '/vault/Files/X.', 'other platforms: unchanged');
  assert.equal(P.win32Abs('/vault/Files/X.', 'darwin'), '/vault/Files/X.', 'other platforms: unchanged');
});

test('a typed name fits to leading words and says whether it was shortened (t207 pass 2)', () => {
  const long = 'Quarterly catering review for Wiremu Te Rangi-Fitzgerald & Associates across the northern region final draft for signing before Christmas';
  const fit = P.fitTypedName(long, 80);
  assert.equal(fit.cut, true, 'past the cap: shortened');
  assert.ok(fit.name.length <= 80 && long.startsWith(fit.name) && long[fit.name.length] === ' ', 'leading words, never mid-word');
  assert.deepEqual(P.fitTypedName('Short name', 80), { name: 'Short name', cut: false }, 'under the cap: kept whole, nothing said');
  assert.equal(P.fitTypedName('C# & Q&A planning', 120, false).name, 'C# & Q&A planning', 'a bare title keeps every character');
  assert.equal(P.fitTypedName('a/b\\c:d', 80).name, 'a b c d', 'a file-bound name cleans like the file rule');
  assert.equal(P.fitTypedName('Notes on the “harbour” job. ', 80).name, 'Notes on the “harbour” job', 'trailing dots go with the file clean');
  const def = P.fitTypedName(long);
  assert.equal(def.cut, true, 'no max given: shortened past what the main side keeps');
  assert.ok(def.name.length <= 80 && long.startsWith(def.name) && long[def.name.length] === ' ', 'the default fits 80 leading words (t212: 179 fitted, 78 kept)');
});
