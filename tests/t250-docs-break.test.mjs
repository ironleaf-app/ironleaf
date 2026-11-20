// node --test tests/t250-docs-break.test.mjs — break tonight's documents (t250, 12 Nov 2026).
// A vault-kept PDF that was deleted, renamed or is empty; a 300-page PDF; a version chain
// with a link missing; Signed with no name or a future day; Back from every error page.
// Static mechanism checks first (fast), then one live harness walk.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { clickWords, esc, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('a PDF that cannot be shown offers Back', () => {
  const view = read('src/renderer/src/views/pdf/PdfView.tsx');
  assert.ok(view.includes('pdfv-failed'), 'the failed page exists');
  assert.ok(view.includes('Back'), 'the failed page offers Back');
  assert.ok(read('src/renderer/src/views/project/ProjectTabs87.tsx').includes('vaultGonePdf'), 'a gone vault PDF opens in the vault viewer, not the folder view');
  // 13 Nov 2026, the picture: an existing PDF in the project's folder said it was gone. Only a missing row is gone.
  assert.match(read('src/renderer/src/views/project/ProjectTabs87.tsx'), /const vaultGonePdf = !!r\.missing && /, 'only a row that is really missing opens as gone');
});

test('a missing or empty PDF says so in plain words', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('This file is empty'), 'empty bytes refuse in plain words');
  const view = read('src/renderer/src/views/pdf/PdfView.tsx');
  assert.ok(view.includes('isn’t in your notes'), 'a gone file reads as gone, never damaged');
});

test('Signed asks for a name and refuses a future day', () => {
  const facts = read('src/renderer/src/components/DocFacts.tsx');
  assert.ok(facts.includes('Who signed it'), 'the form asks who');
  assert.ok(/signer.{0,80}trim\(\)/.test(facts), 'the name is read trimmed');
  assert.ok(/future|still to come|after today/i.test(facts), 'a future day is refused in plain words');
});

// ── Live ─────────────────────────────────────────────────────────────────────

const FLAG = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
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
const bigPdf = (pages) => {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const pageNo = objs.length + 1;
    kids.push(`${pageNo} 0 R`);
    objs.push('');
    objs.push(`<< /Length ${( `BT /F1 12 Tf 72 770 Td (Page ${i + 1} of ${pages}) Tj ET`).length} >>\nstream\nBT /F1 12 Tf 72 770 Td (Page ${i + 1} of ${pages}) Tj ET\nendstream`);
    objs[pageNo - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`;
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  objs.splice(2, 0, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // Renumber: font inserted shifts page/content numbers; rebuild kids with final numbers.
  const finalKids = [];
  for (let i = 0; i < pages; i++) finalKids.push(`${4 + i * 2} 0 R`);
  objs[1] = `<< /Type /Pages /Kids [${finalKids.join(' ')}] /Count ${pages} >>`;
  for (let i = 0; i < pages; i++) objs[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
  let out = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
};

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(FLAG, `---\ntype: project\nstatus: active\nowner: Alex Chen\n---\n# Harbourline Cart Fix\n\n## Summary\n\nThe cart fix.\n\n## What's next\n\n- [ ] Ring the bank — Alex Chen\n\n## Documents\n\n- \`Docs/Kept.pdf\` — Shopfit contract\n- \`Docs/Empty.pdf\` — Empty scan\n- \`Docs/Gone.pdf\` — Deleted file\n- \`Docs/Big.pdf\` — Long report\n\n## Notes\n\nKept.\n`);
    w('Docs/Kept.pdf', pdf('Shopfit Contract', 'Signed by June Park.'));
    w('Docs/Empty.pdf', Buffer.alloc(0));
    w('Docs/Big.pdf', bigPdf(300));
    w('Docs/Draft quote.md', `---\ntype: quote\nproject: ${FLAG}\ndoc_status: draft\n---\n# Draft quote\n\nTwelve hundred dollars fitted.\n`);
    w('Docs/Chain v1.md', `---\ntype: contract\nproject: ${FLAG}\n---\n# Chain v1\n\nFirst.\n`);
    w('Docs/Chain v2.md', `---\ntype: contract\nproject: ${FLAG}\nreplaces: "[[Docs/Chain v1]]"\n---\n# Chain v2\n\nSecond.\n`);
    w('Docs/Chain v4.md', `---\ntype: contract\nproject: ${FLAG}\nreplaces: "[[Docs/Chain v3]]"\n---\n# Chain v4\n\nFourth, its parent gone.\n`);
    w('Docs/Chain v5.md', `---\ntype: contract\nproject: ${FLAG}\nreplaces: "[[Docs/Chain v4]]"\n---\n# Chain v5\n\nFifth.\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });
const readVault = (h, rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');
async function tap(h, js) {
  const p = await h.browser.ev(`(() => { const el = (${js}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(p, `visible: ${js.slice(0, 140)}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(150);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
  await sleep(600);
}
async function openNote(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const done = await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes(${JSON.stringify(name)})); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`);
  assert.equal(done, 'CLICKED', `the switcher opens ${name}`);
  await sleep(1200);
}

async function openDocsRow(h, words) {
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  // t255: the folio reads through tabs; the rows stand on the Notes tab.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(900);
  await h.browser.ev(`document.querySelector('[data-section="notes"]')?.scrollIntoView()`);
  await sleep(600);
  await clickWords(h, 'Show all', '[data-section="notes"]');
  await sleep(500);
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('[data-section="notes"] .trow')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 80)); } })()`);
  await sleep(400);
  await tap(h, `[...document.querySelectorAll('[data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes(${JSON.stringify(words)}))`);
}

test('a deleted PDF reads as gone, with Back that works', { timeout: 300000 }, async () => {
  const h = await harness();
  await openDocsRow(h, 'Deleted file');
  assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-failed')`, 15000), 'the failed page shows');
  const words = await h.browser.ev(`document.querySelector('.pdfv-failed p')?.innerText ?? ''`);
  assert.ok(words.includes('isn’t in your notes'), `gone reads as gone (saw "${words}")`);
  assert.equal(await clickWords(h, 'Back', '.pdfv-failed'), 'CLICKED', 'Back shows');
  await sleep(1200);
  const backAt = await h.browser.ev(`(document.querySelector('main')?.innerText ?? '').includes('Harbourline Cart Fix')`);
  assert.ok(backAt, 'Back returns to the project');
});

test('an empty PDF reads as empty, with Back', { timeout: 300000 }, async () => {
  const h = await harness();
  await openDocsRow(h, 'Empty scan');
  assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-failed')`, 15000), 'the failed page shows');
  const words = await h.browser.ev(`document.querySelector('.pdfv-failed p')?.innerText ?? ''`);
  assert.ok(words.toLowerCase().includes('empty'), `empty reads as empty (saw "${words}")`);
  assert.ok(await h.browser.ev(`[...document.querySelectorAll('.pdfv-failed button')].some((b) => (b.innerText || '').trim() === 'Back')`), 'Back shows');
});

test('a 300-page PDF opens and pages', { timeout: 300000 }, async () => {
  const h = await harness();
  await openDocsRow(h, 'Long report');
  assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-page')`, 30000), 'pages draw');
  await sleep(2000);
  const count = await h.browser.ev(`document.querySelectorAll('.pdfv-page').length`);
  assert.equal(count, 300, 'all 300 pages lay out');
  const first = await h.browser.ev(`!!document.querySelector('.pdfv-page canvas')`);
  assert.ok(first, 'the first page draws');
});

test('a version chain with a link missing neither crashes nor doubles', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Chain v5');
  assert.ok(await waitFor(h, `!!document.querySelector('.doc-facts-line')`, 8000), 'the facts line shows');
  const line = await h.browser.ev(`document.querySelector('.doc-facts-line')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(line.includes('Earlier versions (1)'), `the found parent lists, the missing one stops it (saw "${line}")`);
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: 'Search inside notes' });
  await sleep(900);
  await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Search inside notes'))?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('input[aria-label="Search notes, tasks, projects, people, meetings and files"]')`, 8000), 'search opens');
  await h.browser.send('Input.insertText', { text: 'Chain v' });
  await sleep(3000);
  const titles = await h.browser.ev(`[...document.querySelectorAll('.srow2 .sas-rowhead .t')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).join('|')`);
  assert.ok(titles.includes('Chain v5'), `the latest lists (${titles.slice(0, 200)})`);
  assert.ok(!titles.includes('Chain v4'), 'its found parent folds under it');
  await esc(h);
});

test('Signed with no name or a future day refuses; a real signing lands', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Draft quote');
  assert.ok(await waitFor(h, `!!document.querySelector('.doc-facts-line')`, 8000), 'the facts line shows');
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').includes('Set status') || (b.textContent || '').includes('Draft'))`);
  assert.ok(await waitFor(h, `!!document.querySelector('.menu[role="menu"]')`, 5000), 'the choices show');
  await tap(h, `[...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => (b.innerText || '').trim() === 'Signed')`);
  assert.ok(await waitFor(h, `!!document.querySelector('.dialog-form')`, 5000), 'who and when are asked');
  await tap(h, `document.querySelector('.dialog-actions .button.primary')`);
  await sleep(800);
  assert.ok(await waitFor(h, `!!document.querySelector('.toast')`, 5000), 'refusing says so');
  const noName = await h.browser.ev(`document.querySelector('.toast')?.innerText ?? ''`);
  assert.ok(noName.includes('who signed'), `no name refuses in plain words (saw "${noName}")`);
  assert.ok(readVault(h, 'Docs/Draft quote.md').includes('doc_status: draft'), 'still a draft');
  await esc(h);
  await sleep(500);
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').includes('Set status') || (b.textContent || '').includes('Draft'))`);
  await sleep(500);
  await tap(h, `[...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => (b.innerText || '').trim() === 'Signed')`);
  assert.ok(await waitFor(h, `!!document.querySelector('.dialog-form')`, 5000), 'asked again');
  await h.browser.send('Input.insertText', { text: 'June Park' });
  await sleep(300);
  await tap(h, `[...document.querySelectorAll('.dialog-field input')][1]`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await h.browser.send('Input.insertText', { text: '2030-01-01' });
  await sleep(300);
  await tap(h, `document.querySelector('.dialog-actions .button.primary')`);
  await sleep(800);
  const future = await h.browser.ev(`document.querySelector('.toast')?.innerText ?? ''`);
  assert.ok(future.includes('still to come'), `a future day refuses in plain words (saw "${future}")`);
  assert.ok(readVault(h, 'Docs/Draft quote.md').includes('doc_status: draft'), 'still a draft');
  await esc(h);
});
