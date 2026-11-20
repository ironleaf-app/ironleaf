// node --test tests/t17-one-product-break.test.mjs — one product step 1, second break-it round (8 Nov 2026):
// three faults the step-1 tests missed, all when Vault's window AND its view in the former host app's window
// are open together (the switch's Vault plus anything opening Vault alone: a link, a reminder, an agent).
//  1. The close handshake answers the wrong waiter: CLOSE_READY resolves BOTH the window's and the view's
//     waiter, so the first page to save releases the other surface's close too, with its edits unsaved.
//  2. Showing a note in the view moves the window too: openInView broadcasts note:reveal/note:show to both
//     surfaces instead of the view alone.
//  3. Every prompt parents to the former host app's window while the view is attached, even when the person is
//  working in
//     Vault's own window: the prompt opens behind it. The focused surface owns the prompt.
// Made-up data only; each check fails without its fix (text over src/main/app.ts, as vault-view.test.mjs does:
// no Electron here, so the wiring is pinned where it is written).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
const block = (from, len) => {
  const at = src.indexOf(from);
  assert.ok(at >= 0, `${from} exists`);
  return src.slice(at, at + len);
};

test('CLOSE_READY answers only the surface that saved (never both waiters at once)', () => {
  const h = block('handle(CLOSE_READY,', 1200);
  // Both waiters still exist (the window's close and the view's flush share the words).
  assert.match(h, /closeReady\?\.\(\)/, 'the window waiter resolves');
  assert.match(h, /viewReady\?\.\(\)/, 'the view waiter resolves');
  // But each resolves only when ITS page answered: the sender decides which one.
  assert.match(h, /event\.sender/, 'the answering page is told apart by its sender');
  assert.match(h, /win\.webContents|fromWindow/, 'the window page resolves the window waiter');
  assert.match(h, /viewContents|fromView/, 'the view page resolves the view waiter');
});

test('openInView shows the note in the view alone (the window stays where it was)', () => {
  const fn = block('async function openInView(', 1400);
  assert.ok(!fn.includes("send('note:reveal'"), 'note:reveal goes to the view, never the broadcast');
  assert.ok(!fn.includes("send('note:show'"), 'note:show goes to the view, never the broadcast');
  assert.match(fn, /viewContents\.send|sendToView/, 'the view is sent to directly');
});

test('a prompt parents to the surface in use when both are open (never behind the window)', () => {
  const fn = block('function promptOwner()', 1200);
  assert.match(fn, /host\.viewParent/, 'in the view, the host window');
  assert.match(fn, /return win/, 'otherwise Vault own window');
  assert.match(fn, /isFocused/, 'with both open, the focused surface owns the prompt');
});
