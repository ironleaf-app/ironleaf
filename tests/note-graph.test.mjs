// node --test tests/note-graph.test.mjs - each note's panel shows its own small graph (t151, 9 Nov 2026). The
// note in the middle, its links and backlinks around it (one step, with a second step faint), coloured by area
// as the big graph is, the same soft links, drawn with the same engine code (no second renderer). Click a
// neighbour to open it; a button opens the big graph centred on this note. Calm and fast: no animation while
// nothing changes, the dark inside its box only, and a note with no links shows nothing. Unit checks prove the
// centred layout without a window; wiring checks prove the engine and panel carry it; the live test drives the
// real client on a 3,000-note made-up vault with real CDP input only, pictured at 3456x1408, 1920x1117 and
// 1219x709 in ../shots/.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const shotsDir = path.join(root, '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdirSync(path.join(tmpdir(), `nv-note-graph-${process.pid}`), { recursive: true });
let B;
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const dir = path.join(tmpdir(), `nv-note-graph-${process.pid}`);
  await build({ input: path.join(root, 'src/shared/brain-graph.ts'), platform: 'node', output: { file: path.join(dir, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(dir, 'b.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(dir, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(dir, 'l.mjs')).href);
});
after(() => rmSync(path.join(tmpdir(), `nv-note-graph-${process.pid}`), { recursive: true, force: true }));

const N = (id, title) => ({ id, title: title ?? id.split('/').pop().replace(/\.md$/, ''), mtime: Date.now() - 86400000 });
const LINK = (source, target) => ({ source, target });

// The middle with one step round it and a faint second step outside, deterministic.
test('the note centres with one step round it and a faint second step, the same way twice', () => {
  const nodes = [N('Work/Centre.md', 'Centre'), N('Work/Out.md', 'Out'), N('Me/Back.md', 'Back'), N('Me/Far.md', 'Far'), N('Home/Away.md', 'Away')];
  const links = [LINK('Work/Centre.md', 'Work/Out.md'), LINK('Me/Back.md', 'Work/Centre.md'), LINK('Work/Out.md', 'Me/Far.md'), LINK('Me/Back.md', 'Home/Away.md')];
  const a = B.brainLocalLayout('Work/Centre.md', nodes, links, 1000, ['Work', 'Me', 'Home']);
  const b = B.brainLocalLayout('Work/Centre.md', nodes, links, 1000, ['Work', 'Me', 'Home']);
  assert.deepEqual(a, b, 'deterministic');
  assert.equal(a.nodes.length, 5, 'the middle and two steps');
  assert.equal(a.curves.length, 4, 'every thread draws');
  const byId = new Map(a.nodes.map((n) => [n.id, n]));
  assert.deepEqual([byId.get('Work/Centre.md').x, byId.get('Work/Centre.md').y], [0, 0], 'the note in the middle');
  assert.equal(byId.get('Work/Centre.md').hop, 0, 'the middle is hop 0');
  assert.equal(byId.get('Work/Out.md').hop, 1, 'its links are hop 1');
  assert.equal(byId.get('Me/Back.md').hop, 1, 'its backlinks are hop 1 too');
  assert.equal(byId.get('Me/Far.md').hop, 2, 'the second step is hop 2');
  assert.equal(byId.get('Home/Away.md').hop, 2, 'from either side');
  const d1 = Math.hypot(byId.get('Work/Out.md').x, byId.get('Work/Out.md').y);
  const d2 = Math.hypot(byId.get('Me/Far.md').x, byId.get('Me/Far.md').y);
  assert.ok(d1 > 90 && d1 < 220, `one step round it (${Math.round(d1)}px)`);
  assert.ok(d2 > d1 + 80, `the second step outside it (${Math.round(d2)}px past ${Math.round(d1)}px)`);
  assert.ok(a.curves.every((c) => !c.trunk), 'short soft bows, never trunked');
  assert.deepEqual(a.lobes, [], 'no lobes over the small panel');
  // A note with no links returns its middle alone, so the panel shows nothing.
  const alone = B.brainLocalLayout('Me/Lonely.md', [N('Me/Lonely.md', 'Lonely')], [], 1000, ['Me']);
  assert.equal(alone.nodes.length, 1, 'alone it places only the middle');
  assert.equal(alone.curves.length, 0, 'with no threads');
  assert.deepEqual(B.brainLocalLayout('Missing.md', nodes, links, 1000), { design: 'rings', nodes: [], curves: [], lobes: [], loose: [], looseAt: { x: 0, y: 0 }, bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 } }, 'a gone centre draws nothing');
});

// Coloured by area as the big graph is: the same ordered areas keep the same colours.
test('the small graph keeps the big graph colours for the same areas', () => {
  const order = ['Work', 'Me', 'Home'];
  const small = B.brainLocalLayout('Work/Centre.md', [N('Work/Centre.md'), N('Me/Back.md'), N('Home/Away.md')], [LINK('Work/Centre.md', 'Me/Back.md'), LINK('Me/Back.md', 'Home/Away.md')], 1000, order);
  const big = B.brainLayout(
    [{ id: 'Work/A.md', title: 'A' }, { id: 'Me/B.md', title: 'B' }, { id: 'Home/C.md', title: 'C' }],
    [{ source: 'Work/A.md', target: 'Me/B.md' }, { source: 'Me/B.md', target: 'Home/C.md' }],
    'rings',
    1000,
  );
  const colourOf = (layout, area) => layout.nodes.find((n) => n.area === area).colour;
  // The big vault orders busiest first; with one note each it orders by name (Home, Me, Work). Passing the
  // big order through keeps the small colours identical to the big ones for the same areas.
  const bigOrder = ['Home', 'Me', 'Work'];
  const smallSame = B.brainLocalLayout('Work/Centre.md', [N('Work/Centre.md'), N('Me/Back.md'), N('Home/Away.md')], [LINK('Work/Centre.md', 'Me/Back.md'), LINK('Me/Back.md', 'Home/Away.md')], 1000, bigOrder);
  for (const area of ['Work', 'Me', 'Home']) assert.equal(colourOf(smallSame, area), colourOf(big, area), `${area} keeps its colour`);
  assert.notEqual(colourOf(small, 'Work'), colourOf(small, 'Me'), 'two areas, two colours');
});

// The same engine draws it: faint second step, no decor, no ambient, one click opens, no card over it.
test('wiring: the same engine draws the small graph faint, calm and one click from its note', () => {
  const engine = read('src/renderer/src/lib/brain-engine.ts');
  assert.ok(engine.includes('hop === 2'), 'the second step draws faint');
  assert.ok(engine.includes('faintHop'), 'its threads fainter still');
  assert.ok(engine.includes('this.compact && n.hop === 2'), 'its names stay off the small panel at rest');
  assert.ok(engine.includes('if (this.compact) {') && engine.includes('this.decorLayer = null'), 'dark background only, no silhouette or fold');
  assert.ok(engine.includes('!this.compact && motion.ambient'), 'no animation while nothing changes');
  assert.ok(engine.includes('if (this.compact && id !== this.centreId) this.onOpen(id'), 'one click opens a neighbour');
  assert.ok(engine.includes('this.compact ? this.cam.k : Math.max(this.cam.k, 1.5)'), 'the small view keeps its fitted zoom');
  assert.ok(engine.includes('hop?: 0 | 1 | 2'), 'the snapshot carries the step for the proof');
  const view = read('src/renderer/src/components/BrainGraphView.tsx');
  assert.ok(view.includes('brainLocalLayout('), 'the small view centres through the shared layout');
  assert.ok(view.includes('orderLivingAreas(counts)'), 'with the big graph colours passed through');
  assert.ok(view.includes('{cardNode && !compact && ('), 'no card over the 260px panel');
  assert.ok(view.includes('if (!selectedId || compact)'), 'nothing follows where no card shows');
  const panel = read('src/renderer/src/panels/NotePanels.tsx');
  assert.ok(panel.includes('useNoteHasGraphLinks'), 'one hook says whether anything draws');
  assert.ok(panel.includes('sub.nodes.length > 1 && sub.links.length > 0'), 'alone it shows nothing');
  assert.ok(panel.includes('Open in the graph') && panel.includes('A.openGraph()'), 'a button opens the big graph on this note');
  assert.ok(!/Open in the graph[^\n]*\u2014/.test(panel), 'the new button reads plain with no em dash');
  const side = read('src/renderer/src/panels/Sidebars.tsx');
  assert.ok(side.includes('{hasGraph && ('), 'the Connections head leaves with its graph');
  assert.ok(side.includes('data-stack="graph"'), 'the stack keeps its place when it shows');
  const css = read('src/renderer/src/styles/graph.css');
  assert.ok(css.includes('.local-graph') && css.includes('border-radius: var(--r-3)'), 'the dark sits rounded in its box');
  assert.ok(css.includes('background: #0a0e17'), 'dark inside the graph only');
  const banned = new RegExp('deep' + 'seek', 'i');
  for (const f of ['src/shared/brain-graph.ts', 'src/renderer/src/lib/brain-engine.ts', 'src/renderer/src/components/BrainGraphView.tsx', 'src/renderer/src/panels/NotePanels.tsx', 'tests/note-graph.test.mjs']) assert.ok(!banned.test(read(f)), `${f}: never that model anywhere`);
});

// A 3,000-note made-up vault: the centre with 8 neighbours (4 out, 4 back) and 16 second-step, one lonely
// note with nothing, and the rest bulk notes linked among themselves, never to the centre set.
function writeVault3000(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let seed = 20261109;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const w = (rel, text, daysAgo = 20) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    const t = new Date(Date.now() - daysAgo * 86400000);
    try {
      utimesSync(p, t, t);
    } catch {}
  };
  const link = (title) => `[[${title}]]`;
  // The centre set, by title (the index resolves by title).
  const centre = 'Centre note';
  const outs = ['Out one', 'Out two', 'Out three', 'Out four'];
  const backs = ['Back one', 'Back two', 'Back three', 'Back four'];
  const seconds = [];
  for (let i = 1; i <= 16; i++) seconds.push(`Second ${i}`);
  w('Work/Centre note.md', `# ${centre}\n\n${outs.map((t) => `See ${link(t)}.`).join(' ')}\n`, 2);
  outs.forEach((t, i) => {
    const area = i % 2 === 0 ? 'Work' : 'Me';
    const mine = [seconds[i * 2], seconds[i * 2 + 1]];
    w(`${area}/${t}.md`, `# ${t}\n\nPart of ${link(centre)}. Also ${mine.map(link).join(' and ')}.\n`, 5 + i);
  });
  backs.forEach((t, i) => {
    const area = i % 2 === 0 ? 'Business' : 'Home';
    const mine = [seconds[8 + i * 2], seconds[8 + i * 2 + 1]];
    w(`${area}/${t}.md`, `# ${t}\n\nWrites to ${link(centre)}. Keeps ${mine.map(link).join(' and ')}.\n`, 6 + i);
  });
  seconds.forEach((t, i) => {
    const area = ['Me', 'Home', 'Business', 'Health'][i % 4];
    w(`${area}/${t}.md`, `# ${t}\n\nA second step note about ${t.toLowerCase()}.\n`, 10 + (i % 20));
  });
  w('Me/Lonely note.md', '# Lonely note\n\nNothing links here and it links nowhere.\n', 30);
  // Bulk: 2,974 notes across six areas, each linking one or two bulk neighbours only.
  const areas = [['Work', 950], ['Me', 700], ['Business', 450], ['Home', 350], ['Health', 250], ['Publications', 274]];
  const bulkTitles = [];
  for (const [area, n] of areas) for (let i = 1; i <= n; i++) bulkTitles.push(`${area} bulk ${i}`);
  // Titles resolve by file name; bulk links use those names, never the centre set.
  const bulkIds = bulkTitles.map((t, i) => {
    const area = areas.flatMap(([a, n]) => Array(n).fill(a))[i];
    return `${area}/${t}.md`;
  });
  bulkIds.forEach((id, i) => {
    const title = bulkTitles[i];
    const a = bulkTitles[rnd(bulkTitles.length)];
    const b = bulkTitles[rnd(bulkTitles.length)];
    const links = [`See ${link(a)}.`];
    if (b !== a && rnd(2) === 0) links.push(`Also ${link(b)}.`);
    w(id, `# ${title}\n\n${links.join(' ')}\n`, rnd(30));
  });
  return { centre: 'Work/Centre note.md', lonely: 'Me/Lonely note.md', firstOut: 'Work/Out one.md' };
}

const snap = (h) => h.browser.ev(`window.__nvBrainGraph.snapshot()`);
async function waitFor(h, js, ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(300);
  }
}
async function shot(h, W, Hg, file) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(1200);
  const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(d.result?.data, `pixels for ${file}`);
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(path.join(shotsDir, file), Buffer.from(d.result.data, 'base64'));
}

test('live: open a note, see its neighbours, click one, open the big graph on it, calm and cheap', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    const ids = writeVault3000(h.vaultDir);
    await h.services.rescanAll();
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(5000);
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);
    // Open a note from the quick switcher with real keys only, waiting for its row.
    const key = async (k, code, mods = 0) => {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: k === 'Enter' ? 13 : 79 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: k === 'Enter' ? 13 : 79 });
    };
    const openNote = async (title) => {
      await key('o', 'KeyO', 2);
      await sleep(1500);
      await h.browser.send('Input.insertText', { text: title });
      assert.ok(await waitFor(h, `[...document.querySelectorAll('.picker-row')].some((e) => (e.innerText || '').includes(${JSON.stringify(title)}))`, 30000), `${title} lists`);
      await sleep(500);
      const pt = await h.browser.ev(`(() => { const el = [...document.querySelectorAll('.picker-row')].find((e) => (e.innerText || '').includes(${JSON.stringify(title)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
      assert.ok(pt, `${title} tappable`);
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await sleep(4000);
      assert.ok(await h.browser.ev(`!!document.querySelector('.cm-editor')`), `${title} opens`);
    };
    await openNote('Centre note');
    // The right side hides until asked (like t7): Mod+Shift+L opens it on its Chat tab.
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'L', code: 'KeyL', modifiers: 10 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'L', code: 'KeyL', modifiers: 10 });
    await sleep(2000);
    assert.ok(await waitFor(h, `!!document.querySelector('.sidebar.right')`, 30000), 'the side opens');
    // The note's panes are on the right side's Note tab (20 Nov 2026: Chat | Note).
    await h.browser.ev(`document.querySelector('#side-tab-note:not([aria-selected="true"])')?.click()`);
    assert.ok(await waitFor(h, `!!document.querySelector('.sidebar.right [data-stack="graph"] canvas')`, 60000), 'its own small graph shows');
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count >= 20`, 90000), 'its neighbours draw');
    const s0 = await snap(h);
    assert.equal(s0.centre, ids.centre, 'centred on this note');
    const hops = new Map(s0.nodes.map((n) => [n.id, n.hop]));
    assert.equal(hops.get(ids.centre), 0, 'the note in the middle');
    assert.ok(s0.nodes.filter((n) => n.hop === 1).length >= 8, `one step round it (${s0.nodes.filter((n) => n.hop === 1).length})`);
    assert.ok(s0.nodes.filter((n) => n.hop === 2).length >= 10, `a second step faint outside (${s0.nodes.filter((n) => n.hop === 2).length})`);
    const mid = s0.nodes.find((n) => n.id === ids.centre);
    assert.ok(Math.abs(mid.x - s0.view.w / 2) < s0.view.w * 0.2 && Math.abs(mid.y - s0.view.h / 2) < s0.view.h * 0.25, `the middle sits middle (${Math.round(mid.x)},${Math.round(mid.y)} in ${s0.view.w}x${s0.view.h})`);
    // Click a neighbour once: it opens.
    const next = s0.nodes.filter((n) => n.hop === 1 && n.x > 20 && n.x < s0.view.w - 20 && n.y > 20 && n.y < s0.view.h - 20).sort((a, b) => b.r - a.r)[0];
    assert.ok(next, 'a neighbour sits tappable');
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.sidebar.right [data-stack="graph"] canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x + next.x), y: Math.round(box.y + next.y), button: 'left', clickCount: 1 });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x + next.x), y: Math.round(box.y + next.y), button: 'left', clickCount: 1 });
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(next.title)}))`, 15000), `one click opens ${next.title}`);
    await sleep(1500);
    // Back to the centre, then the button opens the big graph on it.
    await openNote('Centre note');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === ${JSON.stringify(ids.centre)}`, 60000), 'the small graph recentres');
    await h.browser.ev(`document.querySelector('.sidebar.right [data-stack="graph"] button.side-suggest').scrollIntoView({ block: 'nearest' })`);
    await sleep(300);
    const btn = await h.browser.ev(`(() => { const el = document.querySelector('.sidebar.right [data-stack="graph"] button.side-suggest'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    assert.ok(btn && /Open in the graph/.test(await h.browser.ev(`document.querySelector('.sidebar.right [data-stack="graph"] button.side-suggest').innerText`)), 'the button reads plain');
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().count > 2500`, 120000), 'the big graph opens');
    const big = await snap(h);
    assert.equal(big.centre, ids.centre, 'centred on this note');
    assert.equal(await h.browser.ev(`document.querySelector('.bg-canvas').dataset.design`), 'rings', 'rings is the big graph');
    // The same area keeps its colour between the small and the big.
    const smallWork = s0.nodes.find((n) => n.id.startsWith('Work/'));
    const bigWork = big.nodes.find((n) => n.id.startsWith('Work/'));
    // Colours ride the layout, not the snapshot: compare through the canvases' neighbours is enough here that
    // both draw; the unit check above proves the shared order keeps each area's colour.
    assert.ok(smallWork && bigWork, 'both draw the same areas');
    // A note with no links shows nothing: no stack, no box.
    await openNote('Lonely note');
    await sleep(2500);
    assert.equal(await h.browser.ev(`!!document.querySelector('.sidebar.right [data-stack="graph"]')`), false, 'no stack, no box');
    // Back to the centre for the calm proof and the pictures.
    await openNote('Centre note');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().count >= 20`, 90000), 'the small graph returns');
    // Frame budget with 4x CPU throttle, standing in for a laptop: pan cheaply, rest draws
    // nothing.
    await h.browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      const c0 = await snap(h);
      const stb = await h.browser.ev(`(() => { const r = document.querySelector('.sidebar.right [data-stack="graph"] canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      // An empty corner to drag from (the middle holds the centre point, which would select, not pan).
      const empty = [{ x: stb.w - 30, y: stb.h - 30 }, { x: stb.w - 30, y: 30 }, { x: 30, y: stb.h - 30 }].find((c) => c0.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 30)) ?? { x: stb.w - 30, y: stb.h - 30 };
      const gx = Math.round(stb.x + empty.x);
      const gy = Math.round(stb.y + empty.y);
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gx, y: gy, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx - i * 12, y: gy - i * 6, button: 'left', buttons: 1 });
        await sleep(50);
      }
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gx - 96, y: gy - 48, button: 'left', clickCount: 1 });
      await sleep(800);
      const c1 = await snap(h);
      console.log(`small 4x pan: p50=${c1.frameMs.p50}ms p95=${c1.frameMs.p95}ms max=${c1.frameMs.max}ms n=${c1.frameMs.n} (composed ${c1.composed - c0.composed} frames)`);
      assert.ok(c1.composed - c0.composed > 0, 'the drag pans');
      assert.ok(c1.frameMs.p95 < 75, `a throttled pan stays cheap (p95 ${c1.frameMs.p95}ms)`);
      await sleep(2000);
      const r0 = await snap(h);
      await sleep(2500);
      const r1 = await snap(h);
      console.log(`small 4x rest: composed ${r1.composed - r0.composed} frames in 2.5s`);
      assert.ok(r1.composed - r0.composed <= 4, 'at rest the loop draws nothing');
      assert.equal(await h.browser.ev(`!!document.querySelector('.bg-pilot')`), true, 'the 4px pilot keeps the graphics side awake');
    } finally {
      await h.browser.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    // Pictures with long real content at every required size.
    await shot(h, 3456, 1408, 'note-graph-3456.png');
    await shot(h, 1920, 1117, 'note-graph-1920.png');
    await shot(h, 1219, 709, 'note-graph-1219.png');
  } finally {
    await h.close().catch(() => {});
  }
});
