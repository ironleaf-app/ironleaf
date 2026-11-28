// node --test tests/w4a-87.test.mjs — Settings and the private places (8.7 w4a, 30 Oct 2026): the sixteen sections
// folded into the mock-ups' ten groups, every old setting with a home; Packs switched on and off in one place; Home
// cards arranged here too; Secrets locked/unlocked/added/a login's page; Private notes; Recently deleted with
// Restore; Earlier versions compared against current and put back; Import keeping its real paths. Fails without each
// change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-w4a-'));
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
const settings = () => read('src/renderer/src/components/Settings.tsx');

test('groups in the rail’s order, each with plain words (8.9: Calendar and Plugins join the ten)', () => {
  assert.deepEqual(
    S.SETTINGS_GROUPS.map((g) => [g.id, g.label]),
    [['general', 'General'], ['look', 'Look'], ['home', 'Home cards'], ['packs', 'Packs'], ['quick-add', 'Capture'], ['backups', 'Backups and sync'], ['keys', 'Keyboard shortcuts'], ['models', 'AI'], ['privacy', 'Privacy and secrets'], ['agents', 'Connect an AI'], ['plugins', 'Plugins'], ['publish', 'Publish'], ['about', 'About and updates'], ['account', 'Account and plan'], ['teams', 'Teams']],
  );
  for (const g of S.SETTINGS_GROUPS) assert.ok(g.words && g.words.length > 10, `${g.id} says what it holds`);
  const order = ['General', 'Look', 'Home cards', 'Packs', 'Capture', 'Backups and sync', 'Keyboard shortcuts', 'AI', 'Privacy and secrets', 'Connect an AI', 'Plugins', 'Publish', 'About and updates'];
  const src = settings();
  let at = -1;
  for (const label of order) {
    const next = src.indexOf(`label: '${label}'`, at + 1);
    assert.ok(next > at, `${label} follows in order`);
    at = next;
  }
});

test('every old section id still opens its group; the unknown opens General', () => {
  assert.deepEqual(
    Object.entries(S.LEGACY_SECTIONS).sort((a, b) => a[0].localeCompare(b[0])),
    [['agents', 'agents'], ['ai', 'models'], ['appearance', 'look'], ['backup', 'backups'], ['capture', 'quick-add'], ['daily', 'home'], ['editor', 'general'], ['files', 'general'], ['general', 'general'], ['keys', 'keys'], ['models', 'models'], ['modules', 'packs'], ['plan', 'account'], ['privacy', 'privacy'], ['recovery', 'backups'], ['search', 'general'], ['templates', 'general'], ['types', 'general'], ['updates', 'about']],
  );
  for (const g of S.SETTINGS_GROUPS) assert.equal(S.resolveSection(g.id), g.id);
  for (const [old, group] of Object.entries(S.LEGACY_SECTIONS)) assert.equal(S.resolveSection(old), group);
  assert.equal(S.resolveSection(undefined), 'general');
  assert.equal(S.resolveSection('no-such-section'), 'general');
  assert.ok(settings().includes('resolveSection(tab.path)'), 'the page shows the group its tab names');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('export function openSettings'), 'asking for a group opens the page');
  assert.ok(read('src/renderer/src/App.tsx').includes("A.openSettings(section, 'current', row)"), 'every caller that asked for the window lands on the page, with its row when one was named (4 Nov 2026 doors)');
});

test('settings is a page: the crumb says Settings, search first in the rail, one head per group, never a jump', () => {
  const src = settings();
  assert.ok(src.includes('export function SettingsPage'), 'a page, not a dialog');
  assert.ok(!src.includes('SettingsModal') && !src.includes('className="overlay"'), 'no dialog left');
  assert.ok(src.includes('crumb={<b>Settings</b>}'), 'the crumb says Settings');
  const nav = src.slice(src.indexOf('<nav className="settings-nav"'), src.indexOf('</nav>'));
  assert.ok(nav.indexOf('<SettingsSearchBox') < nav.indexOf('{SETTINGS_JOB_GROUPS.map'), 'the search box sits above the groups (grouped around jobs, 10.0)');
  assert.ok(src.includes('<h1>{SECTIONS.find((s) => s.id === current)?.label}</h1>'), 'one head per group');
  assert.ok(src.includes('SECTION_WORDS[current]'), 'each group says what it holds');
  const css = read('src/renderer/src/styles/settings-87.css');
  assert.ok(css.includes('.settings.settings-page'), 'the page keeps the tools’ selectors');
  assert.ok(css.includes('max-width: 980px'), 'the frame never resizes between groups');
  // p25 one column spells the gutter stable both-edges (one-sided sat the centred column off the rooms'): still
  // stable, so groups never jump, and symmetric now. The pin follows the spelling without weakening it.
  assert.ok(css.includes('.settings-scroll { scrollbar-gutter: stable both-edges; }'), 'no sideways jump as groups scroll');
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("'settings'"), 'settings is a place');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('<SettingsPage key={tab.id} tab={tab} />'), 'the place draws');
});

test('every setting today has a home: the moves', () => {
  const src = settings();
  // [row title, group body proof it lives in]
  const homed = [
    ['Day notes go', 'function DayNote'],
    ['Day notes start with', 'function DayNote'],
    ['Weekly review reminder', 'function WeeklyReviewRows'],
    ['Meeting microphone', 'function MeetingRecordingRows'],
    ['After notes are made', 'function MeetingRecordingRows'],
    ['Dictation microphone', 'function DictationRow'],
    ['Bin', 'function BackupsGroup'],
    ['Import', 'function BackupsGroup'],
    ['Home cards', 'function HomeGroup'],
    ['On Today', 'function TodayChips'],
  ];
  for (const [title, body] of homed) {
    const at = src.indexOf(body);
    assert.ok(at >= 0, body);
    assert.ok(src.indexOf(`title="${title}"`, at) > at && src.indexOf(`title="${title}"`, at) < src.indexOf('\n}\n', at) + 3 + 20000, `${title} lives under ${body}`);
  }
  assert.ok(read('src/renderer/src/components/PrivacySettings.tsx').includes('title="Private notes"'), 'Private notes opens from Privacy and secrets');
  // The old Keys/Models headings did not duplicate the group head.
  assert.ok(src.includes('<h3>Every command</h3>'), 'keys lists every command under its head');
  assert.ok(!src.includes('<h3>Models</h3>') && !src.includes('<h3>Keys</h3>'), 'no heading repeats its group head');
});

test('packs: seventeen rows from the catalogue, one switch each, details under the row tapped', () => {
  const src = read('src/renderer/src/components/ModulesSettings.tsx');
  assert.ok(src.includes('LIFE_MODULES.map'), 'every module in the catalogue shows');
  assert.ok(src.includes('data-setting={m.name}'), 'each pack is findable by its name');
  assert.ok(!/["']Family["']|["']Health and Fitness["']|["']Vehicles["']|["']Finance["']/.test(src), 'no pack name hard-coded: the catalogue names them');
  assert.ok(src.includes('<Toggle value={on}') && src.includes('setModule(m.id, v)'), 'one switch per pack');
  assert.ok(src.includes('setModule(m.id, e.target.checked, p.id)'), 'each part keeps its switch');
  assert.ok(src.includes('openModule(m.id)'), 'a pack still opens');
  assert.ok(src.includes('<ModuleTour module={m}'), 'its tour still shows');
  const css = read('src/renderer/src/styles/settings-87.css');
  assert.ok(css.includes('.packrow-words .nm { display: block;'), 'the name sits over its line, never run into it');
  assert.ok(css.includes('.packrow-ctl { margin-left: auto;'), 'the switch sits at the right edge, off the words');
  const names = S.SETTINGS_INDEX.filter((e) => e.section === 'packs').map((e) => e.title);
  // Seventeen since the packs uplift item 5 (5 Nov 2026): Memories merged into Family.
  assert.equal(names.length, 17);
  assert.equal(new Set(names).size, 17, 'every pack keeps its own name');
  assert.ok(names.every((n) => n && n.length > 1));
});

test('home cards: the same arrangement Change Home keeps, toggled and moved here', () => {
  const src = settings();
  assert.ok(src.includes("window.nv.state.load('home-cards')"), 'reads the arrangement');
  assert.ok(src.includes("window.nv.state.save('home-cards', next)"), 'keeps it per vault');
  assert.ok(src.includes('setHomeCard(layout, def.id, v)'), 'cards switch on and off');
  assert.ok(src.includes('moveHomeCard(layout, id, layout.on.indexOf(id) + dir)'), 'cards move up and down');
  assert.ok(src.includes('Switch on the ${def.pack!.name} pack'), 'a pack-locked card says what unlocks it');
});

test('secrets: unlock once, masked always, shown values hide, nothing secret is logged', () => {
  const src = read('src/renderer/src/views/SecretsView.tsx') + read('src/renderer/src/views/LockedView.tsx');
  assert.ok(src.includes('unlockedPhrase(prefs.secretsKeepUnlocked'), 'the page says the unlock-once timing');
  assert.ok(src.includes('withStepUp(() => window.nv.secrets.reveal(id))'), 'a value reaches the window only on reveal');
  assert.ok(src.includes('20_000'), 'shown values hide again after 20 seconds');
  assert.ok(src.includes('window.nv.secrets.copy(id)'), 'copies clear the clipboard themselves');
  assert.ok(!src.includes('console.log'), 'no logging on the secrets page');
  assert.ok(src.includes('Add its login') && src.includes('Save to Secrets'), 'adding has its page');
  assert.ok(src.includes('Linked from · {') && src.includes('Delete this login'), 'a login has its page');
  // 10.0 v2locked: Find in notes and Activity are tabs on the one Locked page.
  assert.ok((src.includes("A.openSecrets('scan')") && src.includes("part === 'activity'")) || (src.includes("{ id: 'scan', label: 'Find in notes' }") && src.includes("{ id: 'activity', label: 'Activity' }")), 'find-in-notes and the trail stay reachable');
});

test('versions is a page: copies down the left with their counts, the words at the right, put back kept', () => {
  const src = read('src/renderer/src/components/Extras.tsx');
  assert.ok(src.includes('export function VersionsPage'), 'a page, not a dialog');
  assert.ok(!src.includes('RecoveryModal'), 'no dialog left');
  assert.ok(src.includes('<b>Earlier versions</b>'), 'the crumb names the page');
  assert.ok(src.includes('Against current'), 'the preview is against the current copy');
  assert.ok(src.includes('wordParts('), 'changed words show inside their lines');
  assert.ok(src.includes('<del') && src.includes('<ins'), 'taken out struck through, put in tinted');
  assert.ok(src.includes("window.nv.notes.write(chosen, text, 'restored')"), 'putting back keeps the now as a version first');
  assert.ok(src.includes('Put this one back') && src.includes('Back to current'), 'the mock-up’s words');
  assert.ok(src.includes('>Preview</button>') && src.includes('>Put back</button>'), 'each copy previews and puts back');
  assert.ok(src.includes('words changed'), 'each copy says how much changed');
  assert.ok(src.includes('byWords(shownVersion)'), 'who made each change still shows');
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("'versions'"), 'versions is a place');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('<VersionsPage key={tab.id} tab={tab} />'), 'the place draws');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('export function openVersions'), 'it opens like other places');
  assert.ok(read('src/renderer/src/App.tsx').includes('A.openVersions(path)'), 'every caller that asked for the window lands on the page');
});

test('import keeps its real paths and undoes to the bin', () => {
  assert.ok(read('src/renderer/src/state/workspace.ts').includes("'import'"), 'import is a place');
  assert.ok(read('src/renderer/src/views/Workspace.tsx').includes('<ImportView key={tab.id} tab={tab} />'), 'the place draws');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('export function openImport'), 'it opens like other places');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'import'"), 'the palette reaches it');
  const view = read('src/renderer/src/views/ImportView.tsx');
  assert.ok(view.includes('importCsv({ picked') && view.includes('importMarkdownFiles(texts'), 'dropped files take the real paths');
  assert.ok(view.includes('<ImportDialog') && view.includes('<PairDialog'), 'folders, vault exports and other apps keep their dialog');
  assert.ok(view.includes('window.nv.vault.pick()'), 'a folder still reads where it is');
  const kept = read('src/renderer/src/state/imports.ts');
  assert.ok(kept.includes('A.trashPaths(v.paths)'), 'undo sends the notes to the bin');
  assert.ok(read('src/renderer/src/state/importCsv.ts').includes('opts.onDone?.(made, where, picked.name)'), 'a spreadsheet import is remembered for undo');
});

test('the w4a styles ride the tokens, before the kit; square switches in settings, on in primary as the host app (10.0)', () => {
  const main = read('src/renderer/src/main.tsx');
  assert.ok(main.includes("import './styles/settings-87.css';"), 'the w4a styles load');
  assert.ok(main.indexOf('styles/settings-87.css') < main.indexOf('styles/kit.css'), 'before the kit, which keeps the last word');
  const css = read('src/renderer/src/styles/settings-87.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(css), 'no literal colours: tokens only');
  assert.ok(!/cream|beige|#faf8f4/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'never any cream');
  const sw = css.match(/\.settings-body input\[type='checkbox'\]\.switch \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(sw.includes('border-radius: var(--r-1)') && sw.includes('width: 44px') && sw.includes('height: 24px') && /\.switch:checked \{ background: var\(--primary\); \}/.test(css), 'square toggles, on in primary');
});

test('no warm fill in the settings styles: at risk is a small tag, never a beige panel', () => {
  const files = ['src/renderer/src/styles/settings-87.css', 'src/renderer/src/styles/vault-place.css', 'src/renderer/src/styles/vault-sync.css', 'src/renderer/src/styles/vault-home.css'];
  for (const f of files) {
    const css = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/:root(\[data-theme='dark'\])?\s*\{[^}]*\}/g, '');
    assert.ok(!/vp-warn-bg|vp-warn-line|vp-warn\b/.test(css), `${f}: no warm panel variables`);
    assert.ok(!/#fbf3e4|#faf8f4|#ecd7ae|#e3b25e|#f5efe[0-9a-f]?|beige|cream/i.test(css), `${f}: no warm fills`);
  }
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('tag slate'), 'general tags only-on-this-pc');
  assert.ok(read('src/renderer/src/components/VaultSync.tsx').includes('tag amber'), 'sync tags at risk');
  assert.ok(read('src/renderer/src/components/VaultHome.tsx').includes('tag amber'), 'the warning tags at risk');
});

test('no engine names in the new words', () => {
  const files = ['src/renderer/src/lib/settingsSearch.ts', 'src/renderer/src/components/Settings.tsx', 'src/renderer/src/components/ModulesSettings.tsx', 'src/renderer/src/views/SecretsView.tsx', 'src/renderer/src/views/PrivateView.tsx', 'src/renderer/src/views/BinView.tsx', 'src/renderer/src/views/ImportView.tsx', 'src/renderer/src/components/Extras.tsx', 'src/renderer/src/components/VaultSync.tsx', 'src/renderer/src/components/VaultHome.tsx', 'src/renderer/src/state/imports.ts'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/\bdeepseek\b/i.test(src), `${f}: no DeepSeek`);
    assert.ok(!/\bpi-ai\b/i.test(src), `${f}: no pi-ai`);
  }
});
