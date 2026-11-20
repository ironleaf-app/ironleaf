// node --test tests/t152-people.test.mjs — t152 (9 Nov 2026): every control on
// People and on a person page does what it says, on the 3,000-note vault.
// Real renderer, real input; each control is judged by what a person would
// see plus what landed in the files. T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, makeRows, openSidebar, PAGENAME, record, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const PERSON_STAY = `(document.querySelector('main h1')?.innerText ?? '').includes('Alex Chen')`;

async function openPerson() {
  await openSidebar(H, 'People');
  await waitFor(H, PAGENAME('People'));
  await clickWords(H, 'Alex Chen', 'main');
  await waitFor(H, PERSON_STAY);
  await sleep(800);
}

test('People: every control works, on the big vault', { timeout: 1200000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-people] ${m}`));

  // A sidebar row leaves its own detail page (t152 fix: the People row
  // re-activated the person tab and nobody got back to the list).
  await openPerson();
  assert.ok(await waitFor(H, PERSON_STAY), 'the person page lands first');
  await openSidebar(H, 'People');
  assert.ok(await waitFor(H, PAGENAME('People')), 'the People row leaves a person page for the list');
  record(rows, 'people', 'person', 'People row', 'button', 'leaves the person page for the list', 'works');

  const open = async () => {
    await openSidebar(H, 'People');
    await waitFor(H, PAGENAME('People'));
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, PAGENAME('People')), 'People lands on the big vault');
  await sweepPage(H, rows, 'people', 'People', { open, stayJS: PAGENAME('People'), scope: 'main' });

  await openPerson();
  assert.ok(await waitFor(H, PERSON_STAY), 'the person page lands');
  await sweepPage(H, rows, 'people', 'person', { open: openPerson, stayJS: PERSON_STAY, scope: 'main' });

  const mine = assertArea(rows, 'people');
  console.log(`[t152-people] ${mine.length} controls pressed, all answered`);
});
