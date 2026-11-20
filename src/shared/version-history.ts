// Ironleaf's version history (20 Nov 2026). Two sources, one list: CHANGELOG.md at the top of the repo, bundled into
// the app (so the history is there with no network), and versions.json beside latest.json on Ironleaf's website
// (written by tools/release.mjs at each publish, so a release made after this copy was built is listed too). Both are
// read into the same entries and merged here: one entry a version, newest first, the online one's words winning where
// it has any. No Electron, no DOM: the About page, the main side and the release tool all use it
// (tests/version-history.test.mjs).

export interface ReleaseEntry {
  /** x.y.z (a leading v dropped). */
  version: string;
  /** YYYY-MM-DD, or '' when not known. */
  date: string;
  /** Plain text: one line a change ("- " bullets kept as written). */
  notes: string;
  /** Download sizes in bytes, when the release tool knew them. */
  sizes?: { linux?: number; windows?: number };
}

const NOTES_MAX = 4000;
const VERSION = /^v?(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "v2.0" → "2.0.0"; null when it is not a version. */
export function cleanVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = VERSION.exec(v.trim());
  if (!m) return null;
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3] ?? 0)}${m[4] ?? ''}`;
}

/** Newer first: 1 when a is newer than b. A pre-release sorts below its release; anything that is not a version last. */
export function compareReleases(a: string, b: string): -1 | 0 | 1 {
  const ma = VERSION.exec(a);
  const mb = VERSION.exec(b);
  if (!ma || !mb) return ma ? 1 : mb ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const x = Number(ma[i] ?? 0);
    const y = Number(mb[i] ?? 0);
    if (x !== y) return x > y ? 1 : -1;
  }
  const pa = ma[4] ?? '';
  const pb = mb[4] ?? '';
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa > pb ? 1 : -1;
}

const cleanNotes = (s: unknown): string =>
  typeof s === 'string'
    ? s
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .trim()
        .slice(0, NOTES_MAX)
    : '';

const cleanSize = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);

/** One entry from anything shaped like one (versions.json's rows, latest.json itself), or null. */
export function cleanEntry(raw: unknown): ReleaseEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const version = cleanVersion(r.version);
  if (!version) return null;
  const date = typeof r.date === 'string' && DAY.test(r.date.trim()) ? r.date.trim() : '';
  const out: ReleaseEntry = { version, date, notes: cleanNotes(r.notes) };
  // versions.json says sizes:{linux,windows}; latest.json carries them inside each platform's asset.
  const s = (r.sizes && typeof r.sizes === 'object' ? r.sizes : {}) as Record<string, unknown>;
  const asset = (k: string) => (r[k] && typeof r[k] === 'object' ? (r[k] as Record<string, unknown>).size : undefined);
  const linux = cleanSize(s.linux ?? asset('linux'));
  const windows = cleanSize(s.windows ?? asset('windows'));
  if (linux || windows) out.sizes = { ...(linux ? { linux } : {}), ...(windows ? { windows } : {}) };
  return out;
}

/** versions.json's text (or its parsed value): `{"versions":[...]}` or a bare list. Bad JSON or a wrong shape: []. */
export function parseVersionsJson(text: unknown): ReleaseEntry[] {
  let v: unknown = text;
  if (typeof text === 'string') {
    try {
      v = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      return [];
    }
  }
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { versions?: unknown }).versions) ? (v as { versions: unknown[] }).versions : [];
  return mergeVersions(list.slice(0, 500).map(cleanEntry).filter((e): e is ReleaseEntry => !!e));
}

/** CHANGELOG.md read into entries. A release is a level-two heading naming its version, then optionally its date:
 *  `## 2.0.0 — 2026-11-20`, `## [2.0.0] - 2026-11-20`, `## Ironleaf 2.0.0 (2026-11-20)`. Everything under it up to
 *  the next level-two heading is its notes. Anything before the first release heading is the file's own words. */
export function parseChangelog(md: string): ReleaseEntry[] {
  const out: ReleaseEntry[] = [];
  let cur: { version: string; date: string; lines: string[] } | null = null;
  const close = () => {
    if (cur) out.push({ version: cur.version, date: cur.date, notes: cleanNotes(cur.lines.join('\n')) });
    cur = null;
  };
  for (const line of (md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h && !line.startsWith('###')) {
      close();
      const v = /\[?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\]?/.exec(h[1]);
      const version = v ? cleanVersion(v[1]) : null;
      if (!version) continue;
      const d = /(\d{4}-\d{2}-\d{2})/.exec(h[1].slice((v?.index ?? 0) + (v?.[0].length ?? 0)));
      cur = { version, date: d ? d[1] : '', lines: [] };
      continue;
    }
    if (cur) (cur as { lines: string[] }).lines.push(line);
  }
  close();
  return mergeVersions(out);
}

/** One list from several: one entry a version (the first list's wins, then filled from the next where it is empty),
 *  newest first. Pass the online list first so a newer note on the website replaces the bundled one. */
export function mergeVersions(...lists: (readonly ReleaseEntry[] | null | undefined)[]): ReleaseEntry[] {
  const by = new Map<string, ReleaseEntry>();
  for (const list of lists) {
    for (const e of list ?? []) {
      const version = cleanVersion(e?.version);
      if (!version) continue;
      const was = by.get(version);
      if (!was) {
        by.set(version, { ...e, version, ...(e.sizes ? { sizes: { ...e.sizes } } : {}) });
        continue;
      }
      if (!was.date && e.date) was.date = e.date;
      if (!was.notes && e.notes) was.notes = e.notes;
      if (e.sizes) was.sizes = { ...e.sizes, ...was.sizes };
    }
  }
  return [...by.values()].sort((a, b) => compareReleases(b.version, a.version) || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
}

/** The entry for a version (as written anywhere: "v2.0", "2.0.0"), or null. */
export function entryFor(list: readonly ReleaseEntry[], version: string): ReleaseEntry | null {
  const v = cleanVersion(version);
  return (v && list.find((e) => e.version === v)) || null;
}

/** The notes as lines to show: a bullet's dash dropped, headings (### Fixed) kept as their words, blank lines gone. */
export function noteLines(notes: string): { text: string; heading: boolean }[] {
  return cleanNotes(notes)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^#{3,6}\s+/.test(l) ? { text: l.replace(/^#{3,6}\s+/, ''), heading: true } : { text: l.replace(/^[-*•]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'), heading: false }));
}

/** The release tool's step: the published list with this release added (or replaced), newest first, as versions.json. */
export function appendRelease(published: unknown, release: unknown, bundled: readonly ReleaseEntry[] = []): { versions: ReleaseEntry[] } {
  const entry = cleanEntry(release);
  return { versions: mergeVersions(entry ? [entry] : [], parseVersionsJson(published), bundled) };
}

/** The release's channel in words: a pre-release (2.1.0-beta.1) is a beta; anything else is the stable channel. */
export function channelOf(version: string, packaged: boolean): string {
  if (!packaged) return 'Development build';
  const m = /-([a-z]+)/i.exec(version);
  if (!m) return 'Stable';
  const word = m[1].toLowerCase();
  return word === 'rc' ? 'Release candidate' : word.charAt(0).toUpperCase() + word.slice(1);
}
