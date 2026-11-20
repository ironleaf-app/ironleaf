// node --test tests/meeting-minutes-doors.test.mjs — the minutes card on the real meeting page
// (6 Nov 2026: p3-minutes-right mounted views/MeetingMinutes.tsx only in views/NoteView.tsx, but a
// meeting opened from the Meetings rail lands on the module's own page, with no .note-view and no
// Make the minutes button). The card, the word check and the gaps offer appear for a meeting with a
// transcript wherever a meeting opens, once each, beneath the recording, through the one component.
// Driven through the live harness (tests/vault-controls-harness.mjs) with real clicks: the Meetings
// rail and Today's meeting row, including a meeting hidden with its folder. Made-up
// cart-fix meetings only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// A standup today with a full transcript and no minutes yet: the Make button's door.
const STANDUP = (today) => `---
type: meeting
date: ${today}
attendees: [Alex Chen, Priya Nair]
project: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md
---

# ${today} Cart retry standup

## Agenda

- The retry fix
- The receipts review

## Notes

The coffee queue was long again at lunch.

## Actions

- [ ] Chase the failed payments — Priya Nair — by Friday
- [ ] Send the receipt v2 for review — Alex Chen

## Decisions

- Retry twice, then fail loud

## Transcript

> [!quote]- Transcript · 12 minutes
> **0:00** *You:* Morning all, let us start with the cart and the retry.
>
> **0:45** *Others:* Priya Nair says the retry still fails on Fridays.
>
> **2:10** *You:* The receipt printer still needs a quote from the supplier.
>
> **4:20** *Others:* Alex Chen will chase the failed payments tomorrow.
>
> **6:05** *You:* We will send the receipt v2 for review this week.
>
> **9:40** *Others:* The retry ships before the receipts review.
`;

// A receipts review yesterday with minutes already made, a supplier name spelt two ways, and one thin
// stretch kept on the saved recording: the word check's and the gaps offer's door (6 Nov 2026, n4
// reason change: said-once Tessaly with nothing near stays quiet, so the check's door is the two-ways pair).
const REVIEW = (yesterday) => `---
type: meeting
date: ${yesterday}
attendees: [Alex Chen, Priya Nair]
project: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md
---

# ${yesterday} Receipts review

## Summary

Alex and Priya went over the receipt printer quote. The retry ships first.

## Key figures

- $4,200 — Printer quote
- 40 — Orders a day

## Decisions

- Keep the current printer supplier

## Actions

- [ ] Ask the supplier for a printer quote — Alex Chen

## Open

- Whether the receipt printer arrives before opening.

## Discussion

### Printer quote

The supplier quotd four thousand two hundred. Priya will chase the paperwork.

## Transcript

![[receipts-review.opus]]

> [!quote]- Transcript · 12 minutes
> **0:00** *You:* Morning all, let us start with the receipts.
>
> **0:30** *Others:* We will ask Tessaly about the receipt printer.
>
> **1:15** *You:* Merricks sent the printer quote this morning.
>
> **2:00** *Others:* Merrick's quote covers the printer and the paper bags.
`;

// A sensors review yesterday with minutes made and no recording kept: the word check's rows as drawn —
// a name close to a known word (Nairr: the likeliest spelling prefilled), an initialism said three times alike
// (PCR: one row saying so), and a steady word said twice (Harbourline: no row). Its own words never leak into the
// other fixtures' lists (earlier meetings lend corrected words only, never raw transcript spellings).
const CHECK = (yesterday) => `---
type: meeting
date: ${yesterday}
attendees: [Alex Chen, Priya Nair]
project: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md
---

# ${yesterday} Oven sensors review

## Summary

Alex and Priya went over the sensor check. The panel still needs a look.

## Decisions

- Check the sensors before Friday

## Actions

- [ ] Check the cold room sensors — Alex Chen

## Open

- Whether the sensors are all online.

## Discussion

### Sensors

The cold room sensors were all online.

## Transcript

> [!quote]- Transcript · 4 minutes
> **0:00** *You:* Morning all, Priya Nairr will start with the cart.
>
> **0:40** *Others:* The PCR panel shows two failures.
>
> **1:20** *You:* The PCR panel needs a second look.
>
> **2:05** *Others:* We will replace the PCR panel.
>
> **2:50** *You:* Let us start with the Harbourline cart.
>
> **3:30** *Others:* Harbourline drops one order in forty.
`;

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    // The Meetings pack on (off until the person turns it on), then the fixtures: one at the
    // top of the vault, one in a Meetings folder under another folder, both hidden with their
    // folders when Notes shows fewer folders, and one with minutes made for the word check's rows.
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(`Meetings/${day(0)} Cart retry standup.md`, STANDUP(day(0)));
    w(`Work/Meetings/${day(-1)} Receipts review.md`, REVIEW(day(-1)));
    w(`Meetings/${day(-1)} Oven sensors review.md`, CHECK(day(-1)));
    w('Work/Meetings/receipts-review.opus', 'not really audio, only a name the transcript links');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    await waitFor(`!!document.querySelector('.app')`);
    await sleep(2500);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

async function waitFor(js, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await H.browser.ev(js)) return;
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 140)}`);
    await sleep(300);
  }
}

const SEL = 'button, a[href], [role="button"], [role="tab"]';
async function clickWords(words, scope = '') {
  const r = await H.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
}

// Open a room the way a person does: its side bar row, else More (narrow windows fold rows away).
async function openRoom(name) {
  if ((await H.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll('.sidebar.left button, aside button')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(name)})));
    if (!el) return 'NOTFOUND';
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`)) === 'CLICKED') return;
  await clickWords('More', '.sidebar.left, aside');
  await sleep(500);
  await clickWords(name, '.menu, [role="menu"]');
}

// The Meetings list, from wherever the last test left the tab: the rail row brings a detail forward
// again, so Back to the list first, as a person does.
async function meetingsList() {
  await openRoom('Meetings');
  await waitFor(`!!document.querySelector('.w2b-meetings')`);
  if (await H.browser.ev(`!!document.querySelector('.w2b-meeting')`)) {
    const back = await H.browser.ev(`(() => {
      const b = [...document.querySelectorAll('button[aria-label="Back"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !e.disabled; });
      if (!b) return false;
      b.click();
      return true;
    })()`);
    assert.equal(back, true, 'Back from the meeting to the list');
    await waitFor(`!!document.querySelector('.w2b-meetings') && !document.querySelector('.w2b-meeting')`);
  }
  await sleep(1000);
}

// The minutes on the page as drawn: how many cards, checks and offers, their words, and where the
// card sits against the recording above it and the note counts below it (t248: the room counts the
// note's Tasks, Decisions and Questions instead of listing them).
async function minutesOnPage() {
  return H.browser.ev(`(() => {
    const card = [...document.querySelectorAll('.mm')];
    const rec = document.querySelector('.mr-stack, .mp, .w2b-reccard, .recbanner');
    const decisions = document.querySelector('section[aria-label="Tasks, decisions and questions"]');
    const first = card[0];
    return {
      cards: card.length,
      checks: document.querySelectorAll('.mm-check').length,
      gaps: document.querySelectorAll('.mm-gaps').length,
      words: first ? (first.innerText || '').replace(/\\s+/g, ' ').slice(0, 900) : '', // t301: the card reads the minutes too, so the window reaches past them
      hasMake: !!first?.querySelector('.mm-make button'),
      hasShare: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === 'Share'),
      recBefore: !!(rec && first && (rec.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)),
      // Round 3: on a wide window the minutes stand in their own region beside the recording's.
      regions: !!document.querySelector('.mt-regions.nv-panes-root .mt-minutes .mm') && !!document.querySelector('.mt-regions.nv-panes-root .mt-record'),
      beforeDecisions: !!(decisions && first && (first.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  })()`);
}

// The rail's Meetings page lists a meeting wherever its folder sits, even one Notes hides.
test('the Meetings rail lists a meeting at the top and one under another folder', async () => {
  await harness();
  await meetingsList();
  const rows = await H.browser.ev(`[...document.querySelectorAll('.w2b-meetings')].map((r) => (r.innerText || '').replace(/\\s+/g, ' ')).join(' | ').slice(0, 2000)`);
  assert.ok(rows.includes('Cart retry standup'), `the top-level meeting lists (${rows.slice(0, 300)})`);
  await clickWords('Past');
  await sleep(1500);
  const past = await H.browser.ev(`[...document.querySelectorAll('.w2b-meetings')].map((r) => (r.innerText || '').replace(/\\s+/g, ' ')).join(' | ').slice(0, 2000)`);
  assert.ok(past.includes('Receipts review'), `the nested meeting lists (${past.slice(0, 300)})`);
});

// The door: Meetings from the rail, a meeting clicked, the page beneath the recording.
test('from the Meetings rail, a meeting with minutes made shows the word check and the gaps offer once, beneath the recording', async () => {
  await harness();
  await meetingsList();
  await clickWords('Past');
  await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Receipts review')`);
  await clickWords('Receipts review');
  await waitFor(`!!document.querySelector('.w2b-meeting')`);
  await sleep(2500);
  const m = await minutesOnPage();
  assert.equal(m.cards, 1, `one minutes card on the meeting page (saw ${m.cards})`);
  assert.equal(m.checks, 1, `one word check (saw ${m.checks})`);
  assert.equal(m.gaps, 1, `one gaps offer (saw ${m.gaps})`);
  assert.ok(m.words.includes('Minutes made'), `the card says the minutes are made (${m.words.slice(0, 200)})`);
  assert.ok(m.words.includes('words to check') || m.words.includes('word to check'), `the check asks before it goes out (${m.words.slice(0, 200)})`);
  assert.ok(m.words.includes('Hear again') || m.words.includes('Hear them again'), `the thin stretch offers to hear again (${m.words.slice(0, 200)})`);
  assert.equal(m.recBefore || m.regions, true, 'the card sits beneath the recording, or beside it in its own region');
  assert.equal(m.beforeDecisions, true, 'the card sits above the note counts (t248: the Decisions section is a count card now), as in the note');
  assert.equal(m.hasShare, true, 'Share sits on the meeting page, so Keep with this note is offered here');
  // Share's check-the-words nudge lands here too: skip, then the event brings the check back.
  await clickWords('Skip for now');
  await sleep(800);
  const skipped = await H.browser.ev(`(document.querySelector('.mm')?.innerText || '').includes('Words skipped')`);
  assert.equal(skipped, true, 'the check skips for now');
  await H.browser.ev(`window.dispatchEvent(new CustomEvent('nv-minutes-check', { detail: ${JSON.stringify(`Work/Meetings/${day(-1)} Receipts review.md`)} }))`);
  await sleep(800);
  assert.equal(await H.browser.ev(`document.querySelectorAll('.mm-check').length`), 1, 'the nudge brings the word check back on this page');
});

// The same page for a meeting with a transcript and no minutes yet: the one Make button.
test('from the Meetings rail, a meeting with only a transcript shows Make the minutes once, beneath the recording', async () => {
  await harness();
  await meetingsList();
  await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Upcoming')`);
  await clickWords('Upcoming');
  await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Cart retry standup')`);
  await clickWords('Cart retry standup');
  await waitFor(`!!document.querySelector('.w2b-meeting')`);
  await sleep(2500);
  const m = await minutesOnPage();
  assert.equal(m.cards, 1, `one minutes card on the meeting page (saw ${m.cards})`);
  assert.equal(m.hasMake, true, `the card offers to make the minutes (${m.words.slice(0, 200)})`);
  assert.equal(m.recBefore || m.regions, true, 'the card sits beneath the recording, or beside it in its own region');
});

// Today's meeting row opens the note, where the card already lived: still once, still beneath.
test("from Today's meeting row, the note shows the minutes card once, beneath the recording", async () => {
  await harness();
  await openRoom('Today');
  await waitFor(`!!document.querySelector('.td-view')`);
  await waitFor(`(document.querySelector('.td-view')?.innerText || '').includes('Cart retry standup')`);
  // The click stays on the meeting row (t249: task rows name their meeting under them, so an unscoped
  // word-click lands on a task instead).
  await clickWords('Cart retry standup', '[data-section="meetings"]');
  await waitFor(`!!document.querySelector('.note-view')`);
  await sleep(2500);
  const m = await minutesOnPage();
  assert.equal(m.cards, 1, `one minutes card in the note (saw ${m.cards})`);
  assert.equal(m.hasMake, true, `the card offers to make the minutes (${m.words.slice(0, 200)})`);
  assert.equal(m.recBefore || m.regions, true, 'the card sits beneath the recording, or beside it in its own region');
});

// Meetings keep one place, the Meetings rail (8.7): the Notes list leaves them out, and search finds them.

// p9-minutes-actions-words: the word check's rows as drawn — a row close to a known word prefills the likeliest
// spelling so one click on Fix every copy does it, an initialism said three times alike gets one row saying so,
// and a steady word said twice gets none.
test('the word check prefills the likeliest spelling, counts an initialism once, and skips a steady word', async () => {
  await harness();
  await meetingsList();
  await clickWords('Past');
  await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Oven sensors review')`);
  await clickWords('Oven sensors review');
  await waitFor(`!!document.querySelector('.w2b-meeting')`);
  await waitFor(`!!document.querySelector('.mm-check')`);
  await sleep(1500);
  const rows = await H.browser.ev(`[...document.querySelectorAll('.mm-check .mm-row')].map((r) => ({ words: (r.innerText || '').replace(/\\s+/g, ' '), value: r.querySelector('input')?.value ?? null }))`);
  assert.equal(rows.length, 2, `two rows (saw ${JSON.stringify(rows.map((r) => r.words).join(' | ').slice(0, 300))})`);
  const nairr = rows.find((r) => r.words.includes('Nairr'));
  assert.ok(nairr, 'the name close to a known word lists');
  assert.equal(nairr.value, 'Nair', 'the likeliest spelling prefilled');
  assert.ok(nairr.words.includes('Close to Nair'), `it says what it is close to (${nairr.words.slice(0, 120)})`);
  const pcr = rows.find((r) => r.words.includes('PCR'));
  assert.ok(pcr, 'the initialism said three times lists once');
  assert.ok(pcr.words.includes('Said 3 times'), `it says how often (${pcr.words.slice(0, 120)})`);
  assert.equal(pcr.value, '', 'with nothing known, nothing prefilled');
  const card = await H.browser.ev(`(document.querySelector('.mm-check')?.innerText || '').replace(/\\s+/g, ' ')`);
  assert.ok(!card.includes('Harbourline'), 'the steady word said twice lists nowhere');
  // One click, nothing typed: every copy fixed, the row gone.
  await clickWords('Fix every copy', '.mm-check');
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('1 word to check')`);
  const after = await H.browser.ev(`(document.querySelector('.mm')?.innerText || '').replace(/\\s+/g, ' ')`);
  assert.ok(!after.includes('Nairr'), 'the corrected name lists nowhere');
  assert.ok(after.includes('PCR'), 'the other row stays');
});
