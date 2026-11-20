// t152 every-control lib (9 Nov 2026): the shared half of the per-area control files
// (tests/t152-*.test.mjs). Boots the REAL renderer in headless Chromium against a REAL 3,000-note
// vault through the vault-controls harness, presses every control with real input, and judges each
// by what a person would see plus what landed in the files. Not a test itself: node --test skips it
// (no .test.mjs suffix).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startHarness } from './vault-controls-harness.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the 3,000-note vault ────────────────────────────────────────────────
// Their shape (ITEMS.md): Business, Me, Projects, People, Bills, Inbox, meetings. Made-up people
// and projects throughout. Hand-written anchors first (the names the area files navigate by), then
// generated bulk to exactly 3,000 .md files. Windows-safe names throughout.
const FIRST = ['Alex', 'Priya', 'Sam', 'June', 'Tom', 'Lucy', 'Mia', 'Jack', 'Ruby', 'Leo', 'Ava', 'Noah', 'Isla', 'Max', 'Ella', 'Hugo', 'Zoe', 'Felix', 'Nina', 'Oscar'];
const LAST = ['Chen', 'Nair', 'Ortega', 'Park', 'Bradley', 'Hammond', 'Kaur', 'Webb', 'Singh', 'Foster', 'Nguyen', 'Carter', 'Ellis', 'Baker', 'Reid', 'Cole', 'Marsh', 'Quinn', 'Sykes', 'Turner'];
const ROLES = ['Shop developer', 'Designer of the new receipts', 'Weekend manager at the museum', 'Bookkeeper for the shop', 'Electrician rewiring the back room', 'Caterer for Friday openings', 'Supplier rep for the till rolls', 'Market stall hand', 'Delivery driver', 'Relief manager'];
const PARAS = [
  'The shop was quiet on Tuesday morning, so there was time to go through the October invoices line by line and check the totals against the bank feed.',
  'Priya sent the receipt mock late in the evening with a note about the tax line, which still reads ten dollars too high on the October sample.',
  'The roster for November is nearly done; three Friday nights still need cover and Sam said he would ask around the weekend crew.',
  'Ordered the new receipt rolls and the spare till drawer key. The delivery is due Thursday, in time for the Friday rush.',
  'Went through the awning quote with June: twelve hundred dollars fitted, and ShadeCo can start the week after next if we pay the deposit now.',
  'The retry now fails twice before showing an error, which the shop tested on Saturday morning with twenty orders in a row and no drops.',
  'Counted the float twice and it still came up short by Monday afternoon, so the evening entries need checking against the dockets.',
  'The back room refit starts next week; the shelves arrive Tuesday and the sparky books out fast once the month turns.',
];
const JOBS = ['Ring the supplier about the invoice', 'Confirm the delivery run', 'Price the next fit-out stage', 'Book the courier for Friday', 'Chase the council permit', 'File the safety checklist', 'Measure the back room', 'Pay the deposit', 'Photograph the defects', 'Sign the handover', 'Water the plants', 'Renew the parking permit', 'File the council letter', 'Post the keys', 'Sharpen the pencils'];

export function writeT152Vault(dir) {
  mkdirSync(dir, { recursive: true });
  let seed = 20261109;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = (a) => a[rnd(a.length)];
  let made = 0;
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    if (rel.endsWith('.md')) made++;
  };
  const person = (i) => (i === 0 ? 'Alex Chen' : i === 1 ? 'Priya Nair' : `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`);

  // Anchors: the names the area files navigate by.
  w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---
type: project
status: active
health: on track
owner: Alex Chen
due: 2026-11-20
---
# Harbourline Cart Fix

## Summary

The shop's cart drops about one order in forty at payment. Fix the retry, then the receipt. See the [[Receipts spec]] for what v2 shows.

## What's next

- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05
- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06
- [ ] Send the receipt v2 for review — Alex Chen — due 2026-11-04

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Wave list | Alex Chen | in progress | Upgrade or chase the 13 still to do at 26 Oct |
| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |

## Key dates

- 2026-11-06: Retry fix live (milestone)
- 2026-11-20: Cart fix done (milestone)

## Decisions

- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)

## Risks

- Repeat failures on old Safari (owner: Priya Nair, level: medium)

## People

- Alex Chen (owner)
- Priya Nair
`);
  w('Projects/Harbourline Cart Fix/Notes/Kickoff.md', `---
type: note
tags: [harbourline, kickoff]
---
# Kickoff

Met with [[Alex Chen]] about the [[Harbourline Cart Fix|cart fix]]. The [[Receipts v2]] design is linked. See the [[Receipts spec]].

See also the [[2026-11-03 Cart standup]] notes.
`);
  w('Projects/Museum Late Shift/Museum Late Shift.md', `---
type: project
status: active
health: at risk
owner: Priya Nair
due: 2026-10-30
---
# Museum Late Shift

## Summary

Late opening every Friday. Behind on the roster.

## What's next

- [ ] Publish the November roster — Priya Nair — due 2026-10-28
- [x] Confirm the caterer — Priya Nair

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Roster | Priya Nair | at risk | Fill the last 3 Friday nights |

## Key dates

- 2026-10-28: November roster out (milestone)
`);
  w('People/Alex Chen.md', `---
type: person
role: Shop developer
email: alex.chen@example.invalid
---
# Alex Chen

Owns the [[Harbourline Cart Fix|cart fix]]. Wants the retry live by Friday.

## Notes

Prefers short meetings with an agenda sent the day before.
`);
  w('People/Priya Nair.md', `---
type: person
role: Designer
email: priya.nair@example.invalid
---
# Priya Nair

Designs receipts. Waiting on the [[Harbourline Cart Fix|cart fix]] review.
`);
  w('Meetings/2026-11-03 Cart standup.md', `---
type: meeting
date: 2026-11-03
attendees: [Alex Chen, Priya Nair]
project: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md
---
# 2026-11-03 Cart standup

## Agenda

- Retry fix
- Receipt review

## Actions

- [ ] Retry the failed payment twice — Priya Nair — due 2026-11-06
- [x] Book the room — Alex Chen

## Decisions

- Retry twice, then fail loud
`);
  w('Daily/2026-11-04.md', `# 4 November 2026

- [ ] Water the plants
- [x] Read the brief
`);
  w('Notes/Receipts v2.md', `---
tags: [design]
---
# Receipts v2

The new receipt. Linked from [[Harbourline Cart Fix]].
`);
  w('Inbox.md', `# Inbox

- [ ] Call the bank about the card reader
- [ ] A quote for the shop awning: $1,200 — decide by Friday
- Buy milk
`);
  w('Inbox/awning-quote.md', `# Awning quote

The awning quote is $1,200 from ShadeCo.
`);
  w('Templates/Standup.md', `# Standup

## Agenda

## Actions
`);
  w('Docs/Receipts spec.md', `---
type: doc
---
# Receipts spec

## Summary

The v2 receipt shows every line.

## Changes

- 2026-11-02: Added the tax line.
`);
  const billsHead = '| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |';
  const billsSep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const billsRows = [
    ['Harbour Internet', 'Bill', '89.00', 'Monthly', '2026-11-12', 'Phone and internet', 'Everyday', '', 'No', 'Active', '', ''],
    ['Streamly annual family plan renewal', 'Subscription', '169.99', 'Yearly', '2026-11-10', 'Subscriptions', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Power for the shop through October', 'Bill', '214.50', 'Monthly', '2026-11-20', 'Home and utilities', 'Everyday', '', 'No', 'Active', '', ''],
    ['Harbour Credit Card minimum for November', 'Bill', '150.00', 'Monthly', '2026-11-08', 'Loans and cards', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Phone for Alex and the shop spare', 'Bill', '45.00', 'Monthly', '2026-11-15', 'Phone and internet', 'Everyday', '', 'Yes', 'Active', '', ''],
  ];
  w('Bills/Bills.md', `---
type: bills-table
table: bills
version: 1
---
# Bills

One line per bill. You can read this file; the Money page reads it too.

${billsHead}
${billsSep}
${billsRows.map((b) => `| ${b.join(' | ')} |`).join('\n')}
`);
  w('Me/Finance/Bills.md', `---
type: bills-table
table: bills
version: 1
---
# Bills

One line per bill. You can read this file; the Money page reads it too.

${billsHead}
${billsSep}
${billsRows.map((b) => `| ${b.join(' | ')} |`).join('\n')}
`);

  // Generated people, projects, meetings: enough rows that every list,
  // filter and bulk control has something to work on.
  for (let i = 2; i < 30; i++) {
    const p = person(i);
    w(`People/${p}.md`, `---
type: person
role: ${ROLES[i % ROLES.length]}
email: ${p.toLowerCase().replace(/ /g, '.')}@example.invalid
---
# ${p}

${ROLES[i % ROLES.length]}. Works with [[Harbourline Cart Fix]] most weeks.

## Notes

Prefers short meetings with an agenda sent the day before.
`);
  }
  const projNames = ['Harbourline Cart Fix', 'Museum Late Shift'];
  for (let i = 2; i < 15; i++) {
    const name = `Job ${100 + i} ${pick(['Refit', 'Roster', 'Receipts', 'Roster review', 'Awning', 'Fit-out', 'Stocktake'])}`;
    projNames.push(name);
    const owner = person(i);
    w(`Projects/${name}/${name}.md`, `---
type: project
status: active
health: ${i % 3 === 0 ? 'at risk' : 'on track'}
owner: ${owner}
due: 2026-11-${10 + (i % 15)}
---
# ${name}

## Summary

${pick(PARAS)}

## What's next

- [ ] ${pick(JOBS)} ${100 + i} — ${owner} — due 2026-11-${10 + (i % 15)}
- [ ] ${pick(JOBS)} ${100 + i} — ${person(i + 1)}
- [x] Open the job ${100 + i}

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Main run | ${owner} | in progress | Keep the ${100 + i} work moving |

## Key dates

- 2026-11-${10 + (i % 15)}: Job ${100 + i} done (milestone)

## People

- ${owner} (owner)
`);
    for (let k = 0; k < 4; k++) {
      w(`Projects/${name}/Notes/Note ${k + 1} for job ${100 + i}.md`, `---
type: note
tags: [job${100 + i}]
---
# Note ${k + 1} for job ${100 + i}

${pick(PARAS)} See [[${name}]] and [[${person(i + k)}]].

- [ ] ${pick(JOBS)} for job ${100 + i} — due 2026-11-${10 + rnd(15)}
`);
    }
  }
  for (let i = 1; i <= 70; i++) {
    const day = 1 + (i % 27);
    const dd = `2026-10-${String(day).padStart(2, '0')}`;
    const a = person(i), b = person(i + 1);
    w(`Meetings/${dd} ${pick(['Standup', 'Review', 'Planning', 'Walkthrough', 'Sign-off'])} ${i}.md`, `---
type: meeting
date: ${dd}
attendees: [${a}, ${b}]
project: Projects/${projNames[i % projNames.length]}/${projNames[i % projNames.length]}.md
---
# ${dd} meeting ${i}

## Agenda

- The retry fix and whether it is ready for Friday
- Anything blocking the weekend roster

## Discussion

${pick(PARAS)}

## Actions

- [ ] ${pick(JOBS)} ${i} — ${a} — due 2026-11-${10 + (i % 15)}
- [x] Book the room — ${b}

## Decisions

- Retry twice, then fail loud
`);
  }
  for (let i = 5; i <= 30; i++) {
    const dd = `2026-10-${String(i).padStart(2, '0')}`;
    w(`Daily/${dd}.md`, `# ${i} October 2026

- [ ] ${pick(JOBS)} — ${person(i)}
- [x] Read the brief
`);
  }
  for (let i = 1; i <= 30; i++) {
    w(`Inbox/item-${String(i).padStart(2, '0')}-quote.md`, `# Quote ${i}

${pick(PARAS)}

- [ ] Decide on quote ${i} by Friday
`);
  }

  // Bulk: Business and Me fill to exactly 3,000 notes.
  const bulk = (area, i) => {
    const a = person(i), b = person(i + 3);
    const proj = projNames[i % projNames.length];
    const longTitle = i % 11 === 0 ? ` with the long follow-up from the Tuesday session and the Friday deadline` : '';
    // One note in ten carries an open task: a 3,000-note vault with 6,000
    // open tasks is nobody's shape (and the Tasks pass never ends).
    const tasks = i % 10 === 0
      ? `- [ ] ${pick(JOBS)} ${i} — ${b} — due 2026-11-${10 + (i % 15)}\n- [x] Read ${area.toLowerCase()} note ${i}\n`
      : '';
    return `# ${area} note ${i}${longTitle}

${pick(PARAS)} See [[${proj}]] and [[${a}]].

${pick(PARAS)}

${tasks}`;
  };
  let i = 1;
  for (; made < 3000; i++) {
    const area = i % 2 === 0 ? 'Business' : 'Me';
    w(`${area}/${area} note ${i}.md`, bulk(area, i));
  }
  return made;
}

// ── boot ─────────────────────────────────────────────────────────────
// One harness per area file, the big vault written over the small one and
// re-indexed before the page loads (the vault-three-sizes pattern).
export async function bootT152(log = () => {}) {
  // Fresh rows per run: incremental appends must not mix runs.
  if (process.env.T152_OUT) {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(process.env.T152_OUT, { force: true });
    } catch {}
  }
  const t0 = Date.now();
  const h = await startHarness();
  log(`harness up in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const t1 = Date.now();
  const { rmSync } = await import('node:fs');
  rmSync(h.vaultDir, { recursive: true, force: true });
  mkdirSync(h.vaultDir, { recursive: true });
  const n = writeT152Vault(h.vaultDir);
  log(`vault written: ${n} notes in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  const t2 = Date.now();
  await h.services.rescanAll();
  log(`rescanAll in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  const t3 = Date.now();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
  log(`page booted in ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  return h;
}

// ── navigation (the vault-three-sizes words) ─────────────────────────
export const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';

export async function clickWords(h, words, scope = '') {
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

/** clickWords with an exact label (a row's 'More for Inbox' must not eat the
 *  sidebar's own 'More'). */
export async function clickExact(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || '').replace(/\\\\s+/g, ' ').trim() === ${JSON.stringify(words)}));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}

export async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

export async function esc(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
}

export async function ctrlK(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await sleep(300);
}

/** Open a sidebar row, else its palette row (packs stay off: only shipped rows). */
export async function openRoom(h, name) {
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') {
    await sleep(700);
    return 'SIDEBAR';
  }
  const label = name === 'Graph' ? 'Open the graph' : name === 'Templates' ? 'Open the Templates page' : name;
  await ctrlK(h);
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) return 'NOPALETTE';
  await h.browser.send('Input.insertText', { text: label === name ? name : name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)})
      ?? rows.find((r) => (text(r, '.picker-label') || '').includes(${JSON.stringify(name)}));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  await sleep(700);
  return picked === 'CLICKED' ? 'PALETTE' : 'NOTFOUND';
}

export const H1 = (t) => `document.querySelector('main h1, .main h1')?.innerText?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(t)}`;
// PageHead pages (Notes, People): the h1 carries a live count, so the pin
// reads the name span (the sweep's lesson).
export const PAGENAME = (t) => `document.querySelector('main .nv-page-name')?.innerText?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(t)}`;

/** Press `words`, unfolding folded sections until it shows (6 tries): a pass
 *  that folded a section must not hide the next check's door. */
export async function clickUnfolded(h, words, scope = '') {
  for (let i = 0; i < 6; i++) {
    const at = await clickWords(h, words, scope);
    if (at === 'CLICKED') return 'CLICKED';
    if ((await clickWords(h, 'Show its lines', scope)) !== 'CLICKED') return at;
    await sleep(500);
  }
  return 'NOTFOUND';
}

/** Click words in any open menu (submenus nest: the first menu is not enough). */
export async function clickMenuItem(h, words) {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    for (const root of [...document.querySelectorAll('.menu, [role="menu"]')]) {
      const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        el.click();
        await new Promise((r) => setTimeout(r, 400));
        return 'CLICKED';
      }
    }
    return 'NOTFOUND';
  })()`);
}

export const MENUS_JS = `[...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2).length`;

/** More → item, the way a person goes; later labels are fallbacks. Groups fold
 *  to fit the window (shared/more-fit.ts), so a buried item goes through its
 *  group submenu. */
export async function viaMore(h, ...items) {
  const groups = ['Pages', 'Make and open', 'Find', 'Packs and kinds'];
  // The app's More lives in the nav sidebar (the more-pages lesson: a
  // document-wide 'More' click can hit a row's own More, and the sidebar may
  // sit in FILES mode with no More at all — FILES goes back to nav first).
  const openAppMore = async () => {
    if ((await clickExact(h, 'More', '.sidebar.left, aside')) === 'CLICKED') return true;
    await clickWords(h, 'FILES', '.sidebar.left, aside');
    await sleep(500);
    return (await clickExact(h, 'More', '.sidebar.left, aside')) === 'CLICKED';
  };
  for (const item of items) {
    await openAppMore();
    await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
    if ((await clickMenuItem(h, item)) === 'CLICKED') {
      await sleep(1200);
      return item;
    }
    for (const g of groups) {
      await esc(h);
      await openAppMore();
      await waitFor(h, `!!document.querySelector('.menu, [role="menu"]')`);
      if ((await clickMenuItem(h, g)) !== 'CLICKED') continue;
      await sleep(400);
      if ((await clickMenuItem(h, item)) === 'CLICKED') {
        await sleep(1200);
        return item;
      }
    }
    await esc(h);
  }
  return '';
}

/** A sidebar row, sidebar-scoped: an unscoped click can hit a same-named
 *  control in main (the Templates page's own 'Projects' chip once ate the
 *  project sweep's way home, and it swept Templates under project names). */
export const openSidebar = (h, name) => clickWords(h, name, '.sidebar.left, aside');

/** Switch one pack on through Settings › Packs, the way a person does. */
export async function switchPackOn(h, name) {
  await openSidebar(h, 'Settings');
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

// ── enumeration ──────────────────────────────────────────────────────
// The sweep's shape, kept small: stamp each visible control with a key,
// read its words and state. The ask bar and the top search stay out (their
// own jobs, as in the sweep); the note's own graph stays out (t151).
export const EXCLUDE = '.sas-askbar, .sas-askfloat, .top-search, .nj-local, .local-graph';
const Q = (key) => `[data-harness-id=${JSON.stringify(key)}]`;
export const QE = (key) => JSON.stringify(Q(key));

export const ENUM_JS = (scope) => `(() => {
  document.querySelectorAll('[data-harness-id]').forEach((e) => e.removeAttribute('data-harness-id'));
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
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
      if (el.closest('.cm-content')) continue;
      const w = words(el);
      const base = [el.tagName.toLowerCase(), w, el.type || '', el.getAttribute('aria-label') || ''].join('|');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const key = base + '#' + n;
      el.setAttribute('data-harness-id', key);
      const vv = el.value !== undefined ? String(el.value) : null;
      // The twin family: row controls share one mechanism (one tick box per
      // row), told apart only by row content — numbers and quoted names out,
      // so 500 ticks read as one family pressed 3 times, not 500 presses. A
      // field's words are its value, which the pass itself changes by typing:
      // keyed by its label instead, or one search box reads as a new control
      // on every keystroke, forever. The first class only: the rest is state
      // (on, today, overdue), and keying it would press every state of every
      // row's every control. Row containers (a div or span acting as the
      // row's button) drop words entirely: 500 rows opening peeks are one
      // mechanism, not one per wording; their nested controls keep theirs.
      const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean)[0] ?? '';
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const container = (tag === 'div' || tag === 'span') && role === 'button';
      const viewSource = (tag === 'button' || role === 'button') && /notes in this (folder|library)/i.test(w);
      const famKey = (tag === 'input' || tag === 'textarea' || tag === 'select')
        ? (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || cls || 'field')
        : container ? '' : viewSource ? 'view-source' : w.replace(/\\d[\\d,]*/g, '#').replace(/"[^"]*"/g, '"…"');
      const fam = [tag, role, el.type || '', cls, famKey].join('|');
      out.push({ key, base, fam, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', type: el.type || '', words: w, disabled: !!el.disabled, checked: el.getAttribute('aria-checked') ?? (el.checked !== undefined && /checkbox|radio/.test(el.type || '') ? String(el.checked) : null), value: vv === null ? null : vv.length + ':' + vv.slice(-24), sel: el.getAttribute('aria-selected') ?? el.getAttribute('aria-current') ?? ((typeof el.className === 'string' && /(^|\\s)(on|active|selected|is-on)(\\s|$)/.test(el.className)) ? 'on' : null), pressed: el.getAttribute('aria-pressed'), label: el.getAttribute('aria-label') });
    }
  }
  return out;
})()`;

export const enumControls = (h, scope = '') => h.browser.ev(ENUM_JS(scope));

// ── snapshots: what a person would see ───────────────────────────────
export const DIALOG_SEL = '.modal-backdrop, .modal, [role="dialog"], .slides';
export const SNAP_JS = `(() => {
  const hash = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
  const mainText = document.querySelector('main')?.innerText ?? '';
  const overlayText = [...document.querySelectorAll('.menu, [role="menu"], .overlay, ${DIALOG_SEL}')].map((e) => e.innerText ?? '').join('\\n');
  const forms = [...document.querySelectorAll('input, select, textarea')].map((el) => el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '0') : String(el.value ?? '')).join('\\n');
  return {
  head: document.querySelector('main h1, .main h1')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  mainLen: mainText.length,
  mainHash: hash(mainText),
  overlay: overlayText.length + ':' + hash(overlayText),
  forms: forms.length + ':' + hash(forms),
  modal: !!document.querySelector('${DIALOG_SEL}'),
  menu: !!document.querySelector('.menu, [role="menu"]'),
  peek: !!document.querySelector('.peek'),
  peekTitle: document.querySelector('.peek-title')?.innerText?.replace(/\\s+/g, ' ').slice(0, 50) ?? null,
  toast: document.querySelector('.toast, .toasts')?.innerText?.replace(/\\s+/g, ' ').slice(0, 100) ?? null,
  editor: !!document.querySelector('.cm-editor'),
  scroll: [window.scrollY, document.querySelector('.vscroll')?.scrollTop ?? -1, document.querySelector('.cm-scroller')?.scrollTop ?? -1, document.querySelector('.nv-page-scroll')?.scrollTop ?? -1].join(','),
  sel: [...document.querySelectorAll('.is-selected')].length + ':' + [...document.querySelectorAll('.is-selected')].map((e) => (e.getAttribute('data-mark') || e.getAttribute('data-path') || (e.innerText || '').slice(0, 12)).replace(/\\\\s+/g, ' ').slice(-28)).join('|').slice(0, 100),
  side: [Math.round(document.querySelector('.sidebar.left')?.getBoundingClientRect().width ?? -1), Math.round(document.querySelector('.sidebar.right, .rightside')?.getBoundingClientRect().width ?? -1), hash(document.querySelector('.sidebar.right, .rightside')?.innerText ?? '')].join(','),
  errors: window.__nvErrors.length,
  calls: window.__nvCalls.length,
  lastCall: window.__nvCalls.slice(-1)[0] ?? null,
  };
})()`;

export function diffSnap(a, b) {
  const d = [];
  for (const k of ['head', 'modal', 'menu', 'peek', 'peekTitle', 'toast', 'editor', 'overlay', 'forms', 'scroll', 'side', 'sel']) if (a[k] !== b[k]) d.push(`${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  if (a.mainLen !== b.mainLen) d.push(`main ${a.mainLen} → ${b.mainLen} chars`);
  else if (a.mainHash !== b.mainHash) d.push('main reworded/reordered');
  if (b.errors > a.errors) d.push(`page errors +${b.errors - a.errors}`);
  return d;
}

// Channels that reach outside the vault (the sweep's list): attempted, not proven.
export const EXTERNAL = new Set(['path:reveal', 'path:open-default', 'vault:reveal', 'vault:pick', 'project:open-file', 'project:show-file', 'project:open-folder', 'project:open-conversation', 'project:work', 'automations:open', 'automations:open-neuralspark', 'app:open-remote-computers', 'capture:show', 'capture:snip', 'capture:dictate', 'ai:chat', 'ai:chat-cancel', 'ai:attachment-text', 'models:test', 'dictation:start', 'dictation:status', 'dictation:prepare', 'recorder:begin', 'recorder:transcribe', 'window:zoom', 'window:own-zoom', 'edit:command', 'plugins:openFolder', 'import:csv-pick', 'site:open', 'assets:pick']);
// Calls so quiet they prove nothing (the sweep's list).
const QUIET = new Set(['state:save', 'state:load', 'window:chrome', 'errors:report']);


// ── files: what landed on disk ───────────────────────────────────────
// Size+mtime fingerprints (hashing 3,000 notes per control would crawl);
// changed files are named, and area files read the ones that matter.
export function fileMap(h) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p, r);
      else {
        try {
          const s = statSync(p);
          out.set(r, `${s.size}:${Math.round(s.mtimeMs)}`);
        } catch {}
      }
    }
  };
  try {
    walk(h.vaultDir, '');
  } catch {}
  return out;
}

export function diffFiles(a, b) {
  const changed = [];
  for (const [k, v] of b) if (a.get(k) !== v) changed.push(k);
  for (const k of a.keys()) if (!b.has(k)) changed.push(`${k} (gone)`);
  return changed;
}

export const readVault = (h, rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');

// ── real input ───────────────────────────────────────────────────────
/** Coverage measured again with the mouse on the point (t191: hover-revealed controls — Today's row actions show on
 *  hover — read covered whenever the mouse rests elsewhere, because the measure lands before the mouse does. A person
 *  moves the mouse first and the actions appear, so the probe does: move, let hover apply (180ms: past the reveal's
 *  own transition, under the hover previews' 280ms+ delays), and measure again. Null when clear; a dialog over the
 *  target stays covered, since hover never dismisses one. */
async function hoverRecheck(h, key, px, py) {
  const x = Math.round(px), y = Math.round(py);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(180);
  try {
    return await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return 'gone'; const at = document.elementFromPoint(${x}, ${y}); return at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null; })()`);
  } catch {
    return 'gone';
  }
}
export async function clickReal(h, key) {
  // The middle fragment, where its text is (the sweep's lesson): a wrapped
  // inline control's box centre can fall between its line fragments and
  // hit-test whatever sits there instead.
  try {
    const pt = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) return null; const rs = el.getClientRects(); let rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r; let px = rr.x + rr.width / 2, py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) { el.scrollIntoView({ block: 'center' }); const r2 = el.getBoundingClientRect(); const rs2 = el.getClientRects(); rr = rs2.length > 1 ? rs2[Math.floor(rs2.length / 2)] : r2; px = rr.x + rr.width / 2; py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return { unreachable: true }; } const x = Math.min(px, window.innerWidth - 2), y = Math.min(py, window.innerHeight - 2); const at = document.elementFromPoint(x, y); const covered = at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null; return { x, y, covered }; })()`);
    if (!pt) return 'gone';
    if (pt.unreachable) return 'unreached';
    // Covered means hands off (the tasks lesson: the old code clicked first
    // and reported covered after, so the stray click drove whatever dialog
    // sat over the target — a person sees the dialog and does not click
    // through it, so the probe does not). Hover-revealed controls get one
    // recheck with the mouse on them first (hoverRecheck).
    if (pt.covered) {
      const again = await hoverRecheck(h, key, pt.x, pt.y);
      if (again === 'gone') return 'gone';
      if (again) return 'covered:' + again;
    }
    const x = Math.round(pt.x), y = Math.round(pt.y);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(250);
    return 'clicked';
  } catch {
    return 'gone';
  }
}

/** A double-click with the real mouse (Inline values' gesture: a single click
 *  waits by design). The middle fragment, where its text is: a wrapped
 *  control's box centre can fall between its line fragments. */
export async function dblclickReal(h, key) {
  try {
    const pt = await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) return null; const rs = el.getClientRects(); let rr = rs.length > 1 ? rs[Math.floor(rs.length / 2)] : r; let px = rr.x + rr.width / 2, py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) { el.scrollIntoView({ block: 'center' }); const r2 = el.getBoundingClientRect(); const rs2 = el.getClientRects(); rr = rs2.length > 1 ? rs2[Math.floor(rs2.length / 2)] : r2; px = rr.x + rr.width / 2; py = rr.y + rr.height / 2; if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) return { unreachable: true }; } const x = Math.min(px, window.innerWidth - 2), y = Math.min(py, window.innerHeight - 2); const at = document.elementFromPoint(x, y); const covered = at && at !== el && !el.contains(at) && !(at.contains(el) && /^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(at.tagName)) ? ((at.innerText || at.getAttribute('aria-label') || at.tagName) + '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null; return { x, y, covered }; })()`);
    if (!pt) return 'gone';
    if (pt.unreachable) return 'unreached';
    if (pt.covered) {
      const again = await hoverRecheck(h, key, pt.x, pt.y);
      if (again === 'gone') return 'gone';
      if (again) return 'covered:' + again;
    }
    const x = Math.round(pt.x), y = Math.round(pt.y);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(120);
    for (const n of [1, 2]) {
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
    }
    await sleep(350);
    return 'dblclick';
  } catch {
    return 'gone';
  }
}

export async function typeInto(h, key, text) {
  await h.browser.ev(`(() => { const el = document.querySelector(${QE(key)}); if (el) { el.scrollIntoView({ block: 'nearest' }); el.focus(); } })()`);
  await sleep(150);
  await h.browser.send('Input.insertText', { text });
  await sleep(250);
}

export async function setSelect(h, key) {
  return h.browser.ev(`(() => {
    const el = document.querySelector(${QE(key)});
    if (!el || el.tagName !== 'SELECT') return 'notselect';
    if (el.options.length < 2) return 'one-option';
    el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set:' + el.options[el.selectedIndex].text.slice(0, 30);
  })()`);
}

export const OVERLAY_SEL = '.menu, [role="menu"], .overlay, .picker, .smodal';
export const DIALOGS_JS = `[...document.querySelectorAll('${DIALOG_SEL}, .picker, .smodal')].filter((e) => e.getBoundingClientRect().width > 2).length`;
export const OVMENUS_JS = `[...document.querySelectorAll('.menu, [role="menu"]')].filter((e) => e.getBoundingClientRect().width > 2).length`;
export async function dismiss(h) {
  for (let i = 0; i < 4; i++) {
    const open = await h.browser.ev(`!!document.querySelector('${OVERLAY_SEL}, ${DIALOG_SEL}')`);
    if (!open) return true;
    const closed = await h.browser.ev(`(async () => {
      const roots = [...document.querySelectorAll('${DIALOG_SEL}, .menu, [role="menu"], .overlay, .picker, .smodal')].filter((e) => e.getBoundingClientRect().width > 2);
      const root = roots[roots.length - 1];
      if (!root) return false;
      const btns = [...root.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 2);
      const out = btns.find((e) => /^(cancel|close|done|no)$/i.test((e.innerText || '').trim()) || e.getAttribute('aria-label') === 'Close');
      if (out) { out.click(); return true; }
      return false;
    })()`);
    if (!closed) {
      await h.browser.ev(`(() => { const bd = [...document.querySelectorAll('.modal-backdrop, .overlay')].find((e) => e.getBoundingClientRect().width > 2 && e.querySelector('.modal, [role="dialog"]')); if (bd) bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`);
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    }
    await sleep(400);
  }
  return !(await h.browser.ev(`!!document.querySelector('${OVERLAY_SEL}, ${DIALOG_SEL}')`));
}

// ── probe one control ────────────────────────────────────────────────
// Real input, then what a person would see plus what landed in the files.
// Menus and dialogs are the caller's: the probe reports them, the sweep
// presses their rows.
export async function probe(h, c) {
  const ev = h.browser.ev;
  if (c.disabled) return { verdict: 'disabled', effect: 'off (disabled)', diffs: [], files: [] };
  if (c.tag === 'input' && c.type === 'file') {
    await clickReal(h, c.key);
    return { verdict: 'external', effect: 'opens the OS file picker (nothing observable headless)', diffs: [], files: [] };
  }
  await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (el) el.scrollIntoView({ block: 'nearest' }); })()`);
  await sleep(150);
  await ev(`(() => { try { (document.activeElement instanceof HTMLElement) && document.activeElement.blur(); window.getSelection()?.removeAllRanges(); } catch {} })()`);
  let before = await ev(SNAP_JS);
  if (before.toast) {
    await waitFor(h, `![...document.querySelectorAll('.toast, .toasts')].some((e) => e.getBoundingClientRect().width > 2 && (e.innerText || '').trim())`, 6000);
    before = await ev(SNAP_JS);
  }
  // A peek left open by an earlier probe covers the page's own controls (the
  // sweep's lesson): a person closes what they finished with, so the probe
  // does — except when the control sits inside the peek itself.
  const peekSt = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); return { in: !!el?.closest('.peek'), open: !!document.querySelector('.peek') }; })()`).catch(() => ({ in: true, open: false }));
  if (!peekSt.in && peekSt.open) {
    await ev(`(() => { const x = document.querySelector('.peek [aria-label="Close"]'); if (x) x.click(); })()`).catch(() => {});
    await sleep(300);
    if (await ev(`!!document.querySelector('.peek')`).catch(() => false)) {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await sleep(300);
    }
    before = await ev(SNAP_JS);
  }
  const fpBefore = fileMap(h);
  // A button may open the OS file picker through a hidden file input (Import's
  // 'Bring files in'): headless that shows nothing, so activations are counted
  // page-side (installed once; a reload re-arms it) and read after the press.
  const fp0 = await ev(`(() => { if (window.__nvFileClicks !== 0 && !window.__nvFileClicks) { window.__nvFileClicks = 0; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') window.__nvFileClicks++; return orig.call(this); }; } return window.__nvFileClicks; })()`).catch(() => -1);
  // Server-side calls (the sweep's ledger: channel names, not the page's
  // dotted paths — 'capture:show', not 'capture.show').
  const rpcBefore = h.services.calls.length;
  // A shown Inline value (not empty, not already a field): a single click
  // waits by design, so it is double-clicked; an empty one adds on one
  // click, like everything else.
  const flags = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); const u = el?.href ?? ''; return { href: /^(mailto:|tel:)/i.test(u) ? u.slice(0, 60) : '', inline: !!el && el.classList.contains('pj-ed') && !el.classList.contains('pj-ed-empty') && !el.querySelector('input, textarea, select') }; })()`).catch(() => ({ href: '', inline: false }));
  const hrefOut = flags.href;
  const inlineDbl = flags.inline;
  let how = '';
  if (c.tag === 'select') {
    how = await setSelect(h, c.key);
    await sleep(350);
  } else if ((c.tag === 'input' && /^(text|search|number|email|url|password|date|time)$/.test(c.type || 'text')) || c.tag === 'textarea') {
    await typeInto(h, c.key, 'harbour');
    how = 'typed';
  } else if (c.tag === 'input' && /^(range|color)$/.test(c.type)) {
    how = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (!el) return 'gone'; el.focus(); el.value = el.type === 'range' ? String((Number(el.min || 0) + Number(el.max || 100)) / 2) : '#7fb069'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'set'; })()`);
    await sleep(350);
  } else if (inlineDbl) {
    how = await dblclickReal(h, c.key);
  } else {
    how = await clickReal(h, c.key);
  }
  if (how === 'gone') return { verdict: 'gone', effect: 'went away before the press', diffs: [], files: [] };
  if (how === 'unreached') return { verdict: 'unreachable', effect: 'onscreen but never under the pointer', diffs: [], files: [] };
  if (how.startsWith('covered:')) return { verdict: 'covered', effect: `another control sits over it (${how.slice(8)})`, diffs: [], files: [] };
  await sleep(400);
  const after = await ev(SNAP_JS);
  const diffs = diffSnap(before, after);
  // The control's own state (a toggled aria-pressed, a swapped aria-label, a
  // flipped selection — the sweep's lesson: without this, each reads dead).
  const stateAfter = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (!el) return 'gone'; const chk = el.getAttribute('aria-checked') ?? (el.checked !== undefined && /checkbox|radio/.test(el.type || '') ? String(el.checked) : ''); const vv = el.value !== undefined ? String(el.value) : ''; const sel = el.getAttribute('aria-selected') ?? el.getAttribute('aria-current') ?? ((typeof el.className === 'string' && /(^|\\s)(on|active|selected|is-on)(\\s|$)/.test(el.className)) ? 'on' : ''); return [chk, el.value !== undefined ? vv.length + ':' + vv.slice(-24) : '', el.getAttribute('aria-pressed') ?? '', el.getAttribute('aria-label') ?? '', sel].join('~'); })()`);
  const stateBefore = [c.checked ?? '', c.value ?? '', c.pressed ?? '', c.label ?? '', c.sel ?? ''].join('~');
  if (stateAfter !== 'gone' && stateAfter !== stateBefore) diffs.push(`own state ${JSON.stringify(stateBefore)} → ${JSON.stringify(stateAfter)}`);
  if (how === 'dblclick') {
    // Escape puts the value back as it was (the verdict already saw the
    // field open). Commits are proven by edit-where-shown; a change left
    // behind here would pollute later rounds.
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await sleep(300);
    const stuck = await ev(`!!document.querySelector('.pj-ed-input, .pj-date-input')`);
    if (stuck) {
      await ev(`(document.activeElement instanceof HTMLElement) && document.activeElement.blur()`);
      await sleep(300);
    }
  }
  const files = diffFiles(fpBefore, fileMap(h));
  if (files.length) diffs.push(`files: ${files.slice(0, 4).join(', ')}${files.length > 4 ? ` +${files.length - 4} more` : ''}`);
  const errRe = /TypeError|ReferenceError|SyntaxError|Cannot read propert|not a function|is not defined|Unexpected token/i;
  if (diffs.some((d) => d.startsWith('toast:') && errRe.test(d))) return { verdict: 'error', effect: `a raw exception shows: ${after.toast}`, diffs, files, how };
  if (after.errors > before.errors) {
    const msg = await ev(`window.__nvErrors.slice(-1)[0] ?? ''`).catch(() => '');
    return { verdict: 'error', effect: `the page threw: ${String(msg).slice(0, 120)}`, diffs, files, how };
  }
  // Overlays are the caller's (the sweep's shape): the verdict judges the
  // press, and openedMenu/openedDialog say what to sweep next — a menu always
  // changes the snapshot, so a verdict-before-diffs could never fire.
  const opened = (a) => ({ openedMenu: a.menu && !before.menu, openedDialog: a.modal && !before.modal });
  if (diffs.length) {
    const rpcBits = h.services.calls.slice(rpcBefore).map((x) => x.method).filter((m) => !QUIET.has(m));
    if (rpcBits.length) diffs.push(`rpc ${[...new Set(rpcBits)].slice(0, 3).join(',')}`);
    return { verdict: 'works', effect: diffs.slice(0, 3).join('; '), diffs, files, how, ...opened(after) };
  }
  if (hrefOut) return { verdict: 'external', effect: `hands to the mail app (${hrefOut})`, diffs, files, how, ...opened(after) };
  const rpc = h.services.calls.slice(rpcBefore).map((x) => x.method).filter((m) => !QUIET.has(m));
  if (rpc.some((m) => EXTERNAL.has(m))) return { verdict: 'external', effect: `attempted ${[...new Set(rpc)].join(',')} (outside the vault; not proven)`, diffs, files, how, ...opened(after) };
  if (rpc.length) return { verdict: 'works-rpc', effect: `rpc ${[...new Set(rpc)].join(',')} but nothing visible changed`, diffs, files, how, ...opened(after) };
  // The press reached a hidden file input (the OS picker opened headless).
  const fp1 = await ev(`window.__nvFileClicks ?? -1`).catch(() => -1);
  if (fp0 >= 0 && fp1 > fp0) return { verdict: 'external', effect: 'opens the OS file picker (nothing observable headless)', diffs, files, how, ...opened(after) };
  // An already-on tab, switch or option: pressing it again rightly does nothing.
  const noOpOk = c.sel != null || (c.pressed === 'true' && !/switch|checkbox/.test(c.role || '') && c.type !== 'checkbox') || ((c.role === 'radio' || c.role === 'menuitemradio') && c.checked === 'true');
  if (noOpOk) return { verdict: 'no-op-ok', effect: 'already on; pressing it again rightly does nothing', diffs, files, how, ...opened(after) };
  // A field takes the focus and waits for words: nothing changing on a press is what it should do.
  if (c.tag === 'input' || c.tag === 'textarea' || c.tag === 'select') return { verdict: 'field', effect: how === 'typed' ? 'takes the focus and the words' : 'takes the focus', diffs, files, how, ...opened(after) };
  // Last resort before DEAD: the keyboard. A row's title stops the mouse by
  // design (single click waits for the double), but Enter on the row itself
  // opens it — a person tabs and Enters, so the probe does.
  if (c.tag !== 'input' && c.tag !== 'textarea' && c.tag !== 'select') {
    const focused = await ev(`(() => { const el = document.querySelector(${QE(c.key)}); if (!el) return false; el.focus(); return true; })()`).catch(() => false);
    if (focused) {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(400);
      const afterK = await ev(SNAP_JS);
      const diffsK = diffSnap(before, afterK);
      const filesK = diffFiles(fpBefore, fileMap(h));
      if (filesK.length) diffsK.push(`files: ${filesK.slice(0, 4).join(', ')}${filesK.length > 4 ? ` +${filesK.length - 4} more` : ''}`);
      if (afterK.errors > before.errors) {
        const msg = await ev(`window.__nvErrors.slice(-1)[0] ?? ''`).catch(() => '');
        return { verdict: 'error', effect: `the page threw: ${String(msg).slice(0, 120)}`, diffs: diffsK, files: filesK, how };
      }
      if (diffsK.length) return { verdict: 'works', effect: `${diffsK.slice(0, 3).join('; ')} (via the keyboard)`, diffs: diffsK, files: filesK, how, ...opened(afterK) };
      const rpcK = h.services.calls.slice(rpcBefore).map((x) => x.method).filter((m) => !QUIET.has(m));
      if (rpcK.some((m) => EXTERNAL.has(m))) return { verdict: 'external', effect: `attempted ${[...new Set(rpcK)].join(',')} (via the keyboard; outside the vault; not proven)`, diffs: diffsK, files: filesK, how, ...opened(afterK) };
      if (rpcK.length) return { verdict: 'works-rpc', effect: `rpc ${[...new Set(rpcK)].join(',')} via the keyboard`, diffs: diffsK, files: filesK, how, ...opened(afterK) };
    }
  }
  return { verdict: 'DEAD', effect: 'nothing happened', diffs, files, how, openedMenu: false, openedDialog: false };
}

// ── rows ─────────────────────────────────────────────────────────────
export function makeRows() {
  return [];
}

export function record(rows, area, page, words, tag, effect, verdict, files = []) {
  rows.push({ area, page, words: String(words || '(no words)').slice(0, 60), tag, effect: String(effect).slice(0, 200), verdict, files: files.slice(0, 6) });
  if (process.env.T152_VERBOSE) console.log(`[${area} ${page}] ${tag} ${JSON.stringify(String(words).slice(0, 50))} → ${verdict} (${String(effect).slice(0, 80)})`);
  // Incremental rows: a pass cut short still leaves what it pressed.
  const out = process.env.T152_OUT;
  if (out) {
    try {
      mkdirSync(path.dirname(out), { recursive: true });
      if (!existsSync(out)) appendFileSync(out, `# Vault controls t152: every element and its result\n\nProbed ${new Date().toISOString()} on the 3,000-note vault (tests/t152-*.test.mjs).\n\n| Area › page | Control | Effect | Files | Verdict |\n|---|---|---|---|---|\n`);
      const r = rows[rows.length - 1];
      const cell = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
      appendFileSync(out, `| ${r.area} › ${r.page} | ${cell(r.words)} (${r.tag}) | ${cell(r.effect)} | ${cell(r.files.join(', '))} | ${r.verdict} |\n`);
    } catch {}
  }
}

export function writeRows(rows, file) {
  if (!file) return;
  const lines = ['# Vault controls t152: every element and its result', '', `Probed ${new Date().toISOString()} on the 3,000-note vault (tests/t152-*.test.mjs).`, ''];
  let cur = '';
  for (const r of rows) {
    const head = `${r.area} › ${r.page}`;
    if (head !== cur) {
      cur = head;
      lines.push(`## ${cur}`, '', '| Control | Effect | Files | Verdict |', '|---|---|---|---|');
    }
    const cell = (s) => String(s).replace(/\|/g, '/');
    lines.push(`| ${cell(r.words)} (${r.tag}) | ${cell(r.effect)} | ${cell(r.files.join(', '))} | ${r.verdict} |`);
  }
  lines.push('');
  writeFileSync(file, lines.join('\n'));
}

// ── sweep one page ───────────────────────────────────────────────────
// One pass over every visible control; a control that opens a menu or a
// dialog gets that level's rows pressed too, then the page re-opens and
// the pass goes on. `skip` holds words never pressed (other jobs' doors).
// Bulk-duplicating controls are never pressed blind: one explicit check per
// target kind proves the mechanism (see the notes file), while a blind press
// on a 1,400-note folder would bury the pass in copies.
const SKIP_ALWAYS = new Set(['Make a copy']);

export async function sweepPage(h, rows, area, page, { open, stayJS = '', scope = '', skip = [], positions = [] } = {}) {
  const ev = h.browser.ev;
  const skipped = new Set([...SKIP_ALWAYS, ...skip]);
  const done = new Set();
  let pos = 0;
  const reopen = async () => {
    await dismiss(h).catch(() => {});
    await open();
    if (stayJS) {
      try {
        if (!(await ev(stayJS))) {
          await open();
          if (!(await ev(stayJS))) {
            // Last resort: reload the page (the vault and the services keep
            // their state; overlays and stuck UI do not) and open once more.
            // Sweeping the wrong page under this one's name helps no one.
            await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
            await waitFor(h, `!!document.querySelector('.app')`, 30000);
            await sleep(1500);
            await open();
          }
        }
      } catch {}
    }
  };
  // A dialog scope keeps its one dialog (the sweep's lesson: dismiss() would
  // close the swept subject itself); menus and second dialogs still go.
  const dialogSubject = /modal|dialog|picker|slides|smodal/i.test(scope || '');
  // Twin families (one tick box per row): 3 instances pressed proves the
  // mechanism; the rest are named once, not pressed one by one. Shared with
  // the page's overlays: 'New note' in folder A's menu and folder B's menu
  // is the same mechanism, not 3 presses each.
  const fam = { count: new Map(), noted: new Set() };
  const famCount = fam.count;
  const famNoted = fam.noted;
  for (let round = 0; round < 400; round++) {
    const ov0 = await ev(`(() => ({ menus: ${OVMENUS_JS}, dialogs: ${DIALOGS_JS} }))()`).catch(() => ({ menus: 0, dialogs: 0 }));
    if (ov0.menus > 0 || (dialogSubject ? ov0.dialogs > 1 : ov0.dialogs > 0)) await dismiss(h).catch(() => {});
    if (dialogSubject && ov0.dialogs === 0) await reopen();
    if (stayJS && !(await ev(stayJS).catch(() => false))) await reopen();
    const all = await ev(ENUM_JS(scope)).catch(() => []);
    const ctrls = all.filter((c) => !skipped.has(c.words) && !done.has(c.base) && (famCount.get(c.fam) ?? 0) < 3);
    if (!ctrls.length) {
      for (const c of all) {
        if ((famCount.get(c.fam) ?? 0) >= 3 && !famNoted.has(c.fam)) {
          famNoted.add(c.fam);
          const twins = all.filter((x) => x.fam === c.fam && !done.has(x.base)).length;
          if (twins > 0) record(rows, area, page, `${c.words} (+${twins} twins)`, c.tag, 'the same mechanism; 3 instances pressed, the twins share it', 'twins');
        }
      }
      // Virtualized content (the note's foot) renders on scroll: each
      // position script runs once the pass exhausts, then the pass goes on.
      if (pos >= positions.length) return;
      await ev(positions[pos++]).catch(() => {});
      await sleep(600);
      continue;
    }
    const c = ctrls[0];
    done.add(c.base);
    famCount.set(c.fam, (famCount.get(c.fam) ?? 0) + 1);
    const r = await probe(h, c);
    if (r.verdict === 'gone') {
      record(rows, area, page, c.words, c.tag, r.effect, 'gone');
      continue;
    }
    if (r.openedMenu || r.openedDialog) {
      record(rows, area, page, c.words, c.tag, r.effect, r.verdict, r.files);
      const scope2 = r.openedDialog ? DIALOG_SEL : '.menu, [role="menu"]';
      const sub = r.openedDialog ? 'dialog' : 'menu';
      await sweepOverlay(h, rows, area, `${page} › ${sub}`, scope2, stayJS, reopen, [c.words], fam);
      await reopen();
      continue;
    }
    if (stayJS && !(await ev(stayJS).catch(() => true))) {
      record(rows, area, page, c.words, c.tag, r.effect === 'nothing happened' ? 'leaves the page' : `${r.effect || 'acts'}; left the page`, r.verdict === 'DEAD' ? 'works' : r.verdict, r.files);
      await reopen();
      continue;
    }
    record(rows, area, page, c.words, c.tag, r.effect, r.verdict, r.files);
    await dismiss(h).catch(() => {});
  }
  record(rows, area, page, 'the pass capped at 400 rounds', 'sweep', 'controls never pressed remain', 'capped');
}

/** Press every control in an open menu or dialog, once each. `chain` holds the
 *  words that re-open this level (top opener, then submenu parents): a submenu
 *  that opens joins the chain, so a navigation re-opens the whole path and no
 *  buried row is silently skipped. */
async function sweepOverlay(h, rows, area, page, scope, stayJS, reopenPage, chain, fam = null) {
  const ev = h.browser.ev;
  const reopenOverlay = async () => {
    // Shut first (the import lesson: synthetic clicks fire through an open
    // modal, so re-clicking the chain without shutting stacks a second
    // dialog over the first and its rows read covered). Then the chain:
    // the opener may be a page button (a dialog's) or a menu row (a
    // submenu's) — words survive, keys do not.
    await dismiss(h).catch(() => {});
    await sleep(300);
    for (const w of chain) {
      await clickWords(h, w).catch(() => {});
      await sleep(300);
    }
  };
  const done = new Set();
  const famCount = fam ? fam.count : new Map();
  const famNoted = fam ? fam.noted : new Set();
  // A wizard's rows each advance its multi-step flow and the page with it: 3
  // reopens and the level hands to its explicit end-to-end check (blind
  // pressing would run 50 sources without ever finishing one view). Same when
  // the steps advance without ever completing: 6 changing dialogs in a row.
  let reopens = 0;
  let lastOverlay = '';
  let advRounds = 0;
  for (let round = 0; round < 120; round++) {
    let items = await ev(ENUM_JS(scope)).catch(() => []);
    let vis = items.filter((c) => !done.has(c.base) && (famCount.get(c.fam) ?? 0) < 3);
    if (!vis.length) {
      await reopenOverlay().catch(() => {});
      await sleep(400);
      items = await ev(ENUM_JS(scope)).catch(() => []);
      vis = items.filter((c) => !done.has(c.base) && (famCount.get(c.fam) ?? 0) < 3);
      if (!vis.length) {
        for (const c of items) {
          if ((famCount.get(c.fam) ?? 0) >= 3 && !famNoted.has(c.fam)) {
            famNoted.add(c.fam);
            const twins = items.filter((x) => x.fam === c.fam && !done.has(x.base)).length;
            if (twins > 0) record(rows, area, page, `${c.words} (+${twins} twins)`, c.tag, 'the same mechanism; 3 instances pressed, the twins share it', 'twins');
          }
        }
        return;
      }
    }
    const c = vis[0];
    done.add(c.base);
    famCount.set(c.fam, (famCount.get(c.fam) ?? 0) + 1);
    const menusBefore = await ev(MENUS_JS).catch(() => 0);
    const r = await probe(h, c);
    if (r.verdict === 'gone') {
      record(rows, area, page, c.words, c.tag, r.effect, 'gone');
      continue;
    }
    // The level's rows may unmount on the press (a wizard step advances, and
    // the earlier step's rows are gone for good): the twins are noted from
    // this round's own enumeration the moment the press caps the family, not
    // from whatever happens to be showing when the pass ends.
    if ((famCount.get(c.fam) ?? 0) >= 3 && !famNoted.has(c.fam)) {
      famNoted.add(c.fam);
      const twins = items.filter((x) => x.fam === c.fam && !done.has(x.base)).length;
      if (twins > 0) record(rows, area, page, `${c.words} (+${twins} twins)`, c.tag, 'the same mechanism; 3 instances pressed, the twins share it', 'twins');
    }
    if (r.openedDialog) {
      record(rows, area, page, c.words, c.tag, r.effect, r.verdict, r.files);
      await sweepOverlay(h, rows, area, `${page} › dialog`, DIALOG_SEL, stayJS, reopenPage, [...chain, c.words], fam);
      // Dismiss only (the tasks lesson: re-opening the swept dialog here
      // left a fresh wizard sitting over the page, covering its controls —
      // the parent level re-opens on demand when its own subject is gone).
      await dismiss(h).catch(() => {});
      await sleep(400);
      continue;
    }
    const menusAfter = await ev(MENUS_JS).catch(() => 0);
    if (menusAfter > menusBefore) {
      chain.push(c.words);
      record(rows, area, page, c.words, c.tag, 'opens a submenu', 'works', r.files);
      continue;
    }
    if (r.openedMenu) {
      record(rows, area, page, c.words, c.tag, r.effect, r.verdict, r.files);
      await sweepOverlay(h, rows, area, `${page} › menu`, '.menu, [role="menu"]', stayJS, reopenPage, [...chain, c.words], fam);
      await dismiss(h).catch(() => {});
      await reopenOverlay().catch(() => {});
      await sleep(400);
      continue;
    }
    const stay = stayJS ? await ev(stayJS).catch(() => true) : true;
    if (!stay) {
      record(rows, area, page, c.words, c.tag, r.effect === 'nothing happened' ? 'leaves the page' : `${r.effect || 'acts'}; left the page`, r.verdict === 'DEAD' ? 'works' : r.verdict, r.files);
      if (++reopens > 3) {
        record(rows, area, page, c.words, c.tag, 'a multi-step flow; its explicit check finishes one end to end', 'flow', r.files);
        await dismiss(h).catch(() => {});
        return;
      }
      await reopenPage().catch(() => {});
      await reopenOverlay().catch(() => {});
      await sleep(400);
      continue;
    }
    // Steps advancing without completing (the source chooser is back again):
    // a wizard, not a form — hand to its explicit check after 6.
    const ovNow = await ev(`[...document.querySelectorAll('.menu, [role="menu"], .overlay, ${DIALOG_SEL}')].map((e) => e.innerText ?? '').join('\\n').length + ':' + ${DIALOGS_JS}`).catch(() => '');
    if (ovNow && ovNow === lastOverlay) {
      advRounds = 0;
    } else if (ovNow) {
      lastOverlay = ovNow;
      if (++advRounds > 6 && /modal|dialog|picker|slides|smodal/i.test(scope || '')) {
        record(rows, area, page, c.words, c.tag, 'a multi-step flow; its explicit check finishes one end to end', 'flow', r.files);
        await dismiss(h).catch(() => {});
        return;
      }
    }
    record(rows, area, page, c.words, c.tag, r.effect, r.verdict, r.files);
  }
  record(rows, area, page, 'the level capped at 120 rounds', 'sweep', 'controls never pressed remain', 'capped');
}

// ── verdict ──────────────────────────────────────────────────────────
export function assertArea(rows, area, outFile) {
  writeRows(rows, outFile || process.env.T152_OUT || '');
  const mine = rows.filter((r) => r.area === area);
  if (!mine.length) throw new Error(`${area}: the pass pressed nothing (its door never landed)`);
  const bad = mine.filter((r) => ['DEAD', 'error', 'covered', 'unreachable', 'capped'].includes(r.verdict));
  if (bad.length) throw new Error(`${area}: dead or broken controls:\n${bad.map((r) => `  - ${r.page}: ${r.words} [${r.verdict}] ${r.effect}`).join('\n')}`);
  return mine;
}

// ── pictures ─────────────────────────────────────────────────────────
// PNG at the three sizes (RULES: never JPEG, deviceScaleFactor 2).
export async function shot(h, file, w, Hp) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: Hp, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
  const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync: w0, mkdirSync: m0 } = await import('node:fs');
  m0(path.dirname(file), { recursive: true });
  w0(file, Buffer.from(d.result.data, 'base64'));
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
}
