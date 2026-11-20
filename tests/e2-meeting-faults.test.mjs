// node --test tests/e2-meeting-faults.test.mjs — e2-meeting-faults fault 3 (6 Nov 2026, the Brookfield
// take at 1280 wide: the recording block's "Written down as it goes…" ran into the right rail, and
// "by Thursday morning" poked past its actions card). Driven through the live harness on the take's
// own note shape; without the wrap the hint and the loose "by when" measure past their column.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

const NOTE = `---
type: meeting
title: "2026-11-06 Brookfield bakery opening: weekly"
date: 2026-11-06
people:
  - "[[Alex Rivera]]"
  - "[[Kate Sullivan]]"
project: "[[Brookfield bakery fit-out]]"
where: Brookfield site office
---

## Agenda

- [ ] Brookfield opening date
- [ ] Oven install for the new kitchen

## Actions

- [ ] Confirm the install day with the joiners — [[Kate Sullivan]] · by 11 Nov 2026
- [ ] Ring the joiners
- [ ] Chase the stone top for Thursday morning — by Thursday morning
- [ ] Confirm the council booking — by 9 Nov 2026
- [ ] Check the opening stock order totals — [[Kate Sullivan]] · by Friday
- [ ] Check the first day totals on opening morning — by opening morning
- [ ] Send the soft open invites — by 23 Nov 2026

## Transcript

Recording: [[Recording – 2026-11-06 Brookfield bakery opening weekly.m4a]] · 4 minutes

> [!quote]- Transcript · 4 minutes
> **0:00** *Speaker 1:* Right. Doors shut. Opening date first, then joinery, ovens and stock, and the milk last.
>
> **0:38** *Speaker 2:* I'll ring them, and I'll chase the stone top for the Thursday morning as well.
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEL = 'button, a[href], [role="button"], [role="tab"]';
let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    const p = path.join(H.vaultDir, 'Meetings', '2026-11-06 Brookfield bakery opening weekly.md');
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, NOTE);
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
    await new Promise((r) => setTimeout(r, 600));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
}

test('the meeting note keeps its recording words and loose days inside their cards', { timeout: 300000 }, async () => {
  await harness();
  await clickWords('Ask or find anything');
  await sleep(900);
  await H.browser.ev(`(() => {
    const input = document.querySelector('.picker input');
    input.focus();
    document.execCommand('insertText', false, 'Brookfield bakery opening');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(1400);
  await clickWords('Brookfield bakery opening', '.picker');
  await waitFor(`!!document.querySelector('.mr-stack') && !!document.querySelector('.mt-panel')`);
  await sleep(1200);
  for (const [width, height] of [[1280, 800], [1219, 709]]) {
    await H.browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(1000);
    // Rows past the fold skip rendering until scrolled to (t102's content-visibility speed work), so their
    // innerText reads empty — read each row as a person would, scrolled into view (t142's project-page fix).
    await H.browser.ev(`(async () => {
      for (const e of document.querySelectorAll('.mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); }
    })()`);
    await sleep(400);
    const m = await H.browser.ev(`(() => {
      const hint = [...document.querySelectorAll('.mr-hint')].find((e) => e.textContent.includes('Written down as it goes'));
      const stack = document.querySelector('.mr-stack');
      const panel = document.querySelector('.mt-panel');
      const whens = [...document.querySelectorAll('.mt-row .tkrow-when')].map((e) => {
        const r = e.getBoundingClientRect();
        const inner = e.querySelector('.tkrow-moment')?.getBoundingClientRect();
        return { words: (e.innerText || '').replace(/\\s+/g, ' ').trim(), left: Math.round(r.left), right: Math.round(r.right), innerLeft: inner ? Math.round(inner.left) : null, innerRight: inner ? Math.round(inner.right) : null };
      });
      return {
        hintRight: hint ? Math.round(hint.getBoundingClientRect().right) : null,
        hintWords: hint ? hint.textContent.replace(/\\s+/g, ' ').slice(0, 60) : null,
        stackRight: stack ? Math.round(stack.getBoundingClientRect().right) : null,
        panelRight: panel ? Math.round(panel.getBoundingClientRect().right) : null,
        whens,
      };
    })()`);
    assert.ok(m.hintRight !== null, `the recording words show at ${width} (${JSON.stringify(m.hintWords)})`);
    assert.ok(m.hintRight <= m.stackRight + 1, `the recording words end inside their block at ${width} (hint ${m.hintRight}, block ${m.stackRight})`);
    assert.ok(m.whens.some((w) => w.words.includes('Thursday morning')), `the stone top row shows its loose day at ${width}: ${JSON.stringify(m.whens.map((w) => w.words))}`);
    for (const w of m.whens) {
      assert.ok(w.right <= m.panelRight + 1, `"${w.words}" ends inside its card at ${width} (cell ${w.right}, card ${m.panelRight})`);
      assert.ok(w.innerRight === null || w.innerRight <= m.panelRight + 1, `"${w.words}" words end inside their card at ${width} (words ${w.innerRight}, card ${m.panelRight})`);
      // The words themselves, not the cell's scroll width: the edit pencil beside them takes no room
      // by design (peek.css) yet counts in scrollWidth, so it can never judge fit.
      assert.ok(w.innerLeft === null || w.innerLeft >= w.left - 1, `"${w.words}" starts inside its cell at ${width} (words ${w.innerLeft}, cell ${w.left})`);
    }
  }
});
