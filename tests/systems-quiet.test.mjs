// node --test tests/systems-quiet.test.mjs — Systems stops writing notes on its own (5 Nov 2026). The steady beat
// never creates a note: it keeps checking machines already there and keeps writing their health, while new services it
// finds are held as a quiet list on the Systems page ("Found N new services on X" with Add them and Not now). Check
// now, Write the runbooks it needs and the assistant tools may still create (a person asked), saying how many first
// when more than a few, with one Undo moving every note from one press to the Bin. Switching off the Runbooks part
// stops runbook creation everywhere.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-systems-quiet-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(entry, ['lists', 'goals', 'systems', 'business', 'memories', 'life-records', 'life-modules', 'module-records', 'module-tools', 'sensitivity'].map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'business', name: 'Business', folder: 'Business' }, { id: 'home', name: 'Home', folder: 'Home' }, { id: 'family', name: 'Family', folder: 'Family' }, { id: 'me', name: 'Me', folder: 'Me' }] });

const MACHINE = (name, address) => `---\ntype: machine\nkind: Server\naddress: ${address}\nstatus: Up\nchecked: 2026-10-23\n---\n## Credentials\n\n- Admin: [locked](secret:Ab12Cd34Ef)\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n| 2026-10-23 | Up | Checked: Ubuntu 24.04.1 LTS, up 11 days. |\n\n## Notes\n\n`;
const FILES = () => ({
  '.neuralvault/areas.json': AREAS,
  'Home/Systems and Home Lab/Machines/Juniper.md': MACHINE('Juniper', '192.168.1.40'),
});

// A probe that finds N new services (none of them the system's own plumbing).
function probeWith(n) {
  const svcs = Array.from({ length: n }, (_, i) => `tide-app-${i + 1}.service`).join('\n');
  return `@@os\nUbuntu 24.04.1 LTS\n@@uptime\n1000000 0\n@@disk\n/dev/sda1 100 43 57 43% /\n@@memory\n7800 2100\n@@updates\n3\n@@security\n1\n@@services\n${svcs}\n@@containers\n@@ports\n`;
}

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  return { dir, index };
}

function core(files, switches, extra = {}) {
  const { dir, index } = vault(files);
  const posted = [];
  const written = [];
  const trashed = [];
  const vaultObj = {
    root: dir,
    any: async (rel) => {
      try {
        readFileSync(path.join(dir, rel));
        return true;
      } catch {
        return written.some((x) => x.rel === rel);
      }
    },
    trash: async (rel) => {
      trashed.push(rel);
      const abs = path.join(dir, rel);
      const bin = path.join(dir, '.neuralvault', 'bin-test', path.basename(rel));
      mkdirSync(path.dirname(bin), { recursive: true });
      try {
        writeFileSync(bin, readFileSync(abs, 'utf8'));
      } catch {}
      rmSync(abs, { force: true });
      index.delete?.(rel);
    },
  };
  const w = new M.WorkModules(
    {
      vault: () => vaultObj,
      index,
      prefs: () => ({ templatesFolder: 'Templates', modules: switches.now }),
      writeNote: async (rel, text) => {
        written.push({ rel, text });
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
        index.set(rel, text, 0, text.length);
      },
      importFiles: async (paths, folder) => paths.map((p) => `${folder}/${path.basename(p)}`),
      pickFiles: async () => [],
      saveFile: async () => null,
      post: (items) => {
        const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
        posted.push(...fresh);
        return fresh.length;
      },
      editProject: async () => ({}),
      projects: () => [],
      records: () => ({}),
      requireCreate: async () => {},
      now: () => TODAY,
      login: async () => ({ username: 'madeup', value: 'made-up-value' }),
      dataDir: path.join(dir, '.nv-data'),
      ...extra,
    },
    M.LIFE_RECORDS_GROUP,
  );
  const part = (id) => w.parts.find((p) => p.id === id);
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  const servicesDir = path.join(dir, 'Home/Systems and Home Lab/Services');
  const runbooksDir = path.join(dir, 'Home/Systems and Home Lab/Runbooks');
  const serviceFiles = () => (existsSync(servicesDir) ? readdirSync(servicesDir).filter((f) => f.endsWith('.md')) : []);
  const runbookFiles = () => (existsSync(runbooksDir) ? readdirSync(runbooksDir).filter((f) => f.endsWith('.md')) : []);
  return { w, dir, index, posted, written, trashed, part, read, serviceFiles, runbookFiles };
}

test('systems quiet (5 Nov 2026): the beat over a machine with new services creates no file, holding them quietly', async () => {
  const { part, serviceFiles, runbookFiles, read } = core(FILES(), { now: { systems: { on: true } } }, { probe: async () => probeWith(14) });
  const systems = part('systems');
  const before = serviceFiles().length + runbookFiles().length;
  await systems.ops['check-all']();
  assert.equal(serviceFiles().length + runbookFiles().length, before, 'the beat creates no service or runbook note');
  const m = await systems.ops.model();
  assert.ok(Array.isArray(m.found), 'the model carries the quiet list');
  const juniper = m.found.find((g) => g.machineName === 'Juniper');
  assert.ok(juniper, 'the new services are held for Juniper');
  assert.equal(juniper.services.length, 14, 'all 14 found are held quietly');
  assert.match(read('Home/Systems and Home Lab/Machines/Juniper.md'), /checked: 2026-10-24/, 'the machine was still checked');
  assert.match(read('Home/Systems and Home Lab/Machines/Juniper.md'), /Checked: Ubuntu/, 'its health was still written');
});

test('systems quiet: Add them adds what was held, Not now remembers so it does not nag', async () => {
  const c = core(FILES(), { now: { systems: { on: true } } }, { probe: async () => probeWith(4) });
  const systems = c.part('systems');
  await systems.ops['check-all']();
  let m = await systems.ops.model();
  assert.equal(m.found[0]?.services.length, 4);
  const heldBooks = m.found[0]?.runbooks.length ?? 0;
  assert.ok(heldBooks > 0, 'the runbooks it needs are held quietly too');
  const added = await systems.ops['found-add'](m.found[0].machinePath);
  m = await systems.ops.model();
  assert.equal(m.services.length, 4, 'Add them adds the held services as rows (records as data, 5 Nov 2026: facts go in the lists, not notes)');
  assert.ok(m.services.every((s) => s.path.includes('#')), 'they arrive as rows, not notes');
  assert.equal(m.runbooks.length, heldBooks, 'the held runbooks arrive as rows too');
  assert.equal(c.serviceFiles().length, 0, 'no service note is written');
  assert.ok(added.created?.length === 4 + heldBooks, 'every row from one press is returned for one Undo');
  assert.equal(m.found.length, 0, 'nothing left held once added');
  // Not now: held again, put away, and the next beat does not nag.
  const c2 = core(FILES(), { now: { systems: { on: true } } }, { probe: async () => probeWith(3) });
  const s2 = c2.part('systems');
  await s2.ops['check-all']();
  let m2 = await s2.ops.model();
  assert.equal(m2.found[0]?.services.length, 3);
  await s2.ops['found-dismiss'](m2.found[0].machinePath);
  m2 = await s2.ops.model();
  assert.equal(m2.found.length, 0, 'Not now puts the quiet list away');
  await s2.ops['check-all']();
  m2 = await s2.ops.model();
  assert.equal(m2.found.length, 0, 'the next beat does not nag about what was put away');
  assert.equal(c2.serviceFiles().length, 0, 'and still creates nothing');
});

test('systems quiet: Check now may still create when a person asked, saying how many first with one Undo', async () => {
  const c = core(FILES(), { now: { systems: { on: true } } }, { probe: async () => probeWith(14) });
  const systems = c.part('systems');
  const r = await systems.ops.check('Home/Systems and Home Lab/Machines/Juniper.md');
  const words = typeof r === 'string' ? r : r.words;
  const created = typeof r === 'string' ? [] : (r.created ?? []);
  assert.match(words, /This adds 14 services/i, 'more than a few says how many first');
  let m = await systems.ops.model();
  assert.equal(m.services.length, 14, 'Check now still adds what it found (as rows since records as data, 5 Nov 2026)');
  assert.equal(c.serviceFiles().length, 0, 'no service note is written');
  assert.ok(created.length >= 14, 'every row from one press is returned together');
  const undone = await systems.ops['undo-created']({ paths: created });
  assert.match(undone.words ?? undone, /back out of the list/, 'one Undo takes every row from the press back out');
  m = await systems.ops.model();
  assert.equal(m.services.length, 0, 'every row from the press went together');
  assert.equal(m.runbooks.length, 0, 'its runbook rows went too');
});

test('systems quiet: switching off the Runbooks part stops runbook creation everywhere', async () => {
  const off = { now: { systems: { on: true, off: ['runbooks'] } } };
  const c = core(FILES(), off, { probe: async () => probeWith(5) });
  const systems = c.part('systems');
  await systems.ops['check-all']();
  assert.equal(c.runbookFiles().length, 0, 'the beat writes no runbooks when Runbooks is off');
  const r = await systems.ops.check('Home/Systems and Home Lab/Machines/Juniper.md');
  assert.equal(c.runbookFiles().length, 0, 'Check now writes no runbooks when Runbooks is off');
  let m = await systems.ops.model();
  assert.equal(m.services.length, 5, 'services still add (as rows) when Runbooks is off');
  assert.equal(m.runbooks.length, 0, 'no runbook row is written when Runbooks is off');
  const w = await systems.ops['ensure-runbooks']('Home/Systems and Home Lab/Machines/Juniper.md');
  const wWords = typeof w === 'string' ? w : w.words;
  assert.equal(c.runbookFiles().length, 0, 'Write the runbooks it needs writes none when Runbooks is off');
  assert.match(wWords, /switched off/i, 'it says why');
  const t = await c.w.callTool('system_runbooks_write', { machine: 'Juniper' }, null);
  assert.match(t.text, /switched off/i, 'the assistant tool also stops');
  assert.equal(c.runbookFiles().length, 0);
});

test('systems quiet: linking a login follows the quiet rule, and the assistant reports the count', async () => {
  const c = core(FILES(), { now: { systems: { on: true } } }, { probe: async () => probeWith(6) });
  const systems = c.part('systems');
  const rel = await systems.ops['add-machine']({ name: 'Socket box', kind: 'Server', address: '192.168.1.50' });
  const words = await systems.ops['link-secret'](rel, 'Admin login', 'Ab12Cd34Ef');
  assert.equal(c.serviceFiles().length, 0, 'linking a login creates no service note on its own');
  const m = await systems.ops.model();
  const held = m.found.find((g) => g.machineName === 'Socket box');
  assert.ok(held && held.services.length === 6, 'what it found is held quietly instead');
  const t = await c.w.callTool('system_check_now', { machine: 'Juniper' }, null);
  assert.match(t.text, /6 services|14 services|\d+ services/i, 'the assistant tool reports the count in its reply');
});
