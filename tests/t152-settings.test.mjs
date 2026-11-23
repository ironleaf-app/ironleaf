// node --test tests/t152-settings.test.mjs — t152 (9 Nov 2026): every control
// in Settings does what it says, on the 3,000-note vault: the page once,
// then every section's own rows one by one (the list-level pass never
// reaches them: the section buttons sort first and turn fresh on every
// switch). Real renderer, real input; each control is judged by what a
// person would see plus what landed in the files. T152_OUT=path writes the
// rows table.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { assertArea, bootT152, clickWords, H1, makeRows, openSidebar, record, sleep, sweepPage, waitFor } from './t152-lib.mjs';

let H = null;
const rows = makeRows();
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SETTINGS_STAY = `!!document.querySelector('.settings-page')`;
// The sections as Settings lists them (components/Settings.tsx SECTIONS, 23 Nov 2026): Calendar left with the
// calendar sync on 20 Nov, Models reads AI, and Account and plan, Teams and About and updates joined.
const SECTIONS = ['General', 'Look', 'Home cards', 'Account and plan', 'Teams', 'Packs', 'Capture', 'Backups and sync', 'Keyboard shortcuts', 'AI', 'Privacy and secrets', 'Connect an AI', 'Plugins', 'Publish', 'About and updates'];

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
    // Each section stays itself (23 Nov 2026): General's About row opens About and updates inside the same Settings
    // page, and its controls were swept under General's name. Leaving the section now reads as leaving the page.
    // Sign in hands the person to their browser through the account bridge (window.nvAccount), which the harness
    // does not serve, so pressing it here shows nothing; it is named as the hand-off it is, not pressed blind.
    const skip = label === 'Account and plan' ? ['Sign in or create an account'] : [];
    if (skip.length) record(rows, 'settings', label, skip[0], 'button', 'hands to the browser to sign in (no account service in the harness; not proven)', 'external');
    await sweepPage(H, rows, 'settings', label, { open: openSection, stayJS: `${SETTINGS_STAY} && ${H1(label)}`, scope: '.settings-body', skip });
  }
  const mine = assertArea(rows, 'settings');
  console.log(`[t152-settings] ${mine.length} controls pressed, all answered`);
});
