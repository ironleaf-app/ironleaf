// The vault tidy inside the app (t238 vault rebuild step 1, 12 Nov 2026): the same shared core the command
// line runs (src/shared/vault-tidy.ts), so the app's preview, the copy it tidies and the CLI can never disagree.
// Behind the Settings › Backups and sync switch (off until turned on): a preview first (a dry run, nothing
// written), then a run on a copy beside the vault, every changed note's original kept in a dated backup folder,
// one command putting it all back. The CLI (tools/vault-tidy.mjs) builds this module for its own file work.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultIndex } from './indexer';
import { tidyReportWords, tidyVault, type TidyChange, type TidyReport } from '../shared/vault-tidy';

/** Every .md file under a vault, as { path (rel, /), text }. Backup folders are never read. */
export function readVaultFilesFs(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const abs = path.join(d, e);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (rel.split('/').includes('.tidy-backup')) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else if (e.toLowerCase().endsWith('.md')) out.push({ path: rel, text: readFileSync(abs, 'utf8') });
    }
  };
  walk(dir);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** A vault copied whole (every file, notes and attachments alike), except earlier backup folders. */
export function copyVaultFs(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    if (e === '.tidy-backup') continue;
    cpSync(path.join(from, e), path.join(to, e), { recursive: true });
  }
}

/** Whether one folder holds another (the same folder counts). */
export function containsDirFs(a: string, b: string): boolean {
  const rel = path.relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A backup stamp: local time, readable in a folder list. */
export const stampOfFs = (d: Date = new Date()): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

/** Every changed note's original written beside the tidied copy, under .tidy-backup/<stamp>/. Returns the folder. */
export function writeBackupFs(vaultDir: string, stamp: string, changes: TidyChange[]): string {
  const dir = path.join(vaultDir, '.tidy-backup', stamp);
  for (const c of changes) {
    const abs = path.join(dir, ...c.path.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, c.before);
  }
  return dir;
}

/** One command puts it all back: a backup folder's originals written over the vault they came from. */
export function restoreBackupFs(backupDir: string): { vault: string; restored: number } {
  const dir = path.resolve(backupDir);
  if (path.basename(path.dirname(dir)) !== '.tidy-backup') throw new Error('That is not a tidy backup folder (a .tidy-backup/<date> folder).');
  const vault = path.dirname(path.dirname(dir));
  if (!existsSync(vault) || !statSync(vault).isDirectory()) throw new Error('The vault that backup came from is not there any more.');
  let restored = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const abs = path.join(d, e);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const target = path.join(vault, path.relative(dir, abs));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(abs, 'utf8'));
        restored++;
      }
    }
  };
  walk(dir);
  return { vault, restored };
}

/** The open vault previewed (a dry run over the index: nothing written, nothing touched). */
export function previewVault(index: VaultIndex, now: Date = new Date()): { report: TidyReport; words: string } {
  const files = index
    .allMeta()
    .filter((m) => m.path.toLowerCase().endsWith('.md') && !m.path.split('/').includes('.tidy-backup'))
    .map((m) => ({ path: m.path, text: index.content(m.path) ?? '' }));
  const { report } = tidyVault(files, now);
  return { report, words: tidyReportWords(report, true) };
}

/** The vault tidied on a copy beside it (`<name>-tidy-<stamp>`), originals kept in its backup folder. The open
 *  vault is never touched. Refuses when the copy cannot be made cleanly (plain words, nothing written). */
export function tidyCopyTo(root: string, now: Date = new Date()): { folder: string; backup: string | null; report: TidyReport; words: string } {
  const dir = path.resolve(root);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('Your notes are not open.');
  const folder = `${dir}-tidy-${stampOfFs(now)}`;
  if (existsSync(folder)) throw new Error('That copy is already there. Try again in a moment.');
  copyVaultFs(dir, folder);
  const files = readVaultFilesFs(folder);
  const { changes, report } = tidyVault(files, now);
  for (const c of changes) writeFileSync(path.join(folder, ...c.path.split('/')), c.after);
  const backup = changes.length ? writeBackupFs(folder, stampOfFs(now), changes) : null;
  return { folder, backup, report, words: tidyReportWords(report, false) };
}
