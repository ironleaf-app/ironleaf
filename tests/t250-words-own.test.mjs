// node --test tests/t250-words-own.test.mjs — words wrap and names hide theirs (t250, 12 Nov 2026).
// At 1219x709, 1920x1117 and 3456x1408: longest titles, a 45-letter word, emoji, and an
// Inbox File button naming a 120-letter project — nothing cut, nothing overlapping, no row
// taller than it needs. Your own name (project owners deciding, whoIsMe): set, unset and
// first-name-only — your own rows never show you, others' always show them.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const shotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shots');
let LONG = 'Harbourline Cart Fix for the November Late Opening Season';
while (LONG.length + ' and More'.length <= 120) LONG += ' and More';
while (LONG.length < 120) LONG += 'x';
LONG = LONG.slice(0, 120);
assert.equal(LONG.length, 120);
const LONGPATH = `Projects/${LONG}/${LONG}.md`;
const FLAG = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
const WORD45 = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const LONGTITLE = 'Confirm the December roster with the caterer and the weekend crew before the Friday sign-off deadline passes us by';

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    writeFixtures(H, 'Priya Nair');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return H;
}
function writeFixtures(h, owner) {
  const w = (rel, text) => {
    const p = path.join(h.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  w('People/Priya Nair.md', `---\ntype: person\n---\n# Priya Nair\n\nDesigner.\n`);
  w('People/Alex Chen.md', `---\ntype: person\n---\n# Alex Chen\n\nDeveloper.\n`);
  w('People/Sam Okafor.md', `---\ntype: person\n---\n# Sam Okafor\n\nWeekends.\n`);
  w(FLAG, `---\ntype: project\nstatus: active\nowner: ${owner}\n---\n# Harbourline Cart Fix\n\n## What's next\n\n- [ ] ${LONGTITLE} — Priya Nair — due 2026-11-06\n- [ ] File the ${WORD45} report — Alex Chen — due 2026-11-07\n- [ ] 🎉 Plan the launch party 🎉 for the refit — Priya Nair — due 2026-11-08\n- [ ] Set up the new oven — Priya Nair and Alex Chen — due 2026-11-09\n\n## Notes\n\nKept.\n`);
  w('Projects/Museum Late Shift/Museum Late Shift.md', `---\ntype: project\nstatus: active\nowner: ${owner}\n---\n# Museum Late Shift\n\n## What's next\n\n- [ ] Publish the November roster — Priya Nair — due 2026-10-28\n`);
  w('Projects/Night Market/Night Market.md', `---\ntype: project\nstatus: active\nowner: ${owner}\n---\n# Night Market\n\n## What's next\n\n- [ ] Book the night stalls — Alex Chen — due 2026-11-15\n`);
  w(LONGPATH, `---\ntype: project\nstatus: active\nowner: ${owner}\n---\n# ${LONG}\n\n## What's next\n\n- [ ] Open the long project — Alex Chen\n`);
  w('Inbox/Awning follow-up.md', `---\ntype: note\n---\n# Awning follow-up\n\nAsk about [[${LONG}]] before Friday.\n`);
}
after(async () => { await H?.close().catch(() => {}); H = null; });
async function reload(h) {
  await h.services.rescanAll();
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 45000), 'the app reboots');
  await sleep(2500);
}
async function shot(h, name, W, Hg) {
  const s = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  assert.ok(s.result?.data, `pixels for ${name}`);
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(path.join(shotsDir, `t250-${name}-${W}x${Hg}.png`), Buffer.from(s.result.data, 'base64'));
}
// No row's words spill past its box, and no dots cut them.
async function assertWhole(h, scope, label) {
  const bad = await h.browser.ev(`[...document.querySelectorAll(${JSON.stringify(scope)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && (e.scrollWidth > e.clientWidth + 2 || (e.innerText || '').includes('…')); }).map((e) => (e.innerText || '').slice(0, 60))`);
  assert.deepEqual(bad, [], `${label}: every row reads whole`);
}

test('words read whole at 1219x709, 1920x1117 and 3456x1408', { timeout: 300000 }, async () => {
  const h = await harness();
  for (const [W, Hg] of [[1219, 709], [1920, 1117], [3456, 1408]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
    await sleep(600);
    await openRoom(h, 'Tasks');
    await sleep(1200);
    assert.equal(await clickWords(h, 'Everyone', '.chips'), 'CLICKED', 'Everyone shows');
    await sleep(800);
    await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.tk-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
    await sleep(400);
    const titles = await h.browser.ev(`[...document.querySelectorAll('.tk-row .tkrow-title')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 60)).join(' || ')`);
    assert.ok(titles.includes(WORD45.slice(0, 20)), `the long word lists (${titles.slice(0, 160)})`);
    assert.ok(titles.includes('🎉'), 'emoji lists');
    await assertWhole(h, '.tk-row .tkrow-title', `Tasks ${W}x${Hg}`);
    await shot(h, 'words-tasks', W, Hg);
    await openRoom(h, 'Inbox');
    await sleep(1200);
    await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.card')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 80)); } })()`);
    await sleep(400);
    const filein = await h.browser.ev(`[...document.querySelectorAll('.w2a-ib-filein')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 140)).join(' || ')`);
    assert.ok(filein.includes(LONG.slice(0, 30)), `the File button names the long project (${filein.slice(0, 160)})`);
    await assertWhole(h, '.w2a-ib-filein .chip', `Inbox file ${W}x${Hg}`);
    await assertWhole(h, '.w2a-ib-leadwords', `Inbox lead ${W}x${Hg}`);
    await shot(h, 'words-inbox', W, Hg);
    await openRoom(h, 'Projects');
    await sleep(1200);
    await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.trow.w2a-rowbtn')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
    await sleep(400);
    await assertWhole(h, '.trow.w2a-rowbtn .t', `Projects ${W}x${Hg}`);
    await shot(h, 'words-projects', W, Hg);
  }
});

async function tasksWho(h) {
  await openRoom(h, 'Tasks');
  await sleep(1200);
  await clickWords(h, 'Everyone', '.chips');
  await sleep(800);
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('.tk-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 60)); } })()`);
  await sleep(400);
  return h.browser.ev(`[...document.querySelectorAll('.tk-row')].map((r) => ({ title: (r.querySelector('.tkrow-title')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 50), who: (r.querySelector('.tkrow-who')?.innerText || '').replace(/\\s+/g, ' ').trim() }))`);
}

test('your own name off your own rows, others always shown (set)', { timeout: 300000 }, async () => {
  const h = await harness();
  writeFixtures(h, 'Priya Nair');
  await reload(h);
  const rows = await tasksWho(h);
  const priya = rows.filter((r) => r.title.includes('Confirm the December roster'));
  assert.ok(priya.length === 1 && priya[0].who === '', `Priya hides on her own row (${JSON.stringify(priya)})`);
  const alex = rows.filter((r) => r.title.includes(WORD45.slice(0, 20)));
  assert.ok(alex.length === 1 && alex[0].who.includes('Alex'), `Alex shows on Alex’s own (${JSON.stringify(alex)})`);
  const joint = rows.filter((r) => r.title.includes('Set up the new oven'));
  assert.ok(joint.length === 1 && joint[0].who.includes('Alex') && !joint[0].who.includes('Priya'), `the joint row shows only Alex (${JSON.stringify(joint)})`);
});

test('names all show with no clear owner (unset)', { timeout: 300000 }, async () => {
  const h = await harness();
  writeFixtures(h, 'Priya Nair');
  const p = (rel) => path.join(h.vaultDir, ...rel.split('/'));
  writeFileSync(p('Projects/Museum Late Shift/Museum Late Shift.md'), readFileSync(p('Projects/Museum Late Shift/Museum Late Shift.md'), 'utf8').replace('owner: Priya Nair', 'owner: Alex Chen'));
  writeFileSync(p('Projects/Night Market/Night Market.md'), readFileSync(p('Projects/Night Market/Night Market.md'), 'utf8').replace('owner: Priya Nair', 'owner: Sam Okafor'));
  await reload(h);
  const rows = await tasksWho(h);
  const priya = rows.filter((r) => r.title.includes('Confirm the December roster'));
  assert.ok(priya.length === 1 && priya[0].who.includes('Priya'), `Priya shows with no me (${JSON.stringify(priya)})`);
  const alex = rows.filter((r) => r.title.includes(WORD45.slice(0, 20)));
  assert.ok(alex.length === 1 && alex[0].who.includes('Alex'), 'Alex shows too');
});

test('a first name owns its full names (first-only)', { timeout: 300000 }, async () => {
  const h = await harness();
  writeFixtures(h, 'Priya');
  await reload(h);
  const rows = await tasksWho(h);
  const priya = rows.filter((r) => r.title.includes('Confirm the December roster'));
  assert.ok(priya.length === 1 && priya[0].who === '', `Priya Nair hides under "Priya" (${JSON.stringify(priya)})`);
  const alex = rows.filter((r) => r.title.includes(WORD45.slice(0, 20)));
  assert.ok(alex.length === 1 && alex[0].who.includes('Alex'), 'Alex shows');
});
