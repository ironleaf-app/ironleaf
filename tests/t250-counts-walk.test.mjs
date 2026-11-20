// node --test tests/t250-counts-walk.test.mjs — break the counts (t250, 12 Nov 2026: "make a
// count disagree with its rows"). On the made-up t200 vault, after each of add, tick, untick, delete
// and rename of steps, note lines, project due dates and meetings, every shown number must equal its
// rows: the greeting, the badge, Late, the Tasks head and chips, Projects home, the project standing
// line, Notes and files, and each meeting card's "N open · N done". One rule, every surface.
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { writeT200Vault } from './t200-vault.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const FLAG = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
const STEP = 'Count the till float twice before the Friday handover';
// Late on any run after 10 Nov 2026, never stale (12 Nov is 2 days past it).
const LATE = '2026-11-10';
// Today, whatever day the suite runs (t250 wrote 2026-11-12, its own run-day; the meeting must be
// today's for Today to gain it).
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MEETING = `Meetings/${todayIso()} T250 late check.md`;

let H = null;
let flagOrig = '';
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    writeT200Vault(H.vaultDir);
    flagOrig = readFileSync(V(FLAG), 'utf8');
    await reload();
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});
const V = (rel) => path.join(H.vaultDir, ...rel.split('/'));
async function reload() {
  await H.services.rescanAll();
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
  await sleep(2500);
}
const editFlag = (fn) => writeFileSync(V(FLAG), fn(readFileSync(V(FLAG), 'utf8')));
const num = (t, re) => {
  const m = re.exec(t ?? '');
  return m ? Number(m[1]) : 0;
};
// Rows past the fold skip rendering until scrolled to: read each as a person would, scrolled in.
async function scrolledCount(h, selector) {
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll(${JSON.stringify(selector)})) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
  await sleep(300);
  return h.browser.ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

async function readToday(h) {
  await openRoom(h, 'Today');
  assert.ok(await waitFor(h, `!!document.querySelector('.td-sentence')`, 15000), 'the greeting shows');
  await sleep(800);
  const greeting = await h.browser.ev(`document.querySelector('.td-sentence')?.innerText ?? ''`);
  const badgeText = await h.browser.ev(`[...document.querySelectorAll('.srow')].find((r) => (r.innerText||'').includes('Today'))?.innerText.replace(/\\s+/g,' ') ?? ''`);
  await clickWords(h, 'Show all', '[data-section="late"]');
  await sleep(500);
  const head = await h.browser.ev(`document.querySelector('[data-section="late"] h2')?.innerText.replace(/\\s+/g,' ') ?? ''`);
  const rows = await scrolledCount(h, '[data-section="late"] .td-row-what .td-text');
  // The day's own agenda (the prep widget below shares the section tag with its own count, so an
  // unscoped read mixes the two on a day with no meetings).
  const mHead = await h.browser.ev(`document.querySelector('[data-section="meetings"].th-meetings .td-count')?.innerText ?? ''`);
  await clickWords(h, 'Show all', '[data-section="meetings"]');
  await sleep(300);
  const mRows = await scrolledCount(h, '[data-section="meetings"] button.th-meeting');
  return {
    greeting,
    gLate: num(greeting, /(\d+) late/),
    gToday: num(greeting, /(\d+) due today/),
    gMeetings: num(greeting, /(\d+) meetings?/),
    badge: num(badgeText, /Today (\d+)/),
    head: num(head, /Late (\d+)/),
    rows,
    mHead: mHead ? Number(mHead) : 0,
    mRows,
  };
}

async function readTasks(h) {
  await openRoom(h, 'Tasks');
  assert.ok(await waitFor(h, `!!document.querySelector('.w2a-head')`, 15000), 'the Tasks head shows');
  await sleep(800);
  const head = await h.browser.ev(`document.querySelector('.w2a-head')?.innerText.replace(/\\s+/g,' ') ?? ''`);
  const rows = await scrolledCount(h, '.tk-row');
  const chip = async (label) => h.browser.ev(`[...document.querySelectorAll('.chips .chip')].find((c) => (c.innerText||'').startsWith(${JSON.stringify(label)}))?.innerText.replace(/\\s+/g,' ') ?? ''`);
  const lateChip = num(await chip('Late'), /Late (\d+)/);
  const weekChip = num(await chip('This week'), /This week (\d+)/);
  const doneChip = num(await chip('Done'), /Done (\d+)/);
  let lateRows = 0;
  let weekRows = 0;
  let doneRows = -1;
  assert.equal(await clickWords(h, 'Late', '.chips'), 'CLICKED', 'the Late chip answers');
  await sleep(800);
  lateRows = await scrolledCount(h, '.tk-row');
  assert.equal(await clickWords(h, 'Late', '.chips'), 'CLICKED', 'the Late chip toggles back');
  await sleep(800);
  assert.equal(await clickWords(h, 'This week', '.chips'), 'CLICKED', 'the This week chip answers');
  await sleep(800);
  weekRows = await scrolledCount(h, '.tk-row');
  assert.equal(await clickWords(h, 'This week', '.chips'), 'CLICKED', 'the This week chip toggles back');
  await sleep(800);
  if (doneChip > 0) {
    assert.equal(await clickWords(h, 'Done', '.chips'), 'CLICKED', 'the Done chip answers');
    await sleep(800);
    doneRows = await scrolledCount(h, '.tk-row');
    assert.equal(await clickWords(h, 'Done', '.chips'), 'CLICKED', 'the Done chip toggles back');
    await sleep(800);
  }
  return { headOpen: num(head, /(\d+) open/), headLate: num(head, /(\d+) late/), rows, lateChip, lateRows, weekChip, weekRows, doneChip, doneRows };
}

async function readHome(h) {
  await openRoom(h, 'Projects');
  assert.ok(await waitFor(h, `!!document.querySelector('.trow.w2a-rowbtn')`, 15000), 'Projects home shows');
  await sleep(600);
  const row = await h.browser.ev(`[...document.querySelectorAll('.trow.w2a-rowbtn')].find((r) => (r.innerText||'').includes('Harbourline Cart Fix'))?.innerText.replace(/\\s+/g,' ') ?? ''`);
  return { text: row, n: num(row, /(\d+) tasks?/) };
}

async function readProject(h) {
  await openRoom(h, 'Projects');
  await sleep(600);
  assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the flagship opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the project page shows');
  await sleep(1200);
  const standing = await h.browser.ev(`document.querySelector('.w2a-standing p')?.innerText.replace(/\\s+/g,' ') ?? ''`);
  // t255: the sticky line became the tab bar, so the Notes tab badge counts the same All list.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(900);
  const sticky = await h.browser.ev(`document.querySelector('[data-tab="notes"] .pt-count')?.innerText ?? ''`);
  await sleep(600);
  const chips = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] .chip')].map((e) => e.innerText.replace(/\\s+/g,' ')).join(' | ')`);
  await clickWords(h, 'Show all', '[data-item-card="files"]');
  await sleep(500);
  const allRows = await scrolledCount(h, '[data-item-card="files"] .trow.compact');
  const cards = await h.browser.ev(`[...document.querySelectorAll('[data-meeting]')].map((c) => {
    c.scrollIntoView({ block: 'center' });
    return { path: c.getAttribute('data-meeting') ?? '', meta: c.querySelector(':scope > .trow.compact .meta')?.innerText.replace(/\\s+/g, ' ') ?? '', rows: c.querySelectorAll(':scope [data-action]').length, done: c.querySelectorAll(':scope [data-action] button.check.done').length };
  })`);
  await sleep(400);
  return {
    yours: num(standing, /(\d+) of yours open/),
    others: num(standing, /(\d+) with others/),
    sticky: num(sticky, /(\d+)/),
    allChip: num(chips, /All (\d+)/),
    allRows,
    cards: cards.map((c) => ({ path: c.path, open: c.meta.includes('nothing open') ? 0 : num(c.meta, /(\d+) open/), done: num(c.meta, /(\d+) done/), rows: c.rows, doneRows: c.done, meta: c.meta })),
  };
}

// Every shown number equals its rows, on every surface.
async function assertAll(label) {
  const h = await harness();
  const t = await readToday(h);
  assert.equal(t.head, t.rows, `${label}: Late head ${t.head} draws ${t.rows} rows`);
  assert.equal(t.gLate, t.rows, `${label}: the greeting counts ${t.gLate} late for ${t.rows} rows (saw "${t.greeting}")`);
  assert.equal(t.badge, t.gLate + t.gToday, `${label}: the badge ${t.badge} is late ${t.gLate} plus today ${t.gToday}`);
  assert.equal(t.mHead, t.mRows, `${label}: the meetings head ${t.mHead} draws ${t.mRows} rows`);
  assert.equal(t.gMeetings, t.mRows, `${label}: the greeting counts ${t.gMeetings} meetings for ${t.mRows} rows`);
  const k = await readTasks(h);
  assert.equal(k.headOpen, k.rows, `${label}: the Tasks head counts ${k.headOpen} open for ${k.rows} rows`);
  assert.equal(k.headLate, k.lateRows, `${label}: the Tasks head counts ${k.headLate} late for ${k.lateRows} rows`);
  assert.equal(k.lateChip, k.lateRows, `${label}: the Late chip ${k.lateChip} draws ${k.lateRows} rows`);
  assert.equal(k.weekChip, k.weekRows, `${label}: the This week chip ${k.weekChip} draws ${k.weekRows} rows`);
  if (k.doneRows >= 0) assert.equal(k.doneChip, k.doneRows, `${label}: the Done chip ${k.doneChip} draws ${k.doneRows} rows`);
  const home = await readHome(h);
  const p = await readProject(h);
  assert.equal(home.n, p.yours + p.others, `${label}: home counts ${home.n} for ${p.yours} of yours plus ${p.others} with others (saw "${home.text}")`);
  assert.equal(p.sticky, p.allChip, `${label}: the Notes tab badge ${p.sticky} is the All chip ${p.allChip}`);
  assert.equal(p.allChip, p.allRows, `${label}: All counts ${p.allChip} for ${p.allRows} rows`);
  for (const c of p.cards) {
    assert.equal(c.open, c.rows - c.doneRows, `${label}: a card counts ${c.open} open for its rows (saw "${c.meta}")`);
    assert.equal(c.done, c.doneRows, `${label}: a card counts ${c.done} done for its rows (saw "${c.meta}")`);
  }
  return { t, k, home, p };
}

test('baseline: every shown number equals its rows', { timeout: 300000 }, async () => {
  await harness();
  const s = await assertAll('baseline');
  assert.ok(s.t.rows > 0 && s.k.rows > 0 && s.home.n > 0 && s.p.cards.length > 0, 'the vault has rows to count');
});

test('add a late step: every surface moves together', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before add');
  editFlag((t) => t.replace('\n## Workstreams', `\n- [ ] ${STEP} — Priya Nair — due ${LATE}\n\n## Workstreams`));
  await reload();
  const after = await assertAll('after add');
  assert.equal(after.t.rows, before.t.rows + 1, 'Late gains the step');
  assert.equal(after.k.rows, before.k.rows + 1, 'Tasks gains the step');
  assert.equal(after.home.n, before.home.n + 1, 'home gains the step');
  assert.equal(after.p.yours, before.p.yours + 1, 'the standing line gains it as yours');
});

test('tick it: every surface moves back', { timeout: 300000 }, async () => {
  const h = await harness();
  const before = await assertAll('before tick');
  editFlag((t) => t.replace(`- [ ] ${STEP}`, `- [x] ${STEP}`));
  await reload();
  const after = await assertAll('after tick');
  assert.equal(after.t.rows, before.t.rows - 1, 'Late loses the step');
  assert.equal(after.k.rows, before.k.rows - 1, 'Tasks loses the step');
  assert.equal(after.home.n, before.home.n - 1, 'home loses the step');
  void h;
});

test('untick it: every surface moves again', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before untick');
  editFlag((t) => t.replace(`- [x] ${STEP}`, `- [ ] ${STEP}`));
  await reload();
  const after = await assertAll('after untick');
  assert.equal(after.t.rows, before.t.rows + 1, 'Late regains the step');
  assert.equal(after.home.n, before.home.n + 1, 'home regains the step');
});

test('delete it: back to baseline', { timeout: 300000 }, async () => {
  await harness();
  editFlag((t) => t.replace(`- [ ] ${STEP} — Priya Nair — due ${LATE}\n`, ''));
  await reload();
  const s = await assertAll('after delete');
  assert.ok(!readFileSync(V(FLAG), 'utf8').includes(STEP), 'the step is gone from the file');
  void s;
});

test('rename a step: nothing moves', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before rename');
  editFlag((t) => t.replace('Chase the 2 carts that failed on Friday (PAY-101, PAY-102)', 'Chase the 2 carts that failed on Friday morning (PAY-101, PAY-102)'));
  await reload();
  const after = await assertAll('after rename');
  assert.equal(after.t.rows, before.t.rows, 'Late keeps its rows');
  assert.equal(after.k.rows, before.k.rows, 'Tasks keeps its rows');
  assert.equal(after.home.n, before.home.n, 'home keeps its count');
  writeFileSync(V(FLAG), flagOrig);
  await reload();
  await assertAll('after rename restored');
});

test('project due dates move the day, never the rows', { timeout: 300000 }, async () => {
  await harness();
  editFlag((t) => t.replace('due: 2026-11-20', 'due: 2026-11-01'));
  await reload();
  const past = await assertAll('due in the past');
  assert.ok(past.t.rows >= 1, 'the late project due lists');
  editFlag((t) => t.replace('due: 2026-11-01', 'due: 2027-06-01'));
  await reload();
  const future = await assertAll('due far ahead');
  assert.ok(future.t.rows <= past.t.rows, 'the project due leaves Late');
  writeFileSync(V(FLAG), flagOrig);
  await reload();
  await assertAll('due restored');
});

test('meetings move their card and the lists', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before meeting');
  const cardsBefore = before.p.cards.length;
  writeFileSync(
    V(MEETING),
    `---\ntype: meeting\ndate: ${MEETING.slice(9, 19)}\nattendees: [Alex Chen, Sam Ortega]\nproject: ${FLAG}\n---\n# ${MEETING.slice(9, 19)} T250 late check\n\n## Actions\n\n- [ ] Count the till float twice — Sam Ortega — due ${LATE}\n- [x] Book the room for next Tuesday — Alex Chen\n`,
  );
  await reload();
  const after = await assertAll('after meeting');
  assert.equal(after.p.cards.length, cardsBefore + 1, 'the meeting gains a card');
  const card = after.p.cards.find((c) => c.path === MEETING);
  assert.ok(card, 'the new meeting has its card');
  assert.equal(card.open, 1, 'the card counts its open action');
  assert.equal(card.done, 1, 'the card counts its done action');
  assert.equal(after.t.mRows, before.t.mRows + 1, 'Today gains the meeting');
  rmSync(V(MEETING));
  await reload();
  await assertAll('meeting gone');
});

test('note lines move the day and Tasks', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before note line');
  writeFileSync(V('Tasks.md'), `- [ ] File the BAS for October before the visit — due ${LATE}\n`);
  await reload();
  const added = await assertAll('line added');
  assert.equal(added.t.rows, before.t.rows + 1, 'Late gains the line');
  assert.equal(added.k.rows, before.k.rows + 1, 'Tasks gains the line');
  writeFileSync(V('Tasks.md'), `- [x] File the BAS for October before the visit — due ${LATE}\n`);
  await reload();
  const ticked = await assertAll('line ticked');
  assert.equal(ticked.t.rows, before.t.rows, 'Late loses the line');
  rmSync(V('Tasks.md'));
  await reload();
  await assertAll('line gone');
});

test('renaming a meeting file moves nothing', { timeout: 300000 }, async () => {
  await harness();
  const before = await assertAll('before meeting rename');
  const from = 'Meetings/2026-11-10 Tuesday standup on the retry fix before the Friday release.md';
  const to = 'Meetings/2026-11-10 Tuesday standup on the retry fix before the Friday release renamed.md';
  renameSync(V(from), V(to));
  await reload();
  const after = await assertAll('after meeting rename');
  assert.equal(after.t.rows, before.t.rows, 'Late keeps its rows');
  assert.equal(after.k.rows, before.k.rows, 'Tasks keeps its rows');
  assert.equal(after.home.n, before.home.n, 'home keeps its count');
  assert.equal(after.p.cards.length, before.p.cards.length, 'the cards keep their count');
  renameSync(V(to), V(from));
  await reload();
  await assertAll('rename restored');
});
