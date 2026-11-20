// node --test tests/a2-vault-rest.test.mjs — the rest of the Vault opens and displays (6 Nov 2026 audit):
// a pack's first-run page stands in the pack frame like its neighbours (title, lead, menu), and opening a page
// never jumps focus into a field. Fails without the Publications frame (bare form, no h1) and with autoFocus
// (the Name field takes focus on open, ringing itself red before a word is typed).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { publications: { on: true } } } }]);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 450));
    return 'CLICKED';
  })()`);
}
async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

test('a first-run pack page stands in the pack frame, and focus stays put', { timeout: 600000 }, async () => {
  const h = await harness();
  // t10 the quiet More (8 Nov 2026): packs left More for Ctrl+K, each by its own name.
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette opens');
  await h.browser.send('Input.insertText', { text: 'Publications' });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === 'Publications' && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === 'Publications');
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', 'Publications opens from the palette');
  assert.ok(await waitFor(h, `!!document.querySelector('main .pb-start, main h1')`), 'the first-run page lands');
  await sleep(1200);
  const m = await h.browser.ev(`(() => {
    const h1 = document.querySelector('main h1');
    const ae = document.activeElement;
    return {
      h1: h1 ? h1.innerText.replace(/\\s+/g, ' ').slice(0, 40) : null,
      form: !!document.querySelector('main form.pb-start'),
      menu: !!document.querySelector('main [aria-label^="More for"]'),
      focused: ae ? (ae.tagName + '#' + (ae.className || '').toString().slice(0, 30)) : null,
    };
  })()`);
  assert.match(m.h1 ?? '', /Publications/, `the page is titled (stood ${JSON.stringify(m.h1)})`);
  assert.equal(m.form, true, 'the start form is still there, inside the frame');
  assert.equal(m.menu, true, 'the pack menu (tour, settings) is on the page');
  assert.ok(m.focused === 'BODY#' || m.focused === 'BODY#', `focus stays put on open (jumped to ${m.focused})`);
});
