// A project's hub (23 Oct 2026, the redesign's workstream 1): what a project opens to. Pure (no window, no files):
// everything is worked out from the project file as written (src/shared/project-file.ts: its next steps, key dates,
// people, risks, decisions, updates and documents; a layout's sections such as Workstreams, Run sheet and Suppliers and
// contacts: docs/LAYOUTS.md), the files and notes the main side lists for it, and its earlier versions (what changed).
// Every item carries where it lives in the file (an ItemRef), so a click goes exactly there.
//   hubModel        needs attention, my actions, waiting on others (with "since"), next milestones, people, decisions
//  filesByPurpose  latest files grouped by what they are for (quotes, reports, plans, meetings, contracts, data…)
//   projectChanges  what changed between two versions of the project, in words, for Recent activity
//   lifecycle       Idea → Planning → Active → Closing → Done: the stage (front matter `stage:`), a checklist per stage
//                   kept in the project (## Stage checklist), and the edits that tick, add, rename and take off its lines
//   closeOutReport  the report written at Done from the project's own data (delivered, decisions, lessons, files)
//   dayIn / replaceDayIn   a date inside words as people write them ("by Mon 26 Oct (see the RACI)"), read and moved
// Clean room: written from the words and Ironleaf's own contract only.

import type { Project, ProjectDate, ProjectEdit } from './project-file';
import { splitRiskTail } from './project-file';
import { cleanFileName } from './paths';
import { addRunSheetItem, column, itemParts, readTable, removeRunSheetItem, runSheet, sectionText, setRunSheetItem, toggleRunSheetItem, withItemParts, type RunPhase } from './layouts';
import { isoDay, readDay, shortDay, ymd, dayFrom } from './timeline';
import { plural } from './words';

// ── Where an item lives (what a click opens) ─────────────────────────────────────────────────────────────────────────

export type ItemRef =
  | { kind: 'next'; index: number }
  /** A tick box in a section of the person's own (a run sheet's phase), by its line in that section's words. */
  | { kind: 'run'; section: string; line: number }
  | { kind: 'date'; index: number }
  | { kind: 'risk'; index: number }
  | { kind: 'decision'; index: number }
  | { kind: 'update'; index: number }
  | { kind: 'person'; name: string }
  | { kind: 'file'; path: string; link?: string; note?: boolean }
  | { kind: 'workstream'; section: string; row: number }
  /** An item written outside the project's file (a meeting's action, a task line in a note of the project), by its record
   *  id in the connected vault (src/shared/records.ts), and its note and line. */
  | { kind: 'record'; id: string; path: string; line?: number }
  /** A part of the page: 'actions', 'waiting', 'risks', 'dates', 'people', 'decisions', 'files', 'updates', or a section's heading. */
  | { kind: 'section'; heading: string }
  | { kind: 'due' };

/** The page's own name for an item ("next:3", "dates:2", "risks:0"), as its lines are marked (data-item). */
export function itemKey(ref: ItemRef): string {
  switch (ref.kind) {
    case 'next':
      return `next:${ref.index}`;
    case 'date':
      return `dates:${ref.index}`;
    case 'risk':
      return `risks:${ref.index}`;
    case 'decision':
      return `decisions:${ref.index}`;
    case 'update':
      return `updates:${ref.index}`;
    case 'run':
      return `run:${ref.section}:${ref.line}`;
    case 'workstream':
      return `row:${ref.section}:${ref.row}`;
    case 'record':
      return `record:${ref.id}`;
    case 'person':
      return `person:${ref.name}`;
    case 'file':
      return `file:${ref.path}`;
    case 'section':
      return `section:${ref.heading}`;
    case 'due':
      return 'due';
  }
}

// ── Days inside words ────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_WORD = '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\\.?,?\\s+)';
// The ways a day is written inside a line: 2026-10-26 · Mon 26 Oct (2026) · 26 October · Oct 26, 2026 · 26/10/2026.
const DAY_IN = new RegExp(
  `(${WEEKDAY_WORD})?(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\.?(?:,?\\s+\\d{4})?|${MONTH_WORD}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}/\\d{2,4})(?![\\w/-])`,
  'gi',
);

/** The first day written inside some words ("by Mon 26 Oct (see the RACI)", "Week of 12 Oct (overdue)"), with where it is. */
export function dayIn(text: string | undefined, ref: number): { day: number; at: number; length: number; written: string; weekday: string } | null {
  if (!text) return null;
  DAY_IN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DAY_IN.exec(text))) {
    const day = readDay(m[2], ref);
    if (day !== null) return { day, at: m.index, length: m[0].length, written: m[2], weekday: m[1] ?? '' };
  }
  return null;
}

/** Some words with the day in them moved to another, written the way it was (a weekday kept as a weekday, no year
 *  added where none was, unless it's another year); words with no day in them become the day itself (ISO). */
export function replaceDayIn(text: string, day: number, ref: number): string {
  const found = dayIn(text, ref);
  const { y, m, d, weekday } = ymd(day);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!found) return text.trim() ? `${text.trim()} ${isoDay(day)}` : isoDay(day);
  const w = found.written;
  let out: string;
  const yearShown = /\d{4}/.test(w.replace(/^\d{4}-/, 'X-')) || ymd(day).y !== ymd(ref).y;
  if (/^\d{4}-/.test(w)) out = `${y}-${pad(m + 1)}-${pad(d)}`;
  else if (/^\d{1,2}\//.test(w)) out = `${d}/${m + 1}/${w.split('/')[2]?.length === 2 ? String(y).slice(2) : y}`;
  else if (/^[A-Za-z]/.test(w)) out = `${MONTHS[m]} ${d}${yearShown ? `${w.includes(',') ? ',' : ''} ${y}` : ''}`;
  else out = `${d} ${MONTHS[m]}${yearShown ? ` ${y}` : ''}`;
  if (found.weekday) out = `${WEEKDAYS[weekday]}${found.weekday.includes(',') ? ',' : ''} ${out}`;
  return `${text.slice(0, found.at)}${out}${text.slice(found.at + found.length)}`;
}

// ── People ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stripLinks = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');

// Who a "who" names lives in ./names now (p12-task-writes round 2: the write check's plugin bundle), re-exported so
// its readers move nowhere.
export { namesPerson } from './names';
import { namesPerson } from './names';

const UNASSIGNED = /^(unassigned|unowned|tbc|tbd|tba|none|nobody|no one|someone|\?+)\b/i;

/** Who a "who" mainly is: "Alex Morgan with Jay Lu (Garden club)" → Alex Morgan; "Jay / team" → Jay. */
export function mainPerson(who: string): string {
  const w = stripLinks(who).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const first = w.split(/\s+(?:with|and|&|plus|then|via)\s+|\s*[/;,·]\s*/i)[0]?.trim() ?? '';
  return first.replace(/[.:]+$/, '').trim();
}

/** Words that say nothing about which workstream a line belongs to. The one stop list for the plan and the records. */
const MATCH_STOP = new Set('the and for with from into onto this that these those all any each are was were has have had not get got send ask set per via its our your their who what when then than also about after before over under new one two out off use make sure meet call office site team project programme program work workstream'.split(' '));
const matchStem = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** A line's significant words: long enough, not stops, stemmed (a long number stays: "Tessaly 310582" is distinctive). */
const matchTokens = (s: string) => new Set(norm(stripLinks(s)).split(' ').filter((w) => (w.length >= 3 && !MATCH_STOP.has(w)) || /^\d{3,}$/.test(w)).map(matchStem));

/** The workstream a line belongs to: the one whose name's distinctive words it shares most (a tie goes to one still running for what's ahead, else none). */
export function matchWorkstream(text: string, streams: Pick<Workstream, 'name' | 'done'>[], future = true): number {
  if (!streams.length) return -1;
  const names = streams.map((w) => matchTokens(w.name.replace(/\(([^)]*)\)/g, ' $1 ')));
  const df = new Map<string, number>();
  for (const n of names) for (const t of n) df.set(t, (df.get(t) ?? 0) + 1);
  const words = matchTokens(text);
  const scores = names.map((n) => [...n].reduce((s, t) => s + (words.has(t) ? 1 / (df.get(t) ?? 1) : 0), 0));
  const best = Math.max(...scores);
  if (best < 0.5) return -1;
  let top = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  // A tie goes to one still running for what's ahead, to one finished for what's past.
  if (top.length > 1) top = top.filter((i) => (future ? !streams[i].done : !!streams[i].done));
  return top.length === 1 ? top[0] : -1;
}

// ── Actions: next steps and tick boxes ───────────────────────────────────────────────────────────────────────────────

export interface HubAction {
  id: string;
  ref: ItemRef;
  what: string;
  /** Who, as written (after a date mistaken for one is taken out). */
  who: string;
  /** The person it's with (mainPerson), '' when nobody. */
  person: string;
  mine: boolean;
  unassigned: boolean;
  /** When, as written. */
  when: string;
  due?: number;
  /** The day it was asked for, sent or chased, when the words say ("Requested 13 Oct", "asked on 14 Oct"). */
  since?: number;
  done: boolean;
  overdue: boolean;
  /** The run sheet's phase it's under. */
  phase?: string;
  /** What it comes after ("after: Hardware delivered"), as written. */
  after?: string;
  /** Lines indented under it. */
  more?: string;
  /** Written outside the project's file: the meeting or note it's in (its name), from the connected vault. */
  from?: string;
  /** Written outside the project's file as a tick box: its words as written, so a tick lands on its line there. */
  task?: string;
}

const SINCE = /\b(?:asked|requested|sent|chased|emailed|raised|followed up|logged|lodged|ordered|submitted|waiting since|since)\b[^.;()]{0,24}?/i;
const AFTER = /\s*(?:·\s*)?\(?\bafter:\s*([^·)]+?)\s*\)?\s*(?=·|$)/i;

/** The day words say something was asked for ("Requested 13 Oct", "asked by Darcy Lin on 14 Oct"). */
export function sinceIn(text: string, ref: number): number | undefined {
  const m = SINCE.exec(text);
  if (!m) return undefined;
  const found = dayIn(text.slice(m.index, m.index + m[0].length + 40), ref);
  return found && found.at <= m[0].length + 4 ? found.day : undefined;
}

function action(id: string, ref: ItemRef, raw: { what: string; who?: string; when?: string; done: boolean; more?: string }, me: string, today: number, phase?: string): HubAction {
  let who = (raw.who ?? '').trim();
  let when = (raw.when ?? '').trim();
  // A day written where the owner goes ("— Jesse · Fri 23 Oct, 11:00 AM AEDT", "— Fri 23 Oct"): that part is the when.
  if (!when && who) {
    const parts = who.split(/\s+·\s+/);
    const at = parts.findIndex((x) => dayIn(x, today)?.at === 0);
    if (at >= 0) {
      when = parts[at];
      who = parts.filter((_, i) => i !== at).join(' · ');
    }
  }
  let after: string | undefined;
  for (const part of ['who', 'when'] as const) {
    const v = part === 'who' ? who : when;
    const m = AFTER.exec(v);
    if (m) {
      after = m[1].trim();
      const rest = (v.slice(0, m.index) + v.slice(m.index + m[0].length)).replace(/\s*·\s*$/, '').trim();
      if (part === 'who') who = rest;
      else when = rest;
    }
  }
  const whatAfter = AFTER.exec(raw.what);
  const what = whatAfter ? raw.what.slice(0, whatAfter.index).trim() : raw.what.trim();
  if (whatAfter) after = whatAfter[1].trim();
  const requested = /^(requested|asked|sent|chased)\b/i.test(when);
  const due = requested ? undefined : dayIn(when, today)?.day;
  const since = sinceIn(`${when} · ${who} · ${what} ${raw.more ?? ''}`, today);
  // Nobody named: the project's owner has it. "Unassigned", "TBC" and the like: nobody has it yet.
  const unassigned = !!who && UNASSIGNED.test(who.trim());
  const mine = !who || namesPerson(who, me);
  const person = unassigned ? '' : mine ? me : mainPerson(who);
  return {
    id,
    ref,
    what,
    who,
    person,
    mine,
    unassigned: unassigned && !mine,
    when,
    ...(due !== undefined ? { due } : {}),
    ...(since !== undefined ? { since } : {}),
    done: raw.done,
    overdue: !raw.done && due !== undefined && due < today,
    ...(phase ? { phase } : {}),
    ...(after ? { after } : {}),
    ...(raw.more ? { more: raw.more } : {}),
  };
}

/** Sections whose tick boxes the hub doesn't take as the project's actions. */
export const STAGE_HEADING = 'Stage checklist';
const NOT_ACTIONS = /^(stage checklist|merged from|notes?$|my notes)/i;

/** The project's first open task of the person's own (p12-close-and-noise C, 4 Nov 2026: the Desk Hub's live next
 *  step): mine or unassigned, in the project's order, '' when it has none. */
export function firstOwnOpen(p: Project, me: string, today: number): string {
  return projectActions(p, me, today).find((a) => !a.done && (a.mine || a.unassigned))?.what ?? '';
}

/** Every action in a project: its next steps, then the tick boxes of its own sections (a run sheet's phases). */
export function projectActions(p: Project, me: string, today: number): HubAction[] {
  const out: HubAction[] = p.next.map((n, index) => action(`next:${index}`, { kind: 'next', index }, n, me, today));
  for (const x of p.extra) {
    if (NOT_ACTIONS.test(x.heading.trim())) continue;
    for (const phase of runSheet(x.body)) {
      for (const item of phase.items) {
        const parts = itemParts(item.what);
        // The same step written in What's next and the run sheet shows once: the next step, under its phase.
        const twin = out.find((a) => a.ref.kind === 'next' && alike(a.what, parts.what));
        if (twin) {
          if (phase.name !== 'Run sheet') twin.phase ??= phase.name;
          continue;
        }
        const more = undefined;
        out.push(action(`run:${x.heading}:${item.line}`, { kind: 'run', section: x.heading, line: item.line }, { what: parts.what, who: parts.who, when: parts.when, done: item.done, more }, me, today, phase.name === 'Run sheet' ? undefined : phase.name));
      }
    }
  }
  return out;
}

// ── Workstreams ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Workstream {
  name: string;
  owner: string;
  status: string;
  progress?: number;
  next: string;
  ref: ItemRef;
  done: boolean;
}

/** Words that say a milestone, workstream or update is behind it. The one done list for the hub and the tidy. */
export const DONE_WORDS = /\b(done|complete|completed|closed|finished|delivered|live|met|achieved|held|sent|signed|launched|received|passed|happened)\b/i;

/** A project's workstreams: the Workstreams table (or the first table with a Workstream column). */
export function workstreams(p: Project): Workstream[] {
  const x = p.extra.find((e) => norm(e.heading) === 'workstreams') ?? p.extra.find((e) => column(readTable(e.body), /^workstreams?$/i) >= 0);
  const t = x ? readTable(x.body) : null;
  if (!x || !t || !t.head.length) return [];
  const at = (re: RegExp) => column(t, re);
  const [w, o, s, g, n] = [Math.max(0, at(/^(workstreams?|stream|area|name)$/i)), at(/^(owner|lead|who)$/i), at(/^(status|state|stage)$/i), at(/^(progress|% ?done|percent|complete|%)$/i), at(/^(next( step)?|next steps?|notes?)$/i)];
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return t.rows
    .map((r, row) => {
      const progress = Number(cell(r, g).replace(/%$/, ''));
      const status = cell(r, s);
      return { name: cell(r, w), owner: cell(r, o), status, ...(cell(r, g) && Number.isFinite(progress) ? { progress } : {}), next: cell(r, n), ref: { kind: 'workstream', section: x.heading, row } as ItemRef, done: DONE_WORDS.test(status) };
    })
    .filter((x) => x.name);
}

// ── Milestones ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HubMilestone {
  id: string;
  ref: ItemRef;
  what: string;
  when: string;
  day?: number;
  status: string;
  done: boolean;
  /** Passed and not done (or marked late or missed). */
  late: boolean;
  /** What it comes after, as written ("(after: Hardware delivered)"). */
  after?: string;
}

const MILESTONE_LATE = /\b(late|missed|overdue|slipp\w*|lapsed)\b/i;

export interface ProjectCountdown {
  /** Whole days from today to the day counted to (always at least 1: today itself is never counted to). */
  days: number;
  day: number;
  /** What is counted to, in the Overview's words. */
  label: string;
  target: 'due' | 'go-live' | 'milestone';
  /** The milestone counted to, when the target is one. */
  milestone?: HubMilestone;
}

/**
 * The day the Overview counts to (29 Oct 2026 for one that is today, or a weekly meeting): the project's due date
 * when it has one in the future, else its go-live day when that is in the future, else the next milestone after
 * today. A milestone today (a recurring meeting, say) never gives "0 days".
 */
export function projectCountdown(p: Project, today: number, props: Record<string, unknown> = {}): ProjectCountdown | null {
  const due = readDay(p.due, today);
  if (due !== null && due > today) return { days: due - today, day: due, label: 'to the due date', target: 'due' };
  const live = readDay(String(props.go_live ?? ''), today);
  if (live !== null && live > today) {
    const kind = String(props.site_kind ?? 'go-live').replace(/^pop-up$/i, 'opening').replace(/^event$/i, 'the event');
    return { days: live - today, day: live, label: `to ${kind}`, target: 'go-live' };
  }
  const next = projectMilestones(p, today)
    .filter((m) => !m.done && m.day !== undefined && m.day > today)
    .sort((a, b) => a.day! - b.day!)[0];
  return next ? { days: next.day! - today, day: next.day!, label: 'to the next milestone', target: 'milestone', milestone: next } : null;
}

export function projectMilestones(p: Project, today: number): HubMilestone[] {
  return p.dates.map((d: ProjectDate, index) => {
    const day = readDay(d.when, today) ?? dayIn(d.when, today)?.day ?? undefined;
    const status = (d.status ?? '').trim();
    const done = DONE_WORDS.test(status);
    const m = AFTER.exec(d.what);
    return {
      id: `dates:${index}`,
      ref: { kind: 'date', index } as ItemRef,
      what: m ? d.what.slice(0, m.index).trim() : d.what,
      when: d.when,
      ...(day !== undefined ? { day } : {}),
      status,
      done,
      late: !done && (MILESTONE_LATE.test(status) || (day !== undefined && day < today)),
      ...(m ? { after: m[1].trim() } : {}),
    };
  });
}

// ── People ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HubPerson {
  name: string;
  role: string;
  /** The role as written, when the reading below shortened it (the edit box opens on this, never the short form). */
  roleRaw?: string;
  company: string;
  /** Open actions they have. */
  open: number;
  overdue: number;
  /** The last day an update or decision named them. */
  heard?: number;
  /** Where they're written in the project. */
  ref: ItemRef;
}

/** A person's own role, once (13 Nov 2026, the picture: one row repeated its own name — "… execution (Arlen
 *  Fenwick)" — and another held other people's lines — "Eastwick (Thaddeus Vance); Jay Lu — Riverton (Jay Lu);
 *  …"). A role written as several "part (Name)" or "Name — part" segments keeps only the parts naming this
 *  person (or nobody), with their own name taken off; anything else reads byte for byte as written. */
export function ownRole(role: string, name: string, known: readonly string[] = []): string {
  if (!role.trim()) return role;
  const self = (s: string) => !!s.trim() && namesPerson(s, name);
  const other = (s: string) => !!s.trim() && known.some((k) => norm(k) !== norm(name) && namesPerson(s, k));
  const stripSelf = (s: string) => {
    let out = s;
    // Their own name leading the segment ("Priya Nair — Riverton") goes with the parens below.
    const lead = /^(.+?)\s*[—–-]\s+(.+)$/.exec(out);
    if (lead && self(lead[1])) out = lead[2];
    let hit = out !== s;
    out = out.replace(/\(([^()]*)\)/g, (m, inner: string) => {
      if (self(inner)) {
        hit = true;
        return '';
      }
      return m;
    });
    if (!hit) return s;
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([,;:.])/g, '$1').trim();
  };
  const verdict = (seg: string): 'self' | 'other' | 'none' => {
    const parens = [...seg.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
    const lead = /^(.+?)\s*[—–-]\s+/.exec(seg)?.[1];
    const cands = [...(lead ? [lead] : []), ...parens];
    if (cands.some(self)) return 'self';
    if (cands.some(other)) return 'other';
    return 'none';
  };
  const segs = role
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length <= 1) return stripSelf(role);
  let changed = false;
  const kept: string[] = [];
  for (const s of segs) {
    if (verdict(s) === 'other') {
      changed = true;
      continue;
    }
    const stripped = stripSelf(s);
    if (stripped !== s) changed = true;
    if (stripped) kept.push(stripped);
    else changed = true;
  }
  if (!changed) return role;
  if (!kept.length) return segs.map(stripSelf).filter(Boolean).join('; ') || role;
  return kept.join('; ');
}

function personRows(p: Project): { name: string; role: string; roleRaw?: string; company: string; ref: ItemRef }[] {
  const out: { name: string; role: string; company: string; ref: ItemRef }[] = p.people.map((x, i) => ({ name: stripLinks(x.name).trim(), role: stripLinks(x.role ?? '').replace(/\s*\(\[\[[^\]]+\]\]\)\s*$/, '').trim(), company: '', ref: { kind: 'section', heading: 'people' } as ItemRef, i }));
  for (const x of p.extra) {
    const t = readTable(x.body);
    if (!t || column(t, /^name$/i) < 0 || (column(t, /^role$/i) < 0 && column(t, /^company$/i) < 0)) continue;
    const [n, r, c] = [column(t, /^name$/i), column(t, /^role$/i), column(t, /^(company|organisation|organization|org)$/i)];
    t.rows.forEach((row, i) => {
      const name = stripLinks(row[n] ?? '').trim();
      if (!name || out.some((o) => norm(o.name) === norm(name))) return;
      out.push({ name, role: stripLinks(r >= 0 ? (row[r] ?? '') : '').trim(), company: c >= 0 ? (row[c] ?? '').trim() : '', ref: { kind: 'workstream', section: x.heading, row: i } });
    });
  }
  const known = out.map((o) => o.name);
  return out.map((o) => {
    const role = ownRole(o.role, o.name, known);
    return role === o.role ? o : { ...o, role, roleRaw: o.role };
  });
}

/** When updates and decisions last named someone (a person or a company). */
function lastHeard(p: Project, name: string, today: number): number | undefined {
  let best: number | undefined;
  for (const u of [...p.updates.map((x) => ({ date: x.date, text: `${x.what} ${x.from ?? ''}` })), ...p.decisions.map((x) => ({ date: x.date, text: `${x.what} ${x.why ?? ''}` }))]) {
    const day = readDay(u.date, today) ?? dayIn(u.date, today)?.day;
    if (day === undefined) continue;
    if (namesPerson(stripLinks(u.text), name)) best = best === undefined ? day : Math.max(best, day);
  }
  return best;
}

// ── The hub ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Attention {
  id: string;
  tone: 'bad' | 'warn';
  kind: 'overdue' | 'late' | 'due' | 'expiring' | 'waiting' | 'silent' | 'risk' | 'unowned' | 'soon';
  title: string;
  detail: string;
  /** The day it's about (for its date chip). */
  day?: number;
  ref: ItemRef;
}

export interface WaitingGroup {
  person: string;
  items: HubAction[];
  /** The longest anything here has been waiting (days), when known. */
  waitingDays?: number;
  overdue: number;
  heard?: number;
}

export interface HubInput {
  project: Project;
  props?: Record<string, unknown>;
  /** Today (timeline days: src/shared/timeline.ts todayDay). */
  today: number;
  /** Who "my" is: the person's name as the projects write it (else the project's owner). */
  me?: string;
  /** The project's actions written elsewhere (WS1, 24 Oct 2026): a meeting's actions, task lines in its notes, read by
   *  the connected vault (src/shared/records.ts connectedActions). They count in Needs attention, My actions and Waiting
   *  on others like the project's own; one the project already has (filed from the meeting) is counted once. */
  connected?: ConnectedAction[];
}

/** An action of the project written outside its file, as the connected vault reads it (src/shared/records.ts). */
export interface ConnectedAction {
  /** Its record id in the connected vault. */
  id: string;
  /** The note it is written in, and its line there. */
  path: string;
  line?: number;
  what: string;
  who?: string;
  /** As written ("by Fri 30 Oct"), and the day read from it (YYYY-MM-DD). */
  when?: string;
  due?: string;
  done: boolean;
  /** The meeting or note it comes from, by name. */
  from?: string;
  /** A tick box: its words as written. */
  task?: string;
}

export interface HubModel {
  me: string;
  actions: HubAction[];
  mine: HubAction[];
  unowned: HubAction[];
  waiting: WaitingGroup[];
  attention: Attention[];
  /** What has gone by and is not marked done, to ask about: dates to confirm, newest first. */
  toConfirm: Attention[];
  /** The person's own open actions (mine plus unassigned), grouped by when. */
  plan: { late: HubAction[]; week: HubAction[]; later: HubAction[]; undated: HubAction[] };
  /** The single most urgent of the person's own actions, or null. */
  next: HubAction | null;
  milestones: HubMilestone[];
  /** The next ones to come (not done), soonest first. */
  upcoming: HubMilestone[];
  workstreams: Workstream[];
  people: HubPerson[];
  decisions: { what: string; why: string; day?: number; date: string; ref: ItemRef }[];
  openRisks: { what: string; impact: string; owner: string; status: string; ref: ItemRef; high: boolean }[];
  counts: { open: number; done: number; overdue: number; mine: number; waiting: number };
}

const EXPIRES = /\b(valid(?:ity)?(?: only)?(?: to| until| till)?|expir\w*|lapse\w*|deadline|must be (?:complete|completed|done|in|lodged|signed)|no later than|cut-?off|closes?)\b/i;
const HIGH = /\b(high|critical|severe|major|red)\b/i;
// Whole words: hub cards wrap (t207 pass 2).
const clip = (s: string, _n = 110) => {
  const t = stripLinks(s).replace(/\s+/g, ' ').trim();
  return t;
};
const wordSet = (s: string) => new Set(norm(stripLinks(s)).split(' ').filter(Boolean));
/** Two lines that say the same thing: one's words all inside the other's ("Send quote" and "Send the quote to the mill").
 *  Lines differing on both sides ("Harbour fitout stage two" and "… stage three") are two things, never one. */
export function alike(a: string, b: string): boolean {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common === Math.min(A.size, B.size);
}
/** A risk's rank, highest first (t141, 9 Nov 2026: risks read as a short ranked list, whatever order the file
 *  holds — the same words the page's tones read, so the rank and the colour never disagree). */
export function riskLevelRank(level?: string | null): number {
  const l = level ?? '';
  if (/high|critical|severe/i.test(l)) return 0;
  if (/medium|moderate/i.test(l)) return 1;
  if (/low|minor|negligible/i.test(l)) return 2;
  return 3;
}
const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const agoWords = (day: number, today: number) => (day === today ? 'today' : day === today - 1 ? 'yesterday' : day < today ? `${daysWord(today - day)} ago` : day === today + 1 ? 'tomorrow' : `in ${daysWord(day - today)}`);

/** Which lifecycle words aren't the project still going (for its due date). */
const finished = (p: Project, props: Record<string, unknown>) => /\b(done|closed|cancelled|complete)\b/i.test(p.status ?? '') || stageOf(props, p) === 'done';

/**
 * The project's actions written elsewhere (a meeting's, a note's task lines; src/shared/records.ts connectedActions) as
 * the hub's actions: each once (a line filed from a meeting into What's next is the project's own), a meeting's line no
 * one took with no owner, a tick box in the project's notes the person's own.
 */
export function connectedActionsOf(existing: HubAction[], connected: ConnectedAction[], me: string, today: number, fold = true): HubAction[] {
  const out: HubAction[] = [];
  for (const c of connected) {
    // Unfolded (fold false: a meeting's card reads its own actions whole, t248): nothing drops, so the card
    // agrees with the meeting on what is open.
    if (!c.what.trim() || (fold && (existing.some((a) => alike(a.what, c.what)) || out.some((a) => alike(a.what, c.what))))) continue;
    const due = c.due ? readDay(c.due, today) : null;
    const a = action(`record:${c.id}`, { kind: 'record', id: c.id, path: c.path, ...(c.line !== undefined ? { line: c.line } : {}) }, { what: c.what, who: c.who, when: c.when ?? '', done: c.done }, me, today);
    // No one named: a tick box in the project's notes is the person's own; a meeting's line no one took has no owner yet.
    if (!c.who?.trim() && c.task === undefined) {
      a.mine = false;
      a.unassigned = true;
      a.person = '';
    }
    // The connected vault read the day already (from the meeting's own day): it stands when the words alone don't say.
    if (a.due === undefined && due !== null) {
      a.due = due;
      a.overdue = !c.done && due < today;
    }
    if (c.from) a.from = c.from;
    if (c.task !== undefined) a.task = c.task;
    out.push(a);
  }
  return out;
}

export function hubModel({ project: p, props = {}, today, me: meIn, connected = [] }: HubInput): HubModel {
  const me = (meIn ?? '').trim() || (p.owner ?? '').trim();
  const actions = projectActions(p, me, today);
  actions.push(...connectedActionsOf(actions, connected, me, today));
  const open = actions.filter((a) => !a.done);
  const byDue = (a: HubAction, b: HubAction) => Number(b.overdue) - Number(a.overdue) || (a.due ?? Infinity) - (b.due ?? Infinity);
  const mine = open.filter((a) => a.mine).sort(byDue);
  const unowned = open.filter((a) => a.unassigned).sort(byDue);
  // Waiting on others: each person's open items, the longest wait first.
  const groups = new Map<string, WaitingGroup>();
  for (const a of open) {
    if (a.mine || a.unassigned || !a.person) continue;
    const key = norm(a.person);
    const g = groups.get(key) ?? { person: a.person, items: [], overdue: 0 };
    g.items.push(a);
    if (a.overdue) g.overdue++;
    const waited = a.since !== undefined ? today - a.since : a.overdue && a.due !== undefined ? today - a.due : undefined;
    if (waited !== undefined && waited > 0) g.waitingDays = Math.max(g.waitingDays ?? 0, waited);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.items.sort(byDue);
    const heard = lastHeard(p, g.person, today);
    if (heard !== undefined) g.heard = heard;
  }
  const soonest = (g: WaitingGroup) => Math.min(...g.items.map((a) => a.due ?? Infinity));
  const waiting = [...groups.values()].sort((a, b) => b.overdue - a.overdue || (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || soonest(a) - soonest(b) || b.items.length - a.items.length);

  // The person's plan: their own open actions (mine plus unassigned, never other people's), grouped by when.
  const ownIndexed = open.map((a, i) => ({ a, i })).filter(({ a }) => a.mine || a.unassigned);
  const planList = (list: { a: HubAction; i: number }[]) => list.sort((x, y) => (x.a.due ?? Infinity) - (y.a.due ?? Infinity) || x.i - y.i).map(({ a }) => a);
  const plan = {
    late: planList(ownIndexed.filter(({ a }) => a.overdue)),
    week: planList(ownIndexed.filter(({ a }) => a.due !== undefined && a.due >= today && a.due <= today + 7)),
    later: planList(ownIndexed.filter(({ a }) => a.due !== undefined && a.due > today + 7)),
    undated: planList(ownIndexed.filter(({ a }) => a.due === undefined)),
  };
  const next = plan.late[0] ?? plan.week[0] ?? plan.later[0] ?? plan.undated[0] ?? null;

  const milestones = projectMilestones(p, today);
  const upcoming = milestones.filter((m) => !m.done && m.day !== undefined && m.day >= today).sort((a, b) => a.day! - b.day!);
  const streams = workstreams(p);

  // Risks still open, the high ones first.
  const openRisks = p.risks
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !r.closed && !/\b(closed|resolved|done)\b/i.test(r.status ?? ''))
    .map(({ r, index }) => ({ what: r.what, impact: r.level ?? '', owner: r.owner ?? '', status: r.status ?? '', ref: { kind: 'risk', index } as ItemRef, high: HIGH.test(r.level ?? '') }))
    .sort((a, b) => Number(b.high) - Number(a.high));

  // ── Needs attention ──
  const attention: Attention[] = [];
  const seen = new Set<string>();
  const add = (a: Attention) => {
    const key = itemKey(a.ref);
    if (a.ref.kind !== 'section' && seen.has(key)) return;
    seen.add(key);
    attention.push(a);
  };
  // Dates to confirm: what has gone by and is not marked done, newest first.
  const toConfirm: Attention[] = [];
  const seenConfirm = new Set<string>();
  const addConfirm = (a: Attention) => {
    const key = itemKey(a.ref);
    if (a.ref.kind !== 'section' && seenConfirm.has(key)) return;
    seenConfirm.add(key);
    toConfirm.push(a);
  };
  // Quotes, validity and deadlines ending (in the last 45 days or the next three weeks).
  const expiring: { text: string; day: number; ref: ItemRef; source: string }[] = [];
  for (const m of milestones) if (m.day !== undefined && !m.done && EXPIRES.test(m.what)) expiring.push({ text: m.what, day: m.day, ref: m.ref, source: 'Key date' });
  for (const a of open) if (a.due !== undefined && EXPIRES.test(`${a.what} ${a.when}`)) expiring.push({ text: a.what, day: a.due, ref: a.ref, source: 'Action' });
  for (const r of openRisks) {
    const found = EXPIRES.test(r.what) ? dayIn(r.what.slice(Math.max(0, r.what.search(EXPIRES))), today) : null;
    if (found) expiring.push({ text: r.what, day: found.day, ref: r.ref, source: 'Risk' });
  }
  const expiringDays = new Set<number>();
  for (const x of expiring.sort((a, b) => a.day - b.day)) {
    if (x.day < today - 45 || x.day > today + 21 || expiringDays.has(x.day)) continue;
    expiringDays.add(x.day);
    // Still to come (today or later) needs the person now; what has already ended is a date to confirm.
    const put = x.day >= today ? add : addConfirm;
    put({ id: `expiring:${itemKey(x.ref)}`, tone: x.day <= today + 3 ? 'bad' : 'warn', kind: 'expiring', title: clip(x.text), detail: x.day < today ? `Ended ${agoWords(x.day, today)}` : x.day === today ? 'Ends today' : `Ends ${agoWords(x.day, today)}`, day: x.day, ref: x.ref });
  }
  // Overdue actions of the person's own (other people's stay in Waiting on others), then the project's own due date.
  for (const a of open.filter((x) => x.overdue && (x.mine || x.unassigned)).sort((x, y) => x.due! - y.due!)) {
    const whose = a.mine ? 'You' : a.unassigned ? 'No owner' : `Waiting on ${a.person}`;
    add({ id: `overdue:${a.id}`, tone: 'bad', kind: 'overdue', title: clip(a.what), detail: `${daysWord(today - a.due!)} overdue · ${whose}`, day: a.due, ref: a.ref });
  }
  const overdueWords = open.filter((x) => x.overdue).map((x) => x.what);
  const due = readDay(p.due, today);
  const dueShown = due !== null && due < today && !finished(p, props);
  for (const m of milestones.filter((x) => x.late && x.day !== undefined && x.day >= today - 45 && x.day < today && !overdueWords.some((w) => alike(w, x.what)) && !(dueShown && x.day === due))) addConfirm({ id: `late:${m.id}`, tone: 'bad', kind: 'late', title: clip(m.what), detail: `Milestone passed ${agoWords(m.day!, today)}${m.status ? ` · marked ${m.status.toLowerCase()}` : ''}`, day: m.day, ref: m.ref });
  if (dueShown) add({ id: 'due', tone: 'bad', kind: 'due', title: 'The project’s due date has passed', detail: `Due ${shortDay(due!, today)} · ${daysWord(today - due!)} ago, with ${open.length} ${open.length === 1 ? 'action' : 'actions'} open`, day: due!, ref: { kind: 'due' } });
  // Waiting on someone longer than a week.
  for (const g of waiting)
    for (const a of g.items) {
      if (a.overdue || a.since === undefined || today - a.since < 7) continue;
      add({ id: `waiting:${a.id}`, tone: today - a.since >= 14 ? 'bad' : 'warn', kind: 'waiting', title: clip(a.what), detail: `Waiting ${daysWord(today - a.since)} on ${g.person}`, day: a.since, ref: a.ref });
    }
  // Things the person asked for (of a supplier, say) a week or more ago, with nothing written since.
  for (const a of mine) {
    if (a.overdue || a.since === undefined || today - a.since < 7) continue;
    add({ id: `asked:${a.id}`, tone: today - a.since >= 14 ? 'bad' : 'warn', kind: 'waiting', title: clip(a.what), detail: `Asked ${shortDay(a.since, today)} · ${daysWord(today - a.since)} with no reply written`, day: a.since, ref: a.ref });
  }
  const order: Attention['kind'][] = ['overdue', 'expiring', 'late', 'due', 'waiting', 'risk', 'soon', 'silent', 'unowned'];
  attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1) || order.indexOf(a.kind) - order.indexOf(b.kind) || (a.day ?? 0) - (b.day ?? 0));
  toConfirm.sort((a, b) => (b.day ?? 0) - (a.day ?? 0));

  // People: the project's own, with what they have open and when they were last heard from.
  const rows = personRows(p);
  for (const a of open) if (a.person && !a.mine && !rows.some((r) => norm(r.name) === norm(a.person) || namesPerson(r.name, a.person))) rows.push({ name: a.person, role: '', company: '', ref: { kind: 'person', name: a.person } });
  // One name each, however the file writes it (t211, 11 Nov 2026: "Alex Chen" beside "Alex Chen (owner)" read as two;
  // t208 fixed the header's stack, this fixes every reader at the hub). First kept, the owner once.
  const seenPeople = new Set<string>();
  const uniq = rows.filter((r) => {
    const k = norm(r.name.replace(/\s*\(owner\)\s*$/i, ''));
    if (!k || seenPeople.has(k)) return false;
    seenPeople.add(k);
    return true;
  });
  const people: HubPerson[] = uniq.map((r) => {
    const theirs = open.filter((a) => a.person && (norm(a.person) === norm(r.name) || namesPerson(r.name, a.person) || namesPerson(a.who, r.name)));
    const heard = lastHeard(p, r.name, today);
    return { name: r.name, role: r.role, ...(r.roleRaw !== undefined ? { roleRaw: r.roleRaw } : {}), company: r.company, open: theirs.length, overdue: theirs.filter((a) => a.overdue).length, ...(heard !== undefined ? { heard } : {}), ref: { kind: 'person', name: r.name } };
  });

  const decisions = p.decisions
    .map((d, index) => {
      const day = readDay(d.date, today) ?? dayIn(d.date, today)?.day;
      return { what: d.what, why: d.why ?? '', date: d.date ?? '', ...(day !== undefined ? { day } : {}), ref: { kind: 'decision', index } as ItemRef };
    })
    .sort((a, b) => (b.day ?? -Infinity) - (a.day ?? -Infinity));

  return {
    me,
    actions,
    mine,
    unowned,
    waiting,
    attention,
    toConfirm,
    plan,
    next,
    milestones,
    upcoming,
    workstreams: streams,
    people,
    decisions,
    openRisks,
    counts: { open: open.length, done: actions.length - open.length, overdue: open.filter((a) => a.overdue).length, mine: mine.length, waiting: waiting.reduce((n, g) => n + g.items.length, 0) },
  };
}

// ── Files by purpose ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Purpose = 'quotes' | 'reports' | 'plans' | 'meetings' | 'contracts' | 'data' | 'reference' | 'other';
export const PURPOSE_WORDS: Record<Purpose, string> = {
  quotes: 'Quotes and pricing',
  reports: 'Reports and status',
  plans: 'Plans and designs',
  meetings: 'Meetings',
  contracts: 'Contracts and approvals',
  data: 'Lists and data',
  reference: 'Reference',
  other: 'Other files',
};
const PURPOSES: [Purpose, RegExp][] = [
  ['quotes', /\b(quotes?|quotations?|pricing|price|prices|invoices?|po|purchase order|costs?|budget|estimate|proposal|tender|rfq|rfp)\b/i],
  ['meetings', /\b(meetings?|minutes|agenda|raci|workshop|call|catch-?up|stand-?up)\b/i],
  ['contracts', /\b(contracts?|sow|agreement|terms|signed|approval|approved|nda|msa|licen[cs]e|lease)\b/i],
  ['reports', /\b(reports?|status|progress|update|summary|reconciliation|review|findings|audit|record|catch-?up)\b/i],
  ['plans', /\b(plans?|design|designs|layout|drawings?|blueprint|bom|playbook|spec|specification|schedule|run ?sheet|diagram|floor ?plan|roadmap|markup)\b/i],
  ['data', /\b(list|export|cross-?check|inventory|register|tracker|devices?|data|check)\b/i],
  ['reference', /\b(guide|manual|reference|training|policy|standard|handbook|how ?to)\b/i],
];

export interface HubFileIn {
  /** Where it is: a file in the project's folder (relative), a vault path, or a link as written. */
  path: string;
  name: string;
  what?: string;
  /** When it last changed (ms since 1970), when known. */
  modified?: number;
  /** Pinned in Documents. */
  pinned?: boolean;
  note?: boolean;
  link?: string;
}
export interface HubFile extends HubFileIn {
  purpose: Purpose;
  /** The day it's from: a date in its name or words, else when it changed. */
  day?: number;
}

/** Whether two file spellings are the same file: the same path, or the same name where either folder is unknown or
 *  equal (a link and its path). "Plans/Status.pdf" and "Reports/Status.pdf" are two files. */
export const sameFile = (a: string, b: string): boolean => {
  const ka = a.replace(/^\.\//, '').toLowerCase();
  const kb = b.replace(/^\.\//, '').toLowerCase();
  if (ka === kb) return true;
  const na = ka.split('/').pop() ?? ka;
  const nb = kb.split('/').pop() ?? kb;
  if (na !== nb) return false;
  const fa = ka.includes('/') ? ka.slice(0, ka.lastIndexOf('/')) : '';
  const fb = kb.includes('/') ? kb.slice(0, kb.lastIndexOf('/')) : '';
  return !fa || !fb || fa === fb;
};

/** What a file is for, from its name and what's written about it. */
export function purposeOf(name: string, what = ''): Purpose {
  const words = `${name.replace(/[_\-.]+/g, ' ')} ${what}`;
  for (const [p, re] of PURPOSES) if (re.test(name.replace(/[_\-.]+/g, ' '))) return p;
  for (const [p, re] of PURPOSES) if (re.test(words)) return p;
  return /\.(xlsx|xls|csv)$/i.test(name) ? 'data' : 'other';
}

/** The project's files grouped by purpose, newest first in each, the groups with the newest file first. */
export function filesByPurpose(files: HubFileIn[], today: number, perGroup = 4): { purpose: Purpose; words: string; files: HubFile[]; more: number }[] {
  const seen: string[] = [];
  const out = new Map<Purpose, HubFile[]>();
  for (const f of files) {
    const target = f.path || f.name;
    if (!target || seen.some((s) => sameFile(s, target))) continue;
    seen.push(target);
    const named = dayIn(f.name.replace(/_/g, ' ').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), today)?.day ?? dayIn(f.what ?? '', today)?.day;
    const fromModified = f.modified ? dayFrom(new Date(f.modified).getFullYear(), new Date(f.modified).getMonth(), new Date(f.modified).getDate()) : undefined;
    const day = named !== undefined && named <= today + 1 ? named : fromModified;
    const purpose = purposeOf(f.name, f.what);
    const list = out.get(purpose) ?? [];
    list.push({ ...f, purpose, ...(day !== undefined ? { day } : {}) });
    out.set(purpose, list);
  }
  return [...out.entries()]
    .map(([purpose, list]) => {
      const sorted = list.sort((a, b) => (b.day ?? -Infinity) - (a.day ?? -Infinity) || Number(!!b.pinned) - Number(!!a.pinned));
      return { purpose, words: PURPOSE_WORDS[purpose], files: sorted.slice(0, perGroup), more: Math.max(0, sorted.length - perGroup) };
    })
    .sort((a, b) => Number(a.purpose === 'other') - Number(b.purpose === 'other') || (b.files[0]?.day ?? -Infinity) - (a.files[0]?.day ?? -Infinity));
}

// ── What changed between two versions ────────────────────────────────────────────────────────────────────────────────

const q = (s: string, n = 60) => `“${clip(s, n)}”`;

/** What changed between two versions of a project, in words ("Ticked off “Book the van”", "Status: Active → Done"). */
export function projectChanges(before: Project, after: Project, today: number, max = 6): string[] {
  const out: string[] = [];
  const say = (s: string) => out.length < max * 3 && out.push(s);
  const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'not set');
  for (const [k, words] of [['status', 'Status'], ['health', 'Health'], ['owner', 'Owner']] as const) if ((before[k] ?? '') !== (after[k] ?? '')) say(`${words}: ${cap(before[k])} → ${cap(after[k])}`);
  if (before.progress !== after.progress && after.progress !== undefined) say(`Progress ${before.progress ?? 0}% → ${after.progress}%`);
  const stageA = before.own?.stage ?? undefined, stageB = after.own?.stage ?? undefined;
  if (stageA !== stageB && stageB) say(`Stage → ${cap(stageB)}`);
  if ((before.due ?? '') !== (after.due ?? '') && after.due) say(`Due date → ${shortDay(readDay(after.due, today) ?? today, today)}`);
  // Actions, by their words.
  const acts = (p: Project) => projectActions(p, '', today);
  const A = new Map(acts(before).map((a) => [norm(a.what), a]));
  const B = acts(after);
  for (const b of B) {
    const a = A.get(norm(b.what));
    if (!a) say(`Added ${q(b.what)}${b.who ? ` for ${mainPerson(b.who)}` : ''}`);
    else {
      if (!a.done && b.done) say(`Ticked off ${q(b.what)}`);
      else if (a.done && !b.done) say(`Reopened ${q(b.what)}`);
      if (a.due !== b.due && b.due !== undefined) say(`${q(b.what, 44)} moved to ${shortDay(b.due, today)}`);
      if (norm(a.who) !== norm(b.who) && b.who) say(`${q(b.what, 44)} now with ${mainPerson(b.who)}`);
    }
  }
  const Bk = new Set(B.map((b) => norm(b.what)));
  for (const a of A.values()) if (!Bk.has(norm(a.what))) say(`Took off ${q(a.what)}`);
  // Key dates.
  const D = new Map(before.dates.map((d) => [norm(d.what), d]));
  for (const d of after.dates) {
    const was = D.get(norm(d.what));
    if (!was) say(`New milestone ${q(d.what)}${readDay(d.when, today) !== null ? ` on ${shortDay(readDay(d.when, today)!, today)}` : ''}`);
    else {
      if (was.when !== d.when && readDay(d.when, today) !== null) say(`${q(d.what, 44)} moved to ${shortDay(readDay(d.when, today)!, today)}`);
      if ((was.status ?? '') !== (d.status ?? '') && d.status) say(`${q(d.what, 44)}: ${d.status}`);
    }
  }
  // Risks and decisions.
  const R = new Map(before.risks.map((r) => [norm(r.what), r]));
  for (const r of after.risks) {
    const was = R.get(norm(r.what));
    if (!was) say(`New risk ${q(r.what)}`);
    else if (!was.closed && r.closed) say(`Closed the risk ${q(r.what)}`);
    else if (was.closed && !r.closed) say(`Reopened the risk ${q(r.what)}`);
  }
  const Dc = new Set(before.decisions.map((d) => norm(d.what)));
  for (const d of after.decisions) if (!Dc.has(norm(d.what))) say(`Decided ${q(d.what)}`);
  const U = new Set(before.updates.map((u) => norm(u.what)));
  for (const u of after.updates) if (!U.has(norm(u.what))) say(`Update: ${q(u.what, 80)}`);
  const F = new Set(before.documents.map((d) => norm(d.path)));
  for (const d of after.documents) if (!F.has(norm(d.path))) say(`Filed ${q(d.path.split('/').pop() ?? d.path)}`);
  // Workstreams, by name.
  const W = new Map(workstreams(before).map((w) => [norm(w.name), w]));
  for (const w of workstreams(after)) {
    const was = W.get(norm(w.name));
    if (!was) say(`New workstream ${q(w.name)}`);
    else {
      if (norm(was.status) !== norm(w.status) && w.status) say(`${q(w.name, 40)}: ${was.status || 'no status'} → ${w.status}`);
      if (was.progress !== w.progress && w.progress !== undefined) say(`${q(w.name, 40)} at ${w.progress}%`);
    }
  }
  if (!out.length && norm(before.summary) !== norm(after.summary)) say('Changed the summary');
  if (!out.length) {
    const changed = after.extra.filter((x) => before.extra.find((y) => norm(y.heading) === norm(x.heading))?.body !== x.body).map((x) => x.heading);
    if (changed.length) say(`Changed ${changed.slice(0, 2).map((h) => q(h, 30)).join(' and ')}`);
  }
  return out.slice(0, max);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const STAGES = ['idea', 'planning', 'active', 'closing', 'done'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_WORDS: Record<Stage, string> = { idea: 'Idea', planning: 'Planning', active: 'Active', closing: 'Closing', done: 'Done' };
export const STAGE_LINES: Record<Stage, string> = {
  idea: 'Worth doing? The outcome, who wants it and roughly what it takes.',
  planning: 'How it will be done: workstreams, dates, people, budget and risks.',
  active: 'Doing the work: actions moving, risks watched, everyone kept up to date.',
  closing: 'Finishing well: delivered, handed over, loose ends tied off.',
  done: 'Closed: the close-out report written and the files kept.',
};

/** Each stage's checklist when the project hasn't written its own. */
export const DEFAULT_CHECKLIST: Record<Stage, string[]> = {
  idea: ['The outcome and why it matters, in the summary', 'Who wants it and who owns it', 'A rough size: budget and timing'],
  planning: ['Workstreams or phases set out', 'Key dates agreed', 'People and their roles named', 'Risks listed, each with an owner', 'Budget or quotes approved'],
  active: ['Every action has an owner and a date', 'Weekly update sent', 'Risks reviewed this fortnight', 'Key files kept with the project'],
  closing: ['Everything delivered and handed over', 'Open actions closed or handed on', 'Suppliers paid and contracts closed', 'Lessons gathered from the team'],
  done: ['Close-out report written', 'Files archived', 'Project marked done'],
};

/** Where the project's stage is written: `stage:` (or `lifecycle:` when `stage:` holds something else, a venture's stage). */
export function stageKey(props: Record<string, unknown>): 'stage' | 'lifecycle' {
  const s = String(props.stage ?? '').trim().toLowerCase();
  return s && !(STAGES as readonly string[]).includes(s) ? 'lifecycle' : 'stage';
}

/** The stage the project is at: as written, else from its status (on hold is still Active). */
export function stageOf(props: Record<string, unknown>, p: Pick<Project, 'status'>): Stage {
  for (const key of ['stage', 'lifecycle']) {
    const s = String(props[key] ?? '').trim().toLowerCase();
    if ((STAGES as readonly string[]).includes(s)) return s as Stage;
  }
  const status = String(p.status ?? '').toLowerCase();
  if (/\b(done|closed|complete|completed|finished|cancelled)\b/.test(status)) return 'done';
  if (/\bidea\b/.test(status)) return 'idea';
  if (/\b(planning|planned|scoping|proposed)\b/.test(status)) return 'planning';
  if (/\b(closing|wrapping)\b/.test(status)) return 'closing';
  return 'active';
}

/** The status a stage brings with it (the page's Status pill follows the stepper), or undefined to leave it. */
export function statusForStage(stage: Stage, status?: string): string | undefined {
  if (stage === 'idea' || stage === 'planning' || stage === 'done') return stage;
  // Active and Closing are both "active", unless the person has it on hold.
  return /on hold/i.test(status ?? '') ? undefined : 'active';
}

export interface ChecklistItem {
  what: string;
  done: boolean;
  /** Its line in the Stage checklist section (undefined: one of the defaults, not written yet). */
  line?: number;
}
export interface StageChecklist {
  stage: Stage;
  items: ChecklistItem[];
  /** The project has written this stage's list (else the defaults show). */
  written: boolean;
}

const stageOfPhase = (name: string): Stage | undefined => STAGES.find((s) => norm(name) === s || norm(name).startsWith(`${s} `));

/** Each stage's checklist: the project's own (## Stage checklist, ### per stage), else the defaults. */
export function stageChecklists(p: Project): StageChecklist[] {
  const phases = runSheet(sectionText(p, STAGE_HEADING));
  return STAGES.map((stage) => {
    const phase = phases.find((x) => stageOfPhase(x.name) === stage);
    return phase ? { stage, written: true, items: phase.items.map((i) => ({ what: i.what, done: i.done, line: i.line })) } : { stage, written: false, items: DEFAULT_CHECKLIST[stage].map((what) => ({ what, done: false })) };
  });
}

/** The checklist section's words with every stage in it (the defaults written for any stage not written yet). */
export function fullChecklist(body: string): string {
  const phases: RunPhase[] = runSheet(body);
  const lines: string[] = [];
  const kept = String(body ?? '').replace(/\s+$/, '');
  if (!phases.some((x) => stageOfPhase(x.name))) {
    for (const s of STAGES) lines.push(`### ${STAGE_WORDS[s]}`, '', ...DEFAULT_CHECKLIST[s].map((w) => `- [ ] ${w}`), '');
    // With no words of its own yet the stages start the section (5 Nov 2026: kept '' joined first, so the body began
    // with a blank the save's flattening used to hide, leaving "## Stage checklist\n\n\n### Idea" on the first tick).
    return [...(kept ? [kept, ''] : []), ...lines].join('\n').replace(/\n+$/, '');
  }
  // Missing stages go in their place among the written ones.
  let out = kept;
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    const now = runSheet(out);
    if (now.some((x) => stageOfPhase(x.name) === s)) continue;
    const block = [`### ${STAGE_WORDS[s]}`, '', ...DEFAULT_CHECKLIST[s].map((w) => `- [ ] ${w}`), ''];
    const nextWritten = now.find((x) => STAGES.indexOf(stageOfPhase(x.name) ?? 'idea') > i && stageOfPhase(x.name) && x.line !== undefined);
    const all = out.split('\n');
    if (nextWritten && nextWritten.line !== undefined) all.splice(nextWritten.line, 0, ...block);
    else all.push('', ...block);
    out = all.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  }
  return out;
}

/** A change to the stage checklist, as the project edit that writes it (the whole list written the first time). */
export function checklistEdit(p: Project, change: { kind: 'toggle'; stage: Stage; index: number } | { kind: 'add'; stage: Stage; what: string } | { kind: 'rename'; stage: Stage; index: number; what: string } | { kind: 'remove'; stage: Stage; index: number }): ProjectEdit | null {
  const body = fullChecklist(sectionText(p, STAGE_HEADING));
  const phase = runSheet(body).find((x) => stageOfPhase(x.name) === change.stage);
  if (!phase) return null;
  const item = 'index' in change ? phase.items[change.index] : undefined;
  if ('index' in change && !item) return null;
  let next = body;
  let words = '';
  switch (change.kind) {
    case 'toggle':
      next = toggleRunSheetItem(body, item!.line);
      words = item!.done ? `Unticked “${clip(item!.what, 48)}”.` : `Ticked “${clip(item!.what, 48)}”.`;
      break;
    case 'add':
      if (!change.what.trim()) return null;
      next = addRunSheetItem(body, phase.name, change.what.trim());
      words = `Added “${clip(change.what, 48)}” to ${STAGE_WORDS[change.stage]}.`;
      break;
    case 'rename':
      if (!change.what.trim()) return null;
      next = setRunSheetItem(body, item!.line, { what: change.what.trim() });
      words = `Changed a ${STAGE_WORDS[change.stage]} checklist line.`;
      break;
    case 'remove':
      next = removeRunSheetItem(body, item!.line);
      words = `Took “${clip(item!.what, 48)}” off the ${STAGE_WORDS[change.stage]} checklist.`;
      break;
  }
  return { kind: 'section', heading: STAGE_HEADING, body: next, words };
}

// ── Moving an action or milestone to another day ─────────────────────────────────────────────────────────────────────

/** The project edit that moves a key date, a next step or a tick box to a day, the date written as it was. */
export function rescheduleEdit(p: Project, ref: ItemRef, day: number, today: number): ProjectEdit | null {
  if (ref.kind === 'date') {
    const d = p.dates[ref.index];
    if (!d) return null;
    return { kind: 'change', list: 'dates', index: ref.index, item: { when: replaceDayIn(d.when, day, today) } };
  }
  if (ref.kind === 'next') {
    const n = p.next[ref.index];
    if (!n) return null;
    // A day written where the owner goes ("Jesse · Fri 23 Oct, 11:00") is moved where it is.
    if (!n.when && n.who) {
      const parts = n.who.split(/\s+·\s+/);
      const at = parts.findIndex((x) => dayIn(x, today)?.at === 0);
      if (at >= 0) return { kind: 'change', list: 'next', index: ref.index, item: { who: parts.map((x, i) => (i === at ? replaceDayIn(x, day, today) : x)).join(' · ') } };
    }
    return { kind: 'change', list: 'next', index: ref.index, item: { when: n.when ? replaceDayIn(n.when, day, today) : isoDay(day) } };
  }
  if (ref.kind === 'run') {
    const body = sectionText(p, ref.section);
    const line = body.split(/\r?\n/)[ref.line] ?? '';
    const m = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/.exec(line);
    if (!m) return null;
    const parts = itemParts(m[1]);
    const whoParts = parts.who ? parts.who.split(/\s+·\s+/) : [];
    const inWho = parts.when ? -1 : whoParts.findIndex((x) => dayIn(x, today)?.at === 0);
    const text =
      inWho >= 0
        ? withItemParts(m[1], { who: whoParts.map((x, i) => (i === inWho ? replaceDayIn(x, day, today) : x)).join(' · ') })
        : withItemParts(m[1], { when: parts.when && dayIn(parts.when, today) ? replaceDayIn(parts.when, day, today) : isoDay(day) });
    const lines = body.split(/\r?\n/);
    lines[ref.line] = line.replace(m[1], text);
    return { kind: 'section', heading: ref.section, body: lines.join('\n'), words: `Moved “${clip(parts.what, 48)}” to ${shortDay(day, today)}.` };
  }
  if (ref.kind === 'due') return { kind: 'set', field: 'due', value: isoDay(day) };
  return null;
}

// ── The close-out report ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CloseOutInput {
  project: Project;
  props?: Record<string, unknown>;
  today: number;
  /** Files in its folder and notes kept with it, by name. */
  files?: HubFileIn[];
  me?: string;
}

/** The close-out report's file name (beside the project file). */
export const closeOutName = (name: string) => `${cleanFileName(name, '', 80)} close-out report`;

/** The close-out report, written from the project's own data: what was delivered, what's still open and with whom, the
 *  decisions, the risks met, lessons (the project's own, else what its dates and risks show, with room for the team's),
 *  the files and the people. Plain Markdown, a note of its own beside the project. */
export function closeOutReport({ project: p, props = {}, today, files = [], me }: CloseOutInput): string {
  const hub = hubModel({ project: p, props, today, ...(me ? { me } : {}) });
  const L: string[] = [];
  const started = readDay(p.started, today);
  const due = readDay(p.due, today);
  const dayText = (d: number) => {
    const { y, m, d: dd } = ymd(d);
    return `${dd} ${MONTHS[m]} ${y}`;
  };
  L.push('---', 'type: report', `project: "[[${p.name}]]"`, `created: ${isoDay(today)}`, 'tags: [close-out]', '---', `# ${p.name}: close-out report`, '');
  const facts = [p.owner ? `Owner: ${p.owner}` : '', started !== null ? `Started ${dayText(started)}` : '', `Closed ${dayText(today)}`, due !== null ? `Due ${dayText(due)}${today > due ? ` (${daysWord(today - due)} after the due date)` : ''}` : ''].filter(Boolean);
  L.push(facts.join(' · '), '');
  L.push('## Summary', '', p.summary.trim() || '_What this project set out to do, and how it ended._', '');
  // Delivered.
  const doneStreams = hub.workstreams.filter((w) => w.done);
  const doneDates = hub.milestones.filter((m) => m.done);
  const doneActs = hub.actions.filter((a) => a.done);
  L.push('## What was delivered', '');
  if (!doneStreams.length && !doneDates.length && !doneActs.length) L.push('_Nothing is marked done in the project yet: list what was delivered here._');
  for (const w of doneStreams) L.push(`- **${w.name}**${w.next ? ` — ${w.next}` : ''}`);
  for (const m of doneDates) L.push(`- ${m.what}${m.day !== undefined ? ` (${dayText(m.day)})` : ''}`);
  for (const a of doneActs.slice(0, 30)) L.push(`- ${a.what}`);
  if (doneActs.length > 30) L.push(`- …and ${doneActs.length - 30} more actions done`);
  L.push('');
  // Still open.
  const open = hub.actions.filter((a) => !a.done);
  if (open.length) {
    L.push('## Still open at close', '', 'Handed on, or to close before archiving:', '');
    // Plain lines, not tick boxes: they are the project's own actions, kept there (never found again as new ones).
    for (const a of open) L.push(`- ${a.what}${a.who ? ` — ${a.who}` : ''}`);
    L.push('');
  }
  if (p.decisions.length) {
    L.push('## Decisions', '');
    for (const d of hub.decisions) L.push(`- ${d.date ? `**${d.date}** — ` : ''}${d.what}${d.why ? ` *Why:* ${d.why}` : ''}`);
    L.push('');
  }
  // Risks met, and the ones still open at close.
  if (p.risks.length) {
    L.push('## Risks and issues', '');
    const closed = p.risks.filter((r) => r.closed || /\b(closed|resolved|done)\b/i.test(r.status ?? ''));
    for (const r of closed) L.push(`- Dealt with: ${r.what}${r.closedOn ? ` (${r.closedOn})` : ''}`);
    for (const r of hub.openRisks) L.push(`- Open at close: ${splitRiskTail(r.what).what}${r.impact ? ` (${r.impact})` : ''}`);
    L.push('');
  }
  // Lessons: the project's own, else what its dates show, with room for the team's.
  L.push('## Lessons', '');
  const own = p.extra.find((x) => /^lessons?( learned| learnt)?$/i.test(x.heading.trim()));
  if (own?.body.trim()) L.push(own.body.trim());
  else {
    const late = hub.milestones.filter((m) => m.late || /late|missed|slipp/i.test(m.status));
    const seen: string[] = [];
    if (due !== null && today > due) seen.push(`It finished ${daysWord(today - due)} after its due date (${dayText(due)}).`);
    if (late.length) seen.push(`${late.length} of ${plural(hub.milestones.length, 'milestone')} ${late.length === 1 ? 'was' : 'were'} late or missed: ${late.slice(0, 3).map((m) => m.what.replace(/\s+/g, ' ')).join('; ')}.`);
    if (hub.openRisks.filter((r) => r.high).length) seen.push(`${plural(hub.openRisks.filter((r) => r.high).length, 'high risk')} ${hub.openRisks.filter((r) => r.high).length === 1 ? 'was' : 'were'} still open at close.`);
    if (seen.length) L.push('What the project’s own record shows:', '', ...seen.map((s) => `- ${s}`), '');
    L.push('**What went well**', '', '- ', '', '**What we would do differently**', '', '- ');
  }
  L.push('');
  // Files.
  const docs = p.documents.map((d) => `- ${d.link ? d.link : `\`${d.path}\``}${d.what ? ` — ${d.what}` : ''}`);
  const more = files.filter((f) => !p.documents.some((d) => norm(d.path).endsWith(norm(f.name)))).slice(0, 20).map((f) => `- ${f.note ? `[[${f.name}]]` : `\`${f.path}\``}${f.what ? ` — ${f.what}` : ''}`);
  if (docs.length || more.length || p.folder) {
    L.push('## Files', '');
    if (p.folder) L.push(`Kept in the project’s folder: \`${p.folder}\``, '');
    L.push(...docs, ...more, '');
  }
  if (hub.people.length) {
    L.push('## People', '');
    for (const x of hub.people) L.push(`- **${x.name}**${x.role ? ` — ${x.role}` : ''}${x.company ? ` (${x.company})` : ''}`);
    L.push('');
  }
  L.push(`Written by Ironleaf from [[${p.name}]] on ${dayText(today)}.`);
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** One change found in a project's earlier versions (main side: project:changes). */
export interface ProjectChange {
  time: number;
  /** Who made it (src/shared/versions.ts), when the copy says. */
  by?: string;
  words: string[];
}
