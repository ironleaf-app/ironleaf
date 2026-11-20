// node --test tests/today-note-cap.test.mjs — p17-today-note-cap (4 Nov 2026): Today's side column
// stays short. Today in your notes listed every changed file (22 rows in the picture); it caps at
// five with the page's existing More pattern (Show all N / Show fewer, class td-more), and so does
// every other list on Today that can run on without limit in views/today/* and the TodayView side
// column. Fails without each cap: source checks plus the live harness (the real renderer bundle
// against a real vault, tests/vault-controls-harness.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = to ? src.indexOf(to, a + from.length) : -1;
  return b < 0 ? src.slice(a) : src.slice(a, b);
};

// ── Today in your notes caps at five with the More pattern ───────────────────

test('DayActivity shows five with Show all, not ten with Show more', () => {
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  const act = section(parts, 'export function DayActivity', '}\n\nexport');
  assert.ok(act.includes('td-more'), 'the page’s More button, not a text button');
  assert.ok(act.includes('Show all') && act.includes('Show fewer'), 'Show all N / Show fewer');
  assert.ok(/slice\(0,\s*5\)/.test(act) || /SHOWN\s*=\s*5/.test(parts), 'about five, not ten');
  assert.ok(!act.includes('Show more ('), 'no Show more (N more listed)');
  assert.ok(!act.includes('setExpanded'), 'no growing expanded count');
  // The p15 rule stands: Made and Changed skip another card’s paths, Linked keeps all.
  assert.ok(act.includes('day.made.filter(keep)') && act.includes('day.changed.filter(keep)'), 'Made and Changed still skip them');
  assert.ok(act.includes('items: day.linked'), 'Linked still keeps everything');
});

// ── Every other unbounded list in views/today/* caps the same way ────────────

test('DaySaved caps at five with Show all', () => {
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  const saved = section(parts, 'export function DaySaved', 'export function DayActivity');
  assert.ok(saved.includes('td-more'), 'the More button');
  assert.ok(saved.includes('Show all') && saved.includes('Show fewer'), 'Show all N / Show fewer');
  assert.ok(/slice\(0,\s*5\)/.test(saved) || /SHOWN\s*=\s*5/.test(parts), 'about five');
});

test('the day’s meetings cap at five with Show all', () => {
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  const agenda = section(parts, 'export function DayAgenda', 'function NoteLine');
  assert.ok(agenda.includes('td-more'), 'the More button');
  assert.ok(agenda.includes('Show all') && agenda.includes('Show fewer'), 'Show all N / Show fewer');
  assert.ok(/slice\(0,\s*5\)/.test(agenda) || /SHOWN\s*=\s*5/.test(parts), 'about five');
});

test('Cards to review shows five with Show all, not six with Open the next deck', () => {
  const cards = read('src/renderer/src/views/today/CardsDue.tsx');
  assert.ok(cards.includes('td-more'), 'the More button');
  assert.ok(cards.includes('Show all') && cards.includes('Show fewer'), 'Show all N / Show fewer');
  assert.ok(/slice\(0,\s*5\)/.test(cards), 'about five');
  assert.ok(!cards.includes('slice(0, 6)'), 'not six');
  assert.ok(!cards.includes('Open the next deck'), 'the list itself opens, not one deck');
});

test('At a glance shows five, not eight', () => {
  const glance = read('src/renderer/src/views/today/Glance.tsx');
  assert.ok(/slice\(0,\s*5\)/.test(glance), 'about five');
  assert.ok(!glance.includes('slice(0, 8)'), 'not eight');
  assert.ok(glance.includes('td-more') && glance.includes('Show all'), 'still through Show all');
});

test('Projects waiting folds into one row opening the whole list, never a bare and N more', () => {
  const checks = read('src/renderer/src/views/today/ProjectChecksToday.tsx');
  // One row for all waiting projects (8 Nov 2026, calm list): the row itself is the fold, so no inner
  // Show all is needed — opening it lists every project with its Open.
  assert.ok(checks.includes('<LookRow'), 'one row through LookRow');
  assert.ok(checks.includes('projectsWaitingWords('), 'worded by the shared helper');
  assert.ok(!checks.includes('and {rows.length - SHOWN} more.'), 'no bare line with nowhere to go');
});

// ── The live page: five rows and Show all with long content ──────────────────

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
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
after(async () => {
  if (H) await H.close().catch(() => undefined);
  H = null;
});

async function waitFor(h, js, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    if (await h.browser.ev(js)) return;
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 120)}`);
    await sleep(300);
  }
}

async function clickWords(h, words) {
  const r = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}`);
}

test('Today in your notes shows five with Show all past twenty changed', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  // A day's worth of long notes, changed today (no created words, so Changed, not Made).
  for (let i = 1; i <= 14; i++) {
    const p = path.join(h.vaultDir, 'Notes', `Evening notes ${i} about the quarterly review.md`);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `# Evening notes ${i} about the quarterly review with the garden volunteers\n\nWords about the review written today, long enough to read like a real note.\n`);
  }
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  await waitFor(h, `!!document.querySelector('.app')`);
  await sleep(2500);
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(2500);
  // Today in your notes folds with Also now, shut by default.
  await h.browser.ev(`document.querySelector('[data-section="also"] .td-more')?.click()`);
  await sleep(1200);
  const total = await ev(`(async () => {
    const btn = [...document.querySelectorAll('.th-tabs .th-tab')].find((b) => (b.innerText || '').startsWith('Changed'));
    if (btn && !btn.disabled) { btn.click(); await new Promise((r) => setTimeout(r, 500)); }
    return [...document.querySelectorAll('.th-tabs .th-tab')].find((b) => (b.innerText || '').startsWith('Changed'))?.innerText ?? '';
  })()`);
  const n = Number((/Changed\s+(\d+)/.exec(total)?.[1] ?? '0'));
  assert.ok(n > 10, `past ten changed to prove the cap (saw ${JSON.stringify(total)})`);
  const rows = await ev(`document.querySelectorAll('[data-section="activity"] .th-act-list li').length`);
  assert.ok(rows <= 5, `five rows at most, not ${rows}`);
  const more = await ev(`document.querySelector('[data-section="activity"] .td-more')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(more, /Show all \d+/, `Show all with the count (saw ${JSON.stringify(more)})`);
  // Show all opens the rest in place.
  await ev(`document.querySelector('[data-section="activity"] .td-more').click()`);
  await sleep(600);
  const open = await ev(`document.querySelectorAll('[data-section="activity"] .th-act-list li').length`);
  assert.equal(open, n, 'every changed note a click away');
});
