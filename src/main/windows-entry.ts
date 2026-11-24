// Ironleaf's places in Windows (21 Oct 2026, gap G26), for this Windows user only (HKCU\Software\Classes and the user's
// own PATH; never an administrator), written the way the former host app writes File Explorer's "Ask the former host app
// about this" (its src/quick-ask.cjs): with reg.exe, only what is missing or different, at each start of an installed
// copy (a development copy or a test build only when NV_REGISTER_WINDOWS=1, so neither takes the places from the
// installed app).
//
//   - ironleaf:// links open Ironleaf (src/shared/uri.ts; each change a link asks for is confirmed first);
//   - "Open with › Ironleaf" for every file type it opens (.md, .markdown, .mdown, .mkd, .txt), offered beside the
//     person's own choice and never taking it;
//   - the ironleaf command: neuralvault.cmd and neuralvault.ps1 in Ironleaf's own data (bin), that folder added to
//     the user's PATH, and Windows told so new terminals find it (src/main/cli.ts answers it).
//
// Inside the former host app the program is that app's own executable started with --neuralvault, so each
// entry starts it that way. unregisterWindows() takes everything away again.

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { OPEN_FILE_ARG, URI_SCHEMES } from '../shared/uri';

// The registry id earlier versions wrote (kept, so an update replaces those keys instead of adding a second "Open with").
export const PROGID = 'NeuralVault.Markdown';
/** The command's names: ironleaf first; neuralvault is the alias kept from before the rename. */
export const CLI_NAMES = ['ironleaf', 'neuralvault'] as const;
// Every file type Ironleaf opens (16 Nov 2026 audit finding 14): the same list launchTargets accepts.
export const OPEN_WITH_EXTS = ['.md', '.markdown', '.mdown', '.mkd', '.txt'];
const CLASSES = 'HKCU\\Software\\Classes';
const ENV_KEY = 'HKCU\\Environment';

export type RegRun = (args: string[]) => Promise<string>;
export const runReg: RegRun = (args) => new Promise((resolve, reject) => execFile('reg', args, { windowsHide: true, timeout: 15000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout)))));

/** Whether this copy takes Ironleaf's places in Windows: an installed one, unless it is a test build. */
export function takesPlaces(o: { platform: NodeJS.Platform; packaged: boolean; testBuild: boolean; forced?: boolean }): boolean {
  return o.platform === 'win32' && (!!o.forced || (o.packaged && !o.testBuild));
}

/** A --test-identity build says so in its own package.json (tools/release.mjs). Anything unreadable is not one: the
 *  installed app must never stop answering its own links. */
export function isTestBuild(readPackage: () => string): boolean {
  try {
    return JSON.parse(readPackage())?.testIdentity === true;
  } catch {
    return false;
  }
}

/** One key's values: '' is the key's default value. REG_NONE marks an "Open with" choice (it has no data). */
export interface RegEntry {
  key: string;
  values: Record<string, { type: 'REG_SZ' | 'REG_NONE'; data: string }>;
}

const quote = (v: string) => `"${v}"`;
const sz = (data: string) => ({ type: 'REG_SZ' as const, data });

/** How Windows starts Ironleaf with something: the program, its own arguments, then what it is started for. */
export function commandLine(exe: string, launchArgs: readonly string[], last: string): string {
  return [quote(exe), ...launchArgs.map(quote), quote(last)].join(' ');
}

/** The keys for ironleaf:// links and "Open with". `icon` is an .ico file Explorer can read (else the program's). */
export function windowsEntries(o: { exe: string; launchArgs: readonly string[]; icon?: string | null }): RegEntry[] {
  const icon = o.icon ? quote(o.icon) : `${quote(o.exe)},0`;
  return [
    // ironleaf:// and neuralvault:// (the name before the rename, kept so saved links and other apps' set-ups still open).
    ...URI_SCHEMES.flatMap((scheme): RegEntry[] => [
      { key: `${CLASSES}\\${scheme}`, values: { '': sz('URL:Ironleaf link'), 'URL Protocol': sz('') } },
      { key: `${CLASSES}\\${scheme}\\DefaultIcon`, values: { '': sz(icon) } },
      { key: `${CLASSES}\\${scheme}\\shell\\open\\command`, values: { '': sz(commandLine(o.exe, o.launchArgs, '%1')) } },
    ]),
    { key: `${CLASSES}\\${PROGID}`, values: { '': sz('Markdown note'), FriendlyTypeName: sz('Markdown note') } },
    { key: `${CLASSES}\\${PROGID}\\DefaultIcon`, values: { '': sz(icon) } },
    { key: `${CLASSES}\\${PROGID}\\shell\\open`, values: { FriendlyAppName: sz('Ironleaf') } },
    { key: `${CLASSES}\\${PROGID}\\shell\\open\\command`, values: { '': sz(commandLine(o.exe, o.launchArgs, `${OPEN_FILE_ARG}%1`)) } },
    ...OPEN_WITH_EXTS.map((ext) => ({ key: `${CLASSES}\\${ext}\\OpenWithProgids`, values: { [PROGID]: { type: 'REG_NONE' as const, data: '' } } })),
  ];
}

/** The `reg add` argument lists that write one entry. */
export function regAdds(entry: RegEntry): string[][] {
  return Object.entries(entry.values).map(([name, v]) => ['add', entry.key, ...(name ? ['/v', name] : ['/ve']), '/t', v.type, ...(v.type === 'REG_NONE' ? [] : ['/d', v.data]), '/f']);
}

/** A key's values from `reg query`: {name: {type, data}}; the default value's name is in Windows' own language. */
export function regValues(output: string): Record<string, { type: string; data: string }> {
  const out: Record<string, { type: string; data: string }> = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const row = /^ {4}(\S(?:.*?\S)?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (row) out[/^\(.*\)$/.test(row[1]) ? '' : row[1]] = { type: row[2], data: row[3] ?? '' };
  }
  return out;
}

const sameEntry = (have: Record<string, { type: string; data: string }>, want: RegEntry) => Object.entries(want.values).every(([name, v]) => have[name] && have[name].type === v.type && (v.type === 'REG_NONE' || have[name].data === v.data));

/** The user's PATH with a folder added at its end (null: it is there already). Compared without case or a last slash. */
export function pathWith(current: string, dir: string): string | null {
  const norm = (s: string) => s.trim().replace(/[\\/]+$/, '').toLowerCase();
  const parts = current.split(';').filter((p) => p.trim());
  if (parts.some((p) => norm(p) === norm(dir))) return null;
  return [...parts, dir].join(';');
}

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The command's two files: neuralvault.cmd (what a terminal finds on the PATH) and neuralvault.ps1 (Windows PowerShell,
 *  on every Windows 10 and 11 PC), which sends the words to the running Ironleaf — starting it first when it isn't
 *  running, and prints its answer. "ironleaf mcp" instead bridges stdio: each stdin line to /mcp, each answer line
 *  to stdout, for the other AI apps on this PC. */
export function cliScripts(o: { exe: string; launchArgs: readonly string[]; endpointFile: string; ps1: string }): { cmd: string; ps1: string } {
  const cmd = ['@echo off', `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${o.ps1}" %*`, 'exit /b %ERRORLEVEL%', ''].join('\r\n');
  const script = [
    '# The ironleaf command, made by Ironleaf (docs/CLI-AND-LINKS.md in its source). It hands its words to Ironleaf',
    '# on this PC over 127.0.0.1 with the secret in Ironleaf\'s own data, and prints the answer. "ironleaf mcp"',
    '# instead bridges stdio to /mcp (one JSON-RPC message a line) for the other AI apps on this PC. Ironleaf writes',
    '# this file again when it changes; edits here are lost.',
    '$ErrorActionPreference = \'Stop\'',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `$endpointFile = ${ps(o.endpointFile)}`,
    `$exe = ${ps(o.exe)}`,
    `$launch = @(${o.launchArgs.map(ps).join(', ')})`,
    '$words = @($args | ForEach-Object { [string]$_ })',
    'function Get-Endpoint { try { Get-Content -Raw -Encoding UTF8 -LiteralPath $endpointFile | ConvertFrom-Json } catch { $null } }',
    '# The MCP bridge (before stdin is read: here stdin is the message stream, not one command’s words).',
    'if ($words.Count -gt 0 -and $words[0] -eq \'mcp\') {',
    '  if (-not [Console]::IsInputRedirected) {',
    '    [Console]::Out.WriteLine(\'Your notes’ MCP server runs from your other AI apps’ set-up, not by hand. Switch it on in Ironleaf (Settings › Agents › Use your notes from other AI apps), then paste the set-up for your app.\')',
    '    exit 0',
    '  }',
    '  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
    '  $mcpEp = Get-Endpoint',
    '  if (-not $mcpEp) {',
    '    try { if ($launch.Count) { Start-Process -FilePath $exe -ArgumentList $launch | Out-Null } else { Start-Process -FilePath $exe | Out-Null } } catch { [Console]::Error.WriteLine(\'Ironleaf could not be started: \' + $_.Exception.Message); exit 1 }',
    '    $mcpDeadline = (Get-Date).AddSeconds(60)',
    '    while ((-not $mcpEp) -and (Get-Date) -lt $mcpDeadline) { Start-Sleep -Milliseconds 500; $mcpEp = Get-Endpoint }',
    '    if (-not $mcpEp) { [Console]::Error.WriteLine(\'Ironleaf did not answer. Open Ironleaf, then try again.\'); exit 1 }',
    '  }',
    '  while ($true) {',
    '    $mcpLine = [Console]::In.ReadLine()',
    '    if ($null -eq $mcpLine) { break }',
    '    if ([string]::IsNullOrWhiteSpace($mcpLine)) { continue }',
    '    try {',
    '      $mcpResp = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $mcpEp.port + "/mcp") -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($mcpLine)) -ContentType \'application/json; charset=utf-8\' -Headers @{ \'x-neuralvault-cli\' = [string]$mcpEp.token } -TimeoutSec 300 -UseBasicParsing',
    '      if ($mcpResp.StatusCode -eq 200 -and -not [string]::IsNullOrWhiteSpace($mcpResp.Content)) { [Console]::Out.WriteLine($mcpResp.Content.Trim()) }',
    '    } catch { [Console]::Error.WriteLine(\'Ironleaf stopped answering.\'); exit 1 }',
    '  }',
    '  exit 0',
    '}',
    '$stdin = \'\'',
    'if ([Console]::IsInputRedirected) { $stdin = [Console]::In.ReadToEnd() }',
    '$body = [Text.Encoding]::UTF8.GetBytes((@{ args = $words; stdin = $stdin } | ConvertTo-Json -Compress -Depth 3))',
    'function Send-Words($ep) {',
    '  Invoke-RestMethod -Uri ("http://127.0.0.1:" + $ep.port + "/cli") -Method Post -Body $body -ContentType \'application/json; charset=utf-8\' -Headers @{ \'x-neuralvault-cli\' = [string]$ep.token } -TimeoutSec 300 -UseBasicParsing',
    '}',
    '$answer = $null',
    '$ep = Get-Endpoint',
    'if ($ep) { try { $answer = Send-Words $ep } catch [System.Net.WebException] { if ($_.Exception.Response) { [Console]::Error.WriteLine(\'Ironleaf refused the command.\'); exit 1 } } }',
    'if (-not $answer) {',
    '  $before = if ($ep) { [string]$ep.token } else { \'\' }',
    '  try { if ($launch.Count) { Start-Process -FilePath $exe -ArgumentList $launch | Out-Null } else { Start-Process -FilePath $exe | Out-Null } } catch { [Console]::Error.WriteLine(\'Ironleaf could not be started: \' + $_.Exception.Message); exit 1 }',
    '  $deadline = (Get-Date).AddSeconds(60)',
    '  while (-not $answer -and (Get-Date) -lt $deadline) {',
    '    Start-Sleep -Milliseconds 500',
    '    $ep = Get-Endpoint',
    '    if ($ep -and [string]$ep.token -ne $before) { try { $answer = Send-Words $ep } catch {} }',
    '  }',
    '  if (-not $answer) { [Console]::Error.WriteLine(\'Ironleaf did not answer. Open Ironleaf, then try again.\'); exit 1 }',
    '}',
    '$text = [string]$answer.text',
    'if ($answer.exit -eq 0) { if ($text) { [Console]::Out.Write($text.TrimEnd() + [Environment]::NewLine) } } else { [Console]::Error.WriteLine($text) }',
    'exit [int]$answer.exit',
    '',
  ].join('\r\n');
  return { cmd, ps1: script };
}

/** Tells Windows the user's environment changed, so terminals started from now on see the new PATH. */
const BROADCAST = [
  "Add-Type -Namespace NV -Name Env -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);'",
  '$r = [UIntPtr]::Zero',
  "[void][NV.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 4000, [ref]$r)",
].join('; ');
export type PsRun = (script: string) => Promise<void>;
const runPs: PsRun = (script) => new Promise((resolve) => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, () => resolve()));

export interface WindowsEntryResult {
  /** The keys written this time (none when everything was already there). */
  changed: string[];
  /** Where the ironleaf command is, or null when it couldn't be set up. */
  cli: string | null;
  /** The command's folder was added to the PATH this time (open a new terminal to use it). */
  pathAdded: boolean;
  problems: string[];
}

/** Writes what is missing or different. Never throws. */
export async function registerWindows(o: {
  exe: string;
  launchArgs: readonly string[];
  dataDir: string;
  endpointFile: string;
  /** Ironleaf's .ico (copied beside the command, where Explorer can read it). */
  icon?: string;
  run?: RegRun;
  powershell?: PsRun;
  fs?: Pick<typeof fsp, 'mkdir' | 'readFile' | 'writeFile' | 'copyFile'>;
}): Promise<WindowsEntryResult> {
  const run = o.run ?? runReg;
  const fs = o.fs ?? fsp;
  const out: WindowsEntryResult = { changed: [], cli: null, pathAdded: false, problems: [] };
  const bin = path.win32.join(o.dataDir, 'bin');
  try {
    await fs.mkdir(bin, { recursive: true });
  } catch (err) {
    out.problems.push(`bin: ${err instanceof Error ? err.message : String(err)}`);
  }
  // The icon, where Explorer can read it (the app's own copy may be inside its packed files).
  let icon: string | null = null;
  if (o.icon && /\.ico$/i.test(o.icon)) {
    const to = path.win32.join(bin, 'neuralvault.ico');
    try {
      const data = await fs.readFile(o.icon);
      const have = await fs.readFile(to).catch(() => null);
      if (!have || !Buffer.from(have).equals(Buffer.from(data))) await fs.writeFile(to, data);
      icon = to;
    } catch {
      icon = null;
    }
  }
  for (const entry of windowsEntries({ exe: o.exe, launchArgs: o.launchArgs, icon })) {
    try {
      const have = regValues(await run(['query', entry.key]).catch(() => ''));
      if (sameEntry(have, entry)) continue;
      for (const args of regAdds(entry)) await run(args);
      out.changed.push(entry.key);
    } catch (err) {
      out.problems.push(`${entry.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The command: ironleaf, and neuralvault (its name before the rename, kept so AI apps set up with "neuralvault mcp"
  // and people's scripts keep working). Each name has its .cmd and .ps1; the scripts are the same.
  try {
    let cmdFile = '';
    for (const name of CLI_NAMES) {
      const ps1 = path.win32.join(bin, `${name}.ps1`);
      const cmd = path.win32.join(bin, `${name}.cmd`);
      const files = cliScripts({ exe: o.exe, launchArgs: o.launchArgs, endpointFile: o.endpointFile, ps1 });
      // A byte-order mark, so Windows PowerShell reads the script's paths as UTF-8 (a name with é, ā or ō).
      for (const [file, text] of [[ps1, `\uFEFF${files.ps1}`], [cmd, files.cmd]] as const) {
        const have = await fs.readFile(file, 'utf8').catch(() => null);
        if (have !== text) await fs.writeFile(file, text, 'utf8');
      }
      cmdFile ||= cmd;
    }
    const env = regValues(await run(['query', ENV_KEY, '/v', 'Path']).catch(() => ''));
    const current = env.Path ?? env.PATH ?? Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1];
    const next = pathWith(current?.data ?? '', bin);
    if (next !== null) {
      // The type it had is kept (REG_EXPAND_SZ keeps %USERPROFILE% and the like working).
      await run(['add', ENV_KEY, '/v', 'Path', '/t', current?.type === 'REG_SZ' ? 'REG_SZ' : 'REG_EXPAND_SZ', '/d', next, '/f']);
      out.pathAdded = true;
      await (o.powershell ?? runPs)(BROADCAST);
    }
    out.cli = cmdFile;
  } catch (err) {
    out.problems.push(`command: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

/** Everything registerWindows wrote, taken away (the command's folder off the PATH too). Never throws. */
export async function unregisterWindows(o: { dataDir: string; run?: RegRun }): Promise<void> {
  const run = o.run ?? runReg;
  for (const scheme of URI_SCHEMES) await run(['delete', `${CLASSES}\\${scheme}`, '/f']).catch(() => '');
  await run(['delete', `${CLASSES}\\${PROGID}`, '/f']).catch(() => '');
  for (const ext of OPEN_WITH_EXTS) await run(['delete', `${CLASSES}\\${ext}\\OpenWithProgids`, '/v', PROGID, '/f']).catch(() => '');
  const bin = path.win32.join(o.dataDir, 'bin');
  const env = regValues(await run(['query', ENV_KEY, '/v', 'Path']).catch(() => ''));
  const current = env.Path ?? Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1];
  if (!current) return;
  const norm = (s: string) => s.trim().replace(/[\\/]+$/, '').toLowerCase();
  const kept = current.data.split(';').filter((p) => p.trim() && norm(p) !== norm(bin));
  if (kept.length !== current.data.split(';').filter((p) => p.trim()).length) await run(['add', ENV_KEY, '/v', 'Path', '/t', current.type === 'REG_SZ' ? 'REG_SZ' : 'REG_EXPAND_SZ', '/d', kept.join(';'), '/f']).catch(() => '');
}
