// node --test tests/update-check.test.mjs — Ironleaf's own updates (src/main/update-check.ts): versions compared
// as numbers, a bad latest.json read as "nothing new" (never a crash, never an update), the off switches, "Later";
// the update coming into the app: idle → downloading (bytes) → verifying → ready → installing, a download that does
// not match latest.json's size or SHA-256 refused (nothing installed), the AppImage renamed over the running one,
// the differential download (only changed blocks fetched, the rest copied from the local file, a server without
// ranges falls back to the whole file), "Updated to X" on the first start of the new version, and a failed install
// leaving the old version running with the words and the website.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync, gzipSync } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-update-check-'));
let U;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'main', 'update-check.ts'), platform: 'node', external: [/^node:/, 'electron'], output: { file: path.join(work, 'update-check.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  U = await import(pathToFileURL(path.join(work, 'update-check.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const fresh = (name) => {
  const dir = path.join(work, `${name}-${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const SETUP = Buffer.from('made-up Ironleaf installer bytes');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const latest = (over = {}) => ({ version: '2.0.0', date: '2026-11-20', notes: 'Faster search.', windows: { file: 'Ironleaf-Setup.exe', size: SETUP.length, sha256: sha(SETUP), versioned: 'Ironleaf-Setup-2.0.0.exe' }, linux: { file: 'Ironleaf.AppImage', size: 123, sha256: 'a'.repeat(64) }, ...over });

/** A stand-in Windows install: what was staged and restarted is kept for the asserts. */
function nsisPort(seen, blocked = null) {
  return { kind: 'nsis', blocked: () => blocked, stage: async (file) => void seen.staged.push(file), restart: (file, l) => void seen.restarted.push([file, l.version]) };
}

/** A checker over a made-up world: a site serving `files` (with ranges), the state file in memory. */
function world({ current = '1.0.3', platform = 'win32', body = JSON.stringify(latest()), files = null, installer = SETUP, status = 200, stored = null, fetchFails = false, port = 'nsis', dir = fresh('w'), ranges = true, blocked = null, gate = null } = {}) {
  const seen = { fetched: [], opened: [], staged: [], restarted: [], changes: [], file: stored };
  const served = files ?? { 'Ironleaf-Setup.exe': installer, 'Ironleaf-Setup-2.0.0.exe': installer };
  const checker = new U.UpdateChecker({ updateKeyPem: '',
    current,
    platform,
    updateDir: dir,
    fetch: async (url, init = {}) => {
      seen.fetched.push({ url, init });
      if (fetchFails) throw new Error('no network');
      if (url.endsWith('/latest.json')) {
        const text = typeof body === 'function' ? body() : body;
        return { ok: status === 200, status, text: async () => text, arrayBuffer: async () => Buffer.from(text) };
      }
      const name = decodeURIComponent(url.split('/').pop());
      if (gate) await gate(name);
      const bytes = served[name];
      if (!bytes) return new Response('not here', { status: 404 });
      const range = init.headers?.range && /^bytes=(\d+)-(\d+)$/.exec(init.headers.range);
      if (range && ranges) return new Response(bytes.subarray(Number(range[1]), Number(range[2]) + 1), { status: 206 });
      return new Response(bytes, { status: 200 });
    },
    readState: async () => seen.file,
    writeState: async (text) => void (seen.file = text),
    openExternal: async (url) => void seen.opened.push(url),
    ...(port === 'nsis' ? { installer: nsisPort(seen, blocked) } : port ? { installer: port } : {}),
    onChange: (s) => seen.changes.push(s),
  });
  return { checker, seen, dir };
}
const settle = async (checker) => {
  // The automatic download runs on after check() answers; wait for it to finish.
  for (let i = 0; i < 200; i++) {
    const s = await checker.state();
    if (s.stage !== 'downloading' && s.stage !== 'verifying') return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the download never finished');
};

test('versions compare as numbers, not as text', () => {
  assert.equal(U.compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(U.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(U.compareVersions('2.0.0', '10.0.0'), -1);
  assert.equal(U.compareVersions('1.0.3', '1.0.3'), 0);
  assert.equal(U.compareVersions('v2.0', '2.0.0'), 0);
  assert.equal(U.compareVersions('2.0.0-beta.1', '2.0.0'), -1, 'a pre-release is older than its release');
  assert.equal(U.compareVersions('2.0.1-beta.1', '2.0.0'), 1);
  assert.equal(U.isNewer('2.0.0', '1.0.3'), true);
  assert.equal(U.isNewer('1.0.3', '1.0.3'), false);
  assert.equal(U.isNewer('1.0.2', '1.0.3'), false);
  for (const bad of ['', 'latest', '1.2.3.4', '../2.0.0', null, undefined, 2, {}, '999999999.0.0']) assert.equal(U.isNewer(bad, '1.0.3'), false, `not a version: ${String(bad)}`);
});

test('latest.json is read by its shape, and anything else is nothing', () => {
  const good = U.parseLatest(JSON.stringify(latest({ windows: { ...latest().windows, blockmap: { file: 'Ironleaf-Setup-2.0.0.exe.blockmap', size: 10, sha256: 'B'.repeat(64) } }, linux: { file: 'Ironleaf.AppImage', size: 500, sha256: 'a'.repeat(64), versioned: 'Ironleaf-2.0.0.AppImage', blockMapSize: 40 } })));
  assert.deepEqual([good.version, good.date, good.notes, good.windows.file, good.linux.file], ['2.0.0', '2026-11-20', 'Faster search.', 'Ironleaf-Setup.exe', 'Ironleaf.AppImage']);
  assert.deepEqual([good.windows.versioned, good.windows.blockmap.sha256, good.linux.versioned, good.linux.blockMapSize], ['Ironleaf-Setup-2.0.0.exe', 'b'.repeat(64), 'Ironleaf-2.0.0.AppImage', 40]);
  for (const bad of ['', 'not json', '{', '[]', 'null', '"2.0.0"', '{"notes":"no version"}', '{"version":"soon"}', '{"version":2}', '<html>404</html>', 'x'.repeat(100_000)]) assert.equal(U.parseLatest(bad), null, `refused: ${bad.slice(0, 20)}`);
  assert.equal(U.parseLatest(undefined), null);
  // A file entry that is not a bare name, a real size and a SHA-256 is left out (the page is offered instead).
  for (const windows of [{ file: '../evil.exe', size: 1, sha256: 'a'.repeat(64) }, { file: 'https://elsewhere.example/x.exe', size: 1, sha256: 'a'.repeat(64) }, { file: 'a\\b.exe', size: 1, sha256: 'a'.repeat(64) }, { file: 'x.exe', size: 0, sha256: 'a'.repeat(64) }, { file: 'x.exe', size: 1, sha256: 'abc' }, { file: 'x.exe', size: '1', sha256: 'a'.repeat(64) }, 'x.exe']) {
    const parsed = U.parseLatest(JSON.stringify(latest({ windows })));
    assert.equal(parsed.version, '2.0.0');
    assert.equal(parsed.windows, undefined, JSON.stringify(windows));
  }
  // A versioned name or a block map that is not a bare name is dropped, never followed.
  const odd = U.parseLatest(JSON.stringify(latest({ windows: { ...latest().windows, versioned: '../x.exe', blockmap: { file: 'http://x/y', size: 1, sha256: 'a'.repeat(64) } } })));
  assert.deepEqual([odd.windows.versioned, odd.windows.blockmap], [undefined, undefined]);
  assert.equal(U.parseLatest(JSON.stringify(latest({ notes: 'x'.repeat(5000) }))).notes.length, 2000, 'notes are cut to a sane length');
  assert.equal(U.parseLatest(JSON.stringify(latest({ notes: 42 }))).notes, '');
});

test('a newer version is offered with its notes; the same or an older one is not', async () => {
  const { checker, seen } = world({ port: null });
  const state = await checker.check();
  assert.deepEqual(state.available, { version: '2.0.0', date: '2026-11-20', notes: 'Faster search.', canInstall: false, size: SETUP.length, dismissed: false });
  assert.equal(seen.fetched[0].url, 'https://ironleaf.kaitiaki-it.com/download/latest.json');
  assert.equal(seen.fetched[0].url.includes('?'), false, 'nothing about this PC rides on the address');
  assert.equal(seen.changes.at(-1).available.version, '2.0.0', 'the window is told');
  assert.equal((await world({ current: '2.0.0' }).checker.check()).available, null);
  assert.equal((await world({ current: '2.1.0' }).checker.check()).available, null);
  const off = world();
  await off.checker.setAutoDownload(false);
  assert.equal((await off.checker.check()).available.canInstall, true, 'an installed Windows copy can take it in place');
  assert.equal((await world({ blocked: 'not installed by its installer' }).checker.check()).available.canInstall, false, 'a portable copy cannot');
});

test('bad answers and no network never throw and never offer anything', async () => {
  for (const over of [{ body: 'not json' }, { body: '{"version":"soon"}' }, { body: '' }, { status: 404 }, { status: 500 }, { fetchFails: true }, { body: () => { throw new Error('cut off'); } }]) {
    const { checker } = world(over);
    const state = await checker.check();
    assert.equal(state.available, null);
    assert.equal(state.checkedAt, null, 'a check with no answer is not counted as checked');
  }
});

test('a check that never answers gives up at the timeout', async () => {
  let aborted = false;
  const checker = new U.UpdateChecker({ updateKeyPem: '', current: '1.0.3', platform: 'linux', timeoutMs: 30, fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })), readState: async () => null, writeState: async () => {}, openExternal: async () => {} });
  const state = await checker.check();
  assert.equal(aborted, true);
  assert.equal(state.available, null);
});

test('switched off: nothing is fetched until it is switched on again, and the choice is kept', async () => {
  const { checker, seen } = world();
  await checker.setEnabled(false);
  assert.equal(JSON.parse(seen.file).enabled, false);
  const off = await checker.check();
  assert.deepEqual([off.enabled, off.available, seen.fetched.length], [false, null, 0]);
  const again = world({ stored: seen.file });
  await again.checker.check();
  assert.equal(again.seen.fetched.length, 0, 'the next start reads the choice');
  const on = await checker.setEnabled(true);
  assert.equal(on.enabled, true);
  assert.equal((await checker.check()).available.version, '2.0.0');
});

test('Later: this version keeps quiet (and is not downloaded by itself), a newer one is offered', async () => {
  const { checker, seen } = world();
  await checker.setAutoDownload(false);
  await checker.check();
  assert.equal((await checker.dismiss()).available.dismissed, true);
  const next = world({ stored: seen.file });
  const s = await settle(next.checker).then(() => next.checker.check()).then(() => settle(next.checker));
  assert.deepEqual([s.available.dismissed, s.stage], [true, 'idle'], 'still dismissed after a restart, and not downloaded');
  const newer = world({ stored: seen.file, body: JSON.stringify(latest({ version: '2.0.1', windows: { ...latest().windows, versioned: undefined } })) });
  const n2 = await newer.checker.check();
  assert.deepEqual([n2.available.version, n2.available.dismissed], ['2.0.1', false]);
});

test('Windows: idle → downloading (bytes) → verifying → ready, then Restart hands the checked installer over', async () => {
  const { checker, seen, dir } = world();
  await checker.check();
  const ready = await settle(checker);
  const stages = [...new Set(seen.changes.map((s) => s.stage))];
  assert.deepEqual(stages, ['idle', 'downloading', 'verifying', 'ready'], 'downloaded by itself (on by default)');
  assert.equal(seen.changes.find((s) => s.stage === 'downloading').progress.total, SETUP.length);
  assert.equal(seen.changes.filter((s) => s.progress).at(-1).progress.received, SETUP.length, 'the bytes are counted');
  assert.equal(seen.fetched.at(-1).url, 'https://ironleaf.kaitiaki-it.com/download/Ironleaf-Setup-2.0.0.exe', 'the versioned file (it never changes under a download)');
  const file = path.join(dir, '2.0.0', 'Ironleaf-Setup-2.0.0.exe');
  assert.deepEqual(seen.staged, [file]);
  assert.equal(sha(readFileSync(file)), sha(SETUP));
  assert.deepEqual([ready.stage, ready.error, ready.installsOnQuit, checker.ready().file], ['ready', null, true, file]);
  assert.deepEqual(JSON.parse(seen.file).pending, { from: '1.0.3', to: '2.0.0', notes: 'Faster search.', file }, 'kept for the next start');
  const after = await checker.install();
  assert.equal(after.stage, 'installing');
  assert.deepEqual(seen.restarted, [[file, '2.0.0']]);
  assert.equal(checker.ready().file, file, 'the quit hook still finds it while installing');
});

test('a newer release found during a download: the finished one is never handed over as the newer, which downloads next', async () => {
  const NEWER = Buffer.from('made-up Ironleaf 2.1.0 installer bytes!!');
  const v210 = latest({ version: '2.1.0', notes: 'Even faster.', windows: { file: 'Ironleaf-Setup.exe', size: NEWER.length, sha256: sha(NEWER), versioned: 'Ironleaf-Setup-2.1.0.exe' } });
  let text = JSON.stringify(latest());
  let release;
  const held = new Promise((r) => (release = r));
  const { checker, seen, dir } = world({
    body: () => text,
    files: { 'Ironleaf-Setup-2.0.0.exe': SETUP, 'Ironleaf-Setup-2.1.0.exe': NEWER },
    gate: (name) => (name === 'Ironleaf-Setup-2.0.0.exe' ? held : null),
  });
  await checker.check();
  for (let i = 0; i < 100 && (await checker.state()).stage !== 'downloading'; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await checker.state()).stage, 'downloading');
  // 2.1.0 comes out while 2.0.0 is still downloading.
  text = JSON.stringify(v210);
  await checker.check(true);
  release();
  let state;
  for (let i = 0; i < 400; i++) {
    state = await checker.state();
    if (state.stage === 'ready' && checker.ready()?.latest.version === '2.1.0') break;
    await new Promise((r) => setTimeout(r, 5));
    // Whatever is ready is always handed over with its own release.
    const r = checker.ready();
    if (r) assert.equal(path.basename(r.file), `Ironleaf-Setup-${r.latest.version}.exe`, 'the file and its release go together');
  }
  const r = checker.ready();
  const file = path.join(dir, '2.1.0', 'Ironleaf-Setup-2.1.0.exe');
  assert.deepEqual([r.file, r.latest.version], [file, '2.1.0']);
  assert.equal(sha(readFileSync(file)), sha(NEWER));
  assert.deepEqual([state.error, state.failed], [null, null], 'nothing is counted as failed');
  assert.equal(JSON.parse(seen.file).pending.to, '2.1.0');
  await checker.install();
  assert.deepEqual(seen.restarted, [[file, '2.1.0']]);
});

test('automatic downloading off: nothing downloads until Update is clicked', async () => {
  const { checker, seen } = world();
  await checker.setAutoDownload(false);
  await checker.check();
  assert.equal((await settle(checker)).stage, 'idle');
  assert.equal(seen.fetched.length, 1, 'only latest.json');
  assert.equal((await checker.download()).stage, 'ready');
});

test('a download that does not match the SHA-256 or the size is refused: nothing is installed, the website is offered', async () => {
  const { checker, seen, dir } = world({ installer: Buffer.from('made-up Ironleaf installer bytez') }); // same length, other bytes
  await checker.check();
  const state = await settle(checker);
  assert.deepEqual([state.stage, seen.staged, seen.restarted], ['idle', [], []], 'never staged, never run');
  assert.match(state.error, /checksum/);
  assert.equal(existsSync(path.join(dir, '2.0.0', 'Ironleaf-Setup-2.0.0.exe')), false, 'the bad file is deleted');
  assert.equal(JSON.parse(seen.file).pending, null, 'nothing is waiting to install');
  assert.equal(checker.ready(), null);
  assert.equal((await checker.install()).stage, 'idle', 'Restart does nothing without a checked download');
  assert.deepEqual(seen.opened, [], 'the automatic download never opens a page by itself');
  for (const installer of [Buffer.from('short'), Buffer.concat([SETUP, Buffer.from('more')])]) {
    const w = world({ installer });
    await w.checker.setAutoDownload(false);
    await w.checker.check();
    assert.match((await w.checker.download()).error, /size|larger/);
    assert.deepEqual(w.seen.staged, []);
  }
  assert.throws(() => U.verifyDownload(Buffer.from('x'), { file: 'x.exe', size: 1, sha256: 'b'.repeat(64) }), /checksum/);
  assert.doesNotThrow(() => U.verifyDownload(SETUP, { file: 'x.exe', size: SETUP.length, sha256: sha(SETUP).toUpperCase() }));
});

test('announced but not on the site (404): "not available yet", no website, nothing staged, the next check tries again', async () => {
  const { checker, seen } = world({ files: {} });
  await checker.check();
  const state = await settle(checker);
  assert.equal(state.stage, 'idle');
  assert.equal(state.missing, true);
  assert.match(state.error, /not available to download yet/);
  assert.deepEqual([seen.staged, seen.opened], [[], []], 'nothing staged, no page opened');
  // Published later: the next check downloads it, and the flag is gone.
  const again = world({ stored: seen.file });
  await again.checker.check();
  const later = await settle(again.checker);
  assert.equal(later.stage, 'ready');
  assert.equal(later.missing, undefined);
});

test('where the update cannot come into the app, Update opens the download page and downloads nothing', async () => {
  for (const over of [{ platform: 'linux', port: null }, { platform: 'darwin', port: null }, { port: null }, { blocked: 'This copy of Ironleaf was not installed by its installer.' }, { body: JSON.stringify(latest({ windows: undefined })) }, { body: JSON.stringify(latest({ windows: { file: 'Ironleaf-2.0.0-win-x64.zip', size: 5, sha256: 'a'.repeat(64), kind: 'portable-zip' } })) }]) {
    const { checker, seen } = world(over);
    await checker.check();
    await settle(checker);
    const before = seen.fetched.length;
    assert.deepEqual(seen.opened, [], 'nothing opens by itself');
    await checker.download();
    assert.deepEqual([seen.opened, seen.staged, seen.fetched.length - before], [['https://ironleaf.kaitiaki-it.com/download/'], [], 0]);
  }
});

test('Linux: the checked AppImage is renamed over the running one (atomic; the running copy keeps its file)', async () => {
  const dir = fresh('appimage');
  const target = path.join(dir, 'Ironleaf.AppImage');
  writeFileSync(target, 'old appimage', { mode: 0o755 });
  const running = openSync(target, 'r'); // what the running AppImage holds open
  const NEW = Buffer.from('new appimage bytes');
  const part = U.appImagePart(target, '2.0.0');
  assert.equal(path.dirname(part), dir, 'downloaded beside it: same filesystem, so the rename is atomic');
  const seen = { restarted: [] };
  const port = { kind: 'appimage', currentFile: target, blocked: () => null, target: (v) => U.appImagePart(target, v), stage: (file) => U.replaceAppImage(file, target), restart: (file) => void seen.restarted.push(file) };
  const w = world({ platform: 'linux', port, body: JSON.stringify(latest({ linux: { file: 'Ironleaf.AppImage', size: NEW.length, sha256: sha(NEW), versioned: 'Ironleaf-2.0.0.AppImage' } })), files: { 'Ironleaf-2.0.0.AppImage': NEW } });
  await w.checker.check();
  const state = await settle(w.checker);
  assert.equal(state.stage, 'ready', state.error ?? '');
  assert.equal(readFileSync(target, 'utf8'), 'new appimage bytes');
  assert.equal(statSync(target).mode & 0o111, 0o111, 'executable');
  assert.equal(existsSync(part), false, 'no part file left');
  const buf = Buffer.alloc(12);
  readSync(running, buf, 0, 12, 0);
  closeSync(running);
  assert.equal(buf.toString(), 'old appimage', 'the running copy still reads the file it opened');
  await w.checker.install();
  assert.deepEqual(seen.restarted, [target]);

  // A bad download never touches the running file.
  writeFileSync(target, 'old appimage', { mode: 0o755 });
  const bad = world({ platform: 'linux', port, body: JSON.stringify(latest({ linux: { file: 'Ironleaf.AppImage', size: NEW.length, sha256: 'c'.repeat(64) } })), files: { 'Ironleaf.AppImage': NEW } });
  await bad.checker.check();
  assert.match((await settle(bad.checker)).error, /checksum/);
  assert.equal(readFileSync(target, 'utf8'), 'old appimage');
  assert.equal(existsSync(U.appImagePart(target, '2.0.0')), false);
});

/** A made-up block map over fixed 64-byte blocks (the checksums only have to be equal for equal blocks). */
function blockmapOf(bytes, format) {
  const checksums = [];
  const sizes = [];
  for (let i = 0; i < bytes.length; i += 64) {
    const block = bytes.subarray(i, Math.min(bytes.length, i + 64));
    checksums.push(createHash('sha256').update(block).digest('base64').slice(0, 24));
    sizes.push(block.length);
  }
  const json = Buffer.from(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] }));
  return format === 'gzip' ? gzipSync(json) : deflateRawSync(json);
}

test('differential: only the changed blocks are downloaded, the rest comes from the local file', async () => {
  const OLD = Buffer.alloc(64 * 100);
  for (let i = 0; i < OLD.length; i++) OLD[i] = (i * 7) % 251;
  const NEW = Buffer.concat([OLD.subarray(0, 64 * 40), Buffer.alloc(64 * 2, 9), OLD.subarray(64 * 40)]); // two new blocks in the middle
  const plan = U.planDifferential(U.parseBlockmap(blockmapOf(OLD, 'gzip'), 'gzip'), U.parseBlockmap(blockmapOf(NEW, 'gzip'), 'gzip'));
  assert.deepEqual([plan.download, plan.copy, plan.mapped, plan.ops.length], [128, 6400, NEW.length, 3]);
  // Windows: the installer kept from the last update, and its block map, are the base.
  const dir = fresh('diff');
  mkdirSync(path.join(dir, '1.0.3'));
  writeFileSync(path.join(dir, '1.0.3', 'Ironleaf-Setup-1.0.3.exe'), OLD);
  writeFileSync(path.join(dir, '1.0.3', 'Ironleaf-Setup-1.0.3.exe.blockmap'), blockmapOf(OLD, 'gzip'));
  const map = blockmapOf(NEW, 'gzip');
  const body = JSON.stringify(latest({ windows: { file: 'Ironleaf-Setup.exe', size: NEW.length, sha256: sha(NEW), versioned: 'Ironleaf-Setup-2.0.0.exe', blockmap: { file: 'Ironleaf-Setup-2.0.0.exe.blockmap', size: map.length, sha256: sha(map) } } }));
  const files = { 'Ironleaf-Setup-2.0.0.exe': NEW, 'Ironleaf-Setup-2.0.0.exe.blockmap': map };
  const w = world({ dir, body, files });
  await w.checker.check();
  const s = await settle(w.checker);
  assert.equal(s.stage, 'ready', s.error ?? '');
  const ranged = w.seen.fetched.filter((f) => f.init?.headers?.range);
  assert.deepEqual(ranged.map((f) => f.init.headers.range), [`bytes=${64 * 40}-${64 * 42 - 1}`], 'one range: the two new blocks');
  assert.equal(w.seen.changes.find((c) => c.progress?.differential).progress.total, 128);
  const made = path.join(dir, '2.0.0', 'Ironleaf-Setup-2.0.0.exe');
  assert.equal(sha(readFileSync(made)), sha(NEW), 'the same bytes as a full download');
  assert.equal(sha(readFileSync(made + '.blockmap')), sha(map), 'its block map is kept: the base of the next one');

  // A site that ignores ranges: the whole file instead, still checked.
  rmSync(path.join(dir, '2.0.0'), { recursive: true });
  const noRanges = world({ dir, body, files, ranges: false });
  await noRanges.checker.check();
  assert.equal((await settle(noRanges.checker)).stage, 'ready');
  assert.equal(sha(readFileSync(made)), sha(NEW));
  assert.ok(noRanges.seen.fetched.some((f) => f.url.endsWith('/Ironleaf-Setup-2.0.0.exe') && !f.init?.headers?.range), 'the full download');
});

test('differential on Linux reads the block map the AppImage carries at its end', async () => {
  const body0 = Buffer.alloc(64 * 50, 3);
  const withMap = (bytes) => {
    const m = blockmapOf(bytes, 'deflate');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(m.length);
    return { file: Buffer.concat([bytes, m, len]), mapSize: m.length };
  };
  const old = withMap(body0);
  const next = withMap(Buffer.concat([body0.subarray(0, 64 * 10), Buffer.alloc(64, 1), body0.subarray(64 * 11)]));
  const dir = fresh('appdiff');
  const target = path.join(dir, 'Ironleaf.AppImage');
  writeFileSync(target, old.file, { mode: 0o755 });
  const embedded = await U.readEmbeddedBlockmap(target);
  assert.equal(embedded.mapped, body0.length);
  const port = { kind: 'appimage', currentFile: target, blocked: () => null, target: (v) => U.appImagePart(target, v), stage: (file) => U.replaceAppImage(file, target), restart: () => {} };
  const w = world({ platform: 'linux', port, body: JSON.stringify(latest({ linux: { file: 'Ironleaf.AppImage', size: next.file.length, sha256: sha(next.file), versioned: 'Ironleaf-2.0.0.AppImage', blockMapSize: next.mapSize } })), files: { 'Ironleaf-2.0.0.AppImage': next.file } });
  await w.checker.check();
  const s = await settle(w.checker);
  assert.equal(s.stage, 'ready', s.error ?? '');
  assert.equal(sha(readFileSync(target)), sha(next.file));
  const got = w.seen.fetched.filter((f) => f.init?.headers?.range).map((f) => f.init.headers.range);
  assert.equal(got.length, 3, 'the new map, the changed block, the map again at the end: ' + got.join(' '));
});

test('the first start of the new version says "Updated to X" with the notes, once, and tidies the downloads', async () => {
  const dir = fresh('updated');
  for (const v of ['1.0.3', '2.0.0']) {
    mkdirSync(path.join(dir, v));
    writeFileSync(path.join(dir, v, 'x.exe'), v);
  }
  writeFileSync(path.join(dir, 'update-result.json'), JSON.stringify({ ok: true, to: '2.0.0' }));
  const stored = JSON.stringify({ enabled: true, pending: { from: '1.0.3', to: '2.0.0', notes: 'Faster search.', file: 'x' } });
  const w = world({ current: '2.0.0', stored, dir });
  const s = await w.checker.state();
  assert.deepEqual(s.updated, { version: '2.0.0', from: '1.0.3', notes: 'Faster search.' });
  assert.deepEqual([s.failed, JSON.parse(w.seen.file).pending], [null, null]);
  assert.deepEqual(readdirNames(dir), ['2.0.0'], 'the old download and the result go; this version’s installer stays (the next base)');
  // Still there on the next start until it is closed; then gone.
  const again = world({ current: '2.0.0', stored: w.seen.file, dir });
  assert.equal((await again.checker.state()).updated.version, '2.0.0');
  assert.equal((await again.checker.dismissNotice()).updated, null);
  assert.equal((await world({ current: '2.0.0', stored: again.seen.file, dir }).checker.state()).updated, null);
});
const readdirNames = (dir) => readdirSync(dir).sort();

test('a failed install leaves the old version running and says so, with the website and Try again', async () => {
  const dir = fresh('failed');
  mkdirSync(path.join(dir, '2.0.0'));
  const file = path.join(dir, '2.0.0', 'Ironleaf-Setup-2.0.0.exe');
  writeFileSync(file, SETUP); // the checked download is still there
  writeFileSync(path.join(dir, 'update-result.json'), '\uFEFF' + JSON.stringify({ ok: false, from: '1.0.3', to: '2.0.0', code: 2, words: 'The installer stopped with code 2.' }));
  const stored = JSON.stringify({ enabled: true, pending: { from: '1.0.3', to: '2.0.0', notes: '', file }, updated: { version: '1.0.3', from: '1.0.2', notes: '' } });
  const w = world({ current: '1.0.3', stored, dir });
  const s = await w.checker.check();
  assert.deepEqual(s.failed, { version: '2.0.0', words: 'The installer stopped with code 2.' });
  assert.deepEqual([s.current, s.updated, s.stage], ['1.0.3', null, 'idle'], 'the old version, working, nothing pretending it updated (an earlier "Updated to" gives way)');
  assert.equal((await settle(w.checker)).stage, 'idle', 'not downloaded and installed again by itself');
  assert.equal(existsSync(path.join(dir, 'update-result.json')), false);
  // Try again: the checked download is reused (nothing fetched), and it is ready to restart again.
  const before = w.seen.fetched.length;
  const again = await w.checker.download();
  assert.deepEqual([again.stage, again.failed, w.seen.fetched.length - before], ['ready', null, 0]);
  // No result at all (it never ran: the PC was shutting down): nothing is said, and the download is kept.
  const quiet = world({ current: '1.0.3', stored, dir: fresh('quiet') });
  const q = await quiet.checker.state();
  assert.deepEqual([q.failed, q.current, JSON.parse(quiet.seen.file ?? stored).pending.to], [null, '1.0.3', '2.0.0']);
});

test('the Windows helper: waits for this app, installs silently as an update into the same folder, puts the old one back on failure', () => {
  const script = U.windowsHelperScript({ pid: 4242, setup: "C:\\Users\\o'brien\\AppData\\Roaming\\x\\updates\\2.0.1\\Ironleaf-Setup-2.0.1.exe", installDir: 'C:\\Users\\o\'brien\\AppData\\Local\\Programs\\Ironleaf\\', exe: 'C:\\P\\Ironleaf\\Ironleaf.exe', to: '2.0.1', from: '2.0.0', result: 'C:\\r.json', log: 'C:\\l.log', relaunch: true, args: ['--user-data-dir=C:\\My Data\\', '--remote-debugging-port=9222'] });
  assert.match(script, /\$appPid = 4242/);
  assert.match(script, /^# .*\r\nparam\(\[switch\]\$Clean\)\r\nif \(-not \$Clean\) \{ Start-Process /, 'first a clean copy of itself (nothing Ironleaf had open is passed on)');
  assert.match(script, /\$psi\.UseShellExecute = \$true; \[void\]\[Diagnostics\.Process\]::Start\(\$psi\); Say "started/, 'Ironleaf is started through the shell: it inherits nothing');
  assert.match(script, /Wait-Process -Id \$appPid/);
  assert.match(script, /\$psi\.Arguments = "\/S --updated \/D=\$dir"/, 'silent, as an update, into the same folder');
  assert.match(script, /\$dir = 'C:\\Users\\o''brien\\AppData\\Local\\Programs\\Ironleaf'\r\n/, 'quoted for PowerShell, no trailing backslash');
  assert.match(script, /Rename-Item -LiteralPath \$dir -NewName \(Split-Path \$aside -Leaf\)/, 'the old folder moved aside, not deleted');
  assert.match(script, /Rename-Item -LiteralPath \$aside -NewName \(Split-Path \$dir -Leaf\)/, 'and put back on failure');
  assert.match(script, /\$ok = \(\$code -eq 0\) -and \(\$ver -eq \$want/, 'success means the program there is the new version');
  assert.match(script, /\$updatedArgs = '"--user-data-dir=C:\\My Data\\\\" --remote-debugging-port=9222 --updated'/);
  assert.match(script, /if \(\$ok -and \$relaunch\) \{ Start-NV \$updatedArgs \} elseif \(\(-not \$ok\) -and \$relaunch\) \{ Start-NV \$plainArgs \}/);
  // PowerShell reads "$name:" inside double quotes as a drive-qualified variable (a parse error that stops the whole
  // helper): no double-quoted string may have one.
  for (const quoted of script.match(/"[^"\r\n]*"/g) ?? []) assert.equal(/\$[A-Za-z_]\w*:/.test(quoted), false, quoted);
  assert.equal(/--force-run/.test(script), false, 'the helper starts Ironleaf itself, with this start’s own arguments');
  assert.deepEqual(U.relaunchArgs(['--hidden', '--user-data-dir=x', '--updated'], true), ['--user-data-dir=x', '--updated']);
  assert.deepEqual(U.relaunchArgs(['a b'], false), ['a b']);
  assert.equal(U.winQuote('plain'), 'plain');
  assert.equal(U.winQuote('a b'), '"a b"');
  assert.equal(U.winQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(U.winQuote('C:\\x y\\'), '"C:\\x y\\\\"');
});

test('Windows: the installer is read again just before the helper starts; a changed file is never run', () => {
  const dir = fresh('rehash');
  const file = path.join(dir, 'Ironleaf-Setup-2.0.0.exe');
  writeFileSync(file, SETUP);
  const want = { size: SETUP.length, sha256: sha(SETUP) };
  assert.equal(U.installerUnchanged(file, want), true);
  assert.equal(U.installerUnchanged(file, { ...want, sha256: want.sha256.toUpperCase() }), true);
  writeFileSync(file, Buffer.from('made-up Ironleaf installer bytez')); // same size, other bytes
  assert.equal(U.installerUnchanged(file, want), false, 'swapped after it was checked');
  writeFileSync(file, Buffer.concat([SETUP, Buffer.from('x')]));
  assert.equal(U.installerUnchanged(file, want), false, 'grown');
  assert.equal(U.installerUnchanged(path.join(dir, 'gone.exe'), want), false, 'gone');
  // The quit hook checks before it writes or starts the helper, and hands the helper the SHA-256 to check again.
  const src = readFileSync(path.join(root, 'src/main/update-check.ts'), 'utf8');
  const hook = src.slice(src.indexOf("if (installer?.kind === 'nsis') {"), src.indexOf("if (installer?.kind === 'appimage') {"));
  assert.ok(hook.indexOf('installerUnchanged(r.file, asset)') > 0, 'the quit hook re-hashes the installer');
  assert.ok(hook.indexOf('installerUnchanged(r.file, asset)') < hook.indexOf('spawn('), 'before the helper starts');
  assert.match(hook, /sha256: asset\.sha256/);
  const script = U.windowsHelperScript({ pid: 1, setup: 'C:\\u\\Ironleaf-Setup-2.0.0.exe', installDir: 'C:\\P\\Ironleaf', exe: 'C:\\P\\Ironleaf\\Ironleaf.exe', to: '2.0.0', from: '1.0.3', result: 'C:\\r.json', log: 'C:\\l.log', relaunch: false, args: [], sha256: want.sha256 });
  assert.match(script, new RegExp(`\\$wantSum = '${want.sha256.toUpperCase()}'`));
  assert.ok(script.indexOf('Get-FileHash -LiteralPath $setup -Algorithm SHA256') < script.indexOf('Rename-Item -LiteralPath $dir'), 'checked before anything is moved');
  assert.ok(script.indexOf('Get-FileHash') < script.indexOf('$psi = New-Object Diagnostics.ProcessStartInfo $setup'), 'and before the installer runs');
});

test('Windows: the helper is started through cmd /c start (so it outlives Ironleaf), hidden', () => {
  const c = U.helperCommand('C:\\Windows', undefined, 'C:\\Users\\A B\\updates\\2.0.1\\install-update.ps1');
  assert.equal(c.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(c.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(c.args[3], '"start "" /b "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\\Users\\A B\\updates\\2.0.1\\install-update.ps1""');
});

test('Linux restart: a shell outside the AppImage waits for this process, then starts the new AppImage clean', () => {
  const r = U.appImageRelaunch({ pid: 77, appImage: '/home/o/Apps/Ironleaf.AppImage', args: ['--no-sandbox', '--updated'], env: { HOME: '/home/o', APPDIR: '/tmp/.mount_Neu1', APPIMAGE: '/home/o/Apps/Ironleaf.AppImage', LD_LIBRARY_PATH: '/tmp/.mount_Neu1/usr/lib', OWD: '/home/o', DISPLAY: ':0', PATH: '/tmp/.mount_Neu1:/tmp/.mount_Neu1/usr/sbin:/usr/bin:/bin' } });
  assert.equal(r.file, '/bin/sh');
  assert.deepEqual(r.args.slice(2), ['neuralvault-update', '77', '/home/o/Apps/Ironleaf.AppImage', '--no-sandbox', '--updated']);
  assert.match(r.args[1], /kill -0 "\$1"/);
  assert.equal(/exec \$fd/.test(r.args[1]), false, 'plain sh: no descriptor closing (dash cannot name one above 9)');
  const b = U.appImageRelaunch({ pid: 77, appImage: '/a', args: [], env: {}, bash: true });
  assert.equal(b.file, '/bin/bash');
  assert.match(b.args[1], /eval "exec \$fd>&-"/, 'bash closes what this process left open (the new start must not hold its sockets)');
  assert.deepEqual(r.env, { HOME: '/home/o', DISPLAY: ':0', PATH: '/usr/bin:/bin' }, 'nothing that points into the old mount; PATH keeps the rest (the runtime needs fusermount)');
  assert.equal(U.appImageRelaunch({ pid: 1, appImage: '/a', args: [], env: { APPDIR: '/m', PATH: '/m/usr/bin' } }).env.PATH, '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
});

test('Linux: APPIMAGE is followed only when this program runs from that AppImage’s own mount', () => {
  const mount = (point, type, source) => `1203 30 0:85 / ${point} ro,nosuid,nodev,relatime shared:640 - ${type} ${source} ro,user_id=1000,group_id=1000`;
  const MOUNTS = ['22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw', mount('/tmp/.mount_IronleAbC123', 'fuse.Ironleaf.AppImage', 'Ironleaf.AppImage')].join('\n') + '\n';
  const files = new Set(['/home/o/Apps/Ironleaf.AppImage', '/home/o/Apps/Other.AppImage']);
  const links = { '/home/o/bin/ironleaf': '/home/o/Apps/Ironleaf.AppImage' };
  const base = { execPath: '/tmp/.mount_IronleAbC123/ironleaf', env: { APPIMAGE: '/home/o/Apps/Ironleaf.AppImage', APPDIR: '/tmp/.mount_IronleAbC123' }, mountinfo: MOUNTS, realpath: (p) => links[p] ?? p, isFile: (p) => files.has(p) };
  const t = (over = {}) => U.trustedAppImage({ ...base, ...over, env: { ...base.env, ...(over.env ?? {}) } });
  assert.equal(t(), '/home/o/Apps/Ironleaf.AppImage', 'the real thing');
  assert.equal(t({ env: { APPIMAGE: '/home/o/bin/ironleaf' } }), '/home/o/Apps/Ironleaf.AppImage', 'a link is followed to its file');
  // Inherited: this program is not inside APPDIR (a .deb or unpacked copy started by an AppImage app).
  assert.equal(t({ execPath: '/opt/Ironleaf/ironleaf' }), null, 'not running from the mount');
  assert.equal(t({ env: { APPDIR: undefined } }), null, 'no APPDIR');
  assert.equal(t({ env: { APPIMAGE: undefined } }), null, 'no APPIMAGE');
  assert.equal(t({ env: { APPIMAGE: 'Ironleaf.AppImage' } }), null, 'not an absolute path');
  // APPIMAGE pointed at some other file: the mount is not of that file.
  assert.equal(t({ env: { APPIMAGE: '/home/o/Apps/Other.AppImage' } }), null, 'another file');
  assert.equal(t({ env: { APPIMAGE: '/home/o/.bashrc' } }), null, 'not a file there');
  // APPDIR that is not a FUSE mount of the AppImage (a plain folder, or another kind of mount).
  assert.equal(t({ mountinfo: MOUNTS.replace('fuse.Ironleaf.AppImage', 'ext4').replace(' Ironleaf.AppImage ro,user', ' /dev/sdb1 ro,user') }), null, 'not a FUSE mount');
  assert.equal(t({ mountinfo: '22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n' }), null, 'not a mount at all');
  assert.equal(t({ execPath: '/home/o/x/ironleaf', env: { APPDIR: '/home/o/x' }, mountinfo: MOUNTS + mount('/home/o/x', 'fuse.sshfs', 'host:/x') + '\n' }), null, 'a FUSE mount of something else');
  // A mount point with a space reads back from its escape.
  assert.equal(t({ execPath: '/tmp/my mount/ironleaf', env: { APPDIR: '/tmp/my mount' }, mountinfo: mount('/tmp/my\\040mount', 'fuse.Ironleaf.AppImage', 'Ironleaf.AppImage') }), '/home/o/Apps/Ironleaf.AppImage');
  // The updater and the mcp bridge both go through it; neither reads process.env.APPIMAGE itself any more.
  const update = readFileSync(path.join(root, 'src/main/update-check.ts'), 'utf8');
  const bridge = readFileSync(path.join(root, 'src/main/mcp-bridge.ts'), 'utf8');
  assert.equal(/process\.env\.APPIMAGE/.test(update), false);
  assert.match(update, /process\.platform === 'linux' && app\.isPackaged && runningAppImage\(\)/);
  assert.equal(/process\.env\.APPIMAGE/.test(bridge), false);
  assert.match(bridge, /const exe = runningAppImage\(\) \?\? process\.execPath;/);
});

test('only a development build reads another site (on this PC); an installed copy never does, switch or not', () => {
  const env = { NV_UPDATE_ORIGIN: 'http://127.0.0.1:18990' };
  assert.equal(U.updateOrigin({ packaged: true, argv: [], env }), undefined, 'the variable alone does nothing in an installed copy');
  assert.equal(U.updateOrigin({ packaged: true, argv: ['--nv-update-test-origin'], env: {} }), undefined, 'the switch alone does nothing');
  assert.equal(U.updateOrigin({ packaged: true, argv: ['--nv-update-test-origin'], env }), undefined, 'an installed copy is never pointed elsewhere');
  assert.equal(U.updateOrigin({ packaged: true, argv: ['--nv-update-test-origin'], env: { NV_UPDATE_ORIGIN: 'https://evil.example' } }), undefined);
  assert.equal(U.updateOrigin({ packaged: false, argv: [], env: { NV_UPDATE_ORIGIN: 'http://127.0.0.1:8123' } }), 'http://127.0.0.1:8123');
  assert.equal(U.updateOrigin({ packaged: false, argv: [], env: { NV_UPDATE_ORIGIN: 'http://10.0.0.5:18990' } }), undefined, 'only this PC');
});

test('the wiring is three small edits: the main side starts it, the preload names it, the window shows it', async () => {
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  assert.match(read('src/main/index.ts'), /if \(single\) \{[^}]*startUpdateCheck\(managedUpdates\(\)\);/, 'only the one running app checks (never the ironleaf mcp bridge)');
  assert.match(read('src/preload/index.ts'), /exposeInMainWorld\('nvUpdate', updateCheckApi\(ipcRenderer\)\)/);
  assert.match(read('src/renderer/src/main.tsx'), /<UpdateBanner \/>/);
  const source = read('src/main/update-check.ts');
  assert.equal(/from '\.\//.test(source), false, 'self-contained: it imports nothing else of the app');
  assert.equal(/neuralspark/i.test(source), false);
  const config = JSON.parse(read('build-standalone/electron-builder.json'));
  assert.equal(config.nsis.differentialPackage, 'store-asar', 'the installer is built for differential downloads');
  assert.equal(config.nsis.guid, '64ba8a54-550e-4c87-9030-91574132cfd2', 'the guid that makes installs upgrade in place');
  assert.match(read('build-standalone/build/update-progress.nsh'), /\$\{isUpdated\}/);
});
