// node --test tests/vault-controls.test.mjs — p10 (4 Nov 2026): every control in
// Ironleaf does what it says. The live harness (tests/vault-controls-harness.mjs)
// boots the real renderer bundle in headless Chromium against a real test vault
// served by the real main-side data layer. Each view test renders the view, finds
// every interactive element, activates it, and asserts something happened that
// matches its words. Out of scope (other jobs, named in the plan): the
// header search palette (p7), the floating ask bar (p9) — both excluded below.
// Fails first on the dead workstream Edit (the editor never answered a reveal for
// an already-open note). NV_CONTROLS_OUT=path writes the controls list rows.
// Run one room per process (NV_CONTROLS_SWEEP=1 node --test --test-name-pattern="<room>" with its own
// NV_CONTROLS_OUT): one file run takes far too long (k3, 5 Nov 2026: Home alone took 23 minutes).
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
// The full sweep clicks every control on every view (10+ minutes): it runs when asked (NV_CONTROLS_SWEEP=1), so the
// whole suite stays quick; the harness boot and the Edit regression always run.
const SWEEP = { skip: process.env.NV_CONTROLS_SWEEP === '1' ? false : 'full sweep: set NV_CONTROLS_SWEEP=1' };
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.NV_CONTROLS_OUT || '';
const ROWS = [];

// Never touched: p7's header search + palette, p9's floating bar + answer card.
const EXCLUDE = '.sas-askbar, .sas-askfloat, .top-search';
const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';
// A control key embedded in page JS: JSON-quoted (words may hold quotes).
const Q = (key) => `[data-harness-id=${JSON.stringify(key)}]`;
// The same selector as a JS string literal for document.querySelector(...):
// JSON.stringify it (p11: a label holding an apostrophe broke the old
// single-quoted embedding with `missing ) after argument list`).
const QE = (key) => JSON.stringify(Q(key));

const ENUM_JS = (scope) => `(() => {
  // Stale keys haunt: a node skipped this round keeps its old data-harness-id, which can collide with a fresh
  // key and steer the probe at the wrong node (p16-folio: the Workstreams re-probe hit a twin). Clear first.
  document.querySelectorAll('[data-harness-id]').forEach((e) => e.removeAttribute('data-harness-id'));
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // Rendered but unreachable: content-visibility-skipped, transparent, or shut inside a closed <details> (a person
  // cannot click it, and scrollIntoView cannot reach it — closed-details children keep layout rects that lie). A
  // closed details' own summary stays: it is the opener, and without it the sweep could never look inside.
  const hidden = (el) => { try { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true; } catch {} return el.tagName !== 'SUMMARY' && !!el.closest('details:not([open])'); };
  const words = (el) => ((el.innerText || el.getAttribute('aria-label') || el.title || el.getAttribute('placeholder') || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 70));
  const roots = ${JSON.stringify(scope)} ? [...document.querySelectorAll(${JSON.stringify(scope)})] : [document];
  const out = [];
  const seen = new Map();
  const seenEl = new Set();
  for (const root of roots) {
    for (const el of root.querySelectorAll(${JSON.stringify(SEL)})) {
      if (seenEl.has(el)) continue;
      seenEl.add(el);
      if (!vis(el)) continue;
      if (hidden(el)) continue;
      if (el.closest(${JSON.stringify(EXCLUDE)})) continue;
      if (el.closest('.peek.is-entering')) continue;
      // The editor's own text (typed into, not clicked as a control).
      if (el.closest('.cm-content')) continue;
      const w = words(el);
      const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.');
      // Stable identity across re-renders: trailing clock times ("1:29 pm") and counts
      // ("Changed 9") change as the sweep itself touches the vault; without this the
      // same control is "fresh" forever and the sweep grinds to its round cap.
      const nw = w.replace(/\s+\d{1,2}:\d{2}\s*(am|pm)?$/i, '').replace(/\s+\d+$/, '');
      const base = [el.tagName.toLowerCase(), el.getAttribute('role') || '', nw, cls].join('~');
      const n = (seen.get(base) ?? -1) + 1;
      seen.set(base, n);
      const key = base + '#' + n;
      el.setAttribute('data-harness-id', key);
      const vv = el.value !== undefined ? String(el.value) : null;
      out.push({ key, base, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.type || '', words: w, cls, disabled: !!el.disabled, checked: el.getAttribute('aria-checked') ?? (el.checked !== undefined && /checkbox|radio/.test(el.type || '') ? String(el.checked) : null), value: vv === null ? null : vv.length + ':' + vv.slice(-24), sel: el.getAttribute('aria-selected') ?? el.getAttribute('aria-current') ?? ((typeof el.className === 'string' && /(^|\\s)(on|active|selected|is-on)(\\s|$)/.test(el.className)) ? 'on' : null), pressed: el.getAttribute('aria-pressed'), label: el.getAttribute('aria-label') });
    }
  }
  return out;
})()`;

// Every dialog-class overlay the sweep treats as a dialog (k3, 5 Nov 2026: .slides joined — Present-as-slides'
// fullscreen overlay carries no dialog class, so the sweep ploughed on underneath it and flaked 'covered' on the
// Note's View submenu. Every other modal kind carries role="dialog". A click on slides advances it, never closes
// it, so dismiss() must only Escape it, never backdrop-click it.)
const DIALOG_SEL = '.modal-backdrop, .modal, [role="dialog"], .slides';
const SNAP_JS = `(() => {
  const hash = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
  const mainText = document.querySelector('main')?.innerText ?? '';
  const overlayText = [...document.querySelectorAll('.menu, [role="menu"], .overlay, ${DIALOG_SEL}')].map((e) => e.innerText ?? '').join('\\n');
  // innerText can't see what inputs hold (their values) or their order: hash those too.
  const forms = [...document.querySelectorAll('input, select, textarea')].map((el) => el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '0') : String(el.value ?? '')).join('\\n');
  const formsHash = forms.length + ':' + hash(forms);
  return {
  tab: document.querySelector('[role="tab"][aria-selected="true"]')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  head: document.querySelector('main h1, .main h1')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  mainLen: mainText.length,
  mainHash: hash(mainText),
  overlay: overlayText.length + ':' + hash(overlayText),
  forms: formsHash,
  peek: !!document.querySelector('.peek'),
  peekTitle: document.querySelector('.peek-title')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  modal: !!document.querySelector('${DIALOG_SEL}'),
  modalTitle: document.querySelector('.modal h1, .modal h2, [role="dialog"] h1, [role="dialog"] h2, .slides h1, .slides h2')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  menu: !!document.querySelector('.menu, [role="menu"]'),
  toast: document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ').slice(0, 100) ?? null,
  editor: !!document.querySelector('.cm-editor'),
  mode: document.querySelector('.note-view')?.className.match(/mode-\\w+/)?.[0] ?? null,
  scroll: [document.querySelector('.cm-scroller')?.scrollTop ?? -1, document.querySelector('.vscroll')?.scrollTop ?? -1, document.querySelector('.pt-body')?.scrollLeft ?? -1].join(','),
  flash: !!document.querySelector('.cm-nv-flash'),
  shell: [document.querySelector('.app')?.dataset.left ?? '?', Math.round(document.querySelector('.sidebar.left')?.getBoundingClientRect().width ?? -1), document.querySelector('.app')?.dataset.right ?? '?', Math.round(document.querySelector('.sidebar.right, .rightside')?.getBoundingClientRect().width ?? -1), document.body.className].join(','),
  side: [document.querySelector('.sidebar.left')?.className ?? '?', document.querySelector('.sidebar.left .side-title-back span')?.innerText?.replace(/\\s+/g, ' ') ?? '', document.querySelector('.sidebar.right, .rightside')?.className ?? '?'].join('|'),
  errors: window.__nvErrors.length,
  calls: window.__nvCalls.length,
  lastCall: window.__nvCalls.slice(-1)[0] ?? null,
  };
})()`;

// Channels whose only footprint is incidental (never an "effect" by themselves).
const QUIET = new Set(['state:save', 'state:load', 'window:chrome', 'errors:report']);
// Channels that reach outside the vault (OS, model, network): attempted, not proven.
const EXTERNAL = new Set(['path:reveal', 'path:open-default', 'vault:reveal', 'vault:pick', 'project:open-file', 'project:show-file', 'project:open-folder', 'project:open-conversation', 'project:work', 'automations:open', 'automations:open-neuralspark', 'app:open-remote-computers', 'capture:show', 'capture:snip', 'capture:dictate', 'ai:chat', 'ai:chat-cancel', 'ai:attachment-text', 'models:test', 'dictation:start', 'dictation:status', 'dictation:prepare', 'recorder:begin', 'recorder:transcribe', 'window:zoom', 'window:own-zoom', 'edit:command', 'plugins:openFolder', 'import:csv-pick', 'site:open']);

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    const ev = H.browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
  }
  return H;
}

async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

async function vaultFp(h) {
  const { readdirSync, statSync } = await import('node:fs');
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p, r);
      else out.push(`${r}:${statSync(p).size}:${Math.round(statSync(p).mtimeMs)}`);
    }
  };
  try {
    walk(h.vaultDir, '');
  } catch {}
  return out.sort().join('|');
}

function record(view, words, tag, effect, verdict) {
  ROWS.push({ view, words: words.slice(0, 60), tag, effect: effect.slice(0, 140), verdict });
}

function writeRows() {
  if (!OUT) return;
  mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = ['# Vault controls (p10): every element and its result', '', `Probed ${new Date().toISOString()} with the live harness (tests/vault-controls.test.mjs).`, ''];
  let cur = '';
  for (const r of ROWS) {
    if (r.view !== cur) {
      cur = r.view;
      lines.push(`## ${cur}`, '', '| Control | Effect | Verdict |', '|---|---|---|');
    }
    const cell = (s) => String(s).replace(/\|/g, '/');
    lines.push(`| ${cell(r.words)} (${r.tag}) | ${cell(r.effect)} | ${r.verdict} |`);
  }
  lines.push('');
  writeFileSync(OUT, lines.join('\n'));
}

/** Dismiss anything open over the view (menu, dialog, picker). True when the view is clear. */
async function dismiss(h) {
  const ev = h.browser.ev;
  for (let i = 0; i < 4; i++) {
    const open = await ev(`!!document.querySelector('.menu, [role="menu"], .overlay, ${DIALOG_SEL}')`);
    if (!open) return true;
    // Prefer an explicit way out (Cancel, Close, ×), so a dialog that traps Escape still closes.
    const closed = await ev(`(async () => {
      const root = document.querySelector('${DIALOG_SEL}, .menu, [role="menu"], .overlay');
      if (!root) return false;
      const btns = [...root.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 2);
      const out = btns.find((e) => /^(cancel|close|done|no)$/i.test((e.innerText || '').trim()) || e.getAttribute('aria-label') === 'Close');
      if (out) { out.click(); return true; }
      return false;
    })()`);
    if (!closed) {
      // Next the dimmed backdrop (p11: the search window has no × and ignores Escape while an input holds the
      // keys, as designed — a person clicks out of it), then Escape for what is left (menus, slides: a click on
      // slides advances it, so slides is never backdrop-clicked, only Escaped).
      await ev(`(() => { const bd = [...document.querySelectorAll('.modal-backdrop, .overlay')].find((e) => e.getBoundingClientRect().width > 2 && e.querySelector('.modal, [role="dialog"]')); if (bd) bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`);
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    }
    await sleep(400);
  }
  return !(await ev(`!!document.querySelector('.menu, [role="menu"], .overlay, ${DIALOG_SEL}')`));
}

after(async () => {
  if (H) await H.close().catch(() => {});
  H = null;
});

test('vault controls harness boots the real app with no errors', async () => {
  const h = await harness();
  const app = await h.browser.ev(`!!document.querySelector('.app')`);
  assert.ok(app, 'the app rendered');
  const errors = await h.browser.ev(`window.__nvErrors.slice(0,5)`);
  assert.deepEqual(errors, [], `boot errors: ${JSON.stringify(errors).slice(0, 500)}`);
});

// p11 (4 Nov 2026): the Project page sweep died with `SyntaxError: missing )
// after argument list` because a control key holding an apostrophe ("What's
// next") broke the single-quoted querySelector the probe builds. The key must
// survive any words a label can hold.
test('vault controls selector survives quotes in labels', () => {
  for (const words of ["What's next", 'Say "hi" & don\'t stop', 'back\\slash']) {
    const key = `button~~${words}~cls#0`;
    const expr = `(() => { const el = document.querySelector(${QE(key)}); return el; })()`;
    assert.doesNotThrow(() => new Function(expr), `selector breaks on ${JSON.stringify(words)}`);
    assert.equal(JSON.parse(QE(key)), Q(key));
  }
});

// p14 (4 Nov 2026): the w3b pack overviews' New buttons did nothing — their shared
// page (views/modules/w3b/W3b.tsx) mounted no RecordFormHost, so openRecordForm
// reached no one. The sweep caught Goals' New goal and New habit dead on arrival.
test('pack overviews open their record forms', async () => {
  const h = await harness();
  await h.freshView();
  assert.ok(await switchPackOn(h, 'Goals'), 'Settings › Packs switches Goals on');
  await openPack(h, 'Goals');
  await waitFor(h, H1('★ Goals'));
  for (const words of ['New goal', 'New habit']) {
    const at = await clickWords(h, words, 'main');
    assert.equal(at, 'CLICKED', `${words} is on the overview`);
    const opened = await waitFor(h, `[...document.querySelectorAll('[role="dialog"] h2')].some((e) => e.innerText.trim() === ${JSON.stringify(words)})`);
    assert.ok(opened, `${words} opens its form`);
    await dismiss(h);
  }
});

// p14 (4 Nov 2026): a pack tour left open sat behind the record form opened over
// it (Money, Papers) — dimmed but visible, its Close unreachable under the
// form's overlay (the sweep read it as covered). Opening a form closes the tour.
test('opening a record form closes the pack tour', async () => {
  const h = await harness();
  await h.freshView();
  assert.ok(await switchPackOn(h, 'Money'), 'Settings › Packs switches Money on');
  await openPack(h, 'Money');
  await waitFor(h, `!!document.querySelector('main')`);
  await sleep(800);
  assert.equal(await clickWords(h, 'More for Money'), 'CLICKED', 'the Money menu opens');
  await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
  assert.equal(await clickWords(h, 'Show me around Money', '.menu, [role="menu"]'), 'CLICKED', 'the tour opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.mt-tour')`), 'the tour shows');
  assert.equal(await clickWords(h, 'Add your first bill', 'main'), 'CLICKED', 'Add your first bill is on the page');
  await sleep(600);
  const tour = await h.browser.ev(`!!document.querySelector('.mt-tour')`);
  assert.equal(tour, false, 'the tour closed under the form');
  const form = await h.browser.ev(`[...document.querySelectorAll('[role="dialog"] h2')].some((e) => e.innerText.trim() === 'New bill or subscription')`);
  assert.ok(form, 'the New bill form shows');
  await dismiss(h);
});

// p14 (4 Nov 2026): Settings › Privacy and secrets › Open Locked toasted a raw
// `Cannot read properties of undefined (reading 'unlocked')` — the harness
// answered locked:status but no private:status, so refreshPrivate read .unlocked
// off undefined. The Locked place must open with no raw exception showing.
test('Open Locked shows the Locked place with no raw error', async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await clickWords(h, 'Settings'), 'CLICKED', 'Settings opens');
  await waitFor(h, `!!document.querySelector('main')`);
  await sleep(800);
  assert.equal(await clickWords(h, 'Privacy and secrets', 'main'), 'CLICKED', 'the Privacy section opens');
  await waitFor(h, H1('Privacy and secrets'));
  await sleep(800);
  assert.equal(await clickWords(h, 'Open Locked', 'main'), 'CLICKED', 'Open Locked is in the section');
  assert.ok(await waitFor(h, H1('Locked')), 'the Locked place opens');
  await sleep(1500);
  const said = await h.browser.ev(`document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(!/TypeError|ReferenceError|SyntaxError|Cannot read propert|not a function|is not defined|Unexpected token/i.test(said), `no raw exception shows (toast: ${JSON.stringify(said).slice(0, 120)})`);
});

// k3 (5 Nov 2026): the sweep presses an inline confirm's Cancel (it sorts first), so a confirm's danger button
// needs its own press. Purging one Bin row asks first, then the row is gone for good with words to say so.
test('Bin purges one item for good only after asking', async () => {
  const h = await harness();
  await h.freshView();
  await h.services.invoke('path:trash', ['Notes/Receipts v2.md']).catch(() => {});
  await gotoBin(h);
  assert.ok(await waitFor(h, `document.querySelectorAll('.bin-list-87 > li').length === 1`), 'the deleted note waits in the Bin');
  assert.equal(await clickWords(h, 'Delete now', 'main'), 'CLICKED', 'Delete now is on the row');
  assert.ok(await waitFor(h, `!!document.querySelector('.bin-ask.is-row')`), 'it asks first');
  assert.equal(await clickWords(h, 'Delete for good', 'main'), 'CLICKED', 'Delete for good is in the confirm');
  assert.ok(await waitFor(h, `document.querySelectorAll('.bin-list-87 > li').length === 0`), 'the row is gone');
  await sleep(400);
  const said = await h.browser.ev(`document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(said, /gone for good/, `the toast says it (${JSON.stringify(said).slice(0, 100)})`);
});

// k3 (5 Nov 2026): the Bin's Remove-all confirm says Remove all, like its opener, so the sweep reads it as done —
// its own press: emptying asks first, then the Bin is empty with words to say so.
test('Bin empties only after asking', async () => {
  const h = await harness();
  await h.freshView();
  await h.services.invoke('path:trash', ['Notes/Receipts v2.md']).catch(() => {});
  await gotoBin(h);
  assert.ok(await waitFor(h, `document.querySelectorAll('.bin-list-87 > li').length === 1`), 'the deleted note waits in the Bin');
  assert.equal(await clickWords(h, 'Remove all', 'main'), 'CLICKED', 'Remove all is in the header');
  assert.ok(await waitFor(h, `!!document.querySelector('.bin-ask[aria-label="Remove everything from the Bin?"]')`), 'it asks first');
  assert.equal(await clickWords(h, 'Remove all', '.bin-ask'), 'CLICKED', 'Remove all is in the confirm');
  assert.ok(await waitFor(h, `document.querySelectorAll('.bin-list-87 > li').length === 0`), 'the Bin is empty');
  await sleep(400);
  const said = await h.browser.ev(`document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(said, /empty now/, `the toast says it (${JSON.stringify(said).slice(0, 100)})`);
});

// k3 (5 Nov 2026): the centred bar's panel IS p7's palette (80 commands): the sweep presses search only — its
// door, its modes, its scope, a hit, and the jump into full search. The commands are p7's to press. (The old blind
// sweep of the panel died after two rows: dismiss() closes the very picker it sweeps.)
test('Search panel finds, modes switch, a hit opens', async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the bar opens the panel');
  assert.ok(await waitFor(h, `!!document.querySelector('.picker')`), 'the panel shows');
  for (const m of ['Ask', 'Do', 'Find']) {
    assert.equal(await clickWords(h, m, '.picker-modes'), 'CLICKED', `${m} mode is there`);
    assert.ok(await waitFor(h, `document.querySelector('.picker-modes [role="tab"].on')?.innerText?.trim() === '${m}'`), `${m} mode lights`);
  }
  assert.equal(await clickWords(h, 'All notes', '.picker-modes'), 'CLICKED', 'the scope opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`), 'the scope menu shows');
  assert.equal(await clickWords(h, 'All notes', '.menu, [role="menu"]'), 'CLICKED', 'the scope picks');
  await sleep(400);
  assert.equal(await typeQuery(h, '.picker', 'harbour'), 'TYPED', 'the panel takes the query');
  assert.ok(await waitFor(h, `[...document.querySelectorAll('.picker .picker-row')].some((e) => (e.innerText || '').includes('Harbourline'))`), 'harbour finds its note');
  assert.equal(await clickWords(h, 'Harbourline Cart Fix', '.picker'), 'CLICKED', 'the hit opens');
  assert.ok(await waitFor(h, `!document.querySelector('.picker') && (document.querySelector('main h1, .main h1')?.innerText ?? '').includes('Harbourline Cart Fix')`, 12000), 'the project opens and the panel goes');
  assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the bar opens the panel again');
  assert.ok(await waitFor(h, `!!document.querySelector('.picker')`), 'the panel shows again');
  assert.equal(await typeQuery(h, '.picker', 'harbour'), 'TYPED', 'the panel takes the query again');
  assert.ok(await waitFor(h, `[...document.querySelectorAll('.picker .picker-row')].some((e) => (e.innerText || '').includes('Search inside notes'))`), 'the jump row shows');
  assert.equal(await clickWords(h, 'Search inside notes', '.picker'), 'CLICKED', 'the jump runs');
  assert.ok(await waitFor(h, `!!document.querySelector('.smodal')`), 'the search window opens');
});

// ── the sweep ────────────────────────────────────────────────────────────────

async function clickKey(h, key) {
  // Hover as a person would (round 2: a hover action is dead only if it fails
  // when hovered): move the real mouse over the row so :hover CSS shows it,
  // then focus it so :focus-within does too. The coverage check runs after.
  try {
    const pt = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? { x: Math.min(r.x + r.width / 2, window.innerWidth - 2), y: Math.min(r.y + r.height / 2, window.innerHeight - 2) } : null; })()`);
    if (pt) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pt.x), y: Math.round(pt.y) });
      await sleep(180);
    }
  } catch {}
  return h.browser.ev(`(async () => {
    const el = document.querySelector(${QE(key)});
    if (!el) return 'gone';
    el.scrollIntoView({ block: 'nearest' });
    try { el.focus({ preventScroll: true }); } catch {}
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      p.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    }
    await new Promise((r) => setTimeout(r, 150));
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return 'gone';
    // A wrapped inline control's box centre can fall between its line fragments (p14: a two-line peek title's
    // centre hit-tested its H2, not itself) — probe the middle fragment, where its text is.
    const rs = el.getClientRects();
    let rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r;
    // Still offscreen after the nearest scroll (p16-folio: the clamped point then hit-tests whatever sits at the
    // viewport's edge and blames it): one explicit centring first; genuinely unreachable stays distinct from covered.
    let px = rr.x + rr.width / 2, py = rr.y + rr.height / 2;
    if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) {
      el.scrollIntoView({ block: 'center' });
      const r2 = el.getBoundingClientRect();
      const rs2 = el.getClientRects();
      rr = rs2.length > 1 ? rs2[Math.floor(rs2.length / 2)] : r2;
      px = rr.x + rr.width / 2; py = rr.y + rr.height / 2;
      if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return 'unreached';
    }
    const at = document.elementFromPoint(Math.min(px, window.innerWidth - 2), Math.min(py, window.innerHeight - 2));
    // Covered by an interactive ancestor (a span in its button) is not covered: the click bubbles to the same
    // handlers (p14: the peek's rows flagged themselves "covered by" their own words). A plain ancestor over it
    // still counts: the person cannot reach through that.
    const covered = at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null;
    el.click();
    await new Promise((r) => setTimeout(r, 250));
    return covered ? 'covered:' + covered : 'clicked';
  })()`);
}

async function typeInto(h, key, text) {
  await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (el) { el.scrollIntoView({ block: 'nearest' }); el.focus(); } })()`);
  await sleep(150);
  await h.browser.send('Input.insertText', { text });
  await sleep(250);
}

async function clearInput(h, key) {
  const v = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); return el ? (el.value ?? '') : null; })()`);
  if (v === null || v === '') return;
  // Many find boxes clear on Escape; else select-all and delete.
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await sleep(250);
  const v2 = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); return el ? (el.value ?? '') : null; })()`);
  if (v2 === null || v2 === '') return;
  await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (el) { el.focus(); el.select && el.select(); } })()`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
  await sleep(250);
}

async function setSelect(h, key) {
  return h.browser.ev(`(() => {
    const el = document.querySelector(${QE(key)});
    if (!el || el.tagName !== 'SELECT') return 'notselect';
    if (el.options.length < 2) return 'one-option';
    el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set:' + el.options[el.selectedIndex].text.slice(0, 30);
  })()`);
}

const MENUS_JS = `[...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2).length`;

// A project Inline value's real gesture (p11): a single click waits by design (double-click, E or its pencil edits),
// so the sweep double-clicks with the real mouse, like a person would.
// A timeline mark's real gesture (p16-folio): marks listen to pointer down/up (drag to move, release to open),
// which a synthetic click never fires — el.click() on one is dead though a person's click opens its record.
// The real mouse, like dblclickInline.
async function clickReal(h, key) {
  try {
    const pt = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); let r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) return null; let px = r.x + r.width / 2, py = r.y + r.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); px = r.x + r.width / 2; py = r.y + r.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return { unreachable: true }; } const x = Math.min(px, window.innerWidth - 2), y = Math.min(py, window.innerHeight - 2); const at = document.elementFromPoint(x, y); const covered = at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null; return { x, y, covered }; })()`);
    if (!pt) return 'gone';
    if (pt.unreachable) return 'unreached';
    const x = Math.round(pt.x), y = Math.round(pt.y);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(250);
    return pt.covered ? 'covered:' + pt.covered : 'clicked';
  } catch {
    return 'gone';
  }
}

async function dblclickInline(h, key) {
  try {
    const pt = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return null; const sc0 = document.querySelector('.vscroll'); const sy0 = sc0 ? sc0.scrollTop : -1; el.scrollIntoView({ block: 'nearest' }); const sc1 = document.querySelector('.vscroll'); const sy1 = sc1 ? sc1.scrollTop : -1; const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) return null; const rs = el.getClientRects(); let rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r; let px = rr.x + rr.width / 2, py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) { el.scrollIntoView({ block: 'center' }); const r2 = el.getBoundingClientRect(); const rs2 = el.getClientRects(); rr = rs2.length > 1 ? rs2[Math.floor(rs2.length / 2)] : r2; px = rr.x + rr.width / 2; py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return { unreachable: true, sy0, sy1 }; } const x = Math.min(px, window.innerWidth - 2), y = Math.min(py, window.innerHeight - 2); const at = document.elementFromPoint(x, y); const covered = at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null; return { x, y, covered, sy0, sy1 }; })()`);
    if (!pt) return 'gone';
    if (pt.unreachable) return 'unreached';
    if (process.env.NV_CONTROLS_VERBOSE && pt.covered) console.log(`[scroll] key=${JSON.stringify(key).slice(0, 60)} scrollTop ${pt.sy0} → ${pt.sy1}`);
    const x = Math.round(pt.x), y = Math.round(pt.y);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(120);
    for (const n of [1, 2]) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
    }
    await sleep(350);
    return pt.covered ? 'covered:' + pt.covered : 'dblclick';
  } catch {
    return 'gone';
  }
}

function diffSnap(a, b) {
  const d = [];
  for (const k of ['tab', 'head', 'peek', 'peekTitle', 'modal', 'modalTitle', 'menu', 'toast', 'editor', 'mode', 'shell', 'side', 'overlay', 'forms', 'flash']) if (a[k] !== b[k]) d.push(`${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  if (a.mainLen !== b.mainLen) d.push(`main ${a.mainLen} → ${b.mainLen} chars`);
  else if (a.mainHash !== b.mainHash) d.push('main reworded/reordered');
  if (a.scroll !== b.scroll) d.push(`scroll ${a.scroll} → ${b.scroll}`);
  return d;
}

/** Activate one control and describe what happened. */
async function probe(h, view, c, scope) {
  const ev = h.browser.ev;
  if (c.disabled) {
    record(view, c.words || '(no words)', c.tag, 'off (disabled)', 'disabled');
    return { verdict: 'disabled' };
  }
  if (c.tag === 'input' && c.type === 'file') {
    await clickKey(h, c.key);
    record(view, c.words || 'Choose files', c.tag, 'opens the OS file picker (nothing observable headless)', 'external');
    return { verdict: 'external' };
  }
  // Scroll into view first so the before/after scroll comparison is clean. Each probe starts unfocused with
  // nothing selected, as a person's next gesture does (p14: a focus left sitting in a field would read as this
  // probe's own doing, and Inline values rightly ignore a click made while selecting).
  await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (el) el.scrollIntoView({ block: 'nearest' }); })()`);
  await sleep(150);
  await ev(`(() => { try { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); window.getSelection()?.removeAllRanges(); } catch {} })()`);
  // A lit line lasts about two seconds (p14: an already-there reveal's only footprint is the flash, so a stale one
  // from the last probe would hide this one's — let it go out before reading).
  let before = await ev(SNAP_JS);
  if (before.flash) {
    await waitFor(h, `!document.querySelector('.cm-nv-flash')`, 3000);
    before = await ev(SNAP_JS);
  }
  // A toast over the click point eats the click (p16-folio: the sweep's own 'Removed a decision' toast covered
  // Log a decision on the next probe). A person waits for it to fade, so the probe does — bounded, and a toast's
  // own buttons stay sweepable while they show.
  if (before.toast) {
    await waitFor(h, `![...document.querySelectorAll('.toast, .toasts')].some((e) => e.getBoundingClientRect().width > 2 && (e.innerText || '').trim())`, 6000);
    before = await ev(SNAP_JS);
  }
  // A peek left open by an earlier probe: re-opening what it shows is a silent no-op by design (peek.ts: a
  // same-target open returns), so a second path to the same card reads dead though both paths work (p16-folio:
  // the person's name opens their card, then Open card re-opens it). A person closes what they finished with,
  // so the probe does — except when sweeping the peek's own controls.
  const inPeek = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); return !!el?.closest('.peek'); })()`);
  if (!inPeek && (await ev(`!!document.querySelector('.peek')`))) {
    await ev(`(() => { const x = document.querySelector('.peek [aria-label="Close"]'); if (x) x.click(); })()`);
    await sleep(300);
    if (await ev(`!!document.querySelector('.peek')`)) {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await sleep(300);
    }
    before = await ev(SNAP_JS);
  }
  // Which field holds the focus, if not the control itself (p14: opening a field focuses it, so a swap of one
  // empty field for another still reads — values alone could not see it).
  const focusOf = async () => ev(`(() => { const a = document.activeElement; const el = document.querySelector(${QE(c.key)}); if (!a || a === el || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return ''; return a.tagName + '.' + (a.type || '') + '.' + ((a.getAttribute('aria-label') || a.placeholder || a.name || '').slice(0, 30)); })()`);
  const focusBefore = await focusOf();
  const menusBefore = await ev(MENUS_JS);
  const rpcBefore = h.services.calls.length;
  const fpBefore = await vaultFp(h);
  // A project Inline value shown (not empty, not already a field): a single click waits by design, so it is
  // double-clicked; an empty one adds on one click, like everything else.
  const inlineDbl = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); return !!el && el.classList.contains('pj-ed') && !el.classList.contains('pj-ed-empty') && !el.querySelector('input, textarea, select'); })()`);
  // A link out of the vault (p14: a person's email address opens their mail app, which headless Chromium has not).
  const hrefOut = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); const u = el?.href ?? ''; return /^(mailto:|tel:)/i.test(u) ? u.slice(0, 60) : ''; })()`);
  const isMark = c.tag === 'button' && await ev(`(() => { const el = document.querySelector(${QE(c.key)}); return !!el?.classList?.contains('pt-mark'); })()`);
  // The Notes and files head's Attach opens the OS file picker through a hidden input (p16-folio): headless Chromium
  // swallows the picker, so the click receipts on the input itself — the handoff the page owns. (The picker
  // opening headed is the browser's doing, the same hop the file input's own 'external' already accepts.)
  const attachArmed = c.tag === 'button' && c.words === 'Attach' ? await ev(`(() => { const el = document.querySelector(${QE(c.key)}); const inp = el?.closest('[data-section="notes"]')?.querySelector('input[type="file"]'); if (!el || !inp) return ''; inp.setAttribute('data-harness-receipt', 'armed'); inp.addEventListener('click', () => inp.setAttribute('data-harness-receipt', 'got'), { once: true }); return 'armed'; })()`) : '';
  let how = '';
  if (c.tag === 'select') {
    how = await setSelect(h, c.key);
    await sleep(350);
  } else if ((c.tag === 'input' && /^(text|search|number|email|url|password|date|time)$/.test(c.type || 'text')) || c.tag === 'textarea') {
    await typeInto(h, c.key, 'harbour');
    how = 'typed';
  } else if (c.tag === 'input' && /^(range|color)$/.test(c.type)) {
    how = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (!el) return 'gone'; el.focus(); el.value = el.type === 'range' ? String((Number(el.min || 0) + Number(el.max || 100)) / 2) : '#336699'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'set'; })()`);
    await sleep(350);
  } else if (inlineDbl) {
    how = await dblclickInline(h, c.key);
  } else if (isMark) {
    how = await clickReal(h, c.key);
  } else {
    how = await clickKey(h, c.key);
  }
  // Read the Attach handoff now: a later re-render could swap the input and take the receipt with it.
  const attachGot = attachArmed === 'armed' ? await ev(`(document.querySelector('[data-section="notes"] input[data-harness-receipt="got"]') ? 'got' : '')`) : '';
  if (how === 'gone') {
    record(view, c.words || '(no words)', c.tag, 'vanished before the click (re-rendered away)', 'flaky');
    return { verdict: 'flaky' };
  }
  if (how === 'unreached') {
    record(view, c.words || '(no words)', c.tag, 'still offscreen after scrolling (the sensor could not reach it)', 'unreachable');
    return { verdict: 'unreachable' };
  }
  await sleep(150);
  let after = await ev(SNAP_JS);
  const menusAfter = await ev(MENUS_JS);
  let diffs = diffSnap(before, after);
  let focusAfter = await focusOf();
  if (focusBefore !== focusAfter) diffs.push(`focus moved${focusAfter ? ` to ${focusAfter}` : ' away from the only field'} (was: ${focusBefore || 'no field'})`);
  if (how.startsWith('covered:')) {
    // A submenu parent opens its menu on hover, covering its own click point: the control works (its menu opened).
    // A control covered by anything else is still broken.
    if (process.env.NV_CONTROLS_VERBOSE) {
      try {
        console.log(`[cover-dump] ${JSON.stringify(await ev(`(() => {
          const J = (v) => Math.round(v);
          const el = document.querySelector(${QE(c.key)});
          const r = el?.getBoundingClientRect();
          const x = r ? Math.min(r.x + r.width / 2, window.innerWidth - 2) : -1, y = r ? Math.min(r.y + r.height / 2, window.innerHeight - 2) : -1;
          const at = r ? document.elementFromPoint(x, y) : null;
          const qr = at?.getBoundingClientRect();
          const chain = [];
          for (let p = at?.parentElement; p && chain.length < 6; p = p.parentElement) chain.push(p.tagName + '.' + (p.className || '').toString().slice(0, 25) + (p.dataset?.section ? '[sec=' + p.dataset.section + ']' : ''));
          const elChain = [];
          for (let p = el; p && p !== document.body && elChain.length < 10; p = p.parentElement) { const cs = p instanceof Element ? getComputedStyle(p) : null; elChain.push(p.tagName + '.' + (p.className || '').toString().slice(0, 20) + (cs ? '{ov:' + cs.overflowY.slice(0, 4) + ',pos:' + cs.position.slice(0, 4) + ',cv:' + (cs.contentVisibility || 'na').slice(0, 4) + '}' : '')); }
          const scrollers = [...document.querySelectorAll('.vscroll')].map((s) => { const q = s.getBoundingClientRect(); return J(s.scrollTop) + '/' + J(s.scrollHeight - s.clientHeight) + '@' + J(q.y) + 'h' + J(q.height); });
          const pages = [...document.querySelectorAll('.pj-page')].map((s) => { const q = s.getBoundingClientRect(); return J(q.y) + 'h' + J(q.height); });
          const sc = document.querySelector('.vscroll');
          return JSON.stringify({ words: ${JSON.stringify(c.words.slice(0, 50))}, elRect: r ? [J(r.x), J(r.y), J(r.width), J(r.height)] : null, pt: [J(x), J(y)], at: at ? at.tagName + '.' + (at.className || '').toString().slice(0, 40) : null, atRect: qr ? [J(qr.x), J(qr.y), J(qr.width), J(qr.height)] : null, chain, elChain, scrollers, pages, scroll: sc ? J(sc.scrollTop) + '/' + J(sc.scrollHeight - sc.clientHeight) : 'nosc', vh: window.innerHeight, peek: !!document.querySelector('.peek'), modal: !!document.querySelector('.modal, [role="dialog"]'), toast: (document.querySelector('.toast, .toasts')?.innerText || '').slice(0, 30), secs: [...document.querySelectorAll('[data-section]')].map((s) => s.dataset.section + '@' + J(s.getBoundingClientRect().top)).join(',') });
        })()`))}`);
      } catch {}
    }
    if (menusAfter > menusBefore) diffs.push(`hover opened its submenu (its click point sits under ${how.slice(8)})`);
    else {
      record(view, c.words || '(no words)', c.tag, `click lands on ${how.slice(8)} instead`, 'covered');
      return { verdict: 'covered' };
    }
  }
  if (how === 'dblclick') {
    // Escape puts the value back as it was (the verdict above already saw the field open). A field left open
    // would pollute later rounds, so blur it away when Escape did not close it (closing unchanged saves nothing).
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await sleep(300);
    const stuck = await ev(`!!document.querySelector('.pj-ed-input, .pj-date-input')`);
    if (stuck) {
      await ev(`(document.activeElement instanceof HTMLElement) && document.activeElement.blur()`);
      await sleep(300);
    }
  }
  // The control's own state (a ticked box, typed words, a chosen option, a pressed toggle, an icon button's
  // changed label — p14: Family's day chips toggle aria-pressed alone, and Show/Hide it swaps its aria-label, so a
  // state read without those two called both dead though each works; p16-folio: the Publish dialog's source radios
  // flip selection alone when both panes read the same, so the read carries selection too).
  const stateAfter = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (!el) return 'gone'; const chk = el.getAttribute('aria-checked') ?? (el.checked !== undefined && /checkbox|radio/.test(el.type || '') ? String(el.checked) : ''); const vv = el.value !== undefined ? String(el.value) : ''; const sel = el.getAttribute('aria-selected') ?? el.getAttribute('aria-current') ?? ((typeof el.className === 'string' && /(^|\\s)(on|active|selected|is-on)(\\s|$)/.test(el.className)) ? 'on' : ''); return [chk, el.value !== undefined ? vv.length + ':' + vv.slice(-24) : '', el.getAttribute('aria-pressed') ?? '', el.getAttribute('aria-label') ?? '', sel].join('~'); })()`);
  const stateBefore = [c.checked ?? '', c.value ?? '', c.pressed ?? '', c.label ?? '', c.sel ?? ''].join('~');
  if (stateAfter !== 'gone' && stateAfter !== stateBefore) diffs.push(`own state ${JSON.stringify(stateBefore)} → ${JSON.stringify(stateAfter)}`);
  let rpc = h.services.calls.slice(rpcBefore).map((x) => x.method).filter((m) => !QUIET.has(m));
  const fpAfter = await vaultFp(h);
  let filesChanged = fpAfter !== fpBefore;
  let errGrew = after.errors > before.errors;
  // Put typed words back (a find box left filled would hide later controls).
  if (how === 'typed') await clearInput(h, c.key);
  let errWords = errGrew ? await ev(`window.__nvErrors.slice(${before.errors}, ${after.errors}).join(' / ').slice(0, 200)`) : '';
  // One fresh click before calling it dead (p14): a click landing while its view re-renders mid-flight runs on a
  // dying node and reads as dead though the control works — the peek's '+ By' died this way three sweeps running.
  // Only when the first click observably did nothing at all, so nothing fires twice.
  if (how === 'clicked' && !diffs.length && !rpc.length && !filesChanged && !errGrew && !hrefOut) {
    // Matched by stable identity, not base: a re-render swaps the class (a settling peek's '+ By' gained
    // pj-ed-empty), so the base dies with the node it came from.
    const sibs = (await ev(ENUM_JS(scope || ''))).filter((x) => x.tag === c.tag && x.words === c.words && x.role === c.role && x.type === c.type);
    const fresh = sibs[Number((c.key.split('#')[1] ?? 0)) || 0];
    if (fresh && (await (isMark ? clickReal(h, fresh.key) : clickKey(h, fresh.key))) === 'clicked') {
      await sleep(150);
      after = await ev(SNAP_JS);
      diffs = diffSnap(before, after);
      focusAfter = await focusOf();
      if (focusBefore !== focusAfter) diffs.push(`focus moved${focusAfter ? ` to ${focusAfter}` : ' away from the only field'} (was: ${focusBefore || 'no field'})`);
      rpc = h.services.calls.slice(rpcBefore).map((x) => x.method).filter((m) => !QUIET.has(m));
      filesChanged = (await vaultFp(h)) !== fpBefore;
      errGrew = after.errors > before.errors;
      errWords = errGrew ? await ev(`window.__nvErrors.slice(${before.errors}, ${after.errors}).join(' / ').slice(0, 200)`) : '';
    }
  }
  // Two true no-ops a silent click can still be (p16-folio, asked only when the click was otherwise silent, so
  // working controls pay nothing for the question): a click on the already-open tab (t267: the folio jumps are
  // tabs now — the dead nav went with the foot — and the generic already-selected excuse below reads
  // enumeration-time state, so this asks the tab as it is now), and the timeline's Today with today already
  // showing (a reset with nothing to reset).
  let navInView = '', ptToday = '';
  if (how === 'clicked' && !diffs.length && !rpc.length && !filesChanged && !errGrew && !hrefOut) {
    const silent = JSON.parse(await ev(`(() => {
      const out = { nav: '', today: '' };
      const el = document.querySelector(${QE(c.key)});
      if (!el) return JSON.stringify(out);
      if (el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') === 'true') {
        out.nav = ((el.innerText || '').trim().toLowerCase().replace(/\\s+\\d+$/, '') || 'tab');
      }
      if ((el.innerText || '').trim() === 'Today' && el.closest('.pt-plan')) {
        const plan = el.closest('.pt-plan');
        const body = plan.querySelector('.pt-body'), mark = plan.querySelector('.pt-today');
        if (body && mark) {
          const b = body.getBoundingClientRect(), m = mark.getBoundingClientRect();
          if (m.left >= b.left - 2 && m.left <= b.right + 2) out.today = 'today';
        }
      }
      return JSON.stringify(out);
    })()`) || {});
    navInView = silent.nav || '';
    ptToday = silent.today || '';
  }
  return { verdict: '', diffs, rpc, filesChanged, errGrew, errWords, after, hrefOut, attachGot, navInView, ptToday };
}

function judge(view, c, r) {
  if (r.errGrew) {
    record(view, c.words || '(no words)', c.tag, `page error: ${r.errWords}`, 'error');
    return 'error';
  }
  // A toast leaking a raw exception reads to the person as the app breaking (p14: missing stand-ins toasted
  // TypeErrors that 'works' hid). Narrow on purpose: clipboard denials are the headless box refusing, not the app.
  if (r.diffs.some((d) => d.startsWith('toast:') && /TypeError|ReferenceError|SyntaxError|Cannot read propert|not a function|is not defined|Unexpected token/i.test(d))) {
    record(view, c.words || '(no words)', c.tag, r.diffs.join('; '), 'error');
    return 'error';
  }
  if (r.diffs.length || r.filesChanged) {
    const bits = [...r.diffs];
    if (r.filesChanged) bits.push('vault files changed');
    if (r.rpc.length) bits.push(`rpc ${[...new Set(r.rpc)].slice(0, 3).join(',')}`);
    record(view, c.words || '(no words)', c.tag, bits.join('; '), 'works');
    return 'works';
  }
  if (r.hrefOut) {
    record(view, c.words || '(no words)', c.tag, `opens ${r.hrefOut} (outside the vault; not proven)`, 'external');
    return 'external';
  }
  if (r.attachGot) {
    record(view, c.words || '(no words)', c.tag, 'the file input got the click (the OS picker opens headed; headless-unobservable)', 'external');
    return 'external';
  }
  if (r.navInView) {
    record(view, c.words || '(no words)', c.tag, `'${r.navInView}' already open (no-op correct)`, 'current');
    return 'current';
  }
  if (r.ptToday) {
    record(view, c.words || '(no words)', c.tag, 'today already showing (no-op correct)', 'current');
    return 'current';
  }
  if (r.rpc.length) {
    if (r.rpc.some((m) => EXTERNAL.has(m))) {
      record(view, c.words || '(no words)', c.tag, `attempted ${[...new Set(r.rpc)].join(',')} (outside the vault; not proven)`, 'external');
      return 'external';
    }
    record(view, c.words || '(no words)', c.tag, `rpc ${[...new Set(r.rpc)].join(',')} but nothing visible changed`, 'works-rpc');
    return 'works-rpc';
  }
  // Already-selected tabs, nav rows, segments and picked radios: clicking again correctly does nothing.
  const noOpOk = c.sel != null || (c.pressed === 'true' && !/switch|checkbox/.test(c.role || '') && c.type !== 'checkbox') || ((c.role === 'radio' || c.role === 'menuitemradio') && c.checked === 'true');
  if (noOpOk) {
    record(view, c.words || '(no words)', c.tag, 'already selected (no-op correct)', 'current');
    return 'current';
  }
  // A field takes the focus and waits for words: nothing changing on a click is what it should do.
  if (c.tag === 'input' || c.tag === 'textarea' || c.tag === 'select') { record(view, c.words || '(no words)', c.tag, 'takes the focus', 'field'); return 'field'; }
  record(view, c.words || '(no words)', c.tag, 'nothing happened', 'DEAD');
  return 'DEAD';
}

/** Type `text` into the scope's text input (search doors retype their query on every open: reopens reset it). */
async function typeQuery(h, scope, text) {
  const items = await h.browser.ev(ENUM_JS(scope));
  const input = items.find((c) => c.tag === 'input' && !['file', 'checkbox', 'radio', 'range', 'color', 'button', 'submit'].includes(c.type || 'text'));
  if (!input) return 'NO-INPUT';
  await typeInto(h, input.key, text);
  return 'TYPED';
}

/** Click the first visible control whose words include `words` (optionally under `scope`). */
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

const OVERLAYS_JS = `(() => ({
  menus: [...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2).length,
  dialogs: [...document.querySelectorAll('${DIALOG_SEL}')].filter((e) => e.getBoundingClientRect().width > 2).length,
}))()`;

// Packs switch on through Settings › Packs, the way a person does (p11: every pack is off until switched on, and the
// nav shows no row for one that is off — the sweep cannot open them any other honest way).
/** Switch one pack on through Settings › Packs. True when its Open button shows. */
async function switchPackOn(h, name) {
  await clickWords(h, 'Settings');
  await waitFor(h, `!!document.querySelector('main')`);
  await sleep(800);
  await clickWords(h, 'Packs', 'main');
  await sleep(800);
  const sel = `section.packrow input.switch[aria-label="${name} on"]`;
  const st = await h.browser.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'nearest' });
    if (!el.checked) el.click();
    return 'clicked';
  })()`);
  if (st === 'missing') return false;
  await sleep(900);
  return h.browser.ev(`(() => !!document.querySelector(${JSON.stringify(sel)})?.checked)()`);
}

// Standalone the Bin's door is Settings › Backups and sync › Bin › Open (the More row shows only in the
// former host app).
async function gotoBin(h) {
  await clickWords(h, 'Settings');
  await waitFor(h, `!!document.querySelector('main')`);
  await sleep(800);
  await clickWords(h, 'Backups and sync', 'main');
  await waitFor(h, H1('Backups and sync'));
  await sleep(800);
  await h.browser.ev(`document.querySelector('main .setting-row[data-setting="Bin"] button')?.click()`);
  await waitFor(h, H1('Bin'));
}

/** Open a switched-on pack's page. True when it lands (best-effort: the room asserts the first open). */
async function openPack(h, name) {
  // t10 the quiet More (8 Nov 2026): packs left the bar and More for Ctrl+K, each by its own name.
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await clickWords(h, name, '.sidebar.left, aside')) !== 'CLICKED') {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
      if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
        if ((await clickWords(h, 'Ask or find anything', '.topbar')) !== 'CLICKED') {
          await dismiss(h);
          continue;
        }
        if (!(await waitFor(h, `!!document.querySelector('.picker input')`))) {
          await dismiss(h);
          continue;
        }
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
      if (picked !== 'CLICKED') {
        await dismiss(h);
        continue;
      }
      await sleep(600);
    }
    if (await waitFor(h, PACK_STAY(name))) return true;
    await dismiss(h);
  }
  return false;
}

/** The first control not yet tried (`done` counts tries per stable base key). */
function pickFresh(ctrls, done) {
  const seen = new Map();
  for (const c of ctrls) {
    const n = seen.get(c.base) ?? 0;
    seen.set(c.base, n + 1);
    if (n >= (done.get(c.base) ?? 0)) return { c, n };
  }
  return null;
}

/** Re-open a menu path by words (keys die on re-render; words survive). */
async function openChain(h, chain) {
  for (const words of chain) {
    const at = await clickWords(h, words);
    if (at !== 'CLICKED') return false;
    await sleep(300);
  }
  return true;
}

/**
 * Sweep an open menu level: click every item; a submenu recurses, a dialog is
 * swept, navigating away re-opens the view and the menu path. `chain` holds the
 * words that re-open this level (top opener, then parent items).
 */
async function sweepMenu(h, view, chain, stayJS, reopen, depth = 0) {
  const ev = h.browser.ev;
  if (depth > 2) return;
  const done = new Map();
  // Capped levels say so (see sweepDialog): 40 rounds silently dropped the More menu's tail.
  let capped = true;
  for (let round = 0; round < 120; round++) {
    // A dialog over the menu (one item opened it): shut everything, then re-open the menu path.
    if ((await ev(OVERLAYS_JS)).dialogs > 0) await dismiss(h);
    if ((await ev(OVERLAYS_JS)).menus === 0) {
      if (!(await openChain(h, chain))) { capped = false; return; }
    }
    // This level only: the deepest open menu. Enumerating every menu re-probes the
    // parent level (a submenu parent re-clicked while open is a no-op by design).
    await ev(`(() => { document.querySelectorAll('[data-harness-deep]').forEach((e) => e.removeAttribute('data-harness-deep')); const ms = [...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2); if (ms.length) ms[ms.length - 1].setAttribute('data-harness-deep', '1'); })()`);
    const items = await ev(ENUM_JS('[data-harness-deep]'));
    const pick = pickFresh(items, done);
    if (!pick) { capped = false; return; }
    done.set(pick.c.base, pick.n + 1);
    if (process.env.NV_CONTROLS_VERBOSE) console.log(`[${view} › menu ${round}] ${pick.c.tag} ${JSON.stringify(pick.c.words)}`);
    const menusBefore = (await ev(OVERLAYS_JS)).menus;
    const r = await probe(h, `${view} › menu`, pick.c);
    if (r.verdict) continue;
    const ov = await ev(OVERLAYS_JS);
    const stay = stayJS ? await ev(stayJS) : true;
    if (!stay) {
      judge(`${view} › menu`, pick.c, { ...r, diffs: [...r.diffs, 'left the view'] });
      await reopen();
      await openChain(h, chain);
      continue;
    }
    if (ov.dialogs > 0) {
      record(view, pick.c.words || '(menu item)', pick.c.tag, 'opens a dialog', 'works');
      await sweepDialog(h, view, stayJS, reopen, async () => {
        await openChain(h, chain);
        await clickWords(h, pick.c.words, '.menu, [role="menu"]');
        await sleep(400);
      });
      await openChain(h, chain);
      continue;
    }
    if (ov.menus > menusBefore) {
      record(view, pick.c.words || '(menu item)', pick.c.tag, 'opens a submenu', 'works');
      await sweepMenu(h, view, [...chain, pick.c.words], stayJS, reopen, depth + 1);
      await dismiss(h);
      await openChain(h, chain);
      continue;
    }
    judge(`${view} › menu`, pick.c, r);
  }
  if (capped) {
    await openChain(h, chain).catch(() => false);
    await ev(`(() => { document.querySelectorAll('[data-harness-deep]').forEach((e) => e.removeAttribute('data-harness-deep')); const ms = [...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2); if (ms.length) ms[ms.length - 1].setAttribute('data-harness-deep', '1'); })()`).catch(() => {});
    const left = freshCount(await ev(ENUM_JS('[data-harness-deep]')).catch(() => []), done);
    record(`${view} › menu`, `${left} controls unpressed`, 'sweep', `the menu level capped at 120 rounds with ${left} controls never pressed`, 'capped');
  }
}

/** p7's switcher palette (QuickSwitcher): out of scope — named, never clicked through. */
async function isSwitcher(h) {
  return h.browser.ev(`!![...document.querySelectorAll('.modal input, [role="dialog"] input')].find((e) => (e.getAttribute('placeholder') || '').includes('Find a note, or type a new name'))`);
}

/** How many fresh controls are in `items` that `done` has not tried yet. */
function freshCount(items, done) {
  const seen = new Map();
  let left = 0;
  for (const c of items) {
    const n = seen.get(c.base) ?? 0;
    seen.set(c.base, n + 1);
    if (n >= (done.get(c.base) ?? 0)) left++;
  }
  return left;
}

/** Sweep an open dialog's controls; `reopen` brings the dialog back when one closes it. */
async function sweepDialog(h, view, stayJS, reopen, dialogReopen) {
  const ev = h.browser.ev;
  if (await isSwitcher(h)) {
    const n = await ev(`[...document.querySelectorAll('.modal button, [role="dialog"] button')].filter((e) => e.getBoundingClientRect().width > 2).length`);
    record(view, `switcher palette (${n} rows)`, 'dialog', 'p7’s QuickSwitcher (out of scope)', 'out-of-scope');
    await dismiss(h);
    return;
  }
  const done = new Map();
  // A level that still has fresh controls when the rounds run out says so (k3, 5 Nov 2026: the More menu's tail —
  // Commands, Tags, the fold row — and the date submenu's tail never pressed, silently, at 40 rounds). 'capped'
  // fails nothing; the sweep must leave none.
  let capped = true;
  for (let round = 0; round < 120; round++) {
    if ((await ev(OVERLAYS_JS)).dialogs === 0) {
      await dialogReopen();
      if ((await ev(OVERLAYS_JS)).dialogs === 0) { capped = false; return; }
    }
    const items = await ev(ENUM_JS(DIALOG_SEL));
    const pick = pickFresh(items, done);
    if (!pick) { capped = false; return; }
    done.set(pick.c.base, pick.n + 1);
    if (process.env.NV_CONTROLS_VERBOSE) console.log(`[${view} › dialog ${round}] ${pick.c.tag} ${JSON.stringify(pick.c.words)}`);
    const r = await probe(h, `${view} › dialog`, pick.c);
    if (r.verdict) continue;
    const ov = await ev(OVERLAYS_JS);
    const stay = stayJS ? await ev(stayJS) : true;
    if (!stay) {
      judge(`${view} › dialog`, pick.c, { ...r, diffs: [...r.diffs, 'left the view'] });
      await reopen();
      continue;
    }
    if (ov.menus > 0 && r.after.menu) {
      record(view, pick.c.words || '(dialog control)', pick.c.tag, 'opens a menu', 'works');
      await sweepMenu(h, view, [pick.c.words], stayJS, async () => {
        if ((await ev(OVERLAYS_JS)).dialogs === 0) await dialogReopen();
      });
      await dismiss(h);
      continue;
    }
    judge(`${view} › dialog`, pick.c, r);
  }
  if (capped) {
    const left = freshCount(await ev(ENUM_JS(DIALOG_SEL)).catch(() => []), done);
    record(`${view} › dialog`, `${left} controls unpressed`, 'sweep', `the dialog level capped at 120 rounds with ${left} controls never pressed`, 'capped');
  }
}

/**
 * Sweep every control in `scope` (default the whole view): re-enumerate before
 * each activation (keys die on re-render), recurse into menus and dialogs,
 * and re-open the view when one navigates away. `positions` scrolls through
 * (in order) once exhausted, for virtualized content (the note's foot).
 */
async function sweepView(h, view, { open, stayJS = '', scope = '', skip = [], positions = [] } = {}) {
  const ev = h.browser.ev;
  const done = new Map();
  const skipped = new Set(skip);
  // Back to the view, verified: when a plain re-open does not land (a modal
  // trapped the clicks, or the words matched elsewhere), reload pristine and
  // open again rather than sweeping some other view's controls under this one.
  const reopen = async () => {
    await open();
    if (stayJS) {
      try {
        if (!(await ev(stayJS))) {
          await h.freshView();
          await open();
        }
      } catch {}
    }
  };
  let pos = 0;
  // Capped levels say so (see sweepDialog).
  let capped = true;
  for (let round = 0; round < 300; round++) {
    // Shut leftovers, but never the subject itself (k3, 5 Nov 2026: dismiss() closed the swept search window, and
    // the room broke after two rows): a dialog scope keeps its one dialog, and a closed subject reopens before
    // enumerating — like the menu and dialog sweeps already do.
    const ov0 = await ev(OVERLAYS_JS);
    const dialogSubject = /modal|dialog|picker|slides/.test(scope || '');
    if (ov0.menus > 0 || (dialogSubject ? ov0.dialogs > 1 : ov0.dialogs > 0)) await dismiss(h);
    if (stayJS && !(await ev(stayJS))) await reopen();
    const ctrls = (await ev(ENUM_JS(scope || ''))).filter((c) => !skipped.has(c.words));
    const pick = pickFresh(ctrls, done);
    if (!pick) {
      if (pos >= positions.length) { capped = false; break; }
      await ev(positions[pos++]);
      await sleep(600);
      continue;
    }
    done.set(pick.c.base, pick.n + 1);
    if (process.env.NV_CONTROLS_VERBOSE) console.log(`[${view} ${round}] ${pick.c.tag} ${JSON.stringify(pick.c.words)}`);
    const r = await probe(h, view, pick.c);
    if (r.verdict) continue;
    const ov = await ev(OVERLAYS_JS);
    const stay = stayJS ? await ev(stayJS) : true;
    if (!stay) {
      judge(view, pick.c, { ...r, diffs: [...r.diffs, 'left the view'] });
      await reopen();
      continue;
    }
    if (ov.menus > 0 && r.after.menu) {
      record(view, pick.c.words || '(no words)', pick.c.tag, 'opens a menu', 'works');
      await sweepMenu(h, view, [pick.c.words], stayJS, reopen);
      await dismiss(h);
      const stay2 = stayJS ? await ev(stayJS) : true;
      if (!stay2) await reopen();
      continue;
    }
    if (ov.dialogs > 0 && r.after.modal) {
      record(view, pick.c.words || '(no words)', pick.c.tag, 'opens a dialog', 'works');
      await sweepDialog(h, view, stayJS, reopen, async () => clickWords(h, pick.c.words));
      await dismiss(h);
      const stay2 = stayJS ? await ev(stayJS) : true;
      if (!stay2) await reopen();
      continue;
    }
    judge(view, pick.c, r);
    await dismiss(h);
  }
  if (capped) {
    const ctrls = (await ev(ENUM_JS(scope || '')).catch(() => [])).filter((c) => !skipped.has(c.words));
    record(view, `${freshCount(ctrls, done)} controls unpressed`, 'sweep', `the view capped at 300 rounds with controls never pressed`, 'capped');
  }
  const clear = await dismiss(h);
  assert.ok(clear, `${view}: a menu or dialog would not close`);
}

function assertClean(view) {
  const rows = ROWS.filter((r) => r.view === view || r.view.startsWith(`${view} ›`));
  writeRows();
  // Pressing nothing proves nothing (k3, 5 Nov 2026: the doc-peek door opened no peek and the room passed empty).
  assert.ok(rows.length > 0, `${view}: the sweep pressed nothing (its door never landed)`);
  const bad = rows.filter((r) => ['DEAD', 'error', 'covered', 'unreachable'].includes(r.verdict));
  assert.deepEqual(
    bad.map((r) => `${r.words} [${r.verdict}] ${r.effect}`),
    [],
    `${view}: dead or broken controls:\n${bad.map((r) => `  - ${r.words} [${r.verdict}] ${r.effect}`).join('\n')}`,
  );
}

// ── views ────────────────────────────────────────────────────────────────────

const H1 = (t) => `document.querySelector('main h1, .main h1')?.innerText?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(t)}`;
// PageHead pages (Notes, People): the h1 carries a live count ("Notes 6"), so the pin reads the name span, not the
// h1 (k3, 5 Nov 2026: H1('Notes') never matched and the room ground through reloads, blind, like Home).
const PAGENAME = (t) => `document.querySelector('main .nv-page-name')?.innerText?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(t)}`;

// Home folded into Today (5 Nov 2026, one morning place: openHome opens Today, old home tabs draw TodayView,
// no Home row anywhere): the morning room sweeps Today with the shell around it (the rail, More and the header
// only sweep here). The old Home room's H1('Home') pin and the old Today room's .td-page pin both rotted (no such
// H1 or class any more): every probe read 'left the view', menus and dialogs were skipped, and each round paid a
// reload plus a 12 s timeout (k3: the Home pass took 23 minutes and never left Today). One room now: the main-only
// Today pass was its subset.
const TODAY_STAY = `!!document.querySelector('.td-view')`;
test('Today (and the shell around it): every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Today');
    await waitFor(h, TODAY_STAY);
    await sleep(800);
  };
  await open();
  // Today greets by time of day; its marker is the view, not the words.
  await sweepView(h, 'Today', { open, stayJS: TODAY_STAY });
  assertClean('Today');
});

test('Inbox: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Inbox');
    await waitFor(h, H1('Inbox'));
  };
  await open();
  await sweepView(h, 'Inbox', { open, stayJS: H1('Inbox'), scope: 'main' });
  assertClean('Inbox');
});

test('Projects: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Projects');
    await waitFor(h, H1('Projects'));
  };
  await open();
  await sweepView(h, 'Projects', { open, stayJS: H1('Projects'), scope: 'main' });
  assertClean('Projects');
});

async function openProjectPage(h) {
  await clickWords(h, 'Projects');
  await waitFor(h, H1('Projects'));
  await clickWords(h, 'Harbourline Cart Fix');
  await waitFor(h, `!!document.querySelector('.pj-page')`);
  await sleep(800);
}

test('Project page: every control in every section works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = () => openProjectPage(h);
  await open();
  const stay = `!!document.querySelector('.pj-page')`;
  await sweepView(h, 'Project page', { open, stayJS: stay, scope: 'main' });
  assertClean('Project page');
});

async function openLiveNote(h) {
  await openProjectPage(h);
  await clickWords(h, 'More', 'main');
  await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
  // Grouped 4 Nov 2026 (p14-menus): Edit as a note sits under Project now.
  await clickWords(h, 'Project', '.menu, [role="menu"]');
  await waitFor(h, `document.querySelectorAll('.menu, [role="menu"]').length >= 2`);
  await clickWords(h, 'Edit as a note');
  await waitFor(h, `!!document.querySelector('.cm-editor')`);
  await sleep(600);
}

const NOTE_POSITIONS = [
  `(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight; })()`,
  `(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = 0; })()`,
];

test('Note: every control works (header, rail, foot)', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = () => openLiveNote(h);
  await open();
  await sweepView(h, 'Note', { open, stayJS: `!!document.querySelector('.cm-editor')`, scope: 'main', positions: NOTE_POSITIONS });
  // Typing in the editor changes the note on disk (the control all edits go through).
  const ev = h.browser.ev;
  await ev(`(() => { const el = document.querySelector('.cm-content'); el.focus(); })()`);
  await sleep(200);
  const fp0 = await vaultFp(h);
  await h.browser.send('Input.insertText', { text: ' More words.' });
  await sleep(2500);
  const fp1 = await vaultFp(h);
  record('Note', 'editor typing', 'editor', fp1 !== fp0 ? 'note file changed' : 'nothing happened', fp1 !== fp0 ? 'works' : 'DEAD');
  assertClean('Note');
});

// t239, 12 Nov 2026 (brief-directed): the foot's connected rows open their documents in the main
// view — the side peek no longer opens from any click, so there is no panel left to sweep. Each kind proves
// the document opens at the top with its title and no side panel: a workstream opens the project it belongs
// to, a person, meeting or note itself. Best-effort: returns 'OPENED' when the document shows, else why not.
// The room asserts the first open.
async function openFromFoot(h, title, expect) {
  await openLiveNote(h);
  await h.browser.ev(`(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight; })()`);
  await waitFor(h, `!!document.querySelector('.note-foot')`);
  await sleep(600);
  // The connected row with exactly this title (k3, 5 Nov 2026: a words-contains click matched Kickoff's snippet
  // first and the doc room opened nothing, passing vacuously — snippets mention titles, only peek-rows open).
  // The rows arrive async (records:peek), so the door waits for its row, not a fixed sleep.
  const ROW = `[...document.querySelectorAll('.note-foot button.peek-row')].some((e) => (e.querySelector('.peek-row-title')?.innerText ?? '').trim() === ${JSON.stringify(title)})`;
  if (!(await waitFor(h, ROW))) return 'NO-ROW';
  const at = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.note-foot button.peek-row')].filter((e) => e.getBoundingClientRect().width > 2);
    const el = rows.find((e) => (e.querySelector('.peek-row-title')?.innerText ?? '').trim() === ${JSON.stringify(title)});
    if (!el) return 'NOTFOUND:' + rows.length;
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    return 'CLICKED';
  })()`);
  if (at !== 'CLICKED') return at;
  if (!(await waitFor(h, `document.title.includes(${JSON.stringify(expect)})`, 8000))) return 'NO-DOC:' + (await h.browser.ev(`document.title`)).slice(0, 40);
  await sleep(600);
  if (await h.browser.ev(`!!document.querySelector('.peek')`)) return 'PEEKED';
  const top = await h.browser.ev(`(() => { const m = document.querySelector('main .vscroll'); return m ? m.scrollTop : 0; })()`);
  if (top > 60) return 'NOT-TOP:' + top;
  return 'OPENED';
}

test('Foot (workstream): its row opens the project it belongs to', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await openFromFoot(h, 'Wave list', 'Harbourline Cart Fix'), 'OPENED', `the foot's Wave list row opens the project`);
});

test('Foot (person): its row opens the person', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await openFromFoot(h, 'Alex Chen', 'Alex Chen'), 'OPENED', `the foot's Alex Chen row opens`);
});

test('Foot (meeting): its row opens the meeting', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await openFromFoot(h, '2026-11-03 Cart standup', '2026-11-03 Cart standup'), 'OPENED', `the foot's standup row opens`);
});

test('Foot (note): its row opens the note', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  assert.equal(await openFromFoot(h, 'Receipts spec', 'Receipts spec'), 'OPENED', `the foot's Receipts spec row opens`);
});

test('Meetings: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  // The nav shows no Meetings row until its pack is on: switch it on first, the way a person does.
  const switched = await switchPackOn(h, 'Meetings');
  assert.ok(switched, 'Settings › Packs switches Meetings on');
  const open = async () => {
    const direct = await clickWords(h, 'Meetings');
    if (direct !== 'CLICKED') {
      await clickWords(h, 'More');
      await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
      await clickWords(h, 'Meetings', '.menu, [role="menu"]');
    }
    await waitFor(h, PACK_STAY('Meetings'));
    await sleep(800);
  };
  await open();
  // The pack shell heads its h1 with a glyph ("◑ Meetings"), so the pin includes, never equals (k3, 5 Nov 2026:
  // H1('Meetings') never matched and the room swept blind, like Home).
  await sweepView(h, 'Meetings', { open, stayJS: PACK_STAY('Meetings'), scope: 'main' });
  assertClean('Meetings');
});

test('Shared spaces: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    // 5 Nov 2026, the quiet rail: Shared spaces waits in More.
    await clickWords(h, 'More', '.sidebar.left, aside');
    await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
    await clickWords(h, 'Shared spaces', '.menu, [role="menu"]');
    await sleep(1200);
  };
  await open();
  // Strict to the page (k3, 5 Nov 2026: stayJS `main` never fired, so the room wandered through Notes and all of
  // Settings under this name — 230 comingled rows, discarded).
  await sweepView(h, 'Shared spaces', { open, stayJS: H1('Shared spaces'), scope: 'main' });
  assertClean('Shared spaces');
});

test('Notes: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Notes');
    await waitFor(h, PAGENAME('Notes'));
  };
  await open();
  await sweepView(h, 'Notes', { open, stayJS: PAGENAME('Notes'), scope: 'main' });
  assertClean('Notes');
});

test('People: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'People');
    await waitFor(h, PAGENAME('People'));
    await sleep(800);
  };
  await open();
  await sweepView(h, 'People', { open, stayJS: PAGENAME('People'), scope: 'main' });
  assertClean('People');
});

test('Tasks: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Tasks');
    await waitFor(h, H1('Tasks'));
  };
  await open();
  await sweepView(h, 'Tasks', { open, stayJS: H1('Tasks'), scope: 'main' });
  assertClean('Tasks');
});

test('Bin: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  // Two deleted notes waiting, through the real data layer (the same call the UI's delete makes): the room presses
  // the Bin's own controls (its rows, Restore, Delete now, Remove all), not the way in.
  for (const rel of ['Inbox/awning-quote.md', 'Notes/Receipts v2.md']) {
    await h.services.invoke('path:trash', [rel]).catch(() => {});
  }
  const open = async () => {
    await gotoBin(h);
  };
  await open();
  await sweepView(h, 'Bin', { open, stayJS: H1('Bin'), scope: 'main' });
  assertClean('Bin');
});

test('Search window: every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  // 5 Nov 2026, one search door: the rail's Search row is gone — the way in is More → Search inside notes (the
  // centred bar's panel is p7's palette; the focused panel test above presses its search controls).
  const open = async () => {
    await clickWords(h, 'More');
    await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
    await clickWords(h, 'Search inside notes', '.menu, [role="menu"]');
    await waitFor(h, `!!document.querySelector('.smodal')`);
    // The room sweeps search WITH results: the query types on every open (reopens reset it), then the hits settle.
    await typeQuery(h, '.smodal', 'harbour');
    await waitFor(h, `document.querySelectorAll('.smodal button.sas-rowhead').length > 0`);
    await sleep(1500);
  };
  await open();
  await sweepView(h, 'Search window', { open, stayJS: `!!document.querySelector('.smodal')`, scope: '.smodal' });
  assertClean('Search window');
});

test('Settings (and Packs): every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  const open = async () => {
    await clickWords(h, 'Settings');
    await waitFor(h, `!!document.querySelector('main')`);
    await sleep(800);
  };
  await open();
  // Strict to Settings (k3, 5 Nov 2026: stayJS `main` let probes that leave Settings — Bin › Open, Open Locked —
  // wander on under this name). Backups and sync sweeps against the harness's backup stand-in (the real BackupView
  // shape, p14).
  const SETTINGS_STAY = `!!document.querySelector('.settings-page')`;
  await sweepView(h, 'Settings', { open, stayJS: SETTINGS_STAY, scope: 'main' });
  assertClean('Settings');
  // The list-level sweep never reaches a section's own rows: the section buttons sort first in the page and turn
  // fresh again on every switch, so the rows below them starve. Every section sweeps its body one by one (k3, 5 Nov
  // 2026: only three did, and 'Keys' had been renamed 'Keyboard shortcuts', so that pass swept the wrong body).
  for (const label of ['General', 'Look', 'Home cards', 'Calendar', 'Packs', 'Capture', 'Backups and sync', 'Keyboard shortcuts', 'Models', 'Privacy and secrets', 'Connect an AI', 'Plugins', 'Publish']) {
    const openSection = async () => {
      await h.freshView();
      await open();
      await clickWords(h, label, 'main');
      await waitFor(h, H1(label));
      await sleep(800);
    };
    await openSection();
    await sweepView(h, `Settings › ${label}`, { open: openSection, stayJS: SETTINGS_STAY, scope: '.settings-body' });
    assertClean(`Settings › ${label}`);
  }
});

// p11: each pack's page, swept with its pack switched on (one fresh vault per group; packs switch on through the
// real Settings rows, pages open through their real Open buttons).
// Publications pins its root, not its h1: the empty state is a start form with no h1 (k3, 5 Nov 2026: the room
// failed to land on it). The sweep grows the page itself — typing a name and starting a publication flips it to the
// full PackShell UI under the same root, so one pass covers both.
const PACK_STAY = (name) => name === 'Publications' ? `!!document.querySelector('.p87-pub')` : `(document.querySelector('main h1')?.innerText ?? '').includes(${JSON.stringify(name)})`;

async function sweepPacks(h, all) {
  const only = (process.env.NV_PACK_ONLY || '').split(',').filter(Boolean);
  const names = only.length ? all.filter((n) => only.includes(n)) : all;
  const bad = [];
  for (const name of names) {
    // One pack per clean room (k3, 5 Nov 2026: without isolation Money's sweep left residue that broke Papers'
    // open, and Papers swept Today blind for minutes): pristine vault, switch on, land asserted.
    await h.freshView();
    const switched = await switchPackOn(h, name);
    assert.ok(switched, `Settings › Packs switches ${name} on`);
    const open = () => openPack(h, name);
    assert.ok(await open(), `the ${name} pack opens`);
    await sweepView(h, `Pack ${name}`, { open, stayJS: PACK_STAY(name), scope: 'main' });
    try { assertClean(`Pack ${name}`); } catch (e) { bad.push(e.message); }
  }
  assert.deepEqual(bad, [], 'every pack page is clean');
}

test('Pack pages A (Money, Papers, House, Cars, Career, Trips): every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  await sweepPacks(h, ['Money', 'Papers', 'House', 'Cars', 'Career', 'Trips']);
});

test('Pack pages B (Weekly, Sites, Suppliers, Business, Systems, Goals, Lists): every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  // Packs uplift item 5: no Memories page; the albums are swept with Family in Pack pages C.
  await sweepPacks(h, ['Weekly', 'Sites', 'Suppliers', 'Business', 'Systems', 'Goals', 'Lists']);
});

test('Pack pages C (Health, Family, Publications): every control works', SWEEP, async () => {
  const h = await harness();
  await h.freshView();
  await sweepPacks(h, ['Health', 'Family', 'Publications']);
});
