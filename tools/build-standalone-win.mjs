// node tools/build-standalone-win.mjs — the one-command laptop build for Ironleaf on its own:
// Ironleaf-Setup-<v>.exe, the way the former host app's installer is built (its NSIS packaging whole:
// per user, no admin, Installed apps entry, Start menu shortcut, installer progress). Run in nv/ on the
// build PC. Prerelease: Node.js. Everything else (electron-builder, fuses, resedit) is installed by
// this script.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (words) => { console.error('build-standalone-win: ' + words); process.exit(1); };
if (process.platform !== 'win32') fail('this builds the Windows installer, so it runs on the build PC (Windows).');
const skipBuild = process.argv.includes('--skip-build');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`package.json version ${pkg.version} is not x.y.z.`);
const run = (file, args, o = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...o });

// 1. The app as tools/pack-win.mjs packs it (Electron runtime as Ironleaf.exe, resources/app with the build).
if (!existsSync(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))) run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci']);
if (!skipBuild) {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  run(process.execPath, [path.join(root, 'tools', 'pack-win.mjs')]);
}
const application = path.join(root, 'dist', 'Ironleaf');
const exe = path.join(application, 'Ironleaf.exe');
if (!existsSync(exe)) fail('dist/Ironleaf/Ironleaf.exe is missing (pack-win did not finish).');

// 2. The build tools, pinned to the majors the laptop already builds the former host app with.
const toolsDir = path.join(tmpdir(), 'nv-standalone-build-tools');
const needTools = !existsSync(path.join(toolsDir, 'node_modules', 'electron-builder', 'package.json')) || !existsSync(path.join(toolsDir, 'node_modules', '@electron', 'fuses', 'package.json')) || !existsSync(path.join(toolsDir, 'node_modules', 'resedit', 'package.json'));
if (needTools) {
  mkdirSync(toolsDir, { recursive: true });
  if (!existsSync(path.join(toolsDir, 'package.json'))) writeFileSync(path.join(toolsDir, 'package.json'), JSON.stringify({ name: 'nv-standalone-build-tools', private: true }));
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--no-audit', '--no-fund', 'electron-builder@26', '@electron/fuses', 'resedit'], { cwd: toolsDir });
}
const toolsRequire = (await import('node:module')).createRequire(path.join(toolsDir, 'package.json'));

// 3. The exe's version and name (as the former host app's stamp + version-info): the file and product versions
// are the
// app's, every string is written in the Windows format, and the product name is whole, so Electron reads it
// whole for notifications and the launcher's file-version fallback reads the app's version.
{
  const ResEdit = toolsRequire('resedit');
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const buf = readFileSync(exe);
  const executable = ResEdit.NtExecutable.from(buf);
  const resource = ResEdit.NtExecutableResource.from(executable);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
  if (!infos.length) fail('Ironleaf.exe has no version information.');
  for (const info of infos) {
    info.fixedInfo.fileVersionMS = (major << 16) | minor;
    info.fixedInfo.fileVersionLS = (patch << 16) | 0;
    info.fixedInfo.productVersionMS = (major << 16) | minor;
    info.fixedInfo.productVersionLS = (patch << 16) | 0;
    for (const lang of info.getAllLanguagesForStringValues()) {
      const values = info.getStringValues(lang);
      for (const [key, value] of Object.entries({ ProductName: 'Ironleaf', FileDescription: 'Ironleaf', InternalName: 'Ironleaf', OriginalFilename: 'Ironleaf.exe', FileVersion: pkg.version, ProductVersion: pkg.version })) values[key] = value;
      info.setStringValues(lang, values);
    }
    info.outputToResourceEntries(resource.entries);
  }
  // The exe's own icon: Ironleaf's, not Electron's (16 Nov 2026: the taskbar showed Electron's icon, since
  // signAndEditExecutable is off and nothing else replaced it). Every icon group in the exe gets every size.
  const iconFile = ResEdit.Data.IconFile.from(readFileSync(path.join(root, 'resources', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
  if (!groups.length) fail('Ironleaf.exe has no icon to replace.');
  for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, g.id, g.lang, iconFile.icons.map((i) => i.data));
  resource.outputResource(executable);
  writeFileSync(exe, Buffer.from(executable.generate()));
  const check = ResEdit.Resource.VersionInfo.fromEntries(ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(readFileSync(exe))).entries);
  const names = check.flatMap((info) => info.getAllLanguagesForStringValues().map((lang) => info.getStringValues(lang).ProductName));
  if (!names.length || names.some((n) => n !== 'Ironleaf')) fail('the exe version stamp did not land.');
  const wantIcons = ResEdit.Data.IconFile.from(readFileSync(path.join(root, 'resources', 'icon.ico'))).icons.length;
  const gotIcons = ResEdit.Resource.IconGroupEntry.fromEntries(ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(readFileSync(exe))).entries);
  if (!gotIcons.length || gotIcons.some((g) => g.icons.length !== wantIcons)) fail('Ironleaf\'s icon did not land in the exe.');
  console.log(`build-standalone-win: exe stamped ${pkg.version} (ProductName Ironleaf, Ironleaf's icon).`);
}

// 4. Electron's fuses off in the exe (as the former host app's L4): run-as-Node, NODE_OPTIONS and
// --inspect.
{
  const { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options } = toolsRequire('@electron/fuses');
  const OFF = ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments'];
  await flipFuses(exe, { version: FuseVersion.V1, ...Object.fromEntries(OFF.map((name) => [FuseV1Options[name], false])) });
  const wire = await getCurrentFuseWire(exe);
  const on = OFF.filter((name) => wire[FuseV1Options[name]] !== 48);
  if (on.length) fail('Ironleaf.exe still has these Electron fuses on: ' + on.join(', '));
  console.log('build-standalone-win: Electron fuses off (RunAsNode, NODE_OPTIONS, inspect).');
}

// 5. The installer, from the verified folder above (as the former host app's finish-windows.cjs).
const buildDir = path.join(root, 'dist', 'standalone');
const output = path.join(buildDir, 'dist');
mkdirSync(output, { recursive: true });
for (const entry of readdirSync(output)) if (/\.nsis\.(?:7z|zip)$/.test(entry)) rmSync(path.join(output, entry));
const config = JSON.parse(readFileSync(path.join(root, 'build-standalone', 'electron-builder.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
config.buildVersion = `${pkg.version}.0`;
config.electronVersion = electronVersion;
config.directories = { output, buildResources: path.join(root, 'build-standalone', 'build') };
config.nsis = { ...config.nsis, artifactName: `Ironleaf-Setup-${pkg.version}.exe` };
const configFile = path.join(buildDir, 'builder.json');
mkdirSync(buildDir, { recursive: true });
writeFileSync(configFile, JSON.stringify(config, null, 2));
const cacheRoot = path.join(root, '.cache');
const builderCache = path.join(cacheRoot, 'electron-builder');
const electronCache = path.join(cacheRoot, 'electron');
mkdirSync(builderCache, { recursive: true });
mkdirSync(electronCache, { recursive: true });
// electron-builder reads its project folder's package.json even when prepackaged (16 Nov 2026: the first laptop build
// stopped on "Cannot find package.json in build-standalone"). The former host app's recovery-build carries one the
// same way.
writeFileSync(path.join(root, 'build-standalone', 'package.json'), JSON.stringify({ name: 'ironleaf-standalone-build', version: pkg.version, private: true, description: 'Ironleaf', author: 'Kaitiaki IT' }, null, 2) + '\n');
const built = spawnSync(process.execPath, [path.join(toolsDir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), '--projectDir', path.join(root, 'build-standalone'), '--config', configFile, '--win', 'nsis', '--x64', '--prepackaged', application, '--publish', 'never'], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: builderCache, ELECTRON_CACHE: electronCache, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_7Z_FILTER: 'BCJ' } });
if (built.status !== 0) fail('electron-builder stopped with exit code ' + built.status + '.');
const installer = path.join(output, `Ironleaf-Setup-${pkg.version}.exe`);
if (!existsSync(installer)) fail('the installer was not written.');
const bytes = readFileSync(installer);
const receipt = { applicationVersion: pkg.version, installer, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), electronVersion, builtOn: process.platform, builtAt: new Date().toISOString(), windowsRuntimeTested: false };
writeFileSync(path.join(buildDir, 'build-receipt.json'), JSON.stringify(receipt, null, 2));
console.log(`build-standalone-win: ${path.basename(installer)} (${receipt.bytes} bytes, sha256 ${receipt.sha256}).`);
console.log(`build-standalone-win: receipt ${path.join(buildDir, 'build-receipt.json')}.`);
