// node --test tests/t152-tasks.test.mjs — t152 (9 Nov 2026): every control on
// Tasks does what it says, on the 3,000-note vault. Real renderer, real
// input; each control is judged by what a person would see plus what landed
// in the files. T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, H1, makeRows, openSidebar, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

test('Tasks: every control works, on the big vault', { timeout: 1500000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-tasks] ${m}`));
  const open = async () => {
    await openSidebar(H, 'Tasks');
    await waitFor(H, H1('Tasks'));
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, H1('Tasks')), 'Tasks lands on the big vault');
  await sweepPage(H, rows, 'tasks', 'Tasks', { open, stayJS: H1('Tasks'), scope: 'main' });
  const mine = assertArea(rows, 'tasks');
  console.log(`[t152-tasks] ${mine.length} controls pressed, all answered`);
});
