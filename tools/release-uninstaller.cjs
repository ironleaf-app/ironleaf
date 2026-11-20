// Stands in for Wine during the Windows installer build on Linux (tools/release.mjs puts a `wine` that runs this
// first on PATH for that one process). electron-builder needs Wine for exactly one thing when signAndEditExecutable
// is off: it builds a small intermediate installer whose only job is to write the uninstaller, and runs it. Its own
// pure JavaScript reader (UninstallerReader, what it uses on macOS where Wine cannot run 32-bit programs) takes the
// uninstaller out of that file instead, so nothing here needs Wine. Anything else asked of "wine" fails loudly.
const path = require('node:path');

async function main() {
  const [installer, ...rest] = process.argv.slice(2);
  const tools = process.env.NV_BUILDTOOLS;
  if (!tools) throw new Error('NV_BUILDTOOLS is not set.');
  if (!installer || rest.length || !/\.exe$/i.test(installer)) throw new Error('only the uninstaller step is stood in for; asked: ' + process.argv.slice(2).join(' '));
  const { UninstallerReader } = require(require.resolve('app-builder-lib/out/targets/nsis/nsisUtil', { paths: [tools] }));
  // The name electron-builder expects (NsisTarget: `${basename(installer, 'exe')}__uninstaller.exe` in the same folder).
  const uninstaller = path.join(path.dirname(installer), `${path.basename(installer, 'exe')}__uninstaller.exe`);
  await UninstallerReader.exec(installer, uninstaller);
}
main().catch((err) => {
  console.error('release-uninstaller: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
