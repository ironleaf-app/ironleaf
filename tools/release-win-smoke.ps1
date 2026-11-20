# The real-Windows smoke test of a built installer (tools/release.mjs --win-smoke copies it here and runs this on
# the Windows builder): a silent per-user install into a work folder, the app started with its own empty data
# folder, checked to stay up and show its window, then stopped and uninstalled. Everything the install and the
# app's first start write outside the work folder (its Installed apps entry, Start menu shortcut, ironleaf://
# and "Open with" entries, the ironleaf command on the user's PATH) is taken away again, and the user's PATH is
# put back exactly as it was. It refuses to run when an Ironleaf is already installed or running on this PC,
# because the installer would replace that one. No desktop shortcut is made. Prints one JSON object.
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [string]$Work = 'C:\nv-build\smoke',
  [int]$Seconds = 12,
  [int]$Port = 19391
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = [ordered]@{ ok = $false; installed = $false; installSeconds = 0; exeVersion = ''; exeProduct = ''; stayedUp = $false; processes = 0; window = ''; uninstalled = $false; restored = @(); residue = @(); problems = @() }
$app = Join-Path $Work 'app'
$data = Join-Path $Work 'data'
$notes = Join-Path $Work 'notes'
$classes = 'HKCU:\Software\Classes'
$progId = 'NeuralVault.Markdown' # the registry id kept from before the rename (src/main/windows-entry.ts)
$exts = '.md', '.markdown', '.mdown', '.mkd', '.txt'
$uninstallRoots = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'

function Installed-Ironleaf {
  foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($p.DisplayName -like 'Ironleaf*' -or $p.DisplayName -like 'NeuralVault*') { $_.PSPath }
    }
  }
}
function Our-Processes { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($app, [System.StringComparison]::OrdinalIgnoreCase) } }
function Names($path) { if (Test-Path $path) { @(Get-ChildItem $path -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName }) } else { @() } }
function Snapshot {
  @{
    classes   = Names $classes
    appdata   = Names $env:APPDATA
    local     = Names $env:LOCALAPPDATA
    programs  = Names (Join-Path $env:LOCALAPPDATA 'Programs')
    startMenu = Names (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
    uninstall = Names $uninstallRoots[0]
  }
}

# Refusals first: nothing has been changed yet.
if (-not (Test-Path $Setup)) { $result.problems += "The installer is not at $Setup."; $result | ConvertTo-Json -Depth 4; exit 2 }
if (@(Installed-Ironleaf).Count -gt 0 -or (Get-Process -Name 'Ironleaf', 'NeuralVault' -ErrorAction SilentlyContinue) -or (Test-Path "$classes\ironleaf") -or (Test-Path "$classes\neuralvault") -or (Test-Path "$classes\$progId")) {
  $result.problems += 'Ironleaf (or NeuralVault) is already installed or running on this PC: the smoke test would replace it, so nothing was done.'
  $result | ConvertTo-Json -Depth 4
  exit 3
}

$envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$pathBefore = $envKey.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$pathKind = if ($null -ne $pathBefore) { $envKey.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
$before = Snapshot
$extBefore = @{}
foreach ($ext in $exts) { $extBefore[$ext] = @{ key = (Test-Path "$classes\$ext"); open = (Test-Path "$classes\$ext\OpenWithProgids") } }

try {
  foreach ($dir in $app, $data, $notes) { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force } }
  New-Item -ItemType Directory -Force -Path $data, $notes | Out-Null
  # The app's own data folder says where its (empty) notes are, and that the one-time launcher hand-over of earlier
  # versions is already done, so this start reaches for nothing outside the work folder.
  [IO.File]::WriteAllText((Join-Path $data 'settings.json'), (@{ lastVault = $notes; library = $notes; recentVaults = @($notes) } | ConvertTo-Json))
  [IO.File]::WriteAllText((Join-Path $data 'launcher-handover.json'), '{"state":"done"}')
  [IO.File]::WriteAllText((Join-Path $data 'update-check.json'), '{"enabled":false}')

  # 1. Silent install (/D= is last and unquoted, as NSIS wants it).
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $install = Start-Process -FilePath $Setup -ArgumentList "/S --no-desktop-shortcut /D=$app" -PassThru -Wait
  $result.installSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 1)
  $exe = Join-Path $app 'Ironleaf.exe'
  if ($install.ExitCode -ne 0 -or -not (Test-Path $exe)) { throw "The installer ended with code $($install.ExitCode) and Ironleaf.exe is $(if (Test-Path $exe) { 'there' } else { 'missing' })." }
  $result.installed = $true
  $info = (Get-Item $exe).VersionInfo
  $result.exeVersion = $info.ProductVersion
  $result.exeProduct = $info.ProductName
  if (@(Installed-Ironleaf).Count -lt 1) { $result.problems += 'The install wrote no Installed apps entry.' }

  # 2. Start it with its own data folder, and look at it after a while.
  $proc = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$data", "--remote-debugging-port=$Port" -PassThru
  Start-Sleep -Seconds $Seconds
  $proc.Refresh()
  $ours = @(Our-Processes)
  $result.processes = $ours.Count
  $result.stayedUp = (-not $proc.HasExited) -and $ours.Count -ge 1
  try {
    $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
    $page = @($pages | Where-Object { $_.type -eq 'page' })[0]
    if ($page) { $result.window = "$($page.title) | $($page.url)" }
  } catch { $result.problems += "The window could not be asked for its title: $($_.Exception.Message)" }
  if (-not $result.stayedUp) { $result.problems += "Ironleaf did not stay up for $Seconds seconds (exit code $($proc.ExitCode))." }
}
catch { $result.problems += $_.Exception.Message }
finally {
  # 3. Stop it, uninstall, and put back everything outside the work folder.
  try { Our-Processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}
  Start-Sleep -Seconds 2
  $uninstaller = Join-Path $app 'Uninstall Ironleaf.exe'
  if (Test-Path $uninstaller) {
    try {
      Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$app" -Wait
      $result.uninstalled = (@(Installed-Ironleaf).Count -eq 0) -and -not (Test-Path (Join-Path $app 'Ironleaf.exe'))
    } catch { $result.problems += "Uninstall: $($_.Exception.Message)" }
  }
  foreach ($root in @(Installed-Ironleaf)) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue; $result.restored += 'Installed apps entry' }
  foreach ($name in 'ironleaf', 'neuralvault', $progId) {
    if ((Test-Path "$classes\$name") -and ($before.classes -notcontains $name)) { Remove-Item "$classes\$name" -Recurse -Force -ErrorAction SilentlyContinue; $result.restored += "Classes\$name" }
  }
  foreach ($ext in $exts) {
    $open = "$classes\$ext\OpenWithProgids"
    if (Test-Path $open) {
      if ($null -ne (Get-ItemProperty $open -Name $progId -ErrorAction SilentlyContinue)) { Remove-ItemProperty $open -Name $progId -Force -ErrorAction SilentlyContinue; $result.restored += "Classes\$ext Open with" }
      if (-not $extBefore[$ext].open) { Remove-Item $open -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if ((Test-Path "$classes\$ext") -and -not $extBefore[$ext].key) { Remove-Item "$classes\$ext" -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $pathNow = $envKey.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($pathNow -cne $pathBefore) {
    if ($null -eq $pathBefore) { $envKey.DeleteValue('Path', $false) } else { $envKey.SetValue('Path', $pathBefore, $pathKind) }
    $result.restored += 'user PATH'
    try {
      Add-Type -Namespace NvSmoke -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
      $r = [UIntPtr]::Zero
      [NvSmoke.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$r) | Out-Null
    } catch {}
  }
  $pathAfter = $envKey.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($pathAfter -cne $pathBefore) { $result.problems += 'The user PATH could not be put back as it was.' }
  $envKey.Close()
  $link = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Ironleaf.lnk'
  if ((Test-Path $link) -and ($before.startMenu -notcontains 'Ironleaf.lnk')) { Remove-Item $link -Force -ErrorAction SilentlyContinue; $result.restored += 'Start menu shortcut' }
  # The installer's own download folder for updates (made by the install, left by the uninstall).
  $updater = Join-Path $env:LOCALAPPDATA 'neuralvault-updater'
  if ((Test-Path $updater) -and ($before.local -notcontains 'neuralvault-updater')) { Remove-Item $updater -Recurse -Force -ErrorAction SilentlyContinue; $result.restored += 'installer download folder' }
  foreach ($dir in $app, $data, $notes) { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue } }
  Remove-Item $Setup -Force -ErrorAction SilentlyContinue
  # What is there now that was not there before (named, never removed blindly).
  $after = Snapshot
  foreach ($k in $before.Keys) { foreach ($name in $after[$k]) { if ($before[$k] -notcontains $name) { $result.residue += "${k}: $name" } } }
}
$result.ok = $result.installed -and $result.stayedUp -and $result.uninstalled -and ($result.window -ne '') -and ($result.problems.Count -eq 0)
$result | ConvertTo-Json -Depth 4
if ($result.ok) { exit 0 } else { exit 1 }
