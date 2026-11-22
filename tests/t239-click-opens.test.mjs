// node --test tests/t239-click-opens.test.mjs — a click opens the referenced document itself (t239, 12 Nov 2026).
// Every place a reference is clicked — a link in a note, a backlink, a search result, a task's source, a meeting,
// a person or project name, a file or PDF in a list, an Inbox item, a graph node, the side bar — opens the
// document in the main view, at the top with its title; no side panel opens; Back returns to where the person was,
// scrolled where they were. Ctrl or middle click opens it in a new tab. Real input throughout (the real mouse over
// CDP). Made-up vault only.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const shotsDir = path.join(root, '..', 'shots');

// ── Static: the mechanism, not the cases ────────────────────────────────────

test('clicks open through one opener: the peek call opens the document, never the side panel', () => {
  const peek = read('src/renderer/src/state/peek.ts');
  assert.ok(peek.includes('export function peek(ref: RecordRef, opts: PeekOpts = {}): void {\n  last = { at: Date.now(), ref, before: state };\n  openReference(ref, opts);\n}'), 'peek() opens the reference (t239)');
  assert.ok(peek.includes('export function openReference('), 'one opener for every click');
  assert.ok(peek.includes("A.openFolderFile(ref.path, ref.folderFile, where)"), 'a folder file opens in the viewer');
  assert.ok(peek.includes('window.nv.records.peek(ref)'), 'a bare name or id resolves first');
  assert.ok(peek.includes('has no page yet'), 'a person without a page says so, never a guessed page');
  assert.ok(!/export function peek[\s\S]{0,400}?set\(\{ stack/.test(peek), 'no click lands in the side panel');
});

test('file hits, the graph and the sidebar open the document in the main view', () => {
  assert.ok(read('src/renderer/src/state/fileSearch.ts').includes('A.openFolderFile(hit.project, hit.rel, where)'), 'a file hit opens the viewer tab');
  const graph = read('src/renderer/src/views/GraphTab.tsx');
  assert.ok(graph.includes("where: newTab ? 'tab' : 'current'"), 'the graph opens where the person is (Back returns), beside on Ctrl');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(!inbox.includes("where: 'tab'"), 'the Inbox opens where the person is');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('A.openFolderFile(ctx.path, rel)'), 'a file row opens the viewer');
  assert.ok(!read('src/renderer/src/views/ProjectPage.tsx').includes('FilesSection'), 'no separate Files split');
});

// ── The made-up vault ───────────────────────────────────────────────────────

function tinyPdf(title, line) {
  // A valid one-page PDF (offsets computed, so Chromium draws it for real).
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
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJ5ErkJggg==', 'base64');

// ── Harness ─────────────────────────────────────────────────────────────────

let H = null;
let FOLDER = '';
async function harness() {
  if (!H) {
    // The project's folder on this PC, real files in it (the viewer reads them for real).
    FOLDER = path.join(tmpdir(), `nv-t239-folder-${Date.now()}`);
    mkdirSync(path.join(FOLDER, 'Budget'), { recursive: true });
    mkdirSync(path.join(FOLDER, 'Photos'), { recursive: true });
    writeFileSync(path.join(FOLDER, 'Budget', 'Shopfit Contract v2.pdf'), tinyPdf('Shopfit Contract v2', 'Signed by June Park on 3 Oct 2026.'));
    writeFileSync(path.join(FOLDER, 'Budget', 'Shopfit Contract v1.pdf'), tinyPdf('Shopfit Contract v1', 'First version, sent for review.'));
    writeFileSync(path.join(FOLDER, 'Budget', 'quote.pdf'), tinyPdf('ShadeCo quote', 'Twelve hundred dollars fitted.'));
    writeFileSync(path.join(FOLDER, 'Photos', 'shopfront.png'), PNG);
    writeFileSync(path.join(FOLDER, 'Budget', 'totals.xlsx'), Buffer.from('PK fake workbook (the viewer reads real ones through the index)', 'utf8'));
    const { readdirSync, statSync } = await import('node:fs');
    const groups = ['Budget', 'Photos'].map((g) => ({
      name: g,
      files: readdirSync(path.join(FOLDER, g)).map((f) => {
        const st = statSync(path.join(FOLDER, g, f));
        return { rel: `${g}/${f}`, name: f, ext: f.slice(f.lastIndexOf('.') + 1).toLowerCase(), size: st.size, modified: Date.now() - 86400000 };
      }),
    }));
    H = await startHarness({ projectFiles: { folder: FOLDER, exists: true, groups, total: 5, more: 0 } });
    const { rmSync } = await import('node:fs');
    H.folderCleanup = () => rmSync(FOLDER, { recursive: true, force: true });
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    // Vault notes (the folder files live above, outside the vault).
    const para = 'The shop was quiet on Tuesday morning, so there was time to go through the October invoices line by line and check each total against the bank feed before June arrived with the bookkeeping folder.';
    const long = Array.from({ length: 14 }, (_, i) => `## Part ${i + 1}\n\n${para} ${para}\n`).join('\n');
    w('People/Alex Chen.md', `---\ntype: person\nrole: Shop developer\n---\n# Alex Chen\n\nShop developer. Runs [[Harbourline Cart Fix]] most weeks.\n\n${long}\n`);
    w('People/June Park.md', `---\ntype: person\nrole: Bookkeeper\n---\n# June Park\n\nBookkeeper for the shop. Signs the contracts.\n`);
    w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline Cart Fix\n\n## Summary\n\nThe shop's cart drops about one order in forty at payment. Fix the retry, then the receipt. See the [[Receipts spec]] for what v2 shows. [[Alex Chen]] owns this fix.\n\n## What's next\n\n- [ ] Chase the 2 carts that failed on Friday — Alex Chen — due 2026-11-05\n- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06\n- [ ] Send the receipt v2 for review — Alex Chen — due 2026-11-04\n- [ ] Ring ShadeCo about the awning quote — Alex Chen — due 2026-11-07\n- [ ] Confirm the Saturday soak test window — Sam Ortega — due 2026-11-09\n- [ ] Write the rollback note for the retry fix — Priya Nair — due 2026-11-08\n\n## Key dates\n\n- 2026-11-06: Retry fix live (milestone)\n- 2026-11-20: Cart fix done (milestone)\n\n## Decisions\n\n- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)\n\n## Risks\n\n- The card reader fails again on a busy Saturday (owner: Alex Chen, level: high)\n\n## People\n\n- Alex Chen (owner)\n- June Park\n\n## Documents\n\n- \`Budget/Shopfit Contract v2.pdf\` — Shopfit contract\n  doc_status: signed\n  signed_by: June Park\n  signed_on: 2026-10-03\n  replaces: [[Budget/Shopfit Contract v1.pdf]]\n- \`Budget/Shopfit Contract v1.pdf\` — First version\n\n## Notes\n\nKept for the fix: the retry, then the receipt.\n`);
    w('Projects/Harbourline Cart Fix/Notes/Kickoff note.md', `---\ntype: note\n---\n# Kickoff note\n\nMet with [[Alex Chen]] about the [[Harbourline Cart Fix|cart fix]]. The [[Receipts spec]] design is linked.\n\n${long}\n`);
    w('Docs/The awning decision.md', `---\ntype: doc\nabout: Which awning the shop buys, and why.\n---\n# The awning decision\n\nShadeCo quoted twelve hundred dollars fitted; see [[Harbourline Cart Fix]] for why it matters. [[Alex Chen]] rings them before Friday.\n\n${long}\n`);
    w('Docs/Receipts spec.md', `---\ntype: note\n---\n# Receipts spec\n\nThe receipt shows every line including tax. Linked from the [[Harbourline Cart Fix]] summary and the kickoff.\n\n${long}\n`);
    w('Docs/Shopfit Contract v1.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: sent\n---\n# Shopfit Contract v1\n\nFirst version of the shopfit contract, sent to June.\n`);
    w('Docs/Shopfit Contract v2.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: signed\nsigned_by: June Park\nsigned_on: 2026-10-03\nreplaces: "[[Docs/Shopfit Contract v1]]"\n---\n# Shopfit Contract v2\n\nSigned version of the shopfit contract.\n`);
    w('Meetings/2026-11-03 Cart standup.md', `---\ntype: meeting\ndate: 2026-11-03\nattendees: [Alex Chen, Priya Nair, Sam Ortega]\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\n---\n# 2026-11-03 Cart standup\n\n## Agenda\n\n- The retry fix and the Friday release\n- [[June Park]] sends the October totals\n\n## Actions\n\n- [ ] Retry the failed payment twice — Priya Nair — due 2026-11-06\n- [x] Book the room for next Tuesday — Alex Chen\n\n## Decisions\n\n- Retry twice, then fail loud\n`);
    w('Inbox.md', `# Inbox\n\n- [ ] Call the bank about the card reader that failed twice on Saturday morning\n`);
    w('Inbox/Bank email about the card reader.md', `# Bank email about the card reader\n\nThe bank wants the till logs before they send a technician.\n\n${long}\n`);
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

// ── Real input and measures ─────────────────────────────────────────────────

const SCROLL_JS = `(() => {
  const root = document.querySelector('main');
  const own = root?.querySelector('.vscroll');
  if (own) return own.scrollTop;
  let best = null, bestH = 0;
  for (const el of root.querySelectorAll('div, main, section')) {
    const h = el.scrollHeight - el.clientHeight;
    if (h > bestH) { bestH = h; best = el; }
  }
  return best ? best.scrollTop : 0;
})()`;
const SET_SCROLL_JS = (y) => `(() => {
  const root = document.querySelector('main');
  const own = root?.querySelector('.vscroll');
  if (own) { own.scrollTop = ${y}; return own.scrollTop; }
  let best = null, bestH = 0;
  for (const el of root.querySelectorAll('div, main, section')) {
    const h = el.scrollHeight - el.clientHeight;
    if (h > bestH) { bestH = h; best = el; }
  }
  if (best) best.scrollTop = ${y};
  return best ? best.scrollTop : 0;
})()`;

/** The real mouse on an element found by JS (scrolls only when asked: the Back proof positions first). The
 *  middle fragment, where its text is (the sweep's lesson): a wrapped inline control's box centre can fall
 *  between its line fragments and hit whatever sits there instead. Measured twice: late content moves the
 *  page under a stale point, so the press goes to a fresh one. */
async function tap(h, js, { ctrl = false, middle = false, dbl = false, scroll = true } = {}) {
  const point = (move) => {
    const scrollJs = move ? 'el.scrollIntoView({ block: "center" });' : '';
    return h.browser.ev(`(() => {
      const el = (${js});
      if (!el) return null;
      ${scrollJs}
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) return null;
      const rs = el.getClientRects();
      const rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r;
      return { x: Math.min(rr.x + rr.width / 2, window.innerWidth - 2), y: Math.min(rr.y + rr.height / 2, window.innerHeight - 2) };
    })()`);
  };
  const p = await point(scroll);
  assert.ok(p, `visible: ${js.slice(0, 140)}`);
  const modifiers = ctrl ? 2 : 0;
  const button = middle ? 'middle' : 'left';
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), modifiers });
  await sleep(150);
  const q = await point(false);
  assert.ok(q, `steady: ${js.slice(0, 140)}`);
  const x = Math.round(q.x), y = Math.round(q.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  for (const n of dbl ? [1, 2] : [1]) {
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: n, modifiers });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: n, modifiers });
    if (dbl) await sleep(80);
  }
  // Parked top-left, as a person's hand moves on: nothing hoverable lives there.
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10, modifiers: 0 });
  await sleep(600);
}

async function shot(h, name) {
  mkdirSync(shotsDir, { recursive: true });
  const pic = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  if (pic.result?.data) writeFileSync(path.join(shotsDir, name), Buffer.from(pic.result.data, 'base64'));
}

const titleNow = (h) => h.browser.ev(`document.title`);
const noPeek = (h) => h.browser.ev(`!document.querySelector('.peek')`);
const tabCount = (h) => h.browser.ev(`document.querySelectorAll('.tab-close').length`);

/** Run a palette command by name. */
async function runCommand(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const done = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '') === ${JSON.stringify(name)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `the palette runs ${name}`);
  await sleep(800);
}

/** Tabs on (off by default): Ctrl and middle click need them to open beside. */
async function tabsOn(h) {
  if ((await tabCount(h)) > 0) return;
  await runCommand(h, 'Show or hide tabs');
  assert.ok((await tabCount(h)) > 0, 'tabs show along the top');
}

/** Open a note by name through the quick switcher (Ctrl+K). */
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

/** One of the project page's own tabs (t255: the section bar became real tabs). */
async function openTab(h, id) {
  await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(900);
}

/** The side bar back to its home list (a panel left open hides the room rows). */
async function sidebarHome(h) {
  if ((await h.browser.ev(`!!document.querySelector('.sidebar.left .side-title-back')`)) === true) {
    await h.browser.ev(`document.querySelector('.sidebar.left .side-title-back').click()`);
    await sleep(500);
  }
}

/** Switch the open note to Reading (links there are real links): Ctrl+E, the header's own key. */
async function readMode(h) {
  const live = await h.browser.ev(`!!document.querySelector('main .note-view.mode-live, main .note-view.mode-source')`);
  if (!live) return;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', modifiers: 2, windowsVirtualKeyCode: 69 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', modifiers: 2, windowsVirtualKeyCode: 69 });
  await sleep(800);
}

/**
 * One reference clicked: the document opens in the main view with its title at the top, no side panel opens,
 * and Back returns to where the person was, scrolled where they were.
 */
/** Scroll a target into view and read where the page stands (the Back proof compares against this). Waits:
 *  the project page streams its tail in one section at a time. */
async function place(h, js, title) {
  assert.ok(await waitFor(h, `!!(${js})`, 10000), `placed: ${js.slice(0, 120)}`);
  await h.browser.ev(`(() => { const el = (${js}); el?.scrollIntoView({ block: 'center' }); })()`);
  await sleep(400);
  return { title, scroll: await h.browser.ev(SCROLL_JS) };
}

/** The scroll settled (Back holds the position while late content lands, then it stands still). */
async function settledScroll(h, ms = 6000) {
  const t0 = Date.now();
  let last = -1, steady = 0, cur = 0;
  for (;;) {
    cur = await h.browser.ev(SCROLL_JS);
    if (Math.abs(cur - last) <= 4) {
      steady += 250;
      if (steady >= 750) return cur;
    } else steady = 0;
    last = cur;
    if (Date.now() - t0 > ms) return cur;
    await sleep(250);
  }
}

async function runCase(h, c, tag) {
  await esc(h);
  const before = await c.start(h);
  if (!before.done) await tap(h, c.click, { ...(c.tap ?? {}), scroll: false });
  await sleep(600);
  assert.ok(await noPeek(h), `${c.id}: no side panel opens`);
  assert.ok(await h.browser.ev(`!document.querySelector('.hover-card')`), `${c.id}: no hover card covers the new page`);
  const title = await titleNow(h);
  assert.ok(title.includes(c.expect), `${c.id}: the main view shows ${c.expect} (saw ${title})`);
  if (c.marker) assert.ok(await waitFor(h, c.marker, 8000), `${c.id}: its title reads at the top`);
  const top = await h.browser.ev(SCROLL_JS);
  assert.ok(top < 60, `${c.id}: opens at the top (saw ${top}px)`);
  await shot(h, `${c.id}-${tag}.png`);
  await tap(h, `document.querySelector('button[aria-label="Back"]')`);
  await sleep(400);
  const back = await titleNow(h);
  assert.ok(back.includes(before.title), `${c.id}: Back returns to ${before.title} (saw ${back})`);
  const again = await settledScroll(h);
  assert.ok(Math.abs(again - before.scroll) < 80, `${c.id}: Back restores the scroll (was ${before.scroll}, now ${again})`);
  // t255: Back restores the page tab too, not just the page.
  if (c.backTab) assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), c.backTab, `${c.id}: Back restores the ${c.backTab} tab`);
}

// ── The twenty references ───────────────────────────────────────────────────
// 23 Nov 2026: from about a 1920 window the project Overview carries Notes and files as a pane of its own
// (round 3), kept mounted and hidden under the other tabs, so a bare [data-section="notes"] found that hidden
// copy first. The rows below are the Notes and files tab's own (#pj-panel-notes), the one a person clicked.

const CLICK = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const LINK_WITH = (words) => `[...document.querySelectorAll('main .reading-body a')].find((a) => (a.innerText || '').includes(${JSON.stringify(words)}))`;

const CASES = [
  {
    id: '01-note-link-project', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: LINK_WITH('Harbourline Cart Fix'),
    start: async (h) => {
      await openNote(h, 'The awning decision');
      await readMode(h);
      return place(h, LINK_WITH('Harbourline Cart Fix'), 'The awning decision');
    },
  },
  {
    id: '02-note-link-person', expect: 'Alex Chen',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Alex Chen') ?? [...document.querySelectorAll('main h1')].some((e) => (e.innerText || '').includes('Alex Chen'))`,
    click: LINK_WITH('Alex Chen'),
    start: async (h) => {
      await openNote(h, 'Kickoff note');
      await readMode(h);
      return place(h, LINK_WITH('Alex Chen'), 'Kickoff note');
    },
  },
  {
    id: '03-backlink', expect: 'Kickoff note',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Kickoff note') ?? false`,
    click: `[...document.querySelectorAll('main .foot-item-head')].find((b) => (b.innerText || '').includes('Kickoff note'))`,
    start: async (h) => {
      await openNote(h, 'Receipts spec');
      await readMode(h);
      await h.browser.ev(`document.querySelector('main .note-foot-wrap')?.scrollIntoView({ block: 'center' })`);
      await sleep(400);
      return place(h, `[...document.querySelectorAll('main .foot-item-head')].find((b) => (b.innerText || '').includes('Kickoff note'))`, 'Receipts spec');
    },
  },
  {
    id: '04-search-result', expect: 'The awning decision',
    marker: `document.querySelector('main .inline-title')?.value?.includes('The awning decision') ?? [...document.querySelectorAll('main h1')].some((e) => (e.innerText || '').includes('The awning decision'))`,
    click: `[...document.querySelectorAll('.smodal .sas-rowhead')].find((b) => (b.innerText || '').toLowerCase().includes('awning decision'))`,
    start: async (h) => {
      await openRoom(h, 'Today');
      await sleep(500);
      await esc(h);
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
      await h.browser.send('Input.insertText', { text: 'Search inside notes' });
      await sleep(900);
      await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Search inside notes'))?.click()`);
      await sleep(800);
      await h.browser.send('Input.insertText', { text: 'awning quote fitted' });
      await sleep(1800);
      assert.ok(await waitFor(h, `!!document.querySelector('.smodal .sas-rowhead')`, 8000), 'results show');
      return { title: 'Today', scroll: await h.browser.ev(SCROLL_JS) };
    },
  },
  {
    id: '05-task-source', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `[...document.querySelectorAll('main [title^="Open " i]')].find((b) => (b.getAttribute('title') || '').includes('Harbourline Cart Fix'))`,
    start: async (h) => {
      await openRoom(h, 'Tasks');
      assert.equal(await clickWords(h, 'Everyone', 'main'), 'CLICKED', 'everyone shows');
      await sleep(800);
      return place(h, `[...document.querySelectorAll('main [title^="Open " i]')].find((b) => (b.getAttribute('title') || '').includes('Harbourline Cart Fix'))`, 'Tasks');
    },
  },
  {
    id: '06-today-project', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `[...document.querySelectorAll('main .td-row .td-project')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`,
    start: async (h) => {
      await openRoom(h, 'Today');
      await sleep(1000);
      assert.ok(await waitFor(h, `!![...document.querySelectorAll('main .td-row .td-project')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`, 8000), 'today names the project');
      return place(h, `[...document.querySelectorAll('main .td-row .td-project')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`, 'Today');
    },
  },
  {
    id: '07-meeting-row', expect: 'Cart standup', backTab: 'notes',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Cart standup') ?? false`,
    click: `document.querySelector('#pj-panel-notes [data-section="notes"] [data-meeting] button.t[title*="standup"]')`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'notes');
      return place(h, `document.querySelector('#pj-panel-notes [data-section="notes"] [data-meeting] button.t[title*="standup"]')`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '08-person-row', expect: 'Alex Chen', backTab: 'people',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Alex Chen') ?? false`,
    click: `document.querySelector('[data-section="people"] [data-person="Alex Chen (owner)"] button.t')`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'people');
      return place(h, `document.querySelector('[data-section="people"] [data-person="Alex Chen (owner)"] button.t')`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '09-person-project', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `[...document.querySelectorAll('main .page-links-row')].find((b) => (b.innerText || '').includes('Harbourline'))`,
    start: async (h) => {
      await openNote(h, 'Alex Chen');
      await sleep(800);
      assert.ok(await waitFor(h, `!![...document.querySelectorAll('main .page-links-row')].find((b) => (b.innerText || '').includes('Harbourline'))`, 8000), 'the person names the project');
      return place(h, `[...document.querySelectorAll('main .page-links-row')].find((b) => (b.innerText || '').includes('Harbourline'))`, 'Alex Chen');
    },
  },
  {
    id: '10-file-row', expect: 'totals.xlsx', backTab: 'notes',
    marker: `document.querySelector('.folder-file-view h1')?.innerText?.includes('totals.xlsx') ?? false`,
    click: `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('totals.xlsx'))`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'notes');
      await tap(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .chip')].find((b) => (b.textContent || '').includes('Files'))`);
      await sleep(500);
      return place(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('totals.xlsx'))`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '11-pdf-row', expect: 'Shopfit Contract v2.pdf', backTab: 'notes',
    marker: `document.querySelector('.folder-file-view h1')?.innerText?.includes('Shopfit Contract v2.pdf') && (document.querySelector('.folder-file-view iframe')?.src ?? '').includes('Shopfit%20Contract%20v2.pdf')`,
    click: `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Shopfit Contract v2.pdf'))`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'notes');
      await tap(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .chip')].find((b) => (b.textContent || '').includes('Files'))`);
      await sleep(500);
      return place(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Shopfit Contract v2.pdf'))`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '12-picture-row', expect: 'shopfront.png', backTab: 'notes',
    marker: `document.querySelector('.folder-file-view h1')?.innerText?.includes('shopfront.png') && (document.querySelector('.folder-file-view img')?.src ?? '').includes('shopfront.png')`,
    click: `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('shopfront.png'))`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'notes');
      await tap(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .chip')].find((b) => (b.textContent || '').includes('Files'))`);
      await sleep(500);
      return place(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('shopfront.png'))`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '13-inbox-item', expect: 'Bank email about the card reader',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Bank email') ?? false`,
    click: `[...document.querySelectorAll('main [aria-label="Open it"]')][0]`,
    start: async (h) => {
      await openRoom(h, 'Inbox');
      await sleep(1000);
      assert.ok(await waitFor(h, `!!document.querySelector('main [aria-label="Open it"]')`, 8000), 'inbox items show');
      return place(h, `[...document.querySelectorAll('main [aria-label="Open it"]')][0]`, 'Inbox');
    },
  },
  {
    id: '14-graph-node', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: '__graph__',
    tap: { dbl: true },
    start: async (h) => {
      await openRoom(h, 'Graph');
      assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 5`, 60000), 'the vault draws');
      await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().framed`, 60000);
      await sleep(1500);
      const at = { title: 'Graph', scroll: await h.browser.ev(SCROLL_JS) };
      // The project's node, double-clicked with the real mouse.
      const pt = await h.browser.ev(`(() => {
        const s = window.__nvBrainGraph.snapshot();
        const n = s.nodes.find((x) => x.id === 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md') ?? s.nodes.find((x) => (x.title || '').includes('Harbourline'));
        if (!n) return null;
        const cv = document.querySelector('.graph-view canvas, .nj-graph canvas, main canvas');
        if (!cv) return null;
        const r = cv.getBoundingClientRect();
        return { x: r.x + n.x, y: r.y + n.y };
      })()`);
      assert.ok(pt, 'the project draws as a node');
      const x = Math.round(pt.x), y = Math.round(pt.y);
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await sleep(150);
      for (const n of [1, 2]) {
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
        await sleep(80);
      }
      await sleep(600);
      return { ...at, done: true };
    },
  },
  {
    id: '15-sidebar-file', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `[...document.querySelectorAll('.sidebar.left .nav-row.nav-project')].find((b) => (b.textContent || '').includes('Harbourline Cart Fix'))`,
    start: async (h) => {
      await openRoom(h, 'Today');
      await sleep(500);
      await esc(h);
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
      await h.browser.send('Input.insertText', { text: 'Show your files' });
      await sleep(900);
      await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Show your files'))?.click()`);
      await sleep(1200);
      assert.ok(await waitFor(h, `!![...document.querySelectorAll('.sidebar.left .nav-row.nav-project')].find((b) => (b.textContent || '').includes('Harbourline Cart Fix'))`, 8000), 'the sidebar lists the project');
      await h.browser.ev(`[...document.querySelectorAll('.sidebar.left .nav-row.nav-project')].find((b) => (b.textContent || '').includes('Harbourline Cart Fix'))?.scrollIntoView({ block: 'nearest' })`);
      await sleep(400);
      return { title: 'Today', scroll: await h.browser.ev(SCROLL_JS) };
    },
  },
  {
    id: '16-foot-connected', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `[...document.querySelectorAll('main .note-foot-wrap .peek-row')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`,
    start: async (h) => {
      await openNote(h, 'Kickoff note');
      await readMode(h);
      await h.browser.ev(`document.querySelector('main .note-foot-wrap')?.scrollIntoView({ block: 'center' })`);
      await sleep(600);
      assert.ok(await waitFor(h, `!![...document.querySelectorAll('main .note-foot-wrap .peek-row')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`, 8000), 'connected rows show');
      return place(h, `[...document.querySelectorAll('main .note-foot-wrap .peek-row')].find((b) => (b.innerText || '').includes('Harbourline Cart Fix'))`, 'Kickoff note');
    },
  },
  {
    id: '17-person-page', expect: 'Harbourline Cart Fix', backTab: 'projects',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `document.querySelector('main .trow.w2b-row[title*="Harbourline"]')`,
    start: async (h) => {
      await sidebarHome(h);
      await openRoom(h, 'People');
      await sleep(1000);
      assert.ok(await waitFor(h, `!!document.querySelector('main button.trow.w2b-row[title*="Alex Chen"]')`, 10000), 'the people list shows Alex Chen');
      await tap(h, `document.querySelector('main button.trow.w2b-row[title*="Alex Chen"]')`);
      await sleep(1000);
      // t255: the person page reads through tabs; the project list stands on the Projects tab (the
      // page keeps the room's title, so Back lands on People with the tab restored).
      await h.browser.ev(`document.querySelector('.w2b-person [data-tab="projects"]')?.click()`);
      await sleep(900);
      assert.ok(await waitFor(h, `!!document.querySelector('main .trow.w2b-row[title*="Harbourline"]')`, 8000), 'the person page lists the project');
      return place(h, `document.querySelector('main .trow.w2b-row[title*="Harbourline"]')`, 'People');
    },
  },
  {
    id: '18-doc-version', expect: 'Shopfit Contract v2', backTab: 'notes',
    marker: `document.querySelector('main .inline-title')?.value?.includes('Shopfit Contract v2') ?? false`,
    click: `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Shopfit Contract v2') && !(b.innerText || '').includes('.pdf'))`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await openTab(h, 'notes');
      return place(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Shopfit Contract v2') && !(b.innerText || '').includes('.pdf'))`, 'Harbourline Cart Fix');
    },
  },
  {
    id: '19-meeting-person', expect: 'June Park',
    marker: `document.querySelector('main .inline-title')?.value?.includes('June Park') ?? false`,
    click: `[...document.querySelectorAll('main .page-people-chips .field-link')].find((b) => (b.textContent || '').includes('June Park'))`,
    start: async (h) => {
      await openNote(h, '2026-11-03 Cart standup');
      await sleep(1000);
      assert.ok(await waitFor(h, `!![...document.querySelectorAll('main .page-people-chips .field-link')].find((b) => (b.textContent || '').includes('June Park'))`, 8000), 'the meeting names its people');
      return place(h, `[...document.querySelectorAll('main .page-people-chips .field-link')].find((b) => (b.textContent || '').includes('June Park'))`, 'Cart standup');
    },
  },
  {
    id: '20-hub-tile', expect: 'Harbourline Cart Fix',
    marker: `!![...document.querySelectorAll('main h1')].find((e) => (e.innerText || '').includes('Harbourline Cart Fix'))`,
    click: `document.querySelector('main .ph-row')`,
    start: async (h) => {
      await openNote(h, 'Harbourline Cart Fix');
      await sleep(1500);
      await tap(h, `document.querySelector('main .topbar button[aria-label="More"]')`);
      // Workspace sits in the Project submenu: hover the parent, then take it with the real mouse.
      const sub = await h.browser.ev(`(() => {
        const el = [...document.querySelectorAll('.menu [role="menuitem"], .menu button')].find((e) => (e.innerText || '').trim() === 'Project');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      assert.ok(sub, 'the Project submenu shows');
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(sub.x), y: Math.round(sub.y) });
      await sleep(500);
      await tap(h, `[...document.querySelectorAll('.menu [role="menuitem"], .menu button')].find((e) => (e.innerText || '').trim() === 'Workspace')`);
      await sleep(1500);
      assert.ok(await waitFor(h, `!!document.querySelector('main .ph-row')`, 8000), 'hub rows show');
      return place(h, `document.querySelector('main .ph-row')`, 'Workspace');
    },
  },
];

// ── The walk ──────────────────────────────────────────────────────────────────

async function walk(size) {
  const h = await harness();
  const [W, Hg] = size;
  const tag = `${W}x${Hg}`;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
  // T239_ONLY=01,02 runs a subset while debugging; unset runs all twenty.
  const only = (process.env.T239_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cases = only.length ? CASES.filter((c) => only.some((o) => c.id.startsWith(o))) : CASES;
  assert.ok(cases.length > 0, 'cases selected');
  for (const c of cases) await runCase(h, c, tag);
}

test('twenty references open their documents at 1219x709', { timeout: 900000 }, async () => {
  await walk([1219, 709]);
});

test('twenty references open their documents at 1920x1117', { timeout: 900000 }, async () => {
  await walk([1920, 1117]);
});

test('twenty references open their documents at 3456x1408', { timeout: 900000 }, async () => {
  await walk([3456, 1408]);
});

test('Ctrl+click opens beside: the document in a new tab, Back untouched', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
  await tabsOn(h);
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  await openTab(h, 'notes');
  const tabs = await tabCount(h);
  await tap(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Kickoff note'))`, { ctrl: true });
  await sleep(800);
  assert.equal(await tabCount(h), tabs + 1, 'a new tab opens beside');
  assert.ok((await titleNow(h)).includes('Kickoff note'), 'the new tab shows the document');
  assert.ok(await noPeek(h), 'no side panel opens');
  await shot(h, 'ctrl-click-tab-1219x709.png');
  // Ctrl+W shuts the new tab; the project stands where it was.
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', modifiers: 2, windowsVirtualKeyCode: 87 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', modifiers: 2, windowsVirtualKeyCode: 87 });
  await sleep(800);
  assert.equal(await tabCount(h), tabs, 'the tab shuts again');
});

test('middle-click opens beside where the row offers it', { timeout: 300000 }, async () => {
  const h = await harness();
  await tabsOn(h);
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  await openTab(h, 'notes');
  const tabs = await tabCount(h);
  await tap(h, `[...document.querySelectorAll('#pj-panel-notes [data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Kickoff note'))`, { middle: true });
  await sleep(800);
  assert.equal(await tabCount(h), tabs + 1, 'a new tab opens beside');
  assert.ok((await titleNow(h)).includes('Kickoff note'), 'the new tab shows the document');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', modifiers: 2, windowsVirtualKeyCode: 87 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', modifiers: 2, windowsVirtualKeyCode: 87 });
  await sleep(800);
});

test('the right side stays the place to ask: a click never lands a document there', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Kickoff note');
  await readMode(h);
  if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === false) {
    assert.equal(await clickWords(h, 'Show the right side'), 'CLICKED', 'the right side opens');
    await sleep(1000);
  }
  assert.ok(await h.browser.ev(`!!document.querySelector('.sidebar.right [data-stack="chat"]')`), 'chat stands on the right');
  await tap(h, LINK_WITH('Alex Chen'));
  await sleep(800);
  assert.ok((await titleNow(h)).includes('Alex Chen'), 'the document opens in the main view');
  assert.ok(await h.browser.ev(`!!document.querySelector('.sidebar.right [data-stack="chat"]')`), 'chat still stands on the right');
  assert.ok(await noPeek(h), 'no side panel opens');
  await shot(h, 'right-stays-chat-1219x709.png');
});

test('a person without a page says so, with a way to make one — never a guessed page', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, '2026-11-03 Cart standup');
  await sleep(1000);
  // Sam Ortega is known to the vault (they attend) but keeps no People note.
  await tap(h, `[...document.querySelectorAll('main .note-foot-wrap .peek-row.kind-person')].find((b) => (b.textContent || '').includes('Sam Ortega'))`);
  await sleep(800);
  assert.ok(await noPeek(h), 'no side panel opens');
  const toast = await h.browser.ev(`document.querySelector('.toast')?.innerText ?? ''`);
  assert.ok(toast.includes('Sam Ortega') && toast.includes('has no page yet'), `plain words, not a guess (saw ${toast})`);
  assert.ok(toast.includes('Make one'), 'a way to make one stands beside it');
  assert.ok((await titleNow(h)).includes('Cart standup'), 'the person stays where they were');
  await shot(h, 'person-without-page-1219x709.png');
  await h.browser.ev(`document.querySelector('.toast-close')?.click()`);
  await sleep(300);
  await esc(h);
});
