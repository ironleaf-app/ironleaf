// node --test tests/uplift-round2b.test.mjs — 9.2 fresh-eyes second pass (the findings F1–F7):
// each check fails without its fix. Made-up vault only, in a temp folder.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92b-'));
let F, X, P, Q, R, M;
const TODAY = new Date(2026, 9, 24, 10, 0);
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as F from ${src('src/shared/finance.ts')};`,
    `export * as X from ${src('src/shared/record-module-tools.ts')};`,
    `export * as P from ${src('src/shared/project-file.ts')};`,
    `export * as Q from ${src('src/shared/query.ts')};`,
    `export * as R from ${src('src/shared/reminders.ts')};`,
  ].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * from ${src('src/main/record-modules.ts')};`, `export { VaultIndex } from ${src('src/main/indexer.ts')};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  ({ F, X, P, Q, R } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const billText = (props) => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`;
const note = (p, type, content, props = {}) => {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  const parsed = { ...props };
  if (m) for (const line of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) parsed[kv[1]] = kv[2].replace(/^"|"$/g, ''); }
  return { path: p, title: p.split('/').pop().replace(/\.md$/, ''), props: parsed, content, type };
};

test('F1: adding by the name people use updates the record there, never a second one', () => {
  const finance = [
    note('Me/Finance/Bills/Harbour Credit Card.md', 'bill', billText({ amount: '150.00', cycle: 'Monthly', due: '2026-11-08', category: 'Loans and cards', nickname: 'credit card' })),
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
    note('Me/Finance/Bills/Harbour Internet Backup.md', 'bill', billText({ amount: '49.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
    note('Me/Finance/Accounts/Everyday.md', 'bank-account', '---\ntype: bank-account\ninstitution: Harbour Bank\nkind: Everyday\nbalance: 1200\n---\n'),
  ];
  const ctx = { on: ['finance'], areas: [{ id: 'me', folder: 'Me' }], today: TODAY, currency: 'AUD', notes: { finance, documents: [] } };
  const byNickname = X.planRecordModuleWrite('finance_bill_add', { name: 'credit card', amount: 150, category: 'Loans and cards' }, ctx);
  assert.equal(byNickname.update?.path, 'Me/Finance/Bills/Harbour Credit Card.md', 'the nickname reaches the bill there');
  const byShort = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Credit', amount: 150, category: 'Loans and cards' }, ctx);
  assert.equal(byShort.update?.path, 'Me/Finance/Bills/Harbour Credit Card.md', 'a short name reaches the bill there');
  const byBank = X.planRecordModuleWrite('finance_account_add', { name: 'Harbour Bank', balance: 900 }, ctx);
  assert.equal(byBank.update?.path, 'Me/Finance/Accounts/Everyday.md', 'the bank’s name reaches the account there');
  assert.throws(() => X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour', category: 'Phone and internet' }, ctx), /More than one bill matches/, 'two close bills are named, never silently the first');
});

test('F2: a project line added twice is written once', () => {
  const p = P.parseProject('---\ntype: project\nstatus: active\n---\n# Winter Menu Launch\n\n## What’s next\n\n- [ ] Order the rye flour — Sam\n', 'Projects/Winter/Winter.md');
  const first = P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Call Priya', who: 'Sam' } }, '24 Oct 2026');
  assert.match(first, /Added a next step/);
  const again = P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'call  priya', who: 'sam' } }, '24 Oct 2026');
  assert.match(again, /already/, 'the retry says it is there already');
  assert.equal(p.next.filter((n) => /call priya/i.test(n.what)).length, 1, 'one step, not two');
  const date = P.applyProjectEdit(p, { kind: 'add', list: 'dates', item: { when: '20 Nov 2026', what: 'Menu launch' } }, '24 Oct 2026');
  assert.match(date, /Added a key date/);
  assert.match(P.applyProjectEdit(p, { kind: 'add', list: 'dates', item: { when: '20 Nov 2026', what: 'Menu launch' } }, '24 Oct 2026'), /already/);
  assert.equal(p.dates.filter((d) => d.what === 'Menu launch').length, 1);
});

test('F4: an overdue bill is due now in the look-ahead, counted once in weeks and totals alike', () => {
  const notes = [note('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-21', category: 'Phone and internet', autopay: 'No' }))];
  const model = F.financeModel(notes, TODAY);
  assert.equal(model.bills[0].next, '2026-10-21');
  assert.equal(model.bills[0].overdue, true);
  const f = F.financeForecast(model, { days: 30 });
  assert.ok(f.events.every((e) => e.date >= f.from), 'no event is laid before the window');
  assert.equal(f.events[0].date, '2026-10-24', 'what is already owed is due now');
  const weeksOut = Math.round(f.weeks.reduce((s, w) => s + w.out, 0) * 100) / 100;
  assert.equal(f.totalOut, weeksOut, 'the total and the weeks count the same money');
});

test('F3 (bill link): a bank row links to the bill it names most fully, and to none on a tie', () => {
  const notes = [
    note('Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
    note('Me/Finance/Bills/Harbour Internet Backup.md', 'bill', billText({ amount: '49.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
    note('Me/Finance/Bills/Internet Harbour.md', 'bill', billText({ amount: '10.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet' })),
  ];
  const model = F.financeModel(notes, TODAY);
  const table = [['Date', 'Description', 'Amount'], ['28/10/2026', 'HARBOUR INTERNET BACKUP PTY LTD', '-49.00'], ['28/10/2026', 'HARBOUR INTERNET', '-10.00']];
  const plan = F.planBankImport(table, model, TODAY);
  assert.equal(plan.rows[0].bill, 'Me/Finance/Bills/Harbour Internet Backup.md', 'the fuller name wins');
  assert.equal(plan.rows[1].bill, undefined, 'two bills fit equally: neither is guessed');
});

test('F7: search scores only words a note truly matches', () => {
  const matcher = new Q.QueryMatcher(Q.parseQuery('visa'));
  const accident = { path: 'Notes/Advisable.md', title: 'Advisable notes', content: 'advisable advisable advisable', tags: [], props: {} };
  const real = { path: 'Notes/Visa.md', title: 'Credit Card', content: 'visa', tags: [], props: {} };
  assert.equal(matcher.matches(accident), false);
  assert.equal(matcher.score(accident), 1, 'letters inside other words score nothing');
  assert.ok(matcher.score(real) > matcher.score(accident), 'the real match ranks first');
});

test('F6: the same reminder is already set, in shared words the writer uses', () => {
  const content = '# Reminders\n\n- [ ] Order flour ⏰ 2026-10-30 09:00\n';
  assert.equal(typeof R.sameReminder, 'function', 'reminders.ts offers the check');
  assert.equal(R.sameReminder(content, 'Order flour', new Date(2026, 9, 30, 9, 0), null), true);
  assert.equal(R.sameReminder(content, 'Order flour', new Date(2026, 9, 31, 9, 0), null), false);
  assert.equal(R.sameReminder(content, 'Order sugar', new Date(2026, 9, 30, 9, 0), null), false);
  assert.match(read('src/main/agent.ts'), /findSameReminder\(/, 'set_reminder checks every home before it writes');
});

test('F5: a failed Spending write leaves the bill unpaid, and the retry lands one row', async () => {
  const files = {
    '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }),
    'Me/Finance/Bills/Harbour Internet.md': billText({ amount: '89.00', cycle: 'Monthly', due: '2026-10-28', category: 'Phone and internet', autopay: 'No' }),
  };
  const dir = mkdtempSync(path.join(work, 'vault-'));
  for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  const written = new Map(Object.entries(files));
  let failSpending = true;
  const rm = new M.RecordModules({
    vault: () => ({ root: dir, any: async (rel) => written.has(rel) }),
    index,
    prefs: () => ({ templatesFolder: 'Templates', modules: { finance: { on: true }, documents: { on: true } } }),
    writeNote: async (rel, text) => { if (failSpending && rel.includes('Spending')) throw new Error('the disk said no'); written.set(rel, text); index.set(rel, text, 0, text.length); },
    importFiles: async () => [],
    pickFiles: async () => [],
    movePath: async (from, to) => ({ path: to }),
    post: () => 0,
    requireCreate: async () => {},
    now: () => TODAY,
  });
  await assert.rejects(() => rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-10-28'), /disk said no/);
  assert.doesNotMatch(written.get('Me/Finance/Bills/Harbour Internet.md'), /paid:/, 'the bill is not marked paid when its payment could not be recorded');
  failSpending = false;
  await rm.markPaid('Me/Finance/Bills/Harbour Internet.md', '2026-10-28');
  assert.match(written.get('Me/Finance/Bills/Harbour Internet.md'), /paid: 2026-10-28/);
  assert.equal((written.get('Me/Finance/Spending/2026-10.md').match(/Harbour Internet/g) ?? []).length, 1, 'one payment row after the retry');
});
