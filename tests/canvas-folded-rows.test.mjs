// node --test tests/canvas-folded-rows.test.mjs — canvas cards pointing at folded Systems notes (the records
// move): the real canvas in the real window opens the record's page from the card's Open button, and double-clicking
// edits on the record's page instead of writing a stub note that would shadow the row. The note file is gone
// (folded); only its row in the list remains, which is the folded state exactly.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    const BASE = 'Home/Systems and Home Lab';
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w('.neuralvault/areas.json', JSON.stringify({ version: 1, areas: [{ id: 'business', name: 'Business', folder: 'Business' }, { id: 'home', name: 'Home', folder: 'Home' }, { id: 'family', name: 'Family', folder: 'Family' }, { id: 'me', name: 'Me', folder: 'Me' }] }));
    w(`${BASE}/Machines.md`, `---\ntype: systems-table\ntable: machines\nversion: 1\n---\n# Machines\n\nOne line per machine. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Role | System | Address | Where it is | Status | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Juniper | Server | Media and backups | Ubuntu 24.04.1 LTS | 192.168.1.40 | Garage rack | Up | 2026-10-23 |  |  |\n`);
    w(`${BASE}/Services.md`, `---\ntype: systems-table\ntable: services\nversion: 1\n---\n# Services\n\nOne line per service. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Runs on | Address | Port | Status | Depends on | Runbook | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| svc | Web app | [[Juniper]] | http://juniper.local:8001 | 8001 | Up |  |  | 2026-10-23 |  |  |\n`);
    // The card points at the folded note's path, which is gone; only the row above remains.
    w('Boards/Map.canvas', JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: `${BASE}/Services/svc.md`, x: 0, y: 0, width: 400, height: 300 }], edges: [] }));
    await H.services.rescanAll();
    await H.services.invoke('settings:update', [{ prefs: { modules: { systems: { on: true } } } }]);
    // Boot again so the page lists what was added.
    const bootBefore = await H.browser.ev(`performance.timeOrigin`).catch(() => 0);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        if ((await H.browser.ev(`performance.timeOrigin`)) !== bootBefore && (await H.browser.ev(`!!document.querySelector('.app')`))) break;
      } catch {}
    }
    await sleep(2500);
  }
  return H;
}
after(async () => {
  if (H) await H.close().catch(() => undefined);
  H = null;
});

async function waitFor(h, js, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await h.browser.ev(js)) return;
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 160)}`);
    await sleep(300);
  }
}

/** Click the visible control whose words include `words`, within `scope` when given. */
async function clickWords(h, words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const root = ${JSON.stringify(scope)} ? document.querySelector(${JSON.stringify(scope)}) ?? document : document;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="menuitem"]')].filter(vis);
    const textOf = (e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').trim());
    const el = els.find((e) => textOf(e) === ${JSON.stringify(words)}) ?? els.find((e) => textOf(e).includes(${JSON.stringify(words)}));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
}

/** Open the canvas from the files tree, expanding folders to it. */
async function openCanvas(h) {
  const filesShowing = await h.browser.ev(`!!document.querySelector('[data-path="Boards/Map.canvas"]')`);
  if (!filesShowing) {
    // t10 the quiet More (8 Nov 2026): the files tree left More for Ctrl+K's Show your files.
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    let opened = false;
    for (let i = 0; i < 16 && !opened; i++) {
      await sleep(250);
      try { opened = await h.browser.ev(`!!document.querySelector('.picker input')`); } catch {}
    }
    if (!opened) await clickWords(h, 'Ask or find anything', '.topbar');
    await waitFor(h, `!!document.querySelector('.picker input')`);
    await h.browser.send('Input.insertText', { text: 'Show your files' });
    await sleep(700);
    const picked = await h.browser.ev(`(() => {
      const rows = [...document.querySelectorAll('.picker-row')];
      const lab = rows.find((r) => (r.querySelector('.picker-label')?.innerText.trim() ?? '') === 'Show your files');
      if (!lab) return 'NOTFOUND';
      lab.click();
      return 'CLICKED';
    })()`);
    assert.equal(picked, 'CLICKED', 'the palette lists Show your files');
    await sleep(600);
  }
  const opened = await h.browser.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 8; i++) {
      const file = document.querySelector('[data-path="Boards/Map.canvas"]');
      if (file && file.getBoundingClientRect().width > 2) {
        file.scrollIntoView({ block: 'nearest' });
        file.click();
        await sleep(800);
        return document.querySelector('.canvas-card') ? 'OPENED' : 'NOTOPEN';
      }
      const shut = [...document.querySelectorAll('[data-path]')].find((g) => /Boards/.test(g.innerText || '') && g.getAttribute('data-path') === 'Boards' && g.getAttribute('aria-expanded') !== 'true');
      if (shut) {
        shut.click();
        await sleep(600);
        continue;
      }
      await sleep(600);
    }
    return 'NOTFOUND';
  })()`);
  assert.equal(opened, 'OPENED', 'opened Boards/Map.canvas from the tree');
  await waitFor(h, `!!document.querySelector('.canvas-card')`);
}

test('a canvas card at a folded note opens its record', async () => {
  const h = await harness();
  const BASE = 'Home/Systems and Home Lab';
  assert.equal(existsSync(path.join(h.vaultDir, BASE, 'Services', 'svc.md')), false, 'the note file is gone (folded)');
  await openCanvas(h);
  await h.browser.ev(`(() => { document.querySelector('.canvas-card button[title="Open the note in a tab"]').click(); })()`);
  await waitFor(h, `document.body.innerText.includes('Depends on and needed by')`);
  const title = await h.browser.ev(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)`);
  assert.match(title, /svc/, `the service record opened (saw ${JSON.stringify(title)})`);
  assert.equal(existsSync(path.join(h.vaultDir, BASE, 'Services', 'svc.md')), false, 'opening wrote no stub note');
});

test('double-clicking the card edits on the record page, never a ghost', async () => {
  const h = await harness();
  const BASE = 'Home/Systems and Home Lab';
  await openCanvas(h);
  await h.browser.ev(`(() => { document.querySelector('.canvas-card').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
  await waitFor(h, `document.body.innerText.includes('Depends on and needed by')`);
  assert.equal(existsSync(path.join(h.vaultDir, BASE, 'Services', 'svc.md')), false, 'no stub note shadows the row');
});
