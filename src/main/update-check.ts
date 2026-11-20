// Ironleaf's own updates (20 Nov 2026, standalone): one small file read from Ironleaf's website,
// https://ironleaf.kaitiaki-it.com/download/latest.json (written by tools/release.mjs), a little after the start
// (when that site can't be reached or has no latest.json, the site from before the rename, LEGACY_UPDATE_ORIGIN, is
// read instead: copies installed before the rename read only that one, and it keeps being served)
// and then once a day. It never blocks the start, sends nothing about this PC or its notes (a plain GET, no
// identifiers, no query), gives up after a timeout, and can be switched off (Settings › About, kept in
// update-check.json beside the app's other data).
//
// The update comes into the app (as the earlier build's silent self-update did): when a newer version is there it is
// downloaded in the background (or when the person clicks Update, if "Download updates automatically" is off), with
// its progress in bytes; the file is checked against the size and SHA-256 latest.json names; then "Restart to update"
// hands over:
//   - Windows (an NSIS install): this app quits through its normal path (every edit saved, the tray does not hold
//     it), a small helper waits for it to be gone, runs the installer silently over the top (`/S --updated` into
//     the same folder, so the install mode and folder stay), checks the new program is the new version, and starts
//     it again. If the person does not restart, the same happens when they quit (without the restart). If the
//     installer fails, the previous folder is put back as it was (it was moved aside, not deleted) and the previous
//     version starts and says what went wrong, with the website as the fallback.
//   - Linux (an AppImage): the new AppImage is downloaded beside the running one, checked, made executable and
//     renamed over it (atomic: the running copy keeps working from the file it opened), and the restart starts it.
// The first start of the new version says "Updated to X" with the release's notes.
//
// Small fixes download less: when latest.json carries a block map (tools/release.mjs) and this PC has the file the
// running version came from (the AppImage itself; on Windows, the installer this updater downloaded last time),
// only the blocks that changed are downloaded (HTTP ranges) and the rest is copied from the local file; the result
// is checked against the same SHA-256 as a full download, and anything odd falls back to the full download.
//
// Self-contained on purpose: nothing here imports the rest of the app. The logic is plain functions and one class
// with its outside world passed in (tests/update-check.test.mjs); startUpdateCheck() at the bottom is the only part
// that touches Electron, and src/main/index.ts calls it once.
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, fstatSync, openSync, readFileSync, readSync, realpathSync, statSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export const UPDATE_ORIGIN = 'https://ironleaf.kaitiaki-it.com';
/** The site before the rename to Ironleaf: the fallback when UPDATE_ORIGIN fails (it still serves every release). */
export const LEGACY_UPDATE_ORIGIN = 'https://neuralvault.kaitiaki-it.com';
/** The sites read for latest.json, in order. */
export const UPDATE_ORIGINS = [UPDATE_ORIGIN, LEGACY_UPDATE_ORIGIN] as const;
export const LATEST_URL = `${UPDATE_ORIGIN}/download/latest.json`;
export const DOWNLOAD_PAGE = `${UPDATE_ORIGIN}/download/`;
// ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ PLACEHOLDER — REPLACE AT RELEASE. The public half of the release key that signs latest.json (Ed25519, SPKI     │
// │ PEM). Set: latest.json is used only with a valid latest.json.sig (tools/update-sign.mjs), so the SHA-256 of     │
// │ each installer is vouched for by the release key, not only by the site. Empty: the signature is not checked     │
// │ (development builds), and tools/release.mjs refuses to publish.                                               │
// └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
export const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAC54eLB9ghYkUi0DSK0hSIN5pkF222gEtJoMphJrSMgo=
-----END PUBLIC KEY-----`;

/** Whether `sig` (a compact EdDSA JWS) signs exactly `text` with the key. Never throws: false on anything wrong. */
export async function verifyLatestSignature(text: string, sig: string, publicKeyPem: string): Promise<boolean> {
  try {
    const jose = await import('jose');
    const key = await jose.importSPKI(publicKeyPem.trim(), 'EdDSA');
    const { payload } = await jose.compactVerify(sig.trim(), key, { algorithms: ['EdDSA'] });
    return Buffer.from(payload).equals(Buffer.from(text, 'utf8'));
  } catch {
    return false;
  }
}

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
export const FIRST_CHECK_AFTER_MS = 15_000;

/** The release's file is not on the site (404 or 410): announced, but not there to download (yet, or withdrawn). */
class MissingRelease extends Error {
  constructor() {
    super('This version is not available to download yet. Ironleaf tries again at its next check.');
  }
}
export const TIMEOUT_MS = 10_000;
/** A download that stops moving for this long is given up (it is retried on the next check or click). */
export const STALL_MS = 60_000;
const MAX_LATEST_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const MAX_BLOCKMAP_BYTES = 16 * 1024 * 1024;
/** The relaunch flag after an update (NSIS's own name for it: `${isUpdated}` in the installer). */
export const UPDATED_FLAG = '--updated';
/** The test switch that, together with NV_UPDATE_ORIGIN, lets an installed copy read a stand-in site (docs/RELEASING.md). */
export const TEST_ORIGIN_FLAG = '--nv-update-test-origin';

export interface BlockmapRef {
  file: string;
  size: number;
  sha256: string;
}
export interface UpdateAsset {
  /** The name the website serves (Ironleaf-Setup.exe): what the download page links. */
  file: string;
  size: number;
  sha256: string;
  /** Present when the file is not the usual installer (tools/release.mjs: 'portable-zip'). */
  kind?: string;
  /** The same bytes under the version's own name (Ironleaf-Setup-2.0.1.exe), which never changes under a
   *  download: the updater downloads this one when it is named. */
  versioned?: string;
  /** Windows: the installer's block map (gzip JSON) for a differential download. */
  blockmap?: BlockmapRef;
  /** Linux: the size of the block map the AppImage carries at its end (before its 4-byte length). */
  blockMapSize?: number;
}
export interface LatestInfo {
  version: string;
  date: string;
  notes: string;
  windows?: UpdateAsset;
  linux?: UpdateAsset;
}
export type UpdateStage = 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing';
/** What the window is told (the banner and the Settings rows read this and nothing else). */
export interface UpdateState {
  enabled: boolean;
  /** Set when the organisation's policy decides updates (src/main/policy.ts): the words to show, switches locked. */
  managed?: string;
  /** Download a newer version by itself (on by default); off: only when the person clicks Update. */
  autoDownload: boolean;
  current: string;
  /** The newer version, when there is one. canInstall: it can come into the app here (else the button opens the
   *  download page). dismissed: the person said Later to it (the banner keeps quiet; a ready download still
   *  installs on quit). */
  available: { version: string; date: string; notes: string; canInstall: boolean; size: number; dismissed: boolean } | null;
  /** When the last check that got an answer finished (ISO), or null. */
  checkedAt: string | null;
  /** idle → downloading → verifying → ready ("Restart to update") → installing. */
  stage: UpdateStage;
  /** Bytes so far while downloading (a differential download counts only what comes over the network). */
  progress: { received: number; total: number; differential: boolean } | null;
  /** The last download's failure in plain words, or null. */
  error: string | null;
  /** The last download failed because the release's file is not on the site (yet): nothing to fetch from the
   *  website either, so no "Download from the website"; the next check tries again by itself. */
  missing?: boolean;
  /** The first start after an update: "Updated to X", with that release's notes, until the person closes it. */
  updated: { version: string; from: string; notes: string } | null;
  /** The last install did not land: the words, and the version that is still running (and working). */
  failed: { version: string; words: string } | null;
  /** Windows: a ready update installs when the person quits. */
  installsOnQuit: boolean;
}
interface Pending {
  from: string;
  to: string;
  notes: string;
  file: string;
}
interface Stored {
  enabled: boolean;
  autoDownload: boolean;
  dismissed: string | null;
  checkedAt: string | null;
  pending: Pending | null;
  updated: UpdateState['updated'];
  failed: UpdateState['failed'];
}

/** x.y.z numbers of a version ("v2.0.1", "2.0", "2.0.1-beta.1" → [2,0,1]); null when it is not a version. */
export function versionParts(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+][0-9A-Za-z.-]{0,40})?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** -1, 0 or 1 as `a` is older than, the same as, or newer than `b`. Something that is not a version is older than
 *  anything that is (so a broken answer never reads as an update). A pre-release is older than its release. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  const pre = (v: unknown) => /^v?[\d.]+-/.test(String(v).trim());
  if (pre(a) !== pre(b)) return pre(a) ? -1 : 1;
  return 0;
}

export const isNewer = (candidate: unknown, current: unknown): boolean => versionParts(candidate) !== null && compareVersions(candidate, current) === 1;

const BARE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const bareName = (v: unknown): v is string => typeof v === 'string' && BARE_NAME.test(v) && !v.includes('..');
const goodSize = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const goodSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{64}$/.test(v);

function asset(raw: unknown): UpdateAsset | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  // A bare file name only (no folders, no address): the download is always that name under /download/ on our site.
  if (!bareName(r.file) || !goodSize(r.size) || !goodSha(r.sha256)) return undefined;
  const out: UpdateAsset = { file: r.file, size: r.size, sha256: r.sha256.toLowerCase() };
  if (typeof r.kind === 'string' && /^[a-z-]{1,24}$/.test(r.kind)) out.kind = r.kind;
  if (bareName(r.versioned)) out.versioned = r.versioned;
  const b = r.blockmap as Record<string, unknown> | undefined;
  if (b && typeof b === 'object' && bareName(b.file) && goodSize(b.size) && b.size <= MAX_BLOCKMAP_BYTES && goodSha(b.sha256)) out.blockmap = { file: b.file, size: b.size, sha256: b.sha256.toLowerCase() };
  if (goodSize(r.blockMapSize) && r.blockMapSize < Math.min(r.size, MAX_BLOCKMAP_BYTES)) out.blockMapSize = r.blockMapSize;
  return out;
}

/** latest.json's text read into what the app uses, or null when it is not that (bad JSON, wrong shape, no version).
 *  Nothing in it is trusted beyond its shape: the notes are cut to plain text of a sane length. */
export function parseLatest(text: unknown): LatestInfo | null {
  if (typeof text !== 'string' || text.length > MAX_LATEST_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!versionParts(r.version)) return null;
  const notes = typeof r.notes === 'string' ? r.notes.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 2000) : '';
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '';
  const windows = asset(r.windows);
  const linux = asset(r.linux);
  return { version: (r.version as string).trim().replace(/^v/, ''), date, notes, ...(windows ? { windows } : {}), ...(linux ? { linux } : {}) };
}

export const assetFor = (latest: LatestInfo, platform: string): UpdateAsset | undefined => (platform === 'win32' ? latest.windows : platform === 'linux' ? latest.linux : undefined);

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A file's SHA-256, read as a stream (an installer is 200 MB). */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

const WRONG_SIZE = 'The download is not the size the release says it should be, so it was not installed.';
const WRONG_SUM = 'The download does not match the release’s checksum, so it was not installed.';

/** The downloaded bytes are exactly the file latest.json describes (its size and its SHA-256), or this throws and
 *  nothing is run. */
export function verifyDownload(bytes: Uint8Array, want: { size: number; sha256: string }): void {
  if (bytes.length !== want.size) throw new Error(WRONG_SIZE);
  if (sha256Hex(bytes) !== want.sha256.toLowerCase()) throw new Error(WRONG_SUM);
}

/** The same for a downloaded file on disk. */
export async function verifyFile(file: string, want: { size: number; sha256: string }): Promise<void> {
  const st = await fsp.stat(file);
  if (st.size !== want.size) throw new Error(WRONG_SIZE);
  if ((await sha256File(file)) !== want.sha256.toLowerCase()) throw new Error(WRONG_SUM);
}

/** The installer is still exactly the file that was checked (size and SHA-256), read again as this app quits, just
 *  before the helper that runs it is started (synchronous: the quit does not wait for anything). False on any doubt. */
export function installerUnchanged(file: string, want: { size: number; sha256: string }): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    if (fstatSync(fd).size !== want.size) return false;
    const hash = createHash('sha256');
    const buf = Buffer.alloc(4 * 1024 * 1024);
    let at = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, at);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
      at += n;
    }
    return at === want.size && hash.digest('hex') === want.sha256.toLowerCase();
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** A response's bytes, at most `limit` of them: a declared length over the limit is refused before anything is
 *  read, and a body that runs past it is cancelled there (a site, or anything between, cannot make Ironleaf read an
 *  endless answer into memory). */
export async function readCapped(res: ResponseLike, limit: number): Promise<Buffer> {
  const tooBig = () => new Error(`the answer is larger than ${limit} bytes`);
  const declared = Number(res.headers?.get?.('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.getReader().cancel?.().catch(() => {});
    throw tooBig();
  }
  if (!res.body) {
    // No stream to read (an empty answer, or a stand-in): what there is, still held to the limit.
    const bytes = typeof res.arrayBuffer === 'function' ? Buffer.from(await res.arrayBuffer()) : Buffer.from(await res.text(), 'utf8');
    if (bytes.length > limit) throw tooBig();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value ?? new Uint8Array(0);
    got += chunk.length;
    if (got > limit) {
      await reader.cancel?.().catch(() => {});
      throw tooBig();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, got);
}

/** The one address a release file is downloaded from: its bare name under /download/ on Ironleaf's own site. */
export function assetUrl(a: { file: string }, origin: string = UPDATE_ORIGIN): string {
  if (!bareName(a.file)) throw new Error('That is not a release file name.');
  return `${origin}/download/${encodeURIComponent(a.file)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Block maps (electron-builder's format, version 2): the file cut into content-defined blocks, each named by a
// checksum and a size. Two versions' maps say which blocks the new file shares with the old one.

export interface BlockMap {
  version: string;
  files: { name: string; offset: number; checksums: string[]; sizes: number[] }[];
}
export type BlockOp = { kind: 'copy' | 'download'; start: number; end: number };

/** A block map's bytes (gzip for the Windows .blockmap file, raw deflate for the one inside an AppImage) read and
 *  checked for shape, or this throws. */
export function parseBlockmap(bytes: Uint8Array, format: 'gzip' | 'deflate'): BlockMap {
  const json = (format === 'gzip' ? gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }) : inflateRawSync(bytes, { maxOutputLength: 256 * 1024 * 1024 })).toString('utf8');
  const raw = JSON.parse(json) as BlockMap;
  if (!raw || raw.version !== '2' || !Array.isArray(raw.files) || raw.files.length !== 1) throw new Error('not a block map');
  const f = raw.files[0];
  if (!Array.isArray(f.checksums) || !Array.isArray(f.sizes) || f.checksums.length !== f.sizes.length || !Number.isSafeInteger(f.offset) || f.offset < 0) throw new Error('not a block map');
  for (let i = 0; i < f.sizes.length; i++) if (!goodSize(f.sizes[i]) || typeof f.checksums[i] !== 'string') throw new Error('not a block map');
  return raw;
}

/** How to make the new file from the old one: runs of blocks to copy from the old file (old file's offsets) and
 *  runs to download (new file's offsets), in the new file's order. `mapped` is how many bytes of the new file the
 *  map covers. */
export function planDifferential(oldMap: BlockMap, newMap: BlockMap): { ops: BlockOp[]; copy: number; download: number; mapped: number } {
  const old = new Map<string, number>();
  let at = oldMap.files[0].offset;
  oldMap.files[0].checksums.forEach((sum, i) => {
    const key = `${sum}:${oldMap.files[0].sizes[i]}`;
    if (!old.has(key)) old.set(key, at);
    at += oldMap.files[0].sizes[i];
  });
  const ops: BlockOp[] = [];
  let pos = newMap.files[0].offset;
  let copy = 0;
  let download = 0;
  newMap.files[0].checksums.forEach((sum, i) => {
    const size = newMap.files[0].sizes[i];
    const from = old.get(`${sum}:${size}`);
    const op: BlockOp = from === undefined ? { kind: 'download', start: pos, end: pos + size } : { kind: 'copy', start: from, end: from + size };
    if (from === undefined) download += size;
    else copy += size;
    const last = ops[ops.length - 1];
    if (last && last.kind === op.kind && last.end === op.start) last.end = op.end;
    else ops.push(op);
    pos += size;
  });
  return { ops, copy, download, mapped: pos };
}

/** The block map an AppImage carries at its end (electron-builder appends it: raw deflate, then its length as 4
 *  big-endian bytes), and where the mapped part of the file ends. */
export async function readEmbeddedBlockmap(file: string): Promise<{ map: BlockMap; mapped: number }> {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tail = Buffer.alloc(4);
    await fh.read(tail, 0, 4, size - 4);
    const length = tail.readUInt32BE(0);
    if (!length || length > MAX_BLOCKMAP_BYTES || length > size - 4) throw new Error('no block map in this file');
    const body = Buffer.alloc(length);
    await fh.read(body, 0, length, size - 4 - length);
    return { map: parseBlockmap(body, 'deflate'), mapped: size - 4 - length };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Windows helper: a PowerShell script written next to the downloaded installer and started as this app quits.

/** One argument on a Windows command line, quoted the way CommandLineToArgvW reads it back. */
export function winQuote(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
const psString = (v: string): string => `'${String(v).replace(/'/g, "''")}'`;

/** The arguments the next start gets: this start's own, without the update's flag or a hidden start (the person
 *  asked for the restart and wants the window), plus UPDATED_FLAG when it is the new version. */
export function relaunchArgs(argv: readonly string[], updated: boolean, hiddenArg = '--hidden'): string[] {
  const keep = argv.filter((a) => a !== UPDATED_FLAG && a !== hiddenArg);
  return updated ? [...keep, UPDATED_FLAG] : keep;
}

/** The helper that installs over this Ironleaf once it has quit. It waits for this process (and anything else
 *  running from the install folder) to be gone, moves the install folder aside (so a failed install can be undone),
 *  runs the installer silently with electron-builder's update flag into the same folder, checks that the program
 *  there is now the new version, then deletes the old folder, or on failure puts it back. It writes what happened
 *  to `result` (update-result.json) and starts Ironleaf again when asked (always the version that is there). */
export function windowsHelperScript(o: { pid: number; setup: string; installDir: string; exe: string; to: string; from: string; result: string; log: string; relaunch: boolean; args: readonly string[]; sha256?: string }): string {
  const updatedArgs = [...o.args, UPDATED_FLAG].map(winQuote).join(' ');
  const plainArgs = o.args.map(winQuote).join(' ');
  return [
    '# Ironleaf update helper (src/main/update-check.ts): written and started by Ironleaf as it quits.',
    'param([switch]$Clean)',
    // A process started by Ironleaf inherits what Ironleaf had open (its listening sockets among them), and
    // so would the Ironleaf it starts again, which then could not open them. So the helper first starts a clean
    // copy of itself through the shell (which passes nothing on) and that copy does the work.
    "if (-not $Clean) { Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('\"' + $PSCommandPath + '\"'), '-Clean') -WindowStyle Hidden; exit }",
    "$ErrorActionPreference = 'Continue'",
    `$appPid = ${Math.trunc(o.pid)}`,
    `$setup = ${psString(o.setup)}`,
    `$dir = ${psString(o.installDir.replace(/[\\/]+$/, ''))}`,
    `$exe = ${psString(o.exe)}`,
    `$want = ${psString(o.to)}`,
    `$from = ${psString(o.from)}`,
    `$resultFile = ${psString(o.result)}`,
    `$log = ${psString(o.log)}`,
    `$relaunch = $${o.relaunch ? 'true' : 'false'}`,
    `$updatedArgs = ${psString(updatedArgs)}`,
    `$plainArgs = ${psString(plainArgs)}`,
    `$wantSum = ${psString(/^[0-9a-f]{64}$/i.test(o.sha256 ?? '') ? o.sha256!.toUpperCase() : '')}`,
    "$aside = $dir + '.nv-previous'",
    "function Say($w) { try { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('s') + ' ' + $w) } catch {} }",
    'function Done($ok, $code, $words) {',
    "  $json = (@{ ok = $ok; from = $from; to = $want; code = $code; words = $words; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress)",
    '  try { [IO.File]::WriteAllText($resultFile, $json) } catch { Say "could not write the result: $_" }',
    '}',
    "function Left() { @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir + '\\', [StringComparison]::OrdinalIgnoreCase) }) }",
    'function Start-NV($argLine) {',
    '  try { $psi = New-Object Diagnostics.ProcessStartInfo $exe; $psi.Arguments = $argLine; $psi.WorkingDirectory = $dir; $psi.UseShellExecute = $true; [void][Diagnostics.Process]::Start($psi); Say "started $exe" } catch { Say "could not start Ironleaf again: $_" }',
    '}',
    'Say "update ${from} -> ${want}, waiting for Ironleaf (${appPid}) to quit"',
    // 1. Ironleaf has quit by its own path (every edit saved); anything still running from the folder goes too.
    'try { Wait-Process -Id $appPid -Timeout 120 -ErrorAction SilentlyContinue } catch {}',
    '$until = (Get-Date).AddSeconds(30)',
    'while ((Left).Count -gt 0 -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 300 }',
    'if ((Left).Count -gt 0) { Say "still running from the folder after 30 s; the installer closes them" }',
    // The installer is checked once more right before it runs (Ironleaf checked it as it quit): a file changed in
    // between is never run, and nothing has been moved yet.
    "if ($wantSum) { $sum = ''; try { $sum = (Get-FileHash -LiteralPath $setup -Algorithm SHA256 -ErrorAction Stop).Hash } catch {}; if ($sum -ne $wantSum) { Say \"the installer is not the checked file ($sum)\"; Done $false -3 'The downloaded installer changed after it was checked, so it was not run.'; if ($relaunch) { Start-NV $plainArgs }; exit } }",
    // 2. The old folder aside (a rename: instant, and the undo for a failed install). Not possible (another
    //    program has the folder open, or it needs an administrator): the installer replaces it in place instead.
    'if (Test-Path -LiteralPath $aside) { Remove-Item -LiteralPath $aside -Recurse -Force -ErrorAction SilentlyContinue }',
    '$moved = $false',
    'for ($i = 0; $i -lt 10 -and -not $moved; $i++) { try { Rename-Item -LiteralPath $dir -NewName (Split-Path $aside -Leaf) -ErrorAction Stop; $moved = $true } catch { Start-Sleep -Milliseconds 500 } }',
    'Say ("previous folder moved aside: " + $moved)',
    // 3. The installer, silently, as an update (`--updated`: no pages, same install mode), into the same folder.
    "$code = -1; $words = ''",
    'try {',
    '  $psi = New-Object Diagnostics.ProcessStartInfo $setup',
    '  $psi.Arguments = "/S --updated /D=$dir"',
    '  $psi.UseShellExecute = $false',
    '  $p = [Diagnostics.Process]::Start($psi)',
    "  if ($p.WaitForExit(900000)) { $code = $p.ExitCode } else { try { $p.Kill() } catch {}; $code = -2; $words = 'The installer did not finish within 15 minutes.' }",
    "} catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $words = 'The installer could not be started (' + $e.Message.TrimEnd('.') + ').' }",
    "$ver = ''",
    'try { $ver = (Get-Item -LiteralPath $exe -ErrorAction Stop).VersionInfo.ProductVersion } catch {}',
    "$ok = ($code -eq 0) -and ($ver -eq $want -or $ver -eq ($want + '.0'))",
    'Say "installer exit code $code; the program there is version \'$ver\'"',
    'if ($ok) {',
    '  if ($moved) { Remove-Item -LiteralPath $aside -Recurse -Force -ErrorAction SilentlyContinue }',
    "  Done $true $code ''",
    '} else {',
    '  if (-not $words) { if ($code -ne 0) { $words = "The installer stopped with code $code." } else { $words = "The installer finished but Ironleaf $want is not in place." } }',
    '  if ($moved) {',
    '    for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath $dir); $i++) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $dir) { Start-Sleep -Milliseconds 500 } }',
    "    try { Rename-Item -LiteralPath $aside -NewName (Split-Path $dir -Leaf) -ErrorAction Stop; Say 'previous version put back' } catch { Say \"could not put the previous version back: $_\"; $words = $words + ' The previous version could not be put back: download Ironleaf from the website.' }",
    '  }',
    '  Done $false $code $words',
    '}',
    'if ($ok -and $relaunch) { Start-NV $updatedArgs } elseif ((-not $ok) -and $relaunch) { Start-NV $plainArgs }',
    "Say 'done'",
    '',
  ].join('\r\n');
}

/** How the helper is started as this app quits: through `cmd /c start`, so PowerShell is not a child of this process
 *  (a directly spawned child, even "detached", was ended with Ironleaf on the test PC; one started by cmd's
 *  `start` breaks away and lives on). */
export function helperCommand(systemRoot: string, comSpec: string | undefined, helper: string): { file: string; args: string[] } {
  const ps = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const inner = `start "" /b "${ps}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${helper}"`;
  return { file: comSpec || `${systemRoot}\\System32\\cmd.exe`, args: ['/d', '/s', '/c', `"${inner}"`] };
}

/** Linux: the checked AppImage takes the running one's place. Same folder, so the rename is atomic: a start at any
 *  moment finds the old file or the new one, never half of one, and the running copy keeps the file it opened. */
export async function replaceAppImage(downloaded: string, target: string): Promise<void> {
  let mode = 0o755;
  try {
    mode = ((await fsp.stat(target)).mode & 0o777) | 0o111;
  } catch {}
  await fsp.chmod(downloaded, mode);
  await fsp.rename(downloaded, target);
}

/** Linux: how the new AppImage is started once this one has quit. A plain shell outside the AppImage waits for this
 *  process to be gone (so the new start gets the one-instance lock, and the old copy's mount is let go), then
 *  starts the AppImage with this start's own arguments. The environment loses what the old AppImage's runtime set
 *  (its mount point would be gone): the new one sets its own. */
export function appImageRelaunch(o: { pid: number; appImage: string; args: readonly string[]; env: Record<string, string | undefined>; bash?: boolean }): { file: string; args: string[]; env: Record<string, string> } {
  const mount = o.env.APPDIR ?? '';
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.env)) {
    if (v === undefined || ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'].includes(k)) continue;
    if (!mount || !v.includes(mount)) {
      env[k] = v;
      continue;
    }
    // A search list (PATH, LD_LIBRARY_PATH, XDG_DATA_DIRS…) keeps its entries outside the old mount: the AppImage
    // runtime needs PATH to find fusermount.
    const kept = v.split(':').filter((part) => part && !part.includes(mount));
    if (kept.length) env[k] = kept.join(':');
  }
  env.PATH ||= '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  // Descriptors this process left open (its sockets, its lock) are closed first, so the new start does not hold them.
  // (bash: a plain sh such as dash cannot name a descriptor above 9, and a bad redirection would end the script.)
  const close = o.bash ? 'for fd in $(ls /proc/$$/fd 2>/dev/null); do if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec $fd>&-" 2>/dev/null; fi; done; ' : '';
  const script = close + 'i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done; shift; exec "$@"';
  return { file: o.bash ? '/bin/bash' : '/bin/sh', args: ['-c', script, 'neuralvault-update', String(Math.trunc(o.pid)), o.appImage, ...o.args], env };
}

/** One line of /proc/self/mountinfo: where it is mounted, the filesystem type and its source (octal escapes such as
 *  \040 for a space read back). */
function mountinfoEntries(text: string): { point: string; type: string; source: string }[] {
  const unescape = (v: string) => v.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
  const out: { point: string; type: string; source: string }[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(' ');
    const dash = parts.indexOf('-');
    if (parts.length < 7 || dash < 6 || parts.length < dash + 3) continue;
    out.push({ point: unescape(parts[4]), type: unescape(parts[dash + 1]), source: unescape(parts[dash + 2]) });
  }
  return out;
}

/** Linux: the AppImage this copy really runs from, or null. APPIMAGE and APPDIR are only words in the environment
 *  (inherited by anything a program starts, or set by whoever started this one), so they are trusted only when this
 *  program runs from inside APPDIR, APPDIR is a FUSE mount, and that mount is of the file APPIMAGE names (the
 *  AppImage runtime mounts the file under its own name). The answer is the real path of that file. */
export function trustedAppImage(o: { execPath: string; env: Record<string, string | undefined>; mountinfo: string; realpath(p: string): string; isFile(p: string): boolean }): string | null {
  const image = o.env.APPIMAGE ?? '';
  const appDir = o.env.APPDIR ?? '';
  if (!image || !appDir || !path.isAbsolute(image) || !path.isAbsolute(appDir)) return null;
  try {
    const dir = o.realpath(appDir).replace(/\/+$/, '');
    const exe = o.realpath(o.execPath);
    if (!dir || dir === '/' || !exe.startsWith(dir + '/')) return null;
    const file = o.realpath(image);
    if (!o.isFile(file) || file === dir || file.startsWith(dir + '/')) return null;
    const name = path.basename(file);
    const mount = mountinfoEntries(o.mountinfo).filter((m) => m.point === dir).pop();
    if (!mount || !/^fuse(\.|$)/.test(mount.type)) return null;
    return mount.type === `fuse.${name}` || mount.source === name || mount.source === file ? file : null;
  } catch {
    return null;
  }
}

/** trustedAppImage for this process (null anywhere but Linux). */
export function runningAppImage(): string | null {
  if (process.platform !== 'linux') return null;
  let mountinfo = '';
  try {
    mountinfo = readFileSync('/proc/self/mountinfo', 'utf8');
  } catch {
    return null;
  }
  return trustedAppImage({ execPath: process.execPath, env: process.env, mountinfo, realpath: (p) => realpathSync(p), isFile: (p) => statSync(p).isFile() });
}

/** Where the AppImage is downloaded to: beside the running one (the same filesystem, for the rename). */
export const appImagePart = (target: string, version: string): string => path.join(path.dirname(target), `.${path.basename(target)}.${version}.part`);

// ---------------------------------------------------------------------------------------------------------------

type BodyLike = { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(reason?: unknown): Promise<void> } };
type ResponseLike = { ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; body?: BodyLike | null; headers?: { get(name: string): string | null } };
type FetchLike = (url: string, init?: { signal?: AbortSignal; redirect?: 'error' | 'follow'; cache?: 'no-store'; headers?: Record<string, string> }) => Promise<ResponseLike>;
type FileHandle = import('node:fs/promises').FileHandle;

/** How an update comes into the app on this PC (startUpdateCheck makes the real one; the tests a stand-in). */
export interface InstallPort {
  kind: 'nsis' | 'appimage';
  /** null when the update can come into the app here; else plain words why not (the website is offered). */
  blocked(): string | null | Promise<string | null>;
  /** Where the download goes (default: the updates folder, under its version). */
  target?(version: string, name: string): string;
  /** The file this version was installed from, for a differential download: the AppImage itself. */
  currentFile?: string;
  /** The checked file is put in place (the AppImage replaces the running one) or kept for the installer. */
  stage(file: string, latest: LatestInfo): Promise<void>;
  /** "Restart to update": hands over (the app quits). */
  restart(file: string, latest: LatestInfo): Promise<void> | void;
}

export interface UpdateCheckDeps {
  /** This app's version. */
  current: string;
  platform: string;
  fetch: FetchLike;
  /** The small state file (update-check.json): read gives its text or null, write replaces it. */
  readState(): Promise<string | null>;
  writeState(text: string): Promise<void>;
  openExternal(url: string): Promise<void> | void;
  /** The folder for downloads (and, on Windows, the installer kept for the next differential update). */
  updateDir?: string;
  /** How the update is installed here; absent: the Update button opens the download page. */
  installer?: InstallPort;
  /** Told whenever the state the window shows may have changed. */
  onChange?(state: UpdateState): void;
  now?(): number;
  latestUrl?: string;
  origin?: string;
  /** The sites tried for latest.json, in order (UPDATE_ORIGINS unless the checks give others). */
  origins?: readonly string[];
  timeoutMs?: number;
  stallMs?: number;
  log?(words: string): void;
  /** The release key latest.json must be signed with (UPDATE_PUBLIC_KEY_PEM unless the checks give another). */
  updateKeyPem?: string;
  /** Managed policy (src/main/managed.ts › managedUpdates): disabled means no check at all, not even "Check now". */
  managed?: { disabled: boolean; words: string };
}

/** What managed policy says about updates, handed to startUpdateCheck by src/main/index.ts. */
export interface ManagedUpdates {
  disabled: boolean;
  words: string;
  origin?: string;
  latestUrl?: string;
}

const mb = (n: number) => (n / 1048576).toFixed(1);

export class UpdateChecker {
  private stored: Stored = { enabled: true, autoDownload: true, dismissed: null, checkedAt: null, pending: null, updated: null, failed: null };
  private latest: LatestInfo | null = null;
  private stage: UpdateStage = 'idle';
  private progress: UpdateState['progress'] = null;
  private error: string | null = null;
  private missing = false;
  private readyFile: string | null = null;
  /** The release readyFile was downloaded and checked for (a check during the download may have read a newer one
   *  into `latest`; the ready file is always handed over with its own release, never with that one). */
  private readyLatest: LatestInfo | null = null;
  private blocked: string | null = null;
  private loaded: Promise<void> | null = null;
  private checking: Promise<UpdateState> | null = null;
  private downloading: Promise<UpdateState> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private lastTold = 0;
  /** The site whose latest.json was read last (downloads come from the same one). */
  private answeredOrigin: string | null = null;

  constructor(private readonly d: UpdateCheckDeps) {}

  /** Where release files come from: a given stand-in, else the site that answered, else Ironleaf's. */
  private get site(): string {
    return this.d.origin ?? this.answeredOrigin ?? UPDATE_ORIGIN;
  }

  private get dir(): string | null {
    return this.d.updateDir ?? null;
  }
  private get resultFile(): string | null {
    return this.dir ? path.join(this.dir, 'update-result.json') : null;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = JSON.parse(((await this.d.readState()) ?? 'null').replace(/^﻿/, '')) as Partial<Stored> | null;
        if (raw && typeof raw === 'object') {
          const p = raw.pending as Partial<Pending> | null | undefined;
          const u = raw.updated as Partial<NonNullable<Stored['updated']>> | null | undefined;
          const f = raw.failed as Partial<NonNullable<Stored['failed']>> | null | undefined;
          this.stored = {
            enabled: raw.enabled !== false,
            autoDownload: raw.autoDownload !== false,
            dismissed: typeof raw.dismissed === 'string' && versionParts(raw.dismissed) ? raw.dismissed : null,
            checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : null,
            pending: p && typeof p === 'object' && versionParts(p.to) && typeof p.from === 'string' ? { from: p.from, to: p.to as string, notes: typeof p.notes === 'string' ? p.notes.slice(0, 2000) : '', file: typeof p.file === 'string' ? p.file : '' } : null,
            updated: u && typeof u === 'object' && typeof u.version === 'string' ? { version: u.version, from: typeof u.from === 'string' ? u.from : '', notes: typeof u.notes === 'string' ? u.notes.slice(0, 2000) : '' } : null,
            failed: f && typeof f === 'object' && typeof f.version === 'string' && typeof f.words === 'string' ? { version: f.version, words: f.words.slice(0, 500) } : null,
          };
        }
      } catch {
        // No file yet, or not ours: the defaults (checking and downloading on).
      }
      await this.settle();
      try {
        this.blocked = this.d.installer ? await this.d.installer.blocked() : null;
      } catch (err) {
        this.blocked = err instanceof Error ? err.message : String(err);
      }
    })();
    return this.loaded;
  }

  /** The start after an install was handed over: did it land? The new version says "Updated to X" (until closed);
   *  the old one, when the helper wrote that the installer failed, says so. Otherwise nothing has happened yet and
   *  the ready download is offered again. */
  private async settle(): Promise<void> {
    const p = this.stored.pending;
    if (this.stored.updated && compareVersions(this.stored.updated.version, this.d.current) !== 0) this.stored.updated = null;
    if (!p) return;
    const result = await this.readResult();
    if (compareVersions(this.d.current, p.to) >= 0) {
      this.stored.updated = { version: this.d.current, from: p.from, notes: p.notes };
      this.stored.pending = null;
      this.stored.failed = null;
      this.d.log?.(`Update: now ${this.d.current} (was ${p.from}).`);
      await this.tidy(this.d.current);
    } else if (result && result.ok === false && result.to === p.to) {
      this.stored.failed = { version: p.to, words: String(result.words || 'The installer did not finish.').slice(0, 500) };
      this.stored.pending = null;
      this.stored.updated = null; // the newest news is what shows
      this.d.log?.(`Update to ${p.to}: did not install (${this.stored.failed.words}).`);
    } else {
      return;
    }
    if (this.resultFile) await fsp.rm(this.resultFile, { force: true }).catch(() => {});
    await this.save();
  }

  private async readResult(): Promise<{ ok?: boolean; to?: string; words?: string } | null> {
    if (!this.resultFile) return null;
    try {
      return JSON.parse((await fsp.readFile(this.resultFile, 'utf8')).replace(/^﻿/, ''));
    } catch {
      return null;
    }
  }

  /** The updates folder keeps only what the running version may need: its own installer and block map (the base of
   *  the next differential download on Windows) and the helper's log. Older downloads go. */
  private async tidy(keep: string): Promise<void> {
    if (!this.dir) return;
    try {
      for (const name of await fsp.readdir(this.dir)) {
        if (name === keep || name === 'update.log') continue;
        await fsp.rm(path.join(this.dir, name), { recursive: true, force: true }).catch(() => {});
      }
    } catch {}
  }

  private async save(): Promise<void> {
    try {
      await this.d.writeState(JSON.stringify(this.stored, null, 2) + '\n');
    } catch (err) {
      this.d.log?.('Update check: could not keep its settings: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private installable(l: LatestInfo | null): { asset: UpdateAsset; latest: LatestInfo } | null {
    if (!l || !this.d.installer || this.blocked || !this.dir) return null;
    const a = assetFor(l, this.d.platform);
    if (!a || a.kind || a.size > MAX_INSTALLER_BYTES) return null;
    if (this.d.installer.kind === 'nsis' && !/\.exe$/i.test(a.file)) return null;
    if (this.d.installer.kind === 'appimage' && !/\.AppImage$/i.test(a.file)) return null;
    return { asset: a, latest: l };
  }

  private view(): UpdateState {
    const l = this.latest;
    const newer = (this.stored.enabled || this.stage !== 'idle') && l && isNewer(l.version, this.d.current);
    const a = l ? assetFor(l, this.d.platform) : undefined;
    return {
      enabled: this.stored.enabled && !this.d.managed?.disabled,
      ...(this.d.managed ? { managed: this.d.managed.words } : {}),
      autoDownload: this.stored.autoDownload,
      current: this.d.current,
      available: newer && l ? { version: l.version, date: l.date, notes: l.notes, canInstall: !!this.installable(l), size: a?.size ?? 0, dismissed: this.stored.dismissed === l.version } : null,
      checkedAt: this.stored.checkedAt,
      stage: this.stage,
      progress: this.progress,
      error: this.error,
      ...(this.error && this.missing ? { missing: true } : {}),
      updated: this.stored.updated,
      failed: this.stored.failed,
      installsOnQuit: this.d.installer?.kind === 'nsis',
    };
  }

  private changed(): UpdateState {
    const state = this.view();
    this.lastTold = Date.now();
    try {
      this.d.onChange?.(state);
    } catch {}
    return state;
  }

  async state(): Promise<UpdateState> {
    await this.load();
    return this.view();
  }

  /** The checked file waiting to be installed (Windows' quit hook reads it), with its release. */
  ready(): { file: string; latest: LatestInfo } | null {
    return (this.stage === 'ready' || this.stage === 'installing') && this.readyFile && this.readyLatest ? { file: this.readyFile, latest: this.readyLatest } : null;
  }

  /** Reads latest.json once. Never throws: no network, a timeout, a bad answer all leave things as they were.
   *  `force` checks even when checking is switched off (the person pressed "Check now"). A newer version that can
   *  come into the app is then downloaded when downloading by itself is on. */
  async check(force = false): Promise<UpdateState> {
    await this.load();
    if (this.d.managed?.disabled) return this.view();
    if (!this.stored.enabled && !force) return this.view();
    this.checking ??= (async () => {
      try {
        // Ironleaf's site first, then the one from before the rename (a DNS failure, a timeout, a 404 or a bad answer
        // moves on to the next); a stand-in given for the checks is the only one read.
        const sites: { origin: string | null; url: string }[] = this.d.latestUrl ? [{ origin: null, url: this.d.latestUrl }] : (this.d.origins ?? UPDATE_ORIGINS).map((origin) => ({ origin, url: `${origin}/download/latest.json` }));
        let latest: LatestInfo | null = null;
        let answered: string | null = null;
        const failures: string[] = [];
        for (const site of sites) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.d.timeoutMs ?? TIMEOUT_MS);
          try {
            const res = await this.d.fetch(site.url, { signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/json' } });
            if (!res.ok) throw new Error(`the site answered ${res.status}`);
            const text = (await readCapped(res, MAX_LATEST_BYTES)).toString('utf8');
            const pem = this.d.updateKeyPem ?? UPDATE_PUBLIC_KEY_PEM;
            if (pem) {
              const sigRes = await this.d.fetch(`${site.url}.sig`, { signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { accept: 'application/jose' } });
              if (!sigRes.ok) throw new Error(`the release has no signature (${sigRes.status})`);
              // The signature carries latest.json itself (base64url) plus a short header.
              const sig = (await readCapped(sigRes, MAX_LATEST_BYTES * 2)).toString('utf8');
              if (!(await verifyLatestSignature(text, sig, pem))) throw new Error('the release signature does not match');
            }
            latest = parseLatest(text);
            if (!latest) throw new Error('the answer was not a release description');
            answered = site.origin;
            break;
          } catch (err) {
            failures.push(`${site.url}: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            clearTimeout(timeout);
          }
        }
        if (!latest) throw new Error(failures.join('; '));
        if (failures.length) this.d.log?.('Update check: ' + failures.join('; ') + ' (read the next site instead)');
        this.answeredOrigin = answered;
        // A newer release than the one already downloaded: that download is no longer the one to install.
        if (this.readyLatest && this.readyLatest.version !== latest.version && this.stage === 'ready') {
          this.stage = 'idle';
          this.readyFile = null;
          this.readyLatest = null;
        }
        this.latest = latest;
        this.stored.checkedAt = new Date(this.d.now?.() ?? Date.now()).toISOString();
        await this.save();
      } catch (err) {
        this.d.log?.('Update check: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        this.checking = null;
      }
      const state = this.changed();
      const l = this.latest;
      if (l && this.stored.autoDownload && this.stored.enabled && this.stage === 'idle' && isNewer(l.version, this.d.current) && this.installable(l) && this.stored.dismissed !== l.version && this.stored.failed?.version !== l.version) {
        void this.download({ auto: true });
      }
      return state;
    })();
    return this.checking;
  }

  async setEnabled(on: boolean): Promise<UpdateState> {
    await this.load();
    if (this.d.managed?.disabled) return this.changed();
    this.stored.enabled = !!on;
    await this.save();
    if (this.stored.enabled) void this.check();
    return this.changed();
  }

  async setAutoDownload(on: boolean): Promise<UpdateState> {
    await this.load();
    this.stored.autoDownload = !!on;
    await this.save();
    if (this.stored.autoDownload && this.latest) void this.check();
    return this.changed();
  }

  /** "Later": this version's banner keeps quiet (a newer one is offered). A download already made stays ready
   *  (Windows still installs it when the person quits). */
  async dismiss(): Promise<UpdateState> {
    await this.load();
    if (this.latest) this.stored.dismissed = this.latest.version;
    await this.save();
    return this.changed();
  }

  /** Closes the "Updated to X" or "could not be installed" notice. */
  async dismissNotice(): Promise<UpdateState> {
    await this.load();
    this.stored.updated = null;
    this.stored.failed = null;
    this.error = null;
    await this.save();
    return this.changed();
  }

  async openDownloadPage(): Promise<void> {
    await this.d.openExternal(`${this.site}/download/`);
  }

  /** The Update button (or the automatic download): download, check, put in place, then "Restart to update".
   *  Where the update cannot come into the app (a portable copy, a Linux build that is not an AppImage, a folder
   *  Ironleaf may not write), the click opens the download page instead. Never throws. */
  async download(o: { auto?: boolean } = {}): Promise<UpdateState> {
    await this.load();
    const can = this.installable(this.latest);
    if (!can || !isNewer(can.latest.version, this.d.current)) {
      if (!o.auto) await this.openDownloadPage();
      return this.view();
    }
    if (this.stage === 'ready' || this.stage === 'installing') return this.view();
    this.downloading ??= this.fetchUpdate(can.asset, can.latest, !!o.auto)
      .finally(() => (this.downloading = null))
      .then((state) => this.afterSuperseded(can.latest, !!o.auto) ?? state);
    return this.downloading;
  }

  /** A check while `l` was downloading read a newer release. The download that finished (or failed) is put aside,
   *  never handed over under the newer version and never counted against it, and the newer one is downloaded from
   *  the start (by itself only when an automatic download would have started it). */
  private afterSuperseded(l: LatestInfo, auto: boolean): Promise<UpdateState> | null {
    const now = this.latest;
    if (!now || now.version === l.version || !isNewer(now.version, l.version)) return null;
    if (this.stage === 'ready') {
      this.stage = 'idle';
      this.readyFile = null;
      this.readyLatest = null;
    }
    if (this.stage !== 'idle') return null;
    this.error = null;
    this.d.log?.(`Update: ${now.version} came out while ${l.version} was downloading; ${now.version} is downloaded instead.`);
    if (auto && !(this.stored.autoDownload && this.stored.enabled && this.stored.dismissed !== now.version && this.stored.failed?.version !== now.version)) return Promise.resolve(this.changed());
    return this.download({ auto });
  }

  private async fetchUpdate(a: UpdateAsset, l: LatestInfo, auto: boolean): Promise<UpdateState> {
    const port = this.d.installer!;
    const name = a.versioned ?? a.file;
    const file = port.target?.(l.version, name) ?? path.join(this.dir!, l.version, name);
    this.error = null;
    if (!auto) this.stored.failed = null;
    try {
      this.stage = 'downloading';
      this.progress = { received: 0, total: a.size, differential: false };
      this.changed();
      await fsp.mkdir(path.dirname(file), { recursive: true });
      // Already downloaded and still whole (a restart in between): nothing to fetch.
      const have = await verifyFile(file, a).then(
        () => true,
        () => false,
      );
      if (!have) {
        await fsp.rm(file, { force: true });
        let done = false;
        const base = await this.base(port).catch(() => null);
        if (base) {
          try {
            done = await this.differential(a, l, base, file);
          } catch (err) {
            this.d.log?.('Update: the differential download did not work, so the whole file is downloaded (' + (err instanceof Error ? err.message : String(err)) + ').');
            await fsp.rm(file, { force: true }).catch(() => {});
          }
        }
        if (!done) {
          this.progress = { received: 0, total: a.size, differential: false };
          await this.fetchToFile(assetUrl({ file: name }, this.site), file, a.size);
        }
        this.stage = 'verifying';
        this.changed();
        try {
          await verifyFile(file, a);
        } catch (err) {
          await fsp.rm(file, { force: true }).catch(() => {});
          throw err;
        }
      }
      // Windows keeps the new installer's block map beside it: the base of the next differential download.
      if (port.kind === 'nsis' && a.blockmap) await this.keepBlockmap(a.blockmap, file).catch(() => {});
      await port.stage(file, l);
      this.readyFile = port.kind === 'appimage' ? (port.currentFile ?? file) : file;
      this.readyLatest = l;
      this.stored.pending = { from: this.d.current, to: l.version, notes: l.notes, file: this.readyFile };
      await this.save();
      this.stage = 'ready';
      this.progress = null;
      this.d.log?.(`Update: Ironleaf ${l.version} is downloaded and checked; it installs on restart.`);
    } catch (err) {
      this.stage = 'idle';
      this.progress = null;
      this.missing = err instanceof MissingRelease;
      this.error = err instanceof Error ? err.message : String(err);
      this.d.log?.('Update download: ' + this.error);
    }
    return this.changed();
  }

  /** The local file this version came from, with its block map, when there is one to build the new file from. */
  private async base(port: InstallPort): Promise<{ file: string; map: BlockMap; mapped: number } | null> {
    if (port.kind === 'appimage' && port.currentFile) {
      const { map, mapped } = await readEmbeddedBlockmap(port.currentFile);
      return { file: port.currentFile, map, mapped };
    }
    if (port.kind === 'nsis' && this.dir) {
      const folder = path.join(this.dir, this.d.current);
      const names = await fsp.readdir(folder).catch(() => [] as string[]);
      const exe = names.find((n) => /\.exe$/i.test(n) && names.includes(n + '.blockmap'));
      if (!exe) return null;
      const map = parseBlockmap(await fsp.readFile(path.join(folder, exe + '.blockmap')), 'gzip');
      const size = (await fsp.stat(path.join(folder, exe))).size;
      return { file: path.join(folder, exe), map, mapped: size };
    }
    return null;
  }

  private async keepBlockmap(ref: BlockmapRef, file: string): Promise<void> {
    const out = file + '.blockmap';
    const existing = await fsp.readFile(out).catch(() => null);
    if (existing && sha256Hex(existing) === ref.sha256) return;
    await fsp.writeFile(out, await this.fetchSmall(ref));
  }

  /** A small release file (a block map), checked against its size and SHA-256. */
  private async fetchSmall(ref: BlockmapRef): Promise<Buffer> {
    const res = await this.d.fetch(assetUrl(ref, this.site), { redirect: 'error', cache: 'no-store' });
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    const bytes = await readCapped(res, Math.min(ref.size, MAX_BLOCKMAP_BYTES));
    verifyDownload(bytes, ref);
    return bytes;
  }

  /** The new file made from the old one: unchanged blocks copied from the local file, changed ones downloaded as
   *  HTTP ranges of the versioned file. False when it would not save anything worth having. */
  private async differential(a: UpdateAsset, l: LatestInfo, base: { file: string; map: BlockMap; mapped: number }, file: string): Promise<boolean> {
    if (!a.versioned) return false;
    const url = assetUrl({ file: a.versioned }, this.site);
    let newMap: BlockMap;
    let mapped: number;
    if (this.d.installer!.kind === 'nsis') {
      if (!a.blockmap) return false;
      newMap = parseBlockmap(await this.fetchSmall(a.blockmap), 'gzip');
      mapped = a.size;
    } else {
      if (!a.blockMapSize) return false;
      mapped = a.size - 4 - a.blockMapSize;
      const tail = await this.fetchRange(url, mapped, a.size);
      if (tail.readUInt32BE(tail.length - 4) !== a.blockMapSize) throw new Error('the block map is not where latest.json says');
      newMap = parseBlockmap(tail.subarray(0, a.blockMapSize), 'deflate');
    }
    const plan = planDifferential(base.map, newMap);
    if (plan.mapped !== mapped) throw new Error('the block map does not cover the file');
    const tailBytes = a.size - mapped;
    const toDownload = plan.download + tailBytes;
    if (toDownload > a.size * 0.8) return false;
    this.d.log?.(`Update: differential download of ${l.version}: ${mb(toDownload)} MB to download, ${mb(plan.copy)} MB from this PC.`);
    this.progress = { received: 0, total: toDownload, differential: true };
    this.changed();
    const src = await fsp.open(base.file, 'r');
    const out = await fsp.open(file, 'w');
    let written = 0;
    try {
      for (const op of plan.ops) {
        if (op.kind === 'copy') {
          const length = op.end - op.start;
          const buf = Buffer.alloc(Math.min(length, 4 * 1024 * 1024));
          for (let done = 0; done < length; ) {
            const n = Math.min(buf.length, length - done);
            const { bytesRead } = await src.read(buf, 0, n, op.start + done);
            if (bytesRead !== n) throw new Error('the local file is shorter than its block map');
            await out.write(buf, 0, n, written);
            written += n;
            done += n;
          }
        } else {
          written += await this.streamRange(url, op.start, op.end, out, written);
        }
      }
      if (tailBytes > 0) written += await this.streamRange(url, mapped, a.size, out, written);
    } finally {
      await src.close();
      await out.close();
    }
    if (written !== a.size) throw new Error('the assembled file is the wrong size');
    return true;
  }

  private async fetchRange(url: string, start: number, end: number): Promise<Buffer> {
    const res = await this.d.fetch(url, { redirect: 'error', cache: 'no-store', headers: { range: `bytes=${start}-${end - 1}` } });
    if (res.status !== 206) throw new Error(`the site did not answer a range (${res.status})`);
    const bytes = await readCapped(res, end - start);
    if (bytes.length !== end - start) throw new Error('a range came back the wrong size');
    return bytes;
  }

  /** One range of the new file written at `at`; the bytes count towards the progress. */
  private async streamRange(url: string, start: number, end: number, out: FileHandle, at: number): Promise<number> {
    const res = await this.d.fetch(url, { redirect: 'error', cache: 'no-store', headers: { range: `bytes=${start}-${end - 1}` } });
    if (res.status !== 206) throw new Error(`the site did not answer a range (${res.status})`);
    const n = await this.pump(res, end - start, async (chunk, offset) => void (await out.write(chunk, 0, chunk.length, at + offset)));
    if (n !== end - start) throw new Error('a range came back the wrong size');
    return n;
  }

  /** The whole file, streamed to disk with its progress. */
  private async fetchToFile(url: string, file: string, size: number): Promise<void> {
    const res = await this.d.fetch(url, { redirect: 'error', cache: 'no-store' });
    if (res.status === 404 || res.status === 410) throw new MissingRelease();
    if (!res.ok) throw new Error(`The download did not start (the site answered ${res.status}).`);
    const out = await fsp.open(file, 'w');
    try {
      const n = await this.pump(res, size, async (chunk, offset) => void (await out.write(chunk, 0, chunk.length, offset)));
      if (n !== size) throw new Error(WRONG_SIZE);
    } finally {
      await out.close();
    }
  }

  /** A response's bytes handed on as they come, at most `limit` of them, with the progress told to the window a
   *  few times a second. A download that stops moving for STALL_MS is given up. */
  private async pump(res: ResponseLike, limit: number, write: (chunk: Uint8Array, offset: number) => Promise<void>): Promise<number> {
    let got = 0;
    const tell = (n: number) => {
      if (this.progress) this.progress = { ...this.progress, received: this.progress.received + n };
      if (Date.now() - this.lastTold > 250) this.changed();
    };
    if (!res.body) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > limit) throw new Error('The download is larger than the release says, so it was not installed.');
      await write(bytes, 0);
      tell(bytes.length);
      return bytes.length;
    }
    const reader = res.body.getReader();
    const stallMs = this.d.stallMs ?? STALL_MS;
    for (;;) {
      let stall: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_r, reject) => {
          stall = setTimeout(() => reject(new Error('The download stopped moving, so it was given up. It is tried again later.')), stallMs);
        }),
      ]).finally(() => clearTimeout(stall));
      if (next.done) break;
      const chunk = next.value ?? new Uint8Array(0);
      if (got + chunk.length > limit) {
        await reader.cancel?.().catch(() => {});
        throw new Error('The download is larger than the release says, so it was not installed.');
      }
      await write(chunk, got);
      got += chunk.length;
      tell(chunk.length);
    }
    return got;
  }

  /** "Restart to update": the ready update is handed over (Windows: the helper installs it once this app has
   *  quit, then starts the new one; Linux: the new AppImage is started). */
  async install(): Promise<UpdateState> {
    await this.load();
    const r = this.ready();
    if (!r) return this.view();
    this.stage = 'installing';
    this.error = null;
    this.changed();
    try {
      await this.d.installer!.restart(r.file, r.latest);
    } catch (err) {
      this.stage = 'ready';
      this.missing = false;
      this.error = 'Ironleaf could not restart to update: ' + (err instanceof Error ? err.message : String(err));
      this.d.log?.(this.error);
    }
    return this.changed();
  }

  /** The first check a little after the start, then one a day. Nothing here is awaited by the start. */
  start(): void {
    if (this.timer) return;
    this.first = setTimeout(() => void this.check(), FIRST_CHECK_AFTER_MS);
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.first.unref?.();
    this.timer.unref?.();
    // The notice of an update that just landed (or did not) shows without waiting for the first check.
    void this.load().then(() => this.changed());
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }
}

/** The IPC names (their own prefix: nothing else in the app uses it). The preload side is src/preload/update-check.ts. */
export const UPDATE_CHANNELS = {
  state: 'nvupdate:state',
  check: 'nvupdate:check',
  setEnabled: 'nvupdate:set-enabled',
  setAutoDownload: 'nvupdate:set-auto-download',
  dismiss: 'nvupdate:dismiss',
  dismissNotice: 'nvupdate:dismiss-notice',
  download: 'nvupdate:download',
  install: 'nvupdate:install',
  openPage: 'nvupdate:open-page',
  changed: 'nvupdate:changed',
} as const;

let running: UpdateChecker | null = null;

/** For the tray's Check for updates: the newer version, or null (also null before the checker has started). */
export async function checkForUpdate(): Promise<{ version: string } | null> {
  if (!running) return null;
  const state = await running.check(true);
  return state.available ? { version: state.available.version } : null;
}

/** The site this copy reads. An installed Ironleaf only ever reads its own (or its organisation's, by managed
 *  policy); a development build may read a stand-in on this PC (NV_UPDATE_ORIGIN=http://127.0.0.1:port, the checks).
 *  The old --nv-update-test-origin switch does nothing in an installed copy. */
export function updateOrigin(o: { packaged: boolean; argv: readonly string[]; env: Record<string, string | undefined> }): string | undefined {
  const want = o.env.NV_UPDATE_ORIGIN ?? '';
  if (!o.packaged && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(want)) return want;
  // An installed copy reads only its own site (or the organisation's, by managed policy): no switch or variable moves it.
  void TEST_ORIGIN_FLAG;
  return undefined;
}

/** The one call src/main/index.ts makes (any time; it waits for the app to be ready by itself and never throws). */
export function startUpdateCheck(managed?: ManagedUpdates): void {
  if (running) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    const { app, ipcMain, shell, net, BrowserWindow } = electron;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    void app.whenReady().then(() => {
      if (running) return;
      const stateFile = path.join(app.getPath('userData'), 'update-check.json');
      const updateDir = path.join(app.getPath('userData'), 'updates');
      const dev = updateOrigin({ packaged: app.isPackaged, argv: process.argv, env: process.env });
      const log = (words: string) => console.error(words);

      // Windows sign-out or shutdown: never start an installer then.
      let sessionEnding = false;
      app.on('browser-window-created', (_e, w) => {
        const ending = () => (sessionEnding = true);
        (w as unknown as { on(e: string, fn: () => void): void }).on('query-session-end', ending);
        (w as unknown as { on(e: string, fn: () => void): void }).on('session-end', ending);
      });

      let installer: InstallPort | undefined;
      let restartArmed = false;
      if (process.platform === 'win32' && app.isPackaged) {
        const installDir = path.dirname(process.execPath);
        installer = {
          kind: 'nsis',
          blocked: () => {
            // An NSIS install has its uninstaller beside the program; a copy unpacked anywhere else does not.
            const names = fs.readdirSync(installDir);
            return names.some((n) => /^Uninstall .+\.exe$/i.test(n)) ? null : 'This copy of Ironleaf was not installed by its installer, so updates come from the website.';
          },
          stage: async () => {},
          restart: () => {
            restartArmed = true;
            // The normal quit: every window saves first, the tray lets go (a quit is under way), then 'quit' below.
            setImmediate(() => app.quit());
          },
        };
      } else if (process.platform === 'linux' && app.isPackaged && runningAppImage()) {
        // Only the AppImage this copy provably runs from (never an APPIMAGE merely inherited from the environment).
        const target = runningAppImage()!;
        installer = {
          kind: 'appimage',
          currentFile: target,
          blocked: () => {
            try {
              if (!fs.statSync(target).isFile()) return 'Ironleaf is not running from an AppImage, so updates come from the website.';
              fs.accessSync(target, fs.constants.W_OK);
              fs.accessSync(path.dirname(target), fs.constants.W_OK);
              return null;
            } catch {
              return 'Ironleaf may not replace its AppImage in this folder, so updates come from the website.';
            }
          },
          target: (version) => appImagePart(target, version),
          stage: (file) => replaceAppImage(file, target),
          restart: () => {
            restartArmed = true;
            setImmediate(() => app.quit());
          },
        };
      } else if (!app.isPackaged && dev && process.env.NV_UPDATE_STUB_INSTALL === '1') {
        // A development build given a stand-in site and this switch (the About page's screenshots): the update is
        // downloaded and checked for real, then nothing is replaced and nothing restarts.
        installer = { kind: 'appimage', blocked: () => null, stage: async () => {}, restart: () => log('Update (stand-in): a development build does not restart.') };
      }

      const checker = new UpdateChecker({
        current: app.getVersion(),
        platform: process.platform,
        fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' } as RequestInit) as unknown as ReturnType<FetchLike>,
        readState: () => fsp.readFile(stateFile, 'utf8').catch(() => null),
        writeState: async (text) => {
          await fsp.mkdir(path.dirname(stateFile), { recursive: true });
          await fsp.writeFile(stateFile + '.tmp', text);
          await fsp.rename(stateFile + '.tmp', stateFile);
        },
        openExternal: (url) => shell.openExternal(url),
        updateDir,
        ...(installer ? { installer } : {}),
        onChange: (state) => {
          for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(UPDATE_CHANNELS.changed, state);
        },
        ...(dev ? { origin: dev, latestUrl: `${dev}/download/latest.json` } : {}),
        // The organisation's update server or channel wins over everything (managed policy).
        ...(managed?.latestUrl ? { origin: managed.origin ?? UPDATE_ORIGIN, origins: [managed.origin ?? UPDATE_ORIGIN], latestUrl: managed.latestUrl } : {}),
        ...(managed ? { managed: { disabled: managed.disabled, words: managed.words } } : {}),
        log,
      });
      running = checker;

      // Windows: the helper starts as this app quits — after "Restart to update" (and it starts the new version),
      // or on any ordinary quit with an update ready (installed quietly; nothing starts). Never at sign-out.
      if (installer?.kind === 'nsis') {
        app.on('quit', () => {
          const r = checker.ready();
          if (!r || (sessionEnding && !restartArmed)) return;
          try {
            // The installer is read once more right before the helper that runs it starts: changed since it was
            // checked (another program, a swapped file), it is never handed over.
            const asset = assetFor(r.latest, 'win32');
            if (!asset || !installerUnchanged(r.file, asset)) {
              log('Update: the downloaded installer is not the file that was checked, so it was not run.');
              fs.rmSync(r.file, { force: true });
              return;
            }
            const helper = path.join(path.dirname(r.file), 'install-update.ps1');
            const script = windowsHelperScript({
              pid: process.pid,
              setup: r.file,
              installDir: path.dirname(process.execPath),
              // The program the new version installs: Ironleaf.exe (an install from before the rename may still be
              // running as its NeuralVault.exe, which the installer keeps as a link to Ironleaf.exe).
              exe: /^neuralvault\.exe$/i.test(path.basename(process.execPath)) ? path.join(path.dirname(process.execPath), 'Ironleaf.exe') : process.execPath,
              to: r.latest.version,
              from: app.getVersion(),
              result: path.join(updateDir, 'update-result.json'),
              log: path.join(updateDir, 'update.log'),
              relaunch: restartArmed,
              args: relaunchArgs(process.argv.slice(1), false),
              sha256: asset.sha256,
            });
            fs.writeFileSync(helper, '\uFEFF' + script, 'utf8');
            fs.rmSync(path.join(updateDir, 'update-result.json'), { force: true });
            const c = helperCommand(process.env.SystemRoot ?? 'C:\\Windows', process.env.ComSpec, helper);
            spawn(c.file, c.args, { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: updateDir }).unref();
          } catch (err) {
            log('Update: the installer could not be handed over: ' + (err instanceof Error ? err.message : String(err)));
          }
        });
      }

      // Linux: the new AppImage (already in place) starts once this one has gone (not app.relaunch: its relauncher
      // runs from inside the old AppImage's mount).
      if (installer?.kind === 'appimage') {
        app.on('quit', () => {
          const appImage = installer?.currentFile;
          if (!restartArmed || !appImage) return;
          try {
            const r = appImageRelaunch({ pid: process.pid, appImage, args: relaunchArgs(process.argv.slice(1), true), env: process.env, bash: fs.existsSync('/bin/bash') });
            spawn(r.file, r.args, { detached: true, stdio: 'ignore', env: r.env, cwd: path.dirname(appImage), windowsHide: true }).unref();
            log(`Update: ${appImage} starts again once this Ironleaf has quit.`);
          } catch (err) {
            log('Update: Ironleaf could not start again: ' + (err instanceof Error ? err.message : String(err)));
          }
        });
      }

      ipcMain.handle(UPDATE_CHANNELS.state, () => checker.state());
      ipcMain.handle(UPDATE_CHANNELS.check, () => checker.check(true));
      ipcMain.handle(UPDATE_CHANNELS.setEnabled, (_e, on: unknown) => checker.setEnabled(on === true));
      ipcMain.handle(UPDATE_CHANNELS.setAutoDownload, (_e, on: unknown) => checker.setAutoDownload(on === true));
      ipcMain.handle(UPDATE_CHANNELS.dismiss, () => checker.dismiss());
      ipcMain.handle(UPDATE_CHANNELS.dismissNotice, () => checker.dismissNotice());
      ipcMain.handle(UPDATE_CHANNELS.download, () => checker.download());
      ipcMain.handle(UPDATE_CHANNELS.install, () => checker.install());
      ipcMain.handle(UPDATE_CHANNELS.openPage, () => checker.openDownloadPage());
      // A development build (the checks, the screenshots) only looks when it was given a stand-in to look at.
      if (app.isPackaged || dev) checker.start();
      app.on('will-quit', () => checker.stop());
    });
  } catch (err) {
    console.error('Update check:', err instanceof Error ? err.message : err);
  }
}
