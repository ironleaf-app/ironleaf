// Shared spaces, on the main side (10.0 item 26, 2 Nov 2026; src/shared/shared-space.ts says what one is). A folder is
// shared when it holds the space bot's marker (`.shared-space.json`, written by the former host app when the bot
// writes), so discovery walks the vault's folders itself (the index never holds dotfiles). The notes come from the
// index, as the Tasks view reads them; the summary is the shared module's, so the Vault home, the Bot space and the
// phone agree.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { VaultIndex } from './indexer';
import { isoOf } from '../shared/hub';
import { inFolder } from '../shared/paths';
import { SPACE_MARKER, parseSpaceMarker, spaceName, summariseSpace, type SharedSpaceListItem, type SpaceNoteInput, type SpaceSummary } from '../shared/shared-space';

export interface SharedSpacesHost {
  /** The vault's folder, or null when none is open. */
  root(): string | null;
  index: VaultIndex;
  now?(): number;
}

export interface SharedSpaceHome {
  folder: string;
  name: string;
  bot: string;
  today: string;
  summary: SpaceSummary;
}

const MAX_FOLDERS = 2000;
const MAX_DEPTH = 6;
const MAX_NOTES = 200;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MARKER = 4096;

export class SharedSpacesService {
  constructor(private host: SharedSpacesHost) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  /** Every folder holding a space marker, shallowest first (bounded: huge vaults still answer). */
  private async marked(root: string): Promise<{ folder: string; bot: string }[]> {
    const out: { folder: string; bot: string }[] = [];
    let seen = 0;
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (out.length >= 50 || seen >= MAX_FOLDERS || depth > MAX_DEPTH) return;
      let entries: { name: string; isDirectory(): boolean }[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        if (!e.isDirectory()) continue;
        seen++;
        const child = path.join(dir, e.name);
        const folder = rel ? `${rel}/${e.name}` : e.name;
        try {
          const s = await stat(path.join(child, SPACE_MARKER));
          if (s.isFile() && s.size <= MAX_MARKER) {
            const marker = parseSpaceMarker(await readFile(path.join(child, SPACE_MARKER), 'utf8'));
            if (marker) out.push({ folder, bot: marker.bot });
          }
        } catch {
          // No marker: an ordinary folder.
        }
        await walk(child, folder, depth + 1);
      }
    };
    await walk(root, '', 0);
    return out.sort((a, b) => a.folder.localeCompare(b.folder));
  }

  private readNotes(folder: string): SpaceNoteInput[] {
    const index = this.host.index;
    const notes: SpaceNoteInput[] = [];
    let bytes = 0;
    for (const m of index.allMeta()) {
      if (notes.length >= MAX_NOTES || bytes >= MAX_BYTES) break;
      if (!m.path.endsWith('.md') || !inFolder(m.path, folder)) continue;
      const content = index.content(m.path) ?? '';
      bytes += content.length;
      notes.push({ path: m.path, title: m.label || m.title, content });
    }
    return notes;
  }

  /** Every shared space with its counts, for the list. */
  async list(): Promise<SharedSpaceListItem[]> {
    const root = this.host.root();
    if (!root) return [];
    const today = isoOf(new Date(this.now()));
    const out: SharedSpaceListItem[] = [];
    for (const s of await this.marked(root)) {
      const summary = summariseSpace(s.folder, this.readNotes(s.folder), today);
      out.push({ folder: s.folder, name: spaceName(s.folder), bot: s.bot, open: summary.counts.open, dueToday: summary.counts.dueToday, overdue: summary.counts.overdue });
    }
    return out;
  }

  /** One space's home (null: no vault, or an ordinary folder). */
  async home(folder: string): Promise<SharedSpaceHome | null> {
    const root = this.host.root();
    if (!root) return null;
    const clean = String(folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!clean || clean.split('/').some((p) => !p || p === '.' || p === '..')) return null;
    let marker: { bot: string } | null = null;
    try {
      marker = parseSpaceMarker(await readFile(path.join(root, ...clean.split('/'), SPACE_MARKER), 'utf8'));
    } catch {
      return null;
    }
    if (!marker) return null;
    const today = isoOf(new Date(this.now()));
    return { folder: clean, name: spaceName(clean), bot: marker.bot, today, summary: summariseSpace(clean, this.readNotes(clean), today) };
  }
}
