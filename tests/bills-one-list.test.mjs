// node --test tests/bills-one-list.test.mjs — bills as one list, not a note each (8 Nov 2026).
// Bills live as rows in one readable file (Me/Finance/Bills.md, plain Markdown the person can
// read); every door reads the list (Today's Bills due, the Money page, search, the bill page, the
// assistant's tools); a bill becomes its own note only when written on (typed notes, or a price
// history longer than the first line); new bills are rows. The one-time move takes a full backup
// first, shows a preview, folds only machine-made frames, and undoes byte for byte. Proven on an
// invented vault with the shape: 15 bills, most frames with a single "Added by an assistant" price
// line, many with no due date, a few with real words.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-bills-one-list-'));
let B, F, X, R, M;
const NOW = new Date(2026, 10, 8, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as B from ${src('src/shared/bills-table.ts')};`,
    `export * as F from ${src('src/shared/finance.ts')};`,
    `export * as X from ${src('src/shared/record-module-tools.ts')};`,
    `export * as R from ${src('src/renderer/src/views/modules/billRow.ts')};`,
  ].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [
    `export * from ${src('src/main/record-modules.ts')};`,
    `export * as billsMove from ${src('src/main/bills-move.ts')};`,
    `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
    `export { createVaultBin } from ${src('src/main/bin.ts')};`,
  ].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  ({ B, F, X, R } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] });
const BASE = 'Me/Finance';
const BILLS = `${BASE}/Bills`;
const sha = (t) => createHash('sha256').update(t).digest('hex');

// A bill note shaped like a real one: about 15 words, front matter with every field, a Price history
// table with a single machine line, often no due date.
const BILL = (props, price = '| | 89.00 | Added by an assistant |', notes = '') => {
  const front = [
    'type: bill',
    `kind: ${props.kind ?? 'Bill'}`,
    props.amount === undefined ? 'amount:' : `amount: ${props.amount}`,
    `cycle: ${props.cycle ?? 'Monthly'}`,
    props.due === undefined ? 'due:' : `due: ${props.due}`,
    `category: ${props.category ?? 'Other'}`,
    props.account ? `account: "[[${props.account}]]"` : 'account:',
    'project:',
    `autopay: ${props.autopay ?? 'No'}`,
    `status: ${props.status ?? 'Active'}`,
  ];
  return `---\n${front.join('\n')}\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n${price}\n\n## Notes\n\n${notes}`;
};

// Their 15 bills: short names, small amounts, most frames, many with no due date.
function ownerShapeFiles() {
  const bills = [
    ['Harbour Internet', { amount: '89.00', due: '2026-11-12', category: 'Phone and internet', account: 'Everyday' }],
    ['Streamly', { kind: 'Subscription', amount: '16.99', due: '2026-11-10', category: 'Subscriptions', autopay: 'Yes' }],
    ['Power', { amount: '214.50', due: '2026-11-20', category: 'Home and utilities' }],
    ['Water', { amount: '120.00', category: 'Home and utilities' }],
    ['Council Rates', { amount: '480.00', cycle: 'Quarterly', category: 'Home and utilities' }],
    ['Harbour Credit Card', { amount: '150.00', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes' }],
    ['Phone', { amount: '45.00', due: '2026-11-15', category: 'Phone and internet', autopay: 'Yes' }],
    ['Gym', { kind: 'Subscription', amount: '29.00', cycle: 'Fortnightly', category: 'Health' }],
    ['Car Insurance', { amount: '980.00', cycle: 'Yearly', due: '2027-02-01', category: 'Insurance' }],
    ['Petrol Card', { amount: '60.00', category: 'Transport' }],
    ['Music', { kind: 'Subscription', amount: '12.99', due: '2026-11-09', category: 'Subscriptions', autopay: 'Yes' }],
    ['Cloud Storage', { kind: 'Subscription', amount: '4.49', category: 'Subscriptions', autopay: 'Yes' }],
    ['Newspaper', { kind: 'Subscription', amount: '32.00', category: 'Subscriptions' }],
    ['Gas', { amount: '96.20', due: '2026-11-25', category: 'Home and utilities' }],
    ['School Fees', { amount: '1450.00', cycle: 'Yearly', category: 'Education' }],
  ];
  const files = { '.neuralvault/areas.json': AREAS, 'Me/Finance/Accounts/Everyday.md': '---\ntype: bank-account\ninstitution: Harbour Bank\nkind: Everyday\n---\n' };
  for (const [name, props] of bills) files[`${BILLS}/${name}.md`] = BILL(props);
  // Two hold real words: typed notes, and a price history with a second line.
  files[`${BILLS}/Power.md`] = BILL({ amount: '214.50', due: '2026-11-20', category: 'Home and utilities' }, '| | 89.00 | Added by an assistant |', 'Ring them about the off-peak rate before winter.\n');
  files[`${BILLS}/Streamly.md`] = BILL({ kind: 'Subscription', amount: '16.99', due: '2026-11-10', category: 'Subscriptions', autopay: 'Yes' }, '| 2026-09-10 | 14.99 | Added by an assistant |\n| 2026-10-10 | 16.99 | Went up |');
  return files;
}

/** Money's main side over made-up files on a real disk (the move needs one), recording writes. */
function moneyVault(files, now = NOW) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const writes = [];
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => { try { readFileSync(path.join(dir, rel)); return true; } catch { return false; } } }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true }, documents: { on: true } } }),
    writeNote: async (rel, text) => { writes.push(rel); mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); index.set(rel, text, 0, text.length); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => {
      mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
      writeFileSync(path.join(dir, to), readFileSync(path.join(dir, from)));
      rmSync(path.join(dir, from));
      index.delete?.(from);
      index.set(to, readFileSync(path.join(dir, to), 'utf8'), 0, 0);
      return { path: to };
    },
    post: () => 0,
    requireCreate: async () => {},
    now: () => now,
    dataDir,
    device: { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' },
    appVersion: '9.9.0',
  });
  const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
  const listBills = () => (existsSync(path.join(dir, BILLS)) ? readdirSync(path.join(dir, BILLS)).filter((f) => f.endsWith('.md')).sort() : []);
  return { dir, index, writes, rm, read, listBills, dataDir };
}

test('one Bills list: a readable table, one row per bill, every field plus its note', () => {
  const text = B.renderBillsTable({ rows: [], prices: {} });
  assert.match(text, /^---\ntype: bills-table\ntable: bills\nversion: 1\n---\n/, 'readable frontmatter with a version');
  assert.match(text, /^# Bills\n/m, 'a plain heading');
  const back = B.readBillsTable(text);
  assert.equal(back.version, 1);
  assert.deepEqual(back.rows, []);
  const full = B.renderBillsTable({
    rows: [{ name: 'Harbour Internet', cells: { kind: 'Bill', amount: '89.00', cycle: 'Monthly', due: '2026-11-12', category: 'Phone and internet', account: '[[Everyday]]', project: '', autopay: 'No', status: 'Active', paid: '' }, note: null }],
    prices: { 'harbour internet': [{ date: '', amount: 89, note: 'Added by an assistant' }] },
  });
  const lines = full.split('\n').filter((l) => l.includes('Harbour Internet'));
  assert.equal(lines.length, 2, 'one table line and one price line name the bill');
  assert.match(lines[0], /^\| Harbour Internet \| Bill \| 89\.00 \| Monthly \| 2026-11-12 \|/);
  assert.match(lines[0], /\| Note file \|/.test(full) ? /./ : /./, 'the table carries a Note file column');
  assert.match(full, /\| Note file \|/, 'columns for every field plus Note file');
  const round = B.readBillsTable(full);
  assert.equal(round.rows.length, 1);
  assert.equal(round.rows[0].cells.due, '2026-11-12');
  assert.equal(round.rows[0].cells.account, '[[Everyday]]');
  assert.equal(round.prices['harbour internet'].length, 1);
});

test('filler: a frame folds; typed notes and a second price line stay', () => {
  const frame = { title: 'Water', props: { type: 'bill', kind: 'Bill', cycle: 'Monthly', category: 'Home and utilities' }, content: BILL({ category: 'Home and utilities' }) };
  const c1 = B.classifyBillNote(frame);
  assert.equal(c1.fold, true, `a frame folds: ${c1.why}`);
  const nodue = { title: 'Gas', props: { type: 'bill', amount: '96.20', cycle: 'Monthly', category: 'Home and utilities' }, content: BILL({ amount: '96.20', category: 'Home and utilities' }) };
  assert.equal(B.classifyBillNote(nodue).fold, true, 'no due date still folds');
  const words = { ...frame, content: `${frame.content}Ring them about the off-peak rate.\n` };
  assert.equal(B.classifyBillNote(words).fold, false, 'typed notes stay a note');
  const twoPrices = { ...frame, content: frame.content.replace('| | 89.00 | Added by an assistant |', '| 2026-09-10 | 14.99 | Added by an assistant |\n| 2026-10-10 | 16.99 | Went up |') };
  assert.equal(B.classifyBillNote(twoPrices).fold, false, 'a price history longer than the first line stays a note');
  const odd = { title: 'Odd', props: {}, content: 'no frontmatter at all, just words\n' };
  assert.equal(B.classifyBillNote(odd).fold, false, 'when unsure a file stays a note');
});

test("Today's Bills due reads list rows; a bill with no due date is never due", async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  // Three rows straight into the list: one overdue, one due soon, one with no due date.
  await v.rm.addBill({ name: 'Harbour Internet', amount: 89, cycle: 'Monthly', due: '2026-11-12', category: 'Phone and internet' });
  await v.rm.addBill({ name: 'Harbour Credit Card', amount: 150, cycle: 'Monthly', due: '2026-11-01', category: 'Loans and cards' });
  await v.rm.addBill({ name: 'Water', amount: 120, cycle: 'Monthly', category: 'Home and utilities' });
  assert.match(v.read(`${BASE}/Bills.md`), /\| Harbour Internet \|/, 'rows land in the one list');
  assert.deepEqual(v.listBills(), [], 'no note files made');
  const m = await v.rm.finance();
  assert.equal(m.bills.length, 3, 'the Money page reads the rows');
  assert.ok(m.bills.every((b) => b.path.startsWith(`${BASE}/Bills.md#`), 'every bill opens from its row'));
  const card = m.bills.find((b) => b.name === 'Harbour Credit Card');
  assert.equal(card.overdue, true, 'the overdue row reads overdue');
  const water = m.bills.find((b) => b.name === 'Water');
  assert.equal(water.next, null, 'no due date means no coming day');
  assert.equal(water.days, null);
  assert.equal(water.overdue, false);
  const due = F.billsDue(m.bills, m.remindDays, m.today);
  assert.ok(due.some((b) => b.name === 'Harbour Internet'), "Today's Bills due names the row due soon");
  assert.ok(due.some((b) => b.name === 'Harbour Credit Card'), "Today's Bills due names the overdue row");
  assert.ok(!due.some((b) => b.name === 'Water'), 'a bill with no due date is never counted as due');
  assert.ok(!m.dueSoon.some((b) => b.name === 'Water'), 'nor in the next-14-days list');
  // Its row says so in plain words.
  assert.deepEqual(R.billRowTag(water, m.today), { tone: 'slate', words: 'due date not set' });
});

test('new bills are rows: the assistant, imports and filed bills add rows, not notes', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  const added = await v.rm.callTool('finance_bill_add', { name: 'Harbour Internet', amount: 89, cycle: 'Monthly', due: '2026-11-12', category: 'Phone and internet' }, null);
  assert.match(added.text, /Added the bill Harbour Internet/, 'the assistant is told it was added');
  assert.match(added.text, new RegExp(`\\[${BASE}/Bills\\.md#harbour-internet\\]`), 'at its row');
  const words = await v.rm.importApply({ rows: [], bills: [{ name: 'Water', amount: 120, cycle: 'Monthly', category: 'Home and utilities' }] });
  assert.match(words, /1 new bill/);
  const filed = await v.rm.fileInboxBill({ kind: 'line', path: 'Inbox.md', words: 'Your Power bill of $214.50 is due on 20 Nov 2026' });
  assert.match(filed.words, /Added the bill Power/);
  assert.deepEqual(v.listBills(), [], 'no note files from any door');
  const names = v.read(`${BASE}/Bills.md`).split('\n').filter((l) => l.startsWith('| ')).join('\n');
  assert.ok(names.includes('Harbour Internet') && names.includes('Water') && names.includes('Power'), 'all three land as rows');
  const m = await v.rm.finance();
  assert.equal(m.bills.length, 3);
});

test('a written bill stays a note: typed notes and a second price line promote the row', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  const row = await v.rm.addBill({ name: 'Harbour Internet', amount: 89, cycle: 'Monthly', due: '2026-11-12', category: 'Phone and internet' });
  assert.match(row, /Bills\.md#harbour-internet/);
  // A corrected amount's first recording stays in the row: no note.
  await v.rm.setField('bill', row, 'account', 'Everyday');
  assert.deepEqual(v.listBills(), [], 'a plain fix stays in the row');
  // Words make it a note; the row keeps pointing at it.
  const rel = await v.rm.noteWords(row, 'Ring them about the off-peak rate.');
  assert.match(rel, /\.md$/);
  assert.match(v.read(rel), /Ring them about the off-peak rate/);
  let m = await v.rm.finance();
  assert.equal(m.bills.find((b) => b.name === 'Harbour Internet').path, rel, 'the note is the bill now');
  // A second price line promotes the other way.
  const v2 = moneyVault({ '.neuralvault/areas.json': AREAS });
  const row2 = await v2.rm.addBill({ name: 'Streamly', amount: 14.99, cycle: 'Monthly', due: '2026-11-10', category: 'Subscriptions' });
  await v2.rm.setField('bill', row2, 'amount', 16.99);
  const m2 = await v2.rm.finance();
  assert.match(m2.bills.find((b) => b.name === 'Streamly').path, /\.md$/, 'a price history longer than the first line makes it a note');
  assert.equal(F.priceHistory(v2.read(m2.bills.find((b) => b.name === 'Streamly').path)).length, 2);
});

test('move on a realistic vault: backup first, preview, fold, Undo puts every byte back', async () => {
  const files = ownerShapeFiles();
  const before = {};
  for (const [rel, text] of Object.entries(files)) before[rel] = sha(text);
  const v = moneyVault(files);
  const state0 = await v.rm.billsMoveState();
  assert.equal(state0.offer, true, 'the move is offered on a vault full of frames');
  const preview = await v.rm.billsMovePreview();
  assert.equal(preview.fold.length, 13, `the 13 frames fold, got ${preview.fold.length}`);
  assert.equal(preview.stay.length, 2, `the 2 written bills stay, got ${preview.stay.length}`);
  assert.match(preview.words.join('\n'), /backup/i, 'the preview says a backup comes first');
  assert.match(preview.words.join('\n'), /Bin/, 'the preview says folded notes go to the Bin');
  const modelBefore = await v.rm.finance();
  assert.equal(modelBefore.bills.length, 15);
  const words = await v.rm.billsMoveRun();
  assert.match(words, /backup/i, 'the move says where the backup went');
  const backups = readdirSync(path.join(v.dataDir, 'backups'));
  assert.equal(backups.length, 1, 'a full backup was taken first');
  assert.ok(backups[0].endsWith('.zip'), 'the backup is a zip');
  assert.deepEqual(v.listBills().sort(), ['Power.md', 'Streamly.md'], 'frames folded, written bills stay');
  for (const s of preview.stay) assert.equal(sha(v.read(s.rel)), before[s.rel], `${s.rel} untouched byte for byte`);
  const bin = M.createVaultBin({ root: v.dir });
  assert.equal((await bin.list()).length, 13, 'folded notes went to the Bin');
  // The Money page after the move lists, counts and links the same bills.
  const modelAfter = await v.rm.finance();
  assert.equal(modelAfter.bills.length, 15, 'every bill still lists');
  assert.deepEqual(modelAfter.bills.map((b) => b.name).sort(), modelBefore.bills.map((b) => b.name).sort());
  const row = modelAfter.bills.find((b) => b.name === 'Harbour Internet');
  assert.match(row.path, /Bills\.md#/, 'folded bills live behind row paths');
  assert.equal(row.amount, 89, 'a row bill keeps its amount');
  // The assistant's tools read the rows too.
  const due = await v.rm.callTool('finance_bills_due', {}, null);
  assert.match(due.text, /Harbour Internet/, 'bills due names a folded bill');
  const list = await v.rm.callTool('finance_bill_list', {}, null);
  assert.match(list.text, /Water/, 'the bill list names a bill with no due date');
  // One Undo puts every file back byte for byte.
  const undone = await v.rm.billsMoveUndo();
  assert.match(undone, /back/i);
  for (const [rel, digest] of Object.entries(before)) assert.equal(sha(v.read(rel)), digest, `${rel} back byte for byte`);
  assert.equal((await v.rm.finance()).bills.length, 15);
});

test('move: a crash at each step resumes and still ends byte-right', async () => {
  for (const step of ['backup', 'tables', 'moves-3', 'moves-all']) {
    const v = moneyVault(ownerShapeFiles());
    await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'backup');
    if (['tables', 'moves-3', 'moves-all'].includes(step)) await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'tables');
    if (step === 'moves-3') await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'moves', { limit: 3 });
    if (step === 'moves-all') await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'moves', { limit: 1000 });
    const mid = await v.rm.billsMoveState();
    assert.equal(mid.interrupted, true, `after a crash at ${step} the move says it did not finish`);
    const words = await v.rm.billsMoveResume();
    assert.match(words, /finish|done|folded/i, `resume after ${step} finishes: ${words}`);
    const after = await v.rm.finance();
    assert.equal(after.bills.length, 15, `every bill lists after resume from ${step}`);
    const names = after.bills.map((b) => b.name);
    assert.equal(new Set(names).size, names.length, `no doubled rows after resume from ${step}`);
  }
});

test('rows answer mark-paid, search and resolve like notes did', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  const row = await v.rm.addBill({ name: 'Harbour Internet', amount: 89, cycle: 'Monthly', due: '2026-11-12', category: 'Phone and internet' });
  const said = await v.rm.markPaid(row, '2026-11-08');
  assert.match(said, /Harbour Internet marked paid/);
  assert.match(said, /Next due/);
  assert.match(v.read('Me/Finance/Spending/2026-11.md'), /\| 2026-11-08 \| Harbour Internet \| Phone and internet \| 89\.00 \|/, 'the payment lands in spending');
  const m = await v.rm.finance();
  assert.equal(m.bills.find((b) => b.name === 'Harbour Internet').paid, '2026-11-08');
  assert.match(await v.rm.billsResolveRow('Harbour Internet'), /Bills\.md#harbour-internet/);
  assert.equal(await v.rm.billsResolveRow('no such thing'), null);
  const hits = await v.rm.billsSearchRows('harbour');
  assert.ok(hits.some((h) => h.name === 'Harbour Internet'), 'row search names the folded bill');
});
