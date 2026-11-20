// node --test tests/vault-check-thin.test.mjs — v4-no-clutter item 5: the vault check gains one quiet line offering
// a list of notes that hold almost nothing, for the person to look over. It never deletes by itself, and things go
// to the Bin only when they press it. Empty notes stay the weekly tidy's job; fresh notes, templates, projects and
// the Inbox are never offered.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vcheck-thin-'));
let M, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export { checkVault, thinNotice } from ${JSON.stringify(path.join(root, 'src/main/vault-check.ts'))};`, `export { bodyWords, isEmptyNote } from ${JSON.stringify(path.join(root, 'src/shared/weekly-tidy.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'vc.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const all = await import(pathToFileURL(path.join(work, 'vc.mjs')).href);
  M = { checkVault: all.checkVault, thinNotice: all.thinNotice };
  T = { bodyWords: all.bodyWords, isEmptyNote: all.isEmptyNote };
});
after(() => rmSync(work, { recursive: true, force: true }));

const OLD = new Date('2026-09-01T10:00:00');
const write = (dir, rel, data, mtime = OLD) => {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  utimesSync(abs, mtime, mtime);
  return abs;
};
const walk = (dir, base = '') => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push({ rel, mtime: statSync(path.join(dir, e.name)).mtimeMs, size: statSync(path.join(dir, e.name)).size });
  }
  return out;
};
function makeHost(vault) {
  const all = () => walk(vault);
  const notes = () =>
    all()
      .filter((f) => f.rel.endsWith('.md'))
      .map((f) => {
        const text = readFileSync(path.join(vault, ...f.rel.split('/')), 'utf8');
        const folder = /^folder:\s*(.+)$/m.exec(text)?.[1]?.trim();
        const type = /^type:\s*(.+)$/m.exec(text)?.[1]?.trim();
        return { path: f.rel, props: { ...(folder ? { folder } : {}), ...(type ? { type } : {}) } };
      });
  const abs = (rel) => path.join(vault, ...rel.split('/'));
  return {
    root: () => vault,
    listAll: async () => all(),
    notes,
    resolve: () => null,
    readNote: async (rel) => readFileSync(abs(rel), 'utf8'),
    writeNote: async (rel, text) => writeFileSync(abs(rel), text),
    sidecarFolders: async () => [],
    readSidecar: async () => ({ files: {} }),
    changeSidecar: async (_f, fn) => {
      const s = { files: {} };
      await fn(s);
      return s;
    },
  };
}
const FULL = `# The quarter's plan\n\n${'A solid paragraph of real planning words. '.repeat(12)}\n`;

test('almost nothing is counted in words, not Markup', () => {
  assert.equal(T.bodyWords('# Stub\n\nTwo words here.\n'), 4, 'a title and two words');
  assert.equal(T.bodyWords('---\nsource: x\n---\n# Stub\n\nTwo words here.\n'), 4, 'properties are not words');
  assert.equal(T.bodyWords(FULL) > 20, true, 'a real note is not thin');
  assert.equal(T.isEmptyNote('# Only a title\n'), true, 'empty stays empty');
});

test('notes holding more than words are never offered: a task, a reminder or a file (b6 break job)', async () => {
  const v = path.join(work, 'vault-more');
  mkdirSync(v, { recursive: true });
  write(v, 'Notes/Only a task.md', '# Only a task\n\n- [ ] Call the mill back\n');
  write(v, 'Notes/Only a chime.md', '# Only a chime\n\n- [ ] Water the ferns ⏰ 2026-09-01 09:00\n');
  write(v, 'Notes/Lake photo.md', '# Lake photo\n\n![[lake.jpg]]\n\nWakatipu at dawn.\n');
  write(v, 'Notes/Mill number.md', '# Mill number\n\nCall them on 03 456 7890.\n');
  write(v, 'Notes/Damper.md', '# Damper\n\nFlour, water, salt; bake in camp coals.\n');
  const r = await M.checkVault(makeHost(v), { repair: true });
  assert.deepEqual(
    r.thin.map((t) => t.path).sort(),
    ['Notes/Damper.md', 'Notes/Mill number.md'],
    'an open task, a reminder or a file is never almost nothing; a short real note still is',
  );
});

test('the check offers thin notes and touches nothing', async () => {
  const v = path.join(work, 'vault');
  mkdirSync(v, { recursive: true });
  write(v, 'Notes/Old stub.md', '# Old stub\n\nCall the mill back.\n');
  write(v, 'Notes/Full note.md', FULL);
  write(v, 'Notes/Bare.md', '# Bare\n');
  write(v, 'Notes/Fresh stub.md', '# Fresh stub\n\nJust started.\n', new Date());
  write(v, 'Templates/Starter.md', '# Starter\n\nFill me in.\n');
  write(v, 'Projects/Shop/Shop.md', '---\ntype: project\nstatus: active\n---\n# Shop\n');
  write(v, 'Inbox.md', '# Inbox\n\n- [ ] Restock the flour\n');
  const r = await M.checkVault(makeHost(v), { repair: true });
  assert.deepEqual(
    r.thin.map((t) => t.path),
    ['Notes/Old stub.md'],
    'only the settled, non-empty, untyped thin note is offered',
  );
  assert.equal(r.thin[0].words, 6, 'with its word count');
  assert.match(r.words, /1 note holds almost nothing: Old stub\. Nothing was moved/i, 'one quiet line, naming it');
  for (const rel of ['Notes/Old stub.md', 'Notes/Bare.md', 'Notes/Fresh stub.md', 'Templates/Starter.md', 'Projects/Shop/Shop.md', 'Inbox.md']) {
    assert.equal(existsSync(path.join(v, ...rel.split('/'))), true, `${rel} still there: the check never deletes`);
  }
  const notice = M.thinNotice(r.thin);
  assert.equal(notice.kind, 'check', 'a quiet bell line');
  assert.equal(notice.path, 'Notes/Old stub.md', 'opening the first, to look over');
  assert.match(notice.body, /Old stub/, 'offering the list');
  const again = M.thinNotice(r.thin);
  assert.equal(again.key, notice.key, 'the same list keeps its key: said once');
  assert.notEqual(M.thinNotice([...r.thin, { path: 'Notes/Other.md', title: 'Other', words: 3 }]).key, notice.key, 'a changed list says again');
});

test('several thin notes are one line, and the app posts it quietly', () => {
  const thin = [
    { path: 'a.md', title: 'Aye', words: 3 },
    { path: 'b.md', title: 'Bee', words: 4 },
    { path: 'c.md', title: 'Cee', words: 5 },
  ];
  const notice = M.thinNotice(thin);
  assert.match(notice.title, /3 notes hold almost nothing/, 'one line for several');
  assert.match(notice.body, /Aye, Bee and Cee/, 'naming them');
  const app = readFileSync(new URL('../src/main/app.ts', import.meta.url), 'utf8');
  assert.ok(app.includes('thinNotice('), 'the vault’s open check posts the line');
});
