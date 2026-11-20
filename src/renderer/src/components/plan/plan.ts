// The plan lists' shared reading (29 Oct 2026, the redesign plan; one set for Today, Tasks, Projects and the
// project page, the plan "One set of plan pieces"): one model of "what's on me", built on
// src/shared/today.ts (isPerson, the day groups) so every screen counts the same way. One status reading
// (statusReading in lib/projectLook.ts: whole words, never substrings) sits behind both pill sizes, and one
// countdown rule behind both date readers (9.2 uplift F4, F57), so the same health or day reads the same on
// every screen. Pure: the screens pass what they already have and draw what comes back.

import { isPerson, ownerOf, pickNextFew, pickNextForYou, readDay, type DueItem, type Tone, type WaitingItem } from '../../../../shared/today';
import { isKnownOwner, isOwnText, isStaleOffset } from '../../../../shared/today-count';
import type { DueEntry, DueGroups } from '../../../../shared/hub';
import { formatDue } from '../../../../shared/due-words';
import { ymd } from '../../../../shared/timeline';
import { statusReading, whoPerson } from '../../lib/projectLook';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Date pill ────────────────────────────────────────────────────────────────────────────────────────────────

/** One countdown rule for both date readers (9.2 uplift F57): a day 8 to 30 days out reads with its countdown
 *  ("13 Nov · in 15 days"); nearer days and far days read as the day alone. */
export function countdownDay(day: string, offset: number): string {
  return offset >= 8 && offset <= 30 ? `${day} · in ${offset} days` : day;
}

/** How a due day reads on a pill: the one reader (formatDue: late "2 days late"/"Yesterday" attention,
 *  today, tomorrow and weekday with date muted, or no date) — except stale (5 Nov 2026, u3 moving-in):
 *  more than a month late reads as its quiet date, never a red scream. */
export function datePill(offset: number | null, now: Date): { words: string; tone: Tone } {
  if (offset === null) return { words: 'No date', tone: 'none' };
  if (isStaleOffset(offset)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return { words: `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`, tone: 'none' };
  }
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const read = formatDue(offset, target, today);
  return { words: read.words, tone: read.tone === 'attention' ? 'bad' : 'none' };
}

// ── Status pill ──────────────────────────────────────────────────────────────────────────────────────────────

/** A health or status in pill words: Off track, At risk, On track, Done or Waiting, with its tone. Null: nothing
 *  to say. The same reading as statusOf below (9.2 uplift F4): one status means one words on every screen. */
export function statusPill(words?: string): { words: string; tone: Tone } | null {
  const w = String(words ?? '').trim();
  if (!w) return null;
  const { state } = statusReading(w);
  if (state === 'done') return { words: 'Done', tone: 'ok' };
  if (state === 'waiting') return { words: 'Waiting', tone: 'none' };
  if (state === 'off-track') return { words: 'Off track', tone: 'bad' };
  if (state === 'at-risk') return { words: 'At risk', tone: 'warn' };
  if (state === 'on-track') return { words: 'On track', tone: 'ok' };
  return { words: w.charAt(0).toUpperCase() + w.slice(1), tone: 'none' };
}

// ── Date pill, timeline days (the project page's reading, kept so its pills read exactly as they did) ─────────

/** Which pill a timeline day gets, against today (timeline days, src/shared/timeline.ts). */
export type DateTone = 'late' | 'today' | 'week' | 'later' | 'none';

/** Which pill a day gets, against today (timeline days). */
export function dateTone(day: number | undefined, today: number): DateTone {
  if (day === undefined) return 'none';
  if (day < today) return 'late';
  if (day === today) return 'today';
  return day - today <= 7 ? 'week' : 'later';
}

/** "3 days late", "Yesterday", "Today", "Tomorrow", "Fri 13 Nov · in 15 days", "No date" (timeline days, the one reader). */
export function dateWords(day: number | undefined, today: number): string {
  if (day === undefined) return 'No date';
  const n = day - today;
  const t = ymd(day);
  const o = ymd(today);
  return formatDue(n, new Date(t.y, t.m, t.d), new Date(o.y, o.m, o.d)).words;
}

// ── Status pill, the project reading (kept so Projects and the project page read exactly as they did) ───────

export type StatusTone = Tone | 'done' | 'waiting';

/** The pill for a health or status word, in the words a person reads (the Projects reading). The same reading
 *  as statusPill above (9.2 uplift F4): one status means one words on every screen. */
export function statusOf(words: string | undefined): { label: string; tone: StatusTone } | null {
  const w = String(words ?? '').trim();
  if (!w) return null;
  const { state } = statusReading(w);
  if (state === 'done') return { label: 'Done', tone: 'done' };
  if (state === 'waiting') return { label: 'Waiting', tone: 'waiting' };
  if (state === 'off-track') return { label: 'Off track', tone: 'bad' };
  if (state === 'at-risk') return { label: 'At risk', tone: 'warn' };
  if (state === 'on-track') return { label: 'On track', tone: 'ok' };
  return { label: w.charAt(0).toUpperCase() + w.slice(1), tone: 'none' };
}

// ── Owner chip ───────────────────────────────────────────────────────────────────────────────────────────────

/** The person a "who" names, as shown on a chip: any leading dash or "from … —" wrapper taken off. */
export function ownerName(who: string | undefined): string {
  return whoPerson((who ?? '').replace(/^—\s*/, '').trim());
}

// ── Today's head ─────────────────────────────────────────────────────────────────────────────────────────────

/** Due's dated lines as head figures: overdue, today and next 7 days count; tasks with no day have no day,
 *  so they never count here. Null (Due not loaded yet): nothing. */
export function dueHeadCounts(due: Pick<DueGroups, 'overdue' | 'today' | 'week'> | null): { late: number; today: number; week: number } {
  if (!due) return { late: 0, today: 0, week: 0 };
  return { late: due.overdue.length, today: due.today.length, week: due.week.length };
}

/** Whether Due keeps "Nothing on you yet" away: any dated line (overdue, today, next 7 days, from a while back)
 *  is on the person. Undated lines and an unloaded Due never keep it. */
export function dueKeepsWelcome(due: Pick<DueGroups, 'overdue' | 'today' | 'week' | 'stale'> | null): boolean {
  const c = dueHeadCounts(due);
  return c.late + c.today + c.week + (due?.stale?.length ?? 0) > 0;
}

/** One entry's words for the owner reading: a reminder's text, a task's words with its day taken out (round 3: the
 *  raw line's due mark would read as part of the owner — "Mia 📅 2026-11-04" is not Mia — so the Due card and the
 *  Waiting fold read this too, never the raw line). */
export function dueOwnerText(e: DueEntry): string {
  return e.kind === 'reminder' ? e.item.text : e.item.words;
}

/** The other notes' share of the one Today count (round 2): Due's late and today lines that are the person's own
 *  (isOwnText, the same reading the former host app's vaultDue uses), so the rail and Needs you can never differ.
 *  Null: nothing. */
export function dueOwnCount(due: Pick<DueGroups, 'overdue' | 'today'> | null, me: string | null | undefined, now: Date = new Date(), known?: readonly string[] | null): number {
  if (!due) return 0;
  return [...due.overdue, ...due.today].filter((e) => isOwnText(dueOwnerText(e), me, now, known)).length;
}

/** The other notes' share split late/today/week/stale (the subtitle's figures read the same own-only Due as the heading;
 *  stale counted apart, never mixed into late). */
export function dueOwnSplit(due: Pick<DueGroups, 'overdue' | 'today' | 'week' | 'stale'> | null, me: string | null | undefined, now: Date = new Date(), known?: readonly string[] | null): { late: number; today: number; week: number; stale: number } {
  if (!due) return { late: 0, today: 0, week: 0, stale: 0 };
  const own = (list: DueEntry[]) => list.filter((e) => isOwnText(dueOwnerText(e), me, now, known)).length;
  return { late: own(due.overdue), today: own(due.today), week: own(due.week), stale: own(due.stale ?? []) };
}

/** Whether own Due keeps "Nothing on you yet" away: another person's dated lines never keep it. Stale keeps it
 *  away too (5 Nov 2026, u3 moving-in): old work is still work — quiet, but never hidden behind the welcome. */
export function dueOwnKeepsWelcome(due: Pick<DueGroups, 'overdue' | 'today' | 'week' | 'stale'> | null, me: string | null | undefined, now: Date = new Date(), known?: readonly string[] | null): boolean {
  const c = dueOwnSplit(due, me, now, known);
  return c.late + c.today + c.week + c.stale > 0;
}

/** The question an answer belongs to: the nearest user message before it. A Retry's second answer still belongs
 *  to the one question asked (saving it as a note files it under those words). '' when there is none. */
export function priorUserText(messages: readonly { role: string; content: string }[], i: number): string {
  for (let j = Math.min(i, messages.length) - 1; j >= 0; j--) if (messages[j].role === 'user') return messages[j].content.trim();
  return '';
}

/** A task's line waiting on someone (the Tasks board's Waiting drop): with no tail, " — Name"; with a tail
 *  already there (a day, "Call — Fri 23 Oct"), " — Name · by <tail>", the shape the reader splits back into
 *  owner and day — never a second dash stacked on the first. A trailing ·note is kept where it was, at the end. */
export function waitingLine(line: string, name: string): string {
  const meta = /\s*·[^\n]*$/.exec(line)?.[0] ?? '';
  const body = meta && line.endsWith(meta) ? line.slice(0, -meta.length) : line;
  const cut = body.search(/\s+[—–]\s+/);
  if (cut < 0) return `${body} — ${name}${meta}`;
  const tail = body.slice(cut).replace(/^\s+[—–]\s+/, '').trim();
  if (!tail) return `${body.slice(0, cut)} — ${name}${meta}`;
  const when = /^by\s+/i.test(tail) ? tail : `by ${tail}`;
  return `${body.slice(0, cut)} — ${name} · ${when}${meta}`;
}

/** The one subtitle line of figures ("2 late for you · 1 due today · 1 bill to pay · 13 this week · 5 from a while
 *  back · 1 at risk · 4 waiting on others"). At-risk projects count too, so the "All clear" fallback below never
 *  shows above them. Late and today are tasks, the same ones the heading's one count reads (4 Nov 2026: "9 today"
 *  sat above "10 late for you" because a bill counted in one and not the other); a bill due is said in its own
 *  words. Stale (5 Nov 2026, u3 moving-in) is said quietly after the week, never mixed into late. */
export function subtitleFigures(c: { late: number; today: number; bills?: number; week: number; waiting: number; risk?: number; stale?: number }): string[] {
  const out: string[] = [];
  if (c.late) out.push(`${c.late} late for you`);
  if (c.today) out.push(`${c.today} due today`);
  if (c.bills) out.push(`${c.bills} ${c.bills === 1 ? 'bill' : 'bills'} to pay`);
  if (c.week) out.push(`${c.week} this week`);
  if (c.stale) out.push(`${c.stale} from a while back`);
  if (c.risk) out.push(`${c.risk} at risk`);
  if (c.waiting) out.push(`${c.waiting} waiting on others`);
  return out;
}

/** The next thing that matters (29 Oct 2026, SPEC section A): pickNextForYou in src/shared/today.ts, never
 *  the most-days-late item on lateness alone. Prep for today's meetings slots in when the caller passes it. */
export function nextForYou(due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[] }, prep: DueItem[] = []): DueItem | null {
  return pickNextForYou(due, prep);
}

/** The few next things (4 Nov 2026, p12-today-focus): at most five own items by the existing rank. */
export function nextFew(due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[] }, n = 5, prep: DueItem[] = []): DueItem[] {
  return pickNextFew(due, n, prep);
}

/** The day groups with Next for you taken out of its group (10.0 one start to the day): the hero owns its row, so
 *  the groups list from these, never from the raw day. A group left with nothing lists nothing: the page shows no
 *  heading for it, and the section counts what is listed (listedDueCount), never the owned row twice. */
export function listedDue(due: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; stale?: DueItem[] }, next: DueItem | null | DueItem[]): { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; stale: DueItem[] } {
  if (!next || (Array.isArray(next) && !next.length)) return { overdue: due.overdue, today: due.today, soon: due.soon, later: due.later, stale: due.stale ?? [] };
  const ids = new Set((Array.isArray(next) ? next : [next]).map((x) => x.id));
  const out = (items: DueItem[]) => items.filter((x) => !ids.has(x.id));
  return { overdue: out(due.overdue), today: out(due.today), soon: out(due.soon), later: out(due.later), stale: out(due.stale ?? []) };
}

/** How many rows the listed groups hold: the section's count. */
export function listedDueCount(listed: { overdue: DueItem[]; today: DueItem[]; soon: DueItem[]; later: DueItem[]; stale?: DueItem[] }): number {
  return listed.overdue.length + listed.today.length + listed.soon.length + listed.later.length + (listed.stale?.length ?? 0);
}

/** Whether a chip's name is the person themselves (their name, first name, or "me"): no chip then. */
export function isOwnName(name: string | undefined, me: string | null | undefined): boolean {
  const shown = ownerName(name);
  return !!shown && isPerson(shown, me ?? undefined);
}

/** A name as a list shows it: the person's own name never shows on their own items (sweep 032), so theirs
 *  reads as nothing; anyone else's name stays. A job for two shows the other person, never you (t250, 12 Nov 2026:
 *  "Sam and June" hid June too when you are Sam, and showed you when you are June): joint owners split the way the
 *  merge reads them (one-task.ts ownerParts, with whoPerson's "with" and ";" beside it) and only your own parts go.
 *  While `me` is still being read the name stays, and the caller re-renders when it lands (the ProjectPage pattern),
 *  so the person's own chip goes then. */
export function visibleWho(name: string | undefined, me: string | null | undefined): string {
  const shown = (name ?? '').trim();
  if (!shown) return '';
  const parts = shown
    .split(/\s*(?:,|&|\/|\band\b|\+|\bwith\b|;)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const others = parts.filter((p) => !isPerson(ownerName(p) || p, me ?? undefined));
    if (!others.length) return '';
    if (others.length === parts.length) return shown;
    return others.join(' and ');
  }
  return !isOwnName(shown, me) ? shown : '';
}

// ── Late, folded by project ──────────────────────────────────────────────────────────────────────────────────

export type Fold = { kind: 'one'; item: DueItem } | { kind: 'project'; projectName: string; items: DueItem[] };

/** Late items, one line per project when a project has three or more (the line opens to its steps). */
export function foldByProject(items: DueItem[]): Fold[] {
  const by = new Map<string, DueItem[]>();
  for (const x of items) by.set(x.projectName, [...(by.get(x.projectName) ?? []), x]);
  const out: Fold[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const all = by.get(x.projectName)!;
    if (all.length < 3) out.push({ kind: 'one', item: x });
    else if (!seen.has(x.projectName)) {
      seen.add(x.projectName);
      out.push({ kind: 'project', projectName: x.projectName, items: all });
    }
  }
  return out;
}

// ── Waiting on others, by person ─────────────────────────────────────────────────────────────────────────────

export interface WaitingGroup {
  who: string;
  items: WaitingItem[];
  /** The oldest item's day offset (null: none of them has a day). */
  oldest: number | null;
}

/** Waiting items grouped by person: name, how many, the oldest first. */
export function groupWaiting(waiting: WaitingItem[]): WaitingGroup[] {
  const by = new Map<string, WaitingItem[]>();
  for (const x of waiting) by.set(x.who, [...(by.get(x.who) ?? []), x]);
  return [...by.entries()]
    .map(([who, items]) => ({ who, items, oldest: items.reduce<number | null>((a, x) => (x.offset === null ? a : a === null || x.offset < a ? x.offset : a), null) }))
    .sort((a, b) => (a.oldest ?? Infinity) - (b.oldest ?? Infinity) || b.items.length - a.items.length || a.who.localeCompare(b.who));
}

/** The chase drafted for a person (drafted in the chat, never sent from here). */
export function chaseWords(group: WaitingGroup): string {
  const list = group.items.map((x) => `“${x.what}” (${x.projectName})`).join(', ');
  const oldest = group.oldest === null ? '' : group.oldest < 0 ? `, the oldest ${-group.oldest} ${group.oldest === -1 ? 'day' : 'days'} late` : '';
  return `Draft a short message to ${group.who} asking where these stand${oldest}: ${list}. `;
}

// ── Tasks: whose, and when ───────────────────────────────────────────────────────────────────────────────────

export type Ownership = 'mine' | 'others' | 'everyone';

/** Whose a task is: it names the person (or nobody) — mine; it names someone else the vault knows — waiting on
 *  them. A name carrying its task with it ("Post on Facebook — Jesse Arlow") is split with ownerOf first, as
 *  Today splits a step. With `known`, a stranger's name is a mention, never debt (5 Nov 2026, u3 moving-in: the
 *  one owner confidence). */
export function taskOwnership(personNames: string[], me: string | null, known?: readonly string[] | null): 'mine' | 'others' {
  const names = personNames.flatMap((n) => { const s = splitTaskOwner(n, new Date()); return s.owner ? [s.owner] : s.when ? [] : [n]; });
  const kept = known ? names.filter((n) => isPerson(n, me ?? undefined) || isKnownOwner(n, known)) : names;
  if (!kept.length) return 'mine';
  return kept.some((n) => isPerson(n, me ?? undefined)) ? 'mine' : 'others';
}

export type PlanGroup = 'late' | 'today' | 'week' | 'later' | 'earlier' | 'stale' | 'none';

const groupOf = (offset: number | null, done: boolean): PlanGroup => (offset === null ? 'none' : offset < 0 ? (done ? 'earlier' : isStaleOffset(offset) ? 'stale' : 'late') : offset === 0 ? 'today' : offset <= 7 ? 'week' : 'later');
const dateOfIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

/** A task's group, the same day reading as Today's lists: late / today / this week (7 days) / later / from a while
 *  back / no date. Its day is read with readDay (src/shared/today.ts), so Tasks and Today can never disagree about
 *  which group a day is in. */
export function planGroup(t: { done: boolean; due: string | null; words?: string }, today: string): PlanGroup {
  const now = dateOfIso(today);
  if (!t.due) { const when = t.words ? splitTaskOwner(t.words, now).when : undefined; return groupOf(when ? readDay(when, now)?.offset ?? null : null, t.done); }
  return groupOf(readDay(t.due, now)?.offset ?? null, t.done);
}

/** A task's title and owner, split as Today splits a project step (29 Oct 2026, ITEMS 3): "Post on Facebook (5 min)
 *  — Jesse Arlow" is the post, with Jesse as its owner. The tail after its dash is read through ownerOf, so
 *  "from [[a note]] — Mia" is Mia's and a day written there ("— Fri 23 Oct") is its day, not a person. */
export function splitTaskOwner(words: string, now: Date): { title: string; owner?: string; when?: string } {
  const tail = /\s+[—–]\s+(.+)$/.exec(words);
  if (!tail) return { title: words.trim() };
  const title = words.slice(0, tail.index).trim();
  let who: string | undefined;
  let when: string | undefined;
  const others: string[] = [];
  for (const part of tail[1].split(/\s+·\s+/)) {
    const by = /^by\s+(.+)$/i.exec(part.trim());
    if (by && when === undefined) when = by[1].trim();
    else if (part.trim()) others.push(part.trim());
  }
  if (others.length) who = others.join(' · ');
  const split = ownerOf(who, when, now);
  return { title, ...(split.who ? { owner: split.who } : {}), ...(split.when ? { when: split.when } : {}) };
}

export interface TaskInfo { title: string; owner?: string; owners: string[]; ownership: 'mine' | 'others'; offset: number | null; group: PlanGroup }

/** A task's words cleaned for reading (Tasks' own cleaning, in one place): tags out, links as their names,
 *  Markdown marks left out. The Tasks page and the left side's badge read a task through this and taskInfo
 *  together, so their counts of late can never be two readings (sweep 001/008: 15 beside 16). */
export function cleanTaskWords(words: string): string {
  // Plain words skip the patterns (t102, 9 Nov 2026): with no tag, link, mark or doubled space, trimming
  // is the whole job — the same string the patterns below would leave.
  if (!/[#\[(*_`~=]/.test(words) && !/\s{2}/.test(words)) return words.trim();
  const plain = (s: string) =>
    s
      .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/!?\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, (_m, t: string) => t.split('/').pop() ?? t)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|==|~~|`)(.+?)\1/g, '$2')
      .replace(/\s{2,}/g, ' ')
      .trim();
  return plain(words.replace(/(^|\s)#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*/gu, '$1')) || plain(words);
}

/** Tasks read the Today's way, in order: whose each is and which group its day puts it in. */
export function taskInfos(tasks: readonly { words: string; due: string | null; done: boolean; people?: string[] }[], me: string | null, todayIso: string, known?: readonly string[] | null): TaskInfo[] {
  const now = dateOfIso(todayIso);
  // One known-people memo for the list (t102, 9 Nov 2026): the same tails asked down thousands of tasks.
  const memo = new Map<string, boolean>();
  return tasks.map((t) => taskInfo({ words: cleanTaskWords(t.words), due: t.due, done: t.done, people: t.people ?? [] }, me, now, known, memo));
}

/** How many tasks are late for you (Mine and Late, the Tasks page's own groups). */
export function lateForYouCount(tasks: readonly { words: string; due: string | null; done: boolean; people?: string[] }[], me: string | null, todayIso: string, known?: readonly string[] | null): number {
  return taskInfos(tasks, me, todayIso, known).filter((i) => i.ownership === 'mine' && i.group === 'late').length;
}

/** One task read the way Today reads it (isOwnText, readDay): whose it is, its clean title, and its group.
 *  Whose is the words alone (5 Nov 2026, one counting query: linking to a person never made it theirs, so
 *  Tasks and Today disagreed by twenty; people links stay for display, never for ownership) — except with
 *  `known`, where a tail naming a stranger is a mention, never debt, and a linked known person stays linked
 *  (5 Nov 2026, u3 moving-in: the one owner confidence; a link to someone known is deliberate). Its day is its
 *  written due day, else the day ownerOf found in its tail. A done task whose day went by is earlier, never
 *  late (dates that went by are not late work, as on Today). */
export function taskInfo(t: { words: string; due: string | null; done: boolean; people?: string[] }, me: string | null, now: Date, known?: readonly string[] | null, memo?: Map<string, boolean>): TaskInfo {
  const split = splitTaskOwner(t.words, now);
  const tailOwner = split.owner && (!known || isPerson(split.owner, me ?? undefined) || isKnownOwner(split.owner, known, memo)) ? split.owner : undefined;
  const owners = [...new Set([tailOwner, ...(t.people ?? [])].filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];
  const linkedKnown = !!known && owners.some((n) => !isPerson(n, me ?? undefined) && isKnownOwner(n, known, memo));
  const ownership: 'mine' | 'others' = !isOwnText(t.words, me, now, known, memo) || linkedKnown ? 'others' : 'mine';
  const offset = (t.due ? readDay(t.due, now)?.offset : undefined) ?? (split.when ? readDay(split.when, now)?.offset : undefined) ?? null;
  return { title: split.title, ...(tailOwner ? { owner: tailOwner } : owners[0] ? { owner: owners[0] } : {}), owners, ownership, offset, group: groupOf(offset, t.done) };
}

/** No-date tasks grouped by project (their note's project, else the note itself), most first. */
export function groupNoDate<T extends { projectName: string | null; title: string }>(items: T[]): { name: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  for (const t of items) by.set(t.projectName ?? t.title, [...(by.get(t.projectName ?? t.title) ?? []), t]);
  return [...by.entries()].map(([name, list]) => ({ name, items: list })).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

// ── One task row (p11 vault-care, Nov 2026: the task lists are "horrible to look at", "just care
// and premium into our software") ─────────────────────────────────────────────────────────────────────────────
// Every task list (the project Tasks tab, the Tasks page, Today rows, meeting actions) reads through these, so
// who and when share one x on every row: tick | title | who | when.

/** A name's first word ("Jesse Arlow" → "Jesse"): the who column shows it, the full name on hover. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** An owner written at the end of a title's own words ("Confirm call attendance - Jack Doyle"), split for
 *  DISPLAY ONLY — the note's words stay as written. Only a trailing dash (hyphen or em/en) plus two or more
 *  capitalised words counts, so a name mid-title ("Talk to Sarah about the tenancy"), a hyphenated word
 *  ("the-carpenters can start") and a trailing state ("choice still open", "- urgent", "- TO") never split. */
export function splitTitleOwner(title: string): { title: string; owner?: string } {
  const tail = /\s+[—–-]\s+([A-Z][\p{L}'`-]+(?:\s+[A-Z][\p{L}'`-]+)+)\s*$/u.exec(title);
  if (!tail) return { title };
  return { title: title.slice(0, tail.index).trim(), owner: tail[1].replace(/\s+/g, ' ') };
}

/** The when column's tone from a day offset (5 Nov 2026, the plan): late alone reads the attention
 *  colour; today, tomorrow and future read quiet neutral, no filled chips anywhere. Stale (5 Nov 2026, u3
 *  moving-in) reads quiet too: old lines never shout. Null (no day): an empty cell. */
export function whenTone(offset: number | null): 'coral' | 'quiet' | null {
  if (offset === null) return null;
  if (isStaleOffset(offset)) return 'quiet';
  return offset < 0 ? 'coral' : 'quiet';
}

/** A bare state word where a day would be ("Ongoing", "Waiting"): it reads quietly in the when column. "Open"
 *  says nothing — every listed task is open — so it reads as an empty cell. Anything else passes through as
 *  written: the column never invents words. */
export function stateReading(when: string): { words: string } | null {
  const w = when.trim();
  if (!w || /^open$/i.test(w)) return null;
  return { words: w };
}

/** Waiting wins: the next-step indexes shadowed by waiting items with the same ref. Exact identity (the same
 *  underlying step), never words — near-repeats ("Audit column Q" twice, said differently) stay two rows. */
export function shadowedNextIndexes(waiting: readonly { ref: { kind: string; index?: number } }[]): Set<number> {
  const out = new Set<number>();
  for (const w of waiting) if (w.ref.kind === 'next' && typeof w.ref.index === 'number') out.add(w.ref.index);
  return out;
}
