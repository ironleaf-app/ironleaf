// node --test tests/chips-contrast.test.mjs — p21-looks (5 Nov 2026): status in plain words
// (adapted 5 Nov 2026, the plan "Vault: status in plain words") plus the fills that stay.
// Plain words: "2 days late" in the attention colour, "Today" and "On track" muted, on the page
// and card grounds, read 4.5:1 in every look (14 palettes) and accent (19), light and dark.
// Fills that stay: fixed-coral chips (.pill.coral), the calendar's today number and ticked boxes
// sit on the raw colour with the on-fill ink (white or navy from the fill's own lightness) —
// the late pill's fill checks went with its fill (now plain words on the page, checked above).
// Two fills admit no white-or-navy ink at 4.5:1 (white needs a fill no lighter than 0.1833, navy
// no darker than 0.2238; light Pink is 0.2164 and dark Charcoal 0.1926, between the two): those
// were late-pill fills and went with it; the fills that stay all reach 4.5 (words) or 3:1 (ticks).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app's own lists (src/shared/prefs.ts), never retyped here.
const ACCENTS = [...readFileSync(path.join(root, 'src/shared/prefs.ts'), 'utf8')
  .matchAll(/\{ name: '([^']+)', value: '(#[0-9a-fA-F]{6})' \}/g)].map((m) => ({ name: m[1], value: m[2] }));
const PALETTES = [...readFileSync(path.join(root, 'src/shared/prefs.ts'), 'utf8')
  .match(/export const PALETTES[^=]*=\s*\[([\s\S]*?)\];/)[1]
  .matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' }); el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}
async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) { try { if (await h.browser.ev(js)) return true; } catch {} if (Date.now() - t0 > ms) return false; await sleep(250); }
}

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try { if (await H.browser.ev(`!!document.querySelector('.app')`)) break; } catch {}
    }
    await sleep(2200);
    // 5 Nov 2026, one counting query: the head pills count own late work, and the vault's two late tasks
    // name others — so one own late line is seeded (its note, rescanned, the page rebooted), or the late
    // words this test proves would have nothing to show for. Made-up, like every line in the test vault.
    await H.services.vault.createText('Daily/2026-11-05.md', `# 5 November 2026\n\n- [ ] Ring the supplier about the late flour delivery 📅 2026-11-04\n`).catch(() => {});
    await H.services.rescan('Daily/2026-11-05.md');
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
after(async () => { if (H) await H.close().catch(() => {}); H = null; });

function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const f = (u) => { u = Math.min(Math.max(u, 0), 1); return u > 0.0031308 ? 1.055 * u ** (1 / 2.4) - 0.055 : 12.92 * u; };
  return [f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), f(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const f = (u) => { u = Math.min(Math.max(u, 0), 1); return u > 0.0031308 ? 1.055 * u ** (1 / 2.4) - 0.055 : 12.92 * u; };
  return [f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), f(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
function parseA(c) {
  c = String(c).trim();
  // A powerless component serializes as `none` (6 Nov 2026: the Charcoal accent reads
  // oklch(0.371939 0.0166022 none) through the relative-colour accent tokens): CSS Color 4
  // treats it as 0 for conversion, so the parser does too — the thresholds below hold as ever.
  const num = (v) => (v === 'none' ? 0 : +v);
  let m = c.match(/^oklch\(\s*([\d.]+|none)\s+([\d.]+|none)\s+([\d.]+|none)/);
  if (m) return [...oklchToSrgb(num(m[1]), num(m[2]), num(m[3])), 1];
  m = c.match(/^oklab\(\s*([-\d.]+|none)\s+([-\d.]+|none)\s+([-\d.]+|none)/);
  if (m) return [...oklabToSrgb(num(m[1]), num(m[2]), num(m[3])), 1];
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (m) return [m[1] / 255, m[2] / 255, m[3] / 255, m[4] === undefined ? 1 : +m[4]];
  m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = c.match(/^#([0-9a-fA-F]{6})$/);
  if (m) return [...[0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255), 1];
  return null;
}
function extractInks(img) {
  const inks = [];
  const re = /(?:rgba?\([^)]*\)|color\(srgb[^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-fA-F]{6})/g;
  for (const m of String(img).matchAll(re)) {
    const c = parseA(m[0]);
    if (c && c[3] > 0.01) inks.push(c.slice(0, 3));
  }
  return inks;
}
const lum = ([r, g, b]) => {
  const f = (u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
// The attention fill (--coral in the kit): the former host app's coral, except beside Ironleaf's leaf accent (the
// default since the rename, 20 Nov 2026), where it is burnt orange, so Overdue never reads green.
const CORAL = [0xf2 / 255, 0x78 / 255, 0x5a / 255];
const LEAF_ATTENTION = { light: [0xb0 / 255, 0x4a / 255, 0x1e / 255], dark: [0xf0 / 255, 0x95 / 255, 0x6f / 255] };
const attentionFill = (theme, value) => (value === '#357553' ? LEAF_ATTENTION[theme] : CORAL);
const accentFill = (theme, value) => {
  const base = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  if (theme === 'dark' && value === '#357553') return [0x7c / 255, 0xc1 / 255, 0x97 / 255];
  return theme === 'dark' ? base.map((v) => 0.7 * v + 0.3) : base;
};

test('plain status words read on the page in every look and accent, light and dark; fills that stay read on their fill', async () => {
  assert.ok(ACCENTS.length >= 19, `the accent list loaded (${ACCENTS.length})`);
  assert.ok(PALETTES.length >= 14, `the look list loaded (${PALETTES.length})`);
  const h = await harness();
  if ((await clickWords(h, 'Tasks')) !== 'CLICKED') {
    await clickWords(h, 'More');
    await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
    assert.equal(await clickWords(h, 'Tasks', '.menu, [role="menu"]'), 'CLICKED', 'Tasks opens from More');
  }
  await sleep(1200);
  assert.equal(await clickWords(h, 'Everyone', 'main'), 'CLICKED', 'Everyone shows every task');
  await sleep(800);
  // The real late words show plain (the seeded own late line — the vault's fixed late dues name others,
  // and the one count reads own work).
  assert.ok(await h.browser.ev(`!!document.querySelector('main .pill.is-plain.is-attention')`), 'the late words show with late tasks about');
  const lateBg = await h.browser.ev(`getComputedStyle(document.querySelector('main .pill.is-plain.is-attention')).backgroundColor`);
  const lateParsed = parseA(lateBg);
  assert.ok(lateParsed && lateParsed[3] < 0.01, `late words carry no fill (${lateBg})`);
  // The same live cascade draws the probe: plain late, muted and on-track words plus the fills that stay.
  await h.browser.ev(`(() => {
    const d = document.createElement('div');
    d.id = 'chips-probe';
    d.style.cssText = 'position:fixed;left:0;top:0;z-index:1;';
    d.innerHTML = '<span class="pill is-plain is-attention">2 days late</span>'
      + '<span class="pill is-plain is-muted">Today</span>'
      + '<span class="plan-status-words is-muted">On track</span>'
      + '<span class="pill coral">due</span>'
      + '<span class="cal"><span class="d today"><span>5</span></span></span>'
      + '<input type="checkbox" class="cm-nv-checkbox" checked>'
      + '<span class="markdown"><input type="checkbox" class="task-checkbox" checked></span>';
    document.body.appendChild(d);
  })()`);
  const bad = [];
  // Plain words on the page and card grounds, every look and accent, both themes.
  for (const theme of ['light', 'dark']) {
    for (const palette of PALETTES) {
      for (const a of ACCENTS) {
        await h.browser.ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.dataset.palette = ${JSON.stringify(palette)}; document.documentElement.style.setProperty('--accent-base', ${JSON.stringify(a.value)}); /* as App.tsx: Ironleaf's leaf has its own dark twin */ if (${JSON.stringify(a.value)} === '#357553') { document.documentElement.style.setProperty('--accent-dark', '#7cc197'); document.documentElement.dataset.accent = 'leaf'; } else { document.documentElement.style.removeProperty('--accent-dark'); delete document.documentElement.dataset.accent; } })()`);
        await sleep(60);
        const m = await h.browser.ev(`(() => {
          const g = (s) => { const el = document.querySelector(s); const c = getComputedStyle(el); return { fg: c.color, bg: c.backgroundColor }; };
          const page = getComputedStyle(document.querySelector('main') || document.body).backgroundColor;
          const card = document.querySelector('main .card') ? getComputedStyle(document.querySelector('main .card')).backgroundColor : page;
          return { late: g('#chips-probe .pill.is-plain.is-attention'), muted: g('#chips-probe .pill.is-plain.is-muted'), track: g('#chips-probe .plan-status-words'), page, card };
        })()`);
        const tag = `${theme} ${palette} ${a.name}`;
        for (const [label, cell] of [['late words', m.late], ['today words', m.muted], ['on-track words', m.track]]) {
          for (const [ground, bg] of [['page', m.page], ['card', m.card]]) {
            const f = parseA(cell.fg), b = parseA(bg);
            assert.ok(f && b, `${label} colours parse (${cell.fg} on ${bg})`);
            const q = ratio(f.slice(0, 3), b.slice(0, 3));
            if (q < 4.5) bad.push(`${tag}: ${label} ${q.toFixed(2)}:1 on ${ground} (${cell.fg} on ${bg})`);
          }
        }
      }
    }
  }
  // Fills that stay, every accent, both themes (palette-independent: the fill is fixed, the ink from the fill).
  // Ticked boxes transition their fill over 120ms, so the sleep outlasts it (a mid-transition colour
  // interpolates in oklab and never matches the raw accent).
  for (const theme of ['light', 'dark']) {
    for (const a of ACCENTS) {
      await h.browser.ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.dataset.palette = 'bright'; document.documentElement.style.setProperty('--accent-base', ${JSON.stringify(a.value)}); /* as App.tsx: Ironleaf's leaf has its own dark twin */ if (${JSON.stringify(a.value)} === '#357553') { document.documentElement.style.setProperty('--accent-dark', '#7cc197'); document.documentElement.dataset.accent = 'leaf'; } else { document.documentElement.style.removeProperty('--accent-dark'); delete document.documentElement.dataset.accent; } })()`);
      await sleep(250);
      const m = await h.browser.ev(`(() => {
        const g = (s) => { const el = document.querySelector(s); const c = getComputedStyle(el); return { fg: c.color, bg: c.backgroundColor, img: c.backgroundImage, bo: c.borderColor }; };
        return { coral: g('#chips-probe .pill.coral'), cal: g('#chips-probe .cal .d.today span'), cm: g('#chips-probe .cm-nv-checkbox'), md: g('#chips-probe .task-checkbox') };
      })()`);
      const tag = `${theme} ${a.name}`;
      const want = accentFill(theme, a.value);
      const checkFill = (label, bg, expected) => {
        const b = parseA(bg);
        assert.ok(b, `${label} fill parses (${bg})`);
        if (!near(b.slice(0, 3), expected, 2 / 255)) bad.push(`${tag}: ${label} fill ${bg} is not the raw colour`);
      };
      checkFill('coral chip', m.coral.bg, attentionFill(theme, a.value));
      checkFill('calendar today number', m.cal.bg, attentionFill(theme, a.value));
      checkFill('editor ticked box', m.cm.bg, want);
      checkFill('reading ticked box', m.md.bg, want);
      checkFill('editor ticked box edge', m.cm.bo, want);
      checkFill('reading ticked box edge', m.md.bo, want);
      const checkText = (label, fg, bg, need) => {
        const f = parseA(fg), b = parseA(bg);
        assert.ok(f && b, `${label} colours parse (${fg} on ${bg})`);
        const q = ratio(f.slice(0, 3), b.slice(0, 3));
        if (q < need) bad.push(`${tag}: ${label} ${q.toFixed(2)}:1 (${fg} on ${bg})`);
      };
      checkText('coral chip words', m.coral.fg, m.coral.bg, 4.5);
      checkText('calendar today number', m.cal.fg, m.cal.bg, 4.5);
      for (const [label, cell] of [['editor ticked box', m.cm], ['reading ticked box', m.md]]) {
        const b = parseA(cell.bg);
        assert.ok(b, `${label} fill parses (${cell.bg})`);
        const inks = extractInks(cell.img);
        if (!inks.length) { bad.push(`${tag}: ${label} paints no tick ink (${String(cell.img).slice(0, 80)})`); continue; }
        if (!inks.every((k) => near(k, inks[0], 3 / 255))) { bad.push(`${tag}: ${label} tick mixes inks`); continue; }
        const q = ratio(inks[0], b.slice(0, 3));
        if (q < 3) bad.push(`${tag}: ${label} tick ${q.toFixed(2)}:1 on ${cell.bg}`);
      }
    }
  }
  await h.browser.ev(`document.querySelector('#chips-probe')?.remove()`);
  assert.deepEqual(bad, [], `unreadable words or fills:\n${bad.join('\n')}`);
});
