// node --test tests/import-edges.test.mjs — 10.0 item 16 outliner and Notion edges: a Roam
// export's pictures and files beside it come with the page (remote links stay links, missing
// said); a Logseq link from the graph root resolves there; Notion files no page holds are kept
// in one Unplaced files note with where they came from, never dropped. Each check fails
// without its fix.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-import-edges-'));
let E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as E from ${JSON.stringify(path.join(root, 'src/main/pairing/engine.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'edges.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ E } = await import(pathToFileURL(path.join(work, 'edges.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const freshVault = () => {
  const v = path.join(work, `vault-${++n}`);
  mkdirSync(v, { recursive: true });
  return v;
};
const temp = () => {
  const t = path.join(work, 'temp');
  mkdirSync(t, { recursive: true });
  return t;
};
const read = (v, rel) => readFileSync(path.join(v, ...rel.split('/')), 'utf8');
const has = (v, rel) => existsSync(path.join(v, ...rel.split('/')));
const bring = (v, source, o = {}) => E.importPath(v, source, { tempDir: temp(), now: new Date(2026, 10, 2, 10, 0), ...o });

test('Roam: pictures and files beside the export come with the page, remote stay, missing said', async () => {
  const v = freshVault();
  const dir = path.join(work, 'roam-edge');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'images'), { recursive: true });
  writeFileSync(
    path.join(dir, 'edge.json'),
    JSON.stringify([
      { title: 'Plans', children: [{ string: 'See [Spec](spec.pdf) and ![Shot](images/shot.png) and [Web](https://example.com/x.pdf) and [Gone](gone.pdf).', uid: 'u1' }] },
    ]),
  );
  writeFileSync(path.join(dir, 'spec.pdf'), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(dir, 'images', 'shot.png'), Buffer.from([4, 5, 6]));
  const { summary } = await bring(v, path.join(dir, 'edge.json'));
  const note = read(v, 'From Roam Research/edge/Plans.md');
  assert.match(note, /\[\[.*spec\.pdf/, 'the sibling file comes with the page as a link');
  assert.match(note, /!\[\[.*shot\.png/, 'the sibling picture comes with the page as an embed');
  assert.match(note, /https:\/\/example\.com\/x\.pdf/, 'a remote link stays a link');
  assert.match(note, /Gone/, 'the missing words stay');
  assert.doesNotMatch(note, /gone\.pdf.*\]\]|\(gone\.pdf\)/i, 'the missing file leaves no link');
  assert.ok(has(v, 'From Roam Research/edge/Files/Plans/spec.pdf'), 'the file beside the note');
  assert.ok(has(v, 'From Roam Research/edge/Files/Plans/shot.png'), 'the picture beside the note');
  assert.ok(summary.files >= 2, `two files kept: ${JSON.stringify(summary)}`);
  assert.ok(summary.skipped.some((s) => s.what === 'Plans' && /gone\.pdf/.test(s.why)), `the missing one said: ${JSON.stringify(summary.skipped)}`);
  assert.ok(!summary.skipped.some((s) => /spec\.pdf|shot\.png/.test(s.why)), 'found files never said as missing');
});

test('Logseq: a link from the graph root resolves there', async () => {
  const v = freshVault();
  const graph = path.join(work, 'logseq-edge');
  rmSync(graph, { recursive: true, force: true });
  mkdirSync(path.join(graph, 'pages'), { recursive: true });
  mkdirSync(path.join(graph, 'journals'), { recursive: true });
  mkdirSync(path.join(graph, 'diagrams'), { recursive: true });
  writeFileSync(path.join(graph, 'pages', 'Shed.md'), '- See [flow](/diagrams/flow.png) and [gone](/diagrams/gone.png).\n');
  writeFileSync(path.join(graph, 'diagrams', 'flow.png'), Buffer.from([1, 2, 3]));
  const { summary } = await bring(v, graph);
  const note = read(v, 'From Logseq/logseq-edge/Shed.md');
  assert.match(note, /flow\.png/, 'the root-relative file comes with the page');
  assert.ok(summary.skipped.some((s) => s.what === 'Shed' && /gone\.png/.test(s.why)), `the missing one said: ${JSON.stringify(summary.skipped)}`);
});

test('Notion: files no page holds are kept in Unplaced files with where they came from', async () => {
  const v = freshVault();
  const hex = (c) => c.repeat(32);
  const dir = path.join(work, 'notion-edge');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, `Tasks ${hex('a')}`), { recursive: true });
  writeFileSync(path.join(dir, `Tasks ${hex('a')}.csv`), 'Name,Status\nWrite report,Doing\n');
  writeFileSync(path.join(dir, `Tasks ${hex('a')}`, `Write report ${hex('b')}.md`), `# Write report\n\nStatus: Doing\n\nDraft it.\n`);
  writeFileSync(path.join(dir, `Tasks ${hex('a')}`, 'loose.png'), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(dir, 'stray.png'), Buffer.from([4, 5, 6]));
  const { summary } = await bring(v, dir, { kind: 'notion' });
  const row = read(v, 'From Notion/Tasks/Write report.md');
  assert.match(row, /loose\.png/, 'the database file stays with its row');
  const unplaced = 'From Notion/Unplaced files.md';
  assert.ok(has(v, unplaced), 'the orphans note kept');
  const body = read(v, unplaced);
  assert.match(body, /stray\.png/, 'the orphan listed');
  assert.match(body, /stray\.png/, 'where it came from in the words');
  assert.ok(has(v, 'From Notion/Files/Unplaced files/stray.png'), 'the orphan file beside the note');
  assert.ok(!summary.skipped.some((s) => /stray\.png/.test(s.what)), `kept, never said as left out: ${JSON.stringify(summary.skipped)}`);
});
