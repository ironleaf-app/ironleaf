// node --test tests/money-warn.test.mjs — money that warns early, receipts that file themselves, bills on their
// project (10.0 v2money): the morning brief's money lines and the bell's notices in the same plain words (a bill due
// with autopay off, spending well over usual, a price that went up), a receipt photo or PDF read and filed with Undo,
// and a bill belonging to a project and showing on it. Made-up bills, shops and amounts only; a fixed day
// (Mon 2 Nov 2026). Each check fails without its change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-moneywarn-'));
let F, B, X, RM, MR, RL, M;
const NOW = new Date(2026, 10, 2, 8, 30);
const TODAY = '2026-11-02';
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'shared.ts');
  writeFileSync(
    entry,
    ['finance', 'brief', 'record-module-tools', 'record-modules', 'module-records', 'relation-links']
      .map((m) => `export * as ${m.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from ${src(`src/shared/${m}.ts`)};`)
      .join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(
    main,
    [
      `export { RecordModules, isReceiptFile } from ${src('src/main/record-modules.ts')};`,
      `export { registerBrief } from ${src('src/main/brief.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { planSyncAfterWrite } from ${src('src/main/relation-sync.ts')};`,
    ].join('\n'),
  );
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  ({ finance: F, brief: B, recordModuleTools: X, recordModules: RM, moduleRecords: MR, relationLinks: RL } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const billText = (props, history = '') => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n${history}\n## Notes\n`;
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
const AREAS = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }) };

/** A made-up vault with a Finance module, tracking writes and moves, with faked receipt file words. */
function moneyVault(files, fileWords = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const existing = new Set(Object.keys(files));
  const moves = [];
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
      moves.push([from, to]);
      existing.delete(from);
      existing.add(to);
      return { path: to };
    },
    post: () => 0,
    requireCreate: async () => {},
    now: () => NOW,
    fileText: async (rel) => fileWords[rel] ?? null,
  });
  return { dir, index, existing, moves, rm };
}

const PHOTO_WORDS = ['WOOLWORTHS METRO', '123 Harbour St Sydney', '2 Nov 2026', 'Milk 2L  $3.50', 'Bread  $2.80', 'TOTAL  $6.30', 'Visa .... 4410 APPROVED'].join('\n');
const PDF_WORDS = ['Riverside Bakery', 'TAX INVOICE', '20/10/2026', 'Sourdough  $8.00', 'Croissant  $4.50', 'Subtotal  $12.50', 'TOTAL  $12.50'].join('\n');

// ── The warnings in plain words ───────────────────────────────────────────────────────────────────────────────────

test('money words: one wording for a bill due, spending over usual and a price up', () => {
  // A bill due in 3 days with autopay off says you pay it by hand, plainly (10.0 third round F8: never "paid by hand" alone).
  assert.deepEqual(F.billDueWords({ name: 'Harbour Internet', amount: 89, next: '2026-11-05', days: 3, overdue: false, autopay: false }, 'AUD', TODAY), {
    title: 'Harbour Internet is due in 3 days',
    detail: '$89.00 on Thu 5 Nov, you pay it by hand',
  });
  assert.deepEqual(F.billDueWords({ name: 'Credit Card', amount: 1284, next: '2026-10-26', days: -7, overdue: true, autopay: false }, 'AUD', TODAY).title, 'Credit Card is overdue');
  assert.match(F.billDueWords({ name: 'Telstra', amount: 189, next: '2026-11-05', days: 3, overdue: false, autopay: true }, 'AUD', TODAY).detail, /\(autopay\)/);
  assert.deepEqual(F.spendOverWords({ category: 'Eating out', spent: 320, usual: 125, months: 3, month: '2026-11' }, 'AUD'), {
    title: 'Eating out is well above usual',
    detail: '$320.00 so far in Nov 2026, usually about $125.00',
  });
  assert.deepEqual(F.priceUpWords({ name: 'Streamly', change: { from: 16.99, to: 18.99, date: '2026-10-20', recent: true } }, 'AUD', TODAY), {
    title: 'Streamly went up',
    detail: '$16.99 to $18.99 from Tue 20 Oct',
  });
  assert.equal(F.priceUpWords({ name: 'Streamly', change: { from: 18.99, to: 16.99, date: '2026-10-20', recent: true } }, 'AUD', TODAY), null, 'a fall is good news, never pushed');
  for (const words of Object.values(F.billDueWords({ name: 'X', amount: 1, next: '2026-11-05', days: 3, overdue: false, autopay: false }, 'AUD', TODAY))) assert.doesNotMatch(words, /—/, 'no em dashes in product words');
});

test('spending over usual: well over flags, steady and new kinds and transfers never', () => {
  const model = {
    thisMonth: '2026-11',
    months: [
      { month: '2026-08', total: 0, byCategory: { 'Eating out': 120, Groceries: 400, Transfers: 500 }, transfers: 0 },
      { month: '2026-09', total: 0, byCategory: { 'Eating out': 130, Groceries: 410 }, transfers: 0 },
      { month: '2026-10', total: 0, byCategory: { 'Eating out': 125, Groceries: 405, Concerts: 60 }, transfers: 0 },
      { month: '2026-11', total: 0, byCategory: { 'Eating out': 320, Groceries: 420, Transfers: 2000, Concerts: 400, Pottery: 500 }, transfers: 0 },
    ],
  };
  const over = F.spendingOverUsual(model);
  assert.deepEqual(over.map((o) => o.category), ['Eating out'], 'only Eating out is well over (Concerts has one prior month, Pottery is new, Transfers never flag)');
  assert.deepEqual([over[0].spent, over[0].usual, over[0].months], [320, 125, 3]);
  assert.equal(F.spendingOverUsual({ thisMonth: '2026-11', months: [] }).length, 0, 'no months, no warnings');
});

// ── Receipts read from words ─────────────────────────────────────────────────────────────────────────────────────

test('receipts: merchant, total and day read from photo or PDF words', () => {
  assert.deepEqual(F.receiptFromWords(PHOTO_WORDS, NOW), { merchant: 'WOOLWORTHS METRO', total: 6.3, date: '2026-11-02' });
  assert.deepEqual(F.receiptFromWords(PDF_WORDS, NOW), { merchant: 'Riverside Bakery', total: 12.5, date: '2026-10-20' }, 'the total line wins, not subtotal plus total');
  assert.equal(F.receiptFromWords('Corner Market\nApples $4.00\nCheese $12.00', NOW).total, 12, 'with no total line, the largest amount');
  assert.equal(F.receiptFromWords('Just some words with no money in them', NOW), null);
  assert.equal(F.receiptFromWords('', NOW), null);
});

test('undoing a filed receipt takes out only its row', () => {
  const month = F.withSpendRows(F.newSpendingText('2026-11'), [
    { date: '2026-11-02', what: 'WOOLWORTHS METRO', category: 'Groceries', amount: 6.3 },
    { date: '2026-11-03', what: 'Riverside Bakery', category: 'Eating out', amount: 12.5 },
  ]);
  const undone = F.withoutSpendRow(month, '2026-11-02', 6.3, 'WOOLWORTHS METRO');
  assert.doesNotMatch(undone, /WOOLWORTHS/);
  assert.match(undone, /Riverside Bakery/, 'the later row stays byte for byte');
  assert.match(undone, /\|\s*Date\s*\|/, 'the table stands');
  assert.equal(F.withoutSpendRow(undone, '2026-11-02', 6.3, 'WOOLWORTHS METRO'), undone, 'already gone: unchanged');
});

// ── Bills on their project ───────────────────────────────────────────────────────────────────────────────────────

test('a bill belongs to a project: written, read and found by name or path', () => {
  const text = F.newBillText({ name: 'New Power', amount: 120, cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities', project: 'Shop Refit' });
  assert.match(text, /project: "\[\[Shop Refit\]\]"/);
  const m = F.financeModel(
    [
      noteOf('Me/Finance/Bills/New Power.md', 'bill', text),
      noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet' })),
    ],
    NOW,
  );
  assert.equal(m.bills.find((b) => b.name === 'New Power').project, 'Shop Refit');
  assert.equal(m.bills.find((b) => b.name === 'Harbour Internet').project, null, 'old bills read as belonging nowhere');
  assert.deepEqual(F.billsForProject(m.bills, 'Shop Refit').map((b) => b.name), ['New Power']);
  assert.deepEqual(F.billsForProject(m.bills, '[[Shop Refit]]').map((b) => b.name), ['New Power']);
  assert.deepEqual(F.billsForProject(m.bills, 'shop refit').map((b) => b.name), ['New Power']);
  assert.deepEqual(F.billsForProject(m.bills, 'Projects/Shop Refit/Shop Refit.md').map((b) => b.name), ['New Power']);
  assert.deepEqual(F.billsForProject(m.bills, 'Other Project'), []);
  // The type, the views and the bills table all carry the project.
  assert.ok(MR.FINANCE.types.find((t) => t.id === 'bill').fields.some((f) => f.key === 'project' && f.linkType === 'project'));
  assert.ok(RM.EDITABLE.bill.includes('project'));
  assert.equal(RM.PROPERTY_OF.bill.project, 'project');
  assert.equal(RM.financeRecords(m).find((r) => r.title === 'New Power').fields.project, 'Shop Refit');
  assert.ok(RM.sectionViews('finance', 'bills', TODAY)[0].fields.includes('project'));
});

test('project bills through the module tools: added with one, listed by one, named on dues', () => {
  const finance = [noteOf('Me/Finance/Bills/New Power.md', 'bill', billText({ amount: '120', cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities', project: '"[[Shop Refit]]"' })), noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet' }))];
  const made = X.planRecordModuleWrite('finance_bill_add', { name: 'Extra Paint', amount: 45, category: 'Other', project: 'Shop Refit' }, { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: NOW, notes: { finance } });
  assert.match(made.text, /project: "\[\[Shop Refit\]\]"/);
  assert.match(made.words, /, for Shop Refit to Money/);
  const upd = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Internet', project: 'Shop Refit' }, { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: NOW, notes: { finance } });
  assert.equal(upd.update.fields.project, 'Shop Refit');
  const input = { finance, documents: [], on: ['finance'], today: NOW };
  const list = X.answerRecordModuleTool(input, 'finance_bill_list', { project: 'Shop Refit' });
  assert.match(list, /1 bill/);
  assert.match(list, /New Power/);
  assert.doesNotMatch(list, /Harbour Internet/);
  assert.match(list, /, for Shop Refit/);
  const dues = X.answerRecordModuleTool(input, 'finance_bills_due', { days: 30 });
  assert.match(dues, /New Power: \$120\.00 due Fri 20 Nov \(in 18 days\), you pay it by hand, for Shop Refit/);
});

// ── The brief warns about money ──────────────────────────────────────────────────────────────────────────────────

const MONEY = {
  currency: 'AUD',
  today: TODAY,
  remindDays: 7,
  bills: [
    { path: 'Me/Finance/Bills/Credit Card.md', name: 'Credit Card', amount: 1284, next: '2026-10-26', days: -7, overdue: true, autopay: false },
    { path: 'Me/Finance/Bills/Harbour Internet.md', name: 'Harbour Internet', amount: 89, next: '2026-11-05', days: 3, overdue: false, autopay: false },
    { path: 'Me/Finance/Bills/Telstra.md', name: 'Telstra', amount: 189, next: '2026-12-10', days: 38, overdue: false, autopay: true },
  ],
  over: [{ category: 'Eating out', spent: 320, usual: 125, months: 3, month: '2026-11', path: 'Me/Finance/Spending/2026-11.md' }],
  prices: [{ path: 'Me/Finance/Bills/Streamly.md', name: 'Streamly', from: 16.99, to: 18.99, date: '2026-10-20' }],
};
const briefInput = (over = {}) => ({ now: NOW.getTime(), calendar: null, meetingNotes: {}, due: null, projects: null, decks: [], found: [], foundState: 'none', prefs: B.NO_PREFS, money: MONEY, ...over });

test('the brief warns about money early, each line with its action', () => {
  const b = B.buildBrief(briefInput());
  const titles = b.items.map((i) => i.title);
  assert.deepEqual(titles, ['Credit Card is overdue', 'Harbour Internet is due in 3 days', 'Eating out is well above usual', 'Streamly went up'], 'overdue first, then due soon, spending, price');
  const [late, due, spend, price] = b.items;
  assert.equal(late.tone, 'bad');
  assert.equal(late.detail, '$1,284 was due Mon 26 Oct, not paid yet; you pay it by hand');
  assert.deepEqual(late.actions[0], { kind: 'open', label: 'Open', path: 'Me/Finance/Bills/Credit Card.md' });
  assert.equal(due.kind, 'bill');
  assert.equal(due.detail, '$89.00 on Thu 5 Nov, you pay it by hand');
  assert.match(due.actions[1].words, /^About Harbour Internet /);
  assert.equal(spend.kind, 'spend');
  assert.deepEqual(spend.actions[0], { kind: 'open', label: 'Open', path: 'Me/Finance/Spending/2026-11.md' });
  assert.equal(price.kind, 'price');
  assert.equal(price.detail, '$16.99 to $18.99 from Tue 20 Oct');
  assert.ok(!titles.some((t) => t.startsWith('Telstra')), 'due in 38 days: beyond the window, left out');
  assert.deepEqual(B.buildBrief(briefInput({ money: null })).items, [], 'the module off: no money lines, and nothing invented');
});

test('Not useful quiets one money kind, and Money failing gets its own line', async () => {
  const handlers = {};
  let saved = null;
  M.registerBrief({
    handle: (ch, fn) => (handlers[ch] = fn),
    due: () => ({ overdue: [], today: [], week: [], undated: [], undatedCount: 0 }),
    today: () => ({ due: { overdue: [], today: [], soon: [] }, atRisk: [], quiet: [] }),
    calendar: async () => ({ connected: false }),
    decks: () => [],
    meetingNotes: () => ({}),
    money: () => MONEY,
    load: async () => saved,
    save: async (v) => (saved = JSON.parse(JSON.stringify(v))),
    now: () => NOW.getTime(),
  });
  const first = await handlers['brief:get']();
  assert.ok(first.items.some((i) => i.kind === 'bill' && i.title === 'Harbour Internet is due in 3 days'));
  const id = first.items.find((i) => i.title === 'Harbour Internet is due in 3 days').id;
  const after = await handlers['brief:not-useful'](id);
  assert.ok(!after.items.some((i) => i.id === id), 'the line hidden');
  const spend = after.items.find((i) => i.kind === 'spend');
  const plain = B.buildBrief(briefInput()).items.find((i) => i.kind === 'spend');
  assert.equal(spend.score, plain.score, 'setting aside bills leaves spending lines ranked as before');
  const undone = await handlers['brief:useful-again'](id);
  assert.ok(undone.items.some((i) => i.id === id), 'Undo shows it again');
  // Money failing to read is said, never a calm brief.
  const failing = {};
  M.registerBrief({
    handle: (ch, fn) => (failing[ch] = fn),
    due: () => {
      throw new Error('closed');
    },
    today: () => {
      throw new Error('closed');
    },
    calendar: async () => ({ connected: false }),
    decks: () => {
      throw new Error('closed');
    },
    meetingNotes: () => ({}),
    money: () => {
      throw new Error('locked');
    },
    load: async () => null,
    save: async () => {},
    now: () => NOW.getTime(),
  });
  const brief = await failing['brief:get']();
  assert.ok(brief.items.some((i) => i.kind === 'problem' && /Couldn’t read Money/.test(i.title)), 'the Money failure is said');
});

// ── The bell warns with the same words ─────────────────────────────────────────────────────────────────────────────

function warnVault() {
  const spend = (month, rows) => F.withSpendRows(F.newSpendingText(month), rows);
  return moneyVault({
    ...AREAS,
    'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' }),
    'Me/Finance/Bills/Streamly.md': billText({ kind: 'Subscription', amount: '18.99', cycle: 'Monthly', due: '2026-11-18', category: 'Subscriptions', autopay: 'Yes' }, '| 2026-09-01 | 16.99 | First recorded |\n| 2026-10-20 | 18.99 | Went up |\n'),
    'Me/Finance/Spending/2026-08.md': spend('2026-08', [{ date: '2026-08-15', what: 'Noodle Bar', category: 'Eating out', amount: 120 }]),
    'Me/Finance/Spending/2026-09.md': spend('2026-09', [{ date: '2026-09-15', what: 'Noodle Bar', category: 'Eating out', amount: 130 }]),
    'Me/Finance/Spending/2026-10.md': spend('2026-10', [{ date: '2026-10-15', what: 'Noodle Bar', category: 'Eating out', amount: 125 }]),
    'Me/Finance/Spending/2026-11.md': spend('2026-11', [{ date: '2026-11-01', what: 'Noodle Bar', category: 'Eating out', amount: 320 }]),
  });
}

test('the bell warns with the same words as the brief, said once', async () => {
  const { index, rm } = warnVault();
  const posted = [];
  rm['d'].post = (items) => {
    const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
    posted.push(...fresh);
    return fresh.length;
  };
  const n = await rm.check();
  assert.ok(n >= 3, `bills, spending and price notices posted (got ${n})`);
  // The same words the brief uses for the same three warnings.
  const money = await rm.briefMoney();
  const brief = B.buildBrief(briefInput({ money }));
  for (const line of brief.items.filter((i) => ['bill', 'spend', 'price'].includes(i.kind))) {
    const notice = posted.find((p) => p.title === line.title);
    assert.ok(notice, `the bell says “${line.title}” too`);
    assert.equal(notice.body, line.detail, `identical detail for “${line.title}”`);
  }
  assert.ok(posted.some((p) => p.title === 'Harbour Internet is due in 3 days' && /you pay it by hand/.test(p.body)));
  assert.ok(posted.some((p) => p.title === 'Eating out is well above usual'));
  assert.ok(posted.some((p) => p.title === 'Streamly went up'));
  assert.equal(await rm.check(), 0, 'said once: the second check posts nothing new');
  assert.equal(index.content('Me/Finance/Spending/2026-11.md').split('\n').filter((l) => l.includes('Noodle Bar')).length, 1);
});

// ── Receipts that file themselves ──────────────────────────────────────────────────────────────────────────────────

test('receipts file themselves from a drop, twice files once, with Undo', async () => {
  const { index, moves, rm } = moneyVault({
    ...AREAS,
    'Me/Finance/Spending/2026-10.md': F.withSpendRows(F.newSpendingText('2026-10'), [{ date: '2026-10-05', what: 'Corner Market', category: 'Groceries', amount: 42 }]),
    'Inbox/woolies.png': 'not read here: fileText stands in',
  });
  // What the drop would file as: the merchant, total, day and a Groceries guess from its words.
  const seen = await rm.previewReceipt(PHOTO_WORDS);
  assert.deepEqual([seen.merchant, seen.total, seen.date, seen.category, seen.duplicate], ['WOOLWORTHS METRO', 6.3, '2026-11-02', 'Groceries', false]);
  const known = await rm.previewReceipt('Corner Market\nTOTAL  $9.00');
  assert.equal(known.category, 'Groceries', 'the person’s own past choice for that merchant wins');
  assert.equal(await rm.previewReceipt('no money in these words'), null);
  // Filed: its row in November with the file named, the words saying where.
  const first = await rm.fileReceipt(PHOTO_WORDS);
  assert.match(first.words, /Filed the receipt in Money: WOOLWORTHS METRO, \$6\.30 on 2026-11-02 \(Groceries\)/);
  assert.equal(first.paths[0], 'Me/Finance/Spending/2026-11.md');
  assert.ok(first.undo, 'every filing carries Undo');
  // Filed twice (the photo, then the PDF) is filed once.
  await assert.rejects(() => rm.fileReceipt(PHOTO_WORDS), /already filed in Money/);
  assert.equal(index.content('Me/Finance/Spending/2026-11.md').split('\n').filter((l) => l.includes('WOOLWORTHS')).length, 1);
  // A second receipt files beside it; undoing the first leaves the second alone.
  const pdf = PDF_WORDS.replace('20/10/2026', '3 Nov 2026');
  const second = await rm.fileReceipt(pdf);
  assert.match(second.words, /Riverside Bakery, \$12\.50 on 2026-11-03 \(Groceries\)/, 'a bakery reads as Groceries until the person teaches it otherwise');
  assert.equal(await rm.undoReceipt(first.undo), 'Undid the filed receipt: WOOLWORTHS METRO is out of Money again, and its file is back in the Inbox.');
  const month = index.content('Me/Finance/Spending/2026-11.md');
  assert.doesNotMatch(month, /WOOLWORTHS/);
  assert.match(month, /Riverside Bakery/, 'only its own row goes');
  await assert.rejects(() => rm.undoReceipt(first.undo), /can’t be undone any more/, 'Undo spent: said plainly');
  assert.deepEqual(moves, [], 'no file moved when none was given');
});

test('an Inbox photo files with its file kept, and Undo puts it back', async () => {
  const { index, moves, rm } = moneyVault({ ...AREAS, 'Inbox/woolies.png': 'bytes' }, { 'Inbox/woolies.png': PHOTO_WORDS });
  assert.ok(M.isReceiptFile('Inbox/woolies.png'));
  assert.equal(M.isReceiptFile('Inbox/notes.md'), false);
  const item = { id: 'Inbox/woolies.png', kind: 'file', path: 'Inbox/woolies.png', text: '', words: 'woolies.png', task: false, embeds: ['Inbox/woolies.png'], links: [] };
  const seen = await rm.inboxReceipt(item);
  assert.deepEqual([seen.merchant, seen.total, seen.category], ['WOOLWORTHS METRO', 6.3, 'Groceries']);
  const filed = await rm.fileInboxReceipt(item);
  assert.deepEqual(moves[0][0], 'Inbox/woolies.png', 'the photo moves beside the month');
  assert.match(index.content('Me/Finance/Spending/2026-11.md'), /woolies\.png/, 'the row names the file');
  await rm.undoReceipt(filed.undo);
  assert.deepEqual(moves[1], [moves[0][1], 'Inbox/woolies.png'], 'Undo puts the photo back where it was');
  assert.doesNotMatch(index.content('Me/Finance/Spending/2026-11.md'), /WOOLWORTHS/);
  // Nothing to read, nothing offered: a photo with no words yet, and a note that is no receipt.
  const unread = moneyVault({ ...AREAS, 'Inbox/dark.png': 'bytes' });
  assert.equal(await unread.rm.inboxReceipt({ ...item, path: 'Inbox/dark.png' }), null);
  await assert.rejects(() => unread.rm.fileInboxReceipt({ ...item, path: 'Inbox/dark.png' }), /no words to read yet/);
  assert.equal(await rm.inboxReceipt({ kind: 'line', path: 'Inbox.md', words: 'call mum back' }), null);
});

// ── Bills show on their project ──────────────────────────────────────────────────────────────────────────────────

test('a bill shows on its project: backlinks list it, the seam links it back', async () => {
  const bill = 'Me/Finance/Bills/New Power.md';
  const project = 'Projects/Shop Refit/Shop Refit.md';
  const index = new M.VaultIndex();
  index.set(project, '---\ntype: project\nstatus: active\n---\n# Shop Refit\n', 0, 10);
  index.set(bill, '---\ntype: bill\namount: 120\nproject: "[[Shop Refit]]"\n---\n## Notes\n', 0, 10);
  const back = index.backlinks(project);
  assert.ok(back.some((b) => b.source === bill && b.prop === 'project'), 'the project’s links to it name the bill and its project property');
  // The relations seam plans the matching back-link on the project, like meetings do.
  const before = '---\ntype: bill\namount: 120\n---\n## Notes\n';
  const after = '---\ntype: bill\namount: 120\nproject: "[[Shop Refit]]"\n---\n## Notes\n';
  const notes = [
    { path: bill, title: 'New Power' },
    { path: project, title: 'Shop Refit' },
  ];
  const writes = M.planSyncAfterWrite({ path: bill, title: 'New Power' }, before, after, { notes, propsOf: () => ({}) });
  assert.ok(writes.some((w) => w.path === project && w.key === 'project' && JSON.stringify(w.value).includes('New Power')), 'the project gains its bill back');
  // And the main side writes the project link where it shows.
  const { index: idx, rm } = moneyVault({ ...AREAS, [bill]: billText({ amount: '120', cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' }) });
  await rm.setField('bill', bill, 'project', 'Shop Refit');
  assert.match(idx.content(bill), /project: "\[\[Shop Refit\]\]"/);
});
