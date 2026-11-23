// node --test tests/t262-find.test.mjs — the last endless lists gain one Find (t262, 13 Nov 2026). t261
// measured the longest scrolls left: Meetings Past, Every action and Every decision behind chips with no
// Find, and the Inbox. One-list rooms keep their chips and get the shared Find: t255's TabFind lifted into
// ListFind, which tabs keep and every one-list room shares — same place (one row above the list), same
// words ("Find in this list", "N of M", "Clear"), Esc clearing it, the app's / key jumping to it. Shown
// only past one screen, latched; words stand across chips with the count for the open chip; folds holding
// a match open and windows draw whole while finding. Made-up vault only (tests/t262-seed.mjs: 70 meetings,
// a full inbox). Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';
import { seedT262Vault } from './t262-seed.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = (off) => iso(new Date(Date.now() + off * 864e5));

// ── Static: one Find, written once ──────────────────────────────────────────

test('one list Find: tabs and every one-list room walk through ListFind, never a second box', () => {
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.equal(bar.indexOf('export function ListFind'), bar.lastIndexOf('export function ListFind'), 'ListFind is written once');
  assert.ok(bar.includes('export function TabFind'), 'TabFind still stands for the tabs');
  const tab = bar.slice(bar.indexOf('export function TabFind'));
  assert.ok(tab.includes('<ListFind'), 'a tab’s Find is the one Find, holding its own words');
  assert.ok(bar.includes('export function restoreFindFolds'), 'folds a Find opened shut through one helper');
  assert.ok(bar.includes("e.key === 'Escape' && q"), 'Esc clears the words');
  assert.ok(bar.includes('.nv-page-scroll') && bar.includes('setShown(true)'), 'latched past one screen in any room scroller');
  assert.ok(bar.includes('ws-group-fold') && bar.includes('ws-col-fold') && bar.includes('ws-more'), 'record folds and windows open while finding');
  for (const [f, via] of [
    ['src/renderer/src/views/modules/work/MeetingsPage.tsx', "'../../../components/PageTabs'"],
    ['src/renderer/src/views/InboxPage.tsx', "'../components/PageTabs'"],
    ['src/renderer/src/views/TasksView.tsx', "'../components/PageTabs'"],
    ['src/renderer/src/views/NotesPage.tsx', "'../components/PageTabs'"],
  ]) {
    const t = read(f);
    assert.ok(t.includes(`ListFind } from ${via}`) || t.includes(`ListFind, `), `${f} walks through the shared Find`);
    assert.ok(!t.includes('placeholder="Find'), `${f} carries no box of its own`);
  }
  // The room walks through the shared Find; the grid inside areas keeps its toolbar box (its cramped
  // row is no room), but reads the same words.
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes(`ListFind } from '../components/PageTabs'`) || people.includes('ListFind, '), 'PeoplePage.tsx walks through the shared Find (t266: the shared memory joins the import, same module)');
  assert.equal(people.split('placeholder="Find in this list"').length - 1, 1, 'one toolbar box in the grid, in the shared words');
  for (const f of [
    'src/renderer/src/views/modules/work/MeetingsPage.tsx',
    'src/renderer/src/views/InboxPage.tsx',
    'src/renderer/src/views/TasksView.tsx',
    'src/renderer/src/views/NotesPage.tsx',
    'src/renderer/src/views/PeoplePage.tsx',
  ]) {
    assert.ok(read(f).includes("e.key === '/'"), `${f} jumps to the Find on /`);
  }
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meet.includes('setTabSection(ws, tab.id, c, true)'), 'a chip switch stands in history');
  assert.ok(meet.includes('tab.section ?? section'), 'Back restores the chip from history, else the place');
});

test('the open chip is counted, each list its own rows', () => {
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  for (const k of ["kindCount('action'", "kindCount('decision'", "kindCount('question'", "kindCount('meeting'"]) assert.ok(meet.includes(k), `record chips count ${k}`);
  assert.ok(meet.includes('foundUpcoming.length, m: upcoming.length') && meet.includes('foundPast.length, m: past.length'), 'meeting chips count their rows');
  assert.ok(read('src/renderer/src/views/InboxPage.tsx').includes('n: shownItems.length, m: items.length'), 'the inbox counts waiting');
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('entriesFor(data.tasks, { ...filter, text:'), 'tasks counts its chip with the words off');
  assert.ok(read('src/renderer/src/views/NotesPage.tsx').includes("query: '' }).length"), 'notes counts its chip with the words off');
  assert.ok(read('src/renderer/src/views/PeoplePage.tsx').includes("filter, today, '').length"), 'people counts its chip with the words off');
});

// ── Live on the rich vault ─────────────────────────────────────────────────

let H = null;
before(async () => {
  H = await startHarness({});
  await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['meetings', 'finance', 'health', 'goals', 'systems', 'sites', 'house', 'travel'].map((id) => [id, { on: true }])), statusLine: true } }]);
  seedT262Vault(H.vaultDir, D);
  await H.services.rescanAll();
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
  await sleep(2500);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
});
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const chip = () => H.browser.ev(`document.querySelector('main .w2b-chips [aria-selected="true"]')?.innerText`);
const count = () => H.browser.ev(`document.querySelector('main .pt-find-n')?.innerText ?? null`);
const words = () => H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.value ?? null`);
async function pickChip(label) {
  assert.equal(await clickWords(H, label, 'main'), 'CLICKED', `${label} opens`);
  await sleep(1100);
}
async function type(q) {
  await H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.focus()`);
  await H.browser.send('Input.insertText', { text: q });
  await sleep(900);
}
async function slash() {
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  await sleep(400);
}

test('Past earns its Find; a word narrows it with its count', { timeout: 300000 }, async () => {
  await openRoom(H, 'Meetings');
  assert.ok(await waitFor(H, `document.querySelectorAll('main .trow').length > 5`, 15000), 'meetings lands');
  await pickChip('Past');
  assert.equal(await chip(), 'Past', 'Past opens');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'the 61-row list earns a Find');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .trow').length`), 61, '61 past meetings stand');
  await type('marquee');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .trow').length`), 3, 'the Find narrows to its rows');
  assert.equal(await count(), '3 of 61', 'naming what it shows');
});

test('switching chips keeps the words; the count is for the open chip', { timeout: 300000 }, async () => {
  await pickChip('Every action');
  assert.equal(await words(), 'marquee', 'the words stand across chips');
  assert.equal(await count(), '11 of 212', '11 actions match (2 of their own words, 9 through their meeting)');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main tr.ws-tr').length`), 11, 'the table shows every match');
  await pickChip('Every decision');
  assert.equal(await words(), 'marquee', 'the words stand on');
  assert.equal(await count(), '5 of 71', '5 decisions match (2 of their own words, 3 through their meeting)');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .ws-row').length`), 5, 'the list shows every match');
  await pickChip('Upcoming');
  assert.equal(await count(), '0 of 10', 'no coming meeting matches, counted plainly');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .trow').length`), 0, 'nothing standing matches nothing');
  await pickChip('Past');
  assert.equal(await count(), '3 of 61', 'back on Past the count is Past’s again');
});

test('a folded group holding a match opens; Esc shuts it and clears', { timeout: 300000 }, async () => {
  await pickChip('Every action');
  await esc(H);
  await sleep(700);
  assert.equal(await words(), '', 'Esc clears the words');
  assert.equal(await count(), null, 'the count goes with them');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main tr.ws-tr').length`), 120, 'the table stands windowed again');
  // Fold a group with the Find clear, then find through it.
  await H.browser.ev(`document.querySelector('main section[aria-label="Every action"] button.ws-group-fold[aria-expanded="true"]')?.click()`);
  await sleep(700);
  assert.equal(await H.browser.ev(`document.querySelectorAll('main section[aria-label="Every action"] button.ws-group-fold[aria-expanded="false"]').length`), 1, 'one group folds');
  await type('marquee');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main section[aria-label="Every action"] button.ws-group-fold[aria-expanded="false"]').length`), 0, 'the fold holding a match opens');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main tr.ws-tr').length`), 11, 'every match shows');
  await esc(H);
  await sleep(700);
  assert.equal(await H.browser.ev(`document.querySelectorAll('main section[aria-label="Every action"] button.ws-group-fold[aria-expanded="false"]').length`), 1, 'Esc shuts the fold it opened');
  assert.equal(await words(), '', 'and clears the words');
});

test('a broad word draws every windowed row', { timeout: 300000 }, async () => {
  await type('the');
  const n = await H.browser.ev(`(() => { const t = document.querySelector('main .pt-find-n')?.innerText ?? ''; const m = /^(\\d+)(?: of (\\d+))?$/.exec(t); return m ? { n: Number(m[1]), m: m[2] === undefined ? Number(m[1]) : Number(m[2]) } : null; })()`);
  assert.ok(n && n.m === 212 && n.n > 200, `nearly every action matches (${n ? `${n.n} of ${n.m}` : 'no count'})`);
  assert.equal(await H.browser.ev(`document.querySelectorAll('main tr.ws-tr').length`), n.n, 'the table draws every match, past its window');
  assert.ok(await waitFor(H, `document.querySelectorAll('main .rm-views button.ws-more').length === 0`, 8000), 'no Show more stands while finding');
  await esc(H);
  await sleep(700);
});

test('Back restores the chip and its scroll', { timeout: 300000 }, async () => {
  await pickChip('Past');
  // Round 3: the list scrolls in its own pane (the page no longer scrolls as a document).
  const SCROLLER = `(document.querySelector('.nv-split.is-panes > .nv-split-main') ?? document.querySelector('.nv-page-scroll'))`;
  await H.browser.ev(`${SCROLLER}.scrollTo({ top: 600 })`);
  await sleep(500);
  await pickChip('Every action');
  assert.equal(await chip(), 'Every action', 'the chip switches');
  await H.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  await sleep(1200);
  assert.equal(await chip(), 'Past', 'Back returns to Past');
  const top = await H.browser.ev(`${SCROLLER}.scrollTop`);
  assert.ok(Math.abs(top - 600) < 60, `its scroll stands (${Math.round(top)}px on 61 rows)`);
});

test('/ jumps to the Find', { timeout: 300000 }, async () => {
  await H.browser.ev(`document.querySelector('main .w2b-chips [aria-selected="true"]')?.focus()`);
  await slash();
  assert.equal(await H.browser.ev(`document.activeElement?.getAttribute('aria-label')`), 'Find in this list', '/ jumps to the box');
});

test('the Inbox earns its Find; filter, count, Esc', { timeout: 300000 }, async () => {
  await openRoom(H, 'Inbox');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'the 47-card list earns a Find');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main [aria-label="Waiting to be filed"] > div').length`), 47, '47 wait');
  await type('harbour');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main [aria-label="Waiting to be filed"] > div').length`), 4, 'the Find narrows to its cards');
  assert.equal(await count(), '4 of 47', 'naming what it shows');
  await esc(H);
  await sleep(700);
  assert.equal(await words(), '', 'Esc clears the words');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main [aria-label="Waiting to be filed"] > div').length`), 47, 'every card stands again');
  await H.browser.ev(`document.querySelector('main .list-tools-end')?.focus()`);
  await slash();
  assert.equal(await H.browser.ev(`document.activeElement?.getAttribute('aria-label')`), 'Find in this list', '/ jumps to the box');
});

test('Tasks reads the same Find: place, words, count', { timeout: 300000 }, async () => {
  await openRoom(H, 'Tasks');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'Tasks keeps its Find, in the shared words');
  assert.equal(await H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.closest('.pt-find') ? 'row' : 'in-chips'`), 'row', 'on its own row above the list');
  await H.browser.ev(`[...document.querySelectorAll('main [role="radio"]')].find((e) => (e.innerText || '').trim() === 'Everyone')?.click()`);
  await sleep(800);
  await type('generator');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .tk-row').length`), 2, 'the Find narrows to its rows');
  assert.equal(await count(), '2 of 164', 'naming what it shows');
  await esc(H);
  await sleep(700);
  assert.equal(await count(), null, 'Esc clears the count with the words');
  await clickWords(H, 'Mine', 'main');
  await H.browser.ev(`document.querySelector('main [role="radio"]')?.focus()`);
  await slash();
  assert.equal(await H.browser.ev(`document.activeElement?.getAttribute('aria-label')`), 'Find in this list', '/ jumps to the box');
});

test('Notes reads the same Find: place, words, count', { timeout: 300000 }, async () => {
  await openRoom(H, 'Notes');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'Notes keeps its Find, in the shared words');
  await type('sourdough');
  assert.ok(await waitFor(H, `document.querySelectorAll('main .trow').length === 1`, 8000), 'the Find narrows to its row');
  assert.equal(await count(), '1 of 29', 'naming what it shows');
  await esc(H);
  await sleep(700);
  assert.equal(await words(), '', 'Esc clears the words');
});

test('People reads the same Find: place, words, count', { timeout: 300000 }, async () => {
  await openRoom(H, 'People');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'People keeps its Find, in the shared words');
  assert.equal(await H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.closest('.pt-find') ? 'row' : 'in-chips'`), 'row', 'on its own row above the list');
  assert.equal(await H.browser.ev(`document.querySelector('main input[data-people-search]') ? 'kept' : 'lost'`), 'kept', 'the people hook stands');
  await type('maddox');
  assert.equal(await H.browser.ev(`document.querySelectorAll('main .trow').length`), 1, 'the Find narrows to her row');
  assert.equal(await count(), '1 of 12', 'naming what it shows');
  await esc(H);
  await sleep(700);
  assert.equal(await count(), null, 'Esc clears the count with the words');
  await clickWords(H, 'Organisations', 'main');
  await H.browser.ev(`document.querySelector('main .seg [role="tab"]')?.focus()`);
  await slash();
  assert.equal(await H.browser.ev(`document.activeElement?.getAttribute('aria-label')`), 'Find in this list', '/ jumps to the box');
});
