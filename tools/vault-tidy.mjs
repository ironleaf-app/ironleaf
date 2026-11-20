// node tools/vault-tidy.mjs — The vault tidy on the command line (t238 vault rebuild step 1, 12 Nov 2026).
// Safe by design, in this order:
//
//   node tools/vault-tidy.mjs --dry <vault>            a plain report of what each note becomes, with counts and
//                                                     every line it could not place. Nothing is written.
//   node tools/vault-tidy.mjs --from <vault> --to <folder>
//                                                     copies the vault, tidies the copy, and keeps every changed
//                                                     note's original beside it in a dated backup folder.
//                                                     Never in place: --to refuses the vault itself.
//   node tools/vault-tidy.mjs --restore <backup>       one command puts it all back: the backup's originals
//                                                     written over the vault they came from.
//
// The tidy and the file work are the app's own module (src/main/vault-tidy.ts), built here with the repo's own
// rolldown, so the command line, the app's preview and the tests can never disagree. Made-up vaults only.
import { existsSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The app's tidy module, built with the repo's own rolldown (the tests build it the same way). */
export async function loadTidy() {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-tidy-core-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/vault-tidy.ts'))};\n` + `export * from ${JSON.stringify(path.join(root, 'src/shared/vault-tidy.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  const tidy = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  return { tidy, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

const usage = () => `The vault tidy: the new task shape, safe by design.

  --dry <vault>               report what each note becomes (nothing written)
  --from <vault> --to <folder>  tidy a copy; originals kept in a dated backup folder
  --restore <backup>          put a backup's originals back

Never in place: --to refuses the vault itself. Folders must already make sense
(--from read, --to new or empty); nothing is ever deleted.`;

export async function main(args, out = console.log) {
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes('--help') || args.includes('-h') || !args.length) {
    out(usage());
    return 0;
  }
  let cleanup = null;
  try {
    const loaded = await loadTidy();
    cleanup = loaded.cleanup;
    const tidy = loaded.tidy;
    if (at('--restore')) {
      const { vault, restored } = tidy.restoreBackupFs(at('--restore'));
      out(`Put back ${restored} ${restored === 1 ? 'note' : 'notes'} in ${vault}.`);
      return 0;
    }
    const dry = at('--dry');
    const from = at('--from');
    const to = at('--to');
    if (dry && (from || to)) {
      out('--dry takes only the vault. Nothing was written.');
      return 2;
    }
    if (!dry && !(from && to)) {
      out(usage());
      return 2;
    }
    const src = path.resolve(dry ?? from);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      out(`There is no vault at ${src}. Nothing was written.`);
      return 2;
    }
    if (!dry) {
      const dest = path.resolve(to);
      const real = (p) => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      };
      const srcReal = real(src);
      const destReal = real(dest);
      // Never in place: the copy is not the vault and not inside it (a missing folder counts too).
      if (destReal === srcReal || tidy.containsDirFs(srcReal, destReal)) {
        out('Never in place: pick a folder that is not the vault and not inside it. Nothing was written.');
        return 2;
      }
      if (existsSync(dest) && readdirSync(dest).length) {
        out(`${dest} is not empty. Pick a new or empty folder. Nothing was written.`);
        return 2;
      }
      tidy.copyVaultFs(src, dest);
      const copied = tidy.readVaultFilesFs(dest);
      const { changes, report } = tidy.tidyVault(copied, new Date());
      for (const c of changes) writeFileSync(path.join(dest, ...c.path.split('/')), c.after);
      const backup = changes.length ? tidy.writeBackupFs(dest, tidy.stampOfFs(), changes) : null;
      out(tidy.tidyReportWords(report, false));
      out('');
      out(changes.length ? `Tidied a copy at ${dest}. Originals of ${changes.length} ${changes.length === 1 ? 'note' : 'notes'} kept in ${backup}.` : `The copy at ${dest} is already the new shape. Nothing was changed.`);
      return 0;
    }
    const files = tidy.readVaultFilesFs(src);
    const { report } = tidy.tidyVault(files, new Date());
    out(tidy.tidyReportWords(report, true));
    return 0;
  } finally {
    if (cleanup) cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.log(`The tidy stopped: ${err instanceof Error ? err.message : String(err)} Nothing was written.`);
      process.exit(1);
    },
  );
}
