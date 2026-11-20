// Ironleaf's tray icon (20 Nov 2026): always there while Ironleaf runs, so its background jobs keep going with
// the window closed (reminders, AI access for other apps, the sync folder and Git backup, the update check). A click
// opens the window; the menu opens places, switches AI access and starting at login, and quits. Closing the window
// hides it here (after the usual save of every edit: src/main/app.ts asks keepOnClose only once the page has said it
// saved), unless the person switched that off, a real quit is under way, or this desktop has no tray to come back
// through. The rules are in src/shared/tray-model.ts (no Electron there); this file is the Electron side.

import { app, Menu, nativeImage, nativeTheme, Notification, Tray, type BrowserWindow, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autostartDesktop, autostartFile, autostartOn, cleanTrayPrefs, closeDecision, firstCloseNotice, HIDDEN_ARG, loginItemSettings, loginLabel, secondStartShows, startsHidden, STILL_RUNNING_WORDS, notificationsListed, trayHostFromBus, trayIconFile, trayMenu, trayTooltip, updateWords, type TrayAction, type TrayPrefs, type TrayView } from '../shared/tray-model';

/** What the app's window asks the tray (IronleafHost.tray): a close that came through the save handshake. */
export interface TrayHost {
  /** True when the window was hidden to the tray instead (the close stops there); false lets it close. */
  keepOnClose(win: BrowserWindow): Promise<boolean>;
}

/** What the tray needs from inside the app beyond its public doors (IronleafApp.tray). */
export interface TrayPorts {
  /** Other AI apps may use the vault (the local MCP server's switch, Settings, Agents). */
  mcpOn(): boolean;
  setMcp(on: boolean): Promise<void>;
  /** Told each time that switch changes (in Settings or here). */
  onMcpChange(fn: () => void): () => void;
  /** The window, with Search open. */
  search(): Promise<void>;
  /** Registers a handler only Ironleaf's own pages may call (the app's own registrar). */
  handle(channel: string, fn: (...args: any[]) => unknown): void;
}

/** The part of the running app the tray drives (IronleafApp has all of it). */
export interface TrayApp {
  open(target?: { place?: string; newNote?: boolean }): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  capture(): Promise<void>;
  todayCount(): Promise<number>;
  window(): BrowserWindow | null;
  tray: TrayPorts;
}

export interface TrayOptions {
  /** Ironleaf's own data: tray.json lives here. */
  dataDir: string;
  /** The folder holding the tray PNGs (resources/tray). */
  icons: string;
  /** The app's own icon, for notifications and when a tray PNG is missing. */
  icon: string;
  argv: readonly string[];
  /** The catalogue's newer Ironleaf, when there is one. Absent: no "Check for updates". */
  checkUpdate?: () => Promise<{ version: string } | null>;
  /** Opens Settings › About and updates with a check running (src/main/update-about.ts); absent: a notification says what the check found. */
  openAbout?: () => void;
  log?(message: string): void;
}

export interface TrayController {
  host: TrayHost;
  /** The app is made: wires the menu to it and opens the window, or keeps it away for a hidden start. */
  begin(vault: TrayApp): Promise<void>;
  /** The tray icon was made (it may still have nowhere to show: see available). */
  created(): boolean;
  /** A tray is there to come back through, asked now. */
  available(): Promise<boolean>;
  /** Started hidden and the main window not yet opened: a small window closing (Quick capture's snip) must not
   *  quit Ironleaf, which has no window of its own to close yet. */
  holding(): boolean;
}

/** The tray's picture for the taskbar as it is now (tools/make-tray-icons.py made them): the app's own icon, made
 *  small, when the file is not there. */
function trayImage(dir: string, fallback: string, file: string): NativeImage {
  const image = nativeImage.createFromPath(path.join(dir, file));
  if (!image.isEmpty()) return image;
  const side = process.platform === 'win32' ? 16 : 24;
  return nativeImage.createFromPath(fallback).resize({ width: side, height: side, quality: 'best' });
}

/** Linux: one question to the session bus's own service, with whichever tool is there (gdbus, dbus-send, busctl).
 *  The words it printed, or null when no tool or no bus answered. */
function askBus(method: 'NameHasOwner' | 'ListActivatableNames', name?: string): Promise<string | null> {
  const asks: [string, string[]][] = [
    ['gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', `org.freedesktop.DBus.${method}`, ...(name ? [name] : [])]],
    ['dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', `org.freedesktop.DBus.${method}`, ...(name ? [`string:${name}`] : [])]],
    ['busctl', ['--user', 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', method, ...(name ? ['s', name] : [])]],
  ];
  const ask = (i: number): Promise<string | null> =>
    new Promise((resolve) => {
      if (i >= asks.length) return resolve(null);
      try {
        execFile(asks[i][0], asks[i][1], { timeout: 1500, windowsHide: true }, (err, stdout) => {
          if (err) return resolve(ask(i + 1));
          resolve(String(stdout));
        });
      } catch {
        resolve(ask(i + 1));
      }
    });
  return ask(0);
}

/** Linux: whether something on the desktop hosts tray icons (GNOME without an extension, and bare window managers,
 *  have nothing: Electron makes the icon without complaint and it shows nowhere). No tool or no bus reads as no
 *  tray, so a close then quits as it always did. */
const busHasTrayHost = async (): Promise<boolean> => trayHostFromBus(await askBus('NameHasOwner', 'org.kde.StatusNotifierWatcher'));

/** Linux: whether a notification would be taken by anything (running, or started by the bus when asked). Without
 *  one, showing a notification waits on the bus for a long time with the whole app held, so it is not shown. */
async function busTakesNotifications(): Promise<boolean> {
  const name = 'org.freedesktop.Notifications';
  if (trayHostFromBus(await askBus('NameHasOwner', name))) return true;
  return notificationsListed(await askBus('ListActivatableNames'));
}

export function createTray(opts: TrayOptions): TrayController {
  const log = (m: string) => {
    try {
      opts.log?.(m);
    } catch {
      // Nowhere to say it.
    }
  };
  const prefsFile = path.join(opts.dataDir, 'tray.json');
  let prefs: TrayPrefs = cleanTrayPrefs(null);
  try {
    prefs = cleanTrayPrefs(JSON.parse(readFileSync(prefsFile, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    // First start: the defaults (kept in the tray; the notice not yet shown).
  }
  const savePrefs = (): void => {
    try {
      // Whole or not at all (a temp beside it, then put in its place).
      mkdirSync(opts.dataDir, { recursive: true });
      const temp = `${prefsFile}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
      renameSync(temp, prefsFile);
    } catch (err) {
      log('Ironleaf could not keep its tray settings: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  let tray: Tray | null = null;
  let vault: TrayApp | null = null;
  let quitting = false;
  let sessionEnding = false;
  let windowsAllClosed = false;
  let hiddenStart = false;
  let mainWindowMade = false;
  const holding = () => hiddenStart && !mainWindowMade && !quitting;
  let dueToday: number | null = null;

  // A development copy can say whether a tray is there (the checks: a headless screen has none).
  const forced = !app.isPackaged && /^[01]$/.test(process.env.NV_TRAY_HOST ?? '') ? process.env.NV_TRAY_HOST === '1' : null;
  async function available(): Promise<boolean> {
    if (!tray || tray.isDestroyed()) return false;
    if (forced !== null) return forced;
    if (process.platform !== 'linux') return true;
    return busHasTrayHost();
  }

  // ── Starting at login ──
  const loginOpts = () => ({ packaged: app.isPackaged, exe: process.execPath, appPath: app.getAppPath(), appImage: process.env.APPIMAGE });
  const autostart = () => autostartFile(process.env, os.homedir());
  function startAtLogin(): boolean {
    try {
      if (process.platform === 'linux') return autostartOn(existsSync(autostart()) ? readFileSync(autostart(), 'utf8') : null);
      const s = loginItemSettings(true, loginOpts());
      return app.getLoginItemSettings({ path: s.path, args: s.args }).openAtLogin === true;
    } catch {
      return false;
    }
  }
  function setStartAtLogin(on: boolean): void {
    try {
      if (process.platform === 'linux') {
        const file = autostart();
        if (on) {
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, autostartDesktop({ ...loginOpts(), icon: opts.icon }), 'utf8');
        } else rmSync(file, { force: true });
      } else app.setLoginItemSettings(loginItemSettings(on, loginOpts()));
    } catch (err) {
      log('Ironleaf could not change starting at login: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── The menu ──
  // A dark system theme draws a dark taskbar, so the white mark; a light one takes the dark mark.
  const iconFile = () => trayIconFile({ platform: process.platform, darkTaskbar: nativeTheme.shouldUseDarkColors !== false });
  let iconShown = '';
  const mcpOn = (): boolean | null => {
    try {
      return vault ? vault.tray.mcpOn() : null;
    } catch {
      return null;
    }
  };
  const notify = (body: string, onClick?: () => void): boolean => {
    try {
      if (!Notification.isSupported()) return false;
      const n = new Notification({ title: 'Ironleaf', body, icon: opts.icon });
      if (onClick) n.on('click', onClick);
      n.show();
      return true;
    } catch {
      return false;
    }
  };
  const show = (target?: { place?: string; newNote?: boolean }): void => {
    void vault?.open(target).catch((err) => log('Ironleaf could not open its window: ' + (err instanceof Error ? err.message : String(err))));
  };
  async function act(id: TrayAction): Promise<void> {
    if (!vault) return;
    try {
      if (id === 'open') show();
      else if (id === 'new-note') show({ newNote: true });
      else if (id === 'today') show({ place: 'today' });
      else if (id === 'capture') await vault.capture();
      else if (id === 'search') await vault.tray.search();
      else if (id === 'toggle-mcp') await vault.tray.setMcp(!vault.tray.mcpOn());
      else if (id === 'toggle-login') setStartAtLogin(!startAtLogin());
      else if (id === 'check-updates' && opts.openAbout) {
        show();
        opts.openAbout();
      } else if (id === 'check-updates' && opts.checkUpdate) {
        const found = await opts.checkUpdate().then(
          (v) => ({ v, failed: false }),
          () => ({ v: null, failed: true }),
        );
        notify(updateWords(found.v, found.failed), found.v ? () => show() : undefined);
      } else if (id === 'quit') {
        quitting = true;
        app.quit();
        return;
      }
    } catch (err) {
      log(`Ironleaf's tray (${id}): ` + (err instanceof Error ? err.message : String(err)));
    }
    refresh();
  }
  function refresh(): void {
    if (!tray || tray.isDestroyed()) return;
    try {
      const state = { platform: process.platform, mcpOn: mcpOn(), startAtLogin: startAtLogin(), canCheckUpdates: !!opts.checkUpdate, dueToday };
      const file = iconFile();
      if (file !== iconShown) {
        tray.setImage(trayImage(opts.icons, opts.icon, file));
        iconShown = file;
      }
      const template: MenuItemConstructorOptions[] = trayMenu(state).map((item) => (item.type === 'separator' ? { type: 'separator' as const } : item.type === 'title' ? { label: item.label, enabled: false } : { type: item.type, label: item.label, ...(item.type === 'checkbox' ? { checked: item.checked } : {}), click: () => void act(item.id) }));
      tray.setContextMenu(Menu.buildFromTemplate(template));
      tray.setToolTip(trayTooltip(state));
    } catch (err) {
      log("Ironleaf's tray menu: " + (err instanceof Error ? err.message : String(err)));
    }
  }
  function refreshDue(): void {
    if (!vault) return;
    void vault
      .todayCount()
      .then((n) => {
        dueToday = Number.isFinite(n) ? n : null;
        refresh();
      })
      .catch(() => {});
  }

  // ── The icon itself: made now, at the start, and there until Ironleaf quits ──
  try {
    iconShown = iconFile();
    tray = new Tray(trayImage(opts.icons, opts.icon, iconShown));
    // The taskbar's own light or dark can change while Ironleaf runs; the mark follows it.
    nativeTheme.on('updated', () => refresh());
    tray.on('click', () => show());
    if (process.platform === 'win32') tray.on('double-click', () => show());
    refresh();
    log('Ironleaf tray: icon made.');
  } catch (err) {
    tray = null;
    log('Ironleaf tray: no tray here, so closing the window quits as before (' + (err instanceof Error ? err.message : String(err)) + ').');
  }

  // A real quit (the tray's Quit, the app menu, Ctrl+Q, an update restarting, the system asking): the window's own
  // close still saves first, and then nothing holds it back.
  app.on('before-quit', () => (quitting = true));
  // Windows signing out or shutting down: the window must go, never hide.
  app.on('browser-window-created', (_e, w) => {
    setImmediate(() => {
      if (vault?.window() === w) mainWindowMade = true;
    });
    const ending = () => (sessionEnding = true);
    (w as unknown as { on(e: string, fn: () => void): void }).on('query-session-end', ending);
    (w as unknown as { on(e: string, fn: () => void): void }).on('session-end', ending);
  });
  // Started hidden and quit without ever having a window: the app's jobs are still stopped properly.
  app.on('window-all-closed', () => {
    if (!holding()) windowsAllClosed = true;
  });
  app.on('will-quit', () => {
    try {
      tray?.destroy();
    } catch {
      // Already gone.
    }
    if (!windowsAllClosed) {
      try {
        vault?.stop();
      } catch {
        // Quitting anyway.
      }
    }
  });
  // A second start while hidden in the tray shows the window that is already there (links and files it was started
  // with are the app's own second-instance listener; this is the plain "started again").
  app.on('second-instance', (_e, argv) => {
    if (secondStartShows(argv)) show();
  });

  async function keepOnClose(win: BrowserWindow): Promise<boolean> {
    const trayAvailable = await available();
    const decision = closeDecision({ keepInTray: prefs.keepInTray, quitting, sessionEnding, trayAvailable });
    log(`Ironleaf tray: window close -> ${decision} (keep in tray ${prefs.keepInTray ? 'on' : 'off'}, quitting ${quitting || sessionEnding ? 'yes' : 'no'}, tray ${trayAvailable ? 'there' : 'not there'}).`);
    if (decision === 'close' || win.isDestroyed()) return false;
    win.hide();
    // Said once, a moment after the window has gone (a desktop slow to take a notification never holds the hide up).
    setTimeout(() => {
      refreshDue();
      const notice = firstCloseNotice(prefs);
      if (!notice.show) return;
      void (process.platform === 'linux' ? busTakesNotifications() : Promise.resolve(true)).then((taken) => {
        if (!taken) return log('Ironleaf tray: nothing here shows notifications, so the still-running notice waits for a later close.');
        if (notice.show && notify(STILL_RUNNING_WORDS, () => show())) {
          prefs = notice.prefs;
          savePrefs();
        }
      });
    }, 400);
    return true;
  }

  async function view(): Promise<TrayView> {
    return { keepInTray: prefs.keepInTray, startAtLogin: startAtLogin(), trayAvailable: await available(), loginLabel: loginLabel(process.platform), platform: process.platform };
  }

  /** At sign-in the desktop's tray may come up after Ironleaf: asked a few times before giving up on it. */
  async function availableSoon(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      if (await available()) return true;
      if (process.platform !== 'linux' || forced !== null || !tray) return false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return false;
  }

  return {
    host: { keepOnClose },
    created: () => !!tray && !tray.isDestroyed(),
    available,
    holding,
    async begin(app_: TrayApp): Promise<void> {
      vault = app_;
      vault.tray.handle('tray:state', () => view());
      vault.tray.handle('tray:set', async (patch: unknown) => {
        const p = (patch && typeof patch === 'object' ? patch : {}) as { keepInTray?: unknown; startAtLogin?: unknown };
        if (typeof p.keepInTray === 'boolean' && p.keepInTray !== prefs.keepInTray) {
          prefs = { ...prefs, keepInTray: p.keepInTray };
          savePrefs();
        }
        if (typeof p.startAtLogin === 'boolean') setStartAtLogin(p.startAtLogin);
        refresh();
        return view();
      });
      vault.tray.onMcpChange(() => refresh());
      refresh();
      refreshDue();
      const timer = setInterval(refreshDue, 10 * 60 * 1000);
      timer.unref?.();
      if (opts.argv.includes(HIDDEN_ARG)) {
        // The jobs first (the notes opened, reminders, AI access), then the window only if there is no tray to
        // find Ironleaf in.
        await vault.start();
        const hidden = startsHidden(opts.argv, await availableSoon());
        log(hidden ? 'Ironleaf tray: started hidden, in the tray.' : 'Ironleaf tray: asked to start hidden, but there is no tray here, so the window opens.');
        if (hidden) {
          hiddenStart = true;
          return;
        }
      } else {
        void available().then((there) => log(`Ironleaf tray: ${there ? 'a tray is there; closing the window keeps Ironleaf running when that is switched on' : 'no tray on this desktop; closing the window quits as before'}.`));
      }
      await vault.open();
    },
  };
}
