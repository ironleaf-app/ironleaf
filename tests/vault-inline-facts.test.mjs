// node --test tests/vault-inline-facts.test.mjs — p17-editable (Nov 2026, the ): every fact the
// Vault shows can be changed where it is shown, by the same gesture as everywhere else
// (double-click, E or its pencil), and the change saves to its note with Undo. One harness, walked
// surface by surface: the project folio (risks, sections, waiting rows, board cards), People,
// Decisions, Key dates, a meeting note, and the Tasks page. (The Overview's tiles became the
// sections in the 5 Nov 2026 folio; the rows below are the same rows, editable where they show.)
// Fails first: each surface below showed its facts as plain words with no way to change them there.
// Made-up vault only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';

let h;
before(async () => {
  h = await startHarness();
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2200);
  // Long, real content on top of the harness vault, through the real note writes.
  const writes = [
    ['Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', PROJECT],
    ['Meetings/2026-11-03 Cart standup.md', MEETING],
    ['People/Alex Chen.md', ALEX],
    ['Daily/2026-11-04.md', DAILY],
    ['Inbox.md', INBOX],
  ];
  for (const [rel, content] of writes) {
    const r = await h.browser.ev(`window.nv.notes.write(${JSON.stringify(rel)}, ${JSON.stringify(content)}).then(() => 'ok', (e) => 'ERR:' + e.message)`);
    assert.equal(r, 'ok', `write ${rel}: ${r}`);
  }
  // The writes land on disk, but the page's own note index reads them on load: reload so every surface (including
  // the meeting note's top, which reads the note's properties) sees the enriched vault.
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
});
after(async () => {
  await h?.close().catch(() => {});
});

async function waitFor(js, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 120)}`);
    await sleep(300);
  }
}

async function clickWords(words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND:' + ${JSON.stringify(words)};
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED:' + ${JSON.stringify(words)};
  })()`);
  assert.equal(r, `CLICKED:${words}`, `click ${words} ${scope}`);
}

async function openProject() {
  await clickWords('Projects', '.sidebar.left, aside');
  await waitFor(`!![...document.querySelectorAll('main button, main a[href], main [role="button"]')].find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').includes('Harbourline Cart Fix')))`);
  await clickWords('Harbourline Cart Fix', 'main');
  await waitFor(`!!document.querySelector('.pj-page')`);
  await sleep(900);
}

/** Back on the project page (tests share one harness; a failure must not strand the next). */
async function ensureProject() {
  const there = await h.browser.ev(`!!document.querySelector('.pj-page')`);
  if (!there) await openProject();
}

async function openSection(label) {
  // t255: the sticky line became the tab bar; each section reads on its tab.
  await clickWords(label, '.pt-bar[role="tablist"]');
  await sleep(1200);
}

/** Double-click an Inline value with the real mouse, like a person would. */
async function dblclick(sel) {
  const pt = await h.browser.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) return null; return { x: Math.min(r.x + r.width / 2, window.innerWidth - 2), y: Math.min(r.y + r.height / 2, window.innerHeight - 2) }; })()`);
  assert.ok(pt, `visible: ${sel}`);
  const x = Math.round(pt.x), y = Math.round(pt.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(120);
  for (const n of [1, 2]) {
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
  }
  await sleep(400);
}

/** Type into the open Inline field (selected first, so the words are replaced). */
async function typeInto(text) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(150);
  await h.browser.send('Input.insertText', { text });
  await sleep(250);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1200);
}

async function toastWords() {
  return h.browser.ev(`document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ') ?? ''`);
}

const PROJECT_PATH = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
async function projectView() {
  return h.browser.ev(`window.nv.projects.view(${JSON.stringify(PROJECT_PATH)}).then((v) => v.project)`);
}

// ── Folio sections ───────────────────────────────────────────────────────────

test('Risks section: a risk level and owner change where they show', async () => {
  await openProject();
  await openSection('Risks');
  const row = `[data-item-card="risks"] [data-item="risks:0"]`;
  await waitFor(`!!document.querySelector(${JSON.stringify(row)})`);
  // The level is a Choice (a click opens its choices); the owner an Inline value.
  const level = await h.browser.ev(`!!document.querySelector(${JSON.stringify(`${row} button.ly-choice`)})`);
  assert.equal(level, true, 'risk level is a Choice where it shows');
  const owner = await h.browser.ev(`!!document.querySelector(${JSON.stringify(`${row} .tkrow-who .pj-ed, ${row} .pj-ed`)})`);
  assert.equal(owner, true, 'risk owner is an Inline value where it shows');
  // Round trip: the owner changes in the note, said once, with Undo.
  await dblclick(`${row} [aria-label^="Owner"]`);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('Sam Lee');
  const p = await projectView();
  assert.equal(p.risks[0].owner, 'Sam Lee');
  assert.match(await toastWords(), /Undo/, 'the change offers Undo');
});

test('Waiting and Key dates sections: the rows change their facts where they show', async () => {
  await ensureProject();
  await waitFor(`!!document.querySelector('[data-section="waiting"]')`);
  // Waiting rows: the words and the day, routed to the line they came from (a day the page can read gets
  // the calendar, any other the words field — the same rule as the step's own row).
  const cells = await h.browser.ev(`[...document.querySelectorAll('[data-section="waiting"] [data-action] .pj-ed, [data-section="waiting"] [data-action] .pj-ed-date')].length`);
  assert.ok(cells >= 2, `a waiting row edits its words and day where it shows (found ${cells})`);
  // Key dates: the words, written to the key date.
  const mw = await h.browser.ev(`!!document.querySelector('[data-section="key-dates"] [data-milestone] .pj-ed')`);
  assert.equal(mw, true, 'a key date edits its words where it shows');
});

// ── Your next ────────────────────────────────────────────────────────────────

test("Your next section: waiting rows change where they show; one view, no board", async () => {
  // Step 2 (their decision 2: one view per list): the Board switch is gone, rows edit in the one flat
  // list.
  await ensureProject();
  await openSection('Your next');
  await waitFor(`!!document.querySelector('.tklist')`);
  const cells = await h.browser.ev(`[...document.querySelectorAll('[data-action] .pj-ed')].length`);
  assert.ok(cells >= 2, `a waiting row edits what/who/when where it shows (found ${cells})`);
  assert.ok(!(await h.browser.ev(`!!document.querySelector('[data-section="whats-next"] .seg')`)), 'no view switch on Your next');
});

// ── People, Decisions, Key dates ─────────────────────────────────────────────

test('People section: a role changes where it shows', async () => {
  await ensureProject();
  await openSection('People');
  await waitFor(`!!document.querySelector('[data-item-card="people"]')`);
  const role = await h.browser.ev(`!!document.querySelector('[data-person] .pj-ed')`);
  assert.equal(role, true, 'a person edits their role where it shows');
});

test('Decisions section: the day changes where it shows', async () => {
  await ensureProject();
  await openSection('Decisions');
  const row = `[data-item-card="decisions"] [data-item="decisions:0"]`;
  await waitFor(`!!document.querySelector(${JSON.stringify(row)})`);
  const date = await h.browser.ev(`!!document.querySelector(${JSON.stringify(`${row} .pj-ed-date`)})`);
  assert.equal(date, true, 'a decision edits its day where it shows');
  await dblclick(`${row} .pj-ed-date`);
  await waitFor(`!!document.querySelector('.pj-date-input')`);
  // Pick the day the way the calendar would (the native picker cannot be driven headless): the field's own change,
  // then its own Enter.
  await h.browser.ev(`(() => { const i = document.querySelector('.pj-date-input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, '2026-11-09'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`);
  await sleep(1500);
  const p = await projectView();
  assert.equal(p.decisions[0].date, '9 Nov 2026');
  assert.match(await toastWords(), /Undo/, 'the change offers Undo');
});

test('Key dates section: a date changes its day and words where they show', async () => {
  // The Timeline tab's milestone marks became the section's rows (the folio merges milestones and key dates).
  await ensureProject();
  await openSection('Key dates');
  await waitFor(`!!document.querySelector('[data-section="key-dates"] [data-milestone]')`);
  const n = await h.browser.ev(`[...document.querySelectorAll('[data-section="key-dates"] [data-milestone] .pj-ed, [data-section="key-dates"] [data-milestone] .pj-ed-date')].length`);
  assert.ok(n >= 2, `key dates edit day and words where they show (found ${n})`);
});

// ── Meeting note ─────────────────────────────────────────────────────────────

test('a meeting note: day, time, place and people change at its top', async () => {
  // The standup links the project, so the project's Notes section opens the note itself.
  await ensureProject();
  await openSection('Notes');
  // t141 (9 Nov 2026): the meeting's day reads beside its title, so a leading date is not said twice —
  // the row shows the title alone and keeps the full title for hover.
  const meeting = await h.browser.ev(`(() => {
    const row = document.querySelector('[data-meeting="Meetings/2026-11-03 Cart standup.md"]');
    const btn = row?.querySelector('button.t');
    return row ? { text: (btn?.innerText || '').trim(), title: btn?.title ?? '', day: (row.querySelector('.trow > span')?.innerText || '').trim() } : null;
  })()`);
  assert.ok(meeting, 'the standup reads in the Notes meetings');
  assert.equal(meeting.text, 'Cart standup', 'the title without its leading date');
  assert.equal(meeting.title, '2026-11-03 Cart standup', 'the full title on hover');
  assert.ok(meeting.day.length > 0, `the day reads beside it (${meeting.day})`);
  await clickWords('Cart standup', '[data-meeting="Meetings/2026-11-03 Cart standup.md"]');
  await waitFor(`!!document.querySelector('.mt-top')`);
  await sleep(900);
  const n = await h.browser.ev(`[...document.querySelectorAll('.mt-top .pj-ed')].length`);
  assert.ok(n >= 4, `the meeting top edits day, time, place and people where they show (found ${n})`);
  // Round trip: the time changes in the note's own properties, with Undo.
  await dblclick(`.mt-top [aria-label^="Time"]`);
  await waitFor(`!!document.querySelector('.mt-top .pj-ed-input')`);
  await typeInto('11:30 AM');
  const note = await h.browser.ev(`window.nv.notes.read('Meetings/2026-11-03 Cart standup.md')`);
  assert.match(note, /time: 11:30 AM/);
  assert.match(await toastWords(), /Undo/, 'the change offers Undo');
});

// ── Tasks page ───────────────────────────────────────────────────────────────

test('Tasks: who and when change on the row', async () => {
  const direct = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll('.sidebar.left button, aside button')].filter(vis);
    const el = els.find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').trim() === 'Tasks'));
    if (!el) return 'NOTFOUND';
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  if (direct === 'NOTFOUND') {
    await clickWords('More', '.sidebar.left, aside');
    await sleep(500);
    await clickWords('Tasks', '.menu, [role="menu"]');
  }
  await sleep(1800);
  await clickWords('Everyone', 'main');
  await sleep(1200);
  // Mark the PA hire row so its cells are found directly.
  const marked = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.tk-row')].find((r) => (r.getAttribute('aria-label') || '').includes('PA hire'));
    if (!row) return false;
    row.setAttribute('data-test-task', 'pa-hire');
    return true;
  })()`);
  assert.equal(marked, true, 'the PA hire task shows');
  const who = await h.browser.ev(`!!document.querySelector('[data-test-task="pa-hire"] .tkrow-who .pj-ed')`);
  assert.equal(who, true, 'a task edits who does it on its row');
  const when = await h.browser.ev(`!!document.querySelector('[data-test-task="pa-hire"] .tkrow-when .pj-ed')`);
  assert.equal(when, true, 'a task edits its day on its row');
  // Round trip: who changes on its line, the day stays, with Undo.
  await dblclick(`[data-test-task="pa-hire"] .tkrow-who .pj-ed`);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('Alex Chen');
  const inbox = await h.browser.ev(`window.nv.notes.read('Inbox.md')`);
  assert.match(inbox, /Price the PA hire — Alex Chen 📅 2026-11-09/);
  assert.match(await toastWords(), /Undo/, 'the change offers Undo');
});

// ── Fixtures (made-up people and projects) ───────────────────────────────────

const PROJECT = `---
type: project
status: active
health: on track
progress: 45
owner: Alex Chen
due: 2026-11-20
started: 2026-10-12
tags: [harbourline, cart, checkout]
---

# Harbourline Cart Fix

## Summary

The shop's cart drops about one order in forty at payment. Fix the retry, then the receipt.

## What's next

- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05
- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06
- [ ] Send the receipt v2 for review — Alex Chen — due 2026-11-04
- [ ] Confirm the Saturday deploy window with the host — Sam Lee — due 2026-11-07
- [x] Confirm the caterer — Priya Nair

## Run sheet

### Mornings

- [ ] Wipe the benches — Priya Nair · by 7 Nov 2026
- [x] Mop the floor — Sam Lee

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
|---|---|---|---|---|
| Wave list | Alex Chen | in progress | 60% | Upgrade or chase the 13 still to do at 26 Oct |
| Receipts | Priya Nair | ready to send | 80% | Send v2 (reviewer PASS) |

## Key dates

| Date | Milestone | Status |
|---|---|---|
| 2026-11-04 | Receipt v2 review | next |
| 2026-11-06 | Retry fix live | next |
| 2026-11-20 | Cart fix done | |

## People

- Alex Chen — shop developer and owner
- Priya Nair — designer, receipts
- Sam Lee — support and deploys

## Risks and issues

| Risk | Impact | Owner | Status |
|---|---|---|---|
| Repeat failures on old Safari | high | Priya Nair | Open |
| Saturday deploy window slips | medium | Sam Lee | Open |

## Decisions

- **28 Oct 2026** — Fix the retry before the receipt. *Why:* failed payments cost orders every day.
- **1 Nov 2026** — Retry twice, then fail loud. *Why:* a third retry never succeeds and hides the fault.

## Updates

- 2 Nov 2026: Thirteen Wave list upgrades still to do; chasing this week.
- 3 Nov 2026: Standup agreed the Saturday window; waiting on the host.
`;

const MEETING = `---
type: meeting
date: 2026-11-03
time: 10:00 AM
attendees: [Alex Chen, Priya Nair]
project: "[[Harbourline Cart Fix]]"
where: Teams
---

# 2026-11-03 Cart standup

About the [[Harbourline Cart Fix|cart fix]]: retry, receipts and the Saturday window.

## Agenda

- [x] Retry fix
- [x] Receipt review
- [ ] Saturday deploy window

## Actions

- [ ] Retry the failed payment twice — Priya Nair — due 2026-11-06
- [x] Book the room — Alex Chen
`;

const ALEX = `---
type: person
role: Shop developer
org: Harbourline Shop
email: alex@example.invalid
phone: 0400 111 222
---

# Alex Chen

Owns the [[Harbourline Cart Fix|cart fix]]. Wants the retry live by Friday.
`;

const DAILY = `# 4 November 2026

- [ ] Water the plants
- [x] Read the brief
- [ ] Chase the failed carts — Alex Chen 📅 2026-11-05
- [ ] Review receipt v2 — Priya Nair 📅 2026-11-04
`;

const INBOX = `# Inbox

- [ ] Call the bank about the card reader
- [ ] Price the PA hire — Priya Nair 📅 2026-11-09
- [ ] File the October receipts 📅 2026-11-06
`;
