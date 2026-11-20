// Back up with Git (21 Oct 2026, gap G28; Settings › Backup and sync). The notes folder becomes a Git repository (or the
// one it already is is used as it is): every N minutes, when something changed, Ironleaf commits it with a message a
// person can read ("Backup 21 Oct 2026, 3:42 pm: 3 files changed" and the notes' names), and pushes it to the remote the
// person chose — an https:// repository (signing in with the former host app's Git accounts inside the former host app,
// or a user name and a token kept encrypted by Windows), an ssh address (their own keys), or a folder on a NAS or USB
// drive. Nothing is ever forced: a remote with changes from elsewhere is left alone and the person is told. A note's
// history comes back in Earlier versions (history(), readAt()).
//
// git itself: The former host app's (the host's git(): its bundled Git and its sign-in broker), else git on this PC's
// PATH. A token never goes into an address, a command line, the .git folder or a log: git asks for it through
// GIT_ASKPASS, a small script Ironleaf writes that prints it from git's own environment.

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { commitMessage, mergeGitignore, parseStatus, remoteKind, runDue, whenWords, type GitBackupPrefs, type GitChange } from '../shared/backup';

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** The former host app's git (inside the former host app): its executable and the environment its sign-in
broker needs. */
export interface HostGit {
  exe: string;
  env: Record<string, string>;
}

export interface GitBackupDeps {
  /** The open notes folder, or null. */
  root(): string | null;
  prefs(): GitBackupPrefs;
  /** Inside the former host app: its git (null: not available now). */
  hostGit?(): Promise<HostGit | null>;
  /** The token saved for this vault (https remotes signing in with a token). */
  token(): Promise<string | null>;
  /** Where Ironleaf may write its GIT_ASKPASS script (its own data folder, never the notes). */
  helperDir: string;
  /** Private notes' paths are counted in a message, never named. */
  isPrivate?(rel: string): boolean;
  /** How the state changed (Settings shows it as it goes). */
  changed?(): void;
  now?(): number;
  /** git on PATH (tests may name another). */
  systemGit?: string;
  platform?: NodeJS.Platform;
}

export interface GitVersion {
  id: string;
  time: number;
  size: number;
  from: 'git';
  message: string;
}

const REMOTE = 'neuralvault-backup';
const BIG = 50 * 1024 * 1024;
// Kept in the old name on purpose: the markers are found again in .git/info/exclude files earlier versions wrote.
const EXCLUDE_START = '# NeuralVault: files too large for a Git backup (over 50 MB)';
const EXCLUDE_END = '# End of NeuralVault’s large files';
const SHA = /^[0-9a-f]{40}$/;

/** A problem said plainly, without git's own words when they'd only confuse. */
export class GitProblem extends Error {}

export class GitBackup {
  lastOk = 0;
  lastRun = 0;
  lastPush = 0;
  words = '';
  error = '';
  busy = false;
  commits = 0;
  source: 'host' | 'system' | 'missing' | 'unknown' = 'unknown';
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: GitBackupDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  /** Checks once a minute whether a backup is due. */
  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Another folder of notes opened: its own history and times. */
  reset(): void {
    this.lastOk = this.lastRun = this.lastPush = this.commits = 0;
    this.words = this.error = '';
    this.source = 'unknown';
  }

  /** A scheduled run when one is due (switched on, the last run old enough); true when it ran. */
  async tick(): Promise<boolean> {
    const p = this.d.prefs();
    if (!this.d.root() || !runDue({ on: p.on, minutes: p.minutes, lastRun: this.lastRun, now: this.now(), busy: this.busy })) return false;
    await this.backup().catch(() => {});
    return true;
  }

  /** git to run with, and the environment it needs. */
  private async gitNow(): Promise<{ exe: string; env: Record<string, string>; host: boolean }> {
    const host = await this.d.hostGit?.().catch(() => null);
    if (host?.exe) {
      this.source = 'host';
      return { exe: host.exe, env: host.env, host: true };
    }
    const exe = this.d.systemGit ?? 'git';
    const probe = await runProcess(exe, ['--version'], { cwd: process.cwd(), env: {}, timeoutMs: 15_000 }).catch(() => null);
    if (!probe || probe.code !== 0) {
      this.source = 'missing';
      throw new GitProblem('Git isn’t on this PC. Install Git for Windows and try again.');
    }
    this.source = 'system';
    return { exe, env: {}, host: false };
  }

  /** Whether git can run here (for Settings), without changing anything. */
  async available(): Promise<'host' | 'system' | 'missing'> {
    try {
      const g = await this.gitNow();
      return g.host ? 'host' : 'system';
    } catch {
      return 'missing';
    }
  }

  /** git in the notes folder; a failure is thrown in plain words unless `ok: false`. */
  async git(args: string[], o: { env?: Record<string, string>; timeoutMs?: number; ok?: boolean; input?: string } = {}): Promise<GitRun> {
    const root = this.d.root();
    if (!root) throw new GitProblem('Open your notes first.');
    const g = await this.gitNow();
    const run = await runProcess(g.exe, ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], {
      cwd: root,
      env: { ...g.env, GIT_TERMINAL_PROMPT: '0', ...o.env },
      timeoutMs: o.timeoutMs ?? 120_000,
      input: o.input,
    });
    if (o.ok !== false && run.code !== 0) throw new GitProblem(plainGitError(run.stderr || run.stdout));
    return run;
  }

  /** The notes folder as a repository of its own, with Ironleaf's .gitignore lines. */
  private async ensureRepo(): Promise<void> {
    const root = this.d.root()!;
    const own = await fsp.stat(path.join(root, '.git')).catch(() => null);
    if (!own) {
      const branch = this.d.prefs().branch || 'main';
      await this.git(['init', '-q']);
      // An unborn branch takes the chosen name (older gits have no init -b).
      await this.git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    }
    const file = path.join(root, '.gitignore');
    const before = await fsp.readFile(file, 'utf8').catch(() => null);
    const next = mergeGitignore(before);
    if (next !== before) await fsp.writeFile(file, next, 'utf8');
  }

  /** Who a commit is by: the repository's own settings when it has them, else "Ironleaf backup". */
  private async identity(): Promise<string[]> {
    const email = await this.git(['config', '--get', 'user.email'], { ok: false });
    const name = await this.git(['config', '--get', 'user.name'], { ok: false });
    return [...(email.stdout.trim() ? [] : ['-c', 'user.email=backup@neuralvault.invalid']), ...(name.stdout.trim() ? [] : ['-c', 'user.name=Ironleaf backup'])];
  }

  /** Files over 50 MB are left out (Git hosts refuse them), listed in .git/info/exclude so the person can see which. */
  private async leaveOutBig(changes: GitChange[]): Promise<number> {
    const root = this.d.root()!;
    const big: string[] = [];
    for (const c of changes) {
      if (c.kind === 'deleted') continue;
      const info = await fsp.stat(path.join(root, c.path)).catch(() => null);
      if (info?.isFile() && info.size > BIG) big.push(c.path);
    }
    if (!big.length) return 0;
    const file = path.join(root, '.git', 'info', 'exclude');
    const text = await fsp.readFile(file, 'utf8').catch(() => '');
    const start = text.indexOf(EXCLUDE_START);
    const end = text.indexOf(EXCLUDE_END);
    const kept = start >= 0 && end > start ? text.slice(start + EXCLUDE_START.length, end).split('\n').map((l) => l.trim()).filter(Boolean) : [];
    const rest = start >= 0 && end > start ? text.slice(0, start) + text.slice(end + EXCLUDE_END.length) : text;
    const lines = [...new Set([...kept, ...big.map((p) => '/' + p.replace(/([*?[\]!#\\])/g, '\\$1'))])];
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${rest.trimEnd()}\n${EXCLUDE_START}\n${lines.join('\n')}\n${EXCLUDE_END}\n`.replace(/^\n/, ''), 'utf8');
    return big.length;
  }

  private async changes(): Promise<GitChange[]> {
    const out = await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { env: { GIT_OPTIONAL_LOCKS: '0' } });
    return parseStatus(out.stdout);
  }

  /** Commits what changed (if anything) and pushes when a remote is set: "Back up now", and each scheduled run. */
  backup(): Promise<{ committed: boolean; pushed: boolean; words: string }> {
    const run = this.queue.then(() => this.backupNow());
    this.queue = run.catch(() => {});
    return run;
  }

  private async backupNow(): Promise<{ committed: boolean; pushed: boolean; words: string }> {
    this.busy = true;
    this.lastRun = this.now();
    this.d.changed?.();
    try {
      await this.ensureRepo();
      let changes = await this.changes();
      const big = await this.leaveOutBig(changes);
      if (big) changes = await this.changes();
      let committed = false;
      if (changes.length) {
        const first = (await this.git(['rev-parse', '--verify', '-q', 'HEAD'], { ok: false })).code !== 0;
        await this.git(['add', '-A']);
        const message = first ? `First backup of your notes, ${whenWords(this.now())}: ${changes.length} ${changes.length === 1 ? 'file' : 'files'}\n` : commitMessage(changes, this.now(), this.d.isPrivate);
        // The message goes in on git's input, so nothing in it is ever read as an option.
        await this.git([...(await this.identity()), 'commit', '-q', '--no-verify', '-F', '-'], { timeoutMs: 300_000, input: message });
        committed = true;
      }
      this.commits = Number((await this.git(['rev-list', '--count', 'HEAD'], { ok: false })).stdout.trim()) || 0;
      const pushed = this.d.prefs().remote ? await this.pushNow() : false;
      const what = changes.length ? `${changes.length} ${changes.length === 1 ? 'file' : 'files'} backed up` : 'Nothing had changed';
      const where = pushed ? ` and copied to ${remoteName(this.d.prefs().remote)}` : '';
      this.words = `${what}${where}.${big ? ` ${big} ${big === 1 ? 'file over 50 MB was' : 'files over 50 MB were'} left out.` : ''}`;
      this.error = '';
      this.lastOk = this.now();
      return { committed, pushed, words: this.words };
    } catch (err) {
      this.error = err instanceof GitProblem ? err.message : `The backup didn’t finish: ${err instanceof Error ? err.message : String(err)}`;
      throw err instanceof GitProblem ? err : new GitProblem(this.error);
    } finally {
      this.busy = false;
      this.d.changed?.();
    }
  }

  /** Pushes to the remote (made or put right first), signing in the way the person chose. */
  private async pushNow(): Promise<boolean> {
    const p = this.d.prefs();
    const kind = remoteKind(p.remote, path.isAbsolute);
    if ('problem' in kind) throw new GitProblem(kind.problem);
    if (kind.kind === 'folder') await prepareFolderRemote(p.remote, p.branch || 'main', this);
    const has = await this.git(['remote', 'get-url', REMOTE], { ok: false });
    if (has.code !== 0) await this.git(['remote', 'add', REMOTE, p.remote]);
    else if (has.stdout.trim() !== p.remote) await this.git(['remote', 'set-url', REMOTE, p.remote]);
    const head = await this.git(['rev-parse', '--verify', '-q', 'HEAD'], { ok: false });
    if (head.code !== 0) return false;
    const sign = await this.signIn(kind.kind);
    const run = await this.git([...sign.config, 'push', '--porcelain', REMOTE, `HEAD:refs/heads/${p.branch || 'main'}`], { env: sign.env, timeoutMs: 600_000, ok: false });
    if (run.code !== 0) throw new GitProblem(pushProblem(run.stderr + run.stdout, kind.kind));
    this.lastPush = this.now();
    return true;
  }

  /** How git signs in for this push. */
  private async signIn(kind: 'https' | 'ssh' | 'folder'): Promise<{ config: string[]; env: Record<string, string> }> {
    if (kind === 'ssh') return { config: ['-c', 'core.sshCommand=ssh -o BatchMode=yes'], env: {} };
    if (kind === 'folder') return { config: [], env: {} };
    const p = this.d.prefs();
    if (p.signIn === 'neuralspark') {
      if (this.source !== 'host') throw new GitProblem('That sign-in isn’t available. Choose “A token” instead.');
      return { config: [], env: {} };
    }
    const token = await this.d.token();
    if (!token) throw new GitProblem('Add a token for this remote first (Settings › Backup and sync).');
    const helper = await writeAskPass(this.d.helperDir, this.d.platform ?? process.platform);
    // The empty helper clears every other credential helper for this push, so no sign-in window pops up.
    return { config: ['-c', 'credential.helper='], env: { GIT_ASKPASS: helper, NV_GIT_USER: p.user || 'git', NV_GIT_SECRET: token } };
  }

  /** A note's versions in the Git history (newest first), following it through renames. */
  async history(rel: string, limit = 60): Promise<GitVersion[]> {
    const root = this.d.root();
    if (!root || !(await fsp.stat(path.join(root, '.git')).catch(() => null))) return [];
    const run = await this.git(['log', '--follow', `-n${Math.max(1, Math.min(200, limit))}`, '--format=%x1e%H%x1f%ct%x1f%s', '--name-only', '--', rel], { ok: false });
    if (run.code !== 0) return [];
    const out: GitVersion[] = [];
    for (const record of run.stdout.split('\x1e')) {
      const [head, ...names] = record.split('\n');
      const [sha, ct, subject] = (head ?? '').split('\x1f');
      const at = names.map((n) => n.trim()).filter(Boolean)[0];
      if (!sha || !SHA.test(sha) || !at) continue;
      out.push({ id: `git:${sha}:${encodeURIComponent(at)}`, time: Number(ct) * 1000, size: 0, from: 'git', message: subject ?? '' });
    }
    return out;
  }

  /** A note's words at one version from history(). */
  async readAt(id: string): Promise<string> {
    const m = /^git:([0-9a-f]{40}):(.+)$/.exec(id);
    if (!m) throw new GitProblem('That version isn’t in the Git backup.');
    const rel = decodeURIComponent(m[2]);
    if (rel.split('/').some((s) => s === '..' || s === '') || rel.includes(':')) throw new GitProblem('That version isn’t in the Git backup.');
    const run = await this.git(['show', `${m[1]}:${rel}`]);
    return run.stdout;
  }
}

/** The remote's name for a sentence: its host, or the folder's name. */
export function remoteName(address: string): string {
  try {
    if (/^https?:\/\//i.test(address)) return new URL(address).host;
  } catch {
    /* fall through */
  }
  const ssh = /^[^@\s]+@([^:\s]+):/.exec(address) ?? /^ssh:\/\/(?:[^@/\s]+@)?([^/:\s]+)/i.exec(address);
  if (ssh) return ssh[1];
  return path.basename(address.replace(/[\\/]+$/, '')) || address;
}

/** A folder remote (a NAS share, a USB drive): a bare repository made there the first time. */
async function prepareFolderRemote(folder: string, branch: string, backup: GitBackup): Promise<void> {
  const head = await fsp.stat(path.join(folder, 'HEAD')).catch(() => null);
  if (head) return;
  const entries = await fsp.readdir(folder).catch(() => null);
  if (entries && entries.length) throw new GitProblem('That folder already has other files in it. Choose an empty folder for the Git backup.');
  await fsp.mkdir(folder, { recursive: true });
  await backup.git(['init', '-q', '--bare', folder]);
  // A clone of it (on another PC, to bring the notes back) checks out the backup's branch.
  await backup.git(['--git-dir', folder, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
}

/** git's complaint about a push, in plain words. */
export function pushProblem(said: string, kind: 'https' | 'ssh' | 'folder'): string {
  const s = said.toLowerCase();
  if (/non-fast-forward|fetch first|\[rejected\]|updates were rejected/.test(s)) return 'The remote has changes made somewhere else, so nothing there was overwritten. Use an empty repository for this vault’s backup, or one only this vault pushes to.';
  if (/authentication failed|invalid username or password|403|401|could not read username|permission denied \(publickey\)|access denied/.test(s))
    return kind === 'ssh' ? 'The remote refused this PC’s SSH key. Add the key to your Git host, or use the https:// address with a token.' : 'The remote refused the sign-in. Check the user name and token (it needs permission to write to the repository).';
  if (/repository not found|not found|does not appear to be a git repository/.test(s)) return 'The remote repository wasn’t found. Check the address, and that the repository exists (make an empty private one first).';
  if (/could not resolve host|failed to connect|timed out|network is unreachable|connection refused/.test(s)) return 'The remote couldn’t be reached. The backup is kept on this PC and copied there next time.';
  if (/large files|file size limit|exceeds/.test(s)) return 'The remote refused a file that’s too large. The backup is kept on this PC.';
  return `The copy to the remote didn’t finish: ${firstLine(said) || 'git gave no reason'}.`;
}

function plainGitError(said: string): string {
  const line = firstLine(said);
  if (/not a git repository/i.test(said)) return 'The notes folder isn’t a Git repository yet. Switch the backup on again.';
  if (/index\.lock/i.test(said)) return 'Another program is using the notes’ Git history right now. Ironleaf tries again next time.';
  if (/dubious ownership/i.test(said)) return 'Git doesn’t trust the notes folder (it belongs to another Windows user). Ironleaf can’t back it up from here.';
  return line ? `Git said: ${line}` : 'Git stopped without saying why.';
}

const firstLine = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.replace(/^(fatal|error|remote|hint):\s*/i, '').trim())
    .filter(Boolean)[0]
    ?.slice(0, 240) ?? '';

/** The GIT_ASKPASS helper: prints the user name or the token from git's environment, whichever git asks for. */
export async function writeAskPass(dir: string, platform: NodeJS.Platform): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  if (platform === 'win32') {
    const file = path.join(dir, 'neuralvault-askpass.cmd');
    const text = '@echo off\r\necho %~1| findstr /b /i "Username" >nul && (echo %NV_GIT_USER%) || (echo %NV_GIT_SECRET%)\r\n';
    await fsp.writeFile(file, text, 'utf8');
    return file;
  }
  const file = path.join(dir, 'neuralvault-askpass.sh');
  await fsp.writeFile(file, '#!/bin/sh\ncase "$1" in\n  Username*) printf "%s\\n" "$NV_GIT_USER" ;;\n  *) printf "%s\\n" "$NV_GIT_SECRET" ;;\nesac\n', { encoding: 'utf8', mode: 0o700 });
  await fsp.chmod(file, 0o700);
  return file;
}

/** Runs a program and gathers what it says (the commit message goes in on its input). */
export function runProcess(exe: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number; input?: string }): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    // A repository named by the surroundings (GIT_DIR and the like, from a shell Ironleaf was started in) is never
    // used: git works on the notes folder it's started in.
    const inherited = { ...process.env };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) delete inherited[k];
    const child = spawn(exe, args, { cwd: o.cwd, env: { ...inherited, ...o.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      reject(new GitProblem('Git took too long and was stopped. Ironleaf tries again next time.'));
    }, o.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr = (stderr + c).slice(-20000)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(o.input ?? '');
  });
}
