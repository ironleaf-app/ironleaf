// node --test tests/vault-settings-look.test.mjs — Vault settings in the Endless Tech look (10.0 Wave 5: every
// section grouped around jobs as the former host app's are, one row style, square switches, underlined tabs,
// one focus ring, no pills, sentence case, tokens only, no em dashes; light first, dark from the same tokens).
// Every check fails without its change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-setlook-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (p) => readFileSync(path.join(root, p), 'utf8');
const settingsTsx = () => read('src/renderer/src/components/Settings.tsx');
/** The rail's sections as Settings draws them (id, label, icon). */
const sections = () => [...settingsTsx().matchAll(/\{ id: '([a-z-]+)', label: '([^']+)', icon:/g)].map((m) => ({ id: m[1], label: m[2] }));
/** Code and words only: block and line comments hold the person's quoted words, not product words. */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
/** Rules only: comments hold the canonical values' own discussion, never rules. */
const rulesOf = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('the 15 sections sit in 5 job groups, each section exactly once', () => {
  const groups = S.SETTINGS_JOB_GROUPS;
  assert.equal(groups.length, 5, 'You, AI, Connections, Your work, Help (3 Nov 2026 polish, as the host app)');
  assert.deepEqual(groups.map((g) => g.label), ['You', 'AI', 'Connections', 'Your work', 'Help']);
  const covered = groups.flatMap((g) => g.sections);
  assert.equal(covered.length, 15, 'Account and plan, Teams and About joined the twelve');
  assert.equal(new Set(covered).size, 15, 'no section twice, none missing');
  assert.deepEqual([...covered].sort(), sections().map((s) => s.id).sort(), 'the groups are the rail');
});

test('every section is reachable: in the rail, with its render branch and its one line', () => {
  const tsx = settingsTsx();
  assert.ok(tsx.includes('SETTINGS_JOB_GROUPS'), 'the rail renders the job groups, not a flat list');
  assert.ok(tsx.includes('set-nav-group') && tsx.includes('set-nav-name'), 'each group names itself above its sections');
  const rendered = [...tsx.matchAll(/current === '([a-z-]+)'/g)].map((m) => m[1]);
  for (const s of sections()) {
    assert.ok(rendered.includes(s.id), `${s.id} has its render branch in SettingsPage`);
    const group = S.SETTINGS_GROUPS.find((g) => g.id === s.id);
    assert.ok(group, `${s.id} is a settings group`);
    assert.ok(group.words && !group.words.includes('\n'), `${s.id} says what it does in one line`);
    assert.ok(!group.words.includes('—'), `${s.id}: no em dash in its line`);
  }
  assert.equal(sections().length, 15);
});

test('every old link still resolves to a live section', () => {
  const live = new Set(sections().map((s) => s.id));
  for (const id of [...Object.keys(S.LEGACY_SECTIONS), ...sections().map((s) => s.id), undefined, 'no-such-section']) {
    assert.ok(live.has(S.resolveSection(id)), `${id ?? '(none)'} lands on a live section`);
  }
  // The ids callers still send (menus, palette, notices, moves).
  assert.equal(S.resolveSection('files'), 'general');
  assert.equal(S.resolveSection('capture'), 'quick-add');
  assert.equal(S.resolveSection('modules'), 'packs');
  assert.equal(S.resolveSection('templates'), 'general');
  assert.equal(S.resolveSection('appearance'), 'look');
});

test('every search result still lands on a live section, in honest words', () => {
  const live = new Set(sections().map((s) => s.id));
  for (const e of S.SETTINGS_INDEX) {
    assert.ok(live.has(e.section), `${e.title}: no section ${e.section}`);
    assert.ok(!`${e.title} ${e.hint ?? ''}`.includes('—'), `${e.title}: no em dash`);
  }
  const colours = S.SETTINGS_INDEX.find((e) => e.title === 'Colours');
  assert.ok(colours && colours.hint.includes('White') && colours.hint.includes('Bright'), 'the Colours hint names the looks');
  for (const id of ['white', 'bright', 'sky', 'mint', 'lavender', 'blush', 'sunny', 'paper', 'ocean', 'lagoon', 'forest', 'rose', 'cocoa', 'dusk'])
    assert.ok(colours.words.includes(id), `search finds ${id} under Colours`);
});

test('no em dash in any settings words', () => {
  for (const f of [
    'src/renderer/src/components/Settings.tsx',
    'src/renderer/src/components/CaptureSettings.tsx',
    'src/renderer/src/components/CaptureFlowsSettings.tsx',
    'src/renderer/src/components/BackupSettings.tsx',
    'src/renderer/src/components/AgentsSettings.tsx',
    'src/renderer/src/components/PrivacySettings.tsx',
    'src/renderer/src/components/PublishSettings.tsx',
    'src/renderer/src/components/NoteTypesSettings.tsx',
    'src/renderer/src/components/ExternalSettings.tsx',
    'src/renderer/src/components/ModulesSettings.tsx',
    'src/renderer/src/components/PortableExport.tsx',
    'src/renderer/src/lib/settingsSearch.ts',
  ])
    assert.ok(!codeOf(read(f)).includes('—'), `${f}: an em dash in product words`);
});

test('sentence case in settings scope: headings read as written, never tracked caps', () => {
  const css = rulesOf(read('src/renderer/src/styles/settings-87.css'));
  assert.ok(!/text-transform:\s*uppercase/.test(css), 'no uppercase transform in the settings sheet');
  assert.ok(css.includes('.settings-page .settings-body h3') && css.includes('text-transform: none'), 'section headings pin sentence case');
  for (const g of S.SETTINGS_JOB_GROUPS) assert.ok(!/[A-Z]{3,}/.test(g.label), `${g.label}: no all-caps`);
  for (const s of sections()) assert.ok(!/[A-Z]{3,}/.test(s.label), `${s.label}: no all-caps`);
});

test('no raw colours in settings scope: tokens only, so no cream ground can creep in', () => {
  const css = rulesOf(read('src/renderer/src/styles/settings-87.css'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hex in the settings sheet');
  assert.ok(!/\brgba?\s*\(/.test(css) && !/\bhsla?\s*\(/.test(css), 'no rgb/hsl in the settings sheet');
  for (const f of [
    'src/renderer/src/components/Settings.tsx',
    'src/renderer/src/components/CaptureSettings.tsx',
    'src/renderer/src/components/CaptureFlowsSettings.tsx',
    'src/renderer/src/components/BackupSettings.tsx',
    'src/renderer/src/components/AgentsSettings.tsx',
    'src/renderer/src/components/PrivacySettings.tsx',
    'src/renderer/src/components/PublishSettings.tsx',
    'src/renderer/src/components/NoteTypesSettings.tsx',
    'src/renderer/src/components/ExternalSettings.tsx',
    'src/renderer/src/components/ModulesSettings.tsx',
    'src/renderer/src/components/PortableExport.tsx',
  ])
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOf(read(f))), `${f}: no inline hex`);
});

test('no pills in settings scope: square-ish radii, underlined tabs, one ring', () => {
  const css = rulesOf(read('src/renderer/src/styles/settings-87.css'));
  assert.ok(!/99px/.test(css), 'no pill radius in the settings sheet');
  for (const m of css.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+);/g)) {
    const rest = m[1].replace(/var\(--r-[1-4]\)/g, '').replace(/50%/g, '').replace(/(?<![\d.])0(?![\d.])/g, '').replace(/!important/g, '');
    assert.ok(!/\d/.test(rest), `a radius off the scale (${m[1].trim()})`);
  }
  assert.ok(css.includes('.settings-page :focus-visible') && css.includes('2px solid var(--focus)'), 'the one ring is pinned in settings scope');
  assert.ok(!css.includes('--focus-ring'), 'the ring is Focus, never the accent-pointed alias');
  assert.ok(!/className="[^"]*\bpill\b/.test(settingsTsx()), 'no pill class in Settings');
});
