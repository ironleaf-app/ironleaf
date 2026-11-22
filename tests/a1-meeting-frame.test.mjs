// node --test tests/a1-meeting-frame.test.mjs — a1 (6 Nov 2026): one meeting's
// page joins the rooms' one column and one title place (p25). Before: the title
// sat 28 px high (titleTop 64 vs the rooms' 92, an 8 px pad where the frame
// gives 36), its weight/tracking differed (600/-0.025em vs 650/-0.02em), and the
// body indented 54 px off the title (margin-left on :not(.w2b-title)) while
// every other room starts its body at the column edge. The box already joins
// (.nv-page.full.w2b-list, 1280 at 1920). The fix is a scoped rule at the end
// of the meetings sheet, touching no recorder/minutes code (m5/m2, m4 own
// those). Each check fails without it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the scoped mechanism ─────────────────────────────────────────────
test('the meeting title joins the frame pad and type, its body the column edge', () => {
  // The rule rides at the end of its sheet (scoped addition, not a rewrite).
  const candidates = ['src/renderer/src/styles/w2b.css', 'src/renderer/src/styles/people-meetings.css', 'src/renderer/src/styles/page-frame.css'];
  let found = '';
  for (const f of candidates) {
    const css = read(f);
    if (css.includes('.w2b-meeting') && (css.includes('--page-pad-top') || css.includes('padding-top: 36px') || css.includes('padding-top: var(--page-pad-top)'))) found = f;
  }
  assert.ok(found, 'a scoped .w2b-meeting rule joins the frame pad');
  const css = read(found);
  // The scoped override, wherever it sits (t264: the tail pin went stale when t254/t255 added rules
  // after it — pin the rule, not its place). The .nv-page scoping beats the bare 54px rule, and
  // source order breaks any tie, so later rules elsewhere in the sheet cannot move it.
  const base = css.indexOf('.w2b-meeting > :not(.w2b-title) { margin-left: 54px; }');
  const over = css.indexOf('.nv-page .w2b-meeting > :not(.w2b-title) { margin-left: 0; }');
  assert.ok(base >= 0 && over > base, 'the scoped override follows the bare 54px rule');
  const title = css.indexOf('.nv-page .w2b-meeting > .w2b-title {');
  assert.ok(title >= 0 && css.slice(title, title + 160).includes('margin-top: var(--page-pad-top)'), 'the title takes the frame pad');
  const type = css.indexOf('.nv-page .w2b-meeting > .w2b-title > h1.vtitle {');
  assert.ok(type >= 0 && css.slice(type, type + 200).includes('font-weight: 650') && css.slice(type, type + 200).includes('letter-spacing: -0.02em'), 'the title takes the frame type');
});

// ── Live: titleTop 92 and body edge join the rooms ───────────────────────────
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    await H.services.vault.createText('Meetings/2026-11-06 review.md', `---\ntype: meeting\ndate: 2026-11-06\nattendees: [Alex Chen]\n---\n# 2026-11-06 review\n\n## Agenda\n\n- Peak\n\n## Actions\n\n- [ ] Do thing — Alex Chen — due 2026-11-06\n`).catch(() => {});
    await H.services.rescan('Meetings/2026-11-06 review.md');
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

test('a meeting page titles where its rooms do, with its body at the edge', { timeout: 300000 }, async () => {
  const h = await harness();
  // 23 Nov 2026: with app panes (panes.css, 20 Nov 2026) the list rooms and the meeting page take the compact head,
  // so their titles sit at 80, not 92. The check still compares with the Notes room, so the meeting title joins
  // whatever place the rooms share; it caught the meeting title's own pad doubling the panes' pad (116).
  // t264: proven at the review size and 3456 wide (t254 pairs sections two across past 2400px —
  // the title still joins the frame pad, the body still starts at the column edge).
  for (const [W, Hg] of [[1920, 1117], [3456, 1408]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    // Rooms' titleTop and body edge for comparison (Notes joins p25).
    assert.equal(await clickWords(h, 'Notes', '.sidebar.left, aside'), 'CLICKED', `${W}: Notes opens`);
    await sleep(1200);
    const room = await h.browser.ev(`(() => {
      const h1 = document.querySelector('main h1');
      const head = h1?.closest('header,.w2a-head') || h1;
      let sib = head?.nextElementSibling;
      while (sib && sib.getBoundingClientRect().height < 2) sib = sib.nextElementSibling;
      return { top: Math.round(h1?.getBoundingClientRect().top ?? -1), bodyL: sib ? Math.round(sib.getBoundingClientRect().left) : null };
    })()`);
    const roomTop = room.top;
    assert.equal(await clickWords(h, 'Meetings', '.sidebar.left, aside'), 'CLICKED', `${W}: Meetings opens`);
    await sleep(1200);
    // A fixture's meeting moves to Past once its day has gone, so this reads the same on any date.
    await h.browser.ev(`(async () => {
      const hasRow = [...document.querySelectorAll('main .w2b-row, main .trow')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 12; });
      if (!hasRow) { [...document.querySelectorAll('main button, main [role=tab]')].find((e) => (e.innerText || '').trim() === 'Past')?.click(); await new Promise((r) => setTimeout(r, 1000)); }
    })()`);
    const opened = await h.browser.ev(`(async () => {
      const row = [...document.querySelectorAll('main .w2b-row, main .trow')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 12; });
      if (!row) return 'NOROW';
      row.click();
      await new Promise((r) => setTimeout(r, 1000));
      return 'CLICKED';
    })()`);
    assert.equal(opened, 'CLICKED', `${W}: a meeting opens`);
    await sleep(1200);
    const m = await h.browser.ev(`(() => {
      const h1 = document.querySelector('main h1');
      const hr = h1 ? h1.getBoundingClientRect() : null;
      const hs = h1 ? getComputedStyle(h1) : null;
      const box = h1?.closest('.nv-page,.vpage');
      const br = box ? box.getBoundingClientRect() : null;
      const pills = document.querySelector('main .w2b-meeting .metapills');
      const pr = pills ? pills.getBoundingClientRect() : null;
      return {
        titleTop: hr ? Math.round(hr.top) : null,
        font: hs ? [hs.fontSize, hs.lineHeight, hs.fontWeight].join(' ') : null,
        boxL: br ? Math.round(br.left) : null,
        pillsL: pr ? Math.round(pr.left) : null,
      };
    })()`);
    assert.ok(Math.abs((m.titleTop ?? -99) - roomTop) <= 1, `${W}: meeting title joins the rooms at ${roomTop} (saw ${m.titleTop})`);
    assert.ok(room.bodyL !== null && m.pillsL !== null && Math.abs(m.pillsL - room.bodyL) <= 1, `${W}: facts start at the rooms' body edge (${room.bodyL}, saw ${m.pillsL}; box ${m.boxL})`);
  }
});
