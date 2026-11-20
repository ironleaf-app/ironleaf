// node --test tests/note-rail-width.test.mjs — the note's side panel stays a slim, fixed-width
// column (5 Nov 2026, at a wide window). The strip, the open Context rail and the doc strip hold
// 260 to 300 px at 3456x1408, 2560x1080, 1920x1117 and 1219x709 with a long real note and a short
// one, in live and in reading mode; the folded bar stays a 40 px bar; no line divides the page down
// the middle (the rail carries no left border); the note stays the visual centre of the page.
// Outline, Tags and Context stay beside the note; what links here reads once at the foot
// (t22-note-once, 8 Nov 2026). Fails first (220 px rails, a 1 px mid-page line, the note pinned
// left).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[3456, 1408], [2560, 1080], [1920, 1117], [1219, 709]];

const P = 'The hall holds two hundred when the back wall folds away, and the caterers want the final headcount a fortnight out, so the plan is to confirm numbers on the Friday and send the seating map the following Monday. ';
const longNote = `---
type: note
tags: [harbourline, launch, review]
---
# Harbour fit-out review

${P.repeat(4)}

## What is working

${P.repeat(6)}

## Roster notes

${P.repeat(6)}

## Supplier list

${P.repeat(4)}

| Supplier | Item | Cost |
|---|---|---|
| ShadeCo | Awning | $1,200 |
| RopeCo | Rope | $340 |

## Changes

${P.repeat(4)}
`;
const shortNote = `---
type: note
tags: [harbourline]
---
# Milk run

Buy milk and bread on the way home.

## Shops

Coles first, then the bakery.

## List

${P.repeat(2)}
`;
const docNote = `---
type: doc
---
# Harbour runbook

## Summary

How the weekend roster runs.

## Setup

Open the roster and fill Friday nights first.

## Roster

See the [[Harbour fit-out review]] for context.

## Changes

- 2026-11-02: Added the Friday rule.
`;

const { startHarness } = await import('./vault-controls-harness.mjs');
let H;
let ev;
let send;
const key = async (keyName, code, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
};
const openNote = async (name) => {
  await key('o', 'KeyO', 2);
  await sleep(1200);
  await send('Input.insertText', { text: name });
  await sleep(1200);
  await key('Enter', 'Enter', 0);
  await sleep(4500);
  assert.ok(await ev(`!!document.querySelector('.note-view')`), `${name} opens`);
};
// Quick-open reuses the tab, so the mode stays as left: flip it only when needed.
const ensureMode = async (want) => {
  for (let i = 0; i < 3; i++) {
    const mode = await ev(`document.querySelector('.note-view')?.className ?? ''`);
    if (mode.includes(`mode-${want}`)) return;
    await key('e', 'KeyE', 2);
    await sleep(2000);
  }
  assert.fail(`the note never turned ${want}`);
};
const measure = () => ev(`(() => {
  const q = (s) => document.querySelector(s);
  const rail = q('.nv-note-layout .nv-rail');
  const main = q('.nv-note-layout .nv-note-main');
  const layout = q('.nv-note-layout');
  const rb = rail?.getBoundingClientRect();
  const mb = main?.getBoundingClientRect();
  const lb = layout?.getBoundingClientRect();
  return {
    railCls: rail?.className ?? 'NONE',
    railW: rb ? Math.round(rb.width) : -1,
    borderL: rail ? getComputedStyle(rail).borderLeftWidth : null,
    centreDiff: mb && lb ? Math.abs((mb.x + mb.width / 2) - (lb.x + lb.width / 2)) : -1,
  };
})()`);
const railAt = async (W, Ht) => {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: Ht, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  return measure();
};
// A slim fixed column, centred with the note: the rail holds 260 to 300 px, carries no
// dividing line, and the note's middle sits near the page's middle (half a rail off).
const checkPanel = async (label) => {
  for (const [W, Ht] of SIZES) {
    const m = await railAt(W, Ht);
    const where = `${label} at ${W}x${Ht} (${m.railCls})`;
    assert.ok(m.railW >= 260 && m.railW <= 300, `${where}: the panel holds 260 to 300 px, saw ${m.railW}`);
    assert.equal(m.borderL, '0px', `${where}: no line down the page`);
    assert.ok(m.centreDiff <= 200, `${where}: the note stays the visual centre (off by ${Math.round(m.centreDiff)})`);
  }
};

before(async () => {
  H = await startHarness();
  ev = H.browser.ev;
  send = (m, p) => H.browser.send(m, p);
  for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
  await sleep(1500);
  writeFileSync(path.join(H.vaultDir, 'Harbour fit-out review.md'), longNote);
  writeFileSync(path.join(H.vaultDir, 'Milk run.md'), shortNote);
  writeFileSync(path.join(H.vaultDir, 'Launch retro.md'), '# Launch retro\n\nWhat worked: the [[Harbour fit-out review]] held up. Also [[Milk run]].\n');
  writeFileSync(path.join(H.vaultDir, 'Docs/Harbour runbook.md'), docNote);
  await H.services.rescanAll();
  await ev(`localStorage.setItem('nv.noteRail.open', '0')`);
  await send('Page.navigate', { url: `${H.origin}/harness.html` });
  for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
  await sleep(1500);
}, 240000);

after(async () => H && (await H.close()));

test('a long note: the strip is slim, quiet and centred at every size', async () => {
  await ev(`localStorage.setItem('nv.noteRail.open', '0')`);
  await openNote('Harbour fit-out review');
  await ensureMode('live');
  // Nothing a person uses is lost: the outline jumps, Context opens, and what links here opens from the foot.
  assert.ok(await ev(`[...document.querySelectorAll('.nv-strip-section h3')].some((h) => h.textContent.includes('On this page'))`), 'the outline stays');
  assert.ok(await ev(`[...document.querySelectorAll('.nv-strip-section h3')].some((h) => h.textContent.includes('Tags'))`), 'Tags stay');
  assert.ok(await ev(`!!document.querySelector('.nv-strip-context')`), 'Context stays one click away');
  assert.ok(await ev(`![...document.querySelectorAll('.nv-rail h3')].some((h) => h.textContent.includes('Linked here'))`), 'Linked here left the strip for the foot');
  // The foot's widget only draws near the viewport: scroll the note to its end first.
  await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 1e9)`);
  await sleep(1200);
  for (let i = 0; i < 40; i++) {
    const t = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
    if (t.includes('Launch retro')) break;
    await sleep(500);
  }
  assert.ok(await ev(`(document.querySelector('.note-foot')?.textContent ?? '').includes('Launch retro')`), 'the foot’s Linked list names what links here');
  await ev(`document.querySelector('.note-editor .cm-scroller')?.scrollTo(0, 0)`);
  await sleep(800);
  await checkPanel('the long note');
}, 240000);

test('a short note: the same slim panel at every size', async () => {
  await openNote('Milk run');
  await ensureMode('live');
  await checkPanel('the short note');
}, 240000);

test('Context open: the rail holds its width, still quiet', async () => {
  await ev(`localStorage.setItem('nv.noteRail.open', '1')`);
  await openNote('Harbour fit-out review');
  await ensureMode('live');
  assert.equal(await ev(`document.querySelector('.nv-rail') ? document.querySelector('.nv-rail').className : ''`), 'nv-rail', 'the rail opens');
  // Project and Area stay settable: the quiet line opens the choice, as a person would.
  await ev(`document.querySelector('.nv-rail-belonging-none')?.click()`);
  await sleep(600);
  assert.ok(await ev(`document.querySelectorAll('.nv-rail-field select').length === 2`), 'Project and Area stay settable');
  await checkPanel('Context open');
  await ev(`localStorage.setItem('nv.noteRail.open', '0')`);
}, 240000);

test('reading mode: the same slim panel beside the page', async () => {
  await ev(`localStorage.setItem('nv.noteRail.open', '0')`);
  await openNote('Harbour fit-out review');
  await ensureMode('reading');
  await checkPanel('reading');
}, 240000);

test('every other room showing the panel: a doc and a daily note', async () => {
  await openNote('Harbour runbook');
  const doc = await railAt(3456, 1408);
  assert.ok(doc.railW >= 260 && doc.railW <= 300, `the doc's panel holds 260 to 300 px, saw ${doc.railW}`);
  assert.equal(doc.borderL, '0px', 'the doc carries no dividing line');
  await openNote('2026-11-04');
  const daily = await railAt(3456, 1408);
  assert.ok(daily.railCls.includes('is-shut'), 'the daily note folds the panel to its bar');
  assert.ok(daily.railW <= 64, `the folded bar stays a bar, saw ${daily.railW}`);
}, 240000);
