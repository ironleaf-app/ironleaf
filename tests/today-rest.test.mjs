// node --test tests/today-rest.test.mjs — p15-today-rest (4 Nov 2026): the rest of Today below Next
// for you, and Home. Morning brief lines that Projects at risk or Cards to review already show go;
// Today in your notes skips the notes Changed since yesterday already names; every brief row's
// title opens the thing it names; Home's areas rows say their open tasks and next date from the
// project list; Change Home sits in the header. Fails without each change: source checks plus the
// live harness (the real renderer bundle against a real vault, tests/vault-controls-harness.mjs).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The morning brief keeps only what the page does not already show ─────────

test('brief lines for listed at-risk projects and due decks drop from Today’s card (counted in more)', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // Still through the shared card filter first (round 3's rule stands).
  assert.ok(src.includes('todayCardBrief(brief)'), 'through the shared Today card filter');
  // Then the page's own repeats go: a project line for a listed at-risk project…
  assert.ok(/kind === 'project' && riskPaths\.has\(/.test(src), 'a listed at-risk project’s line drops');
  assert.ok(src.includes('view.atRisk.map((x) => x.project)'), 'against the listed risk projects');
  assert.ok(/on\('today:risk'\)/.test(src), 'only while the risk section shows');
  // …and the cards line while Cards to review shows (it shows on the same decks).
  assert.ok(/kind === 'cards' && cardsListed/.test(src), 'the cards line drops while Cards to review shows');
  assert.ok(src.includes("on('today:tasks')"), 'only while that section is on');
  // Every dropped row counts in more, as the card's own filter counts its own.
  assert.ok(src.includes('more: card.more + (card.items.length - items.length)'), 'dropped rows count as more');
});

// ── Today in your notes skips what Changed since yesterday names ─────────────

test('DayActivity skips another card’s paths in Made and Changed, never Linked', () => {
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(parts.includes('except?: ReadonlySet<string>'), 'an except set of paths');
  assert.ok(parts.includes('day.made.filter(keep)') && parts.includes('day.changed.filter(keep)'), 'Made and Changed skip them');
  assert.ok(parts.includes('items: day.linked'), 'Linked keeps everything');
  assert.ok(parts.includes('under Changed since yesterday'), 'the empty card says where they are');
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('changedPaths'), 'Today passes what Changed since yesterday names');
  assert.ok(src.includes('l.path) s.add(l.path)'), 'the note lines’ paths');
  assert.ok(src.includes('except={changedPaths}'), 'into Today in your notes');
  assert.ok(/on\('today:changed'\)/.test(src), 'only while that card shows');
});

// ── Every brief row opens the thing it names ──────────────────────────────────

test('a brief row’s title opens its thing: its open target, else a review, link or meeting note', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  const card = home.split('function BriefCardHome')[1].split('/** The Inbox')[0];
  assert.ok(card.includes("find((a) => a.kind === 'open')"), 'its open target wherever it sits');
  assert.ok(card.includes("main.kind === 'review' || main.kind === 'url' || main.kind === 'meeting'"), 'else a review, link or meeting note');
  assert.ok(card.includes('runBriefAction(titleAct'), 'the title runs it');
  const titleLine = card.split('const titleAct')[1].split(';')[0];
  assert.ok(!titleLine.includes("'ask'") && !titleLine.includes("'snooze'"), 'asking and snoozing stay on their buttons');
});

// ── Home: areas rows say their open tasks and next date ───────────────────────

test('areas rows read the project list: open tasks, nearest due, or what the area holds', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('projects.list()'), 'the same project list the area’s page reads');
  assert.ok(home.includes('areaOfPath(c.path)'), 'grouped by each project’s area');
  // Break-it t11 (8 Nov 2026): the one open rule everywhere, so held projects keep out with finished ones.
  assert.ok(home.includes('isOpenProject(c.status)'), 'live projects only');
  assert.ok(home.includes('open += c.openNext'), 'open tasks counted');
  assert.ok(home.includes('readDate(c.due)'), 'dues compared as dates');
  assert.ok(home.includes('projectDueWords('), 'the nearest due in the project’s words');
  assert.ok(home.includes('open tasks') && home.includes('No open tasks'), 'the row says its tasks');
  assert.ok(home.includes('home-due-bad'), 'a past date reads coral');
  assert.ok(home.includes('useAreaCounts()'), 'without live projects, what the area holds');
  assert.ok(home.includes('Nothing here yet'), 'an empty area says what it is for');
});

test('no Your-cards block and no changer on Today: a turned-on card is a row in the list', () => {
  // 8 Nov 2026, calm Today: "Your cards" and "Change cards" are gone; a card turned on is a row in the
  // list, opening to its card as the old fold did. Recently viewed with nothing in it is no row.
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('Your cards'), 'no Your-cards block');
  assert.ok(!today.includes('Change cards') && !today.includes('<ChangeHome'), 'no changer on Today');
  assert.ok(today.includes('LookCards'), 'the turned-on cards render as list rows');
  assert.ok(today.includes("id !== 'recent' || recent.length > 0"), 'empty Recently viewed is no row');
});

// ── The quiet buttons wrap, never cut off ─────────────────────────────────────

test('quiet buttons wrap their second line; the area date reads the theme token', () => {
  const today = read('src/renderer/src/styles/today.css');
  assert.ok(/\.td-day-note \.td-row-sub[^{]*\{[^}]*white-space:\s*normal/.test(today), 'the tidy button’s words wrap');
  const css = read('src/renderer/src/styles/home.css');
  assert.ok(/\.home-due-bad\s*\{[^}]*var\(--ns-attention-words\)/.test(css), 'the past date reads the theme token');
  assert.ok(!/\.home-due-bad\s*\{[^}]*#[0-9a-f]{3,6}/i.test(css), 'no hex beside it');
});

// ── The live page: no repeats, no loss, useful rows ───────────────────────────

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

test('Today: the brief repeats no listed risk, activity repeats no changed note, nothing lost', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(2500);
  // The brief, the risks and the changes fold with Also now, shut by default — opened
  // first, as a person would, so the drop conditions below read live.
  await h.browser.ev(`document.querySelector('[data-section="also"] .td-more')?.click()`);
  await sleep(1200);
  // The risk section lists the late museum project (the drop condition is live)…
  const risks = await ev(`[...document.querySelectorAll('[data-section="risk"] .td-row-what .td-text')].map((e) => e.textContent.trim())`);
  assert.ok(risks.includes('Museum Late Shift'), `Projects at risk lists it: ${JSON.stringify(risks)}`);
  // …so the brief keeps no line about it (its card may be gone entirely).
  const briefTitles = await ev(`[...document.querySelectorAll('[data-section="brief"] .trow .t')].map((e) => e.textContent.trim())`);
  assert.ok(!briefTitles.some((t) => t.includes('Museum Late Shift')), `no brief line repeats it: ${JSON.stringify(briefTitles)}`);
  // Changed since yesterday names the kickoff note in its project…
  const changed = await ev(`[...document.querySelectorAll('[data-section="changed"] .td-change-line .td-text')].map((e) => e.textContent.trim())`);
  assert.ok(changed.includes('Kickoff'), `Changed since yesterday names it: ${JSON.stringify(changed)}`);
  // …so Today in your notes keeps it out of Made and Changed (Linked is link-based).
  for (const tab of ['Made', 'Changed']) {
    const names = await ev(`(async () => {
      const btn = [...document.querySelectorAll('.th-tabs .th-tab')].find((b) => (b.innerText || '').startsWith(${JSON.stringify(tab)}));
      if (!btn || btn.disabled) return [];
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return [...document.querySelectorAll('.th-act-list .th-act-name')].map((e) => e.textContent.trim());
    })()`);
    assert.ok(!names.includes('Kickoff'), `${tab} repeats no changed note: ${JSON.stringify(names)}`);
  }
});

test('Home: no Your-cards block; a turned-on card is a row in the list', async () => {
  // 8 Nov 2026, calm Today (one morning place, no Home page): "Your cards" and "Change cards" are gone;
  // a card turned on is a row in the list. The Inbox is switched on in the saved arrangement, so its row
  // lists; Recently viewed (nothing viewed yet) is no row.
  const h = await harness();
  const ev = h.browser.ev;
  await h.services.invoke('state:save', ['home-cards', { on: ['due', 'recent', 'upcoming', 'brief', 'inbox'] }]);
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  await waitFor(h, `!!document.querySelector('.app')`);
  await sleep(2500);
  await clickWords(h, 'Today');
  await waitFor(h, `!!document.querySelector('.td-view')`);
  await sleep(1500);
  const shut = await ev(`document.querySelector('.td-view')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(!shut.includes('Your cards'), 'no Your-cards block on the calm screen');
  assert.ok(!shut.includes('Change cards'), 'no changer on the calm screen');
  // The fold may start open (the earlier test left it so, remembered): open it only if shut.
  const line = await ev(`document.querySelector('[data-section="also"] .td-more')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  if (!/Show fewer/.test(line)) await ev(`document.querySelector('[data-section="also"] .td-more')?.click()`);
  await sleep(1200);
  const rows = await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.ok(rows.includes('Inbox'), `the turned-on Inbox is a row: ${JSON.stringify(rows)}`);
  assert.ok(!rows.includes('Recently viewed'), `empty Recently viewed is no row: ${JSON.stringify(rows)}`);
  // The row opens to its card, as the old fold did (scoped: the rail has its own Inbox).
  await ev(`[...document.querySelectorAll('.td-look-items .td-look-row > summary')].find((e) => e.innerText.replace(/\\s+/g, ' ').trim() === 'Inbox')?.click()`);
  await sleep(600);
  const card = await ev(`[...document.querySelectorAll('.td-look-items .td-look-row')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).find((t) => t.startsWith('Inbox')) ?? ''`);
  assert.match(card, /waiting to be filed/, `the row opens to its card: ${card.slice(0, 100)}`);
  // No Home row on the rail; Today lights for old home tabs too.
  const rail = await ev(`document.querySelector('.places-list, .rail')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(!/\bHome\b/.test(rail), `no Home row on the rail (${rail.slice(0, 120)})`);
});
