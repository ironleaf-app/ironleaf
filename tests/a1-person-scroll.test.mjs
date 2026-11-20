// node --test tests/a1-person-scroll.test.mjs — a1 (6 Nov 2026): a person's page
// scrolls in the frame's scroller, as its siblings do. Before: PersonPage
// returned its .nv-page directly in .group-body (no .nv-page-scroll), so a long
// page (30 owed items plus Timeline, 3437 px in the heavy vault) overflowed the
// 1061 px pane with overflow visible and no scroller — the Timeline below the
// fold could not be reached. People, Notes and Meetings all bring
// .nv-page-scroll (p25 one column); the person joins them. Each check fails
// without the wrapper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the mechanism ────────────────────────────────────────────────────
test('the person stands in the frame scroller like its siblings', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(src.includes('nv-page-scroll'), 'PersonPage brings .nv-page-scroll');
  // Siblings for reference (p25): the wrapper, then the page box inside it.
  for (const f of ['src/renderer/src/views/PeoplePage.tsx', 'src/renderer/src/views/NotesPage.tsx']) {
    const sib = read(f);
    assert.ok(sib.includes('nv-page-scroll'), `${f} brings the scroller`);
  }
});

// ── Live: a long person page scrolls to its Timeline ─────────────────────────
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    // One person owed many things, so the page runs long.
    await H.services.vault.createText('People/Jo Long.md', `---\ntype: person\nrole: Harbour Lane shift lead\n---\n# Jo Long\n\nFriend.\n`).catch(() => {});
    for (let i = 0; i < 12; i++) {
      await H.services.vault.createText(`Meetings/2026-11-0${1 + (i % 8)} long ${i}.md`, `---\ntype: meeting\ndate: 2026-11-0${1 + (i % 8)}\nattendees: [Jo Long]\n---\n# 2026-11-0${1 + (i % 8)} long ${i}\n\n## Agenda\n\n- Peak\n\n## Actions\n\n- [ ] Do thing ${i} — Jo Long — due 2026-11-0${1 + (i % 8)}\n`).catch(() => {});
      await H.services.rescan(`Meetings/2026-11-0${1 + (i % 8)} long ${i}.md`);
    }
    await H.services.rescan('People/Jo Long.md');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try { if (await H.browser.ev(`!!document.querySelector('.app')`)) break; } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
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

test('a long person page reaches its Timeline through its tab; long tabs scroll (t255)', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  assert.equal(await clickWords(h, 'People', '.sidebar.left, aside'), 'CLICKED', 'People opens');
  await sleep(1200);
  const opened = await h.browser.ev(`(async () => {
    const rows = [...document.querySelectorAll('main .w2b-row, main .trow')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 12; });
    const jo = rows.find((e) => e.innerText.includes('Jo Long')) || rows[0];
    if (!jo) return 'NOROW';
    jo.click();
    await new Promise((r) => setTimeout(r, 1000));
    return 'CLICKED';
  })()`);
  assert.equal(opened, 'CLICKED', 'a person opens');
  await sleep(1200);
  const scroller = await h.browser.ev(`(() => {
    const s = document.querySelector('main .nv-page-scroll');
    if (!s) return null;
    return { scrollH: s.scrollHeight, clientH: s.clientHeight };
  })()`);
  assert.ok(scroller, 'the person brings its own scroller');
  // t255: the long page became tabs — the Timeline is reached through its tab, and a long tab
  // (the owed rows) still scrolls inside the frame scroller, as its siblings do.
  const order = await h.browser.ev(`[...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tab')).join(',')`);
  assert.equal(order, 'overview,promises,projects,timeline', 'Overview, Promises, Projects, Timeline');
  await h.browser.ev(`document.querySelector('[data-tab="timeline"]')?.click()`);
  await sleep(1000);
  const reached = await h.browser.ev(`(() => {
    const t = [...document.querySelectorAll('#pp-panel-timeline .w2b-section')].find((e) => e.innerText.includes('Timeline'));
    if (!t) return 'NOTIMELINE';
    const r = t.getBoundingClientRect();
    const rows = document.querySelectorAll('#pp-panel-timeline .w2b-card .trow').length;
    return (r.top >= -2 && r.top < window.innerHeight && rows > 0) ? 'VISIBLE' : ('OFF:' + Math.round(r.top) + ':rows=' + rows);
  })()`);
  assert.equal(reached, 'VISIBLE', `the Timeline tab opens on its rows (saw ${reached})`);
  // Twelve owed rows fit 1117 px; at 709 the tab runs past one screen and scrolls in the frame.
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await h.browser.ev(`document.querySelector('[data-tab="promises"]')?.click()`);
  await sleep(1000);
  const scrolled = await h.browser.ev(`(async () => {
    const s = document.querySelector('main .nv-page-scroll');
    if (!s) return 'NOSCROLLER';
    s.scrollTo({ top: 99999 });
    await new Promise((r) => setTimeout(r, 400));
    return s.scrollTop > 0 ? 'SCROLLS' : 'STUCK';
  })()`);
  assert.equal(scrolled, 'SCROLLS', 'a long tab scrolls in the frame scroller');
});
