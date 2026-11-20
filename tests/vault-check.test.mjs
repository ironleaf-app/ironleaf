// node --test tests/vault-check.test.mjs — the vault looks after itself (27 Oct 2026; src/main/ vault-check.ts). A real
// breaks, made up again with neutral names: two records of one picture on the PC (one under a name its file doesn't
// have, which said "This isn't in the vault any more"), a picture moved on the PC, a file moved inside the vault with
// its record left behind, a record of a file gone everywhere, and notes linking to PDFs that moved to another folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vcheck-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export { VaultFiles } from ${JSON.stringify(path.join(root, 'src/main/vault-files.ts'))};`, `export { Vault } from ${JSON.stringify(path.join(root, 'src/main/vault.ts'))};`, `export { extractLinks } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`].join('\n'));
  const electronStub = path.join(work, 'electron-stub.mjs');
  writeFileSync(electronStub, 'export const shell = { trashItem: async () => {}, showItemInFolder: () => {}, openPath: async () => "" };\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml'], plugins: [{ name: 'stub-electron', resolveId: (id) => (id === 'electron' ? electronStub : null) }], output: { file: path.join(work, 'vc.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'vc.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const write = (dir, rel, data) => {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
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
        return { path: f.rel, props: folder ? { folder } : {}, links: M.extractLinks(text).map((l) => ({ target: l.target })) };
      });
  // Like the app's index: a path from the vault's top or the note's folder, else a wikilink's name anywhere.
  const resolve = (target, from) => {
    const files = all().map((f) => f.rel);
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    for (const c of [target, dir ? `${dir}/${target}` : target]) if (files.includes(c)) return c;
    return null;
  };
  const writes = [];
  const abs = (rel) => path.join(vault, ...rel.split('/'));
  return {
    writes,
    root: () => vault,
    listAll: async () => all(),
    notes,
    resolve,
    readNote: async (rel) => readFileSync(path.join(vault, ...rel.split('/')), 'utf8'),
    writeNote: async (rel, text) => {
      writes.push(rel);
      writeFileSync(path.join(vault, ...rel.split('/')), text);
    },
    // The app's own move (r2 merge: name repairs go through it, so links, records and canvases follow): here a
    // faithful stand-in over the same disk, renaming and carrying every note's links and file records with it.
    movePath: async (from, to) => {
      mkdirSync(path.dirname(abs(to)), { recursive: true });
      renameSync(abs(from), abs(to));
      const olds = [from, from.replace(/\.md$/i, ''), from.split('/').pop() ?? from, (from.split('/').pop() ?? from).replace(/\.md$/i, '')];
      const news = [to, to.replace(/\.md$/i, ''), to.split('/').pop() ?? to, (to.split('/').pop() ?? to).replace(/\.md$/i, '')];
      for (const n of all().filter((f) => f.rel.endsWith('.md'))) {
        let text = readFileSync(abs(n.rel), 'utf8');
        const dir = n.rel.includes('/') ? n.rel.slice(0, n.rel.lastIndexOf('/')) : '';
        const under = (p) => (dir && p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p);
        olds.forEach((o, i) => {
          text = text.split(`[[${o}]]`).join(`[[${news[i]}]]`).split(`[[${o}|`).join(`[[${news[i]}|`).split(`(${o})`).join(`(${news[i]})`);
          text = text.split(`(${under(o)})`).join(`(${under(news[i])})`);
        });
        // A link into a renamed folder follows it.
        if (from !== to) text = text.split(`[[${from}/`).join(`[[${to}/`).split(`(${from}/`).join(`(${to}/`).split(`(${under(from)}/`).join(`(${under(to)}/`);
        // A link into a renamed folder written from its note's folder follows it too.
        if (from !== to) text = text.split(`[[${under(from)}/`).join(`[[${under(to)}/`);
        writeFileSync(abs(n.rel), text);
      }
      const sides = [];
      const walkSides = (dir, base) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walkSides(path.join(dir, e.name), rel); }
          else if (e.name === '.files.json') sides.push(rel);
        }
      };
      walkSides(vault, '');
      for (const s of sides) {
        const side = JSON.parse(readFileSync(abs(s), 'utf8'));
        for (const e of Object.values(side.files ?? {})) {
          if (typeof e.name === 'string' && (from.endsWith(`/${e.name}`) || from === e.name)) e.name = to.split('/').pop();
          if (typeof e.record === 'string' && (e.record === from || e.record.startsWith(`${from}/`))) e.record = to + e.record.slice(from.length);
        }
        const files = {};
        for (const e of Object.values(side.files ?? {})) files[String(e.name).toLowerCase()] = e;
        side.files = files;
        writeFileSync(abs(s), JSON.stringify(side));
      }
      return { path: to, linksUpdated: 0 };
    },
    added: async () => {},
    dataDir: path.join(work, 'data'),
    readText: async () => '',
    level: () => 'open',
    assistantMay: () => ({ ok: true }),
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true }),
    areaOf: () => undefined,
    areaFilesFolders: () => [],
  };
}

test('a vault’s breaks are put right by themselves, and what has two answers is said', async () => {
  const base = mkdtempSync(path.join(work, 'case-'));
  const vault = path.join(base, 'Vault');
  const pc = path.join(base, 'PC', '12 Store move');
  const photo = write(pc, 'Photos/Store 22 Oct/Register 20 sign-on screen.jpg', Buffer.alloc(1700, 7));
  write(pc, 'Designs/Store photos/assets/register-20.jpg', Buffer.alloc(1700, 7));
  const moving = write(pc, 'Photos/front-counter.jpg', Buffer.alloc(900, 3));
  const project = 'Work/Projects/Store move/Store move.md';
  write(vault, project, `---\ntype: project\nfolder: ${pc}\n---\n# Store move\n\n- Photo: [[Files/register-20.jpg]]\n\n## Documents\n\n- \`Register 20 sign-on screen.jpg — the internal master photo in Photos\`\n- \`Designs/Store photos/assets/register-20.jpg\` — the draft's copy\n- \`Kick-off minutes.docx\` — the first meeting\n- \`${path.join(base, 'PC', 'Other project', 'RECORD.md')}\` — the other project's record\n`);
  write(pc, 'RECORD.md', 'ours');
  write(base, 'PC/Other project/RECORD.md', 'theirs');
  write(vault, 'Me/Budget/Budget.md', '# Budget\n');
  write(vault, 'Me/Budget/Files/old draft.pdf', '%PDF draft');
  write(vault, 'Publications/Times/No. 1.md', '# No. 1\n\n[The paper](Attachments/Times_No1.pdf)\n');
  write(vault, 'Publications/Files/Times_No1.pdf', '%PDF one');
  write(vault, 'Notes/Two answers.md', 'See [it](Attachments/report.pdf).\n');
  write(vault, 'A/report.pdf', '%PDF a');
  write(vault, 'B/report.pdf', '%PDF bb');
  const ref = (name, p, size) => ({ name, version: 1, versions: [], record: project, kind: 'Picture (JPG)', size, added: '2026-10-27T06:22:26.780Z', source: { by: 'the host app', how: 'reference', from: p, at: '2026-10-27T06:22:26.780Z' }, ref: { path: p, size, mtime: 1 } });
  write(
    vault,
    'Work/Projects/Store move/Files/.files.json',
    JSON.stringify({
      version: 1,
      files: {
        'register-20.jpg': { ...ref('register-20.jpg', photo, 1700), summary: 'Internal-only screen' },
        'register 20 sign-on screen.jpg': ref('Register 20 sign-on screen.jpg', photo, 1700),
        'front-counter.jpg': ref('front-counter.jpg', moving, 900),
      },
    }),
  );
  write(vault, 'Me/Budget draft.md', '# Budget draft\n');
  write(vault, 'Me/Budget/Files/.files.json', JSON.stringify({ version: 1, files: { 'budget draft.md': { name: 'Budget draft.md', version: 1, versions: [], record: 'Me/Budget/Budget.md', size: 10 }, 'old draft.pdf': { name: 'old draft.pdf', version: 1, versions: [], record: 'Me/Budget/Budget.md', size: 10 } } }));
  write(vault, 'Publications/Times/Files/.files.json', JSON.stringify({ version: 1, files: { 'times_no1.pdf': { name: 'Times_No1.pdf', version: 1, versions: [], record: 'Publications/Times/No. 1.md', size: 8 } } }));
  // The front-counter picture moves on the PC after it was linked.
  mkdirSync(path.join(pc, 'Photos', 'Store 22 Oct'), { recursive: true });
  renameSync(moving, path.join(pc, 'Photos', 'Store 22 Oct', 'front-counter.jpg'));

  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const look = await vf.check({ repair: false });
  assert.equal(host.writes.length, 0, 'a look changes nothing');
  assert.ok(look.fixed.length >= 5, look.words);

  const r = await vf.check({ repair: true });
  const side = JSON.parse(readFileSync(path.join(vault, 'Work/Projects/Store move/Files/.files.json'), 'utf8'));
  const names = Object.values(side.files).map((e) => e.name).sort();
  assert.deepEqual(names, ['Register 20 sign-on screen.jpg', 'front-counter.jpg'], 'one record per picture, named as its file is (its own capitals)');
  assert.ok(readFileSync(path.join(vault, project), 'utf8').includes(path.join(base, 'PC', 'Other project', 'RECORD.md')), 'a whole path to another project\u2019s file is left as written');
  assert.match(r.words, /Budget draft\.md: it is a note now/, 'a file that became a note loses its old record');
  const kept = Object.values(side.files).find((e) => e.name === 'Register 20 sign-on screen.jpg');
  assert.equal(kept.summary, 'Internal-only screen', 'the folded record’s words are kept');
  // Where a linked file is stays on this PC (src/main/vault-files.ts › LinkedRefs): the vault's file keeps its id only.
  assert.equal(Object.values(side.files).find((e) => e.name === 'front-counter.jpg').ref.path, undefined, 'no path in the vault’s file');
  assert.ok(Object.values(side.files).find((e) => e.name === 'front-counter.jpg').ref.id);
  const seen = await vf.readSidecar('Work/Projects/Store move/Files');
  assert.equal(Object.values(seen.files).find((e) => e.name === 'front-counter.jpg').ref.path, path.join(pc, 'Photos', 'Store 22 Oct', 'front-counter.jpg'), 'a picture moved on the PC is found again in the project’s folder');
  assert.match(readFileSync(path.join(vault, project), 'utf8'), /\[\[Work\/Projects\/Store move\/Files\/Register 20 sign-on screen\.jpg\]\]/, 'a link to the folded record goes to the one kept');
  assert.match(readFileSync(path.join(vault, 'Publications/Times/No. 1.md'), 'utf8'), /\[The paper\]\(Publications\/Files\/Times_No1\.pdf\)/, 'a link to a PDF that moved goes to where it is');
  const times = JSON.parse(readFileSync(path.join(vault, 'Publications/Files/.files.json'), 'utf8'));
  assert.ok(Object.values(times.files).some((e) => e.name === 'Times_No1.pdf'), 'the record follows its file');
  assert.ok(!existsSync(path.join(vault, 'Publications/Times/Files/.files.json')) || !Object.keys(JSON.parse(readFileSync(path.join(vault, 'Publications/Times/Files/.files.json'), 'utf8')).files).length, 'and is gone from where the file was');
  const budget = JSON.parse(readFileSync(path.join(vault, 'Me/Budget/Files/.files.json'), 'utf8'));
  assert.deepEqual(Object.values(budget.files).map((e) => e.name), ['old draft.pdf'], 'a record of a file gone everywhere is taken out; one whose file is there stays');
  assert.match(r.words, /- Notes\/Two answers\.md: its link to Attachments\/report\.pdf could be any of 2 files/, r.words);
  assert.match(readFileSync(path.join(vault, 'Notes/Two answers.md'), 'utf8'), /Attachments\/report\.pdf/, 'two answers: left as it was');
  const note = readFileSync(path.join(vault, project), 'utf8');
  assert.match(note, /- `Photos\/Store 22 Oct\/Register 20 sign-on screen\.jpg` — the internal master photo in Photos/, 'a Documents line names where its file is, its words outside the quotes');
  assert.match(note, /- `Designs\/Store photos\/assets\/register-20\.jpg` — the draft's copy/, 'a line that is right is left as it is');
  assert.match(r.words, /Store move\.md: its Documents list names Kick-off minutes\.docx, which isn’t in the project’s folder or the vault/, r.words);
  const again = await vf.check({ repair: true });
  assert.equal(again.fixed.length, 0, `a second check finds nothing more to do: ${again.words}`);
});

test('a meeting titled with a full stop heals: its folder and note renamed, links fixed, nothing lost (r2)', async () => {
  const base = mkdtempSync(path.join(work, 'dots-'));
  const vault = path.join(base, 'Vault');
  // Linux keeps trailing dots; Windows reaches such a folder only through a \\?\ path, which broke playback.
  const rec = Buffer.alloc(4000, 9);
  write(vault, 'Meetings/LF internal IT meeting..md', '# LF internal IT meeting.\n\nRecording: [[Files/LF internal IT meeting./Recording – LF internal IT meeting. 2026-11-04 10.05.m4a]]\n');
  write(vault, 'Meetings/Files/LF internal IT meeting./Recording – LF internal IT meeting. 2026-11-04 10.05.m4a', rec);
  write(vault, 'Notes/Index.md', 'See [[LF internal IT meeting.]] and [the recording](<Meetings/Files/LF internal IT meeting./Recording – LF internal IT meeting. 2026-11-04 10.05.m4a>).\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const r = await vf.check({ repair: true });
  assert.ok(!existsSync(path.join(vault, 'Meetings', 'Files', 'LF internal IT meeting.')), 'the dotted folder is gone');
  const moved = path.join(vault, 'Meetings', 'Files', 'LF internal IT meeting', 'Recording – LF internal IT meeting. 2026-11-04 10.05.m4a');
  assert.ok(existsSync(moved), 'its recording beside the healed name');
  assert.deepEqual(readFileSync(moved), rec, 'byte for byte');
  assert.ok(!existsSync(path.join(vault, 'Meetings', 'LF internal IT meeting..md')), 'the dotted note is gone');
  assert.ok(existsSync(path.join(vault, 'Meetings', 'LF internal IT meeting.md')), 'renamed beside it');
  assert.ok(!readFileSync(path.join(vault, 'Meetings', 'LF internal IT meeting.md'), 'utf8').includes('meeting./'), 'its recording link fixed');
  const index = readFileSync(path.join(vault, 'Notes', 'Index.md'), 'utf8');
  assert.ok(!index.includes('meeting.]]') && !index.includes('meeting./'), `its links fixed: ${index}`);
  assert.match(r.words, /LF internal IT meeting/, r.words);
  const again = await vf.check({ repair: true });
  assert.equal(again.fixed.length, 0, `it heals once: ${again.words}`);
});

test('the vault itself still opens, lists and renames around dotted names (r2 resolve change)', async () => {
  const vault = mkdtempSync(path.join(work, 'vopen-'));
  write(vault, 'Meetings/Note.md', '# Note\n');
  write(vault, 'Meetings/Files/Old name./clip.m4a', Buffer.alloc(100, 5));
  const v = await M.Vault.open(vault);
  const all = await v.listAll();
  assert.ok(all.files.some((f) => f.rel === 'Meetings/Files/Old name./clip.m4a'), 'listed as named');
  assert.equal(await v.any('Meetings/Files/Old name.'), true);
  assert.equal(await v.isFolder('Meetings/Files/Old name.'), true);
  await v.move('Meetings/Files/Old name.', 'Meetings/Files/Old name');
  assert.equal(await v.any('Meetings/Files/Old name/clip.m4a'), true);
  assert.equal(v.toRel(v.absolute('Meetings/Note.md')), 'Meetings/Note.md', 'absolute and back');
  assert.equal(await v.read('Meetings/Note.md'), '# Note\n', 'notes still read');
});
