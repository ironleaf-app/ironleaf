// node --test tests/bills-break.test.mjs — breaking "bills as one list" before it ships (8 Nov 2026).
// For every fault: a failing test first, a fix at the cause. Worst first. Made-up data only.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-bills-break-'));
let B, F, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as B from ${src('src/shared/bills-table.ts')};`,
    `export * as F from ${src('src/shared/finance.ts')};`,
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
  ({ B, F } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const AREAS = JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] });
const NOW = new Date(2026, 10, 8, 10, 0);
/** Money's main side over made-up files on a real disk, as one PC. */
function moneyVault(files, device = { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' }, now = NOW) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const dataDir = mkdtempSync(path.join(work, 'data-'));
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => { try { readFileSync(path.join(dir, rel)); return true; } catch { return false; } } }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true }, documents: { on: true } } }),
    writeNote: async (rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); index.set(rel, text, 0, text.length); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => { mkdirSync(path.dirname(path.join(dir, to)), { recursive: true }); writeFileSync(path.join(dir, to), readFileSync(path.join(dir, from))); rmSync(path.join(dir, from)); index.delete?.(from); index.set(to, readFileSync(path.join(dir, to), 'utf8'), 0, 0); return { path: to }; },
    post: () => 0,
    requireCreate: async () => {},
    now: () => now,
    dataDir,
    device,
    appVersion: '9.9.0',
  });
  return { dir, index, rm, dataDir };
}

const row = (name, amount, extra = {}) => ({ name, cells: { kind: 'Bill', amount, cycle: 'Monthly', due: '', category: 'Other', account: '', project: '', autopay: 'No', status: 'Active', paid: '', ...extra }, note: null });

test('merge keeps the other PC’s conflicting amounts, never drops one', () => {
  // Their PC already holds two versions of A (1.00 shown, 99.00 from an earlier merge).
  const mine = B.renderBillsTable({ rows: [row('A', '1.00')] });
  const theirs = B.renderBillsTable({ rows: [row('A', '1.00'), row('B', '2.00')] });
  const theirsConflict = theirs.replace(/\n+$/, '') + '\n\n## Merged from X (1 Jan)\n\n'
    + '| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| A | Bill | 99.00 | Monthly |  | Other |  |  | No | Active |  |  |\n';
  assert.deepEqual(Object.keys(B.readBillsTable(theirsConflict).conflicts), ['a'], 'theirs holds a conflict first');
  const m = B.mergeBillsTables(mine, theirsConflict, 'the other PC', '8 Nov 2026');
  const d = B.readBillsTable(m.text);
  assert.equal(d.rows.find((r) => r.name === 'B')?.cells.amount, '2.00', 'their new row still arrives');
  assert.ok(d.dupes.some((x) => x.toLowerCase() === 'a'), 'A still reads as disagreeing');
  const others = (d.conflicts.a ?? []).map((r) => r.cells.amount);
  assert.ok(others.includes('99.00'), `their 99.00 version is kept, got ${JSON.stringify(others)}`);
});

test('one bill, however spaced: "A B" and "A-B" never become two rows', () => {
  const mine = B.renderBillsTable({ rows: [row('A B', '10.00')] });
  const theirs = B.renderBillsTable({ rows: [row('A-B', '10.00')] });
  const m = B.mergeBillsTables(mine, theirs, 'the other PC', '8 Nov 2026');
  const d = B.readBillsTable(m.text);
  assert.equal(d.rows.length, 1, `one row, got ${JSON.stringify(d.rows.map((r) => r.name))}`);
  // Same through the reader alone (a file holding both lines).
  const both = B.renderBillsTable({ rows: [row('Harbour Internet', '10.00'), row('Harbour  Internet', '20.00')] });
  const r = B.readBillsTable(both);
  assert.equal(r.rows.length, 1, `one row, got ${JSON.stringify(r.rows.map((x) => x.name))}`);
  assert.ok(r.dupes.length === 1, 'the disagreement is named');
  assert.ok((r.conflicts[Object.keys(r.conflicts)[0]] ?? []).some((x) => x.cells.amount === '20.00'), 'the other amount is kept to choose');
});

test('one PC tidies at a time: the second waits, names the first, then goes', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  const a = v.rm.billsWork();
  const b = { ...v.rm.billsWork(), device: { id: '00000000-0000-0000-0000-000000000002', name: 'OFFICE-PC' } };
  assert.equal(await M.billsMove.acquireMoveLock(a), null, 'the first PC holds the run');
  assert.equal(await M.billsMove.acquireMoveLock(b), 'TEST-PC', 'the second is told who holds it');
  await M.billsMove.releaseMoveLock(a);
  assert.equal(await M.billsMove.acquireMoveLock(b), null, 'after the release the second goes');
  await M.billsMove.releaseMoveLock(b);
  // A lock from a dead app never blocks for good.
  const lockFile = path.join(v.dir, '.neuralvault', 'bills-move.lock');
  writeFileSync(lockFile, JSON.stringify({ pc: '00000000-0000-0000-0000-000000000099', name: 'DEAD-PC', at: Date.now() - 10 * 60 * 1000 }));
  assert.equal(await M.billsMove.acquireMoveLock(a), null, 'a stale lock is taken over');
  await M.billsMove.releaseMoveLock(a);
});

test('a bill changed on two PCs is shown with each version to choose', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  await v.rm.addBill({ name: 'Power', amount: 10, cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' });
  // The other PC's copy, changed there, merged in.
  const mine = readFileSync(path.join(v.dir, 'Me/Finance/Bills.md'), 'utf8');
  const theirs = mine.replace('| Power | Bill | 10.00 |', '| Power | Bill | 20.00 |');
  const m = B.mergeBillsTables(mine, theirs, 'OFFICE-PC', '8 Nov 2026');
  assert.ok(m.changed, 'the merge takes their version');
  writeFileSync(path.join(v.dir, 'Me/Finance/Bills.md'), m.text);
  v.index.set('Me/Finance/Bills.md', m.text, 0, m.text.length);
  const f = await v.rm.finance();
  assert.equal(f.bills.find((b) => b.name === 'Power')?.amount, 10, 'the Money page still shows one amount');
  assert.equal(f.billsConflicts.length, 1, 'the disagreement is named on the Money page');
  assert.equal(f.billsConflicts[0].name, 'Power');
  assert.deepEqual(f.billsConflicts[0].others.map((o) => o.cells.amount), ['20.00'], 'their version is there to choose');
  const done = await v.rm.billsResolveConflict('Power', 1);
  assert.match(done.words, /Power/);
  const f2 = await v.rm.finance();
  assert.equal(f2.billsConflicts.length, 0, 'nothing left to choose');
  assert.equal(f2.bills.find((b) => b.name === 'Power')?.amount, 20, 'their version now shows');
});

test('resume after a crash between the Bin and the receipt leaves no stale note', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue: 2026-11-12\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS, 'Me/Finance/Bills/Water.md': BILL });
  await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'backup');
  await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'tables');
  // The crash: the note reached the Bin on the disk, but the app died before the receipt knew.
  const bin = M.createVaultBin({ root: v.dir });
  await bin.put('Me/Finance/Bills/Water.md', { by: 'Bills tidy-up', why: 'folded into the Bills list' });
  // The disk lost it; the index still holds it, as it would mid-crash.
  assert.equal(v.index.get('Me/Finance/Bills/Water.md') !== undefined, true, 'the index still holds the note first');
  const words = await v.rm.billsMoveResume();
  assert.match(words, /finish|done|folded/i, `resume finishes: ${words}`);
  assert.equal(v.index.get('Me/Finance/Bills/Water.md'), undefined, 'the binned note leaves the index');
  const f = await v.rm.finance();
  assert.equal(f.bills.filter((b) => b.name === 'Water').length, 1, 'the bill lists once, from its row');
  assert.match(f.bills.find((b) => b.name === 'Water').path, /Bills\.md#/, 'from its row');
});

test('a frame with one price line folds, whatever its header words', () => {
  const frame = (head) => `---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n${head}\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n`;
  for (const head of ['| Date | Amount | Note |', '| When | Price | Why |', '| From | Cost | Notes |']) {
    const c = B.classifyBillNote({ title: 'Water', props: { type: 'bill' }, content: frame(head) });
    assert.equal(c.fold, true, `${head} with one line folds: ${c.why}`);
  }
  const two = frame('| When | Price | Why |').replace('| | 89.00 | Added by an assistant |', '| 2026-09-10 | 14.99 | Added by an assistant |\n| 2026-10-10 | 16.99 | Went up |');
  const c2 = B.classifyBillNote({ title: 'Water', props: { type: 'bill' }, content: two });
  assert.equal(c2.fold, false, 'two lines still stay');
});

test('words the list cannot carry stay a note: TBC amounts and due days', () => {
  const frame = (amount, due) => `---\ntype: bill\nkind: Bill\namount: ${amount}\ncycle: Monthly\ndue: ${due}\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n`;
  const tbcAmount = B.classifyBillNote({ title: 'Water', props: { type: 'bill', amount: 'TBC' }, content: frame('TBC', '') });
  assert.equal(tbcAmount.fold, false, `TBC amount stays: ${tbcAmount.why}`);
  const tbcDue = B.classifyBillNote({ title: 'Water', props: { type: 'bill', due: 'TBC' }, content: frame('', 'TBC') });
  assert.equal(tbcDue.fold, false, `TBC due stays: ${tbcDue.why}`);
  const blank = B.classifyBillNote({ title: 'Water', props: { type: 'bill' }, content: frame('', '') });
  assert.equal(blank.fold, true, `blank still folds: ${blank.why}`);
});

test('a currency marker folds with its amount, never dropped', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: USD 89\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS, 'Me/Finance/Bills/Cloud.md': BILL });
  const preview = await v.rm.billsMovePreview();
  assert.ok(preview.fold.some((x) => x.name === 'Cloud'), 'a USD amount still folds');
  await v.rm.billsMoveRun();
  const text = readFileSync(path.join(v.dir, 'Me/Finance/Bills.md'), 'utf8');
  assert.match(text, /USD 89/, 'the marker stays in the list');
  const f = await v.rm.finance();
  assert.equal(f.bills.find((b) => b.name === 'Cloud')?.amount, 89, 'it still reads 89');
});

test('a new bill with a due day that is not a day is refused, never silently dateless', async () => {
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  await assert.rejects(() => v.rm.addBill({ name: 'Power', amount: 10, due: 'TBC' }), /day/i, 'TBC due refuses');
  const f = await v.rm.finance();
  assert.equal(f.bills.length, 0, 'nothing was added');
  const at = await v.rm.addBill({ name: 'Power', amount: 10, due: '20 Nov 2026' });
  assert.match(at, /Bills\.md#power/);
  assert.equal((await v.rm.finance()).bills[0].anchor, '2026-11-20', 'a written day still lands');
});

test('a list that cannot be read is refused, never treated as empty', async () => {
  const { chmodSync } = await import('node:fs');
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  await v.rm.addBill({ name: 'Power', amount: 10, due: '2026-11-20', category: 'Home and utilities' });
  // The index has not seen it on this fresh open, and the disk will not give it up.
  v.index.delete?.('Me/Finance/Bills.md');
  const abs = path.join(v.dir, 'Me/Finance/Bills.md');
  chmodSync(abs, 0o000);
  try {
    await assert.rejects(() => v.rm.addBill({ name: 'Water', amount: 5 }), /couldn.t be read|locked|fetching/i, 'an unreadable list refuses the write');
    const f = await v.rm.finance();
    assert.ok(!f.bills.some((b) => b.name === 'Water'), 'nothing was added over it');
  } finally {
    chmodSync(abs, 0o644);
  }
  const after = readFileSync(abs, 'utf8');
  assert.match(after, /\| Power \|/, 'the list itself is untouched');
  assert.ok(!after.includes('Water'), 'nothing was added over it');
  v.index.set('Me/Finance/Bills.md', after, 0, after.length);
  assert.equal((await v.rm.finance()).bills.find((b) => b.name === 'Power')?.amount, 10, 'it reads again after');
});

test('a receipt that cannot be written stops the move in plain words', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS, 'Me/Finance/Bills/Water.md': BILL });
  await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'backup');
  await M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'tables');
  // The receipt cannot be written from here on (its folder read-only; the Bin itself still takes notes).
  const { chmodSync } = await import('node:fs');
  mkdirSync(path.join(v.dir, '.neuralvault', 'bin'), { recursive: true });
  chmodSync(path.join(v.dir, '.neuralvault'), 0o555);
  try {
    await assert.rejects(() => M.billsMove.runBillsMovePhase(v.rm.billsWork(), 'moves'), (e) => {
      assert.match(e.message, /couldn.t|could not|carry on/i, `plain words, got: ${e.message}`);
      assert.ok(!/EISDIR|ENOENT|ENOSPC|EACCES|EPERM/.test(e.message), `no error code, got: ${e.message}`);
      return true;
    }, 'the moves phase refuses plainly');
  } finally {
    chmodSync(path.join(v.dir, '.neuralvault'), 0o755);
  }
});

test('held: amounts, pipes, month ends, paid twice, and every door', async () => {
  // Amounts read as written.
  assert.equal(F.readMoney('$1,234.50'), 1234.5);
  assert.equal(F.readMoney('-12.40'), -12.4);
  assert.equal(F.readMoney('1.5k'), 1500);
  assert.equal(F.readMoney(''), null);
  assert.equal(F.readMoney('TBC'), null);
  // Month ends and leap years.
  assert.equal(F.occurrence('2026-01-31', 'Monthly', 1), '2026-02-28');
  assert.equal(F.occurrence('2024-01-31', 'Monthly', 1), '2024-02-29');
  assert.equal(F.occurrence('2024-02-29', 'Yearly', 1), '2025-02-28');
  // A pipe in a name, account and note survives the table.
  const piped = B.renderBillsTable({ rows: [{ name: 'A|B', cells: { kind: 'Bill', amount: '10.00', cycle: 'Monthly', due: '', category: 'Other', account: 'X|Y', project: '', autopay: 'No', status: 'Active', paid: '' }, note: null }] });
  const back = B.readBillsTable(piped);
  assert.equal(back.rows[0].name, 'A|B');
  assert.equal(back.rows[0].cells.account, 'X|Y');

  // Paid twice says so once: one payment line, one spending row.
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  const at = await v.rm.addBill({ name: 'Power', amount: 214.5, cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' });
  const first = await v.rm.markPaid(at, '2026-11-08');
  assert.match(first, /marked paid/);
  const second = await v.rm.markPaid(at, '2026-11-08');
  assert.match(second, /already marked paid/);
  const list = readFileSync(path.join(v.dir, 'Me/Finance/Bills.md'), 'utf8');
  assert.equal(list.split('\n').filter((l) => /^- Paid /.test(l.trim())).length, 1, 'one payment line');
  const spend = readFileSync(path.join(v.dir, 'Me/Finance/Spending/2026-11.md'), 'utf8');
  assert.equal(spend.split('\n').filter((l) => l.includes('Power')).length, 1, 'one spending row');

  // Every door shows the row with the same amount and due date.
  const f = await v.rm.finance();
  const bill = f.bills.find((b) => b.name === 'Power');
  assert.equal(bill.amount, 214.5);
  assert.equal(bill.paid, '2026-11-08');
  const hits = await v.rm.billsSearchRows('power');
  assert.ok(hits.some((h) => h.name === 'Power'), 'search names it');
  assert.match(await v.rm.billsResolveRow('Power'), /Bills\.md#power/, 'resolve finds its row');
  const note = await v.rm.billRowText(at);
  assert.match(note, /214\.50/, 'its page carries the amount');
  const listed = await v.rm.callTool('finance_bill_list', {}, null);
  assert.match(listed.text, /Power/, 'the assistant lists it');
  assert.match(listed.text, /214\.50/, 'with its amount');
});

test('held: Undo after the person edited a row keeps their change', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue: 2026-11-12\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS, 'Me/Finance/Bills/Water.md': BILL, 'Me/Finance/Bills/Power.md': BILL });
  await v.rm.billsMoveRun();
  // The person fixes one row after the move.
  const f0 = await v.rm.finance();
  const water = f0.bills.find((b) => b.name === 'Water');
  await v.rm.setField('bill', water.path, 'amount', 95);
  const undone = await v.rm.billsMoveUndo();
  assert.match(undone, /Water/, 'their changed bill is named');
  const f = await v.rm.finance();
  assert.equal(f.bills.find((b) => b.name === 'Water')?.amount, 95, 'their fix stays');
  assert.ok(f.bills.some((b) => b.name === 'Power' && !b.path.includes('#')), 'the untouched bill is a note again');
});

test('held: a note with files, tags, links or reminders never folds', () => {
  const frame = (notes) => `---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n${notes}`;
  const base = { title: 'Water', props: { type: 'bill' } };
  assert.equal(B.classifyBillNote({ ...base, content: frame(''), files: ['Me/Finance/Bills/Files/x.pdf'] }).fold, false, 'files stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('#important\n') }).fold, false, 'tags stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('See [[Power]]\n') }).fold, false, 'links stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('![bill](b.png)\n') }).fold, false, 'pictures stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('<!-- hi -->\n') }).fold, false, 'hidden notes stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('Pay ⏰\n') }).fold, false, 'reminders stay');
  assert.equal(B.classifyBillNote({ ...base, content: frame('- Paid $89.00 on Sun 8 Nov.\n') }).fold, true, 'a machine payment line still folds');
});

test('held: emoji and quotes survive the table; one bill added twice is one', () => {
  const both = B.renderBillsTable({ rows: [row('Café “Noir” (HQ)', '10.00'), row('💡💡', '5.00')] });
  const r = B.readBillsTable(both);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].name, 'Café “Noir” (HQ)');
  assert.equal(r.rows[1].name, '💡💡');
  assert.ok(B.rowSlugIn(r.rows, '💡💡').length > 0, 'an emoji bill still opens');
  const same = B.renderBillsTable({ rows: [row('Power', '10.00')] });
  const m = B.mergeBillsTables(same, same, 'the other PC', '8 Nov 2026');
  assert.equal(B.readBillsTable(m.text).rows.length, 1, 'the same bill from both PCs is one row');
  assert.equal(m.changed, false, 'and nothing is rewritten');
});

test('held: a bill added before the tidy-up and after it are both rows, never notes', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS, 'Me/Finance/Bills/Water.md': BILL });
  const before = await v.rm.addBill({ name: 'Power', amount: 10 });
  assert.match(before, /Bills\.md#power/, 'before the move it is a row');
  await v.rm.billsMoveRun();
  const after = await v.rm.addBill({ name: 'Gas', amount: 20 });
  assert.match(after, /Bills\.md#gas/, 'after the move it is a row');
  const f = await v.rm.finance();
  assert.deepEqual(f.bills.map((b) => b.name).sort(), ['Gas', 'Power', 'Water']);
  const { readdirSync, existsSync } = await import('node:fs');
  assert.deepEqual(existsSync(path.join(v.dir, 'Me/Finance/Bills')) ? readdirSync(path.join(v.dir, 'Me/Finance/Bills')).filter((x) => x.endsWith('.md')) : [], [], 'no note files made');
});

test('held: a bill note the disk holds but nothing could read stays a note and is named', async () => {
  const BILL = '---\ntype: bill\nkind: Bill\namount: 89.00\ncycle: Monthly\ndue:\ncategory: Other\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | 89.00 | Added by an assistant |\n\n## Notes\n\n';
  const v = moneyVault({ '.neuralvault/areas.json': AREAS });
  // On the disk but never indexed (an online-only file still fetching reads this way).
  mkdirSync(path.join(v.dir, 'Me/Finance/Bills'), { recursive: true });
  writeFileSync(path.join(v.dir, 'Me/Finance/Bills/Cloud.md'), BILL);
  const preview = await v.rm.billsMovePreview();
  assert.ok(preview.fold.length === 0 && preview.stay.length === 0, 'nothing folds from what cannot be read');
  assert.match(preview.words.join('\n'), /Cloud/, 'and it is named');
  const ran = await v.rm.billsMoveRun();
  assert.match(ran, /Nothing to tidy/, 'the run leaves it alone');
  const { readFileSync: read } = await import('node:fs');
  assert.equal(read(path.join(v.dir, 'Me/Finance/Bills/Cloud.md'), 'utf8'), BILL, 'untouched byte for byte');
});
