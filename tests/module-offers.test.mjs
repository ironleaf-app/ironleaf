// node --test tests/module-offers.test.mjs — the "turn on" offer on Today (src/shared/module-records.ts moduleOffers,
// views/modules/RecordModulesToday.tsx ModuleOffers): every module in the catalogue (src/shared/life-modules.ts) is
// offered in its own words when the vault shows it would be used, never in another module's (Publications was offered
// with Finance's "where the money goes", and Health and Family were never offered at all). A module added to the
// catalogue later is offered the same way. Made-up notes only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-offers-'));
let R, L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'offers.ts');
  writeFileSync(entry, [`export * as R from ${JSON.stringify(path.join(root, 'src/shared/module-records.ts'))};`, `export * as L from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'offers.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ R, L } = await import(pathToFileURL(path.join(work, 'offers.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const notes = (...titles) => titles.map((title) => ({ title }));
const offerOf = (list, id) => list.find((o) => o.module === id);

test('every module in the catalogue has its own offer: what switching it on does, and how the vault shows it would be used', () => {
  for (const m of L.LIFE_MODULES) {
    assert.ok(m.offer && typeof m.offer.does === 'string' && m.offer.does.length > 20, `${m.name} says what switching it on does (life-modules.ts offer.does)`);
    const rec = R.MODULES.find((r) => r.id === m.id);
    assert.ok(m.offer.signals instanceof RegExp || (rec?.types.length ?? 0) > 0, `${m.name} can be noticed: its own words (offer.signals) or its record types`);
  }
  const does = L.LIFE_MODULES.map((m) => m.offer.does);
  assert.equal(new Set(does).size, does.length, 'no two modules share their words');
});

test('Finance is offered for a vault with bills in it, in its own words', () => {
  const list = R.moduleOffers([], {}, [...notes('Electricity bill March', 'Phone bill', 'Streaming subscription'), { title: '', words: 'Your Harbour Internet bill of $99.00 is due on 26 Nov', inbox: true }]);
  const f = offerOf(list, 'finance');
  assert.ok(f, 'Finance is offered');
  assert.equal(f.why, '3 notes and 1 thing in your Inbox are about bills, subscriptions, accounts, budgets and receipts.');
  assert.equal(f.does, 'Switch it on to see what’s due on Today and where the money goes.');
  assert.equal(list[0].module, 'finance', 'the module the vault talks about most comes first');
});

test('each other module is offered in its own words, never Finance’s', () => {
  const cases = [
    ['publications', notes('Family newsletter: spring edition', 'Crossword for Sunday'), /edition on real pages/],
    ['documents', notes('Passport renewal', 'Driver licence expiry'), /reminded before each one expires/],
    ['meetings', notes('Kick-off meeting with Harbour', 'Board meeting minutes'), /prep pack/],
    ['vendors', notes('Quote from Coastline Electrical', 'Purchase order 1182'), /quote lapses/],
    ['health', notes('Gym session Tuesday', 'Sleep log for the week'), /daily check-in/],
    ['family', notes('School pick-up roster', 'Swimming lessons term 4'), /who’s where/],
  ];
  for (const [id, items, words] of cases) {
    const o = offerOf(R.moduleOffers([], {}, items), id);
    assert.ok(o, `${id} is offered`);
    assert.match(o.does, words, `${id} says what it does`);
    assert.doesNotMatch(o.does, /money/, `${id} is not offered with Finance's words`);
    assert.match(o.why, /^2 notes are about /);
  }
  assert.match(offerOf(R.moduleOffers([], {}, notes('Passport renewal', 'CV v3')), 'documents').why, /insurance and CVs\.$/, 'a module’s own capitals are kept (CVs)');
});

test('9.2 two notes about colleague Bill never offer Money; a bill with an amount still does', () => {
  const aboutBill = [
    { title: 'Demo notes', words: 'Bill said the demo went well and will send the recording' },
    { title: 'Standup', words: 'Bill is on leave until Monday, Priya covers support' },
  ];
  assert.equal(offerOf(R.moduleOffers([], {}, aboutBill), 'finance'), undefined);
  const billed = [
    { title: 'Demo notes', words: 'The power bill came to $212.40 this quarter' },
    { title: 'Standup', words: 'Phone bill $89 due on Friday' },
  ];
  assert.ok(offerOf(R.moduleOffers([], {}, billed), 'finance'), 'an amount beside the cue counts');
  assert.ok(offerOf(R.moduleOffers([], {}, notes('Electricity bill', 'Water bill')), 'finance'), 'a bill in the title still counts');
});

test('a module that is on, put away, or barely mentioned is not offered', () => {
  const items = notes('Electricity bill', 'Water bill');
  assert.ok(offerOf(R.moduleOffers([], {}, items), 'finance'));
  assert.equal(offerOf(R.moduleOffers(['finance'], {}, items), 'finance'), undefined, 'on already');
  assert.equal(offerOf(R.moduleOffers([], { finance: { dismissed: true } }, items), 'finance'), undefined, 'Not now keeps it away');
  assert.equal(offerOf(R.moduleOffers([], {}, notes('Electricity bill')), 'finance'), undefined, 'one passing mention never nags');
  assert.ok(offerOf(R.moduleOffers([], {}, [{ title: 'Harbour Internet', type: 'bill' }, { title: 'Streamly', type: 'bill' }]), 'finance'), 'notes of its own types count');
});

test('a module added to the catalogue later is offered in its own words, and one without words still names itself', () => {
  L.LIFE_MODULES.push(
    { id: 'garden-test', name: 'Garden', icon: 'leaf', words: 'Beds, plantings and harvests.', area: 'home', level: 'open', kept: 'Notes.', parts: [], offer: { about: 'the garden', does: 'Switch it on to see what to plant and water this week.', signals: /\b(seedlings?|compost|raised bed)\b/i } },
    { id: 'quiet-test', name: 'Quiet', icon: 'leaf', words: 'Nothing.', area: 'home', level: 'open', kept: 'Notes.', parts: [], offer: { does: '', signals: /\bquietude\b/i } },
  );
  try {
    const g = offerOf(R.moduleOffers([], {}, notes('Seedlings for spring', 'Compost bin')), 'garden-test');
    assert.deepEqual([g.why, g.does], ['2 notes are about the garden.', 'Switch it on to see what to plant and water this week.']);
    L.LIFE_MODULES[L.LIFE_MODULES.length - 1].offer = { signals: /\bquietude\b/i };
    const q = offerOf(R.moduleOffers([], {}, notes('On quietude', 'More quietude')), 'quiet-test');
    assert.equal(q.does, 'Switch it on to keep these in Quiet, with what’s coming up on Today.');
    assert.equal(q.why, '2 notes are about quiet.');
  } finally {
    L.LIFE_MODULES.splice(-2, 2);
  }
});
