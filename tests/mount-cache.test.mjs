// node --test tests/mount-cache.test.mjs — warm opens re-read nothing (t146, 9 Nov 2026).
// Every Tasks open re-read all tasks over the bridge, and every note open re-read its words, for
// identical rows; the switches sat thin against their budgets. A warm open serves the kept answer when
// nothing changed (the same revision, folder and day for tasks; the same revision for a note's words)
// and reads again on anything changed. Made-up vault, the harness's own; bridge call counts, not timing
// (the stub logs every call on window.__nvCalls).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  const h = await startHarness();
  const ev = h.browser.ev;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  assert.ok(await ev(`!!document.querySelector('.app')`), 'the app loads');
  const sideClick = (words) => ev(`(async () => {
    const root = document.querySelector('.sidebar.left');
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
    els.find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)}))).click();
    return 'CLICKED';
  })()`);
  const waitMain = async (js) => {
    const t0 = Date.now();
    for (;;) {
      if (await ev(`(() => { const m = document.querySelector('main'); return !!(m && (${js})); })()`).catch(() => false)) return;
      assert.ok(Date.now() - t0 < 30000, 'the page lands');
      await sleep(150);
    }
  };
  return { h, ev, sideClick, waitMain };
}

test('a warm Tasks open reads no bridge and rows the same rows', { timeout: 300000 }, async () => {
  const { h, ev, sideClick, waitMain } = await boot();
  try {
    const TASKS = `m.querySelectorAll('.tkrow').length > 0`;
    const TODAY = `!!m.querySelector('.td-view')`;
    await ev(`window.__nvCalls.length = 0`);
    assert.equal(await sideClick('Tasks'), 'CLICKED', 'the sidebar reaches Tasks');
    await waitMain(TASKS);
    await sleep(800);
    const first = await ev(`window.__nvCalls.filter((k) => k === 'tasks.view').length`);
    assert.ok(first >= 1, `the cold open reads the bridge (${first})`);
    const rows1 = await ev(`[...document.querySelectorAll('main .tkrow')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
    assert.ok(rows1.length > 0, 'tasks row on the cold open');
    // Away and back: no new read, the same rows in the same order and words.
    await ev(`window.__nvCalls.length = 0`);
    assert.equal(await sideClick('Today'), 'CLICKED', 'the sidebar leaves Tasks');
    await waitMain(TODAY);
    await sleep(400);
    assert.equal(await sideClick('Tasks'), 'CLICKED', 'the sidebar returns to Tasks');
    await waitMain(TASKS);
    await sleep(800);
    assert.equal(await ev(`window.__nvCalls.filter((k) => k === 'tasks.view').length`), 0, 'the warm open reads nothing over the bridge');
    const rows2 = await ev(`[...document.querySelectorAll('main .tkrow')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
    assert.deepEqual(rows2, rows1, 'the same rows, order and words without the re-read');
  } finally {
    await h.close().catch(() => {});
  }
});

test('a warm note open re-reads no words', { timeout: 300000 }, async () => {
  const { h, ev, sideClick, waitMain } = await boot();
  try {
    const openFirst = () => ev(`(() => { [...document.querySelectorAll('main .w2b-row')][0]?.click(); return 1; })()`);
    assert.equal(await sideClick('Notes'), 'CLICKED', 'the sidebar reaches Notes');
    await waitMain(`m.querySelectorAll('.w2b-row').length > 0`);
    await sleep(600);
    await ev(`window.__nvCalls.length = 0`);
    await openFirst();
    await waitMain(`!!m.querySelector('.cm-editor')`);
    await sleep(600);
    const first = await ev(`window.__nvCalls.filter((k) => k === 'notes.open').length`);
    assert.ok(first >= 1, `the cold open reads the note (${first})`);
    const text1 = await ev(`(() => { const el = document.querySelector('.cm-content'); return el ? el.innerText.slice(0, 500) : ''; })()`);
    // Away and back to the same note: no new read, the same words.
    await ev(`window.__nvCalls.length = 0`);
    assert.equal(await sideClick('Notes'), 'CLICKED', 'the sidebar leaves the note');
    await waitMain(`m.querySelectorAll('.w2b-row').length > 0`);
    await sleep(600);
    await openFirst();
    await waitMain(`!!m.querySelector('.cm-editor')`);
    await sleep(600);
    assert.equal(await ev(`window.__nvCalls.filter((k) => k === 'notes.open').length`), 0, 'the warm open re-reads no words');
    const text2 = await ev(`(() => { const el = document.querySelector('.cm-content'); return el ? el.innerText.slice(0, 500) : ''; })()`);
    assert.equal(text2, text1, 'the same words without the re-read');
  } finally {
    await h.close().catch(() => {});
  }
});
