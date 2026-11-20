// Reminders, on the main side (19 Oct 2026, approved them: "remember to order flour on Friday"). The reminders are task
// lines in the notes (src/shared/reminders.ts says how they are written); the index reads them as each note is indexed,
// and this checks them every 30 seconds, when the PC wakes and when the notes open, never reading the disk to do it. A
// reminder due is said once: a Windows notification (a click opens the note at its line) and a notice in the bell, where
// it can be snoozed or ticked. One due while the PC was asleep or off, or Ironleaf closed, is said once when it is back,
// as missed with the time it was for (a week back at most; older ones wait on Today).
//
// What it has said is kept in Ironleaf's own data (reminders.json), for each folder of notes: when it last looked and
// which reminders it has said, so a restart never says one twice. Its notices are kept there too: inside the former host
// app they are also handed to the former host app's bell when the former host app takes them (host.notices.add), and on
// its own Ironleaf's bell shows them with the former host app's.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultIndex } from './indexer';
import type { MirroredNotice, TaskNotice } from '../shared/notices';
import { inFolder } from '../shared/paths';
import { isDormantProjectText } from '../shared/today-count';
import { isDormantOwned, projectLive } from './one-task';
import { dueToFire, groupReminders, locateReminder, moveReminder, nextOccurrence, normReminderText, parseReminderLine, reminderKey, reminderLine, reminderWords, repeatText, rollReminder, setTicked, timeWords, type FireState, type ReminderGroups, type ReminderItem } from '../shared/reminders';

export interface RemindersHost {
  dataDir: string;
  index: VaultIndex;
  /** The folder of notes open now (null: none yet). */
  library(): string | null;
  /** The note's text now (the index has it). */
  read(rel: string): string | undefined;
  /** Writes a note as the window does (indexed, shown in open tabs, kept in file recovery). */
  write(rel: string, text: string): Promise<void>;
  /** Settings › General › Templates folder: reminders in templates are a template's, never said. */
  templatesFolder(): string;
  /** The Windows notification (a click opens the note at the line). */
  show(note: { title: string; body: string; path: string; line: number }): void;
  /** The bell's notices changed (Ironleaf's own reminders). */
  changed(): void;
  /** Inside the former host app, when it takes them: the notice handed to the former host app's bell too. */
  mirror?(notice: MirroredNotice): void;
  now?(): number;
  log?(message: string): void;
}

export interface RemindersView extends ReminderGroups {
  now: number;
}

interface Stored {
  libraries: Record<string, FireState>;
  notices: TaskNotice[];
  /** The modules' notices said already (a bill due on a day, a document expiring), by their key, with when. */
  posted?: Record<string, number>;
}

const CHECK_MS = 30_000;
const SAVE_EVERY = 5 * 60_000;
const KEEP = 40;
const WEEK = 7 * 86_400_000;
// Whole words: bell notices wrap where they show (t207 pass 2).
const clip = (s: string, _n: number) => s;
const libraryKey = (root: string) => path.resolve(root).toLowerCase();
/** The bell's notices kept: unread ones first under the cap (Nov 2026 audit: the cap dropped unread ones silently). */
const trimNotices = (notices: TaskNotice[], now: number): TaskNotice[] => {
  const live = notices.filter((n) => now - n.at < WEEK);
  return [...live.filter((n) => !n.read), ...live.filter((n) => n.read)].slice(0, KEEP);
};

export class Reminders {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stored: Stored | null = null;
  private checking: Promise<void> | null = null;
  private savedAt = 0;
  private file: string;
  /** Notes whose repeats would not roll: said once until they do again (never a line every 30 seconds). */
  private rollFailed = new Set<string>();

  constructor(private host: RemindersHost) {
    this.file = path.join(host.dataDir, 'reminders.json');
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private load(): Stored {
    if (this.stored) return this.stored;
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Stored>;
      this.stored = { libraries: v.libraries && typeof v.libraries === 'object' ? v.libraries : {}, notices: Array.isArray(v.notices) ? v.notices.filter((n) => n && typeof n.id === 'string') : [], posted: v.posted && typeof v.posted === 'object' ? v.posted : {} };
    } catch {
      this.stored = { libraries: {}, notices: [] };
    }
    return this.stored;
  }

  private save(): void {
    const s = this.load();
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(s, null, 1));
      renameSync(temp, this.file);
    } catch (err) {
      this.host.log?.('Ironleaf could not keep what its reminders said: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** Every reminder in the notes (templates and dormant — finished or shelved — projects left out, with their
   *  notes: 5 Nov 2026 one list, they count nowhere), as the index has them. */
  items(): ReminderItem[] {
    return this.collect(false);
  }

  /** Every reminder that can fire (templates left out — a template's is never said): dormant projects' timed
   *  reminders fire and roll too (Nov 2026, b6 break job: "a reminder with a time on a finished project must
   *  still fire" — a promise kept, though it counts nowhere and stays out of every list). */
  fireItems(): ReminderItem[] {
    return this.collect(true);
  }

  private collect(forFire: boolean): ReminderItem[] {
    const t = this.host.templatesFolder() || '';
    const out: ReminderItem[] = [];
    const owner = this.host.index.relations().owner;
    const live = projectLive(this.host.index);
    for (const note of this.host.index.reminders()) {
      if (inFolder(note.path, t)) continue;
      // Dormant projects count nowhere: their reminders stay on their page, out of Due and the count — but a
      // firing check still says them (fireItems above).
      if (!forFire && isDormantProjectText(this.host.index.content(note.path) ?? '')) continue;
      if (!forFire && isDormantOwned(owner.get(note.path) ?? null, live)) continue;
      for (const r of note.items) out.push({ key: reminderKey(note.path, r), path: note.path, title: note.title, line: r.line, text: r.text, due: r.due, timeGiven: r.timeGiven, repeat: r.repeat ? repeatText(r.repeat) : null, done: r.done });
    }
    return out;
  }

  /** Today's card. */
  view(): RemindersView {
    const now = this.now();
    return { now, ...groupReminders(this.items(), now) };
  }

  /** Checking every 30 seconds from now (and once straight away). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref?.();
    void this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.stored) this.save();
  }

  /** Says the reminders due since the last look (one check at a time). */
  check(): Promise<void> {
    if (!this.checking) this.checking = this.run().finally(() => (this.checking = null));
    return this.checking;
  }

  private async run(): Promise<void> {
    const root = this.host.library();
    if (!root) return;
    const s = this.load();
    const key = libraryKey(root);
    const now = this.now();
    const items = this.fireItems();
    const { fire, state } = dueToFire(items, s.libraries[key] ?? { lastCheck: null, fired: {} }, now);
    s.libraries[key] = state;
    // Kept on disk when one was said (so a restart never says it again), else every few minutes: when it last looked
    // only decides which ones come as missed after a restart.
    if (fire.length || now - this.savedAt > SAVE_EVERY || now < this.savedAt) {
      this.savedAt = now;
      this.save();
    }
    if (fire.length) this.say(fire, now);
    // Repeating ones move on to their next time: those just said, those ticked (the box ticked means this one done),
    // and those said before but still overdue (the last move failed: tried again, never left overdue silently).
    const rolls = new Map<string, { line: number; text: string; due: number }[]>();
    for (const i of items) if (i.repeat && (i.done || fire.some((f) => f.item.key === i.key) || (i.due <= now && state.fired[i.key]))) rolls.set(i.path, [...(rolls.get(i.path) ?? []), { line: i.line, text: i.text, due: i.due }]);
    for (const [rel, lines] of rolls) {
      try {
        await this.edit(
          rel,
          (all) => {
            // Found by its words at its moment (Nov 2026 audit): the index's line may have shifted since.
            for (const e of lines) {
              const n = locateReminder(all, e.line, e.text, e.due);
              if (n < 0) continue;
              const next = rollReminder(all[n], now);
              if (next !== null) all[n] = next;
            }
          },
          true,
        );
        if (this.rollFailed.delete(rel)) this.host.log?.(`Ironleaf moved the reminders on in ${rel} again.`);
      } catch (err) {
        // Not written (read-only, or the note is locked by another program): said once, tried again next check.
        if (!this.rollFailed.has(rel)) {
          this.rollFailed.add(rel);
          this.host.log?.(
            `Ironleaf could not move ${lines.length === 1 ? 'a reminder' : `${lines.length} reminders`} on in ${rel} (${err instanceof Error ? err.message : String(err)}). It will try again at the next check.`,
          );
        }
      }
    }
  }

  /** The notification and the bell's notice for each reminder due (several missed at once: one notification). */
  private say(fire: { item: ReminderItem; missed: boolean }[], now: number): void {
    const s = this.load();
    for (const { item, missed } of fire) {
      const body = missed ? `Missed: it was due ${reminderWords(item.due, now)} · ${item.title}` : `${timeWords(item.due)} · ${item.title}`;
      const notice: TaskNotice = { id: randomUUID(), at: now, kind: 'reminder', title: clip(item.text || 'Reminder', 120), body, sessionId: '', read: false, note: item.path, line: item.line, reminder: item.key, due: item.due };
      s.notices.unshift(notice);
      try {
        this.host.mirror?.({ kind: 'reminder', title: notice.title, body, note: item.path, line: item.line, due: item.due, missed });
      } catch {
        // The former host app's bell missing one is no reason to miss the rest.
      }
    }
    s.notices = trimNotices(s.notices, now);
    this.save();
    this.host.changed();
    const missed = fire.filter((f) => f.missed);
    const onTime = fire.filter((f) => !f.missed);
    for (const { item } of onTime.slice(0, 3)) this.host.show({ title: clip(`Reminder: ${item.text || item.title}`, 90), body: `${timeWords(item.due)} · ${item.title}`, path: item.path, line: item.line });
    if (missed.length <= 2) for (const { item } of missed) this.host.show({ title: clip(`Reminder: ${item.text || item.title}`, 90), body: `Missed: it was due ${reminderWords(item.due, now)}.`, path: item.path, line: item.line });
    else if (missed.length) this.host.show({ title: `${missed.length} reminders you missed`, body: clip(missed.map((m) => m.item.text).join(' · '), 180), path: missed[0].item.path, line: missed[0].item.line });
  }

  /**
   * Notices from the modules (src/main/record-modules.ts: a bill due in a few days, a document about to expire, a price
   * that went up), each said once whatever happens: a Windows notification (the first few) and the bell, opening the
   * record's note. `key` names the one occasion ("bill:Me/Finance/Bills/Internet.md:2026-11-03"), so a restart or
   * another check never says it again. `kind` is the module's id (the bell's icon).
   */
  post(items: { key: string; kind: string; title: string; body: string; path: string }[], opts: { quiet?: boolean } = {}): number {
    const s = this.load();
    const now = this.now();
    const posted = (s.posted ??= {});
    const fresh = items.filter((i) => i.key && !posted[i.key]);
    if (!fresh.length) return 0;
    for (const i of fresh) {
      posted[i.key] = now;
      s.notices.unshift({ id: randomUUID(), at: now, kind: i.kind, title: clip(i.title, 120), body: clip(i.body, 300), sessionId: '', read: false, note: i.path, line: 0 });
      // The modules' notices go to the former host app's bell too (3 Nov 2026): the two bells count
      // as one.
      if (i.kind === 'finance' || i.kind === 'documents' || i.kind === 'tidy') {
        try {
          this.host.mirror?.({ kind: i.kind, title: clip(i.title, 120), body: clip(i.body, 300), note: i.path, line: 0, due: now, missed: false });
        } catch {
          // The former host app's bell missing one is no reason to miss the rest.
        }
      }
    }
    // What was said more than a year ago can't come again (its day has gone): the list stays small.
    for (const [k, at] of Object.entries(posted)) if (now - at > 400 * 86_400_000) delete posted[k];
    s.notices = trimNotices(s.notices, now);
    this.save();
    this.host.changed();
    // Quiet lines (the vault check's thin notes) sit in the bell only: no Windows popup for those.
    if (opts.quiet) return fresh.length;
    for (const i of fresh.slice(0, 2)) this.host.show({ title: clip(i.title, 90), body: clip(i.body, 180), path: i.path, line: 0 });
    if (fresh.length > 2) this.host.show({ title: `${fresh.length - 2} more from your modules`, body: clip(fresh.slice(2).map((i) => i.title).join(' · '), 180), path: fresh[2].path, line: 0 });
    return fresh.length;
  }

  /** A note's lines changed by `change` and written back (nothing written when nothing changed). */
  private async edit(rel: string, change: (lines: string[]) => void, quiet = false): Promise<boolean> {
    const text = this.host.read(rel);
    if (text === undefined) return false;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    change(lines);
    const next = lines.join(eol);
    if (next === text) return false;
    try {
      await this.host.write(rel, next);
      return true;
    } catch (err) {
      if (!quiet) this.host.log?.(`Ironleaf could not move a reminder on in ${rel}: ` + (err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  /** Where a reminder (by its key) is now: its note, its line and what that line holds (capitals or punctuation
   *  aside, still the same, so Done and Snooze find it the forgiving way setting does). Resolved among the reminders
   *  that can fire (Nov 2026, b6 break job: the bell's notices name fired ones, dormant projects' included). */
  private find(key: string): { path: string; text: string; due: number; line: number } | null {
    const parts = key.split('\n');
    if (parts.length < 3) return null;
    const p = parts[0];
    const due = Number(parts[parts.length - 1]);
    const text = parts.slice(1, -1).join('\n');
    const items = this.fireItems();
    const item = items.find((i) => i.key === key) ?? items.find((i) => i.path === p && normReminderText(i.text) === normReminderText(text));
    return item ? { path: p, text, due, line: item.line } : null;
  }

  /** Ticked (from Today or a notice): a one-off is done; a repeating one moves on to its next time. */
  async done(key: string): Promise<string> {
    const at = this.find(key);
    if (!at) throw new Error('That reminder isn’t in your notes any more.');
    let words = 'Done.';
    let handled = false;
    await this.edit(at.path, (lines) => {
      const n = locateReminder(lines, at.line, at.text, at.due);
      if (n < 0) return;
      const r = parseReminderLine(lines[n]);
      if (!r) return;
      handled = true;
      if (r.repeat) {
        // Said already, so already moved on: this one is done with nothing more to change. Only when the new
        // time is exactly the next occurrence (fnv3 F47): a time the person moved themselves is a fresh Done.
        if (r.due !== at.due && r.due > this.now() && r.due === nextOccurrence(r.repeat, new Date(at.due), at.due).getTime()) {
          words = `Done. Next: ${reminderWords(r.due, this.now())}.`;
          return;
        }
        const next = rollReminder(setTicked(lines[n], true), this.now());
        if (next) {
          lines[n] = next;
          const moved = parseReminderLine(next);
          if (moved) words = `Done. Next: ${reminderWords(moved.due, this.now())}.`;
        }
      } else lines[n] = setTicked(lines[n], true);
    });
    if (!handled) throw new Error('That reminder isn’t in your notes any more.');
    this.readNotices(key);
    return words;
  }

  /** Unticked (Today's Undo for Done): a one-off done by mistake is open again, at the same time. A repeating
   *  one has already moved on to its next time — there is nothing to put back. */
  async untick(key: string): Promise<string> {
    const at = this.find(key);
    if (!at) throw new Error('That reminder isn’t in your notes any more.');
    let undone = false;
    await this.edit(at.path, (lines) => {
      // The moment names which twin (fnv3 F44), as done and snooze already pass it.
      const n = locateReminder(lines, at.line, at.text, at.due);
      if (n < 0) return;
      const r = parseReminderLine(lines[n]);
      if (!r || r.repeat || !r.done) return;
      lines[n] = setTicked(lines[n], false);
      undone = true;
    });
    if (!undone) throw new Error('That reminder can’t be unticked: a repeating one has already moved on.');
    return 'Not done.';
  }

  /** Snoozed to `until`: a one-off moves to then; a repeating one keeps its own times and gets a one-off line below. */
  async snooze(key: string, until: number): Promise<string> {
    const at = this.find(key);
    if (!at) throw new Error('That reminder isn’t in your notes any more.');
    if (!(until > this.now())) throw new Error('Choose a time still to come.');
    let handled = false;
    await this.edit(at.path, (lines) => {
      const n = locateReminder(lines, at.line, at.text, at.due);
      if (n < 0) return;
      const r = parseReminderLine(lines[n]);
      if (!r) return;
      handled = true;
      if (r.repeat) {
        const indent = /^\s*/.exec(lines[n])?.[0] ?? '';
        // A snooze already sitting below (snoozed twice): moved, never a second line (Nov 2026 audit: it fired twice).
        // It may not be the very next line, and its words are matched as everywhere else (fnv3 F45).
        let belowAt = -1;
        for (let i = n + 1; i < Math.min(lines.length, n + 4); i++) { const b = parseReminderLine(lines[i]); if (b && !b.repeat && normReminderText(b.text) === normReminderText(r.text)) { belowAt = i; break; } if (lines[i].trim() && !b) break; }
        if (belowAt >= 0) lines[belowAt] = setTicked(moveReminder(lines[belowAt], until), false);
        else lines.splice(n + 1, 0, indent + reminderLine(r.text, until));
      } else lines[n] = setTicked(moveReminder(lines[n], until), false);
    });
    if (!handled) throw new Error('That reminder isn’t in your notes any more.');
    this.readNotices(key);
    return `Snoozed until ${reminderWords(until, this.now())}.`;
  }

  /** A note moved or renamed (or a folder it is in): the bell's notices, fired marks and said-once keys follow it,
   *  so ticking and snoozing from the bell keep working and nothing says twice. Quiet when nothing pointed at it. */
  renamed(from: string, to: string): void {
    const s = this.load();
    let touched = false;
    const move = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    for (const n of s.notices) {
      if (n.note) {
        const np = move(n.note);
        if (np !== n.note) {
          n.note = np;
          touched = true;
        }
      }
      if (n.reminder) {
        const [p, ...rest] = n.reminder.split('\n');
        const np = move(p);
        if (np !== p) {
          n.reminder = [np, ...rest].join('\n');
          touched = true;
        }
      }
    }
    for (const lib of Object.values(s.libraries)) {
      for (const [k, at] of Object.entries(lib.fired ?? {})) {
        const [p, ...rest] = k.split('\n');
        const np = move(p);
        if (np !== p) {
          delete lib.fired[k];
          lib.fired[[np, ...rest].join('\n')] = at;
          touched = true;
        }
      }
    }
    // A module's said-once key naming the record's note mid-key ("bill:Me/Finance/Bills/Internet.md:2026-11-03"):
    // the path between its colons follows, so the same occasion never says twice.
    if (s.posted) {
      for (const [k, at] of Object.entries(s.posted)) {
        const next = k === from ? to : k.includes(`:${from}:`) ? k.split(`:${from}:`).join(`:${to}:`) : k.endsWith(`:${from}`) ? k.slice(0, -from.length) + to : k.startsWith(`${from}:`) ? to + k.slice(from.length) : k;
        if (next !== k) {
          delete s.posted[k];
          s.posted[next] = at;
          touched = true;
        }
      }
    }
    if (!touched) return;
    this.save();
    this.host.changed();
  }

  // ── The bell ───────────────────────────────────────────────────────────────────────────────────────────────────────

  notices(): TaskNotice[] {
    const now = this.now();
    return this.load().notices.filter((n) => now - n.at < WEEK);
  }

  has(id: string): boolean {
    return this.load().notices.some((n) => n.id === id);
  }

  get(id: string): TaskNotice | undefined {
    return this.load().notices.find((n) => n.id === id);
  }

  /** A notice kept in this bell only, quietly (3 Nov 2026: the day's due-tasks line is said to the former host app's
   *  bell by due-today.ts, and kept here the same way so both bells count it; no Windows notification, no
   *  mirror). */
  keep(notice: { kind: string; title: string; body: string; note: string; line: number }): TaskNotice {
    const s = this.load();
    const now = this.now();
    const kept: TaskNotice = { id: randomUUID(), at: now, kind: notice.kind, title: clip(notice.title, 120), body: clip(notice.body, 300), sessionId: '', read: false, note: notice.note, line: notice.line };
    s.notices.unshift(kept);
    s.notices = trimNotices(s.notices, now);
    this.save();
    this.host.changed();
    return kept;
  }

  /** One notice read (by its id), or all of them. */
  read(id?: string): void {
    let any = false;
    for (const n of this.load().notices) if ((!id || n.id === id) && !n.read) any = n.read = true;
    if (any) {
      this.save();
      this.host.changed();
    }
  }

  private readNotices(key: string): void {
    let any = false;
    for (const n of this.load().notices) if (n.reminder === key && !n.read) any = n.read = true;
    if (any) {
      this.save();
      this.host.changed();
    }
  }

  clear(): void {
    const s = this.load();
    if (!s.notices.length) return;
    s.notices = [];
    this.save();
    this.host.changed();
  }
}
