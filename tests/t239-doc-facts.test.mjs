// node --test tests/t239-doc-facts.test.mjs — documents carry version, status and signer (t239, plan item 4, their
// decision 4): status (draft, sent, signed, or plain none), signer and signed-on when signed, and versions chained
// by `replaces`, so "Latest" is a fact. The document's own page shows them at the top, with one-click status and
// new version; a project's notes, documents and files show in ONE list, latest only, with a version count and a
// status chip per row. Real input (the real mouse over CDP). Made-up vault only.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const shotsDir = path.join(root, '..', 'shots');

// ── Static: the facts live in typed fields, the page reads them ─────────────

test('a file’s facts live as typed sub-lines its Documents entry keeps', () => {
  const shared = read('src/shared/doc-versions.ts');
  assert.ok(shared.includes('doc_status') && shared.includes('signed_by') && shared.includes('signed_on') && shared.includes('replaces'), 'the four typed fields');
  assert.ok(shared.includes('export function readDocFactsMore'), 'files read them from sub-lines');
  assert.ok(shared.includes('export function docFactsToMore'), 'files write them back keeping the person’s lines');
  const file = read('src/shared/project-file.ts');
  assert.ok(file.includes("documents: [['path', 300], ['what', 300], ['more', 2000]]"), 'a Documents line carries sub-lines through edits');
});

test('the document’s page shows the facts with its status choices and new version', () => {
  const facts = read('src/renderer/src/components/DocFacts.tsx');
  assert.ok(facts.includes('Earlier versions ('), 'earlier versions read on the page');
  assert.ok(facts.includes('New version'), 'a new version takes one click');
  assert.ok(facts.includes('DOC_STATUSES'), 'the status shows its choices (t248: never flips unseen)');
  assert.ok(facts.includes('NEXT_STATUS'), 'the next status still reads on the control');
  assert.ok(facts.includes('Who signed it?'), 'choosing Signed asks who and when');
  assert.ok(facts.includes('Add who signed'), 'the signer is asked for, never invented');
  assert.ok(read('src/renderer/src/views/NoteView.tsx').includes('<DocFactsLine'), 'a note’s head carries the line');
  assert.ok(read('src/renderer/src/views/DocHead.tsx').includes('<DocFactsLine'), 'a doc’s head carries the line');
  assert.ok(read('src/renderer/src/views/FolderFileView.tsx').includes('<DocFacts'), 'a file’s viewer carries the line');
});

test('the project lists notes, documents and files once, latest only', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('export function folioFileRows'), 'one rule builds the file rows');
  assert.ok(tabs.includes('title="Notes and files"'), 'one list on the page');
  assert.ok(tabs.includes('if (!chain.latest) continue'), 'a superseded version never lists');
  assert.ok(tabs.includes('docCountWords('), 'a version count reads on the row');
  assert.ok(tabs.includes('STATUS_WORDS[r.status]'), 'the status chip reads on the row');
  assert.ok(!read('src/renderer/src/views/ProjectPage.tsx').includes('FilesSection'), 'no separate Files split');
});

// ── Live ─────────────────────────────────────────────────────────────────────

let H = null;
let FOLDER = '';
async function harness() {
  if (!H) {
    FOLDER = path.join(tmpdir(), `nv-t239f-folder-${Date.now()}`);
    mkdirSync(path.join(FOLDER, 'Budget'), { recursive: true });
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
      objs.forEach((o, i) => {
        offsets.push(Buffer.byteLength(out));
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
      });
      const xref = Buffer.byteLength(out);
      out += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return Buffer.from(out, 'latin1');
    };
    writeFileSync(path.join(FOLDER, 'Budget', 'Shopfit Contract v2.pdf'), pdf('Shopfit Contract v2', 'Signed by June Park on 3 Oct 2026.'));
    writeFileSync(path.join(FOLDER, 'Budget', 'Shopfit Contract v1.pdf'), pdf('Shopfit Contract v1', 'First version, sent for review.'));
    const { readdirSync, statSync, rmSync } = await import('node:fs');
    const groups = ['Budget'].map((g) => ({
      name: g,
      files: readdirSync(path.join(FOLDER, g)).map((f) => {
        const st = statSync(path.join(FOLDER, g, f));
        return { rel: `${g}/${f}`, name: f, ext: 'pdf', size: st.size, modified: Date.now() - 86400000 };
      }),
    }));
    H = await startHarness({ projectFiles: { folder: FOLDER, exists: true, groups, total: 2, more: 0 } });
    H.folderCleanup = () => rmSync(FOLDER, { recursive: true, force: true });
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w('People/June Park.md', `---\ntype: person\nrole: Bookkeeper\n---\n# June Park\n\nBookkeeper for the shop. Signs the contracts.\n`);
    w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline Cart Fix\n\n## Summary\n\nThe shop's cart drops about one order in forty at payment.\n\n## What's next\n\n- [ ] Chase the 2 carts that failed on Friday — Alex Chen — due 2026-11-05\n\n## Key dates\n\n- 2026-11-20: Cart fix done (milestone)\n\n## People\n\n- Alex Chen (owner)\n- June Park\n\n## Documents\n\n- \`Budget/Shopfit Contract v2.pdf\` — Shopfit contract\n  doc_status: signed\n  signed_by: June Park\n  signed_on: 2026-10-03\n  replaces: [[Budget/Shopfit Contract v1.pdf]]\n- \`Budget/Shopfit Contract v1.pdf\` — First version\n\n## Notes\n\nKept for the fix.\n`);
    w('Docs/Shopfit Contract v1.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: sent\n---\n# Shopfit Contract v1\n\nFirst version of the shopfit contract, sent to June.\n`);
    w('Docs/Shopfit Contract v2.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: signed\nsigned_by: June Park\nsigned_on: 2026-10-03\nreplaces: "[[Docs/Shopfit Contract v1]]"\n---\n# Shopfit Contract v2\n\nSigned version of the shopfit contract.\n`);
    w('Docs/Plain supplier note.md', `---\ntype: note\n---\n# Plain supplier note\n\nAn older note with no facts at all. Nothing about it is invented.\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
  }
  return H;
}
after(async () => {
  try {
    H?.folderCleanup?.();
  } catch {}
  await H?.close().catch(() => {});
  H = null;
});

async function tap(h, js) {
  const p = await h.browser.ev(`(() => {
    const el = (${js});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const rs = el.getClientRects();
    const rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r;
    return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 };
  })()`);
  assert.ok(p, `visible: ${js.slice(0, 140)}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(150);
  const q = await h.browser.ev(`(() => {
    const el = (${js});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const rs = el.getClientRects();
    const rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r;
    return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 };
  })()`);
  assert.ok(q, 'steady');
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(q.x), y: Math.round(q.y) });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(q.x), y: Math.round(q.y), button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(q.x), y: Math.round(q.y), button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
  await sleep(600);
}

async function shot(h, name) {
  mkdirSync(shotsDir, { recursive: true });
  const pic = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  if (pic.result?.data) writeFileSync(path.join(shotsDir, name), Buffer.from(pic.result.data, 'base64'));
}

async function openNote(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const done = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes(${JSON.stringify(name)}));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `the switcher opens ${name}`);
  await sleep(1200);
}

const readVault = (h, rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');
/** One of the project page's own tabs (t255: the folio reads through tabs). */
async function openTab(h, id) {
  await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(900);
}
const factsLine = `document.querySelector('.doc-facts-line')?.innerText ?? ''`;
/** The facts line reads words (its chain re-reads after a write lands). */
const waitLine = (h, words, what) => waitFor(h, `(${factsLine}).includes(${JSON.stringify(words)})`, 8000).then((ok) => assert.ok(ok, what));

/** The app rebooted (the harness delivers no change events, so the lists re-read the index this way;
 *  the real app's watcher does it live). */
async function reboot(h) {
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2000);
}

test('a document’s page shows version, status and signer with earlier versions', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
  await openNote(h, 'Shopfit Contract v2');
  assert.ok(await waitFor(h, `!!document.querySelector('.doc-facts-line')`, 8000), 'the facts line shows');
  const line = await h.browser.ev(factsLine);
  assert.ok(line.includes('Contract'), `what it is (saw ${line})`);
  assert.ok(line.includes('v2, latest'), `its version (saw ${line})`);
  assert.ok(line.includes('Signed by June Park on 3 Oct'), `who signed it and when (saw ${line})`);
  assert.ok(line.includes('Earlier versions (1)'), `earlier versions counted (saw ${line})`);
  await shot(h, 'doc-facts-head-1219x709.png');
  // One click down to the earlier version: it opens as itself.
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').includes('Earlier versions'))`);
  await sleep(500);
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').includes('Shopfit Contract v1'))`);
  await sleep(800);
  assert.ok((await h.browser.ev(`document.title`)).includes('Shopfit Contract v1'), 'the earlier version opens');
  const v1 = await h.browser.ev(factsLine);
  assert.ok(v1.includes('v1') && !v1.includes('latest'), `v1 knows it is not the latest (saw ${v1})`);
  assert.ok(v1.includes('Sent'), `v1 keeps its status (saw ${v1})`);
});

test('choosing the status shows its choices; Signed asks who and when', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Shopfit Contract v1');
  assert.ok(await waitFor(h, `!!document.querySelector('.doc-facts-line')`, 8000), 'the facts line shows');
  // The choices show; nothing flips unseen (t248: two clicks flipped Draft to Sent with no menu seen).
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').trim() === 'Sent')`);
  assert.ok(await waitFor(h, `!!document.querySelector('.menu[role="menu"]')`, 5000), 'the choices show');
  const menu = await h.browser.ev(`[...document.querySelectorAll('.menu [role="menuitem"] .menu-label')].map((e) => e.innerText).join('|')`);
  assert.ok(menu.includes('Draft') && menu.includes('Sent') && menu.includes('Signed'), `Draft, Sent, Signed (saw ${menu})`);
  let file = readVault(h, 'Docs/Shopfit Contract v1.md');
  assert.ok(file.includes('doc_status: sent'), 'opening the menu flips nothing');
  await shot(h, 'doc-facts-status-menu-1219x709.png');
  // Signed asks who and when: named and dated, never invented.
  await tap(h, `[...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => (b.innerText || '').trim() === 'Signed')`);
  assert.ok(await waitFor(h, `!!document.querySelector('.dialog-form')`, 5000), 'who and when are asked');
  await h.browser.send('Input.insertText', { text: 'June Park' });
  await sleep(300);
  await tap(h, `[...document.querySelectorAll('.dialog-field input')][1]`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await h.browser.send('Input.insertText', { text: '2026-11-03' });
  await sleep(300);
  await tap(h, `document.querySelector('.dialog-actions .button.primary')`);
  await sleep(1000);
  file = readVault(h, 'Docs/Shopfit Contract v1.md');
  assert.ok(file.includes('doc_status: signed'), 'signed lands in the front matter');
  assert.ok(file.includes('signed_by: June Park'), 'the signer lands in the front matter');
  assert.ok(file.includes('signed_on: 2026-11-03'), 'the asked when lands, not today by guess');
  await waitLine(h, 'Signed by June Park on 3 Nov', 'the page reads the signer and the day');
  await shot(h, 'doc-facts-signed-1219x709.png');
});

test('a new version takes one click and links what it replaces', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Shopfit Contract v2');
  assert.ok(await waitFor(h, `!!document.querySelector('.doc-facts-line')`, 8000), 'the facts line shows');
  await tap(h, `[...document.querySelectorAll('.doc-facts-line .doc-tag')].find((b) => (b.textContent || '').trim() === 'New version')`);
  await sleep(1500);
  assert.ok((await h.browser.ev(`document.title`)).includes('Shopfit Contract v3'), 'the new version opens');
  const file = readVault(h, 'Docs/Shopfit Contract v3.md');
  assert.ok(file.includes('replaces: "[[Docs/Shopfit Contract v2]]"'), 'it links what it replaces');
  assert.ok(file.includes('doc_status: draft'), 'a new version starts a draft');
  await waitLine(h, 'v3, latest', 'it knows its place');
  await waitLine(h, 'Earlier versions (2)', 'both earlier versions count');
  await shot(h, 'doc-facts-new-version-1219x709.png');
});

test('live: the project lists notes, documents and files once, latest only', { timeout: 300000 }, async () => {
  const h = await harness();
  await reboot(h);
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  const lists = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] .trow button.t')].map((b) => b.textContent).join('|')`);
  assert.ok(!lists.split('|').some((t) => t === 'Shopfit Contract v1' || t === 'Shopfit Contract v2'), `superseded notes never list (saw ${lists})`);
  assert.ok(lists.split('|').some((t) => t === 'Shopfit Contract v3'), 'the latest note lists');
  assert.ok(!lists.split('|').some((t) => t === 'Shopfit Contract v1.pdf'), 'a superseded file never lists');
  assert.ok(lists.split('|').some((t) => t === 'Shopfit Contract v2.pdf'), 'the latest file lists');
  const chips = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] .trow .tag')].map((t) => t.innerText).join(',')`);
  assert.ok(chips.includes('Signed'), `the status chip reads on its row (saw ${chips})`);
  const counts = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] .trow .meta')].map((m) => m.innerText.replace(/\\s+/g, ' ')).join('\\n')`);
  assert.ok(counts.includes('3 versions') && counts.includes('2 versions'), `version counts read (saw ${counts.slice(0, 200)})`);
  await h.browser.ev(`document.querySelector('[data-section="notes"]')?.scrollIntoView()`);
  await sleep(600);
  await shot(h, 'doc-facts-one-list-1219x709.png');
});

test('critic 1 job 4 from the project: the latest contract and who signed it', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  await openTab(h, 'notes');
  // One click (inside the 2-click budget): the contract's row opens the latest version, whose head answers
  // both halves — which is latest, and who signed it.
  await tap(h, `[...document.querySelectorAll('[data-section="notes"] .trow button.t')].find((b) => (b.textContent || '') === 'Shopfit Contract v2.pdf')`);
  await sleep(1500);
  const line = await h.browser.ev(`document.querySelector('.folder-file-view .doc-facts-line')?.innerText ?? ''`);
  assert.ok(line.includes('v2, latest'), `the latest version (saw ${line})`);
  assert.ok(line.includes('Signed by June Park on 3 Oct'), `who signed it (saw ${line})`);
  await shot(h, 'doc-facts-job4-1219x709.png');
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 2, mobile: false });
  await sleep(800);
  await shot(h, 'doc-facts-job4-3456x1408.png');
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
});

test('a file’s viewer carries its facts, and the status writes back', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  await openTab(h, 'notes');
  await tap(h, `[...document.querySelectorAll('[data-section="notes"] .chip')].find((b) => (b.textContent || '').includes('Files'))`);
  await sleep(500);
  await tap(h, `[...document.querySelectorAll('[data-section="notes"] .trow button.t')].find((b) => (b.textContent || '') === 'Shopfit Contract v2.pdf')`);
  await sleep(1500);
  assert.ok(await waitFor(h, `!!document.querySelector('.folder-file-view .doc-facts-line')`, 8000), 'the viewer carries the facts line');
  const line = await h.browser.ev(`document.querySelector('.folder-file-view .doc-facts-line')?.innerText ?? ''`);
  assert.ok(line.includes('PDF'), `what it is (saw ${line})`);
  assert.ok(line.includes('v2, latest'), `its version (saw ${line})`);
  assert.ok(line.includes('Signed by June Park on 3 Oct'), `who signed it and when (saw ${line})`);
  await shot(h, 'doc-facts-file-viewer-1219x709.png');
  // The choices show here too; clearing the status writes under its Documents entry (the person’s own kept).
  await tap(h, `[...document.querySelectorAll('.folder-file-view .doc-facts-line .doc-tag')].find((b) => (b.textContent || '').includes('Signed by'))`);
  assert.ok(await waitFor(h, `!!document.querySelector('.menu[role="menu"]')`, 5000), 'the choices show');
  await tap(h, `[...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => (b.innerText || '').includes('Clear the status'))`);
  await sleep(1200);
  const project = readVault(h, 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md');
  assert.ok(!/doc_status: signed/.test(project.split('Shopfit Contract v2.pdf')[1].split('- `')[0]), 'signed leaves the entry');
  assert.ok(project.includes('signed_by: June Park'), 'the signer stays written');
});

test('an older document without the fields reads plain, with nothing invented', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Plain supplier note');
  await sleep(1200);
  assert.ok(!(await h.browser.ev(`!!document.querySelector('.doc-facts-line')`)), 'no facts line on a plain note');
  const menu = read('src/renderer/src/state/menus.ts');
  assert.ok(menu.includes("label: 'Document status'"), 'a plain note becomes a document from its menu');
});
