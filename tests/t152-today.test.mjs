// node --test tests/t152-today.test.mjs — t152 (9 Nov 2026): every control on
// Today and the shell around it does what it says, on the 3,000-note vault
// (Business, Me, Projects, People, Bills, Inbox, meetings). Real renderer,
// real input; each control is judged by what a person would see plus what
// landed in the files. T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, makeRows, openSidebar, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const TODAY_STAY = `!!document.querySelector('.td-view')`;

test('Today: every control works, on the big vault', { timeout: 900000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-today] ${m}`));
  const open = async () => {
    await openSidebar(H, 'Today');
    await waitFor(H, TODAY_STAY);
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, TODAY_STAY), 'Today lands on the big vault');
  await sweepPage(H, rows, 'today', 'Today', { open, stayJS: TODAY_STAY });
  const mine = assertArea(rows, 'today');
  console.log(`[t152-today] ${mine.length} controls pressed, all answered`);
});
