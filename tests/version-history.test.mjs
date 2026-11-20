// node --test tests/version-history.test.mjs — Ironleaf's version history (src/shared/version-history.ts, 20 Nov 2026):
// CHANGELOG.md read into releases, versions.json read safely, the bundled and online lists merged into one (one entry
// a version, the online words first, newest first), the release tool's append, and the notes as lines to show.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-version-history-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src', 'shared', 'version-history.ts'), platform: 'node', output: { file: path.join(work, 'h.mjs'), format: 'esm' }, logLevel: 'silent' });
  H = await import(pathToFileURL(path.join(work, 'h.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the bundled CHANGELOG.md: every release with its date and notes, newest first, this version on top', () => {
  const list = H.parseChangelog(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  assert.ok(list.length >= 5);
  assert.equal(list[0].version, JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, 'the version being built is on top');
  const v2 = list.find((e) => e.version === '2.0.0');
  assert.ok(v2, '2.0.0 is in the history');
  assert.equal(v2.date, '2026-11-20');
  assert.match(v2.notes, /NeuralVault/, 'the rename is explained');
  assert.match(v2.notes, /MCP/);
  assert.match(v2.notes, /tray/);
  assert.match(v2.notes, /Ask before the assistant changes a note/);
  assert.ok(list.some((e) => e.version === '1.0.0' && e.date === '2026-10-16'));
  for (const e of list) assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `${e.version} has a date`);
  assert.doesNotMatch(list.map((e) => e.notes).join('\n'), /^#+ /m, 'no heading leaks into notes');
});

test('changelog headings in the usual shapes; text before the first release and odd headings are left out', () => {
  const md = ['# History', 'Intro words.', '', '## [2.1.0] - 2026-12-01', '### Added', '- One', '- Two', '', '## Ironleaf v2.0.1 (2026-11-25)', '- Fix', '', '## Unreleased', '- Not a release', '', '## 2.0 — 2026-11-20', '* Old star bullet'].join('\r\n');
  const list = H.parseChangelog(md);
  assert.deepEqual(list.map((e) => [e.version, e.date]), [['2.1.0', '2026-12-01'], ['2.0.1', '2026-11-25'], ['2.0.0', '2026-11-20']]);
  assert.equal(list[0].notes, '### Added\n- One\n- Two');
  assert.equal(list[1].notes, '- Fix', '"Unreleased" and its lines are not taken into 2.0.1');
  assert.deepEqual(H.parseChangelog(''), []);
  assert.deepEqual(H.parseChangelog('no headings at all'), []);
});

test('merge: online first wins its words, bundled fills gaps, one entry a version, newest first', () => {
  const bundled = [
    { version: '2.0.0', date: '2026-11-20', notes: 'Bundled 2.0.0' },
    { version: '1.0.3', date: '2026-11-17', notes: 'Bundled 1.0.3' },
  ];
  const online = [
    { version: 'v2.0.2', date: '2026-11-28', notes: 'Online 2.0.2', sizes: { linux: 10 } },
    { version: '2.0.0', date: '', notes: '', sizes: { windows: 20 } },
    { version: '2.0.1', date: '2026-11-25', notes: 'Online 2.0.1' },
    { version: '2.0.1', date: '2026-11-26', notes: 'Duplicate later in the list' },
  ];
  const list = H.mergeVersions(online, bundled);
  assert.deepEqual(list.map((e) => e.version), ['2.0.2', '2.0.1', '2.0.0', '1.0.3']);
  assert.equal(list[1].notes, 'Online 2.0.1', 'the first one seen wins');
  assert.equal(list[2].notes, 'Bundled 2.0.0', 'empty online notes are filled from the bundled list');
  assert.equal(list[2].date, '2026-11-20');
  assert.deepEqual(list[2].sizes, { windows: 20 });
  // Numbers, not strings: 2.0.10 is newer than 2.0.9; a pre-release is below its release.
  assert.deepEqual(H.mergeVersions([{ version: '2.0.9', date: '', notes: '' }, { version: '2.0.10', date: '', notes: '' }, { version: '2.1.0-beta.1', date: '', notes: '' }, { version: '2.1.0', date: '', notes: '' }]).map((e) => e.version), ['2.1.0', '2.1.0-beta.1', '2.0.10', '2.0.9']);
  assert.deepEqual(H.mergeVersions(null, undefined, []), []);
  assert.deepEqual(H.mergeVersions([{ version: 'nope', date: '', notes: '' }]), []);
});

test('versions.json read safely: bad JSON, wrong shapes and bad rows give nothing, never a crash', () => {
  assert.deepEqual(H.parseVersionsJson('{nope'), []);
  assert.deepEqual(H.parseVersionsJson('"a string"'), []);
  assert.deepEqual(H.parseVersionsJson({ versions: 'x' }), []);
  const list = H.parseVersionsJson(JSON.stringify({ versions: [{ version: '2.0.1', date: '2026-11-25', notes: 'Fix\u0007 one', sizes: { linux: 5, windows: -1 } }, { version: 7 }, null, { version: '2.0.0', date: 'last week' }] }));
  assert.deepEqual(list, [{ version: '2.0.1', date: '2026-11-25', notes: 'Fix one', sizes: { linux: 5 } }, { version: '2.0.0', date: '', notes: '' }]);
  assert.equal(H.parseVersionsJson([{ version: '2.0.0', notes: 'x'.repeat(9000) }])[0].notes.length, 4000, 'notes are cut to a sane length');
});

test('the release tool appends: the new release added or replaced, earlier ones kept, CHANGELOG fills the rest', () => {
  const published = JSON.stringify({ versions: [{ version: '2.0.1', date: '2026-11-25', notes: 'As published' }] });
  const latest = { version: '2.0.2', date: '2026-11-28', notes: 'New one', linux: { file: 'Ironleaf.AppImage', size: 111, sha256: 'a' }, windows: { file: 'Ironleaf-Setup.exe', size: 222, sha256: 'b' } };
  const out = H.appendRelease(published, latest, [{ version: '2.0.0', date: '2026-11-20', notes: 'Bundled' }, { version: '2.0.1', date: '2026-11-25', notes: 'Bundled 2.0.1' }]);
  assert.deepEqual(out.versions.map((e) => e.version), ['2.0.2', '2.0.1', '2.0.0']);
  assert.deepEqual(out.versions[0], { version: '2.0.2', date: '2026-11-28', notes: 'New one', sizes: { linux: 111, windows: 222 } });
  assert.equal(out.versions[1].notes, 'As published', 'what was published stays');
  // Publishing the same version again replaces its entry instead of adding a second.
  const again = H.appendRelease(JSON.stringify(out), { ...latest, notes: 'Better words' });
  assert.equal(again.versions.filter((e) => e.version === '2.0.2').length, 1);
  assert.equal(again.versions[0].notes, 'Better words');
  assert.deepEqual(H.appendRelease(null, latest).versions.map((e) => e.version), ['2.0.2'], 'no list yet: it starts with this release');
});

test('notes as lines, the entry for a version, and the channel in words', () => {
  assert.deepEqual(H.noteLines('### Fixed\n- One **bold**\n\n* Two\nThree'), [{ text: 'Fixed', heading: true }, { text: 'One bold', heading: false }, { text: 'Two', heading: false }, { text: 'Three', heading: false }]);
  assert.equal(H.entryFor([{ version: '2.0.0', date: '', notes: 'x' }], 'v2.0')?.notes, 'x');
  assert.equal(H.entryFor([], '2.0.0'), null);
  assert.equal(H.channelOf('2.0.0', true), 'Stable');
  assert.equal(H.channelOf('2.1.0-beta.2', true), 'Beta');
  assert.equal(H.channelOf('2.1.0-rc.1', true), 'Release candidate');
  assert.equal(H.channelOf('2.0.0', false), 'Development build');
});
