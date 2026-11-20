// Tidy (29 Oct 2026): Ironleaf does the organising, the person only approves. planTidy reads a project file through
// its parser (src/shared/project-file.ts, never regexes over the whole file) and works out what would move to the
// project's History note, what stays, and what only the person can settle (said). Nothing is ever deleted: keep +
// history together hold every line of the original. Pure: the main side applies a plan (src/main/app.ts
// project:tidy) through the same history and Undo as any other project edit, refusing when the file changed since
// the preview.

import { parseProject, serializeProject, type Project, type ProjectDate, type ProjectNext, type ProjectUpdate } from './project-file';
import { alike, DONE_WORDS } from './project-hub';
import { dayFrom, readDay, ymd } from './timeline';

export type TidyMoveKind = 'updates' | 'merged' | 'done' | 'dates';
export interface TidyMove {
  kind: TidyMoveKind;
  /** In plain words, for the preview ("Update from 12 Sep 2026: …"). */
  words: string;
  /** The lines that move, as they will be written in the History note. */
  text: string;
}
export interface TidyPlan {
  moves: TidyMove[];
  /** The project file after tidying, written by the project file's own writer. */
  keep: string;
  /** The block to put at the top of the History note ('' when nothing moves). */
  history: string;
  /** What only the person can settle, in plain words. Nothing here is changed by Tidy. */
  said: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MERGED = /^merge[ds]?\b|\bmerged\b/i;
// Whole words: tidy findings wrap where they show (t207 pass 2).
const clip = (s: string, _n = 72) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t;
};

/** Today, from a Date, a timeline day (or a millisecond time), or words ("29 Oct 2026"): the timeline day. */
function dayOf(today: Date | number | string | undefined): number {
  if (today instanceof Date) return dayFrom(today.getFullYear(), today.getMonth(), today.getDate());
  if (typeof today === 'number' && Number.isFinite(today)) return today > 1_000_000_000 ? dayOf(new Date(today)) : Math.round(today);
  if (typeof today === 'string') {
    const now = dayOf(new Date());
    return readDay(today, now) ?? now;
  }
  return dayOf(new Date());
}
const dayWords = (day: number) => {
  const { y, m, d } = ymd(day);
  return `${d} ${MONTHS[m]} ${y}`;
};
const updateLine = (u: ProjectUpdate) => `- ${u.date ? `**${u.date}** — ` : ''}${u.what}${u.from ? ` *From:* ${u.from}` : ''}`;
const withLines = (line: string, x: { before?: string; more?: string }) => [...(x.before ? [x.before] : []), line, ...(x.more ? [x.more] : [])].join('\n');
const nextLine = (n: ProjectNext) => {
  const tail = n.tail?.text ?? [n.who ?? '', n.when ? `by ${n.when}` : ''].filter(Boolean).join(' · ');
  return `- [${n.done ? 'x' : ' '}] ${n.what}${tail ? ` — ${tail}` : ''}`;
};
const dateRow = (d: ProjectDate, head?: string[]) => `| ${(head ?? ['When', 'What', 'Status']).map((_, i) => [d.when, d.what, d.status ?? ''][i].replace(/\|/g, '\\|')).join(' | ')} |`;

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sigWords = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4);
/** Whether an update mentions a step: its words in the update's, the two alike, or half its longer words there. */
function mentions(update: string, step: string): boolean {
  const u = ` ${norm(update)} `;
  if (norm(step) && u.includes(` ${norm(step)} `)) return true;
  if (alike(update, step)) return true;
  const words = [...new Set(sigWords(step))];
  if (!words.length) return false;
  const inUpdate = new Set(sigWords(update));
  return words.filter((w) => inUpdate.has(w)).length >= Math.ceil(words.length / 2) && words.some((w) => inUpdate.has(w));
}

/**
 * What Tidy would do to one project file, from its text. `today` is a Date, a timeline day, or a date as written.
 * Cases (29 Oct 2026): older updates beyond the 10 newest, sections left over from a merge, ticked steps older
 * than 14 days and past key dates marked done move to History; past dates with no status, steps too long to scan
 * and open steps that say the same thing are only listed in `said`, never changed.
 */
export function planTidy(text: string, today?: Date | number | string): TidyPlan {
  const now = dayOf(today);
  const source = String(text ?? '');
  const p = parseProject(source);
  const keep: Project = JSON.parse(JSON.stringify(p)) as Project;
  const moves: TidyMove[] = [];
  const said: string[] = [];

  // a) Updates: the 10 newest stay; the rest move, in the order the file has them.
  const day = (u: ProjectUpdate) => (u.date ? readDay(u.date, now) : null);
  const ranked = p.updates.map((u, i) => ({ i, day: day(u) })).sort((a, b) => (b.day ?? -Infinity) - (a.day ?? -Infinity) || a.i - b.i);
  const keptUpdates = new Set(ranked.slice(0, 10).map((x) => x.i));
  const movedUpdates = p.updates.filter((_, i) => !keptUpdates.has(i));
  for (const u of movedUpdates) moves.push({ kind: 'updates', words: `Update${u.date ? ` from ${u.date}` : ''}: ${clip(u.what)}`, text: withLines(updateLine(u), u) });
  if (movedUpdates.length) keep.updates = p.updates.filter((_, i) => keptUpdates.has(i));

  // b) Sections left over from a merge move word for word (their heading and body as the parser kept them).
  const merged = p.extra.filter((x) => MERGED.test(x.heading));
  for (const x of merged) moves.push({ kind: 'merged', words: `The “${x.heading}” section, left over from a merge`, text: `## ${x.heading}\n\n${x.body.replace(/\s+$/, '')}` });
  if (merged.length) keep.extra = p.extra.filter((x) => !merged.includes(x));

  // c) Ticked steps older than 14 days: by the newest dated update that mentions them, else the file's own
  // `updated` day (when the file was last changed, as the file says). With neither date, a step stays.
  const fileChanged = p.updated ? readDay(p.updated, now) : null;
  const movedDone: ProjectNext[] = [];
  for (const n of p.next) {
    if (!n.done) continue;
    let newest: number | null = null;
    for (const u of p.updates) {
      const d = day(u);
      if (d !== null && mentions(`${u.what} ${u.from ?? ''}`, n.what)) newest = newest === null ? d : Math.max(newest, d);
    }
    const aged = newest ?? fileChanged;
    if (aged !== null && now - aged > 14) movedDone.push(n);
  }
  for (const n of movedDone) moves.push({ kind: 'done', words: `Done step: ${clip(n.what)}`, text: withLines(nextLine(n), n) });
  if (movedDone.length) keep.next = p.next.filter((n) => !movedDone.includes(n));

  // d) Key dates: past and marked done move; past with no done word stay, listed as dates to confirm.
  const movedDates: ProjectDate[] = [];
  for (const d of p.dates) {
    const when = readDay(d.when, now);
    if (when === null || when >= now) continue;
    if (DONE_WORDS.test(d.status ?? '') || /[\[(](?:done|complete|completed|closed|held)[\])]?\s*$/i.test(d.what)) movedDates.push(d);
    else said.push(`Dates to confirm: “${clip(d.what, 60)}” was ${d.when} and has no status saying it happened.`);
  }
  for (const d of movedDates) moves.push({ kind: 'dates', words: `Key date ${d.when}: ${clip(d.what)}`, text: dateRow(d, p.datesHead) });
  if (movedDates.length) keep.dates = p.dates.filter((d) => !movedDates.includes(d));

  // e) Open steps too long to scan are only said, never rewritten.
  for (const n of p.next) if (!n.done && n.what.length > 160) said.push(`Too long to scan: shorten in Details: “${clip(n.what, 60)}”`);

  // f) Two open steps that say the same thing are only said, never merged.
  const open = p.next.filter((n) => !n.done);
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) if (alike(open[i].what, open[j].what)) said.push(`These say the same thing: “${clip(open[i].what, 50)}” and “${clip(open[j].what, 50)}”. Tidy leaves both as they are.`);

  // The History block: dated, newest moves first (this block goes above older ones, see historyNoteText).
  let history = '';
  if (moves.length) {
    const part = (kind: TidyMoveKind, title: string, head: string[] = []) => {
      const lines = moves.filter((m) => m.kind === kind).map((m) => m.text);
      return lines.length ? [`### ${title}`, '', ...head, ...lines, ''] : [];
    };
    // The table's own header goes with its rows: the person's when it was read, else the plain one the project
    // writer writes (`| When | What | Status |` is that plain one, so the parser does not store it: 29 Oct 2026).
    const dateHead = movedDates.length ? [`| ${(p.datesHead ?? ['When', 'What', 'Status']).join(' | ')} |`, `| ${(p.datesHead ?? ['When', 'What', 'Status']).map(() => '---').join(' | ')} |`] : [];
    history = [
      `## Moved by Tidy on ${dayWords(now)}`,
      '',
      ...part('updates', 'Older updates'),
      ...moves.filter((m) => m.kind === 'merged').flatMap((m) => [m.text, '']),
      ...part('done', 'Done'),
      ...part('dates', 'Key dates', dateHead),
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '');
  }
  return { moves, keep: serializeProject(keep, source), history, said };
}

/** Where a project's History note lives: beside its file, in the project's folder in the notes. */
export const historyPathFor = (projectPath: string) => {
  const dir = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/')) : '';
  return dir ? `${dir}/History.md` : 'History.md';
};

const yamlName = (name: string) => (/[:#[\]{}&*!|>'"%@`,]/.test(name) || /^\s|\s$/.test(name) ? JSON.stringify(name) : name);

/**
 * The History note's text with a new Tidy block in it: made new (type: note, project: <name>) when there is none,
 * else the block goes above the older "Moved by Tidy" blocks (newest first), under its title.
 */
export function historyNoteText(existing: string | null | undefined, name: string, block: string): string {
  const text = String(existing ?? '');
  if (!text.trim()) return `---\ntype: note\nproject: ${yamlName(name)}\n---\n# ${name} history\n\n${block}\n`;
  const lines = text.split('\n');
  // After the properties and the title, before what is already there.
  let at = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (end > 0) at = end + 1;
  }
  while (at < lines.length && !lines[at].trim()) at++;
  if (at < lines.length && /^#\s+/.test(lines[at])) at++;
  while (at < lines.length && !lines[at].trim()) at++;
  return [...lines.slice(0, at), '', block, '', ...lines.slice(at)].join('\n').replace(/\n{3,}/g, '\n\n');
}
