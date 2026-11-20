// node --test tests/edit-where-shown.test.mjs — everything is editable where shown (Nov 2026). One value
// edited on each page with the real mouse and keys (CDP), read back from the note's plain file on disk: a
// note's properties (a field and an inline field), a project page, a person page, a meeting page, a Tasks
// row, a Money bill, Today's next five, and the Projects list rows and board. Escape cancels. Dates open with
// a real double-click and are set the way the calendar would (the native picker cannot be driven headless —
// the vault-inline-facts precedent); every key and click around them is real CDP.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { openSettings, startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], summary';

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftIso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoOf(d);
};
const YESTERDAY = shiftIso(-1);
const PLUS_30 = shiftIso(30);
const PLUS_60 = shiftIso(60);

let h;
const readVault = (rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');

before(async () => {
  h = await startHarness();
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2200);
  await h.browser.ev(`(function () {
    if (window.__ewsErrs) return 'kept';
    window.__ewsErrs = [];
    window.addEventListener('error', (e) => window.__ewsErrs.push(String((e.error && e.error.stack) || e.message || e).slice(0, 300)));
    window.addEventListener('unhandledrejection', (e) => window.__ewsErrs.push('reject: ' + String((e.reason && e.reason.stack) || e.reason).slice(0, 300)));
    return 'trap';
  })()`);
  // Made-up content on the harness vault, through the real note writes: a Bills list, a dated line for
  // Today's next five (the projects keep one open step, so it ranks in the five), an inline field, and areas
  // on disk (read live) so Money reads its folder.
  const BILLS = `---
type: bills-table
table: bills
version: 1
---
# Bills

One line per bill. You can read this file; the Money page reads it too.

| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Harbour Internet | Bill | 89.00 | Monthly | 2026-11-12 | Phone and internet | Everyday |  | No | Active |  |  |
| Water | Bill |  | Monthly | 2026-11-20 | Home and utilities |  |  | No | Active |  |  |
`;
  const harbour = readVault('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md')
    .replace('- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05', '- [x] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05')
    .replace('- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06', '- [x] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06');
  const museum = readVault('Projects/Museum Late Shift/Museum Late Shift.md').replace('- [ ] Publish the November roster — Priya Nair — due 2026-10-28', '- [x] Publish the November roster — Priya Nair — due 2026-10-28');
  const daily = `# 4 November 2026

- [ ] Water the plants
- [x] Read the brief
- [ ] Book the plumber \u{1F4C5} ${YESTERDAY}
`;
  const receipts = `---
tags: [design]
topic: Receipts
---
# Receipts v2

The new receipt. Linked from [[Harbourline Cart Fix]].

Status:: growing
`;
  for (const [rel, content] of [
    ['Me/Finance/Bills.md', BILLS],
    ['Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', harbour],
    ['Projects/Museum Late Shift/Museum Late Shift.md', museum],
    ['Daily/2026-11-04.md', daily],
    ['Notes/Receipts v2.md', receipts],
  ]) {
    const r = await h.browser.ev(`window.nv.notes.write(${JSON.stringify(rel)}, ${JSON.stringify(content)}).then(() => 'ok', (e) => 'ERR:' + e.message)`);
    assert.equal(r, 'ok', `write ${rel}: ${r}`);
  }
  mkdirSync(path.join(h.vaultDir, '.neuralvault'), { recursive: true });
  writeFileSync(path.join(h.vaultDir, '.neuralvault', 'areas.json'), JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }));
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
  await h.browser.ev(`(function () {
    window.__ewsErrs = window.__ewsErrs || [];
    window.addEventListener('error', (e) => window.__ewsErrs.push(String((e.error && e.error.stack) || e.message || e).slice(0, 300)));
    window.addEventListener('unhandledrejection', (e) => window.__ewsErrs.push('reject: ' + String((e.reason && e.reason.stack) || e.reason).slice(0, 300)));
    return 'trap';
  })()`);
});
after(async () => {
  await h?.close().catch(() => {});
});

async function waitFor(js, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 140)}`);
    await sleep(300);
  }
}

/** A control clicked the suite's way (navigation only — every edit below is the real mouse and keys). */
async function clickWords(words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND:' + ${JSON.stringify(words)};
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED:' + ${JSON.stringify(words)};
  })()`);
  assert.equal(r, `CLICKED:${words}`, `click ${words} ${scope}`);
}

/** A place opened from the side bar, else from the More menu by name. */
async function gotoPlace(label) {
  // Settings lives in the account menu (the chip at the sidebar's foot), not as a sidebar row.
  if (label === 'Settings') {
    assert.equal(await openSettings(h), 'CLICKED', 'Settings opens');
    return;
  }
  const side = await h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const roots = [...document.querySelectorAll('.sidebar.left, aside')];
    const els = roots.flatMap((root) => [...root.querySelectorAll(${JSON.stringify(SEL)})]).filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').split(' ').includes(${JSON.stringify(label)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  if (side === 'CLICKED') return;
  await clickWords('More', '.sidebar.left, aside');
  await clickWords(label, '.menu, [role="menu"]');
}

async function ctrlK(query) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await waitFor(`!!document.querySelector('.picker input')`, 8000);
  await h.browser.send('Input.insertText', { text: query });
  await sleep(900);
}

// --- real input (the edits) ---------------------------------------------------
async function ptOf(js) {
  return h.browser.ev(`(() => {
    const el = ${js};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: Math.min(r.x + r.width / 2, window.innerWidth - 2), y: Math.min(r.y + r.height / 2, window.innerHeight - 2) };
  })()`);
}
const ptSel = (sel) => ptOf(`document.querySelector(${JSON.stringify(sel)})`);
async function tapAt(x, y, count = 1) {
  x = Math.round(x);
  y = Math.round(y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
  await sleep(350);
}
async function tapSel(sel, count = 1) {
  const p = await ptSel(sel);
  assert.ok(p, `visible: ${sel}`);
  await tapAt(p.x, p.y, count);
}
async function tapJs(js) {
  const p = await ptOf(js);
  assert.ok(p, `visible: ${js.slice(0, 100)}`);
  await tapAt(p.x, p.y, 1);
}
/** A value double-clicked with the real mouse, the editors' gesture. */
async function dbltap(sel) {
  const p = await ptSel(sel);
  assert.ok(p, `visible: ${sel}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  for (const n of [1, 2]) {
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
  }
  await sleep(450);
}
/** The same, on an element found by script (a row's own editor). */
async function dbltapJs(js) {
  const p = await ptOf(js);
  assert.ok(p, `visible: ${js.slice(0, 100)}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  for (const n of [1, 2]) {
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
  }
  await sleep(450);
}
async function key(name, code, vcode, mods = 0) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vcode, modifiers: mods });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vcode, modifiers: mods });
  await sleep(120);
}
/** The open field's words replaced and saved with Enter (Ctrl+A, the words, Enter — all real). */
async function typeInto(text) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(180);
  await h.browser.send('Input.insertText', { text });
  await sleep(300);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'char', text: '\\r' });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1500);
}
/** A date picked the way the calendar would: the field opens with a real double-click; the day is set as the
 *  picker would set it (the native picker eats real keys headless and cannot be driven — the vault-inline-facts
 *  precedent), and the file proves the save. */
async function pickDate(iso) {
  await h.browser.ev(`(() => { const i = document.querySelector('.pj-date-input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, 'CAL-PLACEHOLDER'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`.replace('CAL-PLACEHOLDER', iso));
  await sleep(1500);
}

/** The file's words within a wait (saves are async). */
async function waitFile(rel, want, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const text = readVault(rel);
    if (text.includes(want)) return text;
    if (Date.now() - t0 > ms) throw new Error(`${rel} never held ${JSON.stringify(want)}:\n${text.slice(0, 800)}`);
    await sleep(400);
  }
}

/** A note opened from Ctrl+K by name. */
async function openNote(name) {
  await ctrlK(name);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const row = rows.find((r) => (r.querySelector('.picker-label')?.innerText ?? '').includes(${JSON.stringify(name)}));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `the ${name} note opens from Ctrl+K`);
  await waitFor(`!!document.querySelector('.note-fields, .note-view, .reading-view')`, 15000);
  await sleep(800);
}

test("a note's properties: a field and an inline field change where they show, saved to the note", async () => {
  await openNote('Receipts v2');
  await h.browser.ev(`document.querySelector('.note-fields-fold')?.click()`);
  await waitFor(`document.querySelector('.note-fields-fold')?.getAttribute('aria-expanded') === 'true'`);
  // A field: clicked, replaced, Enter — the real keys throughout.
  await tapSel(`[data-field="topic"] textarea`);
  await typeInto('Receipts v2');
  await waitFile('Notes/Receipts v2.md', 'topic: Receipts v2');
  // An inline field ("Status:: …" in the words) changes in the same rows, on its own line.
  await tapSel(`[data-inline-field="Status"] textarea`);
  await typeInto('sown');
  await waitFile('Notes/Receipts v2.md', 'Status:: sown');
});

test('a project page: the summary changes with E, saved to the project file', async () => {
  await gotoPlace('Projects');
  await clickWords('Harbourline Cart Fix', 'main');
  await waitFor(`!!document.querySelector('.pj-page')`);
  await sleep(900);
  // The keyboard's gesture: the value takes the focus, E opens it.
  await tapSel('.w2a-psub .pj-ed');
  await key('e', 'KeyE', 69);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto("The shop's cart is fixed and stays fixed.");
  await waitFile('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', "The shop's cart is fixed and stays fixed.");
});

test('a person page: role, organisation and contact facts change where they show', async () => {
  await gotoPlace('People');
  await clickWords('Alex Chen', 'main');
  await waitFor(`!!document.querySelector('.w2b-person')`);
  await sleep(900);
  assert.equal(await h.browser.ev(`!!document.querySelector('.w2b-person [aria-label^="role"]')`), true, 'the role edits where it shows');
  assert.equal(await h.browser.ev(`!!document.querySelector('.w2b-person [aria-label^="email"]')`), true, 'the email edits where it shows');
  assert.equal(await h.browser.ev(`document.querySelector('.w2b-person .pill.slate')?.title`), 'From your meetings with them.', 'Last met says where it comes from');
  // The organisation (read from the email until set) changes with a double-click.
  await dbltap('.w2b-person [aria-label^="organisation"]');
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('Harbourline Shop');
  await waitFile('People/Alex Chen.md', 'org: Harbourline Shop');
});

test('a meeting page: where it is changes where it shows, saved to the meeting note', async () => {
  await ctrlK('Cart standup');
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const row = rows.find((r) => (r.querySelector('.picker-label')?.innerText ?? '').includes('Cart standup'));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', 'the standup note opens from Ctrl+K');
  await waitFor(`!!document.querySelector('.mt-top')`);
  await sleep(900);
  assert.equal(await h.browser.ev(`!!document.querySelector('.mt-top .pj-ed-date')`), true, 'the day edits where it shows');
  assert.equal(await h.browser.ev(`!!document.querySelector('.mt-top [aria-label^="Who is in it"]')`), true, 'who is in it edits where it shows');
  await tapSel('.mt-top [aria-label="Add a place"]');
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('The big room');
  await waitFile('Meetings/2026-11-03 Cart standup.md', 'The big room');
});

test('Tasks rows: who does it changes on the row, saved to the note', async () => {
  await gotoPlace('Tasks');
  await waitFor(`!![...document.querySelectorAll('.tkrow')].find((r) => r.innerText.includes('Call the bank'))`);
  const rowJs = `[...document.querySelectorAll('.tkrow')].find((r) => r.innerText.includes('Call the bank'))`;
  assert.equal(await h.browser.ev(`!!(${rowJs})?.querySelector('.tkrow-when .pj-ed-date, .tkrow-when [aria-label="Day"]')`), true, 'the day edits on the row');
  await tapJs(`(${rowJs})?.querySelector('.tkrow-who .pj-ed')`);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('Sam Lee');
  await waitFile('Inbox.md', 'Sam Lee');
});

test('Money bills: what a bill costs changes on its page, saved to the Bills list', async () => {
  await gotoPlace('Settings');
  await clickWords('Packs', 'main');
  const on = await h.browser.ev(`(() => {
    const el = document.querySelector('section.packrow input.switch[aria-label="Money on"]');
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'nearest' });
    if (!el.checked) el.click();
    return 'clicked';
  })()`);
  assert.equal(on, 'clicked', 'Money switches on in Settings › Packs');
  await sleep(1200);
  await ctrlK('Money');
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === 'Money' && text(r, '.picker-detail') === 'Pack') ?? rows.find((r) => text(r, '.picker-label') === 'Money');
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', 'Money opens from Ctrl+K');
  await waitFor(`!![...document.querySelectorAll('.trow')].find((r) => r.innerText.includes('Water'))`);
  const waterJs = `[...document.querySelectorAll('.trow')].find((r) => r.innerText.includes('Water'))`;
  assert.equal(await h.browser.ev(`!!(${waterJs})?.querySelector('.pj-ed-date')`), true, 'when it is due edits on the row');
  await h.browser.ev(`(${waterJs})?.querySelector('button.t')?.click()`);
  await waitFor(`!![...document.querySelectorAll('.p87-sec .glabel')].find((e) => e.innerText.includes('Price history'))`);
  await sleep(800);
  assert.equal(await h.browser.ev(`!!document.querySelector('[aria-label^="Due date"]')`), true, 'when it is due edits on the page');
  await tapSel('[aria-label="Set amount"]');
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('120');
  await waitFile('Me/Finance/Bills.md', '120.00');
});

test("Today's next five: a line's day changes on the row, saved to the note", async () => {
  await gotoPlace('Today');
  await waitFor(`!!document.querySelector('section.td-next')`);
  const rowJs = `[...document.querySelectorAll('section.td-next .th-due-row')].find((r) => r.innerText.includes('Book the plumber'))`;
  assert.ok(await h.browser.ev(`!!(${rowJs})`), 'the dated line ranks in the next five');
  assert.equal(await h.browser.ev(`!!(${rowJs})?.querySelector('button.check')`), true, 'it ticks where it shows');
  await dbltapJs(`(${rowJs})?.querySelector('.pj-ed-date')`);
  await waitFor(`!!document.querySelector('.pj-date-input')`);
  await pickDate(PLUS_30);
  await waitFile('Daily/2026-11-04.md', PLUS_30);
});

test('Projects list rows: the due date changes on the row, saved to the project file', async () => {
  await gotoPlace('Projects');
  await waitFor(`!![...document.querySelectorAll('.w2a-rowbtn')].find((r) => r.innerText.includes('Harbourline Cart Fix'))`);
  const rowJs = `[...document.querySelectorAll('.w2a-rowbtn')].find((r) => r.innerText.includes('Harbourline Cart Fix'))`;
  assert.equal(await h.browser.ev(`!!(${rowJs})?.querySelector('[aria-label^="Project\\u2019s name"]')`), true, 'the name edits on the row');
  assert.equal(await h.browser.ev(`!!(${rowJs})?.querySelector('button[title="Change how it is going"]')`), true, 'how it is going changes from its pill');
  assert.equal(await h.browser.ev(`(${rowJs})?.querySelector('.meta [title]')?.title`), "Counted from the project's open tasks.", 'the count says where it comes from (t249: one kind called Task)');
  await dbltapJs(`(${rowJs})?.querySelector('.pj-ed-date')`);
  await waitFor(`!!document.querySelector('.pj-date-input')`);
  await pickDate(PLUS_60);
  await waitFile('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', PLUS_60);
});

test('Projects board: the owner changes on the card, saved to the project file', async () => {
  await gotoPlace('Projects');
  await clickWords('Board', 'main');
  await waitFor(`!![...document.querySelectorAll('.bcard')].find((c) => c.innerText.includes('Harbourline Cart Fix'))`);
  await sleep(600);
  await dbltapJs(`[...document.querySelectorAll('.bcard')].find((c) => c.innerText.includes('Harbourline Cart Fix'))?.querySelector('.who .pj-ed')`);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await typeInto('Sam Lee');
  await waitFile('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', 'owner: Sam Lee');
});

test('Escape leaves the value as it was: nothing is written', async () => {
  await gotoPlace('Tasks');
  await waitFor(`!![...document.querySelectorAll('.tkrow')].find((r) => r.innerText.includes('shop awning'))`);
  await tapJs(`[...document.querySelectorAll('.tkrow')].find((r) => r.innerText.includes('shop awning'))?.querySelector('.tkrow-who .pj-ed')`);
  await waitFor(`!!document.querySelector('.pj-ed-input')`);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(180);
  await h.browser.send('Input.insertText', { text: 'Zelda Zee' });
  await sleep(300);
  await key('Escape', 'Escape', 27);
  await sleep(1200);
  assert.equal(await h.browser.ev(`!!document.querySelector('.pj-ed-input')`), false, 'the field is gone');
  assert.ok(!readVault('Inbox.md').includes('Zelda Zee'), 'nothing was written');
});

test('no page errors while every value changed', async () => {
  const errs = await h.browser.ev(`(window.__ewsErrs || [])`);
  assert.deepEqual(errs, [], 'the console stayed clean');
});
