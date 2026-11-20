// node --test tests/a5-reading-reveal.test.mjs — a5 (6 Nov 2026): a link to a
// named section goes there from every door, in Reading as in the editor.
// Before: takeReveal was consumed only by the editor, MediaView and PdfView, so
// a heading link opened while reading (the tab keeps its mode) landed at the
// top: [[Sections note#Beta section]] left Beta 567 px down the page at
// scrollTop 0. Reading now takes its reveal like the editor does. Each check
// fails without the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the mechanism ────────────────────────────────────────────────────
test('reading takes its reveal like the editor does', () => {
  const src = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(src.includes('takeReveal'), 'NoteView takes a pending reveal');
  assert.ok(src.includes('onReveal'), 'NoteView hears a reveal asked for the open note');
});

// ── Live: a heading link from Reading lands at its section ───────────────────
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    const put = (rel, text) => H.services.vault.createText(rel, text).catch(() => {});
    await put('Notes/Sections note.md', `---\ntype: note\n---\n# Sections note\n\n${'Intro filler. '.repeat(60)}\n\n## Alpha section\n\n${'Alpha filler. '.repeat(60)}\n\n## Beta section\n\n${'Beta filler. '.repeat(60)}\n\n## Gamma section\n\n${'Gamma filler. '.repeat(60)}\n`);
    await put('Notes/Section links.md', `---\ntype: note\n---\n# Section links\n\nTo beta: [[Sections note#Beta section|beta]].\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try { if (await H.browser.ev(`!!document.querySelector('.app')`)) break; } catch {}
    }
    await sleep(2200);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });

test('a heading link from Reading lands at its section', { timeout: 300000 }, async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  // Open the links note through the palette, as a person would.
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 75, key: 'k', code: 'KeyK', modifiers: 2 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 75, key: 'k', code: 'KeyK', modifiers: 2 });
  await sleep(1000);
  assert.equal(await ev(`document.querySelector('.picker input')?.getAttribute('placeholder') ?? 'NO'`), 'Ask or find anything…', 'the palette opens');
  await h.browser.send('Input.insertText', { text: 'section links' });
  await sleep(1200);
  assert.equal(await ev(`(async () => {
    const el = [...document.querySelectorAll('.picker-row')].find((e) => e.innerText.includes('Section links'));
    if (!el) return 'NOROW';
    el.click(); await new Promise((r) => setTimeout(r, 900)); return 'CLICKED';
  })()`), 'CLICKED', 'the links note opens');
  await sleep(1400);
  // Read it, then follow the heading link.
  await ev(`(() => { const b = [...document.querySelectorAll('.topbar button, .view-header button')].find((e) => (e.title || '').includes('Read (Ctrl+E)')); if (b) b.click(); return !!b; })()`);
  await sleep(1300);
  assert.equal(await ev(`(async () => {
    const el = [...document.querySelectorAll('main a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }).find((e) => e.innerText.includes('beta'));
    if (!el) return 'NOLINK';
    el.scrollIntoView({ block: 'center' }); el.click();
    await new Promise((r) => setTimeout(r, 1400)); return 'CLICKED';
  })()`), 'CLICKED', 'the heading link is followed');
  await sleep(1800);
  const m = await ev(`(() => {
    const main = document.querySelector('main');
    const all = [...main.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
    all.sort((a, b) => (b.clientHeight * b.clientWidth) - (a.clientHeight * a.clientWidth));
    const beta = [...(all[0] || main).querySelectorAll('h1, h2, h3')].find((e) => /Beta section/.test(e.innerText));
    const br = beta ? beta.getBoundingClientRect() : null;
    return { crumbPath: document.querySelector('.crumb')?.getAttribute('title') ?? null, scroll: all[0] ? Math.round(all[0].scrollTop) : -1, betaTop: br ? Math.round(br.top) : null };
  })()`);
  // t7-note-window (8 Nov 2026): the bar keeps the folders and the title below keeps the name, never twice —
  // the crumb's words no longer name the note, so the landing reads its path, which the bar still carries.
  assert.ok((m.crumbPath || '').includes('Sections note'), `lands on the sections note (saw ${m.crumbPath})`);
  assert.ok(m.betaTop !== null && m.betaTop < 300, `the Beta heading is at the top, not 567 px down (top ${m.betaTop}, scroll ${m.scroll})`);
});
