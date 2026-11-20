// node --test tests/uplift-round2.test.mjs — 9.2 round 2 (money, records, imports, sensitivity):
// each check fails without its fix. Made-up vault only, in a temp folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-uplift2-'));
let F, L, V, M, S, R, X, E, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as F from ${src('src/shared/finance.ts')};`,
    `export * as L from ${src('src/shared/layouts.ts')};`,
    `export * as V from ${src('src/shared/views.ts')};`,
    `export * as M from ${src('src/shared/record-match.ts')};`,
    `export * as S from ${src('src/shared/sensitivity.ts')};`,
    `export * as R from ${src('src/shared/records.ts')};`,
    `export * as X from ${src('src/shared/record-module-tools.ts')};`,
    `export * as E from ${src('src/main/pairing/engine.ts')};`,
    `export * as T from ${src('src/shared/pairing/types.ts')};`,
  ].join('\n'));
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ F, L, V, M, S, R, X, E, T } = await import(pathToFileURL(path.join(work, 'b.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('money: European amounts, spend and table retries never double', () => {
  assert.equal(F.readMoney('1.234,50'), 1234.5);
  assert.equal(F.readMoney('$1,234.50'), 1234.5);
  const month = F.newSpendingText('2026-11');
  const row = { date: '2026-11-01', what: 'Woolworths', category: 'Groceries', amount: 42.5, account: '', receipt: '' };
  const once = F.withSpendRows(month, [row]);
  assert.equal(F.withSpendRows(once, [row]), once);
  const table = '| Date | Amount |\n| --- | --- |\n';
  const added = L.addTableRow(table, ['Date', 'Amount'], ['2026-11-01', '10.00']);
  assert.equal(L.addTableRow(added, ['Date', 'Amount'], ['2026-11-01', '10.00']), added);
});

test('properties: an empty word never deletes; null still removes', () => {
  const note = '---\nstatus: Active\n---\nBody\n';
  assert.equal(V.setNoteProp(note, 'status', ''), note);
  assert.doesNotMatch(V.setNoteProp(note, 'status', null), /status/);
});

test('finder: fillers, nicknames and institutions resolve; a bill is never its own account', () => {
  const bills = [{ name: 'Harbour Credit Card', path: 'B/Harbour Credit Card.md', names: ['credit card'] }, { name: 'AGL Electricity', path: 'B/AGL.md', names: ['power bill'] }];
  assert.equal(M.resolveOne(bills, 'my card', { noun: 'bill' }).name, 'Harbour Credit Card');
  assert.equal(M.resolveOne(bills, 'credit card', { noun: 'bill' }).name, 'Harbour Credit Card');
  assert.equal(M.resolveOne(bills, 'power bill', { noun: 'bill' }).name, 'AGL Electricity');
  const finance = [
    { path: 'Me/Finance/Bills/Harbour Credit Card.md', title: 'Harbour Credit Card', props: { nickname: 'credit card' }, content: '', type: 'bill' },
    { path: 'Me/Finance/Accounts/Everyday.md', title: 'Everyday', props: { institution: 'Harbour Bank' }, content: '', type: 'bank-account' },
  ];
  const self = X.planRecordModuleWrite('finance_bill_add', { name: 'Harbour Credit Card', category: 'Loans and cards', account: 'Harbour Credit Card' }, { on: ['finance'], areas: null, notes: { finance, documents: [] } });
  assert.doesNotMatch(self.text, /\[\[Harbour Credit Card\]\]/);
  const from = X.planRecordModuleWrite('finance_bill_add', { name: 'New Card', category: 'Loans and cards', account: 'Harbour Bank' }, { on: ['finance'], areas: null, notes: { finance, documents: [] } });
  assert.match(from.text, /\[\[Harbour Bank\]\]|\[\[Everyday\]\]/);
});

test('records: misses name no tool, facts keep tags and money, copies are flagged', () => {
  const notes = [
    { path: 'Editions/No. 3 - 2026-10-26.md', title: 'No. 3 - 2026-10-26', content: '# No. 3\n', props: {}, mtime: 1 },
    { path: 'Editions/No. 3 - 2026-10-26 2.md', title: 'No. 3 - 2026-10-26 2', content: '# copy\n', props: {}, mtime: 2 },
  ];
  const model = R.buildRecordModel({ notes, resolve: () => null, today: '2026-11-01' });
  const answer = R.answerRecordTool(model, 'connected_to', { what: 'zzzz nothing' });
  assert.doesNotMatch(answer, /search_notes|projects_list|meetings_list/);
  const facts = R.propFacts({ tags: ['autopay'], amount: '$1,500', minimum_due: '25', autopay: { day: 8 } });
  assert.ok(facts.some((f) => f.label === 'Tags'));
  assert.ok(facts.some((f) => f.value === '$1,500.00'));
  assert.ok(facts.some((f) => f.key === 'autopay.day'));
  const peek = R.peekOf(model, { id: 'note:Editions/No. 3 - 2026-10-26.md' });
  assert.ok(peek.record.facts.some((f) => f.key === 'duplicate'));
  assert.equal(R.resolveRef(model, { id: 'note:Old/No. 3 - 2026-10-26.md' })?.title, 'No. 3 - 2026-10-26');
});

test('sensitivity: folder itself, merged grants, bot money default, audit and front matter', () => {
  const store = S.parseSensitivity({ folders: { Health: 'health' }, access: { 'bot:a': ['health'] } });
  assert.equal(S.folderLevel(store, 'Health').level, 'health');
  assert.ok(!S.accessOf(S.emptyStore(), 'neuralbot').includes('personal'), 'Personal stays the person’s choice for bots');
  assert.equal(S.frontLevel('\n---\nsensitivity: personal # mine\n---\n'), 'personal');
  assert.equal(S.frontValue('---\ntype: [[Bill]]\n---\n', 'type'), 'bill');
  const csv = S.auditCsv([{ at: 0, who: 'you', whoName: 'You', action: 'read', item: '=cmd', detail: 'a\rb' }]);
  assert.match(csv, /'=cmd/);
  assert.match(csv, /"a\rb"/);
  assert.throws(() => S.secretLink('bad id!'), /not valid/);
  assert.deepEqual(S.secretIdsIn('[locked](secret:abc123_X) and [x](secret:abc123_X)'), ['abc123_X']);
});

test('imports: existing note is adopted, how-to never crashes', async () => {
  assert.match(T.sourceHow('todoist').how, /Todoist/);
  const v = path.join(work, 'vault');
  mkdirSync(path.join(v, 'Recipes'), { recursive: true });
  writeFileSync(path.join(v, 'Recipes', 'Banana pancakes.md'), '# Banana pancakes\n\nMine.\n');
  const read = { kind: 'evernote', name: 'Cooking', items: [{ id: 'n1', title: 'Banana pancakes', folder: 'Recipes', props: {}, body: 'From Evernote.\n', files: [] }], views: [], skipped: [] };
  const summary = await E.importSource(v, await E.liveSource(v, read, { sourceFile: 'Evernote.enex', into: 'From Evernote/Cooking' }), { now: new Date(2026, 10, 1) });
  assert.ok(!existsSync(path.join(v, 'From Evernote', 'Cooking', 'Recipes', 'Banana pancakes 2.md')), 'no “ 2” copy minted');
  assert.equal(readFileSync(path.join(v, 'Recipes', 'Banana pancakes.md'), 'utf8'), '# Banana pancakes\n\nMine.\n', 'the person’s note is kept');
  assert.equal(summary.conflicts.length, 1, 'the source’s words sit beside it to compare');
});
