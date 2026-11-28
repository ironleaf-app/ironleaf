// Systems and Home Lab (Wave 7 part b, 24 Oct 2026; module 18 of the catalogue: "Servers, services, credentials (linked
// to Secrets), runbooks, monitoring · Service map, runbooks, health · Personal / Secrets"). Each record is a plain note
// the person owns:
//
//   Home/Systems and Home Lab/Machines/Media box.md      type: machine — kind, role, os, address, location, status,
//                                                        checked; "## Credentials" (locked links to Secrets only);
//                                                        "## Health log" | Date | Status | Note |
//   Home/Systems and Home Lab/Services/Photo library.md  type: service — kind, runs_on "[[Media box]]", url, port,
//                                                        status, depends_on, runbook, checked; Credentials; Health log
//   Home/Systems and Home Lab/Runbooks/Update the NAS.md type: runbook — for, every, last_run; "## Steps" (a numbered
//                                                        list); "## Runs" | Date | Result | Note |
//
// A login is never written in a note: the note holds a locked link ("[locked](secret:…)") and the value stays in Secrets,
// where no assistant can read it. A password written in a note by hand is found by the secret scanner and offered to move.
// Pure: no files, no Node, no DOM.

import { MACHINE_KINDS, MACHINE_STATUSES, RUN_RESULTS, RUNBOOK_EVERY, SERVICE_KINDS, SERVICE_STATUSES } from './life-records';
import { defaultRecordView, type RecordViewDef } from './record-views';
import { SECRET_LINK } from './sensitivity';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { addToDay, dayWords, daysFrom, findByName, join, knownWord, linkName, namesOf, plural, readDay, readTable, refusedWords, sectionAt, str, todayOf, whenWords, type TableSpec } from './personal-records';

export const HEALTH_LOG: TableSpec = {
  id: 'health',
  name: 'Health log',
  heading: /^(health log|health|monitoring|status log|checks)$/i,
  fields: [
    { key: 'date', label: 'Date', col: /^(date|when|day)$/i, kind: 'date' },
    { key: 'status', label: 'Status', col: /^(status|state|health)$/i, kind: 'text' },
    { key: 'note', label: 'Note', col: /^(notes?|what|details?)$/i, kind: 'text' },
  ],
  title: 'date',
  one: 'health note',
};

export const RUNS: TableSpec = {
  id: 'runs',
  name: 'Runs',
  heading: /^(runs?|run log|history|done)$/i,
  fields: [
    { key: 'date', label: 'Date', col: /^(date|when|day)$/i, kind: 'date' },
    { key: 'result', label: 'Result', col: /^(result|outcome|status)$/i, kind: 'text' },
    { key: 'note', label: 'Note', col: /^(notes?|what|details?)$/i, kind: 'text' },
  ],
  title: 'date',
  one: 'run',
};

export const STEPS_HEADING = /^(steps|how|procedure|what to do)$/i;
export const CREDENTIALS_HEADING = /^(credentials|logins?|access|passwords?)$/i;

export interface SystemNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
}

/** A locked link to a login in Secrets: what it is called, and the secret's id (never its value). */
export interface Credential {
  label: string;
  id: string;
}

export interface HealthNote {
  row: number;
  date: string | null;
  status: string;
  note: string;
  record: string;
  recordName: string;
  recordKind: 'machine' | 'service';
}

export interface Machine {
  path: string;
  /** Its list row's path, when the row points at this note (a record page opened from the row finds it). */
  rowPath?: string;
  name: string;
  kind: string;
  role: string;
  os: string;
  address: string;
  location: string;
  status: string;
  checked: string | null;
  credentials: Credential[];
  health: HealthNote[];
  /** Its services (their notes). */
  services: string[];
  runbooks: string[];
  /** Passwords or keys written in its note by hand (found by the scanner; counted, never read here). */
  plain: number;
}

export interface Service {
  path: string;
  /** Its list row's path, when the row points at this note (a record page opened from the row finds it). */
  rowPath?: string;
  name: string;
  kind: string;
  runsOn: string;
  machinePath: string | null;
  url: string;
  port: string;
  status: string;
  dependsOn: { name: string; path: string | null }[];
  /** The services that depend on it. */
  dependents: string[];
  runbook: string;
  runbookPath: string | null;
  checked: string | null;
  credentials: Credential[];
  health: HealthNote[];
  plain: number;
}

export interface Step {
  index: number;
  text: string;
}

export interface RunbookRun {
  row: number;
  date: string | null;
  result: string;
  note: string;
}

export interface Runbook {
  path: string;
  /** Its list row's path, when the row points at this note (a record page opened from the row finds it). */
  rowPath?: string;
  name: string;
  for: { name: string; path: string | null; kind: 'machine' | 'service' | null }[];
  every: string;
  lastRun: string | null;
  /** The day it is next due (when it comes round), and the days to it (negative: overdue). */
  nextDue: string | null;
  days: number | null;
  due: boolean;
  steps: Step[];
  runs: RunbookRun[];
}

export interface SystemsModel {
  machines: Machine[];
  services: Service[];
  runbooks: Runbook[];
  /** Every health note, newest first. */
  health: HealthNote[];
  /** Machines and services not up (down, degraded, in maintenance). */
  trouble: { path: string; name: string; kind: 'machine' | 'service'; status: string; checked: string | null; note: string }[];
  runbooksDue: Runbook[];
  /** Records with a password or key written in the note by hand. */
  plain: { path: string; name: string; count: number }[];
  today: string;
  remindDays: number;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every locked link in a note, each with the words that name it ("Admin login: [locked](secret:…)" → "Admin login"). */
export function credentialsOf(text: string): Credential[] {
  const out: Credential[] = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    for (const m of line.matchAll(new RegExp(SECRET_LINK.source, 'g'))) {
      const before = line.slice(0, m.index).replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/[:\-–—\s]+$/, '').trim();
      const label = before || (m[1] && !/^locked$/i.test(m[1]) ? m[1] : 'Login');
      if (!out.some((c) => c.id === m[2])) out.push({ label: label.slice(0, 80), id: m[2] });
    }
  }
  return out;
}

/** A runbook's steps: its numbered or bulleted lines under Steps (a tick box's words too). */
export const stepsOf = (text: string): Step[] => listOf(text, STEPS_HEADING);

/** A section's list: its numbered or bulleted lines (a tick box's words too), in order. */
export function listOf(text: string, heading: RegExp): Step[] {
  const src = String(text ?? '');
  const at = sectionAt(src, heading);
  if (!at) return [];
  const out: Step[] = [];
  for (const line of src.slice(at.start, at.end).split(/\r?\n/)) {
    const m = /^\s*(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/.exec(line);
    if (m) out.push({ index: out.length, text: m[1] });
  }
  return out;
}

const healthOf = (n: SystemNote, kind: 'machine' | 'service'): HealthNote[] => {
  // The same line twice on one day is shown once (30 Oct 2026, a real log); nothing is taken out of the note.
  const seen = new Set<string>();
  return readTable(n.content, HEALTH_LOG).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), status: v.status, note: v.note, record: n.path, recordName: n.title, recordKind: kind })).filter((h) => { const k = `${h.date ?? ''}|${h.status}|${h.note}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

const PERIOD_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, Yearly: 12 };
export function nextRunOf(every: string, lastRun: string | null, today: string): string | null {
  if (every === 'On demand') return null;
  if (!lastRun) return today;
  if (every === 'Weekly') return addToDay(lastRun, { days: 7 });
  return addToDay(lastRun, { months: PERIOD_MONTHS[every] ?? 1 });
}

export function systemsModel(notes: readonly SystemNote[], today: Date | string = new Date(), opts: { remindDays?: number; plain?: Record<string, number> } = {}): SystemsModel {
  const t = todayOf(today);
  const remind = opts.remindDays ?? 7;
  const plainOf = (p: string) => opts.plain?.[p] ?? 0;
  const machines: Machine[] = notes
    .filter((n) => n.type === 'machine')
    .map((n) => { const health = healthOf(n, 'machine'); return { path: n.path, name: n.title, kind: knownWord(MACHINE_KINDS, n.props.kind) || 'Other', role: str(n.props.role), os: str(n.props.os), address: str(n.props.address), location: str(n.props.location), status: knownWord(MACHINE_STATUSES, n.props.status) || 'Up', checked: readDay(n.props.checked) ?? health.filter((h) => h.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).pop()?.date ?? null, credentials: credentialsOf(n.content), health, services: [], runbooks: [], plain: plainOf(n.path) }; });
  const byName = (list: { name: string; path: string }[], name: string) => list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const serviceNotes = notes.filter((n) => n.type === 'service');
  const runbookNotes = notes.filter((n) => n.type === 'runbook');
  const services: Service[] = serviceNotes.map((n) => {
    const runsOn = linkName(n.props.runs_on);
    const rb = linkName(n.props.runbook);
    return {
      path: n.path,
      name: n.title,
      kind: knownWord(SERVICE_KINDS, n.props.kind) || 'Other',
      runsOn,
      machinePath: runsOn ? (byName(machines, runsOn)?.path ?? null) : null,
      url: str(n.props.url),
      port: str(n.props.port),
      status: knownWord(SERVICE_STATUSES, n.props.status) || 'Up',
      dependsOn: namesOf(n.props.depends_on).map((name) => ({ name, path: serviceNotes.find((x) => x.title.toLowerCase() === name.toLowerCase())?.path ?? null })),
      dependents: [],
      runbook: rb,
      runbookPath: rb ? (runbookNotes.find((x) => x.title.toLowerCase() === rb.toLowerCase())?.path ?? null) : null,
      checked: readDay(n.props.checked),
      credentials: credentialsOf(n.content),
      health: healthOf(n, 'service'),
      plain: plainOf(n.path),
    };
  });
  for (const s of services) for (const d of s.dependsOn) if (d.path) services.find((x) => x.path === d.path)?.dependents.push(s.path);
  for (const m of machines) m.services = services.filter((s) => s.machinePath === m.path).map((s) => s.path);
  const runbooks: Runbook[] = runbookNotes.map((n) => {
    const every = knownWord(RUNBOOK_EVERY, n.props.every) || 'On demand';
    const runs = readTable(n.content, RUNS).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), result: v.result, note: v.note }));
    const lastFromRuns = runs.map((r) => r.date).filter((d): d is string => !!d).sort().pop() ?? null;
    const lastRun = [readDay(n.props.last_run), lastFromRuns].filter((d): d is string => !!d).sort().pop() ?? null;
    const nextDue = nextRunOf(every, lastRun, t);
    const days = nextDue ? daysFrom(t, nextDue) : null;
    const forList = namesOf(n.props.for).map((name) => {
      const m = byName(machines, name);
      const s = m ? undefined : byName(services, name);
      return { name, path: m?.path ?? s?.path ?? null, kind: m ? ('machine' as const) : s ? ('service' as const) : null };
    });
    return { path: n.path, name: n.title, for: forList, every, lastRun, nextDue, days, due: days !== null && days <= 0, steps: stepsOf(n.content), runs };
  });
  for (const r of runbooks) for (const f of r.for) if (f.kind === 'machine') machines.find((m) => m.path === f.path)?.runbooks.push(r.path);
  const order = (s: string) => ['Down', 'Degraded', 'Maintenance', 'Stopped', 'Up', 'Retired'].indexOf(s);
  machines.sort((a, b) => Number(a.status === 'Retired') - Number(b.status === 'Retired') || a.name.localeCompare(b.name));
  services.sort((a, b) => a.name.localeCompare(b.name));
  runbooks.sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999') || a.name.localeCompare(b.name));
  const health = [...machines.flatMap((m) => m.health), ...services.flatMap((s) => s.health)].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.recordName.localeCompare(b.recordName));
  const latestNote = (h: HealthNote[]) => [...h].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]?.note ?? '';
  // Maintenance is a choice, not an outage (packs uplift item 4, 5 Nov 2026): a machine in maintenance stays out
  // of trouble (tone warn, tag In maintenance), so it never forces a red Down tag or joins the down count.
  const trouble = [
    ...machines.filter((m) => /^down$/i.test(m.status)).map((m) => ({ path: m.path, name: m.name, kind: 'machine' as const, status: m.status, checked: m.checked, note: latestNote(m.health) })),
    ...services.filter((s) => /^(down|degraded)$/i.test(s.status)).map((s) => ({ path: s.path, name: s.name, kind: 'service' as const, status: s.status, checked: s.checked, note: latestNote(s.health) })),
  ].sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name));
  const plain = [...machines, ...services].filter((x) => x.plain > 0).map((x) => ({ path: x.path, name: x.name, count: x.plain }));
  return { machines, services, runbooks, health, trouble, runbooksDue: runbooks.filter((r) => r.days !== null && r.days <= remind), plain, today: t, remindDays: remind };
}

// ── Changes to a note's words ────────────────────────────────────────────────────────────────────────────────────────

/** A locked link added under Credentials ("- Admin login: [locked](secret:…)"), the section made when missing. */
export function withCredential(text: string, label: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw new Error('That isn’t a secret from Secrets.');
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const line = `- ${label.replace(/[[\]\r\n]/g, ' ').trim() || 'Login'}: [locked](secret:${id})`;
  const at = sectionAt(src, CREDENTIALS_HEADING);
  if (!at) {
    const firstHead = src.search(/^## /m);
    const block = `## Credentials${eol}${eol}${line}${eol}${eol}`;
    if (firstHead >= 0) return src.slice(0, firstHead) + block + src.slice(firstHead);
    return `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
  }
  const body = src.slice(at.start, at.end).replace(/\s*$/, '');
  return `${src.slice(0, at.start)}${body ? `${body}${eol}` : eol}${line}${eol}${eol}${src.slice(at.end).replace(/^(?:\r?\n)+/, '')}`;
}

/** The line holding a locked link taken out (the secret itself stays in Secrets). */
export function withoutCredential(text: string, id: string): string {
  const lines = String(text ?? '').split(/(?<=\n)/);
  const i = lines.findIndex((l) => l.includes(`(secret:${id})`));
  if (i < 0) throw new Error('That login isn’t linked here any more.');
  lines.splice(i, 1);
  return lines.join('');
}

/** A runbook's steps changed (see withList). */
export const withSteps = (text: string, change: ListChange): string => withList(text, STEPS_HEADING, 'Steps', change, 'step');

export interface ListChange {
  at?: number;
  words?: string;
  add?: string;
  remove?: number;
}

/** A section's list changed: one item's words, an item added at the end, or one taken out (the list's own numbering
 *  and every other line kept; the section made, before the first heading, when missing). */
export function withList(text: string, heading: RegExp, name: string, change: ListChange, one = 'item', numberedNew = true): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let at = sectionAt(src, heading);
  let base = src;
  if (!at) {
    if (change.add === undefined) throw new Error(`There is no ${one} there any more.`);
    const firstHead = src.search(/^## /m);
    const block = `## ${name}${eol}${eol}`;
    base = firstHead >= 0 ? src.slice(0, firstHead) + block + src.slice(firstHead) : `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
    at = sectionAt(base, heading)!;
  }
  const lines = base.slice(at.start, at.end).split(/\r?\n/);
  const stepLines = lines.map((l, i) => (/^\s*(?:\d+[.)]|[-*+])\s+/.test(l) ? i : -1)).filter((i) => i >= 0);
  // An empty first step ("1. ") counts as nothing to keep.
  const realSteps = stepLines.filter((i) => /^\s*(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?\S/.test(lines[i]));
  const clean = (w: string) => w.replace(/\r?\n/g, ' ').trim().slice(0, 500);
  if (change.add !== undefined) {
    const words = clean(change.add);
    if (!words) throw new Error(`A ${one} needs its words.`);
    const numbered = stepLines.length ? /^\s*\d+[.)]/.test(lines[stepLines[0]]) : numberedNew;
    const n = realSteps.length + 1;
    const line = numbered ? `${n}. ${words}` : `- ${words}`;
    const empty = stepLines.find((i) => !realSteps.includes(i));
    if (empty !== undefined) lines[empty] = line;
    else {
      const after = realSteps.length ? realSteps[realSteps.length - 1] + 1 : lines[0] === '' ? 1 : 0;
      lines.splice(after, 0, line);
    }
  } else if (change.remove !== undefined) {
    const i = realSteps[change.remove];
    if (i === undefined) throw new Error(`That ${one} isn’t there any more.`);
    lines.splice(i, 1);
    // Numbered again in order.
    let k = 0;
    for (let j = 0; j < lines.length; j++) if (/^\s*\d+[.)]\s+\S/.test(lines[j])) lines[j] = lines[j].replace(/^(\s*)\d+([.)])/, (_m, sp, p) => `${sp}${++k}${p}`);
  } else if (change.at !== undefined) {
    const i = realSteps[change.at];
    if (i === undefined) throw new Error(`That ${one} isn’t there any more.`);
    const words = clean(change.words ?? '');
    if (!words) throw new Error(`A ${one} needs its words.`);
    lines[i] = lines[i].replace(/^(\s*(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?).*$/, `$1${words.replace(/\$/g, '$$$$')}`);
  }
  return base.slice(0, at.start) + lines.join(eol) + base.slice(at.end);
}

const yq = (s: string) => JSON.stringify(s);
const line = (k: string, v: string) => `${k}:${v ? ` ${/^[\w./:-]+$/.test(v) && !/^\d+$/.test(v) ? v : yq(v)}` : ''}`;

export function newMachineText(i: { kind?: string; role?: string; os?: string; address?: string; location?: string; status?: string }): string {
  // No status until a check says so (30 Oct 2026, fourth pass): a new machine is not up just because it was added.
  // No empty headings either (5 Nov 2026, "your notes are yours"): the body stays empty until a login, a health
  // note or the person's own words give it something to put under one (withCredential, tableWithRow).
  return `---\ntype: machine\nkind: ${yq(knownWord(MACHINE_KINDS, i.kind) || 'Server')}\n${line('role', str(i.role))}\n${line('os', str(i.os))}\n${line('address', str(i.address))}\n${line('location', str(i.location))}\nstatus:${knownWord(MACHINE_STATUSES, i.status) ? ` ${knownWord(MACHINE_STATUSES, i.status)}` : ''}\nchecked:\n---\n`;
}

export function newServiceText(i: { kind?: string; runs_on?: string; url?: string; port?: string; status?: string; depends_on?: string[] }): string {
  const deps = (i.depends_on ?? []).map((x) => linkName(x)).filter(Boolean);
  return `---\ntype: service\nkind: ${yq(knownWord(SERVICE_KINDS, i.kind) || 'Web app')}\nruns_on:${linkName(i.runs_on) ? ` ${yq(`[[${linkName(i.runs_on)}]]`)}` : ''}\n${line('url', str(i.url))}\n${line('port', str(i.port))}\nstatus: ${knownWord(SERVICE_STATUSES, i.status) || 'Up'}\ndepends_on: [${deps.map((d) => yq(`[[${d}]]`)).join(', ')}]\nrunbook:\nchecked:\n---\n`;
}

export function newRunbookText(i: { for?: string[]; every?: string; steps?: string[] }): string {
  const forList = (i.for ?? []).map((x) => linkName(x)).filter(Boolean);
  const steps = (i.steps ?? []).map((s) => str(s)).filter(Boolean);
  return `---\ntype: runbook\nfor: [${forList.map((d) => yq(`[[${d}]]`)).join(', ')}]\nevery: ${yq(knownWord(RUNBOOK_EVERY, i.every) || 'On demand')}\nlast_run:\n---\n## Steps\n\n${steps.length ? steps.map((s, k) => `${k + 1}. ${s}`).join('\n') : '1. '}\n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n\n## Notes\n\n`;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function systemRecords(m: SystemsModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const x of m.machines) out.push({ id: `${x.path}::machine`, kind: 'machine', title: x.name, path: x.path, fields: { machine_kind: x.kind, role: x.role || null, os: x.os || null, address: x.address || null, location: x.location || null, status: machineState(x).words, checked: x.checked, services: x.services.length, logins: x.credentials.length || null }, links: [], ref: { at: 'note', path: x.path } });
  for (const s of m.services) out.push({ id: `${s.path}::service`, kind: 'service', title: s.name, path: s.path, fields: { service_kind: s.kind, runs_on: s.runsOn || null, port: s.port || null, url: s.url || null, status: s.status, checked: s.checked, depends_on: s.dependsOn.map((d) => d.name).join(', ') || null, logins: s.credentials.length || null }, links: s.machinePath ? [`${s.machinePath}::machine`] : [], ref: { at: 'note', path: s.path } });
  for (const r of m.runbooks) out.push({ id: `${r.path}::runbook`, kind: 'runbook', title: r.name, path: r.path, fields: { for_what: r.for.map((f) => f.name).join(', ') || null, every: r.every, last_run: r.lastRun, next_due: r.nextDue, steps: r.steps.length }, links: [], ref: { at: 'note', path: r.path } });
  for (const h of m.health) out.push({ id: `${h.record}::health:${h.row}`, kind: 'healthnote', title: h.note || h.status || 'Health note', path: h.record, fields: { date: h.date, status: h.status || null, about: h.recordName, record_kind: h.recordKind === 'machine' ? 'Machine' : 'Service' }, links: [], ref: { at: 'table', heading: 'Health log', row: h.row, cols: {} } });
  return out;
}

export const SYSTEM_EDITABLE: Record<string, string[]> = {
  machine: ['machine_kind', 'role', 'os', 'address', 'location', 'status', 'checked'],
  service: ['service_kind', 'runs_on', 'port', 'url', 'status', 'checked'],
  runbook: ['every', 'last_run'],
};

export function systemSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'machines':
      return [v(['machine'], 'table', 'Every machine', { fields: ['machine_kind', 'role', 'address', 'os', 'location', 'status', 'services', 'logins'], sort: { field: 'title', dir: 'asc' } })];
    case 'services':
      return [v(['service'], 'table', 'Every service', { fields: ['service_kind', 'runs_on', 'port', 'url', 'status', 'depends_on', 'logins'], groupBy: 'runs_on', sort: { field: 'title', dir: 'asc' } })];
    case 'health':
      return [
        v(['healthnote'], 'table', 'Health notes', { fields: ['date', 'about', 'record_kind', 'status'], sort: { field: 'date', dir: 'desc' } }),
        v(['healthnote'], 'chart', 'Health notes by status', { chart: { type: 'bar', by: 'status', measure: 'count' } }),
      ];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const SYSTEM_TOOLS: WorkToolDef[] = [
  {
    name: 'system_machine_add',
    module: 'systems',
    write: true,
    title: 'Add a machine',
    step: 'Added a machine to Systems',
    description: 'Add a machine to Systems with what the person gave: its name, kind, what it does, its system, address and where it is. A login never goes in the note: it is linked from Secrets in the window.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...MACHINE_KINDS] }, role: { type: 'string' }, os: { type: 'string' }, address: { type: 'string' }, location: { type: 'string' }, status: { type: 'string', enum: [...MACHINE_STATUSES] } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'system_service_add',
    module: 'systems',
    write: true,
    title: 'Add a service',
    step: 'Added a service to Systems',
    description: 'Add a service to Systems with what the person gave: its name, kind, the machine it runs on, its address, port and what it depends on.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...SERVICE_KINDS] }, runs_on: { type: 'string', description: 'The machine it runs on.' }, url: { type: 'string' }, port: { type: 'string' }, status: { type: 'string', enum: [...SERVICE_STATUSES] }, depends_on: { type: 'array', items: { type: 'string' } } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'system_check_now',
    module: 'systems',
    write: true,
    title: 'Check a machine now',
    step: 'Checked a machine in Systems',
    description: 'Check a machine now, the way Check now in the window does: Ironleaf signs in with the login linked from Secrets (never shown) and reads the machine, writes a health line, and adds the services it runs that aren’t there yet. Only a machine, by name or address.',
    parameters: { type: 'object', properties: { machine: { type: 'string', description: 'The machine’s name or address.' } }, required: ['machine'], additionalProperties: false },
  },
  {
    name: 'system_map',
    module: 'systems',
    write: false,
    title: 'Service map',
    step: 'Looked at your service map',
    description: 'The person’s machines (servers, NAS, PCs, VMs, routers) and the services on each, with their status, address, port and what each service depends on, from Systems (Ironleaf). Logins are never included: only that one is kept in Secrets. Use it for "what’s running on the NAS?", "is anything down?".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'system_find',
    module: 'systems',
    write: false,
    title: 'Find a machine or service',
    step: 'Looked through your machines and services',
    description: 'Find a machine, service or runbook by words in its name, role, address, port, URL or what it runs on, with its details and latest health notes.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'system_runbook_get',
    module: 'systems',
    write: false,
    title: 'A runbook',
    step: 'Read a runbook',
    description: 'One runbook’s steps, what it is for, how often it comes round, when it was last run and how its last runs went. Use it to walk the person through a job ("how do I update the NAS?").',
    parameters: { type: 'object', properties: { runbook: { type: 'string', description: 'Its name, or the machine or service it is for.' } }, required: ['runbook'], additionalProperties: false },
  },
  {
    name: 'system_health_note',
    module: 'systems',
    write: true,
    title: 'Note a machine or service’s health',
    step: 'Noted the health of a machine or service',
    description: 'Add a health note to a machine or service (today), and set its status when it changed (Up, Down, Degraded, Maintenance, Stopped). Only what the person said or a check showed.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'The machine or service.' }, status: { type: 'string' }, note: { type: 'string' } }, required: ['name', 'note'], additionalProperties: false },
  },
  {
    name: 'system_status',
    module: 'systems',
    write: false,
    title: 'Is everything up',
    step: 'Checked whether everything is up',
    description: 'Answer "is everything up?" from Systems: every machine and service, what needs the person, and the one next step for each thing that needs them. Use it for "is everything up?", "why is the NAS slow?" (read its last checks here first).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'system_action_plan',
    module: 'systems',
    write: false,
    title: 'Plan a fix for a machine',
    step: 'Planned a fix for a machine',
    description: 'The exact plan and command for one fix on a machine (install-updates, restart-service, free-disk, reboot), to run only with the person’s OK through the remote computer tools, which ask them first. free-disk only shows what is big; it deletes nothing. After it runs, record the result with system_action_result.',
    parameters: { type: 'object', properties: { machine: { type: 'string', description: 'The machine’s name or address.' }, action: { type: 'string', enum: ['install-updates', 'restart-service', 'free-disk', 'reboot'] }, service: { type: 'string', description: 'For restart-service: the service’s name.' } }, required: ['machine', 'action'], additionalProperties: false },
  },
  {
    name: 'system_runbooks_write',
    module: 'systems',
    write: true,
    title: 'Write the runbooks a machine needs',
    step: 'Wrote the runbooks a machine needs',
    description: 'Write the runbooks a machine needs from what its last check found (update it, restart each service on it, check backups, restore), for the ones not there yet. The person never has to write these steps.',
    parameters: { type: 'object', properties: { machine: { type: 'string', description: 'The machine’s name or address.' } }, required: ['machine'], additionalProperties: false },
  },
  {
    name: 'system_action_result',
    module: 'systems',
    write: true,
    title: 'Record what a fix did',
    step: 'Recorded what a fix did on a machine',
    description: 'Record in a machine’s health log what a fix did after it ran on that computer (its result in plain words). Only what the run actually showed.',
    parameters: { type: 'object', properties: { machine: { type: 'string' }, action: { type: 'string' }, note: { type: 'string' } }, required: ['machine', 'note'], additionalProperties: false },
  },
  {
    name: 'system_runbook_mark_run',
    module: 'systems',
    write: true,
    title: 'Mark a runbook run',
    step: 'Marked a runbook run',
    description: 'Record that a runbook was run (today unless the person said another day), how it went (Done, Done with problems, Failed) and a note.',
    parameters: { type: 'object', properties: { runbook: { type: 'string' }, result: { type: 'string', enum: [...RUN_RESULTS] }, note: { type: 'string' }, day: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['runbook'], additionalProperties: false },
  },
];

const OFF = 'The Systems module is off in Ironleaf (Settings › Packs). Say so; don’t guess at the person’s machines or services.';

export interface SystemToolInput {
  model: SystemsModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

const logins = (c: Credential[]) => (c.length ? `; ${plural(c.length, 'login')} kept in Secrets (locked: the person copies it from Ironleaf)` : '');
const machineLine = (x: Machine, today: string) => `- ${x.name} (${x.kind}${x.role ? `, ${x.role}` : ''}): ${machineState(x).words}${x.address ? `; ${x.address}` : ''}${x.os ? `; ${x.os}` : ''}${x.location ? `; in ${x.location}` : ''}${x.checked ? `; checked ${dayWords(x.checked, today)}` : '; not checked yet'}${logins(x.credentials)} [${x.path}]`;
export function serviceObserved(s: Pick<Service, 'status' | 'checked'>, today: string): string {
  if (!s.checked) return 'Not checked yet';
  return s.checked < today ? `${s.status} when checked on ${s.checked}` : `${s.status} · checked ${s.checked}`;
}
const serviceLine = (s: Service, today: string) => `- ${s.name} (${s.kind}): ${serviceObserved(s, today)}${s.runsOn ? ` on ${s.runsOn}` : ''}${s.port ? `, port ${s.port}` : ''}${s.url ? `, ${s.url}` : ''}${s.dependsOn.length ? `; needs ${s.dependsOn.map((d) => d.name).join(', ')}` : ''}${s.runbook ? `; runbook ${s.runbook}` : ''}${logins(s.credentials)} [${s.path}]`;
const healthLines = (h: HealthNote[], today: string) => [...h].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 3).map((x) => `  - ${x.date ? dayWords(x.date, today) : 'No date'}: ${x.status || 'note'}${x.note ? ` — ${x.note}` : ''}`);

export function findRunbook(m: SystemsModel, words: unknown) {
  return findByName(m.runbooks, words, (r) => [r.name]) ?? m.runbooks.find((r) => r.for.some((f) => f.name.toLowerCase() === str(words).toLowerCase()));
}
export function findSystem(m: SystemsModel, words: unknown): { kind: 'machine'; x: Machine } | { kind: 'service'; x: Service } | null {
  const mach = findByName(m.machines, words, (x) => [x.name, x.address]);
  if (mach) return { kind: 'machine', x: mach };
  const svc = findByName(m.services, words, (x) => [x.name, x.url]);
  return svc ? { kind: 'service', x: svc } : null;
}

export function answerSystemTool(input: SystemToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = SYSTEM_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'machine, service or runbook note', input.agent);
  if (name === 'system_map') {
    if (!m.machines.length && !m.services.length) return join(['No machines or services yet.', refused]);
    const lines: string[] = [];
    for (const x of m.machines) {
      lines.push(machineLine(x, m.today));
      for (const p of x.services) {
        const s = m.services.find((y) => y.path === p)!;
        lines.push(`  ${serviceLine(s, m.today)}`);
      }
    }
    const loose = m.services.filter((s) => !s.machinePath);
    const unchecked = m.machines.filter((x) => !/^retired$/i.test(x.status) && !machineState(x).checked);
    const failed = m.machines.filter((x) => machineState(x).failed);
    return join([`${plural(m.machines.length, 'machine')}, ${plural(m.services.length, 'service')}:`, ...lines, loose.length ? 'Not on a machine written here:' : '', ...loose.map((s) => serviceLine(s, m.today)), m.trouble.length ? `Not up: ${m.trouble.map((t) => `${t.name} (${t.status})`).join(', ')}.` : unchecked.length ? `Not checked yet: ${unchecked.map((x) => x.name).join(', ')}.` : failed.length ? `Could not be checked: ${failed.map((x) => x.name).join(', ')}.` : 'Everything is up.', refused]);
  }
  if (name === 'system_find') {
    const q = str(args.query).toLowerCase();
    if (!q) return 'Say what to look for.';
    const hit = (s: string) => s.toLowerCase().includes(q);
    const machines = m.machines.filter((x) => [x.name, x.role, x.address, x.os, x.location, x.kind].some(hit));
    const services = m.services.filter((s) => [s.name, s.url, s.port, s.runsOn, s.kind].some(hit));
    const runbooks = m.runbooks.filter((r) => [r.name, ...r.for.map((f) => f.name)].some(hit));
    if (!machines.length && !services.length && !runbooks.length) return join([`Nothing in Systems matches “${str(args.query)}”.`, refused]);
    return join([
      ...machines.flatMap((x) => [machineLine(x, m.today), ...healthLines(x.health, m.today)]),
      ...services.flatMap((s) => [serviceLine(s, m.today), ...healthLines(s.health, m.today)]),
      ...runbooks.map((r) => `- Runbook ${r.name}: ${plural(r.steps.length, 'step')}, ${r.every.toLowerCase()}${r.lastRun ? `, last run ${dayWords(r.lastRun, m.today)}` : ', never run'} [${r.path}]`),
      refused,
    ]);
  }
  if (name === 'system_status') {
    const alerts = alertsOf(m);
    const unchecked = m.machines.filter((x) => !/^retired$/i.test(x.status) && !machineState(x).checked);
    const failed = m.machines.filter((x) => machineState(x).failed);
    const head = m.trouble.length ? `not up: ${m.trouble.map((t) => `${t.name} (${t.status})`).join(', ')}.` : unchecked.length ? `not checked yet: ${unchecked.map((x) => x.name).join(', ')}.` : failed.length ? `could not be checked: ${failed.map((x) => x.name).join(', ')}.` : 'everything is up.';
    return join([m.machines.length || m.services.length ? `${plural(m.machines.length, 'machine')}, ${plural(m.services.length, 'service')}: ${head}` : 'No machines or services yet.', ...alerts.map((a) => `- ${a.title}. Next step: ${a.nextStep}`), refused]);
  }
  if (name === 'system_action_plan') {
    const hit = findSystem(m, args.machine);
    if (!hit || hit.kind !== 'machine') return join([`There is no machine called “${str(args.machine)}” in Systems.`, refused]);
    const plan = actionPlan(str(args.action), hit.x.name, str(args.service));
    if (!plan) return join([`That fix isn’t one of: install the updates, restart a service, free disk space (shows what is big first), reboot.`, refused]);
    return join([`${plan.title} on ${hit.x.name}. It runs only with the person’s OK, through the remote computer tools, which ask first.`, `Command: ${plan.command}`, ...plan.steps.map((s, i) => `${i + 1}. ${s}`), 'After it runs, record what it did with system_action_result.', refused]);
  }
  if (name === 'system_runbook_get') {
    const r = findRunbook(m, args.runbook);
    if (!r) return join([`There is no runbook called “${str(args.runbook)}”.${m.runbooks.length ? ` Runbooks: ${m.runbooks.map((x) => x.name).join(', ')}.` : ''}`, refused]);
    return join([
      `${r.name}${r.for.length ? ` (for ${r.for.map((f) => f.name).join(', ')})` : ''}: ${r.every}${r.lastRun ? `; last run ${dayWords(r.lastRun, m.today)}` : '; never run'}${r.nextDue ? `; next due ${dayWords(r.nextDue, m.today)} (${whenWords(r.days ?? 0)})` : ''}. [${r.path}]`,
      r.steps.length ? 'Steps:' : 'No steps written yet.',
      ...r.steps.map((s) => `${s.index + 1}. ${s.text}`),
      r.runs.length ? `Last runs: ${[...r.runs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 3).map((x) => `${x.date ? dayWords(x.date, m.today) : 'no date'} ${x.result || 'done'}${x.note ? ` (${x.note})` : ''}`).join('; ')}.` : '',
      'Any login it needs is in Secrets: say so, never ask for it.',
      refused,
    ]);
  }
  return null;
}

export { MACHINE_STATUSES, SERVICE_STATUSES, RUN_RESULTS };

// ── Check now (26 Oct 2026; on a server they had just added)
// ─ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A machine with an address and a linked login is read over SSH (src/main/life-records/system-probe.ts): its system,
// how long it has been up, disk and memory, updates waiting, and what runs on it (containers, and services that are not
// the system's own plumbing). PROBE is what runs there; readProbe turns its output into what the machine's note keeps.

/** One shell script, sections marked "@@name", each command allowed to fail. Linux (systemd or not), with Docker when present. */
export const PROBE = [
  'echo @@os; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr',
  'echo @@kernel; uname -r',
  'echo @@uptime; cat /proc/uptime 2>/dev/null',
  'echo @@disk; df -P / 2>/dev/null | tail -1',
  'echo @@memory; free -m 2>/dev/null | awk \'/^Mem:/{print $2" "$3}\'',
  'echo @@updates; (apt list --upgradable 2>/dev/null | grep -c upgradable) || (dnf -q check-update 2>/dev/null | grep -c .) || echo ?',
  'echo @@security; (apt-get -s upgrade 2>/dev/null | grep "^Inst" | grep -ci security) || echo ?',
  'echo @@services; systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk \'{print $1}\'',
  // Docker needs its group or sudo: sudo -n never asks for a password, so it only answers where that is already allowed.
  'echo @@containers; docker ps --format \'{{.Names}}|{{.Image}}|{{.Ports}}\' 2>/dev/null || sudo -n docker ps --format \'{{.Names}}|{{.Image}}|{{.Ports}}\' 2>/dev/null',
  'echo @@ports; (ss -tlnpH 2>/dev/null || netstat -tlnp 2>/dev/null) | awk \'{print $4"|"$6$7}\'',
].join('; ');

export interface ProbeService {
  name: string;
  kind: string;
  port: string;
}
export interface ProbeResult {
  os: string;
  upDays: number | null;
  diskUsed: number | null;
  memory: { total: number; used: number } | null;
  updates: number | null;
  securityUpdates: number | null;
  services: ProbeService[];
}

// A system's own plumbing, never listed as one of the person's services.
const PLUMBING = /^(systemd-.*|dbus.*|cron|crond|atd|getty@.*|serial-getty@.*|ssh|sshd|rsyslog|polkit|udisks2|upower|accounts-daemon|networkd-dispatcher|NetworkManager|wpa_supplicant|ModemManager|multipathd|irqbalance|snapd|unattended-upgrades|packagekit|thermald|chrony|chronyd|ntp|ntpd|avahi-daemon|cups.*|bluetooth|rtkit-daemon|switcheroo-control|power-profiles-daemon|colord|gdm|lightdm|user@.*|qemu-guest-agent|open-vm-tools|vgauth|containerd|docker|cloud-.*|lvm2-.*|blk-availability|auditd|firewalld|ufw|apparmor|kerneloops|whoopsie|fwupd|smartd|lxcfs|iscsid|getty|console-.*|plymouth.*|haveged|rngd|tuned|sysstat|smartmontools|mdmonitor|dm-event|uuidd|nscd|sssd|motd-news|e2scrub.*)$/i;

const KIND_OF: [RegExp, string][] = [
  [/nginx|apache|httpd|caddy|traefik|lighttpd|haproxy|node|gunicorn|uwsgi|php-fpm|tomcat|nextcloud|wordpress|gitea|grafana(?!-agent)|portainer|homepage|heimdall/i, 'Web app'],
  [/postgres|mysql|mariadb|redis|mongo|sqlite|influx|elastic|clickhouse/i, 'Database'],
  [/plex|jellyfin|emby|sonarr|radarr|lidarr|prowlarr|qbittorrent|transmission|navidrome|immich|photoprism/i, 'Media'],
  [/minecraft|bedrock|valheim|factorio|terraria|steamcmd|\bark\b|palworld/i, 'Game server'],
  [/restic|borg|duplicati|rsnapshot|urbackup|veeam|kopia|syncthing/i, 'Backup'],
  [/bind9|named|unbound|pihole|pi-hole|adguard|dnsmasq|coredns/i, 'DNS'],
  [/wireguard|wg-quick|openvpn|tailscale|zerotier|headscale/i, 'VPN'],
  [/prometheus|grafana|uptime-kuma|netdata|zabbix|node[_-]exporter|loki|telegraf/i, 'Monitoring'],
  [/smbd|nmbd|samba|nfs|minio|truenas|zfs/i, 'Storage'],
  [/home-?assistant|node-red|n8n|mosquitto|zigbee2mqtt/i, 'Automation'],
];
const kindOf = (name: string): string => KIND_OF.find(([re]) => re.test(name))?.[1] ?? 'Other';
const tidyName = (unit: string) => unit.replace(/\.service$/, '').replace(/@$/, '');

export function readProbe(out: string): ProbeResult {
  const sec = new Map<string, string[]>();
  let at = '';
  for (const raw of String(out).split(/\r?\n/)) {
    const m = /^@@(\w+)$/.exec(raw.trim());
    if (m) {
      at = m[1];
      sec.set(at, []);
    } else if (at && raw.trim()) sec.get(at)!.push(raw.trim());
  }
  const first = (k: string) => sec.get(k)?.[0] ?? '';
  const secs = Number(first('uptime').split(/\s+/)[0]);
  const disk = /(\d+)%/.exec(first('disk'));
  const [mt, mu] = first('memory').split(/\s+/).map(Number);
  const up = first('updates');
  const ports = new Map<string, string>();
  for (const l of sec.get('ports') ?? []) {
    const [addr, proc] = l.split('|');
    const port = /:(\d+)$/.exec(addr ?? '')?.[1];
    const name = /"([^"]+)"/.exec(proc ?? '')?.[1] ?? /\/([\w.-]+)/.exec(proc ?? '')?.[1];
    if (port && name && !ports.has(name)) ports.set(name, port);
  }
  const services: ProbeService[] = [];
  for (const l of sec.get('containers') ?? []) {
    const [name, image, p] = l.split('|');
    if (!name) continue;
    services.push({ name, kind: kindOf(`${name} ${image ?? ''}`), port: /:(\d+)->/.exec(p ?? '')?.[1] ?? '' });
  }
  for (const l of sec.get('services') ?? []) {
    const name = tidyName(l);
    if (!name || PLUMBING.test(name) || services.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    services.push({ name, kind: kindOf(name), port: ports.get(name) ?? '' });
  }
  return {
    os: first('os').replace(/^"|"$/g, '').slice(0, 80),
    upDays: Number.isFinite(secs) && secs > 0 ? Math.floor(secs / 86400) : null,
    diskUsed: disk ? Number(disk[1]) : null,
    memory: Number.isFinite(mt) && Number.isFinite(mu) && mt > 0 ? { total: mt, used: mu } : null,
    updates: /^\d+$/.test(up) ? Number(up) : null,
    securityUpdates: /^\d+$/.test(first('security')) ? Number(first('security')) : null,
    services: services.slice(0, 40),
  };
}

/** The health line a check writes ("Checked: Ubuntu 24.04, up 12 days, disk 41% used, memory 2.1 of 7.8 GB, 3 updates waiting"). */
export function probeWords(r: ProbeResult): string {
  const bits = [r.os, r.upDays !== null ? `up ${r.upDays} day${r.upDays === 1 ? '' : 's'}` : '', r.diskUsed !== null ? `disk ${r.diskUsed}% used` : '', r.memory ? `memory ${(r.memory.used / 1024).toFixed(1)} of ${(r.memory.total / 1024).toFixed(1)} GB` : '', r.updates !== null ? (r.updates ? `${r.updates} update${r.updates === 1 ? '' : 's'} waiting` : 'up to date') : '', r.securityUpdates ? `${r.securityUpdates} security update${r.securityUpdates === 1 ? '' : 's'} waiting` : ''].filter(Boolean);
  return `Checked: ${bits.join(', ')}${r.services.length ? `; ${r.services.length} service${r.services.length === 1 ? '' : 's'} running` : ''}.`;
}

// ── Watching by itself (30 Oct 2026) ──────────────────────────────────────────────────────────────────────────────────
// A background check keeps a health line only when something changed, or once a day as its summary; the rest lives in
// the small history below. Alerts, fixes and runbooks are all read from those same lines, so the window, Today, the
// bell and chat never disagree.

export interface CheckedValues { disk: number | null; memoryPct: number | null; updates: number | null; security: number | null }
export function checkedValues(note: string): CheckedValues {
  const disk = /disk (\d+)% used/i.exec(note)?.[1];
  const mem = /memory ([\d.]+) of ([\d.]+) GB/i.exec(note);
  const upd = /(\d+) updates? waiting/i.exec(note)?.[1];
  const sec = /(\d+) security updates? waiting/i.exec(note)?.[1];
  return { disk: disk ? Number(disk) : null, memoryPct: mem && Number(mem[2]) > 0 ? Math.round((Number(mem[1]) / Number(mem[2])) * 100) : null, updates: upd ? Number(upd) : sec ? Number(sec) : null, security: sec ? Number(sec) : null };
}

/** Keep a line only when it changed something, or as the day's one summary; never the same line twice in a day. */
export function shouldKeepCheck(health: readonly HealthNote[], today: string, status: string, note: string): boolean {
  const rows = health.filter((h) => h.date);
  if (rows.some((h) => h.date === today && h.status === status && h.note === note)) return false;
  const todays = rows.filter((h) => h.date === today);
  if (!todays.length) return true;
  const last = [...rows].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).pop()!;
  return last.status !== status || last.note !== note;
}

export interface HistoryDay { date: string; up: boolean | null; disk: number | null; memoryPct: number | null }
/** The last 7 days, one point a day (the day's last check), oldest first. */
export function historyOf(health: readonly HealthNote[], today: string): HistoryDay[] {
  const out: HistoryDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addToDay(today, { days: -i });
    const rows = health.filter((h) => h.date === date);
    const last = rows[rows.length - 1];
    const valued = [...rows].reverse().find((h) => { const y = checkedValues(h.note); return y.disk !== null || y.memoryPct !== null; });
    const v = valued ? checkedValues(valued.note) : { disk: null, memoryPct: null };
    out.push({ date, up: last ? !/^(down)$/i.test(last.status) && !last.note.startsWith('Check now:') : null, disk: v.disk, memoryPct: v.memoryPct });
  }
  return out;
}

export interface MachineState { words: string; tone: 'ok' | 'warn' | 'bad' | 'none'; checked: boolean; needsLogin: boolean; needsAddress: boolean; /** Why its last check failed, in the check's own words ('' when it did not). */ failed: string }
/** A machine's own state, told the same way everywhere (30 Oct 2026, fourth pass, a machine just added
 *  and shown green): never checked is its own state, never "up"; a check that failed says it could not be checked.
 *  The note's stored status is only believed once a check (its `checked` day, or a failed check's health line) backs it. */
export function machineState(x: Machine): MachineState {
  const base = { checked: !!x.checked, needsLogin: !x.credentials.length, needsAddress: !x.address, failed: '' };
  if (/^retired$/i.test(x.status)) return { ...base, words: 'Retired', tone: 'none' };
  if (!x.checked) return { ...base, words: 'Not checked yet', tone: 'none' };
  const last = [...x.health].filter((h) => h.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).pop();
  const failed = last?.note.startsWith('Check now:') ? last.note.replace(/^Check now:\s*/, '').trim() : '';
  if (failed && !/^down$/i.test(x.status)) return { ...base, words: 'Could not be checked', tone: 'warn', failed };
  return { ...base, words: x.status, tone: /^up$/i.test(x.status) ? 'ok' : /^down$/i.test(x.status) ? 'bad' : 'warn', failed };
}

export interface SystemAlert { key: string; path: string; name: string; kind: 'machine' | 'service'; title: string; nextStep: string; action?: string }
export function alertsOf(m: SystemsModel): SystemAlert[] {
  const out: SystemAlert[] = [];
  for (const t of m.trouble) out.push({ key: `down:${t.path}:${t.status}`, path: t.path, name: t.name, kind: t.kind, title: `${t.name} is ${t.status.toLowerCase()}`, nextStep: t.kind === 'machine' ? `Check ${t.name}, then run its fix guide` : `Restart ${t.name}, or open its runbook`, action: t.kind === 'service' ? 'restart-service' : undefined });
  // Never checked, and checked but failed (fourth pass): both need the person, each with its one next step.
  for (const x of m.machines) {
    if (/^retired$/i.test(x.status)) continue;
    const st = machineState(x);
    if (!st.checked) out.push({ key: `not-checked:${x.path}`, path: x.path, name: x.name, kind: 'machine', title: st.needsAddress ? `${x.name} needs its address so it can be checked` : st.needsLogin ? `${x.name} needs its login so it can be checked` : `${x.name} has not been checked yet`, nextStep: st.needsAddress ? `Add its address, then add its login` : st.needsLogin ? `Add its login` : `Check ${x.name} now, or wait for its next own check` });
    else if (st.failed && !/^down$/i.test(x.status)) out.push({ key: `check-failed:${x.path}:${x.checked ?? ''}`, path: x.path, name: x.name, kind: 'machine', title: `${x.name} could not be checked: ${st.failed}`, nextStep: /refused the login/i.test(st.failed) ? `Check its login in Secrets, then check ${x.name} again` : `Check ${x.name} is on and its address is right, then check it again` });
  }
  for (const x of m.machines) {
    if (/^retired$/i.test(x.status)) continue;
    const rows = x.health.filter((h) => h.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const last = [...rows].reverse().find((h) => { const y = checkedValues(h.note); return y.disk !== null || y.memoryPct !== null || y.updates !== null; }) ?? rows[rows.length - 1];
    if (!last) continue;
    const v = checkedValues(last.note);
    if (v.disk !== null && v.disk > 85) out.push({ key: `disk:${x.path}:${last.date}`, path: x.path, name: x.name, kind: 'machine', title: `${x.name}’s disk is ${v.disk}% full`, nextStep: `Free disk space on ${x.name} (it shows what is big first)`, action: 'free-disk' });
    const week = rows.filter((h) => h.date && daysFrom(h.date, m.today) <= 7);
    const firstWeek = week.map((h) => checkedValues(h.note)).find((y) => y.disk !== null);
    if (v.disk !== null && firstWeek?.disk != null && v.disk - firstWeek.disk >= 10) out.push({ key: `filling:${x.path}:${last.date}`, path: x.path, name: x.name, kind: 'machine', title: `${x.name}’s disk is filling fast (up ${v.disk - firstWeek.disk} points this week)`, nextStep: `Free disk space on ${x.name} (it shows what is big first)`, action: 'free-disk' });
    if (v.memoryPct !== null && v.memoryPct >= 90) out.push({ key: `memory:${x.path}:${last.date}`, path: x.path, name: x.name, kind: 'machine', title: `${x.name}’s memory is nearly full (${v.memoryPct}%)`, nextStep: `See what is using memory on ${x.name}, or restart the service using the most` });
    const waiting = rows.filter((h) => (checkedValues(h.note).security ?? checkedValues(h.note).updates ?? 0) > 0);
    if (waiting.length && v && (v.security ?? v.updates ?? 0) > 0 && waiting[0].date && daysFrom(waiting[0].date, m.today) >= 7) out.push({ key: `updates:${x.path}:${waiting[0].date}`, path: x.path, name: x.name, kind: 'machine', title: `Security updates have waited over a week on ${x.name}`, nextStep: `Install the updates on ${x.name}`, action: 'install-updates' });
  }
  return out;
}

/** Green, amber, red or neutral grey for one machine, from its own state, its services and its alerts. */
export function machineTone(m: SystemsModel, x: Machine): 'ok' | 'warn' | 'bad' | 'none' {
  const st = machineState(x);
  if (!st.checked) return 'none';
  const alerts = alertsOf(m).filter((a) => a.path === x.path);
  if (/^down$/i.test(x.status) || m.services.some((s) => s.machinePath === x.path && /^down$/i.test(s.status)) || alerts.some((a) => a.key.startsWith('disk:') || a.key.startsWith('down:'))) return 'bad';
  if (st.tone !== 'ok' || !/^up$/i.test(x.status) || m.services.some((s) => s.machinePath === x.path && !/^up$/i.test(s.status)) || alerts.length) return 'warn';
  return 'ok';
}

export type SystemAction = 'install-updates' | 'restart-service' | 'free-disk' | 'reboot';
const unitOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '-').replace(/^-+|-+$/g, '');
export function actionPlan(action: string, machine: string, service = ''): { action: SystemAction; title: string; command: string; steps: string[] } | null {
  if (action === 'install-updates') return { action, title: 'Install the updates', command: 'sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade || sudo dnf -y upgrade', steps: [`Install the waiting updates on ${machine}.`, 'Check it answers again afterwards.'] };
  if (action === 'restart-service') { const u = unitOf(service); if (!u) return null; return { action, title: `Restart ${service}`, command: `sudo systemctl restart ${u}`, steps: [`Restart ${service} on ${machine}.`, `Check ${service} is up again.`] }; }
  if (action === 'free-disk') return { action, title: 'Free disk space (see what is big first)', command: 'df -h /; du -xhd1 / 2>/dev/null | sort -h | tail -20; du -xhd1 /var /home 2>/dev/null | sort -h | tail -20', steps: [`Show the biggest folders on ${machine}. Nothing is deleted.`, 'Choose what to move to the Bin or holding folder with the person.'] };
  if (action === 'reboot') return { action, title: 'Reboot when done', command: 'sudo reboot', steps: [`Reboot ${machine}.`, 'Check it answers again afterwards.'] };
  return null;
}

/** The runbooks a machine needs, written from what a check found. The person never writes these steps. One check
 *  writes restart runbooks for eight services at most; the rest share one summary runbook, so a busy machine never
 *  buries the vault in dozens of notes — and no service is silently left without one. */
export function runbooksFromCheck(machine: string, os: string, services: readonly { name: string; kind: string }[]): { name: string; for: string; steps: string[] }[] {
  const sys = os || 'its system';
  const out: { name: string; for: string; steps: string[] }[] = [
    { name: `Update ${machine}`, for: machine, steps: [`Check ${machine} is up and note its disk space.`, `Install the waiting updates for ${sys} (on the machine: sudo apt-get update && sudo apt-get upgrade, or its own update tool).`, 'Restart a service only if the update says it needs it.', `Check ${machine} answers again and its services are up.`] },
    { name: `Check backups on ${machine}`, for: machine, steps: ['Open the backup service or folder on the machine.', 'Check the newest backup is from the last day it should have run.', 'Open one file from it to be sure it reads.', `Note the result on ${machine}’s health log.`] },
    { name: `Restore ${machine}`, for: machine, steps: ['Find the newest good backup and say which day it is from.', 'Restore to a spare place first, never over the only copy.', 'Check the restored files open.', `Put the restored copy in place on ${machine}, then check its services.`] },
  ];
  const restarts = services.slice(0, 20);
  for (const s of restarts.slice(0, 8)) out.push({ name: `Restart ${s.name}`, for: s.name, steps: [`Check ${s.name}’s status on ${machine}.`, `Restart it (on the machine: sudo systemctl restart ${unitOf(s.name) || 'the service'}, or from its own page).`, `Check ${s.name} answers again.`] });
  const rest = restarts.slice(8);
  if (rest.length) {
    out.push({
      name: `Restart the other services on ${machine}`, for: machine, steps: [
        `One check writes runbooks for eight services; these ${rest.length} share this one: ${rest.map((s) => s.name).join(', ')}.`,
        ...rest.slice(0, 6).map((s) => `Restart ${s.name} (on the machine: sudo systemctl restart ${unitOf(s.name) || 'the service'}, or from its own page).`),
        ...(rest.length > 6 ? [`And ${rest.length - 6} more the same way: ${rest.slice(6).map((s) => s.name).join(', ')}.`] : []),
        'Check each one answers again.',
      ],
    });
  }
  return out;
}
