// The weekly tidy, on the main side (2 Nov 2026, 10.0 plan item 21; the plan is src/shared/weekly-tidy.ts). Once a
// week, when the notes open (and once a day after), Vault prepares one proposal over every note and says so once in
// the bell; the person applies each line or skips it from Today or the Weekly tidy tab, or through the side chat and
// the former host app (the tidy_list and tidy_apply tools). Nothing is ever deleted for good: emptied and merged-away
// notes go to Recently deleted, and every applied line undoes from its own journal (the note's text before).
//
// Kept in Ironleaf's own data (weekly-tidy.json), for each folder of notes: the week's proposal and what became of
// each line, skipped keys (quiet 30 days), and the journals of applied lines (kept 30 days, then dropped).

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultIndex } from './indexer';
import { mergeNote } from '../shared/vault-merge';
import { suggestInboxHome } from '../shared/inbox-suggest';
import { titleFromPath } from '../shared/markdown';
import { isPrivatePath } from '../shared/private';
import { isProjectProps } from '../shared/project-file';
import { formatDate } from '../shared/dates';
import {
  SKIP_MS,
  WEEK_MS,
  planWeeklyTidy,
  relinkNoteText,
  relinkTargetText,
  tickReminderText,
  tidyNeeds,
  tidyWeekId,
  unlinkNoteText,
  type TidyAction,
  type TidyHome,
  type TidyItem,
  type TidyKind,
  type TidyNote,
} from '../shared/weekly-tidy';
import type { TidyNeed } from '../shared/weekly-tidy';

export type { TidyNeed };

export interface WeeklyTidyHost {
  dataDir: string;
  index: VaultIndex;
  /** The folder of notes open now (null: none yet). */
  library(): string | null;
  /** The note's text now (the index has it). */
  read(rel: string): string | undefined;
  /** Writes a note as the window does (indexed, shown in open tabs, kept in file recovery). */
  write(rel: string, text: string): Promise<void>;
  /** Moves a note, links in every note following it (the same move a rename uses). */
  move(from: string, to: string): Promise<{ path: string }>;
  /** To Recently deleted (the vault's own Bin); never a hard delete. */
  trash(rel: string): Promise<void>;
  /** Whether a note is there now. */
  exists(rel: string): Promise<boolean>;
  /** Settings' templates folder. */
  templatesFolder(): string;
  /** Today's daily note (Settings' Daily notes). */
  dailyToday(): string;
  /** One bell notice per proposal (Reminders.post: said once for its key). */
  post(items: { key: string; kind: string; title: string; body: string; path: string }[]): number;
  /** The proposal changed (prepared, applied, skipped, undone): the window asks again. */
  changed(): void;
  /** A Systems list row a link names (a link to a folded record is not broken). */
  resolveRow?(target: string): string | null;
  now?(): number;
  log?(message: string): void;
}

export type TidyLineStatus = 'waiting' | 'applied' | 'skipped' | 'undone' | 'failed';

export interface TidyLine extends TidyItem {
  status: TidyLineStatus;
  /** Why a line failed, in words (Apply tried and the note had changed underneath). */
  words?: string;
  /** When it was decided (ms). */
  at?: number;
}

export interface TidyProposal {
  /** The week's id ("2026-W45"). */
  week: string;
  preparedAt: number;
  lines: TidyLine[];
  /** Journals of applied lines, newest last (each undoes one line). */
  journals: TidyJournal[];
}

export interface TidyJournal {
  id: string;
  at: number;
  action: TidyAction;
  /** Every note's text before the line ran (a Bin move's note among them: undo writes it back). */
  before: { path: string; text: string }[];
  /** Each note as the line left it (null: gone): undo runs only when every one is still so. */
  after: { path: string; text: string | null }[];
}

export interface TidyStatus {
  /** Whether a proposal waits (its week, when prepared, how many lines still wait). */
  ready: boolean;
  week: string | null;
  preparedAt: number | null;
  waiting: number;
  applied: number;
  skipped: number;
  /** Waiting lines per kind (10.0 whole: the Today card and Settings name what waits). */
  byKind: Record<TidyKind, number>;
  /** When the next proposal is prepared (ms). */
  nextAt: number | null;
}

interface StoredVault {
  proposal: TidyProposal | null;
  skipped: Record<string, number>;
}

interface Stored {
  libraries: Record<string, StoredVault>;
}

const JOURNAL_MS = SKIP_MS;
const libraryKey = (root: string) => path.resolve(root).toLowerCase();
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export class WeeklyTidy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stored: Stored | null = null;
  private file: string;
  private preparing: Promise<TidyProposal | null> | null = null;

  constructor(private host: WeeklyTidyHost) {
    this.file = path.join(host.dataDir, 'weekly-tidy.json');
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private load(): Stored {
    if (this.stored) return this.stored;
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>;
      const libraries: Record<string, StoredVault> = {};
      for (const [k, s] of Object.entries(v.libraries ?? {})) {
        if (!s || typeof s !== 'object') continue;
        libraries[k] = {
          proposal: (s as StoredVault).proposal && typeof (s as StoredVault).proposal === 'object' ? (s as StoredVault).proposal : null,
          skipped: (s as StoredVault).skipped && typeof (s as StoredVault).skipped === 'object' ? (s as StoredVault).skipped : {},
        };
      }
      this.stored = { libraries };
    } catch {
      this.stored = { libraries: {} };
    }
    return this.stored;
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(this.load(), null, 1));
      renameSync(temp, this.file);
    } catch (err) {
      this.host.log?.('Ironleaf could not keep the weekly tidy: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private vault(): StoredVault | null {
    const root = this.host.library();
    if (!root) return null;
    const s = this.load();
    return (s.libraries[libraryKey(root)] ??= { proposal: null, skipped: {} });
  }

  /** Checked when the notes open and once a day after: a new proposal when the week has turned. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.prepare(false), 6 * 3_600_000);
    this.timer.unref?.();
    void this.prepare(false);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stored) this.save();
  }

  /** Whether a proposal waits, for Today, the tab and the side chat. */
  status(): TidyStatus {
    const v = this.vault();
    const p = v?.proposal ?? null;
    const waiting = p?.lines.filter((l) => l.status === 'waiting').length ?? 0;
    const byKind: Record<TidyKind, number> = { duplicate: 0, 'broken-link': 0, empty: 0, thin: 0, 'wrong-place': 0, 'stale-reminder': 0 };
    for (const l of p?.lines ?? []) if (l.status === 'waiting') byKind[l.kind]++;
    return {
      ready: !!p && waiting > 0,
      week: p?.week ?? null,
      preparedAt: p?.preparedAt ?? null,
      waiting,
      applied: p?.lines.filter((l) => l.status === 'applied').length ?? 0,
      skipped: p?.lines.filter((l) => l.status === 'skipped').length ?? 0,
      byKind,
      nextAt: p ? p.preparedAt + WEEK_MS : this.now(),
    };
  }

  /** The proposal, preparing the week's when none is there yet. */
  async get(): Promise<TidyProposal | null> {
    return this.prepare(false);
  }

  /** The waiting lines as Needs you entries: the seam Wave 1 and the former host app read. */
  async needs(): Promise<TidyNeed[]> {
    const p = await this.prepare(false);
    return tidyNeeds((p?.lines ?? []).filter((l) => l.status === 'waiting'));
  }

  /**
   * This week's proposal: the stored one, or a fresh pass when the week has turned (or when asked again on
   * purpose). One bell notice per proposal. A pass with nothing in it is still kept, so the week is quiet.
   */
  prepare(again = false): Promise<TidyProposal | null> {
    if (!this.preparing) this.preparing = this.runPrepare(again).finally(() => (this.preparing = null));
    return this.preparing;
  }

  private async runPrepare(again: boolean): Promise<TidyProposal | null> {
    const v = this.vault();
    if (!v) return null;
    const now = this.now();
    const week = tidyWeekId(now);
    if (!again && v.proposal && now - v.proposal.preparedAt < WEEK_MS) return v.proposal;
    const notes = this.readNotes();
    // The vault's structure read once per pass (projects, people, notes): suggesting a home per note reuses it.
    let filing: { projects: { path: string; name: string; people: string[]; tags: string[]; modified: number }[]; people: { name: string; path: string; names: string[] }[]; notes: { title: string; path: string }[] } | null = null;
    const suggestHome = (p: string): TidyHome | null => {
      filing ??= this.filingContext();
      return this.suggestHomeWith(p, filing);
    };
    const items = planWeeklyTidy({
      notes,
      resolve: (t, from) => this.host.index.resolve(t, from) ?? this.host.index.resolveFile(t, from) ?? this.host.resolveRow?.(t) ?? null,
      suggestHome,
      // Near-duplicates by meaning (10.0 reuse): the on-device model's vectors; notes still on the hashed
      // fallback sit the meaning pass out (src/shared/weekly-tidy.ts), so names and bodies decide for them.
      vectors: (p) => this.host.index.meanings().vectors(p),
      templatesFolder: this.host.templatesFolder(),
      excluded: (p) => this.host.index.isExcluded(p),
      dailyToday: this.host.dailyToday(),
      now,
      skipped: v.skipped,
    });
    const lines: TidyLine[] = items.map((i) => ({ ...i, status: 'waiting' as const }));
    // Journals older than 30 days go with the old proposal.
    const journals = (v.proposal?.journals ?? []).filter((j) => now - j.at < JOURNAL_MS);
    v.proposal = { week, preparedAt: now, lines, journals };
    // Skips older than 30 days can be proposed again.
    for (const [k, at] of Object.entries(v.skipped)) if (now - at >= SKIP_MS) delete v.skipped[k];
    this.save();
    if (lines.length) {
      const n = lines.length;
      this.host.post([
        {
          key: `tidy:${week}`,
          kind: 'tidy',
          title: 'The weekly tidy is ready',
          body: `${n === 1 ? 'One small fix waits' : `${n} small fixes wait`} for a look. Nothing is deleted for good.`,
          path: lines[0].paths[0] ?? '',
        },
      ]);
    }
    this.host.changed();
    return v.proposal;
  }

  /** Every note as the planner reads it (Locked notes never enter, asserted by the test). */
  private readNotes(): TidyNote[] {
    const out: TidyNote[] = [];
    for (const m of this.host.index.allMeta()) {
      if (isPrivatePath(m.path)) continue;
      const content = this.host.index.content(m.path);
      if (content === undefined) continue;
      out.push({ path: m.path, title: m.label || m.title, content, mtime: m.mtime, props: m.props });
    }
    return out;
  }

  /** The vault's structure for filing suggestions (read once per pass, never empty arrays). */
  private filingContext(): { projects: { path: string; name: string; people: string[]; tags: string[]; modified: number }[]; people: { name: string; path: string; names: string[] }[]; notes: { title: string; path: string }[] } {
    const index = this.host.index;
    const metas = index.allMeta();
    return {
      projects: metas.filter((m) => isProjectProps(m.props)).map((m) => ({ path: m.path, name: m.label || m.title, people: [] as string[], tags: [] as string[], modified: m.mtime })),
      people: metas
        .filter((m) => (typeof m.props?.type === 'string' ? m.props.type.toLowerCase() : '') === 'person' && !isPrivatePath(m.path) && !index.isExcluded(m.path))
        .map((m) => ({ name: m.label || m.title, path: m.path, names: [] as string[] })),
      notes: metas.filter((m) => !isProjectProps(m.props) && !isPrivatePath(m.path) && !index.isExcluded(m.path)).map((m) => ({ title: m.label || m.title, path: m.path })),
    };
  }

  /** Where a top-level note belongs, from the vault's real structure (suggestInboxHome, never empty arrays). */
  private suggestHomeWith(notePath: string, filing: { projects: { path: string; name: string; people: string[]; tags: string[]; modified: number }[]; people: { name: string; path: string; names: string[] }[]; notes: { title: string; path: string }[] }): TidyHome | null {
    const index = this.host.index;
    const content = index.content(notePath) ?? '';
    const meta = index.get(notePath);
    const words = `${meta?.label || titleFromPath(notePath)}\n${content.slice(0, 2000)}`;
    const links = (meta?.links ?? []).map((l) => l.target);
    const notes = filing.notes.filter((n) => n.path !== notePath);
    for (const s of suggestInboxHome({ words, text: words, links, task: false }, { projects: filing.projects, people: filing.people, notes, areas: [], resolve: (t) => index.resolve(t) ?? null })) {
      const dir = s.target.path ? dirOf(s.target.path) : '';
      // Into a module or an area is not a folder to move to; the next suggestion may be.
      if (!dir || (s.target.kind !== 'project' && s.target.kind !== 'person' && s.target.kind !== 'note')) continue;
      const name = s.target.kind === 'project' ? `the ${s.target.name} project` : s.target.kind === 'person' ? `${s.target.name}'s folder` : `with ${s.target.name}`;
      return { dir, name, why: s.why };
    }
    return null;
  }

  /** One waiting line applied, journalled for Undo. */
  async apply(id: string): Promise<{ words: string; line: TidyLine }> {
    const v = this.vault();
    const line = v?.proposal?.lines.find((l) => l.id === id);
    if (!v?.proposal || !line) throw new Error('That tidy line is not in this week’s proposal.');
    if (line.status === 'applied') return { words: 'Already applied.', line };
    if (line.status !== 'waiting' && line.status !== 'failed') throw new Error('That line is already decided. Undo brings an applied one back.');
    try {
      const before = this.snapshot(line);
      const words = await this.runAction(line.action);
      line.status = 'applied';
      line.at = this.now();
      line.words = undefined;
      v.proposal.journals.push({ id: line.id, at: this.now(), action: line.action, before, after: this.afterStates(line.action) });
      this.save();
      this.host.changed();
      return { words, line };
    } catch (err) {
      line.status = 'failed';
      line.words = err instanceof Error ? err.message : String(err);
      this.save();
      this.host.changed();
      throw err;
    }
  }

  /** Every waiting line applied in order; each failure is kept on its line, the rest still run. */
  async applyAll(): Promise<{ applied: number; failed: number; words: string }> {
    const v = this.vault();
    const lines = v?.proposal?.lines.filter((l) => l.status === 'waiting' || l.status === 'failed') ?? [];
    let applied = 0;
    for (const l of lines) {
      try {
        await this.apply(l.id);
        applied++;
      } catch {
        // Kept on the line; the rest still run.
      }
    }
    const failed = lines.length - applied;
    const words = !lines.length ? 'Nothing waits.' : failed ? `Applied ${applied} of ${lines.length}. ${failed === 1 ? 'One line failed' : `${failed} lines failed`}: see the list.` : `Applied ${applied === 1 ? 'one fix' : `all ${applied} fixes`}.`;
    return { applied, failed, words };
  }

  /** One line skipped: quiet for 30 days. */
  async skip(id: string): Promise<TidyLine> {
    const v = this.vault();
    const line = v?.proposal?.lines.find((l) => l.id === id);
    if (!v?.proposal || !line) throw new Error('That tidy line is not in this week’s proposal.');
    if (line.status === 'waiting' || line.status === 'failed') {
      line.status = 'skipped';
      line.at = this.now();
      v.skipped[line.key] = this.now();
      this.save();
      this.host.changed();
    }
    return line;
  }

  /** An applied line undone: every note's text before is written back, a moved note moved back. Only while
   *  every note is still as the line left it: anything changed since is left as it is, and said. */
  async undo(id: string): Promise<{ words: string; line: TidyLine }> {
    const v = this.vault();
    const line = v?.proposal?.lines.find((l) => l.id === id);
    const journal = v?.proposal?.journals.find((j) => j.id === id);
    if (!v?.proposal || !line || !journal) throw new Error('There is nothing to undo for that line.');
    if (line.status !== 'applied') throw new Error('Only an applied line can be undone.');
    for (const af of journal.after ?? []) {
      const cur = this.host.read(af.path);
      if ((cur === undefined ? null : cur) !== af.text) throw new Error(`“${titleFromPath(af.path)}” changed since. Undo leaves it as it is.`);
    }
    const a = journal.action;
    if (a.op === 'move' && (await this.host.exists(a.to))) {
      if (await this.host.exists(a.from)) throw new Error(`“${titleFromPath(a.from)}” is already back where it was. Undo leaves both as they are.`);
      await this.host.move(a.to, a.from);
    }
    for (const b of journal.before) {
      const now = this.host.read(b.path);
      if (now === b.text) continue;
      // A Bin move's note is written back as it was (back word for word, its Bin copy leaves Recently deleted).
      await this.host.write(b.path, b.text);
    }
    line.status = 'undone';
    line.at = this.now();
    v.proposal.journals = v.proposal.journals.filter((j) => j !== journal);
    this.save();
    this.host.changed();
    return { words: 'Undone.', line };
  }

  /** Every note an action touches, as it is now (a missing note fails the line before anything is written). */
  private snapshot(line: TidyLine): { path: string; text: string }[] {
    const paths = line.action.op === 'merge' ? [line.action.keep, line.action.drop] : line.action.op === 'move' ? [line.action.from] : [line.action.path];
    return paths.map((p) => {
      const text = this.host.read(p);
      if (text === undefined) throw new Error(`“${titleFromPath(p)}” is not in your notes any more.`);
      return { path: p, text };
    });
  }

  /** Each note as an action left it, read fresh (null: gone): undo runs only while every one is still so. */
  private afterStates(a: TidyAction): { path: string; text: string | null }[] {
    const paths = a.op === 'merge' ? [a.keep, a.drop] : a.op === 'move' ? [a.from, a.to] : [a.path];
    return paths.map((p) => {
      const text = this.host.read(p);
      return { path: p, text: text === undefined ? null : text };
    });
  }

  private async runAction(a: TidyAction): Promise<string> {
    switch (a.op) {
      case 'merge': {
        const keep = this.host.read(a.keep) ?? '';
        const drop = this.host.read(a.drop);
        if (drop === undefined) throw new Error(`“${titleFromPath(a.drop)}” is not in your notes any more.`);
        const day = formatDate('D MMM YYYY', new Date(this.now()));
        const merged = mergeNote(keep, drop, titleFromPath(a.drop), day);
        if (merged.changed) await this.host.write(a.keep, merged.text);
        await this.host.trash(a.drop);
        return `Merged into ${titleFromPath(a.keep)}. ${titleFromPath(a.drop)} is in the Bin.`;
      }
      case 'relink': {
        const content = this.host.read(a.path);
        if (content === undefined) throw new Error('That note is not in your notes any more.');
        const toText = relinkTargetText(a.to, a.from, a.path, (t, from) => this.host.index.resolve(t, from) ?? this.host.index.resolveFile(t, from));
        const next = relinkNoteText(content, a.from, toText);
        if (!next.changed) throw new Error('That link is not in the note any more.');
        await this.host.write(a.path, next.text);
        return `Now points at ${titleFromPath(a.to)}.`;
      }
      case 'unlink': {
        const content = this.host.read(a.path);
        if (content === undefined) throw new Error('That note is not in your notes any more.');
        const next = unlinkNoteText(content, a.target);
        if (!next.changed) throw new Error('That link is not in the note any more.');
        await this.host.write(a.path, next.text);
        return 'The link is gone and the words stay.';
      }
      case 'bin': {
        await this.host.trash(a.path);
        return `${titleFromPath(a.path)} is in the Bin.`;
      }
      case 'move': {
        if (await this.host.exists(a.to)) throw new Error(`Something called ${titleFromPath(a.to)} is already in ${dirOf(a.to)}.`);
        const moved = await this.host.move(a.from, a.to);
        return `Moved to ${dirOf(moved.path) || 'the top'}.`;
      }
      case 'tick': {
        const content = this.host.read(a.path);
        if (content === undefined) throw new Error('That note is not in your notes any more.');
        const next = tickReminderText(content, a.line, a.text, a.due);
        if (!next.changed) throw new Error('That reminder is not in its note any more.');
        await this.host.write(a.path, next.text);
        return 'Marked done.';
      }
    }
  }
}
