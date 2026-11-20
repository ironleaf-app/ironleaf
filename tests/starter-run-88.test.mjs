// node --test tests/starter-run-88.test.mjs — a template really gets made (8.8 round 2, 31 Oct 2026, the reviewer:
// the made CRM board never showed, and no CRM files were made at all: Start sat below the window, out of reach). The
// real startStarter (state/starterTemplates.ts) runs against a temporary vault through the real Vault writes
// (src/main/vault.ts): the CRM's notes land in the named folder, every note's properties read, every view opens over
// real records, and the deals board is what opens. Starting twice never writes over («Start here 1» instead), and each
// of the ten opens the file it made. The live click itself is shots-88's (Start is back in reach: dialog-fit-88).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-starter-run-'));
let R; // the real startStarter, its window calls stubbed
let M; // the real Vault, views and readers
let vault;
const opened = [];
const toasts = [];
const errors = [];
let loads = 0;

before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  // The renderer side: the real startStarter, with only its window seams (opening, lists, toasts) stubbed.
  writeFileSync(path.join(work, 'actions-stub.ts'), 'export const openPath = (...a: unknown[]) => { (globalThis as any).__opened.push(a); };');
  writeFileSync(
    path.join(work, 'store-stub.ts'),
    'export const loadFiles = async () => { (globalThis as any).__loads++; };' +
      'export const loadNotes = async () => { (globalThis as any).__loads++; };' +
      'export const showError = (e: unknown) => { (globalThis as any).__errors.push(e); };' +
      'export const toast = (w: string) => { (globalThis as any).__toasts.push(w); };',
  );
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { startStarter } from ${JSON.stringify(path.join(root, 'src/renderer/src/state/starterTemplates.ts'))};\n`);
  await build({
    input: entry,
    platform: 'node',
    plugins: [
      {
        name: 'seams',
        resolveId(id, importer) {
          if (importer && importer.includes('starterTemplates') && (id === './actions' || id === './store')) {
            return path.join(work, id === './actions' ? 'actions-stub.ts' : 'store-stub.ts');
          }
          return null;
        },
      },
    ],
    output: { file: path.join(work, 'r.mjs'), format: 'esm' },
    logLevel: 'silent',
  });
  // The main side: the real Vault plus the real view and property readers (Electron's shell stubbed: creating files
  // needs no window).
  const from = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    path.join(work, 'main.ts'),
    [`export { Vault } from ${from('src/main/vault.ts')};`, `export { readView } from ${from('src/shared/views.ts')};`, `export { readProps } from ${from('src/shared/frontmatter.ts')};`].join('\n'),
  );
  await build({ input: path.join(work, 'main.ts'), platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  mkdirSync(path.join(work, 'node_modules', 'electron'), { recursive: true });
  writeFileSync(path.join(work, 'node_modules', 'electron', 'package.json'), '{"name":"electron","type":"module","main":"index.js"}');
  writeFileSync(path.join(work, 'node_modules', 'electron', 'index.js'), 'export const shell = {}; export const app = {}; export default { shell, app };');
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  // A temporary vault, never anyone's real one; the window's file creation writes through the real Vault with the
  // main side's free-name rule («Name», else «Name 1»…).
  vault = path.join(work, 'vault');
  mkdirSync(vault, { recursive: true });
  const v = await M.Vault.open(vault);
  const g = globalThis;
  g.__opened = opened;
  g.__toasts = toasts;
  g.__errors = errors;
  g.__loads = 0;
  g.window = {
    nv: {
      files: {
        create: async (folder, base, ext, content) => {
          let rel = '';
          for (let i = 0; i < 10000 && !rel; i++) {
            const candidate = `${folder ? `${folder}/` : ''}${i === 0 ? base : `${base} ${i}`}${ext}`;
            if (!(await v.any(candidate))) rel = candidate;
          }
          await v.createText(rel, content);
          return rel;
        },
      },
    },
  };
  g.__vault = v;
});
after(() => {
  delete globalThis.window;
  delete globalThis.__vault;
  rmSync(work, { recursive: true, force: true });
});

const disk = (dir = '') => {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(vault, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(at);
      else out.push(at);
    }
  };
  walk(dir);
  return out.sort();
};
const clean = () => {
  opened.length = 0;
  toasts.length = 0;
  errors.length = 0;
  loads = globalThis.__loads;
  globalThis.__loads = 0;
};
const quiet = (words) => {
  assert.equal(errors.length, 0, `${words}: nothing went wrong (${errors.map(String).join('; ')})`);
  assert.ok(globalThis.__loads >= 2, `${words}: the notes and files were read again`);
};

test('starting the CRM makes its notes, records and views in the named folder and opens its deals board', async () => {
  clean();
  await R.startStarter('crm', 'CRM');
  quiet('the CRM');
  const made = disk('CRM');
  assert.equal(made.length, 11, `ten files plus the manifest, in CRM/ (${made.join(', ')})`);
  assert.ok(made.includes('CRM/People/Ava Reed.md'), 'its people');
  assert.ok(made.includes('CRM/Companies/Acme Bakeries.md'), 'its companies');
  assert.ok(made.includes('CRM/Deals/Acme van signs.md'), 'its deals');
  assert.ok(made.includes('CRM/Starter manifest.md'), 'its manifest');
  // Every made note reads, with the records the made views show.
  const propsByPath = new Map();
  for (const rel of made.filter((f) => f.endsWith('.md'))) {
    const props = M.readProps(readFileSync(path.join(vault, rel), 'utf8'));
    assert.ok(props && typeof props === 'object', `${rel} properties read`);
    propsByPath.set(rel, props);
  }
  for (const rel of made.filter((f) => f.endsWith('.view.json'))) {
    const { def, problem } = M.readView(readFileSync(path.join(vault, rel), 'utf8'));
    assert.equal(problem, null, `${rel} opens`);
    const inView = [...propsByPath].filter(([p]) => p === def.source.value || p.startsWith(`${def.source.value}/`));
    assert.ok(inView.length > 0, `${rel} has records under it`);
    for (const prop of [...def.columns, ...def.cardProps, ...(def.groupBy ? [def.groupBy] : [])]) {
      assert.ok(inView.some(([, props]) => props[prop] !== undefined && props[prop] !== null && props[prop] !== ''), `${rel} reads ${prop} from a record`);
    }
  }
  const board = M.readView(readFileSync(path.join(vault, 'CRM/Views/Deals board.view.json'), 'utf8'));
  assert.equal(board.def.layout, 'board');
  assert.equal(board.def.groupBy, 'stage');
  assert.deepEqual(opened, [['CRM/Views/Deals board.view.json', { where: 'tab' }]], 'the deals board opens, beside the page');
  assert.equal(toasts.length, 1, 'the person is told it is made');
});

test('the folder is the person’s, and starting twice never writes over', async () => {
  clean();
  await R.startStarter('crm', '  My Shop  ');
  quiet('a named folder');
  assert.ok(disk('My Shop').length === 11, 'ten files plus the manifest, in the tidied name');
  assert.deepEqual(opened, [['My Shop/Views/Deals board.view.json', { where: 'tab' }]], 'its board opens');
  const first = readFileSync(path.join(vault, 'My Shop/Start here.md'), 'utf8');
  clean();
  await R.startStarter('crm', 'My Shop');
  quiet('starting twice');
  assert.equal(readFileSync(path.join(vault, 'My Shop/Start here.md'), 'utf8'), first, 'the first files are untouched');
  assert.ok(disk('My Shop').includes('My Shop/Start here 1.md'), 'the second run takes free names');
  assert.ok(String(opened[0][0]).startsWith('My Shop/Views/Deals board'), 'and still opens the board it made');
});

test('each of the ten starts and opens the file it made', async () => {
  const ids = ['habits', 'reading', 'content', 'trip', 'client', 'meetings', 'weekly', 'budget', 'recipes'];
  for (const id of ids) {
    clean();
    await R.startStarter(id, `Made ${id}`);
    quiet(id);
    assert.equal(opened.length, 1, `${id} opens one file`);
    assert.ok(String(opened[0][0]).startsWith(`Made ${id}/`), `${id} opens inside its folder`);
    assert.ok(disk(`Made ${id}`).includes(String(opened[0][0])), `${id} opens a file it made`);
    assert.ok(disk(`Made ${id}`).length >= 4, `${id} made its files`);
  }
});
