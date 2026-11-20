// node --test tests/brain-graph.test.mjs - the brain prototype (9 Nov 2026). Design first behind the
// dev-only ?graph=brain switch: areas as lobes of one brain silhouette in two halves with a fold
// between, short bundled curves, and one purpose in every design - find, walk, focus a lobe, lenses, and
// a line saying what the brain sees. Unit checks prove the placed layout without a window; the live test
// drives the real client with real CDP input only.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeBrainVault } from './brain-vault.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brain-graph-'));
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/brain-graph.ts'), platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// A small a made-up vault of realistic size: six areas plus people and projects, hubs, leaves and two
// strays.
function fixtureVault() {
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const areas = [['Work', 16], ['Me', 12], ['Business', 8], ['Home', 8], ['Health', 6], ['People', 6], ['Projects', 4]];
  const nodes = [];
  for (const [a, n] of areas) {
    for (let i = 0; i < n; i++) {
      nodes.push({ id: `${a}/N${i}.md`, title: `${a} note ${i}`, person: a === 'People', project: a === 'Projects', mtime: Date.now() - rnd() * 30 * 86400000 });
    }
  }
  nodes.push({ id: 'Work/Hub.md', title: 'Hub', mtime: Date.now() - 86400000 });
  nodes.push({ id: 'Stray/One.md', title: 'Stray one', mtime: Date.now() - 20 * 86400000 });
  nodes.push({ id: 'Stray/Two.md', title: 'Stray two', mtime: Date.now() - 25 * 86400000 });
  const ids = nodes.map((n) => n.id);
  const inArea = (a) => ids.filter((id) => id.startsWith(a + '/') && !id.startsWith('Stray/'));
  const links = [];
  for (const [a] of areas) {
    const l = inArea(a);
    for (let i = 1; i < l.length; i++) links.push({ source: l[Math.floor(rnd() * i)], target: l[i] });
  }
  for (let i = 0; i < 12; i++) links.push({ source: 'Work/Hub.md', target: ids[Math.floor(rnd() * (ids.length - 2))] });
  for (let i = 0; i < 10; i++) {
    const a = ids[Math.floor(rnd() * (ids.length - 2))];
    const b = ids[Math.floor(rnd() * (ids.length - 2))];
    if (a !== b) links.push({ source: a, target: b });
  }
  links.push({ source: 'Work/Hub.md', target: 'Work/Hub.md' });
  return { nodes, links };
}

const DESIGNS = ['halves', 'rings', 'folds'];

// Lobes of one brain silhouette: two halves with a fold between, never floating apart.
test('every design lays one brain: the fold holds clear and no lobe floats apart', () => {
  const { nodes, links } = fixtureVault();
  for (const design of DESIGNS) {
    const L = B.brainLayout(nodes, links, design, Date.now());
    const viol = L.nodes.filter((n) => Math.abs(n.x) < 48);
    assert.equal(viol.length, 0, `${design}: no point sits in the fold (${viol.slice(0, 3).map((n) => n.id).join(', ')})`);
    for (const n of L.nodes) {
      assert.ok(Math.abs(n.x) < 900 && Math.abs(n.y) < 900, `${design}: ${n.id} stays in the world`);
    }
    // Each lobe near another: the nearest neighbour's middle within a lobe's reach, never adrift.
    for (const lobe of L.lobes) {
      const near = Math.min(...L.lobes.filter((l) => l.area !== lobe.area).map((l) => Math.hypot(l.cx - lobe.cx, l.cy - lobe.cy)));
      assert.ok(near < 560, `${design}: ${lobe.name} sits near the rest (${Math.round(near)}px to its nearest)`);
    }
  }
  // Halves draws each lobe whole on its side: no ellipse crosses the fold (rings and folds wash up to the
  // fold and the engine clips there, so their points prove it instead).
  const H = B.brainLayout(nodes, links, 'halves', Date.now());
  for (const lobe of H.lobes) {
    assert.ok(Math.abs(lobe.cx) - lobe.rx > 44, `halves: ${lobe.name} stays on its side`);
  }
});

// Bigger notes (more links) sit nearer the core: each lobe's most-linked few average nearer its middle.
test('bigger notes sit nearer the core than leaves, in every design', () => {
  const { nodes, links } = fixtureVault();
  for (const design of DESIGNS) {
    const L = B.brainLayout(nodes, links, design, Date.now());
    let checked = 0;
    for (const lobe of L.lobes) {
      const inL = L.nodes.filter((n) => n.area === lobe.area && !n.loose);
      if (inL.length < 6) continue;
      checked++;
      const d = (n) => Math.hypot(n.x - lobe.cx, n.y - lobe.cy);
      const top = [...inL].sort((a, b) => b.degree - a.degree).slice(0, 3);
      const rest = inL.filter((n) => !top.includes(n));
      const mt = top.reduce((t, n) => t + d(n), 0) / top.length;
      const mr = rest.reduce((t, n) => t + d(n), 0) / rest.length;
      assert.ok(mt < mr, `${design}: ${lobe.name} hubs nearer (${Math.round(mt)}px vs ${Math.round(mr)}px)`);
    }
    assert.ok(checked >= 3, `${design}: enough lobes to prove it (${checked})`);
  }
});

// Short soft curves like nerve fibres, bundled where many run between the same two lobes.
test('curves stay short and bundle per lobe pair, in every design', () => {
  const { nodes, links } = fixtureVault();
  for (const design of DESIGNS) {
    const L = B.brainLayout(nodes, links, design, Date.now());
    const byId = new Map(L.nodes.map((n) => [n.id, n]));
    assert.ok(!L.curves.some((c) => c.source === c.target), `${design}: no loops draw`);
    for (const c of L.curves) {
      const a = byId.get(c.source);
      const b = byId.get(c.target);
      const straight = Math.hypot(a.x - b.x, a.y - b.y);
      const via = Math.hypot(a.x - c.cx, a.y - c.cy) + Math.hypot(b.x - c.cx, b.y - c.cy);
      assert.ok(via <= straight * 1.9 + 30, `${design}: no wild thread (${Math.round(via)}px via for ${Math.round(straight)}px)`);
      if (c.trunk) assert.ok(c.across, `${design}: trunk threads run across lobes`);
    }
    // One shared waypoint per lobe pair: trunk controls of a pair cluster tight.
    const pairs = new Map();
    for (const c of L.curves) {
      if (!c.trunk) continue;
      const key = [byId.get(c.source).area, byId.get(c.target).area].sort().join('|');
      const l = pairs.get(key) ?? [];
      l.push(c);
      pairs.set(key, l);
    }
    let bundled = 0;
    for (const [key, list] of pairs) {
      if (list.length < 2) continue;
      bundled++;
      let far = 0;
      for (const a of list) for (const b of list) far = Math.max(far, Math.hypot(a.cx - b.cx, a.cy - b.cy));
      assert.ok(far < 60, `${design}: ${key} bundles through one waypoint (${Math.round(far)}px spread)`);
    }
    assert.ok(bundled >= 1, `${design}: something bundles (${bundled} pairs)`);
  }
});

test('the same vault lays out the same way twice', () => {
  const { nodes, links } = fixtureVault();
  for (const design of DESIGNS) {
    const a = B.brainLayout(nodes, links, design, 1000);
    const b = B.brainLayout(nodes, links, design, 1000);
    assert.deepEqual(a, b, `${design}: deterministic`);
  }
});

// Each lobe's name sits clearly in its own lobe (10 Nov 2026 polish: "Work" sat among purple points).
test('rings names sit at their own lobe edge, clear of points and of each other', () => {
  const { nodes, links } = fixtureVault();
  const L = B.brainLayout(nodes, links, 'rings', Date.now());
  const byArea = new Map();
  for (const n of L.nodes) {
    if (n.loose) continue;
    const l = byArea.get(n.area) ?? [];
    l.push(n);
    byArea.set(n.area, l);
  }
  for (const lobe of L.lobes) {
    // In its own wedge: nearer its own points' middle angle than any other lobe's name. All-loose areas
    // (the fixture's Stray) keep their wedge but hold no linked points to aim at.
    const ang = Math.atan2(lobe.ly / 0.78, lobe.lx);
    const own = byArea.get(lobe.area) ?? [];
    if (own.length > 0) {
      const mid = own.reduce((t, n) => t + Math.atan2(n.y / 0.78, n.x), 0) / own.length;
      let d = Math.abs(ang - mid);
      if (d > Math.PI) d = 2 * Math.PI - d;
      assert.ok(d < 0.5, `${lobe.name} sits in its own wedge (${d.toFixed(2)} rad off its middle)`);
    }
    // Past the rim-most points, never over one: 20 world clear of every point in the vault.
    let near = Infinity;
    for (const n of L.nodes) near = Math.min(near, Math.hypot(n.x - lobe.lx, n.y - lobe.ly) - n.r);
    assert.ok(near > 20, `${lobe.name} clears every point (${Math.round(near)} world)`);
  }
  // Never overlapping another name: 90 world apart (names measure ~100px at rest zoom).
  for (let i = 0; i < L.lobes.length; i++) {
    for (let j = i + 1; j < L.lobes.length; j++) {
      const a = L.lobes[i];
      const b = L.lobes[j];
      const dd = Math.hypot(a.lx - b.lx, a.ly - b.ly);
      assert.ok(dd > 90, `${a.name} clears ${b.name} (${Math.round(dd)} world)`);
    }
  }
});

// Unlinked notes sit faint at the edge, as loose thoughts.
test('unlinked notes rest faint at the edge as loose thoughts', () => {
  const { nodes, links } = fixtureVault();
  for (const design of DESIGNS) {
    const L = B.brainLayout(nodes, links, design, Date.now());
    const ids = new Set(L.loose.map((l) => l.id));
    assert.ok(ids.has('Stray/One.md') && ids.has('Stray/Two.md'), `${design}: the strays are loose`);
    assert.deepEqual(L.loose.map((l) => l.title), [...L.loose.map((l) => l.title)].sort(), `${design}: loose by title`);
    for (const l of L.loose) {
      const n = L.nodes.find((x) => x.id === l.id);
      assert.ok(n.loose && n.r <= 3.5, `${design}: ${l.id} faint and small`);
      assert.ok(n.y > B.BRAIN_R.y * 0.7, `${design}: ${l.id} at the edge (y=${Math.round(n.y)})`);
    }
    assert.ok(L.looseAt.y > B.BRAIN_R.y, `${design}: the caption sits with them`);
  }
});

// Each lens re-lights the brain; the layout never moves under it (layout takes no lens at all).
test('lenses match the right notes: everything, recent, people, projects', () => {
  const M = (lens, n) => B.brainLensMatch(lens, n);
  const fresh = { recent: true, person: false, project: false };
  const stale = { recent: false, person: false, project: false };
  const friend = { recent: false, person: true, project: false };
  const plan = { recent: false, person: false, project: true };
  assert.ok(M('all', stale) && M('recent', fresh) && !M('recent', stale), 'recent is this week only');
  assert.ok(M('people', friend) && !M('people', fresh), 'people are people');
  assert.ok(M('projects', plan) && !M('projects', friend), 'projects are projects');
  const nodes = [fresh, stale, friend, plan];
  assert.equal(B.brainLensCount('all', nodes), 4, 'everything holds all four');
  assert.equal(B.brainLensCount('recent', nodes), 1, 'recent holds one');
  assert.equal(B.brainLensCount('people', nodes), 1, 'people holds one');
  assert.equal(B.brainLensCount('projects', nodes), 1, 'projects holds one');
});

// A short line under the title says what the brain sees, in plain words with no em dash.
test('the summary says what is busiest and what is loose', () => {
  assert.equal(
    B.brainSummary({ recentByArea: [['Work', 9], ['Me', 3]], recentTotal: 12, looseCount: 6 }),
    'Work is busiest this week · 6 loose thoughts not linked to anything',
  );
  assert.equal(
    B.brainSummary({ recentByArea: [], recentTotal: 0, looseCount: 1 }),
    'Nothing touched this week · 1 loose thought not linked to anything',
  );
  assert.equal(
    B.brainSummary({ recentByArea: [['Me', 2]], recentTotal: 2, looseCount: 0 }),
    'Me is busiest this week · every note is linked',
  );
});

test('search ranks a title that starts with the words first', () => {
  const nodes = [
    { id: 'Work/Cart retry 1.md', title: 'Cart retry 1' },
    { id: 'Me/Read list.md', title: 'Read list' },
    { id: 'Work/Receipts review.md', title: 'Receipts review' },
    { id: 'Cart notes.md', title: 'Old notes' },
  ];
  assert.deepEqual(B.brainSearch(nodes, 'cart').map((n) => n.id), ['Work/Cart retry 1.md', 'Cart notes.md'], 'starts first, then the path');
  assert.deepEqual(B.brainSearch(nodes, 'eceipts').map((n) => n.id), ['Work/Receipts review.md'], 'a title holding it');
  assert.deepEqual(B.brainSearch(nodes, 'c'), [], 'one letter is too soon');
  assert.deepEqual(B.brainSearch(nodes, '  '), [], 'blank is nothing');
  assert.equal(B.brainSearch(nodes, 'e', 1).length, 0, 'the limit holds with too little to rank');
});

// Rings is the graph (10 Nov 2026): the default view, the living graph retired to its dev-only door.
test('wiring: rings is the default, the living graph retired but kept', () => {
  assert.ok(!/brain/i.test(read('src/renderer/src/lib/living-engine.ts')), 'living-engine.ts knows no brain');
  const tab = read('src/renderer/src/views/GraphTab.tsx');
  assert.ok(tab.includes(`get('graph')`), 'the dev doors still read ?graph=');
  assert.ok(tab.includes('brain-compare'), 'the compare page keeps its door');
  assert.ok(tab.includes(`'living'`), 'the retired living graph keeps its unlinked door');
  assert.ok(tab.includes('BrainGraphView') && tab.includes('designInit="rings"'), 'rings is the default');
  assert.ok(!tab.includes(`designInit={designInit}`), 'no design switcher in the default view');
  const engine = read('src/renderer/src/lib/brain-engine.ts');
  assert.ok(engine.includes('stillDirty'), 'the still world draws once per change');
  assert.ok(engine.includes('prefers-reduced-motion'), 'reduced motion stays still');
  assert.ok(engine.includes('setLens'), 'lenses re-light without rebuilding');
  assert.ok(engine.includes('hop: 2'), 'a click fires one hop then two');
  assert.ok(engine.includes(`bg-pilot`) && engine.includes('document.hasFocus()'), 'the 4px pilot keeps the graphics side awake at rest');
  assert.ok(engine.includes('restoreCamera'), 'the camera is kept per tab across a switch');
  assert.ok(engine.includes('setCentre'), 'Ctrl+G and Centre here open centred with the neighbourhood lit');
  assert.ok(engine.includes('this.compact'), 'each note keeps its own small graph');
  assert.ok(engine.includes('textW'), 'title widths are cached, not re-measured every frame (the living fix, for the pan budget)');
  assert.ok(engine.includes('bgLayer'), 'the background and vignette pre-render once per size (the living fix, for the pan budget)');
  assert.ok(engine.includes('decorLayer'), 'silhouette, lobe tints and fold pre-render per layout and blit per frame (for the pan budget)');
  const view = read('src/renderer/src/components/BrainGraphView.tsx');
  assert.ok(view.includes('Show everything'), 'the switch keeps working');
  assert.ok(view.includes('Centre here'), 'the card centres');
  assert.ok(view.includes('placeLivingCard'), 'the card sits beside the point, never over its name');
  const css = read('src/renderer/src/styles/brain-graph.css');
  assert.ok(css.includes('#0a0e17'), 'dark canvas inside the graph only');
});

// The product rules hold in the new words: plain Australian English, no engine names, no em dashes, and
// never a secret anywhere near the code or tests.
test('wiring: plain words, no engine names, no secrets', () => {
  const srcFiles = ['src/shared/brain-graph.ts', 'src/renderer/src/lib/brain-engine.ts', 'src/renderer/src/components/BrainGraphView.tsx', 'src/renderer/src/views/BrainCompareView.tsx'];
  const allFiles = [...srcFiles, 'tests/brain-graph.test.mjs', 'tests/brain-vault.mjs'];
  // The key prefix is built apart so the check cannot match itself.
  const keyPrefix = String.fromCharCode(115, 107) + '-';
  for (const f of allFiles) {
    const src = read(f);
    assert.ok(!src.includes('\u2014'), `${f}: no em dashes in new words`);
    assert.ok(!src.includes(keyPrefix) && !/api[_-]?key/i.test(src), `${f}: no secrets`);
  }
  // The banned model name is spelled apart here so the check cannot match itself.
  const banned = new RegExp('deep' + 'seek', 'i');
  for (const f of srcFiles) {
    assert.ok(!banned.test(read(f)), `${f}: never that model anywhere`);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(h, js, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}
async function clickWords(h, words, scope = '') {
  const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
  return await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}
async function openRoom(h, name) {
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', `More opens for ${name}`);
  await sleep(500);
  assert.equal(await clickWords(h, name, '.menu, [role="menu"]'), 'CLICKED', `${name} opens from More`);
}
// A real pointer tap at an element's middle, through CDP only (no synthetic page events).
async function tapSel(h, js) {
  const pt = await h.browser.ev(`(() => { const el = (${js}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  assert.ok(pt, `tappable: ${js.slice(0, 80)}`);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  return pt;
}
const snap = (h) => h.browser.ev(`window.__nvBrainGraph.snapshot()`);

test('live: search, walk, lobe focus and lenses on the real client, with real input', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    // The brain vault, shaped like a real one: about 170 notes, people, projects, meetings, a month of
    // edits.
    rmSync(h.vaultDir, { recursive: true, force: true });
    mkdirSync(h.vaultDir, { recursive: true });
    const seed = writeBrainVault(h.vaultDir);
    assert.equal(seed.total, 170, 'about 170 notes');
    await h.services.rescanAll();
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 150`), 'the brain draws');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 90000), 'the brain frames');
    const s0 = await snap(h);
    console.log(`brain: ${s0.count} notes, ${s0.links} links`);
    assert.ok(s0.count >= 160 && s0.count <= 175, `about 170 notes draw (${s0.count})`);
    assert.equal(await h.browser.ev(`document.querySelector('.bg-canvas').dataset.design`), 'rings', 'rings is the default graph');
    assert.equal(await h.browser.ev(`!!document.querySelector('.bg-design')`), false, 'no design switcher: rings is the one design');
    const lead = await h.browser.ev(`document.querySelector('.nv-page-lead').innerText`);
    assert.match(lead, /busiest this week|Nothing touched this week/, `the line says what it sees (${lead})`);
    assert.match(lead, /loose thought/, 'and counts the loose thoughts');

    // Find: type a name and the brain turns to that note and lights its neighbourhood.
    await tapSel(h, `document.querySelector('.bg-find input')`);
    await h.browser.send('Input.insertText', { text: 'cart retry' });
    assert.equal(await h.browser.ev(`document.querySelector('.bg-find input').value`), 'cart retry', 'the words land in the box');
    assert.ok(await waitFor(h, `document.querySelectorAll('.bg-hit').length > 0`, 10000), 'matches show');
    const firstHit = await h.browser.ev(`document.querySelector('.bg-hit .bg-hit-title').innerText`);
    const k0 = (await snap(h)).cam.k;
    await tapSel(h, `document.querySelector('.bg-hit')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected !== null`, 10000), 'the search lands on a note');
    const s1 = await snap(h);
    assert.ok(s1.selected.toLowerCase().includes('cart retry'), `it lands on ${firstHit} (${s1.selected})`);
    assert.ok(s1.cam.k >= k0, 'the brain turns to it');
    assert.ok(await waitFor(h, `(document.querySelector('.bg-card') || {}).innerText.includes('Open')`, 5000), 'its card shows');

    // Follow: the card names its neighbours; walking there steps the breadcrumb; Back steps back.
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 15000), 'the search lands the camera');
    assert.ok(await waitFor(h, `document.querySelectorAll('.bg-neighbour').length > 0`, 5000), 'neighbours by name');
    const here = s1.selected;
    await tapSel(h, `document.querySelector('.bg-neighbour')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected !== ${JSON.stringify(here)}`, 10000), 'the walk moves');
    assert.ok(await waitFor(h, `(document.querySelector('.bg-trail-words') || {}).innerText.length > 3`, 5000), 'the breadcrumb walks');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 15000), 'the walk lands the camera');
    await sleep(400);
    await tapSel(h, `document.querySelector('.bg-back')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected === ${JSON.stringify(here)}`, 10000), 'Back steps back');

    // Focus a lobe: its area name zooms in with its notes named; Whole brain steps back out.
    const kf = (await snap(h)).cam.k;
    await tapSel(h, `[...document.querySelectorAll('.bg-legend .bg-row')].find((e) => e.innerText.includes('Work'))`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().focus === 'Work'`, 10000), 'Work focuses');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 15000), 'the focus lands the camera');
    const s3 = await snap(h);
    assert.ok(s3.cam.k > kf, `the lobe zooms in (${kf.toFixed(2)} to ${s3.cam.k.toFixed(2)})`);
    const workLabels = s3.labels.filter((l) => l.id.startsWith('Work/')).length;
    assert.ok(workLabels >= 8, `its notes are named (${workLabels})`);
    await tapSel(h, `document.querySelector('.bg-whole')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().focus === null`, 10000), 'the whole brain returns');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 15000), 'the return lands the camera');

    // Lenses: each re-lights without rebuilding (the points hold their ground).
    const pinned = new Map((await snap(h)).nodes.map((n) => [n.id, [n.x, n.y]]));
    for (const [words, lens] of [['Recent', 'recent'], ['People', 'people'], ['Projects', 'projects'], ['Everything', 'all']]) {
      await tapSel(h, `[...document.querySelectorAll('.bg-lenses [role="tab"]')].find((e) => e.innerText.trim() === ${JSON.stringify(words)})`);
      assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().lens === '${lens}'`, 10000), `${words} lights`);
      const s = await snap(h);
      if (lens !== 'all') assert.ok(s.lit > 0 && s.dimmed > 0, `${words} holds some lit and some dim (${s.lit}/${s.dimmed})`);
      else assert.equal(s.dimmed, 0, 'everything lights all');
      const drift = Math.max(...s.nodes.map((n) => Math.hypot(n.x - pinned.get(n.id)[0], n.y - pinned.get(n.id)[1])));
      assert.ok(drift < 1, `${words} rebuilds nothing (${drift.toFixed(2)}px)`);
    }

    // Double-click opens the note.
    const openee = (await snap(h)).nodes.filter((n) => n.x > 260 && n.x < 1400 && n.y > 60 && n.y < 940).sort((a, b) => b.r - a.r)[0];
    const box = await h.browser.ev(`(() => { const r = document.querySelector('.bg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    const ox = Math.round(box.x + openee.x);
    const oy = Math.round(box.y + openee.y);
    for (const count of [1, 2]) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ox, y: oy, button: 'left', clickCount: count });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ox, y: oy, button: 'left', clickCount: count });
      await sleep(120);
    }
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(openee.title)}))`, 15000), `double-click opens ${openee.title}`);

    // Frame budget with 4x CPU throttle, standing in for a laptop: pan cheaply, rest nearly
    // free.
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().framed`, 60000), 'the brain returns');
    await h.browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      const c0 = await snap(h);
      const stb = await h.browser.ev(`(() => { const r = document.querySelector('.bg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      const gx = Math.round(stb.x + stb.w - 120);
      const gy = Math.round(stb.y + stb.h - 120);
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gx, y: gy, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 12; i++) {
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx - i * 25, y: gy - i * 12, button: 'left', buttons: 1 });
        await sleep(40);
      }
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gx - 300, y: gy - 144, button: 'left', clickCount: 1 });
      await sleep(800);
      const c1 = await snap(h);
      console.log(`brain 4x pan: p50=${c1.frameMs.p50}ms p95=${c1.frameMs.p95}ms max=${c1.frameMs.max}ms n=${c1.frameMs.n} (composed ${c1.composed - c0.composed} frames)`);
      assert.ok(c1.frameMs.p95 < 75, `a throttled pan stays cheap (p95 ${c1.frameMs.p95}ms)`);
      // At rest, held under a hover so no ambient pulse spends: the loop draws nothing. The hover lands
      // first and old pulses and arrival flashes fade out (2s), then the 2.5s rest window measures nothing new.
      const hov = c1.nodes.filter((n) => n.x > 260 && n.x < 1400 && n.y > 60 && n.y < 940).sort((a, b) => b.r - a.r)[0];
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(stb.x + hov.x), y: Math.round(stb.y + hov.y) });
      await sleep(2000);
      const r0 = await snap(h);
      await sleep(2500);
      const r1 = await snap(h);
      console.log(`brain 4x rest: composed ${r1.composed - r0.composed} frames in 2.5s under a hover`);
      assert.ok(r1.composed - r0.composed <= 4, 'at rest the loop draws nothing');
      assert.equal(await h.browser.ev(`!!document.querySelector('.bg-pilot')`), true, 'the 4px pilot keeps the graphics side awake');
    } finally {
      await h.browser.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }

    // Reduced motion stays still: the click still selects, but nothing travels.
    await h.browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(600);
    assert.equal((await snap(h)).reduced, true, 'reduced motion reads');
    const rc = (await snap(h)).nodes.filter((n) => n.x > 260 && n.x < 1400 && n.y > 60 && n.y < 940).sort((a, b) => b.r - a.r)[0];
    const rbox = await h.browser.ev(`(() => { const r = document.querySelector('.bg-canvas').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rbox.x + rc.x), y: Math.round(rbox.y + rc.y), button: 'left', clickCount: 1 });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rbox.x + rc.x), y: Math.round(rbox.y + rc.y), button: 'left', clickCount: 1 });
    await sleep(1200);
    const rs = await snap(h);
    assert.equal(rs.selected, rc.id, 'the click still selects');
    assert.equal(rs.pulses, 0, 'but nothing travels');
    await h.browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  } finally {
    await h.close().catch(() => {});
  }
});

test('live: the default graph keeps every promise with real input', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    rmSync(h.vaultDir, { recursive: true, force: true });
    mkdirSync(h.vaultDir, { recursive: true });
    writeBrainVault(h.vaultDir);
    const w = (rel, text) => {
      const p = path.join(h.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
      const t = new Date(Date.now() - 20 * 86400000);
      try { utimesSync(p, t, t); } catch {}
    };
    w('Templates/Blank.md', '# Blank\n\nSee [[Harbourline Cart Fix]].\n');
    w('Private notes/Secret.md', '# Secret\n\nSee [[Harbourline Cart Fix]].\n');
    await h.services.rescanAll();
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 150`), 'the brain draws');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 90000), 'the brain frames');
    const MAIN = '.nj-graph-body .bg-canvas';
    const at = async (t, sel) => {
      const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
      return { x: Math.round(box.x + t.x), y: Math.round(box.y + t.y) };
    };
    const tap = async (x, y, count = 1, mods = 0) => {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers: mods });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers: mods });
    };
    const titles = () => h.browser.ev(`[...document.querySelectorAll('.tab-item .tab-title')].map((e) => e.textContent)`);

    // Show everything: the switch brings the rest back, Private never shows (kept-out folders stay
    // hidden by the same scope rule, pinned by living-graph-break's unit test on the real indexer).
    const s0 = await snap(h);
    assert.ok(!s0.nodes.some((n) => n.id === 'Private notes/Secret.md'), 'Private never shows');
    assert.ok(!s0.nodes.some((n) => n.id === 'Templates/Blank.md'), 'templates hide by default');
    await tapSel(h, `document.querySelector('.bg-legend .bg-rest input')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().count >= ${s0.count + 1}`, 10000), 'Show everything brings the rest back');
    const sShow = await snap(h);
    assert.ok(sShow.nodes.some((n) => n.id === 'Templates/Blank.md'), 'templates return');
    assert.ok(!sShow.nodes.some((n) => n.id === 'Private notes/Secret.md'), 'Private still never shows');
    await tapSel(h, `document.querySelector('.bg-legend .bg-rest input')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().count === ${s0.count}`, 10000), 'unchecking hides them again');

    // Zoom: about 1.1x per notch toward the pointer, names a fixed size, drag pans.
    const before = await snap(h);
    const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const cx = Math.round(box.x + box.w / 2);
    const cy = Math.round(box.y + box.h / 2);
    for (let i = 0; i < 5; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -240 });
      await sleep(120);
    }
    await sleep(1400);
    const zoomed = await snap(h);
    const ratio = zoomed.cam.k / before.cam.k;
    assert.ok(ratio > 1.4 && ratio < 1.85, `five notches zoom about 1.6x in total (${ratio.toFixed(2)}x)`);
    assert.ok(zoomed.cam.k < 3.8, `five notches stay clear of the 4x cap (k=${zoomed.cam.k.toFixed(2)})`);
    const bw = new Map(before.labels.map((l) => [l.id, l]));
    const common = zoomed.labels.filter((l) => bw.has(l.id));
    assert.ok(common.length > 0, 'a label survives the zoom to measure');
    for (const l of common.slice(0, 6)) {
      const o = bw.get(l.id);
      assert.ok(Math.abs(l.w - o.w) <= 1 && Math.abs(l.h - o.h) <= 1, `${l.id} measures the same pixels`);
    }
    // Fully out always brings the whole brain back, even panned off-screen.
    const es = await snap(h);
    const empty = { x: es.view.w - 120, y: es.view.h - 120 };
    const g0 = await at(empty, MAIN);
    for (let round = 0; round < 3; round++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.x, y: g0.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10; i++) {
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.x - i * 60, y: g0.y - i * 40, button: 'left', buttons: 1 });
        await sleep(30);
      }
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.x - 600, y: g0.y - 400, button: 'left', clickCount: 1 });
      await sleep(600);
    }
    for (let i = 0; i < 12; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 240 });
      await sleep(100);
    }
    await sleep(1500);
    const back0 = await snap(h);
    const onView = back0.nodes.filter((n) => n.x >= 0 && n.y >= 0 && n.x <= back0.view.w && n.y <= back0.view.h).length;
    assert.ok(onView >= back0.count - 8, `zooming fully out brings the whole brain back (${onView} of ${back0.count} on view)`);

    // The card sits beside its point, never over its name.
    const pick = (await snap(h)).nodes.filter((n) => n.x > 300 && n.y > 80 && n.x < 1300 && n.y < 900).sort((a, b) => b.r - a.r)[0];
    const pxy = await at(pick, MAIN);
    await tap(pxy.x, pxy.y);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected === ${JSON.stringify(pick.id)}`, 5000), 'the click selects');
    assert.ok(await waitFor(h, `(document.querySelector('.nj-graph-body .bg-card') || {}).innerText.includes('Open')`, 5000), 'its card shows');
    await sleep(700);
    const sc = await snap(h);
    const pc = sc.nodes.find((n) => n.id === pick.id);
    const rects = await h.browser.ev(`(() => {
      const cr = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect();
      const card = document.querySelector('.nj-graph-body .bg-card');
      const r = card.getBoundingClientRect();
      return { left: r.x - cr.x, top: r.y - cr.y, w: r.width, h: r.height };
    })()`);
    assert.ok(rects.left >= 0 && rects.top >= 0 && rects.left + rects.w <= sc.view.w + 1 && rects.top + rects.h <= sc.view.h + 1, 'the card sits whole inside');
    const cxx = Math.min(rects.left + rects.w, Math.max(rects.left, pc.x));
    const cyy = Math.min(rects.top + rects.h, Math.max(rects.top, pc.y));
    assert.ok(Math.hypot(pc.x - cxx, pc.y - cyy) >= pc.r - 1, 'clear of the point');
    const lab = sc.labels.find((l) => l.id === pick.id);
    if (lab) {
      const lr = { left: lab.x - lab.w / 2, top: lab.y - lab.h / 2, w: lab.w, h: lab.h };
      const hit = rects.left < lr.left + lr.w - 1 && rects.left + rects.w > lr.left + 1 && rects.top < lr.top + lr.h - 1 && rects.top + rects.h > lr.top + 1;
      assert.equal(hit, false, 'clear of its name');
    }

    // Keyboard: arrows walk the neighbourhood, Enter opens, Escape clears.
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected !== ${JSON.stringify(pick.id)}`, 5000), 'the arrow keys walk');
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().selected === null`, 5000), 'Escape clears');

    // Centre here, then Ctrl+G from the note centres back on it with its neighbourhood lit.
    const cpick = (await snap(h)).nodes.filter((n) => n.x > 300 && n.y > 80 && n.x < 1300 && n.y < 900).sort((a, b) => b.r - a.r)[1] ?? (await snap(h)).nodes[0];
    const cpxy = await at(cpick, MAIN);
    await tap(cpxy.x, cpxy.y);
    assert.ok(await waitFor(h, `(document.querySelector('.nj-graph-body .bg-card') || {}).innerText.includes('Centre here')`, 5000), 'the card offers Centre here');
    await tapSel(h, `document.querySelector('.nj-graph-body .bg-card-centre')`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === ${JSON.stringify(cpick.id)}`, 10000), 'Centre here centres');
    assert.ok((await titles()).some((t) => t.includes('Connections:')), 'the tab says whose connections');
    await tapSel(h, `[...document.querySelectorAll('.nj-graph-head button')].find((e) => e.innerText.includes('Whole vault'))`);
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === null`, 10000), 'Whole vault steps back out');
    const openee = (await snap(h)).nodes.filter((n) => n.x > 300 && n.y > 80 && n.x < 1300 && n.y < 900).sort((a, b) => b.r - a.r)[0];
    const ohtm = await at(openee, MAIN);
    await tap(ohtm.x, ohtm.y, 1);
    await sleep(120);
    await tap(ohtm.x, ohtm.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(openee.title)}))`, 15000), `into ${openee.title}`);
    await sleep(800);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 2 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 2 });
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre === ${JSON.stringify(openee.id)}`, 15000), 'Ctrl+G from the note centres on it');
    const centred = await snap(h);
    assert.equal(centred.selected, openee.id, 'with its neighbourhood lit');

    // The camera is kept across leaving and coming back (t239, 12 Nov: the note opens where the person
    // is, Back returns; the taken camera is kept per graph, whatever the way back).
    const box2 = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const zx = Math.round(box2.x + box2.w / 2);
    const zy = Math.round(box2.y + box2.h / 2);
    for (let i = 0; i < 4; i++) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zx, y: zy, deltaX: 0, deltaY: -240 });
      await sleep(120);
    }
    await sleep(1200);
    const camBefore = (await snap(h)).cam;
    const graphTitle = await h.browser.ev(`document.querySelector('.tab-item.active .tab-title')?.textContent`);
    const leaver = (await snap(h)).nodes.filter((n) => n.x > 300 && n.y > 80).sort((a, b) => b.r - a.r)[0];
    const nxy = await at(leaver, MAIN);
    await tap(nxy.x, nxy.y, 1);
    await sleep(120);
    await tap(nxy.x, nxy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(leaver.title)}))`, 15000), `into ${leaver.title}`);
    assert.ok(await waitFor(h, `!!document.querySelector('button[aria-label="Back"]')`, 10000), 'Back stands once the note lands');
    await h.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
    assert.ok(await waitFor(h, `document.querySelector('.tab-item.active .tab-title')?.textContent === ${JSON.stringify(graphTitle)}`, 15000), 'Back returns to the graph tab');
    assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 0`, 15000), 'the graph draws again');
    await sleep(2500);
    const camBack = (await snap(h)).cam;
    assert.ok(Math.abs(camBack.k - camBefore.k) < 1e-9 && Math.abs(camBack.cx - camBefore.cx) < 1e-9 && Math.abs(camBack.cy - camBefore.cy) < 1e-9, `the taken camera survives (k ${camBefore.k.toFixed(2)} to ${camBack.k.toFixed(2)})`);

    // Each note's panel shows its own small graph (t151, 9 Nov 2026): the note in the middle, one step round it
    // with a faint second step, one click opens a neighbour, and a button opens the big graph. No card over the
    // 260px panel (the click opens at once).
    const notePick = (await snap(h)).nodes.filter((n) => n.x > 300 && n.y > 80).sort((a, b) => b.r - a.r)[0];
    const noteXy = await at(notePick, MAIN);
    await tap(noteXy.x, noteXy.y, 1);
    await sleep(120);
    await tap(noteXy.x, noteXy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(notePick.title)}))`, 15000), `into ${notePick.title}`);
    if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === false) {
      assert.equal(await clickWords(h, 'Show the right side'), 'CLICKED', 'the right side opens');
      await sleep(1200);
    }
    // The note's panes are on the right side's Note tab (20 Nov 2026: Chat | Note).
    await h.browser.ev(`document.querySelector('#side-tab-note:not([aria-selected="true"])')?.click()`);
    assert.ok(await waitFor(h, `!!document.querySelector('.local-graph .bg-canvas')`, 30000), 'the note has its own small graph');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().centre !== null`, 30000), 'it centres on the note');
    assert.ok(await waitFor(h, `window.__nvBrainGraph.snapshot().framed`, 90000), 'the small graph frames');
    const LOCAL = '.local-graph .bg-canvas';
    await h.browser.ev(`document.querySelector(${JSON.stringify(LOCAL)}).scrollIntoView({ block: 'center' })`);
    await sleep(400);
    const ls = await snap(h);
    assert.ok(ls.count >= 2 && ls.count <= 60, `the small graph holds its neighbourhood (${ls.count} notes)`);
    assert.ok(ls.nodes.some((n) => n.hop === 0), 'the middle marks hop 0');
    assert.ok(ls.nodes.some((n) => n.hop === 1), 'one step marks hop 1');
    const neigh = ls.nodes.filter((x) => x.id !== ls.centre && x.hop === 1).sort((a, b) => b.r - a.r)[0] ?? ls.nodes.filter((x) => x.id !== ls.centre).sort((a, b) => b.r - a.r)[0];
    assert.ok(neigh, 'a neighbour draws to tap');
    const lxy = await at(neigh, LOCAL);
    await tap(lxy.x, lxy.y);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(neigh.title)}))`, 15000), `one click opens ${neigh.title}`);
    assert.equal(await h.browser.ev(`!!document.querySelector('.local-graph .bg-card')`), false, 'no card over the small panel');
    assert.ok((await h.browser.ev(`document.querySelector('.sidebar.right [data-stack="graph"] button.side-suggest')?.innerText || ''`)).includes('Open in the graph'), 'a button opens the big graph');
  } finally {
    await h.close().catch(() => {});
  }
});
