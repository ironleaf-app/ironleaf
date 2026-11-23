// node --test tests/p15-search-polish.test.mjs — p15 (Nov 2026): Search, Quick add and the + dialog at the
// owner's width. The palette opens when the host knows no plugins, long search lines cut around their match so the
// marked words stay visible in the narrow rows (the panel's rows take a shorter window), row heads hover their full
// title, Start from a template closes on Escape and walks on arrows, and Quick add's chips clip while its project
// rows name themselves on hover, wrap on arrows and keep the arrowed row in sight. Each check fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssPxFor } from './css-px.mjs';

process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the palette opens when the host answers no plugin commands', () => {
  const modals = read('src/renderer/src/components/Modals.tsx');
  assert.ok(modals.includes('(r) => setExtra(r ?? [])'), 'no answer still means no commands, never a crash (the list reads an array)');
});

test('search rows cut long lines around the match; the full line stays for hovering', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes('windowSnippet(plain.text, plain.ranges)'), 'the shared Snippet windows after plainLine');
  assert.ok(view.includes('windowSnippet(plain.text, plain.ranges, 44, 14)'), 'the panel takes a shorter window with the match nearer the start');
  assert.ok(view.includes('<Snippet text={s.text} ranges={s.ranges} host={host} />'), 'every snippet knows which host it is in');
  assert.ok(view.includes("title={`${plainLine(s.text, s.ranges).text} (line ${s.line + 1})`}"), 'the row still hovers its whole line');
});

test('search row heads hover their full title, not only where they sit', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes('title={hit.title === hit.path ? hit.path : `${hit.title} · ${hit.path}`}'), 'a clipped long title hovers whole with its path');
  assert.ok(view.includes('title={`${h.title} · ${mediaFoundWords(h.kind, h.page)} · ${h.path}`}'), 'pictures and scans hover their title too');
});

test('Start from a template: Escape closes it, arrows walk it, the picked row takes the keys', () => {
  const picker = read('src/renderer/src/components/StarterPicker.tsx');
  assert.ok(picker.includes('useEscape(close)'), 'Escape puts it away through the shared hook');
  assert.ok(picker.includes('if (!busy) onClose()'), 'except while it is making, like clicking out');
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.ok(picker.includes(`'${k}'`), `the list walks on ${k}`);
  assert.ok(picker.includes('data-starter={t.id}'), 'rows carry their id for the roving focus');
  assert.ok(picker.includes("querySelector<HTMLButtonElement>('.st-row.is-picked')?.focus()"), 'the picked row takes the keys on open');
  assert.ok(/className="st-list"[\s\S]{0,220}onKeyDown/.test(picker), 'arrows live on the list itself; the folder box keeps its own');
});

test('Quick add’s project rows name themselves and keep the arrowed row in sight', () => {
  const box = read('src/renderer/src/capture/CaptureBox.tsx');
  assert.ok(box.includes('title={p.name}'), 'a clipped long name hovers whole');
  assert.ok(box.includes("querySelector('.qc-picker-row.at')?.scrollIntoView({ block: 'nearest' })"), 'arrows never walk out of sight (the picker’s own rule)');
  assert.ok(box.includes('(i + 1) % list.length'), 'down wraps past the last like the pickers');
  assert.ok(box.includes('(i - 1 + list.length) % list.length'), 'up wraps past the first');
});

test('Quick add’s long project chips clip instead of stretching the row', () => {
  const css = read('src/renderer/src/styles/capture.css');
  assert.ok(css.includes('.qc-for .chips .chip { max-width: 100%; min-width: 0; }'), 'the chip never runs past the box');
  assert.ok(css.includes('.qc-for .chips .chip .qc-chip-name { flex: 1 1 auto; min-width: 0; }'), 'the name clips with an ellipsis while the reason stays');
});

test('the starter dialog fits all ten at a tall window, scrolling only where it must', () => {
  const css = read('src/renderer/src/styles/abilities-88.css');
  assert.ok(css.trimEnd().endsWith('.dlg.st-picker { max-height: min(84vh, 920px); }'), 'the scoped taller cap rides at the sheet’s end');
});

// ── live: the real renderer at 3456x1408 ─────────────────────────────────────────────────────────────

test('live: the palette, the search window and the starter at 3456 wide', async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const H = await startHarness();
  try {
    const ev = H.browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
    // Long real content: the match buried deep in a long line.
    await ev(`(async () => {
      const body = 'The payment retry twice then fail loud decision stands, and the Safari repeat failures are being chased on the quayside device lab phones this week, with the night shift rota still to confirm.\\n';
      try { await window.nv.files.create('Notes', 'Standup notes about the payment retry and the Safari repeat failures', '.md', '---\\ntype: note\\n---\\n# Standup\\n\\n' + body); } catch (e) {}
      try { await window.nv.files.create('Notes', 'Quarterly planning for the Harbourline waterfront redevelopment', '.md', '---\\ntype: note\\n---\\n# Planning\\n\\nThe Harbourline works compound has to move off the quayside promenade before the school holidays start.\\n'); } catch (e) {}
      return 'ok';
    })()`);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
    await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const key = async (windowsVirtualKeyCode, k, code, modifiers = 0) => {
      await H.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode, key: k, code, modifiers });
      await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode, key: k, code, modifiers });
      await sleep(300);
    };

    // The search window (Ctrl+Shift+F): every marked word visible inside its row.
    await key(70, 'F', 'KeyF', 2 + 8);
    await sleep(1000);
    assert.equal(await ev(`!!document.querySelector('.sas-modal')`), true, 'the search window opens on its keys');
    await ev(`document.querySelector('.sas-modal .sin input')?.focus()`);
    await H.browser.send('Input.insertText', { text: 'quayside' });
    await sleep(2500);
    const rows = await ev(`document.querySelectorAll('.sas-modal .srow2').length`);
    assert.ok(rows >= 2, `long notes found (${rows})`);
    const marks = await ev(`(() => {
      const out = [];
      for (const row of document.querySelectorAll('.sas-modal .sas-snippet')) {
        const r = row.getBoundingClientRect();
        const b = row.querySelector('b')?.getBoundingClientRect();
        out.push({ text: row.textContent, cut: row.textContent.startsWith('…'), mark: b ? b.right - r.right : null });
      }
      return out;
    })()`);
    assert.ok(marks.some((m) => m.cut), 'a long line is cut around its match');
    for (const m of marks) {
      if (m.mark !== null) assert.ok(m.mark <= 2, `the marked word stays inside its row (${m.text.slice(0, 50)}…)`);
    }
    // Escape clears the words first, then puts the window away.
    await key(27, 'Escape', 'Escape');
    await sleep(500);
    assert.equal(await ev(`document.querySelector('.sas-modal .sin input')?.value ?? null`), '', 'Escape clears the words first');
    await key(27, 'Escape', 'Escape');
    await sleep(500);
    assert.equal(await ev(`!!document.querySelector('.sas-modal')`), false, 'Escape then closes the window');

    // The palette opens (no crash), and the starter from it takes the keys.
    await ev(`document.querySelector('.top-search')?.click()`);
    await sleep(1000);
    assert.equal(await ev(`!!document.querySelector('.picker')`), true, 'Ask or find anything opens its panel');
    assert.ok(!(await ev(`document.body.innerText`)).includes('Something went wrong'), 'no crash with no plugins');
    await H.browser.send('Input.insertText', { text: 'Start from a template' });
    await sleep(1200);
    await key(13, 'Enter', 'Enter');
    await sleep(1200);
    assert.equal(await ev(`!!document.querySelector('.st-picker')`), true, 'the starter opens from the panel');
    assert.equal(await ev(`document.activeElement?.classList?.contains('is-picked') ?? false`), true, 'the picked row takes the keys');
    await key(40, 'ArrowDown', 'ArrowDown');
    await sleep(400);
    assert.equal(await ev(`document.querySelector('.st-row.is-picked')?.dataset.starter`), 'habits', 'down moves to the next template');
    assert.equal(await ev(`document.activeElement?.dataset?.starter ?? null`), 'habits', 'the focus follows');
    await key(35, 'End', 'End');
    await sleep(400);
    assert.equal(await ev(`document.querySelector('.st-row.is-picked')?.dataset.starter`), 'recipes', 'End jumps to the last template');
    const lastInSight = await ev(`(() => {
      const l = document.querySelector('.st-list').getBoundingClientRect();
      const r = document.querySelector('.st-row.is-picked').getBoundingClientRect();
      return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
    })()`);
    assert.equal(lastInSight, true, 'the jumped-to row is in sight');
    await key(27, 'Escape', 'Escape');
    await sleep(500);
    assert.equal(await ev(`!!document.querySelector('.st-picker')`), false, 'Escape closes the starter');

    // Nothing the session did errored the page.
    assert.deepEqual(await ev(`window.__nvErrors`), [], 'no page errors');
  } finally {
    await H.close();
  }
});
