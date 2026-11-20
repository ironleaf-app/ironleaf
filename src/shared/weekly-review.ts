// The weekly review (17 Oct 2026): every Friday (or when asked), project by project, what changed this week, what
// slipped, what to chase, and the changes to make — drafted here from the project files as they are now and as they
// were when the week began, the project's Activity and other notes, and the files changed in its folder. Every number
// and line comes from those; nothing is guessed. The person approves, edits or rejects each change and applies them in
// one pass; a "Weekly review — 17 Oct 2026" note keeps what was decided.

import { addDays, dayWords, daysBetween, fridayOf, isoDay, readDay, startOfDay, WEEKDAYS } from './days';
import { HEALTHS, parseProject, type Project, type ProjectEdit, type ProjectNext } from './project-file';
import { sameWhat } from './meetings';
import { isFinished } from './finished';
import { plural } from './words';

export interface ReviewSource {
  /** The project file: its path and text now. */
  path: string;
  text: string;
  /** The file as it was when the week began (the last review's copy, else File recovery's), and when that was. */
  before?: string | null;
  beforeTime?: number | null;
  /** The former host app's task notes (Activity/) and the project's other notes (meetings…), with when each last changed. */
  activity?: { path: string; title: string; modified: number; status?: string }[];
  notes?: { path: string; title: string; modified: number }[];
  /** The folder's files (null: no folder on this PC, or it can't be reached). */
  files?: { rel: string; name: string; modified: number }[] | null;
}

/** Something that happened, or needs the person: in words, with where it leads. */
export interface ReviewItem {
  id: string;
  words: string;
  detail?: string;
  /** A note to open, or a file in the project's folder. */
  open?: { note: string } | { file: string };
}

export type ProposalKind = 'health' | 'update' | 'move' | 'status' | 'next';
/** A change to make to the project, for the person to approve, edit or reject. */
export interface ReviewProposal {
  id: string;
  kind: ProposalKind;
  /** What it does, in words ("Health: On track → At risk"). */
  words: string;
  why?: string;
  /** The value set: a health or status, an update's words, a step's new day ("24 Oct"), a new step's words. */
  value: string;
  /** For a moved step: the step's words (it is found by them when the change is made). */
  step?: string;
  accept: boolean;
  by: 'review' | 'assistant';
}

export interface ProjectReview {
  path: string;
  name: string;
  health?: string;
  status?: string;
  changed: ReviewItem[];
  slipped: ReviewItem[];
  chase: ReviewItem[];
  proposals: ReviewProposal[];
  /** Nothing changed, slipped or waiting. */
  quiet: boolean;
  /** What "changed" is measured against: the file as the week began, an earlier copy from within the week, or nothing. */
  since: 'week' | 'partial' | 'none';
}

export interface ReviewDraft {
  /** The week: its first day and today (YYYY-MM-DD), and its name ("Week to 17 Oct"). */
  from: string;
  to: string;
  title: string;
  projects: ProjectReview[];
}

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
// Whole words: review rows wrap (t207 pass 2).
const quote = (s: string, _max = 60) => `“${s}”`;
const isDone = (status?: string) => isFinished(status);
const healthRank = (h?: string) => (/off/i.test(h ?? '') ? 2 : /risk/i.test(h ?? '') ? 1 : /track/i.test(h ?? '') ? 0 : -1);

/** Whether a step waits on someone else: its who isn't (first names match) and isn't "me". */
export function waitsOnOthers(step: Pick<ProjectNext, 'who'>, owner?: string): boolean {
  const who = (step.who ?? '').trim();
  if (!who || /^(me|i|myself|you)$/i.test(who)) return false;
  if (!owner) return true;
  const a = who.toLowerCase();
  const b = owner.toLowerCase();
  return !(a === b || a.split(/\s+/)[0] === b.split(/\s+/)[0]);
}

/** The step's day, when its "when" can be read. */
const stepDay = (s: ProjectNext, now: Date) => readDay(s.when, now);

/** The next Friday after today (a slipped step's new day). */
export function nextFriday(now: Date): Date {
  const f = fridayOf(now);
  return daysBetween(now, f) <= 0 ? addDays(f, 7) : f;
}

/** The week's draft, project by project (those with something to say first; finished projects only when they moved). */
export function draftReview(sources: ReviewSource[], { now = new Date(), days = 7 }: { now?: Date; days?: number } = {}): ReviewDraft {
  const today = startOfDay(now);
  const from = addDays(today, -(days - 1));
  const fromMs = from.getTime();
  const inWeek = (d: Date | null) => !!d && d.getTime() >= fromMs && d.getTime() <= today.getTime() + 86_399_999;
  const projects: ProjectReview[] = [];
  sources.forEach((src, pi) => {
    const p = parseProject(src.text, src.path);
    const was: Project | null = src.before ? parseProject(src.before, src.path) : null;
    const since: ProjectReview['since'] = !was ? 'none' : (src.beforeTime ?? 0) <= fromMs ? 'week' : 'partial';
    const id = (k: string, n: number) => `${pi}-${k}-${n}`;
    const changed: ReviewItem[] = [];
    const slipped: ReviewItem[] = [];
    const chase: ReviewItem[] = [];
    const proposals: ReviewProposal[] = [];
    const add = (list: ReviewItem[], k: string, item: Omit<ReviewItem, 'id'>) => list.push({ id: id(k, list.length), ...item });

    // ── What changed ──────────────────────────────────────────────────────────────────────────────────────────────
    const before = new Map((was?.next ?? []).map((s) => [sameWhat(s.what), s]));
    const ticked = was ? p.next.filter((s) => s.done && !before.get(sameWhat(s.what))?.done) : [];
    for (const s of ticked) add(changed, 'ticked', { words: `Done: ${s.what}`, ...(s.who ? { detail: s.who } : {}) });
    const added = was ? p.next.filter((s) => !s.done && !before.has(sameWhat(s.what))) : [];
    for (const s of added) add(changed, 'added', { words: `New next step: ${s.what}`, ...(s.who || s.when ? { detail: [s.who, s.when ? `by ${s.when}` : ''].filter(Boolean).join(' · ') } : {}) });
    if (was && was.health !== p.health && (was.health || p.health)) add(changed, 'health', { words: `Health: ${cap(was.health) || 'not set'} → ${cap(p.health) || 'not set'}` });
    if (was && was.status !== p.status && (was.status || p.status)) add(changed, 'status', { words: `Status: ${cap(was.status) || 'not set'} → ${cap(p.status) || 'not set'}` });
    if (was && was.progress !== p.progress && typeof p.progress === 'number') add(changed, 'progress', { words: `Progress: ${typeof was.progress === 'number' ? `${was.progress}%` : 'not set'} → ${p.progress}%` });
    for (const u of p.updates) if (inWeek(readDay(u.date, now))) add(changed, 'update', { words: u.what, detail: [u.date, u.from ? `from ${u.from}` : ''].filter(Boolean).join(' · ') });
    for (const d of p.decisions) if (inWeek(readDay(d.date, now))) add(changed, 'decision', { words: `Decided: ${d.what}`, ...(d.date ? { detail: d.date } : {}) });
    const oldRisks = new Set((was?.risks ?? []).map((r) => sameWhat(r.what)));
    for (const r of p.risks) {
      if (r.closed && inWeek(readDay(r.closedOn, now))) add(changed, 'risk-closed', { words: `Risk closed: ${r.what}` });
      else if (was && !r.closed && !oldRisks.has(sameWhat(r.what))) add(changed, 'risk-new', { words: `New risk: ${r.what}`, ...(r.level ? { detail: cap(r.level) } : {}) });
    }
    for (const a of (src.activity ?? []).filter((x) => x.modified >= fromMs).sort((a, b) => b.modified - a.modified)) add(changed, 'activity', { words: `Task: ${a.title}`, ...(a.status ? { detail: cap(a.status) } : {}), open: { note: a.path } });
    for (const n of (src.notes ?? []).filter((x) => x.modified >= fromMs).sort((a, b) => b.modified - a.modified)) add(changed, 'note', { words: `Note: ${n.title}`, open: { note: n.path } });
    const files = (src.files ?? []).filter((f) => f.modified >= fromMs).sort((a, b) => b.modified - a.modified);
    if (files.length) add(changed, 'files', { words: `${files.length} ${files.length === 1 ? 'file' : 'files'} changed in the folder`, detail: files.slice(0, 3).map((f) => f.name).join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : ''), open: { file: files[0].rel } });

    // ── What slipped ──────────────────────────────────────────────────────────────────────────────────────────────
    const done = isDone(p.status);
    const overdue: { step: ProjectNext; day: Date }[] = [];
    if (!done)
      for (const s of p.next) {
        if (s.done) continue;
        const day = stepDay(s, now);
        if (day && day.getTime() < today.getTime()) overdue.push({ step: s, day });
      }
    for (const { step, day } of overdue) {
      const late = daysBetween(day, today);
      add(slipped, 'overdue', { words: `${step.what}`, detail: [step.who, `was due ${dayWords(day, now)} (${late === 1 ? 'yesterday' : `${late} days ago`})`].filter(Boolean).join(' · ') });
    }
    if (was)
      for (const s of p.next) {
        const old = before.get(sameWhat(s.what));
        const a = old && stepDay(old, now);
        const b = stepDay(s, now);
        if (!s.done && a && b && b.getTime() > a.getTime()) add(slipped, 'moved', { words: `${s.what}`, detail: `moved from ${dayWords(a, now)} to ${dayWords(b, now)}` });
      }
    const due = readDay(p.due, now);
    const dueWas = readDay(was?.due, now);
    if (due && dueWas && due.getTime() > dueWas.getTime()) add(slipped, 'due-moved', { words: 'The project’s due date moved', detail: `from ${dayWords(dueWas, now)} to ${dayWords(due, now)}` });
    if (!done && due && due.getTime() < today.getTime()) add(slipped, 'due-passed', { words: `The project was due ${dayWords(due, now)}`, detail: `${plural(daysBetween(due, today), 'day')} ago, still ${p.status ?? 'open'}` });
    for (const d of p.dates) {
      const day = readDay(d.when, now);
      if (day && inWeek(day) && day.getTime() < today.getTime() && !/done|met|complete|achieved|held|signed|passed ok|✓/i.test(d.status ?? '')) add(slipped, 'date', { words: `Key date passed: ${d.what}`, detail: `${dayWords(day, now)}${d.status ? ` · ${d.status}` : ''}` });
    }

    // ── What to chase (waiting on others, due within a week or with no day) ───────────────────────────────────────
    if (!done) {
      const soon = addDays(today, 7).getTime();
      const waiting = p.next.filter((s) => !s.done && waitsOnOthers(s, p.owner)).filter((s) => {
        const day = stepDay(s, now);
        return !day || (day.getTime() >= today.getTime() && day.getTime() <= soon);
      });
      for (const s of waiting.slice(0, 6)) {
        const day = stepDay(s, now);
        add(chase, 'chase', { words: `${s.who}: ${s.what}`, detail: day ? (daysBetween(today, day) === 0 ? 'due today' : `due ${dayWords(day, now)}`) : 'no day set' });
      }
    }

    // ── Changes to propose ────────────────────────────────────────────────────────────────────────────────────────
    const prop = (kind: ProposalKind, x: Omit<ReviewProposal, 'id' | 'kind' | 'by'>) => proposals.push({ id: id(`p-${kind}`, proposals.length), kind, by: 'review', ...x });
    if (!done) {
      const rank = healthRank(p.health);
      const late = overdue.filter((o) => daysBetween(o.day, today) >= 3).length;
      const pastDue = !!due && due.getTime() < today.getTime();
      const openHigh = p.risks.some((r) => !r.closed && /high|critical/i.test(r.level ?? ''));
      let to: string | null = null;
      let why = '';
      if ((pastDue && daysBetween(due!, today) > 7) || overdue.length >= 3) {
        if (rank < 2) {
          to = 'off track';
          why = pastDue ? `It was due ${dayWords(due!, now)} and isn’t done.` : `${overdue.length} next steps are overdue.`;
        }
      } else if (pastDue || late >= 1 || (overdue.length >= 1 && openHigh)) {
        if (rank < 1) {
          to = 'at risk';
          why = pastDue ? `It was due ${dayWords(due!, now)}.` : `${overdue.length === 1 ? `${quote(overdue[0].step.what)} is` : `${overdue.length} steps are`} overdue.`;
        }
      } else if (rank >= 1 && !overdue.length && ticked.length >= 1 && !openHigh && !(due && due.getTime() < today.getTime())) {
        to = 'on track';
        why = `Nothing is overdue and ${ticked.length === 1 ? 'a step was' : `${ticked.length} steps were`} done this week.`;
      }
      if (to) prop('health', { words: `Health: ${cap(p.health) || 'not set'} → ${cap(to)}`, why, value: to, accept: true });
      // Each overdue step: moved to the coming Friday (the person picks the day; off unless chosen).
      const friday = dayWords(nextFriday(now), now);
      for (const { step, day } of overdue.slice(0, 5)) prop('move', { words: `Move ${quote(step.what)} to ${friday}`, why: `It was due ${dayWords(day, now)}.`, value: friday, step: step.what, accept: false });
      const allDone = p.next.length > 0 && p.next.every((s) => s.done);
      if (allDone && (p.progress ?? 0) >= 100) prop('status', { words: `Status: ${cap(p.status) || 'not set'} → Done`, why: 'Every next step is done and progress is 100%.', value: 'done', accept: false });
    }
    // The week's update line, from what happened (only when something did: p12-close-and-noise B, 4 Nov 2026 — a count
    // is not an update, so overdue steps alone write no line; the review's note still says what slipped).
    const bits: string[] = [];
    if (ticked.length) bits.push(ticked.length === 1 ? `done: ${quote(ticked[0].what, 50)}` : `${ticked.length} steps done (${quote(ticked[0].what, 40)} and ${ticked.length - 1} more)`);
    if (added.length) bits.push(`${added.length} new ${added.length === 1 ? 'step' : 'steps'}`);
    const activityCount = (src.activity ?? []).filter((x) => x.modified >= fromMs).length;
    if (activityCount) bits.push(`${activityCount} ${activityCount === 1 ? 'task' : 'tasks'} done for you`);
    if (files.length) bits.push(`${files.length} ${files.length === 1 ? 'file' : 'files'} changed`);
    if (bits.length && overdue.length) bits.push(`${overdue.length} ${overdue.length === 1 ? 'step' : 'steps'} overdue`);
    if (bits.length) prop('update', { words: 'Add this week’s update', value: `Week to ${dayWords(today, now)}: ${bits.join('; ')}.`, accept: true });

    const quiet = !changed.length && !slipped.length && !chase.length;
    if (done && !changed.length) return; // finished and still: not part of the week
    projects.push({ path: src.path, name: p.name, health: p.health, status: p.status, changed, slipped, chase, proposals, quiet, since });
  });
  // What needs the person first: slipped, then changed, then waiting; quiet ones last; by name within.
  const weight = (r: ProjectReview) => (r.quiet ? 3 : r.slipped.length ? 0 : r.changed.length ? 1 : 2);
  projects.sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
  return { from: isoDay(from), to: isoDay(today), title: `Week to ${dayWords(today, now)}`, projects };
}

/** A proposal as the change to the project file now (a moved step found by its words), or null when it no longer fits. */
export function proposalEdit(p: Project, x: Pick<ReviewProposal, 'kind' | 'value' | 'step'>): ProjectEdit | null {
  const value = String(x.value ?? '').trim();
  switch (x.kind) {
    case 'health':
      return (HEALTHS as readonly string[]).includes(value.toLowerCase()) ? { kind: 'set', field: 'health', value: value.toLowerCase() } : null;
    case 'status':
      return value ? { kind: 'set', field: 'status', value: value.toLowerCase() } : null;
    case 'update':
      return value ? { kind: 'add', list: 'updates', item: { what: value, from: 'Weekly review' } } : null;
    case 'next':
      return value && !p.next.some((s) => sameWhat(s.what) === sameWhat(value)) ? { kind: 'add', list: 'next', item: { what: value } } : null;
    case 'move': {
      const i = p.next.findIndex((s) => !s.done && sameWhat(s.what) === sameWhat(x.step ?? ''));
      return i >= 0 && value ? { kind: 'change', list: 'next', index: i, item: { when: value } } : null;
    }
    default:
      return null;
  }
}

/** The assistant's suggestions ("Ask the assistant to look over it"), as proposals off by default: JSON {"suggestions":[…]}. */
export function readAssistantSuggestions(reply: unknown, draft: ReviewDraft): ReviewDraft {
  const list = reply && typeof reply === 'object' && Array.isArray((reply as { suggestions?: unknown }).suggestions) ? (reply as { suggestions: unknown[] }).suggestions : [];
  const projects = draft.projects.map((r) => ({ ...r, proposals: r.proposals.filter((x) => x.by !== 'assistant') }));
  for (const raw of list.slice(0, 60)) {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const r = projects.find((x) => typeof s.project === 'string' && x.name.toLowerCase() === s.project.trim().toLowerCase());
    const kind = s.kind === 'health' || s.kind === 'next' || s.kind === 'update' ? s.kind : null;
    const value = typeof s.value === 'string' ? s.value.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    if (!r || !kind || !value) continue;
    if (kind === 'health' && !(HEALTHS as readonly string[]).includes(value.toLowerCase())) continue;
    if (kind === 'health' && (value.toLowerCase() === (r.health ?? '').toLowerCase() || r.proposals.some((x) => x.kind === 'health'))) continue;
    if (r.proposals.some((x) => x.kind === kind && sameWhat(x.value) === sameWhat(value))) continue;
    const words = kind === 'health' ? `Health: ${cap(r.health) || 'not set'} → ${cap(value.toLowerCase())}` : kind === 'next' ? `New next step: ${value}` : 'Add an update';
    r.proposals.push({ id: `${r.path}-ai-${r.proposals.length}`, kind, words, value: kind === 'health' ? value.toLowerCase() : value, ...(typeof s.why === 'string' && s.why.trim() ? { why: s.why.trim().slice(0, 300) } : {}), accept: false, by: 'assistant' });
  }
  return { ...draft, projects };
}

/** What was decided for one project, for the review's note. */
export interface ReviewOutcome {
  path: string;
  name: string;
  applied: string[];
  left: string[];
  /** The changes couldn't be made (the project changed meanwhile, or went). */
  failed?: string;
}

/** The review's note (Reviews/Weekly review — 17 Oct 2026.md): the week, each project's changed / slipped / chase lines, and what was decided. */
export function reviewNote(draft: ReviewDraft, outcomes: ReviewOutcome[], now: Date = new Date(), link: (path: string, name: string) => string = (_p, n) => `[[${n}]]`): string {
  const from = readDay(draft.from, now) ?? now;
  const applied = outcomes.reduce((n, o) => n + o.applied.length, 0);
  const lines: string[] = [
    '---',
    'type: review',
    `date: ${draft.to}`,
    `week: ${draft.from} to ${draft.to}`,
    `projects: [${draft.projects.filter((r) => !r.quiet || outcomes.some((o) => o.path === r.path && o.applied.length)).map((r) => JSON.stringify(link(r.path, r.name))).join(', ')}]`,
    'tags: [review]',
    '---',
    `${WEEKDAYS[from.getDay()]} ${dayWords(from, now)} to ${WEEKDAYS[now.getDay()]} ${dayWords(now, now)}. ${applied ? `${applied} ${applied === 1 ? 'change' : 'changes'} made` : 'No changes made'} across ${draft.projects.length} ${draft.projects.length === 1 ? 'project' : 'projects'}.`,
    '',
  ];
  const item = (i: ReviewItem) => `- ${i.words}${i.detail ? ` — ${i.detail}` : ''}`;
  const quiet: string[] = [];
  for (const r of draft.projects) {
    const o = outcomes.find((x) => x.path === r.path);
    if (r.quiet && !o?.applied.length) {
      quiet.push(link(r.path, r.name));
      continue;
    }
    lines.push(`## ${link(r.path, r.name)}`, '');
    if (r.changed.length) lines.push('**What changed**', ...r.changed.map(item), '');
    if (r.slipped.length) lines.push('**What slipped**', ...r.slipped.map(item), '');
    if (r.chase.length) lines.push('**To chase**', ...r.chase.map(item), '');
    if (o?.failed) lines.push('**Decided**', `- Not changed: ${o.failed}`, '');
    else if (o?.applied.length) lines.push('**Decided**', ...o.applied.map((w) => `- ${w}`), '');
    if (o?.left.length) lines.push('**Left as it was**', ...o.left.map((w) => `- ${w}`), '');
  }
  if (quiet.length) lines.push('## Quiet this week', '', quiet.join(' · '), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}

/** When the review is due this week: the chosen weekday at the chosen time ("15:00"), on or before now. */
export function reviewMoment(now: Date, day: number, time: string): Date {
  const [h, m] = /^(\d{1,2}):(\d{2})$/.exec(time)?.slice(1).map(Number) ?? [15, 0];
  const d = addDays(now, -((now.getDay() - day + 7) % 7));
  d.setHours(Math.min(23, h), Math.min(59, m), 0, 0);
  return d;
}

/** Whether to offer the review now: on, past this week's moment, and not done or put off since. */
export function reviewDue(now: Date, prefs: { on: boolean; day: number; time: string }, last?: number | null, putOff?: number | null): boolean {
  if (!prefs.on) return false;
  const moment = reviewMoment(now, prefs.day, prefs.time).getTime();
  if (now.getTime() < moment) return false;
  return Math.max(last ?? 0, putOff ?? 0) < moment;
}
