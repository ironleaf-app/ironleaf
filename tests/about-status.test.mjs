// node --test tests/about-status.test.mjs — the update card on Settings › About and updates (src/renderer/src/lib/
// aboutStatus.ts, 20 Nov 2026): for every place an update can be at, the words, the one primary button and what it
// does, the second button, and the progress; plus "checked 2 min ago" and the sidebar's nudge.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-about-status-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'renderer', 'src', 'lib', 'aboutStatus.ts'), platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-20T10:00:00Z');
const MB = 1048576;
const base = (over = {}) => ({ enabled: true, autoDownload: true, current: '2.0.1', available: null, checkedAt: null, stage: 'idle', progress: null, error: null, updated: null, failed: null, installsOnQuit: false, ...over });
const avail = (over = {}) => ({ version: '2.0.2', date: '2026-11-28', notes: '- Faster search', canInstall: true, size: 80 * MB, dismissed: false, ...over });
const ctx = (over = {}) => ({ checking: false, checkFailed: false, now: NOW, ...over });
const card = (state, c = {}) => S.updateCard(state, ctx(c));

test('never checked: Check for updates, with what it does or that automatic checks are off', () => {
  const c = card(base());
  assert.equal(c.stage, 'never');
  assert.deepEqual(c.primary, { label: 'Check for updates', action: 'check' });
  assert.match(c.detail, /once a day/);
  assert.match(card(base({ enabled: false })).detail, /Automatic checks are off/);
});

test('checking: the button says Checking… and cannot be pressed twice', () => {
  const c = card(base(), { checking: true });
  assert.equal(c.stage, 'checking');
  assert.equal(c.title, 'Checking for updates…');
  assert.deepEqual(c.primary, { label: 'Checking…', action: 'none', disabled: true });
});

test('up to date: the version and when it was checked', () => {
  const c = card(base({ checkedAt: new Date(NOW - 2 * 60_000).toISOString() }));
  assert.equal(c.stage, 'current');
  assert.equal(c.title, 'You’re up to date');
  assert.equal(c.detail, 'Ironleaf 2.0.1 is the newest version · checked 2 min ago');
  assert.equal(c.primary.action, 'check');
  assert.equal(c.tone, 'ok');
});

test('a check that got no answer: plain words, Try again and the website', () => {
  const c = card(base({ checkedAt: new Date(NOW - 3 * 3600_000).toISOString() }), { checkFailed: true });
  assert.equal(c.stage, 'check-failed');
  assert.equal(c.tone, 'error');
  assert.match(c.detail, /did not answer/);
  assert.match(c.detail, /Last checked 3 h ago/);
  assert.deepEqual(c.primary, { label: 'Try again', action: 'check' });
  assert.deepEqual(c.secondary, { label: 'Download from the website', action: 'website' });
});

test('available: the version, its date, size and notes, and Update now (or Download where it cannot install)', () => {
  const c = card(base({ available: avail(), checkedAt: new Date(NOW).toISOString() }));
  assert.equal(c.stage, 'available');
  assert.equal(c.title, 'Ironleaf 2.0.2 is available');
  assert.match(c.detail, /You have 2\.0\.1\. Released 28 November 2026 · 80 MB\./);
  assert.equal(c.notes, '- Faster search');
  assert.equal(c.notesVersion, '2.0.2');
  assert.deepEqual(c.primary, { label: 'Update now', action: 'download' });
  assert.deepEqual(card(base({ available: avail({ canInstall: false }) })).primary, { label: 'Download', action: 'website' });
});

test('downloading: a progress bar in percent and the MB words; then checking the download at 100', () => {
  const c = card(base({ available: avail(), stage: 'downloading', progress: { received: 20 * MB, total: 80 * MB, differential: false } }));
  assert.equal(c.stage, 'downloading');
  assert.equal(c.progress, 25);
  assert.equal(c.detail, '20 of 80 MB');
  assert.equal(c.primary.disabled, true);
  assert.match(card(base({ available: avail(), stage: 'downloading', progress: { received: 2 * MB, total: 8 * MB, differential: true } })).detail, /2\.0 of 8\.0 MB \(only what changed\)/);
  assert.equal(card(base({ available: avail(), stage: 'downloading' })).progress, 0);
  const v = card(base({ available: avail(), stage: 'verifying' }));
  assert.equal(v.stage, 'verifying');
  assert.equal(v.progress, 100);
});

test('ready: Restart to update, saying when it installs; installing: nothing to press', () => {
  const r = card(base({ available: avail(), stage: 'ready' }));
  assert.equal(r.stage, 'ready');
  assert.deepEqual(r.primary, { label: 'Restart to update', action: 'install' });
  assert.match(card(base({ available: avail(), stage: 'ready', installsOnQuit: true })).detail, /next time you quit/);
  const i = card(base({ available: avail(), stage: 'installing' }));
  assert.equal(i.stage, 'installing');
  assert.equal(i.primary.disabled, true);
  // A check pressed while a download runs never hides the download.
  assert.equal(card(base({ available: avail(), stage: 'downloading' }), { checking: true }).stage, 'downloading');
});

test('a download that failed: its words, Try again and the website', () => {
  const c = card(base({ available: avail(), error: 'The download was not the file Ironleaf published.' }));
  assert.equal(c.stage, 'download-failed');
  assert.equal(c.detail, 'The download was not the file Ironleaf published.');
  assert.deepEqual(c.primary, { label: 'Try again', action: 'download' });
  assert.equal(c.secondary.action, 'website');
});

test('an install that did not land: what happened, still on the old version, Try again or the website', () => {
  const c = card(base({ available: avail(), failed: { version: '2.0.2', words: 'The installer stopped.' } }));
  assert.equal(c.stage, 'install-failed');
  assert.match(c.detail, /The installer stopped\. You are still on 2\.0\.1/);
  assert.deepEqual(c.primary, { label: 'Try again', action: 'download' });
  assert.equal(c.secondary.label, 'Download from the website');
  assert.equal(card(base({ failed: { version: '2.0.2', words: 'x' } })).primary.action, 'check');
});

test('after the restart: Updated to X with that release’s notes', () => {
  const c = card(base({ current: '2.0.2', updated: { version: '2.0.2', from: '2.0.1', notes: '- Faster search' } }));
  assert.equal(c.stage, 'updated');
  assert.equal(c.title, 'Updated to 2.0.2');
  assert.match(c.detail, /From 2\.0\.1/);
  assert.equal(c.notes, '- Faster search');
  assert.equal(c.primary.action, 'check');
});

test('no update check in this copy: the website instead', () => {
  const c = S.updateCard(null, ctx());
  assert.equal(c.stage, 'unavailable');
  assert.equal(c.primary.action, 'website');
});

test('every stage has words and a button or a reason not to', () => {
  const states = [base(), base({ checkedAt: new Date(NOW).toISOString() }), base({ available: avail() }), base({ available: avail(), stage: 'downloading' }), base({ available: avail(), stage: 'verifying' }), base({ available: avail(), stage: 'ready' }), base({ available: avail(), stage: 'installing' }), base({ available: avail(), error: 'x' }), base({ failed: { version: '2.0.2', words: 'x' } }), base({ updated: { version: '2.0.1', from: '2.0.0', notes: '' } })];
  const seen = new Set();
  for (const st of states) for (const c of [{}, { checking: true }, { checkFailed: true }]) {
    const k = card(st, c);
    seen.add(k.stage);
    assert.ok(k.title && k.detail, `${k.stage} has words`);
    assert.ok(k.primary, `${k.stage} has its button`);
    assert.doesNotMatch(k.title + k.detail, /NeuralSpark|NeuralVault|undefined|null/);
  }
  assert.equal(seen.size, 12);
});

test('ago and the sidebar nudge', () => {
  assert.equal(S.ago(null, NOW), '');
  assert.equal(S.ago(new Date(NOW - 10_000).toISOString(), NOW), 'just now');
  assert.equal(S.ago(new Date(NOW - 30 * 3600_000).toISOString(), NOW), 'yesterday');
  assert.match(S.ago(new Date(NOW - 6 * 86400_000).toISOString(), NOW), /^on \d+ Nov/);
  assert.deepEqual(S.updateNudge(base()), { words: '', dot: false });
  assert.deepEqual(S.updateNudge(base({ available: avail() })), { words: 'Ironleaf 2.0.2 is available', dot: true });
  assert.equal(S.updateNudge(base({ available: avail({ dismissed: true }) })).dot, false, 'Later quiets the dot');
  assert.equal(S.updateNudge(base({ available: avail({ dismissed: true }), stage: 'ready' })).dot, true, 'a ready update always shows');
});

test('announced but not on the site yet: a quiet "not ready to download yet", Check for updates, no website button', () => {
  const c = card(base({ available: avail(), error: 'This version is not available to download yet. Ironleaf tries again at its next check.', missing: true }));
  assert.equal(c.stage, 'download-failed');
  assert.equal(c.tone, 'idle');
  assert.match(c.title, /not ready to download yet/);
  assert.equal(c.primary.action, 'check');
  assert.equal(c.secondary, null);
});
