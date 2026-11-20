// electron-builder's afterPack hook for tools/release.mjs. On Windows Ironleaf.exe gets its own icon, name and
// version in pure JavaScript (resedit, from the tools folder), because the config keeps signAndEditExecutable off so
// that the Windows installer builds on Linux without Wine. Without this the taskbar shows Electron's icon.
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  // Electron's own sample app never ships (it would answer if the app's files went missing).
  for (const dir of [path.join(context.appOutDir, 'resources')]) rmSync(path.join(dir, 'default_app.asar'), { force: true });
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!existsSync(exe)) throw new Error(`release-after-pack: ${exe} is missing.`);
  const tools = process.env.NV_BUILDTOOLS;
  if (!tools) throw new Error('release-after-pack: NV_BUILDTOOLS is not set (tools/release.mjs sets it).');
  const ResEdit = await require(require.resolve('resedit/cjs', { paths: [tools] })).load();
  const version = context.packager.appInfo.version;
  const [major, minor, patch] = version.split('.').map(Number);
  const executable = ResEdit.NtExecutable.from(readFileSync(exe));
  const resource = ResEdit.NtExecutableResource.from(executable);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
  if (!infos.length) throw new Error('release-after-pack: the exe has no version information.');
  for (const info of infos) {
    info.fixedInfo.fileVersionMS = (major << 16) | minor;
    info.fixedInfo.fileVersionLS = (patch << 16) | 0;
    info.fixedInfo.productVersionMS = (major << 16) | minor;
    info.fixedInfo.productVersionLS = (patch << 16) | 0;
    for (const lang of info.getAllLanguagesForStringValues()) {
      const values = info.getStringValues(lang);
      Object.assign(values, { ProductName: 'Ironleaf', FileDescription: 'Ironleaf', InternalName: 'Ironleaf', OriginalFilename: 'Ironleaf.exe', CompanyName: 'Kaitiaki IT Pty Ltd', LegalCopyright: `Copyright ${new Date().getFullYear()} Kaitiaki IT Pty Ltd`, FileVersion: version, ProductVersion: version });
      info.setStringValues(lang, values);
    }
    info.outputToResourceEntries(resource.entries);
  }
  const iconPath = process.env.NV_RELEASE_ICON;
  if (!iconPath || !existsSync(iconPath)) throw new Error('release-after-pack: NV_RELEASE_ICON does not name the icon.');
  const iconFile = ResEdit.Data.IconFile.from(readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
  if (!groups.length) throw new Error('release-after-pack: the exe has no icon to replace.');
  for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, g.id, g.lang, iconFile.icons.map((i) => i.data));
  resource.outputResource(executable);
  writeFileSync(exe, Buffer.from(executable.generate()));
  // Read back: the stamp and every icon size landed.
  const again = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(readFileSync(exe)));
  const names = ResEdit.Resource.VersionInfo.fromEntries(again.entries).flatMap((info) => info.getAllLanguagesForStringValues().map((lang) => info.getStringValues(lang).ProductName));
  if (!names.length || names.some((n) => n !== 'Ironleaf')) throw new Error('release-after-pack: the version stamp did not land.');
  if (ResEdit.Resource.IconGroupEntry.fromEntries(again.entries).some((g) => g.icons.length !== iconFile.icons.length)) throw new Error('release-after-pack: the icon did not land.');
};
