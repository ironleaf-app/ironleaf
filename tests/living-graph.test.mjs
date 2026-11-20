// node --test tests/living-graph.test.mjs - the living graph (src/shared/living-graph.ts, the canvas in
// src/renderer/src/lib/living-engine.ts): the scope rules (noise hidden by default, Private always), colour by
// folder, labels that never overlap, reduce-motion stillness, and the no-wait clicks (one click selects and
// cards at once, double-click opens, Ctrl+click opens beside, Space and Centre here centre).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-living-graph-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/living-graph.ts'), platform: 'node', output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const n = (id, extra = {}) => ({ id, title: id.split('/').pop().replace(/\.md$/, ''), kind: 'note', ...extra });
const NODES = [
  n('Work/Plan.md'),
  n('Business/Shop.md'),
  n('Home/Garden.md'),
  n('Me/CV.md'),
  n('Health/Run.md'),
  n('Publications/Draft.md'),
  n('Top.md'),
  n('Templates/Blank.md'),
  n('Assets/logo.png', { kind: 'file' }),
  n('Attachments/pic.png', { kind: 'file' }),
  n('Views/Board.view.json'),
  n('Dashboards/Board.md'),
  n('Reviews/2026-W44.md'),
  n('Daily/2026-11-08.md'),
  n('Docs/Guide.md'),
  n('Home/Systems and Home Lab/Services.md'),
  n('Work/Machines.md'),
  n('Me/Runbooks.md'),
  n('Private notes/Secret.md'),
  n('Work/Old.md', { template: true }),
  { id: 'unresolved:Nope', title: 'Nope', kind: 'missing' },
  { id: 'tag:work', title: '#work', kind: 'tag' },
];
const LINKS = [
  { source: 'Work/Plan.md', target: 'Business/Shop.md' },
  { source: 'Work/Plan.md', target: 'Home/Garden.md' },
  { source: 'Business/Shop.md', target: 'Templates/Blank.md' },
  { source: 'Work/Plan.md', target: 'Private notes/Secret.md' },
  { source: 'Me/CV.md', target: 'Me/CV.md' },
  { source: 'Work/Plan.md', target: 'tag:work' },
];

test('scope: the noise stays out by default, links only between shown points', () => {
  const { nodes, links } = L.livingScope(NODES, LINKS);
  const ids = nodes.map((x) => x.id);
  for (const keep of ['Work/Plan.md', 'Business/Shop.md', 'Home/Garden.md', 'Me/CV.md', 'Health/Run.md', 'Publications/Draft.md', 'Top.md', 'Docs/Guide.md'])
    assert.ok(ids.includes(keep), `${keep} shows`);
  for (const hide of ['Templates/Blank.md', 'Assets/logo.png', 'Attachments/pic.png', 'Views/Board.view.json', 'Dashboards/Board.md', 'Reviews/2026-W44.md', 'Daily/2026-11-08.md', 'Home/Systems and Home Lab/Services.md', 'Work/Machines.md', 'Me/Runbooks.md', 'Private notes/Secret.md', 'Work/Old.md', 'unresolved:Nope', 'tag:work'])
    assert.ok(!ids.includes(hide), `${hide} hides`);
  assert.deepEqual(links, [
    { source: 'Work/Plan.md', target: 'Business/Shop.md' },
    { source: 'Work/Plan.md', target: 'Home/Garden.md' },
  ], 'links to noise, loops and tag threads fall with their ends');
});

test('scope: Show everything brings the rest back, never Private; store folders follow Settings', () => {
  const { nodes } = L.livingScope(NODES, LINKS, { showRest: true });
  const ids = nodes.map((x) => x.id);
  for (const back of ['Templates/Blank.md', 'Daily/2026-11-08.md', 'Work/Machines.md', 'Work/Old.md'])
    assert.ok(ids.includes(back), `${back} returns with Show everything`);
  assert.ok(!ids.includes('Private notes/Secret.md'), 'Private never returns');
  assert.ok(!ids.includes('unresolved:Nope') && !ids.includes('tag:work'), 'not-written notes and tags are never points');
  assert.equal(L.isDefaultHiddenGraphPath('My templates/Blank.md', { templatesFolder: 'My templates' }), true, 'a renamed templates folder hides too');
  assert.equal(L.isDefaultHiddenGraphPath('My templates/Blank.md', {}), false, 'only when Settings names it');
  assert.equal(L.isAlwaysHiddenGraphPath('Private notes/Secret.md'), true);
  assert.equal(L.isAlwaysHiddenGraphPath('Work/Plan.md'), false);
});

test('scope: the legend hides areas, the centre is forced through noise but never through Private', () => {
  const { nodes } = L.livingScope(NODES, LINKS, { hiddenAreas: ['Work', ''] });
  const ids = nodes.map((x) => x.id);
  assert.ok(!ids.includes('Work/Plan.md') && !ids.includes('Top.md'), 'hidden areas go, top level included');
  assert.ok(ids.includes('Home/Garden.md'), 'the rest stays');
  const forced = L.livingScope(NODES, LINKS, { forceIds: ['Templates/Blank.md', 'Private notes/Secret.md'] });
  assert.ok(forced.nodes.some((x) => x.id === 'Templates/Blank.md'), 'the centred note shows wherever it sits');
  assert.ok(!forced.nodes.some((x) => x.id === 'Private notes/Secret.md'), 'Private holds even as the centre');
});

test('colour: busiest area first, six areas six colours, every one bright on the dark', () => {
  const ordered = L.orderLivingAreas([['Home', 2], ['Work', 9], ['Me', 9], ['Business', 4]]);
  assert.deepEqual(ordered, ['Me', 'Work', 'Business', 'Home'], 'busiest first, ties by name');
  const six = L.orderLivingAreas([['Work', 6], ['Business', 5], ['Home', 4], ['Me', 3], ['Health', 2], ['Publications', 1]]);
  const colours = six.map((a) => L.colourForLivingArea(a, six));
  assert.equal(new Set(colours).size, 6, `six areas, six colours (${colours.join(' ')})`);
  assert.equal(L.colourForLivingArea('Work', six), L.colourForLivingArea('Work', six), 'stable');
  // Relative luminance well above the blue-black ground (#0a0e17): every colour reads on the dark.
  const lum = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const c of L.LIVING_PALETTE) assert.ok(lum(c) > 0.12, `${c} reads on dark`);
  assert.ok(!L.LIVING_PALETTE.some((c) => /cream|beige/i.test(c)), 'no banned chrome');
});

test('size grows with links, then holds', () => {
  const r = [0, 1, 4, 9, 25, 48, 100, 10000].map((d) => L.radiusForLivingDegree(d));
  for (let i = 1; i < r.length; i++) assert.ok(r[i] >= r[i - 1], `grows (${r.join(' ')})`);
  assert.ok(r[0] > 0 && r[r.length - 1] === 15, `small stays visible, hubs hold at 15 (${r.join(' ')})`);
});

test('labels never pile on each other: a crowded default zoom leaves no overlap', () => {
  // 300 labels crowded in a small world, biggest first, as the engine offers them.
  const cands = [];
  for (let i = 0; i < 300; i++) {
    const t = i * 2.39996;
    const rad = 8 + (i / 300) * 120;
    cands.push({ id: `n:${i}`, x: 500 + Math.cos(t) * rad, y: 350 + Math.sin(t) * rad * 0.7, w: 60 + (i % 7) * 9, h: 18, rank: 300 - i });
  }
  const shown = L.resolveLivingLabels(cands);
  const boxes = cands.filter((c) => shown.has(c.id));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = Math.abs(a.x - b.x) * 2 < a.w + b.w + 6 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 18;
      assert.equal(overlap, false, `${a.id} overlaps ${b.id}`);
    }
  }
  assert.ok(shown.size > 10 && shown.size < 300, `${shown.size} of 300 draw: crowded but never piled`);
  // The smaller hides when two collide; a cluster tag outranks a small label.
  const two = L.resolveLivingLabels([
    { id: 'n:big', x: 0, y: 0, w: 100, h: 20, rank: 900 },
    { id: 'n:small', x: 10, y: 0, w: 60, h: 16, rank: 100 },
  ]);
  assert.deepEqual([...two], ['n:big']);
  const tag = L.resolveLivingLabels([
    { id: 't:Work', x: 0, y: 0, w: 120, h: 18, rank: 20003 },
    { id: 'n:small', x: 5, y: 0, w: 60, h: 16, rank: 400 },
  ]);
  assert.deepEqual([...tag], ['t:Work'], 'the label yields to the tag, never over it');
});

test('names stacked a line apart read as one smudge: the smaller hides', () => {
  // t76: "Me note 10" and "Me note 11" drew stacked 26px apart at 1920 - through the check,
  // which only asked ~21px, but reading as one smudge under the link lines. The check asks
  // daylight between names now, so the smaller of a near stack hides (equal rank: first name keeps).
  const stacked = L.resolveLivingLabels([
    { id: 'n:Me/Me note 10.md', x: 1203, y: 197, w: 73, h: 19, rank: 710 },
    { id: 'n:Me/Me note 11.md', x: 1184, y: 223, w: 69, h: 19, rank: 710 },
  ]);
  assert.deepEqual([...stacked], ['n:Me/Me note 10.md']);
});

// ── clusters you can read: the layout twin ─────────────────────────────────
// A digital twin of the proof vault (its areas, counts, projects and linking shape), settled by the same
// d3 construction the engine runs: the same shared anchors, project corners, per-thread tuning and pull.
// The four cluster promises are measured on it: separation, tags, resting names, and fill.
const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TWINS = new Map();
function layoutTwin(aspect = 1.7) {
  const band = L.livingAspectBand(aspect);
  if (TWINS.has(band)) return TWINS.get(band);
  const rnd = mulberry(20261109);
  const areas = [['Work', 79], ['Business', 51], ['Home', 40], ['Me', 36], ['People', 24], ['Health', 23], ['Publications', 19], ['Meetings', 15]];
  const nProj = { Work: 5, Business: 3, Home: 2, Me: 2, Health: 1, Publications: 1 };
  const nodes = [];
  for (const [area, count] of areas) {
    const projs = [];
    for (let i = 0; i < (nProj[area] ?? 0); i++) projs.push(`proj:${area}:${i}`);
    for (let i = 0; i < count; i++) {
      // Project files and their notes first (9 to a project, like the shot vault), the rest loose.
      const pi = Math.floor(i / 9);
      nodes.push({ id: `${area}/note ${i + 1}`, title: `note ${i + 1}`, area, project: pi < projs.length ? projs[pi] : null });
    }
  }
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const byArea = new Map();
  for (const x of nodes) {
    const l = byArea.get(x.area) ?? [];
    l.push(x);
    byArea.set(x.area, l);
  }
  const byProj = new Map();
  for (const x of nodes) {
    if (!x.project) continue;
    const l = byProj.get(x.project) ?? [];
    l.push(x);
    byProj.set(x.project, l);
  }
  // The shot vault's linking shape (proof-vault.mjs): project notes link their file, a person and a
  // meeting; loose notes link a person, a project anywhere, and half a meeting; people link people.
  const people = byArea.get('People');
  const meetings = byArea.get('Meetings');
  const files = nodes.filter((x) => x.project && x.id.endsWith('/note 1'));
  const links = [];
  for (const x of nodes) {
    if (x.area === 'People') {
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
    } else if (x.area === 'Meetings') {
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
    } else if (x.project && x.id.endsWith('/note 1')) {
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
    } else if (x.project) {
      links.push({ source: x.id, target: byProj.get(x.project)[0].id });
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
      links.push({ source: x.id, target: meetings[Math.floor(rnd() * meetings.length)].id });
    } else {
      links.push({ source: x.id, target: people[Math.floor(rnd() * people.length)].id });
      links.push({ source: x.id, target: files[Math.floor(rnd() * files.length)].id });
      if (rnd() < 0.5) links.push({ source: x.id, target: meetings[Math.floor(rnd() * meetings.length)].id });
    }
  }
  const degree = new Map();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  for (const x of nodes) x.r = L.radiusForLivingDegree(degree.get(x.id) ?? 0);
  // The engine's own construction (living-engine.ts setData): shared anchors, project corners, per-thread
  // tuning, the same pull. The wiring asserts below fail if the engine stops using any of these.
  const counts = new Map(areas);
  const anchor = L.livingAreaAnchors(counts, aspect);
  const members = new Map();
  for (const x of nodes) if (x.project) members.set(x.project, (members.get(x.project) ?? 0) + 1);
  const projsByArea = new Map();
  for (const x of nodes) {
    if (!x.project || (members.get(x.project) ?? 0) < 2) continue;
    const l = projsByArea.get(x.area) ?? [];
    if (!l.includes(x.project)) l.push(x.project);
    projsByArea.set(x.area, l);
  }
  const corners = new Map();
  for (const [area, keys] of projsByArea) {
    const home = anchor.get(area) ?? { x: 0, y: 0 };
    keys.sort();
    keys.forEach((k, i) => corners.set(k, L.livingProjectAnchor(home, i, keys.length, members.get(k) ?? 2)));
  }
  const pullOf = (area, project) => (project && corners.get(project)) || anchor.get(area) || { x: 0, y: 0 };
  for (const x of nodes) {
    const home = pullOf(x.area, x.project);
    const spread = 48 + 5 * Math.sqrt(counts.get(x.area) ?? 1);
    x.x = home.x + (rnd() * 2 - 1) * spread;
    x.y = home.y + (rnd() * 2 - 1) * spread;
  }
  const simLinks = [];
  for (const l of links) {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (!a || !b || a === b) continue;
    const t = L.livingLinkTuning(a.area === b.area, !!a.project && a.project === b.project);
    simLinks.push({ source: a, target: b, dist: t.distance, stiff: t.strength });
  }
  const sim = forceSimulation(nodes)
    .force('link', forceLink(simLinks).distance((l) => l.dist).strength((l) => l.stiff))
    .force('charge', forceManyBody().strength(-130).distanceMax(420).theta(0.85))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide().radius((d) => d.r + 3).strength(0.8).iterations(1))
    .force('ax', forceX().strength(L.LIVING_AREA_PULL).x((d) => pullOf(d.area, d.project).x))
    .force('ay', forceY().strength(L.LIVING_AREA_PULL).y((d) => pullOf(d.area, d.project).y))
    .velocityDecay(0.32)
    .alphaDecay(0.045)
    .alphaMin(0.008)
    .stop();
  sim.randomSource(mulberry(7));
  let ticks = 0;
  while (sim.alpha() > 0.008 && ticks < 800) {
    sim.tick();
    ticks++;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of nodes) {
    minX = Math.min(minX, x.x);
    minY = Math.min(minY, x.y);
    maxX = Math.max(maxX, x.x);
    maxY = Math.max(maxY, x.y);
  }
  const twin = { nodes, links: simLinks, alpha: sim.alpha(), ticks, bounds: { minX, minY, maxX, maxY } };
  TWINS.set(band, twin);
  return twin;
}

test('clusters: one area’s points sit nearer their own middle than any other’s, projects tighter inside', () => {
  const t = layoutTwin();
  assert.ok(t.alpha <= 0.01, `settled before measuring (alpha ${t.alpha} after ${t.ticks} ticks)`);
  const byArea = new Map();
  for (const x of t.nodes) {
    const l = byArea.get(x.area) ?? [];
    l.push(x);
    byArea.set(x.area, l);
  }
  const cent = new Map([...byArea].map(([a, l]) => [a, { x: l.reduce((s, x) => s + x.x, 0) / l.length, y: l.reduce((s, x) => s + x.y, 0) / l.length }]));
  let near = 0;
  for (const x of t.nodes) {
    const own = cent.get(x.area);
    const dOwn = Math.hypot(x.x - own.x, x.y - own.y);
    let ok = true;
    for (const [a, c] of cent) {
      if (a !== x.area && Math.hypot(x.x - c.x, x.y - c.y) < dOwn) {
        ok = false;
        break;
      }
    }
    if (ok) near++;
  }
  const frac = near / t.nodes.length;
  assert.ok(frac > 0.8, `${Math.round(frac * 100)}% of points sit nearest their own middle (needs 80)`);
  // Projects inside an area pull their notes together a little more.
  let inP = 0;
  let inPN = 0;
  let outP = 0;
  let outPN = 0;
  for (const l of byArea.values()) {
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const d = Math.hypot(l[i].x - l[j].x, l[i].y - l[j].y);
        if (l[i].project && l[i].project === l[j].project) {
          inP += d;
          inPN++;
        } else {
          outP += d;
          outPN++;
        }
      }
    }
  }
  assert.ok(inP / inPN < outP / outPN, `project mates sit closer (${Math.round(inP / inPN)} vs ${Math.round(outP / outPN)} apart)`);
  // Links between areas stay long threads across the gaps.
  let cross = 0;
  let crossN = 0;
  let within = 0;
  let withinN = 0;
  for (const l of t.links) {
    const d = Math.hypot(l.source.x - l.target.x, l.source.y - l.target.y);
    if (l.source.area === l.target.area) {
      within += d;
      withinN++;
    } else {
      cross += d;
      crossN++;
    }
  }
  assert.ok(cross / crossN > (within / withinN) * 1.5, `threads across the gaps run longer (${Math.round(cross / crossN)} vs ${Math.round(within / withinN)})`);
  // The engine runs this same construction, not a lookalike.
  const engine = read('src/renderer/src/lib/living-engine.ts');
  for (const s of ['livingAreaAnchors(counts, this.aspectOf())', 'this.rehome(nodes)', 'livingProjectAnchor(home, i', 'livingLinkTuning(a.area === b.area', 'strength(LIVING_AREA_PULL)', 'recent: n.recent, project: n.project']) {
    assert.ok(engine.includes(s), `the engine runs ${s}`);
  }
  assert.ok(read('src/renderer/src/components/GraphView.tsx').includes('project: livingProjectOf(n)'), 'the shell hands each point its project corner');
});

test('tags: each at its cluster’s edge, never on another tag', () => {
  // The old failure first: every middle piled on the same point.
  const areas = ['Work', 'Business', 'Home', 'Me', 'People', 'Health', 'Publications', 'Meetings'];
  const piled = areas.map((a) => ({ area: a, x: 500, y: 350, w: 70 + a.length * 6, h: 26, edge: 120 }));
  const pts = piled.map((b) => ({ ...b, ...L.livingPlaceTags(piled, 500, 350).get(b.area) }));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const [a, b] = [pts[i], pts[j]];
      const touch = Math.abs(a.x - b.x) * 2 < a.w + b.w + 12 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 10;
      assert.equal(touch, false, `${a.area} sits on ${b.area}`);
    }
  }
  for (const p of pts) {
    const d = Math.hypot(p.x - 500, p.y - 350);
    assert.ok(d >= 120 + 26 - 1, `${p.area} sits past its cloud’s edge (${Math.round(d)})`);
    assert.ok(d < 120 + 26 + 500, `${p.area} stays by its cluster (${Math.round(d)})`);
  }
  // Settled clusters: each tag at its edge, none touching, placed the same way twice.
  const t = layoutTwin();
  const tags = L.livingClusterTags(t.nodes);
  let ox = 0;
  let oy = 0;
  for (const x of t.nodes) {
    ox += x.x;
    oy += x.y;
  }
  ox /= t.nodes.length;
  oy /= t.nodes.length;
  const boxes = tags.map((g) => ({ area: g.area, x: g.x, y: g.y, w: 60 + g.name.length * 6, h: 26, edge: g.edge }));
  const once = L.livingPlaceTags(boxes, ox, oy);
  const twice = L.livingPlaceTags(boxes, ox, oy);
  assert.deepEqual([...once], [...twice], 'placed the same way twice');
  const at = boxes.map((b) => ({ ...b, ...once.get(b.area) }));
  for (const p of at) {
    const d = Math.hypot(p.x - boxes.find((b) => b.area === p.area).x, p.y - boxes.find((b) => b.area === p.area).y);
    assert.ok(d >= p.edge + 25 && d <= p.edge + 250, `${p.area} sits at its edge (${Math.round(d)} past ${Math.round(p.edge)})`);
  }
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      const [a, b] = [at[i], at[j]];
      const touch = Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
      assert.equal(touch, false, `${a.area} touches ${b.area}`);
    }
  }
  // The engine draws a small pill in the area’s colour at the placed point.
  const engine = read('src/renderer/src/lib/living-engine.ts');
  for (const s of ['livingPlaceTags(boxes,', 'roundRect(c.x - pw / 2', 'strokeStyle = t.colour']) {
    assert.ok(engine.includes(s), `the engine draws ${s}`);
  }
});

test('resting names: at most 3 per cluster, the lit ones always, never overlapping', () => {
  const t = layoutTwin();
  const hot = new Set([t.nodes[0].id, t.nodes[1].id]);
  const rest = L.livingRestLabelIds(t.nodes, hot);
  assert.ok(rest.has(t.nodes[0].id) && rest.has(t.nodes[1].id), 'the lit ones always show');
  const perArea = new Map();
  for (const x of t.nodes) {
    if (!rest.has(x.id) || hot.has(x.id)) continue;
    perArea.set(x.area, (perArea.get(x.area) ?? 0) + 1);
  }
  for (const [a, c] of perArea) assert.ok(c <= 3, `${a} rests ${c} names (at most 3)`);
  assert.equal([...perArea.values()].reduce((s, c) => s + c, 0), 24, 'every cluster reads its biggest three');
  const work = t.nodes.filter((x) => x.area === 'Work' && !hot.has(x.id)).sort((a, b) => b.r - a.r || a.title.localeCompare(b.title)).slice(0, 3);
  for (const x of work) assert.ok(rest.has(x.id), `Work’s biggest includes ${x.title}`);
  // The resting boxes through the same no-overlap pass: whatever draws is pairwise clear.
  const boxes = t.nodes.filter((x) => rest.has(x.id)).map((x) => ({ id: `n:${x.id}`, x: x.x, y: x.y - x.r - 8, w: 60 + (x.title.length % 5) * 10, h: 18, rank: x.r * 100 }));
  const kept = boxes.filter((b) => L.resolveLivingLabels(boxes).has(b.id));
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const [a, b] = [kept[i], kept[j]];
      const touch = Math.abs(a.x - b.x) * 2 < a.w + b.w + 6 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 18;
      assert.equal(touch, false, `${a.id} overlaps ${b.id}`);
    }
  }
  assert.ok(kept.length >= 8, `${kept.length} resting names draw across 8 clusters`);
  const engine = read('src/renderer/src/lib/living-engine.ts');
  for (const s of ['livingRestLabelIds(this.nodes, hot)', 'LIVING_ZOOMED_K']) {
    assert.ok(engine.includes(s), `the engine rests ${s}`);
  }
});

test('fill: the settled vault covers most of the canvas at every size', () => {
  // The .lg-canvas rects measured in headless Chromium at each window size (proof run, 9 Nov 2026).
  for (const [w, h] of [[927, 519], [1628, 927], [3164, 1218]]) {
    const t = layoutTwin((w - 220) / h);
    const { minX, minY, maxX, maxY } = t.bounds;
    const f = L.fitLivingView(minX, minY, maxX, maxY, w - 220, h, 48);
    const fw = ((maxX - minX) * f.k) / (w - 220);
    const fh = ((maxY - minY) * f.k) / h;
    assert.ok(fw > 0.7 && fh > 0.7, `canvas ${w}x${h}: covers ${Math.round(fw * 100)}% by ${Math.round(fh * 100)}% (needs 70)`);
  }
  assert.ok(read('src/renderer/src/lib/living-engine.ts').includes('reserve / 2 / f.k'), 'the vault fits beside the legend, not under it');
});

test('the note’s own graph: two steps out, its own card never a hub', () => {
  const nodes = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'me.md'].map((id) => n(id));
  const links = [
    { source: 'a.md', target: 'b.md' },
    { source: 'b.md', target: 'c.md' },
    { source: 'c.md', target: 'd.md' },
    { source: 'a.md', target: 'me.md' },
    { source: 'e.md', target: 'b.md' },
  ];
  const sub = L.livingLocal(nodes, links, 'a.md', 2, ['E']);
  assert.deepEqual(sub.nodes.map((x) => x.id).sort(), ['a.md', 'b.md', 'c.md', 'me.md'].sort(), 'the centre and two steps');
  const noMe = L.livingLocal(nodes, links, 'a.md', 2, ['Me']);
  assert.ok(!noMe.nodes.some((x) => x.id === 'me.md'), 'the person’s own card never a hub');
  assert.deepEqual(L.livingLocal(nodes, links, 'missing.md'), { nodes: [], links: [] });
  assert.deepEqual(L.livingNeighbours('b.md', links).sort(), ['a.md', 'c.md', 'e.md']);
});

test('reduce-motion: no drift, no travelling pulses, only the highlight', () => {
  assert.deepEqual(L.livingMotion(true), { drift: false, pulses: false, ambient: false });
  assert.deepEqual(L.livingMotion(false), { drift: true, pulses: true, ambient: true });
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'the engine hears the OS setting');
  assert.ok(engine.includes('if (this.reduced) this.pulses = []'), 'travelling pulses stop dead');
  assert.ok(engine.includes('livingMotion(this.reduced).pulses'), 'hover fires nothing while reduced');
  assert.ok(read('src/renderer/src/styles/graph.css').includes('@media (prefers-reduced-motion: reduce)'), 'the legend rests too');
});

test('click selects at once and names the card, double-click opens, Ctrl+click opens beside, Space centres', () => {
  const pts = [
    { id: 'a', x: 0, y: 0, r: 4 },
    { id: 'b', x: 30, y: 0, r: 4 },
    { id: 'c', x: 14, y: 0, r: 4 },
  ];
  assert.equal(L.hitLivingNode(pts, 2, 1), 'a');
  assert.equal(L.hitLivingNode(pts, 28, 0), 'b');
  assert.equal(L.hitLivingNode(pts, 200, 200), null, 'empty space is nothing');
  assert.equal(L.hitLivingNode(pts, 10, 0), 'c', 'in two reaches, the nearer wins');
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(!engine.includes('pendingOpen'), 'no held click: the tap selects on the way up');
  assert.ok(engine.includes('this.select(id, false);'), 'one click selects and fires at once, leaving the camera where it is');
  assert.ok(engine.includes('this.camTouched = true;\n    this.camAnim = null;'), 'selecting stops the framing glide under the tap, so a second tap lands');
  assert.ok(engine.includes('if (e.ctrlKey || e.metaKey) this.onOpen(id, true);'), 'Ctrl+click opens beside at once');
  assert.ok(engine.includes('this.onOpen(id, false)'), 'double-click opens in this tab');
  assert.ok(engine.includes("e.key === 'Enter'") && engine.includes('this.onOpen(id, e.ctrlKey || e.metaKey)'), 'Enter opens too');
  assert.ok(engine.includes("e.key === ' '") && engine.includes('this.onCentre(id);'), 'Space centres on the selected point');
  assert.ok(engine.includes('this.onSelect(null)'), 'empty canvas clears the selection');
  const view = read('src/renderer/src/components/GraphView.tsx');
  assert.ok(view.includes('onOpen: (id, newTab) => openRef.current(id, newTab)'), 'the shell hands opens through');
  assert.ok(view.includes('onSelect: (id) => setSelectedId(id)'), 'the shell hears selections for the card');
  assert.ok(view.includes('lg-card') && view.includes('>Open<') && view.includes('>Centre here<'), 'the card names the note with its Open and Centre here');
  assert.ok(view.includes('placeLivingCard('), 'the card sits by its point through the one placer');
  const tab = read('src/renderer/src/views/GraphTab.tsx');
  // t239 (12 Nov): the graph opens where the person is, Back returns; Ctrl opens a tab (pinned by
  // t239-click-opens).
  assert.ok(tab.includes('A.openPath(p, { reuse: !newTab, where: newTab ? \'tab\' : \'current\' })'), 'open reuses, Ctrl+click opens a tab');
  assert.ok(tab.includes('Click a point to see its links. Double-click to open it.'), 'the page teaches the clicks');
});

test('the card sits by its point: right with room, left at the edge, whole and clear of the legend', () => {
  const at = (x, y, cw = 220, ch = 120, vw = 1219, vh = 709, reserve = 220) => L.placeLivingCard({ x, y }, cw, ch, vw, vh, reserve);
  assert.deepEqual(at(600, 350), { left: 616, top: 290 }, 'right of the point, centred on it');
  assert.deepEqual(L.placeLivingCard({ x: 600, y: 350, r: 40 }, 220, 120, 1219, 709, 220), { left: 656, top: 290 }, 'clear of a hub’s body, not just its middle');
  const flip = at(1150, 350);
  assert.deepEqual(flip, { left: 914, top: 290 }, 'near the right edge it flips left instead of clipping');
  const legend = at(100, 350);
  assert.ok(legend.left >= 228, `clear of the legend (left ${legend.left}, needs 228)`);
  const top = at(600, 10);
  assert.ok(top.top >= 8, `clear of the top (top ${top.top})`);
  const bottom = at(600, 700);
  assert.ok(bottom.top + 120 <= 709 - 8 + 1, `clear of the bottom (top ${bottom.top})`);
  const tiny = L.placeLivingCard({ x: 100, y: 100 }, 220, 120, 300, 200, 0);
  assert.ok(tiny.left >= 8 && tiny.left + 220 <= 300 + 1 && tiny.top >= 8 - 1, `holds inside a small panel (${tiny.left},${tiny.top})`);
  assert.deepEqual(at(600, 350), at(600, 350), 'placed the same way twice');
});

test('the settled page holds still: same data reheats nothing, framing follows only until taken', () => {
  const engine = read('src/renderer/src/lib/living-engine.ts');
  assert.ok(engine.includes('if (sig === this.lastSig) {') && engine.includes('setData:identical-skip'), 'identical data is a no-op (typing never shakes the page)');
  assert.ok(engine.includes('if (!this.camTouched') && engine.includes('this.reframe()'), 'settles reframe the view until taken');
  assert.ok(engine.includes('this.camTouched = true;'), 'a pan, zoom or key-walk takes the camera');
  assert.ok(engine.includes('if (!id) return;'), 'a double-click miss zooms nowhere (it lands after the taps reframed)');
});

test('lately touched means within the week; the camera fits the vault with room', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(L.isLivingRecent(now - 6 * 86400000, now), true);
  assert.equal(L.isLivingRecent(now - 8 * 86400000, now), false, 'older than the week is quiet');
  assert.equal(L.isLivingRecent(undefined, now), false);
  const f = L.fitLivingView(0, 0, 1000, 500, 1219, 709, 48);
  assert.deepEqual([f.cx, f.cy], [500, 250], 'centred');
  assert.ok(Math.abs(f.k - Math.min((1219 - 96) / 1000, (709 - 96) / 500)) < 1e-9, `zoomed to fit (${f.k})`);
});

// ── live: the real window draws points, and clicks open the right note ──────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(h, js, ms = 30000) {
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
  const hit = await h.browser.ev(`(async () => {
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
  return hit;
}
async function openRoom(h, name) {
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', `More opens for ${name}`);
  await sleep(500);
  assert.equal(await clickWords(h, name, '.menu, [role="menu"]'), 'CLICKED', `${name} opens from More`);
}
const snap = (h) => h.browser.ev(`window.__nvLivingGraph.snapshot()`);

test('live: one click selects and cards at once, double-click opens once, Ctrl+click opens beside, Space and Centre here centre, empty clears, the small graph matches', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { showTabs: true } }]);
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html?graph=living` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'points draw');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles');
    const HARBOUR = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
    const ALEX = 'People/Alex Chen.md';
    const titles = () => h.browser.ev(`[...document.querySelectorAll('.tab-item .tab-title')].map((e) => e.textContent)`);
    const actives = () => h.browser.ev(`[...document.querySelectorAll('.tab-item.active .tab-title')].map((e) => e.textContent)`);
    const groups = () => h.browser.ev(`document.querySelectorAll('section.group').length`);
    const point = async (id) => {
      const s = await snap(h);
      const t = s.nodes.find((x) => x.id === id);
      assert.ok(t, `${id} is a point (${s.nodes.map((x) => x.id).join(', ')})`);
      return t;
    };
    const at = async (t, canvasSel) => {
      const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(canvasSel)}).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
      return { x: Math.round(box.x + t.x), y: Math.round(box.y + t.y) };
    };
    const tap = async (x, y, count = 1, mods = 0) => {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers: mods });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers: mods });
    };
    const MAIN = '.nj-graph-body .lg-canvas';
    const cardText = (scope) => h.browser.ev(`(() => { const c = document.querySelector(${JSON.stringify(`${scope} .lg-card`)}); return c ? c.innerText : null; })()`);
    // One click selects with no delay: the very first read already names it, fires, and says its links, and no
    // tab opens. The card carries its name, area, link count and Open.
    const tabsBefore = await titles();
    const ht = await point(HARBOUR);
    assert.ok(ht.x > 260 && ht.y > 60, `Harbourline sits clear of the legend (at ${Math.round(ht.x)},${Math.round(ht.y)})`);
    const hxy = await at(ht, MAIN);
    await tap(hxy.x, hxy.y);
    const picked = await snap(h);
    assert.equal(picked.selected, HARBOUR, 'one click selects at once, under one frame');
    assert.ok(picked.pulses > 0, `its links fire at once (${picked.pulses} pulses)`);
    assert.match(await h.browser.ev(`document.querySelector('.nj-graph-body .lg-live').textContent`), /Harbourline Cart Fix, \d+ links?/, 'it names its neighbours');
    assert.deepEqual(await titles(), tabsBefore, 'one click opens nothing');
    assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .lg-card') || {}).innerText || '').includes('Open')`, 5000), 'the card shows by the point');
    const card = await cardText('.nj-graph-body');
    assert.ok(card.includes('Harbourline Cart Fix'), `the card names the note (${card})`);
    assert.ok(card.includes('Projects'), `the card names its area (${card})`);
    assert.ok(/\d+ links?/.test(card), `the card counts its links (${card})`);
    assert.ok(card.includes('Open') && card.includes('Centre here'), `the card offers Open and Centre here (${card})`);
    // Space on the selected point centres on it (double-click no longer does).
    await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre === ${JSON.stringify(HARBOUR)}`, 10000), 'Space centres on the selected point');
    // Double-click opens where the person is, Back returns (t239, 12 Nov): the note lands in this tab.
    await clickWords(h, 'Whole vault');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles back out');
    const dt = await point(HARBOUR);
    const dxy = await at(dt, MAIN);
    const openBefore = await titles();
    const graphTitle = await h.browser.ev(`document.querySelector('.tab-item.active .tab-title')?.textContent`);
    await tap(dxy.x, dxy.y, 1);
    await sleep(120);
    await tap(dxy.x, dxy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes('Harbourline Cart Fix'))`, 10000), 'double-click opens the note where the person is');
    const opened = await titles();
    assert.equal(opened.length, openBefore.length, `double-click opens no new tab (${opened.join(' / ')})`);
    assert.ok((await actives()).some((t) => t.includes('Harbourline Cart Fix')), `the right note opens (${opened.join(' / ')})`);
    assert.equal(await groups(), 1, 'double-click stays in the group');
    assert.ok(await waitFor(h, `!!document.querySelector('button[aria-label="Back"]')`, 10000), 'Back stands once the note lands');
    await h.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
    assert.ok(await waitFor(h, `document.querySelector('.tab-item.active .tab-title')?.textContent === ${JSON.stringify(graphTitle)}`, 15000), 'Back returns to the graph tab');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`, 10000), 'the graph draws again');
    // Centre here centres on the card's point (the Ctrl+click split waits until after the small graph
    // below, so only one small graph is mounted while its points are tapped).
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'the graph opens again');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'settles again');
    const et = await point(ALEX);
    const exy = await at(et, MAIN);
    await tap(exy.x, exy.y);
    assert.ok(await waitFor(h, `((document.querySelector('.nj-graph-body .lg-card') || {}).innerText || '').includes('Open')`, 5000), 'the card shows again');
    assert.equal(await clickWords(h, 'Centre here', '.nj-graph-body .lg-card'), 'CLICKED', 'Centre here clicks');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre === ${JSON.stringify(ALEX)}`, 10000), 'Centre here centres');
    // Empty canvas clears the selection and the card.
    const es = await snap(h);
    const cands = [{ x: es.view.w - 120, y: es.view.h - 120 }, { x: es.view.w - 120, y: 120 }, { x: 340, y: es.view.h - 120 }, { x: es.view.w / 2, y: es.view.h - 80 }];
    const empty = cands.find((c) => es.nodes.every((n) => Math.hypot(n.x - c.x, n.y - c.y) > 40)) ?? cands[0];
    const gxy = await at(empty, MAIN);
    await tap(gxy.x, gxy.y);
    assert.equal((await snap(h)).selected, null, 'empty canvas clears at once');
    assert.equal(await cardText('.nj-graph-body'), null, 'the card goes with it');
    // The note's own small graph behaves the same: click selects and cards, double-click opens.
    await clickWords(h, 'Whole vault');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the vault settles whole again');
    const ot = await point(HARBOUR);
    assert.ok(ot.x > 260 && ot.y > 60, `Harbourline sits clear of the legend again (at ${Math.round(ot.x)},${Math.round(ot.y)})`);
    const oxy = await at(ot, MAIN);
    await tap(oxy.x, oxy.y, 1);
    await sleep(120);
    await tap(oxy.x, oxy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes('Harbourline Cart Fix'))`, 10000), 'into the note');
    if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === false) {
      assert.equal(await clickWords(h, 'Show the right side'), 'CLICKED', 'the right side opens');
      await sleep(1200);
    }
    // The note's panes are on the right side's Note tab (20 Nov 2026: Chat | Note).
    await h.browser.ev(`document.querySelector('#side-tab-note:not([aria-selected="true"])')?.click()`);
    assert.ok(await waitFor(h, `!!document.querySelector('.local-graph .lg-canvas')`), 'the note’s graph draws');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().centre !== null`, 30000), 'it centres on the note');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'the small graph settles');
    const LOCAL = '.local-graph .lg-canvas';
    await h.browser.ev(`document.querySelector(${JSON.stringify(LOCAL)}).scrollIntoView({ block: 'center' })`);
    await sleep(400);
    const ls = await snap(h);
    const onView = ls.nodes.filter((x) => x.x > 20 && x.y > 20 && x.x < ls.view.w - 20 && x.y < ls.view.h - 20);
    assert.ok(onView.length >= ls.nodes.length - 1, `the framed neighbours sit on the panel (${onView.length} of ${ls.nodes.length} on view)`);
    const picks = onView
      .filter((x) => x.id !== ls.centre)
      .map((x) => ({ x, d: Math.min(...ls.nodes.filter((o) => o.id !== x.id).map((o) => Math.hypot(o.x - x.x, o.y - x.y))) }))
      .sort((a, b) => b.d - a.d);
    assert.ok(picks.length && picks[0].d > 18, `a neighbour stands clear to tap (${picks.map((c) => `${c.x.title}:${Math.round(c.d)}`).join(', ')})`);
    const neighbour = picks[0].x;
    const lxy = await at(neighbour, LOCAL);
    await tap(lxy.x, lxy.y);
    assert.equal((await snap(h)).selected, neighbour.id, 'one click selects in the small graph too');
    assert.ok(await waitFor(h, `((document.querySelector('.local-graph .lg-card') || {}).innerText || '').includes('Open')`, 5000), 'its card shows too');
    const localCard = await cardText('.local-graph');
    assert.ok(localCard.includes(neighbour.title) && localCard.includes('Open'), `its card names the note with Open (${localCard})`);
    assert.ok(!localCard.includes('Centre here'), 'the small card keeps no Centre here (it is already centred)');
    const nxy = await at(neighbour, LOCAL);
    const localBefore = await titles();
    await tap(nxy.x, nxy.y, 1);
    await sleep(120);
    await tap(nxy.x, nxy.y, 2);
    assert.ok(await waitFor(h, `[...document.querySelectorAll('.tab-item.active .tab-title')].some((e) => e.textContent.includes(${JSON.stringify(neighbour.title)}))`, 10000), `double-click opens ${neighbour.title} from the small graph`);
    assert.equal((await titles()).length, localBefore.length, 'opening beside the note reuses its tab, no stray tab');
    // Reduce-motion: the hover lands, but nothing travels; a click still selects, still silently.
    // (Before the Ctrl+click split below: with one group the test hook is the main engine for certain.)
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'the graph opens a last time');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'settles a last time');
    await h.browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(600);
    assert.equal((await snap(h)).reduced, true, 'the engine hears reduce-motion');
    const s = await snap(h);
    const t = s.nodes.find((x) => (x.x > 260 ? x : null)) ?? s.nodes[0];
    const box = await h.browser.ev(`(() => { const r = document.querySelector(${JSON.stringify(MAIN)}).getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x + t.x), y: Math.round(box.y + t.y) });
    await sleep(900);
    const still = await snap(h);
    assert.equal(still.hovered, t.id, 'the hover lands');
    assert.equal(still.pulses, 0, 'but nothing travels');
    await tap(Math.round(box.x + t.x), Math.round(box.y + t.y));
    const calmed = await snap(h);
    assert.equal(calmed.selected, t.id, 'a click still selects');
    assert.equal(calmed.pulses, 0, 'but still nothing travels');
    // Ctrl+click opens at once in a new tab beside in the strip (t239, 12 Nov), not a split.
    await h.browser.send('Emulation.setEmulatedMedia', {});
    await openRoom(h, 'Graph');
    assert.ok(await waitFor(h, `window.__nvLivingGraph && window.__nvLivingGraph.snapshot().count > 0`), 'the graph opens for Ctrl+click');
    assert.ok(await waitFor(h, `window.__nvLivingGraph.snapshot().framed`, 90000), 'settles before Ctrl+click');
    const ct = await point(ALEX);
    const cxy = await at(ct, MAIN);
    const ctrlBefore = await titles();
    await tap(cxy.x, cxy.y, 1, 2);
    await sleep(400);
    const ctrlAfter = await titles();
    assert.equal(ctrlAfter.length, ctrlBefore.length + 1, `Ctrl+click opens at once (${ctrlAfter.join(' / ')})`);
    assert.ok((await actives()).some((t) => t.includes('Alex Chen')), `the new tab is Alex Chen (${ctrlAfter.join(' / ')})`);
    assert.equal(await groups(), 1, 'Ctrl+click opens a tab, not a split');
  } finally {
    await h.close().catch(() => {});
  }
});
