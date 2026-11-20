// node --test tests/today-line.test.mjs — p28-today-line (5 Nov 2026): Today's
// summary line under the greeting ("8 late for you · … · 5 at risk · 31 waiting
// on others", at 3456x1408). It wrapped too early —
// a 620px cap from the first Today, while the column is 1080 wide — and the wrap
// orphaned its separator: "· 31 waiting on others" started the next line. The
// line uses the column's width now, and every subtitle figures line (Today and
// the project workspace's, plan.ts subtitleFigures' pattern) breaks only after
// a separator: each figure keeps its separator trailing, glued with it in one
// unit that never breaks, so a separator never starts a line. Each check fails
// without its fix: source checks plus the live harness (the real renderer
// bundle against a real vault, tests/vault-controls-harness.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The line uses the column's width ───────────────────────────────────────────

// The 620px cap (today.css .td-line, from the first Today) wrapped the line
// while the column had room to spare; the column is 1080 wide.
test('no narrow cap on the figures line: it uses the column', () => {
  const css = read('src/renderer/src/styles/today.css');
  const block = /(^|\n)\.td-line\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(block, 'the .td-line rule is there');
  assert.ok(!/max-width/.test(block), `no max-width caps the line any more: ${block.slice(0, 160)}`);
  const frame = read('src/renderer/src/styles/page-frame.css');
  const over = /(^|\n)\.td-line\s*\{[^}]*\}/.exec(frame)?.[0] ?? '';
  assert.ok(!/max-width/.test(over), 'the frame settles no cap either');
});

// ── The mechanism, read by both figures lines ─────────────────────────────────

test('one shared rule: a figure unit never breaks, its separator trails', () => {
  // The mechanism lives once in the page frame (it settles every room's head):
  // Today and the project workspace read this same rule, their own sheets keep
  // only their spacing.
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(frame.includes('.td-line > .nv-fig') && frame.includes('.ph-figures > .nv-fig'), 'both figures lines read it');
  const rule = /\.td-line > \.nv-fig,\s*\.ph-figures > \.nv-fig\s*\{[^}]*\}/.exec(frame)?.[0] ?? '';
  assert.ok(rule, 'the one shared rule names both lines');
  assert.ok(/white-space:\s*nowrap/.test(rule), 'a figure with its separator never breaks');
});

test('Today renders trailing separators in figure units', () => {
  // 5 Nov 2026, one sentence says what the day is (Today reports five numbers before any work;
  // now it says one line): Today no longer renders figures, so no separators to trail or orphan.
  // The shared mechanism still settles the workspace figures line (next test); Today reads daySentence.
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('daySentence'), 'Today renders the one sentence');
  assert.ok(src.includes('td-sentence'), 'the sentence keeps the line’s width (no narrow cap)');
  assert.ok(!src.includes('subtitleFigures'), 'no figures line beside the sentence');
});

test('the workspace figures line reads the same mechanism', () => {
  const src = read('src/renderer/src/views/project/ProjectHub.tsx');
  assert.ok(src.includes('className="nv-fig"'), 'each figure rides in the shared unit');
  const figs = src.split('ph-figures')[1].split('</p>')[0];
  // No standalone separator between the figures: each trails inside its unit.
  assert.ok(!/<span aria-hidden="true">·<\/span>/.test(figs.replace(/<span className="ph-sep" aria-hidden="true">·<\/span>/g, '')), 'no bare separator stands between figures');
  assert.ok(figs.includes('ph-sep'), 'the trailing separator keeps its spacing');
  const css = read('src/renderer/src/styles/project-hub.css');
  const rule = /\.ph-figures\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(!/gap:\s*6px;/.test(rule), `no column gap doubles the separator's spacing: ${rule.slice(0, 140)}`);
  assert.ok(/\.ph-sep\s*\{[^}]*margin:\s*0 6px/.test(css), 'the separator keeps the 6px breathing room the gap gave');
});

// ── The live page: full width, one row, never a leading separator ─────────────

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    await waitFor(H, `!!document.querySelector('.app')`);
    await sleep(2500);
  }
  return H;
}
after(async () => {
  if (H) await H.close().catch(() => undefined);
  H = null;
});

async function waitFor(h, js, ms = 25000) {
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

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// The longest realistic figures: a big working vault (made-up shop jobs, owned
// by Alex Chen, others' by Priya Nair), dated from today so every run counts
// the same shape however old the checkout is.
let fat = false;
async function fatVault(h) {
  if (fat) return;
  fat = true;
  const late = [], today = [], week = [], wait = [];
  for (let i = 0; i < 46; i++) late.push(`- [ ] Late job ${i + 1} — Alex Chen · by ${day(-3 - (i % 9))}`);
  for (let i = 0; i < 17; i++) today.push(`- [ ] Today job ${i + 1} — Alex Chen · by ${day(0)}`);
  for (let i = 0; i < 60; i++) week.push(`- [ ] Week job ${i + 1} — Alex Chen · by ${day(1 + (i % 6))}`);
  for (let i = 0; i < 55; i++) wait.push(`- [ ] Their job ${i + 1} — Priya Nair · by ${day(-2 + (i % 7))}`);
  const proj = (name, owner, health, steps) => `---\ntype: project\nstatus: active\nhealth: ${health}\nowner: ${owner}\n---\n# ${name}\n\n## What’s next\n\n${steps.join('\n')}\n`;
  const w = (rel, text) => {
    const p = path.join(h.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  w('Projects/Big Shop/Big Shop.md', proj('Big Shop', 'Alex Chen', 'on track', [...late.slice(0, 23), ...today.slice(0, 9), ...week.slice(0, 30), ...wait.slice(0, 28)]));
  w('Projects/Second Shop/Second Shop.md', proj('Second Shop', 'Alex Chen', 'on track', [...late.slice(23), ...today.slice(9), ...week.slice(30), ...wait.slice(28)]));
  for (let i = 1; i <= 8; i++) w(`Projects/Risky ${i}/Risky ${i}.md`, proj(`Risky ${i}`, 'Alex Chen', 'at risk', [`- [ ] Risky job ${i} — Alex Chen · by ${day(2)}`]));
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  await waitFor(h, `!!document.querySelector('.app')`);
  await sleep(2500);
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(2500);
}

// The sentence as drawn: its text, its width against the head's, and its rows (5 Nov 2026,
// one sentence, not five figures: no separators to trail or orphan, one short line).
async function draw(h) {
  return h.browser.ev(`(() => {
    const line = document.querySelector('.td-view .td-line');
    const head = document.querySelector('.td-view .td-head');
    const range = document.createRange();
    range.selectNodeContents(line);
    return {
      text: (line.textContent || '').replace(/\\s+/g, ' ').trim(),
      maxWidth: getComputedStyle(line).maxWidth,
      lineW: line.getBoundingClientRect().width,
      headW: head.getBoundingClientRect().width,
      rows: range.getClientRects().length,
    };
  })()`);
}

test('at 3456, 1920 and 1219 the long line is one row at the head\u2019s width', async () => {
  const h = await harness();
  await fatVault(h);
  for (const [W, Hg] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);
    const m = await draw(h);
    // The fixture's shape in one sentence (the harness vault's own dated steps may join,
    // so floors, never exact counts): late and today named, a single full stop, no figures.
    const squashed = m.text.replace(/\s+/g, '');
    for (const [n, re] of [[46, /(\d+)late/], [17, /(\d+)duetoday/]]) {
      const got = Number((re.exec(squashed)?.[1] ?? '0'));
      assert.ok(got >= n, `at ${W}px: ${got} for ${re}, at least the fixture's ${n} (${m.text.slice(0, 100)})`);
    }
    assert.equal((m.text.match(/\./g) ?? []).length, 1, `at ${W}px: one sentence (${m.text.slice(0, 100)})`);
    assert.ok(!m.text.includes('·'), `at ${W}px: no separators in the sentence`);
    assert.equal(m.maxWidth, 'none', `at ${W}px: no cap in the live cascade`);
    assert.ok(Math.abs(m.lineW - m.headW) <= 1, `at ${W}px: the line uses the head's width (${m.lineW.toFixed(0)} of ${m.headW.toFixed(0)}px)`);
    assert.equal(m.rows, 1, `at ${W}px: one row`);
  }
});

test('where it truly must wrap, a separator never starts a line', async () => {
  // 5 Nov 2026: the sentence is one short line with no separators, so even narrow it holds
  // one row (or wraps mid-words, never after a separator, since there are none).
  const h = await harness();
  await fatVault(h);
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  const m = await draw(h);
  assert.ok(!m.text.includes('·'), 'no separators to start a line');
  assert.ok(m.rows <= 2, `at most two rows even narrow (${m.rows})`);
});
