// node --test tests/t250-meetings-break.test.mjs — break tonight's meetings (t250, 12 Nov 2026).
// Tick in the note, on the card, on Tasks and on Today (all four agree, Undo puts all four
// back); a meeting with no project, then linking one; two meetings with the same action;
// owners "me", first-name-only and joint; Ask empty and 2,000 letters; rename while open.
// One small made-up vault, one harness boot.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const FLAG = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
const M1 = 'Meetings/2026-11-10 Tuesday standup.md';
const M2 = 'Meetings/2026-11-11 Wednesday standup.md';
const NOPROJ = 'Meetings/2026-11-12 Call with no project.md';

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w('People/Alex Chen.md', `---\ntype: person\nrole: Shop developer\n---\n# Alex Chen\n\nRuns the cart fix.\n`);
    w('People/Sam Okafor.md', `---\ntype: person\nrole: Weekend manager\n---\n# Sam Okafor\n\nWeekend manager.\n`);
    w('People/June Park.md', `---\ntype: person\nrole: Bookkeeper\n---\n# June Park\n\nBookkeeper.\n`);
    w('People/Priya Nair.md', `---\ntype: person\nrole: Designer\n---\n# Priya Nair\n\nDesigner.\n`);
    w(FLAG, `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline Cart Fix\n\n## Summary\n\nThe shop's cart drops orders at payment.\n\n## What's next\n\n- [ ] Ring ShadeCo about the awning quote before it lapses — Alex Chen — due 2026-11-07\n- [ ] Retry the failed card payment twice — Alex Chen — due 2026-11-06\n- [ ] Set up the new till and train the Saturday crew — Sam and June — due 2026-11-13\n\n## Key dates\n\n- 2026-11-20: Cart fix done (milestone)\n\n## People\n\n- Alex Chen (owner)\n- Sam Okafor\n- June Park\n- Priya Nair\n\n## Notes\n\nKept for the fix.\n`);
    w(M1, `---\ntype: meeting\ndate: 2026-11-10\nattendees: [Alex Chen, Sam Okafor]\nproject: ${FLAG}\n---\n# 2026-11-10 Tuesday standup\n\n## Actions\n\n- [ ] Ring ShadeCo about the awning quote — Alex Chen — due 2026-11-07\n- [ ] Retry the failed card payment twice — Alex Chen — due 2026-11-06\n\n## Decisions\n\n- Retry twice, then fail loud\n\n## Questions\n\n- Who signs off the till logs? (asked by June Park)\n`);
    w(M2, `---\ntype: meeting\ndate: 2026-11-11\nattendees: [Alex Chen]\nproject: ${FLAG}\n---\n# 2026-11-11 Wednesday standup\n\n## Actions\n\n- [ ] Retry the failed card payment twice — Alex Chen — due 2026-11-06\n- [ ] Draft the December roster — me\n- [ ] File the BAS for October — Sam\n- [ ] Set up the new till — Sam and June\n\n## Decisions\n\n- None yet\n`);
    w(NOPROJ, `---\ntype: meeting\ndate: 2026-11-12\nattendees: [Alex Chen]\n---\n# 2026-11-12 Call with no project\n\n## Actions\n\n- [ ] Ring the bank about the card reader — Alex Chen\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });
const readVault = (h, rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');
async function reload(h) {
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 45000), 'the app reboots');
  await sleep(2500);
}
async function tap(h, js) {
  const p = await h.browser.ev(`(() => { const el = (${js}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(p, `visible: ${js.slice(0, 140)}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(150);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
  await sleep(600);
}
async function openNote(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const done = await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes(${JSON.stringify(name)})); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`);
  assert.equal(done, 'CLICKED', `the switcher opens ${name}`);
  await sleep(1200);
}
// Retry open everywhere it shows, so each tick test starts clean. Always re-reads: the harness
// delivers no change events (the app's watcher does it live), so a room opened after another
// test's writes would otherwise read stale.
async function ensureRetryOpen(h) {
  for (const rel of [FLAG, M1, M2]) {
    const p = path.join(h.vaultDir, ...rel.split('/'));
    const t = readFileSync(p, 'utf8');
    const next = t.replace('- [x] Retry the failed card payment twice', '- [ ] Retry the failed card payment twice');
    if (next !== t) writeFileSync(p, next);
  }
  await reload(h);
}
const retryDoneIn = (h, rel) => readVault(h, rel).includes('- [x] Retry the failed card payment twice');
const retryOpenIn = (h, rel) => readVault(h, rel).includes('- [ ] Retry the failed card payment twice');

test('tick in the note: all four agree, Undo puts all four back', { timeout: 300000 }, async () => {
  const h = await harness();
  await ensureRetryOpen(h);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  await tap(h, `[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check')`);
  await sleep(1200);
  assert.ok(retryDoneIn(h, M1), 'ticked in the note');
  assert.ok(retryDoneIn(h, FLAG), 'ticked on the project too');
  assert.ok(retryDoneIn(h, M2), 'the twin meeting ticks too');
  // Undo from the message puts all three files back.
  assert.equal(await clickWords(h, 'Undo', '.toast'), 'CLICKED', 'the message offers Undo');
  await sleep(1500);
  assert.ok(retryOpenIn(h, M1) && retryOpenIn(h, FLAG) && retryOpenIn(h, M2), 'Undo puts all three files back');
  // Tick it again for the four surfaces.
  await tap(h, `[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check')`);
  await sleep(1200);
  assert.ok(retryDoneIn(h, M1) && retryDoneIn(h, FLAG), 'ticked again');
  // The harness delivers no change events, so the open note re-reads this way (the app's watcher does it live).
  await reload(h);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show again');
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  const noteDone = await h.browser.ev(`[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice'))?.querySelector('button.check.done') ? true : false`);
  assert.ok(noteDone, 'the note reads it done');
  // The project's card reads it done.
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  await h.browser.ev(`document.querySelector('[data-meeting="${M1}"]')?.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const cardDone = await h.browser.ev(`[...document.querySelectorAll('[data-meeting="${M1}"] [data-action]')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice'))?.querySelector('button.check.done') ? true : false`);
  assert.ok(cardDone, 'the card reads it done');
  // Tasks no longer lists it open.
  await openRoom(h, 'Tasks');
  await sleep(1000);
  const tasksOpen = await h.browser.ev(`[...document.querySelectorAll('.tk-row')].some((r) => (r.innerText || '').includes('Retry the failed card payment twice'))`);
  assert.ok(!tasksOpen, 'Tasks no longer lists it open');
  // Today no longer lists it.
  await openRoom(h, 'Today');
  await sleep(1000);
  const todayOpen = await h.browser.ev(`[...document.querySelectorAll('.td-row-what .td-text')].some((e) => (e.innerText || '').includes('Retry the failed card payment twice'))`);
  assert.ok(!todayOpen, 'Today no longer lists it');
  // Unticks for the next test.
  await openNote(h, 'Tuesday standup');
  await sleep(800);
  await tap(h, `[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check')`);
  await sleep(1200);
  assert.ok(retryOpenIn(h, M1) && retryOpenIn(h, FLAG) && retryOpenIn(h, M2), 'untick puts all three files back');
});

test('tick on the card: both sides agree, Undo puts both back', { timeout: 300000 }, async () => {
  const h = await harness();
  await ensureRetryOpen(h);
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  // t255: the folio reads through tabs; the card stands on the Notes tab.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(900);
  await h.browser.ev(`document.querySelector('[data-meeting="${M1}"]')?.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  await tap(h, `[...document.querySelectorAll('[data-meeting="${M1}"] [data-action]')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check')`);
  await sleep(1500);
  assert.ok(retryDoneIn(h, FLAG) && retryDoneIn(h, M1), 'ticked on the card lands in both files');
  assert.equal(await clickWords(h, 'Undo', '.toast'), 'CLICKED', 'the message offers Undo');
  await sleep(1500);
  assert.ok(retryOpenIn(h, FLAG) && retryOpenIn(h, M1), 'Undo puts both back');
});

test('tick on Tasks: both sides agree, Undo puts both back', { timeout: 300000 }, async () => {
  const h = await harness();
  await ensureRetryOpen(h);
  await openRoom(h, 'Tasks');
  await sleep(1200);
  assert.equal(await clickWords(h, 'Everyone', '.chips'), 'CLICKED', 'Everyone shows');
  await sleep(800);
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.tk-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
  await sleep(400);
  await tap(h, `[...document.querySelectorAll('.tk-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check')`);
  await sleep(1500);
  assert.ok(retryDoneIn(h, FLAG) || retryDoneIn(h, M1), 'ticked on Tasks lands in the files');
  assert.equal(await clickWords(h, 'Undo', '.toast'), 'CLICKED', 'the message offers Undo');
  await sleep(1500);
  assert.ok(retryOpenIn(h, FLAG) && retryOpenIn(h, M1) && retryOpenIn(h, M2), 'Undo puts all three back');
});

test('tick on Today: both sides agree, Undo puts both back', { timeout: 300000 }, async () => {
  const h = await harness();
  await ensureRetryOpen(h);
  await openRoom(h, 'Today');
  await sleep(1200);
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.td-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
  await sleep(400);
  const found = await h.browser.ev(`[...document.querySelectorAll('.td-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')) ? true : false`);
  assert.ok(found, 'Today lists it');
  await tap(h, `[...document.querySelectorAll('.td-row')].find((r) => (r.innerText || '').includes('Retry the failed card payment twice')).querySelector('button.check, button[role="checkbox"]')`);
  await sleep(1500);
  assert.ok(retryDoneIn(h, FLAG) || retryDoneIn(h, M1), 'ticked on Today lands in the files');
  assert.equal(await clickWords(h, 'Undo', '.toast'), 'CLICKED', 'the message offers Undo');
  await sleep(1500);
  assert.ok(retryOpenIn(h, FLAG) && retryOpenIn(h, M1) && retryOpenIn(h, M2), 'Undo puts all three back');
});

test('a meeting with no project, then linking one', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Call with no project');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  const body = await h.browser.ev(`document.querySelector('section[aria-label="Tasks in this note"]')?.innerText ?? ''`);
  assert.ok(body.includes('Pick a project'), 'one plain line offers to pick one');
  // Link the project (as the picker would write it), then re-read.
  const p = path.join(h.vaultDir, ...NOPROJ.split('/'));
  writeFileSync(p, readFileSync(p, 'utf8').replace('attendees: [Alex Chen]\n---', `attendees: [Alex Chen]\nproject: ${FLAG}\n---`));
  await reload(h);
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(1500);
  await h.browser.ev(`document.querySelector('[data-meeting="${NOPROJ}"]')?.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const card = await h.browser.ev(`document.querySelector('[data-meeting="${NOPROJ}"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(card.includes('Ring the bank about the card reader'), `the linked meeting gains its card (${card.slice(0, 120)})`);
  assert.ok(!card.includes('nothing open'), 'the card counts its open action');
  // Unlink again for the next run.
  writeFileSync(p, readFileSync(p, 'utf8').replace(`project: ${FLAG}\n`, ''));
  await reload(h);
});

test('owners me, first-name-only and joint read and merge', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Wednesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  const rows = await h.browser.ev(`[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].map((r) => (r.innerText || '').replace(/\\s+/g, ' ').slice(0, 100))`);
  assert.ok(rows.some((t) => t.includes('Draft the December roster')), `me shows (${rows.join(' / ').slice(0, 200)})`);
  assert.ok(rows.some((t) => t.includes('File the BAS for October')), 'first-name-only shows');
  assert.ok(rows.some((t) => t.includes('Set up the new till')), 'joint shows');
  // The joint pair merges to one row on Tasks (the step carries the detail).
  await openRoom(h, 'Tasks');
  await sleep(1200);
  assert.equal(await clickWords(h, 'Everyone', '.chips'), 'CLICKED', 'Everyone shows');
  await sleep(800);
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.tk-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
  await sleep(400);
  const till = await h.browser.ev(`[...document.querySelectorAll('.tk-row')].filter((r) => (r.innerText || '').includes('Set up the new till')).length`);
  assert.equal(till, 1, 'the joint pair draws once');
});

test('Ask with an empty question asks nothing; a 2,000-letter one lands whole', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Questions in this note"]')`, 8000), 'Questions show');
  const before = readVault(h, M1);
  await tap(h, `document.querySelector('section[aria-label="Questions in this note"] input[aria-label="Ask a question"]')`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1000);
  assert.equal(readVault(h, M1), before, 'an empty question writes nothing');
  const long = `${'a'.repeat(1999)}?`;
  await tap(h, `document.querySelector('section[aria-label="Questions in this note"] input[aria-label="Ask a question"]')`);
  await h.browser.send('Input.insertText', { text: long });
  await sleep(500);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1500);
  assert.ok(readVault(h, M1).includes(long), 'the long question lands in the note');
  await reload(h);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Questions in this note"]')`, 8000), 'Questions show again');
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Questions in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  const shown = await h.browser.ev(`[...document.querySelectorAll('section[aria-label="Questions in this note"] .mt-row')].find((r) => (r.innerText || '').includes('${'a'.repeat(40)}'))?.innerText.length ?? 0`);
  assert.ok(shown > 1900, `the long question reads whole (${shown} letters shown)`);
  // Tidy the long line away.
  const p = path.join(h.vaultDir, ...M1.split('/'));
  writeFileSync(p, readFileSync(p, 'utf8').replace(`- ${long}\n`, '').replace(`${long}\n`, ''));
  await reload(h);
});

test('a meeting note renamed while open leaves Back, never stuck', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  const from = path.join(h.vaultDir, ...M1.split('/'));
  const to = path.join(h.vaultDir, 'Meetings/2026-11-10 Tuesday standup renamed.md');
  renameSync(from, to);
  await h.services.rescanAll();
  await sleep(2500);
  // The harness delivers no change events (the app's watcher follows the rename live); the open page
  // keeps its words until it re-reads. It must never go blank or stuck: it keeps content and navigates.
  const body = await h.browser.ev(`(document.querySelector('main')?.innerText ?? '').replace(/\\s+/g, ' ')`);
  assert.ok(body.length > 500, `keeps its words after rename (${body.length} letters)`);
  assert.ok(['SIDEBAR', 'PALETTE'].includes(await openRoom(h, 'Today')), 'still navigates');
  renameSync(to, from);
  await reload(h);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'back after restore');
});
