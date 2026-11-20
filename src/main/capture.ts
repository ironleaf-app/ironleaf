// Quick capture: a Windows-wide key (Ctrl + Alt + N unless changed in Settings › Capture) opens a small box over
// whatever the person is doing; what they type, snip or drop in is filed in Ironleaf (src/shared/capture.ts says
// where). The key is held only while Ironleaf runs, and the box works with Ironleaf's main window hidden or closed
// (inside the former host app, Ironleaf keeps running with the former host app). Its windows load capture.html;
// only they reach the capture:… handlers here.

import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen, systemPreferences, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatDate } from '../shared/dates';
import { acceleratorOf, appendUnder, captureLines, captureNotePath, keyWords, noteText, planCapture, screenshotName, taskLine, type CaptureContext, type CaptureKind, type CaptureProject, type CaptureSaved, type CaptureStatus, type NoProjectPlace, type SnipResult } from '../shared/capture';
import type { Prefs } from '../shared/prefs';
import { allowDictationMic, dictationHandlers, startDictation, type DictationDeps } from './dictation';

/** What a capture box needs from Ironleaf (src/main/app.ts gives it). */
export interface CaptureHost {
  kind: 'standalone' | 'embedded';
  dataDir: string;
  preload: string;
  renderer: { file: string; devUrl?: string };
  icon: string;
  prefs(): Prefs;
  setPrefs(patch: Partial<Prefs>): Promise<void>;
  /** Ironleaf's notes opened when they aren't yet (inside the former host app, before its window was ever opened). */
  ready(): Promise<void>;
  /** Every project, with what suggests it, and its folder on this PC when that is there. */
  projects(): Promise<(CaptureProject & { pcFolder: string | null })[]>;
  /** Changing notes needs the licence once it is enforced. */
  requireCreate(): Promise<void>;
  /** A next step added through the project's own edit (one history, Undo on its page too). */
  /** Its undo answers words only when it couldn't be undone. */
  addNextStep(project: string, item: { what: string; when?: string; more?: string }): Promise<{ file: string; undo: () => Promise<string | void> }>;
  readNote(rel: string): Promise<string | null>;
  writeNote(rel: string, text: string): Promise<void>;
  removeFile(rel: string): Promise<void>;
  /** A free name for a new note in a folder of the library. */
  freeNote(folder: string, title: string): Promise<string>;
  /** Today's note (made from its template when it isn't there yet) and its path without making it. */
  dailyNote(): Promise<string>;
  dailyPath(): string;
  attachmentsFor(note: string): string;
  /** A file into a library folder under a free name (a picture's bytes, or a file copied from the PC). */
  saveFile(folder: string, name: string, from: Buffer | string): Promise<string>;
  /** Files into the asset store (copied), its folders and index kept. */
  addAssets(paths: string[]): Promise<string[]>;
  removeAsset(rel: string): Promise<void>;
  /** How a link to `rel` is written from the note at `from` (Settings › Files and links). */
  link(rel: string, from: string): string;
  /** Ironleaf's window, at a note or project. */
  open(target: { note?: string }): Promise<void>;
  log(message: string): void;
  /** Dictation heard by the former host app (8.6 voice, second pass): the box dictates through it when inside the former
host app. */
  dictate: DictationDeps;
}

interface Picture {
  id: string;
  png: Buffer;
  name: string;
}

interface SaveRequest {
  kind: CaptureKind;
  text: string;
  project: string | null;
  pictures: string[];
  files: string[];
  toAssets: boolean;
  ignoreDue: boolean;
}

const CHANNEL = (name: string) => 'nv:' + name;
const WIDTH = 680;
/** Room around the box for its shadow (the window is transparent there). */
const MARGIN = 44;

/** The window the person was in: the first ordinary window under Ironleaf's own (by z-order), its title. */
const WINDOW_SCRIPT = [
  "Add-Type -TypeDefinition @'",
  'using System; using System.Text; using System.Runtime.InteropServices;',
  'public static class NVCaptureWindows {',
  '  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);',
  '  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);',
  '  public static string Below(uint self) {',
  '    IntPtr h = GetTopWindow(IntPtr.Zero);',
  '    for (int i = 0; h != IntPtr.Zero && i < 500; i++, h = GetWindow(h, 2)) {',
  '      if (!IsWindowVisible(h)) continue;',
  '      int ex = GetWindowLong(h, -20);',
  '      if ((ex & 0x88) != 0) continue;',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      if (pid == self) continue;',
  '      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) continue;',
  '      var b = new StringBuilder(512); if (GetWindowText(h, b, 512) == 0) continue;',
  '      var t = b.ToString(); if (t == "Program Manager") continue;',
  '      return t;',
  '    }',
  '    return "";',
  '  }',
  '}',
  "'@",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `[NVCaptureWindows]::Below(${process.pid})`,
].join('\n');

async function windowBelow(): Promise<string | null> {
  // NV_CAPTURE_TEST_WINDOW (tools/shots-capture.mjs only, never set in the product): a file holding the title of a
  // made-up window the person was in.
  const test = !app.isPackaged ? process.env.NV_CAPTURE_TEST_WINDOW : undefined;
  if (test) return (await fsp.readFile(test, 'utf8').catch(() => '')).trim() || null;
  if (process.platform !== 'win32') return null;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WINDOW_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (error, stdout) => {
      const title = error ? '' : String(stdout ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '';
      resolve(title && title.length < 400 ? title : null);
    });
  });
}

export class QuickCapture {
  private box: BrowserWindow | null = null;
  private snipWin: BrowserWindow | null = null;
  private held: string | null = null;
  private status: CaptureStatus = { on: false, key: '', words: '', state: 'off' };
  private pictures = new Map<string, Picture>();
  private undos = new Map<string, () => Promise<string>>();
  private windowTitle: string | null = null;
  private snipDone: ((rect: { x: number; y: number; width: number; height: number } | null) => void) | null = null;
  private snipImage: { file: string; image: NativeImage; bounds: Electron.Rectangle } | null = null;
  private stopped = false;
  private registered = false;

  constructor(private readonly host: CaptureHost) {}

  // ——— The key ————————————————————————————————————————————————————————————————————————————————————————————————————

  /** Holds the key in Settings (again after a change); lets go of the one held before. */
  applyKey(): CaptureStatus {
    if (this.stopped) return this.status;
    const raw = this.host.prefs().captureKey;
    const key = raw ? acceleratorOf(raw) : null;
    if (this.held && this.held !== key) {
      try {
        globalShortcut.unregister(this.held);
      } catch {
        // Already gone.
      }
      this.held = null;
    }
    if (!raw) return (this.status = { on: false, key: '', state: 'off', words: 'Quick capture is off. Choose keys to switch it on.' });
    if (!key) return (this.status = { on: false, key: raw, state: 'invalid', words: 'Those keys can’t open Quick capture: use Ctrl, Alt or the Windows key with another key.' });
    const words = keyWords(key);
    if (this.held === key) return this.status;
    // Held already in this app (inside the former host app: The former host app's own key to come forward):
    // never taken from it.
    if (globalShortcut.isRegistered(key)) {
      return (this.status = { on: false, key, state: 'taken-here', words: `${words} is in use in Ironleaf already. Choose other keys.` });
    }
    let ok = false;
    try {
      ok = globalShortcut.register(key, () => void this.toggle());
    } catch {
      ok = false;
    }
    if (!ok) return (this.status = { on: false, key, state: 'taken', words: `Another app on this PC uses ${words}. Choose other keys for Quick capture.` });
    this.held = key;
    return (this.status = { on: true, key, state: 'ready', words: `Press ${words} anywhere in Windows to capture a note, a task or a screenshot.` });
  }

  view(): CaptureStatus {
    return this.status;
  }

  /** Lets go of the key and closes the box (Ironleaf stopping, or on its own its window closing). */
  stop(): void {
    this.stopped = true;
    if (this.held) {
      try {
        globalShortcut.unregister(this.held);
      } catch {
        // Already gone.
      }
      this.held = null;
    }
    for (const w of [this.box, this.snipWin]) if (w && !w.isDestroyed()) w.destroy();
    this.box = this.snipWin = null;
  }

  // ——— The box ————————————————————————————————————————————————————————————————————————————————————————————————————

  private trusted(event: IpcMainInvokeEvent): boolean {
    const ok = [this.box, this.snipWin].some((w) => w && !w.isDestroyed() && event.sender === w.webContents);
    if (!ok) return false;
    const url = event.senderFrame?.url ?? '';
    return this.host.renderer.devUrl ? url.startsWith(this.host.renderer.devUrl) : url.startsWith('file://');
  }

  private send(channel: string, payload: unknown, to = this.box): void {
    if (to && !to.isDestroyed()) to.webContents.send(CHANNEL(channel), payload);
  }

  /** The handlers only the capture windows reach (and the main window's few: open the box, its status). */
  register(handleMain: (channel: string, fn: (...args: any[]) => unknown) => void): void {
    if (this.registered) return;
    this.registered = true;
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      ipcMain.handle(CHANNEL(name), async (event, ...args) => {
        if (!this.trusted(event)) throw new Error('Request refused.');
        return fn(...args);
      });
    handle('capture:context', () => this.context());
    handle('capture:save', (request: unknown) => this.save(request));
    handle('capture:undo', (id: unknown) => this.undo(id));
    handle('capture:open', async (target: unknown) => {
      this.hide();
      if (typeof target === 'string' && target) await this.host.open({ note: target });
    });
    handle('capture:close', () => this.hide());
    handle('capture:resize', (height: unknown) => this.resize(height));
    handle('capture:snip', () => this.snip());
    handle('capture:add-picture', (data: unknown) => this.addPicture(data));
    handle('capture:drop-picture', (id: unknown) => {
      if (typeof id === 'string') this.pictures.delete(id);
    });
    handle('capture:dictate', () => {
      if (this.box && !this.box.isDestroyed()) this.box.focus();
      return startDictation();
    });
    // The box dictated through the former host app (8.6 voice, second pass): its own channels, heard the
    // same way.
    {
      const heard = dictationHandlers(this.host.dictate);
      handle('capture:dictate-status', () => heard.status());
      handle('capture:dictate-hear', (audio: unknown, mime: unknown) => heard.hear(audio, mime));
      handle('capture:dictate-chunk', (request: unknown) => heard.chunk(request));
      handle('capture:dictate-prepare', () => {
        if (this.box && !this.box.isDestroyed()) allowDictationMic([{ id: this.box.webContents.id, session: this.box.webContents.session } as never], this.host.kind !== 'embedded');
        return { prepared: true };
      });
    }
    handle('capture:remember', async (patch: unknown) => {
      const p = (patch && typeof patch === 'object' ? patch : {}) as { toAssets?: unknown };
      if (typeof p.toAssets === 'boolean') await this.host.setPrefs({ captureToAssets: p.toAssets });
    });
    // The snip window: its frozen screen, and the part chosen.
    handle('capture:snip-image', () => (this.snipImage ? { url: pathToFileURL(this.snipImage.file).href, width: this.snipImage.bounds.width, height: this.snipImage.bounds.height } : null));
    handle('capture:snip-done', (rect: unknown) => {
      const r = rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      const clean = r && [r.x, r.y, r.width, r.height].every((v) => Number.isFinite(n(v))) ? { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) } : null;
      this.snipDone?.(clean && clean.width >= 4 && clean.height >= 4 ? clean : null);
    });
    // From Ironleaf's own window: the box (the command, Settings' Try it) and how the key stands.
    handleMain('capture:show', () => this.show());
    handleMain('capture:status', () => this.status);
  }

  private createBox(): BrowserWindow {
    const w = new BrowserWindow({
      width: WIDTH + MARGIN * 2,
      height: 260,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'Quick capture',
      icon: this.host.icon,
      webPreferences: { preload: this.host.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: true },
    });
    w.setAlwaysOnTop(true, 'floating');
    w.removeMenu();
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (event, url) => {
      if (url !== w.webContents.getURL()) event.preventDefault();
    });
    w.on('closed', () => {
      if (this.box === w) this.box = null;
    });
    if (this.host.renderer.devUrl) void w.loadURL(`${this.host.renderer.devUrl.replace(/\/$/, '')}/capture.html`);
    else void w.loadFile(path.join(path.dirname(this.host.renderer.file), 'capture.html'));
    return w;
  }

  private place(w: BrowserWindow, height: number): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const width = Math.min(WIDTH + MARGIN * 2, area.width);
    const x = Math.round(area.x + (area.width - width) / 2);
    const y = Math.round(area.y + area.height * 0.2 - MARGIN);
    w.setBounds({ x, y, width, height: Math.min(Math.max(120, height), area.height - (y - area.y)) });
  }

  /** The box over whatever the person is doing: shown, or (pressed again while it has the keys) put away. */
  async toggle(): Promise<void> {
    if (this.box && !this.box.isDestroyed() && this.box.isVisible() && this.box.isFocused()) return this.hide();
    await this.show();
  }

  async show(): Promise<void> {
    if (this.stopped) return;
    // The window the person was in, read while the box comes up (it is under the box by then).
    const below = windowBelow().then((title) => {
      this.windowTitle = title;
      if (title) this.send('capture:window', title);
    });
    void below;
    await this.host.ready().catch((err) => this.host.log('Quick capture: ' + (err instanceof Error ? err.message : String(err))));
    if (!this.box || this.box.isDestroyed()) {
      this.box = this.createBox();
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        this.box!.webContents.once('did-finish-load', done);
        setTimeout(done, 4000);
      });
    }
    const w = this.box;
    if (!w.isVisible()) this.place(w, w.getBounds().height);
    this.send('capture:shown', { at: Date.now() });
    w.show();
    w.focus();
    w.webContents.focus();
  }

  hide(): void {
    if (this.box && !this.box.isDestroyed() && this.box.isVisible()) {
      this.box.hide();
      this.send('capture:hidden', null);
    }
  }

  private resize(height: unknown): void {
    if (!this.box || this.box.isDestroyed() || typeof height !== 'number' || !Number.isFinite(height)) return;
    const b = this.box.getBounds();
    const next = Math.round(Math.min(900, Math.max(80, height + MARGIN * 2)));
    if (next !== b.height) this.box.setBounds({ ...b, height: next });
  }

  private async context(): Promise<CaptureContext> {
    const prefs = this.host.prefs();
    let projects: (CaptureProject & { pcFolder: string | null })[] = [];
    try {
      projects = await this.host.projects();
    } catch {
      // No notes open: "No project" only.
    }
    return {
      projects: projects.map(({ pcFolder, ...p }) => ({ ...p, hasFolder: !!pcFolder })),
      recent: prefs.captureRecent,
      windowTitle: this.windowTitle,
      noProject: prefs.captureNoProject,
      toAssets: prefs.captureToAssets,
      key: this.status.on ? keyWords(this.status.key) : '',
      theme: prefs.theme,
      accent: prefs.accent,
      palette: prefs.palette,
      dailyName: formatDate('dddd D MMMM'),
      now: Date.now(),
      platform: process.platform,
      dictateMic: prefs.meetingMic || '',
      dictateClean: prefs.dictationClean !== false,
    };
  }

  // ——— Screenshot ————————————————————————————————————————————————————————————————————————————————————————————————

  /** A part of the screen, chosen by dragging over it (the box steps aside while the screen is taken). */
  private async snip(): Promise<SnipResult> {
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { words: 'Allow Ironleaf to record the screen in System Settings › Privacy & Security, then try again.' };
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const box = this.box;
    box?.hide();
    await new Promise((r) => setTimeout(r, 220));
    let image: NativeImage | null = null;
    try {
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      image = source && !source.thumbnail.isEmpty() ? source.thumbnail : null;
    } catch (err) {
      this.host.log('Quick capture screenshot: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (!image) {
      this.reshow(box);
      return { words: 'The screen couldn’t be captured just now. Try again, or use Windows key + Shift + S and paste.' };
    }
    const dir = path.join(this.host.dataDir, 'capture');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `screen-${randomUUID()}.png`);
    await fsp.writeFile(file, image.toPNG());
    this.snipImage = { file, image, bounds: display.bounds };
    const rect = await new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      this.snipDone = resolve;
      const w = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        backgroundColor: '#000000',
        title: 'Screenshot',
        webPreferences: { preload: this.host.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.removeMenu();
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.on('closed', () => {
        if (this.snipWin === w) this.snipWin = null;
        resolve(null);
      });
      w.once('ready-to-show', () => {
        w.setBounds(display.bounds);
        w.show();
        w.focus();
      });
      this.snipWin = w;
      if (this.host.renderer.devUrl) void w.loadURL(`${this.host.renderer.devUrl.replace(/\/$/, '')}/capture.html#snip`);
      else void w.loadFile(path.join(path.dirname(this.host.renderer.file), 'capture.html'), { hash: 'snip' });
    });
    this.snipDone = null;
    if (this.snipWin && !this.snipWin.isDestroyed()) this.snipWin.destroy();
    this.snipWin = null;
    void fsp.rm(file, { force: true });
    const full = this.snipImage?.image;
    this.snipImage = null;
    this.reshow(box);
    if (!rect || !full) return null;
    // The window's points to the picture's pixels.
    const size = full.getSize();
    const sx = size.width / display.bounds.width;
    const sy = size.height / display.bounds.height;
    const crop = { x: Math.max(0, Math.round(rect.x * sx)), y: Math.max(0, Math.round(rect.y * sy)), width: Math.round(rect.width * sx), height: Math.round(rect.height * sy) };
    crop.width = Math.min(crop.width, size.width - crop.x);
    crop.height = Math.min(crop.height, size.height - crop.y);
    if (crop.width < 2 || crop.height < 2) return null;
    const part = full.crop(crop);
    const id = randomUUID();
    const name = screenshotName(new Date());
    this.pictures.set(id, { id, png: part.toPNG(), name });
    const thumb = part.getSize().width > 480 ? part.resize({ width: 480, quality: 'good' }) : part;
    return { id, name, thumb: thumb.toDataURL(), width: crop.width, height: crop.height };
  }

  private reshow(box: BrowserWindow | null): void {
    if (box && !box.isDestroyed()) {
      box.show();
      box.focus();
      box.webContents.focus();
    }
  }

  /** A picture pasted into the box (a Windows key + Shift + S snip, a copied image): kept as a snip is, as PNG. */
  private addPicture(data: unknown): SnipResult {
    if (!(data instanceof Uint8Array) || data.byteLength > 50 * 1024 * 1024) return { words: 'That picture couldn’t be added.' };
    const image = nativeImage.createFromBuffer(Buffer.from(data));
    if (image.isEmpty()) return { words: 'That picture couldn’t be read.' };
    const id = randomUUID();
    const name = screenshotName(new Date());
    this.pictures.set(id, { id, png: image.toPNG(), name });
    const thumb = image.getSize().width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
    return { id, name, thumb: thumb.toDataURL(), ...image.getSize() };
  }

  // ——— Filing ————————————————————————————————————————————————————————————————————————————————————————————————————

  private cleanRequest(raw: unknown): SaveRequest {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      kind: r.kind === 'task' ? 'task' : 'note',
      text: typeof r.text === 'string' ? r.text.slice(0, 20000) : '',
      project: typeof r.project === 'string' && r.project ? r.project : null,
      pictures: Array.isArray(r.pictures) ? r.pictures.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
      files: Array.isArray(r.files) ? r.files.filter((x): x is string => typeof x === 'string' && path.isAbsolute(x)).slice(0, 50) : [],
      toAssets: r.toAssets === true,
      ignoreDue: r.ignoreDue === true,
    };
  }

  async save(raw: unknown): Promise<CaptureSaved> {
    await this.host.requireCreate();
    const req = this.cleanRequest(raw);
    const now = new Date();
    const projects = await this.host.projects().catch(() => [] as (CaptureProject & { pcFolder: string | null })[]);
    const chosen = req.project ? projects.find((p) => p.path === req.project) : null;
    if (req.project && !chosen) throw new Error('That project isn’t there any more. Choose another, or No project.');
    const pictures = req.pictures.map((id) => this.pictures.get(id)).filter((p): p is Picture => !!p);
    const files: string[] = [];
    for (const f of req.files) {
      const stat = await fsp.stat(f).catch(() => null);
      if (stat?.isFile() && stat.size <= 500 * 1024 * 1024) files.push(f);
    }
    const prefs = this.host.prefs();
    const noProject: NoProjectPlace = prefs.captureNoProject;
    const plan = planCapture({
      kind: req.kind,
      text: req.text,
      project: chosen ? { path: chosen.path, name: chosen.name, pcFolder: chosen.pcFolder } : null,
      pictures: pictures.length,
      files: files.length,
      toAssets: req.toAssets,
      noProject,
      dailyPath: this.host.dailyPath(),
      inboxPath: 'Inbox.md',
      attachmentsFor: (note) => this.host.attachmentsFor(note),
      now,
      ignoreDue: req.ignoreDue,
    });
    if (!plan.nextStep && !plan.newNote && !plan.append && !plan.attach) throw new Error(req.kind === 'task' ? 'Write the task first.' : 'Write something, or add a screenshot or a file.');
    // What was done, to undo it together (in the order it is undone).
    const undo: (() => Promise<string | void>)[] = [];
    const notePath = plan.newNote ? await this.host.freeNote(plan.newNote.folder, plan.newNote.title) : plan.append ? (plan.append.place === 'daily' ? await this.host.dailyNote() : plan.append.path) : null;
    // Pictures and files first (the note links them).
    const placed: string[] = [];
    const embeds: string[] = [];
    if (plan.attach) {
      const all: { name: string; from: Buffer | string }[] = [...pictures.map((p) => ({ name: p.name, from: p.png })), ...files.map((f) => ({ name: path.basename(f), from: f }))];
      if (plan.attach.place === 'assets') {
        const dir = path.join(this.host.dataDir, 'capture');
        await fsp.mkdir(dir, { recursive: true });
        const temps: string[] = [];
        for (const item of all) {
          if (typeof item.from === 'string') temps.push(item.from);
          else {
            const sub = path.join(dir, randomUUID());
            await fsp.mkdir(sub);
            const t = path.join(sub, item.name);
            await fsp.writeFile(t, item.from);
            temps.push(t);
          }
        }
        try {
          const added = await this.host.addAssets(temps);
          placed.push(...added);
          for (const rel of added) undo.push(() => this.host.removeAsset(rel));
        } finally {
          for (const t of temps) if (t.startsWith(dir)) void fsp.rm(path.dirname(t), { recursive: true, force: true });
        }
      } else if (plan.attach.place === 'pc') {
        const folder = plan.attach.folder;
        await fsp.mkdir(folder, { recursive: true });
        for (const item of all) {
          const abs = await freeFile(folder, item.name);
          if (typeof item.from === 'string') await fsp.copyFile(item.from, abs, fsConstants.COPYFILE_EXCL);
          else await fsp.writeFile(abs, item.from, { flag: 'wx' });
          placed.push(abs);
          undo.push(() => fsp.rm(abs, { force: true }));
        }
      } else {
        for (const item of all) {
          const rel = await this.host.saveFile(plan.attach.folder, item.name, item.from);
          placed.push(rel);
          undo.push(() => this.host.removeFile(rel));
        }
      }
      if (notePath && plan.attach.place !== 'pc') for (const rel of placed) embeds.push((/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(rel) ? '!' : '') + this.host.link(rel, notePath));
    }
    let words = '';
    let detail = '';
    let open: string | null = null;
    // Whole words: capture details wrap where they show (t207 pass 2).
    const short = (s: string, _max = 70) => s;
    if (plan.nextStep && chosen) {
      const step = await this.host.addNextStep(chosen.path, { what: plan.nextStep.what, ...(plan.nextStep.when ? { when: plan.nextStep.when } : {}), ...(plan.nextStep.more ? { more: plan.nextStep.more } : {}) });
      undo.push(step.undo);
      words = `Added to ${chosen.name}’s next steps`;
      detail = `“${short(plan.nextStep.what)}”${plan.due ? ` · by ${plan.due.words}` : ''}`;
      open = step.file;
    }
    const time = formatDate(prefs.timeFormat || 'HH:mm', now);
    if (plan.newNote && notePath) {
      // A note of this name is already there: grow it instead of a " 2".
      const mine = captureNotePath(plan.newNote.folder, plan.newNote.title);
      const prior = await this.host.readNote(mine);
      if (prior !== null && prior !== undefined) {
        const after = appendUnder(prior, captureLines(req.text, time, embeds));
        await this.host.writeNote(mine, after);
        undo.push(async () => {
          if ((await this.host.readNote(mine)) === after) await this.host.writeNote(mine, prior);
          else return 'The note was changed since, so the capture was left in it.';
        });
        words = `Added to ${mine.split('/').pop()!.replace(/\.md$/i, '')}`;
        detail = `in ${chosen?.name ?? 'your notes'}`;
        open = mine;
      } else {
        const text = noteText(req.text, embeds, chosen?.name ?? null, formatDate('YYYY-MM-DD HH:mm', now));
        await this.host.writeNote(notePath, text);
        undo.push(async () => {
          if ((await this.host.readNote(notePath)) === text) await this.host.removeFile(notePath);
          else return 'The note was changed since, so it was kept.';
        });
        words = `Saved in ${chosen?.name ?? 'your notes'}`;
        detail = `${notePath.split('/').pop()!.replace(/\.md$/i, '')}${pictures.length ? ` · with ${pictures.length === 1 ? 'the screenshot' : `${pictures.length} screenshots`}` : ''}`;
        open = notePath;
      }
    }
    if (plan.append && notePath) {
      const before = (await this.host.readNote(notePath)) ?? '';
      const lines = req.kind === 'task' && plan.what ? [taskLine(plan.what, plan.due, plan.rest), ...embeds.map((e) => `  ${e}`)] : captureLines(req.text, time, embeds);
      const after = appendUnder(before, lines);
      await this.host.writeNote(notePath, after);
      undo.push(async () => {
        if ((await this.host.readNote(notePath)) === after) await this.host.writeNote(notePath, before);
        else return 'The note was changed since, so the capture was left in it.';
      });
      const place = plan.append.place === 'daily' ? 'today’s note' : 'your Inbox';
      words = `Added to ${place}`;
      detail = req.kind === 'task' && plan.what ? `“${short(plan.what)}”${plan.due ? ` · by ${plan.due.words}` : ''}` : req.text.trim() ? `“${short(req.text.trim().split('\n')[0])}”` : pictures.length ? 'The screenshot' : `${files.length} file${files.length === 1 ? '' : 's'}`;
      open = notePath;
    }
    if (plan.attach && !plan.newNote && !plan.append) {
      const what = pictures.length && !files.length ? (pictures.length === 1 ? 'Screenshot' : 'Screenshots') : 'Files';
      const where = plan.attach.place === 'assets' ? 'your assets' : `${chosen?.name ?? 'the project'}’s folder › Captures`;
      if (words) detail += ` · ${what.toLowerCase()} in ${where}`;
      else {
        words = `${what} saved in ${where}`;
        detail = placed.map((p) => p.split(/[\\/]/).pop()).join(', ');
        open = plan.attach.place === 'assets' ? placed[0] ?? null : chosen?.path ?? null;
      }
    } else if (plan.attach?.place === 'assets' && placed.length) detail += ` · in your assets`;
    // The pictures stay until the box lets go of its draft (Undo brings the draft back with them); at most a few.
    while (this.pictures.size > 24) this.pictures.delete(this.pictures.keys().next().value!);
    if (chosen) void this.host.setPrefs({ captureRecent: [chosen.path, ...prefs.captureRecent.filter((p) => p !== chosen.path)].slice(0, 6) });
    const id = randomUUID();
    this.undos.set(id, async () => {
      const said: string[] = [];
      for (const step of undo.reverse()) {
        try {
          const w = await step();
          if (typeof w === 'string' && w) said.push(w);
        } catch (err) {
          said.push(err instanceof Error ? err.message : String(err));
        }
      }
      return said.length ? said[0] : 'Undone.';
    });
    while (this.undos.size > 10) this.undos.delete(this.undos.keys().next().value!);
    return { words, detail, open, undo: id };
  }

  private async undo(id: unknown): Promise<string> {
    const fn = typeof id === 'string' ? this.undos.get(id) : undefined;
    if (!fn) return 'That capture can’t be undone any more.';
    this.undos.delete(id as string);
    await this.host.requireCreate();
    return fn();
  }
}

/** A free file name in a folder on the PC: "Name.png", else "Name 1.png"… */
async function freeFile(folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 10000; i++) {
    const abs = path.join(folder, `${i ? `${base} ${i}` : base}${ext}`);
    const there = await fsp.access(abs).then(() => true, () => false);
    if (!there) return abs;
  }
  throw new Error('No free name was found.');
}
