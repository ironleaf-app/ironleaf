// node --test tests/backup.test.mjs — Settings › Backup and sync (21 Oct 2026, gap G28): the Git backup's readable commit
// messages, its schedule (only when due, only when something changed), its .gitignore, a note's history read back and a
// push to a folder remote, all with real git; and the encrypted sync folder: a round trip between two PCs, nothing
// readable in the folder, a wrong passphrase refused, the sealed manifest, a conflict kept as a copy, a deletion carried
// to the Recycle Bin, and a tampered file refused.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-backup-'));
let S, G, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const make = async (input, file) => {
    await build({ input: path.join(root, input), platform: 'node', output: { file: path.join(work, file), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, file)).href);
  };
  S = await make('src/shared/backup.ts', 'shared.mjs');
  G = await make('src/main/git-backup.ts', 'git.mjs');
  F = await make('src/main/sync-folder.ts', 'sync.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const write = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

test('commit messages say when, how much and which notes; private notes are counted, never named', () => {
  const at = new Date(2026, 9, 21, 15, 42).getTime();
  const changes = S.parseStatus([' M Projects/Trip to Hobart.md', '?? Daily/2026-10-21.md', ' D Old idea.md', 'R  Ideas/Garden.md', 'Garden.md', '?? Private notes/a1b2c3.nvlock', ''].join('\0'));
  assert.deepEqual(changes.map((c) => c.kind), ['changed', 'added', 'deleted', 'renamed', 'added']);
  assert.equal(changes[3].from, 'Garden.md');
  const message = S.commitMessage(changes, at, (p) => p.startsWith('Private notes/'));
  assert.equal(
    message,
    'Backup 21 Oct 2026, 3:42 pm: 5 files changed\n\nChanged: Trip to Hobart\nAdded: 2026-10-21\nDeleted: Old idea\nRenamed or moved: Garden → Garden\nPrivate notes: 1 file (still encrypted)\n',
  );
  assert.ok(!message.includes('a1b2c3'));
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: 'changed', path: `Note ${i + 1}.md` }));
  assert.match(S.commitMessage(many, at), /Changed: Note 1, Note 2, Note 3, Note 4, Note 5, Note 6 and 3 more/);
});

test('a backup runs only when switched on and the last one is old enough', () => {
  assert.equal(S.runDue({ on: false, minutes: 15, lastRun: 0, now: 1e9 }), false);
  assert.equal(S.runDue({ on: true, minutes: 15, lastRun: 0, now: 1e9 }), true);
  assert.equal(S.runDue({ on: true, minutes: 15, lastRun: 1e9, now: 1e9 + 14 * 60_000 }), false);
  assert.equal(S.runDue({ on: true, minutes: 15, lastRun: 1e9, now: 1e9 + 15 * 60_000 }), true);
  assert.equal(S.runDue({ on: true, minutes: 15, lastRun: 0, now: 1e9, busy: true }), false);
});

test('remotes: https, ssh or a folder; a token inside the address, or plain http, is refused', () => {
  const abs = (p) => p.startsWith('/') || /^[A-Za-z]:\\/.test(p);
  assert.deepEqual(S.remoteKind('https://github.com/me/notes.git', abs), { kind: 'https' });
  assert.deepEqual(S.remoteKind('git@github.com:me/notes.git', abs), { kind: 'ssh' });
  assert.deepEqual(S.remoteKind('/mnt/nas/notes.git', abs), { kind: 'folder' });
  assert.match(S.remoteKind('https://me:ghp_secret@github.com/me/notes.git', abs).problem, /Leave the user name and token out/);
  assert.match(S.remoteKind('http://example.com/notes.git', abs).problem, /https:\/\//);
  assert.match(S.remoteKind('notes', abs).problem, /https:\/\//);
  assert.equal(S.cleanBackupPrefs({ git: { on: true, minutes: 7, branch: 'bad branch' } }).git.minutes, 15, 'an odd interval falls back');
  assert.equal(S.cleanBackupPrefs({ git: { branch: 'bad branch' } }).git.branch, 'main');
});

test('the .gitignore keeps temporary files out and the person’s own lines in, written once', () => {
  const first = S.mergeGitignore(null);
  assert.match(first, /^\*\.nvtmp$/m);
  const mine = first + 'Drafts/\n';
  assert.equal(S.mergeGitignore(mine), mine, 'already right: unchanged');
  const theirs = S.mergeGitignore('build/\n');
  assert.ok(theirs.startsWith(S.GITIGNORE_LINES[0]) && theirs.endsWith('build/\n'));
});

test('Git backup: on schedule, readable commits, a note’s history read back, pushed to a folder remote', async () => {
  const vault = path.join(work, 'git-vault');
  write(path.join(vault, 'Plans.md'), '# Plans\n\nFirst draft.\n');
  write(path.join(vault, 'Projects', 'Trip to Hobart.md'), 'Book the ferry.\n');
  write(path.join(vault, 'Private notes', 'x9.nvlock'), 'sealed');
  let now = new Date(2026, 9, 21, 9, 0).getTime();
  const prefs = { on: true, minutes: 15, remote: '', branch: 'main', signIn: 'token', user: '' };
  let changes = 0;
  const backup = new G.GitBackup({ root: () => vault, prefs: () => prefs, token: async () => null, helperDir: path.join(work, 'helper'), isPrivate: (p) => p.startsWith('Private notes/'), now: () => now, changed: () => changes++ });
  const git = (...a) => execFileSync('git', a, { cwd: vault, encoding: 'utf8' });

  assert.equal(await backup.tick(), true, 'switched on and never run: due');
  assert.equal(git('log', '--format=%s').trim(), 'First backup of your notes, 21 Oct 2026, 9:00 am: 4 files');
  assert.equal(git('symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.ok(git('ls-files').includes('.gitignore') && git('ls-files').includes('Private notes/x9.nvlock'), 'the .gitignore and the still-encrypted private note are in');
  assert.ok(changes >= 2, 'Settings was told as it went');

  now += 5 * 60_000;
  write(path.join(vault, 'Plans.md'), '# Plans\n\nSecond draft.\n');
  assert.equal(await backup.tick(), false, 'five minutes on: not due yet');
  now += 11 * 60_000;
  write(path.join(vault, 'Scratch.nvtmp'), 'half-written');
  assert.equal(await backup.tick(), true);
  assert.equal(git('log', '-1', '--format=%B').trim(), 'Backup 21 Oct 2026, 9:16 am: 1 file changed\n\nChanged: Plans');
  assert.ok(!git('ls-files').includes('Scratch.nvtmp'), 'a temporary file stays out');

  now += 16 * 60_000;
  await backup.tick();
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2', 'nothing changed: no empty commit');
  assert.equal(backup.words, 'Nothing had changed.');

  const versions = await backup.history('Plans.md');
  assert.equal(versions.length, 2);
  assert.ok(versions.every((v) => v.from === 'git' && /^git:[0-9a-f]{40}:Plans\.md$/.test(v.id)));
  assert.equal(await backup.readAt(versions[1].id), '# Plans\n\nFirst draft.\n', 'the older version, as it was');
  await assert.rejects(() => backup.readAt('git:' + 'a'.repeat(40) + ':..%2Fsecret'), /isn’t in the Git backup/);

  // A folder remote (a NAS share or a USB drive): a bare repository made there, the history pushed.
  const remote = path.join(work, 'nas', 'notes.git');
  prefs.remote = remote;
  const done = await backup.backup();
  assert.equal(done.pushed, true);
  assert.equal(execFileSync('git', ['--git-dir', remote, 'log', '--format=%s', 'main'], { encoding: 'utf8' }).split('\n')[0], 'Backup 21 Oct 2026, 9:16 am: 1 file changed');
  assert.match(backup.words, /copied to notes\.git/);
  assert.ok(backup.lastPush > 0 && !backup.error);

  // A remote with changes from elsewhere is never overwritten.
  const other = path.join(work, 'other-clone');
  execFileSync('git', ['clone', '-q', remote, other]);
  write(path.join(other, 'Elsewhere.md'), 'x');
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=A', 'add', '-A'], { cwd: other });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=A', 'commit', '-qm', 'other'], { cwd: other });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other });
  write(path.join(vault, 'Plans.md'), '# Plans\n\nThird draft.\n');
  await assert.rejects(() => backup.backup(), /changes made somewhere else, so nothing there was overwritten/);
  assert.match(backup.error, /nothing there was overwritten/);
});

test('a token goes to git through GIT_ASKPASS, never the address or the command line', async () => {
  const helper = await G.writeAskPass(path.join(work, 'askpass'), 'linux');
  const env = { ...process.env, NV_GIT_USER: 'jesse', NV_GIT_SECRET: 'tok-123' };
  assert.equal(execFileSync(helper, ["Username for 'https://example.com': "], { env, encoding: 'utf8' }), 'jesse\n');
  assert.equal(execFileSync(helper, ["Password for 'https://jesse@example.com': "], { env, encoding: 'utf8' }), 'tok-123\n');
  assert.ok(!readFileSync(helper, 'utf8').includes('tok-123'), 'the script holds no token');
  assert.match(G.pushProblem('remote: Invalid username or password.\nfatal: Authentication failed', 'https'), /refused the sign-in/);
  assert.match(G.pushProblem('fatal: unable to access: Could not resolve host: github.com', 'https'), /couldn’t be reached/);
  assert.equal(G.remoteName('https://github.com/me/notes.git'), 'github.com');
  assert.equal(G.remoteName('git@gitea.example.com:me/notes.git'), 'gitea.example.com');
});

// ---- the encrypted sync folder
const FAST = { N: 1024, r: 8, p: 1 };
function pc(name, vault, folder, pass, trashed = []) {
  let passphrase = pass;
  const prefs = { on: true, minutes: 15, folder };
  const s = new F.SyncFolder({
    root: () => vault,
    prefs: () => prefs,
    passphrase: async () => passphrase,
    stateDir: () => path.join(work, 'state', name),
    device: { id: name, name },
    trash: async (abs) => {
      trashed.push(abs);
      rmSync(abs);
    },
    scrypt: FAST,
  });
  s.setPass = (p) => (passphrase = p);
  s.trashed = trashed;
  return s;
}

test('sealing: a round trip, and a wrong key or a moved file is refused', () => {
  const key = Buffer.alloc(32, 7);
  const sealed = F.seal(key, Buffer.from('Iron is low'), 'id-1');
  assert.equal(F.open(key, sealed, 'id-1').toString(), 'Iron is low');
  assert.throws(() => F.open(Buffer.alloc(32, 8), sealed, 'id-1'));
  assert.throws(() => F.open(key, sealed, 'id-2'), undefined, 'a sealed file put under another name is refused');
  assert.notDeepEqual(F.seal(key, Buffer.from('same'), 'a'), F.seal(key, Buffer.from('same'), 'a'), 'a fresh nonce every time');
});

test('encrypted sync: two PCs, nothing readable in the folder, a wrong passphrase refused', async () => {
  const folder = path.join(work, 'onedrive');
  mkdirSync(folder, { recursive: true });
  const a = path.join(work, 'sync-a');
  const b = path.join(work, 'sync-b');
  write(path.join(a, 'Health', 'Blood tests.md'), 'Iron is low. Ask Dr Patel.\n');
  write(path.join(a, 'Plans.md'), 'Trip to Hobart\n');
  write(path.join(a, '.neuralvault', 'types.json'), '{"types":[]}');
  write(path.join(a, '.git', 'HEAD'), 'ref: refs/heads/main');
  write(path.join(a, 'Draft.nvtmp'), 'half');
  mkdirSync(b, { recursive: true });

  const A = pc('LAPTOP', a, folder, 'correct horse battery');
  await assert.rejects(() => A.prepare(folder, 'short'), /at least 10 characters/);
  assert.deepEqual(await A.prepare(folder, 'correct horse battery'), { joined: false });
  const first = await A.sync();
  assert.equal(first.sent, 3, 'notes and .neuralvault go; .git and temporary files stay');
  assert.match(A.words, /^Synced: 3 sent\.$/);

  // In the folder: a key file with no key, a sealed list, sealed files under keyed names.
  const files = walk(path.join(folder, F.SYNC_DIR));
  const everything = files.map((f) => path.basename(f) + '\n' + readFileSync(f, 'latin1')).join('\n');
  for (const word of ['Iron', 'Patel', 'Blood tests', 'Health', 'Plans', 'Hobart', 'types', 'correct horse']) assert.ok(!everything.includes(word), `“${word}” isn’t readable in the sync folder`);
  assert.equal(files.filter((f) => f.endsWith('.nvblob')).length, 3);
  assert.ok(files.every((f) => /(key|manifest)\.nvsync$|[0-9a-f]{64}\.nvblob$/.test(path.basename(f))), 'only keyed hashes for names');
  const keyFile = JSON.parse(readFileSync(path.join(folder, F.SYNC_DIR, 'key.nvsync'), 'utf8'));
  assert.deepEqual(Object.keys(keyFile).sort(), ['N', 'check', 'kind', 'p', 'r', 'salt', 'vault', 'version']);

  const B = pc('DESKTOP', b, folder, 'wrong passphrase!!');
  await assert.rejects(() => B.prepare(folder, 'wrong passphrase!!'), F.WrongPassphrase);
  await assert.rejects(() => B.sync(), /doesn’t open this sync folder/);
  assert.match(B.error, /doesn’t open this sync folder/);
  B.setPass('correct horse battery');
  assert.deepEqual(await B.prepare(folder, 'correct horse battery'), { joined: true });
  const got = await B.sync();
  assert.equal(got.received, 3);
  assert.equal(readFileSync(path.join(b, 'Health', 'Blood tests.md'), 'utf8'), 'Iron is low. Ask Dr Patel.\n');
  assert.equal(readFileSync(path.join(b, '.neuralvault', 'types.json'), 'utf8'), '{"types":[]}');
  assert.equal((await B.sync()).received, 0, 'nothing new: nothing moves');
  assert.equal(B.words, 'Everything was already the same.');

  // Changed on one side: carried to the other.
  write(path.join(b, 'Plans.md'), 'Trip to Hobart\nFerry booked.\n');
  await B.sync();
  assert.equal((await A.sync()).received, 1);
  assert.equal(readFileSync(path.join(a, 'Plans.md'), 'utf8'), 'Trip to Hobart\nFerry booked.\n');

  // Changed on both: this PC's stays, the other's is kept beside it, and both PCs end with both.
  write(path.join(a, 'Plans.md'), 'Laptop words\n');
  write(path.join(b, 'Plans.md'), 'Desktop words\n');
  await A.sync();
  const clash = await B.sync();
  assert.equal(clash.conflicts.length, 1);
  const copy = clash.conflicts[0];
  assert.match(copy, /^Plans \(conflict, \d+ \w{3} \d{4} \d+\.\d\d [ap]m, from LAPTOP\)\.md$/);
  assert.equal(readFileSync(path.join(b, 'Plans.md'), 'utf8'), 'Desktop words\n');
  assert.equal(readFileSync(path.join(b, copy), 'utf8'), 'Laptop words\n');
  await A.sync();
  assert.equal(readFileSync(path.join(a, 'Plans.md'), 'utf8'), 'Desktop words\n', 'the other PC then takes the kept version');
  assert.equal(readFileSync(path.join(a, copy), 'utf8'), 'Laptop words\n', 'and the conflict copy');
  assert.equal(B.conflicts, 1);

  // Deleted on one side: to the other's Recycle Bin, never straight off the disk.
  rmSync(path.join(a, copy));
  await A.sync();
  await B.sync();
  assert.ok(!existsSync(path.join(b, copy)));
  assert.deepEqual(B.trashed, [path.join(b, copy)]);

  // A sealed file changed in the folder is refused, never written into the notes.
  const blobsBefore = new Set(walk(path.join(folder, F.SYNC_DIR, 'files')));
  write(path.join(a, 'Plans.md'), 'Tampered next\n');
  await A.sync();
  const fresh = walk(path.join(folder, F.SYNC_DIR, 'files')).filter((f) => !blobsBefore.has(f));
  assert.equal(fresh.length, 1, 'one new sealed file for the changed note');
  const bytes = readFileSync(fresh[0]);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(fresh[0], bytes);
  await assert.rejects(() => B.sync());
  assert.equal(readFileSync(path.join(b, 'Plans.md'), 'utf8'), 'Desktop words\n');
});

test('conflict copies are named beside the note, safe for Windows', () => {
  const at = new Date(2026, 9, 21, 15, 42).getTime();
  assert.equal(F.conflictName('Projects/Plans.md', at, 'JESSE:PC'), 'Projects/Plans (conflict, 21 Oct 2026 3.42 pm, from JESSE PC).md');
  assert.equal(F.conflictName('README', at, ''), 'README (conflict, 21 Oct 2026 3.42 pm, from another PC)');
});
