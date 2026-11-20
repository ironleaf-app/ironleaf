// node --test tests/record-modules.test.mjs — Finance and Documents and ID (Wave 5 part a): their records read from plain
// notes (src/shared/finance.ts, src/shared/id-documents.ts), their note types there only while switched on
// (src/shared/note-types.ts, src/shared/module-records.ts), their level (src/shared/sensitivity.ts), their views
// (src/shared/record-modules.ts, record-views.ts), a bank's CSV, an emailed bill, their agent tools through a gate
// (src/shared/record-module-tools.ts, src/main/record-modules.ts) and the bell's notices said once (src/main/reminders.ts).
// Made-up notes, people and amounts only; a fixed day (Sat 24 Oct 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recmod-'));
let S;
let M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(
    entry,
    ['finance', 'id-documents', 'module-records', 'record-module-tools', 'record-modules', 'record-views', 'note-types', 'sensitivity', 'life-modules', 'csv']
      .map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${JSON.stringify(path.join(root, 'src/shared', `${m}.ts`))};`)
      .join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${JSON.stringify(path.join(root, 'src/main/record-modules.ts'))};`, `export { Reminders } from ${JSON.stringify(path.join(root, 'src/main/reminders.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export { makeGate } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const bill = (props, history = '') => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n${history}\n## Notes\n`;
const note = (path, type, content) => {
  const props = {};
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (m) for (const line of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) props[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
  return { path, title: path.split('/').pop().replace(/\.md$/, ''), props, content, type };
};

// ── Bills ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('bills: the next due day from the day it falls, how often, autopay and the day last paid', () => {
  const F = S.finance;
  const t = '2026-10-24';
  // Autopay with nothing confirming it past its grace: it may not have gone through (9.2 reverses "never overdue":
  // an autopay debit with too little in the account used to roll on silently, flagged nowhere).
  assert.deepEqual(F.nextDue({ anchor: '2026-01-14', cycle: 'Monthly', paid: null, autopay: true, status: 'Active' }, t), { next: '2026-10-14', overdue: true });
  // By hand: stays due (overdue) until marked paid.
  assert.deepEqual(F.nextDue({ anchor: '2026-01-14', cycle: 'Monthly', paid: null, autopay: false, status: 'Active' }, t), { next: '2026-10-14', overdue: true });
  // Unpaid by hand, the current cycle's day is never skipped (9.2: the old fortnight look-back rolled a bill due
  // 1 Oct to 1 Nov with no flag).
  assert.deepEqual(F.nextDue({ anchor: '2026-10-01', cycle: 'Monthly', paid: null, autopay: false, status: 'Active' }, t), { next: '2026-10-01', overdue: true });
  // Paid a few days early: that one is paid, the next is next month's.
  assert.equal(F.nextDue({ anchor: '2026-01-14', cycle: 'Monthly', paid: '2026-10-11', autopay: false, status: 'Active' }, t).next, '2026-11-14');
  // Paid early for an autopay day covers the cycle (9.2, the credit-card case: paid 1 Nov, autopay due 8 Nov).
  assert.deepEqual(F.nextDue({ anchor: '2026-11-08', cycle: 'Monthly', paid: '2026-11-01', autopay: true, status: 'Active' }, '2026-11-01'), { next: '2026-12-08', overdue: false });
  assert.equal(F.occurrenceCoveredBy('2026-11-08', 'Monthly', '2026-11-01'), '2026-11-08');
  assert.equal(F.advanceAnchor('2026-11-08', 'Monthly', '2026-11-01'), '2026-12-08');
  // The 31st falls on the month's last day.
  assert.equal(F.occurrence('2026-01-31', 'Monthly', 1), '2026-02-28');
  assert.equal(F.occurrence('2026-01-31', 'Monthly', 3), '2026-04-30');
  assert.deepEqual(F.nextDue({ anchor: '2025-12-02', cycle: 'Yearly', paid: null, autopay: true, status: 'Active' }, t), { next: '2025-12-02', overdue: true }, 'a yearly autopay never confirmed flags its missed debit');
  // Within the grace week a debit gets to show up, autopay still moves on by itself.
  assert.equal(F.nextDue({ anchor: '2026-10-21', cycle: 'Fortnightly', paid: null, autopay: true, status: 'Active' }, t).next, '2026-11-04');
  assert.deepEqual(F.nextDue({ anchor: '2026-11-01', cycle: 'Once', paid: '2026-10-20', autopay: false, status: 'Active' }, t), { next: null, overdue: false });
  assert.deepEqual(F.nextDue({ anchor: '2026-01-14', cycle: 'Monthly', paid: null, autopay: true, status: 'Cancelled' }, t), { next: null, overdue: false });
  assert.equal(F.monthlyOf(120, 'Yearly'), 10);
  assert.equal(F.monthlyOf(10, 'Weekly'), 43.33);
});

test('bills: a model of bills, accounts, budgets and spending, with price changes and what is due', () => {
  const notes = [
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ kind: 'Bill', amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No', status: 'Active', account: '"[[Everyday]]"' }, '| 2026-06-01 | 79.00 | First recorded |\n| 2026-10-01 | 89.00 | Went up |\n')),
    note('Me/Finance/Bills/Streamly.md', 'bill', bill({ kind: 'Subscription', amount: '16.99', cycle: 'Monthly', due: '2026-03-03', category: 'Subscriptions', autopay: 'Yes', status: 'Active' })),
    note('Me/Finance/Bills/Car insurance.md', 'bill', bill({ amount: '960', cycle: 'Yearly', due: '2027-02-10', category: 'Insurance', autopay: 'Yes' })),
    note('Me/Finance/Bills/Old gym.md', 'bill', bill({ amount: '30', cycle: 'Monthly', due: '2026-01-05', status: 'Cancelled' })),
    note('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\ninstitution: Harbour Bank\nkind: Everyday\nnumber: "[locked](secret:abcdef123456)"\nbalance: 1200.50\n---\n'),
    note('Me/Finance/Budgets/Groceries.md', 'budget-category', '---\ntype: budget-category\namount: 600\nperiod: Monthly\n---\n'),
    note('Me/Finance/Budgets/Eating out.md', 'budget-category', '---\ntype: budget-category\namount: 50\nperiod: Weekly\n---\n'),
    note('Me/Finance/Spending/2026-10.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-10'), [
      { date: '2026-10-03', what: 'Corner Market', category: 'Groceries', amount: 182.4 },
      { date: '2026-10-01', what: 'Green Grocer', category: 'Groceries', amount: 45.1 },
      { date: '2026-10-12', what: 'Noodle Bar', category: 'Eating out', amount: 260 },
    ])),
    note('Me/Finance/Spending/2026-09.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-09'), [{ date: '2026-09-15', what: 'Corner Market', category: 'Groceries', amount: 300 }])),
  ];
  const m = S.finance.financeModel(notes, TODAY);
  assert.equal(m.bills.length, 4);
  const internet = m.bills.find((b) => b.name === 'Harbour Internet');
  assert.equal(internet.next, '2026-10-28');
  assert.equal(internet.days, 4);
  assert.equal(internet.account, 'Everyday');
  assert.deepEqual(internet.change, { from: 79, to: 89, date: '2026-10-01', recent: true });
  assert.deepEqual(m.priceChanges.map((b) => b.name), ['Harbour Internet']);
  assert.equal(m.committed, Math.round((89 + 16.99 + 80) * 100) / 100, 'the cancelled gym costs nothing; the yearly insurance is a twelfth');
  assert.deepEqual(m.dueSoon.map((b) => b.name), ['Streamly', 'Harbour Internet'], 'overdue first: Streamly’s 3 Oct autopay never confirmed (9.2)');
  assert.equal(m.accounts[0].balance, 1200.5);
  // Rows kept in date order in the month's note.
  const rows = m.spending.filter((s) => s.date.startsWith('2026-10')).map((s) => s.what);
  assert.deepEqual(rows, ['Green Grocer', 'Corner Market', 'Noodle Bar']);
  const groceries = m.budgets.find((b) => b.category === 'Groceries');
  assert.deepEqual([groceries.monthly, groceries.spent, groceries.left, groceries.progress], [600, 227.5, 372.5, 38]);
  const eating = m.budgets.find((b) => b.category === 'Eating out');
  assert.equal(eating.monthly, 216.67, 'weekly budgets are a month’s worth');
  assert.ok(eating.left < 0, 'over budget');
  assert.deepEqual(m.months.map((x) => [x.month, x.total]), [['2026-09', 300], ['2026-10', 487.5]]);
  // A new price goes in its history, the old one first when the history is empty.
  const fresh = S.finance.withPrice(bill({ amount: '16.99' }), 16.99, 18.99, '2026-10-24', 'Went up');
  assert.deepEqual(S.finance.priceHistory(fresh).map((p) => [p.date, p.amount]), [['', 16.99], ['2026-10-24', 18.99]]);
  const text = S.finance.newBillText({ name: 'Water', amount: 120.5, cycle: 'quarterly', due: '2026-11-20', category: 'Home and utilities' });
  assert.match(text, /^---\ntype: bill\n/);
  assert.match(text, /amount: 120\.50\ncycle: Quarterly\ndue: 2026-11-20/);
  assert.deepEqual(S.finance.priceHistory(text), [], 'a new bill’s first amount is not a price change: the history starts empty');
});

// ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('views: each page is a view of records, money as money, months in order, budgets against their target', () => {
  const RV = S.recordViews;
  const notes = [
    note('F/Budgets/Groceries.md', 'budget-category', '---\ntype: budget-category\namount: 600\n---\n'),
    note('F/Spending/2026-08.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-08'), [{ date: '2026-08-02', what: 'Market', category: 'Groceries', amount: 100 }])),
    note('F/Spending/2026-10.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-10'), [{ date: '2026-10-02', what: 'Market', category: 'Groceries', amount: 250 }])),
    note('F/Spending/2026-09.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-09'), [{ date: '2026-09-02', what: 'Market', category: 'Groceries', amount: 200 }])),
  ];
  const m = S.finance.financeModel(notes, TODAY);
  const records = S.recordModules.financeRecords(m);
  const fields = RV.fieldsOf(records);
  assert.equal(fields.find((f) => f.key === 'amount').type, 'money');
  const [byMonth] = S.recordModules.sectionViews('finance', 'spending', '2026-10-24');
  const chart = RV.chartData(records, byMonth, TODAY);
  assert.deepEqual(chart.points.map((p) => [p.label, p.value]), [['Aug 26', 100], ['Sep 26', 200], ['Oct 26', 250]], 'months in order, as words');
  const [budget] = S.recordModules.sectionViews('finance', 'budgets', '2026-10-24');
  const b = RV.chartData(records, budget, TODAY);
  assert.deepEqual(b.points.map((p) => [p.label, p.value, p.target]), [['Groceries', 250, 600]]);
  assert.equal(RV.cleanRecordView(JSON.parse(RV.writeRecordView(budget))).chart.target, 'budget', 'the target survives the view file');
  for (const s of ['bills', 'calendar', 'spending', 'budgets', 'accounts', 'receipts']) for (const d of S.recordModules.sectionViews('finance', s, '2026-10-24')) RV.runRecordView(records, d, TODAY);
  const dm = S.idDocuments.documentsModel([{ path: 'D/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', expires: '2027-01-10' }, content: '' }], TODAY);
  const docs = S.recordModules.documentRecords(dm);
  // A passport is said six months ahead (8.3 wave 1), so 78 days out is already soon.
  assert.equal(docs[0].fields.status, 'Expires soon');
  for (const s of ['all', 'expiry', 'cv']) assert.ok(S.recordModules.sectionViews('documents', s, '2026-10-24').length);
});

// ── A bank's CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('bank CSV: headed and headerless exports, categories (the person’s own first), duplicates, bills paid, price changes and payments that come round', () => {
  const F = S.finance;
  const parse = S.csv.parseCsv;
  const model = F.financeModel(
    [
      note('F/Bills/Harbour Internet.md', 'bill', bill({ amount: '89.00', cycle: 'Monthly', due: '2026-09-28', autopay: 'Yes', category: 'Phone and internet' })),
      note('F/Spending/2026-09.md', 'spending-month', F.withSpendRows(F.newSpendingText('2026-09'), [{ date: '2026-09-20', what: 'RIVERSIDE BAKERY 4411', category: 'Eating out', amount: 12.5 }])),
    ],
    TODAY,
  );
  const headed = parse(
    [
      'Date,Description,Debit,Credit,Balance',
      '20/09/2026,RIVERSIDE BAKERY 4411,12.50,,1000.00',
      '01/10/2026,SALARY ACME PTY,,3000.00,4000.00',
      '02/10/2026,STREAMLY.COM SUBSCRIPTION,16.99,,3983.01',
      '03/10/2026,WOOLWORTHS 1234 SYDNEY,82.10,,3900.91',
      '05/10/2026,RIVERSIDE BAKERY 4411,9.00,,3891.91',
      '28/10/2026,HARBOUR INTERNET PTY LTD,95.00,,3796.91',
      '02/09/2026,STREAMLY.COM SUBSCRIPTION,16.99,,0',
      '02/08/2026,STREAMLY.COM SUBSCRIPTION,16.99,,0',
    ].join('\n'),
  );
  const plan = F.planBankImport(headed, model, TODAY);
  assert.equal(plan.problem, undefined);
  assert.equal(plan.moneyIn, 1, 'pay left out');
  assert.equal(plan.read, 'Date, Description, Debit, Credit');
  const bakery = plan.rows.filter((r) => /RIVERSIDE/.test(r.what));
  assert.deepEqual(bakery.map((r) => [r.date, r.duplicate, r.category]), [['2026-09-20', true, 'Eating out'], ['2026-10-05', false, 'Eating out']], 'kept already; and the person’s own category for that place');
  assert.equal(plan.rows.find((r) => /WOOLWORTHS/.test(r.what)).category, 'Groceries');
  const internet = plan.rows.find((r) => /HARBOUR/.test(r.what));
  assert.equal(internet.bill, 'F/Bills/Harbour Internet.md');
  assert.deepEqual(plan.paid, [{ bill: 'F/Bills/Harbour Internet.md', date: '2026-10-28' }]);
  assert.deepEqual(plan.priceChanges.map((p) => [p.name, p.from, p.to]), [['Harbour Internet', 89, 95]]);
  assert.deepEqual(plan.newBills.map((b) => [b.name, b.amount, b.cycle, b.next, b.category]), [['Streamly', 16.99, 'Monthly', '2026-11-02', 'Subscriptions']]);
  // A bank that writes no header: date, amount (signed), words, balance; month-first days read from the values.
  const bare = parse(['10/13/2026,"-45.00","PETROL STATION 22",1200.00', '10/14/2026,"+500.00","TRANSFER IN",1700.00', '10/15/2026,"-7.20","CITY PARKING",1692.80'].join('\n'));
  const p2 = F.planBankImport(bare, { bills: [], spending: [] }, TODAY);
  assert.deepEqual(p2.rows.map((r) => [r.date, r.amount, r.category]), [['2026-10-13', 45, 'Fuel'], ['2026-10-15', 7.2, 'Transport']]);
  assert.equal(p2.moneyIn, 1);
  assert.match(F.planBankImport(parse('hello,world\nfoo,bar'), { bills: [], spending: [] }, TODAY).problem, /doesn’t look like a bank export/);
});

test('an emailed bill read from its words (amount, who, the day due), and plain words that are no bill', () => {
  const F = S.finance;
  assert.deepEqual(F.billFromWords('Your Harbour Internet bill of $95.00 is due on 3 Nov 2026', TODAY), { name: 'Harbour Internet', amount: 95, due: '2026-11-03' });
  assert.deepEqual(F.billFromWords('Invoice from Brightwater Energy: amount due $212.40 by 15/11/2026', TODAY), { name: 'Brightwater Energy', amount: 212.4, due: '2026-11-15' });
  assert.deepEqual(F.billFromWords('Harbour Internet $89 due 3 Nov 2026', TODAY), { name: 'Harbour Internet', amount: 89, due: '2026-11-03' }, 'bare "due <date>" is a bill');
  assert.equal(F.billFromWords('Lunch was $18 at the cafe', TODAY), null, 'an amount alone is no bill');
  assert.equal(F.billFromWords('Pay the water bill', TODAY), null, 'no amount, no bill');
  assert.equal(F.readMoney('$1.5k'), 1500, '"k" is thousands, never dropped');
  assert.equal(F.readMoney('$2.5M'), 2500000);
  assert.equal(F.readMoney('$95.00'), 95);
  assert.equal(F.readMoney('AUD 89'), 89);
});

test('third pass: short bank names link bills, identical buys both kept, "X bill" updates X', () => {
  const F = S.finance;
  const X = S.recordModuleTools;
  const bills = [{ name: 'Harbour Credit Card', names: ['Credit Card'], path: 'Me/Finance/Bills/Harbour Credit Card.md', amount: 200, paid: null, due: null }];
  const csv = S.csv.parseCsv(['Date,Details,Amount', '20/10/2026,CREDIT CARD AUTOPAY,-200.00'].join('\n'));
  const plan = F.planBankImport(csv, { bills, spending: [] }, TODAY);
  assert.equal(plan.rows[0]?.bill, 'Me/Finance/Bills/Harbour Credit Card.md', 'short bank name links via alias');
  const two = F.withSpendRows(F.newSpendingText('2026-10'), [
    { date: '2026-10-20', what: 'Corner Cafe Sydney', category: 'Eating out', amount: 4.5 },
    { date: '2026-10-20', what: 'Corner Cafe Sydney', category: 'Eating out', amount: 4.5 },
  ]);
  assert.equal(two.split('\n').filter((l) => l.includes('Corner Cafe')).length, 2, 'two real identical buys both kept');
  const finance = [note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' }))];
  const upd = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Internet bill', amount: 95 }, { notes: { finance }, on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY });
  assert.equal(upd.update?.path, 'Me/Finance/Bills/Harbour Internet.md', '"X bill" updates X, never a second bill');
  const unknownAcct = X.planRecordModuleWrite('finance_bill_add', { name: 'Brightwater Energy', amount: 100, category: 'Home and utilities', account: 'Everyday' }, { notes: { finance }, on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY });
  assert.match(unknownAcct.words, /account “Everyday” isn’t in Money/, 'an unknown account says so, never silent');
});

// ── Documents and ID ─────────────────────────────────────────────────────────────────────────────────────────────────

test('documents: expiry and its reminder window, CV versions, the number only ever a locked link', () => {
  const D = S.idDocuments;
  const docs = [
    { path: 'D/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', holder: 'Alex Example', expires: '2026-12-01', number: '[locked](secret:aaaaaa111111)' }, content: '' },
    { path: 'D/Driver licence (Alex).md', title: 'Driver licence (Alex)', props: { kind: 'Driver licence', expires: '2026-10-20', number: 'X1234567' }, content: '' },
    { path: 'D/First aid.md', title: 'First aid', props: { kind: 'Certificate', expires: '2028-05-01', remind: '30' }, content: '' },
    { path: 'D/CV v2.md', title: 'CV v2', props: { kind: 'CV', version: 'v2', issued: '2025-02-01' }, content: '' },
    { path: 'D/CV v3.md', title: 'CV v3', props: { kind: 'CV', version: 'v3', issued: '2026-09-01' }, content: '' },
  ];
  const m = D.documentsModel(docs, TODAY, 60);
  const by = (n) => m.documents.find((d) => d.name === n);
  assert.equal(by('Passport (Alex)').status, 'Expires soon');
  assert.equal(by('Passport (Alex)').secret, 'aaaaaa111111');
  assert.equal(by('Driver licence (Alex)').status, 'Expired');
  assert.equal(by('Driver licence (Alex)').plainNumber, true, 'a number written in the note is noticed (the page offers to move it)');
  assert.equal(by('First aid').status, 'Valid');
  assert.deepEqual(m.expiring.map((d) => d.name), ['Driver licence (Alex)', 'Passport (Alex)']);
  assert.deepEqual(m.cvs.map((d) => d.version), ['v3', 'v2']);
  assert.match(D.expiryWords(by('Passport (Alex)'), m.today), /^Expires in 38 days/);
  const text = D.newDocumentText({ kind: 'Passport', holder: 'Alex Example', number: '[locked](secret:aaaaaa111111)', expires: '2031-03-01' });
  assert.match(text, /number: "\[locked\]\(secret:aaaaaa111111\)"/);
  assert.equal(D.documentName({ kind: 'CV', version: 'v4' }), 'CV v4');
});

// ── Types, levels, switches ──────────────────────────────────────────────────────────────────────────────────────────

test('note types: a module’s types are there only while it is on, in its folder inside its area; their level is Personal either way', () => {
  const T = S.noteTypes;
  const R = S.moduleRecords;
  const areas = [{ id: 'me', folder: 'Me' }, { id: 'home', folder: 'Home' }];
  const off = T.resolveTypes(T.emptyConfig(), { topFolders: [], modules: R.moduleTypeInputs([], areas) });
  assert.ok(off.find((t) => t.id === 'bill').hidden, 'off: hidden');
  const on = T.resolveTypes(T.emptyConfig(), { topFolders: [], modules: R.moduleTypeInputs(['finance'], areas) });
  const b = on.find((t) => t.id === 'bill');
  assert.equal(b.hidden, false);
  assert.equal(b.folder, 'Me/Finance/Bills');
  assert.equal(b.module, 'finance');
  assert.ok(on.find((t) => t.id === 'id-document').hidden, 'Documents stays off');
  assert.equal(T.typeOfNote({ path: 'Me/Finance/Bills/Water.md', props: {} }, on), 'bill', 'a note in its folder is one');
  assert.equal(T.typeOfNote({ path: 'Notes/x.md', props: { type: 'bill' } }, off), 'bill', 'off, a bill is still a bill (kept, typed, levelled)');
  assert.equal(R.moduleFolder('documents', null), 'Documents and ID', 'no areas: at the top');
  // Its level: the module's, unless the person set the type's own.
  const L = S.sensitivity;
  assert.equal(L.levelOf(L.emptyStore(), 'Notes/x.md', undefined, 'bill').level, 'personal');
  assert.equal(L.levelOf(L.emptyStore(), 'Notes/x.md', undefined, 'id-document').level, 'personal');
  assert.equal(L.levelOf({ ...L.emptyStore(), types: { bill: 'open' } }, 'Notes/x.md', undefined, 'bill').level, 'open');
  assert.equal(L.allows(L.emptyStore(), 'neuralbot', 'personal'), false, 'Chat bot isn’t allowed Personal until the person ticks it');
  // The switches are 5b's (src/shared/life-modules.ts): off by default.
  assert.deepEqual(S.lifeModules.modulesOn({}).map((m) => m.id), []);
  assert.ok(S.lifeModules.moduleInfo('finance') && S.lifeModules.moduleInfo('documents'));
  // Offered only when the vault shows it would use one, never again once put away.
  const items = [{ title: 'Water bill', words: '' }, { title: 'Council rates invoice', words: '' }, { title: 'Garden', words: '' }];
  assert.deepEqual(R.moduleOffers([], {}, items).map((o) => o.module), ['finance']);
  assert.deepEqual(R.moduleOffers([], { finance: { dismissed: true } }, items), []);
  assert.deepEqual(R.moduleOffers([], {}, [{ title: '', words: 'Passport renewal form', inbox: true }]).map((o) => o.module), ['documents']);
});

test('agent tools: answers only from what the agent may read, off modules say so, writes plan a new note and never a number', () => {
  const X = S.recordModuleTools;
  const finance = [note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', autopay: 'No', category: 'Phone and internet' }))];
  const documents = [{ path: 'Me/Documents and ID/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', expires: '2026-12-01', number: '[locked](secret:aaaaaa111111)' }, content: '' }];
  const input = { finance, documents, on: ['finance', 'documents'], today: TODAY };
  const due = X.answerRecordModuleTool(input, 'finance_bills_due', {});
  assert.match(due, /1 bill due in the next 14 days, \$89\.00 in all/);
  assert.match(due, /Harbour Internet: \$89\.00 due Wed 28 Oct \(in 4 days\), you pay it by hand/);
  const docs = X.answerRecordModuleTool(input, 'document_expiring', {});
  assert.match(docs, /Passport \(Alex\).*number locked in Secrets/);
  assert.doesNotMatch(docs, /aaaaaa111111/, 'never the secret’s id, never a number');
  assert.match(X.answerRecordModuleTool({ ...input, on: ['documents'] }, 'finance_bill_list', {}), /Money module is off/);
  assert.match(X.answerRecordModuleTool({ finance: [], documents: [], on: ['finance'], refused: { finance: 3, documents: 0 }, agent: 'Chat bot', today: TODAY }, 'finance_bills_due', {}), /3 Money records are marked Personal.*Chat bot isn’t allowed/);
  const plan = X.planRecordModuleWrite('finance_bill_add', { name: 'Brightwater Energy', amount: 212.4, cycle: 'Quarterly', due: '2026-11-15', category: 'Home and utilities' }, { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY });
  assert.equal(plan.folder, 'Me/Finance/Bills');
  assert.match(plan.text, /amount: 212\.40\ncycle: Quarterly\ndue: 2026-11-15/);
  assert.throws(() => X.planRecordModuleWrite('finance_bill_add', { name: 'X' }, { on: [], areas: null }), /Money module is off/);
  const d = X.planRecordModuleWrite('document_add', { kind: 'Passport', holder: 'Alex Example', expires: '2031-03-01', number: 'P1234567' }, { on: ['documents'], areas: null, today: TODAY });
  assert.doesNotMatch(d.text, /P1234567/, 'a number an agent gives is never written');
  assert.equal(d.folder, 'Documents and ID');
});

// ── 8.3 wave 1: the look-ahead, remembered bank columns, receipts, accounts and budgets ────────────────────────────

test('look-ahead: bills, subscriptions, renewals and expected pay over 90 days, the tightest week, and whether a cost fits', () => {
  const F = S.finance;
  const notes = [
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ kind: 'Bill', amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No', status: 'Active' })),
    note('Me/Finance/Bills/Streamly.md', 'bill', bill({ kind: 'Subscription', amount: '16.99', cycle: 'Monthly', due: '2026-03-03', category: 'Subscriptions', autopay: 'Yes', status: 'Active' })),
    note('Me/Finance/Bills/Car insurance.md', 'bill', bill({ amount: '960', cycle: 'Yearly', due: '2027-01-10', category: 'Insurance', autopay: 'Yes' })),
    note('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\ninstitution: Harbour Bank\nkind: Everyday\nbalance: 1200.50\n---\n'),
  ];
  const m = F.financeModel(notes, TODAY);
  const income = F.incomeFromSettings({ income_name: 'Pay', income_amount: 2000, income_cycle: 'Monthly', income_next: '2026-11-01' });
  assert.equal(income.length, 1);
  const f = F.financeForecast(m, { days: 90, income });
  assert.equal(f.startingBalance, 1200.5);
  assert.ok(f.events.some((e) => e.name === 'Car insurance' && e.kind === 'renewal' && e.date === '2027-01-10'), 'a yearly bill is a renewal in the window');
  assert.ok(f.events.filter((e) => e.kind === 'income').length >= 2, 'pay comes round');
  assert.ok(f.tightest && f.weeks.includes(f.tightest));
  assert.equal(F.affordCheck(f, 100).ok, true);
  assert.equal(F.affordCheck(f, 100000).ok, false);
  assert.equal(F.affordCheck(f, 100).known, true);
  // No pay and no balance written: nothing to measure against, so no yes or no (30 Oct 2026, seen in the real app).
  const bare = F.financeForecast(F.financeModel(notes.filter((n) => !/Accounts/.test(n.path)), TODAY), { days: 90 });
  assert.equal(F.affordCheck(bare, 900).known, false);
  assert.match(S.recordModuleTools.answerRecordModuleTool({ finance: notes.filter((n) => !/Accounts/.test(n.path)).map((n) => ({ ...n })), documents: [], on: ['finance'], today: TODAY }, 'finance_forecast', { amount: 900 }), /not known yet: no pay or account balance/);
  const answer = S.recordModuleTools.answerRecordModuleTool({ finance: notes.map((n) => ({ ...n })), documents: [], on: ['finance'], income, today: TODAY }, 'finance_forecast', { amount: 900 });
  assert.match(answer, /The next 90 days/);
  assert.match(answer, /Tightest week:/);
  assert.match(answer, /A cost of \$900\.00 (fits|does not fit)/);
  // Pay is never guessed: no settings, no income.
  assert.deepEqual(F.incomeFromSettings({}), []);
  assert.equal(F.financeForecast(m, { days: 30 }).totalIn, 0);
});

test('bank CSV: a bank’s columns are remembered and used next time; a receipt, an account and a budget plan as tools', () => {
  const F = S.finance;
  const parse = S.csv.parseCsv;
  const table = parse(['Posted,Details,Money out,Money in', '20/09/2026,RIVERSIDE BAKERY 4411,12.50,', '01/10/2026,SALARY ACME PTY,,3000.00'].join('\n'));
  const cols = F.bankColumns(table);
  assert.ok(cols?.header);
  const profiles = F.withBankProfile({}, table, cols);
  assert.ok(F.bankProfileKey(table));
  // The same bank with its header words shuffled in a way word-matching would miss is still read by the remembered columns.
  const again = parse(['Posted,Details,Money out,Money in', '05/10/2026,CORNER MARKET,42.00,'].join('\n'));
  assert.equal(F.bankColumns(again, profiles).what, cols.what);
  const plan = F.planBankImport(again, { bills: [], spending: [] }, TODAY, profiles);
  assert.equal(plan.remembered, true);
  assert.deepEqual(plan.rows.map((r) => [r.date, r.amount]), [['2026-10-05', 42]]);
  const X = S.recordModuleTools;
  const input = { finance: [], documents: [], on: ['finance'], today: TODAY };
  const receipt = X.planReceiptAdd({ date: '2026-10-20', what: 'Corner Market', amount: 24.5, category: 'Groceries' }, input);
  assert.deepEqual([receipt.row.date, receipt.row.what, receipt.row.amount], ['2026-10-20', 'Corner Market', 24.5]);
  assert.throws(() => X.planReceiptAdd({ date: '2026-10-20', what: 'Corner Market' }, input), /amount on the receipt/);
  const account = X.planRecordModuleWrite('finance_account_add', { name: 'Everyday', institution: 'Harbour Bank', balance: 500 }, { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY });
  assert.equal(account.folder, 'Me/Finance/Accounts');
  assert.match(account.text, /balance: 500\.00/);
  assert.throws(() => X.planRecordModuleWrite('finance_account_add', { name: 'Everyday', number: '12345678' }, { on: ['finance'], areas: null }), /never written in a note/);
  const budget = X.planRecordModuleWrite('finance_budget_add', { category: 'Groceries', amount: 600 }, { on: ['finance'], areas: null, today: TODAY });
  assert.equal(budget.folder, 'Finance/Budgets');
});

test('documents: sensible lead times, a reading with its number dropped, and Renewed keeping the old copy', () => {
  const D = S.idDocuments;
  assert.equal(D.defaultRemindForKind('Passport'), 180);
  assert.equal(D.defaultRemindForKind('Driver licence'), 30);
  assert.equal(D.defaultRemindForKind('Other'), null);
  const m = D.documentsModel([{ path: 'D/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', expires: '2027-03-01' }, content: '' }], TODAY, 60);
  assert.equal(m.documents[0].remind, 180, 'a passport is said six months ahead even when the module says 60');
  // An old copy that was renewed is kept and never said again (30 Oct 2026, seen in the real app).
  const both = D.documentsModel([{ path: 'D/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', expires: '2026-12-01', renewed_by: '[[Passport (Alex), to 2036]]' }, content: '' }, { path: 'D/Passport (Alex), to 2036.md', title: 'Passport (Alex), to 2036', props: { kind: 'Passport', expires: '2036-12-01' }, content: '' }], TODAY, 60);
  assert.deepEqual(both.expiring.map((d) => d.name), [], 'the renewed old copy is not expiring');
  assert.equal(both.documents.find((d) => d.name === 'Passport (Alex)').status, 'Renewed');
  assert.match(D.expiryWords(both.documents.find((d) => d.name === 'Passport (Alex)'), both.today), /^Renewed: the old copy/);
  const reading = D.documentFromReading({ kind: 'passport', holder: 'Alex Example', expiry_date: '2031-03-01', number: 'P1234567' });
  assert.equal(reading.input.kind, 'Passport');
  assert.equal(reading.input.expires, '2031-03-01');
  assert.equal(reading.numberDropped, true);
  assert.equal(JSON.stringify(reading.input).includes('P1234567'), false, 'a number read off a photo is never kept');
  const oldText = D.newDocumentText({ kind: 'Passport', holder: 'Alex Example', expires: '2026-12-01' });
  const { newText, oldText: kept } = D.renewedDocumentTexts({ name: 'Passport (Alex)', kind: 'Passport', holder: 'Alex Example', issuer: '', oldText, oldExpires: '2026-12-01' }, { expires: '2036-12-01', issued: '2026-10-24', today: '2026-10-24' });
  assert.match(newText, /expires: 2036-12-01/);
  assert.match(newText, /Renewal history/);
  assert.match(kept, /Renewed on 2026-10-24/);
  assert.match(kept, /expires: 2026-12-01/, 'the old copy keeps its own dates');
  const X = S.recordModuleTools;
  const plan = X.planDocumentRenewed({ document: 'Passport (Alex)', expires: '2036-12-01' }, { finance: [], documents: [{ path: 'D/Passport (Alex).md', title: 'Passport (Alex)', props: { kind: 'Passport', expires: '2026-12-01' }, content: '' }], on: ['documents'], today: TODAY });
  assert.equal(plan.path, 'D/Passport (Alex).md');
  assert.throws(() => X.planDocumentRenewed({ document: 'Nope', expires: '2036-12-01' }, { finance: [], documents: [], on: ['documents'], today: TODAY }), /no document called/);
});

// ── The main side: through a gate, notices said once, switched off ───────────────────────────────────────────────────

function vault(files) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  return { dir, index };
}

test('main side: a payment with several receipts names every one in its row', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Spending/2026-10.md': S.finance.newSpendingText('2026-10'),
  };
  const { dir, index } = vault(files);
  let written = '';
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async () => false }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true } } }),
    writeNote: async (rel, text) => { written = text; },
    importFiles: async (picked) => picked.map((f) => `Me/Finance/Spending/Files/${path.posix.basename(f)}`),
    pickFiles: async () => [],
    movePath: async (from, to) => ({ path: to }),
    post: () => 0,
    requireCreate: async () => {},
    now: () => TODAY,
  });
  await rm.addSpendWithReceipt({ date: '2026-10-20', what: 'Corner Market', amount: 120, category: 'Groceries' }, ['/tmp/a.png', '/tmp/b.png']);
  assert.match(written, /\[\[Me\/Finance\/Spending\/Files\/a\.png\\\|a\.png\]\]/);
  assert.match(written, /\[\[Me\/Finance\/Spending\/Files\/b\.png\\\|b\.png\]\]/);
  assert.doesNotMatch(written, /more\)/);
});

test('main side: the gate decides what an agent sees, notices are said once, and switched off nothing shows and nothing is lost', async () => {
  const L = S.sensitivity;
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Bills/Harbour Internet.md': bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-26', autopay: 'No', category: 'Phone and internet' }, '| 2026-06-01 | 79.00 | |\n| 2026-10-10 | 89.00 | Went up |\n'),
    'Me/Documents and ID/Passport (Alex).md': '---\ntype: id-document\nkind: Passport\nexpires: 2026-11-20\n---\n',
    'Work/Notes/Plan.md': '# Plan\n',
  };
  const { dir, index } = vault(files);
  let switches = { finance: { on: true }, documents: { on: true } };
  const posted = [];
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async () => false }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: switches }),
    writeNote: async () => { throw new Error('nothing is written in this test'); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => ({ path: to }),
    post: (items) => {
      const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
      posted.push(...fresh);
      return fresh.length;
    },
    requireCreate: async () => {},
    now: () => TODAY,
  });
  // Notices: the bill due in 2 days, its price change, the passport within 60 days; a second check says nothing new.
  assert.equal(await rm.check(), 3);
  assert.deepEqual(posted.map((p) => p.title).sort(), ['Harbour Internet is due in 2 days', 'Harbour Internet went up', 'Passport (Alex) expires in 27 days']);
  assert.equal(await rm.check(), 0, 'said once');
  // Through a gate: a chat bot (not allowed Personal) sees no bill and is told why; the former host app (Personal
  // by default) sees it.
  const store = L.emptyStore();
  const sens = {
    stamp: () => 'x',
    level: (rel) => L.levelOf(store, rel, index.get(rel)?.props?.sensitivity, index.get(rel)?.props?.type).level,
    decide: (who, rel, name) => L.decide(store, who, rel, sens.level(rel), name),
    useGrant: () => false,
    allows: (who, level) => L.allows(store, who, level),
    audit: () => {},
  };
  const bot = await rm.callTool('finance_bills_due', {}, M.makeGate(sens, 'neuralbot', 'Chat bot'));
  assert.match(bot.text, /No bills due/);
  assert.match(bot.text, /1 Money record is marked Personal.*Chat bot isn’t allowed/);
  const spark = await rm.callTool('finance_bills_due', {}, M.makeGate(sens, 'neuralspark', 'the host app'));
  assert.match(spark.text, /Harbour Internet: \$89\.00 due Mon 26 Oct/);
  const write = await rm.callTool('finance_bill_add', { name: 'Water' }, M.makeGate(sens, 'neuralbot', 'Chat bot'));
  assert.match(write.text, /isn’t allowed Personal/, 'a write the gate refuses is never made');
  assert.equal(await rm.callTool('not_mine', {}, null), null);
  // Switched off: no tools, no notices, no pages' data changes; every note still there exactly as it was.
  switches = { finance: { on: false }, documents: { on: false } };
  assert.deepEqual(rm.toolsOn(), []);
  assert.equal(await rm.check(), 0);
  assert.match((await rm.callTool('finance_bill_list', {}, null)).text, /Money module is off/);
  for (const [rel, text] of Object.entries(files)) assert.equal(readFileSync(path.join(dir, rel), 'utf8'), text, `${rel} kept as it was`);
  // The emailed bill: switched on, an Inbox item that reads as a bill finds the bill of that name.
  switches = { finance: { on: true } };
  const found = await rm.inboxBill({ kind: 'line', path: 'Inbox.md', words: 'Your Harbour Internet bill of $95.00 is due on 26 Nov 2026' });
  assert.deepEqual(found, { name: 'Harbour Internet', amount: 95, due: '2026-11-26', existing: 'Me/Finance/Bills/Harbour Internet.md' });
});

test('main side (8.3 wave 1): Renewed makes a new copy and keeps the old; a receipt lands in its month’s spending', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Documents and ID/Passport (Alex).md': '---\ntype: id-document\nkind: Passport\nholder: Alex Example\nexpires: 2026-12-01\n---\n## Files\n\n\n## Notes\n',
  };
  const { dir, index } = vault(files);
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
    now: () => TODAY,
  });
  const made = await rm.renewDocument('Me/Documents and ID/Passport (Alex).md', '2036-12-01', '2026-10-24');
  assert.match(made, /Passport \(Alex\), to 2036\.md$/);
  assert.match(written.get('Me/Documents and ID/Passport (Alex).md'), /renewed_by: "\[\[Passport \(Alex\), to 2036\]\]"/, 'the old copy names the copy that replaced it');
  assert.match(written.get(made), /expires: 2036-12-01/);
  assert.match(written.get(made), /Renewal history/);
  assert.match(written.get('Me/Documents and ID/Passport (Alex).md'), /Renewed on 2026-10-24/);
  assert.match(written.get('Me/Documents and ID/Passport (Alex).md'), /expires: 2026-12-01/, 'the old copy is kept as it was, expiry and all');
  const said = await rm.callTool('finance_receipt_add', { date: '2026-10-20', what: 'Corner Market', amount: 24.5, category: 'Groceries' }, null);
  assert.match(said.text, /Filed the receipt in Money: Corner Market/);
  assert.match(written.get('Me/Finance/Spending/2026-10.md'), /\| 2026-10-20 \| Corner Market \| Groceries \| 24\.50 \|/);
  const renewed = await rm.callTool('document_renewed', { document: 'Passport (Alex)', expires: '2037-01-01' }, null);
  assert.match(renewed.text, /Renewed Passport \(Alex\), to 2036/, 'the same name reaches the current copy, not the old one');
  // A bank's columns are remembered in the vault after an import is read, and the next file from that bank says so.
  const csv = 'Posted,Details,Money out,Money in\n05/10/2026,CORNER MARKET,42.00,\n';
  const first = await rm.importPlan(csv);
  assert.equal(first.remembered, undefined);
  assert.match(readFileSync(path.join(dir, '.neuralvault', 'module-options.json'), 'utf8'), /bankProfiles/);
  const second = await rm.importPlan(csv);
  assert.equal(second.remembered, true);
});

test('9.2 money model: a card repayment is a transfer, never spending; debts never count as cash', () => {
  const F = S.finance;
  assert.equal(F.isTransferBill('Loans and cards'), true);
  assert.equal(F.isTransferBill('Phone and internet'), false);
  assert.equal(F.spendCategoryOfBill('Loans and cards'), 'Transfers');
  assert.equal(F.spendCategoryOfBill('Groceries'), 'Groceries');
  const notes = [
    note('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\nkind: Everyday\nbalance: 1200\n---\n'),
    note('Me/Finance/Accounts/Credit Card.md', 'bank-account', '---\ntype: bank-account\nkind: Credit card\nbalance: 2000\n---\n'),
    note('Me/Finance/Accounts/Home loan.md', 'bank-account', '---\ntype: bank-account\nkind: Loan\nbalance: 9000\n---\n'),
    note('Me/Finance/Spending/2026-10.md', 'spending-month', F.withSpendRows(F.newSpendingText('2026-10'), [
      { date: '2026-10-03', what: 'Corner Market', category: 'Groceries', amount: 182.4 },
      { date: '2026-10-05', what: 'Credit Card repayment', category: 'Transfers', amount: 200 },
    ])),
  ];
  const m = F.financeModel(notes, TODAY);
  const oct = m.months.find((x) => x.month === '2026-10');
  assert.deepEqual([oct.total, oct.transfers], [182.4, 200]);
  assert.deepEqual(Object.keys(oct.byCategory), ['Groceries']);
  const f = F.financeForecast(m, { days: 30 });
  assert.equal(f.startingBalance, 1200, 'the card debt and loan never count as money to spend');
  assert.equal(f.debtTotal, 11000);
  assert.deepEqual(f.debts.map((d) => d.name).sort(), ['Credit Card', 'Home loan']);
  const answer = S.recordModuleTools.answerRecordModuleTool({ finance: notes, documents: [], on: ['finance'], today: TODAY }, 'finance_forecast', {});
  assert.match(answer, /starting from \$1,200 in the accounts, owes \$11,000 on cards and loans/);
});

test('9.2 categories: the usual words beat a near-merchant (petrol is Fuel), an exact merchant beats all', () => {
  const F = S.finance;
  const learned = new Map([['woolworths', 'Groceries']]);
  assert.equal(F.guessCategory('WOOLWORTHS PETROL $45', learned), 'Fuel');
  assert.equal(F.guessCategory('WOOLWORTHS 1234 SYDNEY $82', learned), 'Groceries', 'the same merchant as taught');
  assert.equal(F.guessCategory('WOOLWORTHS METRO 9 $20', learned), 'Groceries', 'a new branch learns from the merchant');
  assert.equal(F.guessCategory('WOOLWORTHSX $5', learned), 'Other', 'no word break, no learning');
});

test('9.2 emailed bills: autopay and repayment cues read, any currency, bare amounts with cents', () => {
  const F = S.finance;
  assert.deepEqual(F.billFromWords('Credit Card autopay $200 on 3 Nov', TODAY), { name: 'Credit Card', amount: 200, due: '2026-11-03' });
  assert.equal(F.billFromWords('A repayment of $200 is due for Harbour Credit Card', TODAY).amount, 200);
  assert.equal(F.billFromWords('Your bill is 95.00 and due Friday', TODAY).amount, 95);
  assert.equal(F.billFromWords('Invoice for USD 120 due 5 Nov 2026', TODAY).amount, 120);
  assert.equal(F.billFromWords('Lunch was $18 at the cafe', TODAY), null, 'an amount alone is still no bill');
  assert.equal(F.billFromWords('Pay the water bill', TODAY), null, 'no amount, no bill');
});

test('9.2 mark-paid plans: bracketed refs work, two close bills name both, receipts never file twice', () => {
  const X = S.recordModuleTools;
  const bills = [
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ amount: '89.00', cycle: 'Monthly', due: '2026-11-03', category: 'Phone and internet' })),
    note('Me/Finance/Bills/Harbour Internet Plus.md', 'bill', bill({ amount: '109.00', cycle: 'Monthly', due: '2026-11-03', category: 'Phone and internet' })),
  ];
  const input = { finance: bills, documents: [], on: ['finance'], today: TODAY };
  const plan = X.planMarkPaid({ bill: '[Me/Finance/Bills/Harbour Internet.md]' }, input);
  assert.equal(plan.path, bills[0].path, 'a ref copied from the list works');
  assert.throws(() => X.planMarkPaid({ bill: 'Harbour' }, input), /More than one bill matches “Harbour”: Harbour Internet, Harbour Internet Plus/);
  assert.throws(() => X.planMarkPaid({ bill: 'Nope' }, input), /no bill/);
  const withSpend = { finance: [...bills, note('Me/Finance/Spending/2026-10.md', 'spending-month', S.finance.withSpendRows(S.finance.newSpendingText('2026-10'), [{ date: '2026-10-20', what: 'Corner Market', category: 'Groceries', amount: 24.5 }]))], documents: [], on: ['finance'], today: TODAY };
  assert.throws(() => X.planReceiptAdd({ date: '2026-10-20', what: 'Corner Market', amount: 24.5 }, withSpend), /already filed/);
});

test('9.2 adds find before creating: a bill, account or budget already there is updated, never doubled', () => {
  const X = S.recordModuleTools;
  const finance = [
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
    note('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\nkind: Everyday\nbalance: 1200\n---\n'),
    note('Me/Finance/Budgets/Groceries.md', 'budget-category', '---\ntype: budget-category\namount: 600\nperiod: Monthly\n---\n'),
  ];
  const ctx = { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY, currency: 'AUD', notes: { finance, documents: [] } };
  const up = X.planRecordModuleWrite('finance_bill_add', { name: 'harbour  internet', amount: 95, due: '2026-11-28' }, ctx);
  assert.deepEqual([up.update?.path, up.update?.fields.amount, up.update?.fields.due], ['Me/Finance/Bills/Harbour Internet.md', 95, '2026-11-28']);
  assert.match(up.words, /Updated the bill Harbour Internet/);
  const fresh = X.planRecordModuleWrite('finance_bill_add', { name: 'Water', amount: 120, category: 'Home and utilities' }, ctx);
  assert.equal(fresh.update, undefined);
  assert.match(fresh.words, /Added the bill Water/);
  const acc = X.planRecordModuleWrite('finance_account_add', { name: 'Everyday', balance: 500 }, ctx);
  assert.equal(acc.update?.path, 'Me/Finance/Accounts/Everyday.md');
  const bud = X.planRecordModuleWrite('finance_budget_add', { category: 'groceries', amount: 700 }, ctx);
  assert.equal(bud.update?.path, 'Me/Finance/Budgets/Groceries.md');
  assert.throws(() => X.planRecordModuleWrite('document_add', { kind: 'Passport', holder: 'Alex Example' }, { on: ['documents'], areas: null, today: TODAY, notes: { finance, documents: [{ path: 'D/Passport (Alex Example).md', title: 'Passport (Alex Example)', props: {}, content: '' }] } }), /already .* in Papers/);
});

test('9.2 main side: a card repayment — a transfer not spending, the due moved, the cycle covered, never doubled', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Bills/Harbour Credit Card.md': bill({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active', account: '"[[Everyday]]"' }),
    'Me/Finance/Bills/Harbour Internet.md': bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
  };
  const { dir, index } = vault(files);
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
    now: () => new Date(2026, 10, 1, 10, 0),
  });
  const said = await rm.markPaid('Me/Finance/Bills/Harbour Credit Card.md', '2026-11-01');
  assert.match(said, /Harbour Credit Card marked paid \(\$150\.00\), a transfer so not counted as spending/);
  assert.match(said, /Next due Tue 8 Dec/);
  assert.match(said, /This cycle is covered/);
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /paid: 2026-11-01/);
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /due: 2026-12-08/);
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\| 2026-11-01 \| Harbour Credit Card \| Transfers \| 150\.00 \|/, 'a repayment leaves a Transfers trace (recorded, never counted)');
  const retry = await rm.markPaid('Me/Finance/Bills/Harbour Credit Card.md', '2026-11-01');
  assert.match(retry, /already marked paid/, 'a retry says already paid instead of throwing');
  assert.equal((written.get('Me/Finance/Spending/2026-11.md').match(/Harbour Credit Card \| Transfers \| 150\.00/g) ?? []).length, 1, 'a retry never doubles it');
  // An ordinary bill still lands its payment in spending, once even when added twice.
  const said2 = await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-10-28');
  assert.match(said2, /Harbour Internet marked paid/);
  assert.match(written.get('Me/Finance/Spending/2026-10.md'), /\| 2026-10-28 \| Harbour Internet \| Phone and internet \| 89\.00 \|/);
  await rm.addSpends([{ date: '2026-10-28', what: 'Harbour Internet', category: 'Phone and internet', amount: 89 }]);
  assert.equal((written.get('Me/Finance/Spending/2026-10.md').match(/Harbour Internet \| Phone and internet \| 89\.00/g) ?? []).length, 1, 'a retry never doubles the row');
  // Explicit adds refuse with where it is; the tool updates instead.
  await assert.rejects(() => rm.addBill({ name: 'harbour internet' }), /already a bill called/);
  const updated = await rm.callTool('finance_bill_add', { name: 'Harbour Internet', amount: 95, due: '2026-11-28' }, null);
  assert.match(updated.text, /Updated the bill Harbour Internet/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /amount: 95/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /\| 2026-11-01 \| 95\.00 \| Updated by an assistant \|/);
});

test('9.2 main side: a bank import marks bills paid with the due moved on, and says what landed', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Bills/Harbour Internet.md': bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
  };
  const { dir, index } = vault(files);
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
    now: () => TODAY,
  });
  const words = await rm.importApply({
    rows: [{ date: '2026-10-28', what: 'HARBOUR INTERNET PTY LTD', amount: 95, category: 'Phone and internet' }],
    paid: [{ bill: 'Me/Finance/Bills/Harbour Internet.md', date: '2026-10-28' }],
    prices: [{ bill: 'Me/Finance/Bills/Harbour Internet.md', to: 95, date: '2026-10-28' }],
    bills: [{ name: 'Harbour Internet', amount: 95 }],
  });
  assert.match(words, /1 payment added to 1 month/);
  assert.match(words, /1 bill marked paid/);
  assert.match(words, /1 price brought up to date/);
  assert.match(words, /1 bill already there/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /paid: 2026-10-28/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /due: 2026-11-28/);
  const missing = await rm.importApply({ rows: [], paid: [{ bill: 'Me/Finance/Bills/Nope.md', date: '2026-10-28' }] });
  assert.match(missing, /1 bill could not be marked paid/, 'a bill that cannot be marked says so');
});

test('bank CSV: a row links the one bill whose distinctive words it carries, ties link nothing', () => {
  const F = S.finance;
  const parse = S.csv.parseCsv;
  const bills = [
    { name: 'Harbour Credit Card', names: [], path: 'Me/Finance/Bills/Harbour Credit Card.md', amount: 150, paid: null },
    { name: 'Harbour Internet', names: [], path: 'Me/Finance/Bills/Harbour Internet.md', amount: 89, paid: null },
  ];
  const csv = parse(['Date,Details,Amount', '20/10/2026,CREDIT CARD AUTOPAY 150.00,-150.00', '21/10/2026,WOOLWORTHS 1234 SYDNEY,-82.10'].join('\n'));
  const plan = F.planBankImport(csv, { bills, spending: [] }, TODAY);
  assert.equal(plan.rows.find((r) => /CREDIT CARD/.test(r.what))?.bill, 'Me/Finance/Bills/Harbour Credit Card.md', 'short bank words link without every word of the name');
  assert.equal(plan.rows.find((r) => /WOOLWORTHS/.test(r.what))?.bill, undefined, 'an unrelated row links nothing');
  assert.deepEqual(plan.paid, [{ bill: 'Me/Finance/Bills/Harbour Credit Card.md', date: '2026-10-20' }]);
  // Two bills sharing those words: neither is linked.
  const tied = [
    { name: 'Harbour Credit Card', names: [], path: 'Me/Finance/Bills/Harbour Credit Card.md', amount: 150, paid: null },
    { name: 'Credit Card Rewards', names: [], path: 'Me/Finance/Bills/Credit Card Rewards.md', amount: 20, paid: null },
  ];
  const p2 = F.planBankImport(parse(['Date,Details,Amount', '20/10/2026,CREDIT CARD AUTOPAY,-150.00'].join('\n')), { bills: tied, spending: [] }, TODAY);
  assert.equal(p2.rows[0]?.bill, undefined, 'a tie links nothing rather than the wrong bill');
  assert.deepEqual(p2.paid, []);
});

test('main side: finance_csv_import takes a bank file and lands it the way the window does', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Bills/Harbour Credit Card.md': bill({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' }),
    'Me/Finance/Bills/Harbour Internet.md': bill({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
    'Me/Finance/Accounts/Everyday.md': '---\ntype: bank-account\nkind: Everyday\nbalance: 1200\n---\n',
    'Me/Finance/Spending/2026-10.md': S.finance.withSpendRows(S.finance.newSpendingText('2026-10'), [{ date: '2026-10-03', what: 'WOOLWORTHS 1234 SYDNEY', category: 'Groceries', amount: 82.1 }]),
  };
  const { dir, index } = vault(files);
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
    now: () => TODAY,
  });
  const csvPath = path.join(work, `bank-${Date.now()}.csv`);
  writeFileSync(csvPath, ['Date,Description,Debit,Credit', '03/10/2026,WOOLWORTHS 1234 SYDNEY,82.10,', '20/10/2026,CREDIT CARD AUTOPAY 150.00,150.00,', '28/10/2026,HARBOUR INTERNET PTY LTD,95.00,', '01/10/2026,SALARY ACME PTY,,3000.00'].join('\n'));
  const out = await rm.callTool('finance_csv_import', { file: csvPath }, null);
  assert.ok(out, 'the tool is served');
  assert.match(out.text, /2 payments added/, 'the duplicate is skipped, the pay left out');
  assert.match(out.text, /2 bills marked paid/, 'both rows pay their bills, the short bank name included');
  assert.match(out.text, /1 price brought up to date/, 'Harbour Internet 89 to 95');
  assert.match(out.text, /1 already kept/, 'the duplicate says so');
  const spend = written.get('Me/Finance/Spending/2026-10.md');
  assert.match(spend, /\| 2026-10-20 \| CREDIT CARD AUTOPAY 150\.00 \| Transfers \| 150\.00 \|/);
  assert.match(spend, /\| 2026-10-28 \| HARBOUR INTERNET PTY LTD \| Phone and internet \| 95\.00 \|/);
  assert.equal((spend.match(/WOOLWORTHS 1234 SYDNEY \| Groceries \| 82\.10/g) ?? []).length, 1, 'the duplicate is never added again');
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /paid: 2026-10-20/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /paid: 2026-10-28/);
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /amount: 95/);
  const missing = await rm.callTool('finance_csv_import', { file: path.join(work, 'no-such-file.csv') }, null);
  assert.match(missing.text, /isn’t there|not found|no such/i, 'a missing file says so in plain words');
  const off = await rm.callTool('finance_csv_import', {}, null);
  assert.match(off.text, /path|file/i, 'no path says what is needed');
});

test('the bell: a module notice is kept with the reminders’ own, said once across a restart', async () => {
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const shown = [];
  const host = { dataDir, index: new M.VaultIndex(), library: () => '/notes', read: () => undefined, write: async () => {}, templatesFolder: () => 'Templates', show: (n) => shown.push(n), changed: () => {}, now: () => TODAY.getTime() };
  const r = new M.Reminders(host);
  const item = { key: 'bill:F/Bills/Water.md:2026-10-26', kind: 'finance', title: 'Water is due in 2 days', body: '$120.50 · Mon 26 Oct', path: 'F/Bills/Water.md' };
  assert.equal(r.post([item]), 1);
  assert.equal(r.notices()[0].kind, 'finance');
  assert.equal(r.notices()[0].note, 'F/Bills/Water.md');
  assert.equal(shown.length, 1);
  r.stop();
  const again = new M.Reminders(host);
  assert.equal(again.post([item]), 0, 'a restart never says it again');
});
