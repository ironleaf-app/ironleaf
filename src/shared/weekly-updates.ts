// Weekly Updates (Wave 6 part b, 24 Oct 2026; the spec, section 5.1 of the plan, 21 Oct): "A first-class area for weekly
// status updates, the way Projects is for projects. Each week is one update record, made of sections that are handled
// properly rather than free text."
//
// One note a week, plain Markdown the person owns (Work/Weekly Updates/Weekly update 2026-10-19.md):
//
//   ---
//   type: weekly-update
//   week: 2026-10-19            the Monday it starts
//   audience: Sam Lee           who it goes to
//   status: Draft               Draft or Sent
//   sent: 2026-10-22            the day it was sent, and by whom
//   sent_by: Alex Example
//   ---
//   # Week of 19 October 2026
//   Any words before the first workstream (where the figures came from…), kept as written.
//
//   ## Store relocation                       one section per workstream, in the order they are sent
//   Project: [[Harbour Store Relocation]]      the linked project (its health and due date show beside it)
//   Flag: On track                             On track, At risk, Blocked or Done
//   Status: Onsite Thursday, hardware in store. a short status line
//
//   ### Progress                               what moved this week
//   - Hardware delivered
//   ### Next steps
//   - Install on Thursday
//   ### Blockers / Risks                       "None" is allowed
//   None
//   ### Metrics                                stored as numbers, never text
//   | Measure | Value | Unit | Group |
//   | --- | --- | --- | --- |
//   | Devices in scope | 1047 |  |  |
//   | Upgraded | 96.4 | % |  |
//   | China | 12 |  | Outstanding by country |
//   ### Notes                                  anything else written there, kept
//
//   ## Attachments                             files sent with it (cards on the page)
//   - [[Files/status.xlsx|status.xlsx]] — the status workbook
//
// Also here: an older long note of weekly updates read into one record a week, losslessly (importWeeklyNote); "start
// next week from last week" (startFrom); each workstream's history week by week with its metrics as trends; the update
// as plain text (the format sent today), as a Word document and as a page to print to PDF; the agent tools. Pure: no
// files, no Node, no DOM.

import { frontMatterRange, readProps } from './frontmatter';
import type { WorkToolDef } from './work-module-tools';
import { linkName, str, yamlWords } from './work-text';

export const FLAGS = ['On track', 'At risk', 'Blocked', 'Done'] as const;
export type Flag = (typeof FLAGS)[number];

export interface Metric {
  name: string;
  /** The number (null: not filled in yet this week). */
  value: number | null;
  /** "%", "$", "GB", or nothing. */
  unit: string;
  /** Measures that belong together ("Outstanding by country"): sent as one line, "Outstanding by country: China 12, …". */
  group: string;
}

export interface Workstream {
  name: string;
  /** The linked project's name as written in its link ("[[Name]]" → Name), or ''. */
  project: string;
  flag: Flag | '';
  status: string;
  progress: string[];
  next: string[];
  /** The blockers or risks, a line each; `none` when "None" is said (its words kept: "None currently"). */
  blockers: string[];
  none: boolean;
  noneWords: string;
  metrics: Metric[];
  /** Anything else written in the section, kept word for word. */
  notes: string;
}

export interface Attachment {
  /** The link's target (a file in the vault), or '' when only named. */
  link: string;
  name: string;
  what: string;
}

export interface WeeklyUpdate {
  path: string;
  /** The Monday it starts (YYYY-MM-DD). */
  week: string;
  audience: string;
  status: 'Draft' | 'Sent';
  sent: string;
  sentBy: string;
  /** The day it was prepared, when it says (an imported week's "(prepared Wed 21 Oct)"). */
  prepared: string;
  intro: string;
  sections: Workstream[];
  attachments: Attachment[];
}

// ── Days ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = MONTHS_LONG.map((m) => m.slice(0, 3));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const addDaysIso = (iso: string, n: number) => {
  const d = dateOf(iso);
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** The Monday of the week a day is in. */
export function mondayOf(iso: string): string {
  const d = dateOf(iso);
  const back = (d.getDay() + 6) % 7;
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}
/** "19 October 2026". */
export const longDay = (iso: string) => {
  const d = dateOf(iso);
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};
/** "Mon 19 Oct" (the year added when it isn't `thisYear`'s). */
export const shortDay = (iso: string, thisYear?: number) => {
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${thisYear !== undefined && d.getFullYear() !== thisYear ? ` ${d.getFullYear()}` : ''}`;
};
/** "Week of 19 October 2026". */
export const weekTitle = (week: string) => `Week of ${longDay(week)}`;
/** "w/c 19 Oct". */
export const weekShort = (week: string) => {
  const d = dateOf(week);
  return `w/c ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** A day read from words: "2026-10-19", "19 October 2026", "19 Oct 2026", "Mon 19 Oct" (with `year`). */
export function readDayWords(words: string, year?: number): string | null {
  const s = String(words ?? '').trim();
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  // A day that is not there ("2026-13-45") is no day, never passed on as a week or a sent day.
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return d.getFullYear() === Number(iso[1]) && d.getMonth() === Number(iso[2]) - 1 && d.getDate() === Number(iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?/.exec(s);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
  const y = m[3] ? Number(m[3]) : year;
  if (month < 0 || !y) return null;
  const d = new Date(y, month, Number(m[1]));
  return d.getMonth() === month ? isoOf(d) : null;
}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A metric's value read from what was written: "1,047" → 1047, "96.4%" → 96.4 and "%", "$12.5k" → 12500 and "$". */
export function readMetricValue(words: string): { value: number | null; unit: string } {
  const s = String(words ?? '').trim();
  const m = /^([$€£])?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?\.\d+)\s*(k|m|%|[A-Za-z]{1,6})?$/i.exec(s);
  if (!m) return { value: null, unit: '' };
  let value = Number(m[2].replace(/,/g, ''));
  let unit = m[1] ?? '';
  const tail = m[3] ?? '';
  if (/^k$/i.test(tail) && unit) value *= 1000;
  else if (/^m$/i.test(tail) && unit) value *= 1_000_000;
  else if (tail) unit = unit ? `${unit}${tail}` : tail;
  return Number.isFinite(value) ? { value, unit } : { value: null, unit: '' };
}

/** A metric as people read it: "1,047", "96.4%", "$1,200". */
export function metricWords(m: Pick<Metric, 'value' | 'unit'>): string {
  if (m.value === null) return '';
  const n = Math.abs(m.value) >= 1000 ? m.value.toLocaleString('en-AU', { maximumFractionDigits: 2 }) : String(Math.round(m.value * 100) / 100);
  if (!m.unit) return n;
  if (/^[$€£]$/.test(m.unit)) return `${m.value < 0 ? '-' : ''}${m.unit}${n.replace(/^-/, '')}`;
  return m.unit === '%' ? `${n}%` : `${n} ${m.unit}`;
}

// ── Reading and writing a week's note ────────────────────────────────────────────────────────────────────────────────

const SUB = {
  progress: /^(progress|done|done this week|this week|what moved|achieved|achievements|completed|updates?)$/i,
  next: /^(next steps?|next|coming up|coming up next week|to do|upcoming|planned)$/i,
  blockers: /^(blockers?\s*(?:\/|and|&)?\s*risks?|blockers?|risks?(?:\s*(?:\/|and|&)\s*issues?)?|issues?|blocked or at risk)$/i,
  metrics: /^(metrics?|numbers?|figures?|measures?|kpis?)$/i,
  notes: /^(notes?|other|more)$/i,
};
const FLAG_RE = /^(on track|at risk|blocked|done|complete(?:d)?|off track)\b/i;
/** The flag a status line starts with ("On track", "At risk…"), else ''. */
export function flagOf(words: string): Flag | '' {
  const m = FLAG_RE.exec(String(words ?? '').trim());
  if (!m) return '';
  const w = m[1].toLowerCase();
  return w === 'on track' ? 'On track' : w === 'at risk' || w === 'off track' ? 'At risk' : w === 'blocked' ? 'Blocked' : 'Done';
}
const readFlag = (s: string): Flag | '' => FLAGS.find((f) => f.toLowerCase() === s.trim().toLowerCase()) ?? flagOf(s);
const isNone = (s: string) => /^(none|nil|n\/a|nothing|no blockers?|no risks?)\b/i.test(s.trim());

const emptyStream = (name: string): Workstream => ({ name, project: '', flag: '', status: '', progress: [], next: [], blockers: [], none: false, noneWords: '', metrics: [], notes: '' });

const KEY_LINE = /^\s*(?:\*\*)?(project|flag|status|blockers?\s*\/\s*risks?|blockers?|risks?)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*?)\s*$/i;
const BULLET = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isRule = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

/** A table's rows as measures: "| Measure | Count |", "| Measure | Value | Unit | Group |", or any two-column table whose
 *  second column holds numbers. Rows that aren't numbers are given back as words. */
function readMetricTable(rows: string[]): { metrics: Metric[]; words: string[] } {
  const metrics: Metric[] = [];
  const words: string[] = [];
  const body = rows.filter((r) => !isRule(r));
  if (!body.length) return { metrics, words };
  const head = cells(body[0]).map((h) => h.toLowerCase());
  const looksHead = head.some((h) => /^(measure|metric|name|item|what)$/.test(h)) || head.slice(1).some((h) => /^(value|count|number|total|this week|now|figure)$/.test(h));
  const start = looksHead ? 1 : 0;
  const col = (re: RegExp, fallback: number) => {
    const i = head.findIndex((h) => re.test(h));
    return looksHead && i >= 0 ? i : fallback;
  };
  const valueCol = col(/^(value|count|number|total|this week|now|figure)$/, 1);
  const unitCol = looksHead ? head.findIndex((h) => /^unit/.test(h)) : -1;
  const groupCol = looksHead ? head.findIndex((h) => /^group/.test(h)) : -1;
  for (const r of body.slice(start)) {
    const c = cells(r);
    const name = c[0] ?? '';
    if (!name) continue;
    const raw = c[valueCol] ?? '';
    const read = readMetricValue(raw);
    if (raw.trim() && read.value === null) {
      words.push(`${name}: ${raw}`);
      continue;
    }
    metrics.push({ name, value: read.value, unit: unitCol >= 0 && c[unitCol] ? c[unitCol] : read.unit, group: groupCol >= 0 ? (c[groupCol] ?? '') : '' });
  }
  return { metrics, words };
}

/** "Outstanding by country: China 12, Australia 9, (blank) 4." → the group's measures (null: not such a line). */
export function readGroupLine(line: string): Metric[] | null {
  const m = /^\s*([^:|#>*\-][^:]{1,80}?)\s*:\s*(.+?)\.?\s*$/.exec(line);
  if (!m) return null;
  const parts = m[2].split(/\s*,\s*/);
  if (parts.length < 2) return null;
  const out: Metric[] = [];
  for (const p of parts) {
    const x = /^(.+?)\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?)$/.exec(p.trim());
    if (!x) return null;
    const v = readMetricValue(x[2]);
    if (v.value === null) return null;
    out.push({ name: x[1].trim(), value: v.value, unit: v.unit, group: m[1].trim() });
  }
  return out;
}

/** One workstream's lines (under its heading) read into its parts. Anything not understood is kept in its notes. */
function readStream(name: string, lines: string[]): Workstream {
  const w = emptyStream(name);
  const notes: string[] = [];
  let sub: keyof typeof SUB | 'top' | 'other' = 'top';
  let table: string[] = [];
  let lastList: string[] | null = null;
  const flushTable = () => {
    if (!table.length) return;
    const t = readMetricTable(table);
    w.metrics.push(...t.metrics);
    if (t.words.length) notes.push(...t.words);
    else if (!t.metrics.length) notes.push(...table);
    table = [];
  };
  const blocker = (s: string) => {
    if (!s.trim()) return;
    if (!w.blockers.length && !w.none && isNone(s)) {
      w.none = true;
      w.noneWords = s.trim();
      return;
    }
    w.blockers.push(s.trim());
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (TABLE_ROW.test(line) && (sub === 'metrics' || sub === 'top' || sub === 'progress')) {
      table.push(line);
      continue;
    }
    flushTable();
    const h = /^#{3,6}\s+(.*?)\s*#*$/.exec(line);
    if (h) {
      const t = h[1].replace(/:$/, '').trim();
      sub = (Object.keys(SUB) as (keyof typeof SUB)[]).find((k) => SUB[k].test(t)) ?? 'other';
      if (sub === 'other') notes.push(line);
      lastList = null;
      continue;
    }
    if (!line.trim()) {
      if (sub === 'notes' || sub === 'other') notes.push('');
      continue;
    }
    if (sub === 'top' || sub === 'progress' || sub === 'next') {
      const k = KEY_LINE.exec(line);
      if (k && sub === 'top') {
        const key = k[1].toLowerCase();
        if (key === 'project') w.project = linkName(k[2]);
        else if (key === 'flag') w.flag = readFlag(k[2]);
        else if (key === 'status') {
          w.status = k[2];
          if (!w.flag) w.flag = flagOf(k[2]);
        } else blocker(k[2]);
        continue;
      }
      if (k && /^(blockers?|risks?)/i.test(k[1])) {
        blocker(k[2]);
        sub = 'blockers';
        continue;
      }
    }
    if (sub === 'blockers') {
      const b = BULLET.exec(line);
      const k = KEY_LINE.exec(line);
      blocker(b ? b[1] : k && /^(blockers?|risks?)/i.test(k[1]) ? k[2] : line.trim());
      continue;
    }
    if (sub === 'metrics') {
      const g = readGroupLine(line);
      if (g) {
        w.metrics.push(...g);
        continue;
      }
      notes.push(line);
      continue;
    }
    if (sub === 'notes' || sub === 'other') {
      notes.push(line);
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      const list = sub === 'next' ? w.next : w.progress;
      list.push(b[1].trim());
      lastList = list;
      continue;
    }
    // An indented line under a bullet goes with it.
    if (/^\s{2,}\S/.test(raw) && lastList?.length) {
      lastList[lastList.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const g = readGroupLine(line);
    if (g) {
      w.metrics.push(...g);
      continue;
    }
    notes.push(line);
  }
  flushTable();
  w.notes = notes.join('\n').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
  return w;
}

/** The attachments section's lines: list items and link lines, each file once ("name — what it is"). */
function readAttachments(lines: string[]): Attachment[] {
  const out: Attachment[] = [];
  const byName = (name: string) => out.find((a) => a.name.toLowerCase() === name.toLowerCase());
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*+]\s+/, '');
    if (!line) continue;
    const link = /!?\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/.exec(line) ?? null;
    const md = !link ? /\[([^\]]+)\]\(<?([^)>]+)>?\)/.exec(line) : null;
    const target = link ? link[1].trim() : md ? decodeURI(md[2].trim()) : '';
    const name = link ? (link[2] ?? link[1].split('/').pop()!).trim() : md ? md[1].trim() : line.split(/\s+[—–-]\s+/)[0].trim();
    const what = (link || md ? line.slice((link ?? md)!.index + (link ?? md)![0].length) : line.slice(name.length)).replace(/^\s*[—–:-]\s*/, '').trim();
    const had = byName(name);
    if (had) {
      if (!had.link && target) had.link = target;
      if (!had.what && what) had.what = what;
      continue;
    }
    out.push({ link: target, name, what });
  }
  return out;
}

const ATTACHMENTS = /^(attachments?|files?|attached|sent with it)$/i;

/** A week's note read (any hand edits forgiven: what isn't understood is kept in a section's notes or the intro). */
export function readWeekly(path: string, text: string): WeeklyUpdate {
  const props = readProps(text) as Record<string, unknown>;
  const range = frontMatterRange(text);
  const body = (range ? text.slice(range.to) : text).replace(/^﻿/, '');
  const lines = body.split(/\r?\n/);
  const intro: string[] = [];
  const sections: Workstream[] = [];
  let attachments: Attachment[] = [];
  let current: { name: string; lines: string[]; attach: boolean } | null = null;
  const close = () => {
    if (!current) return;
    if (current.attach) attachments = [...attachments, ...readAttachments(current.lines)];
    else sections.push(readStream(current.name, current.lines));
    current = null;
  };
  let titleFromH1 = '';
  for (const line of lines) {
    const h2 = /^##\s+(.*?)\s*#*$/.exec(line);
    if (h2 && !/^###/.test(line)) {
      close();
      const name = h2[1].replace(/^\d+[.)]\s+/, '').trim();
      current = { name, lines: [], attach: ATTACHMENTS.test(name) };
      continue;
    }
    const h1 = /^#\s+(.*?)\s*#*$/.exec(line);
    if (h1 && !current && !titleFromH1) {
      titleFromH1 = h1[1];
      continue;
    }
    if (current) (current as { lines: string[] }).lines.push(line);
    else intro.push(line);
  }
  close();
  const weekProp = readDayWords(str(props.week)) ?? readDayWords(titleFromH1) ?? readDayWords(path.split('/').pop() ?? '') ?? '';
  return {
    path,
    week: weekProp ? mondayOf(weekProp) : '',
    audience: linkName(str(props.audience ?? props.to)),
    status: /^sent$/i.test(str(props.status)) ? 'Sent' : 'Draft',
    sent: readDayWords(str(props.sent)) ?? '',
    sentBy: linkName(str(props.sent_by ?? props.sentby ?? props['sent by'])),
    prepared: readDayWords(str(props.prepared)) ?? '',
    intro: intro.join('\n').replace(/^\n+|\n+$/g, ''),
    sections,
    attachments,
  };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

/** The value cell as written: the number with no thousands commas, so it reads back the same. */
const valueCell = (v: number | null) => (v === null ? '' : String(Math.round(v * 1e6) / 1e6));

/** One workstream as its note writes it. */
function streamText(w: Workstream): string {
  const out: string[] = [`## ${w.name.replace(/\n/g, ' ').trim() || 'Workstream'}`];
  if (w.project) out.push(`Project: [[${w.project}]]`);
  if (w.flag) out.push(`Flag: ${w.flag}`);
  out.push(`Status: ${w.status.replace(/\n/g, ' ').trim()}`);
  out.push('', '### Progress', ...(w.progress.length ? w.progress.map((p) => `- ${p}`) : []));
  out.push('', '### Next steps', ...(w.next.length ? w.next.map((p) => `- ${p}`) : []));
  out.push('', '### Blockers / Risks', ...(w.none ? [w.noneWords || 'None'] : w.blockers.map((b) => `- ${b}`)));
  if (w.metrics.length) {
    out.push('', '### Metrics', '| Measure | Value | Unit | Group |', '| --- | --- | --- | --- |', ...w.metrics.map((m) => `| ${cell(m.name)} | ${valueCell(m.value)} | ${cell(m.unit)} | ${cell(m.group)} |`));
  }
  if (w.notes.trim()) out.push('', '### Notes', w.notes.replace(/^\n+|\n+$/g, ''));
  return out.join('\n');
}

/** A week's note's words: its properties (any of the person's own kept as written in `previous`) and its sections. */
export function writeWeekly(u: WeeklyUpdate, previous = ''): string {
  const own: string[] = [];
  const range = previous ? frontMatterRange(previous) : null;
  if (range) {
    // The person's own properties stay as they wrote them (a tag, a link…); ours are written fresh below.
    const ours = /^(type|week|audience|status|sent|sent_by|prepared)\s*:/i;
    const lines = previous.slice(0, range.to).split(/\r?\n/).slice(1);
    let keep = false;
    for (const l of lines) {
      if (/^(---|\.\.\.)\s*$/.test(l)) break;
      if (/^\S/.test(l)) keep = !ours.test(l);
      if (keep) own.push(l);
    }
  }
  const front = [
    'type: weekly-update',
    `week: ${u.week}`,
    `audience: ${yamlWords(u.audience)}`,
    `status: ${u.status}`,
    `sent: ${u.sent}`,
    `sent_by: ${yamlWords(u.sentBy)}`,
    ...(u.prepared ? [`prepared: ${u.prepared}`] : []),
    ...own,
  ].map((l) => l.replace(/: ""$/, ':').trimEnd());
  const body: string[] = [`# ${weekTitle(u.week)}`];
  if (u.intro.trim()) body.push('', u.intro.replace(/^\n+|\n+$/g, ''));
  for (const w of u.sections) body.push('', streamText(w));
  if (u.attachments.length) {
    body.push('', '## Attachments', ...u.attachments.map((a) => `- ${a.link ? `[[${a.link}|${a.name}]]` : a.name}${a.what ? ` — ${a.what}` : ''}`));
  }
  return `---\n${front.join('\n')}\n---\n${body.join('\n')}\n`;
}

/** A new week's note: blank, or started from an earlier week (startFrom). */
export function newWeekly(week: string, from?: WeeklyUpdate | null, defaults: { audience?: string } = {}): WeeklyUpdate {
  const base: WeeklyUpdate = { path: '', week: mondayOf(week), audience: from?.audience || defaults.audience || '', status: 'Draft', sent: '', sentBy: '', prepared: '', intro: '', sections: [], attachments: [] };
  if (!from) return base;
  return { ...base, sections: startFrom(from) };
}

/**
 * Start next week from last week (the spec: "'New update' copies the previous week's workstreams and last status, so only
 * the changes are typed"): each workstream with its project, flag, status line, next steps, blockers and its measures
 * (their names, units and groups; the numbers are this week's to fill, last week's shown beside them). Progress starts
 * empty: it is what moves this week. A workstream marked Done last week isn't carried on.
 */
export function startFrom(last: WeeklyUpdate): Workstream[] {
  return last.sections
    .filter((w) => w.flag !== 'Done')
    .map((w) => ({ ...w, progress: [], next: [...w.next], blockers: [...w.blockers], metrics: w.metrics.map((m) => ({ ...m, value: null })) }));
}

/** The note's file name for a week ("Weekly update 2026-10-19": plain in search and in a project's files, and in date
 *  order in its folder). */
export const weeklyFileName = (week: string) => `Weekly update ${mondayOf(week)}`;

// ── Changes made on the page ─────────────────────────────────────────────────────────────────────────────────────────

export type WeeklyList = 'progress' | 'next' | 'blockers';
export type WeeklyEdit =
  | { kind: 'header'; field: 'audience' | 'status' | 'sent' | 'sentBy' | 'intro'; value: string }
  | { kind: 'add-section'; name: string; project?: string; at?: number }
  | { kind: 'remove-section'; section: number }
  | { kind: 'move-section'; section: number; to: number }
  | { kind: 'section'; section: number; field: 'name' | 'project' | 'flag' | 'status' | 'notes'; value: string }
  | { kind: 'none'; section: number; none: boolean }
  | { kind: 'add-item'; section: number; list: WeeklyList; text: string }
  | { kind: 'set-item'; section: number; list: WeeklyList; index: number; text: string }
  | { kind: 'remove-item'; section: number; list: WeeklyList; index: number }
  | { kind: 'move-item'; section: number; list: WeeklyList; index: number; to: number }
  | { kind: 'metric'; section: number; name: string; value: number | null; unit?: string; group?: string; index?: number; rename?: string }
  | { kind: 'remove-metric'; section: number; index: number }
  | { kind: 'add-attachment'; link: string; name: string; what?: string }
  | { kind: 'set-attachment'; index: number; what: string }
  | { kind: 'remove-attachment'; index: number };

const clip = (s: unknown, max = 600) => String(s ?? '').replace(/\r?\n/g, ' ').trim().slice(0, max);

/** One change applied (the update changed in place); its words for the toast, or throws in plain words. */
export function applyWeeklyEdit(u: WeeklyUpdate, e: WeeklyEdit): string {
  const sec = (i: number) => {
    const w = u.sections[i];
    if (!w) throw new Error('That workstream isn’t in this update any more.');
    return w;
  };
  switch (e.kind) {
    case 'header': {
      if (e.field === 'status') {
        u.status = /^sent$/i.test(e.value) ? 'Sent' : 'Draft';
        if (u.status === 'Draft') u.sent = '';
        return u.status === 'Sent' ? 'Marked sent.' : 'Back to draft.';
      }
      if (e.field === 'sent') {
        const d = e.value ? readDayWords(e.value) : '';
        if (e.value && !d) throw new Error('Give the day it was sent.');
        u.sent = d ?? '';
        return '';
      }
      if (e.field === 'intro') u.intro = String(e.value ?? '').slice(0, 4000);
      else if (e.field === 'audience') u.audience = clip(e.value, 120);
      else u.sentBy = clip(e.value, 120);
      return '';
    }
    case 'add-section': {
      const name = clip(e.name, 120);
      if (!name) throw new Error('A workstream needs a name.');
      if (u.sections.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is in this update already.`);
      const close = u.sections.find((w) => nearStreamKey(streamKey(w.name), streamKey(name)));
      if (close) throw new Error(`“${name}” is very close to the workstream “${close.name}”. Fix the spelling, or rename that workstream first.`);
      const w = { ...emptyStream(name), project: clip(e.project ?? '', 200) };
      const at = typeof e.at === 'number' ? Math.max(0, Math.min(u.sections.length, e.at)) : u.sections.length;
      u.sections.splice(at, 0, w);
      return `Added ${name}.`;
    }
    case 'remove-section': {
      const w = sec(e.section);
      u.sections.splice(e.section, 1);
      return `Took ${w.name} out of this week’s update.`;
    }
    case 'move-section': {
      const w = sec(e.section);
      const to = Math.max(0, Math.min(u.sections.length - 1, e.to));
      u.sections.splice(e.section, 1);
      u.sections.splice(to, 0, w);
      return '';
    }
    case 'section': {
      const w = sec(e.section);
      if (e.field === 'name') {
        const name = clip(e.value, 120);
        if (!name) throw new Error('A workstream needs a name.');
        const others = u.sections.filter((_, i) => i !== e.section);
        if (others.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is in this update already.`);
        const close = others.find((x) => nearStreamKey(streamKey(x.name), streamKey(name)));
        if (close) throw new Error(`“${name}” is very close to the workstream “${close.name}”. Fix the spelling, or rename that workstream first.`);
        w.name = name;
      } else if (e.field === 'flag') w.flag = readFlag(e.value);
      else if (e.field === 'project') w.project = linkName(clip(e.value, 200));
      else if (e.field === 'notes') w.notes = String(e.value ?? '').slice(0, 20000);
      else w.status = clip(e.value, 1000);
      return '';
    }
    case 'none': {
      const w = sec(e.section);
      w.none = e.none;
      if (e.none) w.noneWords = w.noneWords || 'None';
      return '';
    }
    case 'add-item': {
      const w = sec(e.section);
      const t = clip(e.text, 1000);
      if (!t) throw new Error('Write something first.');
      if (e.list === 'blockers') w.none = false;
      w[e.list].push(t);
      return '';
    }
    case 'set-item': {
      const w = sec(e.section);
      if (!w[e.list][e.index] && w[e.list][e.index] !== '') throw new Error('That line isn’t there any more.');
      const t = clip(e.text, 1000);
      if (!t) w[e.list].splice(e.index, 1);
      else w[e.list][e.index] = t;
      return '';
    }
    case 'remove-item': {
      const w = sec(e.section);
      w[e.list].splice(e.index, 1);
      return '';
    }
    case 'move-item': {
      const w = sec(e.section);
      const list = w[e.list];
      const [x] = list.splice(e.index, 1);
      if (x !== undefined) list.splice(Math.max(0, Math.min(list.length, e.to)), 0, x);
      return '';
    }
    case 'metric': {
      const w = sec(e.section);
      const name = clip(e.rename ?? e.name, 120);
      if (!name) throw new Error('A measure needs a name.');
      if (e.value !== null && !Number.isFinite(e.value)) throw new Error('A measure is a number, like 1047 or 96.4.');
      const i = typeof e.index === 'number' ? e.index : w.metrics.findIndex((m) => m.name.toLowerCase() === clip(e.name, 120).toLowerCase() && (e.group === undefined || m.group === e.group));
      if (i >= 0 && w.metrics[i]) {
        const m = w.metrics[i];
        w.metrics[i] = { name, value: e.value, unit: e.unit !== undefined ? clip(e.unit, 12) : m.unit, group: e.group !== undefined ? clip(e.group, 80) : m.group };
      } else w.metrics.push({ name, value: e.value, unit: clip(e.unit ?? '', 12), group: clip(e.group ?? '', 80) });
      return '';
    }
    case 'remove-metric': {
      sec(e.section).metrics.splice(e.index, 1);
      return '';
    }
    case 'add-attachment': {
      const name = clip(e.name, 200) || e.link.split('/').pop() || 'File';
      if (u.attachments.some((a) => (a.link && a.link === e.link) || a.name.toLowerCase() === name.toLowerCase())) return `${name} is attached already.`;
      u.attachments.push({ link: e.link, name, what: clip(e.what ?? '', 300) });
      return `Attached ${name}.`;
    }
    case 'set-attachment': {
      const a = u.attachments[e.index];
      if (!a) throw new Error('That file isn’t attached any more.');
      a.what = clip(e.what, 300);
      return '';
    }
    case 'remove-attachment': {
      const [a] = u.attachments.splice(e.index, 1);
      return a ? `Took ${a.name} off this update.` : '';
    }
  }
}

// ── The module's model ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ProjectInfo {
  path: string;
  name: string;
  health: string;
  status: string;
  due: string;
  progress: number | null;
  /** Its open next steps (to pull into a section's next steps). */
  next: string[];
  /** Its recent updates and open risks (to gather a first draft from; 30 Oct 2026). */
  updates?: string[];
  risks?: string[];
}

/** A first draft gathered from the projects (30 Oct 2026: modules should do the work, not ask the person to write it): each
linked project's recent updates become progress, its open next steps and risks are carried in, lines already there are not
repeated, and a project with something to say and no section yet gets one. Nothing is invented: only the projects' own
words move, and the person corrects the draft. */
export function gatheredSections(projects: readonly ProjectInfo[], base: readonly Workstream[]): { sections: Workstream[]; added: number; sectionsAdded: number } {
  const sections: Workstream[] = base.map((w) => ({ ...w, progress: [...w.progress], next: [...w.next], blockers: [...w.blockers], metrics: [...w.metrics] }));
  let added = 0;
  let sectionsAdded = 0;
  const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const p of projects) {
    const updates = (p.updates ?? []).filter(Boolean).slice(0, 10);
    const risks = (p.risks ?? []).filter(Boolean).slice(0, 10);
    if (!updates.length && !p.next.length && !risks.length) continue;
    let w = sections.find((s) => s.project && s.project.toLowerCase() === p.name.toLowerCase()) ?? sections.find((s) => streamKey(s.name) === streamKey(p.name));
    if (!w) {
      w = { ...emptyStream(p.name), project: p.name };
      sections.push(w);
      sectionsAdded++;
    }
    if (!w.project) w.project = p.name;
    for (const line of updates) if (!w.progress.some((x) => same(x, line))) { w.progress.push(line); added++; }
    for (const line of p.next.slice(0, 10)) if (!w.next.some((x) => same(x, line))) { w.next.push(line); added++; }
    for (const line of risks) if (!w.blockers.some((x) => same(x, line))) { w.blockers.push(line); added++; }
    if (risks.length) w.none = false;
  }
  return { sections, added, sectionsAdded };
}

export interface WeekPoint {
  week: string;
  path: string;
  flag: Flag | '';
  status: string;
  blockers: string[];
  none: boolean;
  noneWords: string;
  progress: string[];
  metrics: Metric[];
  project: string;
}
export interface MetricSeries {
  name: string;
  unit: string;
  group: string;
  points: { week: string; value: number }[];
}
export interface WorkstreamHistory {
  key: string;
  name: string;
  /** Names it went by in earlier weeks. */
  names: string[];
  project: string;
  weeks: WeekPoint[];
  metrics: MetricSeries[];
  last: WeekPoint;
}

export interface WeeklyModel {
  today: string;
  thisWeek: string;
  /** Newest first. */
  updates: WeeklyUpdate[];
  current: WeeklyUpdate | null;
  /** The latest week before this one (to start this week from). */
  last: WeeklyUpdate | null;
  /** This week's update: not started, a draft, or sent; due on its day (the module's setting). */
  due: { state: 'none' | 'draft' | 'sent'; dueDay: string; overdue: boolean; dueToday: boolean };
  workstreams: WorkstreamHistory[];
}

/** A workstream's key, the same across weeks for the same name ("2. LF 2027" and "LF 2027" are one). */
export const streamKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^\d+[.)]\s*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Two keys a typo apart ("harbour store", "harbor store"): long enough to mean it, two edits or fewer. */
function streamDistance(a: string, b: string): number {
  const prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = next;
    }
  }
  return prev[b.length];
}

const nearStreamKey = (a: string, b: string) => a !== b && Math.min(a.length, b.length) >= 6 && streamDistance(a, b) <= 2;

export function workstreamHistory(updates: readonly WeeklyUpdate[]): WorkstreamHistory[] {
  const map = new Map<string, WorkstreamHistory>();
  const oldestFirst = [...updates].filter((u) => u.week).sort((a, b) => a.week.localeCompare(b.week));
  for (const u of oldestFirst) {
    for (const w of u.sections) {
      // A renamed workstream keeps its history by its project: the same linked project is the same workstream.
      let key = streamKey(w.name);
      if (!map.has(key) && w.project) {
        const byProject = [...map.values()].find((h) => h.project && h.project.toLowerCase() === w.project.toLowerCase());
        if (byProject) key = byProject.key;
      }
      const point: WeekPoint = { week: u.week, path: u.path, flag: w.flag, status: w.status, blockers: w.blockers, none: w.none, noneWords: w.noneWords, progress: w.progress, metrics: w.metrics, project: w.project };
      const h = map.get(key);
      if (!h) {
        map.set(key, { key, name: w.name, names: [w.name], project: w.project, weeks: [point], metrics: [], last: point });
        continue;
      }
      h.weeks.push(point);
      h.last = point;
      if (!h.names.includes(w.name)) h.names.push(w.name);
      h.name = w.name;
      if (w.project) h.project = w.project;
    }
  }
  for (const h of map.values()) {
    const series = new Map<string, MetricSeries>();
    for (const p of h.weeks)
      for (const m of p.metrics) {
        const k = `${m.group.toLowerCase()}|${m.name.toLowerCase()}`;
        const s = series.get(k) ?? { name: m.name, unit: m.unit, group: m.group, points: [] };
        if (m.value !== null) s.points.push({ week: p.week, value: m.value });
        if (m.unit) s.unit = m.unit;
        series.set(k, s);
      }
    h.metrics = [...series.values()];
  }
  return [...map.values()].sort((a, b) => b.last.week.localeCompare(a.last.week) || a.name.localeCompare(b.name));
}

/** Every week's update, this week's, last week's, whether this week's is due, and each workstream's history. `dueDay` is
 *  the weekday it is sent (0 Monday … 6 Sunday; Thursday unless the module's settings say). */
export function weeklyModel(updates: readonly WeeklyUpdate[], today: Date = new Date(), dueDay = 3): WeeklyModel {
  const t = isoOf(today);
  const thisWeek = mondayOf(t);
  const sorted = [...updates].filter((u) => u.week).sort((a, b) => b.week.localeCompare(a.week) || a.path.localeCompare(b.path));
  const current = sorted.find((u) => u.week === thisWeek) ?? null;
  const last = sorted.find((u) => u.week < thisWeek) ?? null;
  const day = addDaysIso(thisWeek, Math.max(0, Math.min(6, Math.round(dueDay))));
  const state = !current ? 'none' : current.status === 'Sent' ? 'sent' : 'draft';
  return { today: t, thisWeek, updates: sorted, current, last, due: { state, dueDay: day, overdue: state !== 'sent' && t > day, dueToday: state !== 'sent' && t === day }, workstreams: workstreamHistory(sorted) };
}

// ── The update as it is sent ─────────────────────────────────────────────────────────────────────────────────────────

/** The measures of a section that aren't in a group, and each group's line ("Outstanding by country: China 12, …"). */
export function metricParts(w: Pick<Workstream, 'metrics'>): { table: Metric[]; groups: { group: string; metrics: Metric[] }[] } {
  const table = w.metrics.filter((m) => !m.group);
  const groups: { group: string; metrics: Metric[] }[] = [];
  for (const m of w.metrics.filter((x) => x.group)) {
    const g = groups.find((x) => x.group === m.group);
    if (g) g.metrics.push(m);
    else groups.push({ group: m.group, metrics: [m] });
  }
  return { table, groups };
}
export const groupLine = (g: { group: string; metrics: Metric[] }) => `${g.group}: ${g.metrics.filter((m) => m.value !== null).map((m) => `${m.name} ${metricWords(m)}`).join(', ')}.`;

/**
 * The update as plain text for email or Teams (the format sent today): the week, each workstream numbered with its
 * Status line, what moved as bullets, next steps, its measures (a table's rows as "Measure: value", a group as one line),
 * and "Blockers / Risks:", then the files attached.
 */
export function weeklyText(u: WeeklyUpdate, opts: { title?: boolean } = {}): string {
  const out: string[] = [];
  if (opts.title !== false) out.push(weekTitle(u.week), '');
  u.sections.forEach((w, i) => {
    out.push(`${i + 1}. ${w.name}`);
    const status = [w.flag && !w.status.toLowerCase().startsWith(w.flag.toLowerCase()) ? w.flag : '', w.status].filter(Boolean).join('. ');
    out.push(`Status: ${status || '—'}`);
    for (const p of w.progress) out.push(`- ${p}`);
    if (w.next.length) {
      out.push('Next steps:');
      for (const n of w.next) out.push(`- ${n}`);
    }
    const { table, groups } = metricParts(w);
    const shown = table.filter((m) => m.value !== null);
    for (const m of shown) out.push(`${m.name}: ${metricWords(m)}`);
    for (const g of groups) if (g.metrics.some((m) => m.value !== null)) out.push(groupLine(g));
    if (w.notes.trim()) out.push(w.notes.trim());
    out.push('', `Blockers / Risks: ${w.none ? w.noneWords || 'None' : w.blockers.length ? w.blockers.join(' ') : 'None'}`, '');
  });
  if (u.attachments.length) {
    out.push('Attachments:');
    for (const a of u.attachments) out.push(`- ${a.name}${a.what ? ` (${a.what})` : ''}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The brand kit an export is set in (Ironleaf's Assets page): the business's name, its heading colour and font. */
export interface ExportBrand {
  name?: string;
  colour?: string;
  font?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeColour = (c?: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#1f2937');
const safeFont = (f?: string) => (f && /^[\w\s-]{1,60}$/.test(f) ? f : '');

/** The update laid out as a page (the window prints it to PDF), in the brand kit's colour and font. */
export function weeklyHtml(u: WeeklyUpdate, brand: ExportBrand = {}, projects: Record<string, { health?: string; due?: string }> = {}): string {
  const colour = safeColour(brand.colour);
  const font = safeFont(brand.font);
  const flagTone = (f: string) => (f === 'On track' || f === 'Done' ? '#15803d' : f === 'At risk' ? '#b45309' : f === 'Blocked' ? '#b91c1c' : '#475569');
  const parts: string[] = [];
  parts.push(`<div class="wu-print" style="${font ? `font-family:'${font}',system-ui,sans-serif;` : ''}">`);
  parts.push(`<header class="wu-print-head" style="border-bottom:2px solid ${colour}">${brand.name ? `<div class="wu-print-brand" style="color:${colour}">${esc(brand.name)}</div>` : ''}<h1 style="color:${colour}">${esc(weekTitle(u.week))}</h1><p class="wu-print-meta">${[u.audience ? `To ${esc(u.audience)}` : '', u.status === 'Sent' && u.sent ? `Sent ${esc(longDay(u.sent))}${u.sentBy ? ` by ${esc(u.sentBy)}` : ''}` : ''].filter(Boolean).join(' · ')}</p></header>`);
  if (u.intro.trim()) parts.push(`<p class="wu-print-intro">${esc(u.intro.trim()).replace(/\n/g, '<br>')}</p>`);
  u.sections.forEach((w, i) => {
    const p = w.project ? projects[w.project.toLowerCase()] : undefined;
    parts.push(`<section class="wu-print-ws"><h2 style="color:${colour}">${i + 1}. ${esc(w.name)}${w.flag ? ` <span class="wu-print-flag" style="color:${flagTone(w.flag)};border-color:${flagTone(w.flag)}">${esc(w.flag)}</span>` : ''}</h2>`);
    if (w.project) parts.push(`<p class="wu-print-project">Project: ${esc(w.project)}${p?.health ? ` · ${esc(p.health)}` : ''}${p?.due ? ` · due ${esc(p.due)}` : ''}</p>`);
    parts.push(`<p><strong>Status:</strong> ${esc(w.status || '—')}</p>`);
    if (w.progress.length) parts.push(`<h3>Progress</h3><ul>${w.progress.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    if (w.next.length) parts.push(`<h3>Next steps</h3><ul>${w.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    const { table, groups } = metricParts(w);
    const shown = table.filter((m) => m.value !== null);
    if (shown.length) parts.push(`<table class="wu-print-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${shown.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${esc(metricWords(m))}</td></tr>`).join('')}</tbody></table>`);
    for (const g of groups) if (g.metrics.some((m) => m.value !== null)) parts.push(`<p>${esc(groupLine(g))}</p>`);
    if (w.notes.trim()) parts.push(`<p class="wu-print-notes">${esc(w.notes.trim()).replace(/\n/g, '<br>')}</p>`);
    parts.push(`<p class="wu-print-blockers"><strong>Blockers / Risks:</strong> ${esc(w.none ? w.noneWords || 'None' : w.blockers.join(' ') || 'None')}</p></section>`);
  });
  if (u.attachments.length) parts.push(`<section class="wu-print-ws"><h2 style="color:${colour}">Attachments</h2><ul>${u.attachments.map((a) => `<li>${esc(a.name)}${a.what ? ` — ${esc(a.what)}` : ''}</li>`).join('')}</ul></section>`);
  parts.push('</div>');
  return parts.join('');
}

// ── A Word document (no library: the few parts Word needs, in a zip of stored files) ────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A zip of stored (not deflated) files: what a .docx needs, readable by Word, LibreOffice and every zip program. */
export function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = utf8(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + f.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** The update as a Word document (.docx bytes), its headings in the brand kit's colour and font. */
export function weeklyDocx(u: WeeklyUpdate, brand: ExportBrand = {}): Uint8Array {
  const colour = safeColour(brand.colour).replace('#', '').slice(0, 6).padEnd(6, '0');
  const font = safeFont(brand.font) || 'Calibri';
  const run = (t: string, o: { b?: boolean; size?: number; color?: string } = {}) => `<w:r><w:rPr><w:rFonts w:ascii="${xml(font)}" w:hAnsi="${xml(font)}"/>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  const para = (runs: string, o: { after?: number; bullet?: boolean } = {}) => `<w:p><w:pPr>${o.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}<w:spacing w:after="${o.after ?? 120}"/></w:pPr>${runs}</w:p>`;
  const body: string[] = [];
  if (brand.name) body.push(para(run(brand.name, { b: true, size: 20, color: colour }), { after: 40 }));
  body.push(para(run(weekTitle(u.week), { b: true, size: 36, color: colour }), { after: 80 }));
  const meta = [u.audience ? `To ${u.audience}` : '', u.status === 'Sent' && u.sent ? `Sent ${longDay(u.sent)}${u.sentBy ? ` by ${u.sentBy}` : ''}` : ''].filter(Boolean).join(' · ');
  if (meta) body.push(para(run(meta, { size: 20, color: '6B7280' }), { after: 200 }));
  if (u.intro.trim()) for (const l of u.intro.trim().split('\n')) body.push(para(run(l, { size: 20 })));
  u.sections.forEach((w, i) => {
    body.push(para(run(`${i + 1}. ${w.name}`, { b: true, size: 28, color: colour }) + (w.flag ? run(`   ${w.flag}`, { b: true, size: 20, color: w.flag === 'At risk' ? 'B45309' : w.flag === 'Blocked' ? 'B91C1C' : '15803D' }) : ''), { after: 80 }));
    if (w.project) body.push(para(run(`Project: ${w.project}`, { size: 20, color: '6B7280' })));
    body.push(para(run('Status: ', { b: true }) + run(w.status || '—')));
    if (w.progress.length) {
      body.push(para(run('Progress', { b: true, size: 22 }), { after: 40 }));
      for (const p of w.progress) body.push(para(run(p), { bullet: true, after: 40 }));
    }
    if (w.next.length) {
      body.push(para(run('Next steps', { b: true, size: 22 }), { after: 40 }));
      for (const p of w.next) body.push(para(run(p), { bullet: true, after: 40 }));
    }
    const { table, groups } = metricParts(w);
    const shown = table.filter((m) => m.value !== null);
    if (shown.length) {
      const cellX = (t: string, b = false, right = false) => `<w:tc><w:tcPr><w:tcW w:w="${right ? 2000 : 6000}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>${right ? '<w:jc w:val="right"/>' : ''}</w:pPr>${run(t, { b, size: 20 })}</w:p></w:tc>`;
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cellX('Measure', true)}${cellX('Value', true, true)}</w:tr>${shown.map((m) => `<w:tr>${cellX(m.name)}${cellX(metricWords(m), false, true)}</w:tr>`).join('')}</w:tbl>`);
      body.push(para(''));
    }
    for (const g of groups) if (g.metrics.some((m) => m.value !== null)) body.push(para(run(groupLine(g), { size: 20 })));
    if (w.notes.trim()) for (const l of w.notes.trim().split('\n')) body.push(para(run(l, { size: 20 })));
    body.push(para(run('Blockers / Risks: ', { b: true }) + run(w.none ? w.noneWords || 'None' : w.blockers.join(' ') || 'None'), { after: 240 }));
  });
  if (u.attachments.length) {
    body.push(para(run('Attachments', { b: true, size: 28, color: colour }), { after: 80 }));
    for (const a of u.attachments) body.push(para(run(`${a.name}${a.what ? ` — ${a.what}` : ''}`), { bullet: true, after: 40 }));
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  return storedZip([
    { name: '[Content_Types].xml', data: utf8(types) },
    { name: '_rels/.rels', data: utf8(rels) },
    { name: 'word/document.xml', data: utf8(document) },
    { name: 'word/_rels/document.xml.rels', data: utf8(docRels) },
    { name: 'word/numbering.xml', data: utf8(numbering) },
  ]);
}

// ── An older long note of weekly updates, brought in ─────────────────────────────────────────────────────────────────

export interface ImportedWeek {
  week: string;
  /** The heading it had ("Week of 19 October 2026 (prepared Wed 21 Oct)"). */
  heading: string;
  update: WeeklyUpdate;
}

/** Whether a note reads as a long note of weekly updates (one heading per week, workstreams under each). */
export function looksLikeWeeklyNote(text: string, props: Record<string, unknown> = {}): boolean {
  if (String(props.type ?? '').toLowerCase() === 'weekly-update') return false;
  const weeks = String(text ?? '').split(/\r?\n/).filter((l) => /^##\s+(?:week\s+(?:of|commencing|starting|beginning)\s+|w\/c\s+)/i.test(l));
  return weeks.length > 0;
}

/**
 * A long note of weekly updates read into one update a week, losslessly: each "## Week of 19 October 2026" heading is
 * a week; the words under it before its first workstream are kept as its intro; each "### 1. Name" is a workstream
 * ("Status:", bullets, "Blockers / Risks:", a table of measures and lines like "By country: A 12, B 9" read into their
 * parts; anything else kept in its notes); an "Attachments" heading's files (named, linked and described) become its
 * attachments. `year` reads a heading's day with no year; `audience` and `sentBefore` come from the caller (the note's
 * own words, and this week: earlier weeks were sent).
 */
export function importWeeklyNote(text: string, opts: { year?: number; audience?: string; thisWeek?: string } = {}): ImportedWeek[] {
  const range = frontMatterRange(text);
  const lines = (range ? text.slice(range.to) : text).split(/\r?\n/);
  const out: ImportedWeek[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  const close = () => {
    if (!cur) return;
    const week = readDayWords(cur.heading, opts.year);
    if (week) {
      const monday = mondayOf(week);
      // The week's own lines, its workstreams' "###" made "##" so one reading serves both.
      const inner = cur.lines.map((l) => (/^###\s/.test(l) ? l.slice(1) : /^####\s/.test(l) ? l.slice(1) : l));
      const u = readWeekly('', `# ${weekTitle(monday)}\n${inner.join('\n')}`);
      const prepared = /\bprepared\s+(?:on\s+)?([^)]+)\)?/i.exec(cur.heading);
      const preparedDay = prepared ? readDayWords(prepared[1], Number(monday.slice(0, 4))) : null;
      u.week = monday;
      u.prepared = preparedDay ?? '';
      u.audience = opts.audience ?? '';
      u.status = opts.thisWeek && monday < opts.thisWeek ? 'Sent' : 'Draft';
      // Words after the day in the heading that aren't "prepared …" stay with the week.
      const rest = cur.heading.replace(/^week\s+(?:of|commencing|starting|beginning)\s+|^w\/c\s+/i, '').replace(/\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}/, '').replace(/\(\s*prepared[^)]*\)/i, '').replace(/[()\s·,-]+/g, ' ').trim();
      if (rest) u.intro = [`(${rest})`, u.intro].filter(Boolean).join('\n\n');
      out.push({ week: monday, heading: cur.heading, update: u });
    }
    cur = null;
  };
  for (const l of lines) {
    const h = /^##\s+(.*?)\s*#*$/.exec(l);
    if (h && !/^###/.test(l)) {
      close();
      if (/^(?:week\s+(?:of|commencing|starting|beginning)\s+|w\/c\s+)/i.test(h[1]) || /^\d{4}-\d{2}-\d{2}$/.test(h[1].trim())) cur = { heading: h[1], lines: [] };
      continue;
    }
    if (cur) cur.lines.push(l);
  }
  close();
  return out;
}

/** Who a long note of updates says it goes to ("…weekly status updates to Sam Lee…" in its description), else ''. */
export function audienceFrom(props: Record<string, unknown>): string {
  for (const k of ['audience', 'to', 'about', 'description']) {
    const v = String(props[k] ?? '');
    if (k === 'audience' || k === 'to') {
      if (v.trim()) return linkName(v.trim());
      continue;
    }
    const m = /\bupdates?\s+(?:to|for)\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u.exec(v);
    if (m) return m[1];
  }
  return '';
}

/** The projects a workstream's name most likely means, best first (shared words, and initials: "LF" for "Lantern Fair"). */
export function suggestProjects(name: string, projects: readonly { path: string; name: string }[]): { path: string; name: string; link: string; score: number }[] {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(the|and|of|for|to|in|on|at|a|an|upgrade|project|programme|program)$/.test(w));
  const mine = words(name);
  if (!mine.length) return [];
  const out: { path: string; name: string; link: string; score: number }[] = [];
  for (const p of projects) {
    const theirs = words(p.name);
    if (!theirs.length) continue;
    let hit = mine.filter((w) => theirs.includes(w)).length;
    // Initials: "LF 2027" and "Lantern Fair 2027".
    const caps = name.split(/\s+/).filter((w) => /^[A-Z]{2,4}$/.test(w));
    for (const c of caps) {
      const initials = p.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('');
      if (initials.includes(c)) hit += 0.75;
    }
    const score = hit / Math.max(mine.length, 1);
    // Linked by its note's own name (a project called "Refresh (North/South)" has no slash in its file's name).
    if (score > 0) out.push({ ...p, link: projectLink(p), score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
}

/** The one project a workstream surely means (a clear best match) as its link's words, else ''. */
export function sureProject(name: string, projects: readonly { path: string; name: string }[]): string {
  const s = suggestProjects(name, projects);
  if (!s.length || s[0].score < 0.66) return '';
  if (s[1] && s[1].score >= s[0].score - 0.15) return '';
  return s[0].link;
}

/** What a link to a project is written with: its note's file name (always without a slash). */
export const projectLink = (p: { path: string; name: string }) => p.path.split('/').pop()!.replace(/\.md$/i, '') || p.name.replace(/\//g, ' ');

// ── Agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────────

const weekArg = { type: 'string', description: 'Any day in the week (YYYY-MM-DD); this week unless given.' };

export const WEEKLY_TOOLS: WorkToolDef[] = [
  {
    name: 'weekly_update_get',
    module: 'weekly',
    write: false,
    title: 'Weekly update',
    step: 'Looked at the weekly update',
    description: 'A week’s status update from the person’s Weekly pack (Ironleaf): each workstream’s flag, status, progress, next steps, blockers and metrics, as the plain text they send. With workstream given, that workstream’s history week by week instead (statuses, blockers and each metric’s trend). Use it for "what did I say about X last week?", "draft this week’s update", "how has the rollout number moved?".',
    parameters: { type: 'object', properties: { week: weekArg, workstream: { type: 'string', description: 'A workstream’s name: its history instead of one week.' } }, additionalProperties: false },
  },
  {
    name: 'weekly_update_create',
    module: 'weekly',
    write: true,
    title: 'Start a weekly update',
    step: 'Started the weekly update',
    description: 'Start a week’s update in Weekly: by default from the latest earlier week (its workstreams, projects, flags, status lines, next steps, blockers and measures carried on; progress empty and the numbers to fill). Never over a week that already has one: that one is given back.',
    parameters: { type: 'object', properties: { week: weekArg, audience: { type: 'string', description: 'Who it goes to.' }, from_last: { type: 'boolean', description: 'Start from the latest earlier week (true unless false).' } }, additionalProperties: false },
  },
  {
    name: 'weekly_update_add_section',
    module: 'weekly',
    write: true,
    title: 'Write a workstream into the weekly update',
    step: 'Wrote a workstream into the weekly update',
    description: 'Add a workstream to a week’s update, or bring one up to date: its flag, status line, progress lines, next steps and blockers (give "None" for none), and the project it links to. Lines already there aren’t added twice. Use the person’s own words; never invent progress. The week’s update is started from last week when it doesn’t exist yet.',
    parameters: {
      type: 'object',
      properties: {
        week: weekArg,
        workstream: { type: 'string', description: 'Its name, as the update calls it.' },
        project: { type: 'string', description: 'The Ironleaf project it links to, by name.' },
        flag: { type: 'string', enum: [...FLAGS] },
        status: { type: 'string', description: 'The short status line.' },
        progress: { type: 'array', items: { type: 'string' }, description: 'What moved this week, a line each.' },
        next_steps: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' }, description: 'Blockers or risks, a line each; ["None"] for none.' },
      },
      required: ['workstream'],
      additionalProperties: false,
    },
  },
  {
    name: 'weekly_update_set_metric',
    module: 'weekly',
    write: true,
    title: 'Set a metric in the weekly update',
    step: 'Set a metric in the weekly update',
    description: 'Set one measure of a workstream in a week’s update, as a number (1047, 96.4): it shows as a trend week by week. Give unit "%" for a percentage; group puts it with others sent as one line ("Outstanding by country").',
    parameters: { type: 'object', properties: { week: weekArg, workstream: { type: 'string' }, measure: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string' }, group: { type: 'string' } }, required: ['workstream', 'measure', 'value'], additionalProperties: false },
  },
  {
    name: 'weekly_update_gather',
    module: 'weekly',
    write: true,
    title: 'Gather a first draft',
    step: 'Gathered a first draft of the weekly update',
    description: 'Gather a first draft of a week’s update from its projects: each linked project’s recent updates become progress, its open next steps and risks are carried in, and a project with something to say gets a section. Lines already there are not repeated and nothing is invented; the person corrects the draft. The week’s update is started from last week when it doesn’t exist yet.',
    parameters: { type: 'object', properties: { week: weekArg }, additionalProperties: false },
  },
  {
    name: 'weekly_update_send',
    module: 'weekly',
    write: true,
    title: 'Send the weekly update',
    step: 'Sent the weekly update',
    description: 'Send a week’s update by email to the addresses the person gives (never guessed): the person is asked first, as for every send, and the update is marked sent only when it has gone. Where no mail is connected, it says so.',
    parameters: { type: 'object', properties: { week: weekArg, to: { type: 'array', items: { type: 'string' }, description: 'The email addresses it goes to.' }, subject: { type: 'string', description: 'Its subject (the week’s title unless given).' } }, required: ['to'], additionalProperties: false },
  },
  {
    name: 'weekly_update_mark_sent',
    module: 'weekly',
    write: true,
    title: 'Mark the weekly update sent',
    step: 'Marked the weekly update sent',
    description: 'Mark a week’s update as sent (today unless a day is given), after the person has sent it. Never mark it sent on your own: only when they say it went.',
    parameters: { type: 'object', properties: { week: weekArg, date: { type: 'string', description: 'YYYY-MM-DD' }, sent_by: { type: 'string' } }, additionalProperties: false },
  },
];

/** A workstream's history in words, for an assistant. */
export function historyWords(h: WorkstreamHistory, thisYear?: number): string {
  const lines = [`${h.name}${h.project ? ` (project ${h.project})` : ''}: ${h.weeks.length} ${h.weeks.length === 1 ? 'week' : 'weeks'} of updates.`];
  for (const p of [...h.weeks].reverse().slice(0, 12)) {
    lines.push(`- ${weekShort(p.week)}${thisYear && Number(p.week.slice(0, 4)) !== thisYear ? ` ${p.week.slice(0, 4)}` : ''}: ${[p.flag, p.status].filter(Boolean).join(' · ') || 'no status'}; blockers: ${p.none ? p.noneWords || 'none' : p.blockers.join(' ') || 'none said'}`);
  }
  for (const m of h.metrics.filter((x) => x.points.length)) lines.push(`- ${m.group ? `${m.group} · ` : ''}${m.name}: ${m.points.map((p) => `${weekShort(p.week)} ${metricWords({ value: p.value, unit: m.unit })}`).join(', ')}`);
  return lines.join('\n');
}
