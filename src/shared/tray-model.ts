// The tray icon's rules (20 Nov 2026): Ironleaf stays in the tray so its background jobs keep going with the window
// closed (reminders, AI access for other apps, sync and backup, the update check). Everything decided here is plain
// data: the menu from the state, whether a close hides or really closes, the one-time "still running" notice, and what
// starting at login needs on Windows and on Linux. No Electron here (src/main/tray.ts has that), so tests drive it.

/** The start-up argument that keeps the window away (starting at login puts Ironleaf in the tray). */
export const HIDDEN_ARG = '--hidden';

/** Said once, the first time a close leaves Ironleaf in the tray. */
export const STILL_RUNNING_WORDS = 'Ironleaf is still running. Find it in the tray; right-click it to quit.';

/** The Settings switch's words (Settings, General: Tray and start-up). */
export const KEEP_IN_TRAY_WORDS = 'Keep Ironleaf running in the tray when I close the window';

/** The Settings row for starting at sign-in (the tray's menu says "Start with Windows" or "Start at login"). */
export const START_AT_LOGIN_WORDS = 'Start Ironleaf when I sign in';

/** What is kept in tray.json in Ironleaf's own data. */
export interface TrayPrefs {
  /** Closing the window hides it and Ironleaf keeps running (on unless switched off). */
  keepInTray: boolean;
  /** The "still running" notice was shown: never again. */
  noticeShown: boolean;
}

export const DEFAULT_TRAY_PREFS: TrayPrefs = { keepInTray: true, noticeShown: false };

/** Whatever the file held, as prefs: anything missing or odd reads as the default. */
export function cleanTrayPrefs(raw: unknown): TrayPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { keepInTray: r.keepInTray !== false, noticeShown: r.noticeShown === true };
}

/** What Settings shows. */
export interface TrayView {
  keepInTray: boolean;
  startAtLogin: boolean;
  /** A tray is there on this desktop: without one a close always quits, and the switch says so. */
  trayAvailable: boolean;
  /** "Start with Windows" on Windows, "Start at login" elsewhere. */
  loginLabel: string;
  platform: string;
}

export type TrayAction = 'open' | 'new-note' | 'capture' | 'today' | 'search' | 'toggle-mcp' | 'toggle-login' | 'check-updates' | 'quit';

export interface TrayMenuState {
  platform: string;
  /** Other AI apps may use the vault (the local MCP server's switch); null when it cannot be read. */
  mcpOn: boolean | null;
  startAtLogin: boolean;
  /** An update check is there to call. */
  canCheckUpdates: boolean;
  /** Steps late or due today; null when not known. */
  dueToday?: number | null;
}

export type TrayMenuItem = { type: 'separator' } | { type: 'title'; label: string } | { type: 'normal'; id: TrayAction; label: string } | { type: 'checkbox'; id: TrayAction; label: string; checked: boolean };

export const loginLabel = (platform: string): string => (platform === 'win32' ? 'Start with Windows' : 'Start at login');

/** The right-click menu, top to bottom. */
export function trayMenu(state: TrayMenuState): TrayMenuItem[] {
  const detail = trayDetail(state);
  const items: TrayMenuItem[] = [
    // The name and a line of how things stand (greyed, never clicked), then the actions.
    { type: 'title', label: 'Ironleaf' },
    ...(detail ? [{ type: 'title' as const, label: detail }] : []),
    { type: 'separator' },
    { type: 'normal', id: 'open', label: 'Open Ironleaf' },
    { type: 'normal', id: 'new-note', label: 'New note' },
    { type: 'normal', id: 'capture', label: 'Quick capture' },
    { type: 'normal', id: 'today', label: 'Today' },
    { type: 'normal', id: 'search', label: 'Search' },
  ];
  if (state.mcpOn !== null) items.push({ type: 'separator' }, { type: 'checkbox', id: 'toggle-mcp', label: 'AI access (MCP)', checked: state.mcpOn });
  items.push({ type: 'separator' }, { type: 'checkbox', id: 'toggle-login', label: loginLabel(state.platform), checked: state.startAtLogin });
  if (state.canCheckUpdates) items.push({ type: 'normal', id: 'check-updates', label: 'Check for updates' });
  items.push({ type: 'normal', id: 'quit', label: 'Quit Ironleaf' });
  return items;
}

/** A short line of how things stand: AI access, and what is due today. Empty when nothing is known. */
export function trayDetail(state: Pick<TrayMenuState, 'mcpOn' | 'dueToday'>): string {
  const parts: string[] = [];
  if (state.mcpOn !== null) parts.push(state.mcpOn ? 'AI access on' : 'AI access off');
  if (typeof state.dueToday === 'number' && state.dueToday > 0) parts.push(`${state.dueToday} due today`);
  return parts.join(' · ');
}

/** The words under the pointer: the name, then that line (Windows cuts a tooltip at 127 characters; this never
 *  comes near). */
export function trayTooltip(state: Pick<TrayMenuState, 'mcpOn' | 'dueToday'>): string {
  const detail = trayDetail(state);
  return detail ? `Ironleaf · ${detail}` : 'Ironleaf';
}

/** The tray's picture: the vault mark alone, white on a dark taskbar and dark on a light one (the system theme).
 *  Windows takes an .ico (16 to 32 px inside), other systems the PNG beside it (24 px, 48 at 2x). */
export function trayIconFile(opts: { platform: string; darkTaskbar: boolean }): string {
  return `ironleaf-tray-${opts.darkTaskbar ? 'white' : 'dark'}.${opts.platform === 'win32' ? 'ico' : 'png'}`;
}

export interface CloseQuestion {
  /** The Settings switch. */
  keepInTray: boolean;
  /** A real quit is under way (the tray's Quit, the app menu, Ctrl+Q, an update restarting). */
  quitting: boolean;
  /** Windows is signing out or shutting down. */
  sessionEnding: boolean;
  /** The tray icon is there to come back through. */
  trayAvailable: boolean;
}

/** What a close of the main window does once its edits are saved: 'hide' keeps Ironleaf in the tray, 'close'
 *  lets the window go (and Ironleaf with it). Hidden only when it is wanted, nothing is quitting, and there is a
 *  tray to find it in again: never an app nobody can see. */
export function closeDecision(q: CloseQuestion): 'hide' | 'close' {
  if (q.quitting || q.sessionEnding) return 'close';
  if (!q.trayAvailable) return 'close';
  return q.keepInTray ? 'hide' : 'close';
}

/** The one-time notice: whether to show it now, and the prefs to keep afterwards. */
export function firstCloseNotice(prefs: TrayPrefs): { show: boolean; prefs: TrayPrefs } {
  if (prefs.noticeShown) return { show: false, prefs };
  return { show: true, prefs: { ...prefs, noticeShown: true } };
}

/** Whether this start should keep its window away: asked for, and only where a tray shows the way back. */
export function startsHidden(argv: readonly unknown[], trayAvailable: boolean): boolean {
  return trayAvailable && Array.isArray(argv) && argv.includes(HIDDEN_ARG);
}

/** A second start of Ironleaf brings the window forward, unless that start asked to stay hidden itself. */
export function secondStartShows(argv: readonly unknown[]): boolean {
  return !(Array.isArray(argv) && argv.includes(HIDDEN_ARG));
}

/** What the program is started with at login: hidden, and for a development copy the app's folder first (its
 *  program is Electron itself). */
export function loginItemArgs(opts: { packaged: boolean; appPath?: string }): string[] {
  return [...(!opts.packaged && opts.appPath ? [opts.appPath] : []), HIDDEN_ARG];
}

/** Windows (and macOS): Electron's login item, written and read back with the same path and arguments. */
export function loginItemSettings(on: boolean, opts: { packaged: boolean; exe: string; appPath?: string }): { openAtLogin: boolean; path: string; args: string[] } {
  return { openAtLogin: on, path: opts.exe, args: loginItemArgs(opts) };
}

/** One word of a .desktop Exec line: quoted when it holds anything but plain characters (the Desktop Entry rules:
 *  inside double quotes, a backslash before " ` $ and \; a literal % is doubled). */
export function desktopExecWord(word: string): string {
  const w = word.replace(/%/g, '%%');
  if (/^[A-Za-z0-9_\-+,./:=@%]+$/.test(w)) return w;
  return `"${w.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** Linux: where the autostart entry lives ($XDG_CONFIG_HOME or ~/.config, then autostart). Forward slashes: only
 *  ever a Linux path. */
export function autostartFile(env: { XDG_CONFIG_HOME?: string; HOME?: string }, home: string): string {
  const config = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : `${(env.HOME || home).replace(/\/+$/, '')}/.config`;
  return `${config.replace(/\/+$/, '')}/autostart/neuralvault.desktop`;
}

/** Linux: the autostart entry's words. An AppImage is started by its own file (the program inside it moves at every
 *  mount). */
export function autostartDesktop(opts: { exe: string; packaged: boolean; appPath?: string; appImage?: string; icon?: string }): string {
  const program = opts.packaged && opts.appImage ? opts.appImage : opts.exe;
  const exec = [program, ...loginItemArgs(opts)].map(desktopExecWord).join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Ironleaf',
    'Comment=Starts Ironleaf in the tray when you sign in',
    `Exec=${exec}`,
    ...(opts.icon ? [`Icon=${opts.icon}`] : []),
    'Terminal=false',
    'StartupNotify=false',
    'X-GNOME-Autostart-enabled=true',
    'Categories=Office;',
    '',
  ].join('\n');
}

/** Linux: whether an autostart entry's words switch it on (there, not hidden, not disabled). */
export function autostartOn(text: string | null): boolean {
  if (!text || !/^Exec=.+$/m.test(text)) return false;
  if (/^Hidden=true\s*$/im.test(text)) return false;
  if (/^X-GNOME-Autostart-enabled=false\s*$/im.test(text)) return false;
  return true;
}

/** Linux: a tray is there when something on the desktop is hosting status icons (the StatusNotifierWatcher has an
 *  owner on the session bus). `answer` is what the bus tool printed for NameHasOwner; null when it could not be asked. */
export function trayHostFromBus(answer: string | null): boolean {
  return !!answer && /\btrue\b/i.test(answer);
}

/** Linux: whether the bus's list of services it can start names a notification service. */
export function notificationsListed(answer: string | null): boolean {
  return !!answer && answer.includes('org.freedesktop.Notifications');
}

/** What the update check found, in words for a notification. */
export function updateWords(found: { version: string } | null | undefined, failed = false): string {
  if (failed) return 'Ironleaf could not check for updates just now. Try again later.';
  if (found && found.version) return `Ironleaf ${found.version} is ready. Open Settings to update.`;
  return 'Ironleaf is up to date.';
}
