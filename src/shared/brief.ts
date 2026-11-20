// The morning brief on Today (21 Oct 2026, gap G20). One calm card at the top of Today with the few things worth knowing
// first: what's next on the calendar, reminders and tasks due or late, project steps due, projects at risk or gone quiet,
// people gone quiet (each with a drafted check-in, never sent by itself), flashcards due, and what the former host app's
// automations found overnight. At most eight lines, the most pressing first, each with the one thing to do about it
// (Open, Make a meeting note, Snooze, Review, Draft check-in, Ask about this). Locked notes and secrets never appear.
//
// Everything but the overnight finds comes from the notes on this PC, so the brief works the same offline and without The
// former host app; the finds come from the former host app when it is there (the host's briefItems(), its GET
// /native-desktop/brief), and are simply left out when it isn't.
//
// "Not useful" on a line hides that line and remembers the kind of line (and where it came from) on this PC, so lines
// like it rank lower in the briefs after. The memory fades: each "Not useful" counts half as much a month later, so a
// kind of line set aside once comes back in time. Pure; src/main/brief.ts gathers the inputs and keeps the memory.

import type { CalendarEvent, CalendarToday } from './calendar';
import { eventTime, startMs } from './calendar';
import { billDueWords, billsDue, priceUpWords, spendOverWords } from './finance';
import type { TightMonth } from './finance';
import type { DueGroups } from './hub';
import { spanWords } from './days';
import type { QuietBriefPerson } from './people';
import { isPrivatePath } from './private';
import type { AtRiskItem, DueItem, QuietItem } from './today';
import { splitRiskTail } from './project-file';

/** Where a line came from: Ironleaf's own notes, or the former host app (its automations' finds). */
export type BriefSource = 'notes' | 'calendar' | 'neuralspark';

export type BriefAction =
  | { kind: 'open'; label: string; path: string; item?: string; line?: number }
  | { kind: 'meeting'; label: string; event: CalendarEvent; date: string }
  | { kind: 'snooze'; label: string; key: string }
  | { kind: 'review'; label: string; path: string }
  | { kind: 'ask'; label: string; words: string }
  | { kind: 'url'; label: string; url: string };

export interface BriefItem {
  /** The line itself: what "Not useful" hides. */
  id: string;
  /** What sort of line: event, reminder, task, step, project, person (gone quiet), cards, bill, spend, price, tight (the next
30 days look tight), problem (a source that failed to read), or a kind the former host app names (found:…). */
  kind: string;
  source: BriefSource;
  title: string;
  detail: string;
  /** How pressing it reads: late (bad), today (warn), or neither. */
  tone: 'bad' | 'warn' | 'none';
  /** Its rank (higher first), after "Not useful" was taken into account. */
  score: number;
  /** The first is its main action; at most two. */
  actions: BriefAction[];
}

export interface Brief {
  generatedAt: number;
  items: BriefItem[];
  /** Lines left out to keep the brief short (the sections below Today's brief still list them). */
  more: number;
  /** The former host app's part: given, not there (Ironleaf on its own, or offline), or it didn't answer. */
  found: 'ok' | 'none' | 'failed';
}

/** At most this many lines; and at most this many of one kind, so one busy kind doesn't fill the brief. */
export const BRIEF_MAX = 8;
export const PER_KIND = 3;

// ── the former host app's overnight finds
// ─ ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the former host app's GET /native-desktop/brief answers (through the host's briefItems()):
 *   { generatedAt: ISO time, items: [{ id?, kind, title, detail?, link?, action?: { label, ask? | url? }, source?,
 *     priority?: 0…1, at?: ISO time }] }
 * kind is a short word (automation, watch, price, news…); link is a web address or a note's path in the vault; action
 * asks Ironleaf's chat (ask: the words put in the chat box, never sent by themselves) or opens a web address.
 */
export interface FoundItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  source: string;
  link?: { url: string } | { path: string };
  action?: { label: string; ask: string } | { label: string; url: string };
  priority: number;
  at?: number;
}

const words = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const webLink = (v: unknown) => {
  const s = words(v, 2000);
  const m = /^(https?):\/\/([^\s"'<>/]+)([^\s"'<>]*)$/i.exec(s);
  if (!m) return '';
  if (m[1].toLowerCase() === 'https') return s;
  // Plain http only where it belongs: loopback, the private ranges, .local and single names (the intranet).
  const host = m[2].toLowerCase();
  if (host.includes('@')) return '';
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.:[\]]+$|\[::1\])/.test(host) || /\.local$/i.test(host) ? s : '';
};
/** A note's path in the vault, written plainly (no climbing out, no drive, no protocol). */
const notePath = (v: unknown) => {
  const s = words(v, 400).replace(/\\/g, '/');
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.split('/').some((p) => p === '..' || p === '.')) return '';
  return s;
};
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** The former host app's answer checked: at most 20 finds, each field its kind; anything else is
nothing. */
export function cleanFound(raw: unknown): FoundItem[] {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(r?.items) ? (r!.items as unknown[]) : [];
  const out: FoundItem[] = [];
  for (const x of list.slice(0, 40)) {
    if (!x || typeof x !== 'object') continue;
    const i = x as Record<string, unknown>;
    const title = words(i.title, 160);
    if (!title) continue;
    const kind = words(i.kind, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'automation';
    const url = webLink(i.link);
    const path = url ? '' : notePath(i.link);
    const a = i.action && typeof i.action === 'object' ? (i.action as Record<string, unknown>) : null;
    const label = a ? words(a.label, 40) : '';
    const ask = a ? words(a.ask, 600) : '';
    const aUrl = a ? webLink(a.url) : '';
    const priority = typeof i.priority === 'number' && Number.isFinite(i.priority) ? Math.max(0, Math.min(1, i.priority)) : 0.5;
    const at = typeof i.at === 'string' && !Number.isNaN(Date.parse(i.at)) ? Date.parse(i.at) : undefined;
    out.push({
      id: `found:${words(i.id, 120) || hash(`${kind}\n${title}`)}`,
      kind,
      title,
      detail: words(i.detail, 300),
      source: words(i.source, 60) || 'Automations',
      ...(url ? { link: { url } } : path ? { link: { path } } : {}),
      ...(label && ask ? { action: { label, ask } } : label && aUrl ? { action: { label, url: aUrl } } : {}),
      priority,
      ...(at !== undefined ? { at } : {}),
    });
    if (out.length >= 20) break;
  }
  return out;
}

// ── "Not useful" ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** What this PC remembers: lines hidden (by id, when), and how often each kind of line was set aside (and when last). */
export interface BriefPrefs {
  hidden: Record<string, number>;
  notUseful: Record<string, { n: number; at: number }>;
}

export const NO_PREFS: BriefPrefs = { hidden: {}, notUseful: {} };
const DAY = 86_400_000;
/** A hidden line is forgotten after this long (its id won't come back by then: they carry their day or their time). */
const HIDE_DAYS = 45;
/** A "Not useful" counts half as much after this many days. */
export const HALF_LIFE_DAYS = 30;

/** The kind of line "Not useful" remembers: its kind and where it came from (the former host app's finds by their source
too). */
export const preferenceKey = (item: Pick<BriefItem, 'kind' | 'source'> & { from?: string }) => `${item.kind}|${item.source}${item.from ? `|${item.from}` : ''}`;

/** The memory checked (a hand-edited or old file never breaks the brief): at most 500 lines and 200 kinds kept. */
export function cleanPrefs(raw: unknown, now = Date.now()): BriefPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hidden: Record<string, number> = {};
  const h = r.hidden && typeof r.hidden === 'object' ? (r.hidden as Record<string, unknown>) : {};
  for (const [id, at] of Object.entries(h)
    .filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && now - (at as number) < HIDE_DAYS * DAY)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 500))
    if (id.length <= 400) hidden[id] = at as number;
  const notUseful: Record<string, { n: number; at: number }> = {};
  const u = r.notUseful && typeof r.notUseful === 'object' ? (r.notUseful as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(u).slice(0, 200)) {
    const x = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    if (!x || k.length > 200 || typeof x.n !== 'number' || typeof x.at !== 'number' || !(x.n > 0)) continue;
    notUseful[k] = { n: Math.min(20, x.n), at: x.at };
  }
  return { hidden, notUseful };
}

/** How much a kind of line has been set aside, today (each "Not useful" fading by half a month). */
export function setAside(prefs: BriefPrefs, key: string, now = Date.now()): number {
  const x = prefs.notUseful[key];
  if (!x) return 0;
  return x.n * Math.pow(0.5, Math.max(0, now - x.at) / (HALF_LIFE_DAYS * DAY));
}

/** "Not useful" on a line: the line hidden, its kind set aside once more (what was there faded to now first). */
export function markNotUseful(prefs: BriefPrefs, item: Pick<BriefItem, 'id' | 'kind' | 'source'> & { from?: string }, now = Date.now()): BriefPrefs {
  const key = preferenceKey(item);
  return {
    hidden: { ...prefs.hidden, [item.id]: now },
    notUseful: { ...prefs.notUseful, [key]: { n: Math.min(20, setAside(prefs, key, now) + 1), at: now } },
  };
}

/** Undo for "Not useful": the line shown again and its kind's count taken back by one. */
export function unmarkNotUseful(prefs: BriefPrefs, item: Pick<BriefItem, 'id' | 'kind' | 'source'> & { from?: string }, now = Date.now()): BriefPrefs {
  const key = preferenceKey(item);
  const hidden = { ...prefs.hidden };
  delete hidden[item.id];
  const notUseful = { ...prefs.notUseful };
  const left = setAside(prefs, key, now) - 1;
  if (left > 0.05) notUseful[key] = { n: left, at: now };
  else delete notUseful[key];
  return { hidden, notUseful };
}

/** A line's rank after "Not useful": each time its kind was set aside takes off about a third (never below a tenth). */
export function adjusted(score: number, aside: number): number {
  return score * Math.max(0.1, Math.pow(0.65, aside));
}

// ── Building the brief ───────────────────────────────────────────────────────────────────────────────────────────────

/** Money for the brief (10.0 v2money): due bills, categories well over usual, prices that went up. */
export interface BriefMoneyBill {
  path: string;
  name: string;
  amount: number | null;
  next: string | null;
  days: number | null;
  overdue: boolean;
  autopay: boolean;
  /** When it was last paid (3 Nov 2026, fourth-round G1: just-paid rows are paid, never due, like the Bills card). */
  paid: string | null;
}
export interface BriefMoneySpend {
  category: string;
  spent: number;
  usual: number;
  months: number;
  month: string;
  /** Its spending month note, when there is one to open. */
  path: string | null;
}
export interface BriefMoneyPrice {
  path: string;
  name: string;
  from: number;
  to: number;
  date: string;
}
export interface BriefMoney {
  currency: string;
  /** YYYY-MM-DD. */
  today: string;
  remindDays: number;
  bills: BriefMoneyBill[];
  over: BriefMoneySpend[];
  prices: BriefMoneyPrice[];
  /** The 30-day tight sentence, when the days look tight (left out: calm, or nothing to measure against). */
  tight?: TightMonth | null;
}

export interface BriefInput {
  now: number;
  /** Today's calendar from the former host app (null: none). */
  calendar: CalendarToday | null;
  /** Events that have a meeting note already: the event's id → the note's path. */
  meetingNotes: Record<string, string>;
  /** Reminders and tasks in the notes (src/main/hub.ts). */
  due: DueGroups | null;
  /** The projects: steps and dates due, at risk, gone quiet (src/shared/today.ts). */
  projects: { overdue: DueItem[]; today: DueItem[]; atRisk: AtRiskItem[]; quiet: QuietItem[] } | null;
  /** Flashcard decks with cards due (notebook mode). */
  decks: { path: string; title: string; due: number; total: number }[];
  /** People gone quiet, longest silent first (src/shared/people.ts quietBriefPeople; absent: none). */
  people?: QuietBriefPerson[];
  /** The former host app's overnight finds (checked by cleanFound), and whether it answered. */
  found: FoundItem[];
  foundState: Brief['found'];
  prefs: BriefPrefs;
  /** Sources that failed to read: each gets its own line, so a failure never renders as a calm brief. */
  problems?: { source: string; words: string }[];
  /** Money (null or left out: the module is off, or nothing was read). */
  money?: BriefMoney | null;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m');
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const late = (days: number) => (days <= 0 ? 'Due today' : days === 1 ? '1 day late' : `${days} days late`);
// Whole words: brief lines wrap where they show (t207 pass 2).
const short = (s: string, _n = 90) => s;
/** A note's name as a person reads it: a daily note's "2026-11-02" title is today's note, or its day in words. */
const noteWords = (title: string, now: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(title || '').trim());
  if (!m) return title;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (dayOf(d.getTime()) === dayOf(now)) return 'Today’s note';
  return `the note for ${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
};
/** The plain word for a line's kind, as the card's tag shows it (never the internal name). */
export function kindWords(kind: string): string {
  const k = String(kind || '').split(':')[0];
  return ({ event: 'Meeting', reminder: 'Reminder', task: 'Task', step: 'Project step', project: 'Project', cards: 'Flashcards', bill: 'Bill', spend: 'Spending', price: 'Price', tight: 'Money', person: 'Person', problem: 'Note', found: 'Found' } as Record<string, string>)[k] ?? 'Note';
}
const lateDays = (iso: string, now: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date(now);
  return Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(y, m - 1, d).getTime()) / DAY);
};

/** Every line the brief could show, with its rank before "Not useful". */
export function candidates(input: BriefInput): BriefItem[] {
  const { now } = input;
  const out: BriefItem[] = [];
  const add = (i: Omit<BriefItem, 'score'> & { base: number }) => {
    const { base, ...rest } = i;
    // Locked notes and secrets never reach the brief (10.0 v2locked): a line opening into the Locked place is
    // left out whole (its title and drafted words could name what is locked).
    if (rest.actions.some((a) => (a.kind === 'open' || a.kind === 'review') && isPrivatePath(a.path))) return;
    out.push({ ...rest, score: base });
  };

  // Sources that failed to read: one honest line each, above the routine but below real dues.
  for (const p of input.problems ?? []) {
    add({ id: `problem:${p.source}`, kind: 'problem', source: 'notes', title: `Couldn’t read ${p.source}`, detail: p.words, tone: 'warn', actions: [], base: 70 });
  }

  // The calendar: the next two events still to come today (or on now), and an all-day one only when nothing else is.
  const cal = input.calendar;
  if (cal && cal.connected) {
    const timed = cal.events.filter((e) => !e.allDay && !e.free && Date.parse(e.end) > now).slice(0, 2);
    const list = timed.length ? timed : cal.events.filter((e) => e.allDay).slice(0, 1);
    for (const e of list) {
      const start = startMs(e);
      const soon = !e.allDay && start - now < 3 * 3600_000;
      const on = !e.allDay && start <= now;
      const note = input.meetingNotes[e.id];
      const where = e.location || (e.meetingLink ? 'Online' : '');
      add({
        id: `event:${e.id}:${cal.date}`,
        kind: 'event',
        source: 'calendar',
        title: e.title,
        detail: [on ? `On now, until ${clock(Date.parse(e.end))}` : eventTime(e, cal.date), where].filter(Boolean).join(' · '),
        tone: on || soon ? 'warn' : 'none',
        actions: [
          note ? { kind: 'open', label: 'Open meeting note', path: note } : { kind: 'meeting', label: 'Make a meeting note', event: e, date: cal.date },
          ...(e.meetingLink ? [{ kind: 'url' as const, label: 'Join', url: e.meetingLink }] : []),
        ],
        base: e.allDay ? 38 : on ? 88 : soon ? 84 : 56,
      });
    }
  }

  // Reminders: late ones (the latest first matters less than how late), and today's still to come.
  const due = input.due;
  if (due) {
    for (const e of [...due.overdue, ...due.today]) {
      if (e.kind === 'reminder') {
        const r = e.item;
        const passed = r.due <= now;
        // A day's note is named by its day: "Daily note" says it better than the date again.
        const where = /^\d{4}-\d{2}-\d{2}$/.test(r.title) ? 'Daily note' : r.title;
        add({
          id: `reminder:${r.key}`,
          kind: 'reminder',
          source: 'notes',
          title: r.text,
          detail: `${passed ? (dayOf(r.due) === dayOf(now) ? `Was at ${clock(r.due)}` : `Was ${new Date(r.due).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`) : `At ${clock(r.due)}`} · ${where}`,
          tone: passed ? 'bad' : 'warn',
          actions: [
            { kind: 'snooze', label: 'Snooze', key: r.key },
            { kind: 'open', label: 'Open', path: r.path, line: r.line },
          ],
          base: passed ? 90 : 72 + (r.due - now < 2 * 3600_000 ? 8 : 0),
        });
      } else {
        const t = e.item;
        const days = t.due ? lateDays(t.due, now) : 0;
        add({
          id: `task:${t.key}:${t.due ?? ''}`,
          kind: 'task',
          source: 'notes',
          title: t.words || t.text,
          detail: `${late(days)} · ${noteWords(t.title, now)}`,
          tone: days > 0 ? 'bad' : 'warn',
          actions: [
            { kind: 'open', label: 'Open', path: t.path, line: t.line },
            { kind: 'ask', label: 'Ask about this', words: `About “${short(t.words || t.text)}” in ${t.title}: ` },
          ],
          base: days > 0 ? 80 - Math.min(days, 10) : 64,
        });
      }
    }
  }

  // Projects: steps and dates late or due today, then projects at risk, then those gone quiet.
  const p = input.projects;
  if (p) {
    // A project's own due date passed is said by its At risk line when it has one (never twice).
    const risky = new Set(p.atRisk.map((x) => x.project));
    for (const x of [...p.overdue, ...p.today]) {
      if (x.kind === 'project' && risky.has(x.project)) continue;
      add({
        id: `step:${x.id}:${x.when}`,
        kind: 'step',
        source: 'notes',
        title: x.what,
        detail: `${late(-x.offset)} · ${x.projectName}${x.who && x.others ? ` · ${x.who}` : ''}`,
        tone: x.offset < 0 ? 'bad' : 'warn',
        actions: [
          // Plain "Open" (10.0 rooms critique, 2 Nov 2026): the detail already names the project, so "Open <project>"
          // only ragged the action column against every other row's Open. "Open meeting note" keeps its what (it
          // pairs with "Make a meeting note").
          { kind: 'open', label: 'Open', path: x.project, item: x.kind === 'project' ? 'due' : x.index === undefined ? undefined : x.kind === 'date' ? `dates:${x.index}` : `next:${x.index}` },
          { kind: 'ask', label: 'Ask about this', words: `About “${short(x.what)}” in ${x.projectName}${x.who ? `, with ${x.who}` : ''}, due ${x.when}: ` },
        ],
        base: x.offset < 0 ? 82 - Math.min(-x.offset, 10) : 66,
      });
    }
    for (const x of p.atRisk) {
      const top = x.risks[0];
      const pastDue = x.dueOffset !== null && x.dueOffset < 0;
      add({
        id: `project:${x.project}:risk:${dayOf(now)}`,
        kind: 'project',
        source: 'notes',
        title: `${x.projectName} is ${pastDue ? 'past its due date' : x.health ? x.health.toLowerCase() : 'at risk'}`,
        detail: top ? `${top.level.charAt(0).toUpperCase()}${top.level.slice(1)} risk: ${short(splitRiskTail(top.what).what, 80)}` : x.next ? `Next: ${short(x.next, 80)}` : 'Nothing next written down',
        tone: x.tone === 'bad' || pastDue ? 'bad' : 'warn',
        actions: [
          { kind: 'open', label: 'Open', path: x.project, ...(x.risks.length ? { item: 'risks' } : {}) },
          { kind: 'ask', label: 'Ask about this', words: `About ${x.projectName}${x.health ? `, which is ${x.health}` : ''}${top ? ` (${top.level} risk: ${splitRiskTail(top.what).what})` : ''}: ` },
        ],
        base: pastDue ? 78 : x.tone === 'bad' ? 74 : 60,
      });
    }
    for (const x of p.quiet) {
      add({
        id: `project:${x.project}:quiet:${dayOf(now)}`,
        kind: 'project',
        source: 'notes',
        title: `${x.projectName} has gone quiet`,
        detail: `Nothing changed for ${x.days} days · ${x.open} ${x.open === 1 ? 'step' : 'steps'} open, next: ${short(x.next, 60)}`,
        tone: 'none',
        actions: [
          { kind: 'open', label: 'Open', path: x.project, item: 'next:0' },
          { kind: 'ask', label: 'Ask about this', words: `${x.projectName} hasn’t moved for ${x.days} days (next: ${x.next}). What should happen next? ` },
        ],
        base: 44 + Math.min(x.days - 14, 30) / 6,
      });
    }
  }

  // Flashcards due: one line for all the decks (the fullest deck's Review).
  const decks = input.decks.filter((d) => d.due > 0).sort((a, b) => b.due - a.due);
  if (decks.length) {
    const total = decks.reduce((n, d) => n + d.due, 0);
    add({
      id: `cards:${dayOf(now)}`,
      kind: 'cards',
      source: 'notes',
      title: `${total} ${total === 1 ? 'flashcard' : 'flashcards'} to review`,
      detail: decks.length === 1 ? decks[0].title : `${decks[0].title} and ${decks.length - 1} more ${decks.length === 2 ? 'deck' : 'decks'}`,
      tone: 'none',
      actions: [{ kind: 'review', label: 'Review cards', path: decks[0].path }],
      base: 48 + Math.min(total, 20) / 2,
    });
  }

  // Money that warns early (10.0 v2money): bills due soon or overdue (not paid yet and you pay it by hand said
  // plainly when autopay is off), spending well over usual, a price that went up. The
  // same words the bell uses (src/shared/finance.ts), so both doors say one thing.
  const money = input.money ?? null;
  if (money) {
    // The one due list (3 Nov 2026, fourth-round G1): the Bills card and Today's figures count this same list.
    const due = billsDue(money.bills, money.remindDays, money.today);
    for (const b of due) {
      const said = billDueWords(b, money.currency, money.today);
      add({
        id: `bill:${b.path}:${b.next}`,
        kind: 'bill',
        source: 'notes',
        title: said.title,
        detail: said.detail,
        tone: b.overdue ? 'bad' : 'warn',
        actions: [
          { kind: 'open', label: 'Open', path: b.path },
          { kind: 'ask', label: 'Ask about this', words: `About ${b.name} (${short(said.detail, 120)}): ` },
        ],
        base: b.overdue ? 86 : b.days !== null && b.days <= 3 ? 76 : 66,
      });
    }
    for (const o of money.over) {
      const said = spendOverWords(o, money.currency);
      add({
        id: `spend:${o.category}:${o.month}`,
        kind: 'spend',
        source: 'notes',
        title: said.title,
        detail: said.detail,
        tone: 'warn',
        actions: [
          ...(o.path ? [{ kind: 'open' as const, label: 'Open', path: o.path }] : []),
          { kind: 'ask', label: 'Ask about this', words: `About ${o.category} spending (${short(said.detail, 120)}): ` },
        ],
        base: 62,
      });
    }
    for (const p of money.prices) {
      const said = priceUpWords({ name: p.name, change: { from: p.from, to: p.to, date: p.date, recent: true } }, money.currency, money.today);
      if (!said) continue;
      add({
        id: `price:${p.path}:${p.date}:${p.to}`,
        kind: 'price',
        source: 'notes',
        title: said.title,
        detail: said.detail,
        tone: 'warn',
        actions: [
          { kind: 'open', label: 'Open', path: p.path },
          { kind: 'ask', label: 'Ask about this', words: `About ${p.name} going up (${short(said.detail, 120)}): ` },
        ],
        base: 58,
      });
    }
    // The next 30 days look tight: one sentence, opening the biggest bill in the window when there is one.
    if (money.tight) {
      add({
        id: `tight:${money.tight.week}`,
        kind: 'tight',
        source: 'notes',
        title: money.tight.title,
        detail: money.tight.detail,
        tone: 'warn',
        actions: [
          ...(money.tight.path ? [{ kind: 'open' as const, label: 'Open', path: money.tight.path }] : []),
          { kind: 'ask', label: 'Ask about this', words: `Money looks tight (${short(money.tight.detail, 120)}). What can I move? ` },
        ],
        base: 70,
      });
    }
  }
  // People gone quiet: one line each with a drafted check-in, put in the chat box by the action, never sent.
  for (const q of input.people ?? []) {
    if (!q.name) continue;
    add({
      id: `person:${q.id}:${dayOf(now)}`,
      kind: 'person',
      source: 'notes',
      title: `${short(q.name, 60)} has gone quiet`,
      detail: q.usualDays !== undefined ? `Quiet for ${spanWords(q.days)}, usually every ${spanWords(q.usualDays)}` : `Quiet for ${spanWords(q.days)}`,
      tone: 'none',
      actions: [{ kind: 'ask', label: 'Draft check-in', words: q.draft }, ...(q.path ? [{ kind: 'open' as const, label: `Open ${short(q.name, 30)}`, path: q.path }] : [])],
      base: 52,
    });
  }

  // What the former host app's automations found overnight.
  for (const f of input.found) {
    const actions: BriefAction[] = [];
    if (f.action && 'ask' in f.action) actions.push({ kind: 'ask', label: f.action.label, words: f.action.ask });
    if (f.action && 'url' in f.action) actions.push({ kind: 'url', label: f.action.label, url: f.action.url });
    // A find may link to a locked note (its words stay its own): the line stays, the way in does not.
    if (f.link && 'path' in f.link && !isPrivatePath(f.link.path)) actions.push({ kind: 'open', label: 'Open', path: f.link.path });
    if (f.link && 'url' in f.link) actions.push({ kind: 'url', label: 'Open', url: f.link.url });
    if (!actions.some((a) => a.kind === 'ask')) actions.push({ kind: 'ask', label: 'Ask about this', words: `About “${short(f.title)}”${f.detail ? ` (${short(f.detail, 160)})` : ''}, which ${f.source} found: ` });
    add({ id: f.id, kind: `found:${f.kind}`, source: 'neuralspark', title: f.title, detail: [f.detail, f.source].filter(Boolean).join(' · '), tone: 'none', actions: actions.slice(0, 2), base: 40 + 30 * f.priority });
  }
  return out;
}

/** Where the former host app's line came from, for "Not useful" (a find's source, so one automation can be
quietened). */
export const fromOf = (item: Pick<BriefItem, 'source' | 'detail'>) => (item.source === 'neuralspark' ? item.detail.split(' · ').pop() : undefined);

/**
 * A brief line that is one of the person's tasks, however it arrives (4 Nov 2026, p12-today-focus round 3: Vault's
 * Today card carries none — tasks are Next for you's job). On the line's kind, never its shown label, so a step, a
 * task, a reminder and one of the former host app's finds shaped as a task all drop the same way.
 */
export function isBriefTask(item: Pick<BriefItem, 'kind'>): boolean {
  const kind = item.kind;
  if (kind === 'step' || kind === 'task' || kind === 'reminder') return true;
  if (kind.startsWith('found:')) {
    const sub = kind.slice('found:'.length);
    return sub === 'task' || sub === 'tasks' || sub === 'step' || sub === 'steps' || sub === 'reminder' || sub === 'reminders' || sub === 'todo' || sub === 'todos';
  }
  return false;
}

/**
 * The brief as Vault's Today card shows it (round 3): no task rows (Next for you's job) and no meeting rows (the day
 * below shows them). What is left — news, messages, money, the rest — stays in its ranked order, and every dropped
 * row counts in `more` (the lists below hold them). Nothing left: the card has nothing to draw.
 */
export function todayCardBrief(brief: Brief): Brief {
  const items = brief.items.filter((i) => i.kind !== 'event' && !isBriefTask(i));
  return { ...brief, items, more: brief.more + (brief.items.length - items.length) };
}

/**
 * The brief: every line ranked (its own rank, less what "Not useful" said about its kind), the hidden ones left out,
 * at most PER_KIND of one kind and BRIEF_MAX in all, the most pressing first.
 */
export function buildBrief(input: BriefInput): Brief {
  const seen = new Set<string>();
  const ranked = candidates(input)
    .filter((i) => {
      if (input.prefs.hidden[i.id] || seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    })
    .map((i) => ({ ...i, score: Math.round(adjusted(i.score, setAside(input.prefs, preferenceKey({ ...i, from: fromOf(i) }), input.now)) * 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const perKind = new Map<string, number>();
  const items: BriefItem[] = [];
  let more = 0;
  for (const i of ranked) {
    const group = i.kind.startsWith('found:') ? 'found' : i.kind;
    const n = perKind.get(group) ?? 0;
    if (items.length >= BRIEF_MAX || n >= PER_KIND) {
      more++;
      continue;
    }
    perKind.set(group, n + 1);
    items.push(i);
  }
  return { generatedAt: input.now, items, more, found: input.foundState };
}
