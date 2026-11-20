// Family (Wave 5, 24 Oct 2026; module 10 of the catalogue: "Family members, school, activities, events, milestones,
// rewards — Family calendar, who's where, reward tracker", level Family-private; and module 11 as far as Family needs it:
// "Photo albums… protected faces"). Everything is plain Markdown in the vault's Family area, readable in any editor,
// syncing like every note, marked `sensitivity: family` so agents read it only when the person allows Family-private
// (src/shared/sensitivity.ts):
//
//   <Family>/People/<Name>.md        a family member's card: type: person, family: <relation>, born, school, colour;
//                                    ## Documents lists their documents (links), as any person card can
//   <Family>/Family calendar.md      type: family-calendar, three tables:
//                                      ## Activities  | Who | What | Day | Time | Where | Until |   (each week)
//                                      ## Events      | Date | Time | Who | What | Where |          (one day)
//                                      ## Milestones  | Date | Who | Milestone |
//   <Family>/Rewards/<Title>.md      a reward tracker: a log note (docs/LAYOUTS.md) with one yes/no a day; reward_for,
//                                    streak_label, milestones: [7, 14, 30], rewards: {7: …}, claimed: [7]
//   <Family>/Assets/<Album>/…        photo albums: protected assets (Family-private; an agent needs the person's OK each
//                                    time it uses one, src/main/agent-gate.ts)
//   <Family>/Files/<Name>/…          a member's documents kept as files
//
// Nothing here knows anyone's family: names, relations, activities and rewards are the person's. Pure: no files, no Node.

import { addDays, daysBetween, streakOf, todayIso, weekdayOf, type Streak } from './health';
import { addTableRow, appendLogEntry, parseLog, readTable, removeTableRow, setLogValue, setTableCells, type Table } from './layouts';
import { isoDay, readDay } from './days';
import { trackFence, type Fence } from './markdown';
import { IMAGE_EXT, SVG_EXT } from './assets';

export const CALENDAR_NOTE = 'Family calendar.md';
export const MEMBERS_FOLDER = 'People';
export const REWARDS_FOLDER = 'Rewards';
export const ALBUMS_FOLDER = 'Assets';
export const FILES_FOLDER = 'Files';

export const ACTIVITY_HEAD = ['Who', 'What', 'Day', 'Time', 'Where', 'Until'];
export const EVENT_HEAD = ['Date', 'Time', 'Who', 'What', 'Where'];
export const MILESTONE_HEAD = ['Date', 'Who', 'Milestone'];
export type CalendarSection = 'Activities' | 'Events' | 'Milestones';
export const SECTION_HEAD: Record<CalendarSection, string[]> = { Activities: ACTIVITY_HEAD, Events: EVENT_HEAD, Milestones: MILESTONE_HEAD };

export const MEMBER_COLOURS = ['rose', 'sky', 'ochre', 'sage', 'plum', 'teal', 'clay', 'slate'] as const;
export type MemberColour = (typeof MEMBER_COLOURS)[number];

// ── Sections of a note ───────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
const eolOf = (s: string) => (s.includes('\r\n') ? '\r\n' : '\n');

/** Where a "## Heading" section's words are in a note (lines from…to, not counting the heading), or null. A ##
 *  line inside a fenced block is code, not a section. */
export function findSection(text: string, heading: string): { head: number; start: number; end: number; body: string } | null {
  const lines = String(text ?? '').split(/\r?\n/);
  let fence: Fence | null = null;
  let head = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = trackFence(lines[i], fence);
    fence = t.fence;
    if (t.skip) continue;
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m && norm(m[1]) === norm(heading)) {
      head = i;
      break;
    }
  }
  if (head < 0) return null;
  let end = lines.length;
  let inner: Fence | null = null;
  for (let i = head + 1; i < lines.length; i++) {
    const t = trackFence(lines[i], inner);
    inner = t.fence;
    if (t.skip) continue;
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { head, start: head + 1, end, body: lines.slice(head + 1, end).join('\n') };
}

/** A note with one section's words changed (the section made at the end when it isn't there); everything else kept. */
export function withSection(text: string, heading: string, change: (body: string) => string): string {
  const src = String(text ?? '');
  const eol = eolOf(src);
  const lines = src.split(/\r?\n/);
  const at = findSection(src, heading);
  if (!at) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const body = change('').replace(/^\s+|\s+$/g, '');
    return [...lines, '', `## ${heading}`, '', ...body.split('\n'), ''].join(eol);
  }
  const body = lines.slice(at.start, at.end);
  let a = 0;
  let b = body.length;
  while (a < b && !body[a].trim()) a++;
  while (b > a && !body[b - 1].trim()) b--;
  const changed = change(body.slice(a, b).join('\n')).replace(/^\s+|\s+$/g, '');
  // One blank line between the heading and the words, and after them.
  lines.splice(at.start, at.end - at.start, '', ...(changed ? changed.split('\n') : []), '');
  return lines.join(eol);
}

// ── Members ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Member {
  path: string;
  name: string;
  /** "Daughter", "Partner", "Son"… as the person writes it. */
  relation?: string;
  born?: string;
  school?: string;
  colour: MemberColour;
}

const DAYRE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const asDay = (v: unknown): string | undefined => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const t = str(v).replace(/^["']|["']$/g, '');
  return DAYRE.test(t) ? t : undefined;
};

/** Whether a note's properties make it a family member's card. */
export const isMemberProps = (props: Record<string, unknown> | undefined) => !!props && String(props.type ?? '').toLowerCase() === 'person' && props.family !== undefined && props.family !== false && String(props.family).toLowerCase() !== 'false';

export function readMember(path: string, title: string, props: Record<string, unknown>, index = 0): Member {
  const rel = str(props.family);
  const colour = MEMBER_COLOURS.includes(str(props.colour) as MemberColour) ? (str(props.colour) as MemberColour) : MEMBER_COLOURS[index % MEMBER_COLOURS.length];
  return { path, name: title, ...(rel && rel.toLowerCase() !== 'true' ? { relation: rel } : str(props.relation) ? { relation: str(props.relation) } : {}), ...(asDay(props.born) ? { born: asDay(props.born) } : {}), ...(str(props.school) ? { school: str(props.school) } : {}), colour };
}

const q = (s: string) => (/^[\w .,'-]+$/.test(s) && !/^\s|\s$/.test(s) && !/^(true|false|yes|no|null)$/i.test(s) ? s : JSON.stringify(s));

/** A new family member's card. */
export function memberText(m: { name: string; relation?: string; born?: string; school?: string; colour?: string }): string {
  const front = ['---', 'type: person', `family: ${q(m.relation?.trim() || 'true')}`];
  if (m.born && DAYRE.test(m.born)) front.push(`born: ${m.born}`);
  if (m.school?.trim()) front.push(`school: ${q(m.school.trim())}`);
  if (m.colour && MEMBER_COLOURS.includes(m.colour as MemberColour)) front.push(`colour: ${m.colour}`);
  front.push('sensitivity: family', '---');
  return [...front, `# ${m.name.trim()}`, '', '## About', '', '## Documents', '', ''].join('\n');
}

/** Age in years on a day (from born, YYYY-MM-DD). */
export function ageOn(born: string | undefined, today = todayIso()): number | null {
  if (!born || !DAYRE.test(born)) return null;
  const [y, m, d] = born.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let a = ty - y;
  if (tm < m || (tm === m && td < d)) a--;
  return a >= 0 && a < 130 ? a : null;
}

/** The next birthday on or after a day, and the age then. */
export function nextBirthday(born: string | undefined, today = todayIso()): { day: string; age: number; in: number } | null {
  if (!born || !DAYRE.test(born)) return null;
  const [y, m, d] = born.split('-').map(Number);
  const ty = Number(today.slice(0, 4));
  const leap = (yy: number) => yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0);
  for (const yy of [ty, ty + 1]) {
    const day = `${yy}-${String(m).padStart(2, '0')}-${String(Math.min(d, m === 2 && !leap(yy) ? 28 : d)).padStart(2, '0')}`;
    if (day >= today) return { day, age: yy - y, in: daysBetween(today, day) };
  }
  return null;
}

// ── The family calendar ──────────────────────────────────────────────────────────────────────────────────────────────

export function calendarText(): string {
  return ['---', 'type: family-calendar', 'sensitivity: family', '---', '# Family calendar', '', 'Who’s where each week, the days that are different, and the moments worth keeping.', '', '## Activities', '', `| ${ACTIVITY_HEAD.join(' | ')} |`, `| ${ACTIVITY_HEAD.map(() => '---').join(' | ')} |`, '', '## Events', '', `| ${EVENT_HEAD.join(' | ')} |`, `| ${EVENT_HEAD.map(() => '---').join(' | ')} |`, '', '## Milestones', '', `| ${MILESTONE_HEAD.join(' | ')} |`, `| ${MILESTONE_HEAD.map(() => '---').join(' | ')} |`, ''].join('\n');
}

export interface Activity {
  row: number;
  who: string[];
  what: string;
  /** The weekdays it is on (0 Sunday … 6 Saturday). */
  days: number[];
  dayWords: string;
  time?: string;
  where?: string;
  until?: string;
}
export interface FamilyEvent {
  row: number;
  date: string;
  time?: string;
  who: string[];
  what: string;
  where?: string;
}
export interface Milestone {
  row: number;
  date: string;
  who: string[];
  what: string;
}
export interface Calendar {
  activities: Activity[];
  events: FamilyEvent[];
  milestones: Milestone[];
}

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** "Mon", "Monday", "Mon, Wed", "Mon–Fri", "weekdays", "weekends", "daily", "every day" → weekdays. */
export function readDays(words: string): number[] {
  const t = norm(words).replace(/\band\b/g, ',').replace(/&/g, ',');
  if (!t) return [];
  if (/^(daily|every ?day|each day)$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^weekdays?$/.test(t) || /school ?days/.test(t)) return [1, 2, 3, 4, 5];
  if (/^weekends?$/.test(t)) return [0, 6];
  const out = new Set<number>();
  for (const part of t.split(/[,/;]+/).map((x) => x.trim()).filter(Boolean)) {
    const range = /^([a-z]{3})[a-z]*\s*(?:-|–|to)\s*([a-z]{3})[a-z]*$/.exec(part);
    if (range) {
      const a = WD.indexOf(range[1]);
      const b = WD.indexOf(range[2]);
      if (a >= 0 && b >= 0) for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
      continue;
    }
    for (const w of part.split(/\s+/)) {
      const i = WD.indexOf(w.slice(0, 3));
      if (i >= 0) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** "9:30", "9.30am", "3:15 pm", "15:15", "3pm" → "HH:MM", else undefined. */
export function readTime(words: string): string | undefined {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(String(words ?? '').trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "2026-10-24", "24 Oct 2026", "Sat 24 Oct 2026", "24/10/2026", "next Friday" → YYYY-MM-DD, else undefined. */
export function readDate(words: string, today = todayIso()): string | undefined {
  const t = String(words ?? '').trim().toLowerCase().replace(/^[a-z]{3,9},?\s+(?=\d)/, '');
  if (DAYRE.test(t)) return t;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const words2 = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/.exec(t);
  if (words2) {
    const mi = MONTHS.indexOf(words2[2]);
    if (mi < 0) return undefined;
    let y = words2[3] ? Number(words2[3]) : Number(today.slice(0, 4));
    const iso = `${y}-${String(mi + 1).padStart(2, '0')}-${words2[1].padStart(2, '0')}`;
    if (!words2[3] && iso < addDays(today, -60)) y++;
    return `${y}-${String(mi + 1).padStart(2, '0')}-${words2[1].padStart(2, '0')}`;
  }
  // A relative day ("next Friday", "tomorrow") reads from the calendar's day, so the row stays.
  const [y, m, d] = today.split('-').map(Number);
  const rel = readDay(t, new Date(y, m - 1, d));
  return rel ? isoDay(rel) : undefined;
}

const whoOf = (cell: string) =>
  cell
    .split(/\s*(?:,|&|\band\b|\+)\s*/i)
    .map((x) => x.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim())
    .filter((x) => x && !/^[—–-]$/.test(x));
const cellAt = (t: Table, row: string[], name: string) => {
  const i = t.head.findIndex((h) => norm(h) === norm(name));
  const v = i >= 0 ? (row[i] ?? '').trim() : '';
  return /^[—–-]$/.test(v) ? '' : v;
};
const tableIn = (text: string, heading: CalendarSection): Table | null => {
  const s = findSection(text, heading);
  return s ? readTable(s.body) : null;
};

export function readCalendar(text: string, today = todayIso()): Calendar {
  const at = tableIn(text, 'Activities');
  const et = tableIn(text, 'Events');
  const mt = tableIn(text, 'Milestones');
  const activities: Activity[] = (at?.rows ?? []).map((r, row) => {
    const dayWords = cellAt(at!, r, 'Day');
    const until = readDate(cellAt(at!, r, 'Until'), today);
    const time = readTime(cellAt(at!, r, 'Time'));
    const where = cellAt(at!, r, 'Where');
    return { row, who: whoOf(cellAt(at!, r, 'Who')), what: cellAt(at!, r, 'What'), days: readDays(dayWords), dayWords, ...(time ? { time } : {}), ...(where ? { where } : {}), ...(until ? { until } : {}) };
  });
  const events: FamilyEvent[] = (et?.rows ?? [])
    .map((r, row) => {
      const date = readDate(cellAt(et!, r, 'Date'), today);
      const time = readTime(cellAt(et!, r, 'Time'));
      const where = cellAt(et!, r, 'Where');
      return date ? { row, date, who: whoOf(cellAt(et!, r, 'Who')), what: cellAt(et!, r, 'What'), ...(time ? { time } : {}), ...(where ? { where } : {}) } : null;
    })
    .filter((e): e is FamilyEvent => !!e);
  const milestones: Milestone[] = (mt?.rows ?? [])
    .map((r, row) => {
      const date = readDate(cellAt(mt!, r, 'Date'), today);
      return date ? { row, date, who: whoOf(cellAt(mt!, r, 'Who')), what: cellAt(mt!, r, 'Milestone') } : null;
    })
    .filter((m): m is Milestone => !!m);
  return { activities, events, milestones };
}

/** The calendar note with a row added to one of its tables (in the table's own columns). */
export function addCalendarRow(text: string, section: CalendarSection, values: Record<string, string>): string {
  return withSection(text, section, (body) => addTableRow(body, SECTION_HEAD[section], values));
}

/** The calendar note with one row of a table changed (by the table's own column names). */
export function setCalendarRow(text: string, section: CalendarSection, row: number, values: Record<string, string>): string {
  return withSection(text, section, (body) => {
    const t = readTable(body);
    if (!t) return body;
    const cells: Record<number, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const i = t.head.findIndex((h) => norm(h) === norm(k));
      if (i >= 0) cells[i] = v;
    }
    return setTableCells(body, row, cells);
  });
}

export function removeCalendarRow(text: string, section: CalendarSection, row: number): string {
  return withSection(text, section, (body) => removeTableRow(body, row));
}

// ── Who's where ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Happening {
  kind: 'activity' | 'event' | 'birthday' | 'appointment';
  day: string;
  time?: string;
  who: string[];
  what: string;
  where?: string;
  /** The row it came from (to change it), for activities and events. */
  row?: number;
}

/** Everything on one day: that weekday's activities (until their end), that day's events and birthdays, by time. */
export function dayOf(cal: Calendar, members: Member[], day: string): Happening[] {
  const w = weekdayOf(day);
  const out: Happening[] = [];
  for (const a of cal.activities) if (a.days.includes(w) && (!a.until || day <= a.until)) out.push({ kind: 'activity', day, ...(a.time ? { time: a.time } : {}), who: a.who, what: a.what, ...(a.where ? { where: a.where } : {}), row: a.row });
  for (const e of cal.events) if (e.date === day) out.push({ kind: 'event', day, ...(e.time ? { time: e.time } : {}), who: e.who, what: e.what, ...(e.where ? { where: e.where } : {}), row: e.row });
  for (const m of members) {
    const b = nextBirthday(m.born, day);
    if (b && b.day === day) out.push({ kind: 'birthday', day, who: [m.name], what: `${m.name}’s birthday (${b.age})` });
  }
  return out.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.what.localeCompare(b.what));
}

/** The days from one day on, each with what is on (for the week's view and the agent's answer). */
export function daysFrom(cal: Calendar, members: Member[], from: string, days: number): { day: string; items: Happening[] }[] {
  return Array.from({ length: Math.max(1, Math.min(62, days)) }, (_, i) => {
    const day = addDays(from, i);
    return { day, items: dayOf(cal, members, day) };
  });
}

/** One person's day: their own items and the ones for everyone (no name, or "everyone"/"everybody"/"family"/"all"/"kids"). */
export const forPerson = (items: Happening[], name: string) => items.filter((h) => !h.who.length || h.who.some((w) => norm(w) === norm(name) || /^(everyone|everybody|family|all|us|kids|children)$/i.test(w)));

// ── Reward trackers ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Reward {
  path: string;
  title: string;
  who: string;
  /** The yes/no it counts ("Reading", "Teeth brushed"). */
  habit: string;
  /** Day counts with a reward ("7": "Movie night"). */
  rewards: { at: number; reward: string; claimed: boolean }[];
  streak: Streak;
  /** A reward earned in the current run and not yet given. */
  earned?: { at: number; reward: string };
}

const listNums = (v: unknown): number[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/[[\]]/g, '').split(',') : []).map((x) => Number(String(x).trim())).filter((x) => Number.isInteger(x) && x > 0);

export function readReward(path: string, title: string, props: Record<string, unknown>, text: string, today = todayIso()): Reward {
  const log = parseLog(text);
  const habit = str(props.streak_label) || log.fields[0] || log.declared?.[0] || 'Done';
  const answers = new Map<string, boolean>();
  for (const e of log.entries)
    for (const [k, v] of Object.entries(e.values))
      if (norm(k) === norm(habit) && v.kind === 'yes') answers.set(e.date, v.yes);
  const map = props.rewards && typeof props.rewards === 'object' && !Array.isArray(props.rewards) ? (props.rewards as Record<string, unknown>) : {};
  const claimed = new Set(listNums(props.claimed));
  const ats = [...new Set([...listNums(props.milestones), ...Object.keys(map).map(Number).filter((x) => Number.isInteger(x) && x > 0)])].sort((a, b) => a - b);
  const rewards = ats.map((at) => ({ at, reward: str(map[String(at)]) || `Day ${at}`, claimed: claimed.has(at) }));
  const streak = streakOf(answers, today, ats.length ? ats : [7, 14, 30]);
  const earned = [...rewards].reverse().find((r) => r.at <= streak.current && !r.claimed);
  return { path, title, who: str(props.reward_for).replace(/^\[\[|\]\]$/g, ''), habit, rewards, streak, ...(earned ? { earned: { at: earned.at, reward: earned.reward } } : {}) };
}

/** A new reward tracker: a log with the one yes/no, its milestones and their rewards. */
export function rewardText(o: { who: string; habit: string; rewards: { at: number; reward: string }[]; title?: string }): string {
  const list = [...o.rewards].filter((r) => Number.isInteger(r.at) && r.at > 0).sort((a, b) => a.at - b.at);
  const front = ['---', 'type: log', `reward_for: ${q(o.who.trim())}`, `streak_label: ${q(o.habit.trim())}`, `fields: [${q(o.habit.trim())}]`, `milestones: [${list.map((r) => r.at).join(', ')}]`];
  if (list.length) front.push(`rewards: {${list.map((r) => `${r.at}: ${JSON.stringify(r.reward.trim() || `Day ${r.at}`)}`).join(', ')}}`);
  front.push('claimed: []', 'sensitivity: family', '---');
  return [...front, `# ${o.title?.trim() || `${o.who.trim()}: ${o.habit.trim()}`}`, '', `One line a day: \`- ${o.habit.trim()}: Y\` or \`- ${o.habit.trim()}: N\`.`, ''].join('\n');
}

/** The tracker with a day answered yes or no (or not answered: null), in the log's own format. */
export function markReward(text: string, habit: string, day: string, yes: boolean | null): string {
  const [y, m, d] = day.split('-').map(Number);
  const ref = new Date(y, m - 1, d);
  if (yes === null) return setLogValue(text, day, habit, null, ref);
  const had = parseLog(text, ref).entries.some((e) => e.date === day);
  return had ? setLogValue(text, day, habit, yes ? 'Y' : 'N', ref) : appendLogEntry(text, { date: ref, values: { [habit]: yes } }, ref);
}

/** The tracker with a reward marked given (its day count added to `claimed:`), every other line kept. */
export function claimReward(text: string, at: number): string {
  const src = String(text ?? '');
  const m = /^(---\r?\n[\s\S]*?\r?\n)---/.exec(src);
  if (!m) return src;
  const front = m[1];
  const line = /^claimed:[ \t]*(.*)$/m.exec(front);
  const now = new Set(line ? listNums(line[1]) : []);
  now.add(at);
  const words = `claimed: [${[...now].sort((a, b) => a - b).join(', ')}]`;
  const next = line ? front.replace(line[0], words) : `${front}${words}\n`;
  return next + src.slice(front.length);
}

// ── Albums ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Album {
  folder: string;
  name: string;
  photos: string[];
  cover?: string;
}

/** A photo, by the one shared picture list (scans and drawings count too). */
const isPhoto = (f: string) => {
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(f)?.[1] ?? '').toLowerCase();
  return IMAGE_EXT.test(ext) || SVG_EXT.test(ext);
};
/** The albums under the Family area's Assets folder: each folder of photos (and the loose photos as one album). */
export function albumsOf(files: string[], familyFolder: string, folders: string[] = []): Album[] {
  const base = `${familyFolder}/${ALBUMS_FOLDER}/`;
  const by = new Map<string, string[]>();
  // An album made and not filled yet is still an album.
  for (const f of folders) if (f.startsWith(base) && !f.slice(base.length).includes('/')) by.set(f, []);
  for (const f of files) {
    if (!f.startsWith(base) || !isPhoto(f)) continue;
    const rest = f.slice(base.length);
    const folder = rest.includes('/') ? base + rest.split('/')[0] : base.slice(0, -1);
    by.set(folder, [...(by.get(folder) ?? []), f]);
  }
  return [...by.entries()].map(([folder, photos]) => ({ folder, name: folder === base.slice(0, -1) ? 'Photos' : folder.split('/').pop()!, photos: photos.sort(), ...(photos.length ? { cover: photos[0] } : {}) })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Words for assistants ─────────────────────────────────────────────────────────────────────────────────────────────

export function happeningWords(h: Happening): string {
  const time = h.time ? `${Number(h.time.slice(0, 2)) % 12 || 12}:${h.time.slice(3)} ${Number(h.time.slice(0, 2)) < 12 ? 'am' : 'pm'}` : '';
  return [time, h.what, h.who.length && h.kind !== 'birthday' ? `(${h.who.join(', ')})` : '', h.where ? `at ${h.where}` : ''].filter(Boolean).join(' ');
}

export const FAMILY_RULES =
  'Family records (members, the family calendar, milestones, reward trackers) are notes in the Family area, marked Family-private. Use the family tools for them; a family photo is never used without the person’s OK each time.';

export { addDays, todayIso };
