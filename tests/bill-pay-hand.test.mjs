// node --test tests/bill-pay-hand.test.mjs — paying bills by hand from the window
// (9.5 fresh eyes, 2 Nov 2026): an autopay bill paid by hand is markable where it
// shows (F1); the window's Mark paid carries a different amount and account (F2);
// Next 90 days names its biggest money out (F3). Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-billpay-'));
let F, R, A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * as F from ${src('src/shared/finance.ts')};`, `export * as R from ${src('src/renderer/src/views/modules/billRow.ts')};`, `export * as A from ${src('src/shared/record-modules-api.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { (await import('node:fs')).symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  ({ F, R, A } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-02';
// A bill as the window holds it: only the fields the row rule reads.
const bill = (over = {}) => ({ path: 'Me/Finance/Bills/Credit Card.md', name: 'Credit Card', kind: 'Bill', amount: 150, cycle: 'Monthly', anchor: '2026-11-08', category: 'Cards', account: 'Everyday', autopay: false, status: 'Active', paid: null, next: '2026-11-08', days: 6, overdue: false, monthly: 150, history: [], change: null, ...over });

test('F1: a bill paid by hand shows its tick, autopay ones too', () => {
  // The case: an autopay bill paid by hand days before its day.
  assert.equal(R.payableByHand(bill({ autopay: true }), TODAY), true);
  assert.equal(R.payableByHand(bill({ autopay: false }), TODAY), true);
  // An overdue autopay bill (its debit may not have gone through) is payable by hand.
  assert.equal(R.payableByHand(bill({ autopay: true, next: '2026-10-08', days: -25, overdue: true }), TODAY), true);
  // Just paid: Paid plus its next day, never payable twice.
  assert.equal(R.payableByHand(bill({ paid: '2026-11-01', next: '2026-12-08', days: 36 }), TODAY), false);
  // Paused or done (no coming day): nothing to pay.
  assert.equal(R.payableByHand(bill({ next: null, days: null, status: 'Paused' }), TODAY), false);
});

test('F2: the window Mark paid carries a different amount and account', async () => {
  const calls = [];
  const api = A.recordModulesApi(async (channel, ...args) => (calls.push([channel, ...args]), 'said'));
  await api.markPaid('Me/Finance/Bills/Credit Card.md', '2026-11-02', { amount: 200, account: 'Everyday' });
  assert.deepEqual(calls, [['recmod:mark-paid', 'Me/Finance/Bills/Credit Card.md', '2026-11-02', 200, 'Everyday']]);
  // The old two-word call still works: the bill's own amount, from its own account.
  await api.markPaid('Me/Finance/Bills/Credit Card.md');
  assert.deepEqual(calls[1], ['recmod:mark-paid', 'Me/Finance/Bills/Credit Card.md', undefined, null, '']);
});

test('F3: the look-ahead names its biggest money out', () => {
  const events = [
    { date: '2026-11-08', name: 'Credit Card', kind: 'bill', amount: 150 },
    { date: '2026-11-15', name: 'Pay', kind: 'income', amount: 4000 },
    { date: '2026-11-20', name: 'Harbour Internet', kind: 'bill', amount: 89 },
  ];
  // Money out is positive for bills: the largest bill, never the pay.
  assert.deepEqual(F.biggestOut(events), { date: '2026-11-08', name: 'Credit Card', kind: 'bill', amount: 150 });
  assert.equal(F.biggestOut([{ date: '2026-11-15', name: 'Pay', kind: 'income', amount: 4000 }]), undefined);
  assert.equal(F.biggestOut([]), undefined);
});
