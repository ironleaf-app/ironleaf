// The voices card stays readable in a narrow window (6 Nov 2026, speakers): at 400 px wide the rows wrap the
// Join control beneath instead of crushing "Speaker 1" and "Set a name" one letter per line. Driven through the
// live harness with real clicks; without the wrap the voice labels measure a few pixels wide and this fails.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

const NOTE = `---
type: meeting
date: 2026-11-05
attendees: [Alex Chen, Priya Nair]
speakers:
  "":
    spk1: Alex Chen
    spk2: Priya Nair
---

# 2026-11-05 Mill visit

## Transcript

> [!quote]- Transcript · 4 minutes
> **0:04** *Speaker 1:* Morning everyone, let us walk the new line while it is quiet.
> **0:11** *Speaker 2:* Morning. The proofer is already at temperature.
> **0:18** *Speaker 3:* And the oven fans were serviced last night.
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEL = 'button, a[href], [role="button"], [role="tab"]';
let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    const p = path.join(H.vaultDir, 'Meetings', '2026-11-05 Mill visit.md');
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

test('the voices card wraps instead of crushing its labels at 400 px', async () => {
  await harness();
  await clickWords('Ask or find anything');
  await sleep(900);
  await H.browser.ev(`(() => {
    const input = document.querySelector('.picker input');
    input.focus();
    document.execCommand('insertText', false, 'Mill visit');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(1400);
  await clickWords('Mill visit', '.picker');
  await waitFor(`!!document.querySelector('.spk')`);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const labels = await H.browser.ev(`[...document.querySelectorAll('.spk-row .spk-was, .spk-row .spk-set')].map((e) => Math.round(e.getBoundingClientRect().width))`);
  assert.ok(labels.length >= 3, `three voice labels on the card (saw ${labels.length})`);
  assert.ok(labels.every((w) => w > 40), `no crushed label at 400 px (widths ${labels.join(',')})`);
});
