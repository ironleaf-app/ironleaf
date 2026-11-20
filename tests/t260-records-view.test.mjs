// node --test tests/t260-records-view.test.mjs — RecordsView opens (t260, 13 Nov 2026). "All actions
// across projects" said "Something didn't work just then" on every vault, big and small (t258): the live
// harness served none of the views channels, the page stub resolves unhandled channels as undefined, and
// loadRecordsView's list.find threw on it. The harness now serves the real workspaces module; this test
// opens every ready-made records view on a small vault, the t200 vault and an empty vault. It fails
// without the fix (every view reads "Something didn't work just then").
import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { esc, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const BAD = [/isn’t here any more/i, /couldn’t show/i, /Something didn’t work just then/i, /Something went wrong/i, /could not be read/i];

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await bootPage(H);
  }
  return H;
}
async function bootPage(h) {
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
    } catch {}
  }
  await sleep(2500);
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

async function runCommand(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(1000);
  const done = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(name)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `${name} runs`);
  await sleep(500);
}

async function checkView(h, vault, command, title, expectRows) {
  const errorsBefore = await h.browser.ev('window.__nvErrors.length');
  await runCommand(h, command);
  assert.ok(await waitFor(h, `document.title.toLowerCase().includes(${JSON.stringify(title.toLowerCase())})`, 15000), `${vault}: ${command} lands (saw ${await h.browser.ev('document.title')})`);
  await sleep(1000);
  const main = await h.browser.ev(`(document.querySelector('main').innerText || '').slice(0, 2000)`);
  for (const re of BAD) assert.ok(!re.test(main), `${vault} ${command}: no failure words (${re})`);
  assert.ok(main.trim().length > 80, `${vault} ${command}: no blank page`);
  assert.ok(main.toLowerCase().includes(title.toLowerCase()), `${vault} ${command}: reads its own title (${title})`);
  if (expectRows) assert.ok(!/no actions yet|no meetings yet|no people yet|no files yet/i.test(main), `${vault} ${command}: lists its rows`);
  else assert.ok(/no actions yet|no meetings yet|no people yet|no files yet/i.test(main), `${vault} ${command}: the empty state reads`);
  assert.equal(await h.browser.ev('window.__nvErrors.length'), errorsBefore, `${vault} ${command}: no console error`);
  console.log(`records-view ${vault}/${command}: ${title}`);
}

test('records views open on a small vault (t260)', { timeout: 300000 }, async () => {
  const h = await harness();
  await checkView(h, 'small', 'All actions across projects', 'All actions', true);
  await checkView(h, 'small', 'All meetings', 'All meetings', true);
  await checkView(h, 'small', 'People across projects', 'People', true);
  await checkView(h, 'small', 'All files: every file, by what it is for', 'All files', false);
});

test('records views open on an empty vault (t260)', { timeout: 300000 }, async () => {
  const h = await harness();
  for (const e of readdirSync(h.vaultDir)) rmSync(path.join(h.vaultDir, e), { recursive: true, force: true });
  await h.services.rescanAll();
  await bootPage(h);
  await checkView(h, 'empty', 'All actions across projects', 'All actions', false);
  await checkView(h, 'empty', 'All meetings', 'All meetings', false);
  await checkView(h, 'empty', 'People across projects', 'People', false);
});

test('records views open on the t200 vault (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const count = writeT200Vault(h.vaultDir);
  assert.equal(count, 3000, 'the big vault holds 3,000 notes');
  await h.services.rescanAll();
  await bootPage(h);
  await checkView(h, 't200', 'All actions across projects', 'All actions', true);
  await checkView(h, 't200', 'All meetings', 'All meetings', true);
  await checkView(h, 't200', 'People across projects', 'People', true);
});
