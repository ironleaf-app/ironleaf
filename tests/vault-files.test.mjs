// node --test tests/vault-files.test.mjs — files done properly (Wave 4 part c, 24 Oct 2026; src/shared/file-records.ts,
// src/main/vault-files.ts). Files live with their record (a Files folder beside the note), each with a small record of
// what it is for, what it is, where it came from and its versions; the move of a flat Attachments folder into place
// (every file and link kept, a safety copy first, Undo); a new version keeps the one before and links reach the latest;
// "what is this" read from the file itself; big imports carry on after a break; a file on the PC linked where it is.
// Neutral made-up fixtures only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zip } from '../tools/office-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vfiles-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/shared/file-records.ts'))};`,
      `export { VaultFiles, cleanName, sha256Of } from ${JSON.stringify(path.join(root, 'src/main/vault-files.ts'))};`,
      `export { readFileText } from ${JSON.stringify(path.join(root, 'src/main/doc-text.ts'))};`,
      `export { extractLinks, replaceWikilinks, replaceMarkdownLinks, normalizeTarget } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`,
      `export { decide, emptyStore } from ${JSON.stringify(path.join(root, 'src/shared/sensitivity.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'vf.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'vf.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── A made-up vault on disk, and a host that behaves like the app's (its own small link resolver and move) ──

function write(dir, rel, data) {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}
function walk(dir, base = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else {
      const st = statSync(path.join(dir, e.name));
      out.push({ rel, mtime: st.mtimeMs, size: st.size });
    }
  }
  return out;
}

function makeHost(vault, given = {}) {
  const { prefs: prefsGiven, ...extra } = given;
  const prefs = { attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true, ...(prefsGiven ?? {}) };
  const all = () => walk(vault);
  const notes = () =>
    all()
      .filter((f) => f.rel.endsWith('.md'))
      .map((f) => {
        const text = readFileSync(path.join(vault, ...f.rel.split('/')), 'utf8');
        const type = /^---[\s\S]*?\ntype:\s*(\w+)[\s\S]*?---/.exec(text)?.[1];
        return { path: f.rel, props: type ? { type } : {}, links: M.extractLinks(text).map((l) => ({ target: l.target })) };
      });
  const resolve = (target, from) => {
    const t = decodeURI(target).replace(/^\.\//, '');
    const files = all().map((f) => f.rel);
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    for (const c of [t, `${t}.md`, dir ? `${dir}/${t}` : t, dir ? `${dir}/${t}.md` : `${t}.md`]) if (files.includes(c)) return c;
    const base = t.split('/').pop();
    const hit = files.filter((f) => f.split('/').pop() === base || f.split('/').pop() === `${base}.md`).sort((a, b) => a.length - b.length)[0];
    return hit ?? null;
  };
  const moves = [];
  const host = {
    root: () => vault,
    listAll: async () => all(),
    notes,
    resolve,
    readNote: async (rel) => readFileSync(path.join(vault, ...rel.split('/')), 'utf8'),
    movePath: async (from, to) => {
      // Like the app: every link that reaches it rewritten to its new path.
      const before = notes().map((n) => ({ n, reached: n.links.map((l) => ({ l, r: resolve(l.target, n.path) })) }));
      mkdirSync(path.dirname(path.join(vault, ...to.split('/'))), { recursive: true });
      const { renameSync } = await import('node:fs');
      renameSync(path.join(vault, ...from.split('/')), path.join(vault, ...to.split('/')));
      let linksUpdated = 0;
      for (const { n, reached } of before) {
        const want = new Map(reached.filter((x) => x.r === from).map((x) => [M.normalizeTarget(x.l.target), to]));
        if (!want.size) continue;
        const abs = path.join(vault, ...n.path.split('/'));
        let text = readFileSync(abs, 'utf8');
        text = M.replaceWikilinks(text, (link, raw, embed) => {
          const p = want.get(M.normalizeTarget(link.target));
          if (!p) return raw;
          linksUpdated++;
          return `${embed ? '!' : ''}[[${p}${link.alias ? `|${link.alias}` : ''}]]`;
        });
        text = M.replaceMarkdownLinks(text, (target, _f, raw, embed, label) => {
          const p = want.get(M.normalizeTarget(decodeURI(target)));
          if (!p) return raw;
          linksUpdated++;
          return `${embed ? '!' : ''}[${label}](${encodeURI(p)})`;
        });
        writeFileSync(abs, text);
      }
      moves.push([from, to]);
      return { path: to, linksUpdated };
    },
    added: async () => {},
    writeNote: async (rel, text) => writeFileSync(path.join(vault, ...rel.split('/')), text),
    dataDir: path.join(vault, '..', `${path.basename(vault)}-data`),
    readText: (abs, ext, size) => M.readFileText(abs, ext, size, { pdf: null }),
    prefs: () => prefs,
    setFilesWithRecord: async (on) => {
      prefs.filesWithRecord = on;
    },
    writeZip: async (dest, sources) => {
      writeFileSync(dest, JSON.stringify(sources.map((s) => s.name)));
    },
    level: () => 'open',
    ...extra,
  };
  host.moves = moves;
  return host;
}

let n = 0;
const freshVault = () => {
  const dir = path.join(work, `vault-${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// ── Where files go ──

test('a file goes in a Files folder beside its record: in the note’s own folder, or its own folder in Files', () => {
  assert.equal(M.filesFolderFor('Projects/Harbour Lane/Harbour Lane.md'), 'Projects/Harbour Lane/Files');
  assert.equal(M.filesFolderFor('Meetings/2026-10-23 Fit-out walk.md'), 'Meetings/Files/2026-10-23 Fit-out walk');
  assert.equal(M.filesFolderFor('People/Sam Lee.md'), 'People/Files/Sam Lee');
  assert.equal(M.filesFolderFor('Ideas.md'), 'Files/Ideas');
  assert.equal(M.filesFolderOf('Projects/Harbour Lane/Files/Reports/a.pdf'), 'Projects/Harbour Lane/Files');
  assert.equal(M.filesFolderOf('Projects/Harbour Lane/a.pdf'), null);
  assert.deepEqual(M.recordCandidates('Meetings/Files/2026-10-23 Fit-out walk/a.pdf').slice(0, 1), ['Meetings/2026-10-23 Fit-out walk.md']);
  assert.equal(M.recordCandidates('Projects/Harbour Lane/Files/a.pdf').includes('Projects/Harbour Lane/Harbour Lane.md'), true);
});

test('a note titled with a full stop still gets a folder Windows can open (r2 meeting: “LF internal IT meeting.”)', () => {
  assert.equal(M.filesFolderFor('Meetings/LF internal IT meeting..md'), 'Meetings/Files/LF internal IT meeting');
  assert.equal(M.filesFolderFor('Meetings/LF internal IT meeting.md'), 'Meetings/Files/LF internal IT meeting');
  assert.equal(M.filesFolderFor('Ideas/Weekly sync .md'), 'Ideas/Files/Weekly sync', 'a trailing space too');
  assert.equal(M.ownsFolder('Projects/Harbour Lane./Harbour Lane.md'), true, 'the same name with a dot still owns its folder');
});

test('a dropped file lands beside its note with its record: source, record, kind, size and what it says', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n# Harbour Lane\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const src = path.join(work, 'notes-src.txt');
  writeFileSync(src, 'Fit-out walk notes\n\nThe crew starts on the shopfront on Monday and the signage arrives on Wednesday.\n');
  const placed = await vf.place({ record: 'Projects/Harbour Lane/Harbour Lane.md', src, name: 'Walk notes.txt', source: { by: 'you', how: 'dropped', at: '2026-10-24T01:00:00.000Z' } });
  assert.equal(placed.rel, 'Projects/Harbour Lane/Files/Walk notes.txt');
  assert.equal(existsSync(src), true, 'a copy: the file on the PC stays');
  const side = JSON.parse(readFileSync(path.join(vault, 'Projects/Harbour Lane/Files/.files.json'), 'utf8'));
  const e = side.files['Walk notes.txt'];
  assert.equal(e.record, 'Projects/Harbour Lane/Harbour Lane.md');
  assert.equal(e.source.how, 'dropped');
  assert.equal(e.kind, 'Text');
  assert.equal(e.title, 'Fit-out walk notes');
  assert.match(e.summary, /crew starts on the shopfront on Monday/);
  assert.equal(e.version, 1);
  // The same name again without asking for a version: kept as its own file.
  const again = await vf.place({ record: 'Projects/Harbour Lane/Harbour Lane.md', src, name: 'Walk notes.txt', source: { by: 'you', how: 'dropped', at: '2026-10-24T02:00:00.000Z' } });
  assert.equal(again.rel, 'Projects/Harbour Lane/Files/Walk notes (2).txt');
  assert.equal(again.renamed, true);
  // The catalogue lists both, with their record and purpose.
  const cat = await vf.catalogue();
  const item = cat.find((c) => c.path === placed.rel);
  assert.equal(item.record, 'Projects/Harbour Lane/Harbour Lane.md');
  assert.equal(item.withRecord, true);
  assert.equal(item.sourceWords, 'Dropped in by you, 24 Oct 2026');
  assert.throws(() => M.cleanName('setup.exe'), /runs when it is opened/);
});

test('Settings › Files and links: one folder for everything still works when the person wants it', () => {
  const vault = freshVault();
  const host = makeHost(vault, { prefs: { attachmentsFolder: 'Attachments', filesWithRecord: false } });
  const vf = new M.VaultFiles(host);
  assert.equal(vf.folderFor('Meetings/Kick-off.md'), 'Attachments');
  const host2 = makeHost(vault);
  assert.equal(new M.VaultFiles(host2).folderFor('Meetings/Kick-off.md'), 'Meetings/Files/Kick-off');
});

// ── Versions ──

test('a new version keeps the one before as v1 (superseded); links reach the latest; restore brings one back, nothing lost', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n[[Projects/Harbour Lane/Files/Quote.txt|the quote]]\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const v1 = path.join(work, 'quote-v1.txt');
  writeFileSync(v1, 'Quote for the shopfront.\nTotal: 12,000\n');
  const placed = await vf.place({ record: 'Projects/Harbour Lane/Harbour Lane.md', src: v1, name: 'Quote.txt', source: { by: 'Chief', how: 'agent', at: '2026-10-20T00:00:00.000Z' } });
  const rel = placed.rel;
  const v2 = path.join(work, 'quote-v2.txt');
  writeFileSync(v2, 'Quote for the shopfront.\nTotal: 13,500\nIncludes after-hours work.\n');
  const e = await vf.addVersion(rel, v2, { source: { by: 'you', how: 'version', at: '2026-10-22T00:00:00.000Z' } });
  assert.equal(e.version, 2);
  assert.equal(readFileSync(path.join(vault, rel), 'utf8'), readFileSync(v2, 'utf8'), 'the link’s path holds the latest');
  const kept = path.join(vault, 'Projects/Harbour Lane/Files/.versions/Quote (v1).txt');
  assert.equal(readFileSync(kept, 'utf8'), readFileSync(v1, 'utf8'), 'v1 kept in .versions');
  assert.equal(e.versions[0].n, 1);
  assert.equal(e.versions[0].source.by, 'Chief', 'v1 keeps who sent it');
  // .versions is out of every list (the vault leaves dot folders out).
  assert.equal(walk(vault).some((f) => f.rel.includes('.versions')), false);
  const rows = await vf.versions(rel);
  assert.deepEqual(rows.map((r) => [r.n, r.latest]), [[2, true], [1, false]]);
  // Compare: what changed in the words.
  const c = await vf.compare(rel, 1, 2);
  assert.equal(c.same, false);
  assert.ok(c.rows.some((r) => r.kind === 'del' && /12,000/.test(r.text)));
  assert.ok(c.rows.some((r) => r.kind === 'add' && /13,500/.test(r.text)));
  // Restore v1: it becomes v3; v2 is kept; v1 stays in the history too.
  const r = await vf.restore(rel, 1);
  assert.equal(r.version, 3);
  assert.equal(readFileSync(path.join(vault, rel), 'utf8'), readFileSync(v1, 'utf8'));
  assert.deepEqual(r.versions.map((v) => v.n), [2, 1]);
  assert.equal(readFileSync(path.join(vault, 'Projects/Harbour Lane/Files/.versions/Quote (v2).txt'), 'utf8'), readFileSync(v2, 'utf8'));
  assert.equal(r.source.how, 'restored');
  // Dropping a file of the same name, asked as a new version.
  const v4 = path.join(work, 'quote-v4.txt');
  writeFileSync(v4, 'Quote, final.\n');
  const p4 = await vf.place({ record: 'Projects/Harbour Lane/Harbour Lane.md', src: v4, name: 'Quote.txt', same: 'version', source: { by: 'you', how: 'added', at: '2026-10-23T00:00:00.000Z' } });
  assert.equal(p4.rel, rel);
  assert.equal(p4.version, 4);
});

test('files named by version side by side are one family: the older superseded by the newest, each kind apart', () => {
  const fam = M.namedFamilies(['Plan_v1.pdf', 'Plan_v2.pdf', 'Plan_v2.docx', 'Plan_v3.docx', 'Other.pdf', 'Notes v2.txt']);
  assert.equal(fam.get('Plan_v1.pdf'), 'Plan_v2.pdf');
  assert.equal(fam.get('Plan_v2.docx'), 'Plan_v3.docx');
  assert.equal(fam.has('Plan_v2.pdf'), false);
  assert.equal(fam.has('Notes v2.txt'), false, 'one file alone is no family');
  assert.equal(M.familyKey('Brief v2 (2026-10-21).pdf'), M.familyKey('Brief v1 (2026-10-19).pdf') === M.familyKey('Brief v2 (2026-10-21).pdf') ? M.familyKey('Brief v1 (2026-10-19).pdf') : M.familyKey('Brief v2 (2026-10-21).pdf'));
  assert.equal(M.versionInName('Report_v12.pdf'), 12);
  assert.equal(M.versionInName('Report.pdf'), null);
});

// ── What is this ──

test('what is this: a Word document’s title and pages, a workbook’s sheets, a PDF’s pages and title', async () => {
  const vault = freshVault();
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Shopfront brief</w:t></w:r></w:p><w:p><w:r><w:t>The new shopfront opens onto the laneway, with a timber frame and a bench for waiting customers.</w:t></w:r></w:p></w:body></w:document>`,
    'docProps/core.xml': '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Harbour Lane shopfront brief</dc:title></cp:coreProperties>',
    'docProps/app.xml': '<?xml version="1.0"?><Properties><Pages>3</Pages></Properties>',
  });
  const d = path.join(work, 'brief.docx');
  writeFileSync(d, docx);
  const m1 = await vf.whatIsThis(d, 'brief.docx', docx.length);
  assert.equal(m1.kind, 'Word document');
  assert.equal(m1.title, 'Harbour Lane shopfront brief');
  assert.equal(m1.pages, 3);
  assert.match(m1.summary, /opens onto the laneway/);
  const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const xlsx = zip({
    'xl/workbook.xml': `<?xml version="1.0"?><workbook ${X}><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Rooms" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet ${X}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Site</t></is></c><c r="B1" t="inlineStr"><is><t>Rooms</t></is></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet ${X}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Room</t></is></c></row></sheetData></worksheet>`,
  });
  const x = path.join(work, 'Rooms_Review_v2.xlsx');
  writeFileSync(x, xlsx);
  const m2 = await vf.whatIsThis(x, 'Rooms_Review_v2.xlsx', xlsx.length);
  assert.equal(m2.kind, 'Excel workbook');
  assert.equal(m2.pages, 2);
  assert.equal(m2.pagesWord, 'sheets');
  assert.match(m2.summary, /2 sheets: Summary, Rooms\. First row: Site, Rooms/);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n6 0 obj << /Title (Fit-out schedule) >> endobj\ntrailer << /Root 1 0 R /Info 6 0 R >>\n%%EOF\n', 'latin1');
  const p = path.join(work, 'schedule.pdf');
  writeFileSync(p, pdf);
  const m3 = await vf.whatIsThis(p, 'schedule.pdf', pdf.length);
  assert.equal(m3.pages, 3);
  assert.equal(m3.title, 'Fit-out schedule');
  assert.equal(M.whatWords({ name: 'schedule.pdf', pages: 3, size: 1258291 }), 'PDF, 3 pages, 1.2 MB');
  assert.equal(M.purposeOf('Harbour_Quote_v2.pdf'), 'Quotes and pricing');
  assert.equal(M.titleFromName('Tessaly_Survey_Review_2026-10-22.xlsx'), 'Tessaly Survey Review 2026-10-22');
});

test('the assistant summarises only what it may read; a Health file is refused in words, never sent', async () => {
  const vault = freshVault();
  write(vault, 'Health/Files/Results/Bloods.txt', 'Cholesterol results from the clinic.\n');
  let asked = 0;
  const host = makeHost(vault, {
    assistantMay: (rel) => (rel.startsWith('Health/') ? { ok: false, why: 'That is marked Health and the side chat isn’t allowed Health items.' } : { ok: true }),
    askJson: async () => {
      asked++;
      return { summary: 'A note.' };
    },
  });
  const vf = new M.VaultFiles(host);
  await assert.rejects(() => vf.summarise('Health/Files/Results/Bloods.txt'), /marked Health/);
  assert.equal(asked, 0, 'nothing was sent to the assistant');
  write(vault, 'Projects/Harbour Lane/Files/Plan.txt', 'Plan for the opening week, with the roster and the stock order.\n');
  const info = await vf.summarise('Projects/Harbour Lane/Files/Plan.txt');
  assert.equal(info.summary, 'A note.');
  assert.equal(info.summaryBy, 'assistant');
  assert.equal(asked, 1);
});

// ── Big imports ──

test('a big import goes in 8 MB pieces, stops part-way, and carries on from where it stopped (also after a restart)', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n');
  const progress = [];
  let host = makeHost(vault, { progress: (s) => progress.push({ ...s }) });
  let vf = new M.VaultFiles(host);
  const src = path.join(work, 'survey.bin');
  const size = 8 * 1024 * 1024 * 3 + 12345;
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4096) buf[i] = (i / 4096) % 251;
  writeFileSync(src, buf);
  // Stop after the first piece (a break), as a restart would.
  const started = await vf.importPath({ record: 'Projects/Harbour Lane/Harbour Lane.md', src });
  const stopAfter = () => new Promise((r) => {
    const t = setInterval(() => {
      const s = progress.at(-1);
      if (s && s.received >= 8 * 1024 * 1024) {
        clearInterval(t);
        r();
      }
    }, 2);
  });
  await stopAfter();
  await vf.importStop(started.id, false);
  await new Promise((r) => setTimeout(r, 50));
  const paused = (await vf.importList()).find((i) => i.id === started.id);
  assert.ok(paused && paused.received < size, 'part-way');
  // A restart: a new service reads the import back and carries on by itself.
  host = makeHost(vault, { progress: (s) => progress.push({ ...s }) });
  vf = new M.VaultFiles(host);
  const list = await vf.importList();
  const back = list.find((i) => i.id === started.id);
  assert.ok(back, 'the import is still there after the restart');
  assert.ok(back.received >= 8 * 1024 * 1024, 'what arrived is kept');
  await vf.resumeAll();
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      const s = progress.at(-1);
      if (s?.state === 'done') {
        clearInterval(t);
        resolve();
      } else if (s?.state === 'failed' || Date.now() - t0 > 20000) {
        clearInterval(t);
        reject(new Error(s?.problem ?? 'timed out'));
      }
    }, 5);
  });
  const done = progress.at(-1);
  assert.equal(done.rel, 'Projects/Harbour Lane/Files/survey.bin');
  assert.equal(sha(readFileSync(path.join(vault, done.rel))), sha(buf), 'every byte, checked against the file on the PC');
  assert.equal((await vf.importList()).length, 0);
  // Pieces from the window: begin, pieces at their offsets (one sent twice), the last finishes.
  const small = Buffer.from('x'.repeat(100));
  const b = await vf.importBegin({ record: 'Projects/Harbour Lane/Harbour Lane.md', name: 'piece.txt', size: small.length });
  await vf.importPiece(b.id, 0, small.subarray(0, 60));
  await vf.importPiece(b.id, 0, small.subarray(0, 60));
  await assert.rejects(() => vf.importPiece(b.id, 80, small.subarray(80)), /starts at byte 60/);
  const fin = await vf.importPiece(b.id, 60, small.subarray(60));
  assert.equal(fin.state, 'done');
  assert.equal(readFileSync(path.join(vault, fin.rel), 'utf8'), small.toString());
});

// ── Linked where it is ──

test('a file on the PC linked where it is: nothing copied, its record says where it is and what it is', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const outside = path.join(work, 'Big survey.txt');
  writeFileSync(outside, 'Survey of the rooms, with photos of each.\n');
  const r = await vf.reference({ record: 'Projects/Harbour Lane/Harbour Lane.md', path: outside, by: 'Chief', what: 'The survey with the room photos' });
  assert.equal(r.folder, 'Projects/Harbour Lane/Files');
  assert.equal(existsSync(path.join(vault, 'Projects/Harbour Lane/Files/Big survey.txt')), false, 'not copied');
  const cat = await vf.catalogue();
  const item = cat.find((c) => c.ref);
  assert.equal(item.ref.path, outside);
  assert.equal(item.ref.missing, false);
  assert.equal(item.summary, 'The survey with the room photos');
  assert.match(item.sourceWords, /Linked by Chief where it is on this PC/);
  assert.equal(await vf.referencePath(r.folder, r.name), outside);
  await assert.rejects(() => vf.reference({ record: 'Projects/Harbour Lane/Harbour Lane.md', path: 'relative.txt' }), /whole path/);
  await vf.forgetReference(r.folder, r.name);
  assert.equal((await vf.catalogue()).some((c) => c.ref), false);
});

// ── Moves ──

test('a file moved by the app takes its record and older versions with it', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n');
  write(vault, 'Meetings/Walk.md', '# Walk\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const a = path.join(work, 'a1.txt');
  writeFileSync(a, 'one');
  const p = await vf.place({ record: 'Projects/Harbour Lane/Harbour Lane.md', src: a, name: 'Draft.txt', source: { by: 'you', how: 'added', at: '2026-10-24T00:00:00.000Z' } });
  const b = path.join(work, 'a2.txt');
  writeFileSync(b, 'two');
  await vf.addVersion(p.rel, b, { source: { by: 'you', how: 'version', at: '2026-10-24T01:00:00.000Z' } });
  const to = 'Meetings/Files/Walk/Draft.txt';
  await host.movePath(p.rel, to);
  await vf.renamed([[p.rel, to]]);
  const e = await vf.entry(to);
  assert.equal(e.version, 2);
  assert.equal(readFileSync(path.join(vault, 'Meetings/Files/Walk/.versions/Draft (v1).txt'), 'utf8'), 'one');
  assert.equal(await vf.entry(p.rel), undefined);
});

// ── The move of a flat Attachments folder into place ──

test('the plan: each attachment goes beside the note it belongs with; a project beats a document that also lists it', () => {
  const notes = [
    { path: 'Projects/Harbour Lane/Harbour Lane.md', props: { type: 'project' }, links: [{ target: 'Attachments/Quote_v2.pdf', reached: 'Attachments/Quote_v2.pdf' }] },
    { path: 'Docs/Weekly Update.md', props: {}, links: [{ target: 'Attachments/Quote_v2.pdf', reached: 'Attachments/Quote_v2.pdf' }], text: 'See Floorplan.png for the layout.' },
    { path: 'Projects/Harbour Lane/Notes/Site walk.md', props: {}, links: [{ target: 'walk.jpg', reached: 'Attachments/walk.jpg' }] },
    { path: 'Meetings/2026-10-23 Kick-off.md', props: { type: 'meeting' }, links: [{ target: 'Attachments/Agenda.docx', reached: 'Attachments/Agenda.docx' }] },
    { path: 'People/Sam Lee.md', props: {}, links: [{ target: 'Attachments/Sam CV.pdf', reached: 'Attachments/Sam CV.pdf' }] },
    { path: 'Publications/The Lane Gazette.md', props: {}, links: [] },
    { path: 'Meetings/Site walk.md', props: {}, links: [] },
    { path: 'Docs/Site walk 2026-10-22 plan.md', props: {}, links: [] },
    { path: 'Templates/Meeting.md', props: {}, links: [{ target: 'Attachments/Agenda.docx', reached: 'Attachments/Agenda.docx' }] },
  ];
  const files = ['Attachments/Quote_v2.pdf', 'Attachments/walk.jpg', 'Attachments/Agenda.docx', 'Attachments/Sam CV.pdf', 'Attachments/Floorplan.png', 'Attachments/Lane_Gazette_No1.pdf', 'Attachments/stray.bin', 'Attachments/Recording – Site walk 2026-10-22 05.02.m4a', 'Attachments/Budget 2026-10-22.xlsx', 'Assets/logo.png'].map((p) => ({ path: p, size: 10 }));
  const plan = M.planFileMigration({ notes, files, attachmentsFolder: 'Attachments', templatesFolder: 'Templates', projects: ['Projects/Harbour Lane/Harbour Lane.md'] });
  const to = Object.fromEntries(plan.map((p) => [p.from, p.to ?? null]));
  assert.equal(to['Attachments/Quote_v2.pdf'], 'Projects/Harbour Lane/Files/Quote_v2.pdf', 'the project wins over the update listing it');
  assert.equal(to['Attachments/walk.jpg'], 'Projects/Harbour Lane/Files/walk.jpg', 'a project’s note: the project’s Files');
  assert.equal(to['Attachments/Agenda.docx'], 'Meetings/Files/2026-10-23 Kick-off/Agenda.docx', 'templates don’t count');
  assert.equal(to['Attachments/Sam CV.pdf'], 'People/Files/Sam Lee/Sam CV.pdf');
  assert.equal(to['Attachments/Floorplan.png'], 'Docs/Files/Weekly Update/Floorplan.png', 'named in words');
  assert.equal(plan.find((p) => p.from === 'Attachments/Floorplan.png').sure, 'named');
  assert.equal(to['Attachments/Lane_Gazette_No1.pdf'], 'Publications/Files/The Lane Gazette/Lane_Gazette_No1.pdf', 'a guess by its name');
  assert.equal(plan.find((p) => p.from === 'Attachments/Lane_Gazette_No1.pdf').sure, 'guess');
  assert.equal(to['Attachments/stray.bin'], null, 'nothing names it: it stays and says so');
  assert.equal(to['Attachments/Recording – Site walk 2026-10-22 05.02.m4a'], 'Meetings/Files/Site walk/Recording – Site walk 2026-10-22 05.02.m4a', 'a recording goes with the meeting it is named after');
  assert.equal(plan.find((p) => p.from.includes('Recording')).why, 'A recording of Site walk');
  assert.equal(to['Attachments/Budget 2026-10-22.xlsx'], null, 'a date shared with a note’s name is no reason to move it');
  assert.equal(plan.some((p) => p.from === 'Assets/logo.png'), false, 'only the attachments folder');
  assert.match(M.fileMigrationWords(plan), /7 files go beside their notes; 2 stay where they are/);
  // After the move into areas, an area's own Files folder: a linked file goes beside its note, an unlinked one stays.
  const areaPlan = M.planFileMigration({ notes: [...notes, { path: 'Work/Projects/Dock/Dock.md', props: { type: 'project' }, links: [{ target: 'Work/Files/Dock quote.pdf', reached: 'Work/Files/Dock quote.pdf' }] }], files: [{ path: 'Work/Files/Dock quote.pdf' }, { path: 'Work/Files/Loose.pdf' }, { path: 'Work/Files/Other Note/x.pdf' }], attachmentsFolder: 'Attachments', alsoFrom: ['Work/Files'], projects: ['Work/Projects/Dock/Dock.md'] });
  assert.deepEqual(areaPlan.map((p) => [p.from, p.to]), [['Work/Files/Dock quote.pdf', 'Work/Projects/Dock/Files/Dock quote.pdf']]);
  const chosen = M.withFileChoices(plan, { 'Attachments/stray.bin': 'People/Sam Lee.md', 'Attachments/walk.jpg': '' }, files.map((f) => f.path));
  assert.equal(chosen.find((p) => p.from === 'Attachments/stray.bin').to, 'People/Files/Sam Lee/stray.bin');
  assert.equal(chosen.find((p) => p.from === 'Attachments/walk.jpg').to, undefined);
});

test('the move on a made-up vault: every file and link survives, records written, families joined, Undo puts it back', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n# Harbour Lane\n\n## Documents\n- [[Attachments/Plan_v1.pdf|Plan v1]] — first plan\n- [[Attachments/Plan_v2.pdf|Plan v2]] — current plan\n- ![[shopfront.png]]\n');
  write(vault, 'Docs/Weekly Update.md', '# Weekly\n\n- [[Attachments/Plan_v2.pdf|Plan v2]]\n- [walk](Attachments/walk%20notes.txt)\n');
  write(vault, 'Meetings/2026-10-23 Kick-off.md', '---\ntype: meeting\n---\n![[Attachments/Agenda.txt]]\n');
  write(vault, 'Attachments/Plan_v1.pdf', 'plan one');
  write(vault, 'Attachments/Plan_v2.pdf', 'plan two');
  write(vault, 'Attachments/shopfront.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  write(vault, 'Attachments/walk notes.txt', 'We walked the lane and measured the frontage at six metres wide.\n');
  write(vault, 'Attachments/Agenda.txt', 'Kick-off agenda');
  write(vault, 'Attachments/stray.bin', 'nobody names me');
  const beforeHashes = Object.fromEntries(walk(vault).filter((f) => !f.rel.endsWith('.md')).map((f) => [f.rel, sha(readFileSync(path.join(vault, f.rel)))]));
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  const plan = await vf.migrationPlan();
  assert.match(plan.words, /5 files go beside their notes; 1 stays/);
  const r = await vf.migrationApply();
  assert.deepEqual(r.check.broken, []);
  assert.equal(r.check.files, 5);
  assert.equal(r.check.filesOk, 5);
  assert.ok(r.check.links >= 5 && r.check.linksOk === r.check.links);
  assert.ok(r.safety && existsSync(path.join(vault, r.safety)), 'the safety copy came first');
  // Every file is still somewhere with the same bytes.
  const afterHashes = walk(vault).filter((f) => !f.rel.endsWith('.md')).map((f) => sha(readFileSync(path.join(vault, f.rel))));
  for (const [p, h] of Object.entries(beforeHashes)) assert.ok(afterHashes.includes(h), `${p} survived`);
  assert.equal(existsSync(path.join(vault, 'Projects/Harbour Lane/Files/Plan_v2.pdf')), true);
  assert.equal(existsSync(path.join(vault, 'Docs/Files/Weekly Update/walk notes.txt')), true);
  assert.equal(existsSync(path.join(vault, 'Attachments/stray.bin')), true, 'the one nothing names stays');
  // The links now reach the new places.
  const proj = readFileSync(path.join(vault, 'Projects/Harbour Lane/Harbour Lane.md'), 'utf8');
  assert.match(proj, /\[\[Projects\/Harbour Lane\/Files\/Plan_v2\.pdf\|Plan v2\]\]/);
  // Records: moved here, its note, the family (v1 superseded by v2).
  const side = JSON.parse(readFileSync(path.join(vault, 'Projects/Harbour Lane/Files/.files.json'), 'utf8'));
  assert.equal(side.files['Plan_v1.pdf'].supersededBy, 'Plan_v2.pdf');
  assert.equal(side.files['Plan_v2.pdf'].source.how, 'migrated');
  assert.equal(side.files['Plan_v2.pdf'].source.from, 'Attachments/Plan_v2.pdf');
  assert.equal(side.files['Plan_v2.pdf'].record, 'Projects/Harbour Lane/Harbour Lane.md');
  const rows = await vf.versions('Projects/Harbour Lane/Files/Plan_v2.pdf');
  assert.deepEqual(rows.map((x) => [x.name, x.latest, !!x.named]), [['Plan_v2.pdf', true, false], ['Plan_v1.pdf', false, true]]);
  assert.equal(host.prefs().filesWithRecord, true, 'new files go beside their notes from now on');
  // Undo: every file back where it was, the links following again.
  const u = await vf.migrationUndo();
  assert.equal(u.back, 5);
  assert.equal(existsSync(path.join(vault, 'Attachments/Plan_v2.pdf')), true);
  assert.match(readFileSync(path.join(vault, 'Projects/Harbour Lane/Harbour Lane.md'), 'utf8'), /\[\[Attachments\/Plan_v2\.pdf\|Plan v2\]\]/);
  await assert.rejects(() => vf.migrationUndo(), /undone already/);
});

// ── Family photos ──

test('Family photos in an area’s assets are asked for each use; never given when the person says never', () => {
  const store = { ...M.emptyStore(), folders: { Family: 'family' }, access: { neuralspark: ['open', 'work', 'personal', 'family'] } };
  const d = M.decide(store, 'neuralspark', 'Family/Assets/Beach day.jpg', 'family', 'the host app');
  assert.equal(d.ok, false);
  assert.equal(d.consent, true, 'a request waits for the person');
  const doc = M.decide(store, 'neuralspark', 'Family/Files/School/Term dates.pdf', 'family', 'the host app');
  assert.equal(doc.ok, true, 'a document of that level is fine for an agent allowed it');
  const never = M.decide({ ...store, photos: 'never' }, 'neuralspark', 'Family/Assets/Beach day.jpg', 'family', 'the host app');
  assert.equal(never.consent, false);
  const bot = M.decide(store, 'neuralbot', 'Family/Assets/Beach day.jpg', 'family', 'Chat bot');
  assert.equal(bot.ok, false);
  assert.equal(bot.consent, false, 'an agent not allowed Family-private isn’t even asked');
});

test('info finds a file moved within the vault under the same name; a missing or shared name still says so', async () => {
  const vault = freshVault();
  write(vault, 'Projects/Harbour Lane/Harbour Lane.md', '---\ntype: project\n---\n# Harbour Lane\n');
  write(vault, 'Projects/Harbour Lane/Files/Quote.txt', 'The quote words\n');
  const host = makeHost(vault);
  const vf = new M.VaultFiles(host);
  // Moved by something else (a sync, Explorer): the old path has nothing, the file exists elsewhere.
  const { renameSync } = await import('node:fs');
  mkdirSync(path.join(vault, 'Projects/Harbour Lane/Files/Archive'), { recursive: true });
  renameSync(path.join(vault, 'Projects/Harbour Lane/Files/Quote.txt'), path.join(vault, 'Projects/Harbour Lane/Files/Archive/Quote.txt'));
  const info = await vf.info('Projects/Harbour Lane/Files/Quote.txt');
  assert.equal(info.path, 'Projects/Harbour Lane/Files/Archive/Quote.txt');
  await assert.rejects(() => vf.info('Projects/Harbour Lane/Files/Gone.txt'), /isn’t there any more/);
  write(vault, 'Other/Quote.txt', 'Another quote\n');
  await assert.rejects(() => vf.info('Projects/Harbour Lane/Files/Quote.txt'), /isn’t there any more/);
});
