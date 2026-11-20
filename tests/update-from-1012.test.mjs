// node --test tests/update-from-1012.test.mjs — the first ten minutes after updating to 10.1.3 (Vault side, 5
// Nov 2026, job s12-first-minutes-after-update). The other half of the former host app's
// tests/update-from-1012.mjs: each repo merges on its own, so each carries its own walk.
//
// A person on 10.1.2 updates overnight and opens the app, changing nothing. Almost everything they rely on
// changed underneath: the records lists, the Inbox filing, the folder view, brand kits, the file-name repair
// on vault open. Each job proved its own piece; this walks the join on an invented heavy vault shaped like a
// real one (261 notes as measured: 120 machine-made Systems notes, Finance bills, 20 projects with 130 open
// boxes, meetings, daily notes with copied tasks, a dotted note with its Files folder, a recording, private
// notes, an Inbox with items, templates, a second PC's marker file), with settings as 10.1.2 writes them
// (the Vault embedded then was built from nv commit a3e9c9a21). The real 10.1.3 code runs at each door, with
// no model unless a stub stands in for one. Made-up notes only, never anyone's vault.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-update-1012-'));
const pcDir = path.join(work, 'pc');
const vaultDir = path.join(work, 'vault');
const NOW = new Date(2026, 10, 5, 8, 30); // Thursday 5 November 2026, first open after the overnight update
const ME = 'Sam Walker';
const AT = new Date(2026, 10, 4, 17).getTime();

let S; // shared modules, this version
let M; // main modules, this version
let TPL; // ready-made templates, this version
let OLD; // 10.1.2 shared modules, for rollback and timing

const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
// Every file under dir, as rel path -> bytes.
const snapshot = (dir) => {
  const out = new Map();
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (e.isFile()) out.set(rel, readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
};

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const eDir = path.join(work, 'node_modules', 'electron');
  mkdirSync(eDir, { recursive: true });
  writeFileSync(path.join(eDir, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', type: 'module', main: './index.mjs', exports: { '.': './index.mjs' } }));
  writeFileSync(
    path.join(eDir, 'index.mjs'),
    `export const app = { getPath: () => ${JSON.stringify(path.join(work, 'appdata'))} };\nexport const dialog = { showMessageBox: async (...a) => (globalThis.__nvDialogCalls.push(a), { response: globalThis.__nvDialogAnswer ?? 2 }) };\nexport const shell = {};\nexport const BrowserWindow = class {};\nexport const clipboard = {};\nexport const safeStorage = {};\nexport const desktopCapturer = {};\nexport const ipcMain = { handle: () => {}, on: () => {} };\nexport const Menu = {};\nexport const nativeImage = {};\nexport const Notification = class {};\nexport const powerMonitor = { on: () => {} };\nexport const screen = {};\nexport const webContents = {};\nexport const globalShortcut = {};\nexport const systemPreferences = {};\n`,
  );
  globalThis.__nvDialogCalls = [];
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const bake = async (name, lines, external = ['electron', 'yaml']) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, lines.join('\n'));
    await build({ input: entry, platform: 'node', external, output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  const src = (p) => JSON.stringify(path.join(root, p));
  S = await bake('u1012-shared', [
    `export * as prefs from ${src('src/shared/prefs.ts')};`,
    `export * as projectFile from ${src('src/shared/project-file.ts')};`,
    `export * as todayCount from ${src('src/shared/today-count.ts')};`,
    `export { buildToday, todayDueCount, countLateTodayWeek } from ${src('src/shared/today.ts')};`,
    `export { findTasks, groupDue, taskDue } from ${src('src/shared/hub.ts')};`,
    `export { topFiveFromProjectTexts } from ${src('src/shared/brief-tasks.ts')};`,
    `export * as oneTask from ${src('src/shared/one-task.ts')};`,
    `export * as inbox from ${src('src/shared/inbox.ts')};`,
    `export * as inboxFile from ${src('src/shared/inbox-file.ts')};`,
    `export * as inboxTour from ${src('src/shared/inbox-tour.ts')};`,
    `export * as systemTables from ${src('src/shared/system-tables.ts')};`,
    `export * as systems from ${src('src/shared/systems.ts')};`,
    `export * as finance from ${src('src/shared/finance.ts')};`,
    `export * as finished from ${src('src/shared/finished.ts')};`,
    `export * as paths from ${src('src/shared/paths.ts')};`,
    `export * as brandKits from ${src('src/shared/brand-kits.ts')};`,
    `export * as assets from ${src('src/shared/assets.ts')};`,
    `export * as fileRecords from ${src('src/shared/file-records.ts')};`,
    `export * as areas from ${src('src/shared/areas.ts')};`,
    `export { strayModuleFolders } from ${src('src/shared/module-records.ts')};`,
    `export { extractLinks } from ${src('src/shared/markdown.ts')};`,
  ]);
  TPL = await bake('u1012-tpl', [`export * from ${src('src/main/templates.ts')};`]);
  M = await bake('u1012-main', [
    `export * as settings from ${src('src/main/settings.ts')};`,
    `export * as vaultHome from ${src('src/main/vault-home.ts')};`,
    `export * as vaultHomeSvc from ${src('src/main/vault-home-service.ts')};`,
    `export * as bin from ${src('src/main/bin.ts')};`,
    `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
    `export * as plugins from ${src('src/main/plugins.ts')};`,
    `export { VaultFiles } from ${src('src/main/vault-files.ts')};`,
    `export * as vaultCheck from ${src('src/main/vault-check.ts')};`,
    `export { Vault } from ${src('src/main/vault.ts')};`,
    `export { todayData } from ${src('src/main/today.ts')};`,
    `export { Hub } from ${src('src/main/hub.ts')};`,
    `export { TasksService } from ${src('src/main/tasks.ts')};`,
    `export { Reminders } from ${src('src/main/reminders.ts')};`,
    `export { registerLife } from ${src('src/main/life.ts')};`,
    `export { WorkModules, WORK_GROUP } from ${src('src/main/work-modules.ts')};`,
    `export * as systemMove from ${src('src/main/life-records/system-move.ts')};`,
    `export { dueTodayTasks, dueTodayWords } from ${src('src/main/due-today.ts')};`,
    `export { createVaultSync } from ${src('src/main/vault-sync.ts')};`,
  ]);
  // 10.1.2's shared modules, read from git (a3e9c9a21, the 10.1.2 embed) into /tmp and baked from there, so
  // their relative imports resolve to 10.1.2 too. Small copy, deleted by name in `after`.
  const oldDir = path.join(work, 'old-nv');
  mkdirSync(oldDir, { recursive: true });
  const archive = execFileSync('git', ['archive', 'a3e9c9a21', 'src/shared', 'src/main'], { cwd: root, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
  writeFileSync(path.join(work, 'old-nv.tar'), archive);
  execFileSync('tar', ['-xf', path.join(work, 'old-nv.tar'), '-C', oldDir]);
  const osrc = (p) => JSON.stringify(path.join(oldDir, p));
  OLD = await bake('u1012-old', [
    `export * as projectFile from ${osrc('src/shared/project-file.ts')};`,
    `export * as todayCount from ${osrc('src/shared/today-count.ts')};`,
    `export { buildToday, todayDueCount } from ${osrc('src/shared/today.ts')};`,
    `export * as systems from ${osrc('src/shared/systems.ts')};`,
    `export * as inbox from ${osrc('src/shared/inbox.ts')};`,
    `export { VaultIndex } from ${osrc('src/main/indexer.ts')};`,
  ]);
}, { timeout: 120000 });
after(() => rmSync(work, { recursive: true, force: true }));

// ── The vault and PC as 10.1.2 leaves them ──────────────────────────────────────────────────────────
// Written once, before the first test that opens them. Everyone and everything here is invented.
let seeded = false;
const OTHER_PC = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const seed = () => {
  if (seeded) return;
  seeded = true;
  write(path.join(vaultDir, '.neuralvault', 'vault.json'), { id: '12345678-1234-4123-8123-123456789012', name: 'Vault', created: '2026-10-23T00:00:00.000Z' });
  const at = Date.parse('2026-11-04T00:00:00.000Z');
  write(path.join(vaultDir, '.neuralvault', 'settings.json'), {
    neuralvault: 'settings', format: 1,
    keys: {
      dailyFolder: { value: 'Daily', at, by: 'pc' },
      templatesFolder: { value: 'Templates', at, by: 'pc' },
    },
  });
  // This PC, settled on 10.1.2: Ask first off by choice, the sky look, one rail row off, Family, Finance
  // and Systems on (Memories already merged into Family in 10.1.0). prefs.ts is unchanged since 10.1.2,
  // so these defaults are 10.1.2's own.
  const key = createHash('sha256').update(path.resolve(vaultDir).toLowerCase()).digest('hex').slice(0, 20);
  const prefs = { ...S.prefs.DEFAULT_PREFS, askBeforeChanges: false, askBeforeChangesChosen: true, palette: 'sky', hidden: ['ribbon:graph'], templatesFolder: 'Templates' };
  write(path.join(pcDir, 'settings.json'), {
    recentVaults: [vaultDir], model: null, dailyFolder: 'Daily', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '',
    prefs, moved: { personal: '2026-11-04T00:00:00.000Z', vaults: { [key]: '2026-11-04T00:00:00.000Z' } },
  });
  write(path.join(pcDir, 'libraries', key, 'vault-settings.json'), JSON.parse(readFileSync(path.join(vaultDir, '.neuralvault', 'settings.json'), 'utf8')));
  write(path.join(pcDir, 'personal.json'), {
    neuralvault: 'personal', format: 1,
    keys: {
      palette: { value: 'sky', at, by: 'pc' },
      hidden: { value: ['ribbon:graph'], at, by: 'pc' },
      askBeforeChanges: { value: false, at, by: 'pc' },
      modules: { value: { family: { on: true }, finance: { on: true }, systems: { on: true }, health: { on: true, off: ['export'] } }, at, by: 'pc' },
    },
  });
  write(path.join(vaultDir, '.neuralvault', 'plugins', 'example', 'manifest.json'), '{"id":"example"}');
  // The second PC's marker, still on 10.1.2, opened the vault last night (fresh: the records move waits).
  write(path.join(vaultDir, '.neuralvault', 'pcs', `${OTHER_PC}.json`), { id: OTHER_PC, name: "Sam's Laptop", at: '2026-11-04T21:30:00.000Z', version: '10.1.2' });
  // One brand kit, one colour, no fonts: the 10.1.2 single-brand shape (no brands/brandDefault keys).
  write(path.join(vaultDir, 'Assets', 'assets.json'), {
    version: 1, assets: {}, collections: [],
    brand: { name: 'Redline Co', logos: {}, colours: [{ name: 'Redline red', hex: '#C63A2E', use: 'Headings' }], fonts: [] },
  });
  // An old Bin entry, as 10.1.2's the former host app wrote it.
  write(path.join(vaultDir, '.neuralvault', 'bin', 'ab12cd-3456', 'item.json'),
    { id: 'ab12cd-3456', path: 'Ideas.md', kind: 'note', title: 'Ideas', by: 'the host app', at: Date.now() - 864e5 });
  write(path.join(vaultDir, '.neuralvault', 'bin', 'ab12cd-3456', 'item', 'Ideas.md'), '# Ideas\n\nAn old idea.\n');

  const md = (rel, text) => write(path.join(vaultDir, ...rel.split('/')), text);
  // 20 projects: 12 active, 5 finished, 2 on hold, 1 idea. 130 open boxes in all: 110 on the live
  // ones, 12 on finished, 8 on hold or idea (counted nowhere, kept on their pages).
  const ACTIVE = ['Harbour Cafe', 'Bakery Launch', 'Website Refresh', 'Coffee Cart', 'Van Fit-out', 'Winter Menu', 'Staff Rota', 'Loyalty Cards', 'Supplier Review', 'New Till', 'Garden Seating', 'Gift Vouchers'];
  const FINISHED = [['Old Shop', 'done'], ['Summer Fair', 'archived'], ['Menu Print', 'completed'], ['Easter Promo', 'cancelled'], ['First Lease', 'closed']];
  const SHELVED = [['City Kiosk', 'on hold'], ['Night Market', 'paused'], ['Maybe One Day', 'idea']];
  const step = (what, who, by) => `- [ ] ${what}${who ? ` — ${who}` : ''}${by ? ` · by ${by}` : ''}`;
  const WHO = [ME, ME, 'Priya Nair', ME, 'Josh Lee'];
  const WHEN = ['3 Nov 2026', '4 Nov 2026', '5 Nov 2026', '10 Nov 2026', '20 Nov 2026', ''];
  let n = 0;
  const boxes = (count, seedN) => {
    const out = [];
    for (let i = 0; i < count; i++, n++) out.push(step(`Job ${seedN * 100 + i + 1} for the ${seedN}th job`, WHO[n % WHO.length], WHEN[n % WHEN.length]));
    return out.join('\n');
  };
  ACTIVE.forEach((name, i) => {
    const count = i < 2 ? 12 : 8; // 12+12+8*10 = 104... topped up below to 110
    md(`Projects/${name}/${name}.md`, `---\ntype: project\nstatus: active\nowner: ${ME}\n---\n# ${name}\n\n## What’s next\n\n${boxes(count, i + 1)}\n\n## Key dates\n\n- 2026-11-06: supplier visit\n`);
  });
  // Six more live boxes so the live total is exactly 110.
  md('Projects/Harbour Cafe/Notes/Site walk.md', `---\nproject: "[[Harbour Cafe]]"\n---\n# Site walk\n\n- [ ] Count the spare chairs 📅 2026-11-03\n- [ ] Order flour — ${ME}\n- [ ] Measure the back room 📅 2026-11-05\n- [ ] Ask Priya about bins\n- [ ] Price shade sails\n- [ ] Book the painter 📅 2026-11-10\n`);
  FINISHED.forEach(([name, status], i) => {
    md(`Projects/${name}.md`, `---\ntype: project\nstatus: ${status}\nowner: ${ME}\n---\n# ${name}\n\n## What’s next\n\n${i < 2 ? boxes(3, 40 + i) : boxes(2, 40 + i)}\n`);
  }); // 3+3+2+2+2 = 12
  SHELVED.forEach(([name, status], i) => {
    md(`Projects/${name}.md`, `---\ntype: project\nstatus: ${status}\nowner: ${ME}\n---\n# ${name}\n\n## What’s next\n\n${boxes(i === 0 ? 4 : 2, 60 + i)}\n`);
  }); // 4+2+2 = 8
  // Meetings: two with a project (one action filed, one not), two without.
  md('Meetings/2026-11-04 Supplier call.md', `---\ntype: meeting\ndate: 2026-11-04\nproject: "[[Harbour Cafe]]"\nattendees: [${ME}]\n---\n# Supplier call\n\n## Actions\n\n- [ ] Send the quote — ${ME} → [[Harbour Cafe]]\n`);
  md('Meetings/2026-11-03 Painter quote.md', `---\ntype: meeting\ndate: 2026-11-03\nproject: "[[Bakery Launch]]"\nattendees: [${ME}, Priya Nair]\n---\n# Painter quote\n\n## Actions\n\n- [ ] Confirm the colour 📅 2026-11-05\n`);
  md('Meetings/Coffee chat.md', `---\ntype: meeting\ndate: 2026-11-04\nattendees: [${ME}]\n---\n# Coffee chat\n\n- [ ] Look up new beans 📅 2026-11-04\n`);
  md('Meetings/2026-10-30 Team huddle.md', `---\ntype: meeting\ndate: 2026-10-30\nattendees: [${ME}, Josh Lee]\n---\n# Team huddle\n\n- [x] Book the room\n`);
  // Daily notes with copied tasks (copies match their task elsewhere and never count twice).
  md('Daily/2026-11-04.md', `# 4 November 2026\n\n- [ ] Ring the landlord — ${ME}\n- [ ] Buy milk on the way home\n`);
  md('Daily/2026-11-03.md', `# 3 November 2026\n\nYesterday's words stay as written.\n\n- [ ] Ring the landlord — ${ME}\n`);
  md('Daily/2026-11-02.md', `# 2 November 2026\n\nA quiet day.\n`);
  md('Daily/2026-11-01.md', `# 1 November 2026\n\n- [x] Water the plants\n`);
  // The dotted note and its Files folder, as 10.1.2 left them (trailing dots 10.1.3 repairs).
  md('Meetings/LF planning..md', `# LF planning.\n\nThe fit-out plan, agreed.\n\nSee [the recording](Files/LF planning./rec.wav).\n`);
  write(path.join(vaultDir, 'Meetings', 'Files', 'LF planning.', 'rec.wav'), Buffer.from('RIFF-fake-wav-bytes-for-tests'));
  write(path.join(vaultDir, 'Meetings', 'Files', 'LF planning.', '.files.json'), {
    version: 1, files: { 'rec.wav': { name: 'rec.wav', version: 1, versions: [], record: 'Meetings/LF planning..md', size: 28, summary: 'Planning recording' } },
  });
  md('Notes/Index.md', `# Index\n\nSee [[Meetings/LF planning.|the plan]] and [[Harbour Cafe]].\n`);
  // Finance bills, as 10.1.2's Finance writes them.
  const bill = (name, amount, due) => md(`Me/Finance/Bills/${name}.md`,
    `---\ntype: bill\nkind: Bill\namount: ${amount.toFixed(2)}\ncycle: Monthly\ndue: ${due}\ncategory: Utilities\n---\n# ${name}\n\n## Price history\n\n| Date | Amount |\n| --- | --- |\n\n## Notes\n\n`);
  bill('Internet', 89.0, '2026-11-15');
  bill('Power', 214.5, '2026-11-08');
  bill('Phone', 45.0, '2026-11-20');
  bill('Insurance', 320.0, '2026-12-01');
  md('Me/Finance/Budget.md', `# Budget\n\nNovember, kept tight.\n`);
  // Private notes, the Inbox, templates, Home.
  md('Private Notes/Diary.md', `# Diary\n\nNot for anyone else.\n`);
  const inboxLines = [
    '- [ ] Ring Priya about the Harbour benchtop',
    '- [ ] Pay the power bill $214.50 due 8 Nov',
    '- 24 Oct 2026 10:42 — Ask Josh for the painter’s number',
    '- [ ] Order flour — Sam',
    '- Book the dentist for December',
    '- [ ] Read the oven manual [[Oven manual]]',
    '- Call Mum back',
    '- [ ] Fix the back door lock',
    '- **4 Nov 2026 09:15** — Water the shop plants',
    '- [ ] Email the insurance renewal',
    '- Get milk, eggs and bread',
    '- [ ] Renew the domain — 12 Nov 2026',
    '- Drop the keys at Priya’s',
    '- [ ] Service the van 📅 2026-11-06',
    '- 1 Nov 2026 08:00 — Morning pages idea: bitter coffee',
    '- [ ] Chase the Smith invoice',
    '- Book flights for the Sydney trip',
    '- [ ] Tidy the store room',
    '- Remind me Friday at 3pm to ring Priya',
    '- [ ] Update the price board',
    '- [ ] File the tax receipts',
    '- Buy a birthday card for Ella',
    '- [ ] Check the till float',
    '- [ ] Mow the nature strip',
    '- [ ] Return the library books 📅 2026-11-07',
  ];
  md('Inbox.md', `# Inbox\n\n## Captured\n\n${inboxLines.join('\n')}\n`);
  write(path.join(vaultDir, 'Inbox', 'photo-note.md'), '# Dropped note\n\nA note left in the Inbox folder.\n');
  md('Templates/Meeting.md', `# Meeting template\n\nA person's own template, kept as written.\n`);
  md('Home.md', `# Home\n\n- [ ] Buy beans\n`);
  md('Reminders.md', `# Reminders\n\n- [ ] Call the supplier ⏰ 2026-11-04 09:00\n- [ ] Water the plants ⏰ 2026-10-20 09:00\n`);
  // People, docs and plain notes to fill out the vault.
  const people = ['Priya Nair', 'Josh Lee', 'Ella Ward', 'Dan Kim'];
  for (const p of people) md(`People/${p}.md`, `# ${p}\n\nKnows the shop well.\n`);
  md('Docs/Oven manual.md', `# Oven manual\n\nDescale monthly. [[Harbour Cafe]] uses it daily.\n`);
  md('Docs/Open and close.md', `# Open and close\n\nHow the shop opens and shuts.\n`);
  for (let i = 1; i <= 70; i++) md(`Notes/Note ${String(i).padStart(3, '0')}.md`, `# Note ${String(i).padStart(3, '0')}\n\nA few kept words about the shop, number ${i}.\n`);
  for (let i = 1; i <= 20; i++) md(`Notes/Empty ${String(i).padStart(2, '0')}.md`, `# Empty ${i}\n`);
  seedSystems();
};

// Machine-made Systems notes as 10.1.2 leaves them: details, then the checks' own sections, no title
// line (10.1.2's writers never put one: newMachineText/newServiceText end at the details, newRunbookText
// at its sections; the file name is the title). A `#` line would be the person's own structure, which
// the move keeps as a note — see the title-line test below.
const machineNote = (i) => {
  const name = `Machine ${String(i).padStart(3, '0')}`;
  return [`Systems/Machines/${name}.md`,
    `---\ntype: machine\nkind: Server\nrole: Till\nos: Ubuntu 24.04\naddress: 192.168.1.${10 + i}\nlocation: Shop\nstatus: ok\nchecked: 2026-11-04\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-11-04 | up | Checked: 12 services up |\n| 2026-11-03 | up |  |\n`];
};
const serviceNote = (i) => {
  const name = `Service ${String(i).padStart(3, '0')}`;
  const machine = `Machine ${String((i % 70) + 1).padStart(3, '0')}`;
  return [`Systems/Services/${name}.md`,
    `---\ntype: service\nkind: Web app\nruns_on: "[[${machine}]]"\nurl: http://till-${i}.local\nport: "808${i % 10}"\nstatus: ok\nchecked: 2026-11-04\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-11-04 | up | Check now: answered in 40 ms |\n`];
};
const seedSystems = () => {
  const md = (rel, text) => write(path.join(vaultDir, ...rel.split('/')), text);
  for (let i = 1; i <= 70; i++) { const [rel, text] = machineNote(i); md(rel, text); }
  for (let i = 1; i <= 40; i++) { const [rel, text] = serviceNote(i); md(rel, text); }
  // Ten runbooks from the check's own patterns (machine-made, so they fold).
  const filled = [];
  for (const [pattern, machine, os] of [['update', 'Machine 001', 'Ubuntu 24.04'], ['backups', 'Machine 002', 'Ubuntu 24.04'], ['restore', 'Machine 003', 'Ubuntu 24.04']]) {
    const steps = S.systemTables.fillPatternSteps(pattern, { machine, os });
    const name = pattern === 'update' ? `Update ${machine}` : pattern === 'backups' ? `Check backups on ${machine}` : `Restore ${machine}`;
    if (steps.length) filled.push({ name, steps });
  }
  if (!filled.length) throw new Error('no runbook patterns filled: the Systems fixture cannot be built');
  for (let i = 0; i < 10; i++) {
    const pick = filled[i % filled.length];
    const machine = `Machine ${String((i % 10) + 1).padStart(3, '0')}`;
    const steps = S.systemTables.fillPatternSteps(S.systemTables.patternForName(pick.name), { machine, os: 'Ubuntu 24.04' });
    md(`Systems/Runbooks/${pick.name.replace(/Machine \d+/, machine)}.md`,
      `---\ntype: runbook\nfor: ["[[${machine}]]"]\nevery: On demand\n---\n## Steps\n\n${steps.map((s, k) => `${k + 1}. ${s}`).join('\n')}\n`);
  }
  // Three with the person's own words: they stay notes for those words (no title line either, so the
  // heavy vault proves the words themselves stay, not the frame rule).
  md('Systems/Machines/Media box.md', `---\ntype: machine\nkind: Mini PC\nos: Ubuntu 24.04\nstatus: ok\nchecked: 2026-11-04\n---\n## Notes\n\nLoud fan on warm days; move it off the shelf.\n`);
  md('Systems/Services/Photo library.md', `---\ntype: service\nkind: Web app\nruns_on: "[[Media box]]"\nstatus: ok\nchecked: 2026-11-04\n---\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-11-04 | slow | Fan sounds odd when it starts |\n`);
  md('Systems/Runbooks/How we open the shop.md', `---\ntype: runbook\nfor: []\nevery: Weekly\n---\n## Steps\n\n1. Unlock and greet whoever is early\n`);
};

// ── Harness: the real main-side pieces over real files ─────────────────────────────────────────────
// The index over every note, as the rescan leaves it.
const indexed = () => {
  const index = new M.VaultIndex();
  const before = snapshot(vaultDir);
  for (const [rel, bytes] of before) {
    if (!rel.endsWith('.md') || rel.startsWith('.neuralvault/')) continue;
    const text = bytes.toString('utf8');
    index.set(rel, text, AT, text.length);
  }
  return index;
};
const absOf = (rel) => path.join(vaultDir, ...rel.split('/'));
// The app's own move over the same disk (notes, links, records follow it): the faithful stand-in the
// repo's own windows-names test uses, since app.ts itself needs the whole window to stand up.
const moveStandIn = (moves) => async (from, to) => {
  moves.push([from, to]);
  mkdirSync(path.dirname(absOf(to)), { recursive: true });
  const { renameSync } = await import('node:fs');
  renameSync(absOf(from), absOf(to));
  const olds = [from, from.replace(/\.md$/i, ''), from.split('/').pop() ?? from, (from.split('/').pop() ?? from).replace(/\.md$/i, '')];
  const news = [to, to.replace(/\.md$/i, ''), to.split('/').pop() ?? to, (to.split('/').pop() ?? to).replace(/\.md$/i, '')];
  for (const [rel, bytes] of snapshot(vaultDir)) {
    if (!rel.endsWith('.md') || rel.startsWith('.neuralvault/')) continue;
    let text = bytes.toString('utf8');
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const under = (p) => (dir && p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p);
    olds.forEach((o, i) => {
      text = text.split(`[[${o}]]`).join(`[[${news[i]}]]`).split(`[[${o}|`).join(`[[${news[i]}|`).split(`(${o})`).join(`(${news[i]})`);
      text = text.split(`(${under(o)})`).join(`(${under(news[i])})`);
    });
    if (from !== to) text = text.split(`[[${from}/`).join(`[[${to}/`).split(`(${from}/`).join(`(${to}/`).split(`(${under(from)}/`).join(`(${under(to)}/`);
    writeFileSync(absOf(rel), text);
  }
  for (const [rel, bytes] of snapshot(vaultDir)) {
    if (!rel.endsWith('.files.json')) continue;
    const side = JSON.parse(bytes.toString('utf8'));
    for (const e of Object.values(side.files ?? {})) {
      if (typeof e.name === 'string' && (from.endsWith(`/${e.name}`) || from === e.name)) e.name = to.split('/').pop();
      if (typeof e.record === 'string' && (e.record === from || e.record.startsWith(`${from}/`))) e.record = to + e.record.slice(from.length);
    }
    const files = {};
    for (const e of Object.values(side.files ?? {})) files[String(e.name).toLowerCase()] = e;
    side.files = files;
    writeFileSync(absOf(rel), JSON.stringify(side));
  }
  return { path: to, linksUpdated: 0 };
};
const vaultFilesOn = (moves) => {
  const walkFiles = (dir, base = '') => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walkFiles(path.join(dir, e.name), rel));
      else out.push({ rel, mtime: statSync(path.join(dir, e.name)).mtimeMs, size: statSync(path.join(dir, e.name)).size });
    }
    return out;
  };
  const notesNow = () => walkFiles(vaultDir).filter((f) => f.rel.endsWith('.md'))
    .map((f) => ({ path: f.rel, props: {}, links: S.extractLinks(readFileSync(absOf(f.rel), 'utf8')).map((l) => ({ target: l.target })) }));
  const resolveNow = (target, from) => {
    const files = walkFiles(vaultDir).map((f) => f.rel);
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    for (const c of [target, dir ? `${dir}/${target}` : target]) if (files.includes(c) || files.includes(`${c}.md`)) return c.endsWith('.md') ? c : `${c}.md`;
    const stem = target.toLowerCase();
    return files.find((f) => f.toLowerCase().endsWith('.md') && (f.toLowerCase() === `${stem}.md` || f.toLowerCase().endsWith(`/${stem}.md`) || f.slice(0, -3).toLowerCase() === stem)) ?? null;
  };
  return new M.VaultFiles({
    root: () => vaultDir,
    listAll: async () => walkFiles(vaultDir),
    notes: notesNow,
    resolve: resolveNow,
    readNote: async (rel) => readFileSync(absOf(rel), 'utf8'),
    writeNote: async (rel, text) => write(absOf(rel), text),
    movePath: moveStandIn(moves),
    dataDir: path.join(work, 'data'),
    readText: async () => '',
    level: () => 'open',
    assistantMay: () => ({ ok: true }),
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true }),
    areaOf: () => undefined,
    areaFilesFolders: () => [],
  });
};
// The Systems machinery over the real vault and index.
const systemsOn = (index, appVersion = '10.1.3') => new M.WorkModules({
  vault: () => ({ root: vaultDir }),
  index,
  prefs: () => ({ templatesFolder: 'Templates', modules: { family: { on: true }, finance: { on: true }, systems: { on: true } } }),
  writeNote: async () => { throw new Error('no writes in this test'); },
  importFiles: async () => { throw new Error('no imports in this test'); },
  pickFiles: async () => { throw new Error('no dialogs in this test'); },
  saveFile: async () => { throw new Error('no dialogs in this test'); },
  post: () => 0,
  editProject: async () => { throw new Error('no edits in this test'); },
  projects: () => [],
  records: () => ({ records: new Map() }),
  requireCreate: async () => {},
  device: { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: "Sam's PC" },
  appVersion,
  now: () => NOW,
}, M.WORK_GROUP);
// The Inbox machinery over the real vault and index, with the model's answer stubbed (or no model).
const inboxOn = (index, askJson) => {
  const channels = new Map();
  const vault = {
    root: vaultDir,
    read: async (rel) => readFileSync(absOf(rel), 'utf8'),
    write: async (rel, text) => { write(absOf(rel), text); },
    exists: async (rel) => { try { statSync(absOf(rel)); return true; } catch { return false; } },
    listAll: async () => {
      const files = [];
      const walk = (d, prefix) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(path.join(d, e.name), rel); }
          else if (e.name.endsWith('.md')) files.push({ rel, kind: 'note' });
          else files.push({ rel, kind: 'file' });
        }
      };
      walk(vaultDir, '');
      return { files, folders: [] };
    },
  };
  const indexFile = async (v, rel) => {
    try {
      const text = await v.read(rel);
      index.set(rel, text, Date.now(), text.length);
    } catch {}
    return rel;
  };
  M.registerLife({
    handle: (channel, fn) => channels.set(channel, fn),
    vault: () => vault,
    index,
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => ({ records: new Map() }),
    movePath: async () => { throw new Error('no moves in this test'); },
    indexFile,
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async (rel, edit) => {
      const text = await vault.read(rel);
      const p = S.projectFile.parseProject(text, rel);
      const said = S.projectFile.applyProjectEdit(p, edit, '2026-11-05');
      const next = S.projectFile.serializeProject(p, text);
      await vault.write(rel, next);
      await indexFile(vault, rel);
      return said;
    },
    ...(askJson ? { askJson } : {}),
  });
  return { call: (channel, ...args) => channels.get(channel)(...args) };
};

test('the fixture is the heavy vault the brief names', () => {
  seed();
  const notes = [...snapshot(vaultDir).keys()].filter((r) => r.endsWith('.md') && !r.startsWith('.neuralvault/'));
  assert.equal(notes.length, 261, `${notes.length} notes, not 261 (a realistic vault as measured)`);
  const systems = notes.filter((r) => r.startsWith('Systems/'));
  assert.equal(systems.length, 123, `${systems.length} Systems notes, not 123`);
  const projects = notes.filter((r) => r.startsWith('Projects/') && r.endsWith('.md') && !r.includes('/Notes/'));
  assert.equal(projects.length, 20, `${projects.length} project files, not 20`);
  let open = 0;
  for (const rel of projects) {
    const p = S.projectFile.parseProject(readFileSync(absOf(rel), 'utf8'), rel);
    open += p.next.filter((s) => !s.done).length;
  }
  open += (readFileSync(absOf('Projects/Harbour Cafe/Notes/Site walk.md'), 'utf8').match(/- \[ \]/g) || []).length;
  assert.equal(open, 130, `${open} open boxes on the projects, not 130`);
  const inbox = S.inbox.inboxLines(readFileSync(absOf('Inbox.md'), 'utf8'));
  assert.equal(inbox.length, 25, `${inbox.length} Inbox captures, not 25`);
});

test('settings read as the person left them on 10.1.2', async () => {
  seed();
  const s = new M.settings.SettingsStore(pcDir);
  await s.load();
  const prefs = s.view().prefs;
  assert.equal(prefs.palette, 'sky', 'the saved look stays');
  assert.equal(prefs.askBeforeChanges, false, 'Ask first stays off, as chosen');
  assert.equal(prefs.askBeforeChangesChosen, true, 'the choice marker stays');
  assert.ok(prefs.hidden.includes('ribbon:graph'), 'a rail row switched off stays off');
  assert.equal(s.view().dailyFolder, 'Daily', 'the daily folder reads from the vault’s settings');
  await s.useVault(vaultDir);
  assert.equal(s.view().prefs.modules.family?.on, true, 'Family stays on');
  assert.equal(s.view().prefs.modules.systems?.on, true, 'Systems stays on');
});

test('the one brand kit reads as the kit everywhere, with no fonts', async () => {
  seed();
  const index = JSON.parse(readFileSync(absOf('Assets/assets.json'), 'utf8'));
  const kits = S.brandKits.kitsOf(index);
  assert.equal(kits.length, 1, 'the old single brand reads as one kit');
  assert.equal(kits[0].name, 'Redline Co', 'its name');
  assert.equal(kits[0].colours.length, 1, 'its one colour');
  assert.deepEqual(kits[0].fonts, [], 'no fonts: the clean neutral document prints');
  const ctx = { areas: [], projects: [{ path: 'Projects/Harbour Cafe/Harbour Cafe.md', name: 'Harbour Cafe' }] };
  for (const p of ['Projects/Harbour Cafe/Harbour Cafe.md', 'Notes/Note 001.md', 'Daily/2026-11-04.md']) {
    assert.equal(S.brandKits.kitForNote(index, { path: p }, ctx)?.name, 'Redline Co', `${p} takes the one kit`);
  }
  assert.equal(S.brandKits.kitWords(kits[0]), 'in the Redline Co kit', 'every door names it the same way');
});

test('first open changes nothing a person wrote; the name repair waits, then applies on approval', async () => {
  seed();
  const before = snapshot(vaultDir);
  // The open sequence, as app.ts runs it: settings, the vault's home (identity, presence), its plugins,
  // the settled templates (nothing to seed), the module folders (nothing stray), the indexer's rescan,
  // and the vault check with names waiting for the person (Nov 2026: nothing is renamed until they choose).
  const s = new M.settings.SettingsStore(pcDir);
  await s.load();
  await s.useVault(vaultDir);
  const svc = M.vaultHomeSvc.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: pcDir, dataDir: pcDir },
    settings: s, places: async () => ({ roots: [], network: [] }), placesStubbed: true, placeDeps: { path, platform: 'linux' },
    vaultRoot: () => vaultDir, library: () => vaultDir, templates: () => 'Templates',
    ownCounts: () => null, ownFiles: () => new Map(),
    openVault: async () => { throw new Error('not in this test'); }, useLibrary: async () => { throw new Error('not in this test'); },
    carryLibraryData: async () => {}, toTrash: async () => {}, canWrite: async () => true,
    keepRecovery: () => {}, send: () => {}, win: () => null, moving: { get: () => false, set: () => {} },
    rescan: async () => {},
  });
  await svc.opened(vaultDir);
  await new Promise((r) => setTimeout(r, 20));
  // This PC says it has the vault open (the real beat; its own marker file, as 10.1.2 writes it).
  const sync = M.createVaultSync({
    root: () => vaultDir, device: { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: "Sam's PC" }, version: '10.1.3',
    identityId: async () => '12345678-1234-4123-8123-123456789012', place: async () => ({ kind: 'local', name: 'PC' }),
    pcs: async () => null, mayWrite: async () => true,
    readNote: async (rel) => readFileSync(absOf(rel), 'utf8'), writeNote: async () => {}, trash: async () => {}, move: async () => {},
    rescan: async () => {}, log: () => {},
  });
  await sync.beat();
  sync.stop();
  const pm = new M.plugins.PluginManager({
    dataDir: pcDir, vaultRoot: () => vaultDir,
    listNotes: async () => ['Home.md'], readNote: async () => '', writeNote: async () => { throw new Error('no writes in this test'); },
    existsNote: async () => false, canWrite: async () => {}, trashPath: async () => {}, send: () => {}, log: () => {},
  });
  await pm.useVault(vaultDir, false);
  const index = indexed();
  assert.ok(index.get('Home.md') && index.get('Systems/Machines/Machine 001.md'), 'the rescan read the notes');
  const moves = [];
  // The look first: the dotted names are planned, nothing moves, and the one ask names them.
  const look = await vaultFilesOn(moves).check({ repair: false });
  assert.deepEqual(look.renames, [
    ['Meetings/Files/LF planning.', 'Meetings/Files/LF planning'],
    ['Meetings/LF planning..md', 'Meetings/LF planning.md'],
  ], 'the dotted folder and note are planned: ' + JSON.stringify(look.renames));
  assert.deepEqual(look.nameLeft, [], 'nothing else needs the person: ' + look.nameLeft.join(' | '));
  const ask = M.vaultCheck.namesAsk(look.renames, look.nameLeft);
  assert.equal(ask.title, '2 names Windows can’t open', 'the bell names the count');
  assert.match(ask.body, /LF planning/, 'the ask names the files: ' + ask.body);
  assert.match(ask.body, /Nothing is renamed until you choose/, 'and that nothing moves yet');
  // The repair run mends records and links only. First open renames nothing.
  const opened = await vaultFilesOn(moves).check({ repair: true, names: false, receipt: true });
  assert.equal(moves.length, 0, 'first open renames nothing: the repair waits for the person');
  assert.ok(!opened.fixed.some((f) => f.includes('LF planning')), 'and names no repair yet');
  const first = snapshot(vaultDir);
  const firstChanged = [...first.keys()].filter((k) => !before.has(k) || !first.get(k).equals(before.get(k)));
  const firstGone = [...before.keys()].filter((k) => !first.has(k));
  assert.deepEqual(firstChanged.filter((r) => !r.startsWith('.neuralvault/')), [], 'first open changes no person file');
  assert.deepEqual(firstGone.filter((r) => !r.startsWith('.neuralvault/')), [], 'first open moves no person file away');
  assert.deepEqual(firstChanged.filter((r) => r.startsWith('.neuralvault/')), ['.neuralvault/pcs/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.json'], 'only this PC’s presence marker is new on first open');
  assert.deepEqual(firstGone.filter((r) => r.startsWith('.neuralvault/')), [], 'nothing of the app’s own went away on first open');
  // The person chooses Rename them: the approved plan applies, the same on every PC, and is told once.
  await M.vaultCheck.namesDecide(vaultDir, look.renames, look.nameLeft, 'approved');
  const pending = await M.vaultCheck.namesPending(vaultDir, look.renames, look.nameLeft);
  assert.deepEqual(pending, look.renames, 'the approved plan applies whole');
  const result = await vaultFilesOn(moves).check({ repair: true, plan: pending, receipt: true });
  assert.ok(result.fixed.some((f) => f.includes('LF planning')), 'the check names the dotted repair: ' + result.fixed.join(' | '));
  assert.equal(moves.length, 2, 'the folder and the note rename, once approved');
  const after = snapshot(vaultDir);
  const changed = [...after.keys()].filter((k) => !before.has(k) || !after.get(k).equals(before.get(k)));
  const gone = [...before.keys()].filter((k) => !after.has(k));
  // Every change, classified. Person files: only the dotted rename and the links that follow it.
  const personChanged = changed.filter((r) => !r.startsWith('.neuralvault/'));
  const personGone = gone.filter((r) => !r.startsWith('.neuralvault/'));
  assert.deepEqual([...personChanged].sort(), [
    'Meetings/LF planning.md',
    'Meetings/Files/LF planning/.files.json',
    'Meetings/Files/LF planning/rec.wav',
    'Notes/Index.md',
  ].sort(), 'only the repair and its follows changed among person files: ' + personChanged.join(', '));
  assert.deepEqual([...personGone].sort(), [
    'Meetings/LF planning..md',
    'Meetings/Files/LF planning./.files.json',
    'Meetings/Files/LF planning./rec.wav',
  ].sort(), 'only the repair moved person files away: ' + personGone.join(', '));
  assert.ok(after.get('Meetings/Files/LF planning/rec.wav').equals(before.get('Meetings/Files/LF planning./rec.wav')), 'the recording’s bytes are untouched');
  // Every link still lands: the Index link, the note's own recording link, the file record.
  const idx = after.get('Notes/Index.md').toString('utf8');
  assert.ok(!idx.includes('LF planning.'), 'no dangling dotted link: ' + idx.trim());
  assert.ok(idx.includes('[[Meetings/LF planning|the plan]]'), 'the Index link follows the rename');
  assert.ok(after.get('Meetings/LF planning.md').toString('utf8').includes('(Files/LF planning/rec.wav)'), 'the recording link follows the folder rename');
  const side = JSON.parse(after.get('Meetings/Files/LF planning/.files.json').toString('utf8'));
  assert.equal(side.files['rec.wav'].record, 'Meetings/LF planning.md', 'the file record follows the note');
  assert.equal(side.files['rec.wav'].summary, 'Planning recording', 'its words kept');
  // App files: only this PC's own presence marker is new. Nothing else in .neuralvault moved.
  const appChanged = changed.filter((r) => r.startsWith('.neuralvault/'));
  const appGone = gone.filter((r) => r.startsWith('.neuralvault/'));
  assert.deepEqual([...appChanged].sort(), ['.neuralvault/name-repairs.json', '.neuralvault/pcs/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.json'].sort(), 'only this PC’s presence marker and the repair receipt are new: ' + appChanged.join(', '));
  assert.deepEqual(appGone, [], 'nothing of the app’s own went away: ' + appGone.join(', '));
  const beat = JSON.parse(after.get('.neuralvault/pcs/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.json').toString('utf8'));
  assert.equal(beat.version, '10.1.3', 'the marker carries the new version');
  // The asset index, the brand, the Inbox, the Bin and both PCs' markers are byte for byte.
  for (const same of ['Assets/assets.json', 'Inbox.md', 'Private Notes/Diary.md', 'Templates/Meeting.md',
    '.neuralvault/vault.json', '.neuralvault/settings.json', '.neuralvault/bin/ab12cd-3456/item.json',
    `.neuralvault/pcs/${OTHER_PC}.json`]) {
    assert.ok(after.get(same).equals(before.get(same)), `${same} is byte for byte`);
  }
  // A second open repairs nothing more.
  const moves2 = [];
  const again = await vaultFilesOn(moves2).check({ repair: true });
  assert.equal(moves2.length, 0, 'a second open renames nothing');
  assert.ok(!again.fixed.some((f) => f.includes('LF planning')), 'and names no repair again');
});

test('the settled vault seeds no templates and moves no module folders on open', async () => {
  seed();
  // All ready-made templates already given (the record 10.1.2 kept): the open seeds nothing.
  const notes = [...snapshot(vaultDir).keys()].filter((r) => r.endsWith('.md') && !r.startsWith('.neuralvault/'));
  const store = {
    notes: () => notes,
    any: async (rel) => notes.includes(rel),
    create: async () => { throw new Error('nothing to seed in this test'); },
  };
  const { made } = await TPL.ensureBuiltIns(store, 'Templates', { written: TPL.BUILT_INS.map((b) => b.id) });
  assert.deepEqual(made, [], 'every ready-made template already given: none written');
  // No module folders stray outside their area: the tidy plans nothing.
  const tops = [...new Set(notes.map((n) => n.split('/')[0]).filter((t) => t && !notes.includes(t)))];
  assert.deepEqual(S.strayModuleFolders(tops, ['family', 'finance', 'systems', 'health'], null), [], 'no stray module folders: the tidy moves nothing');
});

test('old Bin entries still list and come back word for word', async () => {
  seed();
  const bin = M.bin.createVaultBin({ root: vaultDir });
  const old = (await bin.list()).find((i) => i.id === 'ab12cd-3456');
  assert.ok(old && old.title === 'Ideas' && old.path === 'Ideas.md', 'the old entry lists');
  const back = await bin.restore('ab12cd-3456');
  assert.equal(back.restored, 'Ideas.md', 'it comes back where it was');
  assert.equal(readFileSync(absOf('Ideas.md'), 'utf8'), '# Ideas\n\nAn old idea.\n', 'word for word');
  rmSync(absOf('Ideas.md'));
});

// ── Every number agrees ────────────────────────────────────────────────────────────────────────────
// Today, Tasks, the hub's Due, the brief's five and the morning bell read the same vault the same way:
// finished and on-hold projects count nowhere, copies never count twice, and one late+today number
// comes out of every door. (the former host app's and the bots' answers walk in
// tests/update-from-1012.mjs there.)

test('one number from every door on the heavy vault', async () => {
  seed();
  const index = indexed();
  const day = M.todayData(index, { path: 'Daily/2026-11-05.md', exists: false }, NOW);
  const stepsLateToday = S.todayDueCount(day);
  const writes = [];
  const write = async (rel, text) => { writes.push(rel); index.set(rel, text, NOW.getTime(), text.length); };
  const reminders = new M.Reminders({
    dataDir: work, index, library: () => '/made-up/library', read: (rel) => index.content(rel), write,
    templatesFolder: () => 'Templates', show: () => {}, changed: () => {}, now: () => NOW.getTime(),
  });
  const hub = new M.Hub({
    index,
    dailyPath: (d) => `Daily/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => 'Templates', reminders: () => reminders.items(), write,
    startDay: async (d) => `Daily/${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}.md`, now: () => NOW.getTime(),
  });
  const tasks = new M.TasksService({ index, templatesFolder: () => 'Templates', write, now: () => NOW.getTime() });
  const due = hub.due();
  const me = day.me ?? ME;
  const own = (list) => list.filter((e) => S.todayCount.isOwnText(e.kind === 'reminder' ? e.item.text : e.item.words, me, NOW, due.known));
  const noteCount = own([...due.overdue, ...due.today]).length;
  const oneNumber = stepsLateToday + noteCount;
  // The one counting query says it too, over the same lists the rail, Today and Tasks read.
  const steps = [...day.due.overdue, ...day.due.today, ...day.due.soon, ...day.due.later]
    .filter((x) => x.kind === 'step')
    .map((x) => ({ words: `${x.what}${x.who ? ` — ${x.who}` : ''}`, due: x.when, done: false }));
  const notes = [...due.overdue, ...due.today, ...due.week, ...due.later].map((e) => ({
    words: e.kind === 'reminder' ? e.item.text : e.item.words, due: e.day, done: false,
  }));
  const ltw = S.countLateTodayWeek([...steps, ...notes], me, NOW, due.known);
  assert.equal(ltw.late + ltw.today, oneNumber, `late ${ltw.late} + today ${ltw.today} is the one number ${oneNumber}`);
  assert.ok(oneNumber > 20, `a heavy vault's number is a real pile, counted once (${oneNumber})`);
  // Dormant boxes are nowhere: not Today, not Due, not Tasks, not the brief's five.
  const dormantWhats = [];
  for (const rel of [...snapshot(vaultDir).keys()].filter((r) => r.startsWith('Projects/') && r.endsWith('.md'))) {
    const text = readFileSync(absOf(rel), 'utf8');
    if (!S.todayCount.isDormantProjectText(text)) continue;
    dormantWhats.push(...S.projectFile.parseProject(text, rel).next.filter((s) => !s.done).map((s) => s.what));
  }
  assert.equal(dormantWhats.length, 20, `${dormantWhats.length} dormant boxes kept on their pages, not 20`);
  const allDue = [...day.due.overdue, ...day.due.today, ...day.due.soon, ...day.due.later, ...day.due.stale, ...day.due.passed];
  const allHub = [...due.overdue, ...due.today, ...due.week, ...due.later];
  const view = tasks.view();
  const open = view.tasks.filter((t) => !t.done);
  for (const what of dormantWhats) {
    assert.ok(!allDue.some((x) => x.what === what), `not in Today: ${what}`);
    assert.ok(!allHub.some((e) => (e.item.words ?? e.item.text ?? '').includes(what.slice(0, 20))), `not in Due: ${what}`);
    assert.ok(!open.some((t) => t.words === what || t.text.includes(what)), `not in Tasks: ${what}`);
  }
  const files = [...snapshot(vaultDir).keys()].filter((r) => r.endsWith('.md') && !r.startsWith('.neuralvault/'))
    .map((p) => ({ path: p, text: readFileSync(absOf(p), 'utf8'), modified: AT }));
  const five = S.topFiveFromProjectTexts(files, NOW, me);
  for (const what of dormantWhats) assert.ok(!JSON.stringify(five).includes(what), `not in the brief’s five: ${what}`);
  assert.ok(!reminders.items().some((r) => dormantWhats.some((w) => r.text.includes(w.slice(0, 20)))), 'no dormant chime among reminders');
  // And the live boxes are all there to be counted: 110 on live projects and notes.
  let live = 0;
  for (const rel of [...snapshot(vaultDir).keys()].filter((r) => r.startsWith('Projects/') && r.endsWith('.md'))) {
    const text = readFileSync(absOf(rel), 'utf8');
    if (S.todayCount.isDormantProjectText(text)) continue;
    if (!S.projectFile.isProjectText(text)) { live += (text.match(/- \[ \]/g) || []).length; continue; }
    const p = S.projectFile.parseProject(text, rel);
    live += p.next.filter((s) => !s.done).length;
  }
  assert.equal(live, 110, `${live} live boxes, not 110`);
  assert.deepEqual(writes, [], 'counting writes nothing');
});

// ── No notice storm: every notice, toast and card of the first ten minutes ─────────────────────────
// On this vault: the records move offered once on the Systems page (waiting for the laptop), the Inbox
// rule's one short card on first Inbox visit, two genuinely due reminders, and nothing else. No adopt
// dialog, no connect notice (no new connections), no auto-filed pile.

test('the records move is offered once, calmly, and waits for the second PC', async () => {
  seed();
  const w = systemsOn(indexed());
  const state = await M.systemMove.moveState(w);
  assert.equal(state.offer, true, 'offered on the Systems page');
  assert.equal(state.counts.fold, 120, `${state.counts.fold} fold, not 120`);
  assert.equal(state.counts.stay, 3, `${state.counts.stay} stay, not 3`);
  assert.ok(state.pcsBlock && state.pcsBlock.words.includes("Sam's Laptop"), 'it waits for the laptop: ' + state.pcsBlock?.words);
  const plan = await M.systemMove.planMove(w);
  const words = M.systemMove.previewWords(plan);
  assert.equal(words.length, 5, 'four plain lines and the waiting line');
  for (const line of words) assert.ok(!/[—–]/.test(line), 'plain words, no dashes: ' + line);
  assert.match(words[0], /120 notes/, 'it says what tidies: ' + words[0]);
  assert.match(words[1], /3 notes hold/, 'and what stays: ' + words[1]);
  // Nothing moved by looking: the offer writes nothing to the vault.
  const files = [...snapshot(vaultDir).keys()].filter((r) => !r.startsWith('.neuralvault/pcs/'));
  assert.ok(!files.some((r) => r.includes('systems-move') || r.includes('Machines.md')), 'looking moves nothing');
  // Put away for now: offered once, then waiting on the page.
  assert.match(await M.systemMove.deferMove(w), /stays on the Systems page/, 'deferred in plain words');
  const afterDefer = await M.systemMove.moveState(w);
  assert.equal(afterDefer.offer, false, 'offered once: no second ask');
  assert.equal(afterDefer.deferred, true, 'waiting on the page instead');
  assert.equal(afterDefer.counts.fold, 120, 'the lists still work underneath');
});

test('a title line of its own stays a note, even on a machine-made frame', () => {
  seed();
  // 10.1.2's writers put no `#` line in (the heavy vault above proves it); one there means the person
  // gave the note its own structure, so the move keeps it, whatever the checks wrote around it.
  const [, frame] = machineNote(1);
  const titled = frame.replace('---\n## Health log', '---\n# Machine 001\n\n## Health log');
  const props = { type: 'machine', kind: 'Server', role: 'Till', os: 'Ubuntu 24.04', address: '192.168.1.11', location: 'Shop', status: 'ok', checked: '2026-11-04' };
  assert.equal(S.systemTables.classifySystemsNote({ type: 'machine', title: 'Machine 001', props, content: frame }, {}).fold, true, 'the frame as 10.1.2 leaves it folds');
  assert.equal(S.systemTables.classifySystemsNote({ type: 'machine', title: 'Machine 001', props, content: titled }, {}).fold, false, 'the same frame with a title line stays');
});

test('with no model, the Inbox files nothing by itself on first open', async () => {
  seed();
  const before = readFileSync(absOf('Inbox.md'), 'utf8');
  const inbox = inboxOn(indexed());
  const r = await inbox.call('inbox:auto-file');
  assert.equal(r.model, false, 'no model: no proposals, no filing');
  assert.deepEqual(r.filed, [], 'nothing filed');
  assert.equal(readFileSync(absOf('Inbox.md'), 'utf8'), before, 'all 25 captures still waiting');
});

test('with a model, old captures stay for the person: only new captures file themselves', async () => {
  seed();
  const index = indexed();
  // The model is sure about everything old (the worst case: a pile that must not move).
  const sureAboutAll = async (system, user) => {
    const asked = JSON.parse(user);
    return { reply: { items: asked.items.map((it) => ({ id: it.id, homes: [{ path: 'Projects/Harbour Cafe/Harbour Cafe.md', why: 'Sure', sure: true }] })) } };
  };
  const inbox = inboxOn(index, sureAboutAll);
  const first = await inbox.call('inbox:auto-file');
  assert.equal(first.model, true, 'the model proposed homes for what is waiting');
  assert.deepEqual(first.filed, [], 'but the 25 old captures file nowhere by themselves');
  assert.equal(Object.keys(first.proposals).length, 25, 'each still listed on its button, none filed away');
  // A capture made after the update files straight there, saying where, with one Undo.
  const now = `${readFileSync(absOf('Inbox.md'), 'utf8').trim()}\n- [ ] Ring the agent about the Grey Street lease\n`;
  write(absOf('Inbox.md'), now);
  index.set('Inbox.md', now, Date.now(), now.length);
  const harbourBefore = readFileSync(absOf('Projects/Harbour Cafe/Harbour Cafe.md'), 'utf8');
  const second = await inbox.call('inbox:auto-file');
  assert.equal(second.filed.length, 1, 'the one new capture filed itself');
  assert.equal(second.filed[0].name, 'Harbour Cafe', 'into its home');
  assert.match(second.words, /Harbour Cafe/, 'saying where: ' + second.words);
  assert.ok(second.undo, 'with one Undo');
  const undone = await inbox.call('inbox:undo-auto', second.undo);
  assert.match(undone.words, /back in the Inbox/, 'undone: ' + undone.words);
  assert.ok(readFileSync(absOf('Inbox.md'), 'utf8').includes('Ring the agent about the Grey Street lease'), 'the line is back waiting');
  assert.equal(readFileSync(absOf('Projects/Harbour Cafe/Harbour Cafe.md'), 'utf8'), harbourBefore, 'the project is as it was');
});

test('an existing vault opens with no adopt question', async () => {
  seed();
  const s = new M.settings.SettingsStore(pcDir);
  await s.load();
  const svc = M.vaultHomeSvc.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: pcDir, dataDir: pcDir },
    settings: s, places: async () => ({ roots: [], network: [] }), placesStubbed: true, placeDeps: { path, platform: 'linux' },
    vaultRoot: () => vaultDir, library: () => vaultDir, templates: () => 'Templates',
    ownCounts: () => null, ownFiles: () => new Map(),
    openVault: async () => { throw new Error('not in this test'); }, useLibrary: async () => { throw new Error('not in this test'); },
    carryLibraryData: async () => {}, toTrash: async () => {}, canWrite: async () => true,
    keepRecovery: () => {}, send: () => {}, win: () => ({}), moving: { get: () => false, set: () => {} },
    rescan: async () => {},
  });
  globalThis.__nvDialogCalls = [];
  assert.equal(await svc.confirmAdopt(vaultDir), 'adopt', 'an identity vault is adopted with no question');
  assert.equal(globalThis.__nvDialogCalls.length, 0, 'no dialog was shown for it');
});

test('the only reminders due are the two genuinely due ones, in plain words', async () => {
  seed();
  const index = indexed();
  const writes = [];
  const reminders = new M.Reminders({
    dataDir: work, index, library: () => '/made-up/library',
    read: (rel) => index.content(rel),
    write: async (rel, text) => { writes.push(rel); index.set(rel, text, NOW.getTime(), text.length); },
    templatesFolder: () => 'Templates', show: () => {}, changed: () => {}, now: () => NOW.getTime(),
  });
  const items = reminders.items();
  assert.equal(items.length, 2, `${items.length} reminders due, not 2: ` + items.map((r) => r.text).join(' | '));
  for (const r of items) assert.ok(!/[—–]/.test(r.text), 'plain words: ' + r.text);
  assert.deepEqual(writes, [], 'listing writes nothing');
});

test('the morning bell says one line for tasks due today, never a notice each', async () => {
  seed();
  const index = indexed();
  const hub = new M.Hub({
    index,
    dailyPath: (day) => `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => 'Templates',
    reminders: () => [],
    write: async () => {},
    startDay: async (day) => `Daily/${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}.md`,
    now: () => NOW.getTime(),
  });
  const due = hub.due();
  const open = due.today.map((e) => ({ words: e.item.words, projectName: '', title: '', due: '2026-11-05', done: false, reminder: false, path: e.item.path ?? '' }));
  const words = M.dueTodayWords(M.dueTodayTasks({ today: '2026-11-05', tasks: open }));
  assert.match(words.title, /^Due today: \d+ tasks?$/, 'one line, however many: ' + words.title);
  assert.ok(!/[—–]/.test(words.title + words.body), 'plain words: ' + words.body);
});

test('the Inbox rule’s one card is short and plain', () => {
  assert.equal(S.inboxTour.INBOX_TOUR_STEPS.length, 4, 'four short steps, once');
  const words = S.inboxTour.INBOX_TOUR_STEPS.map((s) => `${s.title}. ${s.body}`).join(' ');
  assert.ok(words.length < 400, 'short enough to read at once');
  assert.ok(!/[—–]/.test(words) && !/\bAI\b|\bmodel\b/i.test(words), 'plain words, nothing about AI: ' + words);
});

// ── Start-up time does not get worse ───────────────────────────────────────────────────────────────────
// The open on this vault, before and after: what costs what, in milliseconds, on this machine. The
// Systems lists and the fold must not make Today slow: Today never reads the Systems model.

test('opening this vault costs no worse than 10.1.2, and Today never touches Systems', async () => {
  seed();
  const files = [...snapshot(vaultDir).keys()].filter((r) => r.endsWith('.md') && !r.startsWith('.neuralvault/'));
  const texts = new Map(files.map((r) => [r, readFileSync(absOf(r), 'utf8')]));
  const time = (fn) => {
    const t0 = process.hrtime.bigint();
    const out = fn();
    return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  // New code: index, Today, the hub's Due, the Systems model, the move's plan.
  const { out: index, ms: indexMs } = time(() => {
    const ix = new M.VaultIndex();
    for (const [r, t] of texts) ix.set(r, t, AT, t.length);
    return ix;
  });
  const { ms: todayMs } = time(() => M.todayData(index, { path: 'Daily/2026-11-05.md', exists: false }, NOW));
  const hub = new M.Hub({
    index, dailyPath: () => 'Daily/2026-11-05.md', templatesFolder: () => 'Templates', reminders: () => [],
    write: async () => {}, startDay: async () => 'Daily/2026-11-05.md', now: () => NOW.getTime(),
  });
  const { ms: dueMs } = time(() => hub.due());
  const sysNotes = [...texts].filter(([r]) => r.startsWith('Systems/')).map(([p, content]) => {
    const meta = index.get(p);
    return { path: p, title: p.split('/').pop().replace(/\.md$/, ''), props: meta?.props ?? {}, content, type: String(meta?.props?.type ?? '') };
  });
  const { ms: systemsMs } = time(() => S.systems.systemsModel(sysNotes, NOW, {}));
  const w = systemsOn(index);
  const planT0 = process.hrtime.bigint();
  await M.systemMove.planMove(w);
  const planMs = Number(process.hrtime.bigint() - planT0) / 1e6;
  // Old code (10.1.2): index, Today, the Systems model on the same notes.
  const { ms: oldIndexMs } = time(() => {
    const ix = new OLD.VaultIndex();
    for (const [r, t] of texts) ix.set(r, t, AT, t.length);
    return ix;
  });
  const oldIndex = new OLD.VaultIndex();
  for (const [r, t] of texts) oldIndex.set(r, t, AT, t.length);
  const oldMetas = oldIndex.allMeta();
  const { ms: oldTodayMs } = time(() => OLD.buildToday({
    projects: oldMetas.filter((m) => m.props?.type === 'project').map((m) => ({ path: m.path, version: 'v', modified: AT, project: OLD.projectFile.parseProject(texts.get(m.path) ?? '', m.path) })),
    notes: [], me: ME,
  }, NOW));
  const { ms: oldSystemsMs } = time(() => OLD.systems.systemsModel(sysNotes, NOW, {}));
  console.log(`update-from-1012 timing on ${files.length} notes: index ${indexMs.toFixed(0)} ms (10.1.2: ${oldIndexMs.toFixed(0)}), ` +
    `Today ${todayMs.toFixed(0)} ms (10.1.2: ${oldTodayMs.toFixed(0)}), Due ${dueMs.toFixed(0)} ms, ` +
    `Systems model ${systemsMs.toFixed(0)} ms (10.1.2: ${oldSystemsMs.toFixed(0)}), move plan ${planMs.toFixed(0)} ms`);
  assert.ok(indexMs < 15000, `indexing stays quick (${indexMs.toFixed(0)} ms)`);
  assert.ok(todayMs < 5000, `Today assembles quickly (${todayMs.toFixed(0)} ms)`);
  assert.ok(todayMs < Math.max(2000, oldTodayMs * 4), `Today is no worse than 10.1.2 (${todayMs.toFixed(0)} vs ${oldTodayMs.toFixed(0)} ms)`);
  assert.ok(planMs < 5000, `the move's plan reads quickly (${planMs.toFixed(0)} ms)`);
  // Structural: Today never reads the Systems model or the move, so the lists and the fold cannot slow it.
  const todaySrc = readFileSync(path.join(root, 'src/main/today.ts'), 'utf8') + readFileSync(path.join(root, 'src/shared/today.ts'), 'utf8');
  assert.ok(!/systemsModel|planMove|system-tables|life-records/.test(todaySrc), 'Today imports no Systems machinery');
});

// ── Going back, and a fresh install ────────────────────────────────────────────────────────────────────
// 10.1.2, or a second PC still on it, sees the same vault: repaired names with their links already
// following, counts in its own older way, nothing it cannot read. Nothing is lost. A reinstall opens
// the same vault with no question.

test('going back to 10.1.2 loses nothing and reads everything', async () => {
  seed();
  const notes = [...snapshot(vaultDir).keys()].filter((r) => r.endsWith('.md') && !r.startsWith('.neuralvault/'));
  // Every note parses under 10.1.2's readers.
  let projects = 0, systems = 0, inbox = 0;
  for (const rel of notes) {
    const text = readFileSync(absOf(rel), 'utf8');
    if (rel.startsWith('Projects/') && OLD.projectFile.isProjectText(text)) { OLD.projectFile.parseProject(text, rel); projects++; }
    if (rel.startsWith('Systems/')) systems++;
    if (rel === 'Inbox.md') inbox = OLD.inbox.inboxLines(text).length;
  }
  assert.equal(projects, 20, 'all 20 projects parse under 10.1.2');
  assert.equal(systems, 123, 'all 123 Systems notes are still notes under 10.1.2');
  assert.ok(inbox >= 25, `the Inbox reads under 10.1.2 (${inbox} captures)`);
  const sysIndex = indexed();
  const sysNotes = notes.filter((r) => r.startsWith('Systems/')).map((p) => {
    const meta = sysIndex.get(p);
    return { path: p, title: p.split('/').pop().replace(/\.md$/, ''), props: meta?.props ?? {}, content: readFileSync(absOf(p), 'utf8'), type: String(meta?.props?.type ?? '') };
  });
  const oldSystems = OLD.systems.systemsModel(sysNotes, NOW, {});
  assert.ok(oldSystems.machines.length > 60, `10.1.2 still lists its machines (${oldSystems.machines.length})`);
  assert.equal(oldSystems.machines.length + oldSystems.services.length + oldSystems.runbooks.length, 123, '10.1.2 lists all 123 Systems notes');
  // The repaired names land under 10.1.2's own reading: links already follow, the recording is there.
  assert.ok(!notes.some((r) => S.paths.needsWindowsRepair(r.split('/').pop())), 'no name left that needs repair');
  const idx = readFileSync(absOf('Notes/Index.md'), 'utf8');
  assert.ok(idx.includes('[[Meetings/LF planning|the plan]]'), 'the Index link is a plain link 10.1.2 follows');
  assert.ok(readFileSync(absOf('Meetings/LF planning.md'), 'utf8').includes('(Files/LF planning/rec.wav)'), 'the recording link is plain too');
  // What 10.1.2 never wrote sits in the app's folder, where 10.1.2 never looks: no 10.1.2
  // source names the filer's seen list, the move's deferral, the move's receipt or the names receipt.
  const oldTree = path.join(work, 'old-nv', 'src');
  const oldSrc = [];
  const gather = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) gather(path.join(d, e.name));
      else if (e.name.endsWith('.ts')) oldSrc.push(readFileSync(path.join(d, e.name), 'utf8'));
    }
  };
  gather(oldTree);
  const oldAll = oldSrc.join('\n');
  for (const unknown of ['inbox-auto-seen', 'recordsMove', 'systems-move.json', 'name-repairs']) {
    assert.ok(!oldAll.includes(unknown), `10.1.2 never names ${unknown}: it ignores it`);
  }
  assert.ok(snapshot(vaultDir).has('.neuralvault/module-options.json'), 'the deferral sits in the app’s folder');
  assert.ok(snapshot(vaultDir).has('.neuralvault/journal/inbox-auto-seen.json'), 'the filer’s seen list sits in the app’s folder');
  // The brand index is byte for byte the 10.1.2 shape: old readers see the one kit.
  const brand = JSON.parse(readFileSync(absOf('Assets/assets.json'), 'utf8'));
  assert.deepEqual(Object.keys(brand).sort(), ['assets', 'brand', 'collections', 'version'], 'no new keys: 10.1.2 reads it whole');
});

test('uninstall and reinstall on the same vault works', async () => {
  seed();
  // A reinstall: the app's own data is gone, the vault is as the person left it.
  const freshPc = path.join(work, 'fresh-pc');
  const s = new M.settings.SettingsStore(freshPc);
  await s.load();
  globalThis.__nvDialogCalls = [];
  const svc = M.vaultHomeSvc.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: freshPc, dataDir: freshPc },
    settings: s, places: async () => ({ roots: [], network: [] }), placesStubbed: true, placeDeps: { path, platform: 'linux' },
    vaultRoot: () => vaultDir, library: () => vaultDir, templates: () => 'Templates',
    ownCounts: () => null, ownFiles: () => new Map(),
    openVault: async () => { throw new Error('not in this test'); }, useLibrary: async () => { throw new Error('not in this test'); },
    carryLibraryData: async () => {}, toTrash: async () => {}, canWrite: async () => true,
    keepRecovery: () => {}, send: () => {}, win: () => ({}), moving: { get: () => false, set: () => {} },
    rescan: async () => {},
  });
  assert.equal(await svc.confirmAdopt(vaultDir), 'adopt', 'the vault is adopted with no question after reinstall');
  assert.equal(globalThis.__nvDialogCalls.length, 0, 'no dialog was shown for it');
  const before = snapshot(vaultDir);
  await s.useVault(vaultDir);
  await svc.opened(vaultDir);
  const index = indexed();
  assert.ok(index.get('Home.md') && index.get('Inbox.md'), 'the notes open under the fresh install');
  const after = snapshot(vaultDir);
  const changed = [...after.keys()].filter((k) => !before.has(k) || !after.get(k).equals(before.get(k)));
  const personChanged = changed.filter((r) => !r.startsWith('.neuralvault/'));
  assert.deepEqual(personChanged, [], 'moving in writes no person file: ' + personChanged.join(', '));
  await new Promise((r) => setTimeout(r, 150)); // let the fresh PC's own settings save land before the test ends
});
