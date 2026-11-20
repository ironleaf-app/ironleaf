// node --test tests/editor-walk.test.mjs — the note editor feels natural (t136, 9 Nov 2026).
// A walk through the real client (the vault-controls harness: the real renderer bundle in headless Chromium
// against a real made-up vault) with real CDP keyboard and mouse input only: typing Markdown, lists and tasks,
// Tab and Enter in lists, Ctrl+B/I, [[ links to notes, headings and blocks, rich/table/ordered/link/picture
// pastes, slash tables, embeds, code blocks, undo and redo, find and replace, dragging words, Alt+Up, tick-boxes,
// and a 5,000-word note that types instantly and scrolls smoothly. Reading the note's file and the page asserts;
// only the clipboard seeds (a copy like any other) and opening notes are fixtures. Each fault below failed first:
// the heading completion wrote [[A#A#H]]; Tab appended a tab at a list line's end; Find opened with the keys still
// in the note; pasted tables had no rule; a drag did nothing. Timings print for the human; the asserts are hang
// guards, not budgets (the vault-speed-5k convention).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRenderer, loadCore, openServices, startBrowser, startServer, writeVault } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 240000 };

let H = null; // the harness, booted lazily by the first live test so the source test fails fast
let work = '';
let vaultDir = '';
const disk = (rel) => readFileSync(path.join(vaultDir, rel), 'utf8');
const linesOf = (rel) => disk(rel).split('\n');

async function boot() {
  if (H) return H;
  work = mkdtempSync(path.join(tmpdir(), 'nv-editor-walk-'));
  vaultDir = path.join(work, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeVault(vaultDir);
  writeFileSync(path.join(vaultDir, 'Walk.md'), '# Walk\n\nA note to walk in.\n\n## Pantry\n\nThe pantry shelf holds flour. ^pantry-shelf\n');
  const paras = ['# Long essay', ''];
  let n = 0;
  for (let s = 0; s < 12; s++) {
    paras.push(`## Section ${s + 1}`, '');
    for (let p = 0; p < 8; p++) {
      const words = [];
      for (let w = 0; w < 48; w++) words.push(`word${n++}`);
      paras.push(`${words.join(' ')}.`, '');
    }
    paras.push('- first point', '- second point', '');
  }
  writeFileSync(path.join(vaultDir, 'Long essay.md'), paras.join('\n'));
  mkdirSync(path.join(work, 'data'), { recursive: true });
  const core = await loadCore(work);
  const box = { current: await openServices(vaultDir, path.join(work, 'data'), core) };
  const distDir = await buildRenderer(work);
  const server = await startServer(distDir, () => box.current);
  const browser = await startBrowser(server.origin);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
  await browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  H = { server, browser, ev: browser.ev, send: (m, p) => browser.send(m, p) };
  return H;
}

after(async () => {
  if (!H) return;
  try { H.browser.close(); } catch {}
  try { H.server.close(); } catch {}
  rmSync(work, { recursive: true, force: true });
  H = null;
});

const K = { Enter: [13, 'Enter', 'Enter'], Tab: [9, 'Tab', 'Tab'], Escape: [27, 'Escape', 'Escape'], Backspace: [8, 'Backspace', 'Backspace'], Left: [37, 'ArrowLeft', 'ArrowLeft'], Up: [38, 'ArrowUp', 'ArrowUp'], Right: [39, 'ArrowRight', 'ArrowRight'], Down: [40, 'ArrowDown', 'ArrowDown'], End: [35, 'End', 'End'], Home: [36, 'Home', 'Home'] };
async function key(name, mod = 0) {
  let vk, k, code;
  if (K[name]) [vk, k, code] = K[name];
  else { vk = name.toUpperCase().charCodeAt(0); k = mod & 8 ? name.toUpperCase() : name.toLowerCase(); code = `Key${name.toUpperCase()}`; }
  await H.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: vk, key: k, code, modifiers: mod });
  await H.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: vk, key: k, code, modifiers: mod });
  await sleep(130);
}
const text = async (s) => { await H.send('Input.insertText', { text: s }); await sleep(150); };
const ev = (js) => H.ev(js);
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const flush = () => sleep(1500);
const IN_LIST = /^\s*([-*+]\s*(\[.\]\s*)?|\d+[.)]\s*|>\s?)/;

async function clickSel(sel, n = 0) {
  const pt = await ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }); const el = els[${n}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(pt, `clickable ${sel}#${n} is on screen`);
  const x = Math.round(pt.x), y = Math.round(pt.y);
  await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(350);
  return { x, y };
}

/** A click that only puts the keys in the note: the last drawn plain line (near the cursor, below any header,
 *  with no link to follow nor box to tick). The content's middle misses below the fold on a long note, and its
 *  first line can sit under the header or on a link that navigates away (t136, 9 Nov 2026). */
async function clickEditor() {
  const sel = '.cm-content .cm-line:not(:has(a,button,input,img,[class*="cm-nv-"]))';
  const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  assert.ok(n > 0, 'a plain line is drawn to click');
  await clickSel(sel, n - 1);
}

async function focusEditor() {
  // Every caller moves the cursor after this.
  await clickEditor();
  assert.equal(await ev(`!!document.querySelector('.cm-editor')?.contains(document.activeElement)`), true, 'the keys are in the note');
}

/** The quick switcher opens the note (real keys; the highlight starts on a command row, arrows walk the hits). */
async function openNote(name) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await key('Escape'); await sleep(350);
    await key('k', 2); await sleep(1000);
    await key('a', 2); await key('Backspace'); await sleep(300);
    await text(name); await sleep(1400);
    for (let i = 0; i < attempt; i++) await key('Down');
    await sleep(250);
    await key('Enter'); await sleep(1600);
    const at = await ev(`document.querySelector('.topbar .crumb')?.getAttribute('title') ?? ''`);
    if (String(at).endsWith(name)) return;
  }
  assert.fail(`the switcher never opened ${name}`);
}

/** A blank plain line at the file's end: Enter out of any list, then one blank line to type on. An empty quote
 *  clears with one Backspace (never two: the second joins lines, and the walk loops forever), then Enter gaps it —
 *  without the gap the next words are a lazy continuation of the quote and Enter keeps quoting them (t136, 9 Nov
 *  2026). Checked against the file, not the screen. */
async function freshLine() {
  await key('End', 2);
  for (let i = 0; i < 10; i++) {
    await sleep(1200);
    const last = linesOf('Walk.md').at(-1) ?? '';
    if (!IN_LIST.test(last)) {
      if (last !== '') {
        await key('Enter');
        await sleep(800);
        // Below a table, one more gap (t136, 9 Nov 2026): a table eats the line tight under it as another row,
        // so words typed there vanish into it — as on every Markdown page, a blank line sets them free.
        if (/^\s*\|/.test(last)) {
          await key('Enter');
          await sleep(800);
        }
      }
      return;
    }
    if (/^\s*>\s*$/.test(last)) {
      await key('Backspace');
      await sleep(400);
      await key('Enter');
    } else {
      await key('Enter');
    }
  }
  assert.fail('stuck inside a list');
}

const seedHtml = (html, plain) =>
  ev(`(async () => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([${JSON.stringify(html)}], { type: 'text/html' }), 'text/plain': new Blob([${JSON.stringify(plain)}], { type: 'text/plain' }) })]); return 'ok'; })()`);
const seedText = (s) => ev(`(async () => { await navigator.clipboard.writeText(${JSON.stringify(s)}); return 'ok'; })()`);
const seedImage = () =>
  ev(`(async () => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#1f6feb'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#fff'; g.fillRect(4, 4, 8, 8); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return 'ok:' + blob.size; })()`);

test('redo answers Ctrl+Shift+Z on every system, not only macOS and Linux', () => {
  const setup = read('src/renderer/src/editor/setup.ts');
  assert.match(setup, /key:\s*'Mod-Shift-z'[\s\S]{0,80}redo/, 'the editor binds Mod-Shift-z to redo itself (CodeMirror only binds it on macOS and Linux)');
});

test('the switcher opens the walk note with the keyboard', T, async () => {
  await boot();
  await openNote('Walk.md');
  assert.equal(await has('.cm-editor'), true, 'the note opens in the editor');
  await focusEditor();
});

test('typed Markdown renders; its marks hide away from the cursor', T, async () => {
  await freshLine();
  await text('## Pantry staples');
  await key('Enter');
  await text('- flour');
  await key('Enter');
  await key('Enter');
  await text('1. mix');
  await key('Enter');
  await key('Enter');
  await text('- [ ] buy yeast');
  await key('Enter');
  await key('Enter');
  await text('> day-old bread');
  await key('Enter');
  await sleep(1100);
  // An empty quote continues on Enter, so it clears with Backspace instead (freshLine does the same), then a gap:
  // words typed tight under a quote are its lazy continuation, and Enter would keep quoting them (t136, 9 Nov 2026).
  for (let i = 0; i < 3 && /^\s*>\s*$/.test(linesOf('Walk.md').at(-1) ?? 'x'); i++) {
    await key('Backspace');
    await sleep(600);
  }
  await key('Enter');
  await sleep(800);
  await text('A **bolded** and *slanted* word.');
  await key('Enter');
  await key('Enter');
  await flush();
  for (const line of ['## Pantry staples', '- flour', '1. mix', '- [ ] buy yeast', '> day-old bread', 'A **bolded** and *slanted* word.']) assert.ok(linesOf('Walk.md').includes(line), `the file keeps ${line}`);
  assert.ok(await ev(`[...document.querySelectorAll('.cm-nv-heading')].some((e) => e.innerText === 'Pantry staples')`), 'the heading draws without its ##');
  assert.equal(await has('.cm-nv-checkbox'), true, 'the tick-box draws');
});

test('Enter continues lists, renumbers, and starts task boxes fresh', T, async () => {
  await freshLine();
  await text('- apples');
  await key('Enter');
  await text('oranges');
  await key('Enter');
  await key('Enter');
  await text('- [ ] milk');
  await key('Enter');
  await text('bread');
  await key('Enter');
  await key('Enter');
  await text('1. first');
  await key('Enter');
  await text('second');
  await key('Enter');
  await key('Enter');
  await text('> quoted');
  await key('Enter');
  await text('still quoted');
  await key('Enter');
  await key('Enter');
  await flush();
  const all = linesOf('Walk.md');
  for (const line of ['- apples', '- oranges', '- [ ] milk', '- [ ] bread', '1. first', '2. second', '> quoted', '> still quoted']) assert.ok(all.includes(line), `continued as ${line}`);
});

test('Enter on an empty item leaves the list', T, async () => {
  await freshLine();
  await text('- ');
  await key('Enter');
  await text('1. ');
  await key('Enter');
  await text('- outer');
  await key('Enter');
  await key('Tab');
  await text('inner');
  await key('Enter');
  await key('Enter');
  await key('Enter');
  await flush();
  const all = linesOf('Walk.md');
  assert.ok(!all.includes('- ') && !all.includes('1. '), 'no empty marker is left behind');
  assert.ok(all.includes('- outer'), 'the outer item stays');
  assert.ok(all.includes('\t- inner'), 'the inner item indented with Tab');
});

test('Tab indents the list item itself, Shift+Tab outdents it', T, async () => {
  await freshLine();
  await text('- tabme');
  await key('End');
  await key('Tab');
  await flush();
  assert.ok(linesOf('Walk.md').includes('\t- tabme'), 'Tab at the end moves the item, not the words');
  await key('Tab', 8);
  await flush();
  assert.ok(linesOf('Walk.md').includes('- tabme'), 'Shift+Tab moves it back');
  // Mid-line too, and two lines at once as one undo step.
  await key('Home'); await key('Right'); await key('Right');
  await key('Tab');
  await flush();
  assert.ok(linesOf('Walk.md').includes('\t- tabme'), 'Tab mid-line still moves the item');
  await key('Tab', 8);
  await key('End');
  await key('Enter');
  await key('Enter');
  await text('- second');
  await key('End', 2);
  await key('Up', 8); await key('Up', 8);
  await key('Tab');
  await flush();
  assert.ok(linesOf('Walk.md').includes('\t- tabme') && linesOf('Walk.md').includes('\t- second'), 'both items indent together');
  await key('z', 2);
  await flush();
  assert.ok(linesOf('Walk.md').includes('- tabme') && linesOf('Walk.md').includes('- second'), 'one undo takes both back');
});

test('Ctrl+B and Ctrl+I wrap words and toggle back off', T, async () => {
  await freshLine();
  await text('make bold');
  for (let i = 0; i < 4; i++) await key('Left', 8);
  await key('b', 2);
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.endsWith('make **bold**')), 'the selection bolds');
  await key('b', 2);
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.endsWith('make bold')), 'Ctrl+B again takes it off');
  await key('Right');
  await text(' slanted');
  await key('i', 2);
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.includes('*slanted*')), 'the word at the cursor italicises');
  await key('i', 2);
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.includes('slanted') && !l.includes('*slanted*')), 'Ctrl+I again takes it off');
});

test('[[ suggests notes; arrows and Enter link one', T, async () => {
  await freshLine();
  await text('[[');
  await sleep(900);
  const n = await ev(`document.querySelectorAll('.cm-tooltip-autocomplete li').length`);
  assert.ok(n >= 3, `several notes are suggested (${n})`);
  const first = await ev(`document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')?.innerText?.slice(0, 24) ?? ''`);
  await key('Down'); await sleep(250);
  await key('Down'); await sleep(250);
  const picked = await ev(`document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')?.innerText?.slice(0, 24) ?? ''`);
  assert.ok(picked.length > 1 && picked !== first, `the arrows move the highlight (${first} -> ${picked})`);
  await key('Enter');
  await flush();
  const link = linesOf('Walk.md').slice(-2).find((l) => /\[\[.+\]\]/.test(l) && l.includes(picked.slice(0, 6)));
  assert.ok(link, `Enter links the highlighted note (${picked} -> ${link})`);
  await key('End'); await key('Enter');
  await sleep(700);
  assert.equal(await has('.cm-nv-wikilink'), true, 'away from the cursor the link draws as a link');
});

test('[[ links a heading without writing the note twice', T, async () => {
  await freshLine();
  await text('[[Harbourline Cart Fix#');
  await sleep(1100);
  assert.equal(await has('.cm-tooltip-autocomplete'), true, 'its headings are suggested');
  await text('Sum');
  await sleep(700);
  await key('Enter');
  await flush();
  assert.ok(linesOf('Walk.md').includes('[[Harbourline Cart Fix#Summary]]'), `exactly one target, got: ${linesOf('Walk.md').slice(-3).join(' | ')}`);
});

test('[[ links a block without writing the note twice', T, async () => {
  await freshLine();
  await text('[[Walk#^pan');
  await sleep(1100);
  assert.equal(await has('.cm-tooltip-autocomplete'), true, 'its blocks are suggested');
  await key('Enter');
  await flush();
  assert.ok(linesOf('Walk.md').includes('[[Walk#^pantry-shelf]]'), `exactly one target, got: ${linesOf('Walk.md').slice(-3).join(' | ')}`);
});

test('Tab takes the highlighted suggestion', T, async () => {
  await freshLine();
  await text('[[Rece');
  await sleep(1000);
  const first = await ev(`document.querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')?.innerText?.replace(/\\n/g, '>').slice(0, 30) ?? ''`);
  assert.ok(first.length > 1, 'a suggestion is highlighted');
  await key('Tab');
  await flush();
  assert.equal(await has('.cm-tooltip-autocomplete'), false, 'the suggestions close');
  assert.ok(linesOf('Walk.md').some((l) => l.includes('[[Receipts')), `Tab links it, got: ${linesOf('Walk.md').slice(-2).join(' | ')}`);
});

test('rich words pasted from a page arrive as clean Markdown', T, async () => {
  await seedHtml(
    '<h2>Market list</h2><p>Buy <b>flour</b> and <i>yeast</i>.</p><ul><li>flour</li><li>yeast</li></ul><p>See <a href="https://example.invalid/shop">the shop</a>.</p>',
    'Market list Buy flour and yeast.',
  );
  await focusEditor();
  await freshLine();
  await key('v', 2);
  await flush();
  const all = linesOf('Walk.md');
  for (const line of ['## Market list', 'Buy **flour** and *yeast*.', '- flour', '- yeast', 'See [the shop](https://example.invalid/shop).']) assert.ok(all.includes(line), `pasted as ${line}`);
});

test('a pasted table keeps the rule it needs to draw', T, async () => {
  await seedHtml('<table><tr><th>Item</th><th>Qty</th></tr><tr><td>Flour</td><td>2 kg</td></tr></table>', 'Item Qty Flour 2 kg');
  await focusEditor();
  await freshLine();
  await key('v', 2);
  await flush();
  const all = linesOf('Walk.md');
  assert.ok(all.includes('| Item | Qty |') && all.includes('| --- | --- |') && all.includes('| Flour | 2 kg |'), `a whole table, got: ${all.slice(-5).join(' | ')}`);
  await key('End', 2); await key('Enter'); await sleep(700);
  assert.equal(await has('.cm-nv-table'), true, 'away from the cursor it draws as a table');
});

test('a pasted numbered list keeps its numbers', T, async () => {
  await seedHtml('<ol><li>Mix</li><li>Rest overnight</li><li>Bake</li></ol>', 'Mix Rest overnight Bake');
  await focusEditor();
  await freshLine();
  await key('v', 2);
  await flush();
  const all = linesOf('Walk.md');
  assert.ok(all.includes('1. Mix') && all.includes('2. Rest overnight') && all.includes('3. Bake'), `numbered, got: ${all.slice(-4).join(' | ')}`);
});

test('a pasted link wraps the selected words', T, async () => {
  await seedText('https://example.invalid/shop');
  await focusEditor();
  await freshLine();
  await text('our shop');
  for (let i = 0; i < 8; i++) await key('Left', 8);
  await key('v', 2);
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.includes('[our shop](https://example.invalid/shop)')), `linked, got: ${linesOf('Walk.md').slice(-2).join(' | ')}`);
});

test('a pasted picture is saved into the vault and shown', T, async () => {
  const seeded = await seedImage();
  assert.match(seeded, /^ok:/, 'the picture copies');
  await focusEditor();
  await freshLine();
  await key('v', 2);
  await sleep(3000);
  const line = linesOf('Walk.md').find((l) => l.includes('.png]]'));
  assert.ok(line && line.includes('![['), `an embed lands in the note, got: ${linesOf('Walk.md').slice(-2).join(' | ')}`);
  const base = /\[\[([^|\]]+\.png)\]\]/.exec(line)[1].split('/').pop();
  const found = [];
  const walk = (d) => { for (const e of readdirSync(path.join(vaultDir, d), { withFileTypes: true })) { const r = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(r); else if (e.name === base) found.push(r); } };
  walk('');
  assert.equal(found.length, 1, `the picture file is in the vault (${base})`);
  assert.ok(existsSync(path.join(vaultDir, found[0])), 'its bytes are on disk');
  await key('Enter');
  await flush();
  const at = linesOf('Walk.md').findIndex((l) => l.includes('.png]]'));
  assert.equal(linesOf('Walk.md')[at + 1], '', 'Enter after the paste opens below the picture, not above it');
  const img = await ev(`(() => { const img = document.querySelector('.cm-nv-embed img, img.cm-nv-image'); return img ? img.getAttribute('src') : null; })()`);
  assert.ok(img && img.includes(encodeURIComponent(base).slice(0, 20)), `the picture draws in the note (${img})`);
});

test('slash makes a table; Tab walks its cells', T, async () => {
  await freshLine();
  await text('/');
  await sleep(900);
  assert.ok(await ev(`[...document.querySelectorAll('.cm-tooltip-autocomplete li')].some((e) => e.innerText.includes('Table'))`), 'Table is offered');
  await text('Table');
  await sleep(700);
  await key('Enter');
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => /^\| Column 1/.test(l)), 'the table lands');
  await key('Tab');
  assert.equal(await ev(`window.getSelection()?.toString()`), 'Column 2', 'Tab into a cell selects its words, as a form does');
  await text('Flour');
  await key('Tab');
  assert.equal(await ev(`window.getSelection()?.toString()`), 'Column 3', 'Tab selects the next cell too');
  await text('2 kg');
  await flush();
  // In this table's own line (t136, 9 Nov 2026: `Flour` alone also matches the pasted table above, so a bare
  // `includes('Flour')` passes and fails for the wrong table). Typed words replace the starter values.
  assert.ok(linesOf('Walk.md').some((l) => l.includes('| Column 1 | Flour | 2 kg |')), `the cells take words, got: ${linesOf('Walk.md').slice(-6).join(' | ')}`);
  await key('Tab', 8);
  assert.equal(await ev(`window.getSelection()?.toString()`), 'Flour', 'Shift+Tab selects the cell back');
  await text('Brown flour');
  await key('Tab');
  await key('Left');
  assert.equal(await ev(`window.getSelection()?.isCollapsed`), true, 'an arrow key leaves a cursor, not a selection');
  await text('x');
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.includes('| Column 1 | Brown flour | x2 kg |')), `after an arrow, words insert, got: ${linesOf('Walk.md').slice(-6).join(' | ')}`);
  const at = await ev(`(() => { const els = [...document.querySelectorAll('.cm-content .cm-line')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }); return els.findIndex((e) => (e.innerText || '').includes('x2 kg')); })()`);
  assert.ok(at >= 0, 'the table line is drawn to click');
  await clickSel('.cm-content .cm-line', at);
  assert.equal(await ev(`window.getSelection()?.isCollapsed`), true, 'a click puts a cursor, not a selection');
  await key('End');
  await text('zz');
  await flush();
  assert.ok(linesOf('Walk.md').some((l) => l.includes('| Column 1 | Brown flour | x2 kg |zz')), `after a click, words insert, got: ${linesOf('Walk.md').slice(-6).join(' | ')}`);
  await key('z', 2); await key('z', 2); await key('z', 2); await key('z', 2); await key('z', 2);
  await flush();
  assert.ok(linesOf('Walk.md').includes('| Column 1 | Column 2 | Column 3 |'), 'undo takes the cell words back out');
});

test('an embed and a code block draw', T, async () => {
  await freshLine();
  await text('![[Receipts v2]]');
  await key('Enter'); await key('Enter');
  await sleep(900);
  await flush();
  assert.ok(linesOf('Walk.md').includes('![[Receipts v2]]'), `the embed line lands, got: ${linesOf('Walk.md').slice(-3).join(' | ')}`);
  assert.equal(await has('.cm-nv-embed'), true, 'the embed draws');
  assert.match(await ev(`document.querySelector('.cm-nv-embed')?.innerText ?? ''`), /Receipts v2/, 'with the linked note inside');
  await freshLine();
  await text('```js');
  await key('Enter');
  await text('const total = 12 * 4;');
  await key('Enter');
  await text('```');
  await key('Enter'); await key('Down');
  await sleep(900);
  assert.equal(await has('.cm-nv-codeblock-begin'), true, 'the code block draws');
  assert.equal(await ev(`document.querySelector('.cm-nv-code-lang')?.innerText ?? ''`), 'js', 'with its language');
});

test('undo and redo hold across typing, links and tables', T, async () => {
  await freshLine();
  await text('undo me');
  await sleep(1200);
  const shown = () => ev(`document.querySelector('.cm-content')?.innerText?.includes('undo me') ?? false`);
  assert.equal(await shown(), true, 'typed');
  await key('z', 2); await sleep(900);
  assert.equal(await shown(), false, 'Ctrl+Z takes it');
  await key('y', 2); await sleep(900);
  assert.equal(await shown(), true, 'Ctrl+Y brings it back');
  await key('z', 2); await sleep(900);
  await key('Z', 10); await sleep(900);
  assert.equal(await shown(), true, 'Ctrl+Shift+Z brings it back too');
  // A link lands and leaves as one step. Counted, not just present (t136, 9 Nov 2026: the embed above holds
  // `[[Receipts v2]]` inside `![[Receipts v2]]`, so a bare `includes` passes and fails for the wrong line).
  const links = () => disk('Walk.md').split('[[Receipts v2]]').length - 1;
  const before = links();
  await freshLine();
  await text('[[');
  await sleep(700);
  await text('Receipts v2');
  await sleep(800);
  await key('Enter');
  await flush();
  assert.equal(links(), before + 1, 'the suggested link lands');
  await key('z', 2);
  await flush();
  assert.equal(links(), before, 'one undo takes the whole link');
  await key('y', 2);
  await flush();
  assert.equal(links(), before + 1, 'redo puts it back');
});

test('Ctrl+F opens Find with the keys in its box', T, async () => {
  await focusEditor();
  await freshLine();
  await key('f', 2);
  await sleep(700);
  assert.equal(await has('.cm-search'), true, 'the Find box opens');
  assert.equal(await ev(`document.activeElement?.getAttribute('name') ?? ''`), 'search', 'the keys land in it');
  await text('qqXZ12milk');
  // A real key after pasted words: the Find box only takes its query on keyup or change, which inserted
  // words never fire (t136, 9 Nov 2026: without this the box shows the words but nothing matches).
  await key('End');
  await sleep(700);
  assert.equal(await ev(`document.querySelector('.cm-search input[name=search]')?.value ?? ''`), 'qqXZ12milk', 'typing searches');
  assert.ok(!disk('Walk.md').includes('qqXZ12milk'), 'typing never touches the note');
  await key('Escape'); await sleep(400);
  await key('f', 2); await sleep(700);
  await key('a', 2); await key('Backspace'); await sleep(250);
  await text('milk');
  await key('End');
  await sleep(700);
  assert.equal(await ev(`!!document.querySelector('.cm-searchMatch')`), true, 'matches light up');
  await key('Enter'); await sleep(500);
  assert.equal(await ev(`window.getSelection().toString()`), 'milk', 'Enter walks to a match');
  await key('Escape'); await sleep(400);
  assert.equal(await has('.cm-search'), false, 'Escape puts it away');
});

test('Find and replace puts words in', T, async () => {
  await focusEditor();
  await freshLine();
  await text('swapme and swapme');
  await key('Enter');
  await flush();
  await key('h', 2);
  await sleep(700);
  assert.equal(await ev(`document.activeElement?.getAttribute('name') ?? ''`), 'replace', 'the keys land in Replace');
  await clickSel('.cm-search input[name="search"]');
  await key('a', 2); await key('Backspace'); await sleep(250);
  await text('swapme'); await sleep(500);
  await clickSel('.cm-search input[name="replace"]');
  await key('a', 2); await key('Backspace'); await sleep(250);
  await text('SWAPPED'); await sleep(400);
  await clickSel('.cm-search button[name="replaceAll"]');
  await flush();
  assert.ok(!disk('Walk.md').includes('swapme'), 'every swapme is gone');
  assert.equal(disk('Walk.md').split('SWAPPED').length - 1, 2, 'both read SWAPPED');
  await key('Escape'); await sleep(400);
});

test('dragging selected words moves them; a click only moves the cursor', T, async () => {
  await focusEditor();
  await freshLine();
  await text('alpha beta gamma');
  await flush();
  // The drop point first (the caret at the line's end), then ` beta` with its leading space: dropped at the
  // end it reads `alpha gamma beta`.
  await key('End', 2);
  const last = await ev(`(() => { const r = window.getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + 6, y: r.y + r.height / 2 }; })()`);
  for (let i = 0; i < 6; i++) await key('Left');
  for (let i = 0; i < 5; i++) await key('Left', 8);
  assert.equal(await ev(`window.getSelection().toString()`), ' beta', ' beta is selected');
  const from = await ev(`(() => { const r = window.getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x), y: Math.round(from.y) });
  await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (last.x - from.x) * (i / 8)), y: Math.round(from.y + (last.y - from.y) * (i / 8)) });
    await sleep(60);
  }
  await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(last.x), y: Math.round(last.y), button: 'left', clickCount: 1 });
  await flush();
  assert.ok(linesOf('Walk.md').includes('alpha gamma beta'), `the words move, got: ${linesOf('Walk.md').slice(-2).join(' | ')}`);
  await key('z', 2);
  await flush();
  assert.ok(linesOf('Walk.md').includes('alpha beta gamma'), 'one undo puts them back');
  // A press without moving only puts the cursor down; Shift+click still reaches out.
  await clickEditor();
  assert.equal(await ev(`window.getSelection().toString()`), '', 'a click collapses the selection');
  assert.ok(linesOf('Walk.md').includes('alpha beta gamma'), 'and moves no words');
  await key('End', 2); await key('Home');
  const a = await ev(`(() => { const els = [...document.querySelectorAll('.cm-line')]; const r = els[els.length - 1].getBoundingClientRect(); return { x: r.x + 8, y: r.y + r.height / 2 }; })()`);
  const b = await ev(`(() => { const els = [...document.querySelectorAll('.cm-line')]; const r = els[els.length - 1].getBoundingClientRect(); return { x: r.x + r.width - 8, y: r.y + r.height / 2 }; })()`);
  await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x), y: Math.round(a.y) });
  await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(a.x), y: Math.round(a.y), button: 'left', clickCount: 1 });
  await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(a.x), y: Math.round(a.y), button: 'left', clickCount: 1 });
  await sleep(300);
  await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(b.x), y: Math.round(b.y) });
  await H.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 16, key: 'Shift', code: 'ShiftLeft', modifiers: 8 });
  await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1, modifiers: 8 });
  await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1, modifiers: 8 });
  await H.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 16, key: 'Shift', code: 'ShiftLeft' });
  await sleep(400);
  assert.ok((await ev(`window.getSelection().toString()`)).length > 10, 'Shift+click reaches across the line');
  await key('Escape'); await key('End', 2);
});

test('Alt+Up and Alt+Down move the line', T, async () => {
  await focusEditor();
  await freshLine();
  await text('lineA');
  await key('Enter');
  await text('lineB');
  await key('Enter');
  await flush();
  await key('Up');
  await key('Up', 1);
  await flush();
  const all = linesOf('Walk.md');
  assert.ok(all.indexOf('lineB') < all.indexOf('lineA'), 'Alt+Up lifts the line over');
  await key('Down', 1);
  await flush();
  const again = linesOf('Walk.md');
  assert.ok(again.indexOf('lineA') < again.indexOf('lineB'), 'Alt+Down sets it back');
});

test('a tick-box ticks where it is shown', T, async () => {
  await focusEditor();
  await freshLine();
  await text('- [ ] tickme');
  await key('Enter'); await key('Enter');
  await flush();
  const box = await ev(`(() => { const l = [...document.querySelectorAll('.cm-line')].find((e) => e.textContent.includes('tickme')); const b = l?.querySelector('.cm-nv-checkbox'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(box, 'its box draws in the note');
  const click = async () => {
    await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y) });
    await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
    await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
    await flush();
  };
  await click();
  assert.ok(linesOf('Walk.md').includes('- [x] tickme'), 'one click ticks it');
  await click();
  assert.ok(linesOf('Walk.md').includes('- [ ] tickme'), 'another unticks it');
});

test('a 5,000-word note types instantly and scrolls smoothly', T, async () => {
  await openNote('Long essay.md');
  await focusEditor();
  await key('End', 2);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await H.send('Input.insertText', { text: `z${i}q` });
    for (let j = 0; j < 80; j++) {
      await sleep(15);
      try {
        if (await ev(`document.querySelector('.cm-content').textContent.includes('z${i}q')`)) break;
      } catch {}
    }
    samples.push(Date.now() - t0);
  }
  console.log(`      keystrokes: ${samples.join('ms, ')}ms`);
  for (const s of samples) assert.ok(s < 2000, `a keystroke lands fast (${s} ms: hang guard)`);
  let last = await ev(`document.querySelector('.cm-scroller')?.scrollTop ?? -1`);
  for (let i = 0; i < 12; i++) {
    await H.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: 500 });
    await sleep(70);
    const y = await ev(`document.querySelector('.cm-scroller')?.scrollTop ?? -1`);
    assert.ok(y >= last, 'scrolling never jumps back');
    last = y;
  }
  assert.ok(last > 3000, `the wheel runs the whole note (${last}px)`);
  assert.ok((await ev(`document.querySelectorAll('.cm-line').length`)) >= 10, 'lines draw as it scrolls');
  assert.deepEqual(await ev(`window.__nvErrors.slice(0, 3)`), [], 'nothing errors on the long note');
});
