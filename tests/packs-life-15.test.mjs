// node --test tests/packs-life-15.test.mjs — p15 packs-life (4 Nov 2026): Health, Family, Papers, House, Cars,
// Career and Trips read premium: one left edge off the title, week tiles and rows that read, empty states that say
// nothing gone, and every New dialog opening (the w3b overviews' New buttons were dead: no RecordFormHost). The
// static checks fail without each source change; the live checks boot the real renderer once against an empty vault.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('w3b pages mount the record form host, so every New button opens its dialog', () => {
  const shell = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(shell.includes("from '../RecordForm'"), 'PackPage imports the shared form host');
  const at = shell.indexOf('export function PackPage(');
  assert.ok(at > 0, 'PackPage exists');
  const body = shell.slice(at, shell.indexOf('/**', at + 1) === -1 ? undefined : shell.indexOf('/**', at + 1));
  assert.ok(body.includes('<RecordFormHost />'), 'PackPage mounts the host: House, Cars and Trips open their New dialogs');
});

test('the w3b body starts at the column edge', () => {
  // p25 one column supersedes the p15 50 px indent: the icon sits inside the column and the body starts at the
  // column edge with the tile, as every other page (the indent sat pack bodies right of every other room's).
  // t254 pairs sections two across on very wide windows through these same selectors: the rule is no indent,
  // not the selectors' absence (t265) — none of their blocks pushes the body in, and the live left-edge test
  // below proves the edge where a person sees it.
  const css = read('src/renderer/src/styles/w3b-packs.css');
  assert.ok(!css.includes('margin-left: 50px') && !css.includes('margin-left:50px'), 'no body sits 50 px in, off the title');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const sel of ['.w3b-page > section', '.w3b-page > .w3b-cols', '.w3b-page > .chips', '.w3b-page > .card', '.w3b-page > .nv-empty', '.w3b-page > .ask.float', '.w3b-page > p.vsub']) {
    const blocks = [...css.matchAll(new RegExp(`${esc(sel)}[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
    for (const b of blocks) assert.ok(!/margin-left|padding-left|text-indent/.test(b), `${sel} carries no indent of its own`);
  }
});

test('week blocks wrap whole words, never clipped with dots', () => {
  const css = read('src/renderer/src/styles/w3b-packs.css');
  const at = css.lastIndexOf('.w3b-page .w3b-evt');
  assert.ok(at > 0, 'the week-block rule is there');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  assert.doesNotMatch(body, /line-clamp/, 'no clamp, so no dots (t207 pass 2)');
  assert.match(body, /overflow-wrap:\s*break-word/, 'whole words first (mid-word only for unbreakable strings)');
});

test('row metas never wrap or squeeze the row’s name', () => {
  const css = read('src/renderer/src/styles/w3b-packs.css');
  const at = css.lastIndexOf('.w3b-page .trow .meta');
  assert.ok(at > 0, 'the row-meta rule is there');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  assert.match(body, /white-space:\s*nowrap/, 'a date never wraps to two lines');
  assert.match(body, /min-width:\s*0/, 'a long meta shrinks with its ellipsis instead of squeezing the name');
});

test('family rows read: names never cut, milestones two lines', () => {
  const src = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  assert.ok(src.includes("style={{ flex: 'none' }}>{m.name}</span>"), 'a person’s name keeps its width; the week words clip');
  assert.ok(src.includes('<span className="t clip-2">'), 'milestones read two lines');
});

test('the starter pack lists every job, never a …', () => {
  // Packs uplift item 8: the card plans first (the season's pack now, missing jobs only); it still names every
  // job it offers, never a slice with a ….
  const src = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.ok(!src.includes('slice(0, 3)'), 'no three-job slice');
  assert.ok(!src.includes("join(', ')}…"), 'no hard-coded …');
  assert.ok(src.includes('plan.jobs.map((j) => j.name.toLowerCase()).join'), 'every offered job is named');
});

test('papers and cars rows never hang a · before a tag', () => {
  // Finance's BillRow carries the same wart, but Finance is another pack: this job settles its own rows only.
  const papers = read('src/renderer/src/views/modules/RecordModulePage.tsx');
  const docRow = papers.slice(papers.indexOf('function DocRow('), papers.indexOf('function DocumentsMain('));
  assert.ok(docRow.includes('function DocRow('), 'DocRow exists');
  assert.ok(!docRow.includes('{meta} ·'), 'papers rows end their words before the tag');
  assert.ok(!read('src/renderer/src/views/modules/w3b/Vehicles87.tsx').includes('km · `'), 'cars rows end the odometer before the tag');
});

test('empty packs say no zero counts', () => {
  const family = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  assert.ok(family.includes('parts.length ? [{ k:') || family.includes('parts.length ? [{k:'), 'family’s facts go when every count is zero');
  const house = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.ok(house.includes("filter((x) => x !== '')") || house.includes('.filter(Boolean)'), 'house’s kept line drops its zero parts');
  const cars = read('src/renderer/src/views/modules/w3b/Vehicles87.tsx');
  assert.ok(cars.includes('m.vehicles.length ?'), 'cars’ kept line goes with no vehicles');
  const trips = read('src/renderer/src/views/modules/w3b/Travel87.tsx');
  assert.ok(trips.includes('m.trips.length ?'), 'trips’ forecast goes with no trips');
  const papers = read('src/renderer/src/views/modules/RecordModulePage.tsx');
  assert.ok(papers.includes('m.cvs.length ?'), 'papers’ kept line drops zero CV versions');
  const career = read('src/renderer/src/views/modules/personal/CareerPage.tsx');
  assert.ok(career.includes('m.upcoming.length ?') || career.includes('followUps.length ?'), 'career’s facts drop their zero parts');
  assert.ok(career.includes('Accepted ?? 0) ?') || career.includes('accepted ?'), 'the closed line drops zero accepted');
});

// ── Live: one boot, an empty vault, the packs on ────────────────────────────────────────────────────────────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { health: { on: true }, family: { on: true }, documents: { on: true }, house: { on: true }, vehicles: { on: true }, career: { on: true }, travel: { on: true } } } }]);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
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
async function openPack(h, name) {
  // t10 the quiet More (8 Nov 2026): packs left the side bar and More for Ctrl+K, each by its own name.
  const direct = await clickWords(h, name, '.sidebar.left, aside');
  if (direct === 'CLICKED') {
    await sleep(1500);
    return;
  }
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the palette opens from the top bar');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette input shows');
  }
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    // The pack's own row (a note kind may share its name: 'Goals' the kind sorts first).
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(name)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(name)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `the palette lists ${name}`);
  await sleep(1500);
}
async function waitFor(h, js, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

test('house’s New button opens its dialog', async () => {
  const h = await harness();
  await openPack(h, 'House');
  assert.equal(await clickWords(h, '+ Add an appliance', 'main'), 'CLICKED', 'the button is there');
  assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"]')`), 'its dialog opens');
  const title = await h.browser.ev(`document.querySelector('[role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3')?.innerText ?? ''`);
  assert.match(title, /New appliance/, 'it is the appliance form');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await sleep(400);
});

test('empty packs say no zero counts', async () => {
  const h = await harness();
  for (const [pack, banned] of [['Family', ['0 events', '0 people', '0 rewards']], ['House', ['0 appliances', '0 rooms', '0 manuals']], ['Cars', ['0 vehicles']], ['Trips', ['$0 spent']]]) {
    await openPack(h, pack);
    const text = await h.browser.ev(`document.querySelector('main')?.innerText ?? ''`);
    for (const words of banned) assert.ok(!text.includes(words), `${pack} never says “${words}”`);
  }
});

test('empty papers and career lead with their first step', async () => {
  const h = await harness();
  await openPack(h, 'Papers');
  assert.ok(await waitFor(h, `!![...document.querySelectorAll('main button')].find((b) => (b.innerText || '').includes('Add your first document'))`), 'papers offers its first document');
  await openPack(h, 'Career');
  assert.ok(await waitFor(h, `!![...document.querySelectorAll('main button')].find((b) => (b.innerText || '').includes('Add your first application'))`), 'career offers its first application');
});

test('a pack page keeps one left edge', async () => {
  // p25 one column supersedes the p15 words-edge rule: the icon sits inside the column and the lead, facts and
  // body start at the column edge with the tile (the words-edge rule sat pack bodies right of every other room's).
  const h = await harness();
  for (const pack of ['House', 'Papers']) {
    await openPack(h, pack);
    const xs = await h.browser.ev(`(() => {
      const page = 'main .w3b-page, main .p87';
      const root = document.querySelector(page);
      if (!root) return { none: -1 };
      const q = (sel) => { const el = root.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().x) : -1; };
      return { head: q('h1'), words: q('.nv-page-name'), lead: q('.nv-page-lead'), facts: q('.page-props'), body: q(':scope > section, :scope > .p87-body, :scope > .w3b-cols, :scope > .chips') };
    })()`);
    assert.ok(xs.head > 0 && xs.body > 0, `${pack}: the head and body render (${JSON.stringify(xs)})`);
    for (const k of ['lead', 'facts', 'body']) {
      if (xs[k] < 0) continue;
      assert.equal(xs[k], xs.head, `${pack}: ${k} starts at the column edge with the tile`);
    }
    assert.ok(xs.words > xs.head, `${pack}: the title's words start past its tile, inside the column`);
  }
});
