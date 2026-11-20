// Sensitivity levels and the audit trail on the main side (Wave 4, 24 Oct 2026; the rules are src/shared/sensitivity.ts).
// The vault's sensitivity file (.neuralvault/sensitivity.json: folder and type defaults, files' and assets' levels, each
// agent's access, how Family-private photos are asked for) is read here and written whole, so it syncs and every PC and
// the former host app decide the same. A note's own level is its `sensitivity:` property, read from the index.
//
// The audit trail: one JSON Lines file per PC per month in .neuralvault/audit, so two PCs never write the same file; who
// or what read, saw, changed or was refused which sensitive item, and when (never a secret's value, never an Open item's
// everyday reads). The former host app writes its own lines there the same way.
//
// Agents get in only through a gate made here (src/main/agent-gate.ts): the side chat, outside agents and Full control.

import { promises as fsp, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allows,
  auditFileName,
  auditLine,
  AUDIT_FOLDER,
  decide,
  emptyStore,
  fileLevelOf,
  levelOf,
  parseSensitivity,
  readAuditLine,
  SENSITIVITY_FILE,
  writeSensitivity,
  type AgentId,
  type AuditEntry,
  type Decision,
  type Level,
  type LevelOf,
  type SensitivityStore,
} from '../shared/sensitivity';

export interface SensitivityHost {
  root(): string | null;
  /** A note's properties as the index has them (undefined: not a note the index knows). */
  props(rel: string): Record<string, unknown> | undefined;
  /** This PC's name in the audit trail. */
  pc?: string;
  log?(message: string): void;
}

/** A one-use OK from the person for a Family-private photo (an agent's request, allowed on its card). */
interface Grant {
  who: AgentId;
  rel: string;
  until: number;
}

const GRANT_MS = 10 * 60 * 1000;
const RECHECK_MS = 1500;

export class Sensitivity {
  private cache: { root: string; mtime: number; checked: number; store: SensitivityStore } | null = null;
  private grants: Grant[] = [];
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  readonly pc: string;

  constructor(private host: SensitivityHost) {
    this.pc = host.pc || os.hostname() || 'this PC';
  }

  private file(root: string) {
    return path.join(root, ...SENSITIVITY_FILE.split('/'));
  }

  /** The vault's sensitivity file as it is now (read again when it changed on disk: another PC synced it). */
  store(): SensitivityStore {
    const root = this.host.root();
    if (!root) return emptyStore();
    const now = Date.now();
    if (this.cache && this.cache.root === root && now - this.cache.checked < RECHECK_MS) return this.cache.store;
    let mtime = -1;
    try {
      mtime = statSync(this.file(root)).mtimeMs;
    } catch {
      mtime = -1;
    }
    if (this.cache && this.cache.root === root && this.cache.mtime === mtime) {
      this.cache.checked = now;
      return this.cache.store;
    }
    let store = emptyStore();
    if (mtime >= 0) {
      try {
        store = parseSensitivity(readFileSync(this.file(root), 'utf8'));
      } catch {
        store = emptyStore();
      }
    }
    const changed = !!this.cache && this.cache.mtime !== mtime;
    this.cache = { root, mtime, checked: now, store };
    if (changed) for (const fn of this.listeners) fn();
    return store;
  }

  /** Changes whenever the file does (gates keep their records apart by it). */
  stamp(): string {
    this.store();
    return `${this.cache?.mtime ?? -1}`;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The file changed by `mutate` and written whole (through a temporary file, so it is never half written). */
  async update(mutate: (s: SensitivityStore) => void): Promise<SensitivityStore> {
    const root = this.host.root();
    if (!root) throw new Error('Open a vault first.');
    const run = this.writing.then(async () => {
      this.cache = null;
      const next = structuredClone(this.store());
      mutate(next);
      const abs = this.file(root);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, writeSensitivity(next), 'utf8');
      await fsp.rename(tmp, abs);
      this.cache = null;
    });
    this.writing = run.catch(() => {});
    await run;
    const s = this.store();
    for (const fn of this.listeners) fn();
    return s;
  }

  /** A note's or file's level and where it comes from. */
  levelOf(rel: string): LevelOf {
    // A file kept with a record is as private as its record (a family album's photos are Family-private).
    if (!/\.md$/i.test(rel)) return fileLevelOf(this.store(), rel, (r) => this.host.props(r));
    const props = this.host.props(rel);
    return levelOf(this.store(), rel, props?.sensitivity, props?.type, props?.area);
  }

  level(rel: string): Level {
    return this.levelOf(rel).level;
  }

  allows(who: AgentId, level: Level): boolean {
    return allows(this.store(), who, level);
  }

  /** Whether an agent may have this item now (a Family-private photo: only with the person's OK for this use). */
  decide(who: AgentId, rel: string, name: string): Decision {
    const level = this.level(rel);
    const d = decide(this.store(), who, rel, level, name);
    if (!d.ok && d.consent && this.hasGrant(who, rel)) return { ok: true, level };
    return d;
  }

  // ── One-use OKs for Family-private photos ──

  grant(who: AgentId, rel: string): void {
    this.grants = this.grants.filter((g) => g.until > Date.now() && !(g.who === who && g.rel === rel));
    this.grants.push({ who, rel, until: Date.now() + GRANT_MS });
  }

  private hasGrant(who: AgentId, rel: string): boolean {
    return this.grants.some((g) => g.who === who && g.rel.toLowerCase() === rel.toLowerCase() && g.until > Date.now());
  }

  /** The OK used up (one use). */
  useGrant(who: AgentId, rel: string): boolean {
    const i = this.grants.findIndex((g) => g.who === who && g.rel.toLowerCase() === rel.toLowerCase() && g.until > Date.now());
    if (i < 0) return false;
    this.grants.splice(i, 1);
    return true;
  }

  // ── The audit trail ──

  private auditDir(root: string) {
    return path.join(root, ...AUDIT_FOLDER.split('/'));
  }

  /** One line in this PC's file for the month (written in order; a failure is logged, never thrown at an agent). */
  audit(entry: Omit<AuditEntry, 'at' | 'pc'> & { at?: number }): void {
    const root = this.host.root();
    if (!root) return;
    const e: AuditEntry = { ...entry, at: entry.at ?? Date.now(), pc: this.pc };
    this.writing = this.writing.then(async () => {
      try {
        const dir = this.auditDir(root);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.appendFile(path.join(dir, auditFileName(e.at, this.pc)), auditLine(e), 'utf8');
      } catch (err) {
        this.host.log?.(`Audit trail: a line couldn’t be written (${err instanceof Error ? err.message : String(err)})`);
      }
    });
  }

  /** Waits for lines written so far (tests, export). */
  async settled(): Promise<void> {
    await this.writing;
  }

  /** The trail, newest first, from every PC's files (the last `months` months). */
  async trail(opts: { months?: number; limit?: number } = {}): Promise<AuditEntry[]> {
    await this.settled();
    const root = this.host.root();
    if (!root) return [];
    const dir = this.auditDir(root);
    let names: string[] = [];
    try {
      names = (await fsp.readdir(dir)).filter((n) => /^\d{4}-\d{2} .+\.jsonl$/.test(n));
    } catch {
      return [];
    }
    const months = Math.max(1, opts.months ?? 12);
    const from = new Date();
    from.setMonth(from.getMonth() - (months - 1));
    const first = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
    const out: AuditEntry[] = [];
    for (const n of names.filter((x) => x.slice(0, 7) >= first)) {
      let text = '';
      try {
        text = await fsp.readFile(path.join(dir, n), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const e = readAuditLine(line);
        if (e) out.push(e);
      }
    }
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, opts.limit ?? 5000);
  }
}
