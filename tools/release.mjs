// node tools/release.mjs [--fast] [--linux-only|--win-only] [--max] [--no-smoke] [--notes "..."] [--publish|--publish-only]
// (npm run release -- <flags>) — the one-command release: from a clean commit to installers ready to publish.
//
//   typecheck (skipped by --fast) → build → stage (the app folder that ships: the build, resources, the production
//   packages only) → package (Linux AppImage and Windows x64 NSIS installer, side by side) → name, measure and
//   describe (sizes, SHA-256, latest.json, versions.json, the notes file) → all in dist/release/.
//
// electron-builder lives OUTSIDE this repo (NV_BUILDTOOLS, default ~/.ironleaf-buildtools; versions pinned in its
// package.json), so the app's lockfile and node_modules are never touched. Everything about releasing is written
// down in docs/RELEASING.md.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimOrtCommon, trimOrtDist } from './ort-ship.mjs';
import { changelogNotes, historyModule, writeVersions } from './release-versions.mjs';
import { embeddedUpdateKey, signLatest, signingKeyFromEnv, verifyLatest } from './update-sign.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const fail = (words) => { console.error('release: ' + words); process.exit(1); };

const KNOWN = ['--fast', '--linux-only', '--win-only', '--max', '--no-smoke', '--win-smoke', '--notes', '--publish', '--publish-only', '--version', '--test-identity', '--help'];
for (const a of argv) if (a.startsWith('--') && !KNOWN.includes(a)) fail(`unknown flag ${a} (see docs/RELEASING.md).`);
if (has('--help')) {
  console.log('node tools/release.mjs [--fast] [--linux-only|--win-only] [--max] [--no-smoke] [--notes "..."] [--publish|--publish-only]\nSee docs/RELEASING.md.');
  process.exit(0);
}
if (has('--linux-only') && has('--win-only')) fail('--linux-only and --win-only together leave nothing to build.');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
// --version x.y.z builds that version without touching package.json (the update tests build two versions side by
// side); never with --publish, so the website only ever gets the committed version.
const version = value('--version') ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version ${version} is not x.y.z.`);
if (value('--version') && (has('--publish') || has('--publish-only'))) fail('--version is for test builds: it cannot be published.');
// --test-identity: the same app installed under another name and installer id ("Ironleaf Update Test", no
// shortcuts, no ironleaf:// entry), so a test install on a PC that has the real Ironleaf never touches it
// (docs/RELEASING.md, "Testing an update end to end"). Never published.
const testIdentity = has('--test-identity');
if (testIdentity && (has('--publish') || has('--publish-only'))) fail('--test-identity builds cannot be published.');
// A test build (--version or --test-identity) is never signed and is marked unpublishable in dist/release, so a
// later --publish-only cannot put it on the website even when the release key happens to be in the environment.
const testBuild = Boolean(value('--version')) || testIdentity;
const UNPUBLISHABLE = '.unpublishable';
const wantLinux = !has('--win-only');
const wantWin = !has('--linux-only');
const notes = value('--notes') ?? '';

const buildTools = process.env.NV_BUILDTOOLS || path.join(homedir(), '.ironleaf-buildtools');
const builderCli = path.join(buildTools, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
// NV_RELEASE_DIR: another folder in place of dist/release (the publish checks use a scratch one).
const releaseDir = process.env.NV_RELEASE_DIR || path.join(root, 'dist', 'release');
const workDir = path.join(root, 'dist', 'release-work');
const stageDir = path.join(workDir, 'app');
// The release site (the one place it is named for releasing; the app's own is UPDATE_ORIGIN in src/main/update-check.ts).
const SITE = process.env.NV_SITE || 'https://ironleaf.kaitiaki-it.com';
// Where --publish puts the files: NV_DOWNLOAD_DIR, the web server's download folder(s) on this machine (several split
// by ':'; a folder that is not there is skipped with a word, none there stops the publish). Required to publish.
const downloadDirs = (process.env.NV_DOWNLOAD_DIR ?? '').split(':').filter(Boolean);
// NV_PUBLISH_CHECKOUT: the checkout publish checks against (its package.json version, a clean git tree, the update
// key it embeds for latest.json.sig; the publish checks use a scratch one holding a throwaway key); this repository
// otherwise.
const checkout = process.env.NV_PUBLISH_CHECKOUT || root;

// The names the website serves (its /download/latest.json names them), and the versioned copies kept beside them.
const NAMES = {
  linux: { file: 'Ironleaf.AppImage', versioned: `Ironleaf-${version}.AppImage` },
  windows: { file: 'Ironleaf-Setup.exe', versioned: `Ironleaf-Setup-${version}.exe` },
};
const WIN_ZIP = `Ironleaf-${version}-win-x64.zip`;
const NOTES_FILE = `Ironleaf-${version}.notes.txt`;

const timings = [];
const seconds = (ms) => (ms / 1000).toFixed(1) + ' s';
async function step(name, fn) {
  const started = Date.now();
  process.stdout.write(`release: ${name}…\n`);
  const result = await fn();
  const ms = Date.now() - started;
  timings.push([name, ms]);
  console.log(`release: ${name} done in ${seconds(ms)}`);
  return result;
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childEnv = () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
function run(file, args, opts = {}) {
  const r = spawnSync(file, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: childEnv(), shell: process.platform === 'win32' && /\.cmd$/.test(file), ...opts });
  if (r.status !== 0) fail(`${path.basename(file)} ${args.slice(0, 3).join(' ')} stopped with exit code ${r.status ?? r.signal}.`);
}
/** A child whose output is kept quiet unless it fails (two packagers run at once: their lines would interleave). */
function runQuiet(file, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(), ...opts });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ ok: false, out: out + String(err) }));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}
const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});
const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
/** The size of the block map electron-builder appends to an AppImage (raw deflate, then its length as 4 big-endian
 *  bytes), or 0 when the file does not end with one. */
function embeddedBlockMapSize(file) {
  try {
    const size = statSync(file).size;
    const fd = openSync(file, 'r');
    const tail = Buffer.alloc(4);
    readSync(fd, tail, 0, 4, size - 4);
    const length = tail.readUInt32BE(0);
    if (!length || length > 16 * 1024 * 1024 || length >= size - 4) return closeSync(fd), 0;
    const body = Buffer.alloc(length);
    readSync(fd, body, 0, length, size - 4 - length);
    closeSync(fd);
    const map = JSON.parse(inflateRawSync(body).toString('utf8'));
    return map?.version === '2' && Array.isArray(map.files) ? length : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stage: the app folder that ships (what tools/pack-win.mjs put in resources/app): the build without source maps,
// resources/, the clipper extension, the extra capture child beside its library, and the production packages only.
/** package.json's dependencies that the built main side names (a quoted 'name' or 'name/…' anywhere in out/main:
 *  require, import() and the lazy req() alike). The window's libraries are bundled into out/renderer by the build,
 *  so a dependency only the window uses (echarts, 62 MB installed) is not shipped a second time as a folder. */
function shippedDependencies() {
  const mainDir = path.join(root, 'out', 'main');
  const code = readdirSync(mainDir, { recursive: true }).filter((f) => /\.(c|m)?js$/.test(String(f))).map((f) => readFileSync(path.join(mainDir, String(f)), 'utf8')).join('\n');
  return Object.keys(pkg.dependencies ?? {}).filter((dep) => new RegExp(`["'\`]${dep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(/[^"'\`\\s]*)?["'\`]`).test(code));
}

function productionPackages() {
  // The packages package.json's dependencies reach, found the way Node finds them (nearest node_modules upward).
  const found = new Map(); // real folder → path under node_modules as installed
  const nodeModules = realpathSync(path.join(root, 'node_modules'));
  const visit = (name, fromDir, optional) => {
    let dir = fromDir;
    for (;;) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) {
        const real = realpathSync(candidate);
        if (found.has(real)) return;
        const rel = path.relative(nodeModules, real);
        if (rel.startsWith('..')) fail(`${name} resolves outside node_modules (${real}).`);
        found.set(real, rel);
        const meta = JSON.parse(readFileSync(path.join(real, 'package.json'), 'utf8'));
        for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep, real, false);
        for (const dep of Object.keys(meta.optionalDependencies ?? {})) visit(dep, real, true);
        return;
      }
      const up = path.dirname(dir);
      if (up === dir || !dir.startsWith(nodeModules)) break;
      dir = up === nodeModules ? path.dirname(nodeModules) : up;
    }
    if (!optional) fail(`${name} is not installed in node_modules.`);
  };
  for (const dep of shippedDependencies()) visit(dep, path.dirname(nodeModules), false);
  return found;
}

function stage() {
  if (!existsSync(path.join(root, 'out', 'main', 'index.js'))) fail('the app is not built (out/main/index.js is missing).');
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(
    path.join(stageDir, 'package.json'),
    JSON.stringify({ name: pkg.name, productName: 'Ironleaf', version, description: 'Ironleaf: plain Markdown notes with links, a graph and canvases.', homepage: SITE, author: { name: 'Kaitiaki IT Pty Ltd', email: 'support@kaitiaki-it.com' }, license: pkg.license, main: pkg.main, dependencies: Object.fromEntries(shippedDependencies().map((d) => [d, pkg.dependencies[d]])) }, null, 2) + '\n',
  );
  cpSync(path.join(root, 'out'), path.join(stageDir, 'out'), { recursive: true, filter: (src) => !src.endsWith('.map') });
  cpSync(path.join(root, 'resources'), path.join(stageDir, 'resources'), { recursive: true });
  if (existsSync(path.join(root, 'extensions', 'clipper'))) cpSync(path.join(root, 'extensions', 'clipper'), path.join(stageDir, 'extensions', 'clipper'), { recursive: true });
  if (existsSync(path.join(root, 'src', 'main', 'extra-loopback-child.cjs')) && existsSync(path.join(root, 'vendor', 'native-recorder-nodejs'))) {
    cpSync(path.join(root, 'src', 'main', 'extra-loopback-child.cjs'), path.join(stageDir, 'extra-loopback', 'child.cjs'));
    cpSync(path.join(root, 'vendor', 'native-recorder-nodejs'), path.join(stageDir, 'extra-loopback', 'vendor', 'native-recorder-nodejs'), { recursive: true });
  }
  const packages = productionPackages();
  for (const [real, rel] of packages) {
    cpSync(real, path.join(stageDir, 'node_modules', rel), { recursive: true, dereference: true, filter: (src) => !path.relative(real, src).split(path.sep).includes('node_modules') });
  }
  // The meaning runner ships trimmed (tools/ort-ship.mjs: its one WASM build, its shared package's plain scripts).
  const ortDist = path.join(stageDir, 'node_modules', 'onnxruntime-web', 'dist');
  if (existsSync(ortDist)) {
    trimOrtDist(ortDist);
    trimOrtCommon(path.join(stageDir, 'node_modules', 'onnxruntime-common'));
  }
  // What must be there, or the release stops here rather than shipping a feature that silently falls back.
  const must = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'resources/icon.png', 'resources/icon.ico'];
  for (const worker of ['speaker-worker.cjs', 'meaning-worker.cjs']) if (existsSync(path.join(root, 'tools', `build-${worker.replace('-worker.cjs', '')}-worker.mjs`))) must.push(`out/main/${worker}`);
  for (const rel of must) if (!existsSync(path.join(stageDir, rel))) fail(`${rel} is missing from the staged app.`);
  return packages.size;
}

// ---------------------------------------------------------------------------------------------------------------
// Package: electron-builder from the tools folder, one process per platform (they run side by side).
function builderConfig(platform) {
  const base = JSON.parse(readFileSync(path.join(root, 'build-standalone', 'electron-builder.json'), 'utf8'));
  const at = (rel) => path.resolve(root, 'build-standalone', rel);
  const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const config = {
    ...base,
    electronVersion,
    buildVersion: `${version}.0`,
    directories: { output: path.join(workDir, platform), buildResources: at('build') },
    compression: has('--max') ? 'maximum' : base.compression ?? 'normal',
    afterPack: path.join(root, 'tools', 'release-after-pack.cjs'),
    linux: { ...base.linux, icon: at(base.linux.icon) },
    win: { ...base.win, icon: at(base.win.icon) },
    nsis: { ...base.nsis },
  };
  if (testIdentity) {
    Object.assign(config, { appId: 'com.kaitiaki.neuralvault.updatetest', productName: 'Ironleaf Update Test', protocols: [] });
    Object.assign(config.nsis, { guid: 'c0f1e7a2-5b0d-4c55-9a3e-7d1b2c9e4f10', shortcutName: 'Ironleaf Update Test', uninstallDisplayName: 'Ironleaf Update Test', createDesktopShortcut: false, createStartMenuShortcut: false, artifactName: 'Ironleaf-Setup-${version}.exe' });
  }
  for (const key of ['installerIcon', 'uninstallerIcon', 'installerSidebar', 'uninstallerSidebar', 'include']) if (config.nsis[key]) config.nsis[key] = at(config.nsis[key]);
  // Linux: this machine's own Electron (node_modules/electron/dist) is the runtime, so nothing is downloaded. The
  // Windows runtime is downloaded once into the tools folder's cache and reused.
  const localRuntime = path.join(root, 'node_modules', 'electron', 'dist');
  if (platform === 'linux' && process.platform === 'linux' && existsSync(path.join(localRuntime, 'electron'))) config.electronDist = localRuntime;
  const file = path.join(workDir, `builder-${platform}.json`);
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}
/** Windows on Linux without Wine: a `wine` first on PATH that hands the one step electron-builder wants Wine for
 *  (writing the uninstaller) to tools/release-uninstaller.cjs. NV_REAL_WINE=1 leaves the real Wine in charge. */
function wineStandIn() {
  if (process.platform !== 'linux' || process.env.NV_REAL_WINE === '1') return null;
  const dir = path.join(workDir, 'shims');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'wine'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, 'tools', 'release-uninstaller.cjs')}" "$@"\n`, { mode: 0o755 });
  return dir;
}
const builderEnv = (extraPath) => ({
  ...childEnv(),
  ...(extraPath ? { PATH: extraPath + path.delimiter + process.env.PATH, USE_SYSTEM_WINE: 'true' } : {}),
  ELECTRON_BUILDER_CACHE: path.join(buildTools, 'cache', 'electron-builder'),
  ELECTRON_CACHE: path.join(buildTools, 'cache', 'electron'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  // Speed over size for ordinary releases: the installer's 7z at level 3 rather than electron-builder's 9 (which
  // alone took over two minutes here). --max leaves the level at 9. NV_COMPRESSION_LEVEL=0..9 picks another.
  ...(has('--max') ? {} : { ELECTRON_BUILDER_COMPRESSION_LEVEL: /^[0-9]$/.test(process.env.NV_COMPRESSION_LEVEL ?? '') ? process.env.NV_COMPRESSION_LEVEL : '3' }),
  NV_BUILDTOOLS: buildTools,
  NV_RELEASE_ICON: path.join(root, 'resources', 'icon.ico'),
});

async function packageLinux() {
  const started = Date.now();
  const config = builderConfig('linux');
  rmSync(path.join(workDir, 'linux'), { recursive: true, force: true });
  const r = await runQuiet(process.execPath, [builderCli, '--projectDir', stageDir, '--config', config, '--linux', 'AppImage', '--x64', '--publish', 'never'], { env: builderEnv() });
  const built = path.join(workDir, 'linux', NAMES.linux.versioned);
  if (!r.ok || !existsSync(built)) return { ok: false, ms: Date.now() - started, words: 'Linux AppImage failed:\n' + r.out.trim().split('\n').slice(-25).join('\n') };
  return { ok: true, ms: Date.now() - started, kind: 'AppImage', built };
}

/** Windows, the first way that works:
 *  (1) when NV_WIN_BUILDER names a Windows PC (an ssh host), the installer is built there: the staged app goes
 *      over, electron-builder runs on Windows itself, the .exe comes back;
 *  (2) NSIS on this machine (the default): electron-builder's own makensis for this OS; the exe's icon and version
 *      are stamped in pure JavaScript by tools/release-after-pack.cjs, and the one step that would want Wine,
 *      writing the uninstaller, by tools/release-uninstaller.cjs;
 *  (3) a portable zip of the unpacked app, when no installer could be built. latest.json says so (kind). */
async function packageWindows() {
  const started = Date.now();
  const config = builderConfig('win');
  rmSync(path.join(workDir, 'win'), { recursive: true, force: true });
  mkdirSync(path.join(workDir, 'win'), { recursive: true });
  const built = path.join(workDir, 'win', NAMES.windows.versioned);
  const host = process.env.NV_WIN_BUILDER;
  if (host) {
    const remote = await remoteWindowsBuild(host, config, built);
    if (remote.ok) return { ok: true, ms: Date.now() - started, kind: `nsis, built on ${host}: ${remote.words}`, built };
    console.error(`release: the Windows builder ${host} did not finish (${remote.words}); building the installer here instead.`);
  }
  const local = await runQuiet(process.execPath, [builderCli, '--projectDir', stageDir, '--config', config, '--win', 'nsis', '--x64', '--publish', 'never'], { env: builderEnv(wineStandIn()) });
  if (local.ok && existsSync(built)) return { ok: true, ms: Date.now() - started, kind: 'nsis', built };
  console.error('release: the Windows installer did not build on this machine:\n' + local.out.trim().split('\n').slice(-25).join('\n'));
  // The portable zip: the unpacked app (win-unpacked) zipped. No installer, no Start menu entry, no in-place upgrade.
  const unpacked = path.join(workDir, 'win', 'win-unpacked');
  if (!existsSync(path.join(unpacked, 'Ironleaf.exe'))) {
    const dir = await runQuiet(process.execPath, [builderCli, '--projectDir', stageDir, '--config', config, '--win', 'dir', '--x64', '--publish', 'never'], { env: builderEnv() });
    if (!dir.ok || !existsSync(path.join(unpacked, 'Ironleaf.exe'))) return { ok: false, ms: Date.now() - started, words: 'Windows failed (installer and portable folder):\n' + dir.out.trim().split('\n').slice(-25).join('\n') };
  }
  const zip = path.join(workDir, 'win', WIN_ZIP);
  rmSync(zip, { force: true });
  const sevenZip = [path.join(buildTools, 'node_modules', '7zip-bin', 'linux', 'x64', '7za'), '/usr/bin/7za', '/usr/bin/7z'].find((p) => existsSync(p)) ?? '7z';
  const zipped = await runQuiet(sevenZip, ['a', '-tzip', '-bd', has('--max') ? '-mx=9' : '-mx=3', zip, '.'], { cwd: unpacked });
  if (!zipped.ok) return { ok: false, ms: Date.now() - started, words: 'Windows portable zip failed: ' + zipped.out.trim() };
  return { ok: true, ms: Date.now() - started, kind: 'portable zip', built: zip };
}

// The Windows builder (docs/RELEASING.md): everything it holds is under one folder, C:\nv-build (NV_WIN_BUILD_DIR):
// tools\ (electron-builder, installed once from the tools folder's own lockfile), cache\, npm-cache\, job\ (this
// release) and smoke\. Nothing is installed on the PC beyond that folder and nothing keeps running after a build.
const winDir = (process.env.NV_WIN_BUILD_DIR || 'C:\\nv-build').replace(/[\\/]+$/, '');
const winScp = (file) => `${winDir.replace(/\\/g, '/')}/${file}`;
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'LogLevel=ERROR'];
const ssh = (host, command) => runQuiet('ssh', [...sshArgs, host, command]);
const scp = (from, to) => runQuiet('scp', [...sshArgs, '-q', from, to]);

async function remoteWindowsBuild(host, configFile, back) {
  const t0 = Date.now();
  const made = await ssh(host, `cmd /c "if not exist ${winDir} mkdir ${winDir}"`);
  if (!made.ok) return { ok: false, words: 'no answer over SSH' };
  // The job: the staged app, the installer's resources, the hook, the config with the builder's own paths, and
  // the tools folder's package.json and lockfile (so the builder runs exactly the versions pinned here).
  const job = path.join(workDir, 'win-job');
  rmSync(job, { recursive: true, force: true });
  mkdirSync(job, { recursive: true });
  const there = (...parts) => [winDir, 'job', ...parts].join('\\');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const remoteConfig = { ...config, directories: { output: there('out'), buildResources: there('build') }, afterPack: there('release-after-pack.cjs'), win: { ...config.win, icon: there('build', 'icon.ico') }, nsis: { ...config.nsis } };
  delete remoteConfig.linux;
  delete remoteConfig.electronDist;
  for (const key of ['installerIcon', 'uninstallerIcon', 'installerSidebar', 'uninstallerSidebar', 'include']) if (remoteConfig.nsis[key]) remoteConfig.nsis[key] = there('build', path.basename(remoteConfig.nsis[key]));
  writeFileSync(path.join(job, 'builder.json'), JSON.stringify(remoteConfig, null, 2));
  cpSync(path.join(root, 'build-standalone', 'build'), path.join(job, 'build'), { recursive: true });
  cpSync(path.join(root, 'tools', 'release-after-pack.cjs'), path.join(job, 'release-after-pack.cjs'));
  cpSync(path.join(root, 'resources', 'icon.ico'), path.join(job, 'icon.ico'));
  cpSync(path.join(buildTools, 'package.json'), path.join(job, 'tools-package.json'));
  if (existsSync(path.join(buildTools, 'package-lock.json'))) cpSync(path.join(buildTools, 'package-lock.json'), path.join(job, 'tools-package-lock.json'));
  const level = has('--max') ? '' : builderEnv().ELECTRON_BUILDER_COMPRESSION_LEVEL;
  writeFileSync(
    path.join(job, 'build.cmd'),
    [
      '@echo off',
      'setlocal',
      'set "PATH=C:\\Program Files\\nodejs;%PATH%"',
      `set "NV_BUILDTOOLS=${winDir}\\tools"`,
      `set "npm_config_cache=${winDir}\\npm-cache"`,
      `set "ELECTRON_BUILDER_CACHE=${winDir}\\cache\\electron-builder"`,
      `set "ELECTRON_CACHE=${winDir}\\cache\\electron"`,
      'set "CSC_IDENTITY_AUTO_DISCOVERY=false"',
      'set "npm_config_update_notifier=false"',
      `set "NV_RELEASE_ICON=${there('icon.ico')}"`,
      ...(level ? [`set "ELECTRON_BUILDER_COMPRESSION_LEVEL=${level}"`] : []),
      'if not exist "%NV_BUILDTOOLS%" mkdir "%NV_BUILDTOOLS%"',
      // The tools are installed once, and again only when the pinned versions change.
      `fc /b "${there('tools-package.json')}" "%NV_BUILDTOOLS%\\package.json" >nul 2>&1`,
      'if not errorlevel 1 if exist "%NV_BUILDTOOLS%\\node_modules\\electron-builder\\out\\cli\\cli.js" goto build',
      `copy /y "${there('tools-package.json')}" "%NV_BUILDTOOLS%\\package.json" >nul`,
      `if exist "${there('tools-package-lock.json')}" copy /y "${there('tools-package-lock.json')}" "%NV_BUILDTOOLS%\\package-lock.json" >nul`,
      'pushd "%NV_BUILDTOOLS%"',
      'call npm ci --no-audit --no-fund --loglevel=error',
      'if errorlevel 1 exit /b 11',
      'popd',
      ':build',
      `node "%NV_BUILDTOOLS%\\node_modules\\electron-builder\\out\\cli\\cli.js" --projectDir "${there('app')}" --config "${there('builder.json')}" --win nsis --x64 --publish never`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n'),
  );
  // One archive over the wire: stored, not compressed (the models and the build's files barely shrink, and the
  // link is faster than gzip on four cores).
  const tar = path.join(workDir, 'win-job.tar');
  const packed = await runQuiet('tar', ['-cf', tar, '-C', job, '.', '-C', path.dirname(stageDir), path.basename(stageDir)]);
  if (!packed.ok) return { ok: false, words: 'could not pack the staged app' };
  const sent = await scp(tar, `${host}:${winScp('job.tar')}`);
  if (!sent.ok) return { ok: false, words: 'could not copy the staged app over: ' + sent.out.trim().split('\n').pop() };
  const t1 = Date.now();
  const ran = await ssh(host, `cmd /c "cd /d ${winDir} && (if exist job rmdir /s /q job) && mkdir job && tar -xf job.tar -C job && del job.tar && call job\\build.cmd"`);
  if (!ran.ok) return { ok: false, words: 'the build there stopped:\n' + ran.out.trim().split('\n').slice(-15).join('\n') };
  const t2 = Date.now();
  const fetched = await scp(`${host}:${winScp(`job/out/${NAMES.windows.versioned}`)}`, back);
  if (!fetched.ok || !existsSync(back)) return { ok: false, words: 'the installer was built but could not be copied back' };
  // Its block map (the differential update's index), when the builder made one.
  await scp(`${host}:${winScp(`job/out/${NAMES.windows.versioned}.blockmap`)}`, back + '.blockmap');
  // The job folder goes (the tools and caches stay for next time).
  await ssh(host, `cmd /c "cd /d ${winDir} && rmdir /s /q job"`);
  return { ok: true, words: `send ${seconds(t1 - t0)}, build ${seconds(t2 - t1)}, fetch ${seconds(Date.now() - t2)}` };
}

/** --win-smoke: the installer in dist/release/ installed for real on the Windows builder, started, checked, stopped
 *  and uninstalled (tools/release-win-smoke.ps1 says exactly what it does and what it puts back). */
async function windowsSmoke() {
  const host = process.env.NV_WIN_BUILDER;
  if (!host) fail('--win-smoke needs NV_WIN_BUILDER (the Windows PC, as ssh reaches it).');
  const setup = path.join(releaseDir, NAMES.windows.file);
  if (!existsSync(setup)) fail(`dist/release/${NAMES.windows.file} is missing: build first.`);
  const made = await ssh(host, `cmd /c "if not exist ${winDir}\\smoke mkdir ${winDir}\\smoke"`);
  if (!made.ok) fail(`no answer from ${host} over SSH.`);
  for (const [from, name] of [[setup, NAMES.windows.file], [path.join(root, 'tools', 'release-win-smoke.ps1'), 'smoke.ps1']]) {
    const sent = await scp(from, `${host}:${winScp('smoke/' + name)}`);
    if (!sent.ok) fail(`could not copy ${name} to ${host}.`);
  }
  const ran = await ssh(host, `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${winDir}\\smoke\\smoke.ps1 -Setup ${winDir}\\smoke\\${NAMES.windows.file} -Work ${winDir}\\smoke`);
  await ssh(host, `cmd /c "del /q ${winDir}\\smoke\\smoke.ps1 2>nul & rmdir ${winDir}\\smoke 2>nul"`);
  const json = ran.out.slice(ran.out.indexOf('{'), ran.out.lastIndexOf('}') + 1);
  let result = null;
  try {
    result = JSON.parse(json);
  } catch {}
  if (!result) fail('the smoke test gave no answer:\n' + ran.out.trim().split('\n').slice(-15).join('\n'));
  console.log(`release: Windows smoke on ${host}: sha256 ${await sha256File(setup)}`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) fail('the Windows smoke test did not pass.');
}

// ---------------------------------------------------------------------------------------------------------------
// Publish: into the website's download folder, each file under a temporary name first and then renamed in place
// (so a download never sees half a file), latest.json last (so it never names a file that is not there yet).
// versions.json (the version history, tools/release-versions.mjs) goes just before latest.json: the folder's own list
// with this release added, so each publish appends and nothing earlier is lost.
// Only the committed version is published: never a test build (the .unpublishable marker), never a latest.json for
// another version than package.json's, never from a checkout with uncommitted changes, and every file must be the
// one latest.json describes by SHA-256 (not only by size).
async function publish() {
  const latestFile = path.join(releaseDir, 'latest.json');
  if (!existsSync(latestFile)) fail('dist/release/latest.json is missing: build first.');
  if (existsSync(path.join(releaseDir, UNPUBLISHABLE))) fail('publish: dist/release holds a test build (--version or --test-identity); build the release again without them.');
  const latest = JSON.parse(readFileSync(latestFile, 'utf8'));
  const committed = JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf8')).version;
  if (latest.version !== committed) fail(`publish: latest.json is for ${latest.version}, package.json is ${committed}; only the committed version is published.`);
  const git = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: checkout, encoding: 'utf8' });
  if (git.status !== 0) fail('publish: could not read the git state of the checkout (git status failed).');
  if (git.stdout.trim()) fail('publish: the git tree has uncommitted changes; commit them and build again:\n' + git.stdout.trim().split('\n').slice(0, 10).join('\n'));
  if (!downloadDirs.length) fail('publish: set NV_DOWNLOAD_DIR to the web server\'s download folder (docs/RELEASING.md).');
  // The in-app updater trusts latest.json only with its signature, made by the key whose public half the app embeds.
  const sigFile = latestFile + '.sig';
  const pub = embeddedUpdateKey(checkout);
  if (!pub) fail('publish: UPDATE_PUBLIC_KEY_PEM in src/main/update-check.ts is still the placeholder; set the release key first.');
  if (!existsSync(sigFile)) fail('publish: dist/release/latest.json.sig is missing (build with NV_UPDATE_SIGNING_KEY_FILE set).');
  if (!(await verifyLatest(readFileSync(latestFile, 'utf8'), readFileSync(sigFile, 'utf8'), pub))) fail('publish: latest.json.sig does not match latest.json.');
  const useSudo = process.env.NV_PUBLISH_SUDO !== '0';
  const sudo = (args) => {
    const r = useSudo ? spawnSync('sudo', ['-n', ...args], { stdio: ['ignore', 'inherit', 'inherit'] }) : spawnSync(args[0], args.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) fail(`publish: ${args[0]} stopped (exit ${r.status}); nothing else was changed after it.`);
  };
  const dirs = downloadDirs.filter((d) => existsSync(d) || (console.log(`release: ${d} is not there; skipped.`), false));
  if (!dirs.length) fail(`publish: none of ${downloadDirs.join(', ')} is there.`);
  const files = [];
  for (const key of ['linux', 'windows']) {
    const asset = latest[key];
    if (!asset) continue;
    const versioned = key === 'linux' ? `Ironleaf-${latest.version}.AppImage` : asset.kind === 'portable-zip' ? asset.file : `Ironleaf-Setup-${latest.version}.exe`;
    for (const name of new Set([versioned, asset.file])) {
      const src = path.join(releaseDir, name);
      if (!existsSync(src)) fail(`publish: dist/release/${name} is missing.`);
      if (statSync(src).size !== asset.size || (await sha256File(src)) !== asset.sha256) fail(`publish: dist/release/${name} is not the file latest.json describes.`);
      files.push([src, name, key === 'linux' ? '0755' : '0644']);
    }
    // The in-app updater's block map (Windows): before latest.json, like everything it names.
    if (asset.blockmap) {
      const src = path.join(releaseDir, asset.blockmap.file);
      if (!existsSync(src) || statSync(src).size !== asset.blockmap.size || (asset.blockmap.sha256 && (await sha256File(src)) !== asset.blockmap.sha256)) fail(`publish: dist/release/${asset.blockmap.file} is missing or not the one latest.json describes.`);
      files.push([src, asset.blockmap.file, '0644']);
    }
  }
  const notesFile = `Ironleaf-${latest.version}.notes.txt`;
  if (existsSync(path.join(releaseDir, notesFile))) files.push([path.join(releaseDir, notesFile), notesFile, '0644']);
  const H = await historyModule(root, workDir);
  files.push([sigFile, 'latest.json.sig', '0644']);
  const tag = `.tmp-${process.pid}`;
  // Every file is copied under its temporary name first; only when all are there do the renames happen.
  for (const [i, downloadDir] of dirs.entries()) {
    const versionsFile = `versions-publish-${i}.json`;
    writeVersions(H, { root, releaseDir, downloadDir, latest, file: versionsFile });
    const these = [...files, [path.join(releaseDir, versionsFile), 'versions.json', '0644'], [latestFile, 'latest.json', '0644']];
    for (const [src, name, mode] of these) sudo(['install', '-m', mode, src, path.join(downloadDir, `.${name}${tag}`)]);
    for (const [, name] of these) sudo(['mv', '-f', path.join(downloadDir, `.${name}${tag}`), path.join(downloadDir, name)]);
    rmSync(path.join(releaseDir, versionsFile), { force: true });
    console.log(`release: published ${these.length} files to ${downloadDir} (versions.json, then latest.json last).`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
const startedAll = Date.now();
if (has('--win-smoke')) {
  await step('windows smoke', async () => windowsSmoke());
  process.exit(0);
}
if (has('--publish-only')) {
  await step('publish', async () => publish());
  process.exit(0);
}
if (!existsSync(builderCli)) fail(`electron-builder is not in ${buildTools} (docs/RELEASING.md, "Once per machine").`);

// The typecheck runs alongside the build and the packaging (it is the slowest single step and needs nothing from
// them); nothing is described or published until it has passed.
const typecheckStarted = Date.now();
const typecheck = has('--fast') ? null : runQuiet(npm, ['run', 'typecheck']).then((r) => ({ ...r, ms: Date.now() - typecheckStarted }));
if (typecheck) console.log('release: typecheck… (alongside the build)');
await step('build', async () => run(npm, ['run', 'build']));
const packages = await step('stage', async () => stage());
console.log(`release: staged ${packages} production packages (${shippedDependencies().join(', ') || 'none'} and what they need).`);

const results = await step('package', async () => {
  const jobs = [];
  if (wantLinux) jobs.push(packageLinux().then((r) => ['linux', r]));
  if (wantWin) jobs.push(packageWindows().then((r) => ['windows', r]));
  return Object.fromEntries(await Promise.all(jobs));
});
for (const [name, r] of Object.entries(results)) {
  timings.push([`  package: ${name}`, r.ms]);
  if (r.ok) console.log(`release: ${name}: ${r.kind}`);
  if (!r.ok) fail(r.words);
}

if (typecheck) {
  const r = await typecheck;
  timings.unshift(['typecheck (alongside)', r.ms]);
  if (!r.ok) fail('typecheck failed:\n' + r.out.trim().split('\n').slice(-40).join('\n'));
  console.log(`release: typecheck done in ${seconds(r.ms)}`);
}

// Smoke: the packaged Linux app (the same app.asar the Windows installer carries) is started for a few seconds on
// a virtual screen with an empty data folder. A missing file in the package shows here, not on a customer's PC.
if (results.linux?.ok && !has('--no-smoke') && existsSync('/usr/bin/xvfb-run')) {
  await step('smoke', async () => {
    const exe = path.join(workDir, 'linux', 'linux-unpacked', 'ironleaf');
    const data = path.join(workDir, 'smoke-data');
    rmSync(data, { recursive: true, force: true });
    mkdirSync(data, { recursive: true });
    const child = spawn('xvfb-run', ['-a', exe, '--no-sandbox', `--user-data-dir=${data}`], { cwd: data, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(), detached: true });
    let out = '';
    let exited = null;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (exited = code ?? 1));
    const until = Date.now() + 8000;
    while (Date.now() < until && exited === null && !/JavaScript error occurred|Cannot find module/.test(out)) await new Promise((r) => setTimeout(r, 250));
    const bad = exited !== null || /JavaScript error occurred|Cannot find module/.test(out);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    rmSync(data, { recursive: true, force: true });
    if (bad) fail('the packaged app did not stay up' + (exited !== null ? ` (exit ${exited})` : '') + ':\n' + out.trim().split('\n').slice(0, 20).join('\n'));
  });
}

const latest = await step('describe', async () => {
  // A one-platform run keeps the other platform's files from an earlier run of this same version; anything from
  // another version goes.
  // Nothing is carried from a test build: its files are not the release's even when the version matches.
  let earlier = null;
  try {
    if (!existsSync(path.join(releaseDir, UNPUBLISHABLE))) earlier = JSON.parse(readFileSync(path.join(releaseDir, 'latest.json'), 'utf8'));
  } catch {}
  const keep = new Set();
  const carried = {};
  for (const key of ['windows', 'linux']) {
    const was = earlier?.version === version && !results[key] ? earlier[key] : null;
    if (!was?.file || !existsSync(path.join(releaseDir, was.file))) continue;
    carried[key] = was;
    keep.add(was.file).add(NAMES[key].versioned);
    if (was.blockmap?.file) keep.add(was.blockmap.file);
  }
  mkdirSync(releaseDir, { recursive: true });
  for (const name of readdirSync(releaseDir)) if (!keep.has(name)) rmSync(path.join(releaseDir, name), { recursive: true, force: true });
  const d = new Date();
  // No --notes: the release's notes are CHANGELOG.md's for this version (what the app's version history says too).
  const H = await historyModule(root, workDir);
  const releaseNotes = notes || changelogNotes(H, root, version);
  const out = { version, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, notes: releaseNotes };
  for (const key of ['windows', 'linux']) {
    const r = results[key];
    if (!r) {
      if (carried[key]) out[key] = carried[key];
      continue;
    }
    const zip = r.kind === 'portable zip';
    const fixed = zip ? WIN_ZIP : NAMES[key].file;
    const versioned = zip ? WIN_ZIP : NAMES[key].versioned;
    copyFileSync(r.built, path.join(releaseDir, versioned));
    if (fixed !== versioned) copyFileSync(r.built, path.join(releaseDir, fixed));
    out[key] = { file: fixed, size: statSync(r.built).size, sha256: await sha256File(r.built), ...(zip ? { kind: 'portable-zip' } : { versioned }) };
    // What the in-app updater needs for a differential download (src/main/update-check.ts): the Windows installer's
    // block map beside it (electron-builder writes it with nsis.differentialPackage), the size of the one an
    // AppImage carries at its end.
    if (!zip && key === 'windows' && existsSync(r.built + '.blockmap')) {
      const bm = `${versioned}.blockmap`;
      copyFileSync(r.built + '.blockmap', path.join(releaseDir, bm));
      out[key].blockmap = { file: bm, size: statSync(r.built + '.blockmap').size, sha256: await sha256File(r.built + '.blockmap') };
    }
    if (key === 'linux') {
      const embedded = embeddedBlockMapSize(r.built);
      if (embedded) out[key].blockMapSize = embedded;
    }
  }
  const latestText = JSON.stringify(out, null, 2) + '\n';
  writeFileSync(path.join(releaseDir, 'latest.json'), latestText);
  // Signed when the release key is given (docs/RELEASING.md); an unsigned build is for testing only. A test build
  // (--version, --test-identity) is never signed, whatever the environment holds, and is marked unpublishable.
  const signingKey = testBuild ? null : signingKeyFromEnv();
  rmSync(path.join(releaseDir, 'latest.json.sig'), { force: true });
  rmSync(path.join(releaseDir, UNPUBLISHABLE), { force: true });
  if (testBuild) writeFileSync(path.join(releaseDir, UNPUBLISHABLE), 'A test build (--version or --test-identity): never signed, never published.\n');
  if (signingKey) writeFileSync(path.join(releaseDir, 'latest.json.sig'), (await signLatest(latestText, signingKey)) + '\n');
  else if (testBuild) console.log('release: a test build (--version or --test-identity): latest.json is NOT signed and dist/release is marked unpublishable.');
  else console.log('release: no NV_UPDATE_SIGNING_KEY_FILE: latest.json is NOT signed (fine for a test build; --publish refuses it).');
  writeFileSync(path.join(releaseDir, NOTES_FILE), `Ironleaf ${version} (${out.date})\n\n${releaseNotes || 'No notes for this release.'}\n`);
  // The version history as it will be published (the first download folder's list with this release added).
  writeVersions(H, { root, releaseDir, downloadDir: downloadDirs.find((dir) => existsSync(dir)) ?? null, latest: out });
  return out;
});

if (has('--publish')) await step('publish', async () => publish());

console.log('\nrelease: Ironleaf ' + version + ' in dist/release/');
for (const name of readdirSync(releaseDir).sort()) console.log(`  ${name.padEnd(36)} ${mb(statSync(path.join(releaseDir, name)).size).padStart(10)}`);
for (const key of ['linux', 'windows']) if (latest[key]) console.log(`  ${key} sha256 ${latest[key].sha256}`);
console.log('\nrelease: timings');
for (const [name, ms] of timings) console.log(`  ${name.padEnd(36)} ${seconds(ms).padStart(8)}`);
console.log(`  ${'total'.padEnd(36)} ${seconds(Date.now() - startedAll).padStart(8)}`);
if (!has('--publish')) console.log('\nrelease: not published. To publish these files: node tools/release.mjs --publish-only');
