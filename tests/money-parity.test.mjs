// node --test tests/money-parity.test.mjs — Ironleaf side of the former host app↔Vault money parity
// (9.5 lnvparity, 2 Nov 2026): every pinned gap in ns/tests/seam-money-parity.mjs (O1..O15,
// S1..S14) closed here so both doors do the same thing for the same words. Made-up vault only, in a
// temp folder; fixed days. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-mparity-'));
let F, X, M;
const NOW = new Date(2026, 10, 2, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * as F from ${src('src/shared/finance.ts')};`, `export * as X from ${src('src/shared/record-module-tools.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${src('src/main/record-modules.ts')};`, `export { VaultIndex } from ${src('src/main/indexer.ts')};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { (await import('node:fs')).symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  ({ F, X } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const billText = (props) => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`;
const noteOf = (p, type, content) => {
  const props = {};
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (m) for (const line of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) props[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
  return { path: p, title: p.split('/').pop().replace(/\.md$/, ''), props, content, type };
};
function moneyVault(files, now = NOW) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const written = new Map(Object.entries(files));
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => written.has(rel) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true }, documents: { on: true } } }),
    writeNote: async (rel, text) => { written.set(rel, text); index.set(rel, text, 0, text.length); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => ({ path: to }),
    post: () => 0,
    requireCreate: async () => {},
    now: () => now,
  });
  return { dir, index, written, rm };
}
const AREAS = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }) };

test('F1: a Spending row keeps its account as a link, like the bill does', async () => {
  // Pure writer: bare, path and link forms all land as [[Everyday]].
  const out = F.withSpendRows(F.newSpendingText('2026-11'), [
    { date: '2026-11-02', what: 'Harbour Internet', category: 'Phone and internet', amount: 89, account: 'Everyday' },
    { date: '2026-11-03', what: 'Water', category: 'Home and utilities', amount: 120, account: 'Me/Finance/Accounts/Everyday' },
    { date: '2026-11-04', what: 'Power', category: 'Home and utilities', amount: 200, account: '[[Everyday]]' },
  ]);
  assert.match(out, /\| 2026-11-02 \| Harbour Internet \| Phone and internet \| 89\.00 \| \[\[Everyday\]\] \|/);
  assert.match(out, /\| 2026-11-03 \| Water \| Home and utilities \| 120\.00 \| \[\[Everyday\]\] \|/);
  assert.match(out, /\| 2026-11-04 \| Power \| Home and utilities \| 200\.00 \| \[\[Everyday\]\] \|/);
  // Mark paid from a bill whose account is bare still links it.
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-28', category: 'Phone and internet', account: 'Everyday' }) });
  await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-11-02');
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\[\[Everyday\]\]/);
});

test('F2: an account named by its path resolves, unknown says so', () => {
  const finance = [
    noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-28', category: 'Phone and internet' })),
    noteOf('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\nkind: Everyday\n---\n'),
  ];
  const input = { finance, documents: [], on: ['finance'], today: NOW };
  const byPath = X.planMarkPaid({ bill: 'Harbour Internet', account: 'Me/Finance/Accounts/Everyday.md' }, input);
  assert.equal(byPath.account, 'Everyday');
  assert.match(byPath.words, /from Everyday/);
  const byLink = X.planMarkPaid({ bill: 'Harbour Internet', account: '[[Me/Finance/Accounts/Everyday]]' }, input);
  assert.equal(byLink.account, 'Everyday');
  const unknown = X.planMarkPaid({ bill: 'Harbour Internet', account: 'Nope' }, input);
  assert.equal(unknown.account, '');
  assert.match(unknown.words, /account “Nope” isn’t in Money/);
  const receipt = X.planReceiptAdd({ date: '2026-11-02', what: 'Corner Market', amount: 24.5, account: 'Me/Finance/Accounts/Everyday' }, input);
  assert.equal(receipt.row.account, 'Everyday');
});

test('F3: a refund nets its purchase category, never Refunds or spending', async () => {
  const finance = [
    noteOf('Me/Finance/Spending/2026-10.md', 'spending-month', F.withSpendRows(F.newSpendingText('2026-10'), [{ date: '2026-10-02', what: 'STREAMLY.COM', category: 'Subscriptions', amount: 16.99 }])),
  ];
  const input = { finance, documents: [], on: ['finance'], today: NOW };
  const refund = X.planReceiptAdd({ date: '2026-11-02', what: 'STREAMLY.COM', amount: -20 }, input);
  assert.equal(refund.row.amount, -20);
  assert.equal(refund.row.category, 'Subscriptions');
  assert.match(refund.words, /refund/i);
  const explicit = X.planReceiptAdd({ date: '2026-11-03', what: 'STREAMLY.COM', amount: -20, category: 'Refunds' }, input);
  assert.equal(explicit.row.category, 'Subscriptions', 'an explicit Refunds is not a bucket');
  const { written, rm } = moneyVault({ ...AREAS });
  await rm.addSpends([{ date: '2026-11-02', what: 'STREAMLY.COM', category: 'Subscriptions', amount: -20 }]);
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\| 2026-11-02 \| STREAMLY\.COM \| Subscriptions \| -20\.00 \|/);
});

test('F4: the amount given when a bill is marked paid is recorded, not dropped', async () => {
  const finance = [noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-28', category: 'Phone and internet' }))];
  const input = { finance, documents: [], on: ['finance'], today: NOW };
  const plan = X.planMarkPaid({ bill: 'Harbour Internet', amount: 95 }, input);
  assert.equal(plan.amount, 95);
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-28', category: 'Phone and internet' }) });
  await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-11-02', true, undefined, 95);
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\| 2026-11-02 \| Harbour Internet \| Phone and internet \| 95\.00 \|/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /amount: 95/);
  assert.equal(F.priceHistory(written.get('Me/Finance/Bills/Harbour Internet.md')).length, 2);
});

test('F5: a card repayment by hand leaves the same Transfers trace as the bank file', async () => {
  const { written, rm, index } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Credit Card.md': billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' }) });
  await rm.markPaid('Me/Finance/Bills/Harbour Credit Card.md', '2026-11-01');
  const spend = written.get('Me/Finance/Spending/2026-11.md');
  assert.match(spend, /\| 2026-11-01 \| Harbour Credit Card \| Transfers \| 150\.00 \|/);
  const m = F.financeModel([
    noteOf('Me/Finance/Bills/Harbour Credit Card.md', 'bill', written.get('Me/Finance/Bills/Harbour Credit Card.md')),
    noteOf('Me/Finance/Spending/2026-11.md', 'spending-month', spend),
  ], NOW);
  const nov = m.months.find((x) => x.month === '2026-11');
  assert.deepEqual([nov.total, nov.transfers], [0, 150]);
});

test('F6: a bank import that marks a bill paid writes the same Notes line as Mark paid', async () => {
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Credit Card.md': billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' }) });
  await rm.importApply({ rows: [], paid: [{ bill: 'Me/Finance/Bills/Harbour Credit Card.md', date: '2026-11-01' }] });
  const card = written.get('Me/Finance/Bills/Harbour Credit Card.md');
  assert.match(card, /paid: 2026-11-01/);
  assert.match(card, /- Paid \$150\.00 on Sun 1 Nov\. This cycle is covered: paid by hand before the autopay day Sun 8 Nov\./);
});

test('F7: due maths for short cycles and late first payments', async () => {
  // Fortnightly paid 7 days early covers the coming one, not the prior.
  assert.equal(F.occurrenceCoveredBy('2026-11-08', 'Fortnightly', '2026-11-01'), '2026-10-25', 'pins the half-window landing before the fix');
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Cleaner.md': billText({ amount: '80.00', cycle: 'Fortnightly', due: '2026-11-08', category: 'Home and utilities' }) }, new Date(2026, 10, 1, 10, 0));
  await rm.markPaid('Me/Finance/Bills/Cleaner.md', '2026-11-01');
  assert.match(written.get('Me/Finance/Bills/Cleaner.md'), /due: 2026-11-22/, 'coming fortnight, not the prior');
  // Late first payment covers the overdue, never skips it.
  const { written: w2, rm: rm2 } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Water.md': billText({ amount: '120.00', cycle: 'Monthly', due: '2026-10-01', category: 'Home and utilities' }) }, new Date(2026, 9, 24, 10, 0));
  await rm2.markPaid('Me/Finance/Bills/Water.md', '2026-10-24');
  assert.match(w2.get('Me/Finance/Bills/Water.md'), /due: 2026-11-01/, 'overdue covered, next is November');
});

test('F8: an unknown cycle is refused with the valid list, never silently Monthly', () => {
  const ctx = { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: NOW, currency: 'AUD', notes: { finance: [], documents: [] } };
  assert.throws(() => X.planRecordModuleWrite('finance_bill_add', { name: 'Cleaner', amount: 80, cycle: 'every 6 weeks', category: 'Home and utilities' }, ctx), /Weekly, Fortnightly, Monthly, Quarterly, Half-yearly, Yearly, Once/);
  const ok = X.planRecordModuleWrite('finance_bill_add', { name: 'Cleaner', amount: 80, cycle: 'Fortnightly', category: 'Home and utilities' }, ctx);
  assert.match(ok.text, /cycle: Fortnightly/);
});

test('F9: a retried Mark paid says already paid, never throws nor doubles', async () => {
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-28', category: 'Phone and internet' }) });
  await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-11-02');
  const retry = await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-11-02');
  assert.match(retry, /already marked paid/);
  assert.equal((written.get('Me/Finance/Spending/2026-11.md').match(/Harbour Internet \| Phone and internet \| 89\.00/g) ?? []).length, 1);
  assert.equal((written.get('Me/Finance/Bills/Harbour Internet.md').match(/^- Paid /gm) ?? []).length, 1);
});
