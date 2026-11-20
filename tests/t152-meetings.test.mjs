// node --test tests/t152-meetings.test.mjs — t152 (9 Nov 2026): every control
// on Meetings does what it says, on the 3,000-note vault. The Meetings row
// shows once its pack is on, so the pass switches it on through Settings ›
// Packs first, the way a person does. Real renderer, real input; each
// control is judged by what a person would see plus what landed in the
// files. T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, makeRows, openSidebar, sleep, sweepPage, switchPackOn, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

// The pack shell heads its h1 with a glyph, so the pin includes, never
// equals (the sweep's lesson).
const MEETINGS_STAY = `(document.querySelector('main h1')?.innerText ?? '').includes('Meetings')`;

test('Meetings: every control works, on the big vault', { timeout: 900000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-meetings] ${m}`));
  assert.ok(await switchPackOn(H, 'Meetings'), 'Settings › Packs switches Meetings on');
  const open = async () => {
    const direct = await openSidebar(H, 'Meetings');
    if (direct !== 'CLICKED') {
      await clickWords(H, 'More');
      await waitFor(H, `!!document.querySelector('.menu, [role="menu"]')`);
      await clickWords(H, 'Meetings', '.menu, [role="menu"]');
    }
    await waitFor(H, MEETINGS_STAY);
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, MEETINGS_STAY), 'Meetings lands on the big vault');
  await sweepPage(H, rows, 'meetings', 'Meetings', { open, stayJS: MEETINGS_STAY, scope: 'main' });
  const mine = assertArea(rows, 'meetings');
  console.log(`[t152-meetings] ${mine.length} controls pressed, all answered`);
});
