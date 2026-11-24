# Releasing Ironleaf

One command, from a clean commit to installers ready to publish. Measured on a 4-core Linux
build machine on 20 Nov 2026: **about 1.5 minutes** with the typecheck, **under a minute** with `--fast`.

```sh
export PATH=~/.local/bin:$PATH; unset ELECTRON_RUN_AS_NODE
cd ironleaf                      # the checkout to release, at the commit to release
npm run release -- --notes "What changed, in a sentence or two."
```

Then look at `dist/release/`, and when it is right:

```sh
npm run release -- --publish-only
```

(`npm run release -- --notes "..." --publish` does both in one go.)

The version is `package.json`'s `version`. Bump it, add its `## x.y.z — YYYY-MM-DD` section at the top of
`CHANGELOG.md` (one `- ` line a change, in plain words), and commit before releasing; the app only offers an update when
the published version is higher than the one installed.

## Flags

| Flag | What it does |
| --- | --- |
| `--notes "..."` | The release notes: into `latest.json` (the app shows them), `versions.json` and the notes file. Without it, the notes are `CHANGELOG.md`'s for this version. |
| `--fast` | Skips the typecheck. |
| `--linux-only` / `--win-only` | One platform. The other platform's files from an earlier run of the same version are kept. |
| `--max` | Smallest files instead of fastest build (7z level 9; several minutes). |
| `--no-smoke` | Skips starting the packaged app for 8 seconds on a virtual screen. |
| `--publish` | After building, copies the files into the website's download folder. |
| `--publish-only` | Publishes what is already in `dist/release/` without building. |
| `--win-smoke` | Installs `dist/release/Ironleaf-Setup.exe` on the Windows PC, starts it, uninstalls (needs `NV_WIN_BUILDER`). |
| `--version x.y.z` | Builds that version without changing `package.json` (update tests). Cannot be published. |
| `--test-identity` | Builds "Ironleaf Update Test" (own installer id, no shortcuts, and the app never takes the links, Open with or the PATH) for update tests on a PC that has Ironleaf. Cannot be published. |

Environment: `NV_BUILDTOOLS` (default `~/.ironleaf-buildtools`), `NV_WIN_BUILDER` (unset: Windows is built here),
`NV_WIN_BUILD_DIR` (default `C:\nv-build`), `NV_DOWNLOAD_DIR` (the web server's download folder(s), split by `:`;
required to publish), `NV_SITE` (the release site, default Ironleaf's), `NV_UPDATE_SIGNING_KEY_FILE` (the Ed25519
private key that signs `latest.json`; required to publish), `NV_COMPRESSION_LEVEL` (0 to 9, default 3),
`NV_REAL_WINE=1` (use an installed Wine instead of the stand-in), `NV_PUBLISH_SUDO=0` (publish without sudo, for a
folder you own).

## What it does, and how long each step took

| Step | What | Time (4 cores) |
| --- | --- | --- |
| typecheck | `npm run typecheck`, alongside the next steps | 34 s alone; 75 s when sharing the cores |
| build | `npm run build` (electron-vite and the two workers) | 3 to 6 s |
| stage | The app folder that ships, in `dist/release-work/app` | under 1 s |
| package | Linux AppImage and Windows NSIS installer, side by side | 32 to 60 s (Linux 23 to 53 s, Windows 32 to 60 s) |
| smoke | The packaged Linux app started for 8 s under `xvfb-run` | 8 s |
| describe | Names, sizes, SHA-256, `latest.json`, notes file | 1 to 2 s |
| **total** | | **42 to 55 s with `--fast`, 85 s with the typecheck** |

The ranges are real runs; the slow end is with other work running on the same four cores. The first run on a
machine also downloads the Windows Electron runtime and the NSIS and AppImage tools once (about two more minutes).

Stage keeps the package small: the build without source maps, `resources/` (icons and the on-device models), the
clipper extension, and only the `dependencies` that the built main side actually names (today `yaml` and
`onnxruntime-web`, trimmed by `tools/ort-ship.mjs`). The window's libraries are already bundled into
`out/renderer` by the build, so they are not shipped a second time as folders. If a release ever stops at "smoke"
with "Cannot find module", something the main side needs was left out of the package: that is what the step is for.

## What it writes

Everything in `dist/release/` (git-ignored):

| File | |
| --- | --- |
| `Ironleaf.AppImage` | Linux, the name the website serves. About 176 MB. |
| `Ironleaf-Setup.exe` | Windows x64 installer, the name the website serves. About 224 MB (the app's asar is stored uncompressed for small updates). |
| `Ironleaf-<version>.AppImage`, `Ironleaf-Setup-<version>.exe` | The same files, kept by version. |
| `Ironleaf-Setup-<version>.exe.blockmap` | The installer's block map: the in-app updater downloads only the blocks that changed. |
| `latest.json` | `{"version","date","notes","windows":{"file","size","sha256","versioned","blockmap"},"linux":{...,"blockMapSize"}}`: the website and the app read it. |
| `versions.json` | `{"versions":[{"version","date","notes","sizes":{"linux","windows"}}]}`, newest first: every release. Settings › About and updates shows it as the version history, merged with the `CHANGELOG.md` the app was built with. |
| `Ironleaf-<version>.notes.txt` | The notes as plain text. |

`dist/release-work/` holds the intermediate folders and can be deleted at any time.

Most of the size is fixed: the Electron runtime, and 74 MB of on-device models that do not compress. `--max` gets
the Windows installer to about 170 MB for an extra two minutes.

## Packaging config

`build-standalone/electron-builder.json`: appId `com.kaitiaki.neuralvault`, product name Ironleaf, `asar` on
(the models, the extension and the ONNX runner are unpacked beside it), English locales only, AppImage category
Office with the static runtime (runs without libfuse2), NSIS per user with the same `guid` as every earlier
installer, so existing installs upgrade in place. Installer resources are in `build-standalone/build/`.
`tools/release.mjs` adds the paths, the Electron version and the compression at run time.

## Once per machine

electron-builder lives outside the repository so the app's lockfile and `node_modules` are never touched:

```sh
mkdir ~/.ironleaf-buildtools && cd ~/.ironleaf-buildtools && npm init -y
npm i --save-exact electron-builder@26.18.0 resedit@3.1.1 @electron/fuses@2.1.3
```

Its downloads are cached in `~/.ironleaf-buildtools/cache`.

## Windows from Linux

The Windows installer is built on Linux, without Wine and without any system package:

- `signAndEditExecutable` is off, so electron-builder does not run rcedit. `tools/release-after-pack.cjs` stamps
  `Ironleaf.exe` with its icon, name and version in pure JavaScript (resedit).
- electron-builder still wants Wine for one step: it builds a small intermediate installer and runs it so that it
  writes the uninstaller (`wine process failed ENOENT` was the exact failure). `tools/release.mjs` puts a stand-in
  `wine` first on PATH for that process; it calls `tools/release-uninstaller.cjs`, which uses electron-builder's
  own pure JavaScript reader (the one it uses on macOS) to take the uninstaller out of that file.
- The installer is not code-signed. Windows SmartScreen will say "unknown publisher" on a downloaded copy until a
  signing certificate is added.

The installer built this way was tested on real Windows 11 on 20 Nov 2026 with `--win-smoke`: silent
install in 13 s, the app stayed up and showed its window, uninstall clean.

If the installer cannot be built at all, the script falls back to a portable zip of the unpacked app
(`Ironleaf-<version>-win-x64.zip`, marked `"kind": "portable-zip"` in `latest.json`; the app then sends people
to the download page instead of installing in place).

## The Windows PC as a builder (optional)

```sh
NV_WIN_BUILDER=<windows-ssh-host> npm run release -- --notes "..."
```

The staged app is copied to the PC, electron-builder runs there, the `.exe` comes back. If the PC does not answer,
the installer is built on Linux as usual. Measured with warm caches: 49 s (send 12 s, build 16 s, fetch 21 s) against
32 to 45 s on Linux, so **building on Linux is the faster path**; the PC's value is the real install test:

```sh
NV_WIN_BUILDER=<windows-ssh-host> npm run release -- --win-smoke
```

That copies `dist/release/Ironleaf-Setup.exe` over, installs it silently into `C:\nv-build\smoke\app` (no
desktop shortcut), starts it with an empty data folder, checks after 12 s that it is still running and its window
loaded, stops it, uninstalls, and takes away what the install and the app's first start wrote for the Windows user
(Installed apps entry, Start menu shortcut, `ironleaf://` and "Open with" entries, the user PATH put back exactly
as it was). It refuses to run when an Ironleaf is already installed or running on that PC, because the installer
would replace it. It takes about a minute.

Setting up a Windows PC as a builder:

1. Settings › System › Optional features › add **OpenSSH Server**; start the `sshd` service and set it to automatic.
2. Put the build machine's public key in `C:\ProgramData\ssh\administrators_authorized_keys` (administrator accounts) or
   `%USERPROFILE%\.ssh\authorized_keys`, and add a `Host` entry in the build machine's `~/.ssh/config`.
3. Install Node.js (the script expects `C:\Program Files\nodejs`). `tar` and `scp` come with Windows.
4. `NV_WIN_BUILDER=<host>`. The first build installs electron-builder into `C:\nv-build\tools` from the tools
   folder's lockfile and fills `C:\nv-build\cache` (about a minute more).

Everything the builder keeps is under `C:\nv-build` (`tools`, `cache`, `npm-cache`); delete the folder to remove it
all. Nothing is installed elsewhere and nothing keeps running after a build.

## Renamed from NeuralVault (20 Nov 2026)

What a person sees is Ironleaf. What an earlier install depends on is kept, on purpose:

- **Settings folder**: `%APPDATA%\@neuralspark\vault` (and `~/.config/@neuralspark/vault`), every file name in it.
- **Installer id**: `nsis.guid` in `build-standalone/electron-builder.json` is unchanged, so the installer finds the
  earlier install in the registry and installs over it, in its folder (electron-builder's own behaviour: an install
  from before keeps its folder, e.g. `Programs\NeuralVault`; a new install goes to `Programs\Ironleaf`). The
  installer's folder page would add `\Ironleaf` to such a folder; `build/update-progress.nsh` takes that off.
- **App id**: `com.kaitiaki.neuralvault` stays. Windows knows the app by it (taskbar pins and grouping, the Start
  menu shortcut's identity, notification settings and history); changing it would make an updated install a stranger
  to all of those, with no gain a person could see.
- **NeuralVault.exe**: earlier versions' in-app updater checks and restarts `<folder>\NeuralVault.exe` after
  installing, and taskbar pins point at it. An install over NeuralVault (marked `LegacyExe` in the installer's
  registry key) keeps `NeuralVault.exe` as a hard link to `Ironleaf.exe` (no extra space), which hands over to
  `Ironleaf.exe` as it starts (`src/main/index.ts`). The old Start menu and desktop shortcuts are removed and the
  Ironleaf ones made; the uninstall entry is the same key, now named Ironleaf.
- **Links and the command**: `neuralvault://` and the `neuralvault` command (`neuralvault mcp`) keep working beside
  `ironleaf://` and `ironleaf`. Both schemes are registered; both commands are in the same `bin` folder on the PATH.
- **Update site**: the app reads `https://ironleaf.kaitiaki-it.com/download/latest.json` and falls back to
  `https://neuralvault.kaitiaki-it.com` when that fails. Copies from before the rename read only the old site, so every
  release is published to both.
- **Notes folder**: a new install's default is `Documents\Ironleaf`; where `Documents\NeuralVault` is already there
  it stays the default, and a library chosen in settings is never changed. Both names are searched for vaults.
- **Inside the notes**: the hidden `.neuralvault` folder, front-matter keys and the like are data, not names, and stay.

## Publishing

`--publish` / `--publish-only` copies the files in `dist/release/` into every folder `NV_DOWNLOAD_DIR` names (split
by `:`; for Ironleaf's own site that is both the Ironleaf and the pre-rename NeuralVault download folders). A folder
that is not there is skipped with a line saying so; none there stops the publish. It refuses to publish unless
`latest.json.sig` is present and verifies against `UPDATE_PUBLIC_KEY_PEM` in `src/main/update-check.ts` (still the
placeholder: no publish). It also refuses a test build (`--version` or `--test-identity` builds are never signed
and leave a `.unpublishable` marker in `dist/release/`), a `latest.json` whose version is not `package.json`'s, a
git tree with uncommitted changes, and any file whose SHA-256 (not only its size) differs from `latest.json`. The
folder may be root-owned, so each copy is `sudo -n install` (`NV_PUBLISH_SUDO=0` for a
folder you own):

1. every file is copied under a temporary name (`.<name>.tmp-<pid>`) in the same folder;
2. each is renamed into place (a rename is atomic, so a download never sees half a file);
3. `latest.json.sig`, then `latest.json`, are renamed last, so it never names a file that is not there yet.

If any copy fails, nothing has been renamed and the live files are as they were. It checks that each file is the
size `latest.json` says before it starts.

### Signing latest.json

`latest.json.sig` is a compact JWS (EdDSA, Ed25519) whose payload is `latest.json`'s exact bytes
(`tools/update-sign.mjs`). The app checks it with the public key it embeds before it trusts any size or SHA-256 in
`latest.json`, so a compromised web server cannot hand out a different installer. Make the keypair once, offline, with `node tools/licence-issue.mjs --generate-keypair <dir>` (the same key type); paste the public PEM into
`UPDATE_PUBLIC_KEY_PEM`, keep the private key out of every repository, and release with
`NV_UPDATE_SIGNING_KEY_FILE=<private.pem>`. Use a different key from the licence-signing key.

## How updates reach people (in-app update)

`src/main/update-check.ts` reads `<UPDATE_ORIGIN>/download/latest.json` (and, once the release key is set, `latest.json.sig`; an organisation can move or switch this off by managed policy, docs/EDITIONS.md) 15 seconds after the
start and then once a day (installed copies only; 10 s timeout; a plain GET with nothing about the PC or the
notes). When the version there is higher, the update comes into the app; nobody uninstalls, runs a wizard or visits
the website:

1. **Download.** With Settings › About › "Download updates automatically" on (the default) it downloads by itself
   in the background; off, the banner says "Version X is available" with the notes and **Update**. The banner shows
   the progress in MB (and "only what changed" for a differential download, below).
2. **Check.** The file must be exactly the size and SHA-256 `latest.json` names, or it is deleted and nothing is
   installed (the banner says so and offers "Download from the website").
3. **Restart to update.** The banner says "Ironleaf X is ready". **Restart to update**:
   - *Windows (NSIS install):* Ironleaf quits by its normal path (every window saves first; the tray's
     close-to-tray lets a quit through). As it quits it starts a small PowerShell helper (written next to the
     installer in `<data>\updates\<version>\install-update.ps1`) that waits for the process to be gone, renames the
     install folder aside (`<folder>.nv-previous`), runs the installer silently as an update
     (`/S --updated /D=<the same folder>`: no pages, `${isUpdated}` true in `build/update-progress.nsh`, so per-user
     stays per-user and the folder stays), checks that the program there now reports the new version, deletes the
     old folder and starts Ironleaf again with the same arguments plus `--updated`. If the installer fails, the
     helper deletes what it wrote, renames the old folder back and starts the old version, which says
     "Ironleaf X could not be installed", the reason, "You are still on Y, which works as before", with
     **Download from the website** and **Try again**. What happened is in `<data>\updates\update.log` and
     `update-result.json`. If the person does not restart, the same install runs when they next quit (without
     starting it again); never when Windows is signing out or shutting down.
   - *Linux (AppImage):* the new AppImage is downloaded beside the running one (`.<name>.<version>.part`), checked,
     made executable and renamed over it as soon as it is checked (atomic; the running copy keeps the file it
     opened). **Restart to update** quits normally; a shell outside the AppImage waits for the process to be gone
     and starts the AppImage again. Not running from an AppImage, or a folder Ironleaf may not write: the button
     opens the download page instead.
4. **Updated to X.** The first start of the new version shows "Updated to X" with that release's notes until it
   is closed.

Elsewhere (macOS, a portable zip, a copy not installed by the installer) **Download** opens the download page.

### Small fixes download only what changed

The Windows installer is built with `nsis.differentialPackage: "store-asar"` (`build-standalone/electron-builder.json`):
the app's `app.asar` is stored uncompressed inside the installer, so a code change changes only the blocks around
it. electron-builder writes `Ironleaf-Setup-<version>.exe.blockmap` beside the installer; `release.mjs` copies it
into `dist/release/`, names it in `latest.json` and publishes it (before `latest.json`). The updater keeps the
installer it downloaded (and its block map) in `<data>/updates/<version>/`; the next update downloads the new block
map, copies every unchanged block from that kept installer and downloads only the changed ones as HTTP ranges of
`Ironleaf-Setup-<version>.exe`. The AppImage carries its own block map at its end (electron-builder appends it);
the updater reads the running AppImage's and the new one's (`latest.json` gives its size) and does the same. The
result is checked against the same SHA-256 as a full download; anything odd (no ranges, a missing map, a mismatch)
falls back to the full download. The first in-app update on Windows is a full download (there is no kept installer
yet); every one after it is differential. The cost: the Windows installer is about 46 MB larger (224 MB instead of
178 MB), since the asar is stored rather than compressed.

Measured 20 Nov 2026 with test builds 2.0.1 → 2.0.2 → 2.0.3 (each a one-line code change), served from a Linux machine over
the LAN to the Windows PC and locally under Xvfb for Linux:

| | Download | Time to "Restart to update" | Click → new version's window |
| --- | --- | --- | --- |
| Windows, first in-app update (full) | 223.6 MB | about 14 s at ~17 MB/s (about 40 s at 50 Mbit/s) | about 22 s (quit and save ~1 s, silent install ~16 s, start) |
| Windows, next small fix (differential) | 0.7 to 2.2 MB (of 223.6 MB) | 2 to 7 s (the rest is copied from the kept installer and the whole file's SHA-256 checked) | the same ~22 s |
| Linux AppImage, small fix (differential) | 7.2 to 7.7 MB (of 178.7 MB) | about 1 s | about 1.5 s |

The Windows install time is the installer itself (unpacking 220 MB); it shows no window (`/S`).
A failed install was tested too (a release whose "installer" cannot start): the helper put the previous folder back
within a second, started the previous version, and it said "Ironleaf 2.0.9 could not be installed" with the
reason and the website button.

### latest.json

```json
{ "version": "2.0.1", "date": "2026-11-20", "notes": "…",
  "windows": { "file": "Ironleaf-Setup.exe", "size": 234441193, "sha256": "…", "versioned": "Ironleaf-Setup-2.0.1.exe",
               "blockmap": { "file": "Ironleaf-Setup-2.0.1.exe.blockmap", "size": 286674, "sha256": "…" } },
  "linux":   { "file": "Ironleaf.AppImage", "size": 187413596, "sha256": "…", "versioned": "Ironleaf-2.0.1.AppImage",
               "blockMapSize": 199264 } }
```

`file`/`size`/`sha256` are what the download page reads (unchanged). `versioned`, `blockmap` and `blockMapSize` are
for the updater: it downloads the versioned name, which never changes under a download.

### Testing an update end to end

`node tools/release.mjs --fast --test-identity --version 2.0.1` (then `2.0.2`) builds test versions without
touching `package.json`: `--test-identity` installs as "Ironleaf Update Test" under its own installer id, with no
shortcuts, and its package.json says `testIdentity`, so the app leaves `ironleaf://` links, Open with and the PATH to
the real Ironleaf on the PC (`takesPlaces`, src/main/windows-entry.ts). Neither flag can be
combined with `--publish`. Serve a scratch folder with the newer `latest.json` and installer over HTTP with ranges,
and point a **development** build at it with `NV_UPDATE_ORIGIN=http://127.0.0.1:<port>` (an installed copy never
reads another site; the old `--nv-update-test-origin` switch does nothing there). Install test builds in a
temporary folder (`/S /D=<folder>`) with their own `--user-data-dir`. Without one a test build
keeps its settings, keys and notes in `vault-update-test`, beside the real app's data, and never looks for notes elsewhere
(src/main/test-build.ts).

So a release reaches people as soon as `latest.json` is published: there is nothing else to update.

## The version history (versions.json)

The app's Settings › About and updates lists every release with its notes. Two sources, merged by
`src/shared/version-history.ts`: `CHANGELOG.md`, bundled into the app at build time, and `versions.json` in the
download folder, which the app reads from the same site as `latest.json` (a development build reads
`NV_UPDATE_ORIGIN`). Each publish (`tools/release-versions.mjs`) reads the folder's own `versions.json`, adds or
replaces this release, fills in anything missing from `CHANGELOG.md`, and installs it just before `latest.json`, so
the list only grows and `latest.json` is still the last file to change. `NV_RELEASE_DIR` replaces `dist/release/`
(the publish checks use a scratch folder).
