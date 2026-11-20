// node --test tests/t152-more-make.test.mjs — t152 (9 Nov 2026): every control
// behind the More menu's Make group does what it says, on the 3,000-note
// vault: Daily note, New canvas, New drawing, New view, Open a file from
// this PC, Import CSV, Earlier versions of notes, Commands, and the items
// that open pages swept elsewhere (Choose packs, Search inside notes,
// People and organisations, Graph). Real renderer, real input; each control
// is judged by what a person would see plus what landed in the files.
// T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickReal, clickWords, DIALOG_SEL, diffFiles, enumControls, fileMap, H1, makeRows, record, sleep, sweepPage, viaMore, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const more = (item, ...fallbacks) => viaMore(H, item, ...fallbacks);

const MODAL_STAY = `!!document.querySelector('.modal, [role="dialog"]')`;

test('More make: every control works, on the big vault', { timeout: 1800000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-more-make] ${m}`));

  // Daily note opens today's note in the editor (editors sweep in notes).
  await more('Daily note');
  assert.ok(await waitFor(H, `!!document.querySelector('.cm-editor')`), 'Daily note lands in the editor');
  record(rows, 'more-make', 'Daily note', 'Daily note', 'menuitem', 'opens today’s note in the editor', 'works');

  // New canvas: a canvas file is made and its page swept.
  await more('New canvas');
  assert.ok(await waitFor(H, `!!document.querySelector('.canvas-view')`, 15000), 'the new canvas lands');
  record(rows, 'more-make', 'New canvas', 'New canvas', 'menuitem', 'makes a canvas and opens it', 'works');
  await sweepPage(H, rows, 'more-make', 'canvas', {
    open: () => more('New canvas'),
    stayJS: `!!document.querySelector('.canvas-view')`,
    scope: 'main',
  });

  // New drawing: a drawing is made and its tools swept.
  await more('New drawing');
  assert.ok(await waitFor(H, `!!document.querySelector('.nvd-view')`, 15000), 'the new drawing lands');
  record(rows, 'more-make', 'New drawing', 'New drawing', 'menuitem', 'makes a drawing and opens it', 'works');
  // The zoom level fits the drawing (t191: pressed at rest it rightly does
  // nothing, which reads dead — like Timeline's Today, one explicit check
  // proves it by zooming away first, and the blind pass skips the 100% rest).
  {
    const level = () => H.browser.ev(`document.querySelector('.nvd-zoom-level')?.innerText?.trim() ?? ''`);
    assert.equal(await level(), '100%', 'a new drawing opens at 100%');
    assert.equal(await clickWords(H, 'Zoom out', 'main'), 'CLICKED', 'Zoom out runs');
    await sleep(600);
    const away = await level();
    assert.notEqual(away, '100%', `zooming out leaves 100% (${away})`);
    const ctrls = await enumControls(H, 'main');
    const fitBtn = ctrls.find((c) => c.words === away && c.tag === 'button');
    assert.ok(fitBtn, `the ${away} fit button is there`);
    await clickReal(H, fitBtn.key);
    await sleep(600);
    assert.equal(await level(), '100%', 'the level fits the drawing back to 100%');
    record(rows, 'more-make', 'drawing', 'zoom level fit', 'button', `fits back to 100% from ${away}`, 'works');
  }
  await sweepPage(H, rows, 'more-make', 'drawing', {
    open: () => more('New drawing'),
    stayJS: `!!document.querySelector('.nvd-view')`,
    scope: 'main',
    skip: ['100%'],
  });

  // New view: the wizard end to end (blind passes hand wizards here: one
  // finished view proves the flow — source, name, kind, file, opened).
  await more('New view');
  assert.ok(await waitFor(H, MODAL_STAY), 'New view opens its source step');
  record(rows, 'more-make', 'New view', 'New view', 'menuitem', 'opens its dialog', 'works');
  assert.equal(await clickWords(H, 'Every note', DIALOG_SEL), 'CLICKED', 'the source picks');
  await sleep(800);
  {
    const inputAt = await H.browser.ev(`(() => { const el = document.querySelector('${DIALOG_SEL} input'); if (!el) return 'NO-INPUT'; el.focus(); el.scrollIntoView({ block: 'nearest' }); return 'FOCUSED'; })()`);
    assert.equal(inputAt, 'FOCUSED', 'the name field takes the focus');
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await H.browser.send('Input.insertText', { text: 'Harbour views' });
    await sleep(400);
    record(rows, 'more-make', 'new-view', 'view name', 'input', 'takes Harbour views', 'works');
  }
  const viewsBefore = fileMap(H);
  assert.equal(await clickWords(H, 'Make the view', DIALOG_SEL), 'CLICKED', 'the name confirms');
  await sleep(800);
  assert.equal(await clickWords(H, 'Ironleaf’s own', DIALOG_SEL), 'CLICKED', 'the kind picks');
  await sleep(2500);
  {
    const added = diffFiles(viewsBefore, fileMap(H)).filter((p) => !p.endsWith('(gone)'));
    const view = added.find((p) => p.startsWith('Views/') && p.includes('Harbour views'));
    assert.ok(view, `the view file is kept (added: ${added.slice(0, 4).join(', ')})`);
    record(rows, 'more-make', 'new-view', 'New view wizard', 'dialog', `keeps ${view} and opens it`, 'works', [view]);
  }

  // Earlier versions of notes: the recovery page's own controls (t191: a recovery
  // ask lands on the Versions page in the frame, 8.7 w4a round 2 — never a
  // dialog — so the sweep presses the page it opens, not a dialog).
  const RECOVERY_STAY = H1('Earlier versions');
  const openRecovery = () => more('Earlier versions of notes');
  await openRecovery();
  assert.ok(await waitFor(H, RECOVERY_STAY), 'Earlier versions opens its page');
  record(rows, 'more-make', 'Recovery', 'Earlier versions of notes', 'menuitem', 'opens its page', 'works');
  await sweepPage(H, rows, 'more-make', 'recovery', { open: openRecovery, stayJS: RECOVERY_STAY, scope: 'main' });

  // Commands opens the palette; the note switcher inside it is p7's own job.
  await more('Commands');
  assert.ok(await waitFor(H, `!!document.querySelector('.picker, .modal input, [role="dialog"] input')`), 'Commands opens');
  const switcher = await H.browser.ev(`!![...document.querySelectorAll('.modal input, [role="dialog"] input')].find((e) => (e.getAttribute('placeholder') || '').includes('Find a note, or type a new name'))`);
  if (switcher) {
    record(rows, 'more-make', 'Commands', 'Commands', 'menuitem', 'opens p7’s note switcher (out of scope)', 'out-of-scope');
  } else {
    record(rows, 'more-make', 'Commands', 'Commands', 'menuitem', 'opens the command palette', 'works');
    await sweepPage(H, rows, 'more-make', 'commands', { open: () => more('Commands'), stayJS: MODAL_STAY, scope: DIALOG_SEL });
  }

  // The OS pickers: pressed, and the handoff is the page's whole job.
  for (const item of ['Open a file from this PC…', 'Import CSV…']) {
    await more(item);
    await sleep(800);
    record(rows, 'more-make', item, item, 'menuitem', 'hands to the OS file picker (nothing observable headless)', 'external');
  }

  // Items that open pages swept in their own files: they land, nothing more.
  await more('Choose packs…');
  assert.ok(await waitFor(H, H1('Packs')), 'Choose packs lands on the Packs section');
  record(rows, 'more-make', 'Choose packs…', 'Choose packs…', 'menuitem', 'lands on the Packs section (swept in settings)', 'works');
  await more('Search inside notes');
  assert.ok(await waitFor(H, `!!document.querySelector('.smodal')`), 'Search inside notes opens the window');
  record(rows, 'more-make', 'Search inside notes', 'Search inside notes', 'menuitem', 'opens the window (swept in search)', 'works');
  await more('People and organisations');
  assert.ok(await waitFor(H, `document.querySelector('main .nv-page-name')?.innerText?.includes('People')`), 'People and organisations lands on People');
  record(rows, 'more-make', 'People and organisations', 'People and organisations', 'menuitem', 'lands on People (swept in people)', 'works');
  await more('Graph');
  assert.ok(await waitFor(H, `!!document.querySelector('.bg-canvas, .nj-graph-body')`, 90000), 'Graph lands');
  record(rows, 'more-make', 'Graph', 'Graph', 'menuitem', 'lands on the graph (swept in graph)', 'works');

  const mine = assertArea(rows, 'more-make');
  console.log(`[t152-more-make] ${mine.length} controls pressed, all answered`);
});
