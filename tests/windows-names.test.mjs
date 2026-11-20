// node --test tests/windows-names.test.mjs — names Windows cannot keep (src/shared/paths.ts cleanFileName, the one
// shared cleaner; src/main/vault-check.ts repair). A note titled "LF meeting." became a folder Windows could only reach
// by a special path. Every place that turns words into a file or folder name goes through the one cleaner, which keeps
// what the person typed as the visible title and makes a name Windows takes: no trailing dots or spaces, no device
// names (CON, PRN, AUX, NUL, COM1-9, LPT1-9), none of < > : " / \ | ? * or control characters, capped in length.
// Windows rules apply whichever computer this runs on. The vault check finds existing bad names and repairs them with
// links and file records kept. Made-up names only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-win-names-'));
let S;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as paths from ${src('src/shared/paths.ts')};`,
      `export * as projectFile from ${src('src/shared/project-file.ts')};`,
      `export * as finance from ${src('src/shared/finance.ts')};`,
      `export * as docFile from ${src('src/shared/doc-file.ts')};`,
      `export * as csv from ${src('src/shared/csv.ts')};`,
      `export * as publications from ${src('src/shared/publications.ts')};`,
      `export * as areas from ${src('src/shared/areas.ts')};`,
      `export * as calendar from ${src('src/shared/calendar.ts')};`,
      `export * as captureFlows from ${src('src/shared/capture-flows.ts')};`,
      `export * as projectHub from ${src('src/shared/project-hub.ts')};`,
      `export * as pairingSource from ${src('src/main/pairing/source.ts')};`,
      `export * as agentFiles from ${src('src/shared/agent-files.ts')};`,
      `export * as starters from ${src('src/shared/starter-templates.ts')};`,
      `export * as officeEdit from ${src('src/main/office-edit.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const entry2 = path.join(work, 'entry2.ts');
  writeFileSync(entry2, [`export { VaultFiles } from ${src('src/main/vault-files.ts')};`, `export { extractLinks } from ${src('src/shared/markdown.ts')};`].join('\n'));
  await build({ input: entry2, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'vc.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'vc.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const clean = (raw, fallback = 'Untitled') => S.paths.cleanFileName(raw, fallback);

test('the one cleaner keeps the visible title and makes a name Windows takes', () => {
  assert.equal(clean('LF meeting.'), 'LF meeting');
  assert.equal(clean('Budget '), 'Budget');
  assert.equal(clean('CON'), 'CON file');
  assert.equal(clean('a: b?'), 'a b');
  assert.equal(clean('Report: Q3 / final.'), 'Report Q3 final');
  assert.equal(clean('CON.txt'), 'CON file.txt');
  assert.equal(clean('com1'), 'com1 file');
  assert.equal(clean('NUL.tar.gz'), 'NUL file.tar.gz');
  assert.equal(clean('lpt9.md'), 'lpt9 file.md');
  assert.equal(clean('CON file'), 'CON file', 'already safe: untouched');
  assert.equal(clean('notes.md'), 'notes.md', 'an ordinary name with dots inside is untouched');
  assert.equal(clean('.env'), '.env', 'a leading dot is a name Windows keeps');
  assert.equal(clean('C# guide'), 'C guide', 'a # would end the link, so it goes');
  assert.equal(clean('a\x07b'), 'a b', 'control characters go');
  assert.equal(clean(''), 'Untitled');
  assert.equal(clean('   '), 'Untitled');
  assert.equal(clean('...'), 'Untitled');
  assert.equal(clean('...', 'Note'), 'Note', 'the caller’s fallback when nothing is left');
  const long = `Planning the winter menu with the team ${'and tasting every soup '.repeat(20)}today`;
  const cut = clean(long);
  assert.ok(cut.length <= 80 && cut.length >= 40, `a very long title is capped, not lost (${cut.length})`);
  assert.ok(!/[. ]$/.test(cut), 'capped, never ending in a dot or a space');
  assert.ok(long.startsWith(cut) && (long.length === cut.length || long[cut.length] === ' '), 'cut at a word, not mid-word');
  for (const raw of ['LF meeting.', 'Budget ', 'CON', 'a: b?', 'CON.txt', long]) assert.equal(clean(clean(raw)), clean(raw), `cleaning twice is the same once (${raw.slice(0, 20)})`);
});

test('the repair check is the Windows rule only, on any computer', () => {
  for (const bad of ['LF meeting.', 'Budget ', 'CON', 'CON.md', 'com1', 'a: b?', 'x"y', 'tab\there']) assert.equal(S.paths.needsWindowsRepair(bad), true, `${JSON.stringify(bad)} needs repair`);
  for (const ok of ['LF meeting', 'CON file', 'notes.md', 'C# guide.pdf', '.env', 'Q^2']) assert.equal(S.paths.needsWindowsRepair(ok), false, `${JSON.stringify(ok)} is a name Windows keeps`);
});

test('every shared name goes through the one cleaner', () => {
  assert.equal(S.projectFile.safeName('CON'), 'CON project');
  assert.equal(S.projectFile.safeName('LF 2027: Elm Sq / Ashgrove?'), 'LF 2027 Elm Sq Ashgrove');
  assert.equal(S.finance.safeFileName('CON'), 'CON file');
  assert.equal(S.finance.safeFileName('.hidden bill'), 'hidden bill', 'no leading dots, as before the shared swap (Nov 2026 review)');
  assert.equal(S.docFile.safeDocName('CON'), 'CON file');
  assert.equal(S.csv.cleanNoteName('  Report: Q3 / final.  '), 'Report Q3 final');
  assert.equal(S.csv.cleanNoteName('CON'), 'CON file');
  assert.equal(S.publications.fileName('CON'), 'CON file');
  assert.equal(S.areas.areaFolderName('CON'), 'CON file');
  assert.equal(S.calendar.meetingNoteFor({ title: 'a: b?', id: 'e1' }, '2026-11-12').title, 'a b 12 Nov 2026');
  assert.equal(S.captureFlows.projectLogPath('CON', 'CON'), 'CON file log.md');
  assert.equal(S.projectHub.closeOutName('a: b?'), 'a b close-out report');
  assert.equal(S.pairingSource.fileSafe('CON'), 'CON file');
  assert.equal(S.agentFiles.safeFileName('CON.txt'), 'CON file.txt');
  assert.throws(() => S.agentFiles.safeSubfolder('CON/Reports'), /can’t be used/, 'an agent’s folder named for a device is refused in words');
  assert.equal(S.agentFiles.safeSubfolder('Reports\\2026'), 'Reports/2026');
  assert.equal(S.starters.cleanStarterFolder('CON/Weekly', 'Recipes'), 'CON file/Weekly');
  assert.ok(!S.starters.cleanStarterFolder('../../evil', 'X').includes('..'), 'a typed folder never climbs out');
  assert.equal(S.officeEdit.safeFileName('CON'), 'CON file');
});

test('the main side cleans through the shared cleaner, and renames refuse device names', () => {
  for (const f of ['src/main/app.ts', 'src/main/assets.ts', 'src/main/office-edit.ts', 'src/main/modules.ts', 'src/main/pairing/source.ts', 'src/shared/project-file.ts', 'src/shared/agent-files.ts', 'src/shared/finance.ts', 'src/shared/doc-file.ts', 'src/shared/csv.ts', 'src/shared/publications.ts', 'src/shared/areas.ts', 'src/shared/calendar.ts', 'src/shared/capture-flows.ts', 'src/shared/project-hub.ts', 'src/shared/starter-templates.ts']) {
    const src = readFileSync(path.join(root, f), 'utf8');
    assert.ok(/from '(\.\.\/)*shared\/paths'|from '\.\/paths'/.test(src), `${f} uses the one shared cleaner`);
  }
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(/cleanRel[\s\S]{0,800}reserved|reserved[\s\S]{0,800}cleanRel/i.test(app), 'a rename to a device name is refused in words');
  const agent = readFileSync(path.join(root, 'src/main/agent.ts'), 'utf8');
  assert.ok(agent.includes('shared/paths') || agent.includes('./office-edit'), 'agent-written notes go through the shared cleaner');
});

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
function makeHost(vault, moves) {
  const abs = (rel) => path.join(vault, ...rel.split('/'));
  const all = () => walk(vault);
  const notes = () =>
    all()
      .filter((f) => f.rel.endsWith('.md'))
      .map((f) => ({ path: f.rel, props: {}, links: M.extractLinks(readFileSync(abs(f.rel), 'utf8')).map((l) => ({ target: l.target })) }));
  return {
    root: () => vault,
    listAll: async () => all(),
    notes,
    resolve: (target, from) => {
      const files = all().map((f) => f.rel);
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      for (const c of [target, dir ? `${dir}/${target}` : target]) if (files.includes(c) || files.includes(`${c}.md`)) return c.endsWith('.md') ? c : `${c}.md`;
      const stem = target.toLowerCase();
      return files.find((f) => f.toLowerCase().endsWith('.md') && (f.toLowerCase() === `${stem}.md` || f.toLowerCase().endsWith(`/${stem}.md`) || f.slice(0, -3).toLowerCase() === stem)) ?? null;
    },
    readNote: async (rel) => readFileSync(abs(rel), 'utf8'),
    writeNote: async (rel, text) => writeFileSync(abs(rel), text),
    // The app's own move (notes, links, records and canvases follow it): here a faithful stand-in over the same disk.
    movePath: async (from, to) => {
      moves.push([from, to]);
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
    dataDir: path.join(work, 'data'),
    readText: async () => '',
    level: () => 'open',
    assistantMay: () => ({ ok: true }),
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true }),
    areaOf: () => undefined,
    areaFilesFolders: () => [],
  };
}

test('the vault check repairs names Windows cannot keep, links and records kept', async () => {
  const base = mkdtempSync(path.join(work, 'case-'));
  const vault = path.join(base, 'Vault');
  write(vault, 'Meetings/LF meeting./plan.md', '# Plan\n');
  write(vault, 'Budget /sheet.md', '# Sheet\n');
  write(vault, 'Notes/CON.md', '# Reserved\n');
  write(vault, 'Notes/Files/a: b.pdf', '%PDF x');
  write(vault, 'Notes/Files/.files.json', JSON.stringify({ version: 1, files: { 'a: b.pdf': { name: 'a: b.pdf', version: 1, versions: [], record: 'Notes/CON.md', size: 6, summary: 'The spec' } } }));
  write(vault, 'Notes/Index.md', 'See [[Meetings/LF meeting./plan]], [[CON]] and [the spec](Files/a: b.pdf).\n');
  const moves = [];
  const vf = new M.VaultFiles(makeHost(vault, moves));
  const look = await vf.check({ repair: false });
  assert.equal(moves.length, 0, 'a look changes nothing');
  assert.ok(look.fixed.length >= 4, look.words);
  const r = await vf.check({ repair: true });
  assert.deepEqual(
    moves.map(([a, b]) => `${a} -> ${b}`).sort(),
    ['Budget  -> Budget', 'Meetings/LF meeting. -> Meetings/LF meeting', 'Notes/CON.md -> Notes/CON file.md', 'Notes/Files/a: b.pdf -> Notes/Files/a b.pdf'].sort(),
    `every bad name repaired through the one cleaner: ${moves.map(([a, b]) => `${a} -> ${b}`).join(', ')}`,
  );
  assert.ok(readFileSync(path.join(vault, 'Meetings/LF meeting/plan.md'), 'utf8').includes('# Plan'), 'the folder’s notes move with it');
  assert.ok(readFileSync(path.join(vault, 'Budget/sheet.md'), 'utf8').includes('# Sheet'), 'a trailing space goes');
  const index = readFileSync(path.join(vault, 'Notes/Index.md'), 'utf8');
  assert.match(index, /\[\[Meetings\/LF meeting\/plan\]\]/, 'a link into a repaired folder follows it');
  assert.match(index, /\[\[CON file\]\]/, 'a link to a repaired note follows it');
  assert.match(index, /\(Files\/a b\.pdf\)/, 'a link to a repaired file follows it');
  const side = JSON.parse(readFileSync(path.join(vault, 'Notes/Files/.files.json'), 'utf8'));
  assert.equal(Object.values(side.files)[0].name, 'a b.pdf', 'the file record keeps its file under the repaired name');
  assert.equal(Object.values(side.files)[0].record, 'Notes/CON file.md', 'the record’s note follows the repaired note');
  assert.equal(Object.values(side.files)[0].summary, 'The spec', 'the record’s words are kept');
  assert.match(r.words, /Windows/, 'said in plain words');
  const again = await vf.check({ repair: true });
  assert.equal(again.fixed.length, 0, `a second check finds nothing more to do: ${again.words}`);
});
