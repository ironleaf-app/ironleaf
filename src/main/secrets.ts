import { addressOf } from '../shared/machine-address';
// Secrets (Wave 4, 24 Oct 2026; module 22 of the life OS: "Passwords, passcodes, licence keys, ID numbers … masked, never
// sent to agents, audit trail"). A locked store inside the vault, beside the Private notes and opened with the same lock:
// the recovery password on any PC, Windows Hello (the OS's protected store) on a PC that was added. Each secret is one
// file with a random name, sealed with the store's key (AES-256-GCM, its id as the extra data), so it syncs with the vault
// encrypted and two PCs adding secrets never write the same file. Nothing outside Ironleaf's window reads a secret:
// the vault never lists or indexes the folder, every agent path refuses it (src/main/agent-gate.ts), and a note holds only
// a locked link to one ("iPad passcode: [locked](secret:…)").
//
// In the window a secret's value shows masked; Reveal shows it for a moment and Copy puts it on the clipboard, cleared
// again after 30 seconds if it is still there. Each reveal, copy and change goes in the audit trail (never the value).

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { PrivateNotes } from './private-notes';
import { SECRET_KINDS } from '../shared/secret-scan';
import type { SecretType, SecretView } from '../shared/secrets';

export const SECRET_TYPES: SecretType[] = [...SECRET_KINDS, 'other'];
/** The truly sensitive kinds: revealing or copying one asks for Windows Hello (or the recovery password) first (8.2). */
export const STEP_UP_KINDS: SecretType[] = ['bank', 'card', 'private-key', 'api-key'];
export const isStepUpKind = (kind: SecretType): boolean => STEP_UP_KINDS.includes(kind);

export interface SecretRecord {
  id: string;
  name: string;
  kind: SecretType;
  value: string;
  /** Who it signs in as, when it is a password. */
  username?: string;
  /** Where it is used: a website, a device, a place. */
  where?: string;
  notes?: string;
  created: number;
  modified: number;
  /** The note it was moved out of by the scanner. */
  from?: string;
}

export interface SecretInput {
  name?: unknown;
  kind?: unknown;
  value?: unknown;
  username?: unknown;
  where?: unknown;
  notes?: unknown;
  from?: unknown;
}

const EXT = '.nvsecret';
const ID = /^[A-Za-z0-9_-]{12}$/;
const words = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '');

export const viewOf = (r: SecretRecord): SecretView => {
  const { value, ...rest } = r;
  return { ...rest, masked: '•'.repeat(Math.min(Math.max(value.length, 6), 16)), length: value.length };
};

export interface SecretsHost {
  store: PrivateNotes;
  trash(abs: string): Promise<void>;
  /** Put on the clipboard, and what is there now (to clear only our own). */
  clipboard: { write(text: string): Promise<void> | void; read(): Promise<string> | string; clear(): void };
  /** How long a copied secret stays on the clipboard (ms). */
  clearAfter?: number;
}

export class SecretsStore {
  private items: Map<string, SecretRecord> | null = null;
  private clearTimer: NodeJS.Timeout | undefined;
  /** What we last put on the clipboard, so lock and quit can take it back (8.2). */
  private copied = '';

  constructor(private host: SecretsHost) {
    host.store.onLock(() => {
      this.forget();
      this.clearClipboardNow();
    });
  }

  private forget(): void {
    if (this.items) for (const r of this.items.values()) r.value = '';
    this.items = null;
  }

  /** Takes our copied words off the clipboard now (locking, quitting), if they are still there. */
  clearClipboardNow(): void {
    clearTimeout(this.clearTimer);
    const value = this.copied;
    this.copied = '';
    if (!value) return;
    void (async () => {
      if ((await this.host.clipboard.read()) === value) this.host.clipboard.clear();
    })().catch(() => {});
  }

  private armClipboardClear(value: string): number {
    this.copied = value;
    const after = this.host.clearAfter ?? 30_000;
    clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => this.clearClipboardNow(), after);
    this.clearTimer.unref?.();
    return Math.round(after / 1000);
  }

  private ready(): void {
    if (!this.host.store.unlocked) throw new Error('This is locked. Unlock it first.');
  }

  /** Every secret read from disk (when opened, or after another PC synced new ones). */
  async load(): Promise<void> {
    this.ready();
    const dir = this.host.store.folder();
    const next = new Map<string, SecretRecord>();
    let names: string[] = [];
    try {
      names = (await fsp.readdir(dir)).filter((n) => n.endsWith(EXT));
    } catch {
      names = [];
    }
    for (const n of names) {
      const id = n.slice(0, -EXT.length);
      if (!ID.test(id)) continue;
      try {
        const r = JSON.parse(this.host.store.openItem(`secret:${id}`, await fsp.readFile(path.join(dir, n), 'utf8'))) as SecretRecord;
        if (r && r.id === id && typeof r.value === 'string' && typeof r.name === 'string') next.set(id, { ...r, kind: SECRET_TYPES.includes(r.kind) ? r.kind : 'other' });
      } catch {
        // One this key can't open (damaged, half-synced) is left on disk as it is.
      }
    }
    this.items = next;
  }

  private async all(): Promise<Map<string, SecretRecord>> {
    this.ready();
    if (!this.items) await this.load();
    return this.items!;
  }

  async list(): Promise<SecretView[]> {
    return [...(await this.all()).values()].map(viewOf).sort((a, b) => a.name.localeCompare(b.name));
  }

  async count(): Promise<number> {
    return this.host.store.unlocked ? (await this.all()).size : 0;
  }

  /** Every secret with its value, for Export everything's "Include my private notes" (31 Oct 2026): unlocked only,
   *  never logged, written only into the person's own export file. No step-up: the export's own warning covers it. */
  async allRecords(): Promise<SecretRecord[]> {
    return [...(await this.all()).values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async put(r: SecretRecord): Promise<void> {
    await this.host.store.writeItem(`${r.id}${EXT}`, this.host.store.sealItem(`secret:${r.id}`, JSON.stringify(r)));
    (await this.all()).set(r.id, r);
  }

  private clean(input: SecretInput, base?: SecretRecord): Omit<SecretRecord, 'id' | 'created' | 'modified'> {
    const name = input.name === undefined && base ? base.name : words(input.name, 120);
    if (!name) throw new Error('Give the secret a name, such as “Wexley St iPad passcode”.');
    const value = input.value === undefined && base ? base.value : typeof input.value === 'string' ? input.value.slice(0, 20000) : '';
    if (!value) throw new Error('The secret itself is empty.');
    const kind = (input.kind === undefined && base ? base.kind : SECRET_TYPES.includes(input.kind as SecretType) ? input.kind : 'other') as SecretType;
    const pick = (k: 'username' | 'where' | 'notes' | 'from', max: number) => {
      const v = input[k] === undefined ? base?.[k] : words(input[k], max);
      return v ? { [k]: v } : {};
    };
    return { name, value, kind, ...pick('username', 200), ...pick('where', 300), ...pick('notes', 4000), ...pick('from', 600) };
  }

  async add(input: SecretInput): Promise<SecretView> {
    const all = await this.all();
    let id = '';
    do id = randomBytes(9).toString('base64url');
    while (all.has(id) || !ID.test(id));
    const now = Date.now();
    const r: SecretRecord = { id, created: now, modified: now, ...this.clean(input) };
    await this.put(r);
    return viewOf(r);
  }

  async update(id: unknown, patch: SecretInput): Promise<SecretView> {
    const all = await this.all();
    const base = typeof id === 'string' ? all.get(id) : undefined;
    if (!base) throw new Error('That secret isn’t there any more.');
    if ((patch.kind !== undefined && patch.kind !== base.kind) || (patch.where !== undefined && patch.where !== base.where)) this.host.store.assertStepUp();
    const r: SecretRecord = { ...base, ...this.clean(patch, base), id: base.id, created: base.created, modified: Date.now() };
    for (const k of ['username', 'where', 'notes', 'from'] as const) if (patch[k] !== undefined && !words(patch[k], 4000)) delete r[k];
    await this.put(r);
    return viewOf(r);
  }

  async get(id: unknown): Promise<SecretView | null> {
    const r = typeof id === 'string' ? (await this.all()).get(id) : undefined;
    return r ? viewOf(r) : null;
  }

  /** The value, for the window's Reveal (and the main side's own Undo of a move). */
  async reveal(id: unknown): Promise<{ name: string; value: string }> {
    const r = typeof id === 'string' ? (await this.all()).get(id) : undefined;
    if (!r) throw new Error('That secret isn’t there any more.');
    if (isStepUpKind(r.kind)) this.host.store.assertStepUp();
    return { name: r.name, value: r.value };
  }

  /** Systems may sign in only to the destination recorded inside the protected login. */
  async useValue(id: unknown, destination: string): Promise<{ username: string; value: string }> {
    const r = typeof id === 'string' ? (await this.all()).get(id) : undefined;
    if (!r) throw new Error('That secret isn’t there any more.');
    if (r.kind !== 'password' && r.kind !== 'private-key') throw new Error('Choose an SSH password or private key in Secrets.');
    const target = addressOf(destination);
    const bound = addressOf(r.where ?? '');
    if (!target || !bound || target.host.toLowerCase() !== bound.host.toLowerCase() || target.port !== bound.port || (bound.user && target.user && bound.user !== target.user)) {
      throw new Error('Open this login in Secrets and enter its SSH host and port under Website, device or place.');
    }
    if (isStepUpKind(r.kind)) this.host.store.assertStepUp();
    return { username: r.username || bound.user || '', value: r.value };
  }

  /** On the clipboard, cleared after a while if it is still what we put there (and at once on lock or quit). */
  async copy(id: unknown): Promise<{ name: string; seconds: number }> {
    const { name, value } = await this.reveal(id);
    await this.host.clipboard.write(value);
    return { name, seconds: this.armClipboardClear(value) };
  }

  /** A locked link for a note, on the clipboard on the same clearing timer as a copied secret (the audit's gap, 8.2). */
  async copyLockedLink(id: unknown): Promise<{ seconds: number }> {
    const r = typeof id === 'string' ? (await this.all()).get(id) : undefined;
    if (!r) throw new Error('That secret isn’t there any more.');
    const link = `[locked](secret:${r.id})`;
    await this.host.clipboard.write(link);
    return { seconds: this.armClipboardClear(link) };
  }

  /** Taken back by an Undo moments after it was made (its value is back where it came from): the sealed file deleted. */
  async discard(id: unknown): Promise<void> {
    const all = await this.all();
    const r = typeof id === 'string' ? all.get(id) : undefined;
    if (!r) return;
    await fsp.rm(path.join(this.host.store.folder(), `${r.id}${EXT}`), { force: true });
    all.delete(r.id);
  }

  /** To the Bin (sealed, as it is on disk). */
  async remove(id: unknown): Promise<SecretView | null> {
    const all = await this.all();
    const r = typeof id === 'string' ? all.get(id) : undefined;
    if (!r) return null;
    await this.host.trash(path.join(this.host.store.folder(), `${r.id}${EXT}`));
    all.delete(r.id);
    return viewOf(r);
  }
}
