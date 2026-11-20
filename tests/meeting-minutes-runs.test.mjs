// node --test tests/meeting-minutes-runs.test.mjs — making the minutes, as a person sees it
// (5 Nov 2026: the button spun for four minutes, then the card read as if nothing was pressed —
// the Meetings page mounts one card per phase, so a phase change mid-run remounted the card and
// the error words never showed). Through the live harness with real clicks and page-side
// stand-ins for the ask: a failure shows its words with a Try again, leaving and coming back
// keeps them, a slow run shows the time so far and a Stop, and a stopped run says it was
// stopped. Made-up cart-fix meetings only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

const STANDUP = (today, title) => `---
type: meeting
date: ${today}
attendees: [Alex Chen, Priya Nair]
---

# ${today} ${title}

## Agenda

- The retry fix

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

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(`Meetings/${day(-1)} Cart retry standup.md`, STANDUP(day(-1), 'Cart retry standup'));
    w(`Meetings/${day(-1)} Receipts standup.md`, STANDUP(day(-1), 'Receipts standup'));
    w(`Meetings/${day(-1)} Till standup.md`, STANDUP(day(-1), 'Till standup'));
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

async function openRoom(name) {
  if (
    (await H.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...document.querySelectorAll('.sidebar.left button, aside button')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(name)})));
    if (!el) return 'NOTFOUND';
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`)) === 'CLICKED'
  )
    return;
  await clickWords('More', '.sidebar.left, aside');
  await sleep(500);
  await clickWords(name, '.menu, [role="menu"]');
}

async function openMeeting(title) {
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
  await clickWords('Past');
  await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes(${JSON.stringify(title)})`);
  await clickWords(title);
  await waitFor(`!!document.querySelector('.w2b-meeting')`);
  await waitFor(`!!document.querySelector('.mm')`);
  await sleep(1500);
}

// Page-side stand-ins for the minutes ask (the harness routes calls to node; the window's own
// recorder is wrapped instead, everything else delegated). Modes: fail, slow (17 s, then good
// minutes), stuck (waits until cancel answers it), ok.
async function standins() {
  await H.browser.ev(`(() => {
    if (window.__minutesWrapped) return 'ready';
    const GOOD = { present: ['Priya Nair'], absent: [], named: [], summary: 'Priya and Alex went over the cart retry.', figures: [], decisions: ['Ship the retry first'], actions: [{ what: 'Chase the failed payments', who: 'Priya Nair' }], questions: [{ what: 'Whether the printer arrives in time.' }], topics: [{ heading: 'Cart retry', words: ['The retry fails on Fridays.'] }] };
    window.__minutesMode = 'fail';
    window.__minutesPending = [];
    const real = window.nv.recorder;
    const stub = new Proxy(real, {
      get: (t, p) => {
        if (p === 'minutes') return async () => {
          const mode = window.__minutesMode;
          if (mode === 'slow') { await new Promise((r) => setTimeout(r, 17000)); return { minutes: GOOD }; }
          if (mode === 'stuck') return new Promise((res) => window.__minutesPending.push(res));
          if (mode === 'ok') return { minutes: GOOD };
          return { minutes: null, error: 'the host app is not answering just now. Try again in a moment.' };
        };
        if (p === 'cancel') return async () => { const r = window.__minutesPending.shift(); if (r) r({ minutes: null, error: 'Stopped.' }); };
        return t[p];
      },
    });
    window.nv = new Proxy(window.nv, { get: (t, p) => (p === 'recorder' ? stub : t[p]) });
    window.__minutesWrapped = true;
    return 'ready';
  })()`);
}

const cardWords = () => H.browser.ev(`(document.querySelector('.mm')?.innerText || '').replace(/\\s+/g, ' ')`);

test('a failed run shows its words with a way back', async () => {
  await harness();
  await standins();
  await H.browser.ev(`window.__minutesMode = 'fail'`);
  await openMeeting('Cart retry standup');
  await clickWords('Make the minutes', '.mm');
  await waitFor(`!!document.querySelector('.mm-error')`);
  const words = await cardWords();
  assert.ok(words.includes('not answering just now'), `the failure's words show (${words.slice(0, 200)})`);
  assert.ok(words.includes('Try again'), 'with a way back');
});

test('the words survive leaving and coming back', async () => {
  await harness();
  await openRoom('Today');
  await waitFor(`!!document.querySelector('.td-view')`);
  await openMeeting('Cart retry standup');
  const words = await cardWords();
  assert.ok(words.includes('not answering just now'), `the words are still there after a remount (${words.slice(0, 200)})`);
  assert.ok(words.includes('Try again'), 'and so is the way back');
});

test('trying again after a failure makes the minutes', async () => {
  await harness();
  await H.browser.ev(`window.__minutesMode = 'ok'`);
  await openMeeting('Cart retry standup');
  await clickWords('Try again', '.mm');
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('Minutes made')`);
});

test('a slow run shows the time so far and a Stop, then lands', async () => {
  await harness();
  await H.browser.ev(`window.__minutesMode = 'slow'`);
  await openMeeting('Receipts standup');
  await clickWords('Make the minutes', '.mm');
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('Making the minutes')`);
  const stop = await H.browser.ev(`[...document.querySelectorAll('.mm button')].some((b) => (b.innerText || '').trim() === 'Stop')`);
  assert.equal(stop, true, 'a Stop while it works');
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('so far')`, 25000);
  const words = await cardWords();
  assert.match(words, /\d+:\d\d so far/, `the time so far shows (${words.slice(0, 200)})`);
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('Minutes made')`, 30000);
});

test('a stopped run says it was stopped, with a way back', async () => {
  await harness();
  await H.browser.ev(`window.__minutesMode = 'stuck'`);
  await openMeeting('Till standup');
  await clickWords('Make the minutes', '.mm');
  await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('Making the minutes')`);
  await clickWords('Stop', '.mm');
  await waitFor(`!!document.querySelector('.mm-error')`);
  const words = await cardWords();
  assert.ok(words.includes('Stopped.'), `stopping shows its words (${words.slice(0, 200)})`);
  assert.ok(words.includes('Try again'), 'with a way back');
});
