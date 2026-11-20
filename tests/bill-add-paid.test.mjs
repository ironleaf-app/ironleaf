// node --test tests/bill-add-paid.test.mjs — a bill added and paid by an assistant must end right (paid
// could be set with the due day stale and nothing recorded). Each check fails
// without its fix, except the create/update-never-writes-paid pin, which guards an invariant that already holds.
// Made-up vault only, in a temp folder; a fixed day (Mon 2 Nov 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-billpaid-'));
let F, X, T, AF, M;
const NOW = new Date(2026, 10, 2, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as F from ${src('src/shared/finance.ts')};`,
    `export * as X from ${src('src/shared/record-module-tools.ts')};`,
    `export * as T from ${src('src/shared/module-tools.ts')};`,
    `export * as AF from ${src('src/shared/agent-full.ts')};`,
  ].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [
    `export * from ${src('src/main/record-modules.ts')};`,
    `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
    `export { runFullTool } from ${src('src/main/agent-full.ts')};`,
    `export { AgentTools, TOOLS } from ${src('src/main/agent.ts')};`,
    `export { gateNotes } from ${src('src/main/agent-gate.ts')};`,
  ].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  ({ F, X, T, AF } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
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

/** Money's main side over made-up files, recording every note written. */
function moneyVault(files, now = NOW) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const written = new Map(Object.entries(files));
  const writes = [];
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => written.has(rel) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true }, documents: { on: true } } }),
    writeNote: async (rel, text) => { writes.push(rel); written.set(rel, text); index.set(rel, text, 0, text.length); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => ({ path: to }),
    post: () => 0,
    requireCreate: async () => {},
    now: () => now,
  });
  return { dir, index, written, writes, rm };
}
const AREAS = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }) };

test('bill-add schema: the category is required only when a new bill is made', () => {
  const schema = X.RECORD_MODULE_TOOLS.find((t) => t.name === 'finance_bill_add');
  assert.deepEqual([...schema.parameters.required], ['name']);
  assert.equal(schema.parameters.properties.category.description, X.BILL_CATEGORY_DESC, 'the schema carries the shared words');
  assert.equal(T.moduleToolDef('finance_bill_add').required.join(','), 'name', 'the side chat and outside agents get the same schema');
  assert.match(schema.description, /every field known in the one call/, 'one call takes the whole bill');
  const ctx = { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: NOW, currency: 'AUD', notes: { finance: [], documents: [] } };
  assert.throws(() => X.planRecordModuleWrite('finance_bill_add', { name: 'Water', amount: 120 }, ctx), /A new bill needs a category/, 'a new bill without a category is refused');
  try {
    X.planRecordModuleWrite('finance_bill_add', { name: 'Water' }, ctx);
    assert.fail('should have refused');
  } catch (e) {
    assert.ok(String(e.message).includes(X.BILL_CATEGORY_DESC), 'the refusal carries the category’s own words');
  }
  const sub = X.planRecordModuleWrite('finance_bill_add', { name: 'Streamly', subscription: true }, ctx);
  assert.match(sub.text, /kind: Subscription/, 'a subscription says what it is: no category asked');
  const finance = [noteOf('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' }))];
  const up = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Internet', amount: 95 }, { ...ctx, notes: { finance, documents: [] } });
  assert.equal(up.update?.path, 'Me/Finance/Bills/Harbour Internet.md', 'an update with just the changed fields works first time');
});

test('create and update never write paid (the live bill came out paid at add time)', () => {
  const ctx = { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: NOW, currency: 'AUD', notes: { finance: [], documents: [] } };
  const made = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Credit Card', amount: 150, cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: true }, ctx);
  assert.doesNotMatch(made.text, /paid:/, 'a new bill carries no paid');
  const finance = [noteOf('Me/Finance/Bills/Harbour Credit Card.md', 'bill', made.text)];
  const up = X.planRecordModuleWrite('finance_bill_add', { name: 'credit card', autopay: true }, { ...ctx, notes: { finance, documents: [] } });
  assert.ok(up.update && !('paid' in up.update.fields), 'an update never touches paid');
});

test('price history: a row only when one amount really replaces another', async () => {
  assert.deepEqual(F.priceHistory(F.newBillText({ name: 'Water', amount: 120.5, cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' })), [], 'a new bill’s first amount is not a price change');
  const { written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Water.md': billText({ cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' }) });
  const first = await rm.callTool('finance_bill_add', { name: 'Water', amount: 120.5 }, null);
  assert.match(first.text, /Updated the bill Water/);
  assert.match(written.get('Me/Finance/Bills/Water.md'), /amount: 120\.5/);
  assert.equal(F.priceHistory(written.get('Me/Finance/Bills/Water.md')).length, 0, 'recording the first amount adds no row');
  const same = await rm.callTool('finance_bill_add', { name: 'Water', amount: 120.5 }, null);
  assert.match(same.text, /already up to date/, 'the same amount again moves nothing');
  assert.equal(F.priceHistory(written.get('Me/Finance/Bills/Water.md')).length, 0);
  const changed = await rm.callTool('finance_bill_add', { name: 'Water', amount: 130 }, null);
  assert.match(changed.text, /Updated the bill Water/);
  assert.deepEqual(F.priceHistory(written.get('Me/Finance/Bills/Water.md')).map((p) => p.amount), [120.5, 130], 'a real change keeps the old amount first, then the new one');
  // The window's own amount edit behaves the same way.
  const { written: w2, rm: rm2 } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Gas.md': billText({ cycle: 'Monthly', category: 'Home and utilities' }) });
  await rm2.setField('bill', 'Me/Finance/Bills/Gas.md', 'amount', 80);
  assert.equal(F.priceHistory(w2.get('Me/Finance/Bills/Gas.md')).length, 0, 'a first amount set where it shows adds no row');
  await rm2.setField('bill', 'Me/Finance/Bills/Gas.md', 'amount', 90);
  assert.equal(F.priceHistory(w2.get('Me/Finance/Bills/Gas.md')).length, 2, 'a real change there adds its row');
});

test('bank import prices: an unchanged amount writes nothing, a first amount sets it with no row', async () => {
  const { written, rm } = moneyVault({
    ...AREAS,
    'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
    'Me/Finance/Bills/Water.md': billText({ cycle: 'Monthly', due: '2026-11-20', category: 'Home and utilities' }),
  });
  const words = await rm.importApply({
    rows: [],
    prices: [
      { bill: 'Me/Finance/Bills/Harbour Internet.md', to: 89, date: '2026-10-28' },
      { bill: 'Me/Finance/Bills/Water.md', to: 120.5, date: '2026-10-28' },
    ],
  });
  assert.match(words, /1 price brought up to date/, 'only the first amount counts: the unchanged one is skipped');
  assert.equal(F.priceHistory(written.get('Me/Finance/Bills/Harbour Internet.md')).length, 0, 'the same amount again adds no row');
  assert.match(written.get('Me/Finance/Bills/Water.md'), /amount: 120\.5/);
  assert.equal(F.priceHistory(written.get('Me/Finance/Bills/Water.md')).length, 0, 'a first amount from the bank sets it with no row');
});

test('mark paid records one line on the bill; a retried repayment never steers to spending', async () => {
  const { written, rm } = moneyVault({
    ...AREAS,
    'Me/Finance/Bills/Harbour Credit Card.md': billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' }),
    'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
  });
  const said = await rm.markPaid('Me/Finance/Bills/Harbour Credit Card.md', '2026-11-02');
  assert.match(said, /marked paid \(\$150\.00\), a transfer so not counted as spending/);
  const card = written.get('Me/Finance/Bills/Harbour Credit Card.md');
  assert.match(card, /paid: 2026-11-02/);
  assert.match(card, /due: 2026-12-08/);
  assert.match(card, /- Paid \$150\.00 on Mon 2 Nov\. This cycle is covered: paid by hand before the autopay day Sun 8 Nov\./);
  assert.equal((card.match(/^- Paid /gm) ?? []).length, 1, 'one payment, one line');
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\| 2026-11-02 \| Harbour Credit Card \| Transfers \| 150\.00 \|/, 'a repayment leaves a Transfers trace');
  const retry = await rm.markPaid('Me/Finance/Bills/Harbour Credit Card.md', '2026-11-02');
  assert.match(retry, /already marked paid/, 'a retry says already paid instead of throwing');
  assert.match(retry, /recorded on the bill/, 'a retried repayment is not steered to spending');
  assert.equal(((written.get('Me/Finance/Bills/Harbour Credit Card.md').match(/^- Paid /gm) ?? []).length), 1, 'the retry adds no second line');
  await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-10-28');
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /- Paid \$89\.00 on Wed 28 Oct\./);
  assert.match(written.get('Me/Finance/Spending/2026-10.md'), /\| 2026-10-28 \| Harbour Internet \| Phone and internet \| 89\.00 \|/, 'an ordinary bill still lands its payment in spending');
});

test('no-op updates write nothing and say the record is already up to date', async () => {
  const { written, writes, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' }) });
  const before = written.get('Me/Finance/Bills/Harbour Internet.md');
  const noop = await rm.callTool('finance_bill_add', { name: 'Harbour Internet', amount: 89, due: '2026-10-28', cycle: 'Monthly' }, null);
  assert.match(noop.text, /Harbour Internet is already up to date in Money: nothing was changed/, 'no claim of an update that never happened');
  assert.equal(written.get('Me/Finance/Bills/Harbour Internet.md'), before);
  assert.equal(writes.length, 0, 'no write, no Changed card for a no-op');
  const real = await rm.callTool('finance_bill_add', { name: 'Harbour Internet', amount: 95 }, null);
  assert.match(real.text, /Updated the bill Harbour Internet/);
  assert.equal(writes.length, 1, 'a real update still lands');
  const filed = await rm.fileInboxBill({ kind: 'line', path: 'Inbox.md', words: 'Your Harbour Internet bill of $95.00 is due on 28 Oct 2026' });
  assert.match(filed.words, /already up to date/, 'an emailed bill that matches says so too');
});

test('note_set_properties routes a bill’s paid and due through Mark paid', async () => {
  const def = AF.FULL_TOOLS.find((t) => t.name === 'note_set_properties');
  assert.match(def.description, /kept by Money’s own tools/, 'the tool’s own words say paid and due are not written here');
  assert.match(def.description, /finance_bill_add/);
  const { index, written, rm } = moneyVault({
    ...AREAS,
    'Me/Finance/Bills/Harbour Credit Card.md': billText({ amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes' }),
    'Notes/Invoice 12.md': '---\ntype: note\n---\n# Invoice 12\n',
  });
  const kit = (extra = {}) => ({
    host: {},
    content: (rel) => index.content(rel),
    readNote: async (rel) => index.content(rel),
    writeNote: async (rel, text) => { written.set(rel, text); index.set(rel, text, 0, text.length); },
    existingNote: (raw) => String(raw),
    writableNote: () => {},
    markBillPaid: (rel, day) => rm.markPaid(rel, day),
    ...extra,
  });
  const paid = await M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: '2026-11-02' } });
  assert.match(paid.text, /Harbour Credit Card marked paid/);
  assert.match(paid.text, /\[Me\/Finance\/Bills\/Harbour Credit Card\.md\]/);
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /due: 2026-12-08/, 'setting paid moves the due day');
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /^- Paid \$150\.00 on Mon 2 Nov\./m, 'and records the line');
  assert.equal(paid.done.undo.kind, 'note-edited', 'taken back like any edit');
  const snap = written.get('Me/Finance/Bills/Harbour Credit Card.md');
  await assert.rejects(M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: null } }), /kept by Mark paid.*finance_bill_mark_paid/, 'clearing paid is refused naming Mark paid');
  await assert.rejects(M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: null } }), /undo the change that recorded it/, 'with how to undo the payment');
  await assert.rejects(M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { due: '2026-12-08' } }), /changed with finance_bill_add/, 'the day it falls routes to the bill tool');
  await assert.rejects(M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { due: null } }), /keeps the day it falls/, 'taking the day off is refused too');
  await assert.rejects(M.runFullTool(kit(), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: '2026-11-02', status: 'Active' } }), /on its own/, 'paid with anything else is set on its own, never half-dropped');
  assert.equal(written.get('Me/Finance/Bills/Harbour Credit Card.md'), snap, 'every refusal leaves the bill exactly as it was');
  await assert.rejects(M.runFullTool(kit({ markBillPaid: undefined }), 'note_set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: '2026-12-02' } }), /isn’t available here/, 'never written bare, even where Mark paid cannot run');
  const plain = await M.runFullTool(kit(), 'note_set_properties', { path: 'Notes/Invoice 12.md', properties: { paid: '2026-11-02' } });
  assert.match(plain.text, /Set paid on/, 'a note that is not a bill is untouched by the rule');
});

test('the side chat’s set_properties routes a bill’s paid and due the same way', async () => {
  const def = M.TOOLS.find((t) => t.name === 'set_properties');
  assert.match(def.description, /kept by Money's own tools/);
  const { index, written, rm } = moneyVault({ ...AREAS, 'Me/Finance/Bills/Harbour Credit Card.md': billText({ amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes' }) });
  const files = new Map(written);
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => files.get(rel),
    write: async (rel, text) => { files.set(rel, text); written.set(rel, text); index.set(rel, text, 0, text.length); },
    makeFolder: async () => {},
    move: async (from, to) => ({ path: to, linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => String(rel ?? ''),
    today: () => 'Monday 2 November 2026 (2026-11-02)',
    markBillPaid: (rel, day) => rm.markPaid(rel, day),
  };
  const tools = new M.AgentTools(host, [], () => {});
  const run = (name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
  const paid = await run('set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: '2026-11-02' } });
  assert.match(paid.text, /Harbour Credit Card marked paid/);
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /due: 2026-12-08/);
  assert.match(written.get('Me/Finance/Bills/Harbour Credit Card.md'), /^- Paid \$150\.00 on Mon 2 Nov\./m);
  assert.equal(tools.changes.length, 1, 'the payment is one change, taken back like any edit');
  const snap = written.get('Me/Finance/Bills/Harbour Credit Card.md');
  const cleared = await run('set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { paid: null } });
  assert.equal(cleared.isError, true);
  assert.match(cleared.text, /finance_bill_mark_paid/, 'clearing paid is refused naming Mark paid');
  const moved = await run('set_properties', { path: 'Me/Finance/Bills/Harbour Credit Card.md', properties: { due: '2026-12-08' } });
  assert.equal(moved.isError, true);
  assert.match(moved.text, /finance_bill_add/, 'the day it falls routes to the bill tool');
  assert.equal(written.get('Me/Finance/Bills/Harbour Credit Card.md'), snap, 'every refusal leaves the bill exactly as it was');
});

test('marking paid through the gate is checked like every write, and wired in the app', async () => {
  const calls = [];
  const { index } = moneyVault({ ...AREAS });
  const base = { index, markBillPaid: async (rel, day) => `Marked ${rel} paid ${day}.` };
  const g = { check: (rel, kind) => calls.push(['check', rel, kind]), note: (rel, kind, words) => calls.push(['note', rel, kind, words]) };
  const gated = M.gateNotes(base, g);
  assert.equal(await gated.markBillPaid('Me/Finance/Bills/Card.md', '2026-11-02'), 'Marked Me/Finance/Bills/Card.md paid 2026-11-02.');
  assert.deepEqual(calls[0], ['check', 'Me/Finance/Bills/Card.md', 'changed'], 'the gate is asked before the payment is recorded');
  assert.match(read('src/main/app.ts'), /markBillPaid: \(rel: string, day: string\) => recordModules\.markPaid\(rel, day\)/, 'the app’s host marks paid the window’s own way');
  assert.match(read('src/main/agent-access.ts'), /h\.notes\.markBillPaid/, 'Full control reaches it through the agent’s own notes');
});

test('free-text writes keep a bill’s paid and due, naming the tool that changes them', () => {
  assert.match(AF.FULL_TOOLS.find((t) => t.name === 'note_write').description, /paid and due stay as they are/, 'note_write steers the model right');
  assert.match(AF.FULL_TOOLS.find((t) => t.name === 'note_write').description, /finance_bill_mark_paid/);
  assert.match(AF.FULL_TOOLS.find((t) => t.name === 'note_write').description, /finance_bill_add/);
  assert.match(M.TOOLS.find((t) => t.name === 'edit_note').description, /paid and due stay as they are/, 'edit_note steers the model right');
  assert.match(M.TOOLS.find((t) => t.name === 'edit_note').description, /finance_bill_mark_paid/);
  assert.match(M.TOOLS.find((t) => t.name === 'edit_note').description, /finance_bill_add/);
  const bill = billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' });
  const withPaid = X.guardBillFreeText(bill, bill.replace('status: Active', 'status: Active\npaid: 2026-11-02'));
  assert.deepEqual(withPaid.kept, ['paid'], 'a typed-in paid day is kept off');
  assert.match(withPaid.note, /finance_bill_mark_paid/);
  assert.doesNotMatch(withPaid.text, /paid:/, 'no paid line is left behind');
  assert.match(withPaid.text, /status: Active/, 'the rest of the write lands');
  const moved = X.guardBillFreeText(bill, bill.replace('due: 2026-11-08', 'due: 2026-11-15'));
  assert.deepEqual(moved.kept, ['due'], 'a moved due day is kept back');
  assert.match(moved.note, /finance_bill_add/);
  assert.match(moved.text, /due: 2026-11-08/);
  const paid = billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active', paid: '2026-10-02' });
  const both = X.guardBillFreeText(paid, paid.replace('paid: 2026-10-02', 'paid: 2026-11-02').replace('due: 2026-11-08', 'due: 2026-12-08'));
  assert.deepEqual(both.kept, ['paid', 'due']);
  assert.match(both.note, /finance_bill_mark_paid/);
  assert.match(both.note, /finance_bill_add/);
  assert.match(both.text, /paid: 2026-10-02/);
  assert.match(both.text, /due: 2026-11-08/);
  const cleared = X.guardBillFreeText(paid, paid.replace(/^paid: 2026-10-02\n/m, ''));
  assert.deepEqual(cleared.kept, ['paid'], 'clearing paid by rewriting it away is kept too');
  assert.match(cleared.text, /paid: 2026-10-02/);
  const words = X.guardBillFreeText(bill, bill.replace('due: 2026-11-08', 'due: 8 Nov 2026'));
  assert.deepEqual(words.kept, [], 'the same day in other words is not a change');
  assert.equal(words.note, '');
  assert.match(words.text, /due: 8 Nov 2026/, 'a format-only difference passes through untouched');
  const body = X.guardBillFreeText(bill, `${bill}\nCredit Card paid off the holiday flights.\n`);
  assert.deepEqual(body.kept, []);
  assert.equal(body.text, `${bill}\nCredit Card paid off the holiday flights.\n`, 'anything else on the bill passes through');
  // Reviewer's call (finding 5): a new bill written as free text starts unpaid; its due day stays as written.
  const made = X.guardBillFreeText('', paid);
  assert.deepEqual(made.kept, ['paid'], 'a new bill never starts paid');
  assert.doesNotMatch(made.text, /paid:/);
  assert.match(made.text, /due: 2026-11-08/, 'its due day stays');
  assert.match(made.note, /finance_bill_mark_paid/);
  assert.deepEqual(X.guardBillFreeText('', bill).kept, [], 'a new unpaid bill passes through');
  const plain = '---\ntype: note\n---\n# Invoice 12\n';
  const other = X.guardBillFreeText(plain, plain.replace('# Invoice 12', '# Invoice 12\npaid: 2026-11-02'));
  assert.deepEqual(other.kept, [], 'a note that is not a bill is untouched by the rule');
  assert.match(other.text, /paid: 2026-11-02/);
});

test('note_write keeps a bill’s paid and due as they were', async () => {
  const rel = 'Me/Finance/Bills/Harbour Credit Card.md';
  const start = billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' });
  const { index, written, rm } = moneyVault({ ...AREAS, [rel]: start, 'Notes/Invoice 12.md': '---\ntype: note\n---\n# Invoice 12\n' });
  const kit = {
    host: {},
    content: (rel) => index.content(rel),
    readNote: async (rel) => index.content(rel),
    noteExists: async (rel) => written.has(rel),
    writeNote: async (rel, text) => { written.set(rel, text); index.set(rel, text, 0, text.length); },
    cleanNote: (raw) => String(raw),
    existingNote: (raw) => String(raw),
    writableNote: () => {},
    markBillPaid: (rel, day) => rm.markPaid(rel, day),
  };
  const rewrite = start.replace('due: 2026-11-08', 'due: 2026-11-15').replace('status: Active', 'status: Active\npaid: 2026-11-02');
  const r = await M.runFullTool(kit, 'note_write', { path: rel, content: rewrite });
  assert.match(r.text, /Rewrote /);
  assert.match(r.text, /finance_bill_mark_paid/);
  assert.match(r.text, /finance_bill_add/);
  assert.match(written.get(rel), /due: 2026-11-08/);
  assert.doesNotMatch(written.get(rel), /paid:/);
  assert.equal(r.done.undo.after, written.get(rel), 'undo takes back what was actually written');
  const body = await M.runFullTool(kit, 'note_write', { path: rel, content: `${written.get(rel)}\nHoliday flights are on this card.\n` });
  assert.equal(body.text, `Rewrote ${rel}.`, 'a rewrite that leaves them alone says nothing extra');
  assert.match(written.get(rel), /Holiday flights/);
  const plain = await M.runFullTool(kit, 'note_write', { path: 'Notes/Invoice 12.md', content: '---\ntype: note\npaid: 2026-11-02\n---\n# Invoice 12\n' });
  assert.equal(plain.text, 'Rewrote Notes/Invoice 12.md.');
  assert.match(written.get('Notes/Invoice 12.md'), /paid: 2026-11-02/, 'any other note is untouched by the rule');
});

test('the side chat’s edit_note keeps a bill’s paid and due as they were', async () => {
  const rel = 'Me/Finance/Bills/Harbour Credit Card.md';
  const start = billText({ kind: 'Bill', amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: 'Yes', status: 'Active' });
  const { index, written, rm } = moneyVault({ ...AREAS, [rel]: start });
  const files = new Map(written);
  const host = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => files.get(rel),
    write: async (rel, text) => { files.set(rel, text); written.set(rel, text); index.set(rel, text, 0, text.length); },
    makeFolder: async () => {},
    move: async (from, to) => ({ path: to, linksUpdated: 0 }),
    trash: async () => {},
    clean: (rel) => String(rel ?? ''),
    today: () => 'Monday 2 November 2026 (2026-11-02)',
    markBillPaid: (rel, day) => rm.markPaid(rel, day),
  };
  const tools = new M.AgentTools(host, [], () => {});
  const run = (name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
  const moved = await run('edit_note', { path: rel, action: 'replace', find: 'due: 2026-11-08', text: 'due: 2026-11-15' });
  assert.ok(!moved.isError, moved.text);
  assert.match(moved.text, /finance_bill_add/);
  assert.match(written.get(rel), /due: 2026-11-08/);
  const typed = await run('edit_note', { path: rel, action: 'replace', find: 'status: Active', text: 'status: Active\npaid: 2026-11-02' });
  assert.ok(!typed.isError, typed.text);
  assert.match(typed.text, /finance_bill_mark_paid/);
  assert.doesNotMatch(written.get(rel), /^paid:/m);
  const body = await run('edit_note', { path: rel, action: 'replace', find: '## Notes', text: '## Notes\n\nHoliday flights are on this card.' });
  assert.equal(body.text, `Changed ${rel}.`, 'a change that leaves them alone says nothing extra');
});

test('credit card end to end: added with every field in one call, then paid on 2 Nov', async () => {
  const { written, rm } = moneyVault({ ...AREAS });
  const added = await rm.callTool('finance_bill_add', { name: 'Harbour Credit Card', amount: 150, cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', autopay: true }, null);
  assert.match(added.text, /Added the bill Harbour Credit Card/);
  assert.match(added.text, /\[Me\/Finance\/Bills\.md#latitude-credit-card\]/, 'new bills are rows in the one list');
  const rel = 'Me/Finance/Bills.md';
  assert.ok(written.has(rel), 'the list is made');
  const row = written.get(rel).split('\n').find((l) => l.includes('Harbour Credit Card'));
  assert.match(row, /\| 150\.00 \| Monthly \| 2026-11-08 \| Loans and cards \|/, 'every field in its row');
  assert.match(row, /\| Yes \| Active \|  \|/, 'made, never marked paid by making it');
  assert.deepEqual((await rm.finance()).bills.find((b) => b.name === 'Harbour Credit Card').history, [], 'no price row for its first amount');
  const paid = await rm.callTool('finance_bill_mark_paid', { bill: 'credit card', date: '2026-11-02' }, null);
  assert.match(paid.text, /Harbour Credit Card marked paid/);
  assert.match(paid.text, /Next due Tue 8 Dec/);
  assert.match(paid.text, /This cycle is covered/);
  const final = (await rm.finance()).bills.find((b) => b.name === 'Harbour Credit Card');
  assert.equal(final.paid, '2026-11-02');
  assert.equal(final.anchor, '2026-12-08', 'the due day moves to the coming cycle');
  assert.equal((written.get(rel).match(/^- Paid /gm) ?? []).length, 1, 'one list line records the payment');
  assert.match(written.get('Me/Finance/Spending/2026-11.md'), /\| 2026-11-02 \| Harbour Credit Card \| Transfers \| 150\.00 \|/, 'a card repayment leaves a Transfers trace');
  assert.deepEqual([...written.keys()].sort(), ['.neuralvault/areas.json', rel, 'Me/Finance/Spending/2026-11.md'], 'nothing else made');
});
