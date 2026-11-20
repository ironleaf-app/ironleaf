// The release's version history (20 Nov 2026): versions.json beside latest.json on the website, every release with its
// date, notes and download sizes, newest first. Each publish adds the new release to the list already published in
// that download folder (so nothing earlier is lost), with CHANGELOG.md filling in anything the list never had. The
// app shows it in Settings › About and updates, merged with the history it was built with. The list itself is made by
// src/shared/version-history.ts (the same code the app reads it with), built here into dist/release-work by rolldown,
// which the repo already has. tools/release.mjs calls these; tests/release-versions.test.mjs checks them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let loaded = null;
/** src/shared/version-history.ts as a module this script can use. */
export async function historyModule(root, workDir) {
  if (loaded) return loaded;
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, `version-history-${process.pid}.mjs`);
  await build({ input: path.join(root, 'src', 'shared', 'version-history.ts'), platform: 'node', output: { file: out, format: 'esm' }, logLevel: 'silent' });
  loaded = await import(pathToFileURL(out).href);
  return loaded;
}

/** CHANGELOG.md's entries ([] when it is not there). */
export function bundledHistory(H, root) {
  const file = path.join(root, 'CHANGELOG.md');
  return existsSync(file) ? H.parseChangelog(readFileSync(file, 'utf8')) : [];
}

/** The notes CHANGELOG.md has for this version ('' when none): the release's notes when --notes is not given. */
export function changelogNotes(H, root, version) {
  return H.entryFor(bundledHistory(H, root), version)?.notes ?? '';
}

/** versions.json's text for a download folder: what it already has, this release (from latest.json) added or
 *  replaced, CHANGELOG.md filling in the rest. */
export function versionsText(H, { published, latest, bundled }) {
  return JSON.stringify(H.appendRelease(published ?? null, latest, bundled ?? []), null, 2) + '\n';
}

/** Writes dist/release/versions.json for a download folder (or for none: the release's own copy). */
export function writeVersions(H, { root, releaseDir, downloadDir, latest, file = 'versions.json' }) {
  let published = null;
  try {
    if (downloadDir) published = readFileSync(path.join(downloadDir, 'versions.json'), 'utf8');
  } catch {
    // No list yet in that folder: it starts with this release and CHANGELOG.md.
  }
  const text = versionsText(H, { published, latest, bundled: bundledHistory(H, root) });
  writeFileSync(path.join(releaseDir, file), text);
  return text;
}
