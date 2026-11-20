// Backup and sync (21 Oct 2026, gap G28): the parts both sides share — the settings as kept, what a Git backup's
// commit says, when the next run is due, the .gitignore Ironleaf writes, a remote's address checked, and the words
// Settings › Backup and sync shows. The work itself is src/main/git-backup.ts (a Git history of the notes, pushed to a
// remote the person chooses) and src/main/sync-folder.ts (an end-to-end encrypted copy in a folder they pick).

/** How often a backup or sync may run, in minutes (when something changed). */
export const BACKUP_MINUTES = [5, 15, 30, 60, 240] as const;

export interface GitBackupPrefs {
  on: boolean;
  minutes: number;
  /** Where the history is copied to: an https:// or ssh address, or a folder (a NAS, a USB drive). Empty: this PC only. */
  remote: string;
  /** The branch pushed to. */
  branch: string;
  /** How a remote over https signs in: The former host app's Git sign-in (inside the former host app), or a user name and token
typed here. */
  signIn: 'neuralspark' | 'token';
  /** The user name that goes with the token (the token itself is kept encrypted by Windows, never here). */
  user: string;
}

export interface SyncFolderPrefs {
  on: boolean;
  minutes: number;
  /** The folder the encrypted copy goes in (its "Ironleaf sync" folder is made inside it). */
  folder: string;
}

export interface BackupPrefs {
  git: GitBackupPrefs;
  sync: SyncFolderPrefs;
}

export const DEFAULT_BACKUP: BackupPrefs = {
  git: { on: false, minutes: 15, remote: '', branch: 'main', signIn: 'token', user: '' },
  sync: { on: false, minutes: 15, folder: '' },
};

const minutesOf = (v: unknown, fallback: number) => (BACKUP_MINUTES as readonly number[]).includes(Number(v)) ? Number(v) : fallback;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : '');

/** The settings as kept, from whatever was saved (anything odd falls back to its default). */
export function cleanBackupPrefs(raw: unknown): BackupPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const g = (r.git && typeof r.git === 'object' ? r.git : {}) as Record<string, unknown>;
  const s = (r.sync && typeof r.sync === 'object' ? r.sync : {}) as Record<string, unknown>;
  const branch = text(g.branch, 100);
  return {
    git: {
      on: g.on === true,
      minutes: minutesOf(g.minutes, DEFAULT_BACKUP.git.minutes),
      remote: text(g.remote, 1000),
      branch: branch && branchProblem(branch) === null ? branch : 'main',
      signIn: g.signIn === 'neuralspark' ? 'neuralspark' : 'token',
      user: text(g.user, 200),
    },
    sync: { on: s.on === true, minutes: minutesOf(s.minutes, DEFAULT_BACKUP.sync.minutes), folder: text(s.folder, 1000) },
  };
}

/** A branch name git accepts (a plain one: no spaces, no "..", nothing git treats as special). */
export function branchProblem(name: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock') || name.includes('//')) return 'Use a plain branch name, like main.';
  return null;
}

export type RemoteKind = 'https' | 'ssh' | 'folder';

/**
 * What a remote's address is, or why it can't be used. A password or token is never accepted inside the address (it
 * would sit in the notes' .git folder in plain text): it's typed into its own box and kept encrypted.
 */
export function remoteKind(address: string, isAbsolute: (p: string) => boolean): { kind: RemoteKind } | { problem: string } {
  const a = address.trim();
  if (!a) return { problem: 'Type the address of a repository, or choose a folder.' };
  if (/^https?:\/\//i.test(a)) {
    let url: URL;
    try {
      url = new URL(a);
    } catch {
      return { problem: 'That address can’t be read. Copy it from your Git host’s Clone button (HTTPS).' };
    }
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) return { problem: 'Use the https:// address, so the notes travel encrypted.' };
    if (url.username || url.password) return { problem: 'Leave the user name and token out of the address: put them in the boxes below, where the token is kept encrypted.' };
    return { kind: 'https' };
  }
  if (/^ssh:\/\/[^\s]+$/i.test(a) || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(a)) return { kind: 'ssh' };
  if (isAbsolute(a)) return { kind: 'folder' };
  return { problem: 'Type an https:// address (or an ssh one), or choose a folder.' };
}

/** One line of `git status --porcelain=v1 -z`, read. */
export interface GitChange {
  kind: 'added' | 'changed' | 'deleted' | 'renamed';
  path: string;
  from?: string;
}

/** `git status --porcelain=v1 -z --untracked-files=all` read into changes (a rename's old path follows it in -z). */
export function parseStatus(out: string): GitChange[] {
  const parts = out.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const file = entry.slice(3);
    if (x === 'R' || x === 'C') {
      const from = parts[++i] ?? '';
      changes.push({ kind: 'renamed', path: file, from });
    } else if (x === '?' || x === 'A') changes.push({ kind: 'added', path: file });
    else if (x === 'D' || y === 'D') changes.push({ kind: 'deleted', path: file });
    else changes.push({ kind: 'changed', path: file });
  }
  return changes;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
/** "21 Oct 2026, 3:42 pm", as the rest of Ironleaf says a time. */
export function whenWords(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** A note's name as people say it: its file name without the folder and without .md. */
const nameOf = (p: string) => {
  const file = p.split('/').pop() ?? p;
  return /\.md$/i.test(file) ? file.slice(0, -3) : file;
};

/**
 * A backup's commit message, readable in any Git host's history: a first line with when and how much changed, then a
 * line per kind naming the notes (a few, then "and N more"). Private notes are counted, never named (their files'
 * names are random anyway, and saying "Private notes" is enough).
 */
export function commitMessage(changes: GitChange[], at: number, isPrivate: (p: string) => boolean = () => false): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const files = changes.filter((c) => !isPrivate(c.path));
  const secret = changes.length - files.length;
  const head = changes.length ? `Backup ${whenWords(at)}: ${count(changes.length, 'file', 'files')} changed` : `Backup ${whenWords(at)}`;
  const named = (list: GitChange[]) => {
    const names = list.map((c) => (c.kind === 'renamed' && c.from ? `${nameOf(c.from)} → ${nameOf(c.path)}` : nameOf(c.path)));
    const shown = names.slice(0, 6).join(', ');
    return names.length > 6 ? `${shown} and ${names.length - 6} more` : shown;
  };
  const lines: string[] = [];
  const kinds: [GitChange['kind'], string][] = [['changed', 'Changed'], ['added', 'Added'], ['deleted', 'Deleted'], ['renamed', 'Renamed or moved']];
  for (const [kind, label] of kinds) {
    const list = files.filter((c) => c.kind === kind);
    if (list.length) lines.push(`${label}: ${named(list)}`);
  }
  if (secret) lines.push(`Private notes: ${count(secret, 'file', 'files')} (still encrypted)`);
  return lines.length ? `${head}\n\n${lines.join('\n')}\n` : `${head}\n`;
}

/** Whether a scheduled run is due: switched on, something may have changed, and the last run is old enough. */
export function runDue(o: { on: boolean; minutes: number; lastRun: number; now: number; busy?: boolean }): boolean {
  if (!o.on || o.busy) return false;
  return o.now - o.lastRun >= o.minutes * 60_000;
}

/** What Ironleaf keeps out of the Git history: temporary files (a Private note's half-written file among them),
 *  lock files Office leaves, and the files Windows and macOS drop in folders. Private notes themselves go in, still
 *  encrypted. */
export const GITIGNORE_LINES = [
  '# Written by Ironleaf (Settings › Backup and sync). Lines you add below the end marker stay as they are.',
  '*.nvtmp',
  '*.tmp',
  '~$*',
  '.~lock.*',
  'Thumbs.db',
  'desktop.ini',
  '.DS_Store',
  '.Trash/',
  '.trash/',
  'node_modules/',
  '# End of Ironleaf’s lines',
];

/** The vault's .gitignore with Ironleaf's lines at the top (put right when changed), the person's own kept below. */
export function mergeGitignore(existing: string | null): string {
  const block = GITIGNORE_LINES.join('\n');
  if (!existing) return block + '\n';
  const start = existing.indexOf(GITIGNORE_LINES[0]);
  const endLine = GITIGNORE_LINES[GITIGNORE_LINES.length - 1];
  const end = existing.indexOf(endLine);
  if (start >= 0 && end > start) {
    const rest = (existing.slice(0, start) + existing.slice(end + endLine.length)).replace(/^\s*\n/, '');
    return block + '\n' + (rest.trim() ? rest.replace(/^\n+/, '') : '');
  }
  return block + '\n' + existing;
}

/** How a backup or sync stands, for Settings. */
export interface BackupRunState {
  /** When it last finished without a problem. */
  lastOk: number;
  /** What it last did, in words ("Nothing had changed.", "3 files changed: copied to github.com"). */
  words: string;
  /** The last problem, in plain words, or empty. */
  error: string;
  busy: boolean;
}

export interface GitBackupView extends BackupRunState {
  prefs: GitBackupPrefs;
  /** Whether git can run here, and where it comes from. */
  git: 'host' | 'system' | 'missing';
  /** A token is saved for this vault. */
  tokenSaved: boolean;
  /** The former host app's Git sign-in can be used (inside the former host app). */
  hostSignIn: boolean;
  lastPush: number;
  commits: number;
}

export interface SyncFolderView extends BackupRunState {
  prefs: SyncFolderPrefs;
  /** A passphrase is saved on this PC for this vault. */
  passphraseSaved: boolean;
  /** The folder already holds an Ironleaf sync copy (made on this PC or another). */
  existing: boolean;
  files: number;
  conflicts: number;
}

export interface BackupView {
  git: GitBackupView;
  sync: SyncFolderView;
}

/** What each one protects, in Settings' own words (one place, so the screen and its tests agree). */
export const PROTECTS = {
  git:
    'Keeps every saved version of your notes in a Git history inside the notes folder, and copies it to the remote you choose. Good for undoing mistakes and for a second copy. It is not encrypted: anyone who can open the remote can read your notes (Private notes stay encrypted). Use a private repository.',
  sync:
    'Copies your notes to a folder you pick (OneDrive, Dropbox, a NAS or a USB drive), encrypted on this PC first with your passphrase, so whoever holds that folder sees only scrambled files with scrambled names. They can still see roughly how many files there are and how big. Another PC with the same passphrase syncs both ways. If you forget the passphrase, nobody can open the copy, not even us.',
} as const;
