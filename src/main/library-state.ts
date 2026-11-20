// What Ironleaf remembers about a folder of notes (its open tabs and panels, bookmarks, the graph's settings), one folder
// per library in Ironleaf's own data. Since 24 Oct 2026 (WS1 step 0, "the vault looks the same on every PC") the parts
// that belong to the vault (src/shared/vault-settings.ts STATE_PLAN: bookmarks, the side bar's order, the graph's and the
// timeline's views, templates written, put-away suggestions…) are kept inside the vault too, in
// .neuralvault/state/<name>.json as keyed documents, so every PC that opens it reads the same; this PC's copy here keeps
// everything (its own parts, and the vault's as last read: nothing is lost if the vault's copy goes missing).

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { KeyedFile } from './vault-settings';
import { KeyedQueue, writeFileAtomic } from './save-guard';
import { ID_DIR } from '../shared/vault-home';
import { joinState, moveIn, splitState, STATE_PLAN } from '../shared/vault-settings';

// brief: the morning brief's "Not useful" (src/main/brief.ts, 21 Oct 2026). backup: Settings › Backup and sync's choices
// for this vault (src/main/backup.ts, 21 Oct 2026). dismissed: suggestions put away (24 Oct 2026). home-cards: Home's
// arrangement of its cards (8.7 wave 1).
const NAMES = new Set(['workspace', 'bookmarks', 'graph', 'explorer', 'search', 'projects', 'templates', 'reviews', 'timeline', 'brief', 'backup', 'dismissed', 'home-cards', 'moving-in', 'project-keeps', 'people']);
const MAX_BYTES = 2 * 1024 * 1024;

export function libraryKey(root: string): string {
  return createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 20);
}

const lower = (p: string) => path.resolve(p).toLowerCase();

export class LibraryState {
  /** The vault whose shared parts are read and written in it (the one open), and its documents by name. A foreign
   *  folder opened in place (5 Nov 2026, u3 moving-in) keeps everything on this PC: `shared()` stays null for it. */
  private vault: { root: string; inPlace: boolean; files: Map<string, KeyedFile> } | null = null;
  device: () => string = () => 'this-pc';
  mayWriteVault: () => Promise<boolean> = async () => true;
  log: (message: string) => void = () => undefined;

  constructor(private readonly dataDir: string) {}

  private dir(root: string): string {
    return path.join(this.dataDir, 'libraries', libraryKey(root));
  }

  private file(root: string, name: string): string {
    if (!NAMES.has(name)) throw new Error('Unknown state.');
    return path.join(this.dir(root), `${name}.json`);
  }

  /** The vault opened: its shared parts are read from it and written into it from now on — unless it is a foreign
   *  folder opened in place, which is only ever remembered on this PC. */
  useVault(root: string, o: { inPlace?: boolean } = {}): void {
    if (this.vault && lower(this.vault.root) === lower(root) && this.vault.inPlace === !!o.inPlace) return;
    this.vault = { root, inPlace: !!o.inPlace, files: new Map() };
  }

  /** The vault's own document for a memory with a part that is the vault's (null: none, not the open vault, or a
   *  foreign folder opened in place). */
  private shared(root: string, name: string): KeyedFile | null {
    if (!this.vault || lower(this.vault.root) !== lower(root) || this.vault.inPlace) return null;
    const plan = STATE_PLAN[name];
    if (!plan || (plan.home !== 'vault' && !plan.vault?.length)) return null;
    let f = this.vault.files.get(name);
    if (!f) {
      f = new KeyedFile({
        file: path.join(root, ID_DIR, 'state', `${name}.json`),
        mirror: path.join(this.dir(root), `vault-${name}.json`),
        kind: `state:${name}`,
        device: () => this.device(),
        mayWrite: () => this.mayWriteVault(),
        log: (m) => this.log(m),
      });
      this.vault.files.set(name, f);
    }
    return f;
  }

  private async readLocal(root: string, name: string): Promise<{ value: unknown; mtime: number }> {
    try {
      const file = this.file(root, name);
      const [text, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
      return { value: JSON.parse(text.replace(/^﻿/, '')), mtime: st.mtimeMs };
    } catch {
      return { value: null, mtime: 0 };
    }
  }

  /** Which memories of this vault were moved into it from this PC's copy (once each). */
  private async movedNames(root: string): Promise<Set<string>> {
    try {
      const v = JSON.parse(await fsp.readFile(path.join(this.dir(root), 'moved.json'), 'utf8')) as { names?: unknown };
      return new Set(Array.isArray(v.names) ? v.names.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  async load(root: string, name: string): Promise<unknown> {
    if (!NAMES.has(name)) throw new Error('Unknown state.');
    const local = await this.readLocal(root, name);
    const shared = this.shared(root, name);
    if (!shared) return local.value;
    try {
      await shared.load();
      // One memory's move-in at a time per vault: several load together as the vault opens, and each read moved.json,
      // added its own name and wrote it back, so names were lost (and moved in again).
      await this.movedTurns.run(this.dir(root), async () => {
        const moved = await this.movedNames(root);
        if (moved.has(name)) return;
        // The first time on this PC: what it remembered is brought into the vault (a choice another PC made already, or
        // made since, stays).
        if (local.value !== null) {
          const part = splitState(name, local.value).vault;
          if (part && Object.keys(part).length) await shared.adopt(moveIn(shared.doc, `state:${name}`, part, {}, local.mtime || Date.now(), this.device()).doc);
        }
        moved.add(name);
        await this.writeLocal(path.join(this.dir(root), 'moved.json'), JSON.stringify({ names: [...moved] }));
      });
      return joinState(name, local.value, shared.values());
    } catch (err) {
      this.log(`Ironleaf read ${name} from this PC (the vault’s copy can’t be read now): ${err instanceof Error ? err.message : String(err)}`);
      return local.value;
    }
  }

  async save(root: string, name: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    if (text === undefined || text.length > MAX_BYTES) throw new Error('That is too much to remember.');
    await this.writeLocal(this.file(root, name), text);
    const shared = this.shared(root, name);
    if (!shared) return;
    const part = splitState(name, value).vault;
    if (part && Object.keys(part).length) await shared.set(part).catch((err) => this.log(`Ironleaf kept ${name} on this PC (the vault can’t be written now): ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Read again what another PC may have changed in the vault: the names whose shared part changed. */
  async refresh(): Promise<string[]> {
    if (!this.vault) return [];
    const changed: string[] = [];
    for (const [name, f] of this.vault.files) if (await f.refresh().catch(() => false)) changed.push(name);
    return changed;
  }

  private writes = new KeyedQueue();
  private movedTurns = new KeyedQueue();
  /** One write to a file at a time, each through its own temp (two at once shared one temp: ENOENT, or a mixed file). */
  private writeLocal(file: string, text: string): Promise<void> {
    return this.writes.run(file, async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, text);
    });
  }
}
