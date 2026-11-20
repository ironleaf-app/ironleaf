// node --test tests/off-pack-offers.test.mjs — h3 (5 Nov 2026): opening a pack that
// is switched off is never silent. The Project page job found "Open Finance" did
// nothing with the Finance pack off; the palette's "Open Meetings" and the tours
// were the same class (state/modules.ts openModule and state/life.ts openOne both
// returned without a word). A pack page asked for now says plainly what is needed
// and offers the one step: a toast with "Switch on <Pack>", which switches it on
// and opens where asked. The project page's Money section instead switches its
// part on where it sits (5 Nov 2026, folio merge: the page is one scrolling page
// now, and "Switch bills on" fills the section in place). Fails first: with the
// pack off, no toast appears and nothing opens; with bills off, the Money section
// stays dead.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    const ev = H.browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
  }
  return H;
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

/** Click the first visible button whose words include `words` (optionally under `scope`). */
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}

async function openProjectMoney(h) {
  assert.equal(await clickWords(h, 'Projects'), 'CLICKED', 'Projects opens');
  assert.ok(await waitFor(h, `document.querySelector('main h1, .main h1')?.innerText?.replace(/\\s+/g, ' ').trim() === 'Projects'`), 'the Projects home lands');
  assert.equal(await clickWords(h, 'Harbourline Cart Fix'), 'CLICKED', 'the Harbourline project opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`), 'the project page lands');
  await sleep(800);
  // t255: bills off reads as the Money tab's quiet panel (t265) — never hidden, never a dead button.
  assert.ok(await waitFor(h, `!!document.querySelector('[data-tab="money"].is-quiet')`), 'Money reads quietly with bills off');
  assert.ok(await waitFor(h, `!document.querySelector('[data-tab="money"] .pt-count')`), 'no badge on the quiet tab');
}

/** Run a palette command by its exact name (Mod+K, type, pick the row). */
async function paletteRun(h, name) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the palette opens from the top bar');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette input shows');
  }
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const lab = [...document.querySelectorAll('.picker-row .picker-label')].find((e) => e.innerText.trim() === ${JSON.stringify(name)});
    if (!lab) return 'NOTFOUND';
    lab.closest('button').click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `the palette lists ${name}`);
  await sleep(600);
}

async function toastWords(h) {
  return h.browser.ev(`document.querySelector('.toast')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
}

async function clickToastAction(h) {
  return h.browser.ev(`(() => { const b = document.querySelector('.toast-action'); if (!b) return false; b.click(); return true; })()`);
}

async function pageErrors(h) {
  return h.browser.ev(`window.__nvErrors.slice(0, 5)`);
}

after(async () => {
  if (H) await H.close().catch(() => {});
  H = null;
});

test('Project Money with bills off reads quietly, and its Add switches on and starts one', async () => {
  // t255: bills off reads as the Money tab's quiet panel (t265) — never a dead button — and one click
  // switches on and opens the first bill.
  const h = await harness();
  await h.freshView();
  await openProjectMoney(h);
  await h.browser.ev(`document.querySelector('[data-tab="money"]')?.click()`);
  assert.ok(await waitFor(h, `(document.querySelector('#pj-panel-money [data-section="money"]')?.innerText ?? '').includes('Bills are off.')`), 'bills off reads quietly');
  await h.browser.ev(`document.querySelector('#pj-panel-money [data-add="money"]')?.click()`);
  assert.ok(await waitFor(h, `[...document.querySelectorAll('h2')].some((e) => (e.innerText || '').includes('New bill'))`, 15000), 'the first bill opens');
  assert.deepEqual(await pageErrors(h), [], 'no page errors');
});

test('palette Open Meetings with the Meetings pack off says so and switches it on', async () => {
  const h = await harness();
  await h.freshView();
  await paletteRun(h, 'Open Meetings');
  assert.ok(await waitFor(h, `!!document.querySelector('.toast')`, 5000), 'something a person can notice happens (a toast)');
  const said = await toastWords(h);
  assert.match(said, /Meetings is switched off/, `it says what is needed (toast: ${JSON.stringify(said).slice(0, 120)})`);
  assert.match(said, /Switch on Meetings/, 'it offers the one step');
  assert.ok(await clickToastAction(h), 'the one step presses');
  assert.ok(await waitFor(h, `(document.querySelector('main h1, .main h1')?.innerText ?? '').includes('Meetings')`), 'Meetings opens after switching on');
  assert.deepEqual(await pageErrors(h), [], 'no page errors');
});

test('palette Show me around Money with the Money pack off says so and switches it on', async () => {
  // The project Money section switched in place (folio merge), so this keeps the
  // openModule door to the same offer covered end to end: the tour command goes
  // through openModule('finance'), which offers instead of opening nothing.
  const h = await harness();
  await h.freshView();
  await paletteRun(h, 'Show me around Money');
  assert.ok(await waitFor(h, `!!document.querySelector('.toast')`, 5000), 'something a person can notice happens (a toast)');
  const said = await toastWords(h);
  assert.match(said, /Money is switched off/, `it says what is needed (toast: ${JSON.stringify(said).slice(0, 120)})`);
  assert.match(said, /Switch on Money/, 'it offers the one step');
  assert.ok(await clickToastAction(h), 'the one step presses');
  assert.ok(await waitFor(h, `(document.querySelector('main h1, .main h1')?.innerText ?? '').includes('Money')`), 'Money opens after switching on');
  assert.deepEqual(await pageErrors(h), [], 'no page errors');
});
