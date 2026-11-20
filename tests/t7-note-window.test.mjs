// node --test tests/t7-note-window.test.mjs — t7 "the note is the window" (8 Nov 2026):
// 1. the slim header names the note once (its folders up top, its title below);
// 4. the right side stacks chat, outline, graph then links, never tabbed;
// 5. a peeked note summarises instead of repeating its page;
// 6. past 2400px the reading column stays wide and centred with room for the side.
// Fails first (the name twice, eight tabs, peeks re-listing, unmeasured).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the note's lead, pure ─────────────────────────────────────────
const work = mkdtempSync(path.join(tmpdir(), 'nv-t7-window-'));
let Lead;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'lead.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/note-lead.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'lead.mjs'), format: 'esm' }, logLevel: 'silent' });
  Lead = await import(pathToFileURL(path.join(work, 'lead.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the lead is the note’s opening words, never its front matter or title', () => {
  const text = '---\ntype: note\ntags: [a]\n---\n\n# Harbour Launch\n\nThe shop checkout goes live on Friday with rope and canvas.\n\nSecond paragraph here.\n';
  const lead = Lead.noteLead(text);
  assert.ok(lead.startsWith('The shop checkout goes live'), `opens with the words (saw "${lead.slice(0, 60)}")`);
  assert.ok(!lead.includes('harbourline') && !lead.includes('# Harbour'), 'no properties, no title heading');
  assert.ok(lead.split(/\s+/).length <= 60, 'short enough to be a summary');
  assert.equal(Lead.noteLead(''), '', 'an empty note leads nowhere');
});

// ── static: header, stacks, peek, wide column ─────────────────────
test('item 1: the header keeps the folders, the page below keeps the name', () => {
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(header.includes('hideName'), 'the bar can keep the folders without repeating the name');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes('hideName'), 'a note with its title below hides the repeated name');
  assert.ok(view.includes('<ShareButton') && view.includes("Read (Ctrl+E)"), 'Share and Read stay the header’s own');
});

test('item 4: chat on its own tab; outline, graph then links stack in order on the Note tab', () => {
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  for (const stack of ['data-stack="chat"', 'data-stack="outline"', 'data-stack="graph"', 'data-stack="links"']) {
    assert.ok(side.includes(stack), `the side stacks ${stack}`);
  }
  assert.ok(!side.includes('SideTabs tabs={RIGHT}') && side.includes('role="tablist"'), 'one strip of two tabs, Chat and Note (20 Nov 2026)');
  assert.ok(side.includes('<LocalGraphPanel tab={tab} />'), 'the graph block stays exactly where t5 left it');
  assert.ok(side.includes('TagsDates'), 'this note’s tags and dates close the links stack');
  // Every door still opens the side, except the two whose lists moved to the foot (t22-note-once, 8 Nov 2026):
  // backlinks and related land on the foot’s Linked list now. The commands and their keys stay.
  const commands = read('src/renderer/src/state/commands.ts');
  for (const id of ["setPanel('right', 'outgoing')", "setPanel('right', 'outline')", "setPanel('right', 'chat')", "setPanel('right', 'autolink')", "setPanel('right', 'local-graph')"]) {
    assert.ok(commands.includes(id), `${id} still opens the side`);
  }
  assert.ok(!commands.includes("setPanel('right', 'backlinks')") && !commands.includes("setPanel('right', 'related')"), 'no door opens the side for a list it no longer holds');
  assert.ok(commands.includes('goToNoteFoot()'), 'the two doors land on the foot instead');
  for (const key of ['Mod+Shift+B', 'Mod+Shift+L', 'Mod+Shift+K']) assert.ok(commands.includes(key), `${key} stays`);
});

test('item 5: a peeked note summarises — its lead, its counts, its full page one click away', () => {
  const src = read('src/renderer/src/components/Peek.tsx');
  assert.ok(src.includes('noteLead'), 'the peek reads the note’s opening words');
  assert.ok(src.includes("record.type === 'note'"), 'notes summarise');
  assert.ok(src.includes('Open full page'), 'the whole page stays one click away');
  assert.ok(src.includes('shownAtFirst={3}'), 'other records still show three rows a group');
});

test('item 6: past 2400px the column widens pinned centre with the rail beside it', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  const wide = frame.slice(frame.indexOf('@media (min-width: 2400px)'));
  assert.ok(wide.includes('--page-column: 1028px'), 'the column widens');
  assert.ok(wide.includes('justify-content: center'), 'and stays centred');
  const rail = read('src/renderer/src/styles/note-context.css');
  assert.ok(rail.includes('.nv-note-main .cm-content'), 'the words keep their column');
  assert.ok(rail.includes('.nv-rail'), 'the rail beside them keeps its room');
});

// ── browser: the stacks as a person sees them ─────────────────────
const { startHarness } = await import('./vault-controls-harness.mjs');

test('the right side stacks in order with no tabs; every panel key lands on its block', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    writeFileSync(path.join(H.vaultDir, 'Notes-Stacks.md'),
      '---\ntype: note\ntags: [harbourline]\ndue: 2026-11-20\n---\n\n# Stacks Note\n\nOpens [[Kickoff]] for its links.\n\n## First heading\n\nWords here.\n\n## Second heading\n\nMore words.\n');
    writeFileSync(path.join(H.vaultDir, 'Stacks-Linker.md'), '# Stacker\n\nPoints here: [[Notes-Stacks]].\n');
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
    await send('Input.insertText', { text: 'Notes-Stacks' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    await sleep(4000);
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens');
    // Item 1 live: the folders up top, the name below, never twice.
    assert.ok(await ev(`!!document.querySelector('.inline-title')`), 'the title shows below');
    assert.equal(await ev(`document.querySelector('.topbar .crumb')?.querySelectorAll('b').length ?? -1`), 0, 'the bar keeps the folders only');
    // Item 4 live: the stacks, in order, with no tab strip.
    await key('L', 'KeyL', 10); // Mod+Shift+L: chat
    await sleep(2000);
    assert.ok(await ev(`!!document.querySelector('.sidebar.right')`), 'the side opens');
    // 20 Nov 2026: Chat | Note. Chat has the column to itself; the note's stacks are on the Note tab.
    assert.deepEqual(await ev(`[...document.querySelectorAll('.sidebar.right .rside-tab')].map((e) => e.textContent.trim())`), ['Chat', 'Note'], 'the two tabs');
    assert.deepEqual(await ev(`[...document.querySelectorAll('.sidebar.right [data-stack]')].map((e) => e.getAttribute('data-stack'))`), ['chat'], 'on Chat, the chat alone');
    assert.ok(await ev(`!!document.querySelector('.sidebar.right [data-stack="chat"] textarea')`), 'chat keeps its box');
    await ev(`document.querySelector('#side-tab-note').click()`);
    await sleep(1500);
    assert.deepEqual(await ev(`[...document.querySelectorAll('.sidebar.right [data-stack]')].map((e) => e.getAttribute('data-stack'))`), ['chat', 'outline', 'graph', 'links'], 'on Note: outline, graph, links (the chat kept behind)');
    assert.equal(await ev(`document.querySelector('.sidebar.right [data-stack="chat"]').hidden`), true, 'the chat is out of sight on the Note tab');
    assert.ok((await ev(`document.querySelector('.sidebar.right [data-stack="outline"]')?.textContent ?? ''`)).includes('First heading'), 'the outline lists the headings');
    // The side's own key lands on its block; what links here lives at the foot (t22-note-once, 8 Nov 2026).
    await key('K', 'KeyK', 10); // Mod+Shift+K: suggested links
    await sleep(2000);
    const linksVisible = await ev(`(() => { const side = document.querySelector('.sidebar.right .side-body.is-stacks'); const el = document.querySelector('.sidebar.right [data-stack="links"]'); if (!side || !el) return false; const a = side.getBoundingClientRect(); const b = el.getBoundingClientRect(); return b.top < a.bottom - 40 && b.bottom > a.top; })()`);
    assert.ok(linksVisible, 'suggested links lands on the links stack');
    const linksText = await ev(`document.querySelector('.sidebar.right [data-stack="links"]')?.textContent ?? ''`);
    assert.equal(await ev(`document.querySelectorAll('.sidebar.right [data-stack="links"] .panel-body.backlinks, .sidebar.right [data-stack="links"] .rl-panel').length`), 0, 'the links stack no longer repeats what links here');
    assert.ok(linksText.includes('#harbourline') || linksText.includes('harbourline'), 'this note’s tags stay beside it');
    const footText = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
    assert.ok(footText.includes('Stacks-Linker'), 'the foot’s Linked list shows what links here');
    await key('B', 'KeyB', 10); // Mod+Shift+B: links to this note
    await sleep(2000);
    const footSeen = await ev(`(() => { const foot = document.querySelector('.note-foot'); const scroller = document.querySelector('.note-editor .cm-scroller'); if (!foot || !scroller) return false; const f = foot.getBoundingClientRect(); const s = scroller.getBoundingClientRect(); return f.top < s.bottom - 40 && f.bottom > s.top; })()`);
    assert.ok(footSeen, 'links to this note lands on the foot’s Linked list');
  } finally {
    await H.close();
  }
});
