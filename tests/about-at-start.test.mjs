// node --test tests/about-at-start.test.mjs — About asked for while Ironleaf starts (the tray's "Check for updates" after
// a hidden start, the Help menu) is still there once the notes and the saved layout have loaded, and after the
// vault:opened reload that can follow: the request used to land first and be replaced by the last page.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { SHELL, startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skip = existsSync(SHELL) ? false : 'no headless Chromium here';
let H;
before(async () => {
  if (!skip) H = await startHarness();
});
after(async () => H?.close());

/** Loads the window again with window.nvUpdate there, the settings and the saved layout slow, and vault:opened in hand. */
async function start({ waiting, settingsMs = 0, layoutMs = 0 }) {
  if (start.id) await H.browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: start.id });
  const source = `(() => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let pending = ${JSON.stringify(waiting ?? null)};
    const t = window.__t = { open: null, opened: [] };
    const idle = { enabled: true, autoDownload: true, stage: 'idle', available: null, updated: null, failed: null, checkedAt: null, error: null, progress: null };
    window.nvUpdate = new Proxy({
      state: async () => idle, check: async () => idle, versions: async () => null,
      about: async () => ({ version: '1.2.3', packaged: true, platform: 'linux', historyPage: 'https://example.invalid/' }),
      takeOpen: async () => { const p = pending; pending = null; return p; },
      onOpen: (cb) => ((t.open = cb), () => {}), onChange: () => () => {},
    }, { get: (o, k) => o[k] ?? (async () => idle) });
    const slow = (fn, ms) => new Proxy(fn, { apply: async (f, _t, a) => { await wait(ms); return f(...a); } });
    let nv;
    Object.defineProperty(window, 'nv', { configurable: true, get: () => nv, set: (real) => {
      const over = (o, extra) => new Proxy(o, { get: (x, k) => (k in extra ? extra[k] : x[k]), apply: (x, _t, a) => x(...a) });
      nv = over(real, {
        state: over(real.state, { load: async (name, ...a) => { if (name === 'workspace') await wait(${layoutMs}); return real.state.load(name, ...a); } }),
        settings: over(real.settings, { get: slow(real.settings.get, ${settingsMs}) }),
        on: over(real.on, { vaultOpened: (cb) => (t.opened.push(cb), () => {}) }),
        vault: real.vault,
      });
    } });
  })();`;
  start.id = (await H.browser.send('Page.addScriptToEvaluateOnNewDocument', { source })).result.identifier;
  await H.freshView();
}
const tabs = () => H.browser.ev(`document.querySelector('.main')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
async function aboutShows() {
  for (let i = 0; i < 30; i++) {
    if (/Version history/i.test(await tabs())) return true;
    await sleep(200);
  }
  return false;
}

test('asked for before the window was there: About is the page once everything has loaded', { skip, timeout: 240000 }, async () => {
  await start({ waiting: null });
  assert.equal(/Version history/i.test(await tabs()), false, 'not there by itself');
  for (const slow of [{}, { layoutMs: 900 }, { settingsMs: 600, layoutMs: 900 }]) {
    await start({ waiting: { check: false, focus: 'status' }, ...slow });
    await sleep(1500);
    assert.equal(await aboutShows(), true, `About shows (${JSON.stringify(slow)})`);
  }
});

test('asked for just before the notes are opened again: About stays', { skip, timeout: 240000 }, async () => {
  await start({ waiting: null });
  await H.browser.ev(`window.__t.open({ check: false, focus: 'status' })`);
  assert.equal(await aboutShows(), true, 'with nothing loading, at once');
  await start({ waiting: null });
  await H.browser.ev(`(async () => {
    window.__t.open({ check: false, focus: 'status' });
    await new Promise((r) => setTimeout(r, 100));
    const info = await window.nv.vault.current();
    for (const cb of window.__t.opened) cb(info);
  })()`);
  await sleep(2000);
  assert.equal(await aboutShows(), true, 'the reload keeps the page just opened');
});
