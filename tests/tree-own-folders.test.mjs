// node --test tests/tree-own-folders.test.mjs — t155 the file tree shows the person's own folders
// (9 Nov 2026, Vault calm and natural: "your folders as a file tree in the side bar"):
// - a pack switched off hides nothing: the person's own folder under its name (Business with the
//   Business pack off) shows in the tree, opening and folding like any folder;
// - switching the pack on moves its folder under Show everything with its count; switching it off
//   brings it back;
// - the tree keeps its state (folders mode, open folders) across a reopen;
// - the tree scrolls inside its own part only: long names never push the side bar sideways and the
//   foot stays pinned.
// Fails first (every pack's folder hid however its switch stood, so the person's own Business folder
// sat under Show everything on a made-up vault of realistic size).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the three trees hide only a pack switched on, never an off pack’s folder', () => {
  for (const f of ['src/renderer/src/panels/FileExplorer.tsx', 'src/renderer/src/panels/Navigator.tsx', 'src/renderer/src/views/NotesPage.tsx']) {
    const src = read(f);
    assert.ok(src.includes('MODULES.filter((m) => moduleOn(prefs.modules, m.id))'), `${f} hides only switched-on packs’ folders`);
    assert.ok(src.includes("from '../../../shared/life-modules'"), `${f} reads the switches through the one helper`);
  }
});

const { startHarness } = await import('./vault-controls-harness.mjs');

test('the tree shows the person’s own folders, keeps its state, and scrolls in its own part', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const LONG = 'Quarterly supplier reconciliation and outstanding invoice follow-up actions for the harbour shop fit-out';
    w('Business/Harbour Launch Plan.md', '---\ntype: note\n---\n\n# Harbour Launch Plan\n\nThe gala opens with the new till.\n');
    w(`Business/${LONG}.md`, '---\ntype: note\n---\n\n# A very long name\n\nWords.\n');
    w('Business/Suppliers/Rope and canvas.md', '# Rope and canvas\n\nFor the awning.\n');
    w('Me/Week plan.md', '# Week plan\n\nMonday first.\n');
    w('Bills/Power bill.md', '# Power bill\n\nDue Friday.\n');
    await H.services.rescanAll();
    const ev = H.browser.ev;
    const send = (m, p) => H.browser.send(m, p);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
    await sleep(1500);
    const key = async (keyName, code, modifiers = 0, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: text ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 13), modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
    };
    const centre = (expr) => ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const click = async (expr) => {
      const c = await centre(expr);
      assert.ok(c, `the control draws: ${expr.slice(0, 80)}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(700);
    };
    const waitFor = async (expr, ms = 12000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); }
      return false;
    };
    const folders = () => ev(`[...document.querySelectorAll('.tree-row.tree-folder .tree-name')].map((e) => e.textContent)`);

    // The file list opens from the palette, as a person opens it.
    await key('k', 'KeyK', 2);
    assert.ok(await waitFor(`!!document.querySelector('.picker input, .palette input, .modal input')`), 'the palette opens');
    await send('Input.insertText', { text: 'Show your files' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    assert.ok(await waitFor(`!!document.querySelector('.sidebar.left .panel.explorer, .sidebar.left .nav-mode')`), 'the file list shows in the side bar');
    // Folders mode: their own folders as a file tree. The side bar slides its panel in, so the switch is pressed once
    // it stands still (23 Nov 2026: in a busy full run the press landed where it had been a moment before).
    const FOLDERS = `[...document.querySelectorAll('.nav-mode-option')].find((b) => b.textContent.includes('Folders'))`;
    let at = '';
    for (let i = 0; i < 40; i++) {
      const now = await ev(`(() => { const el = ${FOLDERS}; if (!el) return ''; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(','); })()`);
      if (now && now === at) break;
      at = now;
      await sleep(150);
    }
    await click(FOLDERS);
    assert.ok(await waitFor(`[...document.querySelectorAll('.nav-mode-option')].some((b) => b.textContent.includes('Folders') && b.className.includes(' on'))`), 'Folders mode switches on');
    const tops = await folders();
    for (const f of ['Business', 'Me', 'Bills']) assert.ok(tops.includes(f), `the person’s own ${f} folder shows with the packs off (saw: ${tops.join(', ')})`);
    // It opens and folds with a click.
    await click(`[...document.querySelectorAll('.tree-row.tree-folder')].find((b) => b.textContent.includes('Business'))`);
    assert.ok(await waitFor(`[...document.querySelectorAll('.tree-row.tree-file .tree-name')].some((e) => e.textContent.includes('Harbour Launch Plan'))`), 'opening Business shows its notes');
    assert.ok(await ev(`[...document.querySelectorAll('.tree-row.tree-file .tree-name')].some((e) => e.textContent.includes('Quarterly supplier'))`), 'the long name shows too');
    await click(`[...document.querySelectorAll('.tree-row.tree-folder')].find((b) => b.textContent.includes('Business'))`);
    assert.ok(await waitFor(`![...document.querySelectorAll('.tree-row.tree-file .tree-name')].some((e) => e.textContent.includes('Harbour Launch Plan'))`), 'clicking it again folds it away');
    await click(`[...document.querySelectorAll('.tree-row.tree-folder')].find((b) => b.textContent.includes('Business'))`);
    assert.ok(await waitFor(`[...document.querySelectorAll('.tree-row.tree-file .tree-name')].some((e) => e.textContent.includes('Harbour Launch Plan'))`), 'and opens again');
    // A note opens from the tree.
    await click(`[...document.querySelectorAll('.tree-row.tree-file')].find((b) => b.textContent.includes('Harbour Launch Plan'))`);
    assert.ok(await waitFor(`!!document.querySelector('.cm-editor')`), 'the note opens');
    assert.ok((await ev(`document.querySelector('.inline-title')?.value ?? ''`)).includes('Harbour Launch Plan'), 'the right note');
    // Long names never push the side bar sideways; the foot stays pinned while the tree scrolls in its part.
    const sideways = await ev(`(() => { const b = document.querySelector('.panel-body.tree'); const side = document.querySelector('.sidebar.left'); return b && side ? [b.scrollWidth <= b.clientWidth + 1, side.scrollWidth <= side.clientWidth + 1] : null; })()`);
    assert.deepEqual(sideways, [true, true], 'neither the tree nor the side bar scrolls sideways');
    const foot = await ev(`(() => { const f = document.querySelector('.sidebar.left .places-foot'); if (!f) return null; const r = f.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1; })()`);
    assert.equal(foot, true, 'the foot stays pinned at the bottom');
    // Its state is kept: folders mode and the open folder survive a reopen.
    await sleep(1500);
    await send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(`!!document.querySelector('.app')`, 30000), 'the window opens again');
    await sleep(2000);
    await key('k', 'KeyK', 2);
    assert.ok(await waitFor(`!!document.querySelector('.picker input, .palette input, .modal input')`), 'the palette opens again');
    await send('Input.insertText', { text: 'Show your files' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    assert.ok(await waitFor(`[...document.querySelectorAll('.nav-mode-option')].some((b) => b.textContent.includes('Folders') && b.className.includes(' on'))`), 'folders mode is kept');
    assert.ok(await waitFor(`[...document.querySelectorAll('.tree-row.tree-file .tree-name')].some((e) => e.textContent.includes('Harbour Launch Plan'))`), 'Business is still open');
    // Switching the Business pack on moves its folder under Show everything; off brings it back.
    // Settings is a page (the left side stays): Ctrl+, opens it.
    await key(',', 'Comma', 2);
    assert.ok(await waitFor(`!!document.querySelector('.settings-page')`, 8000), 'Settings opens');
    await click(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent.trim() === 'Packs' && b.offsetParent)`);
    assert.ok(await waitFor(`!!document.querySelector('section.packrow[data-setting="Business"]')`), 'the packs list with Business');
    await click(`document.querySelector('section.packrow[data-setting="Business"] input.switch')`);
    assert.ok(await waitFor(`![...document.querySelectorAll('.tree-row.tree-folder .tree-name')].some((e) => e.textContent === 'Business')`, 8000), 'Business hides with its pack on');
    assert.ok(await waitFor(`(document.querySelector('.tree-showall')?.textContent ?? '').includes('Show everything')`), 'under one quiet Show everything');
    await click(`document.querySelector('section.packrow[data-setting="Business"] input.switch')`);
    assert.ok(await waitFor(`[...document.querySelectorAll('.tree-row.tree-folder .tree-name')].some((e) => e.textContent === 'Business')`, 8000), 'off again, the folder is back');
    await key('Escape', 'Escape', 0);
  } finally {
    await H.close();
  }
});
