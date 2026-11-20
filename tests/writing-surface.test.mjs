// node --test tests/writing-surface.test.mjs — v6 "the note is the point" (5 Nov 2026): the writing surface.
// Move-line keys and the other installed CodeMirror commands (the stock keymap already answers Alt+Up/Down: the
// commands make them listed, remappable palette citizens); live code highlighting equal to Reading; callout bodies
// that read dark; one Linked list at the note's foot from backlinks, mentions and related, fetched once; the reading
// column pinned and well set at 3456; block-id completion; link fragments that never crash the editor.
// Fails first (no line commands, monochrome live code, blue callout bodies, three foot tabs, island column).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── node-side: labels, keys, highlight spec ────────────────────────────────────

const work = mkdtempSync(path.join(tmpdir(), 'nv-writing-surface-'));
let R;
let NL;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  // The page renderer, with the window's link lookups stood in for (labels need no lookups).
  const stub = path.join(work, 'resolve-stub.ts');
  writeFileSync(stub, 'export const fileUrl = (p: string) => p;\nexport const isAudio = () => false;\nexport const isImage = () => false;\nexport const isPdf = () => false;\nexport const isVideo = () => false;\nexport const resolveAny = () => null;\nexport const resolveFile = () => null;\n');
  const entry = path.join(work, 'render.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};\n`);
  await build({ input: entry, platform: 'node', plugins: [{ name: 'stub-resolve', resolveId: (id, importer) => (id === './resolve' && importer?.endsWith('markdownRender.ts') ? stub : null) }], output: { file: path.join(work, 'render.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'render.mjs')).href);
  // The one links read, with React stood in for (fetching needs no React).
  const reactStub = path.join(work, 'react-stub.mjs');
  writeFileSync(reactStub, 'export const useEffect = () => {};\nexport const useState = (v) => [v, () => {}];\n');
  const linksEntry = path.join(work, 'links.ts');
  writeFileSync(linksEntry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/noteLinks.ts'))};\n`);
  await build({ input: linksEntry, platform: 'node', plugins: [{ name: 'stub-react', resolveId: (id) => (id === 'react' ? reactStub : null) }], output: { file: path.join(work, 'links.mjs'), format: 'esm' }, logLevel: 'silent' });
  NL = await import(pathToFileURL(path.join(work, 'links.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('Reading shows a link as the note’s name, not its path', () => {
  const html = R.renderMarkdown('See [[People/Alex Chen]] and [[Kickoff]] and [[People/Alex Chen#Early days]].');
  assert.ok(html.includes('>Alex Chen</a>'), 'the name shows');
  assert.ok(html.includes('>Kickoff</a>'), 'a bare name is untouched');
  assert.ok(html.includes('>Alex Chen › Early days</a>'), 'a heading link shortens its note too');
  assert.doesNotMatch(html, />People\/Alex Chen/, 'no full path as a label');
  assert.ok(html.includes('data-href="People/Alex Chen"'), 'the target still addresses the note');
});

test('move, copy, delete and select line are commands with the line keys', () => {
  const src = read('src/renderer/src/state/commands.ts');
  for (const [id, combo] of [['move-line-up', 'Alt+Up'], ['move-line-down', 'Alt+Down'], ['copy-line-up', 'Alt+Shift+Up'], ['copy-line-down', 'Alt+Shift+Down']]) {
    assert.ok(src.includes(`id: '${id}'`), `${id} is a command`);
    assert.ok(src.includes(combo), `${id} answers ${combo}`);
  }
  for (const id of ['delete-line', 'select-line']) assert.ok(src.includes(`id: '${id}'`), `${id} is a command (bound in Settings › Keys)`);
  assert.ok(src.includes('@codemirror/commands'), 'from the installed CodeMirror, not hand-rolled');
  assert.ok(src.includes(`id: 'find', name: 'Find in this note', hotkey: 'Mod+F'`), 'find says Mod+F in Settings › Keys, the key it always answered');
});

test('the editor colours code with the reading palette, in one highlight style', () => {
  const src = read('src/renderer/src/editor/setup.ts');
  assert.doesNotMatch(src, /fallback:\s*true/, 'no fallback style (a fallback only applies with no main style: it left code monochrome)');
  for (const cls of ['tok-keyword', 'tok-string', 'tok-number', 'tok-bool', 'tok-atom', 'tok-comment', 'tok-definition', 'tok-function', 'tok-typeName', 'tok-className', 'tok-propertyName', 'tok-punctuation', 'tok-meta']) {
    assert.ok(src.includes(`'${cls}'`), `code ${cls}, as Reading emits`);
  }
});

test('the line being worked on, bracket pairs and indenting are micro-polished', () => {
  const src = read('src/renderer/src/editor/setup.ts');
  for (const ext of ['bracketMatching(', 'indentOnInput(', 'highlightActiveLine(']) assert.ok(src.includes(ext), `${ext}) installed`);
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('.cm-editor .cm-content .cm-activeLine'), 'the working line’s wash is ours, not the stock light blue');
  assert.ok(kit.includes('color-mix(in srgb, var(--text-strong) 4%, transparent)'), 'a breath of neutral ink');
});

test('a note’s links arrive even when one read fails, and once only', async () => {
  const down = async () => { throw new Error('engine down'); };
  const calls = [];
  globalThis.window = { nv: { index: {
    backlinks: async () => { calls.push('b'); return [{ source: 'a.md' }]; },
    unlinked: down,
    relatedNotes: async () => { calls.push('r'); return [{ path: 'b.md' }]; },
  } } };
  try {
    const one = await NL.fetchNoteLinks('n.md', 1);
    assert.equal(one.backlinks.length, 1, 'backlinks arrive');
    assert.deepEqual(one.unlinked, [], 'the failed read is empty, never fatal');
    assert.equal(one.related.length, 1, 'related arrives');
    await NL.fetchNoteLinks('n.md', 1);
    assert.deepEqual(calls, ['b', 'r'], 'read once at a revision, shared after');
    globalThis.window.nv.index.backlinks = down;
    globalThis.window.nv.index.relatedNotes = down;
    await assert.rejects(() => NL.fetchNoteLinks('n.md', 2), 'nothing arrived: the read fails, so the surface keeps its last list');
  } finally {
    delete globalThis.window;
  }
});

test('the tick-box comment names its key', () => {
  assert.ok(read('src/renderer/src/editor/commands.ts').includes('Mod+L'), 'cycleTask says Mod+L, the registry’s binding');
});

test('callout kinds colour their titles, never their bodies', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  // The markdown kinds keep their tinted wash; their words read dark, their titles carry the kind colour.
  assert.ok(kit.includes('.callout-tip, .callout-info { background: var(--blue-bg); }'), 'tip bodies keep only the wash');
  assert.ok(kit.includes('.callout-tip > .callout-title, .callout-info > .callout-title { color: var(--blue-tx); }'), 'tip titles carry the blue');
  assert.ok(kit.includes('.callout.blue { background: var(--blue-bg); color: var(--blue-tx); }'), 'the UI’s own blue box is untouched');
});

// ── browser: the surface as a person sees it ───────────────────────────────────

const { startHarness } = await import('./vault-controls-harness.mjs');
let H;
let ev;
let send;
const key = async (keyName, code, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
};
// Every editor test starts live: toggle back from Reading when needed and wait for the editor.
const ensureLive = async () => {
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!document.querySelector('.cm-editor')`)) return;
    await key('e', 'KeyE', 2);
    await sleep(800);
  }
  assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note is live to edit');
};

before(async () => {
  H = await startHarness();
  ev = H.browser.ev;
  send = (m, p) => H.browser.send(m, p);
  for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
  await sleep(1500);
  writeFileSync(path.join(H.vaultDir, 'Harbourline launch plan.md'), `---
type: note
tags: [harbourline, launch]
---

# Harbourline launch plan

The shop's new checkout goes live on Friday. See [[People/Alex Chen]] and the [[Kickoff]] decisions.

> [!tip] Read this first
> The retry fix must be live before Thursday noon.

## How the retry works

\`\`\`js
const greeting = "hello";
if (ready) launch(42);
\`\`\`

A marked block sits here. ^taste

## Longer reading

${Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}. The harbour shop sells rope, canvas and brass fittings to weekend sailors.`).join('\n\n')}
`);
  writeFileSync(path.join(H.vaultDir, 'Launch retro.md'), '# Launch retro\n\nWhat worked: the [[Harbourline launch plan]] held up.\n');
  writeFileSync(path.join(H.vaultDir, 'Standup notes.md'), '# Standup notes\n\nThe Harbourline launch plan meeting ran long.\n');
  await H.services.rescanAll();
  await send('Page.navigate', { url: `${H.origin}/harness.html` });
  for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
  await sleep(1500);
  await ev(`window.__nvCalls.length = 0`);
  await key('o', 'KeyO', 2);
  await sleep(1200);
  await send('Input.insertText', { text: 'Harbourline launch plan' });
  await sleep(1200);
  await key('Enter', 'Enter', 0);
  await sleep(4500);
  assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens in the editor');
}, 240000);

after(async () => H && (await H.close()));

test('backlinks, mentions and related are each fetched once per note', async () => {
  // The foot and the rail have read since the note opened. The key jumps to the foot's Linked list, never refetching.
  await ensureLive();
  await ev(`window.__nvCalls.length = 0`);
  await key('B', 'KeyB', 10); // Mod+Shift+B: links to this note (t22-note-once: the foot, not the side)
  await sleep(2000);
  const seen = await ev(`(() => {
    const foot = document.querySelector('.note-foot');
    const scroller = document.querySelector('.note-editor .cm-scroller');
    if (!foot || !scroller) return false;
    const f = foot.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return f.top < s.bottom - 40 && f.bottom > s.top;
  })()`);
  assert.ok(seen, 'the key lands on the foot’s Linked list');
  assert.equal(await ev(`document.querySelectorAll('.sidebar.right').length`), 0, 'the side stays shut');
  const footText = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
  assert.ok(footText.includes('Launch retro'), 'the foot shows its backlinks');
  const panelCounts = await ev(`(() => {
    const calls = window.__nvCalls || [];
    const n = (k) => calls.filter((c) => c === k).length;
    return { backlinks: n('index.backlinks'), unlinked: n('index.unlinked'), related: n('index.relatedNotes') };
  })()`);
  assert.equal(panelCounts.backlinks, 0, `the jump reuses the foot's backlinks (saw ${panelCounts.backlinks} refetch)`);
  assert.equal(panelCounts.unlinked, 0, `the jump reuses the foot's mentions (saw ${panelCounts.unlinked} refetch)`);
  assert.equal(panelCounts.related, 0, 'the jump reuses the foot’s related read');
  // Back to the top (later tests start from the words, as a person would).
  await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 0)`);
  await sleep(800);
});

test('live code is coloured as Reading colours it', async () => {
  await ensureLive();
  const spans = await ev(`document.querySelectorAll('.cm-content .tok-keyword, .cm-content .tok-string, .cm-content .tok-number').length`);
  assert.ok(spans >= 3, `code spans coloured live (saw ${spans})`);
});

test('a tip callout’s body reads dark, its title carries the blue', async () => {
  await key('e', 'KeyE', 2); // Reading
  await sleep(3500);
  const colours = await ev(`(() => {
    const tip = document.querySelector('.reading-body .callout-tip');
    if (!tip) return null;
    const p = document.querySelector('.reading-body p');
    return { body: getComputedStyle(tip.querySelector('.callout-content')).color, para: p ? getComputedStyle(p).color : null, title: getComputedStyle(tip.querySelector('.callout-title')).color };
  })()`);
  assert.ok(colours, 'a tip callout renders in Reading');
  assert.equal(colours.body, colours.para, `the body reads as text (body ${colours.body}, text ${colours.para})`);
  assert.notEqual(colours.title, colours.para, `the title carries the kind colour (${colours.title})`);
  await key('e', 'KeyE', 2); // back to Live
  await sleep(2500);
});

test('Alt+Down moves the line down, Alt+Up brings it back', async () => {
  await ensureLive();
  const before = await ev(`[...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\\n').slice(0, 400)`);
  assert.ok(before.includes("The shop's new checkout"), 'the opening line is there to move');
  // Put the cursor on the opening line with a trusted click, then move it.
  const pt = await ev(`(() => { const l = [...document.querySelectorAll('.cm-content .cm-line')].find((x) => x.textContent.includes("The shop's new checkout")); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  assert.ok(pt, 'the line is on screen');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(800);
  await key('ArrowDown', 'ArrowDown', 1); // Alt+Down
  await sleep(1200);
  const afterDown = await ev(`[...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\\n').slice(0, 400)`);
  assert.notEqual(afterDown, before, 'Alt+Down moves the line');
  await key('ArrowUp', 'ArrowUp', 1); // Alt+Up
  await sleep(1200);
  const afterUp = await ev(`[...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\\n').slice(0, 400)`);
  assert.equal(afterUp, before, 'Alt+Up moves it back');
});

test('Alt+Shift+Down copies the line below', async () => {
  await ensureLive();
  const countLine = `[...document.querySelectorAll('.cm-content .cm-line')].filter((x) => x.textContent.includes("The shop's new checkout")).length`;
  assert.equal(await ev(countLine), 1, 'one opening line before the copy');
  const pt = await ev(`(() => { const l = [...document.querySelectorAll('.cm-content .cm-line')].find((x) => x.textContent.includes("The shop's new checkout")); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(800);
  await key('ArrowDown', 'ArrowDown', 9); // Alt+Shift+Down
  await sleep(1200);
  assert.equal(await ev(countLine), 2, 'the line is copied below');
  await key('z', 'KeyZ', 2); // Ctrl+Z puts it back
  await sleep(1200);
  assert.equal(await ev(countLine), 1, 'undo removes the copy');
});

test('the working line carries a whisper, and brackets answer in pairs', async () => {
  await ensureLive();
  const pt = await ev(`(() => { const l = [...document.querySelectorAll('.cm-content .cm-line')].find((x) => x.textContent.includes("The shop's new checkout")); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  assert.ok(pt, 'the opening line is on screen');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(800);
  const wash = await ev(`(() => { const l = document.querySelector('.cm-content .cm-activeLine'); return l ? getComputedStyle(l).backgroundColor : null; })()`);
  assert.ok(wash, 'the working line is marked');
  // color(srgb r g b / a): neutral ink at a breath of alpha, never the stock light blue (#cceeff44).
  const m = /color\(srgb ([0-9.]+) ([0-9.]+) ([0-9.]+) \/ ([0-9.]+)\)/.exec(wash);
  assert.ok(m, `the wash is a faint tint (saw ${wash})`);
  const [r, g, b, a] = m.slice(1).map(Number);
  assert.ok(a <= 0.08, `a breath, not a bar (alpha ${a})`);
  // As seen, composited over the white page: near-white and neutral, never the stock light blue.
  const over = [r, g, b].map((c) => c * a + (1 - a));
  assert.ok(Math.min(...over) >= 0.93, `a whisper of ink (${wash})`);
  assert.ok(Math.abs(over[0] - over[1]) < 0.012 && Math.abs(over[1] - over[2]) < 0.012, `neutral, never blue (${wash})`);
  // A fresh pair on the last line: stepping between the brackets lights both.
  await ev(`[...document.querySelectorAll('.cm-content .cm-line')].pop()?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  const end = await ev(`(() => { const lines = [...document.querySelectorAll('.cm-content .cm-line')]; const l = lines[lines.length - 1]; const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await sleep(600);
  await key('End', 'End', 0);
  await sleep(300);
  await send('Input.insertText', { text: ' ()' });
  await sleep(500);
  await key('ArrowLeft', 'ArrowLeft', 0);
  await sleep(800);
  assert.ok(await ev(`document.querySelectorAll('.cm-matchingBracket').length >= 1`), 'the pair lights together');
});

test('the foot is one Linked list from backlinks, mentions and related', async () => {
  await ensureLive();
  // The foot's widget only draws near the viewport: scroll the note to its end first.
  await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 1e9)`);
  await sleep(1200);
  const foot = await ev(`(() => {
    const el = document.querySelector('.note-foot');
    if (!el) return null;
    return { tabs: el.querySelectorAll('.foot-tab').length, text: el.textContent.slice(0, 1200) };
  })()`);
  assert.ok(foot, 'the foot renders');
  assert.equal(foot.tabs, 0, 'no tabs: one list');
  // Each row says how it is linked (t7-note-window, 8 Nov 2026: one list, not three sections).
  assert.ok(/Links here|Connected/.test(foot.text), 'backlinks show in the list');
  assert.ok(/Mentions/.test(foot.text), 'mentions show in the list');
  assert.ok(/Related/.test(foot.text), 'related notes show in the list');
  assert.ok(/Launch retro/.test(foot.text), 'a note that links here is named');
});

test('a mention becomes a link from the foot', async () => {
  await ensureLive();
  await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 1e9)`);
  await sleep(1200);
  const clicked = await ev(`(() => { const b = [...document.querySelectorAll('.note-foot .foot-link-it')].find((x) => !x.disabled); if (!b) return false; b.click(); return true; })()`);
  assert.ok(clicked, 'a mention offers Link it');
  await sleep(3500);
  const text = readFileSync(path.join(H.vaultDir, 'Standup notes.md'), 'utf8');
  assert.ok(text.includes('[[Harbourline launch plan]]'), 'the plain words are a link now');
});

test('past 2400px the reading column widens and pins, never an island', async () => {
  await ensureLive();
  await send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const narrow = await ev(`document.querySelector('.note-view.readable .note-editor .cm-content')?.getBoundingClientRect().width ?? 0`);
  await send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const wide = await ev(`document.querySelector('.note-view.readable .note-editor .cm-content')?.getBoundingClientRect().width ?? 0`);
  assert.ok(narrow > 600 && narrow < 950, `a reading measure at 1219 (saw ${Math.round(narrow)})`);
  assert.ok(wide > 1000, `wider at 3456, never a lost island (saw ${Math.round(wide)})`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
});

test('[[#^ completes the note’s block ids', async () => {
  await ensureLive();
  await ev(`[...document.querySelectorAll('.cm-content .cm-line')].pop()?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  const pt = await ev(`(() => { const lines = [...document.querySelectorAll('.cm-content .cm-line')]; const l = lines[lines.length - 1]; const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(800);
  await key('End', 'End', 0);
  await sleep(300);
  await key('Enter', 'Enter', 0);
  await sleep(500);
  await send('Input.insertText', { text: '[[#^' });
  let options = '';
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    options = await ev(`document.querySelector('.cm-tooltip-autocomplete')?.textContent ?? ''`);
    if (options.includes('taste')) break;
  }
  assert.ok(options.includes('taste'), 'the block id is offered');
  await key('Escape', 'Escape', 0);
  await sleep(500);
});

test('half-typed links never crash the editor’s decorations', async () => {
  await ensureLive();
  await ev(`[...document.querySelectorAll('.cm-content .cm-line')].pop()?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  const pt = await ev(`(() => { const lines = [...document.querySelectorAll('.cm-content .cm-line')]; const l = lines[lines.length - 1]; const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(800);
  await key('End', 'End', 0);
  await sleep(300);
  const errorsBefore = await ev(`(window.__nvErrors || []).length`);
  await send('Input.insertText', { text: '\n[[#]]\n[[|]]\n[[a|]]\n[[Nowhere#^]]\n[[#\n[[#^\n[[|\n``\n> [!tip]\n' });
  await sleep(3500);
  // The fragments hide from the DOM (Live Preview's empty replace), so the saved file proves they landed.
  assert.ok(readFileSync(path.join(H.vaultDir, 'Harbourline launch plan.md'), 'utf8').includes('[[|]]'), 'the fragments landed');
  const errorsAfter = await ev(`(window.__nvErrors || []).length`);
  assert.equal(errorsAfter, errorsBefore, 'no decoration errors from fragments');
  assert.ok(await ev(`!!document.querySelector('.cm-editor .cm-content')`), 'the editor stands');
});
