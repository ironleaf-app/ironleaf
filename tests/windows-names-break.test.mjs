// node --test tests/windows-names-break.test.mjs — trying to break the names Windows cannot keep (s1-windows-names:
// shared/paths.ts cleanFileName and needsWindowsRepair, main/vault-check.ts repair about 8 seconds after every vault
// open, main/vault-files.ts, app.ts movePath). Each test works a real vault on disk with the real code first, then
// proves the fix: what is legal on Windows is left alone, machine and private places are never touched, a failed
// folder says so once, twins and over-long paths are said never renamed blind, the person is asked once with the
// files named and told once afterwards in plain words, an approved plan applies on every PC while a declined plan
// never nags, a crash resumes without losing or doubling, file records and reminders and canvas words follow a
// rename, and a hash of every file proves nothing else changed. When unsure, the software leaves things alone and
// says so. Made-up names only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-win-names-break-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as paths from ${src('src/shared/paths.ts')};`,
      `export * as vaultCheck from ${src('src/main/vault-check.ts')};`,
      `export { Vault } from ${src('src/main/vault.ts')};`,
      `export { VaultFiles } from ${src('src/main/vault-files.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Reminders } from ${src('src/main/reminders.ts')};`,
      `export * as markdown from ${src('src/shared/markdown.ts')};`,
      `export * as relationLinks from ${src('src/shared/relation-links.ts')};`,
      `export * as projectCanvas from ${src('src/shared/project-canvas.ts')};`,
      `export * as views from ${src('src/shared/views.ts')};`,
      `export * as sharedReminders from ${src('src/shared/reminders.ts')};`,
    ].join('\n'),
  );
  const electronStub = path.join(work, 'electron-stub.mjs');
  writeFileSync(electronStub, 'export const shell = { trashItem: async () => {}, showItemInFolder: () => {}, openPath: async () => "" };\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml'], plugins: [{ name: 'stub-electron', resolveId: (id) => (id === 'electron' ? electronStub : null) }], output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const writeVault = (dir, files) => {
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
};
/** SHA-256 of every file under a folder (dot folders too), by vault path: nothing may change but what is said. */
const hashAll = (dir, base = '') => {
  const out = new Map();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) for (const [k, v] of hashAll(abs, rel)) out.set(k, v);
    else if (e.isFile()) out.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex'));
  }
  return out;
};

/**
 * The real stack short of the window: a real Vault on the invented vault, a real VaultIndex over its notes and
 * files, and the real VaultFiles.check driving the real checkVault. movePath renames through the real Vault.move;
 * `links` picks what the app's own link-following would do for the move: 'none' rewrites nothing (a crash between
 * the rename and the link updates, or the raw rename), 'standard' rewrites wikilinks and Markdown links in their
 * absolute forms with aliases and headings kept (what app.ts movePath does for those; the cases it misses — canvas
 * words, the record pointer, bell notices — are proved against the real code beside it, not here).
 */
async function realStack(dir, o = {}) {
  const v = await M.Vault.open(dir);
  const index = new M.VaultIndex();
  const moves = [];
  const box = {};
  const refresh = async () => {
    const { files } = await v.listAll();
    for (const f of files.filter((x) => x.rel.toLowerCase().endsWith('.md'))) {
      try {
        index.set(f.rel, await v.read(f.rel), f.mtime, f.size);
      } catch {
        index.delete(f.rel);
      }
    }
    index.setFiles(files.filter((x) => !x.rel.toLowerCase().endsWith('.md')).map((x) => x.rel));
  };
  await refresh();
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const vf = new M.VaultFiles({
    root: () => dir,
    listAll: async () => (await v.listAll()).files.map((f) => ({ rel: f.rel, mtime: f.mtime, size: f.size })),
    notes: () => index.allMeta().map((m) => ({ path: m.path, props: m.props, links: m.links })),
    resolve: (t, from) => index.resolve(t, from) ?? index.resolveFile(t, from),
    readNote: (rel) => v.read(rel),
    writeNote: async (rel, text) => {
      await v.write(rel, text);
      await refresh();
    },
    movePath: async (from, to, updateLinks) => {
      moves.push([from, to]);
      if (o.fail?.(from, to)) throw o.fail(from, to);
      await v.move(from, to);
      // The real file-record following, as the app's own move does (vaultFiles.renamed, errors swallowed there too).
      await box.vf.renamed([[from, to]]).catch(() => {});
      await o.onMoved?.(from, to);
      index.delete(from);
      try {
        if (to.toLowerCase().endsWith('.md')) index.set(to, await v.read(to), Date.now(), 0);
      } catch {}
      await refresh();
      if (updateLinks && o.links === 'standard') {
        // The absolute forms app.ts movePath rewrites (linkTextFor for a note reached by name or path).
        const olds = [from, from.replace(/\.md$/i, ''), from.split('/').pop() ?? from, (from.split('/').pop() ?? from).replace(/\.md$/i, '')];
        const news = [to, to.replace(/\.md$/i, ''), to.split('/').pop() ?? to, (to.split('/').pop() ?? to).replace(/\.md$/i, '')];
        for (const m of index.allMeta()) {
          let text = await v.read(m.path);
          const before = text;
          olds.forEach((old, i) => {
            text = M.markdown.replaceWikilinks(text, (link, raw) =>
              M.markdown.normalizeTarget(link.target) === M.markdown.normalizeTarget(old) ? `[[${news[i]}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]` : raw,
            );
            text = text.split(`(${old})`).join(`(${news[i]})`);
          });
          if (from !== to) {
            text = text.split(`[[${from}/`).join(`[[${to}/`).split(`(${from}/`).join(`(${to}/`);
          }
          if (text !== before) {
            await v.write(m.path, text);
            await refresh();
          }
        }
      }
      return { path: to, linksUpdated: 0 };
    },
    added: async () => {},
    dataDir,
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true }),
    areaOf: () => undefined,
    areaFilesFolders: () => [],
  });
  box.vf = vf;
  return { v, index, vf, moves, dataDir, refresh };
}
const planned = (r) => r.fixed.filter((l) => /so Windows can open it too/.test(l));

test('break: names that are legal on Windows are left alone, however odd they look', async () => {
  const dir = mkdtempSync(path.join(work, 'legal-'));
  writeVault(dir, {
    'Notes/C# guide.md': '# C# guide\n',
    'Notes/Q^2.md': '# Q\n',
    'Notes/party 🎉.md': '# E\n',
    'Notes/notes.md': '# n\n',
    'Notes/CON file.md': '# ok\n',
    'Notes/.env': 'x',
    'Notes/Ünïcödé — dash.md': '# u\n',
    [`Notes/${'L'.repeat(200)}.md`]: '# long but legal\n',
    'Notes/archive.tar.gz': 'x',
    'Notes/v1.2.3.md': '# v\n',
    'Notes/Index.md': 'See [[C# guide]], [[Q^2]] and [[party 🎉]].\n',
  });
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  assert.deepEqual(planned(r), [], `nothing legal is planned: ${r.words}`);
  assert.equal(r.left.filter((l) => /C#|Q\^2|🎉|Ünïcödé|archive|v1\.2\.3/.test(l)).length, 0, 'nothing legal is even named');
});

test('break: machine and private places are never renamed', async () => {
  const dir = mkdtempSync(path.join(work, 'machine-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    '.neuralvault/CON.md': 'x',
    '.neuralvault/plugins/CON.js': 'x',
    '.neuralvault/bin/CON.md': 'x',
    '.hidden dir/CON.md': '# h\n',
    'node_modules/CON.md': 'x',
    'Private notes/CON.md': '# p\n',
    'Sub/.neuralvault/vault.json': '{}',
    'Sub/CON.md': '# s\n',
  });
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  const plan = planned(r);
  assert.equal(plan.length, 1, `only the real note is planned: ${plan.join(' | ')}`);
  assert.match(plan[0], /Notes\/CON\.md/);
  for (const no of ['.neuralvault', 'node_modules', 'Private notes', '.hidden dir', 'Sub/CON']) assert.ok(!plan.some((l) => l.includes(no)), `${no} is never planned`);
});

test('break: a folder holding a git repo is left alone and said, never renamed under version control', async () => {
  const dir = mkdtempSync(path.join(work, 'git-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    'Projects/myapp/.git/HEAD': 'ref: refs/heads/main\n',
    'Projects/myapp/CON.md': '# G\n',
    'Projects/myapp/src/CON..md': '# H\n',
  });
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  const plan = planned(r);
  assert.ok(plan.some((l) => l.includes('Notes/CON.md')), 'the ordinary note is still planned');
  assert.ok(!plan.some((l) => l.includes('myapp')), `nothing under version control is planned: ${plan.join(' | ')}`);
  assert.ok(r.left.some((l) => l.includes('myapp') && /version control|git/i.test(l)), `left alone is said, naming it: ${r.left.join(' | ')}`);
});

test('break: a folder that cannot move says so once, without blaming the notes inside it', async () => {
  const dir = mkdtempSync(path.join(work, 'failfolder-'));
  writeVault(dir, {
    'Notes/Stuck./CON.md': '# One\n',
    'Notes/Stuck./a: b.md': '# Two\n',
    'Notes/Free./three.md': '# Three\n',
  });
  const locked = new Error('That file is locked or not writable, so it couldn’t be moved just now.');
  const { vf, moves } = await realStack(dir, { fail: (from) => (from === 'Notes/Stuck.' ? locked : null) });
  const r = await vf.check({ repair: true });
  assert.ok(r.fixed.some((l) => l.includes('Notes/Free.')), `what can move still moves: ${r.words}`);
  assert.ok(moves.some(([a]) => a === 'Notes/Stuck.'), 'the stuck folder was tried once');
  assert.equal(moves.filter(([a]) => a.startsWith('Notes/Stuck/')).length, 0, 'nothing inside it is tried under a name it was never given');
  assert.equal(r.left.filter((l) => l.includes('Stuck')).length, 1, `said once: ${r.left.join(' | ')}`);
  assert.doesNotMatch(r.left.join('\n'), /no longer there/, 'never the confusing line for files that are still there');
});

test('break: a collision takes a free name, the same on every PC', async () => {
  const dir = mkdtempSync(path.join(work, 'clash-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    'Notes/CON file.md': '# taken\n',
    'Notes/a: b.md': '# A\n',
    'Notes/a b.md': '# taken too\n',
  });
  const first = await realStack(dir);
  const plan1 = planned(await first.vf.check({ repair: false }));
  // Another PC opens the same vault (its own objects, the same disk).
  const second = await realStack(dir);
  const plan2 = planned(await second.vf.check({ repair: false }));
  assert.deepEqual(plan1, plan2, 'the plan is deterministic across PCs, so two PCs never storm');
  assert.ok(plan1.some((l) => l.includes('CON file 2.md')), `a free name, not over the top: ${plan1.join(' | ')}`);
  assert.ok(plan1.some((l) => l.includes('a b 2.md')), `a free name for the file too: ${plan1.join(' | ')}`);
  const r = await first.vf.check({ repair: true });
  assert.equal(r.left.length, 0, `nothing left: ${r.left.join(' | ')}`);
  assert.equal(readFileSync(path.join(dir, 'Notes/CON file 2.md'), 'utf8'), '# R\n', 'the words land under the free name');
  assert.equal(readFileSync(path.join(dir, 'Notes/CON file.md'), 'utf8'), '# taken\n', 'what was there is untouched');
});

test('break: twins that differ only by case, and paths too long for Windows, are said and never renamed blind', async () => {
  const dir = mkdtempSync(path.join(work, 'twins-'));
  const deep = `${Array.from({ length: 8 }, (_, i) => `${'wxyz'[i % 4]}${i}`.repeat(1).padEnd(30, 'q')).join('/')}/deep-note.md`;
  writeVault(dir, {
    'Notes/CasePair.md': '# first\n',
    'Notes/casepair.md': '# second\n',
    [`Notes/${deep}`]: '# deep\n',
    'Notes/Index.md': 'See [[CasePair]].\n',
  });
  const abs = path.join(dir, 'Notes', ...deep.split('/'));
  assert.ok(abs.length > 260, `the invented path is past what Windows opens (${abs.length})`);
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  assert.equal(planned(r).length, 0, `no blind rename: ${planned(r).join(' | ')}`);
  assert.ok(r.left.some((l) => /CasePair/i.test(l) && /case/i.test(l)), `the twins are said: ${r.left.join(' | ')}`);
  assert.ok(r.left.some((l) => l.includes('deep-note.md') && /long/i.test(l)), `the over-long path is said: ${r.left.join(' | ')}`);
  assert.equal(readFileSync(path.join(dir, 'Notes/CasePair.md'), 'utf8'), '# first\n', 'both twins byte for byte');
  assert.equal(readFileSync(path.join(dir, 'Notes/casepair.md'), 'utf8'), '# second\n', 'both twins byte for byte');
});

test('break: a file that cannot move is said in plain words, never an error code', async () => {
  const dir = mkdtempSync(path.join(work, 'locked-'));
  writeVault(dir, { 'Notes/CON.md': '# R\n', 'Notes/a: b.md': '# A\n' });
  const codes = { 'Notes/CON.md': 'EACCES', 'Notes/a: b.md': 'ENAMETOOLONG' };
  const { vf } = await realStack(dir, {
    fail: (from) => {
      const err = new Error(`${codes[from]}: something went wrong`);
      err.code = codes[from];
      return err;
    },
  });
  const r = await vf.check({ repair: true });
  assert.equal(r.left.length, 2, `both said: ${r.left.join(' | ')}`);
  for (const l of r.left) {
    assert.doesNotMatch(l, /EACCES|ENAMETOOLONG|ENOENT|EPERM|EBUSY|Error:/, `plain words: ${l}`);
    assert.match(l, /Notes\//, `naming the file: ${l}`);
  }
});

test('break: symlinks are never followed, renamed, or escaped through', async () => {
  const outside = mkdtempSync(path.join(work, 'outside-'));
  writeFileSync(path.join(outside, 'REAL.md'), '# Real outside\n');
  const dir = mkdtempSync(path.join(work, 'links-'));
  writeVault(dir, { 'Notes/CON.md': '# R\n', 'Notes/ok.md': '# OK\n' });
  symlinkSync(outside, path.join(dir, 'Notes/Link'), 'dir');
  symlinkSync(path.join(dir, 'Notes/CON.md'), path.join(dir, 'Notes/CON link.md'));
  const { vf, v } = await realStack(dir);
  const r = await vf.check({ repair: false });
  assert.ok(!planned(r).some((l) => l.includes('Link')), `nothing through a link is planned: ${planned(r).join(' | ')}`);
  // The move itself refuses both directions through a link.
  await assert.rejects(() => v.move('Notes/Link/REAL.md', 'Notes/REAL.md'), /outside the vault/i, 'an outside file cannot be pulled in');
  await assert.rejects(() => v.move('Notes/ok.md', 'Notes/Link/ok.md'), /outside the vault/i, 'a vault file cannot be pushed out');
  assert.equal(readFileSync(path.join(outside, 'REAL.md'), 'utf8'), '# Real outside\n', 'outside untouched');
  assert.equal(readFileSync(path.join(dir, 'Notes/ok.md'), 'utf8'), '# OK\n', 'inside untouched');
});

test('break: deep paths are found, however far down, files and empty folders alike', async () => {
  const dir = mkdtempSync(path.join(work, 'deep-'));
  const trail = Array.from({ length: 20 }, (_, i) => `d${i}`).join('/');
  writeVault(dir, { [`Notes/${trail}/CON.md`]: '# D\n' });
  mkdirSync(path.join(dir, 'Notes', ...trail.split('/'), 'Empty dir.'), { recursive: true });
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  assert.ok(planned(r).some((l) => l.includes('CON.md')), `the deep file is found: ${planned(r).join(' | ')}`);
  assert.ok(planned(r).some((l) => l.includes('Empty dir.')), `the deep empty folder is found: ${planned(r).join(' | ')}`);
});

test('break: the cleaner never makes a name that needs repair again', () => {
  const corpus = ['CON', 'a: b?', 'x'.repeat(300), '...', '   ', '', 'NUL.tar.gz', 'a/b\\c', '.hidden', 'C# [x]', 'tab\there', 'dot. ', `${'A'.repeat(79)}.`, 'CON. .md', 'lpt9.md', '..', '.', ' aux ', 'file . .txt', '📝.'];
  for (const raw of corpus) {
    for (const max of [80, 180]) {
      const out = M.paths.cleanFileName(raw, 'File', max);
      assert.equal(M.paths.needsWindowsRepair(out), false, `${JSON.stringify(raw)} (max ${max}) -> ${JSON.stringify(out)} is clean`);
      assert.equal(M.paths.cleanFileName(out, 'File', max), out, `${JSON.stringify(out)} is steady`);
    }
  }
});

test('break: the ask names the files, once per plan, in plain words', () => {
  const pairs = [
    ['Notes/CON.md', 'Notes/CON file.md'],
    ['Meetings/LF meeting.', 'Meetings/LF meeting'],
  ];
  const ask = M.vaultCheck.namesAsk(pairs);
  assert.equal(M.vaultCheck.namesAsk([...pairs].reverse()).key, ask.key, 'the same plan asks once whatever the order');
  assert.notEqual(M.vaultCheck.namesAsk([pairs[0]]).key, ask.key, 'a changed plan asks again');
  assert.match(ask.title, /2/, 'how many, in the title');
  assert.match(ask.body, /CON\.md/, 'naming the files');
  assert.match(ask.body, /LF meeting/, 'naming the folders too');
  assert.doesNotMatch(`${ask.title} ${ask.body}`, /DSH|DeepSeek|pi-ai|CON file\.md ->|Error|ENOENT/i, 'plain words, no jargon and no codes');
  assert.doesNotMatch(`${ask.title} ${ask.body}`, /—/, 'no em dashes in new words');
  const done = M.vaultCheck.namesTold(pairs);
  assert.match(done.body, /CON\.md/, 'what was done is said too');
  assert.match(done.title, /2/, 'how many were repaired');
  assert.doesNotMatch(`${done.title} ${done.body}`, /—/, 'no em dashes afterwards either');
  const failed = M.vaultCheck.namesTold([pairs[0]], ['Notes/a: b.md: couldn’t be renamed (it is locked or read-only just now).']);
  assert.match(failed.body, /couldn’t be renamed/, 'what could not is said too');
});

test('break: an approved plan applies on every PC, a declined plan never nags, and a crash resumes', async () => {
  const dir = mkdtempSync(path.join(work, 'receipt-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    'Notes/a: b.md': '# A\n',
    'Notes/Index.md': 'See [[CON]] and [[a: b]].\n',
  });
  const { vf } = await realStack(dir);
  const look = await vf.check({ repair: false });
  const pairs = look.renames;
  assert.equal(pairs.length, 2, `the plan is there to approve: ${look.words}`);
  // Declined: recorded, and the ask never comes again for this plan.
  await M.vaultCheck.namesDecide(dir, pairs, 'declined');
  assert.equal((await M.vaultCheck.namesPending(dir, pairs)).length, 0, 'a declined plan never asks again');
  assert.equal(existsSync(path.join(dir, 'Notes/CON file.md')), false, 'nothing renamed');
  // Approved on this PC: applies here (rename-only moves, as if the window died between renames).
  await M.vaultCheck.namesDecide(dir, pairs, 'approved');
  const locked = new Error('That file is locked or not writable, so it couldn’t be moved just now.');
  const run1 = await realStack(dir, { links: 'none', fail: (from) => (from === 'Notes/a: b.md' ? locked : null), onMoved: (from, to) => M.vaultCheck.namesApplied(dir, [[from, to]]) });
  const r1 = await run1.vf.check({ repair: true });
  assert.ok(r1.fixed.some((l) => l.includes('Notes/CON.md')), `the first rename lands: ${r1.words}`);
  // Another PC (or a restart) resumes: only what is left moves, links to moved notes are brought up to date too.
  const run2 = await realStack(dir, { links: 'none', onMoved: (from, to) => M.vaultCheck.namesApplied(dir, [[from, to]]) });
  const pending = await M.vaultCheck.namesPending(dir, pairs);
  assert.deepEqual(pending, [['Notes/a: b.md', 'Notes/a b.md']], 'only what is left is pending');
  const r2 = await run2.vf.check({ repair: true });
  assert.ok(r2.fixed.some((l) => l.includes('Notes/a: b.md')), `the rest lands: ${r2.words}`);
  const index = readFileSync(path.join(dir, 'Notes/Index.md'), 'utf8');
  assert.match(index, /\[\[CON file\]\]/, 'the stale link to the moved note is brought up to date');
  assert.match(index, /\[\[a b\]\]/, 'the second link too');
  assert.equal((await M.vaultCheck.namesPending(dir, pairs)).length, 0, 'nothing pending once everything landed');
  assert.deepEqual(await M.vaultCheck.namesUndoPairs(dir), [...pairs].reverse(), 'one Undo would put them back newest first');
  // A bad name that appears after the approval waits for its own ask: the approved run repairs only its plan.
  writeFileSync(path.join(dir, 'Notes/NEW?.md'), '# New\n');
  const run3 = await realStack(dir, { links: 'none' });
  await run3.vf.check({ repair: true, plan: pairs, receipt: true });
  assert.equal(existsSync(path.join(dir, 'Notes/NEW?.md')), true, 'the newcomer waits for its own ask');
  const look3 = await run3.vf.check({ repair: false });
  assert.ok(look3.renames.some(([a]) => a === 'Notes/NEW?.md'), 'the newcomer is a new plan');
  assert.notEqual(M.vaultCheck.namesHash(look3.renames), M.vaultCheck.namesHash(pairs), 'a changed plan asks again');
});

test('break: nothing else changed — a hash of every file before and after', async () => {
  const dir = mkdtempSync(path.join(work, 'hash-'));
  writeVault(dir, {
    'Notes/CON.md': '# Reserved\n\nThe plan is [[Index]] and [the spec](Files/a: b.pdf).\n',
    'Notes/Index.md': '---\nproject: CON\n---\n# Index\n\nSee [[CON|the reserved note]], [[CON#Part|part]] and ![[Files/pic.png]].\n',
    'Notes/Files/a: b.pdf': '%PDF invented',
    'Notes/Files/pic.png': 'PNG invented',
    'Notes/Files/.files.json': JSON.stringify({ version: 1, files: { 'a: b.pdf': { name: 'a: b.pdf', version: 1, versions: [], record: 'Notes/CON.md', size: 12, summary: 'The spec' } } }),
    'Notes/Keep.md': '# Keep\n\nUntouched words.\n',
    'Board.canvas': JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Notes/CON.md' }], edges: [] }),
  });
  const before = hashAll(dir);
  const { vf } = await realStack(dir, { links: 'standard' });
  const r = await vf.check({ repair: true });
  assert.equal(r.left.length, 0, `all planned lands: ${r.left.join(' | ')}`);
  const after = hashAll(dir);
  const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
  const gone = [...before.keys()].filter((k) => !after.has(k));
  assert.deepEqual(new Set(gone), new Set(['Notes/CON.md', 'Notes/Files/a: b.pdf']), 'only the renamed sources are gone');
  assert.equal(after.get('Notes/CON file.md'), before.get('Notes/CON.md'), 'the renamed note byte for byte');
  assert.equal(after.get('Notes/Files/a b.pdf'), before.get('Notes/Files/a: b.pdf'), 'the renamed file byte for byte');
  for (const rel of ['Notes/Keep.md', 'Notes/Files/pic.png']) assert.equal(after.get(rel), before.get(rel), `${rel} untouched`);
  assert.ok(changed.includes('Notes/Index.md'), 'the note linking them is brought up to date, and said so');
  const kept = new Set(['Notes/CON.md', 'Notes/Files/a: b.pdf', 'Notes/Index.md', 'Notes/CON file.md', 'Notes/Files/a b.pdf', 'Notes/Files/.files.json', 'Board.canvas', '.neuralvault/name-repairs.json']);
  for (const rel of [...changed, ...gone]) assert.ok(kept.has(rel), `${rel} changed with a reason in the report`);
});

test('break: a file’s record follows its note when the note is renamed', async () => {
  const dir = mkdtempSync(path.join(work, 'record-'));
  writeVault(dir, {
    'Notes/Old name.md': '# Old\n',
    'Notes/Files/spec.pdf': '%PDF invented',
    'Notes/Files/.files.json': JSON.stringify({ version: 1, files: { 'spec.pdf': { name: 'spec.pdf', version: 1, versions: [], record: 'Notes/Old name.md', size: 13, summary: 'The spec' } } }),
  });
  const { vf } = await realStack(dir);
  await vf.renamed([['Notes/Old name.md', 'Notes/New name.md']]);
  const side = JSON.parse(readFileSync(path.join(dir, 'Notes/Files/.files.json'), 'utf8'));
  assert.equal(side.files['spec.pdf'].record, 'Notes/New name.md', 'the record points at the note where it is now');
  assert.equal(side.files['spec.pdf'].summary, 'The spec', 'its words kept');
  // And inside a renamed folder too (the pairs movePairs makes: every file, notes included).
  const { v } = await realStack(dir);
  await v.move('Notes', 'Kept');
  await vf.renamed([
    ['Notes/New name.md', 'Kept/New name.md'],
    ['Notes/Files/spec.pdf', 'Kept/Files/spec.pdf'],
  ]);
  const moved = JSON.parse(readFileSync(path.join(dir, 'Kept/Files/.files.json'), 'utf8'));
  assert.equal(moved.files['spec.pdf'].name, 'spec.pdf', 'the file entry moved with its folder');
  assert.equal(moved.files['spec.pdf'].record, 'Kept/New name.md', 'a folder move carries the pointer too');
});

test('break: reminders and the bell’s notices follow a rename', async () => {
  const dir = mkdtempSync(path.join(work, 'remind-'));
  writeVault(dir, { 'Notes/CON.md': '# Reserved\n\n- [ ] pay the power bill ⏰ 2026-11-06\n' });
  const dataDir = mkdtempSync(path.join(work, 'rdata-'));
  const index = new M.VaultIndex();
  const files = new Map([['Notes/CON.md', readFileSync(path.join(dir, 'Notes/CON.md'), 'utf8')]]);
  index.set('Notes/CON.md', files.get('Notes/CON.md'), Date.now(), 48);
  const shown = [];
  let now = new Date(2026, 10, 5, 12, 0).getTime();
  const rem = new M.Reminders({
    dataDir,
    index,
    library: () => dir,
    read: (rel) => files.get(rel),
    write: async (rel, text) => {
      files.set(rel, text);
      index.set(rel, text, Date.now(), text.length);
    },
    templatesFolder: () => 'Templates',
    show: (n) => shown.push(n),
    changed: () => {},
    now: () => now,
  });
  // Armed one day, fired the next; the bell keeps the notice.
  await rem.check();
  now = new Date(2026, 10, 6, 12, 0).getTime();
  await rem.check();
  const kept = JSON.parse(readFileSync(path.join(dataDir, 'reminders.json'), 'utf8')).notices;
  assert.equal(kept.length, 1, 'one bell notice');
  assert.equal(kept[0].note, 'Notes/CON.md', 'at the note where it was');
  // The note is renamed (as the repair would); the reminder store follows it as every move does.
  files.set('Notes/CON file.md', files.get('Notes/CON.md'));
  files.delete('Notes/CON.md');
  index.delete('Notes/CON.md');
  index.set('Notes/CON file.md', files.get('Notes/CON file.md'), Date.now(), 48);
  rem.renamed('Notes/CON.md', 'Notes/CON file.md');
  const fresh = JSON.parse(readFileSync(path.join(dataDir, 'reminders.json'), 'utf8')).notices;
  assert.equal(fresh[0].note, 'Notes/CON file.md', 'the bell’s notice opens the note where it is now');
  const words = await rem.done(fresh[0].reminder);
  assert.match(words, /Done/, 'ticked from the bell, no “isn’t in your notes”');
  assert.match(files.get('Notes/CON file.md'), /\[x\]/, 'the tick lands in the note where it is now');
  // And it never fires twice for the move.
  const fired = shown.length;
  await rem.check();
  assert.equal(shown.length, fired, 'no second firing for the same reminder');
});

test('break: a board’s words follow a rename, byte for byte everywhere else', () => {
  const board = JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'See [[CON]] and [[CON#Part|part]].' }, { id: 'b', type: 'file', file: 'Notes/CON.md' }], edges: [] });
  const next = M.projectCanvas.relinkBoardText(board, (target) => (M.markdown.normalizeTarget(target) === 'con' ? 'Notes/CON file' : null));
  assert.match(next, /\[\[Notes\/CON file\]\]/, 'the bare link follows');
  assert.match(next, /\[\[Notes\/CON file#Part\|part\]\]/, 'alias and heading kept');
  assert.equal(JSON.parse(next).nodes[1].file, 'Notes/CON.md', 'file cards are the other pass’s business');
  // Everything else byte for byte: only the link targets change.
  const mask = (s) => s.replace(/\[\[[^\]]*\]\]/g, '[[L]]');
  assert.equal(mask(next), mask(board), 'nothing else in the board moves a byte');
  assert.equal(M.projectCanvas.relinkBoardText('not json', () => 'x'), 'not json', 'a damaged board is left alone');
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(app.includes('relinkBoardText'), 'the app’s own move rewrites board words through it');
});

test('break: views over a moved folder follow it, and file moves need nothing', () => {
  const def = M.views.defaultView({ kind: 'folder', value: 'Meetings/LF meeting.' });
  const moved = M.views.followFolder(def, 'Meetings/LF meeting.', 'Meetings/LF meeting');
  assert.equal(moved.source.value, 'Meetings/LF meeting', 'the view shows the folder where it is now');
  assert.equal(M.views.followFolder(def, 'Notes/CON.md', 'Notes/CON file.md'), null, 'a file move touches no view');
  assert.equal(M.views.followFolder(M.views.defaultView({ kind: 'tag', value: 'x' }), 'Meetings/LF meeting.', 'Meetings/LF meeting'), null, 'a tag view is untouched');
});

test('break: frontmatter links follow a rename, brackets or plain titles', () => {
  const index = new M.VaultIndex();
  index.set('Projects/Harbour Cafe..md', '---\ntype: project\n---\n# H\n', 0, 1);
  index.set('Notes/Task.md', '---\nproject: Harbour Cafe.\ntags: []\n---\n# T\n', 0, 1);
  index.set('Notes/Other.md', '---\nproject: "[[Harbour Cafe.]]"\n---\n# O\n', 0, 1);
  const from = 'Projects/Harbour Cafe..md';
  const to = 'Projects/Harbour Cafe.md';
  // The plan the app’s move makes for each note (index.resolveAny over its recorded links).
  const rewriteFor = (source) => {
    const meta = index.get(source);
    const plan = new Map();
    for (const pl of meta.propLinks ?? []) {
      const reached = index.resolveAny(pl.target, source);
      if (reached === from) plan.set(M.markdown.normalizeTarget(pl.target), to);
    }
    return (target) => plan.get(M.markdown.normalizeTarget(target)) ?? null;
  };
  const plain = M.relationLinks.relinkPropsInText('---\nproject: Harbour Cafe.\n---\n# T\n', rewriteFor('Notes/Task.md'));
  assert.match(plain, /Harbour Cafe\.md|Harbour Cafe(?!\.)/, 'the plain title follows');
  assert.doesNotMatch(plain, /Harbour Cafe\.\n/, 'the old title is gone');
  const bracket = M.relationLinks.relinkPropsInText('---\nproject: "[[Harbour Cafe.]]"\n---\n# O\n', rewriteFor('Notes/Other.md'));
  assert.match(bracket, /\[\[Projects\/Harbour Cafe\.md\]\]|\[\[Harbour Cafe\]\]/, 'the bracketed link follows');
});

test('break: wikilinks keep their alias and heading, embeds stay embeds, Markdown links encode', () => {
  const body = 'See [[Old#Part|words]], [[Old]], ![[Old|tall]] and [the file](Files/Old.pdf).\n';
  const wiki = M.markdown.replaceWikilinks(body, (link, raw, embed) =>
    M.markdown.normalizeTarget(link.target) === 'old' ? `${embed ? '!' : ''}[[New${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]` : raw,
  );
  assert.match(wiki, /\[\[New#Part\|words\]\]/, 'alias and heading kept');
  assert.match(wiki, /!\[\[New\|tall\]\]/, 'the embed stays an embed');
  const md = M.markdown.replaceMarkdownLinks(body, (target, fragment, raw, embed, label) =>
    target === 'Files/Old.pdf' ? `${embed ? '!' : ''}[${label}](${M.markdown.encodeLinkPath('Files/New file.pdf')}${fragment})` : raw,
  );
  assert.match(md, /\(Files\/New%20file\.pdf\)/, 'spaces encoded so the link still lands');
  assert.equal(M.markdown.encodeLinkPath('a#b (1).pdf'), 'a%23b%20%281%29.pdf', 'every character that would end the link encoded');
});

test('break: a vault with 5000 files is looked over quickly', async () => {
  const dir = mkdtempSync(path.join(work, 'big-'));
  const files = {};
  for (let i = 0; i < 5000; i++) files[`Notes/f${Math.floor(i / 100)}/note-${i}.md`] = `# Note ${i}\n\nSome words here. See [[note-${(i + 1) % 5000}]].\n`;
  files['Notes/f0/CON.md'] = '# R\n';
  writeVault(dir, files);
  const { vf } = await realStack(dir);
  const t0 = Date.now();
  const r = await vf.check({ repair: false });
  const ms = Date.now() - t0;
  assert.equal(planned(r).length, 1, 'the one bad name is found among thousands');
  assert.ok(ms < 30000, `the look stays quick (${ms} ms)`);
});

test('break: the repair runs twice with nothing more the second time', async () => {
  const dir = mkdtempSync(path.join(work, 'twice-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    'Notes/Index.md': 'See [[CON]].\n',
  });
  const { vf } = await realStack(dir, { links: 'standard' });
  const first = await vf.check({ repair: true });
  assert.ok(first.fixed.length >= 1, `the first run repairs: ${first.words}`);
  const run2 = await realStack(dir, { links: 'standard' });
  const second = await run2.vf.check({ repair: true });
  assert.equal(planned(second).length, 0, `the second run finds nothing: ${second.words}`);
  assert.equal(readFileSync(path.join(dir, 'Notes/CON file.md'), 'utf8'), '# R\n', 'steady afterwards');
});

test('break: a sync’s conflict copies are left alone, and the plan stays deterministic', async () => {
  const dir = mkdtempSync(path.join(work, 'conflict-'));
  writeVault(dir, {
    'Notes/CON.md': '# R\n',
    'Notes/Plan (conflict 2026-11-05).md': '# P\n',
  });
  const { vf } = await realStack(dir);
  const r = await vf.check({ repair: false });
  assert.equal(planned(r).length, 1, `only the bad name is planned: ${planned(r).join(' | ')}`);
  assert.ok(planned(r)[0].includes('Notes/CON.md'), 'the bad name');
  const again = await realStack(dir);
  assert.deepEqual(planned(await again.vf.check({ repair: false })), planned(r), 'the same plan every time');
});

test('break: the app asks once and tells once, never repairs behind the person’s back', () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(app.includes('namesAsk') || app.includes('name-repairs'), 'the vault open asks through the names ask');
  assert.ok(/names-preview|namesPreview/.test(app), 'a preview the window shows');
  assert.ok(/names-repair|namesRepair/.test(app), 'a repair that runs only when the person says so');
  assert.ok(/names-undo|namesUndo/.test(app), 'one Undo puts them back');
  assert.ok(!/check\({ repair: !inPlace/.test(app), 'no silent repair on open any more');
  const bell = readFileSync(path.join(root, 'src/renderer/src/panels/NoticeBell.tsx'), 'utf8');
  assert.ok(bell.includes("'names'") || bell.includes('"names"'), 'the bell opens the names ask');
});
