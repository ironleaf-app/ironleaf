// node --test tests/money-receipt-bill.test.mjs — a dropped receipt matched to its bill, offered never silent
// (10.0 v10money): the open bill its words name when the amount and the day fit too, named in the preview, the
// Inbox suggestion and the filing words, and never marked paid except by the person's own press. Made-up bills,
// shops and amounts only; a fixed day (Mon 2 Nov 2026). Each check fails without its change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-receiptbill-'));
let F, M;
const NOW = new Date(2026, 10, 2, 8, 30);
const TODAY = '2026-11-02';
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/finance.ts'), platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export { RecordModules, isReceiptFile } from ${JSON.stringify(path.join(root, 'src/main/record-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const billText = (props) => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Notes\n`;
const noteOf = (p, type, content) => {
  const props = {};
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (m)
    for (const line of m[1].split('\n')) {
      const kv = /^(\w+):\s*(.*)$/.exec(line);
      if (kv) props[kv[1]] = kv[2].replace(/^"|"$/g, '');
    }
  return { path: p, title: p.split('/').pop().replace(/\.md$/, ''), props, content, type };
};
const billsOf = (defs) => F.financeModel(defs.map(([name, props]) => noteOf(`Me/Finance/Bills/${name}.md`, 'bill', billText(props))), NOW).bills;
const AREAS = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }) };

/** A made-up vault with a Finance module, tracking moves, with faked receipt file words. */
function moneyVault(files, fileWords = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const existing = new Set(Object.keys(files));
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => existing.has(rel) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true } } }),
    writeNote: async (rel, text) => {
      existing.add(rel);
      index.set(rel, text, 0, text.length);
    },
    importFiles: async (picked, folder) => picked.map((f) => `${folder}/${path.posix.basename(f)}`),
    pickFiles: async () => [],
    movePath: async (from, to) => {
      existing.delete(from);
      existing.add(to);
      return { path: to };
    },
    post: () => 0,
    requireCreate: async () => {},
    now: () => NOW,
    fileText: async (rel) => fileWords[rel] ?? null,
  });
  return { index, existing, rm };
}

const INTERNET = ['Harbour Internet', { amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' }];
const RECEIPT = { merchant: 'HARBOUR INTERNET', total: 89, date: '2026-11-03' };
const RECEIPT_WORDS = ['HARBOUR INTERNET', '3 Nov 2026', 'Internet 50/20  $89.00', 'TOTAL  $89.00'].join('\n');

// ── The match itself ───────────────────────────────────────────────────────────────────────────────────────────────

test('a receipt names its bill when the name, amount and day fit', () => {
  const bills = billsOf([INTERNET]);
  assert.deepEqual(F.receiptBillMatch(RECEIPT, bills, TODAY), { path: 'Me/Finance/Bills/Harbour Internet.md', name: 'Harbour Internet', why: 'Same name and amount, due Thu 5 Nov' });
  // A little give for fees and rounding: fifty cents either way still offers.
  assert.equal(F.receiptBillMatch({ ...RECEIPT, total: 89.5 }, bills, TODAY)?.name, 'Harbour Internet');
  assert.equal(F.receiptBillMatch({ ...RECEIPT, total: 88.2 }, bills, TODAY)?.name, 'Harbour Internet');
  // A percent on a big bill (a $15 fee on $2,000) still offers; more does not.
  const big = billsOf([['Harbour Line', { amount: '2000.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet' }]]);
  assert.equal(F.receiptBillMatch({ merchant: 'HARBOUR LINE', total: 2015, date: '2026-11-03' }, big, TODAY)?.name, 'Harbour Line');
  assert.equal(F.receiptBillMatch({ merchant: 'HARBOUR LINE', total: 2025, date: '2026-11-03' }, big, TODAY), null);
});

test('no match offered for the wrong amount, a far day, a tie, a paid or paused bill, or no bills', () => {
  const bills = billsOf([INTERNET, ['Streamly', { kind: 'Subscription', amount: '18.99', cycle: 'Monthly', due: '2026-11-18', category: 'Subscriptions', autopay: 'Yes' }]]);
  assert.equal(F.receiptBillMatch({ ...RECEIPT, total: 50 }, bills, TODAY), null, 'a part payment is never matched silently');
  assert.equal(F.receiptBillMatch({ ...RECEIPT, total: 91 }, bills, TODAY), null, 'two dollars over is outside the give');
  assert.equal(F.receiptBillMatch({ ...RECEIPT, date: '2026-09-01' }, bills, TODAY), null, 'two months before its due day: an old receipt');
  assert.equal(F.receiptBillMatch({ merchant: 'WOOLWORTHS METRO', total: 6.3, date: '2026-11-02' }, bills, TODAY), null, 'groceries name no bill');
  assert.equal(F.receiptBillMatch(RECEIPT, [], TODAY), null, 'no bills at all');
  // Two bills with the same name: a tie names neither, never the wrong one.
  const tied = [...bills, ...F.financeModel([noteOf('Me/Finance/Bills/Harbour Internet 2.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet' }))], NOW).bills.map((b) => ({ ...b, name: 'Harbour Internet' }))];
  assert.equal(F.receiptBillMatch(RECEIPT, tied, TODAY), null);
  // Already paid for this occurrence: nothing to offer.
  const paid = billsOf([['Harbour Internet', { amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', paid: '2026-11-03' }]]);
  assert.equal(F.receiptBillMatch(RECEIPT, paid, TODAY), null);
  // Paused, cancelled and done bills are never offered.
  for (const status of ['Paused', 'Cancelled']) {
    const off = billsOf([['Harbour Internet', { amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', status }]]);
    assert.equal(F.receiptBillMatch(RECEIPT, off, TODAY), null, status);
  }
  const once = billsOf([['Harbour Internet', { amount: '89.00', cycle: 'Once', due: '2026-10-01', category: 'Phone and internet', paid: '2026-10-01' }]]);
  assert.equal(F.receiptBillMatch({ ...RECEIPT, date: '2026-10-01' }, once, TODAY), null, 'a one-off already paid');
});

// ── The offer at every door: preview, Inbox, filing ────────────────────────────────────────────────────────────────

function billedVault() {
  return moneyVault({
    ...AREAS,
    'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' }),
    'Me/Finance/Bills/Streamly.md': billText({ kind: 'Subscription', amount: '18.99', cycle: 'Monthly', due: '2026-11-18', category: 'Subscriptions', autopay: 'Yes' }),
    'Inbox/harbour.png': 'bytes',
  });
}

test('the preview and the Inbox carry the matching bill', async () => {
  const { rm } = billedVault();
  const seen = await rm.previewReceipt(RECEIPT_WORDS);
  assert.deepEqual([seen.merchant, seen.total, seen.date, seen.category, seen.duplicate], ['HARBOUR INTERNET', 89, '2026-11-03', 'Phone and internet', false]);
  assert.deepEqual(seen.bill, { path: 'Me/Finance/Bills/Harbour Internet.md', name: 'Harbour Internet', why: 'Same name and amount, due Thu 5 Nov' });
  const item = { id: 'Inbox/harbour.png', kind: 'file', path: 'Inbox/harbour.png', text: '', words: 'harbour.png', task: false, embeds: ['Inbox/harbour.png'], links: [] };
  const { rm: withWords } = moneyVault(
    { ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' }), 'Inbox/harbour.png': 'bytes' },
    { 'Inbox/harbour.png': RECEIPT_WORDS },
  );
  assert.deepEqual((await withWords.inboxReceipt(item)).bill?.name, 'Harbour Internet', 'a dropped photo names its bill');
  assert.equal((await rm.previewReceipt('WOOLWORTHS METRO\nTOTAL $6.30')).bill, undefined, 'groceries carry no bill');
});

test('filing offers the bill in words and never marks it paid', async () => {
  const { index, rm } = billedVault();
  const filed = await rm.fileReceipt(RECEIPT_WORDS);
  assert.match(filed.words, /Filed the receipt in Money: HARBOUR INTERNET, \$89\.00 on 2026-11-03 \(Phone and internet\)\./);
  assert.match(filed.words, /This looks like the Harbour Internet bill \(Same name and amount, due Thu 5 Nov\)\. Mark it paid in Money\./);
  assert.deepEqual(filed.bill?.name, 'Harbour Internet');
  assert.doesNotMatch(filed.words, /—/, 'no em dashes in product words');
  // Never silent: the bill itself is untouched (no paid day, no paid line, still due).
  const bill = index.content('Me/Finance/Bills/Harbour Internet.md');
  assert.doesNotMatch(bill, /paid: 2026-11-03/);
  assert.doesNotMatch(bill, /marked paid/i);
  const model = F.financeModel([noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', bill)], NOW);
  assert.equal(model.bills[0].next, '2026-11-05', 'still due, still to be marked paid by the person');
  // Filed twice is still filed once, and Undo still takes only its row.
  await assert.rejects(() => rm.fileReceipt(RECEIPT_WORDS), /already filed in Money/);
  await rm.undoReceipt(filed.undo);
  assert.doesNotMatch(index.content('Me/Finance/Spending/2026-11.md'), /HARBOUR/);
});

test('an Inbox photo files with the offer, and a bill-less receipt files without one', async () => {
  const { rm } = moneyVault(
    { ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' }), 'Inbox/harbour.png': 'bytes' },
    { 'Inbox/harbour.png': RECEIPT_WORDS },
  );
  const item = { id: 'Inbox/harbour.png', kind: 'file', path: 'Inbox/harbour.png', text: '', words: 'harbour.png', task: false, embeds: ['Inbox/harbour.png'], links: [] };
  const filed = await rm.fileInboxReceipt(item);
  assert.match(filed.words, /This looks like the Harbour Internet bill/);
  assert.deepEqual(filed.bill?.path, 'Me/Finance/Bills/Harbour Internet.md');
  const plain = await rm.fileReceipt('WOOLWORTHS METRO\nTOTAL $6.30');
  assert.doesNotMatch(plain.words, /looks like/, 'no bill fits: no offer sentence at all');
  assert.equal(plain.bill, undefined);
});
