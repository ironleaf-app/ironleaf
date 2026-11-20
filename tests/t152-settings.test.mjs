// node --test tests/t152-settings.test.mjs — t152 (9 Nov 2026): every control
// in Settings does what it says, on the 3,000-note vault: the page once,
// then every section's own rows one by one (the list-level pass never
// reaches them: the section buttons sort first and turn fresh on every
// switch). Real renderer, real input; each control is judged by what a
// person would see plus what landed in the files. T152_OUT=path writes the
// rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, H1, makeRows, openSidebar, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SETTINGS_STAY = `!!document.querySelector('.settings-page')`;
const SECTIONS = ['General', 'Look', 'Home cards', 'Calendar', 'Packs', 'Capture', 'Backups and sync', 'Keyboard shortcuts', 'Models', 'Privacy and secrets', 'Connect an AI', 'Plugins', 'Publish'];

test('Settings: every control works, on the big vault', { timeout: 2700000 }, async () => {
  H = await bootT152((m) => console.log(`[t152-settings] ${m}`));
  const open = async () => {
    await openSidebar(H, 'Settings');
    await waitFor(H, `!!document.querySelector('main')`);
    await sleep(800);
  };
  await open();
  assert.ok(await waitFor(H, SETTINGS_STAY), 'Settings lands on the big vault');
  await sweepPage(H, rows, 'settings', 'Settings', { open, stayJS: SETTINGS_STAY, scope: 'main' });
  for (const label of SECTIONS) {
    const openSection = async () => {
      await open();
      await clickWords(H, label, 'main');
      await waitFor(H, H1(label));
      await sleep(800);
    };
    await openSection();
    assert.ok(await waitFor(H, H1(label)), `the ${label} section lands`);
    await sweepPage(H, rows, 'settings', label, { open: openSection, stayJS: SETTINGS_STAY, scope: '.settings-body' });
  }
  const mine = assertArea(rows, 'settings');
  console.log(`[t152-settings] ${mine.length} controls pressed, all answered`);
});
