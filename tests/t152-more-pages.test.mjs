// node --test tests/t152-more-pages.test.mjs — t152 (9 Nov 2026): every control
// on the More menu's pages does what it says, on the 3,000-note vault:
// Templates, Files and assets, Bookmarks, Locked, Bin, Import, Timeline,
// Shared spaces, What the Vault can do, Tags and Areas. Real
// renderer, real input; each control is judged by what a person would see
// plus what landed in the files. (Graph, Search inside notes, People and
// organisations and Commands open pages swept in their own area files.)
// T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickReal, enumControls, H1, makeRows, PAGENAME, record, sleep, sweepPage, viaMore, waitFor, DIALOG_SEL } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const more = (item, ...fallbacks) => viaMore(H, item, ...fallbacks);

const MODAL_STAY = `!!document.querySelector('.modal, [role="dialog"]')`;

test('More pages: every control works, on the big vault', { timeout: 2700000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-more-pages] ${m}`));

  const pages = [
    { page: 'Templates', open: () => more('Templates'), stay: PAGENAME('Templates'), scope: 'main' },
    { page: 'Files and assets', open: () => more('Files and assets'), stay: PAGENAME('Files and assets'), scope: 'main' },
    { page: 'Bookmarks', open: () => more('Bookmarks'), stay: PAGENAME('Bookmarks'), scope: 'main' },
    { page: 'Locked', open: () => more('Locked'), stay: H1('Locked'), scope: 'main' },
    { page: 'Import', open: () => more('Import'), stay: H1('Import'), scope: 'main' },
    { page: 'Timeline', open: () => more('Timeline'), stay: PAGENAME('Timeline'), scope: 'main', skip: ['Today'] },
    // Automations left the app on 20 Nov 2026 (its pages removed), so its row left this walk (23 Nov 2026).
    { page: 'Shared spaces', open: () => more('Shared spaces'), stay: H1('Shared spaces'), scope: 'main' },
    { page: 'Abilities', open: () => more('What Ironleaf can do'), stay: PAGENAME('What Ironleaf can do'), scope: 'main' },
    { page: 'Tags', open: () => more('Tags'), stay: MODAL_STAY, scope: DIALOG_SEL },
    { page: 'Areas', open: () => more('Areas of life', 'Organise by area'), stay: MODAL_STAY, scope: DIALOG_SEL },
  ];
  for (const p of pages) {
    await p.open();
    assert.ok(await waitFor(H, p.stay), `${p.page} lands from the More menu`);
    // Today, proved the honest way (like the projects file): scrolled away,
    // the real button pressed, the board comes back. Skipped in the blind
    // pass: already at today it rightly rests, which reads dead.
    if (p.page === 'Timeline') {
      await H.browser.ev(`(() => { const b = document.querySelector('.tl-board'); if (b) b.scrollTo({ left: b.scrollWidth }); })()`);
      await sleep(600);
      const leftBefore = await H.browser.ev(`document.querySelector('.tl-board')?.scrollLeft ?? -1`);
      const ctrls = await enumControls(H, 'main');
      const today = ctrls.find((c) => c.words === 'Today' && c.tag === 'button');
      assert.ok(today, 'the Today button is there');
      if (leftBefore <= 50) {
        record(rows, 'more-pages', 'Timeline', 'Today', 'button', 'the board fits; Today rightly rests', 'no-op-ok');
      } else {
        await clickReal(H, today.key);
        await sleep(1200);
        const leftAfter = await H.browser.ev(`document.querySelector('.tl-board')?.scrollLeft ?? -1`);
        assert.ok(leftAfter < leftBefore, `Today brings the board back (${leftBefore} → ${leftAfter})`);
        record(rows, 'more-pages', 'Timeline', 'Today', 'button', `the board returns (${leftBefore} → ${leftAfter})`, 'works');
      }
    }
    await sweepPage(H, rows, 'more-pages', p.page, { open: p.open, stayJS: p.stay, scope: p.scope, skip: p.skip ?? [] });
  }

  // The Bin with two deleted notes waiting, through the real data layer
  // (the same call the UI's delete makes).
  for (const rel of ['Inbox/awning-quote.md', 'Notes/Receipts v2.md']) {
    await H.services.invoke('path:trash', [rel]).catch(() => {});
  }
  const openBin = () => more('Bin');
  await openBin();
  assert.ok(await waitFor(H, H1('Bin')), 'Bin lands from the More menu');
  await sweepPage(H, rows, 'more-pages', 'Bin', { open: openBin, stayJS: H1('Bin'), scope: 'main' });

  const mine = assertArea(rows, 'more-pages');
  console.log(`[t152-more-pages] ${mine.length} controls pressed, all answered`);
});
