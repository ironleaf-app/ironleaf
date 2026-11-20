// node --test tests/money-tight.test.mjs — one plain sentence when the next 30 days look tight (10.0 v10money):
// the morning brief carries it and the bell says it in the same words, once. Silent when calm and when there is
// nothing to measure against (no balance and no pay written). Made-up bills, shops and amounts only; a fixed day
// (Mon 2 Nov 2026). Each check fails without its change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tight-'));
let F, B, M;
const NOW = new Date(2026, 10, 2, 8, 30);
const TODAY = '2026-11-02';
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/finance.ts'), platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
  await build({ input: path.join(root, 'src/shared/brief.ts'), platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export { RecordModules } from ${JSON.stringify(path.join(root, 'src/main/record-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const billText = (props) => `---\ntype: bill\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Notes\n`;
const accountText = (props) => `---\ntype: bank-account\n${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n## Notes\n`;
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
const CARD = ['Me/Finance/Bills/Credit Card.md', 'bill', billText({ amount: '1284.00', cycle: 'Monthly', due: '2026-10-26', category: 'Cards and loans', autopay: 'No' })];
const HARBOUR = ['Me/Finance/Bills/Harbour Internet.md', 'bill', billText({ amount: '89.00', cycle: 'Monthly', due: '2026-11-05', category: 'Phone and internet', autopay: 'No' })];
const EVERYDAY = ['Me/Finance/Accounts/Everyday.md', 'bank-account', accountText({ institution: 'Harbour Bank', kind: 'Everyday', holder: 'Mia Torres', balance: '500.00' })];
const modelOf = (notes) => F.financeModel(notes.map(([p, t, c]) => noteOf(p, t, c)), NOW);
const AREAS = { '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }) };

/** A made-up vault with a Finance module. */
function moneyVault(files) {
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
  });
  return { rm };
}

// ── The sentence itself ────────────────────────────────────────────────────────────────────────────────────────────

test('tight with a balance known: the sentence, the week, the biggest bill to open', () => {
  const m = modelOf([CARD, HARBOUR, EVERYDAY]);
  const said = F.tightMonthWords(F.financeForecast(m, { days: 30, income: [] }), 'AUD', TODAY);
  assert.deepEqual(said, {
    title: 'The next 30 days look tight',
    detail: '$2,657 going out against $0.00 coming in. That would leave the balance at -$2,157 around Mon 23 Nov.',
    week: '2026-11-23',
    path: 'Me/Finance/Bills/Credit Card.md',
  });
  for (const words of [said.title, said.detail]) {
    assert.doesNotMatch(words, /—/, 'no em dashes in product words');
    assert.doesNotMatch(words, /A\$/, 'the currency sign reads $ for Australians');
  }
});

test('tight with pay only, calm either way, and silent with nothing to measure against', () => {
  // Pay known, more going out than coming in: tight, with no balance to name.
  const m = modelOf([CARD, HARBOUR]);
  const said = F.tightMonthWords(F.financeForecast(m, { days: 30, income: [{ name: 'Pay', amount: 1000, cycle: 'Monthly', next: '2026-11-15' }] }), 'AUD', TODAY);
  assert.deepEqual(said, {
    title: 'The next 30 days look tight',
    detail: '$2,657 going out against $1,000 coming in over the next 30 days.',
    week: '2026-11-02',
    path: 'Me/Finance/Bills/Credit Card.md',
  });
  // Calm: pay covers it, or the balance never goes under.
  const covered = F.financeForecast(m, { days: 30, income: [{ name: 'Pay', amount: 3000, cycle: 'Monthly', next: '2026-11-15' }] });
  assert.equal(F.tightMonthWords(covered, 'AUD', TODAY), null, 'pay covers the bills: silent');
  const rich = modelOf([CARD, HARBOUR, ['Me/Finance/Accounts/Everyday.md', 'bank-account', accountText({ institution: 'Harbour Bank', kind: 'Everyday', holder: 'Mia Torres', balance: '5000.00' })]]);
  assert.equal(F.tightMonthWords(F.financeForecast(rich, { days: 30, income: [] }), 'AUD', TODAY), null, 'the balance never goes under: silent');
  // Nothing to measure against: no balance, no pay. However large the bills, no warning is given.
  assert.equal(F.tightMonthWords(F.financeForecast(m, { days: 30, income: [] }), 'AUD', TODAY), null);
  // No bills going out: nothing to warn about.
  assert.equal(F.tightMonthWords(F.financeForecast(modelOf([EVERYDAY]), { days: 30, income: [] }), 'AUD', TODAY), null);
});

// ── The brief carries it ─────────────────────────────────────────────────────────────────────────────────────────────

const briefInput = (money) => ({ now: NOW.getTime(), calendar: null, meetingNotes: {}, due: null, projects: null, decks: [], found: [], foundState: 'none', prefs: B.NO_PREFS, money });

test('the brief carries the tight sentence below the dues, with its actions', async () => {
  const { rm } = moneyVault({ ...AREAS, [CARD[0]]: CARD[2], [HARBOUR[0]]: HARBOUR[2], [EVERYDAY[0]]: EVERYDAY[2] });
  const money = await rm.briefMoney();
  assert.equal(money.tight.title, 'The next 30 days look tight', 'the brief data carries the sentence');
  const b = B.buildBrief(briefInput(money));
  const titles = b.items.map((i) => i.title);
  assert.deepEqual(titles, ['Credit Card is overdue', 'Harbour Internet is due in 3 days', 'The next 30 days look tight'], 'below the dues, the only other money line');
  const tight = b.items.find((i) => i.kind === 'tight');
  assert.equal(tight.tone, 'warn');
  assert.equal(tight.detail, money.tight.detail);
  assert.deepEqual(tight.actions[0], { kind: 'open', label: 'Open', path: 'Me/Finance/Bills/Credit Card.md' });
  assert.match(tight.actions[1].words, /What can I move\?/);
  assert.equal(B.kindWords('tight'), 'Money');
  // Not useful quiets the sentence and ranks the kind lower after.
  const hidden = B.markNotUseful(B.NO_PREFS, { ...tight, from: B.fromOf(tight) }, NOW.getTime());
  const again = B.buildBrief(briefInput({ ...money, bills: [] }));
  const requiet = B.buildBrief({ ...briefInput(money), prefs: hidden });
  assert.ok(requiet.items.every((i) => i.id !== tight.id), 'hidden');
  assert.ok(B.setAside(hidden, 'tight|notes', NOW.getTime()) > 0, 'the kind set aside');
  assert.ok(again.items.some((i) => i.kind === 'tight'), 'the sentence stands without the dues');
});

test('a calm brief carries no tight line', async () => {
  const { rm } = moneyVault({ ...AREAS, [HARBOUR[0]]: HARBOUR[2], [EVERYDAY[0]]: accountText({ institution: 'Harbour Bank', kind: 'Everyday', holder: 'Mia Torres', balance: '5000.00' }) });
  const money = await rm.briefMoney();
  assert.equal(money.tight, null);
  assert.ok(B.buildBrief(briefInput(money)).items.every((i) => i.kind !== 'tight'));
});

// ── The bell says it in the same words, once ─────────────────────────────────────────────────────────────────────────

test('the bell says the tight sentence in the same words, said once', async () => {
  const { rm } = moneyVault({ ...AREAS, [CARD[0]]: CARD[2], [HARBOUR[0]]: HARBOUR[2], [EVERYDAY[0]]: EVERYDAY[2] });
  const posted = [];
  rm['d'].post = (items) => {
    const fresh = items.filter((i) => !posted.some((p) => p.key === i.key));
    posted.push(...fresh);
    return fresh.length;
  };
  await rm.check();
  const money = await rm.briefMoney();
  const line = B.buildBrief(briefInput(money)).items.find((i) => i.kind === 'tight');
  const notice = posted.find((p) => p.title === 'The next 30 days look tight');
  assert.ok(notice, 'the bell says it too');
  assert.equal(notice.body, line.detail, 'identical detail');
  assert.equal(notice.path, 'Me/Finance/Bills/Credit Card.md', 'opens the biggest bill');
  assert.match(notice.key, /^tight:2026-11-23$/, 'said once per tight week');
  assert.equal(await rm.check(), 0, 'the second check posts nothing new');
});
