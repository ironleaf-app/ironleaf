// node --test tests/t27-unused-panels.test.mjs — t27 "remove what the note page no longer uses" (8 Nov 2026):
// the side's Linked mentions and Related notes panels are gone (t22 undrew them; no door renders them), and what
// they did still works from where it lives now: Link it and open-at-the-line from the foot's Linked list,
// insert-at-the-cursor from suggested links. Fails without the wiring (a door rewired past its home, a panel back).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── static: the panels are gone, their doors stay ────────────────────

test('neither panel file, style nor import remains', () => {
  for (const gone of [
    'src/renderer/src/components/BacklinksPanel.tsx',
    'src/renderer/src/components/RelatedPanel.tsx',
    'src/renderer/src/styles/related.css',
  ]) {
    assert.equal(existsSync(path.join(root, gone)), false, `${gone} is gone`);
  }
  assert.ok(!read('src/renderer/src/main.tsx').includes('related.css'), 'no stylesheet import');
  const base = read('src/renderer/src/styles.css');
  for (const sel of ['.backlink-row', '.backlink-prop', '.backlink-snippet', '.backlink-line']) {
    assert.ok(!base.includes(sel), `no ${sel} rules`);
  }
  // What stays is borrowed, not dead: the tags panel's Properties head and the Systems record links.
  for (const keep of ['.backlinks-heading', '.backlink-group', '.backlink-head', '.backlink-title']) {
    assert.ok(base.includes(keep), `${keep} stays for its borrowers`);
  }
});

test('Link it still links a mention from the foot', () => {
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('foot-link-it') && foot.includes('Link it'), 'each mention row offers Link it');
  assert.ok(foot.includes('linkable: true'), 'mention lines are flagged linkable');
  assert.ok(foot.includes('await linkMentionLine(source, line, path);'), 'through the one write that speaks');
});

test('a foot row opens at its line', () => {
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('Open at this line'), 'the snippet says where it lands');
  assert.ok(foot.includes('onOpen(r.path, s.line'), 'the row passes its line');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes('<NoteFoot path={path} onOpen={(p, line, newTab) => A.openPath(p, { line,'), 'the page opens the foot at the line');
});

test('suggested links still insert at the cursor', () => {
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("id: 'autolink'") && commands.includes("setPanel('right', 'autolink')"), 'Suggest links opens the side');
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  assert.ok(side.includes('<LinksPanel path={notePath}'), 'the side draws suggested links');
  const links = read('src/renderer/src/components/LinksPanel.tsx');
  assert.ok(links.includes('Insert a link at the cursor'), 'each related row offers Insert');
  assert.ok(links.includes('editor()?.insertAtCursor('), 'at the cursor');
  assert.ok(links.includes('writeLink(rel, path)'), 'as a real link');
});

// ── browser: the doors work on a real note ──────────────────────────
const { startHarness } = await import('./vault-controls-harness.mjs');

test('Insert lands a link at the cursor and a foot row opens its note', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    writeFileSync(path.join(H.vaultDir, 'Quay Foot Plan.md'),
      '---\ntags: [quayfoot]\n---\n\n# Quay Foot Plan\n\nThe gala till plan, every wire counted.\n');
    writeFileSync(path.join(H.vaultDir, 'Quay Foot Stores.md'),
      '---\ntags: [quayfoot]\n---\n\n# Quay Foot Stores\n\nRope and canvas for the gala till.\n');
    writeFileSync(path.join(H.vaultDir, 'Quay Foot Linker.md'),
      '# Quay Foot Linker\n\nFirst in line. See the [[Quay Foot Plan]] for the roster.\n\nMore words below the link.\n');
    await H.services.rescanAll();
    const ev = H.browser.ev;
    const send = (m, p) => H.browser.send(m, p);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
    await sleep(1500);
    const key = async (keyName, code, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
    };
    await key('o', 'KeyO', 2);
    await sleep(1200);
    await send('Input.insertText', { text: 'Quay Foot Plan' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    await sleep(4500);
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens');
    // The foot names the note that links here (it only draws near the viewport, so scroll as we wait).
    for (let i = 0; i < 40; i++) {
      const t = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
      if (t.includes('Quay Foot Linker')) break;
      await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 1e9)`);
      await sleep(500);
    }
    assert.ok((await ev(`document.querySelector('.note-foot')?.textContent ?? ''`)).includes('Quay Foot Linker'), 'the foot lists what links here');

    // Insert: suggested links puts a related note where the cursor is.
    await ev(`[...document.querySelectorAll('.cm-content .cm-line')].pop()?.scrollIntoView({ block: 'center' })`);
    await sleep(600);
    const end = await ev(`(() => { const lines = [...document.querySelectorAll('.cm-content .cm-line')]; const l = lines[lines.length - 1]; const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await sleep(600);
    await key('K', 'KeyK', 10); // Mod+Shift+K: suggest links for this note
    await sleep(2500);
    const name = await ev(`(() => {
      const b = [...document.querySelectorAll('.sidebar.right [data-stack="links"] button.small-button')]
        .find((x) => x.title === 'Insert a link at the cursor' && /Quay Foot (Stores|Linker)/.test(x.closest('.result-row')?.querySelector('.result-snippet')?.textContent ?? ''));
      if (!b) return null;
      const n = /Quay Foot (Stores|Linker)/.exec(b.closest('.result-row').querySelector('.result-snippet').textContent)[0];
      b.click();
      return n;
    })()`);
    assert.ok(name, 'a related note offers Insert');
    await sleep(1500);
    assert.ok((await ev(`document.querySelector('.cm-content')?.textContent ?? ''`)).includes(name), 'the link lands in the note at the cursor');

    // Open at the line: the foot's row opens the note that links here.
    let opened = false;
    for (let i = 0; i < 6 && !opened; i++) {
      await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 1e9)`);
      await sleep(1000);
      opened = await ev(`(() => {
        const row = [...document.querySelectorAll('.note-foot .foot-item')].find((li) => li.querySelector('.foot-item-name')?.textContent.trim() === 'Quay Foot Linker');
        const s = row?.querySelector('.foot-snippet');
        if (!s) return false;
        s.click();
        return true;
      })()`);
    }
    assert.ok(opened, 'the row offers its line');
    await sleep(2500);
    assert.ok((await ev(`document.querySelector('.cm-content')?.textContent ?? ''`)).includes('for the roster'), 'the linked note opens');
  } finally {
    await H.close();
  }
});
