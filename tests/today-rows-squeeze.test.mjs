// node --test tests/today-rows-squeeze.test.mjs — Today rows keep their words in a narrow
// middle (5 Nov 2026 window audit at 1219x800 with the chat docked: "Next for you" titles
// crushed to "P…" — the grid's fixed 148+170px who/when tracks never yielded, because Today
// was never enrolled in the shared .tklist squeeze container plan.css provides for every task
// list. The fix enrolls Today's column (one class); the shared rule does the rest, so Today
// narrows exactly like Tasks. Each check fails without the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("today's column is enrolled in the shared task-list squeeze", () => {
  const view = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(view.includes('<div className="td-inner tklist">'), 'td-inner carries tklist, so the shared squeeze reaches every Today row');
  const plan = read('src/renderer/src/styles/plan.css');
  const squeeze = plan.match(/@container tklist \(max-width: 640px\) \{([\s\S]*?)\n\}/)?.[1] ?? assert.fail('no tklist squeeze rule');
  assert.ok(squeeze.includes('--who-w: 30px') && squeeze.includes('--when-w: 118px'), 'squeezed lists narrow who and when instead of the title');
  assert.ok(squeeze.includes('.tkrow-name') && squeeze.includes('display: none'), 'squeezed rows keep the avatar, not the name');
});

test('a narrow middle keeps the titles readable (1219x800, chat docked)', { timeout: 420000 }, async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness();
  try {
    const clickWords = (words, scope = '') =>
      h.browser.ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
        const els = [...root.querySelectorAll('button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary')].filter(vis);
        const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
        if (!el) return 'NOTFOUND';
        el.scrollIntoView({ block: 'nearest' });
        el.click();
        await new Promise((r) => setTimeout(r, 400));
        return 'CLICKED';
      })()`);
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    assert.equal(await clickWords('Show the right side'), 'CLICKED', 'the right side opens');
    await sleep(600);
    // t7-note-window (8 Nov 2026): the right side stacks chat first, not a tab — opening the side docks it.
    const chatDocked = await h.browser.ev(`!!document.querySelector('.sidebar.right .chat')`);
    assert.equal(chatDocked, true, 'the chat docks with the right side');
    await sleep(1500);
    const m = await h.browser.ev(`(() => {
      const row = document.querySelector('.td-next .td-row.tkrow, [data-section="next"] .td-row.tkrow');
      if (!row) return { error: 'no Next for you row' };
      const title = row.querySelector('.td-row-what .td-text');
      const name = row.querySelector('.tkrow-name');
      const who = row.querySelector('.tkrow-who');
      const col = document.querySelector('.td-inner');
      return {
        colW: col ? Math.round(col.getBoundingClientRect().width) : null,
        titleW: title ? Math.round(title.getBoundingClientRect().width) : null,
        titleWords: title ? (title.innerText || '').replace(/\\s+/g, ' ').slice(0, 60) : null,
        nameShown: name ? getComputedStyle(name).display !== 'none' : null,
        whoW: who ? Math.round(who.getBoundingClientRect().width) : null,
      };
    })()`);
    assert.ok(!m.error, m.error ?? '');
    assert.ok(m.colW !== null && m.colW < 640, `the docked chat narrows the middle under the squeeze (${m.colW}px)`);
    assert.equal(m.nameShown, false, 'squeezed: who keeps the avatar, not the name');
    assert.ok(m.whoW !== null && m.whoW <= 44, `squeezed: the who track narrows (${m.whoW}px)`);
    assert.ok(m.titleW !== null && m.titleW >= 120, `the title keeps readable words, not "P…" (${m.titleW}px: ${m.titleWords})`);
  } finally {
    await h.close();
  }
});

test('a wide middle keeps the full who and when columns', { timeout: 420000 }, async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness();
  try {
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const m = await h.browser.ev(`(() => {
      const row = document.querySelector('.td-next .td-row.tkrow, [data-section="next"] .td-row.tkrow');
      if (!row) return { error: 'no Next for you row' };
      const name = row.querySelector('.tkrow-name');
      const who = row.querySelector('.tkrow-who');
      return {
        nameShown: name ? getComputedStyle(name).display !== 'none' : null,
        whoW: who ? Math.round(who.getBoundingClientRect().width) : null,
      };
    })()`);
    assert.ok(!m.error, m.error ?? '');
    assert.equal(m.nameShown, true, 'wide: the first name still shows');
    assert.ok(m.whoW !== null && m.whoW > 100, `wide: the who column keeps its width (${m.whoW}px)`);
  } finally {
    await h.close();
  }
});
