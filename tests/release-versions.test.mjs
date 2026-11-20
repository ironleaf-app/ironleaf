// node --test tests/release-versions.test.mjs — the release's version history (tools/release-versions.mjs and the
// publish step of tools/release.mjs, 20 Nov 2026): a publish writes versions.json into each download folder with
// this release appended to what that folder already had (CHANGELOG.md filling in the rest), installs it before
// latest.json (latest.json is still the last file to change), and a release without --notes takes CHANGELOG.md's.
// Publish needs latest.json.sig made by the key the checkout embeds: the checks sign with a throwaway key and point
// NV_PUBLISH_CHECKOUT at a scratch checkout (a git repository) that embeds its public half. Publish also refuses a
// test build (.unpublishable), a latest.json for another version than package.json's, a checkout with uncommitted
// changes, and any file whose SHA-256 is not latest.json's.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-release-versions-'));
let R;
let H;
let S;
// A throwaway release key, and a scratch checkout whose src/main/update-check.ts embeds its public half.
const KEY = generateKeyPairSync('ed25519');
const PRIV = KEY.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = KEY.publicKey.export({ type: 'spki', format: 'pem' });
const checkout = path.join(work, 'checkout');
before(async () => {
  R = await import(pathToFileURL(path.join(root, 'tools', 'release-versions.mjs')).href);
  H = await R.historyModule(root, path.join(work, 'lib'));
  S = await import(pathToFileURL(path.join(root, 'tools', 'update-sign.mjs')).href);
  mkdirSync(path.join(checkout, 'src', 'main'), { recursive: true });
  writeFileSync(path.join(checkout, 'src', 'main', 'update-check.ts'), `export const UPDATE_PUBLIC_KEY_PEM = \`${PUB.trim()}\`;\n`);
  writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: 'scratch', version: '9.0.0' }));
  gitIn(['init', '-q']);
  gitIn(['add', '-A']);
  gitIn(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'scratch']);
});
function gitIn(args) {
  const r = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
/** latest.json written and signed with the throwaway key, as a signed build leaves it. */
async function writeSignedLatest(rel, l) {
  const text = JSON.stringify(l, null, 2) + '\n';
  writeFileSync(path.join(rel, 'latest.json'), text);
  writeFileSync(path.join(rel, 'latest.json.sig'), (await S.signLatest(text, PRIV)) + '\n');
}
const publishEnv = (over) => ({ ...process.env, NV_PUBLISH_SUDO: '0', NV_PUBLISH_CHECKOUT: checkout, NV_UPDATE_SIGNING_KEY: '', NV_UPDATE_SIGNING_KEY_FILE: '', ...over });
after(() => rmSync(work, { recursive: true, force: true }));

const ABCD_SHA = createHash('sha256').update('ABCD').digest('hex');
const latest = (over = {}) => ({ version: '2.0.2', date: '2026-11-28', notes: 'Faster search.', linux: { file: 'Ironleaf.AppImage', size: 4, sha256: ABCD_SHA }, ...over });

test('CHANGELOG.md gives a release its notes when --notes is not given', () => {
  assert.match(R.changelogNotes(H, root, '2.0.0'), /NeuralVault/);
  assert.equal(R.changelogNotes(H, root, '9.9.9'), '');
  const src = readFileSync(path.join(root, 'tools', 'release.mjs'), 'utf8');
  assert.match(src, /const releaseNotes = notes \|\| changelogNotes\(H, root, version\)/);
});

test('versions.json text: this release on top of what the folder had, the bundled history filling the rest', () => {
  // Versions above anything CHANGELOG.md has, so the order holds whatever the bundled history grows to.
  const bundled = H.parseChangelog(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  const text = R.versionsText(H, { published: JSON.stringify({ versions: [{ version: '9.0.1', date: '2026-11-25', notes: 'Published words' }] }), latest: latest({ version: '9.0.2' }), bundled });
  const list = JSON.parse(text).versions;
  assert.deepEqual(list.slice(0, 3).map((e) => e.version), ['9.0.2', '9.0.1', bundled[0].version]);
  assert.deepEqual(list[0].sizes, { linux: 4 });
  assert.equal(list[1].notes, 'Published words');
  assert.ok(list.some((e) => e.version === '1.0.0'));
});

test('publish: each download folder gets its own list appended, versions.json before latest.json, nothing left over', { skip: process.platform === 'win32' && 'publishing copies with POSIX install and mv into a Linux web server folder' }, async () => {
  const rel = path.join(work, 'release');
  const siteA = path.join(work, 'site-a');
  const siteB = path.join(work, 'site-b');
  for (const d of [rel, siteA, siteB]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(rel, 'Ironleaf.AppImage'), 'ABCD');
  writeFileSync(path.join(rel, 'Ironleaf-9.0.0.AppImage'), 'ABCD');
  await writeSignedLatest(rel, latest({ version: '9.0.0', date: '2026-11-20', notes: 'Release words' }));
  // A version above anything CHANGELOG.md has, so this release is on top whatever the bundled history holds.
  // Site A already lists a release the bundled history does not have; site B has nothing yet.
  writeFileSync(path.join(siteA, 'versions.json'), JSON.stringify({ versions: [{ version: '1.0.9', date: '2026-11-18', notes: 'Only on the site' }] }));
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'release.mjs'), '--publish-only'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: publishEnv({ NV_RELEASE_DIR: rel, NV_DOWNLOAD_DIR: `${siteA}:${siteB}` }) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /versions\.json, then latest\.json last/);
  const a = JSON.parse(readFileSync(path.join(siteA, 'versions.json'), 'utf8')).versions;
  const b = JSON.parse(readFileSync(path.join(siteB, 'versions.json'), 'utf8')).versions;
  assert.equal(a[0].version, '9.0.0');
  assert.equal(a[0].notes, 'Release words', 'the release’s own notes, not the bundled ones');
  assert.ok(a.some((e) => e.version === '1.0.9' && e.notes === 'Only on the site'), 'what the site had is kept');
  assert.ok(!b.some((e) => e.version === '1.0.9'), 'each folder keeps its own list');
  assert.ok(b.some((e) => e.version === '1.0.0'), 'a new list starts with the bundled history');
  for (const site of [siteA, siteB]) {
    assert.ok(existsSync(path.join(site, 'latest.json')));
    assert.equal(readFileSync(path.join(site, 'latest.json.sig'), 'utf8'), readFileSync(path.join(rel, 'latest.json.sig'), 'utf8'), 'the signature is published with it');
    assert.deepEqual(readdirSync(site).filter((n) => n.startsWith('.')), [], 'no temporary files left');
  }
  assert.deepEqual(readdirSync(rel).filter((n) => n.startsWith('versions-publish')), [], 'the per-folder lists are cleaned up');
  // Publishing again appends nothing twice.
  const again = spawnSync(process.execPath, [path.join(root, 'tools', 'release.mjs'), '--publish-only'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: publishEnv({ NV_RELEASE_DIR: rel, NV_DOWNLOAD_DIR: siteA }) });
  assert.equal(again.status, 0, again.stderr);
  const a2 = JSON.parse(readFileSync(path.join(siteA, 'versions.json'), 'utf8')).versions;
  assert.equal(a2.filter((e) => e.version === '9.0.0').length, 1);
  assert.equal(a2.length, a.length);
});

test('the order in release.mjs: versions.json is installed and renamed just before latest.json, which stays last', () => {
  const src = readFileSync(path.join(root, 'tools', 'release.mjs'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("'versions.json', '0644'"));
  assert.ok(line, 'versions.json is in the publish list');
  assert.ok(line.indexOf("'versions.json'") < line.indexOf("'latest.json'"), 'versions.json before latest.json');
  assert.match(line, /\[latestFile, 'latest\.json', '0644'\]\];$/, 'latest.json is the last entry');
  // The signature goes up before latest.json, so a client never reads a latest.json whose .sig is the old one.
  assert.ok(src.indexOf("files.push([sigFile, 'latest.json.sig', '0644'])") > 0 && src.indexOf("files.push([sigFile, 'latest.json.sig', '0644'])") < src.indexOf(line), 'latest.json.sig before latest.json');
});

test('publish refuses a latest.json whose signature is missing or made by another key', async () => {
  const rel = path.join(work, 'release-badsig');
  const site = path.join(work, 'site-badsig');
  for (const d of [rel, site]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(rel, 'Ironleaf.AppImage'), 'ABCD');
  writeFileSync(path.join(rel, 'Ironleaf-9.0.0.AppImage'), 'ABCD');
  writeFileSync(path.join(rel, 'latest.json'), JSON.stringify(latest({ version: '9.0.0' })));
  const run = () => spawnSync(process.execPath, [path.join(root, 'tools', 'release.mjs'), '--publish-only'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: publishEnv({ NV_RELEASE_DIR: rel, NV_DOWNLOAD_DIR: site }) });
  let r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /latest\.json\.sig is missing/);
  const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(path.join(rel, 'latest.json.sig'), (await S.signLatest(readFileSync(path.join(rel, 'latest.json'), 'utf8'), other)) + '\n');
  r = run();
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(site), [], 'nothing published');
});

/** A release folder signed for 9.0.0 with both AppImage names holding `bytes`. */
async function signedRelease(name, { bytes = 'ABCD', l = latest({ version: '9.0.0' }) } = {}) {
  const rel = path.join(work, `release-${name}`);
  const site = path.join(work, `site-${name}`);
  for (const d of [rel, site]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(rel, 'Ironleaf.AppImage'), bytes);
  writeFileSync(path.join(rel, `Ironleaf-${l.version}.AppImage`), bytes);
  await writeSignedLatest(rel, l);
  const run = () => spawnSync(process.execPath, [path.join(root, 'tools', 'release.mjs'), '--publish-only'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: publishEnv({ NV_RELEASE_DIR: rel, NV_DOWNLOAD_DIR: site }) });
  return { rel, site, run };
}

test('publish refuses a test build (.unpublishable), even signed', async () => {
  const { rel, site, run } = await signedRelease('marked');
  writeFileSync(path.join(rel, '.unpublishable'), 'test build\n');
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /test build/);
  assert.deepEqual(readdirSync(site), []);
});

test('publish refuses a latest.json for another version than package.json', async () => {
  const { site, run } = await signedRelease('other-version', { l: latest({ version: '9.0.1' }) });
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /9\.0\.1.*9\.0\.0/);
  assert.deepEqual(readdirSync(site), []);
});

test('publish refuses a file of the right size whose SHA-256 is not latest.json’s', async () => {
  const { site, run } = await signedRelease('swapped', { bytes: 'WXYZ' });
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not the file latest\.json describes/);
  assert.deepEqual(readdirSync(site), []);
});

test('publish refuses a checkout with uncommitted changes', async () => {
  const { site, run } = await signedRelease('dirty');
  writeFileSync(path.join(checkout, 'stray.txt'), 'not committed');
  try {
    const r = run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /uncommitted changes/);
    assert.deepEqual(readdirSync(site), []);
  } finally {
    rmSync(path.join(checkout, 'stray.txt'), { force: true });
  }
});

test('a --version or --test-identity build is never signed and is marked unpublishable', () => {
  const src = readFileSync(path.join(root, 'tools', 'release.mjs'), 'utf8');
  assert.match(src, /const testBuild = Boolean\(value\('--version'\)\) \|\| testIdentity;/);
  assert.match(src, /const signingKey = testBuild \? null : signingKeyFromEnv\(\);/);
  assert.match(src, /if \(testBuild\) writeFileSync\(path\.join\(releaseDir, UNPUBLISHABLE\)/);
  // Nothing is carried over from a test build into a real one.
  assert.match(src, /if \(!existsSync\(path\.join\(releaseDir, UNPUBLISHABLE\)\)\) earlier = JSON\.parse/);
});
