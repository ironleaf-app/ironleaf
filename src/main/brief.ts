// The morning brief's main side (21 Oct 2026, gap G20; what it shows and how it ranks is src/shared/brief.ts). It gathers
// what the notes on this PC say (reminders and tasks from the hub, the projects from Today's reading, flashcards due),
// today's calendar and the overnight finds from the former host app when it is there, and remembers "Not useful" for this
// vault on this PC (Ironleaf's own data, never the notes). The former host app not there, offline or slow: the brief is
// built from the notes alone, and says nothing about it.

import { buildBrief, cleanFound, cleanPrefs, fromOf, markNotUseful, NO_PREFS, unmarkNotUseful, type Brief, type BriefInput, type BriefItem, type BriefMoney, type BriefPrefs, type FoundItem } from '../shared/brief';
import type { CalendarToday } from '../shared/calendar';
import type { DueGroups } from '../shared/hub';
import type { QuietBriefPerson } from '../shared/people';
import type { TodayData } from '../shared/today';

export interface BriefDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  /** Reminders and tasks due (src/main/hub.ts). */
  due(): DueGroups;
  /** Today's reading of the projects (src/main/today.ts). */
  today(): TodayData;
  /** Today's calendar (src/main/calendar.ts): never throws. */
  calendar(): Promise<CalendarToday>;
  /** Flashcard decks with cards due. */
  decks(): { path: string; title: string; due: number; total: number }[];
  /** Money that warns early (10.0 v2money): null when the module is off. Left out, no money lines. */
  money?(): BriefMoney | null | Promise<BriefMoney | null>;
  /** People gone quiet, each with a drafted check-in (absent: the brief has no people lines). */
  people?(): QuietBriefPerson[];
  /** Events with a meeting note already: the event's id → the note. */
  meetingNotes(): Record<string, string>;
  /** Inside the former host app: its overnight finds (the host's briefItems()); a development build may stand in a file. */
  found?(): Promise<unknown>;
  /** The vault's remembered "Not useful" (Ironleaf's data for this vault). */
  load(): Promise<unknown>;
  save(value: BriefPrefs): Promise<void>;
  now?(): number;
  log?(message: string): void;
}

/** The former host app's finds are asked at most this often (they're made overnight). */
const FOUND_FRESH_MS = 10 * 60_000;
/** How long the former host app gets to answer before the brief goes without its part. */
const FOUND_TIMEOUT_MS = 8000;

export function registerBrief(d: BriefDeps): { brief(): Promise<Brief> } {
  const now = () => d.now?.() ?? Date.now();
  let found: { at: number; items: FoundItem[]; state: Brief['found'] } | null = null;
  /** The last brief's lines, so "Not useful" knows what a line was by its id alone. */
  let last = new Map<string, BriefItem>();
  /** The brief before that's ids: "Not useful" on one is a stale tap (a double tap, a refresh between), quietly done. */
  let prev = new Set<string>();
  /** Lines set aside while Ironleaf is open, for Undo (they're no longer in the brief by then). */
  const marked = new Map<string, BriefItem>();

  async function foundNow(): Promise<{ items: FoundItem[]; state: Brief['found'] }> {
    if (!d.found) return { items: [], state: 'none' };
    if (found && now() - found.at < FOUND_FRESH_MS) return found;
    const was = found?.state ?? 'none';
    let timer: NodeJS.Timeout | undefined;
    try {
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), FOUND_TIMEOUT_MS);
      });
      const raw = await Promise.race([d.found(), late]);
      found = raw === 'late' ? { at: now() - FOUND_FRESH_MS + 60_000, items: [], state: 'failed' } : { at: now(), items: cleanFound(raw), state: 'ok' };
      if (raw === 'late' && was !== 'failed') d.log?.('The brief’s overnight finds did not answer in time. They are tried again.');
    } catch (err) {
      // Offline, or the former host app not answering: said once, asked again in a minute.
      found = { at: now() - FOUND_FRESH_MS + 60_000, items: [], state: 'failed' };
      if (was !== 'failed') d.log?.(`The brief’s overnight finds could not be read (${err instanceof Error ? err.message : String(err)}). They are tried again.`);
    } finally {
      clearTimeout(timer);
    }
    if (found.state === 'ok' && was === 'failed') d.log?.('The brief’s overnight finds are coming through again.');
    return found;
  }

  async function prefs(): Promise<BriefPrefs> {
    try {
      return cleanPrefs(await d.load(), now());
    } catch {
      return NO_PREFS;
    }
  }

  async function brief(): Promise<Brief> {
    const problems: { source: string; words: string }[] = [];
    const [calendar, f, p] = await Promise.all([d.calendar().catch(() => {
      problems.push({ source: 'your calendar', words: 'Today’s events may be missing from this brief.' });
      return null;
    }), foundNow(), prefs()]);
    let projects: BriefInput['projects'] = null;
    try {
      const t = d.today();
      projects = { overdue: t.due.overdue, today: t.due.today, atRisk: t.atRisk, quiet: t.quiet ?? [] };
    } catch {
      problems.push({ source: 'the projects', words: 'Steps and dates due may be missing from this brief.' });
    }
    let due: DueGroups | null = null;
    try {
      due = d.due();
    } catch {
      problems.push({ source: 'reminders and tasks', words: 'Something due may be missing from this brief.' });
    }
    let decks: BriefInput['decks'] = [];
    try {
      decks = d.decks();
    } catch {
      problems.push({ source: 'the flashcard decks', words: 'Cards due may be missing from this brief.' });
    }
    let money: BriefMoney | null = null;
    if (d.money) {
      try {
        money = await d.money();
      } catch {
        problems.push({ source: 'Money', words: 'Bills and spending may be missing from this brief.' });
      }
    }
    let people: BriefInput['people'];
    if (d.people) {
      try {
        people = d.people();
      } catch {
        problems.push({ source: 'the people', words: 'Someone gone quiet may be missing from this brief.' });
      }
    }
    const made = buildBrief({ now: now(), calendar, meetingNotes: d.meetingNotes(), due, projects, decks, ...(people ? { people } : {}), found: f.items, foundState: f.state, prefs: p, problems, money });
    prev = new Set(last.keys());
    last = new Map(made.items.map((i) => [i.id, i]));
    return made;
  }

  d.handle('brief:get', () => brief());
  // "Not useful": the line hidden and its kind ranked lower from now on; Undo puts both back. A line from the brief
  // before (a double tap, a refresh between) is already gone: quietly done, never an error.
  d.handle('brief:not-useful', async (id: unknown) => {
    const item = typeof id === 'string' ? last.get(id) : undefined;
    if (!item) {
      if (typeof id === 'string' && prev.has(id)) return brief();
      throw new Error('That line isn’t in the brief any more.');
    }
    marked.set(item.id, item);
    await d.save(markNotUseful(await prefs(), { ...item, from: fromOf(item) }, now()));
    return brief();
  });
  d.handle('brief:useful-again', async (id: unknown) => {
    const item = typeof id === 'string' ? (marked.get(id) ?? last.get(id) ?? null) : null;
    if (typeof id === 'string') marked.delete(id);
    const p = await prefs();
    if (item) await d.save(unmarkNotUseful(p, { ...item, from: fromOf(item) }, now()));
    else if (typeof id === 'string' && p.hidden[id]) {
      // Hidden since the last brief: shown again, its kind's count left to fade.
      const hidden = { ...p.hidden };
      delete hidden[id];
      await d.save({ ...p, hidden });
    }
    return brief();
  });
  return { brief };
}
