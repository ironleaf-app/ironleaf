// Change sets waiting for the person (10.0 Endless Tech, v2changes: "ask for several changes and review them once as a
// set"). When the side chat, the former host app or the bot proposes several edits, they wait here as ONE set — each
// file with its words before and after — kept on disk per library, so a restart never drops what still waits. Accepting
// writes through the host the app gives it (the guarded write, so the relations seam runs as for any save); a file
// changed since it was proposed is left as it is, never misapplied. Private notes never enter. No Electron here, so
// tests drive it directly.

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { acceptWords, isSettled, rejectWords, type ChangeSet, type ChangeSetEntry } from '../shared/change-sets';
import { isPrivatePath } from '../shared/private';
import { cleanAuthor, type VersionAuthor } from '../shared/versions';
import { libraryKey } from './library-state';
import { writeFileAtomic } from './save-guard';

/** Above this the store holds no set (old settled ones go first; what still waits is never dropped). */
const MAX_SETS = 40;
/** Above this many files one ask is refused in words (it was never reviewed as a set anyway). */
const MAX_ENTRIES = 30;
/** Above this many characters one file's words are refused (a set is reviewed, not a library moved). */
const MAX_BODY = 512_000;
/** Settled sets older than this are pruned (their files landed or were left; the history is in File recovery). */
const SETTLED_DAYS = 30;

/** Who may ask through the bridge, in the person's words (null when unknown; src/main/app.ts asks as these names). */
export function askerWords(who: string): string | null {
  if (who === 'neuralspark') return 'Another app';
  if (who === 'neuralbot') return 'Chat bot';
  const bot = /^bot:([\w-]{1,80})$/.exec(who);
  if (bot) return `Chat bot (${bot[1]})`;
  const agent = /^agent:([\w:.-]{1,120})$/.exec(who);
  if (agent) return `Agent (${agent[1]})`;
  return null;
}

export interface OfferEntry {
  path: string;
  name?: string;
  /** Null when it is a new file. */
  base: string | null;
  after: string;
  changes?: string[];
  /** Kept stable (the side chat's proposal id), so its card still answers after a restart. */
  id?: string;
}

export interface ChangeSetHost {
  /** A file's words now, or null when it is gone (a back-link never recreates a note; neither does a set). */
  read(path: string): Promise<string | null>;
  /** The guarded write, credited to `by`; throws in plain words when it does not land. */
  write(path: string, text: string, by?: VersionAuthor): Promise<void>;
}

export interface AcceptDone {
  path: string;
  name: string;
  before: string;
  after: string;
}

export interface AcceptResult {
  words: string;
  accepted: AcceptDone[];
  stale: string[];
  /** To undo the answer's accepted writes as one (the chat's Undo). */
  changes: { path: string; before: string; after: string }[];
}

const cleanPath = (p: string): string => String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
const cleanName = (path: string, name?: string): string => (name?.trim() || path.split('/').pop()!.replace(/\.md$/i, '')).slice(0, 120);

function cleanEntry(e: OfferEntry): ChangeSetEntry | null {
  const at = cleanPath(e.path);
  if (!at || at.split('/').includes('..')) return null;
  const after = String(e.after ?? '');
  const base = e.base === null ? null : String(e.base ?? '');
  if (base !== null && base === after) return null;
  if (after.length > MAX_BODY || (base !== null && base.length > MAX_BODY)) throw new Error(`“${cleanName(at, e.name)}” is too big to review as a change: open it and change it there.`);
  return { id: typeof e.id === 'string' && e.id ? e.id.slice(0, 80) : randomUUID(), path: at, name: cleanName(at, e.name), base, after, changes: (Array.isArray(e.changes) ? e.changes : []).map((c) => String(c).slice(0, 200)).filter(Boolean).slice(0, 12), state: 'waiting' };
}

function cleanLoaded(v: unknown): ChangeSet[] {
  if (!Array.isArray(v)) return [];
  const out: ChangeSet[] = [];
  for (const s of v as Record<string, unknown>[]) {
    if (!s || typeof s.id !== 'string' || !s.id || typeof s.at !== 'number' || !Array.isArray(s.entries)) continue;
    const entries: ChangeSetEntry[] = [];
    for (const e of s.entries as Record<string, unknown>[]) {
      const at = typeof e?.path === 'string' ? cleanPath(e.path) : '';
      if (!e || typeof e.id !== 'string' || !e.id || !at || typeof e.after !== 'string') continue;
      const base = e.base === null ? null : typeof e.base === 'string' ? e.base : null;
      if (base === null && e.base !== null) continue;
      const state = e.state === 'accepted' || e.state === 'rejected' || e.state === 'stale' ? e.state : 'waiting';
      entries.push({ id: e.id.slice(0, 80), path: at, name: typeof e.name === 'string' && e.name ? e.name.slice(0, 120) : at.split('/').pop()!, base, after: e.after.slice(0, MAX_BODY + 1), changes: Array.isArray(e.changes) ? e.changes.filter((c): c is string => typeof c === 'string').map((c) => c.slice(0, 200)).slice(0, 12) : [], state });
    }
    if (!entries.length) continue;
    out.push({ id: s.id.slice(0, 80), at: s.at, askedBy: typeof s.askedBy === 'string' && s.askedBy ? s.askedBy.slice(0, 80) : 'The side chat', ...(cleanAuthor(s.by) ? { by: cleanAuthor(s.by)! } : {}), askWords: typeof s.askWords === 'string' ? s.askWords.slice(0, 300) : '', entries: entries.slice(0, MAX_ENTRIES) });
  }
  return out;
}

export class ChangeSetStore {
  private sets: ChangeSet[] = [];
  private file = '';
  /** Mutations run one at a time (two accepts at once never interleave their read-check-write). */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private host: ChangeSetHost,
    private notify: () => void,
  ) {}

  /** Follows the library that is open (null: nothing waits on screen; the disk keeps every library's own). */
  async use(libraryRoot: string | null): Promise<void> {
    this.sets = [];
    this.file = libraryRoot ? path.join(this.dataDir, 'change-sets', `${libraryKey(libraryRoot)}.json`) : '';
    if (!this.file) return;
    try {
      this.sets = this.pruned(cleanLoaded(JSON.parse(await fsp.readFile(this.file, 'utf8'))));
    } catch {
      this.sets = [];
    }
  }

  private pruned(sets: ChangeSet[]): ChangeSet[] {
    const cutoff = Date.now() - SETTLED_DAYS * 86_400_000;
    const kept = sets.filter((s) => !isSettled(s) || s.at >= cutoff);
    const waiting = kept.filter((s) => !isSettled(s));
    const settled = kept.filter(isSettled).sort((a, b) => b.at - a.at).slice(0, Math.max(0, MAX_SETS - waiting.length));
    return [...waiting, ...settled].sort((a, b) => b.at - a.at);
  }

  private async save(): Promise<void> {
    if (!this.file) return;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, JSON.stringify(this.sets));
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  list(): ChangeSet[] {
    return this.sets.map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e })) }));
  }

  get(id: string): ChangeSet | null {
    const s = this.sets.find((x) => x.id === id);
    return s ? { ...s, entries: s.entries.map((e) => ({ ...e })) } : null;
  }

  /** Every waiting file across every set (the Needs-you count). */
  waitingCount(): number {
    return this.sets.reduce((n, s) => n + s.entries.filter((e) => e.state === 'waiting').length, 0);
  }

  /**
   * Several edits proposed as one set. Private notes never enter (named in `skipped`); files already as proposed are
   * left out. Throws in plain words when nothing waits after that.
   */
  offer(askedBy: string, askWords: string, entries: OfferEntry[], by: VersionAuthor = 'assistant'): Promise<{ set: ChangeSet; skipped: string[] }> {
    return this.run(async () => {
      if (entries.length > MAX_ENTRIES) throw new Error(`That is ${entries.length} files at once: ask for fewer, so each can be reviewed properly.`);
      const skipped: string[] = [];
      const cleaned: ChangeSetEntry[] = [];
      for (const e of entries) {
        if (isPrivatePath(cleanPath(e.path))) {
          skipped.push(cleanName(cleanPath(e.path), e.name));
          continue;
        }
        const c = cleanEntry(e);
        if (c) cleaned.push(c);
      }
      if (!cleaned.length) {
        if (skipped.length) throw new Error(`That is in Private notes, which no change set can hold: open it there.`);
        throw new Error('That leaves every file as it is: nothing to review.');
      }
      const set: ChangeSet = { id: randomUUID(), at: Date.now(), askedBy: askedBy.trim().slice(0, 80) || 'The side chat', by, askWords: String(askWords ?? '').trim().slice(0, 300), entries: cleaned };
      this.sets = this.pruned([set, ...this.sets]);
      await this.save();
      this.notify();
      return { set: this.get(set.id)!, skipped };
    });
  }

  /**
   * Accept one file (`entryId`) or every file still waiting (left out). Each file is read fresh and written only while
   * it still says what it said when proposed; anything changed since stays waiting no longer but stale, named in the
   * words, its file untouched. A new file proposed where one now stands is stale too.
   */
  accept(id: string, entryId?: string): Promise<AcceptResult> {
    return this.run(async () => {
      const set = this.sets.find((x) => x.id === id);
      if (!set) throw new Error('That change set isn’t here any more.');
      const targets = set.entries.filter((e) => (entryId ? e.id === entryId : e.state === 'waiting' || e.state === 'stale') && (e.state === 'waiting' || e.state === 'stale'));
      if (entryId && !targets.length) {
        const e = set.entries.find((x) => x.id === entryId);
        if (!e) throw new Error('That file isn’t in this change set any more.');
        return { words: e.state === 'accepted' ? `“${e.name}” is already accepted.` : `“${e.name}” was left as it is.`, accepted: [], stale: [], changes: [] };
      }
      const accepted: AcceptDone[] = [];
      const stale: string[] = [];
      for (const e of targets) {
        const now = await this.host.read(e.path);
        const lands = e.base === null ? now === null || now === e.after : now === e.after || now === e.base;
        if (!lands) {
          e.state = 'stale';
          stale.push(e.name);
          continue;
        }
        if (now !== e.after) await this.host.write(e.path, e.after, set.by);
        e.state = 'accepted';
        accepted.push({ path: e.path, name: e.name, before: e.base ?? '', after: e.after });
      }
      await this.save();
      this.notify();
      return { words: acceptWords(accepted.map((a) => a.name), stale), accepted, stale, changes: accepted.map((a) => ({ path: a.path, before: a.before, after: a.after })) };
    });
  }

  /** Accept one file by its entry id, whatever set holds it (the chat card's Accept, after a restart too). */
  acceptEntry(entryId: string): Promise<AcceptResult & { setId: string }> {
    const set = this.sets.find((x) => x.entries.some((e) => e.id === entryId));
    if (!set) throw new Error('That proposal isn’t here any more.');
    return this.accept(set.id, entryId).then((r) => ({ ...r, setId: set.id }));
  }

  /** Reject one file or every file still waiting: each stays exactly as it is, and says so. */
  reject(id: string, entryId?: string): Promise<{ words: string; rejected: string[] }> {
    return this.run(async () => {
      const set = this.sets.find((x) => x.id === id);
      if (!set) throw new Error('That change set isn’t here any more.');
      const targets = set.entries.filter((e) => (entryId ? e.id === entryId : true) && (e.state === 'waiting' || e.state === 'stale'));
      if (!targets.length) throw new Error(entryId ? 'That file isn’t waiting any more.' : 'Nothing in that set is waiting any more.');
      for (const e of targets) e.state = 'rejected';
      await this.save();
      this.notify();
      return { words: rejectWords(targets.map((e) => e.name)), rejected: targets.map((e) => e.path) };
    });
  }

  /** A note moved or renamed (or a folder it is in): its waiting edits follow it. */
  renamed(from: string, to: string): Promise<void> {
    return this.run(async () => {
      let touched = false;
      for (const s of this.sets)
        for (const e of s.entries) {
          const next = e.path === from ? to : e.path.startsWith(`${from}/`) ? to + e.path.slice(from.length) : null;
          if (next && (e.state === 'waiting' || e.state === 'stale')) {
            e.path = next;
            touched = true;
          }
        }
      if (!touched) return;
      await this.save();
      this.notify();
    });
  }
}
