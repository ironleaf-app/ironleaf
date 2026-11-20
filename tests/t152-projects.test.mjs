// node --test tests/t152-projects.test.mjs — t152 (9 Nov 2026): every control
// on Projects and on a project page does what it says, on the 3,000-note
// vault. Real renderer, real input; each control is judged by what a person
// would see plus what landed in the files. T152_OUT=path writes the rows.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, openSidebar, H1, makeRows, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

async function openProjectPage() {
  await openSidebar(H, 'Projects');
  await waitFor(H, H1('Projects'));
  await clickWords(H, 'Harbourline Cart Fix', 'main');
  await waitFor(H, `!!document.querySelector('.pj-page')`);
  await sleep(800);
}

test('Projects: every control works, on the big vault', { timeout: 2400000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-projects] ${m}`));

  // Explicit checks first, on the pristine vault (the blind pass ticks, removes and folds, which
  // would move their doors). Step 2 (their decision 2: one view per list): no Timeline, Board,
  // Calendar or Rows switch on the project page; the standing reads from the top.
  await openProjectPage();
  assert.ok(!(await H.browser.ev(`!!document.querySelector('[data-section="whats-next"] .seg')`)), 'no view switch on Your next');
  const standing = await H.browser.ev(`document.querySelector('.w2a-standing')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.match(standing, /of yours open/, `the standing reads from the top (${standing.slice(0, 80)})`);

  const open = async () => {
    await openSidebar(H, 'Projects');
    await waitFor(H, H1('Projects'));
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, H1('Projects')), 'Projects lands on the big vault');
  await sweepPage(H, rows, 'projects', 'Projects', { open, stayJS: H1('Projects'), scope: 'main' });

  await openProjectPage();
  assert.ok(await waitFor(H, `!!document.querySelector('.pj-page')`), 'the project page lands');
  await sweepPage(H, rows, 'projects', 'project', { open: openProjectPage, stayJS: `!!document.querySelector('.pj-page')`, scope: 'main' });

  const mine = assertArea(rows, 'projects');
  console.log(`[t152-projects] ${mine.length} controls pressed, all answered`);
});
