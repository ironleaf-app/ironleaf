# powershell -File tools/install-win.ps1 — installs dist/Ironleaf (tools/pack-win.mjs) for this Windows user, until the
# real installer (plan phase 5): %LOCALAPPDATA%\Programs\Ironleaf, and a Start menu shortcut Ironleaf writes itself
# (with its icon and Windows identity). An Ironleaf already running from there is closed first; notes and settings
# (%APPDATA%\@neuralspark\vault, and every vault) are not touched.
param([string]$From = (Join-Path $PSScriptRoot '..\dist\Ironleaf'))
$ErrorActionPreference = 'Stop'
$from = (Resolve-Path -LiteralPath $From).Path
if (-not (Test-Path -LiteralPath (Join-Path $from 'Ironleaf.exe'))) { throw "No Ironleaf.exe in ${from}: run tools/pack-win.mjs first." }
$to = Join-Path $env:LOCALAPPDATA 'Programs\Ironleaf'
Get-Process -Name Ironleaf -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($to, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
Start-Sleep -Milliseconds 500
if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
Copy-Item -LiteralPath $from -Destination $to -Recurse
$exe = Join-Path $to 'Ironleaf.exe'
$p = Start-Process -FilePath $exe -ArgumentList '--install-shortcut' -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(30000)) { $p.Kill(); throw 'Ironleaf did not make its shortcut in 30 seconds.' }
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Ironleaf.lnk'
if (-not (Test-Path -LiteralPath $lnk)) { throw 'The Start menu shortcut was not made.' }
"Installed: $to"
"Start menu: $lnk"
