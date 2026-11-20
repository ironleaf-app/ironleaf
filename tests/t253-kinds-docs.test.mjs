// node --test tests/t253-kinds-docs.test.mjs — every kind its badge, every PDF its pages (t253, 13
// Nov 2026, the pictures: a .json file wore a TXT badge; clicking an existing folder PDF opened "That
// file isn't in your notes any more" — the reviewer fixed the cause in 86a497f36, vaultGonePdf only
// for a really missing row — and the viewer's whole area was flat pink). A project linked to a PC
// folder holding PDFs at its top and in a subfolder, beside vault files at the vault's top and in
// Docs/: every existing PDF opens and shows its pages, while a really missing one still reads as gone
// with Back. The failed page sits on the page's own surface. Made-up vault only. Fails without each
// change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ── Unit: every kind its own badge ──────────────────────────────────────

const work = mkdtempSync(path.join(tmpdir(), 'nv-t253-kinds-'));
let K;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'k.ts');
  writeFileSync(entry, `export { fileKind } from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/projectLook.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'k.mjs'), format: 'esm' }, logLevel: 'silent' });
  K = await import(pathToFileURL(path.join(work, 'k.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a .json file wears JSON, yaml wears YAML, the rest keep theirs', () => {
  assert.deepEqual(K.fileKind('json'), { label: 'JSON', kind: 'text' });
  assert.deepEqual(K.fileKind('yaml'), { label: 'YAML', kind: 'text' });
  assert.deepEqual(K.fileKind('yml'), { label: 'YAML', kind: 'text' });
  assert.deepEqual(K.fileKind('txt'), { label: 'TXT', kind: 'text' });
  assert.deepEqual(K.fileKind('md'), { label: 'MD', kind: 'text' });
  assert.deepEqual(K.fileKind('pdf'), { label: 'PDF', kind: 'pdf' });
  assert.deepEqual(K.fileKind('pptx'), { label: 'PPT', kind: 'slides' });
});

test('the failed PDF page sits on the page surface, never the pink desk', () => {
  const css = read('src/renderer/src/styles/pdf.css');
  assert.ok(/\.pdfv-failed \{[^}]*background: var\(--bg\)/s.test(css), 'failed paints the page surface');
});

// ── Live: the folder's PDFs and the vault's ─────────────────────────────

const pdf = (title, line) => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = `BT /F1 24 Tf 72 770 Td (${title}) Tj ET BT /F1 12 Tf 72 736 Td (${line}) Tj ET`;
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
};

const SMALL = 'Projects/Harbour Light Launch/Harbour Light Launch.md';
let H = null;
let FOLDER = '';
async function harness() {
  if (!H) {
    FOLDER = path.join(tmpdir(), `nv-t253-docs-${Date.now()}`);
    mkdirSync(path.join(FOLDER, 'Stalls'), { recursive: true });
    writeFileSync(path.join(FOLDER, 'Top deck.pdf'), pdf('Top Deck', 'At the folder top.'));
    writeFileSync(path.join(FOLDER, 'till-lines.json'), Buffer.from('{"lines":["flour"]}', 'utf8'));
    writeFileSync(path.join(FOLDER, 'Stalls', 'Stall quote.pdf'), pdf('Stall Quote', 'In the subfolder.'));
    const top = ['Top deck.pdf', 'till-lines.json'].map((f) => {
      const st = statSync(path.join(FOLDER, f));
      return { rel: f, name: f, ext: f.slice(f.lastIndexOf('.') + 1).toLowerCase(), size: st.size, modified: Date.now() - 864e5 };
    });
    const sub = statSync(path.join(FOLDER, 'Stalls', 'Stall quote.pdf'));
    const groups = [
      { name: '', files: top },
      { name: 'Stalls', files: [{ rel: 'Stalls/Stall quote.pdf', name: 'Stall quote.pdf', ext: 'pdf', size: sub.size, modified: Date.now() - 864e5 }] },
    ];
    H = await startHarness({ projectFiles: { folder: FOLDER, exists: true, groups, total: 3, more: 0 } });
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(SMALL, `---\ntype: project\nstatus: active\nowner: Alex Chen\n---\n# Harbour Light Launch\n\n## What's next\n\n- [ ] Present the deck — Alex Chen\n\n## People\n\n- Alex Chen\n\n## Documents\n\n- \`Site Map.pdf\`\n- \`Docs/Kept Contract.pdf\`\n- \`Docs/Deleted file.pdf\`\n\n## Notes\n\nKept.\n`);
    w('Site Map.pdf', pdf('Site Map', 'At the vault top.'));
    w('Docs/Kept Contract.pdf', pdf('Kept Contract', 'In Docs.'));
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
after(async () => {
  try { rmSync(FOLDER, { recursive: true, force: true }); } catch {}
  await H?.close().catch(() => {});
  H = null;
});

async function openProject(h) {
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, 'Harbour Light Launch', 'main'), 'CLICKED', 'the project opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
  await sleep(1500);
  // t255: the section bar became real tabs — the Notes tab opens, showing its whole list unfolded.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(1200);
}
async function tapRow(h, words) {
  const p = await h.browser.ev(`(() => {
    const el = [...document.querySelectorAll('[data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes(${JSON.stringify(words)}));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return r.width < 2 ? null : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  assert.ok(p, `the ${words} row stands to tap`);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(150);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(600);
}

test('the .json row wears JSON and reads as a JSON file', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  const row = await h.browser.ev(`(() => {
    const el = [...document.querySelectorAll('[data-section="notes"] .trow')].find((r) => (r.querySelector('button.t')?.textContent || '').includes('till-lines.json'));
    if (!el) return null;
    return { badge: el.querySelector('.pj-kind')?.textContent ?? '', sub: el.querySelector('.meta')?.innerText.replace(/\\s+/g, ' ') ?? '' };
  })()`);
  assert.ok(row, 'the .json row lists');
  assert.equal(row.badge, 'JSON', 'its own badge, never TXT');
  assert.ok(row.sub.startsWith('JSON file'), `its own words (${row.sub})`);
});

test('a folder PDF at the top and in a subfolder opens in the folder viewer, never as gone', { timeout: 300000 }, async () => {
  const h = await harness();
  for (const [words, rel] of [['Top deck.pdf', 'Top deck.pdf'], ['Stall quote.pdf', 'Stalls/Stall quote.pdf']]) {
    await openProject(h);
    await tapRow(h, words);
    assert.ok(await waitFor(h, `!!document.querySelector('.media-view, .pf-view-pdf, .pdfv')`, 10000), `${words} opens somewhere to judge`);
    const seen = await h.browser.ev(`(() => ({
      failed: !!document.querySelector('.pdfv-failed'),
      frame: document.querySelector('.pf-view-pdf')?.getAttribute('src') ?? null,
      words: (document.querySelector('main')?.innerText ?? '').slice(0, 200),
    }))()`);
    assert.equal(seen.failed, false, `${words} never reads as gone`);
    assert.ok(!seen.words.includes('isn’t in your notes'), `${words} never says gone (${seen.words.slice(0, 120)})`);
    assert.ok(seen.frame && decodeURIComponent(seen.frame).includes(rel), `${words} shows its own file (${seen.frame})`);
  }
});

test('a vault PDF at the top and in Docs/ opens and shows its pages', { timeout: 300000 }, async () => {
  const h = await harness();
  for (const words of ['Site Map.pdf', 'Kept Contract.pdf']) {
    await openProject(h);
    await tapRow(h, words);
    assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-page')`, 30000), `${words} lays out pages`);
    await sleep(1500);
    const pages = await h.browser.ev(`({ n: document.querySelectorAll('.pdfv-page').length, drawn: !!document.querySelector('.pdfv-page canvas') })`);
    assert.ok(pages.n >= 1 && pages.drawn, `${words} shows its pages (${pages.n}, drawn ${pages.drawn})`);
  }
});

test('a really missing PDF still reads as gone, with Back, on the page surface', { timeout: 300000 }, async () => {
  const h = await harness();
  await openProject(h);
  await tapRow(h, 'Deleted file');
  assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-failed')`, 15000), 'the failed page shows');
  const gone = await h.browser.ev(`(() => {
    const failed = document.querySelector('.pdfv-failed');
    const probe = document.createElement('div');
    probe.style.background = 'var(--bg)';
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { words: failed.querySelector('p')?.innerText ?? '', back: [...failed.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === 'Back'),
      bg: getComputedStyle(failed).backgroundColor, want };
  })()`);
  assert.ok(gone.words.includes('isn’t in your notes'), `gone reads as gone (${gone.words})`);
  assert.ok(gone.back, 'Back shows');
  assert.equal(gone.bg, gone.want, `the failed page sits on the page surface (${gone.bg})`);
  assert.equal(await clickWords(h, 'Back', '.pdfv-failed'), 'CLICKED', 'Back answers');
  await sleep(1200);
  assert.ok(await h.browser.ev(`(document.querySelector('main')?.innerText ?? '').includes('Harbour Light Launch')`), 'Back returns to the project');
});
