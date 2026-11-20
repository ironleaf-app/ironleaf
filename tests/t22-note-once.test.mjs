// node --test tests/t22-note-once.test.mjs — t22 "a note says each thing once" (8 Nov 2026):
// - the words column holds the note and, at its foot, the one Linked list;
// - the right panel, when open, holds chat, outline, the note's graph, and tags and dates;
// - the in-flow rail shows only when the right panel is shut (or too narrow to dock), with only outline and tags;
// - Links and dates drops its Linked mentions (the foot has them) and keeps outgoing, suggested and dates.
// Nothing reachable is lost: Link it stays in the foot, and the backlinks, related and status-line doors land on it.
// Fails first (headings, links and tags each listed twice, side by side).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── static: each fact keeps one home ──────────────────────────────────

test('the right side keeps chat, outline, graph, outgoing, suggested, tags and dates, and nothing linked here', () => {
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  for (const stack of ['data-stack="chat"', 'data-stack="outline"', 'data-stack="graph"', 'data-stack="links"']) {
    assert.ok(side.includes(stack), `the side stacks ${stack}`);
  }
  for (const keep of ['<OutgoingPanel tab={tab} />', '<TagsDates path={notePath} />', 'See suggested links', '<OutlinePanel tab={tab} />', '<LocalGraphPanel tab={tab} />']) {
    assert.ok(side.includes(keep), `the side keeps ${keep}`);
  }
  assert.ok(!side.includes('BacklinksPanel'), 'no Linked mentions in the side: the foot has them');
  assert.ok(!side.includes('RelatedPanel'), 'no related list in the side: the foot has it');
});

test('the rail keeps outline, tags and its own sections, and no link list', () => {
  const rail = read('src/renderer/src/views/note/ContextRail.tsx');
  for (const gone of ['Linked here', 'Links to', 'Linked from']) assert.ok(!rail.includes(gone), `no "${gone}" in the rail`);
  for (const keep of ['On this page', 'Tags', 'Belongs to', 'People in it', 'Open tasks', 'Related meetings', 'nv-context-toggle']) {
    assert.ok(rail.includes(keep), `the rail keeps ${keep}`);
  }
});

test('the rail stands beside the note only while the right side is not docked', () => {
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes("useFit().right !== 'docked'"), 'the page reads the drawn right side, so a narrow window counts as shut');
  assert.ok(view.includes('!isPrivate && railVisible && <ContextRail'), 'the rail draws only then');
  assert.ok(view.includes('railOpen={railVisible ? railOpen : true}'), 'a doc’s head stands aside while the rail is away too');
});

test('the foot keeps the one Linked list with Link it, and the old doors land on it', () => {
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('Link it') && foot.includes('mentionLines'), 'linking from a mention stays in the foot list');
  assert.ok(foot.includes('export function goToNoteFoot'), 'one jump to the foot’s Linked list');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("id: 'backlinks'") && commands.includes('run: () => goToNoteFoot()'), 'Show links to this note lands on the foot');
  assert.ok(commands.includes("id: 'related-notes'") && commands.includes('Show related notes'), 'Show related notes stays a door');
  assert.ok(commands.includes('Mod+Shift+B'), 'its key stays');
  assert.ok(read('src/renderer/src/App.tsx').includes('goToNoteFoot()'), 'the status line’s count lands on the foot');
});

test('the View menu offers the context panel only while it can show', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes('Show the context panel') && menus.includes('Hide the context panel'), 'the row stays');
  assert.ok(menus.includes("rightShown() !== 'docked'"), 'but hides while the right side is docked');
});

// ── browser: each thing in exactly one place ─────────────────────────
const { startHarness } = await import('./vault-controls-harness.mjs');

test('headings, links and tags each read once, right open and shut', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    writeFileSync(path.join(H.vaultDir, 'Quay Launch Plan.md'),
      '---\ntype: note\n---\n\n# Quay Launch Plan\n\nThe gala opens with the new till. Stock comes from [[Harbour Stores]]. Tagged #quaylaunch for the night.\n\n## Quayside Roster\n\nWho works the late shift.\n\n## Ferry Timetable\n\nWhen the boats run.\n\n## Gala Nightcap\n\nWhat pours last.\n');
    writeFileSync(path.join(H.vaultDir, 'Harbour Stores.md'), '# Harbour Stores\n\nRope, canvas and brass fittings.\n');
    writeFileSync(path.join(H.vaultDir, 'Quay Linker Alpha.md'), '# Quay Linker Alpha\n\nFirst in: see the [[Quay Launch Plan]] for the roster.\n');
    writeFileSync(path.join(H.vaultDir, 'Quay Linker Beta.md'), '# Quay Linker Beta\n\nSecond in: the [[Quay Launch Plan]] holds the timetable.\n');
    writeFileSync(path.join(H.vaultDir, 'Quay Mentioner.md'), '# Quay Mentioner\n\nSomeone said the Quay Launch Plan meeting ran long.\n');
    await H.services.rescanAll();
    const ev = H.browser.ev;
    const send = (m, p) => H.browser.send(m, p);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
    await sleep(1500);
    const key = async (keyName, code, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
    await key('o', 'KeyO', 2);
    await sleep(1200);
    await send('Input.insertText', { text: 'Quay Launch Plan' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    await sleep(4500);
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens');
    for (let i = 0; i < 40; i++) {
      const t = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
      if (t.includes('Quay Linker Alpha')) break;
      await sleep(500);
    }
    // Occurrences inside the note's own lists (never its words): the outline lists, the link lists, the tag lists.
    const counts = (needle) => ev(`(() => {
      const n = ${JSON.stringify(needle)};
      const hits = (sel) => [...document.querySelectorAll(sel)].reduce((t, el) => t + (el.textContent.split(n).length - 1), 0);
      const rows = [...document.querySelectorAll('.note-foot .foot-item-name')].filter((e) => e.textContent.trim() === n).length;
      return {
        outline: hits('.nv-rail .nv-strip-list') + hits('.sidebar.right [data-stack="outline"]') + hits('.doc-toc'),
        railLinks: hits('.nv-rail'),
        sideLinks: hits('.sidebar.right [data-stack="links"]'),
        footRows: rows,
        tags: hits('.nv-rail .nv-strip-tags') + hits('.sidebar.right [data-stack="links"] .side-tags') + hits('.doc-head-facts'),
      };
    })()`);
    const HEADS = ['Quayside Roster', 'Ferry Timetable', 'Gala Nightcap'];
    const LINKERS = ['Quay Linker Alpha', 'Quay Linker Beta'];

    // The right side starts shut: the rail carries the outline and tags, the foot the links.
    assert.ok(await ev(`!!document.querySelector('.nv-rail.is-strip')`), 'shut: the strip stands beside the note');
    for (const h of HEADS) assert.equal((await counts(h)).outline, 1, `shut: ${h} reads in one outline list`);
    for (const l of LINKERS) {
      const c = await counts(l);
      assert.equal(c.railLinks, 0, `shut: ${l} is not listed beside the note any more`);
      assert.equal(c.sideLinks, 0, `shut: ${l} is not in the side`);
      assert.equal(c.footRows, 1, `shut: ${l} names one Linked row at the foot`);
    }
    assert.equal((await counts('#quaylaunch')).tags, 1, 'shut: the tag reads once, in the strip');
    // Context opens from the strip with its own sections and no link list.
    await ev(`document.querySelector('.nv-strip-context')?.click()`);
    await sleep(1200);
    assert.equal(await ev(`document.querySelector('.nv-rail')?.className ?? ''`), 'nv-rail', 'Context opens');
    const open = await ev(`document.querySelector('.nv-rail')?.textContent ?? ''`);
    assert.ok(!open.includes('Links to') && !open.includes('Linked from'), 'Context carries no link list');
    assert.ok(open.includes('Belongs to'), 'Context keeps what only it holds');
    assert.equal((await counts('Harbour Stores')).railLinks, 0, 'Context does not list what the note links to');
    await ev(`document.querySelector('.nv-rail-head .icon-button')?.click()`);
    await sleep(1000);

    // Open the side: the rail steps aside, the outline and tags move to the side, the links stay at the foot.
    await key('L', 'KeyL', 10); // Mod+Shift+L: chat
    await sleep(2500);
    assert.ok(await ev(`!!document.querySelector('.sidebar.right')`), 'open: the side opens');
    // The note's outline, links and tags are on the side's Note tab (20 Nov 2026: Chat | Note).
    await ev(`document.querySelector('#side-tab-note')?.click()`);
    await sleep(1500);
    assert.equal(await ev(`document.querySelectorAll('.nv-rail').length`), 0, 'open: the rail steps aside');
    for (const h of HEADS) assert.equal((await counts(h)).outline, 1, `open: ${h} reads in one outline list`);
    for (const l of LINKERS) {
      const c = await counts(l);
      assert.equal(c.sideLinks, 0, `open: ${l} is not in the side any more`);
      assert.equal(c.footRows, 1, `open: ${l} still names one Linked row at the foot`);
    }
    assert.equal((await counts('#quaylaunch')).tags, 1, 'open: the tag reads once, in the side');
    assert.ok((await ev(`document.querySelector('.sidebar.right [data-stack="links"]')?.textContent ?? ''`)).includes('Harbour Stores'), 'the links stack keeps what goes out of the note');
    assert.ok(await ev(`[...document.querySelectorAll('.note-foot .foot-link-it')].length > 0`), 'Link it stays in the foot list');

    // Too narrow to dock: the side steps aside and the rail is back, even though it stays open.
    await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);
    assert.equal(await ev(`document.querySelectorAll('.sidebar.right').length`), 0, 'narrow: the side cannot dock');
    assert.ok(await ev(`!!document.querySelector('.nv-rail')`), 'narrow: the rail is back');
    assert.equal((await counts('Quayside Roster')).outline, 1, 'narrow: the outline reads once, in the rail');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);
    assert.ok(await ev(`!!document.querySelector('.sidebar.right')`), 'wide again: the side docks back');
    assert.equal(await ev(`document.querySelectorAll('.nv-rail').length`), 0, 'wide again: the rail steps aside');

    // Mod+Shift+B lands on the foot's Linked list, without opening the side.
    // Mod+J is Ask: from the Note tab it lands on Chat (20 Nov 2026), and again shuts the side.
    await key('j', 'KeyJ', 2);
    await sleep(1000);
    await key('j', 'KeyJ', 2); // Mod+J: shut the side
    await sleep(1500);
    await key('B', 'KeyB', 10); // Mod+Shift+B: links to this note
    await sleep(2000);
    assert.equal(await ev(`document.querySelectorAll('.sidebar.right').length`), 0, 'the key does not open the side');
    const seen = await ev(`(() => {
      const foot = document.querySelector('.note-foot');
      const scroller = document.querySelector('.note-editor .cm-scroller');
      if (!foot || !scroller) return false;
      const f = foot.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return f.top < s.bottom - 40 && f.bottom > s.top;
    })()`);
    assert.ok(seen, 'the key lands on the foot’s Linked list');
  } finally {
    await H.close();
  }
});
