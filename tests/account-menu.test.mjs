// node --test tests/account-menu.test.mjs — the account chip at the side bar's foot and its menu (20 Nov 2026, the ). The
// foot is one account row (avatar, name, plan; or "Sign in" and why it is optional) with the bell; its menu holds the
// account, Settings and About and updates, which used to be three doors (a Settings row, a version line, a header
// avatar). The words and rows for each state are checked on their own (components/account/accountMenuModel.ts); the keys and
// the outside click are checked on the real renderer in headless Chromium (tests/vault-controls-harness.mjs).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(path.join(tmpdir(), 'nv-acct-menu-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/components/account/accountMenuModel.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ids = (entries) => entries.map((e) => ('id' in e ? e.id : '—'));
const me = (o = {}) => ({ account: { id: 'a1', name: 'Ana Whitlock', email: 'ana@example.com' }, plan: { id: o.plan ?? 'community', name: o.planName ?? 'Community', ...(o.renews ? { renews: o.renews } : {}) }, entitlements: o.ents ?? [], devices: [], teams: o.teams ?? [] });
const signedIn = (o = {}) => ({ status: 'signed-in', persistent: true, profile: { name: o.name ?? 'Ana Whitlock', email: 'ana@example.com' }, me: me(o), licence: null, online: true });
const update = (stage, dismissed = false) => ({ enabled: true, autoDownload: true, current: '2.0.3', available: { version: '2.0.4', date: '', notes: '', canInstall: true, size: 1, dismissed }, checkedAt: null, stage, progress: null, error: null, updated: null, failed: null, installsOnQuit: false });

test('signed out: a neutral avatar, "Sign in" and why it is optional; Sign in…, Settings, About and the version', () => {
  for (const view of [null, { status: 'signed-out', persistent: true, licence: null }]) {
    const chip = M.accountChip(view, null);
    assert.equal(chip.kind, 'out');
    assert.equal(chip.initials, '', 'the neutral avatar');
    assert.equal(chip.name, 'Sign in');
    assert.equal(chip.sub, 'Optional: for Sync and Teams');
    assert.equal(chip.dot, false);
    const rows = M.accountMenuEntries(view, null, '2.0.3');
    assert.deepEqual(ids(rows), ['sign-in', '—', 'settings', 'about']);
    assert.equal(rows[0].label, 'Sign in…');
    assert.equal(rows.find((r) => r.id === 'about').label, 'About and updates · 2.0.3');
    assert.equal(rows.find((r) => r.id === 'settings').hotkey, 'Mod+,', 'Settings shows its shortcut');
    assert.ok(!ids(rows).includes('sign-out') && !ids(rows).includes('billing') && !ids(rows).includes('account'));
  }
});

test('signed in: initials, the name and the plan; name, account, billing only with something to manage, Settings, About, Sign out', () => {
  const free = signedIn();
  const chip = M.accountChip(free, null);
  assert.equal(chip.kind, 'in');
  assert.equal(chip.initials, 'AW');
  assert.equal(chip.name, 'Ana Whitlock');
  assert.equal(chip.email, 'ana@example.com');
  assert.equal(chip.sub, 'Community');
  assert.deepEqual(ids(M.accountMenuEntries(free, null, '2.0.3')), ['account', 'settings', 'about', '—', 'sign-out'], 'no Manage billing before anything is bought');
  const sync = signedIn({ plan: 'personal-sync', planName: 'Sync', ents: ['sync'], renews: Date.now() + 864e5 });
  assert.equal(M.accountChip(sync).sub, 'Sync');
  const rows = M.accountMenuEntries(sync, null, '2.0.3');
  assert.deepEqual(ids(rows), ['account', 'billing', 'settings', 'about', '—', 'sign-out']);
  assert.equal(rows[1].label, 'Manage billing');
  assert.equal(rows[1].external, true, 'billing opens in the browser');
  // An email alone still gives the row words and initials.
  const noName = { ...signedIn(), profile: { name: '', email: 'ana.whitlock@example.com' }, me: { ...me(), account: { id: 'a', name: '', email: 'ana.whitlock@example.com' } } };
  assert.equal(M.accountChip(noName).name, 'ana.whitlock@example.com');
  assert.equal(M.accountChip(noName).initials, 'AW');
});

test('the plan line: Community, Supporter (with the badge), Sync, Teams · its team', () => {
  assert.equal(M.planLine(signedIn()), 'Community');
  const supporter = signedIn({ ents: ['supporter'] });
  assert.equal(M.planLine(supporter), 'Supporter');
  assert.equal(M.accountChip(supporter).supporter, true, 'the heart badge shows');
  assert.equal(M.planLine(signedIn({ ents: ['sync', 'supporter'] })), 'Sync');
  assert.equal(M.accountChip(signedIn({ ents: ['sync', 'supporter'] })).supporter, true);
  assert.equal(M.planLine(signedIn({ planName: 'Teams', ents: ['sync', 'teams'], teams: [{ id: 't1', name: 'Acme', role: 'owner' }] })), 'Teams · Acme');
  assert.equal(M.planLine(signedIn({ ents: ['teams'] })), 'Teams');
  // Offline: the licence in force still names the plan.
  assert.equal(M.planLine({ status: 'signed-in', persistent: true, online: false, licence: { edition: 'supporter', features: ['supporter'], until: 0, words: '', org: '' } }), 'Supporter');
});

test('an update waiting: the dot moves to the avatar and the About row; a put-off update keeps quiet', () => {
  const ready = update('ready');
  assert.equal(M.accountChip(null, ready).dot, true, 'the avatar carries the dot signed out');
  assert.equal(M.accountChip(signedIn(), ready).dot, true, 'and signed in');
  const about = M.accountMenuEntries(signedIn(), ready, '2.0.3').find((r) => r.id === 'about');
  assert.equal(about.dot, true);
  assert.equal(about.hint, 'Restart to update');
  assert.equal(M.accountMenuEntries(null, update('idle'), '2.0.3').find((r) => r.id === 'about').hint, 'Update available');
  assert.equal(M.accountChip(null, update('idle', true)).dot, false, 'Later keeps the avatar quiet');
  assert.equal(M.accountMenuEntries(null, update('idle', true), '').find((r) => r.id === 'about').dot, undefined);
  assert.equal(M.accountMenuEntries(null, update('idle', true), '').find((r) => r.id === 'about').label, 'About and updates · 2.0.3', 'the version from the update state when settings have none yet');
  assert.equal(M.accountChip(null, null).dot, false);
});

test('signing in, turned off, not set up: the row says so and the menu keeps Settings and About', () => {
  const busy = { status: 'signing-in', persistent: true };
  assert.equal(M.accountChip(busy).kind, 'busy');
  assert.deepEqual(ids(M.accountMenuEntries(busy, null, '2.0.3')), ['cancel', 'account', '—', 'settings', 'about']);
  for (const status of ['off', 'unconfigured']) {
    const v = { status, persistent: true };
    assert.equal(M.accountChip(v).kind, 'local');
    assert.deepEqual(ids(M.accountMenuEntries(v, null, '2.0.3')), ['account', 'settings', 'about'], `${status}: no Sign in`);
  }
});

test('the foot is one account row with the bell; no Settings row, version line or header avatar; Ctrl+, and the palette stay', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  const foot = places.split('export function PlacesFoot')[1];
  assert.ok(foot.includes('<AccountChip variant="foot" />') && foot.includes('<NoticeBell />'), 'the chip with the bell beside it');
  assert.ok(!foot.includes('places-settings') && !foot.includes('SidebarVersion') && !foot.includes('SupporterMark'), 'no separate Settings row, version line or badge');
  const rail = places.split('export function Rail()')[1].split('export function PlacesFoot')[0];
  assert.ok(rail.includes('<AccountChip variant="rail" />') && !rail.includes('aria-label="Settings"'), 'the folded rail opens the same menu');
  assert.ok(!existsSync(path.join(root, 'src/renderer/src/components/about/SidebarVersion.tsx')), 'the version line is gone');
  const header = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(!header.includes('HeaderAvatar') && !header.includes('topbar-ava'), 'no avatar in every pane’s header');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("{ id: 'settings', name: 'Open Settings', hotkey: 'Mod+,'"), 'Ctrl+, opens Settings');
  assert.ok(commands.includes("id: 'about-ironleaf'") && commands.includes("id: 'account-sign-in'"), 'About and Sign in stay in the palette');
  const menu = read('src/renderer/src/components/account/AccountMenu.tsx');
  assert.ok(menu.includes('useAccount()') && menu.includes('useUpdateState()'), 'the shared account and update state, no IPC of its own');
  assert.ok(!/window\.nv(Account|Update)\./.test(menu), 'never calls the bridges itself');
});

// ── The real renderer: the keys and the outside click ──
const { SHELL } = await import('./vault-controls-harness.mjs');

test('keys: Enter opens with the first row focused, arrows move, Esc closes back to the chip; an outside click closes', { timeout: 420000, skip: !existsSync(SHELL) && 'no headless Chromium' }, async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const H = await startHarness();
  try {
    const { ev, send } = H.browser;
    // A signed-in account and a ready update through the same bridges the app's preload gives the window.
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const view = { status: 'signed-in', persistent: true, online: true, licence: null, profile: { name: 'Ana Whitlock', email: 'ana@example.com' },
          me: { account: { id: 'a', name: 'Ana Whitlock', email: 'ana@example.com' }, plan: { id: 'personal-sync', name: 'Sync', renews: Date.now() + 864e5 }, entitlements: ['sync', 'supporter'], devices: [], teams: [] } };
        const done = () => Promise.resolve(view);
        window.nvAccount = { view: done, signIn: done, cancel: done, signOut: done, refresh: done, renameDevice: done, removeDevice: done, portal: done, checkout: done, onChange: () => () => {} };
        const st = { enabled: true, autoDownload: true, current: '2.0.3', available: { version: '2.0.4', date: '', notes: '', canInstall: true, size: 1, dismissed: false }, checkedAt: null, stage: 'ready', progress: null, error: null, updated: null, failed: null, installsOnQuit: false };
        window.nvUpdate = { state: () => Promise.resolve(st), onChange: () => () => {} };
      })();`,
    });
    await H.freshView();
    const waitFor = async (expr, ms = 12000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await ev(expr)) return true;
        } catch {}
        await sleep(150);
      }
      return false;
    };
    const key = async (k, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', key: k, code, windowsVirtualKeyCode: vk, text: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(250);
    };
    assert.ok(await waitFor(`document.querySelector('.places-foot .acct-chip')?.textContent.includes('Ana Whitlock')`), 'the foot names the person');
    assert.ok(await ev(`document.querySelector('.places-foot .acct-chip').textContent.includes('Sync')`), 'and their plan');
    assert.ok(await waitFor(`!!document.querySelector('.places-foot .acct-ava-dot')`), 'the update dot sits on the avatar');
    assert.equal(await ev(`document.querySelectorAll('.places-foot .places-settings, .places-foot .places-version, .topbar-ava').length`), 0, 'no Settings row, version line or header avatar');

    await ev(`document.querySelector('.places-foot .acct-chip').focus()`);
    await key('Enter', 'Enter', 13);
    assert.ok(await waitFor(`!!document.querySelector('.acct-menu[role="menu"]')`), 'Enter opens the menu');
    assert.equal(await ev(`document.querySelector('.places-foot .acct-chip').getAttribute('aria-expanded')`), 'true');
    const rows = await ev(`[...document.querySelectorAll('.acct-menu [role="menuitem"]')].map((b) => b.textContent.trim())`);
    assert.deepEqual(rows.map((r) => r.replace(/Restart to update|Ctrl\+,|⌘,/g, '').trim()), ['Account and plan', 'Manage billing', 'Settings', 'About and updates · harness', 'Sign out'], 'the version from the app’s settings (the harness says “harness”)');
    assert.ok(await ev(`document.querySelector('.acct-menu .acct-menu-who').textContent.includes('ana@example.com')`), 'the menu names the account');
    assert.ok(await ev(`!!document.querySelector('.acct-menu [data-id="about"] .acct-menu-dot')`), 'the About row carries the dot');
    const menuBox = await ev(`(() => { const m = document.querySelector('.acct-menu').getBoundingClientRect(); const c = document.querySelector('.places-foot .acct-chip').getBoundingClientRect(); return [m.bottom, c.top]; })()`);
    assert.ok(menuBox[0] <= menuBox[1], 'it opens above the row');
    const focused = () => ev(`document.activeElement?.getAttribute('data-id') ?? document.activeElement?.className ?? ''`);
    assert.equal(await focused(), 'account', 'the first row takes focus');
    await key('ArrowDown', 'ArrowDown', 40);
    assert.equal(await focused(), 'billing');
    await key('ArrowUp', 'ArrowUp', 38);
    await key('ArrowUp', 'ArrowUp', 38);
    assert.equal(await focused(), 'sign-out', 'the arrows wrap');
    await key('Escape', 'Escape', 27);
    assert.ok(await waitFor(`!document.querySelector('.acct-menu')`), 'Esc closes it');
    assert.match(await focused(), /acct-chip/, 'focus returns to the chip');

    await key(' ', 'Space', 32);
    assert.ok(await waitFor(`!!document.querySelector('.acct-menu')`), 'Space opens it too');
    await key('Escape', 'Escape', 27);
    await key('ArrowUp', 'ArrowUp', 38);
    assert.ok(await waitFor(`!!document.querySelector('.acct-menu')`), 'an arrow on the chip opens it');

    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 400, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 400, button: 'left', clickCount: 1 });
    assert.ok(await waitFor(`!document.querySelector('.acct-menu')`), 'an outside click closes it');

    // Settings from the menu opens Settings (the same place as Ctrl+,).
    await ev(`document.querySelector('.places-foot .acct-chip').click()`);
    assert.ok(await waitFor(`!!document.querySelector('.acct-menu [data-id="settings"]')`));
    await ev(`document.querySelector('.acct-menu [data-id="settings"]').click()`);
    assert.ok(await waitFor(`!document.querySelector('.acct-menu') && !!document.querySelector('.settings-nav, .settings-page, [data-settings]')`), 'Settings opens');
  } finally {
    await H.close();
  }
});
