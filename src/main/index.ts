// Ironleaf: a standalone notes app (20 Nov 2026). Plain Markdown notes on this PC, no account. Its AI runs on the
// person's own connections (src/main/providers); any other AI connects through the local MCP server (src/main/mcp-local.ts).

import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { checkForUpdate, startUpdateCheck } from './update-check';
import { openAbout, startUpdateAbout } from './update-about';
import { managedUpdates, startManaged } from './managed';
import { startAccount } from './account';
import { createIronleaf, type IronleafApp } from './app';
import { ProviderService } from './providers';
import { ConnectionStore } from './providers/connections';
import { KeyStore } from './providers/keys';
import { LEGACY_START_MENU_LINK, legacyExeTarget, repairInstalledEntry } from './installed-entry';
import { isMcpCommand, launchIronleaf, runMcpBridge } from './mcp-bridge';
import { createTray, type TrayController } from './tray';
import { defaultLibraryIn } from '../shared/vault-home';

// Kept from NeuralVault on purpose (the rename to Ironleaf, 20 Nov 2026): Windows knows the app by this id (taskbar
// pins and grouping, the Start menu shortcut's identity, notification settings and history), so changing it would
// split an updated install from everything the person already set up.
export const APP_ID = 'com.kaitiaki.neuralvault';
// Kept: earlier installs' settings, keys and connections live here (NeuralVault 1.x and 2.0).
const DATA_DIR = path.join(app.getPath('appData'), '@neuralspark', 'vault');

// The installed program was NeuralVault.exe until the rename; an update over such an install keeps a NeuralVault.exe
// beside Ironleaf.exe (the installer links it, build-standalone/build/update-progress.nsh) for what still starts it
// (an earlier version's update helper, taskbar pins). Started that way, hand over to Ironleaf.exe at once.
const legacyStart = process.platform === 'win32' && app.isPackaged ? legacyExeTarget(process.execPath, existsSync) : null;
if (legacyStart && !isMcpCommand(process.argv, app.isPackaged)) {
  try {
    spawn(legacyStart, process.argv.slice(1), { detached: true, stdio: 'ignore', cwd: path.dirname(legacyStart) }).unref();
  } catch {
    // Ironleaf.exe could not be started: this copy carries on as itself.
  }
  app.exit(0);
}

// On Linux and macOS the OS keyring entry that protects saved keys is named after the app's name, so a copy that
// already has NeuralVault's data keeps that name internally (its saved keys still open); new installs are Ironleaf.
// Windows protects keys per user (DPAPI), not per name. What people see is named Ironleaf either way.
app.setName(process.platform !== 'win32' && existsSync(DATA_DIR) ? 'NeuralVault' : 'Ironleaf');
app.setAboutPanelOptions({ applicationName: 'Ironleaf' });
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', DATA_DIR);

const keys = new KeyStore();
const updater = { check: checkForUpdate };
let ironleaf: IronleafApp | null = null;
let tray: TrayController | null = null;
// One Ironleaf at a time: a second start (a ironleaf:// link, "Open with", the ironleaf command) hands what
// it was started for to this one, which listens for it (src/main/external.ts).
// Australian English for the app's own words, dates and date pickers; must run before the app is ready.
app.commandLine.appendSwitch('lang', 'en-AU');
// "Ironleaf mcp" (Settings › Connect an AI): a stdio bridge to the Ironleaf running here, never a second window.
const mcpBridge = isMcpCommand(process.argv, app.isPackaged);
if (mcpBridge) {
  app.dock?.hide();
  void runMcpBridge({ endpointFile: path.join(app.getPath('userData'), 'cli.json'), input: process.stdin, output: process.stdout, launch: () => launchIronleaf(process.argv, app.isPackaged), log: (m) => process.stderr.write(`${m}\n`) }).finally(() => app.exit(0));
}
const single = !mcpBridge && (process.argv.includes('--install-shortcut') || app.requestSingleInstanceLock());
if (!single && !mcpBridge) app.quit();

app.whenReady().then(async () => {
  if (!single) return;
  // tools/install-win.ps1: the Start menu shortcut, with Ironleaf's identity.
  if (process.platform === 'win32' && process.argv.includes('--install-shortcut')) {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const link = path.join(programs, 'Ironleaf.lnk');
    // The shortcut this script made before the rename goes, so the Start menu has one entry.
    rmSync(path.join(programs, LEGACY_START_MENU_LINK), { force: true });
    shell.writeShortcutLink(link, 'create', { target: process.execPath, cwd: path.dirname(process.execPath), description: 'Ironleaf', appUserModelId: APP_ID, icon: path.join(__dirname, '../../resources/icon.ico'), iconIndex: 0 });
    app.quit();
    return;
  }
  if (process.platform === 'win32' && app.isPackaged) void repairInstalledEntry({ version: app.getVersion() });
  await keys.load();
  // The tray icon, there from the start (src/main/tray.ts): a close hides the window there, after its save.
  tray = createTray({ dataDir: app.getPath('userData'), icons: path.join(__dirname, '../../resources/tray'), icon: path.join(__dirname, '../../resources/icon.png'), argv: process.argv, checkUpdate: () => updater.check(), openAbout: () => openAbout({ check: true }), log: (message) => console.error(message) });
  ironleaf = await createIronleaf({
    tray: tray.host,
    kind: 'standalone',
    dataDir: app.getPath('userData'),
    // Documents\Ironleaf for a new install; Documents\NeuralVault where an earlier version's notes already are.
    defaultLibrary: defaultLibraryIn(app.getPath('documents'), path, existsSync),
    preload: path.join(__dirname, '../preload/index.js'),
    renderer: { file: path.join(__dirname, '../renderer/index.html'), devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined },
    icon: path.join(__dirname, '../../resources/icon.png'),
    appId: APP_ID,
    models: new ProviderService(keys, new ConnectionStore(app.getPath('userData'))),
    pairTokens: { get: (id) => keys.get(id), set: (id, token) => keys.set(id, token), remove: (id) => keys.remove(id) },
    menu: true,
    log: (message) => console.error(message),
  });
  await tray.begin(ironleaf);
});

// Only the one running Ironleaf: never the `ironleaf mcp` bridge an AI app starts, nor a second start that hands
// over and quits (each would otherwise check for updates, and the account, on its own).
if (single) {
  startManaged();
  startAccount();
  startUpdateCheck(managedUpdates());
  startUpdateAbout();
}

app.on('window-all-closed', () => {
  if (tray?.holding()) return;
  ironleaf?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  void ironleaf?.open();
});
