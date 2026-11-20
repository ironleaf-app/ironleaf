// node --test tests/t152-graph.test.mjs — t152 (9 Nov 2026): every control on
// the graph page does what it says, on the 3,000-note vault. Real renderer,
// real input; each control is judged by what a person would see plus what
// landed in the files. The canvas itself is not a control (t151 owns the
// note's own graph; this page's points are checked drawn, not pressed).
// T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, makeRows, openRoom, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const GRAPH_STAY = `!!document.querySelector('.bg-canvas, .nj-graph-body')`;

test('Graph: every control works, on the big vault', { timeout: 900000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-graph] ${m}`));
  const open = async () => {
    await openRoom(H, 'Graph');
    await waitFor(H, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 40`, 90000);
    await sleep(2000);
  };
  await open();
  assert.ok(await waitFor(H, GRAPH_STAY), 'the graph lands on the big vault');
  const count = await H.browser.ev(`window.__nvBrainGraph ? window.__nvBrainGraph.snapshot().count : 0`);
  assert.ok(count > 40, `the vault draws (${count} points)`);
  await sweepPage(H, rows, 'graph', 'Graph', { open, stayJS: GRAPH_STAY, scope: 'main' });
  const mine = assertArea(rows, 'graph');
  console.log(`[t152-graph] ${mine.length} controls pressed, all answered`);
});
