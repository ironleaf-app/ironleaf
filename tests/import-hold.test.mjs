// node --test tests/import-hold.test.mjs — bringing a big Obsidian vault in (20 Nov 2026, on the first Windows
// build: importing notes broke settings and kept closing the window). Reproduced on Plover with a copy of
// a real 1,661-file vault: Import › Copy in… › A folder took 312 s with the main process pegged, because the watcher
// read, kept as an outside change and announced each arriving file, and each announcement had the window ask for
// Today, Inbox, Projects and the brief again; settings.json was saved several times at once on the way (see
// tests/settings-save-race.test.mjs). The import now holds the watcher's file-by-file news and rescans once.
// Made-up notes only, shaped like an Obsidian vault: .obsidian, numbered nested folders, canvases, PDFs, pictures,
// templates, frontmatter with aliases, tags and dates, wikilinks with headings and block references
// (src/main/vault-home-service.ts, src/main/pairing/service.ts, src/main/app.ts).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-import-hold-'));
let B;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const electron = {
    name: 'electron-stand-in',
    resolveId: (id) => (id === 'electron' ? '\0electron' : null),
    load: (id) =>
      id === '\0electron'
        ? `export const app = { getPath: () => ${JSON.stringify(path.join(work, 'userdata'))}, isPackaged: false };
           export const shell = { trashItem: async () => {} };
           export const dialog = { showMessageBox: async () => ({ response: 2 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) };`
        : null,
  };
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * from ${JSON.stringify(path.join(root, 'src/main/vault-home-service.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/main/vault-place.ts'))};`].join('\n'));
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  await build({ input: entry, platform: 'node', external: ['yaml'], plugins: [electron], output: { file: path.join(work, 'b.mjs'), format: 'esm', inlineDynamicImports: true }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const put = (abs, data) => {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** A made-up Obsidian vault of `n` notes in numbered, nested folders. */
function obsidianVault(dir, n) {
  put(path.join(dir, '.obsidian', 'app.json'), JSON.stringify({ attachmentFolderPath: '91 Assets', alwaysUpdateLinks: true }));
  put(path.join(dir, '.obsidian', 'daily-notes.json'), JSON.stringify({ folder: '00 Inbox/Daily', format: 'YYYY-MM-DD' }));
  put(path.join(dir, '.obsidian', 'plugins', 'dataview', 'data.json'), '{}');
  const folders = ['00 Inbox', '01 Work/Projects/Bakery Fit-out', '01 Work/Meetings', '02 Personal/Health', '04 Creative/Game/Levels/L1 Garden', '99 Archive/2025'];
  for (let i = 0; i < 6; i++) put(path.join(dir, '91 Assets', `Pasted image ${i}.png`), PNG);
  put(path.join(dir, '91 Assets', 'Menu.pdf'), PDF);
  put(path.join(dir, '90 Templates', 'Daily.md'), '---\ndate: {{date}}\n---\n# {{date}}\n');
  put(path.join(dir, '01 Work', 'Board.canvas'), JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: '00 Inbox/Note 0.md', x: 0, y: 0, width: 200, height: 100 }], edges: [] }));
  for (let i = 0; i < n; i++) {
    const f = folders[i % folders.length];
    put(
      path.join(dir, ...f.split('/'), `Note ${i}.md`),
      `---\naliases: [N${i}]\ntags: [made-up, area/${i % 3}]\ncreated: 2025-03-0${1 + (i % 9)}\n---\n# Note ${i}\n\nSee [[Note ${(i + 1) % n}#Plan|the plan]] and [[Note ${(i + 2) % n}#^b${i}]].\n\n## Plan\n\n- [ ] made-up step ${i}\n\n![[Pasted image ${i % 6}.png]]\n\nA line ^b${i}\n`,
    );
  }
}

function service(over = {}) {
  const calls = { holds: 0, holding: false, rescans: [], synced: [] };
  const settingsData = { library: '', lastVault: '', recentVaults: [], prefs: { templatesFolder: 'Templates' }, current: null };
  const settings = { raw: settingsData, update: async () => {}, setCurrent: async (c) => (settingsData.current = c), homeDismissed: () => false };
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const vault = mkdtempSync(path.join(work, 'vault-'));
  const svc = B.createVaultHomeService({
    host: { kind: 'test', appId: 'test', defaultLibrary: path.join(work, 'nolib'), dataDir },
    settings,
    places: async () => ({ roots: [], network: [] }),
    placesStubbed: true,
    placeDeps: B.systemDeps(),
    vaultRoot: () => vault,
    library: () => vault,
    templates: () => 'Templates',
    ownCounts: () => ({ notes: 0, projects: 0 }),
    ownFiles: () => new Map(),
    openVault: async () => ({}),
    useLibrary: async () => ({}),
    carryLibraryData: async () => {},
    toTrash: async () => {},
    trashRel: async () => {},
    canWrite: async () => true,
    keepRecovery: () => {},
    send: () => {},
    win: () => null,
    moving: { get: () => false, set: () => {} },
    rescan: async () => calls.rescans.push({ holding: calls.holding }),
    relationsSynced: async (rels) => calls.synced.push({ holding: calls.holding, n: rels.length }),
    holdWatch: async (run) => {
      calls.holds++;
      calls.holding = true;
      try {
        return await run();
      } finally {
        calls.holding = false;
      }
    },
    ...over,
  });
  return { svc, calls, vault };
}

test('a big Obsidian vault comes in with the watcher held for the whole merge, then one rescan', async () => {
  const src = path.join(work, 'Jesse Made Up');
  obsidianVault(src, 400);
  const { svc, calls, vault } = service();
  let handlers = {};
  svc.register((ch, fn) => (handlers[ch] = fn));
  const plan = await handlers['home:import-pick']('folder', src);
  assert.ok(plan && plan.notes >= 400, `the plan counts the notes (${plan?.notes})`);
  const summary = await handlers['home:import']();
  assert.match(summary.words, /new files/);
  assert.equal(calls.holds, 1, 'the merge ran inside one hold of the watcher');
  assert.ok(calls.rescans.length === 1 && calls.rescans[0].holding, 'one rescan reads everything at once, still inside the hold');
  assert.equal(calls.synced.length, 0, 'an import syncs no links back (20 Nov 2026)');
  const into = path.join(vault, plan.into || '');
  assert.ok(existsSync(path.join(into, '01 Work', 'Projects', 'Bakery Fit-out', 'Note 1.md')), 'nested numbered folders kept');
  assert.ok(existsSync(path.join(into, '01 Work', 'Board.canvas')), 'canvases come in');
  assert.ok(existsSync(path.join(into, '91 Assets', 'Menu.pdf')), 'PDFs come in');
  assert.match(readFileSync(path.join(into, '00 Inbox', 'Note 0.md'), 'utf8'), /\[\[Note 1#Plan\|the plan\]\]/, 'links with headings untouched');
});

test('a failed import still releases the hold (the app rescans what did arrive)', async () => {
  const { svc, calls } = service();
  const handlers = {};
  svc.register((ch, fn) => (handlers[ch] = fn));
  await assert.rejects(() => handlers['home:import'](), /Choose what to import first/);
  assert.equal(calls.holding, false);
});

test('the app holds its watcher while an import runs, and reads everything once after (src/main/app.ts)', () => {
  const src = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.match(src, /next\.on\('change', async \(rel: string\) => \{\n\s+if \(vault !== next \|\| importHold > 0\) return;/, 'file-by-file news ignored while held');
  assert.match(src, /next\.on\('rescan', \(\) => \{\n\s+if \(vault === next && importHold === 0\) void rescan\(next\);/, 'rescans wait while held');
  const hold = src.slice(src.indexOf('async function holdWatch'), src.indexOf('async function indexFile'));
  assert.match(hold, /finally \{[\s\S]*importHold--;[\s\S]*if \(importHold === 0 && vault\) await rescan\(vault\)[\s\S]*notifyChanged\(\[\]\)/, 'the hold ends with one rescan and one announcement, even after a failure');
  const notify = src.slice(src.indexOf('function notifyChanged('), src.indexOf('function filesChanged('));
  assert.match(notify, /if \(importHold > 0\) return;\n\s+changeTimer = setTimeout/, 'changes made while held (the links synced back) wait to be said once');
  assert.equal((src.match(/^\s+holdWatch,$/gm) ?? []).length, 2, 'both import services (vault home and pairing) get the hold');
  const pairing = readFileSync(path.join(root, 'src/main/pairing/service.ts'), 'utf8');
  assert.match(pairing, /await hold\(async \(\) => \{\n\s+const brought = await importSource\(/);
  assert.match(pairing, /const synced = await syncLive\(/);
});
