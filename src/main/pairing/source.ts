// What every app's reader gives the paired-sources engine (V9, 28 Oct 2026; src/shared/pairing/types.ts): items, each a
// note to be, with the app's own id, its properties, its words as Markdown, and the files that come with it. Links
// between items and to their files are written as small tokens the engine turns into vault links once it knows where
// each note and file goes (an app's links name its own pages and files, never the vault's paths).

import { createHash } from 'node:crypto';
import { cleanFileName } from '../../shared/paths';
import type { PropValue } from '../../shared/frontmatter';
import type { SourceKind } from '../../shared/pairing/types';
import type { ViewDef } from '../../shared/views';

export interface SourceFile {
  /** Unique within the source (the app's own path or hash). */
  key: string;
  /** Its file name in the vault. */
  name: string;
  /** Where it is on disk (an unpacked export), or its bytes (an .enex's pictures). */
  abs?: string;
  data?: Buffer;
}

export interface SourceItem {
  /** The app's own id: stable from one export to the next. */
  id: string;
  title: string;
  /** Folders inside the import folder ("Recipes/Baking"); '' at its top. */
  folder: string;
  props: Record<string, PropValue>;
  /** Markdown, with link tokens (see below). */
  body: string;
  files: SourceFile[];
  /** A journal page's day (YYYY-MM-DD): it goes into the vault's daily notes. */
  day?: string;
}

export interface SourceView {
  /** Its name ("Reading list"); the view file goes beside the folder it shows. */
  name: string;
  /** The folder inside the import folder whose notes it shows. */
  folder: string;
  def: ViewDef;
}

export interface SourceRead {
  kind: SourceKind;
  /** The export's own name (notebook, graph, workspace); '' when it has none worth saying. */
  name: string;
  items: SourceItem[];
  views: SourceView[];
  skipped: { what: string; why: string }[];
}

// ── Link tokens ──────────────────────────────────────────────────────────────────────────────────────────────────────
// \uE000 kind \uE001 target \uE001 label \uE002 — private-use marks no export contains.

export type LinkKind = 'note' | 'embed-note' | 'file' | 'embed-file';
const clean = (s: string) => s.replace(/[\uE000-\uE002]/g, '');

/** A link to another item (`target` its id, with "#heading" or "#^block" after it when it names a part). */
export function linkToken(kind: LinkKind, target: string, label = ''): string {
  return `\uE000${kind}\uE001${clean(target)}\uE001${clean(label).replace(/[|\]\n]/g, ' ').trim()}\uE002`;
}

export const TOKEN = /\uE000(note|embed-note|file|embed-file)\uE001([^\uE001\uE002]*)\uE001([^\uE002]*)\uE002/g;

// ── Small shared helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/** A fingerprint of some words, the same however the line ends or trailing spaces were written. */
export function textHash(text: string): string {
  const norm = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
  return createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 24);
}

export const bytesHash = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 24);

/** A name a file can hold. */
export function fileSafe(raw: string, fallback = 'Untitled'): string {
  return cleanFileName(raw, fallback, 120);
}

/** A tag as a tag can be written (#Home renovation → home-renovation keeps its words). */
export function tagSafe(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/^[-/]+|[-/]+$/g, '');
}

/** A day as YYYY-MM-DD in local time, from a Date. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A moment as "2026-10-28T09:30" in local time (how Ironleaf writes a date and time). */
export function isoMinute(d: Date): string {
  return `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The first words of some text, for a title or a link's label: leading words, never … (t207 pass 2). */
export function firstWords(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).trim();
}
