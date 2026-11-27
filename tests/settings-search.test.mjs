// node --test tests/settings-search.test.mjs — Settings search (src/renderer/src/lib/settingsSearch.ts; 5.0.0, 19 Oct 2026):
// a setting is found by words from its name, what it says or other words for it, best first; a command by its name, for
// its keys; and every row written in Settings (and Quick capture's and agents' sections) is in the index, so a setting
// added later without an entry fails here instead of being unfindable.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-setsearch-'));
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
const labels = () => Object.fromEntries([...read('src/renderer/src/components/Settings.tsx').matchAll(/\{ id: '([a-z-]+)', label: '([^']+)', icon:/g)].map((m) => [m[1], m[2]]));
const find = (q, extra = []) => S.searchSettings(q, [...S.SETTINGS_INDEX, ...extra], labels()).map((h) => h.entry.title);

test('found by its name, by what it says, and by other words for it', () => {
  assert.equal(find('theme')[0], 'Theme');
  assert.equal(find('dark mode')[0], 'Theme');
  assert.equal(find('zoom')[0], 'Interface size');
  assert.equal(find('interface size')[0], 'Interface size');
  assert.equal(find('compact')[0], 'Density');
  assert.ok(find('spell').includes('Check spelling'));
  assert.ok(find('recycle bin').includes('Ask before deleting'));
  assert.equal(find('note types')[0], 'Your note types'); // the one types entry (8 Nov 2026, the quiet More)
  assert.ok(find('contacts').includes('Your note types'));
  // A word begun is enough; an extra word ranks below instead of emptying the list (9.2 uplift F24).
  assert.equal(find('acc col')[0], 'Accent colour');
  assert.ok(find('theme zebra').includes('Theme'), 'one extra word still finds it, ranked below');
  assert.deepEqual(find('   '), []);
});

test('typographic quotes and accents never get in the way', () => {
  assert.ok(find('note’s name').includes('The note’s name as its title'));
  assert.ok(find("notes name").includes('The note’s name as its title'));
});

test('a group’s name and old words find their settings, after settings named that', () => {
  const hits = find('recovery');
  assert.ok(hits.includes('Keep copies for'));
  assert.ok(hits.includes('Earlier versions'));
  const packs = find('packs');
  const packTitles = S.SETTINGS_INDEX.filter((e) => e.section === 'packs').map((e) => e.title);
  assert.equal(packTitles.length, 17); // Packs uplift item 5: 18 packs, then Memories merged into Family.
  for (const t of packTitles) assert.ok(packs.includes(t), `${t} is found by packs`);
  const quick = find('quick add');
  assert.ok(quick.includes('Quick capture'));
  // The web clipper (8.8): found by its own words.
  assert.equal(find('clipper')[0], 'Web clipper');
  assert.ok(find('browser extension').includes('Web clipper'));
  assert.ok(find('pairing code').includes('Pairing code'));
  assert.ok(find('load unpacked').includes('Get the extension'));
});

test('a command is found by its name for its keys, after a setting that matches as well', () => {
  const commands = S.commandEntries([{ id: 'zoom-in', name: 'Make everything bigger' }, { id: 'theme-toggle', name: 'Theme: light or dark' }]);
  const hits = S.searchSettings('bigger', [...S.SETTINGS_INDEX, ...commands], labels()).map((h) => h.entry);
  assert.equal(hits[0].title, 'Make everything bigger');
  assert.equal(hits[0].section, 'keys');
  assert.equal(hits[0].command, 'zoom-in');
  const theme = S.searchSettings('theme', [...S.SETTINGS_INDEX, ...commands], labels()).map((h) => h.entry.title);
  assert.ok(theme.indexOf('Theme') < theme.indexOf('Theme: light or dark'));
});

test('a named pack part is a direct result with its parent pack', () => {
  assert.equal(S.searchSettings('Goals and Habits', [...S.SETTINGS_INDEX, ...S.PACK_PART_ENTRIES], labels())[0].entry.title, 'Goals');
  for (const [part, pack] of [['Puzzle engine', 'Publications'], ['Fuel log', 'Cars'], ['Warranty reminders', 'House']]) {
    const [first] = S.searchSettings(part, [...S.SETTINGS_INDEX, ...S.PACK_PART_ENTRIES], labels());
    assert.equal(first.entry.title, part);
    assert.equal(first.entry.section, 'packs');
    assert.ok(first.entry.hint.startsWith(pack));
  }
});

test('every pack is found by its short name, and by its earlier names', () => {
  const packs = S.moduleEntries();
  const titles = packs.map((e) => e.title);
  // Packs uplift item 5: no Memories pack; its old names find Family (below).
  for (const name of ['Family', 'Health', 'House', 'Cars', 'Trips', 'Goals', 'Lists', 'Weekly', 'Money', 'Papers', 'Business', 'Suppliers', 'Systems', 'Sites', 'Publications', 'Career', 'Meetings']) assert.ok(titles.includes(name), `${name} is listed`);
  const byName = (q) => S.searchSettings(q, [...S.SETTINGS_INDEX, ...packs], labels()).map((h) => h.entry.title);
  assert.equal(byName('trips')[0], 'Trips');
  assert.equal(byName('cars')[0], 'Cars');
  assert.equal(byName('Health and Fitness')[0], 'Health');
  // 'Weekly Update' is also a Home card's exact name, which rightly ranks first; the old name still finds the pack.
  assert.equal(byName('Weekly Update')[0], 'Weekly update');
  assert.ok(byName('Weekly Update').includes('Weekly'));
  assert.equal(byName('Memories and Media')[0], 'Family');
  assert.equal(byName('Memories')[0], 'Family');
  assert.equal(byName('Goals and Habits')[0], 'Goals');
  assert.equal(byName('Reading Watching and Lists')[0], 'Lists');
  assert.ok(byName('vehicles').includes('Cars'));
  assert.ok(byName('travel').includes('Trips'));
  assert.ok(byName('home').includes('House'));
  assert.equal(byName('money')[0], 'Money');
  assert.equal(byName('papers')[0], 'Papers');
  assert.equal(byName('suppliers')[0], 'Suppliers');
  assert.equal(byName('Finance')[0], 'Money');
  assert.equal(byName('Documents and ID')[0], 'Papers');
  assert.equal(byName('Vendors, Quotes and Contracts')[0], 'Suppliers');
  assert.equal(byName('Systems and Home Lab')[0], 'Systems');
  assert.equal(byName('Sites and Equipment')[0], 'Sites');
});

test('the pictures-and-scans switch sits in the open, where its command lands (9.0 w123ocr round 2: it hid inside the closed “Search inside project files”, so the palette command and settings search never reached it)', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  const body = (name) => {
    const at = settings.indexOf(`function ${name}(`);
    return settings.slice(at, settings.indexOf('\n}\n', at));
  };
  assert.equal(settings.match(/<OcrSettings\b/g)?.length, 1, 'one switch, not two');
  assert.ok(!body('SearchSettings').includes('<OcrSettings'), 'not inside the closed search-files details');
  assert.ok(body('General').includes('<OcrSettings'), 'in General itself, where the command lands');
});

test('the pictures-and-scans section reads like its neighbours: one line a row, no bullets (9.0 w123ocr round 3)', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  const at = settings.indexOf('function OcrSettings(');
  const body = settings.slice(at, settings.indexOf('\n}\n', at));
  // The switch row: one line, the switch and Learn more on the right, nothing else.
  assert.ok(body.includes('hint="Search finds the words in photos and scanned PDFs, read on this PC."'), 'the switch row says it in one line');
  assert.ok(body.includes('Learn more'), 'the longer words sit behind Learn more, not in the row');
  assert.ok(!body.includes('fs-limits'), 'no bullet list in the section');
  assert.ok(!body.includes('ocr-lang'), 'no one-off language layout');
  // Progress with Read again, and Language with its drop-down, are the app's own rows.
  assert.ok(/<Row\s+title=\{/.test(body), 'progress and Read again are one row');
  assert.ok(body.includes('<Row title="Language"'), 'language is a row');
  assert.ok(body.includes('<select') && body.includes('setting-input'), 'the language drop-down wears the app control');
  // The longer words survive behind Learn more, still computed from the limits.
  for (const bit of ['Nothing is downloaded', 'OCR_LIMITS.imageBytes', 'OCR_LIMITS.pages', 'Private notes are never read']) assert.ok(body.includes(bit), `Learn more keeps: ${bit}`);
});

test('the reading language is found by settings search', () => {
  assert.ok(find('language').includes('Language'));
  assert.ok(find('read again').includes('Read words in pictures and scans'));
});

test('every row written in Settings is in the index, in a section Settings has', () => {
  const sections = labels();
  assert.ok(Object.keys(sections).length >= 10);
  for (const e of S.SETTINGS_INDEX) assert.ok(sections[e.section], `${e.title}: no section ${e.section}`);
  const titles = new Set(S.SETTINGS_INDEX.map((e) => e.title));
  const files = ['src/renderer/src/components/Settings.tsx', 'src/renderer/src/components/CaptureSettings.tsx', 'src/renderer/src/components/CaptureFlowsSettings.tsx', 'src/renderer/src/components/AgentsSettings.tsx', 'src/renderer/src/components/ConnectAiSettings.tsx', 'src/renderer/src/components/NoteTypesSettings.tsx', 'src/renderer/src/components/PrivacySettings.tsx', 'src/renderer/src/components/BackupSettings.tsx', 'src/renderer/src/components/ExternalSettings.tsx', 'src/renderer/src/components/PublishSettings.tsx'];
  const missing = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/<(?:Row|ShowChips)\b[^>]*?\btitle="([^"]+)"/gs)) if (!titles.has(m[1])) missing.push(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, [], 'Settings rows not in lib/settingsSearch.ts SETTINGS_INDEX');
});
