// node --test tests/t152-notes.test.mjs — t152 (9 Nov 2026): every control on
// Notes, on a note page (header, rail, foot) and in one peek does what it
// says, on the 3,000-note vault. Real renderer, real input; each control is
// judged by what a person would see plus what landed in the files.
// T152_OUT=path writes the rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickMenuItem, clickWords, ctrlK, openSidebar, diffFiles, fileMap, makeRows, PAGENAME, readVault, record, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const NOTE_STAY = `!!document.querySelector('.cm-editor')`;
const NOTE_POSITIONS = [
  `(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight; })()`,
  `(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = 0; })()`,
];

async function openNote() {
  await openSidebar(H, 'Notes');
  await waitFor(H, PAGENAME('Notes'));
  await ctrlK(H);
  assert.ok(await waitFor(H, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for the note');
  await H.browser.send('Input.insertText', { text: 'Kickoff' });
  await sleep(900);
  assert.equal(
    await H.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Kickoff')); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`),
    'CLICKED',
    'the Kickoff note opens',
  );
  await waitFor(H, NOTE_STAY);
  await sleep(1500);
}

/** The foot's peek-row for exactly `title`, opened. */
async function openPeek(title) {
  await H.browser.ev(`(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight; })()`);
  await waitFor(H, `!!document.querySelector('.note-foot')`);
  await sleep(600);
  const ROW = `[...document.querySelectorAll('.note-foot button.peek-row')].some((e) => (e.querySelector('.peek-row-title')?.innerText ?? '').trim() === ${JSON.stringify(title)})`;
  if (!(await waitFor(H, ROW, 15000))) return 'NO-ROW';
  const at = await H.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.note-foot button.peek-row')].filter((e) => e.getBoundingClientRect().width > 2);
    const el = rows.find((e) => (e.querySelector('.peek-row-title')?.innerText ?? '').trim() === ${JSON.stringify(title)});
    if (!el) return 'NOTFOUND:' + rows.length;
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    return 'CLICKED';
  })()`);
  if (at !== 'CLICKED') return at;
  if (!(await waitFor(H, `document.title.includes(${JSON.stringify(title)})`, 8000))) return 'NO-DOC';
  await sleep(600);
  if (await H.browser.ev(`!!document.querySelector('.peek')`)) return 'PEEKED';
  return 'OPENED';
}

test('Notes: every control works, on the big vault', { timeout: 1200000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-notes] ${m}`));

  // 'Make a copy' is skipped in blind passes (one press on a 1,400-note
  // folder buried the pass in copies): one explicit check per target kind
  // proves the one mechanism (A.duplicatePath), then tidies up.
  await openNote();
  {
    const before = fileMap(H);
    assert.equal(await clickWords(H, 'More', 'main'), 'CLICKED', 'the note header menu opens');
    assert.ok(await waitFor(H, `!!document.querySelector('.menu, [role="menu"]')`), 'the note menu shows');
    assert.equal(await clickMenuItem(H, 'File'), 'CLICKED', 'the File submenu opens');
    await sleep(400);
    assert.equal(await clickMenuItem(H, 'Make a copy'), 'CLICKED', 'Make a copy runs');
    await sleep(1500);
    const added = diffFiles(before, fileMap(H)).filter((p) => !p.endsWith('(gone)'));
    assert.equal(added.length, 1, `one file is added, not ${added.length} (${added.slice(0, 3).join(', ')})`);
    assert.equal(readVault(H, added[0]), readVault(H, 'Projects/Harbourline Cart Fix/Notes/Kickoff.md'), 'the copy reads as the note');
    record(rows, 'notes', 'note', 'Make a copy (note)', 'menuitem', `adds ${added[0]}, same words`, 'works', added);
    await H.services.invoke('path:trash', [added[0]]).catch(() => {});
  }
  {
    await openSidebar(H, 'Notes');
    await waitFor(H, PAGENAME('Notes'));
    // A small listed folder (the rail hides the machinery): prefer the
    // one-file folders, whatever the rail calls them.
    const mores = await H.browser.ev(`[...document.querySelectorAll('main button.frow-more')].map((e) => e.getAttribute('aria-label') ?? '')`);
    const want = ['Docs', 'Bills', 'Notes', 'Templates'].map((f) => `More for ${f}`).find((w) => mores.includes(w)) ?? mores[0];
    assert.ok(want, `a folder menu is listed (${mores.length} found)`);
    const target = want.replace(/^More for /, '');
    const before = fileMap(H);
    assert.equal(await clickWords(H, want, 'main'), 'CLICKED', `the ${target} folder menu opens`);
    assert.ok(await waitFor(H, `!!document.querySelector('.menu, [role="menu"]')`), 'the folder menu shows');
    assert.equal(await clickMenuItem(H, 'Make a copy'), 'CLICKED', 'Make a copy runs');
    await sleep(2500);
    const added = diffFiles(before, fileMap(H)).filter((p) => !p.endsWith('(gone)'));
    assert.ok(added.length >= 1, `the folder copy adds its files (${added.length})`);
    assert.ok(added.every((p) => !p.startsWith(`${target}/`)), `the copy lands beside, not inside (${added.slice(0, 3).join(', ')})`);
    record(rows, 'notes', 'Notes', `Make a copy (folder ${target})`, 'menuitem', `adds ${added.length} files beside the folder`, 'works', added);
    const top = added[0].includes('/') ? added[0].slice(0, added[0].indexOf('/')) : added[0];
    await H.services.invoke('path:trash', [top]).catch(() => {});
  }

  // 'Make the doc' is pressed blind later too, but only this check proves the
  // mechanism (t191: with no docs:create the press made nothing and broke the
  // window): one doc, made in Docs and opened in the editor, then tidied up.
  {
    await openSidebar(H, 'Notes');
    await waitFor(H, PAGENAME('Notes'));
    await H.browser.ev(`(() => { const el = [...document.querySelectorAll('main .w2b-folders .frow')].filter((e) => e.getBoundingClientRect().width > 2).find((e) => (e.innerText || '').includes('Docs')); if (el) el.click(); })()`);
    await sleep(800);
    assert.equal(await clickWords(H, 'New doc', 'main'), 'CLICKED', 'the Docs New doc button is there');
    assert.ok(await waitFor(H, `!!document.querySelector('.picker')`, 5000), 'the kind picker opens');
    assert.equal(
      await H.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').trim() === 'Blank doc'); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`),
      'CLICKED',
      'the Blank doc kind picks',
    );
    assert.ok(await waitFor(H, `[...document.querySelectorAll('[role="dialog"]')].some((e) => (e.innerText || '').includes('Make the doc'))`, 5000), 'the name prompt opens');
    await H.browser.ev(`(() => { const el = document.querySelector('.dialog input'); if (el) el.focus(); })()`);
    await sleep(200);
    const before = fileMap(H);
    const errsBefore = await H.browser.ev(`window.__nvErrors.length`);
    await H.browser.send('Input.insertText', { text: 'Harbour pilot' });
    await sleep(400);
    assert.equal(await H.browser.ev(`[...document.querySelectorAll('.dialog button')].find((e) => (e.innerText || '').includes('Make the doc'))?.disabled`), false, 'the typed name enables Make the doc');
    assert.equal(await clickWords(H, 'Make the doc', '.dialog'), 'CLICKED', 'Make the doc runs');
    assert.ok(await waitFor(H, NOTE_STAY), 'the new doc opens in the editor');
    const added = diffFiles(before, fileMap(H)).filter((p) => !p.endsWith('(gone)'));
    assert.equal(added.length, 1, `one file is added, not ${added.length} (${added.slice(0, 3).join(', ')})`);
    assert.ok(added[0].startsWith('Docs/') && added[0].endsWith('.md'), `the doc is made in Docs (${added[0]})`);
    assert.match(readVault(H, added[0]), /^---\r?\n[\s\S]*?^type:\s*doc\s*$/m, 'the doc reads as a doc');
    assert.equal(await H.browser.ev(`window.__nvErrors.length`), errsBefore, 'the window throws nothing');
    record(rows, 'notes', 'Notes', 'Make the doc (explicit)', 'menuitem', `adds ${added[0]} and opens it`, 'works', added);
    await H.services.invoke('path:trash', [added[0]]).catch(() => {});
  }

  const open = async () => {
    await openSidebar(H, 'Notes');
    await waitFor(H, PAGENAME('Notes'));
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, PAGENAME('Notes')), 'Notes lands on the big vault');
  await sweepPage(H, rows, 'notes', 'Notes', { open, stayJS: PAGENAME('Notes'), scope: 'main' });

  await openNote();
  assert.ok(await waitFor(H, NOTE_STAY), 'the note lands');
  await sweepPage(H, rows, 'notes', 'note', { open: openNote, stayJS: NOTE_STAY, scope: 'main', positions: NOTE_POSITIONS });

  // Typing in the editor changes the note on disk (the control all edits go through).
  await H.browser.ev(`(() => { const el = document.querySelector('.cm-content'); el.focus(); })()`);
  await sleep(200);
  const fp0 = fileMap(H);
  await H.browser.send('Input.insertText', { text: ' More words.' });
  await sleep(2500);
  const changed = diffFiles(fp0, fileMap(H));
  record(rows, 'notes', 'note', 'editor typing', 'editor', changed.length ? `note file changed (${changed.join(', ')})` : 'nothing happened', changed.length ? 'works' : 'DEAD', changed);

  // One connected row's document (a person's card from the foot): it opens in the main view, never the side
  // panel (t239, brief-directed).
  assert.equal(await openPeek('Alex Chen'), 'OPENED', `the foot's Alex Chen row opens the person`);

  const mine = assertArea(rows, 'notes');
  console.log(`[t152-notes] ${mine.length} controls pressed, all answered`);
});
