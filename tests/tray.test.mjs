// node --test tests/tray.test.mjs — the tray icon (20 Nov 2026): Ironleaf stays in the tray so reminders, AI access
// for other apps, sync and backup keep going with the window closed. The rules are plain data (src/shared/tray-model.ts):
// the menu from the state, whether a close hides or really closes for every combination, the "still running" notice
// shown once, what starting at login needs on Windows and Linux, and the picture for a light or dark taskbar. The
// wiring into the app's shared files is checked by its words in the source (one line each, so merges stay small).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-tray-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/tray-model.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const base = { platform: 'win32', mcpOn: true, startAtLogin: false, canCheckUpdates: true, dueToday: 2 };
const labels = (items) => items.map((i) => (i.type === 'separator' ? '---' : i.label));

test('the menu, top to bottom, on Windows', () => {
  assert.deepEqual(labels(T.trayMenu(base)), ['Ironleaf', 'AI access on · 2 due today', '---', 'Open Ironleaf', 'New note', 'Quick capture', 'Today', 'Search', '---', 'AI access (MCP)', '---', 'Start with Windows', 'Check for updates', 'Quit Ironleaf']);
});

test('the name and the state line are titles (greyed), never actions', () => {
  const items = T.trayMenu(base);
  assert.deepEqual(items.slice(0, 2).map((i) => i.type), ['title', 'title']);
  assert.ok(items.slice(0, 2).every((i) => !('id' in i)));
});

test('elsewhere the login item reads Start at login', () => {
  const items = T.trayMenu({ ...base, platform: 'linux' });
  assert.ok(labels(items).includes('Start at login'));
  assert.ok(!labels(items).includes('Start with Windows'));
});

test('the checkboxes show how things stand', () => {
  const find = (items, id) => items.find((i) => i.id === id);
  const on = T.trayMenu({ ...base, mcpOn: true, startAtLogin: true });
  assert.deepEqual([find(on, 'toggle-mcp').type, find(on, 'toggle-mcp').checked, find(on, 'toggle-login').checked], ['checkbox', true, true]);
  const off = T.trayMenu({ ...base, mcpOn: false, startAtLogin: false });
  assert.deepEqual([find(off, 'toggle-mcp').checked, find(off, 'toggle-login').checked], [false, false]);
});

test('AI access is left out when it cannot be read, and Check for updates when there is no check', () => {
  const items = T.trayMenu({ ...base, mcpOn: null, canCheckUpdates: false, dueToday: null });
  assert.deepEqual(labels(items), ['Ironleaf', '---', 'Open Ironleaf', 'New note', 'Quick capture', 'Today', 'Search', '---', 'Start with Windows', 'Quit Ironleaf']);
});

test('no two separators meet, none first or last, every action has its own id, and there is no pause item', () => {
  for (const state of [base, { ...base, mcpOn: null }, { ...base, canCheckUpdates: false }, { ...base, mcpOn: null, canCheckUpdates: false, dueToday: 0 }]) {
    const items = T.trayMenu(state);
    items.forEach((item, i) => assert.ok(!(item.type === 'separator' && (i === 0 || i === items.length - 1 || items[i - 1].type === 'separator'))));
    const ids = items.filter((i) => i.id).map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(items.at(-1).id, 'quit');
    assert.ok(!labels(items).some((l) => /pause/i.test(l)));
  }
});

test('the tooltip: the name, then a short line of how things stand', () => {
  assert.equal(T.trayTooltip({ mcpOn: true, dueToday: 2 }), 'Ironleaf · AI access on · 2 due today');
  assert.equal(T.trayTooltip({ mcpOn: false, dueToday: 0 }), 'Ironleaf · AI access off');
  assert.equal(T.trayTooltip({ mcpOn: null, dueToday: null }), 'Ironleaf');
  assert.ok(T.trayTooltip({ mcpOn: true, dueToday: 123456 }).length < 127);
});

test('a close hides or really closes: every combination', () => {
  for (const keepInTray of [true, false])
    for (const quitting of [true, false])
      for (const sessionEnding of [true, false])
        for (const trayAvailable of [true, false]) {
          const want = keepInTray && !quitting && !sessionEnding && trayAvailable ? 'hide' : 'close';
          assert.equal(T.closeDecision({ keepInTray, quitting, sessionEnding, trayAvailable }), want, JSON.stringify({ keepInTray, quitting, sessionEnding, trayAvailable }));
        }
});

test('never hidden without a tray to come back through, and never while quitting', () => {
  assert.equal(T.closeDecision({ keepInTray: true, quitting: false, sessionEnding: false, trayAvailable: false }), 'close');
  assert.equal(T.closeDecision({ keepInTray: true, quitting: true, sessionEnding: false, trayAvailable: true }), 'close');
  assert.equal(T.closeDecision({ keepInTray: true, quitting: false, sessionEnding: true, trayAvailable: true }), 'close');
});

test('kept in the tray unless switched off; odd files read as the defaults', () => {
  assert.deepEqual(T.DEFAULT_TRAY_PREFS, { keepInTray: true, noticeShown: false });
  for (const raw of [null, undefined, 'x', 7, [], {}, { keepInTray: 'no', noticeShown: 1 }]) assert.deepEqual(T.cleanTrayPrefs(raw), { keepInTray: true, noticeShown: false });
  assert.deepEqual(T.cleanTrayPrefs({ keepInTray: false, noticeShown: true, more: 1 }), { keepInTray: false, noticeShown: true });
});

test('the still-running notice shows once, then never again', () => {
  const first = T.firstCloseNotice(T.cleanTrayPrefs(null));
  assert.equal(first.show, true);
  assert.equal(first.prefs.noticeShown, true);
  const second = T.firstCloseNotice(first.prefs);
  assert.equal(second.show, false);
  assert.deepEqual(second.prefs, first.prefs);
  // Kept across a restart (what the file holds comes back the same).
  assert.equal(T.firstCloseNotice(T.cleanTrayPrefs(JSON.parse(JSON.stringify(first.prefs)))).show, false);
  // The other setting is never touched by it.
  assert.equal(T.firstCloseNotice({ keepInTray: false, noticeShown: false }).prefs.keepInTray, false);
});

test('the words are the product’s own', () => {
  assert.equal(T.STILL_RUNNING_WORDS, 'Ironleaf is still running. Find it in the tray; right-click it to quit.');
  assert.equal(T.KEEP_IN_TRAY_WORDS, 'Keep Ironleaf running in the tray when I close the window');
});

test('starting at login: hidden, and a development copy names its folder first', () => {
  assert.equal(T.HIDDEN_ARG, '--hidden');
  assert.deepEqual(T.loginItemArgs({ packaged: true, appPath: 'C:\\app' }), ['--hidden']);
  assert.deepEqual(T.loginItemArgs({ packaged: false, appPath: '/work/nv' }), ['/work/nv', '--hidden']);
  assert.deepEqual(T.loginItemSettings(true, { packaged: true, exe: 'C:\\Apps\\Ironleaf.exe' }), { openAtLogin: true, path: 'C:\\Apps\\Ironleaf.exe', args: ['--hidden'] });
  assert.equal(T.loginItemSettings(false, { packaged: true, exe: 'x' }).openAtLogin, false);
});

test('a hidden start only where a tray shows the way back; a second start shows the window', () => {
  assert.equal(T.startsHidden(['nv', '--hidden'], true), true);
  assert.equal(T.startsHidden(['nv', '--hidden'], false), false);
  assert.equal(T.startsHidden(['nv'], true), false);
  assert.equal(T.startsHidden(null, true), false);
  assert.equal(T.secondStartShows(['nv']), true);
  assert.equal(T.secondStartShows(['nv', 'ironleaf://open']), true);
  assert.equal(T.secondStartShows(['nv', '--hidden']), false);
});

test('Linux: where the autostart entry lives', () => {
  assert.equal(T.autostartFile({ HOME: '/home/pat' }, '/home/other'), '/home/pat/.config/autostart/neuralvault.desktop');
  assert.equal(T.autostartFile({}, '/home/other/'), '/home/other/.config/autostart/neuralvault.desktop');
  assert.equal(T.autostartFile({ XDG_CONFIG_HOME: '/cfg/', HOME: '/home/pat' }, '/h'), '/cfg/autostart/neuralvault.desktop');
  // A relative XDG_CONFIG_HOME is not valid: ~/.config.
  assert.equal(T.autostartFile({ XDG_CONFIG_HOME: 'cfg', HOME: '/home/pat' }, '/h'), '/home/pat/.config/autostart/neuralvault.desktop');
});

test('Linux: the autostart entry’s words', () => {
  const text = T.autostartDesktop({ exe: '/opt/Ironleaf/neuralvault', packaged: true, icon: '/opt/Ironleaf/icon.png' });
  assert.equal(text, ['[Desktop Entry]', 'Type=Application', 'Name=Ironleaf', 'Comment=Starts Ironleaf in the tray when you sign in', 'Exec=/opt/Ironleaf/neuralvault --hidden', 'Icon=/opt/Ironleaf/icon.png', 'Terminal=false', 'StartupNotify=false', 'X-GNOME-Autostart-enabled=true', 'Categories=Office;', ''].join('\n'));
  assert.equal(T.autostartOn(text), true);
});

test('Linux: an AppImage starts by its own file; paths with spaces are quoted; a development copy names its folder', () => {
  const exec = (o) => T.autostartDesktop(o).split('\n').find((l) => l.startsWith('Exec='));
  assert.equal(exec({ exe: '/tmp/.mount_x/neuralvault', packaged: true, appImage: '/home/pat/Apps/Ironleaf.AppImage' }), 'Exec=/home/pat/Apps/Ironleaf.AppImage --hidden');
  assert.equal(exec({ exe: '/home/pat/My Apps/neuralvault', packaged: true }), 'Exec="/home/pat/My Apps/neuralvault" --hidden');
  assert.equal(exec({ exe: '/n/electron', packaged: false, appPath: '/work/nv', appImage: '/ignored.AppImage' }), 'Exec=/n/electron /work/nv --hidden');
  assert.equal(T.desktopExecWord('a"b$c`d\\e'), '"a\\"b\\$c\\`d\\\\e"');
  assert.equal(T.desktopExecWord('/a/100%/x'), '/a/100%%/x');
});

test('Linux: an entry switched off, hidden or empty is off', () => {
  assert.equal(T.autostartOn(null), false);
  assert.equal(T.autostartOn(''), false);
  assert.equal(T.autostartOn('[Desktop Entry]\nExec=/x --hidden\nHidden=true\n'), false);
  assert.equal(T.autostartOn('[Desktop Entry]\nExec=/x --hidden\nX-GNOME-Autostart-enabled=false\n'), false);
  assert.equal(T.autostartOn('[Desktop Entry]\nExec=/x --hidden\n'), true);
});

test('Linux: a tray is there only when the session bus says something hosts tray icons', () => {
  assert.equal(T.trayHostFromBus('(true,)\n'), true);
  assert.equal(T.trayHostFromBus('method return ...\n   boolean true\n'), true);
  assert.equal(T.trayHostFromBus('b true\n'), true);
  assert.equal(T.trayHostFromBus('(false,)\n'), false);
  assert.equal(T.trayHostFromBus(''), false);
  assert.equal(T.trayHostFromBus(null), false);
});

test('Linux: the notice is shown only where something takes notifications', () => {
  assert.equal(T.notificationsListed("(['org.freedesktop.DBus', 'org.freedesktop.Notifications'],)"), true);
  assert.equal(T.notificationsListed("(['org.freedesktop.DBus'],)"), false);
  assert.equal(T.notificationsListed(null), false);
  const src = read('src/main/tray.ts');
  assert.match(src, /process\.platform === 'linux' \? busTakesNotifications\(\)/);
});

test('the picture follows the taskbar: white on dark, dark on light; .ico on Windows, PNG elsewhere', () => {
  assert.equal(T.trayIconFile({ platform: 'win32', darkTaskbar: true }), 'ironleaf-tray-white.ico');
  assert.equal(T.trayIconFile({ platform: 'win32', darkTaskbar: false }), 'ironleaf-tray-dark.ico');
  assert.equal(T.trayIconFile({ platform: 'linux', darkTaskbar: true }), 'ironleaf-tray-white.png');
  assert.equal(T.trayIconFile({ platform: 'linux', darkTaskbar: false }), 'ironleaf-tray-dark.png');
});

test('every picture the tray can ask for is shipped, at the sizes a tray wants', () => {
  const size = (file) => {
    const b = readFileSync(path.join(root, 'resources/tray', file));
    assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  for (const tone of ['white', 'dark']) {
    assert.deepEqual(size(`ironleaf-tray-${tone}.png`), [24, 24]);
    assert.deepEqual(size(`ironleaf-tray-${tone}@2x.png`), [48, 48]);
    const ico = readFileSync(path.join(root, 'resources/tray', `ironleaf-tray-${tone}.ico`));
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'an .ico');
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]).sort((a, b) => a - b);
    assert.deepEqual(sizes, [16, 20, 24, 32]);
  }
  for (const platform of ['win32', 'linux', 'darwin']) for (const darkTaskbar of [true, false]) assert.ok(existsSync(path.join(root, 'resources/tray', T.trayIconFile({ platform, darkTaskbar }))));
});

test('what the update check found, in words', () => {
  assert.equal(T.updateWords(null), 'Ironleaf is up to date.');
  assert.equal(T.updateWords({ version: '1.2.0' }), 'Ironleaf 1.2.0 is ready. Open Settings to update.');
  assert.match(T.updateWords(null, true), /could not check/);
});

test('the product’s words never name another product', () => {
  const words = [read('src/shared/tray-model.ts'), read('src/main/tray.ts'), read('src/renderer/src/components/TraySettings.tsx'), read('tools/make-tray-icons.py')].join('\n');
  // Strings the person can see (quoted words), not the comments that say where things come from.
  const shown = [...read('src/shared/tray-model.ts').matchAll(/'[^'\n]*'|`[^`\n]*`/g), ...read('src/renderer/src/components/TraySettings.tsx').matchAll(/'[^'\n]*'|"[^"\n]*"/g)].map((m) => m[0]).join('\n');
  assert.ok(!/NeuralSpark/i.test(shown));
});

test('the window’s close asks the tray only after the save handshake, and before it is let go', () => {
  const src = read('src/main/app.ts');
  const close = src.slice(src.indexOf("next.on('close', (event) => {"), src.indexOf("next.on('closed', () => {"));
  const flush = close.indexOf('await closeHandshake(');
  const ask = close.indexOf('host.tray?.keepOnClose(next)');
  const allow = close.indexOf('allowClose = true');
  assert.ok(flush > 0 && ask > flush && allow > ask, 'handshake, then the tray, then the close');
  // A close kept in the tray leaves the window ready to be asked again (never stuck "closing").
  assert.match(close, /keepOnClose\(next\)[^\n]*closing = false/);
});

test('the tray is wired in with one line each: made at the start, begun with the app, a hidden start never quits it', () => {
  const index = read('src/main/index.ts');
  assert.match(index, /tray = createTray\(\{[^\n]*checkUpdate: \(\) => updater\.check\(\)/);
  assert.match(index, /tray: tray\.host,/);
  assert.match(index, /await tray\.begin\(ironleaf\);/);
  assert.match(index, /app\.on\('window-all-closed', \(\) => \{\n  if \(tray\?\.holding\(\)\) return;/);
  assert.ok(index.indexOf('if (!single) return;') < index.indexOf('tray = createTray('), 'only the one running Ironleaf makes a tray icon');
  assert.match(read('src/preload/index.ts'), /tray: \{ state: \(\) => invoke<[^>]+>\('tray:state'\), set: [^\n]*'tray:set', patch\) \}/);
  assert.match(read('src/renderer/src/components/Settings.tsx'), /<TraySettings \/>/);
});

test('the tray side: a real quit, a session ending and the icon’s end are all handled', () => {
  const src = read('src/main/tray.ts');
  assert.match(src, /app\.on\('before-quit', \(\) => \(quitting = true\)\)/);
  assert.match(src, /'session-end', ending/);
  assert.match(src, /tray\?\.destroy\(\)/);
  assert.match(src, /nativeTheme\.on\('updated'/);
  assert.match(src, /app\.on\('second-instance'/);
  // Hidden only through the decision, and the notice kept only once it was really shown.
  assert.match(src, /if \(decision === 'close' \|\| win\.isDestroyed\(\)\) return false;\n\s+win\.hide\(\);/);
  assert.match(src, /if \(notice\.show && notify\(STILL_RUNNING_WORDS[^\n]*\{\n\s+prefs = notice\.prefs;\n\s+savePrefs\(\);/);
});

test('Settings search finds both switches by their row titles', () => {
  const index = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(index.includes(`title: '${T.KEEP_IN_TRAY_WORDS}'`));
  assert.ok(index.includes(`title: '${T.START_AT_LOGIN_WORDS}'`));
});
