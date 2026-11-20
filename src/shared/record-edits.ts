// One record fact changed where it is shown (the peek, 4 Nov 2026). The record as read
// (src/shared/records.ts) plus the project as read (src/shared/project-file.ts) give the one
// ProjectEdit that writes the note the fact came from, keeping every other word: a workstream's
// cell in its table, a key date's line, a next step's tick, a risk's impact, a decision's day,
// someone's role in its People, a kept file's one line, the project's own facts. Through
// project:edit, so the change is refused when the file moved since, says its words, and undoes with
// the existing undo. Records not written in a project note (a meeting's actions, a plain note's
// boxes, someone named somewhere else), and facts with no column or line to write (a table without
// Progress, a line since taken out), answer null: the peek stays read-only there instead of
// changing the wrong words. Nothing here touches the disk.

import type { Project, ProjectEdit, ProjectList } from './project-file';
import { column, readTable, sectionText, setTableCell } from './layouts';
import { workstreams } from './project-hub';
import type { VaultRecord } from './records';

/** The record as the peek hands it over: only what the lookup reads. */
export type FactRecord = Pick<VaultRecord, 'type' | 'title' | 'path' | 'project' | 'item' | 'page' | 'folderFile'>;

const fold = (s: string) =>
  String(s ?? '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const clean = (s: unknown, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Whole words: change words wrap where they show (t207 pass 2).
const quote = (s: string) => `“${s}”`;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

type Plan =
  | { kind: 'cell'; heading: string; row: number; col: number; fact: string; name: string }
  | { kind: 'line'; list: ProjectList; index: number; part: string }
  | { kind: 'field'; field: 'status' | 'health' | 'progress' | 'owner' | 'started' | 'due' | 'name' }
  | { kind: 'describe'; path: string };

const LISTS: Record<string, ProjectList> = { next: 'next', dates: 'dates', risks: 'risks', decisions: 'decisions' };

/** Where one fact lives in its project note, or null when it has nowhere to write. `projectPath` is the file `p`
 *  was read from, for someone named in it (their record carries no project of its own). */
function planFor(p: Project, record: FactRecord, fact: string, projectPath?: string): Plan | null {
  if (record.type === 'person' || record.type === 'org') {
    // Someone with their own page changes in their note; someone named somewhere else is not written here.
    const at = record.project ?? projectPath;
    if (!at || record.path !== at || record.page || fact !== 'role') return null;
    const index = p.people.findIndex((x) => fold(x.name) === fold(record.title));
    return index < 0 ? null : { kind: 'line', list: 'people', index, part: 'role' };
  }
  if (record.type === 'file') {
    if (!record.project || record.path !== record.project || !record.folderFile || fact !== 'what') return null;
    return p.documents.some((d) => d.path.replace(/\\/g, '/') === record.folderFile) ? { kind: 'describe', path: record.folderFile } : null;
  }
  if (!record.project || record.path !== record.project) return null;
  const item = (list: ProjectList): number | null => {
    if (!record.item) return null;
    const [l, i] = record.item.split(':');
    if (LISTS[l] !== list) return null;
    const at = Number(i);
    const items = p[list] as unknown[];
    return Number.isInteger(at) && at >= 0 && at < items.length ? at : null;
  };
  switch (record.type) {
    case 'workstream': {
      const hit = workstreams(p).find((w) => fold(w.name) === fold(record.title));
      if (!hit || hit.ref.kind !== 'workstream') return null;
      const t = readTable(sectionText(p, hit.ref.section));
      if (!t) return null;
      const col =
        fact === 'owner'
          ? column(t, /^(owner|lead|who)$/i)
          : fact === 'status'
            ? column(t, /^(status|state|stage)$/i)
            : fact === 'progress'
              ? column(t, /^(progress|% ?done|percent|complete|%)$/i)
              : fact === 'next'
                ? column(t, /^(next( step)?|next steps?|notes?)$/i)
                : fact === 'title'
                  ? Math.max(0, column(t, /^(workstreams?|stream|area|name)$/i))
                  : -1;
      if (col < 0) return null;
      return { kind: 'cell', heading: hit.ref.section, row: hit.ref.row, col, fact, name: hit.name };
    }
    case 'milestone': {
      const at = item('dates');
      if (at === null) return null;
      if (fact === 'date') return { kind: 'line', list: 'dates', index: at, part: 'when' };
      if (fact === 'status') return { kind: 'line', list: 'dates', index: at, part: 'status' };
      if (fact === 'title' || fact === 'what') return { kind: 'line', list: 'dates', index: at, part: 'what' };
      return null;
    }
    case 'action': {
      const at = item('next');
      if (at === null) return null;
      if (fact === 'done' || fact === 'status') return { kind: 'line', list: 'next', index: at, part: 'done' };
      if (fact === 'owner' || fact === 'who') return { kind: 'line', list: 'next', index: at, part: 'who' };
      if (fact === 'when') return { kind: 'line', list: 'next', index: at, part: 'when' };
      if (fact === 'title' || fact === 'what') return { kind: 'line', list: 'next', index: at, part: 'what' };
      return null;
    }
    case 'risk': {
      const at = item('risks');
      if (at === null) return null;
      if (fact === 'level') return { kind: 'line', list: 'risks', index: at, part: 'level' };
      if (fact === 'status') return { kind: 'line', list: 'risks', index: at, part: 'status' };
      if (fact === 'owner') return { kind: 'line', list: 'risks', index: at, part: 'owner' };
      if (fact === 'title' || fact === 'what') return { kind: 'line', list: 'risks', index: at, part: 'what' };
      return null;
    }
    case 'decision': {
      const at = item('decisions');
      if (at === null) return null;
      if (fact === 'date') return { kind: 'line', list: 'decisions', index: at, part: 'date' };
      if (fact === 'why') return { kind: 'line', list: 'decisions', index: at, part: 'why' };
      if (fact === 'title' || fact === 'what') return { kind: 'line', list: 'decisions', index: at, part: 'what' };
      return null;
    }
    case 'project': {
      if (fact === 'status') return { kind: 'field', field: 'status' };
      if (fact === 'health') return { kind: 'field', field: 'health' };
      if (fact === 'progress') return { kind: 'field', field: 'progress' };
      if (fact === 'owner') return { kind: 'field', field: 'owner' };
      if (fact === 'due') return { kind: 'field', field: 'due' };
      if (fact === 'started') return { kind: 'field', field: 'started' };
      if (fact === 'title' || fact === 'name') return { kind: 'field', field: 'name' };
      return null;
    }
    default:
      return null;
  }
}

/** Whether the fact can be changed where it is shown (the peek reads this before offering a field). */
export function canEditFact(p: Project, record: FactRecord, fact: string, projectPath?: string): boolean {
  return planFor(p, record, fact, projectPath) !== null;
}

/**
 * The fact as written in the note (links and all): what an edit field opens
 * with, so saving keeps the person's own words. Null when it has nowhere to
 * write.
 */
export function recordFactText(p: Project, record: FactRecord, fact: string, projectPath?: string): string | null {
  const plan = planFor(p, record, fact, projectPath);
  if (!plan) return null;
  if (plan.kind === 'describe') {
    return p.documents.find((d) => d.path.replace(/\\/g, '/') === plan.path)?.what ?? '';
  }
  if (plan.kind === 'cell') {
    return readTable(sectionText(p, plan.heading))?.rows[plan.row]?.[plan.col] ?? '';
  }
  if (plan.kind === 'line') {
    const line = (p[plan.list] as unknown as Record<string, unknown>[])[plan.index];
    if (plan.part === 'done') return line.done ? 'true' : 'false';
    const v = line[plan.part];
    return typeof v === 'string' ? v : '';
  }
  if (plan.field === 'progress') return p.progress === undefined ? '' : String(p.progress);
  const v = p[plan.field];
  return typeof v === 'string' ? v : '';
}

/**
 * The words a status choice starts from: what the person's own column or list
 * already says (in order, each once), for the peek's choices to offer first.
 * Null when the fact is not one a choice offers.
 */
export function recordChoices(p: Project, record: FactRecord, fact: string): string[] | null {
  const once = (words: string[]) => {
    const out: string[] = [];
    for (const w of words) {
      const t = w.trim();
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out;
  };
  if (record.type === 'workstream' && fact === 'status') {
    const hit = workstreams(p).find((w) => fold(w.name) === fold(record.title));
    if (!hit || hit.ref.kind !== 'workstream') return null;
    const t = readTable(sectionText(p, hit.ref.section));
    if (!t) return null;
    const col = column(t, /^(status|state|stage)$/i);
    if (col < 0) return null;
    return once(t.rows.map((r) => r[col] ?? ''));
  }
  if (record.type === 'milestone' && fact === 'status') return once(p.dates.map((d) => d.status ?? ''));
  if (record.type === 'risk' && fact === 'status') return once(p.risks.map((r) => r.status ?? ''));
  if (record.type === 'risk' && fact === 'level') return once(p.risks.map((r) => r.level ?? ''));
  return null;
}

/**
 * The one ProjectEdit that writes a record's fact (`value` as the person typed
 * it, '' clearing where a fact can be empty), or null when it has nowhere to
 * write. Progress keeps its column's style (a % column keeps its %); a tick is
 * 'true' or 'false'.
 */
export function recordFactEdit(p: Project, record: FactRecord, fact: string, value: string, projectPath?: string): ProjectEdit | null {
  const plan = planFor(p, record, fact, projectPath);
  if (!plan) return null;
  if (plan.kind === 'describe') {
    return { kind: 'describe', path: plan.path, what: clean(value, 300) };
  }
  if (plan.kind === 'cell') {
    let words = clean(value, 400);
    if (plan.fact === 'progress') {
      if (!words) words = '';
      else {
        const n = Number(words.replace(/%\s*$/, ''));
        if (!Number.isFinite(n)) return null;
        const cell = readTable(sectionText(p, plan.heading))?.rows[plan.row]?.[plan.col] ?? '';
        words = `${Math.max(0, Math.min(100, Math.round(n)))}${/%\s*$/.test(cell) ? '%' : ''}`;
      }
    }
    if (plan.fact === 'title' && !words) return null;
    const body = setTableCell(sectionText(p, plan.heading), plan.row, plan.col, words);
    const said =
      plan.fact === 'owner'
        ? words
          ? `${words} owns ${quote(plan.name)}.`
          : `Took the owner off ${quote(plan.name)}.`
        : plan.fact === 'status'
          ? words
            ? `Set ${quote(plan.name)} to ${cap(words)}.`
            : `Cleared the status of ${quote(plan.name)}.`
          : plan.fact === 'progress'
            ? words
              ? `Set ${quote(plan.name)} to ${words}.`
              : `Cleared the progress of ${quote(plan.name)}.`
            : plan.fact === 'next'
              ? `Changed the next step of ${quote(plan.name)}.`
              : `Renamed ${quote(plan.name)} to ${quote(words)}.`;
    return { kind: 'section', heading: plan.heading, body, words: said };
  }
  if (plan.kind === 'line') {
    if (plan.part === 'done') {
      const done = /^(true|1|done|closed|complete|completed|x)$/i.test(String(value).trim());
      const undone = /^(false|0|open|reopen|)$/i.test(String(value).trim());
      if (!done && !undone) return null;
      return { kind: 'change', list: plan.list, index: plan.index, item: { done } };
    }
    const words = clean(value, plan.part === 'why' ? 400 : 300);
    if ((plan.part === 'what' || plan.part === 'title') && !words) return null;
    return { kind: 'change', list: plan.list, index: plan.index, item: { [plan.part]: words } };
  }
  if (plan.field === 'progress') {
    const raw = String(value ?? '').trim().replace(/%\s*$/, '');
    if (!raw) return { kind: 'set', field: 'progress', value: null };
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return { kind: 'set', field: 'progress', value: Math.max(0, Math.min(100, Math.round(n))) };
  }
  const words = clean(value, plan.field === 'name' ? 120 : 300);
  if (plan.field === 'name' && !words) return null;
  return { kind: 'set', field: plan.field, value: words || null };
}
