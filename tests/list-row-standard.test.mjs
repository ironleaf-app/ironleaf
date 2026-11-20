// node --test tests/list-row-standard.test.mjs — one list row, one count, one info chip (t218, 11 Nov 2026).
// The Vault half of the one product's one standard (the former host app half is
// ns/tests/list-row-standard.mjs): row title 15px/500/21px, sub 13px/400/18px muted, right-side time
// 13px/500 tabular, status plain words in the status inks, 12px of row above and below, one 1px divider, the
// hover wash; dense secondary lists wear the one named compact variant (.trow.compact: 13px/600/18px, 8px);
// counts are plain tabular words (13px/500 muted, 650 attention when late); info chips share one shape
// (22px, 12px/600, tabular). The standard lives once in the kit (styles/kit.css .trow); plan.css and
// today.css read the same tokens. Static tests pin every rule (each fails without its move); live tests
// measure one boot at 3456x1408, 1920x1117 and 1219x709 with long real content (Tasks, Today, a project
// page, Meetings) and picture each. NS_TEST_SHOTS=<dir> chooses the folder (default ../shots).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rule = (css, start) => {
  const at = css.indexOf(start);
  assert.ok(at >= 0, `${start} exists`);
  return css.slice(at, css.indexOf('}', at));
};

// ── Static: the kit carries the standard, every list reads it ───────────────

test('the kit carries the one row: 15px/500/21px title, 12px rhythm, hover, divider', () => {
  const css = read('src/renderer/src/styles/kit.css');
  const trow = rule(css, '.trow {');
  assert.ok(trow.includes('padding: 12px 0'), `row rhythm 12px up and down (${trow.slice(0, 120)})`);
  const t = rule(css, '.trow .t {');
  assert.ok(t.includes('font-size: var(--fs-body)') && t.includes('font-weight: 500') && t.includes('line-height: 21px'), `title 15px/500/21px (${t})`);
  const meta = rule(css, '.trow .meta {');
  assert.ok(meta.includes('font-size: var(--fs-small)') && meta.includes('color: var(--text-muted)'), `sub 13px muted (${meta})`);
  assert.ok(css.includes('.trow + .trow { border-top: 1px solid var(--border); }'), 'one 1px divider between rows');
  const hover = rule(css, '.trow:hover {');
  assert.ok(hover.includes('background: var(--sel)'), `rows wash on hover, the premium layer's own wash (${hover})`);
  assert.ok(!/:has\(/.test(trow + t + hover) && !/!important/.test(trow + t + hover), 'no :has(), no new !important');
});

test('the one named compact variant lives in the kit', () => {
  const css = read('src/renderer/src/styles/kit.css');
  const c = rule(css, '.trow.compact {');
  assert.ok(c.includes('padding: 8px 0'), `compact rhythm 8px (${c.slice(0, 120)})`);
  const t = rule(css, '.trow.compact .t {');
  assert.ok(t.includes('font-size: var(--fs-small)') && t.includes('font-weight: 600') && t.includes('line-height: 18px'), `compact words 13px/600/18px (${t})`);
});

test('task rows read the kit: sub, when, section counts', () => {
  const css = read('src/renderer/src/styles/plan.css');
  const sub = rule(css, '.tkrow-sub {');
  assert.ok(sub.includes('font-size: var(--fs-small)') && sub.includes('color: var(--text-muted)') && sub.includes('line-height: 18px'), `task sub 13px muted (${sub})`);
  const when = rule(css, '.tkrow-when { font-size');
  assert.ok(when.includes('font-size: var(--fs-small)') && when.includes('font-weight: 500') && when.includes('tabular-nums'), `task time 13px/500 tabular (${when})`);
  assert.ok(rule(css, '.tksec .n {').includes('color: var(--text-muted)'), 'section counts muted, as every count');
  const words = rule(css, '.plan-status-words {');
  assert.ok(words.includes('font-size: var(--fs-small)') && words.includes('font-weight: 600'), `status words 13px/600 (${words})`);
});

test('one count style: plain 13px/500 tabular words, fills gone', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  for (const [label, sel] of [['side bar counts', '.srow .n {'], ['tab counts', '.tab .c {'], ['filter counts', '.chip .n {']]) {
    const r = rule(kit, sel);
    assert.ok(r.includes('font-size: var(--fs-small)') && r.includes('font-weight: 500') && r.includes('tabular-nums'), `${label} read the one count (${r})`);
    assert.ok(!/var\(--fs-md\)|var\(--fs-caption\)/.test(r), `${label} keep no 14px or 12px step`);
  }
  const today = read('src/renderer/src/styles/today.css');
  const count = rule(today, '.td-count {');
  assert.ok(count.includes('font-size: var(--fs-small)') && count.includes('font-weight: 500') && count.includes('tabular-nums') && count.includes('color: var(--text-muted)'), `head counts read the one count (${count})`);
  assert.ok(!/background|min-width|border-radius|padding/.test(count), 'head counts are plain words, never a filled box');
});

test("Today's rows read the kit's rhythm and sub, with no premium override", () => {
  const today = read('src/renderer/src/styles/today.css');
  assert.ok(rule(today, '.td-row {').includes('padding: 12px 10px'), 'row rhythm 12px up and down, card sides 10px');
  const sub = rule(today, '.td-row-sub {');
  assert.ok(sub.includes('font-size: var(--fs-small)') && sub.includes('line-height: 18px') && sub.includes('color: var(--text-muted)'), `sub 13px/18px muted (${sub.slice(0, 120)})`);
  assert.ok(sub.includes('white-space: normal') && sub.includes('flex-wrap: wrap'), 'the sub row wraps whole words (t249: two lines fine, never cut mid-word)');
  const pl = read('src/renderer/src/styles/premium-layer.css');
  assert.ok(!/td-section :is\(\.td-row\) \{[^}]*padding/.test(pl), 'no premium padding override left on Today rows');
});

test('one info chip: 22px, 12px/600, tabular', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const tag = rule(kit, '.tag {');
  assert.ok(tag.includes('height: 22px') && tag.includes('padding: 0 8px') && tag.includes('font-size: var(--fs-caption)') && tag.includes('font-weight: 600') && tag.includes('tabular-nums'), `the tag is the one chip (${tag})`);
  const today = read('src/renderer/src/styles/today.css');
  const chip = rule(today, '.td-time-chip {');
  assert.ok(chip.includes('height: 22px') && chip.includes('padding: 0 8px') && chip.includes('border-radius: var(--r-1)') && chip.includes('font-size: var(--fs-caption)') && chip.includes('font-weight: 600'), `time chips match it (${chip})`);
});

test("the project page's dense rows wear compact, sized by the kit never inline", () => {
  const tsx = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tsx.includes('className="trow compact"'), 'dense tab rows wear the named compact variant');
  const inline14 = tsx.split('\n').filter((l) => l.includes('fontSize: 14') && (l.includes('className="t"') || l.includes("className='t'")));
  assert.equal(inline14.length, 0, `no row title sizes itself inline (stood ${inline14.length}: ${inline14[0]?.trim()})`);
});

test("a meeting's due reads plain words, never a filled tag", () => {
  const tsx = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(!/className=\{`tag \$\{/.test(tsx), 'no filled red-or-slate due tag left');
  // t248: the note is the meeting — the keep/filing card with its due tags is gone; dues read in the
  // note's Tasks rows through the shared plain when.
  const note = read('src/renderer/src/views/MeetingActions.tsx');
  assert.ok(note.includes('<WhenInner words={whenWords}'), 'dues read through the shared plain when');
});

// ── Live: one boot, long content, measured and pictured ─────────────────────
const SHOTS = process.env.NS_TEST_SHOTS || path.join(root, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });
const SIZES = [[3456, 1408], [1920, 1117], [1219, 709]];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LONG = [
  'Chase the two carts that failed on Friday morning before the refund window shuts at noon',
  'Retry the failed card payment twice with the new backoff before showing the error screen',
  'Send the receipt version two design past Priya for review before the Friday release cut',
  'Ring ShadeCo about the awning quote before it lapses on Friday afternoon at five',
  'Cost the new sausage roll line with the updated flour figures before payroll closes',
  'Confirm the Saturday market stall power with the showground office before Thursday noon',
];
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const yest = iso(new Date(Date.now() - 864e5));
    const tmr = iso(new Date(Date.now() + 864e5));
    const next = iso(new Date());
    w('Projects/T218 List Standard/T218 List Standard.md', `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\ndue: ${tmr}\n---\n# T218 List Standard\n\n## Summary\n\nProving one row style with long real content.\n\n## What's next\n\n- [ ] ${LONG[0]} — Alex Chen — due ${yest}\n- [ ] ${LONG[1]} — Priya Nair — due ${tmr}\n- [ ] ${LONG[2]} — Alex Chen — due ${tmr}\n\n## Risks\n\n| Risk | Level | Owner |\n|---|---|---|\n| ${LONG[3]} | High | Alex Chen |\n| ${LONG[4]} | Medium | Priya Nair |\n\n## Decisions\n\n- [x] 2026-11-01 ${LONG[5]}\n\n## People\n\n- Alex Chen (owner)\n- Priya Nair\n- June Park\n`);
    w(`Meetings/${next} T218 bakery planning with the long agenda.md`, `---\ntype: meeting\ndate: ${next}\ntime: 10:00\nattendees: [Alex Chen, Priya Nair]\nproject: Projects/T218 List Standard/T218 List Standard.md\n---\n# ${next} T218 bakery planning with the long agenda\n\n## Agenda\n\n- ${LONG[0]}\n- ${LONG[1]}\n- ${LONG[2]}\n\n## Actions\n\n- [ ] ${LONG[3]} — Priya Nair — due ${yest}\n- [ ] ${LONG[4]} — Alex Chen — due ${tmr}\n`);
    w('Me/T218 loose note with long dated tasks.md', `# T218 loose note with long dated tasks\n\n- [ ] ${LONG[5]} — June Park — due ${tmr}\n- [ ] ${LONG[0]} — Alex Chen — due ${yest}\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
  }
  return H;
}
before(async () => { await harness(); }, { timeout: 600000 });
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
async function openRoom(h, name) {
  assert.equal(await clickWords(h, name, '.sidebar.left, aside'), 'CLICKED', `${name} opens`);
  await sleep(1200);
}
async function shoot(h, name) {
  for (const [W, Hg] of SIZES) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
    if (d.result?.data) writeFileSync(path.join(SHOTS, `vault-${name}-${W}.png`), Buffer.from(d.result.data, 'base64'));
  }
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
}
/** Every row's title, sub, when, rhythm and dividers — one shape per surface. */
const ROWS_JS = (rowsSel, titleSel, subSel, whenSel) => `( () => [...document.querySelectorAll(${JSON.stringify(rowsSel)})].map((row) => {
  const r = row.getBoundingClientRect(), cs = getComputedStyle(row);
  const g = (sel) => {
    if (!sel) return 'absent';
    const el = row.querySelector(sel);
    if (!el) return 'missing';
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return 'hidden';
    const s = getComputedStyle(el);
    return { weight: s.fontWeight, size: s.fontSize, lh: s.lineHeight, align: s.textAlign, tabular: s.fontVariantNumeric, lines: Math.max(1, Math.round(b.height / parseFloat(s.lineHeight))) };
  };
  const prev = row.previousElementSibling;
  return { cls: row.className, h: r.height, padT: cs.paddingTop, padB: cs.paddingBottom, borderTop: cs.borderTopWidth, borderBottom: cs.borderBottomWidth, prevRow: !!prev && (prev.classList.contains('td-row') || prev.classList.contains('trow')), title: g(${JSON.stringify(titleSel)}), sub: g(${JSON.stringify(subSel)}), when: g(${JSON.stringify(whenSel)}) };
}).filter((x) => x.title && typeof x.title === 'object'))()`;
function assertOne(rows, pick, want, where) {
  const have = rows.map(pick).filter((v) => v && v !== 'missing' && v !== 'hidden' && v !== 'absent');
  assert.ok(have.length >= 1, `${where}: something stands to judge`);
  const shapes = new Set(have.map((v) => JSON.stringify(v)));
  assert.equal(shapes.size, 1, `${where}: one shape (stood ${[...shapes].join(' vs ')})`);
  assert.equal(JSON.stringify(have[0]), JSON.stringify(want), `${where}: the standard (stood ${JSON.stringify(have[0])})`);
}
function assertHeights(rows, where) {
  const groups = new Map();
  for (const x of rows) {
    const key = `${x.title.lines}/${typeof x.sub === 'object' ? x.sub.lines : 'n'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x.h);
  }
  for (const [key, hs] of groups) {
    if (hs.length < 2) continue;
    const span = Math.max(...hs) - Math.min(...hs);
    assert.ok(span <= 2, `${where}: same-shape rows agree within 2px (shape ${key} spans ${span.toFixed(1)}px)`);
  }
}
function assertDividers(rows, where) {
  if (rows.length < 2) return;
  assert.ok(!rows.some((x) => x.borderTop === '1px' && x.borderBottom === '1px'), `${where}: never a double divider`);
  for (const x of rows) assert.equal(x.borderTop, x.prevRow ? '1px' : '0px', `${where}: a divider above every row but a run's first (${x.cls})`);
}
async function assertHoverWash(h, rowSel, where) {
  const before = await h.browser.ev(`(() => { const d = document.createElement('div'); d.style.background = 'var(--sel)'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
  const at = await h.browser.ev(`(() => { const row = document.querySelector(${JSON.stringify(rowSel)}); if (!row) return null; const r = row.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  assert.ok(at, `${where}: a row stands to hover`);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await sleep(300);
  const bg = await h.browser.ev(`(() => getComputedStyle(document.querySelector(${JSON.stringify(rowSel)})).backgroundColor)()`);
  assert.equal(bg, before, `${where}: the row washes on hover (stood ${bg}, wanted ${before})`);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
}

/** Measure, then picture even when the measure fails, so one run judges and shows. */
async function measured(h, name, fn) {
  try {
    await fn();
  } finally {
    await shoot(h, name);
  }
}

test('Tasks: the standard row, head counts and the one rhythm', { timeout: 600000 }, async () => {
  const h = await harness();
  await measured(h, 'tasks', async () => {
  await openRoom(h, 'Tasks');
  assert.equal(await clickWords(h, 'Everyone', 'main'), 'CLICKED', 'every owner shows');
  await sleep(800);
  const rows = await h.browser.ev(ROWS_JS('main .trow.tkrow', '.tkrow-title', '.tkrow-sub', '.tkrow-when'));
  assert.ok(rows.length >= 3, `long task rows stand to judge (${rows.length})`);
  assertOne(rows, (x) => `${x.title.weight}/${x.title.size}/${x.title.lh}`, '500/15px/21px', 'Tasks title');
  assertOne(rows, (x) => (typeof x.sub === 'object' ? `${x.sub.weight}/${x.sub.size}/${x.sub.lh}` : x.sub), '400/13px/18px', 'Tasks sub');
  assertOne(rows, (x) => (typeof x.when === 'object' ? `${x.when.weight}/${x.when.size}/${x.when.tabular}` : x.when), '500/13px/tabular-nums', 'Tasks time');
  assertOne(rows, (x) => `${x.padT}/${x.padB}`, '12px/12px', 'Tasks rhythm');
  assertDividers(rows, 'Tasks');
  assertHeights(rows, 'Tasks');
  await assertHoverWash(h, 'main .trow.tkrow', 'Tasks');
  const counts = await h.browser.ev(`[...document.querySelectorAll('main .pill.is-plain')].map((el) => { const s = getComputedStyle(el); return s.fontWeight + '/' + s.fontSize + '/' + s.fontVariantNumeric; })`);
  assert.ok(counts.length >= 1, 'head counts stand to judge');
  for (const c of counts) assert.match(c, /^500\/13px|650\/13px/, `head counts read the one count (${c})`);
  });
});

test('Today: Next for you reads as Tasks, counts plain, time chips one chip', { timeout: 600000 }, async () => {
  const h = await harness();
  await measured(h, 'today', async () => {
  await openRoom(h, 'Today');
  const rows = await h.browser.ev(ROWS_JS('.td-next .td-row.tkrow', '.td-row-what', '.td-row-sub', '.tkrow-when'));
  assert.ok(rows.length >= 2, `Next for you rows stand to judge (${rows.length})`);
  assertOne(rows, (x) => `${x.title.weight}/${x.title.size}/${x.title.lh}`, '500/15px/21px', 'Next for you title');
  assertOne(rows, (x) => `${x.padT}/${x.padB}`, '12px/12px', 'Next for you rhythm');
  assertDividers(rows, 'Next for you');
  assertHeights(rows, 'Next for you');
  const counts = await h.browser.ev(`[...document.querySelectorAll('main .td-count')].map((el) => { const s = getComputedStyle(el); return s.fontWeight + '/' + s.fontSize + '/' + s.fontVariantNumeric + '/' + s.backgroundColor; })`);
  assert.ok(counts.length >= 1, 'section counts stand to judge');
  for (const c of counts) assert.equal(c, '500/13px/tabular-nums/rgba(0, 0, 0, 0)', `section counts read the plain count (${c})`);
  const chips = await h.browser.ev(`[...document.querySelectorAll('main .td-time-chip')].map((el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return Math.round(b.height) + '/' + s.paddingLeft + '/' + s.fontWeight + '/' + s.fontSize + '/' + s.borderRadius; })`);
  for (const c of chips) assert.equal(c, '22/8px/600/12px/4px', `time chips read the one chip (${c})`);
  });
});

test("the project page: task rows standard, dense tab rows compact, figures plain", { timeout: 600000 }, async () => {
  const h = await harness();
  await measured(h, 'project', async () => {
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, 'T218 List Standard', 'main'), 'CLICKED', 'the project opens');
  await sleep(1500);
  // t255: the section bar became real tabs — the rows stand to judge in their tabs.
  await h.browser.ev(`document.querySelector('[data-tab="whats-next"]')?.click()`);
  await sleep(1200);
  const rows = await h.browser.ev(ROWS_JS('main .trow.tkrow', '.tkrow-title', '.tkrow-sub', '.tkrow-when'));
  assert.ok(rows.length >= 2, `project task rows stand to judge (${rows.length})`);
  assertOne(rows, (x) => `${x.title.weight}/${x.title.size}/${x.title.lh}`, '500/15px/21px', 'project task title');
  assertOne(rows, (x) => `${x.padT}/${x.padB}`, '12px/12px', 'project task rhythm');
  await h.browser.ev(`document.querySelector('[data-tab="risks"]')?.click()`);
  await sleep(1200);
  const dense = await h.browser.ev(ROWS_JS('main .trow.compact', '.t', null, null));
  assert.ok(dense.length >= 2, `compact tab rows stand to judge (${dense.length})`);
  assertOne(dense, (x) => `${x.title.weight}/${x.title.size}/${x.title.lh}`, '600/13px/18px', 'compact words');
  assertOne(dense, (x) => `${x.padT}/${x.padB}`, '8px/8px', 'compact rhythm');
  const figs = await h.browser.ev(`[...document.querySelectorAll('main .ph-figures .ph-figure, main .ph-figures span')].slice(0, 4).map((el) => { const s = getComputedStyle(el); return s.fontSize + '/' + s.backgroundColor; })`);
  for (const f of figs) assert.match(f, /^13px\/rgba\(0, 0, 0, 0\)/, `figures read plain 13px words (${f})`);
  });
});

test('Meetings: agenda info in the one chip, dues plain (the coming count reads on Today)', { timeout: 600000 }, async () => {
  const h = await harness();
  await measured(h, 'meetings', async () => {
  await openRoom(h, 'Meetings');
  const tagJS = `[...document.querySelectorAll('main .tag.slate.w2b-tag')].map((el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return Math.round(b.height) + '/' + s.paddingLeft + '/' + s.fontWeight + '/' + s.fontSize + '/' + s.fontVariantNumeric; })`;
  const roomTags = await h.browser.ev(tagJS);
  assert.equal(await clickWords(h, 'T218 bakery planning', 'main'), 'CLICKED', 'the meeting opens');
  await sleep(1500);
  const tags = [...roomTags, ...(await h.browser.ev(tagJS))];
  assert.ok(tags.length >= 1, 'the agenda info stands to judge');
  for (const t of tags) assert.equal(t, '22/8px/600/12px/tabular-nums', `agenda info reads the one chip (${t})`);
  const dues = await h.browser.ev(`[...document.querySelectorAll('main .tag.is-plain')].map((el) => { const s = getComputedStyle(el); return s.fontSize + '/' + s.backgroundColor; })`);
  for (const d of dues) assert.equal(d, '12px/rgba(0, 0, 0, 0)', `dues read plain (${d})`);
  });
});
