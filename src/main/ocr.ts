// Words in pictures and scans (9.0 w123ocr, 31 Oct 2026: rivals find the words in pictures and scans, so the Vault
// does too): what the main side keeps. Windows' own built-in text recogniser (Windows.Media.Ocr, part of Windows 10
// and 11: nothing to download, no account, no company's approval) reads pictures among the notes and the pages of PDFs
// with no text layer. It only exists on Windows, so it sits behind the OcrEngine seam (a function that takes an image
// and returns lines with boxes); the tests drive a fake one, and tools/ocr-probe.mjs proves the Windows part on a real
// PC. Reading runs in the background, one file at a time with a breath between (gentle on the PC), resumes after a
// restart from what is kept, and never changes a file itself: what was read lives in Ironleaf's own data. Private
// notes are never read and never found (the vault never lists them; the queue and search refuse them anyway). Reached
// the way Ironleaf already reaches Windows features: one PowerShell call per picture or page.

import { execFile } from 'node:child_process';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { isOcrImage, normaliseBox, OCR_LIMITS, ocrEntryText, type OcrBox, type OcrEntry, type OcrHit, type OcrLanguage, type OcrLine, type OcrStatus } from '../shared/ocr';
import { isPrivatePath } from '../shared/private';
import { parseQuery, QueryMatcher } from '../shared/query';

export { isOcrImage };

// ── The seam: a recogniser ──────────────────────────────────────────────────────────────────────────────────────────

export interface OcrPxWord {
  text: string;
  box: [number, number, number, number];
}

export interface OcrPxLine {
  text: string;
  box: [number, number, number, number];
  words: OcrPxWord[];
}

/** What the recogniser read: the picture's size in pixels, and its lines with boxes in pixels. */
export interface OcrRead {
  width: number;
  height: number;
  lines: OcrPxLine[];
  lang?: string;
}

export type OcrAvailability = { ok: true } | { ok: false; reason: string };

export interface OcrEngine {
  /** Whether the recogniser is on this PC and ready ('not-windows', 'no-ocr' or 'no-languages' when not). */
  available(): Promise<OcrAvailability>;
  /** The languages Windows has for it. */
  languages(): Promise<OcrLanguage[]>;
  /** A picture's words (lang '' is automatic). */
  readImage(abs: string, lang: string): Promise<OcrRead>;
  /** One PDF page's words (page counted from 1 as people do). */
  readPdfPage(abs: string, page: number, lang: string): Promise<OcrRead>;
}

/** The recogniser only exists on Windows (Windows.Media.Ocr). */
export const ocrSupported = (platform: NodeJS.Platform = process.platform): boolean => platform === 'win32';

// One PowerShell program for every call (languages, one picture, one PDF page), run with -EncodedCommand so no path or
// word ever needs quoting: its arguments arrive as base64 JSON in __ARGS__. It always prints one JSON line on stdout
// ({ok:true,…} or {ok:false,error}) and exits 0; anything else (no PowerShell, killed) is a failure outside it.
const OCR_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Out($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 8 -Compress)) }
function Cut($s, $n) { $m = [string]$s; if ($m.Length -gt $n) { $m.Substring(0, $n) } else { $m } }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $a = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__ARGS__')) | ConvertFrom-Json
} catch {
  Out @{ ok = $false; error = 'not-windows' }
  exit 0
}
function WinType([string]$name) {
  $ns = $name.Substring(0, $name.LastIndexOf('.'))
  foreach ($f in @("$name, $ns, ContentType=WindowsRuntime", $name)) {
    try { $t = [type]$f; if ($t -ne $null) { return $t } } catch {}
  }
  return $null
}
# Windows' async steps are waited on as .NET tasks: Windows PowerShell 5.1 cannot read .Status on a raw WinRT
# operation (it reads empty, so polling it waited forever: every picture timed out; found on a real PC, 31 Oct 2026).
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' -and $_.GetParameters()[0].ParameterType.Name -notlike '*WithProgress*' })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, $type, [int]$timeoutMs) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($timeoutMs)) { throw 'timed out' }
  return $task.Result
}
function AwaitAction($op, [int]$timeoutMs) {
  $task = $asTaskAction.Invoke($null, @($op))
  if (-not $task.Wait($timeoutMs)) { throw 'timed out' }
}
try {
  $ocrType = WinType 'Windows.Media.Ocr.OcrEngine'
  if ($ocrType -eq $null) { Out @{ ok = $true; available = $false; reason = 'no-ocr'; languages = @() }; exit 0 }
  $langs = @($ocrType::AvailableRecognizerLanguages | ForEach-Object { @{ tag = [string]$_.LanguageTag; name = [string]$_.DisplayName } })
  if ($a.mode -eq 'languages') {
    Out @{ ok = $true; available = ($langs.Count -gt 0); reason = $(if ($langs.Count -gt 0) { '' } else { 'no-languages' }); languages = $langs }
    exit 0
  }
  if ($langs.Count -eq 0) { Out @{ ok = $false; error = 'no-languages' }; exit 0 }
  $engine = $null
  if ([string]$a.lang) {
    $match = @($ocrType::AvailableRecognizerLanguages | Where-Object { [string]$_.LanguageTag -eq [string]$a.lang })
    if ($match.Count -gt 0) { $engine = $ocrType::TryCreateFromLanguage($match[0]) }
  }
  if ($engine -eq $null) { try { $engine = $ocrType::TryCreateFromUserProfileLanguages() } catch {} }
  if ($engine -eq $null) { $engine = $ocrType::TryCreateFromLanguage(@($ocrType::AvailableRecognizerLanguages)[0]) }
  if ($engine -eq $null) { Out @{ ok = $false; error = 'no-engine' }; exit 0 }
  $storType = WinType 'Windows.Storage.StorageFile'
  $file = Await ($storType::GetFileFromPathAsync([string]$a.file)) $storType 60000
  $decType = WinType 'Windows.Graphics.Imaging.BitmapDecoder'
  if ($a.mode -eq 'pdf') {
    $pdfType = WinType 'Windows.Data.Pdf.PdfDocument'
    if ($pdfType -eq $null) { Out @{ ok = $false; error = 'no-pdf' }; exit 0 }
    $doc = Await ($pdfType::LoadFromFileAsync($file)) $pdfType 120000
    if ([int]$a.page -lt 1 -or [int]$a.page -gt $doc.PageCount) { Out @{ ok = $false; error = 'no-such-page' }; exit 0 }
    $pg = $doc.GetPage([uint32]([int]$a.page - 1))
    $mem = New-Object 'Windows.Storage.Streams.InMemoryRandomAccessStream'
    $opt = $null
    try {
      $opt = New-Object 'Windows.Data.Pdf.PdfPageRenderOptions'
      try { $bg = New-Object 'Windows.UI.Color'; $bg.A = 255; $bg.R = 255; $bg.G = 255; $bg.B = 255; $opt.BackgroundColor = $bg } catch {}
      $w = [Math]::Min(2800, [int]($pg.Size.Width * 300 / 96))
      $h = [int]($w * $pg.Size.Height / [Math]::Max(1, $pg.Size.Width))
      if ($h -gt 2800) { $h = 2800; $w = [int]($h * $pg.Size.Width / [Math]::Max(1, $pg.Size.Height)) }
      $opt.DestinationWidth = [uint32][Math]::Max(1, $w)
      $opt.DestinationHeight = [uint32][Math]::Max(1, $h)
    } catch { $opt = $null }
    if ($opt -ne $null) { AwaitAction ($pg.RenderToStreamAsync($mem, $opt)) 120000 } else { AwaitAction ($pg.RenderToStreamAsync($mem)) 120000 }
    $mem.Seek(0) | Out-Null
    $decoder = Await ($decType::CreateAsync($mem)) $decType 120000
  } else {
    $stream = Await ($file.OpenAsync(0)) (WinType 'Windows.Storage.Streams.IRandomAccessStream') 60000
    $decoder = Await ($decType::CreateAsync($stream)) $decType 120000
  }
  $sb = Await ($decoder.GetSoftwareBitmapAsync()) (WinType 'Windows.Graphics.Imaging.SoftwareBitmap') 120000
  try {
    $sbType = WinType 'Windows.Graphics.Imaging.SoftwareBitmap'
    $sb = $sbType::Convert($sb, (WinType 'Windows.Graphics.Imaging.BitmapPixelFormat')::Bgra8, (WinType 'Windows.Graphics.Imaging.BitmapAlphaMode')::Premultiplied)
  } catch {}
  $maxDim = 0
  try { $maxDim = [int]$ocrType::MaxImageDimension } catch {}
  if ($maxDim -gt 0 -and [Math]::Max($sb.PixelWidth, $sb.PixelHeight) -gt $maxDim) {
    Out @{ ok = $false; error = 'too-big'; width = [int]$sb.PixelWidth; height = [int]$sb.PixelHeight }
    exit 0
  }
  $res = Await ($engine.RecognizeAsync($sb)) (WinType 'Windows.Media.Ocr.OcrResult') 120000
  $lines = @($res.Lines | ForEach-Object {
    $lr = $_.BoundingRect
    @{ text = [string]$_.Text; box = @([int]$lr.X, [int]$lr.Y, [int]$lr.Width, [int]$lr.Height); words = @($_.Words | ForEach-Object { $wr = $_.BoundingRect; @{ text = [string]$_.Text; box = @([int]$wr.X, [int]$wr.Y, [int]$wr.Width, [int]$wr.Height) } }) }
  })
  Out @{ ok = $true; width = [int]$sb.PixelWidth; height = [int]$sb.PixelHeight; lang = [string]$engine.RecognizerLanguage.LanguageTag; lines = $lines }
} catch {
  Out @{ ok = $false; error = Cut $_.Exception.Message 300 }
}
`.trim();

export type PsRun = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

/** PowerShell run the way Ironleaf runs it everywhere (capture.ts, dictation.ts): hidden, with a timeout. */
export const runPowerShell: PsRun = (args) =>
  new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 150_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
    );
  });

const cleanLang = (tag: unknown): OcrLanguage | null => {
  const t = tag as { tag?: unknown; name?: unknown } | null;
  if (!t || typeof t.tag !== 'string' || !t.tag || typeof t.name !== 'string' || !t.name) return null;
  return { tag: t.tag.slice(0, 40), name: t.name.slice(0, 120) };
};

const cleanBox = (box: unknown): [number, number, number, number] | null =>
  Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [box[0], box[1], box[2], box[3]] : null;

function cleanRead(raw: unknown): OcrRead {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lines: OcrPxLine[] = [];
  if (Array.isArray(r.lines)) {
    for (const l of r.lines.slice(0, 2000)) {
      const line = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const box = cleanBox(line.box);
      if (typeof line.text !== 'string' || !box) continue;
      const words: OcrPxWord[] = [];
      if (Array.isArray(line.words)) {
        for (const w of line.words.slice(0, 200)) {
          const word = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
          const wb = cleanBox(word.box);
          if (typeof word.text !== 'string' || !wb) continue;
          words.push({ text: word.text.slice(0, 200), box: wb });
        }
      }
      lines.push({ text: line.text.slice(0, 2000), box, words });
    }
  }
  return {
    width: typeof r.width === 'number' && r.width > 0 ? Math.floor(r.width) : 0,
    height: typeof r.height === 'number' && r.height > 0 ? Math.floor(r.height) : 0,
    lines,
    ...(typeof r.lang === 'string' && r.lang ? { lang: r.lang.slice(0, 40) } : {}),
  };
}

/** Windows' own recogniser, reached through PowerShell (capture.ts runs it the same way). Off Windows it says so. */
export class WindowsOcrEngine implements OcrEngine {
  private langs: OcrLanguage[] | null = null;
  private failed: string | null = null;
  constructor(
    private readonly run: PsRun = runPowerShell,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  private async call(mode: 'languages' | 'image' | 'pdf', args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payload = Buffer.from(JSON.stringify({ mode, ...args }), 'utf8').toString('base64');
    const script = OCR_PS.replace('__ARGS__', payload);
    const { stdout } = await this.run(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    const line = String(stdout ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '';
    const parsed = JSON.parse(line || '{}') as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') throw new Error('The recogniser’s answer couldn’t be read.');
    return parsed;
  }

  async available(): Promise<OcrAvailability> {
    if (!ocrSupported(this.platform)) return { ok: false, reason: 'not-windows' };
    if (this.failed) return { ok: false, reason: this.failed };
    try {
      const r = await this.call('languages', {});
      if (r.ok !== true) {
        this.failed = 'no-ocr';
        return { ok: false, reason: 'no-ocr' };
      }
      this.langs = Array.isArray(r.languages) ? (r.languages.map(cleanLang).filter((l): l is OcrLanguage => !!l).slice(0, 60)) : [];
      if (r.available !== true || !this.langs.length) return { ok: false, reason: typeof r.reason === 'string' && r.reason ? r.reason : 'no-languages' };
      return { ok: true };
    } catch {
      this.failed = 'no-ocr';
      return { ok: false, reason: 'no-ocr' };
    }
  }

  async languages(): Promise<OcrLanguage[]> {
    if (!ocrSupported(this.platform)) return [];
    await this.available();
    return this.langs ?? [];
  }

  private async read(mode: 'image' | 'pdf', abs: string, lang: string, page?: number): Promise<OcrRead> {
    if (!ocrSupported(this.platform)) throw new Error('not-windows');
    const r = await this.call(mode, { file: abs, lang, ...(page !== undefined ? { page } : {}) });
    if (r.ok !== true) throw new Error(typeof r.error === 'string' && r.error ? r.error : 'The recogniser failed.');
    return cleanRead(r);
  }

  readImage(abs: string, lang: string): Promise<OcrRead> {
    return this.read('image', abs, lang);
  }

  readPdfPage(abs: string, page: number, lang: string): Promise<OcrRead> {
    return this.read('pdf', abs, lang, page);
  }
}

// ── What was read, kept ─────────────────────────────────────────────────────────────────────────────────────────────

const STORE_VERSION = 1;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** What was read for one vault, kept in Ironleaf's own data (never among the notes). */
export class OcrStore {
  private entries = new Map<string, OcrEntry>();
  private timer: NodeJS.Timeout | undefined;
  private loaded = false;

  constructor(private readonly dir: string) {}

  private file(): string {
    return path.join(this.dir, 'entries.json');
  }

  /** Read from what was kept (or empty when nothing was). */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const kept = JSON.parse(readFileSync(this.file(), 'utf8')) as { v?: number; entries?: OcrEntry[] };
      if (kept.v === STORE_VERSION && Array.isArray(kept.entries)) {
        for (const e of kept.entries) {
          if (e && typeof e.rel === 'string' && typeof e.mtime === 'number' && typeof e.size === 'number' && typeof e.state === 'string') this.entries.set(e.rel.toLowerCase(), e);
        }
      }
    } catch {
      // Nothing kept yet (or it couldn't be read): read from the start.
    }
  }

  get(rel: string): OcrEntry | undefined {
    this.load();
    return this.entries.get(rel.toLowerCase());
  }

  set(entry: OcrEntry): void {
    this.load();
    this.entries.set(entry.rel.toLowerCase(), entry);
    this.schedule();
  }

  delete(rel: string): void {
    this.load();
    if (this.entries.delete(rel.toLowerCase())) this.schedule();
  }

  clear(): void {
    this.load();
    if (this.entries.size) {
      this.entries.clear();
      this.schedule();
    }
  }

  all(): OcrEntry[] {
    this.load();
    return [...this.entries.values()];
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save();
    }, 2000);
    this.timer.unref?.();
  }

  async save(): Promise<void> {
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      const target = this.file();
      await fsp.writeFile(`${target}.part`, JSON.stringify({ v: STORE_VERSION, entries: [...this.entries.values()] }));
      await fsp.rename(`${target}.part`, target);
    } catch {
      // Kept again next time; reading carries on.
    }
  }

  /** Whatever is waiting is written now (the vault closing). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      await this.save();
    }
  }
}

// ── Reading in the background ───────────────────────────────────────────────────────────────────────────────────────

export interface OcrQueueFile {
  rel: string;
  abs: string;
  mtime: number;
  size: number;
  kind: 'image' | 'pdf';
}

export interface OcrQueueOptions {
  store: OcrStore;
  engine: OcrEngine;
  /** A PDF's pages, and which have no words (the app reads them with its PDF reader). */
  pdfPages(abs: string): Promise<{ pages: number; empty: boolean[] }>;
  /** Settings: on, and the language chosen ('' is automatic). */
  prefs(): { on: boolean; lang: string };
  onStatus?(status: OcrStatus): void;
  /** The breath between files, gentle on the PC (a test shortens it). */
  gapMs?: number;
  log?(message: string): void;
}

interface Unit {
  file: OcrQueueFile;
  /** A PDF's page, counted from 1 (a picture's is 1). */
  page: number;
}

/** A failed read is tried again after this long (9.2: a file Windows couldn't open is retried weekly, not written
 *  off forever — and not tried again and again). */
export const OCR_FAILED_RETRY_MS = 7 * 24 * 3600 * 1000;

/** Whether what was kept for a file still stands (its words, or every scanned page's). */
function entryFresh(entry: OcrEntry | undefined, file: OcrQueueFile): boolean {
  if (!entry || entry.mtime !== file.mtime || entry.size !== file.size) return false;
  if (entry.state === 'failed') return entry.at !== undefined && Date.now() - entry.at < OCR_FAILED_RETRY_MS;
  if (file.kind === 'image') return entry.state === 'words' || entry.state === 'big';
  if (entry.state === 'clear' || entry.state === 'big') return true;
  if (entry.state !== 'words' || !entry.scanned) return false;
  const have = new Set(Object.keys(entry.pages ?? {}).map(Number));
  return entry.scanned.every((p) => have.has(p));
}

export class OcrQueue {
  private queue: Unit[] = [];
  private running = false;
  private done = 0;
  private todo = 0;
  private current: string | undefined;
  private statusTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private idleWaiters: (() => void)[] = [];
  private known = new Map<string, OcrQueueFile>();
  private availability: OcrAvailability | null = null;
  private languages: OcrLanguage[] | null = null;

  constructor(private readonly o: OcrQueueOptions) {}

  // ── What to read ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Brings the queue in line with the files among the notes: new and changed ones are read, gone ones forgotten. */
  scan(files: OcrQueueFile[]): void {
    if (this.stopped) return;
    const prefs = this.o.prefs();
    this.known = new Map(files.filter((f) => !isPrivatePath(f.rel)).map((f) => [f.rel.toLowerCase(), f]));
    // Gone from the notes (or private): forgotten.
    for (const e of this.o.store.all()) {
      if (!this.known.has(e.rel.toLowerCase())) this.o.store.delete(e.rel);
    }
    if (!prefs.on) {
      // Paused, not forgotten (9.2): switching it off and on keeps every reading (files gone from the notes are
      // already forgotten above).
      this.queue = [];
      this.emit(true);
      return;
    }
    for (const f of this.known.values()) this.enqueueFile(f);
    void this.pump();
    this.emit();
  }

  /** Everything read again from the start (Settings › General › Read again): the recogniser is asked again too, so a
   *  language installed since is found. */
  rebuild(files: OcrQueueFile[]): void {
    this.availability = null;
    this.languages = null;
    this.o.store.clear();
    this.scan(files);
  }

  /** One file added, changed or removed (null: removed). */
  noteChanged(file: OcrQueueFile | null, rel?: string): void {
    if (this.stopped) return;
    if (!file) {
      if (rel) {
        this.o.store.delete(rel);
        this.known.delete(rel.toLowerCase());
        this.queue = this.queue.filter((u) => u.file.rel.toLowerCase() !== rel.toLowerCase());
        this.emit();
      }
      return;
    }
    if (isPrivatePath(file.rel)) return;
    if (!this.o.prefs().on) return;
    this.known.set(file.rel.toLowerCase(), file);
    this.queue = this.queue.filter((u) => u.file.rel.toLowerCase() !== file.rel.toLowerCase());
    this.enqueueFile(file);
    void this.pump();
  }

  private enqueueFile(file: OcrQueueFile): void {
    if (file.kind === 'image') {
      const entry = this.o.store.get(file.rel);
      if (entryFresh(entry, file)) return;
      if (file.size > OCR_LIMITS.imageBytes) {
        this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'big' });
        return;
      }
      if (!this.queue.some((u) => u.file.rel.toLowerCase() === file.rel.toLowerCase())) {
        this.queue.push({ file, page: 1 });
        this.todo++;
      }
      return;
    }
    // A PDF: its scanned pages are found when its turn comes (reading it twice would waste the work).
    if (entryFresh(this.o.store.get(file.rel), file)) return;
    if (!this.queue.some((u) => u.file.rel.toLowerCase() === file.rel.toLowerCase() && u.page === -1)) {
      this.queue.push({ file, page: -1 });
      this.todo++;
    }
  }

  /** Resolves when nothing is waiting to be read. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.statusTimer);
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** The recogniser asked whether it is there (once per run: it doesn't come and go). */
  private async ensureAvailability(): Promise<void> {
    if (this.availability) return;
    try {
      this.availability = await this.o.engine.available();
      this.languages = this.availability.ok ? await this.o.engine.languages() : [];
    } catch {
      this.availability = { ok: false, reason: 'no-ocr' };
      this.languages = [];
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.ensureAvailability();
      while (this.queue.length && !this.stopped && this.o.prefs().on) {
        // Read again asks the recogniser anew, even mid-run (a language installed since is found that way).
        await this.ensureAvailability();
        if (!this.availability!.ok) {
          this.queue = [];
          this.todo = 0;
          break;
        }
        const unit = this.queue.shift()!;
        if (unit.page === -1) await this.planPdf(unit.file);
        else await this.readUnit(unit);
        await tick();
        if (this.queue.length && (this.o.gapMs ?? 250) > 0) await new Promise((r) => setTimeout(r, this.o.gapMs ?? 250));
      }
    } finally {
      this.running = false;
      this.done = 0;
      this.todo = 0;
      this.current = undefined;
      this.emit(true);
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  /** A PDF's scanned pages found (its text pages are never sent): each a unit in the queue. */
  private async planPdf(file: OcrQueueFile): Promise<void> {
    this.todo = Math.max(0, this.todo - 1);
    this.current = file.rel.split('/').pop();
    this.emit();
    if (entryFresh(this.o.store.get(file.rel), file)) {
      this.emit();
      return;
    }
    // Too big to read: marked without opening it.
    if (file.size > OCR_LIMITS.pdfBytes) {
      this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'big' });
      this.emit();
      return;
    }
    let pages = { pages: 0, empty: [] as boolean[] };
    try {
      pages = await this.o.pdfPages(file.abs);
    } catch (err) {
      this.o.log?.(`Ironleaf could not look inside ${file.rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const known = this.known.get(file.rel.toLowerCase());
    if (!known || known.mtime !== file.mtime || known.size !== file.size) return;
    if (file.size > OCR_LIMITS.pdfBytes || !pages.pages) {
      // A PDF that can't be looked inside (broken, protected) is marked, so it isn't tried again and again (a failed
      // one is tried again after a week).
      this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: file.size > OCR_LIMITS.pdfBytes ? 'big' : 'failed', at: Date.now() });
      this.emit();
      return;
    }
    const capped = pages.empty.slice(0, OCR_LIMITS.pages);
    if (!capped.some(Boolean)) {
      this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'clear', at: Date.now() });
      this.emit();
      return;
    }
    const scanned = capped.map((e, i) => (e ? i + 1 : 0)).filter((p) => p > 0);
    const entry = this.o.store.get(file.rel);
    const pages_: Record<string, OcrLine[]> = entry && entry.mtime === file.mtime && entry.size === file.size ? { ...(entry.pages ?? {}) } : {};
    const missing = scanned.filter((p) => !pages_[String(p)]);
    // Which pages are scans is kept now, so the reader knows a text page from one still being read.
    this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'words', at: Date.now(), pages: pages_, scanned });
    if (!missing.length) {
      this.emit();
      return;
    }
    // Its pages join the front (in order), so one PDF finishes before the next starts.
    this.queue.unshift(...missing.map((page) => ({ file, page })));
    this.todo += missing.length;
    this.emit();
  }

  /** One picture, or one scanned page. */
  private async readUnit(unit: Unit): Promise<void> {
    const { file, page } = unit;
    const known = this.known.get(file.rel.toLowerCase());
    if (!known || known.mtime !== file.mtime || known.size !== file.size) {
      this.todo = Math.max(0, this.todo - 1);
      return;
    }
    if (file.kind === 'pdf') {
      const entry = this.o.store.get(file.rel);
      const havePage = entry && entry.mtime === file.mtime && entry.size === file.size && entry.pages?.[String(page)];
      if (entryFresh(entry, file) || havePage) {
        this.todo = Math.max(0, this.todo - 1);
        return;
      }
    }
    this.current = file.rel.split('/').pop();
    this.emit();
    const prefs = this.o.prefs();
    try {
      const read = file.kind === 'image' ? await this.o.engine.readImage(file.abs, prefs.lang) : await this.o.engine.readPdfPage(file.abs, page, prefs.lang);
      const lines = toLines(read);
      if (file.kind === 'image') {
        this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'words', at: Date.now(), pages: { 1: lines } });
      } else {
        const before = this.o.store.get(file.rel);
        const fresh = before && before.mtime === file.mtime && before.size === file.size;
        const pages_ = fresh ? { ...(before.pages ?? {}) } : {};
        pages_[String(page)] = lines;
        this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'words', at: Date.now(), pages: pages_, ...(fresh && before.scanned ? { scanned: before.scanned } : {}) });
      }
    } catch (err) {
      const words = err instanceof Error ? err.message : String(err);
      this.o.log?.(`Ironleaf could not read the words in ${file.rel}: ${words}`);
      if (file.kind === 'image') {
        this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: words === 'too-big' ? 'big' : 'failed', at: Date.now() });
      } else {
        // One page unreadable never loses the pages already read.
        const before = this.o.store.get(file.rel);
        const fresh = before && before.mtime === file.mtime && before.size === file.size;
        const pages_ = fresh ? { ...(before.pages ?? {}) } : {};
        pages_[String(page)] = [];
        this.o.store.set({ rel: file.rel, mtime: file.mtime, size: file.size, state: 'words', at: Date.now(), pages: pages_, ...(fresh && before.scanned ? { scanned: before.scanned } : {}) });
      }
    }
    this.done++;
    this.todo = Math.max(0, this.todo - 1);
    this.emit();
  }

  // ── What the window sees ──────────────────────────────────────────────────────────────────────────────────────

  status(): OcrStatus {
    const prefs = this.o.prefs();
    const entries = this.o.store.all();
    return {
      on: prefs.on,
      available: prefs.on && (this.availability?.ok ?? false),
      reason: !prefs.on ? 'off' : !this.availability ? 'starting' : this.availability.ok ? '' : (this.availability as { reason: string }).reason,
      busy: this.running,
      done: this.done,
      todo: this.todo,
      ...(this.current ? { current: this.current } : {}),
      files: this.known.size,
      withWords: entries.filter((e) => e.state === 'words').length,
      languages: this.languages,
      lang: prefs.lang,
    };
  }

  private emit(now = false): void {
    if (!this.o.onStatus) return;
    if (now) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.o.onStatus(this.status());
      return;
    }
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.o.onStatus?.(this.status());
    }, 250);
    this.statusTimer.unref?.();
  }
}

/** The recogniser's pixels as fractions of the picture, tidied (empty lines left out, the words kept in order). */
function toLines(read: OcrRead): OcrLine[] {
  const out: OcrLine[] = [];
  let chars = 0;
  for (const l of read.lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const box: OcrBox = read.width > 0 && read.height > 0 ? normaliseBox(l.box, read.width, read.height) : [0, 0, 1, 0];
    const words = l.words
      .map((w) => ({ text: w.text.replace(/\s+/g, ' ').trim(), box: read.width > 0 && read.height > 0 ? normaliseBox(w.box, read.width, read.height) : ([0, 0, 0, 0] as OcrBox) }))
      .filter((w) => w.text)
      .slice(0, 200);
    out.push({ text, box, words });
    chars += text.length + 1;
    if (chars > OCR_LIMITS.fileChars || out.length > 2000) break;
  }
  return out;
}

// ── Searching the words ─────────────────────────────────────────────────────────────────────────────────────────

function plainWords(query: string): string[] | null {
  if (/[:()"/[\]]|(^|\s)-\S|\sOR\s/.test(query)) return null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? words : null;
}

/**
 * Pictures and scans matching a search (the same words, "phrases", OR, -leave out and /patterns/ as the notes'
 * search): a picture's matching lines, a scan's matching pages with their lines. Private notes and folders left out
 * of search are never in it.
 */
export function searchOcr(entries: OcrEntry[], query: string, o: { isExcluded?(rel: string): boolean; limit?: number; snippets?: number } = {}): OcrHit[] {
  const root = parseQuery(query.slice(0, 1000));
  if (!root) return [];
  const matcher = new QueryMatcher(root);
  const words = plainWords(query);
  const limit = o.limit ?? 30;
  const per = o.snippets ?? 3;
  const hits: OcrHit[] = [];
  for (const entry of entries) {
    if (entry.state !== 'words' || !entry.pages || isPrivatePath(entry.rel) || o.isExcluded?.(entry.rel)) continue;
    const name = entry.rel.split('/').pop() ?? entry.rel;
    const isPdf = /\.pdf$/i.test(entry.rel);
    const pages = Object.keys(entry.pages)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 1)
      .sort((a, b) => a - b);
    // One scan's best three pages, not twenty hits for one file (9.2).
    const before = hits.length;
    for (const page of pages) {
      const lines = entry.pages[String(page)] ?? [];
      const text = lines.map((l) => l.text).join('\n');
      if (!text.trim()) continue;
      if (words) {
        const lower = `${entry.rel.toLowerCase()}\n${text.toLowerCase()}`;
        if (!words.every((wd) => lower.includes(wd))) continue;
      }
      const doc = { path: entry.rel, title: name, content: text, tags: [], props: {} };
      if (!matcher.matches(doc)) continue;
      const found: { line: number; text: string; ranges: [number, number][]; distinct: number }[] = [];
      let matches = 0;
      if (matcher.positives.length) {
        lines.forEach((l, i) => {
          if (!l.text.trim()) return;
          const ranges = matcher.ranges(l.text);
          if (!ranges.length) return;
          matches += ranges.length;
          if (found.length < 200) found.push({ line: i, text: l.text, ranges, distinct: new Set(ranges.map(([a, b]) => l.text.slice(a, b).toLowerCase())).size });
        });
      }
      if (matcher.positives.length && !found.length) continue;
      const best = [...found].sort((a, b) => b.distinct - a.distinct || a.line - b.line).slice(0, per).sort((a, b) => a.line - b.line);
      const score = matcher.score(doc);
      hits.push({
        path: entry.rel,
        title: name,
        kind: isPdf ? 'pdf' : 'image',
        ...(isPdf ? { page } : {}),
        mtime: entry.mtime,
        score,
        matches,
        snippets: best.map((s) => ({ line: s.line, text: s.text, ranges: s.ranges, ...(isPdf ? { page } : {}) })),
      });
      if (!isPdf) break;
    }
    if (isPdf && hits.length - before > 3) {
      const mine = hits.splice(before).sort((a, b) => b.matches - a.matches || b.score - a.score).slice(0, 3);
      hits.push(...mine);
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, limit);
}

/** One scan page for the reader: its recognised lines, 'pending' while still being read, or why there are none
 *  ('clear' is a page with words of its own: the reader disagrees with what was kept, and the page reads as before). */
export function ocrPageState(entry: OcrEntry | null | undefined, page: number): { state: OcrEntry['state'] | 'pending'; lines: OcrLine[] } {
  if (!entry) return { state: 'pending', lines: [] };
  if (isPrivatePath(entry.rel)) return { state: 'failed', lines: [] };
  if (entry.state !== 'words') return { state: entry.state, lines: [] };
  const lines = entry.pages?.[String(page)];
  if (lines) return { state: 'words', lines };
  if (entry.scanned && !entry.scanned.includes(page)) return { state: 'clear', lines: [] };
  return { state: 'pending', lines: [] };
}

/** A picture or scan's recognised words in full (the assistant's reading): null when there are none, or private. */
export function ocrFileText(entry: OcrEntry | null | undefined): string | null {
  if (!entry || isPrivatePath(entry.rel)) return null;
  const text = ocrEntryText(entry);
  return text ? text : null;
}
