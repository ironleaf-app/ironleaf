// node --test tests/t152-search.test.mjs — t152 (9 Nov 2026): every control in
// Search does what it says, on the 3,000-note vault: the top bar's panel
// (Ask, Do, Find, the scope, the query, a hit, the jump row) and the search
// window (More → Search inside notes) with results. Real renderer, real
// input; each control is judged by what a person would see plus what landed
// in the files. T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, enumControls, makeRows, record, sleep, sweepPage, typeInto, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

async function typeQuery(scope, text) {
  const items = await enumControls(H, scope);
  const input = items.find((c) => c.tag === 'input' && !['file', 'checkbox', 'radio', 'range', 'color', 'button', 'submit'].includes(c.type || 'text'));
  if (!input) return 'NO-INPUT';
  await typeInto(H, input.key, text);
  return 'TYPED';
}

test('Search: every control works, on the big vault', { timeout: 900000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-search] ${m}`));

  // The top bar's panel, mode by mode.
  assert.equal(await clickWords(H, 'Ask or find anything', '.topbar'), 'CLICKED', 'the bar opens the panel');
  assert.ok(await waitFor(H, `!!document.querySelector('.picker')`), 'the panel shows');
  record(rows, 'search', 'panel', 'Ask or find anything', 'button', 'opens the panel', 'works');
  for (const m of ['Ask', 'Do', 'Find']) {
    assert.equal(await clickWords(H, m, '.picker-modes'), 'CLICKED', `${m} mode is there`);
    assert.ok(await waitFor(H, `document.querySelector('.picker-modes [role="tab"].on')?.innerText?.trim() === '${m}'`), `${m} mode lights`);
    record(rows, 'search', 'panel', `${m} mode`, 'tab', `${m} mode lights`, 'works');
  }
  assert.equal(await clickWords(H, 'All notes', '.picker-modes'), 'CLICKED', 'the scope opens');
  assert.ok(await waitFor(H, `!!document.querySelector('.menu, [role="menu"]')`), 'the scope menu shows');
  record(rows, 'search', 'panel', 'scope', 'button', 'opens the scope menu', 'works');
  assert.equal(await clickWords(H, 'All notes', '.menu, [role="menu"]'), 'CLICKED', 'the scope picks');
  await sleep(400);
  record(rows, 'search', 'panel', 'scope All notes', 'menuitem', 'picks without closing the panel', 'works');
  assert.equal(await typeQuery('.picker', 'harbour'), 'TYPED', 'the panel takes the query');
  assert.ok(await waitFor(H, `[...document.querySelectorAll('.picker .picker-row')].some((e) => (e.innerText || '').includes('Harbourline'))`, 15000), 'harbour finds its note');
  record(rows, 'search', 'panel', 'query harbour', 'input', 'finds the Harbourline note', 'works');
  assert.equal(await clickWords(H, 'Harbourline Cart Fix', '.picker'), 'CLICKED', 'the hit opens');
  assert.ok(await waitFor(H, `!document.querySelector('.picker') && (document.querySelector('main h1, .main h1')?.innerText ?? '').includes('Harbourline Cart Fix')`, 12000), 'the project opens and the panel goes');
  record(rows, 'search', 'panel', 'hit Harbourline Cart Fix', 'row', 'opens the project', 'works');
  assert.equal(await clickWords(H, 'Ask or find anything', '.topbar'), 'CLICKED', 'the bar opens the panel again');
  assert.ok(await waitFor(H, `!!document.querySelector('.picker')`), 'the panel shows again');
  assert.equal(await typeQuery('.picker', 'harbour'), 'TYPED', 'the panel takes the query again');
  assert.ok(await waitFor(H, `[...document.querySelectorAll('.picker .picker-row')].some((e) => (e.innerText || '').includes('Search inside notes'))`, 15000), 'the jump row shows');
  assert.equal(await clickWords(H, 'Search inside notes', '.picker'), 'CLICKED', 'the jump runs');
  assert.ok(await waitFor(H, `!!document.querySelector('.smodal')`), 'the search window opens');
  record(rows, 'search', 'panel', 'jump Search inside notes', 'row', 'opens the search window', 'works');

  // The search window with results: every control in it.
  const open = async () => {
    await clickWords(H, 'More');
    await waitFor(H, `!!document.querySelector('.menu, [role="menu"]')`);
    await clickWords(H, 'Search inside notes', '.menu, [role="menu"]');
    await waitFor(H, `!!document.querySelector('.smodal')`);
    await typeQuery('.smodal', 'harbour');
    await waitFor(H, `document.querySelectorAll('.smodal button.sas-rowhead').length > 0`, 15000);
    await sleep(1500);
  };
  await open();
  await sweepPage(H, rows, 'search', 'window', { open, stayJS: `!!document.querySelector('.smodal')`, scope: '.smodal' });

  const mine = assertArea(rows, 'search');
  console.log(`[t152-search] ${mine.length} controls pressed, all answered`);
});
